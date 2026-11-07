/**
 * HC-01 · 存档层类型契约（S-10 / T-140 · W4 第一批 E 线）
 *
 * 权威口径：ADR-003 §2 / §8、`architecture.md` §5、`production/epics/epic-breakdown.md` S-10。
 *
 * 【介质口径 · 必须如实保留】本层是**内存模拟介质**的存档实现（与 S-05 冷归档同款先例）。
 * 真机 HarmonyOS 应用沙箱 / KV 偏好接口、HAP 权限模型、杀进程与切后台的真实持久化
 * **未在本机验证**（K-4 / EX-03 顺延，已正式登记为准出阻塞项）。所有「原子写 / 双槽 /
 * 断点续玩 / 迁移」结论均只限定为「内存模拟介质可验证」，不得声称已在真机达成。
 *
 * 【checksum 定位 · 必须如实保留】checksum 用于**防误改 / 防写坏**（落盘一半、位翻转、
 * 人为改坏），**不是反作弊、不是防篡改承诺、不做强加密**（ADR-003 §2.5 / §6 R-6）。
 * 单机、无 PvP、无对抗，存档可被用户手工修改；不得在文案中暗示防篡改。
 *
 * 【OD-2 A 红利】默认暂停 / 手动 tick，存档**不记录参与模拟计算的墙上时钟**、
 * 不申请后台保活 / 精确闹钟 / 离线任务；`saveTime` 仅作展示元数据，由调用方注入，
 * 本层绝不读取任何时钟、绝不据此推进或补算 tick。
 *
 * 【H3】`ISaveStorage` 只预留「远端读写 + 版本向量」能力位签名；本代码库**无任何同步实现**，
 * `SAVE_FEATURE_FLAGS.h3CrossDeviceSync` 默认关（ADR-003 §2.6 / S-10 验收 5）。
 *
 * 零依赖：不 import `node:` 模块、不 import 引擎 / 平台 API、不碰文件系统路径与权限。
 */

import type { CityState } from '../core/types.ts';
import type { Config } from '../core/config.ts';
import type { SerializedState } from '../core/schema.ts';
import type { StoredSnapshot } from '../simulation/snapshot.ts';

// ---------------------------------------------------------------------------
// 槽位与头部
// ---------------------------------------------------------------------------

/** A/B 双槽标识（交替写，任一时刻至少一个完好槽） */
export type SaveSlotId = 'A' | 'B';

export const SAVE_SLOT_IDS: readonly SaveSlotId[] = Object.freeze(['A', 'B']);

/**
 * 存档头：SM-W4-03 要求的五字段齐备 + `saveTime` 仅展示。
 * - `schemaVersion` / `configHash` / `engineVersion` / `seed` / `checksum` = 五字段
 *   （epic-breakdown S-10 验收 3）；
 * - `saveTime` = 仅展示元数据（ADR-003 §2.1），**不参与任何模拟计算**；
 * - `checksum` 同时也在 SaveSlot 顶层保留同值一份，以兼容 `architecture.md` §5.1
 *   与 ADR-003 §2.1 两处略有差异的结构描述（单一计算源，加载时两处逐一比对）。
 */
export interface SaveHeader {
  readonly schemaVersion: string;
  readonly configHash: string;
  readonly engineVersion: string;
  readonly seed: number;
  readonly checksum: string;
  /** 仅展示：调用方注入的展示标签（缺省为基于 tickId 的确定性标签）；本层绝不读时钟 */
  readonly saveTime: string;
}

/** 一个周期的冷归档条目：Keyframe 自包含 + 其后 Delta，只读、绝不重算模拟 */
export interface SaveLedgerCycle {
  readonly cycleId: number;
  readonly snapshots: readonly StoredSnapshot[];
}

/**
 * 存档槽（ADR-003 §2.1 / architecture §5.1）。
 * - `current` 取「直接最近全量快照」，覆盖五类字段（网格 / 预算 / 满意度 / 议题 / 解锁进度）；
 * - `ledger` 为最近 ≥3 周期冷归档，供诊断 / 回退（S-05），本层不查询重算；
 * - `prngSeed` 与 `header.seed` 同源；`writeSeq` 是 A/B 交替写序号（纯元数据）。
 */
export interface SaveSlot {
  readonly header: SaveHeader;
  readonly current: SerializedState;
  readonly ledger: readonly SaveLedgerCycle[];
  readonly prngSeed: number;
  /** 与 header.checksum 同源同值，加载时两处均须匹配 */
  readonly checksum: string;
  /** A/B 交替写序号，单调递增；纯元数据，不参与任何模拟计算 */
  readonly writeSeq: number;
}

// ---------------------------------------------------------------------------
// H3 预留能力位（只留签名，不实现同步）
// ---------------------------------------------------------------------------

/** 版本向量能力位（H3 冲突检测用；本轮不实现任何消解逻辑） */
export interface VersionVector {
  readonly [replicaId: string]: number;
}

/**
 * 远端读写 + 版本向量能力位。**只有接口签名，代码库零实现**：
 * 内存模拟介质的 `remote` 恒为 undefined；`SAVE_FEATURE_FLAGS.h3CrossDeviceSync` 默认 false。
 */
export interface RemoteSaveCapabilities {
  readRemote(key: string): Promise<{ bytes: string; version: VersionVector } | null>;
  writeRemote(key: string, bytes: string, version: VersionVector): Promise<void>;
  currentVersionVector(): VersionVector;
}

/** H3 feature flag：默认关，且本轮不提供任何开启路径 */
export const SAVE_FEATURE_FLAGS: Readonly<{ h3CrossDeviceSync: boolean }> = Object.freeze({
  h3CrossDeviceSync: false,
});

// ---------------------------------------------------------------------------
// ISaveStorage 抽象（业务层不碰路径与权限）
// ---------------------------------------------------------------------------

/**
 * 存储抽象：SaveService 只经此接口读写，不接触文件路径、权限、引擎 / 平台 API。
 * 真机侧实现（应用沙箱文件 / 系统 KV 偏好）待 K-4 真机核对后接入。
 *
 * - `read` / `write` 的载荷是**序列化字节串**（内存介质里就是字符串；真机侧可为字节数组，
 *   接口签名不变）。`read` 返回 null 表示槽为空；实现可抛错表示 IO 失败。
 * - `remote` 为 H3 预留能力位，默认 undefined（不实现同步）。
 * - 无「active slot 指针」：加载时读两个槽并按 `writeSeq` 择优，故进程重启后无需额外元数据，
 *   这也是 A/B 交替原子写在杀进程场景能成立的前提。
 */
export interface ISaveStorage {
  read(slot: SaveSlotId): string | null;
  write(slot: SaveSlotId, bytes: string): void;
  readonly remote?: RemoteSaveCapabilities;
}

/** 故障注入开关（内存介质专有；供 F 线 / QA 的写中断、损坏、读失败用例） */
export interface SaveStorageFaults {
  /** 下一次 write 落盘一半后中断：目标槽留下半损坏数据并抛错，上一完好槽不动 */
  interruptNextWrite: boolean;
  /** 下一次 write 直接抛错（IO 失败），目标槽内容不变 */
  failNextWrite: boolean;
  /** 下一次 read 直接抛错（读取失败） */
  failNextRead: boolean;
  /** read 指定槽时返回被人为改坏的内容（模拟位翻转 / 人为篡改） */
  corruptOnRead: SaveSlotId | null;
}

export interface InMemorySaveStorage extends ISaveStorage {
  /** 可写故障开关；各项默认关闭。开关为一次性（触发后自动复位），避免污染后续用例 */
  readonly faults: SaveStorageFaults;
  /** 直接改写槽原始字节（人为损坏，绕过 SaveService），mutator 缺省为截断 + 损坏标记 */
  corruptSlot(slot: SaveSlotId, mutator?: (bytes: string) => string): void;
  /** 只读诊断：查看槽原始字节 */
  raw(slot: SaveSlotId): string | null;
  /** 清空全部槽（模拟首次启动 / 杀进程后介质重建） */
  clear(): void;
  readonly writeCount: number;
  readonly remote: undefined;
}

// ---------------------------------------------------------------------------
// 提示 / 结果
// ---------------------------------------------------------------------------

export type SaveNoticeCode =
  | 'NONE'
  | 'WRITE_INTERRUPTED'
  | 'FELL_BACK_TO_PREVIOUS_SLOT'
  | 'NO_VALID_SLOT'
  | 'VERSION_MISMATCH_NO_MIGRATOR'
  | 'MIGRATED'
  | 'CONFIG_MISMATCH_REJECTED'
  | 'DESERIALIZE_REJECTED'
  | 'SAVE_REJECTED_INCOMPATIBLE_STATE';

/** 「回退上一完好槽并提示」的机器可读提示；UI 可直接取 message 展示 */
export interface SaveNotice {
  readonly code: SaveNoticeCode;
  readonly message: string;
  /** 被跳过的损坏槽 / 回退来源槽 */
  readonly slots?: readonly SaveSlotId[];
}

export interface SaveInput {
  readonly state: CityState;
  /** 冷归档（建议用 buildSaveLedger 生成）；缺省为空数组，本层不编造缺失周期 */
  readonly ledger?: readonly SaveLedgerCycle[];
  /** 仅展示元数据：调用方可注入格式化时间字符串；本层绝不读时钟、绝不用于模拟计算 */
  readonly displayTime?: string;
}

export interface SaveResult {
  readonly ok: boolean;
  readonly slotId: SaveSlotId | null;
  readonly checksum: string;
  readonly writeSeq: number;
  readonly notice: SaveNotice;
}

export interface LoadResult {
  readonly ok: boolean;
  /** 最近 tick 的完整状态；失败恒为 null —— **绝不加载半损坏数据** */
  readonly state: CityState | null;
  readonly slotId: SaveSlotId | null;
  readonly header: SaveHeader | null;
  readonly ledger: readonly SaveLedgerCycle[];
  readonly prngSeed: number | null;
  readonly notice: SaveNotice;
  /** 通过校验的槽（按 writeSeq 降序） */
  readonly validSlots: readonly SaveSlotId[];
  /** 被判定损坏 / 不完整而跳过的槽 */
  readonly damagedSlots: readonly SaveSlotId[];
}

// ---------------------------------------------------------------------------
// 显式迁移器
// ---------------------------------------------------------------------------

/**
 * 显式迁移器：**默认一个都不注册**。版本 / 配置漂移时若无对应迁移器，
 * SaveService 拒绝载入并保留旧槽，**禁止静默用新公式续算旧档**（ADR-003 §2.3 / §4.1）。
 * 迁移器必须显式改写 header 与 current 的版本字段；本层不提供任何「自动续算」路径。
 */
export interface SaveMigration {
  readonly id: string;
  readonly fromSchemaVersion: string;
  readonly toSchemaVersion: string;
  migrate(slot: SaveSlot, config: Config): SaveSlot;
}

export interface SaveServiceOptions {
  /** 显式迁移器链（缺省空）；无迁移器即拒绝，绝不猜测如何迁移 */
  readonly migrations?: readonly SaveMigration[];
}

// ---------------------------------------------------------------------------
// SaveService
// ---------------------------------------------------------------------------

/**
 * 存档服务。`config` 在构造时钉定（写入侧基准）；`load(config)` 显式接收载入侧 config，
 * 以便「同一份存档 + 新配置」的场景能被 D-01 的 `assertConfigCompatible` 拦截。
 */
export interface SaveService {
  readonly storage: ISaveStorage;
  readonly config: Config;
  save(input: SaveInput): SaveResult;
  load(config: Config): LoadResult;
}
