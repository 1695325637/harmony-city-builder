/**
 * HC-01 · UI 层 · 乐观视图叠加层（S-07）
 *
 * 权威口径（只读引用）：
 * - ADR-004 §2 子决策 2 / 3：UI 只持有「VM = 快照只读投影 + 本地乐观叠加」，
 *   **绝不持有或修改权威游戏状态**；命令在 P1 被判非法 → `BudgetRejected` →
 *   UI 撤下乐观视图并给负向形状编码。
 * - `design/art/art-bible.md` §8.3：落位 = 分区色块 + 图案 + 落位描边，
 *   合法绿 / 非法红斜纹预览；拆除 = 去饱和 + 收缩。
 * - ux-spec §3.1：V3 划（落位）/ V4 拨（扣减预览 + `I_f` 高亮）/ 选中描边 /
 *   Tab 切换 / 面板展开。
 *
 * 纪律（本文件是「零写状态」的结构保证）：
 * - 本文件**不 import `core/simulation` 任何状态结构**，只 import `Command` 类型；
 *   拿不到 `CityState`，就不可能写它（静态扫描用例钉定）。
 * - 颜色 / 形状一律 `tokenById(tokens, id)` 读语义令牌，本文件零十六进制、
 *   零形状字面值（令牌形状唯一化改造不影响本层）。
 * - `compose()` 返回冻结只读视图，且不改写 baseVM（用例以指纹断言）。
 */

import type { Command } from '../core/types.ts';
import { tokenById, type SemanticTokenMap } from '../render/semantic-tokens.ts';
import { TICK_FREE, type FeedbackEmitterA, type VisualEncoding } from './feedback-bus.ts';

// ---------------------------------------------------------------------------
// 即时反馈的语义色口径 —— 主理人裁定 2026-11-06（T-131 后修正版）· 勿改
//
// 界线在「**可用性预检** vs **结算结论**」，**不在**「用不用语义色」：
// - 通道 A（即时，默认暂停态即可发生）：只表达「**这次操作能不能落**」——
//   合法 → `status.positive`（合法绿 ✓）、非法 → `status.negative`（非法红斜纹）。
//   依据 art-bible §8.3 + ux-spec §3.1 V3 的明文指定，属**前置合法性反馈**，
//   不是模拟结论；故本文件用 status.positive / status.negative 做落位预览是正确的。
// - 通道 B（仅 V6「结束本日」结算后）：才表达「**这座城市现在怎么样**」——
//   通勤三态（渲染层自用 flow 令牌）、预算 / 满意度 `status.warning` 等，
//   只由 Δ / 归因 / 事件驱动。
// - **禁止**：通道 A 使用 flow 三态令牌；或用状态结论色表达**结算后的状态**
//   （例如铺路瞬间就把新路画成拥堵红）。
// - 出处：art-bible §8.3 + ux-spec §3.1 V3；参见
//   `design/art/reviews/render-s06-art-review.md` §口径清单 **口径 4**
//   「可用性预检 ≠ 结算结论（主理人 T-134 裁定）」。
// - **不要「为了中性」把落位预览改成 base 组色**——那会违反 §8.3（好心改坏）。
//   门禁：`tests/unit/ui-token-contract.test.ts` 断言落位编码恒为 `status.positive`。
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 语义令牌读取（唯一色 / 形状来源）
// ---------------------------------------------------------------------------

/**
 * 按令牌 id 取视觉编码（色 + 形状 + 文字三通道）。
 * 令牌缺失时回退到 `base.tile` 中性编码并标记 `tokenId` 为回退值——
 * 不静默借用分区色或状态色（art-bible §3.4 四重隔离）。
 */
export function encodingOf(tokens: SemanticTokenMap, tokenId: string, fallbackId = 'base.tile'): VisualEncoding {
  const resolved = tokens.byId[tokenId] === undefined ? fallbackId : tokenId;
  const t = tokenById(tokens, resolved);
  return Object.freeze({ tokenId: t.id, color: t.color, shape: t.shape, label: t.label });
}

// ---------------------------------------------------------------------------
// 叠加项
// ---------------------------------------------------------------------------

/** 叠加项类别（与 ux-spec §3.1 的即时反馈形式一一对应；按压态由事件承载，不是叠加项） */
export type OverlayKind = 'placement' | 'demolition' | 'fund-preview' | 'selection' | 'tab' | 'panel';

/** 作用位置：格（画布）或 HUD（面板 / Tab / 按钮） */
export type OverlayScope = 'cell' | 'hud';

export type PreviewLegality = 'legal' | 'illegal' | 'unknown';

export interface PreviewHint {
  /**
   * 可用性预检结论（ADR-004 §5「负面 / 成本」：为减少「先亮起又被撤下」的闪烁，
   * 允许调用方先做**只读**预检）。预检**不是裁决**——P1 仍是唯一裁决方。
   */
  readonly legality?: PreviewLegality;
}

export interface OverlayItem {
  readonly commandId: string;
  readonly kind: OverlayKind;
  readonly scope: OverlayScope;
  /** 命令类别（HUD 类动作为 'UI'，因为不产生 Command） */
  readonly commandKind: Command['kind'] | 'UI';
  readonly x: number;
  readonly y: number;
  readonly density: number;
  readonly amountCU: number;
  /** 预览用的分区色令牌 id（`zone.<id>`；落位色块填充） */
  readonly zoneTokenId: string;
  /** 状态语义编码（描边 / 形状 / 文字；来自语义令牌） */
  readonly encoding: VisualEncoding;
  readonly legality: PreviewLegality;
  /** 该叠加项是否「会改变权威状态」（用于区分纯视觉动作与改状态动作） */
  readonly mutatesAuthority: boolean;
}

/** 回滚标记：只作负向反馈，**不是**残留的叠加项（用例断言 active 中不得有它） */
export interface RollbackMarker {
  readonly commandId: string;
  readonly reason: string;
  readonly encoding: VisualEncoding;
  /** 撤销时是否确实撤下了一个仍在生效的叠加项 */
  readonly removed: boolean;
  /** 回滚属通道 A（即时负向反馈），tickId 恒为 TICK_FREE */
  readonly tickId: number;
}

/** 纯视觉 UI 动作（不产生 Command，不改权威状态） */
export type UiAction =
  | { readonly kind: 'select'; readonly target: string; readonly x: number; readonly y: number }
  | { readonly kind: 'tab'; readonly target: string }
  | { readonly kind: 'panel'; readonly target: string };

const UI_ACTION_KIND: Readonly<Record<UiAction['kind'], OverlayKind>> = Object.freeze({
  select: 'selection',
  tab: 'tab',
  panel: 'panel',
});

export interface OptimisticLayer {
  /** 当前生效的叠加项数（回滚后必须归零，不得残留） */
  readonly size: number;
  /** 累计应用次数（含幂等命中） */
  readonly appliedCount: number;
  /** 提交型命令 → 叠加项（V3 / V5 / V4；落位 / 拆除 / 扣减预览） */
  apply(command: Command, hint?: PreviewHint): OverlayItem;
  /** 纯视觉动作 → 叠加项（选中 / Tab / 面板 / 按压） */
  applyUi(action: UiAction): OverlayItem;
  /** 撤下某命令的叠加项并派发 `rollback`（A 通道）+ 负向形状编码 */
  rollback(commandId: string, reason: string): RollbackMarker;
  /**
   * 静默撤下叠加项（**不**派发 rollback）：用于 UI 自身的替换语义，
   * 例如选中态切换、L1/L2 面板互斥（ux-spec §2.2）。这不是回滚，不产生负向反馈。
   */
  discard(commandId: string): boolean;
  active(): readonly OverlayItem[];
  itemFor(commandId: string): OverlayItem | undefined;
  /** 格叠加项查询（后写覆盖先写，与绘制顺序一致） */
  overlayAt(x: number, y: number): OverlayItem | undefined;
  rollbacks(): readonly RollbackMarker[];
  clearRollbacks(): void;
  /** 清空叠加项（可保留回滚标记用于负向反馈播放） */
  clear(): void;
}

export interface OptimisticLayerDeps {
  readonly tokens: SemanticTokenMap;
  readonly bus: FeedbackEmitterA;
}

/** 令牌 id：分区落位填充色 */
function zoneTokenIdFor(zoneId: string): string {
  return zoneId === '' || zoneId === 'EMPTY' || zoneId === 'ROAD' ? 'base.tile' : 'zone.' + zoneId;
}

/** 令牌 id：落位 / 拆除的状态语义编码（正 / 负 / 提示） */
function legalityTokenId(legality: PreviewLegality): string {
  if (legality === 'illegal') return 'status.negative';
  if (legality === 'unknown') return 'status.warning';
  return 'status.positive';
}

/**
 * 令牌 id：纯视觉交互态（选中 / Tab / 面板 / 按压）。
 * 用状态组 `status.selected`（主色 + 「选中 / 焦点」标签），**不假设存在 `base.primary`**
 * ——渲染层正在做令牌唯一化（(color, shape) 全局唯一），基础组可能只保留中性色；
 * 因此这里给出兜底 id `base.ink`，令牌缺失时不至于抛错也不借用分区色。
 */
const UI_STATE_TOKEN = 'status.selected';
const UI_STATE_FALLBACK_TOKEN = 'base.ink';

function uiActionTokenId(action: UiAction): string {
  switch (action.kind) {
    case 'select':
    case 'tab':
      return UI_STATE_TOKEN;
    case 'panel':
    default:
      return UI_STATE_TOKEN;
  }
}

function uiActionCommandId(action: UiAction): string {
  return 'ui:' + action.kind + ':' + action.target;
}

export function createOptimisticLayer(deps: OptimisticLayerDeps): OptimisticLayer {
  const { tokens, bus } = deps;
  const items = new Map<string, OverlayItem>();
  let rollbackMarkers: RollbackMarker[] = [];
  let appliedCount = 0;

  const layer: OptimisticLayer = {
    get size(): number {
      return items.size;
    },
    get appliedCount(): number {
      return appliedCount;
    },
    apply(command: Command, hint: PreviewHint = {}): OverlayItem {
      appliedCount++;
      const existing = items.get(command.idempotencyKey);
      if (existing !== undefined) return existing; // 幂等：同 key 连点不叠两层
      const kind: OverlayKind =
        command.kind === 'FUND'
          ? 'fund-preview'
          : command.kind === 'ZONE' && (command.zoneId === 'EMPTY' || command.zoneId === '')
            ? 'demolition'
            : 'placement';
      const legality: PreviewLegality = hint.legality ?? 'legal';
      const item: OverlayItem = Object.freeze({
        commandId: command.idempotencyKey,
        kind,
        scope: 'cell' as const,
        commandKind: command.kind,
        x: command.x,
        y: command.y,
        density: command.density,
        amountCU: command.amountCU,
        zoneTokenId: zoneTokenIdFor(command.zoneId),
        encoding: encodingOf(tokens, legalityTokenId(legality)),
        legality,
        mutatesAuthority: true,
      });
      items.set(item.commandId, item);
      bus.emitA(kind === 'placement' ? 'placement' : 'highlight', {
        action: command.kind,
        target: command.x + ',' + command.y,
        encoding: item.encoding,
        data: { kind, commandId: item.commandId, legality, zoneTokenId: item.zoneTokenId },
      });
      return item;
    },
    applyUi(action: UiAction): OverlayItem {
      appliedCount++;
      const commandId = uiActionCommandId(action);
      const existing = items.get(commandId);
      if (existing !== undefined) return existing;
      const kind = UI_ACTION_KIND[action.kind];
      const cellish = action.kind === 'select';
      const px = action.kind === 'select' ? action.x : 0;
      const py = action.kind === 'select' ? action.y : 0;
      const item: OverlayItem = Object.freeze({
        commandId,
        kind,
        scope: cellish ? ('cell' as const) : ('hud' as const),
        commandKind: 'UI' as const,
        x: px,
        y: py,
        density: 0,
        amountCU: 0,
        zoneTokenId: 'base.tile',
        encoding: encodingOf(tokens, uiActionTokenId(action), UI_STATE_FALLBACK_TOKEN),
        legality: 'legal' as const,
        // 纯视觉动作：不产生 Command、不改权威状态（结算期间也必须响应）
        mutatesAuthority: false,
      });
      items.set(item.commandId, item);
      const eventType =
        action.kind === 'select' ? ('select' as const) : action.kind === 'tab' ? ('tab' as const) : ('panel-open' as const);
      bus.emitA(eventType, {
        action: action.kind,
        target: action.target,
        encoding: item.encoding,
        data: { kind, commandId },
      });
      return item;
    },
    rollback(commandId: string, reason: string): RollbackMarker {
      const removed = items.delete(commandId);
      const marker: RollbackMarker = Object.freeze({
        commandId,
        reason,
        // 负向形状编码：形状 / 色值均取自 `status.negative` 令牌，不写死 ✕
        encoding: encodingOf(tokens, 'status.negative'),
        removed,
        tickId: TICK_FREE,
      });
      rollbackMarkers = rollbackMarkers.concat([marker]);
      if (rollbackMarkers.length > 64) rollbackMarkers = rollbackMarkers.slice(-64);
      bus.emitA('rollback', {
        action: 'rollback',
        target: commandId,
        encoding: marker.encoding,
        data: { reason, removed },
      });
      return marker;
    },
    discard(commandId: string): boolean {
      return items.delete(commandId);
    },
    active(): readonly OverlayItem[] {
      return Array.from(items.values());
    },
    itemFor(commandId: string): OverlayItem | undefined {
      return items.get(commandId);
    },
    overlayAt(x: number, y: number): OverlayItem | undefined {
      let found: OverlayItem | undefined;
      const list = items.values();
      for (const item of list) {
        if (item.scope === 'cell' && item.x === x && item.y === y) found = item;
      }
      return found;
    },
    rollbacks(): readonly RollbackMarker[] {
      return rollbackMarkers;
    },
    clearRollbacks(): void {
      rollbackMarkers = [];
    },
    clear(): void {
      items.clear();
    },
  };
  return layer;
}

// ---------------------------------------------------------------------------
// 只读合成分解视图
// ---------------------------------------------------------------------------

export interface ComposedView<TBase> {
  /** 权威只读投影（原样引用，**不被改写**） */
  readonly base: TBase;
  readonly overlays: readonly OverlayItem[];
  readonly rollbacks: readonly RollbackMarker[];
  /** 结构标记：合成视图只读 */
  readonly readOnly: true;
  overlayAt(x: number, y: number): OverlayItem | undefined;
}

/**
 * `VM(快照只读投影) + 本地乐观叠加 = 渲染唯一输入`（ADR-004 §2）。
 * 纯函数：不改写 baseVM、不触碰 layer 内部状态（返回快照数组）。
 */
export function compose<TBase extends object>(
  baseVM: TBase,
  layer: Pick<OptimisticLayer, 'active' | 'rollbacks'>,
): ComposedView<TBase> {
  const overlays = layer.active();
  const rollbacks = layer.rollbacks();
  return Object.freeze({
    base: baseVM,
    overlays,
    rollbacks,
    readOnly: true as const,
    overlayAt(x: number, y: number): OverlayItem | undefined {
      let found: OverlayItem | undefined;
      for (let i = 0; i < overlays.length; i++) {
        const item = overlays[i];
        if (item.scope === 'cell' && item.x === x && item.y === y) found = item;
      }
      return found;
    },
  });
}
