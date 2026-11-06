/**
 * HC-01 纯逻辑层 · 命令队列 / 输入闸门
 *
 * OD-2 A：默认暂停；暂停态编辑命令批量入队，仅 V6「结束本日」触发一次结算。
 * InputGate 在结算期间锁「推 / 改状态」，幂等键防连点（ADR-002 R-2 / S-03 验收 4）。
 * 首版无倍速、无自动播放、无倒计时条。
 */

import type { Command } from '../core/types.ts';

export const makeCommand = {
  zone(key: string, seq: number, x: number, y: number, zoneId: string, density: number): Command {
    return { kind: 'ZONE', idempotencyKey: key, seq, x, y, zoneId, density, amountCU: 0 };
  },
  density(key: string, seq: number, x: number, y: number, density: number): Command {
    return { kind: 'DENSITY', idempotencyKey: key, seq, x, y, zoneId: '', density, amountCU: 0 };
  },
  road(key: string, seq: number, x: number, y: number): Command {
    return { kind: 'ROAD', idempotencyKey: key, seq, x, y, zoneId: 'ROAD', density: 0, amountCU: 0 };
  },
  fund(key: string, seq: number, amountCU: number): Command {
    return { kind: 'FUND', idempotencyKey: key, seq, x: 0, y: 0, zoneId: '', density: 0, amountCU };
  },
  advance(key: string, seq: number): Command {
    return { kind: 'ADVANCE', idempotencyKey: key, seq, x: 0, y: 0, zoneId: '', density: 0, amountCU: 0 };
  },
};

export function isAdvance(cmd: Command): boolean {
  return cmd.kind === 'ADVANCE';
}

export interface CommandQueue {
  enqueue(cmd: Command): boolean;
  drain(): Command[];
  clear(): void;
  readonly size: number;
}

export function createCommandQueue(): CommandQueue {
  let items: Command[] = [];
  const seen = new Set<string>();
  return {
    enqueue(cmd: Command): boolean {
      if (seen.has(cmd.idempotencyKey)) return false;
      seen.add(cmd.idempotencyKey);
      items.push(cmd);
      return true;
    },
    drain(): Command[] {
      const out = items;
      items = [];
      return out;
    },
    clear(): void {
      items = [];
      seen.clear();
    },
    get size(): number {
      return items.length;
    },
  };
}

export interface InputGate {
  readonly isLocked: boolean;
  lock(): void;
  unlock(): void;
  tryBegin(): boolean;
}

export function createInputGate(): InputGate {
  let locked = false;
  return {
    get isLocked(): boolean {
      return locked;
    },
    lock(): void {
      locked = true;
    },
    unlock(): void {
      locked = false;
    },
    tryBegin(): boolean {
      if (locked) return false;
      locked = true;
      return true;
    },
  };
}
