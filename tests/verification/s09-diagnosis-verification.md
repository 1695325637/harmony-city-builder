# S-09 第一批 A 线 · 诊断数据层验证记录（T-134）

> 模块：`src/ui/diagnosis/**`（新增 3 文件：`types.ts` 278 行 / `diagnosis-query.ts` 468 行 / `index.ts` 43 行）
> 测试：`tests/unit/diagnosis-*.test.ts`（新增 3 文件，41 用例：DQ 24 / DC 8 / DX 9）
> 集成改动：`tests/unit/ui-static-scan.test.ts`（SCAN-10 文件清单 +3 行，**唯一一处本批之外的既有文件改动**）
> 全量：`node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts` → **330 / 330 pass / 0 fail**
> 类型：`npx --yes -p typescript@5.9.3 tsc --noEmit --strict --target ES2022 --module nodenext --moduleResolution nodenext --allowImportingTsExtensions --skipLibCheck`（README src-only 列表 + 诊断 3 文件）→ **EXIT=0，零输出**
> 本批范围：仅 A 线诊断数据层（只读查询 VM）。L2 面板 UI 与两级反馈可观测属第二批；B 线真实 flowState 接线由 engineering-lead 并行。

---

## 1. 权威口径对照

| 来源 | 要求 | 落点 |
| --- | --- | --- |
| epic-breakdown §262 ① / **AC2** | 任一显著 ΔS 可追溯 ≥1 条具体原因；查询只读、不重算、不卡顿 | `queryDiagnosis`；DQ-1 / DQ-2 / DQ-21 / DQ-24；DX-2 |
| epic-breakdown §262 ③ | 跨 2~3 周期滞后后果可查完整归因链（依赖 S-05 冷归档） | `queryCycleRange`；DC-1 ~ DC-8 |
| epic-breakdown §262 ④ / P4 | 单屏 ≤1 数据面板 / 分层披露，不以密集数值表格作主交互面 | `activeLayer` 单值 + L0/L1/L2；DQ-5 / DQ-6 / DQ-7 |
| ux-spec §4.3 | 固定四段：主因因子 → 贡献量 ΔS_i[分/tick] → 明细 → 建议动词 | `FourSegmentCard`；DQ-1 / DQ-12 |
| ux-spec §4.3 / §2.2 | L1 与 L2 互斥（一次一个）；只读不写回 | `setLayer` 单值切换；DQ-5 / DQ-6 |
| ux-spec §4.3 | `cause_ref` 为空只允许 TUTORIAL 卡并明确标注，禁止无来源通用提示 | DQ-8 / DQ-9 / DQ-15 / DX-7 |
| GDD 05 §7 **AC-I1** | 无「来源不明」通用提示 | DQ-8 / DQ-9 |
| GDD 05 §7 **AC-I3** | 建议动词一次点按可达（V3/V4/V5） | `ACTION_VERB_BY_CAUSE`；DQ-12 |
| GDD 05 §7 **AC-I7** | 只读汇聚，不修改 `S / f_i / B / Cell` | DQ-20 / DQ-21 / DQ-22 / DQ-24 / DC-5 / DX-1 / DX-2 |
| GDD 05 §7 **AC-I8** | 边缘无编造归因、无空指针崩溃 | DQ-10 / DQ-11 / DC-4 / DC-6 |
| GDD 01 §4.3（T-113 ①） | 耦合项数值披露：显式说明耦合或给出 S 绝对变化数值 | `CouplingDisclosure`；DQ-16 / DQ-17 / DQ-18 / DQ-19 |
| GDD 01 §6.1 E1（T-113 ②） | 首 tick 教学式解释：ΔS=0 / dSByFactor 全 0 / 不生成归因型议题 / ΔS_abs ≠ 0 允许但不触发 V2 诊断 | `TutorialCard`；DQ-13 / DQ-14 / DQ-15 / DC-4 |
| ADR-003 A4 / ADR-004 A2 | 结算时记录、查询时只读、绝不重算；UI 零写权威状态 | DX-1 / DX-2 / DX-5 |
| src/README.md §2.2 | UI 不引用 `flow.*` 令牌 id、不解析 encoding 内部 | DX-6 / DX-4（实现文件零跨层 import） |

---

## 2. 用例清单（41 条，逐条可追溯）

**`tests/unit/diagnosis-query.test.ts`（24 条）**

| ID | 覆盖 |
| --- | --- |
| DQ-1 | AC2：显著 ΔS → ≥1 条具体原因，四段齐备且来源非空 |
| DQ-2 | ΔS_abs 取自 `delta['S']`，方向 / 前后值正确 |
| DQ-3 | 卡片按 \|ΔS_i\| 降序（主因优先，GDD 05 E6），非密集表格且有上限 |
| DQ-4 | 超上限截断并计数，但不丢来源（链完整） |
| DQ-5 | 三层齐备，`activeLayer` 单值可切换（同屏 ≤1 面板，L1/L2 互斥） |
| DQ-6 | 非法层被忽略；`setLayer` 不改动任何只读投影 |
| DQ-7 | VM 无二维数组 / 无 `table` / `matrix` / `columns`（P4 不以密集表格作主交互面） |
| DQ-8 | AC-I1：refId 为空的非教学归因被抑制，不产出兜底文案 |
| DQ-9 | AC-I1：全部无来源且变化显著 → 教学卡（明确标注），`traceable=false`，绝不编造 |
| DQ-10 | 快照缺失 → `found=false`，不编造归因 / 不崩溃 |
| DQ-11 | AC-I8：空 delta / 空 attribution / 非有限数值不崩溃且不进面板 |
| DQ-12 | AC-I3：四类 causeType → V3/V4/V5 且可达；未知类型不编造，原始动词原样透传 |
| DQ-13 | **T-113 ②**：首 tick ΔS_abs ≠ 0 仍不触发 V2 归因型诊断，只给一条教学占位归因 |
| DQ-14 | **T-113 ②**：首 tick ΔS_abs = 0 亦为教学卡；空 cause_ref 明确标注 |
| DQ-15 | 教学卡全局无「系统波动」类兜底文案；教学条目不计入具体原因 |
| DQ-16 | **T-113 ①** 条件 A：\|ΔS_abs − 归因之和\| > 1 分 → 显式耦合披露 |
| DQ-17 | **T-113 ①** 条件 B：\|ΔS_abs\| > 1 而 \|归因之和\| ≤ 1 → 亦须披露 |
| DQ-18 | 差额 ≤1 且无显著变化 → 不披露，但仍无条件给出 S 绝对变化数值 |
| DQ-19 | **ΔS 双口径限制**：不编造字段、不声称二者恒等（`deltaSDecompositionCarried=false`） |
| DQ-20 | AC-I7：查询前后 `store.get(tickId)` 快照逐字节一致（深度冻结亦不抛） |
| DQ-21 | 查询只调用 `get` 一次、不调用 `getCycleRange`（不重算、无 N+1） |
| DQ-22 | VM 与卡片均冻结，无 `put` / `submit` / `advanceDay` / `runTick` 写回入口 |
| DQ-23 | 确定性：同输入重复查询结果逐字节一致（无随机 / 无时钟） |
| DQ-24 | **真实 `createInMemorySnapshotStore()` 端到端**：结构化端口满足 + 查询前后逐字节一致 |

**`tests/unit/diagnosis-cycle-range.test.ts`（8 条）**

| ID | 覆盖 |
| --- | --- |
| DC-1 | 跨 3 周期完整链：9 tick 全在，按 (cycleId, cycleTickIndex, tickId) 有序 |
| DC-2 | D4 滞后后果可回溯：早期命令 + 后期 `lagged` refId 都在完整链上 |
| DC-3 | 链完整计数：`attributionCount` 为截断前真实条目数，`cardsEmitted` 受 L2 上限约束 |
| DC-4 | 教学 tick 与无来源条目不丢 tick，如实计数且 `complete=false` |
| DC-5 | 只读性：`getCycleRange` 前后快照逐字节一致，且不调用 `get` |
| DC-6 | 空范围 / 逆序范围不崩溃且不编造链节 |
| DC-7 | 链上每 tick 都带耦合披露与 ΔS 双口径限制标记 |
| DC-8 | 范围裁剪按 `cycleId` 生效（不跨范围偷数据） |

**`tests/unit/diagnosis-static-scan.test.ts`（9 条，每条带正向对照防永真）**

| ID | 覆盖 |
| --- | --- |
| DX-1 | 零写权威状态（`state.x =` / `cells.*[i] =` / `budget.x =` / `tickId =` …） |
| DX-2 | 不重算模拟（无 `runTick` / `advanceDay` / `tick-pipeline` / `submit` / `put`） |
| DX-3 | 零依赖：源码不 import `node:` / 引擎 / 裸模块 |
| DX-4 | 所有 import 为带 `.ts` 的相对路径；仅 barrel 含 type-only 端口自查（仿 D-14） |
| DX-5 | 确定性纪律：无 `Math.random` / `Date.now` / `performance.now` / 定时器 |
| DX-6 | 零 hex 色值 + 不绑定 `flow.*` 令牌 id |
| DX-7 | 禁止无来源通用提示：代码层不出现兜底文案字面量 |
| DX-8 | ΔS 双口径限制在代码层如实披露（不编造字段、不声称恒等） |
| DX-9 | 四段卡片 / 三层披露 / 教学卡 / 耦合披露关键符号齐备（防空转）；恰 3 文件 |

---

## 3. ΔS 双口径限制披露（**回执必读**，本批最重要的诚实声明）

派单口径提醒：`TickSnapshot.delta` 中 `key='S'` 的条目给的是 **ΔS_abs**（S 的绝对变化，
`addDelta('S', prev.S, cur.S)` → `delta = cur.S − prev.S`）；而 GDD 01 §3.2/§4.3 的 **ΔS**
是「归因分解量」`cur.dS = clamp(ΣΔS_i + ΔS_penalty, −100, 100)`，**未随 `TickSnapshot` 显式承载**
（`frames` 类型 `unknown`、`SnapshotKind='DELTA'` 时 `frames=null`；`SerializedFrame.dS` 只在
KEYFRAME 的序列化内部，本层不解析序列化内部，也不越层读模拟状态）。

**因此本层无法计算 GDD 原式 `|ΔS_abs − ΔS|`。** 本批的处理：

1. `CouplingDisclosure.sAbsoluteChange` = `delta['S'].delta`（权威 ΔS_abs，即 HUD 数字），
   `sBefore` / `sAfter` = 该条目的 `old` / `new`。
2. `CouplingDisclosure.attributionSum` = `TickSnapshot.attribution` 中**带来源条目**的 `dS_i` 之和
   （L2 最多展示 4 张卡，截断数由 `overflowCount` 暴露；和按截断前的全部来源条目计算）。
3. `discrepancy = |sAbsoluteChange − attributionSum|`。它混合了 `100·ΔM·ΔP` 二阶交叉项、
   `ΔS_penalty`、`attributionThreshold` 过滤掉的小贡献、以及 `clamp` 钳制，
   **不等于** `ΔS_abs − ΔS`，**不声称二者恒等**。
4. 披露判定为**近似**：`discrepancy > 1`，或 `|ΔS_abs| > 1` 且 `|attributionSum| ≤ 1` 时，
   `message` 显式写出「本次变化含主项与短板同时变化的耦合」。
5. 无论是否触发，都**无条件给出 S 的绝对变化数值**（GDD 01 §4.3 允许的另一种披露方式），
   从根上避免「HUD 数字与归因之和明显对不上」（概念 §9.1 R4 反馈黑箱）。
6. `CouplingDisclosure.deltaSDecompositionCarried` **恒为 `false`**（类型层面钉死），
   `CycleRangeDiagnosis.deltaSDecompositionCarried` 同样恒 `false`；
   `basis` 常量完整记录上述取值来源与限制。VM 上不存在伪造的 `dS` / `cur.dS` 字段。

> 建议主理人登记：**若后续要让耦合披露精确化**，需由模拟层在 `TickSnapshot` 顶层补一个
> 显式的 `dS`（归因分解量）字段（S-05 / B 线），本层届时只需改 `makeCoupling` 的第二个入参，
> 不改动四段卡片与分层结构。本批**不擅自新增该字段**，避免编造数据来源。

---

## 4. 硬约束逐条核对

1. **只读不重算** ✅ 实现只调用 `source.get` / `source.getCycleRange` 各一次；`DX-2` 静态扫描 +
   `DQ-20/21/24`、`DC-5` 运行时证明「查询前后 `store.get(tickId)` 快照逐字节一致」；深度冻结快照后查询不抛。
   源码不 import 结算内核，不出现 `runTick` / `advanceDay` / `submit` / `put`。
2. **禁止无来源通用提示** ✅ `refId` 为空的非教学条目直接抑制并计数（`unsourcedSuppressed`），
   绝不生成卡片；无卡片时只产出 `TUTORIAL` 卡且 `explicitlyMarked=true` / `label='教学'`；
   `DX-7` 扫描代码层无「系统波动」等兜底字面量，`DQ-8/9/15` 扫描 VM 全部字符串。
3. **分层披露** ✅ `L0` 一句话摘要 + 少量标量 / `L1` ≤4 行因子 / `L2` ≤4 张四段卡片；
   `activeLayer` 为**单值枚举**（非集合）→ 结构上保证同屏 ≤1 面板、L1/L2 互斥；
   `DQ-7` 断言无二维数组、无 `table` / `matrix` / `columns`。
4. **两条 T-113 下游约束专属用例** ✅ ① 耦合披露 DQ-16/17/18/19（+DX-8）；
   ② 首 tick 教学 DQ-13/14/15（+DC-4）。
5. **零依赖口径** ✅ Node v22 `--experimental-strip-types` + `node:test`；未建 package.json / tsconfig；
   源码零 `node:` / 引擎 / 第三方 import，全部为带 `.ts` 的相对路径（DX-3 / DX-4）。

---

## 5. 集成改动说明（唯一一处「只写这些」之外）

`tests/unit/ui-static-scan.test.ts` 的 `SCAN-10` 钉死 `src/ui/**` 的**精确文件清单**
（防越界新增 / 防误把预览页或渲染代码搬进来）。新增 `src/ui/diagnosis/**` 后该守卫必然变红；
按 **S-08 同款先例**（当时为 `hud/**` 更新了同一处清单）作最小增量：在期望数组头部加
`diagnosis/diagnosis-query.ts` / `diagnosis/index.ts` / `diagnosis/types.ts` 3 行 + 1 行注释。
**未删除、未改写任何既有期望项**；该文件不在本批 B 线红线清单内。若主理人希望由集成侧统一维护
该清单，可回退这 4 行并自行合并——但那样在只有 A 线的状态下全量会保留 1 个 SCAN-10 红灯。

其余全局扫描核对：`flow-state.test.ts`（FS-9 全 `src/**` / FS-10 `src/render`+`src/ui` 递归）
只查阈值键与 `qOverCap` 比较；`ui-s07-qareview.test.ts` QA-U3 / QA-U4 用**非递归** `readdirSync`，
只覆盖 `src/ui` 顶层 6 个 `.ts`；`render-s06-*`、`determinism` / `placeholders` / `pipeline` /
`d6-no-end` / `edge-cases` 只覆盖 `src/core` + `src/simulation` 或 `src/render`。
新模块对这些扫描均无影响，全量 330/330 已实证。

---

## 6. 遗留项（不在本批范围，供排期）

- **L2 诊断面板 UI 与两级反馈可观测**：第二批（A 线只交付只读数据层）。
  本层已产出 `activeLayer` / 四段卡片 / `actionVerb`（V3/V4/V5），可供 UI 直接接线。
- **`suggested_verb` 与可达动词的口径差**：快照 `AttributionEntry.suggested_verb` 由 P8 回放
  写为 `'V8'`（调，回到 V3/V4/V5）与 `'V1'`（教学）。本层在卡片里**原样透传**该原始值，
  另由 `ACTION_VERB_BY_CAUSE`（ux-spec §3.1 / §4.3）映射出一次点按目标 `actionVerb`。
  二者并存、不互相改写；若主理人希望上游直接产出 V3/V4/V5，需 S-05 / 模拟层调整，本层不改。
- **`ΔS` 精确化**：见 §3 末尾建议。
- **不卡顿的性能证据**：本批为结构性保证（单遍 O(归因条目数) 投影、L2 卡上限、
  不遍历网格、不重算通勤求解）；真机 p95 / <100ms 门未测，随 S-12 / 真机验证排期。
- **`src/ui/diagnosis/index.ts` 未挂到 `src/ui/index.ts`**：后者属 B 线红线文件，本批禁止触碰。
  诊断 barrel 为自查自出口（含编译期端口断言），第二批接线时由集成侧补一行 re-export。
- **Task #31（S-08 批追加项 A/B）与 #33（契约用例对账）** 仍 pending，与本批无关。

---

## 7. 交付文件清单

**新增（本人独占域）**
- `src/ui/diagnosis/types.ts`（278 行）
- `src/ui/diagnosis/diagnosis-query.ts`（468 行）
- `src/ui/diagnosis/index.ts`（43 行）
- `tests/unit/diagnosis-query.test.ts`
- `tests/unit/diagnosis-cycle-range.test.ts`
- `tests/unit/diagnosis-static-scan.test.ts`
- `tests/verification/s09-diagnosis-verification.md`（本文件）

**改动（既有，最小增量）**
- `tests/unit/ui-static-scan.test.ts`：SCAN-10 期望清单 +3 行 +1 注释（见 §5）

**未触碰**：`src/render/**`、`src/ui/hud/**`、`src/ui/index.ts`、`src/index.ts`、
`src/README.md`、`src/simulation/**`、`src/core/**`、`tests/traceability-matrix.md`、
`production/reviews/**`、B 线其余文件。
**git**：未执行任何写操作（无 `add` / `commit` / `checkout`）；仅以 `git status --short` /
`git diff --stat` 只读核对工作树状态。核对时观察到 `production/reviews/w3-retrospective.md`
有一处 18+/8− 的**并行改动**（非本人所写，属主理人 / B 线并发写入，仅如实记录，未参与、未回退）。
