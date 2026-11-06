/**
 * HC-01 · S-07 · 双通道反馈总线单测
 *
 * 钉定 ADR-004 §2 子决策 1「双通道彻底分离」的可机器判读形式：
 * 通道 A 恒与 tick 无关（tickId = TICK_FREE、按渲染帧计数），通道 B 恒绑定一次真实
 * 结算（tickId >= 0、frameId = FRAME_FREE），两通道各自独立的序号 / 计数器 / 监听器。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHANNEL_A_TYPES,
  CHANNEL_B_TYPES,
  CHANNEL_CLOCK,
  FRAME_FREE,
  TICK_FREE,
  createFeedbackBus,
  eventsOfType,
  type FeedbackEvent,
} from '../../src/ui/index.ts';

test('BUS-1 通道 A 事件：tickId 恒为 TICK_FREE，frameId 随渲染帧推进（与 tick 无关）', () => {
  const bus = createFeedbackBus();
  const first = bus.emitA('press', { action: 'press', target: 'end-day' });
  assert.equal(first.channel, 'A');
  assert.equal(first.tickId, TICK_FREE);
  assert.equal(first.frameId, 0);

  bus.beginFrame();
  bus.beginFrame();
  const second = bus.emitA('select', { action: 'select', target: '4,5' });
  assert.equal(second.tickId, TICK_FREE, 'A 通道不携带任何 tick 信息');
  assert.equal(second.frameId, 2, 'A 通道按渲染帧计时');
  assert.equal(second.seq, first.seq + 1);
});

test('BUS-2 通道 B 事件：必须带真实 tickId，frameId 恒为 FRAME_FREE', () => {
  const bus = createFeedbackBus();
  bus.beginFrame();
  const ev = bus.emitB('tick-delta', { tickId: 7, action: 'V7', target: 'hud', delta: { S: -1.5 } });
  assert.equal(ev.channel, 'B');
  assert.equal(ev.tickId, 7);
  assert.equal(ev.frameId, FRAME_FREE, 'B 通道不携带渲染帧信息');
  assert.deepEqual(ev.delta, { S: -1.5 });
});

test('BUS-3 通道 B 拒绝虚构 tickId（负数 / 非整数即抛错）——B 只可能来自真实结算', () => {
  const bus = createFeedbackBus();
  assert.throws(() => bus.emitB('voice', { tickId: -1, action: 'V7' }), /requires a real tickId/);
  assert.throws(() => bus.emitB('voice', { tickId: 1.5, action: 'V7' }), /requires a real tickId/);
  assert.equal(bus.dispatchCountB, 0, '抛错的事件不进入通道 B 计数与历史');
});

test('BUS-4 两通道不共享时钟：A 派发不触碰 B 的计数 / 序号 / 历史，反之亦然', () => {
  const bus = createFeedbackBus();
  bus.emitA('press', { action: 'press' });
  bus.emitA('tab', { action: 'tab', target: 'ROAD' });
  assert.equal(bus.dispatchCountA, 2);
  assert.equal(bus.dispatchCountB, 0);
  assert.equal(bus.historyB().length, 0);

  bus.emitB('flow-state', { tickId: 1, action: 'V7' });
  assert.equal(bus.dispatchCountA, 2, 'B 派发不得改动 A 侧计数');
  assert.equal(bus.dispatchCountB, 1);
  assert.equal(bus.historyA().length, 2);

  // 两个通道的 seq 各自从 1 开始单调递增
  assert.deepEqual(
    bus.historyA().map((e) => e.seq),
    [1, 2],
  );
  assert.deepEqual(
    bus.historyB().map((e) => e.seq),
    [1],
  );
});

test('BUS-5 监听器按通道隔离：A 监听器抛错不影响 B 派发，也不吞异常（错误留痕）', () => {
  const bus = createFeedbackBus();
  const seenB: FeedbackEvent[] = [];
  const seenA: string[] = [];
  bus.onA(() => {
    throw new Error('boom');
  });
  bus.onA((e) => seenA.push(e.type));
  bus.onB((e) => seenB.push(e));

  bus.emitA('press', { action: 'press' });
  bus.emitB('tick-delta', { tickId: 1, action: 'V7' });

  assert.deepEqual(seenA, ['press'], '同一通道内后续监听器仍被调用');
  assert.equal(seenB.length, 1);
  assert.equal(seenB[0].channel, 'B');
  assert.equal(bus.listenerErrors().length, 1);
  assert.match(bus.listenerErrors()[0], /channel A listener threw: boom/);
});

test('BUS-6 取消订阅：退订后不再收到该通道事件，且不影响另一通道', () => {
  const bus = createFeedbackBus();
  let a = 0;
  let b = 0;
  const offA = bus.onA(() => {
    a++;
  });
  bus.onB(() => {
    b++;
  });
  bus.emitA('press', { action: 'p' });
  offA();
  bus.emitA('press', { action: 'p' });
  bus.emitB('voice', { tickId: 2, action: 'V7' });
  assert.equal(a, 1);
  assert.equal(b, 1);
});

test('BUS-7 历史容量受限（只影响可观测性，不影响派发计数）', () => {
  const bus = createFeedbackBus({ historyLimit: 3 });
  for (let i = 0; i < 5; i++) bus.emitA('press', { action: 'p' + i });
  assert.equal(bus.historyA().length, 3);
  assert.equal(bus.dispatchCountA, 5);
  assert.equal(bus.historyA()[2].action, 'p4');
});

test('BUS-8 通道自述表与实现一致：A 不绑 tick、B 不绑帧；事件类型集合与常量表逐项一致', () => {
  assert.equal(CHANNEL_CLOCK.A.tickBound, false);
  assert.equal(CHANNEL_CLOCK.A.frameBound, true);
  assert.equal(CHANNEL_CLOCK.B.tickBound, true);
  assert.equal(CHANNEL_CLOCK.B.frameBound, false);

  const bus = createFeedbackBus();
  for (const t of CHANNEL_A_TYPES) bus.emitA(t, { action: t });
  for (const t of CHANNEL_B_TYPES) bus.emitB(t, { tickId: 1, action: t });

  assert.deepEqual(
    bus.historyA().map((e) => e.type),
    [...CHANNEL_A_TYPES],
  );
  assert.equal(eventsOfType(bus.historyB(), 'tick-delta').length, 1);
  for (const e of bus.historyA()) assert.equal(e.channel, 'A');
  for (const e of bus.historyB()) assert.equal(e.channel, 'B');
});

test('BUS-9 事件对象不可变（防止下游改写反馈内容造成跨通道污染）', () => {
  const bus = createFeedbackBus();
  const ev = bus.emitA('placement', { action: 'ZONE', target: '2,2' });
  assert.equal(Object.isFrozen(ev), true);
  assert.throws(() => {
    (ev as unknown as { type: string }).type = 'press';
  });
  assert.equal(bus.historyA()[0].type, 'placement');
});
