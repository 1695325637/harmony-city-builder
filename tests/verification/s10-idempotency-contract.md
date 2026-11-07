# HC-01 · S-10 验收 6 · D-03 `runTick` 层幂等契约（显式化）

| 项 | 内容 |
| --- | --- |
| 工作代号 | HC-01（非产品名） |
| 任务 | **T-141 · W4 S-10 第一批 F 线 · D-03 幂等契约显式化（S-10 验收条件 6）** |
| 日期 | 2026-11-07 |
| 依据 | `production/epics/epic-breakdown.md` §4 S-10 验收 6；`tests/verification/w1-w2-verification.md` v1.2 §5 `D-03` / §7 裁定 (c)；`tests/verification/w1-gate-remediation-evidence.md` §1.3 / §4；`tests/verification/edge-cases.test.ts` `V-05`；`docs/architecture/adr/ADR-002-simulation-loop-and-snapshot.md` §2 子决策 1/2、§6 R-2、§7 A1；`docs/architecture/adr/ADR-003-save-data-and-attribution.md` §2 子决策 3、§8 A3 |
| 授权边界 | **只写** `tests/verification/s10-idempotency-contract.md` + `tests/unit/idempotency-contract.test.ts`；不修改任何 `src/**` 运行期行为、不改既有测试断言、不碰 `src/save/**`（E 线 T-140 文件域）、不碰 git |
| 性质 | **契约显式化 + 对照用例**（不是缺陷修复，不是重构）；`runTick` / `CommandQueue` / `Simulation` 源码零改动 |
| 真机口径 | `tests/quality-closure.md` v1.2 **EX-03**：W4 门采用「纯逻辑侧可判 PASS / 真机半侧 PARTIAL 或 BLOCKED」双层判定。本线为**纯逻辑契约**，判据全部可在本机 Node 侧执行；**不声称任何真机验证**，不写「已验证 / 已达标」 |
| 基线 | 落盘前本机实测全量 `394/394 pass 0 fail`（Node v22.22.2） |
| 自验结论 | 单独 `tests/unit/idempotency-contract.test.ts` **12/12 pass 0 fail**；全量 `406/406 pass 0 fail`（394 基线 + 12 新增）；`tsc --noEmit --strict` src-only 口径 **EXIT=0**；新测试 `--check` **EXIT=0** |
| 裁定状态 | **两项待裁定均已于 2026-11-07 由主理人裁定关闭**：① §2.2 区分口径获认可（历史措辞订正见 `w1-gate-remediation-evidence.md §4` 表后注记，本线不回改该历史文档）；② 跨会话全局幂等**不追加本批验收、登记为后续开放项**，责任分派见 §4.3 / §9 遗留项 1 |

---

## 0. 一句话结论

> 幂等是**编排层职责**，不是内核职责：`CommandQueue.enqueue` + `Simulation.submit` / `Simulation.advanceDay` 是唯一权威去重入口；`runTick` 保持纯函数、**不做二次校验**，直接向它投递重复 `idempotencyKey` 命令是**显式契约外用法**（不是 bug，也不得改造成静默纠错）。本线以 `tests/unit/idempotency-contract.test.ts` 的 12 条对照 / 结构用例把该分层钉为可判定的显式契约，并如实披露存档恢复后幂等键的重建语义与边界。

---

## 1. 契约正文 · 幂等责任分层

### 1.1 唯一权威入口（唯一允许去重的位置）

| 层 | 落点 | 持有的去重状态 | 行为 |
| --- | --- | --- | --- |
| 命令队列 | `src/simulation/commands.ts` → `createCommandQueue().enqueue` | `seen: Set<string>`（按 `idempotencyKey`） | 同 key 第二次 `enqueue` 返回 `false`；`drain()` 只产出 1 条；`clear()` 清空 `seen` |
| 编排入口（编辑命令） | `src/simulation/session.ts` → `Simulation.submit` | 无自有集合，**委托** `queue.enqueue` | 暂停态编辑批量入队；同 key 不同 payload 也只入队 1 条 |
| 编排入口（结算命令） | `src/simulation/session.ts` → `Simulation.advanceDay` | `seenAdvanceKeys: Set<string>`（按 V6 key） | 同 key 重复点按返回 `accepted:false` / `AdvanceRejected(DUPLICATE)`；结算期 `InputGate.isLocked` 时返回 `AdvanceRejected(SETTLING)` |
| 结算内核 | `src/simulation/tick-pipeline.ts` → `runTick` | **无** | P0 冻结输入并把 `idempotencyKey` **只写进 `commandTrace` 作溯源**；P1 逐条应用命令；P8 发恰好 1 个 `TickCommitted` |

**契约条款（ normative ）**

1. 任何调用 `runTick` 的一方，**必须**先经 `CommandQueue.enqueue`（或等价的编排层去重）构造 `commands[]`。
2. `runTick` 的签名与语义固定为 `S_{t+1} = F(S_t, commands, config)`：确定性纯函数、热路径零分配、无 `Set` / `Map` 去重集合、无 `seen` / `dedup` 状态、无重复拒绝分支、无 `enqueue` / `drain` 队列语义、无 `assertConfigCompatible` 载入断言。
3. 去重状态**不允许下沉**到 `runTick`；若未来出现「顺手给 P0 加个 key 校验」的改动，静态结构用例 `ID-09/ID-10/ID-11` 必须变红。
4. `P0` 的 `if (i < POOL) ws.commandTrace.push(commands[i].idempotencyKey)` 是**预分配池容量上限**（`POOL = 128`），不是去重；不得把该 `if` 误读为二次校验，也不得把它改造成去重分支。

### 1.2 调用链（唯一合法路径）

```
UI / 测试
  ├─ Simulation.submit(cmd) ──► CommandQueue.enqueue(cmd) ──► seen.has(key) ? false : push
  └─ Simulation.advanceDay(key) ──► gate.isLocked ? 拒绝
                                   ──► seenAdvanceKeys.has(key) ? 拒绝(DUPLICATE)
                                   ──► queue.drain() + makeCommand.advance(key, …)
                                   ──► gate.lock() → runTick(state, commands, config, ws) → gate.unlock()
                                   ──► TickCommitted × 1，tickId + 1
```

`runTick` 只在 `advanceDay` 内被调用一次；`advanceRenderFrames` 不推进模拟（`ADR-002` A2）。

---

## 2. `runTick` 纯函数与「契约外用法」的定义

### 2.1 反向对照事实（钉死契约，不是放宽）

构造 `cmdA = makeCommand.zone('same', 1, 2, 2, 'R', 1)`、`cmdB = makeCommand.zone('same', 2, 2, 2, 'C', 3)`，**绕过队列**直接：

```ts
runTick(createInitialState(config), [cmdA, cmdB], config, ws)
```

实测（`V-05(b)` 与本线 `ID-03` 复跑一致）：

| 观测量 | 值 | 含义 |
| --- | --- | --- |
| `cells.zone[i]` | `zoneIndex(config,'C')` | 后者覆盖前者 |
| `cells.density[i]` | `3` | 两条都应用 |
| `cells.inputVersion[i]` | `2` | 两条都应用（`+2`） |
| `commandTrace` | `['same','same']` | 溯源如实记录重复键 |
| `TickCommitted` | `1` 个 | 一次原子事务只提交一次 |
| `tickId` | `1` | 一次 `runTick` = 一个 tick |

> **这是契约事实，不是缺陷**：`runTick` 的输入是「已去重的命令数组」，数组里出现重复键说明调用方越过了编排层。内核按纯函数语义逐条应用，不做纠错、不猜测意图、不静默丢弃。

### 2.2 口径澄清（主理人 2026-11-07 已裁定）

`w1-gate-remediation-evidence.md` §4 的跟踪写法为「直接重复投递同 `idempotencyKey` 到 `runTick` 会**重复结算**」。按 `ADR-002` §2 子决策 1/3 与 `runTick` 实际语义（一个 tick = 一次原子事务、P8 只发 1 个 `TickCommitted`），准确表述应为：

- **重复应用**：同一事务内命令被逐条应用（后者覆盖）、溯源出现重复键 —— 这正是本线 `ID-03` / `ID-04` 钉死的事实；
- **重复结算（多 tick 提交）**：指多次 `tickId` 推进 / 多个 `TickCommitted`，由 `advanceDay` 的 `seenAdvanceKeys` + `InputGate` 在编排层防住（`ID-01` / `V-05` 连点用例）。

本线**按实现事实**书写契约与用例，不按旧措辞改写实现，也不把「重复应用」粉饰成「重复结算」。`ID-04` 专门断言「同 key 两条 `ADVANCE` 直接喂 `runTick` 仍只产出 1 个 `TickCommitted` / `tickId=1`」，把两者区分开。**该澄清属口径披露，不改变任何源码行为**。

> **主理人裁定（2026-11-07 · 裁定 ①）**：**认可本节的区分口径**，「重复应用」与「重复结算 / 多 tick 提交」必须区分；T-116 历史跟踪写法里的「会重复结算」是当时的粗略措辞，**不构成对 `runTick` 语义的判定**。`tests/verification/w1-gate-remediation-evidence.md §4` 的 D-03 行**原文保留备查**，由主理人在表后新增「口径订正（2026-11-07 · 主理人裁定）」注记，写明两概念区分、指向本节与 `ID-03` / `ID-04`，并注明 **D-03 已关闭**。**本线不回改该历史文档**（属 T-116 修复方自证报告，保持历史判定）；历史措辞订正即见该注记。

### 2.3 契约外用法清单

| 用法 | 判定 | 允许？ |
| --- | --- | --- |
| 绕过 `CommandQueue`，手工构造含重复 key 的 `commands[]` 喂 `runTick` | 显式契约外用法；结果确定但双应用 | 仅限测试 / 诊断 / 契约对照，**生产调用方禁止** |
| 直接调用 `runTick` 推进 tick（不经 `advanceDay`） | 绕过 gate 与 `seenAdvanceKeys` | 生产调用方禁止 |
| 未来 UI / 存档层「自己拼 `commands[]`」 | 必须自带等价去重，或改走 `Simulation.submit` | 需架构评审 |

---

## 3. 与 `D-01` 的边界（不得混为一谈）

| 维度 | `D-01`（已关闭，T-116） | `D-03`（本线关闭） |
| --- | --- | --- |
| 性质 | **S1 缺陷**：旧存档 + 新 config 静默续算 | **S3 契约缺口**：幂等分层未文档化 |
| 管的对象 | **配置 / 版本漂移**（数据一致性） | **命令幂等**（输入去重） |
| 守门落点 | `deserializeState` / `createSimulation` / `archive.restore` 三处**载入 / 编排入口**的 `assertConfigCompatible` | `CommandQueue.enqueue` / `Simulation.submit` / `advanceDay` 三处**编排入口**的 key 集合 |
| 内核 `runTick` | 不做版本断言 | 不做二次幂等校验 |
| 修复 / 关闭方式 | 挂接断言 + 6 条回归（`d01-config-compat.test.ts`），**改了源码** | **只加契约文档 + 对照用例**，源码零改动 |
| 共同点 | 二者都遵循「**守门在入口、内核保纯**」分层；但 D-01 的修复**不构成**在内核加校验的先例，`w1-gate-remediation-evidence.md` §1.3 已明确「防静默续算的守门职责全部落在载入 / 编排入口」 | 同左 |

`ID-08` 用一条对照用例同时钉死该边界：不匹配 config 的旧档在 `archive.restore` / `createSimulation` 两入口抛 `ConfigMismatchError`，而 `runTick` 仍按纯函数照常结算 `tickId+1`。

---

## 4. 存档恢复后幂等键重建语义

> 本节**不依赖** E 线 T-140 尚未落盘的 `src/save/**`，只用 `src/simulation/snapshot.ts` 的 `buildTickSnapshot` / `createInMemorySnapshotStore.restore` / `TickSnapshot.commandTrace` 构造。**不声称真机持久化已验证**（EX-03）。

### 4.1 三种「键相关状态」的角色

| 状态 | 载体 | 是否进快照 / 存档 | 恢复后如何处置 |
| --- | --- | --- | --- |
| `CommandQueue.seen` | `src/simulation/commands.ts` 闭包内 `Set<string>` | **否** | 新建 `Simulation` 时从**空集合**重建 |
| `Simulation.seenAdvanceKeys` | `src/simulation/session.ts` 闭包内 `Set<string>` | **否** | 新建 `Simulation` 时从**空集合**重建 |
| `TickSnapshot.commandTrace` | `src/simulation/snapshot.ts`（KEYFRAME / DELTA 均深拷贝携带） | **是**（`S-05-⑥` 溯源链） | **只读溯源**；DELTA 不参与恢复、KEYFRAME 只反序列化 `SerializedState`，恢复路径**不重放命令**、不把历史 key 注入新会话的 `seen` |

### 4.2 可判 PASS 的纯逻辑侧语义（`ID-06` / `ID-07`）

1. **tickId 单调、不复用**：按 `src/simulation/snapshot.ts` 文件头与 `restore` 实现，`archive.restore(t, config)` 返回的是**目标 tick 之前（含）最近的 KEYFRAME**，故 `restored.state.tickId === restored.keyframeTickId ≤ t`，`replayFrom` 给出前向重放起点；**DELTA 不参与恢复、不做逆运算**。测试侧自持命令序列从 keyframe 前向重放到 `t` 后 `state.tickId === t`；恢复态新建 `Simulation` 后第一次 `advanceDay` 得到 `t+1`，且归档中 `tickId=t` 的条目仍可读、`store.put` 同 tickId 抛 `snapshot tickId already stored`（`ADR-002` §6 R-7 / §7 A6，`ADR-003` §2 子决策 1 的单调 id 前提）。**不得**把「restore 直接返回目标 tick 状态」写成契约——那与 KEYFRAME/Delta 策略不符。
2. **键集合从零重建**：恢复后 `pendingCount === 0`、`queue.drain()` 为空；新会话**没有**继承任何旧会话的 `seen` / `seenAdvanceKeys`。
3. **会话内幂等仍生效**：新会话第一次 `advanceDay(k)` 接受、第二次同 `k` 被 `DUPLICATE` 拒绝；`committedCount === 1`。
4. **`commandTrace` 只作溯源**：历史快照里出现过的 key，在新会话 `enqueue` 仍返回 `true`；归档条目内容不被恢复流程改写。

### 4.3 明确披露的边界（契约外用法，不粉饰）

> **当前实现不提供「跨会话全局幂等」。** 旧会话用过的 `idempotencyKey` 在新会话中**会被接受一次**（因为 `seen` / `seenAdvanceKeys` 重建为空）。这不是同会话内的「双结算」（旧会话已结束、新会话只提交 1 个 `TickCommitted`），但**也不是全局唯一键保证**。

- 若 S-10 存档层要求「同一 key 跨杀进程 / 切后台仍全局唯一」，责任方是 **E 线 `SaveService`**：显式持久化 / 回填键集合，或采用带 epoch / 会话前缀的 key 命名空间。
- **不得**把该需求下沉到 `runTick`（会破坏纯函数与零热路径分配契约），**也不得**靠「重放命令日志」间接获得键集合（`ADR-002` A4 / `ADR-003` A2 已否决纯命令日志重放：配置漂移会让 AC2 归因失真、启动不可控）。
- 本线不实现、不 mock、不引用 `src/save/**`；**已裁定 2026-11-07**：上列责任分派登记为后续开放项，不追加本批验收（见下方裁定块与 §9 遗留项 1）。

> **主理人裁定（2026-11-07 · 裁定 ②）**：**不追加为 E 线 S-10 本批验收条件，登记为后续开放项**。理由：① S-10 六条验收与 `SM-W4-01`~`05` 判据均未要求「同一 key 跨杀进程 / 切后台全局唯一」，判据是「五类字段逐项一致 + 不推进 tick + 不补算漏掉的 tick」；② OD-2 A 默认暂停、手动 tick，切后台只「冻结 + 存一次」，不存在跨会话重复投递同一 advance 键的现实路径；③ `ADR-003 A2` / `ADR-002 A4` 已否决纯命令日志重放，`ADR-003 §4` 明确 H3 不进排期、`ISaveStorage` 只预留能力位；④ 本节已如实披露「`seen` 重建为空、旧 key 在新会话会被接受一次」且未粉饰，作为**已知边界**登记，不是本批缺陷。
>
> **责任分派（写入遗留项）**：若未来 H3 云同步 / 跨设备续玩开启而需要全局唯一键，责任方是 `SaveService` 的 epoch 命名空间或显式持久化 / 回填键集合，**不得**下沉 `runTick`（破坏纯函数与零热路径分配）、**不得**靠重放命令日志间接获得；届时须另开 ADR / 需求，**不在本批扩范围**。E 线本就不持久化 `seen`，不会改动 `src/simulation/*`。历史措辞订正见 `tests/verification/w1-gate-remediation-evidence.md §4` 表后注记。

---

## 5. 与 `ADR-003` A3 显式迁移器的关系

1. **A3 原文**：header 含 `schemaVersion / configHash / engineVersion / seed / checksum`；版本不匹配走**显式迁移器**或拒绝载入并保留旧槽，**无静默续算路径**（`ADR-003` §2 子决策 3、§6 R-2、§8 A3）。
2. **D-01 的实现落点**：`assertConfigCompatible` 挂接在 `deserializeState` / `createSimulation` / `archive.restore` 三处公开载入入口；`w1-gate-remediation-evidence.md` §1.3 明确「**显式迁移走未来 S-10 `migrate()` 路径，不经 `deserializeState` 绕行**」。
3. **本线与 A3 的接口面**：
   - 迁移器属 **E 线 `SaveService`（S-10 验收 3）** 范畴，本线不实现、不 stub、不静态断言其存在；
   - 迁移**不得**经 `deserializeState` 静默绕行，更**不得**通过 `runTick` 重放旧命令来实现（A4 已否决）；
   - 因此 §4.3 的「跨会话幂等键重建」只能由存档层在**重建会话时显式回填**，不能从归档重放推导；
   - `ID-08` 静态断言 `runTick` 函数体既不含 `assertConfigCompatible(`、也不含 `migrate(` / `deserializeState(`：守门与迁移都留在载入 / 编排 / 存档层，内核保持纯函数。
4. **一句话**：A3 管「**数据版本怎么进新会话**」，D-03 管「**命令键由谁去重**」；两者共享同一条分层原则，但**互不替代、不得互相下沉**。

---

## 6. 用例对照表（`tests/unit/idempotency-contract.test.ts`）

| ID | 用例 | 对应派单 / 验收 | 判据摘要 |
| --- | --- | --- | --- |
| `ID-01` | V-05 连点复跑（2 + 5 次） | 验收 6「复跑 V-05 连点」；`SM-W2-04`；`ADR-002` R-2 | 只 `+1 tick`、`TickCommitted=1`、`committedCount=1`、`pending` 提交阶段权威状态指纹不变、结算期 `gate.isLocked=true` / 结束后 `false`、重复点按 `accepted=false` |
| `ID-02` | 同 key 不同 payload | 验收 6「同 key 不同 payload」；`V-05(a)(c)` | `enqueue` 第二次 `false`、`drain()` 仅 1 条且为 `cmdA`、`size=0`；`sim.submit` 同 key 只入队 1 条 |
| `ID-03` | 反向对照：重复 key 直接喂 `runTick` | 验收 6「反向对照钉死契约」；`V-05(b)` | 两条都应用（`inputVersion=2` / `zone=C` / `density=3`）、`commandTrace=['same','same']` |
| `ID-04` | 反向对照补强：重复 `ADVANCE` ≠ 重复结算 | §2.2 口径澄清 | 两条 `ADVANCE` 仍只 `TickCommitted=1` / `tickId=1` / `commandTrace` 双键，区分「重复应用」与「多 tick 提交」 |
| `ID-05` | 唯一权威入口结构正向证据 | 契约 §1.1 | `commands.ts` 含 `seen.has(cmd.idempotencyKey)`；`session.ts` 含 `queue.enqueue(cmd)` 与 `seenAdvanceKeys.has(key)` |
| `ID-06` | 存档恢复后幂等键重建语义 | 验收 6「存档恢复后幂等键重建语义用例」 | 见 §4.2 四条；含 `tickId` 单调与归档同 tickId 禁覆盖 |
| `ID-07` | `commandTrace` 只作溯源、不注入新会话 `seen` | §4.1 / §4.2 第 4 条 | 历史 key 在新会话 `enqueue` 返回 `true`；归档 `commandTrace` 不被恢复改写 |
| `ID-08` | D-01 / A3 边界对照 | §3 / §5 | 旧档 + 新 config 在 `restore` / `createSimulation` 抛 `ConfigMismatchError`；`runTick` 照常 `tickId+1`；`deserializeState` 含 `assertConfigCompatible(` |
| `ID-09` | 静态结构断言：`runTick` 无二次幂等校验 | 验收 6「静态 / 结构断言防后人顺手加校验」 | 剥注释 / 字符串后跳过参数列表 + 大括号配平抽函数体；11 条 guard 模式零命中；正向对照证明抽取有效 |
| `ID-10` | 反向哨兵（防永真） | 同上「断言须能真正拦截」 | 伪造「`new Set` + `seen.has`」的哨兵源码喂同一检测器 → 必须判为含校验 |
| `ID-11` | 注入哨兵（真实上下文拦截） | 同上 | 在**真实 `runTick` 函数体**注入一行二次校验 → 必须判为含校验；同时断言注入确实发生 |
| `ID-12` | 契约文档一致性守卫 | 契约可追溯 | 本文档存在且含 8 个关键契约串；反向对照「不得出现与契约相悖的错误表述」（被禁字面串只在用例 `ID-12` 中定义，正文不重复，避免自证命中） |

`ID-09` 的 11 条 guard 模式（对剥注释 / 字符串后的函数体）：

```
new Set|new Map  ·  seen|seenAdvanceKeys|dedup|visited|processedKeys|idempotencyKeys  ·
.has(  ·  .add(  ·  DUPLICATE  ·  idempotencyKey === / !==  ·  enqueue(  ·
drain(  ·  assertConfigCompatible(  ·  migrate(  ·  deserializeState(
```

> **非永真设计**：仅靠「源码不含某模式」会是永真断言（抽错函数体、空串也通过）。本线用三层防护：① `ID-09` 正向对照断言抽出的函数体长度 > 2000 且含 `commandTrace.push` / `idempotencyKey` / `enterStage` / `copyFrameForLag` / `solveTraffic`；② `ID-10` 反向哨兵；③ `ID-11` 在真实函数体上注入后必须变红。任意一层被绕过都会让 `ID-10` / `ID-11` 失败。

---

## 7. 真机口径（`tests/quality-closure.md` v1.2 EX-03）

| 半侧 | 判定 | 说明 |
| --- | --- | --- |
| **纯逻辑侧（本线全部判据）** | **可判 PASS** | 12 条用例全部在本机 Node v22.22.2 `--experimental-strip-types` + `node:test` 执行（12/12），并入全量 406/406；零依赖、零平台 import、不读墙上时钟、`src/**` 零改动 |
| **真机半侧** | **PARTIAL / BLOCKED，不判 PASS** | 杀进程恢复 / 切后台 / 应用沙箱与 KV 偏好确切接口（K-4）/ HAP 权限模型 / checksum 真机落盘，本机无 DevEco / hdc / ohos SDK / Cocos 导出环境，按 EX-03 顺延至真机就绪、最迟 S-12 前，已正式登记为**准出阻塞项** |

> 本线**不声称真机验证**，不写「已验证 / 已达标 / 真机通过」；`ID-06` 的 `createInMemorySnapshotStore` 为 **T-116 内存模拟介质**（`src/README.md` §6 已知限制 8），与真机持久化不等价。EX-03 明确「不改变 S-10 / S-11 离线可验部分（存档结构 / 双槽 / checksum / 迁移 / 故障注入 / **回退幂等** / 周期判定 / 解锁）的验收强度」，本线即属该离线可验部分。

---

## 8. 硬约束逐条核对

| # | 派单硬约束 | 核对 |
| --- | --- | --- |
| 1 | 不改 `runTick` / `CommandQueue` / `Simulation` 运行期行为 | ✅ 两个新文件均在 `tests/**`；`src/**` 零改动 |
| 2 | 零依赖口径（Node 22 类型剥离 + `node:test`，不 import `node:` 于 `src/**`） | ✅ 测试文件仅用 `node:test` / `node:assert/strict` / `node:fs` / `node:path`；`src/**` 未动 |
| 3 | 不破坏既有 394 条用例 | ✅ 落盘前基线 394/394；新增用例只增不改 |
| 4 | 真机口径不声称验证 | ✅ §7 + `ID-06` 介质披露 |
| 5 | 不碰跨域红线 / E 线 `src/save/**` | ✅ 未读改 `src/save/**`；未引用存档层新模块 |
| 6 | D-15 写前查存在性、读现状再改 | ✅ 落盘前已确认两个目标路径 `ABSENT`；已读 `commands.ts` / `session.ts` / `snapshot.ts` / `tick-pipeline.ts` / `edge-cases.test.ts` / `input-gate.test.ts` / `determinism.test.ts` / ADR-002 / ADR-003 / `epic-breakdown.md` / `quality-closure.md` 等 |
| 7 | 如需补既有测试，只允许 `input-gate.test.ts` / `determinism.test.ts` 最小增量 | ✅ **未改动任何既有测试文件**，包括这两份；V-05 连点与同 key 不同 payload 改为在新文件内**复跑**（重述断言，不删改原文件） |
| 8 | 不碰 git | ✅ 仅 `git status --short` 只读核对 |
| 9 | 成员禁止直连，有问题回执 `team-lead` | ✅ §2.2 口径澄清与 §4.3 责任分派已列回执，主理人 2026-11-07 两项裁定均已落地（裁定 ① 认可区分口径 / 裁定 ② 不追加本批验收、登记后续开放项） |

---

## 9. 遗留项（登记，不在本批范围）

1. **跨会话全局幂等键（已裁定 2026-11-07 · 裁定 ②）**：**不追加本批验收，登记为后续开放项**。若未来 H3 云同步 / 跨设备续玩开启而需要全局唯一键，责任方是 E 线 `SaveService` 的 epoch 命名空间或显式持久化 / 回填键集合；**不得**下沉 `runTick`（破坏纯函数与零热路径分配）、**不得**靠重放命令日志间接获得，届时须另开 ADR / 需求、不在本批扩范围。本线只钉死「重建为空 + 会话内幂等仍生效」的当前语义（§4.3 如实披露原文保留）；E 线本就不持久化 `seen`，不会改动 `src/simulation/*`。
2. **§2.2 口径澄清（已裁定 2026-11-07 · 裁定 ①）**：主理人认可「重复应用」与「重复结算（多 tick 提交）」必须区分，T-116 历史跟踪里的「会重复结算」属当时粗略措辞、**不构成对 `runTick` 语义的判定**。**历史措辞订正见 `tests/verification/w1-gate-remediation-evidence.md §4` 表后新增的「口径订正（2026-11-07 · 主理人裁定）」注记**（D-03 行原文保留备查、D-03 已关闭）；本线未改、也不回改该历史文档。
3. **显式迁移器落点**：`ADR-003` A3 的 `migrate()` 属 E 线 S-10 验收 3；本线静态断言 `runTick` 不含迁移 / 载入入口，但不实现迁移器本身。
4. **真机半侧**：EX-01 / EX-02 / K-4 顺延，准出层 BLOCKED，最迟 S-12 前补齐。
5. **`commandTrace` 容量**：P0 只记录前 `POOL=128` 条命令键；超出容量的溯源截断属既有 `TickWorkspace` 预分配纪律，本线未改，若 S-10 要求完整键溯源须另立需求。

---

## 10. 交付文件清单

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `tests/verification/s10-idempotency-contract.md` | 新建 | 本文档：契约正文 / 责任分层 / D-01 边界 / 恢复键语义 / A3 关系 / 用例对照 / EX-03 口径 / 硬约束核对 / 遗留项 |
| `tests/unit/idempotency-contract.test.ts` | 新建 | 12 条对照 + 结构用例（`ID-01`~`ID-12`），`idempotency-` 前缀，纳入 `tests/unit/*.test.ts` 通配 |

> 未新建 / 未修改任何 `src/**` 文件、任何既有测试文件、任何 `production/**` 文档、任何 git 对象。

---

*文档结束 · T-141 / F 线 · D-03 幂等契约显式化 · 纯逻辑侧双层判定按 EX-03 执行 · 用户已拍板全量授权、提交由主理人统一执行*
