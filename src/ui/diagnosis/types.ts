/**
 * HC-01 · UI 层 · S-09 诊断数据层类型（第一批 A 线 · 只读查询 VM）
 *
 * 权威口径（只读引用，本文件不实现任何计算）：
 * - epic-breakdown §262 S-09 验收 ① / ④：任一显著 ΔS 可追溯 ≥1 条具体原因（AC2）；
 *   单屏 ≤1 数据面板 / 分层披露，不以密集数值表格作主交互面（P4）。
 * - ux-spec §4.3：诊断面板固定四段 = 主因因子 → 贡献量 ΔS_i[分/tick] → 明细 → 建议动词；
 *   L1 与 L2 面板互斥；cause_ref 为空时只允许 TUTORIAL 卡并明确标注；归因数据只读。
 * - GDD 01 §4.3 / §6.1 E1 / §7 AC-F2：耦合项数值披露 + 首 tick 教学式解释（T-113 两条下游约束）。
 * - GDD 05 §7：AC-I1 / AC-I3 / AC-I7 / AC-I8。
 * - ADR-003 A4 / ADR-004 A2：结算时记录归因，查询时只读、不重算模拟；UI 零写权威状态。
 *
 * 设计要点：
 * - 本层**不 import 模拟层实现**，而是自带结构化只读端口 `DiagnosisSnapshotSource`。
 *   真实 `SnapshotStore` 由结构化类型满足（编译期断言见 index.ts，仿 D-14）。
 * - VM 是**纯只读投影**：所有字段 readonly / 冻结；唯一的本地态是「当前展开哪一层」
 *   （单个枚举值，不是集合），与 HudViewModel.setPanel 同构，不触碰任何权威状态。
 * - 不产出密集表格：L0 = 一句话摘要 + 少量标量；L1 = ≤4 行因子；L2 = ≤4 张四段卡片；
 *   不存在任何二维数组 / rows / columns / matrix 结构。
 */

// ---------------------------------------------------------------------------
// 常量（口径参数，集中在此，便于测试与审计）
// ---------------------------------------------------------------------------

/** 分层披露：L0 摘要 / L1 因子 / L2 明细。单值 activeLayer 保证「一次只有一个面板」 */
export const DIAGNOSIS_LAYERS = ['L0', 'L1', 'L2'] as const;
export type DiagnosisLayer = (typeof DIAGNOSIS_LAYERS)[number];

/** 耦合披露阈值（分）：GDD 01 §4.3 下游约束 |ΔS_abs − ΔS| > 1 */
export const COUPLING_THRESHOLD = 1;
/** L1 因子行上限（四因子 f_c/f_s/f_e/f_f） */
export const MAX_FACTOR_ROWS = 4;
/** L2 明细卡上限（P4：不以密集数值表格作主交互面） */
export const MAX_DETAIL_CARDS = 4;
/** 教学卡显式标注文案（GDD 05 E1 / ux-spec §4.3） */
export const TUTORIAL_LABEL = '教学';

/**
 * 无归因卡（tutorialOnly）时的**事实分类**（D-16）。
 *
 * 背景：第一批 `headline` 在 tutorialOnly 时无条件自称「首 tick 教学」，
 * 但「非首 tick 且全部来源被抑制」也会进入该分支 → 标签与事实不符。
 * quality-lead T-136 登记为 S4 / D-16。
 *
 * 判据（只看只读快照事实，不推断、不编造）：
 * - `E1_FIRST_TICK`：冷启动首 tick（`tickId===0 && cycleId===0 && cycleTickIndex===0`，
 *   与 `tick-pipeline.ts` 的 `isFirstTick = s.tickId === 0` 同口径）且无来源抑制 →
 *   GDD 01 §6.1 E1 教学占位归因。
 * - `MISSING_SOURCE`：非首 tick，或存在被抑制的无来源条目 → 数据缺失，如实标注。
 * - `NO_SNAPSHOT`：`store.get(tickId) === null` → 该 tick 无快照记录。
 *
 * 注意：`教学` 占位归因由模拟层在**任意** `cur.dS===0` 的 tick 产生（非首 tick 也会有），
 * 因此「有教学条目」不能单独证明是首 tick，必须以 `tickId` 为准。
 */
export type DiagnosisEmptyReason = 'E1_FIRST_TICK' | 'MISSING_SOURCE' | 'NO_SNAPSHOT';

/** 建议动词：ux-spec §3.1 / §4.3 的三种一次点按可达操作 */
export type ActionVerb = 'V3' | 'V4' | 'V5';
export const ACTION_VERBS: readonly ActionVerb[] = Object.freeze(['V3', 'V4', 'V5']);

/** 主因因子可读标签（f_c / f_s / f_e / f_f，GDD 01 §4.2） */
export const FACTOR_LABELS: Readonly<Record<string, string>> = Object.freeze({
  f_c: '通勤便利',
  f_s: '服务覆盖',
  f_e: '环境负荷',
  f_f: '财政投入',
});

/**
 * causeType → 一次点按目标动词（ux-spec §3.1 动词映射 / §4.3 建议动词）。
 * 这是 **UX 层的动作可达性映射**，不改动也不推断归因数据本身：原始 suggested_verb
 * 在卡片里原样透传。未知 causeType → null（不编造动词，AC-I8）。
 */
export const ACTION_VERB_BY_CAUSE: Readonly<Record<string, ActionVerb | null>> = Object.freeze({
  通勤线: 'V5', // 连：铺路 / 改通勤
  覆盖片区: 'V3', // 划：分区 / 覆盖
  环境源: 'V3', // 划：产业与环境布局
  预算项: 'V4', // 拨：投入与维护费
  教学: null,
});

export const VERB_LABELS: Readonly<Record<ActionVerb, string>> = Object.freeze({
  V3: '划（分区）',
  V4: '拨（投入）',
  V5: '连（道路）',
});

// ---------------------------------------------------------------------------
// 只读端口（结构化类型：真实 SnapshotStore 由形状满足，无需 import 模拟层）
// ---------------------------------------------------------------------------

export interface DiagnosisDeltaEntry {
  readonly key: string;
  readonly old: number;
  readonly new: number;
  readonly delta: number;
}

export interface DiagnosisAttributionEntry {
  readonly primary_factor: string;
  readonly dS_i: number;
  readonly causeType: string;
  readonly refId: string;
  readonly contribution: number;
  readonly detail: string;
  readonly suggested_verb: string;
}

export interface DiagnosisTickSnapshot {
  readonly tickId: number;
  readonly cycleId: number;
  readonly cycleTickIndex: number;
  readonly delta: readonly DiagnosisDeltaEntry[];
  readonly attribution: readonly DiagnosisAttributionEntry[];
  readonly commandTrace: readonly string[];
}

/**
 * 诊断查询唯一可见的存储能力：两个**只读**方法。
 * 没有 put / submit / state 写入口（AC-I7 / ADR-004 §2 子决策 2）。
 */
export interface DiagnosisSnapshotSource {
  get(tickId: number): DiagnosisTickSnapshot | null;
  getCycleRange(fromCycleId: number, toCycleId: number): readonly DiagnosisTickSnapshot[];
}

// ---------------------------------------------------------------------------
// 四段卡片（ux-spec §4.3 固定四段）
// ---------------------------------------------------------------------------

/** 段 3 · 明细：哪条通勤线 / 哪片覆盖 / 哪笔投入 / 哪笔维护费 */
export interface CardDetail {
  readonly causeType: string;
  readonly refId: string;
  /** 快照 detail 原文（只读透传，不改写、不补充） */
  readonly text: string;
}

/** 一张诊断卡 = 主因因子 → 贡献量 → 明细 → 建议动词 */
export interface FourSegmentCard {
  readonly factor: string;
  readonly factorLabel: string;
  readonly contribution: number;
  readonly contributionUnit: '分/tick';
  readonly detail: CardDetail;
  /** 快照 suggested_verb 原值（原样透传，绝不改写） */
  readonly suggestedVerb: string;
  /** UX 映射后的一次点按目标；无法映射时为 null（不编造） */
  readonly actionVerb: ActionVerb | null;
  readonly verbLabel: string;
  readonly verbReachable: boolean;
  /** 来源非空（AC-I1：无来源的通用提示一律不进卡片） */
  readonly hasSource: boolean;
}

// ---------------------------------------------------------------------------
// 教学卡（T-113 ② / GDD 01 E1 / GDD 05 E1）
// ---------------------------------------------------------------------------

export interface TutorialCard {
  readonly kind: 'TUTORIAL';
  readonly label: typeof TUTORIAL_LABEL;
  /** 明确标注「教学」——cause_ref 为空时唯一允许的卡（ux-spec §4.3） */
  readonly explicitlyMarked: true;
  /** D-16：这张卡为什么出现（E1 首 tick / 数据缺失 / 无快照），文案按此分类 */
  readonly reason: DiagnosisEmptyReason;
  readonly causeRefEmpty: boolean;
  readonly text: string;
  readonly suggestedVerb: string;
  /** 不触发 V2 归因型诊断：即使 ΔS_abs ≠ 0 也不产出归因卡 */
  readonly noAttributionDiagnosis: true;
}

// ---------------------------------------------------------------------------
// 耦合披露（T-113 ① / GDD 01 §4.3 下游约束）
// ---------------------------------------------------------------------------

/**
 * ⚠️ ΔS 双口径限制（务必阅读）：
 * - `sAbsoluteChange` = ΔS_abs，取自 `TickSnapshot.delta` 中 key='S' 条目的 delta
 *   （= 终值 − 初值，权威的 S 绝对变化，正是 HUD 显示的数字）。
 * - GDD 01 §3.2/§4.3 的 `ΔS`（归因分解量 / `cur.dS`）**未随 TickSnapshot 显式承载**：
 *   `frames` 类型为 unknown，且 DELTA 快照的 frames 为 null；本层不解析序列化内部。
 * - 因此本层**无法计算** GDD 的 `|ΔS_abs − ΔS|`。`discrepancy` 是「HUD 可见 S 变化」
 *   与「面板可见归因之和（Σ 已记录条目的 dS_i）」的差额，混合了 100ΔMΔP 二阶交叉项、
 *   ΔS_penalty、attributionThreshold 过滤与 clamp 钳制，**不等于** ΔS_abs − ΔS。
 * - 披露判定是**近似**的；本层同时无条件给出 S 绝对变化数值（GDD 允许的另一种披露方式）。
 * - `deltaSDecompositionCarried` 恒为 false，用类型钉死「不得编造字段、不得声称二者恒等」。
 */
export interface CouplingDisclosure {
  readonly sBefore: number;
  readonly sAfter: number;
  /** ΔS_abs：S 的绝对变化（权威，来自 delta['S']） */
  readonly sAbsoluteChange: number;
  /** 面板可见归因之和：Σ 已记录 attribution 条目的 dS_i */
  readonly attributionSum: number;
  /** |ΔS_abs − attributionSum|（近似量，含义见上方限制说明） */
  readonly discrepancy: number;
  readonly threshold: number;
  readonly disclosed: boolean;
  readonly message: string;
  /** 取值来源 + 近似限制的完整披露 */
  readonly basis: string;
  readonly deltaSDecompositionCarried: false;
}

// ---------------------------------------------------------------------------
// 三层 VM（L0 摘要 / L1 因子 / L2 明细，互斥）
// ---------------------------------------------------------------------------

/** L0 · 一句话摘要 + 少量标量（不是表格） */
export interface DiagnosisSummary {
  readonly headline: string;
  readonly sAbsoluteChange: number;
  readonly direction: 'UP' | 'DOWN' | 'FLAT';
  readonly cardCount: number;
  readonly tutorialOnly: boolean;
  /** D-16：tutorialOnly 时的准确原因；有归因卡时为 null */
  readonly emptyReason: DiagnosisEmptyReason | null;
}

/** L1 · 因子行（≤ MAX_FACTOR_ROWS = 4） */
export interface FactorRow {
  readonly factor: string;
  readonly factorLabel: string;
  readonly contribution: number;
  readonly contributionUnit: '分/tick';
}
export interface DiagnosisFactorView {
  readonly rows: readonly FactorRow[];
}

/** L2 · 四段明细卡（≤ MAX_DETAIL_CARDS = 4） */
export interface DiagnosisDetailView {
  readonly cards: readonly FourSegmentCard[];
  readonly overflowCount: number;
  readonly tutorial: TutorialCard | null;
  readonly coupling: CouplingDisclosure;
}

/**
 * 诊断视图模型 = 快照只读投影 + 本地「当前展开层」单一枚举。
 * `activeLayer` 是**单值**（不是数组 / 集合）→ 结构上保证同屏 ≤1 数据面板、L1/L2 互斥。
 */
export interface DiagnosisViewModel {
  readonly found: boolean;
  readonly tickId: number;
  readonly cycleId: number;
  readonly cycleTickIndex: number;
  readonly activeLayer: DiagnosisLayer;
  readonly l0: DiagnosisSummary;
  readonly l1: DiagnosisFactorView;
  readonly l2: DiagnosisDetailView;
  readonly tutorial: TutorialCard | null;
  readonly tutorialOnly: boolean;
  /** D-16：tutorialOnly 时的准确原因；有归因卡时为 null */
  readonly emptyReason: DiagnosisEmptyReason | null;
  /** AC2：显著变化可追溯到 ≥1 条具体原因（教学首 tick 属 E1 例外） */
  readonly traceable: boolean;
  /** 无来源条目被抑制的数量（数据质量计数，机器可读；不是玩家兜底文案） */
  readonly unsourcedSuppressed: number;
  /** 非有限数值被抑制的数量（AC-I8 边缘健壮，不进入面板） */
  readonly nonFiniteSuppressed: number;
  /** 切换当前展开层：只改本地视图态，不改任何投影、不写权威状态 */
  setLayer(next: DiagnosisLayer): void;
}

// ---------------------------------------------------------------------------
// 跨周期完整归因链（S-09 验收 ③ / D4 滞后后果）
// ---------------------------------------------------------------------------

export interface CycleTickLink {
  readonly tickId: number;
  readonly cycleId: number;
  readonly cycleTickIndex: number;
  readonly sAbsoluteChange: number;
  readonly cards: readonly FourSegmentCard[];
  readonly tutorial: TutorialCard | null;
  readonly coupling: CouplingDisclosure;
  /** 命令溯源（原样透传，供滞后后果复盘） */
  readonly commandTrace: readonly string[];
  /** 本 tick 全部来源 refId（含被上限截断的卡片，保证链完整） */
  readonly refIds: readonly string[];
}

export interface CycleRangeDiagnosis {
  readonly fromCycleId: number;
  readonly toCycleId: number;
  /** 实际覆盖到的周期号（有序去重） */
  readonly cycleIds: readonly number[];
  /** 按 (cycleId, cycleTickIndex, tickId) 排序的完整 tick 链；不丢任何 tick */
  readonly ticks: readonly CycleTickLink[];
  /** 链上有来源的归因条目总数（截断前的真实计数） */
  readonly attributionCount: number;
  /** 含 lagged 标记的 refId（来自快照，非本层推导的因果关系） */
  readonly laggedRefIds: readonly string[];
  readonly cardsEmitted: number;
  readonly unsourcedSuppressed: number;
  /** 所有 tick 均成功投影且无来源缺失丢失 */
  readonly complete: boolean;
  readonly deltaSDecompositionCarried: false;
}
