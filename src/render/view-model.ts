/**
 * HC-01 · 渲染内核 · 只读视图模型（S-06）
 *
 * 权威口径：ADR-004 §2 —— UI 与渲染只持有**只读 VM**，绝不写权威状态；
 * 渲染帧不触发模拟（OD-2 A 主动推进制：只有「结束本日」推进 tick）。
 *
 * 零拷贝策略（诚实标注）：
 * - `cells.*` 的 TypedArray 引用**直接共享**，不做防御性拷贝（每帧 5×1024 拷贝无意义）；
 * - **唯一复制项** = `changeStamp`（`inputVersion` 的 4KB 快照）。原因：内核 P1 写格时
 *   `inputVersion` 自增，且 `runTick` 复用同一 `stateScratch`（相邻 tick 的 cells 数组是
 *   同一引用）。若 diff 直接比对引用，同引用下永远无差异 → 必须留一份「上一帧版本戳」。
 * - 因此「只读」由三层守护共同保证，而非运行时不变量：
 *   ① 类型层：VM 字段全部 `readonly`，且不暴露 `CityState` 本体；
 *   ② 结构层：VM 与嵌套 cells 视图 `Object.freeze`（写入属性即抛错 / 静默失败）；
 *   ③ 证据层：`render-viewmodel.test.ts` 用 `canonicalize(state)` 指纹证明
 *      buildViewModel / diffViewModel 调用前后状态逐字节不变，并对 `src/render/`
 *      做「无写 state 路径」静态扫描。
 * - 若未来需要运行级不可写，可在 VM 前加一层 Proxy 或改用 SharedArrayBuffer 只读视图，
 *   本轮不做（性能与复杂度不划算）。
 */

import type { CityState } from '../core/types.ts';
import { canonicalize } from '../core/types.ts';

/** 只读单元格视图（TypedArray 引用共享；见文件头零拷贝策略） */
export interface CellsView {
  readonly zone: Uint8Array;
  readonly density: Uint8Array;
  readonly unlocked: Uint8Array;
  readonly region: Uint8Array;
  readonly inputVersion: Uint32Array;
}

export interface FactorsView {
  readonly f_c: number;
  readonly f_s: number;
  readonly f_e: number;
  readonly f_f: number;
}

export interface BudgetView {
  readonly B: number;
  readonly I_t: number;
  readonly I_f_lagged: number;
  readonly C_m_last: number;
}

/** 渲染层唯一数据来源（只读；不持有可写 state 引用） */
export interface RenderViewModel {
  readonly side: number;
  readonly tickId: number;
  readonly cycleId: number;
  readonly cycleTickIndex: number;
  readonly issueCount: number;
  readonly unlockedRegions: number;
  readonly S: number;
  readonly factors: FactorsView;
  readonly budget: BudgetView;
  readonly cells: CellsView;
  /** 变更戳快照（`inputVersion` 的 4KB 拷贝）：diff 的稳定基线，见文件头 */
  readonly changeStamp: Uint32Array;
  /** 供测试 / 诊断比对的只读指纹（构建时计算一次，渲染侧不重算模拟） */
  readonly fingerprint: string;
}

/**
 * 从权威状态投影出只读 VM。不复制大数组、不暴露可写引用、不产生任何副作用。
 * 调用后 `canonicalize(state)` 必须与调用前逐字节一致（用例断言）。
 */
export function buildViewModel(state: CityState): RenderViewModel {
  const cur = state.frames.current;
  const cells: CellsView = Object.freeze({
    zone: state.cells.zone,
    density: state.cells.density,
    unlocked: state.cells.unlocked,
    region: state.cells.region,
    inputVersion: state.cells.inputVersion,
  });
  const factors: FactorsView = Object.freeze({
    f_c: cur.factors[0],
    f_s: cur.factors[1],
    f_e: cur.factors[2],
    f_f: cur.factors[3],
  });
  const budget: BudgetView = Object.freeze({
    B: state.budget.B,
    I_t: state.budget.I_t,
    I_f_lagged: state.budget.I_f_lagged,
    C_m_last: state.budget.C_m_last,
  });
  const vm: RenderViewModel = {
    side: state.side,
    tickId: state.tickId,
    cycleId: state.cycleId,
    cycleTickIndex: state.cycleTickIndex,
    issueCount: state.issueCount,
    unlockedRegions: state.unlockedRegions,
    S: cur.S,
    factors,
    budget,
    cells,
    changeStamp: new Uint32Array(state.cells.inputVersion),
    fingerprint: canonicalize(state),
  };
  return Object.freeze(vm);
}

/**
 * 渲染差分：输出需要重绘的格索引（升序）。
 *
 * ⚠️ **只产「格级」信号**（D-08 / T-121 文档化）：本函数只比较 `changeStamp`
 * （`inputVersion` 快照）与兜底的 zone / density / unlocked，**不覆盖** `S` / `tickId` /
 * `cycleId` / `budget` 等非格字段。这些字段变化（如 P4 满意度、P7 预算结算）时本函数
 * 可能返回空数组——消费方须自行比对 `vm.S` / `vm.tickId` / `vm.budget`，或直接全量重建
 * 绘制列表。渲染层不监听模拟事件，也不因非格字段变化而重绘地块。
 *
 * 主信号 = `changeStamp`（P1 写格必 bump `inputVersion`，见内核 P1）。
 * 兜底：当两个 VM 的 cells 指向**不同**底层数组（不同 state 对象）时，再比对
 * zone / density / unlocked，防止上游未 bump 版本时漏更新。
 * 注意：同一 state 对象被就地改写而不 bump inputVersion 时不可检出——这是与内核的
 * 显式契约（P1 每次都 bump），已由 `render-viewmodel.test.ts` 钉为对应用例。
 */
export function diffViewModel(prev: RenderViewModel, next: RenderViewModel): number[] {
  const out: number[] = [];
  if (prev.side !== next.side) {
    const n = next.side * next.side;
    for (let i = 0; i < n; i++) out.push(i);
    return out;
  }
  const count = next.side * next.side;
  const pv = prev.changeStamp;
  const nv = next.changeStamp;
  const distinctBacking = prev.cells.zone !== next.cells.zone;
  const pz = prev.cells.zone;
  const nz = next.cells.zone;
  const pd = prev.cells.density;
  const nd = next.cells.density;
  const pu = prev.cells.unlocked;
  const nu = next.cells.unlocked;
  for (let i = 0; i < count; i++) {
    let changed = pv[i] !== nv[i];
    if (!changed && distinctBacking) {
      changed = pz[i] !== nz[i] || pd[i] !== nd[i] || pu[i] !== nu[i];
    }
    if (changed) out.push(i);
  }
  return out;
}

/** 便捷：格索引 → (gx, gy)（side 由 VM 携带，避免调用方重复传参） */
export function cellIndexToGrid(side: number, index: number): { gx: number; gy: number } {
  return { gx: index % side, gy: Math.floor(index / side) };
}

/** 诊断用：VM 与 cells 视图是否已冻结（结构层只读证据，用例断言） */
export function isViewModelFrozen(vm: RenderViewModel): boolean {
  return Object.isFrozen(vm) && Object.isFrozen(vm.cells) && Object.isFrozen(vm.factors) && Object.isFrozen(vm.budget);
}
