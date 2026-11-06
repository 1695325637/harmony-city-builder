/**
 * HC-01 纯逻辑层 · 网格 / 分区 / 状态 schema
 *
 * 数据层零引擎 / 零平台依赖；Cell 为唯一权威地块状态（GDD 02 §3.3）。
 * 分区类型由 config.zoneTypes 驱动（3 类 MVP 激活集 + 可扩展预留），
 * 增 / 减分区不改动本文件（S-02 验收 3 / X-2 兼容预留）。
 */

import {
  SCHEMA_VERSION,
  ENGINE_VERSION,
  MAX_GRID_SIDE,
  ZONE_EMPTY_INDEX,
  ZONE_ROAD_INDEX,
  DENSITY_NONE,
  GridLimitExceededError,
  type CellArrays,
  type CityState,
  type Frame,
} from './types.ts';
import { assertConfigCompatible, computeBaselineS, computeConfigHash, type Config } from './config.ts';

export function assertGridSide(side: number): void {
  if (!Number.isInteger(side) || side <= 0 || side > MAX_GRID_SIDE) {
    throw new GridLimitExceededError(side);
  }
}

export function cellIndex(side: number, x: number, y: number): number {
  return y * side + x;
}

/** 内建 0=EMPTY / 1=ROAD；2..N 由 config.zoneTypes 顺序生成；未知返回 -1 */
export function zoneIndex(config: Config, zoneId: string): number {
  if (zoneId === 'EMPTY') return ZONE_EMPTY_INDEX;
  if (zoneId === 'ROAD') return ZONE_ROAD_INDEX;
  const i = config.zoneTypes.indexOf(zoneId);
  return i < 0 ? -1 : i + 2;
}

export function zoneId(config: Config, index: number): string {
  if (index === ZONE_EMPTY_INDEX) return 'EMPTY';
  if (index === ZONE_ROAD_INDEX) return 'ROAD';
  const i = index - 2;
  return i >= 0 && i < config.zoneTypes.length ? config.zoneTypes[i] : 'UNKNOWN';
}

export function isBuiltinZone(index: number): boolean {
  return index === ZONE_EMPTY_INDEX || index === ZONE_ROAD_INDEX;
}

export function createFrame(): Frame {
  return {
    S: 0,
    factors: new Float64Array(4),
    T_c: 0,
    T_s: 0,
    E: 0,
    I_f: 0,
    dS: 0,
    dSByFactor: new Float64Array(4),
    dSPenalty: 0,
    L: 0,
  };
}

export function copyFrame(src: Frame, dst: Frame): void {
  dst.S = src.S;
  dst.factors.set(src.factors);
  dst.T_c = src.T_c;
  dst.T_s = src.T_s;
  dst.E = src.E;
  dst.I_f = src.I_f;
  dst.dS = src.dS;
  dst.dSByFactor.set(src.dSByFactor);
  dst.dSPenalty = src.dSPenalty;
  dst.L = src.L;
}

export interface InitialStateOptions {
  side?: number;
  unlockedSide?: number;
}

export function createInitialState(config: Config, options: InitialStateOptions = {}): CityState {
  const side = options.side ?? config.gridSide;
  assertGridSide(side);
  const unlockedSide = options.unlockedSide ?? config.unlockedSide;
  const count = side * side;

  const cells: CellArrays = {
    zone: new Uint8Array(count),
    density: new Uint8Array(count),
    unlocked: new Uint8Array(count),
    region: new Uint8Array(count),
    inputVersion: new Uint32Array(count),
  };

  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const i = cellIndex(side, x, y);
      const inside = x < unlockedSide && y < unlockedSide;
      cells.unlocked[i] = inside ? 1 : 0;
      cells.region[i] = inside ? 0 : 1;
      cells.zone[i] = ZONE_EMPTY_INDEX;
      cells.density[i] = DENSITY_NONE;
    }
  }

  const baselineS = computeBaselineS(config);
  const prev = createFrame();
  const current = createFrame();
  for (const f of [prev, current]) {
    f.S = baselineS;
    for (let i = 0; i < 4; i++) f.factors[i] = config.f_init;
    f.I_f = 0;
    f.L = 0;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    configHash: computeConfigHash(config),
    engineVersion: ENGINE_VERSION,
    seed: 0,
    side,
    cells,
    tickId: 0,
    cycleId: 0,
    cycleTickIndex: 0,
    budget: {
      B: 0,
      C_b_accum: 0,
      C_m_accum: 0,
      I_f_current: 0,
      I_f_lagged: 0,
      I_t: 0,
      C_m_last: 0,
    },
    frames: { prev, current },
    issueCount: 2,
    unlockedRegions: 1,
  };
}

/** 原地深拷贝（用于 workspace.stateScratch，热路径不新建对象） */
export function copyState(src: CityState, dst: CityState): void {
  dst.schemaVersion = src.schemaVersion;
  dst.configHash = src.configHash;
  dst.engineVersion = src.engineVersion;
  dst.seed = src.seed;
  dst.side = src.side;
  dst.cells.zone.set(src.cells.zone);
  dst.cells.density.set(src.cells.density);
  dst.cells.unlocked.set(src.cells.unlocked);
  dst.cells.region.set(src.cells.region);
  dst.cells.inputVersion.set(src.cells.inputVersion);
  dst.tickId = src.tickId;
  dst.cycleId = src.cycleId;
  dst.cycleTickIndex = src.cycleTickIndex;
  dst.budget.B = src.budget.B;
  dst.budget.C_b_accum = src.budget.C_b_accum;
  dst.budget.C_m_accum = src.budget.C_m_accum;
  dst.budget.I_f_current = src.budget.I_f_current;
  dst.budget.I_f_lagged = src.budget.I_f_lagged;
  dst.budget.I_t = src.budget.I_t;
  dst.budget.C_m_last = src.budget.C_m_last;
  copyFrame(src.frames.prev, dst.frames.prev);
  copyFrame(src.frames.current, dst.frames.current);
  dst.issueCount = src.issueCount;
  dst.unlockedRegions = src.unlockedRegions;
}

export interface SerializedState {
  schemaVersion: string;
  configHash: string;
  engineVersion: string;
  seed: number;
  side: number;
  cells: {
    zone: number[];
    density: number[];
    unlocked: number[];
    region: number[];
    inputVersion: number[];
  };
  tickId: number;
  cycleId: number;
  cycleTickIndex: number;
  budget: CityState['budget'];
  frames: { prev: SerializedFrame; current: SerializedFrame };
  issueCount: number;
  unlockedRegions: number;
}

interface SerializedFrame {
  S: number;
  factors: number[];
  T_c: number;
  T_s: number;
  E: number;
  I_f: number;
  dS: number;
  dSByFactor: number[];
  dSPenalty: number;
  L: number;
}

function frameToPlain(f: Frame): SerializedFrame {
  return {
    S: f.S,
    factors: Array.from(f.factors),
    T_c: f.T_c,
    T_s: f.T_s,
    E: f.E,
    I_f: f.I_f,
    dS: f.dS,
    dSByFactor: Array.from(f.dSByFactor),
    dSPenalty: f.dSPenalty,
    L: f.L,
  };
}

function plainToFrame(p: SerializedFrame): Frame {
  const f = createFrame();
  f.S = p.S;
  f.factors.set(p.factors);
  f.T_c = p.T_c;
  f.T_s = p.T_s;
  f.E = p.E;
  f.I_f = p.I_f;
  f.dS = p.dS;
  f.dSByFactor.set(p.dSByFactor);
  f.dSPenalty = p.dSPenalty;
  f.L = p.L;
  return f;
}

export function serializeState(state: CityState): SerializedState {
  return {
    schemaVersion: state.schemaVersion,
    configHash: state.configHash,
    engineVersion: state.engineVersion,
    seed: state.seed,
    side: state.side,
    cells: {
      zone: Array.from(state.cells.zone),
      density: Array.from(state.cells.density),
      unlocked: Array.from(state.cells.unlocked),
      region: Array.from(state.cells.region),
      inputVersion: Array.from(state.cells.inputVersion),
    },
    tickId: state.tickId,
    cycleId: state.cycleId,
    cycleTickIndex: state.cycleTickIndex,
    budget: { ...state.budget },
    frames: {
      prev: frameToPlain(state.frames.prev),
      current: frameToPlain(state.frames.current),
    },
    issueCount: state.issueCount,
    unlockedRegions: state.unlockedRegions,
  };
}

/**
 * 反序列化存档 / 快照（D-01 修复，T-116）：
 * `config` 为实参，载入后强制 `assertConfigCompatible`——
 * schemaVersion / configHash 任一不匹配即抛 `ConfigMismatchError`，
 * 禁止旧存档在新配置下静默续算（ADR-003 A3 / SM-W1-02）。
 * 显式迁移须走未来的 S-10 migrate() 路径，不经本函数绕行。
 */
export function deserializeState(raw: SerializedState, config: Config): CityState {
  assertGridSide(raw.side);
  const side = raw.side;
  const count = side * side;
  const cells: CellArrays = {
    zone: Uint8Array.from(raw.cells.zone),
    density: Uint8Array.from(raw.cells.density),
    unlocked: Uint8Array.from(raw.cells.unlocked),
    region: Uint8Array.from(raw.cells.region),
    inputVersion: Uint32Array.from(raw.cells.inputVersion),
  };
  // 长度防御：不静默接受残缺数据
  if (cells.zone.length !== count) throw new GridLimitExceededError(side);
  const state: CityState = {
    schemaVersion: raw.schemaVersion,
    configHash: raw.configHash,
    engineVersion: raw.engineVersion,
    seed: raw.seed,
    side,
    cells,
    tickId: raw.tickId,
    cycleId: raw.cycleId,
    cycleTickIndex: raw.cycleTickIndex,
    budget: { ...raw.budget },
    frames: {
      prev: plainToFrame(raw.frames.prev),
      current: plainToFrame(raw.frames.current),
    },
    issueCount: raw.issueCount,
    unlockedRegions: raw.unlockedRegions,
  };
  // D-01（T-116）：载入即断言，不匹配即拒绝（无静默续算）
  assertConfigCompatible(state, config);
  return state;
}
