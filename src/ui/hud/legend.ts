/**
 * HC-08 · UI 层 · 通勤三态图例（S-08 项 7：只消费渲染层图例，不碰 flow.* 令牌）
 *
 * 权威口径（只读引用）：
 * - GDD 03 v1.1 §3.5.3 跨层契约：三态由模拟层出枚举、渲染层出 `flow.*` 编码，
 *   **UI 不查表、不判阈值、不拿 q/cap，也不得引用 `flow.*` 字面 id**；
 * - team-lead 2026-11-06 裁定（OpaqueSwatch ②）：图例色块由渲染层产出，
 *   UI 只读 `label` 并整块透传 `paint`（`unknown`），不解析内部。
 *
 * 纪律（被静态扫描钉定）：
 * - 本文件**不 import `flow.*` 令牌**、不调用 `tokenById('flow.*')`；
 * - 枚举值是 `'clear' / 'slow' / 'congested'`（无 `flow.` 前缀），与令牌 id 区分；
 * - UI 侧永不得出现 `'flow.clear' / 'flow.slow' / 'flow.congested'` 字面令牌 id。
 *
 * pending:s04 —— 模拟层 `TickResult.flowState` 尚未由 T-133 产出，
 * 图例先接 `MOCK_FLOW_LEGEND`（mock 枚举 + label）。T-133 落地后改为渲染层下发，
 * 本文件对外接口（`getFlowLegend` / 只取 label）不变。
 */

import { MOCK_FLOW_LEGEND, type FlowLegendItem, type FlowState, type OpaqueSwatch } from './types.ts';

/** 取通勤三态图例条目（渲染层下发；当前为 mock，pending:s04） */
export function getFlowLegend(): readonly FlowLegendItem[] {
  return MOCK_FLOW_LEGEND;
}

/**
 * UI 只消费 label（畅 / 缓 / 堵）——绝不读 `flowState` 去查令牌表、
 * 绝不解析 `swatch.paint` 内部。返回的只是文字标签序列。
 */
export function legendLabels(): readonly string[] {
  return getFlowLegend().map((it): string => it.swatch.label);
}

/** 给定枚举值取对应图例条目（仍只暴露 label 与不透明 swatch） */
export function legendItemFor(state: FlowState): FlowLegendItem | undefined {
  return getFlowLegend().find((it): boolean => it.flowState === state);
}

/** 类型导出：UI 仅以「不透明」形式接收渲染层色块，不解析内部 */
export type { OpaqueSwatch, FlowLegendItem, FlowState };
