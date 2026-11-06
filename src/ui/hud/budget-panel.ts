/**
 * HC-08 · UI 层 · 预算面板（S-08 项 4：只读投影 I / C_b / C_m / B）
 *
 * 权威口径（只读引用）：
 * - ux-spec §3.1 V4 拨 / §2.2 三层披露：预算面板是**只读投影**，
 *   不得写权威状态（ADR-004 §2 子决策 2）。
 *
 * 纪律：
 * - 本面板只暴露读 getter，**没有任何 setter / 不持有可写 state**；
 * - `projectCityStateToBudget` 从 `CityState` **读取**（VM = 快照只读投影），
 *   不修改 state——静态扫描 SCAN-5 只抓写入路径，读取安全。
 * - 不 import 引擎 / 不读 tick / 不读时钟 / 不出现任何色值。
 */

import type { CityState } from '../../core/types.ts';
import type { BudgetState } from '../../core/types.ts';

/** 预算只读投影（I 收入 / C_b / C_m 累计 / B 结余，B 可负） */
export interface BudgetProjection {
  /** I_t：本周期市政收入（CU/周期） */
  readonly I_t: number;
  /** C_b 累计（CU） */
  readonly C_b: number;
  /** C_m 累计（CU/周期） */
  readonly C_m: number;
  /** B_t：预算结余（CU，可负，软着陆） */
  readonly B: number;
}

/** 从权威状态**只读**投影预算（VM = 快照只读投影，绝不写回） */
export function projectCityStateToBudget(state: Readonly<CityState>): BudgetProjection {
  const budget: BudgetState = state.budget;
  return Object.freeze({
    I_t: budget.I_t,
    C_b: budget.C_b_accum,
    C_m: budget.C_m_accum,
    B: budget.B,
  });
}

export interface BudgetPanel {
  readonly I_t: number;
  readonly C_b: number;
  readonly C_m: number;
  readonly B: number;
  /** 结余预警：B 低于下限（软着陆区）标记，便于 UI 用 warning 令牌着色（不查表由 UI 决定） */
  readonly isLow: boolean;
}

export interface BudgetPanelDeps {
  readonly projection: BudgetProjection;
  /** 结余下限（低于即预警）；默认 0 */
  readonly lowThreshold?: number;
}

export function createBudgetPanel(deps: BudgetPanelDeps): BudgetPanel {
  const { projection, lowThreshold = 0 } = deps;
  return Object.freeze({
    I_t: projection.I_t,
    C_b: projection.C_b,
    C_m: projection.C_m,
    B: projection.B,
    isLow: projection.B < lowThreshold,
  });
}
