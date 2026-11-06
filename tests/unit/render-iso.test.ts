/**
 * HC-01 · S-06 渲染内核 · 等距投影 / 深度 / 缩放单测
 *
 * 覆盖：gridToScreen ↔ screenToGrid 往返精度、2:1 斜率、深度排序确定性与平局规则、
 * 三档缩放锚点、点击拾取。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_W,
  CELL_H,
  HALF_W,
  HALF_H,
  LOD_LEVELS,
  ZOOM,
  cellWorldBounds,
  compareDepth,
  depthKey,
  fitTransform,
  fitsInViewport,
  gridToScreen,
  pickCell,
  screenToGrid,
  screenToWorldPoint,
  worldToScreen,
  zoomAround,
  zoomScale,
} from '../../src/index.ts';

test('ISO-1 单格常量为 128×64（2:1 dimetric）', () => {
  assert.equal(CELL_W, 128);
  assert.equal(CELL_H, 64);
  assert.equal(HALF_W, 64);
  assert.equal(HALF_H, 32);
  assert.equal(CELL_W / CELL_H, 2);
});

test('ISO-2 gridToScreen 斜率恒为 dx:dy = 2:1', () => {
  const base = gridToScreen(5, 7);
  const right = gridToScreen(6, 7); // gx+1
  assert.equal(right.x - base.x, 64);
  assert.equal(right.y - base.y, 32);
  const down = gridToScreen(5, 8); // gy+1
  assert.equal(down.x - base.x, -64);
  assert.equal(down.y - base.y, 32);
  // 沿 gx−gy 对角线变化：水平 128 / 垂直 0；沿 gx+gy 对角线：垂直 64
  const b0 = gridToScreen(5, 5);
  const diag = gridToScreen(6, 6);
  assert.equal(diag.x - b0.x, 0);
  assert.equal(diag.y - b0.y, 64);
  // 沿两条主轴（gx+1 / gy+1）移动，|dx| / |dy| 恒为 2:1
  for (let gx = 0; gx < 8; gx++) {
    for (let gy = 0; gy < 8; gy++) {
      const a = gridToScreen(gx, gy);
      const right = gridToScreen(gx + 1, gy);
      const down = gridToScreen(gx, gy + 1);
      assert.equal(Math.abs(right.x - a.x) / Math.abs(right.y - a.y), 2, `点 (${gx},${gy}) 沿 gx 的 2:1 斜率`);
      assert.equal(Math.abs(down.x - a.x) / Math.abs(down.y - a.y), 2, `点 (${gx},${gy}) 沿 gy 的 2:1 斜率`);
    }
  }
});

test('ISO-3 gridToScreen ↔ screenToGrid 往返误差 < 1e-9', () => {
  for (let gx = -4; gx <= 36; gx++) {
    for (let gy = -4; gy <= 36; gy++) {
      const s = gridToScreen(gx, gy);
      const g = screenToGrid(s.x, s.y);
      assert.ok(Math.abs(g.x - gx) < 1e-9, `x 往返 (${gx},${gy})`);
      assert.ok(Math.abs(g.y - gy) < 1e-9, `y 往返 (${gx},${gy})`);
    }
  }
});

test('ISO-4 点击拾取：菱形中心与顶角都命中原格', () => {
  for (let gx = 0; gx < 6; gx++) {
    for (let gy = 0; gy < 6; gy++) {
      const s = gridToScreen(gx, gy);
      const center = pickCell(s.x, s.y + HALF_H); // 菱形几何中心
      assert.deepEqual(center, { gx, gy }, `中心拾取 (${gx},${gy})`);
      const top = pickCell(s.x + 1, s.y + 1); // 顶角内侧
      assert.deepEqual(top, { gx, gy }, `顶角拾取 (${gx},${gy})`);
    }
  }
});

test('ISO-5 深度规则唯一：gx+gy 升序、平局 gx 升序（无 zIndex 例外）', () => {
  assert.ok(compareDepth({ gx: 0, gy: 1 }, { gx: 1, gy: 1 }) < 0, '和小的先画');
  assert.ok(compareDepth({ gx: 2, gy: 2 }, { gx: 1, gy: 1 }) > 0, '和大的后画');
  assert.ok(compareDepth({ gx: 0, gy: 2 }, { gx: 2, gy: 0 }) < 0, '同和对角线按 gx 升序');
  assert.equal(compareDepth({ gx: 3, gy: 3 }, { gx: 3, gy: 3 }), 0);
  // depthKey 与 compareDepth 严格同序（引擎侧只能收 number）
  for (let gx = 0; gx < 10; gx++) {
    for (let gy = 0; gy < 10; gy++) {
      const a = { gx, gy };
      const b = { gx: 9 - gx, gy };
      const byCompare = compareDepth(a, b);
      const ka = depthKey(a.gx, a.gy);
      const kb = depthKey(b.gx, b.gy);
      const byKey = ka < kb ? -1 : ka > kb ? 1 : 0;
      assert.equal(byKey, byCompare, `depthKey 与 compareDepth 同序 (${gx},${gy})`);
    }
  }
});

test('ISO-6 深度排序确定性：乱序输入两次排序结果逐项相同', () => {
  const cells: { gx: number; gy: number }[] = [];
  for (let gx = 0; gx < 8; gx++) for (let gy = 0; gy < 8; gy++) cells.push({ gx, gy });
  const shuffled = cells.slice().reverse();
  const a = cells.slice().sort(compareDepth);
  const b = shuffled.slice().sort(compareDepth);
  assert.deepEqual(a, b, '同输入集合乱序后排序结果一致（比较器全序、无随机）');
  // 排序后 (gx+gy) 单调不减
  for (let i = 1; i < a.length; i++) {
    assert.ok(a[i - 1].gx + a[i - 1].gy <= a[i].gx + a[i].gy, '和单调不减');
  }
});

test('ISO-7 缩放只允许三个固定档位（0.5 / 1.0 / 2.0）', () => {
  assert.deepEqual(LOD_LEVELS, ['L0', 'L1', 'L2']);
  assert.equal(ZOOM.L0, 0.5);
  assert.equal(ZOOM.L1, 1.0);
  assert.equal(ZOOM.L2, 2.0);
  assert.equal(zoomScale('L0'), 0.5);
  assert.equal(zoomScale('L1'), 1.0);
  assert.equal(zoomScale('L2'), 2.0);
  assert.equal(LOD_LEVELS.length, 3, '档位数量固定为 3，无连续缩放');
});

test('ISO-8 缩放锚点：档位切换保持锚点不动，距离按倍率缩放', () => {
  const anchor = { x: 320, y: 240 };
  // 锚点自身在任意档位切换后不动
  for (const from of LOD_LEVELS) {
    for (const to of LOD_LEVELS) {
      const p = zoomAround(anchor, anchor, from, to);
      assert.equal(p.x, anchor.x);
      assert.equal(p.y, anchor.y);
    }
  }
  // 相对锚点偏移 10,4：L0→L1 乘 2、L1→L2 乘 2、L0→L2 乘 4
  const p = { x: anchor.x + 10, y: anchor.y + 4 };
  assert.deepEqual(zoomAround(p, anchor, 'L0', 'L1'), { x: anchor.x + 20, y: anchor.y + 8 });
  assert.deepEqual(zoomAround(p, anchor, 'L1', 'L2'), { x: anchor.x + 20, y: anchor.y + 8 });
  assert.deepEqual(zoomAround(p, anchor, 'L0', 'L2'), { x: anchor.x + 40, y: anchor.y + 16 });
  assert.deepEqual(zoomAround(p, anchor, 'L2', 'L0'), { x: anchor.x + 2.5, y: anchor.y + 1 });
});

test('ISO-9（P-01）世界包围盒：16×16 = 2048×1024，菱形四角参与计算', () => {
  const b = cellWorldBounds(16);
  assert.equal(b.maxX - b.minX, 2048, '宽 = 32 个半格 = 2048（T-118 预览页裁切的根因量级）');
  assert.equal(b.maxY - b.minY, 1024, '高 = 2 × 16 × 32 + 64 = 1024');
  assert.equal(b.minX, -1024);
  assert.equal(b.maxX, 1024);
  assert.equal(b.minY, 0);
  assert.equal(b.maxY, 1024);
  // 只统计解锁格：子集包围盒必然更小
  const sub = cellWorldBounds(16, (gx, gy) => gx < 8 && gy < 8);
  assert.ok(sub.maxX - sub.minX < 2048);
  // 空集兜底为 0 尺寸（不产生 NaN / Infinity）
  const empty = cellWorldBounds(16, () => false);
  assert.deepEqual(empty, { minX: 0, maxX: 0, minY: 0, maxY: 0 });
});

test('ISO-10（P-01）视口居中：L0 全图完整可见且居中，切档保持视口中心不动（与 zoomAround 等价）', () => {
  // 与 preview/index.html 的画布一致：1060×740
  const VW = 1060;
  const VH = 740;
  const b = cellWorldBounds(16);
  const t0 = fitTransform(b, VW, VH, 'L0');
  assert.equal(t0.zoom, 0.5);
  assert.equal(fitsInViewport(b, t0, VW, VH, 8), true, 'L0 全图须完整可见（含 8px 留白），修复 T-118 的下缘裁切');

  // 包围盒中心映射到视口中心（水平 + 垂直都居中）
  const center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  const c = worldToScreen(center, t0);
  assert.ok(Math.abs(c.x - VW / 2) < 1e-9, '水平居中');
  assert.ok(Math.abs(c.y - VH / 2) < 1e-9, '垂直居中');

  // 切档：视口中心对应的世界点不变（等价于以视口中心为锚点 zoomAround）
  const viewportCenter = { x: VW / 2, y: VH / 2 };
  const worldAtCenter0 = screenToWorldPoint(viewportCenter, t0);
  for (const lod of ['L1', 'L2'] as const) {
    const t = fitTransform(b, VW, VH, lod);
    const worldAtCenter = screenToWorldPoint(viewportCenter, t);
    assert.ok(Math.abs(worldAtCenter.x - worldAtCenter0.x) < 1e-9, lod + ' 中心世界点 X 不变');
    assert.ok(Math.abs(worldAtCenter.y - worldAtCenter0.y) < 1e-9, lod + ' 中心世界点 Y 不变');
    // 任意世界点在两档变换之间满足 zoomAround 关系（同一 anchor = 视口中心）
    const w = { x: b.minX, y: b.maxY };
    assert.deepEqual(zoomAround(worldToScreen(w, t0), viewportCenter, 'L0', lod), worldToScreen(w, t));
  }

  // L1 / L2 局部放大属预期裁切（不要求全图可见，但必须仍居中）
  const t2 = fitTransform(b, VW, VH, 'L2');
  assert.equal(fitsInViewport(b, t2, VW, VH), false, 'L2 局部放大：全图超出视口属预期');
  const c2 = worldToScreen(center, t2);
  assert.ok(Math.abs(c2.x - VW / 2) < 1e-9 && Math.abs(c2.y - VH / 2) < 1e-9, 'L2 仍居中');
});
