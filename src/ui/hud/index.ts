/**
 * HC-01 · UI 层 · 竖屏 HUD 子模块入口（S-08）
 *
 * 只导出 `src/ui/hud/**`。应用侧 / 预览页从本文件取 HUD 能力：
 *
 * ```ts
 * const model = createHudViewModel({ projection });
 * const tabs = createBuildTabs();
 * const button = createEndDayButton({ controller });
 * const layout = createLayoutModel(profile, safeAreaProvider);
 * const legend = getFlowLegend();   // 只读 label，不碰字面令牌 id
 * // 组合根可注入渲染层真实图例：setFlowLegendProvider(() => buildFlowLegend(tokens));
 * ```
 *
 * 零依赖：不 import 引擎、不 import `tick-pipeline`、不读时钟。
 * 视觉色值 / 形状一律不在此出现——HUD 只消费枚举、label 与渲染层下发的
 * 不透明色块（`OpaqueSwatch`）。
 *
 * T-135：图例默认数据源已由渲染层 `buildFlowLegend` 下发（替换旧 mock 常量），
 * UI 自身不定义图例数据、不查语义令牌表。
 */

export * from './types.ts';
export * from './layout-profile.ts';
export * from './hud-view-model.ts';
export * from './build-tabs.ts';
export * from './budget-panel.ts';
export * from './legend.ts';
export * from './a11y.ts';
export * from './end-day-button.ts';
