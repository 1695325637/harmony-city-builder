# S-08 竖屏 HUD / 议题 / 建造与预算交互 — 验收对照与未验证边界

> 模块：`src/ui/hud/**`（新增 9 文件）+ `src/ui/motion-policy.ts`（D-13 改动）+ `src/ui/index.ts`（加 hud 导出）
> 测试：`tests/unit/hud-*.test.ts`（5 文件，45 用例）+ `tests/unit/ui-motion.test.ts`（MOT-8 追加）+ `tests/unit/ui-static-scan.test.ts`（SCAN-10 更新）
> 全量基线：本机 `node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts` → **289/289 全绿零回归**（基线较 S-07 的 234 增长，增量来自 engineering-lead 并发 T-133 的 `tests/unit/flow-state.test.ts` 与本批 HUD 用例，均未互相覆盖）
> 类型：`npx -p typescript@5.9.3 tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions src/ui/index.ts` → **EXIT=0**

---

## 一、S-08 五条核心验收逐条对照

### ① 竖屏 HUD 三段落局 + 降级路径（项 1 / 项 6）— ✅
- 顶部状态条 / 中央画布区 / 底部拇指区三段，高度占比恒为 1，拇指区最小高度 ≥64dp（保证可达）。证据：`hud-layout.test.ts` LAY-1、LAY-2。
- **节点身份稳定**：三段 id 恒定，重排只产 `reuse`/`move`、绝不 `reset`/移除；选中态 / 滚动位置以节点 id 为键的独立状态容器跨重排保留（结构保证，非靠复制）。证据：LAY-7、LAY-8。
- **降级路径（项 6）**：折叠态 → 降级单栏（`degraded=true`）；**安全区接口抛错 → 仍产出完整可用布局且不抛错**（功能不降级、只降信息密度）。证据：LAY-3、LAY-4、LAY-5、LAY-6。
- 文本缩放写入模型并落在 100–200%（LAY-9）。

### ② 常驻 3 指标 / 议题 clamp 2~4 / 面板互斥（项 2）— ✅
- 常驻指标**固定 3 项**（满意度 / 预算结余 / 周期），构造期硬断言 ≤3 且键 ∈ 钉定集合；人口 `population` / 岗位 `jobs` 进常驻即抛（结构性约束，非注释）。证据：VM-1、VM-2、VM-3。
- 议题条 `clamp(2,4)`（3±1）：0→2、6→4、3→3。证据：VM-4、VM-5。
- 面板 L1/L2 互斥、同屏 ≤1：`setPanel('L2')` 自动收起 `L1`。证据：VM-6。
- `projectCityStateToHud` 只读投影 S / B / 周期剩余，不改 state。证据：VM-7、VM-8。

### ③ 「结束本日」主 CTA（项 3）— ✅
- 唯一推进入口，只经 `controller.advanceDay`（含 gate 锁 + 幂等键防双结算），本按钮不再另造推进逻辑。证据：END-4。
- 结算状态机：`idle ↔ settling` 由 `controller.gateLocked` 派生。证据：END-1。
- **连点不双结算**：结算期 gate 锁时两次 `activate` 都拒且 `session.advanceDay` 调用 0 次，纯视觉反馈仍响应（`visualEmitted=true`）。证据：END-3。
- 按压反馈走 **press 通道**，减动效降为 `static-press-color`（瞬态反馈例外口径，`tokenId` 仍 `status.selected`）。证据：END-2。

### ④ 建造 Tab + 预算只读 + 三态图例（项 4 / 项 7）— ✅
- 5 类建造 Tab（居住/商业/产业/道路/拆除）**均带可读中文标签**（纯符号/单字母不算）；切 Tab 仅 1 个激活、非法 id 忽略。证据：TAB-1、TAB-2。
- 预算面板为**只读投影** `I_t / C_b / C_m / B`，无任何 setter，`isLow` 预警；`projectCityStateToBudget` 只读 state。证据：BUD-1、BUD-2。
- 三态图例只消费枚举（`clear`/`slow`/`congested`）与渲染层 label（畅/缓/堵），**不引用 `flow.*` 字面令牌 id**。证据：LEG-1、LEG-2。

### ⑤ 可访问性（项 5 + 低性能档位覆盖 + 减动效双通道）— ✅
- 常量基线：热区 44dp、间距 8dp（A11Y-1）；可读标签判定单字母/纯数字/纯符号不算（A11Y-2）；热区 <44dp 抛错（A11Y-3）。（当时基线 44dp；S-12 起上调至 48dp）
- 文本缩放 100–200% 下不截断/不重叠（布局模型断言，无真机）：A11Y-5 正常档通过、A11Y-6 溢出抛错。
- **减动效双通道**：每个可交互控件必须有可读文字标签（tooltip-only / 符号标签抛错）：A11Y-4。
- **低性能档位覆盖（追加验收）**：`assertReachableAtTier` 在 `default` 与 `low` 两档下各跑一遍，核心控件（5 Tab + 结束本日）不得因裁剪丢失：A11Y-7 通过、A11Y-8 裁剪掉核心控件即抛错。

---

## 二、四条追加验收

### （追加 1）低性能档位覆盖 — ✅ 见 ⑤ A11Y-7 / A11Y-8（两档各跑断言）

### （追加 2）OpaqueSwatch 契约 — ✅
渲染层色块为不透明 `OpaqueSwatch { label; paint: unknown }`；HUD 只消费 `label`、整块透传 `paint`，**不解析内部**（类型上拿不到 color/shape 字段）。静态扫描钉死「HUD 不得 `swatch.paint.` 深入访问」：HUD-SCAN-7；行为证据 LEG-2。

### （追加 3）禁止「按色值就近复用 flow.*」— ✅（静态 + 设计两层）
- 取色路径断言查**令牌 id 字面量**而非色值：预览/按压/选中落点经 `TC-3`（placement=`status.positive`、demolition=`status.warning`、rollback=`status.negative`、press/select=`status.selected`）与 `hud-controls` 的 `encoding.tokenId` 断言，全部为 `status.*`/`base.*`/`zone.*`，**绝不为 `flow.*`。
- 静态扫描查 `flow.*` 字面令牌 id（HUD-SCAN-6 / SCAN-11）+ 零 hex（HUD-SCAN-4），使「同色但不同令牌」的静默违规可被抓到（查令牌 id 必然暴露，查色值必然通过=没测）。
- 与美术 AC-A01-3 互补：AC 管「别把状态色当填充」，本条管「别把三态色当状态色」。

### （追加 4）拆除取色接线 — ✅（随 S-07 补批完成）
合法拆除预览 `tokenId === 'status.warning'`（破坏性动作与落位区分）；`apply()` 按动作类型取色（非只按 legality）；非法拆除 → `status.negative`。证据：`src/ui/optimistic-view.ts` 的 `previewTokenId` + `TC-3` 精确断言 + `TC-3` 的 `illegalDemolition`。口径待 art 侧登记为口径 5。

---

## 三、D-13（本次一并做）— ✅
`FeedbackChannelKind` 增 `'outline'`；当语义令牌 `shape === 'none'`（如 `status.selected` 仅描边不画形状，low-end / 形状门控场景），反馈通道**不计 `shape`、改计 `outline`**，保证降级后通道数 ≥2（信息不丢失）。有真实形状（如 `status.positive`）仍计 `shape`、不计 `outline`。证据：`ui-motion.test.ts` MOT-8（select/press 用 outline、placement 用 shape 对照）。`outlineWidthPx` 保持单一出口、不进事件 data（不破坏 S-07 口径）。

---

## 四、未验证边界（本机无 Cocos、无真机、无折叠屏）

| 边界 | 状态 | 说明 |
|---|---|---|
| 真机单手可达性（拇指区热区 44dp 物理尺寸）（当时基线 44dp；S-12 起上调至 48dp） | 未测 | 仅布局模型断言，未上真机量测 |
| 真实触摸与 44dp 物理命中（当时基线 44dp；S-12 起上调至 48dp） | 未测 | 触摸命中区与几何热区可能不一致 |
| 折叠屏实测（folded↔unfolded 实时重排） | 未测 | 仅单元测试重排操作，未上折叠屏 |
| 文本缩放 100–200% 实测（截断/重叠） | 未测 | 仅布局模型算，未上真机渲染 |
| Cocos UI 渲染（HUD 实际绘制） | 未测 | 本层只产出 VM/布局模型，绘制在 Cocos 适配层 |
| ~~`flowState` 真枚举（T-133 未落地）~~ → **已关闭（2026-11-06 · T-135）** | **已接通** | 原为「图例接 `MOCK_FLOW_LEGEND`（枚举 + label），标 `pending:s04`」。现 `MOCK_FLOW_LEGEND` 已删除、`pending:s04` 零残留；图例默认数据源改为渲染层 `buildFlowLegend()` 真实令牌（`swatch.paint` 不透明），由 `setFlowLegendProvider` 注入解耦；`legendLabels()` 仍恒为畅/缓/堵。**已全部接通（2026-11-07 · T-137/T-139）**：原登记的生产侧「边槽→格」映射生成器已由模拟层 `TrafficResult.edgeCells` + 生产侧纯函数 `flowEdgesFromTick` 落地，quality-lead T-139 判关门项「已达成」、S-09 整体出口门 PASS。剩余三条转登记为 **S-12 装配约束**（代表格非路径格 / workspace 活引用须当帧消费 / 无组合根未上屏），不阻塞本批，详见 `w3-ac-t8-verification.md §4` 与 `production/reviews/s09-retrospective.md` |
| 真机减少动态效果实测 | 未测 | 仅策略声明 + 单元测试，未上真机 |
| 低性能档控件树裁剪实测 | 未测 | 仅断言「两档核心控件均达标」，未实测裁剪树 |
| 减动效下静态编码真机观感 | 未测 | 仅断言编码非空 + 通道 ≥2 |

---

## 五、本批交付文件与行数

**新增 `src/ui/hud/`（9 文件）**：`types.ts`、`layout-profile.ts`、`hud-view-model.ts`、`build-tabs.ts`、`budget-panel.ts`、`end-day-button.ts`、`legend.ts`、`a11y.ts`、`index.ts`。

**改动既有文件（在许可域内）**：`src/ui/motion-policy.ts`（D-13）、`src/ui/index.ts`（加 hud 导出）、`tests/unit/ui-motion.test.ts`（MOT-8）、`tests/unit/ui-static-scan.test.ts`（SCAN-10 文件清单）、`tests/unit/ui-token-contract.test.ts` 与 `src/ui/optimistic-view.ts`（S-07 补批残留，非本批新增）。

**新增测试（5 文件，45 用例）**：`hud-layout.test.ts`(9) / `hud-view-model.test.ts`(8) / `hud-controls.test.ts`(11) / `hud-a11y.test.ts`(8) / `hud-static-scan.test.ts`(9)。

**未触碰禁区**（read-only 核实）：`src/render/**`、`src/core/**`、`src/simulation/**`、`src/README.md`、`design/**`、`docs/**`、`preview/**`。其中 `src/README.md`、`src/core/config.ts`、`src/simulation/{snapshot,tick-pipeline,traffic}.ts` 的修改与 `tests/unit/flow-state.test.ts` 新增均属 engineering-lead 并发 T-129/T-133，本批未改动、未覆盖。
