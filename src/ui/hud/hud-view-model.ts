/**
 * HC-08 · UI 层 · HUD 只读视图模型（S-08 项 2：常驻 3 指标 / 议题 clamp 2~4 / 面板互斥）
 *
 * 权威口径（只读引用）：
 * - ux-spec §2.2 三段披露：常驻指标**固定 3 项**（满意度 / 预算结余 / 周期），
 *   人口 P_t / 岗位 J_t 不得进常驻（只能 L1 次级）；议题条 `clamp(2,4)`（3±1）；
 *   L1 次级面板与 L2 诊断面板**互斥**，同屏 ≤ 1。
 * - ADR-004 §2 子决策 2：UI 零写权威状态——本模型只组合读投影 + 本地面板态，
 *   **不持有可写 state**；`projectCityStateToHud` 只**读取** `CityState`（VM = 快照只读投影）。
 *
 * 硬断言（构造期即抛）：常驻指标数 ≤ 3、键 ∈ 钉定集合、绝不混入 `population/jobs`。
 * 这些断言把「人口 / 岗位不进常驻」做成**结构性**约束，而非靠注释（属 art AC-A01-3 互补）。
 */

import type { CityState } from '../../core/types.ts';
import type { Config } from '../../core/config.ts';
import {
  NON_RESIDENT_KEYS,
  RESIDENT_METRIC_KEYS,
  type HudIssue,
  type HudMetric,
  type HudProjection,
  type ResidentMetricKey,
} from './types.ts';

/** 默认议题条上下限（3±1） */
export const ISSUE_MIN = 2;
export const ISSUE_MAX = 4;

/** 面板槽位（L1 次级 / L2 诊断，互斥） */
export type HudPanelId = 'L1' | 'L2';
export type HudPanelState = HudPanelId | 'none';

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : Math.trunc(v);
}

/** 生成占位议题（真实议题规则留 S-05 / S-09；此处只保证数量与可读标题） */
function placeholderIssues(count: number): HudIssue[] {
  const out: HudIssue[] = [];
  for (let i = 0; i < count; i++) {
    out.push(Object.freeze({ id: 'issue-' + (i + 1), title: '议题' + (i + 1), severity: 'info' as const }));
  }
  return out;
}

/**
 * 从权威状态**只读**投影 HUD（VM = 快照只读投影，绝不写回）。
 * 只取 3 项钉定常驻指标 + 议题数量；人口 / 岗位不进此处（由上层放 L1）。
 */
export function projectCityStateToHud(
  state: Readonly<CityState>,
  config: Readonly<Config>,
  issues?: readonly HudIssue[],
): HudProjection {
  const S = state.frames.current.S;
  const B = state.budget.B;
  const periodRemaining = config.K - state.cycleTickIndex;
  const metrics: HudMetric[] = [
    Object.freeze({ key: 'satisfaction' as ResidentMetricKey, label: '满意度', value: S, format: 'score' }),
    Object.freeze({ key: 'budget' as ResidentMetricKey, label: '预算结余', value: B, format: 'currency' }),
    Object.freeze({ key: 'period' as ResidentMetricKey, label: '周期', value: periodRemaining, format: 'period' }),
  ];
  const issueList = issues ?? placeholderIssues(state.issueCount);
  return Object.freeze({
    metrics,
    issues: issueList,
    cycleId: state.cycleId,
    periodRemaining,
    periodLength: config.K,
  });
}

export interface HudViewModel {
  /** 常驻指标：**固定 3 项**（构造期已断言 ≤3 且键合法） */
  readonly residentMetrics: readonly HudMetric[];
  /** 议题条：clamp 到 [ISSUE_MIN, ISSUE_MAX]（3±1）后的展示数量 */
  readonly issueCount: number;
  readonly issues: readonly HudIssue[];
  readonly cycleId: number;
  readonly periodRemaining: number;
  readonly periodLength: number;
  /** 当前展开面板槽位（'L1' | 'L2' | 'none'） */
  readonly activePanel: HudPanelState;
  /** 展开面板（L1 / L2 互斥；传 'none' 收起），与 L1+L2 同屏互斥 */
  setPanel(next: HudPanelState): void;
}

export interface HudViewModelDeps {
  readonly projection: HudProjection;
  readonly maxIssues?: number;
  readonly minIssues?: number;
}

export function createHudViewModel(deps: HudViewModelDeps): HudViewModel {
  const { projection } = deps;
  const maxIssues = deps.maxIssues ?? ISSUE_MAX;
  const minIssues = deps.minIssues ?? ISSUE_MIN;

  // —— 硬断言：常驻指标结构纪律 ——
  if (projection.metrics.length > RESIDENT_METRIC_KEYS.length) {
    throw new Error(
      `HUD: 常驻指标数 ${projection.metrics.length} > 钉定上限 ${RESIDENT_METRIC_KEYS.length}（人口/岗位不得进常驻）`,
    );
  }
  for (const m of projection.metrics) {
    if (RESIDENT_METRIC_KEYS.indexOf(m.key) < 0) {
      throw new Error(`HUD: 常驻指标键「${m.key}」不在钉定集合 ${RESIDENT_METRIC_KEYS.join(',')}`);
    }
    if (NON_RESIDENT_KEYS.indexOf(m.key as never) >= 0) {
      throw new Error(`HUD: 禁止把「${m.key}」放进常驻（人口/岗位只能进 L1）`);
    }
  }

  // —— 议题条 clamp（3±1）——
  const displayCount = clampInt(projection.issues.length, minIssues, maxIssues);
  const displayedIssues = projection.issues.slice(0, displayCount);

  let activePanel: HudPanelState = 'none';

  const api: HudViewModel = {
    get residentMetrics(): readonly HudMetric[] {
      return projection.metrics;
    },
    get issueCount(): number {
      return displayCount;
    },
    get issues(): readonly HudIssue[] {
      return displayedIssues;
    },
    get cycleId(): number {
      return projection.cycleId;
    },
    get periodRemaining(): number {
      return projection.periodRemaining;
    },
    get periodLength(): number {
      return projection.periodLength;
    },
    get activePanel(): HudPanelState {
      return activePanel;
    },
    setPanel(next: HudPanelState): void {
      if (next === 'none') {
        activePanel = 'none';
        return;
      }
      // L1 / L2 互斥：展开新的即把旧的收起（同屏 ≤1）
      activePanel = next;
    },
  };
  return api;
}
