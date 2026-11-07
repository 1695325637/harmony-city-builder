/**
 * HC-01 · T-140 · A/B 双槽 / 写中断 / 损坏回退（SM-W4-02 / S-10 验收 2）
 *
 * 覆盖：
 * ① A/B 交替写 + writeSeq 单调递增，任一时刻至少一个完好槽；
 * ② 写中断（落盘一半）→ 自动回退上一完好槽并提示，绝不加载半损坏数据；
 * ③ 人为损坏最新槽 → 回退上一完好槽 + 提示；
 * ④ 双槽同时损坏 → 明确失败、state=null、不加载任何半损坏数据；
 * ⑤ 读失败 / 纯 IO 写失败两种故障形态分别验证；
 * ⑥ 故障开关一次性（避免污染后续用例）+ 保留旧槽；
 * ⑦ 进程重启（新建 SaveService）后仍从介质择优恢复。
 *
 * 【介质口径】内存模拟介质；真机持久化未验证（EX-03 顺延、准出阻塞）。
 * 零依赖：Node 22 --experimental-strip-types + node:test。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDefaultConfig,
  createInitialState,
  createTickWorkspace,
  runTick,
  makeCommand,
  serializeState,
  deserializeState,
  canonicalize,
  createSaveService,
  createInMemorySaveStorage,
  parseSaveSlot,
  type Config,
  type CityState,
} from '../../src/index.ts';

const SIDE = 16;

function baseConfig(): Config {
  return createDefaultConfig({ K: 2, S_unlock: 0 });
}

/** 真实 runTick 推进到指定 tick，深拷贝为独立状态 */
function makeState(config: Config, ticks: number): CityState {
  const ws = createTickWorkspace(config, SIDE);
  let s = createInitialState(config, { side: SIDE });
  for (let t = 1; t <= ticks; t++) {
    s = runTick(s, [
      makeCommand.zone('sz-' + t, t, 2, 2, 'R', 2),
      makeCommand.road('sr-' + t, t + 20, 3, 2),
      makeCommand.fund('sf-' + t, t + 40, 5),
      makeCommand.advance('sa-' + t, t + 60),
    ], config, ws).state;
  }
  return deserializeState(serializeState(s), config);
}

/** 逐槽检查「通过结构 + checksum 校验」的完好槽数量 */
function intactSlots(storage: ReturnType<typeof createInMemorySaveStorage>): string[] {
  const out: string[] = [];
  for (const id of ['A', 'B'] as const) {
    const raw = storage.raw(id);
    if (raw !== null && parseSaveSlot(raw) !== null) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ① A/B 交替 + 任一时刻至少一个完好槽
// ---------------------------------------------------------------------------

test('SL-1 A/B 双槽交替写：writeSeq 单调递增，任一时刻至少一个完好槽', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const seq: string[] = [];
  const writeSeqs: number[] = [];

  for (let t = 1; t <= 6; t++) {
    const r = svc.save({ state: makeState(config, t + 2) });
    assert.equal(r.ok, true, '第 ' + t + ' 次写入成功');
    seq.push(r.slotId);
    writeSeqs.push(r.writeSeq);
    assert.ok(intactSlots(storage).length >= 1,
      '第 ' + t + ' 次写入后至少一个完好槽（SM-W4-02）');
  }
  assert.deepEqual(seq, ['A', 'B', 'A', 'B', 'A', 'B'], 'A/B 严格交替');
  assert.deepEqual(writeSeqs, [1, 2, 3, 4, 5, 6], 'writeSeq 单调递增');
  assert.equal(storage.writeCount, 6);
  // 两槽都完好，且较新槽的 writeSeq 更大
  assert.equal(intactSlots(storage).length, 2);
  const a = parseSaveSlot(storage.raw('A'));
  const b = parseSaveSlot(storage.raw('B'));
  assert.ok(a !== null && b !== null);
  assert.equal(b.writeSeq, a.writeSeq + 1, 'B 为最新槽');

  // 恢复取最新状态
  const last = makeState(config, 8);
  const loaded = createSaveService(storage, config).load(config);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.slotId, 'B');
  assert.equal(canonicalize(serializeState(loaded.state)), canonicalize(serializeState(last)));
});

// ---------------------------------------------------------------------------
// ② 写中断 → 回退上一完好槽并提示
// ---------------------------------------------------------------------------

test('SL-2 SM-W4-02 写中断（落盘一半）：自动回退上一完好槽 + 提示，绝不加载半损坏数据', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const first = makeState(config, 3);
  const second = makeState(config, 5);
  assert.equal(svc.save({ state: first }).slotId, 'A');   // A: seq1
  assert.equal(svc.save({ state: second }).slotId, 'B');  // B: seq2（最新完好）
  const bytesBBefore = storage.raw('B');

  // 第 3 次写目标为 A；注入「落盘一半被杀」
  storage.faults.interruptNextWrite = true;
  const interrupted = svc.save({ state: makeState(config, 7) });
  assert.equal(interrupted.ok, false, '写中断返回失败而非抛穿');
  assert.equal(interrupted.slotId, 'A');
  assert.equal(interrupted.notice.code, 'WRITE_INTERRUPTED');
  assert.ok(interrupted.notice.message.length > 0, '须给出可展示提示');
  assert.equal(storage.raw('B'), bytesBBefore, '上一完好槽 B 逐字节未动');
  assert.equal(parseSaveSlot(storage.raw('A')), null, 'A 为半损坏数据，不可解析');
  assert.equal(intactSlots(storage).length >= 1, true, '任一时刻至少一个完好槽仍成立');

  // 重进后加载：跳过损坏 A，回退 B
  const loaded = createSaveService(storage, config).load(config);
  assert.equal(loaded.ok, true, '自动回退成功');
  assert.equal(loaded.slotId, 'B');
  assert.equal(loaded.notice.code, 'FELL_BACK_TO_PREVIOUS_SLOT');
  assert.ok(loaded.notice.message.indexOf('回退') >= 0, '提示须含「回退」');
  assert.deepEqual(loaded.damagedSlots, ['A'], 'A 被判定损坏');
  assert.deepEqual(loaded.validSlots, ['B']);
  assert.equal(loaded.state.tickId, second.tickId, '恢复到上一完好的最近 tick，不是被中断那次');
  assert.equal(canonicalize(serializeState(loaded.state)), canonicalize(serializeState(second)),
    '绝不加载半损坏数据：状态逐字节等于 B');
  assert.equal(storage.faults.interruptNextWrite, false, '一次性开关已自动复位');
});

test('SL-3 人为损坏最新槽：回退上一完好槽 + 提示', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const first = makeState(config, 3);
  const second = makeState(config, 5);
  svc.save({ state: first });   // A: seq1
  svc.save({ state: second });  // B: seq2（最新）
  storage.corruptSlot('B');     // 人为改坏最新槽

  assert.equal(parseSaveSlot(storage.raw('B')), null, 'B 被判定损坏');
  assert.equal(intactSlots(storage).length, 1, '仅 A 完好');
  const loaded = createSaveService(storage, config).load(config);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.slotId, 'A', '回退到上一完好槽 A');
  assert.equal(loaded.notice.code, 'FELL_BACK_TO_PREVIOUS_SLOT');
  assert.deepEqual(loaded.damagedSlots, ['B']);
  assert.equal(canonicalize(serializeState(loaded.state)), canonicalize(serializeState(first)));
  assert.equal(loaded.state.tickId, first.tickId, '不补算、不推进 tick');
});

test('SL-4 双槽同时损坏：明确失败、state=null、绝不半加载', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  svc.save({ state: makeState(config, 3) });
  svc.save({ state: makeState(config, 5) });
  storage.corruptSlot('A');
  storage.corruptSlot('B');
  assert.deepEqual(intactSlots(storage), [], '无完好槽');

  const loaded = createSaveService(storage, config).load(config);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.state, null, '绝不加载半损坏数据');
  assert.equal(loaded.slotId, null);
  assert.equal(loaded.header, null);
  assert.equal(loaded.prngSeed, null);
  assert.equal(loaded.notice.code, 'NO_VALID_SLOT');
  assert.ok(loaded.notice.message.indexOf('损坏') >= 0, '提示须含「损坏」');
  assert.deepEqual([...loaded.damagedSlots].sort(), ['A', 'B']);
  assert.deepEqual(loaded.validSlots, []);
  assert.equal(Object.isFrozen(loaded.damagedSlots), true, '结果数组冻结、调用方不可改写');
});

// ---------------------------------------------------------------------------
// ⑤ 其它故障形态
// ---------------------------------------------------------------------------

test('SL-5 读失败故障：跳过读失败的槽，回退另一完好槽', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const first = makeState(config, 3);
  const second = makeState(config, 5);
  svc.save({ state: first });
  svc.save({ state: second });

  storage.faults.failNextRead = true; // 第 1 次 read(A) 抛错
  const loaded = createSaveService(storage, config).load(config);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.slotId, 'B', 'A 读取失败被跳过，取 B');
  assert.equal(loaded.notice.code, 'FELL_BACK_TO_PREVIOUS_SLOT');
  assert.deepEqual(loaded.damagedSlots, ['A']);
  assert.equal(canonicalize(serializeState(loaded.state)), canonicalize(serializeState(second)));
  assert.equal(storage.faults.failNextRead, false, '一次性开关复位');
});

test('SL-6 纯 IO 写失败：目标槽连半损坏都不留，上一完好槽逐字节不变', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const second = makeState(config, 5);
  svc.save({ state: makeState(config, 3) }); // A
  svc.save({ state: second });               // B（最新完好）
  const beforeA = storage.raw('A');
  const beforeB = storage.raw('B');

  storage.faults.failNextWrite = true;
  const r = svc.save({ state: makeState(config, 7) });
  assert.equal(r.ok, false);
  assert.equal(r.slotId, 'A');
  assert.equal(r.notice.code, 'WRITE_INTERRUPTED');
  assert.equal(storage.raw('A'), beforeA, 'A 未被改写');
  assert.equal(storage.raw('B'), beforeB, 'B 未被改写');
  assert.equal(intactSlots(storage).length, 2, '两槽仍完好');
  const loaded = createSaveService(storage, config).load(config);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.notice.code, 'NONE', '无损坏槽，不误报回退');
  assert.equal(canonicalize(serializeState(loaded.state)), canonicalize(serializeState(second)));
});

test('SL-7 corruptOnRead 故障：仅读取视图被污染，介质本身完好（可重试恢复）', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const first = makeState(config, 3);
  const second = makeState(config, 5);
  svc.save({ state: first });
  svc.save({ state: second });
  const rawB = storage.raw('B');

  storage.faults.corruptOnRead = 'B';
  const loaded = createSaveService(storage, config).load(config);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.slotId, 'A', 'B 读取被污染 → 回退 A');
  assert.deepEqual(loaded.damagedSlots, ['B']);
  assert.equal(storage.raw('B'), rawB, '介质未被真正改写');
  assert.equal(storage.faults.corruptOnRead, null, '一次性开关复位');
  // 复位后重新加载 → 取回最新 B
  const retry = createSaveService(storage, config).load(config);
  assert.equal(retry.slotId, 'B');
  assert.equal(retry.notice.code, 'NONE');
  assert.equal(canonicalize(serializeState(retry.state)), canonicalize(serializeState(second)));
});

// ---------------------------------------------------------------------------
// ⑥ 保留旧槽 / ⑦ 进程重启
// ---------------------------------------------------------------------------

test('SL-8 加载失败 / 拒绝载入均不写回介质：旧槽逐字节保留', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  svc.save({ state: makeState(config, 3) });
  svc.save({ state: makeState(config, 5) });
  const beforeA = storage.raw('A');
  const beforeB = storage.raw('B');
  const writesBefore = storage.writeCount;

  // 用不同 config 载入 → D-01 硬拒绝
  const rejected = createSaveService(storage, createDefaultConfig({ K: 9 })).load(createDefaultConfig({ K: 9 }));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.state, null);
  assert.equal(storage.raw('A'), beforeA, 'A 保留');
  assert.equal(storage.raw('B'), beforeB, 'B 保留');
  assert.equal(storage.writeCount, writesBefore, 'load 不产生任何写入');

  // 用原 config 仍可正常恢复
  const ok = createSaveService(storage, config).load(config);
  assert.equal(ok.ok, true);
  assert.equal(ok.slotId, 'B');
});

test('SL-9 进程重启语义：介质不变、新建多个 SaveService 依次加载结果一致（无 active-slot 指针）', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const last = makeState(config, 6);
  svc.save({ state: makeState(config, 3) });
  svc.save({ state: last });
  const expected = canonicalize(serializeState(last));

  for (let i = 0; i < 3; i++) {
    const r = createSaveService(storage, config).load(config);
    assert.equal(r.ok, true, '第 ' + (i + 1) + ' 次重进');
    assert.equal(r.slotId, 'B', '仅凭槽内 writeSeq 择优，无需持久化指针');
    assert.equal(canonicalize(serializeState(r.state)), expected);
  }
  assert.equal(storage.raw('A') !== null && storage.raw('B') !== null, true, '介质未被加载改写');
});

test('SL-10 clear() 模拟首次启动 / 介质重建：回到无档状态且故障开关复位', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  svc.save({ state: makeState(config, 3) });
  storage.faults.failNextRead = true;
  storage.clear();
  assert.equal(storage.raw('A'), null);
  assert.equal(storage.raw('B'), null);
  assert.equal(storage.faults.failNextRead, false);
  const loaded = createSaveService(storage, config).load(config);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.notice.code, 'NO_VALID_SLOT');
  assert.equal(loaded.notice.message.indexOf('尚无存档') >= 0, true);
  // 新局第一次写入仍从 A 开始
  assert.equal(svc.save({ state: makeState(config, 1) }).slotId, 'A');
});
