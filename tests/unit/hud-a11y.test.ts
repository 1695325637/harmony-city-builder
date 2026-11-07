/**
 * HC-01 · S-08 · 可访问性断言单测（项 5 + 追加：低性能档位覆盖 / 减动效双通道）
 *
 * 钉定：热区 ≥48dp（项目硬基线；华为《通用应用 UX 体验标准》2.1.3.3 48vp 推荐 / 40vp 必须，
 * 本项目取推荐值，40vp 仅合规底线不得作为放宽依据）、间距 ≥8dp；
 * 文本缩放 100–200% 不截断/不重叠；减动效双通道
 * （每个可交互控件必须有可读文字标签）；默认档与低性能档下核心控件均可达。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_TAP_TARGET_DP,
  MIN_SPACING_DP,
  isReadableLabel,
  assertTapTarget,
  assertReducedMotionDualChannel,
  assertTextScaleLayout,
  assertReachableAtTier,
  createLayoutModel,
  type A11yControl,
  type HudLayoutModel,
} from '../../src/ui/hud/index.ts';

test('A11Y-1 常量基线：热区 48dp、间距 8dp', () => {
  assert.equal(MIN_TAP_TARGET_DP, 48);
  assert.equal(MIN_SPACING_DP, 8);
});

test('A11Y-2 可读标签判定：单字母/纯数字/纯符号不算，汉字词算', () => {
  assert.equal(isReadableLabel('R'), false, '单字母不算');
  assert.equal(isReadableLabel('1'), false, '纯数字不算');
  assert.equal(isReadableLabel('!'), false, '纯符号不算');
  assert.equal(isReadableLabel('!!'), false, '纯符号组合不算');
  assert.equal(isReadableLabel('居住'), true, '汉字词算');
  assert.equal(isReadableLabel('道路'), true);
});

test('A11Y-3 热区断言边界：47dp 抛错、48dp 通过（含等号）', () => {
  // 边界对照：只改常量不钉边界，等于让 48 成为没人验证过的数字
  assert.throws(
    () => assertTapTarget({ id: 'x', textLabel: '某', tapTargetDp: 47, labelIsTooltipOnly: false }),
    /热区/,
  );
  assert.doesNotThrow(() =>
    assertTapTarget({ id: 'x', textLabel: '某', tapTargetDp: 48, labelIsTooltipOnly: false }),
  );
  // 更小值仍必须抛错（防实现被改成 > 或整体放宽）
  assert.throws(
    () => assertTapTarget({ id: 'x', textLabel: '某', tapTargetDp: 40, labelIsTooltipOnly: false }),
    /热区/,
  );
});

test('A11Y-4 减动效双通道：全部可读标签通过；tooltip-only / 符号标签抛错', () => {
  const good: A11yControl[] = [
    { id: 'tab:R', textLabel: '居住', tapTargetDp: 56, labelIsTooltipOnly: false },
    { id: 'end-day', textLabel: '结束本日', tapTargetDp: 56, labelIsTooltipOnly: false },
  ];
  assert.doesNotThrow(() => assertReducedMotionDualChannel(good));
  const tooltipOnly: A11yControl[] = [
    { id: 'tab:R', textLabel: '居住', tapTargetDp: 56, labelIsTooltipOnly: true },
  ];
  assert.throws(() => assertReducedMotionDualChannel(tooltipOnly), /tooltip/);
  const symbol: A11yControl[] = [{ id: 'tab:R', textLabel: 'R', tapTargetDp: 56, labelIsTooltipOnly: false }];
  assert.throws(() => assertReducedMotionDualChannel(symbol), /不可读/);
});

test('A11Y-5 文本缩放 100–200% 下不截断/不重叠（布局模型断言，无真机）', () => {
  const m = createLayoutModel({ formFactor: 'unfolded', safeArea: [44, 0, 34, 0], textScale: 100, performanceTier: 'default' });
  assert.doesNotThrow(() => assertTextScaleLayout(m, 100));
  assert.doesNotThrow(() => assertTextScaleLayout(m, 175));
  assert.doesNotThrow(() => assertTextScaleLayout(m, 200));
  assert.throws(() => assertTextScaleLayout(m, 250), /超出/);
});

test('A11Y-6 文本缩放溢出：放大后各段最小高度合计超参考高度 → 抛错', () => {
  // 构造一份「各段最小高度过大」的模型，放大后必溢出
  const overflow: HudLayoutModel = {
    formFactor: 'unfolded',
    segments: {
      statusBar: { id: 'statusBar', heightRatio: 0.33, minHeightDp: 500 },
      canvas: { id: 'canvas', heightRatio: 0.34, minHeightDp: 500 },
      thumbZone: { id: 'thumbZone', heightRatio: 0.33, minHeightDp: 500 },
    },
    safeArea: [0, 0, 0, 0],
    textScale: 100,
    performanceTier: 'default',
    degraded: false,
  };
  assert.throws(() => assertTextScaleLayout(overflow, 100), /重叠|溢出/);
});

test('A11Y-7 低性能档位覆盖：default 与 low 两档下核心控件均满足可达性', () => {
  const makeControls = (tier: 'default' | 'low'): A11yControl[] => [
    { id: 'tab:R', textLabel: '居住', tapTargetDp: 56, labelIsTooltipOnly: false },
    { id: 'tab:C', textLabel: '商业', tapTargetDp: 56, labelIsTooltipOnly: false },
    { id: 'tab:I', textLabel: '产业', tapTargetDp: 56, labelIsTooltipOnly: false },
    { id: 'tab:ROAD', textLabel: '道路', tapTargetDp: 56, labelIsTooltipOnly: false },
    { id: 'tab:DEMOLISH', textLabel: '拆除', tapTargetDp: 56, labelIsTooltipOnly: false },
    { id: 'end-day', textLabel: '结束本日', tapTargetDp: 56, labelIsTooltipOnly: false },
  ];
  // 低档可能裁剪控件树，但核心控件（Tab/结束本日）不得丢——两档都跑断言
  assert.doesNotThrow(() => assertReachableAtTier(makeControls('default'), 'default'));
  assert.doesNotThrow(() => assertReachableAtTier(makeControls('low'), 'low'));
});

test('A11Y-8 低档裁剪掉核心控件 → 抛错（功能不降级，只降信息密度）', () => {
  const pruned: A11yControl[] = [
    { id: 'tab:R', textLabel: '居住', tapTargetDp: 56, labelIsTooltipOnly: false },
    { id: 'end-day', textLabel: '结束本日', tapTargetDp: 56, labelIsTooltipOnly: false },
  ];
  assert.throws(() => assertReachableAtTier(pruned, 'low'), /核心控件/);
});
