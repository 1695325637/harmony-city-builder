/**
 * HC-01 · UI 层 · 交互控制器（S-07：V3 划 / V4 拨 / V5 连 / V6 推 / Tab / 选中）
 *
 * 权威口径（只读引用）：
 * - ADR-004 §2：通道 A（即时，帧内，与 tick 无关）+ 通道 B（仅 V6「结束本日」后，
 *   由 Δ / 归因 / 事件驱动）；UI 零写权威状态；非法命令由 `BudgetRejected` 回滚乐观视图。
 *   §2 子决策 4：结算期间 `InputGate` 只锁「推 / 改状态」，**不锁纯视觉反馈**。
 *   §2 子决策 5：倍速不改变分层——它只是「定时产生 V6 命令」的另一个命令来源，
 *   `IFeatureFlags` 默认关。
 * - ux-spec §3.1 动词→界面映射、§3.2 两级反馈契约、§3.3「一次点按 + 点击替代路径」、
 *   §4.1「一次点按 = 一次 tick」「结算中重复点按绝不结算两次」、§7 E5。
 *
 * 命令通道纪律：
 * - 改状态只经 `session.submit(command)`（P0/P1 排队），推进只经
 *   `session.advanceDay(key)`——**本文件不 import `tick-pipeline`，也不调用 `runTick`**
 *   （静态扫描用例钉定）。
 * - 本文件不写任何权威状态：`UiSessionPort` 只暴露 `submit` / `advanceDay` / 计数器，
 *   **不暴露可写 state**。
 */

import type { Command, SimEvent } from '../core/types.ts';
import { makeCommand } from '../simulation/commands.ts';
import type { SemanticTokenMap } from '../render/semantic-tokens.ts';
import {
  createFeedbackBus,
  type FeedbackBus,
  type FeedbackScalars,
  type VisualEncoding,
} from './feedback-bus.ts';
import { createOptimisticLayer, type OptimisticLayer } from './optimistic-view.ts';
import { createMotionPolicy, type ImmediateFeedbackKind, type MotionPolicy } from './motion-policy.ts';

// ---------------------------------------------------------------------------
// 会话端口（结构化类型：真实 `Simulation` 直接满足，测试可注入假实现）
// ---------------------------------------------------------------------------

export interface DeltaLike {
  readonly key: string;
  readonly old: number;
  readonly new: number;
  readonly delta: number;
}

export interface AttributionLike {
  readonly primary_factor: string;
  readonly dS_i: number;
  readonly causeType: string;
  readonly refId: string;
  readonly detail: string;
  readonly suggested_verb: string;
}

export interface TickResultLike {
  readonly tickId: number;
  readonly events: readonly SimEvent[];
  readonly delta: readonly DeltaLike[];
  readonly attribution: readonly AttributionLike[];
  /** 'IN_CYCLE' | 'TARGET_MET' | 'RETRY_AVAILABLE'（周期末议题重评信号） */
  readonly cycleOutcome: string;
}

export interface AdvanceResultLike {
  readonly accepted: boolean;
  readonly events: readonly SimEvent[];
  readonly result?: TickResultLike;
}

/**
 * UI 能看到的全部会话能力：提交命令、推进一天、读计数器、读闸门状态。
 * **没有** `state` 字段——UI 拿不到可写权威状态（ADR-004 §2 子决策 2）。
 */
export interface UiSessionPort {
  submit(command: Command): void;
  advanceDay(key: string): AdvanceResultLike;
  readonly gate: { readonly isLocked: boolean };
  readonly pendingCount: number;
  readonly tickId: number;
  readonly committedCount: number;
}

// ---------------------------------------------------------------------------
// 特性开关（倍速：Should，默认关）
// ---------------------------------------------------------------------------

export interface UiFeatureFlags {
  /** 倍速 / 自动播放总开关：默认 false（OD-2 A / ADR-004 §2 子决策 5） */
  readonly speedMultiplier: boolean;
  /** 倍速档位（Should）；默认空数组，即使误开总开关也不会自动推进 */
  readonly speedLevels: readonly number[];
  /** 自动产生 V6 命令的间隔 ms（由渲染帧循环传入耗时驱动，不读墙上时钟） */
  readonly autoAdvanceIntervalMs: number;
}

export const DEFAULT_UI_FEATURE_FLAGS: UiFeatureFlags = Object.freeze({
  speedMultiplier: false,
  speedLevels: Object.freeze([]) as readonly number[],
  autoAdvanceIntervalMs: 0,
});

export function createUiFeatureFlags(overrides: Partial<UiFeatureFlags> = {}): UiFeatureFlags {
  return Object.freeze({
    speedMultiplier: overrides.speedMultiplier ?? DEFAULT_UI_FEATURE_FLAGS.speedMultiplier,
    speedLevels: overrides.speedLevels ?? DEFAULT_UI_FEATURE_FLAGS.speedLevels,
    autoAdvanceIntervalMs: overrides.autoAdvanceIntervalMs ?? DEFAULT_UI_FEATURE_FLAGS.autoAdvanceIntervalMs,
  });
}

// ---------------------------------------------------------------------------
// UI 词汇（ux-spec §2.1 底部 5 类 Tab + §2.2 三层披露）
// ---------------------------------------------------------------------------

/** 底部建造 Tab：居住 / 商业 / 产业 / 道路 / 拆除（MVP 5 类，ux-spec §2.1） */
export type UiTabId = 'R' | 'C' | 'I' | 'ROAD' | 'DEMOLISH';

export const UI_TABS: readonly UiTabId[] = Object.freeze(['R', 'C', 'I', 'ROAD', 'DEMOLISH']);

/** 数据面板槽位：L1 次级 / L2 诊断，同屏互斥（ux-spec §2.2 / E8） */
export type UiPanelId = 'L1' | 'L2';
export type UiPanelState = UiPanelId | 'none';

/** 拒绝原因（可断言字符串；'' = 接受） */
export type UiRejectReason = '' | 'GATE_LOCKED' | 'DUPLICATE_KEY' | 'AUTO_DISABLED' | 'SETTLING' | 'REJECTED';

export interface UiActionResult {
  readonly accepted: boolean;
  readonly reason: UiRejectReason | string;
  readonly commandId: string;
  /**
   * 纯视觉反馈是否仍已响应（<100ms 通道 A）。
   * 结算期间「推 / 改状态」被拒时它仍为 true——这是 ADR-004 §2 子决策 4 的可断言形式。
   */
  readonly visualEmitted: boolean;
}

export interface UiAdvanceResult extends UiActionResult {
  /** 结算后的 tickId（被拒时保持原值） */
  readonly tickId: number;
  /** 本次结算提交的 tick 数（连点幂等时应为 1，被拒时为 0） */
  readonly committed: number;
  readonly events: readonly SimEvent[];
  /** 结果是否由倍速定时器产生（feature flag 关闭时恒为 false） */
  readonly fromAutoAdvance: boolean;
}

export interface InteractionController {
  readonly bus: FeedbackBus;
  readonly layer: OptimisticLayer;
  readonly motion: MotionPolicy;
  readonly flags: UiFeatureFlags;
  readonly activeTab: UiTabId;
  readonly panel: UiPanelState;
  readonly tickId: number;
  readonly pendingCount: number;
  readonly committedCount: number;
  readonly gateLocked: boolean;

  /** 按压态（纯视觉，结算期间也必须响应） */
  press(target: string): UiActionResult;
  /** 选中地块（纯视觉，结算期间也必须响应） */
  select(x: number, y: number): UiActionResult;
  /** 切 Tab（纯视觉，结算期间也必须响应） */
  setTab(tab: UiTabId): UiActionResult;
  /** 展开 L1 / L2 面板（互斥；传 'none' 收起） */
  openPanel(panel: UiPanelState): UiActionResult;

  /** V3 划：分区 + 密度（一次点按一格） */
  zone(x: number, y: number, zoneId: string, density: number): UiActionResult;
  /** V3 拆除：写回 `EMPTY`（Command 与 P1 同一裁决路径） */
  demolish(x: number, y: number): UiActionResult;
  /** V5 连：铺一格道路（拖拽路径的单元） */
  road(x: number, y: number): UiActionResult;
  /**
   * V5 的**点击替代路径**（ux-spec §3.3 / §9.2 输入替代）：两个端点 → 同一种
   * `ROAD` Command 序列，不依赖拖拽手势；返回每条命令的结果。
   */
  roadClickPath(x0: number, y0: number, x1: number, y1: number): readonly UiActionResult[];
  /** V4 拨：投入额（扣减预览 + `I_f` 高亮） */
  fund(amountCU: number): UiActionResult;

  /** V6 推：**唯一**推进入口，只经 `session.advanceDay(key)` */
  advanceDay(key: string): UiAdvanceResult;
  /**
   * 倍速（feature flag，默认关）：由渲染帧循环传入自上一帧的耗时；
   * 到期时产生一条 V6 命令走与手动完全相同的路径（通道分层不变）。
   */
  pumpAutoAdvance(elapsedMs: number): UiAdvanceResult | null;

  /** 已提交命令流水（诊断 / 用例断言用，容量 256） */
  commands(): readonly Command[];
}

export interface InteractionControllerDeps {
  readonly session: UiSessionPort;
  readonly tokens: SemanticTokenMap;
  /** 可注入总件（默认内部新建）；注入时须与 `layer`/`tokens` 同源 */
  readonly bus?: FeedbackBus;
  readonly layer?: OptimisticLayer;
  readonly flags?: UiFeatureFlags;
  readonly reducedMotion?: boolean;
  /**
   * 可用性预检（ADR-004 §5 负面成本缓解）：返回 false 时即时预览转「非法」编码。
   * **不是裁决**——P1 仍是唯一裁决方；返回 undefined 表示不做预检。
   */
  readonly precheck?: (command: Command) => boolean | undefined;
}

const COMMAND_LOG_LIMIT = 256;

function scalarOf(spec: { mode: string; durationMs: number; channels: readonly string[] }, extra?: FeedbackScalars): FeedbackScalars {
  const base: Record<string, string | number | boolean | null> = {
    mode: spec.mode,
    durationMs: spec.durationMs,
    channels: spec.channels.join('+'),
  };
  if (extra !== undefined) {
    const keys = Object.keys(extra);
    for (let i = 0; i < keys.length; i++) base[keys[i]] = extra[keys[i]];
  }
  return Object.freeze(base);
}

export function createInteractionController(deps: InteractionControllerDeps): InteractionController {
  const { session, tokens, flags: injectedFlags, precheck } = deps;
  const bus = deps.bus ?? createFeedbackBus();
  const layer = deps.layer ?? createOptimisticLayer({ tokens, bus });
  const motion = createMotionPolicy({ tokens, reducedMotion: deps.reducedMotion });
  const flags = injectedFlags ?? DEFAULT_UI_FEATURE_FLAGS;

  let seq = 0;
  let activeTab: UiTabId = 'R';
  let panel: UiPanelState = 'none';
  let lastSelectionId = '';
  let lastTabId = '';
  let lastPanelId = '';
  let autoAccMs = 0;
  let autoSeq = 0;
  const commandLog: Command[] = [];
  const submittedKeys = new Set<string>();

  const log = (command: Command): void => {
    commandLog.push(command);
    if (commandLog.length > COMMAND_LOG_LIMIT) commandLog.shift();
  };

  const immediate = (kind: ImmediateFeedbackKind): { encoding: VisualEncoding; data: FeedbackScalars } => {
    const spec = motion.immediate(kind);
    return { encoding: spec.encoding, data: scalarOf({ mode: spec.mode, durationMs: spec.durationMs, channels: spec.channels }) };
  };

  /** 通道 A · 按压态（无论闸门是否锁，都必须立刻响应） */
  const emitPress = (target: string): void => {
    const { encoding, data } = immediate('press');
    bus.emitA('press', { action: 'press', target, encoding, data });
  };

  /**
   * 改状态动作的统一路径：
   * 即时反馈（按压 + 乐观叠加）→ 闸门检查 → 提交命令 / 立即回滚。
   */
  const submitCommand = (build: (key: string, seqNo: number) => Command, target: string): UiActionResult => {
    seq++;
    const key = 'v-' + seq;
    const command = build(key, seq);
    emitPress(target);
    const verdict = precheck === undefined ? undefined : precheck(command);
    layer.apply(command, { legality: verdict === false ? 'illegal' : 'legal' });

    if (session.gate.isLocked) {
      // 结算期间「改状态」被拒（ADR-004 §2 子决策 4）：撤下乐观叠加，不留残留
      layer.rollback(key, 'GATE_LOCKED');
      return { accepted: false, reason: 'GATE_LOCKED', commandId: key, visualEmitted: true };
    }
    if (submittedKeys.has(key)) {
      layer.rollback(key, 'DUPLICATE_KEY');
      return { accepted: false, reason: 'DUPLICATE_KEY', commandId: key, visualEmitted: true };
    }
    submittedKeys.add(key);
    log(command);
    session.submit(command);
    return { accepted: true, reason: '', commandId: key, visualEmitted: true };
  };

  /** 通道 B · 结算结果派发（**全项目只有本函数与 feedback-bus 定义处出现 `emitB`**） */
  const settle = (result: TickResultLike | undefined): void => {
    if (result === undefined) return;
    const tickId = result.tickId;

    // 1) 非法命令：撤下乐观叠加 + 负向形状编码（通道 A，即时）
    for (let i = 0; i < result.events.length; i++) {
      const event = result.events[i];
      if (event.type === 'BudgetRejected') layer.rollback(event.commandId, event.reason);
    }

    // 2) tick-delta：Δ_t 是唯一权威数值来源（UI 不重算）
    const delta: Record<string, number> = {};
    for (let i = 0; i < result.delta.length; i++) {
      const d = result.delta[i];
      delta[d.key] = d.delta;
    }
    bus.emitB('tick-delta', {
      tickId,
      action: 'V7',
      target: 'hud',
      delta: Object.freeze(delta),
      data: Object.freeze({
        deltaCount: result.delta.length,
        cycleOutcome: result.cycleOutcome,
        cycleEnded: result.cycleOutcome !== 'IN_CYCLE',
      }),
    });

    // 3) flow-state：通勤观测信号（三态标签由渲染层按 `flow.*` 语义令牌判定，
    //    UI 不重算通勤、不派生拥堵结论、也不自带编码——这里只搬结算给出的归因）
    let flow: AttributionLike | undefined;
    let primary: AttributionLike | undefined;
    for (let i = 0; i < result.attribution.length; i++) {
      const a = result.attribution[i];
      if (flow === undefined && a.refId === 'traffic:T_c') flow = a;
      if (primary === undefined || Math.abs(a.dS_i) > Math.abs(primary.dS_i)) primary = a;
    }
    bus.emitB('flow-state', {
      tickId,
      action: 'V7',
      target: 'flow',
      data: Object.freeze({
        attributionRef: flow === undefined ? '' : flow.refId,
        dS_fc: flow === undefined ? 0 : flow.dS_i,
        // 三态判定不在 UI 层：渲染侧按 flow.* 令牌上色，本层只报「需刷新」
        refresh: true,
      }),
    });

    // 4) voice（OD-3 A 市民之声）：只搬归因 refs，文本渲染留 S-09（P6 已注「aggregate text refs only」）
    if (primary !== undefined) {
      bus.emitB('voice', {
        tickId,
        action: 'V7',
        target: 'voice',
        data: Object.freeze({
          factorKey: primary.primary_factor,
          causeType: primary.causeType,
          causeRef: primary.refId,
          dS_i: primary.dS_i,
          suggestedVerb: primary.suggested_verb,
        }),
      });
    }

    // 5) issue-change：占位事件或周期末重评（真实议题规则留 S-05 / S-09）
    for (let i = 0; i < result.events.length; i++) {
      const event = result.events[i];
      if (event.type === 'IssuePlaceholder') {
        bus.emitB('issue-change', {
          tickId,
          action: 'V7',
          target: 'issues',
          data: Object.freeze({ source: 'IssuePlaceholder', reason: event.reason }),
        });
      }
    }
    if (result.cycleOutcome !== 'IN_CYCLE') {
      bus.emitB('issue-change', {
        tickId,
        action: 'V7',
        target: 'issues',
        data: Object.freeze({ source: 'cycle-end', cycleOutcome: result.cycleOutcome }),
      });
    }
  };

  const advance = (key: string, fromAutoAdvance: boolean): UiAdvanceResult => {
    emitPress('end-day');
    if (session.gate.isLocked) {
      return {
        accepted: false,
        reason: 'GATE_LOCKED',
        commandId: key,
        visualEmitted: true,
        tickId: session.tickId,
        committed: 0,
        events: [],
        fromAutoAdvance,
      };
    }
    const before = session.committedCount;
    const result = session.advanceDay(key);
    if (!result.accepted) {
      const raw = result.events.length > 0 ? result.events[0].reason : '';
      const reason: UiRejectReason | string = raw === 'DUPLICATE' ? 'DUPLICATE_KEY' : raw === 'SETTLING' ? 'SETTLING' : 'REJECTED';
      return {
        accepted: false,
        reason,
        commandId: key,
        visualEmitted: true,
        tickId: session.tickId,
        committed: 0,
        events: result.events,
        fromAutoAdvance,
      };
    }
    settle(result.result);
    return {
      accepted: true,
      reason: '',
      commandId: key,
      visualEmitted: true,
      tickId: session.tickId,
      committed: session.committedCount - before,
      events: result.events,
      fromAutoAdvance,
    };
  };

  const controller: InteractionController = {
    bus,
    layer,
    motion,
    flags,
    get activeTab(): UiTabId {
      return activeTab;
    },
    get panel(): UiPanelState {
      return panel;
    },
    get tickId(): number {
      return session.tickId;
    },
    get pendingCount(): number {
      return session.pendingCount;
    },
    get committedCount(): number {
      return session.committedCount;
    },
    get gateLocked(): boolean {
      return session.gate.isLocked;
    },
    press(target: string): UiActionResult {
      emitPress(target);
      return { accepted: true, reason: '', commandId: '', visualEmitted: true };
    },
    select(x: number, y: number): UiActionResult {
      const target = x + ',' + y;
      if (lastSelectionId !== '') layer.discard(lastSelectionId);
      const item = layer.applyUi({ kind: 'select', target, x, y });
      lastSelectionId = item.commandId;
      return { accepted: true, reason: '', commandId: item.commandId, visualEmitted: true };
    },
    setTab(tab: UiTabId): UiActionResult {
      if (UI_TABS.indexOf(tab) < 0) return { accepted: false, reason: 'REJECTED', commandId: '', visualEmitted: false };
      if (lastTabId !== '') layer.discard(lastTabId);
      const item = layer.applyUi({ kind: 'tab', target: tab });
      lastTabId = item.commandId;
      activeTab = tab;
      return { accepted: true, reason: '', commandId: item.commandId, visualEmitted: true };
    },
    openPanel(next: UiPanelState): UiActionResult {
      if (next === 'none') {
        if (lastPanelId !== '') layer.discard(lastPanelId);
        lastPanelId = '';
        panel = 'none';
        return { accepted: true, reason: '', commandId: '', visualEmitted: true };
      }
      // L1 / L2 互斥：展开新的即收起旧的（ux-spec §2.2 / E8）
      if (lastPanelId !== '') layer.discard(lastPanelId);
      const item = layer.applyUi({ kind: 'panel', target: next });
      lastPanelId = item.commandId;
      panel = next;
      return { accepted: true, reason: '', commandId: item.commandId, visualEmitted: true };
    },
    zone(x: number, y: number, zoneId: string, density: number): UiActionResult {
      return submitCommand((key, seqNo) => makeCommand.zone(key, seqNo, x, y, zoneId, density), x + ',' + y);
    },
    demolish(x: number, y: number): UiActionResult {
      // 拆除 = 写回内建 EMPTY（zoneIndex('EMPTY') === 0），与 P1 走同一条裁决路径
      return submitCommand((key, seqNo) => makeCommand.zone(key, seqNo, x, y, 'EMPTY', 0), x + ',' + y);
    },
    road(x: number, y: number): UiActionResult {
      return submitCommand((key, seqNo) => makeCommand.road(key, seqNo, x, y), x + ',' + y);
    },
    roadClickPath(x0: number, y0: number, x1: number, y1: number): readonly UiActionResult[] {
      const out: UiActionResult[] = [];
      const dx = x1 === x0 ? 0 : x1 > x0 ? 1 : -1;
      const dy = y1 === y0 ? 0 : y1 > y0 ? 1 : -1;
      let x = x0;
      let y = y0;
      for (let guard = 0; guard < 64; guard++) {
        out.push(controller.road(x, y));
        if (x === x1 && y === y1) break;
        if (x !== x1) x += dx;
        else if (y !== y1) y += dy;
      }
      return out;
    },
    fund(amountCU: number): UiActionResult {
      return submitCommand((key, seqNo) => makeCommand.fund(key, seqNo, amountCU), 'fund');
    },
    advanceDay(key: string): UiAdvanceResult {
      return advance(key, false);
    },
    pumpAutoAdvance(elapsedMs: number): UiAdvanceResult | null {
      if (!flags.speedMultiplier) return null;
      if (flags.speedLevels.length === 0) return null;
      if (!(flags.autoAdvanceIntervalMs > 0)) return null;
      if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return null;
      autoAccMs += elapsedMs;
      if (autoAccMs < flags.autoAdvanceIntervalMs) return null;
      autoAccMs = 0;
      autoSeq++;
      // 倍速只是「定时产生 V6 命令」：与手动点按走完全相同的 advance 路径，
      // 因此通道 A / 通道 B 的分层不变（ADR-004 §2 子决策 5）
      return advance('auto-advance-' + autoSeq, true);
    },
    commands(): readonly Command[] {
      return commandLog;
    },
  };
  return controller;
}
