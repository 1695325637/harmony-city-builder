/**
 * HC-01 · S-06 渲染内核 · 语义令牌单测
 *
 * 覆盖：令牌覆盖全部 config.zoneTypes + 状态集、分区 / 状态色值不交叉、
 * **(color, shape) 组合全局唯一（A-02）**、对比度字段齐备、形状 / 图案编码合法、
 * 高对比模式配置（A-05）、深底浅墨（A-08）、
 * **硬编码色值静态扫描仅命中 tokens 文件（D-06 扩展绕过面）**。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  AA_UI_THRESHOLD,
  HIGH_CONTRAST_INK_OUTLINE_WIDTH,
  HIGH_CONTRAST_PATTERN_ALPHA,
  PATTERN_ALPHA,
  buildSemanticTokenMap,
  contrastRatio,
  createDefaultConfig,
  patternAlphaFor,
  statusColorSet,
  tokenById,
  zoneColorSet,
} from '../../src/index.ts';

/** 事件 / 交互状态（A-02 后五项；通勤三态移到 flow.*） */
const REQUIRED_STATUS = ['status.positive', 'status.warning', 'status.negative', 'status.disabled', 'status.selected'];
/** 通勤叠加层三态（与状态同色不同形状） */
const REQUIRED_FLOW = ['flow.clear', 'flow.slow', 'flow.congested'];
const ALLOWED_PATTERNS = ['dots', 'diagonal-45', 'grid-lines', 'cross', 'canopy', 'vertical-bars', 'none'];
const ALLOWED_SHAPES = ['check', 'exclamation', 'cross', 'lock', 'arrow-up', 'arrow-down', 'triangle', 'dash', 'none'];

test('TOKEN-1 分区令牌按 config.zoneTypes 动态生成（3 类 MVP + 扩展类）', () => {
  const config = createDefaultConfig();
  assert.deepEqual(config.zoneTypes, ['R', 'C', 'I']);
  const map = buildSemanticTokenMap(config.zoneTypes);
  for (const z of config.zoneTypes) {
    const t = tokenById(map, 'zone.' + z);
    assert.equal(t.group, 'zone');
    assert.ok(t.label.length > 0, 'zone.' + z + ' 有文字标签（色 + 图案 + 文字三编码）');
    assert.notEqual(t.pattern, 'none', 'zone.' + z + ' 有图案编码（不得仅靠色相）');
  }
  // 扩展到 4 类（含 Should 级公共服务）不改渲染代码
  const map4 = buildSemanticTokenMap(['R', 'C', 'I', 'CIVIC']);
  assert.equal(Object.keys(map4.zones).length, 4);
  assert.equal(tokenById(map4, 'zone.CIVIC').pattern, 'cross');
  // 未知分区：中性兜底、不借用分区色或状态色
  const unknown = buildSemanticTokenMap(['FOO']);
  const t = tokenById(unknown, 'zone.FOO');
  assert.equal(t.pattern, 'none');
  assert.equal(t.label, 'FOO');
  assert.equal(statusColorSet(unknown).has(t.color), false, '兜底色不得取自状态组');
});

test('TOKEN-2 事件状态五项 + 通勤三态齐备且字段完整', () => {
  const map = buildSemanticTokenMap(createDefaultConfig().zoneTypes);
  for (const id of REQUIRED_STATUS) {
    const t = tokenById(map, id);
    assert.equal(t.group, 'status');
    if (id === 'status.selected') {
      // 选中态按 art-bible §3.4 用「主色 2px 描边 + 光晕」表达，不使用形状编码
      assert.equal(t.shape, 'none', '选中态不用形状（描边 + 光晕）');
    } else {
      assert.notEqual(t.shape, 'none', id + ' 必须有形状编码（色 + 形状双通道）');
    }
    assert.ok(t.label.length > 0);
  }
  for (const id of REQUIRED_FLOW) {
    const t = tokenById(map, id);
    assert.equal(t.group, 'flow');
    assert.notEqual(t.shape, 'none', id + ' 必须有形状编码');
  }
  // 每个令牌都有完整字段 + 对比度
  for (const id of Object.keys(map.byId)) {
    const t = tokenById(map, id);
    assert.equal(typeof t.color, 'string');
    assert.equal(typeof t.pattern, 'string');
    assert.equal(typeof t.shape, 'string');
    assert.equal(typeof t.label, 'string');
    assert.equal(typeof t.ink, 'string');
    assert.equal(typeof t.inkOnDark, 'string');
    assert.ok(Number.isFinite(t.contrast.ratio) && t.contrast.ratio >= 1 && t.contrast.ratio <= 21, id + ' 对比度在 1~21');
    assert.equal(typeof t.contrast.passesAA, 'boolean');
    assert.equal(ALLOWED_PATTERNS.indexOf(t.pattern) >= 0, true, id + ' 图案编码合法');
    assert.equal(ALLOWED_SHAPES.indexOf(t.shape) >= 0, true, id + ' 形状编码合法');
  }
});

test('TOKEN-7（A-02）(color, shape) 组合全局唯一：状态 / 流线同色必须不同形状', () => {
  const map = buildSemanticTokenMap(createDefaultConfig().zoneTypes);
  const seen: Record<string, string> = {};
  const dup: string[] = [];
  const ids = Object.keys(map.byId);
  for (const id of ids) {
    const t = map.byId[id];
    const key = t.color + '|' + t.shape;
    if (seen[key] !== undefined) dup.push(seen[key] + ' ≡ ' + id + ' (' + key + ')');
    else seen[key] = id;
  }
  assert.deepEqual(dup, [], '存在 (color, shape) 完全相同的令牌：' + dup.join(' | '));
  // 反向确认：同色的两个令牌形状必须不同（A-02 的原始碰撞面）
  for (const a of ids) {
    for (const b of ids) {
      if (a >= b) continue;
      if (map.byId[a].color === map.byId[b].color) {
        assert.notEqual(map.byId[a].shape, map.byId[b].shape, a + ' 与 ' + b + ' 同色且同形（不可区分）');
      }
    }
  }
  // 具体回归：warning(!) vs flow.slow(↑) 同色不同形；negative(✕) vs flow.congested(↓)
  assert.equal(tokenById(map, 'status.warning').color, tokenById(map, 'flow.slow').color);
  assert.notEqual(tokenById(map, 'status.warning').shape, tokenById(map, 'flow.slow').shape);
  assert.equal(tokenById(map, 'status.negative').color, tokenById(map, 'flow.congested').color);
  assert.notEqual(tokenById(map, 'status.negative').shape, tokenById(map, 'flow.congested').shape);
});

test('TOKEN-8（A-05）图案不透明度配置化 + 高对比开关（默认关闭、视觉不变）', () => {
  assert.equal(PATTERN_ALPHA, 0.18, '常规图案不透明度（art-bible §3.2 12–18%）');
  assert.equal(HIGH_CONTRAST_PATTERN_ALPHA, 0.3, '高对比 30%（M-093）');
  assert.equal(HIGH_CONTRAST_INK_OUTLINE_WIDTH, 1, '1px 深色描边');
  assert.equal(patternAlphaFor(false), PATTERN_ALPHA);
  assert.equal(patternAlphaFor(true), HIGH_CONTRAST_PATTERN_ALPHA);

  const normal = buildSemanticTokenMap(['R', 'C', 'I']);
  assert.equal(normal.highContrast, false, '默认关闭');
  assert.equal(normal.patternAlpha, PATTERN_ALPHA);
  assert.equal(normal.patternInkOutlineWidth, 0, '默认无描边');

  const hi = buildSemanticTokenMap(['R', 'C', 'I'], { highContrast: true });
  assert.equal(hi.highContrast, true);
  assert.equal(hi.patternAlpha, HIGH_CONTRAST_PATTERN_ALPHA);
  assert.equal(hi.patternInkOutlineWidth, HIGH_CONTRAST_INK_OUTLINE_WIDTH);
  // 高对比只改图案强度，不改任何色值（视觉色板一致）
  for (const id of Object.keys(normal.byId)) {
    assert.equal(hi.byId[id].color, normal.byId[id].color, id + ' 高对比不得改色值');
  }
});

test('TOKEN-9（A-08）深底浅墨：状态令牌的 inkOnDark 在其自身色上达 AA（禁用态豁免）', () => {
  const map = buildSemanticTokenMap(createDefaultConfig().zoneTypes);
  for (const id of [...REQUIRED_STATUS, ...REQUIRED_FLOW]) {
    const t = tokenById(map, id);
    assert.equal(t.inkOnDark.length > 0, true);
    const r = contrastRatio(t.inkOnDark, t.color);
    if (id === 'status.disabled') {
      assert.ok(r < AA_UI_THRESHOLD, '禁用态豁免，如实标注低对比（实际 ' + r.toFixed(2) + '）');
      continue;
    }
    assert.ok(r >= AA_UI_THRESHOLD, id + ' inkOnDark vs 自身色 ≥3:1（实际 ' + r.toFixed(2) + '）');
  }
  // 浅底（zone）用深墨：ink 在分区色上达 AA
  for (const z of ['R', 'C', 'I']) {
    const t = tokenById(map, 'zone.' + z);
    assert.equal(t.ink, tokenById(map, 'base.ink').color, 'zone.' + z + ' 用深墨');
  }
});

test('TOKEN-3 分区组与状态组色值互相隔离（四重隔离规则 1）', () => {
  const map = buildSemanticTokenMap(createDefaultConfig().zoneTypes);
  const zones = zoneColorSet(map);
  const status = statusColorSet(map);
  assert.ok(zones.size >= 3);
  assert.ok(status.size >= 4);
  for (const c of status) {
    assert.equal(zones.has(c), false, '状态色 ' + c + ' 不得复用分区色');
  }
  // 状态形状不得借分区图案：状态 / 流线令牌 pattern 恒为 none
  for (const id of Object.keys(map.status)) assert.equal(map.status[id].pattern, 'none', id + ' 不得使用分区图案');
  for (const id of Object.keys(map.flow)) assert.equal(map.flow[id].pattern, 'none', id + ' 流线不得使用分区图案');
  // 分区令牌不得带形状（形状保留给状态）
  for (const id of Object.keys(map.zones)) assert.equal(map.zones[id].shape, 'none', id + ' 分区不得借状态形状');
});

test('TOKEN-4 对比度：可用状态色（前景）达 AA ≥3:1；禁用态按 WCAG 非活动控件豁免', () => {
  const map = buildSemanticTokenMap(createDefaultConfig().zoneTypes);
  for (const id of Object.keys(map.status)) {
    const t = map.status[id];
    if (id === 'status.disabled') {
      // WCAG 1.4.3：非活动（禁用）控件豁免对比度要求；art-bible §3.4 亦明确「降饱和 + 60% 不透明度」
      assert.equal(t.contrast.passesAA, false, '禁用态如实标注未达 AA（豁免项，不伪造）');
      continue;
    }
    assert.ok(t.contrast.ratio >= AA_UI_THRESHOLD, id + ' 前景图标 / 组件对比度 ≥3:1，实际 ' + t.contrast.ratio.toFixed(2));
    assert.equal(t.contrast.passesAA, true, id + ' 应通过 AA');
  }
  // 分区色是填充（L≈70–80）：如实记录不达前景门槛，浮在填充上的文字用 ink（深墨）
  for (const id of Object.keys(map.zones)) {
    const t = map.zones[id];
    assert.equal(t.contrast.passesAA, false, id + ' 填充色如实标注未达前景 AA（不伪造）');
    assert.ok(t.ink.length > 0, id + ' 提供配色文字色');
  }
  // ink 在画布底上达正文门槛 4.5:1
  assert.ok(contrastRatio(tokenById(map, 'base.ink').color, tokenById(map, 'base.canvas').color) >= 4.5);
});

test('TOKEN-5 全项目色值只出现在 semantic-tokens.ts（D-06 扩展绕过面）', () => {
  const root = join(process.cwd(), 'src', 'render');
  const files = readdirSync(root, { recursive: true })
    .map((f) => String(f))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(root, f));
  const banned: { name: string; re: RegExp }[] = [
    { name: 'hex #rgb / #rrggbb / #rrggbbaa', re: /#[0-9a-fA-F]{3,8}\b/ },
    { name: '0xRRGGBB 色值', re: /0x[0-9a-fA-F]{6,8}\b/ },
    { name: 'rgb() / rgba() / hsl() / hsla()', re: /\b(?:rgba?|hsla?)\s*\(/ },
    { name: '"#" 字符串拼接拼色', re: /['"`]\s*#\s*['"`]\s*\+|\+\s*['"`]#/ },
  ];
  const offenders: string[] = [];
  for (const file of files) {
    if (file.endsWith('semantic-tokens.ts')) continue;
    const src = readFileSync(file, 'utf8');
    for (const b of banned) {
      if (b.re.test(src)) offenders.push(file.replace(process.cwd(), '') + ' → ' + b.name);
    }
  }
  assert.deepEqual(offenders, [], '色值只允许出现在 semantic-tokens.ts：' + offenders.join(' | '));
  // 反向确认：tokens 文件内确有足量 hex（扫描有效，不是空转）
  assert.ok((readFileSync(join(root, 'semantic-tokens.ts'), 'utf8').match(/#[0-9a-fA-F]{6}\b/g) ?? []).length >= 20);
});

test('TOKEN-6 未知令牌 id 抛错（禁止静默兜底色值）', () => {
  const map = buildSemanticTokenMap(createDefaultConfig().zoneTypes);
  assert.throws(() => tokenById(map, 'zone.NOT_A_ZONE'), /unknown semantic token/);
  assert.throws(() => tokenById(map, 'status.not_a_status'), /unknown semantic token/);
});
