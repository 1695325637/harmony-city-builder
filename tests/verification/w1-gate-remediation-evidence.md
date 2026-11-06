# HC-01 · W1 出口门缺口修复验证报告（T-116 / engineering-lead）

| 项 | 内容 |
| --- | --- |
| 工作代号 | HC-01（非产品名） |
| 任务 | T-116 · W1 出口门缺口修复（D-01 S1 缺陷修复 + S-04 性能证据 + S-05 冷归档证据） |
| 日期 | 2026-11-05 |
| 依据 | quality-lead T-114/T-115 复核（W1 = FAIL，根因 1×S1 + 2 项证据缺口）；主理人派单（用户已批准） |
| 授权边界 | 只写 `src/` 与 `tests/`；零依赖；未提交 git、未发布、未删除文件 |
| 对 QA 交付物的改动 | `tests/verification/edge-cases.test.ts` 的 V-06 与 V-STATIC 调用点计数两处按「修复后契约」改写（其余 11 条用例逻辑未动，文件头留修订痕迹）；`w1-w2-verification.md`（v1.1）**未改动** |
| 性质 | 修复方自证报告；独立性复核由 quality-lead（T-116 后续独立重判 W1/W2 出口门）执行 |

---

## 0. 一句话结论

> D-01（S1）已在两处公开载入入口修复并通过 6 条专属回归用例；S-04 补齐 2 场景 × 120 样本实测 p95（建议基线 / 非承诺值）；S-05 以内存模拟介质落地 Keyframe+Delta 冷归档 ≥3 周期并验证恢复回放逐字节一致；D-02 / D-03 已纳入 S-04 / S-10 验收清单跟踪。全量套件（unit + 3 个 verification 套件）**72/72 全绿**，派单指定重跑命令（unit + edge-cases）**63/63 全绿**。

---

## 1. D-01 修复（S1 · 静默续算路径封死）

### 1.1 缺陷与修复点（最小挂接，非重构）

| # | 位置 | 修复前 | 修复后 |
| --- | --- | --- | --- |
| 1 | `src/core/schema.ts` `deserializeState` | `_config` 形参被忽略；旧存档+新 config 静默载入并保留旧 hash | `_config` 改实参 `config`；载入后强制 `assertConfigCompatible(state, config)`，schemaVersion / configHash 任一不匹配抛 `ConfigMismatchError` |
| 2 | `src/simulation/session.ts` `createSimulation` | 不校验 state 与 config 匹配 | 入口即 `assertConfigCompatible(state, config)`（session 是 UI 唯一编排入口，旧存档在此拒绝） |
| 3 | `src/simulation/snapshot.ts` `restore`（新增，见 §3） | — | 冷归档恢复路径同样经 `deserializeState` 断言（D-01 联动） |

分层契约维持不变（对应 D-03 记录）：`runTick` 保持纯函数契约、不做二次校验；防静默续算的守门职责全部落在**载入/编排入口**（deserialize / session / archive.restore）。显式迁移走未来 S-10 migrate() 路径，不经 `deserializeState` 绕行。

### 1.2 回归用例（`tests/unit/d01-config-compat.test.ts`，6 条，命名均标注 D-01）

| 用例 | 内容 |
| --- | --- |
| D-01(a) | serialize → 改 `f_init` → deserialize 必须抛 `ConfigMismatchError` |
| D-01(a') | T-114 复现路径同构：改权重的新 config 载入旧快照必须抛错 |
| D-01(a'') | 篡改 `schemaVersion` → 必须抛错（断言覆盖两字段） |
| D-01(b) | 匹配 config 回环 deserialize 成功，且回环后再结算正常 |
| D-01(c) | `createSimulation` 传 configHash 不匹配 state 抛错；同 config 不抛（对照组） |
| D-01(d) | 公开载入入口全断言：deserialize + createSimulation 均不再静默接受旧存档 |

### 1.3 既有用例影响核查

- `tests/unit` 既有 45 条：全部 `deserializeState` 调用点均传匹配 config（`clone` 回环 / 回放），零改动、零回归（51/51 绿）。
- `tests/verification/edge-cases.test.ts` V-06：原断言「静默续算缺口存在」——修复后行为反转，按派单授权改写为「验证修复后契约」（(b) 载入抛错、(b2) 匹配回环、(c) 编排入口抛错、(d) 内核纯函数契约如实记录、(e) 静态证据 occ≥3）；V-STATIC 调用点计数由 `occ>=1` 收紧为 `occ>=3`。12/12 绿。

---

## 2. S-04 性能证据（建议基线 / 非承诺值）

**来源**：`tests/verification/perf-s04.test.ts`（本机真实运行，非估算）。
**环境**：Node `v22.22.2`（`--experimental-strip-types`），Windows 11 / `win32` / `x64`，Cocos / 真机链路未接入（SM-W1-04 顺延）。
**口径**：单次 `runTick`（P0~P8 全链，含 P2 通勤求解）挂钟耗时；每场景 20 次预热不计样 + **120 个样本**（≥ 派单要求的 100）；计时在验证侧用 `performance.now()`，`src/` 热路径仍零墙上时钟（V-STATIC 扫描只覆盖 `src/`）。

| 场景（32×32 = 1024 格全满） | min (ms) | p50 (ms) | **p95 (ms)** | mean (ms) | max (ms) | 样本 |
| --- | --- | --- | --- | --- | --- | --- |
| A 棋盘 R（连通块逼近 maxBlocks=64 截断面） | 0.056 | 0.058 | **0.270** | 0.126 | 0.835 | 120 |
| B ROAD/R/C/I 行条带 + 满密度（最大 P/J/E 聚合 + 全图 BFS） | 0.117 | 0.141 | **0.435** | 0.222 | 1.027 | 120 |
| C 空城对照（零负载固有开销） | — | 0.049 | 0.059 | — | 0.280 | 120 |

- 全场景 `ws.allocations === 0`（含预热共 140 次结算累计；结构性分配计数口径，与 T-112 相同的诚实标注：非 V8 堆剖析证明）。
- **建议基线（非承诺值）**：32×32 满网格单次结算 p95 ≤ 0.5ms 量级（实测最重场景 B p95 = 0.435ms）。相对 S-04 目标帧预算（1 次结算 / 交互帧，无连续多 tick 需求——OD-2 A 主动推进制）有 ≥3 个数量级余量；真机（HarmonyOS 7 / ArkTS 侧）需 SM-W1-04 后重测钉定。
- p95 与 p50 差值主要来自 GC / OS 调度抖动（单次结算本身确定性同构）；不作为门禁断言（测试内只断言有限性与样本数），避免环境噪声造成假门禁。

---

## 3. S-05 冷归档证据（内存模拟介质）

**来源**：`src/simulation/snapshot.ts` 新增最小内存实现 + `tests/verification/cold-archive-s05.test.ts`（6 条用例）。

### 3.1 实现内容（`createInMemorySnapshotStore` + `buildTickSnapshot`）

- **Keyframe 规则**（architecture §4 最小子集）：归档首条 / `cycleTickIndex===0`（周期首，P7 末帧复位）/ 相邻条目 `cycleId` 推进（周期末帧）→ KEYFRAME 保留全量自包含 `SerializedState`；其余为 DELTA，只留差分条目（delta / attribution / commandTrace），frames 置 null。
- **恢复**：取目标 tick（含）之前最近 KEYFRAME 反序列化，**无逆运算**；DELTA 不参与恢复，前向重放补齐。恢复路径经 `deserializeState`（D-01 断言联动）。
- **确定性**：条目按 tick 插入序存储、查询按插入序返回，无 Map/Set 遍历顺序依赖；`put` 对 delta / attribution / commandTrace / frames 深拷贝，隔离 `TickWorkspace` 复用池。
- **诚实边界**：存储介质为**内存模拟**，非真机持久化；真机链路验证随 SM-W1-04（S-01）顺延；归档淘汰 / 压缩 / 查询只读语义留 S-05 / S-09。

### 3.2 验证结果（K=3 × 9 tick = 3 个完整闭合周期，全 6 条通过）

| 用例 | 结果 |
| --- | --- |
| S-05-① 写入 9 条快照；Keyframe = [1,3,6,9]（首条 + 每周期边界），DELTA=5 条且 frames=null，KEYFRAME 自包含 | PASS |
| S-05-② 归因链 AC2 七字段（primary_factor / dS_i / causeType / refId / contribution / detail / suggested_verb）按 tick 与按周期可检索；`getCycleRange(1,2)` = t3..t8 共 6 条按 tick 序 | PASS |
| S-05-③ 冷归档恢复 t4 → 落 Keyframe t3，前向重放 t4..t9 **状态指纹与原始运行逐字节一致**（canonicalize 口径）；恢复 t9 Keyframe = 原始终态 | PASS |
| S-05-④ 恢复路径 D-01 联动：不匹配 config → `ConfigMismatchError` | PASS |
| S-05-⑤ 归档自身确定性：同一命令序列两次构建，条目逐字节一致 | PASS |
| S-05-⑥ DELTA 携带 commandTrace 幂等键（命令溯源链） | PASS |

---

## 4. 缺陷跟踪区（D-02 / D-03 纳入后续验收清单）

> 本轮**不修复**（派单原文），仅纳入跟踪并写明后续验证方法。

| 缺陷 | 等级 | 描述 | 纳入验收 | 后续验证方法 |
| --- | --- | --- | --- | --- |
| D-02 | S3 | 同类型连通块数超过 `maxBlocks=64` 时静默截断（无事件、无标记），极端布局下丢块不可观测 | **S-04**（求解器真机/替换交接验收） | S-04 交接验收时复跑本报告 §2 场景 A（棋盘 512 块）：断言截断时**必须有可观测信号**（SimEvent 新类型或 stage trace 中记录「实际块数 vs maxBlocks」），不接受无信号静默丢弃；该断言写入 S-04 Story 验收标准 |
| D-03 | S3 | `runTick` 层无幂等（纯函数契约，幂等由 CommandQueue / session 承担），分层契约未文档化 | **S-10**（存档/断点续算验收） | S-10 验收时：① 复跑 V-05 连点用例（session 层幂等，已有）+ 存档恢复后 `seenAdvanceKeys` 重建语义用例；② 在 S-10 Story 文档化「runTick 调用方必须经 CommandQueue 去重」契约，并加一条「直接重复投递同 idempotencyKey 到 runTick 会重复结算」的对照用例，把该行为钉为显式契约而非缺陷 |

---

## 5. 最终测试运行汇总（本机真实执行）

命令与退出码（工作区根目录）：

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node --experimental-strip-types --test tests/unit/*.test.ts` | 0 | 51/51（45 基线 + 6 条 D-01 回归） |
| `node --experimental-strip-types --test tests/verification/edge-cases.test.ts` | 0 | 12/12（V-06 / V-STATIC 已按修复后契约改写） |
| `node --experimental-strip-types --test tests/verification/cold-archive-s05.test.ts` | 0 | 6/6（S-05） |
| `node --experimental-strip-types --test tests/verification/perf-s04.test.ts` | 0 | 3/3（S-04 实测，断言只做健全性检查） |
| `node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/edge-cases.test.ts`（派单指定重跑命令） | 0 | **63/63 全绿** |
| 上命令 + 两个新 verification 套件合并 | 0 | **72/72 全绿** |
| `npx --yes -p typescript@5.9.3 tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions src/index.ts`（**范围仅 src/ 9 文件，经统一导出入口**） | 0 | 严格零错误 |

> **N-01 更正（2026-11-05，quality-lead T-117 发现）**：本表初版误将该行写成「含 src/ 与 tests/」。事实：含 tests/ 时会出现 `TS2307`（`node:test` / `node:assert/strict` 等无 `@types/node`）及测试文件的隐式 any——工作区零依赖、未安装任何临时类型包，测试文件类型声明无从解析；因此 tsc 严格检查口径自 T-112 起即为 **src/ only**（src/README.md §3.3 已有同口径说明）。tests/ 的覆盖由 `node --experimental-strip-types --check`（18 文件全过）+ 真实测试运行（72/72）承担。T-116 期间曾把新测试文件喂给 tsc 以自查 null 收窄（TS18047），已当场修复，但该次运行不构成「tests/ 零错误」的证据，特此更正。

（逐条执行记录见 §2 / §3 与上文各节；所有数字为 2026-11-05 本机单次运行实测。）

---

## 6. W1 出口门自检（供 quality-lead 独立重判）

| 门项 | 状态 | 证据 |
| --- | --- | --- |
| SM-W1-02 失败即停（D-01 S1） | 已修复 | §1：两处入口挂接 + 6 条回归 + V-06 改写后 12/12 |
| S-04 性能证据缺口 | 已补 | §2：2 满网格场景 × 120 样本 p95 实测（建议基线/非承诺值），真机重测随 SM-W1-04 |
| S-05 快照冷归档缺口 | 已补（内存模拟介质） | §3：≥3 周期 Keyframe/Delta + AC2 归因落地 + 恢复回放逐字节一致；真机持久化随 SM-W1-04 顺延 |
| 既有 45 条基线 | 零回归 | §1.3 / §5 |

**待 quality-lead 独立复核事项**：① V-06/V-STATIC 改写是否接受为「修复后契约验证」而非「篡改 QA 交付物」；② 内存模拟介质的 S-05 证据是否满足 W1 门（派单已授权该口径）；③ D-02/D-03 跟踪写法是否符合 S-04/S-10 验收清单要求。
