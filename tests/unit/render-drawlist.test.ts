/**
 * HC-01 · S-06 渲染内核 · 绘制列表 / 合批单测
 *
 * 覆盖：深度排序单调、按图集聚合（批次数 = 估算 DrawCall）、切 LOD 不产生跨图集抖动、
 * 非图集资产不进合批链、缺帧如实计数、DrawCall 估算落在他建议基线内（记录不作门禁）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_H,
  CELL_W,
  DRAW_CALL_BASELINE,
  VIRTUAL_ATLAS_MANIFEST,
  buildDrawList,
  buildSemanticTokenMap,
  buildViewModel,
  compareDepth,
  createDefaultConfig,
  createInitialState,
  densityToSuffix,
  gridToScreen,
  zoneIndex,
  type AtlasEntry,
  type LodLevel,
} from '../../src/index.ts';

function demoState() {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = y * state.side + x;
      state.cells.unlocked[i] = 1;
      if (x % 3 === 0 || y % 3 === 0) {
        state.cells.zone[i] = zoneIndex(config, 'ROAD');
        continue;
      }
      const b = ((x >> 1) + (y >> 1)) % 3;
      state.cells.zone[i] = zoneIndex(config, b === 0 ? 'R' : b === 1 ? 'C' : 'I');
      state.cells.density[i] = ((x + y) % 3) + 1;
    }
  }
  return { config, state };
}

test('DRAW-1 深度排序单调：索引递增时 (gx+gy) 不减，同格内地形先于建筑', () => {
  const { state } = demoState();
  const vm = buildViewModel(state);
  const dl = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, 'L1');
  assert.ok(dl.spriteCount > 100, '示例地图产生足量 sprite（实际 ' + dl.spriteCount + '）');
  for (let i = 1; i < dl.sprites.length; i++) {
    const prev = dl.sprites[i - 1];
    const cur = dl.sprites[i];
    assert.ok(compareDepth(prev, cur) <= 0, '绘制序按 compareDepth 升序：#' + i);
    assert.equal(cur.index, i, '绘制序索引连续');
  }
  // 同格：地形 index < 建筑 index
  const byCell: Record<number, string[]> = {};
  for (const s of dl.sprites) {
    (byCell[s.cellIndex] ??= []).push(s.kind);
  }
  for (const k of Object.keys(byCell)) {
    const kinds = byCell[Number(k)];
    if (kinds.length > 1) assert.equal(kinds[0], 'terrain', '同格地形先画（cell ' + k + '：' + kinds.join('>') + '）');
  }
});

test('DRAW-2 按图集聚合：批次数 = 使用的图集数，批内深度升序，无同图集拆批', () => {
  const { state } = demoState();
  const vm = buildViewModel(state);
  const dl = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, 'L1');
  const atlasInBatches = dl.batches.map((b) => b.atlasId);
  assert.equal(new Set(atlasInBatches).size, atlasInBatches.length, '同一图集只出现一个批次（避免打断合批）');
  assert.equal(dl.batches.reduce((n, b) => n + b.sprites.length, 0), dl.spriteCount, '批次覆盖全部 sprite');
  assert.equal(dl.estimatedDrawCalls, dl.batches.length);
  for (const batch of dl.batches) {
    for (let i = 1; i < batch.sprites.length; i++) {
      assert.ok(compareDepth(batch.sprites[i - 1], batch.sprites[i]) <= 0, batch.atlasId + ' 批内深度升序');
    }
  }
});

test('DRAW-3 切 LOD 不产生跨图集批次抖动（S-06 验收①）', () => {
  const { state } = demoState();
  const vm = buildViewModel(state);
  const lods: LodLevel[] = ['L0', 'L1', 'L2'];
  const batchSets = lods.map((lod) => {
    const dl = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, lod);
    return dl.batches.map((b) => b.atlasId).sort().join('|');
  });
  assert.equal(batchSets[0], batchSets[1], 'L0 → L1 图集批次集合不变');
  assert.equal(batchSets[1], batchSets[2], 'L1 → L2 图集批次集合不变');
  // 每个 sprite 的 atlasId 在三档之间也一致（同一格同一资产同一图集）
  const perLod = lods.map((lod) => buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, lod).sprites.map((s) => s.cellIndex + ':' + s.atlasId).join(','));
  assert.equal(perLod[0], perLod[1]);
  assert.equal(perLod[1], perLod[2]);
});

test('DRAW-4 DrawCall 估算落在建议基线内（记录用，非门禁断言）', () => {
  const { state } = demoState();
  const vm = buildViewModel(state);
  for (const lod of ['L0', 'L1', 'L2'] as LodLevel[]) {
    const dl = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, lod);
    const baseline = DRAW_CALL_BASELINE[lod];
    console.log('[DRAW-4] ' + lod + ' 估算 DrawCall = ' + dl.estimatedDrawCalls + '（建议基线 ≤' + baseline + '，非承诺值）');
    assert.ok(dl.estimatedDrawCalls <= baseline, lod + ' 估算值超出建议基线（需复核图集划分）');
  }
});

test('DRAW-5 坐标与资产：sprite 屏幕坐标 = gridToScreen，地形 / 道路 / 建筑分类正确', () => {
  const { config, state } = demoState();
  const vm = buildViewModel(state);
  const dl = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, 'L1');
  const side = state.side;
  for (const s of dl.sprites) {
    const p = gridToScreen(s.gx, s.gy);
    assert.equal(s.x, p.x);
    assert.equal(s.y, p.y);
    assert.equal(s.cellIndex, s.gy * side + s.gx);
    const zone = state.cells.zone[s.cellIndex];
    if (s.kind === 'terrain') assert.equal(s.atlasId, '地形地块');
    if (s.kind === 'road') {
      assert.equal(zone, zoneIndex(config, 'ROAD'));
      assert.equal(s.atlasId, '道路');
    }
    if (s.kind === 'building') {
      assert.ok(zone >= 2, '建筑只出现在分区格');
      assert.ok(s.atlasId.startsWith('建筑-'), '建筑图集：' + s.atlasId);
    }
  }
  assert.equal(dl.skipped, 0, '默认清单不应有缺帧');
});

test('DRAW-6 非图集资产不进合批链 + 缺帧如实计数', () => {
  const { state } = demoState();
  const vm = buildViewModel(state);
  const dl = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, 'L1');
  for (const b of dl.batches) assert.notEqual(b.atlasId, 'sky_gradient');
  for (const s of dl.sprites) assert.notEqual(s.assetKey, 'font_token_main');

  // 抽掉地形资产 → 地形 sprite 全部计入 skipped（不静默兜底）
  const broken = VIRTUAL_ATLAS_MANIFEST.filter((e: AtlasEntry) => e.assetKey !== 'tile_empty');
  const dlBroken = buildDrawList(vm, broken, 'L1');
  assert.ok(dlBroken.skipped > 0, '缺帧被计数（实际 ' + dlBroken.skipped + '）');
  assert.equal(dlBroken.spriteCount, dl.spriteCount - dlBroken.skipped, '跳过数 + 实际 sprite = 原总数');
});

test('DRAW-7 单格常量与渲染无关常量不被绘制层改写（CELL_W/H 只读）', () => {
  assert.equal(CELL_W, 128);
  assert.equal(CELL_H, 64);
});

test('DRAW-8（A-04）densityToSuffix 单一映射：0→无 / 1→d1 / 2→d2 / 3→d3', () => {
  assert.equal(densityToSuffix(0), '', '未建设 → 无建筑变体');
  assert.equal(densityToSuffix(1), 'd1');
  assert.equal(densityToSuffix(2), 'd2', '中密度必须输出 d2（此前错配为 d1）');
  assert.equal(densityToSuffix(3), 'd3');
  assert.equal(densityToSuffix(4), 'd3', '越界钳到 d3');
  assert.equal(densityToSuffix(-1), '', '非法值 → 无');
  assert.equal(densityToSuffix(Number.NaN), '', 'NaN → 无');
});

test('DRAW-9（A-04）密度三档在绘制列表里真实产出 d1/d2/d3 三种建筑变体', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  // 三格同为居住，密度分别为 1 / 2 / 3
  const spots: [number, number, number][] = [[1, 1, 1], [3, 1, 2], [5, 1, 3]];
  for (const [x, y, density] of spots) {
    const i = y * state.side + x;
    state.cells.unlocked[i] = 1;
    state.cells.zone[i] = zoneIndex(config, 'R');
    state.cells.density[i] = density;
  }
  const vm = buildViewModel(state);
  const dl = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, 'L1');
  const buildings = dl.sprites.filter((s) => s.kind === 'building').map((s) => s.assetKey).sort();
  assert.deepEqual(buildings, ['building_res_d1', 'building_res_d2', 'building_res_d3']);
  assert.equal(dl.skipped, 0, '三档变体均能在占位清单命中（无缺帧）');
});

test('DRAW-10（T-129 Q-1）L0 不产状态形状；L1/L2 产出，且 L1 带 1px base.ink 内描边', () => {
  const { config, state } = demoState();
  const vm = buildViewModel(state);
  const tokens = buildSemanticTokenMap(config.zoneTypes);
  const overlays = [
    { cellIndex: 1 * state.side + 1, layer: 'flow' as const, token: tokens.flow['flow.congested'] },
    { cellIndex: 2 * state.side + 2, layer: 'status' as const, token: tokens.status['status.warning'] },
  ];
  const outlineInk = { id: 'base.ink', color: tokens.base['base.ink'].color };

  // L0：形状全关（shapeSpriteCount === 0）
  const l0 = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, 'L0', { overlays, outlineInk });
  assert.equal(l0.shapeSpriteCount, 0, 'L0 不得产出任何 status/flow 形状');
  assert.equal(l0.overlays.filter((o) => o.shapeVisible).length, 0, 'L0 条目 shapeVisible 全为 false');
  assert.equal(l0.overlays.length, 2, '叠加层条目仍保留（用于线宽 / 亮度编码）');
  // 通勤态在 L0 仍有非空编码（信息不丢）
  const flowL0 = l0.overlays.filter((o) => o.layer === 'flow')[0];
  assert.notEqual(flowL0.line, null, 'L0 通勤态必须有线宽 / 亮度编码');
  assert.equal(flowL0.line.widthScale, 3, 'flow.congested → 最粗线宽');
  assert.equal(flowL0.line.brightness, 1);
  assert.equal(l0.lineEncodedCount, 1);
  // status 在 L0：形状关闭且无线编码 → 显式计数（远景态可接受）
  const statusL0 = l0.overlays.filter((o) => o.layer === 'status')[0];
  assert.equal(statusL0.shapeVisible, false);
  assert.equal(statusL0.line, null);
  assert.equal(l0.hiddenOverlayCount, 1);
  assert.equal(l0.overlays.filter((o) => o.outline !== undefined).length, 0, 'L0 无描边');

  // L1：形状可见 + 1px base.ink 内描边
  const l1 = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, 'L1', { overlays, outlineInk });
  assert.equal(l1.shapeSpriteCount, 2, 'L1 须产出全部形状');
  assert.equal(l1.lineEncodedCount, 0);
  for (const o of l1.overlays) {
    assert.equal(o.shapeVisible, true);
    assert.notEqual(o.outline, undefined, 'L1 形状必须带描边');
    assert.equal(o.outline.width, 1, '描边 1px');
    assert.equal(o.outline.inkTokenId, 'base.ink', '描边色取 base.ink 令牌');
    assert.equal(o.outline.color, outlineInk.color, '描边色值由令牌提供（渲染层不自造）');
  }

  // L2：形状可见、不描边
  const l2 = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, 'L2', { overlays, outlineInk });
  assert.equal(l2.shapeSpriteCount, 2);
  for (const o of l2.overlays) {
    assert.equal(o.shapeVisible, true);
    assert.equal(o.outline, undefined, 'L2 不描边');
  }

  // 叠加层是独立层：不影响世界 sprite / 批次 / DrawCall 估算
  const plain = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, 'L1');
  assert.equal(l1.spriteCount, plain.spriteCount, '叠加层不进 sprites');
  assert.equal(l1.estimatedDrawCalls, plain.estimatedDrawCalls, '叠加层不进合批');
  assert.equal(plain.overlays.length, 0, '未传 overlays 时零叠加层（T-121 行为不变）');
});

test('DRAW-11（T-129）L0 线宽编码可派生、非法格索引如实计入 skipped', () => {
  const { config, state } = demoState();
  const vm = buildViewModel(state);
  const tokens = buildSemanticTokenMap(config.zoneTypes);
  // 不显式给 line → 按令牌 id 派生（clear 1/0.6、slow 2/0.8、congested 3/1.0）
  const specs = [
    { cellIndex: 0, layer: 'flow' as const, token: tokens.flow['flow.clear'] },
    { cellIndex: 1, layer: 'flow' as const, token: tokens.flow['flow.slow'] },
    { cellIndex: 2, layer: 'flow' as const, token: tokens.flow['flow.congested'] },
    { cellIndex: 999999, layer: 'flow' as const, token: tokens.flow['flow.clear'] },
  ];
  const l0 = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, 'L0', { overlays: specs });
  const lineOf = (id: string) => {
    const o = l0.overlays.filter((x) => x.tokenId === id)[0];
    return o.line;
  };
  assert.deepEqual(lineOf('flow.clear'), { widthScale: 1, brightness: 0.6 });
  assert.deepEqual(lineOf('flow.slow'), { widthScale: 2, brightness: 0.8 });
  assert.deepEqual(lineOf('flow.congested'), { widthScale: 3, brightness: 1 });
  assert.equal(l0.overlays.length, 3, '非法 cellIndex 不产条目');
  assert.ok(l0.skipped >= 1, '非法 cellIndex 计入 skipped（如实计数）：' + l0.skipped);
  // 显式 line 覆盖派生值
  const explicit = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, 'L0', {
    overlays: [{ cellIndex: 0, layer: 'flow', token: tokens.flow['flow.clear'], line: { widthScale: 5, brightness: 0.4 } }],
  });
  assert.deepEqual(explicit.overlays[0].line, { widthScale: 5, brightness: 0.4 });
});
