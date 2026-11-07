/**
 * HC-01 · T-137 · 模拟层 edgeCells（S-09 第二批 C 线）验证
 *
 * 覆盖：
 * ① TrafficResult / TickResult.edgeCells 契约：Int32Array、与 flowState / qOverCap 同长、逐边对齐；
 * ② 格索引真实性：来自通勤图块拓扑（R 连通块代表格），不是 qSlot / 循环下标 / 格 0；
 * ③ 哨兵语义：未写入边槽恒为 NO_EDGE_CELL(-1)，诚实不填 0；
 * ④ AC-T8 ④：edgeCells 纯视觉派生，改阈值不改 S/T_c/四因子，且反向毒化 scratch 不改计分链；
 * ⑤ 确定性 + workspace 复用重置（无上一 tick 残留）；
 * ⑥ 生产侧映射生成器 flowEdgesFromTick：过滤哨兵 / 非法 / 越界 / 未知枚举；
 * ⑦ 端到端全链：真实 runTick → flowEdgesFromTick → buildFlowOverlays → buildDrawList。
 *
 * 零依赖：Node 22 --experimental-strip-types + node:test。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createDefaultConfig,
  createInitialState,
  createTickWorkspace,
  createTrafficWorkspace,
  runTick,
  solveTraffic,
  makeCommand,
  cellIndex,
  zoneIndex,
  canonicalize,
  NO_EDGE_CELL,
  buildSemanticTokenMap,
  buildViewModel,
  buildDrawList,
  VIRTUAL_ATLAS_MANIFEST,
  flowEdgesFromTick,
  buildFlowOverlays,
  FLOW_TOKEN_ID,
  type Config,
  type CityState,
} from '../../src/index.ts';

// ---------------------------------------------------------------------------
// 辅助：构造多块城市（2 个 R 块 × 2 个 I 块 → 4 条 R→I 边）
// ---------------------------------------------------------------------------

const SIDE = 16;
const CELL_COUNT = SIDE * SIDE;

function paint(state: CityState, config: Config, x: number, y: number, zone: string, density: number): number {
  const i = cellIndex(state.side, x, y);
  state.cells.zone[i] = zoneIndex(config, zone);
  state.cells.density[i] = density;
  state.cells.unlocked[i] = 1;
  state.cells.inputVersion[i]++;
  return i;
}

/**
 * ROAD 横贯 y=4（分隔上 / 下半区，使 R / I 各自成块）；
 * R 块 2 个：y=5，x=0..2 与 x=4..6（x=3 留空断开）；每格密度 3 → 6 格 population=14.4；
 * I 块 2 个：y=3，x=10..11 与 x=14..15。
 * 返回每个 R 块的代表格（flood fill 最小格索引），作为 edgeCells 的期望真值。
 */
function buildMultiCity(config: Config): { state: CityState; rReps: number[] } {
  const state = createInitialState(config, { side: SIDE });
  for (let x = 0; x < SIDE; x++) paint(state, config, x, 4, 'ROAD', 0);
  const rReps: number[] = [];
  for (const [x0, x1] of [[0, 2], [4, 6]]) {
    let rep = Infinity;
    for (let x = x0; x <= x1; x++) rep = Math.min(rep, paint(state, config, x, 5, 'R', 3));
    rReps.push(rep);
  }
  for (const [x0, x1] of [[10, 11], [14, 15]]) {
    for (let x = x0; x <= x1; x++) paint(state, config, x, 3, 'I', 1);
  }
  return { state, rReps };
}

/** 每个 R 块对每条 I 块各写一条边 → 期望 4 条边，落点按 rb 外层循环分组 */
function expectedEdgeCells(rReps: readonly number[]): number[] {
  const out: number[] = [];
  for (const rep of rReps) out.push(rep, rep);
  return out;
}

// ---------------------------------------------------------------------------
// ① 字段契约 / 逐边对齐
// ---------------------------------------------------------------------------

test('EC-1 TrafficResult.edgeCells：Int32Array、与 qOverCap / flowState 同长、逐边对齐', () => {
  const config = createDefaultConfig();
  const { state } = buildMultiCity(config);
  const ws = createTrafficWorkspace(SIDE, config);
  const r = solveTraffic(state, config, ws);
  assert.ok(r.edgeCells instanceof Int32Array, 'edgeCells 须为 Int32Array');
  assert.equal(r.edgeCells.length, r.qOverCap.length, '与 qOverCap 同长');
  assert.equal(r.edgeCells.length, r.flowState.length, '与 flowState 同长');
  assert.equal(r.edgeCells.length, config.maxBlocks, '长度口径 = maxBlocks（与 qOverCap 一致）');
  // 与 workspace scratch 是同一引用（零热路径分配，不在 solve 内新建数组）
  assert.equal(r.edgeCells, ws.edgeCells, '须复用预分配 scratch，不逐 tick 新建');
});

test('EC-2 TickResult.edgeCells 透传：与 flowState 同长，且就是模拟层产物（非拷贝 / 非捏造）', () => {
  const config = createDefaultConfig();
  const { state } = buildMultiCity(config);
  const ws = createTickWorkspace(config, SIDE);
  const tick = runTick(state, [makeCommand.advance('ec-2', 1)], config, ws);
  assert.ok(tick.edgeCells instanceof Int32Array);
  assert.equal(tick.edgeCells.length, tick.flowState.length, '与 flowState 同长');
  assert.equal(tick.edgeCells, ws.edgeCells, 'out.edgeCells 直接引用 traffic.edgeCells，未复制');
  const direct = solveTraffic(state, config, createTrafficWorkspace(SIDE, config));
  assert.equal(canonicalize(tick.edgeCells), canonicalize(direct.edgeCells), '与直接 solveTraffic 逐字节一致');
});

// ---------------------------------------------------------------------------
// ② 格索引真实性 / ③ 哨兵语义
// ---------------------------------------------------------------------------

test('EC-3 格索引真实：逐边落点 = R 连通块代表格，且不是 qSlot / 循环下标 / 格 0', () => {
  const config = createDefaultConfig();
  const { state, rReps } = buildMultiCity(config);
  const tick = runTick(state, [makeCommand.advance('ec-3', 1)], config, createTickWorkspace(config, SIDE));
  const zR = zoneIndex(config, 'R');
  const written = expectedEdgeCells(rReps);

  assert.deepEqual(Array.from(tick.edgeCells.slice(0, written.length)), written,
    '前 4 个边槽的落点须逐项等于各 R 块代表格（rb 外层 × ib 内层）');
  assert.ok(written.every((c) => c >= 0 && c < CELL_COUNT), '代表格须落在网格内');
  assert.ok(written.every((c) => state.cells.zone[c] === zR), '代表格须是真实 R 分区格（拓扑来源）');
  assert.ok(written.every((c) => c !== 0), '不得拿格 0 冒充落点');

  // 逐边扫描：所有非哨兵值都是合法 R 格，且绝不与其边槽下标相同
  for (let i = 0; i < tick.edgeCells.length; i++) {
    const c = tick.edgeCells[i];
    if (c === NO_EDGE_CELL) continue;
    assert.ok(c >= 0 && c < CELL_COUNT, `边槽 ${i} 落点越界`);
    assert.equal(state.cells.zone[c], zR, `边槽 ${i} 落点不是 R 格`);
    assert.notEqual(c, i, `边槽 ${i} 不得把 qSlot / 循环下标当 cellIndex`);
  }
});

test('EC-4 哨兵语义：未写入边槽恒为 NO_EDGE_CELL(-1)，长度内无 0 占位、无残留', () => {
  assert.equal(NO_EDGE_CELL, -1, '哨兵须显式为 -1（与格 0 严格区分）');
  const config = createDefaultConfig();
  const { state } = buildMultiCity(config);
  const tick = runTick(state, [makeCommand.advance('ec-4', 1)], config, createTickWorkspace(config, SIDE));
  const writtenCount = 4; // 2 R 块 × 2 I 块
  assert.equal(tick.edgeCells.slice(0, writtenCount).every((c) => c >= 0), true, '前 4 槽已写入');
  for (let i = writtenCount; i < tick.edgeCells.length; i++) {
    assert.equal(tick.edgeCells[i], NO_EDGE_CELL, `边槽 ${i} 未写入，须为哨兵 -1`);
  }
  assert.ok(tick.edgeCells.length > writtenCount, 'capacity 应大于实际边数，才能检验哨兵');
  // 与 qOverCap 对齐：未写入边槽 qOverCap=0 → flowState='clear'
  const direct = solveTraffic(state, config, createTrafficWorkspace(SIDE, config));
  for (let i = writtenCount; i < tick.edgeCells.length; i++) {
    assert.equal(direct.qOverCap[i], 0, '未写入边槽无饱和度');
    assert.equal(tick.flowState[i], 'clear', '未写入边槽为 clear（无流量）');
  }
});

test('EC-5 workspace 复用重置：先有边后无边，edgeCells 全为哨兵（无上一 tick 残留）', () => {
  const config = createDefaultConfig();
  const { state } = buildMultiCity(config);
  const ws = createTickWorkspace(config, SIDE);
  runTick(state, [makeCommand.advance('ec-5-a', 1)], config, ws);
  assert.ok(Array.from(ws.edgeCells).some((c) => c >= 0), '首轮确有写入边');

  const empty = createInitialState(config, { side: SIDE }); // 无任何 R / I 分区 → 0 条边
  const tick2 = runTick(empty, [makeCommand.advance('ec-5-b', 2)], config, ws);
  assert.equal(tick2.edgeCells.every((c) => c === NO_EDGE_CELL), true, '次轮全部复位为哨兵，无残留');
});

// ---------------------------------------------------------------------------
// ④ AC-T8 ④：edgeCells 是纯视觉派生量，不进计分链
// ---------------------------------------------------------------------------

test('EC-6 改阈值（AC-T8 ④）：S / T_c / 四因子 / edgeCells 逐字节不变，唯 flowState 变档', () => {
  const cfgA = createDefaultConfig();                                  // θ_clear=0.5 → slow
  const cfgB = createDefaultConfig({ flowClearMaxQOverCap: 0.9, flowSlowMaxQOverCap: 0.95 }); // → clear
  const { state: sA } = buildMultiCity(cfgA);
  const { state: sB } = buildMultiCity(cfgB);
  const rA = runTick(sA, [makeCommand.advance('ec-6', 1)], cfgA, createTickWorkspace(cfgA, SIDE));
  const rB = runTick(sB, [makeCommand.advance('ec-6', 1)], cfgB, createTickWorkspace(cfgB, SIDE));

  for (const key of ['S', 'T_c'] as const) {
    assert.equal(rA.state.frames.current[key], rB.state.frames.current[key], key + ' 不变');
  }
  for (let i = 0; i < 4; i++) {
    assert.equal(rA.state.frames.current.factors[i], rB.state.frames.current.factors[i], `因子 ${i} 不变`);
  }
  assert.equal(canonicalize(rA.edgeCells), canonicalize(rB.edgeCells), 'edgeCells 与阈值无关，逐字节不变');
  assert.notDeepEqual(rA.flowState, rB.flowState, 'flowState 随阈值变档（证明数据链仍生效）');
});

test('EC-7 反向毒化 scratch：预写垃圾 edgeCells 不影响 S / T_c，且 solve 复位为真实落点', () => {
  const config = createDefaultConfig();
  const { state, rReps } = buildMultiCity(config);
  const cleanWs = createTickWorkspace(config, SIDE);
  const poisonWs = createTickWorkspace(config, SIDE);
  poisonWs.edgeCells.fill(12345); // 若计分链读了 edgeCells，S 必然改变
  const clean = runTick(state, [makeCommand.advance('ec-7', 1)], config, cleanWs);
  const poison = runTick(state, [makeCommand.advance('ec-7', 1)], config, poisonWs);

  assert.equal(poison.state.frames.current.S, clean.state.frames.current.S, 'S 不受 edgeCells 影响');
  assert.equal(poison.state.frames.current.T_c, clean.state.frames.current.T_c, 'T_c 不受 edgeCells 影响');
  assert.equal(canonicalize(poison.edgeCells), canonicalize(clean.edgeCells), '毒化被重置，落点一致');
  assert.deepEqual(Array.from(poison.edgeCells.slice(0, 4)), expectedEdgeCells(rReps));
});

test('EC-8 源码静态：edgeCells 只被写入 / 复位，绝不参与计分链累加', () => {
  const src = readFileSync(join(process.cwd(), 'src/simulation/traffic.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const lines = src.split('\n').filter((l) => l.indexOf('edgeCells') >= 0);
  assert.ok(lines.length >= 4, '应存在声明 / 初始化 / 复位 / 写入点');
  for (const l of lines) {
    assert.equal(/\+=|\*=|-=/.test(l), false, 'edgeCells 不得参与任何累加：' + l.trim());
    assert.equal(/weighted|demand|r\.E|r\.T_c|serviceWeighted/.test(l), false,
      'edgeCells 不得流入计分链变量：' + l.trim());
  }
});

// ---------------------------------------------------------------------------
// ⑤ 确定性
// ---------------------------------------------------------------------------

test('EC-9 确定性：同输入两次独立 workspace，edgeCells / flowState / 计分链逐字节一致', () => {
  const config = createDefaultConfig();
  const { state } = buildMultiCity(config);
  const r1 = runTick(state, [makeCommand.advance('ec-9', 1)], config, createTickWorkspace(config, SIDE));
  const r2 = runTick(state, [makeCommand.advance('ec-9', 1)], config, createTickWorkspace(config, SIDE));
  assert.equal(canonicalize(r1.edgeCells), canonicalize(r2.edgeCells), 'edgeCells 逐字节一致');
  assert.equal(canonicalize(r1.flowState), canonicalize(r2.flowState), 'flowState 逐字节一致');
  assert.equal(r1.state.frames.current.S, r2.state.frames.current.S, 'S 逐字节一致');
});

// ---------------------------------------------------------------------------
// ⑥ flowEdgesFromTick：生产侧映射生成器（哨兵 / 非法 / 越界 / 未知枚举过滤）
// ---------------------------------------------------------------------------

test('EC-10 flowEdgesFromTick：按边槽下标配对真实落点，哨兵 / 非法 / 越界 / 未知枚举全过滤', () => {
  const flowState = ['clear', 'slow', 'congested', 'clear', 'clear', 'clear', 'clear'];
  // 槽 1=哨兵 -1、槽 3=负数、槽 4=合法格 1、槽 5=越界(≥cellCount)、槽 6=合法格 0
  const cells = Int32Array.from([80, NO_EDGE_CELL, 84, -7, 1, 999, 0]);
  const edges = flowEdgesFromTick(flowState, cells, CELL_COUNT);
  assert.deepEqual(edges.map((e) => e.edgeIndex), [0, 2, 4, 6], '被跳过的边槽不产出绑定');
  assert.deepEqual(edges.map((e) => e.cellIndex), [80, 84, 1, 0], '格 0 是合法索引须保留，不得与哨兵 -1 混淆');
  assert.equal(Object.isFrozen(edges), true, '输出数组冻结');
  assert.ok(edges.every((e) => Object.isFrozen(e)), '输出元素冻结');
  assert.equal(canonicalize(flowEdgesFromTick(flowState, cells, CELL_COUNT)),
    canonicalize(edges), '同输入同输出');

  // 未知枚举 / NaN / Infinity / 长度不齐 / 全哨兵
  assert.equal(flowEdgesFromTick(['unknown', 'clear'], Int32Array.from([1, 2])).length, 1, '未知枚举跳过');
  assert.equal(flowEdgesFromTick(['clear', 'clear'], new Float64Array([NaN, Infinity])).length, 0, '非整数跳过');
  assert.equal(flowEdgesFromTick(['clear', 'slow'], Int32Array.from([5])).length, 1, '按较短数组截断');
  assert.deepEqual(flowEdgesFromTick(['clear'], Int32Array.from([NO_EDGE_CELL])), [], '全哨兵产出空映射');
  // 未传 cellCount 时不做网格上界过滤（由 buildDrawList 兜底），但哨兵 / 非法仍过滤
  assert.deepEqual(flowEdgesFromTick(['clear'], Int32Array.from([999])).map((e) => e.cellIndex), [999]);
});

// ---------------------------------------------------------------------------
// ⑦ 端到端全链（真实 runTick）
// ---------------------------------------------------------------------------

test('EC-11 端到端全链：真实 runTick → flowEdgesFromTick → buildFlowOverlays → buildDrawList', () => {
  const config = createDefaultConfig();
  const tokens = buildSemanticTokenMap(config.zoneTypes);
  const { state, rReps } = buildMultiCity(config);
  const tick = runTick(state, [makeCommand.advance('ec-11', 1)], config, createTickWorkspace(config, SIDE));
  const expectedCells = expectedEdgeCells(rReps);

  // 1) 映射生成器：只保留 4 条真实边，哨兵（capacity-4 个）全部跳过
  const edges = flowEdgesFromTick(tick.flowState, tick.edgeCells, CELL_COUNT);
  assert.equal(edges.length, expectedCells.length, '哨兵边槽全部被跳过');
  assert.deepEqual(edges.map((e) => e.edgeIndex), [0, 1, 2, 3], 'edgeIndex 保持边槽顺序');
  assert.deepEqual(edges.map((e) => e.cellIndex), expectedCells, 'cellIndex 逐项来自 edgeCells');

  // 2) 叠层：layer=flow、cellIndex 取真实落点、tokenId 正确
  const overlays = buildFlowOverlays(tick.flowState, tokens, edges);
  assert.equal(overlays.length, expectedCells.length);
  for (const spec of overlays) {
    assert.equal(spec.layer, 'flow');
    assert.equal(spec.line, undefined, 'line 交给 deriveLine 推导');
  }
  assert.deepEqual(overlays.map((s) => s.cellIndex), expectedCells);

  // 3) 绘制列表：所有叠层进入，cellIndex 逐项一致（排序后比对，不靠 i 凑数）
  const vm = buildViewModel(tick.state);
  const dl = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, 'L0', { overlays });
  const flows = dl.overlays.filter((o) => o.layer === 'flow');
  assert.equal(flows.length, expectedCells.length, '全部叠层进入绘制列表（落点均合法）');
  assert.deepEqual(flows.map((o) => o.cellIndex).sort((a, b) => a - b),
    [...expectedCells].sort((a, b) => a - b), 'OverlayDraw.cellIndex 与 edgeCells 逐项一致');
  assert.equal(dl.lineEncodedCount, expectedCells.length, 'L0 通勤态全部走线编码');
  assert.equal(dl.shapeSpriteCount, 0, 'L0 不产形状');

  // 4) 三态 tokenId / 线宽：本布局 qoc=0.72 → slow（见 §EC-12 三态扫描）
  const expectedToken = FLOW_TOKEN_ID[tick.flowState[0]];
  for (const o of flows) {
    assert.equal(o.tokenId, expectedToken, 'tokenId 由该边真实 flowState 决定');
    assert.equal(o.group, 'flow');
    assert.ok(o.line !== null && o.line !== undefined, 'L0 须有 deriveLine 线编码');
  }
});

test('EC-12 三态扫描：改 cap 让真实 runTick 分别落入 clear / slow / congested，tokenId 与线宽正确', () => {
  const EXPECTED_LINE: Record<string, { widthScale: number; brightness: number }> = {
    'flow.clear': { widthScale: 1, brightness: 0.6 },
    'flow.slow': { widthScale: 2, brightness: 0.8 },
    'flow.congested': { widthScale: 3, brightness: 1 },
  };
  // 本布局 qTotal=7.2：cap=20→qoc=0.36(clear)、cap=10→0.72(slow)、cap=5→1.44(congested)
  for (const [cap, want] of [[20, 'clear'], [10, 'slow'], [5, 'congested']] as const) {
    const config = createDefaultConfig({ cap });
    const tokens = buildSemanticTokenMap(config.zoneTypes);
    const { state } = buildMultiCity(config);
    const tick = runTick(state, [makeCommand.advance('ec-12-' + cap, 1)], config, createTickWorkspace(config, SIDE));
    assert.equal(tick.flowState[0], want, `cap=${cap} 首边应为 ${want}`);

    const edges = flowEdgesFromTick(tick.flowState, tick.edgeCells, CELL_COUNT);
    const overlays = buildFlowOverlays(tick.flowState, tokens, edges);
    const dl = buildDrawList(buildViewModel(tick.state), VIRTUAL_ATLAS_MANIFEST, 'L0', { overlays });
    const flows = dl.overlays.filter((o) => o.layer === 'flow');
    const tokenId = FLOW_TOKEN_ID[want];
    assert.equal(flows.length, edges.length);
    for (const o of flows) {
      assert.equal(o.tokenId, tokenId, `cap=${cap} tokenId`);
      assert.deepEqual(o.line, EXPECTED_LINE[tokenId], `cap=${cap} deriveLine 线宽/亮度`);
    }
  }
});
