/**
 * DG-01 · S-09 第一批 A 线 · 诊断查询单测（AC2 / 四段 / 分层 / 只读 / 耦合 / 首 tick）
 *
 * 钉定：
 * - AC2：任一显著 ΔS 可追溯 ≥1 条具体原因；查询只读、不重算、不写回。
 * - ux-spec §4.3 固定四段 + L1/L2 互斥 + 禁止无来源通用提示（AC-I1 / AC-I8）。
 * - AC-I3 建议动词一次点按可达；AC-I7 只读汇聚（快照逐字节一致）。
 * - T-113 ① 耦合项数值披露 / ② 首 tick 教学式解释（GDD 01 §4.3 / §6.1 E1）。
 *
 * 测试夹具为**结构化假端口**（不跑结算内核），另含一条用真实
 * `createInMemorySnapshotStore()` 的端到端只读证据。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_VERBS,
  COUPLING_THRESHOLD,
  MAX_DETAIL_CARDS,
  MAX_FACTOR_ROWS,
  TUTORIAL_LABEL,
  TUTORIAL_TEXT_E1,
  TUTORIAL_TEXT_MISSING_SOURCE,
  TUTORIAL_TEXT_NO_SNAPSHOT,
  queryDiagnosis,
  queryCycleRange,
  type DiagnosisAttributionEntry,
  type DiagnosisDeltaEntry,
  type DiagnosisSnapshotSource,
  type DiagnosisTickSnapshot,
} from '../../src/ui/diagnosis/index.ts';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function sDelta(oldV: number, newV: number): DiagnosisDeltaEntry {
  return { key: 'S', old: oldV, new: newV, delta: newV - oldV };
}

function attr(over: Partial<DiagnosisAttributionEntry> = {}): DiagnosisAttributionEntry {
  return {
    primary_factor: 'f_c',
    dS_i: -2.4,
    causeType: '通勤线',
    refId: 'traffic:T_c',
    contribution: -2.4,
    detail: '通勤线 T_c 行程时间上升',
    suggested_verb: 'V8',
    ...over,
  };
}

interface SnapArgs {
  tickId: number;
  cycleId?: number;
  cycleTickIndex?: number;
  sOld?: number;
  sNew?: number;
  delta?: readonly DiagnosisDeltaEntry[];
  attribution?: readonly DiagnosisAttributionEntry[];
  commandTrace?: readonly string[];
}

function mkSnap(a: SnapArgs): DiagnosisTickSnapshot {
  const sOld = a.sOld ?? 60;
  const sNew = a.sNew ?? 57.6;
  return {
    tickId: a.tickId,
    cycleId: a.cycleId ?? 0,
    cycleTickIndex: a.cycleTickIndex ?? a.tickId,
    delta: a.delta ?? [sDelta(sOld, sNew)],
    attribution: a.attribution ?? [attr()],
    commandTrace: a.commandTrace ?? ['v-zone-1'],
  };
}

interface SpySource extends DiagnosisSnapshotSource {
  readonly getCalls: number;
  readonly rangeCalls: number;
  readonly snapshots: readonly DiagnosisTickSnapshot[];
}

function makeSource(snapshots: readonly DiagnosisTickSnapshot[]): SpySource {
  let getCalls = 0;
  let rangeCalls = 0;
  return {
    snapshots,
    get(tickId: number): DiagnosisTickSnapshot | null {
      getCalls++;
      for (let i = 0; i < snapshots.length; i++) if (snapshots[i].tickId === tickId) return snapshots[i];
      return null;
    },
    getCycleRange(fromCycleId: number, toCycleId: number): readonly DiagnosisTickSnapshot[] {
      rangeCalls++;
      return snapshots.filter((s) => s.cycleId >= fromCycleId && s.cycleId <= toCycleId);
    },
    get getCalls(): number {
      return getCalls;
    },
    get rangeCalls(): number {
      return rangeCalls;
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const k of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[k]);
    }
    Object.freeze(value);
  }
  return value;
}

/** 收集 VM 中所有字符串，用于「无兜底文案」断言 */
function allStrings(o: unknown, out: string[] = []): string[] {
  if (typeof o === 'string') out.push(o);
  else if (o !== null && typeof o === 'object') {
    for (const k of Object.keys(o as object)) allStrings((o as Record<string, unknown>)[k], out);
  }
  return out;
}

const GENERIC_HINTS = ['系统波动', '未知原因', '来源不明', '暂无说明', 'N/A', '综合因素'];

/** 浮点容差断言（57.6 − 60 在 IEEE754 下不是精确 −2.4） */
function near(actual: number, expected: number, msg?: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, (msg ?? 'near') + ': ' + actual + ' vs ' + expected);
}

// ---------------------------------------------------------------------------
// AC2 / 四段卡片（ux-spec §4.3）
// ---------------------------------------------------------------------------

test('DQ-1 AC2：显著 ΔS → ≥1 条具体原因，四段齐备且来源非空', () => {
  const src = makeSource([mkSnap({ tickId: 1, sOld: 60, sNew: 57.6 })]);
  const vm = queryDiagnosis(src, 1);
  assert.equal(vm.found, true);
  assert.equal(vm.traceable, true, '显著变化必须可追溯');
  assert.ok(vm.l2.cards.length >= 1, '至少 1 条具体原因（AC2）');
  const c = vm.l2.cards[0];
  assert.equal(c.factor, 'f_c', '段 1 主因因子');
  assert.ok(c.factorLabel.length > 1, '因子须有可读标签');
  assert.equal(c.contribution, -2.4, '段 2 贡献量 ΔS_i');
  assert.equal(c.contributionUnit, '分/tick');
  assert.equal(c.detail.causeType, '通勤线', '段 3 明细：哪条通勤线');
  assert.equal(c.detail.refId, 'traffic:T_c', '段 3 明细绑定具体来源');
  assert.ok(c.detail.text.length > 1);
  assert.equal(c.hasSource, true);
  assert.equal(c.suggestedVerb, 'V8', '段 4 原始动词原样透传，不改写');
  assert.notEqual(c.actionVerb, null, '段 4 一次点按目标');
  assert.equal(c.verbReachable, true);
});

test('DQ-2 ΔS_abs 取自 delta[\'S\']，方向 / 前后值正确', () => {
  const src = makeSource([mkSnap({ tickId: 2, sOld: 60, sNew: 57.6 })]);
  const vm = queryDiagnosis(src, 2);
  const cp = vm.l2.coupling;
  assert.equal(cp.sBefore, 60);
  near(cp.sAfter, 57.6, 'sAfter');
  near(cp.sAbsoluteChange, -2.4, 'sAbsoluteChange');
  near(vm.l0.sAbsoluteChange, -2.4, 'l0.sAbsoluteChange');
  assert.equal(vm.l0.direction, 'DOWN');
  assert.equal(queryDiagnosis(makeSource([mkSnap({ tickId: 3, sOld: 50, sNew: 52 })]), 3).l0.direction, 'UP');
  assert.equal(queryDiagnosis(makeSource([mkSnap({ tickId: 4, sOld: 50, sNew: 50 })]), 4).l0.direction, 'FLAT');
});

test('DQ-3 卡片按 |ΔS_i| 降序（主因优先，GDD 05 E6），非密集表格且有上限', () => {
  const attributions = [
    attr({ primary_factor: 'f_s', causeType: '覆盖片区', refId: 'coverage:zone-3', dS_i: -0.4 }),
    attr({ primary_factor: 'f_f', causeType: '预算项', refId: 'budget:I_f_lagged', dS_i: -3.1 }),
    attr({ primary_factor: 'f_e', causeType: '环境源', refId: 'env:industry-2', dS_i: 1.2 }),
    attr({ primary_factor: 'f_c', causeType: '通勤线', refId: 'traffic:t_g', dS_i: 0.9 }),
  ];
  const vm = queryDiagnosis(makeSource([mkSnap({ tickId: 5, attribution: attributions })]), 5);
  const cards = vm.l2.cards;
  assert.equal(cards.length, 4);
  assert.deepEqual(cards.map((c) => c.factor), ['f_f', 'f_e', 'f_c', 'f_s']);
  assert.ok(vm.l2.overflowCount === 0);
  assert.ok(cards.length <= MAX_DETAIL_CARDS, 'L2 卡片有上限（P4 不铺表格）');
  assert.ok(vm.l1.rows.length <= MAX_FACTOR_ROWS, 'L1 因子行有上限');
});

test('DQ-4 超出上限的卡片被截断并计数，但不丢来源（链完整）', () => {
  const many: DiagnosisAttributionEntry[] = [];
  for (let i = 0; i < 7; i++) {
    many.push(attr({ refId: 'traffic:seg-' + i, dS_i: -(i + 1) * 0.5 }));
  }
  const vm = queryDiagnosis(makeSource([mkSnap({ tickId: 6, attribution: many })]), 6);
  assert.equal(vm.l2.cards.length, MAX_DETAIL_CARDS);
  assert.equal(vm.l2.overflowCount, 7 - MAX_DETAIL_CARDS);
  // 归因之和仍按全部带来源条目计算（截断前）
  near(vm.l2.coupling.attributionSum, -14, 'attributionSum');
});

// ---------------------------------------------------------------------------
// 分层披露 / 面板互斥（P4 / ux-spec §2.2 §4.3）
// ---------------------------------------------------------------------------

test('DQ-5 三层齐备，activeLayer 为单值且可切换（同屏 ≤1 面板，L1/L2 互斥）', () => {
  const vm = queryDiagnosis(makeSource([mkSnap({ tickId: 7 })]), 7);
  assert.ok(vm.l0 && vm.l1 && vm.l2, 'L0 摘要 / L1 因子 / L2 明细三层齐备');
  assert.equal(vm.activeLayer, 'L0');
  assert.equal(typeof vm.l0.headline, 'string', 'L0 是一句话摘要，不是数值表格');
  assert.ok(vm.l0.headline.length > 1);
  vm.setLayer('L1');
  assert.equal(vm.activeLayer, 'L1');
  vm.setLayer('L2');
  assert.equal(vm.activeLayer, 'L2', '展开 L2 时 L1 已收起（互斥）');
  vm.setLayer('L0');
  assert.equal(vm.activeLayer, 'L0');
  // 结构上不存在「多个同时展开的面板」集合
  assert.equal(Object.prototype.hasOwnProperty.call(vm, 'openPanels'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(vm, 'activeLayers'), false);
});

test('DQ-6 非法层被忽略；setLayer 不改动任何只读投影', () => {
  const vm = queryDiagnosis(makeSource([mkSnap({ tickId: 8 })]), 8);
  const before = JSON.stringify({ l0: vm.l0, l1: vm.l1, l2: vm.l2 });
  vm.setLayer('L9' as never);
  assert.equal(vm.activeLayer, 'L0');
  vm.setLayer('L2');
  assert.equal(vm.activeLayer, 'L2');
  assert.equal(JSON.stringify({ l0: vm.l0, l1: vm.l1, l2: vm.l2 }), before, '投影保持只读不变');
});

test('DQ-7 VM 无二维数组 / 无 rows[][]，不以密集数值表格作主交互面', () => {
  const vm = queryDiagnosis(makeSource([mkSnap({ tickId: 9 })]), 9);
  const json = vm as unknown as Record<string, unknown>;
  function has2D(o: unknown): boolean {
    if (Array.isArray(o)) {
      if (o.some((x) => Array.isArray(x))) return true;
      return o.some(has2D);
    }
    if (o !== null && typeof o === 'object') return Object.values(o as object).some(has2D);
    return false;
  }
  assert.equal(has2D(json), false);
  assert.equal(Object.prototype.hasOwnProperty.call(vm, 'table'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(vm, 'matrix'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(vm, 'columns'), false);
});

// ---------------------------------------------------------------------------
// AC-I1 禁止无来源通用提示 / AC-I8 边缘不编造
// ---------------------------------------------------------------------------

test('DQ-8 AC-I1：refId 为空的非教学归因被抑制，不产出任何兜底文案', () => {
  const attributions = [
    attr({ refId: '', detail: '', dS_i: -1.5 }),
    attr({ refId: 'traffic:T_c', dS_i: -2.0 }),
  ];
  const vm = queryDiagnosis(makeSource([mkSnap({ tickId: 10, attribution: attributions })]), 10);
  assert.equal(vm.unsourcedSuppressed, 1);
  assert.equal(vm.l2.cards.length, 1, '只保留带来源的卡片');
  assert.ok(vm.l2.cards.every((c) => c.hasSource && c.detail.refId.length > 0));
  const strings = allStrings(vm).join('|');
  for (const hint of GENERIC_HINTS) assert.equal(strings.includes(hint), false, '不得出现兜底文案：' + hint);
});

test('DQ-9 AC-I1/D-16：非首 tick（tickId=11）全部无来源 → MISSING_SOURCE，traceable=false，绝不编造归因', () => {
  const attributions = [attr({ refId: '', dS_i: -5 })];
  const vm = queryDiagnosis(makeSource([mkSnap({ tickId: 11, sOld: 60, sNew: 55, attribution: attributions })]), 11);
  assert.equal(vm.l2.cards.length, 0);
  assert.notEqual(vm.tutorial, null);
  assert.equal(vm.tutorial!.explicitlyMarked, true);
  assert.equal(vm.tutorial!.label, TUTORIAL_LABEL);
  assert.equal(vm.traceable, false, '有数据缺口时如实标记不可追溯（D-16 不动数据诚实性）');
  assert.equal(vm.unsourcedSuppressed, 1, '来源缺失计数如实');
  // D-16 核心：非首 tick 不得自称「首 tick 教学」
  assert.equal(vm.emptyReason, 'MISSING_SOURCE');
  assert.equal(vm.tutorial!.reason, 'MISSING_SOURCE');
  assert.equal(vm.l0.emptyReason, 'MISSING_SOURCE');
  assert.equal(vm.l0.headline.includes('首 tick'), false, '文案标签不得与事实不符');
  assert.ok(vm.l0.headline.includes('数据缺失'));
  assert.equal(vm.tutorial!.text, TUTORIAL_TEXT_MISSING_SOURCE);
  // 数据诚实性全部保持
  assert.equal(vm.l2.coupling.deltaSDecompositionCarried, false);
  assert.ok(vm.l2.coupling.message.includes('-5'), '仍无条件给出 S 绝对变化数值');
  const strings = allStrings(vm).join('|');
  for (const hint of GENERIC_HINTS) assert.equal(strings.includes(hint), false);
});

test('DQ-10 快照缺失 → found=false / NO_SNAPSHOT，不编造归因 / 不崩溃', () => {
  const vm = queryDiagnosis(makeSource([]), 999);
  assert.equal(vm.found, false);
  assert.equal(vm.l2.cards.length, 0);
  assert.equal(vm.traceable, false);
  assert.equal(vm.l0.headline, '该 tick 无快照记录');
  assert.notEqual(vm.tutorial, null);
  assert.equal(vm.emptyReason, 'NO_SNAPSHOT', 'D-16：第三种事实分类');
  assert.equal(vm.tutorial!.reason, 'NO_SNAPSHOT');
  assert.equal(vm.tutorial!.text, TUTORIAL_TEXT_NO_SNAPSHOT);
  vm.setLayer('L2');
  assert.equal(vm.activeLayer, 'L0', '空 VM 无面板可展开');
});

test('DQ-11 AC-I8：空 delta / 空 attribution / 非有限数值不崩溃且不进面板', () => {
  const vm1 = queryDiagnosis(makeSource([mkSnap({ tickId: 12, delta: [], attribution: [] })]), 12);
  assert.equal(vm1.l2.coupling.sAbsoluteChange, 0);
  assert.equal(vm1.l2.cards.length, 0);
  assert.notEqual(vm1.tutorial, null);

  const vm2 = queryDiagnosis(
    makeSource([mkSnap({ tickId: 13, sOld: Number.NaN, sNew: 58, attribution: [attr({ dS_i: Number.POSITIVE_INFINITY })] })]),
    13,
  );
  assert.equal(vm2.nonFiniteSuppressed, 1);
  assert.equal(Number.isFinite(vm2.l2.cards[0].contribution), true);
  assert.equal(Number.isFinite(vm2.l2.coupling.sBefore), true);
  const strings = allStrings(vm2).join('|');
  assert.equal(strings.includes('NaN'), false);
  assert.equal(strings.includes('Infinity'), false);
});

// ---------------------------------------------------------------------------
// AC-I3 建议动词一次点按可达
// ---------------------------------------------------------------------------

test('DQ-12 AC-I3：四类 causeType 均映射到 V3/V4/V5 且可达；未知类型不编造', () => {
  const cases: Array<[string, string]> = [
    ['通勤线', 'V5'],
    ['覆盖片区', 'V3'],
    ['环境源', 'V3'],
    ['预算项', 'V4'],
  ];
  for (const [causeType, verb] of cases) {
    const vm = queryDiagnosis(
      makeSource([mkSnap({ tickId: 20, attribution: [attr({ causeType, refId: 'ref:' + causeType })] })]),
      20,
    );
    const c = vm.l2.cards[0];
    assert.equal(c.actionVerb, verb, causeType + ' → ' + verb);
    assert.equal(c.verbReachable, true);
    assert.ok(ACTION_VERBS.indexOf(c.actionVerb!) >= 0);
    assert.ok(c.verbLabel.length > 1);
  }
  const unknown = queryDiagnosis(
    makeSource([mkSnap({ tickId: 21, attribution: [attr({ causeType: '未知类别', refId: 'ref:x' })] })]),
    21,
  );
  assert.equal(unknown.l2.cards[0].actionVerb, null, '未知 causeType 不编造动词');
  assert.equal(unknown.l2.cards[0].verbReachable, false);
  assert.equal(unknown.l2.cards[0].suggestedVerb, 'V8', '原始值仍原样透传');
});

// ---------------------------------------------------------------------------
// T-113 ② 首 tick 教学式解释（GDD 01 §6.1 E1 / GDD 05 E1）
// ---------------------------------------------------------------------------

const COLD_START = [{ ...attr({ causeType: '教学', refId: 'tutorial:baseline', dS_i: 0, contribution: 0, detail: 'cold-start baseline', suggested_verb: 'V1' }) }];

test('DQ-13 T-113②/D-16：真首 tick（tickId=0）ΔS_abs ≠ 0 仍不触发 V2 归因型诊断，只给 E1 教学占位归因', () => {
  // E1：ΔS=0 / dSByFactor 全 0；S_t 照算，ΔS_abs = S_t − S_{−1} ≠ 0 允许。
  // D-16：夹具必须是真首 tick（与 tick-pipeline.ts 的 isFirstTick = s.tickId === 0 同口径）。
  const vm = queryDiagnosis(
    makeSource([mkSnap({ tickId: 0, cycleId: 0, cycleTickIndex: 0, sOld: 50, sNew: 52, attribution: COLD_START })]),
    0,
  );
  assert.equal(vm.tutorialOnly, true);
  assert.equal(vm.l2.cards.length, 0, '不生成归因型诊断卡片');
  assert.notEqual(vm.tutorial, null);
  assert.equal(vm.tutorial!.kind, 'TUTORIAL');
  assert.equal(vm.tutorial!.label, TUTORIAL_LABEL);
  assert.equal(vm.tutorial!.explicitlyMarked, true, '明确标注「教学」');
  assert.equal(vm.tutorial!.noAttributionDiagnosis, true);
  assert.equal(vm.l2.coupling.sAbsoluteChange, 2, 'ΔS_abs ≠ 0 被如实记录');
  assert.equal(vm.traceable, true, 'E1 例外：教学占位即视为已处理');
  assert.ok(vm.l0.headline.includes(TUTORIAL_LABEL));
  assert.equal(vm.emptyReason, 'E1_FIRST_TICK', 'D-16：真首 tick 才标 E1');
  assert.equal(vm.tutorial!.reason, 'E1_FIRST_TICK');
  assert.ok(vm.l0.headline.includes('首 tick'), 'E1 文案自称首 tick 属实');
  assert.equal(vm.tutorial!.text, TUTORIAL_TEXT_E1);
});

test('DQ-14 T-113②/D-16：真首 tick ΔS_abs = 0 亦为 E1 教学卡；空 cause_ref 明确标注', () => {
  const emptyRef = [{ ...attr({ causeType: '教学', refId: '', dS_i: 0, detail: '', suggested_verb: 'V1' }) }];
  const vm1 = queryDiagnosis(
    makeSource([mkSnap({ tickId: 0, cycleId: 0, cycleTickIndex: 0, sOld: 50, sNew: 50, attribution: emptyRef })]),
    0,
  );
  assert.equal(vm1.tutorial!.causeRefEmpty, true);
  assert.equal(vm1.tutorial!.explicitlyMarked, true);
  assert.equal(vm1.tutorialOnly, true);
  assert.equal(vm1.emptyReason, 'E1_FIRST_TICK');

  const vm2 = queryDiagnosis(
    makeSource([mkSnap({ tickId: 0, cycleId: 0, cycleTickIndex: 0, sOld: 50, sNew: 50, attribution: [] })]),
    0,
  );
  assert.equal(vm2.tutorialOnly, true);
  assert.equal(vm2.tutorial!.causeRefEmpty, true);
  assert.equal(vm2.l2.cards.length, 0, '空归因链绝不编造归因（AC-I8）');
  assert.equal(vm2.emptyReason, 'E1_FIRST_TICK', 'GDD 05 E1 允许首 tick 归因链为空仍给 TUTORIAL 卡');
});

test('DQ-15 教学卡全局无「系统波动」类兜底文案；教学条目不计入具体原因', () => {
  const vm = queryDiagnosis(makeSource([mkSnap({ tickId: 0, cycleId: 0, cycleTickIndex: 0, attribution: COLD_START })]), 0);
  const strings = allStrings(vm).join('|');
  for (const hint of GENERIC_HINTS) assert.equal(strings.includes(hint), false);
  assert.equal(vm.l0.cardCount, 0);
  assert.equal(vm.l1.rows.length, 0, '教学 tick 不产出因子数值表');
});

// ---------------------------------------------------------------------------
// T-113 ① 耦合项数值披露（GDD 01 §4.3 下游约束）
// ---------------------------------------------------------------------------

test('DQ-16 T-113① 条件 A：|ΔS_abs − 归因之和| > 1 分 → 显式耦合披露', () => {
  // ΔS_abs = −2.8，已记录归因之和 = −1.0 → 差额 1.8 > 1
  const vm = queryDiagnosis(
    makeSource([mkSnap({ tickId: 40, sOld: 60, sNew: 57.2, attribution: [attr({ dS_i: -1.0 })] })]),
    40,
  );
  const cp = vm.l2.coupling;
  near(cp.discrepancy, 1.8, 'discrepancy');
  assert.equal(cp.disclosed, true);
  assert.ok(cp.message.includes('耦合'), '须显式说明「主项与短板同时变化的耦合」');
  assert.ok(cp.message.includes('-2.8'), '同时给出 S 的绝对变化数值');
  assert.equal(cp.threshold, COUPLING_THRESHOLD);
});

test('DQ-17 T-113① 条件 B：|ΔS_abs| > 1 而 |归因之和| ≤ 1 → 亦须披露', () => {
  // ΔS_abs = −3，归因之和 = 0.5 → 差额 3.5 > 1（同时命中两条件）
  const vm = queryDiagnosis(
    makeSource([mkSnap({ tickId: 41, sOld: 60, sNew: 57, attribution: [attr({ dS_i: 0.5 })] })]),
    41,
  );
  assert.equal(vm.l2.coupling.disclosed, true);
  // 单独命中条件 B 而差额 ≤ 1 的情形：ΔS_abs = −1.2，和 = −0.4 → 差额 0.8 ≤ 1
  const vm2 = queryDiagnosis(
    makeSource([mkSnap({ tickId: 42, sOld: 60, sNew: 58.8, attribution: [attr({ dS_i: -0.4 })] })]),
    42,
  );
  near(vm2.l2.coupling.discrepancy, 0.8, 'discrepancy');
  assert.equal(vm2.l2.coupling.disclosed, true, '|ΔS_abs|>1 且 |和|≤1 单独触发');
});

test('DQ-18 差额 ≤1 且无显著变化 → 不披露，但仍无条件给出 S 绝对变化数值', () => {
  const vm = queryDiagnosis(
    makeSource([mkSnap({ tickId: 43, sOld: 60, sNew: 59.7, attribution: [attr({ dS_i: -0.3 })] })]),
    43,
  );
  const cp = vm.l2.coupling;
  near(cp.discrepancy, 0, 'discrepancy');
  assert.equal(cp.disclosed, false);
  assert.ok(cp.message.includes('-0.3'), 'S 绝对变化数值始终可见');
  assert.ok(!cp.message.includes('耦合'));
});

test('DQ-19 ΔS 双口径限制如实披露：不编造字段、不声称二者恒等', () => {
  const vm = queryDiagnosis(
    makeSource([mkSnap({ tickId: 44, sOld: 60, sNew: 56, attribution: [attr({ dS_i: -1 })] })]),
    44,
  );
  const cp = vm.l2.coupling;
  assert.equal(cp.deltaSDecompositionCarried, false, '恒 false：快照未承载 cur.dS');
  assert.ok(cp.basis.includes('未随 TickSnapshot 显式承载'), '披露缺失');
  assert.ok(cp.basis.includes('不等于 ΔS_abs − ΔS'), '披露近似差额不等价于二阶交叉项');
  assert.ok(cp.basis.includes('不声称二者恒等'));
  assert.ok(cp.basis.includes('100ΔMΔP'));
  // VM 上不存在伪造的 dS / cur.dS 字段
  const json = JSON.stringify(vm);
  assert.equal(json.includes('"cur.dS"'), false);
  assert.equal(json.includes('"dS"'), false);
});

// ---------------------------------------------------------------------------
// AC-I7 只读汇聚 / 不重算 / 不卡顿
// ---------------------------------------------------------------------------

test('DQ-20 AC-I7：查询前后 store.get(tickId) 快照逐字节一致（深度冻结亦不抛）', () => {
  const snap = deepFreeze(mkSnap({ tickId: 50 }));
  const src = makeSource([snap]);
  const before = JSON.stringify(src.get(50));
  const vm = queryDiagnosis(src, 50);
  assert.equal(vm.found, true);
  assert.equal(JSON.stringify(src.get(50)), before, '快照逐字节一致');
  assert.equal(src.get(50), snap, '同一对象引用，未被替换');
});

test('DQ-21 查询只调用 get 一次、不调用 getCycleRange（不重算、无 N+1）', () => {
  const src = makeSource([mkSnap({ tickId: 51 })]);
  queryDiagnosis(src, 51);
  assert.equal(src.getCalls, 1);
  assert.equal(src.rangeCalls, 0);
});

test('DQ-22 VM 与卡片均冻结，无任何写回入口', () => {
  const vm = queryDiagnosis(makeSource([mkSnap({ tickId: 52 })]), 52);
  assert.equal(Object.isFrozen(vm), true);
  assert.equal(Object.isFrozen(vm.l2), true);
  assert.equal(Object.isFrozen(vm.l2.cards), true);
  assert.equal(Object.isFrozen(vm.l2.cards[0]), true);
  for (const k of ['put', 'submit', 'write', 'setState', 'advanceDay', 'runTick']) {
    assert.equal(Object.prototype.hasOwnProperty.call(vm, k), false, 'VM 不得暴露 ' + k);
  }
});

test('DQ-23 确定性：同一输入重复查询结果逐字节一致（无随机 / 无时钟）', () => {
  const src = makeSource([mkSnap({ tickId: 53, attribution: [
    attr({ primary_factor: 'f_f', causeType: '预算项', refId: 'budget:I_f_lagged', dS_i: -3.1 }),
    attr({ primary_factor: 'f_c', causeType: '通勤线', refId: 'traffic:T_c', dS_i: -0.9 }),
  ] })]);
  assert.equal(JSON.stringify(queryDiagnosis(src, 53)), JSON.stringify(queryDiagnosis(src, 53)));
});

test('DQ-24 真实 SnapshotStore 端到端：结构化端口满足 + 查询前后快照逐字节一致（AC-I7）', async () => {
  // 用真实内存冷归档（只读引用，不修改 simulation/**），验证 barrel 里的
  // 编译期端口断言在运行期也成立，且查询对真实存储零写入。
  const { createInMemorySnapshotStore } = await import('../../src/simulation/snapshot.ts');
  const store = createInMemorySnapshotStore();
  const realSnapshot = {
    tickId: 60,
    cycleId: 0,
    cycleTickIndex: 1,
    schemaVersion: 'v1',
    configHash: 'hash',
    engineVersion: 'node',
    seed: 0,
    frames: null,
    delta: [{ key: 'S', old: 60, new: 57.6, delta: -2.4, direction: 'DOWN', magnitude: 2.4 }],
    attribution: [
      { primary_factor: 'f_c', dS_i: -2.4, causeType: '通勤线', refId: 'traffic:T_c', contribution: -2.4, detail: 'T_c 恶化', suggested_verb: 'V8' },
    ],
    commandTrace: ['v-zone-1'],
    stage: 'P8',
  };
  store.put(realSnapshot as never);
  const before = JSON.stringify(store.get(60));

  const vm = queryDiagnosis(store, 60);
  assert.equal(vm.found, true);
  assert.equal(vm.l2.cards.length, 1, '真实快照可查出 ≥1 条具体原因（AC2）');
  assert.equal(vm.l2.cards[0].detail.refId, 'traffic:T_c');
  near(vm.l2.coupling.sAbsoluteChange, -2.4, 'real sAbsoluteChange');

  const chain = queryCycleRange(store, 0, 0);
  assert.equal(chain.ticks.length, 1);
  assert.equal(JSON.stringify(store.get(60)), before, '真实存储查询前后逐字节一致（AC-I7）');
  assert.equal(store.size, 1, '查询未写入任何新条目');
});

// ---------------------------------------------------------------------------
// D-16 专属：两种文案各自准确（quality-lead T-136 登记 S4）
// ---------------------------------------------------------------------------

test('DQ-25 D-16「非首 tick 无来源」：即使带教学占位条目，也不得自称首 tick', () => {
  // 关键回归：tick-pipeline 在任意 cur.dS===0 的 tick 都会产出「教学」占位归因，
  // 所以「有教学条目」≠「首 tick」。tickId=11 必须是 MISSING_SOURCE。
  const snap = mkSnap({ tickId: 11, cycleId: 0, cycleTickIndex: 2, sOld: 50, sNew: 50, attribution: COLD_START });
  const vm = queryDiagnosis(makeSource([snap]), 11);
  assert.equal(vm.emptyReason, 'MISSING_SOURCE');
  assert.equal(vm.tutorial!.reason, 'MISSING_SOURCE');
  assert.equal(vm.l0.headline.includes('首 tick'), false);
  assert.ok(vm.l0.headline.includes('数据缺失'));
  assert.equal(vm.tutorial!.text, TUTORIAL_TEXT_MISSING_SOURCE);
  assert.notEqual(vm.tutorial!.text, TUTORIAL_TEXT_E1, '不得误用 E1 文案');
  // 数据诚实性保持：无兜底提示、traceable 如实、ΔS 双口径钉死、S 绝对值仍给
  assert.equal(vm.traceable, true, '教学占位条目仍在、无来源抑制 → E1 例外口径不变');
  assert.equal(vm.tutorial!.noAttributionDiagnosis, true);
  assert.equal(vm.l2.coupling.deltaSDecompositionCarried, false);
  assert.ok(vm.l2.coupling.basis.includes('不等于 ΔS_abs − ΔS'));
  const strings = allStrings(vm).join('|');
  for (const hint of GENERIC_HINTS) assert.equal(strings.includes(hint), false);
});

test('DQ-26 D-16「真首 tick」：tickId=0 / cycleId=0 / cycleTickIndex=0 才标 E1', () => {
  const first = queryDiagnosis(
    makeSource([mkSnap({ tickId: 0, cycleId: 0, cycleTickIndex: 0, sOld: 50, sNew: 50, attribution: COLD_START })]),
    0,
  );
  assert.equal(first.emptyReason, 'E1_FIRST_TICK');
  assert.equal(first.tutorial!.text, TUTORIAL_TEXT_E1);
  assert.ok(first.l0.headline.includes('首 tick'));

  // 三个判据逐个取反，任一不满足都不得标 E1（防止只凭教学条目判定）
  const notFirstTick = mkSnap({ tickId: 1, cycleId: 0, cycleTickIndex: 0, attribution: COLD_START });
  const wrongCycle = mkSnap({ tickId: 0, cycleId: 1, cycleTickIndex: 0, attribution: COLD_START });
  const wrongCycleTick = mkSnap({ tickId: 0, cycleId: 0, cycleTickIndex: 1, attribution: COLD_START });
  for (const s of [notFirstTick, wrongCycle, wrongCycleTick]) {
    const vm = queryDiagnosis(makeSource([s]), s.tickId);
    assert.equal(vm.emptyReason, 'MISSING_SOURCE', 'tickId=' + s.tickId + ' cycleId=' + s.cycleId + ' cycleTickIndex=' + s.cycleTickIndex);
  }
  // 首 tick 但丢过来源 → 如实标数据缺失，不用教学文案掩盖
  const firstWithLoss = queryDiagnosis(
    makeSource([mkSnap({ tickId: 0, cycleId: 0, cycleTickIndex: 0, attribution: [attr({ refId: '', dS_i: -1 })] })]),
    0,
  );
  assert.equal(firstWithLoss.emptyReason, 'MISSING_SOURCE');
  assert.equal(firstWithLoss.unsourcedSuppressed, 1);
});
