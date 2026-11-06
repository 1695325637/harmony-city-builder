/**
 * HC-01 · S-08 · HUD 结构纪律静态扫描（**自己扫**，不只信注释）
 *
 * 钉定 S-08 项 8 与跨层契约：
 * - UI 零写权威状态（无 `state.x =` / `cells.*[...] =`）；
 * - 即时反馈不绑 tick（无 `runTick` / 无 `tick-pipeline` 导入）；
 * - UI 不 import 引擎（`cc`）；
 * - 零十六进制色值（色只经语义令牌 / 渲染层 OpaqueSwatch）；
 * - 确定性纪律：无 `Math.random` / `Date.now`；
 * - 跨层契约：HUD 不得出现 `flow.clear/slow/congested` 字面令牌 id（只消费枚举）；
 * - OpaqueSwatch 契约：HUD 不得解析 `swatch.paint` 内部（paint 为 unknown）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const HUD_ROOT = join(process.cwd(), 'src', 'ui', 'hud');

function hudFiles(): string[] {
  return readdirSync(HUD_ROOT, { recursive: true })
    .map((f) => String(f))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(HUD_ROOT, f));
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readCode(file: string): string {
  return stripComments(read(file));
}

function basename(file: string): string {
  return file.slice(HUD_ROOT.length + 1).split('\\').join('/');
}

function offenders(pattern: RegExp): string[] {
  const out: string[] = [];
  for (const file of hudFiles()) {
    const src = readCode(file);
    const flags = pattern.flags.indexOf('g') >= 0 ? pattern.flags : pattern.flags + 'g';
    const re = new RegExp(pattern.source, flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push(basename(file) + ': ' + m[0].trim());
  }
  return out;
}

test('HUD-SCAN-1 HUD 零写权威状态：无 state.x = / cells.*[...] = / budget.x =', () => {
  assert.deepEqual(offenders(/\.state\.[A-Za-z_$][\w$]*\s*=(?!=)/), [], '不得写 state 字段');
  assert.deepEqual(offenders(/cells\.[A-Za-z]+\s*\[[^\]]*\]\s*=(?!=)/), [], '不得写网格 TypedArray');
  assert.deepEqual(offenders(/\bbudget\.[A-Za-z_$][\w$]*\s*=(?!=)/), [], '不得写预算');
  assert.deepEqual(offenders(/\.(frames|issueCount|unlockedRegions|tickId)\s*=(?!=)/), [], '不得写帧/议题/解锁/tickId');
  // 正向对照：写路径确实会被扫出
  assert.equal(/\.state\.[A-Za-z_$][\w$]*\s*=(?!=)/.test('sim.state.budget = x'), true);
});

test('HUD-SCAN-2 HUD 即时反馈不绑 tick：无 runTick / 无 tick-pipeline 导入', () => {
  assert.deepEqual(offenders(/tick-pipeline|runTick\s*\(/), []);
  assert.equal(/tick-pipeline|runTick\s*\(/.test(stripComments("import { runTick } from '../simulation/tick-pipeline.ts'; runTick();")), true, '扫描能命中真实引用');
});

test('HUD-SCAN-3 HUD 不 import 引擎（无 cc / 无 Cocos API）', () => {
  assert.deepEqual(offenders(/from\s+['"]cc['"]|require\(\s*['"]cc['"]\s*\)|\.\bNode\b\s*=\s*new/), []);
});

test('HUD-SCAN-4 HUD 零十六进制色值（色只经语义令牌 / 渲染层 OpaqueSwatch）', () => {
  assert.deepEqual(offenders(/#[0-9a-fA-F]{6}\b/), []);
  assert.equal(/#[0-9a-fA-F]{6}\b/.test("const c = '#2E6BE6';"), true, '扫描能命中 hex');
});

test('HUD-SCAN-5 HUD 确定性纪律：无 Math.random / Date.now / new Date', () => {
  assert.deepEqual(offenders(/Math\.random|Date\.now|new Date\(|setTimeout|setInterval/), []);
});

test('HUD-SCAN-6 通勤态令牌不得进 HUD：代码层不绑定 flow.* 字面令牌 id', () => {
  // 契约：HUD 只消费枚举（'clear'/'slow'/'congested'）与渲染层图例 label，
  // **不得引用 flow.* 字面令牌 id**（如 'flow.clear'）。
  assert.deepEqual(offenders(/'flow\.|"flow\./), [], 'HUD 代码不得绑定 flow 令牌 id');
  // 正向对照：真绑定会被抓
  assert.equal(/'flow\./.test("tokenById(tokens, 'flow.slow')"), true);
  assert.equal(/'flow\./.test("const s = 'flow-state';"), false, "'flow-state' 事件名不算令牌 id");
});

test('HUD-SCAN-7 OpaqueSwatch 契约：HUD 不得解析 swatch.paint 内部（paint 为 unknown）', () => {
  // UI 只消费 label；若有人写 `swatch.paint.color` 之类即违约（且类型上本应编不过）。
  assert.deepEqual(offenders(/\.paint\.[A-Za-z_$]/), [], 'HUD 不得深入 paint 内部');
  // T-135 正向断言：图例来自渲染层下发 / 注入，UI 不得再定义或消费 mock 图例常量。
  assert.equal(
    read(join(HUD_ROOT, 'legend.ts')).indexOf('MOCK_FLOW_LEGEND') >= 0,
    false,
    'UI 不得定义 / 消费 mock 图例常量（真实图例由渲染层下发）',
  );
  assert.equal(
    read(join(HUD_ROOT, 'types.ts')).indexOf('MOCK_FLOW_LEGEND') >= 0,
    false,
    'types.ts 不得导出 mock 图例常量',
  );
  assert.ok(
    /setFlowLegendProvider/.test(readCode(join(HUD_ROOT, 'legend.ts'))),
    'legend.ts 必须提供渲染层图例注入点',
  );
});

test('HUD-SCAN-8 HUD 零依赖：import 均为带 .ts 的相对路径', () => {
  const bad: string[] = [];
  for (const file of hudFiles()) {
    const src = read(file);
    const re = /from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const spec = m[1];
      if (!spec.startsWith('.')) bad.push(basename(file) + ': ' + spec);
      else if (!spec.endsWith('.ts')) bad.push(basename(file) + ': ' + spec + ' (缺 .ts)');
    }
  }
  assert.deepEqual(bad, []);
});

test('HUD-SCAN-9 HUD 仅消费 flow 枚举、不引用 flow.* 令牌（枚举在 types.ts，图例在 legend.ts）', () => {
  // 扫描**代码**（剥注释）：注释会明文列举禁用字面 id 作为文档，不应误伤。
  const typesCode = readCode(join(HUD_ROOT, 'types.ts'));
  const legendCode = readCode(join(HUD_ROOT, 'legend.ts'));
  // 三态枚举值 'clear'/'slow'/'congested' 必须存在（T-135 后由 types.ts 的 FlowState 联合类型声明，
  // 不再是 mock 图例常量；真实图例由渲染层 buildFlowLegend 下发）
  assert.ok(/'clear'|'slow'|'congested'/.test(typesCode), 'FlowState 必须声明三态枚举');
  // 两文件代码均不得写 'flow.clear' 之类的令牌 id（只消费枚举，不引用 flow.* 令牌）
  assert.equal(/'flow\.(clear|slow|congested)'/.test(typesCode), false, 'types 不得写 flow.* 令牌 id');
  assert.equal(/'flow\.(clear|slow|congested)'/.test(legendCode), false, 'legend 不得写 flow.* 令牌 id');
});
