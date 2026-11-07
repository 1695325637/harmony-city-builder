/**
 * HC-01 · UI 层 · S-09 第二批 D 线 · L2 诊断面板视图 + 两级反馈可观测
 *
 * 权威口径（只读引用）：
 * - epic-breakdown §262 验收 ②：两级反馈分离可观测（通道 A 即时 vs 通道 B tick 后）。
 * - epic-breakdown §262 验收 ④ / ux-spec §2.2 §4.3：任一屏 ≤1 个数据面板、分层披露、
 *   L1 与 L2 互斥、不以密集数值表格作主交互面（P4）。
 * - ux-spec §3.2 两级反馈契约（C4）：即时反馈 <100ms、与 tick 无关；tick 后反馈
 *   表现 S / B / 周期变化、议题增删、流线三态、市民之声。减动效下 A 保留静态编码、
 *   B 改瞬时跳变（art-bible §8.3 / §9.2）。
 * - ux-spec §8.1 UX-AC6 / GDD 05 §7 AC-I3：建议动词一次点按可达（V3/V4/V5）。
 * - ADR-004 §2 子决策 1/2、ADR-003 A4 / GDD 05 §7 AC-I7：UI 零写权威状态、只读汇聚。
 *
 * 本文件是**纯只读投影 + 单槽位适配器**，不是第二套面板状态：
 * - `DiagnosisPanelSlot` 是对既有 `HudViewModel.activePanel` / `setPanel` 的结构化端口；
 *   `open()` 只调用 `setPanel('L2')`，`close()` 只调用 `setPanel('none')`，
 *   `isOpen` 恒由 `slot.activePanel === 'L2'` **派生**（不持有本地 isOpen 状态）。
 *   HudViewModel.setPanel 的单值实现（展开新的即收起旧的）保证 L1/L2 互斥、同屏 ≤1。
 * - 诊断数据来自第一批 `queryDiagnosis` 产出的冻结 `DiagnosisViewModel`；
 *   本文件不查 store、不重算、不触发结算、不写回任何模拟状态。
 * - 两级反馈证据来自 `FeedbackBus.historyA()` / `historyB()` 的**只读历史**；
 *   本文件不 emit、不订阅、不读时钟、不测延迟。
 *
 * ⚠️ 延迟口径诚实声明：`<100ms` 是 ux-spec §3.2 / ADR-004 的**语义契约**，
 * 本投影只验证「通道 A 无 tick 绑定」这一结构性事实，不测量耗时；
 * 真机「点按 → 首帧可见」达标率未测（见 feedback-timing.ts 的口径声明）。
 */

import {
  CHANNEL_A_TYPES,
  CHANNEL_B_TYPES,
  CHANNEL_CLOCK,
  FRAME_FREE,
  TICK_FREE,
} from '../feedback-bus.ts';
import type { FeedbackEvent } from '../feedback-bus.ts';
import type { HudPanelState } from '../hud/hud-view-model.ts';
import { MAX_DETAIL_CARDS, MAX_FACTOR_ROWS } from './types.ts';
import type {
  ActionVerb,
  CouplingDisclosure,
  DiagnosisEmptyReason,
  DiagnosisLayer,
  DiagnosisSummary,
  DiagnosisViewModel,
  FourSegmentCard,
  TutorialCard,
} from './types.ts';

// ---------------------------------------------------------------------------
// 常量 / 口径声明
// ---------------------------------------------------------------------------

/** L2 诊断面板占用的共享数据面板槽位 id（与 HudPanelId 的 'L2' 同源） */
export const DIAGNOSIS_PANEL_TARGET = 'L2';

/** 触发诊断数据刷新的通道 B 事件类型（tick 后，来自 feedback-bus 协议名） */
export const DIAGNOSIS_REFRESH_TYPES: readonly string[] = Object.freeze([
  'tick-delta',
  'issue-change',
  'flow-state',
]);

/** 面板展开的通道 A 事件类型（即时，与 tick 无关） */
export const DIAGNOSIS_OPEN_EVENT_TYPE = 'panel-open';

/** 延迟口径断言（逐字引用，不得改写成达标结论） */
export const TWO_LEVEL_LATENCY_NOTE =
  '通道 A 即时反馈为帧内 <100ms 语义契约（ADR-004 §2 / ux-spec §3.2）；' +
  '本投影只读事件结构、不测量耗时，真机「点按→首帧可见」达标率未测。';

/** 硬上限沿用第一批（P4：不以密集数值表格作主交互面） */
export const PANEL_CARD_LIMIT = MAX_DETAIL_CARDS;
export const PANEL_FACTOR_ROW_LIMIT = MAX_FACTOR_ROWS;

// ---------------------------------------------------------------------------
// ① L2 面板视图（四段卡片 + 耦合披露 + 教学卡 + 建议动词）
// ---------------------------------------------------------------------------

/**
 * 一张四段卡的可排布投影：四个**具名字段**，不是二维数值矩阵。
 * 段 1 主因因子 → 段 2 贡献量 → 段 3 明细 → 段 4 建议动词（ux-spec §4.3）。
 */
export interface DiagnosisPanelCard {
  readonly ordinal: number;
  readonly factor: string;
  readonly factorLabel: string;
  readonly contribution: number;
  readonly contributionUnit: '分/tick';
  /** 段 2 的可读文本（数值 + 单位），供 UI 直接排版，不铺裸数字表 */
  readonly contributionText: string;
  readonly causeType: string;
  readonly refId: string;
  readonly detailText: string;
  readonly verbText: string;
  readonly suggestedVerb: string;
  readonly actionVerb: ActionVerb | null;
  readonly verbReachable: boolean;
}

/** 一次点按直达目标（AC-I3 / UX-AC6）；本层只返回动作描述，不执行命令 */
export interface DiagnosisPanelAction {
  readonly cardOrdinal: number;
  readonly verb: ActionVerb;
  readonly label: string;
  readonly refId: string;
  /** 恒 true：单点按即可到达，不需二次确认 */
  readonly reachableInOneTap: true;
  /** 该点按属通道 A 即时反馈（不等待 tick） */
  readonly channel: 'A';
}

export interface DiagnosisPanelView {
  readonly panelId: 'L2';
  readonly slotId: 'L2';
  readonly title: string;
  readonly headline: string;
  readonly emptyReason: DiagnosisEmptyReason | null;
  readonly summary: DiagnosisSummary;
  readonly cards: readonly DiagnosisPanelCard[];
  readonly cardCount: number;
  readonly overflowCount: number;
  readonly l1RowCount: number;
  readonly coupling: CouplingDisclosure;
  readonly tutorial: TutorialCard | null;
  readonly actions: readonly DiagnosisPanelAction[];
  readonly traceable: boolean;
  readonly unsourcedSuppressed: number;
  readonly tickId: number;
  readonly cycleId: number;
  readonly cycleTickIndex: number;
}

function contributionText(v: number): string {
  return String(Math.round(v * 100) / 100) + ' 分/tick';
}

function projectCard(c: FourSegmentCard, ordinal: number): DiagnosisPanelCard {
  return Object.freeze({
    ordinal,
    factor: c.factor,
    factorLabel: c.factorLabel,
    contribution: c.contribution,
    contributionUnit: '分/tick' as const,
    contributionText: contributionText(c.contribution),
    causeType: c.detail.causeType,
    refId: c.detail.refId,
    detailText: c.detail.text,
    verbText: c.verbLabel,
    suggestedVerb: c.suggestedVerb,
    actionVerb: c.actionVerb,
    verbReachable: c.verbReachable,
  });
}

function projectAction(c: FourSegmentCard, ordinal: number): DiagnosisPanelAction | null {
  if (c.actionVerb === null || !c.verbReachable) return null;
  return Object.freeze({
    cardOrdinal: ordinal,
    verb: c.actionVerb,
    label: c.verbLabel,
    refId: c.detail.refId,
    reachableInOneTap: true as const,
    channel: 'A' as const,
  });
}

/** 面板标题按 D-16 事实分类给出准确措辞（不自称「首 tick」除非真是首 tick） */
function panelTitle(reason: DiagnosisEmptyReason | null): string {
  if (reason === 'E1_FIRST_TICK') return '首 tick 教学诊断';
  if (reason === 'MISSING_SOURCE') return '诊断数据缺失';
  if (reason === 'NO_SNAPSHOT') return '无快照记录';
  return '满意度变化诊断';
}

/**
 * 把第一批只读 VM 投影成 L2 面板可排布结构。纯函数、无副作用、不查 store。
 * 硬上限（≤4 卡 / ≤4 因子行）沿用第一批，且结构上不存在二维数组 / 表格。
 */
export function projectDiagnosisPanel(vm: DiagnosisViewModel): DiagnosisPanelView {
  const detail = vm.l2;
  const cards: DiagnosisPanelCard[] = [];
  const actions: DiagnosisPanelAction[] = [];
  for (let i = 0; i < detail.cards.length && cards.length < PANEL_CARD_LIMIT; i++) {
    const c = detail.cards[i];
    const ordinal = i + 1;
    cards.push(projectCard(c, ordinal));
    const action = projectAction(c, ordinal);
    if (action !== null) actions.push(action);
  }
  return Object.freeze({
    panelId: 'L2' as const,
    slotId: 'L2' as const,
    title: panelTitle(vm.l0.emptyReason),
    headline: vm.l0.headline,
    emptyReason: vm.l0.emptyReason,
    summary: vm.l0,
    cards: Object.freeze(cards),
    cardCount: cards.length,
    overflowCount: detail.overflowCount,
    l1RowCount: vm.l1.rows.length,
    coupling: detail.coupling,
    tutorial: detail.tutorial,
    actions: Object.freeze(actions),
    traceable: vm.traceable,
    unsourcedSuppressed: vm.unsourcedSuppressed,
    tickId: vm.tickId,
    cycleId: vm.cycleId,
    cycleTickIndex: vm.cycleTickIndex,
  });
}

// ---------------------------------------------------------------------------
// ② 单槽位适配器（复用 HudViewModel.activePanel，不另造并行面板状态）
// ---------------------------------------------------------------------------

/**
 * 既有 HUD 面板槽位的结构化只读端口。`HudViewModel` 由形状满足
 * （编译期断言见 index.ts，仿 D-14）；本层不 import HUD 实现，避免形成环。
 */
export interface DiagnosisPanelSlot {
  readonly activePanel: HudPanelState;
  setPanel(next: HudPanelState): void;
}

/**
 * 面板展开的通道 A 事件端口（结构化，真实 FeedbackBus 由形状满足）。
 * 只发 `panel-open` 即时视觉反馈，不发 B 事件、不写任何模拟状态。
 */
export interface DiagnosisPanelEmitter {
  emitA(type: 'panel-open', detail: { action: string; target: string }): unknown;
}

export interface DiagnosisPanelDeps {
  readonly vm: DiagnosisViewModel;
  readonly slot: DiagnosisPanelSlot;
  /** 可选：注入后 open() 会派发一条通道 A 的 panel-open 即时反馈 */
  readonly emitter?: DiagnosisPanelEmitter;
}

export interface DiagnosisPanelController {
  readonly view: DiagnosisPanelView;
  /** 恒由共享槽位派生：不存在第二套 isOpen 状态 */
  readonly isOpen: boolean;
  readonly activePanel: HudPanelState;
  /** 面板内披露深度（L0 摘要 / L1 因子 / L2 明细），委托给第一批 VM 的单值 */
  readonly activeLayer: DiagnosisLayer;
  /** 展开 L2：共享槽位自动收起 L1（互斥由 setPanel 单值实现保证） */
  open(): void;
  close(): void;
  /** 展开 L1：共享槽位自动收起 L2（E8 互斥反向验证入口） */
  openL1(): void;
  setLayer(next: DiagnosisLayer): void;
  /** 一次点按直达：只返回动作描述，不执行任何命令、不触发结算 */
  activateCard(ordinal: number): DiagnosisPanelAction | null;
}

export function createDiagnosisPanel(deps: DiagnosisPanelDeps): DiagnosisPanelController {
  const { vm, slot, emitter } = deps;
  const view = projectDiagnosisPanel(vm);
  const api: DiagnosisPanelController = {
    get view(): DiagnosisPanelView {
      return view;
    },
    get isOpen(): boolean {
      return slot.activePanel === DIAGNOSIS_PANEL_TARGET;
    },
    get activePanel(): HudPanelState {
      return slot.activePanel;
    },
    get activeLayer(): DiagnosisLayer {
      return vm.activeLayer;
    },
    open(): void {
      slot.setPanel(DIAGNOSIS_PANEL_TARGET);
      vm.setLayer('L2');
      // 通道 A：面板展开是「点按即时」，与 tick 无关；B 类数据不得经此派发。
      if (emitter !== undefined) {
        emitter.emitA('panel-open', { action: 'V2', target: DIAGNOSIS_PANEL_TARGET });
      }
    },
    close(): void {
      slot.setPanel('none');
    },
    openL1(): void {
      slot.setPanel('L1');
    },
    setLayer(next: DiagnosisLayer): void {
      vm.setLayer(next);
    },
    activateCard(ordinal: number): DiagnosisPanelAction | null {
      for (let i = 0; i < view.actions.length; i++) {
        if (view.actions[i].cardOrdinal === ordinal) return view.actions[i];
      }
      return null;
    },
  };
  return Object.freeze(api);
}

// ---------------------------------------------------------------------------
// ③ 两级反馈分离可观测（只读事件投影，A 即时 / B tick 后）
// ---------------------------------------------------------------------------

/** 反馈历史的只读端口；真实 FeedbackBus 由形状满足（编译期断言见 index.ts） */
export interface TwoLevelFeedbackSource {
  historyA(): readonly FeedbackEvent[];
  historyB(): readonly FeedbackEvent[];
}

/** 减动效呈现端口；真实 MotionPolicy 由形状满足（编译期断言见 index.ts） */
export interface TwoLevelMotionSpec {
  readonly mode: string;
  readonly durationMs: number;
  readonly channels: readonly string[];
  readonly informationLost: boolean;
}
export interface TwoLevelMotionPort {
  readonly reducedMotion: boolean;
  immediate(kind: 'panel-open'): TwoLevelMotionSpec;
  tickFeedback(): TwoLevelMotionSpec;
}

export type FeedbackEventRole = 'diagnosis-open' | 'diagnosis-refresh' | 'other-immediate' | 'other-post-tick';

/** 单条事件的可判定投影（把「与 tick 无关」/「tick 后」做成布尔字段） */
export interface FeedbackEventProjection {
  readonly channel: 'A' | 'B';
  readonly type: string;
  readonly seq: number;
  readonly tickId: number;
  readonly frameId: number;
  readonly action: string;
  readonly target: string;
  /** A 恒 true：tickId === TICK_FREE，不绑定任何 tick */
  readonly tickFree: boolean;
  /** B 恒 true：frameId === FRAME_FREE，不绑定渲染帧 */
  readonly frameFree: boolean;
  readonly clock: 'render-frame' | 'tick';
  readonly classification: 'immediate' | 'post-tick';
  readonly role: FeedbackEventRole;
  /** 是否携带 B 类数值差载荷（A 通道必须为 false，防止把 B 数据塞进 A） */
  readonly carriesTickDelta: boolean;
}

export interface TwoLevelSeparationVerdict {
  readonly channelACount: number;
  readonly channelBCount: number;
  readonly allChannelATickFree: boolean;
  readonly allChannelAFrameBound: boolean;
  readonly allChannelBTickBound: boolean;
  readonly allChannelBFrameFree: boolean;
  /** A 通道不得出现任何 B 类事件类型 */
  readonly noBTypeInA: boolean;
  /** B 通道不得出现任何 A 类事件类型 */
  readonly noATypeInB: boolean;
  /** A 通道不得携带 tick 数值差载荷 */
  readonly immediateCarriesNoTickDelta: boolean;
  /** 诊断面板展开只出现在 A（即时）；诊断数据刷新只出现在 B（tick 后） */
  readonly diagnosisOpenOnlyInImmediate: boolean;
  readonly diagnosisRefreshOnlyInPostTick: boolean;
  readonly reducedMotionConsistent: boolean;
  /** 上述结构性不变量全部成立（与「是否观测到事件」无关） */
  readonly separated: boolean;
  readonly bothChannelsObserved: boolean;
  readonly diagnosisOpenObserved: boolean;
  readonly diagnosisRefreshObserved: boolean;
  /** separated 且四类证据均观测到 → 两级反馈「可观测」的完整判据 */
  readonly fullyObservable: boolean;
}

export interface TwoLevelMotionProjection {
  readonly reducedMotion: boolean;
  readonly immediateMode: string;
  readonly immediateDurationMs: number;
  readonly immediateChannels: readonly string[];
  readonly tickMode: string;
  readonly tickDurationMs: number;
  /** 减动效只换表现、不丢信息（恒 false 才合规） */
  readonly informationLost: boolean;
}

export interface TwoLevelFeedbackView {
  readonly channelA: readonly FeedbackEventProjection[];
  readonly channelB: readonly FeedbackEventProjection[];
  readonly diagnosisOpenEvents: readonly FeedbackEventProjection[];
  readonly diagnosisRefreshEvents: readonly FeedbackEventProjection[];
  readonly clockA: 'render-frame' | 'tick';
  readonly clockB: 'render-frame' | 'tick';
  readonly verdict: TwoLevelSeparationVerdict;
  readonly motion: TwoLevelMotionProjection;
  readonly latencyNote: string;
}

/**
 * 角色按**事件类型**分类，与它实际落在哪个通道无关——这样「B 类事件被塞进 A 通道」
 * 才能被下面的判据抓出来，而不是被当成普通即时事件放过（反向对照 DF-7/DF-11）。
 */
function roleOf(e: FeedbackEvent): FeedbackEventRole {
  if (e.type === DIAGNOSIS_OPEN_EVENT_TYPE && e.target === DIAGNOSIS_PANEL_TARGET) return 'diagnosis-open';
  if (DIAGNOSIS_REFRESH_TYPES.indexOf(e.type) >= 0) return 'diagnosis-refresh';
  return e.channel === 'A' ? 'other-immediate' : 'other-post-tick';
}

function projectEvent(e: FeedbackEvent): FeedbackEventProjection {
  const channel: 'A' | 'B' = e.channel;
  return Object.freeze({
    channel,
    type: e.type,
    seq: e.seq,
    tickId: e.tickId,
    frameId: e.frameId,
    action: e.action,
    target: e.target,
    tickFree: e.tickId === TICK_FREE,
    frameFree: e.frameId === FRAME_FREE,
    clock: CHANNEL_CLOCK[channel].clock,
    classification: channel === 'A' ? ('immediate' as const) : ('post-tick' as const),
    role: roleOf(e),
    carriesTickDelta: e.delta !== undefined,
  });
}

function every(rows: readonly FeedbackEventProjection[], pred: (r: FeedbackEventProjection) => boolean): boolean {
  for (let i = 0; i < rows.length; i++) if (!pred(rows[i])) return false;
  return true;
}

function projectMotion(motion: TwoLevelMotionPort): TwoLevelMotionProjection {
  const a = motion.immediate('panel-open');
  const b = motion.tickFeedback();
  return Object.freeze({
    reducedMotion: motion.reducedMotion,
    immediateMode: a.mode,
    immediateDurationMs: a.durationMs,
    immediateChannels: Object.freeze(a.channels.slice()),
    tickMode: b.mode,
    tickDurationMs: b.durationMs,
    informationLost: a.informationLost || b.informationLost,
  });
}

/**
 * 从只读历史 + 只读动效声明产出「两级反馈分离」的可判定证据。
 * 不 emit、不订阅、不读时钟、不重算模拟；纯投影、结果冻结。
 */
export function projectTwoLevelFeedback(
  source: TwoLevelFeedbackSource,
  motion: TwoLevelMotionPort,
): TwoLevelFeedbackView {
  const rawA = source.historyA();
  const rawB = source.historyB();
  const channelA = Object.freeze(rawA.map(projectEvent));
  const channelB = Object.freeze(rawB.map(projectEvent));

  const diagnosisOpenEvents = Object.freeze(channelA.filter((r) => r.role === 'diagnosis-open'));
  const diagnosisRefreshEvents = Object.freeze(channelB.filter((r) => r.role === 'diagnosis-refresh'));

  const allChannelATickFree = every(channelA, (r) => r.tickFree && r.classification === 'immediate');
  const allChannelAFrameBound = every(channelA, (r) => r.frameId >= 0 && !r.frameFree);
  const allChannelBTickBound = every(channelB, (r) => r.tickId >= 0 && !r.tickFree);
  const allChannelBFrameFree = every(channelB, (r) => r.frameFree && r.classification === 'post-tick');
  const bTypes: readonly string[] = CHANNEL_B_TYPES;
  const aTypes: readonly string[] = CHANNEL_A_TYPES;
  const noBTypeInA = every(channelA, (r) => bTypes.indexOf(r.type) < 0);
  const noATypeInB = every(channelB, (r) => aTypes.indexOf(r.type) < 0);
  const immediateCarriesNoTickDelta = every(channelA, (r) => !r.carriesTickDelta);
  // 面板展开事件必须全部落在 A（即时）；数据刷新事件必须全部落在 B（tick 后）。
  const diagnosisOpenOnlyInImmediate = every(channelB, (r) => r.role !== 'diagnosis-open');
  const diagnosisRefreshOnlyInPostTick = every(channelA, (r) => r.role !== 'diagnosis-refresh');

  const motionView = projectMotion(motion);
  const reducedMotionConsistent = motion.reducedMotion
    ? motionView.immediateMode !== 'animated' &&
      motionView.immediateDurationMs === 0 &&
      motionView.immediateChannels.length >= 2 &&
      motionView.tickMode === 'instant' &&
      motionView.tickDurationMs === 0 &&
      !motionView.informationLost
    : motionView.immediateMode === 'animated' &&
      motionView.tickMode === 'animated' &&
      !motionView.informationLost;

  const separated =
    allChannelATickFree &&
    allChannelAFrameBound &&
    allChannelBTickBound &&
    allChannelBFrameFree &&
    noBTypeInA &&
    noATypeInB &&
    immediateCarriesNoTickDelta &&
    diagnosisOpenOnlyInImmediate &&
    diagnosisRefreshOnlyInPostTick &&
    reducedMotionConsistent;

  const bothChannelsObserved = channelA.length > 0 && channelB.length > 0;
  const diagnosisOpenObserved = diagnosisOpenEvents.length > 0;
  const diagnosisRefreshObserved = diagnosisRefreshEvents.length > 0;

  const verdict: TwoLevelSeparationVerdict = Object.freeze({
    channelACount: channelA.length,
    channelBCount: channelB.length,
    allChannelATickFree,
    allChannelAFrameBound,
    allChannelBTickBound,
    allChannelBFrameFree,
    noBTypeInA,
    noATypeInB,
    immediateCarriesNoTickDelta,
    diagnosisOpenOnlyInImmediate,
    diagnosisRefreshOnlyInPostTick,
    reducedMotionConsistent,
    separated,
    bothChannelsObserved,
    diagnosisOpenObserved,
    diagnosisRefreshObserved,
    fullyObservable: separated && bothChannelsObserved && diagnosisOpenObserved && diagnosisRefreshObserved,
  });

  return Object.freeze({
    channelA,
    channelB,
    diagnosisOpenEvents,
    diagnosisRefreshEvents,
    clockA: CHANNEL_CLOCK.A.clock,
    clockB: CHANNEL_CLOCK.B.clock,
    verdict,
    motion: motionView,
    latencyNote: TWO_LEVEL_LATENCY_NOTE,
  });
}
