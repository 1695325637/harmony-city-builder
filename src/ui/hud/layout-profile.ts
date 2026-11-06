/**
 * HC-08 · UI 层 · 竖屏 HUD 布局模型（S-08 项 1 / 项 6 降级路径）
 *
 * 权威口径（只读引用）：
 * - ux-spec §2.2 三段披露（顶部状态条 / 中央画布区 / 底部拇指区）+ §7 形态适配；
 * - ADR-004「UI 不持有权威状态」：布局模型是**纯几何投影**，只重排不重建。
 *
 * 关键不变量：
 * 1. **节点身份稳定**：三段（statusBar / canvas / thumbZone）的 id 恒定，跨重排不变。
 *    因此 HUD 的选中态 / 滚动位置 / 面板展开态（以节点 id 为键存在独立状态容器里）
 *    **天然跨重排保留**——`reconcileLayout` 绝不会发出 `reset`，也不会让 id 漂移。
 * 2. **降级不降级功能**（项 6）：折叠态 / 安全区接口失败时回落到 folded 单栏，
 *    V1–V9 仍可达（功能不降级，只降信息密度）。断言「接口抛错仍产出可用布局」。
 *
 * 本文件零引擎依赖、零时钟、零随机；不 import core / simulation / render。
 */

import type { FormFactor, LayoutProfile, SafeAreaProvider } from './types.ts';

export type HudSegmentId = 'statusBar' | 'canvas' | 'thumbZone';

export interface HudSegment {
  readonly id: HudSegmentId;
  /** 归一化高度占比 [0,1]，三段之和恒为 1 */
  readonly heightRatio: number;
  /** 最小高度保护（拇指区 ≥ 64dp，保证可达） */
  readonly minHeightDp: number;
}

export interface HudLayoutModel {
  readonly formFactor: FormFactor;
  readonly segments: Readonly<Record<HudSegmentId, HudSegment>>;
  readonly safeArea: readonly [number, number, number, number];
  readonly textScale: number;
  readonly performanceTier: 'default' | 'low';
  /** 降级标志：true = 走了 folded 单栏降级（形态折叠 或 安全区接口失败） */
  readonly degraded: boolean;
}

const MIN_THUMB_DP = 64;
const MIN_STATUS_DP = 48;
const MIN_CANVAS_DP = 240;

/** 三段高度占比（归一化；folded 把更多空间给画布，拇指区收窄但仍 ≥ 最小） */
function segmentRatios(formFactor: FormFactor): Readonly<Record<HudSegmentId, number>> {
  if (formFactor === 'folded') {
    return Object.freeze({ statusBar: 0.12, canvas: 0.7, thumbZone: 0.18 });
  }
  if (formFactor === 'tablet') {
    return Object.freeze({ statusBar: 0.1, canvas: 0.78, thumbZone: 0.12 });
  }
  return Object.freeze({ statusBar: 0.13, canvas: 0.69, thumbZone: 0.18 });
}

function buildSegments(formFactor: FormFactor): Readonly<Record<HudSegmentId, HudSegment>> {
  const ratios = segmentRatios(formFactor);
  const mk = (id: HudSegmentId, ratio: number, min: number): HudSegment =>
    Object.freeze({ id, heightRatio: ratio, minHeightDp: min });
  return Object.freeze({
    statusBar: mk('statusBar', ratios.statusBar, MIN_STATUS_DP),
    canvas: mk('canvas', ratios.canvas, MIN_CANVAS_DP),
    thumbZone: mk('thumbZone', ratios.thumbZone, MIN_THUMB_DP),
  });
}

const FALLBACK_SAFE_AREA: readonly [number, number, number, number] = Object.freeze([0, 0, 0, 0]);

/**
 * 产出 HUD 布局模型。safeAreaProvider 缺省时用内置 fallback（视为已降级）。
 * 若 provider 抛错 → 降级为 folded 单栏 + fallback 安全区，但**仍产出可用布局**
 * （项 6：接口失败不阻断 HUD 渲染）。
 */
export function createLayoutModel(
  profile: LayoutProfile,
  safeAreaProvider?: SafeAreaProvider,
): HudLayoutModel {
  let safeArea = profile.safeArea;
  let degraded = profile.formFactor === 'folded';
  if (safeAreaProvider !== undefined) {
    try {
      safeArea = safeAreaProvider.getSafeArea();
    } catch {
      // 安全区接口失败 → 降级：folded 单栏 + fallback 安全区，布局仍可用（项 6）
      degraded = true;
      safeArea = FALLBACK_SAFE_AREA;
    }
  } else if (degraded) {
    safeArea = FALLBACK_SAFE_AREA;
  }
  const formFactor: FormFactor = degraded ? 'folded' : profile.formFactor;
  return Object.freeze({
    formFactor,
    segments: buildSegments(formFactor),
    safeArea,
    textScale: profile.textScale,
    performanceTier: profile.performanceTier,
    degraded,
  });
}

// ---------------------------------------------------------------------------
// 重排：只重排不重建（节点身份稳定 → 选中 / 滚动 / 面板态跨重排保留）
// ---------------------------------------------------------------------------

export type LayoutOpKind = 'reuse' | 'move' | 'new' | 'remove';

export interface LayoutNodeOp {
  readonly nodeId: HudSegmentId;
  readonly kind: LayoutOpKind;
  readonly fromHeightRatio?: number;
  readonly toHeightRatio?: number;
}

const SEGMENT_IDS: readonly HudSegmentId[] = Object.freeze(['statusBar', 'canvas', 'thumbZone']);

/**
 * 对比前后两版布局，产出「复用 / 移动 / 新增 / 移除」节点操作清单。
 * 三段 id 恒定 → 通常都是 `reuse`（占比不变）或 `move`（占比变了 / 降级切换）；
 * 绝不发出 `reset`，节点 id 不漂移——这就是「选中态 / 滚动位置 / 面板展开态
 * 跨重排保留」的结构保证（调用方把这类状态以节点 id 为键存在独立容器里即可）。
 */
export function reconcileLayout(prev: HudLayoutModel, next: HudLayoutModel): readonly LayoutNodeOp[] {
  const ops: LayoutNodeOp[] = [];
  const prevRatios = prev.segments;
  const nextRatios = next.segments;
  for (const id of SEGMENT_IDS) {
    const had = prevRatios[id] !== undefined;
    const has = nextRatios[id] !== undefined;
    if (had && has) {
      const from = prevRatios[id].heightRatio;
      const to = nextRatios[id].heightRatio;
      ops.push(Object.freeze({ nodeId: id, kind: from === to ? 'reuse' : 'move', fromHeightRatio: from, toHeightRatio: to }));
    } else if (has) {
      ops.push(Object.freeze({ nodeId: id, kind: 'new', toHeightRatio: nextRatios[id].heightRatio }));
    } else {
      ops.push(Object.freeze({ nodeId: id, kind: 'remove', fromHeightRatio: prevRatios[id].heightRatio }));
    }
  }
  return ops;
}

/**
 * 交互状态容器：以节点 id 为键，存选中 / 滚动位置。
 * **与布局模型分离**——reconcileLayout 不触碰它，因此重排后条目仍然有效。
 */
export interface HudLayoutState {
  readonly selectedNode: HudSegmentId;
  readonly scrollY: number;
}

export function createLayoutState(node: HudSegmentId = 'canvas', scrollY = 0): HudLayoutState {
  return Object.freeze({ selectedNode: node, scrollY });
}
