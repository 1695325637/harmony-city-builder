/**
 * HC-01 · S-06 渲染内核 · 资产命名映射层单测（A-01 / T-121 / T-129）
 *
 * 覆盖：虚拟清单**全覆盖**映射到 asset-spec **v0.1.1** §0.3 规范名、命名合法
 * （前缀受控 + **语义段命中受控词 / 描述词白名单** + `_lN` + 无空段）、**无碰撞**、
 * 反解一致、`state`/`shape` 裁定、LOD 代表名等价**显式声明**（Q-3）、未知键显式失败。
 *
 * 防自证：受控词 / 描述词白名单在用例内**另存一份**（逐字取自 asset-spec v0.1.1
 * §0.3.2 / §0.3.3），不复用实现侧常量。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ASSET_SHEET_STEMS,
  VIRTUAL_ATLAS_MANIFEST,
  assertNamingCoverage,
  declaredLodOf,
  fromSheetName,
  sheetNameOfEntry,
  toSheetName,
  validateSheetName,
  type AtlasEntry,
} from '../../src/index.ts';

/** §0.3.1 前缀（17 个，用例内联副本） */
const PREFIXES = ['tile', 'grid', 'overlay', 'road', 'flow', 'bld', 'veg', 'shadow', 'ao', 'sky', 'pat', 'ui', 'icon', 'vfx', 'font', 'brand', 'a11y'];

/** §0.3.2 受控语义词（用例内联副本） */
const CONTROLLED = new Set([
  'res', 'com', 'ind', 'civ',
  'low', 'mid', 'high',
  'straight', 'corner', 't', 'cross', 'end',
  'state', 'tool', 'metric', 'zone',
  'dots', 'hatch', 'grid', 'canopy',
  'valid', 'invalid', 'plan', 'view',
  'base', 'v1', 'v2', 'v3',
]);

/** §0.3.3 描述词（用例内联副本，含 §0.3.3「非穷举」允许的描述词扩展） */
const DESCRIPTORS = new Set([
  'ground', 'empty', 'grass', 'shore', 'roadbase', 'mark', 'lane', 'zebra', 'stop', 'arrow',
  'signal', 'line', 'thin', 'mid', 'thick', 'congest', 'pulse', 'static', 'tree', 'round',
  'cluster', 'cone', 'micro', 'soft', 'ellipse', 'contact', 'day', 'gradient', 'hud', 'topbar',
  'issue', 'list', 'diag', 'panel', 'minimap', 'frame', 'toast', '9slice', 'button', 'tab',
  'detail', 'card', 'endday', 'demolish', 'satisfaction', 'budget', 'cycle', 'check', 'warn',
  'neg', 'lock', 'up', 'down', 'place', 'spread', 'dust', 'growth', 'sweep', 'alert', 'select',
  'breath', 'ui', 'app', 'pattern', 'palette',
  'a', 'b', 'visible', 'ring', 'windows', 'points', 'weather', 'rain', 'road', 'cjk', 'icon',
]);

test('NAME-1 虚拟清单全覆盖：每个条目都能映射出规范名，且零错误（v0.1.1 词表）', () => {
  const coverage = assertNamingCoverage(VIRTUAL_ATLAS_MANIFEST);
  assert.equal(coverage.ok, true, '命名覆盖失败：' + coverage.errors.join(' | '));
  assert.deepEqual(coverage.errors, []);
  assert.equal(coverage.mapped, VIRTUAL_ATLAS_MANIFEST.length, '全部条目（含非图集资产）均已映射');
  assert.equal(coverage.uniqueNames, coverage.mapped, '规范名无碰撞');
  assert.ok(coverage.mapped >= 40, '清单条目数（实际 ' + coverage.mapped + '）');
});

test('NAME-2 命名合法性（用例侧独立分词校验）：前缀受控 / 语义段命中词表 / 全小写 / _lN / 无空段', () => {
  for (const entry of VIRTUAL_ATLAS_MANIFEST) {
    const sheet = sheetNameOfEntry(entry);
    assert.equal(sheet, sheet.toLowerCase(), sheet + ' 必须全小写');
    assert.equal(/^[a-z0-9_]+$/.test(sheet), true, sheet + ' 只允许小写字母数字与下划线');
    assert.equal(sheet.indexOf('__'), -1, sheet + ' 不得有空段');
    assert.equal(/_l[012]$/.test(sheet), true, sheet + ' 必须以 _l0/_l1/_l2 结尾');
    const segs = sheet.split('_');
    assert.ok(PREFIXES.indexOf(segs[0]) >= 0, sheet + ' 前缀 ' + segs[0] + ' 不在 §0.3.1 白名单');
    const variant = segs[segs.length - 2];
    assert.equal(/^(?:base|v[1-9][0-9]*)$/.test(variant), true, sheet + ' 变体段须为 base/vN');
    const semantic = segs.slice(1, segs.length - 2);
    assert.ok(semantic.length >= 1 && semantic.length <= 3, sheet + ' 语义段 1–3 段');
    for (const w of semantic) {
      assert.ok(CONTROLLED.has(w) || DESCRIPTORS.has(w), sheet + ' 语义段 `' + w + '` 不在受控词 / 描述词白名单');
    }
  }
});

test('NAME-3 具体映射逐条对照（含 T-129 七条订正）', () => {
  // 建筑 / 地块 / 图案（评审点名的 A-01 项）
  assert.equal(toSheetName('building_res_d1', 'L1'), 'bld_res_low_v1_l1');
  assert.equal(toSheetName('ui_icon_zone_R', 'ALL'), 'icon_zone_res_base_l1');
  assert.equal(toSheetName('pattern_dots', 'ALL'), 'pat_res_dots_base_l1');
  assert.equal(toSheetName('tile_empty', 'L1'), 'tile_ground_empty_base_l1');
  assert.equal(toSheetName('tree_round', 'L1'), 'veg_tree_round_base_l1');
  // T-129 §2 七条订正（v0.1.1 §0.3.4：`state` 为唯一准绳；语义化而非物理形状）
  assert.equal(toSheetName('ui_shape_check', 'ALL'), 'icon_state_check_base_l1');
  assert.equal(toSheetName('ui_shape_exclamation', 'ALL'), 'icon_state_warn_base_l1', '物理形状 exclamation → 玩家可见语义 warn');
  assert.equal(toSheetName('ui_shape_cross', 'ALL'), 'icon_state_neg_base_l1', '物理形状 cross → 玩家可见语义 neg');
  assert.equal(toSheetName('ui_shape_lock', 'ALL'), 'icon_state_lock_base_l1');
  assert.equal(toSheetName('ui_shape_arrow_up', 'ALL'), 'icon_state_up_base_l1', '物理形状 arrow_up → 玩家可见语义 up');
  assert.equal(toSheetName('ui_shape_arrow_down', 'ALL'), 'icon_state_down_base_l1', '物理形状 arrow_down → 玩家可见语义 down');
  assert.equal(toSheetName('font_token_main', 'ALL'), 'font_ui_cjk_base_l1', 'font_ui_main → font_ui_cjk');
  // Could 预留项保持现状（美术侧判定：未编号、不受 §0.3 约束）
  assert.equal(toSheetName('windows_points', 'ALL'), 'vfx_windows_points_base_l1');
  assert.equal(toSheetName('weather_rain', 'ALL'), 'vfx_weather_rain_base_l1');
  // 旧名不得残留（回归防漂）
  for (const e of VIRTUAL_ATLAS_MANIFEST) {
    const sheet = sheetNameOfEntry(e);
    assert.equal(/icon_shape_/.test(sheet), false, '残留 icon_shape_*：' + sheet);
    assert.equal(/font_ui_main/.test(sheet), false, '残留 font_ui_main：' + sheet);
  }
  // 密度三档 ↔ low/mid/high
  assert.equal(toSheetName('building_res_d2', 'L1'), 'bld_res_mid_v1_l1');
  assert.equal(toSheetName('building_ind_d3', 'L2'), 'bld_ind_high_v1_l2');
});

test('NAME-4 反解一致：fromSheetName(toSheetName(e)) 回到原 assetKey（ALL 为代表名）', () => {
  for (const entry of VIRTUAL_ATLAS_MANIFEST) {
    const sheet = toSheetName(entry.assetKey, entry.lod);
    const back = fromSheetName(sheet);
    assert.equal(back.assetKey, entry.assetKey, sheet + ' 反解 assetKey 一致');
    if (entry.lod === 'ALL') {
      assert.equal(back.lod, 'L1', sheet + '：ALL 反解为代表名 L1');
      assert.equal(back.declaredLod, 'ALL', sheet + '：须显式标注声明为 ALL（不静默降级）');
      assert.equal(back.viaRepresentativeName, true);
    } else {
      assert.equal(back.lod, entry.lod, sheet + ' 反解 lod 一致');
      assert.equal(back.declaredLod, 'SPLIT', sheet + '：三档切片声明');
      assert.equal(back.viaRepresentativeName, false);
    }
  }
});

test('NAME-4b ALL 与 L1 同时声明会被判碰撞（_l1 代表名不可二义复用）', () => {
  const dual: AtlasEntry[] = VIRTUAL_ATLAS_MANIFEST.concat([
    {
      key: 'ui_panel_9slice@L1',
      assetKey: 'ui_panel_9slice',
      atlasId: 'UI',
      lod: 'L1',
      rect: { x: 0, y: 0, w: 48, h: 48 },
      padding: 0.04,
    },
  ]);
  const coverage = assertNamingCoverage(dual);
  assert.equal(coverage.ok, false, 'ALL + L1 并存须判碰撞 / 声明不一致');
  assert.ok(
    coverage.errors.some((x) => x.indexOf('collision') >= 0 || x.indexOf('声明 ALL') >= 0),
    '错误含 collision 或声明不一致：' + coverage.errors.join(' | '),
  );
});

test('NAME-5 未知 assetKey / 未知规范名显式失败（不得静默兜底）', () => {
  assert.throws(() => toSheetName('building_unknown_d9', 'L1'), /no sheet name mapping/);
  assert.throws(() => fromSheetName('bld_unknown_low_v9_l1'), /unknown sheet name/);
  assert.throws(() => fromSheetName(''), /unknown sheet name/);
  assert.throws(() => toSheetName('tile_empty', 'L3' as never), /unsupported lod/);
});

test('NAME-6 碰撞检测有效：人为把两条映射到同名 stem 会被 assertNamingCoverage 拒绝', () => {
  const tampered: AtlasEntry[] = VIRTUAL_ATLAS_MANIFEST.map((e) =>
    e.assetKey === 'tile_grass' && e.lod === 'L1' ? { ...e, assetKey: 'tile_empty' } : e,
  );
  const coverage = assertNamingCoverage(tampered);
  assert.equal(coverage.ok, false, '同名 stem + 同 LOD 必须被拒绝');
  assert.ok(coverage.errors.some((x) => x.indexOf('collision') >= 0), '错误含 collision：' + coverage.errors.join(' | '));
});

test('NAME-7 非图集资产同样有规范名（字体 / App 图标 / 天空）', () => {
  assert.equal(toSheetName('font_token_main', 'ALL'), 'font_ui_cjk_base_l1');
  assert.equal(toSheetName('app_icon', 'ALL'), 'brand_app_icon_base_l1');
  assert.equal(toSheetName('sky_gradient', 'ALL'), 'sky_day_gradient_base_l1');
  for (const key of ['font_token_main', 'app_icon', 'sky_gradient']) {
    assert.equal(validateSheetName(toSheetName(key, 'ALL')).ok, true, key + ' 规范名合法');
  }
});

test('NAME-8（T-129 §3）校验器接入受控语义词表：asset-spec §0.3.6 四条反例全部拒绝', () => {
  // 反例 1：shape 违规（应为 state）——这是 v0.1.1 之前实现会放过的漏网项
  const r1 = validateSheetName('icon_shape_warn_base_l1');
  assert.equal(r1.ok, false, '`icon_shape_*` 必须被拒绝');
  assert.ok(r1.errors.some((e) => e.indexOf('shape') >= 0 && e.indexOf('state') >= 0), '错误须指明应用 state：' + r1.errors.join(' | '));
  // 反例 2：d1 为工程私有键
  const r2 = validateSheetName('bld_res_d1_l1');
  assert.equal(r2.ok, false, '`d1` 必须被拒绝');
  assert.ok(r2.errors.some((e) => e.indexOf('d1') >= 0 && e.indexOf('low') >= 0));
  // 反例 3：含大写
  assert.equal(validateSheetName('Bld_Res_Low_l1').ok, false, '大写必须被拒绝');
  // 反例 4：空段
  assert.equal(validateSheetName('bld__res_l1').ok, false, '空段必须被拒绝');

  // 正例：v0.1.1 §0.3.6 示例全部通过
  for (const good of [
    'bld_res_low_v1_l1', 'bld_com_high_v2_l1', 'bld_ind_mid_v1_l1',
    'tile_ground_empty_base_l1', 'road_straight_a_base_l1', 'road_corner_base_l1',
    'pat_res_dots_base_l1', 'icon_zone_ind_base_l1', 'icon_state_warn_base_l1',
  ]) {
    const r = validateSheetName(good);
    assert.equal(r.ok, true, good + ' 应通过，错误：' + r.errors.join(' | '));
  }
  // 变体 / LOD 段本身也受约束
  assert.equal(validateSheetName('bld_res_low_x1_l1').ok, false, '变体段须 base 或 vN');
  assert.equal(validateSheetName('bld_res_low_v1_l3').ok, false, 'LOD 段须 l0/l1/l2');
});

test('NAME-9（Q-3 / §0.3.5）LOD 回环显式等价：declaredLodOf 与代表名声明一致', () => {
  // 每个 assetKey 的声明必须与清单一致，且两类声明互斥
  const declaredAll: string[] = [];
  const declaredSplit: string[] = [];
  for (const key of Object.keys(ASSET_SHEET_STEMS)) {
    const decl = declaredLodOf(key);
    if (decl === 'ALL') declaredAll.push(key);
    else declaredSplit.push(key);
  }
  assert.ok(declaredAll.length > 0 && declaredSplit.length > 0, '两类声明都应存在');
  assert.deepEqual(declaredAll.filter((k) => declaredSplit.indexOf(k) >= 0), [], '同一 assetKey 不得同时声明 ALL 与 SPLIT');
  // ALL 资产的三个规范名都落在 _l1 代表名上（等价关系显式，不是静默降级）
  for (const key of declaredAll) {
    const sheet = toSheetName(key, 'ALL');
    const back = fromSheetName(sheet);
    assert.equal(back.assetKey, key);
    assert.equal(back.declaredLod, 'ALL', key + ' 反解须保留 ALL 声明');
  }
  // 三档切片资产：l0/l1/l2 各自回环，声明为 SPLIT
  for (const key of declaredSplit.slice(0, 5)) {
    for (const lod of ['L0', 'L1', 'L2'] as const) {
      const back = fromSheetName(toSheetName(key, lod));
      assert.equal(back.lod, lod);
      assert.equal(back.declaredLod, 'SPLIT');
    }
  }
});
