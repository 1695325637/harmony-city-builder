/**
 * HC-01 纯逻辑层 · 配置表注入
 *
 * ⚠️ 平衡期数值纪律（systems-index §7.1 / test-strategy §10）：
 * 本文件 PLACEHOLDER_DEFAULTS 中的每一个数值都是**占位默认值**，仅为让确定性
 * 模拟内核可运行、可单测；它们**不是平衡结论、也未经定稿**。口径统一为
 * 「平衡期定，S-12 前钉定；由配置表注入」。模拟内核只读取 Config 字段，
 * 不把这些数值硬编码进公式（S-02 验收 2 / TC-AC3-07）。
 */

import {
  canonicalize,
  hashString,
  SCHEMA_VERSION,
  MAX_GRID_SIDE,
  START_UNLOCKED_SIDE,
  ConfigMismatchError,
  type CityState,
} from './types.ts';

export interface Config {
  meta: {
    kind: 'PLACEHOLDER';
    note: string;
    pinnedAt: null;
  };
  zoneTypes: string[];
  /** 每市政周期 tick 数 <K> */
  K: number;
  /** 周期达标线 <S_unlock> [分] */
  S_unlock: number;
  /** 通勤 / 覆盖 / 环境阈值 <T_0> <T_max> <T_s,max> <E_max> */
  T_0: number;
  T_max: number;
  T_s_max: number;
  E_max: number;
  /** 人均参考投入 <i_ref> */
  i_ref: number;
  /** 四因子权重 <w_i>，Σ = 1 且任一 <= 0.5 */
  weights: { f_c: number; f_s: number; f_e: number; f_f: number };
  alpha: number;
  f_floor: number;
  lambda: number;
  f_init: number;
  /** 02 人口 / 岗位 / 密度系数 */
  p_unit: number;
  j_C: number;
  j_I: number;
  r_labor: number;
  densityCoefficients: [number, number, number];
  /** 04 经济系数 */
  i_unit: number;
  m_min: number;
  m_max: number;
  I_min: number;
  c_zone: number;
  c_road: number;
  m_zone: number;
  m_road: number;
  B_floor: number;
  B_cap: number;
  /** 03 路网 / 拥堵参数 */
  v0: number;
  beta: number;
  gamma: number;
  cap: number;
  qcapMax: number;
  /**
   * 三态分类阈值 θ_clear（占位，非平衡值）。
   * 仅用于 `flowState` 视觉分档，严禁进入 `T_c` / `f_c` / `f_s` / `S` 计分链（AC-T8 ④ / GDD 03 §3.5.2）。
   * 真实取值「平衡期定，S-12 前钉定；由配置表注入」（GDD 03 §8.1 O-5）。
   */
  flowClearMaxQOverCap: number;
  /**
   * 三态分类阈值 θ_slow（占位，非平衡值）。约束 `0 < θ_clear < θ_slow ≤ qcapMax`。
   * 仅用于视觉分档，不进计分链（AC-T8 ④）。
   */
  flowSlowMaxQOverCap: number;
  epsilon: number;
  maxBlocks: number;
  /** 归因型条目的最小贡献阈值（占位） */
  attributionThreshold: number;
  /** 起始解锁边长（实现基线，非平衡数值） */
  unlockedSide: number;
  gridSide: number;
}

/** 占位默认值：结构性中性值，仅用于可运行性，不代表任何平衡结论 */
export const PLACEHOLDER_DEFAULTS: Config = {
  meta: {
    kind: 'PLACEHOLDER',
    note: '平衡期定，S-12 前钉定；由配置表注入。当前值仅为可运行占位，不是平衡结论。',
    pinnedAt: null,
  },
  zoneTypes: ['R', 'C', 'I'],
  K: 4,
  S_unlock: 60,
  T_0: 1,
  T_max: 30,
  T_s_max: 20,
  E_max: 100,
  i_ref: 10,
  weights: { f_c: 0.25, f_s: 0.25, f_e: 0.25, f_f: 0.25 },
  alpha: 0.5,
  f_floor: 0.3,
  lambda: 0.1,
  f_init: 0.5,
  p_unit: 1,
  j_C: 1,
  j_I: 1,
  r_labor: 0.5,
  densityCoefficients: [1, 1.8, 2.4],
  i_unit: 1,
  m_min: 0.5,
  m_max: 1.5,
  I_min: 1,
  c_zone: 1,
  c_road: 1,
  m_zone: 0.1,
  m_road: 0.1,
  B_floor: -100,
  B_cap: 1000,
  v0: 1,
  beta: 1,
  gamma: 1,
  cap: 10,
  qcapMax: 4,
  // 三态分类阈值占位：刻意取明显中性数（0.5 / 0.8），**非平衡结论**。
  // 约束 0 < θ_clear(0.5) < θ_slow(0.8) ≤ qcapMax(4)。真实取值平衡期定、S-12 前钉定、由配置表注入。
  // 这两个键只驱动 flowState 分档，绝不进入 T_c / f_c / f_s / S 的计分链（AC-T8 ④）。
  flowClearMaxQOverCap: 0.5, // <θ_clear> 占位
  flowSlowMaxQOverCap: 0.8, // <θ_slow> 占位
  epsilon: 1e-9,
  maxBlocks: 64,
  attributionThreshold: 0,
  unlockedSide: START_UNLOCKED_SIDE,
  gridSide: MAX_GRID_SIDE,
};

export function createDefaultConfig(overrides: Partial<Config> = {}): Config {
  const config: Config = {
    ...PLACEHOLDER_DEFAULTS,
    ...overrides,
    meta: overrides.meta ?? PLACEHOLDER_DEFAULTS.meta,
    weights: { ...PLACEHOLDER_DEFAULTS.weights, ...(overrides.weights ?? {}) },
    densityCoefficients: overrides.densityCoefficients ?? [...PLACEHOLDER_DEFAULTS.densityCoefficients],
    zoneTypes: overrides.zoneTypes ?? [...PLACEHOLDER_DEFAULTS.zoneTypes],
  };
  // 占位阈值配置校验：0 < θ_clear < θ_slow ≤ (q/cap)_max（GDD 03 §3.5.2 约束；违反即非法配置）
  assertTrafficThresholds(config);
  return config;
}

/**
 * 三态阈值配置校验（GDD 03 §3.5.2）：`0 < θ_clear < θ_slow ≤ qcapMax`。
 * 这两个键只用于视觉分档，不进计分链；校验失败意味着配置非法，立即在构造期暴露。
 */
export function assertTrafficThresholds(config: Config): void {
  const clear = config.flowClearMaxQOverCap;
  const slow = config.flowSlowMaxQOverCap;
  const max = config.qcapMax;
  if (!(clear > 0)) {
    throw new Error('flowClearMaxQOverCap 必须 > 0（占位阈值非法）');
  }
  if (!(clear < slow)) {
    throw new Error('flowClearMaxQOverCap 必须 < flowSlowMaxQOverCap（占位阈值非法）');
  }
  if (!(slow <= max)) {
    throw new Error('flowSlowMaxQOverCap 必须 ≤ qcapMax（与 §4 钳制上界一致）');
  }
}

/** 配置内容哈希：任一字段变化必升 hash（S-02 验收 2 / ADR-003 R-6） */
export function computeConfigHash(config: Config): string {
  return hashString(canonicalize(config));
}

export function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return v < lo ? lo : v > hi ? hi : v;
}

/** 除零保护：分母 <= eps 时走兜底，绝不产生 Infinity / NaN */
export function safeDiv(num: number, den: number, fallback: number, eps: number): number {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= eps) return fallback;
  const r = num / den;
  return Number.isFinite(r) ? r : fallback;
}

/** 满意度聚合器（可注入；公式骨架来自 GDD 01 §4.2，参数全部来自 Config） */
export interface SatisfactionAggregator {
  aggregate(factors: Float64Array, config: Config): number;
  shortfall(factors: Float64Array, config: Config): number;
  transform(f: number, config: Config): number;
}

export function createDefaultAggregator(): SatisfactionAggregator {
  const transform = (f: number, config: Config): number =>
    Math.pow(clamp(f, 0, 1), config.alpha);
  const shortfall = (factors: Float64Array, config: Config): number => {
    let min = 1;
    for (let i = 0; i < factors.length; i++) if (factors[i] < min) min = factors[i];
    return clamp(safeDiv(config.f_floor - min, config.f_floor, 0, config.epsilon), 0, 1);
  };
  return {
    transform,
    shortfall,
    aggregate(factors: Float64Array, config: Config): number {
      const w = config.weights;
      const main =
        w.f_c * transform(factors[0], config) +
        w.f_s * transform(factors[1], config) +
        w.f_e * transform(factors[2], config) +
        w.f_f * transform(factors[3], config);
      return clamp(100 * main * (1 - config.lambda * shortfall(factors, config)), 0, 100);
    },
  };
}

/**
 * 冷启动基线满意度：由 f_init 与合成公式派生，避免与 S 公式不一致（GDD 01 E1）。
 * S_init 不单独作为平衡数值写死。
 */
export function computeBaselineS(config: Config): number {
  const f = config.f_init;
  const g = Math.pow(clamp(f, 0, 1), config.alpha);
  const w = config.weights;
  const main = (w.f_c + w.f_s + w.f_e + w.f_f) * g;
  const L = clamp(safeDiv(config.f_floor - f, config.f_floor, 0, config.epsilon), 0, 1);
  return clamp(100 * main * (1 - config.lambda * L), 0, 100);
}

/** 版本不匹配时拒绝续算，禁止静默用新公式（ADR-003 A3 / SM-W4-03） */
export function assertConfigCompatible(state: CityState, config: Config): void {
  if (state.schemaVersion !== SCHEMA_VERSION) {
    throw new ConfigMismatchError(`schemaVersion ${state.schemaVersion} != ${SCHEMA_VERSION}`);
  }
  const expected = computeConfigHash(config);
  if (state.configHash !== expected) {
    throw new ConfigMismatchError('configHash mismatch; explicit migration required');
  }
}
