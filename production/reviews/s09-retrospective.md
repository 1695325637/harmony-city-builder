# S-09 阶段回顾 · 诊断面板 V2 与两级反馈（W3 收官 Story）

| 项 | 内容 |
| --- | --- |
| 阶段范围 | S-09 两批：第一批 A 线 T-134 诊断数据层 + B 线 T-135 真实 flowState 接线；第二批 C 线 T-137 模拟层 edgeCells + D 线 T-138 L2 面板 UI / 两级反馈 / D-16；复核 T-136 / T-139 |
| 汇编人 | 主理人（游承峰） |
| 日期 | 2026-11-07 · v1.0 |
| 依据（只读） | `production/epics/epic-breakdown.md §262`、`design/ux/ux-spec.md §2.2 / §3.2 / §4.3`、`design/gdd/systems/01-satisfaction-simulation.md §4.3 / E1 / AC-F2`、`design/gdd/systems/05-issues-diagnosis.md §7`、`tests/verification/s09-batch1-qareview.md` / `s09-batch2-qareview.md`、三方测试运行记录 |
| **S-09 整体出口门** | **PASS（advisory）** · 第一批 A 8/8 + B 8/8 · 第二批 C 9/9 + D 6/6 · **394/394 全绿** · tsc EXIT=0 · 关门项达成 · D-16 CLOSED · 无 S1/S2/S3 · 无回归 · 最终放行权在用户 |

> **正名（承接 w3-retrospective v1.1）**：S-09 = **诊断面板 V2 与两级反馈（V2/V7）**（`epic-breakdown.md §262`），直接支撑 **AC2**；此前误记为「等距渲染与图集分包」（实为 S-06）。

---

## 0. 一句话结论

> S-09 把「任一 ΔS 可追溯 ≥1 条具体原因」从数据底座一路做到可排布的 L2 诊断面板：第一批交付**只读查询 VM**（四段 / 跨 2~3 周期归因链 / L0-L1-L2 分层）与**真实 flowState 接线**（mock 彻底清除）；第二批交付**L2 面板 UI + 两级反馈 A/B 分离可观测**、修掉 D-16 文案失真，并在模拟层补 `edgeCells` 关掉「生产侧边槽→格映射」关门项。quality-lead 两轮独立复核合计 **29/29 PASS**，全量从 289 → **394/394**，tsc 全程 EXIT=0。**结构 / 语义 / 数据链层已完整；真机上屏装配与真机 <100ms 达标率属 S-12，如实标「未测」，不宣称已达标。**

---

## 1. 交付物总览（两批 4 线）

| 批 | 线 | 任务 | 主要产物 | 用例 |
| --- | --- | --- | --- | --- |
| 一 | A | T-134 诊断数据层 | `src/ui/diagnosis/` 3 文件（`types` 278 / `diagnosis-query` 468 / `index` 43） | 41（DQ/DC/DX） |
| 一 | B | T-135 真实 flowState 接线 | `src/render/flow-legend.ts`(142) + hud legend 去 mock + `src/README.md §2.1` | 11（RF-1~11） |
| 二 | C | T-137 模拟层 edgeCells | `traffic.ts`(365) / `tick-pipeline.ts`(454) / `flow-legend.ts`(184) / README | 15（EC-1~12 + RF-12~14） |
| 二 | D | T-138 L2 面板 UI + 两级反馈 + D-16 | `src/ui/diagnosis/diagnosis-panel.ts`(531) + diagnosis 三文件改 + `src/ui/index.ts` | 38（DP/DF/DB + DQ-25/26） |
| 复核 | — | T-136 / T-139 | `s09-batch1-qareview.md` / `s09-batch2-qareview.md` | 独立复跑 + 突变探针 |

**全量基线演进**：289（W3 收口）→ 330（A）→ 341（B）→ 379（D）→ **394**（C，与 D 并行落盘）。每一步主理人均亲自复跑确认；T-136 / T-139 各自独立复跑两次一致。

---

## 2. 四条 S-09 验收条件的达成情况

| 验收条件 | 结论 | 证据 |
| --- | --- | --- |
| ① 任一显著 ΔS 可追溯 ≥1 条具体原因（**AC2**）；查询只读、不重算、不卡顿 | **达成（结构层）** | 第一批 A 线四段 VM、`get` 只调一次、零 runTick/advanceDay/submit/put（DX-2）、查询前后快照逐字节一致（DQ-20/21/24）；T-136 A 线 8/8。真机 p95 未测，随 S-12 |
| ② 两级反馈分离可观测（即时 vs tick 后） | **达成（语义层）** | 第二批 D 线 `projectTwoLevelFeedback` 纯只读投影、10 不变量 → `separated` → `fullyObservable`（空观测不谎报）；`noBTypeInA` + `diagnosisRefreshOnlyInPostTick` 双抓越界；T-139 独立突变探针 M1/M2 转假证明非永真。**限定**：`<100ms` 是语义契约，真机达标率未测（`TWO_LEVEL_LATENCY_NOTE`） |
| ③ 跨 2~3 周期滞后后果可查完整归因链 | **达成** | 按 `(cycleId, cycleTickIndex, tickId)` 排序、逐 tick 保留 `commandTrace` + 全部 `refIds`，DC-1~8（9 tick 不丢、D4 滞后回溯、范围裁剪） |
| ④ 单屏 ≤1 数据面板 / 分层披露 / 不以密集表格作主交互面 | **达成（结构层）** | 第一批 `activeLayer` 单值；第二批 `DiagnosisPanelSlot` 复用既有 `HudViewModel.setPanel` 单值槽位、`isOpen` 恒派生 getter、控制器不持本地布尔、L1/L2 互斥（DP-6/7/8/9）；四段卡具名字段、L1 ≤4 行 / L2 ≤4 卡 + overflow、无二维数组 / table / matrix / columns。**限定**：像素级布局与 200% 文本缩放随真机 / S-12 |

---

## 3. 关键工程决策与口径

1. **ΔS 双口径如实披露（不编造字段）**：`TickSnapshot` 未显式承载 `cur.dS`，故 `deltaSDecompositionCarried: false` 类型钉死、`COUPLING_BASIS` 明说 discrepancy 混合 `100ΔMΔP` / `ΔS_penalty` / 阈值过滤 / clamp 且「不等于 ΔS_abs − ΔS」，同时**无条件给出 S 绝对变化数值**——QA 回读 GDD 01 L162 确认这是允许的替代披露方式。主理人裁定认可，T-136 / T-139 两轮验证「没撒谎」。
2. **零改动 draw-list 的全链接通**：`deriveLine` 早已按 `DEFAULT_FLOW_LINE[token.id]` 推导、`options.overlays` 早已消费 `OverlaySpec[]`，故 B 线只需产出 `layer:'flow'` 且不预设 `spec.line` 的 spec 即通，一行未改，避开 QA-T8 行数漂移（T-129 曾踩）。
3. **边槽索引 ≠ 格索引**：`flowState[k]` 下标是通勤求解 `qSlot` 槽位。B 线把 `edgeToCell` 设为必填显式入参；C 线在模拟层补真实落点 `edgeCells`（取 R 连通块代表格 `blockRep[rb]` = flood fill 最小格索引），未写入槽用 `NO_EDGE_CELL=-1` 哨兵、每 tick `fill(-1)` 复位。**严禁循环下标冒充**——主理人与 QA 各自独立探针均得 `[80,80,84,84]`（预期 R 块代表格 `[80,84]`），可排除 `[0,1,2,3]` 的冒充形态。
4. **AC-T8 ④ 全程守住**：三态阈值与 `edgeCells` 都是纯视觉派生量，不进 `T_c / f_c / f_s / S` 计分链；FS-3/FS-8「改阈值 S 不变」、EC-6（阈值探针 S/T_c 严格相等）、EC-7（毒化 scratch 复位）、EC-8（源码无计分链累加）双向证明。
5. **跨层契约零退化**：`flow.*` 字面全仓恰好 6 处，全在 `src/render/**`（draw-list 3 + flow-legend 3），`src/ui/**` 0 命中；`OpaqueSwatch.paint` 不透明、UI 不解析内部；阈值键只在 `config.ts` + `traffic.ts`；渲染层不 import simulation。
6. **barrel 挂载零静默丢失**：`src/ui/index.ts` 仅 +1 行 diagnosis re-export + 3 行注释，**D-14 编译期断言块逐字未动**；QA 动态 import 得 75 键、逐一比对 7 个源模块 `missing=[]`（含历史上静默消失过的 `createInteractionController`），tsc 无 TS2308/TS2344。
7. **D-16 根因抓得准**：实现方查实「教学占位归因在**任意** `cur.dS===0` 的 tick 都会产生」，故不能单凭教学条目判首 tick；改为 `tickId===0 && cycleId===0 && cycleTickIndex===0 && 无来源抑制` 三判据分类，区分「E1 首 tick 教学」/「数据缺失：无可追溯来源」/「无快照记录」，数据诚实性字段全部保持。

---

## 4. 缺陷终态表

| ID | 级别 | 描述 | 终态 |
| --- | --- | --- | --- |
| D-13 | 缺陷 | `FeedbackChannelKind` 缺 outline、`shape==='none'` 仍计 shape | CLOSED（W3 收口） |
| D-15 | 流程事故 | `ui-token-contract.test.ts` 被覆盖（引入 git 前） | CLOSED：现 7 条为唯一门禁、不凭记忆复原；git 基线 + 每批统一提交兜底 |
| GAP-13 | 覆盖缺口 | AC-T8 用例缺失 | CLOSED（2026-11-06） |
| **D-16** | S4 | `tutorialOnly` 时文案无条件自称「首 tick 教学」，但 `tickId=11` 全部无来源被抑制（非首 tick）也会触发 | **CLOSED（2026-11-07 · T-138 / T-139）**：三分类 + 6 组 QA 独立快照探针 + DQ-25/26、DP-11/12 全绿；数据诚实性未退化 |
| — | — | T-139 未发现新的 D 编号缺陷、无 S1/S2/S3 | — |

---

## 5. S-12 遗留与装配约束（不阻塞 S-09）

| 项 | 说明 | 约定 |
| --- | --- | --- |
| **真实场景上屏装配** | 项目当前**无应用装配层 / 组合根**，`preview/` 是程序化占位单文件、不跑 `runTick`。S-09 交付的是「可被组合根调用的生产侧纯函数 + 模拟层数据导出 + 测试数据链」，**尚未接入真实场景上屏** | 组合根须同时持有 tokenMap、当帧 `flowState + edgeCells`、vm/manifest/lod，在 AD-004 **通道 B（tick 结算后）**调用；接线时传 `cellCount = side*side` 启用越界过滤。**按 T-136 约定：若 W5/准出未装配，届时视觉正确性判 FAIL，不追溯改判本批** |
| **逐边路径格导出** | `edgeCells` 是通勤需求发起点 R 块代表格，**非路径经过格、不保证逐边唯一**（同 rb 对多 ib 共享同一代表格） | S-12 若要沿路铺流线，须另做逐边路径格导出；本批未做 |
| **workspace 活引用** | `edgeCells` 原地复用、下一 tick 覆写（守 A9 零热路径分配） | 装配层须**当帧消费或 `slice()`**，不得跨帧缓存；建议 S-12 加「不得跨帧持有」用例 |
| **真机 <100ms 达标率** | 两级反馈的 `<100ms` 已定性为语义契约、结构可判定 | 真机测量随 S-12 / 校准报告，延续 GAP-05 |
| **像素级布局 / 200% 文本缩放** | L2 面板交付可排布 VM 与控制器 | 真机渲染与文本缩放实测随 S-12 |
| **ΔS 精确化** | `TickSnapshot` 顶层未承载 `dS`，耦合判定为近似 | 如需精确，S-05 补显式 `dS` 字段后只改 `makeCoupling` 第二入参，四段与分层零返工 |
| **`suggested_verb` 口径差** | P8 回放为 V8(调)/V1(教学)，与 ux-spec V3/V4/V5 不同 | 当前原样透传 + `ACTION_VERB_BY_CAUSE` 并存；上游是否直出 V3/V4/V5 属 S-05 / 模拟层议题 |
| **契约口径提示（非缺陷）** | `legend.ts` 默认 provider 直接 import 渲染函数，构成 UI→render 编译期依赖 | 按 §3.5.3 精确契约仍合规（零 flow 字面、零 tokenById、只取 label、有注入解耦点）；若追求严格单向可改组合根注入 |
| **准出层** | AC1 / AC3 / AC4 需可玩版本 + 人工 Playtest | W5 回填，仍 BLOCKED（预期状态） |

---

## 6. 质量门历程（三方独立）

| 节点 | 结果 |
| --- | --- |
| 第一批 A 线 / B 线 | 330/330 → 341/341（主理人各亲自复跑） |
| T-136 QA 第一批复核 | A 8/8 + B 8/8 PASS；341/341 两次一致；两次**文件级突变探针**撤销复绿；第一批门 PASS（advisory）；提交 `900222b` / `f9e0339` |
| 第二批 C 线 / D 线 | 379/379 → **394/394**（主理人亲自复跑 + 独立 tsc EXIT=0 + 8 项抽查 + 独立端到端探针） |
| T-139 QA 第二批复核 | C 9/9 + D 6/6 PASS；394/394 两次一致 + tsc 0；**内联事件突变探针** M1/M2 转假证明两级反馈判据非永真；关门项达成；**S-09 整体出口门 PASS（advisory）**；D-16 可 CLOSED |

**纪律**：全程 worker 未碰 git（统一由主理人提交）；所有数字为三方本机真实运行输出，未编造；ΔS 双口径限制、真机未测项、无组合根未上屏等均如实披露；「PASS」为 advisory，最终放行权在用户。

---

## 7. 台账与文档收口

- 共享任务台账：**38 completed / 0 pending**（#31 A~G 逐项核销、#33 按 D-15 裁定关闭）。
- 文档订正：`w3-retrospective.md` v1.1（S-09 正名）、`w3-ac-t8-verification.md §4`（观察项关闭 + 关门项 T-137 关闭 + S-12 转登记）、`hud-s08-verification.md`（mock 行关闭 + 已全部接通）、`s09-batch1-retrospective.md`（第一批历史快照加后续订正注记、§8 改为用户已拍板状态）。均**保留原文备查**，不抹去历史判定。
- 提交：`900222b`（第一批）/ `f9e0339`（工作日志）已落；第二批与本文随收口统一提交。

---

## 8. 下一步（待用户拍板）

S-09 是 W3「表现与交互层」的收官 Story（S-06 → S-07 → S-08 → S-09 全部交付）。按 `production/sprint-01.md §3.2`，后续可选：

- **W4 · 存档与回退**：S-10 本地存档与断点续玩 → S-11 回退重试 / 周期判定 / V9 解锁（与 W3 部分并行）。出口门 G5：杀进程可恢复、写中断自动回退、回退无逆运算、解锁进度入存档。
- **W5 · 闭环集成**：S-12 贯通 V1~V9、可访问性 Standard 全项、第一次真机性能基线校准、DoD 全量判定。
- 或：先审阅 S-09 交付（含两轮 QA 报告与本文），再进 W4。
- 或：暂停开发，保留当前收口状态。

---

*文档结束 · S-09 阶段收官 · 两批四线 · 394/394 全绿 · 整体出口门 PASS（advisory）· 关门项达成 · D-16 CLOSED · 真机上屏装配与真机达标率属 S-12（未测，不宣称达标）*
