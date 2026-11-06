/**
 * HC-01 · T-135 · 真实 flowState 接线全链验证（S-09 第一批 B 线）
 *
 * 覆盖：
 * ① 枚举→令牌映射唯一落点在 render 层，UI 零字面令牌 id（AC-T8 ① / ②）；
 * ② buildFlowLegend 产出真实令牌填充的不透明图例；
 * ③ buildFlowLegend → setFlowLegendProvider → getFlowLegend()/legendLabels() 全链；
 * ④ TickResult.flowState[] → buildFlowOverlays → buildDrawList({overlays})
 *    产出 layer='flow' 的 OverlayDraw，三态分别得到正确 tokenId 与 deriveLine 线宽/亮度；
 * ⑤ 「边槽→格」映射必须显式传入，i 不得被当作 cellIndex，且不得捏造映射；
 * ⑥ AD-004 双通道：即时通道 A 不读三态数据；渲染层不 import simulation、不持有阈值键；
 * ⑦ 确定性 / 不修改输入 / 冻结。
 *
 * 零依赖：Node 22 --experimental-strip-types + node:test。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  createDefaultConfig,
  createInitialState,
  createTickWorkspace,
  runTick,
  makeCommand,
  cellIndex,
  zoneIndex,
  canonicalize,
  buildSemanticTokenMap,
  tokenById,
  buildViewModel,
  buildDrawList,
  VIRTUAL_ATLAS_MANIFEST,
  type Config,
  type CityState,
} from '../../src/index.ts';
import {
  FLOW_TOKEN_ID,
  FLOW_STATE_ORDER,
  buildFlowLegend,
  buildFlowOverlays,
  type FlowStateCode,
  type FlowEdgeCell,
} from '../../src/render/flow-legend.ts';
import {
  getFlowLegend,
  legendLabels,
  legendItemFor,
  setFlowLegendProvider,
} from '../../src/ui/index.ts';

// ---------------------------------------------------------------------------
// 辅助：静态扫描
// ---------------------------------------------------------------------------

function srcTsFiles(dirRel: string): string[] {
  const root = join(process.cwd(), dirRel);
  return readdirSync(root, { recursive: true })
    .map((f) => join(root, String(f)))
    .filter((p) => p.endsWith('.ts'));
}

/** 去注释（保留字符串字面量，用于令牌 id / import 扫描） */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** 构造一座 side=16、单 R→I 边的城（与 flow-state.test.ts 同构），产出真实 TickResult */
function buildCity(config: Config): CityState {
  const state = createInitialState(config, { side: 16 });
  for (let x = 0; x < 16; x++) {
    const i = cellIndex(state.side, x, 4);
    state.cells.zone[i] = zoneIndex(config, 'ROAD');
    state.cells.density[i] = 0;
    state.cells.unlocked[i] = 1;
    state.cells.inputVersion[i]++;
  }
  for (let x = 0; x < 5; x++) {
    const i = cellIndex(state.side, x, 5);
    state.cells.zone[i] = zoneIndex(config, 'R');
    state.cells.density[i] = 3;
    state.cells.unlocked[i] = 1;
    state.cells.inputVersion[i]++;
  }
  for (let x = 10; x < 12; x++) {
    const i = cellIndex(state.side, x, 3);
    state.cells.zone[i] = zoneIndex(config, 'I');
    state.cells.density[i] = 1;
    state.cells.unlocked[i] = 1;
    state.cells.inputVersion[i]++;
  }
  return state;
}

/** 三态到 deriveLine 期望值（draw-list.ts 的 DEFAULT_FLOW_LINE 预设表） */
const EXPECTED_LINE: Readonly<Record<string, { widthScale: number; brightness: number }>> = {
  'flow.clear': { widthScale: 1, brightness: 0.6 },
  'flow.slow': { widthScale: 2, brightness: 0.8 },
  'flow.congested': { widthScale: 3, brightness: 1 },
};

// ---------------------------------------------------------------------------
// ① 枚举→令牌映射 / 跨层静态契约
// ---------------------------------------------------------------------------

test('RF-1 枚举→令牌映射唯一落点在 render，UI 零字面令牌 id（AC-T8 ① / ②）', () => {
  assert.deepEqual(FLOW_STATE_ORDER, ['clear', 'slow', 'congested']);
  assert.deepEqual(FLOW_TOKEN_ID, {
    clear: 'flow.clear',
    slow: 'flow.slow',
    congested: 'flow.congested',
  });
  // render 层：映射表字面量只出现在 flow-legend.ts（draw-list 的线宽预设表是另一维度，允许存在）
  const renderFiles = srcTsFiles('src/render');
  const mappingOwners = renderFiles.filter((f) =>
    /clear:\s*'flow\.clear'/.test(readFileSync(f, 'utf8')),
  );
  assert.equal(mappingOwners.length, 1, '枚举→令牌映射表只能有一个落点');
  assert.ok(mappingOwners[0].endsWith('flow-legend.ts'));

  // UI 层：代码层零字面令牌 id
  const uiOffenders: string[] = [];
  for (const f of srcTsFiles('src/ui')) {
    const code = stripComments(readFileSync(f, 'utf8'));
    if (/'flow\.(clear|slow|congested)'/.test(code)) uiOffenders.push(f);
  }
  assert.deepEqual(uiOffenders, [], 'src/ui/** 不得出现任何 flow.* 字面令牌 id');

  // UI 层：不 import semantic-tokens 用于 flow，也不调用 tokenById 查 flow 令牌
  for (const f of srcTsFiles('src/ui')) {
    const code = stripComments(readFileSync(f, 'utf8'));
    assert.equal(/tokenById\s*\([^)]*'flow\./.test(code), false, f + ' 不得用 tokenById 查 flow 令牌');
  }
});

test('RF-2 渲染层零阈值键 / 零 q-cap 比较 / 不 import simulation（AC-T8 ③）', () => {
  for (const f of srcTsFiles('src/render')) {
    const code = stripComments(readFileSync(f, 'utf8'));
    assert.equal(/flowClearMaxQOverCap|flowSlowMaxQOverCap/.test(code), false, f + ' 不得持有占位阈值键');
    assert.equal(/qOverCap\s*[<>]=?|qoc\s*[<>]=?/.test(code), false, f + ' 不得对 q/cap 做阈值比较');
    assert.equal(/from\s+['"][^'"]*\/simulation\//.test(code), false, f + ' 不得越层依赖 simulation');
  }
  for (const f of srcTsFiles('src/ui')) {
    const code = stripComments(readFileSync(f, 'utf8'));
    assert.equal(/flowClearMaxQOverCap|flowSlowMaxQOverCap/.test(code), false, f + ' 不得持有占位阈值键');
  }
});

// ---------------------------------------------------------------------------
// ② buildFlowLegend：真实令牌填充的不透明图例
// ---------------------------------------------------------------------------

test('RF-3 buildFlowLegend 产出三态真实图例：label 畅/缓/堵、paint 为真实令牌且不透明', () => {
  const tokens = buildSemanticTokenMap(createDefaultConfig().zoneTypes);
  const legend = buildFlowLegend(tokens);
  assert.equal(legend.length, 3);
  assert.deepEqual(legend.map((it) => it.flowState), ['clear', 'slow', 'congested']);
  assert.deepEqual(legend.map((it) => it.swatch.label), ['畅', '缓', '堵']);

  for (const item of legend) {
    const id = FLOW_TOKEN_ID[item.flowState];
    const token = tokenById(tokens, id);
    // paint 由真实语义令牌填充（不是 null / 占位），但对 UI 类型上恒为 unknown
    assert.notEqual(item.swatch.paint, null, item.flowState + ' 的 paint 不得为空');
    assert.equal(item.swatch.paint, token, item.flowState + ' 的 paint 必须是真实语义令牌');
    assert.equal(typeof item.swatch.paint, 'object');
  }

  // 冻结：调用方不能改写图例
  assert.equal(Object.isFrozen(legend), true);
  for (const item of legend) {
    assert.equal(Object.isFrozen(item), true);
    assert.equal(Object.isFrozen(item.swatch), true);
  }
  // 确定性
  assert.equal(canonicalize(buildFlowLegend(tokens)), canonicalize(legend));
});

test('RF-4 buildFlowLegend 缺省 tokenMap 仍产出真实令牌（flow.* 与分区配置无关）', () => {
  const legend = buildFlowLegend();
  assert.equal(legend.length, 3);
  for (const item of legend) {
    assert.equal(typeof item.swatch.paint, 'object');
    assert.notEqual(item.swatch.paint, null);
  }
});

// ---------------------------------------------------------------------------
// ③ buildFlowLegend → getFlowLegend()/legendLabels() 全链 + UI 不解析 paint
// ---------------------------------------------------------------------------

test('RF-5 buildFlowLegend → setFlowLegendProvider → getFlowLegend()/legendLabels() 全链', () => {
  const tokens = buildSemanticTokenMap(createDefaultConfig().zoneTypes);
  setFlowLegendProvider(() => buildFlowLegend(tokens));
  try {
    const legend = getFlowLegend();
    assert.equal(legend.length, 3);
    assert.deepEqual(legend.map((it) => it.flowState), ['clear', 'slow', 'congested']);
    assert.deepEqual(legendLabels(), ['畅', '缓', '堵']);
    assert.equal(legendItemFor('slow')?.swatch.label, '缓');
    assert.equal(legendItemFor('congested')?.flowState, 'congested');
    // 显式传参通道
    const explicit = buildFlowLegend(tokens);
    assert.equal(getFlowLegend(explicit), explicit);
  } finally {
    setFlowLegendProvider(undefined); // 复位，避免污染其它用例
  }
  // 复位后默认 provider 仍可用（既有无参行为不打穿）
  assert.deepEqual(legendLabels(), ['畅', '缓', '堵']);
});

test('RF-6 UI 不解析 swatch.paint 内部、HUD 无 mock 图例常量 / pending:s04 残留', () => {
  for (const f of srcTsFiles('src/ui')) {
    const code = stripComments(readFileSync(f, 'utf8'));
    assert.equal(/\.paint\.[A-Za-z_$]/.test(code), false, f + ' 不得解析 paint 内部字段');
  }
  // mock / 过时注释检查只限定 HUD 子层（诊断数据层属并行 A 线，不纳入本批断言）
  for (const f of srcTsFiles('src/ui/hud')) {
    const raw = readFileSync(f, 'utf8');
    assert.equal(raw.indexOf('MOCK_FLOW_LEGEND') >= 0, false, f + ' 不得定义/消费 mock 图例常量');
    assert.equal(raw.indexOf('pending:s04') >= 0, false, f + ' 不得残留过时 pending:s04 注释');
  }
  assert.ok(/paint:\s*unknown/.test(readFileSync(join(process.cwd(), 'src/ui/hud/types.ts'), 'utf8')),
    'OpaqueSwatch.paint 必须保持 unknown');
});

// ---------------------------------------------------------------------------
// ④ 全链：TickResult.flowState[] → buildFlowOverlays → buildDrawList
// ---------------------------------------------------------------------------

test('RF-7 真实 TickResult.flowState[] 全链：产出 layer=flow 的 OverlayDraw + deriveLine 线宽/亮度', () => {
  const config = createDefaultConfig();
  const tokens = buildSemanticTokenMap(config.zoneTypes);
  const state = buildCity(config);
  const ws = createTickWorkspace(config, 16);
  const tick = runTick(state, [makeCommand.advance('rf-7', 1)], config, ws);
  const flowState = tick.flowState; // 真实模拟层产物
  assert.ok(flowState.length > 0, '真实 TickResult.flowState 非空');

  // 「边槽→格」映射由调用方 / 视图模型显式提供：cellIndex 刻意与 edgeIndex 错开，
  // 并限制在 [100,199] 内保证都 < 16*16=256（合法格索引）。
  const edgeToCell: readonly FlowEdgeCell[] = flowState.map((_s, edgeIndex) => ({
    edgeIndex,
    cellIndex: 100 + (edgeIndex % 100),
  }));
  const overlays = buildFlowOverlays(flowState, tokens, edgeToCell);
  assert.equal(overlays.length, flowState.length, '逐边对齐、不截断');
  for (const spec of overlays) {
    assert.equal(spec.layer, 'flow');
    assert.equal(spec.line, undefined, '不预设 spec.line，交给 buildDrawList 的 deriveLine 推导');
  }

  const vm = buildViewModel(createInitialState(config, { side: 16 }));
  const dl = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, 'L0', { overlays });
  const flows = dl.overlays.filter((o) => o.layer === 'flow');
  assert.equal(flows.length, overlays.length, '全部叠层进入绘制列表（格索引均合法）');
  assert.equal(dl.shapeSpriteCount, 0, 'L0 不产形状');
  assert.equal(dl.lineEncodedCount, overlays.length, 'L0 通勤态全部走线编码');

  for (let i = 0; i < flows.length; i++) {
    const o = flows[i];
    assert.ok(o.tokenId in EXPECTED_LINE, 'tokenId 必须是 flow.* 三态之一：' + o.tokenId);
    assert.deepEqual(o.line, EXPECTED_LINE[o.tokenId], o.tokenId + ' 的 deriveLine 线宽/亮度');
    assert.equal(o.group, 'flow');
    assert.equal(o.shapeVisible, false);
  }
  // 映射的 cellIndex 被真实采用（不是循环下标 i）
  const cellSet = new Set(flows.map((o) => o.cellIndex));
  assert.ok(cellSet.has(100), 'cellIndex=100 应来自显式映射');
  assert.equal(cellSet.has(0), false, '不得把 i=0 当作 cellIndex');
});

test('RF-8 三态分别得到正确 tokenId 与线宽/亮度（L0 线编码 / L1 形状）', () => {
  const config = createDefaultConfig();
  const tokens = buildSemanticTokenMap(config.zoneTypes);
  // 与 TickResult.flowState 同构的枚举数组（覆盖三态全部分支）
  const flowState: readonly FlowStateCode[] = ['clear', 'slow', 'congested'];
  const edgeToCell: readonly FlowEdgeCell[] = [
    { edgeIndex: 2, cellIndex: 48 }, // 故意乱序：证明按映射取值，不按 i
    { edgeIndex: 0, cellIndex: 7 },
    { edgeIndex: 1, cellIndex: 200 },
  ];
  const overlays = buildFlowOverlays(flowState, tokens, edgeToCell);
  assert.deepEqual(overlays.map((s) => s.token.id),
    ['flow.congested', 'flow.clear', 'flow.slow'], 'tokenId 跟随 edgeIndex 对应的枚举');
  assert.deepEqual(overlays.map((s) => s.cellIndex), [48, 7, 200], 'cellIndex 严格取自显式映射');
  for (const spec of overlays) {
    const t = tokenById(tokens, spec.token.id);
    assert.deepEqual(spec.token, {
      id: t.id, group: t.group, color: t.color, shape: t.shape, label: t.label,
    }, 'OverlayToken 由真实语义令牌填充');
  }

  const vm = buildViewModel(createInitialState(config, { side: 16 }));
  const l0 = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, 'L0', { overlays });
  const byId = new Map(l0.overlays.map((o) => [o.tokenId, o]));
  assert.equal(byId.size, 3);
  assert.deepEqual(byId.get('flow.clear')?.line, { widthScale: 1, brightness: 0.6 });
  assert.deepEqual(byId.get('flow.slow')?.line, { widthScale: 2, brightness: 0.8 });
  assert.deepEqual(byId.get('flow.congested')?.line, { widthScale: 3, brightness: 1 });
  assert.equal(l0.shapeSpriteCount, 0);
  assert.equal(l0.lineEncodedCount, 3);

  const l1 = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, 'L1', { overlays });
  assert.equal(l1.shapeSpriteCount, 3, 'L1 产出形状');
  assert.equal(l1.lineEncodedCount, 0);
  for (const o of l1.overlays) {
    assert.equal(o.shapeVisible, true);
    assert.equal(o.line, null);
    assert.ok(o.tokenId in EXPECTED_LINE);
  }
});

// ---------------------------------------------------------------------------
// ⑤ 映射诚实性 / 确定性
// ---------------------------------------------------------------------------

test('RF-9 无映射不捏造、越界边槽跳过、输入不被修改、确定性', () => {
  const tokens = buildSemanticTokenMap(createDefaultConfig().zoneTypes);
  const flowState: readonly FlowStateCode[] = ['clear', 'slow', 'congested'];
  const snapshot = canonicalize(flowState);

  assert.deepEqual(buildFlowOverlays(flowState, tokens, []), [], '空映射 → 空叠层，不凭空捏造');
  assert.deepEqual(
    buildFlowOverlays(flowState, tokens, [{ edgeIndex: 99, cellIndex: 3 }]),
    [],
    '越界 edgeIndex 应诚实跳过',
  );
  assert.deepEqual(
    buildFlowOverlays(flowState, tokens, [{ edgeIndex: 0, cellIndex: 1 }, { edgeIndex: 1, cellIndex: 2 }]),
    buildFlowOverlays(flowState, tokens, [{ edgeIndex: 0, cellIndex: 1 }, { edgeIndex: 1, cellIndex: 2 }]),
    '同输入同输出',
  );
  assert.equal(canonicalize(flowState), snapshot, '不得修改输入 flowState');
  assert.equal(Object.isFrozen(buildFlowLegend(tokens)), true);
});

// ---------------------------------------------------------------------------
// ⑥ AD-004 双通道 / 跨层纪律
// ---------------------------------------------------------------------------

test('RF-10 AD-004 即时通道 A 不读三态数据；渲染层不持有阈值键', () => {
  const channelA = [
    'src/ui/feedback-bus.ts',
    'src/ui/optimistic-view.ts',
    'src/ui/motion-policy.ts',
    'src/ui/interaction-controller.ts',
  ];
  for (const rel of channelA) {
    const code = stripComments(readFileSync(join(process.cwd(), rel), 'utf8'));
    assert.equal(/\bflowState\b/.test(code), false, rel + ' 不得读 flowState 数组');
    assert.equal(/buildFlowOverlays|buildFlowLegend|flow-legend/.test(code), false,
      rel + ' 不得接线三态渲染');
  }
  // 模拟层三态分类仍是唯一真源（渲染层只接收枚举，不重做分类）
  const flowLegendSrc = readFileSync(join(process.cwd(), 'src/render/flow-legend.ts'), 'utf8');
  assert.equal(/classifyFlowState|qOverCap\s*[<>]=?/.test(stripComments(flowLegendSrc)), false,
    '渲染层不得重做三态分类 / 阈值比较');
});

test('RF-11 渲染层新模块经 src/index.ts 统一导出，README §2.1 有索引行', () => {
  const bar = readFileSync(join(process.cwd(), 'src/index.ts'), 'utf8');
  assert.ok(/export \* from '\.\/render\/flow-legend\.ts'/.test(bar), '新模块须经统一 barrel 导出');
  const readme = readFileSync(join(process.cwd(), 'src/README.md'), 'utf8');
  assert.ok(/src\/render\/flow-legend\.ts/.test(readme), 'README §2.1 须有索引行');
});
