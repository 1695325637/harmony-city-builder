# HC-01 项目收尾归档与汇报总结报告

| 项 | 内容 |
| --- | --- |
| 文档 | `production/reviews/project-closure-report.md` |
| 工作代号 | **HC-01**（仅用于文档索引，**非产品名**；正式名称待补充） |
| 报告性质 | 项目收尾归档 / 阶段汇报 |
| 编制日期 | 2026-11-09 |
| 冻结基线 | git `c22ce50`（2026-11-07），远端 `main` 与本地 `HEAD` 一致 |
| 数据来源 | 本仓库 `design/` `docs/` `production/` `src/` `tests/` `preview/` 全部文件、git 提交历史（22 条）、`production/reviews/` 各阶段回顾、`production/reviews/task-progress.md`、`production/reviews/s12-closure.md`、`tests/quality-closure.md`、`.workbuddy/memory/` 工作日志 |
| 编制口径 | 只陈述仓库内可查证的事实；未产出、未实测、未确认的内容统一标注 **「待补充」**，不作推断 |

> **归档口径声明（先读）**：用户于 2026-11-09 宣告项目完结并归档。但按仓库内质量台账，**准出层仍为 BLOCKED**——真机侧验收（AC1~AC4 / DoD / 性能校准 / Playtest）从未执行。本报告的「完结」指**本轮交付工作结项**，**不等于质量准出、不等于可玩版本已发布、不等于 S-12 整体 PASS**。据 `production/reviews/s12-closure.md`，S-12 的正式判定是「**离线 PASS + 真机 BLOCKED**」。

---

## 0. 执行摘要（汇报用）

- **做了什么**：面向 HarmonyOS 7 的现代都市经营城市建设游戏，完成概念 → 系统设计 → 架构/ADR → 预制作 → 制作（W1~W5）全阶段资产，交付 **176 个文件 / 22 次提交**：设计文档 12、架构与 ADR 7、生产管理 14、源码 46、测试 88、预览 5、工作日志 3。（规模统计口径 = 冻结基线 `c22ce50` 的 git 跟踪文件，**不含本报告**）
- **代码状态**：`src/` 为**引擎无关零依赖 TypeScript 纯逻辑层 + 注入式适配层**；全量测试 **574 条 / 572 pass / 0 fail / 2 skipped**，tsc 三入口 `EXIT=0`。
- **任务状态**：60 条任务 **59 completed / 1 in_progress / 0 pending**；唯一未完成项 #59 为真机侧（环境阻塞，非实现缺陷）。
- **验收结论**：S-12 六条验收中 **2 条 PASS（结构/离线契约层）、1 条 PARTIAL、3 条 BLOCKED**；三层可访问性证据链仅第一层达成。
- **关键风险**：本机无 DevEco / hdc / HarmonyOS SDK / Cocos 工程，所有真机相关验收无法执行；EX-01~EX-04 已登记为**持续准出阻塞**；性能数字全部为「建议基线 / 非承诺值」，未冻结。
- **归档位置**：https://github.com/1695325637/harmony-city-builder （Private，`main` = `c22ce50`）。

---

## 1. 项目目标与范围

### 1.1 目标

在 HarmonyOS 7 平台构建一个以**市民满意度为唯一计分板**的现代都市经营城市建设游戏：玩家通过分区规划、路网铺设、市政预算推进「市政周期」，通过诊断面板追溯满意度变化原因，在「失败—诊断—修正—见效」闭环中持续经营，**无硬失败终局**（OD-1 A）。

### 1.2 已拍板的不可变前提（`design/concept/game-concept.md` §0.1）

| 维度 | 内容 |
| --- | --- |
| 产品 | 城市建设（city builder），现代都市经营题材（分区 / 交通 / 市政预算 / 满意度） |
| 平台 | HarmonyOS 7（开发者预览 / 测试阶段，SDK 26 / API 26）；手机竖屏优先，兼容平板与折叠屏 |
| 技术路线 | Cocos Creator 3.x 官方适配 HarmonyOS NEXT → DevEco Studio 打包 HAP；2D / 2.5D 等距（2:1 dimetric，128×64 格）；低频 tick + 网格地图 + 密集 UI |
| 评审档位 | lean 评审档 |
| 本轮交付 | 全套阶段资产（概念、美术圣经、GDD、架构/ADR、冲刺计划）+ 纯逻辑实现与测试 |

### 1.3 范围边界

- **切片内**：AC1~AC4 四条验收、DoD D-1~D-7 七条门禁、12 条 Story（S-01~S-12）、五份逐系统 GDD、UX / 可访问性规格。
- **切片外（明确不做）**：公交、政策卡、地价、多道路等级、危机事件、跨设备流转、折叠屏双栏、季节昼夜、成就 / 分享（概念 §5.2，共 9 项）。
- **平台特性分级**：H1 秒启卡片（Could）/ H2 折叠双栏（Should）/ H3 跨设备流转（Could）/ H4 分布式多机同局（Won't）；12 条 Story 对四者**零阻塞**（S-12 验收 6 结构复核 PASS）。
- **产品正式名称、上线计划、商业化方案**：**待补充**（仓库内无相关决策记录）。

---

## 2. 主要功能模块与交付成果

### 2.1 代码模块（`src/`，46 个文件，零外部依赖）

| 层 | 文件数 | 主要模块与职责 |
| --- | --- | --- |
| `src/core/` | 3 | `types` / `schema`（序列化、configHash 兼容断言）/ `config`（注入式配置与占位数值） |
| `src/simulation/` | 6 | `commands`（V1~V9 动词与 InputGate 幂等）/ `traffic`（ROAD 图 BFS、分区块通勤、`flowState` 三态）/ `snapshot`（Keyframe + Delta 冷归档）/ `tick-pipeline`（P0~P8 结算链、周期末单轴判定、V9 解锁）/ `session`（编排：`advanceDay` / `submit` / `renderFrames` / `retryCycle`）/ `rollback`（周期起始帧回退、tickId 单调） |
| `src/render/` | 11 | `iso`（等距换算）/ `view-model` / `semantic-tokens`（唯一 hex 色源、`textSafe` 实算）/ `atlas` / `texture-format`（ASTC→ETC2→RGB565 降级链）/ `draw-list` / `backend` + `cocos/cocos-backend`（注入式适配）/ `flow-legend`（`flow.*` 令牌唯一映射）/ `asset-naming` / `degradation-plan`（§10.4 五步降级契约） |
| `src/ui/` | 19 | `feedback-bus` / `feedback-timing` / `optimistic-view`（<100ms 即时反馈、与 tick 解耦）/ `interaction-controller` / `motion-policy`；`hud/`（竖屏三段布局、常驻 3 指标、建造页签、预算面板、结束本日、图例、`a11y` 断言库）；`diagnosis/`（只读诊断查询、L2 面板、两级反馈投影） |
| `src/save/` | 4 | A/B 双槽原子写、`writeSeq` 择优、checksum（防误改，**非加密摘要 / 非反作弊**）、`SaveSlot` 五字段头、显式 `SaveMigration`、`ISaveStorage` 注入接口（H3 能力位默认关） |
| 根层 | 3 | `index.ts`（统一 barrel）/ `composition.ts`（组合根）/ `README.md`（行数声明与层间纪律） |
| `preview/` | 5 | 程序化占位离线预览页（`dist/` 产物由构建生成，未入库） |

**组合根**（`src/composition.ts`）把 `createSimulation` / `InMemorySnapshotStore` / `SaveService` 接成闭环：初始态 tick 0 归档为 KEYFRAME、P8 结算后落盘、`onBackground()` 强存、回退 / 解锁后补存；`CR-1~7` 在**内存模拟介质侧**验证。**接线 ≠ 真机验证**。

### 2.2 设计与管理文档（33 份 `.md`）

| 域 | 数量 | 内容 |
| --- | --- | --- |
| `design/` | 12 | 游戏概念 v1.0、美术圣经 v0.3、资产规格（95 项 Must 资产）、可访问性矩阵 v0.3（29 条 AC）、UX 规格、系统索引、五份逐系统 GDD（满意度 / 地图分区 / 交通通勤 / 预算经济 / 议题诊断）、S-06 美术评审 |
| `docs/` | 7 | 架构文档（§10 性能基线、§10.4 降级顺序、§13 评审门）、控制清单、5 份 ADR（引擎与目标平台 / 模拟循环与快照 / 存档与归因 / UI 反馈解耦 / HUD 三段比例） |
| `production/` | 14 | Epic 拆分（12 Story、AC1~AC4、D-1~D-7）、冲刺计划、真机校准执行手册（745 行）、原始记录表（235 行）、各阶段回顾、三层证据文档、S-12 结项报告、任务清单、本报告 |

### 2.3 测试资产（`tests/`，88 个文件）

- 单元测试 48 份 + 验证 / 复核套件 11 份 + QA 文档 29 份；含 `s12-a11y-gate.test.ts`（29 条 AC 编号化台账）、`a11y-wiring-guard.test.ts`（WG-1~3 第四类证据断层守卫）、`degradation-plan.test.ts`（DP-1~6）、`token-text-safety.test.ts`（TS-1~5）、`composition-root.test.ts`（CR-1~7）。
- 追溯矩阵分母 **121 项**（逐行映射、GAP = 0），可访问性执行层 **29 条**、汇总层 **10 项**、`10↔29` 映射。
- 早期资产口径：72 条用例 + 32 条冒烟项 + 三套覆盖率口径（`tests/quality-closure.md` v1.3 保留历史快照）。

---

## 3. 完成及验收情况

### 3.1 任务与测试

| 指标 | 结果 | 依据 |
| --- | --- | --- |
| 任务清单 | 60 条：**59 completed / 1 in_progress / 0 pending** | `production/reviews/task-progress.md` |
| 阶段完成度 | 概念设计 10/10、W1~W2 6/6、W3 渲染 UI 20/20、S-09 6/6、W4 7/7、S-12 10/11 | 同上 |
| 全量测试（本次复跑实测） | **574 tests / 572 pass / 0 fail / 2 skipped** | `node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts` |
| 类型检查 | `tsc --noEmit --strict` 三入口 **EXIT=0** | `src/index.ts` / `src/ui/index.ts` / `src/save/index.ts` |
| 测试规模演进 | 234 → 289 → 394 → 463 → 524 → 571 → **574** | `production/reviews/task-progress.md` §2.3 |
| 工作树 / 远端 | 干净；`main` = `HEAD` = `c22ce50`，22 次提交 | git |

> 2 条 skipped 为 `AC-A06-1` 单手 Playtest 与 `AC-A08-1` 上游音频清单缺失，**非通过**。

### 3.2 S-12 六条验收判定（`production/reviews/s12-closure.md` §1）

| # | 验收条件 | 判定 |
| --- | --- | --- |
| 1 | AC1~AC4 汇总判定 + DoD D-1~D-7 门禁 | **BLOCKED**（真机 / Playtest） |
| 2 | 可访问性 Standard 全项落地、低性能档仍满足 | **PARTIAL**（离线侧收口，非全项达成） |
| 3 | §10.4 降级顺序、不触碰可访问性与 <100ms | **PASS（离线契约层）**；真机按序实际关闭未验 → 该半侧 PARTIAL |
| 4 | 十项校准 + 机型矩阵 | **BLOCKED**（无任何实测值） |
| 5 | 「建议 → 硬指标」报告并回写 §10.1 | **BLOCKED**（数字仍为建议基线、未冻结） |
| 6 | 12 条 Story 对 H1~H4 零阻塞 | **PASS（结构复核）** |

**质量闭环**（`tests/quality-closure.md` v1.3）：**资产层 PASS / 准出层 BLOCKED**。

**可访问性证据链三层**（`production/reviews/s12-architecture-evidence.md`）：① 断言库自证 **达成**；② 控件达标 **未达成**（`A11yControl` 在 `src/` 零对象字面量赋值、`gapDp` 生产侧零赋值、`assertSpacing` 零调用点）；③ 真机达标 **未达成**。`control-manifest.md:90` 的 a11y ✅ 已降级「待验」，真机前不得恢复。

29 条 AC 分档：**A 档 9 / B 档 16 / C 档 2 / N/A 2**（合计 29）。其中 `AC-A10-1`「不适用（无适用对象）· 条件重开」、`AC-A10-2`「不适用（无对象）· 条件重开」。现行判定链为「**27 条可判 AC 全部通过 + 2 条 N/A 显式登记 → UX-A11~A19 九项通过 + UX-A20 N/A 登记 → Standard 达标**」，**N/A ≠ PASS，不计入通过分子**。

### 3.3 复核与质量门

- 三条 fresh-eyes 独立复核（2026-11-07）：`s12-a11y-gate` **CONDITIONAL FAIL**（可执行层 PASS / 口径一致性层 FAIL）、`s12-arch-sweep` 附条件通过、`s12-design-a11y` 附条件通过；发现项已逐条订正并统一复跑。
- 第四层独立复核 `s12-final-verify`：**附条件通过**（8 项必查 7 PASS、守卫有效性附条件通过）；残留 R1~R4 已处置。
- **禁语三句**（对外口径不得出现）：「可访问性 Standard 29 条 AC 全通过」／「性能已达标」／「48dp 已重验」。

### 3.4 明确未完成 / 待补充

| 项 | 状态 |
| --- | --- |
| 可玩 HAP、Cocos 导出工程、HarmonyOS 工程骨架 | **未产出**（`src/` 为引擎无关纯逻辑、注入式适配；`preview/` 为程序化占位单文件） |
| AC1~AC4 / DoD D-1~D-5 实测判定、Playtest 受试者数据 | **待补充**（未执行） |
| 十项真机性能实测值、机型矩阵 | **待补充**（记录表为空） |
| §10.1 硬指标冻结值 | **待补充**（冻结动作须 P-7 主理人确认，表体未动） |
| K-1~K-5（HarmonyOS API 确切签名、HAP 包体上限与权限模型等） | **待补充**（禁止凭猜测回填，O-8 / GAP-08） |
| 产品正式名称、上线 / 发布计划、版本发布清单 | **待补充**（仓库内无决策记录） |
| 音频事件 → 视觉等价物清单（GAP-06） | **待补充** |
| 美术资产实际图片、实际字阶表 | **待补充**（仅有规格与提示词，无出图产物） |
| 部分平衡期数值（`GAP-01`） | **待补充**（占位符未钉定） |

---

## 4. 主要问题与处理结果

| # | 问题 | 处置与结果 |
| --- | --- | --- |
| 1 | **真机环境硬墙**：本机无 `deveco` / `hdc` / `~/.ohos` SDK / Cocos 工程 | 早期如实披露并经用户拍板；按「分期结项：离线 PASS + 真机 BLOCKED」处理；EX-01 / EX-02 顺延、EX-03 升级为**准出阻塞**、EX-04 记录 S-12 窗口到期仍不解除。**不判 FAIL、不回填猜测值** |
| 2 | **D-01（S1）**：`configHash` 变更后旧快照静默续算 | T-116 在三处公开载入入口修复 + 6 条回归用例；D-01 CLOSED；存档层由 QA 反证「configHash 漂移 + 注册迁移器 → 仍硬拒绝」 |
| 3 | **D-03 幂等契约模糊** | F 线显式契约（`tests/verification/s10-idempotency-contract.md` + ID-01~12）；文件级注入证明判据非永真；D-03 CLOSED |
| 4 | **`assertSpacing` 永真断言**（AC-A05-2 假覆盖） | 引入 `gapDp?: number`、真判间距、未声明显式抛错、修 off-by-one；明确生产侧仍零调用点、不构成 AC 验收证据 |
| 5 | **可访问性「结构性空洞」** | 三层证据链定性：断言库自证 ≠ 控件达标 ≠ 真机达标；`control-manifest.md` a11y ✅ 降级「待验」 |
| 6 | **官方「必须」级两条缺口** | 补 `AC-A10-1/2`，AC 数 27→29；判 N/A + 条件重开（无滑动控件实例 / 无字号体系），**N/A ≠ PASS**；ADR-005 把 `thumbZone` 抬至 0.20 仅消除算术死墙，不等于 AC 通过 |
| 7 | **热区基线口径** | 44dp → **48dp**（华为 2.1.3.3 推荐值；40vp 仅为合规底线），全链文档同步；属收紧非放松 |
| 8 | **`base.inkWeak` 文字对比度 2.31:1 不足** | 降为**非文字令牌**；`textSafe` 由 `contrastRatio` 实算（非手写常量）+ TS-1~5 静态扫描守卫 |
| 9 | **判定链逻辑不可满足** | 「29 条全通过 / 十项全通过」在 N/A ≠ PASS 下不可满足；全仓 10 余处统一改为 27 可判 + 2 N/A / 九项 + UX-A20 N/A；只修自洽性，不放松判据强度 |
| 10 | **计数漂移**（分档 A9/B14/C2/N-A2 合计仅 27） | 机器解析 gate 台账表后订正为 **B 档 16**；追溯分母 120→121（补 UX-A20 映射行）、映射 9↔29→10↔29、GDD 编号 37→38、`AC-A09-2` 27→24 条 |
| 11 | **第四类证据断层**：判据本身可被假声明满足 | 新增 `a11y-wiring-guard.test.ts` WG-1~3；第四层复核实测出 4 个已知不可判定面（别名调用、字符串键、点赋值、定义行同行），已显式登记，**不扩正则**、不宣称「任何接线都会变红」 |
| 12 | **成员自报与磁盘不符**（声称改了 `epic-breakdown.md` 实际零 diff；测试计数停留在旧值） | 主理人逐项对磁盘复核后补齐；形成「成员自报必须核验」纪律 |
| 13 | **主理人预写复核结论**（F1/F2/F3 标签在复核返回前入档） | 作废该表述、保留历史原文不改写，追加订正留痕（`c22ce50`）；真实残留为 R1~R4 |
| 14 | **文档三类处置分歧** | 固化 A 类现行规范直接改 / B 类历史决策追加 Amendment / C 类历史证据快照只加注不改数 |
| 15 | **D-15 双写事故 / 429 限流** | 并行文件域隔离、写前检查路径、成员不直连、实现方不得改自己的验收判据；限流窗口内由主理人接手收尾，重置后恢复派工 |
| 16 | **本机全局 git 配置加密损坏**、GitHub 上传障碍 | 上传最终经本地 `git push` 完成（22 提交 / 176 文件，完整历史）；用户自行修复全局配置；WorkBuddy GitHub 连接器因 OAuth 应用未申请 `repo` scope，私有仓库在 IDE 内不可见（应用侧限制，非配置问题） |

---

## 5. 遗留事项与风险

### 5.1 准出阻塞（EX-01 ~ EX-04，持续）

| 项 | 内容 | 依据 |
| --- | --- | --- |
| EX-01 | `SM-W1-04` 真机生命周期（onForeground/onBackground、surface 重建、折叠切换、`engineVersion` 写存档头） | `tests/quality-closure.md` v1.3 |
| EX-02 | S-06 ③b 格式探测写入校准记录（ASTC/ETC2 实际生效、合批）；③a 离线降级链已 PASS、不可豁免 | 同上 |
| EX-03 / K-4 | 沙箱 KV、HAP 权限模型、包体上限；存档层为**内存模拟介质**，与真实持久化有差距；K-1~K-5 不得凭猜测回填 | 同上 / `control-manifest.md` |
| 验收 4 / 5 | 十项测量 + 机型矩阵；「建议 → 硬指标」报告与 §10.1 候选值回写（冻结须 P-7 主理人确认） | `production/calibration/device-calibration-runbook.md` |
| 验收 1 | AC1~AC4 汇总判定 + DoD D-1~D-5 门禁 + Playtest（受试者、可玩 HAP） | `s12-closure.md` §1 |
| 组合根真机半侧 | `onBackground()` 目前是注入式方法，须接入真机生命周期回调并验证杀进程 / 切后台真实持久化 | `s12-closure.md` §7 |

### 5.2 仍开放但不阻塞结项（登记留痕）

- 软着陆 GDD 04 §3.3②「抑制新增建设」语义；
- 解锁形状「边长阶梯 +2」钉定；
- 跨会话全局幂等（若 H3 开启，由 `SaveService` epoch 命名空间承担，不得下沉 `runTick`）；
- `AC-A05-2` 生产侧接线（三条重验门槛；守卫已落地但 AC 仍为 B 档 · PENDING-API / 不销项）；
- ADR-005 **R-3**（`minHeightDp` 仍只是声明值、无 clamp）与 **R-5**（200% 缩放 / 480dp 地板冲突），只能真机复核；
- 音频事件 → 视觉等价物清单（GAP-06）；平衡期数值钉定（GAP-01）。

### 5.3 风险登记

| 风险 | 等级 | 说明 / 缓解 |
| --- | --- | --- |
| 真机环境与离线实现存在未验证鸿沟 | **高** | 全部真机相关结论按 PARTIAL / BLOCKED 登记，不冒称 PASS；执行手册与空白记录表已备，环境就绪即可照做 |
| 可访问性证据链第 2、3 层未达成 | **高** | a11y ✅ 已降级「待验」；N/A ≠ PASS；守卫只覆盖字面量形态，已知不可判定面须人工核对 |
| 性能数字未冻结、无实测 | **中** | §10.1 表体一字未动；所有数字维持「建议基线 / 非承诺值」口径；冻结须主理人确认 |
| 无 Cocos / DevEco 工程与可玩 HAP | **高** | 当前 `src/` 不可直接运行上屏；`preview/` 为程序化占位；接入属后续工程化工作，未排期 |
| 知识缺口 K-1~K-5 | **中** | 禁止猜测回填；API 26 预览版确切接口名、HAP 上限等待真机核对 |
| 产品命名 / 上线计划未定 | 低 | **待补充**；不影响技术交付 |
| IDE 内 GitHub 连接器私有仓库不可见 | 低 | OAuth 应用未申请 `repo` scope；本地 git 通道已覆盖全部仓库操作，不影响交付 |

---

## 6. 经验总结

1. **主理人亲自复跑，不采信成员自报**。多次出现 worker 自验漏跑套件、报告与磁盘不符；全量测试与 tsc 由主理人独立执行后才作为结论依据。
2. **实现方不得改自己的验收判据**。验收层（`tests/**`）由主理人 / 独立复核流订正，避免「改测试让它变绿」。
3. **分层复核有效**：实现自证 → 第二层 QA → fresh-eyes 复核 → 第四层独立复核，每层用**反向突变 / 牙齿自证**（改坏 → 变红 → 撤回 → 复绿）证明判据非永真，而非仅看一片绿色。
4. **证据分层，杜绝「假绿」**：断言库自证 ≠ 控件达标 ≠ 真机达标；进而发现第四类「判据层自身可被假声明满足」，用机器守卫补齐。
5. **N/A ≠ PASS**：不适用项必须显式登记理由与条件重开条款，不计入通过分子；判定链因此从「29 条全通过」改为「27 可判 + 2 N/A」，避免逻辑不可满足的验收条件。
6. **文档三类处置**（A 直接改 / B 追加 Amendment / C 只加注不改数）保住了历史证据的可追溯性，避免把历史快照「修成」当前口径。
7. **并行写操作按文件域隔离**，成员不直连、统一经主理人中转，规避 D-15 双写事故；写前检查路径。
8. **环境硬墙尽早披露**，用 EX 编号登记顺延与升级，而不是在结项时含糊带过；真机半侧一律 PARTIAL / BLOCKED，不判 FAIL、不回填猜测值。
9. **性能与对比度数字不预先冻结**，一律标注建议基线 / 非承诺值；阈值类结论必须可复算（`textSafe` 实算而非手写常量）。
10. **流程纪律同样需要复核**：R1 暴露「结论先于复核入档」「复核与订正并发、基线未冻结」；已形成「冻结基线后再派 fresh-eyes、结论不得预写」的改进项。

---

## 7. 后续改进建议

### 7.1 若继续推进产品（优先级从高到低）

1. **补齐真机环境**（DevEco Studio / hdc / HarmonyOS SDK 26 / Cocos Creator 3.x 导出工程），按 `device-calibration-runbook.md` 逐条执行 EX-01 / EX-02 / 验收 4 / 5，用 `raw-measurement-sheet.md` 留原始证据；**K-1~K-5 只写真机事实 + 证据路径**。
2. **工程化接入**：把 `src/` 纯逻辑层与 `preview/` 占位升级为真实 Cocos 工程，接入 `onBackground()` 平台生命周期，产出可玩 HAP；`flowEdgesFromTick` 接线时传 `cellCount = side*side` 并当帧消费 `edgeCells`（其 workspace 为原地复用活引用）。
3. **执行 AC1~AC4 / DoD Playtest**，由质量侧汇总判定；补齐音频事件清单（GAP-06）与平衡期数值（GAP-01）。
4. **完成可访问性第 2、3 层**：补生产侧 `A11yControl` / `gapDp` 真实接线并按三条重验门槛重判；真机复验 48dp 物理命中、200% 缩放、厂商 ROM 缩放；关闭 ADR-005 R-3 / R-5。
5. **性能数字冻结**：校准报告产出后由主理人（P-7）确认，再回写 `architecture.md §10.1`，并纳入 CI 回归。
6. **产品侧决策**：正式名称、上线 / 发布计划、版本清单、商业化方案 —— **待补充**。

### 7.2 流程与工程实践改进

- 把 `node --experimental-strip-types --test` 全量 + tsc 三入口 + 静态扫描守卫（QAS-19 / QA-T8 / WG-1~3 / TS-5）纳入 **CI 门禁**，避免依赖人工复跑。
- fresh-eyes 派单前**冻结工作树并声明基线 commit**；复核期间禁止并发写入；结论一律在报告返回后入档。
- 成员回执附 `git diff --stat` 与实测命令输出，主理人逐项对磁盘核验后再汇编。
- 为「已知不可判定面」建立统一登记表，避免各守卫各自宣称覆盖面；不为堵漏扩大正则而引入误报。
- 将「A/B/C 三类文档处置」「N/A ≠ PASS」「禁语三句」写入项目贡献规范，供后续轮次沿用。
- 如需在 IDE 内使用 GitHub 集成（PR / Issue / 私有仓库读取），需连接器侧 OAuth 应用申请 `repo` scope；当前可用本地 git 通道替代。

---

## 8. 附录：证据索引

| 结论 | 主要依据文件 |
| --- | --- |
| 目标与范围 | `design/concept/game-concept.md` §0.1 / §5.2、`production/epics/epic-breakdown.md` §2 |
| 技术栈与架构 | `docs/architecture/architecture.md`、`docs/architecture/adr/ADR-001~005`、`src/README.md` |
| 功能模块 | `src/` 各模块、`design/gdd/systems/01~05`、`design/ux/ux-spec.md` |
| 任务与测试基线 | `production/reviews/task-progress.md`、`tests/traceability-matrix.md` |
| 验收判定 | `production/reviews/s12-closure.md`、`tests/quality-closure.md` v1.3 |
| 证据链与复核 | `production/reviews/s12-architecture-evidence.md`、`tests/verification/s12-a11y-gate.test.ts`、`tests/unit/a11y-wiring-guard.test.ts` |
| 校准执行方案 | `production/calibration/device-calibration-runbook.md`、`raw-measurement-sheet.md` |
| 遗留与开放项 | `production/reviews/task-progress.md` §三、`production/reviews/s12-closure.md` §6 / §7 |
| 过程记录 | `.workbuddy/memory/2026-11-05.md` ~ `2026-11-07.md`、git 22 次提交 |

---

*报告结束 · 编制 2026-11-09 · 冻结基线 `c22ce50` · 本报告为归档与汇报用途，不改变任何既有验收判定；所有「待补充」项均未在仓库内找到可确认依据。*
