/**
 * HC-01 · 组合根（S-12 闭环集成 · 纯逻辑侧）
 *
 * 把三块此前各自独立、从未接线的能力组装成一条可玩闭环：
 * ① `createSimulation`（结算编排 / 可选归档 / 周期回退）
 * ② `InMemorySnapshotStore`（Keyframe + Delta 冷归档，`RollbackStore` 契约）
 * ③ `SaveService`（A/B 双槽原子写 / 断点续玩 / 显式迁移器）
 *
 * 【接线清单（S-12 待办，本模块首次落地）】
 * - **初始态归档为 tick 0**：`put()` 对归档首条强制 KEYFRAME，故周期 0 有了起始快照，
 *   补上 `findCycleStartKeyframe` 此前「周期 0 起点从未入档」的缺口（CYCLE_START_KEYFRAME_MISSING）。
 * - **P8 落盘**：每次成功结算（`TickCommitted` > 0）后，用**已含该帧快照**的归档生成
 *   `SaveLedger` 并写另一槽；恢复 = 原样反序列化，不推进 tick、不补算漏掉的 tick。
 * - **`onBackground` 强存**：以**注入式方法**暴露，由平台适配层在生命周期回调里调用；
 *   本模块不读平台 API、不读时钟、不自建后台任务。
 * - **回退 / 解锁后存**：`retryCycle()` 成功后立即补存（回退改变 state，必须落新槽）；
 *   `TARGET_MET` 解锁帧在 P8 落盘之外额外标记 `unlockSaved`（E7 互斥判据可观测）。
 *
 * 【硬约束】
 * - **不改 `config` / `config.unlockedSide`**：后者是 `computeConfigHash` 的输入，改它令所有
 *   存档 `ConfigMismatchError`（D-01）。解锁只由 P7 写 `cells.unlocked`，本模块零触碰。
 * - **不读墙上时钟**：`displayTime` 是调用方注入的展示标签；缺省不传，由 SaveService
 *   使用基于 tickId 的确定性标签。
 * - **介质口径（EX-03 / K-4）**：全部结论限定为**内存模拟介质可验证**。真机应用沙箱 /
 *   KV 偏好 / HAP 权限模型 / 杀进程与切后台的真实持久化**未验证**，仍为准出阻塞项。
 *   `onBackground()` 只是可被平台层调用的方法，**不代表真机生命周期已验证**。
 * - 零依赖：源码不 import `node:` / 引擎 / 平台模块；不 import UI 层。
 */

import type { CityState, Command, CycleOutcome, SimEvent, StageId, StageView } from './core/types.ts';
import type { Config } from './core/config.ts';
import { createSimulation, type AdvanceResult, type Simulation } from './simulation/session.ts';
import {
  buildTickSnapshot,
  createInMemorySnapshotStore,
  type InMemorySnapshotStore,
  type StoredSnapshot,
} from './simulation/snapshot.ts';
import type { RetryCycleResult } from './simulation/rollback.ts';
import type {
  ISaveStorage,
  LoadResult,
  SaveMigration,
  SaveResult,
  SaveService,
} from './save/types.ts';
import { createInMemorySaveStorage } from './save/storage.ts';
import { buildSaveLedger, createSaveService } from './save/save-service.ts';

export interface CompositionOptions {
  /** 存档介质；缺省新建内存模拟介质（真机适配层可注入真实现） */
  readonly storage?: ISaveStorage;
  /** 归档介质；缺省新建内存 Keyframe/Delta 归档 */
  readonly snapshotStore?: InMemorySnapshotStore;
  /** 是否把初始态归档为 tick 0 起点（缺省 true；关掉后周期 0 不可回退） */
  readonly archiveInitial?: boolean;
  /** `SaveLedger` 保留的冷归档周期数（缺省 3） */
  readonly ledgerCycles?: number;
  /** 仅展示的时间标签（调用方注入；本模块不读时钟） */
  readonly displayTime?: string;
  /** 显式迁移器链（交给 SaveService；无迁移器即拒绝载入，绝不静默续算） */
  readonly migrations?: readonly SaveMigration[];
  /** 阶段观察回调（透传给 `createSimulation`） */
  readonly onStage?: (stage: StageId, view: StageView) => void;
}

export interface CommitResult extends AdvanceResult {
  /** P8 落盘结果；无成功结算时 undefined */
  readonly save?: SaveResult;
  /** `TARGET_MET` 解锁帧的补存标记（与 P8 落盘为同一次写入，便于 E7 可观测） */
  readonly unlockSaved?: SaveResult;
}

export interface RetryAndSaveResult {
  readonly retry: RetryCycleResult;
  /** 回退后的补存；幂等重放（同一 result 对象）时为 undefined，避免重复推进 writeSeq */
  readonly save?: SaveResult;
}

export interface CompositionRoot {
  readonly config: Config;
  readonly saveService: SaveService;
  readonly storage: ISaveStorage;
  readonly snapshotStore: InMemorySnapshotStore;
  /** 初始态起点快照；`archiveInitial: false` 时为 null */
  readonly initialSnapshot: StoredSnapshot | null;
  readonly state: CityState;
  readonly tickId: number;
  readonly pendingCount: number;
  readonly committedCount: number;
  readonly lastCycleOutcome: CycleOutcome;
  /** 累计成功落盘次数（便于验收 P8 / 强存 / 回退补存） */
  readonly saveCount: number;
  submit(cmd: Command): void;
  advanceDay(key: string): CommitResult;
  renderFrames(frames: number): void;
  retryCycle(targetCycleId?: number): RetryAndSaveResult;
  /** 平台适配层在 `onBackground` 生命周期回调里调用；注入式，不读平台 API */
  onBackground(): SaveResult;
  /** 显式立即落盘（组合根内部各触发点共用） */
  saveNow(): SaveResult;
  load(): LoadResult;
}

/**
 * 组装一条「结算 → 归档 → 落盘 → 回退/续玩」闭环。
 *
 * 缺省全为内存模拟介质；`createSimulation` 的 `advanceDay` / `submit` / `renderFrames`
 * 行为**一字未改**（本模块只包装调用点），未提供介质时的旧行为也由 session 自身保证。
 */
export function createCompositionRoot(
  config: Config,
  state: CityState,
  options: CompositionOptions = {},
): CompositionRoot {
  const storage = options.storage ?? createInMemorySaveStorage();
  const snapshotStore = options.snapshotStore ?? createInMemorySnapshotStore();
  const ledgerCycles = options.ledgerCycles ?? 3;
  const archiveInitial = options.archiveInitial !== false;
  const saveService = createSaveService(storage, config, { migrations: options.migrations });
  const sim: Simulation = createSimulation(config, state, {
    onStage: options.onStage,
    snapshotStore,
  });

  // ① 初始态归档（tick 0）：首条必为 KEYFRAME，作为周期 0 的回退起点。
  //    delta / attribution / commandTrace 为空——初始态没有结算事件，不编造。
  let initialSnapshot: StoredSnapshot | null = null;
  if (archiveInitial) {
    snapshotStore.put(buildTickSnapshot({
      state: sim.state,
      tickId: sim.state.tickId,
      delta: [],
      attribution: [],
      commandTrace: [],
    }));
    initialSnapshot = snapshotStore.entries()[0] ?? null;
  }

  let saveCount = 0;
  // 幂等重放判定：session 的 retryCycle 再次调用会返回**同一个缓存 result 对象**。
  let lastRetryResult: RetryCycleResult | null = null;

  function saveNow(): SaveResult {
    const result = saveService.save({
      state: sim.state,
      ledger: buildSaveLedger(snapshotStore.entries(), ledgerCycles),
      displayTime: options.displayTime,
    });
    if (result.ok) saveCount++;
    return result;
  }

  const root: CompositionRoot = {
    config,
    saveService,
    storage,
    snapshotStore,
    get initialSnapshot(): StoredSnapshot | null {
      return initialSnapshot;
    },
    get state(): CityState {
      return sim.state;
    },
    get tickId(): number {
      return sim.tickId;
    },
    get pendingCount(): number {
      return sim.pendingCount;
    },
    get committedCount(): number {
      return sim.committedCount;
    },
    get lastCycleOutcome(): CycleOutcome {
      return sim.lastCycleOutcome;
    },
    get saveCount(): number {
      return saveCount;
    },
    submit(cmd: Command): void {
      sim.submit(cmd);
    },
    advanceDay(key: string): CommitResult {
      const r = sim.advanceDay(key);
      if (!r.accepted || r.result === undefined) return r;
      // 与 session 的归档条件一致：只有真正提交了 tick 才落盘（避免空转写槽）。
      let committed = 0;
      for (const e of r.events) if (e.type === 'TickCommitted') committed++;
      if (committed === 0) return r;
      // session 内部此时已 put 本帧快照 → ledger 天然含最新一帧（P8 之后的状态）。
      const saved = saveNow();
      // 解锁帧：P7 写 cells.unlocked 后、P8 落盘的同一次写入即为「解锁后存」，
      // 单独标记便于 E7 互斥判据 / 验收观测，不额外写第二个槽。
      const unlockSaved = sim.lastCycleOutcome === 'TARGET_MET' ? saved : undefined;
      return { ...r, save: saved, unlockSaved };
    },
    renderFrames(frames: number): void {
      sim.renderFrames(frames);
    },
    retryCycle(targetCycleId?: number): RetryAndSaveResult {
      const retry = sim.retryCycle(targetCycleId);
      // session 内部已 put 新分支 KEYFRAME；此处补存当前头部。
      // 幂等重放返回同一对象 → 不重复写槽（writeSeq 不空转）。
      if (lastRetryResult !== null && Object.is(retry, lastRetryResult)) {
        return { retry };
      }
      lastRetryResult = retry;
      return { retry, save: saveNow() };
    },
    onBackground(): SaveResult {
      // 切后台只「冻结 + 存一次」，不推进 tick、不补算、不读时钟。
      return saveNow();
    },
    saveNow,
    load(): LoadResult {
      return saveService.load(config);
    },
  };
  return root;
}
