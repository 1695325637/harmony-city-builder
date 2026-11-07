/**
 * HC-01 · S-12 验收 3 · §10.4 降级顺序可执行断言
 *
 * 钉定三件事：
 * ① 五步顺序与 `architecture.md §10.4` 逐项一致、且只能按前缀应用（不跳步 / 不重排）；
 * ② 任何一步都不得关闭 §9.2 可访问性 6 项或 <100ms 即时反馈（G6 否决项）；
 * ③ 断言器**有牙齿**——乱序 / 跳步 / 触碰保护项 / 关闭即时反馈的假计划必须抛错
 *    （吸取 `assertSpacing` 永真断言的教训，绝不写「自己构造自己判」的假绿）。
 *
 * 本文件只验纯逻辑契约；真机上粒子/窗光是否按此序实际关闭，须按校准手册实测。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  DEGRADATION_ORDER,
  PROTECTED_CAPABILITIES,
  buildDegradationPlan,
  assertDegradationPlan,
  type DegradationPlan,
  type ProtectedCapabilityId,
} from '../../src/render/degradation-plan.ts';

function fakePlan(plan: DegradationPlan, patch: Partial<DegradationPlan>): DegradationPlan {
  return { ...plan, ...patch };
}

test('DP-1 §10.4 五步顺序逐项一致（原文语义，非自造）', () => {
  assert.deepEqual(
    DEGRADATION_ORDER.map((s) => [s.id, s.label]),
    [
      ['weatherParticles', '天气粒子 / 雨雪'],
      ['nightWindowAO', '夜间窗光 / 接触 AO'],
      ['vfxParticleCount', 'VFX 粒子数量'],
      ['earlyL0', '更早进入 L0 表现'],
      ['disableAllVfx', '低性能档关闭全部 VFX'],
    ],
    '降级顺序须与 architecture.md §10.4 原文逐项对齐；改顺序即改架构决策',
  );
  assert.deepEqual(
    [...PROTECTED_CAPABILITIES].sort(),
    [
      'immediateFeedback100ms', 'patternLayer', 'semanticTokens', 'shapeEncoding',
      'staticCheck', 'tapTarget', 'textScale',
    ].sort(),
    '禁止降级集 = §9.2 六项 + <100ms 即时反馈（D-8 / G6）',
  );
});

test('DP-2 前缀性质：level 0 无降级；3 = 前三步；5 = 全开（低档关全部 VFX）', () => {
  assert.deepEqual(buildDegradationPlan(0).steps, []);
  assert.deepEqual(buildDegradationPlan(3).steps, [
    'weatherParticles', 'nightWindowAO', 'vfxParticleCount',
  ]);
  assert.deepEqual(buildDegradationPlan(5).steps, [
    'weatherParticles', 'nightWindowAO', 'vfxParticleCount', 'earlyL0', 'disableAllVfx',
  ]);
  assert.throws(() => buildDegradationPlan(6), /整数/);
  assert.throws(() => buildDegradationPlan(1.5), /整数/);
  assert.throws(() => buildDegradationPlan(-1), /整数/);
});

test('DP-3 每一级都通过断言，且受保护能力恒 true（可访问性与 <100ms 不被降级）', () => {
  for (let level = 0; level <= DEGRADATION_ORDER.length; level++) {
    const plan = buildDegradationPlan(level);
    assert.doesNotThrow(() => assertDegradationPlan(plan), 'level=' + level + ' 应合法');
    for (const id of PROTECTED_CAPABILITIES) {
      assert.equal(plan.protectedState[id], true, 'level=' + level + ' 下 ' + id + ' 必须仍启用');
    }
  }
  // 五步关闭的能力全属表现层，无一命中受保护集（数据事实，不是靠注释声明）
  const allDisabled = DEGRADATION_ORDER.flatMap((s) => s.disables);
  assert.ok(allDisabled.length >= 8, '降级步必须有可扫描的 disables 数据');
  for (const d of allDisabled) {
    assert.equal(
      (PROTECTED_CAPABILITIES as readonly string[]).includes(d),
      false,
      d + ' 是受保护能力，不得出现在任何降级步的 disables 里',
    );
  }
});

test('DP-4 牙齿自证 A：乱序 / 跳步 / 步数不符 → 必须抛错', () => {
  const base = buildDegradationPlan(3);
  assert.throws(
    () => assertDegradationPlan(fakePlan(base, {
      steps: ['nightWindowAO', 'weatherParticles', 'vfxParticleCount'],
    })),
    /顺序违反 §10\.4/,
    '前两步对调必须被拦（防止提前关 AO）',
  );
  assert.throws(
    () => assertDegradationPlan(fakePlan(base, {
      steps: ['weatherParticles', 'earlyL0', 'disableAllVfx'],
    })),
    /顺序违反 §10\.4/,
    '跳过 AO / VFX 数量、提前进入 L0 必须被拦',
  );
  assert.throws(
    () => assertDegradationPlan(fakePlan(base, { steps: ['weatherParticles'] })),
    /步数与 level 不符/,
  );
});

test('DP-5 牙齿自证 B：关掉任一受保护能力 → 必须抛错（含 <100ms 反馈）', () => {
  const base = buildDegradationPlan(2);
  for (const id of PROTECTED_CAPABILITIES) {
    const broken = { ...base.protectedState, [id]: false } as Record<ProtectedCapabilityId, boolean>;
    assert.throws(
      () => assertDegradationPlan(fakePlan(base, { protectedState: broken })),
      /受保护能力.*必须保持启用/,
      '把 ' + id + ' 关掉必须被拦——若此断言变绿，说明断言器退化成永真',
    );
  }
});

test('DP-6 静态纪律：本模块零 hex 色值、不 import simulation、不依赖时钟/随机', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'render', 'degradation-plan.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(code), false, '降级契约不得携带任何色值（色只经 semantic-tokens）');
  assert.equal(/from ['"][^'"]*simulation/.test(code), false, '降级契约不得引用 simulation 运行期行为');
  assert.equal(/Math\.random|Date\.now|new Date/.test(code), false, '降级契约须确定性、无时钟');
});
