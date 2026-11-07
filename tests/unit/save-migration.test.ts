/**
 * HC-01 · T-140 · 版本迁移 / 无静默续算（SM-W4-03 / S-10 验收 3）
 *
 * 覆盖：
 * ① 默认零迁移器：schemaVersion 不匹配 → 拒绝载入 + 保留旧槽 + 提示，state=null；
 * ② 显式迁移器：注册后按链升级成功，且迁移结果不写回介质（旧槽逐字节保留）；
 * ③ 迁移链多跳 / 谎报目标版本 / 成环 → 拒绝（防环上限）；
 * ④ configHash 漂移：D-01 硬拒绝，即使注册迁移器也绝不静默用新公式续算；
 * ⑤ engineVersion 不匹配 → 无迁移器拒绝；
 * ⑥ header 与 current 版本不一致（伪造头）→ parseSaveSlot 直接判损坏；
 * ⑦ 「禁止静默续算」静态证据：载入必经 deserializeState，代码库无重算分支；
 * ⑧ 迁移后状态五类字段逐字节一致、tickId 不推进。
 *
 * 【介质口径】内存模拟介质；真机持久化未验证（EX-03 顺延、准出阻塞）。
 * 零依赖：Node 22 --experimental-strip-types + node:test。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  SCHEMA_VERSION,
  ENGINE_VERSION,
  createDefaultConfig,
  createInitialState,
  createTickWorkspace,
  runTick,
  makeCommand,
  serializeState,
  deserializeState,
  canonicalize,
  computeConfigHash,
  createSaveService,
  createInMemorySaveStorage,
  computeSaveChecksum,
  parseSaveSlot,
  type Config,
  type CityState,
  type SaveMigration,
  type SaveSlot,
  type SaveSlotId,
  type InMemorySaveStorage,
} from '../../src/index.ts';

const SIDE = 16;
const LEGACY_V0 = 'HC01-SCHEMA-0';
const LEGACY_V_MID = 'HC01-SCHEMA-0.5';

function baseConfig(): Config {
  return createDefaultConfig({ K: 2, S_unlock: 0 });
}

function makeState(config: Config, ticks: number): CityState {
  const ws = createTickWorkspace(config, SIDE);
  let s = createInitialState(config, { side: SIDE });
  for (let t = 1; t <= ticks; t++) {
    s = runTick(s, [
      makeCommand.zone('mz-' + t, t, 2, 2, 'R', 2),
      makeCommand.road('mr-' + t, t + 20, 3, 2),
      makeCommand.fund('mf-' + t, t + 40, 5),
      makeCommand.advance('ma-' + t, t + 60),
    ], config, ws).state;
  }
  return deserializeState(serializeState(s), config);
}

/** 读出一个合法槽，按 mutator 改写后重算 checksum 写回（用于构造旧版本 / 漂移存档） */
function forgeSlot(storage: InMemorySaveStorage, id: SaveSlotId, mutate: (s: SaveSlot) => SaveSlot): void {
  const raw = storage.raw(id);
  assert.ok(raw !== null, '待改写的槽必须存在');
  const base = parseSaveSlot(raw);
  assert.ok(base !== null, '待改写的槽必须合法');
  const changed = mutate(base);
  const sum = computeSaveChecksum(changed);
  const final: SaveSlot = {
    ...changed,
    header: { ...changed.header, checksum: sum },
    checksum: sum,
  };
  storage.write(id, JSON.stringify(final));
}

/** 把一个槽改造为「旧 schemaVersion」：header 与 current 同步改写，保持结构自洽 */
function toLegacy(s: SaveSlot, version: string): SaveSlot {
  return {
    ...s,
    header: { ...s.header, schemaVersion: version },
    current: { ...s.current, schemaVersion: version },
  };
}

/** 迁移器：显式把 header + current 的 schemaVersion 升到目标版本（不重算任何模拟量） */
function upgrader(fromSchemaVersion: string, toSchemaVersion: string): SaveMigration {
  return {
    id: 'test-upgrade-' + fromSchemaVersion + '-to-' + toSchemaVersion,
    fromSchemaVersion,
    toSchemaVersion,
    migrate(slot) {
      return {
        ...slot,
        header: { ...slot.header, schemaVersion: toSchemaVersion },
        current: { ...slot.current, schemaVersion: toSchemaVersion },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// ① 默认零迁移器：拒绝 + 保留旧槽
// ---------------------------------------------------------------------------

test('MG-1 SM-W4-03 默认零迁移器：schemaVersion 不匹配 → 拒绝载入并保留旧槽', () => {
  const config = baseConfig();
  const state = makeState(config, 5);
  const storage = createInMemorySaveStorage();
  createSaveService(storage, config).save({ state });
  forgeSlot(storage, 'A', (s) => toLegacy(s, LEGACY_V0));
  const legacyBytes = storage.raw('A');

  // 结构本身合法（checksum 已重算），只是版本旧
  const parsed = parseSaveSlot(legacyBytes);
  assert.ok(parsed !== null);
  assert.equal(parsed.header.schemaVersion, LEGACY_V0);
  assert.equal(parsed.current.schemaVersion, LEGACY_V0);

  const loaded = createSaveService(storage, config).load(config); // 不注册迁移器
  assert.equal(loaded.ok, false, '无迁移器必须拒绝');
  assert.equal(loaded.state, null, '绝不静默用新公式续算旧档');
  assert.equal(loaded.slotId, null);
  assert.equal(loaded.notice.code, 'VERSION_MISMATCH_NO_MIGRATOR');
  assert.ok(loaded.notice.message.indexOf('拒绝载入') >= 0, '提示须含「拒绝载入」');
  assert.ok(loaded.notice.message.indexOf('保留旧存档') >= 0, '提示须含「保留旧存档」');
  assert.deepEqual(loaded.validSlots, ['A'], '槽通过校验但版本不匹配');
  assert.equal(storage.raw('A'), legacyBytes, '旧槽逐字节保留，未被覆盖或迁移写回');
});

test('MG-2 双槽场景：新槽版本不匹配但旧槽完好 → 回退旧槽并提示（不静默续算）', () => {
  const config = baseConfig();
  const older = makeState(config, 3);
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  svc.save({ state: older });                 // A: seq1 当前版本
  svc.save({ state: makeState(config, 5) }); // B: seq2
  forgeSlot(storage, 'B', (s) => toLegacy(s, LEGACY_V0)); // 最新槽变旧版本

  const loaded = createSaveService(storage, config).load(config);
  assert.equal(loaded.ok, true, '按 writeSeq 降序跳过不兼容槽，回退完好且兼容的旧槽');
  assert.equal(loaded.slotId, 'A');
  assert.equal(loaded.notice.code, 'FELL_BACK_TO_PREVIOUS_SLOT');
  assert.equal(canonicalize(serializeState(loaded.state)), canonicalize(serializeState(older)));
  assert.equal(loaded.state.tickId, older.tickId, '不推进 tick');
});

// ---------------------------------------------------------------------------
// ② 显式迁移器
// ---------------------------------------------------------------------------

test('MG-3 注册显式迁移器 → 升级成功，五类字段逐字节一致，且迁移结果不写回介质', () => {
  const config = baseConfig();
  const state = makeState(config, 5);
  const expected = canonicalize(serializeState(state));
  const storage = createInMemorySaveStorage();
  createSaveService(storage, config).save({ state });
  forgeSlot(storage, 'A', (s) => toLegacy(s, LEGACY_V0));
  const legacyBytes = storage.raw('A');
  const writesBefore = storage.writeCount;

  const svc = createSaveService(storage, config, {
    migrations: [upgrader(LEGACY_V0, SCHEMA_VERSION)],
  });
  const loaded = svc.load(config);
  assert.equal(loaded.ok, true, '显式迁移后可载入');
  assert.equal(loaded.notice.code, 'MIGRATED');
  assert.ok(loaded.notice.message.indexOf('显式迁移器') >= 0);
  assert.equal(loaded.header.schemaVersion, SCHEMA_VERSION, '迁移后头版本已升级');
  assert.equal(canonicalize(serializeState(loaded.state)), expected, '五类字段逐字节一致');
  assert.equal(loaded.state.tickId, state.tickId, '迁移不推进 tick');
  assert.equal(storage.raw('A'), legacyBytes, '迁移结果不写回，旧槽逐字节保留');
  assert.equal(storage.writeCount, writesBefore, 'load 不产生任何写入');
});

test('MG-4 迁移链多跳：V0 → V0.5 → 当前版本，按顺序升级成功', () => {
  const config = baseConfig();
  const state = makeState(config, 5);
  const storage = createInMemorySaveStorage();
  createSaveService(storage, config).save({ state });
  forgeSlot(storage, 'A', (s) => toLegacy(s, LEGACY_V0));

  const svc = createSaveService(storage, config, {
    migrations: [upgrader(LEGACY_V0, LEGACY_V_MID), upgrader(LEGACY_V_MID, SCHEMA_VERSION)],
  });
  const loaded = svc.load(config);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.notice.code, 'MIGRATED');
  assert.equal(loaded.header.schemaVersion, SCHEMA_VERSION);
  assert.equal(canonicalize(serializeState(loaded.state)), canonicalize(serializeState(state)));
});

test('MG-5 迁移器谎报目标版本 / 链缺失 / 成环 → 拒绝载入（防环上限）', () => {
  const config = baseConfig();
  const state = makeState(config, 5);

  // (a) 谎报：migrate 结果 header 版本与 toSchemaVersion 不符
  {
    const storage = createInMemorySaveStorage();
    createSaveService(storage, config).save({ state });
    forgeSlot(storage, 'A', (s) => toLegacy(s, LEGACY_V0));
    const liar: SaveMigration = {
      id: 'liar',
      fromSchemaVersion: LEGACY_V0,
      toSchemaVersion: SCHEMA_VERSION,
      migrate(slot) { return slot; }, // 谎报：没有真升级
    };
    const r = createSaveService(storage, config, { migrations: [liar] }).load(config);
    assert.equal(r.ok, false);
    assert.equal(r.state, null);
    assert.equal(r.notice.code, 'VERSION_MISMATCH_NO_MIGRATOR');
  }
  // (b) 链缺失：只有 V0→V0.5，没有 V0.5→当前
  {
    const storage = createInMemorySaveStorage();
    createSaveService(storage, config).save({ state });
    forgeSlot(storage, 'A', (s) => toLegacy(s, LEGACY_V0));
    const r = createSaveService(storage, config, {
      migrations: [upgrader(LEGACY_V0, LEGACY_V_MID)],
    }).load(config);
    assert.equal(r.ok, false, '链断在中间须拒绝');
    assert.equal(r.state, null);
  }
  // (c) 成环：V0→V0.5→V0，防环上限拦截，不无限循环
  {
    const storage = createInMemorySaveStorage();
    createSaveService(storage, config).save({ state });
    forgeSlot(storage, 'A', (s) => toLegacy(s, LEGACY_V0));
    const r = createSaveService(storage, config, {
      migrations: [upgrader(LEGACY_V0, LEGACY_V_MID), upgrader(LEGACY_V_MID, LEGACY_V0)],
    }).load(config);
    assert.equal(r.ok, false, '成环须拒绝');
    assert.equal(r.state, null);
  }
});

// ---------------------------------------------------------------------------
// ④ configHash / ⑤ engineVersion 漂移
// ---------------------------------------------------------------------------

test('MG-6 configHash 漂移：D-01 硬拒绝，即使注册迁移器也不静默续算', () => {
  const config = baseConfig();
  const state = makeState(config, 5);
  const storage = createInMemorySaveStorage();
  createSaveService(storage, config).save({ state });
  const drifted = 'drifted-config-hash';
  forgeSlot(storage, 'A', (s) => ({
    ...s,
    header: { ...s.header, configHash: drifted },
    current: { ...s.current, configHash: drifted },
  }));
  const bytes = storage.raw('A');
  assert.equal(parseSaveSlot(bytes).header.configHash, drifted, '结构自洽但 hash 漂移');

  const svc = createSaveService(storage, config, {
    migrations: [upgrader(LEGACY_V0, SCHEMA_VERSION)], // 故意注册也无效
  });
  const loaded = svc.load(config);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.state, null, '绝不静默用新公式续算旧档');
  assert.equal(loaded.notice.code, 'CONFIG_MISMATCH_REJECTED');
  assert.ok(loaded.notice.message.indexOf('静默续算') >= 0);
  assert.equal(storage.raw('A'), bytes, '旧槽保留');

  // 用另一套 config 载入同一份正常存档同样被 D-01 拦截
  const storage2 = createInMemorySaveStorage();
  createSaveService(storage2, config).save({ state });
  const other = createDefaultConfig({ K: 9 });
  assert.notEqual(computeConfigHash(other), computeConfigHash(config));
  const r2 = createSaveService(storage2, other).load(other);
  assert.equal(r2.ok, false);
  assert.equal(r2.state, null);
  assert.equal(r2.notice.code, 'CONFIG_MISMATCH_REJECTED');
});

test('MG-7 engineVersion 不匹配 → 无迁移器拒绝载入并保留旧槽', () => {
  const config = baseConfig();
  const state = makeState(config, 5);
  const storage = createInMemorySaveStorage();
  createSaveService(storage, config).save({ state });
  forgeSlot(storage, 'A', (s) => ({
    ...s,
    header: { ...s.header, engineVersion: 'HC01-CORE-0.0.1' },
    current: { ...s.current, engineVersion: 'HC01-CORE-0.0.1' },
  }));
  const bytes = storage.raw('A');
  const loaded = createSaveService(storage, config).load(config);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.state, null);
  assert.equal(loaded.notice.code, 'VERSION_MISMATCH_NO_MIGRATOR');
  assert.ok(loaded.notice.message.indexOf('engineVersion') >= 0);
  assert.equal(storage.raw('A'), bytes, '旧槽保留');
  assert.notEqual(ENGINE_VERSION, 'HC01-CORE-0.0.1');
});

// ---------------------------------------------------------------------------
// ⑥ 伪造头 / ⑦ 静态证据
// ---------------------------------------------------------------------------

test('MG-8 header 与 current 版本不一致（伪造头）→ parseSaveSlot 判损坏，绝不半加载', () => {
  const config = baseConfig();
  const state = makeState(config, 5);
  const storage = createInMemorySaveStorage();
  createSaveService(storage, config).save({ state });
  forgeSlot(storage, 'A', (s) => ({
    ...s,
    header: { ...s.header, schemaVersion: SCHEMA_VERSION },
    current: { ...s.current, schemaVersion: LEGACY_V0 }, // 头新体旧
  }));
  const raw = storage.raw('A');
  assert.equal(parseSaveSlot(raw), null, '伪造头一律拒绝');
  const loaded = createSaveService(storage, config).load(config);
  assert.equal(loaded.ok, false);
  assert.equal(loaded.state, null);
  assert.equal(loaded.notice.code, 'NO_VALID_SLOT');
  assert.deepEqual(loaded.damagedSlots, ['A']);
});

test('MG-9 静态证据：禁止静默续算 —— 载入必经 deserializeState，源码零重算分支', () => {
  const src = readFileSync(join(process.cwd(), 'src/save/save-service.ts'), 'utf8');
  // 正向：D-01 唯一入口存在
  assert.ok(src.indexOf('deserializeState(effective.current, config)') >= 0,
    '载入必经 deserializeState → assertConfigCompatible（D-01）');
  assert.ok(src.indexOf('assertConfigCompatible(input.state, config)') >= 0,
    '写入侧也做 D-01 兼容性断言');
  // 反向：无静默续算 / 重算模拟 / 逆运算路径
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  for (const banned of [
    /\brunTick\s*\(/, /\bsolveTraffic\s*\(/, /\badvanceDay\s*\(/,
    /\bcreateSimulation\s*\(/, /computeBaselineS\s*\(/, /\baggregate\s*\(/,
  ]) {
    assert.equal(banned.test(code), false, '存档层不得出现模拟重算：' + banned);
  }
  // 反向：无「旧档 + 新公式」的隐式分支（configHash 不匹配必须硬拒绝）
  assert.ok(/CONFIG_MISMATCH_REJECTED/.test(src), 'configHash 漂移必须有显式拒绝码');
  assert.ok(/VERSION_MISMATCH_NO_MIGRATOR/.test(src), '版本不匹配必须有显式拒绝码');
  assert.ok(src.indexOf('禁止静默') >= 0 || src.indexOf('绝不') >= 0, '注释须明确无静默续算口径');
});

test('MG-10 header 五字段齐备的机器判读 + 当前版本常量一致（SM-W4-03）', () => {
  const config = baseConfig();
  const state = makeState(config, 5);
  const storage = createInMemorySaveStorage();
  createSaveService(storage, config).save({ state });
  const slot = parseSaveSlot(storage.raw('A'));
  assert.ok(slot !== null);
  const h = slot.header;
  for (const k of ['schemaVersion', 'configHash', 'engineVersion', 'seed', 'checksum'] as const) {
    assert.ok(h[k] !== undefined && h[k] !== null && h[k] !== '', 'header 缺字段 ' + k);
  }
  assert.equal(h.schemaVersion, SCHEMA_VERSION);
  assert.equal(h.configHash, computeConfigHash(config));
  assert.equal(h.engineVersion, ENGINE_VERSION);
  assert.equal(h.seed, state.seed);
  assert.equal(typeof h.checksum, 'string');
  assert.equal(typeof h.saveTime, 'string', 'saveTime 仅展示字段存在');
});
