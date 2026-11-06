/**
 * HC-01 · S-06【T-121 修复批 · 第二层 QA 独立复核】套件（T-124）
 *
 * 目的：独立重验 T-121 七项必修 + 三项越界关闭 + D-06~D-08 收口，不复用实现方用例断言。
 * 编号与 T-119 的 QA-R* 区分（本文件用 QA-T*）：
 *   QA-T1  A-02 状态语义碰撞：(color,shape) 唯一性独立重算（状态∪流线全对 + 同色必不同形
 *          + status 三态确已移除 + selected 无形状的碰撞面 + flow.clear(✓) vs positive(✓) 同形异色）
 *   QA-T2  A-05 高对比：默认关闭、只改 alpha/描边，**全令牌色值与键集逐项不变**
 *   QA-T3  A-01 命名映射：用**本文件自写**的 §0.3 正则（不 import 实现正则）全覆盖扫描 +
 *          ALL≡_l1 二义性（同 key 不得同时声明 ALL 与 L1）+ 反解一致 + 未知显式抛错
 *   QA-T4  A-04 密度：res/com/ind 三档齐备、densityToSuffix 单一映射、绘制侧真实产出 d1/d2/d3
 *   QA-T5  A-06 范围纪律：deferredCould 仅标记，resident/onDemand/excluded 与 T-118 基线逐档一致
 *   QA-T6  P-01 相机数学：包围盒 / L0 适配 / 世界中心映射 / 切档与 zoomAround 逐点等价 / 逆变换
 *   QA-T7  D-06 加固：绕过面禁令在位（读实现方用例文本做「防放松」守卫）+ 本文件独立重扫
 *   QA-T8  D-07/D-08 收口：README 行数与实际一致（抽查 3 模块）、diffViewModel 格级口径入注释与 README
 *   QA-T9  A-07/A-08/A-14：hex 每值只出现一次、全令牌有 inkOnDark、构造参数为 options（无位置 _lod）
 *
 * 纪律：只读 src/、tests/、README；不写权威状态；不编造数值；DrawCall 一律「估算」。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  PATTERN_ALPHA,
  HIGH_CONTRAST_PATTERN_ALPHA,
  HIGH_CONTRAST_INK_OUTLINE_WIDTH,
  assertNamingCoverage,
  buildDrawList,
  buildSemanticTokenMap,
  buildViewModel,
  cellWorldBounds,
  contrastRatio,
  createDefaultConfig,
  createInitialState,
  densityToSuffix,
  fitTransform,
  fitsInViewport,
  fromSheetName,
  resolveLoadSet,
  screenToWorldPoint,
  statusColorSet,
  toSheetName,
  tokenById,
  worldToScreen,
  zoomAround,
  zoomScale,
  zoneIndex,
  VIRTUAL_ATLAS_MANIFEST,
  type CityState,
  type LodLevel,
} from '../../src/index.ts';

const LODS: LodLevel[] = ['L0', 'L1', 'L2'];

function paint(state: CityState, config: ReturnType<typeof createDefaultConfig>): void {
  const cells: [number, number, string, number][] = [
    [3, 5, 'R', 1],
    [4, 5, 'C', 2],
    [5, 5, 'I', 3],
  ];
  for (const [x, y, z, d] of cells) {
    const i = y * state.side + x;
    state.cells.zone[i] = zoneIndex(config, z);
    state.cells.density[i] = d;
  }
}

// ---------------------------------------------------------------------------
// QA-T1 A-02 状态语义碰撞（独立重算）
// ---------------------------------------------------------------------------

test('QA-T1 (color,shape) 全局唯一独立重算：status∪flow 全对不重复、同色必不同形、三态已迁出 status', () => {
  const map = buildSemanticTokenMap(createDefaultConfig().zoneTypes);
  const ids = Object.keys(map.byId);

  // ① status 三态确已移除；flow 恰为三态（A-02 的迁移动作）
  assert.deepEqual(Object.keys(map.status).sort(), [
    'status.disabled',
    'status.negative',
    'status.positive',
    'status.selected',
    'status.warning',
  ]);
  assert.deepEqual(Object.keys(map.flow).sort(), ['flow.clear', 'flow.congested', 'flow.slow']);

  // ② 全令牌 (color,shape) 两两唯一（我自己循环，不依赖实现方用例）
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = map.byId[ids[i]];
      const b = map.byId[ids[j]];
      assert.equal(
        a.color === b.color && a.shape === b.shape,
        false,
        ids[i] + ' 与 ' + ids[j] + ' 的 (color,shape) 完全相同：' + a.color + '/' + a.shape,
      );
      if (a.color === b.color) assert.notEqual(a.shape, b.shape, ids[i] + ' 与 ' + ids[j] + ' 同色同形');
    }
  }

  // ③ 点名核对（派单指定）
  // selected 无形状，但颜色与其它所有令牌不同 → 不产生「(色,无形状)」新碰撞
  const selected = tokenById(map, 'status.selected');
  assert.equal(selected.shape, 'none');
  const sameColorWithNone = ids.filter((id) => id !== 'status.selected' && map.byId[id].color === selected.color);
  assert.deepEqual(sameColorWithNone, [], 'selected 的颜色不得被任何其它令牌复用（否则 (色,无形状) 碰撞）');
  // flow.clear(✓) 与 positive(✓) 同形但异色
  const clear = tokenById(map, 'flow.clear');
  const positive = tokenById(map, 'status.positive');
  assert.equal(clear.shape, positive.shape, 'clear 与 positive 同为 ✓');
  assert.notEqual(clear.color, positive.color, '✓ 同形必须异色才能区分');
  // warning(!)/negative(✕) 与 flow.slow(↑)/congested(↓) 同色异形
  assert.equal(tokenById(map, 'status.warning').color, tokenById(map, 'flow.slow').color);
  assert.equal(tokenById(map, 'status.warning').shape, 'exclamation');
  assert.equal(tokenById(map, 'flow.slow').shape, 'arrow-up');
  assert.equal(tokenById(map, 'status.negative').color, tokenById(map, 'flow.congested').color);
  assert.equal(tokenById(map, 'status.negative').shape, 'cross');
  assert.equal(tokenById(map, 'flow.congested').shape, 'arrow-down');
  // 事件态形状符合派单：positive=✓ / warning=! / negative=✕ / disabled=锁 / selected=无
  assert.deepEqual(
    ['positive', 'warning', 'negative', 'disabled', 'selected'].map((k) => map.status['status.' + k].shape),
    ['check', 'exclamation', 'cross', 'lock', 'none'],
  );
  // 状态 / 流线色 ∈ 状态色集，且 ∉ 分区色（隔离仍成立）
  const statusColors = statusColorSet(map);
  for (const id of ['status.positive', 'status.warning', 'status.negative', 'flow.clear', 'flow.slow', 'flow.congested']) {
    assert.ok(statusColors.has(tokenById(map, id).color), id + ' 应计入状态色集');
  }
  const zoneColors = new Set(['R', 'C', 'I'].map((z) => tokenById(map, 'zone.' + z).color));
  for (const c of statusColors) assert.equal(zoneColors.has(c), false, '状态色 ' + c + ' 不得复用分区色');
});

// ---------------------------------------------------------------------------
// QA-T2 A-05 高对比模式：只改强度，不改色值
// ---------------------------------------------------------------------------

test('QA-T2 高对比开关：默认关闭且视觉不变；开启后仅 alpha/描边变，全令牌色值与键集逐项相同', () => {
  assert.equal(PATTERN_ALPHA, 0.18);
  assert.equal(HIGH_CONTRAST_PATTERN_ALPHA, 0.3);
  assert.equal(HIGH_CONTRAST_INK_OUTLINE_WIDTH, 1);

  const normal = buildSemanticTokenMap(['R', 'C', 'I']);
  assert.equal(normal.highContrast, false, '默认必须关闭');
  assert.equal(normal.patternAlpha, PATTERN_ALPHA, '默认 0.18');
  assert.equal(normal.patternInkOutlineWidth, 0, '默认无描边');

  const hi = buildSemanticTokenMap(['R', 'C', 'I'], { highContrast: true });
  assert.equal(hi.highContrast, true);
  assert.equal(hi.patternAlpha, HIGH_CONTRAST_PATTERN_ALPHA);
  assert.equal(hi.patternInkOutlineWidth, HIGH_CONTRAST_INK_OUTLINE_WIDTH);

  // 键集与全部颜色 / 图案 / 形状 / 标签 / ink 逐项相同（高对比不得改任何色值）
  assert.deepEqual(Object.keys(hi.byId).sort(), Object.keys(normal.byId).sort());
  for (const id of Object.keys(normal.byId)) {
    const a = normal.byId[id];
    const b = hi.byId[id];
    assert.equal(b.color, a.color, id + ' 高对比改色');
    assert.equal(b.pattern, a.pattern);
    assert.equal(b.shape, a.shape);
    assert.equal(b.label, a.label);
    assert.equal(b.ink, a.ink);
    assert.equal(b.inkOnDark, a.inkOnDark);
    assert.equal(b.contrast.ratio, a.contrast.ratio);
  }
  // lod 语义参数不影响色板（A-14：options 化，不再有位置 _lod）
  const lodMap = buildSemanticTokenMap(['R', 'C', 'I'], { lod: 'L2' });
  assert.deepEqual(Object.keys(lodMap.byId).sort(), Object.keys(normal.byId).sort());
  for (const id of Object.keys(normal.byId)) assert.equal(lodMap.byId[id].color, normal.byId[id].color);
});

// ---------------------------------------------------------------------------
// QA-T3 A-01 命名映射（自写 §0.3 正则，不 import 实现正则）
// ---------------------------------------------------------------------------

/** asset-spec §0.3 类别前缀固定词表（**本文件自写**，与实现常量无耦合） */
const SPEC_PREFIXES = [
  'tile', 'grid', 'overlay', 'road', 'flow', 'bld', 'veg', 'shadow', 'ao',
  'sky', 'pat', 'ui', 'icon', 'vfx', 'font', 'brand', 'a11y',
];

function violatesSpec_0_3(name: string): string | null {
  if (name !== name.toLowerCase()) return '含大写';
  if (/\s/.test(name)) return '含空格';
  if (/[^\x00-\x7f]/.test(name)) return '含非 ASCII（中文等）';
  if (name.indexOf('__') >= 0 || name.startsWith('_') || name.endsWith('_')) return '空段';
  if (!/_l[012]$/.test(name)) return '缺 _lN 后缀';
  const prefix = name.split('_')[0];
  if (SPEC_PREFIXES.indexOf(prefix) < 0) return '前缀不在固定词表：' + prefix;
  if (!/^[a-z0-9_]+$/.test(name)) return '含非法字符';
  return null;
}

test('QA-T3 命名映射层：按 asset-spec §0.3 独立正则全覆盖零违规、ALL≡_l1 二义被拒、反解一致', () => {
  const coverage = assertNamingCoverage(VIRTUAL_ATLAS_MANIFEST);
  assert.equal(coverage.ok, true, '清单全覆盖应零错误：' + coverage.errors.join(' | '));
  assert.equal(coverage.uniqueNames, coverage.mapped, '规范名无碰撞');

  // ① 每一个清单条目 → 规范名，用我自写的规则逐条校验
  for (const entry of VIRTUAL_ATLAS_MANIFEST) {
    const sheet = toSheetName(entry.assetKey, entry.lod);
    const bad = violatesSpec_0_3(sheet);
    assert.equal(bad, null, entry.key + ' → ' + sheet + ' 违规：' + bad);
    // ② 反解：assetKey 必须回到自身；ALL 资产回 L1（代表名口径，头部已声明）
    const back = fromSheetName(sheet);
    assert.equal(back.assetKey, entry.assetKey, '反解 assetKey 不一致：' + sheet);
    if (entry.lod !== 'ALL') assert.equal(back.lod, entry.lod, '反解 LOD 不一致：' + sheet);
    else assert.equal(back.lod, 'L1', 'ALL 资产代表名 _l1 → 反解回 L1（口径已披露）');
    // ③ 再正向：反解结果重新命名必须得回同一个名字（无信息丢失）
    assert.equal(toSheetName(back.assetKey, back.lod), sheet, '正反往返不稳定：' + sheet);
  }

  // ④ ALL≡_l1 二义性：同一 assetKey 不得同时声明 ALL 与 L1（否则代表名被复用）
  const declared = new Map<string, Set<string>>();
  for (const e of VIRTUAL_ATLAS_MANIFEST) {
    const set = declared.get(e.assetKey) ?? new Set<string>();
    set.add(e.lod);
    declared.set(e.assetKey, set);
  }
  for (const [key, lods] of declared) {
    assert.equal(lods.has('ALL') && lods.has('L1'), false, key + ' 同时声明 ALL 与 L1（_l1 代表名二义）');
  }

  // ⑤ 未知键 / 未知名双向显式抛错（不得静默兜底，否则真实切片会错配）
  assert.throws(() => toSheetName('no_such_asset', 'L1'), /no sheet name mapping/);
  assert.throws(() => fromSheetName('bld_unknown_base_l1'), /unknown sheet name/);
  assert.throws(() => toSheetName('tile_empty', 'L9' as unknown as LodLevel), /unsupported lod/);
});

// ---------------------------------------------------------------------------
// QA-T4 A-04 密度三档
// ---------------------------------------------------------------------------

test('QA-T4 密度三档：res/com/ind 均有 d1/d2/d3，densityToSuffix 单一映射，绘制侧真实产出三变体', () => {
  for (const base of ['building_res', 'building_com', 'building_ind']) {
    for (const d of ['d1', 'd2', 'd3']) {
      const key = base + '_' + d;
      const found = VIRTUAL_ATLAS_MANIFEST.filter((e) => e.assetKey === key && e.lod === 'L1');
      assert.equal(found.length, 1, key + '@L1 应恰有一条占位条目');
      assert.ok(found[0].zoneGate !== undefined, key + ' 缺 zoneGate');
    }
  }
  // 高度：低密严格更矮；中/高不降（占位帧尺寸；绘制层另有 d2/d3 高度差）
  for (const base of ['building_res', 'building_com', 'building_ind']) {
    const h = ['d1', 'd2', 'd3'].map((d) => {
      const e = VIRTUAL_ATLAS_MANIFEST.find((x) => x.assetKey === base + '_' + d && x.lod === 'L1');
      assert.ok(e !== undefined);
      return e.rect.h;
    });
    assert.ok(h[0] < h[1], base + ' 中密帧高须大于低密：' + h.join('/'));
    assert.ok(h[1] <= h[2], base + ' 高密帧高不得低于中密：' + h.join('/'));
  }

  // densityToSuffix 单一映射（0/1/2/3/越界/负/NaN）
  assert.equal(densityToSuffix(0), '');
  assert.equal(densityToSuffix(1), 'd1');
  assert.equal(densityToSuffix(2), 'd2');
  assert.equal(densityToSuffix(3), 'd3');
  assert.equal(densityToSuffix(4), 'd3');
  assert.equal(densityToSuffix(-1), '');
  assert.equal(densityToSuffix(Number.NaN), '');

  // 绘制侧：R/d1 + C/d2 + I/d3 必须产出三种变体且无缺帧
  const config = createDefaultConfig();
  const state = createInitialState(config);
  paint(state, config);
  const list = buildDrawList(buildViewModel(state), VIRTUAL_ATLAS_MANIFEST, 'L1');
  const buildingKeys = list.sprites.filter((s) => s.kind === 'building').map((s) => s.assetKey).sort();
  assert.deepEqual(buildingKeys, ['building_com_d2', 'building_ind_d3', 'building_res_d1']);
  assert.equal(list.skipped, 0, '三档变体齐备时不应有缺帧跳过');
});

// ---------------------------------------------------------------------------
// QA-T5 A-06 deferredCould 只标记、加载行为零变化
// ---------------------------------------------------------------------------

test('QA-T5 deferredCould 仅标记：三档 resident/onDemand/excluded 与 T-118 基线逐档一致', () => {
  // T-118 基线（A-06 前的行为，逐档硬编码为期望值）
  const baseline: Record<LodLevel, { onDemand: string[]; excluded: string[] }> = {
    L0: { onDemand: ['建筑-居住'], excluded: ['昼夜窗光', '天气', '植被', 'VFX', '建筑-商业', '建筑-产业', '建筑-公共服务'] },
    L1: { onDemand: ['建筑-居住', '植被', 'VFX', '天气'], excluded: ['昼夜窗光', '建筑-商业', '建筑-产业', '建筑-公共服务'] },
    L2: { onDemand: ['建筑-居住', '植被', 'VFX', '昼夜窗光', '天气'], excluded: ['建筑-商业', '建筑-产业', '建筑-公共服务'] },
  };
  for (const lod of LODS) {
    const set = resolveLoadSet(['R'], lod, VIRTUAL_ATLAS_MANIFEST);
    assert.deepEqual(set.resident, ['UI', 'UI-图案编码', '地形地块', '道路'], lod + ' resident 基线不变');
    assert.deepEqual([...set.onDemand].sort(), baseline[lod].onDemand.slice().sort(), lod + ' onDemand 基线不变');
    assert.deepEqual([...set.excluded].sort(), baseline[lod].excluded.slice().sort(), lod + ' excluded 基线不变');
    // 仅新增标记，不改变加载集合（基线已在上方逐档比对）；标记组与 resident 不相交，
    // 且必须落在 onDemand ∪ excluded 内（L1 天气 / L2 两组按 art-bible「仅 L2 开放」本就被加载，
    // 因此「标记 ≠ 未加载」——标记语义是「Could 预留，MVP 期由上层忽略」，不是加载开关）
    assert.deepEqual([...set.deferredCould].sort(), ['天气', '昼夜窗光'], lod + ' deferredCould 恒为两组标记');
    const decided = new Set<string>([...set.onDemand, ...set.excluded]);
    for (const id of set.deferredCould) {
      assert.equal(set.resident.indexOf(id) >= 0, false, id + ' 不得同时 resident（常驻集不含 Could 组）');
      assert.ok(decided.has(id), id + ' 必须显式出现在 onDemand 或 excluded（不得悬空）');
    }
  }
});

// ---------------------------------------------------------------------------
// QA-T6 P-01 相机数学
// ---------------------------------------------------------------------------

test('QA-T6 相机数学：包围盒 / L0 全图适配 / 世界中心恒映射视口中心 / 切档与 zoomAround 逐点等价', () => {
  const vw = 1060;
  const vh = 740;

  // ① 16×16 包围盒 = 2048×1024（菱形四角参与）
  const bounds = cellWorldBounds(16);
  assert.deepEqual(bounds, { minX: -1024, maxX: 1024, minY: 0, maxY: 1024 });

  // ② L0 全图适配（留白 8px 内），L1/L2 属预期局部放大
  const t0 = fitTransform(bounds, vw, vh, 'L0');
  assert.equal(fitsInViewport(bounds, t0, vw, vh, 8), true, 'L0 必须全图可见（8px 留白内）');
  assert.equal(fitsInViewport(bounds, fitTransform(bounds, vw, vh, 'L1'), vw, vh, 8), false, 'L1 局部放大属预期');
  assert.equal(fitsInViewport(bounds, fitTransform(bounds, vw, vh, 'L2'), vw, vh, 8), false, 'L2 局部放大属预期');

  // ③ 世界中心在每档都映射到视口中心（切档 worldCenter 不变）
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  for (const lod of LODS) {
    const t = fitTransform(bounds, vw, vh, lod);
    assert.equal(t.worldCenterX, center.x, lod + ' worldCenterX 恒定');
    assert.equal(t.worldCenterY, center.y, lod + ' worldCenterY 恒定');
    const s = worldToScreen(center, t);
    assert.ok(Math.abs(s.x - vw / 2) < 1e-9 && Math.abs(s.y - vh / 2) < 1e-9, lod + ' 世界中心须在视口中心');
  }

  // ④ 切档等价 zoomAround（锚点 = 视口中心）：任取世界点，先 L_x 屏幕再换算到 L_y，
  //    必须等于「以视口中心为锚点 zoomAround」的结果（无平移漂移）
  const probes = [
    { x: 0, y: 0 },
    { x: center.x, y: center.y },
    { x: -640, y: 320 },
    { x: 1024, y: 1024 },
    { x: -1024, y: 0 },
  ];
  for (const from of LODS) {
    for (const to of LODS) {
      const tFrom = fitTransform(bounds, vw, vh, from);
      const tTo = fitTransform(bounds, vw, vh, to);
      for (const p of probes) {
        const sFrom = worldToScreen(p, tFrom);
        const sTo = worldToScreen(p, tTo);
        const viaZoom = zoomAround(sFrom, { x: vw / 2, y: vh / 2 }, from, to);
        assert.ok(Math.abs(sTo.x - viaZoom.x) < 1e-9, from + '→' + to + ' x 漂移 @' + JSON.stringify(p));
        assert.ok(Math.abs(sTo.y - viaZoom.y) < 1e-9, from + '→' + to + ' y 漂移 @' + JSON.stringify(p));
      }
    }
  }

  // ⑤ 变换可逆（屏幕 → 世界 → 屏幕）
  for (const lod of LODS) {
    const t = fitTransform(bounds, vw, vh, lod);
    for (const p of probes) {
      const back = screenToWorldPoint(worldToScreen(p, t), t);
      assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9, lod + ' 变换不可逆 @' + JSON.stringify(p));
    }
    assert.equal(t.zoom, zoomScale(lod), lod + ' zoom 必须取固定档位');
  }
});

// ---------------------------------------------------------------------------
// QA-T7 D-06 加固：禁令在位 + 独立重扫（防放松守卫）
// ---------------------------------------------------------------------------

test('QA-T7 D-06 加固生效：实现方用例含 12 条写路径禁令与 4 类色值模式，且独立重扫仍 0 命中', () => {
  const vmTest = readFileSync(join(process.cwd(), 'tests/unit/render-viewmodel.test.ts'), 'utf8');
  const tokenTest = readFileSync(join(process.cwd(), 'tests/unit/render-tokens.test.ts'), 'utf8');
  // 防放松：关键绕过面必须仍被用例覆盖（若被删，本用例立即红）
  for (const frag of ['\\.set / \\.fill', 'Object\\.assign', '整体替换 state 引用', '动态 import', 'simulation', 'process\\.hrtime']) {
    assert.ok(vmTest.indexOf(frag.replace(/\\\\/g, '\\')) >= 0 || vmTest.includes(frag.replace(/\\/g, '')), 'VM-8 缺禁令片段：' + frag);
  }
  for (const frag of ['0x[0-9a-fA-F]{6,8}', 'rgba?', 'hsla?', '拼接拼色']) {
    assert.ok(tokenTest.indexOf(frag) >= 0, 'TOKEN-5 缺色值模式：' + frag);
  }

  // 独立重扫（本文件自带规则，与实现无关）：写路径 / 颜色 / 引擎 / 时钟 / 越层
  const dir = join(process.cwd(), 'src', 'render');
  const files = readdirSync(dir, { recursive: true }).map((f) => String(f)).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length >= 9);
  for (const rel of files) {
    const raw = readFileSync(join(dir, rel), 'utf8');
    const noComments = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    // 写路径（含 .set/.fill/Object.assign/state=）
    assert.equal(/cells\.(zone|density|unlocked|region|inputVersion)\s*\[[^\]]*\]\s*=(?!=)/.test(noComments), false, rel + ' 写 cells');
    assert.equal(/cells\.(zone|density|unlocked|region|inputVersion)\s*\.\s*(set|fill)\s*\(/.test(noComments), false, rel + ' cells.set/fill');
    assert.equal(/Object\.assign\s*\(\s*(state|cells)/.test(noComments), false, rel + ' Object.assign');
    assert.equal(/(?<![\w.])state\s*=(?!=)/.test(noComments), false, rel + ' state 整体替换');
    assert.equal(/Date\.now|performance\.now|Math\.random/.test(noComments), false, rel + ' 时钟/随机');
    assert.equal(/from\s+['"][^'"]*\/simulation\//.test(noComments), false, rel + ' 越层');
    assert.equal(/(?:import|require)\s*\(\s*['"](?:cc|@ohos)/.test(noComments), false, rel + ' 动态引擎导入');
    if (!rel.endsWith('semantic-tokens.ts')) {
      assert.equal(/#[0-9a-fA-F]{3,8}\b|0x[0-9a-fA-F]{6,8}\b|\b(?:rgba?|hsla?)\s*\(/.test(noComments), false, rel + ' 出现色值');
    }
  }
});

// ---------------------------------------------------------------------------
// QA-T8 D-07 / D-08 收口
// ---------------------------------------------------------------------------

test('QA-T8 D-07 README 行数与实际一致（抽查 3 模块）+ D-08 diffViewModel 格级口径已文档化', () => {
  const readme = readFileSync(join(process.cwd(), 'src/README.md'), 'utf8');
  assert.ok(readme.indexOf('### 2.1 渲染层索引') >= 0, 'README 应有 §2.1 渲染层索引');
  for (const mod of ['iso', 'view-model', 'draw-list', 'semantic-tokens', 'asset-naming', 'atlas']) {
    const actual = readFileSync(join(process.cwd(), 'src/render/' + mod + '.ts'), 'utf8').split('\n').length - 1;
    const m = readme.match(new RegExp('\\| `src/render/' + mod + '\\.ts` \\| (\\d+) \\|'));
    assert.ok(m !== null, 'README 缺 ' + mod + ' 索引行');
    assert.equal(Number(m[1]), actual, mod + ' README 行数 ' + m[1] + ' ≠ 实际 ' + actual);
  }
  // D-08：README 与 view-model.ts 均须写明「格级」信号口径
  assert.ok(/diffViewModel[^\n]*只产[^\n]*格级|只产「格级」信号/.test(readme), 'README 缺 diffViewModel 格级口径说明');
  const vm = readFileSync(join(process.cwd(), 'src/render/view-model.ts'), 'utf8');
  assert.ok(/格级/.test(vm), 'view-model.ts 注释须写明格级信号口径');
  assert.ok(/(S|tickId)[^\n]*(budget|非格)/.test(vm), 'view-model.ts 须点明非格字段无信号');
});

// ---------------------------------------------------------------------------
// QA-T9 A-07 / A-08 / A-14
// ---------------------------------------------------------------------------

test('QA-T9 A-07 每色值只定义一次 + A-08 全令牌有 inkOnDark + A-14 构造参数 options 化', () => {
  const src = readFileSync(join(process.cwd(), 'src/render/semantic-tokens.ts'), 'utf8');
  const hexes = src.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
  const count = new Map<string, number>();
  for (const h of hexes) count.set(h, (count.get(h) ?? 0) + 1);
  const dups = [...count.entries()].filter(([, n]) => n > 1);
  assert.deepEqual(dups, [], '同一 hex 出现多次（A-07 要求每色只定义一次）：' + dups.map(([h, n]) => h + '×' + n).join(','));

  // A-08：全部令牌都有 inkOnDark；深底令牌的 inkOnDark 在其自身色上达 AA（禁用态豁免）
  const map = buildSemanticTokenMap(createDefaultConfig().zoneTypes);
  for (const id of Object.keys(map.byId)) {
    const t = tokenById(map, id);
    assert.ok(typeof t.inkOnDark === 'string' && t.inkOnDark.length > 0, id + ' 缺 inkOnDark');
  }
  for (const id of ['status.positive', 'status.warning', 'status.negative', 'flow.clear', 'flow.slow', 'flow.congested']) {
    const t = tokenById(map, id);
    assert.ok(contrastRatio(t.inkOnDark, t.color) >= 3, id + ' inkOnDark 对比度不足（A-08）');
  }

  // A-14：buildSemanticTokenMap 只剩 (zoneTypes, options?) 两参（默认值 ⇒ length === 1），无位置 _lod
  assert.equal(buildSemanticTokenMap.length, 1, '不得再有位置 _lod 参数');
});
