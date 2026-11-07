/**
 * HC-01 · W4 S-11 第一批 H 线 · 软着陆（T-144）
 *
 * 权威口径：
 *   - production/epics/epic-breakdown.md S-11 验收 3：周期判定为满意度单轴，
 *     **无「失败即终局」分支；软着陆（告警而非瞬死，D6 / R5）**。
 *   - design/gdd/systems/04-budget-economy.md §3.3 软着陆表：
 *     ① `B_t < 0` → 生成「预算吃紧」议题交 05；③ 收入有下限 `I_min`；
 *     ④ `B` 有下限 `B_floor`；❌ 判负 / Game Over / 强制拆除 / 不可逆螺旋；
 *     连续多周期赤字保持可恢复，❌ 债务复利 / 罚息滚雪球。
 *   - AC-E2：软着陆不锁死（连续 5 周期赤字可恢复，可通过合法操作回正 `B ≥ 0`）。
 *   - AC-E6：常驻 HUD 只显示「预算结余」一个经济数值（无财政评分 / 成就）。
 *   - ADR-002 A6：P7 只标记「可回退」不判负。
 *
 * 本批实现边界（如实披露，见回执与 s11-unlock-verification.md）：
 *   ✅ 已实现：`B < 0` → `IssuePlaceholder` / reason=`BUDGET_TIGHT` 可观测告警（P7）；
 *              `I_min` 收入下限、`B_floor` 预算下限（既有，不回退）；无任何失败终局。
 *   ⏸ 未实现（GDD 04 §3.3 ②「抑制新增建设 / 分期」）：属玩法规则，
 *      需设计侧钉定拒绝语义与分期方案；硬编码会违反「平衡期数值集中在配置表」，
 *      而新增 Config 字段会改变 `configHash`（破 D-01 版本头冻结）。故本轮只保证
 *      「赤字不静默丢弃合法操作」（SL-8），把该条留后续批次。
 *
 * 真机口径（EX-03）：纯逻辑侧可判 PASS；真机持久化半侧 PARTIAL / BLOCKED，未验证。
 *
 * 运行：node --experimental-strip-types --test tests/unit/soft-landing.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_GRID_SIDE,
  cellIndex,
  createDefaultConfig,
  createInitialState,
  createTickWorkspace,
  makeCommand,
  runTick,
  zoneIndex,
  type CityState,
  type Config,
  type TickResult,
} from '../../src/index.ts';
import { RESIDENT_METRIC_KEYS } from '../../src/ui/index.ts';

const SIDE = MAX_GRID_SIDE;

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

function configFor(overrides: Partial<Config> = {}): Config {
  return createDefaultConfig({ K: 2, S_unlock: 0, ...overrides });
}

/** 跑满一个周期（K 个 tick），返回周期末结果与状态 */
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
  assert.ok(result);
  return { state: s, result };
}

function budgetTightEvents(r: TickResult) {
  return r.events.filter((e) => e.type === 'IssuePlaceholder' && e.reason === 'BUDGET_TIGHT');
}

// ---------------------------------------------------------------------------
// SL-1 软着陆核心：B < 0 只告警、不终局
// ---------------------------------------------------------------------------

test('SL-1 B < 0 只告警不终局：IssuePlaceholder/BUDGET_TIGHT + 周期判定照常 + tick 继续推进', () => {
  const config = configFor();
  const state = createInitialState(config);
  state.budget.B = -50;
  const ws = createTickWorkspace(config, state.side);

  const { state: s1, result } = runOneCycle(state, config, ws, 'sl1');

  const warns = budgetTightEvents(result);
  assert.equal(warns.length, 1, '赤字周期末恰有 1 条预算吃紧告警');
  assert.equal(warns[0].stage, 'P7', '告警由 P7 周期结算发出');
  assert.equal(warns[0].tickId, 2);

  // 判定照常（S=22.5 ≥ S_unlock=0），不因赤字改判、不锁城
  assert.equal(result.cycleOutcome, 'TARGET_MET');
  assert.equal(s1.tickId, 2, 'tick 继续推进');

  // 收入下限 I_min 生效：空城 population=0 仍得 I_min，而不是 0 / 负
  assert.equal(s1.budget.I_t, config.I_min);
  // B 演化线性：−50 + I_min(1) − C_b(0) − C_m(0) = −49
  assert.equal(s1.budget.B, -49);

  // 无任何终局类事件 / 原因
  for (const e of result.events) {
    const bag = String(e.type) + '|' + String(e.reason);
    assert.doesNotMatch(bag, /GAME_OVER|GameOver|DEFEAT|BANKRUPT|FAIL_END/i);
  }

  // P7 阶段可观测：note 带软着陆标记与 B 值
  const p7 = result.stages.find((st) => st.stage === 'P7');
  assert.ok(p7);
  assert.match(p7.note, /soft-landing B=-49/);
});

// ---------------------------------------------------------------------------
// SL-2 / SL-3 收入下限与预算下限
// ---------------------------------------------------------------------------

test('SL-2 收入下限 I_min：B 极负时空城收入仍为 I_min（不为 0、不为负）', () => {
  const config = configFor();
  const state = createInitialState(config);
  state.budget.B = -1000;
  const ws = createTickWorkspace(config, state.side);
  const { state: s1 } = runOneCycle(state, config, ws, 'sl2');

  assert.equal(s1.budget.I_t, config.I_min);
  assert.ok(s1.budget.I_t > 0, '收入恒为正的下限保护');
  assert.equal(s1.budget.B, config.B_floor, 'B 被 B_floor 钳制，不为 −1001');
});

test('SL-3 预算下限 B_floor：大额建设支出也不会把 B 压到 B_floor 以下', () => {
  const config = configFor();
  const state = createInitialState(config);
  state.budget.B = -99;
  const ws = createTickWorkspace(config, state.side);

  // 在起始 16×16 内一次提交 100 条建设命令（density=1 → C_b += 100；C_m += 100×m_zone）
  const cmds = [];
  let n = 0;
  outer: for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (n >= 100) break outer;
      cmds.push(makeCommand.zone('sl3-' + n, n + 1, x, y, 'R', 1));
      n++;
    }
  }
  assert.equal(cmds.length, 100);

  let s = state;
  s = runTick(s, cmds, config, ws).state;
  const r2 = runTick(s, [makeCommand.advance('sl3-a2', 1)], config, ws);
  assert.equal(r2.state.budget.B, config.B_floor, 'B 被钳到 B_floor（无不可逆螺旋）');
  assert.ok(budgetTightEvents(r2).length === 1, '触发下限时仍只告警，不终局');
});

// ---------------------------------------------------------------------------
// SL-4 AC-E2：连续 5 周期赤字不锁死 + 合法操作回正
// ---------------------------------------------------------------------------

test('SL-4 AC-E2 连续赤字可恢复：5 周期赤字不终局，停止支出后收入回正 B ≥ 0', () => {
  const config = configFor();
  const state = createInitialState(config);
  state.budget.B = -5;
  const ws = createTickWorkspace(config, state.side);

  let s = state;
  const warnPerCycle: boolean[] = [];
  const outcomes: string[] = [];
  for (let c = 1; c <= 5; c++) {
    const { state: next, result } = runOneCycle(s, config, ws, 'sl4-c' + c);
    s = next;
    warnPerCycle.push(budgetTightEvents(result).length > 0);
    outcomes.push(result.cycleOutcome);
    assert.ok(['TARGET_MET', 'RETRY_AVAILABLE'].includes(result.cycleOutcome), '周期结果只有两种合法值');
    assert.equal(s.tickId, c * config.K, 'tick 单调推进、不锁死');
  }

  // 空城每周期净 +I_min(1)：−5 → −4 → −3 → −2 → −1 → 0
  assert.equal(s.budget.B, 0, '连续赤字后可通过合法操作（停止支出 / 等待收入）回正');
  assert.deepEqual(warnPerCycle, [true, true, true, true, false], 'B<0 的周期都告警，B=0 起不再告警');
  assert.equal(outcomes.length, 5);

  // 回正后继续推进：无告警、B 继续增长
  const { state: s6, result: r6 } = runOneCycle(s, config, ws, 'sl4-c6');
  assert.equal(budgetTightEvents(r6).length, 0, '回正后不再有预算吃紧告警');
  assert.equal(s6.budget.B, 1);
});

// ---------------------------------------------------------------------------
// SL-5 无复利 / 罚息：B 演化线性
// ---------------------------------------------------------------------------

test('SL-5 无债务复利 / 罚息：不同赤字起点的单周期净变化恒等，源码无乘性惩罚项', () => {
  const config = configFor();

  function netPerCycle(b0: number, tag: string): number {
    const state = createInitialState(config);
    state.budget.B = b0;
    const ws = createTickWorkspace(config, state.side);
    const { state: s1 } = runOneCycle(state, config, ws, tag);
    return s1.budget.B - b0;
  }

  const net50 = netPerCycle(-50, 'sl5-a');
  const net25 = netPerCycle(-25, 'sl5-b');
  assert.equal(net50, net25, '净变化与赤字规模无关 → 无复利 / 罚息乘性项');

  const src = read('src/simulation/tick-pipeline.ts');
  // 注意：`dSPenalty` 是满意度短板惩罚（既有字段），不算债务罚息；故用词边界精确匹配
  assert.doesNotMatch(
    src,
    /\binterest\b|\bcompound\b|\bpenaltyRate\b|罚息|复利|债务/i,
    '源码不得出现复利 / 罚息概念',
  );
});

// ---------------------------------------------------------------------------
// SL-6 无失败终局 / 无强制清空（静态）
// ---------------------------------------------------------------------------

test('SL-6 无失败终局静态证据：P7 源码无 GAME_OVER / 判负 / 强制清空 分支', () => {
  const src = read('src/simulation/tick-pipeline.ts');
  assert.doesNotMatch(src, /GAME_OVER|GameOver|gameOver|judgedefeat|defeat/i);
  assert.doesNotMatch(src, /强制清空|removeAllCells|wipeCells|resetCityState/i);
  // 语义锚点：P7 只产出 OUTCOME 两种合法值 + IN_CYCLE
  assert.match(src, /'TARGET_MET' : 'RETRY_AVAILABLE'/);
});

// ---------------------------------------------------------------------------
// SL-7 AC-E6：常驻经济数值只有「预算结余」一个（只读 UI 常量，不改 UI）
// ---------------------------------------------------------------------------

test('SL-7 AC-E6 常驻指标恰 3 项且经济数值仅 budget（无财政评分 / 成就）', () => {
  assert.deepEqual([...RESIDENT_METRIC_KEYS], ['satisfaction', 'budget', 'period']);
  const economic = RESIDENT_METRIC_KEYS.filter((k) => /budget|fiscal|gdp|revenue|score|achievement/i.test(k));
  assert.deepEqual(economic, ['budget'], '常驻经济数值恰 1 个：预算结余');
});

// ---------------------------------------------------------------------------
// SL-8 边界披露：赤字不抑制合法操作（GDD 04 §3.3 ② 未在本批实现）
// ---------------------------------------------------------------------------

test('SL-8 赤字不静默拒绝合法操作：B<0 时建设 / 注资命令仍正常应用（② 抑制建设留后续）', () => {
  const config = configFor();
  const state = createInitialState(config);
  state.budget.B = -50;
  const ws = createTickWorkspace(config, state.side);

  const r = runTick(
    state,
    [makeCommand.zone('sl8-z', 1, 2, 2, 'R', 1), makeCommand.fund('sl8-f', 2, 20)],
    config,
    ws,
  );
  assert.equal(r.state.cells.zone[cellIndex(SIDE, 2, 2)], zoneIndex(config, 'R'), '赤字不抑制建设');
  assert.equal(r.state.budget.I_f_current, 20, '赤字不抑制注资');
  assert.equal(r.events.some((e) => e.type === 'BudgetRejected'), false, '合法操作不被静默拒绝');
  // 该行为边界已如实披露：GDD 04 §3.3 ②「抑制新增建设 / 分期」属玩法规则，留设计侧钉定
});
