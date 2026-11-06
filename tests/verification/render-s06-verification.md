# HC-01 · S-06 等距渲染层与图集分包 · 验证记录（T-118 / W3）

| 项 | 内容 |
| --- | --- |
| 工作代号 | HC-01（非产品名） |
| 任务 | T-118 · W3 · S-06 等距渲染层与图集分包（渲染内核 + 薄 Cocos 适配 + 浏览器预览） |
| 日期 | 2026-11-05 |
| 授权边界 | 只写 `src/render/`、`tests/`、`preview/`（另按派单允许在 `src/index.ts` 追加 8 行导出，便于 tsc src-only 覆盖新增模块） |
| 上报性质 | **实现方自证**；独立复核由 quality-lead（QA）+ art-director（美术符合性）并行执行，门判定由主理人汇编 |
| 一句话结论 | 内核 7 模块 + Cocos 薄适配 + 零依赖预览三件套交付；S-06 四条验收条件在**可离线验证的范围**内全部有可执行证据；Cocos 组件 / 真机 / 真实贴图 / 实际帧率与 DrawCall 均为**未验证**（本机无 Cocos Creator），已逐项披露 |

---

## 1. 交付物清单（含行数 · T-121 后）

| 路径 | 行数 | 职责 |
| --- | --- | --- |
| `src/render/iso.ts` | 175 | 2:1 dimetric 投影（128×64，顶角锚点）、逆变换、`pickCell`、`depthKey`/`compareDepth`（唯一深度规则）、三档固定缩放 + `zoomAround` 锚点保持、**T-121 P-01：`cellWorldBounds` / `fitTransform` / `worldToScreen` / `screenToWorldPoint` / `fitsInViewport`** |
| `src/render/view-model.ts` | 158 | 只读 VM（零拷贝 + 冻结 + 变更戳快照 4KB）、`diffViewModel`（**格级信号**，D-08 注释）、指纹 |
| `src/render/semantic-tokens.ts` | 323 | **唯一 hex 色源**：base / zone / status / flow 四组令牌 + 图案 / 形状 / 标签 / WCAG 对比度 / `inkOnDark`；**T-121 A-02 唯一 (color,shape)、A-05 图案不透明度配置 + 高对比、A-07 单一色源、A-08 深底浅墨** |
| `src/render/atlas.ts` | 444 | 12 组虚拟图集清单（2048² 货架布局、**A-04 含建筑 d1/d2/d3**）、`validateAtlasManifest`（9 类检查）、`resolveLoadSet`（分区门控 + LOD + **A-06 `deferredCould`**） |
| `src/render/asset-naming.ts` | 183 | **T-121 A-01 映射层**：内部 `assetKey` ↔ asset-spec §0.3 规范名（`toSheetName` / `fromSheetName` / `sheetNameOfEntry` / `assertNamingCoverage`） |
| `src/render/texture-format.ts` | 43 | ASTC → ETC2 → RGB565 → NONE 降级链；UI 图集固定 RGBA8888 |
| `src/render/draw-list.ts` | 203 | 深度排序 + 按图集聚合批次 + DrawCall **估算**（建议基线仅记录）+ **A-04 `densityToSuffix`** |
| `src/render/backend.ts` | 33 | `RenderBackend` 契约（createNode / setFrame / setPosition / setScale / setDepth / destroy / batchBegin / batchEnd） |
| `src/render/cocos/cocos-backend.ts` | 158 | 注入式 Cocos 适配（**不 import 'cc'**）；兄弟序 = depthKey；9-slice 预留 |
| `tests/unit/render-iso.test.ts` | 198 | 10 条（往返 / 斜率 / 深度 / 缩放锚点 / 拾取 / **P-01 包围盒与居中**） |
| `tests/unit/render-viewmodel.test.ts` | 157 | 8 条（只读指纹 / 零拷贝 / 冻结 / diff / **D-06 静态纪律 12 条禁令**） |
| `tests/unit/render-atlas.test.ts` | 213 | 11 条（12 组 / 2048 / 重叠 / 留白 / LOD 同图集 / 加载集 / 非图集 / **A-04 d2** / **A-06 deferredCould**） |
| `tests/unit/render-tokens.test.ts` | 228 | 9 条（覆盖 / 隔离 / 对比度 / **A-02 唯一组合** / **A-05 高对比** / **A-08 inkOnDark** / **D-06 色值扫描**） |
| `tests/unit/render-naming.test.ts` | 121 | 8 条（**A-01**：覆盖 / 合法性 / 具体对照 / 反解 / 唯一性 / 未知失败 / 非图集） |
| `tests/unit/render-cocos-backend.test.ts` | 157 | 7 条（mock cc：位置 / 缩放 / 帧 / 深度 / 批次 / 句柄 / 9-slice） |
| `tests/unit/render-drawlist.test.ts` | 180 | 9 条（深度单调 / 聚合 / 切档不抖动 / 基线 / 缺帧计数 / **A-04 densityToSuffix + 三档产出**） |
| `preview/build.mjs` | 61 | `module.stripTypeScriptTypes` 生成 `preview/dist/*.mjs`（单一真源，11 个模块） |
| `preview/serve.mjs` | 57 | `node:http` 静态服务（127.0.0.1:8123） |
| `preview/index.html` | 99 | 常驻横幅 + 画布（**1060×740**）+ LOD / 概览 / 高对比 + 面板 |
| `preview/app.mjs` | 327 | Canvas 2D 预览：**L0 默认全图居中**、`?lod=`、概览按钮、三档 LOD、拾取、深度序、批次、加载集（Could 标注）、格式探测、高对比开关 |

合计：渲染内核 1 607 行、Cocos 适配 158 行、测试 1 254 行、预览 544 行。

---

## 2. S-06 四条验收条件逐条对照

### ① L0/L1/L2 不跨图集、无批次抖动

| 证据 | 内容 | 结果 |
| --- | --- | --- |
| `render-atlas.test.ts` ATLAS-7 | 同一资产三档 LOD 落同一 `atlasId`（`building_res_d1` / `building_com_d1` / `building_ind_d1` / `tile_empty` / `road_straight` 逐一断言）；三档使用图集集合数相等 | PASS |
| `render-atlas.test.ts` ATLAS-4 | 人工把 `building_res_d1@L2` 挪到别的图集 → `split across atlases` 报错 | PASS（负向） |
| `render-drawlist.test.ts` DRAW-3 | 同一 VM 在 L0/L1/L2 下的**批次集合完全相同**，且逐 sprite `cellIndex:atlasId` 序列三档全等 | PASS |
| `render-drawlist.test.ts` DRAW-2 | 同一图集只出现一个批次（不拆批）；批内深度升序；批次覆盖全部 sprite | PASS |

> 口径说明：批次数 = 使用的图集数，这是「同图集连续、无跨图集交替」的直接产物；三档之间该数值不变即「无批次抖动」。

### ② 渲染层零写状态、色值只经语义令牌

| 证据 | 内容 | 结果 |
| --- | --- | --- |
| `render-viewmodel.test.ts` VM-1 | `buildViewModel` 前后 `canonicalize(state)` 逐字节相等；VM 指纹 = 构建时指纹 | PASS |
| VM-3 / VM-2 | VM 与 cells / factors / budget 视图 `Object.freeze`（写入抛 `TypeError`）；cells 引用与 state 共享（零拷贝），唯一复制项为 `changeStamp`（4KB） | PASS |
| VM-8（静态扫描） | `src/render/**/*.ts` 无 `cells.zone[i] = …`、无 `state.tickId/cycleId/budget/frames` 赋值、无 `Date.now`/`Math.random`/`performance.now`、无 `import … from 'cc'` | PASS |
| `render-tokens.test.ts` TOKEN-5 | 全 render 目录 hex 字面量**仅出现在 `semantic-tokens.ts`**（其他文件命中数 = 0；同时反向确认 tokens 内确有 >10 个 hex，扫描有效） | PASS |
| TOKEN-3 | 状态色 ∉ 分区色集合；状态 / 流线令牌 `pattern` 恒为 `none`（不借分区图案）；分区令牌 `shape` 恒为 `none`（不借状态形状） | PASS |

> 诚实标注：`changeStamp` 是唯一复制项。原因：`runTick` 复用同一 `stateScratch`，相邻 tick 的 cells 数组是**同一引用**；若 diff 直接比对引用则恒无差异（本轮 VM-4 用例过程中实测发现并修正该设计缺陷，见 §5 已知限制 3）。

### ③ 格式探测入校准记录、ASTC 不支持可降级

| 证据 | 内容 | 结果 |
| --- | --- | --- |
| `texture-format.ts` | `probeTextureFormat(caps)` 按 ASTC → ETC2 → RGB565 → NONE 返回 `{chosen, degraded, reason}`；caps 可注入 | 已实现 |
| 预览页「纹理格式探测」面板 | 模拟 caps `{astc:false, etc2:true, rgb565:true}` → 展示 `ETC2`（degraded=true）+ 原因；UI 图集 → `RGBA8888` | 人工可见（本机已起服务验证页面 200） |
| 待办挂接 | 校准记录文件由 S-04 / S-12 真机校准写入（本轮只做探测与决策，不落校准表、不做实际压缩） | **未验证**（真机能力未知） |

### ④ 建筑包按激活分区集加载、未解锁不预载

| 证据 | 内容 | 结果 |
| --- | --- | --- |
| `render-atlas.test.ts` ATLAS-8 | `resolveLoadSet(['R'], lod)`：常驻 = `UI / UI-图案编码 / 地形地块 / 道路`；按需含 `建筑-居住`；`建筑-商业` / `建筑-产业` / `建筑-公共服务` 均**不在 resident / onDemand**，进 excluded；三档 LOD 下均如此 | PASS |
| ATLAS-8（LOD 维度） | L0 排除 `VFX / 昼夜窗光 / 天气`；L2 三者按需；`植被` L0 排除、L1/L2 按需 | PASS |
| ATLAS-1 | 12 组齐备；`validateAtlasManifest` 零错误 | PASS |
| ATLAS-3/4 | 重叠 / 越界 / 留白 >10% / 缺 `zoneGate` / 三档跨图集 —— 逐项负向拒绝 | PASS（负向） |

---

## 3. DrawCall 估算记录（**建议基线，非承诺值**；估算非实测）

来源：`tests/unit/render-drawlist.test.ts` DRAW-4 与本机预览数据路径冒烟（16×16 演示地图，256 地形 + 112 道路 + 144 建筑 = 512 sprite）。

| LOD | 估算 DrawCall（= 批次数） | 建议基线（art-bible §2.3） | 余量 |
| --- | --- | --- | --- |
| L0 | 5 | ≤ 30 | 6× |
| L1 | 5 | ≤ 60–80 | 12–16× |
| L2 | 5 | ≤ 120 | 24× |

- 5 个批次 = `地形地块` + `道路` + `建筑-居住` + `建筑-商业` + `建筑-产业`，三档一致（无跨图集抖动）。
- 该数值随地图规模与分区集变化；**真机实际 DrawCall 与帧率均未测**（无 Cocos 环境），不得作为性能结论引用。

---

## 4. 已验证 / 未验证（诚实两栏）

### ✅ 已验证（可在本机复跑）

1. 投影数学：往返误差 < 1e-9（`-4..36` 全域）、2:1 斜率（两条主轴）、菱形中心 / 顶角拾取。
2. 深度规则：`compareDepth` 全序且与 `depthKey` 严格同序，乱序输入排序结果一致（无随机、无 zIndex 例外）。
3. 缩放：仅三个固定档位；锚点保持（任意档位互切锚点不动，偏移按倍率缩放）。
4. 只读 VM：指纹前后一致、冻结生效、零拷贝引用共享、diff 主信号 + 兜底逻辑与契约用例。
5. 语义令牌：覆盖 `config.zoneTypes` 全量（含扩展 / 未知兜底）、状态六项、分区 / 状态色互斥、形状 / 图案编码合法、对比度字段齐备（前景达 AA，填充如实标注不达 AA 并配深墨 `ink`）。
6. 图集：12 组 / 2048² / 无重叠 / 世界资产 128×64 整数倍 / 留白建模 ≤10% / 三档同图集 / 建筑 `zoneGate` / 补丁式负向用例。
7. 加载集：按激活分区集 + LOD 的 resident/onDemand/excluded 划分，未激活分区不预载。
8. 绘制列表：深度单调、按图集聚合、切档不抖动、缺帧如实计数、非图集资产不进合批。
9. Cocos 适配**映射逻辑**：mock `cc` 下 createNode / setFrame / setPosition / setScale / setDepth / destroy / 句柄复用 / batchLog / 9-slice。
10. 预览链路：`preview/build.mjs` 生成 10 个 `.mjs` 并可被 Node 逐个 import；`serve.mjs` 本机 127.0.0.1:8123 返回 200（index / app.mjs / dist/iso.mjs），横幅文案存在；数据路径冒烟（三档 sprite 512 / skipped 0 / 5 批次）。

### ❌ 未验证（明确未测，不得声称已通过）

1. **Cocos Creator 内一切行为**：`cc.Node` / `cc.Sprite` 真实属性名与生命周期、`setSiblingIndex` 的实际绘制序语义、SpriteFrame 真实赋值、9-slice 渲染效果 —— 本机无编辑器，仅 mock。**真机 / 编辑器验证随 W4**。
2. **真机（HarmonyOS 7）帧率 / DrawCall / 内存**：完全未测；§3 数字为估算。
3. **纹理格式真实支持**：ASTC / ETC2 / RGB565 在鸿蒙导出的实际可用性未知（校准记录待 S-04 / S-12）。
4. **真实贴图与图集打包**：本轮无任何 PNG；清单尺寸为程序化占位（`待真实切片替换`），实际打包留白 / 压缩伪影未测。
5. **浏览器视觉正确性**：无浏览器自动化，仅验证 HTTP 200 + 数据路径无异常；Canvas 实际绘制效果需人工目视（art-director 评审项）。
6. **交互与无障碍**：点击拾取仅在数学层验证；触摸 / 折叠屏 / 减少动态效果未接。

---

## 5. 已知限制与显式契约

1. **预览地图是示例 state**：`preview/app.mjs` 直接构造 16×16 演示数据（不接 session），仅用于可视化渲染数据；真实链路由 S-07 接入。
2. **`tsc` 覆盖方式**：新增 7 个内核模块与 Cocos 适配已加入 `src/index.ts` 导出（8 行），故 `tsc --noEmit --strict … src/index.ts` 覆盖它们；`preview/*.mjs` 为生成产物 / 纯 JS，不在 tsc 范围（由 Node 实跑覆盖）。
3. **VM 变更戳是唯一复制项**：T-118 实现过程中发现「零拷贝下 prev/next VM 共享同一 TypedArray，diff 恒为空（且 tick 复用 scratch 时真实场景同样失效）」，已改为 `changeStamp` 4KB 快照；同时把「同 state 就地改写不 bump `inputVersion` 不可检出」钉为显式契约用例（内核 P1 每次写格必 bump，已核对源码 `tick-pipeline.ts` P1）。
4. **深度 vs 合批的取舍**：先按深度求序、再按图集归批；跨图集的重叠遮挡依赖「同图集优先 + 地形/道路/建筑分层」设计规避，若未来出现跨图集重叠的复杂资产，需回到 art-director 评审。
5. **对比度口径**：分区色为填充（L≈70–80）如实标注 `passesAA=false`（不伪造），叠字用 `ink` 深墨（画布底 14.4:1）；禁用态按 WCAG 1.4.3 非活动控件豁免，同样如实标注未达 AA。
6. **未新增 `src/README.md` 记录**：派单限定只写 `src/render/` + `tests/` + `preview/`，故未改 `src/README.md`（如需要，可在下一轮补入口说明）。

---

## 6. 复跑命令

```bash
# 1) 渲染层单测（45 条）
node --experimental-strip-types --test tests/unit/render-*.test.ts

# 2) 全量回归（117 条 = 既有 72 + 新增 45）
node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts

# 3) 类型检查（src-only，零依赖）
npx --yes -p typescript@5.9.3 tsc --noEmit --strict --target es2022 \
  --module esnext --moduleResolution bundler --allowImportingTsExtensions src/index.ts

# 4) 预览
node preview/build.mjs
node preview/serve.mjs          # → http://127.0.0.1:8123/
```

实测退出码：①`0`（45/45）②`0`（117/117）③`0`（零输出）④构建生成 10 个 `.mjs`、服务 200。

---

## 7. T-121 修复批（复核后整改 · 2026-11-05）

> 依据：quality-lead T-119（`render-s06-qareview.md`）+ art-director T-120（`render-s06-art-review.md`，14 项偏离）+ 主理人 R-1~R-6 裁定。

| 项 | 改动 | 证据 |
| --- | --- | --- |
| **A-02**（中） | 状态令牌 **(color, shape) 组合全局唯一**：通勤三态从 `status.*` 移除、只保留 `flow.*`（clear=✓ / slow=↑ / congested=↓）；事件态 positive=✓ / warning=! / negative=✕ / disabled=锁；形状仅取 art-bible §3.4 白名单 | `render-tokens.test.ts` TOKEN-7：全令牌两两比对 `(color,shape)` 无重复 + 同色必不同形 + 点名回归（warning(!) vs flow.slow(↑)、negative(✕) vs flow.congested(↓)） |
| **A-05**（中） | 图案不透明度提为配置：`PATTERN_ALPHA=0.18` / `HIGH_CONTRAST_PATTERN_ALPHA=0.30` / `HIGH_CONTRAST_INK_OUTLINE_WIDTH=1`；`buildSemanticTokenMap(zoneTypes, { highContrast })` 开关，**默认关闭、视觉不变**；预览页加「高对比模式」勾选（M-093 落地锚点） | TOKEN-8（默认 0.18 / 高分 0.30 / 默认无描边 / 高对比不改任何色值）+ 预览页可交互 |
| **A-01**（中高，裁定方案②） | 新增 `src/render/asset-naming.ts`：`toSheetName` / `fromSheetName` / `sheetNameOfEntry` / `assertNamingCoverage`，内部键 ↔ asset-spec §0.3 规范名（`building_res_d1@L1 → bld_res_low_v1_l1`），**不改内部键、不改渲染代码** | `render-naming.test.ts` NAME-1~7：全清单零错误覆盖 / 前缀白名单 + 全小写 + `_lN` / 无碰撞 / 反解一致 / 未知键与未知名显式抛错 / ALL≡`_l1` 二义以 collision 拒绝 |
| **A-04**（中） | 补 `building_res_d2` / `building_com_d2` 占位（高度 64 → 128 → 128）；`densityToSuffix(d)` 单一映射（0→无 / 1→d1 / 2→d2 / 3→d3，越界钳 d3）；绘制侧改用该函数 | `render-atlas.test.ts` ATLAS-10（三档高度递增 + 建筑均带 zoneGate）+ `render-drawlist.test.ts` DRAW-8（映射表逐值）、DRAW-9（真实产出 d1/d2/d3 三种变体、无缺帧） |
| **P-01**（截图发现） | 预览页默认 **L0 全图概览**；世界包围盒 `cellWorldBounds` + `fitTransform` 下沉到 `iso.ts`（**内核可测**），按包围盒中心居中；切档保持视口中心世界点不变（等价 zoomAround）；画布 1000×700 → **1060×740**（L0 下 2048×1024 世界 → 1024×512，留白 18/114px）；`?lod=L0\|L1\|L2`；面板加「概览」按钮回 L0；双击回 L1 | `render-iso.test.ts` ISO-9（bbox = 2048×1024、空集兜底）+ ISO-10（L0 `fitsInViewport(…,8)===true`、中心映射到视口中心、L1/L2 中心世界点不变且与 `zoomAround` 逐点等价、L2 预期裁切）；实测 L0 fits=true / L1,L2 fits=false 且 centerWorld 恒为 (0,512) |
| **A-06**（中，裁定方案②） | `resolveLoadSet` 新增 `deferredCould`（`DEFERRED_COULD_ATLASES = ['昼夜窗光','天气']`），**加载行为不变**；预览页加载集对这些组标注「（Could 预留，MVP 不加载）」 | ATLAS-11（三档均标 deferredCould；L0 排除 / L1 天气 onDemand + 昼夜窗光 excluded / L2 两者 onDemand，与 T-118 一致） |
| **D-06**（测试加固） | 静态扫描堵绕过面：写格 `.set/.fill`、`Object.assign(state\|cells)`、整体替换 `state =`、动态 `import('cc')`/`require`、`../simulation/` 越层；色值扫描扩至 `#rgb`/`#rrggbbaa`/`0xRRGGBB`/`rgb()`/`hsl()`/`'#'+` 拼接；扫描前先剥注释避免文档反例误判 | `render-viewmodel.test.ts` VM-8（12 条禁令 × 全部 render 源文件）+ `render-tokens.test.ts` TOKEN-5（4 类色值模式 + 反向有效性校验 ≥20 hex） |
| **D-07**（收口） | `src/README.md` 新增 §2.1 渲染层索引（9 模块 + 行数 + 职责 + `src/index.ts` 统一出口说明），`src/index.ts` 导出含 `asset-naming` | README §2.1 |
| **D-08**（文档化） | `diffViewModel` 注释与 README 明确：只产**格级**信号，`S`/`tickId`/`cycleId`/`budget` 变化无信号，消费方需自行比对或全量重建 | `view-model.ts` 函数注释 + README §2.1 末尾「⚠️ diffViewModel 只产格级信号」 |

**T-121 后测试规模**：单元 + 验证共 **144/144 全绿**（T-119 基线 127 + 新增 17：ISO-9/10、ATLAS-10/11、DRAW-8/9、NAME-1~7 + NAME-4b、TOKEN-7/8/9）；`tsc` src-only EXIT=0；预览构建 11 个 `.mjs`（新增 asset-naming）且 `?lod=L0|L1|L2` 均 HTTP 200。

---

## 8. 真实切片验收清单（本轮**不做**，登记待真实切片 / 后续 Story）

| 编号 | 事项 | 现状 | 触发条件 / 后续动作 |
| --- | --- | --- | --- |
| **A-03** | LOD **要素级分层**（L0 无标线投影 / L1 道路标线 + 烘焙投影 / L2 窗格 + 软阴影） | 占位切片三档同尺寸，`draw-list` 无要素门控；三档差异目前仅来自缩放与加载集 | **S-12 切片计划尚未产出/确认，当前占位期无「已烘焙差异」**：若真实切片按 LOD 出不同要素（推荐，符合 §2.3），则只换数据不改代码；若切片同图复用，则须在 `draw-list` 增 LOD 要素开关——归属待 S-12 计划确认后定 |
| **A-10** | 画布**文字标签**（色 + 图案 + 文字三编码） | 令牌有 `label`，画布未绘制 | 待主理人决定是否修订 art-bible §3.2（建议：文字编码由 UI 分区 Tab / 图例承担，画布不叠字）；**当前不实现** |
| **A-11** | 占位缺项：道路 corner/end、锥形冠、place_spread/growth_sweep/pulse_alert、`shadow_*` 烘焙投影、草地/水岸未在绘制中使用 | 未补 | 随真实切片补齐；**`shadow_*` 优先**（否则 §2.3 L1 投影无法验证） |
| **A-12** | 预览页 CSS 硬编码色（6 个色板副本 + 3 个横幅装饰色） | 已加注释「仅预览页、禁止进入游戏 UI」 | 低优先：后续由令牌生成 CSS 变量彻底单一色源 |
| **A-13** | 三面明度用 `globalAlpha`（0.72/0.86/1.0）近似 §5.1 的 70%/85%/100% | 占位可接受 | 真实切片须为预乘明度实色面，不得依赖 alpha 叠加 |
| **A-14** | `buildSemanticTokenMap` 冗余 `_lod` 参数 | **已顺带关闭**：改为 `options?: SemanticTokenOptions`（`highContrast` / `lod` 语义完整），不再有无用位置参数 | — |
| **A-09** | `UI-图案编码` 整组豁免 128×64 整除校验（实为世界资产） | 未改 | 建议随真实切片按 `pat_*` 前缀收紧（届时图案切片参与世界基数校验） |

---

## 9. 复跑命令（T-121 后）

```bash
# 渲染层单测（62 条）
node --experimental-strip-types --test tests/unit/render-*.test.ts

# 全量（144 条 = 既有 127 + 新增 17）
node --experimental-strip-types --test tests/unit/*.test.ts tests/verification/*.test.ts

# 类型检查（src-only）
npx --yes -p typescript@5.9.3 tsc --noEmit --strict --target es2022 \
  --module esnext --moduleResolution bundler --allowImportingTsExtensions src/index.ts

# 预览（默认 L0 全图概览；?lod 可指定档位便于截图核验）
node preview/build.mjs
node preview/serve.mjs        # → http://127.0.0.1:8123/?lod=L0
```

**端口与进程注意（T-121 补充·诚实留痕）**：
- `serve.mjs` 已对 `EADDRINUSE` 友好处理：打印「端口被占用 + 换端口 / 关闭占用进程」提示后 `exit 2`，**不再抛未捕获异常**（此前 T-121 首次启动即因 8123 被 T-118 遗留进程占用而崩溃，而我当时看到的 200 响应实际来自遗留进程——内容因按请求读磁盘文件而与当前版本一致，但「serve.mjs 启动成功」的归因不成立，特此更正；清理后已用**新启动的实例**复验 `?lod=L0|L1|L2`、`app.mjs`、`dist/asset-naming.mjs`、`dist/semantic-tokens.mjs` 全部 200）。
- 本环境下后台任务被终止时可能只结束 wrapper、遗留 node 子进程继续占端口；关闭方式：`netstat -ano | findstr :8123` 找 PID → `taskkill /PID <pid> /F`（本轮已清理，端口现已释放）。

---

## 10. T-126：单文件离线预览 + P-02 布局修复

> 动因：本环境后台进程在回合结束时被回收，`http://127.0.0.1:8123` 无法常驻给用户点开；而 `index.html` 走 ES module + 相对 import，`file://` 会被 CORS 拦。另：主理人截图发现 P-02（画布 1060 + 面板 320~460，在 1280 宽下右侧面板被横向裁切）。

### 10.1 产物（均由 `node preview/build.mjs` 生成，单一真源）

| 产物 | 体积 | 用途 | 打开方式 |
| --- | --- | --- | --- |
| `preview/standalone.html` | **108 344 B（≈105.8 KB）** | 自包含单文件：内联 CSS + 内联 classic script，零外部请求 | **双击 / `file://` 直接打开** |
| `preview/dist/bundle.js` | **102 623 B（≈100.2 KB）** | 同一 bundle 的可审查副本（classic script，IIFE 包裹） | 代码审查用 |
| `preview/dist/*.mjs` | 11 个模块 | 在线预览（`serve.mjs`）与审查用 | `http://127.0.0.1:8123/` |

生成方式：dist 模块按**依赖拓扑序**（types → config → schema → iso → view-model → semantic-tokens → atlas → asset-naming → texture-format → draw-list → backend）拼接，末尾接 `preview/app.mjs`；逐文件去掉 `import … from '…'`（含跨行）、`export {…}` 聚合与 `export` 前缀，整体包在 `(function(){ 'use strict'; … })()`；`standalone.html` = `index.html` 的 `<script type="module" src="app.mjs">` **替换**为 `<script type="text/javascript">bundle</script>`（CSS / DOM 不复制第二份）。

### 10.2 离线冒烟结果（无浏览器，`node preview/build.mjs` 自动执行，失败即 `exit 1`）

```
[preview] 离线冒烟：PASS
  ✓ 语法解析 OK（new Function）
  ✓ import 语句 0 条
  ✓ export 语句 0 条
  ✓ fetch/XHR/WebSocket 0 处
  ✓ standalone 无 type="module"
  ✓ standalone 外部 src/href 0 处（自包含）
  ✓ DOM 桩执行 OK（无异常）
  ✓ 桩执行后已写入概览面板（证明 render() 走通）
```

- 冒烟三层：① `new Function(bundle)` 语法解析（函数体不允许顶层 await，解析成功即排除顶层 await）；② 去注释后正则断言无 `import` / `export` / `import()` / `require()` / `fetch` / `XMLHttpRequest` / 顶层 `await`；③ `vm.runInNewContext` + 最小 DOM/Canvas 桩实际执行一遍，断言 `render()` 走通并写入 `#summary`。
- **诚实边界**：以上均为语法 / 结构 / 桩执行级验证。**未做浏览器实测**（本环境无法拉起浏览器）：真实视觉、Canvas 渲染效果、点击拾取手感、`file://` 下浏览器行为，**需主理人双击 `preview/standalone.html` 目视确认**。
- 回归套件：`tests/verification/preview-offline.test.ts`（7 条）固化了上述断言 + 单一真源与 P-02 规则检查。

### 10.3 P-02 响应式布局处理

| 改动 | 内容 |
| --- | --- |
| 容器 | `main { display:flex; flex-wrap:wrap; gap:12px; padding:12px; align-items:flex-start }` |
| 左栏画布 | `#stage { flex:1 1 640px; min-width:0; max-width:100% }`；`canvas { display:block; width:100%; height:auto; max-width:100% }`（**内部坐标系仍 1060×740**，CSS 只缩放显示尺寸） |
| 右栏面板 | `aside { flex:1 1 380px; min-width:0; max-width:460px }` |
| 窄屏 | `@media (max-width:1024px) { main{flex-direction:column} #stage{width:100%} aside{width:100%;max-width:100%} }` → 面板换行到画布**下方**，不再被裁切 |
| 溢出根因治理 | `min-width:0` 消除 flex 项「内容最小宽度」撑破容器的行为；`flex-wrap` 保证放不下时换行而非横向溢出 |
| 页面自检 | 概览面板新增一行：`布局：scrollWidth / clientWidth（无横向溢出 ✓ / 存在横向溢出 ✗）`——**主理人截图时可直接读到**该状态（真实布局由浏览器计算，非我手算） |

弹性预算手算（`preview-offline.test.ts` PREV-6 固化）：padding 24 + gap 12、basis 640/380 →
- 1024 px：可用 1000 < 640+12+380=1032 → **换行**（画布一行 + 面板一行），无溢出；
- 1280 px：可用 1256 ≥ 1032 → 单行，`#stage` 实际 864 px、`aside` 380 px；
- 1100/1440/1920 同理落在上述两分支之一，均满足「单项 basis ≤ 可用宽度」→ 不发生横向溢出。

> 说明：这是**CSS 规则 + 尺寸预算**级论证（Node 无法计算真实 flex 布局）；真实 `scrollWidth ≤ clientWidth` 由浏览器在截图时呈现（面板自检行给出读数）。

### 10.4 拾取换算（必然一起修，否则 CSS 缩放后点击偏移）

- `app.mjs` 的 `screenToWorld()` 已补正：`getBoundingClientRect()` 是 **CSS 像素**，先乘 `canvas.width / rect.width`（Y 同理 `canvas.height / rect.height`）换算回**内部 1060×740 像素**，再交给内核 `screenToWorldPoint` 与 `pickCell`；并对 `rect.width === 0`（未布局）做了除零保护。
- 未改内核相机数学（`fitTransform` / `screenToWorldPoint` 仍是唯一实现），这次只是**调用处补正**。
- 回归：`preview-offline.test.ts` PREV-7 断言换算表达式与除零保护存在，防止被后续改动回退。

---

## 11. T-129：形状门控 + 命名订正 + 跨层令牌契约（W3 收尾批）

> 准绳：`design/assets/asset-spec.md` **v0.1.1** §0.3（前缀受控 / 语义词受控 / 描述词弱约束；`state` 入选、`shape` 违规）。
> 基线：T-129 前全量 207/207；**本轮后 232/232 全绿、零回归**（含 S-07 的 ui-* 用例）。

### 11.1 A-02 加强：L0 形状门控（主理人 Q-1 裁定 A）

| LOD | 形状 | 通勤态替代编码 | 计数（`DrawList`） |
| --- | --- | --- | --- |
| L0 | **不产出任何 status / flow 形状** | **线宽 / 亮度**（`OverlayDraw.line`）：拥堵 3× / 1.0、缓行 2× / 0.8、畅通 1× / 0.6 | `shapeSpriteCount = 0`；`lineEncodedCount = 通勤条目数`；status 条目进 `hiddenOverlayCount` |
| L1 | 产出形状 | — | `shapeSpriteCount = 条目数`；**每条带 `outline { width: 1, inkTokenId: 'base.ink' }`** |
| L2 | 产出形状 | — | 同上，**不描边**（`outline === undefined`） |

- 叠加层是**独立绘制层**（art-bible §3.3）：不进 `sprites` / 不进合批 → `spriteCount` 与 `estimatedDrawCalls` 与无叠加层时相同（DRAW-10 断言）。
- 未传 `overlays` 时零叠加层，行为与 T-121 完全一致（向后兼容）。
- 描边色**只能由调用方以 `base.ink` 令牌传入**（`outlineInk`）；渲染层不复制色值 → 若调用方不给，则 L1 不描边（降级而非伪造）。
- 用例：DRAW-10（三档门控 + 描边 + 独立层）、DRAW-11（L0 线宽编码派生 / 显式覆盖 / 非法格索引计入 `skipped`）。
- 预览页：L0 画线宽 / 亮度，L1 / L2 画形状（L1 叠加 1px `base.ink` 描边环）；LOD 区新增静态图例「L0 不画状态形状，通勤态以线宽 / 亮度表达；形状在 L1 / L2 生效（L1 带 1px base.ink 内描边）」，面板新增「叠加层：形状 N · 线宽 / 亮度 N · 隐藏 N」。

### 11.2 命名订正（asset-spec v0.1.1 §0.3.4 / 附录 C，7 条）

| # | 订正前 | 订正后 | 语义变化 |
| --- | --- | --- | --- |
| 1 | `icon_shape_check_base_l1` | `icon_state_check_base_l1` | 前缀词 `shape → state` |
| 2 | `icon_shape_exclamation_base_l1` | `icon_state_warn_base_l1` | **物理形状 → 玩家可见语义（warn）** |
| 3 | `icon_shape_cross_base_l1` | `icon_state_neg_base_l1` | **物理形状 → 玩家可见语义（neg）** |
| 4 | `icon_shape_lock_base_l1` | `icon_state_lock_base_l1` | 前缀词 `shape → state` |
| 5 | `icon_shape_arrow_up_base_l1` | `icon_state_up_base_l1` | **物理形状 → 玩家可见语义（up）** |
| 6 | `icon_shape_arrow_down_base_l1` | `icon_state_down_base_l1` | **物理形状 → 玩家可见语义（down）** |
| 7 | `font_ui_main_base_l1` | `font_ui_cjk_base_l1` | 描述词 `main → cjk`（中文字体承载） |

- `vfx_windows_points_base_l1` / `vfx_weather_rain_base_l1` **保持现状**（美术侧判定：Could 未编号、不受 §0.3 约束）。
- 回归：NAME-3 逐条断言 + 全清单「无 `icon_shape_` / `font_ui_main` 残留」扫描。

### 11.3 命名校验加固（否则下次照样漂）

`validateSheetName()` 现按 §0.3 全量校验：全小写 ASCII、无空段 / 连字符、前缀 ∈ 17、LOD ∈ `l0/l1/l2`、变体 ∈ `base|vN`、**语义段（1–3 段）每段命中「受控词 ∪ 描述词」白名单**。

§0.3.6 四条反例（用例内联词表副本，防自证）：

| 反例 | 结果 | 错误要点 |
| --- | --- | --- |
| `icon_shape_warn_base_l1` | **拒绝** | `shape` 不入词表，须用 `state`（§0.3.4） |
| `bld_res_d1_l1` | **拒绝** | `d1` 为工程私有键，交付名须用 `low`（§0.3.2） |
| `Bld_Res_Low_l1` | **拒绝** | 含大写 |
| `bld__res_l1` | **拒绝** | 空段 + 变体段非法 |

正例：§0.3.6 的 9 个示例名全部通过；全清单 47 个条目零错误。描述词白名单含 §0.3.3 全部在用词 + 11 个「描述词扩展」（`a` `b` `visible` `ring` `windows` `points` `weather` `rain` `road` `cjk` `icon`，均属 §0.3.3「非穷举」允许范围）。

### 11.4 Q-3：LOD 回环显式等价（§0.3.5）

- `fromSheetName()` 现返回 `{ assetKey, lod, declaredLod, viaRepresentativeName }`：`lod='ALL'` 的资产反解回 `lod: 'L1'` 时，`declaredLod === 'ALL'` 且 `viaRepresentativeName === true`，**不做静默降级**；三档切片资产反解 `declaredLod === 'SPLIT'`。
- `declaredLodOf(assetKey)` 由图集清单导出的 `ALL_LOD_ASSETS` / `SPLIT_LOD_ASSETS` 判定（单一真源，命名层不另存声明表）；`assertNamingCoverage` 同时校验「声明与条目 lod 一致」，ALL+SPLIT 混用按 collision / 声明不一致拒绝。
- 用例：NAME-4（逐条回环 + 声明断言）、NAME-4b（ALL + L1 并存拒绝）、NAME-9（两类声明互斥 + 代表名回查保留 ALL 声明）。

### 11.5 Q-4：d3 尺寸与预览高度

| 资产 | d1 | d2 | d3 |
| --- | --- | --- | --- |
| 居住 | 128×64 | 128×128 | **128×192** |
| 产业 | 128×64 | 128×128 | **128×192** |
| 商业 | 128×64 | 128×128 | 256×128（横向体量，维持） |

- 仍满足 128×64 整数倍（`192 = 64×3`），`validateAtlasManifest` 校验通过；ATLAS-10 改为逐值断言（并保留全清单整数倍 + zoneGate 断言）。
- 预览层高度映射 `20 / 40 / 60`（对应 64 / 128 / 192 的 1:2:3），使图集层与预览层体量差一致。

### 11.6 跨层令牌契约（`src/README.md` §2.2 原文要点）

> **事故背景**：T-121 的 A-07/A-08 重构移除 `base.primary`，导致 `src/ui/**` 首轮 12 条用例全红；根因＝令牌 id 无稳定性契约。

| 档 | id | 使用方 | 变更规则 |
| --- | --- | --- | --- |
| **硬依赖** | `base.tile`、`base.ink` | UI 布局 / 按压基色、文字色 | **永不可删、不可改名** |
| **语义依赖** | `status.selected`、`status.negative`、`status.positive`、`status.warning` | UI 的 UIColor 语义映射 | 改名 / 删除**须先公告** + **保留 alias 至少一个版本** |
| **动态依赖** | `zone.<zoneId>`（随 `config.zoneTypes` 全量生成） | UI 分区色 | 增分区即增 id；`zone.` 前缀规则不得改 |
| **不依赖** | `flow.clear` / `flow.slow` / `flow.congested` | 通勤态渲染层自用 | 改动不影响 UI，但仍受「先公告」约束 |

规则三条：① 稳定 id 不得重命名 / 删除，确需变更先公告并保留 alias ≥1 版本（alias 由 `buildSemanticTokenMap()` 输出并映射新 id）；② 新增 id 不受限（只增不改，`zone.*` 随配置增长属预期）；③ 门禁 `tests/unit/ui-token-contract.test.ts` 断言上述 id 全部可查，并校验本节文档与门禁清单同步。

同节另写入两条**实现级视觉口径**（正文仍以 art-bible 为准）：① L0 状态形状门控（= §11.1 的代码行为，DRAW-10/11 对应）；② 按压态第二通道例外（press / Tab 切换第二通道＝动效 120ms 或文字标签；纯图形按钮承载语义须自带文字/图标；**该例外不适用信息状态**，信息状态第二通道仍为形状，L1/L2 生效）。

### 11.7 本轮用例与复跑

- 新增 / 更新用例：NAME-8（4 条反例 + 9 条正例 + 变体/LOD 段负例）、NAME-9（LOD 声明）、DRAW-10 / DRAW-11（形状门控）、ATLAS-10（d3 逐值）、`ui-token-contract.test.ts`（6 条：硬依赖 / 语义依赖 / 动态依赖 / flow 不混入 / README 同步 / id 集合幂等）。
- 全量：**232/232 全绿，EXIT=0**；`tsc --noEmit --strict … src/index.ts` **EXIT=0**。
- 预览：`node preview/build.mjs` 重新生成 dist 11 模块 + `bundle.js` 99.7 KB + `standalone.html` 104.6 KB，离线冒烟 **PASS**（8 项）；`preview/app.mjs` 语法检查通过。
- 未验证：形状门控与描边的**视觉观感**需双击 `preview/standalone.html` 目视（无浏览器环境，仍不做「浏览器实测」声明）。
