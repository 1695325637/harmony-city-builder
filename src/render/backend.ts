/**
 * HC-01 · 渲染内核 · 渲染后端抽象（S-06）
 *
 * 引擎无关的最小后端接口：Cocos 适配（`cocos/cocos-backend.ts`）与浏览器 Canvas
 * 预览（`preview/app.mjs`）各自实现同一契约，渲染内核只依赖本接口。
 *
 * 深度语义：`setDepth(handle, depthKey)` 的入参即 `iso.depthKey` 的单调键，
 * 由 `compareDepth` 的唯一规则产生（art-bible §2.1：禁止逐对象手写 zIndex 例外）。
 */

/** 节点句柄（引擎侧对象由后端自行管理；内核不感知具体类型） */
export type RenderHandle = number;

export interface RenderBackend {
  /** 创建一个可绘制节点，返回句柄 */
  createNode(assetKey: string): RenderHandle;
  /** 赋帧（SpriteFrame / 图集切片）；帧键来自图集清单 `key` */
  setFrame(handle: RenderHandle, frameKey: string): void;
  setPosition(handle: RenderHandle, x: number, y: number): void;
  setScale(handle: RenderHandle, scale: number): void;
  /** 深度：升序 = 从远（上）到近（下）绘制；后端须按同一规则落到绘制顺序 */
  setDepth(handle: RenderHandle, depthKey: number): void;
  destroy(handle: RenderHandle): void;
  batchBegin(atlasId: string): void;
  batchEnd(): void;
}

/** 后端能力自述（用于验证记录 / 校准记录，不做门禁） */
export interface RenderBackendInfo {
  readonly name: string;
  /** 是否已在真实引擎环境验证（本机无 Cocos Creator，恒为 false，诚实标注） */
  readonly verifiedInEngine: boolean;
}
