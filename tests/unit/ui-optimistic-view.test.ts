/**
 * HC-01 · S-07 · 乐观视图叠加层单测
 *
 * 钉定 ADR-004 §2 子决策 2 / 3：UI 只持「VM + 本地乐观叠加」，命令被判非法后
 * 撤下叠加项并给负向形状编码，**不残留**；`compose()` 只读且不改写 baseVM。
 *
 * 令牌隔离纪律：本文件**不断言任何形状字面值**（如 ✕ / ↑ / !），只断言
 * 「形状非空」「两两不同」「与 `tokenById` 查到的令牌形状一致」——这样渲染层做
 * 形状唯一化改造时本用例不会误报。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../src/core/config.ts';
import { buildSemanticTokenMap, tokenById } from '../../src/render/semantic-tokens.ts';
import { makeCommand } from '../../src/simulation/commands.ts';
import {
  compose,
  createFeedbackBus,
  createOptimisticLayer,
  encodingOf,
  type ComposedView,
  type OptimisticLayer,
} from '../../src/ui/index.ts';

const config = createDefaultConfig();
const tokens = buildSemanticTokenMap(config.zoneTypes);

function fixture(): { bus: ReturnType<typeof createFeedbackBus>; layer: OptimisticLayer } {
  const bus = createFeedbackBus();
  const layer = createOptimisticLayer({ tokens, bus });
  return { bus, layer };
}

test('OV-1 V3 落位：apply(ZONE) 生成浅色分区 + 正向预览编码，并派发通道 A placement 事件', () => {
  const { bus, layer } = fixture();
  const item = layer.apply(makeCommand.zone('z1', 1, 4, 5, 'R', 2));
  assert.equal(item.kind, 'placement');
  assert.equal(item.scope, 'cell');
  assert.equal(item.commandKind, 'ZONE');
  assert.equal(item.zoneTokenId, 'zone.R');
  assert.equal(item.legality, 'legal');
  assert.equal(item.mutatesAuthority, true);
  assert.equal(item.encoding.tokenId, tokenById(tokens, 'status.positive').id);
  assert.equal(item.encoding.color, tokenById(tokens, 'status.positive').color, '色值必须来自语义令牌');
  assert.ok(item.encoding.label.length > 0, '文字标签非空（多通道反馈）');

  const events = bus.historyA();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'placement');
  assert.equal(events[0].target, '4,5');
  assert.equal(layer.size, 1);
});

test('OV-2 拆除预览 / 扣减预览各自成类：EMPTY → demolition，FUND → fund-preview + highlight 事件', () => {
  const { bus, layer } = fixture();
  const demolish = layer.apply(makeCommand.zone('d1', 1, 6, 6, 'EMPTY', 0));
  assert.equal(demolish.kind, 'demolition');
  assert.equal(demolish.zoneTokenId, 'base.tile', '拆除不借用分区色');

  const fund = layer.apply(makeCommand.fund('f1', 2, 120));
  assert.equal(fund.kind, 'fund-preview');
  assert.equal(fund.amountCU, 120);
  assert.equal(fund.scope, 'cell');

  const types = bus.historyA().map((e) => e.type);
  assert.deepEqual(types, ['highlight', 'highlight'], '拆除 / 扣减预览以 highlight 即时事件通知');
  assert.equal(bus.historyB().length, 0, '乐观叠加不得产生任何 B 通道事件');
});

test('OV-3 同 key 连点幂等：叠加项不叠两层，返回同一引用', () => {
  const { bus, layer } = fixture();
  const cmd = makeCommand.zone('same', 1, 2, 2, 'R', 1);
  const a = layer.apply(cmd);
  const b = layer.apply(cmd);
  assert.equal(a, b);
  assert.equal(layer.size, 1);
  assert.equal(bus.historyA().length, 1, '重复点击不重复派发落位事件');
  assert.equal(layer.appliedCount, 2, '应用次数如实累计（含幂等命中）');
});

test('OV-4 回滚：撤下叠加项 + 派发 rollback 事件 + 负向形状编码（active 中不残留）', () => {
  const { bus, layer } = fixture();
  layer.apply(makeCommand.zone('bad', 1, 20, 20, 'R', 1));
  assert.equal(layer.size, 1);

  const marker = layer.rollback('bad', 'LOCKED_REGION');
  assert.equal(marker.removed, true);
  assert.equal(marker.reason, 'LOCKED_REGION');
  assert.equal(marker.tickId, -1, '回滚属通道 A：不携带 tick');
  assert.equal(layer.size, 0, '叠加项必须撤下，不得残留');
  assert.equal(layer.active().length, 0);
  assert.equal(layer.itemFor('bad'), undefined);

  const negative = tokenById(tokens, 'status.negative');
  assert.equal(marker.encoding.shape, negative.shape, '负向形状编码取自 status.negative 令牌');
  assert.ok(marker.encoding.shape.length > 0, '形状编码非空（不得返回空字符串）');
  assert.equal(marker.encoding.color, negative.color);

  const rollbackEvents = bus.historyA().filter((e) => e.type === 'rollback');
  assert.equal(rollbackEvents.length, 1);
  assert.equal(rollbackEvents[0].target, 'bad');
  assert.deepEqual(rollbackEvents[0].encoding, marker.encoding);
});

test('OV-5 三种预览形状两两不同（正向 / 提示 / 负向），且全部非空——只查令牌、不查字面值', () => {
  const { layer } = fixture();
  const legal = layer.apply(makeCommand.zone('ok', 1, 2, 2, 'R', 1), { legality: 'legal' });
  const unknown = layer.apply(makeCommand.zone('unk', 2, 3, 3, 'R', 1), { legality: 'unknown' });
  const illegal = layer.apply(makeCommand.zone('no', 3, 4, 4, 'R', 1), { legality: 'illegal' });
  const shapes = [legal.encoding.shape, unknown.encoding.shape, illegal.encoding.shape];

  for (const s of shapes) assert.ok(typeof s === 'string' && s.length > 0, '形状编码非空');
  assert.equal(new Set(shapes).size, 3, '合法 / 未知 / 非法预览必须形状两两不同（色盲友好）');

  // 非法预览同时不得借用分区图案（art-bible §3.4 隔离）
  assert.equal(illegal.encoding.color, tokenById(tokens, 'status.negative').color);
  assert.notEqual(illegal.encoding.color, tokenById(tokens, 'zone.R').color);
});

test('OV-6 可用性预检只改预览编码、不改裁决路径（P1 仍是唯一裁决方）', () => {
  const { layer } = fixture();
  const item = layer.apply(makeCommand.zone('pre', 1, 20, 20, 'R', 1), { legality: 'illegal' });
  assert.equal(item.legality, 'illegal');
  assert.equal(item.mutatesAuthority, true, '预检不改变「该命令会改权威状态」的事实');
  assert.equal(layer.size, 1, '预检不阻止乐观叠加（<100ms 优先），裁决留给结算');
});

test('OV-7 纯视觉动作（选中 / Tab / 面板）不改权威状态，且不产生 Command 类别', () => {
  const { bus, layer } = fixture();
  const sel = layer.applyUi({ kind: 'select', target: '3,4', x: 3, y: 4 });
  assert.equal(sel.kind, 'selection');
  assert.equal(sel.scope, 'cell');
  assert.equal(sel.commandKind, 'UI');
  assert.equal(sel.mutatesAuthority, false);
  assert.equal(layer.overlayAt(3, 4)?.commandId, sel.commandId);

  const tab = layer.applyUi({ kind: 'tab', target: 'ROAD' });
  assert.equal(tab.scope, 'hud');
  const panelItem = layer.applyUi({ kind: 'panel', target: 'L2' });
  assert.equal(panelItem.kind, 'panel');

  assert.deepEqual(
    bus.historyA().map((e) => e.type),
    ['select', 'tab', 'panel-open'],
  );
  assert.equal(bus.historyB().length, 0);
});

test('OV-8 discard 为静默替换（不派发 rollback）——用于选中切换 / L1-L2 互斥', () => {
  const { bus, layer } = fixture();
  const sel = layer.applyUi({ kind: 'select', target: '1,1', x: 1, y: 1 });
  const before = bus.historyA().length;
  assert.equal(layer.discard(sel.commandId), true);
  assert.equal(layer.size, 0);
  assert.equal(bus.historyA().length, before, 'discard 不是回滚，不产生负向反馈事件');
  assert.equal(bus.historyA().filter((e) => e.type === 'rollback').length, 0);
  assert.equal(layer.discard(sel.commandId), false, '重复 discard 幂等');
});

test('OV-9 compose 只读合成：不改写 baseVM、结构冻结、格叠加查询可用', () => {
  const { layer } = fixture();
  layer.apply(makeCommand.zone('z1', 1, 2, 3, 'C', 1));
  const baseVM = Object.freeze({
    tickId: 5,
    S: 68.5,
    cells: Object.freeze({ zone: new Uint8Array(4), density: new Uint8Array(4) }),
  });
  const snapshotBefore = JSON.stringify({ tickId: baseVM.tickId, S: baseVM.S, side: baseVM.cells.zone.length });

  const view: ComposedView<typeof baseVM> = compose(baseVM, layer);
  assert.equal(view.readOnly, true);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(view.base, baseVM, 'baseVM 原样引用，不复制不改写');
  assert.equal(view.overlays.length, 1);
  assert.equal(view.overlayAt(2, 3)?.zoneTokenId, 'zone.C');
  assert.equal(view.overlayAt(9, 9), undefined);
  assert.equal(
    JSON.stringify({ tickId: baseVM.tickId, S: baseVM.S, side: baseVM.cells.zone.length }),
    snapshotBefore,
    'compose 不得改动权威只读投影',
  );

  // 合成视图是快照：叠加项变化不回溯改写已生成的视图对象
  layer.apply(makeCommand.zone('z2', 2, 4, 4, 'R', 1));
  assert.equal(view.overlays.length, 1);
  assert.equal(layer.size, 2);
});

test('OV-10 encodingOf 未知令牌回退中性编码（不静默借用分区色 / 状态色）', () => {
  const enc = encodingOf(tokens, 'status.not_a_status');
  assert.equal(enc.tokenId, 'base.tile');
  assert.equal(enc.color, tokenById(tokens, 'base.tile').color);
  assert.ok(enc.shape.length > 0);
});
