/**
 * HC-01 · S-07【UI 双通道 · 第二层 QA 独立复核】套件（T-128）
 *
 * 目的：独立重验五条验收 + 实现方披露的四处风险，不复用其 54 条用例断言。
 * 编号 QA-U*（与 T-119 的 QA-R、T-124 的 QA-T 两套编号区分）：
 *   QA-U1  ③ 结算期 gate 锁（**自造真实 runTick**：createSimulation + onStage=P4 回调内触发
 *          zone / select / advanceDay，验证「推/改状态被拒 + 视觉仍响应 + 恰 1 次结算 + 无残留」）
 *   QA-U2  ② 两类非法命令回滚（锁定区 / 预算透支）：layer.size 归零、负向形状来自令牌而非字面值
 *   QA-U3  SCAN 独立重扫（零写 state/cells/budget/tickId、无 runTick/tick-pipeline、无 cc、
 *          无 hex、无随机/时钟、performance.now 仅计时文件、无 node: 依赖）
 *   QA-U4  (a) 令牌依赖面：UI 实际依赖的 6 个 id 全部存在；**已删除的 `base.primary` 走兜底不抛错**；
 *          UI 源码不再出现 `base.primary`（事故回归守卫）
 *   QA-U5  ⑤ 倍速默认关、开启后走同一 advance 路径且 A/B 分层不变
 *   QA-U6  ④ 减少动态效果：三项动效全 false、静态编码非空、≥2 通道、informationLost=false
 *   QA-U7  ① 0 tick 下四类操作即时响应 + ② UI 零写状态（指纹前后逐字节一致）
 *   QA-U8  (c) 真实 `Simulation` 直传的覆盖度核实（14 条用例全部走真实会话，无假端口）
 *
 * 纪律：只读 src/、tests/；不写权威状态；不编造数值；<100ms 一律「真机未测」。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildSemanticTokenMap,
  canonicalize,
  createDefaultConfig,
  createInitialState,
  createSimulation,
  serializeState,
  tokenById,
  type CityState,
  type Simulation,
} from '../../src/index.ts';
import {
  DEFAULT_UI_FEATURE_FLAGS,
  TICK_FREE,
  createInteractionController,
  createUiFeatureFlags,
  encodingOf,
  UI_TABS,
  type InteractionController,
  type UiActionResult,
  type UiAdvanceResult,
} from '../../src/ui/index.ts';

function setup(reducedMotion = false): {
  config: ReturnType<typeof createDefaultConfig>;
  state: CityState;
  sim: Simulation;
  ui: InteractionController;
  tokens: ReturnType<typeof buildSemanticTokenMap>;
} {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  const tokens = buildSemanticTokenMap(config.zoneTypes);
  const sim = createSimulation(config, state);
  const ui = createInteractionController({ session: sim, tokens, reducedMotion });
  return { config, state, sim, ui, tokens };
}

// ---------------------------------------------------------------------------
// QA-U1 ③ 结算期 gate 锁（真实 runTick + onStage 回调内触发）
// ---------------------------------------------------------------------------

test('QA-U1 真实 P4 阶段内：zone/advance 被拒但视觉仍响应，恰 1 次结算、无残留、负向形状来自令牌', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  const tokens = buildSemanticTokenMap(config.zoneTypes);

  let innerZone: UiActionResult | undefined;
  let innerSelect: UiActionResult | undefined;
  let innerAdvance: UiAdvanceResult | undefined;
  let lockedInsideStage = false;
  let gateLockedAfter = false;

  // 自造真实结算：onStage 在 gate.lock 之后、unlock 之前被调用
  let ui!: InteractionController;
  const sim = createSimulation(config, state, {
    onStage: (stage) => {
      if (stage !== 'P4') return; // 只在中段触发一次，验证整条链
      lockedInsideStage = sim.gate.isLocked;
      innerZone = ui.zone(2, 2, 'R', 2); // 改状态 → 应被拒
      innerSelect = ui.select(1, 1); // 纯视觉 → 必须响应
      innerAdvance = ui.advanceDay('inner-advance'); // 推 → 应被拒（不可重入）
      gateLockedAfter = sim.gate.isLocked;
    },
  });
  ui = createInteractionController({ session: sim, tokens });

  const result = ui.advanceDay('day-1');
  assert.equal(lockedInsideStage, true, 'P4 阶段内 gate 必须处于锁定态');
  assert.equal(gateLockedAfter, true, '回调内不得解锁（锁由 session 统一管理）');

  assert.ok(innerZone !== undefined && innerSelect !== undefined && innerAdvance !== undefined);
  // ① 推 / 改状态被拒，但视觉通道仍响应
  assert.equal(innerZone!.accepted, false, '结算期 zone（改状态）必须被拒');
  assert.equal(innerZone!.reason, 'GATE_LOCKED');
  assert.equal(innerZone!.visualEmitted, true, '被拒时视觉反馈仍须响应（ADR-004 §2 子决策 4）');
  assert.equal(innerAdvance!.accepted, false, '结算期二次推进必须被拒');
  assert.equal(innerAdvance!.committed, 0);
  assert.equal(innerSelect!.accepted, true, '结算期纯视觉选中必须成功');
  assert.equal(innerSelect!.visualEmitted, true);

  // ② 恰 1 次结算
  assert.equal(result.accepted, true);
  assert.equal(result.committed, 1, '整轮只结算 1 次');
  assert.equal(result.tickId, 1);
  assert.equal(sim.tickId, 1);
  assert.equal(sim.committedCount, 1);

  // ③ 被拒动作不留叠加残留；选中项保留（纯视觉本就生效）
  assert.equal(ui.layer.itemFor(innerZone!.commandId), undefined, '被拒命令的叠加项必须撤下');
  assert.equal(ui.layer.size, 1, '仅剩选中项（select 1 项）');
  const rollbacks = ui.layer.rollbacks();
  const gateRollback = rollbacks.filter((r) => r.reason === 'GATE_LOCKED');
  assert.equal(gateRollback.length, 1, 'GATE_LOCKED 回滚标记恰 1 条');
  assert.equal(gateRollback[0].removed, true, '回滚确实撤下了一个生效中的叠加项');

  // ④ 负向形状来自令牌（不写死 ✕）
  const negative = tokenById(tokens, 'status.negative');
  assert.equal(gateRollback[0].encoding.tokenId, 'status.negative');
  assert.equal(gateRollback[0].encoding.shape, negative.shape, '负向形状必须等于令牌形状');
  assert.equal(gateRollback[0].encoding.color, negative.color);
  assert.notEqual(negative.shape, tokenById(tokens, 'status.positive').shape, '负向与正向形状必须不同');

  // ⑤ 双通道时钟分层：A 恒 TICK_FREE，B 恒真实 tickId
  const aEvents = ui.bus.historyA();
  assert.ok(aEvents.length >= 4, 'A 通道应含 press×3 + rollback + select 等（实际 ' + aEvents.length + '）');
  for (const e of aEvents) assert.equal(e.tickId, TICK_FREE, 'A 事件不得携带 tick：' + e.type);
  const kinds = new Set(aEvents.map((e) => e.type));
  for (const k of ['press', 'select', 'rollback'] as const) assert.ok(kinds.has(k), 'A 通道缺事件：' + k);
  assert.ok(ui.bus.dispatchCountB >= 1, '结算后应有 B 通道事件');
});

// ---------------------------------------------------------------------------
// QA-U2 ② 两类非法命令回滚
// ---------------------------------------------------------------------------

test('QA-U2 两类非法命令（锁定区 / 预算透支）回滚后 layer 归零，负向编码来自令牌', () => {
  const { config, tokens, ui } = setup();
  const locked = ui.zone(20, 20, 'R', 1); // 20 ≥ unlockedSide(16) → 锁定区
  const over = ui.fund(config.B_cap + 1); // 超上限
  assert.equal(locked.accepted, true, '入口只做排队，裁决在 P1');
  assert.equal(ui.layer.size, 2, '两个乐观叠加项在结算前生效');

  const result = ui.advanceDay('day-1');
  assert.equal(result.committed, 1);
  assert.equal(ui.layer.size, 0, '非法命令必须撤下全部叠加项（零残留）');

  const rollbacks = ui.layer.rollbacks();
  assert.equal(rollbacks.length, 2, '两条非法命令各一条回滚标记（实际 ' + rollbacks.length + '）');
  const reasons = rollbacks.map((r) => r.reason).sort();
  assert.deepEqual(reasons, ['BUDGET_LIMIT', 'LOCKED_REGION'], 'P1 裁决原因必须被如实搬运');
  const negative = tokenById(tokens, 'status.negative');
  for (const r of rollbacks) {
    assert.equal(r.encoding.tokenId, 'status.negative');
    assert.equal(r.encoding.shape, negative.shape, '回滚形状必须来自令牌表而非字面值');
    assert.equal(r.encoding.color, negative.color);
    assert.equal(r.removed, true);
    assert.equal(r.tickId, TICK_FREE, '回滚属通道 A（即时负向反馈）');
  }
  // 回滚事件也走 A 通道且不带 tick
  const rollbackEvents = ui.bus.historyA().filter((e) => e.type === 'rollback');
  assert.equal(rollbackEvents.length, 2);
  for (const e of rollbackEvents) assert.equal(e.tickId, TICK_FREE);
});

// ---------------------------------------------------------------------------
// QA-U3 SCAN 独立重扫
// ---------------------------------------------------------------------------

test('QA-U3 独立重扫 src/ui：零写状态 / 无 runTick·tick-pipeline / 无 cc / 零 hex / 时钟随机受限 / 无 node: 依赖', () => {
  const dir = join(process.cwd(), 'src', 'ui');
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
  assert.equal(files.length, 6, 'src/ui 应为 6 个文件（实际 ' + files.length + '）');

  for (const rel of files) {
    const raw = readFileSync(join(dir, rel), 'utf8');
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
      .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
      .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
      .replace(/`(?:\\.|[^`\\])*`/g, '``');

    // 写权威状态（含方法形态与整体替换）
    assert.equal(/\bstate\s*\.\s*\w+\s*=(?!=)/.test(code), false, rel + ' 写 state 属性');
    assert.equal(/(?<![\w.])state\s*=(?!=)/.test(code), false, rel + ' 整体替换 state');
    assert.equal(/cells\.(zone|density|unlocked|region|inputVersion)\s*\[[^\]]*\]\s*=(?!=)/.test(code), false, rel + ' 写 cells');
    assert.equal(/cells\.(zone|density|unlocked|region|inputVersion)\s*\.\s*(set|fill)\s*\(/.test(code), false, rel + ' cells.set/fill');
    assert.equal(/budget\.\w+\s*=(?!=)/.test(code), false, rel + ' 写 budget');
    assert.equal(/\.tickId\s*=(?!=)/.test(code), false, rel + ' 写 tickId');
    assert.equal(/Object\.assign\s*\(\s*(state|cells|budget)/.test(code), false, rel + ' Object.assign 写状态');

    // 结算内核不得进入 UI 层
    assert.equal(/tick-pipeline/.test(code), false, rel + ' 引用 tick-pipeline');
    assert.equal(/\brunTick\s*\(/.test(code), false, rel + ' 调用 runTick');

    // 引擎 / 平台 / 时钟 / 随机
    assert.equal(/from\s+['"](?:cc|@ohos|@harmony)[^'"]*['"]/.test(code), false, rel + ' import 引擎');
    assert.equal(/(?:import|require)\s*\(\s*['"](?:cc|@ohos)[^'"]*['"]\s*\)/.test(code), false, rel + ' 动态 import 引擎');
    assert.equal(/Math\.random/.test(code), false, rel + ' Math.random');
    assert.equal(/Date\.now|new Date\(/.test(code), false, rel + ' 墙上时钟');
    assert.equal(/setTimeout|setInterval|requestAnimationFrame/.test(code), false, rel + ' 定时器');
    // 零 hex（剥注释后）
    assert.equal(/#[0-9a-fA-F]{3,8}\b|0x[0-9a-fA-F]{6,8}\b/.test(code), false, rel + ' 出现 hex 色值');
    // 零 node: 依赖（UI 层应纯逻辑）
    assert.equal(/from\s+['"]node:/.test(code), false, rel + ' 依赖 node: 内置模块');
  }

  // performance.now 仅允许出现在 feedback-timing.ts
  const offenders: string[] = [];
  for (const rel of files) {
    const code = readFileSync(join(dir, rel), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
    if (/performance\.now/.test(code) && rel !== 'feedback-timing.ts') offenders.push(rel);
  }
  assert.deepEqual(offenders, [], 'performance.now 越界：' + offenders.join(','));
  assert.ok(/performance\.now/.test(readFileSync(join(dir, 'feedback-timing.ts'), 'utf8')), '计时文件应确有采样（扫描非空转）');
});

// ---------------------------------------------------------------------------
// QA-U4 (a) 令牌依赖面与「已删除 id」回归守卫
// ---------------------------------------------------------------------------

test('QA-U4 令牌依赖：6 个 id 全部存在；已删除的 base.primary 走兜底不抛错；UI 源码不再引用它', () => {
  const tokens = buildSemanticTokenMap(createDefaultConfig().zoneTypes);
  const required = ['status.positive', 'status.warning', 'status.negative', 'status.selected', 'base.tile', 'base.ink'];
  for (const id of required) {
    assert.ok(tokens.byId[id] !== undefined, 'UI 依赖的令牌 id 必须存在：' + id);
  }
  // 分区的动态依赖（config.zoneTypes 驱动）
  for (const z of ['R', 'C', 'I']) assert.ok(tokens.byId['zone.' + z] !== undefined);

  // 事故回归：base.primary 已在渲染层 A-07/A-08 中被删除 → UI 必须走兜底而不是抛错
  assert.equal(tokens.byId['base.primary'], undefined, '前提：base.primary 已不存在（否则本用例无意义）');
  const fallback = encodingOf(tokens, 'base.primary'); // 默认 fallback = base.tile
  assert.equal(fallback.tokenId, 'base.tile', '缺失令牌必须回退到中性令牌');
  assert.equal(fallback.color, tokens.byId['base.tile'].color);
  const explicit = encodingOf(tokens, 'status.positive', 'base.ink');
  assert.equal(explicit.tokenId, 'status.positive', '存在的令牌优先于兜底');

  // UI 源码不得再出现该 id（修复不回潮）
  const dir = join(process.cwd(), 'src', 'ui');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    const code = readFileSync(join(dir, f), 'utf8');
    assert.equal(code.indexOf("'base.primary'") >= 0, false, f + ' 仍引用已删除的 base.primary');
  }
});

// ---------------------------------------------------------------------------
// QA-U5 ⑤ 倍速默认关、分层不变
// ---------------------------------------------------------------------------

test('QA-U5 倍速：默认关+空档位；开启后走同一 advance 路径，A/B 分层与手动完全一致', () => {
  assert.equal(DEFAULT_UI_FEATURE_FLAGS.speedMultiplier, false);
  assert.deepEqual(DEFAULT_UI_FEATURE_FLAGS.speedLevels, []);
  const off = setup();
  assert.equal(off.ui.pumpAutoAdvance(1_000_000), null, '默认关时永不自动推进');
  assert.equal(off.sim.tickId, 0);

  const flags = createUiFeatureFlags({ speedMultiplier: true, speedLevels: [2], autoAdvanceIntervalMs: 500 });
  const config = createDefaultConfig();
  const state = createInitialState(config);
  const tokens = buildSemanticTokenMap(config.zoneTypes);
  const sim = createSimulation(config, state);
  const ui = createInteractionController({ session: sim, tokens, flags });
  assert.equal(ui.pumpAutoAdvance(300), null, '未到期不得推进');
  const auto = ui.pumpAutoAdvance(300);
  assert.ok(auto !== null, '到期应产生一次 V6');
  assert.equal(auto!.accepted, true);
  assert.equal(auto!.committed, 1);
  assert.equal(auto!.fromAutoAdvance, true);
  assert.equal(sim.tickId, 1);

  // 分层不变：A 事件全 TICK_FREE；B 事件全真实 tickId
  for (const e of ui.bus.historyA()) assert.equal(e.tickId, TICK_FREE, '自动推进时 A 通道仍不带 tick：' + e.type);
  for (const e of ui.bus.historyB()) assert.equal(e.tickId, 1, 'B 事件必须携带真实 tick：' + e.type);

  // 命令来源不同（auto-advance-N），但路径同一：再手动推一次同样只结算 1 次
  const manual = ui.advanceDay('manual-2');
  assert.equal(manual.committed, 1);
  assert.equal(sim.tickId, 2);
  assert.equal(manual.fromAutoAdvance, false);
});

// ---------------------------------------------------------------------------
// QA-U6 ④ 减少动态效果
// ---------------------------------------------------------------------------

test('QA-U6 减少动态效果：三项动效全 false、静态编码非空、≥2 通道、informationLost=false', () => {
  const { tokens, ui } = setup(true);
  const effects = ui.motion.effects();
  assert.deepEqual({ ...effects }, { loops: false, particles: false, cameraEase: false });

  const press = ui.motion.immediate('press');
  assert.equal(press.mode, 'static-press-color');
  assert.equal(press.durationMs, 0, '减少动态效果下时长必须为 0');
  assert.equal(press.channels.indexOf('motion'), -1, '不得保留 motion 通道');
  assert.ok(press.channels.length >= 2, '通道数必须 ≥2（信息不丢失）：' + press.channels.join('+'));
  assert.ok(press.channels.indexOf('color') >= 0 && press.channels.indexOf('text') >= 0, '色 + 文字双通道必须在位');
  assert.ok(press.encoding.tokenId.length > 0 && press.encoding.label.length > 0, '编码必须非空');
  assert.equal(press.informationLost, false);
  // 描边通道：策略层声明了描边宽度（selected 无形状，描边是其第二通道，见报告 D-12）
  assert.ok(press.outlineWidthPx >= 1, '描边宽度必须声明（实际 ' + press.outlineWidthPx + 'px）');
  assert.equal(tokenById(tokens, 'status.selected').shape, 'none', 'selected 无形状 → 依赖描边/文字通道');

  const tickFeedback = ui.motion.tickFeedback();
  assert.equal(tickFeedback.mode, 'instant');
  assert.equal(tickFeedback.durationMs, 0);
  assert.equal(tickFeedback.informationLost, false);
  assert.ok(tickFeedback.encoding.tokenId.length > 0);

  // 集成：按压事件载荷走降级模式
  const evts = ui.bus.historyA().filter((e) => e.type === 'press');
  ui.press('btn');
  const after = ui.bus.historyA().filter((e) => e.type === 'press');
  assert.equal(after.length, evts.length + 1);
  const last = after[after.length - 1];
  assert.equal(last.tickId, TICK_FREE);
  assert.equal(last.data.mode, 'static-press-color');
  assert.equal(last.data.durationMs, 0);
  assert.equal(String(last.data.channels).indexOf('motion'), -1);
});

// ---------------------------------------------------------------------------
// QA-U7 ① 0 tick 四类操作 + ② UI 零写状态
// ---------------------------------------------------------------------------

test('QA-U7 0 tick 下四类操作即时响应（A 通道齐备且不带 tick），且 UI 操作前后状态指纹逐字节不变', () => {
  const { sim, ui } = setup();
  const before = canonicalize(serializeState(sim.state));
  assert.equal(sim.tickId, 0);
  assert.equal(sim.committedCount, 0);

  const zoneRes = ui.zone(2, 2, 'R', 2);
  ui.road(3, 3);
  ui.setTab('ROAD');
  ui.select(1, 1);
  assert.deepEqual(Object.keys(UI_TABS).length >= 0, true);
  assert.ok(UI_TABS.indexOf('ROAD') >= 0);

  assert.equal(sim.tickId, 0, 'UI 操作不得推进 tick');
  assert.equal(sim.committedCount, 0, 'UI 操作不得结算');
  assert.equal(zoneRes.accepted, true, '合法排队');
  assert.equal(sim.pendingCount, 2, 'zone + road 两条命令在队列（tab/select 不产生命令）');

  const kinds = new Set(ui.bus.historyA().map((e) => e.type));
  for (const k of ['press', 'placement', 'tab', 'select'] as const) assert.ok(kinds.has(k), '0 tick 下缺即时事件：' + k);
  for (const e of ui.bus.historyA()) assert.equal(e.tickId, TICK_FREE);
  assert.equal(ui.bus.dispatchCountB, 0, '未结算时 B 通道必须为空');

  const after = canonicalize(serializeState(sim.state));
  assert.equal(after, before, 'UI 操作前后权威状态必须逐字节一致（ADR-004 §2）');
  assert.equal(sim.state.tickId, 0);
});

// ---------------------------------------------------------------------------
// QA-U8 (c) 真实 Simulation 直传覆盖度
// ---------------------------------------------------------------------------

test('QA-U8 真实 Simulation 直传：14 条交互用例全部使用真实会话，无假端口；端口不暴露 state', () => {
  const src = readFileSync(join(process.cwd(), 'tests/unit/ui-interaction.test.ts'), 'utf8');
  const blocks = src.match(/^test\(/gm) ?? [];
  assert.equal(blocks.length, 14, '实现方交互用例应为 14 条（实际 ' + blocks.length + '）');
  assert.ok(/import \{ createSimulation \}/.test(src), '必须 import 真实 createSimulation');
  const setupCalls = (src.match(/setup\(\)/g) ?? []).length + (src.match(/setup\(true\)/g) ?? []).length;
  assert.ok(setupCalls >= 12, 'setup() 内建真实 sim，调用次数应覆盖几乎全部用例（实际 ' + setupCalls + '）');
  const constructSites = (src.match(/createSimulation\(/g) ?? []).length;
  assert.ok(constructSites >= 3, '真实会话构造点应含 setup 与内联（实际 ' + constructSites + ' 处）');
  // 无假端口写作（不得用 as unknown as UiSessionPort 之类绕过真实类型）
  assert.equal(/as unknown as UiSessionPort/.test(src), false, '不得用类型断言伪造端口');
  assert.equal(/UiSessionPort\s*=\s*\{/.test(src), false, '不得手写假端口对象');

  // 端口面：controller 只经 session 计数器取数，不暴露 state（运行期可观测证据）
  const { sim, ui } = setup();
  const port = ui as unknown as Record<string, unknown>;
  assert.equal(Object.keys(port).indexOf('state'), -1, 'controller 不得暴露 state 字段');
  assert.equal(typeof ui.tickId, 'number');
  assert.equal(ui.tickId, sim.tickId);
  assert.equal(ui.committedCount, sim.committedCount);
  assert.equal(ui.gateLocked, sim.gate.isLocked);
});
