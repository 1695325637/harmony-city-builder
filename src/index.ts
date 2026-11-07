/**
 * HC-01 纯逻辑层 · 对外统一导出
 *
 * 零依赖：Node 22 内置类型剥离 + node:test 即可运行，不需要 Cocos Creator /
 * HarmonyOS SDK / DevEco Studio / 真机，也不需要 npm 安装任何包。
 */

export * from './core/types.ts';
export * from './core/config.ts';
export * from './core/schema.ts';
export * from './simulation/commands.ts';
export * from './simulation/snapshot.ts';
export * from './simulation/traffic.ts';
export * from './simulation/tick-pipeline.ts';
export * from './simulation/session.ts';
export * from './simulation/rollback.ts';
export * from './save/index.ts';

// 渲染层（S-06）：引擎无关内核 + 注入式 Cocos 适配（不 import 'cc'）
export * from './render/iso.ts';
export * from './render/view-model.ts';
export * from './render/semantic-tokens.ts';
export * from './render/atlas.ts';
export * from './render/asset-naming.ts';
export * from './render/texture-format.ts';
export * from './render/draw-list.ts';
export * from './render/flow-legend.ts';
export * from './render/degradation-plan.ts';
export * from './render/backend.ts';
export * from './render/cocos/cocos-backend.ts';

// 组合根（S-12）：把结算编排 / 冷归档 / 存档服务接成一条闭环（引擎无关、注入式介质）
export * from './composition.ts';
