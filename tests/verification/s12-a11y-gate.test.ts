/**
 * HC-01 · S-12 验收 2 · 可访问性 Standard 离线门禁（29 条执行层 AC 逐条登记）
 *
 * 权威上游（只读引用，不复制、不改写）：
 * - `design/accessibility/accessibility-matrix.md` **v0.3** §2.1~§2.10（29 条 AC，A-01~A-10）
 * - `design/art/art-bible.md` v0.2.1 §9.1 / §9.2 / §3.4 / §6.5 / §8.3
 * - `tests/traceability-matrix.md` §2.4（AC → 用例指向）/ §3.2（GAP-05/06/07/10/12）
 *
 * 【版本边界 · 必读】本文件按 **v0.2.1 / 27 条** 建账，随后已对齐 **v0.3 / 29 条**：
 * - A-05 触控热区 **44dp → 48dp**（用户裁定；华为《通用应用 UX 体验标准》2.1.3.3 推荐值
 *   48vp，官方「必须」下限 40vp）。`MIN_TAP_TARGET_DP` 与 `tests/unit/hud-a11y.test.ts`
 *   A11Y-1 / A11Y-3 已同批升到 48（边界 47 抛 / 48 过），本文件 AC-A05-1 同批对齐，
 *   并加双向守卫（`!== 40` / `!== 44`）挡住回退。这是**跟随上游收紧**、不是迁就实现：
 *   44 只满足官方「必须」档 40vp，未达推荐档 48vp，44 → 48 属收紧，不存在放松阈值；
 * - `AC-A09-2` 的判据定为「**A-01~A-08 的全部 24 条 AC 仍通过**」——24 = 4+3+4+3+3+3+2+2，
 *   **不含 A-09 自身的 3 条与 A-10 的 2 条**（主理人裁定，纠此前误写的 26 / 27）；
 * - **新增 A-10 组 2 条**（`AC-A10-1` 滑动控件高度 ≥ 屏高 20% · 华为 2.1.3.4「必须」；
 *   `AC-A10-2` 文本字号 ≥ 8vp 必须 / ≥ 12vp 宜 · 华为 **AppAnalyzer《规则总览》**，
 *   与 2.1.3.4 **不是同一份文档**，不得混引）。台账 **27 → 29 条**。
 *   ⚠️ 这两条当前都**判不了**：A10-1 本项目**无滑动控件对象**（记「不适用」+ 条件重开）、
 *   A10-2 无字号数据源（记「不适用」+ 条件重开）。**N/A ≠ PASS，不得据此宣称「29 条全通过」。**
 *   本文件对它们的处置是**如实报实测值 + 判据不闭合登记**，不记「达标」也不记「不达标」。
 *
 * ============================================================================
 * 一、本文件**不判什么** / 为什么 / 需要什么介质
 * ============================================================================
 *
 * 本机只有 TypeScript 源码（`src/**`）+ Node 22，**没有**：
 *   - Cocos Creator 工程（`assets/` / 场景树 / 图集导入）→ 无法出图、无法录帧；
 *   - DevEco Studio / hdc / HarmonyOS 真机（无 HAP、无设备）→ 无法实测 dp 与像素；
 *   - 色盲模拟器（deuteranopia / protanopia / tritanopia / 灰度）→ 无法做视觉判定；
 *   - 音频侧交付的「音频事件 → 视觉等价物清单」（矩阵 §4.3 O-1，即 GAP-06）。
 *
 * 因此本文件**不判**下列内容（逐条列明，不藏）：
 *   1. 任何需要「看」的判据：三型色盲模拟 / 灰度下是否 **100% 可区分**、选中态是否
 *      「放大」、面板 9-slice 是否撕裂、文字是否出血、连续 3 秒有无周期性像素变化。
 *   2. 任何需要「量」的判据：真机热区矩形实测、相邻控件实际间隙 dp、即时反馈延迟
 *      <100ms（且该值为**建议基线 / 非承诺值**，GAP-05 未冻结，不得作 PASS 硬判据）、
 *      低档位帧率与 DrawCall。
 *   3. 任何需要「可玩版本」的判据：单手完整通关一次市政周期、静音下完整通关、
 *      200% 下逐面板滚动可达性。
 *   4. 低 / 中 / 高**三档**性能位：`src/ui/hud/types.ts` 的 `PerformanceTier` 只有
 *      `'default' | 'low'` 两档，且 `src/**` 内无天气粒子 / 夜间窗光 / 接触 AO /
 *      LOD 阈值开关实现 → 三档切换与效果开关**离线无对象可判**（登记为实现缺口）。
 *   5. 「全部可交互控件」的**完备性**：`A11yControl` 只在测试里构造，`src/**` 没有
 *      生产侧控件清单、没有热区声明、没有 end-day 之外的标签表；矩阵点名的
 *      M-064 小地图折叠控件在 `src/**` 中不存在。
 *
 * ============================================================================
 * 二、本文件**不产生任何 PASS 结论**
 * ============================================================================
 *
 * 它只产生两样东西：
 *   (a) 「可离线判定的部分**已被真断言**」——断言失败即红，红即该片段不满足上游判据；
 *   (b) 「其余部分**被显式登记为不可判**」——C 档用 `{ skip: 理由 }` 落案，
 *       B 档在用例名与注释里点名「哪一半判不了、为什么、缺什么介质」。
 *
 * **29 条 AC 中没有任何一条可据此判定「通过」。** 低档位下 A-01~A-08 是否仍全部
 * 满足（AC-A09-2）亦不可据此判定。任何「可访问性达标」结论须待真机批次
 * （`design/accessibility/accessibility-matrix.md` §5 执行模板）人工签收。
 *
 * ============================================================================
 * 三、分档定义（A / B / C 三档；`PENDING-API` 已随 `gapDp` 落地解除，AC-A05-2 转 B）
 * ============================================================================
 *
 * | 档 | 含义 | 本文件中的形态 |
 * | --- | --- | --- |
 * | **A** | 该 AC 的**离线可判段落已全部断死** | 真断言；若仍有子句判不了，在用例名/注释/台账逐条列出 |
 * | **B** | 主体判据需真机 / 视觉 / 可玩版本，离线只能判前置结构条件 | 真断言（只判结构条件）+ 用例名标注「未判」 |
 * | **C** | 全部需真机 / 人工，离线无任何可判内容 | `test('AC-… ', { skip: 理由 }, () => {})`，**不写永真断言** |
 * | **PENDING-API** | 判据所依赖的实现契约尚未就绪 | `{ skip: 理由 }` 落案；**绝不**用有缺陷的现有 API 伪造「通过」 |
 *
 * 纪律：不放松任何阈值（4.5:1 / 3:1 / 48dp / ≥2 通道一律按上游原文；48dp 取华为
 * 2.1.3.3 推荐值，官方必须下限 40vp，本项目取推荐值）；判据常量全部
 * 引用上游权威值（`AA_UI_THRESHOLD` / `MIN_TAP_TARGET_DP`）或矩阵原文数字，不新造。
 *
 * ============================================================================
 * 四、29 条台账（本文件的自证清单；与下方用例一一对号）
 * ============================================================================
 *
 * | AC | 档 | 断言对象 / skip 理由 | 所需介质 | 备注 |
 * | --- | --- | --- | --- | --- |
 * | AC-A01-1 | B | 6 分区图案编码两两互异 + 标签可读；三型模拟/灰度「100% 可区分」未判 | 真机 + 色盲模拟 + 截图 | — |
 * | AC-A01-2 | B | 4 状态形状互异且非 none；(color,shape) 8 项全局唯一；视觉判定未判 | 真机 + 色盲模拟 | — |
 * | AC-A01-3 | B | 状态/通勤令牌 pattern 恒 none + 形状 ∈ 白名单；12 组合矩阵视觉判定未判 | 真机 + 12 组合截图 | 形状/图案命名空间同名（cross）待上游 |
 * | AC-A01-4 | A | 分区组 6 色 / 状态组 6 值 / 交集为空 / 无 alpha 衍生 | — | 「改明度衍生」不判（需 HSL 族分析） |
 * | AC-A02-1 | A | 主文字 vs canvas/panel/tile + MVP 3 分区填充上文字 ≥ 4.5:1 | — | CIVIC 实测 3.97:1（<4.5，MVP 未启用） |
 * | AC-A02-2 | A | 3 状态色 vs canvas ≥ 3:1；浅墨叠状态色 ≥ 3:1；全令牌 6 位 hex（不透明底） | — | disabled 1.70:1 见备注（WCAG 豁免未在上游声明） |
 * | AC-A02-3 | B | 高对比 / LOD 三档均不改色值（无叠色通道）；夜景雨雪叠色未实现 | 真机 + 叠色层 | MVP 限「晴朗白天」，只判该态 |
 * | AC-A03-1 | B | 开关存在且不重启生效（toggle → effects/immediate 立即变）；持久化未实现 | 真机 + 设置项 UI | 设置措辞/位置待 ux-spec X-6 |
 * | AC-A03-2 | B | 减动效态 loops/particles/cameraEase 三项全 false；「连续 3 秒无周期像素变化」未判 | 真机 + 帧录制 | — |
 * | AC-A03-3 | A | 8 类即时反馈减动效态改瞬时（durationMs 0 / static-*）+ 通道 ≥2 + 信息不丢 | — | 静态替代资产外观未判 |
 * | AC-A03-4 | B | BUILD_TABS 标签全可读 + 双通道断言通过（default 与 low 两档）；完备性未判 | 真机 + 控件遍历 | 小地图折叠器 / 图标按钮 / 开关在 src 无实现 |
 * | AC-A04-1 | A | 3 形态 × 100/150/200% 布局不截断 / 不溢出；越界抛错 | — | 等宽数字不抖动未判（真机） |
 * | AC-A04-2 | A | 三段 heightRatio 归一化（和 = 1，非固定宽高）+ 200% 不截断 | — | 9-slice 撕裂 / 文字出血未判 |
 * | AC-A04-3 | B | 200% 布局不溢出 + 单屏 ≤1 数据面板（L1/L2 单槽互斥）；滚动可达性未判 | 真机 + 逐面板展开 | — |
 * | AC-A05-1 | B | 常量 48 + 边界（47 抛 / 48 过）+ 声明的控件集逐项过断言；完备性未判 | 真机 + 热区实测 | src 无热区声明、无控件清单；48 取自官方 2.1.3.3 推荐值 |
 * | AC-A05-2 | B | `assertSpacing` 三态边界（8 过 / 7 抛 / 0 抛）+ 未声明 `gapDp` 抛错 + 末位不豁免 + 空数组 vacuous | 真机布局实测 | **只证断言逻辑正确**；`gapDp` 生产侧零生产者 → **不构成 AC 验收证据** |
 * | AC-A05-3 | B | 落位 API 只接受整数格（无亚格输入）+ 选中态 2px 描边存在；吸附容差/放大未判 | 真机 + 连续点选 20 次 | 吸附实现不在 src（输入适配层） |
 * | AC-A06-1 | C | skip：仅触控单手完成一次完整市政周期需可玩版本 + 真机 | 可玩 HAP + 真机 | PLAYTEST-ONLY |
 * | AC-A06-2 | B | roadClickPath 与逐格 road() 命令序列等价（4 格实测）+ src 无长按手势；手势实测未判 | 真机 | 长按子项当前无适用对象 |
 * | AC-A06-3 | A | 层级 Tab(1)+L1/L2(2) = 3 层（运行时枚举实测）+ src 无键盘 / 快捷键 | — | 悬浮多面板依赖由单槽互斥封死 |
 * | AC-A07-1 | A | 8 类 × 2 态通道数 ≥2 + tick 反馈 ≥2 + informationLost 恒 false | — | 视觉呈现质量未判 |
 * | AC-A07-2 | B | 去色 / 静音 / 动效关三态逐一判通道仍可达；<100ms 实测未判 | 真机 + 计时 | <100ms 为建议基线（GAP-05） |
 * | AC-A08-1 | C | skip：音频事件 → 视觉等价物清单未交付（GAP-06 / 矩阵 O-1），src 无音频实现 | 上游清单 + 真机 | GAP-06 未关闭前不可判 |
 * | AC-A08-2 | B | src 全仓零音频运行时依赖（剥注释后扫描 0 处）；完整静音通关未判 | 真机 + 可玩版本 | 「无音频」≠「音频冗余达标」 |
 * | AC-A09-1 | B | performanceTier 进入布局模型并原样保留；三档切换与效果开关未实现 | 实现 + 真机 | 仅 default/low 两档，无粒子/AO/LOD 开关 |
 * | AC-A09-2 | B | 低档下令牌层与 a11y 断言组不降级（即「低档不改变 A-01~A-08 的数据前提」）；真机低档复跑未判 | 真机 + 低档全量复跑 | 汇总项，成立依赖全部 A 档 + 真机部分 |
 * | AC-A09-3 | A | LOD L0/L1/L2 与 default/low 下 pattern / shape / contrast 全部不变 + 低档热区字号仍过 | — | 低档图案层实际绘制未判（真机截图） |
 * | AC-A10-1 | **不适用（无适用对象）+ 条件重开** | 三段 heightRatio 实测逐个报（ADR-005 后三形态统一：canvas 0.70、thumbZone 0.20、statusBar 0.10）+ `HudSegmentId` 仅 3 段；本项目**零滑动控件实例**（`src/` 全仓 `scroll|swipe|滑动|drag` 仅 `scrollY` 状态字段），`HudSegmentId` 为屏高分区非控件、对象错配 | UX《滑动控件清单》+ 真机 | **N/A ≠ PASS**；条件重开：UX 清单确有对象落入任一槽位即按「≥ 屏高 20%」判；ADR-005 已将 thumbZone 提至 0.20，届时不再撞算术死墙 |
 * | AC-A10-2 | **不适用（无对象）+ 条件重开** | 静态扫描：`src/**` 仅 5 处字体**资产命名键**（`font_ui_cjk` 等，`nonAtlas: true`），**零字号数值声明**、无文本渲染实现；`TEXT_LINE_DP` 是行高不是字号；`textScale` 是 100–200 **百分比**、非绝对字号 | 字号表 + vp/sp 换算基准 + 真机 | 用例通过 = 「缺口如登记所述」，**不是 AC 达标**；重开条件见用例内 ③ |
 *
 * 运行（仓库根目录）：
 *   node --experimental-strip-types --test tests/verification/s12-a11y-gate.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  AA_UI_THRESHOLD,
  buildSemanticTokenMap,
  contrastRatio,
  statusColorSet,
  tokenById,
  zoneColorSet,
  type SemanticTokenMap,
} from '../../src/render/semantic-tokens.ts';
import {
  BUILD_TABS,
  MIN_SPACING_DP,
  MIN_TAP_TARGET_DP,
  TEXT_LINE_DP,
  assertReachableAtTier,
  assertReducedMotionDualChannel,
  assertSpacing,
  assertTapTarget,
  assertTextScaleLayout,
  createLayoutModel,
  isReadableLabel,
  type A11yControl,
  type HudLayoutModel,
} from '../../src/ui/hud/index.ts';
import { IMMEDIATE_FEEDBACK_KINDS, createMotionPolicy } from '../../src/ui/motion-policy.ts';
import {
  UI_TABS,
  createInteractionController,
  type InteractionController,
  type UiSessionPort,
} from '../../src/ui/interaction-controller.ts';
import type { Command } from '../../src/core/types.ts';

// ---------------------------------------------------------------------------
// 判据常量（全部来自上游，不新造）
// ---------------------------------------------------------------------------

/**
 * 正文对比度门槛 4.5:1 —— 上游原文：`design/accessibility/accessibility-matrix.md`
 * §2.2 AC-A02-1「正文文字对底 ≥ 4.5:1（WCAG 2.1 AA）」。
 * `src/render/semantic-tokens.ts` 只导出了图标 / 大字门槛 `AA_UI_THRESHOLD`（3:1），
 * 正文门槛没导出 → 在此按上游原文取值，**不是**新造阈值。
 */
const AA_TEXT_THRESHOLD = 4.5;

/** 矩阵 §2.1 AC-A01-3 复述的 art-bible §3.4 形状白名单（状态形状只允许这些） */
const STATUS_SHAPE_WHITELIST: readonly string[] = Object.freeze([
  'check',
  'exclamation',
  'cross',
  'lock',
  'arrow-up',
  'arrow-down',
  'triangle',
  'dash',
  'none',
]);

/** MVP 分区（`src/core/config.ts` `PLACEHOLDER_DEFAULTS.zoneTypes = ['R','C','I']`） */
const MVP_ZONE_IDS: readonly string[] = Object.freeze(['R', 'C', 'I']);
/** 全分区色板（矩阵 AC-A01-4 的分区组 6 色；含 Should / Could 变体） */
const ALL_ZONE_IDS: readonly string[] = Object.freeze(['R', 'C', 'I', 'CIVIC', 'PARK', 'OFFICE']);
/** 矩阵 AC-A01-2 / A01-3 的 4 类状态 */
const FOUR_STATUS_KEYS: readonly string[] = Object.freeze(['positive', 'warning', 'negative', 'disabled']);
/** 矩阵 AC-A02-2 点名的 3 个状态色（`#0B7A4B / #A85C00 / #C0261D` 的令牌 id） */
const NAMED_STATUS_KEYS: readonly string[] = Object.freeze(['positive', 'warning', 'negative']);

const mvpTokens: SemanticTokenMap = buildSemanticTokenMap(MVP_ZONE_IDS);
const allZoneTokens: SemanticTokenMap = buildSemanticTokenMap(ALL_ZONE_IDS);

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

const SRC_ROOT = join(process.cwd(), 'src');

function srcFiles(): string[] {
  return readdirSync(SRC_ROOT, { recursive: true })
    .map((f) => String(f))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(SRC_ROOT, f));
}

/** 剥注释后再扫：注释里的散文（如「不得用 keydown」）不是代码，不能算命中 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function scanSrc(pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of srcFiles()) {
    if (pattern.test(stripComments(readFileSync(file, 'utf8')))) hits.push(file);
    pattern.lastIndex = 0;
  }
  return hits;
}

/**
 * 控件清单 **fixture**（不是生产数据，务必看清）：
 * - 5 个建造 Tab 的 `id` / `textLabel` 直接取自生产常量 `BUILD_TABS`（真数据）；
 * - `end-day` 的标签在 `src/**` **无生产出处**（`EndDayButton` 接口没有 label 字段），
 *   此处为 fixture，只为让 `assertReachableAtTier` 的核心控件清单闭合；
 *   故本 fixture 上的断言**不能**证明生产侧标签存在（见 AC-A03-4 / AC-A05-1 备注）；
 * - `tapTargetDp` 取 `MIN_TAP_TARGET_DP`（最小合法值），不另造数字；它不是实测值。
 */
function controlFixture(): A11yControl[] {
  const fromTabs: A11yControl[] = BUILD_TABS.map((tab) => ({
    id: 'tab:' + tab.id,
    textLabel: tab.label,
    tapTargetDp: MIN_TAP_TARGET_DP,
    labelIsTooltipOnly: false,
    gapDp: MIN_SPACING_DP,
  }));
  return [
    ...fromTabs,
    {
      // 末位控件：旧 assertSpacing 的 off-by-one 恰好漏掉它，故此处**显式给 gapDp**，
      // 让「末位也被遍历」可被断言（AC-A05-2 里再用末位=7dp 反向证明它真的被检查）。
      id: 'end-day',
      textLabel: '结束本日',
      tapTargetDp: MIN_TAP_TARGET_DP,
      labelIsTooltipOnly: false,
      gapDp: MIN_SPACING_DP,
    },
  ];
}

/** 最小 `UiSessionPort` 假实现（只做命令记录；不产生结算，故不动任何权威状态） */
function makeSession(): UiSessionPort & { readonly submitted: Command[] } {
  const submitted: Command[] = [];
  return {
    submitted,
    submit(command: Command): void {
      submitted.push(command);
    },
    advanceDay() {
      return { accepted: false, events: [] };
    },
    get gate() {
      return { isLocked: false };
    },
    get pendingCount() {
      return 0;
    },
    get tickId() {
      return 0;
    },
    get committedCount() {
      return 0;
    },
  };
}

function makeController(): InteractionController {
  return createInteractionController({ session: makeSession(), tokens: mvpTokens });
}

function layoutAt(formFactor: 'folded' | 'unfolded' | 'tablet', textScale: number, tier: 'default' | 'low'): HudLayoutModel {
  return createLayoutModel({
    formFactor,
    safeArea: [44, 0, 34, 0], // [top, right, bottom, left] 安全内边距 dp —— 与热区基线（48dp）无关
    textScale,
    performanceTier: tier,
  });
}

// ===========================================================================
// A-01 色盲友好（4 条）
// ===========================================================================

test('AC-A01-1 6 分区图案编码两两互异且标签可读（三型模拟 / 灰度 100% 可区分 未判 · B 档）', () => {
  // 【判得了】图案 + 文字两条非色通道的结构前提：6 个分区必须有 6 种互异图案 + 可读标签。
  // 【判不了】deuteranopia / protanopia / tritanopia 三型模拟与灰度下是否「100% 可区分」——
  //          需真机截图 + 色盲模拟器逐型比对，本机无 Cocos 工程、无真机、无模拟器。
  const tokens = ALL_ZONE_IDS.map((id) => tokenById(allZoneTokens, 'zone.' + id));
  assert.equal(tokens.length, 6, '分区组必须是 6 个（矩阵 AC-A01-4 的 6 色）');

  const patterns = tokens.map((t) => t.pattern);
  assert.ok(
    patterns.every((p) => p !== 'none'),
    '任一分区缺图案编码即等于只靠色相传达（锚点 7 硬要求）',
  );
  assert.equal(new Set(patterns).size, patterns.length, '6 个分区的图案编码必须两两互异，否则去色后仍不可区分');

  const labels = tokens.map((t) => t.label);
  for (const label of labels) {
    assert.ok(isReadableLabel(label), '分区文字标签不可读：' + label);
  }
  assert.equal(new Set(labels).size, labels.length, '分区文字标签必须互异（不得两区共用一个词）');

  // MVP 3 分区子集：不得出现「两区同图案」
  const mvpPatterns = MVP_ZONE_IDS.map((id) => tokenById(mvpTokens, 'zone.' + id).pattern);
  assert.equal(new Set(mvpPatterns).size, 3, 'MVP 3 分区（居住 / 商业 / 产业）图案必须互异');
});

test('AC-A01-2 4 类状态形状互异且（色 + 形状）组合全局唯一（三型模拟视觉判定 未判 · B 档）', () => {
  // 【判得了】「任一状态至少色 + 形状两通道」在令牌层是否成立：(color, shape) 必须全局唯一。
  // 【判不了】三型模拟 + 灰度下 4 类状态是否「100% 可区分」——需真机截图的视觉判定。
  const shapes = FOUR_STATUS_KEYS.map((k) => tokenById(mvpTokens, 'status.' + k).shape);
  assert.ok(
    shapes.every((s) => s !== 'none'),
    '4 类状态（正向 / 警告 / 负向 / 禁用）都必须有形状编码，否则单通道',
  );
  assert.equal(new Set(shapes).size, 4, '4 类状态形状必须两两互异（✓ / ! / ✕ / 锁）');

  const all = [...Object.values(mvpTokens.status), ...Object.values(mvpTokens.flow)];
  const pairs = all.map((t) => t.color + '|' + t.shape);
  assert.equal(
    new Set(pairs).size,
    all.length,
    '(color, shape) 组合在 状态组 + 通勤组 共 ' + all.length + ' 项上必须全局唯一，否则同屏可能误读',
  );
});

test('AC-A01-3 状态形状不借分区图案（12 组合矩阵视觉判定 未判 · B 档）', () => {
  // 【判得了】art-bible §3.4 规则 4 的静态前提：
  //   ① 状态 / 通勤令牌的 pattern 必须恒为 none（不得借用圆点阵 / 斜线 / 网格 / 树冠 / 竖条）；
  //   ② 形状值必须在白名单内；
  //   ③ 状态色不得落入分区色组（否则 12 组合里「状态被误认为分区变体」）。
  // 【判不了】3 分区 × 4 状态 = 12 组合矩阵逐格视觉判定，需真机 + 12 张叠加截图。
  // 【上游判据不闭合】状态形状 'cross'（✕）与 CIVIC 分区图案 'cross'（十字网格）**同名不同义**，
  //   矩阵「状态形状不得出现十字」在字符串层面不可机械判定 → 需上游给形状 / 图案两套
  //   命名空间加前缀后才能自动校验。本文件不擅自改名（那是实现方 / 美术侧的活）。
  const groups = [mvpTokens.status, mvpTokens.flow];
  const zoneColors = zoneColorSet(allZoneTokens);
  for (const group of groups) {
    for (const tok of Object.values(group)) {
      assert.equal(tok.pattern, 'none', '状态 / 通勤令牌 ' + tok.id + ' 不得携带分区图案编码');
      assert.ok(STATUS_SHAPE_WHITELIST.indexOf(tok.shape) >= 0, '形状 ' + tok.shape + ' 不在 art-bible §3.4 白名单内');
      assert.ok(!zoneColors.has(tok.color), '状态 / 通勤令牌 ' + tok.id + ' 复用了分区色（违反四重隔离）');
    }
  }
});

test('AC-A01-4 分区色组与状态色组交集为空、色数齐全、无 alpha 衍生（A 档）', () => {
  // 【判得了】矩阵 AC-A01-4 的可机判部分：
  //   ① 分区组 6 色齐全、状态组含矩阵列举的 4 个语义状态色；
  //   ② 两组交集为空（无重复色值）；
  //   ③ 「改透明度衍生」= 同 RGB 不同 alpha：hex 只编码 RGB，故同 RGB 即同 hex，
  //      已被「无重复色值」覆盖 —— 令牌层同时断言全色值为 6 位 hex（无 alpha 通道）。
  // 【判不了】「改明度衍生」（同色相不同明度的族关系）需 HSL 族分析工具，
  //   本文件不新造该算法 → 已登记为上游判据不闭合，交 GAP-07 / O-7（自动校验工具）。
  const zoneSet = zoneColorSet(allZoneTokens);
  const statusSet = statusColorSet(mvpTokens);

  assert.equal(zoneSet.size, 6, '分区组必须是 6 色（矩阵 AC-A01-4 逐值列举）');
  for (const key of NAMED_STATUS_KEYS) {
    assert.ok(statusSet.has(tokenById(mvpTokens, 'status.' + key).color), '状态组缺 ' + key + ' 色');
  }
  assert.ok(statusSet.has(tokenById(mvpTokens, 'flow.clear').color), '状态组缺通勤「畅通」色（矩阵列为状态组第 4 色）');

  const intersection = [...zoneSet].filter((c) => statusSet.has(c));
  assert.deepEqual(intersection, [], '分区组与状态组出现重复色值：' + intersection.join(', '));

  const hex6 = /^#[0-9a-fA-F]{6}$/;
  for (const tok of Object.values(allZoneTokens.byId)) {
    assert.ok(hex6.test(tok.color), '令牌 ' + tok.id + ' 色值 ' + tok.color + ' 不是 6 位 hex（含 alpha 即存在「改透明度衍生」的入口）');
  }
});

// ===========================================================================
// A-02 对比度（3 条）
// ===========================================================================

test('AC-A02-1 正文文字对底 ≥ 4.5:1（A 档）', () => {
  // 【判得了】令牌层的正文 / 底色配对对比度计算（WCAG 2.1 相对亮度，零依赖实现）。
  // 【判不了 | 上游不闭合】① 具体哪个文本用哪个令牌没在 src 声明（无文本样式表），
  //   故只能判「生产色板里存在的 (文字, 底) 配对」；② base.inkWeak（#9AA5B1）对 canvas
  //   仅 2.31:1，若被用于正文或图标则 A-02 不达标 —— 矩阵未列举其使用面，需美术侧裁定，
  //   本文件不替其下结论、也不为通过而放宽阈值。
  const bgTokens = ['base.canvas', 'base.panel', 'base.tile'];
  const inkPrimary = tokenById(mvpTokens, 'base.ink').color;
  for (const bgId of bgTokens) {
    const bg = tokenById(mvpTokens, bgId).color;
    const ratio = contrastRatio(inkPrimary, bg);
    assert.ok(ratio >= AA_TEXT_THRESHOLD, '主文字 vs ' + bgId + ' 仅 ' + ratio.toFixed(2) + ':1 < ' + AA_TEXT_THRESHOLD + ':1');
  }
  // 分区填充上叠的正文墨色（MVP 3 分区）
  for (const zoneId of MVP_ZONE_IDS) {
    const tok = tokenById(mvpTokens, 'zone.' + zoneId);
    const ratio = contrastRatio(tok.ink, tok.color);
    assert.ok(ratio >= AA_TEXT_THRESHOLD, '分区 ' + zoneId + ' 填充上正文仅 ' + ratio.toFixed(2) + ':1 < ' + AA_TEXT_THRESHOLD + ':1');
  }
  // 备注（不改判据）：非 MVP 分区 CIVIC 填充上正文实测 3.97:1 < 4.5 —— MVP zoneTypes
  // 仅 R/C/I 故不阻塞；若该 Should 分区启用，正文阈值需美术侧重新裁定（登记 §台账）。
});

test('AC-A02-2 大字 / 图标 / UI 边界 ≥ 3:1；HUD 不透明底；状态色为深色前景（A 档）', () => {
  // 【判得了】① 矩阵点名的 3 个状态色 vs 画布底 ≥ AA_UI_THRESHOLD（3:1）；
  //   ② 状态色为 L40–50 深色前景 → 其上叠的浅墨（inkOnDark）也必须 ≥ 3:1；
  //   ③ 「顶 / 底 HUD 为不透明底」→ 全部令牌色值为 6 位 hex（无 alpha 通道即不透明）。
  // 【判不了 | 上游不闭合】status.disabled（#B8C0C8）vs 画布实测 1.70:1 < 3:1。
  //   WCAG 1.4.11 对「inactive / disabled 组件」有豁免，但**矩阵原文未声明该豁免**，
  //   也未把 disabled 列入 AC-A02-2 的取值范围（只点名 3 个状态色）→ 本文件不擅自
  //   豁免、也不据此判 FAIL，登记为判据不闭合交美术侧裁定。
  const canvas = tokenById(mvpTokens, 'base.canvas').color;
  for (const key of NAMED_STATUS_KEYS) {
    const tok = tokenById(mvpTokens, 'status.' + key);
    const ratio = contrastRatio(tok.color, canvas);
    assert.ok(ratio >= AA_UI_THRESHOLD, '状态色 ' + key + ' vs 画布仅 ' + ratio.toFixed(2) + ':1 < ' + AA_UI_THRESHOLD + ':1');
    const inkRatio = contrastRatio(tok.inkOnDark, tok.color);
    assert.ok(inkRatio >= AA_UI_THRESHOLD, '状态色 ' + key + ' 上叠字仅 ' + inkRatio.toFixed(2) + ':1 < ' + AA_UI_THRESHOLD + ':1');
  }
  const hex6 = /^#[0-9a-fA-F]{6}$/;
  for (const tok of Object.values(mvpTokens.byId)) {
    assert.ok(hex6.test(tok.color), '令牌 ' + tok.id + ' 带 alpha 通道，HUD 底不是不透明底');
  }
  // 令牌自带的 contrast 结论必须与重算一致（防令牌里塞一个假 passesAA）
  for (const tok of Object.values(mvpTokens.byId)) {
    assert.equal(tok.contrast.passesAA, tok.contrast.ratio >= AA_UI_THRESHOLD, '令牌 ' + tok.id + ' 的 passesAA 与阈值不自洽');
  }
});

test('AC-A02-3 高对比 / LOD 三档不改色值（夜景 / 雨雪叠色 未判 · B 档）', () => {
  // 【判得了】MVP 切片边界内（晴朗白天）的可判部分：令牌层**没有叠色通道** ——
  //   高对比模式（M-093）只改图案不透明度与描边宽度，LOD 三档不改变任何色值。
  //   故「叠色层开启前后各跑一次」在当前实现下等价于同一个色板，不会因模式 / LOD 失标。
  // 【判不了】夜景深蓝 @30% 与阴 / 雨 / 雪叠色（Could 期，src 未实现）下的明度补偿是否
  //   仍达标 —— 矩阵 §3.3 明确夜景校验是前瞻性校验，不得用 Could 期资产证明 MVP。
  const base = buildSemanticTokenMap(MVP_ZONE_IDS);
  const hc = buildSemanticTokenMap(MVP_ZONE_IDS, { highContrast: true });
  const lod0 = buildSemanticTokenMap(MVP_ZONE_IDS, { lod: 'L0' });
  const lod2 = buildSemanticTokenMap(MVP_ZONE_IDS, { lod: 'L2' });

  for (const id of Object.keys(base.byId)) {
    assert.equal(hc.byId[id].color, base.byId[id].color, '高对比模式改了令牌 ' + id + ' 的色值（应只改图案不透明度）');
    assert.equal(lod0.byId[id].color, base.byId[id].color, 'LOD L0 改了令牌 ' + id + ' 的色值');
    assert.equal(lod2.byId[id].color, base.byId[id].color, 'LOD L2 改了令牌 ' + id + ' 的色值');
    assert.equal(lod2.byId[id].contrast.ratio, base.byId[id].contrast.ratio, 'LOD 改变了令牌 ' + id + ' 的对比度结论');
  }
});

// ===========================================================================
// A-03 动效可关闭（4 条）
// ===========================================================================

test('AC-A03-1 全局减动效开关存在且不重启生效（持久化 未实现 · B 档）', () => {
  // 【判得了】开关存在 + 切换后**立即**生效（无需重建策略对象 = 无需重启）：
  //   reducedMotion 变了，effects() 与 immediate() 的返回立刻跟着变。
  // 【判不了 / 实现缺口】「设置可持久化」：`src/save/**` 与 `src/core/**` 中**没有**
  //   reducedMotion / a11y 设置字段（静态扫描 0 处）→ 持久化当前不存在，本条 B 档；
  //   设置项在设置中的位置与措辞另待 ux-spec X-6（矩阵 §4.2）。
  const policy = createMotionPolicy({ tokens: mvpTokens });
  assert.equal(policy.reducedMotion, false, '默认应是「不减少动态效果」');

  policy.setReducedMotion(true);
  assert.equal(policy.reducedMotion, true, '开关置 true 后状态未立即变（等价于要重启）');
  assert.equal(policy.effects().loops, false);
  assert.equal(policy.immediate('press').mode, 'static-press-color');

  assert.equal(policy.toggleReducedMotion(), false, 'toggle 应返回切换后的状态');
  assert.equal(policy.reducedMotion, false);
  assert.equal(policy.effects().loops, true, '切回后动效应恢复');
});

test('AC-A03-2 减动效态 loops / 粒子 / 相机缓动全停播（连续 3 秒无周期像素变化 未判 · B 档）', () => {
  // 【判得了】停播**声明**：reducedMotion = true 时 effects() 三项必须全 false
  //   （矩阵 §2.3 逐项：选中呼吸 / 议题脉冲 / 拥堵脉冲 / 落位尘环 / 雨雪粒子 / 档位缓动）。
  // 【判不了】「开启后画面连续 3 秒无任何周期性像素变化」需真机帧录制逐像素比对，
  //   本机无 Cocos 工程、无真机、无录屏链路 → 该句不可判。
  const off = createMotionPolicy({ tokens: mvpTokens, reducedMotion: true });
  const on = createMotionPolicy({ tokens: mvpTokens, reducedMotion: false });

  assert.deepEqual({ ...off.effects() }, { loops: false, particles: false, cameraEase: false });
  assert.deepEqual({ ...on.effects() }, { loops: true, particles: true, cameraEase: true });
});

test('AC-A03-3 减动效态全部即时反馈改瞬时且信息不丢失（A 档）', () => {
  // 【判得了】8 类即时反馈 + tick 反馈在两态下的模式 / 时长 / 通道 / 信息丢失标志。
  // 【判不了】静态替代资产（M-009 2px 描边 / M-025 静态箭头）的**外观**是否足够可读 —— 视觉判定。
  const reduced = createMotionPolicy({ tokens: mvpTokens, reducedMotion: true });
  const animated = createMotionPolicy({ tokens: mvpTokens, reducedMotion: false });

  assert.equal(IMMEDIATE_FEEDBACK_KINDS.length, 8, '即时反馈类别数变了（ux-spec §3.2 为 8 类）');
  for (const kind of IMMEDIATE_FEEDBACK_KINDS) {
    const spec = reduced.immediate(kind);
    assert.equal(spec.durationMs, 0, kind + ' 在减动效态仍有过渡时长（应为 0 = 瞬时）');
    assert.notEqual(spec.mode, 'animated', kind + ' 在减动效态仍是 animated');
    assert.equal(spec.channels.indexOf('motion'), -1, kind + ' 在减动效态仍占 motion 通道');
    assert.ok(spec.channels.length >= 2, kind + ' 在减动效态退化为单通道：' + spec.channels.join('+'));
    assert.equal(spec.informationLost, false, kind + ' 在减动效态声明为信息丢失');
    assert.ok(spec.encoding.tokenId !== '' && spec.encoding.label !== '', kind + ' 静态降级缺令牌 / 文字编码');

    const anim = animated.immediate(kind);
    assert.equal(anim.mode, 'animated', kind + ' 默认态应带动效');
    assert.ok(anim.durationMs > 0, kind + ' 默认态缺时长');
    assert.ok(anim.channels.length >= 2, kind + ' 默认态通道数不足 2');
  }

  const tick = reduced.tickFeedback();
  assert.equal(tick.mode, 'instant');
  assert.equal(tick.durationMs, 0);
  assert.ok(tick.channels.length >= 2);
  assert.equal(tick.informationLost, false);
  assert.ok(animated.tickFeedback().durationMs > 0);
});

test('AC-A03-4 减动效态全部可交互控件有常驻可读文字标签（完备性 未判 · B 档）', () => {
  // 【判得了】① 生产常量 BUILD_TABS 的 5 个标签全部可读（纯数字 / 纯符号 / 单字母不算，
  //   tooltip 不算常驻 —— 由 isReadableLabel + labelIsTooltipOnly 判）；
  //   ② 双通道断言在 default 与 low 两档下均通过。
  // 【判不了 — 完备性缺口】矩阵要求「遍历**全部**可交互控件（含按钮 / Tab / 图标按钮 /
  //   折叠器 / 开关 / 切换器）」，但：
  //   - `src/**` 没有生产侧控件清单 / 标签表（`A11yControl` 只在测试里构造；
  //     `EndDayButton` 接口连 label 字段都没有）→「全部」无法离线枚举；
  //   - 矩阵点名重点抽查的 M-064 **小地图折叠控件**在 `src/**` 中不存在；
  //   - 图标按钮 / 开关 / 切换器在 `src/**` 中亦无实现。
  //   故本 fixture 上的通过**不能**替代生产侧的控件遍历（需真机逐控件走查）。
  for (const tab of BUILD_TABS) {
    assert.ok(isReadableLabel(tab.label), 'Tab ' + tab.id + ' 的标签不可读：' + tab.label);
  }
  assert.ok(BUILD_TABS.length >= 5, '底部 Tab 少于 5 类（ux-spec §2.1）');

  const controls = controlFixture();
  assert.doesNotThrow(() => assertReducedMotionDualChannel(controls), 'default 档双通道断言未过');
  assert.doesNotThrow(() => assertReachableAtTier(controls, 'low'), 'low 档双通道 / 可达性断言未过');
});

// ===========================================================================
// A-04 文本缩放（3 条）
// ===========================================================================

test('AC-A04-1 100% / 150% / 200% 跟随系统字号不截断不溢出（A 档）', () => {
  // 【判得了】布局模型层：3 形态 × 3 档缩放，各段缩放后最小高度 ≥ 2 行且合计不溢出参考高度。
  // 【判不了】「等宽数字（tabular figures）不抖动」需真机逐档截图比对数值滚动 —— 视觉判定。
  for (const formFactor of ['folded', 'unfolded', 'tablet'] as const) {
    for (const scale of [100, 150, 200]) {
      const model = layoutAt(formFactor, scale, 'default');
      assert.equal(model.textScale, scale, '布局模型没有跟随系统字号');
      assert.doesNotThrow(() => assertTextScaleLayout(model, scale), formFactor + ' 在 ' + scale + '% 下截断 / 溢出');
    }
    // 越界必须显式拒绝（不得静默按 200% 处理）
    assert.throws(() => assertTextScaleLayout(layoutAt(formFactor, 100, 'default'), 99), /超出/);
    assert.throws(() => assertTextScaleLayout(layoutAt(formFactor, 200, 'default'), 201), /超出/);
  }
});

test('AC-A04-2 弹性容器归一化布局、200% 不截断（A 档）', () => {
  // 【判得了】① 三段高度用归一化占比表达（和恒为 1）→ 不是固定宽高，缩放大时按比例重排；
  //   ② 各段仍有 minHeightDp 下限保护（> 0）；③ 200% 下不截断 / 不重叠。
  // 【判不了】9-slice 拉伸是否撕裂、文字是否出血（M-060~069）—— 真机截图。
  for (const formFactor of ['folded', 'unfolded', 'tablet'] as const) {
    const model = layoutAt(formFactor, 200, 'default');
    const segments = Object.values(model.segments);
    assert.equal(segments.length, 3, 'HUD 必须是三段披露');
    const ratioSum = segments.reduce((sum, seg) => sum + seg.heightRatio, 0);
    assert.equal(ratioSum, 1, formFactor + ' 三段 heightRatio 合计 ' + ratioSum + ' != 1（不是弹性归一化布局）');
    for (const seg of segments) {
      assert.ok(seg.heightRatio > 0, '段 ' + seg.id + ' 占比非正');
      assert.ok(seg.minHeightDp > 0, '段 ' + seg.id + ' 缺最小高度保护');
    }
    assert.doesNotThrow(() => assertTextScaleLayout(model, 200), formFactor + ' 在 200% 下截断 / 溢出');
  }
});

test('AC-A04-3 200% 下不溢出且单屏 ≤1 数据面板（滚动可达性 未判 · B 档）', () => {
  // 【判得了】① 200% 下三段不溢出（同 AC-A04-2 的模型断言，此处按 200% 复核）；
  //   ② 「单屏 ≤1 数据面板」：数据面板槽位是**单值**互斥的（L1 / L2 展开新的即收起旧的），
  //      运行时只会出现一个面板 id。
  // 【判不了】200% 下逐面板（M-061 / M-062 / M-069）**完整滚动阅读**是否可达 —— 需真机触摸滚动。
  const model = layoutAt('unfolded', 200, 'default');
  assert.doesNotThrow(() => assertTextScaleLayout(model, 200));

  const controller = makeController();
  controller.openPanel('L1');
  assert.equal(controller.panel, 'L1');
  controller.openPanel('L2');
  assert.equal(controller.panel, 'L2', '展开 L2 时 L1 未收起（出现并排双数据面板）');
  controller.openPanel('none');
  assert.equal(controller.panel, 'none');
});

// ===========================================================================
// A-05 触控热区（3 条）
// ===========================================================================

test('AC-A05-1 可点元素 ≥ 48×48dp（"全部"完备性 未判 · B 档）', () => {
  // 【判得了】① 上游常量 MIN_TAP_TARGET_DP 必须为 48（矩阵 v0.3：华为 2.1.3.3 推荐值 48vp，
  //      官方「必须」下限 40vp；本项目取**推荐值**，严于必须档）；
  //   ② 断言边界：47dp 必须抛错、48dp 必须通过（含等号，不得写成 >）；
  //   ③ 已声明控件集逐项过断言。
  // 【判不了 — 完备性缺口】「遍历 HUD 全部可点元素**实测**热区矩形」需要两样本机没有的东西：
  //   生产侧的热区声明 / 控件清单（`src/**` 零处 tapTargetDp 赋值，`A11yControl` 只在测试里造）
  //   与真机 dp 实测。故本用例只判「常量 + 边界 + 给定集合」，不判「全部」。
  assert.equal(
    MIN_TAP_TARGET_DP,
    48,
    'MIN_TAP_TARGET_DP != 48。两种成因请分清：① 被下调（44 只满足官方「必须」档 40vp，' +
      '未达推荐档 48vp）→ 违约，必须拒收；② 上游又上调（>48）→ 红是对的，' +
      '处理方式是升常量 + 同步升级本门禁，不是把断言改成新数字。',
  );

  // 双向守卫：挡住「回退到旧基线」与「误用官方必须下限」两种放松
  assert.notEqual(
    MIN_TAP_TARGET_DP,
    40,
    '40vp 是官方「必须」下限，**不是本项目达标口径**；取 40 即为擅自放宽，必须拒收',
  );
  assert.notEqual(
    MIN_TAP_TARGET_DP,
    44,
    '44dp 是 v0.2.1 旧基线（只满足官方「必须」档 40vp、未达推荐档 48vp）；回退到 44 即为放宽，必须拒收',
  );

  assert.throws(
    () => assertTapTarget({ id: 'probe', textLabel: '探针', tapTargetDp: 47, labelIsTooltipOnly: false }),
    /热区/,
    '47dp 未抛错：热区断言失去牙齿（基线 48 下 47 必须被拒）',
  );
  // 边界之下 1dp 必抛：即使日后常量再变，这条也钉住「差 1dp 就拒」的语义
  assert.throws(
    () =>
      assertTapTarget({
        id: 'probe',
        textLabel: '探针',
        tapTargetDp: MIN_TAP_TARGET_DP - 1,
        labelIsTooltipOnly: false,
      }),
    /热区/,
    'MIN_TAP_TARGET_DP - 1 未抛错：等号方向写反（把 >= 写成 >）',
  );

  assert.doesNotThrow(() =>
    assertTapTarget({ id: 'probe', textLabel: '探针', tapTargetDp: MIN_TAP_TARGET_DP, labelIsTooltipOnly: false }),
  );

  const controls = controlFixture();
  assert.doesNotThrow(() => assertReachableAtTier(controls, 'default'));
  assert.doesNotThrow(() => assertReachableAtTier(controls, 'low'));
});

test('AC-A05-2 相邻热区间距 ≥ 8dp（断言逻辑已验 · gapDp 无生产者 · B 档）', () => {
  // 【本档边界 · 必读】本用例**只证 `assertSpacing` 的逻辑正确**，不构成 AC-A05-2 的验收证据：
  //   `gapDp` 在 `src/**` 内**零生产者**（grep "gapDp" 除 a11y.ts 外零命中）、
  //   `assertSpacing(` 全仓**调用点 = 0**（1 处命中即定义本身）。
  //   「断言器修好了」≠「相邻热区实际间距达标」——把前者读成后者就是拿工具冒充被测对象。
  // 【为什么本节值得断言】基线 a322223 的 `assertSpacing` 是一条**永假**断言，三处缺陷：
  //   ① 判的是 `tapTargetDp >= MIN_SPACING_DP(8)`，而任何合法控件 tapTargetDp >= 48 → 恒真；
  //   ② `A11yControl` 无间距字段，间距在类型上不可表达 → 它判的根本不是间距；
  //   ③ 循环 `i < length - 1` 漏掉末位控件。
  //   下面五条断言把这三处逐条钉死，防止将来退回去。
  // 【判不了】真机上的**物理命中区间**是否真的不重叠（含触摸容差 / 系统手势边缘 / 厂商 ROM
  //   缩放）—— 需真机布局实测；本用例判的是「调用方注入的声明值」。
  assert.equal(MIN_SPACING_DP, 8, '间距基线被改动');

  const all = controlFixture();
  // ① 全部 8dp（含末位）→ 通过
  assert.doesNotThrow(() => assertSpacing(all), '全部控件 gapDp = 8dp 时仍抛错（等号方向写反？）');

  // ② 恰好等于基线 → 通过；差 1dp → 抛错（钉住 >= 而非 >）
  assert.doesNotThrow(() =>
    assertSpacing([{ id: 'p', textLabel: '探针', tapTargetDp: MIN_TAP_TARGET_DP, labelIsTooltipOnly: false, gapDp: MIN_SPACING_DP }]),
  );
  assert.throws(
    () =>
      assertSpacing([
        { id: 'p', textLabel: '探针', tapTargetDp: MIN_TAP_TARGET_DP, labelIsTooltipOnly: false, gapDp: MIN_SPACING_DP - 1 },
      ]),
    /间距/,
    '7dp 未抛错：间距断言失去牙齿',
  );
  assert.throws(
    () =>
      assertSpacing([
        { id: 'p', textLabel: '探针', tapTargetDp: MIN_TAP_TARGET_DP, labelIsTooltipOnly: false, gapDp: 0 },
      ]),
    /间距/,
  );

  // ③ 末位不豁免：只把**最后一个**控件的 gapDp 改成 7 → 必须抛，且点名末位 id
  //    （旧实现 length - 1 恰好漏掉它，这条专治 off-by-one 回潮）
  const last = all.length - 1;
  const lastBad: A11yControl[] = all.map((c, i) =>
    i === last ? { ...c, gapDp: MIN_SPACING_DP - 1 } : c,
  );
  assert.throws(() => assertSpacing(lastBad), new RegExp(all[last].id), '末位控件未被遍历（off-by-one 回潮）');

  // ④ 未声明 gapDp → 抛错。「不可判定」不得静默通过（旧实现正是静默跳过）
  const missing: A11yControl[] = [
    { id: 'no-gap', textLabel: '无间距声明', tapTargetDp: MIN_TAP_TARGET_DP, labelIsTooltipOnly: false },
  ];
  assert.throws(() => assertSpacing(missing), /未声明 gapDp/, '缺 gapDp 时静默通过 = 不可判定被当成合格');

  // ⑤ 空数组 vacuous 通过 —— 这是边界，**不是覆盖**；覆盖度由 assertReachableAtTier 负责
  assert.doesNotThrow(() => assertSpacing([]), '空数组应当 vacuous 通过（覆盖度不由本函数承担）');

  // 【解封的另两个必要条件（s12-a11y-api 提出，我采纳并升级为硬条件）】上面 ①~⑤ 只证明
  //   **断言器实现正确**；AC-A05-2 要真正可销项，还必须：
  //     ④ `grep -rn "assertSpacing(" src/ | wc -l` **≥ 1**（生产侧有真实调用点，不是只在 tests 里）；
  //     ⑤ `grep -rn "gapDp" src/ | grep -v a11y.ts` **非空**（HUD 布局组合点真的注入了声明值）。
  //   理由：**「未声明即抛错」这条守卫，只有在生产侧真有调用点时才有意义**；否则它是一条
  //   永远不会被触发、但看起来很像防护的代码。当前两条都**不满足** → 本条仍不销项。
  // 【数字真源纪律】本文件的**断言**一律引用常量（`MIN_TAP_TARGET_DP` / `MIN_SPACING_DP`）；
  //   出现字面量 48 / 44 / 40 的地方**只用于棘轮守卫**（钉住「不许回退 / 不许取必须下限」），
  //   常量再漂移时须同步这些棘轮值 + 期望值，而不是在散文里人肉追数字。
  // 【未判 · 上游口径不闭合】本 AC 后半句「高频操作落在底部 1/3 拇指热区」：
  //   布局模型 thumbZone.heightRatio = 0.18（folded / unfolded）/ 0.12（tablet）。
  //   「1/3」若指精确 33% 高度则不符，若指「位于底部三分之一区域内」则相符；
  //   两种读法上游未明示 → 登记为判据口径不闭合，交 art / UX 裁定（见 AC-A10-1 的实测值）。
});

test('AC-A05-3 网格点选只接受整数格 + 选中态描边存在（吸附容差 / 放大 未判 · B 档）', () => {
  // 【判得了】① 落位 API 的输入是**整数格坐标**（无亚格 / 浮点指针坐标入口），
  //   即「吸附到格」在契约层成立（像素 → 格的换算在输入适配层，不在本层）；
  //   ② 「选中态放大反馈」的可判部分：选中另有 2px 描边通道，且减动效时仍为静态描边而非消失。
  // 【判不了】真机「连续点选 20 次相邻格」的误触率与「放大」视觉幅度 —— 需真机。
  const session = makeSession();
  const controller = createInteractionController({ session, tokens: mvpTokens });
  controller.roadClickPath(0, 0, 3, 0);
  controller.zone(1, 2, 'R', 1);
  assert.ok(session.submitted.length >= 5);
  for (const cmd of session.submitted) {
    assert.ok(Number.isInteger(cmd.x) && Number.isInteger(cmd.y), '命令落点不是整数格：' + cmd.x + ',' + cmd.y);
  }

  const selected = tokenById(mvpTokens, 'status.selected');
  assert.ok(selected.label.length > 1, '选中态缺可读文字标签');
  for (const reduced of [false, true]) {
    const spec = createMotionPolicy({ tokens: mvpTokens, reducedMotion: reduced }).immediate('select');
    assert.equal(spec.outlineWidthPx, 2, '选中态描边宽度不是 art-bible §8.3 的 2px');
    assert.ok(spec.outlineWidthPx > 0, '选中态描边为 0（减动效后选中不可见）');
  }
});

// ===========================================================================
// A-06 输入方式（3 条）
// ===========================================================================

test('AC-A06-1 仅触控单手完成 V1→V9 全部主流程（真机唯一 · C 档）', { skip:
  'C 档·真机唯一，本机无法执行。判据原文：无外设、单手完成一次完整市政周期（含结算与解锁），' +
  '需真实触摸输入 + 单手可达性走查 + 会话计时。本机无 DevEco Studio / hdc / HarmonyOS 真机、' +
  '无 Cocos Creator 工程、无可玩 HAP，故无法执行；任何离线模拟（如直接调 controller API）' +
  '都不能代替"单手用触控完成 V1→V9"这一人工判定。所需介质：可玩 HAP + 真机 + 受试者/走查者。' +
  '归属：PLAYTEST-ONLY（tests/traceability-matrix.md §2.4 AC-A06-1）。',
}, () => {
  // 显式空体：真机唯一，本文件不产生任何断言。
});

test('AC-A06-2 拖拽有点击替代路径、无长按依赖（真机手势 未判 · B 档）', () => {
  // 【判得了】① 拖拽（V5 连路）的点击替代路径在**行为上等价**：roadClickPath 逐格产出的
  //   ROAD 命令序列与逐格调用 road() 完全一致（同 kind / 同 x,y，逐条可比）；
  //   ② src/** 剥注释后**零处**长按手势处理（longPress / onLongPress / pressTime 等）
  //      → 「长按均有点击替代」当前无适用对象（不是"已满足"，是"没有长按"）。
  // 【判不了】真机是否仍有需要长按 / 长拖才能完成的路径、连续快速点按是否构成通关条件 —— 需真机交互走查。
  const viaClick = makeSession();
  const c1 = createInteractionController({ session: viaClick, tokens: mvpTokens });
  const clickResults = c1.roadClickPath(0, 0, 3, 0);

  const viaCell = makeSession();
  const c2 = createInteractionController({ session: viaCell, tokens: mvpTokens });
  const cellResults: unknown[] = [];
  for (let x = 0; x <= 3; x++) cellResults.push(c2.road(x, 0));

  assert.equal(clickResults.length, 4, '点击替代路径未覆盖 4 格');
  assert.equal(cellResults.length, 4);
  assert.ok(clickResults.every((r) => r.accepted), '点击替代路径存在被拒的格');
  assert.deepEqual(
    viaClick.submitted.map((c) => c.kind + ':' + c.x + ',' + c.y),
    viaCell.submitted.map((c) => c.kind + ':' + c.x + ',' + c.y),
    '点击替代路径与逐格点击产出的命令序列不一致（替代路径不等于原路径）',
  );

  const longPress = scanSrc(/longPress|onLongPress|long_press|pressDuration|holdToConfirm/i);
  assert.deepEqual(longPress, [], 'src 出现长按手势处理但本文件未给替代路径断言：' + longPress.join(', '));
});

test('AC-A06-3 菜单层级 ≤ 3、无 PC 式快捷键（A 档）', () => {
  // 【判得了】① 层级计数：底部 Tab 层（1）+ 数据面板 L1 / L2（2）= 3 层，
  //   由运行时枚举实测（遍历 UI_TABS 与全部面板态，收集实际出现过的面板 id）；
  //   ② 无键盘事件 / 快捷键依赖（剥注释后全仓扫描 0 处）→ 不存在「键盘是唯一路径」；
  //   ③ 无并排多面板依赖：面板槽位单值互斥（见 AC-A04-3 的断言 + 本处层级实测只有 3 值）。
  const controller = makeController();
  const seen = new Set<string>();
  for (const tab of UI_TABS) {
    controller.setTab(tab);
    controller.openPanel('L1');
    seen.add(controller.panel);
    controller.openPanel('L2');
    seen.add(controller.panel);
    controller.openPanel('none');
    seen.add(controller.panel);
  }
  assert.deepEqual([...seen].sort(), ['L1', 'L2', 'none'], '数据面板出现意外层级：' + [...seen].join(','));
  const levels = 1 + (seen.size - 1);
  assert.ok(levels <= 3, '菜单层级 ' + levels + ' > 3（矩阵 AC-A06-3 上限 3）');

  const keyboard = scanSrc(/keydown|keyup|keypress|KeyboardEvent|addEventListener\(\s*['"]key|shortcut/i);
  assert.deepEqual(keyboard, [], 'src 出现键盘事件处理（PC 式快捷键风险），需补「非唯一路径」证据：' + keyboard.join(', '));
});

// ===========================================================================
// A-07 多通道反馈（2 条）
// ===========================================================================

test('AC-A07-1 所有状态变化 ≥ 2 通道、两级反馈均有视觉表达（A 档）', () => {
  // 【判得了】通道数与信息完整性在声明层可完整判定：8 类即时反馈 × 2 态 + tick 反馈
  //   全部 channels ≥ 2、encoding 必有色 / 形 / 文字、informationLost 恒 false。
  // 【判不了】两级的**视觉呈现质量**（是否"看得出"）—— 视觉判定，须真机。
  for (const reduced of [false, true]) {
    const policy = createMotionPolicy({ tokens: mvpTokens, reducedMotion: reduced });
    for (const kind of IMMEDIATE_FEEDBACK_KINDS) {
      const spec = policy.immediate(kind);
      assert.ok(spec.channels.length >= 2, '即时反馈 ' + kind + '（减动效=' + reduced + '）通道数 ' + spec.channels.length + ' < 2');
      assert.ok(spec.encoding.color !== '' && spec.encoding.shape !== '', '即时反馈 ' + kind + ' 缺色或形编码');
      assert.ok(spec.encoding.label.length > 1, '即时反馈 ' + kind + ' 缺可读文字编码');
      assert.equal(spec.informationLost, false);
    }
    const tick = policy.tickFeedback();
    assert.ok(tick.channels.length >= 2, 'tick 反馈（减动效=' + reduced + '）通道数 ' + tick.channels.length + ' < 2');
    assert.ok(tick.encoding.label.length > 1, 'tick 反馈缺文字表达');
    assert.equal(tick.informationLost, false);
  }
});

test('AC-A07-2 去色 / 静音 / 动效关三态下单通道失效信息仍可达（<100ms 实测 未判 · B 档）', () => {
  // 【判得了】三态各判一次「失效一个通道后仍有 ≥1 条非色通道」：
  //   ① 去色（色通道失效）→ 必须仍有 shape / text / outline 通道；
  //   ② 静音（音频通道失效）→ 反馈通道集合里**根本不存在**音频通道，故音频失效不可能带走信息；
  //   ③ 动效关（motion 通道失效）→ 仍 ≥2 通道（同 AC-A03-3）。
  // 【判不了】「不出现『点了没反应』」与「即时反馈延迟实测 <100ms」——
  //   后者是**建议基线 / 非承诺值**（GAP-05 未冻结），本文件不把它当 PASS 硬判据。
  const visualChannels = new Set(['color', 'shape', 'text', 'motion', 'outline']);
  const decolored = new Set(['shape', 'text', 'outline']);

  for (const reduced of [false, true]) {
    const policy = createMotionPolicy({ tokens: mvpTokens, reducedMotion: reduced });
    for (const kind of IMMEDIATE_FEEDBACK_KINDS) {
      const channels = policy.immediate(kind).channels;
      for (const ch of channels) {
        assert.ok(visualChannels.has(ch), '反馈通道 ' + ch + ' 不在视觉通道集合内（若引入音频通道，静音态即可能丢信息）');
      }
      const survived = channels.filter((ch) => decolored.has(ch));
      assert.ok(survived.length >= 1, '即时反馈 ' + kind + ' 去色后无剩余通道（只有 color）');
      assert.ok(channels.length >= 2);
    }
    // 去色：把 color 去掉后，每个即时反馈仍须有非色通道
    assert.ok(policy.tickFeedback().channels.filter((ch) => decolored.has(ch)).length >= 1, 'tick 反馈去色后无剩余通道');
  }
});

// ===========================================================================
// A-08 音频冗余（2 条）
// ===========================================================================

test('AC-A08-1 所有音频提示有视觉等价物（清单未交付 · C 档）', {
  skip:
  'C 档·判据输入缺失，本机无法执行。判据要求「逐条列出音频事件并核对对应的图标 / toast / ' +
  '数值 / 面板变化」——该清单归音频侧交付（矩阵 §4.3 O-1 = tests/traceability-matrix.md GAP-06，' +
  '至今未交付）；且 src/** 剥注释后零处音频实现（无 AudioSource / playEffect / AudioManager），' +
  '不存在可对照的音频事件表。故本条既无输入清单、也无实现对象，只能登记不可判。' +
  '本文件不臆造音频事件清单（臆造等于伪造判据）。' +
  '所需介质：音频侧交付的「音频事件 → 视觉等价物」清单 + 可玩 HAP + 真机听感核对。' +
  '关闭条件见 GAP-06：清单交付 → 补入 TC-GD-08 测试数据。',
}, () => {
  // 显式空体：判据输入缺失，本文件不产生任何断言。
});

test('AC-A08-2 静音状态下游戏可完整进行（完整通关 未判 · B 档）', () => {
  // 【判得了】结构前提：src/** 剥注释后**零处**音频依赖（无 AudioSource / playEffect /
  //   AudioManager / audio 标识符）→ 不存在任何「靠声音才能获得的关键信息」代码路径，
  //   故静音在结构上不可能阻断进行。
  // 【判不了】「设备静音完成一次完整市政周期，确认所有关键信息均有视觉通道」——
  //   需可玩版本 + 真机 + 人工走查。
  // 【必须写清的边界】"src 没有音频"不等于"音频冗余已达标"：MVP 尚未实现任何音频，
  //   本条目前是**空实现下的结构性成立**，一旦引入音频，本断言与 AC-A08-1 必须重做。
  const audioHits = scanSrc(/\b(audio|AudioSource|playEffect|AudioManager|BGM|soundEffect)\b/);
  assert.deepEqual(audioHits, [], 'src 出现音频实现，本条的"零音频依赖"前提失效，须补音频→视觉等价物映射断言：' + audioHits.join(', '));
});

// ===========================================================================
// A-09 性能可降级（3 条）
// ===========================================================================

test('AC-A09-1 性能档位可切换且低档关效果（三档 / 效果开关 未实现 · B 档）', () => {
  // 【判得了】档位是一等输入：performanceTier 进入布局模型并原样保留（default 与 low 各跑一次）。
  // 【判不了 / 实现缺口】
  //   ① 矩阵要求「低 / 中 / 高**三档**」，而 src/ui/hud/types.ts 的 PerformanceTier 只有
  //      'default' | 'low' 两档 —— 三档切换离线无对象；
  //   ② 「低档关闭天气粒子 / 夜间窗光 / 接触 AO / 全部 VFX 粒子并下压 LOD 阈值」
  //      在 src/** 中无任何效果开关实现（render 层只有图集 / 纹理格式 / LOD 枚举，
  //      无 tier → 效果联动）→ 该句无对象可判。
  //   故本条 B 档：只判「档位能进模型且不丢」，其余登记为实现缺口 + 真机。
  for (const tier of ['default', 'low'] as const) {
    const model = layoutAt('unfolded', 100, tier);
    assert.equal(model.performanceTier, tier, '布局模型丢了性能档位：' + tier);
  }
});

test('AC-A09-2 低档下 A-01~A-08 全部 24 条 AC 仍通过（汇总项 · 真机复跑 未判 · B 档）', () => {
  // 【判得了】「低档不改变 A-01~A-08 的**数据前提**」这一可离线部分：
  //   ① 令牌层与档位无关（LOD L0/L1/L2 与 default 完全同值，见 AC-A09-3 的断言）；
  //   ② 低档布局模型下热区 / 标签 / 字号断言仍全部通过（不因裁剪降级）。
  // 【判不了】矩阵原文「低档位完整复跑 §2 全部 AC 并留记录」是**汇总判定项**，
  //   其成立依赖 A-01~A-08 中被判为 B / C 档的真机部分（色盲模拟、帧录制、音频等价物、
  //   单手通关等）——那些部分本文件均不可判，故本条的结论**不可**由本文件推出。
  const lowModel = layoutAt('unfolded', 200, 'low');
  assert.equal(lowModel.performanceTier, 'low');
  assert.doesNotThrow(() => assertTextScaleLayout(lowModel, 200), '低档下 200% 文本缩放断言失效');
  assert.doesNotThrow(() => assertReachableAtTier(controlFixture(), 'low'), '低档下可达性 / 双通道断言失效');

  const lodLow = buildSemanticTokenMap(MVP_ZONE_IDS, { lod: 'L2' });
  const lodHigh = buildSemanticTokenMap(MVP_ZONE_IDS, { lod: 'L0' });
  for (const id of Object.keys(lodLow.byId)) {
    assert.equal(lodLow.byId[id].pattern, lodHigh.byId[id].pattern, '档位改变了令牌 ' + id + ' 的图案编码');
    assert.equal(lodLow.byId[id].shape, lodHigh.byId[id].shape, '档位改变了令牌 ' + id + ' 的形状编码');
  }
});

test('AC-A09-3 降级不删图案 / 形状 / 对比度 / 热区 / 字号（A 档）', () => {
  // 【判得了】① LOD 三档 + 性能两档下，令牌的 pattern / shape / contrast 完全不变
  //   （图案编码与形状编码不会被降级删掉）；
  //   ② 低档布局模型下热区常量与文本缩放下限仍生效（不因降级放宽 48dp / 不因降级取消缩放）。
  // 【判不了】低档位下 M-056~058 图案层是否**真的被绘制**（渲染层实际出图）—— 需真机低档截图。
  const base = buildSemanticTokenMap(MVP_ZONE_IDS);
  const variants = [
    buildSemanticTokenMap(MVP_ZONE_IDS, { lod: 'L0' }),
    buildSemanticTokenMap(MVP_ZONE_IDS, { lod: 'L1' }),
    buildSemanticTokenMap(MVP_ZONE_IDS, { lod: 'L2' }),
    buildSemanticTokenMap(MVP_ZONE_IDS, { highContrast: true }),
  ];
  for (const variant of variants) {
    for (const id of Object.keys(base.byId)) {
      assert.equal(variant.byId[id].pattern, base.byId[id].pattern, '变体改变了 ' + id + ' 的图案编码');
      assert.equal(variant.byId[id].shape, base.byId[id].shape, '变体改变了 ' + id + ' 的形状编码');
      assert.equal(variant.byId[id].contrast.ratio, base.byId[id].contrast.ratio, '变体降低了 ' + id + ' 的对比度');
    }
  }
  // 低档下热区与字号不得被降级
  assert.doesNotThrow(() => assertReachableAtTier(controlFixture(), 'low'));
  assert.doesNotThrow(() => assertTextScaleLayout(layoutAt('unfolded', 200, 'low'), 200));
  assert.equal(tokenById(base, 'zone.R').pattern, 'dots', 'MVP 分区 R 的图案编码被删除 / 改动');
});

// ===========================================================================
// A-10 官方标准补充（矩阵 v0.3 新增 2 条 · 两条当前均判不了）
// ===========================================================================

test('AC-A10-1 滑动控件高度 ≥ 屏高 20%（不适用 · 无适用对象 · 条件重开）', () => {
  // 【判定状态：不适用（无适用对象）+ 条件重开】——**通过 ≠ AC 达标**。
  //   上游原文：华为《通用应用 UX 体验标准》**2.1.3.4**（等级「必须」）——用户主要交互的
  //   滑动控件高度 ≥ 屏幕高度的 20%。判据要求「滑动控件区域高度不低于屏幕高度的 20%」。
  //   【为什么是「不适用」而不是「不达标」或「待指派」】本项目**不存在「滑动控件」这个对象**：
  //     · `src/` 全仓 `scroll|swipe|滑动|drag` 仅 `scrollY` 一个状态字段（`createLayoutState`），
  //       零滚动容器 / 零滑动回调 / 零列表虚拟化；
  //     · `HudSegmentId`（statusBar / canvas / thumbZone）是**屏高分区**而非控件，
  //       拿 `heightRatio` 断言「滑动控件高度」是对象错配；
  //     · `ux-spec` / 5 份系统 GDD 内「滑块 / 滑动 / slider / 拖动」零命中。
  //   【条件重开】UX 交付《滑动控件清单》（控件 id × 所属槽位 × 占屏比 × 是否承载主要交互）
  //   中确有对象落入任一槽位时，本条即重开并按「≥ 屏高 20%」判；届时本用例会**变红**——
  //   红就是重开信号，须改写为对已指派控件的真实高度断言。
  //   【ADR-005 已拆除算术死墙（2026-11-07 用户裁定）】三形态 `thumbZone` 由 0.18/0.18/0.12
  //   统一提至 **0.20**，同时 `statusBar` 由 0.13/0.12/0.10 压至 0.10，使
  //   `statusBar + thumbZone = 0.30` 恰好满足 art-bible §2.4「UI 常驻覆盖率 ≤30%」
  //   （原手机 0.13+0.18=0.31 已构成该条违规，一并修正）。**抬占比不使本条变为通过。**
  // 【判不了】真实滑动控件的实际像素高度 —— 需真机 + 已指派的控件对象。
  const officialMinRatio = 0.2; // 官方 2.1.3.4 原文 20%，非本文件新造
  const coverageCap = 0.3; // art-bible §2.4「UI 常驻覆盖率 ≤30%」（手机竖屏），非本文件新造

  const measured: Record<string, Record<string, number>> = {};
  for (const formFactor of ['folded', 'unfolded', 'tablet'] as const) {
    const model = layoutAt(formFactor, 100, 'default');
    const segments = Object.keys(model.segments) as (keyof typeof model.segments)[];
    // 结构事实：HudSegmentId 只有 3 段，诊断面板滚动区不在其中 → 它没有 heightRatio 可判
    assert.deepEqual([...segments].sort(), ['canvas', 'statusBar', 'thumbZone'], 'HudSegmentId 集合变了，A-10-1 的对象域须重新界定');
    measured[formFactor] = {};
    for (const id of segments) {
      const ratio: number = model.segments[id].heightRatio;
      measured[formFactor][id] = ratio;
      assert.ok(ratio > 0 && ratio <= 1, '段 ' + id + ' 的 heightRatio 越界：' + ratio);
    }
  }

  // 如实断言实测值（数据事实，不是达标结论）——ADR-005 后三形态统一 0.10 / 0.70 / 0.20
  for (const formFactor of Object.keys(measured)) {
    const m = measured[formFactor];
    // 正向棘轮：thumbZone 已达 0.20。将来任何滑动控件落位于此，不再撞「18% < 20%」的算术死墙；
    // 若有人把它压回 0.18，这里变红 = ADR-005 的前置被回退。
    assert.ok(m.thumbZone >= officialMinRatio, formFactor + ' thumbZone 实测 ' + m.thumbZone + ' < 0.20（ADR-005 的算术前置被回退，须复核 segmentRatios）');
    // 反向棘轮：statusBar + thumbZone 不得重新顶破 art-bible §2.4 的 ≤30%
    //（浮点：0.1 + 0.2 = 0.30000000000000004，故留 1e-9 容差）
    assert.ok(m.statusBar + m.thumbZone <= coverageCap + 1e-9, formFactor + ' statusBar+thumbZone = ' + (m.statusBar + m.thumbZone) + ' > 0.30，违反 art-bible §2.4「UI 常驻覆盖率 ≤30%」');
    assert.ok(m.canvas >= officialMinRatio, formFactor + ' canvas 实测 ' + m.canvas + ' < 0.20（数据与预期不符，请复核 createLayoutModel）');
  }
  // 三段实测值（三形态统一），供裁定方与真机批次直接引用
  assert.equal(measured.folded.canvas, 0.7);
  assert.equal(measured.folded.thumbZone, 0.2);
  assert.equal(measured.unfolded.canvas, 0.7);
  assert.equal(measured.unfolded.thumbZone, 0.2);
  assert.equal(measured.tablet.canvas, 0.7);
  assert.equal(measured.tablet.thumbZone, 0.2);
});

test('AC-A10-2 文本字号 ≥ 8vp 必须 / ≥ 12vp 宜（不适用 · 无对象 · 条件重开）', () => {
  // 【判定状态：不适用（无对象）+ 条件重开】——本用例**通过 ≠ AC 达标**。
  //   它通过的含义是「缺口如登记所述」，即：
  //     ① `src/**` 内**零处**字号声明（无 fontSize / font_size / 字号）→ 没有可遍历的字号表；
  //        仅有的 5 处 `font*` 是**资源命名键**（`font_ui_cjk` / `font_token_main` 等，
  //        且 atlas 里标 `nonAtlas: true`）——是资产文件名，不含任何尺寸语义；
  //     ② **无文本渲染实现**：本层不排版、不出字形，字号在本仓根本不是可观测对象；
  //     ③ `textScale`（100–200）是**百分比**、不是绝对字号，不能折算成 vp；
  //     ④ `TEXT_LINE_DP`（16dp）是**行高**，不是字号，不能拿来替代；
  //     ⑤ art-bible §6.5 用 **sp**（≥14sp / ≥16sp / ≥20sp），官方条文用 **vp**
  //        （≥8vp 必须 / ≥12vp 宜），两套单位换算基准未定。
  //   **条件重开（三者齐备即转真断言，不必等我）**：① 出现字号表 / 字号令牌；
  //   ② sp↔vp 换算基准被裁定；③ 有文本渲染实现可实测。此时本用例会**变红**——
  //   红就是重开信号，须改写为逐字号项对比 8vp 必须档 / 12vp 宜档。
  //   一旦 `src/**` 出现字号表，本用例会**变红**——那是正确信号：届时须改写为真断言
  //   （逐字号项对比 8vp 必须档 + 12vp 宜档），而不是把扫描删掉。
  // 【来源差异 · 不得混引】本条的官方原文取自华为 **AppAnalyzer《规则总览》**页，
  //   与 AC-A10-1 的《通用应用 UX 体验标准》2.1.3.4 **不是同一份文档**，报告中不得合并成一句。
  const fontDecls = scanSrc(/fontSize|font_size|字号/);
  assert.deepEqual(fontDecls, [], 'src 出现字号声明 → 本条的「无数据源」前提失效，须改写为逐项字号真断言：' + fontDecls.join(', '));

  // 行高常量存在，但**不是字号**：显式断言其存在，避免被误当字号使用
  assert.ok(TEXT_LINE_DP > 0, 'TEXT_LINE_DP 应存在（行高基线）');
});
