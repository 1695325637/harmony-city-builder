/**
 * DG-02 · S-09 第一批 A 线 · 跨周期完整归因链单测（验收 ③ / D4 滞后后果）
 *
 * 钉定：跨 2~3 周期滞后后果可查完整归因链；查询只读、不重算；
 * 链节保留 commandTrace + refId，使「早期投入 → 数周期后 S 变化」可回溯；
 * 教学 tick 不丢、无来源条目如实计数、ΔS 双口径限制不下放到链上编造。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_DETAIL_CARDS,
  queryCycleRange,
  type DiagnosisAttributionEntry,
  type DiagnosisDeltaEntry,
  type DiagnosisSnapshotSource,
  type DiagnosisTickSnapshot,
} from '../../src/ui/diagnosis/index.ts';

function d(oldV: number, newV: number): DiagnosisDeltaEntry {
  return { key: 'S', old: oldV, new: newV, delta: newV - oldV };
}

function attr(over: Partial<DiagnosisAttributionEntry> = {}): DiagnosisAttributionEntry {
  return {
    primary_factor: 'f_f',
    dS_i: -1.5,
    causeType: '预算项',
    refId: 'budget:I_f_lagged',
    contribution: -1.5,
    detail: '上周期投入的滞后效应',
    suggested_verb: 'V8',
    ...over,
  };
}

function snap(p: {
  tickId: number;
  cycleId: number;
  cycleTickIndex: number;
  sOld: number;
  sNew: number;
  attribution?: readonly DiagnosisAttributionEntry[];
  commandTrace?: readonly string[];
}): DiagnosisTickSnapshot {
  return {
    tickId: p.tickId,
    cycleId: p.cycleId,
    cycleTickIndex: p.cycleTickIndex,
    delta: [d(p.sOld, p.sNew)],
    attribution: p.attribution ?? [attr()],
    commandTrace: p.commandTrace ?? ['v-fund-cycle-' + p.cycleId],
  };
}

interface Spy extends DiagnosisSnapshotSource {
  readonly getCalls: number;
  readonly rangeCalls: number;
}

function makeSource(snapshots: readonly DiagnosisTickSnapshot[]): Spy {
  let getCalls = 0;
  let rangeCalls = 0;
  return {
    get(): DiagnosisTickSnapshot | null {
      getCalls++;
      return null;
    },
    getCycleRange(from: number, to: number): readonly DiagnosisTickSnapshot[] {
      rangeCalls++;
      return snapshots.filter((s) => s.cycleId >= from && s.cycleId <= to);
    },
    get getCalls(): number {
      return getCalls;
    },
    get rangeCalls(): number {
      return rangeCalls;
    },
  };
}

/** 3 个完整周期，每周期 3 tick（K=3）；周期 0 的投入在周期 2 产生滞后 ΔS */
function threeCycles(): DiagnosisTickSnapshot[] {
  const out: DiagnosisTickSnapshot[] = [];
  let s = 60;
  for (let cycle = 0; cycle < 3; cycle++) {
    for (let k = 0; k < 3; k++) {
      const tickId = cycle * 3 + k + 1;
      const drop = cycle === 2 && k === 2 ? 3.4 : 0.4; // 周期 2 末滞后显现
      s -= drop;
      out.push(snap({
        tickId,
        cycleId: cycle,
        cycleTickIndex: k,
        sOld: s + drop,
        sNew: s,
        attribution: [attr({ dS_i: -drop, refId: 'budget:I_f_lagged' })],
        commandTrace: ['v-fund-c' + cycle + '-t' + k],
      }));
    }
  }
  return out;
}

test('DC-1 跨 3 周期完整链：9 tick 全在，按 (cycleId, cycleTickIndex, tickId) 有序', () => {
  const src = makeSource(threeCycles());
  const chain = queryCycleRange(src, 0, 2);
  assert.equal(chain.ticks.length, 9, '不丢任何 tick');
  assert.deepEqual(Array.from(chain.cycleIds), [0, 1, 2]);
  for (let i = 1; i < chain.ticks.length; i++) {
    const a = chain.ticks[i - 1];
    const b = chain.ticks[i];
    const ordered =
      a.cycleId < b.cycleId ||
      (a.cycleId === b.cycleId && (a.cycleTickIndex < b.cycleTickIndex ||
        (a.cycleTickIndex === b.cycleTickIndex && a.tickId <= b.tickId)));
    assert.equal(ordered, true, '链有序：' + i);
  }
});

test('DC-2 D4 滞后后果可回溯：早期命令 + 后期 lagged refId 都在完整链上', () => {
  const chain = queryCycleRange(makeSource(threeCycles()), 0, 2);
  assert.ok(Array.from(chain.laggedRefIds).includes('budget:I_f_lagged'));
  assert.ok(chain.ticks[0].commandTrace[0].includes('v-fund-c0'), '周期 0 的命令溯源保留');
  const late = chain.ticks[chain.ticks.length - 1];
  assert.equal(late.cycleId, 2);
  assert.ok(Math.abs(late.sAbsoluteChange) > 3, '周期 2 末的滞后 ΔS 可查');
  assert.ok(chain.ticks.every((t) => t.refIds.includes('budget:I_f_lagged')), '每 tick 来源 refId 保留');
});

test('DC-3 链完整计数：attributionCount 为截断前真实条目数，cardsEmitted 受 L2 上限约束', () => {
  const many = threeCycles().map((s) => ({
    ...s,
    attribution: [
      attr({ refId: 'traffic:T_c', dS_i: -1 }),
      attr({ refId: 'traffic:t_g', dS_i: -0.9 }),
      attr({ refId: 'budget:I_f_lagged', dS_i: -0.8 }),
      attr({ refId: 'coverage:zone-1', dS_i: -0.7 }),
      attr({ refId: 'env:industry-1', dS_i: -0.6, causeType: '环境源' }),
      attr({ refId: 'budget:C_m', dS_i: -0.5 }),
    ],
  }));
  const chain = queryCycleRange(makeSource(many), 0, 2);
  assert.equal(chain.attributionCount, 9 * 6, '截断前的真实条目数');
  assert.equal(chain.cardsEmitted, 9 * MAX_DETAIL_CARDS, 'L2 每 tick 最多 4 张卡');
  assert.equal(chain.complete, true);
});

test('DC-4 教学 tick 与无来源条目不丢 tick，如实计数且 complete=false', () => {
  const snaps: DiagnosisTickSnapshot[] = [
    snap({ tickId: 1, cycleId: 0, cycleTickIndex: 0, sOld: 50, sNew: 50,
      attribution: [{ ...attr({ causeType: '教学', refId: 'tutorial:baseline', dS_i: 0, suggested_verb: 'V1' }) }] }),
    snap({ tickId: 2, cycleId: 0, cycleTickIndex: 1, sOld: 50, sNew: 49,
      attribution: [attr({ refId: '', dS_i: -1 })] }),
    snap({ tickId: 3, cycleId: 1, cycleTickIndex: 0, sOld: 49, sNew: 48 }),
  ];
  const chain = queryCycleRange(makeSource(snaps), 0, 1);
  assert.equal(chain.ticks.length, 3, '教学 tick / 无来源 tick 都不丢');
  assert.notEqual(chain.ticks[0].tutorial, null);
  assert.equal(chain.ticks[0].cards.length, 0, '教学 tick 不产出归因型诊断');
  assert.equal(chain.ticks[1].cards.length, 0, '无来源条目不编造归因');
  assert.equal(chain.unsourcedSuppressed, 1);
  assert.equal(chain.complete, false, '有来源缺失 → 链不完整（如实标记）');
});

test('DC-5 只读性：getCycleRange 前后快照逐字节一致，且不调用 get', () => {
  const snaps = threeCycles();
  const before = JSON.stringify(snaps);
  const src = makeSource(snaps);
  const chain = queryCycleRange(src, 0, 2);
  assert.equal(chain.ticks.length, 9);
  assert.equal(JSON.stringify(snaps), before, '快照逐字节一致（AC-I7）');
  assert.equal(src.rangeCalls, 1, '只读一次，无 N+1');
  assert.equal(src.getCalls, 0, '跨周期查询不走单 tick get');
});

test('DC-6 空范围 / 逆序范围不崩溃且不编造链节', () => {
  const src = makeSource(threeCycles());
  const empty = queryCycleRange(src, 7, 9);
  assert.equal(empty.ticks.length, 0);
  assert.equal(empty.complete, false, '空范围不算完整链');
  assert.deepEqual(Array.from(empty.cycleIds), []);
  const reversed = queryCycleRange(src, 2, 0);
  assert.equal(reversed.ticks.length, 0);
});

test('DC-7 链上每 tick 都带耦合披露与 ΔS 双口径限制标记', () => {
  const chain = queryCycleRange(makeSource(threeCycles()), 0, 2);
  for (const t of chain.ticks) {
    assert.equal(t.coupling.deltaSDecompositionCarried, false);
    assert.ok(t.coupling.basis.includes('不等于 ΔS_abs − ΔS'));
    assert.equal(typeof t.coupling.sAbsoluteChange, 'number');
  }
  assert.equal(chain.deltaSDecompositionCarried, false);
});

test('DC-8 范围裁剪按 cycleId 生效（不跨范围偷数据）', () => {
  const chain = queryCycleRange(makeSource(threeCycles()), 1, 2);
  assert.deepEqual(Array.from(chain.cycleIds), [1, 2]);
  assert.equal(chain.ticks.length, 6);
  assert.ok(chain.ticks.every((t) => t.cycleId >= 1 && t.cycleId <= 2));
});
