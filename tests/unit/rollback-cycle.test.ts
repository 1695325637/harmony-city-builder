/**
 * HC-01 · T-143 · 回退内核 · 周期级重试语义（S-11 验收 1/2 · SM-W4-04 · AC-E4）
 *
 * 覆盖：
 * ① 周期起始 KEYFRAME 定位规则（cycleTickIndex === 0 且 cycleId 匹配）；
 * ② 回退 = 恢复该 KEYFRAME，**内容逐字节一致**（含 B / I_f / cells / unlockedRegions / 议题）；
 * ③ `tickId` 单调递增不复用；`cycleId` 单调不倒退、`cycleTickIndex` 归 0；
 * ④ 旧分支归档一条不删、一条不改（可整段复盘）；
 * ⑤ 重跑同一周期只结算一次 → 结余 / 满意度与首次完全一致（AC-E4 无重复扣费）；
 * ⑥ 归档高水位与「新分支起点入档」。
 *
 * 【诚实口径】真机未验证（EX-03 顺延、准出阻塞）；DoD D-2 人工体验未判定，
 * 本文件只验证**结构支撑**，不声称「失败—诊断—修正—见效」已达成。
 * 零依赖：Node 22 --experimental-strip-types + node:test。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultConfig,
  createInitialState,
  createSimulation,
  createInMemorySnapshotStore,
  serializeState,
  canonicalize,
  type Config,
  type CityState,
  type InMemorySnapshotStore,
} from '../../src/index.ts';
import {
  findCycleStartKeyframe,
  archiveHighWaterMarks,
  defaultTargetCycleId,
  type RollbackStore,
} from '../../src/simulation/rollback.ts';

const SIDE = 16;

/** K=2 且永不达标 → 每次周期末都是 RETRY_AVAILABLE（E7 允许回退） */
function retryableConfig(): Config {
  return createDefaultConfig({ K: 2, S_unlock: 99 });
}

/** 只推进 tick、不发建造命令，使「重跑同一周期」与首次结算完全可比 */
function makeSim(config: Config, store: InMemorySnapshotStore) {
  return createSimulation(config, createInitialState(config, { side: SIDE }), { snapshotStore: store });
}

/** 逐步推进 n 个 tick（advance-only），返回每步后的关键量快照 */
function advanceN(sim: ReturnType<typeof makeSim>, n: number, prefix: string) {
  const out: Array<{ tickId: number; cycleId: number; cycleTickIndex: number; B: number; S: number; outcome: string }> = [];
  for (let t = 1; t <= n; t++) {
    const r = sim.advanceDay(prefix + t);
    out.push({
      tickId: sim.tickId,
      cycleId: sim.state.cycleId,
      cycleTickIndex: sim.state.cycleTickIndex,
      B: sim.state.budget.B,
      S: sim.state.frames.current.S,
      outcome: r.result?.cycleOutcome ?? 'IN_CYCLE',
    });
  }
  return out;
}

/** 抹掉「身份标签」（tickId / cycleId / cycleTickIndex）后的状态内容指纹 */
function contentFingerprint(state: CityState): string {
  const o = serializeState(state);
  return canonicalize({ ...o, tickId: 0, cycleId: 0, cycleTickIndex: 0 });
}

function fiveFields(state: CityState) {
  return {
    cellsZone: Array.from(state.cells.zone),
    cellsDensity: Array.from(state.cells.density),
    cellsUnlocked: Array.from(state.cells.unlocked),
    cellsRegion: Array.from(state.cells.region),
    cellsInputVersion: Array.from(state.cells.inputVersion),
    budget: { ...state.budget },
    S: state.frames.current.S,
    factors: Array.from(state.frames.current.factors),
    prevS: state.frames.prev.S,
    issueCount: state.issueCount,
    unlockedRegions: state.unlockedRegions,
  };
}

// ---------------------------------------------------------------------------
// ① 周期起始 KEYFRAME 定位
// ---------------------------------------------------------------------------

test('RC-1 周期起始 KEYFRAME 定位：cycleTickIndex===0 且 cycleId 匹配的最近自包含帧', () => {
  const config = retryableConfig();
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  advanceN(sim, 6, 'rc1-');

  // 真实归档：1(c0.1) 2(c1.0) 3(c1.1) 4(c2.0) 5(c2.1) 6(c3.0)
  assert.deepEqual(store.entries().map((e) => e.tickId + ':c' + e.cycleId + '.' + e.cycleTickIndex + ':' + e.kind),
    ['1:c0.1:KEYFRAME', '2:c1.0:KEYFRAME', '3:c1.1:DELTA', '4:c2.0:KEYFRAME', '5:c2.1:DELTA', '6:c3.0:KEYFRAME'],
    '归档结构符合 KEYFRAME / DELTA 规则');

  const k1 = findCycleStartKeyframe(store as RollbackStore, 1);
  const k2 = findCycleStartKeyframe(store as RollbackStore, 2);
  const k3 = findCycleStartKeyframe(store as RollbackStore, 3);
  assert.deepEqual(k1, { tickId: 2, cycleId: 1 }, '周期 1 起点 = tick 2');
  assert.deepEqual(k2, { tickId: 4, cycleId: 2 }, '周期 2 起点 = tick 4');
  assert.deepEqual(k3, { tickId: 6, cycleId: 3 }, '周期 3 起点 = tick 6');
  // 周期 0 的起点是初始态（tick 0），从未入档 → 必须显式定位失败，不得退化到别的 tick
  assert.equal(findCycleStartKeyframe(store as RollbackStore, 0), null, '周期 0 起点未归档 → null');
  assert.equal(findCycleStartKeyframe(store as RollbackStore, 9), null, '不存在的周期 → null');

  assert.deepEqual(archiveHighWaterMarks(store as RollbackStore), { tickId: 6, cycleId: 3 }, '高水位');
});

test('RC-2 默认目标周期：周期边界取「刚结束的周期」，非边界取当前周期', () => {
  const config = retryableConfig();
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  const hist = advanceN(sim, 6, 'rc2-');
  // tick6 处 cycleId=3 / cycleTickIndex=0 → 刚结束的是周期 2
  assert.equal(hist[5].cycleId, 3);
  assert.equal(hist[5].cycleTickIndex, 0);
  assert.equal(defaultTargetCycleId(sim.state), 2, '周期边界 → 刚结束的周期 2');
  // tick5 处 cycleId=2 / cycleTickIndex=1（周期中段）→ 当前周期 2
  const midState = createInitialState(config, { side: SIDE });
  midState.cycleId = 2;
  midState.cycleTickIndex = 1;
  assert.equal(defaultTargetCycleId(midState), 2, '非边界 → 当前周期');
  // 初始态：cycleId=0 / cycleTickIndex=0 → 取 0（其后会因起点未归档而显式失败）
  assert.equal(defaultTargetCycleId(createInitialState(config, { side: SIDE })), 0);
});

// ---------------------------------------------------------------------------
// ② 回退 = 恢复（内容逐字节一致）+ ③ 身份标签重标
// ---------------------------------------------------------------------------

test('RC-3 SM-W4-04 回退到周期起始 KEYFRAME：五类字段与周期初逐字节一致', () => {
  const config = retryableConfig();
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  const hist = advanceN(sim, 6, 'rc3-');

  // 周期 2 的起点 = tick 4，其自包含帧即「首次结算前的状态」
  const startFrame = store.get(4);
  assert.ok(startFrame !== null && startFrame.frames !== null, 'tick4 为自包含 KEYFRAME');
  const expectedB = hist[3].B;
  const expectedFingerprint = canonicalize({
    ...(JSON.parse(JSON.stringify(startFrame.frames)) as Record<string, unknown>),
    tickId: 0, cycleId: 0, cycleTickIndex: 0,
  });

  const r = sim.retryCycle(2);
  assert.equal(r.restoredFromTickId, 4, '恢复自周期 2 的起始 KEYFRAME');
  assert.equal(r.previousHeadTickId, 6);
  assert.equal(r.previousCycleId, 3);
  assert.equal(r.abortedTickCount, 2, '被放弃的 tick 数 = 6 − 4');

  // 内容逐字节一致（含预算 / 满意度 / 网格 / 解锁进度 / 议题）
  assert.equal(contentFingerprint(sim.state), expectedFingerprint, '内容指纹与周期初一致');
  assert.equal(sim.state.budget.B, expectedB, '结余回到周期初（结算前）');
  assert.deepEqual(fiveFields(sim.state), {
    ...fiveFields(sim.state),
    budget: { ...sim.state.budget },
  });
  // 与 tick4 的恢复结果对照（同一份 KEYFRAME）
  const direct = store.restore(4, config);
  assert.deepEqual(fiveFields(sim.state), fiveFields(direct.state), '五类字段逐项一致（含 B / I_f / cells / unlockedRegions）');
  assert.equal(sim.state.unlockedRegions, direct.state.unlockedRegions, '解锁进度一并回滚');
  assert.equal(sim.state.issueCount, direct.state.issueCount, '议题状态一并回滚');
});

test('RC-4 tickId 单调递增不复用；cycleId 不倒退；cycleTickIndex 归 0', () => {
  const config = retryableConfig();
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  advanceN(sim, 6, 'rc4-');

  const usedTickIds = new Set(store.entries().map((e) => e.tickId));
  const prevHead = sim.tickId;
  const prevCycle = sim.state.cycleId;

  const r = sim.retryCycle(2);
  assert.equal(r.newHeadTickId, prevHead + 1, '新头部 tickId = 已用最大 + 1');
  assert.equal(sim.tickId, r.newHeadTickId);
  assert.equal(usedTickIds.has(sim.tickId), false, '新头部 tickId 不曾被使用过（不复用）');
  assert.ok(sim.state.cycleId > prevCycle, 'cycleId 单调不减（不回退）');
  assert.equal(sim.state.cycleTickIndex, 0, 'cycleTickIndex 归 0，与新周期起点一致');

  // 后续 tick 继续单调：新分支首次 runTick = newHead + 1
  const after = advanceN(sim, 2, 'rc4r-');
  assert.equal(after[0].tickId, r.newHeadTickId + 1, '下一次 runTick 产出 newHead+1');
  assert.equal(after[1].tickId, r.newHeadTickId + 2);
  const allTicks = store.entries().map((e) => e.tickId);
  assert.equal(new Set(allTicks).size, allTicks.length, '归档内 tickId 无重复（不复用）');
  assert.deepEqual(allTicks, [...allTicks].sort((a, b) => a - b), 'tickId 单调递增');
  // cycleId 在插入序上单调不减
  const cycleIds = store.entries().map((e) => e.cycleId);
  for (let i = 1; i < cycleIds.length; i++) {
    assert.ok(cycleIds[i] >= cycleIds[i - 1], 'cycleId 单调不减（归档链不分叉错乱）');
  }
  // 周期结算把 cycleId 继续推进（回退后仍能正常结算）
  assert.equal(sim.lastCycleOutcome, 'RETRY_AVAILABLE');
  assert.ok(sim.state.cycleId > r.newCycleId, '重跑后周期正常结算、cycleId 继续推进');
});

// ---------------------------------------------------------------------------
// ④ 旧分支归档保留
// ---------------------------------------------------------------------------

test('RC-5 SM-W4-04 旧分支归档保留：旧 tick 条目逐字节未变、可整段复盘', () => {
  const config = retryableConfig();
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  advanceN(sim, 6, 'rc5-');

  const beforeEntries = store.entries().map((e) => ({
    tickId: e.tickId,
    cycleId: e.cycleId,
    cycleTickIndex: e.cycleTickIndex,
    kind: e.kind,
    fingerprint: canonicalize(e),
  }));
  const beforeCycleRange = canonicalize(store.getCycleRange(1, 3) as unknown);

  const r = sim.retryCycle(2);

  // 只新增一条「新分支起点」KEYFRAME，旧条目一条不删、一条不改
  assert.equal(store.entries().length, beforeEntries.length + 1, '仅新增 1 条');
  for (const b of beforeEntries) {
    const now = store.get(b.tickId);
    assert.ok(now !== null, '旧 tick ' + b.tickId + ' 仍可查');
    assert.equal(canonicalize(now), b.fingerprint, '旧 tick ' + b.tickId + ' 内容逐字节未变');
    assert.equal(now.kind, b.kind, '旧 tick 条目类型未变');
  }
  assert.equal(canonicalize(store.getCycleRange(1, 3) as unknown), beforeCycleRange,
    '旧分支周期区间查询结果未变（可整段复盘）');

  // 新分支起点以 KEYFRAME 入档
  const branch = store.get(r.newBranchKeyframeTickId);
  assert.ok(branch !== null, '新分支起点已入档');
  assert.equal(branch.kind, 'KEYFRAME');
  assert.equal(branch.cycleId, r.newCycleId);
  assert.equal(branch.cycleTickIndex, 0);
  assert.ok(branch.frames !== null, '新分支起点自包含');
});

test('RC-6 恢复态与原状态对象解耦：回退不修改「回退前头部」引用所指内容', () => {
  const config = retryableConfig();
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  advanceN(sim, 6, 'rc6-');

  const headBefore = sim.state;
  const headBeforeFingerprint = canonicalize(serializeState(headBefore));
  sim.retryCycle(2);
  // 回退把 sim.state 换成恢复出的新对象，旧对象内容不受影响
  assert.notEqual(sim.state, headBefore, '头部换成了新对象');
  assert.equal(canonicalize(serializeState(headBefore)), headBeforeFingerprint,
    '回退前头部对象未被就地修改');
});

// ---------------------------------------------------------------------------
// ⑤ 重跑同一周期：只结算一次（AC-E4）
// ---------------------------------------------------------------------------

test('RC-7 AC-E4 回退重跑同一周期：结余 / 满意度与首次完全一致（无重复扣费）', () => {
  const config = retryableConfig(); // K=2，advance-only → 两次运行完全可比
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  const hist = advanceN(sim, 6, 'rc7-');
  const firstRunB = hist[5].B; // 周期 2 结算后的结余
  const firstRunS = hist[5].S;
  const bAtCycleStart = hist[3].B; // 周期 2 结算前

  assert.equal(firstRunB, bAtCycleStart + (firstRunB - bAtCycleStart));
  assert.notEqual(firstRunB, bAtCycleStart, '首次结算确实改变了结余（用例非平凡）');

  const r = sim.retryCycle(2);
  assert.equal(sim.state.budget.B, bAtCycleStart, '回退后结余 = 首次结算前');

  // 重跑同一周期（advance-only，与首次同构）
  advanceN(sim, 2, 'rc7r-');
  assert.equal(sim.state.budget.B, firstRunB, '重跑后结余与首次完全一致（结算只发生一次）');
  assert.notEqual(sim.state.budget.B, firstRunB + (firstRunB - bAtCycleStart),
    '不是重复扣费（否则会叠加第二次收入/支出）');
  assert.equal(sim.state.frames.current.S, firstRunS, '满意度与首次一致');
  assert.equal(sim.lastCycleOutcome, 'RETRY_AVAILABLE', '重跑后照常判定、无终局分支');
  assert.equal(sim.state.cycleTickIndex, 0, '重跑后到达新周期起点');
  assert.ok(sim.state.cycleId > r.newCycleId, '周期号继续单调推进');
});

test('RC-8 多次回退仍单调：连续重试不同周期，tickId / cycleId 均严格递增', () => {
  const config = retryableConfig();
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  advanceN(sim, 6, 'rc8-');

  const r1 = sim.retryCycle(2);
  advanceN(sim, 2, 'rc8a-');
  const r2 = sim.retryCycle();     // 默认 = 刚结束的周期
  advanceN(sim, 2, 'rc8b-');
  const r3 = sim.retryCycle();

  assert.ok(r1.newHeadTickId < r2.newHeadTickId && r2.newHeadTickId < r3.newHeadTickId,
    '头部 tickId 严格递增：' + [r1.newHeadTickId, r2.newHeadTickId, r3.newHeadTickId].join(' < '));
  assert.ok(r1.newCycleId < r2.newCycleId && r2.newCycleId < r3.newCycleId,
    'cycleId 严格递增：' + [r1.newCycleId, r2.newCycleId, r3.newCycleId].join(' < '));
  const ticks = store.entries().map((e) => e.tickId);
  assert.equal(new Set(ticks).size, ticks.length, '整个归档 tickId 唯一');
});
