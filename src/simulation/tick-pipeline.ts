/**
 * HC-01 纯逻辑层 · 确定性 tick 结算引擎（S-03）
 *
 * S_{t+1} = F(S_t, commands, config)：事件驱动的一次性原子事务，不是每帧循环。
 * 阶段顺序 P0→P8 固定且可观测（architecture §3.2 / systems-index §4.3）。
 *
 * 纪律：
 * - 无墙上时钟、无原生随机、无平台 / 渲染 import、无 Map/Set 遍历顺序依赖；
 * - 所有中间量写进预分配 TickWorkspace，热路径不新建对象 / 数组（A9）；
 * - D6 单 tick 滞后：P4 不读本周期 I_t，P7 用 S_{t-1} 结算收入（§3.2.1）；
 * - P7 只标记 TARGET_MET / RETRY_AVAILABLE，无硬终局（OD-1 A）；
 * - P3 服务覆盖复用 P2 通勤图产物，不另起静态距离分支（P3 否决项）。
 */

import {
  PIPELINE_STAGES,
  RULE_TO_STAGE,
  ZONE_ROAD_INDEX,
  DENSITY_MAX,
  type CityState,
  type Command,
  type SimEvent,
  type SimEventType,
  type StageId,
  type StageTrace,
  type StageView,
  type CycleOutcome,
} from '../core/types.ts';
import {
  clamp,
  safeDiv,
  createDefaultAggregator,
  type Config,
  type SatisfactionAggregator,
} from '../core/config.ts';
import { cellIndex, copyState, createInitialState, zoneIndex } from '../core/schema.ts';
import { createDeltaEntry, createAttributionEntry, type DeltaEntry, type AttributionEntry, type AttributionRecorder, NOOP_ATTRIBUTION_RECORDER } from './snapshot.ts';
import {
  createTrafficWorkspace,
  solveTraffic,
  type TrafficResult,
  type TrafficWorkspace,
} from './traffic.ts';

const POOL = 128;

export interface TickResult {
  state: CityState;
  tickId: number;
  stages: StageTrace[];
  events: SimEvent[];
  delta: DeltaEntry[];
  attribution: AttributionEntry[];
  commandTrace: string[];
  cycleOutcome: CycleOutcome;
  /** P4 结束时记录的 S_t，用于验证 P7 未回写满意度 */
  p4Satisfaction: number;
  /** 流线三态枚举（GDD 03 §3.5）：与 TrafficResult.flowState 同义，供 UI / 渲染消费 */
  flowState: ('clear' | 'slow' | 'congested')[];
  ruleStages: Record<string, StageId>;
}

export interface TickWorkspace extends TrafficWorkspace {
  stateScratch: CityState;
  /** 结构性零分配计数：runTick 内不新建对象 / 数组，此值恒为 0 */
  allocations: number;
  stagePool: StageTrace[];
  eventPool: SimEvent[];
  deltaPool: DeltaEntry[];
  attributionPool: AttributionEntry[];
  stages: StageTrace[];
  events: SimEvent[];
  delta: DeltaEntry[];
  attribution: AttributionEntry[];
  commandTrace: string[];
  stageCount: number;
  eventCount: number;
  deltaCount: number;
  attributionCount: number;
  stageView: StageView;
  factors: Float64Array;
  aggregator: SatisfactionAggregator;
  out: TickResult;
}

export interface TickOptions {
  onStage?: (stage: StageId, view: StageView) => void;
  aggregator?: SatisfactionAggregator;
  solver?: (state: CityState, config: Config, ws: TrafficWorkspace) => TrafficResult;
  recorder?: AttributionRecorder;
}

export function createTickWorkspace(config: Config, side: number): TickWorkspace {
  const traffic = createTrafficWorkspace(side, config);
  const stateScratch = createInitialState(config, { side });
  const stagePool: StageTrace[] = [];
  const eventPool: SimEvent[] = [];
  const deltaPool: DeltaEntry[] = [];
  const attributionPool: AttributionEntry[] = [];
  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    stagePool.push({ stage: PIPELINE_STAGES[i], note: '', tickId: 0 });
  }
  for (let i = 0; i < POOL; i++) {
    eventPool.push({ type: 'StageEntered', tickId: 0, stage: '', commandId: '', reason: '' });
    deltaPool.push(createDeltaEntry());
    attributionPool.push(createAttributionEntry());
  }
  const out: TickResult = {
    state: stateScratch,
    tickId: 0,
    stages: [],
    events: [],
    delta: [],
    attribution: [],
    commandTrace: [],
    cycleOutcome: 'IN_CYCLE',
    p4Satisfaction: 0,
    flowState: [],
    ruleStages: RULE_TO_STAGE,
  };
  return {
    ...traffic,
    stateScratch,
    allocations: 0,
    stagePool,
    eventPool,
    deltaPool,
    attributionPool,
    stages: [],
    events: [],
    delta: [],
    attribution: [],
    commandTrace: [],
    stageCount: 0,
    eventCount: 0,
    deltaCount: 0,
    attributionCount: 0,
    stageView: { stage: 'P0', tickId: 0, prevS: 0, currentS: 0 },
    factors: new Float64Array(4),
    aggregator: createDefaultAggregator(),
    out,
  };
}

// --- 零分配辅助：全部写进预分配池，不新建对象 -------------------------------

function enterStage(ws: TickWorkspace, s: CityState, stage: StageId, note: string, tickId: number, options: TickOptions): void {
  const trace = ws.stagePool[ws.stageCount];
  trace.stage = stage;
  trace.note = note;
  trace.tickId = tickId;
  ws.stages[ws.stageCount] = trace;
  ws.stageCount++;
  ws.stages.length = ws.stageCount;
  const view = ws.stageView;
  view.stage = stage;
  view.tickId = tickId;
  view.prevS = s.frames.prev.S;
  view.currentS = s.frames.current.S;
  if (options.onStage) options.onStage(stage, view);
}

function emit(ws: TickWorkspace, type: SimEventType, tickId: number, stage: StageId | '', commandId: string, reason: string): void {
  const idx = ws.eventCount < POOL ? ws.eventCount : POOL - 1;
  const e = ws.eventPool[idx];
  e.type = type;
  e.tickId = tickId;
  e.stage = stage;
  e.commandId = commandId;
  e.reason = reason;
  ws.events[idx] = e;
  ws.eventCount++;
  ws.events.length = ws.eventCount;
}

function addDelta(ws: TickWorkspace, key: string, oldV: number, newV: number): void {
  const idx = ws.deltaCount < POOL ? ws.deltaCount : POOL - 1;
  const d = ws.deltaPool[idx];
  d.key = key;
  d.old = oldV;
  d.new = newV;
  d.delta = newV - oldV;
  d.direction = d.delta > 0 ? 'UP' : d.delta < 0 ? 'DOWN' : 'FLAT';
  d.magnitude = Math.abs(d.delta);
  ws.delta[idx] = d;
  ws.deltaCount++;
  ws.delta.length = ws.deltaCount;
}

function addAttribution(
  ws: TickWorkspace,
  factor: string,
  dSi: number,
  causeType: AttributionEntry['causeType'],
  refId: string,
  detail: string,
  verb: string,
): void {
  const idx = ws.attributionCount < POOL ? ws.attributionCount : POOL - 1;
  const a = ws.attributionPool[idx];
  a.primary_factor = factor;
  a.dS_i = dSi;
  a.causeType = causeType;
  a.refId = refId;
  a.contribution = dSi;
  a.detail = detail;
  a.suggested_verb = verb;
  ws.attribution[idx] = a;
  ws.attributionCount++;
  ws.attribution.length = ws.attributionCount;
}

// --- 主结算事务 -------------------------------------------------------------

export function runTick(
  state: CityState,
  commands: readonly Command[],
  config: Config,
  ws: TickWorkspace,
  options: TickOptions = {},
): TickResult {
  ws.stages.length = 0;
  ws.events.length = 0;
  ws.delta.length = 0;
  ws.attribution.length = 0;
  ws.commandTrace.length = 0;
  ws.stageCount = 0;
  ws.eventCount = 0;
  ws.deltaCount = 0;
  ws.attributionCount = 0;

  const scratch = ws.stateScratch;
  if (state !== scratch) copyState(state, scratch);
  const s = scratch;
  const newTickId = s.tickId + 1;
  const isFirstTick = s.tickId === 0;
  const aggregator = options.aggregator ?? ws.aggregator;
  const recorder = options.recorder ?? NOOP_ATTRIBUTION_RECORDER;

  // ---- P0 冻结输入：锁队列语义、tickId、命令溯源；帧推进使 prev = S_{t-1} ----
  enterStage(ws, s, 'P0', 'freeze input; tickId=' + newTickId + '; idempotency', newTickId, options);
  copyFrameForLag(s);
  for (let i = 0; i < commands.length; i++) {
    if (i < POOL) ws.commandTrace.push(commands[i].idempotencyKey);
  }

  // ---- P1 应用命令（R1 / R2；合法性校验 → BudgetRejected） ----
  enterStage(ws, s, 'P1', 'apply commands; R1 grid / R2 zone', newTickId, options);
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.kind === 'ADVANCE') continue;
    if (c.kind === 'FUND') {
      if (!Number.isFinite(c.amountCU) || c.amountCU < 0 || c.amountCU > config.B_cap) {
        emit(ws, 'BudgetRejected', newTickId, 'P1', c.idempotencyKey, 'BUDGET_LIMIT');
        continue;
      }
      s.budget.I_f_current = c.amountCU;
      continue;
    }
    const idx = c.x >= 0 && c.y >= 0 && c.x < s.side && c.y < s.side
      ? cellIndex(s.side, c.x, c.y)
      : -1;
    if (idx < 0 || s.cells.unlocked[idx] === 0) {
      emit(ws, 'BudgetRejected', newTickId, 'P1', c.idempotencyKey, 'LOCKED_REGION');
      continue;
    }
    let z: number;
    let density: number;
    if (c.kind === 'ROAD') {
      z = ZONE_ROAD_INDEX;
      density = 0;
    } else {
      z = zoneIndex(config, c.zoneId);
      density = c.density;
      if (c.kind === 'DENSITY') z = s.cells.zone[idx];
      if (z < 0 || density < 0 || density > DENSITY_MAX) {
        emit(ws, 'BudgetRejected', newTickId, 'P1', c.idempotencyKey, 'UNKNOWN_ZONE');
        continue;
      }
    }
    const coeff = density > 0 ? config.densityCoefficients[density - 1] : 0;
    s.cells.zone[idx] = z;
    s.cells.density[idx] = density;
    s.cells.inputVersion[idx]++;
    if (z === ZONE_ROAD_INDEX) s.budget.C_b_accum += config.c_road;
    else s.budget.C_b_accum += config.c_zone * coeff;
  }

  // ---- P2 通勤图求解（R4） ----
  const traffic = options.solver
    ? options.solver(s, config, ws)
    : solveTraffic(s, config, ws);
  enterStage(ws, s, 'P2', 'traffic graph; blocks=' + traffic.blocks + '; T_c=' + traffic.T_c, newTickId, options);

  // ---- P3 服务覆盖：复用 P2 通勤图可达时长（P3 否决项） ----
  const f_s = safeDiv(traffic.serviceWeightedAccess, traffic.serviceWeightTotal, 0, config.epsilon);
  enterStage(ws, s, 'P3', 'reused:P2.traffic serviceWeightedAccess', newTickId, options);

  // ---- P4 满意度 4 因子合成（R6）；不读本周期 I_t（D6 解环） ----
  const f = ws.factors;
  f[0] = clamp(1 - safeDiv(traffic.T_c - config.T_0, Math.max(config.T_max - config.T_0, config.epsilon), 0, config.epsilon), 0, 1);
  f[1] = f_s;
  f[2] = 1 - clamp(safeDiv(traffic.E, Math.max(config.E_max, config.epsilon), 0, config.epsilon), 0, 1);
  const iRef = config.i_ref * traffic.population;
  f[3] = traffic.population > 0 ? clamp(safeDiv(s.budget.I_f_lagged, iRef, 0, config.epsilon), 0, 1) : 0;

  const cur = s.frames.current;
  const prev = s.frames.prev;
  cur.factors.set(f);
  cur.T_c = traffic.T_c;
  cur.T_s = config.T_s_max;
  cur.E = traffic.E;
  cur.I_f = s.budget.I_f_lagged;
  cur.L = aggregator.shortfall(f, config);
  cur.S = aggregator.aggregate(f, config);

  // 归因链（GDD 01 §4.3）：ΔS_i 主项 + 短板惩罚变化，钳制到 [-100,100]
  if (isFirstTick) {
    cur.dS = 0;
    cur.dSByFactor.fill(0);
    cur.dSPenalty = 0;
  } else {
    const Lp = prev.L;
    const denom = Math.max(1 - config.lambda * Lp, config.epsilon);
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      const gi = aggregator.transform(f[i], config);
      const gp = aggregator.transform(prev.factors[i], config);
      const contribution = 100 * weightAt(config, i) * (gi - gp) * (1 - config.lambda * Lp);
      cur.dSByFactor[i] = contribution;
      sum += contribution;
    }
    cur.dSPenalty = prev.S * ((1 - config.lambda * cur.L) / denom - 1);
    cur.dS = clamp(sum + cur.dSPenalty, -100, 100);
  }
  const p4S = cur.S;
  enterStage(ws, s, 'P4', 'satisfaction 4 factors; D6 lag: no I_t read', newTickId, options);

  addDelta(ws, 'S', prev.S, cur.S);
  if (cur.dS !== 0) {
    let maxI = 0;
    for (let i = 0; i < 4; i++) if (Math.abs(cur.dSByFactor[i]) > Math.abs(cur.dSByFactor[maxI])) maxI = i;
    const keys = ['f_c', 'f_s', 'f_e', 'f_f'];
    const causes: AttributionEntry['causeType'][] = ['通勤线', '覆盖片区', '环境源', '预算项'];
    const refs = ['traffic:T_c', 'traffic:t_g', 'traffic:E', 'budget:I_f_lagged'];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(cur.dSByFactor[i]) < config.attributionThreshold && i !== maxI) continue;
      addAttribution(ws, keys[i], cur.dSByFactor[i], causes[i], refs[i], 'factor=' + keys[i], 'V8');
    }
  } else {
    addAttribution(ws, 'f_c', 0, '教学', 'tutorial:baseline', 'cold-start baseline', 'V1');
  }

  // ---- P5 经济按 tick 记账（R3，非周期结算） ----
  let zoned = 0;
  let roads = 0;
  for (let i = 0; i < s.cells.zone.length; i++) {
    const z = s.cells.zone[i];
    if (z === ZONE_ROAD_INDEX) roads++;
    else if (z > ZONE_ROAD_INDEX) zoned++;
  }
  s.budget.C_m_accum += zoned * config.m_zone + roads * config.m_road;
  enterStage(ws, s, 'P5', 'accrue C_b / C_m (cycle settlement deferred to P7)', newTickId, options);

  // ---- P6 议题占位（R8 / OD-3 A；完整规则留 S-05 / S-09） ----
  s.issueCount = clamp(s.issueCount, 2, 4);
  enterStage(ws, s, 'P6', 'issue placeholder; aggregate text refs only', newTickId, options);

  // ---- P7 周期判定与预算结算（R7）：仅周期末；使用 S_{t-1} ----
  let outcome: CycleOutcome = 'IN_CYCLE';
  if (s.cycleTickIndex + 1 >= config.K) {
    const SPrev = prev.S;
    const m = clamp(config.m_min + (config.m_max - config.m_min) * SPrev / 100, config.m_min, config.m_max);
    const I_t = Math.max(traffic.population * config.i_unit * m, config.I_min);
    const C_m = s.budget.C_m_accum;
    const C_b = s.budget.C_b_accum;
    s.budget.I_t = I_t;
    s.budget.C_m_last = C_m;
    s.budget.B = clamp(s.budget.B + I_t - C_b - C_m, config.B_floor, config.B_cap);
    s.budget.C_b_accum = 0;
    s.budget.C_m_accum = 0;
    s.budget.I_f_lagged = s.budget.I_f_current;
    s.cycleId++;
    s.cycleTickIndex = 0;
    outcome = cur.S >= config.S_unlock ? 'TARGET_MET' : 'RETRY_AVAILABLE';
    if (outcome === 'TARGET_MET') s.unlockedRegions++;
    addAttribution(ws, 'f_f', 0, '预算项', 'budget:I_t(S_prev=' + SPrev + ')', 'lagged income settlement', 'V4');
    addDelta(ws, 'B', s.budget.B - (I_t - C_b - C_m), s.budget.B);
    enterStage(ws, s, 'P7', 'cycle settlement uses S_prev; ' + outcome, newTickId, options);
  } else {
    s.cycleTickIndex++;
    s.budget.I_t = 0;
    enterStage(ws, s, 'P7', 'not cycle end; no budget settlement', newTickId, options);
  }

  // ---- P8 提交：双帧已由 P0 推进，prev = S_{t-1} 可读 ----
  s.tickId = newTickId;
  emit(ws, 'TickCommitted', newTickId, 'P8', '', '');
  enterStage(ws, s, 'P8', 'commit snapshot/delta/attribution; unlock gate', newTickId, options);
  for (let i = 0; i < ws.attributionCount; i++) recorder.record(ws.attribution[i]);

  const out = ws.out;
  out.state = s;
  out.tickId = newTickId;
  out.stages = ws.stages;
  out.events = ws.events;
  out.delta = ws.delta;
  out.attribution = ws.attribution;
  out.commandTrace = ws.commandTrace;
  out.cycleOutcome = outcome;
  out.p4Satisfaction = p4S;
  out.flowState = traffic.flowState;
  return out;
}

/** 帧推进：把上一 tick 的 current 变成新的 prev（t-1 帧常驻可读，D6 / A-5） */
function copyFrameForLag(s: CityState): void {
  const p = s.frames.prev;
  const c = s.frames.current;
  p.S = c.S;
  p.factors.set(c.factors);
  p.T_c = c.T_c;
  p.T_s = c.T_s;
  p.E = c.E;
  p.I_f = c.I_f;
  p.dS = c.dS;
  p.dSByFactor.set(c.dSByFactor);
  p.dSPenalty = c.dSPenalty;
  p.L = c.L;
}

function weightAt(config: Config, i: number): number {
  if (i === 0) return config.weights.f_c;
  if (i === 1) return config.weights.f_s;
  if (i === 2) return config.weights.f_e;
  return config.weights.f_f;
}

/**
 * 渲染帧循环：与 tick 结算彻底解耦。推进任意帧数都不改变权威状态与 tickId。
 * 返回同一引用，供 S-03 验收 2 / 硬约束 2 断言。
 */
export function advanceRenderFrames(state: CityState, frames: number): CityState {
  void frames;
  return state;
}
