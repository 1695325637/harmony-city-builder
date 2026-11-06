import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_GRID_SIDE,
  START_UNLOCKED_SIDE,
  SCHEMA_VERSION,
  ENGINE_VERSION,
  GridLimitExceededError,
  SHARED_VARIABLES,
  createDefaultConfig,
  computeConfigHash,
  createInitialState,
  serializeState,
  deserializeState,
  zoneIndex,
  zoneId,
  cellIndex,
  createTickWorkspace,
  runTick,
  makeCommand,
  assertConfigCompatible,
} from '../../src/index.ts';

// S-02 验收 1 / 4：32×32 可序列化回环；16×16 起步；>32×32 显式拒绝
test('S-02-1 32×32 初始状态可脱离真机序列化 / 反序列化，字段逐字节一致', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  assert.equal(state.side, MAX_GRID_SIDE);
  assert.equal(state.cells.zone.length, MAX_GRID_SIDE * MAX_GRID_SIDE);
  assert.equal(state.schemaVersion, SCHEMA_VERSION);

  const wire = serializeState(state);
  const restored = deserializeState(JSON.parse(JSON.stringify(wire)), config);
  assert.equal(JSON.stringify(serializeState(restored)), JSON.stringify(wire));
  assert.equal(restored.tickId, state.tickId);
  assert.equal(restored.seed, state.seed);
});

test('S-02-1 起始解锁子集恰为 16×16，其余格锁定', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  let unlocked = 0;
  for (let i = 0; i < state.cells.unlocked.length; i++) unlocked += state.cells.unlocked[i];
  assert.equal(unlocked, START_UNLOCKED_SIDE * START_UNLOCKED_SIDE);

  const inside = cellIndex(MAX_GRID_SIDE, 0, 0);
  const outside = cellIndex(MAX_GRID_SIDE, START_UNLOCKED_SIDE, START_UNLOCKED_SIDE);
  assert.equal(state.cells.unlocked[inside], 1);
  assert.equal(state.cells.unlocked[outside], 0);
});

test('S-02-4 >32×32 的加载被显式拒绝（不静默接受）', () => {
  const config = createDefaultConfig();
  assert.throws(
    () => createInitialState(config, { side: MAX_GRID_SIDE + 1 }),
    GridLimitExceededError,
  );
  assert.throws(
    () => deserializeState({ ...serializeState(createInitialState(config)), side: 33 }, config),
    GridLimitExceededError,
  );
});

// S-02 验收 3：分区类型由配置驱动，增 / 减分区不改数据层与加载层代码
test('S-02-3 分区可扩展：增 / 减 zoneTypes 不改数据层代码即可结算', () => {
  const base = createDefaultConfig();
  assert.deepEqual(base.zoneTypes, ['R', 'C', 'I']);

  const extended = createDefaultConfig({ zoneTypes: ['R', 'C', 'I', 'PARK'] });
  const reduced = createDefaultConfig({ zoneTypes: ['R', 'C'] });

  for (const config of [base, extended, reduced]) {
    const state = createInitialState(config);
    const ws = createTickWorkspace(config, state.side);
    const result = runTick(state, [makeCommand.advance('k-1', 1)], config, ws);
    assert.equal(result.tickId, 1);
  }
  assert.equal(zoneId(extended, zoneIndex(extended, 'PARK')), 'PARK');
});

// S-02 验收 2：configHash 变更 + 公式参数只从配置注入
test('S-02-2 变更任一公式参数必升 configHash；同配置 hash 稳定', () => {
  const a = createDefaultConfig();
  const b = createDefaultConfig({ weights: { ...a.weights, f_c: a.weights.f_c * 0.5 } });
  assert.notEqual(computeConfigHash(a), computeConfigHash(b));
  assert.equal(computeConfigHash(a), computeConfigHash(createDefaultConfig()));
  assert.equal(a.meta.kind, 'PLACEHOLDER');
});

test('S-02-2 权重注入生效：改 w_c 会改变 S_t，且模拟结果仍确定', () => {
  const configA = createDefaultConfig();
  const configB = createDefaultConfig({ weights: { ...configA.weights, f_c: configA.weights.f_c * 0.5 } });
  const state = createInitialState(configA);
  const wsA = createTickWorkspace(configA, state.side);
  const wsB = createTickWorkspace(configB, state.side);
  const a = runTick(state, [], configA, wsA);
  const b = runTick(state, [], configB, wsB);
  assert.notEqual(a.state.frames.current.S, b.state.frames.current.S);
});

test('S-02 / ADR-003 版本不匹配时拒绝续算，不静默用新公式', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  assert.doesNotThrow(() => assertConfigCompatible(state, config));
  const other = createDefaultConfig({ weights: { ...config.weights, f_c: 0.11 } });
  assert.throws(() => assertConfigCompatible(state, other));
});

test('数据字典含 14 条共享变量（systems-index §4.2）', () => {
  assert.equal(SHARED_VARIABLES.length, 14);
  assert.ok(SHARED_VARIABLES.some((v) => v.symbol === 'S_t'));
  assert.ok(SHARED_VARIABLES.some((v) => v.symbol === 'n_issue'));
});

test('数据层零引擎 / 零平台依赖（源码静态扫描）', () => {
  const files = ['src/core/types.ts', 'src/core/schema.ts', 'src/core/config.ts'];
  for (const file of files) {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    assert.doesNotMatch(src, /from\s+['"](cocos|@ohos|@harmony|harmony)/i, file);
    assert.doesNotMatch(src, /from\s+['"]node:/i, file);
  }
  assert.equal(typeof ENGINE_VERSION, 'string');
});
