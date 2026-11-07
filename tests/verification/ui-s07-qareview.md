# HC-01 · S-07「UI 双通道」【第二层 QA / 独立复核】报告（T-128 / W3）

| 项 | 内容 |
| --- | --- |
| 工作代号 | HC-01（非产品名） |
| 任务 | T-128 · S-07 独立复核（engineering-ui T-122 交付的第二层 QA / fresh eyes） |
| 日期 | 2026-11-06 |
| 复核对象 | `src/ui/`（6 文件 **1 502 行**）、`tests/unit/ui-*.test.ts`（5 文件 50 条）、`tests/verification/ui-s07-timing.test.ts`（4 条） |
| 自证材料（只读） | `tests/verification/ui-s07-verification.md`（228 行，**未改动**） |
| 授权边界 | 只写 `tests/`：新增 `tests/verification/ui-s07-qareview.test.ts`（8 条）+ 本报告。**未修改** `src/ui/**`、`src/render/**`、`preview/`、`design/`、实现方报告 |
| 报告形式 | **独立成文**，不并入其 `ui-s07-verification.md`（自证与复核分离，便于追溯责任链） |
| 质量门定位 | **advisory（建议性）**：判定由 QA 给出，最终放行由用户决定 |

---

## 0. 一句话结论

> **S-07 五条验收全部成立（结构层/事件载荷层），UI 层「零写状态 + 双通道时钟隔离 + 结算期锁闸门但视觉仍响应 + 非法回滚 + 减少动态效果 + 倍速默认关」经我自造真实 runTick 与独立静态重扫复验通过，54 条自证用例 + 我 8 条复核用例全绿，tsc(src/ui) EXIT=0。「<100ms」仅结构就绪、真机未测，报告无任何「已达标」表述。S-07 层判定 PASS（advisory）；W3 出口门仍 CONCERNS（S-08/S-09 未交付），且复核窗口末尾出现 2 条 **S-06/T-129 侧在途改动导致的红**（非 S-07，详见 §1.3），需其主人收口。**

---

## 1. 独立复核运行记录（2026-11-06，本机真实执行）

### 1.1 主运行（复核窗口 T0，我的套件加入前）

| # | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 1 | `node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts` | `0` | **214/214**（与主理人给的 207 差异来自并行套件继续增量，非失败） |
| 2 | `npx --yes -p typescript@5.9.3 tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions src/ui/index.ts` | `0` | **零错误零输出** |
| 3 | `node --experimental-strip-types --test tests/unit/ui-*.test.ts tests/verification/ui-*.test.ts`（**含我 8 条**） | `0` | **62/62**（实现方 54 + 我 8） |
| 4 | `node --experimental-strip-types --test tests/verification/ui-s07-qareview.test.ts` | `0` | **8/8**（QA-U1~U8） |

**既有基线零回归**：51 条模拟层 + 21 条 verification 基线 + 45 条 render + 我此前 19 条（QA-R 10 + QA-T 9）计数全部未变；S-07 **未改动任何既有文件**（其报告 §6 声明与我 mtime 核对一致：`src/index.ts` 未改、`src/render/**` 只读、`tests/` 既有非 ui 文件未改）。

### 1.2 我的复核套件（与实现方 54 条刻意不重叠的维度）

| 用例 | 维度 | 与实现方用例的差异 |
| --- | --- | --- |
| QA-U1 | ③ 结算期闸门 | **自造真实 `runTick`**：`createSimulation(config, state, { onStage })`，在 **P4 阶段回调内**（gate 已锁、尚未 unlock）触发 `zone / select / advanceDay`；断言锁态、三类结果、恰 1 次结算、互不阻塞、无残留、负向编码来自令牌、A/B 时钟分层 |
| QA-U2 | ② 两类非法回滚 | 锁定区（x=20 ≥ unlockedSide）+ 预算透支（`B_cap + 1`）同批提交，一次结算后校验 **两条回滚原因原样搬运**（`LOCKED_REGION` / `BUDGET_LIMIT`）与编码来源 |
| QA-U3 | SCAN 独立重扫 | 我自写规则（含 `.set/.fill`、`Object.assign`、整体 `state =`、`node:` 依赖、`budget`/`tickId` 写入），并额外断言 **`src/ui` 恰 6 文件**、`performance.now` 仅计时文件 |
| QA-U4 | (a) 令牌依赖面 | 6 个 id 存在性 + **已删除 `base.primary` 走兜底不抛错** + UI 源码不再引用该 id（事故回归守卫） |
| QA-U5 | ⑤ 倍速 | 默认关 + 空档位永不动；开启后到期恰 1 次、`fromAutoAdvance` 标记、A/B 分层与手动一致 |
| QA-U6 | ④ 减少动态效果 | 三项全 false、静态模式/时长、通道 ≥2 且含 color+text、`outlineWidthPx` 声明、`informationLost=false` |
| QA-U7 | ① + ② | 0 tick 四类操作：tick 不推进、队列计数、A 通道齐备且全 `TICK_FREE`、B 为空、**状态指纹前后逐字节一致** |
| QA-U8 | (c) 端口覆盖度 | 核实 14/14 用例走真实 `Simulation`（13 次 `setup()` + 内联构造）、无假端口、无 `as unknown as UiSessionPort` 绕过 |

### 1.3 复核窗口末尾的 2 条红（**非 S-07**，如实上报）

窗口末尾复跑全量时出现 **220/222**：2 条失败均属 **S-06 / T-129 侧在途改动**，与 UI 层无关：

| 失败用例 | 现象 | 归因（mtime 取证） |
| --- | --- | --- |
| `NAME-7`（`render-naming.test.ts`）→ 后续变为 `NAME-8（T-129 §3）` | 先报 `font_ui_main_base_l1` vs `font_ui_cjk_base_l1` 不匹配；09:56 该测试被更新为 `_cjk` 后又出现 NAME-8 失败（`d1`↔`low` 词表校验未实现） | `src/render/asset-naming.ts` **09:53:40** 修改、`src/render/atlas.ts` **09:53:52** 修改、`render-naming.test.ts` **09:56:15** 修改——**T-129 命名契约改造正在落盘中** |
| `QA-T8`（我 T-124 的 D-07 文档守卫） | README 行数 183/444 vs 实际 340/458 不一致 | `src/README.md` 停在 **09:43**，`asset-naming.ts`/`atlas.ts` 09:53 已增行 → **D-07 文档漂移回归被及时发现**（这正是该守卫的用途，非误报） |

**判定**：两条红与 S-07 无因果关系；S-07 相关全绿（54 + 8）。**不代修**（`src/` 与实现方测试不在我的写域）。建议：T-129 收口时同步 README 行数与 NAME-8 实现，届时两条红自然转绿；在此之前**全量不可视为绿**。

**收笔时的最新状态（同一次复核内第三次复跑）**：`NAME-8` 已随 T-129 进展转绿；**仅剩 `QA-T8`（D-07 README 行数 183/444 vs 实际 340/458）一条红**——这是**真实的文档漂移回归**，由我的守卫捕获、责任在 S-06 侧（README 属 `src/` 写域，我不代改）。同时并行工作流又为 UI 增加 6 条用例（54→60），UI 子集仍全绿（68/68 = 60 + 我 8）。全量 **231/232**。

---

## 2. S-07 五条验收逐条独立判定

| 验收条件 | 判定 | 我的独立证据（非转抄） |
| --- | --- | --- |
| **① 默认暂停、未 tick 时 V3 / V5 / 切 Tab / 选中均即时响应** | **PASS（结构层）** | QA-U7：全新会话 `tickId=0`、`committedCount=0` 下执行 zone/road/setTab/select → tick 仍 0、队列 2 条（tab/select 不产命令）；A 通道事件类型集合含 `press / placement / tab / select`，**全部 `tickId === TICK_FREE`**，`dispatchCountB === 0`。**限定：真机「首帧可见」未测**（见 §5 U1） |
| **② UI 零写权威状态；非法命令可回滚且不残留** | **PASS** | QA-U7：6 类 UI 操作前后 `canonicalize(serializeState(state))` **逐字节相同**；QA-U3 静态重扫 6 文件零写路径（含方法形态与 `Object.assign`）；QA-U2：两类非法命令（锁定区 / 预算透支）结算后 `layer.size === 0`、回滚原因原样为 `LOCKED_REGION` / `BUDGET_LIMIT`、负向编码 `tokenId === 'status.negative'` 且 shape/color 与令牌逐值相等（**不是硬编码 ✕**） |
| **③ 结算期 gate 锁「推 / 改状态」、纯视觉仍响应；连点不双结算** | **PASS** | QA-U1（**自造真实 runTick**）：P4 回调内 gate 确为锁定；`zone` → `accepted=false / GATE_LOCKED / visualEmitted=true`；`advanceDay` 被拒 `committed=0`；`select` → `accepted=true`；外层 `advanceDay` `committed=1`、`tickId=1`、`committedCount=1`；被拒项 `itemFor()===undefined`（无残留），`GATE_LOCKED` 回滚标记 1 条且 `removed=true`。A 事件全 `TICK_FREE`、B 事件携带真实 tick —— 双通道互不阻塞 |
| **④ 「减少动态效果」开启后信息不丢失** | **PASS（声明层 + 事件载荷层）** | QA-U6：`effects()` 三项全 false；`immediate('press')` → `static-press-color`、`durationMs=0`、channels **不含 motion**、含 `color`+`text`（≥2）、`encoding.tokenId/label` 非空、`informationLost=false`、`outlineWidthPx=2`；`tickFeedback()` → `instant/0ms`；集成按压事件 `data.mode=static-press-color`、`channels` 无 motion。**限定：渲染侧是否真停 loop/粒子属 S-06/S-12，未在本层验证** |
| **⑤ 倍速不改分层且默认关** | **PASS** | QA-U5：`DEFAULT_UI_FEATURE_FLAGS.speedMultiplier=false`、`speedLevels=[]`、`pumpAutoAdvance(1e6)===null`；开启（500ms / 2 档）后 `pump(300)===null` 未到期、再 `pump(300)` 恰 1 次（`fromAutoAdvance=true`、`committed=1`）；自动推进时 A 事件仍全 `TICK_FREE`、B 事件全 `tickId=1`；随后手动推进同样恰 1 次 → **两种命令来源共用同一路径，分层不变** |

---

## 3. 实现方披露的四处风险 · 逐条结论

### (a) 跨层令牌耦合事故 → **结构缺陷成立（无令牌 id 稳定性契约）；当前无脆弱耦合；应补契约（建议已列入 T-129）**

**事实链**：UI 初版以 `base.primary` 作按压/面板主色 → 渲染侧 A-07/A-08 令牌唯一化**删除了该 id**（`semantic-tokens.ts` 现只在 `BASE` 常量保留 `primary` 值，**不再产 `base.primary` 令牌**，主色仅经 `status.selected` 出口）→ UI 首轮 12 条用例失败 → 改为 `status.selected` + `base.ink` 兜底 + `encodingOf(tokens, id, fallback)` 收口。

**我的判定**：
1. **是结构性缺陷**：令牌 id 是跨层唯一契约面，但当时**没有稳定性契约、没有弃用流程、渲染侧删除 id 前未做跨层影响检查**。这属于流程性缺陷（S3 级流程风险，已由事故暴露而非由门禁捕获）。
2. **当前不存在脆弱耦合**（QA-U4 双向证明）：UI 实依赖 id 全集 = `status.positive / status.warning / status.negative / status.selected / base.tile / base.ink` + 动态 `zone.<zoneId>`（R/C/I 及扩展）；全部存在；`base.primary` 缺失时**走兜底不抛错**；UI 源码已 0 处引用该 id（防回潮）。引用面收敛在 `optimistic-view.ts` 的 `legalityTokenId / uiActionTokenId / encodingOf` 与 `motion-policy.ts` 的 `TOKEN_OF` 两张表，共 4 个函数——变更影响面小且可审计。
3. **应要求补契约**（同意主理人倾向）：契约至少含 ① 令牌 id 白名单（`zone.*` 动态规则 + 固定 id 清单）；② **存在性门禁用例**（跨层消费方声明的 id 必须全部可解析）；③ 删除 = 先 alias 一版 + 弃用标注，再删；④ 兜底必须**可观测**（见 D-12 第 3 点）。**归属**：团队已有 Task #27「补令牌契约门禁用例 `tests/unit/ui-token-contract.test.ts`（等 T-129 落地后）」，与本建议一致；本报告 D-12 作为其输入。

### (b) `status.selected` 形状为 `'none'` → **报文成立；但描边通道未贯通到事件载荷（D-13）**

- **设计侧成立**：art-bible §3.4 表「选中 / 焦点 = 主色 `#2E6BE6` + 2px 描边 + 淡光晕」（L199），规则 4 的「色 + 形状」是对**状态形状**的要求，选中项在表内本就以「描边 + 光晕」承载第二通道；§9.2（L506）把「文字 / 动效」也计为合法通道。art-director 裁定与文档一致。
- **实现侧部分成立**：`motion-policy.ts` L106 `OUTLINE_WIDTH_PX = 2`、L183 `outlineWidthPx` 已声明；但 ① `channels` 数组对 press 仍列出 `'shape'`（而 selected 的 shape 为 `'none'` → 该通道**空转**）；② `interaction-controller.ts` 的 `scalarOf()` 只把 `mode / durationMs / channels` 放进事件 `data`，**未携带 `outlineWidthPx`**；③ 事件层「≥2 通道」实际由 `color + label(text)` 满足（label = 「选中 / 焦点（2px 描边 + 光晕）」，语义在文字里）。
- **结论**：**「状态类 ≥2 通道」在 selected 上报文成立**（色 + 文字；描边为第三通道）；但「描边通道」未以结构化字段贯通到消费方，下游需按 `tokenId === 'status.selected'` 或读 `motion.immediate()` 才知道画 2px 描边 → 记 **D-13（S4）**。

### (c) `UiSessionPort` 窄端口 → **运行时覆盖 14/14 已实跑；类型层等价未断言属可接受缺口，建议补一行编译期断言（D-14）**

- **核实数量与内容**（QA-U8）：`ui-interaction.test.ts` 恰 14 条 `test()`；`setup()` 内建 `createSimulation(config, state)` 被调用 13 次，另有 2 处内联构造点（含 `onStage` 那条）；**无 mock/stub 端口、无 `as unknown as UiSessionPort` 类型绕行** → 主理人问的「14 条是否真实」**成立，且全部走真实会话**。
- **缺口性质**：`tests/` 不在 tsc 覆盖内（工作区零依赖、无 `@types/node`），所以「真实 `Simulation` 可赋给 `UiSessionPort`」这一点**没有编译期断言**，只靠运行期行为（提交/推进/计数器/闸门读数）间接证明——而运行期已经覆盖了这些成员的实际使用，故**缺口可接受、无当前风险**。
- **建议**（低成本、零运行开销）：在 `src/ui/interaction-controller.ts`（engineering-ui 写域）加一行编译期断言：
  `const _portTypeCheck: UiSessionPort = null as unknown as Simulation;`（仅 `import type`，不进产物）——一旦 `Simulation` 的成员签名漂移，tsc src-only 立刻红。记 **D-14（S4）**。

### (d) `<100ms` 口径 → **限定恰当，0 处「已达标 / 已实测」正面表述**

- 全文检索「达标」共 8 处，**全部为否定或限定**：L14「须真机测达标率后方可冻结」、L15「**不声称**『<100ms 已达标』」、L112「不得据本记录声称达标」、L127「**不是**真机达标率」、L140（免责逐字引用）、L227「**不应**被记为『<100ms 已达标』」。`feedback-timing.ts` L7~10 亦写明「只能作为回归基线，不能作为达标证据」。
- 样本限定同样诚实：n=240、p95=0.088ms 明确标注「进程内分发、不含触摸采样/布局/绘制/合成/垂直同步」；并披露两次运行 p50 0.004–0.008ms、p95 0.029–0.088ms、max 0.71–1.34ms 的抖动区间（不取单次最优）。
- **判定：口径合格（PASS）。** 对外只能表述为「**结构就绪 + 进程内分发非瓶颈；真机 <100ms 未达标率测试**」。

---

## 4. 缺陷 / 观察清单（自 D-12 起续）

> 编号说明：**D-11 已被 S-06 §T-121 占用**（A-07/A-08/A-14 越界关闭的流程观察），故本报告自 **D-12** 起续，避免与主理人「从 D-11 起」的字面要求冲突。

| 编号 | 等级 | 标题 | 事实与影响 | 处置建议 |
| --- | --- | --- | --- | --- |
| **D-12** | S3（流程）/ S4（代码） | **令牌 id 无稳定性契约**，删除即跨层破坏 | 事故实证：`base.primary` 删除导致 UI 12 条用例失败；当前靠「兜底不崩」缓解，但兜底会**静默降级视觉**（selected → base.ink 中性墨），无告警字段 | ① T-129 建立 id 白名单 + 弃用流程（先 alias 一版再删）；② 落地已规划的 `ui-token-contract.test.ts`（Task #27）；③ 兜底时在事件 `data` 增加 `degradedFrom: <缺失 id>`，让降级可诊断；④ 我的 QA-U4 已常驻为回归守卫 |
| **D-13** | S4 | selected 的描边通道未贯通事件载荷；`channels` 含空转 `shape` | 策略层声明 `outlineWidthPx=2`，但 `scalarOf()` 未透传；`channels` 对 selected 仍列 `shape`（值 `'none'`）。下游需按 tokenId 或读 motion policy 才能画描边 | `channels` 增加 `'outline'`（或在 `data` 带 `outlineWidthPx`）；当 `encoding.shape === 'none'` 时不要把 shape 计入通道数。**归属 S-08 接 UI 渲染时一并处理** |
| **D-14** | S4 | `UiSessionPort` 的编译期等价性无断言 | `tests/` 不在 tsc 覆盖内；14/14 运行期覆盖已实跑 | `src/ui/interaction-controller.ts` 加一行 `import type` 编译期断言（零运行成本）；与 D-12 可同批处理 |
| **D-15** | **S3（过程观察，非缺陷、非追责）** | **同一测试文件被两个 worker 先后 Write 覆盖**（`tests/unit/ui-token-contract.test.ts`） | 事实：engineering-lead 于 T-129 建该文件（**6 条**）；engineering-ui 交 #27 时**未检查存在性直接 Write**，覆盖为 7 条（其主动上报）；目录非 git，**原文不可恢复**。算术核对（我独立复验）：232 − 6 + 7 + 1 = **234**，与实测全量 **234/234** 一致，无证据缺失迹象 | 主理人裁定已执行：**以现版本 7 条（`TOKEN-CONTRACT-1`~`7`，我逐个核对存在且 7/7 绿）为唯一门禁，不凭记忆复原**（避免伪造证据）；engineering-lead 做 recall 核对确认无断言遗漏。防止再犯见 §4.1 |
| — | — | （**观察**）UI 层未并入根 `src/index.ts` | 其报告 §6 明确「不并入根导出」以避免与渲染并行改造冲突；当前应用侧从 `src/ui/index.ts` 取用，`tsc src/ui/index.ts` 独立覆盖。**非缺陷**，但需在 README/集成说明中留一行，避免 S-08/S-09 接线时找不到入口 | S-08 接入时补一行说明（README 属 engineering 写域） |

**统计**：S1 = 0、S2 = 0、S3 = **2**（D-12 契约流程面 / **D-15 双写过程**）、S4 = 3（D-12 代码面 / D-13 / D-14）。**无功能性缺陷、无数据/状态破坏风险。**

### 4.1 D-15 防再犯（给 S-08 / S-09 的凭据，**不是追责记录**）

**根因（三条，缺一即可能复发）**：
1. **「认领」语义不清**：共享任务板上「任务可见」被当成「文件可写」——任务归属应以**派单消息**为准，不以任务板可见性为准；
2. **无版本控制兜底**：目录非 git，覆盖即不可恢复（连带使「原文是否有遗漏断言」只能靠 recall 核对，无法机器验证）；
3. **`Write` 前无存在性检查**：新交付一个「补用例」类小单时，最自然的动作就是直接写新文件，而该文件可能已被同域另一位 worker 建过。

**给 S-08/S-09 的四条落地动作（S-08 会同时有两人写 `tests/`，同样的坑完全可能再来）**：
- ① **写前必须检查存在性**：对目标路径先 `Read`/`ls`；存在则**只做增量编辑**（Edit 追加），并在回执中显式区分「新建」还是「修改」，禁止「以我版本为准」的整文件 Write；
- ② **按文件名前缀做物理分工**（本团队已事实上这么用）：`render-*` / `ui-*` / `ui-token-contract` / `*-qareview*` 各归一方；跨前缀写同一文件前先发一条消息对齐；
- ③ **若建本地 git（不引入构建依赖，仅开发期版本管理）**：此类事故可 `git restore`，且「是否有断言遗漏」可机器比对——建议主理人评估在 S-08 开工前初始化本地仓库（零依赖原则不受影响：`package.json`/`node_modules` 仍不需要）；
- ④ **门禁文件加来源头**：文件头写 `owner / 建档时间 / 最近改动者`，我后续复核会把「同文件多 owner 触碰」纳入 mtime + 声明一致性检查。

**对 S-07 判定的影响：无。** 现版本 7 条 `TOKEN-CONTRACT-1`~`7` 已由我逐个核对存在且 7/7 通过（存在性 / 反向哨兵 / 落位回滚 / 三段覆盖 / 反向探针 / zone 动态 / 文档同步），作为唯一门禁成立；「不凭记忆复原」的口径我认同——按记忆补写会在证据链上制造伪历史。

---

## 5. 未验证边界（我认可其 §2.2 的 U1~U8，并补充两条）

| # | 未验证项 | 我的确认 |
| --- | --- | --- |
| U1 | 真机「点按 → 首帧可见」<100ms 达标率（%） | 认可；实测须 S-12，不得据进程内样本称达标 |
| U2 | 真实触摸输入（采样率 / 抖动 / 长按拖拽） | 认可；本层只保证「一次点按 = 一条命令」 |
| U3 | Cocos UI 渲染（节点树 / 合批 / 首帧上屏） | 认可；S-06 适配未在引擎内验证（与我 T-119/T-124 结论一致） |
| U4 | 折叠屏展开 / 平板双栏 / 系统字号 200% / 热区 ≥44dp（当时基线 44dp；S-12 起上调至 48dp） | 认可 |
| U5 | 色盲三型模拟下「分区 vs 状态」可辨识 | 认可；本层只保证形状来自令牌且两两不同 |
| U6 | 结算 p95 ≤16ms | 属 S-04（已有 perf-s04 证据） |
| U7 | 音频冗余 / 市民之声文案渲染 | 认可，留 S-09 |
| U8 | 议题增删真实规则（2~4 条） | 认可；P6 仍占位 |
| **U9（我补）** | **真实渲染帧循环驱动 `pumpAutoAdvance(elapsed)` 的时序**（倍速开关开启时） | 本层只验证「传入 elapsed 的行为」，帧循环接法属 S-08/S-12；且倍速为 Should 且默认关，不阻塞 MVP |
| **U10（我补）** | **乐观视图与真实 VM 的合成**（`compose(baseVM, layer)` 在真实渲染管线的表现） | 本层验证了 compose 只读与不改 baseVM，但合入 `draw-list` 的实际渲染未接（S-08/S-12） |

---

## 6. S-07 层门判定与 W3 合并判定（advisory）

### 6.1 S-07 层

**PASS（advisory，<100ms 真机未测；S3 流程项 1 + S4 项 3 不阻塞）**

理由：五条验收全部成立（四层证据：自证 54 条 + 我 8 条独立用例 + 静态重扫 + 真实 runTick 集成）；UI 零写状态有三重结构保证（类型面端口不暴露 state、静态扫描、指纹断言）；双通道时钟隔离有类型层（`EventDetail` 无 tickId 字段）与运行层双证；无 S1/S2 缺陷；既有基线零回归。

### 6.2 W3 出口门逐条（`SM-W3-01~06`）

| 编号 | 状态 | 依据 |
| --- | --- | --- |
| `SM-W3-01`（四类操作即时可见 + 达标率） | **PARTIAL（结构 PASS / 真机达标率未测）** | QA-U7 结构证据充分；「点按 → 首帧可见 <100ms」需真机（S-12）。**不得仅因建议基线数值判 FAIL**（checklist 原文） |
| `SM-W3-02`（UI 写路径 = 0；非法命令撤销 + 形状负向反馈） | **PASS（逻辑层）** | QA-U3 零写路径；QA-U2 两类非法均撤下且负向形状来自 `status.negative`；「非仅靠颜色」由形状通道保证 |
| `SM-W3-03`（结算期纯视觉仍响应；连点不双结算） | **PASS（逻辑层）** | QA-U1（真实 P4 回调内）+ 其 UI-6（`DUPLICATE_KEY`）；真机交互时延未测 |
| `SM-W3-04`（控件树 / 面板栈 / 3 项常驻 / 无倍速控件） | **未执行** | 依赖 **S-08**（controls/panels）未交付；S-07 只提供面板互斥逻辑 |
| `SM-W3-05`（归因面板四段只读查询） | **未执行** | 依赖 **S-09** 未交付 |
| `SM-W3-06`（渲染层零写 / 三档同图集 / 色值经令牌 / 格式探测入校准） | **PASS（离线可验范围）**，但**当前有在途红** | 我 T-124 已判 PASS（③PARTIAL 仅「入校准记录」）；**但 09:53~09:56 的 T-129 改名改动使 `render-naming` 与我的 D-07 文档守卫转红**，需 T-129 收口后才恢复绿 |

**W3 出口门（合并 S-06 + S-07）：仍 CONCERNS，不可判 PASS。** 三个原因：① `SM-W3-04` / `SM-W3-05` 不可执行（S-08 / S-09 未交付）；② `SM-W3-01` 真机达标率未测；③ 当前全量存在 2 条 S-06/T-129 侧在途红（非 S-07，但会污染 CI 信号，必须先修）。**建议**：允许 S-08 继续/开工，S-07 层可视为已可依赖；W3 门待 S-08/S-09 交付 + T-129 收口 + 真机校准后重判。

---

## 7. 复核留痕

- **新增**：`tests/verification/ui-s07-qareview.test.ts`（8 条）+ 本报告。
- **未改动**：`src/**`（含 `src/ui`、`src/render`、`src/index.ts`）、`preview/**`、`design/**`、实现方 `ui-s07-verification.md`、既有全部测试与文档。未提交 git、未删除文件。
- **数值纪律**：全部计数/退出码为本机真实运行；`<100ms` 仅「结构就绪、真机未测」；未编造任何数值。
- **并行工作流记录**：复核窗口内 UI 用例曾由 54 → 62（我 +8）；末尾 S-06/T-129 侧出现 2 条在途红，已在 §1.3 取证并隔离，不计入 S-07 判定。
- **诚实声明**：其自证「198/198」与当前 214/222 的差异来自并行增量与在途改动，非其用例减少；我的复核以「加入我这 8 条前后」两次实测为口径（214/214 → 222 条中 220 绿、2 红均非 S-07）。

---

*报告结束 · T-128 · S-07 第二层 QA 独立复核 · 五条验收 ①PASS ②PASS ③PASS ④PASS ⑤PASS（均含真机限定）· UI 62/62 + 全量 214/214（窗口末尾 220/222，2 红为 S-06/T-129 在途）· S-07 层 **PASS（advisory）** · W3 出口门 **CONCERNS**（SM-W3-01 PARTIAL / 02·03 PASS / 04·05 未执行 / 06 需 T-129 收口）· 新增 D-12（令牌契约）/D-13（描边未贯通）/D-14（端口编译期断言）*
