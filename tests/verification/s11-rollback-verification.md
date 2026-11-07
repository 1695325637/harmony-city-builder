# S-11 回退内核 · 自验记录（T-143 · W4 第二批 G 线）

> 状态：**纯逻辑 / 内存模拟介质侧自验 PASS**。
> 真机半侧未验证（`tests/quality-closure.md` v1.2 EX-03 顺延、准出阻塞）。
> **DoD D-2（「失败—诊断—修正—见效」完整体验）人工判定未执行**，本批只提供可测结构支撑，
> 不声称该体验已达成。
> 本文由 engineering-lead 产出，不替代 quality-lead 的独立复核与 W4 门判定。

## 1. 权威口径

- `production/epics/epic-breakdown.md` **S-11 验收 1/2**：回退到周期起始 Keyframe 并重新决策；
  **代码库无任何逆运算路径**；回退后 `tickId` 单调递增、Delta 链一致、**旧分支归档保留供复盘**。
- `docs/architecture/architecture.md` §4.3 / `ADR-002 A6` / `A-6`：回退 = 恢复周期起始 Keyframe +
  丢弃其后 Delta，无逆运算；`tickId` 单调递增不复用。
- `design/gdd/systems/04-budget-economy.md` **E3**：回退后 `B / I_f / 解锁标志` 一并回滚，结算幂等、不重复扣费；
  **E7**：周期末「判定 → 解锁 / 回退」互斥，同一帧只发生其一；**AC-E4**：同一周期回退重跑，
  结余 / 解锁标志 / 议题状态与首次结算前完全一致。
- `tests/smoke-checklist.md` **SM-W4-04**：失败即停规则 = 出现逆运算 / `tickId` 复用 / Delta 链断裂。

## 2. 交付物

| 路径 | 说明 |
| --- | --- |
| `src/simulation/rollback.ts`（新建，**279 行**） | 回退内核：周期起始 KEYFRAME 定位 / 周期级重试 / E7 互斥守卫 / 可判定错误码 |
| `src/simulation/session.ts`（100→179 行） | 新增可选 `SimulationOptions.snapshotStore`、`retryCycle()` 入口、`lastCycleOutcome`；既有 `advanceDay` / `submit` / `renderFrames` 签名与行为不变 |
| `tests/unit/rollback-cycle.test.ts`（RC-1~8） | 定位规则 / 恢复一致性 / tickId·cycleId 单调 / 旧分支保留 / AC-E4 无重复扣费 |
| `tests/unit/rollback-session.test.ts`（RS-1~10） | 幂等重放 / E7 互斥 / 可判定失败 / 结算中拒绝 / 既有行为不变 / 显式目标周期 |
| `tests/unit/rollback-static.test.ts`（**RT-1~8**） | 无逆运算 / 只经 restore / D-03 不破 / 零依赖 / 诚实口径留痕 / 版本头未动 / **RT-8：`cycleId` 分支标签口径被守卫钉住** |
| `src/README.md` | §2 `session.ts` 行数 100→179 同步 + 新增 `rollback.ts` 索引行（**279**）+ `src/index.ts` 28→29 + 追加同类文件说明 |

**`src/index.ts` 已改动（28→29 行，已挂 `export * from './simulation/rollback.ts'`）**：
> **订正（2026-11-07 · 主理人裁定 2 / 本文 §2 原文为落盘前中间态）**：原文曾写「`src/index.ts` 未改动（保持 28 行）、故本模块不挂 barrel」。主理人裁定**不接受**该取舍——不挂 barrel 会使 `tsc --noEmit --strict src/index.ts` **覆盖不到 `rollback.ts`**，类型正确性只剩运行时保障。已补 `export * from './simulation/rollback.ts'`（→29 行）；`s10-qareview` 的 `QAS-19` 硬编码 28 断言**由 quality-lead 在 T-145 一并升级**为「行数走 README 声明值动态比对 + barrel 出口全量清单比对」（比硬编码更硬）。现 `tsc src/index.ts` EXIT=0 且覆盖回退内核。

## 3. 周期起始 Keyframe 的定位规则

`findCycleStartKeyframe(store, cycleId)`：在归档中找 **`cycleId` 相同、`cycleTickIndex === 0`、
且 `kind === 'KEYFRAME' && frames !== null`** 的条目，取 `tickId` 最大者（多分支时取最新分支）。

为什么 `cycleTickIndex === 0` 就是周期起点：`tick-pipeline.ts` 的 P7 在周期末把
`cycleTickIndex` 复位为 0 并推进 `cycleId`，该 tick 的快照因此同时是「上一周期末帧」与
「本周期起点」，`snapshot.ts` 的 `isKeyframe` 规则同样据此判 KEYFRAME。

实测归档形态（K=2、6 个 tick）：
```
1:c0.1:KEYFRAME | 2:c1.0:KEYFRAME | 3:c1.1:DELTA | 4:c2.0:KEYFRAME | 5:c2.1:DELTA | 6:c3.0:KEYFRAME
```
→ 周期 1 起点 = tick 2；周期 2 起点 = tick 4；周期 3 起点 = tick 6。

**缺失必须显式失败**：`findCycleStartKeyframe` 返回 `null` 时抛
`CYCLE_START_KEYFRAME_MISSING`，**绝不退化到「≤ 目标 tick 的最近 KEYFRAME」静默继续**
（`store.restore` 本身有该退化语义，本内核在 restore 之后额外校验
`keyframeTickId === 定位的 tickId`，不一致即拒绝）。
实测：周期 0 的起点是初始态（tick 0），从未入档 → `retryCycle(0)` 抛
`CYCLE_START_KEYFRAME_MISSING`（RC-1 / RS-5）。

`defaultTargetCycleId(head)`：周期边界（`cycleTickIndex === 0` 且 `cycleId > 0`）取
**刚结束的周期** `cycleId - 1`；其余取当前周期 `cycleId`。规则只依据状态本身推导，确定性可回放。

## 4. `tickId` 单调与 `cycleId` / `cycleTickIndex` 处理规则

回退**不是**「回到旧 tick」，而是**开启一条新分支**：

| 标签 | 取值规则 | 效果 |
| --- | --- | --- |
| `tickId` | `max(归档最大 tickId, 回退前头部 tickId) + 1` | 下一次 `runTick` 产出该值 +1 → **任何历史 tickId 都不复用** |
| `cycleId` | `max(归档最大 cycleId, 回退前头部 cycleId) + 1` | **永不低于回退前的值**（不倒退），归档按 cycleId 天然分段 |
| `cycleTickIndex` | `0` | 与新周期起点一致，`runTick` 的周期末判定（`+1 >= K`）语义正确 |

- 新分支起点同时以 **KEYFRAME** 写入归档（全新 `tickId`，`SnapshotStore.put` 对同 tickId 直接抛错，
  故**不可能覆盖旧条目**）；这样「重复回退 / 后续再回退」都有落点。
- **⚠️ `cycleId` 语义口径（主理人 2026-11-07 裁定 3，写死）**：
  **`cycleId` 在回退后是「分支标签」，不等于「已玩周期数」；每次回退会让它前进 2
  （回退标签 + 后续结算）。** 因此**不得**把它当作 UI 上的「第 N 周期」序号、统计口径或
  存档语义版本；需要「已玩周期数」时应另设独立计数器（本批不引入，属后续 Story / 组合根职责）。
  这是为「不倒退 + 归档可整段复盘」付出的刻意代价，已由 RC-8 / RS-9 断言其仍严格递增。
- 恢复态内容（`budget` / `cells` / `frames` / `unlockedRegions` / `issueCount`）**全部原样取自
  KEYFRAME**，本内核只改上述三个「身份标签」——静态证据见 RT-2（仅 3 处标签赋值）。

## 5. 旧分支归档保留

- 回退只 `put` 一条**全新 tickId** 的 KEYFRAME，**不删除、不修改、不覆盖**任何旧条目；
  RC-5 对回退前的每个条目做 `canonicalize` 前后比对，逐条断言内容逐字节未变，且
  `getCycleRange(1,3)` 的旧分支查询结果未变（可整段复盘）。
- 本内核不引入任何新的 `TickSnapshot` 字段（分支标记用「单调 `cycleId` + 新 tickId」表达），
  **不改 S-05 快照契约结构**。

## 6. 幂等与 E7 互斥

- **幂等**：`retryCycle` 本身是「恢复 + 重标」，**不含任何结算算术**，重复调用不会重复扣费
  （RS-2 断言重复回退后结余不变、只在真实重跑结算时变化一次）。
  为避免重复推进分支标签，session 层做**幂等重放**：
  同一目标周期、且其间无新的成功结算 → 直接返回上次结果（不重复入档、不推进 `tickId`/`cycleId`）；
  无参调用视为「重试刚失败的那个周期」这一同一意图（回退后默认推导会变化）；
  一旦 `advanceDay` 成功，幂等窗口关闭（RS-1）。
- **E7 互斥**：`assertRollbackAllowed(lastCycleOutcome)` —— 最近一帧为 `TARGET_MET`（该帧已完成解锁）时
  抛 `UNLOCK_COMMITTED_THIS_FRAME`（RS-3）；下一帧不再达标后即可回退（RS-4）。
  同帧「解锁 / 回退」只发生其一，与 H 线的判定 / 解锁实现互斥。
- 结算进行中（`InputGate` 已锁）→ `SETTLING`（RS-6）。
- **D-03 契约不破**：回退路径**不加**任何二次幂等校验、不读写键集合；去重仍在
  `CommandQueue` / `Simulation`（RT-4 静态正反两向断言）。

## 7. 可判定错误码

| 码 | 触发 |
| --- | --- |
| `STORE_UNAVAILABLE` | 未注入 `SimulationOptions.snapshotStore` |
| `EMPTY_ARCHIVE` | 归档为空（从未结算） |
| `INVALID_CYCLE_ID` | 目标周期为负 / 非整数 / 大于当前周期 |
| `CYCLE_START_KEYFRAME_MISSING` | 目标周期起点未归档（如周期 0 初始态）或 restore 落点与定位不一致 |
| `UNLOCK_COMMITTED_THIS_FRAME` | E7：该帧已 `TARGET_MET` |
| `SETTLING` | 结算中（gate 已锁） |

全部 `state` 不变、不写归档（RS-5 / RS-6 断言头部与归档条目数不变）。

## 8. 用例 → 验收映射

| 判据 | 用例 |
| --- | --- |
| S-11 验收 1：回退到周期起始 Keyframe 并重新决策 | RC-1、RC-3、RS-9 |
| S-11 验收 2：`tickId` 单调递增、Delta 链一致、旧分支归档保留 | RC-4、RC-5、RC-8、RS-10 |
| SM-W4-04：无逆运算 / 不复用 tickId / Delta 链一致 / 旧分支保留 | RC-4、RC-5、RT-1、RT-2、RT-3 |
| AC-E4：回退重跑，结余 / 解锁 / 议题与首次结算前一致、无重复扣费 | RC-3、RC-7、RS-2 |
| E3：回退后 `B / I_f / 解锁标志` 一并回滚 | RC-3（`fiveFields` 逐项比对含 `budget` / `unlockedRegions`） |
| E7：解锁 / 回退同帧互斥 | RS-3、RS-4、RT（`assertRollbackAllowed`） |
| D-03 契约不破 | RT-4、RS-7、RS-8 |
| 版本头禁改 | RT-7 |
| 零依赖 / 平台纪律 | RT-5 |

## 9. 限制与遗留项

- **真机未验证**：`ISaveStorage` / 真实归档介质未接入；本内核只依赖结构化 `RollbackStore`
  （`entries` / `get` / `put` / `restore`），未来真机归档实现可直接复用。EX-03 顺延、准出阻塞。
- **DoD D-2 未判定**：「失败—诊断—修正—见效」的完整体验需人工实测，本批只提供结构支撑。
- **周期 0 无法回退**：初始态（tick 0）从未入档，`retryCycle(0)` 显式失败。
  若产品需要「回到开局」，需由装配层在会话开始把初始态归档为 tick 0 KEYFRAME（属 S-12 组合根）。
- **回退后须使用新的 advance 幂等键**：`Simulation.seenAdvanceKeys` 不因回退重置（D-03 去重语义），
  重试后的「结束本日」须由 UI 生成新 key。是否允许回退清空键集合属 session 层语义变更，
  需主理人 / F 线裁定，本批不自行改动。
- **组合根实际调用点**：`retryCycle` 的生产装配（回退入口 UI、P8 后归档、`onBackground` 强制存档）
  属 **S-12 Cocos / HarmonyOS 场景接入**，本批未做、不声称已上屏。
- **跨域观察（不属本线，供主理人路由）**：当前全量套件另见 3 条失败，
  位于 `tests/verification/render-s06-qareview.test.ts` 的 **QA-R2 / QA-R3 / QA-R8**，
  根因为 H 线在 `tick-pipeline.ts` 的 P7 解锁实现新增 `cells.unlocked[i] = 1` / `cells.region[i] = 0`
  写格（`git diff` 可见），与 quality-lead 既有契约（「结算链仅 P1 写格」「纯 ADVANCE tick 不写格」
  「解锁只递增 `unlockedRegions`、不写 `cells.unlocked`」）冲突。本线 `rollback.ts` 零写格
  （RT-1 已钉死），排除该文件后 **494/494 零 fail**。
