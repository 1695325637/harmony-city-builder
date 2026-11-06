#!/usr/bin/env node
/**
 * HC-01 · S-06 预览构建（T-118 / T-126 扩展）
 *
 * 单一真源：把 `src/render/*.ts` + 依赖的 `src/core/*.ts` 用 Node 内置
 * `module.stripTypeScriptTypes` 剥类型输出到 `preview/dist/*.mjs`。
 * **禁止复制粘贴一份 JS 逻辑**——所有产物都从 `src/` 生成。
 *
 * T-126 新增（离线单文件预览）：
 *   - `preview/dist/bundle.js`：把 dist 模块 + `preview/app.mjs` 按依赖拓扑序
 *     内联成**单个 classic script**（IIFE 包裹、去掉 import/export、无动态 import、
 *     无 fetch/XHR、无顶层 await），便于审查；
 *   - `preview/standalone.html`：用同一 bundle 替换 index.html 里的
 *     `<script type="module" src=...>`，CSS / DOM 与 index.html 完全一致，
 *     **双击 `file://` 即可打开**（不受 CORS 限制）；
 *   - `offlineSmoke()`：无浏览器环境下的语法 / 结构 / DOM 桩执行三层冒烟，
 *     结果打印到 stdout（并记录在 `tests/verification/render-s06-verification.md` §9）。
 *
 * 运行：node preview/build.mjs
 */

import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const outDir = join(here, 'dist');

/** 预览所需源文件（**拓扑序**：被依赖者在前；bundle 按此顺序拼接） */
const SOURCES = [
  'src/core/types.ts',
  'src/core/config.ts',
  'src/core/schema.ts',
  'src/render/iso.ts',
  'src/render/view-model.ts',
  'src/render/semantic-tokens.ts',
  'src/render/atlas.ts',
  'src/render/asset-naming.ts',
  'src/render/texture-format.ts',
  'src/render/draw-list.ts',
  'src/render/backend.ts',
];

if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

/** 剥类型 + 扁平化 import 说明符（.ts → .mjs，同目录 basename） */
function toDistModule(rel) {
  const src = readFileSync(join(root, rel), 'utf8');
  const stripped = stripTypeScriptTypes(src, { mode: 'strip' });
  return stripped.replace(/(from\s*['"])([^'"]+)\.ts(['"])/g, (m, a, spec, c) => a + './' + basename(spec) + '.mjs' + c);
}

const distParts = [];
for (const rel of SOURCES) {
  const flat = toDistModule(rel);
  const name = basename(rel).replace(/\.ts$/, '.mjs');
  const header = '// 自动生成，请勿手改：源 = ' + rel + '（node preview/build.mjs 重建）\n';
  writeFileSync(join(outDir, name), header + flat, 'utf8');
  distParts.push({ rel, code: flat });
}

const manifest = {
  generatedFrom: SOURCES,
  files: SOURCES.map((s) => basename(s).replace(/\.ts$/, '.mjs')),
  note: '占位渲染预览；Cocos 适配未验证；不含任何 PNG 资产',
};
writeFileSync(join(outDir, 'build-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
console.log('[preview] 已生成 ' + SOURCES.length + ' 个 .mjs 到 preview/dist/');

// ---------------------------------------------------------------------------
// T-126：内联 bundle（classic script，file:// 可用）
// ---------------------------------------------------------------------------

/** 去掉 ES module 语法：import 语句（含多行）、export {…} 聚合、export 前缀 */
function stripModuleSyntax(code) {
  let out = code;
  // import ... from '...';（含跨行大括号形式）
  out = out.replace(/^[ \t]*import[\s\S]*?from\s*['"][^'"]+['"]\s*;?[ \t]*$/gm, '');
  // export { a, b };（聚合导出，无 from 的本地导出）
  out = out.replace(/^[ \t]*export\s*\{[\s\S]*?\}\s*;?[ \t]*$/gm, '');
  // export default
  out = out.replace(/^[ \t]*export\s+default\s+/gm, '');
  // export const/let/var/function/class
  out = out.replace(/^([ \t]*)export\s+(?=(?:const|let|var|function|class|async)\b)/gm, '$1');
  return out;
}

const appCode = stripModuleSyntax(readFileSync(join(here, 'app.mjs'), 'utf8'));

const bundleParts = [];
for (const part of distParts) {
  bundleParts.push('// =======================================================================\n// ' + part.rel + '\n// =======================================================================');
  bundleParts.push(stripModuleSyntax(part.code));
}
bundleParts.push('// =======================================================================\n// preview/app.mjs\n// =======================================================================');
bundleParts.push(appCode);

const bundleSource =
  '/* HC-01 S-06 预览 bundle（自动生成，勿手改；源 = src/render + src/core + preview/app.mjs）\n' +
  ' * classic script：无 import / export / require / fetch / XHR，file:// 下可直接运行。 */\n' +
  '(function () {\n' +
  "  'use strict';\n" +
  bundleParts.join('\n') +
  '\n})();\n';

writeFileSync(join(outDir, 'bundle.js'), bundleSource, 'utf8');

// standalone.html = index.html 的 script 标签替换为内联 bundle（CSS / DOM 单一真源）
const html = readFileSync(join(here, 'index.html'), 'utf8');
const scriptTagRe = /<script\b[^>]*\bsrc=["'][^"']*app\.mjs["'][^>]*><\/script>/i;
if (!scriptTagRe.test(html)) {
  console.error('[preview] 未在 index.html 找到 <script src="app.mjs">，standalone 生成中止');
  process.exit(1);
}
const standaloneHtml = html.replace(
  scriptTagRe,
  '<script type="text/javascript">\n' + bundleSource + '</script>',
);
writeFileSync(join(here, 'standalone.html'), standaloneHtml, 'utf8');

console.log('[preview] 已生成 preview/dist/bundle.js（' + (bundleSource.length / 1024).toFixed(1) + ' KB）');
console.log('[preview] 已生成 preview/standalone.html（' + (standaloneHtml.length / 1024).toFixed(1) + ' KB，双击 file:// 可开）');

// ---------------------------------------------------------------------------
// T-126：离线冒烟（语法解析 / 结构断言 / DOM 桩执行）——无浏览器
// ---------------------------------------------------------------------------

function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** 最小 DOM / Canvas 桩：只覆盖 app.mjs 实际用到的 API，用于「能跑通不抛」的冒烟 */
function createStubDom() {
  const ctx = {
    canvas: null,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    setTransform() {},
    clearRect() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    stroke() {},
    save() {},
    restore() {},
    arc() {},
  };
  const elements = new Map();
  function makeElement(id) {
    const el = {
      id,
      innerHTML: '',
      textContent: '',
      checked: false,
      dataset: {},
      style: {},
      width: 1060,
      height: 740,
      setAttribute() {},
      addEventListener() {},
      appendChild() {},
      getContext() {
        return ctx;
      },
      getBoundingClientRect() {
        return { left: 0, top: 0, width: 1060, height: 740 };
      },
      querySelectorAll() {
        return [];
      },
    };
    return el;
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement(id));
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
    documentElement: { scrollWidth: 1024, clientWidth: 1024 },
    body: makeElement('body'),
  };
  ctx.canvas = document.getElementById('map');
  return {
    document,
    window: { location: { search: '', href: 'file:///preview/standalone.html' }, devicePixelRatio: 1 },
    console,
    URLSearchParams,
    setTimeout,
    clearTimeout,
  };
}

function offlineSmoke(bundle, htmlSource) {
  const errors = [];
  const notes = [];
  const code = stripComments(bundle);

  // ① 语法可解析（`new Function` 的函数体不允许顶层 await → 解析成功即排除顶层 await）
  try {
    // eslint-disable-next-line no-new-func
    new Function(bundle);
    notes.push('语法解析 OK（new Function）');
  } catch (err) {
    errors.push('语法解析失败：' + err.message);
  }

  // ② 结构断言：无 import / export / require / 网络请求
  if (/^[ \t]*import\b/m.test(code)) errors.push('残留 import 语句');
  else notes.push('import 语句 0 条');
  if (/^[ \t]*export\b/m.test(code)) errors.push('残留 export 语句');
  else notes.push('export 语句 0 条');
  if (/\bimport\s*\(/.test(code)) errors.push('存在动态 import()');
  if (/\brequire\s*\(/.test(code)) errors.push('存在 require()');
  if (/\bfetch\s*\(|XMLHttpRequest|new\s+WebSocket/.test(code)) errors.push('存在网络请求（fetch/XHR/WebSocket）');
  else notes.push('fetch/XHR/WebSocket 0 处');
  if (/^[ \t]*await\b/m.test(code)) errors.push('存在顶层 await');

  // ③ standalone.html 结构：classic script、无外部引用、无 type=module
  if (/type=["']module["']/i.test(htmlSource)) errors.push('standalone 仍含 type="module"');
  else notes.push('standalone 无 type="module"');
  const external = htmlSource.match(/<(?:script|link)\b[^>]*\b(?:src|href)=["'][^"']+["']/gi);
  if (external !== null) errors.push('standalone 含外部引用：' + external.join(' , '));
  else notes.push('standalone 外部 src/href 0 处（自包含）');

  // ④ DOM 桩执行（无浏览器；只证明「代码路径不抛错」）
  try {
    const sandbox = createStubDom();
    vm.runInNewContext(bundle, sandbox, { timeout: 5000 });
    notes.push('DOM 桩执行 OK（无异常）');
    const summary = sandbox.document.getElementById('summary');
    if (typeof summary.innerHTML === 'string' && summary.innerHTML.indexOf('LOD') >= 0) {
      notes.push('桩执行后已写入概览面板（证明 render() 走通）');
    } else {
      errors.push('桩执行后概览面板为空（render() 可能未走通）');
    }
  } catch (err) {
    errors.push('DOM 桩执行抛错：' + err.message);
  }

  return { ok: errors.length === 0, errors, notes };
}

const smoke = offlineSmoke(bundleSource, standaloneHtml);
console.log('[preview] 离线冒烟：' + (smoke.ok ? 'PASS' : 'FAIL'));
for (const n of smoke.notes) console.log('  ✓ ' + n);
for (const e of smoke.errors) console.log('  ✗ ' + e);
if (!smoke.ok) process.exitCode = 1;

console.log('[preview] 在线预览：node preview/serve.mjs  →  http://127.0.0.1:8123/?lod=L0');
console.log('[preview] 离线预览：直接双击 preview/standalone.html（file:// 可用，零网络请求）');
