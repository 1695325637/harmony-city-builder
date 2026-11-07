/**
 * HC-08 · UI 层 · 可访问性断言（S-08 项 5 + 追加验收：低性能档位覆盖 / 减动效双通道）
 *
 * 权威口径（只读引用）：
 * - ux-spec §7 E5 / 华为《通用应用 UX 体验标准》2.1.3.3（48vp 推荐 / 40vp 必须，
 *   本项目取**推荐值 48dp**；40vp 仅为合规底线，**不得**作为本项目达标口径或任何放宽依据）；
 * - 热区 ≥ 48dp、控件间距 ≥ 8dp；文本缩放 100–200% 下不截断 / 不重叠；
 * - §3.3「减动效双通道」：每个可交互控件必须有**可读文字标签**（纯数字 / 符号 /
 *   单字母不算，tooltip 不算常驻）——即使关闭动效，颜色 + 文字双通道仍成立。
 *
 * 本文件是**纯断言库**（无副作用、无引擎依赖、无时钟）。它操作 `A11yControl[]`
 * 这种与具体控件解耦的描述结构，因此低性能档位（控件树可能被裁剪）下也能复用同一条断言。
 *
 * 不出现任何色值 / 令牌 / `flow.*` 引用——a11y 只关心几何与文字标签。
 *
 * 口径边界（S-12 补记，防误读）：
 * - 本文件只做**几何（热区尺寸 / 相邻间距 / 布局模型高度）与文字标签**的断言；
 * - 相邻间距判的是 `A11yControl.gapDp`，它是**调用方（HUD 布局侧）注入的声明值**，
 *   即「布局算出来的相邻间距」。本文件不测量真实几何、不读引擎布局结果；
 * - 因此本文件通过 ≠ 真机通过。真机上的**物理命中区间是否真的不重叠**（含触摸
 *   容差 / 系统手势边缘 / 厂商 ROM 缩放）仍须真机验证。本文档与代码任何位置
 *   都**不得**把该断言写成「已真机验证」。
 */

import type { HudLayoutModel } from './layout-profile.ts';

/**
 * 最小热区（dp）。**项目硬基线 = 48dp**（用户 2026-11-07 裁定；与 `architecture.md` /
 * `ADR-004` Amendment / `control-manifest` / `epic-breakdown` 的 48dp 口径一致）。
 *
 * 依据：ux-spec §7 E5 + 华为《通用应用 UX 体验标准》2.1.3.3（48vp 推荐 / 40vp 必须）。
 * 本项目取**更严的推荐值**；40vp 仅为合规底线，**不得**作为达标口径或放宽依据。
 */
export const MIN_TAP_TARGET_DP = 48;
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
  /**
   * 该控件与**相邻控件**之间的最小水平/垂直间距（dp），AC-A05-2 的判定输入。
   * 由 HUD 布局侧计算后注入；本文件不测量、不推导。
   *
   * 可选：为向后兼容既有构造点（既有调用方不传该字段仍然类型合法）。
   * 但 `assertSpacing` 遇到未声明的 `gapDp` 会**显式抛错**——「不可判定」
   * 不等于「通过」，静默跳过正是旧实现的缺陷本体。
   */
  readonly gapDp?: number;
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

/**
 * 相邻控件间距断言（AC-A05-2：相邻热区间距 ≥ 8dp）。
 *
 * 判定输入是 `A11yControl.gapDp`（HUD 布局侧注入的声明值），**不是** `tapTargetDp`。
 * 两者语义与量级都不同（热区 ≥ `MIN_TAP_TARGET_DP` / 间距 ≥ `MIN_SPACING_DP`），
 * 此处刻意**不写死具体 dp 数字**：常量已被裁定改过一次（44→48），正文写死数字
 * 会随常量漂移成事实错误。数字一律以常量为唯一真源。
 * 用热区尺寸顶替间距会让断言恒真
 * ——这正是本函数 S-12 之前的状态，已修。
 *
 * 两条失败路径：
 * - `gapDp` 未声明 → 抛错（不可判定不得静默通过）；
 * - `gapDp < MIN_SPACING_DP` → 抛错。
 *
 * 遍历**全部**控件（修掉旧实现 `length - 1` 漏掉末位控件的 off-by-one）。
 * 空数组按「无相邻控件」vacuous 通过——覆盖度由调用方保证，本函数不做数量断言
 * （数量不足请用 `assertReducedMotionDualChannel` / `assertReachableAtTier`）。
 *
 * 边界：通过本断言只代表**布局声明的间隙**达标；真机物理命中仍须真机验证。
 */
export function assertSpacing(controls: readonly A11yControl[]): void {
  for (const control of controls) {
    const gapDp = control.gapDp;
    if (gapDp === undefined) {
      throw new Error(
        `a11y: 控件 ${control.id} 未声明 gapDp（相邻间距），无法判定 AC-A05-2（需 ≥ ${MIN_SPACING_DP}dp）`,
      );
    }
    if (!(gapDp >= MIN_SPACING_DP)) {
      throw new Error(
        `a11y: 控件 ${control.id} 相邻间距 ${gapDp}dp < 最小 ${MIN_SPACING_DP}dp（AC-A05-2）`,
      );
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
 *
 * 范围说明：本函数**不**调用 `assertSpacing`。间距需要调用方注入 `gapDp`，
 * 属于 HUD 布局组合点上的独立断言（`assertSpacing`），与本函数的「档位不裁剪
 * 核心控件」语义正交。不要把两者的覆盖混为一谈。
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
