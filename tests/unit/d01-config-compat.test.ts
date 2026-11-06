/**
 * HC-01 纯逻辑层 · D-01 回归用例（T-116 / W1 出口门缺口修复）
 *
 * D-01（S1，quality-lead T-114 发现、主理人 T-115 升格）：
 *   `assertConfigCompatible` 全库零调用点 + `deserializeState` 忽略 `_config`
 *   → 旧存档 + 新 config 静默续算（S_t 45 → 32.4，无报错）。
 *
 * 修复（T-116，最小挂接、非重构）：
 *   ① `src/core/schema.ts` deserializeState：`_config` 改实参，载入后强制断言；
 *   ② `src/simulation/session.ts` createSimulation：入口即断言。
 * 任一不匹配必须抛 `ConfigMismatchError`，禁止静默续算（ADR-003 A3 / SM-W1-02）。
 *
 * 运行：node --experimental-strip-types --test tests/unit/d01-config-compat.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ConfigMismatchError,
  createDefaultConfig,
  createInitialState,
  createSimulation,
  deserializeState,
  serializeState,
  makeCommand,
  createTickWorkspace,
  runTick,
} from '../../src/index.ts';

/** 与 T-114 复现步骤同构：configA 建档 → configB 仅改权重（hash 必变） */
function setup() {
  const configA = createDefaultConfig();
  const oldState = createInitialState(configA);
  const configB = createDefaultConfig({ weights: { ...configA.weights, f_c: 0.11 } });
  const oldWire = JSON.parse(JSON.stringify(serializeState(oldState)));
  return { configA, configB, oldState, oldWire };
}

// D-01(a) 旧快照 + 改动后的 config → deserializeState 必须抛 ConfigMismatchError
test('D-01(a) serialize → 改 config（改 f_init）→ deserialize 必须抛 ConfigMismatchError', () => {
  const { configA, oldWire } = setup();
  const configB = createDefaultConfig({ f_init: 0.42 }); // 平衡期数值仍为占位注入，仅作 hash 扰动
  assert.notEqual(configA.f_init, configB.f_init);
  assert.throws(
    () => deserializeState(oldWire, configB),
    ConfigMismatchError,
    'D-01 修复后：载入路径必须拒绝，不得静默返回旧 hash 状态',
  );
});

// D-01(a') 权重扰动路径（与 T-114 复现步骤 1 完全同构）
test('D-01(a\') 旧快照 + 改权重新 config → deserialize 必须抛错（T-114 复现路径）', () => {
  const { configB, oldWire } = setup();
  assert.throws(() => deserializeState(oldWire, configB), ConfigMismatchError);
});

// D-01(a'') schemaVersion 不匹配同样拒绝（断言覆盖两字段）
test('D-01(a\'\') schemaVersion 不匹配 → deserialize 必须抛错', () => {
  const { configA, oldWire } = setup();
  const tampered = { ...oldWire, schemaVersion: 'HC01-SCHEMA-UNKNOWN' };
  assert.throws(() => deserializeState(tampered, configA), ConfigMismatchError);
});

// D-01(b) 匹配 config 回环：serialize → wire → deserialize 成功且逐字段等价
test('D-01(b) 匹配 config 回环 deserialize 成功（schemaVersion + configHash 均一致）', () => {
  const { configA, oldWire } = setup();
  const restored = deserializeState(oldWire, configA);
  assert.equal(restored.configHash, oldWire.configHash);
  assert.equal(restored.schemaVersion, oldWire.schemaVersion);
  // 回环后再结算一次仍正常（载入路径不破坏确定性入口）
  const r = runTick(
    restored,
    [makeCommand.advance('d01b', 1)],
    configA,
    createTickWorkspace(configA, restored.side),
  );
  assert.equal(r.tickId, 1);
});

// D-01(c) createSimulation 传入 configHash 不匹配的 state → 入口抛错
test('D-01(c) createSimulation 传入 configHash 不匹配的 state 必须抛错', () => {
  const { configB, oldState } = setup();
  // state 由 configA 创建（configHash 为旧值），入口即拒绝，不建任何队列 / workspace
  assert.throws(() => createSimulation(configB, oldState), ConfigMismatchError);
  // 同 config 不抛（对照组）
  const { configA } = setup();
  assert.doesNotThrow(() => createSimulation(configA, createInitialState(configA)));
});

// D-01(d) 静默续算路径已封死：绕过 session 直接把旧 state 喂 runTick 属内核
// 显式契约（调用方责任），但所有公开载入入口（deserialize / session）均已断言
test('D-01(d) 公开载入入口全部断言：deserialize + createSimulation 均不再静默接受旧存档', () => {
  const { configA, configB, oldState, oldWire } = setup();
  // deserialize 拒绝（旧 wire + 新 config）
  assert.throws(() => deserializeState(oldWire, configB), ConfigMismatchError);
  // createSimulation 拒绝（旧 state + 新 config）
  assert.throws(() => createSimulation(configB, oldState), ConfigMismatchError);
  // 只有匹配 config 的入口畅通
  assert.doesNotThrow(() => deserializeState(oldWire, configA));
  assert.doesNotThrow(() => createSimulation(configA, deserializeState(oldWire, configA)));
});
