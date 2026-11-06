/**
 * HC-01 · S-08 · HUD 控件单测（项 3 结束本日 / 项 4 建造Tab与预算面板 / 项 7 图例）
 *
 * 钉定：5 类建造 Tab 均带可读文字标签；预算面板只读投影不写；结束本日按钮
 * 唯一推进入口、结算期 gate 锁时连点不双结算、按压走 press 通道；图例只消费 label、
 * 不碰 flow.* 令牌。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDefaultConfig } from '../../src/core/config.ts';
import { createInitialState } from '../../src/core/schema.ts';
import { buildSemanticTokenMap } from '../../src/render/semantic-tokens.ts';
import {
  createBuildTabs,
  createBudgetPanel,
  createEndDayButton,
  createInteractionController,
  getFlowLegend,
  legendLabels,
  projectCityStateToBudget,
  type BudgetProjection,
  type UiSessionPort,
} from '../../src/ui/index.ts';

// ---------------------------------------------------------------------------
// 建造 Tab（项 4）
// ---------------------------------------------------------------------------

test('TAB-1 5 类建造 Tab 全部存在且均带可读中文标签（纯符号/单字母不算）', () => {
  const tabs = createBuildTabs().tabs();
  assert.equal(tabs.length, 5, 'MVP 5 类 Tab');
  const expected = ['R', 'C', 'I', 'ROAD', 'DEMOLISH'];
  assert.deepEqual(tabs.map((t) => t.id), expected);
  for (const t of tabs) {
    assert.ok(t.label.length > 1, 'Tab ' + t.id + ' 必须有可读标签');
    assert.notEqual(t.label, t.id, '标签不得只是 id（如 "R" 这种单字母）');
  }
});

test('TAB-2 切 Tab：active 跟踪且仅 1 个激活', () => {
  const bt = createBuildTabs({ activeTab: 'R' });
  assert.equal(bt.activeTab, 'R');
  bt.setActive('ROAD');
  assert.equal(bt.activeTab, 'ROAD');
  const views = bt.tabs();
  assert.equal(views.filter((v) => v.active).length, 1, '同屏仅 1 个激活 Tab');
  bt.setActive('NOPE' as never);
  assert.equal(bt.activeTab, 'ROAD', '非法 id 被忽略，激活态不变');
});

// ---------------------------------------------------------------------------
// 预算面板（项 4：只读投影）
// ---------------------------------------------------------------------------

test('BUD-1 预算面板只读投影：I/C_b/C_m/B 来自权威状态，无 setter', () => {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  state.budget.B = -20; // 测试夹具：读投影应能反映该值（UI 不写，这里是测试改夹具）
  const proj = projectCityStateToBudget(state);
  assert.equal(proj.B, -20);
  assert.equal(proj.I_t, state.budget.I_t);
  assert.equal(proj.C_b, state.budget.C_b_accum);
  assert.equal(proj.C_m, state.budget.C_m_accum);
  const panel = createBudgetPanel({ projection: proj });
  assert.equal(panel.B, -20);
  assert.equal(panel.isLow, true, 'B < 下限 → 预警');
  // 面板无任何可写入口（结构保证：仅 readonly getter）
  assert.ok(Object.getOwnPropertyNames(panel).every((p) => p !== 'setB' && p !== 'setBalance'));
});

test('BUD-2 预算未低于下限 → isLow=false', () => {
  const proj: BudgetProjection = { I_t: 10, C_b: 5, C_m: 3, B: 80 };
  assert.equal(createBudgetPanel({ projection: proj, lowThreshold: 0 }).isLow, false);
});

// ---------------------------------------------------------------------------
// 结束本日按钮（项 3：唯一推进 / 连点不双结算 / press 通道）
// ---------------------------------------------------------------------------

function fakeSessionMutable() {
  let advanced = 0;
  let locked = false;
  const session: UiSessionPort = {
    submit(): void {
      /* noop */
    },
    advanceDay(): { accepted: boolean; events: never[]; result: undefined } {
      if (locked) return { accepted: false, events: [], result: undefined };
      advanced++;
      return { accepted: true, events: [], result: undefined };
    },
    get gate(): { readonly isLocked: boolean } {
      return { isLocked: locked };
    },
    get pendingCount(): number {
      return 0;
    },
    get tickId(): number {
      return advanced;
    },
    get committedCount(): number {
      return advanced;
    },
  };
  return {
    session,
    getAdvanced: (): number => advanced,
    lock: (v: boolean): void => {
      locked = v;
    },
  };
}

function makeButton(reducedMotion = false) {
  const config = createDefaultConfig();
  const tokens = buildSemanticTokenMap(config.zoneTypes);
  const { session, getAdvanced, lock } = fakeSessionMutable();
  // 用真实 controller 包裹 fake session（验证按钮只委托、不另造推进逻辑）
  const controller = createInteractionController({ session, tokens, reducedMotion });
  const button = createEndDayButton({ controller });
  return { button, controller, getAdvanced, lock };
}

test('END-1 阶段由 gate 派生：未锁 idle、锁定 settling', () => {
  const { button, lock } = makeButton();
  assert.equal(button.phase, 'idle');
  lock(true);
  assert.equal(button.phase, 'settling', 'gate 锁定 → settling');
  lock(false);
  assert.equal(button.phase, 'idle');
});

test('END-2 按压反馈走 press 通道，减动效时降为静态按压色（tokenId 仍 status.selected）', () => {
  const { button, controller } = makeButton(true); // reducedMotion
  button.press();
  const presses = controller.bus.historyA().filter((e) => e.type === 'press' && e.target === 'end-day');
  assert.equal(presses.length, 1, '按压产生 press 通道事件');
  assert.equal(presses[0].encoding!.tokenId, 'status.selected', '按压用状态组（瞬态反馈例外口径）');
  // 减动效：mode 应为 static-press-color（瞬态反馈，非信息态）
  assert.equal(presses[0].data!.mode, 'static-press-color');
});

test('END-3 连点不双结算：结算期 gate 锁时，两次 activate 都拒且不调用 session.advanceDay', () => {
  const { button, lock, getAdvanced } = makeButton();
  lock(true); // 模拟结算中
  const a = button.activate('k1');
  const b = button.activate('k2');
  assert.equal(getAdvanced(), 0, 'gate 锁期间 activate 不推进（不双结算）');
  assert.equal(a.accepted, false);
  assert.equal(b.accepted, false);
  assert.equal(a.committed, 0);
  assert.equal(a.visualEmitted, true, '结算期纯视觉反馈仍响应（ADR-004 §2 子决策 4）');
});

test('END-4 未锁时 activate 委托 controller.advanceDay 且通过', () => {
  const { button, getAdvanced } = makeButton();
  const r = button.activate('k1');
  assert.equal(r.accepted, true);
  assert.equal(getAdvanced(), 1, '未锁时推进恰好一次');
});

// ---------------------------------------------------------------------------
// 三态图例（项 7：只消费 label，不碰 flow.* 令牌）
// ---------------------------------------------------------------------------

test('LEG-1 图例三态为枚举 clear/slow/congested（非 flow.* 令牌 id），label 为畅/缓/堵', () => {
  const legend = getFlowLegend();
  assert.equal(legend.length, 3);
  const states = legend.map((l) => l.flowState).sort();
  assert.deepEqual(states, ['clear', 'congested', 'slow'], '枚举值，无 flow. 前缀');
  assert.deepEqual(legendLabels(), ['畅', '缓', '堵']);
});

test('LEG-2 图例色块为不透明 OpaqueSwatch：UI 只读 label，不解析 paint 内部', () => {
  for (const item of getFlowLegend()) {
    // 不透明契约：paint 为 unknown，UI 不得取其 color/shape 字段（由静态扫描钉死）
    assert.equal(item.swatch.label.length > 0, true, 'label 可读');
    // T-135：paint 由渲染层用真实语义令牌填充，对 UI 仍是 unknown（整块透传、不解析）
    assert.equal(typeof item.swatch.paint === 'object' || item.swatch.paint === null, true);
  }
});
