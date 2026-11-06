/**
 * HC-01 · 渲染内核 · 绘制列表与合批估算（S-06）
 *
 * 权威口径：
 * - art-bible §2.1：等距遮挡**统一**按 Y 轴深度排序（`compareDepth`），禁止逐对象
 *   手写 zIndex 例外。
 * - art-bible §9.3：同屏同图集优先、避免跨图集交替绘制打断自动合批；LOD 三档资产
 *   打入同一图集（切档不产生跨图集抖动）。
 * - art-bible §2.3 DrawCall 目标（**建议基线，非承诺值、不作门禁**）：
 *   L0 ≤ 30 / L1 ≤ 60–80 / L2 ≤ 120。本模块给出的是**估算**，不是实测。
 *
 * 深度 vs 合批的取舍（诚实说明）：两者天然冲突。本实现采用「先按深度求序、再按
 * 图集归批」——批内仍严格按深度升序绘制，跨图集的重叠遮挡由「同图集优先」设计规避
 * （地形 / 道路 / 建筑各自成层，同格建筑在层级上高于地形）。批次数 = 使用的图集数，
 * 即估算 DrawCall；这是「无跨图集交替」这一 S-06 验收点的直接产物。
 */

import { compareDepth, depthKey, gridToScreen, zoomScale, type LodLevel } from './iso.ts';
import type { AtlasEntry } from './atlas.ts';
import type { RenderViewModel } from './view-model.ts';

export const DRAW_CALL_BASELINE: Readonly<Record<LodLevel, number>> = { L0: 30, L1: 80, L2: 120 };

export type SpriteKind = 'terrain' | 'road' | 'building';

export interface SpriteDraw {
  /** 最终绘制序（0 = 先画 = 最远） */
  index: number;
  cellIndex: number;
  gx: number;
  gy: number;
  /** 屏幕坐标（缩放前；屏幕缩放由后端统一施加） */
  x: number;
  y: number;
  kind: SpriteKind;
  assetKey: string;
  frameKey: string;
  atlasId: string;
  depthKey: number;
}

export interface DrawBatch {
  atlasId: string;
  sprites: SpriteDraw[];
}

export interface DrawList {
  lod: LodLevel;
  zoom: number;
  /** 深度排序后的完整绘制序（供预览页展示） */
  sprites: SpriteDraw[];
  /** 按图集聚合的批次（批内深度升序）；批次数 = 估算 DrawCall */
  batches: DrawBatch[];
  spriteCount: number;
  estimatedDrawCalls: number;
  /** 缺帧 / 未知分区而跳过的格数（如实计数，不静默兜底资产） */
  skipped: number;
  /** 叠加层（状态 / 通勤形状），深度升序；独立绘制层，不进 sprites / 不进合批 */
  overlays: OverlayDraw[];
  /** 实际绘制形状的叠加层数量（**L0 恒为 0**，形状门控证据） */
  shapeSpriteCount: number;
  /** 以线宽 / 亮度编码的叠加层数量（L0 通勤信息通道；形状可见时为 0） */
  lineEncodedCount: number;
  /** 被门控且无替代编码的叠加层数量（L0 的 status.*；远景态可接受，如实计数） */
  hiddenOverlayCount: number;
}

/**
 * 叠加层（状态 / 通勤形状）：**独立绘制层**，不进 `sprites` / 不参与合批
 * （art-bible §3.3「流线绘制在独立 RenderLayer」）。
 *
 * L0 门槛（T-129 / 主理人 Q-1 裁定 A，art-bible §2.3「L0 细节降级」+ §3.4）：
 * - **L0 不产出任何 status / flow 形状图标**（`shapeSpriteCount === 0`）；
 * - 通勤态在 L0 改由**线宽 / 亮度**表达（`line` 编码非空，信息不丢失）；
 * - 状态类（status.*）在 L0 无形状亦无线编码 → 记入 `hiddenOverlayCount`（远景态可接受）；
 * - L1 / L2 产出形状；**L1 形状带 1px `ink` 内描边**（描边色由调用方以 `base.ink`
 *   令牌传入，渲染层不自造色值），L2 不描边。
 */
export type OverlayLayer = 'status' | 'flow';

/** 叠加层令牌（来自 SemanticTokenMap；渲染层不复制色值 / 形状映射） */
export interface OverlayToken {
  id: string;
  group: string;
  color: string;
  shape: string;
  label: string;
}

export interface OverlaySpec {
  cellIndex: number;
  layer: OverlayLayer;
  token: OverlayToken;
  /** L0 线宽 / 亮度编码（缺省按令牌 id 推导：拥堵 3/1.0、缓行 2/0.8、畅通 1/0.6） */
  line?: { widthScale: number; brightness: number };
}

export interface OverlayDraw {
  cellIndex: number;
  gx: number;
  gy: number;
  x: number;
  y: number;
  layer: OverlayLayer;
  tokenId: string;
  group: string;
  color: string;
  shape: string;
  /** 形状是否绘制（L0 门控为 false） */
  shapeVisible: boolean;
  /** L1 内描边（1px，取 `base.ink` 令牌）；L0 / L2 / 未提供描边令牌时为 undefined */
  outline?: { width: number; inkTokenId: string; color: string };
  /** 形状被门控时的替代编码（线宽 / 亮度）；形状可见时为 null */
  line: { widthScale: number; brightness: number } | null;
  depthKey: number;
}

const DEFAULT_FLOW_LINE: Readonly<Record<string, { widthScale: number; brightness: number }>> = {
  'flow.clear': { widthScale: 1, brightness: 0.6 },
  'flow.slow': { widthScale: 2, brightness: 0.8 },
  'flow.congested': { widthScale: 3, brightness: 1 },
};
const DEFAULT_STATUS_LINE = { widthScale: 2, brightness: 0.9 };

function deriveLine(spec: OverlaySpec): { widthScale: number; brightness: number } {
  if (spec.line !== undefined) return spec.line;
  const preset = DEFAULT_FLOW_LINE[spec.token.id];
  return preset !== undefined ? preset : DEFAULT_STATUS_LINE;
}

export interface DrawListOptions {
  /** 分区索引（≥2）→ 建筑资产基名，如 2 → 'building_res' */
  zoneAssetBase?: Readonly<Record<number, string>>;
  /** 密度 → 资产变体后缀；默认 1 → d1，2 → d2，3 → d3 */
  densitySuffix?: (kind: SpriteKind, density: number) => string;
  /** 叠加层（状态 / 通勤形状）数据源；缺省 = 无叠加层（与 T-121 行为一致） */
  overlays?: readonly OverlaySpec[];
  /** L1 形状内描边令牌（应传 `base.ink`）；缺省则 L1 不描边（不新造色值，降级而非伪造） */
  outlineInk?: { id: string; color: string };
}

const DEFAULT_ZONE_ASSET: Readonly<Record<number, string>> = {
  2: 'building_res', // R
  3: 'building_com', // C
  4: 'building_ind', // I
};

/**
 * 密度档 → 资产变体后缀（**单一映射**，A-04 / T-121）：
 * `0 → ''`（无建筑）、`1 → 'd1'`、`2 → 'd2'`、`3 → 'd3'`，>3 钳到 d3。
 * 口径：内部 `d1/d2/d3` ↔ asset-spec §0.3 的 `low/mid/high`（见 asset-naming.ts）。
 */
export function densityToSuffix(density: number): string {
  if (!Number.isFinite(density) || density <= 0) return '';
  if (density >= 3) return 'd3';
  return 'd' + Math.floor(density);
}

function defaultDensitySuffix(kind: SpriteKind, density: number): string {
  return kind === 'building' ? densityToSuffix(density) : '';
}

/** 帧键查找表（来自图集清单；`assetKey@lod`） */
export function indexManifest(manifest: readonly AtlasEntry[]): Readonly<Record<string, AtlasEntry>> {
  const map: Record<string, AtlasEntry> = {};
  for (let i = 0; i < manifest.length; i++) {
    const e = manifest[i];
    if (e.nonAtlas === true) continue; // 非图集资产不进合批链
    map[e.assetKey + '@' + e.lod] = e;
  }
  return map;
}

function findFrame(index: Readonly<Record<string, AtlasEntry>>, assetKey: string, lod: LodLevel): AtlasEntry | undefined {
  const direct = index[assetKey + '@' + lod];
  if (direct !== undefined) return direct;
  return index[assetKey + '@ALL'];
}

/**
 * 构建绘制列表：只读消费 VM，不触碰权威状态。
 * 地形层：每个已解锁格一张地块 tile；道路层：ROAD 格；建筑层：非空分区且密度 > 0。
 */
export function buildDrawList(
  vm: RenderViewModel,
  manifest: readonly AtlasEntry[],
  lod: LodLevel,
  options: DrawListOptions = {},
): DrawList {
  const frameIndex = indexManifest(manifest);
  const zoneAssetBase = options.zoneAssetBase ?? DEFAULT_ZONE_ASSET;
  const densitySuffix = options.densitySuffix ?? defaultDensitySuffix;
  const side = vm.side;
  const cells = vm.cells;
  const count = side * side;

  const sprites: SpriteDraw[] = [];
  let skipped = 0;

  const push = (cellIndex: number, gx: number, gy: number, kind: SpriteKind, assetKey: string): void => {
    const entry = findFrame(frameIndex, assetKey, lod);
    if (entry === undefined) {
      skipped++;
      return;
    }
    const p = gridToScreen(gx, gy);
    sprites.push({
      index: 0,
      cellIndex,
      gx,
      gy,
      x: p.x,
      y: p.y,
      kind,
      assetKey,
      frameKey: entry.key,
      atlasId: entry.atlasId,
      depthKey: depthKey(gx, gy),
    });
  };

  for (let i = 0; i < count; i++) {
    if (cells.unlocked[i] !== 1) continue;
    const gx = i % side;
    const gy = (i - gx) / side;
    const zone = cells.zone[i];
    // 地形层：每格一块地
    push(i, gx, gy, 'terrain', 'tile_empty');
    if (zone === 1) {
      push(i, gx, gy, 'road', 'road_straight');
      continue;
    }
    if (zone >= 2) {
      const base = zoneAssetBase[zone];
      if (base === undefined) {
        skipped++;
        continue;
      }
      const density = cells.density[i];
      if (density <= 0) continue; // 已分区但未建设：只画地形 + 分区色（无建筑体量）
      const suffix = densitySuffix('building', density);
      push(i, gx, gy, 'building', base + '_' + suffix);
    }
  }

  // 深度排序：唯一规则（gx+gy 升序，平局 gx 升序）；同格内地形先于建筑
  const kindOrder: Record<SpriteKind, number> = { terrain: 0, road: 1, building: 2 };
  sprites.sort((a, b) => {
    const d = compareDepth(a, b);
    if (d !== 0) return d;
    return kindOrder[a.kind] - kindOrder[b.kind];
  });
  for (let i = 0; i < sprites.length; i++) sprites[i].index = i;

  // 按图集聚合：首次出现顺序建档；批内保持深度升序（即 sprites 的相对序）
  const batches: DrawBatch[] = [];
  const batchIndex: Record<string, number> = {};
  for (let i = 0; i < sprites.length; i++) {
    const s = sprites[i];
    let bi = batchIndex[s.atlasId];
    if (bi === undefined) {
      bi = batches.length;
      batchIndex[s.atlasId] = bi;
      batches.push({ atlasId: s.atlasId, sprites: [] });
    }
    batches[bi].sprites.push(s);
  }

  // ---- 叠加层（状态 / 通勤形状）：独立层，不进 sprites / 不进合批 ----
  // L0 门控（T-129 Q-1 裁定 A）：任何 status / flow **形状**都不产出；
  // 通勤态改由线宽 / 亮度编码（line 非空），保证 L0 信息不丢失。
  const overlaySpecs = options.overlays ?? [];
  const overlays: OverlayDraw[] = [];
  for (let i = 0; i < overlaySpecs.length; i++) {
    const spec = overlaySpecs[i];
    const ci = spec.cellIndex;
    if (!Number.isInteger(ci) || ci < 0 || ci >= count) {
      skipped++;
      continue;
    }
    const gx = ci % side;
    const gy = (ci - gx) / side;
    const p = gridToScreen(gx, gy);
    const overlay: OverlayDraw = {
      cellIndex: ci,
      gx,
      gy,
      x: p.x,
      y: p.y,
      layer: spec.layer,
      tokenId: spec.token.id,
      group: spec.token.group,
      color: spec.token.color,
      shape: spec.token.shape,
      shapeVisible: false,
      line: null,
      depthKey: depthKey(gx, gy),
    };
    if (lod === 'L0') {
      // L0：形状一律关闭；通勤态保留线宽 / 亮度编码
      overlay.line = spec.layer === 'flow' ? deriveLine(spec) : null;
    } else {
      overlay.shapeVisible = true;
      if (lod === 'L1' && options.outlineInk !== undefined) {
        overlay.outline = { width: 1, inkTokenId: options.outlineInk.id, color: options.outlineInk.color };
      }
    }
    overlays.push(overlay);
  }
  overlays.sort((a, b) => compareDepth(a, b));

  let shapeSpriteCount = 0;
  let lineEncodedCount = 0;
  let hiddenOverlayCount = 0;
  for (let i = 0; i < overlays.length; i++) {
    if (overlays[i].shapeVisible) shapeSpriteCount++;
    else if (overlays[i].line !== null) lineEncodedCount++;
    else hiddenOverlayCount++;
  }

  return {
    lod,
    zoom: zoomScale(lod),
    sprites,
    batches,
    spriteCount: sprites.length,
    estimatedDrawCalls: batches.length,
    skipped,
    overlays,
    shapeSpriteCount,
    lineEncodedCount,
    hiddenOverlayCount,
  };
}
