/**
 * HC-01 · T-143 · 回退入口（session 编排层）：幂等 / E7 互斥 / 可判定失败
 *
 * 覆盖：
 * ① `retryCycle` 幂等重放：同目标周期连续调用只推进一次分支标签、不重复入档；
 * ② E7 互斥：`TARGET_MET` 帧（已解锁）拒绝回退，给可判定错误码；
 * ③ 可判定失败：未注入介质 / 空归档 / 目标周期非法 / 周期起始 KEYFRAME 缺失；
 * ④ 结算中（gate 已锁）拒绝回退；
 * ⑤ 既有 advanceDay / submit 行为不变（无介质时零副作用）；
 * ⑥ 显式目标周期：可重试更早的周期，且不回退 cycleId。
 *
 * 【诚实口径】真机未验证（EX-03 顺延、准出阻塞）；DoD D-2 未判定，仅验证结构支撑。
 * 零依赖：Node 22 --experimental-strip-types + node:test。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultConfig,
  createInitialState,
  createSimulation,
  createInMemorySnapshotStore,
  makeCommand,
  serializeState,
  canonicalize,
  type Config,
  type CycleOutcome,
} from '../../src/index.ts';
import { RollbackError, assertRollbackAllowed } from '../../src/simulation/rollback.ts';

const SIDE = 16;

function retryableConfig(): Config {
  return createDefaultConfig({ K: 2, S_unlock: 99 });
}

function makeSim(config: Config, store = createInMemorySnapshotStore()) {
  return createSimulation(config, createInitialState(config, { side: SIDE }), { snapshotStore: store });
}

function advanceN(sim: ReturnType<typeof makeSim>, n: number, prefix: string) {
  for (let t = 1; t <= n; t++) sim.advanceDay(prefix + t);
}

function expectRollbackError(fn: () => unknown, code: string, label: string): void {
  try {
    fn();
    assert.fail(label + ' 应当抛出 RollbackError');
  } catch (e) {
    assert.ok(e instanceof RollbackError, label + ' 须为 RollbackError');
    assert.equal((e as RollbackError).code, code, label + ' 错误码');
    assert.ok((e as RollbackError).message.length > 0, label + ' 须有可展示文案');
  }
}

// ---------------------------------------------------------------------------
// ① 幂等重放
// ---------------------------------------------------------------------------

test('RS-1 幂等：同目标周期连续 retryCycle 只推进一次分支标签、不重复入档', () => {
  const config = retryableConfig();
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  advanceN(sim, 6, 'rs1-');
  const sizeBefore = store.entries().length;

  const r1 = sim.retryCycle(2);
  const sizeAfterFirst = store.entries().length;
  assert.equal(sizeAfterFirst, sizeBefore + 1, '首次回退新增 1 条新分支 KEYFRAME');

  const tickAfterFirst = sim.tickId;
  const cycleAfterFirst = sim.state.cycleId;
  const fpAfterFirst = canonicalize(serializeState(sim.state));

  // 无参重放
  const r2 = sim.retryCycle();
  // 显式同目标重放
  const r3 = sim.retryCycle(2);

  assert.deepEqual(r2, r1, '无参重放返回同一结果');
  assert.deepEqual(r3, r1, '显式同目标重放返回同一结果');
  assert.equal(store.entries().length, sizeAfterFirst, '重放不重复入档');
  assert.equal(sim.tickId, tickAfterFirst, '重放不推进 tickId');
  assert.equal(sim.state.cycleId, cycleAfterFirst, '重放不推进 cycleId');
  assert.equal(canonicalize(serializeState(sim.state)), fpAfterFirst, '重放后状态逐字节不变');

  // 发生新的成功结算后，幂等窗口关闭 → 再次回退是新分支
  sim.advanceDay('rs1-new');
  const r4 = sim.retryCycle();
  assert.notEqual(r4.newHeadTickId, r1.newHeadTickId, '新结算后回退产生新的分支标签');
  assert.ok(r4.newHeadTickId > r1.newHeadTickId, '新分支 tickId 更大');
});

test('RS-2 幂等：重复回退不重复扣费（结余只在真实结算时变化一次）', () => {
  const config = retryableConfig();
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  const hist: number[] = [];
  for (let t = 1; t <= 6; t++) { sim.advanceDay('rs2-' + t); hist.push(sim.state.budget.B); }
  const bAtCycleStart = hist[3];

  sim.retryCycle(2);
  const bAfterFirst = sim.state.budget.B;
  sim.retryCycle(2);
  sim.retryCycle(2);
  assert.equal(sim.state.budget.B, bAfterFirst, '重复回退不改变结余（回退本身无算术）');
  assert.equal(bAfterFirst, bAtCycleStart, '回退后结余 = 周期初值');

  // 只在重跑结算时变一次
  advanceN(sim, 2, 'rs2r-');
  assert.equal(sim.state.budget.B, hist[5], '重跑结算一次 → 与首次一致');
});

// ---------------------------------------------------------------------------
// ② E7 互斥
// ---------------------------------------------------------------------------

test('RS-3 E7 互斥：TARGET_MET 帧（已解锁）拒绝回退，给可判定错误码', () => {
  const config = createDefaultConfig({ K: 2, S_unlock: 0 }); // 必然达标
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  advanceN(sim, 4, 'rs3-');
  assert.equal(sim.lastCycleOutcome, 'TARGET_MET', '用例前提：最近一帧已达标');
  expectRollbackError(() => sim.retryCycle(), 'UNLOCK_COMMITTED_THIS_FRAME', 'E7 同帧回退');
  assert.equal(sim.tickId, 4, '拒绝回退不改变头部');
  assert.equal(store.entries().length, 4, '拒绝回退不写归档');

  // 纯判定函数可独立复用
  assert.throws(() => assertRollbackAllowed('TARGET_MET'), /E7|互斥/);
  assert.doesNotThrow(() => assertRollbackAllowed('RETRY_AVAILABLE'));
  assert.doesNotThrow(() => assertRollbackAllowed('IN_CYCLE'));
});

test('RS-4 E7 互斥只在「该帧」成立：下一帧不再达标后即可回退', () => {
  const config = createDefaultConfig({ K: 2, S_unlock: 0 });
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  advanceN(sim, 4, 'rs4-');
  assert.equal(sim.lastCycleOutcome, 'TARGET_MET');
  sim.advanceDay('rs4-next'); // 新一帧：IN_CYCLE
  assert.equal(sim.lastCycleOutcome, 'IN_CYCLE');
  const r = sim.retryCycle(); // 允许（不再是同帧）
  assert.ok(r.newHeadTickId > 0);
  assert.equal(sim.state.cycleTickIndex, 0, '回退到周期起点');
});

// ---------------------------------------------------------------------------
// ③ 可判定失败
// ---------------------------------------------------------------------------

test('RS-5 可判定失败：未注入介质 / 空归档 / 非法周期 / 起点缺失', () => {
  const config = retryableConfig();

  // (a) 未注入介质
  const noStore = createSimulation(config, createInitialState(config, { side: SIDE }));
  expectRollbackError(() => noStore.retryCycle(), 'STORE_UNAVAILABLE', '未注入归档介质');

  // (b) 空归档（注入了介质但从未结算）
  const empty = makeSim(config, createInMemorySnapshotStore());
  expectRollbackError(() => empty.retryCycle(), 'EMPTY_ARCHIVE', '归档为空');

  // (c) 非法目标周期
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  advanceN(sim, 4, 'rs5-');
  expectRollbackError(() => sim.retryCycle(9), 'INVALID_CYCLE_ID', '目标周期大于当前周期');
  expectRollbackError(() => sim.retryCycle(-1), 'INVALID_CYCLE_ID', '负数周期');
  expectRollbackError(() => sim.retryCycle(1.5), 'INVALID_CYCLE_ID', '非整数周期');

  // (d) 周期起始 KEYFRAME 缺失（周期 0 的初始态从未入档）→ 不得静默落到别的 tick
  expectRollbackError(() => sim.retryCycle(0), 'CYCLE_START_KEYFRAME_MISSING', '周期 0 起点未归档');
  assert.equal(sim.tickId, 4, '失败不改变头部');
});

test('RS-6 结算中（gate 已锁）拒绝回退：SETTLING', () => {
  const config = retryableConfig();
  const store = createInMemorySnapshotStore();
  let caught: string | null = null;
  const sim = createSimulation(config, createInitialState(config, { side: SIDE }), {
    snapshotStore: store,
    onStage: (stage) => {
      if (stage !== 'P0') return;
      if (caught !== null) return;
      try {
        sim.retryCycle();
      } catch (e) {
        caught = e instanceof RollbackError ? e.code : 'NOT_ROLLBACK_ERROR';
      }
    },
  });
  // 先跑一次正常结算让归档非空（否则会先命中 EMPTY_ARCHIVE）
  sim.advanceDay('rs6-seed');
  const r = sim.advanceDay('rs6-main');
  assert.equal(r.accepted, true);
  assert.equal(caught, 'SETTLING', '结算中回退被拒（gate 已锁优先于其它判定）');
});

// ---------------------------------------------------------------------------
// ⑤ 既有行为不变
// ---------------------------------------------------------------------------

test('RS-7 未注入介质时 advanceDay / submit 行为与旧版一致（零副作用）', () => {
  const config = createDefaultConfig();
  const sim = createSimulation(config, createInitialState(config, { side: SIDE }));
  const before = sim.tickId;
  sim.submit(makeCommand.zone('rs7-z', 1, 2, 2, 'R', 2));
  assert.equal(sim.pendingCount, 1);
  const first = sim.advanceDay('rs7-a');
  assert.equal(first.accepted, true);
  assert.equal(sim.tickId, before + 1, '一次结算 tickId +1');
  assert.equal(sim.committedCount, 1);
  assert.equal(sim.pendingCount, 0, '队列已 drain');
  const dup = sim.advanceDay('rs7-a');
  assert.equal(dup.accepted, false, '同 key 连点仍被幂等拒绝（D-03 契约不变）');
  assert.equal(sim.tickId, before + 1);
  assert.equal(sim.lastCycleOutcome, first.result?.cycleOutcome, 'lastCycleOutcome 跟随结算结果');
});

test('RS-8 注入介质后仍不改变 advanceDay 的返回值与幂等语义', () => {
  const config = retryableConfig();
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  const r1 = sim.advanceDay('rs8-a');
  assert.equal(r1.accepted, true);
  assert.equal(r1.result?.tickId, 1);
  assert.equal(r1.events.filter((e) => e.type === 'TickCommitted').length, 1, '一次结算只提交一次');
  const r2 = sim.advanceDay('rs8-a');
  assert.equal(r2.accepted, false, '重复 key 仍被拒');
  assert.equal(store.entries().length, 1, '被拒的连点不写归档');
});

// ---------------------------------------------------------------------------
// ⑥ 显式目标周期
// ---------------------------------------------------------------------------

test('RS-9 显式重试更早的周期：可回退到任意已归档周期起点，cycleId 仍不回退', () => {
  const config = retryableConfig();
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  advanceN(sim, 6, 'rs9-');
  const prevCycle = sim.state.cycleId;

  // 回退到周期 1（起点 tick 2）——比「刚结束的周期 2」更早
  const r = sim.retryCycle(1);
  assert.equal(r.restoredFromTickId, 2, '恢复到周期 1 起点');
  assert.equal(r.previousCycleId, prevCycle);
  assert.ok(r.newCycleId > prevCycle, 'cycleId 取高水位 + 1，不回退');
  assert.equal(sim.state.cycleTickIndex, 0);
  // 旧分支仍然完整
  assert.ok(store.get(4) !== null && store.get(6) !== null, '旧分支条目保留');
});

test('RS-10 回退后再回退：目标周期可指向新分支的周期起点', () => {
  const config = retryableConfig();
  const store = createInMemorySnapshotStore();
  const sim = makeSim(config, store);
  advanceN(sim, 6, 'rs10-');
  const r1 = sim.retryCycle(2);
  // 不结算、直接再回退同一新分支起点 → 幂等
  const r2 = sim.retryCycle(2);
  assert.deepEqual(r2, r1);
  // 重跑后，新分支的周期起点成为可回退目标
  advanceN(sim, 2, 'rs10r-');
  const newCycle = sim.state.cycleId - 1; // 刚结束的周期（新分支）
  const r3 = sim.retryCycle(newCycle);
  assert.equal(r3.restoredFromTickId, r1.newBranchKeyframeTickId, '回到新分支的周期起点');
  assert.ok(r3.newCycleId > r1.newCycleId);
  assert.ok(r3.newHeadTickId > r1.newHeadTickId);
});

// 保留类型引用（CycleOutcome 用于语义钉定）
const _outcomes: readonly CycleOutcome[] = ['IN_CYCLE', 'TARGET_MET', 'RETRY_AVAILABLE'];
void _outcomes;
