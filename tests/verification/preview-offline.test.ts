/**
 * HC-01 · 预览页「单文件离线版 + 响应式布局」验证套件（T-126）
 *
 * 覆盖：
 *   P-03 离线单文件：`preview/standalone.html` / `preview/dist/bundle.js` 无 import / export /
 *        require / 动态 import / fetch / XHR / WebSocket / 外部 src·href / type="module"，
 *        且 classic script 语法可解析（`new Function`）。
 *   P-04 单一真源：standalone 与 index.html 的 `<style>` 内容逐字符相同、DOM id 集合相同，
 *        bundle 由 dist 模块拼接（含各模块头注释），不是手工第二份逻辑。
 *   P-02 布局：flex-wrap + min-width:0 + canvas 100%/auto + ≤1024 媒体查询齐备；
 *        按弹性预算手算 ≥1024 各档不产生横向溢出。
 *   P-02 拾取：app.mjs 已按 rect 缩放换算回内部像素坐标（防 CSS 缩放后点击偏移）。
 *
 * 纪律：只读产物与 preview 源码；**不做任何「浏览器实测」声明**——视觉与交互需用户双击目视。
 * 前置：先运行 `node preview/build.mjs` 生成产物（测试会给出提示）。
 *
 * 运行：node --experimental-strip-types --test tests/verification/preview-offline.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const standalonePath = join(root, 'preview', 'standalone.html');
const bundlePath = join(root, 'preview', 'dist', 'bundle.js');
const indexPath = join(root, 'preview', 'index.html');
const appPath = join(root, 'preview', 'app.mjs');

function readOrFail(path: string, hint: string): string {
  if (!existsSync(path)) throw new Error('缺少产物：' + path + '（' + hint + '）');
  return readFileSync(path, 'utf8');
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const HINT = '先运行 node preview/build.mjs';

test('PREV-1 产物齐备且体积合理（bundle.js / standalone.html 自包含）', () => {
  const bundle = readOrFail(bundlePath, HINT);
  const standalone = readOrFail(standalonePath, HINT);
  assert.ok(bundle.length > 50 * 1024, 'bundle 至少 50KB（含 11 个模块 + app），实际 ' + (bundle.length / 1024).toFixed(1) + 'KB');
  assert.ok(standalone.length > bundle.length, 'standalone 须内联 bundle 且更大');
  assert.ok(standalone.length > 60 * 1024);
  // bundle 内部带各模块分隔头（证明由 dist 拼接而非手写）
  for (const marker of ['src/core/types.ts', 'src/render/iso.ts', 'src/render/semantic-tokens.ts', 'preview/app.mjs']) {
    assert.ok(bundle.indexOf(marker) >= 0, 'bundle 缺少来源标记：' + marker);
  }
});

test('PREV-2 bundle 为 classic script：无 import/export/require/动态 import/fetch/XHR/顶层 await，且语法可解析', () => {
  const bundle = readOrFail(bundlePath, HINT);
  // 语法可解析：函数体不允许顶层 await，解析成功即同时排除顶层 await
  assert.doesNotThrow(() => {
    // eslint-disable-next-line no-new-func
    new Function(bundle);
  }, 'bundle 语法解析失败');
  const code = stripComments(bundle);
  assert.equal(/^[ \t]*import\b/m.test(code), false, '残留 import 语句');
  assert.equal(/^[ \t]*export\b/m.test(code), false, '残留 export 语句');
  assert.equal(/\bimport\s*\(/.test(code), false, '存在动态 import()');
  assert.equal(/\brequire\s*\(/.test(code), false, '存在 require()');
  assert.equal(/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/.test(code), false, '存在网络请求');
  assert.equal(/^[ \t]*await\b/m.test(code), false, '存在顶层 await');
});

test('PREV-3 standalone.html：无 type="module"、零外部 src/href、内联经典脚本、横幅文案在', () => {
  const html = readOrFail(standalonePath, HINT);
  assert.equal(/type=["']module["']/i.test(html), false, '不得再有 type="module"');
  const external = html.match(/<(?:script|link)\b[^>]*\b(?:src|href)=["'][^"']+["']/gi);
  assert.equal(external, null, 'standalone 不得有外部引用：' + String(external));
  assert.ok(/<script type="text\/javascript">/.test(html), '须为内联 classic script');
  // 诚实文案三要素（QA-R5 同口径）
  assert.ok(html.includes('非最终美术'));
  assert.ok(html.includes('Cocos 适配未验证'));
  assert.ok(html.includes('程序化占位'));
  assert.equal(/已通过|全部验证|已实测|验收通过/.test(html), false, '不得出现「已通过 / 已实测」类断言');
});

test('PREV-4 单一真源：standalone 与 index.html 的 <style> 逐字符相同、DOM id 集合相同', () => {
  const html = readOrFail(standalonePath, HINT);
  const index = readOrFail(indexPath, HINT);
  const styleOf = (s: string) => {
    const m = s.match(/<style>([\s\S]*?)<\/style>/);
    assert.ok(m !== null, '缺少 <style> 块');
    return m[1];
  };
  assert.equal(styleOf(html), styleOf(index), 'standalone 的 CSS 必须与 index.html 完全一致（不允许第二份样式）');
  const idsOf = (s: string) => (s.match(/\bid="[^"]+"/g) ?? []).map((x) => x.slice(4, -1)).sort();
  assert.deepEqual(idsOf(html), idsOf(index), 'DOM id 集合必须一致');
  for (const id of ['map', 'summary', 'depthList', 'batchInfo', 'loadSet', 'a11yInfo', 'formatInfo', 'lodRow', 'overviewBtn', 'highContrast']) {
    assert.ok(idsOf(html).indexOf(id) >= 0, 'standalone 缺少必要 DOM：# ' + id);
  }
});

test('PREV-5 P-02 布局规则齐备（flex-wrap / min-width:0 / canvas 100%·auto / ≤1024 媒体查询）', () => {
  const index = readOrFail(indexPath, HINT);
  const css = index.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(/main\s*\{[^}]*flex-wrap:\s*wrap/.test(css), 'main 须 flex-wrap: wrap');
  assert.ok(/#stage\s*\{[^}]*min-width:\s*0/.test(css), '#stage 须 min-width: 0（防 flex 项溢出）');
  assert.ok(/aside\s*\{[^}]*min-width:\s*0/.test(css), 'aside 须 min-width: 0');
  assert.ok(/aside\s*\{[^}]*max-width:\s*100%/.test(css), 'aside 须 max-width: 100%');
  assert.ok(/canvas\s*\{[^}]*width:\s*100%/.test(css), 'canvas 须 width: 100%');
  assert.ok(/canvas\s*\{[^}]*height:\s*auto/.test(css), 'canvas 须 height: auto（保持 1060×740 比例）');
  assert.ok(/@media\s*\(max-width:\s*1024px\)/.test(css), '须有 ≤1024 媒体查询');
  assert.ok(/@media[^{]*\{[\s\S]*?flex-direction:\s*column/.test(css), '窄屏须整列排布（面板换行到画布下方）');
});

test('PREV-6 P-02 弹性预算手算：≥1024 宽各档均无横向溢出（CSS 规则 + 尺寸预算，非浏览器实测）', () => {
  // 与 index.html 一致的常量：main padding 12×2、gap 12、#stage basis 640、aside basis 380（max 460）
  const PADDING = 12 * 2;
  const GAP = 12;
  const STAGE_BASIS = 640;
  const ASIDE_BASIS = 380;
  for (const viewport of [1024, 1100, 1280, 1440, 1920]) {
    const available = viewport - PADDING;
    // flex-wrap 下：任一项都能单独放入一行（min-width:0 + basis ≤ available）即不可能溢出；
    // 放不下时换行到下一行，而不是撑破容器。
    assert.ok(Math.max(STAGE_BASIS, ASIDE_BASIS) <= available, viewport + 'px：单项最小宽度须 ≤ 可用宽度（' + available + '）');
    const singleRow = STAGE_BASIS + GAP + ASIDE_BASIS <= available;
    if (singleRow) {
      const stageW = available - GAP - ASIDE_BASIS;
      assert.ok(stageW >= STAGE_BASIS, viewport + 'px：单行时 #stage 实际宽度 ' + stageW + ' ≥ basis');
    } else {
      assert.ok(viewport < 1100, viewport + 'px：预期为换行布局（画布一行 + 面板一行）');
    }
  }
  // 画布内部坐标固定，CSS 仅缩放：绘制逻辑依赖 canvas.width/height 不被改写
  const app = readOrFail(appPath, HINT);
  assert.ok(/canvas\.width\s*\//.test(app), 'app 须以 canvas.width 作内部坐标基准');
});

test('PREV-7 P-02 拾取换算：rect（CSS 像素）→ 内部像素坐标已补正', () => {
  const app = readOrFail(appPath, HINT);
  assert.ok(/canvas\.width\s*\/\s*rect\.width/.test(app), 'screenToWorld 须按 canvas.width / rect.width 换算 X');
  assert.ok(/canvas\.height\s*\/\s*rect\.height/.test(app), 'screenToWorld 须按 canvas.height / rect.height 换算 Y');
  assert.ok(/rect\.width\s*>\s*0/.test(app), '须防 rect.width = 0（未布局时除零）');
  assert.ok(/getBoundingClientRect\(\)/.test(app), '拾取仍以 rect 为准');
  // 换算后仍调用内核 screenToWorldPoint（不私自重写相机数学）
  assert.ok(/screenToWorldPoint\s*\(/.test(app), '须复用内核 screenToWorldPoint');
});
