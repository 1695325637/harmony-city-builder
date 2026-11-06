/**
 * HC-01 纯逻辑层 · 编排层（UI 与内核之间）
 *
 * 只经 advanceDay（V6「结束本日」）触发一次结算；暂停态编辑批量提交；
 * InputGate 在结算期间锁「推 / 改状态」；幂等键防连点。
 * 本层属于编排而非模拟热路径，允许少量分配；内核 runTick 仍为零分配。
 */

import type { CityState, Command, SimEvent, StageId, StageView } from '../core/types.ts';
import { assertConfigCompatible, type Config } from '../core/config.ts';
import { createCommandQueue, createInputGate, makeCommand, type CommandQueue, type InputGate } from './commands.ts';
import {
  createTickWorkspace,
  runTick,
  advanceRenderFrames,
  type TickResult,
  type TickWorkspace,
} from './tick-pipeline.ts';

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
  submit(cmd: Command): void;
  advanceDay(key: string): AdvanceResult;
  renderFrames(frames: number): void;
}

export interface SimulationOptions {
  onStage?: (stage: StageId, view: StageView) => void;
}

function rejection(type: 'AdvanceRejected', reason: string): SimEvent[] {
  return [{ type, tickId: 0, stage: 'P0', commandId: '', reason }];
}

export function createSimulation(config: Config, state: CityState, options: SimulationOptions = {}): Simulation {
  // D-01（T-116）：入口即断言——session 是 UI 侧唯一编排入口，
  // configHash 不匹配的 state（如旧存档）在此拒绝，禁止静默续算（ADR-003 A3 / SM-W1-02）
  assertConfigCompatible(state, config);
  const workspace = createTickWorkspace(config, state.side);
  const queue = createCommandQueue();
  const gate = createInputGate();
  const seenAdvanceKeys = new Set<string>();
  let committedCount = 0;

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
      return { accepted: true, result, events: result.events };
    },
    renderFrames(frames: number): void {
      sim.state = advanceRenderFrames(sim.state, frames);
    },
  };
  return sim;
}
