/**
 * DP-01 · S-09 第二批 D 线 · L2 诊断面板视图单测
 *
 * 钉定：
 * - ux-spec §2.2 / §4.3 / P4：单屏 ≤1 数据面板、L1/L2 互斥、四段卡片、不以密集表格作主交互面。
 * - ux-spec §8.1 UX-AC6 / GDD 05 §7 AC-I3：建议动词一次点按可达（V3/V4/V5）。
 * - ADR-004 §2 / AC-I7：L2 面板只读、不重算、不触发结算、不写回模拟状态。
 * - D-16：面板标题/文案按 E1 首 tick / 数据缺失 / 无快照 三种事实各自准确。
 *
 * 全部使用**真实实现**：createHudViewModel（共享槽位）、queryDiagnosis（只读 VM）、
 * createFeedbackBus（通道 A 事件），确保结构与运行期一致，而非自造替身。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../src/core/config.ts';
import { createInitialState } from '../../src/core/schema.ts';
import {
  MAX_DETAIL_CARDS,
  MAX_FACTOR_ROWS,
  TUTORIAL_LABEL,
  createDiagnosisPanel,
  createFeedbackBus,
  createHudViewModel,
  projectCityStateToHud,
  projectDiagnosisPanel,
  queryDiagnosis,
  type DiagnosisAttributionEntry,
  type DiagnosisDeltaEntry,
  type DiagnosisSnapshotSource,
  type DiagnosisTickSnapshot,
} from '../../src/ui/index.ts';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

function d(oldV: number, newV: number): DiagnosisDeltaEntry {
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

function snap(over: Partial<DiagnosisTickSnapshot> & { sOld?: number; sNew?: number } = {}): DiagnosisTickSnapshot {
  const { sOld, sNew, ...rest } = over;
  return {
    tickId: 7,
    cycleId: 1,
    cycleTickIndex: 2,
    delta: [d(sOld ?? 60, sNew ?? 57.6)],
    attribution: [attr()],
    commandTrace: ['v-zone-1'],
    ...rest,
  };
}

function sourceOf(snapshots: readonly DiagnosisTickSnapshot[]): DiagnosisSnapshotSource {
  return {
    get(tickId: number): DiagnosisTickSnapshot | null {
      for (let i = 0; i < snapshots.length; i++) if (snapshots[i].tickId === tickId) return snapshots[i];
      return null;
    },
    getCycleRange(from: number, to: number): readonly DiagnosisTickSnapshot[] {
      return snapshots.filter((s) => s.cycleId >= from && s.cycleId <= to);
    },
  };
}

/** 真实 HudViewModel（activePanel / setPanel 单值槽位） */
function realSlot() {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  return createHudViewModel({ projection: projectCityStateToHud(state, config) });
}

function vmOf(s: DiagnosisTickSnapshot) {
  return queryDiagnosis(sourceOf([s]), s.tickId);
}

function allStrings(o: unknown, out: string[] = []): string[] {
  if (typeof o === 'string') out.push(o);
  else if (o !== null && typeof o === 'object') {
    for (const k of Object.keys(o as object)) allStrings((o as Record<string, unknown>)[k], out);
  }
  return out;
}

const GENERIC_HINTS = ['系统波动', '未知原因', '来源不明', '暂无说明', 'N/A', '综合因素'];

// ---------------------------------------------------------------------------
// ① 四段卡片 / 分层披露 / 非密集表格（P4 / ux-spec §4.3）
// ---------------------------------------------------------------------------

test('DP-1 L2 面板固定四段：具名字段齐备、可读文本、非二维数值矩阵', () => {
  const vm = vmOf(snap());
  const view = projectDiagnosisPanel(vm);
  assert.equal(view.panelId, 'L2');
  assert.equal(view.slotId, 'L2');
  assert.equal(view.cards.length, 1);
  const c = view.cards[0];
  assert.equal(c.ordinal, 1);
  assert.equal(c.factor, 'f_c', '段 1 主因因子');
  assert.equal(c.factorLabel, '通勤便利');
  assert.equal(c.contribution, -2.4, '段 2 贡献量');
  assert.equal(c.contributionUnit, '分/tick');
  assert.equal(c.contributionText, '-2.4 分/tick', '段 2 可读文本');
  assert.equal(c.refId, 'traffic:T_c', '段 3 明细来源');
  assert.ok(c.detailText.length > 1, '段 3 明细文本');
  assert.equal(c.actionVerb, 'V5', '段 4 建议动词');
  assert.ok(c.verbText.length > 1, '段 4 可读动词');
  assert.equal(Object.isFrozen(view), true);
  assert.equal(Object.isFrozen(view.cards[0]), true);
});

test('DP-2 不产出密集表格：卡片 ≤4、因子行 ≤4、无 table/matrix/columns/二维数组', () => {
  const many: DiagnosisAttributionEntry[] = [];
  for (let i = 0; i < 7; i++) {
    many.push(attr({ refId: 'traffic:seg-' + i, dS_i: -(i + 1) * 0.5 }));
  }
  const view = projectDiagnosisPanel(vmOf(snap({ attribution: many })));
  assert.equal(view.cards.length, MAX_DETAIL_CARDS);
  assert.equal(view.cardCount, MAX_DETAIL_CARDS);
  assert.equal(view.overflowCount, 7 - MAX_DETAIL_CARDS, '截断如实计数');
  assert.ok(view.l1RowCount <= MAX_FACTOR_ROWS);
  for (const k of ['table', 'matrix', 'columns', 'rows']) {
    assert.equal(Object.prototype.hasOwnProperty.call(view, k), false, '面板不得暴露 ' + k);
  }
  function has2D(o: unknown): boolean {
    if (Array.isArray(o)) {
      if (o.some((x) => Array.isArray(x))) return true;
      return o.some(has2D);
    }
    if (o !== null && typeof o === 'object') return Object.values(o as object).some(has2D);
    return false;
  }
  assert.equal(has2D(view), false, '无二维数值矩阵');
});

test('DP-3 耦合披露 / 教学卡 / summary 原样透传，ΔS 双口径钉死不变', () => {
  const vm = vmOf(snap({ sOld: 60, sNew: 55 }));
  const view = projectDiagnosisPanel(vm);
  assert.equal(view.coupling, vm.l2.coupling, '同一冻结引用，未重算');
  assert.equal(view.coupling.deltaSDecompositionCarried, false, '主理人裁定：恒 false');
  assert.ok(view.coupling.basis.includes('不等于 ΔS_abs − ΔS'));
  assert.ok(view.coupling.message.includes('-5'), '无条件给出 S 绝对变化数值');
  assert.equal(view.summary, vm.l0);
  assert.equal(view.tutorial, vm.l2.tutorial);
  assert.equal(view.emptyReason, null, '有归因卡时不标空原因');
  assert.equal(view.traceable, vm.traceable);
  assert.equal(view.unsourcedSuppressed, vm.unsourcedSuppressed);
});

// ---------------------------------------------------------------------------
// ② 一次点按可达（AC-I3 / UX-AC6）
// ---------------------------------------------------------------------------

test('DP-4 建议动词一次点按直达 V3/V4/V5；activateCard 只返回动作描述、不执行命令', () => {
  const cards: DiagnosisAttributionEntry[] = [
    attr({ primary_factor: 'f_c', causeType: '通勤线', refId: 'traffic:T_c', dS_i: -3 }),
    attr({ primary_factor: 'f_s', causeType: '覆盖片区', refId: 'coverage:z1', dS_i: -2 }),
    attr({ primary_factor: 'f_f', causeType: '预算项', refId: 'budget:I_f_lagged', dS_i: -1 }),
  ];
  const slot = realSlot();
  const panel = createDiagnosisPanel({ vm: vmOf(snap({ attribution: cards })), slot });
  assert.equal(panel.view.actions.length, 3);
  assert.deepEqual(panel.view.actions.map((a) => a.verb), ['V5', 'V3', 'V4']);
  for (const a of panel.view.actions) {
    assert.equal(a.reachableInOneTap, true);
    assert.equal(a.channel, 'A', '建议动词点按属通道 A 即时反馈');
    assert.ok(a.label.length > 1);
  }
  const a2 = panel.activateCard(2);
  assert.equal(a2!.verb, 'V3');
  assert.equal(a2!.cardOrdinal, 2);
  assert.equal(panel.activateCard(99), null, '不存在的卡序号不编造动作');
  // 关键：activateCard 是纯查询，不改变任何视图 / 面板 / 模拟计数
  assert.equal(slot.activePanel, 'none', '一次点按直达不触发面板开合');
  assert.equal(panel.view.cardCount, 3);
});

test('DP-5 无法映射的动词不编造：actions 不含该卡，verbReachable=false', () => {
  const view = projectDiagnosisPanel(vmOf(snap({ attribution: [attr({ causeType: '未知类别', refId: 'ref:x' })] })));
  assert.equal(view.actions.length, 0);
  assert.equal(view.cards[0].actionVerb, null);
  assert.equal(view.cards[0].verbReachable, false);
  assert.equal(view.cards[0].suggestedVerb, 'V8', '原始动词仍原样透传');
});

// ---------------------------------------------------------------------------
// ③ 单槽位 / L1-L2 互斥（复用 HudViewModel.activePanel，不另造并行状态）
// ---------------------------------------------------------------------------

test('DP-6 open/close 只委托共享槽位：isOpen 恒由 activePanel 派生', () => {
  const slot = realSlot();
  const panel = createDiagnosisPanel({ vm: vmOf(snap()), slot });
  assert.equal(slot.activePanel, 'none');
  assert.equal(panel.isOpen, false);
  assert.equal(panel.activePanel, 'none');

  panel.open();
  assert.equal(slot.activePanel, 'L2', 'open 只写共享槽位');
  assert.equal(panel.isOpen, true);
  assert.equal(panel.activePanel, 'L2');

  // 外部直接改共享槽位 → isOpen 立即跟随，证明不存在第二套本地状态
  slot.setPanel('none');
  assert.equal(panel.isOpen, false, 'isOpen 是派生值，不持有本地 isOpen');
  slot.setPanel('L2');
  assert.equal(panel.isOpen, true);

  panel.close();
  assert.equal(slot.activePanel, 'none');
  assert.equal(panel.isOpen, false);
});

test('DP-7 L1 / L2 互斥（E8）：展开其一自动收起其二，任何时刻同屏 ≤1 面板', () => {
  const slot = realSlot();
  const panel = createDiagnosisPanel({ vm: vmOf(snap()), slot });
  panel.open();
  assert.equal(slot.activePanel, 'L2');
  panel.openL1();
  assert.equal(slot.activePanel, 'L1', '展开 L1 → L2 被收起');
  assert.equal(panel.isOpen, false);
  panel.open();
  assert.equal(slot.activePanel, 'L2', '展开 L2 → L1 被收起');
  assert.equal(panel.isOpen, true);
  // 单值槽位：结构上不存在「两个面板同时打开」的表示
  assert.equal(typeof slot.activePanel, 'string');
  assert.equal(Object.prototype.hasOwnProperty.call(panel, 'activePanel2'), false);
});

test('DP-8 两个控制器共用同一槽位时仍互斥（不产生并行面板）', () => {
  const slot = realSlot();
  const p1 = createDiagnosisPanel({ vm: vmOf(snap({ tickId: 7 })), slot });
  const p2 = createDiagnosisPanel({ vm: vmOf(snap({ tickId: 8 })), slot });
  p1.open();
  assert.equal(p1.isOpen, true);
  assert.equal(p2.isOpen, true, '共享槽位：两者读同一个 activePanel');
  p2.close();
  assert.equal(p1.isOpen, false, '任一收起即对所有控制器生效，无并行状态');
});

test('DP-9 activeLayer 委托第一批 VM 单值；open() 同步切到 L2 明细深度', () => {
  const slot = realSlot();
  const vm = vmOf(snap());
  const panel = createDiagnosisPanel({ vm, slot });
  assert.equal(panel.activeLayer, 'L0');
  panel.open();
  assert.equal(panel.activeLayer, 'L2');
  assert.equal(vm.activeLayer, 'L2', '与第一批 VM 同一个单值');
  panel.setLayer('L1');
  assert.equal(panel.activeLayer, 'L1');
  assert.equal(vm.activeLayer, 'L1');
});

test('DP-10 面板只读：open/close/activate 前后 VM 投影与快照逐字节一致，不触发结算', () => {
  const s = snap();
  const src = sourceOf([s]);
  const snapshotBefore = JSON.stringify(s);
  const vm = queryDiagnosis(src, s.tickId);
  const vmBefore = JSON.stringify({ l0: vm.l0, l1: vm.l1, l2: vm.l2 });
  const slot = realSlot();
  const panel = createDiagnosisPanel({ vm, slot });

  panel.open();
  panel.activateCard(1);
  panel.setLayer('L1');
  panel.openL1();
  panel.close();

  assert.equal(JSON.stringify({ l0: vm.l0, l1: vm.l1, l2: vm.l2 }), vmBefore, '只读投影不变');
  assert.equal(JSON.stringify(s), snapshotBefore, '快照逐字节一致（AC-I7）');
  for (const k of ['put', 'submit', 'write', 'setState', 'advanceDay', 'runTick']) {
    assert.equal(Object.prototype.hasOwnProperty.call(panel, k), false, '面板不得暴露 ' + k);
  }
});

// ---------------------------------------------------------------------------
// ④ D-16 文案分类在面板层准确呈现
// ---------------------------------------------------------------------------

test('DP-11 D-16 三分类面板标题各自准确，且全局无兜底文案', () => {
  const e1 = projectDiagnosisPanel(vmOf(snap({ tickId: 0, cycleId: 0, cycleTickIndex: 0, attribution: [] })));
  assert.equal(e1.emptyReason, 'E1_FIRST_TICK');
  assert.ok(e1.title.includes('首 tick'));
  assert.ok(e1.headline.includes('首 tick'));

  const missing = projectDiagnosisPanel(vmOf(snap({ tickId: 11, attribution: [attr({ refId: '' })] })));
  assert.equal(missing.emptyReason, 'MISSING_SOURCE');
  assert.equal(missing.title.includes('首 tick'), false, '非首 tick 不自称首 tick');
  assert.ok(missing.title.includes('数据缺失'));
  assert.equal(missing.headline.includes('首 tick'), false);

  const noSnapshot = queryDiagnosis(sourceOf([]), 999);
  const noSnapView = projectDiagnosisPanel(noSnapshot);
  assert.equal(noSnapView.emptyReason, 'NO_SNAPSHOT');
  assert.ok(noSnapView.title.includes('无快照'));

  for (const view of [e1, missing, noSnapView]) {
    const strings = allStrings(view).join('|');
    for (const hint of GENERIC_HINTS) assert.equal(strings.includes(hint), false, '不得出现兜底文案：' + hint);
  }
});

test('DP-12 教学卡在面板层仍明确标注「教学」且不产出归因卡', () => {
  const view = projectDiagnosisPanel(vmOf(snap({ tickId: 11, attribution: [] })));
  assert.equal(view.cards.length, 0);
  assert.equal(view.cards.length <= MAX_DETAIL_CARDS, true);
  assert.notEqual(view.tutorial, null);
  assert.equal(view.tutorial!.label, TUTORIAL_LABEL);
  assert.equal(view.tutorial!.explicitlyMarked, true);
  assert.equal(view.tutorial!.noAttributionDiagnosis, true);
  assert.equal(view.actions.length, 0);
});

// ---------------------------------------------------------------------------
// ⑤ 面板展开 = 通道 A 即时（与两级反馈接线）
// ---------------------------------------------------------------------------

test('DP-13 注入真实 FeedbackBus 后 open() 派发通道 A panel-open（TICK_FREE、不含 tick 数据）', () => {
  const bus = createFeedbackBus();
  const slot = realSlot();
  const panel = createDiagnosisPanel({ vm: vmOf(snap()), slot, emitter: bus });
  assert.equal(bus.historyA().length, 0);
  panel.open();
  const a = bus.historyA();
  assert.equal(a.length, 1);
  assert.equal(a[0].channel, 'A');
  assert.equal(a[0].type, 'panel-open');
  assert.equal(a[0].target, 'L2');
  assert.equal(a[0].tickId, -1, 'TICK_FREE：与 tick 完全无关');
  assert.equal(a[0].delta, undefined, '通道 A 不得夹带 B 类数值差');
  assert.equal(bus.historyB().length, 0, '面板展开绝不产生通道 B 事件');
  assert.equal(bus.dispatchCountB, 0);
  assert.equal(slot.activePanel, 'L2');
});

test('DP-14 面板展开不触发结算：store.get 调用次数不因 open 增加', () => {
  let gets = 0;
  const s = snap();
  const countingSource: DiagnosisSnapshotSource = {
    get(tickId: number): DiagnosisTickSnapshot | null {
      gets++;
      return tickId === s.tickId ? s : null;
    },
    getCycleRange(): readonly DiagnosisTickSnapshot[] {
      return [s];
    },
  };
  const vm = queryDiagnosis(countingSource, s.tickId);
  assert.equal(gets, 1, 'queryDiagnosis 只读一次');
  const panel = createDiagnosisPanel({ vm, slot: realSlot(), emitter: createFeedbackBus() });
  panel.open();
  panel.close();
  assert.equal(gets, 1, '面板开合不查 store、不重算');
});

test('DP-15 面板视图字段与第一批 VM 契约一致（无编造字段）', () => {
  const view = projectDiagnosisPanel(vmOf(snap()));
  const keys = Object.keys(view).sort();
  assert.deepEqual(keys, [
    'actions', 'cardCount', 'cards', 'coupling', 'cycleId', 'cycleTickIndex',
    'emptyReason', 'headline', 'l1RowCount', 'overflowCount', 'panelId',
    'slotId', 'summary', 'tickId', 'title', 'traceable', 'tutorial',
    'unsourcedSuppressed',
  ]);
  // 与 DQ-19 同口径：禁止的是「伪造字段」，不是 basis 文本里如实披露该符号。
  const json = JSON.stringify(view);
  assert.equal(json.includes('"cur.dS"'), false, '不得伪造 cur.dS 字段');
  assert.equal(json.includes('"dS"'), false, '不得伪造 dS 字段');
  assert.equal(view.coupling.deltaSDecompositionCarried, false);
});
