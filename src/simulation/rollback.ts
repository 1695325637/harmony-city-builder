/**
 * HC-01 纯逻辑层 · 回退内核（S-11 / T-143 · W4 第二批 G 线）
 *
 * 权威口径：`production/epics/epic-breakdown.md` S-11 验收 1/2、ADR-002 A6 / A-6、
 * `architecture.md` §4.3、`design/gdd/systems/04-budget-economy.md` E3 / E7 / AC-E4、
 * `tests/smoke-checklist.md` SM-W4-04。
 *
 * 【核心纪律】本模块**只做「恢复」，不做任何逆运算**（ADR-002 A6）：
 * 回退 = 取周期起始 KEYFRAME 反序列化，丢弃其后 Delta。本文件内
 * **不存在任何对 budget / cells / frames 的反向加减**，也不含任何
 * 「撤销上一步」的算术（是否「逆运算」可由静态扫描判定：无 budget 标识符、无 `-=`）。
 *
 * 【tickId 单调不复用】回退不是「回到旧 tick」，而是**开启一条新分支**：
 * - 恢复态携带的是周期起始的内容，但头部 tickId 取 `已用最大 tickId + 1`，
 *   因此下一次 `runTick` 产出 `已用最大 + 2`，**任何历史 tickId 都不会被复用**。
 * - 该新分支的起点同时以 **KEYFRAME** 写入归档，使「重复回退 / 后续再回退」都有落点；
 *   旧分支条目**一条不删、一条不改**（`SnapshotStore.put` 对同 tickId 直接抛错，
 *   本模块只会写全新 tickId，天然不覆盖）。
 *
 * 【cycleId 语义：回退后是「分支标签」，不是「已玩周期数」】（主理人 2026-11-07 裁定 3，口径写死）
 * 回退时取 `cycleId = max(归档最大, 回退前头部) + 1`，因此它**永不低于回退前的值**（不倒退），
 * 归档按 cycleId 天然分段、旧分支可整段复盘（SM-W4-04「旧分支归档保留供复盘」）；
 * `cycleTickIndex` 归 0，与新周期起点一致。
 *
 * **明确警告下游（诊断面板 / 存档 / 后续 Story）**：一次回退会让 `cycleId` **前进 2**
 * （回退分支标签 1 次 + 回退后重新结算 1 次），所以 **`cycleId` ≠ 玩家「已玩周期数」**，
 * 也**不可**用作 UI 上的「第 N 周期」序号或统计口径；需要「已玩周期数」时请另设独立计数器
 * （本批不引入，属后续 Story / 组合根职责）。此语义属刻意取捨，已如实登记，不得被静默改写。
 *
 * 【E7 互斥】周期末「判定 → 解锁 / 回退」互斥，同帧只发生其一：若最近一次结算结果为
 * `TARGET_MET`（该帧已解锁），本模块**拒绝回退**并给出可判定错误码 `UNLOCK_COMMITTED_THIS_FRAME`。
 *
 * 【诚实口径】真机未验证（`tests/quality-closure.md` v1.2 EX-03 顺延、准出阻塞）；
 * DoD D-2（「失败—诊断—修正—见效」完整体验）**人工判定未执行**，本模块只提供可测结构支撑，
 * 不声称该体验已达成。
 *
 * 零依赖：不 import `node:` / 引擎 / 平台模块；不读时钟、不产生随机数。
 */

import type { CityState, CycleOutcome } from '../core/types.ts';
import type { Config } from '../core/config.ts';
import type { TickSnapshot } from './snapshot.ts';
import { buildTickSnapshot, type RestoreResult, type StoredSnapshot } from './snapshot.ts';

/**
 * 本模块需要的最小归档能力（结构化约束）。
 * `InMemorySnapshotStore` 天然满足；未来真机归档实现只要满足此形状即可复用本内核，
 * 无需改动 `snapshot.ts`（S-05 契约不动）。
 */
export interface RollbackStore {
  entries(): readonly StoredSnapshot[];
  get(tickId: number): TickSnapshot | null;
  put(snapshot: TickSnapshot): void;
  restore(tickId: number, config: Config): RestoreResult;
}

// ---------------------------------------------------------------------------
// 错误：全部可判定，绝不「静默回退到错误 tick」
// ---------------------------------------------------------------------------

export type RollbackErrorCode =
  /** 未提供归档介质（调用方未注入 SnapshotStore），无法定位周期起始快照 */
  | 'STORE_UNAVAILABLE'
  /** 归档为空，没有任何可恢复的 KEYFRAME */
  | 'EMPTY_ARCHIVE'
  /** 找不到目标周期的起始 KEYFRAME（已被淘汰 / 从未归档，如周期 0 的初始态未入档） */
  | 'CYCLE_START_KEYFRAME_MISSING'
  /** 目标周期号非法（负数 / 非整数 / 大于当前周期） */
  | 'INVALID_CYCLE_ID'
  /** E7：该帧已判定达标并解锁，同帧不得再回退 */
  | 'UNLOCK_COMMITTED_THIS_FRAME'
  /** 结算进行中（InputGate 已锁），不得回退 */
  | 'SETTLING';

export class RollbackError extends Error {
  readonly code: RollbackErrorCode;

  constructor(code: RollbackErrorCode, message: string) {
    super(message);
    this.name = 'RollbackError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 周期起始 KEYFRAME 定位
// ---------------------------------------------------------------------------

/** 周期起始 KEYFRAME 描述（`cycleTickIndex === 0` 且自包含全量状态） */
export interface CycleStartKeyframe {
  readonly tickId: number;
  readonly cycleId: number;
}

function isSelfContainedKeyframe(e: StoredSnapshot): boolean {
  return e.kind === 'KEYFRAME' && e.frames !== null;
}

/**
 * 定位 `cycleId` 这个周期的**起始 KEYFRAME**：归档中 `cycleId` 相同且
 * `cycleTickIndex === 0` 的自包含 KEYFRAME（取最大 tickId，保证多条时取最新分支）。
 *
 * 为什么 `cycleTickIndex === 0` 就是周期起点：P7 在周期末把 `cycleTickIndex` 复位为 0
 * 并推进 `cycleId`（`tick-pipeline.ts` P7 段），该 tick 的快照因此同时是
 * 「上一周期末帧」与「本周期起点」（`snapshot.ts` 的 `isKeyframe` 规则）。
 *
 * 找不到即返回 null —— 调用方必须**显式失败**，不得退化到「更早的任意 KEYFRAME」静默继续。
 */
export function findCycleStartKeyframe(
  store: RollbackStore,
  cycleId: number,
): CycleStartKeyframe | null {
  const entries = store.entries();
  let best: CycleStartKeyframe | null = null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.cycleId !== cycleId || e.cycleTickIndex !== 0) continue;
    if (!isSelfContainedKeyframe(e)) continue;
    if (best === null || e.tickId > best.tickId) best = { tickId: e.tickId, cycleId: e.cycleId };
  }
  return best;
}

/** 归档中已用的最大 tickId / 最大 cycleId（空归档返回 -1，便于 +1 得 0 起点） */
export function archiveHighWaterMarks(store: RollbackStore): { tickId: number; cycleId: number } {
  const entries = store.entries();
  let tickId = -1;
  let cycleId = -1;
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].tickId > tickId) tickId = entries[i].tickId;
    if (entries[i].cycleId > cycleId) cycleId = entries[i].cycleId;
  }
  return { tickId, cycleId };
}

// ---------------------------------------------------------------------------
// E7 互斥守卫
// ---------------------------------------------------------------------------

/**
 * E7：周期末「判定 → 解锁 / 回退」互斥。最近一次结算已 `TARGET_MET`（该帧完成解锁）时，
 * 同帧再回退会撤掉已发生的解锁，故直接拒绝并给可判定错误码。
 * 该判定只读 `CycleOutcome`，不改任何状态，可单独复用与单测。
 */
export function assertRollbackAllowed(lastCycleOutcome: CycleOutcome): void {
  if (lastCycleOutcome === 'TARGET_MET') {
    throw new RollbackError(
      'UNLOCK_COMMITTED_THIS_FRAME',
      '该帧已判定达标并解锁（TARGET_MET），同帧不得回退（E7：解锁与回退互斥，只发生其一）',
    );
  }
}

// ---------------------------------------------------------------------------
// 周期级重试
// ---------------------------------------------------------------------------

export interface RetryCycleRequest {
  readonly store: RollbackStore;
  readonly config: Config;
  /** 回退前会话头部状态（只读；本函数不修改它） */
  readonly head: CityState;
  /** 目标周期号：要重跑的那个周期的**起点** */
  readonly targetCycleId: number;
  /** 最近一次结算结果（E7 互斥判据；无结算时为 'IN_CYCLE'） */
  readonly lastCycleOutcome: CycleOutcome;
}

export interface RetryCycleResult {
  /** 回退后的新头部状态（新分支起点，已重标 tickId / cycleId） */
  readonly state: CityState;
  /** 恢复自哪个 KEYFRAME 的 tickId（周期起始 tick） */
  readonly restoredFromTickId: number;
  /** 回退前头部 tickId */
  readonly previousHeadTickId: number;
  /** 回退后头部 tickId（新分支起点）；下一次 runTick 产出 +1 */
  readonly newHeadTickId: number;
  /** 回退前头部 cycleId（旧分支标签，归档中整段保留） */
  readonly previousCycleId: number;
  /** 回退后 cycleId（单调递增的新分支标签） */
  readonly newCycleId: number;
  /** 被放弃的 tick 数（previousHeadTickId − restoredFromTickId，仅作复盘参考） */
  readonly abortedTickCount: number;
  /** 本次回退写入归档的新分支 KEYFRAME 的 tickId（=== newHeadTickId） */
  readonly newBranchKeyframeTickId: number;
}

/**
 * 默认目标周期：周期边界（`cycleTickIndex === 0` 且 `cycleId > 0`）时取
 * 「刚刚结束的那个周期」= `cycleId - 1`；其余情况取当前周期 `cycleId`。
 * 该规则只依据状态本身推导，确定性与可回放。
 */
export function defaultTargetCycleId(head: CityState): number {
  if (head.cycleTickIndex === 0 && head.cycleId > 0) return head.cycleId - 1;
  return head.cycleId;
}

/**
 * 周期级重试：**恢复**周期起始 KEYFRAME，开启新分支。
 *
 * 步骤（全程只读归档 + 只写全新 tickId 的一条 KEYFRAME）：
 * 1. E7 守卫：`lastCycleOutcome === 'TARGET_MET'` → 抛 `UNLOCK_COMMITTED_THIS_FRAME`；
 * 2. 归档为空 → 抛 `EMPTY_ARCHIVE`；目标周期非法 → 抛 `INVALID_CYCLE_ID`；
 * 3. 定位周期起始 KEYFRAME；缺失 → 抛 `CYCLE_START_KEYFRAME_MISSING`（不退化到更早 tick）；
 * 4. `store.restore(起点 tickId, config)` 反序列化（内部含 D-01 兼容性断言）；
 * 5. 重标头部：`tickId = 已用最大 tickId + 1`、`cycleId = 已用最大 cycleId + 1`、
 *    `cycleTickIndex = 0`；**budget / cells / frames / unlockedRegions 一律原样取自恢复态**；
 * 6. 把新分支起点作为 KEYFRAME 写入归档（全新 tickId，不覆盖任何旧条目）。
 *
 * 幂等：本函数是**纯恢复 + 重标**，不含任何扣费 / 结算算术，重复调用不会重复扣费；
 * 但每调用一次会推进一次分支标签，故会话层需缓存结果以避免重复推进
 * （见 `session.ts` 的 `retryCycle()` 幂等重放）。
 */
export function retryCycle(req: RetryCycleRequest): RetryCycleResult {
  assertRollbackAllowed(req.lastCycleOutcome);

  const entries = req.store.entries();
  if (entries.length === 0) {
    throw new RollbackError('EMPTY_ARCHIVE', '归档为空，没有任何可恢复的周期起始快照');
  }
  const target = req.targetCycleId;
  if (!Number.isInteger(target) || target < 0 || target > req.head.cycleId) {
    throw new RollbackError(
      'INVALID_CYCLE_ID',
      `目标周期 ${String(target)} 非法（须为 0..${req.head.cycleId} 的整数）`,
    );
  }

  const start = findCycleStartKeyframe(req.store, target);
  if (start === null) {
    throw new RollbackError(
      'CYCLE_START_KEYFRAME_MISSING',
      `周期 ${target} 的起始 KEYFRAME 不在归档中（可能已淘汰或从未归档），拒绝回退以免落到错误的 tick`,
    );
  }

  // 恢复而非逆运算：反序列化 KEYFRAME，丢弃其后全部 Delta。
  const restored = req.store.restore(start.tickId, req.config);
  // 【store 契约一致性复核】不是「额外防线」——在当前 `InMemorySnapshotStore` 实现下本分支不可达：
  // 定位用的判据（cycleTickIndex===0 + KEYFRAME + frames 非 null）与 `restore` 内部的 KEYFRAME 判据
  // 同源，且 `start.tickId` 本身就是 KEYFRAME，倒序扫描必然命中它。此处保留是**防御自定义 store
  // 实现违约**（若某实现返回了另一个落点，说明归档与定位不一致，宁可拒绝也不回退到错误 tick）。
  // quality-lead T-145（N-05）已指出：不要在文档里把它宣传成「强防线」，其真实作用是契约复核。
  if (restored.keyframeTickId !== start.tickId) {
    throw new RollbackError(
      'CYCLE_START_KEYFRAME_MISSING',
      `恢复落点 ${restored.keyframeTickId} 与定位的周期起始 tick ${start.tickId} 不一致，拒绝回退`,
    );
  }

  const marks = archiveHighWaterMarks(req.store);
  const baseTickId = marks.tickId > req.head.tickId ? marks.tickId : req.head.tickId;
  const baseCycleId = marks.cycleId > req.head.cycleId ? marks.cycleId : req.head.cycleId;
  const newHeadTickId = baseTickId + 1;
  const newCycleId = baseCycleId + 1;

  // 重标头部：只有三个「身份标签」改变，状态内容全部来自恢复态（无任何逆运算）。
  const head: CityState = restored.state;
  head.tickId = newHeadTickId;
  head.cycleId = newCycleId;
  head.cycleTickIndex = 0;

  // 新分支起点入档：全新 tickId，旧分支一条不动。
  const snapshot: TickSnapshot = buildTickSnapshot({
    state: head,
    tickId: newHeadTickId,
    delta: [],
    attribution: [],
    commandTrace: [],
  });
  req.store.put(snapshot);

  return {
    state: head,
    restoredFromTickId: start.tickId,
    previousHeadTickId: req.head.tickId,
    newHeadTickId,
    previousCycleId: req.head.cycleId,
    newCycleId,
    abortedTickCount: Math.max(0, req.head.tickId - start.tickId),
    newBranchKeyframeTickId: newHeadTickId,
  };
}
