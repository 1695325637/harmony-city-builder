# HC-01 · S-09 第一批【第二层 QA / 独立复核】报告（T-136 · A 线诊断数据层 + B 线真实 flowState 接线）

| 项 | 内容 |
| --- | --- |
| 任务 | T-136 · S-09 第一批独立复核（W3 AC-T8 复核的延续） |
| 复核人 | quality-lead（严守真） |
| 日期 | 2026-11-06 |
| 复核对象 | A 线：`src/ui/diagnosis/`（3 文件 789 行）+ 41 条用例（DQ/DC/DX）+ `s09-diagnosis-verification.md`；B 线：`src/render/flow-legend.ts`(142) + `render-flow-wiring.test.ts`(RF-1~11) + hud 3 文件改动 + README §2.1 + `src/index.ts` |
| 授权边界 | 只读 `src/`、`tests/`、`design/`、`docs/`、`production/`；**不提交 git**（仅 `git status --short` 只读自查）；临时突变探针已撤销 |
| 门定位 | **advisory（建议性）**：判定由 QA 给出，最终放行由用户决定 |

---

## 0. 一句话结论

> **A 线八项 + B 线八项全部 PASS，独立复跑 341/341 EXIT=0。A 线 ΔS 双口径披露经独立核查「没撒谎」（VM 无伪造 `dS`、类型钉死 `deltaSDecompositionCarried=false`、完整披露近似与不等价、GDD 01 §4.3 L162 的「给出 S 绝对变化数值」替代披露被正确引用且无条件满足）；B 线 `flow.*` 字面令牌 id 全仓恰好 6 处且全在渲染层，HUD-SCAN-7 突变测试证明真能拦，RF-7 真实 `runTick` 产出的 `flowState[]` 全链通过。已知遗留项「生产侧边槽→格映射生成器」判为「待接线（不阻塞本批出门）」。第一批出门判定：PASS（advisory，附 2 条待办 + 1 条 S4 文案隐患）；未发现回归或功能隐患。**

---

## 1. 独立复跑记录（本机真实执行）

| # | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 1 | `node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts` | `0` | **341/341 pass 0 fail**（与主理人一致） |
| 2 | 同上（收笔前最终复跑） | `0` | **341/341**，无残留红 |
| 3 | `tests/unit/diagnosis-*.test.ts` + `hud-static-scan.test.ts` | `0` | **50/50**（A 线 41 + HUD 扫描 9） |
| 4 | `flow-state` + `ui-motion` + `ui-token-contract` + `render-flow-wiring` | `0` | **36/36**（FS 10 + MOT 8 + 契约 7 + RF 11） |
| 5 | `--test-name-pattern="HUD-SCAN-7"`，**注入 `MOCK_FLOW_LEGEND` 突变探针前** | `0` | 1/1 |
| 6 | 同上，**注入后** | `1` | **HUD-SCAN-7 转红**（`UI 不得定义 / 消费 mock 图例常量`） |
| 7 | 撤销探针后复跑 | `0` | 1/1；`legend.ts` 探针字面量计数 = 0 |

> 只读自查：`git status --short` 中 `src/ui/hud/{index,legend,types}.ts` 的 M 与 `src/render/flow-legend.ts` 的 ?? 均为**本批 B 线未提交交付物**（派单已说明「本批改动尚未提交」），非我的探针残留；我未执行 add/commit/checkout/restore/stash。

---

## 2. A 线 · 八项判定（全部 PASS）

| # | 验收点 | 判定 | 独立证据（非转抄自述） |
| --- | --- | --- | --- |
| ① | **只读不重算**（不 import/调用 `runTick`/`advanceDay`/`submit`/`put`；查询前后 `get(tickId)` 逐字节一致） | **PASS** | 独立 grep `src/ui/diagnosis/*.ts`：`runTick` / `advanceDay` / `tick-pipeline` / `.submit(` / `.put(` **0 命中**，唯一 `.set(` 是本地 `Map bucket.set`（L257，非状态写）。读源码：`queryDiagnosis` 仅 `source.get(tickId)` 一次（L305）、`queryCycleRange` 仅 `getCycleRange` 一次（L418）；端口 `DiagnosisSnapshotSource` 只有 `get`/`getCycleRange` 两个只读方法。运行证据 DQ-20/21/24、DC-5（50/50 全绿）；DX-2 静态扫描同向 |
| ② | **AC2**：任一显著 ΔS 可追溯 ≥1 条具体原因、四段齐备 | **PASS** | DQ-1（四段齐备 + 来源非空）、DQ-3（主因优先）、DQ-4（截断不丢来源）；`projectSnapshot` L232~234：`traceable = 无抑制 && (有卡 \|\| ΔS_abs=0 \|\| 教学候选)`；数据缺口时如实 `traceable=false`（DQ-9）不编造 |
| ③ | **AC-I1**：无「来源不明」通用提示，`refId` 为空只允许 TUTORIAL 卡 | **PASS** | 源码 L202~211：非教学且 `!hasSource` 直接 `unsourcedSuppressed++`、不产卡；L227~228 无卡时只出 `makeTutorialCard`（`explicitlyMarked=true` / `label='教学'`）。DQ-8/9/15 + DX-7（代码层无「系统波动」兜底字面量）。**一条 S4 文案隐患见 §2.2（D-16），不影响本项数据层判定** |
| ④ | **AC-I3**：建议动词可达 | **PASS** | `ACTION_VERB_BY_CAUSE` 四类 → V3/V4/V5 且 `ACTION_VERBS` 校验（types.ts L56~67）；`makeCard` L115/130 `verbReachable`；未知 causeType → `null`（不编造）；DQ-12 |
| ⑤ | **AC-I7**：只读汇聚、不写回 | **PASS** | 同 ①：VM/卡片 `Object.freeze`（L356、L160、L117 等），`setLayer` 仅改本地 `active` 单值（L352~354）；无写回入口；DQ-22 |
| ⑥ | **跨 2~3 周期完整归因链**（`getCycleRange`） | **PASS** | `queryCycleRange` L418~467：按 `(cycleId, cycleTickIndex, tickId)` 排序、逐 tick 保留 `commandTrace` + 全部 `refIds`（截断前）、`complete` 要求 `projected===snaps.length && unsourcedSuppressed===0`；DC-1~8（9 tick 不丢、D4 lagged 回溯、范围裁剪、教学 tick 如实 `complete=false`） |
| ⑦ | **分层 L0/L1/L2 + `activeLayer` 单值**（结构 ≤1 面板） | **PASS** | `DIAGNOSIS_LAYERS` 三档、`activeLayer: DiagnosisLayer` **单值枚举**（types.ts L228）、`setLayer` 非法值忽略；L0 标量 / L1 ≤4 行 / L2 ≤4 卡；DQ-5/6/7（无二维数组/table/matrix/columns） |
| ⑧ | **两条 T-113 下游约束**（耦合披露 + 首 tick 教学） | **PASS** | ① DQ-16/17/18/19 + DX-8 + DC-7（每 tick 带 `coupling` 与 `deltaSDecompositionCarried=false`）；② DQ-13/14/15 + DC-4（首 tick ΔS_abs≠0 仍不触发 V2 归因型诊断、教学卡明确标注） |

### 2.1 ΔS 双口径披露的诚实性（**重点：证明它没撒谎**）

| 核查项 | 我的独立结论 |
| --- | --- |
| **VM 上确无伪造 `dS` 字段** | `DiagnosisViewModel` / `CouplingDisclosure` / `CycleRangeDiagnosis` 的字段里只有 `sAbsoluteChange / attributionSum / discrepancy / sBefore / sAfter / basis / message / deltaSDecompositionCarried`；`src/ui/diagnosis/*.ts` 中 `cur.dS` / `dS` 字样**只出现在注释与 `COUPLING_BASIS` 文本里**（说明「未承载」），无字段定义。DQ-19 还断言 `JSON.stringify(vm)` 不含 `\"dS\"` / `\"cur.dS\"`。✓ |
| **`deltaSDecompositionCarried` 类型钉死** | types.ts L184 `readonly deltaSDecompositionCarried: false`、L277 同；实现 L170/466 `false as const`。**类型层恒 false**，无法赋值 true。✓ |
| **未声称二者恒等 / 未声称 discrepancy = ΔS_abs − ΔS** | `COUPLING_BASIS`（L60~67）逐字含「**不等于 ΔS_abs − ΔS**」「**不声称二者恒等**」「混合了 100ΔMΔP 二阶交叉项、ΔS_penalty、attributionThreshold 过滤与 clamp 钳制」「披露判定为近似」；`message` 触发时写「近似判定，见 basis」（L158）；文件头 L16~23 与报告 §3 同口径。✓ |
| **GDD 01 §4.3 下游披露约束引用正确** | 我回读 `design/gdd/systems/01-satisfaction-simulation.md` **L162**：「当 `|ΔS_abs − ΔS| > 1` 或 `|ΔS_abs| > 1` 而 `|ΔS| ≤ 1` 时，诊断面板须显式说明…**或给出 S 的绝对变化数值**」——「给出 S 绝对变化数值」确实是 GDD 允许的**替代披露**，实现方引用属实。且实现**无条件**给出 `sAbsoluteChange`（L163、L245~251 的 l0、`core` 文案），因此即便近似判定条件本身用 `attributionSum` 代理未承载的 ΔS，替代披露分支**始终满足**，玩家不会看到「HUD 数字与归因之和明显对不上」而无解释。✓ |
| **近似口径是否被如实标记** | 是：条件 A/B 用 `discrepancy = |ΔS_abs − attributionSum|`（L149）、`attributionSum` 明确定义为「带来源条目的 dS_i 之和（截断前）」而非 ΔS；`COUPLING_BASIS` 明说「无法计算 GDD 原式」。**没有把代理量伪装成 ΔS**。✓ |

**结论：ΔS 双口径披露没撒谎**（主理人已裁定认可近似口径，本复核不重判口径，只验证诚实性与 GDD 引用）。另按实现方建议登记一条后续精确化路径：若模拟层在 `TickSnapshot` 顶层补显式 `dS`，本层只需改 `makeCoupling` 入参；本批**未擅自新增字段**，符合「不编造数据来源」。

### 2.2 新观察项 **D-16（S4，文案层，不阻塞）**

`projectSnapshot` L241~242：`tutorialOnly`（= `cards.length === 0`）时 **L0 headline 无条件写「首 tick 教学：空城基线，暂无归因型诊断（教学卡）」**。但 `tutorialOnly` 不止首 tick 会触发——**DQ-9 就是 `tickId=11`、全部无来源条目被抑制**的场景，此时 VM 的 headline 与 `TUTORIAL_TEXT`（「本 tick 为教学占位…下一 tick 起可查看具体原因」）仍自称「首 tick 教学」，与事实不符。
- 数据层**没有撒谎**：`traceable=false`、`unsourcedSuppressed` 如实计数、教学卡 `explicitlyMarked=true`、无通用兜底提示；本条只是**文案标签误用**。
- 建议（S-09 第二批顺带）：按 `snap.tickId/cycleTickIndex` 或 `tutorialCandidates` 区分「E1 首 tick 教学」与「数据缺失：无可追溯来源」，后者应写「本 tick 暂无可追溯来源」而非套用首 tick 教学文案，避免与 AC-I1「无来源不明通用提示」精神擦边。

---

## 3. B 线 · 八项判定（全部 PASS）

| # | 验收点 | 判定 | 独立证据 |
| --- | --- | --- | --- |
| ① | **`flow.*` 字面令牌 id 只出现在 `src/render/**`** | **PASS** | 独立 grep 全 `src/`：`'flow.clear'/'flow.slow'/'flow.congested'` 恰好 **6 处** = `draw-list.ts` L119~121（线宽预设表 3）+ `flow-legend.ts` L41~43（枚举→令牌映射表 3）；`src/ui/**`（含 hud、diagnosis）**0 命中**。另 `MOCK_FLOW_LEGEND` 全 src **0 命中**（已从 `types.ts` 删除）。阈值键仍只有 `config.ts` + `traffic.ts`（与 W3 复核一致，AC-T8 ① 未回归） |
| ② | **HUD-SCAN-7 改写真能拦截（突变测试）** | **PASS** | 临时向 `src/ui/hud/legend.ts` 注入 `const _qaMutationProbe = 'MOCK_FLOW_LEGEND';` → `--test-name-pattern="HUD-SCAN-7"` **转红 EXIT=1**（「UI 不得定义 / 消费 mock 图例常量」）；**撤销后复绿 1/1**，探针计数=0。非永真断言。同用例还正向断言 `setFlowLegendProvider` 存在、反向断言 `types.ts` 无 mock 常量、禁止 `.paint.<字段>` 解析 |
| ③ | **RF-7 真用 `runTick` 产出的 `flowState[]`** | **PASS** | 读 `render-flow-wiring.test.ts` L238~240：`const tick = runTick(state, [makeCommand.advance('rf-7',1)], config, ws); const flowState = tick.flowState;`，并断言 `flowState.length > 0`。**不是构造的假数组**（RF-8/9 的构造数组仅用于三态分支与边缘用例，明确分工） |
| ④ | **边槽→格映射不捏造**：`edgeToCell` 必填、`cellIndex` 只取 `binding.cellIndex`、空映射→空叠层 | **PASS** | `flow-legend.ts` L118~122：`buildFlowOverlays(flowState, tokenMap, edgeToCell: readonly FlowEdgeCell[])` **第三参无默认值/非可选**；L124~139 只按 `edgeToCell` 遍历，`cellIndex: binding.cellIndex`（L130），循环下标 `i` 仅用于取映射项；未知枚举/越界边槽 `continue`（L127）。文件头 L13~17 明写「k 是边槽索引，不是格索引，严禁捏造」。RF-7 用 `cellIndex=100+(edgeIndex%100)` 刻意错开并断言 `cellSet.has(100)` 且 `!cellSet.has(0)`；RF-9 断言空映射 `[] → []`、越界跳过、输入不被修改、确定性 |
| ⑤ | **`buildDrawList({overlays})` 全链产出 `layer:'flow'` 且三态线宽/亮度正确** | **PASS** | RF-7 L248~268：`overlays.length === flowState.length`、每个 `spec.layer==='flow'` 且 `spec.line===undefined`（交给 deriveLine）；`buildDrawList(...,{overlays})` 后 `flows.length===overlays.length`、`lineEncodedCount===overlays.length`、L0 `shapeSpriteCount===0`、逐 tokenId 比对 `EXPECTED_LINE`、`group==='flow'`。RF-8 三态分支全覆盖 |
| ⑥ | **QA-T8 README 行数守卫**：6 模块 + 新 `flow-legend` 142 + `index.ts` 27 同步 | **PASS** | 独立 `wc -l` 与 README §2.1 逐行比对：`iso 175 / view-model 158 / semantic-tokens 323 / atlas 458 / asset-naming 343 / draw-list 334 / flow-legend 142` **全部一致**；`src/index.ts` 实为 **27 行**且 L25 已 `export * from './render/flow-legend.ts'`。QA-T8 守卫随 `render-s06-t121-qareview.test.ts` 在 341/341 中绿 |
| ⑦ | **A 线 `ui-static-scan` SCAN-10 清单 3 行 `diagnosis/*` 完好** | **PASS** | 读 `tests/unit/ui-static-scan.test.ts` SCAN-10：`'diagnosis/diagnosis-query.ts' / 'diagnosis/index.ts' / 'diagnosis/types.ts'` 三行在列，且 `hud/*` 9 行同列；50/50 全绿说明 B 线未覆盖 A 线清单 |
| ⑧ | **AC-T8 五点与 D-13 仍全绿**（FS-9/10、ui-token-contract、ui-motion、HUD-SCAN-9） | **PASS** | 36/36（FS 10 + MOT 8 + token-contract 7 + RF 11）与 50/50（含 HUD-SCAN-9）全绿；独立 grep 复核阈值键仍只在 `config.ts`+`traffic.ts`、渲染/UI 零 `qOverCap/qoc` 阈值比较；`motion-policy.ts` 的 `outline` 通道 + `shape==='none'` 不计 shape 分支仍在（T-136 未改该文件） |

### 3.1 契约口径提示（非缺陷，供第二批参考）

`src/ui/hud/legend.ts` 的**默认 provider 直接 import 了渲染函数** `buildFlowLegend`（L24、L31 `let provider = () => buildFlowLegend()`），因此 UI 层存在一条 `UI → render` 的编译期依赖。按 GDD 03 §3.5.3 的精确契约（UI **不引 `flow.*` 字面 id、不解析 `encoding`/`paint` 内部、只消费枚举 + label**）本实现**合规**：UI 侧零 flow 字面、零 `tokenById`、只取 `swatch.label`，且 `setFlowLegendProvider` 提供组合根注入解耦点。但若追求「渲染下发」的严格单向性，建议 S-09 第二批把默认 provider 改为「组合根注入、未注入时返回空/安全降级」，避免 UI 模块反向 import 渲染实现。**不阻塞本批**。

---

## 4. 已知遗留项：生产侧「边槽→格」映射生成器 → **待接线（不阻塞本批出门）**

**判定**：待接线，**不阻塞**。理由：

1. **本批判据均在契约 / 数据层**：A 线是只读诊断 VM，B 线是「显式入参契约 + 全链验证」；AC-T8 五点（阈值、确定性、长度对齐、计分链隔离、静态纪律）与「格定位」无关，已独立复核全绿。
2. **实现没有错判、没有伪造、没有静默错位**：`buildFlowOverlays` 把映射做成**必填显式入参**，空映射诚实产出空叠层（RF-9），循环下标绝不冒充 `cellIndex`（RF-7 反向断言）。缺的是**上游拓扑数据**，不是「判定缺失」。
3. **缺失影响的是视觉正确性，不是本批出门条件**：`solveTraffic` 按 R→I 块对写 `qSlot`（只导出逐边枚举/饱和度，无 `edgeCells`），组合根今日拿不到真实 `FlowEdgeCell[]`；真正需要它的是 S-09 第二批 L2 面板 / 两级反馈把流线画到具体格，以及后续真机渲染。当前默认行为（空叠层）是**安全降级**。

**归属建议**（写一个明确关门项，避免 mock 带病进 S-12）：
- 首选：**模拟层在 `TrafficResult` 补 `edgeCells`（边槽 ↔ 格坐标）导出**，组合根据此构造真实 `FlowEdgeCell[]` 并调用 `buildFlowOverlays(tick.flowState, tokens, realEdgeCells)`；
- 备选：若设计上不扩 `TrafficResult`，则在 S-09 第二批视图模型里基于通勤图邻接表构造该映射，并加运行时断言「映射非空时 `edgeIndex < flowState.length`、`cellIndex ∈ [0, side²)`」；
- **禁止**为「让画面有东西」把循环下标 `i` 当 `cellIndex`（会制造肉眼不可见的错位拥堵，正是 team-lead 补第⑤条判据要防的风险）；
- 建议列为 **S-09 第二批收口验收的显式关门项**；若到 W5/准出仍未补，则届时**视觉正确性判 FAIL**，而非追溯改判本批 FAIL。

> 按派单口径，`w3-ac-t8-verification.md §4` 与 `hud-s08-verification.md` 中「未接线 / mock 保留」的旧措辞由主理人收口时统一订正；**本复核按代码事实判定，未因文档措辞判 FAIL**。

---

## 5. 第一批出门判定（advisory）

**PASS（advisory）** —— A 线 8/8、B 线 8/8 全 PASS；341/341 独立复跑一致；无回归、无 S1/S2/S3 缺陷；ΔS 披露诚实性核实通过；两次突变探针均撤销、工作区无 QA 残留；未碰 git。

附带条件（不阻塞，但需登记）：
1. **D-16（S4）**：`tutorialOnly` 的 L0 headline / `TUTORIAL_TEXT` 在非首 tick 数据缺失场景误标「首 tick 教学」，建议第二批订正文案（§2.2）；
2. **遗留项关门**：生产侧 `FlowEdgeCell[]` 生成器列 S-09 第二批验收（§4）；
3. **契约口径提示**：默认 provider 的 UI→render import，第二批可改为组合根注入（§3.1）；
4. 文档旧措辞由主理人统一订正（本单不代改）。

**最终放行权在用户**；本判定为建议性门控。

---

## 6. 复核留痕

- 新增：`tests/verification/s09-batch1-qareview.md`（本文）。
- 未改动：`src/**`、`design/**`、`docs/**`、`production/**`、实现方报告与既有测试；未删文件、未提交 git。
- 两次临时突变探针（`legend.ts`）均已撤销并复绿；`git status --short` 中相关 M/?? 条目为 B 线未提交交付物，非探针残留。
- 数值纪律：341/341、50/50、36/36、HUD-SCAN-7 的 1/1→0/1→1/1 均为本机真实运行输出；未编造任何数值。

---

*文档结束 · T-136 · S-09 第一批独立复核 · A 线 8/8 + B 线 8/8 PASS · ΔS 披露「没撒谎」核实通过 · 遗留项「待接线、不阻塞」 · **第一批出门 PASS（advisory，附 D-16 与第二批关门项）** · 341/341 独立复跑一致*
