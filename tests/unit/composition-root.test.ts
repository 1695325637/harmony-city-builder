/**
 * HC-01 · S-12 · 组合根闭环接线（初始态归档 / P8 落盘 / 后台强存 / 回退·解锁后存）
 *
 * 【介质口径】全部结论限定为**内存模拟介质可验证**。真机应用沙箱 / KV / HAP 权限模型 /
 * 杀进程与切后台的真实持久化**未验证**（EX-03 / K-4，准出阻塞）。`onBackground()` 是注入式
 * 方法，不代表真机生命周期已跑通。
 *
 * 钉定：
 * ① 初始态 tick 0 归档为 KEYFRAME，周期 0 起点可回退（补 CYCLE_START_KEYFRAME_MISSING 缺口）；
 * ② 每次成功结算 P8 落盘，load 原样恢复、不推进 tick、不补算；
 * ③ onBackground 强存（无新结算也写槽）；
 * ④ 回退后补存、幂等重放不重复写槽；E7 解锁帧可观测；
 * ⑤ 全程不改 config / config.unlockedSide（改它即令所有存档 ConfigMismatchError，D-01）；
 * ⑥ 不读墙上时钟、零平台依赖；displayTime 是展示标签、不进模拟计算。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createDefaultConfig,
  createInitialState,
  computeConfigHash,
  serializeState,
  canonicalize,
  type Config,
} from '../../src/index.ts';
import { createCompositionRoot, type CompositionRoot } from '../../src/composition.ts';
import { RollbackError } from '../../src/simulation/rollback.ts';

const SIDE = 16;

function retryableConfig(): Config {
  // K=2 便于跨周期；S_unlock=99 避免 TARGET_MET 解锁帧干扰回退判定（E7）
  return createDefaultConfig({ K: 2, S_unlock: 99 });
}

function makeRoot(options: Parameters<typeof createCompositionRoot>[2] = {}): CompositionRoot {
  const config = retryableConfig();
  return createCompositionRoot(config, createInitialState(config, { side: SIDE }), options);
}

function sameState(a: unknown, b: unknown): boolean {
  return canonicalize(a) === canonicalize(b);
}

function advanceN(root: CompositionRoot, n: number, prefix: string): void {
  for (let t = 1; t <= n; t++) root.advanceDay(prefix + t);
}

test('CR-1 初始态归档为 tick 0 KEYFRAME，周期 0 起点可回退', () => {
  const root = makeRoot();
  const initial = root.initialSnapshot;
  assert.ok(initial !== null, 'archiveInitial 缺省 true 时必须归档初始态');
  assert.equal(initial.tickId, 0, '初始快照 tickId 必须是 0');
  assert.equal(initial.kind, 'KEYFRAME', '归档首条强制 KEYFRAME');
  assert.equal(initial.cycleId, 0);
  assert.equal(initial.cycleTickIndex, 0, '周期 0 起点须满足 cycleTickIndex===0');
  assert.ok(initial.frames !== null, 'KEYFRAME 必须自包含全量状态');

  advanceN(root, 3, 'cr1-');
  // 显式回退到周期 0：此前因「周期 0 起点未入档」会抛 CYCLE_START_KEYFRAME_MISSING
  const r = root.retryCycle(0);
  assert.equal(r.retry.restoredFromTickId, 0, '应从 tick 0 的初始 KEYFRAME 恢复');
  assert.equal(r.retry.previousHeadTickId, 3);
  assert.ok(r.retry.newHeadTickId > 3, '回退 = 开新分支，tickId 单调不复用');
  assert.ok(r.save !== undefined && r.save.ok, '回退后必须立即补存');
});

test('CR-2 P8 落盘：save.ok、writeSeq 递增、load 原样恢复且不推进 tick', () => {
  const root = makeRoot();
  const r1 = root.advanceDay('cr2-1');
  assert.equal(r1.accepted, true);
  assert.ok(r1.save !== undefined && r1.save.ok, '成功结算必须落盘');
  assert.equal(r1.save.writeSeq, 1);
  const headTick = root.tickId;
  const loaded = root.load();
  assert.equal(loaded.ok, true);
  assert.equal(loaded.state?.tickId, headTick, '恢复不得推进 tick / 不得补算漏掉的 tick');
  assert.equal(sameState(serializeState(loaded.state), serializeState(root.state)), true);

  const r2 = root.advanceDay('cr2-2');
  assert.equal(r2.save?.writeSeq, 2, 'A/B 双槽交替，writeSeq 单调');
  assert.equal(root.saveCount, 2);
});

test('CR-3 onBackground 强存：无新结算也写槽，且恢复的是当时的状态', () => {
  const root = makeRoot();
  advanceN(root, 2, 'cr3-');
  const before = root.saveCount;
  const saved = root.onBackground();
  assert.equal(saved.ok, true);
  assert.equal(root.saveCount, before + 1, '切后台必须强存一次');
  const loaded = root.load();
  assert.equal(loaded.ok, true);
  assert.equal(sameState(serializeState(loaded.state), serializeState(root.state)), true);
  assert.equal(loaded.state?.tickId, root.tickId, '强存不推进 tick');
});

test('CR-4 回退后补存；幂等重放不重复写槽（writeSeq 不空转）', () => {
  const root = makeRoot();
  advanceN(root, 3, 'cr4-');
  const first = root.retryCycle(0);
  assert.ok(first.save !== undefined && first.save.ok);
  const countAfterFirst = root.saveCount;
  const seqAfterFirst = first.save.writeSeq;

  const second = root.retryCycle(0);
  assert.equal(Object.is(first.retry, second.retry), true, 'session 幂等重放返回同一 result 对象');
  assert.equal(second.save, undefined, '幂等重放不得再写一次槽');
  assert.equal(root.saveCount, countAfterFirst);
  const loaded = root.load();
  assert.equal(loaded.ok, true);
  assert.equal(sameState(serializeState(loaded.state), serializeState(root.state)), true);
  assert.ok(seqAfterFirst >= 4, 'writeSeq 应随每次落盘递增');
});

test('CR-5 全程不改 config / config.unlockedSide，load 不触发 D-01', () => {
  const config = retryableConfig();
  const unlockedSideBefore = config.unlockedSide;
  const hashBefore = computeConfigHash(config);
  const root = createCompositionRoot(config, createInitialState(config, { side: SIDE }));
  advanceN(root, 4, 'cr5-');
  root.onBackground();
  root.retryCycle(0);
  assert.equal(config.unlockedSide, unlockedSideBefore, 'unlockedSide 是 configHash 输入，绝不可改');
  assert.equal(computeConfigHash(config), hashBefore);
  const loaded = root.load();
  assert.equal(loaded.ok, true, '改 config 会让旧档 ConfigMismatchError；未改则应正常载入');
});

test('CR-6 不读时钟 / 零平台依赖；displayTime 是展示标签、不进模拟计算', () => {
  const config = retryableConfig();
  const a = createCompositionRoot(config, createInitialState(config, { side: SIDE }), { displayTime: '2026-11-07 10:00' });
  const b = createCompositionRoot(config, createInitialState(config, { side: SIDE }), { displayTime: '完全不同的标签' });
  advanceN(a, 2, 'cr6-');
  advanceN(b, 2, 'cr6-');
  assert.equal(
    sameState(serializeState(a.state), serializeState(b.state)),
    true,
    'displayTime 只进 header 展示字段，绝不参与模拟计算',
  );
  const src = readFileSync(join(process.cwd(), 'src', 'composition.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(/Date\.now|new Date|Math\.random/.test(code), false, '组合根不得读墙上时钟或随机源');
  assert.equal(/from ['"]node:|from ['"]cc['"]|import\('/.test(code), false, '组合根不得依赖平台 / 引擎模块');
});

test('CR-7 archiveInitial:false 时周期 0 不可回退——可判定失败，不静默借错帧', () => {
  const root = makeRoot({ archiveInitial: false });
  assert.equal(root.initialSnapshot, null);
  advanceN(root, 2, 'cr7-');
  assert.throws(
    () => root.retryCycle(0),
    (err: unknown) => {
      assert.ok(err instanceof RollbackError, '应抛可判定的 RollbackError');
      assert.equal(err.code, 'CYCLE_START_KEYFRAME_MISSING',
        '无周期 0 起点 KEYFRAME 时必须给出该错误码，不得借别的帧充数');
      return true;
    },
  );
});
