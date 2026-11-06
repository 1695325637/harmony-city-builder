/**
 * HC-01 · UI 层 · 双通道反馈总线（S-07）
 *
 * 权威口径（只读引用）：
 * - `docs/architecture/adr/ADR-004-ui-feedback-decoupling.md` §2 子决策 1：
 *   **双通道彻底分离**——通道 A（即时反馈）在渲染帧内由 UI 本地同步产生视觉响应，
 *   <100ms、**与 tick 完全无关**；通道 B（模拟结果）仅在 V6「结束本日」触发后由
 *   Δ_t / 归因链 / 事件驱动。两条通道**不共享时钟**。
 * - `design/ux/ux-spec.md` §3.2 两级反馈契约；`design/art/art-bible.md` 附录 D-3
 *   （一律否决「UI 反馈绑定 tick」）。
 *
 * 结构强制（本文件是本层唯一的「时钟隔离」实现点）：
 * - 通道 A 事件恒带 `tickId = TICK_FREE(-1)`、带当前渲染帧号 `frameId`；
 *   调用方**无法**在 A 事件里塞入 tick 信息（`EventDetail` 没有 tickId 字段）。
 * - 通道 B 事件恒带 `frameId = FRAME_FREE(-1)`、必须带真实 `tickId >= 0`；
 *   传入负数 / 非整数直接抛错——B 只可能由一次真实结算产生。
 * - 两个通道各自独立的 `seq` 计数器与监听器数组，互不阻塞：
 *   `emitA` 不触碰任何 B 状态，反之亦然（用例断言）。
 *
 * 本文件不 import `core` / `simulation` / 时钟 API：通道 A 不可能读取 tick 状态，
 * 因为它根本拿不到（静态扫描用例 `ui-static-scan.test.ts` 钉定）。
 */

// ---------------------------------------------------------------------------
// 时钟隔离常量
// ---------------------------------------------------------------------------

/** 通道 A 事件的 tickId 占位：A 通道不绑定任何 tick */
export const TICK_FREE = -1;
/** 通道 B 事件的 frameId 占位：B 通道不绑定渲染帧 */
export const FRAME_FREE = -1;

/** 各通道的时钟归属（可断言的自述表，供验证记录引用） */
export const CHANNEL_CLOCK: Readonly<
  Record<'A' | 'B', { readonly clock: 'render-frame' | 'tick'; readonly tickBound: boolean; readonly frameBound: boolean }>
> = Object.freeze({
  A: Object.freeze({ clock: 'render-frame', tickBound: false, frameBound: true }),
  B: Object.freeze({ clock: 'tick', tickBound: true, frameBound: false }),
});

// ---------------------------------------------------------------------------
// 事件类型（ux-spec §3.2 两级反馈的机器可读投影）
// ---------------------------------------------------------------------------

/** 通道 A · 即时反馈（帧内、同步、<100ms、与 tick 无关） */
export type ChannelAEventType = 'press' | 'placement' | 'highlight' | 'tab' | 'select' | 'rollback' | 'panel-open';

/** 通道 B · 模拟结果（仅 V6「结束本日」结算后） */
export type ChannelBEventType = 'tick-delta' | 'issue-change' | 'voice' | 'flow-state';

export type FeedbackChannel = 'A' | 'B';

export const CHANNEL_A_TYPES: readonly ChannelAEventType[] = Object.freeze([
  'press',
  'placement',
  'highlight',
  'tab',
  'select',
  'rollback',
  'panel-open',
]);

export const CHANNEL_B_TYPES: readonly ChannelBEventType[] = Object.freeze([
  'tick-delta',
  'issue-change',
  'voice',
  'flow-state',
]);

/**
 * 视觉编码（色 + 形状 + 文字三通道的最小载荷）。
 * **色值 / 形状永远来自 `src/render/semantic-tokens.ts` 的公开查询函数**
 * （`tokenById`），本层不写任何十六进制、不写任何形状字面值——
 * 这样令牌形状唯一化改造不会波及 UI 事件载荷。
 */
export interface VisualEncoding {
  readonly tokenId: string;
  readonly color: string;
  readonly shape: string;
  readonly label: string;
}

/** 事件载荷（标量字典：可 JSON 序列化、可逐字段断言，不放对象引用） */
export type FeedbackScalars = Readonly<Record<string, string | number | boolean | null>>;

export interface FeedbackEvent {
  readonly channel: FeedbackChannel;
  readonly type: ChannelAEventType | ChannelBEventType;
  /** A 通道恒为 TICK_FREE；B 通道为真实结算 tickId */
  readonly tickId: number;
  /** B 通道恒为 FRAME_FREE；A 通道为当前渲染帧号 */
  readonly frameId: number;
  /** 动词 / 界面动作标识（V3 / V5 / V6 …或 face 内的具体动作名） */
  readonly action: string;
  /** 目标标识（格坐标 `x,y` / tab id / 面板 id / 按钮 id） */
  readonly target: string;
  /** 通道内单调递增序号（两通道各自独立，不共享计时） */
  readonly seq: number;
  readonly encoding?: VisualEncoding;
  readonly data?: FeedbackScalars;
  /** 数值差（B 通道主力载荷：`{ S, B }` 等，键来自结算 Δ） */
  readonly delta?: Readonly<Record<string, number>>;
}

/** 通道 A 事件描述（**没有 tickId 字段**：从类型上禁止 A 读 tick） */
export interface EventDetail {
  readonly action: string;
  readonly target?: string;
  readonly encoding?: VisualEncoding;
  readonly data?: FeedbackScalars;
  readonly delta?: Readonly<Record<string, number>>;
}

/** 通道 B 事件描述：必须显式声明来自哪一次结算 */
export interface BEventDetail extends EventDetail {
  readonly tickId: number;
}

export interface FeedbackEmitterA {
  emitA(type: ChannelAEventType, detail: EventDetail): FeedbackEvent;
}

export interface FeedbackEmitterB {
  emitB(type: ChannelBEventType, detail: BEventDetail): FeedbackEvent;
}

export type FeedbackListener = (event: FeedbackEvent) => void;

export interface FeedbackBus extends FeedbackEmitterA, FeedbackEmitterB {
  readonly dispatchCountA: number;
  readonly dispatchCountB: number;
  /** 当前渲染帧号（由 `beginFrame` 推进，与 tick 无关） */
  readonly frameId: number;
  /** 推进一帧并返回新的帧号（渲染帧循环每次调用一次；不读任何时钟） */
  beginFrame(): number;
  onA(listener: FeedbackListener): () => void;
  onB(listener: FeedbackListener): () => void;
  /** 通道 A 历史（渲染调试 / 用例断言用；容量受 historyLimit 限制） */
  historyA(): readonly FeedbackEvent[];
  historyB(): readonly FeedbackEvent[];
  /**
   * 监听器抛错记录：单通道内某个监听器抛错不得影响另一通道的派发，
   * 也不得吞掉异常——错误在此留痕，由 UI 层上报遥测。
   */
  listenerErrors(): readonly string[];
  reset(): void;
}

export interface FeedbackBusOptions {
  /** 每通道历史环形上限（默认 512；只影响调试可观测性，不影响派发） */
  readonly historyLimit?: number;
}

const DEFAULT_HISTORY_LIMIT = 512;

function pushBounded(list: FeedbackEvent[], event: FeedbackEvent, limit: number): void {
  list.push(event);
  if (list.length > limit) list.shift();
}

export function createFeedbackBus(options: FeedbackBusOptions = {}): FeedbackBus {
  const limit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;

  let seqA = 0;
  let seqB = 0;
  let frameId = 0;
  let countA = 0;
  let countB = 0;
  let historyA: FeedbackEvent[] = [];
  let historyB: FeedbackEvent[] = [];
  let listenersA: FeedbackListener[] = [];
  let listenersB: FeedbackListener[] = [];
  const errors: string[] = [];

  const dispatch = (listeners: readonly FeedbackListener[], event: FeedbackEvent, channel: string): void => {
    // 复制一份再遍历：监听器内部取消订阅不会打乱本次派发
    const snapshot = listeners.slice();
    for (let i = 0; i < snapshot.length; i++) {
      try {
        snapshot[i](event);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push('channel ' + channel + ' listener threw: ' + msg);
      }
    }
  };

  const bus: FeedbackBus = {
    get dispatchCountA(): number {
      return countA;
    },
    get dispatchCountB(): number {
      return countB;
    },
    get frameId(): number {
      return frameId;
    },
    beginFrame(): number {
      frameId++;
      return frameId;
    },
    emitA(type: ChannelAEventType, detail: EventDetail): FeedbackEvent {
      const event: FeedbackEvent = Object.freeze({
        channel: 'A' as const,
        type,
        // 通道 A 与 tick 完全无关：不读取、不接收、不推断 tick 状态
        tickId: TICK_FREE,
        frameId,
        action: detail.action,
        target: detail.target ?? '',
        seq: ++seqA,
        encoding: detail.encoding,
        data: detail.data,
        delta: detail.delta,
      });
      countA++;
      pushBounded(historyA, event, limit);
      dispatch(listenersA, event, 'A');
      return event;
    },
    emitB(type: ChannelBEventType, detail: BEventDetail): FeedbackEvent {
      if (!Number.isInteger(detail.tickId) || detail.tickId < 0) {
        throw new Error('channel B event requires a real tickId (>= 0), got ' + String(detail.tickId));
      }
      const event: FeedbackEvent = Object.freeze({
        channel: 'B' as const,
        type,
        tickId: detail.tickId,
        frameId: FRAME_FREE,
        action: detail.action,
        target: detail.target ?? '',
        seq: ++seqB,
        encoding: detail.encoding,
        data: detail.data,
        delta: detail.delta,
      });
      countB++;
      pushBounded(historyB, event, limit);
      dispatch(listenersB, event, 'B');
      return event;
    },
    onA(listener: FeedbackListener): () => void {
      listenersA.push(listener);
      return (): void => {
        listenersA = listenersA.filter((l) => l !== listener);
      };
    },
    onB(listener: FeedbackListener): () => void {
      listenersB.push(listener);
      return (): void => {
        listenersB = listenersB.filter((l) => l !== listener);
      };
    },
    historyA(): readonly FeedbackEvent[] {
      return historyA;
    },
    historyB(): readonly FeedbackEvent[] {
      return historyB;
    },
    listenerErrors(): readonly string[] {
      return errors;
    },
    reset(): void {
      seqA = 0;
      seqB = 0;
      countA = 0;
      countB = 0;
      historyA = [];
      historyB = [];
      listenersA = [];
      listenersB = [];
      errors.length = 0;
      // 帧号按设计不因 reset 归零：reset 只清事件与订阅，不 pretending 时间倒流
    },
  };
  return bus;
}

/** 便捷过滤（用例 / 调试）：按类型筛某一通道的历史 */
export function eventsOfType<T extends FeedbackEvent['type']>(
  history: readonly FeedbackEvent[],
  type: T,
): readonly FeedbackEvent[] {
  const out: FeedbackEvent[] = [];
  for (let i = 0; i < history.length; i++) if (history[i].type === type) out.push(history[i]);
  return out;
}
