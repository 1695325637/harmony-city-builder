# S-10 第一批 · 第二层 QA 独立复核报告（T-142 · W4 门）

> 复核人：quality-lead（严守真）· 立场：**fresh eyes 独立验证**，不复用实现方 fixture 与断言。
> 被复核对象：E 线 T-140（本地存档层）+ F 线 T-141（D-03 幂等契约显式化），代码提交 `94e398d`、裁定留痕 `75ea03a`。
> 可复跑证据：`tests/verification/s10-qareview.test.ts`（25 条，QAS-1~QAS-25）。
> 权威口径：`production/epics/epic-breakdown.md` S-10 六条验收；`docs/architecture/adr/ADR-003-save-data-and-attribution.md` §2/§4/§5/§6；`tests/quality-closure.md` **v1.2 EX-03**。

---

## 0. 一句话结论（双层，不可合并）

| 层 | 判定 | 含义 |
| --- | --- | --- |
| **纯逻辑 / 内存模拟介质侧** | **PASS**（advisory） | S-10 验收 1~5 的离线可验部分逐条成立：五类字段恢复、A/B 双槽与故障回退、header / 版本 / 显式迁移 / D-01 联动、零墙上时钟、H3 仅能力位签名。 |
| **真机半侧** | **PARTIAL / BLOCKED** | 杀进程恢复、切后台、应用沙箱 / KV 偏好确切接口、HAP 权限模型、checksum 真机落盘 —— 本机无 DevEco / hdc / ohos SDK / Cocos 导出环境，按 EX-03 顺延、**已登记为准出阻塞项**。 |

> **本报告全文严格限定在「内存模拟介质可验证」范围。不声称真机验证通过，不声称断点续玩已达成，不写「已验证 / 已达标」。**
> 门判定为 **advisory**：放行由用户决定；**准出层仍 BLOCKED**（GAP-12 实测待执行 + EX-03 真机阻塞）。

---

## 1. 复核方法

1. **独立复跑**：不采信回执数字，自己跑全量与 `tsc`（§2）。
2. **自建 fixture**：自建 16×16 城市 + 真实 `runTick` × N 推进出 `CityState`，不复用 SV/SL/MG 的 `makeState`、不复用其断言顺序（QAS-1~QAS-15）。
3. **独立故障注入**：不用实现方用例的注入序列，自写 A~H 八个探针（§3.1），只依赖介质公开 API（`faults` / `corruptSlot` / `raw` / `write`）。
4. **静态证据**：读源码做文本级断言（零时钟 / 零 `node:` / 零结算调用 / H3 零实现 / README 行数），不只看文档自述。
5. **越界核查**：专门扫「真机 / 断点续玩 / 达标」字样的语境（QAS-20）。
6. **注入探针**：对 F 线做**文件级**注入（不是内联字符串），注入后必须变红、撤销后必须复绿、工作树必须复原（§3.3）。

---

## 2. 独立复跑记录

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 全量单测 | `node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts` | **463 / 463 pass，0 fail，EXIT=0**（基线 438 + 本报告新增 QAS-25 条） |
| 类型检查 | `npx --yes -p typescript@5.9.3 tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions --skipLibCheck src/index.ts src/ui/index.ts src/save/index.ts` | **EXIT=0**（无输出） |
| 工作树 | `git status --porcelain` | 仅 `?? tests/verification/s10-qareview.test.ts`（本报告 + 用例，**未提交**，按派单不碰 git） |
| 基线 | `git log --oneline -3` | `75ea03a`（裁定留痕）/ `94e398d`（S-10 代码与用例）/ `c31d0ba` |
| 与主理人数字一致性 | 438/438 + tsc EXIT=0 | **一致**（我多出的 25 条是本轮 QA 新增，非基线漂移） |

> 复核期内的**唯一**改动面：新增 `tests/verification/s10-qareview.test.ts`（736 行）+ 本 md。
> `src/**` 全程零改动（§3.3 的两次注入已撤销，`md5` 与 `git status` 双证复原）。

---

## 3. E 线（T-140 存档层）九项判定

| # | 验证点 | 判定 | 我的独立证据（非实现方用例） |
| --- | --- | --- | --- |
| ① | 验收 1：五类字段逐项一致、时间轴不推进 | **PASS** | QAS-1：4 tick 后 `tickId=4`、`zone` 有已建地块、`inputVersion` 已 bump、`S` 与初值不同（先证明 fixture 非全默认）；`save → load` 后 `cells` 5 个 TypedArray、`budget` 7 标量、双帧 9 标量 + 2 向量、`issueCount`、`unlockedRegions` 逐项相等；`tickId/cycleId/cycleTickIndex` 不变；整状态 `canonicalize` 逐字节相等。QAS-2：连载 3 次结果全同、`writeCount` 恒定、`prngSeed` 原样回传（不消耗）。 |
| ② | 验收 2：双槽任一时刻至少一完好 / 写中断 / 损坏回退 / 绝不加载半损坏 | **PASS** | QAS-3~QAS-8 + 探针 A~D（§3.1）：交替写 `A(seq1) → B(seq2)`；`corruptSlot(最新)` → 回退旧槽 + `FELL_BACK_TO_PREVIOUS_SLOT` + **返回状态与旧档逐字节相同**；`interruptNextWrite` → `WRITE_INTERRUPTED` + 旧槽字节不动 + 目标槽半损坏被判无效 + 故障开关一次性自复位；`failNextWrite` → 目标槽**连半损坏都不留**（仍为 `null`）；双槽全坏 → `NO_VALID_SLOT` + `state=null` + 两槽均记损坏；篡改 `budget.B` 不改 checksum → `parseSaveSlot` 直接判损坏；读失败 → 归入损坏槽、另一槽照常载入。 |
| ③ | 验收 3：header 五字段 + 版本拒绝 / 迁移 / 无静默续算 / D-01 联动 | **PASS** | QAS-9~QAS-15 + 探针 E/F/MIG：header 键集合恰为 `{schemaVersion, configHash, engineVersion, seed, checksum, saveTime}`；缺省 `saveTime='tick:3'`（确定性、不读时钟），换成外部展示标签后 `saveTime`/`checksum` 变而**恢复出的状态逐字节不变**；默认 `migrations:[]` 旧版本 → `VERSION_MISMATCH_NO_MIGRATOR` + 槽字节不变；`configHash` 漂移**即使注册迁移器** → `CONFIG_MISMATCH_REJECTED`（判定顺序 configHash → engineVersion → schemaVersion，见 `save-service.ts` L291~311）；`engineVersion` 漂移无迁移路径；显式迁移多跳 → `MIGRATED` + `tick` 不推进 + **旧槽字节不变 + 零额外写**；成环 / 谎报目标版本 → 拒绝且不挂死（防环上限 = 迁移器数+1）；写入侧 `assertConfigCompatible` 拒绝 → `SAVE_REJECTED_INCOMPATIBLE_STATE` + **零写**。 |
| ④ | 验收 4：零墙上时钟 / 零随机 / 零平台依赖 | **PASS** | QAS-16 + QAS-17：`src/save/**` 4 个文件对 18 个禁用令牌（`Date.now`/`new Date`/`Math.random`/`performance.now`/`process.hrtime`/`setInterval`/`setTimeout`/`requestAnimationFrame`/`countdown`/`autoPlay`/`from 'node:`/`require(`/`fetch(`/`XMLHttpRequest`/`WebSocket`/`localStorage`/`sessionStorage`/`indexedDB`）**零命中**；依赖面仅 `'../core/*'`、`'./types.ts'` 与 `'../simulation/snapshot.ts'`（**仅 `import type StoredSnapshot`**，见 §6 N-02）。 |
| ⑤ | 验收 5：H3 仅能力位签名、flag 冻结 false、全库零同步实现 | **PASS** | QAS-18：`SAVE_FEATURE_FLAGS.h3CrossDeviceSync === false` 且对象冻结；`storage.remote === undefined`；`readRemote` / `writeRemote` / `currentVersionVector` 只以接口签名形式出现在 `types.ts`；**全 `src/**`（≥25 文件）零 `implements RemoteSaveCapabilities`、零 `readRemote(` 实现、零 `fetch(`**。 |
| ⑥ | 验收 6：E 线不重复实现幂等、不碰 F 线文件域 | **PASS** | `src/save/**` 零 `runTick(` / `solveTraffic(` / `advanceDay(` / `createSimulation(` / `computeBaselineS(` / `aggregate(`（QAS-17）；唯一 `seen` 是 `applyMigrations` 的**防环哨兵**（元素为 `schemaVersion`，QAS-21）；`git show 94e398d --stat` 中 `src/simulation/**` **零改动**。 |
| ⑦ | checksum 定位符合 ADR-003 且文档明示 | **PASS** | 见 §5 裁定 ④。代码 `computeSaveChecksum` 注释（`save-service.ts` L62~66）+ `types.ts` 头注 L11~13 + `s10-save-verification.md` §4.3 + `src/README.md` §2.3 警告块，四处一致明示「防误改 / 防写坏、不是反作弊、不是防篡改承诺、不做强加密」。 |
| ⑧ | README 行数与磁盘一致、6 个 render 模块未改 | **PASS**（附观察项 N-03） | QAS-19：**动态**解析 `src/README.md` 全部 `| \`src/...\` | N |` 行（实得 23 条，含 §2 / §2.1 / §2.3），逐条与磁盘 `wc -l` 比对**全等**；§2.3 四模块 237 / 105 / 458 / 11 均被声明且一致；`src/index.ts` = 28 行且含 `export * from './save/index.ts'`。6 个 render 模块行数与 T-136/T-139 复核时完全相同（iso 175 / view-model 158 / semantic-tokens 323 / atlas 458 / asset-naming 343 / draw-list 334），一行未改。 |
| ⑨ | 诚实话语：无越界声称 | **PASS** | 见 §7。QAS-20 的 7 处命中全部处于否定 / 限定语境或阶段清单条目名，**零正面声称**。 |

### 3.1 独立故障注入探针（A~H，本轮实跑输出）

自建脚本（临时，跑完即弃，未入库），只用介质公开 API：

```
A  roundtrip        { ok:true, bytesEqual:true, canonicalEqual:true, tickId:3, cycleId:1, cycleTickIndex:1, slot:'A', seq:1 }
B  secondSave       { w1:'A', w2:'B', seq1:1, seq2:2 }
C  fallback         { slot:'A', code:'FELL_BACK_TO_PREVIOUS_SLOT', damaged:['B'], bytesEqualOld:true }
D  bothBad          { ok:false, state:null, code:'NO_VALID_SLOT', damaged:2 }
E  versionMismatch  { ok:false, state:null, code:'VERSION_MISMATCH_NO_MIGRATOR', slotBytesUnchanged:true }
F  configDrift+Mig  { ok:false, state:null, code:'CONFIG_MISMATCH_REJECTED' }
G  tamper(payload)  { ok:false, state:null, code:'NO_VALID_SLOT', damaged:['A'] }
H  saveIncompatible { ok:false, code:'SAVE_REJECTED_INCOMPATIBLE_STATE', writes:0 }
MIG migration       { ok:true, code:'MIGRATED', tick:1, headerVer:'HC01-SCHEMA-1', slotBytesUnchanged:true, extraWrites:0 }
```

**读数要点**：C 与 F 是两条最容易被"做假通过"的路径 —— C 若只断言 `ok===true` 就漏掉「回退到的是不是**旧档**」，我额外用 `JSON.stringify(serializeState(...))` 逐字节比对（`bytesEqualOld:true`）；F 是"D-01 无迁移路径"的核心反证，我特意**同时**制造「旧 schemaVersion + 已注册迁移器」，仍被 `CONFIG_MISMATCH_REJECTED` 拦下，说明迁移链**不能**绕开 configHash 硬约束。

### 3.2 我的探针错误（如实记录，非实现缺陷）

首轮 C 探针我用 `canonicalize(loaded.state)` 与 `canonicalize(state)` 比对，得到 `bytesEqualOld:false`，一度怀疑回退返回了错误状态。

**根因是我的口径错误**：`canonicalize(CityState)` 序列化的是**整 state 对象**（含 `frames` 的 `Float64Array` 等全部字段），而落盘/回读链路上被比较的对象来路不同（一侧经 `serializeState → deserializeState` 往返、一侧是内存中的原对象），两者在 `canonicalize` 下的可比性不等同于"落盘字节可比"。
改用 `JSON.stringify(serializeState(x))`（即**落盘口径**）后：`bytesEqualOld:true`，且与 QAS-3 的 `canonicalize` 断言、实现方 SL-2/SL-3 自洽。

> **结论：这是我的探针错误，不是实现缺陷。** 已按实保留此记录，避免后续读者误以为该探针首轮红过是产品问题。
> 顺带说明为什么 QAS-3 里的 `canonicalize(r.state!) === canonicalize(s1)` 是**成立**的：那里两侧都是 `deserializeState` 产物（`qaState` 内部已往返一次），口径一致。

### 3.3 F 线文件级注入探针（不是内联字符串）

| 步骤 | 动作 | 结果 |
| --- | --- | --- |
| 0 | 记录基线：`md5(tick-pipeline.ts) = 67f4365cefaabe4fcb683268d57ff9b8`，454 行，`git status` 干净 | — |
| 1 | **结构型注入**：在 `runTick` 体首插入 `const QA_PROBE_seen = new Set<string>(); if (commands.length>0 && QA_PROBE_seen.has(commands[0].idempotencyKey)) return ws.out;` | `idempotency-contract.test.ts` → **10 pass / 2 fail**：`ID-09` 红（`runTick 不得出现任何二次幂等校验模式`）、`ID-11` 红；`ID-10` 仍绿 |
| 2 | 撤销（Edit 反向恢复），核对 `md5` 复原 | `md5` 与基线一致，`git status` 干净 |
| 3 | **功能性注入**：模块级 `const QA_PROBE_DEDUP = new Set<string>()` + 体内 `has → return ws.out; add`（真的会去重） | **7 pass / 5 fail**：`ID-04` 红（实测 `两条都记入溯源 + [] vs ['same','same']`）、`ID-07` 红、`ID-08` 红、`ID-09` 红、`ID-11` 红 |
| 4 | 撤销，核对复原 | `md5` 回到 `67f4365…`，454 行，`git status` 干净；单跑 `idempotency-contract.test.ts` **12/12**；全量 **463/463** |

**这两次注入给出的分层结论**（比我预想的更有信息量）：

- **结构层能抓到行为层抓不到的**：步骤 1 的守门是"哑弹"（`Set` 从不写入，运行期永不触发），行为用例 8 条**全绿**，只有 `ID-09` / `ID-11` 的结构扫描把它拦下。这说明静态结构断言不是冗余装饰，它覆盖的是"后人把守门职责下沉到内核"这类**行为等价但契约被破坏**的改动。
- **行为层能抓到结构层抓不到的**：步骤 3 的真实去重在 `ID-04`（重复 ADVANCE 仍只 1 个 `TickCommitted`）与 `ID-07`（历史 `commandTrace` 不被注入新会话 `seen`）上直接红，说明这两条对照用例不是永真断言。
- **三层防永真成立**：`ID-10` 在两次注入中都保持绿（它是自包含哨兵，喂伪造源码必须被判含校验），反向证明 `ID-09/11` 的红来自**被检对象**变化而非检测器恒真。

---

## 4. F 线（T-141 幂等契约）八项判定

| # | 验证点 | 判定 | 我的独立证据 |
| --- | --- | --- | --- |
| ① | 契约准确性与代码事实一致 | **PASS** | QAS-21：`commands.ts` L45~46 `seen.has(cmd.idempotencyKey)` / `seen.add(...)`；`session.ts` 含 `queue.enqueue(` 与 `seenAdvanceKeys`；`tick-pipeline.ts` 有 `idempotencyKey`（溯源用）但**零** `seen.has(` / `seen.add(` / `seenAdvanceKeys` / `DUPLICATE`。 |
| ② | 反向对照非永真 | **PASS** | QAS-22：同 key 两条 `ZONE` 直接喂 `runTick` → `commandTrace = ['same','same','qas-adv']` 且**两格都落到网格**（重复应用属实）。QAS-23：`CommandQueue` 同 key 第二次 `enqueue` 返回 `false`、`size=1`；`drain()` 后 `seen` **仍记得旧键**（同会话永不复用），只有 `clear()` 才重建 —— 这比我原以为的更强，我按实测把断言改成 `false` 并补了 `clear()` 对照。 |
| ③ | 三层防永真 | **PASS** | ID-09 正向对照（抽到的函数体 > 2000 字符且含 `commandTrace.push` / `enterStage` / `copyFrameForLag` / `solveTraffic` / `copyState`，防抽错函数体）；ID-10 反向哨兵；ID-11 注入哨兵。**我另做文件级注入两次**（§3.3），红/绿/复原三态齐全。 |
| ④ | 存档恢复后键重建语义与 E 线自洽 | **PASS** | QAS-24：`LoadResult` 键集合恰为 `{ok, state, slotId, header, ledger, prngSeed, notice, validSlots, damagedSlots}` —— **签名层面就不可能回填幂等键集合**；新会话 `CommandQueue` 对旧键再接受一次（与契约 §4.3 披露一致）；`src/save/save-service.ts` 零 `commandTrace` 引用（ledger 里的历史键只作溯源、不进判定）。 |
| ⑤ | D-01 / D-03 边界准确 | **PASS** | D-01 = S1 已关闭缺陷（改过源码，守门在 `deserializeState` / `createSimulation` / `restore` 三处）；D-03 = S3 契约缺口（源码零改动，只加文档 + 用例）。`94e398d` 对 `src/simulation/**` **零改动**，与"F 线不碰内核"的纪律一致。 |
| ⑥ | 裁定 ① 落地 | **PASS** | `w1-gate-remediation-evidence.md` D-03 行**原文保留**（L100 仍写「重复结算」），表后 L102 有「**口径订正（2026-11-07 · 主理人裁定，T-141 交付后）**」注记，明确区分「重复应用」vs「重复结算 / 多 tick 提交」，并写明「本表原文保留备查，不改写历史判定」。 |
| ⑦ | 裁定 ②③ 落地 | **PASS** | 裁定 ②：`s10-idempotency-contract.md` §4.3 **原文保留**「当前实现不提供「跨会话全局幂等」。旧会话用过的 `idempotencyKey` 在新会话中会被接受一次」，后接裁定块（不追加本批验收、登记后续开放项）。裁定 ③：`.workbuddy/memory/2026-11-07.md`（commit `75ea03a`）记录「`ledger.commandTrace` 不剥离 / 不回退 / 不扩范围」五条理由 + 「`SaveService.load()` 从不读取、不重放、不回填」。 |
| ⑧ | 跨域纪律 / 无 D-15 双写痕迹 | **PASS** | `git show 94e398d --stat` 共 15 文件：`src/save/*`(4) + `src/README.md` + `src/index.ts` + `tests/unit/*`(4) + `tests/verification/*`(2) + `tests/quality-closure.md` + `w1-gate-remediation-evidence.md`(+6) + memory(+32)。**无 `src/simulation/*`、无 `src/ui/*`、无 `src/render/*`、无 `design/**`、无 `docs/**`、无 `production/**`**。两线文件域互不触碰；本轮我复核时 `git status` 仅我新增 1 文件，**无覆盖痕迹**（D-15 防再犯的"写前检查存在性"未被违反）。 |

---

## 5. 裁定 ④（checksum 定位）· 认可

**我的结论：认可。** 依据三点，逐条对 ADR-003 原文：

1. **实现面**：`computeSaveChecksum` = `hashString(canonicalize(JSON.parse(JSON.stringify(payload))))`，payload 覆盖 `header`（除 checksum 的 5 个字段）+ `current` + `ledger` + `prngSeed` + `writeSeq`，即**除自身外的全部落盘内容**；先做 JSON 往返归一，使摘要定义在"实际落盘的字节"上，避免 `NaN` / `-0` / `undefined` 在序列化前后产生不同结果。`parseSaveSlot` 另外做结构完整性 + header/current 版本一致性 + **两处 checksum 同值** 三重校验，任一不满足即返回 `null`（→ 判损坏、绝不加载半损坏数据，QAS-7 实测）。
2. **定位面**：`hashString` 是 FNV 风格确定性摘要，**非加密摘要、无密钥、无 MAC**。这与 ADR-003「**防误改 / 防写坏**（落盘一半、位翻转、人为改坏），**不是反作弊、不是防篡改承诺、不做强加密**」逐字对应：它拦的是"意外与随手改坏"，不拦"有能力的对手手工重算"（单机、无 PvP、无对抗，ADR-003 §6 R-6 已接受该边界）。
3. **披露面**：四处一致明示该定位 —— `save-service.ts` L62~66 函数注释、`types.ts` 头注 L11~13（含「不得在文案中暗示防篡改」）、`s10-save-verification.md` §4.3「checksum 定位（诚实标注）」、`src/README.md` §2.3 警告块。**不存在"把 FNV 说成防篡改"的越界表述。**

> **关于派单里提到的「G10」**：按 ADR-003 原文与主理人说明，G10 是「跨专业冲突已登记且未改 design 上游」的**评审门**，不是"摘要算法选型门"。因此本项**不按"算法是否足够强"评判**，只按"定位是否与 ADR 一致 + 是否明示"评判 —— 结论 PASS。若未来有人主张"换成 SHA-256 才算过 G10"，那是把评审门误读成技术门，应回到 ADR-003 §2.5 / §6 R-6 裁定。

---

## 6. 新缺陷与观察项

### D-03 —— 建议 **CLOSED**（S3 → 已关闭）

理由（三条，缺一不可）：

1. **契约已文档化**：`tests/verification/s10-idempotency-contract.md`（240 行）明确「去重由 `CommandQueue.enqueue` + `Simulation.submit` 负责，`runTick` 保持纯函数不二次校验」，并给出契约外用法（直接投递同 key 会**重复应用**）。
2. **契约已钉成用例**：`ID-01~ID-12`，且我验证了**非永真**（§3.3 两次注入、QAS-22/23 反向对照）。
3. **跟踪写法已订正且原文保留**：`w1-gate-remediation-evidence.md` L100 原文 + L102 裁定注记（区分「重复应用」与「重复结算 / 多 tick 提交」），符合"不改写历史判定"的要求。

**残留边界（不构成 D-03 未关闭的理由，但须留在开放项里）**：跨会话全局幂等不提供（`seen` 重建为空 → 旧 key 在新会话被接受一次）。已由裁定 ② 登记为后续开放项，`s10-idempotency-contract.md` §9 遗留项 1 承接待办。

### N-02（观察项 · 口径澄清，非缺陷）`import type` 跨域依赖

`src/save/types.ts` L28 与 `src/save/save-service.ts` L41 以 **`import type { StoredSnapshot } from '../simulation/snapshot.ts'`** 取 `StoredSnapshot`，仅作 `buildSaveLedger(snapshots: readonly StoredSnapshot[])` 的**入参类型** —— 零运行期耦合（QAS-17 实测 `src/save/**` 零 `runTick(` / `solveTraffic(` / `advanceDay(` 调用）。

派单 ⑥ 写的是「E 线不得重复实现或引用 `src/simulation/*`」。若**按字面**读，这条 `import type` 算"引用"；若按**用意**读（不重复实现幂等、不引用模拟内核的**运行期行为**），则完全合规。

**我的判定：合规**，因为类型剥离后该 import 在运行期**不产生任何模块加载**（`--experimental-strip-types` 下 `import type` 被整行移除），且 `StoredSnapshot` 是 S-05 早已存在的只读数据结构。建议主理人在 S-10 交付说明里把口径一句话钉死：「E 线不得引用 `src/simulation/**` 的**运行期行为**；只读类型的类型级依赖不受限」。级别 **N（口径澄清）**，不阻塞出门。

### N-03（观察项 · 预存文档漂移，非本批引入）README §2 的 `tests/` 聚合行数已失真

`src/README.md` §2 声明 `tests/unit/*.test.ts | 869`、`tests/verification/*.test.ts | 1238`；实测（本轮复核时）为 **8633**（39 文件）、**2729**（8 文件，**扣掉我本轮新增的 736 行**）。也就是说：`verification` 那一行在我动手之前就已比声明值多出 **1491 行**，`unit` 那一行多出 **7764 行** —— 二者**在 S-09 / S-10 前几批新增用例后就没再同步**，属**预存漂移**，非 T-140/T-141 引入。

- 我**没有**去改它（不在我的授权面，且属主理人统一收口）。
- 我的 `QAS-19` 守卫**故意只校验 `src/**` 行**且用**动态解析**（读 README 声明值 ↔ 磁盘实际值），不硬编码任何数字 —— 这样既守住了 D-07 的漂移风险，又不会因为我自己新增测试文件而把守卫自己弄红。
- 建议（不阻塞）：把 §2 的 `tests/` 两行改成非数字表述（如「`tests/unit/*.test.ts`：39 文件 / 全量 463 条（见 §4）」并加一句"此数随批次变动，不作门禁"），或把这两行也从守卫范围里显式豁免。级别 **N（文档一致性）**。

### 本轮未发现 Blocker / Critical / Major / Minor 缺陷

E 线九项、F 线八项全部 PASS；无新增 S1~S4 级缺陷。D-01（S1，已 CLOSED）在存档层联动复验通过（QAS-11 / QAS-15 / 探针 F·H）。

---

## 7. 越界声称核查（QAS-20）

扫描面：`src/README.md`、`src/save/types.ts`、`src/save/storage.ts`、`src/save/index.ts`、`tests/verification/s10-save-verification.md`、`tests/verification/s10-idempotency-contract.md`。
关键词：`真机验证`、`真机实测`、`断点续玩`、`已达标`。

| 命中 | 语境 | 判定 |
| --- | --- | --- |
| `src/README.md:115` | 「所有『原子写 / 双槽 / 断点续玩 / 迁移』结论**仅限定为**『内存模拟介质可验证』」 | 限定语境 ✅ |
| `src/README.md:242` | 「S-06~S-12：…本地存档 / 断点续玩、…」= **阶段清单条目名** | 非声称 ✅ |
| `src/save/types.ts:9` | 「均只限定为『内存模拟介质可验证』，**不得声称**已在真机达成」 | 否定 ✅ |
| `src/save/storage.ts:8` | 「**不得据此声称**『断点续玩已在真机达成』」 | 否定 ✅ |
| `s10-save-verification.md:18` | 「**严禁声称**已在 HarmonyOS 真机验证 / 断点续玩已达成」 | 否定 ✅ |
| `s10-idempotency-contract.md:11` | EX-03 双层判定 + 「**不声称任何真机验证**，不写『已验证 / 已达标』」 | 否定 ✅ |
| `s10-idempotency-contract.md:199` | 「本线**不声称真机验证**，不写『已验证 / 已达标 / 真机通过』」 | 否定 ✅ |

**结论：零正面声称。** 反向证据也成立（不是靠"没写"混过去）：`s10-save-verification.md` 有「严禁声称」、`types.ts` 有「不得声称」、`index.ts` / `storage.ts` 头注均写明介质口径。

---

## 8. S-10 门判定（EX-03 双层）

| 判据 | 纯逻辑 / 内存模拟介质侧 | 真机半侧 |
| --- | --- | --- |
| S-10 验收 1（五类字段 / 不推进 tick） | **PASS**（QAS-1/2） | **BLOCKED** —— 杀进程后从沙箱真实读回未验证 |
| S-10 验收 2（双槽 / 回退 / 半损坏） | **PASS**（QAS-3~8 + 探针 A~D） | **BLOCKED** —— 真实 fsync+rename 原子语义、写中断的真机表现未验证 |
| S-10 验收 3（header / 版本 / 迁移 / D-01） | **PASS**（QAS-9~15 + 探针 E/F/MIG） | **BLOCKED** —— 真实 KV 偏好的版本字段与格式未校准（K-4） |
| S-10 验收 4（零墙上时钟 / 零平台依赖） | **PASS**（QAS-16/17） | **PARTIAL** —— 权限声明文件不在本仓库（K-4） |
| S-10 验收 5（H3 仅签名） | **PASS**（QAS-18） | 不适用（本批明确不实现同步） |
| S-10 验收 6（D-03 契约） | **PASS**（F 线八项 + 注入探针） | 不适用（纯逻辑契约） |
| **层门结论** | **PASS（advisory）** | **PARTIAL / BLOCKED（准出阻塞项）** |

> **合并表述（供主理人直接引用）**：
> 「S-10 第一批在**纯逻辑 / 内存模拟介质侧判 PASS（advisory）**，S-10 验收 1~6 的离线可验部分逐条成立且经第二层 QA 独立复核；
> **真机半侧维持 PARTIAL / BLOCKED**，按 `tests/quality-closure.md` v1.2 EX-03 顺延至真机环境就绪、最迟 S-12 前补齐，并**正式登记为准出阻塞项**。
> 因此 **W4 门不得合并为单一 PASS**；准出层仍 BLOCKED。」

---

## 9. 待主理人 / 用户决策

| # | 事项 | 我的建议 |
| --- | --- | --- |
| 1 | D-03 是否标 **CLOSED** | **建议标 CLOSED**（§6 三条理由齐备），同时在开放项保留"跨会话全局幂等"（裁定 ② 已登记）。 |
| 2 | N-02 口径钉死 | 建议在 S-10 交付说明中写「不得引用 `src/simulation/**` 的**运行期行为**；只读类型的类型级依赖不受限」。 |
| 3 | N-03 README tests 聚合行数 | 建议改成非数字表述或显式豁免出守卫范围；**不必本轮处理**，但下一批收口时顺手改，否则每批都会更失真。 |
| 4 | 是否接受 `QAS-25` 条并入门禁 | 我按前几轮惯例把复核证据做成常驻用例（`s10-qareview.test.ts`，25 条），全量从 438 → **463**。若主理人希望门禁只保留实现方用例，我可把该文件改为"仅报告、不入 glob"（需改扩展名）。 |
| 5 | 组合根调用点（P8 落盘 / `onBackground` 强制再存 / 回退·解锁后存） | 属 **S-12 场景接入**，本批未接入真实生命周期。建议在 W4 门说明里显式列为 S-12 待办，避免被读成"存档已接入"。 |

---

## 10. 留痕

- **本轮新增**：`tests/verification/s10-qareview.test.ts`（736 行，QAS-1~25）、`tests/verification/s10-qareview.md`（本文件）。
- **本轮修改的产品代码：零。** 两次注入探针的撤销以 `md5` + `git status` 双证：
  - 注入前 `md5(src/simulation/tick-pipeline.ts) = 67f4365cefaabe4fcb683268d57ff9b8`，454 行；
  - 两次撤销后 `md5` 与行数**完全一致**，`git status --porcelain` 输出为空（除我新增的测试文件）。
- **未提交 git**（按派单：统一由主理人提交）。
- **临时脚本**（`/tmp/probe1.mjs`、`/tmp/probe_s10.mjs`）只在本机跑过，未入库，不构成交付物。
- 复核期间未触碰：`design/**`、`docs/**`、`production/**`、`tests/quality-closure.md`、`tests/traceability-matrix.md`、既有任何实现方文件。
