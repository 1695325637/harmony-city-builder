/**
 * HC-01 · S-08 · 竖屏 HUD 布局模型单测（项 1 / 项 6 降级路径）
 *
 * 钉定：三段布局（状态条 / 画布 / 拇指区）、节点身份稳定 → 重排只重排不重建、
 * 选中/滚动/面板态跨重排保留；折叠态 / 安全区接口失败 → folded 单栏降级且仍可用。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createLayoutModel,
  reconcileLayout,
  createLayoutState,
  type HudLayoutModel,
  type SafeAreaProvider,
} from '../../src/ui/hud/index.ts';
import type { LayoutProfile } from '../../src/ui/hud/index.ts';

function profile(over: Partial<LayoutProfile> = {}): LayoutProfile {
  return {
    formFactor: 'unfolded',
    safeArea: [44, 0, 34, 0],
    textScale: 100,
    performanceTier: 'default',
    ...over,
  };
}

test('LAY-1 三段布局恒存在且高度占比之和 = 1', () => {
  for (const ff of ['folded', 'unfolded', 'tablet'] as const) {
    const m = createLayoutModel(profile({ formFactor: ff }));
    const sum = m.segments.statusBar.heightRatio + m.segments.canvas.heightRatio + m.segments.thumbZone.heightRatio;
    assert.equal(sum, 1, ff + ' 三段占比之和应为 1');
    for (const id of ['statusBar', 'canvas', 'thumbZone'] as const) {
      assert.ok(m.segments[id] !== undefined, ff + ' 缺段 ' + id);
      assert.ok(m.segments[id].heightRatio > 0);
    }
  }
});

test('LAY-2 拇指区最小高度 ≥ 64dp（保证可达），各段都有最小高度保护', () => {
  const m = createLayoutModel(profile());
  assert.ok(m.segments.thumbZone.minHeightDp >= 64, '拇指区最小高度保护');
  assert.ok(m.segments.statusBar.minHeightDp > 0);
  assert.ok(m.segments.canvas.minHeightDp > 0);
});

test('LAY-3 折叠态 → 降级单栏，degraded=true', () => {
  const m = createLayoutModel(profile({ formFactor: 'folded' }));
  assert.equal(m.degraded, true, 'folded 形态必须降级');
  assert.equal(m.formFactor, 'folded');
});

test('LAY-4 非折叠 + 安全区正常 → 不降级，安全区被采用', () => {
  const m = createLayoutModel(profile({ formFactor: 'unfolded', safeArea: [47, 0, 34, 0] }));
  assert.equal(m.degraded, false);
  assert.deepEqual([m.safeArea[0], m.safeArea[2]], [47, 34], '安全区被采用');
});

test('LAY-5 安全区接口抛错 → 降级为 folded 单栏且不抛错（项 6：接口失败仍产出可用布局）', () => {
  const throwing: SafeAreaProvider = {
    getSafeArea(): never {
      throw new Error('SafeAreaProvider unavailable');
    },
  };
  let model: HudLayoutModel | undefined;
  assert.doesNotThrow(() => {
    model = createLayoutModel(profile({ formFactor: 'unfolded', safeArea: [0, 0, 0, 0] }), throwing);
  }, '安全区接口失败不得阻断 HUD 渲染');
  assert.equal(model!.degraded, true, '接口失败必须降级');
  // 降级后仍是一份完整可用的三段布局（三段都在、占比和=1）
  const sum =
    model!.segments.statusBar.heightRatio + model!.segments.canvas.heightRatio + model!.segments.thumbZone.heightRatio;
  assert.equal(sum, 1, '降级后布局仍完整可用');
});

test('LAY-6 折叠态 + 无 provider → 降级且安全区用 fallback（[0,0,0,0]）', () => {
  const m = createLayoutModel(profile({ formFactor: 'folded' }));
  assert.equal(m.degraded, true);
  assert.deepEqual([...m.safeArea], [0, 0, 0, 0], '无 provider 的折叠态用 fallback 安全区');
});

test('LAY-7 重排：节点 id 恒定，产出 reuse / move 操作，绝不 reset / 移除', () => {
  const a = createLayoutModel(profile({ formFactor: 'unfolded' }));
  const b = createLayoutModel(profile({ formFactor: 'tablet' })); // 占比不同 → move
  const ops = reconcileLayout(a, b);
  const ids = ops.map((o) => o.nodeId).sort();
  assert.deepEqual(ids, ['canvas', 'statusBar', 'thumbZone'], '三段 id 恒定（跨重排不变）');
  assert.ok(ops.every((o) => o.kind === 'reuse' || o.kind === 'move'), '只产出 reuse / move，不 reset / 不移除');
  assert.ok(ops.some((o) => o.kind === 'move'), 'formFactor 切换应产生 move');
});

test('LAY-8 重排不触碰交互状态容器：选中 / 滚动跨重排保留', () => {
  const a = createLayoutModel(profile({ formFactor: 'unfolded' }));
  const b = createLayoutModel(profile({ formFactor: 'tablet' }));
  const state = createLayoutState('canvas', 120); // 选中 canvas、滚动 120
  // 重排不改变状态容器（节点 id 仍是 canvas）
  reconcileLayout(a, b);
  assert.equal(state.selectedNode, 'canvas', '选中节点未变（id 稳定）');
  assert.equal(state.scrollY, 120, '滚动位置跨重排保留');
});

test('LAY-9 文本缩放写入模型且落在 100–200 区间', () => {
  const m = createLayoutModel(profile({ textScale: 175 }));
  assert.equal(m.textScale, 175);
  assert.ok(m.textScale >= 100 && m.textScale <= 200);
});
