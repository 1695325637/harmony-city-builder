/**
 * HC-01 · UI 层 · 通勤三态图例（S-08 项 7 / T-135 真实接线）
 *
 * 权威口径（只读引用）：
 * - GDD 03 v1.1 §3.5.3：三态由模拟层出枚举、渲染层出编码，
 *   **UI 不查表、不判阈值、不拿饱和度，也不得引用任何字面令牌 id**；
 * - team-lead 2026-11-06 裁定（OpaqueSwatch ②）：图例色块由渲染层产出，
 *   UI 只读 `label` 并整块透传 `paint`（`unknown`），不解析内部；
 * - AD-004 双通道：三态着色属通道 B（tick 结算后），即时通道 A 不读三态数据。
 *
 * T-135 接线（替换旧的 mock 图例常量）：
 * - **默认数据源 = 渲染层 `buildFlowLegend()` 产出的真实图例**（真实语义令牌色块），
 *   本文件不再定义任何图例常量 / 占位色块；
 * - `setFlowLegendProvider` 是组合根 / 预览页 / 测试的注入点：可注入绑定了应用
 *   `SemanticTokenMap` 的 provider（显式传参亦可，见 `getFlowLegend` 的可选入参）；
 * - `getFlowLegend()` 无参调用的既有行为完整保留（LEG-1 / LEG-2 不打穿），
 *   `legendLabels()` 恒为 畅 / 缓 / 堵。
 *
 * 纪律（被静态扫描钉定）：
 * - 枚举值是 `'clear' / 'slow' / 'congested'`（无前缀），与渲染层令牌 id 是两回事；
 * - UI 侧永不得出现任何字面令牌 id，也永不解析 `swatch.paint` 内部字段。
 */

import { buildFlowLegend } from '../../render/flow-legend.ts';
import type { FlowLegendItem, FlowLegendProvider, FlowState, OpaqueSwatch } from './types.ts';

/**
 * 默认 provider：渲染层下发的真实三态图例（无参即可用）。
 * 组合根可经 `setFlowLegendProvider` 换成绑定应用令牌表的版本。
 */
let provider: FlowLegendProvider = () => buildFlowLegend();

/**
 * 注入渲染层真实图例；传 `undefined` 复位为默认 provider。
 * 这是「渲染层出编码 → UI 排布文字」的唯一接线口，UI 自身不生产图例数据。
 */
export function setFlowLegendProvider(next: FlowLegendProvider | undefined): void {
  provider = next ?? (() => buildFlowLegend());
}

/**
 * 取通勤三态图例条目（真实图例，非 mock）。
 * `explicit` 为显式传参通道：传入时以它为准，便于调用方注入当帧图例，
 * 但不传时行为与既有版本完全一致。
 */
export function getFlowLegend(explicit?: readonly FlowLegendItem[]): readonly FlowLegendItem[] {
  return explicit ?? provider();
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
export type { OpaqueSwatch, FlowLegendItem, FlowState, FlowLegendProvider };
