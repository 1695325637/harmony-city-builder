/**
 * HC-01 纯逻辑层 · 快照 / 差分 / 归因链
 *
 * 本轮范围（T-112）：S-05「完整快照 / 归因存储」不实现持久化，仅类型契约 + 空实现。
 * T-116（W1 出口门缺口修复）：新增【最小内存实现】——
 *   `buildTickSnapshot` + `createInMemorySnapshotStore`（Keyframe + Delta + 冷归档 ≥3 周期）。
 *   ⚠️ 存储介质为**内存模拟**，非真机持久化；真机验证随 SM-W1-04（S-01）顺延。
 *   归档持久化、冷归档保留策略（淘汰/压缩）、查询只读语义仍留 S-05 / S-09。
 *
 * Keyframe 规则（architecture §4 Keyframe+Delta 策略的最小子集）：
 *   - 归档首条快照（保证任意 tick 均可恢复）；
 *   - `cycleTickIndex === 0`（周期首，P7 周期末结算后复位为 0）；
 *   - 相邻两条快照 `cycleId` 推进（周期末帧）。
 *   KEYFRAME 保留全量自包含序列化状态（frames 非 null）；DELTA 只留差分
 *   条目（delta / attribution / commandTrace），frames 置 null。
 *   恢复 = 取「目标 tick 之前（含）最近的 KEYFRAME」反序列化，不做逆运算。
 */

import type { CityState, StageId } from '../core/types.ts';
import type { Config } from '../core/config.ts';
import { deserializeState, serializeState, type SerializedState } from '../core/schema.ts';

export interface DeltaEntry {
  key: string;
  old: number;
  new: number;
  delta: number;
  direction: 'UP' | 'DOWN' | 'FLAT';
  magnitude: number;
}

export interface AttributionEntry {
  /** 主因因子 ∈ {f_c, f_s, f_e, f_f} */
  primary_factor: string;
  /** 该因子贡献（分/tick） */
  dS_i: number;
  causeType: '通勤线' | '覆盖片区' | '预算项' | '环境源' | '教学';
  /** 指向具体对象：路段 id / 片区 id / 账目 id / 产业格坐标 */
  refId: string;
  contribution: number;
  detail: string;
  suggested_verb: string;
}

export interface TickSnapshot {
  tickId: number;
  cycleId: number;
  cycleTickIndex: number;
  schemaVersion: string;
  configHash: string;
  engineVersion: string;
  seed: number;
  /** t-1 / t 双帧（GDD 01 §3.2 / architecture §4.1） */
  frames: unknown;
  delta: readonly DeltaEntry[];
  attribution: readonly AttributionEntry[];
  /** 本 tick 应用的命令溯源（含幂等键） */
  commandTrace: readonly string[];
  stage: StageId;
  // pending:S-05 —— flowState（流线三态枚举，GDD 03 §3.5）暂不在快照结构中承载：
  // 它是纯视觉派生量，渲染层随图例条目下发即可，无需进冷归档；待 S-05 / S-09 视存储需求再定。
}

/**
 * 结算时记录、查询时只读，绝不重算模拟（S-05 完整版待接持久化）。
 * tick-pipeline 已通过 `TickOptions.recorder` 注入点在 P8 逐条回放归因条目。
 */
export interface AttributionRecorder {
  record(entry: AttributionEntry): void;
  readonly count: number;
}

/**
 * Keyframe / Delta / 冷归档存储契约。
 * T-116 提供 `createInMemorySnapshotStore` 最小内存实现（见文件头披露）。
 */
export interface SnapshotStore {
  put(snapshot: TickSnapshot): void;
  get(tickId: number): TickSnapshot | null;
  getCycleRange(fromCycleId: number, toCycleId: number): readonly TickSnapshot[];
}

export const NOOP_ATTRIBUTION_RECORDER: AttributionRecorder = {
  record(_entry: AttributionEntry): void {
    // 占位：本轮不落盘
  },
  get count(): number {
    return 0;
  },
};

export function createDeltaEntry(): DeltaEntry {
  return { key: '', old: 0, new: 0, delta: 0, direction: 'FLAT', magnitude: 0 };
}

export function createAttributionEntry(): AttributionEntry {
  return {
    primary_factor: '',
    dS_i: 0,
    causeType: '教学',
    refId: '',
    contribution: 0,
    detail: '',
    suggested_verb: '',
  };
}

// ---------------------------------------------------------------------------
// T-116 · 最小内存实现（Keyframe + Delta + 冷归档）
// ---------------------------------------------------------------------------

/** 归档中实际存储的条目：KEYFRAME 自包含全量状态；DELTA 只留差分 */
export type SnapshotKind = 'KEYFRAME' | 'DELTA';

export interface StoredSnapshot extends TickSnapshot {
  kind: SnapshotKind;
  /** KEYFRAME：自包含全量 `SerializedState`；DELTA：null */
  frames: SerializedState | null;
}

/** 冷归档恢复结果 + 溯源信息（恢复自哪个 Keyframe、需重放几步） */
export interface RestoreResult {
  state: CityState;
  keyframeTickId: number;
  requestedTickId: number;
  /** requested − keyframe：从 Keyframe 起需前向重放的 tick 数 */
  replayFrom: number;
}

/**
 * 从 TickResult 提取自包含快照（存储层入口，非模拟热路径，允许分配）。
 * 深拷贝 delta / attribution / commandTrace，隔离 TickWorkspace 复用池。
 */
export function buildTickSnapshot(result: {
  state: CityState;
  tickId: number;
  delta: readonly DeltaEntry[];
  attribution: readonly AttributionEntry[];
  commandTrace: readonly string[];
}): TickSnapshot {
  const s = result.state;
  return {
    tickId: result.tickId,
    cycleId: s.cycleId,
    cycleTickIndex: s.cycleTickIndex,
    schemaVersion: s.schemaVersion,
    configHash: s.configHash,
    engineVersion: s.engineVersion,
    seed: s.seed,
    frames: serializeState(s),
    delta: result.delta.map((d): DeltaEntry => ({ ...d })),
    attribution: result.attribution.map((a): AttributionEntry => ({ ...a })),
    commandTrace: [...result.commandTrace],
    stage: 'P8',
  };
}

function clonePlain(w: SerializedState): SerializedState {
  return JSON.parse(JSON.stringify(w)) as SerializedState;
}

export interface InMemorySnapshotStore extends SnapshotStore {
  readonly size: number;
  readonly keyframeCount: number;
  readonly deltaCount: number;
  /** 归档全部条目（按 tick 插入序，只读视图） */
  entries(): readonly StoredSnapshot[];
  /**
   * 冷归档恢复：取目标 tick（含）之前最近的 KEYFRAME 反序列化。
   * 无逆运算；DELTA 不参与恢复。config 不匹配抛 ConfigMismatchError（D-01 联动）。
   */
  restore(tickId: number, config: Config): RestoreResult;
}

/**
 * 内存模拟介质的 Keyframe + Delta 冷归档存储（T-116 / S-05 最小落地）。
 * - 零依赖、确定性：条目按 tick 插入序存储，查询按插入序返回，无遍历顺序依赖；
 * - 本实现不做淘汰 / 压缩（保留策略留 S-05 / S-09）；
 * - put() 对 delta / attribution / commandTrace / frames 再深拷贝一次，
 *   隔离调用方对象（含 TickWorkspace 复用池）。
 */
export function createInMemorySnapshotStore(): InMemorySnapshotStore {
  const entries: StoredSnapshot[] = [];
  const indexByTickId = new Map<number, number>();
  let keyframeCount = 0;

  function isKeyframe(snapshot: TickSnapshot): boolean {
    if (entries.length === 0) return true; // 归档首条：保证可恢复
    const prev = entries[entries.length - 1];
    if (snapshot.cycleTickIndex === 0) return true; // 周期首（P7 复位）
    if (snapshot.cycleId !== prev.cycleId) return true; // 周期末帧
    return false;
  }

  return {
    get size(): number {
      return entries.length;
    },
    get keyframeCount(): number {
      return keyframeCount;
    },
    get deltaCount(): number {
      return entries.length - keyframeCount;
    },
    entries(): readonly StoredSnapshot[] {
      return entries.slice();
    },
    put(snapshot: TickSnapshot): void {
      const framesPlain = snapshot.frames == null ? null : clonePlain(snapshot.frames as SerializedState);
      const kind: SnapshotKind = isKeyframe(snapshot) && framesPlain !== null ? 'KEYFRAME' : 'DELTA';
      const stored: StoredSnapshot = {
        tickId: snapshot.tickId,
        cycleId: snapshot.cycleId,
        cycleTickIndex: snapshot.cycleTickIndex,
        schemaVersion: snapshot.schemaVersion,
        configHash: snapshot.configHash,
        engineVersion: snapshot.engineVersion,
        seed: snapshot.seed,
        kind,
        frames: kind === 'KEYFRAME' ? framesPlain : null,
        delta: snapshot.delta.map((d): DeltaEntry => ({ ...d })),
        attribution: snapshot.attribution.map((a): AttributionEntry => ({ ...a })),
        commandTrace: [...snapshot.commandTrace],
        stage: snapshot.stage,
      };
      if (indexByTickId.has(stored.tickId)) {
        throw new Error('snapshot tickId already stored: ' + stored.tickId + '（按 tick 单调写入，禁止覆盖）');
      }
      indexByTickId.set(stored.tickId, entries.length);
      entries.push(stored);
      if (kind === 'KEYFRAME') keyframeCount++;
    },
    get(tickId: number): TickSnapshot | null {
      const i = indexByTickId.get(tickId);
      return i === undefined ? null : entries[i];
    },
    getCycleRange(fromCycleId: number, toCycleId: number): readonly TickSnapshot[] {
      const out: StoredSnapshot[] = [];
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.cycleId >= fromCycleId && e.cycleId <= toCycleId) out.push(e);
      }
      return out;
    },
    restore(tickId: number, config: Config): RestoreResult {
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i];
        if (e.kind !== 'KEYFRAME' || e.frames === null) continue;
        if (e.tickId <= tickId) {
          // D-01 联动：载入即断言，旧快照 + 新 config 在此抛 ConfigMismatchError
          const state = deserializeState(e.frames, config);
          return { state, keyframeTickId: e.tickId, requestedTickId: tickId, replayFrom: e.tickId };
        }
      }
      throw new Error('no keyframe at or before tick ' + tickId + '（冷归档为空或仅含 DELTA）');
    },
  };
}
