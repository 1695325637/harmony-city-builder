/**
 * HC-01 · S-08 · HUD 视图模型单测（项 2：常驻 3 指标 / 议题 clamp 2~4 / 面板互斥）
 *
 * 钉定：常驻指标固定 3 项（满意度 / 预算结余 / 周期），人口/岗位不得进常驻；
 * 议题条 clamp(2,4)；L1/L2 面板互斥、同屏 ≤1。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../src/core/config.ts';
import { createInitialState } from '../../src/core/schema.ts';
import {
  createHudViewModel,
  projectCityStateToHud,
  ISSUE_MIN,
  ISSUE_MAX,
  type HudProjection,
} from '../../src/ui/hud/index.ts';
import type { HudIssue, HudMetric } from '../../src/ui/hud/index.ts';

function baseProjection(over: Partial<HudProjection> = {}): HudProjection {
  const metrics: HudMetric[] = [
    { key: 'satisfaction', label: '满意度', value: 72, format: 'score' },
    { key: 'budget', label: '预算结余', value: 50, format: 'currency' },
    { key: 'period', label: '周期', value: 3, format: 'period' },
  ];
  const issues: HudIssue[] = [
    { id: 'i1', title: '议题一', severity: 'info' },
    { id: 'i2', title: '议题二', severity: 'warn' },
  ];
  return { metrics, issues, cycleId: 0, periodRemaining: 3, periodLength: 4, ...over };
}

test('VM-1 常驻指标固定 3 项，键合法且均为可读标签', () => {
  const vm = createHudViewModel({ projection: baseProjection() });
  assert.equal(vm.residentMetrics.length, 3, '常驻指标数 = 3');
  const keys = vm.residentMetrics.map((m) => m.key).sort();
  assert.deepEqual(keys, ['budget', 'period', 'satisfaction']);
  for (const m of vm.residentMetrics) assert.ok(m.label.length > 1, '常驻指标必须有可读标签');
});

test('VM-2 常驻指标数 > 3 → 构造期即抛（防止人口/岗位混进常驻）', () => {
  const bad = baseProjection();
  const extra = bad.metrics.concat({ key: 'population' as never, label: '人口', value: 100, format: 'score' });
  assert.throws(() => createHudViewModel({ projection: { ...bad, metrics: extra } }), /常驻指标数/);
});

test('VM-3 非钉定键（人口/岗位）进常驻 → 构造期即抛（钉定集合之外一律拒）', () => {
  const bad = baseProjection();
  const swapped = bad.metrics.map((m, i) => (i === 0 ? { ...m, key: 'jobs' as never } : m));
  assert.throws(() => createHudViewModel({ projection: { ...bad, metrics: swapped } }), /不在钉定集合 satisfaction,budget,period/);
  // 人口 / 岗位等明确禁止键也走同一道关卡（钉定集合 + 非居民黑名单双重保险）
  const withPop = bad.metrics.map((m, i) => (i === 0 ? { ...m, key: 'population' as never } : m));
  assert.throws(() => createHudViewModel({ projection: { ...bad, metrics: withPop } }), /不在钉定集合 satisfaction,budget,period/);
});

test('VM-4 议题条 clamp 到 [2,4]：1→2、5→4、3→3', () => {
  assert.equal(createHudViewModel({ projection: baseProjection({ issues: [] }) }).issueCount, ISSUE_MIN, '0 议题补到下限 2');
  const many: HudIssue[] = [];
  for (let i = 0; i < 6; i++) many.push({ id: 'x' + i, title: 't' + i, severity: 'info' });
  assert.equal(createHudViewModel({ projection: baseProjection({ issues: many }) }).issueCount, ISSUE_MAX, '6 议题截到上限 4');
  assert.equal(createHudViewModel({ projection: baseProjection({ issues: many.slice(0, 3) }) }).issueCount, 3, '3 议题保持 3');
});

test('VM-5 议题条切片不超过展示数', () => {
  const many: HudIssue[] = [];
  for (let i = 0; i < 6; i++) many.push({ id: 'x' + i, title: 't' + i, severity: 'info' });
  const vm = createHudViewModel({ projection: baseProjection({ issues: many }) });
  assert.equal(vm.issues.length, ISSUE_MAX, 'issues 展示列表不超过上限');
});

test('VM-6 面板 L1/L2 互斥：展开 L2 自动收起 L1，同屏 ≤1', () => {
  const vm = createHudViewModel({ projection: baseProjection() });
  vm.setPanel('L1');
  assert.equal(vm.activePanel, 'L1');
  vm.setPanel('L2'); // 展开 L2
  assert.equal(vm.activePanel, 'L2', 'L2 展开后 L1 被收起（互斥）');
  vm.setPanel('none');
  assert.equal(vm.activePanel, 'none');
});

test('VM-7 projectCityStateToHud 只读投影：S / B / 周期剩余 来自权威状态，不改 state', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  const projected = projectCityStateToHud(state, config);
  assert.equal(projected.metrics.length, 3);
  assert.equal(projected.metrics.find((m) => m.key === 'satisfaction')!.value, state.frames.current.S, '满意度读自 S');
  assert.equal(projected.metrics.find((m) => m.key === 'budget')!.value, state.budget.B, '预算读自 B');
  assert.equal(projected.periodRemaining, config.K - state.cycleTickIndex, '周期剩余 = K - cycleTickIndex');
  // 只读：state 不被修改（计数无副作用）
  assert.equal(state.issueCount, 2);
});

test('VM-8 projectCityStateToHud 议题数量来自 issueCount（占位，真实规则留 S-05/S-09）', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  const projected = projectCityStateToHud(state, config);
  assert.equal(projected.issues.length, state.issueCount, '议题占位数 = state.issueCount');
  for (const it of projected.issues) assert.ok(it.title.length > 1, '议题须有可读标题');
});
