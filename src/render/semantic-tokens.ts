/**
 * HC-01 · 渲染内核 · 语义令牌映射（SemanticTokenMap，S-06）
 *
 * 权威口径（只读引用）：
 * - architecture.md §9.1（M14）：分区 / 状态先输出**语义令牌**（`zone.residential`、
 *   `status.congested`…），由 `SemanticTokenMap` 统一映射为「色值 + 图案 + 形状 +
 *   文字标签 + 对比度」；全项目色值集中色板，**禁止贴图内硬编码近似色**。
 * - art-bible §3.2：MVP 3 类分区色值 + 图案编码；§3.3 通勤流量色；§3.4 状态色与
 *   四重隔离（状态色不得复用 / 衍生分区色，形状不得借分区图案，**任一状态「色 + 形状」
 *   两维可区分**）；§3.5 配色纪律（分区组与状态组互不引用）；§9.2 双通道 + 高对比模式
 *   （图案不透明度 12–18% → 高对比 30% + 1px 深色描边，asset-spec M-093）。
 *
 * ⚠️ 纪律：**全项目十六进制色值只允许出现在本文件**。其他 render 模块若出现
 * `#rrggbb` / `#rgb` / `0xRRGGBB` / `rgb()` / `hsl()` / 拼色字面量即判失败
 * （`tests/unit/render-tokens.test.ts` 与 QA 复核套件静态扫描断言）。
 * 渲染 / UI 侧只能按令牌 id 取色，不得在绘制代码里写色值。
 *
 * T-121 修复（art-director A-02 / A-05 / A-07 / A-08）：
 * - A-02：(color, shape) 组合**全局唯一**。通勤三态从 `status.*` 移除、只保留
 *   `flow.*`（clear=✓ / slow=↑ / congested=↓），事件态为 positive=✓ / warning=! /
 *   negative=✕ / disabled=锁。同色不同形状 → 同屏可区分且不新增色值。
 * - A-05：图案不透明度提为配置（`PATTERN_ALPHA` 0.18 / 高对比 0.30 +
 *   `HIGH_CONTRAST_INK_OUTLINE_WIDTH`），`highContrast` 开关入参，**默认关闭、视觉不变**。
 * - A-07：同一语义色**只定义一个 hex 字面量**（`SEMANTIC` 常量是唯一出处），
 *   消除此前 clear/slow/congested 在两组内重复定义。
 * - A-08：令牌补 `inkOnDark`（深底用浅墨）；状态色为 L40–50 深底，叠字须用浅墨。
 */

import type { LodLevel } from './iso.ts';

/** 分区图案编码（art-bible §3.2；仅允许这 6 种 + none） */
export type ZonePattern = 'dots' | 'diagonal-45' | 'grid-lines' | 'cross' | 'canopy' | 'vertical-bars' | 'none';

/** 状态形状编码（art-bible §3.4：✓ / ! / ✕ / 锁 / ↑ / ↓ / 三角 / 横杠；**禁借分区图案**） */
export type StatusShape = 'check' | 'exclamation' | 'cross' | 'lock' | 'arrow-up' | 'arrow-down' | 'triangle' | 'dash' | 'none';

export interface ContrastInfo {
  /** 令牌色 vs 页面底色的 WCAG 对比度（相对亮度比） */
  ratio: number;
  /** 是否达到 AA 门槛（图标 / 组件 / 大字 ≥ 3:1；正文另需 ≥4.5:1，见 §3.5） */
  passesAA: boolean;
}

export interface SemanticToken {
  id: string;
  group: 'base' | 'zone' | 'status' | 'flow';
  /** 填充 / 前景色（唯一色值来源） */
  color: string;
  pattern: ZonePattern;
  shape: StatusShape;
  /** 文字标签（分区 = 色 + 图案 + 文字三编码；状态 = 色 + 形状） */
  label: string;
  contrast: ContrastInfo;
  /** 叠在该色上的文字 / 图形用色（浅底分区填充 → 深墨，见 §3.5 对比硬线） */
  ink: string;
  /** 深底用浅墨（状态色 L40–50 上叠字 / 描边用；A-08） */
  inkOnDark: string;
  /**
   * 该色**在主底 `base.canvas` 上**是否满足正文对比度（SC 1.4.3 / 官方 2.1.4.1 的 4.5:1）。
   * 由 `contrastRatio(color, BASE.canvas) >= AA_TEXT_THRESHOLD` 算出，**不是手写常量**。
   *
   * `false` 表示**禁止用于承载语义的文本**（S-12 裁定：`base.inkWeak` 2.31:1 即属此类，
   * 用途限定为装饰线 / 分割线 / 非活动标示；若任何文本节点引用 `textSafe === false`
   * 的令牌，即视为 `AC-A02-1` 不达标——守卫见 `tests/unit/token-text-safety.test.ts`）。
   * 注意这是**必要条件**：正文的唯一权威色仍是 `base.ink`。
   */
  textSafe: boolean;
}

export interface SemanticTokenMap {
  readonly base: Readonly<Record<string, SemanticToken>>;
  /** `zone.<zoneId>` */
  readonly zones: Readonly<Record<string, SemanticToken>>;
  /** `status.<statusKey>`（事件 / 交互状态，五项） */
  readonly status: Readonly<Record<string, SemanticToken>>;
  /** `flow.<flowKey>`（通勤流量三态；与状态同色不同形状） */
  readonly flow: Readonly<Record<string, SemanticToken>>;
  readonly byId: Readonly<Record<string, SemanticToken>>;
  /** 常规图案不透明度（art-bible §3.2：12–18%） */
  readonly patternAlpha: number;
  /** 高对比模式图案不透明度（asset-spec M-093：30%） */
  readonly highContrastPatternAlpha: number;
  /** 高对比模式图案描边宽度（1px 深色描边） */
  readonly patternInkOutlineWidth: number;
  readonly highContrast: boolean;
}

// ---------------------------------------------------------------------------
// 色板（**唯一** hex 来源；分组隔离见 art-bible §3.5）
// ---------------------------------------------------------------------------

/** 基底与品牌色（art-bible §3.1） */
const BASE = {
  canvas: '#F4F6F8', // 画布 / 地面 · 混凝土白
  tileBase: '#E8ECEF', // 地块基色 · 浅冷灰
  panel: '#F7F8FA', // 面板底 · 灰蓝白
  divider: '#DCE2E8', // 分隔线 · 淡灰蓝
  primary: '#2E6BE6', // 主色 · 市政蓝（仅经 status.selected 令牌出口，不单列 base 令牌，避免 (color,shape) 重复）
  primaryDark: '#1B4FC0',
  primaryLight: '#E8F0FF',
  accent: '#F59E23',
  inkPrimary: '#1B2430',
  inkSecondary: '#5A6675',
  inkWeak: '#9AA5B1',
} as const;

/**
 * 状态语义色（art-bible §3.4 / §3.3）——**每个 hex 只在此定义一次**（A-07）。
 * 事件态与通勤态共用色值（§3.3 允许），但形状不同以保「色 + 形状」二维可辨（A-02）。
 */
const SEMANTIC = {
  positive: '#0B7A4B', // 正向 / 满足 / 可用
  warning: '#A85C00', // 提示 / 警告 · 亦通勤「缓行」
  negative: '#C0261D', // 负向 / 拥堵 / 不满 · 亦通勤「拥堵」
  disabled: '#B8C0C8', // 禁用 / 未解锁（中性，不占色相）
  selected: BASE.primary, // 选中 / 焦点
  clear: '#5B7A8C', // 通勤「畅通」（中性灰蓝）
} as const;

/** 分区组（art-bible §3.2；低饱和 L≈70–80，只用于填充；异于状态 / 流线色） */
const ZONE_COLORS: Readonly<Record<string, string>> = {
  R: '#A8BE72', // 居住 · 暖琥珀绿
  C: '#4C96C9', // 商业 · 青蓝
  I: '#C08A62', // 产业 · 橙灰
  CIVIC: '#7B78C4', // 公共服务（Should）· 靛紫
  PARK: '#2E9E7B', // 绿地（Could 变体）· 青绿
  OFFICE: '#9B8AD9', // 商务（Could 变体）· 紫
};

const ZONE_PATTERN: Readonly<Record<string, { pattern: ZonePattern; label: string }>> = {
  R: { pattern: 'dots', label: '居住' },
  C: { pattern: 'diagonal-45', label: '商业' },
  I: { pattern: 'grid-lines', label: '产业' },
  CIVIC: { pattern: 'cross', label: '公共服务' },
  PARK: { pattern: 'canopy', label: '绿地' },
  OFFICE: { pattern: 'vertical-bars', label: '商务' },
};

/**
 * 事件 / 交互状态（**(color, shape) 组合全局唯一**——A-02）。
 * 形状取自 art-bible §3.4 白名单，绝不使用分区图案。
 */
const STATUS_SHAPE: Readonly<Record<string, { color: string; shape: StatusShape; label: string }>> = {
  positive: { color: SEMANTIC.positive, shape: 'check', label: '正向 / 满足 / 可用' },
  warning: { color: SEMANTIC.warning, shape: 'exclamation', label: '提示 / 警告' },
  negative: { color: SEMANTIC.negative, shape: 'cross', label: '负向 / 拥堵 / 不满' },
  disabled: { color: SEMANTIC.disabled, shape: 'lock', label: '禁用 / 未解锁' },
  selected: { color: SEMANTIC.selected, shape: 'none', label: '选中 / 焦点（2px 描边 + 光晕）' },
};

/**
 * 通勤流量叠加层（art-bible §3.3）：同色不同形状，与事件态可区分（A-02）。
 * clear=✓ / slow=↑ / congested=↓ —— 与 positive=✓ 同形不同色、与 warning=!/negative=✕ 同色不同形。
 */
const FLOW_SHAPE: Readonly<Record<string, { color: string; shape: StatusShape; label: string }>> = {
  clear: { color: SEMANTIC.clear, shape: 'check', label: '通勤畅通（细线 + 低亮度）' },
  slow: { color: SEMANTIC.warning, shape: 'arrow-up', label: '通勤缓行（线宽加粗 + 亮度提升）' },
  congested: { color: SEMANTIC.negative, shape: 'arrow-down', label: '通勤拥堵（最粗 + 最高亮度 + 脉冲）' },
};

// ---------------------------------------------------------------------------
// 图案不透明度（A-05：高对比模式预留，默认关闭、视觉不变）
// ---------------------------------------------------------------------------

/** 常规图案不透明度（art-bible §3.2：12–18%，取上界 18%） */
export const PATTERN_ALPHA = 0.18;
/** 高对比模式图案不透明度（asset-spec M-093 / art-bible §3.2：30%） */
export const HIGH_CONTRAST_PATTERN_ALPHA = 0.3;
/** 高对比模式图案描边宽度（1px 深色描边） */
export const HIGH_CONTRAST_INK_OUTLINE_WIDTH = 1;

export function patternAlphaFor(highContrast: boolean): number {
  return highContrast ? HIGH_CONTRAST_PATTERN_ALPHA : PATTERN_ALPHA;
}

export interface SemanticTokenOptions {
  /** 高对比模式（默认 false；仅影响图案不透明度与描边宽度，不改任何色值） */
  highContrast?: boolean;
  /**
   * LOD 档位（预留）：令牌**不随 LOD 变化**（三档同图集、同色板）；
   * 图案强度差异由 `patternAlpha` 与绘制层承担，保留此参数仅为调用方语义完整。
   */
  lod?: LodLevel;
}

// ---------------------------------------------------------------------------
// WCAG 对比度（零依赖实现；art-bible §3.5：正文 ≥4.5:1，图标 / 组件 ≥3:1）
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

function channelLuminance(c: number): number {
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG 2.1 相对对比度（1~21） */
export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** 图标 / UI 组件 / 大字的 AA 门槛（art-bible §3.5 = 3:1） */
export const AA_UI_THRESHOLD = 3;

/**
 * 正文的 AA 门槛（WCAG SC 1.4.3 = 4.5:1；与华为官方 2.1.4.1「正文 > 4.5:1」数值一致）。
 *
 * `textSafe` 的唯一判定依据：`contrastRatio(color, BASE.canvas) >= AA_TEXT_THRESHOLD`。
 * **这是必要条件而非充分条件**——textSafe=true 只说明「该色在主底上读得清」，
 * 不代表设计允许把它当正文用：正文的唯一权威色是 `base.ink`（UI 层另有零 hex 纪律）。
 * `base.inkWeak`（2.31:1）与各底色（自身 vs 自身 ≈ 1:1）会被本门槛正确判为 false。
 */
export const AA_TEXT_THRESHOLD = 4.5;

function contrastOf(color: string): ContrastInfo {
  const ratio = contrastRatio(color, BASE.canvas);
  return { ratio, passesAA: ratio >= AA_UI_THRESHOLD };
}

function makeToken(
  id: string,
  group: SemanticToken['group'],
  color: string,
  pattern: ZonePattern,
  shape: StatusShape,
  label: string,
): SemanticToken {
  // 浅底（base / zone）叠深墨；深底（status / flow，L≈40–50）叠浅墨（A-08）
  const onDark = group === 'status' || group === 'flow';
  // textSafe 按主底对比度实算（S-12 裁定）：不凭命名、不凭分组——inkWeak 2.31:1 → false，
  // 各底色自身对比 ≈1:1 → false。正文唯一权威色是 base.ink（必要条件见 AA_TEXT_THRESHOLD 注）。
  const ratio = contrastRatio(color, BASE.canvas);
  return {
    id,
    group,
    color,
    pattern,
    shape,
    label,
    contrast: contrastOf(color),
    ink: onDark ? BASE.canvas : BASE.inkPrimary,
    inkOnDark: BASE.canvas,
    textSafe: ratio >= AA_TEXT_THRESHOLD,
  };
}

// ---------------------------------------------------------------------------
// 令牌映射表
// ---------------------------------------------------------------------------

/**
 * 按 `config.zoneTypes` 动态生成 `zone.*` 令牌（增 / 减分区不改渲染代码）。
 * 未知分区类型走中性兜底（地块基色 + `none` 图案 + 原 id 作标签），
 * 不静默借用分区色、也不借用状态色（保持 §3.4 隔离）。
 */
export function buildSemanticTokenMap(zoneTypes: readonly string[], options: SemanticTokenOptions = {}): SemanticTokenMap {
  const highContrast = options.highContrast === true;
  const base: Record<string, SemanticToken> = {
    'base.canvas': makeToken('base.canvas', 'base', BASE.canvas, 'none', 'none', '画布 / 地面'),
    'base.tile': makeToken('base.tile', 'base', BASE.tileBase, 'none', 'none', '地块基色'),
    'base.panel': makeToken('base.panel', 'base', BASE.panel, 'none', 'none', '面板底'),
    'base.divider': makeToken('base.divider', 'base', BASE.divider, 'none', 'none', '分隔线'),
    'base.ink': makeToken('base.ink', 'base', BASE.inkPrimary, 'none', 'none', '文字·主'),
    'base.inkWeak': makeToken('base.inkWeak', 'base', BASE.inkWeak, 'none', 'none', '装饰线 / 非活动标示（非文字令牌，S-12 降级）'),
  };

  const zones: Record<string, SemanticToken> = {};
  for (let i = 0; i < zoneTypes.length; i++) {
    const zoneId = zoneTypes[i];
    const presetColor = ZONE_COLORS[zoneId];
    const presetStyle = ZONE_PATTERN[zoneId];
    const color = presetColor === undefined ? BASE.tileBase : presetColor;
    const pattern: ZonePattern = presetStyle === undefined ? 'none' : presetStyle.pattern;
    const label = presetStyle === undefined ? zoneId : presetStyle.label;
    zones['zone.' + zoneId] = makeToken('zone.' + zoneId, 'zone', color, pattern, 'none', label);
  }

  const status: Record<string, SemanticToken> = {};
  const statusKeys = Object.keys(STATUS_SHAPE);
  for (let i = 0; i < statusKeys.length; i++) {
    const k = statusKeys[i];
    const p = STATUS_SHAPE[k];
    status['status.' + k] = makeToken('status.' + k, 'status', p.color, 'none', p.shape, p.label);
  }

  const flow: Record<string, SemanticToken> = {};
  const flowKeys = Object.keys(FLOW_SHAPE);
  for (let i = 0; i < flowKeys.length; i++) {
    const k = flowKeys[i];
    const p = FLOW_SHAPE[k];
    flow['flow.' + k] = makeToken('flow.' + k, 'flow', p.color, 'none', p.shape, p.label);
  }

  const byId: Record<string, SemanticToken> = { ...base, ...zones, ...status, ...flow };
  return Object.freeze({
    base: Object.freeze(base),
    zones: Object.freeze(zones),
    status: Object.freeze(status),
    flow: Object.freeze(flow),
    byId: Object.freeze(byId),
    patternAlpha: patternAlphaFor(highContrast),
    highContrastPatternAlpha: HIGH_CONTRAST_PATTERN_ALPHA,
    patternInkOutlineWidth: highContrast ? HIGH_CONTRAST_INK_OUTLINE_WIDTH : 0,
    highContrast,
  });
}

/** 取令牌；缺失即抛错（渲染层不允许静默兜底色值——色值只能来自本文件） */
export function tokenById(map: SemanticTokenMap, id: string): SemanticToken {
  const t = map.byId[id];
  if (t === undefined) throw new Error('unknown semantic token: ' + id);
  return t;
}

/** 分区组全部色值（供「状态色 ∉ 分区色」隔离断言使用） */
export function zoneColorSet(map: SemanticTokenMap): ReadonlySet<string> {
  const s = new Set<string>();
  const keys = Object.keys(map.zones);
  for (let i = 0; i < keys.length; i++) s.add(map.zones[keys[i]].color);
  return s;
}

/** 状态组（含通勤叠加层）全部色值（供隔离断言使用） */
export function statusColorSet(map: SemanticTokenMap): ReadonlySet<string> {
  const s = new Set<string>();
  const groups = [map.status, map.flow];
  for (let gi = 0; gi < groups.length; gi++) {
    const keys = Object.keys(groups[gi]);
    for (let i = 0; i < keys.length; i++) s.add(groups[gi][keys[i]].color);
  }
  return s;
}
