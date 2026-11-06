import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  PIPELINE_STAGES,
  RULE_TO_STAGE,
  createDefaultConfig,
  createInitialState,
  createTickWorkspace,
  runTick,
  makeCommand,
} from '../../src/index.ts';

function simulationSources(): string[] {
  const dir = join(process.cwd(), 'src/simulation');
  return readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => join('src/simulation', f));
}

// S-03 验收 3 / 硬约束 4：P0~P8 顺序固定且可观测
test('S-03-3 一次结算的 stages 顺序为 P0→P8，且每阶段恰好出现一次', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  const ws = createTickWorkspace(config, state.side);
  const result = runTick(state, [makeCommand.advance('a1', 1)], config, ws);
  assert.deepEqual(result.stages.map((s) => s.stage), [...PIPELINE_STAGES]);
  assert.equal(PIPELINE_STAGES.length, 9);
});

// S-03 验收 3：R1~R7 各有对应阶段
test('S-03-3 R1~R7 七条规则在 pipeline 中各有对应阶段', () => {
  const rules = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'];
  for (const rule of rules) {
    assert.ok(RULE_TO_STAGE[rule], `${rule} 必须有对应阶段`);
    assert.ok(PIPELINE_STAGES.includes(RULE_TO_STAGE[rule]), `${rule} 映射到有效阶段`);
  }
  assert.equal(Object.keys(RULE_TO_STAGE).length, 7);
});

// S-03 验收 3 / P3 否决项：P3 复用 P2 通勤图，不得另起半径计算
test('S-03-3 P3 服务覆盖显式复用 P2 通勤图结果', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  const ws = createTickWorkspace(config, state.side);
  const result = runTick(state, [makeCommand.advance('a1', 1)], config, ws);
  const p3 = result.stages.find((s) => s.stage === 'P3');
  assert.ok(p3);
  assert.match(p3.note, /reused:P2/);
  const p2 = result.stages.find((s) => s.stage === 'P2');
  assert.ok(p2);
  assert.equal(result.ruleStages.R6, 'P4');
});

test('硬约束 4 代码库无「纯半径叠 buff / 欧氏距离 / 传送式服务」分支', () => {
  for (const file of simulationSources()) {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    assert.doesNotMatch(src, /euclidean|Math\.hypot|radius|\u534a\u5f84|\u4f20\u9001\u5f0f|teleport/i, file);
  }
});

test('P7 仅在周期末 tick 执行预算结算；非周期末不产生 I_t', () => {
  const config = createDefaultConfig({ K: 3 });
  const state = createInitialState(config);
  const ws = createTickWorkspace(config, state.side);
  let s = state;
  const incomes: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const r = runTick(s, [makeCommand.advance(`a${i}`, i)], config, ws);
    incomes.push(r.state.budget.I_t);
    s = r.state;
  }
  assert.equal(incomes[0], 0);
  assert.equal(incomes[1], 0);
  assert.ok(incomes[2] > 0, '第 3 tick（周期末）才结算收入');
});
