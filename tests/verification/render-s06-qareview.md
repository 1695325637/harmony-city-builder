# HC-01 · S-06 渲染层【第二层 QA / 独立复核】报告（T-119 / W3）

| 项 | 内容 |
| --- | --- |
| 工作代号 | HC-01（非产品名） |
| 任务 | T-119 · S-06 渲染层独立复核（T-118 交付的第二层 QA / fresh eyes） |
| 日期 | 2026-11-06 |
| 复核对象 | `src/render/`（9 文件 1 372 行）、`src/index.ts`（渲染导出 8 条）、`tests/unit/render-*.test.ts`（45 条）、`preview/`（三件套 + dist 10 个 `.mjs`） |
| 自证材料（只读） | `tests/verification/render-s06-verification.md`（T-118 v1，**未改动**）、`src/render/cocos/cocos-backend.ts` 文件头披露 |
| 授权边界 | 只写 `tests/`：新增 `tests/verification/render-s06-qareview.test.ts`（10 条）与本报告。**未修改** `src/`、`preview/`、实现方报告与既有 QA 文档 |
| 报告形式选择 | **新建独立报告**而非在其 v1 报告内追加节。理由：实现方自证原文按「谁写谁署名」保留不改，QA 复核独立成文便于追溯责任链；判定冲突时以本报告为准并在 §6 声明 |
| 质量门定位 | **advisory（建议性）**：判定由 QA 给出，最终放行由用户决定 |

---

## 0. 一句话结论

> **T-118 自证的 117/117 经独立复跑一致；changeStamp 契约真值比对成立（diff 不漏检、无幽灵、P1 写格必 bump、全库无第二写路径）；渲染层零写状态 / 色值仅经令牌 / 无引擎依赖 / 无时钟随机四项静态纪律经绕过面重扫后仍成立。S-06 在「可离线验证范围」内四条验收 = ①PASS ②PASS ③PARTIAL（探测与降级 PASS，「入校准记录」随 S-04/S-12 未做）④PASS。W3 出口门建议 CONCERNS（S-06 层无 S1/S2 缺陷；W3 整体因 S-07/S-08/S-09 未交付、SM-W3-01~05 不可执行而不能判 PASS）。**

---

## 1. 独立复核运行记录（2026-11-06，本机真实执行）

环境：Node v22.22.2 / `--experimental-strip-types` / win32 / x64 / 零依赖（无 `package.json` / `tsconfig.json` / `node_modules`）。

| # | 命令 | 退出码 | 计数 | 与 T-118 自证比对 |
| --- | --- | --- | --- | --- |
| 1 | `node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts`（**新增 QA 套件前**） | `0` | **117/117**（既有 72 + render 45）`duration_ms 2273.7613` | 一致 |
| 2 | `node --experimental-strip-types --test tests/unit/render-*.test.ts` | `0` | 45/45（ATLAS 9 / COCOS 7 / DRAW 7 / ISO 8 / TOKEN 6 / VM 8） | 一致 |
| 3 | `npx --yes -p typescript@5.9.3 tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions src/index.ts`（**src-only**，N-01 已澄清口径） | `0` | 零错误零输出 | 一致 |
| 4 | `curl http://127.0.0.1:8123/`（主理人已启动的预览服务） | — | **HTTP 200**；标题 `HC-01 · S-06 等距渲染预览（占位）`；横幅文案命中「非最终美术 / Cocos 适配未验证 / 程序化占位」 | 一致 |
| 5 | `node --experimental-strip-types --test tests/verification/render-s06-qareview.test.ts`（**本次新增 QA 套件**） | `0` | **10/10**（QA-R1~R8，R6 拆 3 条） | 新增 |
| 6 | 全量含 QA 套件：`tests/unit/*.test.ts tests/verification/*.test.ts` | `0` | **127/127**（117 + 10）`duration_ms 2452.1036` | 新增 |

既有 72 条零回归核查：`tests/unit/` 既有 8 文件 + 既有 3 个 verification 套件的计数逐项未变（51 + 21 = 72），mtime 均早于 T-118 交付（最新 09:16 为 QA 自己 N-01.1 微修订）；T-118 未触碰任何既有测试文件。**结论：零回归，且不属于「改旧用例迁就新实现」。**

---

## 2. 四处披露风险的独立结论

### (a) VM `changeStamp` 契约 → **成立（非 S1），且已用真值比对钉死**

实现方声明（`src/render/view-model.ts` L5~19 / L108~115）：零拷贝下相邻帧共享同一 TypedArray，故 diff 主信号取 `inputVersion` 快照（`changeStamp`，L102），并钉「同 state 就地改写且不 bump 则不可检出」为显式契约（其 VM-4b 用例）。**关键在于验证契约前提「内核每次写格必 bump」是否真的无例外。**

| 核查维度 | 方法 | 结果 |
| --- | --- | --- |
| 写格路径穷举 | 全 `src/` 去注释去字符串后扫描 `cells.(zone\|density\|unlocked\|region)[...] =` | **共 6 条**：`schema.ts` L103~106 初始化 4 条（unlocked/region/zone/density）+ `tick-pipeline.ts` L279~280 的 zone/density **2 条**。全库无第三处写格（QA-R3 断言命中序列，新增写路径即红） |
| bump 是否无条件 | 同段审计 `tick-pipeline.ts` P1 | L279~281 为**同一无分支语句组**：`zone[idx]=z; density[idx]=density; inputVersion[idx]++`；全文件 `inputVersion[..]++` 恰 1 处（QA-R3 断言「bump 紧随写入、距离 <200 字符」，防止未来被 `if` 隔开） |
| 是否存在其它不 bump 写路径 | P7 周期解锁是否写 `cells.unlocked/region`？ | **不写**：`tick-pipeline.ts` L383 仅 `s.unlockedRegions++`（计数），格解锁尚未实现（留 S-11）。QA-R8 用 `K=2 / S_unlock=0` 跑 6 tick、3 次达标，断言 `cells.unlocked/region` 逐字节不变（若将来实现格解锁而忘 bump，该用例立即红） |
| **↑ S-11 落地后（T-145 增补）** | 该行是 **S-06 时期的占位契约**，原文保留备查 | **前提已被 S-11 取代**：T-144 起 `TARGET_MET` 帧真正写 `cells.unlocked=1` / `cells.region=0` 并 bump `inputVersion`（边长阶梯 +2）。判据按 Story 语义升级（**不放宽**）：QA-R2 收紧为「非解锁帧」；QA-R3 扩到 4 字段 / 8 条写入、且**每一处**写值后 200 字符内必须有 bump；QA-R8 改为按帧分支（解锁帧：写格集合 === bump 集合、diff 必须检出；非解锁帧：cells 全字段逐字节不变）。详见 `tests/verification/s11-qareview.md` §3 |
| 结算链其它阶段是否偷写格 | 纯 ADVANCE tick 后 `inputVersion` 全数组比对 | **逐字节不变**（QA-R2，8 连 tick）——动态证明 P2~P8 无写格 |
| diff 是否漏检 / 幽灵 | 逐 tick 以「序列化快照」为真值比对 `diffViewModel` | **真实变化 ⊆ diff ⊆（版本戳变 ∪ 值变）**，6 tick 混合命令（zone / density / road / 同值重写 / 纯 advance）全部成立（QA-R1）；同值重写允许出现（版本变）但不产生幽灵 |

**结论：契约成立，不构成 S1。** 残余风险如实记录：① 该契约是**跨模块隐式耦合**（渲染依赖内核 P1 写法），已由 QA-R3（静态）与 QA-R1/R2/R8（动态）三层回归覆盖，未来任何新增写格路径会双向报警；② `Uint32` 版本戳单格理论溢出（2³² 次同格写入）不可达，不登记；③ 兜底比对只比 `zone/density/unlocked` 未比 `region`（`view-model.ts` L136）——`region` 当前不参与渲染且结算不写，**不构成漏检**，但若将来渲染用 `region` 需同步补齐（并入 D-08 备注）。

### (b) 未验证栏是否被恰当披露 → **恰当，未混入 PASS**

逐项核对实现方报告 §4「诚实两栏」与代码/预览页自述：

| 未验证项 | 报告位置 | 独立核对 |
| --- | --- | --- |
| Cocos 组件行为（属性名 / 生命周期 / `setSiblingIndex` 语义 / SpriteFrame / 9-slice 效果） | §4 ❌1、§5.5、`cocos-backend.ts` L4~6 文件头加粗警告 | 属实：适配层为**注入式**（L9~11），单测走 mock；COCOS-1 用例名即自述「未在引擎内验证」 |
| 真机帧率 / DrawCall / 内存 | §4 ❌2、§3 明示「估算非实测」 | 属实：`draw-list.ts` L194 字段名 `estimatedDrawCalls`；预览页 L220「估算值，非实测；不作门禁」 |
| ASTC/ETC2/RGB565 真实支持 | §4 ❌3、`texture-format.ts` L6~8 | 属实：仅 `caps` 注入探测，不压缩、不落校准表 |
| 真实贴图与打包 | §4 ❌4 | 属实：本轮无 PNG；清单尺寸为程序化占位 |
| 浏览器视觉正确性 | §4 ❌5、§2 ③「人工可见（页面 200）」 | 属实：仅 HTTP 200 + 数据路径；预览页 L41 横幅「非最终美术」 |
| 交互 / 无障碍 | §4 ❌6 | 属实：拾取仅数学层 |

补充核查：§2 ③ 行内「待办挂接 = **未验证**（真机能力未知）」明确把「入校准记录」列为未验证，而非用「已实现探测」冒充验收完成——**这一点是 ③ 判 PARTIAL 而非 PASS 的直接依据，属于诚实披露加分而非隐瞒**。QA-R5 另加机械约束：预览页不得出现「已通过 / 已实测 / 验收通过」字样（当前 0 命中）。

### (c) 静态扫描覆盖面 → **属性成立；其自证用例的禁用清单存在绕过面（已由 QA 独立套件补覆盖）**

独立重扫（`src/render/**/*.ts`，去注释后再判，避免注释里的反例写法误报）：

| 纪律 | 独立重扫结果 | 绕过面（其 VM-8/TOKEN-5 未覆盖） |
| --- | --- | --- |
| 写 state（标量 / budget / frames / cells 下标） | **0 命中** | 其 VM-8 已覆盖 `cells.X[...] =`、`state.tickId =`、`state.budget.X =`、`state.frames.x.y =` |
| 写 cells 的**方法形态** `.set(` / `.fill(` | **0 命中** | ⚠️ 其禁用清单未含 → QA-R4 已覆盖 |
| `Object.assign(state` / 整体 `state =` 替换 | **0 命中** | ⚠️ 其禁用清单未含 → QA-R4 已覆盖 |
| 静态 `import ... from 'cc'` | **0 命中**（唯一 `from 'cc'` 命中是 `cocos-backend.ts` L10 文档注释中的**否定式**，去注释后消失） | 其 VM-8 的正则带 `^[ \t]*import` 行首锚，注释内不误报，OK |
| 动态 `import('cc')` / `require('cc')` | **0 命中** | ⚠️ 其禁用清单未含动态形态 → QA-R4 已覆盖 |
| hex 色值（`#rgb/#rrggbb/#rrggbbaa`）、`0xRRGGBB`、`rgb()/hsl()`、`'#'+` 模板拼色 | **仅 `semantic-tokens.ts`**（≥20 条令牌） | ⚠️ 其 TOKEN-5 只扫 `#[0-9a-fA-F]{6}\b`：**漏 `#rgb` / `#rrggbbaa` / `0xRRGGBB` / 颜色函数 / 拼色** → QA-R4 已覆盖 |
| 墙上时钟 / `performance.now` / `Math.random` | **0 命中** | 其 VM-8 已覆盖 |
| 越层依赖（render → `../simulation/`） | **0 命中**（render 只依赖 `core/types`、`core/config`） | ⚠️ 其禁用清单未含 → QA-R4 已覆盖 |

**结论：** 四条静态纪律在代码事实上全部成立（不是「用例写得松所以绿」）；但实现方两条扫描用例的**正则覆盖面偏窄**，属测试质量问题，登记 **D-06（S4）**，并已由 `render-s06-qareview.test.ts` QA-R4 独立补齐（本套件与实现方用例互为交叉验证，任一方被放宽另一方仍会红）。

### (d) `src/index.ts` +8 导出（派单授权外）→ **可接受（轻微越界，无副作用），登记 D-07 并要求流程收口**

事实：`src/index.ts` 15 → 25 行，新增 1 行注释 + 8 条 `export *`（L18~25，`iso / view-model / semantic-tokens / atlas / texture-format / draw-list / backend / cocos/cocos-backend`）。派单原文授权为 `src/render/`、`tests/`、`preview/`。

| 核查项 | 结果 |
| --- | --- |
| 理由是否成立 | **成立**：tsc src-only 口径（N-01 澄清）以 `src/index.ts` 为唯一入口，不导出则新模块不进类型检查；替代方案（把 `src/render/*.ts` 直接喂给 tsc）在 Windows/npx 下 glob 稳定性更差。选择合理 |
| 是否引入循环依赖 | **无**：render 模块只 import `core/types`、`core/config`（QA-R4 越层扫描 0 命中），无模块 import `index.ts`；导入方向单向 |
| 是否引入重名冲突 | **无**：tsc `--strict` exit 0 且 117 用例全绿；`export *` 冲突会直接报 TS2308 |
| 导出面副作用 | **无运行时副作用**：被导出模块均为纯函数/常量/类型，无 import 期重计算与 IO；导入 `index.ts` 的行为与之前一致（既有 72 条用例零回归即证据） |
| 是否越权修改 | **是（轻微）**：属授权外文件；但改动可逆、可追溯（仅追加导出）、有技术必要性，且实现方在报告 §5.2、§5.6 主动披露 |
| 附带缺口 | `src/README.md` 未记录 render 层（实现方因授权限制未改，§5.6 披露）→ 文档漂移，并入 **D-07** |

**裁定：可接受（不判缺陷、不阻塞门），但须流程收口**——① 请主理人在后续派单模板中把「公共导出面 `src/index.ts` / `src/README.md`」纳入显式授权范围，避免以「默示授权」方式扩大边界；② 补一次 `src/README.md` 渲染层索引（一行）+ `index.ts` 导出说明，作为 W3 收尾的文档项。

---

## 3. S-06 四条验收条件逐条独立判定

| 验收条件 | 判定 | 独立证据（本次复核，非转抄） |
| --- | --- | --- |
| **① L0/L1/L2 不跨图集、无批次抖动** | **PASS** | QA-R6a（**我自己的断言**）：`buildDrawList` 三档批次 `atlasId` 集合完全相同（1 个不同值），且逐 sprite（`gx,gy,kind` 键）三档 `atlasId` 全等；QA-R7：批次数 = `estimatedDrawCalls`、批次覆盖全部 sprite。实现方 ATLAS-7 / DRAW-3 同向（交叉验证）。代码：`atlas.ts` L150~151（三档同 `assetKey` 同图集）、`draw-list.ts` L179~194（按 `atlasId` 归批，无中途拆批） |
| **② 零写状态 + 色值只经语义令牌** | **PASS** | QA-R4 绕过面重扫（上表）：写路径 / 颜色函数 / 0x / 拼色全 0；hex 仅 `semantic-tokens.ts`。QA-R2/R8 动态佐证：8 tick 与 6 tick 结算后 `inputVersion` 与 `cells` 全字段逐字节不变。实现方 VM-1/VM-2/VM-3/VM-8/TOKEN-3/TOKEN-5 同向。代码：`view-model.ts` L72~105（VM 与嵌套视图 freeze、`buildViewModel` 只读投影） |
| **③ 格式探测可降级、入校准记录** | **PARTIAL** | **③a 探测与降级链 PASS**：QA-R6c 独立覆盖 ASTC→ETC2→RGB565→NONE 四档、`degraded` 标记、**透明底不得掉到 RGB565**（`opaqueBackground=false` → NONE）、UI 固定 RGBA8888；代码 `texture-format.ts` L29~43。**③b「入校准记录」未做 / 未验证**：实现方 §2 ③ 末行自述「本轮只做探测与决策，不落校准表」，`texture-format.ts` L8 同；真机能力未知（随 S-04 / S-12）。**不判 PASS 的理由：验收字面含「入校准记录」，该动作未发生，不得以「探测已完成」替代** |
| **④ 建筑包按激活分区集加载、未解锁不预载** | **PASS** | QA-R6b（独立）：激活集 = `['R']` 时三档 LOD 下 `建筑-商业 / 建筑-产业 / 建筑-公共服务` 均不在 resident / onDemand 且被显式 excluded，`建筑-居住` 在加载集。代码：`atlas.ts` L366~405（`resolveLoadSet`）、L279（建筑条目必须带 `zoneGate`）、L261~280（9 类校验含三档跨图集拒绝）。实现方 ATLAS-8 / ATLAS-1/3/4 同向 |

> 判定口径：PARTIAL = 验收条件中**可离线验证的部分通过、依赖真机/下游的部分未验证**，既不放行为 PASS，也不判 FAIL（无实现证据表明不合格）。③ 的关门条件是 S-04/S-12 校准记录落盘，已与 EX-01 真机顺延窗口对齐。

---

## 4. 缺陷 / 观察项清单（自 D-06 起续）

| 编号 | 等级 | 标题 | 事实与影响 | 处置建议 |
| --- | --- | --- | --- | --- |
| **D-06** | S4 | 静态扫描用例的禁用清单存在绕过面 | VM-8 未覆盖 `.set(` / `.fill(` / `Object.assign` / 动态 `import('cc')` / `state =` 替换；TOKEN-5 未覆盖 `#rgb` / `#rrggbbaa` / `0xRRGGBB` / `rgb()`·`hsl()` / `'#'+` 拼色。**当前属性成立**（QA-R4 独立重扫 0 命中），仅测试强度不足，属「将来可能被绕过」的风险 | **已由 QA 侧补齐**：`render-s06-qareview.test.ts` QA-R3/R4 常驻回归；建议 engineering-lead 下轮把上述模式并入 VM-8/TOKEN-5（并入后本项关闭） |
| **D-07** | S4 | `src/index.ts` 授权外修改 + `src/README.md` 文档漂移 | 见 §2(d)：追加 8 条导出（可接受）；README 未记录 render 层 9 文件，目录索引与代码不一致 | ① 派单模板把公共导出面纳入授权；② 补 README 渲染层索引 + 导出说明（W3 收尾前） |
| **D-08** | S4 | `diffViewModel` 仅对「格」产生信号，非格字段变化无差异信号；契约未文档化到消费方 | `view-model.ts` L116~141 只返回格索引：`S / tickId / budget / issueCount / unlockedRegions / factors` 变化但格未变时 diff 为 `[]`。当前消费方（`draw-list` 全量重建、预览页整帧重绘）**不受影响**，但若未来做增量 UI 更新会漏刷新。另：兜底比对未含 `region`（当前不参与渲染，安全） | 文档化「diff = 格级重绘信号；标量变化须比较 VM 字段」契约；若引入增量刷新，同步补 `region` 与标量信号。不改代码（无当前缺陷） |
| **D-09** | S4 | 预览页内联 CSS 复制了令牌色值 | `preview/index.html` L17~22 的 CSS 变量（`--canvas/#f4f6f8` 等）是 `semantic-tokens.ts` 色值的第二份拷贝（小写化），存在漂移风险；另有横幅色 `#fff3cd/#6b4e00` 不属令牌集 | 预览件非产品 UI、已标「非最终美术」，**不影响验收**；建议 `preview/build.mjs` 从 tokens 生成 CSS 变量，消除第二真源（低优先） |

> 缺陷统计：**S1 = 0、S2 = 0、S3 = 0、S4 = 4（D-06~D-09，均为观察/测试强度类，无功能性缺陷）**。D-06 已有 QA 回归兜底；D-07~D-09 建议随 W3 收尾处理，不阻塞 S-06 判定。

---

## 5. 未验证边界确认（QA 侧认可，不得在后续汇报中折算为 PASS）

1. **Cocos Creator 内一切行为**：属性名 / 生命周期 / `setSiblingIndex` 绘制序语义 / SpriteFrame 赋值 / 9-slice 效果 —— mock 单测只证明**映射逻辑**自洽，不证明引擎内跑通；真机与编辑器验证随 **W4**（与 EX-01 窗口同批）。
2. **真机帧率 / DrawCall / 内存**：完全未测；本报告与实现方 §3 的「5 批次」一律为**估算**，不得作为性能结论或验收依据。
3. **纹理格式真实支持**：ASTC / ETC2 / RGB565 在鸿蒙导出链的实际可用性未知 → ③b 的关门条件（校准记录）。
4. **真实贴图与图集打包**：无 PNG、无压缩、无留白实测（清单留白为建模值）。
5. **浏览器视觉正确性**：仅 HTTP 200 + 数据路径无异常（QA 侧无浏览器自动化）。Canvas 实际绘制效果属 **art-director** 评审范围，**不在本报告判定内**。
6. **交互与无障碍**：拾取仅数学层；触摸 / 折叠屏 / 减少动态效果未接（S-07 / S-08 范围）。
7. **跨引擎浮点一致性**：S-06 渲染不涉及结算浮点，本轮不新增该局限；沿用 T-114 报告的口径（本机单引擎）。

---

## 6. W3 质量门建议（advisory）

| 层级 | 判定 | 依据 |
| --- | --- | --- |
| **S-06 渲染层** | **PASS（含 1×PARTIAL 与未验证边界）** | ①PASS ②PASS ③PARTIAL（仅「入校准记录」未做）④PASS；S1/S2/S3 缺陷 = 0；117/117 与 127/127 独立复跑；tsc src-only 0；预览 200 |
| **`SM-W3-06`（渲染层单项）** | **PASS（离线可验范围内）** | 其失败即停条件为「存在写状态 / 硬编码色值 / 跨图集抖动」——三项 QA 独立重扫与 QA-R6a 均证否；「探测结果写入校准记录」半项未满足但不触发停波次（且验收 ③ 已判 PARTIAL，不冒充 PASS） |
| **W3 出口门（整体）** | **CONCERNS（不可判 PASS）** | `SM-W3-01~05` 依赖 S-07（交互反馈 / UI 写路径 / InputGate 视觉响应）、S-08（控件树 / 面板栈）、S-09（归因面板只读查询），**均未交付、不可执行**；按 `smoke-checklist.md` §0.1，未执行项不得计入通过 |

**建议动作（按优先级）**：
1. 允许 **S-07 开工**（S-06 层无阻塞缺陷）；W3 出口门待 S-07~S-09 交付后按 `SM-W3-01~06` 重判；
2. ③b「校准记录」与 `SM-W1-04`、`SM-W2-05` 真机持久化**同批**在 W4 前补齐（EX-01 窗口），届时把 `probeTextureFormat` 的 `chosen / degraded / reason` 落表；
3. D-07 的两项文档动作（README 索引 + 派单授权面）随 W3 收尾完成；D-06 的下轮用例加强由 engineering-lead 认领（QA 侧回归已兜底）；
4. 所有 DrawCall / 帧率表述在对外汇报中维持「估算 / 未实测」，真机数据产出前不得引用为承诺值。

---

## 7. 复核留痕

- **新增**：`tests/verification/render-s06-qareview.test.ts`（10 条，QA-R1~R8 其中 R6 拆 a/b/c）与本文。
- **未改动**：`src/` 全部（含 `src/render/`、`src/index.ts`）、`preview/` 全部、`tests/unit/render-*.test.ts`、实现方 `render-s06-verification.md`、既有 QA 文档与 `w1-w2-verification.md`（v1.2.1）。未提交 git、未删除任何文件。
- **数值纪律**：本报告所有计数（117/127/10/45/8 文件等）与耗时均为 2026-11-06 本机真实运行输出；DrawCall 一律「估算」措辞；未编造任何数值。
- **运行可复现**：§1 表内 6 条命令可直接在工作区根目录重跑；QA 套件只读 `src/` 与 `preview/index.html`，不启动服务、不写权威状态。

---

*报告结束 · T-119 · S-06 渲染层第二层 QA 独立复核 · 117/117 与 127/127 独立复跑 · 四条验收 ①PASS ②PASS ③PARTIAL ④PASS · S1/S2/S3 = 0 / S4 = 4（D-06~D-09）· W3 出口门 **CONCERNS**（S-06 层可放行，W3 整体待 S-07~S-09）· advisory 判定，最终放行由用户决定*

---

# §T-121 · T-121 修复批的独立复核（T-124 · S-06 闭环）

> **性质**：追加节。§T-121 之前的 T-119 内容（含四条验收判定、D-06~D-09 原始登记、W3 门建议）**全文保留不删改**；本节给出修复后的终态判定，冲突处以本节为准。
> **依据**：T-121 修复批（engineering-lead）自证 + 本人独立重验；`render-s06-verification.md` §7（修复清单，只读）。
> **新增套件**：`tests/verification/render-s06-t121-qareview.test.ts`（**9 条** QA-T1~T9，与实现方 17 条新用例不重叠维度）。

## T-121.1 独立复核运行记录（2026-11-06，本机真实执行）

| # | 命令 | 退出码 | 结果 | 备注 |
| --- | --- | --- | --- | --- |
| 1 | `node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts`（**加入本轮 QA 套件前**） | `0` | **184/184** | 比 T-121 自证「163」多 21：并行 UI 工作流用例已增至 40 条 + 本人 T-119 套件 10 条（详见 §T-121.1 备注） |
| 2 | `node --experimental-strip-types --test tests/unit/render-*.test.ts` | `0` | **62/62** | 渲染相关 = 62（实现方）+ 10（T-119 QA）+ 9（本节 QA）= **81**，自证「72」为 62+10 口径 |
| 3 | `npx --yes -p typescript@5.9.3 tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler --allowImportingTsExtensions src/index.ts` | `0` | 零错误零输出 | src-only（N-01 口径）；`asset-naming.ts` 经 `src/index.ts` 覆盖 |
| 4 | 预览服务自起 + `curl`：`/`、`/?lod=L0`、`/?lod=L2`、`/dist/view-model.mjs`、`/dist/asset-naming.mjs` | — | 全部 **HTTP 200**；横幅「占位色块预览（非最终美术）· Cocos 适配未验证 · 绘制数据为程序化占位」；「概览」按钮与「高对比模式（图案 30% + 1px 描边）」勾选在位 | **环境观察**：复核开始时 8123 返回 **502**（疑为并行工作流重启期），本人以 `node preview/serve.mjs` 自起后全 200；非代码问题（`preview/dist` 13 个产物、serve 日志正常） |
| 5 | `node --experimental-strip-types --test tests/verification/render-s06-t121-qareview.test.ts` | `0` | **9/9** | 首次运行 8/9：QA-T5 因**我自己的断言过严**（`deferredCould` 在 L1/L2 本就与 onDemand 重叠）失败，按事实修正为「标记 ⊆ onDemand∪excluded 且与 resident 不相交」后 9/9；失败历史如实保留（见 §T-121.4） |
| 6 | 全量含本节 QA 套件 | `0` | **207/207**（收笔瞬间再跑为 **214/214**，UI 仍在增） | 207 = 184 + 9 + 14（并行 UI 于复核期间新增 `ui-static-scan` 10 + `ui-s07-timing` 4，09:46 落盘）；收笔前 UI 又追加 7 条（累计 61 条）。**UI 用例不计入 S-06 判定**，仅如实记录「非渲染用例数在复核期间持续增长且全绿」 |

**既有用例零回归**：51 条模拟层基线 + 21 条 verification 基线计数未变；渲染既有 45 条被扩至 62 条（新增 ISO-9/10、ATLAS-10/11、DRAW-8/9、NAME-1~7+4b、TOKEN-7/8/9），原 45 条未删减（逐文件计数比对）。**并行 UI 期间未见任何失败**（本节 6 次全量运行均 0 fail）。

## T-121.2 七项必修 + 三项收口逐项判定

| 项 | 判定 | 本人独立证据（非转抄） |
| --- | --- | --- |
| **A-02** 状态语义碰撞 | **CLOSED** | QA-T1：`status` 键集恰为 5 项（positive/warning/negative/disabled/selected），`flow` 恰 3 项（clear/slow/congested）——三态确已迁出 `status`；**全令牌 (color,shape) 两两唯一**（我自己的双重循环，覆盖 base/zone/status/flow 共 20 个默认令牌，0 重复）；**selected 的「无形状」不产生新碰撞**：其色 `#2E6BE6` 不被任何其它令牌复用（断言同色+none 集合为空）；**flow.clear(✓) 与 positive(✓) 同形异色**（`#5B7A8C` vs `#0B7A4B`）；warning(!) 与 slow(↑)、negative(✕) 与 congested(↓) 同色异形；事件态形状恰为 `['check','exclamation','cross','lock','none']`。代码：`semantic-tokens.ts` L101~149（`SEMANTIC` 单色源 + `STATUS_SHAPE`/`FLOW_SHAPE` 分离） |
| **A-05** 高对比模式 | **CLOSED** | QA-T2：`PATTERN_ALPHA=0.18` / `HIGH_CONTRAST_PATTERN_ALPHA=0.3` / `HIGH_CONTRAST_INK_OUTLINE_WIDTH=1` 均为导出配置；默认 `highContrast=false`、`patternAlpha=0.18`、`patternInkOutlineWidth=0`；开启后 alpha→0.3、描边→1，而**全令牌 color/pattern/shape/label/ink/inkOnDark/contrast 逐项相同**（高对比不改任何色值）；`{lod:'L2'}` 亦不改变色板。代码 L155~174 / L247~297 |
| **A-01** 命名映射层 | **CLOSED（含 1 条接口口径确认）** | QA-T3：用**本文件自写**的 §0.3 规则（前缀白名单 17 项 + 全小写 + 无空格/非 ASCII + 无空段 + `_l[012]$`）逐条扫描全部清单条目 → **零违规**；`assertNamingCoverage` = ok / mapped == uniqueNames；正反往返稳定（`fromSheetName(toSheetName(e))` 回原 assetKey；非 ALL 条目 LOD 亦一致）；**ALL≡`_l1` 二义性已被结构性排除**：清单中无任何 assetKey 同时声明 `ALL` 与 `L1`（我对 manifest 做分组统计断言），且 ALL 资产反解回 `L1` 与 asset-spec「以 `_l1` 为代表名」一致（模块头 L16~20 已书面声明该口径）；未知键 / 未知名 / 非法 LOD 三向显式抛错。**实现方白名单「用例内联」的做法正确**（防自证），我已用独立正则再确认覆盖面对其无宽松（其正则比我更严：额外禁 `[^\x00-\x7f]` 与首尾 `_`）。代码 `asset-naming.ts` L86~183 |
| **A-04** 密度 d2 | **CLOSED（附 1 条占位口径提示）** | QA-T4：res/com/ind 均备 d1/d2/d3@L1 且带 `zoneGate`；帧高 d1<h2，d2≤d3（**帧尺寸 d2=d3=128 对 res/ind 并非严格递增**，但占位绘制高度按后缀严格递增：d3 44px / d2 32px / d1 20px，见 `preview/app.mjs` L168，`art-bible §4.2`「轮廓高度可辨」以剪影为准 → 视为满足；真实切片按 §4.2 出图时属数据替换）；`densityToSuffix` 0→''/1→d1/2→d2/3→d3/>3→d3/−1→''/NaN→'' 全域单一映射；绘制侧实测 `['building_com_d2','building_ind_d3','building_res_d1']` 三变体齐出、`skipped=0` |
| **A-06** 范围纪律 | **CLOSED** | QA-T5：三档 `resident` 恒为 `['UI','UI-图案编码','地形地块','道路']`；`onDemand`/`excluded` 与 **T-118 基线逐档完全一致**（L0：植被/VFX/窗光/天气全 excluded；L1：植被/VFX/天气 onDemand、窗光 excluded；L2：四者全 onDemand）；`deferredCould` 恒为 `['天气','昼夜窗光']` 且**只做标记**——与 resident 不相交、必定落在 onDemand∪excluded（L1 天气 / L2 两组本就加载，标记语义为「MVP 由上层忽略」，不改加载行为）。代码 `atlas.ts` L374 / L442 |
| **P-01** 相机数学 | **CLOSED** | QA-T6：`cellWorldBounds(16)` = `{-1024,1024,0,1024}`（2048×1024，菱形四角参与）；`fitTransform` 在 **1060×740** 下 L0 `fitsInViewport(…,8)===true`、L1/L2 false（局部放大属预期）；三档 `worldCenter` 恒为 `(0,512)`，世界中心点恒映射视口中心（1e-9 内）；**9 组 from→to 切档 × 5 个探针点全部等于 `zoomAround(屏幕点, 视口中心)`**（无平移漂移，误差 <1e-9）；`screenToWorldPoint∘worldToScreen` 恒等；zoom 严格取 0.5/1/2。代码 `iso.ts` L110~175 |
| **D-06** 静态扫描加固 | **CLOSED** | QA-T7 双路：① **防放松守卫**——直接读入实现方用例文本，断言 VM-8 仍含 `.set/.fill`、`Object.assign`、`state` 整体替换、动态 import、`../simulation` 越层、`process.hrtime` 片段，TOKEN-5 仍含 `0x…{6,8}`、`rgb/rgba`、`hsl/hsla`、拼色模式（任何人删禁令，本用例立即红）；② 独立重扫 `src/render/**`（我自己的规则）→ 写路径 / `.set`·`.fill` / `Object.assign` / `state=` / 时钟随机 / 越层 / 动态引擎导入 / 非 tokens 色值 **全部 0 命中**；剥注释后未引入漏检（`cocos-backend.ts` L10 的否定式注释不再误报也不掩盖代码） |
| **D-07** 收口 | **CLOSED（附流程建议）** | QA-T8：README §2.1 存在；抽查 **6 个模块行数**与磁盘实际逐项相等（iso 175 / view-model 158 / draw-list 203 / semantic-tokens 323 / asset-naming 183 / atlas 444）；`src/index.ts` 已含 `asset-naming` 导出；**流程建议保留**：把 `src/index.ts` / `src/README.md` 纳入派单显式授权面（原 D-07 遗留项，非本次缺陷） |
| **D-08** 收口 | **CLOSED** | QA-T8：README 含「只产『格级』信号 + S/tickId/cycleId/budget 无信号 + 消费方自行比对或全量重建」；`view-model.ts` 注释含「格级」与「非格字段」说明。T-119 的实现行为（只产格索引）本身未变，属**文档化关闭**（D-08 原判即为「无需改代码」） |

## T-121.3 A-07 / A-08 / A-14 越界关闭的裁定 → **可接受，无需回退**

| 项 | 事实 | 语义/视觉影响 | 回归风险 | 裁定 |
| --- | --- | --- | --- | --- |
| **A-07** 唯一 hex 字面量 | `SEMANTIC` 收敛为单色源（`selected` 引用 `BASE.primary`），此前 flow/status 两组重复定义同色 hex 被消除 | **零视觉变化**（取值未改，仅去重复定义） | 无：QA-T9 断言文件中 23 个 hex **每个只出现一次**（重复即红）；色值与 T-119 一致 | **可接受** |
| **A-08** 补 `inkOnDark` | `SemanticToken` 新增必填字段，`makeToken` 统一赋值（深底用浅墨） | 新增能力，不改既有 `ink` 行为；状态/流线 `inkOnDark` 对比度 ≥3:1（QA-T9），禁用态沿用 WCAG 豁免 | 接口层为**新增必填字段**：唯一构造点是本模块，外部手工构造 Token 的类型会变（当前无此调用方，tsc 0 + 207 全绿即证） | **可接受** |
| **A-14** 去 `_lod` 参数 | `buildSemanticTokenMap(zoneTypes, options?)`，`lod` 移入 options 且语义完整（令牌不随 LOD 变） | 原位置参数为**未使用冗余**，删除不改变任何输出 | 调用点（测试/预览）已同步；`Function.length===1` 由 QA-T9 钉死，防止位置参数回潮 | **可接受** |

**流程观察（D-11）**：三项均超出「A-01/A-02/A-04/A-05/A-06/P-01 + D-06~D-08」必修单，但同属 S-06 且经独立复核无回归。判定：不要求回退；建议后续派单明确「同 Story 内顺带修复」的授权口径，避免「顺手关」与「未经批准的范围扩张」边界模糊。

## T-121.4 缺陷终态表（更新）

| 编号 | 等级 | T-119 状态 | **T-121 终态** | 说明 |
| --- | --- | --- | --- | --- |
| D-06 | S4 | OPEN（测试强度） | **CLOSED** | 12 条写路径禁令 + 4 类色值模式已落地；QA-T7 防放松守卫常驻；我方 QA-R4/T7 双套件交叉验证 |
| D-07 | S4 | OPEN（越界+文档） | **CLOSED（T-132 复核确认彻底关闭）** | README §2.1 索引 + 导出补全；**T-129 改名后 README 行数曾再次漂移，已被我的 QA-T8 守卫捕获，engineering-lead 于 T-129 收口时同步** —— T-132 复跑全量 **232/232 EXIT=0**（QA-T8 转绿）。残留「授权面」为流程建议，非缺陷 |
| D-08 | S4 | OPEN（契约未文档化） | **CLOSED** | README + 函数注释双处写明格级口径 |
| D-09 | S4 | OPEN（预览页 CSS 复制色值） | **OPEN（已降级）** | 已加「仅预览页、禁止进入游戏 UI」注释（其报告 §8 A-12），色值仍为副本 → 维持低优先，建议由 build 从 tokens 生成 CSS 变量 |
| **D-10** | S4 | — | **CLOSED（主理人无头浏览器截图验证，T-132）** | 原问题：1280 宽窗口下右侧面板被横向裁切（canvas 1060 + aside min 300 + gap/padding ≈ 1396 > 1280，无 `@media`、`main` 无 `flex-wrap`）。**T-126 已修**（`main{flex-wrap}` + `@media` + 画布 `max-width:100%` + 拾取换算补正），主理人用无头浏览器实拍 `preview/standalone.html`：1280 宽下 `scrollWidth/clientWidth = 1262/1262`、无横向溢出、面板完整可见。**说明：浏览器实测由主理人执行，非 QA 自测**（QA 侧只做静态结构核对与代码路径复跑） |
| **D-11** | S4 | — | **OPEN（流程观察）** | A-07/A-08/A-14 顺带关闭超出必修单：本次评估可接受、无回归；建议补授权口径（见 §T-121.3） |
| — | — | — | **新增观察（不计缺陷）** | ① 真实 32×32 城市在 L0（0.5×）下世界 4096×2048 → 屏幕 2048×1024，**超 1060×740 画布属预期**（L0 非 fit-all，需平移）；预览演示为 16×16 故 L0 恰可全览。② 复核开始时预览服务 8123 返回 502（并行重启期），自起后全 200。③ QA-T5 首轮 8/9 为**本人断言过严**（把「标记」误当「未加载」），按事实修正后 9/9；失败记录保留，未删用例 |

## T-121.5 S-06 层最终门判定（advisory）

| 层级 | **判定** | 理由 |
| --- | --- | --- |
| **S-06 渲染层（终态 · T-132 复核后）** | **PASS（advisory，无残留红）** | 四条验收：**①PASS ②PASS ③PARTIAL ④PASS**（③ 仅「入校准记录」随 S-04/S-12 真机校准，未做、未放宽）；美术 14 项偏离中必修六项 **全部 CLOSED**，A-07/A-08/A-14 越界项经复核可接受，A-03/A-09/A-10/A-11/A-12/A-13 按计划留真实切片阶段；缺陷 S1/S2/S3 = 0，S4 = D-09（降级，预览 CSS 副本）/D-11（流程），**D-06/D-07/D-08/D-10 均 CLOSED**；**T-132 复跑全量 232/232 EXIT=0（QA-T8 转绿，D-07 文档漂移由 T-129 关闭），无残留红**；渲染相关用例 **85 条**（实现方 66 + T-119 QA 10 + T-124 QA 9）全绿，tsc src-only 0 保持 |
| **W3 出口门（整体）** | **仍为 CONCERNS（不可判 PASS）** | `SM-W3-01~05` 依赖 S-07/S-08/S-09，尚未全部交付；按 `smoke-checklist.md` §0.1 未执行项不得计入通过 |
| **对「是否还有阻塞 S-08 的问题」的回答** | **无** | S-06 对外接口（VM / tokens / atlas / naming / iso 相机 / 后端契约）已稳定且文档化；A-01 映射层使真实切片只换数据；D-09/D-10 均在 preview/文档层，不触及 S-08 依赖的渲染接口。**唯一跨 Story 提醒**：S-12 真实切片到位时按 asset-spec 名字替换 `ASSET_SHEET_STEMS` 数据，不改代码（这正是 A-01 的目的） |

## T-121.6 复核留痕

- **新增**：`tests/verification/render-s06-t121-qareview.test.ts`（9 条）+ 本节。**未改动**：`src/`（含 `src/render/`、`src/ui/`、`src/index.ts`）、`preview/`、`design/`、实现方报告、T-119 既有正文。
- **数值纪律**：所有计数/退出码/HTTP 状态为本机真实运行；DrawCall 一律「估算」；未编造数值。
- **并行工作流隔离**：复核期间 `src/ui/**` 与 `ui-*.test.ts` 持续落盘（09:40~09:46 新增 `ui-static-scan` / `ui-s07-timing`），全部通过；**未计入 S-06 判定**，仅作环境记录。
- **T-132 追加注记（2026-11-06，不改上文）**：① 全量复跑 **232/232 EXIT=0**，本报告的 `QA-T8` 文档守卫已转绿（T-129 同步 README 行数），**S-06 层由此为「PASS、无残留红」**；② **D-07 彻底关闭**（上表已更新）；③ **D-10 关闭**——T-126 修复 P-02，主理人无头浏览器实拍 `scrollWidth/clientWidth = 1262/1262` 无横向溢出（**浏览器实测由主理人执行，非 QA 自测**）；④ 渲染相关用例当前 **85 条**（实现方 62 + T-119 QA 10 + T-124 QA 9 + 后续新增 4）全绿。

---

*§T-121 结束 · T-124 · S-06 修复闭环复核 · 必修六项 A-01/A-02/A-04/A-05/A-06/P-01 全部 CLOSED · D-06/D-07/D-08 CLOSED · A-07/A-08/A-14 可接受 · **S-06 最终门 PASS（advisory，③PARTIAL 保留真机校准）** · W3 出口门仍 CONCERNS（待 S-07~S-09）· 无阻塞 S-08 的问题 · 新增 D-10（preview 1280 裁切）/ D-11（越界流程观察）*

