# HC-01 · W3 出口独立复核：AC-T8（流线三态唯一真源）+ 令牌契约 + D-13（T-133 / S-08 收口）

| 项 | 内容 |
| --- | --- |
| 任务 | W3 出口第二层 QA / fresh eyes 复核（T-114 的延续） |
| 复核人 | quality-lead（严守真） |
| 日期 | 2026-11-06 |
| 前置事实 | 主理人已复跑全量 **289/289 pass 0 fail**；本复核独立复跑同口径一致 |
| 复核对象 | `src/core/config.ts`（阈值键 + `assertTrafficThresholds`）、`src/simulation/traffic.ts`（`classifyFlowState` / `flowState[]`）、`src/simulation/tick-pipeline.ts`（透传）、`src/render/draw-list.ts` / `semantic-tokens.ts`（`flow.*` 自用）、`src/ui/**`（含 `hud/`）、`tests/unit/flow-state.test.ts`（FS-1~10）、`tests/unit/ui-motion.test.ts`（MOT-8）、`src/README.md` §2.2 |
| 授权边界 | 只读 `src/`、`tests/`、`design/`、`docs/`、`production/`；**不提交 git**；临时突变探针已撤销 |

---

## 0. 一句话结论

> **AC-T8 五条判据全部 PASS（契约层）：① 阈值键只落 `config.ts` + `traffic.ts`，渲染/UI 零 `q/cap` 阈值比较（独立 grep + 突变测试证明 FS-9/10 真能拦）；② 令牌契约成立——`flow.*` 令牌 id 只出现在渲染层 + README 文档，`src/ui/**`（含 hud）代码零引用、hud 只消费枚举 + label、不解析 `OpaqueSwatch.paint`；③ 确定性 FS-5 绿；④ 改阈值不改 `T_c/f_c/f_s/S` 由 FS-3 正向 + FS-8 反向双重锁定；⑤（补充）`flowState` 与 `qOverCap` 等长逐边对齐 FS-6 绿。D-13 已关闭（`outline` 通道 + `shape==='none'` 不计 shape 分支真实存在，MOT-8 绿）。→ 建议 GAP-13 关闭、AC-T8 行由 MISSING 改 COVERED。**

---

## 1. 独立复跑记录

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts` | `0` | **289/289 pass 0 fail**（与主理人一致） |
| `node --experimental-strip-types --test tests/unit/flow-state.test.ts tests/unit/ui-motion.test.ts` | `0` | **18/18**（FS-1~10 + MOT-1~8） |
| `node --experimental-strip-types --test --test-name-pattern="FS-9|FS-10" tests/unit/flow-state.test.ts`（注入突变探针前） | `0` | 2/2 |
| 同上（**向 `src/ui/hud/legend.ts` 临时注入「阈值键 + `qoc >` 比较」**） | `1` | **FS-9、FS-10 双双转红**（证明真能拦住） |
| 撤销探针后复跑 FS-9/FS-10 | `0` | 2/2；`legend.ts` 已恢复原状（git 视角未出现在改动集） |

---

## 2. AC-T8 五条判据 · 独立判定

### ① 三态字面量 / 阈值键只落模拟层 + 配置表；渲染/UI 无 `q/cap` 阈值比较 → **PASS**

**独立 grep 结论（不依赖 FS-9/10 的自述）**：

- **阈值键 `flowClearMaxQOverCap` / `flowSlowMaxQOverCap`**：全 `src/` 仅出现在
  - `src/core/config.ts`（定义 L73/78、占位默认 L131/132、`assertTrafficThresholds` L158~169）
  - `src/simulation/traffic.ts`（`classifyFlowState` L50~53 两处比较）
  - `src/README.md` L29（**文档**，非代码）
  → 代码层严格只有 `config.ts` + `traffic.ts`，✓。
- **`qOverCap` / `qoc` 阈值比较（`> / < / ≤ / ≥`）**：`src/render/**` 与 `src/ui/**` **0 命中**（`grep -rnE "qOverCap\s*[<>]=?|qoc\s*[<>]=?"` → NONE）。
- **突变测试（本次亲自注入再撤销）**：在 `src/ui/hud/legend.ts` 追加 `const _p = (qoc)=> qoc > flowClearMaxQOverCap ? 1 : 0;` → `FS-9`（阈值键越界）与 `FS-10`（阈值键 + q/cap 比较越界）**同时转红**，EXIT=1；撤销后复绿。**证明这两条守护不是永真断言。**

> **口径澄清（重要，避免误判）**：三态「枚举字面量」`'clear'/'slow'/'congested'` 会出现在下列**合法**位置——`src/ui/hud/types.ts` 的 `FlowState` 类型与图例 mock 数据（UI 消费枚举 + label，§3.5.3 ② 允许）、`src/render/semantic-tokens.ts` / `draw-list.ts` 的 `flow.*` 令牌 id（渲染层自用，§3.5.3 允许）。若按「三态字面量只能出现在 simulation+config」字面执行，会与 §3.5.3 自相矛盾。**正确的判据**是：**阈值键 + 阈值比较**严格锁在模拟层/配置表；`flow.*` **令牌 id** 严格锁在渲染层。二者均已满足。

### ② 令牌契约：UI 不引 `flow.*` 字面、不 import 渲染令牌（hud）、不解析 `encoding` 内部 → **PASS**

**独立 grep 结论**：
- `'flow.clear' / 'flow.slow' / 'flow.congested'` 全仓出现位置（代码层）仅：
  - `src/render/draw-list.ts` L119~121（`DEFAULT_FLOW_LINE` 令牌 id → 线宽/亮度）
  - `src/render/semantic-tokens.ts`（`flow.*` 令牌构建）
  - `src/README.md` §2.2（契约文档）
  → **`src/ui/**` 代码 0 命中**；UI 内出现的 `flow.clear` 等字样**全部在注释里**（「不得出现『flow.clear』」的自我约束说明），非代码引用。
- `src/ui/hud/**`（S-08 新层）**零 import `semantic-tokens`**、零 `tokenById`；图例 `legend.ts` 只 `getFlowLegend().map(it => it.swatch.label)`（只取 `label`），`OpaqueSwatch.paint` 为 `unknown` 且无任何 `.paint` 内部解析。
- 既有 `src/ui/`（S-07 的 `optimistic-view.ts` / `motion-policy.ts` / `interaction-controller.ts`）import 了 `SemanticTokenMap` / `tokenById`，但**只用于 `status.*` / `base.*`（即时反馈）**，无任何 `flow.*` 代码引用；`interaction-controller.ts` 的 B 事件 `flow-state` 只搬 `attributionRef` 字符串并标 `refresh:true`，不判三态、不查 flow 令牌。

> **精确表述**：GDD §3.5.3 ② 禁止的是「UI 引用 `flow.*` 字面 id / 解析图例 `encoding` 内部」，**不**禁止 UI 引用 `status.*`（即时反馈的既有合法消费）。派单里「不得 import 渲染层令牌」是更宽的说法；若按字面，S-07 的 `optimistic-view` / `motion-policy` 会被误判。按 GDD 契约口径，结论为 PASS。

### ③ 确定性（同输入同输出） → **PASS**

`FS-5`（`flow-state.test.ts` L126~135）：同 `q/cap` + 同阈值，两个独立 workspace 跑 `solveTraffic`，`flowState` 与 `qOverCap` 的 `canonicalize` **逐字节一致**。本人复跑 18/18 中 FS-5 绿。

### ④ 改阈值不改 `T_c / f_c / f_s / S` → **PASS（正反双向锁定）**

- **正向** `FS-3`（L81~108）：同一布局、`θ_clear` 0.5→0.7，跑 tick 后 `S / T_c / f_c / f_s / f_e / f_f` **逐字段相等**，而 `flowState[0]` 由 `slow` → `clear`（证明阈值确实只改变分档、不动计分链）。
- **反向** `FS-8`（L159~173）：`θ_slow` 收到 0.02 极端值，`T_c` 仍不变、`flowState` 长度不变、congested 计数不减。
- 本人复跑确认两用例绿；另读 `traffic.ts` L50~53：`classifyFlowState` 只被 `flowState` 构建循环调用，`T_c` 计算（L211~316）不读阈值键。

### ⑤（主理人补充）`flowState` 与 `qOverCap` 等长、逐边对齐 → **PASS**

`FS-6`（L137~147）：`r.flowState.length === r.qOverCap.length` 且 `> 0`，逐元素 ∈ 三态枚举。实现侧 `traffic.ts` L325~333：`fs` 数组按 `ws.qOverCap` 逐下标构建，`r.flowState = fs`；`tick-pipeline.ts` L412 `out.flowState = traffic.flowState`（透传，不重排、不截断）。

---

## 3. D-13 核实 → **已关闭**

`src/ui/motion-policy.ts`：
- `FeedbackChannelKind` 新增 `'outline'`（L66）；
- `immediate()` 与 `tickFeedback()` 均实现分支：`encoding.shape === 'none' ? baseChannels.filter(c => c !== 'shape').concat('outline') : baseChannels`（L194~196、L211~213）；
- `OUTLINE_WIDTH_PX = 2` 仍为单一出口（L119），`outlineWidthPx` 保留在 `ImmediateFeedbackSpec` 上。
- `MOT-8`（`ui-motion.test.ts` L133~153）两分支断言齐全：`status.selected`（shape=none）→ channels 含 `outline`、不含 `shape`；`status.positive`（有形状）→ 含 `shape`、不含 `outline`；`outlineWidthPx > 0`。
- 本人复跑 `ui-motion` 8/8 绿。**D-13 关闭成立。**

---

## 4. 观察项（不判 FAIL，但需留痕）

1. **数据通路联调未完成（S-08 剩余项，非 AC-T8 违约）**：`src/ui/hud/legend.ts` 仍接 `MOCK_FLOW_LEGEND`（header 标注 `pending:s04`，且 `hud-static-scan` 反向断言「mock 必须保留」）；渲染侧 `draw-list.ts` 有 `DEFAULT_FLOW_LINE['flow.*']` 与 `OverlaySpec.token.id`，但**尚无显式的 `TickResult.flowState[] → 渲染叠层` 的接线函数**（`src/render` 内 `grep flowState` 无消费点）。契约与类型已就位，真实枚举→图例/流线的数据灌入待 S-08 完成。**这是「待接线」而非「判定缺失」**，建议在 S-08 收口验收里显式列一条「真实 flowState 接入 draw-list 与 legend」的关门项，避免 mock 带病进 S-12。
2. **`pending:s04` 注释已部分过时**：T-133 已落地 `TickResult.flowState`，但 `legend.ts`/`types.ts` 头仍写「尚未由 T-133 产出」——建议下轮顺带把注释改为「mock 待 S-08 真实图例下发替换」，防后人误读（文档层，非缺陷）。

---

## 5. GAP-13 处理建议 → **可关闭**

- AC-T8 五条判据全部 PASS，且有 `FS-1~FS-10` 十条可复跑用例 + 本次独立 grep/突变测试双重证据。
- 关闭依据与日期将写入 `tests/traceability-matrix.md`（AC-T8 行 `MISSING → COVERED`、GAP-13 标 `CLOSED`），**追溯口径由 116/117=99.1% 回到 117/117=100%（GAP=0）**——这是「补上用例如实回填」，不是虚增。
- 观察项 1（数据通路联调）**不阻塞 GAP-13 关闭**，因为 AC-T8 判据本身是契约层，联调属 S-08 后续接线，已在 §4 显式登记。

---

## 6. 复核留痕

- 本复核**只读** + **一次临时突变探针已撤销**（`legend.ts` 未出现在 git 改动集）；未删任何文件、未提交 git。
- 数字纪律：289/289、18/18、突变前后 FS-9/10 的 2/2 → 0/2 → 2/2 均为本机真实运行输出；未编造。
- 交付：本文 + `tests/traceability-matrix.md` 的 AC-T8 行与 GAP-13 行更新（文档同步，团队授权）。

---

*文档结束 · W3 AC-T8 独立复核 · 五条判据全 PASS · D-13 关闭 · GAP-13 建议关闭 · 289/289 独立复跑一致 · 剩余「真实 flowState 接线」为 S-08 后续联调项（已留痕）。*
