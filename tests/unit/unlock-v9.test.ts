/**
 * HC-01 · W4 S-11 第一批 H 线 · V9 解锁（T-144）
 *
 * 权威口径：
 *   - production/epics/epic-breakdown.md S-11 验收 4：达标后 V9 解锁下一块地，
 *     进入第二轮规划；解锁进度写入存档（与 S-10 联验）。
 *   - design/gdd/systems/02-map-zoning.md §2 V9 兑（Claim）：周期末 `S >= S_unlock`
 *     → 解锁下一块新区（**新增可用地块，不扩大网格总边界**）；§3.1 网格 N=32 硬上限、
 *     起始 16×16、按里程碑解锁至 32×32；§1.2 红线：不得免费扩张 / 无限地图。
 *   - design/gdd/systems/04-budget-economy.md §6.1 E7：结算顺序固定
 *     **先判定 → 再解锁 / 回退**，解锁与回退互斥、不得同帧。
 *   - tests/smoke-checklist.md SM-W4-05：达标后解锁下一块地、**解锁进度写入存档**、
 *     不得重复解锁。
 *
 * 本批实现的**显式形状假设**（已在回执与 s11-unlock-verification.md 披露，留设计侧钉定）：
 * 「解锁正方形边长阶梯 +2」16×16 → 18² → 20² → … → 32²，共 8 次达标解锁到 MVP 硬上限。
 * 不改 `config.unlockedSide`（属 configHash，改动会触发 D-01 版本漂移）。
 *
 * 真机口径（EX-03）：纯逻辑侧可判 PASS；真机持久化半侧 PARTIAL / BLOCKED，未验证。
 *
 * 运行：node --experimental-strip-types --test tests/unit/unlock-v9.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_GRID_SIDE,
  MAX_UNLOCK_REGIONS,
  START_UNLOCKED_SIDE,
  UNLOCK_STEP_SIDE,
  assertConfigCompatible,
  canonicalize,
  cellIndex,
  computeConfigHash,
  createDefaultConfig,
  createInMemorySaveStorage,
  createInitialState,
  createSaveService,
  createTickWorkspace,
  makeCommand,
  runTick,
  serializeState,
  zoneIndex,
  type CityState,
  type Config,
  type TickResult,
} from '../../src/index.ts';

const SIDE = MAX_GRID_SIDE;

/** 达标即解锁的最短路径配置（S_unlock=0 → 任何周期末都 TARGET_MET） */
function configFor(overrides: Partial<Config> = {}): Config {
  return createDefaultConfig({ K: 2, S_unlock: 0, ...overrides });
}

/** 跑满一个周期（K 个 tick，每 tick 一条 ADVANCE），返回周期末结果与状态 */
function runOneCycle(
  state: CityState,
  config: Config,
  ws: ReturnType<typeof createTickWorkspace>,
  tag: string,
): { state: CityState; result: TickResult } {
  let s = state;
  let result: TickResult | null = null;
  for (let i = 1; i <= config.K; i++) {
    result = runTick(s, [makeCommand.advance(tag + '-a' + i, i)], config, ws);
    s = result.state;
  }
  assert.ok(result, '周期内至少一次结算');
  return { state: s, result };
}

function countUnlocked(state: CityState): number {
  let n = 0;
  for (let i = 0; i < state.cells.unlocked.length; i++) n += state.cells.unlocked[i];
  return n;
}

// ---------------------------------------------------------------------------
// UL-1 达标解锁：形状 / 计数 / 边界 / 版本头
// ---------------------------------------------------------------------------

test('UL-1 达标解锁：新增 18×18 环、region 归 0、unlockedRegions+1、网格与 config 不变', () => {
  const config = configFor();
  const initial = createInitialState(config);
  const before = JSON.parse(JSON.stringify(serializeState(initial)));
  const ws = createTickWorkspace(config, initial.side);

  const { state: s1, result } = runOneCycle(initial, config, ws, 'ul1');

  // ① 判定与计数
  assert.equal(result.cycleOutcome, 'TARGET_MET');
  assert.equal(s1.unlockedRegions, 2, '起始 1 → 达标后 2');

  // ② 形状：恰为 (x<18 && y<18) 的新增环；18² − 16² = 68 格
  const expectedAdded = 18 * 18 - START_UNLOCKED_SIDE * START_UNLOCKED_SIDE;
  assert.equal(countUnlocked(s1) - countUnlocked(initial), expectedAdded, '新增格数 = 18² − 16²');
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const i = cellIndex(SIDE, x, y);
      const inside = x < 18 && y < 18;
      assert.equal(s1.cells.unlocked[i], inside ? 1 : 0, `unlocked(${x},${y})`);
      assert.equal(s1.cells.region[i], inside ? 0 : 1, `region(${x},${y})`);
    }
  }

  // ③ 解锁格必须 bump inputVersion（渲染层 changeStamp 依赖它，不得静默写格）
  const newCell = cellIndex(SIDE, 16, 16);
  assert.ok(s1.cells.inputVersion[newCell] > before.cells.inputVersion[newCell], '新增格版本戳已 bump');
  const outsideCell = cellIndex(SIDE, 20, 20);
  assert.equal(s1.cells.inputVersion[outsideCell], before.cells.inputVersion[outsideCell], '未解锁格版本戳不变');

  // ④ 不扩网格总边界
  assert.equal(s1.cells.unlocked.length, SIDE * SIDE);
  assert.equal(s1.cells.region.length, SIDE * SIDE);
  assert.equal(s1.side, SIDE);

  // ⑤ 不改 config.unlockedSide / 版本头不漂移（D-01 不被破）
  assert.equal(config.unlockedSide, START_UNLOCKED_SIDE, 'config.unlockedSide 必须保持 16');
  assert.equal(s1.configHash, computeConfigHash(config));
  assert.equal(s1.configHash, before.configHash, '解锁不改变 configHash');
  assert.equal(s1.schemaVersion, before.schemaVersion);
  assert.doesNotThrow(() => assertConfigCompatible(s1, config), '解锁后仍通过 D-01 兼容断言');

  // ⑥ P7 阶段可观测：note 带解锁格数
  const p7 = result.stages.find((st) => st.stage === 'P7');
  assert.ok(p7);
  assert.match(p7.note, /cycle settlement uses S_prev; TARGET_MET/);
  assert.match(p7.note, /claim\+68 cells/);
});

// ---------------------------------------------------------------------------
// UL-2 未达标不解锁、不判负
// ---------------------------------------------------------------------------

test('UL-2 未达标不解锁：RETRY_AVAILABLE、cells 逐字节不变、无终局语义、仍可继续', () => {
  const config = configFor({ S_unlock: 99 });
  const initial = createInitialState(config);
  const before = JSON.parse(JSON.stringify(serializeState(initial)));
  const ws = createTickWorkspace(config, initial.side);

  const { state: s1, result } = runOneCycle(initial, config, ws, 'ul2');

  assert.equal(result.cycleOutcome, 'RETRY_AVAILABLE');
  assert.equal(s1.unlockedRegions, 1, '未达标不递增解锁里程碑');
  assert.deepEqual(Array.from(s1.cells.unlocked), before.cells.unlocked, 'cells.unlocked 逐字节不变');
  assert.deepEqual(Array.from(s1.cells.region), before.cells.region, 'cells.region 逐字节不变');
  assert.deepEqual(Array.from(s1.cells.inputVersion), before.cells.inputVersion, '无写格 → 版本戳不变');

  // 无「失败终局」类事件 / 字段；状态仍可继续推进（AC-F5）
  for (const e of result.events) {
    assert.doesNotMatch(String(e.type), /GAME_OVER|GameOver|DEFEAT|FAIL_END/i);
    assert.doesNotMatch(String(e.reason), /GAME_OVER|GameOver|DEFEAT|game over/i);
  }
  // 注意：TickResult / state 由 workspace 复用池承载，跨 runTick 引用前必须先取值
  const tickIdAfterCycle = s1.tickId;
  const p7Note = result.stages.find((st) => st.stage === 'P7')!.note;
  assert.equal(p7Note.includes('claim+'), false, '未达标帧不得解锁');
  const next = runTick(s1, [makeCommand.advance('ul2-next', 1)], config, ws);
  assert.equal(next.tickId, tickIdAfterCycle + 1, '未达标不锁死，仍可继续推进');
});

// ---------------------------------------------------------------------------
// UL-3 单轴：判定只由满意度 S 决定
// ---------------------------------------------------------------------------

test('UL-3 单轴判定：其它量不同但 S 相同 → outcome 一致；S 相差 1 分即翻面', () => {
  const config = configFor({ S_unlock: 60 });
  const ws = createTickWorkspace(config, SIDE);

  const fixed = (S: number) => ({
    aggregate: () => S,
    shortfall: () => 0,
    transform: (f: number) => f,
  });

  // 场景 A：空城、预算 0
  const a = createInitialState(config);
  // 场景 B：同一 config、预算为负、且有建设命令（人口 / 预算 / 命令数都不同）
  const b = createInitialState(config);
  b.budget.B = -80;
  b.cells.zone[cellIndex(SIDE, 2, 2)] = zoneIndex(config, 'R');
  b.cells.density[cellIndex(SIDE, 2, 2)] = 2;

  // TickResult 由 workspace 复用池承载：必须在每次 runTick 后立即取值，不能跨调用持有引用
  const runCycleWith = (state: CityState, S: number, tag: string): string => {
    let s = state;
    let outcome = 'IN_CYCLE';
    for (let i = 1; i <= config.K; i++) {
      const r = runTick(s, [makeCommand.advance(tag + i, i)], config, ws, { aggregator: fixed(S) });
      s = r.state;
      outcome = r.cycleOutcome;
    }
    return outcome;
  };

  assert.equal(runCycleWith(a, 60, 'ul3-a60-'), 'TARGET_MET', 'S=60 达标');
  assert.equal(
    runCycleWith(b, 60, 'ul3-b60-'),
    'TARGET_MET',
    '预算为负 + 有建设，但 S=60 仍达标（只由 S 决定）',
  );
  assert.equal(runCycleWith(a, 59, 'ul3-a59-'), 'RETRY_AVAILABLE', 'S=59 未达标');
  assert.equal(runCycleWith(b, 59, 'ul3-b59-'), 'RETRY_AVAILABLE', 'S=59 仍未达标');

  // 单轴证据：S 恒定时 outcome 恒定；S 翻面即 outcome 翻面（与预算 / 人口 / 命令数无关）
  assert.notEqual(runCycleWith(a, 60, 'ul3-x1-'), runCycleWith(a, 59, 'ul3-x2-'));
});

// ---------------------------------------------------------------------------
// UL-4 上限封顶：解锁至 32×32 后不再重复解锁
// ---------------------------------------------------------------------------

test('UL-4 解锁封顶 32×32：MAX_UNLOCK_REGIONS 后不再写格 / 不再递增 / 不报错', () => {
  const config = configFor({ K: 1, S_unlock: 0 }); // 每 tick 都是周期末
  let s = createInitialState(config);
  const ws = createTickWorkspace(config, s.side);
  const regionsPerTick: number[] = [];

  for (let t = 1; t <= 12; t++) {
    const r = runTick(s, [makeCommand.advance('ul4-' + t, t)], config, ws);
    s = r.state;
    assert.equal(r.cycleOutcome, 'TARGET_MET', 'tick ' + t);
    regionsPerTick.push(s.unlockedRegions);
  }

  assert.equal(MAX_UNLOCK_REGIONS, 1 + (MAX_GRID_SIDE - START_UNLOCKED_SIDE) / UNLOCK_STEP_SIDE);
  assert.equal(MAX_UNLOCK_REGIONS, 9);
  assert.equal(s.unlockedRegions, MAX_UNLOCK_REGIONS, '封顶于 9 个里程碑');
  assert.equal(countUnlocked(s), SIDE * SIDE, '32×32 全部可用');
  assert.equal(s.side, SIDE, '网格总边界不变');

  // 前 8 次递增，第 9 次起封顶
  assert.deepEqual(regionsPerTick.slice(0, 9), [2, 3, 4, 5, 6, 7, 8, 9, 9]);
  assert.deepEqual(regionsPerTick.slice(9), [9, 9, 9], '封顶后不再递增（无重复解锁虚增）');
});

// ---------------------------------------------------------------------------
// UL-5 E7：判定 → 解锁顺序固定，解锁与"可回退"互斥不同帧
// ---------------------------------------------------------------------------

test('UL-5 E7 互斥：同一 tick 唯一 outcome；TARGET_MET 帧才解锁，RETRY 帧零写格', () => {
  // S_unlock=60：注入 S=70 达标 / S=10 未达标，交替验证互斥（不能沿用 S_unlock=0）
  const config = createDefaultConfig({ K: 1, S_unlock: 60 });
  const ws = createTickWorkspace(config, SIDE);
  const fixed = (S: number) => ({ aggregate: () => S, shortfall: () => 0, transform: (f: number) => f });

  let s = createInitialState(config);
  const seen: string[] = [];

  // 交替达标 / 未达标：每个 tick 是独立周期末
  const sequence = [70, 10, 70, 10];
  for (let t = 0; t < sequence.length; t++) {
    const before = JSON.parse(JSON.stringify(serializeState(s)));
    const beforeRegions = s.unlockedRegions;
    const r = runTick(s, [makeCommand.advance('ul5-' + t, t + 1)], config, ws, {
      aggregator: fixed(sequence[t]),
    });
    s = r.state;
    const p7 = r.stages.find((st) => st.stage === 'P7')!;
    seen.push(r.cycleOutcome);

    if (r.cycleOutcome === 'TARGET_MET') {
      assert.ok(s.unlockedRegions > beforeRegions, 'tick ' + t + '：达标帧解锁');
      assert.match(p7.note, /claim\+/);
    } else {
      assert.equal(s.unlockedRegions, beforeRegions, 'tick ' + t + '：未达标帧不解锁');
      assert.deepEqual(Array.from(s.cells.unlocked), before.cells.unlocked, 'tick ' + t + '：零写格');
      assert.deepEqual(Array.from(s.cells.region), before.cells.region);
      assert.equal(p7.note.includes('claim+'), false);
    }
    // 单一 tick 只取一个 outcome（不存在「既达标又重试」）
    assert.ok(['IN_CYCLE', 'TARGET_MET', 'RETRY_AVAILABLE'].includes(r.cycleOutcome));
  }
  assert.deepEqual(seen, ['TARGET_MET', 'RETRY_AVAILABLE', 'TARGET_MET', 'RETRY_AVAILABLE']);
});

// ---------------------------------------------------------------------------
// UL-6 解锁后新格可用；未解锁格仍被 LOCKED_REGION 拒绝
// ---------------------------------------------------------------------------

test('UL-6 解锁后新格可建设；未解锁格仍 BudgetRejected(LOCKED_REGION)', () => {
  const config = configFor();
  const ws = createTickWorkspace(config, SIDE);
  const { state: s1 } = runOneCycle(createInitialState(config), config, ws, 'ul6');

  // 新解锁格 (16,16) 可落单
  const ok = runTick(s1, [makeCommand.zone('ul6-ok', 1, 16, 16, 'R', 1)], config, ws);
  assert.equal(ok.state.cells.zone[cellIndex(SIDE, 16, 16)], zoneIndex(config, 'R'), '新格写入成功');
  assert.equal(ok.events.some((e) => e.type === 'BudgetRejected'), false, '新格不被拒');

  // 仍在锁定区的 (20,20) 被拒
  const bad = runTick(s1, [makeCommand.zone('ul6-bad', 1, 20, 20, 'R', 1)], config, ws);
  const rejected = bad.events.filter((e) => e.type === 'BudgetRejected');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'LOCKED_REGION');
  assert.equal(bad.state.cells.zone[cellIndex(SIDE, 20, 20)], 0, '锁定区不被写入');
});

// ---------------------------------------------------------------------------
// UL-7 与 S-10 联验：解锁进度随存档往返逐字节一致
// ---------------------------------------------------------------------------

test('UL-7 与 S-10 联验：save → load 回来 cells.unlocked / region / unlockedRegions 逐字节一致', () => {
  const config = configFor();
  const ws = createTickWorkspace(config, SIDE);
  const { state: s1 } = runOneCycle(createInitialState(config), config, ws, 'ul7');
  assert.equal(s1.unlockedRegions, 2);

  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const w = svc.save({ state: s1 });
  assert.equal(w.ok, true, '写入成功');

  const l = svc.load(config);
  assert.equal(l.ok, true, '载入成功');
  assert.ok(l.state, '载入状态非空');
  const restored = l.state!;

  assert.deepEqual(Array.from(restored.cells.unlocked), Array.from(s1.cells.unlocked), 'cells.unlocked 逐字节');
  assert.deepEqual(Array.from(restored.cells.region), Array.from(s1.cells.region), 'cells.region 逐字节');
  assert.equal(restored.unlockedRegions, s1.unlockedRegions, '解锁里程碑数一致');
  assert.equal(restored.side, s1.side, '网格边界一致');
  assert.equal(restored.tickId, s1.tickId, '时间轴不推进');
  assert.equal(canonicalize(restored), canonicalize(s1), '整状态 canonicalize 逐字节一致');

  // 载入后再结算仍正常（解锁状态不破坏后续推进）
  // 注意：s1 与 workspace scratch 共享引用，跨 runTick 前必须先取值
  const tickIdAfterCycle = s1.tickId;
  const next = runTick(restored, [makeCommand.advance('ul7-next', 1)], config, ws);
  assert.equal(next.tickId, tickIdAfterCycle + 1);
});

// ---------------------------------------------------------------------------
// UL-8 版本头 / 结构常量证据（禁改版本头的可判定证据）
// ---------------------------------------------------------------------------

test('UL-8 禁改版本头证据：config.unlockedSide / schemaVersion / configHash / side 全程不变', () => {
  const config = configFor({ K: 1 });
  const ws = createTickWorkspace(config, SIDE);
  let s = createInitialState(config);
  const configHash0 = s.configHash;
  const schema0 = s.schemaVersion;

  for (let t = 1; t <= 4; t++) {
    s = runTick(s, [makeCommand.advance('ul8-' + t, t)], config, ws).state;
    assert.equal(config.unlockedSide, START_UNLOCKED_SIDE, 'tick ' + t + '：config.unlockedSide 未被改');
    assert.equal(s.configHash, configHash0, 'tick ' + t + '：configHash 未漂移');
    assert.equal(s.schemaVersion, schema0, 'tick ' + t + '：schemaVersion 未变');
    assert.equal(s.side, SIDE, 'tick ' + t + '：网格总边界未扩');
    assert.equal(computeConfigHash(config), configHash0, 'tick ' + t + '：config 本身未被改');
  }
  // 结构常量口径（非平衡数值）
  assert.equal(START_UNLOCKED_SIDE, 16);
  assert.equal(UNLOCK_STEP_SIDE, 2);
  assert.equal(MAX_GRID_SIDE, 32);
});
