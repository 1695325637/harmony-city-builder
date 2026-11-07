/**
 * HC-01 · T-140 · S-10 存档服务（SM-W4-01 / 验收 1·3·4·5）
 *
 * 覆盖：
 * ① header 五字段齐备 + saveTime 仅展示；
 * ② 五类字段（网格 / 预算 / 满意度 / 议题 / 解锁进度）逐项一致恢复、不推进 tick；
 * ③ 恢复「最近 tick」= 按 writeSeq 择优；
 * ④ checksum 防误改 / 防写坏（篡改即拒绝）；
 * ⑤ saveTime 不参与模拟计算（不同展示标签 → 状态逐字节一致）；
 * ⑥ 冷归档 ledger ≥3 周期 + prngSeed 往返 + 确定性；
 * ⑦ 权限 / 墙上时钟 / 零依赖静态扫描（S-10 验收 4）；
 * ⑧ H3 零同步实现 + feature flag 默认关（S-10 验收 5）；
 * ⑨ D-01 正向：save 拒绝不兼容状态、load 必经 deserializeState。
 *
 * 【介质口径】内存模拟介质；真机持久化未验证（EX-03 顺延、准出阻塞）。
 * 零依赖：Node 22 --experimental-strip-types + node:test。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  SCHEMA_VERSION,
  ENGINE_VERSION,
  ConfigMismatchError,
  createDefaultConfig,
  createInitialState,
  createTickWorkspace,
  createInMemorySnapshotStore,
  buildTickSnapshot,
  runTick,
  makeCommand,
  serializeState,
  deserializeState,
  canonicalize,
  computeConfigHash,
  assertConfigCompatible,
  createSaveService,
  createInMemorySaveStorage,
  computeSaveChecksum,
  parseSaveSlot,
  buildSaveLedger,
  SAVE_FEATURE_FLAGS,
  type Config,
  type CityState,
  type SaveSlot,
} from '../../src/index.ts';

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

const SIDE = 16;

/** 真实 runTick 构造含五类字段的状态；deserializeState 深拷贝成独立对象（workspace scratch 复用） */
function makeRichState(config: Config, ticks: number): CityState {
  const ws = createTickWorkspace(config, SIDE);
  let s = createInitialState(config, { side: SIDE });
  for (let t = 1; t <= ticks; t++) {
    const cmds = [
      makeCommand.zone('z1-' + t, 1 + t * 10, 2, 2, 'R', 2),
      makeCommand.zone('z2-' + t, 2 + t * 10, 3, 2, 'R', 3),
      makeCommand.road('r1-' + t, 3 + t * 10, 2, 3),
      makeCommand.fund('f1-' + t, 4 + t * 10, 12),
      makeCommand.advance('a1-' + t, 5 + t * 10),
    ];
    s = runTick(s, cmds, config, ws).state;
  }
  const copy = deserializeState(serializeState(s), config);
  copy.seed = 20261107 + ticks; // 非默认 seed，用于验证 prngSeed 往返
  return copy;
}

function baseConfig(): Config {
  return createDefaultConfig({ K: 2, S_unlock: 0 });
}

/** 去注释 + 去字符串（用于代码层静态扫描，避免注释里的「反例说明」误报） */
function stripNonCode(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  out = out.replace(/'(?:\\.|[^'\\\n])*'/g, "''");
  out = out.replace(/"(?:\\.|[^"\\\n])*"/g, '""');
  out = out.replace(/`(?:\\.|[^`\\])*`/g, '``');
  return out;
}

function saveFiles(): string[] {
  const root = join(process.cwd(), 'src/save');
  return readdirSync(root, { recursive: true })
    .map((f) => join(root, String(f)))
    .filter((p) => p.endsWith('.ts'));
}

function allSrcTs(): string[] {
  const root = join(process.cwd(), 'src');
  return readdirSync(root, { recursive: true })
    .map((f) => join(root, String(f)))
    .filter((p) => p.endsWith('.ts'));
}

/** 五类字段逐项断言（不只看整体 canonicalize，防止某个字段恰好相同掩盖丢失） */
function assertFiveCategories(restored: CityState, expected: CityState, label: string): void {
  assert.deepEqual(Array.from(restored.cells.zone), Array.from(expected.cells.zone), label + ' 网格 zone');
  assert.deepEqual(Array.from(restored.cells.density), Array.from(expected.cells.density), label + ' 网格 density');
  assert.deepEqual(Array.from(restored.cells.unlocked), Array.from(expected.cells.unlocked), label + ' 网格 unlocked');
  assert.deepEqual(Array.from(restored.cells.region), Array.from(expected.cells.region), label + ' 网格 region');
  assert.deepEqual(Array.from(restored.cells.inputVersion), Array.from(expected.cells.inputVersion), label + ' 网格 inputVersion');
  assert.deepEqual(restored.budget, expected.budget, label + ' 预算');
  assert.equal(restored.frames.current.S, expected.frames.current.S, label + ' 满意度 S');
  assert.deepEqual(Array.from(restored.frames.current.factors), Array.from(expected.frames.current.factors), label + ' 满意度四因子');
  assert.equal(restored.frames.prev.S, expected.frames.prev.S, label + ' 上一帧满意度');
  assert.equal(restored.issueCount, expected.issueCount, label + ' 议题');
  assert.equal(restored.unlockedRegions, expected.unlockedRegions, label + ' 解锁进度');
}

// ---------------------------------------------------------------------------
// ① header / ② 五类字段 / 不推进 tick
// ---------------------------------------------------------------------------

test('SV-1 header 五字段齐备：schemaVersion / configHash / engineVersion / seed / checksum', () => {
  const config = baseConfig();
  const state = makeRichState(config, 5);
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const saved = svc.save({ state, displayTime: '2026-11-07 12:34（仅展示）' });
  assert.equal(saved.ok, true);
  assert.equal(saved.slotId, 'A');

  const raw = storage.raw('A');
  assert.ok(raw !== null);
  const slot = parseSaveSlot(raw);
  assert.ok(slot !== null);
  assert.equal(slot.header.schemaVersion, SCHEMA_VERSION, 'schemaVersion');
  assert.equal(slot.header.configHash, computeConfigHash(config), 'configHash');
  assert.equal(slot.header.engineVersion, ENGINE_VERSION, 'engineVersion');
  assert.equal(slot.header.seed, state.seed, 'seed');
  assert.equal(typeof slot.header.checksum, 'string', 'checksum');
  assert.ok(slot.header.checksum.length > 0);
  assert.equal(slot.checksum, slot.header.checksum, '两处 checksum 同源同值');
  assert.equal(slot.header.saveTime, '2026-11-07 12:34（仅展示）', 'saveTime 为调用方注入的展示标签');
  assert.deepEqual(Object.keys(slot.header).sort(),
    ['checksum', 'configHash', 'engineVersion', 'saveTime', 'schemaVersion', 'seed'].sort(),
    'header 恰为五字段 + saveTime');
});

test('SV-2 SM-W4-01：五类字段逐项一致恢复，不推进 tick / 不补算漏掉的 tick', () => {
  const config = baseConfig();
  const state = makeRichState(config, 5);
  // 前置：五类字段确实非平凡（否则「一致」无意义）
  assert.ok(state.tickId >= 5, 'tickId 非平凡');
  assert.ok(state.unlockedRegions > 0, '解锁进度非平凡');
  assert.ok(state.issueCount >= 2, '议题非平凡');
  assert.ok(Array.from(state.cells.zone).some((z) => z !== 0), '网格非平凡');
  assert.notEqual(state.budget.B, 0, '预算非平凡');
  assert.ok(Number.isFinite(state.frames.current.S), '满意度非平凡');

  const before = canonicalize(serializeState(state));
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  assert.equal(svc.save({ state }).ok, true);

  // 模拟「杀进程 / 切后台重进」：新建 SaveService，共用同一介质
  const reentered = createSaveService(storage, config);
  const loaded = reentered.load(config);
  assert.equal(loaded.ok, true, '恢复成功');
  assert.ok(loaded.state !== null);
  assert.equal(loaded.notice.code, 'NONE');
  assertFiveCategories(loaded.state, state, 'SM-W4-01');
  assert.equal(canonicalize(serializeState(loaded.state)), before, '完整状态逐字节一致');
  assert.equal(loaded.state.tickId, state.tickId, '不推进 tick');
  assert.equal(loaded.state.cycleId, state.cycleId, '不推进周期');
  assert.equal(loaded.state.cycleTickIndex, state.cycleTickIndex, '不补算漏掉的 tick');
  assert.equal(loaded.state.seed, state.seed, 'PRNG seed 一致');
  // D-01：载入产物必须通过兼容性断言
  assert.doesNotThrow(() => assertConfigCompatible(loaded.state, config));
});

test('SV-3 恢复到「最近 tick」：多次保存按 writeSeq 择优，取最新状态', () => {
  const config = baseConfig();
  const older = makeRichState(config, 3);
  const newer = makeRichState(config, 5);
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  assert.equal(svc.save({ state: older }).writeSeq, 1);
  assert.equal(svc.save({ state: newer }).writeSeq, 2);
  const loaded = createSaveService(storage, config).load(config);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.state.tickId, newer.tickId, '取 writeSeq 更大的最新槽');
  assert.equal(canonicalize(serializeState(loaded.state)), canonicalize(serializeState(newer)));
  assert.deepEqual(loaded.validSlots, ['B', 'A'], '候选按 writeSeq 降序');
});

// ---------------------------------------------------------------------------
// ④ checksum / ⑤ saveTime 不参与模拟
// ---------------------------------------------------------------------------

test('SV-4 checksum 防误改 / 防写坏：篡改 current 或 checksum 即拒绝载入', () => {
  const config = baseConfig();
  const state = makeRichState(config, 5);
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  svc.save({ state });

  const original = parseSaveSlot(storage.raw('A'));
  assert.ok(original !== null);
  assert.equal(computeSaveChecksum(original), original.checksum, 'checksum 可复算');

  // (a) 保持合法 JSON，但改坏一个预算数值 → checksum 不符
  const tampered = JSON.parse(JSON.stringify(original)) as SaveSlot;
  const t1 = { ...tampered, current: { ...tampered.current, budget: { ...tampered.current.budget, B: 999999 } } };
  assert.equal(parseSaveSlot(JSON.stringify(t1)), null, '数据被改坏 → parseSaveSlot 拒绝');
  // (b) 只改 checksum 字段本身 → 同样拒绝
  const t2 = { ...original, checksum: 'deadbeef', header: { ...original.header, checksum: 'deadbeef' } };
  assert.equal(parseSaveSlot(JSON.stringify(t2)), null, '伪造 checksum → 拒绝');
  // (c) 半损坏（截断）→ 拒绝，绝不加载半损坏数据
  const raw = storage.raw('A');
  assert.equal(parseSaveSlot(raw.slice(0, Math.floor(raw.length / 2))), null, '半损坏 JSON → 拒绝');
});

test('SV-5 saveTime 仅展示：不同展示标签 → 恢复状态逐字节一致，且不读时钟', () => {
  const config = baseConfig();
  const state = makeRichState(config, 5);
  const expected = canonicalize(serializeState(state));

  const a = createInMemorySaveStorage();
  const b = createInMemorySaveStorage();
  createSaveService(a, config).save({ state, displayTime: '2088-01-01 00:00（展示 A）' });
  createSaveService(b, config).save({ state, displayTime: '1970-01-01 00:00（展示 B）' });
  const la = createSaveService(a, config).load(config);
  const lb = createSaveService(b, config).load(config);
  assert.equal(la.ok, true);
  assert.equal(lb.ok, true);
  assert.equal(canonicalize(serializeState(la.state)), expected);
  assert.equal(canonicalize(serializeState(lb.state)), expected, 'saveTime 不影响状态');
  assert.notEqual(la.header.saveTime, lb.header.saveTime, '展示标签确实不同');
  assert.notEqual(la.header.checksum, lb.header.checksum, '展示标签纳入 checksum（防误改），但不进模拟');
  assert.equal(la.state.tickId, lb.state.tickId, '墙上展示时间不推进 tick');

  // 缺省标签为基于 tickId 的确定性标签，无时钟
  const c = createInMemorySaveStorage();
  createSaveService(c, config).save({ state });
  const lc = createSaveService(c, config).load(config);
  assert.equal(lc.header.saveTime, `tick:${state.tickId}`, '缺省标签确定性、非墙上时钟');
});

// ---------------------------------------------------------------------------
// ⑥ ledger / prngSeed / 确定性
// ---------------------------------------------------------------------------

test('SV-6 冷归档 ledger ≥3 周期 + prngSeed 往返：S-05 快照只读进档、不重算', () => {
  const config = baseConfig();
  const ws = createTickWorkspace(config, SIDE);
  let s = createInitialState(config, { side: SIDE });
  const store = createInMemorySnapshotStore();
  for (let t = 1; t <= 8; t++) {
    const r = runTick(s, [makeCommand.fund('sf-' + t, t, 3), makeCommand.advance('sa-' + t, t + 20)], config, ws);
    s = r.state;
    store.put(buildTickSnapshot(r));
  }
  const entries = store.entries();
  const cycles = new Set(entries.map((e) => e.cycleId));
  assert.ok(cycles.size >= 3, '真实 tick 序列覆盖 ≥3 周期，实际 ' + cycles.size);

  const ledger = buildSaveLedger(entries, 3);
  assert.equal(ledger.length, 3, '保留最近 3 周期');
  for (const c of ledger) assert.ok(c.snapshots.length >= 1, '每周期至少一条快照');
  assert.deepEqual(ledger.map((c) => c.cycleId),
    Array.from(cycles).sort((x, y) => x - y).slice(-3), '取最大的 3 个周期，确定性');
  assert.equal(Object.isFrozen(ledger), true, 'ledger 冻结');

  const state = deserializeState(serializeState(s), config);
  state.seed = 424242;
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const saved = svc.save({ state, ledger });
  assert.equal(saved.ok, true);
  const loaded = createSaveService(storage, config).load(config);
  assert.equal(loaded.ok, true);
  assert.equal(loaded.prngSeed, 424242, 'prngSeed 往返');
  assert.equal(loaded.header.seed, 424242, 'header.seed 与 prngSeed 同源');
  assert.equal(loaded.ledger.length, 3, 'ledger 往返 ≥3 周期');
  assert.deepEqual(loaded.ledger.map((c) => c.cycleId), ledger.map((c) => c.cycleId));
  assert.equal(canonicalize(serializeState(loaded.state)), canonicalize(serializeState(state)), '五类字段仍逐字节一致');
});

test('SV-7 确定性：同输入两次独立介质 checksum 一致，且 save 不修改输入 state', () => {
  const config = baseConfig();
  const state = makeRichState(config, 5);
  const before = canonicalize(serializeState(state));
  const a = createInMemorySaveStorage();
  const b = createInMemorySaveStorage();
  const ra = createSaveService(a, config).save({ state, displayTime: 'fixed' });
  const rb = createSaveService(b, config).save({ state, displayTime: 'fixed' });
  assert.equal(ra.checksum, rb.checksum, '同输入同 checksum（含 ledger / writeSeq）');
  assert.equal(a.raw('A'), b.raw('A'), '整槽字节逐字节一致');
  assert.equal(canonicalize(serializeState(state)), before, 'save 不修改输入状态');
  assert.equal(ra.writeSeq, 1);
});

// ---------------------------------------------------------------------------
// ⑦ 权限 / 墙上时钟 / 零依赖静态扫描（S-10 验收 4）
// ---------------------------------------------------------------------------

test('SV-8 静态扫描：无后台保活 / 精确闹钟 / 离线任务，无参与模拟的墙上时钟，零平台依赖', () => {
  const forbidden = [
    { name: '墙上时钟 / 原生随机 / 性能计时', re: /Date\.now|new\s+Date\s*\(|Math\.random|performance\.now|process\.hrtime/i },
    { name: '后台保活 / 精确闹钟 / 离线任务 / 倒计时 / 自动播放', re: /setInterval|setTimeout|countdown|requestAnimationFrame|autoPlay|auto_play|autoplay|keepAlive|exactAlarm|offlineTask|后台保活|精确闹钟|离线任务|倒计时|倍速|自动播放/i },
    { name: 'node: / 引擎 / 平台 / 渲染 import', re: /from\s+['"](?:node:|cocos|@ohos|@harmony|harmony|arkui|cc|three|pixi)/i },
    { name: '文件系统路径与权限 API', re: /require\s*\(|readFileSync|writeFileSync|renameSync|fsyncSync|openSync|requestPermissions|ohos\.permission/i },
    { name: '网络 / 同步实现', re: /\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/i },
  ];
  for (const f of saveFiles()) {
    const code = stripNonCode(readFileSync(f, 'utf8'));
    for (const b of forbidden) {
      assert.equal(b.re.test(code), false, f.replace(process.cwd(), '') + ' 命中禁令：' + b.name);
    }
  }
  // 存档结构里 saveTime 是唯一时间型字段，且本层绝不读取时钟
  const typesSrc = readFileSync(join(process.cwd(), 'src/save/types.ts'), 'utf8');
  assert.ok(typesSrc.indexOf('仅展示') >= 0, '必须显式标注 saveTime 仅展示');
  assert.ok(typesSrc.indexOf('不参与任何模拟计算') >= 0, '必须显式标注不参与模拟计算');
  const svcSrc = readFileSync(join(process.cwd(), 'src/save/save-service.ts'), 'utf8');
  assert.ok(/deserializeState\(effective\.current, config\)/.test(svcSrc),
    '载入只把 current 交给 deserializeState，header.saveTime 绝不进模拟');
  // 诚实口径：checksum 不是防篡改 / 反作弊，且介质标为内存模拟
  assert.ok(typesSrc.indexOf('不是反作弊') >= 0 && typesSrc.indexOf('防篡改') >= 0);
  assert.ok(typesSrc.indexOf('内存模拟介质') >= 0 && typesSrc.indexOf('EX-03') >= 0);
});

// ---------------------------------------------------------------------------
// ⑧ H3 零同步实现（S-10 验收 5）
// ---------------------------------------------------------------------------

test('SV-9 H3：能力位签名预留，但零同步实现、feature flag 默认关', () => {
  assert.equal(SAVE_FEATURE_FLAGS.h3CrossDeviceSync, false, 'H3 默认关');
  assert.equal(Object.isFrozen(SAVE_FEATURE_FLAGS), true, 'flag 冻结，无开启路径');
  const storage = createInMemorySaveStorage();
  assert.equal(storage.remote, undefined, '内存介质不提供远端能力');

  const typesSrc = readFileSync(join(process.cwd(), 'src/save/types.ts'), 'utf8');
  assert.ok(/export interface RemoteSaveCapabilities/.test(typesSrc), '远端读写能力位签名存在');
  assert.ok(/readRemote\(/.test(typesSrc) && /writeRemote\(/.test(typesSrc), '远端读 / 写签名齐备');
  assert.ok(/export interface VersionVector/.test(typesSrc), '版本向量能力位签名存在');
  assert.ok(/currentVersionVector\(/.test(typesSrc), '版本向量读取签名存在');
  assert.ok(/readonly remote\?: RemoteSaveCapabilities/.test(typesSrc), 'ISaveStorage 预留 remote 能力位');

  // 全代码库零同步实现：无 class / 对象实现该接口，无网络原语
  for (const f of allSrcTs()) {
    const code = stripNonCode(readFileSync(f, 'utf8'));
    assert.equal(/class\s+\w+\s+implements\s+RemoteSaveCapabilities/.test(code), false,
      f + ' 不得实现远端能力');
    assert.equal(/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/.test(code), false,
      f + ' 不得出现同步网络原语');
  }
});

// ---------------------------------------------------------------------------
// ⑨ D-01 正向联动
// ---------------------------------------------------------------------------

test('SV-10 D-01 联动：save 拒绝不兼容状态，load 必经 deserializeState / assertConfigCompatible', () => {
  const config = baseConfig();
  const other = createDefaultConfig({ K: 7 });
  const foreign = makeRichState(other, 3);
  const storage = createInMemorySaveStorage();
  const svc = createSaveService(storage, config);
  const rejected = svc.save({ state: foreign });
  assert.equal(rejected.ok, false, '旧配置状态不得写入当前配置存档');
  assert.equal(rejected.notice.code, 'SAVE_REJECTED_INCOMPATIBLE_STATE');
  assert.equal(storage.writeCount, 0, '未改动任何槽');
  assert.equal(storage.raw('A'), null);

  // 底层 D-01 断言确实存在（不得被存档层绕过）
  assert.throws(() => deserializeState(serializeState(foreign), config), ConfigMismatchError);

  // 载入路径显式调用 deserializeState（D-01 唯一入口）
  const svcSrc = readFileSync(join(process.cwd(), 'src/save/save-service.ts'), 'utf8');
  assert.ok(svcSrc.indexOf('deserializeState(effective.current, config)') >= 0);
  assert.ok(svcSrc.indexOf('assertConfigCompatible(input.state, config)') >= 0);
  // 载入层绝不重算模拟：无 runTick / advanceDay / solveTraffic 调用
  const code = stripNonCode(svcSrc);
  assert.equal(/\brunTick\s*\(|\badvanceDay\s*\(|\bsolveTraffic\s*\(|createSimulation\s*\(/.test(code), false,
    '存档层不得重算模拟（诊断只读 / 恢复不补算）');
});

test('SV-11 空介质 / 全损坏介质：明确失败提示，state 恒为 null（绝不半加载）', () => {
  const config = baseConfig();
  const empty = createSaveService(createInMemorySaveStorage(), config).load(config);
  assert.equal(empty.ok, false);
  assert.equal(empty.state, null);
  assert.equal(empty.notice.code, 'NO_VALID_SLOT');
  assert.ok(empty.notice.message.length > 0, '须给出可展示提示');
  assert.deepEqual(empty.validSlots, []);
  assert.deepEqual(empty.damagedSlots, []);
});

test('SV-12 saveTime / header 字段类型守卫：非法头部一律拒绝（防伪造头）', () => {
  const config = baseConfig();
  const state = makeRichState(config, 5);
  const storage = createInMemorySaveStorage();
  createSaveService(storage, config).save({ state });
  const base = parseSaveSlot(storage.raw('A'));
  assert.ok(base !== null);
  const mk = (mut: (s: SaveSlot) => SaveSlot): string => JSON.stringify(mut(base));
  const cases: [string, string][] = [
    ['缺 checksum', mk((s) => ({ ...s, header: { ...s.header, checksum: '' }, checksum: '' }))],
    ['header/current 版本不一致', mk((s) => ({ ...s, header: { ...s.header, schemaVersion: 'FORGED' } }))],
    ['seed 与 prngSeed 不一致', mk((s) => ({ ...s, prngSeed: s.prngSeed + 1 }))],
    ['writeSeq 非正整数', mk((s) => ({ ...s, writeSeq: 0 }))],
    ['saveTime 非字符串', mk((s) => ({ ...s, header: { ...s.header, saveTime: 123 as unknown as string } }))],
  ];
  for (const [label, bytes] of cases) {
    assert.equal(parseSaveSlot(bytes), null, label + ' 应被拒绝');
  }
  assert.equal(createSaveService(storage, config).load(config).ok, true, '原槽未被用例污染');
});
