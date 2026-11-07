/**
 * HC-01 · S-12 · `AC-A05-2` 生产侧接线守卫（第四类证据断层的补强）
 *
 * 【背景 · 两条 fresh-eyes 复核共同指出】
 * `AC-A05-2` 的解封条件 ④「`assertSpacing(` 调用点 ≥1」⑤「`gapDp` 在 `a11y.ts` 外非空」
 * 此前**只是写在注释里**，不是一条会随代码变化而变红的断言。且判据自身可被
 * 「定义行」满足（`grep assertSpacing(` 会命中函数定义），属于**判据层断层**：
 * 证据还没出现，判据就已经"通过"了。
 *
 * 【本守卫做什么】
 * - 把「当前生产侧零接线」变成**可执行断言**：扫描 `src/**`，排除定义行后计数；
 * - 当前期望值 **0 / 0**，对应 `AC-A05-2` 状态 **PENDING-API · 不销项**；
 * - **一旦有人在 `src/` 里补了真实调用点或 `gapDp` 声明，本用例立即变红**——
 *   红是「须按三条重验门槛人工重新判定」的信号，**不是自动销项**。
 *   这正面堵住「写死一个 `tapTargetDp: 48` 的数组来凑门槛 ①」这类填空式满足。
 *
 * 【不做什么】
 * - 不判断新声明的来源是否为布局计算（静态扫不出意图，属 UNVERIFIABLE，须人工）；
 * - 不替代真机物理命中验证（第三层，EX-03 阻塞）；
 * - **本用例通过 ≠ `AC-A05-2` 达标**，它只证明「缺口如登记所述」。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC_ROOT = join(process.cwd(), 'src');

interface WiringCounts {
  /** `gapDp:` 字面量赋值数（不含 `gapDp?:` 接口声明） */
  gapAssignments: number;
  /** `assertSpacing(` 调用点数（不含 `function assertSpacing` 定义行） */
  calls: number;
  /** 命中明细，便于判定者定位 */
  hits: string[];
}

function srcFiles(): string[] {
  return readdirSync(SRC_ROOT, { recursive: true })
    .map((f) => String(f))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(SRC_ROOT, f));
}

/** 扫描核心（供牙齿自证复用）：只认字面量，不认注释、不认定义行。 */
export function scanWiring(source: string, file = '<synthetic>'): WiringCounts {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const gapAssignments: string[] = [];
  const calls: string[] = [];
  const lines = code.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // `gapDp?:` 是接口声明，不匹配；`gapDp: 8` 才是赋值
    if (/\bgapDp\s*:/.test(line)) gapAssignments.push(file + ':' + (i + 1) + ' ' + line.trim());
    // `export function assertSpacing(` 是定义，不是调用
    if (/\bassertSpacing\s*\(/.test(line) && !/function\s+assertSpacing/.test(line)) {
      calls.push(file + ':' + (i + 1) + ' ' + line.trim());
    }
  }
  return {
    gapAssignments: gapAssignments.length,
    calls: calls.length,
    hits: Object.freeze([...gapAssignments, ...calls]),
  };
}

test('WG-1 当前生产侧零接线：gapDp 赋值 0 / assertSpacing 调用 0（AC-A05-2 不销项）', () => {
  const totals: WiringCounts = { gapAssignments: 0, calls: 0, hits: [] };
  for (const file of srcFiles()) {
    const c = scanWiring(readFileSync(file, 'utf8'), file);
    totals.gapAssignments += c.gapAssignments;
    totals.calls += c.calls;
    for (const h of c.hits) (totals.hits as string[]).push(h);
  }
  assert.equal(
    totals.gapAssignments,
    0,
    'src/ 出现了 `gapDp:` 赋值 → 生产侧接线可能已就位。**本用例变红 = 必须人工重判 AC-A05-2**，' +
      '按三条门槛核验来源（是否布局计算/控件定义表，而非手写常量），不得自动销项。命中：\n' +
      totals.hits.join('\n'),
  );
  assert.equal(
    totals.calls,
    0,
    'src/ 出现了 `assertSpacing(` 调用 → 守卫可能已被触发。**本用例变红 = 必须人工重判 AC-A05-2**，' +
      '不得自动销项。命中：\n' + totals.hits.join('\n'),
  );
});

test('WG-2 牙齿自证：定义行不算调用，真实赋值/调用必须被数到', () => {
  const definitionOnly = `
export interface A11yControl {
  readonly gapDp?: number;
}
export function assertSpacing(controls: readonly A11yControl[]): void {
  // 注释里的 gapDp: 8 和 assertSpacing(x) 都不该被计入
}
`;
  const def = scanWiring(definitionOnly);
  assert.equal(def.gapAssignments, 0, '接口声明 `gapDp?:` 不得计为赋值');
  assert.equal(def.calls, 0, '函数定义行不得计为调用');

  const real = `
const controls = [{ id: 'tab:R', gapDp: 8 }];
assertSpacing(controls);
`;
  const hit = scanWiring(real);
  assert.equal(hit.gapAssignments, 1, '真实 gapDp 赋值必须被数到');
  assert.equal(hit.calls, 1, '真实调用必须被数到');
  assert.ok(hit.hits.some((h) => h.includes('gapDp: 8')), '命中明细须可定位');
});

test('WG-3 反填空纪律：本守卫只报数、不销项，判定权归人工', () => {
  // 静态扫描无法判断「声明来源是布局计算还是手写常量」——这是显式登记的 UNVERIFIABLE 盲区。
  // 因此本守卫的正确用法是：数值变化 → 变红 → 人工按 §三条重验门槛 重新判定。
  const handwritten = `const fake = [{ id: 'a', gapDp: 8 }]; // 写死常量，不构成证据`;
  const c = scanWiring(handwritten);
  assert.equal(c.gapAssignments, 1, '写死常量也会被数到（说明守卫不假装能判断来源）');
  // 这条断言把「来源不可判定」写进可执行契约：若将来有人给扫描器加来源判定，
  // 必须同步更新本用例与三条重验门槛，而不是让守卫悄悄变成自动销项器。
  assert.equal(c.calls, 0, '仅赋值、无调用点时，仍不得视为接线完成');
});
