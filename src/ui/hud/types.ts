/**
 * HC-01 · UI 层 · 竖屏 HUD 共享类型（S-08）
 *
 * 本文件只放 HUD 层的**类型与常量**，不 import 引擎 / 不读时钟 / 不读 tick。
 * 视觉色值 / 形状一律不在此出现——HUD 只消费枚举、label 与渲染层下发的
 * 不透明色块（`OpaqueSwatch`），绝不查语义令牌表、绝不读 `flow.*` 字面 id。
 *
 * 跨层契约（GDD 03 v1.1 §3.5.3 + team-lead 2026-11-06 裁定）：
 * - 通勤三态 = **枚举** `FlowState`，不是令牌；
 * - 图例色块 = 渲染层产出的 `OpaqueSwatch`（UI 只读 `label`，`paint` 为 `unknown`）；
 * - UI 侧永不得出现 `'flow.clear' / 'flow.slow' / 'flow.congested'` 字面令牌 id。
 */

// ---------------------------------------------------------------------------
// 形态 / 性能 / 安全区
// ---------------------------------------------------------------------------

/** 形态因子：折叠屏单栏 / 普通竖屏 / 平板横向宽 */
export type FormFactor = 'folded' | 'unfolded' | 'tablet';

/**
 * 性能档位（美术侧提，S-08 追加验收）：
 * 低档会关闭 VFX / 粒子 / 窗光，控件树可能裁剪。HUD 的 a11y 遍历断言须在
 * default 与 low 两种档位下各跑一遍，避免只在默认档跑漏掉裁剪后的可达性缺口。
 */
export type PerformanceTier = 'default' | 'low';

/**
 * 设备布局档案：HUD 排布的唯一输入。
 * - formFactor：形态（folded 单栏 / unfolded 常规 / tablet 横向宽）
 * - safeArea：刘海 / 圆角 / 系统栏的安全内边距 [top, right, bottom, left] dp；
 *   由运行时平台接口提供，**可能抛错**（HUD 必须能降级为 folded 单栏）
 * - textScale：文本缩放 100–200%（用户无障碍设置）
 * - performanceTier：性能档位（default / low）
 */
export interface LayoutProfile {
  readonly formFactor: FormFactor;
  /** 安全区内边距 [top, right, bottom, left] dp；由平台接口提供 */
  readonly safeArea: readonly [number, number, number, number];
  /** 文本缩放百分比：100–200（UX 规范 §7 无障碍缩放上下限） */
  readonly textScale: number;
  readonly performanceTier: PerformanceTier;
}

/** 安全区接口（平台提供，可抛错——HUD 必须能降级） */
export interface SafeAreaProvider {
  /** 返回 [top, right, bottom, left]；接口失败抛错 */
  getSafeArea(): readonly [number, number, number, number];
}

// ---------------------------------------------------------------------------
// 常驻指标（钉死 3 项；人口 / 岗位不得进常驻）
// ---------------------------------------------------------------------------

/**
 * 常驻指标键：**由配置钉定、固定 3 项**（满意度 / 预算结余 / 周期）。
 * 人口 P_t / 岗位 J_t 明确禁止进常驻（只能进 L1 次级披露），见 `NON_RESIDENT_KEYS`。
 * `hud-view-model` 对这两组做硬断言。
 */
export const RESIDENT_METRIC_KEYS = Object.freeze(['satisfaction', 'budget', 'period'] as const);
export type ResidentMetricKey = (typeof RESIDENT_METRIC_KEYS)[number];

/** 明确禁止进常驻的键（人口 / 岗位）——常驻槽位只承载 3 项核心指标 */
export const NON_RESIDENT_KEYS = Object.freeze(['population', 'jobs'] as const);
export type NonResidentKey = (typeof NON_RESIDENT_KEYS)[number];

export type MetricFormat = 'score' | 'currency' | 'period';

export interface HudMetric {
  readonly key: ResidentMetricKey;
  /** 常驻指标必须有可读中文标签（a11y：纯符号 / 单字母 / 纯数字不算） */
  readonly label: string;
  readonly value: number;
  readonly format: MetricFormat;
}

// ---------------------------------------------------------------------------
// 议题（clamp 2~4，即 3±1）
// ---------------------------------------------------------------------------

export type IssueSeverity = 'info' | 'warn' | 'critical';

export interface HudIssue {
  readonly id: string;
  /** 可读标题（a11y：不得是纯符号） */
  readonly title: string;
  readonly severity: IssueSeverity;
}

export interface HudProjection {
  readonly metrics: readonly HudMetric[];
  readonly issues: readonly HudIssue[];
  readonly cycleId: number;
  /** 本周期剩余 tick 数（K - cycleTickIndex） */
  readonly periodRemaining: number;
  /** 周期长度 K */
  readonly periodLength: number;
}

// ---------------------------------------------------------------------------
// 通勤三态（枚举，不是令牌）
// ---------------------------------------------------------------------------

/**
 * 通勤三态枚举（纯枚举、无视觉字段）。
 * 由模拟层产出（GDD 03 v1.1 §3.5，T-133 在跑）、渲染层映射为 `flow.*` 令牌编码。
 * **UI 不查表、不判阈值、不拿 q/cap、不引用 `flow.*` 字面 id**——
 * 只消费本枚举与渲染层图例的 `label`（畅 / 缓 / 堵）。
 */
export type FlowState = 'clear' | 'slow' | 'congested';

/**
 * 渲染层产出的不透明色块：UI 只读 `label` 并整块透传给绘制后端；
 * 不得推断 `paint` 内部结构（owner: render 层）。
 * `paint: unknown` 让 UI 拿不到 `color` / `shape` 字段——**想分支也写不出来**，
 * 因此「不解析内部」在类型上成立，而非靠纪律（team-lead 2026-11-06 裁定采用②）。
 */
export interface OpaqueSwatch {
  readonly label: string;
  readonly paint: unknown;
}

export interface FlowLegendItem {
  readonly flowState: FlowState;
  readonly swatch: OpaqueSwatch;
}

/**
 * pending:s04 —— 模拟层 `TickResult.flowState` 尚未由 T-133 产出，
 * 图例先接 mock 枚举（UI 侧只消费枚举与 label，不读 `flow.*` 令牌 id）。
 * 一旦 T-133 落地，本 mock 列表改为由模拟层 + 渲染层下发，UI 不改动。
 * 注意：条目值是 `'clear' / 'slow' / 'congested'`（**枚举**，无 `flow.` 前缀），
 * 与令牌 id `'flow.clear'` 等是两回事——`src/ui/**` 静态扫描禁止后者出现。
 */
export const MOCK_FLOW_LEGEND: readonly FlowLegendItem[] = Object.freeze([
  { flowState: 'clear', swatch: { label: '畅', paint: null } },
  { flowState: 'slow', swatch: { label: '缓', paint: null } },
  { flowState: 'congested', swatch: { label: '堵', paint: null } },
]);
