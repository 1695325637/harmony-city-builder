/**
 * HC-01 · T-142 · S-10 第一批【第二层 QA 独立复核】可复跑证据
 *
 * 对应报告：tests/verification/s10-qareview.md
 * 编号前缀 QAS-*（与 T-119 的 QA-R、T-124 的 QA-T、T-128 的 QA-U 三套编号区分）
 *
 * 独立性声明：
 *   - 本文件**不复用**实现方 SV/SL/MG 的任何 fixture 与断言，自建 16×16 城市 + 真实 runTick 推进；
 *   - 故障注入走介质自带的 `faults` / `corruptSlot`，但不照抄实现方用例的注入顺序与断言口径；
 *   - 只读 src/，不改任何产品代码（另有一次**文件级**注入探针，已撤销并记录在报告 §3.3，
 *     不留在本文件里，避免"把注入后的行为当常态"）。
 *
 * ⚠️ 介质口径（tests/quality-closure.md v1.2 EX-03 双层判定）：
 *   本文件全部结论**只成立于「内存模拟介质」**。真机 HarmonyOS 沙箱 / KV 持久化、
 *   杀进程与切后台真实恢复 = **未验证 / PARTIAL·BLOCKED / 准出阻塞项**。
 *   本文件**不声称**真机验证、**不声称**断点续玩已达成。
 *
 * 运行：node --experimental-strip-types --test tests/verification/s10-qareview.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  ENGINE_VERSION,
  SCHEMA_VERSION,
  canonicalize,
  computeConfigHash,
  computeSaveChecksum,
  createCommandQueue,
  createDefaultConfig,
  createInMemorySaveStorage,
  createInitialState,
  createSaveService,
  createTickWorkspace,
  makeCommand,
  parseSaveSlot,
  runTick,
  SAVE_FEATURE_FLAGS,
  SAVE_SLOT_IDS,
  serializeState,
  type CityState,
  type Config,
  type InMemorySaveStorage,
  type SaveMigration,
  type SaveSlot,
  type SaveSlotId,
} from '../../src/index.ts';

const ROOT = process.cwd();
const SIDE = 16;
const LEGACY_V0 = 'HC01-SCHEMA-0';
const LEGACY_V_MID = 'HC01-SCHEMA-0.5';

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8');
}

function lineCount(rel: string): number {
  return read(rel).split('\n').length - (read(rel).endsWith('\n') ? 1 : 0);
}

function baseConfig(): Config {
  return createDefaultConfig({ K: 2, S_unlock: 0 });
}

/** 自建 fixture：真实 runTick 推进 ticks 次（不走实现方用例的 makeState） */
function qaState(config: Config, ticks: number): CityState {
  const ws = createTickWorkspace(config, SIDE);
  let s = createInitialState(config, { side: SIDE });
  for (let t = 1; t <= ticks; t++) {
    s = runTick(s, [
      makeCommand.zone('qas-z-' + t, t * 4, 2, 2, 'R', 2),
      makeCommand.road('qas-r-' + t, t * 4 + 1, 3, 2),
      makeCommand.fund('qas-f-' + t, t * 4 + 2, 20),
      makeCommand.advance('qas-a-' + t, t * 4 + 3),
    ], config, ws).state;
  }
  return s;
}

/** 读出合法槽 → 按 mutate 改写 → 重算 checksum → 写回介质（用于构造旧版本 / 漂移档） */
function forgeSlot(
  storage: InMemorySaveStorage,
  id: SaveSlotId,
  mutate: (s: SaveSlot) => SaveSlot,
): void {
  const raw = storage.raw(id);
  assert.ok(raw !== null, '待改写的槽必须存在');
  const base = parseSaveSlot(raw);
  assert.ok(base !== null, '待改写的槽必须结构合法');
  const changed = mutate(base);
  const sum = computeSaveChecksum(changed);
  const sealed: SaveSlot = {
    ...changed,
    header: { ...changed.header, checksum: sum },
    checksum: sum,
  };
  storage.write(id, JSON.stringify(sealed));
}

function asLegacy(s: SaveSlot, version: string): SaveSlot {
  return {
    ...s,
    header: { ...s.header, schemaVersion: version },
    current: { ...s.current, schemaVersion: version },
  };
}

/** 迁移器：只改版本字段，绝不重算任何模拟量 */
function upgrader(from: string, to: string): SaveMigration {
  return {
    id: 'qas-' + from + '->' + to,
    fromSchemaVersion: from,
    toSchemaVersion: to,
    migrate(slot) {
      return {
        ...slot,
        header: { ...slot.header, schemaVersion: to },
        current: { ...slot.current, schemaVersion: to },
      };
    },
  };
}

// ===========================================================================
// E 线 · S-10 验收 1：五类字段 + 时间轴 + 逐字节
// ===========================================================================

test('QAS-1 验收1 · 真实 runTick 后五类字段逐项恢复且时间轴不推进', () => {
  const config = baseConfig();
  const before = qaState(config, 4);

  // 先证明 fixture 不是"全默认值在自我比较"
  assert.equal(before.tickId, 4, 'fixture 确实推进了 4 tick');
  assert.ok(before.cells.zone.some((v) => v !== 0), '网格非空');
  assert.ok(before.cells.inputVersion.some((v) => v !== 0), 'inputVersion 已 bump');
  assert.notEqual(before.frames.current.S, createInitialState(config, { side: SIDE }).frames.current.S,
    '满意度已结算变化');
  assert.ok(before.issueCount > 0, '议题数非零');
  assert.ok(before.unlockedRegions > 0, '解锁进度非零');

  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const w = svc.save({ state: before });
  assert.equal(w.ok, true, '写入成功');
  const loaded = svc.load(config);
  assert.equal(loaded.ok, true, '载入成功');
  assert.equal(loaded.notice.code, 'NONE', '首个完好槽不产生告警码');
  const after = loaded.state!;

  // ① 网格（5 个 TypedArray 全覆盖）
  for (const key of ['zone', 'density', 'unlocked', 'region', 'inputVersion'] as const) {
    assert.deepEqual(Array.from(after.cells[key]), Array.from(before.cells[key]), 'cells.' + key + ' 逐格一致');
  }
  // ② 预算（7 个标量）
  assert.deepEqual({ ...after.budget }, { ...before.budget }, 'budget 7 字段一致');
  // ③ 满意度（双帧 S / factors / T_c / T_s / E / I_f / dS / dSByFactor / dSPenalty / L）
  for (const which of ['prev', 'current'] as const) {
    const a = after.frames[which];
    const b = before.frames[which];
    assert.equal(a.S, b.S, 'frames.' + which + '.S');
    assert.equal(a.T_c, b.T_c);
    assert.equal(a.T_s, b.T_s);
    assert.equal(a.E, b.E);
    assert.equal(a.I_f, b.I_f);
    assert.equal(a.dS, b.dS);
    assert.equal(a.dSPenalty, b.dSPenalty);
    assert.equal(a.L, b.L);
    assert.deepEqual(Array.from(a.factors), Array.from(b.factors), 'factors 向量');
    assert.deepEqual(Array.from(a.dSByFactor), Array.from(b.dSByFactor), 'dSByFactor 向量');
  }
  // ④ 议题 / ⑤ 解锁进度
  assert.equal(after.issueCount, before.issueCount);
  assert.equal(after.unlockedRegions, before.unlockedRegions);
  // 时间轴：不推进、不补算
  assert.equal(after.tickId, before.tickId, 'tickId 不变');
  assert.equal(after.cycleId, before.cycleId, 'cycleId 不变');
  assert.equal(after.cycleTickIndex, before.cycleTickIndex, 'cycleTickIndex 不变');
  // 全状态逐字节
  assert.equal(canonicalize(after), canonicalize(before), '整状态 canonicalize 逐字节一致');
});

test('QAS-2 验收1 · 反复载入幂等：不产生新 tick、不消耗 prng、prngSeed 原样回传', () => {
  const config = baseConfig();
  const state = qaState(config, 3);
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const w = svc.save({ state });
  assert.equal(w.ok, true);
  const bytesBefore = storage.raw(w.slotId!);

  const a = svc.load(config);
  const b = svc.load(config);
  const c = svc.load(config);
  for (const r of [a, b, c]) {
    assert.equal(r.ok, true);
    assert.equal(r.state!.tickId, state.tickId);
    assert.equal(canonicalize(r.state!), canonicalize(state));
    assert.equal(r.prngSeed, state.seed, 'prngSeed 原样回传、不消耗');
  }
  assert.equal(canonicalize(a.state!), canonicalize(c.state!), '三次载入结果完全相同');
  assert.equal(storage.raw(w.slotId!), bytesBefore, '载入不写介质');
  assert.equal(storage.writeCount, 1, '载入不产生任何写');
});

// ===========================================================================
// E 线 · S-10 验收 2：双槽 / 故障注入（独立探针）
// ===========================================================================

test('QAS-3 验收2 · 独立故障注入：坏掉最新槽 → 回退旧槽、提示码、状态与旧档一致', () => {
  const config = baseConfig();
  const s1 = qaState(config, 2);
  const s2 = qaState(config, 3);
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);

  const w1 = svc.save({ state: s1 });
  const w2 = svc.save({ state: s2 });
  assert.equal(w1.ok && w2.ok, true);
  assert.notEqual(w1.slotId, w2.slotId, 'A/B 交替写');
  assert.ok(w2.writeSeq > w1.writeSeq, 'writeSeq 单调');
  const oldBytes = storage.raw(w1.slotId!);

  // 独立注入：只毁最新槽
  storage.corruptSlot(w2.slotId!);

  const r = svc.load(config);
  assert.equal(r.ok, true, '仍有完好槽可载入');
  assert.equal(r.slotId, w1.slotId, '回退到旧槽');
  assert.equal(r.notice.code, 'FELL_BACK_TO_PREVIOUS_SLOT');
  assert.deepEqual(Array.from(r.damagedSlots), [w2.slotId]);
  assert.deepEqual(Array.from(r.validSlots), [w1.slotId]);
  assert.equal(canonicalize(r.state!), canonicalize(s1), '返回状态 == 旧档状态（不是半损坏数据）');
  assert.equal(storage.raw(w1.slotId!), oldBytes, '旧槽字节未被改写');
});

test('QAS-4 验收2 · 写中断（落盘一半后抛错）：报 WRITE_INTERRUPTED，旧槽逐字节不动，后续载入仍可用', () => {
  const config = baseConfig();
  const s1 = qaState(config, 2);
  const s2 = qaState(config, 3);
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const w1 = svc.save({ state: s1 });
  const w2 = svc.save({ state: s2 });
  const goodBytes = storage.raw(w2.slotId!);

  storage.faults.interruptNextWrite = true;
  const w3 = svc.save({ state: qaState(config, 4) });
  assert.equal(w3.ok, false, '写中断不提交');
  assert.equal(w3.notice.code, 'WRITE_INTERRUPTED');
  assert.equal(w3.slotId, w1.slotId, '目标即"另一槽"');
  assert.equal(storage.raw(w2.slotId!), goodBytes, '上一完好槽逐字节不动');
  assert.equal(parseSaveSlot(storage.raw(w1.slotId!)!) === null, true, '目标槽留下半损坏数据（并被判无效）');
  assert.equal(storage.faults.interruptNextWrite, false, '故障开关一次性自复位');

  const r = svc.load(config);
  assert.equal(r.ok, true, '载入仍成功');
  assert.equal(r.slotId, w2.slotId);
  assert.equal(canonicalize(r.state!), canonicalize(s2));
  assert.equal(r.notice.code, 'FELL_BACK_TO_PREVIOUS_SLOT');
  assert.deepEqual(Array.from(r.damagedSlots), [w1.slotId]);
});

test('QAS-5 验收2 · 纯 IO 写失败（不落盘）：报 WRITE_INTERRUPTED，目标槽连半损坏都不留', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const w1 = svc.save({ state: qaState(config, 2) });
  const goodBytes = storage.raw(w1.slotId!);

  storage.faults.failNextWrite = true;
  const w2 = svc.save({ state: qaState(config, 3) });
  assert.equal(w2.ok, false);
  assert.equal(w2.notice.code, 'WRITE_INTERRUPTED');
  assert.notEqual(w2.slotId, w1.slotId, '目标为另一槽');
  // 目标槽在失败前是空的 → 失败后仍是空的（"无半损坏残留"的准确读法）
  assert.equal(storage.raw(w2.slotId!), null, '目标槽未落任何字节（连半损坏都没有）');
  assert.equal(storage.raw(w1.slotId!), goodBytes, '已有完好槽逐字节不动');

  const r = svc.load(config);
  assert.equal(r.ok, true);
  assert.equal(r.notice.code, 'NONE', '无损坏槽 → 不产生回退告警');
  assert.deepEqual(Array.from(r.damagedSlots), []);
});

test('QAS-6 验收2 · 双槽全坏 → NO_VALID_SLOT + state=null + 两槽都记为损坏', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const w1 = svc.save({ state: qaState(config, 2) });
  const w2 = svc.save({ state: qaState(config, 3) });
  storage.corruptSlot(w1.slotId!);
  storage.corruptSlot(w2.slotId!);

  const r = svc.load(config);
  assert.equal(r.ok, false);
  assert.equal(r.state, null, '绝不返回半损坏状态');
  assert.equal(r.notice.code, 'NO_VALID_SLOT');
  assert.equal(r.validSlots.length, 0);
  assert.equal(r.damagedSlots.length, 2);
});

test('QAS-7 验收2 · 篡改载荷（改 budget.B 但不改 checksum）→ 判损坏，不加载', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const w = svc.save({ state: qaState(config, 3) });

  storage.corruptSlot(w.slotId!, (bytes) => {
    const obj = JSON.parse(bytes) as SaveSlot;
    obj.current = {
      ...obj.current,
      budget: { ...(obj.current as unknown as CityState).budget, B: 999999 },
    };
    return JSON.stringify(obj);
  });
  assert.equal(parseSaveSlot(storage.raw(w.slotId!)!), null, 'checksum 不符 → 结构校验拒收');

  const r = svc.load(config);
  assert.equal(r.ok, false);
  assert.equal(r.state, null);
  assert.equal(r.notice.code, 'NO_VALID_SLOT');
});

test('QAS-8 验收2 · 读失败（介质抛错）→ 归入损坏槽，另一槽照常载入', () => {
  const config = baseConfig();
  const s2 = qaState(config, 3);
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const w1 = svc.save({ state: qaState(config, 2) });
  const w2 = svc.save({ state: s2 });

  // 让"读 A"失败：readSlots 按 SAVE_SLOT_IDS 顺序读，先命中 A
  storage.faults.failNextRead = true;
  const r = svc.load(config);
  assert.equal(r.ok, true, '另一槽仍可载入');
  assert.equal(r.slotId, w2.slotId);
  assert.equal(canonicalize(r.state!), canonicalize(s2));
  assert.equal(r.damagedSlots.includes(w1.slotId), true, '读失败槽记为损坏');
  assert.deepEqual(SAVE_SLOT_IDS.slice(0, 1), ['A']);
});

// ===========================================================================
// E 线 · S-10 验收 3：header / 版本 / 迁移 / D-01
// ===========================================================================

test('QAS-9 验收3 · header 六键齐备，saveTime 仅展示（不同标签 → 状态逐字节相同）', () => {
  const config = baseConfig();
  const state = qaState(config, 3);
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);

  const a = svc.save({ state });
  assert.deepEqual(
    Object.keys(a).sort(),
    ['checksum', 'notice', 'ok', 'slotId', 'writeSeq'],
    'SaveResult 形状',
  );
  const h = svc.load(config).header!;
  assert.deepEqual(
    Object.keys(h).sort(),
    ['checksum', 'configHash', 'engineVersion', 'saveTime', 'schemaVersion', 'seed'],
    'header 五字段 + saveTime',
  );
  assert.equal(h.schemaVersion, SCHEMA_VERSION);
  assert.equal(h.engineVersion, ENGINE_VERSION);
  assert.equal(h.configHash, computeConfigHash(config));
  assert.equal(h.seed, state.seed);
  assert.equal(h.saveTime, 'tick:3', '缺省为确定性标签，不读时钟');

  // 只换展示标签：saveTime 变、checksum 变，但状态逐字节不变
  const svc2 = createSaveService(createInMemorySaveStorage(), config);
  const b = svc2.save({ state, displayTime: '2026-11-07 18:30 (Asia/Shanghai)' });
  const h2 = svc2.load(config).header!;
  assert.equal(h2.saveTime, '2026-11-07 18:30 (Asia/Shanghai)');
  assert.notEqual(b.checksum, a.checksum, 'saveTime 参与 checksum（属落盘字节的一部分）');
  assert.equal(canonicalize(svc2.load(config).state!), canonicalize(svc.load(config).state!),
    '展示标签不影响恢复出的状态');
});

test('QAS-10 验收3 · 默认零迁移器：旧 schemaVersion → 拒绝 + 保留旧槽 + state=null', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const w = svc.save({ state: qaState(config, 4) });
  forgeSlot(storage, w.slotId!, (s) => asLegacy(s, LEGACY_V0));
  const legacyBytes = storage.raw(w.slotId!);

  const r = svc.load(config);
  assert.equal(r.ok, false);
  assert.equal(r.state, null);
  assert.equal(r.notice.code, 'VERSION_MISMATCH_NO_MIGRATOR');
  assert.equal(storage.raw(w.slotId!), legacyBytes, '旧槽逐字节保留（未静默续算 / 未覆盖）');
});

test('QAS-11 验收3 · configHash 漂移：即使注册了迁移器也硬拒绝（D-01 无迁移路径）', () => {
  const config = baseConfig();
  const other = createDefaultConfig({ K: 4, S_unlock: 0 });
  assert.notEqual(computeConfigHash(config), computeConfigHash(other));
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const w = svc.save({ state: qaState(config, 3) });

  // 同时制造"旧版本 + 已注册迁移器"，验证迁移路径也救不回 configHash 漂移
  forgeSlot(storage, w.slotId!, (s) => ({
    ...asLegacy(s, LEGACY_V0),
    header: { ...s.header, configHash: computeConfigHash(other), schemaVersion: LEGACY_V0 },
    current: { ...s.current, configHash: computeConfigHash(other), schemaVersion: LEGACY_V0 },
  }));
  const driftBytes = storage.raw(w.slotId!);

  const strict = createSaveService(storage, config, { migrations: [upgrader(LEGACY_V0, SCHEMA_VERSION)] });
  const r = strict.load(config);
  assert.equal(r.ok, false);
  assert.equal(r.state, null);
  assert.equal(r.notice.code, 'CONFIG_MISMATCH_REJECTED', 'configHash 先于迁移判定，硬拒绝');
  assert.equal(storage.raw(w.slotId!), driftBytes, '槽不变');
});

test('QAS-12 验收3 · engineVersion 漂移 → VERSION_MISMATCH_NO_MIGRATOR（无迁移路径）', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const w = svc.save({ state: qaState(config, 3) });
  forgeSlot(storage, w.slotId!, (s) => ({
    ...s,
    header: { ...s.header, engineVersion: 'HC01-ENGINE-OLD' },
    current: { ...s.current, engineVersion: 'HC01-ENGINE-OLD' },
  }));

  const r = svc.load(config);
  assert.equal(r.ok, false);
  assert.equal(r.state, null);
  assert.equal(r.notice.code, 'VERSION_MISMATCH_NO_MIGRATOR');
});

test('QAS-13 验收3 · 显式迁移器：MIGRATED + tick 不推进 + 迁移结果不写回介质', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const w = svc.save({ state: qaState(config, 5) });
  forgeSlot(storage, w.slotId!, (s) => asLegacy(s, LEGACY_V0));
  const legacyBytes = storage.raw(w.slotId!);
  const legacyTick = parseSaveSlot(legacyBytes!)!.current.tickId;
  const writesAfterForge = storage.writeCount;

  const migrating = createSaveService(storage, config, {
    migrations: [upgrader(LEGACY_V0, LEGACY_V_MID), upgrader(LEGACY_V_MID, SCHEMA_VERSION)],
  });
  const r = migrating.load(config);
  assert.equal(r.ok, true);
  assert.equal(r.notice.code, 'MIGRATED', '多跳链一次走完');
  assert.equal(r.header!.schemaVersion, SCHEMA_VERSION);
  assert.equal(r.state!.tickId, legacyTick, '迁移不推进 tick');
  assert.equal(storage.raw(w.slotId!), legacyBytes, '旧槽逐字节保留（迁移结果不写回）');
  assert.equal(storage.writeCount, writesAfterForge, '迁移 / 载入全程零写');
});

test('QAS-14 验收3 · 迁移链成环：拒绝且不挂死；谎报目标版本：拒绝', () => {
  const config = baseConfig();
  const storage = createInMemorySaveStorage();
  createSaveService(storage, config).save({ state: qaState(config, 3) });
  forgeSlot(storage, 'A', (s) => asLegacy(s, LEGACY_V0));

  // 成环：V0 → V_MID → V0（永远到不了 SCHEMA_VERSION）
  const cyclic = createSaveService(storage, config, {
    migrations: [upgrader(LEGACY_V0, LEGACY_V_MID), upgrader(LEGACY_V_MID, LEGACY_V0)],
  });
  const rc = cyclic.load(config);
  assert.equal(rc.ok, false);
  assert.equal(rc.state, null);
  assert.equal(rc.notice.code, 'VERSION_MISMATCH_NO_MIGRATOR');

  // 谎报：from=V0 但 migrate 实际写 V0（header 与 toSchemaVersion 不符）
  const liar: SaveMigration = {
    id: 'qas-liar',
    fromSchemaVersion: LEGACY_V0,
    toSchemaVersion: SCHEMA_VERSION,
    migrate(slot) {
      return asLegacy(slot, LEGACY_V0);
    },
  };
  const rl = createSaveService(storage, config, { migrations: [liar] }).load(config);
  assert.equal(rl.ok, false);
  assert.equal(rl.notice.code, 'VERSION_MISMATCH_NO_MIGRATOR');
});

test('QAS-15 验收3 · 写入侧 D-01：不兼容状态拒绝写入且不动任何槽', () => {
  const config = baseConfig();
  const other = createDefaultConfig({ K: 4, S_unlock: 0 });
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);

  const foreign = qaState(other, 2); // 用 other config 结算出来的状态
  const w = svc.save({ state: foreign });
  assert.equal(w.ok, false);
  assert.equal(w.notice.code, 'SAVE_REJECTED_INCOMPATIBLE_STATE');
  assert.equal(storage.writeCount, 0, '零写');
  assert.equal(storage.raw('A'), null);
  assert.equal(storage.raw('B'), null);
});

// ===========================================================================
// E 线 · 验收 4/5 + 文档一致性 + 诚实话语
// ===========================================================================

test('QAS-16 验收4 · src/save/** 零时钟/零随机/零定时器/零 node:/引擎/渲染/UI/网络', () => {
  const banned = [
    'Date.now', 'new Date', 'Math.random', 'performance.now', 'process.hrtime',
    'setInterval', 'setTimeout', 'requestAnimationFrame', 'countdown', 'autoPlay',
    "from 'node:", 'require(', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'localStorage',
    'sessionStorage', 'indexedDB',
  ];
  const files = readdirSync(join(ROOT, 'src/save')).filter((f) => f.endsWith('.ts'));
  assert.deepEqual(files.slice().sort(), ['index.ts', 'save-service.ts', 'storage.ts', 'types.ts'],
    '存档层文件清单');
  for (const f of files) {
    const src = read(join('src/save', f));
    for (const b of banned) {
      assert.equal(src.includes(b), false, 'src/save/' + f + ' 不得出现 ' + b);
    }
    for (const mod of ["'cc'", "'@ohos", '../render/', '../ui/', '../platform']) {
      assert.equal(src.includes(mod), false, 'src/save/' + f + ' 不得依赖 ' + mod);
    }
  }
});

test('QAS-17 验收4 · 存档层不自作主张结算（零 runTick / solveTraffic / advanceDay / createSimulation 调用）', () => {
  const banned = ['runTick(', 'solveTraffic(', 'advanceDay(', 'createSimulation(',
    'computeBaselineS(', 'aggregate('];
  const files = readdirSync(join(ROOT, 'src/save')).filter((f) => f.endsWith('.ts'));
  for (const f of files) {
    const src = read(join('src/save', f));
    for (const b of banned) {
      assert.equal(src.includes(b), false, 'src/save/' + f + ' 不得调用 ' + b);
    }
  }
  // 载入唯一入口：src/save 只经 deserializeState
  assert.equal(read('src/save/save-service.ts').includes('deserializeState(effective.current, config)'), true,
    '载入必经 deserializeState（D-01 断言入口）');
});

test('QAS-18 验收5 · H3 仅能力位签名：flag 冻结 false、remote 恒 undefined、全库零同步实现', () => {
  assert.equal(SAVE_FEATURE_FLAGS.h3CrossDeviceSync, false);
  assert.equal(Object.isFrozen(SAVE_FEATURE_FLAGS), true, 'flag 对象冻结');
  const storage = createInMemorySaveStorage();
  assert.equal(storage.remote, undefined);

  const types = read('src/save/types.ts');
  for (const sig of ['readRemote', 'writeRemote', 'currentVersionVector']) {
    assert.equal(types.includes(sig), true, '能力位签名存在：' + sig);
  }
  // 全 src/** 零实现：无 class 实现该接口、无网络原语
  const srcFiles: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const p = dir + '/' + e.name;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) srcFiles.push(p);
    }
  };
  walk('src');
  assert.ok(srcFiles.length >= 25, 'src 扫描面足够（实得 ' + srcFiles.length + '）');
  for (const f of srcFiles) {
    const src = read(f);
    assert.equal(src.includes('implements RemoteSaveCapabilities'), false, f + ' 不得实现远端能力位');
    if (f !== 'src/save/types.ts') {
      // types.ts 内的 `readRemote(...)` 是接口签名本身，不算实现；此处只查"别处有没有实现"
      assert.equal(/\breadRemote\s*\(/.test(src), false, f + ' 不得实现 readRemote');
      assert.equal(/\bwriteRemote\s*\(/.test(src), false, f + ' 不得实现 writeRemote');
    }
    assert.equal(src.includes('fetch('), false, f + ' 零网络原语');
  }
});

test('QAS-19 README 声明的 src 行数与磁盘逐项一致 + barrel 出口集合受控', () => {
  const md = read('src/README.md');
  const rows: Array<{ path: string; declared: number }> = [];
  const re = /^\|\s*`(src\/[^`]+)`\s*\|\s*(\d+)\s*\|/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) rows.push({ path: m[1], declared: Number(m[2]) });
  assert.ok(rows.length >= 20, 'README 声明行数不少于 20 条（实得 ' + rows.length + '）');

  const seen: string[] = [];
  for (const r of rows) {
    const actual = lineCount(r.path);
    assert.equal(actual, r.declared, r.path + ' 声明 ' + r.declared + ' 实际 ' + actual);
    seen.push(r.path);
  }
  for (const p of ['src/save/types.ts', 'src/save/storage.ts', 'src/save/save-service.ts', 'src/save/index.ts']) {
    assert.equal(seen.includes(p), true, '§2.3 必须声明 ' + p);
  }

  // T-145 升级：原断言把 src/index.ts 行数硬编码为 28，S-11（T-143）补 rollback 出口后变 29 → 误红。
  // 硬编码行数只是"另一个数字要同步"，并不真正约束导出面；改为两条更强的断言：
  //   ① 行数由 README 声明、并与磁盘动态比对（上面的循环已覆盖 src/index.ts，这里显式再钉一次）
  //   ② **barrel 出口集合受控**：增删任何一个出口都必须在此登记（比行数更硬，且不受注释/空行影响）
  const declaredIndex = rows.find((r) => r.path === 'src/index.ts');
  assert.ok(declaredIndex !== undefined, 'README §2 必须声明 src/index.ts 行数');
  assert.equal(lineCount('src/index.ts'), declaredIndex.declared, 'src/index.ts 声明行数与磁盘一致');

  const EXPECTED_BARREL_EXPORTS = [
    './core/types.ts',
    './core/config.ts',
    './core/schema.ts',
    './simulation/commands.ts',
    './simulation/snapshot.ts',
    './simulation/traffic.ts',
    './simulation/tick-pipeline.ts',
    './simulation/session.ts',
    './simulation/rollback.ts',
    './save/index.ts',
    './render/iso.ts',
    './render/view-model.ts',
    './render/semantic-tokens.ts',
    './render/atlas.ts',
    './render/asset-naming.ts',
    './render/texture-format.ts',
    './render/draw-list.ts',
    './render/flow-legend.ts',
    './render/backend.ts',
    './render/cocos/cocos-backend.ts',
  ];
  const actualExports = Array.from(
    read('src/index.ts').matchAll(/^export \* from '([^']+)';$/gm),
  ).map((mm) => mm[1]);
  assert.deepEqual(actualExports, EXPECTED_BARREL_EXPORTS,
    '统一出口集合受控：新增 / 删除 / 改写任一 export 都必须同步本清单（S-11 起含 simulation/rollback.ts）');
});

test('QAS-20 诚实话语：文档中"真机 / 断点续玩 / 达标"字样无一处构成正面声称', () => {
  const docs = [
    'src/README.md',
    'src/save/types.ts',
    'src/save/storage.ts',
    'src/save/index.ts',
    'tests/verification/s10-save-verification.md',
    'tests/verification/s10-idempotency-contract.md',
  ];
  const keywords = ['真机验证', '断点续玩', '已达标', '真机实测'];
  // 判据：命中行必须要么处于否定 / 限定语境，要么是"阶段清单里的条目名"（如「S-06~S-12：…断点续玩…」）。
  // 这不是正则万能，是**留痕式启发式**：命中行全部收集，任一行两条都不满足即报红并打印原文。
  const negation = /(严禁|不得|不可|不应|不能|不会|未验证|未达成|尚未|没有|非|勿|不构成|不做|不声称|不据此|无需|仅|只有|限定|BLOCKED|PARTIAL|EX-03)/;
  const roadmapItem = /[Ss]-\d+\s*[~\-–]\s*[Ss]-\d+/;
  const hits: Array<{ where: string; line: string; allowed: boolean }> = [];
  for (const d of docs) {
    read(d).split('\n').forEach((line, i) => {
      for (const k of keywords) {
        if (!line.includes(k)) continue;
        hits.push({
          where: d + ':' + (i + 1),
          line: line.trim().slice(0, 140),
          allowed: negation.test(line) || roadmapItem.test(line),
        });
      }
    });
  }
  assert.ok(hits.length > 0, '本项确实扫描到相关字样（防永真，实得 ' + hits.length + '）');
  const bad = hits.filter((h) => !h.allowed).map((h) => h.where + ' → ' + h.line);
  assert.deepEqual(bad, [], '存在正面声称：\n' + bad.join('\n'));
  // 反向证据：明确写死的否定表述确实存在（不是靠没写字混过去）
  assert.equal(read('tests/verification/s10-save-verification.md').includes('严禁声称'), true);
  assert.equal(read('src/save/types.ts').includes('不得声称'), true);
});

// ===========================================================================
// F 线 · 契约准确性 / 反向对照 / 键重建
// ===========================================================================

test('QAS-21 F线① 契约准确性：去重在 commands/session，内核零二次校验（代码事实锚点）', () => {
  const commands = read('src/simulation/commands.ts');
  assert.equal(commands.includes('seen.has(cmd.idempotencyKey)'), true, 'enqueue 用 seen.has 去重');
  assert.equal(commands.includes('seen.add(cmd.idempotencyKey)'), true, 'enqueue 用 seen.add 登记');

  const session = read('src/simulation/session.ts');
  assert.equal(session.includes('queue.enqueue('), true, '编排层经 CommandQueue.enqueue');
  assert.equal(session.includes('seenAdvanceKeys'), true, 'ADVANCE 键单独守卫');

  // 内核：runTick 里出现 idempotencyKey 只为溯源，不做 has/add 判定
  const tick = read('src/simulation/tick-pipeline.ts');
  assert.equal(tick.includes('idempotencyKey'), true);
  for (const bad of ['seen.has(', 'seen.add(', 'seenAdvanceKeys', 'DUPLICATE']) {
    assert.equal(tick.includes(bad), false, 'runTick 层不得出现 ' + bad);
  }

  // 存档层零幂等键集合（唯一 seen 是迁移防环哨兵）
  const svc = read('src/save/save-service.ts');
  const seenUses = (svc.match(/\bseen\b/g) ?? []).length;
  assert.ok(seenUses <= 4, 'save-service 中 seen 仅用于迁移防环（实得 ' + seenUses + ' 次）');
  assert.equal(svc.includes('seen.add(cur.header.schemaVersion)'), true, 'seen 元素是 schemaVersion');
  assert.equal(svc.includes('seen.add(cmd'), false, '存档层不登记命令幂等键');
});

test('QAS-22 F线② 反向对照：同 key 两条命令直接喂内核 → 两条都应用（去重不发生在内核）', () => {
  const config = baseConfig();
  const ws = createTickWorkspace(config, SIDE);
  const s0 = createInitialState(config, { side: SIDE });
  const dupKey = 'qas-dup-key';
  const out = runTick(s0, [
    makeCommand.zone(dupKey, 1, 2, 2, 'R', 2),
    makeCommand.zone(dupKey, 2, 5, 5, 'C', 1),
    makeCommand.advance('qas-adv', 3),
  ], config, ws);
  assert.deepEqual(Array.from(out.commandTrace), [dupKey, dupKey, 'qas-adv'],
    '内核如实记录两条同 key 命令 → 不去重');
  assert.notEqual(out.state.cells.zone[2 * SIDE + 2], 0);
  assert.notEqual(out.state.cells.zone[5 * SIDE + 5], 0, '两条都落到网格上');
});

test('QAS-23 F线② 反向对照：队列层同 key 只进一条；重复 ADVANCE 键不产生第二个 tick', () => {
  const q = createCommandQueue();
  assert.equal(q.enqueue(makeCommand.advance('qas-a1', 1)), true);
  assert.equal(q.enqueue(makeCommand.advance('qas-a1', 2)), false, '同 key 第二次被拒');
  assert.equal(q.size, 1);
  assert.deepEqual(q.drain().map((c) => c.idempotencyKey), ['qas-a1']);
  assert.equal(q.size, 0, 'drain 后清空');
  assert.equal(q.enqueue(makeCommand.advance('qas-a1', 3)), false,
    'drain 后 seen 仍记住旧 key（队列只在 clear() 时清键）→ 同会话同 key 永不复用');
  q.clear();
  assert.equal(q.enqueue(makeCommand.advance('qas-a1', 4)), true, 'clear() 才重建键集合');

  // 内核层：两条 ADVANCE 仍只结算一次（P0 每 tick 只提交一次），由 commands 层保证只有一条进入
  const config = baseConfig();
  const ws = createTickWorkspace(config, SIDE);
  const out = runTick(createInitialState(config, { side: SIDE }), [
    makeCommand.advance('qas-x', 1),
    makeCommand.advance('qas-x', 2),
  ], config, ws);
  assert.equal(out.state.tickId, 1, '一次 runTick 只推进一个 tick（与命令条数无关）');
});

test('QAS-24 F线④ 键重建：存档恢复后键集合从零重建 → 旧 key 在新会话被接受一次（如实披露）', () => {
  const config = baseConfig();
  const state = qaState(config, 3);
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  svc.save({ state });
  const r = svc.load(config);
  assert.equal(r.ok, true);

  // load() 只返回状态，不返回任何"已见键集合"——签名层面即不可能回填
  assert.deepEqual(
    Object.keys(r).sort(),
    ['damagedSlots', 'header', 'ledger', 'notice', 'ok', 'prngSeed', 'slotId', 'state', 'validSlots'],
    'LoadResult 不含任何幂等键集合字段',
  );
  // 新会话（新建队列）对旧 key 会再接受一次 —— 与契约文档 §4.3 的如实披露一致
  const q = createCommandQueue();
  assert.equal(q.enqueue(makeCommand.fund('qas-f-1', 1, 5)), true, '旧 key 在新会话被接受一次');
  // ledger 携带的历史 commandTrace 字符串仅供溯源，不被用作去重输入
  const ledgerText = read('src/save/save-service.ts');
  assert.equal(ledgerText.includes('commandTrace'), false, '存档层不读 ledger.commandTrace 参与判定');
});

test('QAS-25 F线⑥⑦ 裁定落地：证据表原文保留 + 口径订正注记 + §4.3 如实披露未被删改', () => {
  const ev = read('tests/verification/w1-gate-remediation-evidence.md');
  assert.equal(ev.includes('D-03'), true);
  assert.equal(ev.includes('口径订正'), true, '表后有口径订正注记（裁定①）');
  assert.equal(ev.includes('2026-11-07'), true);

  const contract = read('tests/verification/s10-idempotency-contract.md');
  assert.equal(contract.includes('会被接受一次'), true, '§4.3 如实披露原文保留（裁定②）');
  assert.equal(contract.includes('不提供「跨会话全局幂等」'), true);
  assert.equal(contract.includes('EX-03'), true, '双层判定口径写在文档内');
  assert.equal(contract.includes('runTick 负责去重'), false, '不得出现与契约相悖的表述');
});
