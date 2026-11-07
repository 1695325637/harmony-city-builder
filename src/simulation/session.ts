/**
 * HC-01 纯逻辑层 · 编排层（UI 与内核之间）
 *
 * 只经 advanceDay（V6「结束本日」）触发一次结算；暂停态编辑批量提交；
 * InputGate 在结算期间锁「推 / 改状态」；幂等键防连点。
 * 本层属于编排而非模拟热路径，允许少量分配；内核 runTick 仍为零分配。
 *
 * T-143（S-11 / G 线）新增：
 * - `SimulationOptions.snapshotStore`：**可选**归档介质。提供后每次成功结算自动归档一条快照，
 *   并启用 `retryCycle()`；不提供时行为与旧版完全一致（不归档，`retryCycle` 显式报错）。
 * - `retryCycle(targetCycleId?)`：周期级重试入口，委托 `rollback.ts`。回退 = 恢复周期起始
 *   KEYFRAME（无逆运算），头部 tickId / cycleId 单调重标，旧分支归档一条不删。
 *   同一目标周期连续调用为**幂等重放**（返回上次结果，不重复推进分支标签）。
 * - `lastCycleOutcome`：最近一次结算的 CycleOutcome（E7「解锁 / 回退互斥」判据来源）。
 *
 * 去重纪律不变（D-03）：命令与 ADVANCE 键仍在 `CommandQueue` / 本层去重，
 * 回退路径**不加**任何二次幂等校验，也不重置键集合（重试后的新「结束本日」须用新 key）。
 */

import type { CityState, Command, CycleOutcome, SimEvent, StageId, StageView } from '../core/types.ts';
import { assertConfigCompatible, type Config } from '../core/config.ts';
import { createCommandQueue, createInputGate, makeCommand, type CommandQueue, type InputGate } from './commands.ts';
import {
  createTickWorkspace,
  runTick,
  advanceRenderFrames,
  type TickResult,
  type TickWorkspace,
} from './tick-pipeline.ts';
import { buildTickSnapshot } from './snapshot.ts';
import {
  defaultTargetCycleId,
  retryCycle as runCycleRetry,
  RollbackError,
  type RetryCycleResult,
  type RollbackStore,
} from './rollback.ts';

export interface AdvanceResult {
  accepted: boolean;
  result?: TickResult;
  events: SimEvent[];
}

export interface Simulation {
  config: Config;
  state: CityState;
  workspace: TickWorkspace;
  queue: CommandQueue;
  gate: InputGate;
  readonly tickId: number;
  readonly pendingCount: number;
  readonly committedCount: number;
  /** 最近一次结算的 CycleOutcome（无结算时 'IN_CYCLE'）；E7 互斥判据来源 */
  readonly lastCycleOutcome: CycleOutcome;
  submit(cmd: Command): void;
  advanceDay(key: string): AdvanceResult;
  renderFrames(frames: number): void;
  /**
   * 周期级重试（S-11 验收 1/2）：恢复到 `targetCycleId` 周期的起始状态并开新分支。
   * `targetCycleId` 缺省按 `defaultTargetCycleId(state)` 推导（周期边界取刚结束的周期）。
   * 可判定失败：`SETTLING` / `EMPTY_ARCHIVE` / `INVALID_CYCLE_ID` /
   * `CYCLE_START_KEYFRAME_MISSING` / `UNLOCK_COMMITTED_THIS_FRAME`（E7）。
   */
  retryCycle(targetCycleId?: number): RetryCycleResult;
}

export interface SimulationOptions {
  onStage?: (stage: StageId, view: StageView) => void;
  /**
   * 可选归档介质：提供后每次成功结算自动 `put` 一条快照，并启用 `retryCycle()`。
   * 缺省 undefined 时与旧行为逐字节一致（不归档）。
   */
  snapshotStore?: RollbackStore;
}

function rejection(type: 'AdvanceRejected', reason: string): SimEvent[] {
  return [{ type, tickId: 0, stage: 'P0', commandId: '', reason }];
}

interface RetryMemo {
  readonly targetCycleId: number;
  readonly result: RetryCycleResult;
}

export function createSimulation(config: Config, state: CityState, options: SimulationOptions = {}): Simulation {
  // D-01（T-116）：入口即断言——session 是 UI 侧唯一编排入口，
  // configHash 不匹配的 state（如旧存档）在此拒绝，禁止静默续算（ADR-003 A3 / SM-W1-02）
  assertConfigCompatible(state, config);
  const workspace = createTickWorkspace(config, state.side);
  const queue = createCommandQueue();
  const gate = createInputGate();
  const seenAdvanceKeys = new Set<string>();
  const snapshotStore = options.snapshotStore;
  let committedCount = 0;
  let lastCycleOutcome: CycleOutcome = 'IN_CYCLE';
  // 回退幂等窗口：仅在上次回退之后、且尚未发生新的成功结算前有效。
  let retryMemo: RetryMemo | null = null;

  const sim: Simulation = {
    config,
    state,
    workspace,
    queue,
    gate,
    get tickId(): number {
      return sim.state.tickId;
    },
    get pendingCount(): number {
      return queue.size;
    },
    get committedCount(): number {
      return committedCount;
    },
    get lastCycleOutcome(): CycleOutcome {
      return lastCycleOutcome;
    },
    submit(cmd: Command): void {
      queue.enqueue(cmd);
    },
    advanceDay(key: string): AdvanceResult {
      if (gate.isLocked) return { accepted: false, events: rejection('AdvanceRejected', 'SETTLING') };
      if (seenAdvanceKeys.has(key)) return { accepted: false, events: rejection('AdvanceRejected', 'DUPLICATE') };
      seenAdvanceKeys.add(key);
      const commands = queue.drain();
      commands.push(makeCommand.advance(key, commands.length + 1));
      gate.lock();
      const result = runTick(sim.state, commands, config, workspace, {
        onStage: options.onStage,
      });
      gate.unlock();
      sim.state = result.state;
      let committed = 0;
      for (let i = 0; i < result.events.length; i++) {
        if (result.events[i].type === 'TickCommitted') committed++;
      }
      committedCount += committed;
      lastCycleOutcome = result.cycleOutcome;
      // 头部已推进 → 上一次回退的幂等窗口关闭（再次回退将重新计算新分支标签）。
      retryMemo = null;
      // 可选归档：仅提供介质时记录；不提供时零副作用（保持旧行为）。
      if (snapshotStore !== undefined && committed > 0) snapshotStore.put(buildTickSnapshot(result));
      return { accepted: true, result, events: result.events };
    },
    renderFrames(frames: number): void {
      sim.state = advanceRenderFrames(sim.state, frames);
    },
    retryCycle(targetCycleId?: number): RetryCycleResult {
      if (gate.isLocked) {
        throw new RollbackError('SETTLING', '结算进行中（InputGate 已锁），禁止回退');
      }
      if (snapshotStore === undefined) {
        throw new RollbackError(
          'STORE_UNAVAILABLE',
          '未提供归档介质（SimulationOptions.snapshotStore），无法定位周期起始快照',
        );
      }
      // 幂等重放：其间无新的成功结算 → 直接返回上次结果，不重复推进分支标签。
      // - 无参调用：语义恒为「重试刚失败的那个周期」，回退后该周期的默认推导会变化
      //   （新分支尚无结算），故只要上次也是无参调用即视为同一意图；
      // - 显式调用：目标周期相同即重放。
      if (retryMemo !== null && (targetCycleId === undefined || retryMemo.targetCycleId === targetCycleId)) {
        return retryMemo.result;
      }
      const target = targetCycleId === undefined ? defaultTargetCycleId(sim.state) : targetCycleId;
      const result = runCycleRetry({
        store: snapshotStore,
        config,
        head: sim.state,
        targetCycleId: target,
        lastCycleOutcome,
      });
      sim.state = result.state;
      retryMemo = { targetCycleId: target, result };
      return result;
    },
  };
  return sim;
}
