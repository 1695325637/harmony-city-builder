/**
 * HC-01 · S-04 性能基线实测套件（T-116 / W1 出口门缺口修复）
 *
 * 目标：32×32 满网格下 ≥100 次连续结算的单次耗时实测分布（p50 / p95 / max）。
 *
 * ⚠️ 纪律与口径（派单 T-116 原文约束）：
 *   - 全部数字为【实测值 / 建议基线 / 非承诺值】，随真机链路（SM-W1-04 / S-01）
 *     重测后由主理人钉定；本文件只做实测与记录，断言仅做有限性 / 下限健全性
 *     检查，不用具体耗时阈值做 PASS/FAIL（避免环境抖动造成假门禁）；
 *   - 计时用 performance.now()——仅验证侧使用；src/ 热路径仍零墙上时钟
 *     （V-STATIC 静态扫描只覆盖 src/，本文件不受该扫描约束）；
 *   - 环境与样本数随运行输出，同步记录于
 *     tests/verification/w1-gate-remediation-evidence.md。
 *
 * 场景（两个，均 32×32 = 1024 格全满、零 EMPTY）：
 *   A. 棋盘 R：奇偶格交替 R / ROAD → 同类型 4-邻接连通块数逼近上限（512 块，
 *      触发 maxBlocks=64 截断路径，即 D-02 已知行为的负载面）；
 *   B. 混合条带：ROAD / R / C / I 按行条带 + 满密度 → 最大 P / J / E 聚合
 *      与全图 BFS 负载（贴近真实重度布局）。
 *
 * 运行：node --experimental-strip-types --test tests/verification/perf-s04.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
  createDefaultConfig,
  createInitialState,
  createTickWorkspace,
  makeCommand,
  runTick,
  zoneIndex,
  type Command,
  type Config,
} from '../../src/index.ts';

const SIDE = 32;
const WARMUP_TICKS = 20;
const MEASURED_TICKS = 120; // ≥100 次连续结算（派单硬性要求）

interface PerfStats {
  samples: number;
  min: number;
  p50: number;
  p95: number;
  max: number;
  mean: number;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function statsOf(durations: number[]): PerfStats {
  const sorted = [...durations].sort((a, b) => a - b);
  const mean = durations.reduce((s, v) => s + v, 0) / durations.length;
  return {
    samples: durations.length,
    min: sorted[0],
    p50: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    mean,
  };
}

/** 场景 A：奇偶棋盘 R / ROAD（块数逼近上限 → maxBlocks 截断负载） */
function paintCheckerboard(state: { side: number; cells: { zone: Uint8Array; density: Uint8Array; unlocked: Uint8Array } }, config: Config): void {
  const z = zoneIndex;
  for (let y = 0; y < SIDE; y++) {
    for (let x = 0; x < SIDE; x++) {
      const i = y * SIDE + x;
      const isRoad = (x + y) % 2 === 0;
      state.cells.zone[i] = isRoad ? z(config, 'ROAD') : z(config, 'R');
      state.cells.density[i] = isRoad ? 0 : 3;
      state.cells.unlocked[i] = 1;
    }
  }
}

/** 场景 B：ROAD / R / C / I 行条带满密度（最大 OD 聚合 + 全图 BFS） */
function paintStripes(state: { side: number; cells: { zone: Uint8Array; density: Uint8Array; unlocked: Uint8Array } }, config: Config): void {
  const z = zoneIndex;
  const rowZone = ['ROAD', 'R', 'C', 'I'];
  for (let y = 0; y < SIDE; y++) {
    const zone = rowZone[y % 4];
    for (let x = 0; x < SIDE; x++) {
      const i = y * SIDE + x;
      state.cells.zone[i] = z(config, zone);
      state.cells.density[i] = zone === 'ROAD' ? 0 : 3;
      state.cells.unlocked[i] = 1;
    }
  }
}

function runScenario(
  name: string,
  config: Config,
  paint: (state: ReturnType<typeof createInitialState>, config: Config) => void,
): { stats: PerfStats; allocations: number } {
  const state = createInitialState(config, { side: SIDE, unlockedSide: SIDE });
  paint(state, config);
  const ws = createTickWorkspace(config, SIDE);
  const commandsOf = (t: number): Command[] => [makeCommand.advance('perf-' + name + '-' + t, 1)];
  let cur = state;
  let allocations = 0;
  // 预热（JIT / 缓存效应隔离，不计入样本）
  for (let t = 1; t <= WARMUP_TICKS; t++) {
    cur = runTick(cur, commandsOf(t), config, ws).state;
    allocations += ws.allocations;
  }
  const durations: number[] = [];
  for (let t = WARMUP_TICKS + 1; t <= WARMUP_TICKS + MEASURED_TICKS; t++) {
    const t0 = performance.now();
    cur = runTick(cur, commandsOf(t), config, ws).state;
    durations.push(performance.now() - t0);
    allocations += ws.allocations;
  }
  assert.equal(cur.tickId, WARMUP_TICKS + MEASURED_TICKS, '结算连续推进无中断');
  return { stats: statsOf(durations), allocations };
}

test('S-04 实测 A：32×32 满网格棋盘 R（块数逼近 maxBlocks），≥100 次连续结算，零热路径分配', () => {
  const config = createDefaultConfig();
  const { stats, allocations } = runScenario('A', config, paintCheckerboard);
  console.log(`[S-04-A] 棋盘R 32x32 满网格 | samples=${stats.samples} | min=${stats.min.toFixed(3)}ms | p50=${stats.p50.toFixed(3)}ms | p95=${stats.p95.toFixed(3)}ms | mean=${stats.mean.toFixed(3)}ms | max=${stats.max.toFixed(3)}ms`);
  console.log(`[S-04-A] 环境_NODE=${process.version} 环境_PLATFORM=${process.platform}/${process.arch} | ws.allocations 累计（含 20 次预热）=${allocations}`);
  // 建议基线（非承诺值，不作为门禁断言）：p95 见 evidence md；此处只做健全性检查
  assert.equal(stats.samples, MEASURED_TICKS, '样本数 = 计划测量次数（≥100）');
  for (const v of [stats.min, stats.p50, stats.p95, stats.max, stats.mean]) {
    assert.ok(Number.isFinite(v) && v >= 0, '耗时为有限非负数');
  }
  assert.equal(allocations, 0, '热路径结构性分配计数恒 0（' + (WARMUP_TICKS + MEASURED_TICKS) + ' 次结算累计）');
});

test('S-04 实测 B：32×32 满网格 ROAD/R/C/I 条带满密度，≥100 次连续结算，零热路径分配', () => {
  const config = createDefaultConfig();
  const { stats, allocations } = runScenario('B', config, paintStripes);
  console.log(`[S-04-B] 条带满密度 32x32 满网格 | samples=${stats.samples} | min=${stats.min.toFixed(3)}ms | p50=${stats.p50.toFixed(3)}ms | p95=${stats.p95.toFixed(3)}ms | mean=${stats.mean.toFixed(3)}ms | max=${stats.max.toFixed(3)}ms`);
  console.log(`[S-04-B] 环境_NODE=${process.version} 环境_PLATFORM=${process.platform}/${process.arch} | ws.allocations 累计（含 20 次预热）=${allocations}`);
  assert.equal(stats.samples, MEASURED_TICKS, '样本数 = 计划测量次数（≥100）');
  for (const v of [stats.min, stats.p50, stats.p95, stats.max, stats.mean]) {
    assert.ok(Number.isFinite(v) && v >= 0, '耗时为有限非负数');
  }
  assert.equal(allocations, 0, '热路径结构性分配计数恒 0（' + (WARMUP_TICKS + MEASURED_TICKS) + ' 次结算累计）');
});

test('S-04 对照：空城 32×32（零负载基线），确认结算链固有开销量级', () => {
  const config = createDefaultConfig();
  const { stats } = runScenario('C', config, () => {});
  console.log(`[S-04-C] 空城 32x32 | samples=${stats.samples} | p50=${stats.p50.toFixed(3)}ms | p95=${stats.p95.toFixed(3)}ms | max=${stats.max.toFixed(3)}ms`);
  assert.equal(stats.samples, MEASURED_TICKS);
  for (const v of [stats.min, stats.p50, stats.p95, stats.max, stats.mean]) {
    assert.ok(Number.isFinite(v) && v >= 0, '耗时为有限非负数');
  }
});
