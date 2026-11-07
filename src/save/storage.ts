/**
 * HC-01 · 存档介质：内存模拟实现（S-10 / T-140）
 *
 * ⚠️ **介质口径**：这是**内存模拟介质**，不是 HarmonyOS 应用沙箱 / KV 偏好。
 * 真机持久化半侧（SM-W2-05）、应用沙箱 / KV 确切接口、HAP 包体上限与权限模型（K-4）
 * **未在本机验证**，已按用户 2026-11-07 拍板顺延并登记为**准出阻塞项**
 * （`tests/quality-closure.md` EX-03）。本实现只证明存档逻辑在内存介质上可验证，
 * 不得据此声称「断点续玩已在真机达成」。
 *
 * 真机侧接入方式：实现同一个 `ISaveStorage`（`read` / `write`），把「临时文件 → fsync →
 * rename」的原子语义放在介质实现里；`SaveService` 本身不碰路径与权限，无需改动。
 * 本内存实现以「整串一次赋值」模拟原子提交，以「半串落盘 + 抛错」模拟写中断。
 *
 * 零依赖：不 import `node:` / 引擎 / 平台模块；不读时钟、不产生随机数。
 */

import type {
  InMemorySaveStorage,
  SaveSlotId,
  SaveStorageFaults,
} from './types.ts';
import { SAVE_SLOT_IDS } from './types.ts';

/** 一次性故障开关复位（触发后自动归零，避免污染后续用例） */
function resetFaults(f: SaveStorageFaults): void {
  f.interruptNextWrite = false;
  f.failNextWrite = false;
  f.failNextRead = false;
  f.corruptOnRead = null;
}

function corruptBytes(bytes: string): string {
  // 人为损坏：截断并追加损坏标记，必然导致 JSON 解析失败或 checksum 不符。
  // 确定性（无随机），便于故障注入用例逐字节复现。
  return bytes.slice(0, Math.max(0, Math.floor(bytes.length / 2))) + '\u0000CORRUPTED';
}

/**
 * 内存模拟介质工厂。
 * - 两个槽 A / B 各自保存一份序列化字节串；读写都是纯内存操作。
 * - `faults` 是**可写**的一次性故障开关，供 F 线 / QA 的写中断、损坏、读失败用例注入。
 * - `corruptSlot()` 直接改写已落盘字节，模拟「人为损坏存档」。
 * - `remote` 恒为 undefined：H3 远端 / 版本向量能力位**仅预留签名，零同步实现**。
 */
export function createInMemorySaveStorage(): InMemorySaveStorage {
  const slots: Record<SaveSlotId, string | null> = { A: null, B: null };
  const faults: SaveStorageFaults = {
    interruptNextWrite: false,
    failNextWrite: false,
    failNextRead: false,
    corruptOnRead: null,
  };
  let writeCount = 0;

  const storage: InMemorySaveStorage = {
    remote: undefined,
    faults,
    get writeCount(): number {
      return writeCount;
    },
    read(slot: SaveSlotId): string | null {
      if (faults.failNextRead) {
        faults.failNextRead = false;
        throw new Error('in-memory save storage: simulated read failure');
      }
      const bytes = slots[slot];
      if (bytes === null) return null;
      if (faults.corruptOnRead === slot) {
        faults.corruptOnRead = null;
        return corruptBytes(bytes);
      }
      return bytes;
    },
    write(slot: SaveSlotId, bytes: string): void {
      writeCount++;
      if (faults.interruptNextWrite) {
        // 模拟「落盘一半被杀」：目标槽留下半损坏数据，然后抛错。
        // 上一完好槽不受影响 —— A/B 交替写保证任一时刻至少一个完好槽。
        faults.interruptNextWrite = false;
        slots[slot] = corruptBytes(bytes);
        throw new Error('in-memory save storage: simulated interrupted write');
      }
      if (faults.failNextWrite) {
        // 模拟 IO 失败：目标槽内容完全不变（连半损坏都不留）。
        faults.failNextWrite = false;
        throw new Error('in-memory save storage: simulated write failure');
      }
      // 原子提交：整串一次赋值（内存介质等价于 fsync + rename 的不可分割提交）。
      slots[slot] = bytes;
    },
    corruptSlot(slot: SaveSlotId, mutator?: (bytes: string) => string): void {
      const bytes = slots[slot];
      if (bytes === null) return;
      slots[slot] = mutator ? mutator(bytes) : corruptBytes(bytes);
    },
    raw(slot: SaveSlotId): string | null {
      return slots[slot];
    },
    clear(): void {
      for (const id of SAVE_SLOT_IDS) slots[id] = null;
      resetFaults(faults);
    },
  };
  return storage;
}
