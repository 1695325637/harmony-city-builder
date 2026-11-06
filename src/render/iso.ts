/**
 * HC-01 · 渲染内核 · 2:1 dimetric 等距投影与深度排序（S-06）
 *
 * 权威口径（只读引用，不得自造）：
 * - art-bible §2.1：2:1 dimetric，单格 128×64 @1x，全项目锁死单一角度、正交投影、
 *   不提供旋转、不做多朝向资产；等距遮挡统一按 Y 轴（屏幕纵向）深度排序，
 *   **禁止逐对象手写 zIndex 例外**。
 * - art-bible §2.2：仅三个固定缩放档位 L0 0.5× / L1 1.0×（默认操作层）/ L2 2.0×，
 *   不做连续缩放、不做角度插值。
 *
 * 约定：
 * - `gridToScreen` 以菱形**顶角**为锚点：screen.x = (gx−gy)·64，screen.y = (gx+gy)·32。
 * - 本文件零引擎依赖（不 import 'cc'）、零平台依赖，可 node:test 直接验证。
 * - 渲染层每帧可分配（不受模拟热路径零分配约束），但本文件自身仍走纯函数。
 */

export const CELL_W = 128;
export const CELL_H = 64;
export const HALF_W = CELL_W / 2;
export const HALF_H = CELL_H / 2;

export interface Point {
  x: number;
  y: number;
}

export type LodLevel = 'L0' | 'L1' | 'L2';

/** art-bible §2.2：只允许三个固定档位，不做连续缩放 / 角度插值 */
export const LOD_LEVELS: readonly LodLevel[] = ['L0', 'L1', 'L2'];

export const ZOOM: Readonly<Record<LodLevel, number>> = { L0: 0.5, L1: 1.0, L2: 2.0 };

export function zoomScale(lod: LodLevel): number {
  return ZOOM[lod];
}

/** 网格坐标 → 屏幕坐标（菱形顶角为锚点；2:1 斜率由此结构保证） */
export function gridToScreen(gx: number, gy: number): Point {
  return { x: (gx - gy) * HALF_W, y: (gx + gy) * HALF_H };
}

/**
 * 屏幕坐标 → 网格浮点坐标（`gridToScreen` 的严格逆变换，往返误差 < 1e-9）。
 * 注意：该函数返回的坐标**不是**格索引；格索引用 `pickCell`。
 */
export function screenToGrid(px: number, py: number): Point {
  const u = px / HALF_W;
  const v = py / HALF_H;
  return { x: (u + v) / 2, y: (v - u) / 2 };
}

export interface CellPick {
  gx: number;
  gy: number;
}

/**
 * 屏幕点拾取格索引（点击命中）。
 * 菱形锚点在顶角时，格内连续坐标覆盖 [g0, g0+1) × [g0, g0+1)，
 * 因此直接对 `screenToGrid` 结果取 floor。共享边 / 顶点处的平局按 floor
 * 归给「右下」侧格（确定性，无随机）。
 */
export function pickCell(px: number, py: number): CellPick {
  const g = screenToGrid(px, py);
  return { gx: Math.floor(g.x), gy: Math.floor(g.y) };
}

/**
 * 深度键：**唯一**的深度规则（无 zIndex 例外）。
 * 先按 gx+gy 升序（屏幕越靠下越后绘制 → 覆盖上方），平局再按 gx 升序，
 * 保证同一 (gx+gy) 的对角线上顺序确定、可回放、无随机。
 * 返回单调可比较的整数键（供只接受 number 的引擎侧排序 / setSiblingIndex 使用）。
 */
export function depthKey(gx: number, gy: number): number {
  const sum = gx + gy;
  return sum * 4096 + gx; // side ≤ 32 时 gx < 4096，键严格单调
}

export interface DepthRef {
  gx: number;
  gy: number;
}

/** 深度比较器（升序 = 从远（上）到近（下）绘制）；返回 -1 / 0 / 1 */
export function compareDepth(a: DepthRef, b: DepthRef): number {
  const sa = a.gx + a.gy;
  const sb = b.gx + b.gy;
  if (sa !== sb) return sa < sb ? -1 : 1;
  if (a.gx !== b.gx) return a.gx < b.gx ? -1 : 1;
  return 0;
}

/**
 * 固定档位缩放的锚点保持：把 `fromLod` 下的屏幕点 `p` 映射到 `toLod`，
 * 使屏幕上的 `anchor` 点保持不动（锚点缩放，非连续缩放——档位切换时一次性换算）。
 */
export function zoomAround(point: Point, anchor: Point, fromLod: LodLevel, toLod: LodLevel): Point {
  const k = zoomScale(toLod) / zoomScale(fromLod);
  return {
    x: anchor.x + (point.x - anchor.x) * k,
    y: anchor.y + (point.y - anchor.y) * k,
  };
}

// ---------------------------------------------------------------------------
// 世界包围盒与视口居中（T-121 P-01：预览页地图被裁 / 不居中的根因治理）
// ---------------------------------------------------------------------------

export interface WorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * 网格的世界包围盒（菱形**四角**参与计算，而非仅锚点）：
 * 格 (gx,gy) 顶角 (cx,cy) = gridToScreen，菱形左/右 ±64、下缘 +64。
 * `isUnlocked` 缺省视为全部格参与（全图概览用）。
 */
export function cellWorldBounds(side: number, isUnlocked?: (gx: number, gy: number) => boolean): WorldBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let gy = 0; gy < side; gy++) {
    for (let gx = 0; gx < side; gx++) {
      if (isUnlocked !== undefined && !isUnlocked(gx, gy)) continue;
      const p = gridToScreen(gx, gy);
      if (p.x - HALF_W < minX) minX = p.x - HALF_W;
      if (p.x + HALF_W > maxX) maxX = p.x + HALF_W;
      if (p.y < minY) minY = p.y;
      if (p.y + CELL_H > maxY) maxY = p.y + CELL_H;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { minX, maxX, minY, maxY };
}

export interface ViewTransform {
  zoom: number;
  tx: number;
  ty: number;
  /** 视口中心对应的世界点（切档不变 ⇒ 档位切换保持视口中心不动） */
  worldCenterX: number;
  worldCenterY: number;
}

/**
 * 按**世界包围盒中心**与固定档位生成 2D 变换（t = translate · scale）：
 * `screen = world * zoom + t`。同一 bounds 下不同档位的 `worldCenter` 相同，
 * 因此切档等价于「以视口中心为锚点调用 `zoomAround`」——L1/L2 局部放大属预期裁切。
 */
export function fitTransform(bounds: WorldBounds, viewportW: number, viewportH: number, lod: LodLevel): ViewTransform {
  const zoom = zoomScale(lod);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { zoom, tx: viewportW / 2 - zoom * cx, ty: viewportH / 2 - zoom * cy, worldCenterX: cx, worldCenterY: cy };
}

export function worldToScreen(p: Point, t: ViewTransform): Point {
  return { x: p.x * t.zoom + t.tx, y: p.y * t.zoom + t.ty };
}

export function screenToWorldPoint(p: Point, t: ViewTransform): Point {
  return { x: (p.x - t.tx) / t.zoom, y: (p.y - t.ty) / t.zoom };
}

/** 包围盒是否完整落在视口内（用于「概览是否全图可见」断言） */
export function fitsInViewport(bounds: WorldBounds, t: ViewTransform, viewportW: number, viewportH: number, margin = 0): boolean {
  const tl = worldToScreen({ x: bounds.minX, y: bounds.minY }, t);
  const br = worldToScreen({ x: bounds.maxX, y: bounds.maxY }, t);
  return tl.x >= margin && tl.y >= margin && br.x <= viewportW - margin && br.y <= viewportH - margin;
}
