# S-11 · 第二层 QA 独立复核报告（T-145 · W4 第二批门判定）

> 复核人：quality-lead（严守真）· 立场：**fresh eyes 独立验证**，不复用 RC / RS / RT / UL / SL 任何 fixture 与断言。
> 被复核对象：G 线 T-143（回退内核）+ H 线 T-144（单轴判定 / V9 解锁 / 软着陆），均**未提交**（主理人统一提交）。
> 可复跑证据：`tests/verification/s11-qareview.test.ts`（19 条 QAG-1~9 / QAH-1~10）。
> 本轮**同时**完成裁定 1 交办的 4 条守卫升级（`render-s06-qareview.test.ts` × 3 + `s10-qareview.test.ts` × 1）。
> 权威口径：`production/epics/epic-breakdown.md` S-11 验收 1~5；`design/gdd/systems/04-budget-economy.md` §2.1 / §3.3 / §6.1 E7 / AC-E2 / AC-E4；`design/gdd/systems/02-map-zoning.md` §2 / §3.1；`tests/quality-closure.md` v1.2 **EX-03**。

---

## 0. 门判定总表（三层，禁止合并）

| 层 | 结论 |
| --- | --- |
| **① 纯逻辑 / 内存模拟介质侧** | 验收 **1 / 2 / 4 = PASS**；验收 **3 = PARTIAL**（GDD 04 §3.3 ② 抑制新增建设未实现）；验收 **5 = 未判定**（DoD D-2 属 W5 Playtest 人工判定） |
| **② 真机半侧** | **PARTIAL / BLOCKED** —— 杀进程恢复、切后台、沙箱归档介质、`SM-W4-01~05` 真机项均未验证（EX-03 顺延，**准出阻塞项**） |
| **③ 合并规则** | **不得合并为单一 PASS**。对外只能说：「S-11 纯逻辑侧 1/2/4 PASS、3 PARTIAL、5 待 W5；真机半侧 BLOCKED；**准出层仍 BLOCKED**」 |

一句话：**代码层面这批量做得扎实（证据强、口径诚实），但"软着陆完整达成"与"完整体验"两句话都还不能说。**

---

## 1. 复核方法

1. **独立复跑**全量与 `tsc`，不采信回执数字（§2）。
2. **自建 fixture**：32×32（`MAX_GRID_SIDE`）城市 + 真实 `advanceDay` / `runTick`；G 线用 `createInMemorySnapshotStore`，H 线用真 `runTick` 与 S-10 存档服务。
3. **独立探针**（临时脚本，跑完即弃、未入库）：G1~G9 / H1~H8，见 §4 / §5 的原始读数。
4. **注入验证**：对升级后的守卫做「必须变红 → 撤销 → 必须复绿」三态验证（§3.5），并 `md5` 核对产品代码复原。
5. **静态证据**：读源码做文本级断言（无逆运算 / 零时钟 / 零写格 / 跨域隔离 / 版本头冻结），不只看文档自述。
6. **越界核查**：专扫「真机 / 达标 / 断点续玩 / D-2」字样语境（§10）。

---

## 2. 独立复跑记录

| 项 | 命令（口径同前几批） | 结果 |
| --- | --- | --- |
| 全量单测 | `node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts` | **524 / 524 pass，0 fail，EXIT=0**（= 501 通过基线 + 4 条守卫升级后转绿 + 我新增 19 条） |
| 类型检查 | `npx -p typescript@5.9.3 tsc --noEmit --strict … src/index.ts src/ui/index.ts src/save/index.ts` | **EXIT=0** |
| 交付方原始状态 | 我接手时全量 `505 tests / 501 pass / 4 fail` | 与主理人给的一致；4 红**全部**在我自己的文件域（QA-R2 / QA-R3 / QA-R8 / QAS-19），无一条是实现回归 |
| 工作树 | `git status --porcelain` | 仅两线交付 + 我的 4 个测试改动（未提交，按派单不碰 git） |

---

## 3. 任务 A · 4 条守卫升级（逐条说明「没放松」）

### 3.1 QA-R2 —— 前提收紧为「非解锁帧」，断言强度不变 + 新增前提自检

| 项 | 升级前 | 升级后 |
| --- | --- | --- |
| 配置 | `createDefaultConfig()`（`S_unlock=60` + `paintDemo` → S 会越线 → 周期末解锁写格，前提失效） | `createDefaultConfig({ S_unlock: 101 })`（满意度上界 100，**永不达标**） |
| 断言 | `inputVersion` 全数组逐字节不变 + `valueChangedIndices` 为空 + `diff` 为空 | **三条原样保留**，另加两条**前提自检**：每 tick `S < S_unlock` 且 `unlockedRegions` 不变 |
| 强度 | — | **≥ 原强度**。新增的前提自检是"防空转"：若日后有人把 `S_unlock` 改回去，用例会**先在前置断言上红**，而不是悄悄失去意义 |

### 3.2 QA-R3 —— 从「只审 P1」升级为「逐写审 bump」

| 项 | 升级前 | 升级后 |
| --- | --- | --- |
| 写格字段 | `tick-pipeline` 恰 `['zone','density']`（顺序敏感） | 排序后恰 `['density','region','unlocked','zone']`，并**逐字段计数**（同名字段多写一次即红） |
| 全库命中 | 6 条 | 8 条（4 初始化 + 2 P1 + 2 P7 解锁） |
| bump 计数 | 恰 1 处 | 恰 2 处（P1 / P7 各一） |
| bump 位置 | 只校验「全局第一个 bump 晚于 zone/density 且距离 <200」 | **新增逐写检查**：遍历**每一处** `cells.*` 写值，其**后 200 字符内必须出现** `inputVersion[` bump（`checked === 4` 断言写值条数，防漏审） |
| 强度 | — | **明确增强**：升级前的写法在全库出现第二个 bump 后已不成立，且它只能表达"全局只有一个 bump"；逐写检查**严格强于**它。原断言块以注释说明替换关系后移除（不留恒假断言） |

### 3.3 QA-R8 —— 占位契约改为按帧分支断言

| 项 | 升级前（S-06 占位） | 升级后（S-11 语义） |
| --- | --- | --- |
| 解锁帧 | 断言 `cells.unlocked/region` **逐字节不变**（"格解锁留 S-11"） | 断言 `wroteIndices` **非空**；`versionChangedIndices` **=== ** `wroteIndices`（写格集合与 bump 集合完全相同）；`diff` **非空** 且**每个写过的格都出现在 diff 中** |
| 非解锁帧 | 同上（无分支概念） | `cells` 全字段逐字节不变 + `bumped` 为空 + `diff` 为空 |
| 控制组 | `unlockCount >= 3` | `unlockCount >= 3` **且** `nonUnlockCount >= 3`（两个分支都必须真跑到） |
| 附加 | — | 不扩网格（三数组长度 = 1024 不变）；`unlocked=1` 格数**必须增多**、`region=1` 格数**必须减少**（防"写了但写反"） |
| 强度 | — | **增强**：从"一格都不许写"变成"写多少、写哪、bump 对不对齐"三向校验 |

### 3.4 QAS-19 —— 从硬编码行数改为「出口集合受控」

| 项 | 升级前 | 升级后 |
| --- | --- | --- |
| `src/index.ts` | 硬编码 `=== 28`（S-11 补 rollback 出口后变 29 → 误红） | 行数由 README 声明值**动态比对**磁盘（不再硬编码任何数字） |
| 出口面 | `includes("./save/index.ts")` | **`EXPECTED_BARREL_EXPORTS` 全量清单比对**（20 条，含 `./simulation/rollback.ts`）：增 / 删 / 改 / 换序任一出口都必须同步清单 |
| 强度 | — | **增强**：硬编码行数只是"另一个要同步的数字"，且注释/空行变动就会误红；出口清单直接约束**对外契约面** |

### 3.5 注入验证（必须变红 → 撤销 → 复绿，`md5` 核对）

| # | 注入 | 结果 | 撤销后 |
| --- | --- | --- | --- |
| A | `tick-pipeline.ts` `claimNextRegion` 内**删掉** `cells.inputVersion[i]++` | **QA-R3 红**（`P1 与 P7 解锁各一处 bump: 1 !== 2`）、**QA-R8 红**（`tick 2：写格集合与 bump 集合必须完全相同`） | `md5` 回到 `330cea5a…`，530 行，全绿 |
| B | 在 A 基础上于 P1 加一处**诱饵 bump**（把计数凑回 2，`unlocked` 写值仍无 bump） | **QA-R3 红**，报 `写 cells.unlocked 与 bump 距离必须很短` → 证明**新增的逐写规则独立生效**，不是靠计数兜底 | 同上复原 |
| C | `src/index.ts` 删掉 `export * from './simulation/rollback.ts'` | **QAS-19 红**（`src/index.ts 声明 29 实际 28`） | `md5` 回到 `3c1ac942…`，29 行 |
| D | 等行数替换：把 rollback 出口换成 snapshot 出口（行数仍 29，骗过行数检查） | **QAS-19 红**，报 `统一出口集合受控…`，diff 显示 `- './simulation/rollback.ts'` → 证明**清单断言独立生效** | 复原 |
| E | `rollback.ts` 把口径句 `cycleId **前进 2**` 改成 `前进两次` | **RT-8 红**（`rollback.ts 须写明每次回退使其前进 2`） | `md5` 回到 `380ab42f…`，`rollback-static` 8/8 |

> 五段注入全部「红 → 撤销 → 绿」三态齐全，产品代码 `md5` 与撤销前一致。

---

## 4. G 线（T-143 回退内核）六项判定

| # | 验证点 | 判定 | 我的独立证据（探针原始读数） |
| --- | --- | --- | --- |
| 1 | `findCycleStartKeyframe` 规则正确且**缺失显式失败** | **PASS** | G1：K=2 六 tick 归档形态 `1:c0.1:KEYFRAME / 2:c1.0:KEYFRAME / 3:c1.1:DELTA / 4:c2.0 / 5:c2.1 / 6:c3.0`；定位 `c1→tick2 / c2→tick4 / c3→tick6`；高水位 `{tickId:6, cycleId:3}`。G2：`retryCycle(0)` → `CYCLE_START_KEYFRAME_MISSING`，且**头部逐字节不变、归档条数不变** —— 没有退化到「≤目标 tick 的最近 KEYFRAME」静默继续 |
| 2 | 「restore 落点 == 定位帧」这条额外防线**真的存在且有效** | **PASS（附 N-05 观察）** | G3：构造**契约违约**的 store（`entries()` 声称起点 tick 999，`restore()` 却返回 `keyframeTickId=5`）→ 抛 `CYCLE_START_KEYFRAME_MISSING`。**该分支可达、非死代码**。但必须如实说清：在现装 `InMemorySnapshotStore` 下这条校验**恒真**（`findCycleStartKeyframe` 与 `restore` 用同一套 KEYFRAME 判据，且 `start.tickId` 本身就是 KEYFRAME，倒序扫描必然命中它），见 N-05 |
| 3 | `tickId` 单调不复用 + 旧分支归档逐条未改 | **PASS** | G4：`restoredFrom=4 / prevHead=6 / newHead=7 / prevCycle=3 / newCycle=4 / aborted=2`；只新增 1 条（6→7）；**前 6 条 `canonicalize` 逐条相同**；归档内 tickId 无重复；回退后再推进 → `tickId=8`（= 7+1），仍无重复 |
| 4 | **无逆运算路径** | **PASS** | G8 静态（剥注释）：`budget` 标识符 **0**、`-=` **0**、`inverse\|undo\|revert` 命名 **0**、`runTick(` **0**、`cells.*[]=` 写格 **0**、时钟/随机/定时器/`node:` **0**；`store.restore(` **恰 1 处**（唯一恢复入口） |
| 5 | 幂等（同周期连续两次不重复扣费 / 不重复入档） | **PASS** | G5：第一次 `newHeadTickId=5`；**第二次同目标 → 仍 5，归档条数不变**（`replayNoNewEntry`）；成功结算后再回退 → `7 > 5`，说明幂等窗口随 `advanceDay` 关闭。`retryCycle` 本体无结算算术（G8 已证零 budget 运算），故不存在"重复扣费"通道 |
| 6 | E7 守卫 `assertRollbackAllowed` | **PASS** | G6：`S_unlock=0`（周期末必 `TARGET_MET`）→ `UNLOCK_COMMITTED_THIS_FRAME`；`S_unlock=101`（`RETRY_AVAILABLE`）→ 显式目标周期回退**允许**；结算中（在 `onStage('P7')` 内调用）→ `SETTLING` |
| 7 | 裁定 3 口径落实且 **RT-8 真能钉住** | **PASS** | `rollback.ts` L20~28 与 `s11-rollback-verification.md` §4 均写死「分支标签 ≠ 已玩周期数 / 一次回退前进 2 / 不得作 UI 第 N 周期序号或统计口径」；RT-8 对 5 组关键串（含「前进 2」）双文件比对，**注入 E 已证会红**（改一个字即红） |

---

## 5. H 线（T-144 单轴 / 解锁 / 软着陆）六项判定

| # | 验证点 | 判定 | 我的独立证据 |
| --- | --- | --- | --- |
| 1 | **单轴判定**（只随 S 翻面） | **PASS** | H1：取非解锁帧 `S=45`；`S_unlock=45` → 解锁（`unlockedRegions=2`）；`S_unlock=45+1e-9` → 不解锁（=1）。**边界恰在 `S >= S_unlock`**，1e-9 的差就翻面 → 判定只由这一条不等式决定。QAH-2 另证：预算 **B=−11.6（为负）** 时达标帧照样解锁 → 预算不参与判定 |
| 2 | **真正解锁**（不是只加计数） | **PASS** | H2：`unlockedRegions=2`；`unlocked=1` 的格 **324**（= 256+68），18×18 内逐格统计也是 **324**；`region=1`（未解锁标记）剩 **700**（= 1024−324）；`cells.zone.length` 仍 **1024**（不扩网格）；`config.unlockedSide` 仍 **16**；`state.configHash` 与 `config` 一致；`assertConfigCompatible` **不抛**。H3：24 tick 后 `unlockedRegions=9`（= 上限）、**1024 格全开**、再跑 4 tick **不再递增**（不虚增） |
| 3 | **无失败终局** | **PASS** | H4：连续 5 周期重度建设，`B` 打到 **−100**（`B_floor`），事件类型只有 `TickCommitted` / `IssuePlaceholder`，**终局类事件为 0**，`tickId` 推到 10 仍在结算 |
| 4 | **软着陆**（告警而非瞬死） | **PASS** | H5：`B=−100`、`I_t=1`（= `I_min`，收入不归零）、`B >= B_floor`；**每个 `B<0` 的周期末恰 1 条 `IssuePlaceholder{BUDGET_TIGHT}`**（跨两帧得 2 条，符合"每帧 1 条"）；`advanceDay` 仍 `accepted`。H6：`B=−50` 与 `B=−25` 的单周期净变化**恒等（均 +1.00）** → 无复利 / 罚息 |
| 5 | **与 S-10 联验**（独立构造） | **PASS** | H7：解锁后 `save` → `load`：`bytesEqual=true`（落盘口径逐字节）、`canonicalize` 相等、`unlockedRegions=2`、`unlocked=1` 格 324、**`tickId` 不推进**；`SerializedState` 字段集合载入前后相同，**未新增任何解锁字段**（QAH-10 另证 `SaveSlot` 仍六字段、`src/save/types.ts` 无 `unlockedSide/unlockProgress/claimedRegions`） |
| 6 | **版本头零改动** | **PASS** | H8：`config.unlockedSide` / `computeConfigHash(config)` / `state.schemaVersion` / `state.engineVersion` / `state.configHash` 全程不变；`git diff --stat -- src/core/` **输出为空**（未触碰 `types.ts` / `schema.ts` / `config.ts`）；`SCHEMA_VERSION='HC01-SCHEMA-1'` / `ENGINE_VERSION='HC01-CORE-0.1.0'` 字面未动 |

---

## 6. E7 跨路径「回退与解锁同帧」最终判定

**结论：满足 GDD 04 §6.1 E7「先判定 → 再解锁 / 回退 → 最后写快照；两者互斥」。** 理由分三板：

| 板 | 证据 |
| --- | --- |
| **顺序板（H 线）** | `tick-pipeline.ts` P7 内：预算结算 → `cycleId++` / `cycleTickIndex=0` → **判定** → `TARGET_MET ? claimNextRegion : 0` → attribution/delta → `enterStage(P7)`；P8 才 `tickId++` + `TickCommitted` + 提交快照。代码顺序与 §6.1 逐字对应 |
| **互斥板（两侧）** | ① 判定结果是**单一枚举**（`IN_CYCLE` / `TARGET_MET` / `RETRY_AVAILABLE`），`claimNextRegion` 只在 `TARGET_MET` 分支调用，`RETRY_AVAILABLE` 分支零写格（我的 QA-R8 非解锁分支在 6 tick 内逐帧验证）；② G 线 `assertRollbackAllowed` 在 `lastCycleOutcome === 'TARGET_MET'` 时抛 `UNLOCK_COMMITTED_THIS_FRAME`（G6 实测）→ **同帧不可能既解锁又回退** |
| **跨板（我的 G9 探针）** | 达标帧后再走一个非周期末 tick，`lastCycleOutcome` 变 `IN_CYCLE`，回退被允许；但**默认目标周期**取"当前周期"，其起点快照**已包含**该次解锁 → `unlockedRegions` 仍为 2，**没有误伤**（G9：`rewound=false`） |

**必须如实说明的一层**：`assertRollbackAllowed` 的保护是**帧级**的，不是"该周期已解锁就永久禁止回退"。若玩家**显式指定**目标为更早的周期，回退会连同那次解锁一起撤销 —— 这**不是缺陷**，而是 AC-E4 的硬要求（「同一周期回退重跑，结余 / 解锁标志 / 议题状态与首次结算前完全一致」）。两者不矛盾：E7 管"同帧不能既解锁又回退"，AC-E4 管"回退必须让解锁标志回到首次结算前"。

---

## 7. 验收 3 的 PARTIAL 判定 —— **成立，我认可**

**我的独立判断与主理人一致，但把决定性理由换了一条更硬的。**

GDD 04 §3.3 的软着陆是**四条并列处置**：① 生成「预算吃紧」议题 ② **抑制新增建设（`C_b` 需 `B ≥ 0` 或分期）** ③ 收入下限 `I_min` ④ 预算下限 `B_floor`。实现覆盖 ①③④，**②缺失**；且 §6.1 的 E4（一次性大规模建设使 `C_b > B` → 禁止或分期）也指向同一缺口，其落点 `O-2` 在 GDD 里**仍是开放占位**。

- 因此「软着陆完整达成」这句话**不能说** → **PARTIAL 正确**。
- 但**不能判 FAIL 的关键理由**（比交付方给的三条更本质）：**缺的那一条在 GDD 里还没有规格**。`§3.3 ②`「或分期」与 `E4` 的拒绝语义都挂在 `O-2` 上，尚未钉定；此时实现方若自己发明"B<0 就拒绝建设"，那不是补实现，是**发明规则**（且会硬编码进内核，违反"规则集中在配置表"的既有纪律）。交付方给的另两条理由（不能硬编码 / 不能加 Config 字段）我也复核过：加字段会改 `computeConfigHash` → 既有 state 的 `configHash` 全部失配 → `assertConfigCompatible` 抛错（我上一批 QAS-11 已实测该路径），确实必须先有迁移方案。
- **改进建议（不改变判定）**：登记遗留时把责任写全 —— 不只是"设计侧钉定拒绝语义"，还要**架构侧给出 Config 变更的迁移方案**（S-10 的 `SaveMigration` 已验证可用，可作为范式）。触发条件建议写成「O-2 关闭后的一批内」，而不是仅"S-12 前"，否则容易一直挂着。
- **诚实边界的加分项**：`SL-8` 明确断言「B<0 时建设 / 注资仍正常应用、不被静默拒绝」—— 把"没有抑制"写成**可执行断言**而不是一句注释，这比单纯披露强得多，我保留该判断。

---

## 8. 验收 5（DoD D-2 完整体验）—— **未判定**

- 用户已拍板「结构支撑 + 留 W5 判定」。
- 我核查两条线**均未声称 D-2 达成**：`rollback.ts` 头注写「**人工判定未执行**，本模块只提供可测结构支撑」；`unlock` 文档 §0 / §9 都写「**未判 D-2**」。全量扫描无一处正面声称（§10）。
- **门判定里记为「未判定（W5 Playtest）」**，不计入 PASS 也不计入 FAIL。**不得**因为"S-11 做完了"就默认 D-2 过了。

---

## 9. 新缺陷与观察项

**本轮无 Blocker / Critical / Major / Minor 缺陷。** 三条观察项 + 一条文档缺陷：

### N-06（**文档缺陷 · 建议修，级别 N+**）`s11-rollback-verification.md` §2 有三处与最终交付不符

| 位置 | 文档写的 | 实际 | 影响 |
| --- | --- | --- | --- |
| §2 表 | `src/simulation/rollback.ts`（新建，**274 行**） | **279 行**（README 也是 279） | 后人按 274 复核会对不上，进而怀疑 README 或 QAS-19 |
| §2 表 | `rollback-static.test.ts`（**RT-1~7**） | **RT-1~8**（8 条，含 RT-8 口径守卫） | 会漏掉"口径已被守卫钉住"这条重要事实 |
| §2 末 | 「**`src/index.ts` 未改动（保持 28 行）**」+ 说明"故本模块不挂 barrel" | 实际 **29 行且已挂 `export * from './simulation/rollback.ts'`**（README 同步为 29） | 这是 G 线落盘前的**中间态陈述**，与最终交付相反；按它复核会以为"没挂 barrel" |

> 建议：由 G 线（或主理人）按事实改这三处，并加一行「T-145 复核：4 处守卫已由 quality-lead 升级，全量 524/524」。**不要改写 §9 的"3 条失败"**——那是当时的实测快照，属于历史；加注即可。

### N-05（观察项 · 防御强度口径）`restored.keyframeTickId !== start.tickId` 在现装介质下**恒真**

`findCycleStartKeyframe` 与 `SnapshotStore.restore` 用的是同一套 KEYFRAME 判据（`kind==='KEYFRAME' && frames!==null`），而 `start.tickId` 本身就是一个 KEYFRAME，`restore` 倒序扫描必然命中它 → 该分支在现装 `InMemorySnapshotStore` 下**永不触发**（G3 用契约违约的 store 才让它可达）。

- **不是缺陷**（保留了也无害，且未来若 `entries()` 语义漂移可救），但文档措辞应下调：它应写成「对 store 契约的一致性复核」，不宜写成"额外防线"（会让人高估防御强度）。
- 建议：保留代码，改一句注释即可。

### N-07（观察项 · D-15 潜在热点）`src/README.md` 是两条线**共用**文件

G 线改了 `session.ts` 行数 + 新增 `rollback.ts` 行；H 线改了 `tick-pipeline.ts` 行数 + 职责描述。本轮**两处改动都在、无覆盖**（我核过 530 / 179 / 279 / 29 四项均正确），但这是继 D-15 之后又一次"两个 worker 改同一文件"。

- 建议：下一批起把 README 索引的**行所有权**写进派单（谁改 `src/**` 的哪条，就只改对应行），或统一由主理人收口。
- 本轮不阻塞：`QAS-19` 的动态行数比对已把"两线都改错"的后果变成红灯，而不是静默漂移。

### N-04（已在本报告 §6 澄清，不再单列缺陷）E7 保护是帧级

见 §6 末段：帧级保护 + 周期级回退 + AC-E4 要求撤销本周期解锁，三者语义自洽。**建议写进 S-11 交付说明**，避免后续有人"发现"回退能撤销解锁就当成 bug 修掉。

---

## 10. 越界声称核查

扫描面：`src/simulation/rollback.ts` / `session.ts` / `tick-pipeline.ts` / `src/README.md` / 两份 S-11 自验文档。
关键词：`真机验证`、`真机实测`、`断点续玩`、`已达标`、`D-2`。

| 命中 | 语境 | 判定 |
| --- | --- | --- |
| `rollback.ts:34` | 「DoD D-2 … **人工判定未执行**，本模块只提供可测结构支撑」 | 否定 ✅ |
| `rollback-verification.md:5 / :135` | 「**未判定** / **人工实测**」 | 否定 ✅ |
| `unlock-verification.md:11 / :12 / :265 / :281` | EX-03 **PARTIAL / BLOCKED**、「**未判 D-2**」 | 否定 ✅ |
| `tick-pipeline.ts:11 / :457` | 「无硬终局（OD-1 A）」 | 设计约束陈述，非声称 ✅ |
| `README.md:118 / :251` | 介质口径限定 / 阶段清单条目名 | 限定或非声称 ✅ |

**结论：零正面声称。** 反向证据也在：`rollback.ts` 头注有「**不声称该体验已达成**」，`unlock-verification.md` 有「**未做任何真机验证**」。

---

## 11. S-11 门判定（三层，禁止合并）

| 判据 | ① 纯逻辑 / 内存模拟介质 | ② 真机半侧 |
| --- | --- | --- |
| 验收 1（回退到周期起始 Keyframe 并重新决策） | **PASS**（QAG-1/2/4/5/6 + G1/G2/G4/G5） | **BLOCKED** —— 真机归档介质、杀进程后回退未验证 |
| 验收 2（tickId 单调 / Delta 链一致 / 旧分支保留 / 无逆运算） | **PASS**（QAG-4/8 + G4/G8） | **BLOCKED** |
| 验收 3（单轴判定 / 无失败终局 / 软着陆） | **PARTIAL**（核心三项 PASS：QAH-1/4/5/6；§3.3 ② **未实现** → 见 §7） | **PARTIAL** —— `SM-W4-05` 真机项未验证 |
| 验收 4（达标解锁 + 进度写入存档） | **PASS**（QAH-2/3/7/10 + H2/H3/H7） | **BLOCKED** —— 真机持久化半侧（`SM-W2-05`）未验证 |
| 验收 5（DoD D-2 完整体验） | **未判定（W5 Playtest）** | **未判定** |
| **层门** | **PASS with PARTIAL**（1/2/4 PASS、3 PARTIAL、5 未判定） | **PARTIAL / BLOCKED（准出阻塞项）** |

> **可直接引用的合并表述**：
> 「S-11 在**纯逻辑 / 内存模拟介质侧**：验收 1/2/4 **PASS**、验收 3 **PARTIAL**（GDD 04 §3.3 ② 抑制新增建设未实现，需设计侧钉定 `O-2` + Config 迁移方案）、验收 5 **未判定（留 W5 Playtest）**；
> **真机半侧维持 PARTIAL / BLOCKED**，按 EX-03 顺延并**正式登记为准出阻塞项**。
> 三层**不得合并为单一 PASS**；**准出层仍 BLOCKED**。」

---

## 12. 待主理人 / 用户决策

| # | 事项 | 我的建议 |
| --- | --- | --- |
| 1 | N-06 三处文档不符 | **建议本轮就改**（274→279 / RT-1~7→RT-1~8 / 删掉"index.ts 未改动保持 28 行"那段并改写为"T-143 已挂 barrel，29 行"）。不改会让下一轮复核踩坑 |
| 2 | 验收 3 PARTIAL 的遗留登记 | 责任写全（设计侧钉 `O-2` 语义 + 架构侧给 Config 迁移方案），触发条件建议「`O-2` 关闭后的一批内」 |
| 3 | N-05 措辞 | 建议把"额外防线"改为"store 契约一致性复核"（一句注释） |
| 4 | N-07 README 行所有权 | 下一批派单里写清，或改为主理人统一收口 |
| 5 | 我新增的 19 条 `s11-qareview.test.ts` 是否入常驻门禁（505 → 524） | 建议入（沿用 T-142 惯例）；若希望门禁只保留实现方用例，我把扩展名改掉 |
| 6 | 解锁形状「边长阶梯 +2」 | 交付方已标「本批自定假设、待设计侧钉定」，我认可这个处置；建议设计侧在 **S-12 前**明确（否则 S-12 的 UI 会按 18×18 出图，后面改形状成本更高） |

---

## 13. 留痕

- **本轮新增**：`tests/verification/s11-qareview.test.ts`（19 条）、`tests/verification/s11-qareview.md`（本文件）。
- **本轮修改（均属我自己的文件域）**：
  - `tests/verification/render-s06-qareview.test.ts`：文件头 3 条说明 + QA-R2 / QA-R3 / QA-R8 三条用例（升级）
  - `tests/verification/render-s06-qareview.md`：§内容表追加一行 **T-145 增补**（原文保留）
  - `tests/verification/s10-qareview.test.ts`：QAS-19（升级）
- **产品代码改动：零。** 五次注入探针（§3.5）的撤销以 `md5` 双证：
  - `tick-pipeline.ts`：`330cea5a0cabfbc17c0bf7145759d033`（530 行）→ 注入 → 复原后**同值同长度**
  - `src/index.ts`：`3c1ac942fd2251d1bfc5e91d7da0d99e`（29 行）→ 注入 → 复原后**同值**
  - `rollback.ts`：`380ab42f5f9655587cfd9546dc8aa653` → 注入 → 复原后**同值**
- **未提交 git**（按派单：统一由主理人提交）。
- 临时探针脚本（`/tmp/probe_s11.mjs`）只在本机跑过，**未入库、不构成交付物**。
- 复核期间未触碰：`design/**`、`docs/**`、`production/**`、`tests/quality-closure.md`、`tests/traceability-matrix.md`、以及两线的 `src/**`（除上述三次已撤销的注入）。
