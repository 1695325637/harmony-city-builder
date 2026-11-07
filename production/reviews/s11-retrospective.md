# W4 · S-11 阶段回顾 · 回退重试 / 周期判定 / V9 解锁

| 项 | 内容 |
| --- | --- |
| 阶段范围 | W4 第二批：G 线 T-143 回退内核 + H 线 T-144 判定/解锁/软着陆（并行）→ T-145 独立复核与 4 条守卫升级 |
| 汇编人 | 主理人（游承峰） |
| 日期 | 2026-11-07 · v1.0 |
| 依据（只读） | `production/epics/epic-breakdown.md` S-11 五条验收、`design/gdd/systems/04-budget-economy.md` §2.1/§3.3/§6.1 E7/AC-E2/AC-E4/AC-E6、`design/gdd/systems/02-map-zoning.md` §2/§3.1、`design/gdd/systems/01-satisfaction-simulation.md` AC-F5、`docs/architecture/architecture.md §4.3`、`ADR-002 A6`、`tests/smoke-checklist.md` SM-W4-04/05、`tests/verification/s11-qareview.md`、三方测试运行记录 |
| **S-11 门判定（三层，禁止合并）** | **纯逻辑 / 内存模拟介质侧**：验收 **1 PASS / 2 PASS / 3 PARTIAL / 4 PASS / 5 未判定（W5 Playtest）**；**真机半侧**：**PARTIAL / BLOCKED**（EX-03 准出阻塞）；**不得合并为单一 PASS，准出层仍 BLOCKED** |

> **可直接引用的合并表述（QA T-145 原话）**：「S-11 纯逻辑侧 1/2/4 PASS、3 PARTIAL（GDD 04 §3.3 ② 未实现，需设计侧钉 `O-2` + Config 迁移方案）、5 留 W5；真机半侧 PARTIAL/BLOCKED；**三层不得合并为单一 PASS，准出层仍 BLOCKED**。」

---

## 0. 一句话结论

> S-11 补上了 OD-1 A「未达标可回退重试」与 OD-4 A「按里程碑解锁新区」这两条支柱的落地：**回退是开新分支而非倒带**（`tickId` 永不复用、旧分支一条不删、无逆运算路径），**解锁从「只加计数」变成真正写 `cells.unlocked`**（且坚定不改 `config.unlockedSide`，避免 configHash 漂移令所有存档失配）。全量 **505 → 524/524**（含 QA 19 条常驻守卫），tsc EXIT=0，无 Blocker/Critical/Major/Minor。**但软着陆四条处置缺 ②「抑制新增建设」→ 验收 3 判 PARTIAL；DoD D-2 人工体验留 W5；真机半侧仍 PARTIAL/BLOCKED。**

---

## 1. 交付物总览

| 线 | 任务 | 主要产物 | 用例 |
| --- | --- | --- | --- |
| **G** | T-143 回退内核（engineering-lead） | `src/simulation/rollback.ts`(283) / `session.ts`(100→179) / `src/index.ts` 28→29 / `README §2` 索引 | 26（RC-1~8 / RS-1~10 / RT-1~8） |
| **H** | T-144 判定/解锁/软着陆（engineering-ui） | `src/simulation/tick-pipeline.ts`(454→530) | 16（UL-1~8 / SL-1~8） |
| **QA** | T-145 复核 + 守卫升级（quality-lead） | `tests/verification/s11-qareview.md` + `s11-qareview.test.ts`(19 条 QAG/QAH)；升级 4 条既有守卫 | 19（常驻） |

**基线演进**：463（S-10 收口）→ 505（+G 26 + H 16）→ **524**（+QA 19 常驻守卫）。

---

## 2. S-11 五条验收达成情况

| 验收条件 | 判定 | 关键证据 |
| --- | --- | --- |
| ① 未达标可回退到**周期起始 Keyframe** 并重新决策；**无逆运算路径** | **PASS** | `findCycleStartKeyframe`（`cycleId` 匹配 + `cycleTickIndex===0` + KEYFRAME + frames 非 null，取 tickId 最大者）；**缺失显式 `CYCLE_START_KEYFRAME_MISSING`**，并额外做 store 契约一致性复核，**不退化成 `restore` 的「≤目标 tick 最近 KEYFRAME」语义**（QA 实测 `retryCycle(0)` 抛错且头部与归档条数均不变）；静态扫描 `budget` 标识符 0 / `-=` 0 / `inverse|undo` 0 / 写格 0 / `store.restore(` 恰 1 处 |
| ② 回退后 `tickId` 单调递增、Delta 链一致、**旧分支归档保留** | **PASS** | 回退 = **开新分支**：`tickId = max(归档最大, 头部)+1`、`cycleId = 高水位+1`、`cycleTickIndex = 0`，新分支起点以 KEYFRAME 入档（`put` 对同 tickId 抛错，物理上不可能覆盖）；QA 实测 `restoredFrom=4 / prevHead=6 / newHead=7 / aborted=2`，**前 6 条归档 `canonicalize` 逐条相同**、tickId 无重复、回退后下一 tick=8 |
| ③ 周期判定满意度单轴、**无失败终局**、软着陆 | **PARTIAL** | **单轴 PASS**：QA 边界精确到 1e-9（S=45 解锁、`45+1e-9` 不解锁），且 `B=−11.6` 为负照样按 S 解锁 → 只由 S 决定；**无终局 PASS**：连续 5 周期赤字 B 打到 −100，事件只有 `TickCommitted`/`IssuePlaceholder`，终局类事件 0；**软着陆部分达成**：① 议题（`BUDGET_TIGHT` 每 B<0 帧恰 1 条）③ `I_min` ④ `B_floor` 均实现、无复利（`B=−50` 与 `−25` 单周期净变化都 +1.00），**但 ②「抑制新增建设 / 分期」未实现** → 完整软着陆不能声称达成 |
| ④ 达标后 V9 **解锁下一块地**、进入第二轮；**解锁进度写入存档** | **PASS** | `claimNextRegion` 在 TARGET_MET 帧真正置 `cells.unlocked=1` / `region=0` / bump `inputVersion`；16²→18² 新增 68 格（324=256+68）、`region=1` 剩 700、`cells.zone.length` 仍 1024、**`config.unlockedSide` 仍 16**、`assertConfigCompatible` 不抛；24 tick 后 9 区 / 1024 全开 / 不再递增；解锁后可建设、未解锁格仍 `LOCKED_REGION`；**S-10 联验**：解锁后 save→load 落盘口径逐字节相等、tick 不推进、**SaveSlot 仍六字段（未新增解锁字段）** |
| ⑤ 完整「失败—诊断—修正—见效」体验（DoD D-2） | **未判定（W5 Playtest）** | 用户拍板「结构支撑 + 留 W5」；QA 独立核验两线**均未**声称 D-2 达成（"人工判定未执行"/"未判 D-2"），门里记「未判定」，不因"S-11 做完了"默认过 |

---

## 3. 关键工程决策

1. **回退是「开新分支」而非「倒带」**：`tickId` 单调递增永不复用（`put` 对同 tickId 抛错，物理防覆盖）、`cycleId` 走高水位、新分支起点以 KEYFRAME 入档保证「重复回退 / 后续再回退」都有落点；旧分支一条不删、可整段复盘。**零结算算术** → 天然幂等（重复调用不重复扣费）。
2. **`cycleId` 被定义为「单调分支标签」，不是「已玩周期数」**（主理人裁定 3 + QA 建议）：一次回退让 `cycleId` 前进 2（回退标签 + 回退后重新结算）。已写死在 `rollback.ts` 文件头与 `s11-rollback-verification.md §4`，并加 **RT-8** 断言钉住，明确「不得用作 UI 第 N 周期序号或统计口径，需要已玩周期数请另设独立计数器」。
3. **解锁坚定不改 `config.unlockedSide`**：它是 `computeConfigHash` 的输入，改它会让既有 state 全部 `ConfigMismatchError`。解锁只写 state 内 `cells.unlocked`/`region`（既有 0/1 二值，**不引第三值**，因 `region` 被 `render/view-model.ts` 透传，引第三值会改既有消费方语义且无 GDD 依据）。
4. **写格必 bump `inputVersion`**：`diffViewModel` 以 `changeStamp` 为主信号，只写 `unlocked` 不 bump 则渲染层永远看不到新地块。QA 的 QA-R3 升级版对此做了**逐写检查**（每处 `cells.*=` 写值后 200 字符内必须有 bump），并用「诱饵 bump 凑计数」验证该规则独立生效。
5. **软着陆告警用 `IssuePlaceholder{reason:'BUDGET_TIGHT'}`**，不新增 `SimEventType`（避免动 `types.ts` 版本头风险），语义贴合 GDD 04 §3.3 ①「生成预算吃紧议题」；`B` 如实保留负值 + `B_floor` 钳制 + `I_t >= I_min`。
6. **4 条守卫随 Story 演进升级（而非实现方改判据）**：`render-s06-qareview.test.ts` 文件头原文就写着「QA-R8 P7 周期解锁不写格（当前范围：仅 `unlockedRegions` 计数，**格解锁留 S-11**）」，所以是**占位契约到期**，不是回归。由 quality-lead（原作者 + 本轮 QA）升级，**实现方被明确驳回自行打补丁**（维护 second-layer QA 独立性）。

---

## 4. 守卫升级明细（QA T-145，均未放松）

| 守卫 | 升级内容 | 强度变化 |
| --- | --- | --- |
| **QA-R2** | `createDefaultConfig()` → `{ S_unlock: 101 }`（恒不达标）；标题改「**非解锁帧**纯 ADVANCE 不写任何格」；**新增**每 tick 前提自检（`S < S_unlock` 且 `unlockedRegions` 不变） | 原三断言一字未改，**增强**（若日后有人把 `S_unlock` 改回去，会先在前置断言上红，而非悄悄空转） |
| **QA-R3** | 写格字段改排序比对 `['density','region','unlocked','zone']` + **逐字段计数**；全库 6→8；bump 1→2；把「全局第一个 bump 晚于 zone/density」改为**逐写检查**（每处 `cells.*=` 后 200 字符内必有 bump，且 `checked===4`） | **显著增强**（旧写法只能表达"全局只有一个 bump"，全库出现第二个 bump 后已不成立） |
| **QA-R8** | 占位契约 → **按帧分支**：解锁帧 `wroteIndices` 非空 + `versionChangedIndices === wroteIndices` + diff 非空且每个写过的格都在 diff 里；非解锁帧 `cells` 全字段逐字节不变 + 零 bump + diff 为空；控制组改**双侧**（解锁≥3 且非解锁≥3）；另加不扩网格 + `unlocked=1` 格数须增 / `region=1` 格数须减（防"写了但写反"） | **显著增强** |
| **QAS-19** | `lineCount('src/index.ts') === 28` 硬编码 → **行数走 README 声明值动态比对 + barrel 出口全量清单比对（20 条）** | **增强且更本质**（清单直接约束对外契约面；等行数替换出口的诱饵被独立抓红） |

**QA 五段注入验证「红 → 撤销 → 绿」三态齐全**，产品代码 `md5` 与撤销前同值；其中「删掉 P7 的 `inputVersion++` → QA-R3 与 QA-R8 双双红」「加诱饵 bump 把计数凑回 2 → QA-R3 仍红（逐写规则独立生效）」证明新规则不是靠计数兜底。

---

## 5. 缺陷与观察项

| ID | 级别 | 描述 | 处置 |
| --- | --- | --- | --- |
| 新缺陷 | — | QA T-145 判定：**无 Blocker / Critical / Major / Minor** | — |
| **N-06** | 文档缺陷 | `s11-rollback-verification.md` §2 三处与最终交付不符：`rollback.ts` 写 274 实为 283、`RT-1~7` 实为 RT-1~8、写「`src/index.ts` 未改动（保持 28 行）故不挂 barrel」实为 29 行且已挂 | **主理人本轮已改**（三处订正 + 对「不挂 barrel」加了裁定 2 说明；§9 的「3 条失败」快照保留不改写） |
| **N-05** | 措辞降级 | `restored.keyframeTickId !== start.tickId` 这道「额外防线」在当前 `InMemorySnapshotStore` 下**不可达**（定位判据与 restore 内部 KEYFRAME 判据同源、`start.tickId` 本身即 KEYFRAME） | **主理人本轮已改注释**：明确改称「**store 契约一致性复核**」，作用是防御自定义 store 实现违约，不宣传为「强防线」 |
| **N-07** | 流程热点 | `src/README.md` 是两线**共用**文件，本轮两处改动都在、无覆盖（530/179/283/29 四项已核），但这是 D-15 后又一次「两 worker 改同一文件」 | 已记录：下批派单写明**行所有权**，或统一由主理人收口；`QAS-19` 的动态行数比对会把"两线都改错"变红灯而非静默漂移 |
| **N-04** | 澄清（非缺陷） | `assertRollbackAllowed` 是**帧级**保护，不是「该周期已解锁就永久禁止回退」。显式指定更早周期时，回退会连同那次解锁一起撤销 | **这不是缺陷**，是 AC-E4 的硬要求（回退重跑后解锁标志须与首次结算前一致）。已按 QA 建议写入本回顾与交付说明，防止后续被当 bug 修掉 |

---

## 6. 真机侧现状（EX-03）

- 本批全部为纯逻辑 / 内存模拟介质验证；本机无 DevEco / hdc / ohos SDK / Cocos 导出环境。
- **未验证**：`SM-W4-01~05` 的真机半侧（杀进程恢复、切后台、沙箱 KV、HAP 权限、真机落盘、真机回退与解锁观感）。
- **处置**：`tests/quality-closure.md` **v1.2 EX-03** 顺延至真机就绪、最迟 S-12 前，**正式登记为准出阻塞项**；`K-1~K-5` 真机跑通前不得凭猜测回填。
- **组合根未接线**：回退入口 UI、P8 后归档、`onBackground` 强制存档、初始态归档为 tick 0 均属 **S-12 场景接入**，本批未做、不声称已上屏。
- **口径**：QA 扫 6 个文件「真机验证 / 真机实测 / 断点续玩 / 已达标 / D-2」命中**全部处于否定或限定语境，零正向越界声称**；`rollback.ts` 头注含「不声称该体验已达成」。

---

## 7. 遗留项（不阻塞本批判定）

| 项 | 责任侧 | 触发条件 |
| --- | --- | --- |
| **软着陆 §3.3 ②「抑制新增建设 / 分期」** | 设计侧钉 `O-2` 语义 **+** 架构侧给 Config 迁移方案（可用 S-10 `SaveMigration` 作范式） | **`O-2` 关闭后的一批内**（QA 建议，比"S-12 前"更可执行） |
| **解锁形状「边长阶梯 +2」** | 设计侧 | 已标「本批自定假设、GDD 02 未定义」；建议 **S-12 前**明确（否则 S-12 按 18×18 出图后改形状成本更高） |
| **DoD D-2 人工体验** | 测试（严守真） | W5 Playtest |
| **初始态未入档 → 周期 0 不可回退** | 架构 / 组合根 | S-12（会话开始把初始态归档为 tick 0 KEYFRAME） |
| **`cycleId` 非周期序号** | 后续 Story / UI | 已在代码与文档写死；若 UI 需「第 N 周期」须另设独立计数器 |
| **真机半侧 EX-01/EX-02/K-4** | 架构 / 运维 | 真机就绪，最迟 S-12 前（准出阻塞） |
| **README 行所有权** | 主理人 | 下批派单写明（N-07） |

---

## 8. 质量门历程（三方独立）

| 节点 | 结果 |
| --- | --- |
| G 线 T-143 交付 | 26/26；全量 505 / 501 / 4（3 红为守卫到期 + 1 红 QAS-19 行数） |
| H 线 T-144 交付 | 16/16；同上 4 红 |
| 主理人裁定 1~7 | 独立性（H 线不得改判据）/ barrel 必须挂 / `cycleId` 语义写死 / `seenAdvanceKeys` 不重置 / 周期 0 登记 S-12 / 解锁形状标注待钉定 / 验收 3 判 PARTIAL |
| **T-145 QA 复核** | G 六项 + H 六项全 PASS；4 守卫升级（均未放松）；**524/524 全绿**、tsc EXIT=0；E7 跨路径判「满足」；验收 3 PARTIAL 成立；**三层门判定**；零越界声称 |
| 主理人收口 | 亲自复跑 524/524 + tsc EXIT=0；改 N-06 三处文档、N-05 措辞降级（并同步 README 行数 283）；关闭台账 #48；汇编本回顾；统一提交 |

**纪律**：全程 worker 未碰 git（统一由主理人提交）；所有数字为三方本机真实运行输出；QA 五段注入探针均撤销复绿且产品代码 `md5` 同值；「PASS」为 advisory，最终放行权在用户。

---

## 9. 下一步（待用户拍板）

- **W4 收口**：S-10 + S-11 均已收口，W4 整体可判「纯逻辑侧完成、真机侧顺延」。可汇编 W4 阶段回顾。
- **W5 · 闭环集成**：S-12 贯通 V1~V9 全闭环 + 可访问性 Standard 全项 + 第一次真机性能基线校准 + DoD 全量判定。S-12 是**真机半侧补做**（EX-01/EX-02/K-4）与**组合根接线**的落点。
- 或：先审阅 S-11 交付（含 `s11-qareview.md`、本回顾），再进 W5。
- 或：暂停开发，保留当前收口状态。

---

*文档结束 · W4 S-11 收口 · 纯逻辑侧 1/2/4 PASS、3 PARTIAL、5 未判定 · 真机半侧 PARTIAL·BLOCKED · 524/524 · 准出层仍 BLOCKED（EX-03）*
