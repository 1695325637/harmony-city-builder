/**
 * DP-03 · S-09 第二批 D 线 · barrel 挂载重名核查（运行期守卫）
 *
 * 背景：第一批 B 线曾踩过 `export *` 歧义名——`createInteractionController` /
 * `UiSessionPort` 若在两条 star-export 上重复，会**静默消失**且 tsc 不报错。
 * 本批把 `export * from './diagnosis/index.ts'` 挂到 `src/ui/index.ts`，
 * 故用运行期符号存在性把「无重名 / 无静默丢弃」钉成用例，而非只靠一次性 grep。
 *
 * 同时确认 D-14 编译期断言所在文件未被破坏（该断言由 tsc 验证，见回执）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as ui from '../../src/ui/index.ts';

/** S-07 / S-08 既有符号（历史上曾因歧义消失） */
const LEGACY_SYMBOLS = [
  'createInteractionController',
  'createFeedbackBus',
  'createMotionPolicy',
  'createHudViewModel',
  'createOptimisticLayer',
  'TICK_FREE',
  'FRAME_FREE',
  'CHANNEL_A_TYPES',
  'CHANNEL_B_TYPES',
  'UI_TABS',
  'TUTORIAL_LABEL',
] as const;

/** 第一批 A 线诊断数据层符号 */
const BATCH1_SYMBOLS = [
  'queryDiagnosis',
  'queryCycleRange',
  'COUPLING_BASIS',
  'TUTORIAL_TEXT',
  'COUPLING_THRESHOLD',
  'MAX_DETAIL_CARDS',
  'MAX_FACTOR_ROWS',
  'ACTION_VERB_BY_CAUSE',
] as const;

/** 第二批 D 线新增符号 */
const BATCH2_SYMBOLS = [
  'createDiagnosisPanel',
  'projectDiagnosisPanel',
  'projectTwoLevelFeedback',
  'DIAGNOSIS_PANEL_TARGET',
  'DIAGNOSIS_REFRESH_TYPES',
  'DIAGNOSIS_OPEN_EVENT_TYPE',
  'TWO_LEVEL_LATENCY_NOTE',
  'PANEL_CARD_LIMIT',
  'PANEL_FACTOR_ROW_LIMIT',
  'TUTORIAL_TEXT_E1',
  'TUTORIAL_TEXT_MISSING_SOURCE',
  'TUTORIAL_TEXT_NO_SNAPSHOT',
] as const;

test('DB-1 顶层 barrel 无歧义名静默消失：S-07 / 第一批 / 第二批符号全部存在', () => {
  const all = [...LEGACY_SYMBOLS, ...BATCH1_SYMBOLS, ...BATCH2_SYMBOLS];
  const missing = all.filter((k) => (ui as Record<string, unknown>)[k] === undefined);
  assert.deepEqual(missing, [], '缺失符号：' + missing.join(', '));
  assert.equal(typeof (ui as Record<string, unknown>).createInteractionController, 'function');
  assert.equal(typeof (ui as Record<string, unknown>).createDiagnosisPanel, 'function');
  assert.equal(typeof (ui as Record<string, unknown>).projectTwoLevelFeedback, 'function');
});

test('DB-2 第二批新增符号未与既有符号重名（三集合两两无交集）', () => {
  const legacy: readonly string[] = LEGACY_SYMBOLS;
  const b1: readonly string[] = BATCH1_SYMBOLS;
  const b2: readonly string[] = BATCH2_SYMBOLS;
  for (const a of [legacy, b1]) {
    for (const x of b2) assert.equal(a.indexOf(x), -1, '第二批符号与既有重名：' + x);
  }
  for (const x of b1) assert.equal(legacy.indexOf(x), -1, '第一批符号与 S-07 重名：' + x);
});

test('DB-3 顶层 barrel 仍导出 diagnosis 全部 4 文件的公开面（抽查各文件代表符号）', () => {
  const r = ui as Record<string, unknown>;
  // types.ts
  assert.equal(r.TUTORIAL_LABEL, '教学');
  assert.equal(r.PANEL_CARD_LIMIT, 4);
  // diagnosis-query.ts
  assert.equal(typeof r.queryDiagnosis, 'function');
  assert.equal(typeof r.queryCycleRange, 'function');
  assert.ok(String(r.COUPLING_BASIS).includes('不等于 ΔS_abs − ΔS'));
  // diagnosis-panel.ts
  assert.equal(r.DIAGNOSIS_PANEL_TARGET, 'L2');
  assert.equal(typeof r.projectTwoLevelFeedback, 'function');
  // index.ts（自查自出口）本身无运行期导出，其编译期断言由 tsc 验证
});

test('DB-4 D-14 编译期断言块未被改动或删除', () => {
  const src = readFileSync(join(process.cwd(), 'src', 'ui', 'index.ts'), 'utf8');
  assert.ok(src.includes("import type { Simulation } from '../simulation/session.ts'"));
  assert.ok(src.includes("import type { UiSessionPort } from './interaction-controller.ts'"));
  assert.ok(src.includes('type AssertAssignable<T extends U, U> = T;'));
  assert.ok(src.includes('type _SimulationSatisfiesUiSessionPort = AssertAssignable<Simulation, UiSessionPort>;'));
  assert.ok(src.includes("export * from './diagnosis/index.ts';"));
  assert.ok(src.includes("export * from './hud/index.ts';"));
});
