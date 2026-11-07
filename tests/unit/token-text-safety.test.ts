/**
 * HC-01 · S-12 · 文字令牌安全守卫（`textSafe` 静态扫描 + 实算一致性）
 *
 * 权威口径（S-12 裁定，2026-11-07）：
 * - `base.inkWeak` 降级为**非文字令牌**（对 `base.canvas` 仅 2.31:1，不满足 WCAG
 *   SC 1.4.3 / 官方 2.1.4.1 的 4.5:1），用途限定为装饰线 / 分割线 / 非活动标示；
 * - `textSafe` 由 `contrastRatio(color, BASE.canvas) >= AA_TEXT_THRESHOLD` **实算**，
 *   不是手写常量——本文件会反向核验这层自洽性（改色不改标记 → 红）；
 * - **任何文本节点引用 `textSafe === false` 的令牌 = `AC-A02-1` 不达标**；
 * - `textSafe` 是**必要条件**而非设计许可：正文唯一权威色是 `base.ink`
 *   （零 hex 纪律由 `ui-static-scan` 把守，与本文件互补、不重复）。
 *
 * 【N/A ≠ PASS 同款纪律】本守卫通过 ≠ 「所有令牌都安全」——它证明的是：
 * ① 标记是算出来的；② 已知的非文字令牌确实为 false；③ 当前 src/ 零处违规引用。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildSemanticTokenMap,
  AA_TEXT_THRESHOLD,
  type SemanticToken,
} from '../../src/render/semantic-tokens.ts';

const MVP_ZONES = ['R', 'C', 'I'] as const;
const map = buildSemanticTokenMap(MVP_ZONES);

function allTokens(): SemanticToken[] {
  return Object.values(map.byId);
}

function srcFiles(): string[] {
  const root = join(process.cwd(), 'src');
  return readdirSync(root, { recursive: true })
    .map((f) => String(f))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(root, f))
    .filter((f) => !f.endsWith(join('src', 'render', 'semantic-tokens.ts'))); // 定义处本身豁免
}

/**
 * 扫描核心（供 T4 牙齿自证复用）：在一段源码文本里找
 * 「textSafe=false 的令牌 id 以字符串字面量出现」的命中行。
 *
 * 【已知盲区（UNVERIFIABLE，显式登记而非假装能查）】
 * - 动态拼接的令牌 id（如 `'base.ink' + suffix`）扫不到——字符串字面量之外的引用
 *   须靠 code review；若将来出现动态 id 构造，本守卫必须升级为 AST 级。
 * - 非字符串引用（如解构后按变量传递）不在本守卫射程内。
 */
export function scanUnsafeTokenLiterals(source: string, unsafeIds: readonly string[]): string[] {
  const lines = source.split(/\r?\n/);
  const hits: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (const id of unsafeIds) {
      if (lines[i].includes(id)) hits.push(`L${i + 1}: ${lines[i].trim()}`);
    }
  }
  return hits;
}

test('TS-1 全部令牌都有 textSafe，且与对比度实算自洽（改色不改标记 → 红）', () => {
  const tokens = allTokens();
  assert.ok(tokens.length >= 10, '令牌数量异常：' + tokens.length);
  for (const t of tokens) {
    assert.equal(typeof t.textSafe, 'boolean', '令牌 ' + t.id + ' 的 textSafe 缺失或非布尔');
    assert.equal(
      t.textSafe,
      t.contrast.ratio >= AA_TEXT_THRESHOLD,
      '令牌 ' + t.id + ' 的 textSafe(' + t.textSafe + ') 与实算对比度 ' +
        t.contrast.ratio.toFixed(2) + ' 不自洽——textSafe 必须由 contrastRatio 实算，不得手写',
    );
  }
});

test('TS-2 已知判定：ink 可作文字；inkWeak / 各底色不可（S-12 裁定落点）', () => {
  assert.equal(map.byId['base.ink'].textSafe, true, 'base.ink 是正文唯一权威色，必须 textSafe');
  assert.equal(
    map.byId['base.inkWeak'].textSafe,
    false,
    'base.inkWeak 2.31:1（S-12 降级为非文字令牌）——若此断言变红，说明有人改了色值或改了判定，须先过美术侧裁定',
  );
  // 底色（背景）对自身 / 相近底色的对比度必然 < 4.5，结构性不可作正文
  for (const bg of ['base.canvas', 'base.tile', 'base.panel', 'base.divider']) {
    assert.equal(map.byId[bg].textSafe, false, bg + ' 是背景色，结构性不可作正文');
  }
});

test('TS-3 inkWeak 的 label 已随降级改写，不再自称「文字·弱」', () => {
  const label = map.byId['base.inkWeak'].label;
  // 注意：「非文字」本身含「文字」子串，故只禁旧称呼、要求显式标注「非文字」
  assert.ok(!label.includes('文字·弱'), 'inkWeak label「' + label + '」仍自称 文字·弱——与 S-12 非文字令牌裁定矛盾');
  assert.ok(label.includes('非文字'), 'inkWeak label 应显式标注「非文字」，当前为：' + label);
});

test('TS-4 静态扫描：src/ 内（定义处之外）零处引用 base.inkWeak（被裁定非文字的令牌）', () => {
  // 【扫描范围纪律】只有**被显式裁定**「任何用途都不可」的令牌才进硬禁名单——
  // 当前仅 `base.inkWeak`（S-12 降级为纯装饰 / 非活动标示）。
  // 其余 textSafe=false 的令牌（各底色、状态色等）**不进硬禁**：它们被引用为
  // 填充 / 状态色是合法用途，静态扫描无法判定「文本 vs 填充」意图——
  // 这部分是本守卫的 **UNVERIFIABLE 盲区**，显式登记如下，不得假装已覆盖：
  //   UNVERIFIABLE-1：textSafe=false 令牌被赋给文本字段的「上下文级」判定（需 AST / code review）；
  //   UNVERIFIABLE-2：动态拼接的令牌 id（如 `'base.ink' + suffix`）扫不到；
  //   UNVERIFIABLE-3：非字符串引用（解构后按变量传递）不在射程内。
  const hardBan = ['base.inkWeak'];
  const violations: string[] = [];
  for (const file of srcFiles()) {
    const hits = scanUnsafeTokenLiterals(readFileSync(file, 'utf8'), hardBan);
    for (const h of hits) violations.push(file + ' → ' + h);
  }
  assert.deepEqual(
    violations,
    [],
    '发现 base.inkWeak 引用（该令牌已被裁定为非文字令牌：2.31:1 不满足 SC 1.4.3）。' +
      '若确为装饰线 / 非活动标示用途，须先过美术侧裁定更新硬禁名单，不得静默使用：\n' +
      violations.join('\n'),
  );
});

test('TS-5 牙齿自证：扫描器对合成违规必须报红（防「永真守卫」复发）', () => {
  // assertSpacing 的「永真断言」教训：守卫自己必须被证明能失败。
  const unsafeIds = ['base.inkWeak'];
  const clean = `const x = 1;\nconst label = '居住';`;
  const dirty = `const hint = { text: '暂无数据', color: 'base.inkWeak' }; // 占位文案误用`;
  assert.deepEqual(scanUnsafeTokenLiterals(clean, unsafeIds), [], '干净源码不应命中');
  assert.equal(scanUnsafeTokenLiterals(dirty, unsafeIds).length, 1, '含 base.inkWeak 的源码必须命中（守卫有牙齿）');
});
