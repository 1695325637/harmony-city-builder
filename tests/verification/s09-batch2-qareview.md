# HC-01 · S-09 第二批【第二层 QA / 独立复核】报告（T-139 · C 线 edgeCells + D 线 L2 面板/两级反馈）

| 项 | 内容 |
| --- | --- |
| 任务 | T-139 · S-09 第二批独立复核，判定 **S-09 整体出口门**（T-136 第一批复核的延续） |
| 复核人 | quality-lead（严守真） |
| 日期 | 2026-11-06 |
| 复核对象 | C 线 T-137：`traffic.ts`(365)/`tick-pipeline.ts`(454)/`flow-legend.ts`(184)/README + EC-1~12 + RF-12~14；D 线 T-138：`diagnosis-panel.ts`(531) + DP-1~15/DF-1~17/DB-1~4 + DQ-25/26 等 |
| 授权边界 | 只读 `src/`、`tests/`、`design/`、`docs/`、`production/`；**不提交 git**；本轮探针均为 `node -e` 内联函数级输入构造，**未改写任何源文件**（无需撤销） |
| 门定位 | advisory：QA 给判定，最终放行由用户决定 |

---

## 0. 一句话结论

> **独立复跑 394/394 EXIT=0、tsc EXIT=0；C 线九项 + D 线六项全部 PASS。T-136 遗留的「生产侧映射生成器」关门项已达成（`TrafficResult.edgeCells` 真实格导出 + `flowEdgesFromTick` 生产侧纯函数 + 端到端数据链，我用自己的多块城市探针独立复现 `[80,80,84,84]`/60 哨兵/4 映射/空城 64 全哨兵）；D-16 三分类经独立探针逐项验证可标 CLOSED；`projectTwoLevelFeedback` 两条关键不变量经我自造输入突变后如实转假（非永真）；barrel 动态导入 75 键零丢失、非诊断 50 名 vs 诊断 25 名交集空、D-14 断言块逐字未动。S-09 整体出口门：PASS（advisory，附 3 条 S-12 遗留与真机限定）；未发现新的 D 编号缺陷、未发现回归。**

---

## 1. 独立复跑记录

| # | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 1 | `node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts` | `0` | **394/394 pass 0 fail**（与主理人一致） |
| 2 | 同上（收笔前最终复跑） | `0` | **394/394**，无残留红 |
| 3 | `npx -p typescript@5.9.3 tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck src/index.ts src/ui/index.ts` | `0` | 零输出（**无 TS2308 / TS2344**） |
| 4 | 我的多块城市端到端探针（`node -e` 内联，自建城市未复用测试 helper） | — | 复现主理人数字，见 §2 |
| 5 | `flowEdgesFromTick` 过滤 / 毒化复位 / 三态线编码探针 | — | 全部符合契约，见 §2 |
| 6 | `projectTwoLevelFeedback` 两条不变量突变探针（自造事件输入） | — | BASE 全真 → M1/M2 转假，见 §3 |
| 7 | `queryDiagnosis` D-16 三分类 + 数据诚实性探针 | — | 见 §3 |
| 8 | barrel 动态导入 + 名字交集探针 | — | 75 键、missing=[]、overlap=[]，见 §3 |

> **探针形式如实声明**：本轮未做「临时改源文件」式突变（T-136 曾做过两次并撤销）；本轮突变均为**函数级输入构造**（向 `projectTwoLevelFeedback` 注入违规事件、向 `queryDiagnosis` 注入分类边界快照），不触碰磁盘，因此无撤销动作、无残留。

---

## 2. C 线 · 九项判定（9/9 PASS）

| # | 验收点 | 判定 | 独立证据 |
| --- | --- | --- | --- |
| ① | `edgeCells` 与 `flowState`/`qOverCap` 同长逐边对齐 | **PASS** | 我的探针：`solveTraffic` 三数组长度 **64/64/64**；代码 `ws.edgeCells[qSlot]=...` 与 `ws.qOverCap[qSlot]` 同块写入（traffic.ts L339~345），`flowState` 按 `ws.qOverCap.length` 构建（L359~363）；`TickResult` 经 `out.edgeCells = traffic.edgeCells` 透传（tick-pipeline L420） |
| ② | 格索引真实来自块拓扑（flood fill 最小格），严禁 i/qSlot 冒充 | **PASS** | 代码 L256~262 `rep=i; while(flood) if(cur<rep) rep=cur` → `ws.blockRep[b]=rep`（L280）；写边时 `ws.edgeCells[qSlot]=ws.blockRep[rb]`（L344）**不是** `qSlot`/`i`。我自建 2 R 块（y=5,x=0..1 → 最小格 **80**；y=5,x=4..5 → **84**）× 2 I 块城市，实测非哨兵项 `[80,80,84,84]` 与主理人数字一致；若用 qSlot 应为 `[0,1,2,3]`，可排除冒充 |
| ③ | 哨兵 `NO_EDGE_CELL=-1` 语义、未写入槽全 -1、workspace 复用复位、不填 0 冒充格 0 | **PASS** | 创建时 `new Int32Array(capacity).fill(NO_EDGE_CELL)`（L100~101）；每次 solve 开头 `ws.edgeCells.fill(NO_EDGE_CELL)`（L234）；空城探针 **64 项全 -1**；**毒化探针**：把 `edgeCells[0]=77;[5]=88` 后同 ws 再 solve → 全部复位 -1、`firstSlot=-1`。代码从未向未写入槽写 0 |
| ④ | `flowEdgesFromTick` 过滤哨兵/负数/非整数/NaN/Infinity/未知枚举/长度不齐/越界格，**不 import simulation** | **PASS** | 我的探针：`[80,-1,84,85]`→3 条（跳过哨兵）；`cellCount=100` 下 `999` 跳过、`0` 作为合法真实格保留；`NaN/Infinity/'bogus'` 全跳过；长度不齐按 `Math.min` 截断不补零；`-2/1.5` 跳过。代码 L173~183；`grep simulation` 在 `flow-legend.ts` **0 命中**（只 import `semantic-tokens` + `draw-list` 类型）；RF-2/RF-12 同向 |
| ⑤ | 端到端 `runTick → flowEdgesFromTick → buildFlowOverlays → buildDrawList`，cellIndex 与 edgeCells 逐项一致、三态 tokenId/线宽亮度正确 | **PASS** | 我的探针：真实 `runTick` 的 `edgeCells` 非哨兵 `[80,80,84,84]` → `flowEdgesFromTick(...,256)` 得 4 条 `[[0,80],[1,80],[2,84],[3,84]]` → overlays 4 → `flowDraws` 4、`cellIndex [80,80,84,84]`；另三态链得 `flow.clear/slow/congested` 与 deriveLine `1/0.6`、`2/0.8`、`3/1` 逐项正确。RF-12~14 全绿 |
| ⑥ | **AC-T8 ④ 不破**：edgeCells 纯视觉、不进计分链；改阈值 S 不变、毒化复位、源码无累加 | **PASS** | 代码 L343~348 写 `edgeCells` 后 `weighted/demand/r.E/T_c` 的累加**不含** edgeCells；我的阈值探针 `θ_clear` 0.5→0.7：`S` 与 `T_c` 均严格相等（与 edgeCells 存在无关）；毒化复位见 ③；EC-6/7/8 + FS-3/FS-8 在 394/394 中绿 |
| ⑦ | 确定性 | **PASS** | 我的探针：两个独立 workspace 同输入 `canonicalize([...edgeCells])` 逐字节一致；EC-9 绿 |
| ⑧ | README §2/§2.1 行数与磁盘一致、QA-T8 六模块未变、`draw-list.ts` 一行未改 | **PASS** | 独立 `wc -l` 对照：traffic **365** / tick-pipeline **454** / flow-legend **184** / index.ts **27** 全部与 README 一致；`iso175/view-model158/semantic-tokens323/atlas458/asset-naming343/draw-list334` 六模块与 T-136 时完全相同；`draw-list.ts` 仍 **334 行**（未改）；QA-T8 守卫在 394/394 中绿 |
| ⑨ | `src/index.ts` 未改（27 行）、`NO_EDGE_CELL`/`flowEdgesFromTick` 经既有 `export *` 可达 | **PASS** | `wc -l src/index.ts = 27`（与 T-136 一致）；我的所有探针均从 `./src/index.ts` 直接 import 到 `NO_EDGE_CELL`、`flowEdgesFromTick`、`solveTraffic` 等并成功执行，未新增 export 行 |

---

## 3. D 线 · 六项判定（6/6 PASS）

### ① D-16 已修 → 可标 **CLOSED**

`DiagnosisEmptyReason` 三分类（types.ts L42~56）：`E1_FIRST_TICK` / `MISSING_SOURCE` / `NO_SNAPSHOT`；`classifyEmptyReason`（diagnosis-query L89~99）用 `tickId===0 && cycleId===0 && cycleTickIndex===0 && unsourcedSuppressed===0` 判首 tick，且头注释明确「教学占位条目在任意 `cur.dS===0` 的 tick 都会产生，不能单凭教学条目判首 tick」。`emptyHeadlineFor`/`tutorialTextFor` 按分类给三份措辞（L101~111）。

**我的独立探针**（自建快照，未用测试 helper）：
| 输入 | emptyReason | headline 前缀 | traceable / unsourced |
| --- | --- | --- | --- |
| 真首 tick 0/0/0 + 教学占位 | `E1_FIRST_TICK` | 「首 tick 教学：空城基线」 | true / 0 |
| **tickId=11 + 教学占位 + 无来源** | **`MISSING_SOURCE`** | 「数据缺失：本 tick 无可追溯来源」 | **false / 1** |
| tickId=1 / cycleId=1 / cycleTickIndex=1 逐个取反 | 全部 `MISSING_SOURCE` | 「数据缺失…」 | false / 0 |
| 无快照 | `NO_SNAPSHOT` | 「该 tick 无快照记录」 | false / 0 |

→ **非首 tick（即便带教学占位条目）不再自称首 tick**，DQ-25/26 + DP-11 同向，D-16 修复成立。
**数据诚实性未退化**（同一探针）：`deltaSDecompositionCarried` 恒 `false`、`basis` 含「不等于 ΔS_abs − ΔS」、VM JSON 不含 `"dS"` 字符串、`COUPLING_BASIS` 含「无条件给出 S 绝对变化数值」、无「系统波动/来源不明」兜底字面量（仅注释中的自我约束）、`traceable`/`unsourcedSuppressed` 如实。

### ② 两级反馈可观测 → **PASS（语义/结构层，真机 <100ms 未测）**

`projectTwoLevelFeedback`（L447~530）为**纯只读投影**：只调 `source.historyA()/historyB()` 与 `motion.immediate()/tickFeedback()`，不 emit/订阅/读时钟/重算；`TwoLevelSeparationVerdict` 10 项不变量 → `separated` →（`bothChannelsObserved && diagnosisOpenObserved && diagnosisRefreshObserved`）→ `fullyObservable`（空观测不谎报，DF-13/14）。

**我的独立突变探针（自造事件输入，非复用 DF-7/11）**：
| 场景 | noBTypeInA | diagnosisRefreshOnlyInPostTick | separated | fullyObservable |
| --- | --- | --- | --- | --- |
| BASE（A: panel-open；B: tick-delta；常态动效） | true | true | **true** | **true** |
| M1：把 B 类 `tick-delta` 塞进 A | **false** | — | **false** | **false** |
| M2：把 `issue-change`（诊断刷新）塞进 A | **false** | **false** | **false** | **false** |

→ 两条关键判据**非永真**；DF-7~11 五条反向对照在 394/394 中绿。`TWO_LEVEL_LATENCY_NOTE` 逐字写「<100ms 为**语义契约** / 本投影不测量耗时 / **真机达标率未测**」；减动效下 A 静态编码、B `instant`、`informationLost=false`（DF-2/16）；DP-14 面板开合不增 `store.get` 次数、DF-17 A 通道不读 flowState/归因，均在 394/394 中绿。

### ③ L1/L2 互斥单槽位 → **PASS**

`DiagnosisPanelSlot`（L221~224）= `activePanel`/`setPanel` 结构化只读端口；`createDiagnosisPanel` 的 `isOpen` **恒为派生 getter**（`slot.activePanel === DIAGNOSIS_PANEL_TARGET`），控制器无本地布尔；`open()/close()/openL1()` 全委托同一 `slot`，`activeLayer` 委托第一批 VM 单值（L258~299）；`diagnosis/index.ts` L55 `AssertAssignable<HudViewModel, DiagnosisPanelSlot>` 编译期钉死（另有 4 条层间断言 L54~58）；DP-6/7/8/9 反向验证（两控制器共用槽位仍互斥）。面板视图为具名字段四段卡、≤4 卡/≤4 行、无二维数组/table/matrix/columns（DP-1/2）。

### ④ barrel 挂载零重名 → **PASS（独立动态导入，比静态 `comm` 更强）**

- 动态 `import('./src/ui/index.ts')` 得 **75 个运行时导出键**；逐一 `import` 全部 7 个被 `export *` 的源模块（feedback-bus / optimistic-view / interaction-controller / motion-policy / feedback-timing / hud/index / diagnosis/index），**`missing = []`** —— 无任何符号静默消失（含历史上出过问题的 `createInteractionController` 与第二批的 `createDiagnosisPanel`、`projectTwoLevelFeedback`）。
- 独立名字交集：非诊断 6 模块 **50** 名 vs 诊断 **25** 名（运行时值导出口径；实现方静态 135/57 含类型），**`overlap = []`**；tsc 零输出排除 TS2308/TS2344。
- `src/ui/index.ts`（53 行）的 **D-14 断言块 L29~53 逐字未动**（`AssertAssignable` 类型别名 + 5 条承诺，DB-4 绿）；新增仅 L24~27 三行注释 + 1 行 `export *`。SCAN-10 已含 4 行 `diagnosis/*`（+`diagnosis-panel.ts`）、SCAN-11 存在，394/394 全绿。

### ⑤ S-09 验收 ④ + ② 是否真正达成 → **均 PASS（含明确限定）**

- **验收 ④（单屏 ≤1 面板 / 分层披露 / 非密集表格）**：结构层真正达成——单槽位派生 `isOpen`、L0/L1/L2 分层、≤4 卡/≤4 行、具名字段四段卡、无二维矩阵（DP-1/2/6/7/8/9 + 我的代码复核）。**限定**：真机像素级布局与 200% 文本缩放属 S-12/真机验证（实现方报告 §9 已披露，不构成判定缺失）。
- **验收 ②（两级反馈分离可观测）**：语义/结构层真正达成——10 不变量 + 4 观测条件 + 我的突变探针 + DF-1~17（含 5 条反向对照）、A/B 时钟归属（TICK_FREE/FRAME_FREE）、减动效一致。**限定**：`<100ms` 真机达标率未测（全局既有 GAP-05 / DF-15，非本批新增），对外不得写「已达标」。

### ⑥ 跨层契约不破 → **PASS**

独立 grep（剥注释后）：`src/ui/**` 的 `'flow.clear/slow/congested'` **0 命中**；`.paint.<字段>` 解析 **0 命中**；`tick-pipeline` 字样在代码中 **0 命中**（仅在 5 行注释，与派单一致）；`src/ui/diagnosis/*.ts` 的 `runTick/advanceDay/.submit(/.put(` **0 命中**。SCAN-10/11、DX-1~9、HUD-SCAN-7/9、FS-9/10、ui-token-contract、ui-s07-timing 全在 394/394 中绿。

---

## 4. 关门项与 S-12 遗留登记

### 4.1 T-136 关门项「生产侧 FlowEdgeCell[] 映射生成器」→ **已达成**

T-136 原文要求：「首选模拟层在 `TrafficResult` 补 `edgeCells` 导出，组合根据此构造真实 `FlowEdgeCell[]` 并调用 `buildFlowOverlays`」。本批交付：`TrafficResult.edgeCells`（模拟层真实格导出）+ `flowEdgesFromTick`（生产侧纯函数生成器，过滤齐全、零 simulation 依赖）+ `TickResult.edgeCells` 透传 + 端到端数据链（RF-12~14 与我的独立探针均跑通到 `OverlayDraw.cellIndex`/三态线编码）。**关门条件满足，判达成**。

### 4.2 实现方披露的三条限制 → **登记为 S-12 遗留 / 装配层约束，均不阻塞本批**

| # | 限制 | 判定 | 归属建议 |
| --- | --- | --- | --- |
| ① | `edgeCells` 为「R 连通块代表格」，非路径经过格、同 rb 多 ib 共享代表格、不保证逐边唯一（我的探针 `[80,80,84,84]` 正是此语义） | 如实披露、非缺陷 | **S-12 遗留**：若沿路铺流线需另做逐边路径格导出；本批已按块对粒度诚实给出可用落点，不捏造路径格 |
| ② | workspace 原地复用的**活引用**，下一 tick `fill(-1)` 覆写 | 我独立探针确认 `first === tr2.edgeCells`（同一对象）；属 A9 零热路径分配的必然结果 | **装配层使用约束（S-12）**：组合根须当帧消费或 `slice()` 后再缓存；建议在 S-12 验收加一条「不得跨帧持有 edgeCells 引用」的用例 |
| ③ | 当前无应用装配层/组合根，`preview/` 不跑 `runTick`，**尚未接入真实场景上屏** | 本批交付的是「可被组合根调用的生产侧纯函数 + 模拟层数据导出 + 测试数据链」，与 T-136 关门项口径一致 | **S-12 装配**：把 `flowEdgesFromTick(flowState, edgeCells, side*side) → buildFlowOverlays → buildDrawList` 接进真实渲染帧；并传 `cellCount` 启用越界过滤（报告 §7 已提示） |

共同结论：三条均为**「待接线 / 使用约束」，不是「判定缺失」**；实现没有错判、伪造或静默错位（空映射→空叠层、哨兵复位、i 不冒充 cellIndex 均已验证）。按 T-136 约定，若到 W5/准出仍未装配，届时**视觉正确性**判 FAIL，不追溯改判本批。另两条全局真机遗留沿用：`真机 <100ms 达标率`（DF-15 / GAP-05）与 `真机像素布局 / 200% 缩放`（报告 §9）。

---

## 5. S-09 整体出口门判定（advisory）

**PASS（advisory）** —— C 线 9/9 + D 线 6/6 全 PASS；394/394 + tsc EXIT=0；关门项达成；D-16 CLOSED；无回归、无 S1/S2/S3、**未发现新的 D 编号缺陷**；所有探针为内联输入构造、工作区零残留。

附带条件（不阻塞，须登记）：
1. 三条 S-12 遗留（§4.2）写入 S-12 验收清单，尤其 ② 的「当帧消费 / 不得跨帧持有活引用」与 ③ 的「组合根传 `cellCount`」；
2. 全局真机遗留（<100ms 达标率、像素布局/200% 缩放）沿用 GAP-05 与报告 §9，对外表述维持「未测」；
3. 文档旧措辞（`w3-ac-t8-verification.md §4`、`hud-s08-verification.md` 的「未接线/mock 保留」）由主理人收口统一订正——本复核按代码事实判定，未因措辞判 FAIL。

**D-16 可标 CLOSED**（依据：§3① 三分类代码 + 我的 6 组独立探针 + DQ-25/26、DP-11/12 全绿，且数据诚实性字段未退化）。

最终放行权在用户；本判定为建议性门控。

---

## 6. 复核留痕

- 新增：`tests/verification/s09-batch2-qareview.md`（本文）。
- 未改动：`src/**`、`design/**`、`docs/**`、`production/**`、实现方报告与既有测试；未删文件；**未执行任何 git 写操作**。
- 探针纪律：本轮全部为 `node --experimental-strip-types --input-type=module -e` 内联脚本，只构造输入、不写磁盘；无「临时改源文件」动作，故无撤销项。所有数字（394/394、64/64/64、[80,80,84,84]、60 哨兵、4 映射、75 键、50/25、BASE/M1/M2 布尔表）均为本机真实运行输出，未编造、未照抄。

---

*文档结束 · T-139 · S-09 第二批独立复核 · C 9/9 + D 6/6 PASS · 关门项达成 · D-16 CLOSED · 3 条 S-12 遗留（不阻塞） · **S-09 整体出口门 PASS（advisory）** · 394/394 + tsc 0 独立复跑一致*
