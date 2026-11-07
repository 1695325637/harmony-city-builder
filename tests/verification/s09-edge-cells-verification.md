# S-09 第二批 C 线 · `edgeCells` 自验记录（T-137）

> 状态：自验通过（全量零 fail / `tsc --strict` EXIT=0）。本文件由 engineering-lead 产出，
> 记录**取值依据、哨兵语义、跨层契约与限制**；不替代 quality-lead 的独立复核。

## 1. 关门项

T-135 交付 `buildFlowOverlays(flowState, tokenMap, edgeToCell)` 时，第三参为必填显式入参，
但模拟层 `solveTraffic` 按 `qSlot` 递增写边槽时未落任何格坐标，故当时如实披露
「生产侧边槽→格映射生成器未落地」。T-136 判定该项为 S-09 第二批显式关门项。
本批按用户拍板方案关闭：模拟层在 `TrafficResult` 补 `edgeCells` 导出。

## 2. `edgeCells` 的格索引取值依据

- **数据源**：`solveTraffic` 的 ③ 上班流 `R → I` 双层循环，`qSlot` 递增写入逐边饱和度。
  写入 `qOverCap[qSlot]` 的同一分支同步写 `edgeCells[qSlot] = ws.blockRep[rb]`。
- **`ws.blockRep[rb]` 是什么**：① 连通块合并阶段 flood fill 求得的**最小格索引**，
  即该 R 连通块的代表格，是 `CityState.cells` 上的**真实格索引**（非块号、非边号、
  非循环下标）。`rb` 为该边起点 R 连通块的块号。
- **为何取「起点块代表格」而非路径格**：占位求解器是「块对」粒度（B ≤ maxBlocks），
  同一 `rb` 对不同 `ib` 会产出多条边，但共享同一个 R 块代表格。取起点块代表格可保证
  ① 值必然落在网格内且属于 R 分区；② 与 `qSlot` 写入分支一一对应、确定性可回放；
  ③ 不引入 BFS 路径回溯（不改变 `T_c` / `E` 计算路径，AC-T8 ④ 风险为零）。
  **限制如实披露**：这是「通勤需求发起点」的落点，**不是路径经过的格**，也不保证
  逐边唯一；同一 R 块的多条边会落在同一格上。若 S-12 需要沿路径铺流线，须另做
  逐边路径格导出（属后续范围，本批未做）。
- **未写入边槽**：`qOverCap` 长度为 `capacity = config.maxBlocks`（不是 `capacity²`），
  实际写入边数一般远小于 capacity。所有未写入槽在 `createTrafficWorkspace` 初始化与
  每次 `solveTraffic` 开头均 `fill(NO_EDGE_CELL)`，**不残留上一 tick 的格坐标**。

## 3. 哨兵语义

| 值 | 语义 |
| --- | --- |
| `>= 0` | 真实格索引（R 连通块代表格），可安全用于 `OverlaySpec.cellIndex` |
| `NO_EDGE_CELL = -1` | 该边槽未写入 / 无落点，**必须跳过** |

- 哨兵显式取 `-1`，与合法格 0 **严格区分**；任何路径都不得填 `0` 冒充格 0，
  也不得拿 `qSlot` / 循环下标当 `cellIndex`。
- 渲染层 `flowEdgesFromTick` 按**数值** `-1` 识别哨兵（并过滤负数 / 非整数 / NaN /
  Infinity），**不 import 模拟层的 `NO_EDGE_CELL` 符号**，保持渲染层单向依赖；
  两侧取值一致性由 `EC-4`（`NO_EDGE_CELL === -1`）与 `RF-12`（零符号引用）钉死。

## 4. 接线函数签名

```ts
// src/render/flow-legend.ts（不 import simulation；只接受数组 + 可选网格上界）
export function flowEdgesFromTick(
  flowState: readonly FlowStateCode[],
  edgeCells: ArrayLike<number>,
  cellCount?: number,
): readonly FlowEdgeCell[];
```

- 输入：`TickResult.flowState[]` 与 `TickResult.edgeCells`（`Int32Array`）。
- 输出：冻结的 `{ edgeIndex, cellIndex }[]`，`edgeIndex` 为边槽序号、`cellIndex` 取
  `edgeCells[edgeIndex]`；过滤哨兵 / 未知枚举 / 非法格 / 越界（传 `cellCount` 时）/
  两数组长度不齐的尾部。
- 下游：`buildFlowOverlays(flowState, tokenMap, flowEdgesFromTick(...))` →
  `buildDrawList(vm, manifest, lod, { overlays })`。

## 5. 跨层契约与 AC-T8 ④

- `edgeCells` 是**纯视觉派生量**：只在 `solveTraffic` 写落点与复位，绝不参与
  `weighted / demand / E / T_c / serviceWeighted*` 任一累加；`classifyFlowState`、
  三态阈值键、三态分类逻辑一字未改。
- 证据：`EC-6` 改阈值后 `S / T_c / 四因子 / edgeCells` 逐字节不变、仅 `flowState` 变档；
  `EC-7` 反向毒化 `ws.edgeCells` 预写垃圾值后 `S / T_c` 仍不变且 solve 复位为真实落点；
  `EC-8` 源码静态扫描 `edgeCells` 行无累加 / 无计分链变量；`FS-3 / FS-8` 继续绿。
- 渲染层零阈值键、零 `q/cap` 比较、不 import simulation（RF-2 / RF-12 / QA-R4 / FS-10 全绿）。
- `flow.*` 字面令牌 id 仍只在 `src/render/**`（RF-1）。

## 6. 用例清单

| 文件 | 用例 | 覆盖 |
| --- | --- | --- |
| `tests/unit/edge-cells.test.ts`（新建） | EC-1 ~ EC-12 | 字段契约 / 透传 / 格索引真实性（逐项等于 R 块代表格、非 i、非格 0）/ 哨兵 / workspace 复用复位 / AC-T8 ④ 两向证明 / 确定性 / 源码静态 / 映射生成器过滤 / 端到端全链 / 三态扫描 |
| `tests/unit/render-flow-wiring.test.ts`（扩展 RF-12~14） | RF-12 ~ RF-14 | 映射生成器静态契约（零 simulation import、零阈值键、零模拟层哨兵符号）/ 真实 `runTick` 端到端全链 `OverlayDraw.cellIndex` 逐项一致 / 三态 tokenId 与 `deriveLine` 线宽亮度 |

关键端到端断言：真实 `runTick` 的 `flowState + edgeCells` → `flowEdgesFromTick`
→ `buildFlowOverlays` → `buildDrawList({overlays})`，产出 `layer='flow'` 的 `OverlayDraw`；
`cellIndex` 排序后与 `edgeCells` 非哨兵项**逐项一致**（EC-11 / RF-13），
哨兵被跳过（映射长度 < capacity），三态分别得到正确 `flow.*` tokenId 与
`deriveLine` 线宽/亮度（EC-12 / RF-14）。

## 7. 组合根实际调用点披露（限制）

**本项目当前没有应用装配层 / 组合根**：`src/` 为纯逻辑层 + 引擎无关渲染内核，
`preview/` 是单文件离线预览（程序化占位绘制数据，不跑 `runTick`）。因此：

- 本批落地的是**可被组合根调用的生产侧纯函数**（`flowEdgesFromTick`）与
  模拟层数据导出（`TickResult.edgeCells`），并已在测试中跑通
  `真实 runTick → 映射生成器 → 叠层 → 绘制列表` 的**数据链**。
- **尚未接入真实场景上屏**：`buildFlowOverlays` 的调用方需要同时持有
  `tokenMap`（语义令牌表）、`flowState + edgeCells`（当帧 tick 结果）、
  `vm + manifest + lod`，并在通道 B（tick 结算后）触发。该装配代码属
  **S-12 Cocos 场景接入**范围，本批未做，也不声称「已完全端到端上屏」。
- 组合根接线时须传 `cellCount = side * side` 以启用越界过滤；不传时
  `buildDrawList` 仍有 `ci >= count` 兜底跳过，不会画出界。

## 8. 确定性 / 零分配

`edgeCells` 为 `createTrafficWorkspace` 预分配的 `Int32Array`，`solveTraffic` 只做
`fill` 与下标写入，不在热路径新建数组；`TickResult.edgeCells` 直接引用同一数组（不复制）。
`determinism.test.ts`（含 `allocations === 0` 断言）与 EC-9 继续绿。

**由此带来的消费侧限制（如实披露）**：为满足 A9 零热路径分配，`edgeCells` 是
workspace 内**原地复用的活引用**，下一 tick 会 `fill(-1)` 并覆写；这一点与
`flowState` 不同（`solveTraffic` 每 tick `r.flowState = fs` 换新数组，旧引用保持当帧快照）。
因此持有 `TickResult` 的调用方**必须在当帧消费 `edgeCells`，或自行 `slice()` 复制**，
不得跨 tick 缓存其引用后读取。本批不改此行为（改则为每 tick 分配，破坏 `allocations===0`
与既有确定性口径）；若 S-12 需要跨帧缓存，应在组合根消费时复制，属装配层职责。
