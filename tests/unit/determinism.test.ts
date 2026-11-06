import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  createDefaultConfig,
  createInitialState,
  createTickWorkspace,
  runTick,
  serializeState,
  deserializeState,
  advanceRenderFrames,
  makeCommand,
  canonicalize,
} from '../../src/index.ts';

function fingerprint(r): string {
  return canonicalize({
    tickId: r.tickId,
    state: serializeState(r.state),
    delta: r.delta,
    attribution: r.attribution,
    events: r.events,
    stages: r.stages,
    cycleOutcome: r.cycleOutcome,
  });
}

function sourceFiles(): string[] {
  const core = readdirSync(join(process.cwd(), 'src/core')).map((f) => join('src/core', f));
  const sim = readdirSync(join(process.cwd(), 'src/simulation')).map((f) => join('src/simulation', f));
  return [...core, ...sim, 'src/index.ts'].filter((f) => f.endsWith('.ts'));
}

// S-03 验收 1 / 硬约束 1：同一 (S_t, commands, config) 连续结算与跨会话回放逐字节一致
test('S-03-1 连续两次结算 + 跨会话回放：Snapshot / Δ / 归因链逐字节一致', () => {
  const config = createDefaultConfig();
  const initial = createInitialState(config);
  const commands = [
    makeCommand.zone('z1', 1, 2, 2, 'R', 2),
    makeCommand.road('r1', 2, 2, 3),
    makeCommand.fund('f1', 1, 12),
    makeCommand.advance('a1', 4),
  ];

  const ws1 = createTickWorkspace(config, initial.side);
  const ws2 = createTickWorkspace(config, initial.side);
  const a = runTick(initial, commands, config, ws1);
  const b = runTick(initial, commands, config, ws2);
  assert.equal(fingerprint(a), fingerprint(b));

  // 跨会话：序列化 → 反序列化 → 从恢复态重放同一命令序列（同 tickId 起点）
  const restored = deserializeState(JSON.parse(JSON.stringify(serializeState(initial))), config);
  const ws3 = createTickWorkspace(config, restored.side);
  const c = runTick(restored, commands, config, ws3);
  assert.equal(fingerprint(a), fingerprint(c));
});

test('S-03-1 连续多个 tick 的序列回放仍逐字节一致', () => {
  const config = createDefaultConfig();
  const s0 = createInitialState(config);
  const ws = createTickWorkspace(config, s0.side);
  const wsReplay = createTickWorkspace(config, s0.side);
  let s = s0;
  let sr = s0;
  const traceA: string[] = [];
  const traceB: string[] = [];
  for (let i = 1; i <= 6; i++) {
    s = runTick(s, [makeCommand.advance(`a${i}`, i)], config, ws).state;
    sr = runTick(sr, [makeCommand.advance(`a${i}`, i)], config, wsReplay).state;
    traceA.push(canonicalize(serializeState(s)));
    traceB.push(canonicalize(serializeState(sr)));
  }
  assert.equal(traceA.join('|'), traceB.join('|'));
  assert.equal(s.tickId, 6);
});

// S-03 验收 2 / 硬约束 2：默认暂停，渲染帧循环不推进模拟
test('S-03-2 渲染帧推进任意帧数，模拟状态与 tickId 不变；仅 V6 触发一次结算', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  const ws = createTickWorkspace(config, state.side);
  const before = canonicalize(serializeState(state));

  const afterFrames = advanceRenderFrames(state, 10_000);
  assert.equal(afterFrames, state, '帧循环返回同一状态引用，不产生新状态');
  assert.equal(canonicalize(serializeState(afterFrames)), before);
  assert.equal(afterFrames.tickId, 0);

  const settled = runTick(afterFrames, [makeCommand.advance('v6', 1)], config, ws);
  assert.equal(settled.state.tickId, 1);
  assert.equal(settled.events.filter((e) => e.type === 'TickCommitted').length, 1);
});

test('硬约束 2：源码不存在倍速 / 自动播放 / 倒计时条 / 现实时间推进', () => {
  for (const file of sourceFiles()) {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    assert.doesNotMatch(src, /×1[×/]?2|autoPlay|auto_play|autoplay|setInterval|setTimeout|countdown|requestAnimationFrame/i, file);
  }
});

test('硬约束 1：源码无墙上时钟 / 原生随机 / 性能计时', () => {
  for (const file of sourceFiles()) {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    assert.doesNotMatch(src, /Date\.now|new Date\(|Math\.random|performance\.now|process\.hrtime/i, file);
  }
});

test('硬约束 1 / ADR-002 A9：热路径零分配（workspace 复用 20 次，allocations 恒为 0）', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  const ws = createTickWorkspace(config, state.side);
  let s = state;
  for (let i = 1; i <= 20; i++) {
    s = runTick(s, [makeCommand.advance(`a${i}`, i)], config, ws).state;
  }
  assert.equal(ws.allocations, 0);
  assert.equal(s.tickId, 20);
});
