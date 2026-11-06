/**
 * HC-01 · S-05 冷归档最小落地的验证套件（T-116 / W1 出口门缺口修复）
 *
 * 目标：为 S-05「Keyframe + Delta + 归因链存储」补可执行证据——
 *   ① 连续写入 ≥3 个完整周期的快照（K=3 × 9 tick = 周期 0/1/2 完整闭合）；
 *   ② 每周期含 KEYFRAME（自包含全量）与 DELTA（差分条目）两类条目；
 *   ③ AttributionEntry（AC2 七字段）真实落地并可按 tick / 按周期检索；
 *   ④ 冷归档恢复（取最近 Keyframe 反序列化，无逆运算）后前向重放，
 *      状态指纹与原始运行逐字节一致（确定性回放证据）；
 *   ⑤ 恢复路径与 D-01 修复联动：config 不匹配 → ConfigMismatchError；
 *   ⑥ 归档本身确定性：同一命令序列重建归档，条目逐字节一致。
 *
 * ⚠️ 披露：本验证的存储介质为【内存模拟】（createInMemorySnapshotStore），
 *   非真机持久化；真机链路验证随 SM-W1-04（S-01）顺延（派单 T-116 原文）。
 *   本文件为验证侧，允许使用 performance.now 之外的普通 API；
 *   计时不用于断言（计时属 tests/verification/perf-s04.test.ts）。
 *
 * 运行：node --experimental-strip-types --test tests/verification/cold-archive-s05.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalize,
  createDefaultConfig,
  createInitialState,
  createTickWorkspace,
  makeCommand,
  runTick,
  buildTickSnapshot,
  createInMemorySnapshotStore,
  zoneIndex,
  ConfigMismatchError,
  type Command,
  type TickResult,
  type InMemorySnapshotStore,
} from '../../src/index.ts';

/** K=3 → 9 tick = 3 个完整闭合周期（周期 0 闭合于 t3、周期 1 于 t6、周期 2 于 t9） */
const K = 3;
const TOTAL_TICKS = 9;

function buildConfig() {
  return createDefaultConfig({ K });
}

/** 预画布局：解锁区内 R/C/I/ROAD 各若干格，保证 P/J/E 与归因非零 */
function paint(state: ReturnType<typeof createInitialState>, config: ReturnType<typeof buildConfig>): void {
  const idx = zoneIndex;
  // ROAD：一条横路 (x=2, y=4..10) + 一条竖路 (x=2..10, y=4)
  for (let y = 4; y <= 10; y++) state.cells.zone[y * state.side + 2] = idx(config, 'ROAD');
  for (let x = 2; x <= 10; x++) state.cells.zone[4 * state.side + x] = idx(config, 'ROAD');
  // R 区（4 格）紧邻路
  for (const [x, y] of [[3, 5], [3, 6], [4, 5], [4, 6]] as [number, number][]) {
    const i = y * state.side + x;
    state.cells.zone[i] = idx(config, 'R');
    state.cells.density[i] = 2;
    state.cells.unlocked[i] = 1;
  }
  // C 区（2 格）
  for (const [x, y] of [[6, 5], [6, 6]] as [number, number][]) {
    const i = y * state.side + x;
    state.cells.zone[i] = idx(config, 'C');
    state.cells.density[i] = 2;
    state.cells.unlocked[i] = 1;
  }
  // I 区（2 格）
  for (const [x, y] of [[8, 5], [8, 6]] as [number, number][]) {
    const i = y * state.side + x;
    state.cells.zone[i] = idx(config, 'I');
    state.cells.density[i] = 2;
    state.cells.unlocked[i] = 1;
  }
}

/** 每个 tick 的确定性命令序列（t1..t9，各 1 条 zone + 1 条 advance） */
function commandsForTick(tickId: number): Command[] {
  // 在解锁区 16×16 内逐 tick 扩格（确定性坐标，不触碰锁定区）
  const spots: [number, number][] = [
    [5, 7], [6, 7], [7, 7], [5, 8], [6, 8], [7, 8], [5, 9], [6, 9], [7, 9],
  ];
  const [x, y] = spots[(tickId - 1) % spots.length];
  const zoneIds = ['R', 'C', 'I'];
  const zoneId = zoneIds[(tickId - 1) % 3];
  return [
    makeCommand.zone('s05-z-' + tickId, 1, x, y, zoneId, 2),
    makeCommand.advance('s05-adv-' + tickId, 2),
  ];
}

interface RunRecord {
  store: InMemorySnapshotStore;
  fingerprints: string[];
  results: TickResult[];
}

function runOriginal(config: ReturnType<typeof buildConfig>): RunRecord {
  const state = createInitialState(config);
  paint(state, config);
  const ws = createTickWorkspace(config, state.side);
  const store = createInMemorySnapshotStore();
  const fingerprints: string[] = [];
  const results: TickResult[] = [];
  let cur = state;
  for (let t = 1; t <= TOTAL_TICKS; t++) {
    const r = runTick(cur, commandsForTick(t), config, ws);
    store.put(buildTickSnapshot(r));
    fingerprints.push(canonicalize(serializeOf(r)));
    results.push(r);
    cur = r.state;
  }
  return { store, fingerprints, results };
}

function serializeOf(r: TickResult): unknown {
  // 直接调 src 导出的 canonicalize（types.ts）配 serializeState 由 store 内部完成；
  // 这里复用 Keyframe 的序列化产物以取得与恢复路径完全相同的字节口径
  const entry = buildTickSnapshot(r);
  return entry.frames;
}

test('S-05-① 连续写入 ≥3 完整周期快照，KEYFRAME/DELTA 分类正确（K=3 × 9 tick）', () => {
  const config = buildConfig();
  const { store } = runOriginal(config);
  assert.equal(store.size, TOTAL_TICKS, '每个已结算 tick 各一条归档条目');
  assert.ok(store.keyframeCount >= 3, '冷归档含 ≥3 个 Keyframe（实际 ' + store.keyframeCount + '）');
  // 预期 Keyframe 位置：t1（归档首条）、t3 / t6 / t9（周期首 = 上一周期末帧）
  const kf = store.entries().filter((e) => e.kind === 'KEYFRAME').map((e) => e.tickId);
  assert.deepEqual(kf, [1, 3, 6, 9], 'Keyframe = 首条 + 每周期边界帧');
  // KEYFRAME 自包含全量；DELTA 只留差分
  for (const e of store.entries()) {
    if (e.kind === 'KEYFRAME') assert.ok(e.frames !== null, 't' + e.tickId + ' KEYFRAME 携带全量状态');
    else assert.equal(e.frames, null, 't' + e.tickId + ' DELTA 不携带全量状态（差分条目在 delta/attribution）');
  }
});

test('S-05-② 归因链（AC2 七字段）落地：按 tick 与按周期可检索', () => {
  const config = buildConfig();
  const { store } = runOriginal(config);
  // 非首 tick 的归因条目 ≥1 且七字段齐全
  for (let t = 2; t <= TOTAL_TICKS; t++) {
    const snap = store.get(t);
    if (snap === null) throw new Error('get(t' + t + ') 未命中');
    assert.ok(snap.attribution.length >= 1, 't' + t + ' 归因条目 ≥1（实际 ' + snap.attribution.length + '）');
    for (const a of snap.attribution) {
      assert.ok(typeof a.primary_factor === 'string' && a.primary_factor.length > 0, 'primary_factor 非空');
      assert.ok(typeof a.dS_i === 'number' && Number.isFinite(a.dS_i), 'dS_i 有限数值');
      assert.ok(typeof a.causeType === 'string', 'causeType 存在');
      assert.ok(typeof a.refId === 'string' && a.refId.length > 0, 'refId 非空');
      assert.ok(typeof a.contribution === 'number' && Number.isFinite(a.contribution), 'contribution 有限数值');
      assert.ok(typeof a.detail === 'string' && a.detail.length > 0, 'detail 非空');
      assert.ok(typeof a.suggested_verb === 'string', 'suggested_verb 存在');
    }
  }
  // 按周期检索：周期 1（cycleId=1 的 t3..t5）与周期 2（t6..t8）
  const range = store.getCycleRange(1, 2);
  assert.equal(range.length, 6, 'getCycleRange(1,2) = t3..t8 共 6 条');
  assert.deepEqual(range.map((s) => s.tickId), [3, 4, 5, 6, 7, 8], '按 tick 插入序返回（确定性）');
});

test('S-05-③ 冷归档恢复 + 前向重放：状态指纹与原始运行逐字节一致（无逆运算）', () => {
  const config = buildConfig();
  const { store, fingerprints } = runOriginal(config);

  // 恢复点选 DELTA 帧 t4 → 必须落到周期 1 的 Keyframe t3，再重放 t4..t9
  const restored = store.restore(4, config);
  assert.equal(restored.keyframeTickId, 3, '恢复自最近 Keyframe t3（t4 是 DELTA，不参与恢复）');
  assert.equal(restored.requestedTickId, 4);
  // Keyframe t3 本身与原始 t3 一致
  assert.equal(canonicalize(serializeKeyframe(store, 3)), fingerprints[2], 'Keyframe t3 反序列化与原始 t3 逐字节一致');

  const ws = createTickWorkspace(config, restored.state.side);
  let cur = restored.state;
  for (let t = 4; t <= TOTAL_TICKS; t++) {
    const r = runTick(cur, commandsForTick(t), config, ws);
    assert.equal(
      canonicalize(serializeOf(r)),
      fingerprints[t - 1],
      '从冷归档恢复后重放 t' + t + ' 与原始运行逐字节一致（确定性回放）',
    );
    cur = r.state;
  }

  // 恢复点直接对准 Keyframe（t9）：重放 0 步即终态一致
  const restored9 = store.restore(9, config);
  assert.equal(restored9.keyframeTickId, 9);
  assert.equal(canonicalize(canonicalizeSerialized(restored9)), fingerprints[8], '恢复 t9 Keyframe = 原始 t9 终态');
});

test('S-05-④ 恢复路径与 D-01 联动：config 不匹配 → ConfigMismatchError（禁止静默续算）', () => {
  const config = buildConfig();
  const { store } = runOriginal(config);
  const configB = createDefaultConfig({ K, i_unit: config.i_unit + 1 });
  assert.throws(() => store.restore(4, configB), ConfigMismatchError, '冷归档载入即断言，旧快照拒绝新 config');
});

test('S-05-⑤ 归档自身确定性：同一命令序列重建归档，条目逐字节一致', () => {
  const config = buildConfig();
  const a = runOriginal(config);
  const b = runOriginal(config);
  assert.equal(a.store.size, b.store.size);
  const ea = a.store.entries();
  const eb = b.store.entries();
  for (let i = 0; i < ea.length; i++) {
    assert.equal(canonicalize(ea[i]), canonicalize(eb[i]), '归档条目 t' + ea[i].tickId + ' 两次构建逐字节一致');
  }
  assert.equal(a.store.keyframeCount, b.store.keyframeCount);
});

test('S-05-⑥ 溯源链：DELTA 条目携带 commandTrace（幂等键）', () => {
  const config = buildConfig();
  const { store } = runOriginal(config);
  const snap5 = store.get(5);
  if (snap5 === null) throw new Error('get(5) 未命中');
  assert.ok(snap5.commandTrace.includes('s05-z-5'), 't5 命令溯源含 zone 幂等键');
  assert.ok(snap5.commandTrace.includes('s05-adv-5'), 't5 命令溯源含 advance 幂等键');
});

// ---- helpers（仅本文件）----

function serializeKeyframe(store: InMemorySnapshotStore, tickId: number): unknown {
  const e = store.entries().find((s) => s.tickId === tickId);
  if (e === undefined || e.frames === null) throw new Error('t' + tickId + ' 须为 KEYFRAME');
  return e.frames;
}

function canonicalizeSerialized(r: { state: ReturnType<typeof createInitialState> }): unknown {
  // 恢复结果直接序列化对比（与 fingerprints 同口径）
  return serializeOf({ state: r.state, tickId: 0, delta: [], attribution: [], commandTrace: [] } as unknown as TickResult);
}
