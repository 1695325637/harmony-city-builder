# S-09 第二批 D 线 · L2 诊断面板 UI + 两级反馈可观测 + D-16 验证记录（T-138）

> 模块：`src/ui/diagnosis/diagnosis-panel.ts`（新增）+ 第一批 3 文件增补 + `src/ui/index.ts` barrel 挂载
> 测试：`tests/unit/diagnosis-panel-*.test.ts`（新增 3 文件，36 用例）+ `diagnosis-query.test.ts` / `diagnosis-static-scan.test.ts` / `ui-static-scan.test.ts` 增补
> 全量：`node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts` → **零 fail**
> 基线 341（第一批收口 commit `900222b`/`f9e0339`）；C 线 T-137 并行改动会计入，以「无 fail」为准
> 类型：`tsc --noEmit --strict` 对诊断层全部 4 文件 + 5 条编译期断言 → **EXIT=0**；
> README src-only 全列表 + `src/ui/index.ts` → **EXIT=0，零输出**（C 线 T-137 落盘后复跑，详见 §8）

---

## 1. 权威口径对照

| 来源 | 要求 | 落点 |
| --- | --- | --- |
| epic-breakdown §262 ② | 两级反馈分离可观测：即时（S-07 通道 A）vs tick 后（通道 B） | `projectTwoLevelFeedback`；DF-1 ~ DF-17 |
| epic-breakdown §262 ④ / ux-spec §2.2 | 单屏 ≤1 数据面板、分层披露、L1/L2 互斥、不以密集表格作主交互面（P4） | `DiagnosisPanelSlot` 单槽位；DP-2 / DP-6 ~ DP-9 |
| ux-spec §4.3 | 固定四段：主因因子 → 贡献量 ΔS_i[分/tick] → 明细 → 建议动词；只读不写回 | `DiagnosisPanelCard`；DP-1 / DP-3 / DP-10 |
| ux-spec §3.2（C4） | 即时 <100ms、与 tick 无关；tick 后指标/议题/流线/之声；减动效 A 静态、B 瞬时 | `TICK_FREE`/`FRAME_FREE` 判据；DF-2/DF-3/DF-4/DF-5/DF-16 |
| ux-spec §8.1 UX-AC2 | 无倍速/自动播放/倒计时条，「结束本日」唯一推进控件 | 本层无推进入口；DP-10 / DX-2 静态扫描 |
| ux-spec §4.2 / §8.1 UX-AC6 / GDD 05 §7 AC-I3 | 议题 2~4；建议动词一次点按直达 V3/V4/V5 | `DiagnosisPanelAction.reachableInOneTap`；DP-4 / DP-5 |
| GDD 05 §7 AC-I7 / ADR-003 A4 | 只读汇聚，不修改 `S / f_i / B / Cell` | DP-10 / DP-14 / DF-12 / DX-1 / DX-2 |
| ADR-004 §2 子决策 1/2 | 双通道不共享时钟；UI 零写权威状态 | DF-4/DF-5（`clockA=render-frame` ≠ `clockB=tick`）；DF-12 |
| quality-lead T-136 / **D-16** | tutorialOnly 文案标签与事实不符：非首 tick 来源缺失也自称「首 tick 教学」 | `DiagnosisEmptyReason` 三分类；DQ-9/10/13/14/25/26、DP-11/12 |
| src/README.md §2.2 / HUD-SCAN-7/9 | UI 零 `flow.*` 字面、不解析 `OpaqueSwatch.paint` 内部 | DX-6 / SCAN-11；本层只用 `'flow-state'` **协议名**（非令牌 id） |

---

## 2. 新增 / 改动文件清单

**新增（本人独占域）**
- `src/ui/diagnosis/diagnosis-panel.ts`：L2 面板 VM/控制器 + 两级反馈只读投影 + 单槽位适配器
- `tests/unit/diagnosis-panel-view.test.ts`（DP-1 ~ DP-15，15 条）
- `tests/unit/diagnosis-panel-feedback.test.ts`（DF-1 ~ DF-17，17 条）
- `tests/unit/diagnosis-panel-barrel.test.ts`（DB-1 ~ DB-4，4 条）
- `tests/verification/s09-batch2-verification.md`（本文件）

**改动（本人独占域）**
- `src/ui/diagnosis/types.ts`：`DiagnosisEmptyReason`；`TutorialCard.reason`；`DiagnosisSummary.emptyReason`；`DiagnosisViewModel.emptyReason`
- `src/ui/diagnosis/diagnosis-query.ts`：D-16 三份文案 + `classifyEmptyReason` + `emptyHeadlineFor`；headline/教学卡/空 VM 按事实分类
- `src/ui/diagnosis/index.ts`：`export * from './diagnosis-panel.ts'`；新增 4 条编译期端口断言
- `src/ui/index.ts`：**仅新增 1 行** `export * from './diagnosis/index.ts';` + 3 行注释；D-14 断言块逐字未动
- `tests/unit/diagnosis-query.test.ts`：DQ-9/10/13/14 增补 D-16 断言；新增 DQ-25/26
- `tests/unit/diagnosis-static-scan.test.ts`：DX-9 文件数 3→4 + 新增符号清单
- `tests/unit/ui-static-scan.test.ts`：SCAN-10 清单 +1 行（`diagnosis/diagnosis-panel.ts`）

**未触碰**：`src/simulation/**`、`src/render/**`、`src/index.ts`、`src/README.md`、`src/ui/hud/**`、
`production/reviews/**`、`tests/traceability-matrix.md`、C 线全部文件、git（无写操作）。

---

## 3. 两级反馈可观测的设计与判据

**设计**：`projectTwoLevelFeedback(source, motion)` 是对 `FeedbackBus.historyA()/historyB()` 与
`MotionPolicy.immediate('panel-open')/tickFeedback()` 的**纯只读投影**，不 emit、不订阅、不读时钟、
不重算模拟。输出 `TwoLevelFeedbackView`，逐条事件带可断言布尔字段：

| 字段 | 通道 A（即时） | 通道 B（tick 后） |
| --- | --- | --- |
| `tickFree` / `frameFree` | `true` / `false` | `false` / `true` |
| `clock` | `render-frame` | `tick`（两者不等，ADR-004 §2 子决策 1） |
| `classification` | `immediate` | `post-tick` |
| `carriesTickDelta` | 必须 `false`（B 类数据不得塞进 A） | 可为 `true` |
| `role` | `diagnosis-open`（panel-open/L2）或 other-immediate | `diagnosis-refresh`（tick-delta/issue-change/flow-state）或 other-post-tick |

**判据 `TwoLevelSeparationVerdict`**（全部为布尔、可逐条断言，且每条都有反向对照）：
`allChannelATickFree` / `allChannelAFrameBound` / `allChannelBTickBound` / `allChannelBFrameFree` /
`noBTypeInA` / `noATypeInB` / `immediateCarriesNoTickDelta` /
`diagnosisOpenOnlyInImmediate` / `diagnosisRefreshOnlyInPostTick` / `reducedMotionConsistent`
→ 合取为 `separated`；再加 `bothChannelsObserved` / `diagnosisOpenObserved` /
`diagnosisRefreshObserved` → `fullyObservable`（空观测时**不谎报**可观测，DF-13/14）。

**角色按事件类型分类、与通道无关**：这样「B 类事件被误塞进 A 通道」会被
`noBTypeInA` 与 `diagnosisRefreshOnlyInPostTick` 双重抓出（DF-7/DF-11 反向对照），
而不是被当成普通即时事件放过。

**减动效**：`motion.reducedMotion === true` 时要求 A 为静态编码
（`mode !== 'animated'`、`durationMs === 0`、`channels ≥ 2`、`informationLost === false`）、
B 为 `instant`（`durationMs === 0`）；常态要求 A/B 均 `animated`。DF-2/DF-3/DF-16 用真实
`createMotionPolicy` + 渲染层 `buildSemanticTokenMap` 验证，含 D-13 的 `outline` 通道。

**延迟口径诚实**：`TWO_LEVEL_LATENCY_NOTE` 明确 `<100ms` 是 ux-spec §3.2 / ADR-004 的
**语义契约**，本层只验证「A 无 tick 绑定」的结构事实，不测量耗时、真机达标率未测（DF-15）。
`performance.now` 仍只出现在 `feedback-timing.ts`，本层零时钟读取（DX-5 / SCAN-3）。

**接线**：`createDiagnosisPanel({ emitter: bus })` 后 `open()` 派发一条 `panel-open` 到通道 A，
`tickId === TICK_FREE`、无 `delta`、通道 B 派发数为 0（DP-13）；面板开合不增加 `store.get`
调用次数（DP-14）。诊断数据刷新仍只由通道 B 的结算事件驱动，A 通道不读 flowState / 归因（DF-17）。

---

## 4. L1/L2 互斥的实现方式（复用既有单槽位，不另造第二套状态）

`DiagnosisPanelSlot` 是对既有 `HudViewModel.activePanel` / `setPanel` 的**结构化只读端口**
（由 `index.ts` 的 `AssertAssignable<HudViewModel, DiagnosisPanelSlot>` 在编译期钉死）：

- `open()` 只调 `slot.setPanel('L2')`（+ `vm.setLayer('L2')` + 可选通道 A 事件）
- `close()` 只调 `slot.setPanel('none')`；`openL1()` 只调 `slot.setPanel('L1')`
- `isOpen` **恒为派生 getter** `slot.activePanel === 'L2'`，控制器不持有本地 `isOpen` 布尔
- 互斥由 `HudViewModel.setPanel` 的**单值实现**保证（展开新的即收起旧的，同屏 ≤1），
  不是本层再做一次互斥判断

证据：DP-6（外部直接改共享槽位，isOpen 立即跟随）、DP-7（E8 双向互斥）、
DP-8（两个控制器共用同一槽位仍互斥）、DP-9（activeLayer 委托第一批 VM 单值）。
面板视图本身为具名字段的四段卡片列表，无二维数组 / `table` / `matrix` / `columns`（DP-2/DP-15）。

---

## 5. D-16 两种文案与用例

**根因**：第一批 `headline` 在 `tutorialOnly` 时无条件输出「首 tick 教学」。但
DQ-9 场景（`tickId=11`，全部来源被抑制）也进入该分支 → 标签与事实不符。

**关键事实核对**（运行期读取真实状态，非推断）：
- `createInitialState()` → `tickId=0, cycleId=0, cycleTickIndex=0`；
  `tick-pipeline.ts:236` 用 `s.tickId === 0` 作首 tick 判据。
- `教学` 占位归因由 `tick-pipeline.ts:350-352` 在**任意** `cur.dS === 0` 的 tick 产生，
  故「有教学条目」**不能**单独证明首 tick —— 必须以 `tickId` 为准（DQ-25 专门反向验证）。

**三分类**（`DiagnosisEmptyReason`）：

| 分类 | 判据 | headline | 教学卡 text |
| --- | --- | --- | --- |
| `E1_FIRST_TICK` | `tickId===0 && cycleId===0 && cycleTickIndex===0 && unsourcedSuppressed===0` | `首 tick 教学：空城基线，暂无归因型诊断（教学卡）` | `TUTORIAL_TEXT_E1`（空城基线已建立…） |
| `MISSING_SOURCE` | 非首 tick，或首 tick 但丢过来源 | `数据缺失：本 tick 无可追溯来源，未生成归因型诊断（教学卡）` | `TUTORIAL_TEXT_MISSING_SOURCE`（未记录到可追溯的归因来源…） |
| `NO_SNAPSHOT` | `store.get(tickId) === null` | `该 tick 无快照记录`（保持第一批原文） | `TUTORIAL_TEXT_NO_SNAPSHOT` |

`TUTORIAL_TEXT` 保留为 `TUTORIAL_TEXT_E1` 的兼容别名，避免下游断链。

**数据诚实性保持不变（主理人已裁定）**：`traceable` / `unsourcedSuppressed` 如实、
`deltaSDecompositionCarried: false`、`COUPLING_BASIS`、无条件给 S 绝对变化数值、
全局无「系统波动」类兜底文案 —— DQ-9/DQ-25 逐条断言。

**用例**：DQ-25（「非首 tick 无来源」，含「带教学占位条目也不得自称首 tick」这条关键回归）、
DQ-26（「真首 tick」，并把 tickId / cycleId / cycleTickIndex 三个判据逐个取反 + 首 tick 丢来源）、
DQ-9/10/13/14 全面改写为真实分类、DP-11/12（面板层标题与教学卡呈现）。

---

## 6. Barrel 挂载后的重名核查结论

**挂载**：`src/ui/index.ts` 仅新增一行 `export * from './diagnosis/index.ts';`，
D-14 断言块（`AssertAssignable<Simulation, UiSessionPort>`）逐字未动（DB-4 静态断言）。

**核对方法**（三条独立证据，不只靠 grep）：
1. 静态导出名清单比对：非诊断 `src/ui/*.ts` + `src/ui/hud/*.ts` 共 **135** 个导出名，
   诊断 `src/ui/diagnosis/*.ts` 共 **57** 个 → `comm -12` **空集**；
   诊断目录内部 `uniq -d` 亦**空集**（无 intra-barrel 重名）。
2. 运行期符号存在性：`tests/unit/diagnosis-panel-barrel.test.ts` DB-1/DB-3 从
   `src/ui/index.ts` 动态导入，逐一验证 S-07（11 个，含历史上消失过的
   `createInteractionController`）、第一批（8 个）、第二批（12 个）共 31 个符号全部存在。
3. `tsc --noEmit --strict src/ui/index.ts` 无 TS2308（歧义导出）/ TS2344（断言失败）。

**结论：零重名、零静默丢弃。** 第二批新增名均带 `Diagnosis` / `TwoLevel` / `PANEL_` /
`TUTORIAL_TEXT_` 前缀，不与既有名冲突。

---

## 7. 硬约束逐条核对

1. **只读不重算** ✅ 新文件零 `runTick` / `advanceDay` / `submit` / `put`；DX-1/DX-2 全绿；
   DP-10/DP-14/DF-12 运行期证明快照逐字节一致、不 emit、不改派发计数。
2. **单屏 ≤1 面板** ✅ 复用 `HudPanelState` 单值槽位，`isOpen` 纯派生；DP-6/7/8。
3. **两级反馈分离** ✅ `TICK_FREE` / `FRAME_FREE` / 时钟归属 / 角色 / 载荷五重判据；
   反向对照 DF-7~DF-11 逐条验证违规会被抓出；减动效 DF-2/3/16。
4. **D-16 只改文案标签** ✅ 数据诚实性字段全部保持，DQ-9/DQ-25 显式断言；
   `deltaSDecompositionCarried: false`、`COUPLING_BASIS`、无条件 S 绝对值未动。
5. **零依赖** ✅ 源码零 `node:` / 引擎 / 结算内核 import；全部相对 `.ts` 路径（DX-3/DX-4）。
6. **跨层契约** ✅ 零 `'flow.` / `"flow.` 字面（只用 `'flow-state'` 协议名）；
   不解析 `OpaqueSwatch.paint`；HUD-SCAN-7/9、SCAN-11、FS-9/10 全绿。

---

## 8. 全量 / tsc 结论

- **诊断层单跑**：`tests/unit/diagnosis-panel-*.test.ts` → **36 / 36 / 0 fail**；
  连同既有 `tests/unit/diagnosis-*.test.ts` → **75 / 75 / 0 fail**
- **点名守卫单跑**：`ui-static-scan` / `hud-static-scan` / `ui-token-contract` / `flow-state` /
  `ui-s07-timing` / `ui-interaction` → **55 / 55 / 0 fail**
  （SCAN-10/11、HUD-SCAN-7/9、FS-9/10、令牌契约、时序契约全部含在内）
- **全量**：`node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts`
  → **379 / 379 / 0 fail**（基线 341 + 本批 38；C 线 T-137 落盘后再复跑仍 379/379）
- **tsc（我的范围）**：`tsc --noEmit --strict … src/ui/diagnosis/index.ts`
  （递归覆盖 4 文件 + 5 条编译期端口断言）→ **EXIT=0，零输出**
- **tsc（README src-only 全列表 + `src/ui/index.ts`）** → **EXIT=0，零输出**。
  中途曾短暂出现 1 个错误 `src/simulation/traffic.ts(121,5): TS2741 edgeCells is missing`，
  系 C 线 T-137 正在补 `TrafficResult.edgeCells` 字段但返回对象尚未同步的**并行中间态**
  （该文件为本批红线，未触碰、未修改）；C 线落盘该字段后复跑即恢复 EXIT=0。
  全程无 TS2308（歧义导出）/ TS2344（D-14 断言失败）。

---

## 9. 遗留项（不在本批范围）

1. **C 线 T-137 已落盘**：`traffic.ts` 的 `edgeCells` 返回对象已补齐，
   `tsc src/ui/index.ts` 与 README src-only 全列表口径均已恢复 **EXIT=0**；
   无需额外返工，仅需 quality-lead 在 C 线回执后做一次独立复核。
2. **L2 面板实际渲染（Cocos 场景树 / 预览页）**：本批交付的是可排布 VM 与控制器，
   真机像素级布局 / 200% 文本缩放仍待 S-12 / 真机验证排期。
3. **两级反馈真机 <100ms 达标率**：语义契约已可判定，真机测量未做（见 §3 延迟口径）。
4. **议题 2~4 与 `n_issue ≤ 4`（AC-I2）**：真实议题规则属 S-05 / 第二批 C 线，
   本批面板沿用第一批 L2 卡上限 `MAX_DETAIL_CARDS=4` + `overflowCount`，不新增面板。
5. **AC-I5（k 静默 tick 后 CLOSED / 主因变化 CONVERTED）**：议题生命周期属 S-05，
   本批只读投影不涉及状态迁移。
6. **Task #31 / #33** 已 completed；本批无新增 pending 项。
