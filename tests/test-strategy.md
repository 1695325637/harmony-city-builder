# HC-01 · 首个垂直切片测试策略（Test Strategy）

| 项 | 内容 |
| --- | --- |
| 工作代号 | HC-01（**非产品名**，命名待用户另行拍板） |
| 阶段 | 首个垂直切片 / AC1–AC4 质量闭环资产补齐 · lean 评审档 |
| 作者 | 严守真（QA Lead / 测试负责人） |
| 日期 | 2026-11-05 |
| 版本 | v1.0 |
| 状态 | **用例资产齐备（Asset-Ready）；实测判定未执行** |
| 输出范围 | 仅 `tests/` 下 9 份 Markdown；不写代码、不建工程、不调用 git、不修改 `design/` `docs/` `production/` 下任何文件（只读引用） |
| 上游 | 见 §1.3「上游文档基线」 |

---

## 0. 诚实性声明（读本文档前先读本节）

1. **本轮游戏尚未实现，不存在可玩垂直切片、真机包、受试者会话与任何测试执行记录。**
2. 本轮交付的**唯一**可声称状态是「**测试资产齐备**」：用例已写、字段齐全、判据可观测可判定、追溯矩阵逐行无遗漏、准出规则明确、证据规范已定义。
3. **不得声称任何用例已执行、已通过、已失败**；全部「实际结果 / 判定 / 证据路径 / 执行人 / 执行日期」字段**一律留空**；`tests/playtest-report-template.md` 全文标注「待可玩垂直切片产出后执行」。
4. **质量闭环补满 = 用例齐备 + 追溯矩阵无缺口 + 准出规则明确；实测判定仍待执行。**
5. 质量门为**建议性门控（advisory）**：本策略给出 PASS / CONCERNS / FAIL 判定规则，**最终放行由用户决定**；发布签字类高影响动作须人工审批。
6. 性能数字（30fps、DrawCall L1 ≤60–80、常驻纹理 80–120MB、首包 150–200MB、<100ms 反馈、结算 p95 ≤16ms 等）**一律为「建议基线 / 非承诺值」**，不得当作已冻结硬指标或承诺值；冻结动作须 S-12 校准报告产出后由主理人确认（`docs/architecture/architecture.md` §10.1 / §10.3、`docs/architecture/control-manifest.md` §1.8）。

---

## 1. 定位、范围与不可变前提

### 1.1 本文档的作用

定义「怎么测、测到什么程度才算完、谁签字、证据怎么留」，是 `tests/test-cases/`、`tests/smoke-checklist.md`、`tests/traceability-matrix.md`、`tests/playtest-report-template.md` 的**唯一上层口径**。本文档不定义玩法、不定义数值、不定义实现方案。

### 1.2 已拍板口径核对（用例前提不得与之冲突）

| # | 拍板口径 | 来源 | 对测试用例的硬约束 |
| --- | --- | --- | --- |
| OD-1 | A：满意度唯一计分板、无硬终局、未达标可回退重试 | `design/concept/game-concept.md` §8.0 / §8.5 | 用例不得出现「失败 / Game Over / 第二终局轴」判定 |
| OD-2 | A：默认暂停、点「结束本日」结算一次 tick、思考时间无限 | 同上；`design/ux/ux-spec.md` §4.1 | 用例不得以倒计时、自动推进、倍速为前提 |
| OD-3 | A：聚合数据 + 市民之声文本，无具象个体市民 | 同上 | 用例不得要求个体市民跟随 / 个体级数据 |
| OD-4 | A：固定有限地图 + 里程碑解锁新区 | 同上 | 用例不得含无尽地图 / 多独立场景 |
| C-1~C-4 | 全按推荐；C-2 = 2:1 dimetric / 128×64 / ≈26.57° | `design/art/art-bible.md` 附录 C | 视觉类用例以此基线判定 |
| 常驻指标 | **恰好 3 项：满意度 / 预算结余 / 周期**；人口进次级面板 | `production/sprint-01.md` §2.4 裁定 2；`design/ux/ux-spec.md` C1 | 用例须逐项核对，不得出现第 4 项常驻 |
| 主节奏控件 | **唯一「结束本日」**；首版无 ×1×2×4 倍速 / 自动播放 / 倒计时条 / 独立暂停菜单 | 同上裁定 3；`design/ux/ux-spec.md` §4.1 / UX-AC2 | 用例须含「不存在」反向断言 |
| 网格 | **32×32 硬上限 / 16×16 起步**，按里程碑解锁 | `docs/architecture/architecture.md` §10.2；`design/gdd/systems/02-map-zoning.md` §3.1 | 用例 >32×32 须被显式拒绝 |
| 可访问性层级 | **29 条 AC = 执行层（27 可判 + 2 条 N/A）**、**10 项大项 = 汇总层（UX-A20 为 N/A）**；**27 条可判全通过 + 2 条 N/A 显式登记 → UX-A11~A19 九项通过 + UX-A20 N/A 登记 → Standard 达标**；**N/A ≠ PASS，不计入通过分子，禁止写「29 条全通过 / 十项全通过」；反向不成立** | `design/accessibility/accessibility-matrix.md` §2.12；`design/ux/ux-spec.md` §8.2 | 判定链写成单向，禁止用汇总层抵销执行层，禁止把 N/A 并入「通过」 |
| 反馈分层 | <100ms 即时反馈与 tick 解耦（双通道 + 乐观视图 + VM） | `docs/architecture/adr/ADR-004-ui-feedback-decoupling.md` §2 | 用例覆盖「默认暂停且未发生任何 tick」下的即时反馈 |
| 归因 | 结算时记录、查询只读不重算 | `docs/architecture/adr/ADR-003-save-data-and-attribution.md` §2 / §8 A4 | AC2 用例须含只读断言 |
| 确定性 | 同一 (S_t, 命令, 配置) 回放逐字节一致 | `docs/architecture/adr/ADR-002-simulation-loop-and-snapshot.md` §2 / §7 A1 | 回放类用例须带 configHash / seed |

### 1.3 上游文档基线（跨文档引用一律带文件名与章节号）

| 类别 | 相对路径 | 本策略引用的章节 |
| --- | --- | --- |
| 概念 | `design/concept/game-concept.md` v1.0 | §2.1 R1~R8、§2.2 D1~D6、§3.1 V1~V9、§3.3、§5.1 MoSCoW、§5.2 垂直切片与 AC1–AC4 原文、§8、§9.1 风险 R1~R8 |
| 系统索引 | `design/gdd/systems-index.md` v1.0 | §4.2 共享数据字典、§4.3 统一 tick 步序、§5 验收口径、§7.1 平衡期数值口径 |
| GDD 01 | `design/gdd/systems/01-satisfaction-simulation.md` v1.0 | §4、§6 边缘 E1~E6、§7 AC-F1~F7 |
| GDD 02 | `design/gdd/systems/02-map-zoning.md` v1.0 | §3、§6 边缘 E1~E7、§7 AC-M1~M7 |
| GDD 03 | `design/gdd/systems/03-traffic-commute.md` v1.1 | §3、**§3.5 流线三态判定口径（T-130 新增）**、§4、§6 边缘 E1~E7、§7 AC-T1~T8 |
| GDD 04 | `design/gdd/systems/04-budget-economy.md` v1.0 | §3、§4.5 C-1~C-3、§6 边缘 E1~E7、§7 AC-E1~E8 |
| GDD 05 | `design/gdd/systems/05-issues-diagnosis.md` v1.0 | §3、§4、§6 边缘 E1~E8、§7 AC-I1~I8 |
| UX | `design/ux/ux-spec.md` v1.0 | §2、§3.3、§4.1「结束本日」、§7 E1~E8、§8.1 UX-AC1~9、§8.2 UX-A11~A20 |
| 可访问性 | `design/accessibility/accessibility-matrix.md` v0.2 | §2 的 26 条 AC（当时基线；v0.3 起 29）、§2.10、§2.11 九条映射、§5 记录模板〔**v0.3 · S-12 就地加注**：矩阵现为 **v0.3**；§2.10 = A-10 组、§2.11 = AC 汇总、**§2.12 = 10 条映射**；本行 26 / 九条 / v0.2 为历史基线，现行以 §1.2 层级纪律与 `design/ux/ux-spec.md` §8.2 为准〕 |
| 美术 | `design/art/art-bible.md` v0.2 | §9.1 分级、§9.2 特性矩阵、§9.4 建议基线 |
| 架构 | `docs/architecture/architecture.md` v1.0 | §3 双循环 / §3.2 P0~P8 / §3.2.1 D6 解环 / §4 快照 / §10 校准 / §13 G1~G12 |
| 控制清单 | `docs/architecture/control-manifest.md` v1.0 | §1 一页规则、§2 R-01~R-14、§3 G1~G12、§5.1 K-1~K-5 回填 |
| ADR | `docs/architecture/adr/ADR-002-simulation-loop-and-snapshot.md`、`ADR-003-save-data-and-attribution.md`、`ADR-004-ui-feedback-decoupling.md` | ADR-002 §2/§6/§7、ADR-003 §2/§7/§8、ADR-004 §2/§6/§7 |
| Epic | `production/epics/epic-breakdown.md` v0.1 | §2.1 AC1–AC4、§2.2 D-1~D-7、§3 Story 总览、§4 S-01~S-12 验收条件、§5 依赖图、§7.1 追溯矩阵 |
| 冲刺 | `production/sprint-01.md` v1.0 | §3 波次 W0~W5、§3.3 DoD、§3.4 范围红线、§4 已知风险、§5 未决事项 |

### 1.4 风险编号命名空间（避免两套 R 编号混淆）

用例「关联风险编号」字段必须带命名空间前缀：

| 前缀 | 含义 | 来源 |
| --- | --- | --- |
| `CR-n` | 概念侧设计风险 R1~R8 | `design/concept/game-concept.md` §9.1 |
| `MR-nn` | 架构控制清单风险 R-01~R-14 | `docs/architecture/control-manifest.md` §2.1 |
| `AR-002-Rn` / `AR-003-Rn` / `AR-004-Rn` | ADR 内风险 | 对应 ADR §6 |
| `SR-n` | 冲刺计划已知风险（级别 / 风险名） | `production/sprint-01.md` §4 |
| `AD-nn` | 美术圣经未决项 D-1~D-9 | `design/art/art-bible.md` 附录 D |

---

## 2. 验证驱动开发（VDD）：「用例齐备」与「实测判定」的严格区分

### 2.1 两个状态的定义（**不得混用**）

| 状态 | 定义 | 可声称的内容 | 本轮是否具备 |
| --- | --- | --- | --- |
| **用例齐备 Asset-Ready** | ① 每个 AC / DoD / Story / GDD 验收编号都有对应用例或明确标注的缺口；② 每条用例 10 个字段齐全、预期结果可观测可判定；③ 追溯矩阵逐行无遗漏；④ 准入门 / 出口门 / 准出门与阻塞规则明确；⑤ 证据路径与命名规范定义完毕；⑥ 用例经 QA 自评 ADEQUATE | 「资产已齐备，可进入实现」 | ✅ **是（本轮交付）** |
| **实测判定 Execution-Verdict** | 可玩垂直切片 + 真机 + 受试者 + 实际执行 + 原始证据 + PASS / FAIL / CONCERNS 结论 + 证据评审 ADEQUATE | 「AC1 通过 / AC2 未通过」等 | ❌ **否（完全未发生）** |

**禁止行为清单**：

- ❌ 因「用例写完了」而写「AC1 通过」「闭环已闭环」「质量已达标」。
- ❌ 把「用例齐备」填进准出门的「已通过」栏；准出门只记录实测结论。
- ❌ 在 `tests/playtest-report-template.md` 预填任何判定、时间、受试者数据或结论。
- ❌ 用「设计层 PASS（文档层）」冒充「实测 PASS」——`docs/architecture/architecture.md` §13 的 PASS 是**架构文档层**结论，不是 QA 实测结论。
- ❌ 把建议基线写成「已达 30fps」「<100ms 已满足」等定稿表述。
- ❌ 用汇总层九项（或十项）通过反推执行层 29 条 AC 通过；**也不得把 2 条 N/A 并入「通过」凑满 29**（判定链单向、N/A ≠ PASS，见 §1.2 / `design/ux/ux-spec.md` §8.2）。

### 2.2 VDD 流程与本轮所处位置

```
① 读 GDD / Story 验收条件 → ② 先写用例（用例落盘早于实现代码）
  → ③ 用例齐备评审（ADEQUATE / INCOMPLETE / MISSING）
  → ④ 按 Wave W0~W5 实现（程基岩）→ ⑤ 执行 + 采集证据
  → ⑥ 烟雾门控 PASS/FAIL → ⑦ 证据评审 → ⑧ AC/DoD 汇总判定
  → ⑨ 回归套件 + flaky 隔离 → ⑩ 准出建议（advisory）→ ⑪ 用户最终放行
```

**本轮位置：步骤 ①~③ 已完成（用例资产落盘 + 自评），步骤 ④ 尚未开始。** 步骤 ⑤~⑪ 全部为后续轮次工作，见 `tests/playtest-report-template.md` 抬头声明。

### 2.3 用例齐备评审门（进入 W0 前）

| 检查项 | 判定 |
| --- | --- |
| 每条用例含 10 个必备字段（ID / 覆盖编号 / 优先级 / 类型 / 前置 / 测试数据 / 编号步骤 / 可观测预期 / 实际结果与证据字段 / 关联风险编号） | ADEQUATE / INCOMPLETE / MISSING |
| 预期结果无「正常」「合理」「流畅」「符合预期」等模糊词 | ADEQUATE / INCOMPLETE |
| 每条用例存在 ≥1 条可观测、可判定的断言 | ADEQUATE / INCOMPLETE |
| 追溯矩阵每个上游验收编号均有映射行与状态标注 | ADEQUATE / INCOMPLETE |
| 平衡期占位符已登记且未出现编造数值 | ADEQUATE / INCOMPLETE |
| 未出现切片外功能作为前提（§11） | ADEQUATE / INCOMPLETE |

评审结果为 **INCOMPLETE / MISSING** 的用例不得进入 W0 冒烟。`tests/traceability-matrix.md` 的 GAP 清单是本轮齐备评审的**已知例外登记**，须在准出前逐条关闭。

---

## 3. 测试分层（五层）

| 层 | 名称 | 测什么 | 主要依据 | 类型 | 工具 / 产物 | 是否需要真机 |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | **数据层单测** | schema 序列化 / 32×32 上限 / 配置表注入与 `configHash` / 分区枚举 / 快照自包含 / 原子写与故障注入 | `production/epics/epic-breakdown.md` §4 S-02 / S-05 / S-10；ADR-002 §7；ADR-003 §8 | 自动 | 纯 TS 单测（脱离真机、mock `ISaveStorage`）、确定性回放断言 | 否 |
| L2 | **模拟层确定性回放** | `F(S_t, commands, config)` 纯函数、P0~P8 顺序、逐字节一致、默认暂停、InputGate 幂等、四因子单调性、D6 曲线、回退无逆运算 | `docs/architecture/architecture.md` §3；ADR-002；GDD 01~04 §7 | 自动 | 黄金路径回放、快照 + Δ + 归因链比对、配置注入回放 | 否 |
| L3 | **渲染与 UI 集成** | 双通道 <100ms 反馈、乐观视图回滚、常驻 3 指标、同屏 ≤1 数据面板、V1~V9 可达、L2 诊断面板、两级反馈、形态重排 | ADR-004；`design/ux/ux-spec.md` §3 / §8 | 自动 + 半自动 | 交互回归、截图回归、帧录制计时断言、去色 / 色盲模拟 | **是** |
| L4 | **系统回归 / 门禁** | AC1–AC4 汇总、D-1~D-7、G1~G12 复核、29 条 AC 执行层（含 2 条 N/A）+ 10 项汇总层（UX-A20 为 N/A）、S-01~S-12 验收条件逐条证据、性能基线校准（建议基线口径） | `tests/test-cases/dod-gates.md`；`docs/architecture/control-manifest.md` §3 | 半自动 + 证据评审 | 回归套件、检查表、校准报告、证据 ADEQUATE 评审 | **是** |
| L5 | **人工 Playtest** | AC1 无外部说明 10 min + 因果理解、AC3 Expression 主观复核、AC4 单次会议 5–12 min 节奏、慢 / 快受试者判定 | `design/concept/game-concept.md` §5.2；`tests/playtest-report-template.md` | 人工 | 招募 + 主持脚本 + 观察记录表 + 事后访谈 + 计时原始数据 | **是** |

**分层纪律**：L1/L2 不依赖真机与渲染，是 CI 信号的主干；L3/L4 真机结果须回写 L1/L2 的黄金路径；L5 主观结论不得替代 L1~L4 的可判定断言（AC1「理解因果」只能由 L5 判据判定，但「10 分钟内完成首个周期」须同时有 L2/L4 的事件链证据）。

---

## 4. 环境矩阵

### 4.1 构建与测量环境

| 项 | 口径 |
| --- | --- |
| 打包工具 | DevEco Studio → 签名 → HAP（`docs/architecture/architecture.md` §1.2） |
| 引擎链路 | Cocos Creator 3.x → HarmonyOS NEXT 导出；构建锁三要素（Cocos 小版本 / SDK·API / DevEco 版本）写入存档头 `engineVersion` |
| 平台 | HarmonyOS 7（开发者预览，SDK 26 / API 26）；K-1~K-5 为开放缺口，**S-01 空场景真机验证后按 `docs/architecture/control-manifest.md` §5.1 回填**，本策略不臆造机型 / 芯片 / API 名 |
| Profiling | DevEco Studio Profiler + Cocos Profiler + GPU 调试（`docs/architecture/architecture.md` §10.3 步 3） |

### 4.2 机型 × 形态矩阵（低 / 中 / 高档 × 手机竖屏 / 折叠展开 / 平板）

| 形态 \ 档位 | 低档 | 中档 | 高档 | 该形态测什么 |
| --- | --- | --- | --- | --- |
| **手机竖屏** | 必测（降级档 + 29 条 AC 复跑） | 必测（主验收场景） | 必测 | **唯一 Must 功能形态**：V1~V9 完整可达、单手、AC1~AC4 全部判定、29 条 AC、<100ms 反馈 |
| **折叠展开态** | 必测（性能 + 降级路径） | 必测（性能） | 必测（性能） | **仅性能测量形态 + 形态回退验证**：纯 UI 重排、不重建场景、不重置模拟状态、V1~V9 仍完整可达、可访问性与 <100ms 反馈不降级；**不实现、不测 H2 双栏特性** |
| **平板** | 必测（性能 + 降级路径） | 必测（性能） | 必测（性能） | 同折叠展开态；**不实现、不测平板侧栏双列布局**（Should） |

> **切片边界守卫**：折叠展开 / 平板进矩阵的依据是 `production/epics/epic-breakdown.md` §4 S-12 验收条件 4「校准覆盖机型矩阵含低档位机 × 手机竖屏 / 折叠展开 / 平板」与 §6「折叠展开态仅作为**性能测量形态**纳入机型矩阵，**不实现 H2 双栏特性**」。任何用例不得把「双栏布局正确性」写成首版必测功能。

### 4.3 每形态必跑的状态组合

| 维度 | 取值 | 依据 |
| --- | --- | --- |
| 系统字号 | 100% / 150% / 200% | `design/accessibility/accessibility-matrix.md` §2.4 / §5 |
| 动效开关 | 开 / 关（两态均覆盖 A-03 与 A-07） | 同上 §5 |
| 色觉模拟 | 正常 / deuteranopia / protanopia / tritanopia / 灰度 | 同上 §2.1 / §5 |
| 音频状态 | 正常 / 静音 | 同上 §2.8 |
| 性能档位 | 低 / 中 / 高（**低档位须完整复跑 29 条 AC**） | 同上 §2.9 / §5 |
| 生命周期 | 前台 / 切后台再进入 / surface 销毁重建 / 折叠态切换 | `production/epics/epic-breakdown.md` §4 S-01 / S-08 |

### 4.4 建议基线清单（**全部为建议基线 / 非承诺值，冻结前不得作 PASS 硬判据**）

| 指标 | 建议基线 | 来源 |
| --- | --- | --- |
| 目标帧率 | 30fps 稳定，复杂场景 ≥25fps | `design/art/art-bible.md` §9.4 |
| DrawCall | L0 ≤30 / L1 ≤60–80 / L2 ≤120（平板折叠可 ≤150） | 同上 |
| 应用总内存 | ≤300–400 MB（中端机） | 同上 |
| 常驻纹理内存 | ≤80–120 MB，峰值 ≤150 MB | 同上 §9.3 |
| 首包体积 | ≤150–200 MB，美术占比 ≤60% | 同上 §9.4 |
| 逻辑结算耗时 | 建议 p95 ≤16ms（32×32 满网格） | `docs/architecture/architecture.md` §10.1 |
| 「点按 → 可见反馈」 | <100ms（测**达标率 %**，非单次） | `docs/architecture/adr/ADR-004-ui-feedback-decoupling.md` §2 / §7 A1 |

> 用例中涉及上述数字时只写「记录实测值 / 记录达标率并与建议基线比对」，**不得写「应 ≤ 30fps」「应 < 100ms 判 PASS」**。达标判据须等 S-12 校准报告冻结并经主理人确认后另立版本（见 §13 GAP 清单）。

---

## 5. 准入门、波次出口门与准出门

### 5.1 准入门（进入 W0 之前）

| # | 条件 | 判定 |
| --- | --- | --- |
| A-1 | 上游文档版本锁定（§1.3 全部文件定稿版可读）；AC1–AC4 与 D-1~D-7 原文固定 | 逐份核对 |
| A-2 | 9 份测试资产落盘，用例齐备评审 ADEQUATE（§2.3） | 检查表 |
| A-3 | 平衡期数值口径确认：`<K>` / `<S_unlock>` / `<T_max>` / `<i_ref>` / `<w_i>` 等一律占位、由配置表注入（`design/gdd/systems-index.md` §7.1） | 占位符扫描 |
| A-4 | 构建锁（Cocos 小版本 / SDK·API / DevEco）与机型矩阵表到位；K-1~K-5 回填计划确认（`production/sprint-01.md` §3.2 W0） | 记录核对 |
| A-5 | 受试者招募方案、知情同意文本、主持脚本经主理人批准 | 文档核对 |
| A-6 | 测试侧占位参数（§10.2）由用户 / 主理人确认或明确登记为开放项 | 开放项登记 |
| A-7 | 任一 H1~H3 特性未排期、feature flag 默认全关（`docs/architecture/control-manifest.md` §1.7 / G8） | 静态检查 |

### 5.2 波次出口门（W0~W5）

逐波次最小可跑冒烟集合见 `tests/smoke-checklist.md`。**任一冒烟项「失败即停」规则命中，该波次出口门判 FAIL，不得进入下一波次**；FAIL 即「未达 QA」（advisory 判定，最终是否放行由用户决定）。

### 5.3 准出门（DoD / S-12，全部满足方可给 PASS 建议）

| # | 条件 | 证据 |
| --- | --- | --- |
| E-1 | AC1 / AC2 / AC3 / AC4 **逐条实测 PASS**（含 L5 人工 Playtest 判定） | Playtest 报告 + 事件链证据 + 回放记录 |
| E-2 | D-1~D-7 全部门禁通过 | `tests/test-cases/dod-gates.md` 检查表 |
| E-3 | **执行层 27 条可判 AC 全部通过 + 2 条 N/A 显式登记 → 汇总层 UX-A11~A19 九项通过 + UX-A20 N/A 登记 → 可访问性 Standard 达标**；**N/A ≠ PASS，不计入通过分子**；低档位完整复跑留记录；反向不成立 | 29 条逐条记录（含 2 条 N/A 理由与条件重开条款）+ 10↔29 汇总映射表 |
| E-4 | G1~G12 复核；S-01~S-12 每条验收条件有对应证据 | 门禁检查表 + Story 用例索引 |
| E-5 | 证据评审全部 ADEQUATE；无 INCOMPLETE / MISSING 未关闭项 | 证据评审记录 |
| E-6 | 无未关闭 S1 / S2 缺陷；S3 / S4 已登记进回归清单；flaky 用例已隔离 | 缺陷台账 + flaky 隔离记录 |
| E-7 | S-12「建议 → 硬指标」校准报告产出；**§9.4 / §10.1 数字仍标「建议基线」直至主理人确认冻结** | 校准报告 |
| E-8 | 回归套件通过；已修缺陷均有回归用例 | 回归执行记录 |
| E-9 | 切片外功能逐项确认「确实没有」；H1~H4 逐项确认「未进 Must」 | 范围红线复核表 |

**准出判定档位**：`PASS`（全部满足）/ `CONCERNS`（存在 GAP 或建议基线未冻结但不阻塞闭环）/ `FAIL`（AC/门禁任一 FAIL 或存在未关闭 S1/S2）。本轮**不产出任何准出判定**，仅交付规则。

---

## 6. 缺陷分级 S1~S4 与阻塞规则

| 级别 | 等价严重度 | 定义（可判定触发条件） | 阻塞规则 |
| --- | --- | --- | --- |
| **S1** | Blocker / 阻断 | AC1~AC4 任一 FAIL；D-1~D-7 任一门禁 FAIL；执行层 29 条 AC 任一 Must 不通过；确定性被破坏（回放字节不一致）；归因链缺失 / 被重算；存档损坏导致丢进度；启动即崩溃；V1~V9 任一不可达；出现「失败终局」分支 | **立即停止该波次全部测试**，锁定现场证据，退回实现；修复后须重跑该波次全部冒烟 + 相关回归；**未关闭不得进入下一波次、不得准出** |
| **S2** | Critical / 严重 | 单条 GDD 验收编号（AC-F*/M*/T*/E*/I*）FAIL；V2 诊不可用或诊断面板无明细；回退后归因 / 议题 / 结余不一致；两级反馈分离失效；<100ms 反馈达标率显著偏离建议基线（记录口径）；议题数 >4 且不折叠；可访问性项被性能降级触碰 | 阻断准出；允许继续执行其余用例以收集完整缺陷面；累计达 `<N_S2>` 条（占位，见 §10.2）即按 S1 处理 |
| **S3** | Major / 一般 | 非核心 UI 边缘情况（局部截断、面板互斥偶发失效、非关键动效异常）；文案与聚合数据方向不一致但不影响判定；单条 UX-AC 子项不达标但有可操作绕行路径 | 不阻断准出；须登记 workaround、关联用例与风险编号，进回归清单 |
| **S4** | Minor / 轻微 | 错字、图标像素对齐、色值微差但对比度仍达标、日志冗余 | 不阻断准出；登记待修，不单独触发回归 |

**Bug 报告必备字段**（写入 `tests/playtest-report-template.md` 缺陷列表）：Bug ID / 严重度 S1~S4 / 关联用例 ID / 环境（机型档位 + 形态 + 字号 + 动效 + 色觉 + 音频 + 性能档位 + 构建锁版本）/ 前置条件 / 编号复现步骤 / 预期结果（引用用例预期原文）/ 实际结果 / 证据路径（截图 / 日志 / 存档 / 帧录制）/ 关联风险编号 / 回归用例 ID / 状态。

**flaky 测试纪律**：连续 3 次执行中出现 ≥1 次结果不一致即标记 `FLAKY`，从 CI 门禁信号中**隔离**（不删除、不计入 PASS/FAIL），单列 `tests/regression-suite.md`（后续轮次产出）并给根因；**不得以「重跑一次就过了」关闭**。

---

## 7. 证据留存规范

### 7.1 根目录与命名

```
tests/evidence/<batch-id>/            # batch-id 例：W3-20261105-01（执行时创建，本轮不创建）
├── screenshots/<TC-ID>_<step-no>_<device>_<state>.png
├── logs/<TC-ID>_<timestamp>.log       # 须含 tickId / schemaVersion / configHash / engineVersion / seed
├── saves/<TC-ID>_<tickId>.snap        # 自包含快照 + 冷归档，供确定性回放
├── frames/<TC-ID>_<device>_<fps>.mp4  # 帧录制：<100ms 计时、动效可关、去色校验
├── timing/<TC-ID>_wall.csv            # AC1 / AC4 计时原始数据（起止 / 暂停段 / 外部中断）
├── playtest/<subject-id>/{consent,observation,interview}.md
├── calibration/S12-baseline.md       # 建议 → 硬指标校准报告
└── review/<batch-id>-evidence-review.md  # ADEQUATE / INCOMPLETE / MISSING 评审
```

> 路径为**规范定义**，本轮不创建 `tests/evidence/` 目录、不产出任何证据文件。

### 7.2 四类证据与最低要求

| 类型 | 用途 | 最低要求 |
| --- | --- | --- |
| 截图 | 视觉 / 可访问性 / HUD 断言 | 含设备形态、字号、色觉模拟、动效开关、性能档位标注；去色 / 三型模拟各一份 |
| 日志 | 模拟 / 归因 / 回放 / 缺陷复现 | 含 `tickId` / `schemaVersion` / `configHash` / `engineVersion` / PRNG `seed` / 命令溯源（`docs/architecture/architecture.md` §4.1） |
| 存档文件 | 确定性回放、断点续玩、跨周期归因 | 自包含 `TickSnapshot` + 其后 Delta + ≥3 周期冷归档（ADR-002 §2 / ADR-003 §2） |
| 帧录制 | <100ms 即时反馈、动效可关、状态切换 | 标注起帧时间戳与首帧可见反馈时间戳；测**达标率 %**；开启「减少动态效果」前后各一份 |

### 7.3 证据评审判定

| 判定 | 含义 |
| --- | --- |
| **ADEQUATE** | 每条断言均有对应证据、可复现、命名与元数据齐备、无缺失字段 |
| **INCOMPLETE** | 有证据但缺元数据 / 缺部分步骤 / 缺对照态（如只测了动效开未测关） |
| **MISSING** | 无任何证据或证据与用例 ID 无法对应 |

MISSING / INCOMPLETE 的用例**一律不计入 PASS**，须补证后重判；证据文件只追加、不覆盖、不事后改写（与 `docs/architecture/control-manifest.md` §6「风险状态变更须留证据路径，不静默关闭」一致）。

---

## 8. 角色责任（RACI）

| 事项 | 负责 | 协同 | 批准 / 放行 |
| --- | --- | --- | --- |
| 测试策略、用例、检查表、追溯矩阵、报告模板 | 严守真（QA Lead） | — | 主理人复核 |
| AC1–AC4 / D-1~D-7 **实测判定**、烟雾门控、Bug 报告与分级、证据评审、Playtest 报告、flaky 隔离 | 严守真 | — | **用户最终放行** |
| 平衡期数值钉定：`<K>` / `<S_unlock>` / `<T_max>` / `<i_ref>` / `<w_i>` / `α` / `λ` / 议题阈值 | 文策渊（design-strategist） | 主理人 | 用户拍板（如需变更 OD） |
| 实现、L1/L2 单测脚手架、确定性回放、构建锁、S-12 校准报告、K-1~K-5 回填 | 程基岩（engineering-lead） | 性能 / DevOps / 平台适配 | 主理人确认回填结论 |
| 色板 / 图案 / 形状编码资产、三型色盲模拟、对比度静态校验工具 | 林绘澄（art-director） | 架构 | — |
| 音频事件 → 视觉等价物清单（AC-A08-1） | 音频侧（经主理人中转） | UX | 主理人 |
| 字体授权确认 | 法务 | 架构 / 美术 | — |
| 范围门禁、跨专业裁定、性能硬指标冻结确认、最终放行中转 | 游承峰（主理人） | 全体 | **用户** |
| AC / DoD / Must 集合 / 切片边界变更、准出签字 | **用户** | — | — |

> 依据：`production/epics/epic-breakdown.md` §0.2 / §7.2 P-6、§7.2 P-7；`docs/architecture/control-manifest.md` §2.2「测试」条目；`production/sprint-01.md` §5 第 4 项。

---

## 9. 测试稳定性与回归

- L1/L2 为 CI 主干信号；L3/L4 真机结果回写黄金路径；L5 不进 CI。
- 每个已关闭缺陷（含 S3/S4）须补一条回归用例，编号写入 `tests/regression-suite.md`（后续轮次产出，本轮不创建）。
- 配置表变更（`configHash` 升级）后，L2 全部回放用例须重跑；引擎 / SDK 版本升级后强制重跑 S-12 校准（`docs/architecture/control-manifest.md` §1.8）。
- 回归范围映射到 `design/concept/game-concept.md` §5.2 的七条规则 R1~R7 与 V1~V9 关键路径，不按「文件内容量」划分。

---

## 10. 占位符与数字纪律

### 10.1 上游平衡期占位（**不得编造具体数字**）

| 占位符 | 含义 | 来源 | 钉定时机 |
| --- | --- | --- | --- |
| `<K>` | 每市政周期 tick 数 | `design/gdd/systems/01-satisfaction-simulation.md` §8.1 O-4；`design/gdd/systems/04-budget-economy.md` §8.1 O-5；`design/ux/ux-spec.md` §9.1 O-2 | 平衡期定，**S-12 前钉定**，配置表注入 |
| `<S_unlock>` | 周期达标线（分） | `design/gdd/systems/02-map-zoning.md` §3.5；01 O-4；04 §4 | 同上 |
| `<T_max>` / `<T_0>` / `<T_s,max>` / `<E_max>` | 通勤 / 覆盖 / 环境阈值 [min / LU] | `design/gdd/systems/01-satisfaction-simulation.md` §4.1；03 §8.1 O-1 | 同上；`<T_max>` 须 01 / 03 同值 |
| `<i_ref>` | 人均参考投入 [CU/(person·周期)] | 01 §4.1；04 §4 | 同上 |
| `<w_i>` / `α` / `λ` / `f_floor` | 4 因子权重与合成参数 | 01 §4.2 | 同上 |
| `<I_min>` / `<B_floor>` / `<B_cap>` | 经济软着陆兜底 | `design/gdd/systems/04-budget-economy.md` §3.3 / §4 | 同上 |
| `<θ_i>` / `<θ_cong>` / `<ρ_lo>` / `<ρ_hi>` / `<k>` | 议题触发 / 消退阈值 | `design/gdd/systems/05-issues-diagnosis.md` §4 / §8.1 O-1 | 同上 |
| `<p_unit>` / `<j_C>` / `<j_I>` / `<r_labor>` / `d(D1..D3)` | 人口 / 岗位 / 密度系数 | `design/gdd/systems/02-map-zoning.md` §4 / §8.1 O-1 | 同上 |

### 10.2 测试侧占位（**本策略自定义，需用户 / 主理人确认，见 §13 开放项**）

| 占位符 | 含义 | 出现位置 |
| --- | --- | --- |
| `<Δ_zone>` / `<Δ_road>` | AC3「方案差异度」的分区 / 路网差异阈值 | `tests/test-cases/AC3-no-dominant-strategy.md` |
| `<T_idle>` | 计时口径中「静止无操作段」的剔除阈值 | `tests/test-cases/AC4-session-length.md` |
| `<T_slow_ceiling>` | 慢类受试者墙钟时长上界 | 同上 |
| `<N_playtest>` | AC1 / AC4 Playtest 受试者样本量 | `tests/test-cases/AC1-onboarding.md` / AC4 / 报告模板 |
| `<N_S2>` | S2 缺陷累计升格 S1 的条数 | 本策略 §6 |

**纪律**：用例中出现上述占位符即表示**最终判定阈值未定**；该用例为「结构齐备、阈值待定」状态，须在 `tests/traceability-matrix.md` GAP 清单登记，不得自行填数。

---

## 11. 切片边界与范围红线（用例前提禁用清单）

以下内容**不得作为任何用例的前提、步骤或预期**（依据 `design/concept/game-concept.md` §5.2、`production/epics/epic-breakdown.md` §1.3、`production/sprint-01.md` §3.4）：

公共交通 / 政策卡 / 地价 / 多道路等级 / 独立危机事件系统 / 跨设备流转 / 折叠屏双栏 / 季节昼夜 / 成就 / 分享 / ×1×2×4 自动播放 / 自动播放开关 / 倒计时条 / 具象个体市民 / 无尽地图 / 付费加速 / 内购 / 第二终局轴 / 逐栋摆楼 / 逐车个体仿真 / 独立暂停菜单 / 多存档位 / 云同步 / 分区级满意度差异。

**H1 秒启卡片 / H2 折叠双栏 / H3 跨设备流转 / H4 分布式多机同局**：不得当作首版必测功能；H4 为 Won't。折叠展开态与平板**仅作为性能测量形态与降级路径验证**（§4.2）。

**范围纪律**：新增 Must 须等量移除一个既有 Must 并回到用户确认（`design/concept/game-concept.md` §5.1 准入纪律）；切片验收看「闭环通不通」，不看「内容多不多」。

---

## 12. 追溯矩阵与覆盖缺口口径

- `tests/traceability-matrix.md` 对 AC1–AC4 / D-1~D-7 / UX-AC1~9 / **29 条执行层 AC（27 可判 + 2 条 N/A）** / **10 项汇总层（UX-A20 为 N/A）** / S-01~S-12 / **38 条 GDD 验收编号** / G1~G12 / W0~W5 / 用例编号**逐行映射**（分母 **121**，见矩阵 §1.1）。
- **「追溯矩阵无缺口」的定义**：矩阵中每个上游验收编号都有映射行，且每行都有明确状态、指向与责任/前置标注 —— 即**追溯链无断点**；**不等于「每个验收项都已有可执行并已通过的用例」**。
- 覆盖状态枚举：`COVERED`（用例齐备·待执行）/ `PARTIAL`（部分覆盖或阈值待定）/ `PLAYTEST-ONLY`（仅人工 Playtest 可判定）/ `NEEDS-BUILD`（须等可玩版本或校准报告才能补判据）/ `GAP`（尚无用例）。
- 全局状态：**本轮全部用例均为「待执行」**；凡依赖真机 / 受试者 / 校准报告的项另标 `NEEDS-BUILD`。
- GAP 清单须逐条给出：缺口编号、影响的验收项、原因、关闭条件、责任侧、期望关闭时机（准出前 / S-12 前 / 用户拍板后）。

---

## 13. 开放项登记（需用户或其他角色确认）

| # | 开放项 | 归属 | 阻塞什么 |
| --- | --- | --- | --- |
| O-1 | 平衡期数值 `<K>` / `<S_unlock>` / `<T_max>` / `<i_ref>` / `<w_i>` 等钉定（`production/sprint-01.md` §5 第 1 项：S-12 前钉定） | 文策渊 + 主理人 | AC1/AC3/AC4 的最终阈值判定 |
| O-2 | 测试侧占位参数 `<Δ_zone>` / `<Δ_road>` / `<T_idle>` / `<T_slow_ceiling>` / `<N_playtest>` / `<N_S2>` | 用户 / 主理人 | AC3 差异度、AC4 计时与样本量、S2 升格规则 |
| O-3 | **AC4 计时口径裁定**：主判据采用含暂停态思考的墙钟时长，辅助指标 `T_active` 仅用于归因（详见 `tests/test-cases/AC4-session-length.md` §1） | 用户 / 主理人 | AC4 全部用例判定 |
| O-4 | Playtest 受试者招募条件与样本量、知情同意文本、主持脚本批准 | 主理人 | L5 全部执行 |
| O-5 | 性能硬指标冻结（S-12 校准报告产出后，`production/sprint-01.md` §5 第 2 项） | 主理人 | D-5 / G7 的 PASS 硬判据 |
| O-6 | 音频事件 → 视觉等价物清单（AC-A08-1，`design/accessibility/accessibility-matrix.md` §4.3 O-1） | 音频侧（经主理人中转） | AC-A08-1 用例可执行性 |
| O-7 | 色盲模拟 / 对比度自动校验是否接入运行时或 CI（矩阵 §4.1 E-8） | 架构 + 美术 | 29 条 AC 中 A-01 / A-02 的自动化程度 |
| O-8 | K-1~K-5 回填结论（`docs/architecture/control-manifest.md` §5.1） | 架构主责 / 主理人确认 | G11 复核、机型矩阵最终档位定义 |
| O-9 | 议题条默认折叠 / `TUTORIAL` 卡是否占 3±1 名额等 UX 开放项（`design/ux/ux-spec.md` §9.1 O-1；GDD 05 §8.1 O-4） | 文策渊 + 主理人 | UX-AC9 / AC-I2 判据细节 |
| O-10 | 产品正式命名（本策略统一用 HC-01） | 用户 | 对外材料，不阻塞用例 |

---

## 14. 变更纪律

1. AC1–AC4 原文、D-1~D-7、Must 集合、切片边界、OD-1~OD-4：**仅用户可变更**；变更须同步重审全部用例与追溯矩阵。
2. 性能数字：冻结前一律标「建议基线 / 非承诺值」；冻结动作须主理人确认并回写 `docs/architecture/architecture.md` §10.1。
3. 用例新增 / 修改须同步更新 `tests/traceability-matrix.md` 与 `tests/test-cases/dod-gates.md` 的 Story 索引，保持编号可追溯。
4. 本策略及下属 9 份文档的任何 Write / Edit 须先经用户许可；本轮**未提交代码、未调用 git、未修改 `design/` `docs/` `production/` 任何文件**。
5. 跨文档引用一律带文件名与章节号（`production/sprint-01.md` §2.4「流程固化 R-N1」）。

---

*文档结束 · v1.0 · **用例资产齐备；实测判定仍待执行** · 质量闭环补满 = 用例齐备 + 追溯矩阵无缺口 + 准出规则明确；实测判定仍待执行。*
