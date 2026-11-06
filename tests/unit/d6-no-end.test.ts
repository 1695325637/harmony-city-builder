import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  createDefaultConfig,
  createInitialState,
  createTickWorkspace,
  runTick,
  serializeState,
  deserializeState,
  makeCommand,
} from '../../src/index.ts';

function clone(state, config) {
  return deserializeState(JSON.parse(JSON.stringify(serializeState(state))), config);
}

// 硬约束 5 / architecture §3.2.1：D6 单 tick 滞后解环
test('D6-1 S_t（P4）不读本周期 I_t；两态仅 S_{t-1} 不同 → S_t 相同、I_t 不同', () => {
  const config = createDefaultConfig({ K: 1 });
  const base = createInitialState(config);
  const low = clone(base, config);
  const high = clone(base, config);
  // P0 会把 current 推进为新的 prev；这里设置「上一 tick 结果」即 current
  low.frames.current.S = 10;
  high.frames.current.S = 90;

  // 两态用相同布局（3 个居住格），保证 P_t > 0，收入不被 I_min 兜底钳平
  const zones = [
    makeCommand.zone('z1', 1, 2, 2, 'R', 1),
    makeCommand.zone('z2', 2, 3, 2, 'R', 1),
    makeCommand.zone('z3', 3, 4, 2, 'R', 1),
  ];
  const wsLow = createTickWorkspace(config, low.side);
  const wsHigh = createTickWorkspace(config, high.side);
  const a = runTick(low, [...zones, makeCommand.advance('a', 4)], config, wsLow);
  const b = runTick(high, [...zones, makeCommand.advance('a', 4)], config, wsHigh);

  assert.equal(a.state.frames.current.S, b.state.frames.current.S, 'S_t 不得依赖 S_{t-1} 驱动的 I_t');
  assert.notEqual(a.state.budget.I_t, b.state.budget.I_t, 'I_t 必须由 S_{t-1} 结算');
  assert.ok(b.state.budget.I_t > a.state.budget.I_t, 'm(S) 对 S 单调不减');
});

test('D6-2 P4 的 S_t 与最终 S_t 一致（P7 未回写满意度）', () => {
  const config = createDefaultConfig({ K: 1 });
  const state = createInitialState(config);
  const ws = createTickWorkspace(config, state.side);
  const r = runTick(state, [makeCommand.advance('a', 1)], config, ws);
  assert.equal(r.p4Satisfaction, r.state.frames.current.S);
});

test('D6-3 f_f,t 取上一周期已拨付值：改 I_f_current 不影响本 tick S_t，改 I_f_lagged 影响', () => {
  const config = createDefaultConfig({ K: 5 });
  const base = createInitialState(config);
  const ws1 = createTickWorkspace(config, base.side);
  const ws2 = createTickWorkspace(config, base.side);
  const ws3 = createTickWorkspace(config, base.side);

  // 先铺 3 个居住格，使 P_t > 0 → I_ref > 0 → f_f 对 I_f 敏感
  const zones = [
    makeCommand.zone('z1', 1, 2, 2, 'R', 1),
    makeCommand.zone('z2', 2, 3, 2, 'R', 1),
    makeCommand.zone('z3', 3, 4, 2, 'R', 1),
  ];
  const r0 = runTick(base, [...zones, makeCommand.advance('a0', 4)], config, ws1);
  const currentChanged = clone(base, config);
  currentChanged.budget.I_f_current = base.budget.I_f_current + 5;
  const r1 = runTick(currentChanged, [...zones, makeCommand.advance('a1', 4)], config, ws2);
  const laggedChanged = clone(base, config);
  laggedChanged.budget.I_f_lagged = base.budget.I_f_lagged + 5;
  const r2 = runTick(laggedChanged, [...zones, makeCommand.advance('a2', 4)], config, ws3);

  assert.equal(r0.state.frames.current.S, r1.state.frames.current.S, '本周期拨付不影响本 tick 的 f_f');
  assert.notEqual(r0.state.frames.current.S, r2.state.frames.current.S, '上期已拨付值驱动 f_f');
});

test('D6-4 t-1 帧在 P7 阶段可读且未被 S_t 覆盖', () => {
  const config = createDefaultConfig({ K: 1 });
  const state = createInitialState(config);
  // P0 帧推进：把上一 tick 的 current(=42) 变为新的 prev，供 P7 读 S_{t-1}
  state.frames.current.S = 42;
  const ws = createTickWorkspace(config, state.side);
  let prevAtP7 = -1;
  let currentAtP7 = -1;
  runTick(state, [makeCommand.advance('a', 1)], config, ws, {
    onStage: (stage, view) => {
      if (stage === 'P7') {
        prevAtP7 = view.prevS;
        currentAtP7 = view.currentS;
      }
    },
  });
  assert.equal(prevAtP7, 42, 'P7 读到的 S_{t-1} 未被覆盖');
  assert.notEqual(currentAtP7, 42, 'P4 已写入 S_t，与 prev 帧分离');
});

// 硬约束 6 / OD-1 A：无硬终局
test('OD-1 A 连续 3 个周期未达标：不判负、可回退重试、可继续结算', () => {
  const config = createDefaultConfig({ K: 2, S_unlock: 99 });
  const state = createInitialState(config);
  const ws = createTickWorkspace(config, state.side);
  let s = state;
  const outcomes: string[] = [];
  for (let i = 1; i <= 6; i++) {
    const r = runTick(s, [makeCommand.advance(`a${i}`, i)], config, ws);
    if (i % config.K === 0) outcomes.push(r.cycleOutcome);
    s = r.state;
  }
  assert.equal(outcomes.length, 3);
  assert.ok(outcomes.every((o) => o === 'RETRY_AVAILABLE'));
  assert.equal(s.tickId, 6, '未达标不锁死，仍可继续推进');
});

test('硬约束 6 类型与源码均无「失败终局 / Game Over / 判负」分支', () => {
  const dir = join(process.cwd(), 'src');
  const files = [
    ...readdirSync(join(dir, 'core')).map((f) => join('src/core', f)),
    ...readdirSync(join(dir, 'simulation')).map((f) => join('src/simulation', f)),
    'src/index.ts',
  ].filter((f) => f.endsWith('.ts'));
  for (const file of files) {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    assert.doesNotMatch(src, /GAME_OVER|GameOver|gameOver|\u5224\u8d1f|\u5931\u8d25\u7ec8\u5c40|defeat/i, file);
  }
});
