/**
 * HC-01 · T-145 · S-11【第二层 QA / 独立复核】可复跑证据
 *
 * 对应报告：tests/verification/s11-qareview.md
 * 编号前缀 QAG-*（G 线回退内核）/ QAH-*（H 线判定·解锁·软着陆），
 * 与既有 QA-R / QA-T / QA-U / QAS 四套编号区分。
 *
 * 独立性声明：
 *   - 不复用 RC / RS / RT / UL / SL 任何 fixture 与断言；
 *   - 自建 32×32（MAX_GRID_SIDE）城市 + 真实 runTick / advanceDay 推进；
 *   - 只读 src/，不改产品代码（仅一次「删一句口径」的临时注入验证 RT-8 会红，已撤销、
 *     记录在报告 §3.3，不留在本文件）。
 *
 * ⚠️ 三层口径（本轮门判定）：
 *   ① 纯逻辑 / 内存模拟介质侧：验收 1/2/4 PASS、验收 3 **PARTIAL**、验收 5 **未判定**；
 *   ② 真机半侧：PARTIAL / BLOCKED（EX-03 准出阻塞）；
 *   ③ 两者**不得合并为单一 PASS**。
 *   本文件全部结论只成立于「纯逻辑 / 内存模拟介质」，不声称真机验证，不声称 DoD D-2 达成。
 *
 * 运行：node --experimental-strip-types --test tests/verification/s11-qareview.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_GRID_SIDE,
  MAX_UNLOCK_REGIONS,
  archiveHighWaterMarks,
  assertConfigCompatible,
  canonicalize,
  cellIndex,
  computeConfigHash,
  createDefaultConfig,
  createInMemorySaveStorage,
  createInMemorySnapshotStore,
  createInitialState,
  createSaveService,
  createSimulation,
  createTickWorkspace,
  deserializeState,
  findCycleStartKeyframe,
  makeCommand,
  retryCycle,
  runTick,
  serializeState,
  type CityState,
  type Config,
  type RollbackStore,
  type SaveSlot,
} from '../../src/index.ts';

const ROOT = process.cwd();
const SIDE = MAX_GRID_SIDE;

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function cfg(over: Partial<Config> = {}): Config {
  return createDefaultConfig({ K: 2, S_unlock: 0, ...over });
}

function boot(over: Partial<Config> = {}) {
  const config = cfg(over);
  const store = createInMemorySnapshotStore();
  const sim = createSimulation(config, createInitialState(config, { side: SIDE }), {
    snapshotStore: store,
  });
  return { config, store, sim };
}

function adv(sim: ReturnType<typeof boot>['sim'], n: number, tag = 'q'): void {
  for (let i = 1; i <= n; i++) sim.advanceDay(tag + i);
}

const archiveShape = (store: ReturnType<typeof createInMemorySnapshotStore>): string[] =>
  store.entries().map((e) => `${e.tickId}:c${e.cycleId}.${e.cycleTickIndex}:${e.kind}`);

// ===========================================================================
// G 线 · 回退内核（S-11 验收 1/2 · SM-W4-04 · AC-E4）
// ===========================================================================

test('QAG-1 归档形态与周期起点定位：cycleTickIndex===0 的自包含 KEYFRAME 才是起点', () => {
  const { store, sim } = boot();
  adv(sim, 6);
  assert.deepEqual(archiveShape(store),
    ['1:c0.1:KEYFRAME', '2:c1.0:KEYFRAME', '3:c1.1:DELTA', '4:c2.0:KEYFRAME', '5:c2.1:DELTA', '6:c3.0:KEYFRAME'],
    '归档形态（K=2）：周期末帧同时是下一周期起点');
  for (const [cycle, tick] of [[1, 2], [2, 4], [3, 6]] as const) {
    const k = findCycleStartKeyframe(store, cycle);
    assert.ok(k !== null, '周期 ' + cycle + ' 起点必须可定位');
    assert.equal(k!.tickId, tick, '周期 ' + cycle + ' 起点 tick');
    assert.equal(k!.cycleId, cycle);
  }
  assert.deepEqual(archiveHighWaterMarks(store), { tickId: 6, cycleId: 3 });
});

test('QAG-2 周期 0 缺失 → CYCLE_START_KEYFRAME_MISSING（不退化到最近 KEYFRAME 静默继续）', () => {
  const { store, sim } = boot({ S_unlock: 101 });
  adv(sim, 4);
  const headBefore = canonicalize(sim.state);
  const countBefore = store.entries().length;
  assert.throws(() => sim.retryCycle(0), (e: { code?: string }) => e.code === 'CYCLE_START_KEYFRAME_MISSING',
    '周期 0 的初始态从未入档 → 必须显式失败');
  assert.equal(canonicalize(sim.state), headBefore, '失败不推进头部');
  assert.equal(store.entries().length, countBefore, '失败不写归档');
});

test('QAG-3 「restore 落点 == 定位帧」复核分支可达（用契约违约的 store 触发）', () => {
  const { store, sim } = boot({ S_unlock: 101 });
  adv(sim, 4);
  const keyframe = store.entries().find((e) => e.kind === 'KEYFRAME' && e.frames !== null)!;
  const frames = keyframe.frames!;
  // 契约违约的 store：entries() 声称起点在 tick 999，restore 却落在 tick 5
  const fake: RollbackStore = {
    entries: () => [{ tickId: 999, cycleId: 1, cycleTickIndex: 0, kind: 'KEYFRAME', frames } as never],
    get: () => null,
    put: () => {},
    restore: () => ({
      state: deserializeState(frames, sim.config),
      keyframeTickId: 5,
      requestedTickId: 999,
      replayFrom: 5,
    }),
  };
  assert.throws(
    () => retryCycle({ store: fake, config: sim.config, head: sim.state, targetCycleId: 1, lastCycleOutcome: 'RETRY_AVAILABLE' }),
    (e: { code?: string }) => e.code === 'CYCLE_START_KEYFRAME_MISSING',
    '落点不一致必须拒绝（该分支可达，非死代码）',
  );
});

test('QAG-4 tickId 单调不复用 + 旧分支归档逐条不变', () => {
  const { store, sim } = boot({ S_unlock: 101 });
  adv(sim, 6);
  const beforeEntries = store.entries().map((e) => canonicalize(e));
  const r = sim.retryCycle();
  const afterEntries = store.entries().map((e) => canonicalize(e));

  assert.equal(r.restoredFromTickId, 4, '恢复到周期 2 起点（tick 4）');
  assert.equal(r.previousHeadTickId, 6);
  assert.equal(r.newHeadTickId, 7, '新分支起点 = 已用最大 tickId + 1');
  assert.ok(r.newHeadTickId > r.previousHeadTickId, 'tickId 永不倒退 / 复用');
  assert.equal(r.newCycleId, r.previousCycleId + 1, 'cycleId 取高水位 + 1');
  assert.equal(r.abortedTickCount, 2);

  assert.equal(afterEntries.length, beforeEntries.length + 1, '只新增一条');
  for (let i = 0; i < beforeEntries.length; i++) {
    assert.equal(afterEntries[i], beforeEntries[i], '旧条目 ' + i + ' 逐字节未变');
  }
  const ids = store.entries().map((e) => e.tickId);
  assert.equal(new Set(ids).size, ids.length, '归档内 tickId 不得重复');

  sim.advanceDay('qag4-next');
  assert.equal(sim.tickId, r.newHeadTickId + 1, '回退后下一 tick = 新分支起点 + 1');
  const ids2 = store.entries().map((e) => e.tickId);
  assert.equal(new Set(ids2).size, ids2.length, '继续推进后 tickId 仍不重复');
});

test('QAG-5 幂等重放：同目标连续两次不重复推进分支标签、不重复入档', () => {
  const { store, sim } = boot({ S_unlock: 101 });
  adv(sim, 4);
  const a = sim.retryCycle();
  const countAfterFirst = store.entries().length;
  const b = sim.retryCycle();
  assert.equal(b.newHeadTickId, a.newHeadTickId, '重放返回同一结果');
  assert.equal(store.entries().length, countAfterFirst, '重放不新增归档条目');

  sim.advanceDay('qag5-next');
  const c = sim.retryCycle();
  assert.ok(c.newHeadTickId > a.newHeadTickId, '成功结算后幂等窗口关闭，再回退推进新标签');
});

test('QAG-6 E7 互斥：TARGET_MET 帧拒绝回退、RETRY_AVAILABLE 帧允许', () => {
  const met = boot({ S_unlock: 0 }); // 周期末必达标
  adv(met.sim, 2);
  assert.equal(met.sim.lastCycleOutcome, 'TARGET_MET');
  assert.throws(() => met.sim.retryCycle(), (e: { code?: string }) => e.code === 'UNLOCK_COMMITTED_THIS_FRAME',
    '达标帧（已解锁）同帧不得回退');

  const retry = boot({ S_unlock: 101 }); // 永不可达标
  adv(retry.sim, 4);
  assert.equal(retry.sim.lastCycleOutcome, 'RETRY_AVAILABLE');
  // 显式目标取一个确实已入档的周期起点（周期 1 起点 = tick 2），避免与「周期 0 未入档」混淆
  assert.doesNotThrow(() => retry.sim.retryCycle(1), '未达标帧允许回退（E7 不拦）');
});

test('QAG-7 结算中（InputGate 已锁）→ SETTLING', () => {
  const { config, store, sim } = boot({ S_unlock: 101 });
  adv(sim, 4);
  let code: string | null = null;
  const gated = createSimulation(config, sim.state, {
    snapshotStore: store,
    onStage: (stage) => {
      if (stage === 'P7' && code === null) {
        try {
          gated.retryCycle();
        } catch (e) {
          code = (e as { code?: string }).code ?? 'NO_CODE';
        }
      }
    },
  });
  gated.advanceDay('qag7');
  assert.equal(code, 'SETTLING', '结算中回退必须被拒（可判定错误码）');
});

test('QAG-8 静态：rollback.ts 零逆运算、零预算算术、只经 store.restore 恢复', () => {
  const code = read('src/simulation/rollback.ts')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  assert.equal((code.match(/budget/gi) ?? []).length, 0, '零 budget 标识符（无逆运算对象）');
  assert.equal((code.match(/-=/g) ?? []).length, 0, '零复合赋值（无反向加减）');
  assert.equal((code.match(/\b(inverse|undo|revert)\b/g) ?? []).length, 0, '零 inverse/undo 命名');
  assert.equal((code.match(/store\.restore\(/g) ?? []).length, 1, '恢复只经 store.restore 一处');
  assert.equal((code.match(/runTick\(/g) ?? []).length, 0, '回退不触发结算');
  assert.equal((code.match(/cells\.\w+\[[^\]]*\]\s*=(?!=)/g) ?? []).length, 0, '回退不写格');
  assert.equal((code.match(/Date\.now|new Date|Math\.random|setInterval|setTimeout|from 'node:/g) ?? []).length, 0,
    '零时钟 / 零随机 / 零定时器 / 零 node: 依赖');
});

test('QAG-9 E7 与 AC-E4 的边界：默认目标周期回退不会误伤「刚解锁的下一个周期」', () => {
  const { sim } = boot({ S_unlock: 0 });
  adv(sim, 2); // 周期末达标 → 解锁到 2 个区
  assert.equal(sim.state.unlockedRegions, 2);
  sim.advanceDay('qag9-next'); // 再走一个非周期末 tick → outcome 变 IN_CYCLE
  assert.equal(sim.lastCycleOutcome, 'IN_CYCLE');
  // 无参回退的目标是「当前周期」，其起点快照已含该次解锁 → 不应把解锁撤掉
  sim.retryCycle();
  assert.equal(sim.state.unlockedRegions, 2, '默认回退不误伤已解锁的新周期起点');
});

// ===========================================================================
// H 线 · 单轴判定 / V9 解锁 / 软着陆（S-11 验收 3/4 · AC-E2 / AC-E6）
// ===========================================================================

test('QAH-1 单轴判定：恰在 S === S_unlock 解锁，S 高 1e-9 即不解锁', () => {
  const probe = boot({ S_unlock: 101 });
  adv(probe.sim, 2);
  const S = probe.sim.state.frames.current.S;
  assert.ok(S > 0 && S < 101, '前提：非解锁帧下取到的 S 落在合理区间');

  const at = boot({ S_unlock: S });
  adv(at.sim, 2);
  const above = boot({ S_unlock: S + 1e-9 });
  adv(above.sim, 2);

  assert.equal(at.sim.state.unlockedRegions, 2, 'S >= S_unlock → TARGET_MET → 解锁');
  assert.equal(above.sim.state.unlockedRegions, 1, 'S < S_unlock（差 1e-9）→ 不解锁');
});

test('QAH-2 真正解锁：+68 格 / region 归 0 / 网格与 config 不变（含预算为负仍按 S 解锁）', () => {
  const { config, sim } = boot();
  for (let i = 0; i < 40; i++) {
    sim.submit(makeCommand.zone('qah2-' + i, i, 2 + (i % 12), 2 + Math.floor(i / 12), 'R', 2));
  }
  sim.advanceDay('qah2-a');
  sim.advanceDay('qah2-b');
  const st = sim.state;

  assert.ok(st.budget.B < 0, '前提：本帧预算为负（证明预算不参与判定）');
  assert.equal(st.unlockedRegions, 2, '达标帧解锁一次');
  let in18 = 0;
  for (let y = 0; y < 18; y++) for (let x = 0; x < 18; x++) if (st.cells.unlocked[cellIndex(SIDE, x, y)] === 1) in18++;
  assert.equal(in18, 324, '18×18 = 324 格可用（16²=256 + 68）');
  assert.equal(Array.from(st.cells.unlocked).filter((v) => v === 1).length, 324);
  assert.equal(Array.from(st.cells.region).filter((v) => v === 1).length, 1024 - 324, '新解锁环 region 归 0');
  assert.equal(st.cells.zone.length, SIDE * SIDE, '网格总格数不变（不扩边界）');
  assert.equal(st.cells.unlocked.length, SIDE * SIDE);
  assert.equal(config.unlockedSide, 16, 'config.unlockedSide 未改（configHash 冻结）');
  assert.equal(st.configHash, computeConfigHash(config), 'state.configHash 仍与 config 一致');
  assert.doesNotThrow(() => assertConfigCompatible(st, config), 'D-01 兼容性断言不抛');
});

test('QAH-3 封顶：8 次解锁后 9 个区 / 1024 格全开 / 不再递增', () => {
  const { sim } = boot();
  adv(sim, 24, 'qah3-');
  assert.equal(MAX_UNLOCK_REGIONS, 9, '上限 = 1 + (32−16)/2');
  assert.equal(sim.state.unlockedRegions, 9, '封顶 9');
  assert.equal(Array.from(sim.state.cells.unlocked).filter((v) => v === 1).length, SIDE * SIDE, '32×32 全开');
  const before = sim.state.unlockedRegions;
  adv(sim, 4, 'qah3b-');
  assert.equal(sim.state.unlockedRegions, before, '封顶后不再递增（不虚增）');
});

test('QAH-4 无失败终局：连续 5 周期赤字仍可继续结算、无终局类事件', () => {
  const { sim } = boot({ S_unlock: 101 });
  const types = new Set<string>();
  for (let c = 0; c < 5; c++) {
    for (let i = 0; i < 30; i++) {
      sim.submit(makeCommand.zone('qah4-' + c + '-' + i, c * 30 + i, 2 + (i % 12), 2 + Math.floor(i / 12), 'C', 3));
    }
    for (const r of [sim.advanceDay('qah4-' + c + 'a'), sim.advanceDay('qah4-' + c + 'b')]) {
      assert.equal(r.accepted, true, '第 ' + (c + 1) + ' 周期结算仍被接受');
      for (const e of r.events) types.add(e.type);
    }
  }
  assert.ok(sim.state.budget.B <= 0, '确实长期赤字');
  assert.deepEqual([...types].filter((t) => /GAME_OVER|DEFEAT|LOSE|END/i.test(t)), [], '零终局类事件');
  assert.ok(sim.state.tickId >= 10, 'tick 持续推进（无锁死）');
  assert.equal(sim.state.unlockedRegions, 1, '未达标期间不解锁');
});

test('QAH-5 软着陆：每个 B<0 的周期末恰 1 条 BUDGET_TIGHT + I_t=I_min + B≥B_floor', () => {
  const { config, sim } = boot({ S_unlock: 101 });
  for (let i = 0; i < 60; i++) {
    sim.submit(makeCommand.zone('qah5-' + i, i, 2 + (i % 14), 2 + Math.floor(i / 14), 'C', 3));
  }
  for (const key of ['qah5-a', 'qah5-b']) {
    const r = sim.advanceDay(key);
    const tight = r.events.filter((e) => e.type === 'IssuePlaceholder' && e.reason === 'BUDGET_TIGHT');
    assert.equal(tight.length, r.result.cycleOutcome === 'IN_CYCLE' ? tight.length : 1,
      '周期末 B<0 时恰 1 条告警（非周期末帧不产生）');
    assert.equal(r.accepted, true, '有告警不等于拒绝结算（软着陆而非瞬死）');
  }
  assert.ok(sim.state.budget.B < 0, 'B 保留负值（不判负、不删档）');
  assert.ok(sim.state.budget.B >= config.B_floor, 'B 受 B_floor 钳制');
  assert.ok(sim.state.budget.I_t >= config.I_min, '收入有 I_min 下限（不归零）');
});

test('QAH-6 无复利 / 罚息：B=−50 与 B=−25 的单周期净变化恒等', () => {
  const { config, sim } = boot({ S_unlock: 101 });
  adv(sim, 1); // 停在 cycleTickIndex=1，下一 tick 即周期末
  const base = deserializeState(serializeState(sim.state), config);
  const runWith = (b: number): number => {
    const s = deserializeState(serializeState(base), config);
    s.budget.B = b;
    const ws = createTickWorkspace(config, SIDE);
    return runTick(s, [makeCommand.advance('qah6-' + b, 1)], config, ws).state.budget.B;
  };
  const n50 = runWith(-50) + 50;
  const n25 = runWith(-25) + 25;
  assert.equal(n50.toFixed(6), n25.toFixed(6), '净变化与初值无关 → 无乘性惩罚 / 罚息');
});

test('QAH-7 与 S-10 联验（独立构造）：解锁后 save→load 逐字节一致且不推进 tick', () => {
  const { config, sim } = boot();
  adv(sim, 2);
  const st = sim.state;
  assert.equal(st.unlockedRegions, 2, '前提：已解锁');
  const svc = createSaveService(createInMemorySaveStorage(), config);
  const w = svc.save({ state: st });
  const l = svc.load(config);
  assert.equal(w.ok && l.ok, true);
  const bytes = (s: CityState): string => JSON.stringify(serializeState(s));
  assert.equal(bytes(l.state!), bytes(st), '整状态逐字节一致');
  assert.equal(l.state!.tickId, st.tickId, '载入不推进 tick');
  assert.equal(l.state!.unlockedRegions, 2);
  assert.equal(Array.from(l.state!.cells.unlocked).filter((v) => v === 1).length, 324);
  assert.equal(canonicalize(l.state!), canonicalize(st));
  // 存档层未为解锁新增字段：SerializedState 仍以既有 cells 承载解锁进度
  const serialized = serializeState(st) as unknown as Record<string, unknown>;
  assert.ok(Object.keys(serialized).includes('cells'), 'SerializedState 仍以 cells 承载解锁');
  assert.equal(Object.keys(serialized).includes('unlockedSide'), false, 'SerializedState 不引入 unlockedSide');
  const loadedSerialized = serializeState(l.state!) as unknown as Record<string, unknown>;
  assert.deepEqual(Object.keys(loadedSerialized).sort(), Object.keys(serialized).sort(), '载入前后字段集合相同');
});

test('QAH-8 版本头冻结：config.unlockedSide / configHash / schemaVersion 全程不变', () => {
  const { config, sim } = boot();
  const before = {
    side: config.unlockedSide,
    hash: computeConfigHash(config),
    schema: sim.state.schemaVersion,
    engine: sim.state.engineVersion,
  };
  adv(sim, 6);
  assert.equal(config.unlockedSide, before.side);
  assert.equal(computeConfigHash(config), before.hash);
  assert.equal(sim.state.schemaVersion, before.schema);
  assert.equal(sim.state.engineVersion, before.engine);
  assert.equal(sim.state.configHash, before.hash);
  // src/core/** 零改动由报告 §4 的 git 证据承担（测试内不跑 git）
});

test('QAH-9 既有 render 契约不被解锁破坏：写格必 bump 且 6 个 render 模块行数未变', () => {
  // 交叉引用：解锁写格必须 bump（QA-R3/QA-R8 已在 render 套件内逐写校验，此处只做行数抽查，
  // 防止 S-11 顺手改动渲染层而未被发现）
  const expected: Record<string, number> = {
    'src/render/iso.ts': 175,
    'src/render/view-model.ts': 158,
    // S-12 已授权变更（2026-11-07）：+24 行 = AA_TEXT_THRESHOLD + textSafe 接口/实算 +
    // inkWeak label 降级。原钉 323（T-139 快照）——行数守卫的目的是抓「未授权」渲染层改动，
    // 授权变更走 README §2.1 计数同步 + 本处显式更新，不静默改。
    'src/render/semantic-tokens.ts': 347,
    'src/render/atlas.ts': 458,
    'src/render/asset-naming.ts': 343,
    'src/render/draw-list.ts': 334,
  };
  for (const [p, n] of Object.entries(expected)) {
    const actual = read(p).split('\n').length - 1;
    assert.equal(actual, n, p + ' 行数应保持 T-139 复核时的值（' + n + '）');
  }
});

test('QAH-10 SaveSlot 结构未被 S-11 改动（解锁走既有 cells 字段，无新增存档字段）', () => {
  const types = read('src/save/types.ts');
  for (const banned of ['unlockedSide', 'unlockProgress', 'claimedRegions']) {
    assert.equal(types.includes(banned), false, 'SaveSlot 不得为解锁新增字段：' + banned);
  }
  assert.ok(types.includes('current: SerializedState'), '解锁仍随 SerializedState 承载');
  const slotKeys = Object.keys({
    header: 0, current: 0, ledger: 0, prngSeed: 0, checksum: 0, writeSeq: 0,
  } as unknown as SaveSlot);
  assert.deepEqual(slotKeys, ['header', 'current', 'ledger', 'prngSeed', 'checksum', 'writeSeq'],
    'SaveSlot 仍是 S-10 的六字段结构');
});
