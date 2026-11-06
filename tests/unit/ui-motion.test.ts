/**
 * HC-01 · S-07 · 动效策略单测（「减少动态效果」降级不丢信息）
 *
 * 钉定 art-bible §9.2 / §8.4 与 ADR-004 备选 A6（**否决**「减少动态效果时连即时反馈
 * 一起关掉」）：
 * - 开启后 loop / 粒子 / 相机缓动三项全 false；
 * - 即时反馈**降级为静态**（描边 / 按压色），编码非空 —— 信息不丢失；
 * - tick 后反馈改为瞬时跳变。
 *
 * 令牌隔离纪律：不断言形状字面值（✕ / ↑ / !），只与 `tokenById` 查到的令牌对比、
 * 只断言「非空」「两两不同」。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../src/core/config.ts';
import { createInitialState } from '../../src/core/schema.ts';
import { buildSemanticTokenMap, tokenById } from '../../src/render/semantic-tokens.ts';
import { createSimulation } from '../../src/simulation/session.ts';
import {
  IMMEDIATE_FEEDBACK_KINDS,
  createInteractionController,
  createMotionPolicy,
  type ImmediateFeedbackKind,
} from '../../src/ui/index.ts';

const config = createDefaultConfig();
const tokens = buildSemanticTokenMap(config.zoneTypes);

test('MOT-1 默认不减少动态效果：loop / 粒子 / 相机缓动全部启用', () => {
  const policy = createMotionPolicy({ tokens });
  assert.equal(policy.reducedMotion, false);
  assert.deepEqual(policy.effects(), { loops: true, particles: true, cameraEase: true });
  assert.equal(policy.immediate('placement').mode, 'animated');
  assert.equal(policy.immediate('placement').durationMs > 0, true);
});

test('MOT-2 开启「减少动态效果」：loop / 粒子 / 相机缓动三项全 false', () => {
  const policy = createMotionPolicy({ tokens, reducedMotion: true });
  assert.equal(policy.reducedMotion, true);
  const effects = policy.effects();
  assert.equal(effects.loops, false);
  assert.equal(effects.particles, false);
  assert.equal(effects.cameraEase, false);
  assert.deepEqual(effects, { loops: false, particles: false, cameraEase: false });
});

test('MOT-3 降级后即时反馈仍有具体静态编码（不是空值、不是消失）', () => {
  const policy = createMotionPolicy({ tokens, reducedMotion: true });
  for (const kind of IMMEDIATE_FEEDBACK_KINDS) {
    const spec = policy.immediate(kind);
    assert.equal(spec.kind, kind);
    assert.equal(spec.mode === 'static-outline' || spec.mode === 'static-press-color', true, kind + ' 必须降级为静态编码');
    assert.equal(spec.durationMs, 0, kind + ' 静态降级为瞬时（0ms）');
    assert.equal(spec.encoding.tokenId.length > 0, true, kind + ' 令牌 id 非空');
    assert.equal(spec.encoding.color.length > 0, true, kind + ' 色值非空（来自语义令牌）');
    assert.equal(spec.encoding.label.length > 0, true, kind + ' 文字标签非空');
    assert.equal(typeof spec.encoding.shape, 'string');
    assert.equal(spec.channels.indexOf('motion') < 0, true, kind + ' 静态模式下不声明 motion 通道');
    assert.equal(spec.channels.length >= 2, true, kind + ' 降级后仍 ≥2 通道（信息不丢失）');
    assert.equal(spec.informationLost, false);
    assert.equal(spec.outlineWidthPx > 0, true, kind + ' 描边宽度仍需具体值');
  }
});

test('MOT-4 状态类即时反馈在两种模式下都带真实形状编码，且彼此不同（色盲友好）', () => {
  const normal = createMotionPolicy({ tokens });
  const reduced = createMotionPolicy({ tokens, reducedMotion: true });
  const kinds: ImmediateFeedbackKind[] = ['placement', 'demolition'];
  const shapesNormal = kinds.map((k) => normal.immediate(k).encoding.shape);
  const shapesReduced = kinds.map((k) => reduced.immediate(k).encoding.shape);

  for (const s of shapesNormal.concat(shapesReduced)) {
    assert.equal(typeof s === 'string' && s.length > 0, true, '形状编码非空');
    assert.notEqual(s, 'none', '状态类反馈必须有真实形状（不得只靠颜色）');
  }
  assert.deepEqual(shapesReduced, shapesNormal, '降级不改变语义编码（只改表现方式）');
  assert.equal(new Set(shapesNormal).size, 2, '落位 / 拆除形状必须不同');

  // 与语义令牌逐项对齐（不写死 ✕/↑/! 字面值）
  assert.equal(normal.immediate('placement').encoding.shape, tokenById(tokens, 'status.positive').shape);
  assert.equal(normal.immediate('demolition').encoding.shape, tokenById(tokens, 'status.warning').shape);
  assert.equal(normal.immediate('placement').encoding.color, tokenById(tokens, 'status.positive').color);
});

test('MOT-5 tick 后反馈：常态为缓动、降级为瞬时跳变，编码均非空', () => {
  const normal = createMotionPolicy({ tokens });
  const reduced = createMotionPolicy({ tokens, reducedMotion: true });
  assert.equal(normal.tickFeedback().mode, 'animated');
  assert.equal(normal.tickFeedback().durationMs > 0, true);
  assert.equal(reduced.tickFeedback().mode, 'instant');
  assert.equal(reduced.tickFeedback().durationMs, 0);
  assert.equal(reduced.tickFeedback().encoding.color.length > 0, true, '瞬时跳变仍要有色 / 文字承载');
  assert.equal(reduced.tickFeedback().channels.length >= 2, true);
  assert.equal(reduced.tickFeedback().informationLost, false);
});

test('MOT-6 开关往返可逆：toggle 两次回到启用动效，声明随之恢复', () => {
  const policy = createMotionPolicy({ tokens, reducedMotion: true });
  assert.equal(policy.toggleReducedMotion(), false);
  assert.deepEqual(policy.effects(), { loops: true, particles: true, cameraEase: true });
  assert.equal(policy.toggleReducedMotion(), true);
  assert.deepEqual(policy.effects(), { loops: false, particles: false, cameraEase: false });
  policy.setReducedMotion(false);
  assert.equal(policy.reducedMotion, false);
});

test('MOT-7 集成：减少动态效果下按压事件的载荷仍含非空静态编码（「点了有反应」不消失）', () => {
  const state = createInitialState(config);
  const sim = createSimulation(config, state);
  const ui = createInteractionController({ session: sim, tokens, reducedMotion: true });

  ui.press('end-day');
  const press = ui.bus.historyA().filter((e) => e.type === 'press')[0];
  assert.ok(press !== undefined);
  assert.equal(press.encoding?.color.length !== 0, true, '按压色仍存在');
  assert.equal(press.encoding?.label.length !== 0, true);
  assert.equal(press.data?.mode, 'static-press-color');
  assert.equal(press.data?.durationMs, 0);
  assert.equal(String(press.data?.channels).indexOf('motion') < 0, true);
  assert.equal(String(press.data?.channels).split('+').length >= 2, true);

  // 世界动效声明同样全 false（同一策略对象供渲染层读取）
  assert.deepEqual(ui.motion.effects(), { loops: false, particles: false, cameraEase: false });
});

/**
 * D-13：当语义令牌的 `shape === 'none'`（如 `status.selected` 仅描边不画形状，
 * low-end / 形状门控场景），反馈通道**不计 `shape`**，改计 `outline`，保证降级后
 * 通道数 ≥ 2（信息不丢失）。有真实形状（如 `status.positive`）仍计 `shape`、不计 `outline`。
 */
test('MOT-8 D-13 形状为 none 时通道用 outline 替代 shape，且通道数 ≥2', () => {
  const normal = createMotionPolicy({ tokens });
  const reduced = createMotionPolicy({ tokens, reducedMotion: true });

  // select / press 用 status.selected（shape='none'）→ 通道含 outline、不含 shape
  for (const kind of ['select', 'press'] as ImmediateFeedbackKind[]) {
    for (const p of [normal, reduced]) {
      const spec = p.immediate(kind);
      assert.equal(spec.encoding.shape, 'none', kind + ' 编码形状态为 none');
      assert.equal(spec.channels.indexOf('shape') < 0, true, kind + '（none 形状）不计 shape 通道');
      assert.equal(spec.channels.indexOf('outline') >= 0, true, kind + '（none 形状）改计 outline 通道');
      assert.equal(spec.channels.length >= 2, true, kind + ' 通道数 ≥2（信息不丢失）');
    }
  }

  // 对照：placement 用 status.positive（有真实形状）→ 计 shape、不计 outline
  for (const p of [normal, reduced]) {
    const spec = p.immediate('placement');
    assert.notEqual(spec.encoding.shape, 'none', 'placement 有真实形状');
    assert.equal(spec.channels.indexOf('shape') >= 0, true, '有形状时计 shape 通道');
    assert.equal(spec.channels.indexOf('outline') < 0, true, '有形状时不计 outline 通道');
  }
});
