# S-09 第一批回顾 · 诊断数据层 + 真实 flowState 接线

| 项 | 内容 |
| --- | --- |
| 阶段范围 | S-09（诊断面板 V2 与两级反馈）第一批：A 线 T-134 诊断数据层 + B 线 T-135 真实 flowState 接线（并行）→ T-136 独立复核 |
| 汇编人 | 主理人（游承峰） |
| 日期 | 2026-11-06 · v1.0 |
| 依据（只读） | `tests/verification/s09-diagnosis-verification.md`、`tests/verification/s09-batch1-qareview.md`、`production/epics/epic-breakdown.md §262`、`design/ux/ux-spec.md §4.3`、`design/gdd/systems/01-satisfaction-simulation.md §4.3/E1/AC-F2`、`design/gdd/systems/05-issues-diagnosis.md §7`、三方测试运行记录 |
| **阶段判定** | **第一批出口门 PASS（advisory）**：A 线 8/8 + B 线 8/8 全 PASS · **341/341 全绿** · 无 S1/S2/S3 · 无回归 · 最终放行权在用户 |

---

## 0. 一句话结论

> S-09 第一批交付了诊断面板的**只读数据层**与**三态数据链最后一公里接线**：诊断查询 VM 从 Δ_t + 归因链汇聚 ux-spec §4.3 固定四段、支持跨 2~3 周期完整归因链与 L0/L1/L2 分层；`TickResult.flowState[]` 真正接入渲染层 `buildDrawList` 与 UI 图例，mock 彻底清除。quality-lead 独立复核 A 8/8 + B 8/8 全 PASS，**341/341 两次一致**，两次突变探针均撤销复绿。唯一剩余为生产侧「边槽→格」映射生成器（待接线、不阻塞本批），列为第二批显式关门项。

> **后续订正（2026-11-07 · 主理人）**：本文档是**第一批收口时的历史快照**，§0 与 §5 中「生产侧映射生成器待接线」的表述已被第二批 T-137（模拟层 `edgeCells` + `flowEdgesFromTick`）关闭，quality-lead T-139 判关门项「已达成」、S-09 整体出口门 PASS。第二批完整收口见 `production/reviews/s09-retrospective.md`；此处保留原文以维持第一批判定与证据的可追溯性，不做改写。

---

## 1. 交付物总览

| 线 | 任务 | 新增 | 改动 | 用例 |
| --- | --- | --- | --- | --- |
| **A 线** | T-134 诊断数据层（engineering-ui） | `src/ui/diagnosis/` 3 文件：`types.ts`(278) / `diagnosis-query.ts`(468) / `index.ts`(43)；`tests/verification/s09-diagnosis-verification.md` | `tests/unit/ui-static-scan.test.ts` SCAN-10 清单 +3 行 +1 注释 | 3 文件 41 条（DQ-1~24 / DC-1~8 / DX-1~9） |
| **B 线** | T-135 真实 flowState 接线（engineering-lead） | `src/render/flow-legend.ts`(142)、`tests/unit/render-flow-wiring.test.ts`(368) | `src/index.ts`(+1 export)、`src/ui/hud/types.ts`(删 mock + 增 `FlowLegendProvider`)、`legend.ts`(默认数据源改渲染层真实图例 + 注入点)、`hud/index.ts`、`hud-static-scan.test.ts`(HUD-SCAN-7 反向→正向)、`hud-controls.test.ts`、`src/README.md §2.1` | 11 条（RF-1~11） |
| **QA** | T-136 独立复核（quality-lead） | `tests/verification/s09-batch1-qareview.md` | — | 独立复跑 + 2 次突变探针 |

**全量基线演进**：289（W3 收口）→ 330（A 线 +41）→ **341**（B 线 +11），每步主理人均亲自复跑确认。

---

## 2. A 线 · 诊断数据层（T-134）

- **只读查询 VM**：`queryDiagnosis(store, tickId)` / `queryCycleRange(store, from, to)` 只 `get(tickId)` / `getCycleRange` 各一次，单遍 O(归因条目数) 投影，VM 与卡片全冻结；`DiagnosisSnapshotSource` 是只有两个只读方法的结构化端口（无 put/submit/state），`index.ts` 有仿 D-14 编译期端口断言。独立 grep 确认零 `runTick` / `advanceDay` / `tick-pipeline` / `.submit(` / `.put(`。
- **固定四段**：主因因子 → 贡献量 `ΔS_i` → 明细 → 建议动词（V3/V4/V5 一次点按）；`ACTION_VERB_BY_CAUSE` 映射 + `verbReachable` 校验，未知 causeType 不编造。
- **分层披露**：`activeLayer` 单值枚举（结构上同屏 ≤1 面板、L1/L2 互斥）；L0 标量 / L1 ≤4 行 / L2 ≤4 卡 + `overflowCount`，无二维数组 / 无 table·matrix·columns（P4）。
- **跨周期**：按 `(cycleId, cycleTickIndex, tickId)` 排序、逐 tick 保留 `commandTrace` 与全部 `refIds`，`complete` 要求全投影且无来源缺失丢失（DC-1~8，9 tick 不丢、D4 滞后回溯）。
- **AC-I1 / I7 / I8**：非教学无来源条目直接抑制计数、无卡时只出显式标注的教学卡，零「系统波动」类兜底文案；查询前后快照逐字节一致；缺快照 / 空 delta / NaN / Infinity 不崩不编造。
- **两条 T-113 下游约束落地**：耦合项数值披露 + 首 tick 教学式解释（ΔS_abs ≠ 0 仍不触发 V2 归因型诊断）。

**ΔS 双口径诚实性（主理人裁定认可 + QA 独立验证通过）**：`TickSnapshot` 未显式承载 `cur.dS`，实现**未编造字段**——`deltaSDecompositionCarried: false` 类型钉死，VM 只有 `sAbsoluteChange / attributionSum / discrepancy`；`COUPLING_BASIS` 完整列明 discrepancy 混合 `100ΔMΔP` / `ΔS_penalty` / `attributionThreshold` 过滤 / clamp 且「不等于 ΔS_abs − ΔS、不声称二者恒等」，触发文案写「近似判定」；同时**无条件给出 S 绝对变化数值**——QA 回读 GDD 01 L162 确认这是允许的替代披露方式，该分支始终满足。近似用 `attributionSum` 代理未承载的 ΔS 但明说是代理，未伪装成 ΔS。

---

## 3. B 线 · 真实 flowState 接线（T-135）

- **枚举→令牌映射唯一落点**：`src/render/flow-legend.ts` 的 `FLOW_TOKEN_ID`；`buildFlowLegend()` 用 `tokenById` 真实语义令牌填充 `swatch.paint`（对 UI 不透明、全冻结、确定性），`label` 取畅/缓/堵。
- **全链通**：`buildFlowOverlays(flowState, tokenMap, edgeToCell)` → `layer:'flow'` 的 `OverlaySpec[]` → `buildDrawList({overlays})` → `OverlayDraw`。RF-7 用**真实 `runTick` 产出**的 `TickResult.flowState[]`，三态分别得到正确 tokenId 与 `deriveLine` 线宽/亮度（1/0.6、2/0.8、3/1.0）。
- **零改动 draw-list**：`deriveLine` 早已按 `DEFAULT_FLOW_LINE[token.id]` 推导、`options.overlays` 早已消费 `OverlaySpec[]`，故只需产出不预设 `spec.line` 的 spec，全链即通——一行未改，避开 QA-T8 行数漂移（T-129 曾踩）。
- **mock 彻底清除**：`MOCK_FLOW_LEGEND` 全 src 0 命中、`pending:s04` 零残留；`legend.ts` 默认数据源改渲染层真实图例 + `setFlowLegendProvider` 注入点；`getFlowLegend()` 无参行为与 `legendLabels()` / `legendItemFor()` 签名行为完整保留（hud-controls 10/10 未打穿）。`HUD-SCAN-7` 反向断言改写成正向，QA 突变测试证明能真拦（注入 mock 即转红、撤销复绿）。
- **边槽→格语义守得住**：`flowState[k]` 下标是通勤求解 `qSlot` **边槽索引**，不是格索引；`edgeToCell` 是必填显式入参，`cellIndex` 一律取 `binding.cellIndex`，越界/未写入/未知枚举诚实跳过，空映射→空叠层；RF-7 反向断言（cellIndex 刻意与 edgeIndex 错开）证明映射被真实采用而非拿 `i` 凑数。
- **跨层契约**：`'flow.*'` 字面全仓恰好 6 处，全在 `src/render/**`（draw-list 3 + flow-legend 3），`src/ui/**` 0 命中；阈值键仍只在 `config.ts` + `traffic.ts`；AC-T8 五点、D-13、ui-token-contract、HUD-SCAN-9 全部保持全绿。

---

## 4. 缺陷终态表

| ID | 级别 | 描述 | 终态 |
| --- | --- | --- | --- |
| D-15 | 流程事故 | `ui-token-contract.test.ts` 被覆盖（引入 git 前，不可恢复） | **CLOSED**：裁定现 7 条为唯一门禁、不凭记忆复原；git 基线 `650e3eb` 已建立 + 每批统一提交兜底。台账 #33 已按此关闭 |
| **D-16** | **S4**（新登记，QA T-136） | `tutorialOnly` 时 L0 headline 与 `TUTORIAL_TEXT` **无条件自称「首 tick 教学」**，但 DQ-9 场景是 `tickId=11` 全部无来源被抑制（非首 tick）也会触发 → **文案标签与事实不符**；数据层仍诚实（`traceable=false`、计数如实、无兜底提示） | **OPEN · 已跟踪**：建议第二批按 `tickId` / 来源区分「E1 教学」与「数据缺失：无可追溯来源」。不阻塞第一批（S4 文案层） |
| D-13 | 缺陷 | `FeedbackChannelKind` 缺 outline、`shape==='none'` 仍计 shape | CLOSED（W3 收口，T-136 复核确认） |
| GAP-13 | 覆盖缺口 | AC-T8 用例缺失 | CLOSED（2026-11-06，W3 复核） |

---

## 5. 遗留项与归属（不阻塞第一批）

| 项 | 归属 | 说明 |
| --- | --- | --- |
| **生产侧「边槽→格」映射生成器** | **S-09 第二批收口验收的显式关门项** | 模拟层 `solveTraffic` 按 R→I 块对写 `qSlot` 时未落 `cellIndex`，组合根无法构造真实 `FlowEdgeCell[]`。QA 判定「待接线、不阻塞」：本批判据在契约/数据层、实现无错判伪造、空叠层是安全降级。首选模拟层在 `TrafficResult` 补 `edgeCells` 导出；备选视图模型基于邻接表构造 + 运行时断言（`edgeIndex < flowState.length`、`cellIndex ∈ [0, side²)`）；**严禁**拿循环下标冒充 cellIndex。若 W5 准出未补，届时视觉正确性判 FAIL，不追溯改判本批 |
| D-16 文案区分 | 第二批 | 见 §4 |
| ΔS 精确化 | S-05 / 后续拍板 | 需 `TickSnapshot` 顶层补显式 `dS` 字段；届时只改 `makeCoupling` 第二入参，四段与分层零返工 |
| `suggested_verb` 口径差 | S-05 / 模拟层 | P8 回放为 V8(调)/V1(教学)，与 ux-spec V3/V4/V5 不同；本批原样透传 + `ACTION_VERB_BY_CAUSE` 并存，不本批返工 |
| `diagnosis` barrel 挂 `src/ui/index.ts` | 第二批集成（主理人统一处理） | B 线已被禁止顺手加 re-export，避免与 A 线清单冲突 |
| 不卡顿性能证据 | S-12 / 真机 | 结构性保证（单遍投影 + L2 卡上限 + 不重算），真机 p95/<100ms 未测 |
| 契约口径提示（非缺陷） | 第二批可选 | `legend.ts` 默认 provider 直接 import 渲染函数构成 UI→render 编译期依赖；按 §3.5.3 精确契约仍合规（零 flow 字面、零 tokenById、只取 label、有注入解耦点），若追求严格单向可改组合根注入 |

---

## 6. 质量门历程与三方验证

| 节点 | 结果 |
| --- | --- |
| T-134 A 线交付 | 41/41；全量 330/330（主理人亲自复跑确认） |
| 主理人两项裁定 | ① SCAN-10 +3 行增量认可；② ΔS 近似披露认可（不编造字段） |
| T-135 B 线交付 | 11/11；全量 341/341（主理人亲自复跑 + 四项独立抽查） |
| T-136 QA 独立复核 | A 8/8 + B 8/8 全 PASS；341/341 两次一致；A 线+HUD 50/50、AC-T8/D-13/契约/RF 36/36；两次突变探针撤销复绿；**第一批门 PASS（advisory）** |

**D-15 防复发核验**：两线文件域严格隔离；B 线主动走「既有文件 + `src/render/**`」方案，未在 `src/ui/**` 新增任何文件，`src/ui/index.ts` 零改动；A 线 SCAN-10 的 3 行 `diagnosis/*` 完好未被覆盖。两条线均未碰 git。

---

## 7. 文档订正（主理人收口）

- `production/reviews/w3-retrospective.md` 升 **v1.1**：订正 v1.0 §6 把 S-09 误写为「等距渲染与图集分包」的口径（实为 sprint-01 W3 表格四 Story 合并主题）；正确定义 `S-09 = 诊断面板 V2 与两级反馈`（epic-breakdown §262）。订正覆盖头部 / §4 / §6 / 文末四处，**不改变** W3 判定与任何测试证据。
- `tests/verification/w3-ac-t8-verification.md §4`：原观察项 1、2 划删除线留痕 + 附 T-135 关闭结论与新遗留项（生产侧映射）。
- `tests/verification/hud-s08-verification.md`：mock 替代行改为已关闭，指向订正结论。

---

## 8. 下一步（用户已于 2026-11-06 拍板）

用户拍板两项：**开第二批** + **生产侧「边槽→格」映射采用「模拟层补 `edgeCells`」方案**（QA 首选）。

- **C 线 T-137（engineering-lead）**：`src/simulation/traffic.ts` 在 qSlot 写入处同步记录真实格索引 → `TrafficResult.edgeCells`（与 `flowState`/`qOverCap` 同长逐边对齐、未写入边槽诚实哨兵）；`tick-pipeline.ts` 透传；`src/render/flow-legend.ts` 增纯函数适配器 `flowEdgesFromTick`（不 import simulation）；端到端用例证明 `runTick → buildDrawList` 的 `OverlayDraw.cellIndex` 与 `edgeCells` 逐项一致。硬约束：`edgeCells` 纯视觉派生、不进计分链（AC-T8 ④）、确定性、格索引来自块拓扑严禁循环下标冒充、QA-T8 行数同步。
- **D 线 T-138（engineering-ui）**：L2 诊断面板 UI（复用 `HudPanelState` 单值槽位、L1/L2 互斥、同屏 ≤1 面板、四段 + `actionVerb` 一次点按）、两级反馈 A/B 分离可观测、**D-16 文案区分**（「E1 首 tick 教学」vs「数据缺失：无可追溯来源」）、`diagnosis` barrel 挂 `src/ui/index.ts`（须保 D-14 断言、排查 star-export 歧义名）。硬约束：只读不重算、`src/ui/**` 零 `flow.*` 字面、SCAN-10 清单由 D 线独占维护。
- **两线文件域严格隔离**：C 线独占 `src/simulation/**` / `src/render/**` / `src/index.ts` / `src/README.md` / `edge-cells*` / `render-flow-wiring*`；D 线独占 `src/ui/**` / `diagnosis-*` / `ui-static-scan.test.ts`；`production/reviews/**` 与追溯矩阵由主理人自改。防 D-15 双写覆。

**第二批收口后**：quality-lead 独立复核 → 汇编 S-09 阶段回顾 → 主理人统一 `git commit`。

---

## 9. 纪律自检

- 全程未由 worker 提交 git；提交由主理人统一执行。
- 未编造任何数值：289 / 330 / 341、41 / 11、8/8 + 8/8、50/50、36/36 均为主理人 / QA 本机真实运行输出；ΔS 双口径限制如实披露、未伪造字段。
- 「PASS」为 advisory 判定，最终放行权在用户；准出层仍 BLOCKED（AC1/AC3/AC4 需可玩版本 + 人工 Playtest，W5 回填）。
- 台账已清空：38 completed / 0 in progress / 0 pending（#31 A~G 逐项核销关闭、#33 按 D-15 裁定关闭）。

---

*文档结束 · S-09 第一批收口 · A 线诊断数据层 + B 线真实 flowState 接线 · 341/341 全绿 · 第一批门 PASS（advisory）· 用户已拍板开第二批（C 线 T-137 模拟层 edgeCells / D 线 T-138 L2 面板 UI 与两级反馈）· 提交 `900222b`*
