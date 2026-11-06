/**
 * HC-08 · UI 层 · 「结束本日」主 CTA（S-08 项 3：唯一主操作 / 结算状态机 / 连点不双结算）
 *
 * 权威口径（只读引用）：
 * - ADR-004 §2：V6「结束本日」是**唯一**推进入口，只经 `session.advanceDay(key)`；
 *   结算期间 `InputGate` 锁「推 / 改状态」（子决策 4），连点不得双结算。
 * - ux-spec §3.2 / §3.3：按压反馈走 **press 通道**；减动效时降为**静态按压色**
 *   （我们已定的瞬态反馈例外口径，非信息态）。
 *
 * 纪律：
 * - 本按钮**不自己调 runTick / advanceDay 内核**——它只委托 `controller.advanceDay`
 *   （那条路径已含 gate 锁 + 幂等键防连点双结算），静态扫描 SCAN-4/SCAN-7 钉定；
 * - 不写权威状态、不读 tick 之外的时钟、不出现色值。
 *
 * 状态机：`idle → settling(gate locked) → idle`。
 * `phase` 由 `controller.gateLocked` 派生——结算期间为 `settling`，纯视觉反馈仍响应。
 */

import type { InteractionController, UiAdvanceResult } from '../interaction-controller.ts';

export type EndDayPhase = 'idle' | 'settling';

export interface EndDayButton {
  /** 当前阶段：gate 锁定时为 settling，否则 idle（派生，非自存状态） */
  readonly phase: EndDayPhase;
  readonly tickId: number;
  readonly committedCount: number;
  /** 纯视觉按压反馈（通道 A；减动效降为静态按压色，由 motion 策略决定） */
  press(): void;
  /** 触发结算：唯一推进入口，只经 controller.advanceDay（含 gate 锁 + 幂等防双结算） */
  activate(key: string): UiAdvanceResult;
}

export interface EndDayButtonDeps {
  readonly controller: InteractionController;
}

export function createEndDayButton(deps: EndDayButtonDeps): EndDayButton {
  const { controller } = deps;

  const api: EndDayButton = {
    get phase(): EndDayPhase {
      return controller.gateLocked ? 'settling' : 'idle';
    },
    get tickId(): number {
      return controller.tickId;
    },
    get committedCount(): number {
      return controller.committedCount;
    },
    press(): void {
      // 委托 controller.press：它走 press 通道、减动效时降为静态按压色，
      // 且结算期间也立即响应（gate 锁不挡纯视觉反馈，ADR-004 §2 子决策 4）
      controller.press('end-day');
    },
    activate(key: string): UiAdvanceResult {
      // 委托 controller.advanceDay：唯一推进入口；gate 锁期间直接拒（不调 session.advanceDay，
      // 因此连点不双结算）；幂等键防重复 key 二次结算。本按钮不再另造一层推进逻辑。
      return controller.advanceDay(key);
    },
  };
  return api;
}
