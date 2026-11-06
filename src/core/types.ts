/**
 * HC-01 纯逻辑层 · 共享类型与常量
 *
 * 硬约束：本文件零平台 / 零引擎 / 零渲染依赖；不得出现墙上时钟、原生随机、
 * 倍速自动播放、硬终局分支。所有平衡期数值都在 config.ts 的配置表中，本文件
 * 只放结构性常量（网格上限、阶段编号、字段维度等），不放平衡结论。
 */

// ---------------------------------------------------------------------------
// 版本与结构性常量（非平衡期数值）
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 'HC01-SCHEMA-1';
export const ENGINE_VERSION = 'HC01-CORE-0.1.0';

/** MVP 硬上限：32×32 = 1024 格（architecture.md §10.2 / systems-index §7.1 已钉定） */
export const MAX_GRID_SIDE = 32;
/** 起始解锁子集 16×16 = 256 格 */
export const START_UNLOCKED_SIDE = 16;

/** zone 索引 0 / 1 为内建类型；2..N 由 config.zoneTypes 顺序生成 */
export const ZONE_EMPTY_INDEX = 0;
export const ZONE_ROAD_INDEX = 1;
export const DENSITY_NONE = 0;
export const DENSITY_MAX = 3;

export const FACTOR_COUNT = 4;
export const FACTOR_KEYS = ['f_c', 'f_s', 'f_e', 'f_f'] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];

/** 单次结算的逻辑阶段上限（分区块合并，非逐格 OD） */
export const MAX_BLOCKS = 64;

// ---------------------------------------------------------------------------
// P0~P8 结算链（顺序固定；architecture.md §3.2 / systems-index §4.3）
// ---------------------------------------------------------------------------

export const PIPELINE_STAGES = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'] as const;
export type StageId = (typeof PIPELINE_STAGES)[number];

/** R1~R7 各有对应阶段（S-03 验收 3）。R8 状态可读由 P8 + 诊断层共同承担。 */
export const RULE_TO_STAGE: Record<string, StageId> = {
  R1: 'P1', // 有限网格：命令应用 + 边界校验
  R2: 'P1', // 分区类型 / 密度
  R3: 'P5', // 市政预算按 tick 记账
  R4: 'P2', // 交通网络 / 通勤图
  R5: 'P0', // 低频 tick：冻结输入 + tickId
  R6: 'P4', // 满意度 4 因子合成
  R7: 'P7', // 时间 / 周期结算
};

export type CycleOutcome = 'IN_CYCLE' | 'TARGET_MET' | 'RETRY_AVAILABLE';

// ---------------------------------------------------------------------------
// systems-index §4.2 共享数据字典（14 条，逐字口径）
// ---------------------------------------------------------------------------

export interface SharedVariable {
  symbol: string;
  unit: string;
  range: string;
  owner: string;
}

export const SHARED_VARIABLES: readonly SharedVariable[] = [
  { symbol: 'N', unit: 'cell', range: '32×32 上限 / 16×16 起步', owner: '02' },
  { symbol: 'P_t', unit: 'person', range: '>= 0，有限（过程量）', owner: '02' },
  { symbol: 'J_t', unit: 'job', range: '>= 0，有限', owner: '02' },
  { symbol: 'q_od', unit: 'person/tick', range: '>= 0', owner: '02 → 03' },
  { symbol: 'cap_e', unit: 'FU/tick', range: '> 0', owner: '03' },
  { symbol: 'T_c', unit: 'min', range: '>= 0', owner: '03' },
  { symbol: 'f_c,f_s,f_e,f_f', unit: '无量纲', range: '[0,1]', owner: '01' },
  { symbol: 'S_t', unit: '分', range: '[0,100]', owner: '01' },
  { symbol: 'ΔS', unit: '分/tick', range: '[-100,100]', owner: '01' },
  { symbol: 'I_t', unit: 'CU/周期', range: '>= 0（有下限保护）', owner: '04' },
  { symbol: 'C_b,C_m', unit: 'CU / CU/周期', range: '>= 0', owner: '04' },
  { symbol: 'B_t', unit: 'CU', range: '可负（软着陆）', owner: '04' },
  { symbol: 'I_f', unit: 'CU/周期', range: '>= 0', owner: '04' },
  { symbol: 'n_issue', unit: '条', range: '2~4（3±1 硬上限）', owner: '05' },
];

// ---------------------------------------------------------------------------
// 命令与事件
// ---------------------------------------------------------------------------

export type CommandKind = 'ZONE' | 'DENSITY' | 'ROAD' | 'FUND' | 'ADVANCE';

export interface Command {
  kind: CommandKind;
  idempotencyKey: string;
  seq: number;
  x: number;
  y: number;
  zoneId: string;
  density: number;
  amountCU: number;
}

export type SimEventType =
  | 'TickCommitted'
  | 'BudgetRejected'
  | 'StageEntered'
  | 'AdvanceRejected'
  | 'IssuePlaceholder';

export interface SimEvent {
  type: SimEventType;
  tickId: number;
  stage: StageId | '';
  commandId: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// 状态结构（TypedArray 存储，确定性、无遍历顺序依赖）
// ---------------------------------------------------------------------------

export interface CellArrays {
  zone: Uint8Array;
  density: Uint8Array;
  unlocked: Uint8Array;
  region: Uint8Array;
  inputVersion: Uint32Array;
}

export interface Frame {
  S: number;
  factors: Float64Array;
  T_c: number;
  T_s: number;
  E: number;
  I_f: number;
  dS: number;
  dSByFactor: Float64Array;
  dSPenalty: number;
  L: number;
}

export interface BudgetState {
  B: number;
  C_b_accum: number;
  C_m_accum: number;
  I_f_current: number;
  I_f_lagged: number;
  I_t: number;
  C_m_last: number;
}

export interface CityState {
  schemaVersion: string;
  configHash: string;
  engineVersion: string;
  seed: number;
  side: number;
  cells: CellArrays;
  tickId: number;
  cycleId: number;
  cycleTickIndex: number;
  budget: BudgetState;
  frames: { prev: Frame; current: Frame };
  /** P6 占位：活跃议题数（2~4 边界），完整议题规则留 S-05 / S-09 */
  issueCount: number;
  /** 已解锁区域数（OD-4 A 里程碑解锁） */
  unlockedRegions: number;
}

export interface StageTrace {
  stage: StageId;
  note: string;
  tickId: number;
}

export interface StageView {
  stage: StageId;
  tickId: number;
  prevS: number;
  currentS: number;
}

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

export class GridLimitExceededError extends Error {
  readonly side: number;
  constructor(side: number) {
    super(`grid side ${side} exceeds MVP hard limit ${MAX_GRID_SIDE}`);
    this.name = 'GridLimitExceededError';
    this.side = side;
  }
}

export class ConfigMismatchError extends Error {
  constructor(reason: string) {
    super(`config/schema mismatch: ${reason}`);
    this.name = 'ConfigMismatchError';
  }
}

// ---------------------------------------------------------------------------
// 确定性序列化（逐字节可比对；键排序 + TypedArray 展开 + 数组保序）
// ---------------------------------------------------------------------------

export function canonicalize(value: unknown): string {
  const encode = (v: unknown): string => {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return '"NaN"';
      if (!Number.isFinite(v)) return v > 0 ? '"Infinity"' : '"-Infinity"';
      return Object.is(v, -0) ? '0' : String(v);
    }
    if (typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (ArrayBuffer.isView(v)) {
      const a = v as unknown as ArrayLike<number>;
      let out = '[';
      for (let i = 0; i < a.length; i++) out += (i ? ',' : '') + encode(a[i]);
      return out + ']';
    }
    if (Array.isArray(v)) {
      let out = '[';
      for (let i = 0; i < v.length; i++) out += (i ? ',' : '') + encode(v[i]);
      return out + ']';
    }
    if (typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      let out = '{';
      for (let i = 0; i < keys.length; i++) {
        out += (i ? ',' : '') + JSON.stringify(keys[i]) + ':' + encode(obj[keys[i]]);
      }
      return out + '}';
    }
    return JSON.stringify(String(v));
  };
  return encode(value);
}

/** FNV-1a 32×2，零依赖、确定性；输入为 canonicalize 后的稳定字符串 */
export function hashString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i++) {
    h1 = Math.imul(h1 ^ input.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + input.charCodeAt(i) + i, 0x85ebca6b) >>> 0;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
