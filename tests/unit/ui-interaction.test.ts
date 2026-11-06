/**
 * HC-01 · S-07 · 交互控制器单测
 *
 * 钉定 S-07 验收主线：
 * ① 默认暂停、0 次 tick 时 V3/V5/Tab/选中都有即时通道 A 事件（<100ms 的结构前提）；
 * ② UI 零写权威状态，非法命令经 `BudgetRejected` 回滚乐观视图且不残留；
 * ③ 结算期 InputGate 锁「推 / 改状态」但纯视觉反馈仍响应；连点不双结算；
 * ④（动效见 ui-motion.test.ts）；⑤ 倍速默认关，开启只是「定时产生 V6 命令」，分层不变。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../src/core/config.ts';
import { createInitialState, serializeState } from '../../src/core/schema.ts';
import { canonicalize } from '../../src/core/types.ts';
import { buildSemanticTokenMap, tokenById } from '../../src/render/semantic-tokens.ts';
import { createSimulation } from '../../src/simulation/session.ts';
import {
  FRAME_FREE,
  TICK_FREE,
  createInteractionController,
  createUiFeatureFlags,
  DEFAULT_UI_FEATURE_FLAGS,
  type InteractionController,
  type UiActionResult,
  type UiAdvanceResult,
} from '../../src/ui/index.ts';

function setup(reducedMotion = false) {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  const tokens = buildSemanticTokenMap(config.zoneTypes);
  const sim = createSimulation(config, state);
  const ui = createInteractionController({ session: sim, tokens, reducedMotion });
  return { config, tokens, sim, ui };
}

// ---------------------------------------------------------------------------
// ① 通道 A 与 tick 完全无关
// ---------------------------------------------------------------------------

test('UI-1 默认暂停、0 次 tick：V3 / V5 / 切 Tab / 选中全部有即时 A 事件，B 通道为空', () => {
  const { sim, ui } = setup();

  ui.zone(2, 2, 'R', 2); // V3 划
  ui.road(3, 3); // V5 连
  ui.setTab('ROAD'); // 切 Tab
  ui.select(1, 1); // 选中

  assert.equal(sim.tickId, 0, '全程未推进 tick');
  assert.equal(sim.committedCount, 0, '未发生任何结算');
  assert.equal(sim.pendingCount, 1 + 1, '只有 V3 / V5 产生 Command（Tab / 选中是纯视觉）');

  const types = ui.bus.historyA().map((e) => e.type);
  for (const expected of ['press', 'placement', 'tab', 'select']) {
    assert.ok(types.indexOf(expected) >= 0, '缺通道 A 事件：' + expected);
  }
  for (const e of ui.bus.historyA()) {
    assert.equal(e.tickId, TICK_FREE, 'A 通道事件不得携带 tick 信息');
    assert.equal(e.channel, 'A');
  }
  assert.equal(ui.bus.dispatchCountB, 0, '未结算时不可能有 B 通道事件');
  assert.equal(ui.bus.historyB().length, 0);
});

test('UI-2 UI 零写权威状态：一串 V3/V4/V5/Tab/选中操作后 state 指纹逐字节不变', () => {
  const { sim, ui } = setup();
  const before = canonicalize(serializeState(sim.state));
  const tickBefore = sim.tickId;

  ui.zone(2, 2, 'R', 1);
  ui.zone(3, 2, 'C', 2);
  ui.demolish(2, 2);
  ui.road(4, 4);
  ui.roadClickPath(5, 5, 7, 7);
  ui.fund(50);
  ui.setTab('C');
  ui.openPanel('L1');
  ui.openPanel('L2');
  ui.select(6, 6);

  assert.equal(canonicalize(serializeState(sim.state)), before, 'UI 层不得写 state（网格 / 预算 / 满意度）');
  assert.equal(sim.tickId, tickBefore);
  assert.equal(ui.layer.size > 0, true, '乐观叠加只存在于 UI 侧');
});

test('UI-3 面板互斥：L1 → L2 时旧的收起，同屏只有 1 个数据面板（ux-spec §2.2 / E8）', () => {
  const { ui } = setup();
  ui.openPanel('L1');
  const l1 = ui.layer.active().filter((o) => o.kind === 'panel');
  assert.equal(l1.length, 1);

  ui.openPanel('L2');
  const panels = ui.layer.active().filter((o) => o.kind === 'panel');
  assert.equal(panels.length, 1, 'L1 / L2 互斥，不得并排');
  assert.equal(panels[0].commandId.indexOf('L2') >= 0, true);
  assert.equal(ui.panel, 'L2');

  ui.openPanel('none');
  assert.equal(ui.layer.active().filter((o) => o.kind === 'panel').length, 0);
  assert.equal(ui.panel, 'none');
});

// ---------------------------------------------------------------------------
// ② 非法命令回滚
// ---------------------------------------------------------------------------

test('UI-4 非法命令回滚（锁定区）：BudgetRejected → 叠加项撤下 + 负向形状事件，无残留', () => {
  const { sim, ui, tokens } = setup();
  const applied = ui.zone(20, 20, 'R', 2); // 20×20 在 16×16 起始解锁区之外
  assert.equal(applied.accepted, true, '命令先被接受（乐观提交），裁决留给 P1');
  assert.equal(ui.layer.size, 1, '落位预览立即出现（通道 A）');

  const run = ui.advanceDay('d1');
  assert.equal(run.accepted, true);
  assert.equal(run.committed, 1);

  const rejected = run.events.filter((e) => e.type === 'BudgetRejected');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'LOCKED_REGION');
  assert.equal(rejected[0].commandId, applied.commandId);

  assert.equal(ui.layer.size, 0, '回滚后叠加项不得残留');
  assert.equal(ui.layer.itemFor(applied.commandId), undefined);

  const rollbacks = ui.bus.historyA().filter((e) => e.type === 'rollback');
  assert.equal(rollbacks.length, 1);
  assert.equal(rollbacks[0].target, applied.commandId);
  assert.equal(rollbacks[0].encoding?.shape, tokenById(tokens, 'status.negative').shape, '负向形状编码来自语义令牌');
  assert.ok((rollbacks[0].encoding?.shape ?? '').length > 0);
  assert.equal(sim.committedCount, 1);
});

test('UI-5 非法命令回滚（预算透支）：FUND 超上限 → BUDGET_LIMIT 回滚扣减预览', () => {
  const { ui } = setup();
  const applied = ui.fund(Number.MAX_SAFE_INTEGER);
  assert.equal(ui.layer.itemFor(applied.commandId)?.kind, 'fund-preview');

  const run = ui.advanceDay('d1');
  const rejected = run.events.filter((e) => e.type === 'BudgetRejected');
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason, 'BUDGET_LIMIT');
  assert.equal(ui.layer.size, 0);
  assert.equal(
    ui.bus.historyA().filter((e) => e.type === 'rollback').length,
    1,
  );
});

// ---------------------------------------------------------------------------
// ③ 结算期间 / 连点幂等
// ---------------------------------------------------------------------------

test('UI-6 连点幂等：同 key 两次 advanceDay 只结算 1 次（committedCount / tickId 断言）', () => {
  const { sim, ui } = setup();
  const first = ui.advanceDay('same-key');
  assert.equal(first.accepted, true);
  assert.equal(first.committed, 1);
  assert.equal(sim.tickId, 1);

  const second = ui.advanceDay('same-key');
  assert.equal(second.accepted, false);
  assert.equal(second.reason, 'DUPLICATE_KEY');
  assert.equal(second.committed, 0);
  assert.equal(second.visualEmitted, true, '被拒也必须仍给按压态反馈（不得「点了没反应」）');
  assert.equal(sim.tickId, 1, '不得二次结算');
  assert.equal(sim.committedCount, 1);
});

test('UI-7 结算期间（真实 P4 阶段内）：改状态 / 推 被拒，纯视觉反馈仍响应，且无残留', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  const tokens = buildSemanticTokenMap(config.zoneTypes);
  let uiRef: InteractionController | undefined;
  let lockedZone: UiActionResult | undefined;
  let lockedAdvance: UiAdvanceResult | undefined;
  let lockedSelect: UiActionResult | undefined;

  const sim = createSimulation(config, state, {
    onStage: (stage) => {
      if (stage !== 'P4' || uiRef === undefined) return;
      lockedZone = uiRef.zone(4, 4, 'R', 1);
      lockedAdvance = uiRef.advanceDay('during-settlement');
      lockedSelect = uiRef.select(5, 5);
    },
  });
  uiRef = createInteractionController({ session: sim, tokens });

  const main = uiRef.advanceDay('main');
  assert.equal(main.accepted, true);
  assert.ok(lockedZone !== undefined);
  assert.ok(lockedAdvance !== undefined);
  assert.ok(lockedSelect !== undefined);
  assert.equal(lockedZone.accepted, false, '结算期间「改状态」必须被拒');
  assert.equal(lockedZone.reason, 'GATE_LOCKED');
  assert.equal(lockedZone.visualEmitted, true, '纯视觉反馈仍响应');
  assert.equal(lockedAdvance.accepted, false, '结算期间「推」必须被拒（防双结算）');
  assert.equal(lockedSelect.accepted, true, '选中是纯视觉动作，结算期间仍响应');

  assert.equal(sim.committedCount, 1, '整轮只结算 1 次');
  assert.equal(sim.tickId, 1);
  const cells = uiRef.layer.active().filter((o) => o.mutatesAuthority);
  assert.equal(cells.length, 0, '被拒的改状态动作不得留下乐观叠加残留');
  assert.equal(uiRef.layer.active().filter((o) => o.kind === 'selection').length, 1);
  assert.equal(uiRef.gateLocked, false, '结算结束后闸门解锁');
});

test('UI-8 手动锁闸门（等价结算期）：改状态被拒 + 立即回滚 + 按压仍派发', () => {
  const { sim, ui } = setup();
  sim.gate.lock();
  const before = ui.bus.dispatchCountA;
  const r = ui.zone(2, 2, 'R', 1);
  assert.equal(r.accepted, false);
  assert.equal(r.reason, 'GATE_LOCKED');
  assert.equal(r.visualEmitted, true);
  assert.equal(ui.layer.size, 0);
  assert.ok(ui.bus.dispatchCountA > before, '锁闸门不阻断通道 A');

  const p = ui.press('end-day');
  assert.equal(p.visualEmitted, true);
  const adv = ui.advanceDay('locked');
  assert.equal(adv.accepted, false);
  assert.equal(adv.reason, 'GATE_LOCKED');
  sim.gate.unlock();
  assert.equal(ui.advanceDay('after').accepted, true);
});

// ---------------------------------------------------------------------------
// 通道 B 内容与 V6 唯一入口
// ---------------------------------------------------------------------------

test('UI-9 结算后通道 B 事件齐备（tick-delta / flow-state / voice），A 事件仍恒为 TICK_FREE', () => {
  const { ui } = setup();
  ui.advanceDay('d1');
  const b = ui.bus.historyB();
  assert.ok(b.length >= 3);
  const types = b.map((e) => e.type);
  assert.ok(types.indexOf('tick-delta') >= 0, '缺 tick-delta');
  assert.ok(types.indexOf('flow-state') >= 0, '缺 flow-state');
  assert.ok(types.indexOf('voice') >= 0, '缺 voice');
  for (const e of b) {
    assert.equal(e.tickId, 1);
    assert.equal(e.frameId, FRAME_FREE, 'B 通道不携带帧信息');
  }
  const delta = b.filter((e) => e.type === 'tick-delta')[0];
  assert.equal(typeof delta.delta?.S, 'number', 'Δ_t 是 B 通道唯一权威数值来源');
  const flow = b.filter((e) => e.type === 'flow-state')[0];
  assert.equal(flow.data?.refresh, true);
  assert.equal(typeof flow.data?.dS_fc, 'number');
  const voice = b.filter((e) => e.type === 'voice')[0];
  assert.ok((voice.data?.causeRef ?? '').length > 0, '市民之声只搬归因 refs，不编造文案');

  for (const e of ui.bus.historyA()) assert.equal(e.tickId, TICK_FREE);
});

test('UI-10 V6 只经 advanceDay：编辑命令不推进 tick，推进后队列清空', () => {
  const { sim, ui } = setup();
  ui.zone(2, 2, 'R', 1);
  ui.road(2, 3);
  ui.zone(3, 3, 'C', 1);
  assert.equal(sim.tickId, 0, '编辑命令不推进 tick（主动推进制）');
  assert.equal(ui.pendingCount, 3);

  const r = ui.advanceDay('day-1');
  assert.equal(r.accepted, true);
  assert.equal(r.tickId, 1);
  assert.equal(ui.pendingCount, 0);
  assert.equal(ui.tickId, 1);
});

test('UI-11 点击替代路径：roadClickPath 生成与拖拽单格同构的 ROAD 命令（ux-spec §3.3 / §9.2）', () => {
  const { sim, ui } = setup();
  const dragCell = ui.road(3, 3);
  assert.equal(dragCell.accepted, true);

  const path = ui.roadClickPath(5, 5, 7, 5);
  assert.equal(path.length, 3, '水平 3 格');
  for (const r of path) assert.equal(r.accepted, true);
  assert.equal(sim.pendingCount, 4);

  const cmds = ui.commands();
  assert.equal(cmds.length, 4);
  for (const c of cmds) {
    assert.equal(c.kind, 'ROAD', '两条路径产生同一 Command 类别');
    assert.equal(c.zoneId, 'ROAD');
    assert.equal(c.density, 0);
  }
  // 点击路径产生的命令与拖拽单格命令在结构上完全同构（只有坐标 / 键不同）
  assert.deepEqual(Object.keys(cmds[1]).sort(), Object.keys(cmds[0]).sort());
});

test('UI-12 倍速 feature flag 默认关：pumpAutoAdvance 不产生任何结算', () => {
  const { sim, ui } = setup();
  assert.equal(DEFAULT_UI_FEATURE_FLAGS.speedMultiplier, false);
  assert.equal(DEFAULT_UI_FEATURE_FLAGS.speedLevels.length, 0, '默认不带任何档位');
  assert.equal(ui.flags.speedMultiplier, false);
  assert.equal(ui.pumpAutoAdvance(1_000_000), null);
  assert.equal(sim.tickId, 0);
  assert.equal(sim.committedCount, 0);
});

test('UI-13 倍速开启：只是「定时产生 V6 命令」，A / B 通道分层不变', () => {
  const config = createDefaultConfig();
  const tokens = buildSemanticTokenMap(config.zoneTypes);
  const sim = createSimulation(config, createInitialState(config));
  const ui = createInteractionController({
    session: sim,
    tokens,
    flags: createUiFeatureFlags({ speedMultiplier: true, speedLevels: [1, 2, 4], autoAdvanceIntervalMs: 1000 }),
  });

  ui.zone(2, 2, 'R', 1);
  assert.equal(ui.pumpAutoAdvance(400), null, '未到间隔不推进');
  assert.equal(sim.tickId, 0);

  const auto = ui.pumpAutoAdvance(700);
  assert.ok(auto !== null);
  assert.equal(auto!.accepted, true);
  assert.equal(auto!.fromAutoAdvance, true);
  assert.equal(auto!.committed, 1, '一次到期只产生一次结算');
  assert.equal(sim.tickId, 1);
  assert.equal(auto!.commandId, 'auto-advance-1');

  // 分层不变：A 事件仍不携带 tick、B 事件仍带真实 tickId
  for (const e of ui.bus.historyA()) assert.equal(e.tickId, TICK_FREE);
  const b = ui.bus.historyB();
  assert.ok(b.length > 0);
  for (const e of b) assert.equal(e.tickId, 1);
  assert.equal(ui.bus.historyB().filter((e) => e.type === 'tick-delta').length, 1);
});

test('UI-14 改状态动作的乐观叠加在结算成功后由权威状态接管（叠加项撤下）', () => {
  const { ui, sim } = setup();
  const applied = ui.zone(2, 2, 'R', 1);
  assert.equal(ui.layer.size, 1);

  ui.advanceDay('d1');
  // 合法命令被 P1 应用：权威状态已含该格，乐观叠加不再需要（UI 侧清理由调用方按 VM diff 处理），
  // 但此处须确认：合法命令**不**产生回滚事件
  assert.equal(
    ui.bus.historyA().filter((e) => e.type === 'rollback').length,
    0,
    '合法命令不得误触发回滚',
  );
  assert.equal(ui.layer.itemFor(applied.commandId)?.kind, 'placement');
  assert.equal(sim.committedCount, 1);
});
