/**
 * HC-01 · 渲染内核 · 虚拟图集清单与分包加载（S-06）
 *
 * 权威口径（只读引用）：
 * - art-bible §9.3：图集 ≤2048×2048、留白 ≤10%、12 组划分（`UI` / `UI-图案编码` /
 *   `地形地块` / `道路` / `建筑-居住` / `建筑-商业` / `建筑-产业` / `建筑-公共服务` /
 *   `植被` / `VFX` / `昼夜窗光` / `天气`）；LOD 三档资产打入**同一图集**；
 *   同屏同图集优先，避免跨图集交替打断合批。
 * - asset-spec §0.2：图集画布固定 **2048×2048 = (128×16) × (64×32)**；UI 切片
 *   24×24 / 48×48 @1x（**不套用世界网格基数**）；压缩 ASTC 首选 → ETC2 回退 →
 *   不透明底 RGB565。
 * - architecture.md §6.1：`UI` + `UI-图案编码` + 字体令牌**常驻不卸载**；
 *   `地形地块` / `道路` / 网格线常驻（首屏）；`建筑-{分区}` **按激活分区集按需加载、
 *   切 LOD 不卸载**；`VFX` / `昼夜窗光` / `天气` 按 LOD / 性能档。
 *
 * ⚠️ 占位声明：本清单的**尺寸全部为程序化占位规格，待真实切片替换**（本轮无任何 PNG；
 * 图集为虚拟清单，不做实际打包）。留白以「切片透明边距比」建模（见 validateAtlasManifest）。
 */

import type { LodLevel } from './iso.ts';

export const ATLAS_SIZE = 2048;
/** 2048² = (128×16) × (64×32) —— asset-spec §0.2 */
export const ATLAS_GRID_W = 128 * 16;
export const ATLAS_GRID_H = 64 * 32;

export const ATLAS_GROUPS = [
  'UI',
  'UI-图案编码',
  '地形地块',
  '道路',
  '建筑-居住',
  '建筑-商业',
  '建筑-产业',
  '建筑-公共服务',
  '植被',
  'VFX',
  '昼夜窗光',
  '天气',
] as const;
export type AtlasId = (typeof ATLAS_GROUPS)[number];

/** 分区 → 建筑图集（按激活分区集加载） */
export const ZONE_TO_ATLAS: Readonly<Record<string, AtlasId>> = {
  R: '建筑-居住',
  C: '建筑-商业',
  I: '建筑-产业',
  CIVIC: '建筑-公共服务',
};

/** 常驻图集（architecture §6.1：UI / UI-图案编码 / 地形 / 道路 / 网格线） */
export const RESIDENT_ATLASES: readonly AtlasId[] = ['UI', 'UI-图案编码', '地形地块', '道路'];

/** UI 切片组（不套用世界网格 128×64 基数，asset-spec §0.2） */
const UI_SLICE_GROUPS: ReadonlySet<AtlasId> = new Set<AtlasId>(['UI', 'UI-图案编码']);

export interface AtlasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasEntry {
  /** 帧键（唯一）：assetKey + '@' + lod */
  key: string;
  /** 同一资产的稳定标识；其 L0/L1/L2 三档必须落在同一 atlasId */
  assetKey: string;
  atlasId: AtlasId;
  lod: LodLevel | 'ALL';
  rect: AtlasRect;
  /** 切片透明边距比（0~0.1）：本轮以比例建模「留白 ≤10%」 */
  padding: number;
  /** 建筑图集条目必须带分区门控 */
  zoneGate?: string;
  /** 非图集资产（天空渐变 / App 图标 / 字体）：不进合批链、不参与图集校验 */
  nonAtlas?: boolean;
}

export interface AtlasStats {
  usedArea: number;
  canvasArea: number;
  /** 已用面积 / 画布面积（虚拟占位下密度偏低属预期，不是目标值） */
  occupancy: number;
  /** 加权透明边距比 = Σ(切片面积×padding) / Σ(切片面积) */
  paddingRatio: number;
  maxX: number;
  maxY: number;
}

export interface AtlasValidation {
  ok: boolean;
  errors: readonly string[];
  stats: Readonly<Record<string, AtlasStats>>;
}

/** 世界资产尺寸必须为 128×64 整数倍（art-bible §2.1 / asset-spec V-5） */
function isWorldSizeValid(w: number, h: number): boolean {
  return w > 0 && h > 0 && w % 128 === 0 && h % 64 === 0;
}

/** 简易货架打包（shelf packing）——仅用于占位清单布局，确定性、无随机 */
function layoutGroup(items: readonly (ItemSpec & { key: string; atlasId: AtlasId })[]): AtlasEntry[] {
  const out: AtlasEntry[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let shelfHeight = 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.nonAtlas === true) {
      // 非图集资产：不占图集空间、不参与合批
      out.push({ assetKey: it.assetKey, key: it.key, atlasId: it.atlasId, lod: it.lod, rect: { x: 0, y: 0, w: 0, h: 0 }, padding: 0, nonAtlas: true });
      continue;
    }
    if (cursorX + it.w > ATLAS_SIZE) {
      cursorX = 0;
      cursorY += shelfHeight;
      shelfHeight = 0;
    }
    const entry: AtlasEntry = {
      assetKey: it.assetKey,
      key: it.key,
      atlasId: it.atlasId,
      lod: it.lod,
      rect: { x: cursorX, y: cursorY, w: it.w, h: it.h },
      padding: it.padding ?? 0.06,
    };
    if (it.zoneGate !== undefined) entry.zoneGate = it.zoneGate;
    out.push(entry);
    cursorX += it.w;
    if (it.h > shelfHeight) shelfHeight = it.h;
  }
  return out;
}

interface ItemSpec {
  assetKey: string;
  lod: LodLevel | 'ALL';
  w: number;
  h: number;
  padding?: number;
  zoneGate?: string;
  nonAtlas?: boolean;
}

function spec(assetKey: string, lod: LodLevel | 'ALL', w: number, h: number, zoneGate?: string): ItemSpec {
  return { assetKey, lod, w, h, padding: 0.06, zoneGate };
}

function withLods(assetKey: string, w: number, h: number, zoneGate?: string): ItemSpec[] {
  return [spec(assetKey, 'L0', w, h, zoneGate), spec(assetKey, 'L1', w, h, zoneGate), spec(assetKey, 'L2', w, h, zoneGate)];
}

function groupItems(atlasId: AtlasId): ItemSpec[] {
  switch (atlasId) {
    case 'UI':
      return [
        { assetKey: 'ui_panel_9slice', lod: 'ALL', w: 48, h: 48, padding: 0.04 },
        { assetKey: 'ui_button_9slice', lod: 'ALL', w: 48, h: 48, padding: 0.04 },
        { assetKey: 'ui_tab_9slice', lod: 'ALL', w: 48, h: 48, padding: 0.04 },
        { assetKey: 'ui_icon_zone_R', lod: 'ALL', w: 24, h: 24, padding: 0.02 },
        { assetKey: 'ui_icon_zone_C', lod: 'ALL', w: 24, h: 24, padding: 0.02 },
        { assetKey: 'ui_icon_zone_I', lod: 'ALL', w: 24, h: 24, padding: 0.02 },
        { assetKey: 'ui_icon_road', lod: 'ALL', w: 24, h: 24, padding: 0.02 },
        { assetKey: 'ui_icon_endday', lod: 'ALL', w: 24, h: 24, padding: 0.02 },
        { assetKey: 'ui_shape_check', lod: 'ALL', w: 24, h: 24, padding: 0.02 },
        { assetKey: 'ui_shape_exclamation', lod: 'ALL', w: 24, h: 24, padding: 0.02 },
        { assetKey: 'ui_shape_cross', lod: 'ALL', w: 24, h: 24, padding: 0.02 },
        { assetKey: 'ui_shape_lock', lod: 'ALL', w: 24, h: 24, padding: 0.02 },
        { assetKey: 'ui_shape_arrow_up', lod: 'ALL', w: 24, h: 24, padding: 0.02 },
        { assetKey: 'ui_shape_arrow_down', lod: 'ALL', w: 24, h: 24, padding: 0.02 },
        // 非图集资产：字体令牌与 App 图标不进合批链
        { assetKey: 'font_token_main', lod: 'ALL', w: 0, h: 0, nonAtlas: true },
        { assetKey: 'app_icon', lod: 'ALL', w: 0, h: 0, nonAtlas: true },
      ];
    case 'UI-图案编码':
      return [
        { assetKey: 'pattern_dots', lod: 'ALL', w: 128, h: 64, padding: 0.05 },
        { assetKey: 'pattern_diagonal45', lod: 'ALL', w: 128, h: 64, padding: 0.05 },
        { assetKey: 'pattern_gridlines', lod: 'ALL', w: 128, h: 64, padding: 0.05 },
        { assetKey: 'pattern_cross', lod: 'ALL', w: 128, h: 64, padding: 0.05 },
      ];
    case '地形地块':
      return [
        ...withLods('tile_empty', 128, 64),
        ...withLods('tile_grass', 128, 64),
        ...withLods('tile_water', 128, 64),
        ...withLods('grid_line', 128, 64),
      ];
    case '道路':
      return [
        ...withLods('road_straight', 128, 64),
        ...withLods('road_cross', 128, 64),
        ...withLods('road_t', 128, 64),
      ];
    case '建筑-居住':
      return [
        ...withLods('building_res_d1', 128, 64, 'R'),
        // A-04（T-121）：补中密度 d2，使密度三档在体量高度可辨（art-bible §4.1 锚点 3）
        ...withLods('building_res_d2', 128, 128, 'R'),
        // Q-4（T-129）：d3 提到 128×192（仍 128×64 整数倍），与 d1/d2 形成 1:2:3 体量阶梯
        ...withLods('building_res_d3', 128, 192, 'R'),
      ];
    case '建筑-商业':
      return [
        ...withLods('building_com_d1', 128, 64, 'C'),
        ...withLods('building_com_d2', 128, 128, 'C'),
        ...withLods('building_com_d3', 256, 128, 'C'),
      ];
    case '建筑-产业':
      return [
        ...withLods('building_ind_d1', 128, 64, 'I'),
        ...withLods('building_ind_d2', 128, 128, 'I'),
        // Q-4（T-129）：与居住 d3 同步提到 128×192
        ...withLods('building_ind_d3', 128, 192, 'I'),
      ];
    case '建筑-公共服务':
      return [...withLods('building_civic', 128, 128, 'CIVIC')];
    case '植被':
      return [
        ...withLods('tree_round', 128, 64),
        ...withLods('tree_cluster', 128, 64),
      ];
    case 'VFX':
      return [
        ...withLods('vfx_select_ring', 128, 64),
        ...withLods('vfx_dust_ring', 128, 64),
      ];
    case '昼夜窗光':
      return [...withLods('windows_points', 128, 64)];
    case '天气':
      return [
        // 天空渐变：全屏 1× 拉伸，**非图集资产**（asset-spec M-055）
        { assetKey: 'sky_gradient', lod: 'ALL', w: 0, h: 0, nonAtlas: true },
        ...withLods('weather_rain', 128, 64),
      ];
    default:
      return [];
  }
}

/**
 * 构建虚拟图集清单（12 组齐备；尺寸为程序化占位规格，待真实切片替换）。
 * 布局确定性：按组顺序、组内顺序做货架打包，无随机。
 */
export function createVirtualAtlasManifest(): AtlasEntry[] {
  const out: AtlasEntry[] = [];
  for (let i = 0; i < ATLAS_GROUPS.length; i++) {
    const atlasId = ATLAS_GROUPS[i];
    const items = groupItems(atlasId).map((it) => ({ ...it, key: it.assetKey + '@' + it.lod, atlasId }));
    out.push(...layoutGroup(items));
  }
  return out;
}

export const VIRTUAL_ATLAS_MANIFEST: readonly AtlasEntry[] = Object.freeze(createVirtualAtlasManifest());

/**
 * LOD 声明索引（§0.3.5 / T-129 Q-3）：命名层据此**显式**区分
 * 「`lod='ALL'` 与 `L1` 共用 `_l1` 代表名」的等价关系，而非静默降级。
 * 单一真源 = 上面的虚拟清单；命名层不另行维护一份声明表。
 */
export const ALL_LOD_ASSETS: ReadonlySet<string> = new Set(
  VIRTUAL_ATLAS_MANIFEST.filter((e) => e.lod === 'ALL').map((e) => e.assetKey),
);
export const SPLIT_LOD_ASSETS: ReadonlySet<string> = new Set(
  VIRTUAL_ATLAS_MANIFEST.filter((e) => e.lod !== 'ALL').map((e) => e.assetKey),
);

export function entriesOfAtlas(manifest: readonly AtlasEntry[], atlasId: AtlasId): AtlasEntry[] {
  return manifest.filter((e) => e.atlasId === atlasId && e.nonAtlas !== true);
}

function aabbOverlap(a: AtlasRect, b: AtlasRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * 校验虚拟图集清单。错误即失败项，逐条写清原因（供 CI / 评审直接读）。
 * 检查项：12 组齐备、矩形在 2048² 内、同图集互不重叠、世界资产 128×64 整数倍、
 * 切片留白（padding ≤10% 且组加权 ≤10%）、同一资产三档 LOD 同 atlasId、
 * 建筑图集条目带 zoneGate。
 */
export function validateAtlasManifest(manifest: readonly AtlasEntry[]): AtlasValidation {
  const errors: string[] = [];
  const stats: Record<string, AtlasStats> = {};

  for (let i = 0; i < ATLAS_GROUPS.length; i++) {
    const id = ATLAS_GROUPS[i];
    if (!manifest.some((e) => e.atlasId === id)) errors.push('missing atlas group: ' + id);
  }

  for (let i = 0; i < manifest.length; i++) {
    const e = manifest[i];
    if (e.nonAtlas === true) continue;
    const inBounds = e.rect.x >= 0 && e.rect.y >= 0 && e.rect.x + e.rect.w <= ATLAS_SIZE && e.rect.y + e.rect.h <= ATLAS_SIZE;
    if (!inBounds) errors.push(e.key + ' out of atlas bounds (' + JSON.stringify(e.rect) + ')');
    if (!UI_SLICE_GROUPS.has(e.atlasId) && !isWorldSizeValid(e.rect.w, e.rect.h)) {
      errors.push(e.key + ' size ' + e.rect.w + 'x' + e.rect.h + ' is not a 128x64 multiple');
    }
    if (e.padding < 0 || e.padding > 0.1) errors.push(e.key + ' padding ' + e.padding + ' exceeds 10%');
    if (e.atlasId.startsWith('建筑-') && e.zoneGate === undefined) {
      errors.push(e.key + ' building entry missing zoneGate');
    }
  }

  // 同一图集内互不重叠
  for (let gi = 0; gi < ATLAS_GROUPS.length; gi++) {
    const id = ATLAS_GROUPS[gi];
    const list = manifest.filter((e) => e.atlasId === id && e.nonAtlas !== true);
    let usedArea = 0;
    let paddingArea = 0;
    let maxX = 0;
    let maxY = 0;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      usedArea += a.rect.w * a.rect.h;
      paddingArea += a.rect.w * a.rect.h * a.padding;
      if (a.rect.x + a.rect.w > maxX) maxX = a.rect.x + a.rect.w;
      if (a.rect.y + a.rect.h > maxY) maxY = a.rect.y + a.rect.h;
      for (let j = i + 1; j < list.length; j++) {
        if (aabbOverlap(a.rect, list[j].rect)) errors.push('overlap in ' + id + ': ' + a.key + ' >< ' + list[j].key);
      }
    }
    const canvasArea = ATLAS_SIZE * ATLAS_SIZE;
    stats[id] = {
      usedArea,
      canvasArea,
      occupancy: canvasArea === 0 ? 0 : usedArea / canvasArea,
      paddingRatio: usedArea === 0 ? 0 : paddingArea / usedArea,
      maxX,
      maxY,
    };
    if (stats[id].paddingRatio > 0.1) errors.push('atlas ' + id + ' padding ratio ' + stats[id].paddingRatio.toFixed(4) + ' exceeds 10%');
  }

  // 同一资产三档 LOD 必须同 atlasId（art-bible §2.3）
  const byAsset: Record<string, { atlas: string; lods: string[] }> = {};
  for (let i = 0; i < manifest.length; i++) {
    const e = manifest[i];
    if (e.nonAtlas === true) continue;
    const rec = byAsset[e.assetKey];
    if (rec === undefined) {
      byAsset[e.assetKey] = { atlas: e.atlasId, lods: [e.lod] };
    } else {
      if (rec.atlas !== e.atlasId) errors.push('asset ' + e.assetKey + ' split across atlases: ' + rec.atlas + ' vs ' + e.atlasId);
      rec.lods.push(e.lod);
    }
  }
  for (const k of Object.keys(byAsset)) {
    const lods = byAsset[k].lods;
    if (lods.indexOf('ALL') >= 0) continue;
    for (let li = 0; li < 3; li++) {
      const want = ['L0', 'L1', 'L2'][li];
      if (lods.indexOf(want) < 0) errors.push('asset ' + k + ' missing lod ' + want);
    }
  }

  return { ok: errors.length === 0, errors, stats };
}

/** 帧键解析表：assetKey + lod → 帧键（draw-list 用；缺失即报，不静默兜底） */
export function buildFrameKeyIndex(manifest: readonly AtlasEntry[]): Readonly<Record<string, AtlasEntry>> {
  const map: Record<string, AtlasEntry> = {};
  for (let i = 0; i < manifest.length; i++) {
    const e = manifest[i];
    if (e.nonAtlas === true) continue;
    map[e.assetKey + '@' + e.lod] = e;
  }
  return Object.freeze(map);
}

export interface LoadSet {
  resident: readonly AtlasId[];
  onDemand: readonly AtlasId[];
  excluded: readonly AtlasId[];
  /** 非图集资产（天空渐变 / App 图标 / 字体）：单独的加载组，不进合批链 */
  nonAtlas: readonly string[];
  /**
   * Could 预留组（A-06 / T-121）：`昼夜窗光` / `天气`。MVP 只做晴朗白天
   * （art-bible 裁定 4 / GDD 5.2），这两组**策略上不加载**；此处显式输出标记，
   * 以免被误读为范围越界。**加载行为不变**（仍按 LOD 归入 onDemand / excluded）。
   */
  deferredCould: readonly AtlasId[];
}

/** MVP 期 Could 预留（不加载）的图集组；开启 Could 期时由调用方忽略本列表 */
export const DEFERRED_COULD_ATLASES: readonly AtlasId[] = ['昼夜窗光', '天气'];

/**
 * 按「激活分区集 + LOD」解析图集加载集。
 * 规则（architecture §6.1）：
 * - 常驻：UI / UI-图案编码 / 地形地块 / 道路（切 LOD 不卸载）；
 * - 按需：激活分区的建筑图集（切 LOD 不卸载，故三档都进 onDemand）+ 植被 / VFX / 天气（按 LOD）；
 * - 排除：未激活分区的建筑图集、当前 LOD 下关闭的组；
 * - 未解锁分区**一律不出现在 resident / onDemand**。
 */
export function resolveLoadSet(activeZones: readonly string[], lod: LodLevel, manifest: readonly AtlasEntry[] = VIRTUAL_ATLAS_MANIFEST): LoadSet {
  const resident: AtlasId[] = [];
  for (let i = 0; i < RESIDENT_ATLASES.length; i++) resident.push(RESIDENT_ATLASES[i]);

  const onDemand: AtlasId[] = [];
  const excluded: AtlasId[] = [];
  const activeBuildingAtlases: AtlasId[] = [];
  for (let i = 0; i < activeZones.length; i++) {
    const atlas = ZONE_TO_ATLAS[activeZones[i]];
    if (atlas !== undefined && activeBuildingAtlases.indexOf(atlas) < 0) activeBuildingAtlases.push(atlas);
  }

  for (let i = 0; i < ATLAS_GROUPS.length; i++) {
    const id = ATLAS_GROUPS[i];
    if (resident.indexOf(id) >= 0) continue;
    if (id.startsWith('建筑-')) {
      if (activeBuildingAtlases.indexOf(id) >= 0) onDemand.push(id);
      else excluded.push(id);
      continue;
    }
    if (id === '植被') {
      // 植被：L0 合并为分区绿地色块（不单独加载），L1/L2 按需
      if (lod === 'L0') excluded.push(id);
      else onDemand.push(id);
      continue;
    }
    if (id === 'VFX') {
      // art-bible §2.3：粒子仅 L1 / L2 启用，L0 全部关闭
      if (lod === 'L0') excluded.push(id);
      else onDemand.push(id);
      continue;
    }
    if (id === '昼夜窗光') {
      // Could 项：仅 L2 开放（美 Bible 裁定 4 移入 Could，L0/L1 关闭）
      if (lod === 'L2') onDemand.push(id);
      else excluded.push(id);
      continue;
    }
    if (id === '天气') {
      if (lod === 'L0') excluded.push(id);
      else onDemand.push(id);
      continue;
    }
  }

  // 只保留清单里真实存在的组（避免空组进入加载集）
  const present = (id: AtlasId): boolean => manifest.some((e) => e.atlasId === id && e.nonAtlas !== true);
  const nonAtlas: string[] = [];
  for (let i = 0; i < manifest.length; i++) {
    if (manifest[i].nonAtlas === true && nonAtlas.indexOf(manifest[i].assetKey) < 0) nonAtlas.push(manifest[i].assetKey);
  }

  return {
    resident: resident.filter(present),
    onDemand: onDemand.filter(present),
    excluded: excluded.filter(present),
    nonAtlas,
    // A-06：只做标记，不改加载行为（MVP 期由上层忽略这两组即可）
    deferredCould: DEFERRED_COULD_ATLASES.filter(present),
  };
}
