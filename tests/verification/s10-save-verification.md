# S-10 本地存档层 · 自验记录（T-140 · W4 第一批 E 线）

> 状态：**纯逻辑 / 内存模拟介质侧 PASS（自验）**；**真机半侧未验证 / EX-03 顺延**。
> 本文由 engineering-lead 产出，不替代 quality-lead 的独立复核与 W4 门判定。

## 1. 真机约束与双层判定（必须置于最前）

本机实测**无** `deveco` / `hdc` / ohos SDK / Cocos 导出环境。按用户 2026-11-07 拍板
「顺延并登记升级」，主理人已在 `tests/quality-closure.md` **v1.2 新增 EX-03** 登记：
W4 门采用「纯逻辑 / 内存模拟介质侧可判 PASS，真机半侧一律 PARTIAL / BLOCKED」双层判定。

| 侧 | 项 | 本批结论 |
| --- | --- | --- |
| 纯逻辑 / 内存模拟介质 | 存档结构 / A/B 双槽 / checksum / 显式迁移 / 故障注入 / 五类字段恢复 | **自验 PASS**（32 条 `save-*` 用例） |
| 真机半侧 | `SM-W1-04` 真机生命周期、`SM-W2-05` 真机持久化半侧、S-06 ③b 格式探测写入校准记录、`K-4`（应用沙箱 / KV 确切接口、HAP 包体上限与权限模型） | **未验证 / EX-03 顺延**，正式登记为**准出阻塞项**，最迟 S-12 前补齐 |

**对外口径**：本批交付的是**内存模拟介质的存档层**（与 S-05 冷归档同款先例）。
**严禁声称已在 HarmonyOS 真机验证 / 断点续玩已达成**。所有「恢复 / 原子写 / 双槽 /
迁移」结论一律限定为「内存模拟介质可验证」。

## 2. 权威口径

- `production/epics/epic-breakdown.md` S-10 六条验收（本批覆盖 1~5；第 6 条 D-03 幂等契约由 F 线 T-141 独占）。
- `docs/architecture/adr/ADR-003-save-data-and-attribution.md` §2 / §5 / §8、`architecture.md` §5.1~5.4。
- `tests/smoke-checklist.md` SM-W4-01 / 02 / 03、`control-manifest.md` R-03 / R-07。
- AD-004 双通道、AC-T8 ④、OD-2 A（默认暂停 / 手动 tick）保持不变。

## 3. 交付物

| 路径 | 说明 |
| --- | --- |
| `src/save/types.ts` | `SaveSlot` / `SaveHeader` / `ISaveStorage` / `InMemorySaveStorage` / `SaveStorageFaults` / `SaveMigration` / 结果与提示类型；H3 能力位签名 + 默认关闭的 flag |
| `src/save/storage.ts` | `createInMemorySaveStorage()`：A/B 双槽内存介质 + 一次性故障注入开关 |
| `src/save/save-service.ts` | `createSaveService()` / `save()` / `load()` / `computeSaveChecksum()` / `parseSaveSlot()` / `encodeSaveSlot()` / `buildSaveLedger()` |
| `src/save/index.ts` | 存档层统一出口 |
| `src/index.ts` | +1 行 `export * from './save/index.ts'`（27→28） |
| `src/README.md` | §2 `src/index.ts` 行数同步 + 新增 §2.3 存档层索引（行数与磁盘一致） |
| `tests/unit/save-service.test.ts` | SV-1~12 |
| `tests/unit/save-slots.test.ts` | SL-1~10 |
| `tests/unit/save-migration.test.ts` | MG-1~10 |

## 4. 结构与关键决策

### 4.1 SaveSlot / SaveHeader

```
SaveSlot = {
  header: { schemaVersion, configHash, engineVersion, seed, checksum, saveTime(仅展示) },
  current: SerializedState,          // 最近全量快照，五类字段全在此
  ledger: readonly SaveLedgerCycle[],// 最近 ≥3 周期冷归档（Keyframe + Delta，只读）
  prngSeed: number,
  checksum: string,                  // 与 header.checksum 同源同值，两处逐一比对
  writeSeq: number,                  // A/B 交替写序号，单调递增（纯元数据）
}
```

- header 五字段齐备（epic S-10 验收 3）+ `saveTime` 仅展示（ADR-003 §2.1）。
  `checksum` 在 header 与槽顶层各留一份同值，以兼容 ADR-003 §2.1 与
  `architecture.md` §5.1 两处略有差异的结构描述。
- `saveTime` 由调用方注入（缺省 `tick:<tickId>` 确定性标签）；**本层不读取任何时钟**，
  只进 header，绝不进 `deserializeState`、绝不参与模拟计算（SV-5 用两个不同展示标签
  证明恢复状态逐字节一致）。

### 4.2 A/B 双槽交替原子写

- `save()` 读两槽，取 `writeSeq` 最大且**校验通过**的槽为「当前完好槽」，写**另一槽**。
  因此任一时刻至少一个完好槽（SL-1 六次连续写入逐步断言）。
- 槽自带单调 `writeSeq`，**不依赖持久化 active-slot 指针**：进程被杀 / 重进后
  新建 SaveService 仍可择优恢复（SL-9 三次重进）。
- 内存介质以「整串一次赋值」模拟 fsync + rename 的原子提交；以「半串落盘 + 抛错」
  模拟写中断（R-1）。真机侧实现同一个 `ISaveStorage` 即可把临时文件 + fsync +
  rename 放进介质层，`SaveService` 无需改动，也不碰路径 / 权限。

### 4.3 checksum 定位（诚实标注）

`hashString(canonicalize(payload))`，payload 覆盖除 checksum 字段外的全部槽内容
（header / current / ledger / prngSeed / writeSeq），并先做 JSON 往返归一，
保证落在「实际落盘的字节」上。**防误改 / 防写坏**（落盘一半、位翻转、人为改坏），
**不是反作弊、不是防篡改承诺、不做强加密**（ADR-003 §2.5 / §6 R-6）。
`parseSaveSlot` 同时校验结构完整性、header 与 current 版本一致性、两处 checksum；
任一不满足即判损坏，**绝不加载半损坏数据**。

### 4.4 加载失败 / 损坏 / 版本不匹配的处置

| 情形 | 行为 | 提示码 |
| --- | --- | --- |
| 某槽损坏（JSON 截断 / checksum 不符 / 读失败） | 跳过该槽，按 `writeSeq` 降序尝试下一完好槽 | `FELL_BACK_TO_PREVIOUS_SLOT` |
| 两槽均损坏 / 无存档 | `ok=false`、`state=null` | `NO_VALID_SLOT` |
| 写中断 / IO 写失败 | 本次不提交，上一完好槽逐字节不动 | `WRITE_INTERRUPTED` |
| `configHash` 漂移 | **硬拒绝**，`state=null` | `CONFIG_MISMATCH_REJECTED` |
| `engineVersion` 不匹配 | 拒绝载入并保留旧槽 | `VERSION_MISMATCH_NO_MIGRATOR` |
| `schemaVersion` 不匹配且**无显式迁移器** | 拒绝载入并保留旧槽 | `VERSION_MISMATCH_NO_MIGRATOR` |
| `schemaVersion` 不匹配且**注册了显式迁移器** | 按链升级（内存内），旧槽不写回 | `MIGRATED` |

所有失败路径 `state` 恒为 `null`，`load()` **从不写入介质**（旧槽逐字节保留，SL-8 / MG-1）。

### 4.5 显式迁移器策略

- 默认 `migrations: []` → **一个版本都不能隐式迁移**；任何版本不匹配一律拒绝。
- 迁移器按 `fromSchemaVersion → toSchemaVersion` 显式注册，`migrate()` 必须同步改写
  header 与 current 的版本字段；迁移器谎报目标版本 / 链断 / 成环均被拒绝（MG-5 防环上限）。
- 迁移结果**不写回介质**，仅用于本次载入并给出 `MIGRATED` 提示（MG-3 断言旧槽字节不变）。
- `configHash` / `engineVersion` 漂移**没有迁移路径**：这是 D-01 硬约束，
  杜绝「旧档 + 新公式静默续算」（ADR-003 §4.1 / R-2）。

### 4.6 D-01 联动 / 无静默续算

- 写入侧：`save()` 先 `assertConfigCompatible(state, config)`，不兼容即拒绝写入且不动任何槽（SV-10）。
- 载入侧：唯一入口 `deserializeState(effective.current, config)`，内部强制
  `assertConfigCompatible`（T-116 D-01 修复点 1），**不得绕过**。
- 存档层源码零 `runTick` / `solveTraffic` / `advanceDay` / `createSimulation` /
  `computeBaselineS` / `aggregate` 调用（MG-9 静态证据）：恢复就是原样反序列化，
  **不推进 tick、不补算漏掉的 tick**（SV-2 逐项断言 tickId / cycleId / cycleTickIndex 不变）。

### 4.7 H3 预留但不实现

`ISaveStorage.remote?: RemoteSaveCapabilities` 与 `VersionVector` 仅为**接口签名能力位**：
`readRemote` / `writeRemote` / `currentVersionVector`。内存介质 `remote` 恒 `undefined`，
`SAVE_FEATURE_FLAGS.h3CrossDeviceSync` 冻结为 `false`，全 `src/**` 零同步实现
（无 class 实现该接口、无 fetch / XHR / WebSocket，SV-9）。

### 4.8 权限与墙上时钟（S-10 验收 4）

`src/save/**` 可执行代码静态扫描零命中：`Date.now` / `new Date` / `Math.random` /
`performance.now` / `process.hrtime` / `setInterval` / `setTimeout` / `countdown` /
`requestAnimationFrame` / `autoPlay` / 后台保活 / 精确闹钟 / 离线任务 / 倒计时 / 倍速 /
自动播放 / `node:` / 引擎 / 平台 / 渲染 import / 文件系统与权限 API / 网络原语（SV-8）。
**不申请任何后台权限**：OD-2 A 下切后台只需「冻结 + 存一次」（由未来真机生命周期层触发）。
> 注：HAP 权限声明文件本身不在本仓库（纯逻辑层），其核对属 K-4 真机侧，EX-03 顺延。

## 5. 用例 → 验收映射

| 判据 / 验收 | 用例 |
| --- | --- |
| `SM-W4-01` 五类字段逐项一致、不推进 tick（S-10 验收 1） | SV-2、SV-3、MG-3、SL-2、SL-3 |
| `SM-W4-02` 写中断 / 损坏回退并提示、不加载半损坏数据、双槽任一时刻至少一个完好（S-10 验收 2） | SL-1~SL-10、SV-4、SV-11 |
| `SM-W4-03` header 五字段、版本不匹配显式迁移或拒绝、无静默续算（S-10 验收 3） | SV-1、SV-12、MG-1~MG-10 |
| S-10 验收 4 权限 / 墙上时钟 | SV-5、SV-8、MG-9 |
| S-10 验收 5 H3 零同步实现 / flag 默认关 | SV-9（含全 `src/**` 结构断言） |
| ADR-003 A8 全量单测可脱离真机（mock `ISaveStorage`） | 全部 32 条，零 `node:` 依赖 |
| 确定性 / 冷归档 ≥3 周期 / prngSeed | SV-6、SV-7 |

## 6. 跨域与遗留项

- **未触碰** F 线文件域（`tests/unit/idempotency-*.test.ts`、`tests/verification/s10-idempotency-*`、
  `src/simulation/commands.ts` / `session.ts` / `tick-pipeline.ts`）；D-03 幂等契约显式化由 F 线独占。
  本批存档层不实现幂等键重建语义，仅在回执中标注为 S-10 验收 6 的归属。
- **未触碰** `src/ui/**` 与 `tests/unit/ui-*` / `diagnosis-*` / `hud-*` / `render-*` / `edge-cells*`；
  未触碰 `production/reviews/**`、`tests/quality-closure.md`、`tests/traceability-matrix.md`、`design/**`、`docs/**`。
- **SM-W4-04 / SM-W4-05**（S-11 回退重试 / 周期判定 / V9 解锁）属 W4 第二批，本批未做。
- **组合根实际调用点**：本项目当前无应用装配层（纯逻辑 + 引擎无关渲染内核 +
  单文件离线预览）。`SaveService` 的生产调用点（P8 后落盘、`ILifecycle.onBackground`
  强制再存、关键操作后存）需等 **S-12 Cocos / HarmonyOS 场景接入**；本批只提供可被调用的
  服务与内存介质，并在用例中跑通数据链，**不声称已接入真实生命周期 / 已端到端上屏**。
- **介质活引用限制**：`edgeCells` 同款，存档层的 `current` 是 `serializeState` 的独立深拷贝，
  不持有 `CityState` 活引用；`SaveSlot` 各层冻结，调用方不可改写。
