/**
 * HC-01 · S-07 · 语义令牌 id 稳定性契约门禁（D-12）
 *
 * 依据：`src/README.md` §2.2「语义令牌 id 稳定性契约（跨层 · T-129）」——
 * 该节明写「`tests/unit/ui-token-contract.test.ts` 是其门禁（缺一个 id 即失败）」。
 *
 * **本文件为什么必须存在**：本层其余用例保护的是**行为**，不是**契约**。
 * `encodingOf()` 有兜底（令牌缺失 → 回落 `base.ink` / `base.tile`），所以渲染层
 * 「顺手整理」掉一个 id 时，UI 反馈**照常出现、用例照常绿**，语义色与形状却全丢。
 * 2026-11-06 T-121 的 `base.primary` 事故就是这一类。本文件把「静默降级」变成
 * 「改名即红」：**fail-loud，绝不透过 `encodingOf` 的 fallback 断言**。
 *
 * 三组断言（team-lead 2026-11-06 审定的收紧版）：
 * - R1 存在性（fail-loud）      ：6 个 id 必须能在 `buildSemanticTokenMap()` 输出里查到；
 * - R1b 反向哨兵（行为哨兵+诊断）：本层产出**一律不得**使用已删除的 `base.primary`；
 * - R2 不是回落值（4 类编码 + 三段覆盖）：落位 / 拆除 / 回滚 / 按压·选中 的编码
 *   必须**等于**预期 id 字面量，并显式 `!== 'base.ink' / 'base.tile'`；
 * - R3 `zone.*` 随配置生成     ：主断言逐个可查，数量断言仅防「硬编码 3 个」。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createDefaultConfig } from '../../src/core/config.ts';
import { createInitialState } from '../../src/core/schema.ts';
import { buildSemanticTokenMap, tokenById } from '../../src/render/semantic-tokens.ts';
import { makeCommand } from '../../src/simulation/commands.ts';
import { createSimulation } from '../../src/simulation/session.ts';
import {
  createFeedbackBus,
  createInteractionController,
  createMotionPolicy,
  createOptimisticLayer,
  encodingOf,
  type VisualEncoding,
} from '../../src/ui/index.ts';

const config = createDefaultConfig();
const tokens = buildSemanticTokenMap(config.zoneTypes);

/** README §2.2 的分级清单（契约正文的唯一真源；此处逐字复制以便单点核对） */
const HARD_DEPENDENCIES = ['base.tile', 'base.ink'] as const;
const SEMANTIC_DEPENDENCIES = ['status.selected', 'status.negative', 'status.positive', 'status.warning'] as const;
/** 已删除的历史 id：本层不得再依赖（T-121 A-07/A-08 事故 id） */
const REMOVED_ID = 'base.primary';

test('TOKEN-CONTRACT-1 存在性（fail-loud）：6 个契约 id 必须可在令牌表中查到', () => {
  for (const id of [...HARD_DEPENDENCIES, ...SEMANTIC_DEPENDENCIES]) {
    // 第一层：可读信息（缺哪个 id 一眼可见）
    assert.equal(tokens.byId[id] !== undefined, true, '令牌契约缺失：' + id + '（见 src/README.md §2.2）');
    // 第二层：走公开查询路径；缺失即抛错，绝不静默兜底
    const token = tokenById(tokens, id);
    assert.equal(token.id, id, id + ' 的令牌自述 id 必须一致');
    assert.ok(token.color.length > 0, id + ' 必须有色值');
    assert.ok(token.label.length > 0, id + ' 必须有文字标签（多通道反馈）');
  }
});

test('TOKEN-CONTRACT-2 反向哨兵：本层产出一律不得使用已删除的 base.primary', (t) => {
  const policy = createMotionPolicy({ tokens });
  const layer = createOptimisticLayer({ tokens, bus: createFeedbackBus() });

  // 覆盖本层全部编码产出面：8 类即时反馈 + tick 反馈 + 4 类叠加项
  const encodings: VisualEncoding[] = [];
  for (const kind of [
    'press',
    'select',
    'highlight',
    'tab',
    'panel-open',
    'placement',
    'demolition',
    'fund-preview',
  ] as const) {
    encodings.push(policy.immediate(kind).encoding);
  }
  encodings.push(policy.tickFeedback().encoding);
  encodings.push(layer.apply(makeCommand.zone('c1', 1, 2, 2, 'R', 1)).encoding);
  encodings.push(layer.apply(makeCommand.zone('c2', 2, 2, 2, 'EMPTY', 0)).encoding);
  encodings.push(layer.apply(makeCommand.fund('c3', 3, 10)).encoding);
  encodings.push(layer.applyUi({ kind: 'select', target: '3,4', x: 3, y: 4 }).encoding);
  encodings.push(layer.applyUi({ kind: 'tab', target: 'ROAD' }).encoding);
  encodings.push(layer.applyUi({ kind: 'panel', target: 'L2' }).encoding);
  encodings.push(layer.rollback('c1', 'LOCKED_REGION').encoding);

  const offenders = encodings.filter((e) => e.tokenId === REMOVED_ID).map((e) => e.tokenId);
  // 行为哨兵（硬断言）：只约束「本层不使用」，不约束「项目不得存在」——
  // 渲染侧若将来因 L0/L1 绘制需要重新引入 base 组主色，不应让本层报红（测试越权）。
  assert.deepEqual(offenders, [], '本层不得依赖已删除的 ' + REMOVED_ID);

  // 存在性软哨兵：把「中性事实」记为诊断，不判失败
  if (tokens.byId[REMOVED_ID] !== undefined) {
    t.diagnostic(
      REMOVED_ID +
        ' 已被重新引入但不得被 UI 引用；若确需保留，请在 src/README.md 令牌契约的 alias 表登记' +
        '（README §2.2 规则 1：变更须公告 + 保留 alias 至少一个版本）',
    );
  }
});

test('TOKEN-CONTRACT-3 落位 / 回滚编码必须是指定令牌；拆除按「非回落」设防（层↔策略分歧已上报）', () => {
  const layer = createOptimisticLayer({ tokens, bus: createFeedbackBus() });
  const placement = layer.apply(makeCommand.zone('p', 1, 2, 2, 'R', 1));
  const demolition = layer.apply(makeCommand.zone('d', 2, 2, 2, 'EMPTY', 0));
  const rollback = layer.rollback('p', 'LOCKED_REGION');

  assert.equal(placement.encoding.tokenId, 'status.positive', '合法落位预览必须用 status.positive（art-bible §8.3 合法绿）');
  assert.equal(rollback.encoding.tokenId, 'status.negative', '回滚负向反馈必须用 status.negative（S-07 验收②）');

  // ⚠️ 本门禁在 2026-11-06 发现一处**层 ↔ 策略分歧**（已上报 team-lead，不在本批改行为）：
  //   - `motion-policy.ts` 的 TOKEN_OF.demolition = 'status.warning'（策略层声明拆除用提示色）；
  //   - `optimistic-view.ts` 的 apply() 只按「可用性预检」取色 → 合法拆除拿到 'status.positive'。
  // 裁定前此处只设防「不得回落」，不把分歧中的任一侧写成契约（否则等于用测试固化未决问题）。
  assert.equal(
    createMotionPolicy({ tokens }).immediate('demolition').encoding.tokenId,
    'status.warning',
    '策略层：拆除声明必须用 status.warning',
  );
  assert.equal(
    demolition.encoding.tokenId === 'status.positive' || demolition.encoding.tokenId === 'status.warning',
    true,
    '叠加层拆除编码必须是两个合法预览令牌之一（不得是其它值 / 兜底值）',
  );

  for (const [name, encoding] of [
    ['落位', placement.encoding],
    ['拆除', demolition.encoding],
    ['回滚', rollback.encoding],
  ] as const) {
    // 「不是回落值」——识别静默降级最直接的判据
    assert.notEqual(encoding.tokenId, 'base.ink', name + ' 回落到了 base.ink（令牌被改名/删除，语义色丢失）');
    assert.notEqual(encoding.tokenId, 'base.tile', name + ' 回落到了 base.tile（令牌被改名/删除，语义色丢失）');
  }
});

test('TOKEN-CONTRACT-4 按压 / 选中三段覆盖：叠加层 / 策略声明 / 控制器真实派发均为 status.selected', () => {
  // (a) 叠加层真实产出（选中态）
  const layer = createOptimisticLayer({ tokens, bus: createFeedbackBus() });
  const selection = layer.applyUi({ kind: 'select', target: '3,4', x: 3, y: 4 });
  assert.equal(selection.encoding.tokenId, 'status.selected', '(a) 选中叠加项必须用 status.selected');

  // (b) 策略声明层（按压态）
  const press = createMotionPolicy({ tokens }).immediate('press').encoding;
  assert.equal(press.tokenId, 'status.selected', '(b) 按压态声明必须用 status.selected');

  // (c) 控制器真实派发的通道 A 事件载荷（用户真实路径）
  const state = createInitialState(config);
  const sim = createSimulation(config, state);
  const ui = createInteractionController({ session: sim, tokens });
  ui.press('end-day');
  const pressEvent = ui.bus.historyA().filter((e) => e.type === 'press')[0];
  assert.ok(pressEvent !== undefined);
  assert.equal(pressEvent.encoding?.tokenId, 'status.selected', '(c) 按压 A 事件载荷必须用 status.selected');

  for (const [name, encoding] of [
    ['选中', selection.encoding],
    ['按压', press],
    ['按压事件', pressEvent.encoding as VisualEncoding],
  ] as const) {
    assert.notEqual(encoding.tokenId, 'base.ink', name + ' 回落到了 base.ink（选中会表现为「点了没反应」）');
    assert.notEqual(encoding.tokenId, 'base.tile', name + ' 回落到了 base.tile');
  }
});

test('TOKEN-CONTRACT-5 回落机制确实存在（正向探针）：证明上两条断言不是永真', () => {
  // 用一个不存在的 id 触发兜底：若 encodingOf 不再兜底（改成抛错），本用例会红，
  // 提醒我们 R2/R3 的「不是回落值」断言语义已变，必须重写。
  const viaDefault = encodingOf(tokens, 'status.NOT_A_TOKEN');
  assert.equal(viaDefault.tokenId, 'base.tile', 'encodingOf 的默认兜底应为 base.tile');
  const viaExplicit = encodingOf(tokens, 'status.NOT_A_TOKEN', 'base.ink');
  assert.equal(viaExplicit.tokenId, 'base.ink', 'encodingOf 的显式兜底应为 base.ink');

  // 关键：兜底结果与契约期望值不同——所以 id 一旦改名，
  // `assert.equal(x, 'status.selected')` 必然失败（门禁有效），而不是悄悄通过。
  assert.notEqual(viaExplicit.tokenId, 'status.selected');
  assert.notEqual(viaDefault.tokenId, 'status.positive');
});

test('TOKEN-CONTRACT-6 zone.* 随 config.zoneTypes 全量生成（逐个可查；数量断言仅防硬编码 3 个）', () => {
  const three = buildSemanticTokenMap(config.zoneTypes);
  for (const zoneId of config.zoneTypes) {
    const token = tokenById(three, 'zone.' + zoneId);
    assert.equal(token.group, 'zone');
    assert.ok(token.label.length > 0, 'zone.' + zoneId + ' 必须有文字标签');
  }
  // 数量断言**仅作辅助**：T-129 若增加 alias / 额外令牌，总数会漂，不作精确计数
  assert.ok(
    Object.keys(three.zones).length >= config.zoneTypes.length,
    '至少应有与 config.zoneTypes 等量的 zone 令牌（防止硬编码成固定 3 个）',
  );

  // 4 类配置：证明「随配置生成」而非硬编码 3 个
  const extra = extraZoneId();
  const four = buildSemanticTokenMap([...config.zoneTypes, extra]);
  for (const zoneId of [...config.zoneTypes, extra]) {
    const token = tokenById(four, 'zone.' + zoneId);
    assert.equal(token.group, 'zone');
  }
  assert.ok(Object.keys(four.zones).length >= config.zoneTypes.length + 1);
  assert.equal(tokenById(four, 'zone.' + extra).pattern !== 'none', true, extra + ' 必须是渲染层实际支持的分区（有图案编码）');
});

/**
 * 取一个「渲染层实际支持、但不在默认 config.zoneTypes 里」的分区 id。
 * **不写死 `'CIVIC'`**：T-129 的改名清单若触及分区 id，写死会让契约用例误红。
 * 做法：逐个候选建表，取第一个 `pattern !== 'none'`（= 调色板认识它）的候选。
 */
function extraZoneId(): string {
  const candidates = ['CIVIC', 'PARK', 'OFFICE', 'R2', 'C2'];
  for (const id of candidates) {
    if (config.zoneTypes.indexOf(id) >= 0) continue;
    if (tokens.byId['zone.' + id] !== undefined) continue; // 已在默认表内，换下一个
    const probe = buildSemanticTokenMap([...config.zoneTypes, id]);
    const token = probe.byId['zone.' + id];
    if (token !== undefined && token.pattern !== 'none') return id;
  }
  throw new Error('找不到渲染层支持的可选分区 id——T-129 可能改了分区命名，请更新本函数候选表');
}

// ---------------------------------------------------------------------------
// R4（README §2.2 规则 3）：文档 ↔ 门禁清单必须同步
// ---------------------------------------------------------------------------

test('TOKEN-CONTRACT-7 文档↔门禁同步：README §2.2 依赖表与本文件的契约清单逐项一致', () => {
  const doc = readmeDependencyIds();
  assert.deepEqual(
    doc.hard.slice().sort(),
    [...HARD_DEPENDENCIES].sort(),
    'README §2.2「硬依赖」行与本文件 HARD_DEPENDENCIES 不一致（改契约必须同时改文档与门禁）',
  );
  assert.deepEqual(
    doc.semantic.slice().sort(),
    [...SEMANTIC_DEPENDENCIES].sort(),
    'README §2.2「语义依赖」行与本文件 SEMANTIC_DEPENDENCIES 不一致',
  );
  // 文档里写到的 id 必须真的存在（防止「文档承诺了渲染层没给的 id」）
  for (const id of [...doc.hard, ...doc.semantic]) {
    assert.equal(tokens.byId[id] !== undefined, true, 'README 承诺了令牌但令牌表里没有：' + id);
  }
  // 「不依赖 flow.*」是跨层契约（team-lead 2026-11-06 更正），文档必须写全三态
  for (const id of ['flow.clear', 'flow.slow', 'flow.congested']) {
    assert.equal(doc.excluded.indexOf(id) >= 0, true, 'README §2.2「不依赖」行必须列出 ' + id);
  }
});

/**
 * 解析 `src/README.md` §2.2 的四行依赖表（只取表格行，不取散文——
 * 「事故背景」里也提到 `base.primary`，那是历史叙述，不是依赖声明）。
 */
function readmeDependencyIds(): { hard: string[]; semantic: string[]; dynamic: string[]; excluded: string[] } {
  const text = readFileSync(join(process.cwd(), 'src', 'README.md'), 'utf8');
  const start = text.indexOf('### 2.2');
  assert.ok(start >= 0, 'src/README.md 缺少 §2.2「语义令牌 id 稳定性契约」');
  const nextSection = text.indexOf('**实现级视觉口径', start);
  const section = text.slice(start, nextSection === -1 ? text.length : nextSection);
  const lines = section.split('\n');
  const grab = (marker: string): string[] => {
    const line = lines.filter((l) => l.indexOf('| **' + marker + '** |') === 0)[0];
    if (line === undefined) return [];
    const ids: string[] = [];
    const re = /`((?:base|status|zone|flow)\.[A-Za-z<>]+)`/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) ids.push(m[1]);
    return ids;
  };
  return { hard: grab('硬依赖'), semantic: grab('语义依赖'), dynamic: grab('动态依赖'), excluded: grab('不依赖') };
}
