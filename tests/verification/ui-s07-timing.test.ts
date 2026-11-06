/**
 * HC-01 · S-07 · 即时反馈**进程内分发延迟**证据（不是真机达标率）
 *
 * ⚠️ 口径（务必与验证记录一致引用）：
 * 本用例只测「UI 动作 → 反馈事件派发完成」的进程内耗时（`performance.now` 差值）。
 * 它**不含**触摸采样 / 输入队列 / 布局 / 绘制 / 合成 / 垂直同步 / Cocos 管线 / HarmonyOS
 * 系统层，因此**不能**作为「真机 <100ms 达标率」的证据（ADR-004 §6 R-1 / §7 A1）。
 * 真机测量**未进行**（本机无 Cocos Creator、无真机）。
 *
 * 因此本文件**不设**任何「<100ms 通过」这类断言，只断言探针的结构正确性
 * （样本可采、百分位单调、量级合理），并在诊断信息里输出实测分布供人工核对。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../src/core/config.ts';
import { createInitialState } from '../../src/core/schema.ts';
import { buildSemanticTokenMap } from '../../src/render/semantic-tokens.ts';
import { createSimulation } from '../../src/simulation/session.ts';
import {
  DISPATCH_LATENCY_DISCLAIMER,
  DISPATCH_LATENCY_SCOPE,
  createDispatchProbe,
  createInteractionController,
  percentile,
  sampleDispatchLatency,
} from '../../src/ui/index.ts';

test('TIMING-1 百分位计算：空样本返回 NaN，单调不减，边界取极值', () => {
  assert.equal(Number.isNaN(percentile([], 50)), true, '无样本必须如实返回 NaN，不伪造 0');

  const samples = [5, 1, 4, 2, 3];
  assert.equal(percentile(samples, 0), 1);
  assert.equal(percentile(samples, 100), 5);
  assert.equal(percentile(samples, 50), 3);
  assert.equal(percentile(samples, 1) <= percentile(samples, 50), true);
  assert.equal(percentile(samples, 50) <= percentile(samples, 99), true);
  // 不修改入参
  assert.deepEqual(samples, [5, 1, 4, 2, 3]);
});

test('TIMING-2 sampleDispatchLatency 透传返回值并在 finally 中采样（异常也留样本）', () => {
  const seen: number[] = [];
  const value = sampleDispatchLatency('unit', () => 42, (s) => {
    assert.equal(s.scope, DISPATCH_LATENCY_SCOPE, '样本必须标注作用域');
    seen.push(s.latencyMs);
  });
  assert.equal(value, 42);
  assert.equal(seen.length, 1);
  assert.equal(seen[0] >= 0, true);

  assert.throws(() =>
    sampleDispatchLatency('boom', () => {
      throw new Error('x');
    }),
  );
});

test('TIMING-3 S-07 即时反馈分发分布（进程内参考值，真机未测）', (t) => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  const tokens = buildSemanticTokenMap(config.zoneTypes);
  const sim = createSimulation(config, state);
  const ui = createInteractionController({ session: sim, tokens });
  const probe = createDispatchProbe();

  // 默认暂停、0 次 tick 下逐次采样四类操作（与 S-07 验收①的操作集合一致）
  const ROUNDS = 60;
  for (let i = 0; i < ROUNDS; i++) {
    const x = i % 12;
    probe.sample('V3.zone', () => ui.zone(x, 2, 'R', 1));
    probe.sample('V5.road', () => ui.road(x, 3));
    probe.sample('select', () => ui.select(x, 4));
    probe.sample('tab', () => ui.setTab(i % 2 === 0 ? 'ROAD' : 'R'));
  }

  assert.equal(sim.tickId, 0, '整个采样过程未推进任何 tick：即时反馈与 tick 无关');
  assert.equal(probe.count, ROUNDS * 4);

  const report = probe.report();
  assert.equal(report.scope, DISPATCH_LATENCY_SCOPE);
  assert.equal(report.disclaimer, DISPATCH_LATENCY_DISCLAIMER);
  assert.equal(Number.isFinite(report.p50), true);
  assert.equal(Number.isFinite(report.p95), true);
  assert.equal(report.min <= report.p50, true);
  assert.equal(report.p50 <= report.max, true);
  assert.equal(report.p95 <= report.max, true);
  assert.equal(report.max >= 0, true);

  // 诊断输出（供 ui-s07-verification.md 引用；不写成「达标」结论）
  t.diagnostic(
    'in-process dispatch latency (ms), NOT device achievement — ' +
      'n=' +
      String(report.count) +
      ' min=' +
      report.min.toFixed(3) +
      ' p50=' +
      report.p50.toFixed(3) +
      ' p95=' +
      report.p95.toFixed(3) +
      ' max=' +
      report.max.toFixed(3),
  );
});

test('TIMING-4 通道 A 派发不依赖 tick：结算前后 A 事件仍全部 TICK_FREE', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  const tokens = buildSemanticTokenMap(config.zoneTypes);
  const sim = createSimulation(config, state);
  const ui = createInteractionController({ session: sim, tokens });

  ui.press('end-day');
  ui.advanceDay('d1');
  ui.press('end-day');

  const a = ui.bus.historyA();
  assert.ok(a.length >= 3);
  for (const e of a) assert.equal(e.tickId, -1, 'A 通道事件不得携带 tick 信息（结算前后一致）');
  assert.equal(ui.bus.historyB().length > 0, true, 'B 通道确有结算事件');
});
