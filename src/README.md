# HC-01 纯逻辑层 · W1~W2（S-02 + S-03）

> 本项目第一次写代码。T-112 落地**确定性模拟内核**（数据层 schema / 配置注入 + P0~P8 tick 结算链）及其单测；
> **T-116（W1 出口门缺口修复）**：修复 D-01（S1 静默续算）、补 S-04 性能实测与 S-05 冷归档最小内存实现（详见 `tests/verification/w1-gate-remediation-evidence.md`）。
> 产物可在本机直接运行测试，**不需要** DevEco Studio、Cocos Creator、HarmonyOS 真机、npm 安装或任何工程配置文件。

---

## 1. 环境与零依赖方案

| 项 | 值 |
| --- | --- |
| 本机运行时 | `node -v` → **v22.22.2**；`npm -v` → 10.9.7 |
| 运行机制 | Node 22 内置 **类型剥离**（`--experimental-strip-types`）+ 内置测试运行器 `node:test` |
| 依赖 | **零依赖**：未创建 `package.json` / `tsconfig.json` / `node_modules`；源码不 `import` 任何 `node:` / 引擎 / 平台模块 |
| 模块解析 | Node 22 自动检测 ESM 语法；`.ts` import 一律带 `.ts` 扩展名（类型剥离要求） |
| 类型检查 | `npx --yes -p typescript@5.9.3 tsc --noEmit ...`（npx 临时包，落在 npm 缓存，**不污染 `src/` / 工作区**） |

由于类型剥离不支持 `enum` / `namespace` / 构造器参数属性，源码统一用 `const` 对象 + `as const` + 联合类型、纯函数与显式工厂。

---

## 2. 目录结构

| 路径 | 行数 | 职责 |
| --- | --- | --- |
| `src/core/types.ts` | 247 | 共享类型、14 条共享数据字典、P0~P8 阶段常量、R1~R7 阶段映射、命令 / 事件 / 状态结构、`canonicalize` / `hashString` |
| `src/core/schema.ts` | 306 | 网格 / 分区 / 预算 / 双帧 schema，`schemaVersion`，`>32×32` 显式拒绝，序列化回环；**T-116：`deserializeState` 实参化 + 强制 `assertConfigCompatible`（D-01 修复点 1）** |
| `src/core/config.ts` | 204 | `Config` / `PLACEHOLDER_DEFAULTS` / `createDefaultConfig` / `computeConfigHash` / 可注入聚合器 / 版本兼容断言 |
| `src/simulation/commands.ts` | 90 | `makeCommand`、`CommandQueue`（幂等键）、`InputGate` |
| `src/simulation/traffic.ts` | 302 | 最小可注入通勤求解：连通块合并（B ≤ 64）+ ROAD 图 BFS + 拥堵单调 + 不可达 / 除零兜底 |
| `src/simulation/snapshot.ts` | 256 | **T-116 最小内存实现**：`buildTickSnapshot` + `createInMemorySnapshotStore`（Keyframe/Delta 规则、冷归档恢复走 `deserializeState`、D-01 联动；介质为内存模拟，持久化留 S-05/S-09） |
| `src/simulation/tick-pipeline.ts` | 442 | `TickWorkspace`（预分配）、`runTick` P0~P8、双帧、D6 解环、零热路径分配、`advanceRenderFrames` |
| `src/simulation/session.ts` | 100 | 编排层 `createSimulation`：仅 `advanceDay`（V6）触发结算，连点幂等，结算中 gate 锁定；**T-116：入口 `assertConfigCompatible`（D-01 修复点 2）** |
| `src/index.ts` | 15 | 统一导出 |
| `tests/unit/*.test.ts` | 869 | 8 个测试文件 / 51 条断言用例（7 文件 45 条基线 + `d01-config-compat.test.ts` 6 条 D-01 回归，见 §4） |
| `tests/verification/*.test.ts` | 1238 | `edge-cases.test.ts`（quality-lead T-114，12 条；T-116 仅 V-06/V-STATIC 按修复后契约改写）+ `cold-archive-s05.test.ts`（6 条）+ `perf-s04.test.ts`（3 条） |

> 追加的同类文件：`src/simulation/session.ts`（编排层，主理人允许「按需增补同类文件」）。**未创建任何工程配置文件。**

### 2.1 渲染层索引（S-06 / T-118 落地 + T-121 修复批）

> **行数为声明值，改动模块后须同步；QA 有守卫用例（`QA-T8`）读此表并与磁盘实际比对**——
> 不同步会让全量变红（T-129 已发生一次：`asset-naming` / `atlas` / `draw-list` 扩写后表未跟）。

| 路径 | 行数 | 职责 |
| --- | --- | --- |
| `src/render/iso.ts` | 175 | 2:1 dimetric 投影（128×64、菱形顶角锚点）、`screenToGrid` 逆变换、`pickCell`、`depthKey`/`compareDepth`（唯一深度规则）、`ZOOM` 三档固定缩放 + `zoomAround` 锚点保持 |
| `src/render/view-model.ts` | 158 | 只读 VM（cells 零拷贝 + 结构冻结 + `changeStamp` 4KB 版本戳快照）、`diffViewModel`（**格级**信号，见下）、`isViewModelFrozen` |
| `src/render/semantic-tokens.ts` | 323 | **唯一 hex 色源**：base / zone / status / flow 四组令牌 + 图案 / 形状 / 标签 / WCAG 对比度 / `inkOnDark`；`PATTERN_ALPHA` 0.18 与高对比 0.30 + 1px 描边（`highContrast` 开关，默认关） |
| `src/render/atlas.ts` | 458 | 12 组虚拟图集清单（2048² 货架布局、含建筑 d1/d2/d3）、`validateAtlasManifest`（9 类校验）、`resolveLoadSet`（分区门控 + LOD + `deferredCould` 标记） |
| `src/render/asset-naming.ts` | 343 | **A-01 映射层**：内部 `assetKey` ↔ asset-spec §0.3 规范名（`toSheetName`/`fromSheetName`/`assertNamingCoverage`），真实切片接入改数据不改代码 |
| `src/render/texture-format.ts` | 43 | ASTC → ETC2 → RGB565 → NONE 降级链；UI 图集固定 RGBA8888 |
| `src/render/draw-list.ts` | 334 | 深度排序 + 按图集聚批 + DrawCall **估算** + `densityToSuffix`（0→无 / 1→d1 / 2→d2 / 3→d3） |
| `src/render/backend.ts` | 33 | `RenderBackend` 契约（createNode / setFrame / setPosition / setScale / setDepth / destroy / batchBegin / batchEnd） |
| `src/render/cocos/cocos-backend.ts` | 158 | 注入式 Cocos 适配（**不 import 'cc'**）；兄弟序 = `depthKey`；9-slice 预留；`verifiedInEngine=false` |

- 对外导出：以上 9 个模块（含 `asset-naming`）均经 `src/index.ts` 的 `export *` 出口，故 `tsc --noEmit --strict … src/index.ts` 覆盖全部渲染模块；`src/render/cocos/` 亦经统一出口导入（仅类型 + 注入式工厂，无 `'cc'` 依赖）。
- 预览：`preview/build.mjs` 用 `module.stripTypeScriptTypes` 从 `src/` 生成 `preview/dist/*.mjs`（单一真源），`preview/serve.mjs` 起 `127.0.0.1:8123`；默认 L0 全图概览，支持 `?lod=L0|L1|L2`。

**⚠️ `diffViewModel` 只产「格级」信号（D-08 口径）**：它比较 `changeStamp`（`inputVersion` 快照）并在不同底层数组时兜底比对 zone / density / unlocked；**不覆盖** `S` / `tickId` / `cycleId` / `budget` 等非格字段。这些字段变化（P4 满意度、P7 预算结算）时可能返回空数组——消费方须自行比对 VM 上的这些字段或全量重建绘制列表。渲染帧不触发模拟，也不因非格字段变化重绘地块。

---

### 2.2 语义令牌 id 稳定性契约（跨层 · T-129）

> **事故背景**：T-121 的 A-07/A-08 重构移除了 `base.primary`，导致 `src/ui/**` 首轮 12 条用例全红。
> 根因不是实现写错，而是**令牌 id 没有稳定性契约**——渲染层可以「顺手整理」掉别人依赖的 id。
> 本节是跨层契约，`tests/unit/ui-token-contract.test.ts` 是其门禁（缺一个 id 即失败）。

**依赖分级**（以 engineering-ui 回传的 UI 实际依赖为准）

| 档 | id | 使用方 | 变更规则 |
| --- | --- | --- | --- |
| **硬依赖** | `base.tile`、`base.ink` | UI 布局 / 按压基色、文字色 | **永不可删、不可改名** |
| **语义依赖** | `status.selected`、`status.negative`、`status.positive`、`status.warning` | UI 的 UIColor 语义映射 | 改名 / 删除**须先公告**，并**保留 alias 至少一个版本** |
| **动态依赖** | `zone.<zoneId>`（随 `config.zoneTypes` 全量生成） | UI 分区色（落位色块填充等） | 增分区即增 id；`zone.` 前缀规则不得改（现有 id 同样受「先公告」约束） |
| **不依赖** | `flow.*`（`flow.clear` / `flow.slow` / `flow.congested`） | 通勤态由**渲染层自用**，UI 不引用 | 改动不影响 UI，但仍受「先公告」约束；`zone.ROAD` / `zone.EMPTY` 归 `base.tile`，不借分区色 |

**规则**

1. 稳定 id **不得重命名 / 删除**；确需变更 → 先在团队内公告 → 保留 alias 至少一个版本
   （alias 由 `buildSemanticTokenMap()` 一并输出并映射到新 id，禁止只改不留退路）。
2. 新增 id 不受限（只增不改）；`zone.*` 随配置增长属预期。
3. 门禁：`tests/unit/ui-token-contract.test.ts` 断言上述 id 全部可在 `buildSemanticTokenMap()` 输出中查到，
   并校验本节文档与门禁清单同步。

**实现级视觉口径（正文以 art-bible 为准，本节是 future reviewer 的依据）**

1. **L0 状态形状门控**（主理人 Q-1 裁定 A）：`buildDrawList(vm, manifest, 'L0')` **不产出任何
   status / flow 形状**（`shapeSpriteCount === 0`）；通勤态在 L0 改由**线宽 / 亮度**表达
   （`OverlayDraw.line`，如拥堵 3× / 1.0、缓行 2× / 0.8、畅通 1× / 0.6），信息不丢失；
   形状仅在 **L1 / L2** 生效，**L1 形状带 1px `base.ink` 内描边**，L2 不描边。
   依据：art-bible §2.3「L0 细节降级」+ §3.4 双通道。代码即本口径：
   `draw-list.ts` 的 LOD 分支与 `draw-list.test.ts` 的 DRAW-10/11 一一对应。
2. **瞬态交互反馈的双通道例外**（主理人已裁定，与 UI 侧一致）：按压态 / Tab 切换 / 选中切换等
   瞬态交互反馈，其第二通道可为**动效（常态 120ms）**或**文字标签**；纯图形按钮若承载语义，
   **必须配文字标签（文本组件，见 art-bible §7.1「图标不内嵌文字」）或动效**，不得仅以图形
   本身充当第二通道。**本例外不适用信息状态** —— 信息状态的第二通道仍为形状（art-bible
   §3.4 规则 4，L1 / L2 生效）。依据：art-bible §7.1 + §8.3 + §9.2。
   - **推论（S-08 验收项）**：`reducedMotion=true` 时按钮 / Tab 的动效通道关闭，
     **文字标签成为唯一第二通道**——凡承载语义的按钮 / Tab 必须配文本组件。
     ⚠️ 实现注记（T-129 回执同步）：`motion-policy.ts` 的 `static-press-color` 只描述
     **视觉降级表现＝颜色变化**，本身不构成第二通道；当前 `press` / `tab` 在减动效态仍声明
     `channels = ['color','shape','text']`（`CHANNELS_STATIC`），对**纯图形按钮属过度声明**
     （无文字、press 无形状）——该项归 S-08 与 D-13 一并处理（按容器能力派生通道），
     本单不改 `src/ui/**`。

---

## 3. 实际执行过的命令（含退出码）

以下命令均在本机 `C:/Users/wuyanying/WorkBuddy/2026-11-05-17-29-11` 下**真实执行**：

### 3.1 VDD RED（先写测试，模块未实现时预期失败）

```bash
node --experimental-strip-types --test tests/unit/*.test.ts
```
- `EXIT=1`；`# tests 6 / # pass 0 / # fail 6`
- 关键输出：`Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/index.ts' imported from tests/unit/*.test.ts`
- 这是验证驱动开发的预期 RED 证据，不是缺陷。

### 3.2 GREEN（T-112 终态 → T-116 复核）

```bash
node --experimental-strip-types --test tests/unit/*.test.ts
```
- T-112：`EXIT=0`；`# tests 45 / # pass 45 / # fail 0`
- **T-116：`EXIT=0`；`# tests 51 / # pass 51 / # fail 0`**（+6 条 D-01 回归，见 `tests/unit/d01-config-compat.test.ts`）

### 3.2.1 T-116 验证套件（W1 出口门缺口修复）

```bash
node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/edge-cases.test.ts   # 63/63, EXIT=0
node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts            # 72/72, EXIT=0
```
- `cold-archive-s05.test.ts`：6/6（S-05 冷归档 ≥3 周期 + 恢复回放逐字节一致 + D-01 联动）
- `perf-s04.test.ts`：3/3（S-04 实测：32×32 满网格 2 场景 × 120 样本 p95，建议基线 / 非承诺值）
- 实测数字与证据链：`tests/verification/w1-gate-remediation-evidence.md`

### 3.3 严格类型检查

```bash
npx --yes -p typescript@5.9.3 tsc --noEmit --strict --target ES2022 \
  --module nodenext --moduleResolution nodenext --allowImportingTsExtensions \
  --skipLibCheck \
  src/core/types.ts src/core/config.ts src/core/schema.ts \
  src/simulation/commands.ts src/simulation/snapshot.ts src/simulation/traffic.ts \
  src/simulation/tick-pipeline.ts src/simulation/session.ts src/index.ts
```
- `EXIT=0`，**零输出 / 零类型错误**。
- 范围说明：`tsc` 只检查 `src/` 生产源码；测试文件依赖 `node:test` / `node:assert` 的类型声明（需 `@types/node`），本轮未纳入 `tsc`。测试文件另由下述 `--check` 与真实运行覆盖。

### 3.4 全文件语法 / 类型剥离检查

```bash
for f in $(find src tests/unit -name "*.ts" | sort); do \
  node --experimental-strip-types --check "$f" || echo "FAIL: $f"; \
done
```
- `CHECK_EXIT=0`（16 个 `.ts` 文件全部通过，无 `FAIL:` 行）。

---

## 4. 测试覆盖（unit：8 文件 / 51 用例 + verification：3 文件 / 21 用例）

| 文件 | 覆盖 |
| --- | --- |
| `schema-config.test.ts` | S-02 验收 1/2/3/4：32×32 序列化回环、16×16 起步、`>32×32` 显式拒绝、分区可扩展、configHash 升级、权重注入生效、版本不匹配拒绝、14 条数据字典、数据层零平台依赖 |
| `d01-config-compat.test.ts` | **T-116 / D-01 回归（6 条）**：改 config / 改权重 / 篡改 schemaVersion → deserialize 抛 `ConfigMismatchError`；匹配回环成功；`createSimulation` 入口拒绝不匹配 state；公开载入入口全断言 |
| `determinism.test.ts` | 硬约束 1/2：连续结算 + 跨会话回放逐字节一致、6 tick 序列回放、渲染帧 10000 次不推进、仅 V6 结算、无墙上时钟 / 原生随机 / 倍速、热路径零分配 |
| `input-gate.test.ts` | 硬约束 3：连点 2/5 次只 +1 tick、结算中（P0 内）再点被拒、批量提交不半应用、三类非法命令 `BudgetRejected`、gate 锁 / 解锁 |
| `pipeline.test.ts` | 硬约束 4：P0~P8 顺序、R1~R7 映射、P3 `reused:P2`、无静态距离分支、P7 仅周期末结算 |
| `d6-no-end.test.ts` | 硬约束 5/6：`S_t` 不读 `I_t`、`I_t` 由 `S_{t-1}`、P4 满意度不被 P7 回写、`f_f` 取上期拨付、双帧可读、连续 3 周期未达标仍可重试、无硬终局分支 |
| `traffic-attribution.test.ts` | 硬约束 10：不可达 `T_max`、空城除零、`cap=0` 保护、`T_c` 单调、确定性、位置敏感性 + 平移不变、无逐格 OD 矩阵、归因一致性 ≤1 分 |
| `placeholders.test.ts` | 硬约束 9：占位标记、占位符字段齐备、configHash 随占位变化、K 注入生效、全源码 import 白名单、口径未写成定稿结论 |

**确定性回放的具体验证方式**：同一 `(S_t, commands, config)` 用两个独立 `TickWorkspace` 各结算一次，再把初始态 `serializeState → JSON 往返 → deserializeState` 后第三次结算；三次的 `{ tickId, state, delta, attribution, events, stages, cycleOutcome }` 经 `canonicalize`（键排序 + TypedArray 展开 + 数组保序）后字符串**逐字节相等**。另有 6 tick 连续序列回放逐帧比对。

---

## 5. 架构落点（10 条硬约束逐条自检）

| # | 约束 | 落点 |
| --- | --- | --- |
| 1 | 确定性 / 零平台依赖 / 零热路径分配 | `runTick` 纯函数，无 `Date.now` / `Math.random` / `Map|Set` 遍历依赖；`TickWorkspace` 预分配所有 TypedArray 与对象池，阶段函数只写字段；`ws.allocations` 恒 0（20 次结算复用同一 workspace 断言）。**说明**：这是「结构性零分配 + 可测计数」，不等于 V8 GC 级证明，但阶段代码路径中确无 `new` / `{}` / `[]` |
| 2 | 默认暂停 / 主动推进 | `advanceRenderFrames` 是 no-op 且返回同一引用；只有 `session.advanceDay()`（V6）调用 `runTick`；源码无倍速 / 自动播放 / 倒计时（静态扫描断言） |
| 3 | InputGate / 幂等 / `BudgetRejected` | `createInputGate` 在结算期间 `isLocked`；`session` 用幂等键集合防连点；P1 对锁定区 / 未知分区 / 超预算命令发 `BudgetRejected` 且不应用 |
| 4 | P0~P8 可观测 / R1~R7 / P3 复用 P2 | `PIPELINE_STAGES` 常量 + `StageTrace[]` + `onStage` 回调；`RULE_TO_STAGE` 覆盖七条规则；P3 的 note 为 `reused:P2.traffic`，`f_s` 直接由 P2 的 `serviceWeightedAccess` 归一化得出 |
| 5 | D6 单 tick 滞后 | P0 把 `current` 推进为 `prev`（`S_{t-1}` 常驻）；P4 只读 `I_f_lagged` 与 P2/P3 结果，**不读 P7 的 `I_t`**；P7 用 `prev.S` 算 `m(S)` 与 `I_t`；`p4Satisfaction === 最终 current.S` 断言 P7 未回写 |
| 6 | 无硬终局 | `CycleOutcome = 'IN_CYCLE' \| 'TARGET_MET' \| 'RETRY_AVAILABLE'`，类型层排除判负；静态扫描无 `GAME_OVER` / `defeat` / `判负` / `失败终局` |
| 7 | 配置注入 | 全部公式参数在 `Config`；`computeConfigHash` 基于 `canonicalize(config)`；`assertConfigCompatible` 不匹配即抛 `ConfigMismatchError`，不静默续算 |
| 8 | 网格 / 分区 | `MAX_GRID_SIDE = 32`、`START_UNLOCKED_SIDE = 16`；`assertGridSide` 抛 `GridLimitExceededError`；`zoneIndex/zoneId` 由 `config.zoneTypes` 生成，增 / 减分区不改数据层代码（3 类 / 4 类 / 2 类均通过测试） |
| 9 | 平衡期数值占位 | 所有数值集中在 `PLACEHOLDER_DEFAULTS`，`meta.kind='PLACEHOLDER'`、`pinnedAt=null`、note 明确「平衡期定，S-12 前钉定；由配置表注入」；`S_init` 不写死，由 `f_init` 与合成公式派生 |
| 10 | 通勤求解最小实现 | 同类型 4-邻接连通块合并（B ≤ `maxBlocks`，无逐格 OD 矩阵）；ROAD 图 BFS（固定邻居顺序，确定性平局）；`t_e` 对 `q/cap` 单调不减；不可达返回 `T_max`；所有除法走 `safeDiv` 兜底 |

### 占位符清单（**全部为占位默认值，不是平衡结论**）

| 类别 | 字段 |
| --- | --- |
| 周期 / 目标 | `K`、`S_unlock` |
| 通勤 / 覆盖 / 环境阈值 | `T_0`、`T_max`、`T_s_max`、`E_max`、`v0`、`beta`、`gamma`、`cap`、`qcapMax` |
| 满意度合成 | `weights.{f_c,f_s,f_e,f_f}`、`alpha`、`f_floor`、`lambda`、`f_init`、`i_ref`、`attributionThreshold` |
| 人口 / 岗位 / 密度 | `p_unit`、`j_C`、`j_I`、`r_labor`、`densityCoefficients[3]` |
| 经济 | `i_unit`、`m_min`、`m_max`、`I_min`、`c_zone`、`c_road`、`m_zone`、`m_road`、`B_floor`、`B_cap` |
| 结构性（非平衡数值） | `gridSide=32`、`unlockedSide=16`、`maxBlocks=64`、`epsilon` |

---

## 6. 本轮范围边界

**做了**：S-02（schema / 配置注入 / 32×32 上限 / 分区可扩展）、S-03（P0~P8 确定性结算链 / CommandQueue / InputGate / 双帧 / D6 解环 / 4 因子合成 / 最小通勤求解 / Δ 与归因当帧产出）、45 条单测与静态纪律扫描、`src/README.md`。

**没做（明确留后续）**：
- S-01 真机 HAP 工程链路、NAPI/XComponent、`PlatformAdapter` 六个接口（本轮**零平台依赖**，未建任何工程）；
- S-04 真机性能基准（T-116 已补 Node 侧实测：32×32 满网格 2 场景 × 120 样本，最重 p95 = 0.435ms，**建议基线 / 非承诺值**，见 `tests/verification/perf-s04.test.ts`；p95 ≤16ms 目标待真机链路重测钉定）；D-02（maxBlocks 截断无信号）已纳入 S-04 验收清单跟踪；
- S-05 持久化存储（T-116 已补**内存模拟介质**的最小实现：Keyframe/Delta 冷归档 ≥3 周期 + 归因链落地 + 恢复回放逐字节一致，见 `src/simulation/snapshot.ts` 与 `tests/verification/cold-archive-s05.test.ts`；真机持久化随 SM-W1-04 顺延；淘汰 / 压缩 / 只读语义留 S-05 / S-09）；D-03（runTick 层无幂等的分层契约）已纳入 S-10 验收清单跟踪；
- S-06~S-12：渲染、UI 双通道与 <100ms 反馈、诊断面板、本地存档 / 断点续玩、回退重试执行、闭环集成、可访问性矩阵、真机校准；
- 任何 Cocos / HarmonyOS SDK 依赖、图片、工程打包、git 提交。

### 留给 S-04 / S-05 的接口占位

| 接口 | 位置 | 说明 |
| --- | --- | --- |
| `TickOptions.solver` | `tick-pipeline.ts` | 可注入通勤求解器；默认 `solveTraffic`。S-04 可替换为分区块 Dijkstra + 拥堵迭代，不改 pipeline |
| `TickOptions.aggregator` | `tick-pipeline.ts` | 可注入满意度聚合器；默认按 GDD 01 §4.2 |
| `TickOptions.recorder` / `AttributionRecorder` | `snapshot.ts` | 默认 `NOOP_ATTRIBUTION_RECORDER`；S-05 挂接真实记录器（内存版实现已可经 `buildTickSnapshot` 喂入 store） |
| `SnapshotStore` / `InMemorySnapshotStore` | `snapshot.ts` | **T-116 已有内存最小实现**（`put/get/getCycleRange/restore/entries`）；S-05 换持久化介质时保持同契约 |
| `TickSnapshot` | `snapshot.ts` | 自包含形状已定义并由 `buildTickSnapshot` 从 `TickResult` 产出（深拷贝隔离 workspace 池）；不落盘 |
| `TickWorkspace.allocations` | `tick-pipeline.ts` | 结构性零分配计数；S-04 可在此挂接耗时 / 分配采样钩子 |

### 已知限制（诚实标注）

1. **P1 非法命令判据为占位**：目前用 `amountCU > B_cap`、锁定区、未知分区三类；GDD 04 的 `C_b > B` 分期 / 禁止策略与 O-2 裁定留 S-11 细化。
2. **P6 议题为占位**：只把 `issueCount` 钳在 2~4，未实现 05 GDD 的生成 / 消退 / 市民之声规则（S-05 / S-09）。
3. **P7 解锁为占位**：达标时只递增 `unlockedRegions`，未实际改写 `cells.unlocked`（解锁区数量与切分形状属平衡期数值，GDD 02 O-2 未定）。
4. **`ΔS` 口径**：按 GDD 01 §4.3 的归因分解式定义（与 `S_t` 的 §4.2 绝对值公式为不同口径，钳制残差允许 ≤1 分）；`|ΔS − ΣΔS_i − ΔS_penalty| ≤ 1` 由测试断言成立。
5. **冷启动首 tick**（GDD 01 E1）：`S_t` 仍按公式计算以反映网格，但 `ΔS=0`、无归因型条目，仅一条教学占位；第二 tick 起正常出归因。
6. **类型检查范围**：`tsc --noEmit --strict` 覆盖 `src/` 全部 9 个源文件；测试文件由 `--check` 与真实运行覆盖（未装 `@types/node`）。
7. **零分配的可测性**：`ws.allocations` 是结构性纪律计数，非 V8 堆采样；真机分配剖析留 S-04 / S-12。T-116 性能套件在 140 次结算（含 20 预热）累计下复验该计数恒 0。
8. **S-05 介质边界（T-116）**：`createInMemorySnapshotStore` 为内存模拟介质，非真机持久化；真机链路验证随 SM-W1-04（S-01）顺延；归档淘汰 / 压缩 / 查询只读语义留 S-05 / S-09。
9. **S-04 数值口径（T-116）**：`perf-s04.test.ts` 的 p50 / p95 / max 为 2026-11-05 本机（Node v22.22.2 / win32 / x64）单次运行实测，建议基线 / 非承诺值；不作为门禁断言（测试内只做有限性检查），真机重测后由主理人钉定。

---

*T-112 产物：9 个 `src/**/*.ts` 源文件 + 7 个测试文件；T-116 增补：D-01 修复（schema.ts / session.ts）+ snapshot.ts 内存实现 + 1 个 unit / 2 个 verification 测试文件 + 证据文档。源码与测试共 4069 行（不含 README 与 md 证据）。测试 72/72 通过（unit 51 + verification 21）、`src/` 严格类型检查零错误、零依赖、零工程配置。*
