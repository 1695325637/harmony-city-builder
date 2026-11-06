/**
 * HC-01 · UI 层 · S-09 诊断查询（第一批 A 线 · 只读汇聚，绝不重算模拟）
 *
 * 权威口径：
 * - ADR-003 A4 / ADR-004 A2 / architecture §4.2：归因在结算时记录，诊断**查询时只读**，
 *   不重跑模拟、不重算通勤求解；同一份 Δ_t / 归因链供 UI、诊断、存档、回退复用。
 * - epic-breakdown §262 验收 ①（AC2）/ ③（D4 跨周期）/ ④（P4 分层、单屏 ≤1 面板）。
 * - ux-spec §4.3 固定四段 / L1-L2 互斥 / 禁止无来源通用提示 / 只读不写回。
 * - GDD 01 §4.3 下游约束（T-113 ① 耦合披露）/ §6.1 E1（T-113 ② 首 tick 教学）。
 * - GDD 05 §7：AC-I1（无来源不明通用提示）/ AC-I3（建议动词可达）/ AC-I7（只读汇聚）/ AC-I8（边缘不编造）。
 *
 * 本文件只 `import` 自 `./types.ts`（Zero-dependency 口径）：
 * 不 import 引擎、不 import `node:`、不 import 结算内核、不读时钟、不引入随机。
 * 唯一的输入是结构化只读端口 `DiagnosisSnapshotSource`，输出是冻结的只读 VM。
 *
 * 【ΔS 双口径限制 — 重要，不得省略】
 * `TickSnapshot.delta` 中 key='S' 的条目给出 **ΔS_abs（S 的绝对变化）**；
 * GDD 01 §3.2/§4.3 的 **ΔS（归因分解量 cur.dS）未随 TickSnapshot 显式承载**
 * （frames 类型为 unknown、DELTA 快照 frames 为 null，本层不解析序列化内部）。
 * 因此本层**无法**计算 GDD 的 `|ΔS_abs − ΔS|`。`discrepancy` 是「HUD 可见 S 变化」
 * 与「已记录归因之和」的差额，是**近似**判定，不等于二阶交叉项 100ΔMΔP，
 * 也不声称 ΔS_abs 与 ΔS 恒等。详见 `COUPLING_BASIS` 与 types.ts 头注释。
 */

import {
  ACTION_VERBS,
  ACTION_VERB_BY_CAUSE,
  COUPLING_THRESHOLD,
  DIAGNOSIS_LAYERS,
  FACTOR_LABELS,
  MAX_DETAIL_CARDS,
  MAX_FACTOR_ROWS,
  TUTORIAL_LABEL,
  VERB_LABELS,
} from './types.ts';
import type {
  ActionVerb,
  CouplingDisclosure,
  CycleRangeDiagnosis,
  CycleTickLink,
  DiagnosisAttributionEntry,
  DiagnosisDeltaEntry,
  DiagnosisDetailView,
  DiagnosisFactorView,
  DiagnosisLayer,
  DiagnosisSnapshotSource,
  DiagnosisSummary,
  DiagnosisTickSnapshot,
  DiagnosisViewModel,
  FactorRow,
  FourSegmentCard,
  TutorialCard,
} from './types.ts';

// ---------------------------------------------------------------------------
// 口径披露文本（集中一处，便于审计与回执引用）
// ---------------------------------------------------------------------------

/** 耦合披露的取值来源 + 近似限制（GDD 01 §4.3 / T-113 ①） */
export const COUPLING_BASIS =
  'ΔS_abs 取自 TickSnapshot.delta 中 key="S" 条目的 delta（终值−初值，权威 S 绝对变化，即 HUD 数字）；' +
  '归因之和取自 TickSnapshot.attribution 中带来源条目的 dS_i 之和（L2 最多展示 4 张卡，截断数见 overflowCount）。' +
  'GDD 01 §4.3 的 ΔS（归因分解量 cur.dS，即 clamp(ΣΔS_i + ΔS_penalty) 的结果）未随 TickSnapshot 显式承载：' +
  'frames 类型为 unknown 且 DELTA 快照 frames 为 null，本层不解析序列化内部，故无法计算 |ΔS_abs − ΔS|。' +
  'discrepancy 仅为「HUD 可见 S 变化」与「已记录归因之和」的差额，混合了 100ΔMΔP 二阶交叉项、' +
  'ΔS_penalty、attributionThreshold 过滤与 clamp 钳制，不等于 ΔS_abs − ΔS；披露判定为近似，' +
  '不声称二者恒等。本层同时无条件给出 S 绝对变化数值（GDD 01 §4.3 允许的另一种披露方式）。';

/** 首 tick 教学卡文案（GDD 01 §6.1 E1 / GDD 05 E1；不是「系统波动」类兜底提示） */
export const TUTORIAL_TEXT =
  '空城基线已建立：本 tick 为教学占位，不生成归因型议题。' +
  '满意度若变化请以 HUD 数值为准；下一 tick 起可查看具体原因。';

// ---------------------------------------------------------------------------
// 纯读辅助（无副作用、无时钟、无随机）
// ---------------------------------------------------------------------------

function finite(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** 只读查找 S 的差分条目（ΔS_abs 的权威载体） */
function findSDelta(delta: readonly DiagnosisDeltaEntry[]): DiagnosisDeltaEntry | null {
  for (let i = 0; i < delta.length; i++) {
    if (delta[i].key === 'S') return delta[i];
  }
  return null;
}

function hasSource(a: DiagnosisAttributionEntry): boolean {
  return a.refId.trim().length > 0;
}

function isTutorialAttribution(a: DiagnosisAttributionEntry): boolean {
  return a.causeType === '教学';
}

/** 确定性排序：|dS_i| 降序，同值按 factor / refId 字母序（GDD 05 E6 优先级，无随机） */
function byContributionDesc(a: FourSegmentCard, b: FourSegmentCard): number {
  const d = Math.abs(b.contribution) - Math.abs(a.contribution);
  if (d !== 0) return d;
  if (a.factor !== b.factor) return a.factor < b.factor ? -1 : 1;
  if (a.detail.refId !== b.detail.refId) return a.detail.refId < b.detail.refId ? -1 : 1;
  return 0;
}

function makeCard(a: DiagnosisAttributionEntry, onNonFinite: () => void): FourSegmentCard {
  const raw = a.dS_i;
  const contribution = finite(raw);
  if (contribution !== raw) onNonFinite();
  const actionVerb: ActionVerb | null = ACTION_VERB_BY_CAUSE[a.causeType] ?? null;
  const label = FACTOR_LABELS[a.primary_factor] ?? a.primary_factor;
  return Object.freeze({
    factor: a.primary_factor,
    factorLabel: label,
    contribution,
    contributionUnit: '分/tick' as const,
    detail: Object.freeze({
      causeType: a.causeType,
      refId: a.refId,
      text: a.detail,
    }),
    suggestedVerb: a.suggested_verb,
    actionVerb,
    verbLabel: actionVerb === null ? '' : VERB_LABELS[actionVerb],
    verbReachable: actionVerb !== null && ACTION_VERBS.indexOf(actionVerb) >= 0,
    hasSource: hasSource(a),
  });
}

function makeTutorialCard(candidates: readonly DiagnosisAttributionEntry[]): TutorialCard {
  const first = candidates.length > 0 ? candidates[0] : null;
  return Object.freeze({
    kind: 'TUTORIAL' as const,
    label: TUTORIAL_LABEL,
    explicitlyMarked: true as const,
    causeRefEmpty: first === null ? true : !hasSource(first),
    text: TUTORIAL_TEXT,
    suggestedVerb: first === null ? '' : first.suggested_verb,
    noAttributionDiagnosis: true as const,
  });
}

function makeCoupling(sAbsoluteChange: number, sBefore: number, sAfter: number, attributionSum: number): CouplingDisclosure {
  const discrepancy = Math.abs(sAbsoluteChange - attributionSum);
  // GDD 01 §4.3 下游约束的两个条件；因 ΔS 未承载，以「已记录归因之和」作近似代理。
  const disclosed =
    discrepancy > COUPLING_THRESHOLD ||
    (Math.abs(sAbsoluteChange) > COUPLING_THRESHOLD && Math.abs(attributionSum) <= COUPLING_THRESHOLD);
  const core =
    'S 绝对变化 ' + fmt(sAbsoluteChange) + ' 分（' + fmt(sBefore) + ' → ' + fmt(sAfter) + '），' +
    '已记录归因之和 ' + fmt(attributionSum) + ' 分/tick';
  const message = disclosed
    ? '本次变化含主项与短板同时变化的耦合（近似判定，见 basis）；' + core + '，差额 ' + fmt(discrepancy) + ' 分。'
    : core + '。';
  return Object.freeze({
    sBefore: finite(sBefore),
    sAfter: finite(sAfter),
    sAbsoluteChange: finite(sAbsoluteChange),
    attributionSum,
    discrepancy,
    threshold: COUPLING_THRESHOLD,
    disclosed,
    message,
    basis: COUPLING_BASIS,
    deltaSDecompositionCarried: false as const,
  });
}

// ---------------------------------------------------------------------------
// 单 tick 投影（queryDiagnosis / queryCycleRange 共用，保证同一份汇聚口径）
// ---------------------------------------------------------------------------

interface Projection {
  readonly l0: DiagnosisSummary;
  readonly l1: DiagnosisFactorView;
  readonly l2: DiagnosisDetailView;
  readonly tutorial: TutorialCard | null;
  readonly tutorialOnly: boolean;
  readonly traceable: boolean;
  readonly unsourcedSuppressed: number;
  readonly nonFiniteSuppressed: number;
  readonly allCards: readonly FourSegmentCard[];
  readonly refIds: readonly string[];
  readonly sAbsoluteChange: number;
}

function projectSnapshot(snap: DiagnosisTickSnapshot): Projection {
  const sDelta = findSDelta(snap.delta);
  const sBefore = sDelta === null ? 0 : finite(sDelta.old);
  const sAfter = sDelta === null ? 0 : finite(sDelta.new);
  const sAbsoluteChange = sDelta === null ? 0 : finite(sDelta.delta);

  const attributions = snap.attribution;
  const tutorialCandidates: DiagnosisAttributionEntry[] = [];
  const sourced: DiagnosisAttributionEntry[] = [];
  let unsourcedSuppressed = 0;
  for (let i = 0; i < attributions.length; i++) {
    const a = attributions[i];
    if (isTutorialAttribution(a)) {
      tutorialCandidates.push(a);
    } else if (!hasSource(a)) {
      // AC-I1 / 硬约束 2：无来源条目直接抑制，绝不生成「系统波动」类兜底文案。
      unsourcedSuppressed++;
    } else {
      sourced.push(a);
    }
  }

  let nonFiniteSuppressed = 0;
  const onNonFinite = (): void => {
    nonFiniteSuppressed++;
  };
  const sorted = sourced.map((a) => makeCard(a, onNonFinite)).slice().sort(byContributionDesc);
  const allCards: readonly FourSegmentCard[] = Object.freeze(sorted);

  // 面板可见归因之和 = 全部带来源条目的 dS_i 之和（截断前；L2 展示上限单独暴露）。
  let attributionSum = 0;
  for (let i = 0; i < allCards.length; i++) attributionSum += allCards[i].contribution;

  const cards = Object.freeze(allCards.slice(0, MAX_DETAIL_CARDS));
  const overflowCount = allCards.length - cards.length;
  const tutorialOnly = cards.length === 0;
  const tutorial = tutorialOnly ? makeTutorialCard(tutorialCandidates) : null;
  const coupling = makeCoupling(sAbsoluteChange, sBefore, sAfter, attributionSum);

  // AC2 可追溯性：≥1 具体原因，或本 tick 无显著变化，或 E1 首 tick 教学例外。
  const traceable =
    unsourcedSuppressed === 0 &&
    (cards.length > 0 || sAbsoluteChange === 0 || tutorialCandidates.length > 0);

  const direction: DiagnosisSummary['direction'] =
    sAbsoluteChange > 0 ? 'UP' : sAbsoluteChange < 0 ? 'DOWN' : 'FLAT';
  const dirText = direction === 'UP' ? '上升 ' + fmt(sAbsoluteChange) + ' 分'
    : direction === 'DOWN' ? '下降 ' + fmt(Math.abs(sAbsoluteChange)) + ' 分'
      : '持平';
  const headline = tutorialOnly
    ? '首 tick 教学：空城基线，暂无归因型诊断（' + TUTORIAL_LABEL + '卡）'
    : '满意度较上一 tick ' + dirText + '，主因 ' + cards[0].factorLabel;

  const l0: DiagnosisSummary = Object.freeze({
    headline,
    sAbsoluteChange,
    direction,
    cardCount: cards.length,
    tutorialOnly,
  });

  // L1：按因子聚合（≤4 行），按 |贡献量| 降序，主因优先。
  const bucket = new Map<string, number>();
  for (let i = 0; i < allCards.length; i++) {
    const c = allCards[i];
    bucket.set(c.factor, (bucket.get(c.factor) ?? 0) + c.contribution);
  }
  const rowsMutable: FactorRow[] = [];
  bucket.forEach((value, factor) => {
    rowsMutable.push(Object.freeze({
      factor,
      factorLabel: FACTOR_LABELS[factor] ?? factor,
      contribution: value,
      contributionUnit: '分/tick' as const,
    }));
  });
  rowsMutable.sort((a, b) => {
    const d = Math.abs(b.contribution) - Math.abs(a.contribution);
    if (d !== 0) return d;
    return a.factor < b.factor ? -1 : a.factor > b.factor ? 1 : 0;
  });
  const l1: DiagnosisFactorView = Object.freeze({ rows: Object.freeze(rowsMutable.slice(0, MAX_FACTOR_ROWS)) });

  const l2: DiagnosisDetailView = Object.freeze({ cards, overflowCount, tutorial, coupling });

  const refIds = Object.freeze(allCards.map((c) => c.detail.refId));

  return Object.freeze({
    l0,
    l1,
    l2,
    tutorial,
    tutorialOnly,
    traceable,
    unsourcedSuppressed,
    nonFiniteSuppressed,
    allCards,
    refIds,
    sAbsoluteChange,
  });
}

// ---------------------------------------------------------------------------
// 公开查询 ①：单 tick 诊断（AC2，只读、不重算、不卡顿）
// ---------------------------------------------------------------------------

/**
 * 从 `TickSnapshot.delta` + `attribution` **只读汇聚**四段诊断卡片与三层 VM。
 *
 * 只读保证：仅调用 `source.get(tickId)` 一次；不写回任何状态、不调用结算、
 * 不遍历网格、不读时钟。「不卡顿」由 O(归因条目数) 的单遍投影 + L2 卡上限保证。
 */
export function queryDiagnosis(source: DiagnosisSnapshotSource, tickId: number): DiagnosisViewModel {
  const snap = source.get(tickId);
  if (snap === null) {
    return emptyViewModel(tickId);
  }
  const p = projectSnapshot(snap);
  // 本地视图态：当前展开哪一层（单值 → 结构上保证同屏 ≤1 面板、L1/L2 互斥）。
  let active: DiagnosisLayer = 'L0';
  const vm: DiagnosisViewModel = {
    get found(): boolean {
      return true;
    },
    get tickId(): number {
      return snap.tickId;
    },
    get cycleId(): number {
      return snap.cycleId;
    },
    get cycleTickIndex(): number {
      return snap.cycleTickIndex;
    },
    get activeLayer(): DiagnosisLayer {
      return active;
    },
    get l0(): DiagnosisSummary {
      return p.l0;
    },
    get l1(): DiagnosisFactorView {
      return p.l1;
    },
    get l2(): DiagnosisDetailView {
      return p.l2;
    },
    get tutorial(): TutorialCard | null {
      return p.tutorial;
    },
    get tutorialOnly(): boolean {
      return p.tutorialOnly;
    },
    get traceable(): boolean {
      return p.traceable;
    },
    get unsourcedSuppressed(): number {
      return p.unsourcedSuppressed;
    },
    get nonFiniteSuppressed(): number {
      return p.nonFiniteSuppressed;
    },
    setLayer(next: DiagnosisLayer): void {
      if (DIAGNOSIS_LAYERS.indexOf(next) >= 0) active = next;
    },
  };
  return Object.freeze(vm);
}

function emptyViewModel(tickId: number): DiagnosisViewModel {
  const coupling = makeCoupling(0, 0, 0, 0);
  const tutorial = makeTutorialCard([]);
  const l0: DiagnosisSummary = Object.freeze({
    headline: '该 tick 无快照记录',
    sAbsoluteChange: 0,
    direction: 'FLAT',
    cardCount: 0,
    tutorialOnly: true,
  });
  const l1: DiagnosisFactorView = Object.freeze({ rows: Object.freeze([]) });
  const l2: DiagnosisDetailView = Object.freeze({
    cards: Object.freeze([]),
    overflowCount: 0,
    tutorial,
    coupling,
  });
  return Object.freeze({
    found: false,
    tickId,
    cycleId: -1,
    cycleTickIndex: -1,
    activeLayer: 'L0' as DiagnosisLayer,
    l0,
    l1,
    l2,
    tutorial,
    tutorialOnly: true,
    traceable: false,
    unsourcedSuppressed: 0,
    nonFiniteSuppressed: 0,
    setLayer(): void {
      /* 空 VM 无面板可展开：保持 L0 */
    },
  });
}

// ---------------------------------------------------------------------------
// 公开查询 ②：跨 2~3 周期完整归因链（S-09 验收 ③ / D4 滞后后果）
// ---------------------------------------------------------------------------

function tickOrder(a: DiagnosisTickSnapshot, b: DiagnosisTickSnapshot): number {
  if (a.cycleId !== b.cycleId) return a.cycleId - b.cycleId;
  if (a.cycleTickIndex !== b.cycleTickIndex) return a.cycleTickIndex - b.cycleTickIndex;
  return a.tickId - b.tickId;
}

/**
 * 返回 [fromCycleId, toCycleId] 内**每个 tick** 的完整归因链（有序、不丢 tick）。
 * 每个链节保留 `commandTrace` 与全部来源 `refId`，使 2~3 周期后才浮现的滞后后果
 * （如 `budget:I_f_lagged`）可回溯到早期命令——只搬运快照已记录的事实，不推导因果。
 *
 * 只读保证：仅调用 `source.getCycleRange(from, to)` 一次，不写回、不重算。
 */
export function queryCycleRange(
  source: DiagnosisSnapshotSource,
  fromCycleId: number,
  toCycleId: number,
): CycleRangeDiagnosis {
  const snaps = source.getCycleRange(fromCycleId, toCycleId);
  const ordered = snaps.slice().sort(tickOrder);

  const ticks: CycleTickLink[] = [];
  const cycleIdSet = new Set<number>();
  const laggedSet = new Set<string>();
  let attributionCount = 0;
  let cardsEmitted = 0;
  let unsourcedSuppressed = 0;
  let projected = 0;

  for (let i = 0; i < ordered.length; i++) {
    const snap = ordered[i];
    const p = projectSnapshot(snap);
    projected++;
    cycleIdSet.add(snap.cycleId);
    attributionCount += p.allCards.length;
    cardsEmitted += p.l2.cards.length;
    unsourcedSuppressed += p.unsourcedSuppressed;
    for (let j = 0; j < p.refIds.length; j++) {
      if (/lagged/i.test(p.refIds[j])) laggedSet.add(p.refIds[j]);
    }
    ticks.push(Object.freeze({
      tickId: snap.tickId,
      cycleId: snap.cycleId,
      cycleTickIndex: snap.cycleTickIndex,
      sAbsoluteChange: p.sAbsoluteChange,
      cards: p.l2.cards,
      tutorial: p.tutorial,
      coupling: p.l2.coupling,
      commandTrace: Object.freeze(snap.commandTrace.slice()),
      refIds: p.refIds,
    }));
  }

  const cycleIds = Object.freeze(Array.from(cycleIdSet).sort((a, b) => a - b));
  const laggedRefIds = Object.freeze(Array.from(laggedSet).sort());
  return Object.freeze({
    fromCycleId,
    toCycleId,
    cycleIds,
    ticks: Object.freeze(ticks),
    attributionCount,
    laggedRefIds,
    cardsEmitted,
    unsourcedSuppressed,
    // 空范围不算「完整归因链」；有 tick 时才要求全部投影成功且无来源缺失。
    complete: ticks.length > 0 && projected === snaps.length && unsourcedSuppressed === 0,
    deltaSDecompositionCarried: false as const,
  });
}
