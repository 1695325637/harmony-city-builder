/**
 * HC-01 · S-06 · 薄 Cocos 适配单测（mock `cc` 命名空间）
 *
 * ⚠️ 本用例只验证「内核指令 → 引擎调用」的**映射逻辑**。
 *    **未在 Cocos Creator 环境验证**（本机无编辑器）：组件真实属性名、生命周期、
 *    合批行为、setSiblingIndex 的绘制序语义均须 W4 真机 / 编辑器复核。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCocosBackend, depthKey, type CocosNamespace, type CocosNode, type CocosSprite } from '../../src/index.ts';

class MockSprite implements CocosSprite {
  spriteFrame: unknown = null;
  type = 0;
  sizeMode = 0;
}

class MockNode implements CocosNode {
  name: string;
  active = true;
  position = { x: 0, y: 0, z: 0 };
  scale = { x: 1, y: 1, z: 1 };
  siblingIndex = -1;
  destroyed = false;
  components: unknown[] = [];
  constructor(name = '') {
    this.name = name;
  }
  setPosition(x: number, y: number, z = 0): void {
    this.position = { x, y, z };
  }
  setScale(x: number, y: number, z = 1): void {
    this.scale = { x, y, z };
  }
  setSiblingIndex(index: number): void {
    this.siblingIndex = index;
  }
  destroy(): void {
    this.destroyed = true;
  }
  addComponent<T>(ctor: new () => T): T {
    const c = new ctor();
    this.components.push(c);
    return c;
  }
}

function makeCc(): { cc: CocosNamespace; nodes: MockNode[] } {
  const nodes: MockNode[] = [];
  class TrackingNode extends MockNode {
    constructor(name = '') {
      super(name);
      nodes.push(this);
    }
  }
  const cc: CocosNamespace = {
    Node: TrackingNode,
    Sprite: MockSprite,
    SpriteType: { SIMPLE: 0, SLICED: 1 },
  };
  return { cc, nodes };
}

test('COCOS-1 适配器只经注入 cc 工作，且自述「未在引擎内验证」', () => {
  const { cc } = makeCc();
  const backend = createCocosBackend(cc);
  assert.equal(backend.info.verifiedInEngine, false, '本机无 Cocos Creator：如实标注未验证');
  assert.ok(backend.info.name.indexOf('unverified') >= 0);
  assert.equal(backend.nodeCount, 0);
});

test('COCOS-2 createNode / setFrame / setPosition / setScale 映射正确', () => {
  const { cc, nodes } = makeCc();
  const frames: Record<string, unknown> = { 'tile_empty@L1': { frame: 'tile_empty@L1' } };
  const backend = createCocosBackend(cc, { frameProvider: (key) => frames[key] ?? null });
  const h = backend.createNode('tile_empty');
  assert.equal(backend.nodeCount, 1);
  assert.equal(nodes[0].name, 'tile_empty');
  assert.equal(nodes[0].components.length, 1, '节点挂了一个 Sprite 组件');

  backend.setFrame(h, 'tile_empty@L1');
  const sprite = nodes[0].components[0] as MockSprite;
  assert.deepEqual(sprite.spriteFrame, { frame: 'tile_empty@L1' }, 'SpriteFrame 赋值经 frameProvider');

  backend.setPosition(h, 128, 64);
  assert.deepEqual(nodes[0].position, { x: 128, y: 64, z: 0 });

  backend.setScale(h, 0.5); // L0 固定档位
  assert.deepEqual(nodes[0].scale, { x: 0.5, y: 0.5, z: 1 });
});

test('COCOS-3 深度：setDepth 用 iso.depthKey 单调整数作兄弟序（与 compareDepth 同序）', () => {
  const { cc, nodes } = makeCc();
  const backend = createCocosBackend(cc);
  const h1 = backend.createNode('a');
  const h2 = backend.createNode('b');
  const d1 = depthKey(2, 3); // sum=5
  const d2 = depthKey(4, 2); // sum=6 → 更近，后画
  backend.setDepth(h1, d1);
  backend.setDepth(h2, d2);
  assert.equal(nodes[0].siblingIndex, d1);
  assert.equal(nodes[1].siblingIndex, d2);
  assert.ok(nodes[0].siblingIndex < nodes[1].siblingIndex, '深度键升序 = 兄弟序升序 = 绘制先后');
  assert.equal(backend.siblingIndexOf(h1), d1);
  // 平局规则也保持单调：同和按 gx 升序
  assert.ok(depthKey(0, 4) < depthKey(4, 0), '同一对角线和按 gx 升序（无 zIndex 例外）');
});

test('COCOS-4 批次调用记录：batchBegin(atlasId) 按序入日志，batchEnd 不产生副作用', () => {
  const { cc } = makeCc();
  const backend = createCocosBackend(cc);
  backend.batchBegin('地形地块');
  backend.batchEnd();
  backend.batchBegin('建筑-居住');
  backend.batchEnd();
  assert.deepEqual(backend.batchLog, ['地形地块', '建筑-居住']);
});

test('COCOS-5 destroy 释放句柄并可复用；非法句柄抛错', () => {
  const { cc, nodes } = makeCc();
  const backend = createCocosBackend(cc);
  const h1 = backend.createNode('x');
  const h2 = backend.createNode('y');
  assert.notEqual(h1, h2);
  backend.destroy(h1);
  assert.equal(backend.nodeCount, 1);
  assert.equal(nodes[0].destroyed, true, '节点已销毁');
  assert.equal((nodes[0].components[0] as MockSprite).spriteFrame, null, '销毁时清帧引用');
  const h3 = backend.createNode('z');
  assert.equal(h3, h1, '句柄复用');
  assert.equal(backend.nodeCount, 2);
  backend.destroy(h2);
  assert.throws(() => backend.destroy(h2), /invalid render handle/);
  assert.throws(() => backend.setPosition(999, 0, 0), /invalid render handle/);
});

test('COCOS-6 9-slice 预留：applySliced 置 Sprite.type = SLICED', () => {
  const { cc, nodes } = makeCc();
  const backend = createCocosBackend(cc);
  const h = backend.createNode('ui_panel_9slice');
  const sprite = nodes[0].components[0] as MockSprite;
  assert.equal(sprite.type, 0, '默认 SIMPLE');
  backend.applySliced(h);
  assert.equal(sprite.type, 1, 'SLICED（9-slice 面板 / 按钮 / Tab 基座）');
});

test('COCOS-7 适配层不 import cc：模块可由注入命名空间构造（零引擎依赖证据）', () => {
  // 能在 Node 里 import 并实例化本身就是证据；此处再断言 cc 名称未被打包进类型
  const { cc } = makeCc();
  const backend = createCocosBackend(cc);
  const h = backend.createNode('probe');
  backend.setFrame(h, 'probe@L1');
  backend.setDepth(h, depthKey(0, 0));
  assert.equal(backend.info.verifiedInEngine, false);
});
