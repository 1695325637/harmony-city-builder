/**
 * HC-01 · S-06 渲染内核 · 虚拟图集清单 / 校验 / 分包加载单测
 *
 * 覆盖：12 组齐备、2048² 上限、重叠拒绝、留白阈值、同一资产三档 LOD 同图集、
 * 建筑图集分区门控、按激活分区集解析加载集（未解锁分区不预载）、非图集资产排除。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ATLAS_GROUPS,
  ATLAS_SIZE,
  DEFERRED_COULD_ATLASES,
  VIRTUAL_ATLAS_MANIFEST,
  buildFrameKeyIndex,
  createVirtualAtlasManifest,
  entriesOfAtlas,
  indexManifest,
  resolveLoadSet,
  validateAtlasManifest,
  type AtlasEntry,
} from '../../src/index.ts';

function cloneManifest(): AtlasEntry[] {
  return JSON.parse(JSON.stringify(VIRTUAL_ATLAS_MANIFEST)) as AtlasEntry[];
}

test('ATLAS-1 默认清单 12 组齐备且校验通过（占位规格）', () => {
  assert.equal(ATLAS_GROUPS.length, 12);
  assert.deepEqual(
    ATLAS_GROUPS,
    ['UI', 'UI-图案编码', '地形地块', '道路', '建筑-居住', '建筑-商业', '建筑-产业', '建筑-公共服务', '植被', 'VFX', '昼夜窗光', '天气'],
  );
  const v = validateAtlasManifest(VIRTUAL_ATLAS_MANIFEST);
  assert.equal(v.ok, true, '校验错误：' + v.errors.join(' | '));
  assert.deepEqual(v.errors, []);
  for (const g of ATLAS_GROUPS) {
    assert.ok(entriesOfAtlas(VIRTUAL_ATLAS_MANIFEST, g).length > 0, g + ' 组有资产条目');
  }
});

test('ATLAS-2 全部图集矩形在 2048² 内、同图集互不重叠、世界资产为 128×64 整数倍', () => {
  assert.equal(ATLAS_SIZE, 2048);
  assert.equal(ATLAS_SIZE, 128 * 16, '画布 = (128×16) × (64×32) 的宽');
  assert.equal(ATLAS_SIZE, 64 * 32, '画布 = (128×16) × (64×32) 的高');
  const visible = VIRTUAL_ATLAS_MANIFEST.filter((e) => e.nonAtlas !== true);
  for (const e of visible) {
    assert.ok(e.rect.x >= 0 && e.rect.y >= 0);
    assert.ok(e.rect.x + e.rect.w <= ATLAS_SIZE && e.rect.y + e.rect.h <= ATLAS_SIZE, e.key + ' 在图集内');
  }
  for (const e of visible) {
    if (e.atlasId === 'UI' || e.atlasId === 'UI-图案编码') continue; // UI 切片 24/48 栅格
    assert.equal(e.rect.w % 128, 0, e.key + ' 宽度为 128 倍数');
    assert.equal(e.rect.h % 64, 0, e.key + ' 高度为 64 倍数');
  }
});

test('ATLAS-3 重叠即拒绝（人工把一条移到另一条上）', () => {
  const bad = cloneManifest();
  const a = bad.find((e) => e.atlasId === '道路' && e.assetKey === 'road_straight' && e.lod === 'L0') as AtlasEntry;
  const b = bad.find((e) => e.atlasId === '道路' && e.assetKey === 'road_cross' && e.lod === 'L0') as AtlasEntry;
  b.rect.x = a.rect.x;
  b.rect.y = a.rect.y;
  const v = validateAtlasManifest(bad);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((x) => x.indexOf('overlap') >= 0), '错误含 overlap：' + v.errors.join(' | '));
});

test('ATLAS-4 越界 / 留白超阈 / 缺 zoneGate / 跨图集分裂 逐项拒绝', () => {
  // 越界
  const outOfBounds = cloneManifest();
  const o = outOfBounds.find((e) => e.atlasId === '地形地块') as AtlasEntry;
  o.rect.x = ATLAS_SIZE - 1;
  assert.ok(validateAtlasManifest(outOfBounds).errors.some((x) => x.indexOf('out of atlas bounds') >= 0));

  // 留白 > 10%
  const padded = cloneManifest();
  const p = padded.find((e) => e.atlasId === '植被') as AtlasEntry;
  p.padding = 0.15;
  assert.ok(validateAtlasManifest(padded).errors.some((x) => x.indexOf('exceeds 10%') >= 0));

  // 建筑条目缺 zoneGate
  const noGate = cloneManifest();
  const g = noGate.find((e) => e.atlasId === '建筑-居住') as AtlasEntry;
  delete g.zoneGate;
  assert.ok(validateAtlasManifest(noGate).errors.some((x) => x.indexOf('missing zoneGate') >= 0));

  // 同一资产三档 LOD 跨图集
  const split = cloneManifest();
  const s = split.find((e) => e.assetKey === 'building_res_d1' && e.lod === 'L2') as AtlasEntry;
  s.atlasId = '建筑-商业';
  const v = validateAtlasManifest(split);
  assert.ok(v.errors.some((x) => x.indexOf('split across atlases') >= 0), '三档必须同图集：' + v.errors.join(' | '));
});

test('ATLAS-5 留白以切片透明边距比建模：全清单加权 ≤10%', () => {
  const v = validateAtlasManifest(VIRTUAL_ATLAS_MANIFEST);
  for (const g of ATLAS_GROUPS) {
    const st = v.stats[g];
    assert.ok(st !== undefined, g + ' 有统计');
    assert.ok(st.paddingRatio >= 0 && st.paddingRatio <= 0.1, g + ' paddingRatio=' + st.paddingRatio.toFixed(4));
    assert.ok(st.occupancy > 0 && st.occupancy <= 1, g + ' occupancy=' + st.occupancy.toFixed(4));
    assert.ok(st.maxX <= ATLAS_SIZE && st.maxY <= ATLAS_SIZE);
  }
});

test('ATLAS-6 清单确定性：两次构建逐条一致（无随机布局）', () => {
  const a = createVirtualAtlasManifest();
  const b = createVirtualAtlasManifest();
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.deepEqual(a[i], b[i], '第 ' + i + ' 条一致');
  }
});

test('ATLAS-7 三档 LOD 同图集（切档不产生跨图集抖动）', () => {
  const idx = buildFrameKeyIndex(VIRTUAL_ATLAS_MANIFEST);
  const assets = ['building_res_d1', 'building_com_d1', 'building_ind_d1', 'tile_empty', 'road_straight'];
  for (const assetKey of assets) {
    const atlasIds = ['L0', 'L1', 'L2'].map((lod) => idx[assetKey + '@' + lod].atlasId);
    assert.equal(new Set(atlasIds).size, 1, assetKey + ' 三档同图集：' + atlasIds.join(','));
  }
  const perLod = ['L0', 'L1', 'L2'].map((lod) => new Set(VIRTUAL_ATLAS_MANIFEST.filter((e) => e.lod === lod && e.nonAtlas !== true).map((e) => e.atlasId)).size);
  assert.equal(perLod[0], perLod[1], 'L0 / L1 使用的图集数一致（无跨图集切换）');
  assert.equal(perLod[1], perLod[2], 'L1 / L2 使用的图集数一致（无跨图集切换）');
});

test('ATLAS-8 分包加载：未解锁分区不进 resident / onDemand；LOD 决定 VFX / 窗光 / 天气', () => {
  const l1r = resolveLoadSet(['R'], 'L1');
  assert.deepEqual(l1r.resident, ['UI', 'UI-图案编码', '地形地块', '道路']);
  assert.ok(l1r.onDemand.indexOf('建筑-居住') >= 0, '激活分区 R → 居住图集按需');
  for (const none of ['建筑-商业', '建筑-产业', '建筑-公共服务']) {
    assert.equal(l1r.resident.indexOf(none as never), -1, none + ' 不得常驻');
    assert.equal(l1r.onDemand.indexOf(none as never), -1, none + ' 未激活不得预载');
    assert.ok(l1r.excluded.indexOf(none as never) >= 0, none + ' 进排除集');
  }
  // L0：VFX / 昼夜窗光 / 天气 全部排除；L2：昼夜窗光按需
  const l0 = resolveLoadSet(['R', 'C', 'I'], 'L0');
  assert.equal(l0.onDemand.indexOf('VFX'), -1);
  assert.equal(l0.onDemand.indexOf('昼夜窗光'), -1);
  assert.equal(l0.onDemand.indexOf('天气'), -1);
  const l2 = resolveLoadSet(['R', 'C', 'I'], 'L2');
  assert.ok(l2.onDemand.indexOf('VFX') >= 0);
  assert.ok(l2.onDemand.indexOf('昼夜窗光') >= 0);
  // 未激活分区在所有 LOD 下都不出现在 resident / onDemand
  for (const lod of ['L0', 'L1', 'L2'] as const) {
    const set = resolveLoadSet(['R'], lod);
    assert.equal(set.onDemand.indexOf('建筑-商业'), -1, lod + ' 商业未激活不预载');
    assert.equal(set.onDemand.indexOf('建筑-产业'), -1, lod + ' 产业未激活不预载');
  }
});

test('ATLAS-9 非图集资产（天空渐变 / 字体 / App 图标）标 nonAtlas 且不进合批链', () => {
  const nonAtlas = VIRTUAL_ATLAS_MANIFEST.filter((e) => e.nonAtlas === true);
  const keys = nonAtlas.map((e) => e.assetKey).sort();
  assert.deepEqual(keys, ['app_icon', 'font_token_main', 'sky_gradient']);
  for (const e of nonAtlas) assert.equal(e.rect.w, 0, e.assetKey + ' 不占图集空间');
  // 帧键索引（合批用）不含非图集资产
  const frameIndex = buildFrameKeyIndex(VIRTUAL_ATLAS_MANIFEST);
  assert.equal(frameIndex['sky_gradient@ALL'], undefined);
  const drawIndex = indexManifest(VIRTUAL_ATLAS_MANIFEST);
  assert.equal(drawIndex['font_token_main@ALL'], undefined);
  // 加载集单独列出，不与图集混淆
  const set = resolveLoadSet(['R'], 'L1');
  assert.ok(set.nonAtlas.indexOf('sky_gradient') >= 0);
  assert.equal(set.resident.indexOf('sky_gradient' as never), -1);
});

test('ATLAS-10（A-04 / Q-4）建筑密度 d1/d2/d3 齐备，高度阶梯 64/128/192（居住·产业 d3）', () => {
  const heightsOf = (keys: string[]): number[] =>
    keys.map((key) => {
      const e = VIRTUAL_ATLAS_MANIFEST.find((x) => x.assetKey === key && x.lod === 'L1');
      assert.ok(e !== undefined, key + ' 存在占位条目');
      return e.rect.h;
    });
  // 居住 / 产业：1:2:3 体量阶梯（Q-4：d3 提到 128×192）
  assert.deepEqual(heightsOf(['building_res_d1', 'building_res_d2', 'building_res_d3']), [64, 128, 192]);
  assert.deepEqual(heightsOf(['building_ind_d1', 'building_ind_d2', 'building_ind_d3']), [64, 128, 192]);
  // 商业 d3 维持 256×128（横向体量而非高度）
  assert.deepEqual(heightsOf(['building_com_d1', 'building_com_d2', 'building_com_d3']), [64, 128, 128]);
  // 全部世界资产仍满足 128×64 整数倍
  for (const e of VIRTUAL_ATLAS_MANIFEST) {
    if (e.nonAtlas === true || e.atlasId === 'UI' || e.atlasId === 'UI-图案编码') continue;
    assert.equal(e.rect.w % 128, 0, e.key + ' 宽度 128 倍数');
    assert.equal(e.rect.h % 64, 0, e.key + ' 高度 64 倍数');
  }
  // 全部建筑条目仍带 zoneGate
  for (const e of VIRTUAL_ATLAS_MANIFEST) {
    if (e.atlasId.startsWith('建筑-') && e.nonAtlas !== true) assert.ok(e.zoneGate !== undefined, e.key + ' 缺 zoneGate');
  }
});

test('ATLAS-11（A-06）Could 预留标记：昼夜窗光 / 天气显式 deferredCould，加载行为不变', () => {
  for (const lod of ['L0', 'L1', 'L2'] as const) {
    const set = resolveLoadSet(['R', 'C', 'I'], lod);
    assert.ok(set.deferredCould.indexOf('昼夜窗光') >= 0, lod + '：昼夜窗光须标 Could 预留');
    assert.ok(set.deferredCould.indexOf('天气') >= 0, lod + '：天气须标 Could 预留');
    // 标记不改加载行为：L1 仍 onDemand(天气)/excluded(昼夜窗光)，L2 两者 onDemand，L0 全部排除
    if (lod === 'L0') {
      assert.equal(set.onDemand.indexOf('天气'), -1);
      assert.ok(set.excluded.indexOf('天气') >= 0);
    } else if (lod === 'L1') {
      assert.ok(set.onDemand.indexOf('天气') >= 0, 'L1：加载行为与 T-118 一致（天气仍 in onDemand）');
      assert.ok(set.excluded.indexOf('昼夜窗光') >= 0, 'L1：昼夜窗光仍按 L2-only 规则排除');
    } else {
      assert.ok(set.onDemand.indexOf('天气') >= 0, 'L2：天气 in onDemand');
      assert.ok(set.onDemand.indexOf('昼夜窗光') >= 0, 'L2：昼夜窗光 in onDemand');
    }
    // deferredCould 与 resident/onDemand 不冲突于 MVP 使用语义
    assert.equal(set.resident.indexOf('天气'), -1);
  }
  // 标记常量本身只含两项，避免范围扩散
  assert.deepEqual(DEFERRED_COULD_ATLASES, ['昼夜窗光', '天气']);
});
