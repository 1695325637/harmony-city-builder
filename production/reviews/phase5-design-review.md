# Phase 5 设计评审与范围检查 · W1~W2 纯逻辑层

| 项 | 内容 |
| --- | --- |
| 评审对象 | T-112 / W1~W2 纯逻辑层（S-02 数据层 + S-03 确定性 tick 结算链），9 个 `src/**/*.ts` + 7 个测试文件 / 45 条单测 |
| 评审人 | 文策渊（design-strategist） |
| 日期 / 任务 | 2026-11-05 · T-113（P1） |
| 评审性质 | **设计符合性评审**：支柱漂移、范围蔓延、可玩性判定接口留存、占位数值纪律。**不替代** quality-lead T-114 的独立验证，也不判代码质量 / 测试执行结论 |
| 依据（只读） | `design/concept/game-concept.md` v1.0、`design/gdd/systems-index.md` v1.0、五份 GDD、`src/**`、`tests/unit/**`、`src/README.md`、`production/sprint-01.md`、`docs/architecture/architecture.md` |
| 本轮写入 | 本文件（新建）；`design/gdd/systems/01-satisfaction-simulation.md` 的 6 个口径章节 / 7 处编辑（T-113 裁定，见 §5） |
| **判定** | **CONCERNS** —— 支柱 / 范围 / 占位纪律三项无缺陷；但 AC1 / AC3 / AC4 不得判 PASS、AC2 端到端待 S-09、本轮裁定新增两条下游约束尚未落地。共登记 **5 项跟踪项，无一项阻塞 W3 开工**（详见 §6） |

---

## 0. 评审边界与方法

1. 只读核对了主理人指定的三个文件全文（`src/simulation/tick-pipeline.ts`、`src/core/config.ts`、`src/README.md` §6），并按证据需要补读 `src/core/types.ts`、`src/core/schema.ts`、`src/simulation/traffic.ts`、`src/simulation/session.ts`、`src/simulation/commands.ts` 与 4 个关键测试文件。
2. 范围检查在 `src/` 上做了一次静态关键词扫描（模式见 §2.5），并交叉核对实现侧既有的静态断言测试。
3. **不得判 PASS 的项**：AC1（10 分钟理解因果）、AC3（≥2 种方案达标）、AC4（5–12 min 中循环）均需人工 Playtest 与可玩版本，本轮只核「接口是否留存」，不判达成。此约束来自主理人 T-113 与 `production/sprint-01.md` §3.3 / §5 第 4 项（准出层 BLOCKED、实测证据 MISSING 为预期状态）。
4. 本轮**未运行测试**；45/45 通过的事实取自主理人已独立复跑 `EXIT=0` 的回执与 `src/README.md` §3.2，不重复执行、不替 QA 下结论。

---

## 1. 支柱符合性（P1 ~ P4）

| 支柱 | 判定 | 证据（文件 : 行） | 说明 |
| --- | --- | --- | --- |
| **P1 满意度是唯一计分板** | **无漂移** | `src/core/types.ts` L52 `CycleOutcome = 'IN_CYCLE' \| 'TARGET_MET' \| 'RETRY_AVAILABLE'`（类型层排除判负）；L67 `P_t` 明标「过程量」、L73 仅 `S_t` 为 `[0,100]` 终局量；`src/simulation/tick-pipeline.ts` L382 唯一达标判据 `cur.S >= config.S_unlock`；`tests/unit/d6-no-end.test.ts` L100–114 连续 3 周期未达标仍 `RETRY_AVAILABLE` | 无第二终局轴字段，无人口 / 建筑数独立激励；OD-1 A 无硬终局成立 |
| **P2 每笔投入都有机会成本** | **无漂移**（数值侧待 AC3） | `tick-pipeline.ts` L278–283 分区 / 道路命令累加 `C_b_accum`（`c_zone` / `c_road` × 密度系数）；L351–360 每 tick 累加 `C_m_accum`；L376 `B = clamp(B + I_t − C_b − C_m, B_floor, B_cap)`；L301–302 `f_f = clamp(I_f_lagged / (i_ref × population))`，无「零成本拉满」路径；L250–263 非法 FUND / 锁定区 / 未知分区 → `BudgetRejected` 且不应用 | 结构上「不建什么」与「建什么」同权。但支柱否决项「任何场景通用的万金油最优解」属 AC3 平衡期验证，本轮不判 PASS |
| **P3 城市是流动系统，不是静态截图** | **无漂移** | `tick-pipeline.ts` L292–294 P3 的 `f_s` 直接由 P2 的 `serviceWeightedAccess` 归一化、note 为 `reused:P2.traffic`；`src/simulation/traffic.ts` L99–130 ROAD 图 BFS、L144–167 `pathTimeBetween` 不可达返回 `T_max`、L260–298 `t_g` / `T_c` / `E` 全部走通勤图路径时长；`tests/unit/pipeline.test.ts` L42–60 断言 `reused:P2` 且代码库无 `euclidean\|Math.hypot\|radius\|半径\|传送式`；`tick-pipeline.ts` L439–442 渲染帧 no-op、暂停态编辑只入队（`session.ts` L70–72） | 无静态半径、无瞬时结算；所有结果随 tick 生效 |
| **P4 拇指宽的决读优先** | **结构上未违背**（完整判定待 S-07 / S-08） | `src/core/types.ts` L28 仅 4 因子进 `FACTOR_KEYS`（未摊到常驻）；L79 `n_issue` 范围 `2~4（3±1 硬上限）`；L86 `CommandKind` 仅 `ZONE/DENSITY/ROAD/FUND/ADVANCE` 5 种，无建筑级微操动词；`tick-pipeline.ts` L363 `issueCount = clamp(..., 2, 4)`；`src/simulation/session.ts` L73–91 只有 `advanceDay`（V6）触发结算 | **限定**：本轮为纯逻辑层、无 UI，HUD 恰好 3 指标 / 30 秒决策 / 单屏 ≤1 数据面板 / 两级反馈均**未实现**。只能判「未预留违背结构」，**不得判「P4 已满足」** |

> 四条支柱均未命中 §1.2 的否决列。P4 的限定是本轮最重要的诚实边界，若把「无 UI」误读为「P4 通过」将构成过度声明。

---

## 2. 范围检查

### 2.1 MoSCoW 的 Must 集合

概念 §5.1 的 11 类 Must 逐项核对：本轮 W1~W2 只交付 **S-02 数据层**（schema / 配置注入 / 32×32 与 16×16 起步 / 3 类分区）与 **S-03 模拟内核**（P0~P8 / R1~R7 / 4 因子 / Δ 与归因）。

- **未新增任何 Must**；未把 Should / Could / Won't 升格为 Must。
- UI/UX、存档、平台特性等 Must 尚未实现，属 S-06 ~ S-11 既定范围，**不是蔓延，也不是本轮缺陷**。
- 准入纪律「新增 Must 须等量移除并回用户拍板」（概念 §5.1 / `sprint-01.md` §3.4）本轮未被触发。

### 2.2 5.2 垂直切片边界

| 切片要求 | 本轮状态 | 证据 |
| --- | --- | --- |
| R1~R7 七条规则贯通 | ✅ 全部有阶段映射，且 9 阶段顺序固定 | `types.ts` L38–50 `PIPELINE_STAGES` / `RULE_TO_STAGE`；`pipeline.test.ts` L22–39 断言 P0→P8 且 7 条规则均有有效映射 |
| V1→V9 可达，**V2 诊 不可省** | ⚠️ 数据底座已产出，诊断面板未实现 | `tick-pipeline.ts` L336–349 `addDelta('S', prev.S, cur.S)` + `attribution[]`（含 `causeType` / `refId` / `suggested_verb`）；`src/README.md` §6 已知限制 2 明确 P6 议题为占位、完整规则留 S-05 / S-09 |
| 一次完整「失败—诊断—修正—见效」 | ⚠️ 需可玩版本 + 人工 Playtest | `sprint-01.md` §3.3 DoD；本轮无 UI / 无输入界面 |
| 竖屏单手 + 断点续玩 | ⚠️ 未实现（S-06~S-08 / S-10） | `src/README.md` §6「没做」清单 |

结论：**切片边界未被突破，也未被提前宣告完成**；本轮只落到「七条规则贯通 + 归因数据当帧产出」，与 W2 出口门禁（`sprint-01.md` §3.2）一致。

### 2.3 切片外项逐条核对

概念 §5.2 原文列明的切片外项（`sprint-01.md` §3.4 范围红线同口径）在 `src/` 中**零实现命中**：

| 切片外项 | 扫描结果 |
| --- | --- |
| 公共交通 / 政策卡 / 地价 / 多道路等级 | 无对应命令、字段、公式；`CommandKind` 仅 5 种；`zoneTypes` 仅 `['R','C','I']`（`config.ts` L84） |
| 独立危机事件系统 | 无事件类型；`SimEventType` 仅 `TickCommitted / BudgetRejected / StageEntered / AdvanceRejected / IssuePlaceholder`（`types.ts` L99–104） |
| 跨设备 / 折叠屏双栏 | 无平台 import、无 `PlatformAdapter` 实现（`placeholders.test.ts` L72–78 静态断言） |
| 季节昼夜 / 成就 / 分享 | 无对应状态字段或命令 |
| ×1×2×4 自动播放 / 倍速 | 见 §2.5，仅否定式注释 |
| 逐车仿真 / 实时车流粒子 | `traffic.ts` 为分区块合并 + ROAD 图 BFS，`traffic-attribution.test.ts` L114–117 断言无逐格 OD 矩阵 |

> **计数说明**：概念 §5.2 原文逐条为 10 条，主理人 T-113 表述为「切片外 9 项」。差异仅在于是否把「跨设备」与「折叠屏双栏」合并为平台特性一类；两种归并下**均无蔓延**，结论一致。

### 2.4 H1~H4 平台特性

`src/` 零平台依赖、零工程配置（`src/README.md` §1 / §6；`placeholders.test.ts` L72–78 断言无 `cocos|@ohos|@harmony|three|pixi` 及 `node:` import）。H1 秒启卡片、H2 折叠双栏、H3 跨设备流转、H4 分布式多机同局**均未出现**，未进 Must、未排期——符合概念 §6.2 铁律与 `sprint-01.md` §5 第 3 项「S-01 空场景真机验证之后方可排期，H4 Won't」。

### 2.5 `src/` 违禁实现静态扫描

扫描模式（大小写不敏感）：`倍速|自动播放|autoplay|speed|逐车|vehicle|粒子|地价|landPrice|政策卡|policy|独立危机|crisisEvent|静态半径|欧氏|Math.random|Date.now|setTimeout|setInterval`。

**命中 5 处，全部为否定式注释或测试覆盖说明，零实现命中**：

| 位置 | 内容性质 |
| --- | --- |
| `src/core/types.ts` L5 | 文件头禁止清单「倍速自动播放、硬终局分支」 |
| `src/simulation/commands.ts` L6 | 「首版无倍速、无自动播放、无倒计时条」 |
| `src/README.md` L90 / L105 / L106 | 测试覆盖说明与硬约束 1/2 自检（明确「无倍速 / 自动播放 / 倒计时」） |

另交叉核对既有静态断言：`pipeline.test.ts` L55–60 无欧氏 / 半径 / 传送式；`traffic-attribution.test.ts` L114–117 无逐格 OD 矩阵；`determinism.test.ts` 与 `src/README.md` §5 第 1/2 条断言无墙上时钟 / 原生随机 / 渲染帧推进。**结论：范围无蔓延。**

---

## 3. AC1~AC4 未被破坏（接口留存）

| AC | 本轮是否留下可实现的接口 | 判定 |
| --- | --- | --- |
| **AC1** 10 分钟完成首个周期并理解因果 | 因果链数据齐备：`frames.current.dSByFactor[4]`、`dSPenalty`、`attribution[]`、`addDelta('S', prev.S, cur.S)`（`tick-pipeline.ts` L304–349）；确定性回放可复现（`determinism.test.ts`） | **不判 PASS** —— 需无外部说明的人工 Playtest 与可玩 UI |
| **AC2** 任一满意度变化可追溯 ≥1 条原因 | **数据层成立**：归因当帧产出、逐因子绑定 `causeType / refId / suggested_verb`；分解内部一致性由 `traffic-attribution.test.ts` L120–136 断言（`abs(cur.dS − ΣdSByFactor − dSPenalty) ≤ 1`） | **数据层 PASS（接口留存）**；**端到端不宣称 AC2 达成** —— 诊断面板属 S-09；T-113 裁定后的口径与披露约束见 §5 |
| **AC3** ≥2 种显著不同方案都达标 | 结构防主导策略已具备：`g(f)=f^α` 凹变换、`L_t` 短板惩罚、`f_c/f_s/f_e` 依赖通勤图位置（`config.ts` L159–179、`traffic.ts` L260–298）；`traffic-attribution.test.ts` L96–111 有「位置敏感性 + 平移不变」断言 | **不判 PASS** —— 「≥2 种都达标」需平衡期数值 + 参数扫描 + 人工 Playtest（`sprint-01.md` §4 主导策略风险） |
| **AC4** 5–12 min 完成一个中循环 | 主动推进节奏已具备：`session.advanceDay` 为唯一结算入口、`advanceRenderFrames` no-op、幂等键防连点、无墙上时钟 / 倍速（`session.ts` L73–95、`tick-pipeline.ts` L439–442） | **不判 PASS** —— 需可玩版本与 `T_wall` 计时口径（`sprint-01.md` §3.3 / `tests/test-cases/AC4-session-length.md`） |

> **AC2 的两处口径边界（本轮裁定后成立，见 §5）**：① 首 tick 按 GDD 01 E1 走教学占位、`ΔS`（归因分解量）= 0，故「任一 `ΔS ≠ 0`」前提在首 tick 不成立；首 tick 的 `S_t − S_{−1} ≠ 0` 是**绝对变化**，不是 AC2 所指的 `ΔS`。② `ΔS` 与 `S_t − S_{t−1}` 差一个二阶交叉项，AC-F2 的 ≤1 分阈值**只约束分解式内部**，不得据此判 AC2 失败。二者若不拆清，AC2 会被误判 FAIL。

---

## 4. 占位数值纪律

| 参数 | `PLACEHOLDER_DEFAULTS` 中的值（占位，非结论） | 位置 |
| --- | --- | --- |
| `K`（每周期 tick 数） | `4` | `src/core/config.ts` L85 |
| `S_unlock`（达标线，分） | `60` | L86 |
| `T_max`（不可接受通勤阈值，min） | `30` | L88 |
| `i_ref`（人均参考投入） | `10` | L91 |
| `w_i`（四因子权重） | `{f_c:0.25, f_s:0.25, f_e:0.25, f_f:0.25}` | L92 |

**纪律证据（五项均仍为占位、未被写成已定平衡结论）**：

- `config.ts` L4–9 文件头与 L79–82 `meta = { kind:'PLACEHOLDER', pinnedAt:null, note:'平衡期定，S-12 前钉定；由配置表注入。当前值仅为可运行占位，不是平衡结论。' }`。
- 模拟内核只读取 `Config` 字段，公式里无硬编码数值（L152–179 `SatisfactionAggregator`）；`computeConfigHash` L135–138 任一字段变化即升哈希；`assertConfigCompatible` L196–203 版本 / 哈希不匹配即抛 `ConfigMismatchError`，不静默续算。
- `S_init` **不写死**，由 `computeBaselineS(f_init)` 经 §4.2 合成公式派生（`config.ts` L182–193、`schema.ts` L110–118）。
- `tests/unit/placeholders.test.ts` L23–29（占位标记与口径）、L31–46（占位符字段齐备）、L48–54（configHash 随 `K` / `T_max` / `i_ref` 变化）、L56–70（`K` 注入生效）、L80–83（**全源码无「已定稿 / 已冻结 / 已钉定 / 最终平衡值」**）。
- `src/README.md` §5「占位符清单」把 `gridSide=32` / `unlockedSide=16` / `maxBlocks=64` / `epsilon` 明确划为**结构性（非平衡数值）**，与 `systems-index.md` §7.1 一致，未混淆。

**本轮两项裁定未钉定任何平衡数值**：裁定 1 明确论证「不靠调 `λ` / `f_floor` 压残差」，并写明这些参数仍按 §8.1 / `systems-index.md` §7.1 由配置表注入、S-12 前钉定。GDD 04 O-2（`C_b > B` 分期 / 禁止）与 GDD 02 O-2（解锁区数量 / 切分形状）按主理人重申**保持占位**，实现侧按占位处理（P1 非法命令判据占位、P7 解锁只递增 `unlockedRegions`）是正确的，本轮未编造数值、未擅自拍板。

**判定：PASS。**

---

## 5. 本轮两项口径裁定摘要（与 AC2 的关系）

裁定全文与推导已回改 `design/gdd/systems/01-satisfaction-simulation.md`，此处只记对评审结论的影响。

- **裁定项 1（选 A 附补强）**：根因是 `ΔS` 在 GDD 01 §3.2 被定义为 `S_t − S_{t−1}`、在 §4.3 又被定义为分解式之和的**符号歧义**，而非实现缺陷。令 `M_t = Σ w_i g(f_{i,t})`、`P_t = 1 − λL_t`，则 `ΔS_abs − ΔS = 100·ΔM·ΔP`（二阶交叉项），大变化时数分，与实现侧复现的约 4 分同量级。裁定把共享符号 `ΔS` 的实现取值收敛为**归因分解量**（`Snapshot.dS`），`S` 的绝对变化由 Delta 条目承载（局部记号 `ΔS_abs`，**不新增共享符号、不动只读的 `systems-index.md` §4.2**），二者不要求数值恒等；AC-F2 改措辞、判定强度不变。**45 条单测 0 条受影响，engineering-lead 零返工。**
- **裁定项 2（确认实现处理）**：首 tick `S_t` 照 §4.2 计算、`ΔS` 置 0、`dSByFactor` 全 0、无归因型议题、只给一条教学占位归因；`S_{−1} = S_init`（由 `f_init` 派生）。E1 已按此改写。**对 AC1 不破坏且更优**（首 tick 即见「拨付 / 网格 → S 变化」，避免「点了没反应」的黑箱）；**对 AC2 不破坏**（首 tick 的 `ΔS` 定义为 0，「任一 `ΔS ≠ 0`」前提不成立）。D6-3 类验收因此保持有效。
- 两项裁定共享同一根因：**必须把 `ΔS`（归因口径）与 `S` 的绝对变化分开**，否则 AC2 在首 tick 与「S 变化大但归因和小」两处会被误判 FAIL。
- 新增两条**下游**设计约束（本轮不实现、不返工）：① `|ΔS_abs − ΔS| > 1` 时 05 / UX 须披露耦合项；② 首 tick 的 `S` 变化建议给教学式解释而非空白。均落在 S-05 / S-09，登记为跟踪项 B-4。

---

## 6. 判定与阻塞项清单

### 判定：**CONCERNS**

- **可判 PASS 的三项**：支柱符合性（P1~P3 无漂移、P4 结构上未违背并已限定）、范围检查（无蔓延、无违禁实现、H1~H4 未排期）、占位数值纪律（五项均占位、未被写成结论）。
- **判 CONCERNS 的理由**（均非实现缺陷）：AC1 / AC3 / AC4 按纪律**不得判 PASS**；AC2 仅数据层 PASS、端到端待 S-09；本轮裁定新增两条下游约束与 GDD 01 口径回改尚待落地 / 复核。
- **不判 FAIL**：无支柱漂移、无范围蔓延、无 Must 增加、无占位数值被钉死、无 AC 接口被破坏、无返工需求。

### 跟踪 / 阻塞项清单（**无一项阻塞 W3 开工**）

| # | 项 | 性质 | 归属 | 关闭时机 | 阻塞 W3？ |
| --- | --- | --- | --- | --- | --- |
| **B-1** | AC1 / AC3 / AC4 人工 Playtest 未执行 | 预期缺失（非缺陷，`sprint-01.md` §3.3 准出层 BLOCKED / 实测证据 MISSING） | quality-lead（T-114 及后续） / 主理人 | 可玩垂直切片产出后 W3~W5，S-12 前 | **否**（但本轮不得判 PASS） |
| **B-2** | AC2 诊断面板（V2 诊 / 05 完整议题规则）未实现 | W1~W2 范围外既定待办（`src/README.md` §6 已知限制 2） | engineering-lead S-09 + 设计侧 05 GDD | S-09 / W3 | **否**（`dSByFactor` / `attribution` / Delta 已留存） |
| **B-3** | 完整快照存储 / Keyframe+Delta / 冷归档 ≥3 周期 | W1~W2 范围外既定待办（`snapshot.ts` 仅接口占位） | engineering-lead S-05 | S-05 / W2 尾 ~ W3 | **否**（`TickSnapshot` 形状已定义） |
| **B-4** | T-113 新增两条设计约束（耦合项数值披露、首 tick 教学式解释） | 本轮裁定新登记 | 设计侧（05 GDD / ux-spec）→ engineering-lead S-05 / S-09 | S-05 / S-09 | **否** |
| **B-5** | GDD 01 口径回改（6 章节 / 7 处编辑）待主理人一致性复核 | 流程项 | 主理人 | 本轮回执后 | **否** |

> **非阻塞提示**（不计入上表）：建议在后续汇编时给 `design/gdd/systems-index.md` §4.2 的 `ΔS` 行补一句「取值口径见 GDD 01 §4.3」，便于读者区分归因分解量与绝对变化。本轮该文件为**只读**，我未擅自改动，也未新增共享符号。

---

## 7. 新风险与提示

| # | 风险 / 提示 | 影响 | 建议 |
| --- | --- | --- | --- |
| **R-N1** | `ΔS` 双口径若未在文档层拆清，AC2 会在「首 tick」与「S 变化大而归因和小」两处被误判 FAIL | 验收口径误判，可能被误读为反馈黑箱（概念 §9.1 R4） | 已由 T-113 裁定关闭；真正消除玩家侧感知仍需 B-4 落地，建议 S-09 验收条件里显式加一条「HUD 数字与归因之和不一致时的披露」 |
| **R-N2** | `ΔS_abs` 是 GDD 01 **局部记号**，未登记共享数据字典；未来其他 GDD 可能仍把 `ΔS` 当作 `S_t − S_{t−1}` | 跨 GDD 符号误用 | 本轮为避免越权改只读文件刻意不新增共享符号；建议后续汇编补口径指引（同 §6 非阻塞提示） |
| **R-N3** | AC-F2 判据改用 `abs()` 等价写法以避免 Markdown 表格分隔符歧义 | 极低：测试断言为数值比较而非字符串扫描，`traffic-attribution.test.ts` L135 不受影响 | 经主理人中转知会 quality-lead 即可，无需改测试 |
| **R-N4** | P4 在纯逻辑层只能判「结构上未违背」；若被汇编成「P4 已满足」属过度声明 | 评审结论失真 | 汇编时保留本报告 §1 的限定措辞；P4 完整判定须待 S-07 / S-08 的 HUD 与 30 秒决策实测 |
| **R-N5** | 本评审与 quality-lead T-114（独立验证，仍 in_progress）是两条独立结论 | 若混为一谈会掩盖 QA 侧发现 | 主理人分别汇编；本报告不引用、不预判 T-114 结果 |
| **R-N6** | `PLACEHOLDER_DEFAULTS` 中结构性常量（`maxBlocks=64` / `epsilon` / `gridSide=32` / `unlockedSide=16`）与平衡数值同处一个对象 | 平衡期调参时可能被误改 | 已在 `src/README.md` §5 与 `systems-index.md` §7.1 区分；建议 S-12 钉定参数时只动平衡类字段 |

---

*文档结束 · T-113 Phase 5 设计评审 · 判定 CONCERNS（无阻塞性缺陷，5 项跟踪项均不阻塞 W3）· 支柱 / 范围 / 占位纪律无漂移 · AC1 / AC3 / AC4 未判 PASS · 两项口径裁定零返工*
