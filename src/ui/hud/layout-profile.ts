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

/**
 * 三段高度占比（归一化，三形态统一 0.10 / 0.70 / 0.20）
 * 依据：thumbZone ≥ 20% 满足《通用应用 UX 体验标准》2.1.3.4（等级必须）；
 *        statusBar + thumbZone = 0.30 恰好满足 art-bible §2.4「UI 常驻覆盖率 ≤30%」。
 *        （原手机 0.13/0.69/0.18 合计 0.31，已构成该条违规，S-12 一并修正。）
 *        canvas ≥ 0.70 保证地图为主要可见面积。
 *
 * 最小高度保护（`MIN_*_DP`）与本比例**相互独立**，比例不吸收最小值——
 * 二者在 `REFERENCE_HEIGHT_DP = 800`（见 `./a11y.ts`）下逐段校验：
 * - statusBar 0.10 × 800 = 80dp ≥ MIN_STATUS_DP(48) ✓
 * - thumbZone 0.20 × 800 = 160dp ≥ MIN_THUMB_DP(64) ✓
 * - canvas    0.70 × 800 = 560dp ≥ MIN_CANVAS_DP(240) ✓
 *
 * 三形态当前取值一致（2026-11-07 用户裁定）。**分支结构刻意保留**：形态差异是
 * 已知的将来变更点，删掉分支会让差异回来时重新引入「哪个形态走哪条」的推断成本。
 */
const UNIFIED_SEGMENT_RATIOS: Readonly<Record<HudSegmentId, number>> = Object.freeze({
  statusBar: 0.1,
  canvas: 0.7,
  thumbZone: 0.2,
});

function segmentRatios(formFactor: FormFactor): Readonly<Record<HudSegmentId, number>> {
  if (formFactor === 'folded') {
    return UNIFIED_SEGMENT_RATIOS;
  }
  if (formFactor === 'tablet') {
    return UNIFIED_SEGMENT_RATIOS;
  }
  return UNIFIED_SEGMENT_RATIOS;
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
