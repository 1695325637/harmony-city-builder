/**
 * HC-01 · S-10 验收 6 / D-03 · runTick 层幂等契约显式化（T-141 / F 线）
 *
 * 本文件【只做契约显式化 + 对照用例】，不修改 runTick / CommandQueue / Simulation
 * 的任何运行期行为（src/** 零改动），也不改动任何既有测试断言。
 *
 * 契约全文：tests/verification/s10-idempotency-contract.md
 * 依据：
 *   - production/epics/epic-breakdown.md §4 S-10 验收 6
 *   - tests/verification/w1-w2-verification.md v1.2 §5 D-03 / §7 裁定 (c)
 *   - tests/verification/w1-gate-remediation-evidence.md §1.3 / §4
 *   - tests/verification/edge-cases.test.ts V-05（本文件 ID-01~03 为复跑，不改原文件）
 *   - ADR-002 §2 子决策 1/2、§6 R-2、§7 A1；ADR-003 §2 子决策 3、§8 A3
 *
 * ⚠️ 真机口径（tests/quality-closure.md v1.2 EX-03）：本线为纯逻辑契约，
 *   可判 PASS；真机半侧 PARTIAL / BLOCKED，顺延且已登记为准出阻塞项。
 *   ID-06 使用 T-116 内存模拟介质 createInMemorySnapshotStore，
 *   **不声称真机持久化验证**，不依赖 E 线尚未落盘的 src/save/**。
 *
 * 运行：node --experimental-strip-types --test tests/unit/idempotency-contract.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_GRID_SIDE,
  ConfigMismatchError,
  canonicalize,
  cellIndex,
  createCommandQueue,
  createDefaultConfig,
  createInMemorySnapshotStore,
  createInitialState,
  createSimulation,
  createTickWorkspace,
  deserializeState,
  makeCommand,
  runTick,
  serializeState,
  zoneIndex,
  buildTickSnapshot,
  type Command,
} from '../../src/index.ts';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

// ---------------------------------------------------------------------------
// ① V-05 连点复跑（复跑 tests/unit/input-gate.test.ts + edge-cases V-05，不改原文件）
// ---------------------------------------------------------------------------

test('ID-01 · V-05 连点复跑：2/5 次连点只 +1 tick、TickCommitted=1、pending 不半应用、gate 锁', () => {
  const config = createDefaultConfig();
  const sim = createSimulation(config, createInitialState(config));

  // (a) 暂停态批量提交：权威状态指纹不变（不半应用）
  const before = canonicalize(serializeState(sim.state));
  sim.submit(makeCommand.zone('id01-z1', 1, 2, 2, 'R', 2));
  sim.submit(makeCommand.zone('id01-z2', 2, 3, 3, 'C', 1));
  sim.submit(makeCommand.road('id01-r1', 3, 2, 3));
  sim.submit(makeCommand.fund('id01-f1', 4, 10));
  assert.equal(canonicalize(serializeState(sim.state)), before, '提交阶段权威状态不变');
  assert.equal(sim.pendingCount, 4);

  // (b) 结算期 gate 锁 / 结束后解锁（onStage 在 P4 真实回调内读取）
  let lockedInside = false;
  const simGate = createSimulation(config, createInitialState(config), {
    onStage: (stage) => {
      if (stage === 'P4') lockedInside = simGate.gate.isLocked;
    },
  });
  simGate.advanceDay('id01-gate');
  assert.equal(lockedInside, true, '结算中 gate 处于 locked');
  assert.equal(simGate.gate.isLocked, false, '结算结束后 unlock');

  // (c) 首次推进：恰好 1 个 TickCommitted、pending 清空、tickId +1
  const first = sim.advanceDay('same-key');
  assert.equal(first.accepted, true);
  assert.ok(first.result, '首次推进必须产出 TickResult');
  assert.equal(first.result.events.filter((e) => e.type === 'TickCommitted').length, 1);
  assert.equal(sim.tickId, 1);
  assert.equal(sim.committedCount, 1);
  assert.equal(sim.pendingCount, 0, 'drain 后 pending 清空');

  // (d) 连点 5 次同 key 全部被 seenAdvanceKeys 拒绝
  for (let i = 0; i < 5; i++) {
    const again = sim.advanceDay('same-key');
    assert.equal(again.accepted, false, `第 ${i + 2} 次连点必须被幂等键拒绝`);
  }
  assert.equal(sim.tickId, 1, '2/5 次连点只 +1 tick');
  assert.equal(sim.committedCount, 1, 'TickCommitted 累计仍为 1');

  // (e) 另起一会话：连续 2 次连点也只结算 1 次
  const sim2 = createSimulation(config, createInitialState(config));
  assert.equal(sim2.advanceDay('double').accepted, true);
  assert.equal(sim2.advanceDay('double').accepted, false);
  assert.equal(sim2.tickId, 1);
  assert.equal(sim2.committedCount, 1);
});

test('ID-02 · 同 key 不同 payload：enqueue 第二次返回 false、drain() 仅 1 条', () => {
  const config = createDefaultConfig();
  const cmdA = makeCommand.zone('same', 1, 2, 2, 'R', 1);
  const cmdB = makeCommand.zone('same', 2, 2, 2, 'C', 3);

  // (a) CommandQueue 层（V-05(a) 复跑）
  const q = createCommandQueue();
  assert.equal(q.enqueue(cmdA), true);
  assert.equal(q.enqueue(cmdB), false, '同 key 不同 payload 必须被幂等键拒绝');
  const drained = q.drain();
  assert.equal(drained.length, 1, 'drain() 仅 1 条');
  assert.equal(drained[0].zoneId, 'R', '保留的是首次入队的 payload');
  assert.equal(drained[0].density, 1);
  assert.equal(q.size, 0);

  // (b) Simulation.submit 层（V-05(c) 复跑）
  const sim = createSimulation(config, createInitialState(config));
  sim.submit(makeCommand.zone('k', 1, 2, 2, 'R', 1));
  sim.submit(makeCommand.zone('k', 2, 2, 2, 'C', 3));
  assert.equal(sim.pendingCount, 1, 'submit 同 key 不同 payload 也只入队 1 条');
  const viaSubmit = sim.queue.drain();
  assert.equal(viaSubmit.length, 1);
  assert.equal(viaSubmit[0].zoneId, 'R');
});

// ---------------------------------------------------------------------------
// ② 反向对照：钉死「内核不二次校验」这一契约事实，不放宽实现
// ---------------------------------------------------------------------------

test('ID-03 · 反向对照：直接把 [cmdA(same,R), cmdB(same,C)] 喂 runTick → 两条都应用、commandTrace=[same,same]', () => {
  const config = createDefaultConfig();
  const i = cellIndex(MAX_GRID_SIDE, 2, 2);
  const cmdA = makeCommand.zone('same', 1, 2, 2, 'R', 1);
  const cmdB = makeCommand.zone('same', 2, 2, 2, 'C', 3);
  const r = runTick(
    createInitialState(config),
    [cmdA, cmdB],
    config,
    createTickWorkspace(config, MAX_GRID_SIDE),
  );

  assert.equal(r.state.cells.zone[i], zoneIndex(config, 'C'), '后者覆盖前者');
  assert.equal(r.state.cells.density[i], 3);
  assert.equal(r.state.cells.inputVersion[i], 2, '两条命令均应用（inputVersion +2）');
  assert.deepEqual([...r.commandTrace], ['same', 'same'], '溯源如实记录重复键');
  assert.equal(r.events.filter((e) => e.type === 'TickCommitted').length, 1);
  assert.equal(r.tickId, 1);
  // 这是契约外用法（调用方绕过 CommandQueue）的确定结果，不是缺陷、不静默纠错。
});

test('ID-04 · 反向对照补强：重复 ADVANCE 键 ≠ 重复结算（重复应用 / 多 tick 提交须区分）', () => {
  const config = createDefaultConfig();
  const r = runTick(
    createInitialState(config),
    [makeCommand.advance('same', 1), makeCommand.advance('same', 2)],
    config,
    createTickWorkspace(config, MAX_GRID_SIDE),
  );
  assert.deepEqual([...r.commandTrace], ['same', 'same'], '两条都记入溯源');
  assert.equal(r.tickId, 1, '一次 runTick = 一个 tick');
  assert.equal(
    r.events.filter((e) => e.type === 'TickCommitted').length,
    1,
    'P8 只提交一次；「重复结算」发生在 advanceDay 编排层，不是 runTick 内',
  );
});

test('ID-05 · 唯一权威入口结构正向证据：去重写在 commands / session，不在内核', () => {
  const commandsSrc = read('src/simulation/commands.ts');
  const sessionSrc = read('src/simulation/session.ts');
  assert.match(commandsSrc, /seen\.has\(cmd\.idempotencyKey\)/, 'CommandQueue.enqueue 持有 seen 集合');
  assert.match(sessionSrc, /queue\.enqueue\(cmd\)/, 'Simulation.submit 委托队列去重');
  assert.match(sessionSrc, /seenAdvanceKeys\.has\(key\)/, 'advanceDay 持有 V6 key 集合');
  assert.match(sessionSrc, /gate\.isLocked/, '编排层在结算期用 InputGate 拒绝重复点按');
});

// ---------------------------------------------------------------------------
// ③ 存档恢复后幂等键重建语义（只用 src/simulation/snapshot.ts，不依赖 src/save/**）
// ---------------------------------------------------------------------------

/** 造 3 个 tick 的内存模拟归档，测试侧自持命令序列供前向重放 */
function buildArchive() {
  const config = createDefaultConfig({ K: 3 });
  const store = createInMemorySnapshotStore();
  const ws = createTickWorkspace(config, MAX_GRID_SIDE);
  let state = createInitialState(config);
  const history: Command[][] = [];
  for (let t = 1; t <= 3; t++) {
    const cmds: Command[] = [
      makeCommand.zone('s10-z-' + t, 1, 4 + t, 5, 'R', 2),
      makeCommand.advance('s10-adv-' + t, 2),
    ];
    history.push(cmds);
    const r = runTick(state, cmds, config, ws);
    store.put(buildTickSnapshot(r));
    state = r.state;
  }
  return { config, store, history };
}

test('ID-06 · 存档恢复后幂等键重建：KEYFRAME 恢复 + 前向重放、tickId 单调、seen 从零重建', () => {
  const { config, store, history } = buildArchive();
  const snap3 = store.get(3);
  assert.ok(snap3, 't3 快照存在');
  assert.ok(snap3.commandTrace.includes('s10-adv-3'), '历史快照携带幂等键溯源');

  // (a) restore 的真实语义：落在目标 tick 之前（含）最近的 KEYFRAME，DELTA 不参与恢复
  const restored = store.restore(3, config);
  assert.equal(restored.requestedTickId, 3);
  assert.ok(restored.keyframeTickId >= 1 && restored.keyframeTickId <= 3);
  assert.equal(restored.state.tickId, restored.keyframeTickId, '恢复态 tickId = KEYFRAME tickId');

  // (b) 前向重放（ADR-002 A6：恢复 Keyframe + 重放，无逆运算）
  let replayed = restored.state;
  const replayWs = createTickWorkspace(config, MAX_GRID_SIDE);
  for (let t = restored.keyframeTickId + 1; t <= 3; t++) {
    replayed = runTick(replayed, history[t - 1], config, replayWs).state;
  }
  assert.equal(replayed.tickId, 3, '前向重放后到达目标 tick');

  // (c) 新建 Simulation = 新会话：键集合从零重建，历史 trace 不注入队列
  const sim2 = createSimulation(config, replayed);
  assert.equal(sim2.tickId, 3);
  assert.equal(sim2.pendingCount, 0, '恢复不继承旧会话 pending');
  assert.equal(sim2.queue.drain().length, 0, '恢复不注入任何历史命令');

  // (d) 旧会话用过的 key 在新会话可接受一次（seenAdvanceKeys 重建为空），
  //     但新会话自身的幂等立即生效 —— 这是「跨会话键命名空间未隔离」的如实披露
  const oldKey = 's10-adv-3';
  const first = sim2.advanceDay(oldKey);
  assert.equal(first.accepted, true, '旧 key 在新会话不构成拒绝依据（显式契约外语义）');
  assert.equal(sim2.tickId, 4, 'tickId 单调推进、不复用');
  assert.equal(sim2.committedCount, 1);
  const again = sim2.advanceDay(oldKey);
  assert.equal(again.accepted, false, '新会话自己的 seenAdvanceKeys 立即生效');
  assert.equal(sim2.tickId, 4);
  assert.equal(sim2.committedCount, 1);

  // (e) 归档同 tickId 条目禁覆盖（ADR-002 R-7 / tickId 单调不复用）
  assert.equal(store.get(3)!.tickId, 3);
  assert.throws(
    () => store.put(buildTickSnapshot({
      state: replayed,
      tickId: 3,
      delta: [],
      attribution: [],
      commandTrace: [],
    })),
    /snapshot tickId already stored/,
  );
});

test('ID-07 · 历史 commandTrace 只作溯源：不注入新会话 seen，归档不被恢复改写', () => {
  const config = createDefaultConfig();
  const store = createInMemorySnapshotStore();
  const ws = createTickWorkspace(config, MAX_GRID_SIDE);
  const r = runTick(
    createInitialState(config),
    [makeCommand.zone('s10-z-1', 1, 5, 5, 'R', 2), makeCommand.advance('s10-adv-1', 2)],
    config,
    ws,
  );
  store.put(buildTickSnapshot(r));
  assert.ok(store.get(1)!.commandTrace.includes('s10-z-1'));

  const restored = store.restore(1, config);
  const sim = createSimulation(config, restored.state);

  // 历史快照中出现过的 key，在新会话 enqueue 仍返回 true（不同 payload 同样接受）
  assert.equal(sim.queue.enqueue(makeCommand.zone('s10-z-1', 9, 6, 6, 'C', 3)), true);
  const drained = sim.queue.drain();
  assert.equal(drained.length, 1);
  assert.equal(drained[0].idempotencyKey, 's10-z-1');
  assert.equal(drained[0].zoneId, 'C', '历史 key 不构成拒绝，新 payload 正常入队');

  // 恢复流程未改写归档溯源链
  assert.ok(store.get(1)!.commandTrace.includes('s10-adv-1'));
  assert.equal(store.get(1)!.tickId, 1);
});

// ---------------------------------------------------------------------------
// ④ D-01 边界 / ADR-003 A3 显式迁移器：守门在载入 / 编排 / 存档层，不在内核
// ---------------------------------------------------------------------------

test('ID-08 · D-01 / A3 边界：旧档 + 新 config 在载入与编排入口拒绝，runTick 仍按纯函数结算', () => {
  const configA = createDefaultConfig();
  const configB = createDefaultConfig({ weights: { ...configA.weights, f_c: 0.11 } });
  const oldState = createInitialState(configA);

  // (a) 编排入口 createSimulation 拒绝（D-01 修复点 2）
  assert.throws(() => createSimulation(configB, oldState), ConfigMismatchError);

  // (b) 冷归档恢复入口经 deserializeState 拒绝（D-01 联动 / A3 无静默续算）
  const store = createInMemorySnapshotStore();
  const rA = runTick(
    oldState,
    [makeCommand.advance('id08-k', 1)],
    configA,
    createTickWorkspace(configA, MAX_GRID_SIDE),
  );
  store.put(buildTickSnapshot(rA));
  assert.throws(() => store.restore(1, configB), ConfigMismatchError);

  // (c) 内核不做版本断言（守门不下沉），照常完成一次原子结算
  const rB = runTick(
    createInitialState(configA),
    [makeCommand.advance('id08-k', 1)],
    configB,
    createTickWorkspace(configB, MAX_GRID_SIDE),
  );
  assert.equal(rB.tickId, 1);
  assert.equal(rB.events.filter((e) => e.type === 'TickCommitted').length, 1);

  // (d) deserializeState 正向证据 + runTick 无载入 / 迁移入口
  assert.match(read('src/core/schema.ts'), /assertConfigCompatible\s*\(\s*state\s*,\s*config\s*\)/);
  const body = runTickBody();
  assert.equal(body.includes('assertConfigCompatible('), false);
  assert.equal(body.includes('migrate('), false, '显式迁移器不得下沉到内核');
  assert.equal(body.includes('deserializeState('), false);

  // (e) 匹配 config 的回环仍可用（对照，反证上一组不是「一律拒绝」）
  const wire = serializeState(createInitialState(configA));
  const roundTrip = deserializeState(JSON.parse(JSON.stringify(wire)), configA);
  assert.equal(roundTrip.tickId, 0);
});

// ---------------------------------------------------------------------------
// ⑤ 静态结构断言：runTick 源码不含二次幂等校验（三层防永真）
// ---------------------------------------------------------------------------

/** 等长空格替换注释 / 字符串字面量，保持索引与换行，便于大括号配平抽函数体 */
function blank(m: string): string {
  return m.replace(/[^\n]/g, ' ');
}

function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank)
    .replace(/'(?:\\.|[^'\\])*'/g, blank)
    .replace(/"(?:\\.|[^"\\])*"/g, blank)
    .replace(/`(?:\\.|[^`\\])*`/g, blank);
}

/** 跳过参数列表（含 `options = {}` 默认值的花括号），再做函数体大括号配平 */
function extractFunctionBody(code: string, signature: string): string {
  const start = code.indexOf(signature);
  if (start < 0) throw new Error('无法定位函数声明：' + signature);
  const parenOpen = code.indexOf('(', start);
  let parenDepth = 0;
  let afterParams = -1;
  for (let i = parenOpen; i < code.length; i++) {
    if (code[i] === '(') parenDepth++;
    else if (code[i] === ')') {
      parenDepth--;
      if (parenDepth === 0) {
        afterParams = i + 1;
        break;
      }
    }
  }
  if (afterParams < 0) throw new Error('参数列表括号未配平：' + signature);
  const open = code.indexOf('{', afterParams);
  if (open < 0) throw new Error('未找到函数体起始大括号：' + signature);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  throw new Error('函数体大括号未配平：' + signature);
}

/** 二次幂等校验 / 守门下沉的特征模式（对剥注释与字符串后的函数体） */
const GUARD_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bnew\s+(Set|Map)\b/,
  /\b(seen|seenAdvanceKeys|dedup|visited|processedKeys|idempotencyKeys)\b/,
  /\.has\s*\(/,
  /\.add\s*\(/,
  /\bDUPLICATE\b/i,
  /\bidempotencyKey\s*(===|==|!==|!=)/,
  /\benqueue\s*\(/,
  /\bdrain\s*\(/,
  /\bassertConfigCompatible\s*\(/,
  /\bmigrate\s*\(/,
  /\bdeserializeState\s*\(/,
]);

function detectGuards(code: string): string[] {
  const hits: string[] = [];
  for (const p of GUARD_PATTERNS) if (p.test(code)) hits.push(p.source);
  return hits;
}

function runTickBody(): string {
  return extractFunctionBody(stripNonCode(read('src/simulation/tick-pipeline.ts')), 'export function runTick(');
}

test('ID-09 · 静态结构断言：runTick 函数体零二次幂等校验（含正向对照，防抽错函数体）', () => {
  const body = runTickBody();

  // 正向对照：确认抽到的确是真实 runTick 函数体，而非空串 / 别的函数
  assert.ok(body.length > 2000, '抽出的函数体长度必须 > 2000（防永真）');
  assert.ok(body.includes('commandTrace.push'), 'P0 溯源 push 存在');
  assert.ok(body.includes('idempotencyKey'), '确实读到 idempotencyKey 标识符');
  assert.ok(body.includes('enterStage'), 'P0~P8 阶段函数存在');
  assert.ok(body.includes('copyFrameForLag'), 'D6 双帧推进存在');
  assert.ok(body.includes('solveTraffic'), 'P2 通勤求解存在');
  assert.ok(body.includes('copyState'), '冻结输入路径存在');

  // 反向断言：契约要求内核零去重 / 零守门下沉
  assert.deepEqual(detectGuards(body), [], 'runTick 不得出现任何二次幂等校验模式');
});

test('ID-10 · 反向哨兵（防永真）：伪造二次校验源码喂同一检测器必须判为含校验', () => {
  const sentinel = `
export function runTick(state, commands, config, ws, options = {}) {
  const seen = new Set<string>();
  for (let i = 0; i < commands.length; i++) {
    if (seen.has(commands[i].idempotencyKey)) continue;
    seen.add(commands[i].idempotencyKey);
  }
  ws.commandTrace.push(commands[0].idempotencyKey);
  return ws.out;
}
`;
  const body = extractFunctionBody(stripNonCode(sentinel), 'export function runTick(');
  const hits = detectGuards(body);
  assert.ok(hits.length >= 3, '哨兵必须被多条 guard 模式命中，命中数=' + hits.length);
  assert.ok(hits.some((p) => p.includes('Set')), '必须抓到 new Set');
  assert.ok(hits.some((p) => p.includes('\\.has')), '必须抓到 .has(');
  assert.ok(hits.some((p) => p.includes('seen')), '必须抓到 seen 状态变量');
});

test('ID-11 · 注入哨兵：在真实 runTick 函数体注入一行二次校验后必须变红', () => {
  const body = runTickBody();
  const anchor = 'const scratch = ws.stateScratch;';
  assert.ok(body.includes(anchor), '注入锚点必须存在于真实函数体');
  const injected = body.replace(
    anchor,
    'const seen = new Set<string>();\n  if (seen.has(commands[0].idempotencyKey)) return ws.out;\n  ' + anchor,
  );
  assert.notEqual(injected, body, '注入确实发生（防永真）');
  assert.ok(detectGuards(injected).length > 0, '真实上下文中的二次校验必须被拦截');
  // 对照：未注入的原始函数体仍为零命中，证明变红来自注入而非检测器恒真
  assert.deepEqual(detectGuards(body), []);
});

test('ID-12 · 契约文档一致性守卫：文档存在且含关键契约串，反向对照不出现错误表述', () => {
  const doc = read('tests/verification/s10-idempotency-contract.md');
  const needles = [
    'CommandQueue.enqueue',
    'Simulation.submit',
    'runTick',
    '契约外用法',
    'D-01',
    'ADR-003',
    '显式迁移器',
    'EX-03',
  ];
  for (const n of needles) {
    assert.ok(doc.includes(n), '契约文档缺少关键串：' + n);
  }
  assert.equal(doc.includes('runTick 负责去重'), false, '不得出现与契约相悖的表述');
  assert.ok(doc.length > 3000, '契约文档不得被删减成空壳');
});
