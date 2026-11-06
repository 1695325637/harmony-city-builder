# HC-01 · W1~W2 纯逻辑层独立验证报告（第二层 QA / fresh eyes）

| 项 | 内容 |
| --- | --- |
| 工作代号 | HC-01（非产品名） |
| 任务 | T-114 · quality-lead（严守真）对 T-112 交付的 W1~W2 纯逻辑层做独立验证 |
| 日期 | 2026-11-05 |
| 版本 | **v1.2**（v1.0：口径同步更新 + 注记；v1.1 = T-115 状态收口：T-113 口径裁定回执 + 主理人 `D-01` 升格 S1 / W1 出口门改判 FAIL，**验证数据与全部验证结论未改动**；v1.2 = T-117 **追加修订**：T-116 修复的独立复核 + 三项裁定 + W1/W2 出口门重判，见 **§7**；v1.1 的 FAIL 判定历史全文保留、不删改） |
| 工作区 | `C:/Users/wuyanying/WorkBuddy/2026-11-05-17-29-11` |
| 授权与边界 | 只新建 `tests/verification/` 下文件；**未修改** `src/`、`tests/unit/`、`tests/` 下既有 QA 文档、`design/`、`docs/`、`production/` 下任何文件；未提交 git、未发布、未删除任何文件。T-115 仅改本报告一个文件，`tests/verification/edge-cases.test.ts` 保持原样 |
| 交付物 | `tests/verification/edge-cases.test.ts`（**839 行**，T-115 未改动）、`tests/verification/w1-w2-verification.md`（本文，行数见 §6.3） |
| 质量门定位 | **advisory（建议性）**：本判定由 QA 给出，最终放行由用户决定（`tests/test-strategy.md` §0.5 / §5.3、`tests/quality-closure.md` §4） |
| 口径状态 | **已裁定关闭**（T-113 / design-strategist「选 A / 确认实现」，主理人 2026-11-05 中转）：GDD 01 两处 `ΔS` 冲突与 E1 首 tick 口径不再标注「待裁定」；原 spec 的「口径待设计侧裁定」**作废**，`AC-F2` 判定已闭合、实现侧解读正确、零返工，本轮据此**不判实现 FAIL**。终态与实测核对见 §2.1。**W1 出口门改判 FAIL 系 `D-01` 升 S1 所致，与本口径裁定无关** |
| 出口门判定（v1.1 终态，**历史保留**） | **W1 = FAIL**（`D-01` 升 S1 命中 `SM-W1-02` 失败即停）/ **W2 = FAIL（范围性 / advisory）**；依据见 §4 |
| 出口门判定（**v1.2 重判 · 当前生效**） | **W1 = PASS（advisory）**——`D-01` 已修复验证关闭，`SM-W1-04` 按 EX-01 书面豁免顺延（非豁免到底）；**W2 = PASS（advisory）**——`SM-W2-05` / `SM-W2-06` 证据已补齐（前者为内存介质口径，真机持久化随 EX-01 顺延）；依据与三项裁定见 **§7** |

---

## 0. 一句话结论

> **已实现的 S-02 / S-03 纯逻辑层在 45 条基线 + 12 条独立边缘用例（合计 57 条）下全部通过，确定性、边缘健壮性、静态纪律均成立；但 W1 出口门判 FAIL、W2 出口门判 FAIL（范围性）：W1 因 `D-01` 经主理人裁定升 S1（`SM-W1-02` 静默续算命中失败即停）且 `SM-W1-04`（S-01 真机生命周期）未做；W2 因 `SM-W2-05` / `SM-W2-06` 对应 S-05 / S-04 尚未交付。另登记 1 条 S1（`D-01`）、2 条 S3（`D-02` / `D-03`）与 2 条 S4（`D-04` / `D-05`）。不建议无条件进入 W3。**

实现侧自称「W1 的 `SM-W1-04`、W2 的 `SM-W2-05` / `SM-W2-06` 未做，W2 出口门不能整体判 PASS」——**经独立静态核实，该边界声明属实**（见 §3.4）。

> **口径更新（T-113 已裁定，主理人中转）**：`design/gdd/systems/01-satisfaction-simulation.md` §3.2 / §4.3 的 `ΔS` 双重定义与 §6.1 E1 首 tick 口径，已由 design-strategist 裁定关闭（**选 A / 确认实现侧解读正确**）。本报告中相关表述按终态改写为「口径已裁定」，**原 T-114 spec 的「口径待设计侧裁定」作废**；裁定确认实现侧处理正确、45 条单测零返工、`AC-F2` 判定已闭合、`src/README.md` §6 已知限制 4 已与新口径一致。详见 §2.1。**口径裁定本身不改变 W1 / W2 出口门判定；W1 由 `CONCERNS` 改判 `FAIL` 是主理人按 `tests/smoke-checklist.md` L62 `SM-W1-02` 失败即停规则字面与 ADR-003「无静默续算」把 `D-01` 升 S1 所致，与 T-113 口径裁定无关**（见 §4.1 / §5）。

---

## 1. 实际命令、退出码、通过 / 失败数（真实运行记录）

所有命令均在工作区根目录 `C:/Users/wuyanying/WorkBuddy/2026-11-05-17-29-11` 下真实执行；`node -v` → **v22.22.2**，零依赖（Node 内置 `--experimental-strip-types` + `node:test`），无 `package.json` / `tsconfig.json` / `node_modules`。

### 1.1 独立复跑实现者基线

```
node --experimental-strip-types --test tests/unit/*.test.ts
```

| 项 | 结果 |
| --- | --- |
| 退出码 | `BASELINE_EXIT=0` |
| 计数 | `# tests 45 / # pass 45 / # fail 0 / # cancelled 0 / # skipped 0 / # todo 0 / # duration_ms 529.973` |
| 与主理人独立复跑比对 | **一致**（主理人记录 45/45 / EXIT=0；本次 45/45 / EXIT=0） |
| 关键输出 | 45 条子测试全 `ok`，无 `not ok`；涉及确定性回放、D6 解环、InputGate、P0~P8、占位符、通勤归因共 7 个文件 |

### 1.2 独立边缘验证套件（首次运行，如实保留失败记录）

```
node --experimental-strip-types --test tests/verification/edge-cases.test.ts
```

| 项 | 结果 |
| --- | --- |
| 退出码 | `VERIFY_EXIT=1` |
| 计数 | `# tests 12 / # pass 11 / # fail 1`（`V-10` FAIL：`0 !== 0.75`，期望注入 solver 后 `f_s=0.75`，实得 `0`） |
| 根因 | **QA 侧用例缺陷，非实现缺陷**。独立 stub 把 `TrafficResult` 分母字段误写为 `serviceWeightedTotal`，实际字段名为 **`serviceWeightTotal`**（`src/simulation/traffic.ts:31`、`src/simulation/tick-pipeline.ts:293`）；`safeDiv` 因 `Number.isFinite(undefined) === false` 走 `fallback=0`。实现自洽，默认路径 `f_s` 实测 `0.95`（见 §2 ④ 与 V-04 输出）。 |
| 处置 | **未删用例、未改 `src/`**；仅修正 `tests/verification/edge-cases.test.ts` 内 stub 字段名后重跑。该命名不对称已登记为 S4 `D-04`（见 §6）。 |

### 1.3 独立边缘验证套件（修正后重跑）

```
node --experimental-strip-types --test tests/verification/edge-cases.test.ts
```

| 项 | 结果 |
| --- | --- |
| 退出码 | `VERIFY_EXIT=0` |
| 计数 | `# tests 12 / # pass 12 / # fail 0 / # duration_ms 642.0336` |
| 用例 | `V-00` 运行证据、`V-01`~`V-10` 十条边缘路径、`V-STATIC` 静态纪律扫描 |

### 1.4 合并交叉验证（实现者单测 + 独立验证，互不干扰）

```
node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts
```

| 项 | 结果 |
| --- | --- |
| 退出码 | `COMBINED_EXIT=0` |
| 计数 | `# tests 57 / # pass 57 / # fail 0 / # duration_ms 1133.0862`（45 + 12） |

### 1.5 跨进程探针（V-09 内部真实拉起两个独立 Node 进程）

```
node --experimental-strip-types --input-type=module -e "<inline ESM probe>"
```

- 可行性预检输出 `PROBE_OK:{"B_cap":1000,"B_floor":` / `PROBE_EXIT=0`。
- V-09 中两个独立子进程与进程内基准三者的 `canonicalize(serializeState(s))` 长度均为 **10875 字节且字符串逐字节相等**。

> 说明：所有性能类数字（`# duration_ms`、10875 字节长度）仅为**本机执行记录**，不是性能承诺值；`p95 ≤16ms` 等一律按「建议基线 / 非承诺值」处理（`tests/test-strategy.md` §4.4 / `tests/smoke-checklist.md` §0.5）。

### 1.6 口径同步后复核运行（T-113 裁定中转后，真实重跑）

主理人中转 T-113 裁定后，本报告与 `tests/verification/edge-cases.test.ts` 的口径标注按终态改写（**仅注释 / 日志文本，未改任何断言逻辑**），随即真实重跑三套命令验证「零返工」：

| 命令 | 退出码 | 计数 | 结论 |
| --- | --- | --- | --- |
| `node --experimental-strip-types --test tests/unit/*.test.ts` | `A_EXIT=0` | `# tests 45 / # pass 45 / # fail 0 / # duration_ms 530.2928` | **45 条基线无一条受影响**，独立复核「零返工」成立 |
| `node --experimental-strip-types --test tests/verification/edge-cases.test.ts` | `B_EXIT=0` | `# tests 12 / # pass 12 / # fail 0 / # duration_ms 675.9858` | 口径标注同步后仍 12/12；V-01 输出已按终态改写 |
| `node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts` | `C_EXIT=0` | `# tests 57 / # pass 57 / # fail 0 / # duration_ms 1115.2644` | 合并仍 57/57 |

V-01 复核后的关键输出（与 §2.1 终态口径一致）：

```
# [V-01] S_init(baseline)=70.71067811865476 首tick S_t=45 prev.S=70.71067811865476 ΔS_abs=-25.710678118654755 ΔS(分解量)=0 abs(ΔS_abs−ΔS)=25.710678118654755 （口径已裁定·选A：首tick ΔS=0 为预期教学占位，非归因失真）
# [V-01] 首tick S_t 是否等于 S_init: false （裁定 2：首tick S_t 照公式计算，不钉在 S_init）
# [V-01] 第2tick S_t=64.72631222062981 ΔS_abs=19.726312220629808 ΔS(分解量)=19.726312220629797 abs(ΔS_abs−ΔS)=1.0658141036401503e-14 （口径已裁定·选A：耦合项 100·ΔM·ΔP；本场景 ΔP=0）
```

---

## 2. 十条边缘路径逐条结论

判定档：`PASS` / `CONCERNS` / `FAIL` / `BLOCKED` / `局限说明`。用例实现见 `tests/verification/edge-cases.test.ts` 对应 `V-xx` 段。

| # | 边缘路径 | 判定 | 关键实测证据与结论 |
| --- | --- | --- | --- |
| ① | 冷启动首 tick → 第 2 tick 归因链衔接与 `ΔS` / `ΔS_abs` 口径 | **PASS**（口径已裁定·选 A / 确认实现） | **终态口径**：共享符号 `ΔS` = 归因分解量 `Snapshot.dS`；`S` 的绝对变化由 tick 的 Delta 条目 `S: prev → current` 承载，GDD 用局部记号 `ΔS_abs` 指代；`AC-F2` 的 `abs(...) ≤ 1` 分只约束分解式内部，**不要求** `ΔS = S_t − S_{t−1}`。实测：首 tick `dS=0`、`dSByFactor` 全 0、`dSPenalty=0`、归因恰 1 条且 `causeType='教学'`、`commandTrace=['v1']`——**裁定 2 确认此为预期行为，不是归因失真**；`S_init(baseline)=70.7107`、首 tick `S_t=45`（照公式计算，不钉在 `S_init`）、`ΔS_abs=−25.7107`、`ΔS=0`、`abs(ΔS_abs−ΔS)=25.7107 分`（该差值源于首 tick 教学占位强制 `ΔS=0`，**非** `100·ΔM·ΔP` 耦合项，按裁定不判 FAIL）。第 2 tick：`P0` 帧推进使 `prev.S === 首 tick current.S`（45）且四因子逐值衔接；`dS === clamp(ΣdSByFactor + dSPenalty, -100, 100)` 成立（分解式内部自洽，AC-F2 满足）；出现非教学型归因；`ΔS_abs=19.7263`、`ΔS=19.7263`、`abs(ΔS_abs−ΔS)=1.07e-14`（本场景 `L` 跨帧不变 → `ΔP=0` → 耦合项为 0，与裁定 1 推导一致，见 §2.1）。另注：实现者 `tests/unit/traffic-attribution.test.ts` 的 AC-F2 断言是 `cur.dS` 自比 `ΣdSByFactor+dSPenalty`（同一公式两侧，自证式），未与 `S_t − S_{t−1}` 交叉；本套件 V-01 补上了该交叉观测，且按 R-N3 采用 `abs(...)` 数值写法，判定强度不变。 |
| ② | 32×32 满网格触达 `maxBlocks=64` 的块合并 / 截断 | **PASS**（附 S3 `D-02`） | 棋盘交错 512 个互不 4-邻接的 R 格 → 实际 `blocks=64`、`population=64`（全量应为 `512`）、`T_c=0`、`unreachable=false`；`runTick` 事件类型集合仅 `TickCommitted`，**无任何超限告警事件**（`SimEventType` 本身无此类）。对照组：全 1024 格连成 1 块 → `blocks=1`、`population=1024` 不截断（按「块数」而非「格数」截断）；`maxBlocks=4` → `blocks=4`、`population=4`，行为可配置复现。**结论：超限时是「静默丢弃剩余连通块」，非「合并」**，无标记、无事件、无拒绝。已登记 S3（§6 `D-02`）；本轮 `src/simulation/traffic.ts` 文件头明示为 S-04 前的占位实现，故不据此判 W1/W2 已实现部分 FAIL。 |
| ③ | 路网断开 → 重连「不可达 ↔ 可达」切换与 D2 拥堵负反馈传导 | **PASS** | 连通 A：`T_c=6.3`、`unreachable=false`；断开 B（缺 `(5,3)` 路格）：`unreachable=true`、`T_c=T_max=30`（非 `Infinity`/`NaN`）；重连 C：`T_c` 回落至 `6.3` 且与 A 逐值一致（确定性）。高需求 D（4 个 R 格）：`T_c=7.2 ≥ 6.3`（`design/gdd/systems/03-traffic-commute.md` §7 AC-T1 / §3.3 D2 单调不减）。完整 `P0~P8` 传导：`f_c` A=`0.8172` → B=`0` → D=`0.7862`；`f_s` A=`0.9475` → D=`0.94`（不升）；`S` A=`64.726` → B=`44.398`（断开拉低）→ D=`64.210`（不升）。**负反馈闭环成立，且只经 `S` 单一计分板传导**（GDD 03 §3.3 / GDD 01 P1）。 |
| ④ | 分母退化组合 `P_t=0` / `J_t=0` / `cap=0` / `E_max=0` / `T_max=T_0` / `Σw_g=0` | **PASS**（附 S4 `D-05`） | 6 个单一组合 + 1 个全组合（`cap=0, E_max=0, T_max=T_0=1, Σw=0, i_ref=0, f_floor=0`）全部通过健壮性不变量：无 `NaN`/`Infinity`、`S ∈ [0,100]`、四因子与 `dS/dSByFactor/dSPenalty/L/T_c/E/B/I_t` 全有限、`delta` 与归因数值有限。`Σw=0` 组合 `S=0`；`T_max=T_0` 组合 `f_c=1`（`safeDiv` 分母兜底生效）；`cap=0` 组合 `qoc=0`、`congestion=1`、`T_c=6`。补充：`λ=0.3`（GDD 01 §4.2 上界）下归因链残差 `≤1` 分成立。**λ=1 越界注入（仅健壮性探测，非平衡结论）在本构造下 `dSPenalty=0 / dS=0 / 残差=0`，未触发数值异常，如实记录**；同时如实记录「`createDefaultConfig` 不校验 GDD 规定的参数取值范围」为 S4 观察项（§6 `D-05`）。 |
| ⑤ | 同 tick 内相同幂等键不同 payload、多命令顺序敏感性 | **PASS**（附 S3 `D-03`） | `createCommandQueue`：同 key 不同 payload 第 2 条 `enqueue` 返回 `false`、`drain()` 仅 1 条；`createSimulation.submit` 同样只入队 1 条。**`runTick` 层不校验幂等**：直接传 `[cmdA(same,R), cmdB(same,C)]` → 两条都应用、后者覆盖（`zone=C, density=3`）、`inputVersion=2`、`commandTrace=['same','same']`。顺序敏感：`zone(R,2)→density(3)` 终态 `density=3`，`density(3)→zone(R,2)` 终态 `density=2`，两者 `canonicalize` 不同；但**同一顺序重复运行逐字节一致**（顺序敏感 ≠ 不确定性）。`advanceRenderFrames(st,10000)` 返回同一引用且状态不变。**分层契约缺口已登记 S3（§6 `D-03`）**。 |
| ⑥ | `configHash` 变更后旧快照的显式迁移 / 拒绝载入（S-10 前置） | **CONCERNS**（能力 PASS / 挂接待办，附 **S1** `D-01`，主理人裁定升格） | `assertConfigCompatible(oldState, newConfig)` 正确抛 `ConfigMismatchError('configHash mismatch; explicit migration required')`；`computeConfigHash` 随权重变化升级。**但**：`deserializeState(raw, _config)` 的 `_config` 形参被忽略，旧快照被静默载入且保留旧 hash `281f0b95c67f031c`；`runTick(loaded, ..., configB, ...)` 与 `createSimulation(configB, loaded)` 均不抛错。同一起点用旧 / 新配置结算 `S_t = 45 → 32.4`，证明**新公式静默续算成立**。静态扫描 `src/**/*.ts` 中 `assertConfigCompatible(` 出现 **1 次 = 仅定义处，调用点 0 个**（`src/core/config.ts:196`）。**处理**：能力齐备且实现者 `tests/unit/schema-config.test.ts` 已验其抛错；自动挂接属 `production/epics/epic-breakdown.md` §4 S-10 载入路径（本轮未开工）。**主理人已按 `SM-W1-02` 失败即停规则字面把 `D-01` 升 S1**（不放宽该行规则、不以「S-10 以后会修」豁免当前缺口），W1 出口门据此改判 FAIL；详见 §5 `D-01`。本条边缘路径的观测数据不变。 |
| ⑦ | 连续多周期未达标 + 达标解锁互斥不同帧（GDD 04 E7） | **PASS（部分）/ BLOCKED（回退侧）** | 未达标侧（`K=2, S_unlock=99`）：3 个周期 `outcome` 全 `RETRY_AVAILABLE`，`unlockedRegions=1,1,1`，`tickId=6` 仍可推进、`cycleId=3`，**无硬终局**（`design/gdd/systems/01-satisfaction-simulation.md` §7 AC-F5 / `production/epics/epic-breakdown.md` §4 S-03 验收 5）。达标侧（`S_unlock=0`）：3 个周期全 `TARGET_MET`，`unlockedRegions=2,3,4`；单 tick 只取一个 `cycleOutcome` 枚举值，非周期末恒为 `IN_CYCLE`，**解锁增量与 `TARGET_MET` 帧一一对应（互斥）**。如实记录「每达标周期 +1」属 `src/README.md` §6 已知限制 3 的 P7 占位（`cells.unlocked` 未改写，实际形状属 S-11 / `design/gdd/systems/02-map-zoning.md` §8.1 O-2）。**GDD 04 §6.1 E7 的「回退与解锁互斥」回退半侧属 `SM-W4-05` / S-11，本轮无回退路径 → BLOCKED，未验证，不臆造结论。** |
| ⑧ | `f_f` 饱和边界与短板惩罚 `L` 触边 | **PASS** | `L` 触边：`min(f)=0 → L=1`、`min(f)=0.9 ≥ f_floor → L=0`；`L=1` 时 `S=64.036` 仍 ∈[0,100]。`f_floor=0` 分母退化走 `safeDiv` 兜底 → `L=0`、无 `NaN`。`f_f` 饱和：`I_f_lagged=1e9` → `f_f=1`、`S=67.5` 未越 100；`I_f_lagged=0` → `f_f=0`、`S=45`。`S` 触下边 0 时 `dS` 仍钳制在 `[-100,100]`（`design/gdd/systems/01-satisfaction-simulation.md` §6.1 E4）。 |
| ⑨ | 跨进程 / 不同浮点累加顺序的一致性 | **PASS（本机同引擎）/ BLOCKED（跨引擎，局限说明）** | 本机 `node v22.22.2 / win32 / x64`：进程内基准 + 两个**完全独立**子进程各跑 8 tick 序列，三者 `canonicalize(serializeState(s))` 长度均 **10875 字节且逐字节相等**。可验证的「累加顺序」部分：最终网格相同但命令到达顺序不同（升/降序）时，块合并按 cell index 升序遍历 → `solveTraffic` 结果 `canonicalize` 逐字节一致（**累加顺序由网格索引决定，与命令顺序无关**）。**局限（如实声明）**：本机仅 Node v22.22.2 单引擎、单架构，无 Cocos Creator 3.x / HarmonyOS ArkTS / 其它 JS 引擎与机型矩阵，**无法构造跨引擎 / 跨架构浮点累加等价对照**；`docs/architecture/adr/ADR-002-simulation-loop-and-snapshot.md` §2 子决策 2 / §6 R-1 的跨平台漂移约束本轮**不做结论、不编造**。 |
| ⑩ | 替换 `TickOptions.solver` 后 P3/P4 仍确定性、`T_c` 单调性不回退 | **PASS** | 注入自定义 solver（返回 `T_c=5, population=10, serviceWeightedAccess=7.5, serviceWeightTotal=10`）：两次独立 workspace 的 `snapTick` 逐字节相等；`P3 note='reused:P2.traffic serviceWeightedAccess'`、`P2 note='traffic graph; blocks=1; T_c=5'`；`f_s=0.75`、`cur.T_c=5`（注入值未被改写）。注入 `T_c=[0,5,15,30]`：`f_c=[1.0000, 0.8621, 0.5172, 0.0000]` 单调不增、`S=[64.4856, 62.8763, 58.1675, 41.9856]` 不升、`T_c` 输出逐值等于注入值**不回退**。同时替换 `aggregator` 双注入仍确定（`S=50, L=0`）；默认 `NOOP_ATTRIBUTION_RECORDER.count=0`（S-05 占位）。**首次运行 V-10 FAIL 的过程与根因见 §1.2，为 QA 侧 stub 字段笔误，已修正并保留记录。** |

### 2.1 口径裁定（T-113 · 选 A / 确认实现）与本轮实测核对

> 来源：主理人 2026-11-05 中转的 design-strategist T-113 裁定结论。**本节为口径同步，不是新任务**；T-114 原 spec 的 10 条边缘路径 / 静态扫描 / 冒烟门 / 缺陷登记范围不变，本报告不缩减、不扩项。
>
> **口径裁定依据**：`production/reviews/phase5-design-review.md`（T-113 设计评审回执）与 `design/gdd/systems/01-satisfaction-simulation.md` §3.2 / §4.3 / §6.1 E1 / §7 AC-F2（GDD 01 回改 7 处已落盘，保持 v1.0 + 注记、不升版）。

**裁定 1（选 A）· `ΔS` 双重定义**
- 根因不是实现缺陷，而是 `design/gdd/systems/01-satisfaction-simulation.md` 内 `ΔS` 被双重定义：§3.2 快照字段原写 `dS // ΔS = S_t − S_{t−1}`（绝对差口径），§4.3 又写 `ΔS = clamp(ΣΔS_i + ΔS_penalty)`（归因分解口径）。
- 推导：令 `M_t = Σ_i w_i g(f_{i,t})`、`P_t = 1 − λ L_t`，则 `S_t = 100·M_t·P_t`（钳制前），二者之差恒为二阶交叉项 **`ΔS_abs − ΔS = 100·ΔM·ΔP`**；设计侧用占位参数试算 ≈ **+2.07 分**，与实现侧报的 2~4 分同量级，推导与实测吻合。
- **终态口径**：① 共享符号 `ΔS` 的实现取值收敛为**归因分解量 `Snapshot.dS`**；② `S` 的绝对变化由 tick 的 Delta 条目 `S: prev → current` 承载，GDD 用**局部记号 `ΔS_abs`** 指代，刻意不新增共享符号、不改只读的 `design/gdd/systems-index.md` §4.2；③ **`AC-F2` 的 `abs(...) ≤ 1` 分只约束分解式内部，不要求 `ΔS = S_t − S_{t−1}`**；④ 钳制生效按 `01` §6.1 E4 标注，不判归因失真；⑤ 新增下游约束：`abs(ΔS_abs − ΔS) > 1` 时 05 / UX 须披露耦合项（**S-05 / S-09 落地**，防反馈黑箱）。**本裁定不调整任何占位参数。**
- 排除 B（把 `abs(100·ΔM·ΔP)` 压到 ≤1 分）：需 `λ ≤ 0.01`，而 `λ` / `f_floor` 是平衡期占位数值，用设计裁定钉死既越权、又让短板惩罚失去意义、还要求实现返工。排除 C（精确可加分解）：会引入无法绑定到具体因子的耦合项，与 AC2「≥1 条具体原因」和 P4 冲突。

**裁定 2 · 确认实现侧处理**：首 tick `S_t` **照公式计算**、`ΔS = 0`、`dSByFactor` 全 0、只给一条教学占位归因、不生成归因型议题；第 2 tick 起正常出归因。E1 原文「以空城基线构造 `f_i = f_init`、`S_{−1} = S_init`」本意是 t−1 帧基线，措辞含糊易被读成「`S_t` 也被钉在 `S_init`」，已回改。对 AC1 更有利（首 tick 就能看到投入 → `S` 变化），对 AC2 不破坏（首 tick `ΔS = 0`，「任一 `ΔS ≠ 0`」前提不成立；`ΔS_abs ≠ 0` 不是 AC2 所指的 `ΔS`），并保住 `tests/unit/d6-no-end.test.ts` 的 D6-3 验收。

**本轮实测与裁定的核对（QA 独立复核）**

| 观测点 | 本轮实测 | 按终态口径的解读 |
| --- | --- | --- |
| 首 tick `S_t` | `45`，`S_init(baseline)=70.7107`，二者不等 | 裁定 2 **确认实现**：`S_t` 照公式计算，不钉在 `S_init` → **PASS，不判 FAIL** |
| 首 tick `ΔS` / 归因 | `dS=0`、`dSByFactor` 全 0、`dSPenalty=0`、仅 1 条 `causeType='教学'` | 裁定 2 **确认为预期教学占位** → PASS |
| 首 tick `abs(ΔS_abs − ΔS)` | `25.7107 分`（`ΔS_abs=−25.7107`、`ΔS=0`） | **不是** `100·ΔM·ΔP` 耦合项，而是「首 tick 强制 `ΔS=0`」所致；裁定 1 ③ 明确 `abs(...) ≤ 1` 只约束分解式内部、不要求两口径相等 → **不判归因失真、不判 FAIL** |
| 第 2 tick `abs(ΔS_abs − ΔS)` | `1.07e-14`（`ΔS_abs=19.7263`、`ΔS=19.7263`） | 本场景首 tick 与第 2 tick 的 `L` 均为 1（`min factor` 恒为 0，`f_f=0`）→ `ΔP = −λ(L_t−L_{t−1}) = 0` → 耦合项 `100·ΔM·ΔP = 0`，**与裁定 1 推导一致**；与设计侧「占位参数试算 ≈ +2.07 分」不矛盾（后者对应 `L` 跨帧变化的场景） |
| 分解式内部自洽 | `dS === clamp(ΣdSByFactor + dSPenalty, -100, 100)` | `AC-F2` 的 `abs(...) ≤ 1` 分约束对象是分解式内部 → **满足** |

- **如实声明局限**：本轮 V-01 / V-08 的构造中 `L` 未跨帧变化（`ΔP=0`），**未独立触发并测量 `100·ΔM·ΔP ≈ +2.07 分` 这一分支**；裁定给出的量级来自设计侧占位参数试算，本轮不做「已验证」声称。裁定 1 ⑤ 的下游披露约束须在 **S-05 / S-09** 落地，建议届时补一条「`L` 跨帧变化」的独立回归用例并登记进 `tests/traceability-matrix.md`；**T-114 范围不变，本轮不擅自新增用例**（保持 12 条独立用例）。
- **R-N3 知会**：`AC-F2` 的 `abs(...)` 写法（避免 Markdown 表格分隔符歧义）**判定强度不变**；本套件 V-01 的 `assert.equal(c2.dS, clamp(sum,-100,100))` 是数值比较、非字符串扫描，`tests/unit/traffic-attribution.test.ts` L135 亦不受影响。本报告相关公式已统一采用 `abs(...)`。
- **零返工结论（主理人中转）**：45 条单测无一条受影响，engineering-lead **无需改任何代码**；`src/README.md` §6 已知限制 4 已与新口径一致，无需改。GDD 01 回改 6 个口径章节 / 7 处（L8 头部状态、L71–72 §3.2 `dS` 注释、L83 §3.2 新增「ΔS 取值口径」段、L145–162 §4.3 双口径定义表与推导、L185 §6.1 E1 并删去「建议 0.5」具体数值改为占位、L208 §7 AC-F2、L246 文末状态），**保持 v1.0 + 注记、不升版**（下游 `systems-index.md` §5、`production/sprint-01.md` §1.1、`design/ux/ux-spec.md` 均引用 v1.0）。
- 设计侧评审判定为 **CONCERNS（非阻塞）**：P1/P2/P3 无漂移、P4 仅「结构上未违背」（本轮无 UI）、范围无蔓延、占位数值纪律通过；AC1/AC3/AC4 按纪律不判 PASS，AC2 仅数据层 PASS。**该判定属设计侧，不与本报告的 QA 出口门判定混同；口径裁定本身不改变 W1 / W2 出口门结论**（W1 由 `CONCERNS` 改判 `FAIL` 系 `D-01` 升 S1 所致，与 T-113 无关，见 §4.1 / §5）。

---

## 3. 静态检查结论（实际扫描命令与命中）

### 3.1 扫描方式（两条独立路径交叉验证）

1. **内嵌静态用例（真实随套件执行）**：`V-STATIC` 用例，命令即 `node --experimental-strip-types --test tests/verification/edge-cases.test.ts`。做法：遍历 `src/core/*.ts` + `src/simulation/*.ts` + `src/index.ts`（共 9 个 `.ts`），先 `stripNonCode()` 去掉块注释 / 行注释 / 字符串字面量，再对 `config.ts` 单独剔除 `PLACEHOLDER_DEFAULTS` 定义块，最后跑 8 类正则。**去注释/去字符串是关键**：否则中文否定式注释（`src/core/types.ts:5`「倍速自动播放、硬终局分支」、`src/simulation/commands.ts:6`「首版无倍速、无自动播放、无倒计时条」、`src/simulation/tick-pipeline.ts:11`「无硬终局」）与版本号字符串 `'HC01-CORE-0.1.0'` 会造成误报。
2. **Grep 工具独立扫描**：对 `src/` 全目录（含 `src/README.md`）逐组跑正则，作为交叉复核。

### 3.2 扫描模式与命中结论

| # | 检查项 | 实际正则（要点） | `src/**/*.ts` 可执行代码命中 | 全目录（含 README）命中 |
| --- | --- | --- | --- | --- |
| 1 | 墙上时钟 / 原生随机 / 性能计时 | `Date\.now\|new Date\(\|Math\.random\|performance\.now\|process\.hrtime` | **0** | 1 处：`src/README.md:105` 说明文字「无 `Date.now` / `Math.random`」，非代码 |
| 2 | Cocos / HarmonyOS / ArkUI / `node:` 平台或渲染 import | `from ['"](cocos\|@ohos\|@harmony\|harmony\|arkui\|three\|pixi\|node:)` | **0** | 0 |
| 3 | 纯半径叠 buff / 欧氏 / 传送式服务 | `euclidean\|Math\.hypot\|radius\|半径\|传送式\|teleport\|欧氏` | **0** | 0 |
| 4 | 逐格 OD 矩阵 | `odMatrix\|OD_MATRIX\|1024\s*\*\s*1024\|side\s*\*\s*side\s*\*\s*side` | **0** | 0 |
| 5 | `GAME_OVER` / 判负 / 失败终局 / `defeat` | 同上 + `判负\|失败终局\|硬终局` | **0** | **4 行 / 3 文件**（`src/README.md` 2 行、`src/core/types.ts:5`、`src/simulation/tick-pipeline.ts:11`），均为**否定式注释 / 说明文字**，非代码分支 |
| 6 | 倍速 `×1×2×4` / 自动播放 / 倒计时 / 帧定时器 | `autoPlay\|autoplay\|setInterval\|setTimeout\|countdown\|requestAnimationFrame\|×1\|×2\|×4\|倍速\|自动播放\|倒计时` | **0** | **8 行 / 3 文件**（`src/README.md` 3 行、`src/core/types.ts` 4 行、`src/simulation/commands.ts` 1 行）；其中 `types.ts:18/66/238` 是网格尺寸 `16×16` / `32×32` / `FNV-1a 32×2` 被 `×1\|×2` 正则**误命中**，其余为「首版无倍速」等否定式描述，均非实现 |
| 7 | 硬编码平衡期数值 | 剔除 `PLACEHOLDER_DEFAULTS` 后扫 `0.25\|0.3\|0.1\|0.05\|0.5\|1.8\|2.4\|1e-9` | **0** | — |
| 8 | 非占位块剩余数字字面量集合 | 数字字面量全量提取 | 实测集合 `0, 1, 2, 3, 4, 8, 16, 32, 64, 100, 128` | 均为结构性常量（因子数 4、网格 32/16、块上限 64、池 128、分制 100 等），非平衡结论 |

**结论**：8 类静态纪律在 `src/**/*.ts` 可执行代码中**全部 0 命中**；全部平衡期数值集中在 `src/core/config.ts` 的 `PLACEHOLDER_DEFAULTS` 且带 `meta.kind='PLACEHOLDER' / pinnedAt=null`（`tests/unit/placeholders.test.ts` 与 V-00 交叉确认）。**未编造任何具体平衡数值，未把占位值当作定稿结论。**

### 3.3 额外静态事实（契约与可维护性）

| 项 | 实际扫描 | 命中与结论 |
| --- | --- | --- |
| `assertConfigCompatible` 调用点 | `assertConfigCompatible\s*\(` 全 `src/**/*.ts` | **1 次 = 仅 `src/core/config.ts:196` 定义处，调用点 0 个** → §6 `D-01` |
| `MAX_BLOCKS` | `MAX_BLOCKS` 全 `src/**/*.ts` | **1 次 = `src/core/types.ts:32` 定义**，未被引用；`src/simulation/traffic.ts:58/201` 实际生效的是 `config.maxBlocks`（占位默认 64）→ 结构性常量与占位值并存，非缺陷但需 S-04 留意 |
| 字段名对称性 | `serviceWeight` 全 `src/` | `serviceWeightedAccess`（有 "ed"）与 `serviceWeightTotal`（无 "ed"）**不对称**；实现内部自洽（默认路径 `f_s=0.95` 正常），但注入式 solver 易写错 → §6 `D-04` |
| 网格上限 | `V-STATIC` 末段 | `createInitialState(config,{side:33})` 抛 `GridLimitExceededError`；`side:32` 通过（`design/gdd/systems/02-map-zoning.md` §3.1 / `production/epics/epic-breakdown.md` §4 S-02 验收 4） |

### 3.4 实现侧「未做」边界核实（主理人指定核实项）

| 冒烟项 | 实际扫描（`src/`） | 核实结论 |
| --- | --- | --- |
| `SM-W1-04`（真机生命周期） | `onForeground\|onBackground\|onSurface\|XComponent\|PlatformAdapter\|ISaveStorage\|surface\|HAP\|NAPI\|折叠态` | `src/**/*.ts` **0 命中**；仅 `src/README.md:134` 一句「S-01 真机 HAP 工程链路、NAPI/XComponent、`PlatformAdapter` 六个接口（本轮零平台依赖，未建任何工程）」。`engineVersion` 仅作为 `CityState` / `TickSnapshot` 字段存在（`src/core/schema.ts:123` / `src/simulation/snapshot.ts:40`），无存档头落盘实现 → **属 S-01，本轮未做，声明属实** |
| `SM-W2-05`（快照自包含 + 冷归档 ≥3 周期） | `SnapshotStore\|getCycleRange\|Keyframe\|冷归档\|archive\|checksum` | `src/simulation/snapshot.ts:58-62` 的 `SnapshotStore` **仅为 interface**（`put/get/getCycleRange` 三个签名），无任何实现；`src/README.md:147/148` 明确「未实现」「`runTick` 当前只在内存产出等价数据，不落盘」 → **属 S-05，本轮仅接口占位，声明属实** |
| `SM-W2-06`（32×32 满网格 p95 实测） | `p95\|percentile\|benchmark\|耗时\|profile\|performance\.\|hrtime\|calibrat` | `src/**/*.ts` **0 命中**；仅 `src/README.md:135`「S-04 通勤求解性能基准（p95 ≤16ms 只作建议基线，本轮未测、未冻结）」与 `:149`「S-04 可在此挂接耗时 / 分配采样钩子」 → **属 S-04，本轮未测，声明属实** |

> 补充核实：`SM-W1-03` 的「Tab / 图案表由配置生成」与 `SM-W2-04` 的「按钮进入结算中禁用态」属 UI 层（S-08 / S-07），本轮零 UI，判**不适用**；其数据层 / 逻辑层子项均已覆盖（见 §4）。

---

## 4. W1 / W2 冒烟门逐条判定

判定口径：`tests/smoke-checklist.md` §0.1（失败即停 / 出口门）、§2（W1）、§3（W2）；`tests/test-strategy.md` §5.2 / §5.3 / §6。区分三态：**本轮已覆盖且可执行** / **属 S-01/S-04/S-05/S-07/S-08/S-11，本轮未做** / **不适用**。

### 4.1 W1 · 基础层（S-01 → S-02）

| 编号 | 分类 | 判定 | 依据 |
| --- | --- | --- | --- |
| `SM-W1-01` | 本轮已覆盖且可执行 | **PASS** | 32×32 序列化回环、16×16 起步、`>32×32` 显式拒绝（`tests/unit/schema-config.test.ts` S-02-1/4 + V-STATIC）；数据层零引擎 / 零平台依赖静态 0 命中 |
| `SM-W1-02` | 本轮已覆盖且可执行 | **FAIL**（主理人裁定升 S1） | 「公式 / 权重只从配置注入」PASS（V-STATIC 平衡小数 0 命中）、「`configHash` 升级」PASS（V-06 `computeConfigHash` 不同）；**「旧快照不静默续算」未强制挂接**（V-06 + 静态 0 调用点，§5 `D-01`），`deserializeState` 忽略 `_config`、同起点旧/新 config 结算 `S_t` 45→32.4，**静默续算成立**。主理人按 `tests/smoke-checklist.md` L62 该行失败即停规则字面「静默续算 → 停 W1，开 S1」与 `docs/architecture/adr/ADR-003-save-data-and-attribution.md`「无静默续算」，**不放宽该行规则、不以「S-10 以后会修」豁免当前缺口**，`D-01` 升 S1，本项判 FAIL，W1 出口门据此改判 FAIL |
| `SM-W1-03` | 部分覆盖 + 部分不适用 | **PASS（数据层）/ 不适用（UI）** | 「增 / 减分区不改数据层与加载层代码」PASS（`tests/unit/schema-config.test.ts` S-02-3 覆盖 3/4/2 类）；「Tab / 图案表由配置生成」属 S-08 UI，本轮零 UI → 不适用 |
| `SM-W1-04` | **属 S-01，本轮未做** | **BLOCKED（未执行）** | §3.4 静态核实：真机生命周期 / XComponent / PlatformAdapter / surface 全部 0 命中；无 HAP、无真机，不可执行 |

**W1 出口门判定：`FAIL`**（T-115 收口：由 `CONCERNS` 改判）
- 已完成且可执行的 `SM-W1-01` / `SM-W1-03`（数据层）全部 PASS；
- 阻塞项：① `SM-W1-04` 未执行（**BLOCKED**：S-01 真机生命周期，需真机 HAP 与 `engineVersion` 存档头）；② `D-01`（**已升 S1**）：`SM-W1-02` 静默续算命中该行失败即停规则字面，主理人裁定不放宽、不豁免；③ **GDD 01 两处口径已由 T-113 裁定关闭（选 A / 确认实现）**，`AC-F2` 判定已闭合、实现侧解读正确、零返工，**不再列为阻塞项**（终态口径与实测核对见 §2.1）。
- 按 `tests/test-strategy.md` §5.2「任一冒烟项失败即停 → 出口门 FAIL」：`SM-W1-02` 命中失败即停并开 S1，W1 出口门判 **FAIL**。**该改判的唯一原因是主理人对 `D-01` 的升格裁定，与 T-113 口径裁定无关**；口径裁定本身不改变任何出口门判定。FAIL 即「未达 QA」，advisory 判定，最终是否放行由用户决定。
- **定性**：`D-01` 是**契约缺口（能力已定义但调用点 0）**，不是已实现代码的功能回归；修复方式为把 `assertConfigCompatible` 挂接到 `deserializeState` / `createSimulation`（或 `runTick`）入口并补回归用例，**非重构**（见 §5 `D-01`）。

### 4.2 W2 · 模拟与归因层（S-03 → S-04 / S-05）

| 编号 | 分类 | 判定 | 依据 |
| --- | --- | --- | --- |
| `SM-W2-01` | 本轮已覆盖且可执行 | **PASS** | 45 条基线含 S-03-1 连续 / 跨会话逐字节回放；V-09 补两独立子进程 + 进程内 10875 字节逐字节一致；V-05 顺序确定性 |
| `SM-W2-02` | 本轮已覆盖且可执行 | **PASS** | `advanceRenderFrames` no-op 返回同一引用、`tickId` 不变（`tests/unit/determinism.test.ts` S-03-2 + V-05(f)）；仅 V6 触发一次结算 |
| `SM-W2-03` | 本轮已覆盖且可执行 | **PASS** | P0~P8 顺序、R1~R7 映射、P3 `reused:P2`、无半径分支、P7 无终局分支（`tests/unit/pipeline.test.ts` + `d6-no-end.test.ts` + V-STATIC 6 类 0 命中）；V-10 注入 solver 后 P3 仍 `reused:P2` |
| `SM-W2-04` | 部分覆盖 + 部分不适用 | **PASS（逻辑）/ 不适用（UI）** | 连点 2/5 次只 +1 tick、`TickCommitted=1`、pending 不半应用、结算中 gate 锁（`tests/unit/input-gate.test.ts` 5 条 + V-05）；「按钮进入结算中禁用态」属 S-07 UI → 不适用 |
| `SM-W2-05` | **属 S-05，本轮未做（冷归档）** | **未达** | 快照自包含形状已定义、`runTick` 当帧产出 `Δ` / 归因（V-01、V-03 观测到归因条目）→ 部分 PASS；但 `SnapshotStore` 仅接口、`getCycleRange` 无实现、**冷归档 ≥3 周期未实现**（§3.4 静态核实）。按该行失败即停规则「冷归档不足 3 周期 → 停 W2，开 S1」 |
| `SM-W2-06` | **属 S-04，本轮未做** | **未达** | 32×32 满网格 p95 实测记录未产出（§3.4 静态核实 0 命中）。按该行失败即停规则「未产出实测记录 → 停 W2，开 S2」；**但实测值超出建议基线不得据此判 FAIL**（`tests/smoke-checklist.md` §0.5，p95 ≤16ms 为建议基线 / 非承诺值） |

**W2 出口门判定：`FAIL`（范围性 / advisory）**
- 已实现部分（S-03：`SM-W2-01`~`SM-W2-04` 的可执行子项）**全部 PASS**，确定性 / 边缘健壮性 / 静态纪律无回归；
- 阻塞项：① `SM-W2-05` 冷归档 ≥3 周期未交付（S-05）；② `SM-W2-06` 32×32 满网格 p95 实测记录未产出（S-04）；两条均命中 `tests/smoke-checklist.md` §0.1 失败即停规则；③ `D-01`（**已升 S1**）等契约缺口未关闭（W2 范围性 FAIL 判定不因此改变）。
- **重要定性**：该 FAIL 是**波次范围 / 交付进度未完成**（S-04 / S-05 尚未开工），**不是已实现代码的功能回归失败**；按 `tests/test-strategy.md` §5.2「FAIL 即未达 QA」，advisory 判定，最终是否放行由用户决定。

### 4.3 边界声明核实结论

> 实现侧声明「`SM-W1-04`（W1）、`SM-W2-05` + `SM-W2-06`（W2）未做，W2 出口门不能整体判 PASS」——**三条均经独立静态扫描核实属实，无隐瞒、无夸大**（§3.4）。此外本轮额外识别出 `SM-W1-02` 的「旧快照不静默续算」承诺与落点不一致（`D-01`），以及 `SM-W1-03` / `SM-W2-04` 的 UI 子项不适用，均已登记，未计入 PASS。

---

## 5. 缺陷清单（S1~S4，依 `tests/test-strategy.md` §6）

**S1：1 条（`D-01`，主理人裁定升格）。S2：无。** 共登记 **1 条 S1 + 2 条 S3 + 2 条 S4**。全部为「只报告、不代修」，未修改 `src/` 任何实现文件。**`D-01` 升 S1 的因果**：主理人按 `tests/smoke-checklist.md` L62 `SM-W1-02` 失败即停规则字面「静默续算 → 停 W1，开 S1」与 `docs/architecture/adr/ADR-003-save-data-and-attribution.md`「无静默续算」裁定，**不放宽该行规则、不用「S-10 以后会修」豁免当前缺口**；该升格与 T-113 口径裁定无关，W1 出口门据此由 `CONCERNS` 改判 `FAIL`。

### S1 · Blocker（1 条：**立即停止该波次全部测试**，锁定现场证据，退回实现；修复后须重跑该波次全部冒烟 + 相关回归，**未关闭不得进入下一波次、不得准出**，依 `tests/test-strategy.md` §6）

**`D-01` · `configHash` 变更后旧快照可被静默续算（版本断言未挂接）** — **S1**（主理人裁定由 S3 升格）· 建议归属：S-10 前置 / ADR-002 R-6
- **关联用例 / 冒烟项**：`V-06`、`V-STATIC`；`SM-W1-02`、`SM-W4-03`；`production/epics/epic-breakdown.md` §4 S-02 验收 2 / S-10 验收 3。
- **环境**：Node v22.22.2 / win32-x64 / 零依赖（无真机形态、无构建锁版本）。
- **前置**：用 `createDefaultConfig()` 建 `oldState` 并 `serializeState`；另建 `configB = createDefaultConfig({weights:{...a.weights, f_c:0.11}})`。
- **编号复现步骤**：
  1. 对 `oldWire = JSON.parse(JSON.stringify(serializeState(oldState)))` 调 `deserializeState(oldWire, configB)`；
  2. 观察：不抛错，返回状态 `configHash` 仍为旧值 `281f0b95c67f031c`；
  3. 对返回态调 `runTick(loaded, [], configB, ws)` 或 `createSimulation(configB, loaded)`：不抛错，正常结算；
  4. 对照：`runTick(createInitialState(configA), [], configA, ws)` 得 `S_t=45`，步骤 3 同起点得 `S_t=32.4`；
  5. 静态扫描 `src/**/*.ts` 中 `assertConfigCompatible(` 仅 1 次（定义处），调用点 0。
- **期望行为**：按 `src/README.md` §5 硬约束 7「不匹配即抛 `ConfigMismatchError`，不静默续算」与 `docs/architecture/adr/ADR-002-simulation-loop-and-snapshot.md` §6 R-6 / §7 A8，载入路径应走显式迁移或拒绝载入并保留旧槽。
- **实际行为**：`assertConfigCompatible` 单独调用时行为正确；但 `deserializeState` 忽略 `_config`、`runTick` / `createSimulation` 不调用该断言，形成静默续算路径。
- **影响面**：若 S-05 / S-10 直接复用 `deserializeState` 作为存档载入器，配置 / 公式升级后旧存档会用新公式续算 → 回退 / 回放 / AC2 归因失真（`ADR-002` R-1 / R-6）。
- **分级裁定（主理人 T-115）**：**由 S3 升为 S1**。依据：`tests/smoke-checklist.md` L62 `SM-W1-02` 失败即停规则字面「出现硬编码数值 / `configHash` 未升级 / **静默续算** → 停 W1，开 S1」，且 `docs/architecture/adr/ADR-003-save-data-and-attribution.md`「版本不匹配走显式迁移或拒绝载入，**无静默续算**」是已定架构约束；本轮实测 `assertConfigCompatible` 在 `src/**/*.ts` 调用点 0、`deserializeState` 忽略 `_config`、同起点旧 / 新 config 结算 `S_t` 45→32.4，**静默续算成立**。主理人**不放宽该行规则，也不用「S-10 以后会修」豁免当前缺口**。
- **定性**：**契约缺口——能力已定义但未挂接（调用点 0），不是已实现代码的功能回归**；`assertConfigCompatible` 本身行为正确且实现者单测已验，缺陷在载入 / 结算路径未强制调用。
- **修复方式（不代修，非重构）**：把已有 `assertConfigCompatible` 挂接到 `deserializeState` / `createSimulation`（或 `runTick`）入口，或提供显式 `migrate()` + 保留旧槽；补一条「旧快照 + 新 config 必须抛错」回归用例；修复后按 `tests/test-strategy.md` §6 重跑 W1 全部冒烟 + 相关回归，S1 未关闭不得进入下一波次 / 不得准出。
- **补充建议（不代修）**：在 `src/README.md` 把「不静默续算」限定为「断言能力」而非「全链路已保证」，避免下游误读。
- **关联风险编号**：`AR-002-R6`、`MR-07`（`tests/test-strategy.md` §1.4）。

### S3 · Major（2 条，不阻断准出；须登记 workaround / 关联用例 / 风险编号并进回归清单）

**`D-02` · `maxBlocks` 超限时静默丢弃连通块，无告警 / 无标记** — 建议归属：S-04
- **关联用例 / 冒烟项**：`V-02`；`SM-W2-06`、`SM-W2-03`；`production/epics/epic-breakdown.md` §4 S-04 验收 1；`docs/architecture/adr/ADR-002-simulation-loop-and-snapshot.md` §3 A6。
- **前置 / 步骤**：① `config = createDefaultConfig()`（`maxBlocks=64`）；② 32×32 网格按 `(x+y)%2===0` 铺 512 个互相不 4-邻接的 R 格；③ `solveTraffic` 后读 `blocks / population / unreachable`；④ `runTick` 后读事件类型集合；⑤ 对照组全 1024 格连成 1 块、`maxBlocks=4` 各跑一次。
- **期望行为**：按「分区块合并 B≤64」语义，超限时应至少可观测（事件 / 标记 / 显式拒绝 / 合并到既有块），且 `P_t` / `J_t` 不应无声失真。
- **实际行为**：`blocks=64`、`population=64`（全量 512）、`unreachable=false`、事件集合仅 `TickCommitted`；超限格 `blockId=-2` 直接跳过（`src/simulation/traffic.ts:201-204`）；`maxBlocks=4` 同样静默截断；全连通对照组 `blocks=1 / population=1024` 不截断。
- **影响面**：32×32 满网格是 `SM-W2-06` 的基准场景；人口 / 岗位被低估 → `T_c` / `f_c` / `S_t` 与归因失真。
- **QA 判 S3 的理由**：`src/simulation/traffic.ts` 文件头与 `src/README.md` §6 已明示「S-04 之前的占位实现」，本轮不承诺完整求解；但 S-04 替换求解器前必须关闭。
- **建议（不代修）**：S-04 替换 solver 时给出明确的超限策略与可观测信号；把 V-02 转为回归用例。
- **关联风险编号**：`AR-002-R4`。

**`D-03` · `runTick` 层无幂等校验，幂等仅由 queue / session 层保证（分层契约未文档化）** — 建议归属：S-03 接口契约 / S-05 / S-10
- **关联用例 / 冒烟项**：`V-05`；`SM-W2-04`；`docs/architecture/adr/ADR-002-simulation-loop-and-snapshot.md` §2 子决策 1 / §6 R-2；`production/epics/epic-breakdown.md` §4 S-03 验收 4。
- **步骤**：① 构造 `cmdA = makeCommand.zone('same',1,2,2,'R',1)`、`cmdB = makeCommand.zone('same',2,2,2,'C',3)`；② 直接 `runTick(state, [cmdA, cmdB], config, ws)`；③ 读 `cells.zone/density/inputVersion` 与 `commandTrace`。
- **期望行为**：幂等键在同一结算内全局生效，或至少在 API 契约中明确「幂等由 queue / session 层负责，内核不做二次校验」。
- **实际行为**：两条都应用，后者覆盖（`zone=C, density=3`），`inputVersion=2`，`commandTrace=['same','same']`；`createCommandQueue` 与 `createSimulation.submit` 层去重正确。
- **影响面**：若 S-05 归因回放 / S-10 断点续玩 / 未来 UI 直接构造 `commands[]` 喂 `runTick`，重复 key 会被双应用。当前所有已实现入口（session）行为正确。
- **建议（不代修）**：补 API 契约文档，或在 P0 增加 key 去重 / 拒绝；V-05 转为回归用例。
- **关联风险编号**：`AR-002-R2`。

### S4 · Minor（2 条，登记待修，不单独触发回归）

**`D-04` · `TrafficResult` 字段命名不对称，注入式 solver 易写错**
- `src/simulation/traffic.ts:30-31` 为 `serviceWeightedAccess`（有 "ed"）与 `serviceWeightTotal`（无 "ed"）；`src/simulation/tick-pipeline.ts:293` 读的是后者。**实现内部自洽、功能正确**（默认路径实测 `f_s=0.95`）。
- 但本次独立验证 V-10 首轮即因 stub 误写 `serviceWeightedTotal` 而 FAIL（§1.2），证明 `TickOptions.solver`（S-04 的官方替换点）存在实际误用风险。
- **建议**：S-04 替换 solver 时统一命名，或在 `TrafficResult` 上加注释 / 类型守卫；不判 FAIL。

**`D-05` · `createDefaultConfig` 不校验 GDD 规定的参数取值范围**
- GDD 01 §4.2 规定 `λ ∈ [0,0.3]`、`w_i ≤ 0.5` 且 `Σw_i=1`；`src/core/config.ts` 的 `createDefaultConfig` 允许注入任意数值（本次 λ=1 越界注入成功，本构造下未触发数值异常，如实记录）。
- 本轮占位阶段可接受；**建议** S-12 钉定数值前补范围断言 / 配置校验，避免平衡期误注入。**不作平衡结论、不据此判 FAIL**。

### 5.1 明确「不作为缺陷」的观察项（避免误判）

| 项 | 处理 |
| --- | --- |
| GDD 01 §3.2 / §4.3 的 `ΔS` 双重定义（首 tick 实测 `S_init=70.7107 / S_t=45 / ΔS_abs=−25.7107 / ΔS=0`，`abs(ΔS_abs − ΔS)=25.7107 分`，**数据逐字保留**） | **T-113 已裁定关闭（选 A / 确认实现），`AC-F2` 判定已闭合**：共享 `ΔS` 收敛为 `Snapshot.dS` 分解量；`S` 绝对变化用局部记号 `ΔS_abs` 由 Delta 条目承载；`AC-F2` 的 `abs(...) ≤ 1` 分只约束分解式内部，**两口径本就不要求数值恒等**。**按裁定 1 属预期行为，不是缺陷、不是待裁定**；实现侧解读正确、零返工，不判实现 FAIL；推导与实测核对见 §2.1 |
| GDD 01 §6.1 E1 首 tick `S_t` 是否强制等于 `S_init`（实测 `45 ≠ 70.7107`） | **T-113 已确认实现侧处理**：首 tick `S_t` 照算、`ΔS=0`、教学占位归因，第 2 tick 起正常出归因；**`S_t ≠ S_init` 为预期**，`ΔS_abs ≠ 0` 不是 AC2 所指的 `ΔS`。**不判 FAIL**，见 §2.1 |
| P7 连续达标每周期 `unlockedRegions++`（实测 2,3,4）、`cells.unlocked` 未改写 | `src/README.md` §6 已知限制 3 明示为占位；实际解锁形状属 S-11 / `design/gdd/systems/02-map-zoning.md` §8.1 O-2；`SM-W4-05`「重复解锁」判定留 S-11，本轮不判 |
| GDD 04 §6.1 E7「回退与解锁互斥」回退半侧 | 属 S-11，本轮无回退路径 → **BLOCKED / 未验证**，不臆造对照态 |
| 跨引擎 / 跨架构浮点累加一致性 | 本机仅 Node v22.22.2 单引擎 → **局限说明 / 未验证**，不编造结论 |
| `MAX_BLOCKS` 结构性常量定义但未引用 | 实现自洽（实际生效 `config.maxBlocks=64`），非缺陷，S-04 留意即可 |
| 中文注释中的否定式描述（「无倍速」「无硬终局」等）与 `src/README.md` 的描述性字面 | 去注释 / 去字符串后 0 命中，非代码实现 |

---

## 6. 给主理人的准出建议（advisory）

### 6.1 对「能否进入 W3」的建议：**不建议无条件进入 W3**

依据：`tests/smoke-checklist.md` §0.1 失败即停规则、§2 W1 出口门（L62 `SM-W1-02`）、§3 W2 出口门；`tests/test-strategy.md` §5.2 / §5.3 / §6；`tests/quality-closure.md` §4；`docs/architecture/adr/ADR-003-save-data-and-attribution.md`。**W1 出口门判 FAIL**（`D-01` 升 S1 命中失败即停）、**W2 出口门判 FAIL（范围性）**，冒烟链存在未执行项与未关闭 S1 / S3 契约缺口。**W1 改判 FAIL 系主理人对 `D-01` 的升格裁定，与 T-113 口径裁定无关**；按 `tests/test-strategy.md` §5.3 准出判定档位「存在未关闭 S1/S2 → FAIL」，准出层同步为 FAIL 建议。

**建议先收敛以下 5 项，再重新执行 W1/W2 出口门：**

1. **关闭 `SM-W2-05`（S-05）**：交付 `SnapshotStore` 的 Keyframe + Delta + 冷归档 ≥3 周期实现，或由主理人 / 用户出具**书面范围豁免**并把该冒烟项顺延到 W4；
2. **关闭 `SM-W2-06`（S-04）**：产出 32×32 满网格单次结算 p95 实测记录并写入校准输入；记录中标注「**建议基线 / 非承诺值**」，**不得预先冻结为硬指标**（`tests/smoke-checklist.md` §0.5、`tests/test-strategy.md` §4.4）；
3. **关闭 `SM-W1-04`（S-01）**：真机 HAP 生命周期（`onForeground/onBackground`、surface 销毁重建、折叠态切换、`engineVersion` 写存档头）验证，或书面确认 W1 边界豁免；**K-1~K-5 不得在真机跑通前凭猜测回填**（`tests/smoke-checklist.md` `SM-W0-01`、`tests/quality-closure.md` §2 O-8）；
4. **修复 `D-01`（已升 S1，最高优先）**：主理人已按 `SM-W1-02` 字面规则裁定升 S1、W1 出口门改判 FAIL。须把 `assertConfigCompatible` 挂接到 `deserializeState` / `createSimulation`（或 `runTick`）入口并补一条「旧快照 + 新 config 必须抛错」回归用例（**非重构**）；修复后按 `tests/test-strategy.md` §6 重跑 W1 全部冒烟 + 相关回归，**S1 未关闭不得进入下一波次、不得准出**；
5. **口径已裁定关闭，转入下游落地**：GDD 01 两处口径已由 T-113（选 A / 确认实现）裁定关闭，**无需再等设计侧结论、无需 engineering-lead 返工**，`AC-F2` 判据已收敛为分解式内部 `abs(...) ≤ 1` 分（本轮 V-01 实测满足）。但裁定 1 ⑤ 新增的下游约束「`abs(ΔS_abs − ΔS) > 1` 时 05 / UX 须披露耦合项」须在 **S-05 / S-09** 落地，并补一条「`L` 跨帧变化」的独立回归用例（本轮 V-01 构造 `ΔP=0`，未触发 `100·ΔM·ΔP ≈ +2.07 分` 分支，见 §2.1）；建议把该条登记进 `tests/traceability-matrix.md` 与 S-05 / S-09 验收清单（QA 不代裁、不代改既有 QA 文档）。**此处「零返工」仅指 GDD 01 口径裁定；`D-01` 的修复是另一件独立事项，见本节第 4 项**。

**若主理人依 `tests/smoke-checklist.md` §5「波次是依赖批次、不是日历排期」决定让 W3 与 S-04 / S-05 并行推进**：建议至少把上述 5 项**全部登记为 W3 出口门与准出门 E-1~E-9 的显式阻塞项**，补一条书面豁免并经用户确认（高影响动作须人工审批），同时把 `D-02`（S-04 超限策略）与 `D-03`（幂等契约）纳入 S-04 / S-10 的验收清单。**此为 advisory 建议，最终放行由用户决定。**

### 6.2 可立即确认的正面结论（不因出口门 FAIL 而被抹去）

- T-112 交付的 **S-02 / S-03 已实现部分，在 57 条自动用例（45 实现者 + 12 独立）下全部通过**，无回归、无 flaky：本轮基线独立复跑、独立套件（首跑 / 修正后重跑）、合并套件、口径同步后 `[A]`/`[B]`/`[C]` 三次复核共多轮真实执行，「同输入」结果逐次一致，未出现 flaky 特征，无需隔离；**唯一一次 FAIL（V-10）是 QA 侧 stub 字段笔误，已如实保留并归因（§1.2），非实现缺陷**；
- 独立 fresh eyes 补上的 10 条高风险边缘路径**全部可执行且有结论**，未发现确定性破坏、除零 / NaN、硬终局、平台依赖、倍速自动播放、逐格 OD 矩阵、平衡数值硬编码；
- 实现侧对「三条未做冒烟项」的边界声明**属实、诚实**，无隐瞒；
- **GDD 01 两处 `ΔS` 口径与 E1 首 tick 口径已由 T-113 裁定关闭（选 A / 确认实现）**：实现侧解读正确，`AC-F2` 判定已闭合，45 条单测零返工、**就本次口径裁定而言** engineering-lead 无需改代码；本轮边缘路径 ① 按终态判 PASS、不判 FAIL（§2.1）。**`D-01`（已升 S1）的修复属独立事项，见 §5 / §6.1 第 4 项**；
- 本轮**未修改**任何既有文件、`src/` 实现、`tests/unit/` 单测或 9 份既有 QA 文档；未提交 git、未发布、未删除文件；平衡期数值仍为占位、未编造具体数值，性能数字一律按建议基线处理。

### 6.3 证据与复现

- 复现命令见 §1；全部输出为真实 TAP / `console.log` 记录，未加工。
- 独立用例文件：`tests/verification/edge-cases.test.ts`（839 行，**T-115 未改动**）；本报告：`tests/verification/w1-w2-verification.md`（**349 行**，v1.1）。`tests/verification/` 目录下仅此两份文件，无其它新增。
- 按 `tests/test-strategy.md` §7 的证据规范，本轮为**轻量独立验证**，未创建 `tests/evidence/<batch-id>/` 目录；如需正式归档，建议把 §1 的四次命令输出与 §2 的观测值另存为 `tests/evidence/W1W2-T114-01/logs/`，并在 `tests/regression-suite.md`（后续轮次产出）登记 `D-01`~`D-05` 的回归用例 ID。

---

*报告结束 · T-114 / T-115 · 第二层 QA / fresh eyes · 独立复跑 45/45、独立边缘 12/12（首次 11/12 的 FAIL 已如实保留并归因）、合并 57/57 · **GDD 01 口径已裁定关闭（选 A / 确认实现），AC-F2 判定闭合、零返工** · **W1 出口门 FAIL（`D-01` 升 S1）/ W2 出口门 FAIL（范围性）** · advisory 判定，最终放行由用户决定。*

> **v1.1 修订留痕（T-115）**：本次修订原因为「**T-113 口径裁定回执 + 主理人 `D-01` 升格 S1 / W1 出口门改判 FAIL 裁定**」；**验证数据与全部验证结论未改动** —— 57/57、首次 V-10 `EXIT=1 / 11 pass 1 fail` 与修正后 `12/12` 的两次记录、首 tick `S_init=70.7107 / S_t=45 / ΔS_abs=−25.7107 / ΔS=0`、10 条边缘路径、静态扫描、W2 范围性 FAIL、`D-02` / `D-03`（S3）、`D-04` / `D-05`（S4）、「不建议无条件进 W3」一律保持原样。T-115 仅改本报告状态字样，`tests/verification/edge-cases.test.ts` 保持原样、未重跑覆盖任何原始命令输出、未新建文件。**W1 改判 FAIL 与 T-113 口径裁定无因果关系**（见 §4.1 / §5）。

---

# §7 · v1.2 追加修订（T-117 · T-116 修复的独立复核与 W1/W2 出口门重判）

> **修订性质**：本节为**追加修订**，不改写 §0~§6 任何 v1.1 内容（§4 的 W1/W2 FAIL 判定作为历史保留）。本节判定与 §4 冲突处，**以本节为准（v1.2 当前生效）**。
>
> **触发链**：T-115 判 W1 = FAIL（`D-01` 升 S1）→ 用户批准「立即修复并补齐缺口」→ T-116（engineering-lead）修复 + 补证据 → 本节（quality-lead，T-117）独立复核 + 重判。
>
> **复核纪律**：独立运行、不信修复方自证；不编造任何数值；豁免引用均带文件与版本号；本节未修改 `src/`、`tests/unit/` 既有 45 条基线、`tests/` 既有 QA 文档（`quality-closure.md` v1.1 的 EX-01 登记为他人交付、只读引用）。

## 7.1 独立复核运行记录（2026-11-06，本机真实执行）

环境：Node v22.22.2 / win32 / x64 / 零依赖（无 `package.json` / `tsconfig.json` / `node_modules`），工作区根目录执行。

| 命令 | 退出码 | 计数 | 与修复方自证比对 |
| --- | --- | --- | --- |
| `node --experimental-strip-types --test tests/unit/d01-config-compat.test.ts` | `0` | `6/6`（D-01(a)(a')(a'')(b)(c)(d)） | 一致 |
| `node --experimental-strip-types --test tests/unit/*.test.ts` | `0` | **51/51**（45 基线 + 6 D-01 回归）`duration_ms 667.1195` | 一致（evidence §5 首行） |
| `node --experimental-strip-types --test tests/verification/edge-cases.test.ts` | `0` | **12/12** | 一致 |
| `node --experimental-strip-types --test tests/verification/perf-s04.test.ts` | `0` | 3/3 | 一致 |
| `node --experimental-strip-types --test tests/verification/cold-archive-s05.test.ts` | `0` | 6/6 | 一致 |
| `node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts`（全量） | `0` | **72/72** `duration_ms 1217.4137` | 一致（主理人自证 72/72） |
| `npx --yes -p typescript@5.9.3 tsc --noEmit --strict ... src/index.ts`（src-only，附 `--allowImportingTsExtensions --module esnext --moduleResolution bundler --target es2022`） | `0` | 严格零错误 | **部分一致 → 已闭合（N-01.1，2026-11-06）**：evidence §5 初版「含 tests/」口径经 engineering-lead 澄清为误写并已当场更正为 src-only + 完整命令行；实际命令与本行复现命令实质等价。详见 §7.7 N-01 |

既有基线零改动核查：`tests/unit/` 原有 7 个文件（45 条）mtime 均停在 2026-11-05 19:5x~20:1x，未被 T-116 触碰；`tests/verification/edge-cases.test.ts`（839→846 行，+7）为唯一被改的既有文件，改动即披露的 V-06 / V-STATIC 两处 + 文件头修订留痕（裁定 a 见 §7.3）。V-09（`execFileSync` 跨进程逐字节）、V-10（`serviceWeightTotal` 注入）、V-07（多周期互斥）、V-STATIC 六类扫描等关键断言逐条抽查在位，未发现放松。

## 7.2 D-01（S1）修复复核 → **判定：已修复、验证通过、可关闭**

**静态核实（三处挂接，全部属实）**：

| # | 位置 | 核实结果 |
| --- | --- | --- |
| 1 | `src/core/schema.ts` `deserializeState`（L272~306） | `_config` 改实参 `config`；L304 载入后强制 `assertConfigCompatible(state, config)`；另加长度防御（`cells.zone.length !== count` 抛 `GridLimitExceededError`，不接受残缺数据） |
| 2 | `src/simulation/session.ts` `createSimulation`（L51） | 入口即 `assertConfigCompatible(state, config)`，位于任何 workspace / queue / gate 构建之前（不匹配时不建任何对象） |
| 3 | `src/simulation/snapshot.ts` `restore`（L249） | 冷归档恢复经 `deserializeState(e.frames, config)` 走同一断言路径（复用挂接点 1，无绕行） |

全 `src/` 静态扫描：`assertConfigCompatible(` 共 **3 次** = 定义处（`config.ts:196`）+ `schema.ts:304` + `session.ts:51`；V-06 与 V-STATIC 双用例独立输出一致（occ=3 → 调用点 2）。断言本体双校验 `schemaVersion` + `configHash`，任一不匹配抛 `ConfigMismatchError`。

**运行复核**：`d01-config-compat.test.ts` 6/6（含与 T-114 复现步骤完全同构的权重扰动路径 a'，及 schemaVersion 篡改 a''、匹配回环不误伤 b、编排入口 c/d）；全量 72/72。**「无静默续算路径」结论**：全部公开载入入口（`deserializeState` / `createSimulation` / `archive.restore`）均断言拒绝；`runTick` 保持纯函数契约不做二次校验（直接喂旧 state + 新 config 仍可显式混用，`S_t 45 → 32.4` 观测值与 T-114 原始记录一致、无篡改）——该分层属 D-03 显式契约记录，非静默路径（见裁定 c）。显式迁移按 ADR-003 A3 走未来 S-10 `migrate()`，不经 `deserializeState` 绕行，与架构约束一致。

## 7.3 三项裁定（主理人指定复核项）

**裁定 (a) · V-06 / V-STATIC 改写正当性 → 正当，接受为「修复后契约验证」**

1. **授权链完整**：主理人 T-116 派单授权「只写 `src/` 与 `tests/`」；evidence §1.3 与 `edge-cases.test.ts` 文件头（L4~9）双处披露改写内容、指明「其余 11 条用例逻辑未改」并把原始版本指向本报告 v1.1。
2. **改写是缺陷修复后的标准动作**：原 V-06 断言「缺口存在」（`deserializeState` 忽略 `_config`、occ=1 调用点 0）——修复后该断言必然失败，不改写则套件永久红、「失败即停」门控失去可用性。改写不是删证据，而是把缺陷发现用例升格为修复回归用例。
3. **改写质量高于最低要求**：新版 V-06 含五个子断言组（能力正确 / 载入拒绝 / 匹配回环不误伤 / 编排入口拒绝 / 静态 occ≥3 证据），其中 (d) **如实保留**「内核层直接混用旧 state + 新 config 仍不抛错」的分层事实（`S_t 45→32.4` 与 T-114 原值一致）；V-STATIC 计数 `occ>=1 → occ>=3` 是**收紧**而非放松。
4. **失败历史保留**：v1.1 报告 §1.2（V-10 首次 FAIL）、§2 ⑥（D-01 原始观测）全文未动（本报告在 T-116 期间 mtime 未变，T-117 复核时确认）。
5. **核查方法与局限（如实声明）**：工作区无 git、无法逐字节 diff 原版；采用 mtime 基线（45 条基线文件未触碰）+ 关键断言抽查（V-09 / V-10 / V-07 / V-STATIC 核心断言在位）+ 行数差 +7 与披露一致三条证据链，未见未披露改动。

**裁定 (b) · `createInMemorySnapshotStore` 内存介质下 `SM-W2-05` 判定 → PASS（内存介质）/ 真机持久化随 EX-01 顺延**

- `smoke-checklist.md` L76 判据三项（快照自包含六字段 / 每显著变化 ≥1 具体归因 / 冷归档 ≥3 周期历史链完整可读）**字面均不含「持久化介质」要求**，且 T-116 在内存介质上三项全部满足并经本节独立复跑（S-05-①~⑥，6/6；Keyframe=[1,3,6,9] ≥3 周期）。
- 但「冷归档」语义天然指向跨会话留存；真机持久化验证属 `SM-W1-04`（S-01）链路，已由**主理人书面豁免**：`tests/quality-closure.md` **v1.1 §2 EX-01**（用户 2026-11-05 批准「立即修复并补齐缺口」附带条件；「顺延不豁免到底」，最迟 W4 前补做，逾期升级为阻塞准出；不覆盖 S1/S2 缺陷）。
- 判纯 PASS 会抹掉「介质 ≠ 真机」口径、下游可能误读为持久化已验证；判 FAIL/BLOCKED 则无视判据字面已满足。故采用双层表述：**逻辑层 PASS（内存介质）+ 真机持久化随 EX-01 顺延至 W4**。`snapshot.ts` 文件头（L5~8）已诚实披露该边界，evidence §3.1 同。

**裁定 (c) · evidence §4 的 D-02 / D-03 跟踪写法 → 可接受，附一条落实提醒**

- 两条均给出**具体、可执行、可判定**的后续验证方法（D-02：S-04 交接验收时复跑棋盘 512 块场景、断言截断必须有可观测信号、写入 Story 验收标准；D-03：S-10 验收时复跑 V-05 + `seenAdvanceKeys` 重建语义 + 文档化「runTick 调用方必须经 CommandQueue 去重」契约 + 对照用例钉为显式契约），符合 `test-strategy.md` §6 S3「登记关联用例 / 风险编号并进回归清单」的要求（V-02 / V-05 关联用例已在位）。
- **落实提醒（不否决）**：该两项目前仅存在于 T-116 自证报告的表格中，**尚未真正写入 S-04 / S-10 的 Story 验收清单**（`production/epics/` 属 QA 只读，不代改）。建议主理人搬运时保留「截断时必须有可观测信号、不接受无信号静默丢弃」的具体措辞，避免泛化为「关注 D-02」；搬运完成前，本报告把两条维持在「已跟踪未关闭」状态（见 §7.7）。

## 7.4 S-04 性能证据复核（5 要点，全部满足）

| # | 要点 | 复核结果 |
| --- | --- | --- |
| 1 | 计时只在验证侧 | `performance.now` 仅出现于 `tests/verification/perf-s04.test.ts`；`src/` 热路径 V-STATIC 六类扫描（含性能计时）0 命中 |
| 2 | 样本数 / 预热口径 | 每场景 20 次预热不计样（JIT / 缓存隔离，注释明示）+ **120 个实测样本** ≥ 派单要求的 100；`assert.equal(stats.samples, 120)` |
| 3 | 建议基线标注 | 文件头 + evidence §2 双处「实测值 / 建议基线 / 非承诺值」，随真机链路（SM-W1-04）重测钉定 |
| 4 | p95 不做门禁 | 断言仅有限性 / 非负 / 样本数 / `ws.allocations===0`（结构性计数口径，evidence 已诚实标注非 V8 堆剖析证明）；无任何耗时阈值断言 |
| 5 | 数值可复跑、无编造 | 本节独立复跑（同机不同次）：A 棋盘 p95=**0.278ms**、B 条带 p95=**0.474ms**、C 空城 p95=**0.068ms**，全部 120 样本、`ws.allocations=0`；与 evidence §2 的 0.270 / 0.435 / 0.059 同量级（单次挂钟抖动，因无阈值门禁不影响任何判定） |

## 7.5 S-05 冷归档证据复核（6 条实质，全部满足）

| # | 实质要求 | 复核结果 |
| --- | --- | --- |
| 1 | Keyframe 规则 | 归档首条 + `cycleTickIndex===0`（P7 复位）+ 相邻 `cycleId` 推进 → 实测 KEYFRAME = **[1, 3, 6, 9]**（K=3 × 9 tick = 3 个完整闭合周期），DELTA 5 条且 `frames=null` |
| 2 | 无逆运算 | `restore` 自尾向前取最近 KEYFRAME 反序列化；DELTA 不参与恢复；`RestoreResult.replayFrom` 明示前向重放步数 |
| 3 | 逐字节回放 | S-05-③：恢复 t4 → 落 Keyframe t3 → 重放 t4..t9 指纹与原始运行 `canonicalize` 逐字节一致；恢复 t9 Keyframe = 原始终态（重放 0 步） |
| 4 | 确定性 | 条目按 tick 插入序存储、查询按插入序返回；`put` 对 delta / attribution / commandTrace / frames 深拷贝隔离 TickWorkspace 复用池；S-05-⑤ 两次构建逐字节一致。实现内 `Map` 仅作 `tickId→index` 查找（整数 key、不参与输出遍历），无 Map/Set 遍历顺序依赖 |
| 5 | D-01 联动 | S-05-④：不匹配 config `restore` 抛 `ConfigMismatchError`（经 `deserializeState` 断言路径） |
| 6 | 幂等键携带 | S-05-⑥：DELTA 条目 `commandTrace` 含 `s05-z-5` / `s05-adv-5`（zone + advance 幂等键溯源） |

零依赖 / 平台纪律：`snapshot.ts` 无任何 `node:` / 平台 import（V-STATIC 扫描覆盖）；归因七字段（AC2）逐字段断言在 S-05-②。诚实边界（内存介质、淘汰 / 压缩 / 查询只读语义留 S-05/S-09 完整版）已在文件头与 evidence §3.1 披露，与裁定 (b) 口径一致。

## 7.6 W1 / W2 出口门重判（逐条）

### W1 · 基础层（S-01 → S-02）

| 编号 | v1.1 判定 | **v1.2 重判** | 依据 |
| --- | --- | --- | --- |
| `SM-W1-01` | PASS | **PASS**（不变，证据增强） | d01(b)：匹配 config 回环 + 回环后再结算正常（载入路径不破坏确定性入口） |
| `SM-W1-02` | **FAIL**（D-01 升 S1） | **PASS** | 三子项全过：配置注入（V-STATIC 平衡小数 0 命中）/ `configHash` 升级（V-06）/ **旧快照不静默续算**——`deserializeState` / `createSimulation` / `archive.restore` 三公开入口全部断言拒绝（§7.2），6 条专属回归 + V-06 改写后 12/12 |
| `SM-W1-03` | PASS（数据层）/ 不适用（UI） | **不变** | 无新改动 |
| `SM-W1-04` | BLOCKED（未执行） | **豁免顺延（EX-01）** | `tests/quality-closure.md` **v1.1 §2 EX-01**：主理人书面豁免、用户批准（2026-11-05「立即修复并补齐缺口」附带条件）；判 BLOCKED 不判 FAIL；最迟 W4 前按原判据补做，逾期升级阻塞准出；不覆盖 S1/S2，不作其它真机项先例 |

**W1 出口门（v1.2）：PASS（advisory）**。v1.1 的 FAIL 根因（`D-01` S1）已修复验证关闭；唯一未执行项 `SM-W1-04` 持主理人书面豁免顺延，非失败、非缺陷。advisory 判定，最终放行由用户决定。

### W2 · 模拟与归因层（S-03 → S-04 / S-05）

| 编号 | v1.1 判定 | **v1.2 重判** | 依据 |
| --- | --- | --- | --- |
| `SM-W2-01` | PASS | **PASS**（不变） | 51 条基线 + V-09；T-116 未触碰 S-03 |
| `SM-W2-02` | PASS | **PASS**（不变） | 同上 |
| `SM-W2-03` | PASS | **PASS**（不变） | 同上 + V-STATIC 0 命中（含新增 `snapshot.ts` 一并扫描通过） |
| `SM-W2-04` | PASS（逻辑）/ 不适用（UI） | **不变** | 同上 |
| `SM-W2-05` | 未达（S-05 未交付） | **PASS（内存介质）/ 真机持久化随 EX-01 顺延** | 裁定 (b)：判据字面三项全满足（S-05-①~⑥，6/6 独立复跑）；介质边界如实披露 |
| `SM-W2-06` | 未达（S-04 未测） | **PASS** | p95 实测记录已产出（3 场景 × 120 样本，§7.4 五要点全满足）；「建议基线 / 非承诺值」标注齐、不预先冻结；判据「未产出实测记录 → 停 W2 开 S2」的失败分支不再命中 |

**W2 出口门（v1.2）：PASS（advisory）**。v1.1 的范围性 FAIL 根因（S-04 / S-05 证据缺口）已补齐并独立复验；`SM-W2-05` 以内存介质口径 PASS、真机持久化与 `SM-W1-04` 同随 EX-01 顺延至 W4。advisory 判定，最终放行由用户决定。

## 7.7 缺陷终态表（T-117 复核后）

| 缺陷 | 等级 | v1.1 状态 | **v1.2 终态** | 备注 |
| --- | --- | --- | --- | --- |
| `D-01` configHash 变更后旧快照静默续算 | S1 | OPEN（主理人升格） | **CLOSED（已修复验证）** | 三处挂接 + 6 条回归 + V-06/V-STATIC 升格为修复后契约验证；S1 清零，W1 门障碍解除。附带收益：`deserializeState` 长度防御 |
| `D-02` maxBlocks 超限静默截断 | S3 | OPEN | **OPEN（已跟踪，未修复）** | 跟踪写法可接受（裁定 c）；须真正写入 S-04 Story 验收标准，S-04 求解器交接前必须关闭 |
| `D-03` runTick 层幂等契约未文档化 | S3 | OPEN | **OPEN（已跟踪，未修复）** | 同上，目标 S-10；分层契约在 V-06(d) / evidence §1.3 有如实记录 |
| `D-04` TrafficResult 字段命名不对称 | S4 | OPEN | **OPEN（不变）** | S-04 替换 solver 时统一命名或加类型守卫 |
| `D-05` createDefaultConfig 不校验参数范围 | S4 | OPEN | **OPEN（不变）** | S-12 钉定数值前补范围断言 |
| `N-01`（新增观察项，非缺陷） evidence §5 tsc 口径不可复现 | — | — | **登记 → CLOSED（N-01.1，2026-11-06）** | 复核时点事实：evidence §5 初版声称 `tsc --noEmit --strict`「含 src/ 与 tests/」exit 0 且未披露命令行；本报告以纯 tsc（零依赖、无 `@types/node`）复现：**src-only exit 0 属实**，含 tests/ 时出现 `node:test` 等 TS2307/TS7006/TS2580。**关闭依据（N-01.1）**：engineering-lead 经主理人转办回执澄清——实际命令即 src-only（`npx --yes -p typescript@5.9.3 tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions src/index.ts`，经 `src/index.ts` 统一导出入口覆盖 src/ 9 文件；无临时类型安装），并承认初版误写；`w1-gate-remediation-evidence.md` §5 **已当场更正**（更正行含完整命令行 + 更正注记，留痕「T-117 / quality-lead 发现」）。本报告核实更正行文如实：注记内容与本报告复现结论完全一致，且诚实披露 T-116 期间一次未入回执的 tsc 自查。tests/ 覆盖由 `node --experimental-strip-types --check` + 真实运行 72/72 承担（本报告顺带复跑全仓 20 个 .ts 文件 `--check` 全过，注记称 18 个系计数偏差，实质成立且被低估）。不影响任何门 |

## 7.8 准出建议更新（取代 §6.1 的「不建议无条件进入 W3」）

**v1.2 建议：W1 / W2 出口门障碍已清除，可以进入 W3（advisory；最终放行由用户决定）**，附四项附带条件：

1. **D-02 / D-03 落实**：把 evidence §4 两行真正写入 S-04 / S-10 的 Story 验收标准（保留具体断言措辞，见裁定 c 提醒），搬运完成前维持「已跟踪未关闭」；
2. **EX-01 两项真机顺延（`SM-W1-04` + `SM-W2-05` 真机持久化半侧）**：最迟 W4 前按 `smoke-checklist.md` 原判据逐条补做，逾期按 `quality-closure.md` v1.1 升级为阻塞准出；`K-1~K-5` 真机跑通前不得凭猜测回填；
3. **性能口径纪律延续**：S-04 全部数字维持「建议基线 / 非承诺值」，冻结须 S-12 校准报告 + 汇编确认（`quality-closure.md` §2 O-5）；真机（HarmonyOS 7 / ArkTS）重测前不得引用本机 p95 作承诺值；
4. **下游归因披露约束**（§6.1 第 5 项延续）：T-113 裁定 1 ⑤ 的 `abs(ΔS_abs − ΔS) > 1` 披露须在 S-05 / S-09 完整版落地，并补「`L` 跨帧变化」独立回归用例（本轮 V-01 构造 `ΔP=0` 未触发该分支，如实声明未验证）。

## 7.9 v1.2 修订留痕（T-117）

- **改动范围**：仅本报告一个文件。改动点：① 头部「版本」行升 v1.2；② 头部「出口门判定」拆为两行（v1.1 历史保留行 + v1.2 当前生效行）；③ 追加本 §7（§7.1~§7.9）。**§0~§6 全文未删改**——v1.1 的 W1/W2 FAIL 判定、57/57 与 V-10 首次 FAIL 记录、首 tick 四个实测值、`D-02`~`D-05` 原始登记一律保持原样。
- **未改动**：`src/` 全部文件、`tests/unit/` 既有 7 文件（45 条基线）、`tests/verification/edge-cases.test.ts`（T-116 改后版本，本节只读复跑）、`perf-s04.test.ts` / `cold-archive-s05.test.ts` / `d01-config-compat.test.ts` / `w1-gate-remediation-evidence.md`（他人交付，只读复核）、`tests/quality-closure.md`（v1.1，EX-01 只读引用）、其余 QA 文档、`design/`、`docs/`、`production/`。未提交 git、未发布、未删除文件。
- **运行证据**：§7.1 七条命令均为 2026-11-06 本机真实执行；性能数字为本机单次运行记录（建议基线 / 非承诺值）；未编造任何数值。
- **独立性声明**：本节全部复核（挂接核实 / 三裁定 / 逐门重判 / 缺陷终态）由 quality-lead 独立执行，不采信修复方自证数字（自证数字仅作比对列）；唯一不可独立复现项登记为 N-01。
- **v1.2.1 微修订（2026-11-06，N-01.1 关闭）**：仅改 §7.1 tsc 行注记与 §7.7 N-01 行终态（登记 → CLOSED）两处；依据 = engineering-lead 经主理人转办的澄清回执 + `w1-gate-remediation-evidence.md` §5 当场更正（更正行文经本报告核实如实，顺带复跑全仓 20 个 .ts 文件 `--check` 全过）；其余内容零改动，W1/W2 判定不受影响。

---

*报告结束 · T-114 / T-115 / T-117 · 第二层 QA / fresh eyes · v1.2 当前生效：W1 出口门 **PASS（advisory）** / W2 出口门 **PASS（advisory）**（`SM-W1-04` + `SM-W2-05` 真机持久化随 EX-01 顺延至 W4）· `D-01` CLOSED，`D-02`~`D-05` OPEN（已跟踪）· 独立复跑 72/72 · advisory 判定，最终放行由用户决定。*
