import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultConfig,
  createInitialState,
  createSimulation,
  makeCommand,
  canonicalize,
  serializeState,
} from '../../src/index.ts';

function fixture() {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  return { config, state };
}

// S-03 验收 4 / 硬约束 3：连点不双结算
test('S-03-4 连续 2 次、再连续 5 次点「结束本日」，tickId 恰好 +1、TickCommitted = 1', () => {
  const { config, state } = fixture();
  const sim = createSimulation(config, state);

  const first = sim.advanceDay('same-key');
  assert.equal(first.accepted, true);
  assert.equal(sim.tickId, 1);

  for (let i = 0; i < 5; i++) {
    const again = sim.advanceDay('same-key');
    assert.equal(again.accepted, false, `第 ${i + 2} 次连点必须被幂等键拒绝`);
  }
  assert.equal(sim.tickId, 1);
  assert.equal(sim.committedCount, 1);
});

test('硬约束 3 结算期间（P0 阶段内）再次点按被 InputGate 拒绝，不产生第二次结算', () => {
  const { config, state } = fixture();
  let rejectedWhileSettling = 0;
  const sim = createSimulation(config, state, {
    onStage: (stage) => {
      if (stage !== 'P0') return;
      const attempt = sim.advanceDay('during-settlement');
      if (!attempt.accepted) rejectedWhileSettling += 1;
    },
  });
  const result = sim.advanceDay('main');
  assert.equal(result.accepted, true);
  assert.equal(sim.tickId, 1);
  assert.equal(rejectedWhileSettling, 1);
  assert.equal(sim.committedCount, 1);
});

// S-03 验收 4 / 概念 OD-2 边缘第 1 条：暂停态编辑批量提交、只结算一次、不半应用
test('硬约束 3 暂停态编辑批量提交一次结算；提交期间状态不半应用', () => {
  const { config, state } = fixture();
  const sim = createSimulation(config, state);
  const before = canonicalize(serializeState(sim.state));

  sim.submit(makeCommand.zone('z1', 1, 2, 2, 'R', 2));
  sim.submit(makeCommand.zone('z2', 2, 3, 3, 'C', 1));
  sim.submit(makeCommand.road('r1', 3, 2, 3));
  sim.submit(makeCommand.fund('f1', 4, 10));

  assert.equal(canonicalize(serializeState(sim.state)), before, '提交阶段权威状态不变');
  assert.equal(sim.pendingCount, 4);

  const result = sim.advanceDay('go');
  assert.equal(result.accepted, true);
  assert.equal(sim.tickId, 1);
  assert.equal(sim.pendingCount, 0);
  assert.notEqual(canonicalize(serializeState(sim.state)), before);
});

// 硬约束 3：非法命令触发 BudgetRejected 且不应用
test('硬约束 3 锁定区编辑 / 未知分区 / 预算透支 → BudgetRejected，命令不应用', () => {
  const { config, state } = fixture();
  const sim = createSimulation(config, state);
  sim.submit(makeCommand.zone('locked', 1, 20, 20, 'R', 1));
  sim.submit(makeCommand.zone('unknown', 2, 2, 2, 'NOT_A_ZONE', 1));
  sim.submit(makeCommand.fund('overdraft', 3, Number.MAX_SAFE_INTEGER));
  const result = sim.advanceDay('go');
  assert.ok(result.result);
  const rejected = result.result.events.filter((e) => e.type === 'BudgetRejected');
  assert.equal(rejected.length, 3);
  assert.equal(sim.tickId, 1, '非法命令不阻断本次 tick，但也不重复结算');
});

test('硬约束 3 结算中 gate 处于 locked，结算结束后 unlock', () => {
  const { config, state } = fixture();
  let lockedInside = false;
  const sim = createSimulation(config, state, {
    onStage: (stage) => {
      if (stage === 'P4') lockedInside = sim.gate.isLocked;
    },
  });
  sim.advanceDay('go');
  assert.equal(lockedInside, true);
  assert.equal(sim.gate.isLocked, false);
});
