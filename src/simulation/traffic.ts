/**
 * HC-01 纯逻辑层 · 最小可注入通勤图求解（S-04 之前的占位实现）
 *
 * 本轮只满足 A-4 的三条硬约束（architecture §11.6）：
 *   ① T_c 随拥堵单调不减；② 不可达显式处理 + 除零保护；③ 确定性可回放。
 * 采用「同类型 4-邻接连通块合并」（B ≤ config.maxBlocks，非逐格 OD 矩阵），
 * ROAD 格构成图节点，BFS 求块间路径；不做性能基准、不做迭代流量分配（S-04）。
 *
 * 所有时长走通勤图路径，不使用静态距离（P3）；不可达一律返回 T_max，
 * 绝不产生 Infinity / NaN（GDD 03 §3.2 / E1 E5 E7）。
 */

import { ZONE_EMPTY_INDEX, ZONE_ROAD_INDEX, type CityState } from '../core/types.ts';
import { clamp, safeDiv, type Config } from '../core/config.ts';
import { zoneIndex } from '../core/schema.ts';

export type FlowStateEnum = 'clear' | 'slow' | 'congested';

/**
 * 边槽无落点哨兵（T-137 / S-09 第二批 C 线）：-1 表示「该边槽未写入 / 无可绘制格」。
 * 与「格 0」严格区分：0 是合法格索引，绝不拿 0 冒充。
 */
export const NO_EDGE_CELL = -1;

export interface TrafficResult {
  T_c: number;
  t_g: Float64Array;
  d: Float64Array;
  qOverCap: Float64Array;
  /** 流线三态枚举（GDD 03 §3.5）：与 `qOverCap` 同长、逐边对齐，纯视觉派生量 */
  flowState: FlowStateEnum[];
  /**
   * 逐边落点格索引（T-137）：与 `qOverCap` / `flowState` 同长、逐边对齐。
   * 值语义：`>= 0` = 通勤图块拓扑里的真实格索引（该边起点 R 连通块的代表格 `blockRep[rb]`，
   * 即 flood fill 的最小格索引）；`NO_EDGE_CELL`(-1) = 该边槽未写入、无落点。
   * **纯视觉派生量**：只供渲染层出叠层，绝不进入 `T_c / f_c / f_s / S` 计分链（AC-T8 ④）。
   * 严禁填 `qSlot` / 循环下标当 cellIndex。
   */
  edgeCells: Int32Array;
  unreachable: boolean;
  blocks: number;
  /** 环境负荷 E（LU），由通勤图距离聚合，供 01 的 f_e */
  E: number;
  population: number;
  jobs: number;
  qTotal: number;
  /** P2 产物：Σ P_b × a_b 与 Σ P_b，供 P3 复用计算 f_s */
  serviceWeightedAccess: number;
  serviceWeightTotal: number;
}

/**
 * 流线三态分类（GDD 03 §3.5.2）：唯一真源在模拟层 P2。
 * 基准 = §4 钳制后的逐边饱和度 `qOverCap`（已落在 [0, (q/cap)_max]）；
 * 分类只决定 `flowState` 的分档位置，**绝不进入 T_c / f_c / f_s / S 计分链**（AC-T8 ④）。
 *
 * 开闭性（写死，便于断言）：
 *   q/cap >  θ_slow        → 'congested'
 *   θ_clear < q/cap ≤ θ_slow → 'slow'
 *   q/cap ≤  θ_clear        → 'clear'
 *
 * 纯函数、确定性：同输入同输出，无 NaN（qOverCap 已在 §4 钳制为有限值）。
 */
export function classifyFlowState(qOverCap: number, config: Config): FlowStateEnum {
  if (qOverCap > config.flowSlowMaxQOverCap) return 'congested';
  if (qOverCap > config.flowClearMaxQOverCap) return 'slow';
  return 'clear';
}

export interface TrafficWorkspace {
  side: number;
  cellCount: number;
  dist: Float64Array;
  queue: Int32Array;
  visited: Uint8Array;
  neighbourScratch: Int32Array;
  anchorScratch: Int32Array;
  blockId: Int32Array;
  blockZone: Int32Array;
  blockRep: Int32Array;
  blockAnchor: Int32Array;
  blockP: Float64Array;
  blockJ: Float64Array;
  blockService: Float64Array;
  blockCount: number;
  t_g: Float64Array;
  d: Float64Array;
  qOverCap: Float64Array;
  /** 逐边落点格索引 scratch（T-137）：预分配、每次 solve 复用并重置，零热路径分配。 */
  edgeCells: Int32Array;
  result: TrafficResult;
}

export function createTrafficWorkspace(side: number, config: Config): TrafficWorkspace {
  const cellCount = side * side;
  const capacity = config.maxBlocks;
  const t_g = new Float64Array(cellCount);
  const d = new Float64Array(capacity * capacity);
  const qOverCap = new Float64Array(capacity);
  const edgeCells = new Int32Array(capacity);
  edgeCells.fill(NO_EDGE_CELL);
  const ws: TrafficWorkspace = {
    side,
    cellCount,
    dist: new Float64Array(cellCount),
    queue: new Int32Array(cellCount),
    visited: new Uint8Array(cellCount),
    neighbourScratch: new Int32Array(4),
    anchorScratch: new Int32Array(4),
    blockId: new Int32Array(cellCount),
    blockZone: new Int32Array(capacity),
    blockRep: new Int32Array(capacity),
    blockAnchor: new Int32Array(capacity),
    blockP: new Float64Array(capacity),
    blockJ: new Float64Array(capacity),
    blockService: new Float64Array(capacity),
    blockCount: 0,
    t_g,
    d,
    qOverCap,
    edgeCells,
    result: {
      T_c: 0,
      t_g,
      d,
      qOverCap,
      flowState: [],
      edgeCells,
      unreachable: false,
      blocks: 0,
      E: 0,
      population: 0,
      jobs: 0,
      qTotal: 0,
      serviceWeightedAccess: 0,
      serviceWeightTotal: 0,
    },
  };
  return ws;
}

/** 固定顺序：上 / 右 / 下 / 左（确定性平局打破，GDD 03 E3） */
function neighbourIndices(side: number, i: number, out: Int32Array): number {
  const x = i % side;
  const y = (i / side) | 0;
  let n = 0;
  if (y > 0) out[n++] = i - side;
  if (x + 1 < side) out[n++] = i + 1;
  if (y + 1 < side) out[n++] = i + side;
  if (x > 0) out[n++] = i - 1;
  return n;
}

function bfsFrom(start: number, cells: CityState['cells'], ws: TrafficWorkspace): void {
  ws.visited.fill(0);
  ws.dist.fill(Number.POSITIVE_INFINITY);
  let head = 0;
  let tail = 0;
  ws.queue[tail++] = start;
  ws.visited[start] = 1;
  ws.dist[start] = 0;
  while (head < tail) {
    const cur = ws.queue[head++];
    const n = neighbourIndices(ws.side, cur, ws.neighbourScratch);
    for (let k = 0; k < n; k++) {
      const ni = ws.neighbourScratch[k];
      if (ws.visited[ni]) continue;
      if (cells.zone[ni] !== ZONE_ROAD_INDEX) continue;
      ws.visited[ni] = 1;
      ws.dist[ni] = ws.dist[cur] + 1;
      ws.queue[tail++] = ni;
    }
  }
}

/** 找格接入 ROAD 图的最小节点索引；-1 表示无接入（不可达） */
function findAnchor(i: number, cells: CityState['cells'], ws: TrafficWorkspace): number {
  const n = neighbourIndices(ws.side, i, ws.anchorScratch);
  let best = -1;
  for (let k = 0; k < n; k++) {
    const ni = ws.anchorScratch[k];
    if (cells.zone[ni] === ZONE_ROAD_INDEX && (best < 0 || ni < best)) best = ni;
  }
  return best;
}

/** 两个块之间的通勤图路径时长；不可达 → T_max（不返回 Infinity） */
function pathTimeBetween(
  from: number,
  to: number,
  cells: CityState['cells'],
  ws: TrafficWorkspace,
  config: Config,
  edgeTime: number,
  result: TrafficResult,
): number {
  const a = ws.blockAnchor[from];
  const b = ws.blockAnchor[to];
  if (a < 0 || b < 0) {
    result.unreachable = true;
    return config.T_max;
  }
  bfsFrom(a, cells, ws);
  const edges = ws.dist[b];
  if (!Number.isFinite(edges)) {
    result.unreachable = true;
    return config.T_max;
  }
  return edges * edgeTime;
}

export function solveTraffic(state: CityState, config: Config, ws: TrafficWorkspace): TrafficResult {
  const cells = state.cells;
  const side = state.side;
  const count = ws.cellCount;
  const zR = zoneIndex(config, 'R');
  const zC = zoneIndex(config, 'C');
  const zI = zoneIndex(config, 'I');

  const r = ws.result;
  r.T_c = 0;
  r.unreachable = false;
  r.E = 0;
  r.population = 0;
  r.jobs = 0;
  r.qTotal = 0;
  r.serviceWeightedAccess = 0;
  r.serviceWeightTotal = 0;
  ws.t_g.fill(config.T_s_max);
  ws.d.fill(0);
  ws.qOverCap.fill(0);
  // 逐边落点每次 solve 重置为哨兵：workspace 复用时不得残留上一 tick 的格坐标。
  // 纯视觉派生量，重置不影响 T_c / f_c / f_s / S 计分链（AC-T8 ④）。
  ws.edgeCells.fill(NO_EDGE_CELL);
  ws.blockId.fill(-1);

  // ---- ① 同类型 4-邻接连通块合并（B ≤ maxBlocks，不做逐格 OD 矩阵） ----
  ws.blockCount = 0;
  const flood = ws.queue;
  for (let i = 0; i < count; i++) {
    if (ws.blockId[i] !== -1) continue;
    const z = cells.zone[i];
    if (z === ZONE_EMPTY_INDEX || z === ZONE_ROAD_INDEX) {
      ws.blockId[i] = -2;
      continue;
    }
    if (ws.blockCount >= config.maxBlocks) {
      ws.blockId[i] = -2;
      continue;
    }
    const b = ws.blockCount;
    let head = 0;
    let tail = 0;
    flood[tail++] = i;
    ws.blockId[i] = b;
    let rep = i;
    let anchor = -1;
    let P = 0;
    let J = 0;
    while (head < tail) {
      const cur = flood[head++];
      if (cur < rep) rep = cur;
      const d = cells.density[cur];
      const coeff = d > 0 && d <= 3 ? config.densityCoefficients[d - 1] : 0;
      if (z === zR) P += config.p_unit * coeff;
      else if (z === zC) J += config.j_C * coeff;
      else if (z === zI) J += config.j_I * coeff;
      const a = findAnchor(cur, cells, ws);
      if (a >= 0 && (anchor < 0 || a < anchor)) anchor = a;
      const n = neighbourIndices(side, cur, ws.neighbourScratch);
      for (let k = 0; k < n; k++) {
        const ni = ws.neighbourScratch[k];
        if (ws.blockId[ni] !== -1) continue;
        if (cells.zone[ni] !== z) continue;
        ws.blockId[ni] = b;
        flood[tail++] = ni;
      }
    }
    ws.blockZone[b] = z;
    ws.blockRep[b] = rep;
    ws.blockAnchor[b] = anchor;
    ws.blockP[b] = P;
    ws.blockJ[b] = J;
    ws.blockService[b] = config.T_s_max;
    ws.blockCount++;
  }

  let population = 0;
  let jobs = 0;
  let industryJobs = 0;
  for (let b = 0; b < ws.blockCount; b++) {
    population += ws.blockP[b];
    jobs += ws.blockJ[b];
    if (ws.blockZone[b] === zI) industryJobs += ws.blockJ[b];
  }
  r.population = population;
  r.jobs = jobs;
  const qTotal = population * config.r_labor;
  r.qTotal = qTotal;

  const capDen = Math.max(config.cap, config.epsilon);
  const qoc = clamp(safeDiv(qTotal, capDen, 0, config.epsilon), 0, config.qcapMax);
  const congestion = 1 + config.beta * Math.pow(qoc, config.gamma);
  const edgeTime = safeDiv(1, Math.max(config.v0, config.epsilon), config.T_max, config.epsilon) * congestion;

  // ---- ② 生活服务流 R → C：产出 t_g / serviceWeightedAccess（供 P3 复用 P2） ----
  let cBlock = -1;
  for (let b = 0; b < ws.blockCount; b++) {
    if (ws.blockZone[b] === zC && (cBlock < 0 || ws.blockRep[b] < ws.blockRep[cBlock])) cBlock = b;
  }
  for (let b = 0; b < ws.blockCount; b++) {
    if (ws.blockZone[b] !== zR) continue;
    const t = cBlock >= 0
      ? pathTimeBetween(b, cBlock, cells, ws, config, edgeTime, r)
      : config.T_s_max;
    ws.blockService[b] = t;
    const a = clamp(1 - safeDiv(t, Math.max(config.T_s_max, config.epsilon), 1, config.epsilon), 0, 1);
    r.serviceWeightedAccess += ws.blockP[b] * a;
    r.serviceWeightTotal += ws.blockP[b];
    ws.t_g[ws.blockRep[b]] = t;
  }

  // ---- ③ 上班流 R → I：产出 T_c；同时按通勤图距离聚合 E（供 01 的 f_e） ----
  let weighted = 0;
  let demand = 0;
  let qSlot = 0;
  let dSlot = 0;
  for (let rb = 0; rb < ws.blockCount; rb++) {
    if (ws.blockZone[rb] !== zR) continue;
    for (let ib = 0; ib < ws.blockCount; ib++) {
      if (ws.blockZone[ib] !== zI) continue;
      const shareR = safeDiv(ws.blockP[rb], population, 0, config.epsilon);
      const shareI = safeDiv(ws.blockJ[ib], industryJobs, 0, config.epsilon);
      const q = qTotal * shareR * shareI;
      if (q <= 0) continue;
      const t = pathTimeBetween(rb, ib, cells, ws, config, edgeTime, r);
      weighted += q * t;
      demand += q;
      if (qSlot < ws.qOverCap.length) {
        ws.qOverCap[qSlot] = qoc;
        // 该边槽的落点 = 本条 R→I 边的起点 R 连通块代表格（flood fill 的最小格索引，
        // 真实格坐标，来自通勤图块拓扑）；绝不拿 qSlot / 循环下标冒充 cellIndex。
        // 纯视觉派生量：只写落点，不参与 weighted / demand / E / T_c 的任何累加。
        ws.edgeCells[qSlot] = ws.blockRep[rb];
        qSlot++;
      }
      if (dSlot < ws.d.length) ws.d[dSlot++] = t;
      r.E += safeDiv(ws.blockJ[ib] * ws.blockP[rb], 1 + t, 0, config.epsilon);
    }
  }
  r.T_c = demand > 0 ? clamp(safeDiv(weighted, demand, 0, config.epsilon), 0, config.T_max) : 0;
  r.blocks = ws.blockCount;
  if (r.unreachable && demand > 0) r.T_c = config.T_max;

  // ---- ④ 流线三态枚举（GDD 03 §3.5）：与 qOverCap 同长、逐边对齐 ----
  // 分类基准 = §4 钳制后的逐边饱和度（已落 [0, (q/cap)_max]）；
  // **只决定视觉分档位置，绝不进入 T_c / f_c / f_s / S 计分链**（AC-T8 ④）。
  // 未写入的边（qOverCap = 0）→ 'clear'（无流量即畅通，属诚实结果）。
  const fs: FlowStateEnum[] = new Array(ws.qOverCap.length);
  for (let i = 0; i < ws.qOverCap.length; i++) {
    fs[i] = classifyFlowState(ws.qOverCap[i], config);
  }
  r.flowState = fs;
  return r;
}
