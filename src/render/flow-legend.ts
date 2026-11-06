/**
 * HC-01 · 渲染内核 · 通勤三态接线（S-09 第一批 B 线 / T-135）
 *
 * 权威口径：
 * - GDD 03 v1.1 §3.5.3：模拟层只产三态枚举，渲染层把枚举编码成 flow.* 语义令牌，
 *   UI 只消费枚举与文字 label；三态着色属 AD-004 通道 B（tick 结算后）。
 * - architecture.md §9.1（M14）：色值 / 形状只经 SemanticTokenMap 查询，
 *   本文件零色值字面量，也零占位阈值键 —— 阈值只属模拟层分档，不进渲染层。
 * - AC-T8 ①：枚举到令牌 id 的映射唯一落点在本渲染层文件；draw-list.ts 里既有的
 *   DEFAULT_FLOW_LINE 是「令牌 id 到线宽 / 亮度」的预设表，属另一维度，仍留在渲染层，
 *   本文件不重复该表（L0 线编码仍由 buildDrawList 的 deriveLine 按令牌 id 推导）。
 *
 * 关键语义（勿省）：TickResult.flowState[k] 的下标 k 是通勤求解的「边槽索引」
 * （traffic.ts 中 qSlot 递增写入的顺序），不是格索引 cellIndex。
 * OverlaySpec.cellIndex 需要格索引，故 buildFlowOverlays 必须显式接受
 * 「边槽 → 格」映射参数，由调用方 / 视图模型提供；本文件严禁把循环下标 k
 * 直接当 cellIndex 用，也严禁凭空捏造映射。映射由谁提供见函数注释与交付回执。
 *
 * 本文件不 import 模拟层（保持渲染层单向依赖）：三态枚举以结构化联合类型本地声明，
 * 与模拟层 FlowStateEnum / UI 层 FlowState 结构等价，可直接接收两者的数组。
 */

import { tokenById, buildSemanticTokenMap, type SemanticTokenMap } from './semantic-tokens.ts';
import type { OverlaySpec } from './draw-list.ts';

/** 通勤三态枚举值（结构等价模拟层与 UI 层的同名联合类型；渲染层不反依赖二者） */
export type FlowStateCode = 'clear' | 'slow' | 'congested';

/** 稳定顺序（图例 畅 / 缓 / 堵 与叠层遍历共用，保证确定性） */
export const FLOW_STATE_ORDER: readonly FlowStateCode[] = Object.freeze([
  'clear',
  'slow',
  'congested',
]);

/**
 * 枚举 → 令牌 id 的唯一映射落点（AC-T8 ① / GDD 03 §3.5.3）。
 * 字面令牌 id 只在本渲染层文件出现；UI 侧只见枚举，不见令牌。
 */
export const FLOW_TOKEN_ID: Readonly<Record<FlowStateCode, string>> = Object.freeze({
  clear: 'flow.clear',
  slow: 'flow.slow',
  congested: 'flow.congested',
});

/** 图例文字（渲染层产出，UI 只取 label 排布文字，不解析 paint 内部） */
const FLOW_LEGEND_LABEL: Readonly<Record<FlowStateCode, string>> = Object.freeze({
  clear: '畅',
  slow: '缓',
  congested: '堵',
});

/**
 * 渲染层自有的图例项。swatch.paint 由渲染层用真实语义令牌填充，
 * 对 UI 保持不透明（UI 侧 OpaqueSwatch.paint 为 unknown，类型上写不出解析分支）。
 */
export interface RenderFlowLegendItem {
  readonly flowState: FlowStateCode;
  readonly swatch: {
    readonly label: string;
    readonly paint: unknown;
  };
}

/**
 * 产出渲染层真实图例：每态用 tokenById 取真实令牌填入不透明 paint，
 * label 取 畅 / 缓 / 堵。tokenMap 缺省时按空分区表构建 —— flow.* 令牌由固定的
 * FLOW_SHAPE 表生成，与分区配置无关，故缺省仍是真实令牌，不是占位或假数据。
 *
 * 供 UI 组合根经 setFlowLegendProvider 注入，或作为默认图例数据源直接调用。
 * 确定性：同 tokenMap 同输出；返回数组与元素全部冻结，调用方无法改写。
 */
export function buildFlowLegend(
  tokenMap: SemanticTokenMap = buildSemanticTokenMap([]),
): readonly RenderFlowLegendItem[] {
  const items: RenderFlowLegendItem[] = [];
  for (let i = 0; i < FLOW_STATE_ORDER.length; i++) {
    const code = FLOW_STATE_ORDER[i];
    const token = tokenById(tokenMap, FLOW_TOKEN_ID[code]);
    items.push(
      Object.freeze({
        flowState: code,
        swatch: Object.freeze({
          label: FLOW_LEGEND_LABEL[code],
          paint: token,
        }),
      }),
    );
  }
  return Object.freeze(items);
}

/**
 * 「边槽 → 格」显式映射项。
 * - edgeIndex：flowState 的下标（qSlot 边槽序号），不是格索引；
 * - cellIndex：等距网格格索引，写入 OverlaySpec.cellIndex。
 *
 * 由谁提供：本批不生产该映射。模拟层 TrafficResult 只导出逐边饱和度 / 三态
 * 数组与聚合量，没有「边槽 ↔ 格坐标」对应表；该关系属通勤图拓扑，应由 S-09 的
 * 视图模型 / 组合根在持有邻接表后构造并显式传入。无可用映射时传空数组即可 ——
 * buildFlowOverlays 产出空叠层，诚实不捏造（见 T-135 回执「剩余项」）。
 */
export interface FlowEdgeCell {
  readonly edgeIndex: number;
  readonly cellIndex: number;
}

/**
 * 把 TickResult.flowState[] 转成 OverlaySpec[]（layer = 'flow'），供 buildDrawList 消费。
 *
 * - 只按显式映射 edgeToCell 遍历；cellIndex 一律取 binding.cellIndex，
 *   循环下标 i 仅用于取映射项，绝不拿它当格索引。
 * - 越界 / 未写入 / 未知枚举的边槽跳过，不捏造状态，也不捏造色值。
 * - 不设置 spec.line：交给 buildDrawList 的 deriveLine 按令牌 id 推出线宽 / 亮度，
 *   使三态在 L0 通道 B 上得到正确的线编码。
 * - 输入只有「三态枚举数组 + 令牌表 + 显式边槽到格映射」；不读饱和度、不做阈值比较。
 */
export function buildFlowOverlays(
  flowState: readonly FlowStateCode[],
  tokenMap: SemanticTokenMap,
  edgeToCell: readonly FlowEdgeCell[],
): OverlaySpec[] {
  const overlays: OverlaySpec[] = [];
  for (let i = 0; i < edgeToCell.length; i++) {
    const binding = edgeToCell[i];
    const code = flowState[binding.edgeIndex];
    if (code !== 'clear' && code !== 'slow' && code !== 'congested') continue;
    const token = tokenById(tokenMap, FLOW_TOKEN_ID[code]);
    overlays.push({
      cellIndex: binding.cellIndex,
      layer: 'flow',
      token: {
        id: token.id,
        group: token.group,
        color: token.color,
        shape: token.shape,
        label: token.label,
      },
    });
  }
  return overlays;
}
