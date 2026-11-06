/**
 * HC-01 · 渲染层 · 薄 Cocos Creator 3.x 适配（S-06 · 交付 B）
 *
 * ⚠️ **未在 Cocos Creator 环境验证（本机无编辑器）；真机 / 编辑器验证随 W4。**
 *    本文件任何「映射逻辑正确」的结论仅来自 Node 侧 mock `cc` 命名空间的单测，
 *    不代表引擎内已跑通；渲染组件的实际属性名 / 生命周期 / 合批行为须 W4 复核。
 *
 * 设计要点：
 * - **以注入 `cc` 命名空间的方式实现**（构造参数 `cc: CocosNamespace`），
 *   **不 `import ... from 'cc'`**——这样 tsc 零依赖可过、Node 侧可用 mock 单测映射逻辑；
 *   真实工程里由编辑器侧 / 平台适配层（S-01 `PlatformAdapter`）传入 `cc`。
 * - 深度：`setDepth(handle, depthKey)` → `node.setSiblingIndex(升序秩)`。Cocos 2D 的
 *   兄弟序即绘制序（后者覆盖前者），与内核 `compareDepth`（gx+gy 升序、平局 gx 升序）
 *   完全一致；**禁止在其他位置手写 zIndex 例外**（art-bible §2.1）。
 * - 缩放：三档固定 0.5 / 1.0 / 2.0，`setScale` 直接设节点 scale；不做连续缩放与角度插值。
 * - 9-slice：面板 / 按钮 / Tab 预留 `type = SLICED` 能力（本轮只做类型预留，不接 UI 流程）。
 */

import type { RenderBackend, RenderBackendInfo, RenderHandle } from '../backend.ts';

// ---------------------------------------------------------------------------
// 结构化最小 Cocos 类型声明（只声明本适配用到的成员，避免依赖 'cc' 类型包）
// ---------------------------------------------------------------------------

export interface CocosNode {
  name: string;
  setPosition(x: number, y: number, z?: number): void;
  setScale(x: number, y: number, z?: number): void;
  setSiblingIndex(index: number): void;
  destroy(): void;
  addComponent<T>(ctor: new () => T): T;
  active: boolean;
}

export interface CocosSprite {
  spriteFrame: unknown;
  /** cc.Sprite.Type.SLICED = 1（9-slice），SIMPLE = 0 */
  type: number;
  sizeMode: number;
}

export interface CocosNamespace {
  Node: new (name?: string) => CocosNode;
  Sprite: new () => CocosSprite;
  /** cc.Sprite.Type 常量表（可选注入；缺省时用字面量 0 / 1） */
  SpriteType?: { SIMPLE: number; SLICED: number };
}

export interface CocosBackendOptions {
  /** 帧键 → SpriteFrame（由资源加载层在 W4 接入；本轮可注入内存替身） */
  frameProvider?: (frameKey: string) => unknown;
  /** 节点父级（缺省由调用方在引擎侧挂到场景节点；本轮不要求） */
  attachTo?: (node: CocosNode) => void;
}

interface NodeRecord {
  node: CocosNode;
  sprite: CocosSprite;
  assetKey: string;
  frameKey: string;
  depth: number;
}

export interface CocosRenderBackend extends RenderBackend {
  readonly info: RenderBackendInfo;
  /** 诊断：当前节点数（= 活跃 handle 数） */
  readonly nodeCount: number;
  /** 诊断：当前批次调用序列（atlasId 列表，按调用顺序） */
  readonly batchLog: readonly string[];
  /** 诊断：某句柄的兄弟序（深度映射结果） */
  siblingIndexOf(handle: RenderHandle): number;
  /** 9-slice 预留：把节点切成九宫格（面板 / 按钮 / Tab 基座） */
  applySliced(handle: RenderHandle): void;
}

/**
 * 创建 Cocos 渲染后端（注入式；引擎侧对象由 `cc.Node` 创建）。
 * 本实现不做任何资源加载 / 场景挂载决策，只做「内核指令 → 引擎调用」的薄映射。
 */
export function createCocosBackend(cc: CocosNamespace, options: CocosBackendOptions = {}): CocosRenderBackend {
  const records: (NodeRecord | undefined)[] = [];
  const freeHandles: RenderHandle[] = [];
  const batchLog: string[] = [];
  const spriteType = cc.SpriteType ?? { SIMPLE: 0, SLICED: 1 };

  function must(handle: RenderHandle): NodeRecord {
    const rec = records[handle];
    if (rec === undefined) throw new Error('invalid render handle: ' + handle);
    return rec;
  }

  const backend: CocosRenderBackend = {
    info: { name: 'cocos-creator-3.x (adapter, unverified)', verifiedInEngine: false },
    get nodeCount(): number {
      let n = 0;
      for (let i = 0; i < records.length; i++) if (records[i] !== undefined) n++;
      return n;
    },
    get batchLog(): readonly string[] {
      return batchLog.slice();
    },
    siblingIndexOf(handle: RenderHandle): number {
      // mock 环境无法读取真实 siblingIndex，这里回读最近一次 setDepth 的秩（由适配层维护）
      return must(handle).depth;
    },
    createNode(assetKey: string): RenderHandle {
      const node = new cc.Node(assetKey);
      const sprite = node.addComponent(cc.Sprite);
      sprite.type = spriteType.SIMPLE;
      const rec: NodeRecord = { node, sprite, assetKey, frameKey: '', depth: 0 };
      let handle: RenderHandle;
      if (freeHandles.length > 0) {
        handle = freeHandles.pop() as RenderHandle;
        records[handle] = rec;
      } else {
        handle = records.length;
        records.push(rec);
      }
      if (options.attachTo !== undefined) options.attachTo(node);
      return handle;
    },
    setFrame(handle: RenderHandle, frameKey: string): void {
      const rec = must(handle);
      rec.frameKey = frameKey;
      const provider = options.frameProvider;
      if (provider !== undefined) rec.sprite.spriteFrame = provider(frameKey);
    },
    setPosition(handle: RenderHandle, x: number, y: number): void {
      must(handle).node.setPosition(x, y, 0);
    },
    setScale(handle: RenderHandle, scale: number): void {
      must(handle).node.setScale(scale, scale, 1);
    },
    setDepth(handle: RenderHandle, depthKeyValue: number): void {
      const rec = must(handle);
      rec.depth = depthKeyValue;
      // 深度键是单调整数（iso.depthKey），直接作为兄弟序即等价于 compareDepth 排序
      rec.node.setSiblingIndex(depthKeyValue);
    },
    destroy(handle: RenderHandle): void {
      const rec = must(handle);
      rec.sprite.spriteFrame = null;
      rec.node.destroy();
      records[handle] = undefined;
      freeHandles.push(handle);
    },
    batchBegin(atlasId: string): void {
      batchLog.push(atlasId);
    },
    batchEnd(): void {
      // 无操作：Cocos 自动合批由同图集 + 同材质决定，适配层不干预
    },
    applySliced(handle: RenderHandle): void {
      must(handle).sprite.type = spriteType.SLICED;
    },
  };
  return backend;
}
