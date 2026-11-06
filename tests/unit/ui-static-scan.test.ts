/**
 * HC-01 · S-07 · 结构纪律静态扫描（**自己扫**，不只信注释）
 *
 * 这些用例不依赖运行时行为，直接读 `src/ui/**` 源码做结构断言，用来钉定：
 * - ADR-004 §2 子决策 2：UI **零写权威状态**（无 `state.x =` / `cells.*[...] =`）；
 * - ADR-004 §2 子决策 1：UI 反馈**不绑 tick**（无 `runTick`、无 `tick-pipeline` 导入，
 *   通道 A 侧三个模块连 `simulation/**` 都不 import）；
 * - ADR-001：UI 不 import 引擎（`cc`）；
 * - 确定性纪律：无 `Math.random` / `Date.now`；`performance.now` 只允许出现在计时探针；
 * - art-bible「十六进制色值只允许出现在 semantic-tokens.ts」：`src/ui/**` 零 hex；
 * - 零依赖：所有 import 都是带 `.ts` 的相对路径。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const UI_ROOT = join(process.cwd(), 'src', 'ui');

function uiFiles(): string[] {
  return readdirSync(UI_ROOT, { recursive: true })
    .map((f) => String(f))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(UI_ROOT, f));
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/**
 * 去掉注释后再扫：本层多处注释**明确写着**「不得调用 runTick / 不得用 Date.now」，
 * 若不剥注释，这些自我约束说明会被自己的正则命中（假阳性）。
 * 扫描对象应是**代码**，不是散文。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readCode(file: string): string {
  return stripComments(read(file));
}

function basename(file: string): string {
  return file.slice(UI_ROOT.length + 1).split('\\').join('/');
}

function offenders(pattern: RegExp, allow: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const file of uiFiles()) {
    const name = basename(file);
    if (allow.indexOf(name) >= 0) continue;
    const src = readCode(file);
    const flags = pattern.flags.indexOf('g') >= 0 ? pattern.flags : pattern.flags + 'g';
    const re = new RegExp(pattern.source, flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      out.push(name + ': ' + m[0].trim());
    }
  }
  return out;
}

test('SCAN-1 UI 层不 import 引擎（无 `cc` / 无 Cocos API）', () => {
  assert.deepEqual(offenders(/from\s+['"]cc['"]|require\(\s*['"]cc['"]\s*\)|\.\bNode\b\s*=\s*new/), []);
});

test('SCAN-2 确定性纪律：无 Math.random / Date.now / new Date（UI 不引入非确定源）', () => {
  assert.deepEqual(offenders(/Math\.random|Date\.now|new Date\(|setTimeout|setInterval/), []);
});

test('SCAN-3 时钟读取只允许出现在计时探针 feedback-timing.ts', () => {
  assert.deepEqual(offenders(/performance\.now/, ['feedback-timing.ts']), []);
  // 反向确认扫描有效：探针文件里确实有 performance.now
  assert.ok(read(join(UI_ROOT, 'feedback-timing.ts')).indexOf('performance.now') >= 0);
});

test('SCAN-4 即时反馈不绑定 tick：无 runTick 调用、无 tick-pipeline 导入', () => {
  assert.deepEqual(offenders(/tick-pipeline|runTick\s*\(/), []);
  // 反向确认：真实条目确实会被扫出（防止正则失效导致的假绿）
  assert.equal(/tick-pipeline|runTick\s*\(/.test(stripComments("import { runTick } from '../simulation/tick-pipeline.ts'; runTick();")), true);
  assert.equal(
    /tick-pipeline|runTick\s*\(/.test(stripComments('// 本文件不 import tick-pipeline、不调用 runTick()')),
    false,
    '注释里的自我约束说明不算违规',
  );
});

test('SCAN-5 零写权威状态：无 state.x = / cells.*[...] = / budget.x = 等写入路径', () => {
  assert.deepEqual(offenders(/\.state\.[A-Za-z_$][\w$]*\s*=(?!=)/), [], '不得写 state 字段');
  assert.deepEqual(offenders(/cells\.[A-Za-z]+\s*\[[^\]]*\]\s*=(?!=)/), [], '不得写网格 TypedArray');
  assert.deepEqual(offenders(/\bbudget\.[A-Za-z_$][\w$]*\s*=(?!=)/), [], '不得写预算');
  assert.deepEqual(offenders(/\.(frames|issueCount|unlockedRegions|tickId)\s*=(?!=)/), [], '不得写帧 / 议题 / 解锁 / tickId');

  // 正向对照：这些写法确实会被扫出（防止正则写歪了变成永真断言）
  assert.equal(/\.state\.[A-Za-z_$][\w$]*\s*=(?!=)/.test('sim.state.budget = x'), true);
  assert.equal(/cells\.[A-Za-z]+\s*\[[^\]]*\]\s*=(?!=)/.test('state.cells.zone[i] = 3'), true);
  assert.equal(/\.state\.[A-Za-z_$][\w$]*\s*=(?!=)/.test('const s = session.state.view;'), false, '读 state 不算写');
});

test('SCAN-6 色值纪律：src/ui/** 零十六进制色值（色只能经语义令牌读取）', () => {
  assert.deepEqual(offenders(/#[0-9a-fA-F]{6}\b/), []);
  // 正向对照：扫描确能识别 hex（否则上一条是永真断言）
  assert.equal(/#[0-9a-fA-F]{6}\b/.test("const c = '#2E6BE6';"), true);
});

test('SCAN-7 通道 B 只由结算结果处理产生：emitB 仅出现在总线定义与交互控制器', () => {
  assert.deepEqual(offenders(/emitB\s*\(/, ['feedback-bus.ts', 'interaction-controller.ts']), []);
  const controller = read(join(UI_ROOT, 'interaction-controller.ts'));
  const calls = controller.match(/emitB\s*\(/g) ?? [];
  assert.ok(calls.length >= 3, '结算结果处理中确有 B 通道派发（tick-delta / flow-state / voice）');
  // A 通道侧三个模块完全拿不到 session / tick 状态
  for (const f of ['feedback-bus.ts', 'optimistic-view.ts', 'motion-policy.ts']) {
    const src = read(join(UI_ROOT, f));
    assert.equal(/simulation\//.test(src), false, f + ' 不得 import simulation/**');
    assert.equal(/\bsession\b/.test(src), false, f + ' 不得持有 session 引用');
  }
});

test('SCAN-8 零依赖：所有 import 均为带 .ts 的相对路径（无 node: / 裸模块 / 第三方）', () => {
  const bad: string[] = [];
  for (const file of uiFiles()) {
    const src = read(file);
    const re = /from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const spec = m[1];
      if (!spec.startsWith('.')) bad.push(basename(file) + ': ' + spec);
      else if (!spec.endsWith('.ts')) bad.push(basename(file) + ': ' + spec + ' (缺少 .ts 扩展名)');
    }
    assert.equal(/require\s*\(/.test(src), false, basename(file) + ' 不得使用 require');
    assert.equal(/\bprocess\.env\b/.test(src), false, basename(file) + ' 不得读环境变量');
  }
  assert.deepEqual(bad, []);
});

test('SCAN-9 通道隔离的类型保证：EventDetail 没有 tickId 字段，BEventDetail 才要求 tickId', () => {
  const src = read(join(UI_ROOT, 'feedback-bus.ts'));
  const eventDetail = src.slice(src.indexOf('export interface EventDetail'));
  const aPart = eventDetail.slice(0, eventDetail.indexOf('export interface BEventDetail'));
  assert.equal(aPart.indexOf('tickId'), -1, '通道 A 的事件描述不得出现 tickId（类型层面禁止读 tick）');
  const bPart = eventDetail.slice(0, eventDetail.indexOf('export interface FeedbackEmitterA'));
  assert.ok(bPart.indexOf('tickId') >= 0, '通道 B 的事件描述必须声明 tickId');
});

test('SCAN-10 本层文件清单固定（防越界新增 / 防误把预览页或渲染代码搬进来）', () => {
  const names = uiFiles().map(basename).sort();
  assert.deepEqual(names, [
    'feedback-bus.ts',
    'feedback-timing.ts',
    // —— S-08 竖屏 HUD 子模块（src/ui/hud/**），按字典序排在 index.ts 之前 ——
    'hud/a11y.ts',
    'hud/budget-panel.ts',
    'hud/build-tabs.ts',
    'hud/end-day-button.ts',
    'hud/hud-view-model.ts',
    'hud/index.ts',
    'hud/layout-profile.ts',
    'hud/legend.ts',
    'hud/types.ts',
    'index.ts',
    'interaction-controller.ts',
    'motion-policy.ts',
    'optimistic-view.ts',
  ]);
});

test('SCAN-11 通勤态令牌不得进 UI：代码层不绑定任何 flow 令牌 id', () => {
  // 契约来源：src/README.md §2.2「不依赖 —— flow.*（clear / slow / congested）」
  // + team-lead 2026-11-06 更正：三态由模拟层出枚举、渲染层出编码，**UI 不查表、不透传令牌 id**。
  //
  // 本条只扫**代码**（`offenders()` 会先剥注释）——曾有的「原文含注释也禁止出现三个字面 id」
  // 版本已按 team-lead 2026-11-06 裁定**撤回**：剥注释后它是本条的严格子集（冗余），
  // 而保留原文扫描会让**合法注释**（如「通勤拥堵态由渲染层判档」）变红，
  // 等于训练出「注释里别提令牌 id」的坏习惯，用测试降低文档质量。理由留此备查，勿"补回来"。
  assert.deepEqual(offenders(/'flow\.|"flow\./), [], 'UI 代码不得绑定任何 flow 令牌 id');

  // 正向对照：证明正则会命中真实绑定（否则是永真断言）
  assert.equal(/'flow\./.test("tokenById(tokens, 'flow.slow')"), true);
  assert.equal(/'flow\./.test("bus.emitB('flow-state', {})"), false, '事件类型名 flow-state 不算令牌引用');

  // 反向保护：`'flow-state'` 是**通道 B 事件类型名**（协议名），不许被当成违规「顺手清理」掉；
  // `target: 'flow'` 是 HUD 槽位 id；局部变量 `flow` 是归因对象别名——三者都不是令牌 id。
  assert.ok(read(join(UI_ROOT, 'feedback-bus.ts')).indexOf("'flow-state'") >= 0, "'flow-state' 事件类型名必须保留");
});
