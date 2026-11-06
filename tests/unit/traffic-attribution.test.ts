import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createDefaultConfig,
  createInitialState,
  createTickWorkspace,
  solveTraffic,
  runTick,
  cellIndex,
  zoneIndex,
  makeCommand,
  canonicalize,
} from '../../src/index.ts';

function paint(state, config, x, y, zone, density = 1) {
  const i = cellIndex(state.side, x, y);
  state.cells.zone[i] = zoneIndex(config, zone);
  state.cells.density[i] = density;
  state.cells.unlocked[i] = 1;
}

function solverFixture(overrides = {}) {
  const config = createDefaultConfig(overrides);
  const state = createInitialState(config);
  const ws = createTickWorkspace(config, state.side);
  return { config, state, ws };
}

// 硬约束 10 / GDD 03 E1 E5：不可达与除零保护
test('不可达 OD：T_c 取 T_max、unreachable=true、无 NaN / Infinity', () => {
  const { config, state, ws } = solverFixture();
  paint(state, config, 2, 2, 'R');
  paint(state, config, 5, 2, 'I');
  const r = solveTraffic(state, config, ws);
  assert.equal(r.unreachable, true);
  assert.equal(r.T_c, config.T_max);
  assert.ok(Number.isFinite(r.T_c));
  for (let i = 0; i < r.t_g.length; i++) assert.ok(Number.isFinite(r.t_g[i]));
  for (let i = 0; i < r.qOverCap.length; i++) assert.ok(Number.isFinite(r.qOverCap[i]));
});

test('空城 / Σq_od = 0 → T_c = 0、t_g 走阈值兜底、不除零', () => {
  const { config, state, ws } = solverFixture();
  const r = solveTraffic(state, config, ws);
  assert.equal(r.T_c, 0);
  assert.equal(r.unreachable, false);
  assert.ok(Number.isFinite(r.T_c));
});

test('cap = 0 时不产生 NaN / Infinity（除零保护）', () => {
  const { config, state, ws } = solverFixture({ cap: 0 });
  paint(state, config, 2, 2, 'R');
  paint(state, config, 5, 2, 'I');
  paint(state, config, 2, 3, 'ROAD');
  paint(state, config, 3, 3, 'ROAD');
  paint(state, config, 4, 3, 'ROAD');
  paint(state, config, 5, 3, 'ROAD');
  const r = solveTraffic(state, config, ws);
  assert.ok(Number.isFinite(r.T_c));
  assert.ok(!Number.isNaN(r.T_c));
});

// 硬约束 10 / AC-T1：T_c 随拥堵单调不减
test('固定路网逐步增加 OD 需求，T_c 单调不减', () => {
  const { config, ws } = solverFixture();
  const tcs: number[] = [];
  for (let extra = 0; extra <= 4; extra++) {
    const state = createInitialState(config);
    for (let k = 0; k <= extra; k++) paint(state, config, 2 + k, 2, 'R');
    paint(state, config, 8, 2, 'I');
    for (let x = 2; x <= 8; x++) paint(state, config, x, 3, 'ROAD');
    tcs.push(solveTraffic(state, config, ws).T_c);
  }
  for (let i = 1; i < tcs.length; i++) assert.ok(tcs[i] >= tcs[i - 1], `T_c 第 ${i} 步不得下降`);
});

// 硬约束 10 / AC-T4：确定性可回放
test('同一 Cell 状态 + 同一 q_od，两次求解 canonicalize 一致', () => {
  const { config, state, ws } = solverFixture();
  paint(state, config, 2, 2, 'R');
  paint(state, config, 5, 2, 'I');
  paint(state, config, 2, 3, 'ROAD');
  paint(state, config, 3, 3, 'ROAD');
  paint(state, config, 4, 3, 'ROAD');
  paint(state, config, 5, 3, 'ROAD');
  // 同一 workspace 复用同一个 result 对象，须先取快照再比对
  const aSnap = canonicalize(solveTraffic(state, config, ws));
  const bSnap = canonicalize(solveTraffic(state, config, ws));
  assert.equal(aSnap, bSnap);
});

// AC-T2 位置敏感性 + 平移不变（P3）
test('相同分区配比仅位置不同 → T_c 不同；纯平移 2 格 → T_c 不变', () => {
  const { config, ws } = solverFixture();

  function layout(dx, dy, industryX) {
    const s = createInitialState(config);
    paint(s, config, 2 + dx, 2 + dy, 'R');
    paint(s, config, industryX + dx, 2 + dy, 'I');
    for (let x = 2; x <= 5; x++) paint(s, config, x + dx, 3 + dy, 'ROAD');
    return s;
  }
  const a = solveTraffic(layout(0, 0, 5), config, ws).T_c;
  const b = solveTraffic(layout(0, 0, 3), config, ws).T_c;
  const shifted = solveTraffic(layout(2, 2, 5), config, ws).T_c;
  assert.notEqual(a, b, '位置 / 连接不同应产生不同 T_c');
  assert.equal(a, shifted, '纯平移不改变相对拓扑');
});

// 硬约束 10：无逐格 OD 矩阵
test('通勤求解用分区块合并，源码无逐格 OD 矩阵', () => {
  const src = readFileSync(join(process.cwd(), 'src/simulation/traffic.ts'), 'utf8');
  assert.doesNotMatch(src, /odMatrix|OD_MATRIX|1024\s*\*\s*1024|side\s*\*\s*side\s*\*\s*side/i);
});

// 归因链（S-05 仅类型占位，但 P4 当帧产出 Δ 与逐因子贡献）
test('ΔS ≠ 0 的 tick：attribution ≥1 条具体原因，且 |ΔS − ΣΔS_i − ΔS_penalty| ≤ 1 分', () => {
  const config = createDefaultConfig({ K: 1 });
  const state = createInitialState(config);
  for (let k = 0; k < 3; k++) paint(state, config, 2 + k, 2, 'R');
  const ws = createTickWorkspace(config, state.side);

  const first = runTick(state, [makeCommand.fund('fund', 1, 4), makeCommand.advance('a1', 2)], config, ws);
  const second = runTick(first.state, [makeCommand.advance('a2', 3)], config, ws);

  const cur = second.state.frames.current;
  assert.notEqual(cur.dS, 0);
  assert.ok(second.attribution.length >= 1, '显著变化必须有 ≥1 条归因');
  let sum = 0;
  for (let i = 0; i < cur.dSByFactor.length; i++) sum += cur.dSByFactor[i];
  sum += cur.dSPenalty;
  assert.ok(Math.abs(cur.dS - sum) <= 1, `归因链一致性残差过大: ${cur.dS} vs ${sum}`);
});
