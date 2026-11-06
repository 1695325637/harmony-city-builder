/**
 * DG-03 · S-09 第一批 A 线 · 诊断层结构纪律静态扫描（**自己扫**，不只信注释）
 *
 * 钉定：
 * - AC-I7 / ADR-003 A4 / ADR-004 A2：查询只读、不重算模拟、不写回任何权威状态；
 * - 零依赖：源码不 import `node:` / 引擎 / 结算内核；所有 import 为带 .ts 的相对路径；
 * - 确定性纪律：无 Math.random / Date.now / performance.now / 定时器；
 * - 零 hex 色值、不绑定 flow.* 令牌 id（src/README.md §2.2）；
 * - 禁止无来源通用提示：代码层不出现「系统波动」类兜底文案；
 * - 每条断言配正向对照，防止正则写歪变成永真断言。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(process.cwd(), 'src', 'ui', 'diagnosis');

function files(): string[] {
  return readdirSync(ROOT, { recursive: true })
    .map((f) => String(f))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(ROOT, f));
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

/** 去掉注释后再扫：本层多处注释明确写着「不得调用 runTick」等自我约束说明 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function readCode(file: string): string {
  return stripComments(read(file));
}

function base(file: string): string {
  return file.slice(ROOT.length + 1).split('\\').join('/');
}

function offenders(pattern: RegExp, allow: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const file of files()) {
    const name = base(file);
    if (allow.indexOf(name) >= 0) continue;
    const src = readCode(file);
    const flags = pattern.flags.indexOf('g') >= 0 ? pattern.flags : pattern.flags + 'g';
    const re = new RegExp(pattern.source, flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) out.push(name + ': ' + m[0].trim());
  }
  return out;
}

function allCode(): string {
  return files().map(readCode).join('\n');
}

test('DX-1 诊断层零写权威状态：无 state.x = / cells.*[...] = / budget.x =', () => {
  assert.deepEqual(offenders(/\.state\.[A-Za-z_$][\w$]*\s*=(?!=)/), []);
  assert.deepEqual(offenders(/cells\.[A-Za-z]+\s*\[[^\]]*\]\s*=(?!=)/), []);
  assert.deepEqual(offenders(/\bbudget\.[A-Za-z_$][\w$]*\s*=(?!=)/), []);
  assert.deepEqual(offenders(/\.(frames|issueCount|unlockedRegions|tickId|dS|f_[csef])\s*=(?!=)/), []);
  // 正向对照
  assert.equal(/\.state\.[A-Za-z_$][\w$]*\s*=(?!=)/.test('sim.state.budget = x'), true);
  assert.equal(/cells\.[A-Za-z]+\s*\[[^\]]*\]\s*=(?!=)/.test('state.cells.zone[i] = 3'), true);
  assert.equal(/\.state\.[A-Za-z_$][\w$]*\s*=(?!=)/.test('const s = session.state.view;'), false, '读 state 不算写');
});

test('DX-2 诊断层不重算模拟：无 runTick / advanceDay / tick-pipeline / submit / put', () => {
  assert.deepEqual(offenders(/tick-pipeline|runTick\s*\(|advanceDay\s*\(|\.submit\s*\(|\.put\s*\(/), []);
  // 正向对照
  const probe = "import { runTick } from '../simulation/tick-pipeline.ts'; runTick(); store.put(s);";
  assert.equal(/tick-pipeline|runTick\s*\(|\.put\s*\(/.test(stripComments(probe)), true);
  assert.equal(
    /tick-pipeline|runTick\s*\(/.test(stripComments('// 本文件不 import tick-pipeline、不调用 runTick()')),
    false,
    '注释里的自我约束说明不算违规',
  );
});

test('DX-3 零依赖：源码不 import node: / 引擎 / 裸模块', () => {
  assert.deepEqual(offenders(/from\s+['"]node:/), []);
  assert.deepEqual(offenders(/from\s+['"](?:cc|@ohos|@harmony|cocos)[^'"]*['"]/), []);
  assert.deepEqual(offenders(/require\s*\(|\bprocess\.env\b/), []);
  assert.equal(/from\s+['"]node:/.test("import { readFileSync } from 'node:fs';"), true);
});

test('DX-4 所有 import 均为带 .ts 的相对路径（实现文件不直接 import 模拟层实现）', () => {
  const bad: string[] = [];
  for (const file of files()) {
    const src = read(file);
    const re = /from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      const spec = m[1];
      if (!spec.startsWith('.')) bad.push(base(file) + ': ' + spec);
      else if (!spec.endsWith('.ts')) bad.push(base(file) + ': ' + spec + ' (缺 .ts)');
    }
  }
  assert.deepEqual(bad, []);
  // 唯一允许的跨层引用是 barrel 里的 **type-only** 端口兼容性断言
  const barrel = read(join(ROOT, 'index.ts'));
  assert.ok(barrel.includes("import type { SnapshotStore } from '../../simulation/snapshot.ts'"));
  assert.ok(barrel.includes('AssertAssignable'), 'barrel 含编译期端口自查（仿 D-14）');
  for (const f of ['types.ts', 'diagnosis-query.ts']) {
    assert.equal(read(join(ROOT, f)).includes('simulation/'), false, f + ' 不得引用模拟层');
  }
});

test('DX-5 确定性纪律：无 Math.random / Date.now / new Date / performance.now / 定时器', () => {
  assert.deepEqual(offenders(/Math\.random|Date\.now|new Date\(|performance\.now|setTimeout|setInterval|requestAnimationFrame/), []);
  assert.equal(/Math\.random/.test('const x = Math.random();'), true);
});

test('DX-6 零 hex 色值 + 不绑定 flow.* 令牌 id（src/README.md §2.2）', () => {
  assert.deepEqual(offenders(/#[0-9a-fA-F]{6}\b|0x[0-9a-fA-F]{6,8}\b/), []);
  assert.deepEqual(offenders(/'flow\.|"flow\./), []);
  assert.equal(/#[0-9a-fA-F]{6}\b/.test("const c = '#2E6BE6';"), true);
  assert.equal(/'flow\./.test("tokenById(tokens, 'flow.slow')"), true);
  assert.equal(/'flow\./.test("bus.emitB('flow-state', {})"), false, "'flow-state' 事件名不算令牌 id");
});

test('DX-7 禁止无来源通用提示：代码层不出现兜底文案字面量', () => {
  const code = allCode();
  for (const hint of ['系统波动', '未知原因', '来源不明', '暂无说明', '综合因素']) {
    assert.equal(code.includes(hint), false, '不得出现兜底文案：' + hint);
  }
  // 正向对照：这些字面量若真写进代码会被抓
  assert.equal(['系统波动', '未知原因'].some((h) => "const x = '系统波动';".includes(h)), true);
});

test('DX-8 ΔS 双口径限制在代码层如实披露（不编造字段、不声称恒等）', () => {
  const code = allCode();
  assert.ok(code.includes('未随 TickSnapshot 显式承载'), 'basis 须披露 ΔS 缺失');
  assert.ok(code.includes('不等于 ΔS_abs − ΔS'), 'basis 须披露近似差额不等价');
  assert.ok(code.includes('不声称二者恒等'));
  assert.ok(code.includes('deltaSDecompositionCarried'), '须有恒 false 的类型标记');
  // 不得出现把 ΔS_abs 当作 ΔS 的伪造字段
  assert.equal(offenders(/\bcur\.dS\s*=|\bdS\s*=\s*sAbsoluteChange/).length, 0);
});

test('DX-9 四段卡片 / 三层披露 / 教学卡 / 耦合披露的关键符号齐备（防空转）', () => {
  const code = allCode();
  for (const sym of [
    'FourSegmentCard', 'DiagnosisSummary', 'DiagnosisFactorView', 'DiagnosisDetailView',
    'TutorialCard', 'CouplingDisclosure', 'queryDiagnosis', 'queryCycleRange',
    'MAX_DETAIL_CARDS', 'MAX_FACTOR_ROWS', 'COUPLING_THRESHOLD', 'ACTION_VERB_BY_CAUSE',
    'TUTORIAL_TEXT', 'COUPLING_BASIS',
  ]) {
    assert.ok(code.includes(sym), '缺关键符号：' + sym);
  }
  assert.equal(files().length, 3, 'diagnosis 子模块恰 3 文件（types / query / index）');
});
