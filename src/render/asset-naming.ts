/**
 * HC-01 · 渲染内核 · 资产命名映射层（S-06 · A-01 / T-129 加固）
 *
 * 背景（art-director 评审 A-01，中高）：工程内部 assetKey 体系（`building_res_d1@L1`）
 * 与 asset-spec 交付命名规范（`bld_res_low_v1_l1`）不一致，真实切片到位时会
 * 「改名 + 改渲染代码」。主理人裁定方案②：**不重命名内部键**，新增本映射层。
 *
 * 准绳：`design/assets/asset-spec.md` **v0.1.1** §0.3（只读引用，本文件不修改文档）：
 * - 结构 `{类别前缀}_{语义段…}_{变体}_{LOD档}`，全小写 + 下划线，段间不得空段；
 * - §0.3.1 前缀受控 17 个；§0.3.2 **语义段必须取自律定词表**（`shape` 不入表，视为违规，
 *   状态图标唯一准绳是 `state`）；§0.3.3 描述词弱约束（非穷举，允许扩展）；
 * - §0.3.5 `_l1` 为代表名，`lod='ALL'` 与 `L1` 共用 `_l1`；同一 assetKey 不得同时声明二者，
 *   且**二者须由校验断言区分，不得静默降级**（本文件用 `declaredLod` 显式标注）。
 *
 * T-129 变更：
 * - 7 条命名订正（按 v0.1.1 附录 C / §0.3.4）：`icon_shape_* → icon_state_*`（语义化），
 *   `font_ui_main → font_ui_cjk`；其中 2/3/5/6 由「物理形状」改为「玩家可见语义」
 *   （exclamation→warn、cross→neg、arrow_up→up、arrow_down→down）。
 * - `validateSheetName()`：把 §0.3.2 受控语义词表并入断言（此前只校验前缀 + 小写 + `_lN`，
 *   所以 `icon_shape_*` 能通过校验 → 已被 4 条反例覆盖）。
 * - `fromSheetName()` 返回 `declaredLod`，显式声明 ALL≡`_l1` 等价关系（Q-3）。
 *
 * 纪律：本文件零 hex / 零颜色 / 零引擎依赖（只做字符串表与词表校验），不写任何状态。
 */

import { ALL_LOD_ASSETS, SPLIT_LOD_ASSETS, type AtlasEntry } from './atlas.ts';
import type { LodLevel } from './iso.ts';

/** 内部 assetKey → 规范名 stem（不含 `_lN` 后缀） */
export const ASSET_SHEET_STEMS: Readonly<Record<string, string>> = {
  // 地块 / 地形（asset-spec M-001~009）
  tile_empty: 'tile_ground_empty_base',
  tile_grass: 'tile_ground_grass_base',
  tile_water: 'tile_ground_shore_base',
  grid_line: 'grid_plan_visible_base',
  // 道路（M-010~020）
  road_straight: 'road_straight_a_base',
  road_cross: 'road_cross_base',
  road_t: 'road_t_base',
  // 建筑（M-026~048）：d1/d2/d3 ↔ low/mid/high，v1 为占位代表变体
  building_res_d1: 'bld_res_low_v1',
  building_res_d2: 'bld_res_mid_v1',
  building_res_d3: 'bld_res_high_v1',
  building_com_d1: 'bld_com_low_v1',
  building_com_d2: 'bld_com_mid_v1',
  building_com_d3: 'bld_com_high_v1',
  building_ind_d1: 'bld_ind_low_v1',
  building_ind_d2: 'bld_ind_mid_v1',
  building_ind_d3: 'bld_ind_high_v1',
  building_civic: 'bld_civ_base',
  // 植被（M-049~052）
  tree_round: 'veg_tree_round_base',
  tree_cluster: 'veg_tree_cluster_base',
  // VFX / 光照（M-053~054 / M-085~089）
  vfx_select_ring: 'vfx_select_ring_base',
  vfx_dust_ring: 'vfx_dust_ring_base',
  // Could 项（MVP 不加载，仅预留映射；art-bible 裁定 4）
  windows_points: 'vfx_windows_points_base',
  weather_rain: 'vfx_weather_rain_base',
  // 分区图案（M-056~059）
  pattern_dots: 'pat_res_dots_base',
  pattern_diagonal45: 'pat_com_hatch_base',
  pattern_gridlines: 'pat_ind_grid_base',
  pattern_cross: 'pat_civ_cross_base',
  // UI 结构与面板（M-060~075）
  ui_panel_9slice: 'ui_panel_9slice_base',
  ui_button_9slice: 'ui_button_9slice_base',
  ui_tab_9slice: 'ui_tab_9slice_base',
  ui_icon_zone_R: 'icon_zone_res_base',
  ui_icon_zone_C: 'icon_zone_com_base',
  ui_icon_zone_I: 'icon_zone_ind_base',
  ui_icon_road: 'icon_tool_road_base',
  ui_icon_endday: 'icon_endday_base',
  // 状态图标（M-079~084）：v0.1.1 §0.3.4 —— `state` 为唯一准绳，语义词按「玩家可见语义」
  ui_shape_check: 'icon_state_check_base',
  ui_shape_exclamation: 'icon_state_warn_base',
  ui_shape_cross: 'icon_state_neg_base',
  ui_shape_lock: 'icon_state_lock_base',
  ui_shape_arrow_up: 'icon_state_up_base',
  ui_shape_arrow_down: 'icon_state_down_base',
  // 非图集资产（M-055 / M-090~092）
  font_token_main: 'font_ui_cjk_base',
  app_icon: 'brand_app_icon_base',
  sky_gradient: 'sky_day_gradient_base',
};

const LOD_SUFFIX: Readonly<Record<string, string>> = { L0: '_l0', L1: '_l1', L2: '_l2', ALL: '_l1' };

/**
 * §0.3.5 显式等价声明（Q-3）：`lod='ALL'`（不随世界缩放变化）与 `L1` 共用 `_l1` 代表名。
 * 该等价关系**必须显式**（`fromSheetName().declaredLod`），不得静默降级为 `L1`。
 */
export const LOD_EQUIVALENCE = Object.freeze({
  representative: 'L1' as const,
  aliases: Object.freeze(['ALL'] as const),
  rule: 'lod=ALL 与 L1 共用 _l1 代表名；同一 assetKey 不得同时声明二者（collision 拒绝）；回查时以 declaredLod 区分',
});

// ---------------------------------------------------------------------------
// §0.3.1 / §0.3.2 / §0.3.3 词表（与 asset-spec v0.1.1 逐项对齐）
// ---------------------------------------------------------------------------

/** §0.3.1 类别前缀（受控 17 个，不得自造） */
export const CATEGORY_PREFIXES: readonly string[] = [
  'tile', 'grid', 'overlay', 'road', 'flow', 'bld', 'veg', 'shadow', 'ao',
  'sky', 'pat', 'ui', 'icon', 'vfx', 'font', 'brand', 'a11y',
];

/** §0.3.2 受控语义词（**语义段必须取自此表**；`shape` 不入表 = 违规） */
export const CONTROLLED_SEMANTIC_WORDS: Readonly<Record<string, readonly string[]>> = {
  zone: ['res', 'com', 'ind', 'civ'],
  density: ['low', 'mid', 'high'],
  road: ['straight', 'corner', 't', 'cross', 'end'],
  state: ['state'],
  tool: ['tool'],
  metric: ['metric'],
  zoneIcon: ['zone'],
  pattern: ['dots', 'hatch', 'grid', 'cross', 'canopy', 'vertical-bars'],
  preview: ['valid', 'invalid', 'plan', 'view'],
  variant: ['base', 'v1', 'v2', 'v3'],
};

/**
 * §0.3.3 描述词白名单（弱约束、非穷举；新增描述词不需修订文档）。
 * 前 68 项逐字取自 §0.3.3「当前在用描述词」；其后为**描述词扩展**（同样属于 §0.3.3
 * 允许范围，用于覆盖 v0.1.1 正文里实际在用的名称）：
 * `a` `b`（直道 A/B 方向）· `visible`（grid_plan_visible）· `ring`（选中环 / 尘环）·
 * `windows` `points` `weather` `rain`（Could 预留项，美术侧判定保持现状）·
 * `road`（icon_tool_road）· `cjk`（font_ui_cjk）· `icon`（brand_app_icon）。
 */
export const DESCRIPTOR_WORDS: readonly string[] = [
  'ground', 'empty', 'grass', 'shore', 'roadbase', 'mark', 'lane', 'zebra', 'stop', 'arrow',
  'signal', 'line', 'thin', 'mid', 'thick', 'congest', 'pulse', 'static', 'tree', 'round',
  'cluster', 'cone', 'micro', 'soft', 'ellipse', 'contact', 'day', 'gradient', 'hud', 'topbar',
  'issue', 'list', 'diag', 'panel', 'minimap', 'frame', 'toast', '9slice', 'button', 'tab',
  'detail', 'card', 'endday', 'demolish', 'satisfaction', 'budget', 'cycle', 'check', 'warn',
  'neg', 'lock', 'up', 'down', 'place', 'spread', 'dust', 'growth', 'sweep', 'alert', 'select',
  'breath', 'ui', 'app', 'pattern', 'palette',
  // 描述词扩展（§0.3.3 允许）
  'a', 'b', 'visible', 'ring', 'windows', 'points', 'weather', 'rain', 'road', 'cjk', 'icon',
];

const CONTROLLED_SET: ReadonlySet<string> = (() => {
  const s = new Set<string>();
  for (const k of Object.keys(CONTROLLED_SEMANTIC_WORDS)) {
    for (const w of CONTROLLED_SEMANTIC_WORDS[k]) s.add(w);
  }
  return s;
})();
const DESCRIPTOR_SET: ReadonlySet<string> = new Set(DESCRIPTOR_WORDS);

/** 违规词黑名单（给更具体的错误提示；不依赖它拦截，白名单本身就会拒绝） */
const VIOLATION_HINTS: Readonly<Record<string, string>> = {
  shape: '§0.3.4：`shape` 不入词表，状态图标唯一准绳是 `state`（如 icon_state_warn_base_l1）',
  d1: '§0.3.2：`d1` 是工程私有键，交付名须用 `low`',
  d2: '§0.3.2：`d2` 是工程私有键，交付名须用 `mid`',
  d3: '§0.3.2：`d3` 是工程私有键，交付名须用 `high`',
};

export interface SheetNameCheck {
  ok: boolean;
  errors: readonly string[];
}

/**
 * 规范名合法性校验（§0.3 全量）：
 * ① 全小写 ASCII + 下划线、无空段、无连字符；② 前缀受控；③ LOD 段 `l0/l1/l2`；
 * ④ 变体段 `base|vN`；⑤ **语义段（1–3 段）每段必须命中受控词或描述词白名单**；
 * ⑥ `shape` / `d1|d2|d3` 等违规词给出明确理由。
 */
export function validateSheetName(name: string): SheetNameCheck {
  const errors: string[] = [];
  if (!/^[a-z0-9_]+$/.test(name)) errors.push('只允许小写 ASCII 字母 / 数字 / 下划线（大写视为违规）：' + name);
  if (name.indexOf('__') >= 0) errors.push('出现空段（`__`）：' + name);
  if (name.indexOf('-') >= 0) errors.push('不得含连字符：' + name);

  const segs = name.split('_');
  if (segs.length < 4) {
    errors.push('段数不足（需「前缀 + ≥1 语义段 + 变体 + LOD」≥4 段）：' + name);
  }

  const lod = segs[segs.length - 1];
  if (!/^l[012]$/.test(lod)) errors.push('LOD 段须为 `l0` / `l1` / `l2`：' + name);

  const prefix = segs[0];
  if (CATEGORY_PREFIXES.indexOf(prefix) < 0) errors.push('类别前缀不在受控表（§0.3.1）：' + prefix);

  const variant = segs[segs.length - 2];
  if (!/^(?:base|v[1-9][0-9]*)$/.test(variant)) {
    const variantHint = VIOLATION_HINTS[variant];
    errors.push('变体段须为 `base` 或 `vN`（§0.3）：' + variant + (variantHint !== undefined ? ' —— ' + variantHint : ''));
  }

  const semantic = segs.slice(1, Math.max(1, segs.length - 2));
  if (semantic.length < 1 || semantic.length > 3) {
    errors.push('语义段须为 1–3 段（§0.3）：实际 ' + semantic.length + ' 段 [' + semantic.join(', ') + ']');
  }
  for (let i = 0; i < semantic.length; i++) {
    const w = semantic[i];
    const hint = VIOLATION_HINTS[w];
    if (hint !== undefined) {
      errors.push('违规语义词 `' + w + '`：' + hint);
      continue;
    }
    if (!CONTROLLED_SET.has(w) && !DESCRIPTOR_SET.has(w)) {
      errors.push('语义段不在受控词 / 描述词白名单（§0.3.2 / §0.3.3）：`' + w + '`（' + name + '）');
    }
  }
  return { ok: errors.length === 0, errors };
}

/** §0.3.5：assetKey 的 LOD 声明（来自图集清单，单一真源） */
export function declaredLodOf(assetKey: string): 'ALL' | 'SPLIT' {
  if (ALL_LOD_ASSETS.has(assetKey)) return 'ALL';
  if (SPLIT_LOD_ASSETS.has(assetKey)) return 'SPLIT';
  throw new Error('assetKey 未在图集清单中声明 LOD：' + assetKey);
}

export interface SheetNameResolution {
  assetKey: string;
  /** 规范名直接对应的档位（`_l1` → `L1`） */
  lod: LodLevel | 'ALL';
  /** 清单里该资产**实际声明**的 LOD：`ALL` 表示与 `L1` 共用代表名（显式等价，不静默降级） */
  declaredLod: 'ALL' | 'SPLIT';
  /** 本次解析是否落在「代表名」上（declaredLod === 'ALL' 时为 true） */
  viaRepresentativeName: boolean;
}

/**
 * 内部 assetKey + LOD → asset-spec §0.3 规范名。
 * 例：`toSheetName('building_res_d1', 'L1') === 'bld_res_low_v1_l1'`。
 * 未知 assetKey **显式抛错**（不得静默兜底，避免真实切片错配）。
 */
export function toSheetName(assetKey: string, lod: LodLevel | 'ALL' = 'L1'): string {
  const stem = ASSET_SHEET_STEMS[assetKey];
  if (stem === undefined) throw new Error('no sheet name mapping for assetKey: ' + assetKey);
  const suffix = LOD_SUFFIX[lod];
  if (suffix === undefined) throw new Error('unsupported lod: ' + String(lod));
  return stem + suffix;
}

/**
 * 反向解析：规范名 → `{ assetKey, lod, declaredLod, viaRepresentativeName }`。
 * `_l1` 后缀无二义信息：对 `lod='ALL'` 的资产，`declaredLod='ALL'` 且
 * `viaRepresentativeName=true`，**不做静默降级**（Q-3 / asset-spec §0.3.5）。
 * 未知名称显式抛错。
 */
export function fromSheetName(sheetName: string): SheetNameResolution {
  const lods: (LodLevel | 'ALL')[] = ['L0', 'L1', 'L2', 'ALL'];
  const keys = Object.keys(ASSET_SHEET_STEMS);
  for (let i = 0; i < keys.length; i++) {
    const assetKey = keys[i];
    for (let li = 0; li < lods.length; li++) {
      if (toSheetName(assetKey, lods[li]) === sheetName) {
        const declaredLod = declaredLodOf(assetKey);
        const viaRepresentativeName = declaredLod === 'ALL';
        return { assetKey, lod: viaRepresentativeName ? 'L1' : lods[li], declaredLod, viaRepresentativeName };
      }
    }
  }
  throw new Error('unknown sheet name: ' + sheetName);
}

/** 图集清单条目 → 规范名（图集视图里直接可读） */
export function sheetNameOfEntry(entry: AtlasEntry): string {
  return toSheetName(entry.assetKey, entry.lod);
}

export interface NamingCoverage {
  ok: boolean;
  errors: readonly string[];
  /** 成功映射的条目数 */
  mapped: number;
  /** 去重后的规范名个数（应等于 mapped，否则有碰撞） */
  uniqueNames: number;
}

/**
 * 命名覆盖率校验（**每一个清单条目都必须映射出规范名**）：
 * ① 覆盖：无缺失映射；② 合法性：`validateSheetName`（含受控语义词表）；
 * ③ 唯一：规范名无碰撞；④ 反解一致：`fromSheetName(toSheetName(e))` 回到原 assetKey；
 * ⑤ LOD 声明一致：`lod='ALL'` 的资产其所有条目必须是 `ALL`（反之亦然），
 *    代表名等价关系由 `declaredLod` 显式表达（§0.3.5）。
 */
export function assertNamingCoverage(manifest: readonly AtlasEntry[]): NamingCoverage {
  const errors: string[] = [];
  const seen: Record<string, string> = {};
  let mapped = 0;

  for (let i = 0; i < manifest.length; i++) {
    const entry = manifest[i];
    let sheet = '';
    try {
      sheet = toSheetName(entry.assetKey, entry.lod);
    } catch (err) {
      errors.push('unmapped assetKey: ' + entry.assetKey + ' (' + String(err) + ')');
      continue;
    }
    mapped++;

    const check = validateSheetName(sheet);
    if (!check.ok) {
      for (const e of check.errors) errors.push(e);
    }

    // ⑤ LOD 声明一致（§0.3.5：ALL 与 L1 共用代表名，但不得混用声明）
    let declaration: 'ALL' | 'SPLIT' | 'UNKNOWN' = 'UNKNOWN';
    try {
      declaration = declaredLodOf(entry.assetKey);
    } catch (err) {
      errors.push('lod declaration missing: ' + entry.assetKey + ' (' + String(err) + ')');
    }
    if (declaration === 'ALL' && entry.lod !== 'ALL') {
      errors.push('asset ' + entry.assetKey + ' 声明 ALL，但清单条目 lod=' + entry.lod + '（代表名不得混用）');
    }
    if (declaration === 'SPLIT' && entry.lod === 'ALL') {
      errors.push('asset ' + entry.assetKey + ' 声明三档切片，但清单条目 lod=ALL');
    }

    const prev = seen[sheet];
    if (prev !== undefined) {
      errors.push('sheet name collision: ' + sheet + ' ← ' + prev + ' / ' + entry.key);
    } else {
      seen[sheet] = entry.key;
    }

    try {
      const back = fromSheetName(sheet);
      if (back.assetKey !== entry.assetKey) {
        errors.push('round-trip assetKey mismatch: ' + sheet + ' → ' + back.assetKey + ' (expect ' + entry.assetKey + ')');
      }
      if (declaration === 'SPLIT' && back.declaredLod !== 'SPLIT') {
        errors.push('round-trip declaredLod mismatch: ' + sheet + ' → ' + back.declaredLod);
      }
    } catch (err) {
      errors.push('round-trip failed: ' + sheet + ' (' + String(err) + ')');
    }
  }

  const uniqueNames = Object.keys(seen).length;
  if (uniqueNames !== mapped) errors.push('unique names ' + uniqueNames + ' != mapped entries ' + mapped);
  return { ok: errors.length === 0, errors, mapped, uniqueNames };
}
