/**
 * DP-02 · S-09 第二批 D 线 · 两级反馈分离可观测单测（验收 ②）
 *
 * 钉定：
 * - epic-breakdown §262 ②：通道 A（S-07 即时，TICK_FREE、与 tick 无关、<100ms 语义）
 *   与通道 B（tick 后 tick-delta / issue-change / flow-state）必须**可判定分离**。
 * - ux-spec §3.2 两级反馈契约（C4）：减动效下 A 保留静态描边/按压色（信息不丢失），
 *   B 改瞬时跳变（art-bible §8.3 / §9.2）。
 * - 诊断面板展开属通道 A（panel-open 即时）；诊断数据刷新属通道 B（tick 后）。
 * - 不得把 B 类数据塞进 A 通道；不得读 flowState / 归因做重算。
 *
 * 使用真实 createFeedbackBus + createMotionPolicy（渲染层语义令牌），
 * 不是替身；每条判据都配正向/反向对照，防止永真断言。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../src/core/config.ts';
import { buildSemanticTokenMap } from '../../src/render/semantic-tokens.ts';
import {
  CHANNEL_A_TYPES,
  CHANNEL_B_TYPES,
  DIAGNOSIS_OPEN_EVENT_TYPE,
  DIAGNOSIS_PANEL_TARGET,
  DIAGNOSIS_REFRESH_TYPES,
  FRAME_FREE,
  TICK_FREE,
  TWO_LEVEL_LATENCY_NOTE,
  createFeedbackBus,
  createMotionPolicy,
  projectTwoLevelFeedback,
  type FeedbackEvent,
  type TwoLevelFeedbackSource,
} from '../../src/ui/index.ts';

const TOKENS = buildSemanticTokenMap(createDefaultConfig().zoneTypes);

function motion(reducedMotion = false) {
  return createMotionPolicy({ tokens: TOKENS, reducedMotion });
}

/** 构造一份「A 有面板展开 / B 有诊断刷新」的真实事件流 */
function populatedBus() {
  const bus = createFeedbackBus();
  bus.beginFrame();
  bus.emitA('press', { action: 'press', target: 'end-day' });
  bus.emitA('panel-open', { action: 'V2', target: DIAGNOSIS_PANEL_TARGET });
  bus.emitA('select', { action: 'V5', target: '4,5' });
  bus.emitB('tick-delta', { tickId: 7, action: 'V7', target: 'hud', delta: { S: -2.4 } });
  bus.emitB('issue-change', { tickId: 7, action: 'V7', target: 'issues' });
  bus.emitB('flow-state', { tickId: 7, action: 'V7', target: 'flow' });
  return bus;
}

/** 只读假源：用于反向对照（注入违规事件），不触碰真实总线行为 */
function fakeSource(a: readonly FeedbackEvent[], b: readonly FeedbackEvent[]): TwoLevelFeedbackSource {
  return {
    historyA(): readonly FeedbackEvent[] {
      return a;
    },
    historyB(): readonly FeedbackEvent[] {
      return b;
    },
  };
}

function evt(over: Partial<FeedbackEvent> & Pick<FeedbackEvent, 'channel' | 'type'>): FeedbackEvent {
  return {
    seq: 1,
    tickId: TICK_FREE,
    frameId: 0,
    action: 'x',
    target: '',
    ...over,
  } as FeedbackEvent;
}

// ---------------------------------------------------------------------------
// ① 正常 / 减动效两种呈现下的完整分离判据
// ---------------------------------------------------------------------------

test('DF-1 常态：两级反馈 fullyObservable=true，A/B 结构性不变量全绿', () => {
  const bus = populatedBus();
  const view = projectTwoLevelFeedback(bus, motion(false));
  const v = view.verdict;
  assert.equal(v.channelACount, 3);
  assert.equal(v.channelBCount, 3);
  assert.equal(v.allChannelATickFree, true);
  assert.equal(v.allChannelAFrameBound, true);
  assert.equal(v.allChannelBTickBound, true);
  assert.equal(v.allChannelBFrameFree, true);
  assert.equal(v.noBTypeInA, true);
  assert.equal(v.noATypeInB, true);
  assert.equal(v.immediateCarriesNoTickDelta, true);
  assert.equal(v.diagnosisOpenOnlyInImmediate, true);
  assert.equal(v.diagnosisRefreshOnlyInPostTick, true);
  assert.equal(v.reducedMotionConsistent, true);
  assert.equal(v.separated, true);
  assert.equal(v.bothChannelsObserved, true);
  assert.equal(v.diagnosisOpenObserved, true);
  assert.equal(v.diagnosisRefreshObserved, true);
  assert.equal(v.fullyObservable, true);
});

test('DF-2 减动效：A 保留静态编码（不丢信息）、B 改瞬时跳变，分离仍成立', () => {
  const view = projectTwoLevelFeedback(populatedBus(), motion(true));
  assert.equal(view.motion.reducedMotion, true);
  assert.notEqual(view.motion.immediateMode, 'animated', 'A 降为静态');
  assert.equal(view.motion.immediateDurationMs, 0);
  assert.ok(view.motion.immediateChannels.length >= 2, '静态编码仍 ≥2 通道，信息不丢失');
  assert.equal(view.motion.tickMode, 'instant', 'B 改瞬时跳变');
  assert.equal(view.motion.tickDurationMs, 0);
  assert.equal(view.motion.informationLost, false);
  assert.equal(view.verdict.reducedMotionConsistent, true);
  assert.equal(view.verdict.separated, true);
  assert.equal(view.verdict.fullyObservable, true);
});

test('DF-3 常态：A 动画、B 动画，informationLost 恒 false', () => {
  const view = projectTwoLevelFeedback(populatedBus(), motion(false));
  assert.equal(view.motion.reducedMotion, false);
  assert.equal(view.motion.immediateMode, 'animated');
  assert.equal(view.motion.tickMode, 'animated');
  assert.equal(view.motion.informationLost, false);
  assert.equal(view.verdict.reducedMotionConsistent, true);
});

// ---------------------------------------------------------------------------
// ② 事件级可判定字段（TICK_FREE / FRAME_FREE / 时钟归属）
// ---------------------------------------------------------------------------

test('DF-4 通道 A 每条：tickFree=true、frameBound、clock=render-frame、classification=immediate', () => {
  const view = projectTwoLevelFeedback(populatedBus(), motion(false));
  assert.equal(view.channelA.length, 3);
  for (const r of view.channelA) {
    assert.equal(r.channel, 'A');
    assert.equal(r.tickId, TICK_FREE);
    assert.equal(r.tickFree, true);
    assert.equal(r.frameFree, false);
    assert.ok(r.frameId >= 0);
    assert.equal(r.clock, 'render-frame');
    assert.equal(r.classification, 'immediate');
    assert.equal(r.carriesTickDelta, false);
    assert.ok(CHANNEL_A_TYPES.indexOf(r.type as never) >= 0);
  }
  assert.equal(view.clockA, 'render-frame');
});

test('DF-5 通道 B 每条：tickBound、frameFree=true、clock=tick、classification=post-tick', () => {
  const view = projectTwoLevelFeedback(populatedBus(), motion(false));
  assert.equal(view.channelB.length, 3);
  for (const r of view.channelB) {
    assert.equal(r.channel, 'B');
    assert.equal(r.frameId, FRAME_FREE);
    assert.equal(r.frameFree, true);
    assert.ok(r.tickId >= 0);
    assert.equal(r.tickFree, false);
    assert.equal(r.clock, 'tick');
    assert.equal(r.classification, 'post-tick');
    assert.ok(CHANNEL_B_TYPES.indexOf(r.type as never) >= 0);
  }
  assert.equal(view.clockB, 'tick');
  assert.notEqual(view.clockA, view.clockB, '两通道不共享时钟（ADR-004 §2 子决策 1）');
});

test('DF-6 诊断面板展开只在 A（即时）；诊断数据刷新只在 B（tick 后）', () => {
  const view = projectTwoLevelFeedback(populatedBus(), motion(false));
  assert.equal(view.diagnosisOpenEvents.length, 1);
  const open = view.diagnosisOpenEvents[0];
  assert.equal(open.channel, 'A');
  assert.equal(open.type, DIAGNOSIS_OPEN_EVENT_TYPE);
  assert.equal(open.target, DIAGNOSIS_PANEL_TARGET);
  assert.equal(open.role, 'diagnosis-open');
  assert.equal(open.classification, 'immediate');
  assert.equal(open.tickFree, true);

  assert.equal(view.diagnosisRefreshEvents.length, 3);
  for (const r of view.diagnosisRefreshEvents) {
    assert.equal(r.channel, 'B');
    assert.equal(r.role, 'diagnosis-refresh');
    assert.equal(r.classification, 'post-tick');
    assert.ok(DIAGNOSIS_REFRESH_TYPES.indexOf(r.type) >= 0);
  }
  assert.ok(view.channelA.every((r) => r.role !== 'diagnosis-refresh'), 'A 通道不得承载诊断数据刷新');
  assert.ok(view.channelB.every((r) => r.role !== 'diagnosis-open'), 'B 通道不得承载面板展开');
});

// ---------------------------------------------------------------------------
// ③ 反向对照：违规注入必须被判据抓出（防永真断言）
// ---------------------------------------------------------------------------

test('DF-7 反向：把 B 类事件塞进 A 通道 → noBTypeInA=false、separated=false', () => {
  const bad = fakeSource(
    [evt({ channel: 'A', type: 'tick-delta', tickId: 7, frameId: 0 })],
    [evt({ channel: 'B', type: 'tick-delta', tickId: 7, frameId: FRAME_FREE })],
  );
  const view = projectTwoLevelFeedback(bad, motion(false));
  assert.equal(view.verdict.noBTypeInA, false);
  assert.equal(view.verdict.separated, false);
  assert.equal(view.verdict.fullyObservable, false);
});

test('DF-8 反向：A 通道夹带 tick 数值差 → immediateCarriesNoTickDelta=false', () => {
  const bad = fakeSource(
    [evt({ channel: 'A', type: 'panel-open', target: DIAGNOSIS_PANEL_TARGET, delta: { S: -1 } })],
    [evt({ channel: 'B', type: 'tick-delta', tickId: 1, frameId: FRAME_FREE })],
  );
  const view = projectTwoLevelFeedback(bad, motion(false));
  assert.equal(view.verdict.immediateCarriesNoTickDelta, false);
  assert.equal(view.verdict.separated, false);
});

test('DF-9 反向：A 事件绑定了真实 tickId → allChannelATickFree=false', () => {
  const bad = fakeSource(
    [evt({ channel: 'A', type: 'panel-open', target: DIAGNOSIS_PANEL_TARGET, tickId: 9 })],
    [evt({ channel: 'B', type: 'issue-change', tickId: 9, frameId: FRAME_FREE })],
  );
  const view = projectTwoLevelFeedback(bad, motion(false));
  assert.equal(view.verdict.allChannelATickFree, false);
  assert.equal(view.verdict.separated, false);
});

test('DF-10 反向：B 事件绑定渲染帧 → allChannelBFrameFree=false', () => {
  const bad = fakeSource(
    [evt({ channel: 'A', type: 'panel-open', target: DIAGNOSIS_PANEL_TARGET })],
    [evt({ channel: 'B', type: 'tick-delta', tickId: 3, frameId: 2 })],
  );
  const view = projectTwoLevelFeedback(bad, motion(false));
  assert.equal(view.verdict.allChannelBFrameFree, false);
  assert.equal(view.verdict.separated, false);
});

test('DF-11 反向：诊断数据刷新出现在 A → diagnosisRefreshOnlyInPostTick=false', () => {
  const bad = fakeSource(
    [
      evt({ channel: 'A', type: 'panel-open', target: DIAGNOSIS_PANEL_TARGET }),
      evt({ channel: 'A', type: 'issue-change' }),
    ],
    [evt({ channel: 'B', type: 'tick-delta', tickId: 1, frameId: FRAME_FREE })],
  );
  const view = projectTwoLevelFeedback(bad, motion(false));
  assert.equal(view.verdict.noBTypeInA, false);
  assert.equal(view.verdict.diagnosisRefreshOnlyInPostTick, false);
  assert.equal(view.verdict.separated, false);
});

// ---------------------------------------------------------------------------
// ④ 只读 / 空观测 / 延迟口径诚实
// ---------------------------------------------------------------------------

test('DF-12 投影只读：不 emit、不订阅、不改总线历史与派发计数', () => {
  const bus = populatedBus();
  const beforeA = JSON.stringify(bus.historyA());
  const beforeB = JSON.stringify(bus.historyB());
  const countA = bus.dispatchCountA;
  const countB = bus.dispatchCountB;
  const view = projectTwoLevelFeedback(bus, motion(false));
  assert.equal(bus.dispatchCountA, countA);
  assert.equal(bus.dispatchCountB, countB);
  assert.equal(JSON.stringify(bus.historyA()), beforeA);
  assert.equal(JSON.stringify(bus.historyB()), beforeB);
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.channelA), true);
  assert.equal(Object.isFrozen(view.verdict), true);
  assert.equal(bus.listenerErrors().length, 0);
});

test('DF-13 空观测：结构性 separated 可为 true，但 fullyObservable=false（不谎报可观测）', () => {
  const view = projectTwoLevelFeedback(createFeedbackBus(), motion(false));
  assert.equal(view.verdict.bothChannelsObserved, false);
  assert.equal(view.verdict.diagnosisOpenObserved, false);
  assert.equal(view.verdict.diagnosisRefreshObserved, false);
  assert.equal(view.verdict.fullyObservable, false, '无事件不得自称两级反馈已观测');
  assert.equal(view.channelA.length, 0);
  assert.equal(view.channelB.length, 0);
});

test('DF-14 部分观测：只有 A 或只有 B 时 fullyObservable=false', () => {
  const onlyA = createFeedbackBus();
  onlyA.emitA('panel-open', { action: 'V2', target: DIAGNOSIS_PANEL_TARGET });
  assert.equal(projectTwoLevelFeedback(onlyA, motion(false)).verdict.fullyObservable, false);

  const onlyB = createFeedbackBus();
  onlyB.emitB('tick-delta', { tickId: 1, action: 'V7' });
  assert.equal(projectTwoLevelFeedback(onlyB, motion(false)).verdict.fullyObservable, false);
});

test('DF-15 延迟口径诚实：<100ms 是语义契约，不是本层测得的达标率', () => {
  const view = projectTwoLevelFeedback(populatedBus(), motion(false));
  assert.equal(view.latencyNote, TWO_LEVEL_LATENCY_NOTE);
  assert.ok(view.latencyNote.includes('未测'), '明确标注真机未测');
  assert.ok(view.latencyNote.includes('不测量耗时'));
  assert.equal(view.latencyNote.includes('达标率 100%'), false);
  assert.equal(view.latencyNote.includes('已达标'), false);
});

test('DF-16 减动效下 A 具体为 static-outline（面板展开），B 具体为 instant', () => {
  const view = projectTwoLevelFeedback(populatedBus(), motion(true));
  assert.equal(view.motion.immediateMode, 'static-outline');
  assert.equal(view.motion.tickMode, 'instant');
  assert.equal(view.motion.informationLost, false);
  // outline 通道：shape==='none' 时以 outline 保住 ≥2 通道（D-13）
  assert.ok(view.motion.immediateChannels.indexOf('outline') >= 0);
  assert.equal(view.motion.immediateChannels.indexOf('shape'), -1);
});

test('DF-17 通道 A 不读 flowState / 归因：panel-open 载荷无任何 B 类字段', () => {
  const bus = populatedBus();
  const view = projectTwoLevelFeedback(bus, motion(false));
  const open = view.diagnosisOpenEvents[0];
  assert.equal(open.carriesTickDelta, false);
  assert.equal(open.type, 'panel-open');
  // 面板展开事件本身不带 flowState / 归因 / ΔS 数值
  const raw = bus.historyA().find((e) => e.type === 'panel-open')!;
  assert.equal(raw.delta, undefined);
  assert.equal(raw.data, undefined);
  assert.equal(raw.tickId, TICK_FREE);
});
