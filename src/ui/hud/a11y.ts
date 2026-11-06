/**
 * HC-08 · UI 层 · 可访问性断言（S-08 项 5 + 追加验收：低性能档位覆盖 / 减动效双通道）
 *
 * 权威口径（只读引用）：
 * - ux-spec §7 E5：热区 ≥ 44dp、控件间距 ≥ 8dp；文本缩放 100–200% 下不截断 / 不重叠；
 * - §3.3「减动效双通道」：每个可交互控件必须有**可读文字标签**（纯数字 / 符号 /
 *   单字母不算，tooltip 不算常驻）——即使关闭动效，颜色 + 文字双通道仍成立。
 *
 * 本文件是**纯断言库**（无副作用、无引擎依赖、无时钟）。它操作 `A11yControl[]`
 * 这种与具体控件解耦的描述结构，因此低性能档位（控件树可能被裁剪）下也能复用同一条断言。
 *
 * 不出现任何色值 / 令牌 / `flow.*` 引用——a11y 只关心几何与文字标签。
 */

import type { HudLayoutModel } from './layout-profile.ts';

/** 最小热区（dp），iOS HIG / Material 通用基线 */
export const MIN_TAP_TARGET_DP = 44;
/** 最小控件间距（dp） */
export const MIN_SPACING_DP = 8;

/** 文本行高基线（dp），用于「文本缩放后不截断」的布局模型断言 */
export const TEXT_LINE_DP = 16;
/** 典型竖屏可用高度参考（dp）——布局模型断言的归一化基准，非真机测量 */
export const REFERENCE_HEIGHT_DP = 800;
/** 单段至少容纳的文本行数（防截断） */
export const MIN_TEXT_LINES = 2;

export interface A11yControl {
  readonly id: string;
  /** 可读文字标签（a11y 硬要求：纯符号 / 单字母 / 纯数字 / 仅 tooltip 都不算） */
  readonly textLabel: string;
  /** 热区最短边（dp） */
  readonly tapTargetDp: number;
  /**
   * 该控件的「标签」是否只存在于 tooltip（tooltip 不算常驻文字标签）。
   * 若为 true，则 `textLabel` 视为不可用于双通道，需经 `hasTooltipOnlyLabel` 单独判。
   */
  readonly labelIsTooltipOnly: boolean;
}

/**
 * 文字标签是否「可读」：
 * - 单字母 / 单符号（length ≤ 1）不算；
 * - 纯数字（如 "42"）不算；
 * - 纯符号（无字母数字）不算；
 * - 否则（含汉字 / 多字母词 / 字母数字混合）算。
 * tooltip 不算由 `labelIsTooltipOnly` 单独处理，**不在本函数内**。
 */
export function isReadableLabel(label: string): boolean {
  if (label.length <= 1) return false;
  if (/^[\d\s]+$/.test(label)) return false; // 纯数字不算
  if (/^[^\p{L}\p{N}]+$/u.test(label)) return false; // 纯符号不算
  return true;
}

/** 单控件热区断言（默认档与低性能档共用） */
export function assertTapTarget(control: A11yControl): void {
  if (!(control.tapTargetDp >= MIN_TAP_TARGET_DP)) {
    throw new Error(
      `a11y: 控件 ${control.id} 热区 ${control.tapTargetDp}dp < 最小 ${MIN_TAP_TARGET_DP}dp（档位无关）`,
    );
  }
}

/** 控件间距断言 */
export function assertSpacing(controls: readonly A11yControl[]): void {
  for (let i = 0; i < controls.length - 1; i++) {
    if (!(controls[i].tapTargetDp >= MIN_SPACING_DP)) {
      throw new Error(`a11y: 控件 ${controls[i].id} 间距不足 ${MIN_SPACING_DP}dp`);
    }
  }
}

/**
 * 减动效双通道：遍历全部可交互控件，每个必须有**可读文字标签**（即使关闭动效，
 * 颜色 + 文字双通道仍成立）。`labelIsTooltipOnly` 的控件视为缺常驻标签 → 抛错。
 * 默认档与低性能档各跑一遍（低档控件树可能裁剪，但核心控件不得丢标签）。
 */
export function assertReducedMotionDualChannel(controls: readonly A11yControl[]): void {
  if (controls.length === 0) throw new Error('a11y: 无任何可交互控件（减动效双通道无从谈起）');
  for (const c of controls) {
    if (c.labelIsTooltipOnly) {
      throw new Error(`a11y: 控件 ${c.id} 的标签只存在于 tooltip（不算常驻文字标签，减动效下信息丢失）`);
    }
    if (!isReadableLabel(c.textLabel)) {
      throw new Error(`a11y: 控件 ${c.id} 标签「${c.textLabel}」不可读（纯符号 / 单字母 / 纯数字不算）`);
    }
  }
}

/**
 * 文本缩放 100–200% 下的布局模型断言（无真机，用布局模型算）：
 * 各段缩放后最小高度 = minHeightDp × textScale/100；
 * - 总缩放最小高度不溢出参考高度（不重叠）；
 * - 每段缩放最小高度 ≥ MIN_TEXT_LINES 行（不截断）。
 * 返回通过 / 抛错（不返回布尔，约定「抛错即失败」）。
 */
export function assertTextScaleLayout(model: HudLayoutModel, textScale: number): void {
  if (!(textScale >= 100 && textScale <= 200)) {
    throw new Error(`a11y: textScale ${textScale} 超出 100–200% 范围`);
  }
  const factor = textScale / 100;
  const ids = Object.keys(model.segments) as (keyof typeof model.segments)[];
  let totalScaled = 0;
  for (const id of ids) {
    const seg = model.segments[id];
    const scaled = seg.minHeightDp * factor;
    totalScaled += scaled;
    if (!(scaled >= MIN_TEXT_LINES * TEXT_LINE_DP)) {
      throw new Error(`a11y: 段 ${id} 在 ${textScale}% 下缩放高度 ${scaled.toFixed(1)}dp < ${MIN_TEXT_LINES} 行(${MIN_TEXT_LINES * TEXT_LINE_DP}dp)，文本截断`);
    }
  }
  if (!(totalScaled <= REFERENCE_HEIGHT_DP)) {
    throw new Error(`a11y: 文本缩放后各段最小高度合计 ${totalScaled.toFixed(1)}dp > 参考高度 ${REFERENCE_HEIGHT_DP}dp，重叠/溢出`);
  }
}

/**
 * 档位覆盖断言：默认档与低性能档下，核心控件（Tab / 结束本日）不得因裁剪丢失，
 * 且热区与标签均满足可达性。供 S-08 追加验收「低性能档位覆盖」调用两次（tier 不同）。
 */
export function assertReachableAtTier(controls: readonly A11yControl[], tier: 'default' | 'low'): void {
  for (const c of controls) assertTapTarget(c);
  assertReducedMotionDualChannel(controls);
  // 核心控件不得因低档裁剪而消失（功能不降级，只降信息密度）
  const ids = new Set(controls.map((c) => c.id));
  for (const essential of ['tab:R', 'tab:C', 'tab:I', 'tab:ROAD', 'tab:DEMOLISH', 'end-day']) {
    if (!ids.has(essential)) {
      throw new Error(`a11y: 档位 ${tier} 下核心控件 ${essential} 缺失（低档可裁剪信息密度，但不得裁剪可达性）`);
    }
  }
}
