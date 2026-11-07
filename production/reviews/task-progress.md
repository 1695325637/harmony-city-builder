# HC-01 · 项目任务逐条清单与进度汇总

| 项 | 内容 |
| --- | --- |
| 生成时间 | 2026-11-07 16:56（GMT+8） |
| 数据源 | 共享任务台账（60 条）+ git 提交历史 + `production/reviews/s12-closure.md` + 当前工作树复跑 |
| 任务口径 | 这里的「完成」指**该任务交付物已落盘并复跑通过**；不等于 S-12 整体 PASS、也不等于真机验证 |
| 当前 HEAD | `5a15206` · 工作树干净 |
| 当前验证 | **571 tests / 569 pass / 0 fail / 2 skipped**；tsc 三入口 EXIT=0 |

> **结论先行**：60 条任务 **59 completed / 1 in_progress / 0 pending**。
> 唯一未完成的 #59 是 **S-12 真机侧**，属用户拍板的「分期结项：离线 PASS + 真机 BLOCKED」中的未结半侧，
> 阻塞原因是**缺少真机介质**（EX-01/02/03、K-4）与三条待恢复的 fresh-eyes 复核，不是实现缺陷。

---

## 一、逐条清单（60 条，按阶段分组）

### 阶段 1 · 概念与设计资产（#1–#10，10/10 完成）

| # | 任务 | 负责人 | 状态 |
| --- | --- | --- | --- |
| 1 | T-102 编写美术圣经（视觉身份九节 + 资产清单 + 决策点） | art-director | ✅ completed |
| 2 | T-101 撰写游戏概念文档（P0，阻塞后续系统设计） | design-strategist | ✅ completed |
| 3 | T-105 编写架构文档 / ADR / 控制清单 / Epic 拆分 | engineering-lead | ✅ completed |
| 4 | T-104 概念升 v1.0 + 系统拆解与 5 份逐系统 GDD + UX 规格 | design-strategist | ✅ completed |
| 5 | T-103 设计评审门后美术圣经 v0.2 回改（10 条裁定收敛） | art-director | ✅ completed |
| 6 | T-106 第二波美术收尾：资产规格 + 可访问性矩阵 | art-director | ✅ completed |
| 7 | T-107 架构评审门回执 + 跨专业冲突关闭 + G11 回执 | engineering-lead | ✅ completed |
| 8 | T-108 架构评审门收尾：矩阵升 v0.2 + art-bible D-3 关闭 | art-director | ✅ completed |
| 9 | T-109 架构回执收口 + GDD/UX 验收口径对齐 | design-strategist | ✅ completed |
| 10 | T-110 回改 game-concept.md 9.2 架构确认状态（交付闭环最后一项） | design-strategist | ✅ completed |

### 阶段 2 · W1~W2 纯逻辑层（#11–#16，6/6 完成）

| # | 任务 | 负责人 | 状态 |
| --- | --- | --- | --- |
| 11 | T-112 Phase 5 / W1~W2 纯逻辑层实现（S-02 + S-03） | engineering-lead | ✅ completed |
| 12 | T-114 W1~W2 纯逻辑层独立验证（第二层 QA） | quality-lead | ✅ completed |
| 13 | T-113 Phase 5 设计评审与范围检查 + GDD 01 两处口径裁定 | design-strategist | ✅ completed |
| 14 | T-115 w1-w2-verification.md 状态收口（D-01 升 S1 / W1 改判 FAIL） | quality-lead | ✅ completed |
| 15 | T-116 W1 出口门缺口修复：D-01 + S-04 性能证据 + S-05 冷归档 | — | ✅ completed |
| 16 | T-117 独立复核 T-116 修复并重判 W1/W2 出口门 | — | ✅ completed |

### 阶段 3 · W3 渲染 / UI / 竖屏 HUD（#17–#36，20/20 完成）

| # | 任务 | 负责人 | 状态 |
| --- | --- | --- | --- |
| 17 | T-118 S-06 等距渲染层与图集分包（渲染内核 + Cocos 适配 + 预览） | — | ✅ completed |
| 18 | T-119 S-06 渲染层独立复核与 W3 质量门判定 | — | ✅ completed |
| 19 | T-120 S-06 渲染层美术符合性评审（只读） | art-director | ✅ completed |
| 20 | T-121 S-06 复核后修复批（A-01/02/04/05/06 + P-01 + D-06/07/08） | — | ✅ completed |
| 21 | T-123 art-bible v0.2.1 单点修订（A-10 文字承载例外） | art-director | ✅ completed |
| 22 | T-122 S-07 UI 双通道与 <100ms 即时反馈实现 | engineering-ui | ✅ completed |
| 23 | T-124 T-121 修复批独立复核（S-06 闭环） | — | ✅ completed |
| 24 | T-125 A-01/02/04/05/06 复评（只读） | art-director | ✅ completed |
| 25 | T-126 预览页单文件离线版 + P-02 布局与拾取换算修复 | — | ✅ completed |
| 26 | T-127 asset-spec §0.3 子类词表补全 + 9 条订正对照表 | art-director | ✅ completed |
| 27 | S-07 复核后补批：token-contract 用例 + 口径注释 + D-14 编译期断言 | engineering-lead | ✅ completed |
| 28 | T-128 S-07「UI 双通道」独立复核与层门判定 | — | ✅ completed |
| 29 | T-129 形状门控 + 命名订正 + 跨层令牌契约 | — | ✅ completed |
| 30 | T-130 GDD 03 流线三态判定口径 + AC-T8 + O-5（S-08 前置） | design-strategist | ✅ completed |
| 31 | S-08 批追加项汇总（A~G：阈值/枚举/OpaqueSwatch/a11y 低档/D-13/拆除分歧） | — | ✅ completed |
| 32 | T-132 GDD 03 v1.1 下游同步（tests/ 两处）+ S-06 门收口 | — | ✅ completed |
| 33 | 与 engineering-lead 对账并合并契约用例原 6 条 | — | ✅ completed |
| 34 | T-133 S-08 前置：模拟层补 flowState | — | ✅ completed |
| 35 | S-08 竖屏 HUD / 议题 / 建造与预算交互（`src/ui/hud/**`） | engineering-ui | ✅ completed |
| 36 | W3 出口独立复核：AC-T8 五点 + 令牌契约 + D-13 + GAP-13 | — | ✅ completed |

### 阶段 4 · W3 S-09 诊断面板 V2（#37–#42，6/6 完成）

| # | 任务 | 负责人 | 状态 |
| --- | --- | --- | --- |
| 37 | T-134 S-09 第一批 A 线 · 诊断数据层（只读查询 VM） | engineering-ui | ✅ completed |
| 38 | T-135 S-09 第一批 B 线 · 真实 flowState 接线 | — | ✅ completed |
| 39 | T-136 S-09 第一批独立复核（A 线 + B 线） | — | ✅ completed |
| 40 | T-137 S-09 第二批 C 线 · 模拟层补 edgeCells + 生产侧映射生成器 | — | ✅ completed |
| 41 | T-138 S-09 第二批 D 线 · L2 诊断面板 UI + 两级反馈 + D-16 | engineering-ui | ✅ completed |
| 42 | T-139 S-09 第二批独立复核（C 线 + D 线） | — | ✅ completed |

### 阶段 5 · W4 存档 / 回退 / 解锁（#43–#49，7/7 完成）

| # | 任务 | 负责人 | 状态 |
| --- | --- | --- | --- |
| 43 | T-140 S-10 第一批 E 线 · 本地存档层 | — | ✅ completed |
| 44 | T-141 S-10 第一批 F 线 · D-03 幂等契约显式化 | engineering-ui | ✅ completed |
| 45 | T-141 裁定落地 · 最小文档更新（两项裁定 + 复跑回执） | engineering-ui | ✅ completed |
| 46 | T-142 S-10 第一批独立复核与出门判定 | quality-lead | ✅ completed |
| 47 | T-143 S-11 第一批 G 线 · 回退内核 | — | ✅ completed |
| 48 | T-144 S-11 第一批 H 线 · 周期末单轴判定 + V9 解锁 + 软着陆 | engineering-ui | ✅ completed |
| 49 | T-145 S-11 门复核 + 4 条守卫按 S-11 语义升级 | quality-lead | ✅ completed |

### 阶段 6 · W5 / S-12 闭环集成（#50–#60，10/11 完成）

| # | 任务 | 负责人 | 状态 | 关键交付 |
| --- | --- | --- | --- | --- |
| 50 | S-12 真机性能基线校准执行手册 + 原始记录表 | s12-runbook | ✅ completed | `production/calibration/` 745 + 235 行；§10.1 七行逐字一致，不冻结数字 |
| 51 | 修复 a11y `assertSpacing` 永真断言（AC-A05-2 可判定化） | s12-a11y-api | ✅ completed | `gapDp` 字段 + 真判间距、未声明显式抛错、修 off-by-one |
| 52 | 设计侧：补 2 条 A-10 官方 AC + 热区 44→48dp 全文档落地 | s12-design-a11y | ✅ completed | 矩阵 v0.3（29 条）/ art-bible v0.3 / ux-spec 计数同步 |
| 53 | 文档侧：热区 44→48dp 落 architecture/ADR-004/control-manifest/epic-breakdown | s12-arch-sweep | ✅ completed | ADR 正文冻结 + Amendment A-1；✅ 降级待验 |
| 54 | T-146 热区基线 44→48dp：常量 + 边界用例 | engineering-ui | ✅ completed | `MIN_TAP_TARGET_DP=48` + 47 抛/48 过 + 双向棘轮 `!==40`/`!==44` |
| 55 | 验收 2 可访问性离线门禁 + 29 条 AC 分档台账 + 追溯矩阵订正 | s12-a11y-gate | ✅ completed | `s12-a11y-gate.test.ts`；A9/B14/C2/N-A2；牙齿自证两处 |
| 56 | 四处对比度 / 口径歧义美术裁定建议（只读） | s12-art-rulings | ✅ completed | disabled 1.70 / inkWeak 2.31 / CIVIC 3.97 / thumbZone 口径；三处实测复现 |
| 57 | HUD 三段比例 0.10/0.70/0.20 + inkWeak 降非文字令牌 + 静态扫描守卫 | s12-layout-code → 主理人接手 | ✅ completed | ADR-005；`token-text-safety.test.ts` 5 条（原 worker 429 中断） |
| 58 | 验收 3 降级顺序可执行契约 + 分期结项报告 + EX-04 窗口到期登记 | 主理人 | ✅ completed | `degradation-plan.ts` + DP-1~6；`s12-closure.md`；quality-closure v1.3 |
| **59** | **S-12 真机侧待执行：EX-01/02/03 + K-4 + 验收 1/4/5 + 三条 fresh-eyes 复核** | — | 🔄 **in_progress** | **唯一未完成项**，详见 §三 |
| 60 | S-12 组合根接线（初始态 tick 0 归档 / P8 落盘 / 强存 / 回退·解锁后补存） | 主理人 | ✅ completed | `src/composition.ts` 220 行 + `composition-root.test.ts` CR-1~7 |

---

## 二、进度汇总

### 2.1 按任务状态

| 状态 | 条数 | 占比 |
| --- | --- | --- |
| ✅ completed | 59 | 98.3% |
| 🔄 in_progress | 1 | 1.7% |
| ⏳ pending | 0 | 0% |
| **合计** | **60** | 100% |

### 2.2 按阶段

| 阶段 | 范围 | 完成 | 进度 |
| --- | --- | --- | --- |
| 概念与设计资产 | #1–#10 | 10/10 | 100% |
| W1~W2 纯逻辑层 | #11–#16 | 6/6 | 100% |
| W3 渲染 / UI / HUD | #17–#36 | 20/20 | 100% |
| W3 S-09 诊断面板 | #37–#42 | 6/6 | 100% |
| W4 存档 / 回退 / 解锁 | #43–#49 | 7/7 | 100% |
| W5 / S-12 闭环集成 | #50–#60 | 10/11 | **91%**（离线侧 100%，真机侧 0%） |

### 2.3 测试规模演进

| 节点 | 全量用例 | 结果 |
| --- | --- | --- |
| W1~W2 基线 | 234 | 234/234 |
| W3 收口 | 289 | 289/289 |
| S-09 收口 | 394 | 394/394 |
| S-10 收口 | 463 | 463/463 |
| S-11 收口 | 524 | 524/524 |
| S-12 离线批 | 553 → 558 → 564 → 571 | **571 / 569 pass / 0 fail / 2 skipped** |

### 2.4 S-12 六条验收判定（来自 `production/reviews/s12-closure.md`）

| # | 验收 | 判定 |
| --- | --- | --- |
| 1 | AC1~AC4 汇总 + DoD D-1~D-7 全部门禁 | **BLOCKED**（真机 / Playtest） |
| 2 | 可访问性 Standard 全项（低档仍满足） | **PARTIAL**（离线侧收口，非全项达成） |
| 3 | §10.4 降级顺序不触碰可访问性与 <100ms | **PASS**（离线契约层）／真机半侧 PARTIAL |
| 4 | 校准覆盖 10 项 + 机型矩阵 | **BLOCKED**（无任何实测值） |
| 5 | 「建议 → 硬指标」报告并回写 §10.1 | **BLOCKED**（冻结属 P-7，表体未动） |
| 6 | H1~H4 零阻塞复核 | **PASS**（结构复核，四项均零阻塞） |

> **禁语三句**：「可访问性 Standard 29 条全通过」（N/A ≠ PASS）／「性能已达标」（未冻结、无实测）／「48dp 已重验」（须真机真实渲染热区矩形）。

---

## 三、唯一未完成项 #59 展开（准出阻塞，不因离线收口解除）

**A. 三条 fresh-eyes 独立复核**（限流重置 2026-11-08 09:17 后派发；本批主理人代改过验收层，按纪律必须复核）
1. `s12-a11y-gate` 复核 `AC-A10-1` 新口径、`LAY-7`、`degradation-plan.test.ts`、`token-text-safety.test.ts`、`composition-root.test.ts`；
2. `s12-arch-sweep` 复核并署名 `production/reviews/s12-architecture-evidence.md`（三层证据链）；
3. `s12-design-a11y` 核对 `ux-spec` 主理人代改段（判定链 29/十项、UX-A20 行、UX-A13、L280 笔误订正）。

**B. 真机环境就绪后**（EX-04 已登记「S-12 窗口到期、准出阻塞不解除」）
- EX-01 `SM-W1-04` 生命周期；EX-02 S-06 ③b 格式探测写入校准记录；
- EX-03 / K-4 沙箱 KV、HAP 权限模型、包体上限（K-1~K-5 不得凭猜测回填）；
- 验收 4 十项测量 + 机型矩阵、验收 5 报告与 §10.1 候选值回写；
- 验收 1 AC1~AC4 汇总判定 + DoD D-1~D-5 门禁；
- 组合根真机半侧：`onBackground()` 目前是注入式方法，须在真机生命周期回调实际接入并验证杀进程 / 切后台的真实持久化（**接线 ≠ 验证**）。

执行依据：`production/calibration/device-calibration-runbook.md`（745 行）+ `raw-measurement-sheet.md`（235 行）。

**C. 仍开放但不阻塞结项**（登记留痕）：软着陆 GDD 04 §3.3②「抑制新增建设」、解锁形状「边长阶梯 +2」钉定、跨会话全局幂等（H3 开启时由 SaveService epoch 命名空间承担）、`AC-A05-2` 生产侧接线（三条重验门槛）。

---

## 四、环境事实（本轮无法绕过的硬墙）

本机实测 **无 `deveco` / 无 `hdc` / 无 `~/.ohos` SDK / 无 Cocos 工程**；`src/` 是引擎无关纯逻辑 + 注入式适配，`preview/` 是程序化占位单文件。因此验收 1 / 4 / 5 与 EX-01/02/03、K-4 **本质依赖真机介质**，离线不可代做。五项工作流于 2026-11-07 撞 429 频率限制，配额重置时间 2026-11-08 09:17:55。

---

*文档结束 · v1.0 · 60 条逐条清单 · 59 completed / 1 in_progress · 判定以工作树与 `s12-closure.md` 为准，不产生「S-12 整体 PASS」结论*
