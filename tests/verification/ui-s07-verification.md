# S-07 · UI 双通道与 <100ms 即时反馈 · 验证记录

| 项 | 内容 |
| --- | --- |
| Story | **S-07**（W3）· UI 双通道 + 乐观视图 + MotionPolicy + 分发计时探针 |
| 实现 | 程基岩（engineering-ui，engineering-lead 第二实例，专做 S-07） |
| 日期 | 2026-11-06 |
| 范围 | **新增 `src/ui/**`（6 文件）+ `tests/**`（6 文件）**；未改动任何既有文件 |
| 权威口径 | ADR-004 §2 / §6 / §7；`design/ux/ux-spec.md` §3.1 / §3.2 / §3.3 / §4.1 / §7 E4~E5；`design/art/art-bible.md` §8.1~§8.4 / §9.2 / 附录 D-3 |
| 测试基座 | Node v22.22.2 + `--experimental-strip-types` + `node:test`，零依赖（无 package.json / tsconfig / node_modules） |
| 全量结果 | **198 / 198 通过**（`node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts`）。其中本批新增 **54 条**（unit 50 + verification 4）；其余为既有 127 条基线 + 并行实例同期新增用例 |
| 类型检查 | `npx -p typescript@5.9.3 tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions src/ui/index.ts` → **0 error** |

> **数字立场（贯穿全文）**：<100ms 是 ADR-004 §7 A1 的**验收目标 / 建议基线**，须真机测达标率后方可冻结。
> 本记录只提供**进程内分发延迟**样本与**结构证据**，**不声称「<100ms 已达标」**。

---

## 0. 交付清单

### 0.1 实现（`src/ui/`，共 1502 行）

| 文件 | 行数 | 职责 | 关键结构约束 |
| --- | --- | --- | --- |
| `feedback-bus.ts` | 287 | `FeedbackBus` 双通道事件总线：A 类 `press / placement / highlight / tab / select / rollback / panel-open`，B 类 `tick-delta / issue-change / voice / flow-state` | 通道 A 事件恒 `tickId = TICK_FREE(-1)` + 真实 `frameId`；通道 B 恒 `frameId = FRAME_FREE(-1)` + **必须**真实 `tickId ≥ 0`（负数 / 非整数抛错）；`EventDetail` **类型上没有 tickId 字段**（A 通道从类型层面读不到 tick）；两通道独立 `seq` / 计数器 / 监听器，互不阻塞；监听器抛错留痕 `listenerErrors()` 不吞异常 |
| `optimistic-view.ts` | 339 | `createOptimisticLayer()`：`apply(cmd)` 生成落位 / 拆除 / 扣减预览叠加项，`applyUi()` 生成选中 / Tab / 面板态；`rollback()` 撤下并派发 `rollback` + 负向形状编码；`compose(baseVM, layer)` 输出只读合成视图 | 不 import `core/simulation` 状态结构（只 import `Command` **类型**）→ 拿不到 `CityState`，结构上不可能写；色 / 形状一律 `tokenById()`，**零 hex、零形状字面值**；回滚后 `active()` 不含该 commandId（不残留） |
| `interaction-controller.ts` | 518 | `createInteractionController()`：V3 划 / V3 拆除 / V4 拨 / V5 连（含**点击替代路径** `roadClickPath`）/ V6 推 / Tab / 选中 / L1↔L2 互斥 / 倍速 feature flag | 只经 `session.submit(cmd)` 与 `session.advanceDay(key)`；`UiSessionPort` **不暴露 state**；不 import `tick-pipeline`、不调用 `runTick`；循环内 `gate.isLocked` 时「推 / 改状态」被拒但按压 / 选中仍派发；`emitB` 只在本文件（结算结果处理）与总线定义处出现 |
| `motion-policy.ts` | 199 | `createMotionPolicy()`：`effects()` 声明 loop / 粒子 / 相机缓动；`immediate(kind)` 即时反馈降级声明；`tickFeedback()` tick 后反馈降级声明 | 减少动态效果 → `effects()` 恒等 `{loops:false, particles:false, cameraEase:false}`；即时反馈降级为 `static-outline` / `static-press-color` 且**返回具体编码**（令牌 id + 色 + 形状 + 文字 + 描边宽度），`channels` 去掉 `motion` 后仍 ≥2，`informationLost:false`；时长只引用 art-bible §8.2 的 120 / 200 / 320ms（落位取 §8.3 区间中值 180ms） |
| `feedback-timing.ts` | 137 | `sampleDispatchLatency` / `createDispatchProbe` / `percentile` | `performance.now()` **全项目仅出现在本文件**；导出名与 `DISPATCH_LATENCY_SCOPE = 'in-process-dispatch-only'`、`DISPATCH_LATENCY_DISCLAIMER` 共同声明「不是真机达标率」；空样本 `percentile → NaN`（不伪造 0） |
| `index.ts` | 22 | 本层导出 | **未改根 `src/index.ts`** |

### 0.2 测试（共 1101 行 / 54 条用例）

| 文件 | 行数 | 用例 | 覆盖 |
| --- | --- | --- | --- |
| `tests/unit/ui-feedback-bus.test.ts` | 152 | 9 | 双通道时钟隔离、B 拒绝虚构 tick、监听器隔离、取消订阅、容量上限、事件冻结 |
| `tests/unit/ui-optimistic-view.test.ts` | 196 | 10 | 落位 / 拆除 / 扣减预览、连点幂等、**回滚不残留 + 负向形状**、形状两两不同、预检不改裁决、compose 只读、未知令牌兜底 |
| `tests/unit/ui-interaction.test.ts` | 348 | 14 | **0 tick 下四类即时事件**、**UI 零写状态指纹**、面板互斥、**两类非法命令回滚**、**连点幂等**、**结算期 gate 锁但视觉仍响应**、B 事件齐备、点击替代路径、**倍速默认关 / 开启不改分层** |
| `tests/unit/ui-motion.test.ts` | 126 | 7 | 三项动效开关、**降级后静态编码非空**、形状映射对齐令牌、tick 反馈瞬时跳变、开关可逆、集成载荷 |
| `tests/unit/ui-static-scan.test.ts` | 157 | 10 | 无 `cc` / 无 `Math.random`·`Date.now`、`performance.now` 仅计时文件、无 `runTick`·`tick-pipeline`、**无 state/cells/budget 写入**、零 hex、`emitB` 仅两处、import 全为带 `.ts` 相对路径、A 侧不 import `simulation/**`、文件清单固定（均含正向对照，防正则写歪） |
| `tests/verification/ui-s07-timing.test.ts` | 122 | 4 | 百分位语义、探针透传 / 异常留样、S-07 分发分布采样（诊断输出）、结算前后 A 事件仍 `TICK_FREE` |

> 令牌隔离纪律：**所有用例都不断言形状字面值**（`'!'` / `'↑'` / `'✕'`），只断言「形状非空」「两两不同」「与 `tokenById(...)` 查到的令牌一致」。渲染层做形状唯一化改造时本批用例不会误报。

---

## 1. 五条验收逐条对照

### ① 默认暂停、未发生任何 tick 时，V3 / V5 / 切 Tab / 选中均给出即时可见响应

| 项 | 内容 |
| --- | --- |
| 判据 | 默认暂停 + `tickId === 0` 下，四类操作各自产生通道 A 事件；A 事件不带 tick 信息；B 通道为空 |
| 证据 | `UI-1`：`zone()` / `road()` / `setTab()` / `select()` 后 `sim.tickId === 0`、`sim.committedCount === 0`；`historyA()` 含 `press / placement / tab / select`；每条 A 事件 `tickId === TICK_FREE`；`dispatchCountB === 0`。`BUS-1`：A 事件按 `beginFrame()` 计数。`TIMING-4`：结算前后 A 事件均 `TICK_FREE`。`MOT-7`：减少动态效果下按压载荷仍含非空静态编码 |
| 结论 | **PASS（结构层）**：即时反馈与 tick 在**代码结构上无耦合**（A 侧模块不 import `simulation/**`，`EventDetail` 无 tickId 字段）。<br>**⚠️ 限定**：「<100ms 内可见」的**真机**部分未验证，见 §3 与 §4 |

### ② UI 零写权威状态；非法命令可回滚且不残留

| 项 | 内容 |
| --- | --- |
| 判据 | UI 操作不改变 `state` 指纹；`BudgetRejected` 后乐观叠加撤下 + 负向形状编码 |
| 证据 | `UI-2`：10 个连续 UI 操作前后 `canonicalize(serializeState(state))` **逐字节一致**、`tickId` 不变。`SCAN-5`：`src/ui/**` 无 `state.x =` / `cells.*[...] =` / `budget.x =` / `.tickId =`（含正向对照）。`UI-4`：锁定区命令 → `BudgetRejected / LOCKED_REGION`，`layer.size === 0`，`rollback` 事件形状 `=== tokenById('status.negative').shape`。`UI-5`：`FUND` 超上限 → `BUDGET_LIMIT` 回滚。`OV-4`：回滚后 `active()` 为空、`itemFor()` 为 undefined |
| 结论 | **PASS** |

### ③ 结算期 InputGate 锁「推 / 改状态」，纯视觉反馈仍响应；连点不双结算

| 项 | 内容 |
| --- | --- |
| 判据 | 真实 P4 阶段内：`zone()` / `advanceDay()` 被拒；`select()` / `press()` 仍响应；整轮只结算 1 次；被拒动作不留叠加残留 |
| 证据 | `UI-7`（真实 `onStage: P4` 回调内触发）：`lockedZone.accepted === false`（`GATE_LOCKED`、`visualEmitted === true`）、`lockedAdvance.accepted === false`、`lockedSelect.accepted === true`；`committedCount === 1`、`tickId === 1`；`mutatesAuthority` 的残留叠加项 = 0。`UI-8`：手动 `gate.lock()` 等价路径 + 解锁后恢复。`UI-6`：同 key 两次 `advanceDay` → 第二次 `DUPLICATE_KEY`、`committed === 0`、`tickId` 仍 1 |
| 结论 | **PASS**（与 `tests/unit/input-gate.test.ts` 的 S-03 闸门结论一致，未改动该层） |

### ④ 「减少动态效果」开启后信息不丢失

| 项 | 内容 |
| --- | --- |
| 判据 | loop / 粒子 / 相机缓动全 false；即时反馈降级为静态描边 / 按压色且编码非空；tick 后反馈改瞬时跳变 |
| 证据 | `MOT-2`：`effects()` 深度等于 `{loops:false, particles:false, cameraEase:false}`。`MOT-3`：8 类即时反馈逐个校验 `mode ∈ {static-outline, static-press-color}`、`durationMs === 0`、`encoding.tokenId/color/label` 非空、`channels` 不含 `motion` 且 ≥2、`informationLost === false`。`MOT-4`：落位 / 拆除形状与 `tokenById` 一致且**两两不同**、降级前后编码相同（只改表现不改语义）。`MOT-5`：`tickFeedback()` 由 `animated/320ms` → `instant/0ms` 且编码非空。`MOT-7`：集成层按压事件载荷 `mode: static-press-color`、`durationMs: 0`、`channels` 不含 motion |
| 结论 | **PASS（声明层 + 事件载荷层）**；渲染侧是否真的停播 loop / 粒子属 S-06 / S-12，**未在本层验证** |

### ⑤ 倍速不改变分层，且默认关

| 项 | 内容 |
| --- | --- |
| 判据 | `IFeatureFlags` 默认关；开启后仅「定时产生 V6 命令」，A / B 通道分层不变 |
| 证据 | `UI-12`：`DEFAULT_UI_FEATURE_FLAGS.speedMultiplier === false`、`speedLevels.length === 0`、`pumpAutoAdvance(1_000_000) === null`、`tickId === 0`。`UI-13`：开启后 `pump(400) === null`（未到期）→ `pump(700)` 产生 `auto-advance-1`，`committed === 1`、`tickId === 1`；随后断言 A 事件仍全 `TICK_FREE`、B 事件仍全 `tickId === 1` |
| 结论 | **PASS**。倍速与手动共用同一 `advance()` 路径，命令来源不同而分层不变（ADR-004 §2 子决策 5） |

---

## 2. 已验证 / 未验证

### 2.1 已验证（可复跑）

| # | 已验证项 | 证据 |
| --- | --- | --- |
| V1 | 双通道时钟隔离（A 不带 tick / B 不带帧） | `BUS-1` `BUS-2` `BUS-8` `SCAN-9` |
| V2 | B 通道不可能被虚构（负 / 非整数 tickId 抛错） | `BUS-3` |
| V3 | 通道互不阻塞（监听器抛错不跨通道传染、不吞异常） | `BUS-5` |
| V4 | 0 tick 下四类即时事件齐备 | `UI-1` `TIMING-4` |
| V5 | UI 零写权威状态（指纹逐字节 + 静态扫描 + 端口不暴露 state） | `UI-2` `SCAN-5` `SCAN-7` |
| V6 | 非法命令回滚不残留 + 负向形状编码来自令牌 | `UI-4` `UI-5` `OV-4` |
| V7 | 连点不双结算（幂等键） | `UI-6` |
| V8 | 结算期锁「推 / 改状态」、纯视觉仍响应 | `UI-7` `UI-8` |
| V9 | 点击替代路径与拖拽产生同构 ROAD 命令 | `UI-11` |
| V10 | 减少动态效果三项全 false + 静态编码非空 | `MOT-1` `MOT-2` `MOT-3` `MOT-4` `MOT-5` `MOT-7` |
| V11 | 倍速默认关、开启不改分层 | `UI-12` `UI-13` `SCAN-*` |
| V12 | 无 `runTick` / 无 `tick-pipeline` / 无 `cc` / 无 `Math.random` / 无 `Date.now` / 零 hex / 零依赖 import | `SCAN-1`~`SCAN-8` |
| V13 | 进程内分发延迟分布可测（见 §3） | `TIMING-1`~`TIMING-3` |
| V14 | 严格类型检查通过 | `tsc --noEmit --strict` 0 error（命令见文首） |

### 2.2 未验证（**明确未测，不得据本记录声称达标**）

| # | 未验证项 | 原因 | 建议归属 |
| --- | --- | --- | --- |
| U1 | **真机「点按 → 首帧可见」<100ms 达标率（%）** | 本机无 Cocos Creator、无 HarmonyOS 真机；进程内分发耗时不含触摸采样 / 布局 / 绘制 / 合成 / 垂直同步 | S-12 真机校准（ADR-004 §7 A1） |
| U2 | 真实触摸输入（采样率、抖动、长按 / 拖拽手势识别） | 无真机、无 Cocos 输入栈 | S-08 / S-12 |
| U3 | Cocos UI 渲染（节点树 / 图集 / 合批 / 首帧上屏） | 本层引擎无关；`render/cocos` 适配与真实引擎验证不在本 Story | S-06 后续 / S-12 |
| U4 | 折叠屏展开态 / 平板双栏 / 系统字号 200% 下的即时反馈与热区（≥44dp） | 无真机与多形态环境；本层只提供 `LayoutProfile` 无关的反馈机制 | S-08 / S-12（ADR-004 A5） |
| U5 | 色盲三型模拟下「分区 vs 状态」可辨识 | 需渲染与图像工具；本层只保证形状编码来自令牌且两两不同 | S-12 / art 侧 |
| U6 | 结算耗时 p95 ≤16ms（P0–P8） | 属 S-04 性能证据范畴（已有 `perf-s04` 用例，本 Story 未新增） | S-04 / S-12 |
| U7 | 音频冗余 / 市民之声文案渲染 | 本层只搬归因 refs，文本渲染留 S-09；无音频资产 | S-09 |
| U8 | 议题增删真实规则（2~4 条） | P6 仍为占位；本层只在结算给出 `issue-change` 信号 | S-05 / S-09 |

---

## 3. 进程内分发延迟样本（**不是**真机达标率）

采样方式：`probe.sample(action, () => ui.<action>())`，围绕 `FeedbackBus.emitA` 的整条同步路径（乐观叠加 + 事件派发），默认暂停、0 次 tick。

| 指标 | 值（毫秒） |
| --- | --- |
| n | 240（V3 / V5 / 选中 / 切 Tab × 60 轮） |
| min | 0.002 |
| p50 | 0.008 |
| p95 | 0.088 |
| max | 1.343 |

> **免责（逐字引用 `feedback-timing.ts` 的 `DISPATCH_LATENCY_DISCLAIMER`）**：
> 进程内 UI 分发延迟样本：不含触摸采样、布局、绘制、合成与真机系统层；不构成「<100ms 达标率」。真机未测。
>
> 说明：两次运行的 p50 在 0.004–0.008ms、p95 在 0.029–0.088ms、max 在 0.71–1.34ms 之间波动（Node 单进程、含 GC 抖动）。
> 该量级只说明「本地同步派发不是瓶颈」，**不能**推出真机可见延迟；`max` 已明显高于 p95，说明偶发调度抖动真实存在。

---

## 4. 静态结构检查摘要（`ui-static-scan.test.ts`）

| 用例 | 断言 | 结果 |
| --- | --- | --- |
| SCAN-1 | 无 `from 'cc'` 等引擎导入 | 0 命中 |
| SCAN-2 | 无 `Math.random` / `Date.now` / `new Date(` / `setTimeout` / `setInterval` | 0 命中 |
| SCAN-3 | `performance.now` 仅命中 `feedback-timing.ts` | 0 越界 |
| SCAN-4 | 无 `tick-pipeline` / `runTick(` （**剥注释后扫描**，含正向对照） | 0 命中 |
| SCAN-5 | 无 `state.x =` / `cells.*[...] =` / `budget.x =` / `.tickId =`（含正向对照） | 0 命中 |
| SCAN-6 | 无 `#rrggbb`（含正向对照） | 0 命中 |
| SCAN-7 | `emitB(` 仅出现在 `feedback-bus.ts` / `interaction-controller.ts`；A 侧三文件不含 `simulation/` 与 `session` | 0 越界 |
| SCAN-8 | 所有 import 为带 `.ts` 的相对路径；无 `require` / `process.env` | 0 越界 |
| SCAN-9 | `EventDetail` 无 `tickId` 字段、`BEventDetail` 必须有 | 结构成立 |
| SCAN-10 | `src/ui/` 文件清单固定为 6 个 | 一致 |

> 扫描纪律：先剥离注释再匹配（本层注释里含「不得调用 `runTick` / 不得用 `Date.now`」这类自我约束，若不剥注释会自命中）；每条都带**正向对照**，防止正则写歪后变成永真断言。

---

## 5. 与并行改造的接口面（令牌依赖声明）

本层**只**使用 `src/render/semantic-tokens.ts` 的公开查询函数：`tokenById(map, id)`、`buildSemanticTokenMap(zoneTypes)` 与 `SemanticTokenMap` 类型。**不写 hex、不写形状字面值、不复制色板**。

依赖的令牌 id（缺失即走兜底）：

| 用途 | 首选令牌 | 兜底 |
| --- | --- | --- |
| 落位 / 合法预览 | `status.positive` | `base.ink` |
| 拆除 / 未知预检 | `status.warning` | `base.ink` |
| **回滚 / 非法预览（负向形状）** | `status.negative` | `base.ink` |
| 按压 / 选中 / Tab / 面板 / 扣减预览 | `status.selected` | `base.ink` |
| 中性（拆除填充 / 未知令牌） | `base.tile` | — |
| tick 后数值反馈 | `base.ink` | `base.tile` |

**并行改造适配记录**：初版实现引用 `base.primary` 作为按压 / 面板主色；渲染层本轮令牌唯一化把主色收进 `status.selected` 单一出口并删除 `base.primary` 后，本层已改为 `status.selected` + `base.ink` 兜底，并通过 `encodingOf(tokens, id, fallback)` 统一处理缺失。若后续令牌再调整，只需保证上述 id 之一存在或给出等价出口；**用例不会因形状取值变化而失败**。

---

## 6. 未触碰的禁区文件（供复核核对无越界）

**本批只新增以下 13 个文件**（`src/ui/` 6 + `tests/unit/` 5 + `tests/verification/` 2，其中 1 份为本记录）：

```
src/ui/feedback-bus.ts
src/ui/optimistic-view.ts
src/ui/interaction-controller.ts
src/ui/motion-policy.ts
src/ui/feedback-timing.ts
src/ui/index.ts
tests/unit/ui-feedback-bus.test.ts
tests/unit/ui-optimistic-view.test.ts
tests/unit/ui-interaction.test.ts
tests/unit/ui-motion.test.ts
tests/unit/ui-static-scan.test.ts
tests/verification/ui-s07-timing.test.ts
tests/verification/ui-s07-verification.md   ← 本文件
```

**未修改、未创建、未删除**：

| 类别 | 路径 | 状态 |
| --- | --- | --- |
| 根导出 | `src/index.ts` | **未改**（`src/ui` 自带 `index.ts`，不并入根导出） |
| 说明 | `src/README.md` | 未改 |
| 渲染层（并行改造中） | `src/render/**`（含 `semantic-tokens.ts` / `view-model.ts` / `atlas.ts` / `cocos/**` 等） | 只读引用，**未改** |
| 纯逻辑层 | `src/core/**`、`src/simulation/**` | 只读引用，**未改** |
| 预览页 | `preview/**` | 未改 |
| 设计与文档 | `design/**`、`docs/**`、`production/**` | 未改 |
| 既有测试 | `tests/unit/*`（非 `ui-*`）、`tests/verification/*`（非 `ui-s07-*`）、`tests/test-cases/**`、`tests/*.md` | 未改 |
| 工程文件 | 无 `package.json` / `tsconfig.json` / `node_modules` | 未创建 |
| 版本控制 | 未 `git init` / 未提交（目录本身非 git 仓库） | 未执行 |

---

## 7. 复核建议（给 quality-lead）

1. **复跑命令**（两条，均应在仓库根执行）：
   - `node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts` → 期望 `# pass 198 / # fail 0`
   - `npx --yes -p typescript@5.9.3 tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions src/ui/index.ts` → 期望无输出
2. **重点复核**（若只抽三条）：`UI-7`（真实 P4 阶段内锁闸门与视觉响应的分离）、`UI-4`（回滚不残留 + 负向形状来自令牌）、`SCAN-5`（零写状态扫描含正向对照）。
3. **口径复核**：请确认本记录的 §2.2 与 §3 免责声明是否足以支撑「<100ms 未达标、仅结构就绪」的对外表述——本层**不应**被记为「<100ms 已达标」。
4. **接口面复核**：渲染层令牌若再变更，只需核对 §5 表格中的 6 个 id 是否仍存在（或提供等价出口）；用例本身不含形状字面值，不需随之改动。
