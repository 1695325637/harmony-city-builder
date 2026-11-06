/**
 * HC-01 · S-06 渲染层【第二层 QA / 独立复核】套件（T-119）
 *
 * 目的：不复用 T-118 的用例断言，独立验证其四条验收与四处披露风险声明。
 * 重点（与 engineering-lead 自证用例刻意不重叠的维度）：
 *   QA-R1/R2  changeStamp 契约真值比对：逐 tick 用「序列化快照」做真值，
 *             证明 diff 不漏检（真实变化 ⊆ diff）、无幽灵（diff ⊆ 版本戳变 ∪ 值变），
 *             并动态证明纯 ADVANCE tick 不写任何格（inputVersion 全数组不变）。
 *   QA-R3     全 src/ 写格路径静态审计：除 schema 初始化外，写 cells 数组只允许
 *             tick-pipeline P1 的 zone/density 两处，且同块必须有 inputVersion bump。
 *   QA-R4     渲染层静态重扫（含其 VM-8 禁用清单未覆盖的绕过面：.set/.fill/
 *             Object.assign/动态 import/颜色函数/0x 色值/模板拼色/../simulation）。
 *   QA-R5     预览页诚实文案：横幅「非最终美术 / 未验证」存在，且无「已通过」类断言。
 *   QA-R6     四条验收独立抽样（三档批次集合、未激活分区不预载、格式降级链含 opaque 分支）。
 *   QA-R7     绘制列表与图集清单一致性（atlasId 必须可解析、批次数 = 估算 DrawCall）。
 *   QA-R8     P7 周期解锁不写格（当前范围：仅 unlockedRegions 计数，格解锁留 S-11），
 *             确保「不会出现不 bump 的写路径」这一前提在多次达标周期后仍成立。
 *
 * 纪律：本文件只读 src/ 与 preview/，不写权威状态、不改实现；
 *   失败不删用例；不编造数值；DrawCall 一律「估算」措辞。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  canonicalize,
  createDefaultConfig,
  createInitialState,
  createTickWorkspace,
  makeCommand,
  runTick,
  serializeState,
  zoneIndex,
  buildViewModel,
  diffViewModel,
  buildDrawList,
  VIRTUAL_ATLAS_MANIFEST,
  resolveLoadSet,
  probeTextureFormat,
  probeUiTextureFormat,
  type Command,
  type CityState,
  type LodLevel,
} from '../../src/index.ts';

// ---------------------------------------------------------------------------
// helpers（仅本文件）
// ---------------------------------------------------------------------------

/** 深拷贝序列化快照：runTick 复用 scratch，跨 tick 比较前必须冻结字节 */
function snap(state: CityState): ReturnType<typeof serializeState> {
  return JSON.parse(JSON.stringify(serializeState(state))) as ReturnType<typeof serializeState>;
}

type Snap = ReturnType<typeof snap>;

/** 真值：zone / density / unlocked 发生值变化的格索引（升序） */
function valueChangedIndices(before: Snap, after: Snap): number[] {
  const out: number[] = [];
  const n = after.cells.zone.length;
  for (let i = 0; i < n; i++) {
    if (
      before.cells.zone[i] !== after.cells.zone[i] ||
      before.cells.density[i] !== after.cells.density[i] ||
      before.cells.unlocked[i] !== after.cells.unlocked[i]
    ) {
      out.push(i);
    }
  }
  return out;
}

/** 辅助真值：inputVersion 发生变化的格索引 */
function versionChangedIndices(before: Snap, after: Snap): number[] {
  const out: number[] = [];
  for (let i = 0; i < after.cells.inputVersion.length; i++) {
    if (before.cells.inputVersion[i] !== after.cells.inputVersion[i]) out.push(i);
  }
  return out;
}

/** 去注释（保留字符串字面量，用于颜色 / import 扫描） */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** 去注释 + 去字符串（用于写入路径扫描，避免注释里的「反例写法」误报） */
function stripNonCode(src: string): string {
  let out = stripComments(src);
  out = out.replace(/'(?:\\.|[^'\\\n])*'/g, "''");
  out = out.replace(/"(?:\\.|[^"\\\n])*"/g, '""');
  out = out.replace(/`(?:\\.|[^`\\])*`/g, '``');
  return out;
}

function srcFiles(dir: string): string[] {
  return readdirSync(join(process.cwd(), dir), { recursive: true })
    .map((f) => String(f))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(process.cwd(), dir, f));
}

/** 演示布局：解锁区内铺一些 R/C/I + 一条路（坐标全部 < 16，避开锁定区） */
function paintDemo(state: CityState, config: ReturnType<typeof createDefaultConfig>): void {
  for (let x = 2; x <= 12; x++) state.cells.zone[4 * state.side + x] = zoneIndex(config, 'ROAD');
  const spots: [number, number, string, number][] = [
    [3, 5, 'R', 2],
    [4, 5, 'C', 3],
    [5, 5, 'I', 1],
    [3, 6, 'R', 3],
    [4, 6, 'C', 2],
    [5, 6, 'I', 2],
  ];
  for (const [x, y, z, d] of spots) {
    const i = y * state.side + x;
    state.cells.zone[i] = zoneIndex(config, z);
    state.cells.density[i] = d;
  }
}

// ---------------------------------------------------------------------------
// QA-R1 changeStamp 契约：diff 不漏检、不产生幽灵（真值比对）
// ---------------------------------------------------------------------------

test('QA-R1 diffViewModel 与序列化真值逐 tick 比对：真实变化 ⊆ diff ⊆（版本戳变 ∪ 值变）', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  paintDemo(state, config);
  const ws = createTickWorkspace(config, state.side);
  let cur = state;

  const plan: Command[][] = [
    [makeCommand.zone('r1-z1', 1, 6, 6, 'R', 1), makeCommand.advance('r1-a1', 2)],
    [makeCommand.density('r1-d1', 1, 3, 5, 3), makeCommand.advance('r1-a2', 2)],
    [makeCommand.road('r1-r1', 1, 7, 5), makeCommand.advance('r1-a3', 2)],
    // 同值重写：版本戳 bump 但值不变 → 允许出现在 diff（无幽灵约束用「版本变」放宽）
    [makeCommand.zone('r1-z2', 1, 6, 6, 'R', 1), makeCommand.advance('r1-a4', 2)],
    [makeCommand.advance('r1-a5', 1)],
    [makeCommand.zone('r1-z3', 1, 8, 5, 'C', 2), makeCommand.advance('r1-a6', 2)],
  ];

  for (let t = 0; t < plan.length; t++) {
    const beforeSnap = snap(cur);
    const beforeVM = buildViewModel(cur);
    const r = runTick(cur, plan[t], config, ws);
    const afterVM = buildViewModel(r.state);
    const afterSnap = snap(r.state);
    const diff = diffViewModel(beforeVM, afterVM);

    const valueChanged = valueChangedIndices(beforeSnap, afterSnap);
    const versionChanged = versionChangedIndices(beforeSnap, afterSnap);
    const allowed = new Set<number>([...valueChanged, ...versionChanged]);

    for (const idx of valueChanged) {
      assert.ok(diff.indexOf(idx) >= 0, 'tick ' + (t + 1) + '：真实变化格 ' + idx + ' 必须被 diff 检出（不漏检）');
    }
    for (const idx of diff) {
      assert.ok(allowed.has(idx), 'tick ' + (t + 1) + '：diff 中的格 ' + idx + ' 必须有版本戳变或值变（无幽灵）');
    }
    // 真值集合非空性抽检：前三个 tick 均应有实际变化
    if (t < 3) assert.ok(valueChanged.length >= 1, 'tick ' + (t + 1) + ' 真值应含实际变化');
    cur = r.state;
  }
});

test('QA-R2 纯 ADVANCE tick 不写任何格：inputVersion 全数组逐字节不变 + diff 为空', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  paintDemo(state, config);
  const ws = createTickWorkspace(config, state.side);
  let cur = state;

  for (let t = 1; t <= 8; t++) {
    const beforeSnap = snap(cur);
    const beforeVM = buildViewModel(cur);
    const r = runTick(cur, [makeCommand.advance('r2-a' + t, 1)], config, ws);
    const afterSnap = snap(r.state);
    assert.deepEqual(
      Array.from(afterSnap.cells.inputVersion),
      Array.from(beforeSnap.cells.inputVersion),
      'tick ' + t + '：无 P1 写格时 inputVersion 不得被任何阶段（P2~P8）改写',
    );
    assert.deepEqual(valueChangedIndices(beforeSnap, afterSnap), [], 'tick ' + t + '：无命令时无格变化');
    assert.deepEqual(diffViewModel(beforeVM, buildViewModel(r.state)), [], 'tick ' + t + '：diff 必须为空');
    cur = r.state;
  }
});

// ---------------------------------------------------------------------------
// QA-R3 全 src/ 写格路径静态审计（契约的静态前提）
// ---------------------------------------------------------------------------

test('QA-R3 全 src/ 写 cells 数组仅 schema 初始化 + tick-pipeline P1 两处，且 P1 同块必 bump', () => {
  const files = srcFiles('src');
  const writeRe = /cells\.(zone|density|unlocked|region)\s*\[[^\]]*\]\s*=(?!=)/g;
  const hits: { file: string; field: string }[] = [];
  for (const file of files) {
    const code = stripNonCode(readFileSync(file, 'utf8'));
    let m: RegExpExecArray | null;
    while ((m = writeRe.exec(code)) !== null) {
      hits.push({ file: file.replace(process.cwd(), '').replace(/\\/g, '/'), field: m[1] });
    }
  }
  const byFile = new Map<string, string[]>();
  for (const h of hits) {
    const list = byFile.get(h.file) ?? [];
    list.push(h.field);
    byFile.set(h.file, list);
  }
  // schema.ts 仅为 createInitialState 的 4 处初始化（unlocked/region/zone/density）
  assert.deepEqual(byFile.get('/src/core/schema.ts'), ['unlocked', 'region', 'zone', 'density'], '初始化写入仅 4 处');
  // tick-pipeline.ts 仅 P1 的 zone/density 两处
  assert.deepEqual(byFile.get('/src/simulation/tick-pipeline.ts'), ['zone', 'density'], '结算链仅 P1 写值，不得有 P7 解锁写格等未 bump 路径');
  assert.equal(hits.length, 6, '全库写格语句共 6 条（4 初始化 + 2 P1），新增写路径必须同步审计');

  // P1 断言块必须无条件 bump：zone/density 写入后同段出现 inputVersion++
  const pipe = stripNonCode(readFileSync(join(process.cwd(), 'src/simulation/tick-pipeline.ts'), 'utf8'));
  assert.equal((pipe.match(/cells\.inputVersion\[[^\]]*\]\+\+/g) ?? []).length, 1, 'P1 恰有一处 bump');
  const bumpIdx = pipe.search(/cells\.inputVersion\[/);
  const zoneIdx = pipe.search(/cells\.zone\[/);
  const densIdx = pipe.search(/cells\.density\[/);
  assert.ok(bumpIdx > zoneIdx && bumpIdx > densIdx, 'bump 紧随 zone/density 写入（同块、无分支跳过）');
  assert.ok(bumpIdx - densIdx < 200, 'bump 与写入距离很短（避免被条件分支隔开）');
});

// ---------------------------------------------------------------------------
// QA-R4 渲染层静态重扫（覆盖其禁用清单未覆盖的绕过面）
// ---------------------------------------------------------------------------

test('QA-R4 渲染层静态重扫：写入 / 颜色 / 引擎 / 时钟 / 分层，含 .set .fill Object.assign 动态 import 绕过面', () => {
  const files = srcFiles('src/render');
  assert.ok(files.length >= 8, '扫描到 render 源文件（实际 ' + files.length + '）');

  const writeBanned: { name: string; re: RegExp }[] = [
    { name: '写 cells 数组（下标）', re: /cells\.(zone|density|unlocked|region|inputVersion)\s*\[[^\]]*\]\s*=(?!=)/ },
    { name: '写 cells 数组（.set / .fill）', re: /cells\.(zone|density|unlocked|region|inputVersion)\s*\.\s*(set|fill)\s*\(/ },
    { name: '写 state（标量 / budget / frames）', re: /state\s*\.\s*(tickId|cycleId|cycleTickIndex|issueCount|unlockedRegions|side|seed|configHash|budget|frames)\s*(\.\w+\s*)?=(?!=)/ },
    { name: 'Object.assign 写 state / cells', re: /Object\.assign\s*\(\s*(state|cells)/ },
    { name: '整体替换 state 引用', re: /\bstate\s*=(?!=)/ },
  ];
  const runtimeBanned: { name: string; re: RegExp }[] = [
    { name: "静态 import 'cc' / '@ohos'", re: /^[ \t]*import[^\n]*from[ \t]*['"](?:cc|@ohos|@harmony)[^'"]*['"]/m },
    { name: '动态 import / require 引擎', re: /(?:import|require)\s*\(\s*['"](?:cc|@ohos|@harmony)[^'"]*['"]\s*\)/ },
    { name: '墙上时钟 / 性能计时', re: /Date\.now|performance\.now|process\.hrtime/ },
    { name: '原生随机', re: /Math\.random/ },
    { name: '越层依赖 simulation', re: /from\s+['"][^'"]*\/simulation\// },
  ];

  for (const file of files) {
    const strict = stripNonCode(readFileSync(file, 'utf8'));
    const relaxed = stripComments(readFileSync(file, 'utf8'));
    const short = file.replace(process.cwd(), '').replace(/\\/g, '/');
    for (const b of writeBanned) assert.equal(b.re.test(strict), false, short + ' 命中禁令：' + b.name);
    for (const b of runtimeBanned) assert.equal(b.re.test(strict), false, short + ' 命中禁令：' + b.name);

    // 颜色：hex / 0x 色值 / 颜色函数 / 模板拼色 —— 只允许 semantic-tokens.ts
    if (!file.endsWith('semantic-tokens.ts')) {
      assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(relaxed), false, short + ' 出现 hex 字面量（色值须经语义令牌）');
      assert.equal(/0x[0-9a-fA-F]{6,8}\b/.test(relaxed), false, short + ' 出现 0x 色值');
      assert.equal(/\b(?:rgba?|hsla?)\s*\(/.test(relaxed), false, short + ' 出现颜色函数（色值须经语义令牌）');
      assert.equal(/['"`]\s*#\s*['"`]\s*\+|\+\s*['"`]#/.test(relaxed), false, short + ' 出现「#」拼接拼色');
    }
  }
  // 反向确认：tokens 文件确实含 hex（证明扫描不是空转）
  const tokens = readFileSync(join(process.cwd(), 'src/render/semantic-tokens.ts'), 'utf8');
  assert.ok((tokens.match(/#[0-9a-fA-F]{6}\b/g) ?? []).length >= 20, 'tokens 内含足量 hex 令牌');
});

// ---------------------------------------------------------------------------
// QA-R5 预览页诚实文案（未验证边界不得混入 PASS）
// ---------------------------------------------------------------------------

test('QA-R5 预览页横幅含「非最终美术 / 未验证 / 占位」且无「已通过」类断言', () => {
  const html = readFileSync(join(process.cwd(), 'preview/index.html'), 'utf8');
  assert.ok(html.includes('非最终美术'), '横幅须声明非最终美术');
  assert.ok(html.includes('Cocos 适配未验证'), '横幅须声明 Cocos 适配未验证');
  assert.ok(html.includes('程序化占位'), '横幅须声明绘制数据为程序化占位');
  assert.equal(/已通过|全部验证|已实测|验收通过/.test(html), false, '预览页不得出现「已通过 / 已实测」类断言');
});

// ---------------------------------------------------------------------------
// QA-R6 四条验收独立抽样（不复用其用例断言）
// ---------------------------------------------------------------------------

test('QA-R6a 验收①抽样：L0/L1/L2 批次集合逐项相同、逐 sprite 图集归属一致（无跨图集抖动）', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  paintDemo(state, config);
  const vm = buildViewModel(state);
  const lods: LodLevel[] = ['L0', 'L1', 'L2'];
  const lists = lods.map((lod) => buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, lod));

  const batchIds = lists.map((l) => l.batches.map((b) => b.atlasId).sort().join('|'));
  assert.equal(new Set(batchIds).size, 1, '三档批次集合必须完全相同（实测：' + batchIds.join(' vs ') + '）');
  // 逐 sprite：同（cellIndex, kind）三档 atlasId 相同
  const keyOf = (s: { gx: number; gy: number; kind: string }) => s.gx + ',' + s.gy + ',' + s.kind;
  const maps = lists.map((l) => {
    const m = new Map<string, string>();
    for (const s of l.sprites) m.set(keyOf(s), s.atlasId);
    return m;
  });
  for (const [k, atlas] of maps[1]) {
    assert.equal(maps[0].get(k), atlas, 'L0/L1 同 sprite 图集一致：' + k);
    assert.equal(maps[2].get(k), atlas, 'L1/L2 同 sprite 图集一致：' + k);
  }
  assert.ok(lists[0].spriteCount > 0, '演示布局应产出非空绘制列表');
});

test('QA-R6b 验收④抽样：激活集仅 R 时，C/I/公共服务 建筑包不在 resident / onDemand', () => {
  const lods: LodLevel[] = ['L0', 'L1', 'L2'];
  for (const lod of lods) {
    const set = resolveLoadSet(['R'], lod, VIRTUAL_ATLAS_MANIFEST);
    const loaded = [...set.resident, ...set.onDemand];
    for (const forbidden of ['建筑-商业', '建筑-产业', '建筑-公共服务']) {
      assert.equal(loaded.indexOf(forbidden) >= 0, false, lod + '：未激活分区包 ' + forbidden + ' 不得预载');
      assert.ok(set.excluded.indexOf(forbidden) >= 0, lod + '：' + forbidden + ' 应被显式排除');
    }
    assert.ok(loaded.indexOf('建筑-居住') >= 0, lod + '：激活分区包 建筑-居住 应在加载集');
  }
});

test('QA-R6c 验收③抽样：ASTC→ETC2→RGB565→NONE 降级链 + 透明底跳过 RGB565 + UI 固定 RGBA8888', () => {
  assert.equal(probeTextureFormat({ astc: true, etc2: true, rgb565: true }).chosen, 'ASTC');
  assert.equal(probeTextureFormat({ astc: true, etc2: true, rgb565: true }).degraded, false);
  const e = probeTextureFormat({ astc: false, etc2: true, rgb565: true });
  assert.equal(e.chosen, 'ETC2');
  assert.equal(e.degraded, true, '回退必须标记 degraded');
  assert.equal(probeTextureFormat({ astc: false, etc2: false, rgb565: true }, true).chosen, 'RGB565');
  assert.equal(probeTextureFormat({ astc: false, etc2: false, rgb565: true }, false).chosen, 'NONE', '透明底不得掉到 RGB565');
  const none = probeTextureFormat({ astc: false, etc2: false, rgb565: false });
  assert.equal(none.chosen, 'NONE');
  assert.equal(none.degraded, true);
  assert.equal(probeUiTextureFormat({ astc: true, etc2: true, rgb565: true }).chosen, 'RGBA8888', 'UI 图集不参与压缩降级');
});

// ---------------------------------------------------------------------------
// QA-R7 绘制列表与图集清单一致性
// ---------------------------------------------------------------------------

test('QA-R7 绘制列表一致性：atlasId 全部可解析、批次数 = 估算 DrawCall、缺帧如实计数', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  paintDemo(state, config);
  const list = buildDrawList(buildViewModel(state), VIRTUAL_ATLAS_MANIFEST, 'L1');
  const atlasIds = new Set(VIRTUAL_ATLAS_MANIFEST.map((e) => e.atlasId));
  for (const s of list.sprites) assert.ok(atlasIds.has(s.atlasId), 'sprite atlasId 必须存在于清单：' + s.atlasId);
  assert.equal(list.estimatedDrawCalls, list.batches.length, '估算 DrawCall = 批次数（估算口径，非实测）');
  assert.equal(
    list.batches.reduce((n, b) => n + b.sprites.length, 0),
    list.spriteCount,
    '批次覆盖全部 sprite（无静默丢批）',
  );
  assert.ok(Number.isFinite(list.skipped) && list.skipped >= 0, '缺帧计数为有限非负数');
  assert.ok(list.estimatedDrawCalls <= 30, 'L1 演示布局估算值应远低于建议基线上限（记录用，非门禁）');
});

// ---------------------------------------------------------------------------
// QA-R8 多次达标周期后仍无「不 bump 的写格路径」
// ---------------------------------------------------------------------------

test('QA-R8 周期达标（含解锁）不写格：unlockedRegions 递增但 cells.unlocked/region 逐字节不变', () => {
  const config = createDefaultConfig({ K: 2, S_unlock: 0 }); // 达标即解锁，最多路径覆盖
  const state = createInitialState(config);
  paintDemo(state, config);
  const ws = createTickWorkspace(config, state.side);
  const before = snap(state);
  let cur = state;
  let unlockCount = 0;
  for (let t = 1; t <= 6; t++) {
    const prevVM = buildViewModel(cur);
    const beforeTick = snap(cur);
    const r = runTick(cur, [makeCommand.advance('r8-a' + t, 1)], config, ws);
    const afterTick = snap(r.state);
    if (afterTick.unlockedRegions > beforeTick.unlockedRegions) unlockCount++;
    assert.deepEqual(
      afterTick.cells.unlocked,
      beforeTick.cells.unlocked,
      'tick ' + t + '：当前实现解锁只递增 unlockedRegions 计数，不得写 cells.unlocked（若将来实现解锁，必须同步 bump 版本戳）',
    );
    assert.deepEqual(afterTick.cells.region, beforeTick.cells.region, 'tick ' + t + '：region 不得被结算写');
    assert.deepEqual(diffViewModel(prevVM, buildViewModel(r.state)), [], 'tick ' + t + '：无格变化时 diff 必须为空');
    cur = r.state;
  }
  assert.ok(unlockCount >= 3, '6 tick / K=2 应至少 3 次周期达标解锁（实际 ' + unlockCount + '）');
  assert.ok(cur.unlockedRegions > before.unlockedRegions, 'unlockedRegions 计数确实递增');
  // 全量指纹比对：cells 全字段未变（只允许 unlockedRegions 等标量变化）
  const after = snap(cur);
  assert.deepEqual(after.cells, before.cells, '6 tick 后 cells 全字段逐字节不变');
  // 对照：标量确实变了，保证本用例不是空转
  assert.notEqual(after.unlockedRegions, before.unlockedRegions);
  assert.notEqual(canonicalize(cur), canonicalize(state), '会话状态整体确实推进（控制组）');
});
