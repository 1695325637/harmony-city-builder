import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  PLACEHOLDER_DEFAULTS,
  createDefaultConfig,
  computeConfigHash,
  createInitialState,
  createTickWorkspace,
  runTick,
  makeCommand,
} from '../../src/index.ts';

function allSources(): string[] {
  const core = readdirSync(join(process.cwd(), 'src/core')).map((f) => join('src/core', f));
  const sim = readdirSync(join(process.cwd(), 'src/simulation')).map((f) => join('src/simulation', f));
  return [...core, ...sim, 'src/index.ts'].filter((f) => f.endsWith('.ts'));
}

// 硬约束 9 / systems-index §7.1 / test-strategy §10：平衡期数值不编造、不写成结论
test('配置默认值明确标记为 PLACEHOLDER，且注明「平衡期定 / S-12 前钉定」', () => {
  assert.equal(PLACEHOLDER_DEFAULTS.meta.kind, 'PLACEHOLDER');
  assert.equal(PLACEHOLDER_DEFAULTS.meta.pinnedAt, null);
  assert.match(PLACEHOLDER_DEFAULTS.meta.note, /平衡期定/);
  assert.match(PLACEHOLDER_DEFAULTS.meta.note, /S-12/);
  assert.match(PLACEHOLDER_DEFAULTS.meta.note, /配置表注入/);
});

test('关键平衡期占位符字段齐备且均为有限数（不写死在公式里）', () => {
  const c = createDefaultConfig();
  const numericKeys = [
    'K', 'S_unlock', 'T_0', 'T_max', 'T_s_max', 'E_max', 'i_ref',
    'alpha', 'f_floor', 'lambda', 'f_init', 'p_unit', 'j_C', 'j_I', 'r_labor',
    'i_unit', 'm_min', 'm_max', 'I_min', 'c_zone', 'c_road', 'm_zone', 'm_road',
    'B_floor', 'B_cap', 'v0', 'beta', 'gamma', 'cap', 'qcapMax',
  ];
  for (const key of numericKeys) {
    assert.ok(Number.isFinite(c[key]), `${key} 必须是可注入的有限数占位`);
  }
  for (const key of ['f_c', 'f_s', 'f_e', 'f_f']) {
    assert.ok(Number.isFinite(c.weights[key]), `weights.${key} 必须可注入`);
  }
  for (const v of c.densityCoefficients) assert.ok(Number.isFinite(v));
});

test('configHash 随任一占位符变化而升级（含 K / T_max / 阈值）', () => {
  const base = createDefaultConfig();
  const h = computeConfigHash(base);
  for (const patch of [{ K: base.K + 1 }, { T_max: base.T_max + 1 }, { i_ref: base.i_ref + 1 }]) {
    assert.notEqual(computeConfigHash(createDefaultConfig(patch)), h);
  }
});

test('K 由配置注入：改 K 会改变周期末 tick 的位置', () => {
  for (const K of [2, 3]) {
    const config = createDefaultConfig({ K });
    const state = createInitialState(config);
    const ws = createTickWorkspace(config, state.side);
    let s = state;
    let firstSettlement = -1;
    for (let i = 1; i <= K; i++) {
      const r = runTick(s, [makeCommand.advance(`a${i}`, i)], config, ws);
      if (r.state.budget.I_t > 0 && firstSettlement < 0) firstSettlement = i;
      s = r.state;
    }
    assert.equal(firstSettlement, K);
  }
});

test('模拟层零引擎 / 零平台 / 零渲染依赖（全源码 import 扫描）', () => {
  for (const file of allSources()) {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    assert.doesNotMatch(src, /from\s+['"](cocos|@ohos|@harmony|harmony|three|pixi)/i, file);
    assert.doesNotMatch(src, /from\s+['"]node:/i, file);
  }
});

test('占位符口径未被写成已定稿 / 已冻结结论', () => {
  const src = readFileSync(join(process.cwd(), 'src/core/config.ts'), 'utf8');
  assert.doesNotMatch(src, /已定稿|已冻结|已钉定|最终平衡值|production value/i);
});
