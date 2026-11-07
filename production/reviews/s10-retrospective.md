# W4 · S-10 阶段回顾 · 本地存档与断点续玩（内存模拟介质）

| 项 | 内容 |
| --- | --- |
| 阶段范围 | W4 第一批：E 线 T-140 存档层 + F 线 T-141 D-03 幂等契约（并行）→ T-142 独立复核与 S-10 门判定 |
| 汇编人 | 主理人（游承峰） |
| 日期 | 2026-11-07 · v1.0 |
| 依据（只读） | `production/epics/epic-breakdown.md` S-10 六条验收、`docs/architecture/architecture.md §5`、`docs/architecture/adr/ADR-003-save-data-and-attribution.md §2/§8`、`tests/smoke-checklist.md` SM-W4-01/02/03、`tests/verification/s10-qareview.md`、`tests/quality-closure.md` v1.2 EX-03、三方测试运行记录 |
| **S-10 门判定（EX-03 双层）** | **纯逻辑 / 内存模拟介质侧 = PASS（advisory）**；**真机半侧 = PARTIAL / BLOCKED，登记为准出阻塞项**。**W4 门不得合并为单一 PASS，准出层仍 BLOCKED。** |

> **可直接引用的合并表述（QA T-142 原话）**：「S-10 第一批在纯逻辑/内存模拟介质侧判 PASS（advisory），真机半侧维持 PARTIAL/BLOCKED 并登记为准出阻塞项；W4 门不得合并为单一 PASS，准出层仍 BLOCKED。」

---

## 0. 一句话结论

> S-10 交付了 ADR-003 契约的完整存档层：`SaveSlot` 五字段头、A/B 双槽交替原子写、`checksum` 严格校验、损坏槽跳过与回退提示、显式迁移器链（无迁移器一律拒绝且保留旧槽）、D-01 联动无静默续算；同时把 **D-03 幂等契约**文档化并用 12 条对照用例钉为显式契约（`runTick` 保持纯函数不二次校验）。**全量 438 → 463/463**（含 QA 25 条常驻复核用例），tsc EXIT=0，无 S1/S2/S3 新缺陷，D-03 关闭。**但本批是内存模拟介质**——杀进程恢复、沙箱 KV 接口、HAP 权限、真机落盘均未验证，按 EX-03 登记为准出阻塞项。

---

## 1. 交付物总览

| 线 | 任务 | 主要产物 | 用例 |
| --- | --- | --- | --- |
| **E** | T-140 存档层（engineering-lead） | `src/save/`：`types.ts`(237) / `storage.ts`(105) / `save-service.ts`(458) / `index.ts`(11)；`src/index.ts` 27→28；`src/README.md §2.3` | 32（SV-1~12 / SL-1~10 / MG-1~10） |
| **F** | T-141 D-03 幂等契约（engineering-ui） | `tests/verification/s10-idempotency-contract.md`(233) + `tests/unit/idempotency-contract.test.ts`(472)，**`src/**` 零改动** | 12（ID-01~12） |
| **QA** | T-142 独立复核（quality-lead） | `tests/verification/s10-qareview.md`(227) + `s10-qareview.test.ts`(736) | 25（QAS-1~25，常驻门禁） |

**基线演进**：394（S-09 收口）→ 406（+F 12）→ 438（+E 32）→ **463**（+QA 25 常驻守卫）。

---

## 2. S-10 六条验收达成情况

| 验收条件 | 纯逻辑侧 | 证据 |
| --- | --- | --- |
| ① 杀进程/切后台重进恢复到最近 tick 完整状态（网格/预算/满意度/议题/**解锁进度**） | **PASS（内存介质）** | SV-2/SV-3、SL-2/SL-3、MG-3；QA 自建非平凡 fixture（tick=4、网格非空、S 已变、issueCount/unlockedRegions 非零）证明不是"默认值自我比较"，逐项 + `canonicalize` 整状态比对；`tickId`/`cycleId`/`cycleTickIndex` 不变、不推进 tick 不补算 |
| ② 写中断/人为损坏自动回退上一完好槽并提示、**不加载半损坏数据** | **PASS（内存介质）** | SL-1（连续写 6 次逐步断言任一时刻至少一完好）、SV-4、SV-11；QA 独立故障注入 **A~H 八个探针**：`corruptSlot(最新)` 回退旧槽且返回状态与旧档**逐字节相同**；`failNextWrite` 目标槽仍为 null（连半损坏都没有）；篡改 `budget.B` 不改 checksum → 直接判损坏；双槽全坏 → `NO_VALID_SLOT` |
| ③ header 五字段 + 版本不匹配显式迁移或拒绝 + **无静默续算** | **PASS（内存介质）** | SV-1/SV-12、MG-1~10；默认 `migrations:[]` → 任何版本不匹配一律 `VERSION_MISMATCH_NO_MIGRATOR` 并保留旧槽；**关键反证**：`configHash` 漂移 + 同时注册迁移器 → 仍 `CONFIG_MISMATCH_REJECTED`（判定顺序 configHash → engineVersion → schemaVersion），证明迁移链绕不开 D-01；MIGRATED 路径 `extraWrites:0`、旧槽字节不变 |
| ④ 无后台保活/精确闹钟/离线任务；存档不含参与模拟计算的墙上时钟 | **PASS（代码层）** | SV-5（不同 `displayTime` → 状态逐字节一致、缺省确定性标签）、SV-8（18 个禁用令牌零命中：`Date.now`/`new Date`/`Math.random`/`performance.now`/`setInterval`/`setTimeout`/`requestAnimationFrame`/倍速/倒计时/后台保活/精确闹钟/离线任务/`node:`·引擎·平台·渲染 import/文件系统与权限 API/网络原语）；**权限声明文件本身不在仓库，属 K-4 真机侧** |
| ⑤ `ISaveStorage` 预留远端/版本向量能力位，**代码库零同步实现**，H3 flag 默认关 | **PASS（结构层）** | SV-9；`SAVE_FEATURE_FLAGS.h3CrossDeviceSync` 冻结 `false`、`remote` 恒 `undefined`、全 `src/**` 零 `implements` / 零 `readRemote(` 实现 / 零 `fetch(` |
| ⑥ **D-03 幂等契约显式化** | **PASS** | 见 §4 |

---

## 3. 关键工程决策

1. **A/B 双槽 + 槽自带单调 `writeSeq`，无持久化 active-slot 指针**：保存时读两槽、取「`writeSeq` 最大且校验通过」者为当前完好槽、写另一槽；进程被杀后新建 `SaveService` 仍可择优恢复（SL-9 三次重进一致）。内存介质以「整串一次赋值」模拟 fsync+rename 原子提交，「半串落盘 + 抛错」模拟写中断；真机侧把临时文件 + fsync + rename 放进 `ISaveStorage` 实现即可，`SaveService` 不碰路径与权限（ADR-003 A8 / ADR-001 平台隔离）。
2. **checksum = `hashString(canonicalize(JSON.parse(JSON.stringify(payload))))`**：先做 JSON 往返归一，使校验和定义在「实际落盘字节」上；payload 覆盖除 checksum 外全部落盘内容。**定位为防误改 / 防写坏的非加密摘要**——ADR-003 §5.3 明确「不是反作弊、不是防篡改承诺、不做强加密」，代码注释（`save-service.ts` L62~66）、类型注释（`types.ts` L11~13，含「不得在文案中暗示防篡改」）、evidence §4.3、README §2.3 警告块**四处一致**。主理人裁定 ④ 认可，QA T-142 独立复核确认；**「G10」按评审门处理、不按算法强度门，不因"没用 SHA-256"判 FAIL**。
3. **显式迁移器链 + 默认零迁移器**：默认 `migrations: []` → 一个版本都不能隐式迁移，任何 `schemaVersion` 不匹配一律拒绝、`state=null`、旧槽逐字节保留；只有显式注册的 `SaveMigration` 才能升级，支持多跳链、防环有上限、谎报目标版本被拒；**迁移结果只在内存内用于本次载入，不写回介质**。`configHash` / `engineVersion` 漂移**没有迁移路径**（D-01 硬拒绝），杜绝「旧档 + 新公式静默续算」。
4. **一次性故障注入开关**：`interruptNextWrite` / `failNextWrite` / `failNextRead` / `corruptOnRead` + `corruptSlot(slot, mutator?)`，**触发后自动复位**避免污染后续用例；`save()` 捕获写异常返回 `WRITE_INTERRUPTED` 不抛穿；`load()` 按 `writeSeq` 降序跳过损坏槽、回退 `FELL_BACK_TO_PREVIOUS_SLOT`（含可展示 message），双槽全坏 `NO_VALID_SLOT`。
5. **D-03 契约显式化而非改行为**：确认「去重唯一权威入口 = `CommandQueue.enqueue`（`seen: Set`）+ `Simulation.submit` + `advanceDay`（`seenAdvanceKeys` + `InputGate`）」，`runTick` 保持纯函数；「直接喂重复键」是**显式契约外用法**，不是 bug，**不得**改造成静默纠错。`src/simulation/**` 零改动。

---

## 4. D-03 关闭（S-10 验收 6）

- **契约文档** `tests/verification/s10-idempotency-contract.md`（233 行）：责任分层、`runTick` 纯函数、P0 的 `commandTrace.push` 是**预分配池容量上限（POOL=128）而非去重**、D-01/D-03 边界、存档恢复后键重建语义四条可判据、ADR-003 A3 迁移器关系。
- **12 条用例**：ID-01 V-05 连点复跑（2/5 次只 +1 tick、`TickCommitted=1`）、ID-02 同 key 不同 payload 去重、**ID-03 反向对照**（直接喂两条同 key → 两条都应用、`commandTrace=['same','same']，作为契约事实钉死）、ID-04 重复 `ADVANCE` ≠ 重复结算、ID-05 唯一入口结构证据、ID-06/07 存档恢复后键重建、ID-08 D-01/D-03 边界、**ID-09/10/11 三层防永真**（正向对照 / 反向哨兵 / 真实函数体注入哨兵）、ID-12 文档一致性守卫。
- **QA T-142 做了两次文件级注入（信息量最大）**：注入 A（哑弹式守门：`Set` 从不写入）→ 行为用例 8 条全绿，**只有 ID-09/ID-11 的结构扫描抓住**；注入 B（真实去重）→ ID-04/ID-07/ID-08 也红。**两层互补，各自能抓对方抓不到的形态**。两次均撤销，`md5` 回到 `67f4365cefaabe4fcb683268d57ff9b8`、454 行、`git status` 干净。
- QA 顺带实测纠正自身预期：`CommandQueue.drain()` 后 `seen` **并不清**（同会话同 key 永不复用，只有 `clear()` 才重建），已按事实修正并补 `clear()` 对照。
- **D-03 → CLOSED**（主理人采纳 QA 建议；`w1-w2-verification.md §7.7` 终态表已更新）。

---

## 5. 缺陷与观察项

| ID | 级别 | 描述 | 终态 |
| --- | --- | --- | --- |
| D-01 | S1 | configHash 变更后旧快照静默续算 | CLOSED（T-116）；**本批在存档层联动复验通过**（写入侧 `assertConfigCompatible`、载入侧经 `deserializeState`，注册迁移器也绕不过） |
| **D-03** | S3 | `runTick` 层幂等契约未文档化 | **CLOSED（2026-11-07 · T-141/T-142）**，见 §4 |
| **N-02** | 观察项（非缺陷） | `src/save/types.ts` / `save-service.ts` 有 `import type { StoredSnapshot } from '../simulation/snapshot.ts'`，按「不得引用 `src/simulation/*`」字面读算引用 | **已澄清并钉入口径**：约束指**不得引用其运行期行为**（`runTick`/`solveTraffic`/`advanceDay`/`createSimulation`/`computeBaselineS`/`aggregate`），**只读类型的类型级依赖不受限**（类型剥离后运行期零加载）。已写入 `src/README.md §2.3` |
| **N-03** | 观察项（**预存文档漂移**，非本批引入） | `src/README.md §2` 的 `tests/unit` 声明 869 / 实测 8633；`tests/verification` 声明 1238 / 实测 2729（不含 QA 新增 736）——在 T-140 动手前已失真 | **已修**：`tests/**` 两行改为**不声明固定行数**（用例随批次增长，避免每批同步），并加「行数声明纪律」：`src/**` 逐文件声明 + 门禁守卫（QAS-19 动态解析 / QA-T8 抽查 6 个 render 模块），`tests/**` 只受真实运行约束。改后 463/463 仍绿、`src/**` 声明 23 条 ≥ 20 满足 QAS-19 |
| 新缺陷 | — | QA T-142 判定：**无 Blocker / Critical / Major / Minor** | — |

---

## 6. 真机侧现状（EX-03 双层判定）

- **本批交付的是内存模拟介质存档层**（与 S-05 冷归档同款先例）。本机实测无 `deveco` / `hdc` / ohos SDK / Cocos 导出环境。
- **未验证项**：杀进程 / 切后台的真实持久化（`SM-W1-04` 真机生命周期）、`SM-W2-05` 真机持久化半侧、S-06 ③b 格式探测写入校准记录、`K-4`（应用沙箱 / KV 偏好确切接口、HAP 包体上限与权限模型）。
- **处置**：按 `tests/quality-closure.md` **v1.2 EX-03** 顺延至真机环境就绪、最迟 S-12 前；**正式登记为准出阻塞项**，与 GAP-12 并列；`K-1~K-5` 真机跑通前不得凭猜测回填；**不覆盖 S1/S2 缺陷、不构成其他真机冒烟项先例**。
- **口径**：所有「恢复 / 原子写 / 双槽 / 迁移」结论只限定为「内存模拟介质可验证」，**不声称已在 HarmonyOS 真机验证、不声称断点续玩已达成**。QA T-142 独立核查 6 份文档 7 处相关命中，**全部处于否定或限定语境，零正向越界声称**。
- **组合根待办（S-12）**：P8 后落盘 / `ILifecycle.onBackground` 强制再存 / 关键操作（回退、解锁）后存 —— 本批只提供可被调用的服务与内存介质，**未接入真实生命周期**，属 S-12 HarmonyOS / Cocos 场景接入范围。此条在 W4 门说明中**显式列为 S-12 待办**，避免被读成「存档已接入」。

---

## 7. 质量门历程（三方独立）

| 节点 | 结果 |
| --- | --- |
| E 线 T-140 交付 | 32/32；全量 438/438（主理人复跑确认） |
| F 线 T-141 交付 | 12/12；全量 406/406（主理人复跑确认） |
| 主理人裁定 ①②③④ | ① 重复应用 ≠ 重复结算（历史文档保留原文 + 订正注记）；② 跨会话全局幂等不追加本批验收、登记后续开放项；③ `ledger.commandTrace` 不剥离（S-05 既有溯源结构、不用于去重）；④ checksum 定位认可（非加密摘要、防误改防写坏） |
| **T-142 QA 独立复核** | E 线 9/9 PASS（含独立故障注入 A~H 八探针）+ F 线 8/8 PASS（含两次文件级注入）；463/463 两次一致；tsc EXIT=0；**S-10 门双层判定 PASS/BLOCKED**；D-03 建议 CLOSED；零越界声称 |
| 主理人收口 | 亲自复跑 463/463、独立 tsc EXIT=0、处理 N-02/N-03、更新 D-03 终态、汇编本回顾、统一提交 |

**纪律**：全程 worker 未碰 git（统一由主理人提交）；所有数字为三方本机真实运行输出；QA 自己的一处探针口径错误（用 `canonicalize(CityState)` 比对 load 前后 vs 落盘口径）已在报告 §3.2 如实留存并注明「是探针错，不是实现缺陷」；「PASS」为 advisory，最终放行权在用户。

---

## 8. 台账与文档收口

- `tests/verification/w1-w2-verification.md §7.7`：D-03 终态由「OPEN（已跟踪）」更新为 **CLOSED（2026-11-07 · T-141/T-142）**，原状态留删除线备查。
- `tests/quality-closure.md` **v1.2**：新增 **EX-03**（W4 真机豁免窗口到期处置、双层判定、准出阻塞升级）。
- `src/README.md`：§2.3 新增依赖口径（N-02）+ 真机警告块；§2 `tests/**` 行数改为不声明（N-03）+ 新增行数声明纪律；`src/index.ts` 28 行。
- QA 复核用例 **QAS-1~25 入常驻门禁**（主理人拍板，遵循 render-s06 / ui-s07 复核用例的既有惯例）。

---

## 9. 下一步（待用户拍板）

- **S-11（W4 第二批）**：tick 级撤销 + 周期级重试（恢复周期起始 Keyframe + 丢弃其后 Delta）、周期末满意度单轴判定、V9 解锁下一块地、解锁进度入存档（与 S-10 联验）；`SM-W4-04/05`。底座已有：`snapshot.restore(tickId)` KEYFRAME 恢复、`tick-pipeline.ts` L390-392 `cycleOutcome` 判定、`config.ts` 的 `K=4` / `S_unlock=60` 占位。
- 或：先审阅本批交付（含 `s10-qareview.md`、本回顾），再进 S-11。
- 或：暂停开发，保留当前收口状态。

---

*文档结束 · W4 S-10 收口 · 内存模拟介质侧 PASS（advisory）/ 真机半侧 PARTIAL·BLOCKED · 463/463 · D-03 CLOSED · 准出层仍 BLOCKED（EX-03）*
