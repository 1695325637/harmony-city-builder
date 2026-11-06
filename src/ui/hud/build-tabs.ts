/**
 * HC-08 · UI 层 · 底部建造 Tab（S-08 项 4：5 Tab + 文字标签）
 *
 * 权威口径（只读引用）：
 * - ux-spec §2.1 底部 5 类 Tab：居住 / 商业 / 产业 / 道路 / 拆除；
 * - §3.3「同屏数据面板 ≤1、议题 2~4」与 a11y「每个可交互控件必须有可读文字标签」
 *   （纯数字 / 符号 / 单字母不算）。
 *
 * 纪律：Tab 只描述「选哪个建造类别 + 文字标签」，不写任何权威状态、
 * 不持有 session；实际的命令派发由 `interaction-controller` 承担。
 */

import type { UiTabId } from '../interaction-controller.ts';

export interface BuildTabDef {
  readonly id: UiTabId;
  /** 可读中文标签（a11y 硬要求：不得是纯符号 / 单字母 / 纯数字） */
  readonly label: string;
}

/** 5 类建造 Tab（MVP，ux-spec §2.1）+ 各自文字标签 */
export const BUILD_TABS: readonly BuildTabDef[] = Object.freeze([
  { id: 'R', label: '居住' },
  { id: 'C', label: '商业' },
  { id: 'I', label: '产业' },
  { id: 'ROAD', label: '道路' },
  { id: 'DEMOLISH', label: '拆除' },
]);

export interface BuildTabView {
  readonly id: UiTabId;
  readonly label: string;
  readonly active: boolean;
}

export interface BuildTabs {
  readonly activeTab: UiTabId;
  setActive(tab: UiTabId): void;
  /** 全部 5 个 Tab 的视图（含文字标签 + 激活态）——a11y 遍历据此检查标签 */
  tabs(): readonly BuildTabView[];
  /** 取单个 Tab 视图（不存在返回 undefined，便于守卫非法 id） */
  get(tab: UiTabId): BuildTabView | undefined;
}

export interface BuildTabsDeps {
  readonly activeTab?: UiTabId;
}

export function createBuildTabs(deps: BuildTabsDeps = {}): BuildTabs {
  let active: UiTabId = deps.activeTab ?? 'R';
  const known = new Set<UiTabId>(['R', 'C', 'I', 'ROAD', 'DEMOLISH']);

  const tabs = (): readonly BuildTabView[] =>
    BUILD_TABS.map((def): BuildTabView => Object.freeze({ id: def.id, label: def.label, active: def.id === active }));

  const api: BuildTabs = {
    get activeTab(): UiTabId {
      return active;
    },
    setActive(tab: UiTabId): void {
      if (!known.has(tab)) return; // 非法 id 静默忽略（不抛，避免触摸态下崩）
      active = tab;
    },
    tabs,
    get(tab: UiTabId): BuildTabView | undefined {
      return tabs().find((t) => t.id === tab);
    },
  };
  return api;
}
