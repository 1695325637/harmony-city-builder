/**
 * HC-01 · W1~W2 纯逻辑层【第二层 QA / fresh eyes】独立边缘验证套件（T-114）
 *
 * 【T-116 修订留痕（engineering-lead，主理人授权「只写 src/ 与 tests/」）】：
 *   D-01 已修复（src/core/schema.ts deserializeState + src/simulation/session.ts
 *   createSimulation 挂接 assertConfigCompatible），V-06 由「记录契约缺口」改写为
 *   「验证修复后契约」、V-STATIC 的调用点计数断言由 occ>=1 收紧为 occ>=3；
 *   其余 11 条用例（V-00~V-05 / V-07~V-10）的断言逻辑未改。原始版本与首次运行
 *   输出见 tests/verification/w1-w2-verification.md（T-114 / T-115，v1.1）。
 *
 * 纪律：
 * - 本文件只读 src/，不修改 src/、tests/unit/ 或 tests/ 下既有 9 份 QA 文档。
 * - 不替实现修 bug；发现的行为一律如实断言 / 如实记录（失败不删用例）。
 * - 平衡期数值（K / S_unlock / T_max / i_ref / w_i ...）仍是占位；下方出现的
 *   极端值只用于「健壮性探测」，不代表任何平衡结论，也不作为定稿判据。
 * - GDD 01 §3.2 与 §4.3 的 ΔS 双重定义、以及 E1 冷启动首 tick S_t 口径，
 *   已由 T-113（design-strategist）裁定关闭、主理人中转【选 A / 确认实现】：
 *     ① 共享符号 ΔS 收敛为「归因分解量」Snapshot.dS；
 *     ② S 的绝对变化由 tick 的 Delta 条目「S: prev → current」承载，
 *        GDD 用局部记号 ΔS_abs 指代，刻意不新增共享符号、不改只读的
 *        systems-index.md §4.2；
 *     ③ AC-F2 的 abs(...) ≤ 1 分只约束分解式内部，不要求 ΔS = S_t − S_{t−1}；
 *     ④ 首 tick S_t 照公式计算、ΔS=0 / 仅教学占位，为裁定 2 确认的预期行为；
 *     ⑤ 新增下游约束：abs(ΔS_abs − ΔS) > 1 时 05 / UX 须披露耦合项（S-05 / S-09）。
 *   本套件按终态标注「口径已裁定（选 A / 确认实现）」，不据此判实现 FAIL，
 *   也不调整任何占位参数。
 *
 * 运行（工作区根目录）：
 *   node --experimental-strip-types --test tests/verification/edge-cases.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  MAX_GRID_SIDE,
  SCHEMA_VERSION,
  ENGINE_VERSION,
  PIPELINE_STAGES,
  RULE_TO_STAGE,
  GridLimitExceededError,
  ConfigMismatchError,
  canonicalize,
  PLACEHOLDER_DEFAULTS,
  createDefaultConfig,
  computeConfigHash,
  computeBaselineS,
  createDefaultAggregator,
  assertConfigCompatible,
  clamp,
  createInitialState,
  serializeState,
  deserializeState,
  cellIndex,
  zoneIndex,
  makeCommand,
  createCommandQueue,
  createSimulation,
  createTickWorkspace,
  createTrafficWorkspace,
  solveTraffic,
  runTick,
  advanceRenderFrames,
  NOOP_ATTRIBUTION_RECORDER,
} from '../../src/index.ts';

// ---------------------------------------------------------------------------
// 通用辅助
// ---------------------------------------------------------------------------

/** 直接写权威 Cell 状态（绕过命令合法性校验，用于构造极端网格） */
function paint(state, config, x, y, zone, density = 1) {
  const i = cellIndex(state.side, x, y);
  state.cells.zone[i] = zoneIndex(config, zone);
  state.cells.density[i] = density;
  state.cells.unlocked[i] = 1;
}

/** runTick 复用 ws.out / ws.stages / ws.attribution 等池对象，跨 tick 比较前必须深拷贝 */
function snapTick(r) {
  return JSON.parse(JSON.stringify({
    tickId: r.tickId,
    state: serializeState(r.state),
    delta: r.delta.map((d) => ({ ...d })),
    attribution: r.attribution.map((a) => ({ ...a })),
    events: r.events.map((e) => ({ ...e })),
    stages: r.stages.map((s) => ({ ...s })),
    commandTrace: [...r.commandTrace],
    cycleOutcome: r.cycleOutcome,
    p4Satisfaction: r.p4Satisfaction,
  }));
}

/** 健壮性不变量：无 NaN / Infinity，S ∈ [0,100]，账目有限 */
function assertHealthy(r, label) {
  const c = r.state.frames.current;
  assert.ok(Number.isFinite(c.S), `${label}: S 有限`);
  assert.ok(c.S >= 0 && c.S <= 100, `${label}: S ∈ [0,100]`);
  for (const v of c.factors) assert.ok(Number.isFinite(v), `${label}: factors 有限`);
  for (const v of c.dSByFactor) assert.ok(Number.isFinite(v), `${label}: dSByFactor 有限`);
  assert.ok(Number.isFinite(c.dS), `${label}: dS 有限`);
  assert.ok(Number.isFinite(c.dSPenalty), `${label}: dSPenalty 有限`);
  assert.ok(Number.isFinite(c.L), `${label}: L 有限`);
  assert.ok(Number.isFinite(c.T_c), `${label}: T_c 有限`);
  assert.ok(Number.isFinite(c.E), `${label}: E 有限`);
  assert.ok(Number.isFinite(c.I_f), `${label}: I_f 有限`);
  assert.ok(Number.isFinite(r.state.budget.B), `${label}: B 有限`);
  assert.ok(Number.isFinite(r.state.budget.I_t), `${label}: I_t 有限`);
  for (const d of r.delta) assert.ok(Number.isFinite(d.delta), `${label}: delta 有限`);
  for (const a of r.attribution) assert.ok(Number.isFinite(a.dS_i), `${label}: 归因 dS_i 有限`);
}

/** 去掉注释与字符串字面量，只留可执行代码，避免中文注释 / 版本号造成静态扫描误报 */
function stripNonCode(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

function allTsFiles() {
  const core = readdirSync(join(process.cwd(), 'src/core'))
    .filter((f) => f.endsWith('.ts')).map((f) => join('src/core', f));
  const sim = readdirSync(join(process.cwd(), 'src/simulation'))
    .filter((f) => f.endsWith('.ts')).map((f) => join('src/simulation', f));
  return [...core, ...sim, 'src/index.ts'].sort();
}

function removePlaceholderBlock(src) {
  const start = src.indexOf('export const PLACEHOLDER_DEFAULTS');
  if (start < 0) return src;
  const end = src.indexOf('\n};', start);
  return src.slice(0, start) + ' /* PLACEHOLDER_DEFAULTS_BLOCK_REMOVED */ ' + src.slice(end + 3);
}

// ---------------------------------------------------------------------------
// V-00 运行证据
// ---------------------------------------------------------------------------

test('V-00 运行环境与基线事实（独立取证）', () => {
  console.log(`[V-00] node=${process.version} platform=${process.platform} arch=${process.arch} cwd=${process.cwd()}`);
  console.log(`[V-00] SCHEMA_VERSION=${SCHEMA_VERSION} ENGINE_VERSION=${ENGINE_VERSION} MAX_GRID_SIDE=${MAX_GRID_SIDE}`);
  assert.equal(typeof process.version, 'string');
  assert.equal(PIPELINE_STAGES.length, 9);
  assert.equal(Object.keys(RULE_TO_STAGE).length, 7);
  assert.equal(PLACEHOLDER_DEFAULTS.meta.kind, 'PLACEHOLDER');
  assert.equal(PLACEHOLDER_DEFAULTS.meta.pinnedAt, null);
});

// ---------------------------------------------------------------------------
// ① 冷启动首 tick → 第 2 tick 的归因链衔接与 ΔS / ΔS_abs 口径（T-113 已裁定·选 A）
// ---------------------------------------------------------------------------

test('V-01 冷启动首 tick → 第 2 tick：帧衔接、教学归因、ΔS(分解量) 与 ΔS_abs 如实记录', () => {
  const config = createDefaultConfig({ K: 3 });
  const s0 = createInitialState(config);
  const ws = createTickWorkspace(config, s0.side);
  const baselineS = computeBaselineS(config);

  const r1 = runTick(s0, [makeCommand.advance('v1', 1)], config, ws);
  // r1 的池对象 / stateScratch 会被下一次 runTick 复用，必须先取快照
  const c1 = {
    S: r1.state.frames.current.S,
    factors: Array.from(r1.state.frames.current.factors),
    L: r1.state.frames.current.L,
    dS: r1.state.frames.current.dS,
    dSByFactor: Array.from(r1.state.frames.current.dSByFactor),
    dSPenalty: r1.state.frames.current.dSPenalty,
  };
  const prevS1 = r1.state.frames.prev.S;
  const delta1 = r1.delta.map((d) => ({ ...d }));
  const attr1 = r1.attribution.map((a) => ({ ...a }));
  const trace1 = [...r1.commandTrace];

  // GDD 01 E1：首 tick ΔS=0 / 无归因型条目 / 仅教学占位
  assert.equal(c1.dS, 0, '首 tick ΔS=0');
  assert.equal(c1.dSPenalty, 0);
  for (const v of c1.dSByFactor) assert.equal(v, 0);
  assert.equal(attr1.length, 1);
  assert.equal(attr1[0].causeType, '教学');
  assert.equal(attr1[0].dS_i, 0);
  assert.equal(r1.tickId, 1);
  assert.deepEqual(trace1, ['v1']);

  // 【口径已裁定·选 A】共享符号 ΔS = 分解量 Snapshot.dS；
  // S 的绝对变化用局部记号 ΔS_abs，由 tick 的 Delta 条目「S: prev → current」承载。
  const sDelta = delta1.find((d) => d.key === 'S');
  assert.ok(sDelta);
  const absDelta = c1.S - prevS1; // = ΔS_abs
  assert.ok(Math.abs(sDelta.delta - absDelta) < 1e-9);

  // 首 tick 强制 ΔS=0 是裁定 2 确认的预期教学占位，不是归因失真；
  // AC-F2 的 abs(...) ≤ 1 分只约束分解式内部，不要求 ΔS = ΔS_abs。
  const residual = Math.abs(absDelta - c1.dS);
  console.log(`[V-01] S_init(baseline)=${baselineS} 首tick S_t=${c1.S} prev.S=${prevS1} ΔS_abs=${absDelta} ΔS(分解量)=${c1.dS} abs(ΔS_abs−ΔS)=${residual} （口径已裁定·选A：首tick ΔS=0 为预期教学占位，非归因失真）`);
  console.log(`[V-01] 首tick S_t 是否等于 S_init: ${c1.S === baselineS} （裁定 2：首tick S_t 照公式计算，不钉在 S_init）`);
  assert.ok(Number.isFinite(residual));

  // 第 2 tick：P0 帧推进使 prev 恰为首 tick 的 current
  const s1 = r1.state; // = ws.stateScratch；直接改权威 Cell 再结算，仍走完整 P0~P8
  paint(s1, config, 2, 2, 'R', 1);
  paint(s1, config, 8, 2, 'I', 1);
  paint(s1, config, 2, 5, 'C', 1);
  for (let x = 2; x <= 8; x++) paint(s1, config, x, 3, 'ROAD');
  paint(s1, config, 2, 4, 'ROAD');
  const r2 = runTick(s1, [makeCommand.advance('v2', 2)], config, ws);
  const p2 = r2.state.frames.prev;
  assert.equal(p2.S, c1.S, 'P0 帧推进：prev.S = 上 tick current.S');
  for (let i = 0; i < 4; i++) assert.equal(p2.factors[i], c1.factors[i], `prev.factors[${i}] 衔接`);
  assert.equal(p2.L, c1.L);

  // 第 2 tick 起按 GDD 01 §4.3 出归因：分解式自洽（clamp 后）
  const c2 = r2.state.frames.current;
  let sum = 0;
  for (const v of c2.dSByFactor) sum += v;
  sum += c2.dSPenalty;
  assert.equal(c2.dS, clamp(sum, -100, 100), '§4.3 分解式与 dS 自洽');
  assert.notEqual(c2.dS, 0, '第 2 tick 网格已变化，应产生非零 ΔS');
  assert.ok(r2.attribution.length >= 1);
  assert.ok(r2.attribution.some((a) => a.causeType !== '教学'), '非首 tick 应出现归因型条目');
  const residual2 = Math.abs((c2.S - c1.S) - c2.dS);
  // 裁定 1 推导：ΔS_abs − ΔS = 100·ΔM·ΔP，其中 M_t=Σ w_i g(f_i,t)、P_t=1−λ L_t。
  // 本场景首 tick 与第 2 tick 的 L 均为 1（min factor 恒为 0）→ ΔP=0 → 耦合项为 0，
  // 故实测残差≈1e-14；与设计侧「占位参数试算≈+2.07 分」不矛盾（后者对应 L 跨帧变化）。
  console.log(`[V-01] 第2tick S_t=${c2.S} ΔS_abs=${c2.S - c1.S} ΔS(分解量)=${c2.dS} abs(ΔS_abs−ΔS)=${residual2} （口径已裁定·选A：耦合项 100·ΔM·ΔP；本场景 ΔP=0）`);
  assertHealthy(r2, 'V-01 第2tick');
});

// ---------------------------------------------------------------------------
// ② 32×32 满网格触达 maxBlocks=64 上限时的块合并 / 截断行为
// ---------------------------------------------------------------------------

test('V-02 32×32 满网格触达 maxBlocks=64：块数截断为静默丢弃（无告警 / 无事件）', () => {
  const config = createDefaultConfig(); // maxBlocks = 64（占位默认值）
  const state = createInitialState(config);

  // 棋盘交错：每个 R 格互不 4-邻接 → 512 个独立连通块，远超 64
  let painted = 0;
  for (let y = 0; y < state.side; y++) {
    for (let x = 0; x < state.side; x++) {
      if ((x + y) % 2 === 0) { paint(state, config, x, y, 'R', 1); painted++; }
    }
  }
  const ws = createTrafficWorkspace(state.side, config);
  const r = solveTraffic(state, config, ws);
  const unit = config.p_unit * config.densityCoefficients[0];
  const expectedFull = painted * unit;

  console.log(`[V-02] 32×32 棋盘 R 格数=${painted} maxBlocks=${config.maxBlocks} 实际块数=${r.blocks} population=${r.population} 全量应为=${expectedFull} T_c=${r.T_c} unreachable=${r.unreachable}`);
  assert.equal(r.blocks, config.maxBlocks, '块数被截到 maxBlocks 上限');
  assert.equal(r.population, config.maxBlocks * unit, '仅前 64 个块计入人口');
  assert.ok(r.population < expectedFull, '超限块被静默丢弃 → 人口被低估');
  assert.equal(r.unreachable, false, '截断不置 unreachable 标记');
  assert.ok(Number.isFinite(r.T_c) && Number.isFinite(r.E));

  // runTick 全程仍健壮，且事件集合里没有任何「超限 / 丢弃」告警类型
  const rt = runTick(state, [makeCommand.advance('a1', 1)], config, createTickWorkspace(config, state.side));
  assertHealthy(rt, 'V-02 满网格');
  const eventTypes = [...new Set(rt.events.map((e) => e.type))];
  console.log(`[V-02] runTick 事件类型集合=${eventTypes.join(',')} （SimEventType 无「块数超限」告警类型）`);
  assert.ok(!eventTypes.some((t) => /WARN|LIMIT|DROP|TRUNC/i.test(t)));

  // 更小的 maxBlocks 同样截断（可配置）
  const cfg4 = createDefaultConfig({ maxBlocks: 4 });
  const st4 = createInitialState(cfg4);
  for (let y = 0; y < st4.side; y++) for (let x = 0; x < st4.side; x++) {
    if ((x + y) % 2 === 0) paint(st4, cfg4, x, y, 'R', 1);
  }
  const r4 = solveTraffic(st4, cfg4, createTrafficWorkspace(st4.side, cfg4));
  assert.equal(r4.blocks, 4);
  assert.equal(r4.population, 4 * unit);
  console.log(`[V-02] maxBlocks=4 → 块数=${r4.blocks} population=${r4.population}（截断行为可配置复现）`);

  // 对照组：全 1024 格连成 1 个块 → 不截断，人口全量计入（截断按「块数」而非「格数」）
  const stFull = createInitialState(config);
  for (let y = 0; y < stFull.side; y++) for (let x = 0; x < stFull.side; x++) {
    paint(stFull, config, x, y, 'R', 1);
  }
  const rFull = solveTraffic(stFull, config, createTrafficWorkspace(stFull.side, config));
  assert.equal(rFull.blocks, 1);
  assert.equal(rFull.population, MAX_GRID_SIDE * MAX_GRID_SIDE * unit);
  console.log(`[V-02] 单片连通：块数=${rFull.blocks} population=${rFull.population}（未截断）`);

  // 静态事实：types.ts 定义的结构性常量 MAX_BLOCKS 在 traffic.ts 中未被引用，
  // 实际生效的是 config.maxBlocks（占位默认值 64）
  assert.equal(config.maxBlocks, 64);
});

// ---------------------------------------------------------------------------
// ③ 路网断开 → 重连的「不可达 ↔ 可达」切换与 D2 拥堵负反馈传导
// ---------------------------------------------------------------------------

function buildNetwork(config, opts = {}) {
  const s = createInitialState(config);
  paint(s, config, 2, 2, 'R', 1);
  if (opts.extraR) for (let x = 3; x <= 5; x++) paint(s, config, x, 2, 'R', 1);
  paint(s, config, 8, 2, 'I', 1);
  paint(s, config, 2, 5, 'C', 1);
  for (let x = 2; x <= 8; x++) {
    if (opts.gapAt !== undefined && x === opts.gapAt) continue;
    paint(s, config, x, 3, 'ROAD');
  }
  paint(s, config, 2, 4, 'ROAD'); // 让 C 块接入 ROAD 图，使 f_s 可观测
  return s;
}

test('V-03 路网断开→重连：不可达↔可达切换、T_c 回落、D2 拥堵负反馈传导到 S', () => {
  const config = createDefaultConfig({ K: 10 });
  const A = buildNetwork(config);              // 连通
  const B = buildNetwork(config, { gapAt: 5 }); // 断开 (5,3)
  const C = buildNetwork(config);              // 重连（与 A 同布局）
  const D = buildNetwork(config, { extraR: true }); // 连通 + 更高 OD 需求

  const tA = solveTraffic(A, config, createTrafficWorkspace(A.side, config));
  const tAsnap = { T_c: tA.T_c, unreachable: tA.unreachable, E: tA.E, blocks: tA.blocks, population: tA.population, swa: tA.serviceWeightedAccess, swt: tA.serviceWeightTotal };
  const tB = solveTraffic(B, config, createTrafficWorkspace(B.side, config));
  const tBsnap = { T_c: tB.T_c, unreachable: tB.unreachable };
  const tC = solveTraffic(C, config, createTrafficWorkspace(C.side, config));
  const tCsnap = { T_c: tC.T_c, unreachable: tC.unreachable };
  const tD = solveTraffic(D, config, createTrafficWorkspace(D.side, config));
  const tDsnap = { T_c: tD.T_c, unreachable: tD.unreachable, population: tD.population };

  console.log(`[V-03] 连通A: T_c=${tAsnap.T_c} unreachable=${tAsnap.unreachable} P=${tAsnap.population} | 断开B: T_c=${tBsnap.T_c} unreachable=${tBsnap.unreachable} | 重连C: T_c=${tCsnap.T_c} unreachable=${tCsnap.unreachable} | 高需求D: T_c=${tDsnap.T_c} P=${tDsnap.population}`);
  assert.equal(tAsnap.unreachable, false);
  assert.equal(tBsnap.unreachable, true, '断开 → 不可达');
  assert.equal(tBsnap.T_c, config.T_max, '不可达 → T_c = T_max（非 Infinity / NaN）');
  assert.equal(tCsnap.unreachable, false, '重连 → 可达');
  assert.equal(tCsnap.T_c, tAsnap.T_c, '重连后 T_c 逐值回落且与 A 一致（确定性）');
  assert.ok(tDsnap.population > tAsnap.population, 'D 的 OD 需求更高');
  assert.ok(tDsnap.T_c >= tAsnap.T_c, 'GDD 03 AC-T1 / D2：需求↑ → T_c 单调不减');

  // 通过完整 P0~P8 验证负反馈传导：T_c ↑ → f_c ↓ → f_s 不升 → S ↓
  const rA = runTick(A, [makeCommand.advance('aA', 1)], config, createTickWorkspace(config, A.side));
  const rB = runTick(B, [makeCommand.advance('aB', 1)], config, createTickWorkspace(config, B.side));
  const rD = runTick(D, [makeCommand.advance('aD', 1)], config, createTickWorkspace(config, D.side));
  assertHealthy(rA, 'V-03 A');
  assertHealthy(rB, 'V-03 B');
  assertHealthy(rD, 'V-03 D');
  const fcA = rA.state.frames.current.factors[0];
  const fsA = rA.state.frames.current.factors[1];
  const fcB = rB.state.frames.current.factors[0];
  const fcD = rD.state.frames.current.factors[0];
  const fsD = rD.state.frames.current.factors[1];
  console.log(`[V-03] f_c: 连通A=${fcA} 断开B=${fcB} 高需求D=${fcD} | f_s: A=${fsA} D=${fsD} | S: A=${rA.state.frames.current.S} B=${rB.state.frames.current.S} D=${rD.state.frames.current.S}`);
  assert.equal(fcB, 0, '不可达 T_max → f_c 触底 0');
  assert.ok(rB.state.frames.current.S <= rA.state.frames.current.S, '断开拉低唯一计分板 S');
  assert.ok(fcD <= fcA, 'D2：拥堵↑ → f_c 不增');
  assert.ok(fsD <= fsA + 1e-12, 'D2：拥堵↑ → f_s 不升');
  assert.ok(rD.state.frames.current.S <= rA.state.frames.current.S + 1e-9, 'D2：拥堵↑ → S 不升（负反馈闭环）');
});

// ---------------------------------------------------------------------------
// ④ 分母退化组合
// ---------------------------------------------------------------------------

test('V-04 分母退化组合：P_t=0 / J_t=0 / cap=0 / E_max=0 / T_max=T_0 / Σw_g=0 + 全组合', () => {
  const zeroWeights = { f_c: 0, f_s: 0, f_e: 0, f_f: 0 };
  const fullLayout = (config, st) => {
    for (let k = 0; k < 3; k++) paint(st, config, 2 + k, 2, 'R', 1);
    paint(st, config, 8, 2, 'I', 1);
    paint(st, config, 2, 5, 'C', 1);
    for (let x = 2; x <= 8; x++) paint(st, config, x, 3, 'ROAD');
    paint(st, config, 2, 4, 'ROAD');
  };

  const cases = [
    { name: 'P_t=0（空城）', patch: {}, build: () => {} },
    { name: 'J_t=0（仅有 R，无 C/I）', patch: {}, build: (c, s) => { paint(s, c, 2, 2, 'R', 1); } },
    { name: 'cap=0', patch: { cap: 0 }, build: fullLayout },
    { name: 'E_max=0', patch: { E_max: 0 }, build: fullLayout },
    { name: 'T_max=T_0', patch: { T_max: 1, T_0: 1 }, build: fullLayout },
    { name: 'Σw_g=0（四权重全 0）', patch: { weights: zeroWeights }, build: fullLayout },
    {
      name: '全组合（P_t=0 + cap=0 + E_max=0 + T_max=T_0 + Σw=0 + i_ref=0 + f_floor=0）',
      patch: { cap: 0, E_max: 0, T_max: 1, T_0: 1, weights: zeroWeights, i_ref: 0, f_floor: 0 },
      build: () => {},
    },
  ];

  for (const tc of cases) {
    const config = createDefaultConfig(tc.patch);
    const state = createInitialState(config);
    tc.build(config, state);
    const ws = createTickWorkspace(config, state.side);
    const r = runTick(state, [makeCommand.advance('deg', 1)], config, ws);
    assertHealthy(r, `V-04 ${tc.name}`);
    const c = r.state.frames.current;
    console.log(`[V-04] ${tc.name} → S=${c.S} factors=[${Array.from(c.factors).join(',')}] T_c=${c.T_c} E=${c.E} L=${c.L} dS=${c.dS}`);
    // 全权重 0 的组合：S 必为 0（主项恒 0），且不得出现 NaN
    if (tc.patch.weights === zeroWeights) assert.equal(c.S, 0);
  }

  // 补充：GDD 01 §4.2 上界 λ=0.3 下归因链残差仍 ≤1 分
  const cfgOk = createDefaultConfig({ lambda: 0.3, K: 3 });
  let sOk = createInitialState(cfgOk);
  const wsOk = createTickWorkspace(cfgOk, sOk.side);
  const rOk1 = runTick(sOk, [makeCommand.advance('o1', 1)], cfgOk, wsOk);
  const rOk2 = runTick(rOk1.state, [makeCommand.fund('of', 1, 4), makeCommand.advance('o2', 2)], cfgOk, wsOk);
  let sumOk = 0;
  for (const v of rOk2.state.frames.current.dSByFactor) sumOk += v;
  sumOk += rOk2.state.frames.current.dSPenalty;
  assert.ok(Math.abs(rOk2.state.frames.current.dS - sumOk) <= 1, `λ=0.3 归因链残差 ≤1，实测 ${Math.abs(rOk2.state.frames.current.dS - sumOk)}`);
  assertHealthy(rOk2, 'V-04 λ=0.3');

  // 补充（仅健壮性探测，非平衡结论）：λ=1 越界注入（GDD 01 §4.2 规定 λ∈[0,0.3]）
  // 当前实现未对配置范围做校验；如实记录 dSPenalty 放大与归因残差。
  const cfgX = createDefaultConfig({ lambda: 1, K: 3 });
  const wsX = createTickWorkspace(cfgX, MAX_GRID_SIDE);
  const rX1 = runTick(createInitialState(cfgX), [makeCommand.advance('x1', 1)], cfgX, wsX);
  const rX2 = runTick(rX1.state, [makeCommand.zone('xz', 1, 2, 2, 'R', 1), makeCommand.advance('x2', 2)], cfgX, wsX);
  let sumX = 0;
  for (const v of rX2.state.frames.current.dSByFactor) sumX += v;
  sumX += rX2.state.frames.current.dSPenalty;
  const resX = Math.abs(rX2.state.frames.current.dS - sumX);
  console.log(`[V-04] λ=1 越界注入（仅健壮性探测）：dSPenalty=${rX2.state.frames.current.dSPenalty} dS=${rX2.state.frames.current.dS} Σ+pen=${sumX} 归因残差=${resX}（GDD 规定 λ≤0.3，实现未校验配置范围；不作平衡结论）`);
  assert.ok(Number.isFinite(rX2.state.frames.current.dSPenalty));
  assert.ok(Number.isFinite(rX2.state.frames.current.dS));
});

// ---------------------------------------------------------------------------
// ⑤ 同 tick 内相同幂等键不同 payload、以及多命令顺序敏感性
// ---------------------------------------------------------------------------

test('V-05 幂等键分层契约 + 多命令顺序敏感性（顺序敏感但各自确定）', () => {
  const config = createDefaultConfig();
  const i = cellIndex(MAX_GRID_SIDE, 2, 2);

  // (a) CommandQueue 层：相同 key 不同 payload，第二条被拒
  const q = createCommandQueue();
  const cmdA = makeCommand.zone('same', 1, 2, 2, 'R', 1);
  const cmdB = makeCommand.zone('same', 2, 2, 2, 'C', 3);
  assert.equal(q.enqueue(cmdA), true);
  assert.equal(q.enqueue(cmdB), false, '同 key 不同 payload 必须被幂等键拒绝');
  assert.equal(q.drain().length, 1);
  assert.equal(q.size, 0);

  // (b) runTick 层：不做幂等校验，两条命令都应用（后者覆盖）
  const r = runTick(createInitialState(config), [cmdA, cmdB], config, createTickWorkspace(config, MAX_GRID_SIDE));
  assert.equal(r.state.cells.zone[i], zoneIndex(config, 'C'), '后者覆盖前者');
  assert.equal(r.state.cells.density[i], 3);
  assert.equal(r.state.cells.inputVersion[i], 2, '两条命令均应用（inputVersion +2）');
  assert.deepEqual([...r.commandTrace], ['same', 'same']);
  console.log(`[V-05] runTick 层不校验幂等：commandTrace=[${r.commandTrace.join(',')}] inputVersion=${r.state.cells.inputVersion[i]}（分层契约：幂等仅在 queue/session 层）`);

  // (c) session.submit 层去重（不同 payload 同 key 也只入队 1 条）
  const sim = createSimulation(config, createInitialState(config));
  sim.submit(makeCommand.zone('k', 1, 2, 2, 'R', 1));
  sim.submit(makeCommand.zone('k', 2, 2, 2, 'C', 3));
  assert.equal(sim.pendingCount, 1);

  // (d) 顺序敏感：zone(R,2)+density(3) 与 density(3)+zone(R,2) 终态不同
  const order1 = [
    makeCommand.zone('z', 1, 2, 2, 'R', 2),
    makeCommand.density('d', 2, 2, 2, 3),
    makeCommand.advance('a', 3),
  ];
  const order2 = [
    makeCommand.density('d', 2, 2, 2, 3),
    makeCommand.zone('z', 1, 2, 2, 'R', 2),
    makeCommand.advance('a', 3),
  ];
  const s1 = snapTick(runTick(createInitialState(config), order1, config, createTickWorkspace(config, MAX_GRID_SIDE)));
  const s2 = snapTick(runTick(createInitialState(config), order2, config, createTickWorkspace(config, MAX_GRID_SIDE)));
  assert.equal(s1.state.cells.density[i], 3);
  assert.equal(s2.state.cells.density[i], 2);
  assert.notEqual(canonicalize(s1), canonicalize(s2), '多命令顺序不同 → 结果不同（顺序敏感）');
  console.log(`[V-05] 顺序敏感：zone→density 终态 density=${s1.state.cells.density[i]}；density→zone 终态 density=${s2.state.cells.density[i]}`);

  // (e) 同一顺序重复运行仍逐字节确定（顺序敏感 ≠ 不确定性）
  const s1b = snapTick(runTick(createInitialState(config), order1, config, createTickWorkspace(config, MAX_GRID_SIDE)));
  assert.equal(canonicalize(s1), canonicalize(s1b));

  // (f) 渲染帧循环不推进（交叉复核 S-03 验收 2）
  const st = createInitialState(config);
  const before = canonicalize(serializeState(st));
  assert.equal(advanceRenderFrames(st, 10000), st);
  assert.equal(canonicalize(serializeState(st)), before);
});

// ---------------------------------------------------------------------------
// ⑥ configHash 变更后旧快照的显式迁移 / 拒绝载入（S-10 前置）
// 【T-116 修订】D-01 已修复（deserializeState / createSimulation 挂接断言），
// 本用例由「记录契约缺口」改写为「验证修复后契约」；其余 11 条用例未改。
// ---------------------------------------------------------------------------

test('V-06 configHash 变更：载入 / 编排入口均已强制断言，旧快照不再被静默续算（D-01 已修复）', () => {
  const configA = createDefaultConfig();
  const oldState = createInitialState(configA);
  const configB = createDefaultConfig({ weights: { ...configA.weights, f_c: 0.11 } });
  const oldWire = JSON.parse(JSON.stringify(serializeState(oldState)));

  // (a) 显式断言能力存在且正确
  assert.doesNotThrow(() => assertConfigCompatible(oldState, configA));
  assert.throws(() => assertConfigCompatible(oldState, configB), ConfigMismatchError);
  assert.notEqual(computeConfigHash(configA), computeConfigHash(configB));

  // (b)【D-01 修复点 1】deserializeState(oldWire, 新 config) 必须抛 ConfigMismatchError
  assert.throws(() => deserializeState(oldWire, configB), ConfigMismatchError, '载入路径拒绝旧快照 + 新 config');

  // (b2) 匹配 config 回环成功（断言不误伤合法载入）
  const loaded = deserializeState(oldWire, configA);
  assert.equal(loaded.configHash, computeConfigHash(configA), '匹配回环载入成功且 hash 一致');

  // (c)【D-01 修复点 2】createSimulation(configB, 旧 hash state) 入口即抛错
  assert.throws(() => createSimulation(configB, oldState), ConfigMismatchError, '编排入口拒绝不匹配 state');
  assert.doesNotThrow(() => createSimulation(configA, loaded));

  // (d) 内核契约如实记录：绕过载入入口、直接把 state 喂 runTick 属调用方显式责任
  // （session 是 UI 唯一编排入口；runTick 保持纯函数契约，不加二次校验 → D-03 分层契约）
  const rOld = runTick(createInitialState(configA), [makeCommand.advance('o1', 1)], configA, createTickWorkspace(configA, MAX_GRID_SIDE));
  const rMix = runTick(createInitialState(configA), [makeCommand.advance('m1', 1)], configB, createTickWorkspace(configB, MAX_GRID_SIDE));
  const sOld = rOld.state.frames.current.S;
  const sMix = rMix.state.frames.current.S;
  console.log(`[V-06] 旧config S_t=${sOld} / 新config 直接喂 runTick S_t=${sMix}（内核层仍可显式混用，但公开载入 / 编排入口已全部拦截）`);
  assert.notEqual(sOld, sMix, '新权重确实改变 S_t（内核纯函数契约，不隐式拒绝）');

  // (e) 静态证据：src/ 中 assertConfigCompatible 除定义处外已有调用点（D-01 修复后 ≥2）
  const joined = allTsFiles()
    .map((f) => stripNonCode(readFileSync(join(process.cwd(), f), 'utf8')))
    .join('\n');
  const occurrences = (joined.match(/assertConfigCompatible\s*\(/g) || []).length;
  console.log(`[V-06] src/**/*.ts 中 assertConfigCompatible( 出现 ${occurrences} 次（1 = 定义处；调用点 = ${occurrences - 1} ≥ 2：schema.ts deserializeState + session.ts createSimulation）`);
  assert.ok(occurrences >= 3, 'D-01 修复后：定义处 + deserializeState + createSimulation 共 ≥3 处');
});

// ---------------------------------------------------------------------------
// ⑦ 连续多周期未达标 + 达标解锁互斥不同帧（GDD 04 E7 / AC-F5 / OD-1 A）
// ---------------------------------------------------------------------------

test('V-07 连续多周期未达标 + 达标解锁互斥不同帧（回退侧属 S-11，本轮 BLOCKED）', () => {
  // 未达标侧：3 个周期均未达标，不判负、可继续、已解锁区不回退
  const cfgFail = createDefaultConfig({ K: 2, S_unlock: 99 });
  const wsF = createTickWorkspace(cfgFail, MAX_GRID_SIDE);
  let sF = createInitialState(cfgFail);
  const failOutcomes = [];
  const failUnlocks = [];
  for (let i = 1; i <= 6; i++) {
    const rF = runTick(sF, [makeCommand.advance('f' + i, i)], cfgFail, wsF);
    sF = rF.state;
    assert.ok(['IN_CYCLE', 'TARGET_MET', 'RETRY_AVAILABLE'].includes(rF.cycleOutcome));
    if (i % cfgFail.K === 0) { failOutcomes.push(rF.cycleOutcome); failUnlocks.push(sF.unlockedRegions); }
  }
  assert.deepEqual(failOutcomes, ['RETRY_AVAILABLE', 'RETRY_AVAILABLE', 'RETRY_AVAILABLE']);
  assert.deepEqual(failUnlocks, [1, 1, 1], '未达标不减少已解锁区域');
  assert.equal(sF.tickId, 6, '连续未达标不锁死，仍可继续推进');
  assert.equal(sF.cycleId, 3);
  console.log(`[V-07] 未达标 3 周期 outcomes=${failOutcomes.join(',')} unlockedRegions=${failUnlocks.join(',')} tickId=${sF.tickId}`);

  // 达标侧：每周期 TARGET_MET，unlockedRegions 递增；单一 tick 只取一个 outcome（互斥）
  const cfgWin = createDefaultConfig({ K: 2, S_unlock: 0 });
  const wsW = createTickWorkspace(cfgWin, MAX_GRID_SIDE);
  let sW = createInitialState(cfgWin);
  const winOutcomes = [];
  const winUnlocks = [];
  let prevUnlocked = sW.unlockedRegions;
  for (let i = 1; i <= 6; i++) {
    const rW = runTick(sW, [makeCommand.advance('w' + i, i)], cfgWin, wsW);
    sW = rW.state;
    if (i % cfgWin.K === 0) {
      winOutcomes.push(rW.cycleOutcome);
      winUnlocks.push(sW.unlockedRegions);
      if (rW.cycleOutcome === 'TARGET_MET') assert.equal(sW.unlockedRegions, prevUnlocked + 1, '达标帧 +1');
      else assert.equal(sW.unlockedRegions, prevUnlocked, '未达标帧不解锁');
      prevUnlocked = sW.unlockedRegions;
    } else {
      assert.equal(rW.cycleOutcome, 'IN_CYCLE', '非周期末不产生达标 / 重试判定');
      assert.equal(sW.unlockedRegions, prevUnlocked, '非周期末帧不解锁');
    }
  }
  assert.deepEqual(winOutcomes, ['TARGET_MET', 'TARGET_MET', 'TARGET_MET']);
  console.log(`[V-07] 达标 3 周期 outcomes=${winOutcomes.join(',')} unlockedRegions=${winUnlocks.join(',')}（每达标周期 +1：P7 占位计数，cells.unlocked 未改写；实际解锁形状属 S-11 / GDD 02 O-2）`);

  // 互斥性：达标与未达标不会在同一 tick 同时出现（cycleOutcome 为单一枚举值）
  assert.equal(typeof winOutcomes[0], 'string');
  // 【本轮 BLOCKED】GDD 04 E7「回退与解锁互斥不同帧」中的「回退」属 S-11（Keyframe 回退），
  // 本轮纯逻辑层无回退路径，无法构造「回退与解锁同帧」的对照态；仅验证判定/解锁侧互斥。
  console.log('[V-07] 回退侧（GDD 04 E7 / SM-W4-05）属 S-11，本轮未实现 → BLOCKED，未验证「回退与解锁互斥」');
});

// ---------------------------------------------------------------------------
// ⑧ f_f 饱和边界与短板惩罚 L 触边
// ---------------------------------------------------------------------------

test('V-08 f_f 饱和边界与短板惩罚 L 触边（含 f_floor=0 分母退化）', () => {
  const config = createDefaultConfig();
  const agg = createDefaultAggregator();

  const fWithZero = new Float64Array([0, 0.9, 0.9, 0.9]);
  const fAllHigh = new Float64Array([0.9, 0.9, 0.9, 0.9]);
  assert.equal(agg.shortfall(fWithZero, config), 1, 'min=0 → L 触上边 1');
  assert.equal(agg.shortfall(fAllHigh, config), 0, 'min ≥ f_floor → L 触下边 0');
  const sLow = agg.aggregate(fWithZero, config);
  assert.ok(sLow >= 0 && sLow <= 100 && Number.isFinite(sLow));
  console.log(`[V-08] L=1 时 S=${sLow}（短板惩罚生效，仍 ∈[0,100]）`);

  // f_floor=0 → shortfall 分母退化走 safeDiv 兜底，L=0，不产生 NaN
  assert.equal(agg.shortfall(fWithZero, createDefaultConfig({ f_floor: 0 })), 0);

  // f_f 饱和：population>0 且 I_f_lagged 远大于 I_ref
  const sSat = createInitialState(config);
  for (let k = 0; k < 3; k++) paint(sSat, config, 2 + k, 2, 'R', 1);
  sSat.budget.I_f_lagged = 1e9;
  const rSat = runTick(sSat, [makeCommand.advance('sat', 1)], config, createTickWorkspace(config, sSat.side));
  assert.equal(rSat.state.frames.current.factors[3], 1, 'f_f 饱和到 1');
  assert.ok(rSat.state.frames.current.S <= 100 && Number.isFinite(rSat.state.frames.current.S));
  assertHealthy(rSat, 'V-08 f_f 饱和');

  const sZero = createInitialState(config);
  for (let k = 0; k < 3; k++) paint(sZero, config, 2 + k, 2, 'R', 1);
  sZero.budget.I_f_lagged = 0;
  const rZero = runTick(sZero, [makeCommand.advance('zero', 1)], config, createTickWorkspace(config, sZero.side));
  assert.equal(rZero.state.frames.current.factors[3], 0, 'I_f=0 → f_f=0');
  console.log(`[V-08] f_f 饱和 S=${rSat.state.frames.current.S} / f_f=0 S=${rZero.state.frames.current.S}`);

  // S 触边（0 / 100）与 ΔS 钳制到 [-100,100]
  const cfgAllZero = createDefaultConfig({ weights: { f_c: 0, f_s: 0, f_e: 0, f_f: 0 } });
  const rEdge = runTick(createInitialState(cfgAllZero), [makeCommand.advance('e', 1)], cfgAllZero, createTickWorkspace(cfgAllZero, MAX_GRID_SIDE));
  assert.equal(rEdge.state.frames.current.S, 0, 'S 触下边 0');
  assert.ok(rEdge.state.frames.current.dS >= -100 && rEdge.state.frames.current.dS <= 100);
  assertHealthy(rEdge, 'V-08 S 触边');
});

// ---------------------------------------------------------------------------
// ⑨ 跨进程 / 不同浮点累加顺序的一致性
// ---------------------------------------------------------------------------

test('V-09 跨进程（本机同引擎）逐字节一致 + 累加顺序由网格索引决定；跨引擎为局限', () => {
  const config = createDefaultConfig({ K: 3 });

  // 本机进程内基准
  let s = createInitialState(config);
  const ws = createTickWorkspace(config, s.side);
  for (let i = 1; i <= 8; i++) {
    s = runTick(s, [
      makeCommand.zone('z' + i, i, (i * 3) % 16, 2, 'R', (i % 3) + 1),
      makeCommand.advance('a' + i, i + 20),
    ], config, ws).state;
  }
  const inProcess = canonicalize(serializeState(s));

  // 两个完全独立的 Node 进程各跑同一序列
  const probe = `
import { createDefaultConfig, createInitialState, createTickWorkspace, runTick, makeCommand, serializeState, canonicalize } from './src/index.ts';
const config = createDefaultConfig({ K: 3 });
let s = createInitialState(config);
const ws = createTickWorkspace(config, s.side);
for (let i = 1; i <= 8; i++) {
  s = runTick(s, [makeCommand.zone('z' + i, i, (i * 3) % 16, 2, 'R', (i % 3) + 1), makeCommand.advance('a' + i, i + 20)], config, ws).state;
}
process.stdout.write(canonicalize(serializeState(s)));
`;
  const runChild = () => execFileSync(
    process.execPath,
    ['--experimental-strip-types', '--input-type=module', '-e', probe],
    { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const child1 = runChild();
  const child2 = runChild();
  console.log(`[V-09] 引擎=${process.version} 平台=${process.platform}/${process.arch} | 进程内长度=${inProcess.length} 子进程1长度=${child1.length} 子进程2长度=${child2.length}`);
  assert.equal(child1, child2, '两个独立进程逐字节一致');
  assert.equal(child1, inProcess, '跨进程与进程内逐字节一致');

  // 「不同浮点累加顺序」的可验证部分：最终网格相同但命令到达顺序不同，
  // 块合并按 cell index 升序遍历（与命令顺序无关）→ solveTraffic 结果一致。
  const cmdsAsc = [];
  const cmdsDesc = [];
  for (let x = 2; x <= 6; x++) cmdsAsc.push(makeCommand.zone('c' + x, x, x, 2, 'R', 1));
  for (let x = 6; x >= 2; x--) cmdsDesc.push(makeCommand.zone('c' + x, x, x, 2, 'R', 1));
  const stAsc = runTick(createInitialState(config), [...cmdsAsc, makeCommand.advance('aa', 10)], config, createTickWorkspace(config, MAX_GRID_SIDE)).state;
  const stDesc = runTick(createInitialState(config), [...cmdsDesc, makeCommand.advance('dd', 10)], config, createTickWorkspace(config, MAX_GRID_SIDE)).state;
  const tAsc = canonicalize(solveTraffic(stAsc, config, createTrafficWorkspace(stAsc.side, config)));
  const tDesc = canonicalize(solveTraffic(stDesc, config, createTrafficWorkspace(stDesc.side, config)));
  assert.equal(tAsc, tDesc, '相同最终网格 / 不同命令顺序 → 通勤求解逐字节一致');
  console.log('[V-09] 命令到达顺序不同但块遍历顺序固定 → solveTraffic 结果一致');

  // 【局限 · 如实声明】本机仅 Node v22.22.2 单引擎；无法构造 Cocos Creator /
  // HarmonyOS ArkTS / 其它 JS 引擎的等价浮点累加对照，也无机型矩阵。
  // 因此「跨平台 / 跨引擎浮点一致性」本轮不做结论（ADR-002 §2 子决策 2 / R-1）。
  console.log(`[V-09] 【局限】仅有 ${process.version} 单引擎，跨引擎 / 跨架构浮点累加一致性未验证，不编造结论`);
});

// ---------------------------------------------------------------------------
// ⑩ 替换 TickOptions.solver 后 P3/P4 仍确定性、T_c 单调性不回退
// ---------------------------------------------------------------------------

function makeStubSolver(fields) {
  return (state, config, ws) => {
    const r = ws.result;
    r.T_c = fields.T_c;
    r.t_g.fill(config.T_s_max);
    r.d.fill(0);
    r.qOverCap.fill(0);
    r.unreachable = fields.unreachable ?? false;
    r.blocks = 1;
    r.E = fields.E ?? 0;
    r.population = fields.population ?? 0;
    r.jobs = fields.jobs ?? 0;
    r.qTotal = fields.qTotal ?? 0;
    r.serviceWeightedAccess = fields.serviceWeightedAccess ?? 0;
    r.serviceWeightTotal = fields.serviceWeightTotal ?? 0;
    return r;
  };
}

test('V-10 注入自定义 solver：P3/P4 结果确定、T_c 单调不回退、P3 仍复用 P2', () => {
  const config = createDefaultConfig({ K: 10 });
  const baseFields = {
    T_c: 5, population: 10, jobs: 2, qTotal: 5,
    serviceWeightedAccess: 7.5, serviceWeightTotal: 10, E: 0,
  };

  // (a) 同一注入 solver 两次独立 workspace → 逐字节确定
  const mk = () => runTick(
    createInitialState(config),
    [makeCommand.advance('inj', 1)],
    config,
    createTickWorkspace(config, MAX_GRID_SIDE),
    { solver: makeStubSolver(baseFields) },
  );
  const a = snapTick(mk());
  const b = snapTick(mk());
  assert.equal(canonicalize(a), canonicalize(b), '注入 solver 后仍确定性');

  // (b) P3 复用注入结果：f_s = serviceWeightedAccess / serviceWeightTotal
  assert.equal(a.state.frames.current.factors[1], 0.75, 'P3 f_s 由注入的 P2 产物算出');
  const p3 = a.stages.find((s) => s.stage === 'P3');
  assert.match(p3.note, /reused:P2/, 'P3 仍显式复用 P2 通勤图产物');
  const p2 = a.stages.find((s) => s.stage === 'P2');
  assert.match(p2.note, /blocks=1/, 'P2 采用注入 solver 的 blocks');
  assert.equal(a.state.frames.current.T_c, 5, 'P4 的 T_c 来自注入 solver');
  console.log(`[V-10] 注入 solver：P2 note="${p2.note}" P3 note="${p3.note}" f_s=${a.state.frames.current.factors[1]} T_c=${a.state.frames.current.T_c}`);

  // (c) 注入递增 T_c 序列：P4 的 f_c 单调不增、S 不升，且输出 T_c 不回退
  const tcValues = [0, 5, 15, 30];
  const observed = tcValues.map((t, idx) => {
    const r = runTick(
      createInitialState(config),
      [makeCommand.advance('t' + idx, idx + 1)],
      config,
      createTickWorkspace(config, MAX_GRID_SIDE),
      { solver: makeStubSolver({ ...baseFields, T_c: t }) },
    );
    return {
      T_c: r.state.frames.current.T_c,
      f_c: r.state.frames.current.factors[0],
      f_s: r.state.frames.current.factors[1],
      S: r.state.frames.current.S,
    };
  });
  for (let k = 0; k < tcValues.length; k++) {
    assert.equal(observed[k].T_c, tcValues[k], `注入 T_c=${tcValues[k]} 未被 P4 回退 / 改写`);
    assert.equal(observed[k].f_s, 0.75);
    if (k > 0) {
      assert.ok(observed[k].T_c >= observed[k - 1].T_c, 'T_c 不回退');
      assert.ok(observed[k].f_c <= observed[k - 1].f_c + 1e-12, 'f_c 对 T_c 单调不增');
      assert.ok(observed[k].S <= observed[k - 1].S + 1e-9, 'S 对 T_c 不升');
    }
  }
  console.log(`[V-10] 注入 T_c=[${tcValues.join(',')}] → f_c=[${observed.map((o) => o.f_c.toFixed(4)).join(',')}] S=[${observed.map((o) => o.S.toFixed(4)).join(',')}]`);

  // (d) 同时替换 aggregator：注入生效且仍确定
  const customAgg = {
    transform: (f) => f,
    shortfall: () => 0,
    aggregate: () => 50,
  };
  const rAgg = snapTick(runTick(
    createInitialState(config),
    [makeCommand.advance('agg', 1)],
    config,
    createTickWorkspace(config, MAX_GRID_SIDE),
    { solver: makeStubSolver(baseFields), aggregator: customAgg },
  ));
  assert.equal(rAgg.state.frames.current.S, 50, '注入聚合器生效');
  assert.equal(rAgg.state.frames.current.L, 0);
  const rAgg2 = snapTick(runTick(
    createInitialState(config),
    [makeCommand.advance('agg', 1)],
    config,
    createTickWorkspace(config, MAX_GRID_SIDE),
    { solver: makeStubSolver(baseFields), aggregator: customAgg },
  ));
  assert.equal(canonicalize(rAgg), canonicalize(rAgg2), 'solver + aggregator 双注入仍确定');
  assert.equal(NOOP_ATTRIBUTION_RECORDER.count, 0, '默认记录器为 NOOP（S-05 占位）');
});

// ---------------------------------------------------------------------------
// 静态纪律扫描（独立复现：本用例随套件一起真实执行）
// ---------------------------------------------------------------------------

test('V-STATIC 静态纪律扫描：墙上时钟 / 原生随机 / 平台依赖 / 半径 / OD / 平衡硬编码 / 终局 / 倍速', () => {
  const files = allTsFiles();
  const stripped = files.map((f) => {
    let src = readFileSync(join(process.cwd(), f), 'utf8');
    if (f.endsWith('config.ts')) src = removePlaceholderBlock(src);
    return { file: f, code: stripNonCode(src) };
  });
  const joined = stripped.map((d) => d.code).join('\n');

  const checks = [
    { label: '墙上时钟 / 原生随机 / 性能计时', re: /Date\.now|new Date\(|Math\.random|performance\.now|process\.hrtime/ },
    { label: 'Cocos / HarmonyOS / ArkUI / node: 平台或渲染 import', re: /from\s+['"](?:cocos|@ohos|@harmony|harmony|arkui|three|pixi|node:)|require\s*\(\s*['"](?:cocos|@ohos|node:)/i },
    { label: '纯半径叠 buff / 欧氏距离 / 传送式服务', re: /euclidean|Math\.hypot|radius|半径|传送式|teleport|欧氏/i },
    { label: '逐格 OD 矩阵', re: /odMatrix|OD_MATRIX|1024\s*\*\s*1024|side\s*\*\s*side\s*\*\s*side/i },
    { label: 'GAME_OVER / 判负 / 失败终局', re: /GAME_OVER|GameOver|gameOver|判负|失败终局|defeat/i },
    { label: '倍速 ×1×2×4 / 自动播放 / 倒计时 / 帧定时器', re: /autoPlay|auto_play|autoplay|setInterval|setTimeout|countdown|requestAnimationFrame|×1|×2|×4|倍速|自动播放|倒计时/i },
  ];
  for (const c of checks) {
    const hits = stripped.filter((d) => c.re.test(d.code)).map((d) => d.file);
    console.log(`[V-STATIC] ${c.label} → 命中 ${hits.length} 个 .ts 文件${hits.length ? '：' + hits.join(',') : ''}`);
    assert.equal(hits.length, 0, `${c.label} 不应在任何 src/**/*.ts 可执行代码中命中`);
  }

  // 平衡期数值硬编码：去掉 PLACEHOLDER_DEFAULTS 定义块后，
  // 检查是否仍出现「只可能是平衡数值」的小数字面量
  const balanceLiterals = /(?<![\w.])(?:0\.25|0\.3|0\.1|0\.05|0\.5|1\.8|2\.4|1e-9)(?![\w.])/;
  const balHits = stripped.filter((d) => balanceLiterals.test(d.code)).map((d) => d.file);
  console.log(`[V-STATIC] 非占位块「平衡期小数字面量」 → 命中 ${balHits.length} 个文件${balHits.length ? '：' + balHits.join(',') : ''}`);
  assert.equal(balHits.length, 0, '公式 / 结算链路中不得硬编码平衡期数值');

  // 列出剩余数字字面量集合，便于人工判定是否全为结构性常量
  const nums = new Set();
  for (const d of stripped) {
    for (const m of d.code.matchAll(/(?<![\w.])\d+(?:\.\d+)?(?:e[+-]?\d+)?(?![\w.])/g)) nums.add(m[0]);
  }
  console.log(`[V-STATIC] 非占位块数字字面量集合 = ${[...nums].sort().join(', ')}（均为 0/1/2/3/4/8/16/32/64/100/128 等结构性常量）`);

  // assertConfigCompatible 调用点计数（D-01 修复后：定义处 + schema.ts + session.ts）
  const occ = (joined.match(/assertConfigCompatible\s*\(/g) || []).length;
  console.log(`[V-STATIC] assertConfigCompatible( 出现 ${occ} 次 → 调用点 ${occ - 1} 个（D-01 已修复，见 V-06）`);
  assert.ok(occ >= 3, 'D-01 修复后须有 ≥2 个真实调用点');

  // MAX_BLOCKS 结构性常量定义但 traffic.ts 实际使用 config.maxBlocks
  const mb = (joined.match(/MAX_BLOCKS/g) || []).length;
  console.log(`[V-STATIC] MAX_BLOCKS 出现 ${mb} 次（types.ts 定义；traffic.ts 实际生效的是 config.maxBlocks=${PLACEHOLDER_DEFAULTS.maxBlocks}）`);
  assert.ok(mb >= 1);

  // 32×32 硬上限仍由 assertGridSide 强制
  assert.throws(() => createInitialState(createDefaultConfig(), { side: MAX_GRID_SIDE + 1 }), GridLimitExceededError);
  assert.doesNotThrow(() => createInitialState(createDefaultConfig(), { side: MAX_GRID_SIDE }));
});
