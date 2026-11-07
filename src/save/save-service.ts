/**
 * HC-01 · SaveService（S-10 / T-140 · W4 第一批 E 线）
 *
 * 权威口径：ADR-003 §2 / §8、`architecture.md` §5.1~5.4、`epic-breakdown.md` S-10。
 *
 * 【介质口径】结论一律限定为**内存模拟介质可验证**。真机持久化半侧（SM-W2-05）、
 * 应用沙箱 / KV 确切接口、HAP 权限模型（K-4）**未验证**，EX-03 顺延、准出阻塞。
 * 本层不碰文件路径 / 权限，全部经 `ISaveStorage`（ADR-001 平台隔离）。
 *
 * 【A/B 双槽交替原子写】保存时读取两槽、取 `writeSeq` 最大且**校验通过**的槽为「当前完好槽」，
 * 写**另一槽**；因此任一时刻至少一个完好槽。槽本身携带单调 `writeSeq`，
 * **不依赖任何持久化 active-slot 指针** —— 进程被杀 / 重进后新建 SaveService 仍可择优恢复。
 *
 * 【checksum 定位】防误改 / 防写坏（落盘一半、位翻转、人为改坏），
 * **不是反作弊、不是防篡改承诺、不做强加密**（ADR-003 §2.5 / §6 R-6）。
 *
 * 【无静默续算】版本 / 配置漂移：默认**零迁移器** → 拒绝载入 + 保留旧槽；
 * 只有显式注册的 `SaveMigration` 才能升级 schemaVersion。configHash / engineVersion 漂移
 * 一律硬拒绝（D-01），绝不「旧档 + 新公式」继续算。载入必经
 * `deserializeState(..., config)` → `assertConfigCompatible`（D-01 唯一入口，不得绕过）。
 *
 * 【OD-2 A / 墙上时钟】本层**不读取任何时钟**：`saveTime` 是调用方注入的展示标签
 * （缺省为基于 tickId 的确定性标签），只进 header、绝不进 `deserializeState`、
 * 绝不参与模拟计算；恢复就是原样反序列化，**不推进 tick、不补算漏掉的 tick**。
 *
 * 【H3】代码库零同步实现；`ISaveStorage.remote` 恒 undefined、feature flag 默认关。
 *
 * 零依赖：源码不 import `node:` / 引擎 / 平台模块。
 */

import {
  SCHEMA_VERSION,
  ENGINE_VERSION,
  ConfigMismatchError,
  canonicalize,
  hashString,
} from '../core/types.ts';
import { computeConfigHash, assertConfigCompatible, type Config } from '../core/config.ts';
import { deserializeState, serializeState, type SerializedState } from '../core/schema.ts';
import type { CityState } from '../core/types.ts';
import type { StoredSnapshot } from '../simulation/snapshot.ts';
import type {
  ISaveStorage,
  LoadResult,
  SaveHeader,
  SaveInput,
  SaveLedgerCycle,
  SaveMigration,
  SaveNotice,
  SaveResult,
  SaveService,
  SaveServiceOptions,
  SaveSlot,
  SaveSlotId,
} from './types.ts';
import { SAVE_SLOT_IDS } from './types.ts';

// ---------------------------------------------------------------------------
// checksum：确定性、覆盖除 checksum 字段外的全部槽内容
// ---------------------------------------------------------------------------

/**
 * 计算槽校验和。用 `canonicalize`（键排序 + TypedArray 展开）保证 JSON 往返、
 * 键顺序变化都不影响结果；checksum 字段本身不纳入（否则自指循环）。
 * 这是**防误改 / 防写坏**的轻量校验，不是加密摘要、不构成防篡改承诺。
 */
export function computeSaveChecksum(slot: SaveSlot): string {
  const payload = {
    header: {
      schemaVersion: slot.header.schemaVersion,
      configHash: slot.header.configHash,
      engineVersion: slot.header.engineVersion,
      seed: slot.header.seed,
      saveTime: slot.header.saveTime,
    },
    current: slot.current,
    ledger: slot.ledger,
    prngSeed: slot.prngSeed,
    writeSeq: slot.writeSeq,
  };
  // 先按 JSON 往返归一，使 checksum 定义在「实际落盘的字节」上，
  // 避免 NaN / -0 / undefined 在序列化前后产生不同的 canonicalize 结果。
  return hashString(canonicalize(JSON.parse(JSON.stringify(payload))));
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

/**
 * 严格结构校验 + checksum 双处比对。任何不完整 / 半损坏 / 被改坏的数据一律返回 null，
 * 由 `load()` 归入 damagedSlots —— **绝不加载半损坏数据**。
 */
export function parseSaveSlot(bytes: string): SaveSlot | null {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const h = raw.header;
  if (!isRecord(h)) return null;
  if (typeof h.schemaVersion !== 'string' || typeof h.configHash !== 'string'
    || typeof h.engineVersion !== 'string' || typeof h.checksum !== 'string'
    || !isFiniteInt(h.seed) || typeof h.saveTime !== 'string') return null;
  if (!isRecord(raw.current) || !Array.isArray(raw.ledger)
    || !isFiniteInt(raw.prngSeed) || !isFiniteInt(raw.writeSeq)
    || typeof raw.checksum !== 'string' || raw.writeSeq < 1) return null;

  const slot: SaveSlot = {
    header: {
      schemaVersion: h.schemaVersion,
      configHash: h.configHash,
      engineVersion: h.engineVersion,
      seed: h.seed,
      checksum: h.checksum,
      saveTime: h.saveTime,
    },
    current: raw.current as unknown as SerializedState,
    ledger: raw.ledger as unknown as readonly SaveLedgerCycle[],
    prngSeed: raw.prngSeed,
    checksum: raw.checksum,
    writeSeq: raw.writeSeq,
  };

  // header 与 payload 一致性：防止「伪造新版本头 + 旧数据体」的静默续算。
  const c = slot.current as unknown as Record<string, unknown>;
  if (c.schemaVersion !== slot.header.schemaVersion
    || c.configHash !== slot.header.configHash
    || c.engineVersion !== slot.header.engineVersion
    || c.seed !== slot.prngSeed
    || slot.header.seed !== slot.prngSeed) return null;

  const expected = computeSaveChecksum(slot);
  if (slot.header.checksum !== expected || slot.checksum !== expected) return null;
  return slot;
}

export function encodeSaveSlot(slot: SaveSlot): string {
  return JSON.stringify(slot);
}

// ---------------------------------------------------------------------------
// 冷归档 ledger（≥3 周期）
// ---------------------------------------------------------------------------

/**
 * 把 S-05 的 `StoredSnapshot[]` 按 cycleId 分组成冷归档周期，保留最近 ≥3 周期。
 * **不编造缺失周期**：实际周期不足 minCycles 时如实保留已有周期（新局未满 3 周期属正常）。
 * 只读、不重算模拟；供诊断 / 回退（S-11）使用。
 */
export function buildSaveLedger(
  snapshots: readonly StoredSnapshot[],
  minCycles: number = 3,
): readonly SaveLedgerCycle[] {
  const byCycle = new Map<number, StoredSnapshot[]>();
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    const list = byCycle.get(s.cycleId);
    if (list) list.push(s);
    else byCycle.set(s.cycleId, [s]);
  }
  const ids = Array.from(byCycle.keys()).sort((a, b) => a - b);
  const keepFrom = Math.max(0, ids.length - Math.max(1, minCycles));
  const out: SaveLedgerCycle[] = [];
  for (let i = keepFrom; i < ids.length; i++) {
    out.push(Object.freeze({
      cycleId: ids[i],
      snapshots: Object.freeze((byCycle.get(ids[i]) ?? []).slice()),
    }));
  }
  return Object.freeze(out);
}

// ---------------------------------------------------------------------------
// 读两槽：通过校验的候选 + 损坏槽清单
// ---------------------------------------------------------------------------

interface SlotCandidate {
  readonly id: SaveSlotId;
  readonly slot: SaveSlot;
}

function readSlots(storage: ISaveStorage): { candidates: SlotCandidate[]; damaged: SaveSlotId[] } {
  const candidates: SlotCandidate[] = [];
  const damaged: SaveSlotId[] = [];
  for (const id of SAVE_SLOT_IDS) {
    let bytes: string | null;
    try {
      bytes = storage.read(id);
    } catch {
      damaged.push(id);
      continue;
    }
    if (bytes === null) continue; // 空槽不算损坏
    const slot = parseSaveSlot(bytes);
    if (slot === null) {
      damaged.push(id);
      continue;
    }
    candidates.push({ id, slot });
  }
  // 按 writeSeq 降序；同序号按槽 id 字典序，保证确定性。
  candidates.sort((a, b) => b.slot.writeSeq - a.slot.writeSeq
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { candidates, damaged };
}

function notice(code: SaveNotice['code'], message: string, slots?: readonly SaveSlotId[]): SaveNotice {
  return slots === undefined ? { code, message } : { code, message, slots };
}

function emptyLoad(validSlots: readonly SaveSlotId[], damagedSlots: readonly SaveSlotId[], n: SaveNotice): LoadResult {
  return {
    ok: false,
    state: null,
    slotId: null,
    header: null,
    ledger: [],
    prngSeed: null,
    notice: n,
    validSlots,
    damagedSlots,
  };
}

// ---------------------------------------------------------------------------
// 版本检查 + 显式迁移 + D-01 载入
// ---------------------------------------------------------------------------

/** 迁移后重算 checksum，保持内存槽自洽；迁移结果**不写回介质**（保留旧槽）。 */
function withChecksum(slot: SaveSlot): SaveSlot {
  const sum = computeSaveChecksum(slot);
  return {
    ...slot,
    header: { ...slot.header, checksum: sum },
    checksum: sum,
  };
}

function applyMigrations(
  slot: SaveSlot,
  config: Config,
  migrations: readonly SaveMigration[],
): SaveSlot | null {
  let cur = slot;
  const seen = new Set<string>();
  // 上限 = 迁移器数量 + 1，防环；超界即视为无可用迁移器。
  for (let guard = 0; guard <= migrations.length; guard++) {
    if (cur.header.schemaVersion === SCHEMA_VERSION) return cur;
    if (seen.has(cur.header.schemaVersion)) return null;
    seen.add(cur.header.schemaVersion);
    const m = migrations.find((x) => x.fromSchemaVersion === cur.header.schemaVersion);
    if (m === undefined) return null;
    const next = m.migrate(cur, config);
    if (next.header.schemaVersion !== m.toSchemaVersion) return null; // 迁移器不得谎报目标版本
    cur = withChecksum(next);
  }
  return null;
}

interface SlotOutcome {
  readonly ok: boolean;
  readonly state: CityState | null;
  readonly header: SaveHeader | null;
  readonly ledger: readonly SaveLedgerCycle[];
  readonly prngSeed: number | null;
  readonly n: SaveNotice;
}

/**
 * 对单个候选槽做版本判定 → 显式迁移 → D-01 载入。
 * 任何一步失败都返回 ok=false（绝不返回半状态），并给出可展示的提示。
 */
function tryLoadSlot(
  slot: SaveSlot,
  config: Config,
  migrations: readonly SaveMigration[],
): SlotOutcome {
  const expectedHash = computeConfigHash(config);
  const fail = (n: SaveNotice): SlotOutcome => ({
    ok: false, state: null, header: null, ledger: [], prngSeed: null, n,
  });

  // 配置 / 引擎版本漂移：D-01 硬拒绝，无迁移路径（禁止静默用新公式续算旧档）。
  if (slot.header.configHash !== expectedHash) {
    return fail(notice('CONFIG_MISMATCH_REJECTED',
      '存档 configHash 与当前配置不匹配，已拒绝载入并保留旧存档（需显式配置迁移，禁止静默续算）'));
  }
  if (slot.header.engineVersion !== ENGINE_VERSION) {
    return fail(notice('VERSION_MISMATCH_NO_MIGRATOR',
      '存档 engineVersion 与当前引擎版本不匹配，无可用迁移器，已拒绝载入并保留旧存档'));
  }

  let effective = slot;
  let migrated = false;
  if (slot.header.schemaVersion !== SCHEMA_VERSION) {
    const m = applyMigrations(slot, config, migrations);
    if (m === null) {
      return fail(notice('VERSION_MISMATCH_NO_MIGRATOR',
        `存档 schemaVersion=${slot.header.schemaVersion} 与当前 ${SCHEMA_VERSION} 不匹配，`
        + '无显式迁移器，已拒绝载入并保留旧存档（禁止静默续算）'));
    }
    effective = m;
    migrated = true;
  }

  // D-01 唯一载入入口：deserializeState 内部强制 assertConfigCompatible，不得绕过。
  let state: CityState;
  try {
    state = deserializeState(effective.current, config);
  } catch (e) {
    if (e instanceof ConfigMismatchError) {
      return fail(notice('CONFIG_MISMATCH_REJECTED',
        '载入时 config/schema 兼容性断言失败（D-01），已拒绝载入并保留旧存档'));
    }
    return fail(notice('DESERIALIZE_REJECTED',
      '存档状态反序列化失败（数据不完整），已拒绝载入并保留旧存档'));
  }

  const n = migrated
    ? notice('MIGRATED', `存档已通过显式迁移器升级至 ${SCHEMA_VERSION}（迁移结果未写回，旧槽保留）`)
    : notice('NONE', '存档完好，已恢复到最近 tick');
  return {
    ok: true,
    state,
    header: effective.header,
    ledger: effective.ledger,
    prngSeed: effective.prngSeed,
    n,
  };
}

// ---------------------------------------------------------------------------
// SaveService 工厂
// ---------------------------------------------------------------------------

export function createSaveService(
  storage: ISaveStorage,
  config: Config,
  options: SaveServiceOptions = {},
): SaveService {
  const migrations: readonly SaveMigration[] = Object.freeze([...(options.migrations ?? [])]);

  function save(input: SaveInput): SaveResult {
    // 写入侧 D-01：拒绝保存与当前 config 不兼容的状态，避免把「旧状态 + 新配置」写进存档。
    try {
      assertConfigCompatible(input.state, config);
    } catch {
      return {
        ok: false,
        slotId: null,
        checksum: '',
        writeSeq: 0,
        notice: notice('SAVE_REJECTED_INCOMPATIBLE_STATE',
          '待保存状态与当前配置不兼容（D-01），已拒绝写入，未改动任何存档槽'),
      };
    }

    const { candidates } = readSlots(storage);
    const newest = candidates.length > 0 ? candidates[0] : null;
    const target: SaveSlotId = newest === null ? 'A' : (newest.id === 'A' ? 'B' : 'A');
    const writeSeq = (newest === null ? 0 : newest.slot.writeSeq) + 1;

    const current = serializeState(input.state);
    const header: SaveHeader = {
      schemaVersion: SCHEMA_VERSION,
      configHash: computeConfigHash(config),
      engineVersion: ENGINE_VERSION,
      seed: input.state.seed,
      checksum: '', // 占位，随槽重算
      // 仅展示：调用方注入的展示标签；缺省为基于 tickId 的确定性标签，绝不读时钟。
      saveTime: input.displayTime ?? `tick:${input.state.tickId}`,
    };
    const draft: SaveSlot = {
      header,
      current,
      ledger: input.ledger ?? [],
      prngSeed: input.state.seed,
      checksum: '',
      writeSeq,
    };
    const sum = computeSaveChecksum(draft);
    const slot: SaveSlot = {
      ...draft,
      header: { ...header, checksum: sum },
      checksum: sum,
    };

    try {
      storage.write(target, encodeSaveSlot(slot));
    } catch {
      // 写中断 / IO 失败：目标槽可能是半损坏状态，但**上一完好槽未动**。
      // 返回失败提示，由 UI 提示用户；下次 load 会自动跳过损坏槽。
      return {
        ok: false,
        slotId: target,
        checksum: sum,
        writeSeq,
        notice: notice('WRITE_INTERRUPTED',
          '存档写入中断，已保留上一完好槽（未提交本次写入）'),
      };
    }
    return {
      ok: true,
      slotId: target,
      checksum: sum,
      writeSeq,
      notice: notice('NONE', `已写入槽 ${target}（writeSeq=${writeSeq}），另一槽保持完好`),
    };
  }

  function load(loadConfig: Config): LoadResult {
    const { candidates, damaged } = readSlots(storage);
    const validSlots = Object.freeze(candidates.map((c) => c.id));
    const damagedSlots = Object.freeze(damaged.slice());
    if (candidates.length === 0) {
      return emptyLoad(validSlots, damagedSlots, notice('NO_VALID_SLOT',
        '未找到可载入的完好存档槽' + (damaged.length > 0 ? '（检测到损坏存档，已全部跳过）' : '（尚无存档）'),
        damagedSlots));
    }

    // 按 writeSeq 降序逐个尝试：新槽版本不匹配 / 损坏时，回退上一完好槽并提示。
    let lastFailure: SaveNotice = notice('NO_VALID_SLOT', '所有存档槽均无法载入');
    for (let i = 0; i < candidates.length; i++) {
      const outcome = tryLoadSlot(candidates[i].slot, loadConfig, migrations);
      if (!outcome.ok) {
        if (i === 0) lastFailure = outcome.n;
        continue;
      }
      const fellBack = damaged.length > 0 || i > 0;
      const n: SaveNotice = fellBack
        ? notice('FELL_BACK_TO_PREVIOUS_SLOT',
          `已回退至完好存档槽 ${candidates[i].id} 并恢复（跳过损坏 / 不兼容槽）`,
          damaged.length > 0 ? damagedSlots : validSlots.slice(0, i))
        : outcome.n;
      return {
        ok: true,
        state: outcome.state,
        slotId: candidates[i].id,
        header: outcome.header,
        ledger: outcome.ledger,
        prngSeed: outcome.prngSeed,
        notice: n,
        validSlots,
        damagedSlots,
      };
    }
    return emptyLoad(validSlots, damagedSlots, lastFailure);
  }

  return { storage, config, save, load };
}
