/**
 * HC-01 · UI 层 · 动效策略（S-07「减少动态效果」）
 *
 * 权威口径（只读引用）：
 * - `design/art/art-bible.md` §9.2：开启「减少动态效果」后关闭所有 loop / 粒子 /
 *   相机缓动，双态与层级切换改瞬时，**信息不丢失**；§8.4 同款约束。
 * - §8.2 标准缓动与时长（全项目复用）：Fast 120ms / Base 200ms / Slow 320ms。
 *   本层只**引用**这三个数，不新造时长。
 * - ux-spec §3.2 / E4：即时反馈保留**静态**描边 / 按压色（不消失），tick 后反馈
 *   改瞬时跳变。
 * - ADR-004 §2 子决策 6 与备选 A6（**否决「减少动态效果」时连即时反馈一起关掉**）。
 *
 * 纪律：
 * - 本文件不 import `core/simulation`、不读 tick、不读时钟：策略是纯声明。
 * - 静态降级返回**具体编码**（令牌 id + 色 + 形状 + 文字 + 宽度），不返回空值——
 *   「信息不丢失」在类型上表现为 `channels` 始终 ≥ 2 且 `encoding` 必有形状 / 文字。
 * - 落位 / 拆除为何用 `status.positive` / `status.warning`（而非中性 base 色）：
 *   见 `optimistic-view.ts` 顶部「即时反馈的语义色口径」——界线是
 *   「可用性预检 vs 结算结论」（`design/art/reviews/render-s06-art-review.md` 口径 4），
 *   不是「用不用语义色」。**不要为了中性改掉**。
 */

import type { SemanticTokenMap } from '../render/semantic-tokens.ts';
import type { VisualEncoding } from './feedback-bus.ts';
import { encodingOf } from './optimistic-view.ts';

/** 即时反馈类别（ux-spec §3.2「落位、高亮、描边、按压态、扣减预览、面板展开」） */
export type ImmediateFeedbackKind =
  | 'press'
  | 'select'
  | 'highlight'
  | 'tab'
  | 'panel-open'
  | 'placement'
  | 'demolition'
  | 'fund-preview';

export const IMMEDIATE_FEEDBACK_KINDS: readonly ImmediateFeedbackKind[] = Object.freeze([
  'press',
  'select',
  'highlight',
  'tab',
  'panel-open',
  'placement',
  'demolition',
  'fund-preview',
]);

/** 世界动效开关声明（art-bible §9.2 / §8.4 逐项） */
export interface MotionEffects {
  readonly loops: boolean;
  readonly particles: boolean;
  readonly cameraEase: boolean;
}

/** 反馈通道（多通道反馈：单一通道失效时信息仍可达，ux-spec UX-A17） */
export type FeedbackChannelKind = 'color' | 'shape' | 'text' | 'motion';

export type ImmediateFeedbackMode = 'animated' | 'static-outline' | 'static-press-color';

export interface ImmediateFeedbackSpec {
  readonly kind: ImmediateFeedbackKind;
  readonly mode: ImmediateFeedbackMode;
  /** 时长 ms（引用 art-bible §8.2；减少动态效果时为 0 = 瞬时） */
  readonly durationMs: number;
  /** 具体视觉编码（静态降级时依然非空：色 + 形状 + 文字） */
  readonly encoding: VisualEncoding;
  /** 描边宽度 px（静态描边 / 常态描边都用它；art-bible §8.3「选中地块 2px」） */
  readonly outlineWidthPx: number;
  readonly channels: readonly FeedbackChannelKind[];
  /** 恒为 false：降级只换表现，不丢信息（用例断言） */
  readonly informationLost: false;
}

export interface TickFeedbackSpec {
  readonly mode: 'animated' | 'instant';
  readonly durationMs: number;
  readonly encoding: VisualEncoding;
  readonly channels: readonly FeedbackChannelKind[];
  readonly informationLost: false;
}

export interface MotionPolicy {
  readonly reducedMotion: boolean;
  setReducedMotion(value: boolean): void;
  /** 返回切换后的状态 */
  toggleReducedMotion(): boolean;
  /** 世界动效声明：减少动态效果开启时三项全 false（art-bible §9.2） */
  effects(): MotionEffects;
  /** 即时反馈的降级声明（信息不丢失） */
  immediate(kind: ImmediateFeedbackKind): ImmediateFeedbackSpec;
  /** tick 后反馈的降级声明 */
  tickFeedback(): TickFeedbackSpec;
}

export interface MotionPolicyDeps {
  readonly tokens: SemanticTokenMap;
  /** 初始开关状态，默认 false（默认不减少动态效果） */
  readonly reducedMotion?: boolean;
}

/** art-bible §8.2 标准档（只引用，不新造） */
const DURATION_FAST_MS = 120;
const DURATION_BASE_MS = 200;
const DURATION_SLOW_MS = 320;

/** 落位淡入铺开：art-bible §8.3 给 120–180ms（Fast–Base），取中值 180 作为声明值 */
const DURATION_PLACEMENT_MS = 180;

const OUTLINE_WIDTH_PX = 2;

const STATIC_MODE: Readonly<Record<ImmediateFeedbackKind, ImmediateFeedbackMode>> = Object.freeze({
  press: 'static-press-color',
  select: 'static-outline',
  highlight: 'static-outline',
  tab: 'static-press-color',
  'panel-open': 'static-outline',
  placement: 'static-outline',
  demolition: 'static-outline',
  'fund-preview': 'static-outline',
});

const DURATION_OF: Readonly<Record<ImmediateFeedbackKind, number>> = Object.freeze({
  press: DURATION_FAST_MS,
  select: DURATION_FAST_MS,
  highlight: DURATION_FAST_MS,
  tab: DURATION_FAST_MS,
  'panel-open': DURATION_BASE_MS,
  placement: DURATION_PLACEMENT_MS,
  demolition: DURATION_BASE_MS,
  'fund-preview': DURATION_FAST_MS,
});

/**
 * 令牌映射（只取语义令牌 id；色 / 形状一律由 `tokenById` 解析）：
 * - 按压 / Tab / 面板 / 扣减预览 / 选中 / 高亮 → 状态组 `status.selected`
 *   （主色 + 「选中 / 焦点」标签；**不假设 `base.primary` 存在**——渲染层令牌唯一化
 *   已把主色收进 `status.selected` 单一出口）
 * - 落位 → 正向 `status.positive`；拆除 → 提示 `status.warning`
 * 兜底 id 用 `base.ink`（基础组必有的文字色），令牌缺失时不抛错、不借用分区色。
 */
const TOKEN_OF: Readonly<Record<ImmediateFeedbackKind, string>> = Object.freeze({
  press: 'status.selected',
  select: 'status.selected',
  highlight: 'status.selected',
  tab: 'status.selected',
  'panel-open': 'status.selected',
  placement: 'status.positive',
  demolition: 'status.warning',
  'fund-preview': 'status.selected',
});

const TOKEN_FALLBACK = 'base.ink';

const NO_EFFECTS: MotionEffects = Object.freeze({ loops: false, particles: false, cameraEase: false });
const ALL_EFFECTS: MotionEffects = Object.freeze({ loops: true, particles: true, cameraEase: true });

const CHANNELS_ANIMATED: readonly FeedbackChannelKind[] = Object.freeze(['color', 'shape', 'text', 'motion']);
/** 减少动态效果：移除 motion 通道，保留色 + 形状 + 文字（≥2，信息不丢失） */
const CHANNELS_STATIC: readonly FeedbackChannelKind[] = Object.freeze(['color', 'shape', 'text']);

export function createMotionPolicy(deps: MotionPolicyDeps): MotionPolicy {
  const { tokens } = deps;
  let reduced = deps.reducedMotion === true;

  const policy: MotionPolicy = {
    get reducedMotion(): boolean {
      return reduced;
    },
    setReducedMotion(value: boolean): void {
      reduced = value === true;
    },
    toggleReducedMotion(): boolean {
      reduced = !reduced;
      return reduced;
    },
    effects(): MotionEffects {
      return reduced ? NO_EFFECTS : ALL_EFFECTS;
    },
    immediate(kind: ImmediateFeedbackKind): ImmediateFeedbackSpec {
      const encoding = encodingOf(tokens, TOKEN_OF[kind], TOKEN_FALLBACK);
      return Object.freeze({
        kind,
        mode: reduced ? STATIC_MODE[kind] : ('animated' as const),
        durationMs: reduced ? 0 : DURATION_OF[kind],
        encoding,
        outlineWidthPx: OUTLINE_WIDTH_PX,
        channels: reduced ? CHANNELS_STATIC : CHANNELS_ANIMATED,
        informationLost: false as const,
      });
    },
    tickFeedback(): TickFeedbackSpec {
      return Object.freeze({
        mode: reduced ? ('instant' as const) : ('animated' as const),
        durationMs: reduced ? 0 : DURATION_SLOW_MS,
        // 数值变化用文字 / 数值色（art-bible §8.3「数值滚动」），静态时直变
        encoding: encodingOf(tokens, 'base.ink', 'base.tile'),        channels: reduced ? CHANNELS_STATIC : CHANNELS_ANIMATED,
        informationLost: false as const,
      });
    },
  };
  return policy;
}
