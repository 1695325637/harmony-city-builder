# HC-01 · W4 S-11 第一批 H 线 · 周期末单轴判定 + V9 解锁 + 软着陆（验证记录）

| 项 | 内容 |
| --- | --- |
| 工作代号 | HC-01（非产品名） |
| 任务 | **T-144 · W4 S-11 第一批 H 线 · 周期末单轴判定 + V9 解锁 + 软着陆** |
| 日期 | 2026-11-07 |
| 依据 | `production/epics/epic-breakdown.md` S-11 验收 3/4；`design/gdd/systems/04-budget-economy.md` §2.1 / §3.3 / §6.1 E7 / AC-E2 / AC-E6；`design/gdd/systems/02-map-zoning.md` §1.2 / §2 / §3.1；`design/gdd/systems/01-satisfaction-simulation.md` §2 V9 行 / AC-F5；`docs/architecture/architecture.md` §4.3；`docs/architecture/adr/ADR-002-simulation-loop-and-snapshot.md` §2 子决策 3、§6 R-7、§7 A6；`tests/smoke-checklist.md` SM-W4-05 |
| 授权边界 | **只改** `src/simulation/tick-pipeline.ts`（G 线禁碰）；`src/README.md` 仅同步 tick-pipeline 行数/职责（QAS-19 守卫要求）；新建 `tests/unit/unlock-v9.test.ts` + `tests/unit/soft-landing.test.ts` + 本文档。未碰 `src/core/**` / `src/simulation/session.ts` / `src/save/**` / `src/ui/**` / 任何 `render-*` 测试 / 任何 git 对象 |
| 版本头 | **`config.unlockedSide` / `schemaVersion` / `configHash` / `engineVersion` 全程未改**（用户拍板「禁改版本头」）；`src/core/types.ts` / `src/core/schema.ts` 零改动 |
| 真机口径 | EX-03：纯逻辑侧可判 PASS；真机持久化半侧 **PARTIAL / BLOCKED**，本机无 DevEco / hdc / ohos SDK，**未做任何真机验证** |
| DoD D-2 | 人工体验判定本机不可执行，**未判 D-2**；本线只提供结构支撑 |
| 自验结论 | 新用例 **16/16 pass**；`tsc --noEmit --strict` src-only **EXIT=0**；全量实测与红灯归因见 §9（3 条为既有 `render-*` 占位断言，另 1 条为 G 线并行中间态） |
| 门判定预期 | S-11 验收 3 **核心 PASS**（单轴 / 无失败终局 / 软着陆告警）；GDD 04 §3.3 ②「抑制新增建设 / 分期」未实现 → 软着陆整体 **PARTIAL**（裁定 4：不判 FAIL，登记遗留，责任侧设计 + 架构，最迟 S-12 前） |
| 裁定状态 | 主理人 2026-11-07 五项裁定已落地：① 3 红补丁**不授权本线**，由 quality-lead 统一升级（本线未碰 `render-*` / `s10-qareview`）；② 解锁形状接受但须标注「待设计侧钉定」（§2.2 / §2.5）；③ 软着陆 `IssuePlaceholder` 方案接受；④ §3.3 ② 判 **PARTIAL** 并登记遗留；⑤ E7 跨路径互斥登记第二批复核 |

---

## 0. 一句话结论

> P7 周期末判定仍是**满意度单轴**（`cur.S >= config.S_unlock`）且无失败终局；`TARGET_MET` 帧**真正**把下一圈 `cells.unlocked` 置 1、`cells.region` 归 0 并 bump `inputVersion`、`unlockedRegions++`（不扩网格、不改 `config.unlockedSide`）；`B < 0` 发 `IssuePlaceholder` / `BUDGET_TIGHT` 可观测告警（软着陆），不判负、不删档、不拆格。解锁进度随 `SaveSlot.current`（`SerializedState`）天然往返，已用 S-10 存档服务做逐字节联验。

**唯一未闭环项**：`tests/verification/render-s06-qareview.test.ts` 的 QA-R2 / QA-R3 / QA-R8 三条 S-06 阶段断言以「P7 不解锁写格」为前提，S-11 落地后其前提被取代 → 全量 3 红。该文件属本批 `render-*` 红线，**本线未改**，已附精确补丁建议等主理人裁定（§8）。

> **并行观察（非本线问题）**：复跑时 `QAS-19`（README 行数守卫）可能短暂报「`src/simulation/rollback.ts` 声明 274 实际 279」——G 线正在写该文件，属并行中间态；本线 `tick-pipeline.ts` 的 529 已同步 README。G 线落盘并同步其后会转绿。

---

## 1. 交付文件清单与改动面

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `src/simulation/tick-pipeline.ts` | 修改（529 行） | P7 单轴判定 + `claimNextRegion` 真正解锁 + 软着陆告警；新增导出 `UNLOCK_STEP_SIDE` / `MAX_UNLOCK_REGIONS` |
| `src/README.md` | 修改（仅 1 行） | `tick-pipeline.ts` 声明行数 454 → 529 + 补 S-11 职责描述（QAS-19 守卫要求行数同步；G 线 `session.ts` 行数由 G 线自行同步，非本线） |
| `tests/unit/unlock-v9.test.ts` | 新建 | UL-1 ~ UL-8 共 8 条 |
| `tests/unit/soft-landing.test.ts` | 新建 | SL-1 ~ SL-8 共 8 条 |
| `tests/verification/s11-unlock-verification.md` | 新建 | 本文档 |

未新建 / 未修改：`src/core/**`、`src/simulation/session.ts`、`src/simulation/rollback.ts`、`src/save/**`、`src/ui/**`、任何 `render-*` / `ui-*` / `hud-*` / `diagnosis-*` / `edge-cells*` / `save-*` / `idempotency-*` 测试。

---

## 2. 解锁形状与粒度假设（**须披露，留设计侧钉定**）

### 2.1 为什么必须自己定义形状

GDD 02 §2 只说「解锁下一块新区（新增可用地块，不扩大网格总边界）」，§3.1 只说「16×16 起步、按里程碑解锁至 32×32」，**没有给出每次解锁的具体形状**（`design/gdd/systems/02-map-zoning.md` §8.1 O-2 仍为开放项）。磁盘现状：

- `cells.region` 只有 **0（起始区）/ 1（未解锁区）二值**，由 `src/core/schema.ts` 初始化钉死；
- `CityState` **没有** `unlockedSide` 字段（只有 `config.unlockedSide`，且它是 `configHash` 的一部分，**禁改**）；
- 因此无法"读当前解锁边长"，必须从 `unlockedRegions` 推导。

### 2.2 本批实现的假设（已按可判定方式钉死）

> **本形状为本批自定假设，GDD 02 未定义解锁形状；待设计侧确认（+2 是否合里程碑节奏 / 封顶是否需提示 / region 是否需多值）。后续读者不得把本节当作 GDD 已定规格。**
>
> **解锁粒度 = 正方形边长阶梯 +2**：16×16 → 18×18 → 20×20 → … → 32×32。

- 第 `r` 个里程碑的边长：`unlockedSideFor(r) = clamp(16 + 2 × (r − 1), side)`；
- 起始 `unlockedRegions = 1`（16×16），每次达标 `+1`，**封顶 9**（`MAX_UNLOCK_REGIONS = 1 + (32−16)/2`）；
- 每次解锁新增面积：18²−16² = **68** → 20²−18² = 76 → … → 32²−30² = 124，累计 768 格（= 1024 − 256）；
- 写入：`cells.unlocked[i] = 1`、`cells.region[i] = 0`、`cells.inputVersion[i]++`；
- **不扩网格**：`cells.*` 数组长度恒为 `side × side`；**不改 `config.unlockedSide`**。

### 2.3 为什么不用「region 多值」

`region` 当前被 `src/render/view-model.ts` 透传给渲染层（`vm.cells.region`），若引入 2/3/4… 多值会改变既有消费方语义，且没有 GDD 依据。边长阶梯只写既有 0/1 取值，语义最小侵入。

### 2.4 为何解锁必须 bump `inputVersion`

`src/render/view-model.ts` 的 `diffViewModel` 以 `inputVersion` 快照（`changeStamp`）作主信号；S-06 QA 已把「同 state 就地改写且不 bump 则不可检出」钉为显式契约（`tests/verification/render-s06-qareview.md` §内容）。**若解锁只写 `unlocked`/`region` 而不 bump，渲染层永远看不到新地块**。本实现在写格同块 bump，`UL-1` / `UL-5` 均有断言。

### 2.5 待设计侧确认的点

1. 每次解锁 68/76/… 格的粒度是否符合 GDD 02 的"里程碑"节奏（还是应改为 +4 边长 / 按象限 / 按 region 编号）？
2. 封顶 9 个里程碑后是否还需要"已达上限"的显式提示（本批静默：`unlockedRegions` 不再变化、`claimNextRegion` 返回 0，不新增事件）；
3. `region` 是否需要引入多值以支持"分区经济 / 分区议题"（若需要，须先在 GDD 02 钉定语义，再改 `schema.ts` 与渲染消费方）。

> 上述三点**不在本批扩范围**；本批只保证解锁在结构上真实、可判定、可存档、可渲染检出。

---

## 3. P7 判定单轴与 E7 顺序

### 3.1 单轴

```ts
outcome = cur.S >= config.S_unlock ? 'TARGET_MET' : 'RETRY_AVAILABLE';
```

- 唯一判据是 `cur.S`（P4 产出的满意度，[0,100]）与 `config.S_unlock`；
- 预算 / 人口 / 环境 / 命令数**不参与**判定（`UL-3` 用注入 aggregator 固定 S=60/59，构造两种预算与建设状态，证明 outcome 只随 S 翻面）；
- `RETRY_AVAILABLE` 只是「可回退重试」标记：不删档、不锁城、无硬终局（`UL-2` 断言未达标后 `tickId` 仍可 +1、`cells` 逐字节不变、无终局类事件）。

### 3.2 E7 顺序固定

```
P7: 预算结算 → cycleId++ / cycleTickIndex 复位 → [判定] → [TARGET_MET ? 解锁 : 不解锁]
    → addAttribution / addDelta → enterStage(P7)
P8: tickId++ → TickCommitted → 提交快照
```

- **先判定 → 再解锁 → 最后提交**，与 GDD 04 §6.1 E7 一致；
- P7 侧**不触发任何回退**：回退由 G 线回退内核在独立路径执行；同一 tick 的 `cycleOutcome` 是单一枚举值，`TARGET_MET` 与 `RETRY_AVAILABLE` **不可能同时成立**（`UL-5` 交替序列断言）；
- 回退与解锁的跨路径互斥由 G 线在 `rollback.ts` 侧守卫（本线只保证"解锁不会在 RETRY 帧发生"）。

---

## 4. 软着陆可观测信号设计

### 4.1 信号

| 层 | 信号 | 判据 |
| --- | --- | --- |
| 事件 | `SimEvent`：`type = 'IssuePlaceholder'`、`stage = 'P7'`、`reason = 'BUDGET_TIGHT'` | `SL-1` 断言恰 1 条；`SL-4` 断言"B<0 的周期有、B≥0 的周期无" |
| 阶段 | `StageTrace.P7.note` 追加 `'; soft-landing B=<值>'` | `SL-1` 断言 `/soft-landing B=-49/` |
| 数值 | `state.budget.B` 如实保留负值（受 `B_floor` 钳制） | `SL-2` / `SL-3` |
| 收入 | `state.budget.I_t >= config.I_min` | `SL-2` |

### 4.2 为什么用 `IssuePlaceholder` 而不新增事件类型

`SimEventType` 是 `src/core/types.ts` 的联合类型，**本批独占文件不含 `types.ts`**（且改它需评估既有 5 类事件的消费方）。GDD 04 §3.3 ① 的软着陆第一动作正是「生成『预算吃紧』议题交 05」，`IssuePlaceholder` 语义贴合、且此前未被使用。既有断言不受影响：

- `determinism` / `input-gate` / `idempotency-contract` 只过滤 `TickCommitted` / `BudgetRejected`；
- `edge-cases` V-02 只断言事件**类型名**不匹配 `/WARN|LIMIT|DROP|TRUNC/i`，`IssuePlaceholder` 不命中；
- `d6-no-end` 的静态扫描只查终局类字面。

### 4.3 不判负 / 不复利

- `B` 演化：`B = clamp(B + I_t − C_b − C_m, B_floor, B_cap)`，**线性、无乘性项**；`SL-5` 用 `B=−50` 与 `B=−25` 的单周期净变化恒等证明无复利 / 罚息；
- 收入下限 `I_min`（`Math.max(pop×i_unit×m, I_min)`）与预算下限 `B_floor`（`clamp`）**既有实现，未回退**；
- `SL-6` 静态断言 `tick-pipeline.ts` 无 `GAME_OVER|GameOver|gameOver|defeat`、无 `强制清空|removeAllCells|wipeCells|resetCityState`。

---

## 5. 未实现项（裁定 4：S-11 验收 3 判 PARTIAL，不判 FAIL）

**对象：GDD 04 §3.3 ②「抑制新增建设 / 分期」——本批不实现。**

**主理人裁定 4（2026-11-07）**：S-11 验收 3 的**字面判据**（单轴 + 无失败终局 + 软着陆告警）已达成、**核心 PASS**；但 §3.3 ② 是软着陆的组成部分，未实现即**不能声称「软着陆完整达成」**，门判定标 **PARTIAL**（不判 FAIL，因需设计侧钉定 + Config 迁移方案，属跨 Story 改动）。已登记遗留：需设计侧钉定「抑制建设的判定与拒绝语义」+ Config 迁移方案（`configHash` 变更须走显式迁移器，参考 S-10 `SaveMigration`），责任侧设计 + 架构，最迟 S-12 前。

| 理由 | 说明 |
| --- | --- |
| 属玩法规则，非架构占位 | 「`C_b` 需 `B ≥ 0` 或分期」的拒绝语义、分期方案、提示文案均由 GDD 04 定义，当前 GDD 未钉定具体形式 |
| 不能硬编码 | 若直接写 `if (B < 0) reject`，等于把平衡期规则硬编码进内核，违反 `placeholders.test.ts` 的「数值/规则集中在配置表」纪律 |
| 不能加 Config 字段 | 新增字段会让 `computeConfigHash(config)` 变化 → 所有既有 state 的 `configHash` 失配 → 全量 `createSimulation` 抛 `ConfigMismatchError`（破 D-01 版本头冻结） |
| 本批已覆盖软着陆核心 | 验收 3 的要求是「告警而非瞬死」，已由 §4 满足；AC-E2 的「可通过合法操作回正」已由 `SL-4` 证明 |

**已如实记录的边界**：`SL-8` 断言「B<0 时建设 / 注资命令仍正常应用、不被静默拒绝」——即当前**没有**抑制。若设计侧后续钉定 ② 的语义，须有独立批次（含 Config 版本迁移方案），**不得**在本线顺手加。

---

## 6. 与 S-10 联验结果

`UL-7` 用 `src/save/**` 的 `createInMemorySaveStorage` + `createSaveService`（**只调用、不修改**）：

| 断言 | 结果 |
| --- | --- |
| `save({ state: 解锁后 state })` | `ok = true` |
| `load(config)` | `ok = true`，`state` 非空 |
| `cells.unlocked` 逐字节一致 | PASS（324 格 = 256 + 68） |
| `cells.region` 逐字节一致 | PASS |
| `unlockedRegions` 一致 | PASS（2） |
| `side` 一致 / `tickId` 不推进 | PASS |
| 整状态 `canonicalize` 逐字节一致 | PASS |
| 载入后再结算 | `tickId + 1`，正常 |

**结论**：解锁进度天然随 `SaveSlot.current`（`SerializedState` 含 `cells.unlocked` / `cells.region` / `unlockedRegions`）往返，**无需新增存档字段、无需改存档层**。介质口径仍是 T-140 的**内存模拟**，真机持久化未验证（EX-03）。

---

## 7. 用例清单

### 7.1 `tests/unit/unlock-v9.test.ts`（8 条）

| ID | 覆盖 | 对应口径 |
| --- | --- | --- |
| `UL-1` | 达标解锁：18×18 环 / 68 格 / region 归 0 / 版本戳 bump / 网格与 config 不变 / P7 note `claim+68 cells` | S-11 验收 4；GDD 02 §2/§3.1；SM-W4-05 |
| `UL-2` | 未达标不解锁：`RETRY_AVAILABLE`、`cells` 逐字节不变、无终局事件、仍可继续 | S-11 验收 3；AC-F5；ADR-002 A6 |
| `UL-3` | 单轴：注入 S=60/59，预算为负 + 有建设仍只随 S 翻面 | GDD 04 §2.1；S-11 验收 3 |
| `UL-4` | 封顶：12 tick 后 `unlockedRegions=9`、全 1024 格解锁、封顶后不再递增 | GDD 02 §3.1；SM-W4-05「重复解锁」 |
| `UL-5` | E7 互斥：交替 70/10，TARGET_MET 帧解锁、RETRY 帧零写格、单一 outcome | GDD 04 §6.1 E7；SM-W4-05 |
| `UL-6` | 解锁后 (16,16) 可建设；(20,20) 仍 `BudgetRejected(LOCKED_REGION)` | GDD 02 §2「新增可用地块」 |
| `UL-7` | 与 S-10 联验：save→load 逐字节一致 + 载入后仍可推进 | S-11 验收 4「解锁进度写入存档」；SM-W4-05 |
| `UL-8` | 禁改版本头证据：`config.unlockedSide` / `configHash` / `schemaVersion` / `side` 全程不变 | 用户拍板「禁改版本头」；D-01 |

### 7.2 `tests/unit/soft-landing.test.ts`（8 条）

| ID | 覆盖 | 对应口径 |
| --- | --- | --- |
| `SL-1` | B<0：恰 1 条 `BUDGET_TIGHT`、判定照常、tick 继续、`I_t=I_min`、`B=-49`、note 带 `soft-landing B=-49` | GDD 04 §3.3 ①③；S-11 验收 3 |
| `SL-2` | `B=-1000` → `I_t=I_min>0`、`B=B_floor` | GDD 04 §3.3 ③④ |
| `SL-3` | 100 条建设命令 → `B` 仍钳在 `B_floor`、仍只告警 | GDD 04 §3.3 ④；AC-E2 |
| `SL-4` | 连续 5 周期赤字不终局；B<0 的周期告警、B=0 起不告警；停止支出后回正 `B≥0` | AC-E2 |
| `SL-5` | 无复利 / 罚息：`B=-50` 与 `B=-25` 净变化恒等；源码无 `interest/compound/penaltyRate` | GDD 04 §3.3 ❌ |
| `SL-6` | 静态：无 `GAME_OVER/defeat`、无强制清空分支；P7 只产出两种 outcome | ADR-002 A6；OD-1 A |
| `SL-7` | AC-E6：`RESIDENT_METRIC_KEYS` = 3 项且经济数值仅 `budget`（只读 UI 常量，不改 UI） | AC-E6 |
| `SL-8` | 边界披露：B<0 时建设 / 注资不被静默拒绝（② 抑制建设留后续） | 本批范围诚实披露 |

---

## 8. 既有断言冲突（裁定 1：由 quality-lead 统一升级，本线不执行）

### 8.1 事实

`tests/verification/render-s06-qareview.test.ts`（T-119 / S-06 阶段）有 3 条断言以「P7 周期末不解锁写格」为**前提**：

| ID | 断言 | 冲突点 |
| --- | --- | --- |
| `QA-R2` | 8 连纯 ADVANCE tick，`inputVersion` 全数组逐字节不变、`valueChangedIndices` 为空、`diff` 为空 | 默认 config（`S_unlock=60`）+ `paintDemo` 的 S 达标 → 周期末解锁写格 + bump |
| `QA-R3` | 全 `src/` 写格路径审计：`tick-pipeline.ts` 恰 `['zone','density']`、全库恰 6 条、`inputVersion++` 恰 1 处 | 新增 2 处写格 + 1 处 bump → 4 / 8 / 2 |
| `QA-R8` | `K=2, S_unlock=0` 跑 6 tick、3 次达标，断言 `cells.unlocked`/`region`/`cells` 全字段逐字节不变、`diff` 为空 | 3 次解锁必写格 → 全部翻转 |

- 这 3 条的**注释本身就写明预期**：QA-R8 的断言消息是「当前实现解锁只递增 `unlockedRegions` 计数，不得写 `cells.unlocked`（**若将来实现解锁，必须同步 bump 版本戳**）」；`render-s06-qareview.md` §内容写「格解锁尚未实现（**留 S-11**）」。即它们**预见了本批改动**，前提失效属预期，**不是功能回归**。
- 但该文件属本批 `render-*` 红线，**本线未改任何一行**。当前全量 `504 / 501 pass / 3 fail`，3 红即此三条。

### 8.2 参考补丁建议（已随回执转 quality-lead 定稿，本线不落盘）

**QA-R2**：把前提收紧为「非解锁帧」——最小改动一行：

```ts
const config = createDefaultConfig({ S_unlock: 101 }); // 恒未达标 → P7 绝不解锁，保持原断言强度
```

**QA-R3**：更新计数与分布，并**追加** P7 解锁的 bump 断言（判定强度不降反升）：

```ts
assert.deepEqual(byFile.get('/src/simulation/tick-pipeline.ts'), ['zone', 'density', 'unlocked', 'region']);
assert.equal(hits.length, 8);
assert.equal((pipe.match(/cells\.inputVersion\[[^\]]*\]\+\+/g) ?? []).length, 2,
  'P1 与 P7 解锁各一处 bump，且两处均同块紧随写值');
// 追加：P7 的 unlocked/region 写入后 200 字符内必须出现 inputVersion bump（防忘 bump）
```

**QA-R8**：改写为「解锁帧必须写格且必须 bump；非解锁帧零写格」：

```ts
if (afterTick.unlockedRegions > beforeTick.unlockedRegions) {
  const wrote = valueChangedIndices(beforeTick, afterTick);       // 已含 unlocked 变化
  assert.ok(wrote.length > 0, '解锁帧必须有格变化');
  assert.deepEqual(versionChangedIndices(beforeTick, afterTick), wrote, '写格必须同步 bump');
  assert.notDeepEqual(diffViewModel(beforeVM, buildViewModel(r.state)), [], '解锁必须被 diff 检出');
} else {
  assert.deepEqual(afterTick.cells, beforeTick.cells, '未解锁帧零写格');
  assert.deepEqual(diffViewModel(beforeVM, buildViewModel(r.state)), []);
}
```

> 三条补丁均**保留或增强**原判定强度（不放松），且把「写格必须 bump」这条真正的 S-06 契约钉得更死。
>
> **裁定 1（2026-11-07）**：三条补丁**不授权本线执行**——实现方修改自己的验收判据会破坏 second-layer QA 的独立性（即使方向正确也不开此先例）。方向获主理人认可，已转 quality-lead 定稿落盘；本线**未碰** `render-s06-qareview.test.ts` 与 `s10-qareview.test.ts`。
>
> **裁定 5（2026-11-07）**：G 线 `rollback.ts` 的 `assertRollbackAllowed` 已在 `TARGET_MET` 帧拒绝回退（抛 `UNLOCK_COMMITTED_THIS_FRAME`）；两侧合起来的「回退与解锁同帧」最终判定由 quality-lead 在 S-11 门复核时做，本批本线只保证 P7 内「判定 → 解锁」顺序固定、`RETRY_AVAILABLE` 分支零写格（`UL-5`）。

---

## 9. 硬约束逐条核对

| # | 约束 | 核对 |
| --- | --- | --- |
| 1 | 禁改版本头（`config.unlockedSide` / `schemaVersion` / `configHash` / `engineVersion` / `src/core/schema.ts`） | ✅ `src/core/**` 零改动；`UL-8` 逐 tick 断言四项不变 |
| 2 | 不得改 `rollback.ts` / `session.ts` / `src/save/**` | ✅ 未触碰；S-10 只调用（`UL-7`） |
| 3 | 零依赖：不 import `node:` / 引擎；源码零墙上时钟 | ✅ `tick-pipeline.ts` 未新增任何 import（仅从既有 `../core/types.ts` 增取两个常量）；软着陆告警纯事件、无时钟 |
| 4 | 不得引入「失败终局」 | ✅ `SL-6` 静态 + `UL-2` / `SL-1` 行为断言；`RETRY_AVAILABLE` 仅标记 |
| 5 | 诚实口径：真机未验证；D-2 未判 | ✅ 头部 + §6 介质披露；全文不写「已验证 / 已达标」 |
| 6 | 零回归 | ⚠️ **3 红**：QA-R2 / QA-R3 / QA-R8（既有前提失效，见 §8），其余全绿；`determinism` / `d6-no-end` / `edge-cases` / `save-*` / `s10-qareview`（除并行中间态 QAS-19）/ `idempotency-contract` / `flow-state` **均未变红**。QAS-19 的红是 G 线 `rollback.ts` 行数正在变化的并行中间态，非本线改动 |
| 7 | 单轴判定，不引入其它判据 | ✅ 代码只有一处 `cur.S >= config.S_unlock`；`UL-3` 证伪其它量 |
| 8 | 解锁不扩网格、不改 `config.unlockedSide` | ✅ `UL-1` / `UL-4` / `UL-8` |
| 9 | D-15 写前查存在性、读现状再改 | ✅ 落盘前确认 4 个目标路径 `ABSENT`；已读 `tick-pipeline.ts` / `types.ts` / `schema.ts` / `config.ts` / `save/**` / GDD 02·04 / ADR-002 / `smoke-checklist` / `pipeline.test.ts` / `d6-no-end.test.ts` / `edge-cases.test.ts` / `render-s06-qareview.test.ts` / `s10-qareview.test.ts` |
| 10 | 不碰 git | ✅ 仅 `git status --short` 只读核对 |

---

## 10. 遗留项

1. **`render-s06-qareview.test.ts` QA-R2 / QA-R3 / QA-R8 由 quality-lead 统一升级**（裁定 1；本线不执行、未碰该文件；参考补丁见 §8.2）。
2. **解锁形状 / 粒度待设计侧钉定**（裁定 2：**本形状为本批自定假设，GDD 02 未定义解锁形状**；§2.5 三点：+2 阶梯是否符合里程碑节奏、封顶后是否需提示、`region` 是否需多值）。
3. **GDD 04 §3.3 ②「抑制新增建设 / 分期」未实现 → S-11 验收 3 判 PARTIAL**（裁定 4；需设计侧钉定「抑制建设的判定与拒绝语义」+ Config 迁移方案，责任侧设计 + 架构，最迟 S-12 前）。
4. **回退侧互斥**（裁定 5：G 线 `rollback.ts` 的 `assertRollbackAllowed` 已在 `TARGET_MET` 帧拒绝回退、抛 `UNLOCK_COMMITTED_THIS_FRAME`；本线只证 P7 内「判定 → 解锁」顺序固定与 `RETRY_AVAILABLE` 零写格；跨路径「同帧互斥」最终判定由 quality-lead 在 S-11 门复核）。
5. **真机持久化半侧**（EX-01 / EX-02 / K-4）顺延，准出层 BLOCKED。
6. **DoD D-2 人工体验判定**留 W5，本线不判。
7. `commandTrace` 仍只记前 `POOL=128` 条（既有纪律，与本批无关）。

---

*文档结束 · T-144 / H 线 · 纯逻辑侧自验 16/16、全量 501/504（3 红为既有 render-* 占位断言，待裁定）· 未碰 git，提交由主理人统一执行*
