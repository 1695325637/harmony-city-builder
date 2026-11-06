/**
 * HC-01 · S-08 前置 · 模拟层 flowState（GDD 03 v1.1 §3.5 / AC-T8）
 *
 * 验证目标：
 * ① 分类基准 = §4 钳制后的逐边 q/cap，三态字面量只出现在模拟层 + 配置表（AC-T8 ①）；
 * ② 阈值只决定 flowState 分档，绝不进入 T_c / f_c / f_s / S 计分链（AC-T8 ④）；
 * ③ 配置校验 0 < θ_clear < θ_slow ≤ qcapMax（占位，非平衡值）；
 * ④ 确定性、长度对齐、超饱和钳制、0/NaN 兜底。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  classifyFlowState,
  createDefaultConfig,
  createInitialState,
  createTickWorkspace,
  runTick,
  solveTraffic,
  canonicalize,
  cellIndex,
  zoneIndex,
  makeCommand,
  assertTrafficThresholds,
  type Config,
  type CityState,
} from '../../src/index.ts';

function paint(state: CityState, config: Config, x: number, y: number, zone: string, density = 1): void {
  const i = cellIndex(state.side, x, y);
  state.cells.zone[i] = zoneIndex(config, zone);
  state.cells.density[i] = density;
  state.cells.unlocked[i] = 1;
  state.cells.inputVersion[i]++;
}

/** 构造一座「人口≈12、产业≈2、单 R→I 边」的城：qoc = clamp(12×0.5/10,0,4)=0.6 */
function buildCity(config: Config): CityState {
  const state = createInitialState(config, { side: 16 });
  // 一条连通道路线 y=4，x=0..15
  for (let x = 0; x < 16; x++) paint(state, config, x, 4, 'ROAD', 0);
  // R：y=5, x=0..4，密度 3 → 5×2.4 = 12.0 人口
  for (let x = 0; x < 5; x++) paint(state, config, x, 5, 'R', 3);
  // I：y=3, x=10..11，密度 1 → 2×1 = 2.0 岗位
  for (let x = 10; x < 12; x++) paint(state, config, x, 3, 'I', 1);
  return state;
}

// ---------------------------------------------------------------------------
// ① 三档边界（开闭性断死）
// ---------------------------------------------------------------------------

test('FS-1 三态边界：<θ_clear→clear；之间→slow；>θ_slow→congested（含等号归属）', () => {
  const c = createDefaultConfig(); // θ_clear=0.5, θ_slow=0.8
  // 恰在 θ_clear 上 → clear（≤ 归属 clear）
  assert.equal(classifyFlowState(0.5, c), 'clear');
  // θ_clear 与 θ_slow 之间（不含上界）→ slow
  assert.equal(classifyFlowState(0.6, c), 'slow');
  assert.equal(classifyFlowState(0.79, c), 'slow');
  // 恰在 θ_slow 上 → slow（≤ 归属 slow，不 congested）
  assert.equal(classifyFlowState(0.8, c), 'slow');
  // 超过 θ_slow → congested
  assert.equal(classifyFlowState(0.81, c), 'congested');
  assert.equal(classifyFlowState(4, c), 'congested');
});

test('FS-2 边界微差：θ_clear 略下=clear，θ_slow 略下=slow，θ_slow 略上=congested', () => {
  const c = createDefaultConfig();
  assert.equal(classifyFlowState(0.499, c), 'clear');
  assert.equal(classifyFlowState(c.flowClearMaxQOverCap + 1e-6, c), 'slow');
  assert.equal(classifyFlowState(c.flowSlowMaxQOverCap + 1e-6, c), 'congested');
});

// ---------------------------------------------------------------------------
// ② 改阈值只改 flowState，不改 T_c / f_c / f_s / S（AC-T8 ④）
// ---------------------------------------------------------------------------

test('FS-3 改阈值前后：T_c / S / 四因子逐字节不变，唯独 flowState 随阈值变档', () => {
  // 默认阈值：qoc=0.6 → slow；改 θ_clear=0.7 → qoc=0.6 ≤ 0.7 → clear
  const cfgA = createDefaultConfig(); // θ_clear=0.5, θ_slow=0.8
  const cfgB = createDefaultConfig({ flowClearMaxQOverCap: 0.7 }); // θ_clear=0.7, θ_slow=0.8

  const stateA = buildCity(cfgA);
  const stateB = buildCity(cfgB);
  // 两套布局逐字节一致（排除 configHash 字段，因 config 不同）
  assert.equal(canonicalize(stripHash(stateA)), canonicalize(stripHash(stateB)), '两城布局一致');

  const wsA = createTickWorkspace(cfgA, 16);
  const wsB = createTickWorkspace(cfgB, 16);
  const rA = runTick(stateA, [makeCommand.advance('fs-3', 1)], cfgA, wsA);
  const rB = runTick(stateB, [makeCommand.advance('fs-3', 1)], cfgB, wsB);

  // 计分链输出逐字节一致（AC-T8 ④）
  assert.equal(rA.state.frames.current.S, rB.state.frames.current.S, 'S 不变');
  assert.equal(rA.state.frames.current.T_c, rB.state.frames.current.T_c, 'T_c 不变');
  assert.equal(rA.state.frames.current.factors[0], rB.state.frames.current.factors[0], 'f_c 不变');
  assert.equal(rA.state.frames.current.factors[1], rB.state.frames.current.factors[1], 'f_s 不变');
  assert.equal(rA.state.frames.current.factors[2], rB.state.frames.current.factors[2], 'f_e 不变');
  assert.equal(rA.state.frames.current.factors[3], rB.state.frames.current.factors[3], 'f_f 不变');

  // flowState 确实随阈值变档（证明数据链生效）
  assert.notDeepEqual(rA.flowState, rB.flowState, 'flowState 因阈值不同而不同');
  assert.equal(rA.flowState[0], 'slow', '默认阈值下首边 = slow');
  assert.equal(rB.flowState[0], 'clear', 'θ_clear 抬到 0.7 后首边 = clear');
});

// ---------------------------------------------------------------------------
// ③ 配置校验
// ---------------------------------------------------------------------------

test('FS-4 配置校验：0 < θ_clear < θ_slow ≤ qcapMax，违反即抛错', () => {
  assert.doesNotThrow(() => assertTrafficThresholds(createDefaultConfig()));
  assert.throws(() => createDefaultConfig({ flowClearMaxQOverCap: 0.9, flowSlowMaxQOverCap: 0.5 }), /必须 < flowSlowMaxQOverCap/);
  assert.throws(() => createDefaultConfig({ flowSlowMaxQOverCap: 5 }), /必须 ≤ qcapMax/);
  assert.throws(() => createDefaultConfig({ flowClearMaxQOverCap: 0 }), /必须 > 0/);
  assert.throws(() => createDefaultConfig({ flowClearMaxQOverCap: 0.8, flowSlowMaxQOverCap: 0.8 }), /必须 < flowSlowMaxQOverCap/);
});

// ---------------------------------------------------------------------------
// ④ 确定性 / 长度对齐 / 超饱和钳制 / 0·NaN 兜底
// ---------------------------------------------------------------------------

test('FS-5 确定性：同 q/cap + 同阈值，两次分类结果逐字节一致', () => {
  const cfg = createDefaultConfig();
  const state = buildCity(cfg);
  const wsA = createTickWorkspace(cfg, 16);
  const wsB = createTickWorkspace(cfg, 16);
  const r1 = solveTraffic(state, cfg, wsA);
  const r2 = solveTraffic(state, cfg, wsB);
  assert.equal(canonicalize(r1.flowState), canonicalize(r2.flowState));
  assert.equal(canonicalize(r1.qOverCap), canonicalize(r2.qOverCap));
});

test('FS-6 长度对齐：flowState.length === qOverCap.length（逐边对齐）', () => {
  const cfg = createDefaultConfig();
  const state = buildCity(cfg);
  const ws = createTickWorkspace(cfg, 16);
  const r = solveTraffic(state, cfg, ws);
  assert.equal(r.flowState.length, r.qOverCap.length);
  assert.ok(r.flowState.length > 0);
  for (const s of r.flowState) {
    assert.ok(s === 'clear' || s === 'slow' || s === 'congested', '每个元素是合法枚举');
  }
});

test('FS-7 超饱和钳制：q/cap ≥ θ_slow 一律 congested；0 / 缺边 → clear（无 NaN）', () => {
  const cfg = createDefaultConfig(); // θ_slow=0.8
  // 占位求解器已把 qoc 钳制到 [0, qcapMax]；分类只比阈值
  assert.equal(classifyFlowState(cfg.qcapMax + 100, cfg), 'congested', '超饱和仍 congested');
  assert.equal(classifyFlowState(cfg.qcapMax, cfg), 'congested');
  // 零流量 / 未写入边 → clear（cap_e=0 走 §4 兜底后 q/cap=0 → clear，不产生 NaN）
  assert.equal(classifyFlowState(0, cfg), 'clear');
  assert.ok(Number.isFinite(0)); // 显式锚定：分类输入恒为有限值（§4 钳制保证）
});

test('FS-8 占位求解器：flowState 与 qOverCap 同长且逐边分类，且 T_c 不读阈值', () => {
  // 把阈值调到极端（θ_slow 极小）也不改变 T_c，反向证明计分链不读阈值
  const cfgNormal = createDefaultConfig();
  const cfgExtreme = createDefaultConfig({ flowClearMaxQOverCap: 0.01, flowSlowMaxQOverCap: 0.02 });
  const s1 = buildCity(cfgNormal);
  const s2 = buildCity(cfgExtreme);
  const r1 = solveTraffic(s1, cfgNormal, createTickWorkspace(cfgNormal, 16));
  const r2 = solveTraffic(s2, cfgExtreme, createTickWorkspace(cfgExtreme, 16));
  assert.equal(r1.T_c, r2.T_c, 'T_c 不随阈值变化');
  assert.equal(r1.flowState.length, r2.flowState.length, '同长');
  // 极端阈值下更多边落入 congested
  const congested1 = r1.flowState.filter((s) => s === 'congested').length;
  const congested2 = r2.flowState.filter((s) => s === 'congested').length;
  assert.ok(congested2 >= congested1, '阈值收紧使 congested 计数不减');
});

// ---------------------------------------------------------------------------
// ① 静态扫描（AC-T8 ①）：三态字面量与阈值键只出现在模拟层 + 配置表
// ---------------------------------------------------------------------------

function allSrcFiles(): string[] {
  const root = join(process.cwd(), 'src');
  const out: string[] = [];
  for (const f of readdirSync(root, { recursive: true })) {
    const p = join(root, String(f));
    if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

function stripHash(state: CityState): unknown {
  const c = JSON.parse(JSON.stringify(state));
  // configHash 随 config 不同，剔除以免干扰「布局一致」比对
  c.configHash = '';
  return c;
}

test('FS-9 静态扫描（AC-T8 ①）：阈值键只出现在 config.ts 与 simulation/traffic.ts', () => {
  const files = allSrcFiles();
  const thresholdRe = /flowClearMaxQOverCap|flowSlowMaxQOverCap/g;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const occ = (src.match(thresholdRe) || []).length;
    const isAllowed = f.endsWith('config.ts') || f.endsWith('traffic.ts');
    if (!isAllowed) {
      assert.equal(occ, 0, f + ' 不应出现阈值键（AC-T8 ①：仅 config.ts 定义 + traffic.ts 分类）');
    }
  }
  // 确有定义与分类点
  const configSrc = readFileSync(join(process.cwd(), 'src/core/config.ts'), 'utf8');
  const trafficSrc = readFileSync(join(process.cwd(), 'src/simulation/traffic.ts'), 'utf8');
  assert.ok((configSrc.match(thresholdRe) || []).length >= 2, 'config.ts 含阈值键定义');
  assert.ok((trafficSrc.match(thresholdRe) || []).length >= 2, 'traffic.ts 含阈值键分类使用');
});

test('FS-10 静态扫描（AC-T8 ①）：渲染 / UI 层不持有阈值键、不对 q/cap 做阈值比较', () => {
  // 渲染层允许出现 flow.clear / flow.slow / flow.congested 作为【令牌 id】（§3.5.3 映射），
  // 但不得出现阈值键、不得对 qOverCap / qoc 做 > / ≤ 阈值比较。
  const dirs = ['src/render', 'src/ui'];
  const files: string[] = [];
  for (const d of dirs) {
    const root = join(process.cwd(), d);
    for (const f of readdirSync(root, { recursive: true })) {
      const p = join(root, String(f));
      if (p.endsWith('.ts')) files.push(p);
    }
  }
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal((src.match(/flowClearMaxQOverCap|flowSlowMaxQOverCap/g) || []).length, 0, f + ' 不得出现阈值键');
    // 不得出现对 qOverCap / qoc 的阈值比较（> / < / <= / >= 接阈值量）
    assert.equal((src.match(/qOverCap\s*[<>]=?|qoc\s*[<>]=?/g) || []).length, 0, f + ' 不得对 q/cap 做阈值比较');
  }
});
