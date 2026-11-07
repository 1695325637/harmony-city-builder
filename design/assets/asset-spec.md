# 资产规格 · Asset Spec

| 项 | 内容 |
|---|---|
| 项目 | 工作代号 HC-01（产品名待定）· 现代都市经营 city builder |
| 文档版本 | **v0.1.1**（补全 §0.3 子类词表 · lean 评审档，2026-11-06） |
| 负责人 | 林绘澄（art-director / 美术与视觉表现） |
| 唯一上游 | `design/art/art-bible.md` **v0.3（S-12 热区数值修订，707 行）** |
| 版本兼容 | **v0.1.1 仅补 / 修 §0.3 命名规范（结构描述 + 词表 + `state` 裁定）与 §1.3 一条命名口径注；既有 95 条 Must 命名、全部规格字段、尺寸 / 色值 / 图集划分均不受影响**。art-bible v0.2.1 相对 v0.2 仅增澄清句，故本文件内各处对 art-bible 的引用不必逐处回改；下游引用本文件的文档亦不必回改。 |
| 状态 | 规格已定义，待用户/主理人确认后进入资产制作；性能数字仍待架构真机校准 |
| 本轮范围 | **只定义规格，不产出任何图片资产**；不含代码、不含 git 操作 |

---

## 0. 上游、范围与纪律

### 0.1 唯一上游与一致性口径

- 本文件是 `art-bible.md` v0.2 **附录 A（首版美术资产清单）** 的逐项展开，**不得增删、不得升档、不得降级**任何条目。
- 附录 A.1 的 **19 个资产组**在本文件中展开为 **95 个具体 Must 资产条目**（组 → 条目数对照见 §0.6）。清单以「逻辑资产」计数，同一逻辑资产的 L0/L1/L2 切片不单独计数（§0.4）。
- 附录 A.2（9 组 Should）、A.3（5 组 Could）按原样收录于 §1.2 / §1.3，仅补编号与图集归属，不改内容。
- 色值、命名、尺寸基数、图集、LOD、三分面、AI 提示词基线一律引用 art-bible §2 / §3 / §4 / §7 / §9.3 / 附录 B，本文件不另立标准。

### 0.2 继承的硬约束（不得突破）

1. OD-1~OD-4 全 A；C-1~C-4 全推荐（2:1 dimetric 128×64、锁单一角度、三个固定缩放档 0.5×/1.0×/2.0×）。
2. MVP **3 类分区 Must**（居住 / 商业 / 产业）；公共服务 Should；公园 / 办公为 Could 变体，**不得进 Must**。
3. 常驻指标恰好 3 项（满意度 / 预算结余 / 周期）；人口为过程量进次级面板；单屏 ≤1 个数据面板。
4. 主节奏控件只有「结束本日」，**无暂停 / 倍速图标**；×1×2×4 为 Should 期可选、不得进 Must。
5. MVP **只做晴朗白天单一基调**；昼夜 / 天气 / 季节整体 Could。**不得重新引入 4 时段叠色参数、3 套天空渐变、窗光点阵小图集**。
6. 交通只有流线层（线宽 / 亮度 / 光点），**无逐车模型、无个体市民资产、无实时车流粒子**（明确禁止，无 Could 期退路）。
7. 状态色与分区色**令牌组隔离**；状态形状只用 ✓/!/✕/锁/↑↓/三角/横杠，**禁止借用分区图案**（圆点阵 / 斜线 / 正交网格 / 十字 / 树冠散点 / 竖条）。
8. 状态色仅用于 HUD 图标 / 数值 / 描边 / 告警脉冲 / 预览边框，**绝不用于地块或建筑填充**。
9. 图集划分、压缩格式、内存 / DrawCall 预算遵循 art-bible §9.3 / §9.4（均为建议基线，待 D-1 校准）。
10. 工作代号 HC-01，产品名待用户另行拍板，**不得擅自命名**。

### 0.3 命名规范

- **结构**：`{类别}_{语义段…}_{变体}_{LOD档}`，**全小写 + 下划线**；禁止中文、空格、大写、版本号乱写、日期戳。
  - 第 1 段 = **类别前缀**（§0.3.1 受控词表，不得自造）
  - 中间 1–3 段 = **语义段**（§0.3.2 受控语义词 + §0.3.3 描述词）
  - 倒数第 2 段 = **变体**（`v1` `v2` `v3`…；无非变体资产用 `base`）
  - 最后 1 段 = **LOD 档**（`l0` / `l1` / `l2`）
  - 段间不得出现空段（禁止 `__`）。

> **v0.1.1 修订说明**：旧版把结构描述为「`{类别}_{子类}_{变体}_{LOD档}`」三段式，但 §1.1 实际在用 4–5 段（如 `tile_ground_empty_base_l1`、`bld_res_low_v1_l1`）。本版改为「1 个前缀 + 1~3 个语义段 + 变体 + LOD」，与实际命名一致。**既有 95 条命名全部符合新结构，无需改名。**

#### 0.3.1 类别前缀（受控，17 个，不得自造）

| 前缀 | 含义 | 前缀 | 含义 |
|---|---|---|---|
| `tile` | 地块 / 地形 | `grid` | 网格线 |
| `overlay` | 世界叠层（预览 / 选中） | `road` | 道路 tile 与标线 |
| `flow` | 通勤流线层 | `bld` | 建筑 |
| `veg` | 植被 | `shadow` / `ao` | 烘焙投影 / 接触 AO |
| `sky` | 天空渐变 | `pat` | 分区图案编码 |
| `ui` | UI 结构与面板 | `icon` | UI 图标 |
| `vfx` | 动效序列帧 | `font` | 字体 |
| `brand` | 品牌资产 | `a11y` | 可访问性资产 |

#### 0.3.2 受控语义词（强约束：语义段**必须**取自此表，不得自造同义词）

| 组 | 受控词 | 适用前缀 | 说明 |
|---|---|---|---|
| 分区 | `res` `com` `ind` `civ` | `bld` `pat` `icon` | 建筑 / 图案 / 分区图标共用 |
| 密度 | `low` `mid` `high` | `bld` | 密度三档，**唯一准绳**。实现内部键 `d1/d2/d3` 仅作私有映射（见 `src/render/asset-naming.ts`），**不得出现在交付名** |
| 道路拼接 | `straight` `corner` `t` `cross` `end` | `road` | 五类 tile；直道 A / B 方向用描述词区分（`a` / `b`） |
| **状态** | **`state`** | `icon` | **状态形状图标唯一准绳**（见 §0.3.4）；`shape` **不入词表** |
| 工具 | `tool` | `icon` | 建造工具图标 |
| 指标 | `metric` | `icon` | 常驻三指标图标 |
| 分区图标 | `zone` | `icon` | 分区选择图标 |
| 分区图案 | `dots` `hatch` `grid` `cross` `canopy` `vertical-bars` | `pat` | 六种图案，与 art-bible §3.2 一一对应 |
| 预览 / 双态 | `valid` `invalid` `plan` `view` | `overlay` `grid` | 预览合法性、规划 / 观赏双态 |
| 变体 | `base` `v1` `v2` `v3`… | 全部 | `base` = 无变体资产；`vN` = 同语义第 N 变体 |

#### 0.3.3 描述词（弱约束：允许自由选用，但须同时满足全部条件）

用于在受控词之后细化语义。**当前在用描述词**（非穷举，新增不需修订本节）：`ground` `empty` `grass` `shore` `roadbase` `mark` `lane` `zebra` `stop` `arrow` `signal` `line` `thin` `mid` `thick` `congest` `pulse` `static` `tree` `round` `cluster` `cone` `micro` `soft` `ellipse` `contact` `day` `gradient` `hud` `topbar` `issue` `list` `diag` `panel` `minimap` `frame` `toast` `9slice` `button` `tab` `detail` `card` `endday` `demolish` `satisfaction` `budget` `cycle` `check` `warn` `neg` `lock` `up` `down` `place` `spread` `dust` `growth` `sweep` `alert` `select` `breath` `ui` `app` `pattern` `palette`。

条件：

1. 全小写 ASCII，2–12 字符，可含数字（如 `9slice`），不得含中文 / 空格 / 连字符；
2. **不得与 §0.3.2 受控词同名却表达不同含义**（同名词必须沿用受控语义）；
3. 不得使同一前缀下出现**规范名碰撞**（唯一性由 §5.1 审计表在交付时校验；
4. 描述词**不进受控词表**，故新增描述词**不需要**修订本节，但同一前缀内应避免同义词混用（如 `round` 与 `circle` 择一）。

#### 0.3.4 `state` 与 `shape` 的裁定（v0.1.1）

- **`state` 为唯一准绳**：状态形状图标统一命名 `icon_state_{语义}_base_lN`，语义词取 `check` / `warn` / `neg` / `lock` / `up` / `down`（对应 §1.1 的 M-079 ~ M-084）。
- **`shape` 不入词表、视为违规**：任何 `icon_shape_*` 命名须订正为 `icon_state_*`（订正对照见 `design/art/reviews/render-s06-art-review.md` 的 §T-121 复评节）。
- 裁定理由：
  1. **§1.1 的 M-079~084 是交付契约**，已用 `icon_state_*`；契约优先于实现习惯；
  2. **语义层级更高**：`state` 表达「这条提示是正向 / 警告 / 负向」这一**玩家可见语义**；`shape` 只表达「用了勾 / 叹号」这一**实现手段**——实现可换（本作就有三角 / 横杠等价变体），语义不可换；
  3. **避免概念混淆**：本作同时存在「分区**图案**编码」与「状态**形状**编码」两套编码，若把 `shape` 用作语义词，会与图案层的「形状」混为一谈，削弱 art-bible §3.4 对图案 / 形状的隔离表达。

#### 0.3.5 LOD 档与代表名

- LOD 段：`_l0` / `_l1` / `_l2`。**清单中以 `_l1`（默认操作层）作为代表名**；同一逻辑资产按需导出三档切片，`_l0` / `_l2` 为其派生命名，**不单独计数、不视为新资产**。
- 不随世界缩放变化的资产（`lod = ALL`，如 UI 图标 / 图案层）**同样以 `_l1` 为代表名**；因此同一 assetKey **不得同时声明 `ALL` 与 `L1`**（否则代表名碰撞，须由命名覆盖率校验显式拒绝）。真实切片按规范名回查时，`ALL` 与 `L1` 二者**须由校验断言区分**，不得静默降级。

#### 0.3.6 命名示例

- 建筑：`bld_res_low_v1_l1`、`bld_com_high_v2_l1`、`bld_ind_mid_v1_l1`
- 地块 / 道路：`tile_ground_empty_base_l1`、`road_straight_a_base_l1`、`road_corner_base_l1`
- 图案 / 图标：`pat_res_dots_base_l1`、`icon_zone_ind_base_l1`、`icon_state_warn_base_l1`
- **反例（禁止）**：`icon_shape_warn_base_l1`（`shape` 违规 → 应为 `state`）、`bld_res_d1_l1`（`d1` 为私有键 → 应为 `low`）、`Bld_Res_Low_l1`（含大写）、`bld__res_l1`（空段）。

### 0.4 通用规格基线（§2 所有表格的每一行均继承以下约束）

> 为避免 95 行重复，以下为**全部 Must 资产共同继承的默认值**；§2 各表只列逐资产差异字段（尺寸 / 占格 / LOD / 9-slice / 动画帧 / 备注）。「逐资产规格」= 本基线 + 该资产在 §2 表中的差异行，二者合并方为完整规格。

| 字段 | 默认值 / 约束 |
|---|---|
| **尺寸基数（世界资产）** | 画布 `W × H` 必须满足 `W = 128 × m`、`H = 64 × n`（m、n 为正整数），即 128×64 的整数倍（art-bible §2.1）。禁止半格、禁止非整数倍留白。 |
| **尺寸基数（UI 资产）** | 切片按 art-bible §7.1 的 **24×24 / 48×48 @1x 逻辑栅格**，导出 @1x/@2x/@3x；其**所属图集画布固定 2048×2048 = (128×16) × (64×32)**，在图集层级同样满足 128×64 整数倍。UI 切片不套用世界网格基数（否则 24×24 图标无法成立）。 |
| **尺寸基数（非位图）** | 字体（`.ttf/.otf` 或系统字体引用）、色板（配置文件）、品牌源文件（矢量）按平台规范，标注「不适用位图基数」，不进图集合批链。 |
| **格式 / 压缩** | 源 `:PNG`（RGBA8888，透明底）；世界资产入图集后用 **ASTC**（首选）/ **ETC2**（回退），不透明底可用 RGB565；**UI 图标 / 文字图集用 RGBA8888 或不压缩**保清晰（art-bible §9.3）。最终格式以 D-1 真机校准结论为准。 |
| **单张贴图 / 图集上限** | ≤ 2048 × 2048；图集留白 ≤ 10%，禁用超大透明边距。 |
| **三分面明度阶梯** | 所有立体体块烘焙为 **顶面 100% / 亮侧 85% / 暗侧 70%**（±5% 材质微调）；造型阶段即切分，运行时**不计算光照**。 |
| **光源方向** | 固定 **左上 45°**，全项目一致；禁止出现方向矛盾的资产。 |
| **投影** | 阴影**不画进 Sprite**，一律使用独立 `shadow_*` 贴片（art-bible §5.1 / 附录 B 负向约束）。 |
| **透明边距** | **≤ 10%**（四边合计按画布短边计），禁止超大透明留白。 |
| **9-slice** | 仅 `ui_panel` / `ui_button` / `ui_tab` / `ui_issue_list` / `ui_diag_panel` / `ui_detail_card` / `ui_toast` / `ui_minimap_frame` 为 9-slice；其余一律 **否**。 |
| **动画帧数** | 静态资产 **1 帧**；loop 动效（选中呼吸、脉冲）**8–12 帧 / 1.2–1.6s loop**；一次性 VFX（落位铺开、尘环、生长扫光）**6–8 帧**；单发射器粒子 ≤ 12–24 粒，落位尘环 ≤ 12 粒（art-bible §8.4）。 |
| **LOD 三档** | 见 §0.5 缩写表；切换用尺寸阈值 + 100–150ms 淡入淡出，**不硬切**；三档切片打入**同一图集**。 |
| **图集 / 合批** | 同屏同图集优先；LOD 三档同图集；禁用逐对象独立材质与 Shader 变体。 |
| **色值** | 只引用 art-bible §3 色板令牌；**分区组与状态组不得互相引用**；禁止贴图内硬编码近似色。 |
| **遮挡排序** | 统一按 Y 轴（屏幕纵向）深度排序，禁止逐对象手写 `zIndex` 例外。 |

### 0.5 LOD 缩写（§2 表格中使用）

| 缩写 | 含义 |
|---|---|
| `S` | **Simplify**：退化为色块体量 + 分区色 + 图案编码，隐藏窗格 / 招牌 / 单株植被 / 投影 / AO（L0 表现） |
| `M` | **Medium**：完整剪影 + 简化窗格 / 标线 + 成组植被 + 烘焙投影（L1 默认表现） |
| `F` | **Full**：窗格 / 招牌 / 路灯 / 单株植被 / 软阴影 / 接触 AO 全开（L2 表现） |
| `—` | 该档**不渲染**（粒子、AO 等在 L0 关闭） |
| `N/A` | UI 层资产，不随世界缩放变化，三档表现一致（随系统字号 / 安全区重排） |

### 0.6 附录 A.1（19 组）→ 本文件（95 项）逐项一致性对照

| # | 附录 A.1 资产组（原文摘要） | 展开条目数 | 本文件编号 | 图集 |
|---|---|---|---|---|
| 1 | 空地、草地、水岸、道路基底 tile | 4 | M-001~004 | `地形地块` |
| 2 | 规划态 / 观赏态网格线、合法 / 非法预览边框、选中呼吸框 | 5 | M-005~009 | `地形地块` |
| 3 | 1 类基础道路：直道（两向）、90° 弯、T 字、十字、端头 | 6 | M-010~015 | `道路` |
| 4 | 车道虚线、斑马线、停止线、方向箭头、信号灯符号 | 5 | M-016~020 | `道路` |
| 5 | 通勤流量线（细/中/粗）、拥堵脉冲标记、静态方向箭头 | 5 | M-021~025 | `道路` |
| 6 | 居住 低/中/高 3 档 × 各 3 变体 | 9 | M-026~034 | `建筑-居住` |
| 7 | 商业 低/中/高 3 档 × 各 2 变体 | 6 | M-035~040 | `建筑-商业` |
| 8 | 产业 低/中/高 3 档 × 各 2 变体 + 储罐 / 烟囱几何件 | 8 | M-041~048 | `建筑-产业` |
| 9 | 树 2–3 冠形、草地微纹理色块 | 4 | M-049~052 | `植被` |
| 10 | 烘焙软投影贴片、接触 AO 贴片（L2） | 2 | M-053~054 | `VFX` |
| 11 | 仅晴朗白天单一基调：1 张天空渐变 + 清冷底光照 | 1 | M-055 | 非图集（全屏组件） |
| 12 | 3 套 Must 分区图案 + 1 套公共服务备用 | 4 | M-056~059 | `UI-图案编码` |
| 13 | 固定 3 指标只读条、议题列表、诊断面板、网格规划态、小地图框、toast | 6 | M-060~065 | `UI` |
| 14 | 面板 / 按钮 / Tab 基座（9-slice）、详情卡 | 4 | M-066~069 | `UI` |
| 15 | 「结束本日」+ 3 分区 + 道路 + 拆除 + 状态 6 + 3 指标图标 | 15 | M-070~084 | `UI` |
| 16 | 落位铺开 + 尘环、生长扫光、议题/告警脉冲、选中呼吸 | 5 | M-085~089 | `VFX` |
| 17 | 中文黑体 + 等宽数字字体（或系统字体引用） | 1 | M-090 | 非位图 |
| 18 | App 图标、启动页（基础版） | 2 | M-091~092 | 非图集 |
| 19 | 高对比图案层、形状编码图标集、校验用色板 | 3 | M-093~095 | 见 §1.1 备注 |
| | **合计** | **95** | | |

> **一致性结论**：19 组全部覆盖，无遗漏、无新增；Should / Could 未混入 Must；已删除 / 降级资产（车辆、市民、昼夜 4 时段、多套天空渐变、窗光点阵、倍速 / 暂停图标）**一项未回潮**。

---

## 1. 主资产清单

### 1.1 Must —— MVP 垂直切片必需（95 项）

> 「命名示例」列按 §0.3 以 `_l1` 代表名给出；类别、档位、图集、备注逐项列出。

| # | 资产名 | 命名示例（含 LOD 档） | 类别 | 所属图集 | 档位 | 备注 |
|---|---|---|---|---|---|---|
| M-001 | 空地地块 | `tile_ground_empty_base_l1` | 地块/地形 | `地形地块` | Must | 浅冷灰 `#E8ECEF` |
| M-002 | 草地地块 | `tile_ground_grass_base_l1` | 地块/地形 | `地形地块` | Must | 微纹理，无叶片 |
| M-003 | 水岸地块 | `tile_ground_shore_base_l1` | 地块/地形 | `地形地块` | Must | 冷灰蓝水面 |
| M-004 | 道路基底 tile | `tile_ground_roadbase_base_l1` | 地块/地形 | `地形地块` | Must | 供道路 tile 叠铺 |
| M-005 | 规划态网格线（显性） | `grid_plan_visible_base_l1` | 世界叠层 | `地形地块` | Must | 决策态显性，1px `#DCE2E8` |
| M-006 | 观赏态网格线（淡出） | `grid_view_faded_base_l1` | 世界叠层 | `地形地块` | Must | 观赏态淡出，双态切换 200ms |
| M-007 | 合法预览边框 | `overlay_preview_valid_base_l1` | 世界叠层 | `地形地块` | Must | 状态色 `#0B7A4B` + ✓ 形状 |
| M-008 | 非法预览边框（红斜纹） | `overlay_preview_invalid_base_l1` | 世界叠层 | `地形地块` | Must | `#C0261D` + ✕ / 横杠 |
| M-009 | 选中呼吸框（静态描边框） | `overlay_select_frame_base_l1` | 世界叠层 | `地形地块` | Must | 主色 `#2E6BE6` 2px 描边；loop 由 M-089 驱动 |
| M-010 | 直道 A 向 tile | `road_straight_a_base_l1` | 道路 | `道路` | Must | 2:1 等距，可平铺 |
| M-011 | 直道 B 向 tile | `road_straight_b_base_l1` | 道路 | `道路` | Must | 与 A 向成正交 |
| M-012 | 90° 弯 tile | `road_corner_base_l1` | 道路 | `道路` | Must | 旋转 / 翻转复用，不为每朝向出图 |
| M-013 | T 字路口 tile | `road_t_base_l1` | 道路 | `道路` | Must | 拼接规则见 §2.11 |
| M-014 | 十字路口 tile | `road_cross_base_l1` | 道路 | `道路` | Must | 同上 |
| M-015 | 道路端头 tile | `road_end_base_l1` | 道路 | `道路` | Must | 断头路收口 |
| M-016 | 车道虚线 | `road_mark_lane_base_l1` | 道路标线 | `道路` | Must | 1–2px @1x 线宽 |
| M-017 | 斑马线 | `road_mark_zebra_base_l1` | 道路标线 | `道路` | Must | 几何条纹 |
| M-018 | 路口停止线 | `road_mark_stop_base_l1` | 道路标线 | `道路` | Must | 几何线 |
| M-019 | 方向箭头 | `road_mark_arrow_base_l1` | 道路标线 | `道路` | Must | 几何符号 |
| M-020 | 信号灯符号 | `road_signal_base_l1` | 道路标线 | `道路` | Must | 圆点三连，不做写实灯柱 |
| M-021 | 细流量线（畅通） | `flow_line_thin_base_l1` | 交通可视化 | `道路` | Must | `#5B7A8C`，线宽+亮度编码 |
| M-022 | 中流量线（缓行） | `flow_line_mid_base_l1` | 交通可视化 | `道路` | Must | `#A85C00` |
| M-023 | 粗流量线（拥堵） | `flow_line_thick_base_l1` | 交通可视化 | `道路` | Must | `#C0261D` |
| M-024 | 拥堵脉冲标记 | `flow_congest_pulse_base_l1` | 交通可视化 | `道路` | Must | 语义色 + ! / 横杠形状双通道 |
| M-025 | 静态方向箭头（减少动效时） | `flow_arrow_static_base_l1` | 交通可视化 | `道路` | Must | 替代光点运动，不依赖动画 |
| M-026 | 居住·低 v1 | `bld_res_low_v1_l1` | 建筑·居住 | `建筑-居住` | Must | 2–3 层坡顶 |
| M-027 | 居住·低 v2 | `bld_res_low_v2_l1` | 建筑·居住 | `建筑-居住` | Must | 剪影与 v1 一致 |
| M-028 | 居住·低 v3 | `bld_res_low_v3_l1` | 建筑·居住 | `建筑-居住` | Must | 仅窗格 / 屋顶小构件变化 |
| M-029 | 居住·中 v1 | `bld_res_mid_v1_l1` | 建筑·居住 | `建筑-居住` | Must | 板式小高层、平顶 |
| M-030 | 居住·中 v2 | `bld_res_mid_v2_l1` | 建筑·居住 | `建筑-居住` | Must | 重复窗格阵列 + 阳台横带 |
| M-031 | 居住·中 v3 | `bld_res_mid_v3_l1` | 建筑·居住 | `建筑-居住` | Must | 同上 |
| M-032 | 居住·高 v1 | `bld_res_high_v1_l1` | 建筑·居住 | `建筑-居住` | Must | 塔式高层、顶部退台 |
| M-033 | 居住·高 v2 | `bld_res_high_v2_l1` | 建筑·居住 | `建筑-居住` | Must | 竖向线条 |
| M-034 | 居住·高 v3 | `bld_res_high_v3_l1` | 建筑·居住 | `建筑-居住` | Must | 成组出现 |
| M-035 | 商业·低 v1 | `bld_com_low_v1_l1` | 建筑·商业 | `建筑-商业` | Must | 大底盘 + 横向条窗 |
| M-036 | 商业·低 v2 | `bld_com_low_v2_l1` | 建筑·商业 | `建筑-商业` | Must | 招牌带 |
| M-037 | 商业·中 v1 | `bld_com_mid_v1_l1` | 建筑·商业 | `建筑-商业` | Must | 灰蓝 + 辅色橙点缀 |
| M-038 | 商业·中 v2 | `bld_com_mid_v2_l1` | 建筑·商业 | `建筑-商业` | Must | 同上 |
| M-039 | 商业·高 v1 | `bld_com_high_v1_l1` | 建筑·商业 | `建筑-商业` | Must | 加裙房与顶部标识 |
| M-040 | 商业·高 v2 | `bld_com_high_v2_l1` | 建筑·商业 | `建筑-商业` | Must | 同上 |
| M-041 | 产业·低 v1 | `bld_ind_low_v1_l1` | 建筑·产业 | `建筑-产业` | Must | 低矮大跨度、锯齿屋顶 |
| M-042 | 产业·低 v2 | `bld_ind_low_v2_l1` | 建筑·产业 | `建筑-产业` | Must | 灰褐 + 低饱和橙灰 |
| M-043 | 产业·中 v1 | `bld_ind_mid_v1_l1` | 建筑·产业 | `建筑-产业` | Must | 同上 |
| M-044 | 产业·中 v2 | `bld_ind_mid_v2_l1` | 建筑·产业 | `建筑-产业` | Must | 同上 |
| M-045 | 产业·高 v1 | `bld_ind_high_v1_l1` | 建筑·产业 | `建筑-产业` | Must | 同上 |
| M-046 | 产业·高 v2 | `bld_ind_high_v2_l1` | 建筑·产业 | `建筑-产业` | Must | 同上 |
| M-047 | 产业·圆柱储罐几何件 | `bld_ind_tank_base_l1` | 建筑·产业 | `建筑-产业` | Must | 几何化，与主体拼接 |
| M-048 | 产业·方形烟囱几何件 | `bld_ind_chimney_base_l1` | 建筑·产业 | `建筑-产业` | Must | 几何化，与主体拼接 |
| M-049 | 植被·圆团冠 | `veg_tree_round_base_l1` | 植被 | `植被` | Must | ≈0.8 格高，无叶片贴图 |
| M-050 | 植被·多边形团簇冠 | `veg_tree_cluster_base_l1` | 植被 | `植被` | Must | 同上 |
| M-051 | 植被·锥形冠 | `veg_tree_cone_base_l1` | 植被 | `植被` | Must | 同上 |
| M-052 | 草地微纹理色块 | `veg_grass_micro_base_l1` | 植被 | `植被` | Must | 可平铺，L0 合并为绿地色块 |
| M-053 | 烘焙软投影贴片 | `shadow_soft_ellipse_base_l1` | 光照 | `VFX` | Must | 不透明度 18–25%，独立资产 |
| M-054 | 接触 AO 贴片 | `ao_contact_base_l1` | 光照 | `VFX` | Must | 仅 L2 启用 |
| M-055 | 晴朗白天天空渐变 | `sky_day_gradient_base_l1` | 氛围 | 非图集（全屏组件） | Must | 冷白 → 浅蓝，**仅 1 张** |
| M-056 | 居住分区图案（圆点阵） | `pat_res_dots_base_l1` | 分区编码 | `UI-图案编码` | Must | 半透 12–18% |
| M-057 | 商业分区图案（45° 斜线） | `pat_com_hatch_base_l1` | 分区编码 | `UI-图案编码` | Must | 同上 |
| M-058 | 产业分区图案（正交网格） | `pat_ind_grid_base_l1` | 分区编码 | `UI-图案编码` | Must | 同上 |
| M-059 | 公共服务备用图案（十字） | `pat_civ_cross_base_l1` | 分区编码 | `UI-图案编码` | Must | Should 分区备用，不进 Must 建筑清单 |
| M-060 | 固定 3 指标只读条 | `ui_hud_topbar_base_l1` | UI | `UI` | Must | 满意度 / 结余 / 周期，**不透明底** |
| M-061 | 议题列表 | `ui_issue_list_base_l1` | UI | `UI` | Must | 议题 3±1 条，图标+短句+归因箭头 |
| M-062 | 诊断面板 | `ui_diag_panel_base_l1` | UI | `UI` | Must | 与 M-061/M-068/M-069 互斥同槽 |
| M-063 | 网格规划态 UI 层 | `ui_grid_plan_state_base_l1` | UI | `UI` | Must | 双态切换明确可感 |
| M-064 | 小地图框 | `ui_minimap_frame_base_l1` | UI | `UI` | Must | 可折叠，左下 |
| M-065 | 事件 toast | `ui_toast_base_l1` | UI | `UI` | Must | 不遮挡画布与底部工具区 |
| M-066 | 面板 9-slice 基座 | `ui_panel_9slice_base_l1` | UI | `UI` | Must | 9-slice |
| M-067 | 按钮 9-slice 基座 | `ui_button_9slice_base_l1` | UI | `UI` | Must | 9-slice，含按压态 |
| M-068 | Tab 9-slice 基座 | `ui_tab_9slice_base_l1` | UI | `UI` | Must | 9-slice，底部拇指区 |
| M-069 | 地块详情卡 | `ui_detail_card_base_l1` | UI | `UI` | Must | 与诊断面板互斥同槽 |
| M-070 | 「结束本日」主节奏图标 | `icon_endday_base_l1` | UI 图标 | `UI` | Must | **唯一节奏图标** |
| M-071 | 居住分区图标 | `icon_zone_res_base_l1` | UI 图标 | `UI` | Must | 建筑轮廓剪影 + 圆点阵 |
| M-072 | 商业分区图标 | `icon_zone_com_base_l1` | UI 图标 | `UI` | Must | 剪影 + 斜线 |
| M-073 | 产业分区图标 | `icon_zone_ind_base_l1` | UI 图标 | `UI` | Must | 剪影 + 正交网格 |
| M-074 | 道路工具图标 | `icon_tool_road_base_l1` | UI 图标 | `UI` | Must | 填充式 24×24 |
| M-075 | 拆除工具图标 | `icon_tool_demolish_base_l1` | UI 图标 | `UI` | Must | 同上 |
| M-076 | 满意度指标图标 | `icon_metric_satisfaction_base_l1` | UI 图标 | `UI` | Must | 3 常驻指标之一 |
| M-077 | 预算结余指标图标 | `icon_metric_budget_base_l1` | UI 图标 | `UI` | Must | 同上 |
| M-078 | 周期指标图标 | `icon_metric_cycle_base_l1` | UI 图标 | `UI` | Must | 同上 |
| M-079 | 状态形状 ✓ | `icon_state_check_base_l1` | UI 图标 | `UI` | Must | 形状编码，禁借分区图案 |
| M-080 | 状态形状 ! / 三角 | `icon_state_warn_base_l1` | UI 图标 | `UI` | Must | 同上 |
| M-081 | 状态形状 ✕ / 横杠 | `icon_state_neg_base_l1` | UI 图标 | `UI` | Must | 同上 |
| M-082 | 状态形状 锁 | `icon_state_lock_base_l1` | UI 图标 | `UI` | Must | 禁用 / 未解锁 |
| M-083 | 状态形状 ↑ | `icon_state_up_base_l1` | UI 图标 | `UI` | Must | 正向变化 |
| M-084 | 状态形状 ↓ | `icon_state_down_base_l1` | UI 图标 | `UI` | Must | 负向变化 |
| M-085 | 规划落位铺开 VFX | `vfx_place_spread_base_l1` | VFX | `VFX` | Must | 6–8 帧，120–180ms |
| M-086 | 落地尘环 VFX | `vfx_place_dust_base_l1` | VFX | `VFX` | Must | ≤12 粒，可关闭 |
| M-087 | 密度生长扫光 VFX | `vfx_growth_sweep_base_l1` | VFX | `VFX` | Must | 320ms，可关闭 |
| M-088 | 议题 / 告警脉冲 VFX | `vfx_pulse_alert_base_l1` | VFX | `VFX` | Must | 8–12 帧 loop，**必须可关** |
| M-089 | 选中呼吸 loop 序列帧 | `vfx_select_breath_base_l1` | VFX | `VFX` | Must | 驱动 M-009，8–12 帧 loop |
| M-090 | 中文黑体 + 等宽数字字体 | `font_ui_cjk_base` | 字体 | 非位图 | Must | 系统字体优先；授权待 D-5 |
| M-091 | App 图标 | `brand_app_icon_base` | 品牌 | 非图集 | Must | 遵循 HarmonyOS 图标规范；**产品名待定** |
| M-092 | 启动页（基础版） | `brand_splash_base` | 品牌 | 非图集 | Must | 仅晴朗白天基调 |
| M-093 | 高对比分区图案层 | `a11y_pattern_hicontrast_base_l1` | 可访问性 | `UI-图案编码` | Must | 不透明度 30% + 1px 深色描边 |
| M-094 | 形状编码图标集 | `a11y_shape_icon_set_base_l1` | 可访问性 | `UI` | Must | **复用 M-079~084，不重复出图** |
| M-095 | 去色 / 色盲校验用色板 | `a11y_palette_check_base` | 可访问性 | 非位图 | Must | 含「状态色 vs 分区色不混淆」用例 |

### 1.2 Should —— 首个迭代（与附录 A.2 逐项一致，9 组）

| 编号 | 资产组 | 图集归属 | 备注 |
|---|---|---|---|
| S-01 | 公共服务分区（靛紫 `#7B78C4` + 十字图案）与消防 / 学校 / 医院等公共建筑 | `建筑-公共服务` + `UI-图案编码` | M-059 图案已备用 |
| S-02 | 道路分级（干道 / 支路）+ 桥梁 / 环路等扩展道路件 | `道路` | 由宽度 + 中央分隔线 + 路缘区分，不新增资产体系 |
| S-03 | 倍速 ×1 / ×2 / ×4 自动播放控件 | `UI` | **Should 期可选，不得进 Must**；仅在 OD-2 后续变更时启用 |
| S-04 | 折叠屏展开态下半屏专属面板切片、平板侧栏双列布局资源 | `UI` | GDD 6.2 H2，Should 级平台特性、非承诺 |
| S-05 | 议题 / 诊断的归因链可视化（4 因子差分、热力层）、分区级满意度差异 | `UI` | 单屏 ≤1 数据面板 |
| S-06 | 更多建筑变体、当代时代符号（光伏板、绿化屋顶、充电桩、街头广告屏） | 对应建筑图集 | **不含任何车辆类符号** |
| S-07 | 升级 / 拆除 / 事件提示扩展 VFX、教程指引插画 | `VFX` | 帧数遵循 §0.4 基线 |
| S-08 | 三档色盲专用调色板、输入替代路径提示图层 | `UI-图案编码` / `UI` | Comprehensive 升级项 |
| S-09 | 图标 @2x / @3x 全量导出、多语言相关图标 | `UI` | 切片栅格见 §0.4 |

### 1.3 Could —— 版本后期 / 非 MVP 强制（与附录 A.3 逐项一致，5 组）

| 编号 | 资产组 | 图集归属 | 备注 |
|---|---|---|---|
| C-01 | **昼夜 / 季节整体方案**：4 时段叠色参数、3 套额外背景天空渐变、窗光点阵小图集、季节外观（春樱 / 秋叶 / 冬雪） | `昼夜窗光` + 非图集 | 锚点 6 明确为 Could；GDD 5.2 切片外明确「无季节昼夜」；**不得进 Must** |
| C-02 | **天气整体方案**：阴 / 雨 / 雪 叠色层 + 雨丝 Sprite + 积雪叠片 | `天气` | 首版仅晴 |
| C-03 | 公园 / 绿地、办公 / CBD 分区变体及其图案编码（第 4、5 套） | 对应建筑图集 + `UI-图案编码` | 分区变体，非独立核心分区 |
| C-04 | 城市地标 / 奇观建筑、成就与统计页插画、动态天空云层、远景天际线层 | 对应建筑图集 | — |
| C-05 | 街头小物件（长椅、路灯、报刊亭）、节庆 / 活动主题皮肤 | `VFX` / 对应建筑图集 | — |

> **Could 组命名口径（v0.1.1 补充）**：§1.3 为**组级清单**（5 组），不含逐资产编号与逐资产规格。因此 C-01「窗光点阵」、C-02「雨丝 Sprite」在实现侧的内部键（`windows_points` / `weather_rain`）**属工程内部占位，不受 §0.3 受控命名约束、也不进入 95 条 Must 交付契约**；待 Could 期出逐资产规格时，再按 §0.3 定名。**本轮不为这两条补编号**，理由：①组级清单体例不应被 2 条击穿（Must 95 条逐条编号 / Should 9 组 / Could 5 组是既定分层）；②Could 期实现方案未定（窗光是否用点阵、雨是否用 Sprite 均为预案），此刻定名易返工。工程侧保留现状映射即可，**不要求订正**。

> **明确排除（无 Could 期退路）**：车辆 3 型（小汽车 / 公交 / 货车）、市民点状 / 胶囊人物、逐个体仿真、实时车流粒子、车辆 / 市民沿路径插值动效。**以上资产在任何档位均不存在**（art-bible §4.4、附录 A.3 末段）。

### 1.4 图集划分与合批摘要

**Must 图集 9 个**（与 art-bible §9.3 完全一致）：

| 图集 | 承载 Must 资产 | 同屏合批说明 |
|---|---|---|
| `UI` | M-060~084、M-094 | 常驻；面板 9-slice、图标；RGBA8888 或不压缩 |
| `UI-图案编码` | M-056~059、M-093 | 与地块 / 建筑顶面叠绘；半透 12–18% |
| `地形地块` | M-001~009 | 网格底图，最底层绘制 |
| `道路` | M-010~025 | 道路 tile、标线、流线层同图集，避免跨图集打断合批 |
| `建筑-居住` | M-026~034 | 同分区同屏优先 |
| `建筑-商业` | M-035~040 | 同上 |
| `建筑-产业` | M-041~048 | 同上 |
| `植被` | M-049~052 | L0 合并为绿地色块 |
| `VFX` | M-053、M-054、M-085~089 | 独立 RenderLayer；粒子贴图统一入此图集 |

**非图集 / 独立资产**：M-055 天空渐变（全屏 Sprite 组件）、M-090 字体、M-091/092 品牌、M-095 校验色板。
**Should 图集**：`建筑-公共服务`。**Could 图集**：`昼夜窗光`、`天气`。
**不存在的图集**：车辆 / 市民图集（art-bible §9.3 明确删除）。
所有图集 ≤ 2048×2048，留白 ≤ 10%，LOD 三档切片入同一图集。

---

## 2. 逐资产规格（Must 全展开）

> 下表每一行 = §0.4 通用基线 + 本行差异字段。格式 / 压缩、三分面 100/85/70、左上 45° 光源、透明边距 ≤10%、色板令牌、Y 轴排序、图集上限均由 §0.4 继承，**逐资产均已满足，不再逐行重复**。
> 尺寸列写法：`W×H`，世界资产满足 `W=128×m / H=64×n`；UI 资产按 24/48 栅格切片（所属图集 2048² 满足基数，见 §0.4）。

### 2.1 地块 / 地形与世界叠层（M-001~009）

| 资产 | 尺寸 W×H | 占格 | L0 | L1 | L2 | 9-slice | 动画帧 | 关键约束 |
|---|---|---|---|---|---|---|---|---|
| M-001~004 地块 tile | 128×64 | 1×1 | S | M | F | 否 | 1 | 2:1 菱形底，可无缝平铺；`#E8ECEF` 基色 |
| M-005 规划态网格线 | 128×64 | 1×1 | 常驻 | 常驻 | 常驻 | 否 | 1 | 1px `#DCE2E8`；决策态显性 |
| M-006 观赏态网格线 | 128×64 | 1×1 | 常驻 | 常驻 | 常驻 | 否 | 1 | 淡出态，与 M-005 200ms 切换 |
| M-007 合法预览边框 | 128×64 | 1×1 | — | M | F | 是 | 1 | `#0B7A4B` 描边 + ✓ 形状，不填地块 |
| M-008 非法预览边框 | 128×64 | 1×1 | — | M | F | 是 | 1 | `#C0261D` 斜纹 + ✕ / 横杠 |
| M-009 选中呼吸框 | 128×64 | 1×1 | — | M | F | 是 | 1（静态） | 2px `#2E6BE6` 描边；loop 由 M-089 驱动 |

### 2.2 道路 tile 与标线（M-010~020）

| 资产 | 尺寸 W×H | 占格 | L0 | L1 | L2 | 9-slice | 动画帧 | 关键约束 |
|---|---|---|---|---|---|---|---|---|
| M-010~011 直道 A / B | 128×64 | 1×1 | S | M | F | 否 | 1 | 两向正交；沿路径平铺，禁止逐组合出图 |
| M-012 90° 弯 | 128×64 | 1×1 | S | M | F | 否 | 1 | **旋转 / 翻转复用**，不为每朝向单独出图 |
| M-013 T 字 / M-014 十字 | 128×64 | 1×1 | S | M | F | 否 | 1 | 拼接规则见 §2.11 |
| M-015 端头 | 128×64 | 1×1 | S | M | F | 否 | 1 | 断头收口 |
| M-016~019 标线 4 类 | 128×64 | 1×1 | — | M | F | 否 | 1 | 1–2px @1x 几何线宽，透明底叠铺 |
| M-020 信号灯符号 | 128×64 | 1×1 | — | M | F | 否 | 1 | 圆点三连，禁止写实灯柱 |

### 2.3 交通流线层（M-021~025）

| 资产 | 尺寸 W×H | 占格 | L0 | L1 | L2 | 9-slice | 动画帧 | 关键约束 |
|---|---|---|---|---|---|---|---|---|
| M-021~023 流量线 细/中/粗 | 128×64（可平铺段） | 1×1 | S（保留流线） | M | F | 否 | 1 | 独立 RenderLayer，半透 60–75%；**线宽 / 亮度**编码，无逐车模型 |
| M-024 拥堵脉冲标记 | 128×64 | 1×1 | — | M | F | 否 | 8–12 loop | `#C0261D` + ! / 横杠双通道；**必须可关** |
| M-025 静态方向箭头 | 128×64 | 1×1 | 常驻 | 常驻 | 常驻 | 否 | 1 | 「减少动态效果」时替代光点运动 |

### 2.4 建筑 · 居住（M-026~034，3 档 × 3 变体）

| 资产 | 尺寸 W×H | 占格 | L0 | L1 | L2 | 9-slice | 动画帧 | 关键约束 |
|---|---|---|---|---|---|---|---|---|
| M-026~028 居住·低 v1~v3 | 128×128 | 1×1 | S | M | F | 否 | 1 | 2–3 层坡顶 / 双坡小体量；三变体剪影一致 |
| M-029~031 居住·中 v1~v3 | 128×192 | 1×1 | S | M | F | 否 | 1 | 板式小高层、平顶、重复窗格阵列、阳台横带 |
| M-032~034 居住·高 v1~v3 | 256×256 | 2×2 | S | M | F | 否 | 1 | 塔式高层、顶部退台、竖向线条；成组出现 |

> 密度三档**轮廓高度与体量一眼可辨**（art-bible §4.1 / 锚点 3）；单栋最小可辨识尺寸 ≥ 1 格。所有变体只在窗格 / 色彩 / 屋顶小构件上变化，剪影不得分化（玩家不逐栋摆楼，GDD R2）。

### 2.5 建筑 · 商业（M-035~040，3 档 × 2 变体）

| 资产 | 尺寸 W×H | 占格 | L0 | L1 | L2 | 9-slice | 动画帧 | 关键约束 |
|---|---|---|---|---|---|---|---|---|
| M-035~036 商业·低 v1~v2 | 128×128 | 1×1 | S | M | F | 否 | 1 | 大底盘 + 横向条窗 + 招牌带 |
| M-037~038 商业·中 v1~v2 | 256×192 | 2×2 | S | M | F | 否 | 1 | 灰蓝 + 辅色橙点缀（不占分区色相） |
| M-039~040 商业·高 v1~v2 | 256×256 | 2×2 | S | M | F | 否 | 1 | 加裙房与顶部标识；招牌文字 L2 才显示 |

### 2.6 建筑 · 产业（M-041~048，3 档 × 2 变体 + 2 几何件）

| 资产 | 尺寸 W×H | 占格 | L0 | L1 | L2 | 9-slice | 动画帧 | 关键约束 |
|---|---|---|---|---|---|---|---|---|
| M-041~042 产业·低 v1~v2 | 256×128 | 2×2 | S | M | F | 否 | 1 | 低矮大跨度、锯齿屋顶 |
| M-043~044 产业·中 v1~v2 | 256×192 | 2×2 | S | M | F | 否 | 1 | 灰褐 + 低饱和橙灰（与状态琥珀拉开明度） |
| M-045~046 产业·高 v1~v2 | 384×192 | 3×3 | S | M | F | 否 | 1 | 同上，体量最大但高度受限 |
| M-047 圆柱储罐 | 128×128 | 1×1 | S | M | F | 否 | 1 | 几何化，与主体拼接复用 |
| M-048 方形烟囱 | 128×192 | 1×1 | S | M | F | 否 | 1 | 几何化，与主体拼接复用 |

### 2.7 植被（M-049~052）

| 资产 | 尺寸 W×H | 占格 | L0 | L1 | L2 | 9-slice | 动画帧 | 关键约束 |
|---|---|---|---|---|---|---|---|---|
| M-049~051 树 3 冠形 | 128×128 | 1×1 | S（合并为绿地色块） | M（成组） | F（单株） | 否 | 1 | ≈0.8 格高，短圆柱树干，无叶片贴图 |
| M-052 草地微纹理色块 | 128×64 | 1×1 | 常驻 | M | F | 否 | 1 | 可平铺，与 M-002 叠加 |

### 2.8 光照 / 氛围（M-053~055）

| 资产 | 尺寸 W×H | 占格 | L0 | L1 | L2 | 9-slice | 动画帧 | 关键约束 |
|---|---|---|---|---|---|---|---|---|
| M-053 烘焙软投影贴片 | 128×64 ~ 384×128（随占格） | 依建筑 | — | M | F | 否 | 1 | 椭圆 / 多边形软边，18–25% 不透明度；**不画进建筑 Sprite** |
| M-054 接触 AO 贴片 | 128×64 | 1×1 | — | — | F | 否 | 1 | 仅 L2；低性能档关闭 |
| M-055 晴朗白天天空渐变 | 全屏 1× 拉伸（2048×2048 图集基数） | N/A | 常驻 | 常驻 | 常驻 | 否 | 1 | **仅 1 张**冷白 → 浅蓝；无 4 时段叠色、无多套天空、无窗光点阵 |

### 2.9 分区编码图案（M-056~059）

| 资产 | 尺寸 W×H | 占格 | L0 | L1 | L2 | 9-slice | 动画帧 | 关键约束 |
|---|---|---|---|---|---|---|---|---|
| M-056 圆点阵（居住） | 128×64 | 1×1 | S | M | F | 否 | 1 | 半透 12–18%，可平铺；只叠地块 / 建筑顶面 |
| M-057 45° 斜线（商业） | 128×64 | 1×1 | S | M | F | 否 | 1 | 同上 |
| M-058 正交网格（产业） | 128×64 | 1×1 | S | M | F | 否 | 1 | 同上 |
| M-059 十字（公共服务备用） | 128×64 | 1×1 | — | — | — | 否 | 1 | 备用资产，MVP 不启用；Should 期启用 |

> **状态形状不得借用以上四种图案**（art-bible §3.4 规则 4）；状态形状只由 M-079~084 提供。

### 2.10 UI 结构（M-060~069）

| 资产 | 切片尺寸 | 占格 | LOD | 9-slice | 动画帧 | 关键约束 |
|---|---|---|---|---|---|---|
| M-060 固定 3 指标只读条 | 按屏宽 9-slice（48×48 源） | N/A | N/A | 是 | 1 | **恰好 3 项**；不透明底；人口不得进入 |
| M-061 议题列表 | 48×48 源 9-slice | N/A | N/A | 是 | 1 | 议题 3±1 条；单面板槽位互斥 |
| M-062 诊断面板 | 48×48 源 9-slice | N/A | N/A | 是 | 1 | 与 M-061/M-068/M-069 互斥 |
| M-063 网格规划态 UI 层 | 全屏叠层 | N/A | N/A | 否 | 1 | 双态 200ms 切换；减少动效时瞬时 |
| M-064 小地图框 | 48×48 源 9-slice | N/A | N/A | 是 | 1 | 可折叠，不计为数据面板 |
| M-065 事件 toast | 48×48 源 9-slice | N/A | N/A | 是 | 1 | 自动消失 + 手动关闭 |
| M-066 面板基座 | 48×48 源 | N/A | N/A | **是** | 1 | 减少切片数量 |
| M-067 按钮基座 | 48×48 源 | N/A | N/A | **是** | 1 | 含按压 / 禁用态 |
| M-068 Tab 基座 | 48×48 源 | N/A | N/A | **是** | 1 | 底部 1/3 拇指区，热区 ≥48×48dp |
| M-069 地块详情卡 | 48×48 源 9-slice | N/A | N/A | 是 | 1 | 与诊断面板互斥同槽 |

### 2.11 UI 图标（M-070~084）与道路拼接规则

| 资产 | 切片尺寸 | 图集 | LOD | 9-slice | 动画帧 | 关键约束 |
|---|---|---|---|---|---|---|
| M-070「结束本日」 | 24×24 @1x（导出 @1x/@2x/@3x） | `UI` | N/A | 否 | 1 | 填充式 solid；**唯一节奏图标，无暂停 / 倍速** |
| M-071~073 分区图标 | 24×24 | `UI` | N/A | 否 | 1 | 建筑轮廓剪影 + 对应分区图案，图标即资产缩略 |
| M-074~075 道路 / 拆除 | 24×24 | `UI` | N/A | 否 | 1 | 同上 |
| M-076~078 三指标图标 | 24×24 | `UI` | N/A | 否 | 1 | 满意度 / 结余 / 周期 |
| M-079~084 状态形状 6 项 | 24×24 | `UI` | N/A | 否 | 1 | ✓ / !（三角） / ✕（横杠） / 锁 / ↑ / ↓；**禁借分区图案**；三角与横杠作为 ! / ✕ 的等价变体内嵌，不单独出图 |

**道路 tile 拼接规则**（art-bible §4.3，MVP 仅 1 类基础道路）：

```
基础集：M-010 直道A / M-011 直道B / M-012 90°弯 / M-013 T字 / M-014 十字 / M-015 端头
拼接：以 1×1 tile 为最小单位，按格邻接关系查表选取，不为每种组合单独出图
弯与 T 的四个朝向：用旋转 / 水平翻转复用 M-012 / M-013，不新增资产
标线：M-016~020 作为透明叠层铺在对应 tile 之上，共用 Y 轴排序
分级（干道 / 支路）：Should 期由「宽度 + 中央分隔线 + 路缘」区分，不新增资产体系
```

### 2.12 VFX（M-085~089）

| 资产 | 尺寸 W×H | 占格 | L0 | L1 | L2 | 9-slice | 动画帧 | 关键约束 |
|---|---|---|---|---|---|---|---|---|
| M-085 落位铺开 | 128×128 | 1×1 | — | M | F | 否 | 6–8 帧 | 120–180ms；即时 UI 反馈，<100ms 起效 |
| M-086 落地尘环 | 128×64 | 1×1 | — | M | F | 否 | 6–8 帧 | ≤12 粒；低性能档 / 减少动效时关闭 |
| M-087 生长扫光 | 128×128 | 1×1 | — | M | F | 否 | 6–8 帧 | 320ms，配合 scaleY 抽长，不整块重建 |
| M-088 议题 / 告警脉冲 | 128×128 | 1×1 | — | M | F | 否 | 8–12 帧 loop | 1.2s loop；**必须可关**；色 + 形状双通道 |
| M-089 选中呼吸 loop | 128×128 | 1×1 | — | M | F | 否 | 8–12 帧 loop | 1.6s loop；驱动 M-009；**必须可关**（转静态描边） |

> 粒子预算继承 art-bible §8.4：单屏活跃 ≤200（手机）/ ≤400（平板折叠展开），单发射器 ≤12–24 粒，L0 全关，全部粒子贴图入 `VFX` 图集，禁用逐粒独立材质。

### 2.13 字体 / 品牌 / 可访问性（M-090~095）

| 资产 | 尺寸 | 格式 | LOD | 9-slice | 动画帧 | 关键约束 |
|---|---|---|---|---|---|---|
| M-090 字体 | 不适用位图基数 | `.ttf/.otf` 或系统字体引用 | N/A | 否 | 1 | HarmonyOS Sans 优先，思源黑体 / Noto Sans SC 回退；**等宽数字（tabular figures）硬性要求**；Regular/Medium/Bold 三档；授权待 D-5 |
| M-091 App 图标 | 平台规范多尺寸 | 矢量 + PNG 导出 | N/A | 否 | 1 | 遵循 HarmonyOS 图标规范；**产品名待定，不使用 HC-01 以外暂定名** |
| M-092 启动页 | 全屏适配（手机 / 平板 / 折叠） | PNG / 9-slice | N/A | 是 | 1 | 仅晴朗白天基调，无夜景 / 霓虹 |
| M-093 高对比图案层 | 128×64 | PNG 透明底 + 图集 | 常驻 | 否 | 1 | 图案不透明度 30% + 1px 深色描边；Comprehensive 升级项的高对比模式复用 |
| M-094 形状编码图标集 | 24×24 | PNG + 图集 | N/A | 否 | 1 | **复用 M-079~084，不重复出图**（清单计数保留以对应附录 A 第 19 组） |
| M-095 校验用色板 | 不适用位图基数 | 配置 / 色板文件 | N/A | 否 | 1 | 含去色、三型色盲模拟、**「状态色 vs 分区色不混淆」**校验用例 |

---

## 3. 完整 AI 出图提示词

### 3.1 通用正向约束（逐字继承 art-bible 附录 B，每条提示词必带）

```
2:1 dimetric isometric, orthographic, fixed top-left 45° baked light,
three-tone face shading (top 100% / lit side 85% / dark side 70%),
modernist functional geometric volumes, modular floors, rounded corners 2px,
flat vector-ish illustration, low-saturation cool clean palette,
no realistic materials, no PBR, no neon, no text, no strong perspective,
transparent background, crisp pixel-aligned edges, single asset centered,
game asset sheet style
```

### 3.2 通用负向约束（在附录 B 基础上强化，每条提示词必带）

```
photorealistic, 3D render shading, realistic materials, PBR textures,
neon, night, night scene, dark lighting, cyberpunk,
gradient overload, fairy-tale saturation, post-apocalyptic warm brown,
medieval, cartoon exaggeration,
vehicles, individual cars, buses, trucks, pedestrians, citizens, people, crowds,
particle traffic, traffic simulation,
cast shadow baked into sprite (shadow is separate asset),
busy background, watermark, text, multiple angles, free rotation, perspective camera
```

> **防回潮说明**：`vehicles / pedestrians / citizens / people`、`neon / night`、`realistic materials` 为**强制负向词**，用于防止生成器把 v0.2 已删除的逐车 / 市民资产、夜景霓虹、写实质感重新带回来。任何一条提示词缺这几组负向词即视为不合格，不得提交生成。

### 3.3 分类提示词要点（每类 Must 资产可直接使用）

> 用法：`§3.1 通用正向` + `本表「追加正向要点」` + `§3.2 通用负向`（不得删减）。「追加负向」为该类额外必带词。

| # | Must 资产类 | 追加正向要点 | 追加负向 |
|---|---|---|---|
| P-01 | 地块 tile（M-001~004） | `single 2:1 isometric ground tile, flat diamond footprint, seamless tileable edges, light cool grey #E8ECEF base, subtle micro texture, no elevation` | `buildings, props, elevation, 3D depth` |
| P-02 | 网格线 / 预览框 / 选中框（M-005~009） | `thin 1px geometric line overlay on 2:1 isometric grid, crisp pixel-aligned, pure flat color, high-contrast outline, transparent center` | `glow, bloom, soft shadow, gradient` |
| P-03 | 道路 tile（M-010~015） | `single 2:1 isometric road tile, flat diamond, clean lane geometry, tileable on all four edges, light cool grey asphalt, no elevation` | `cars, vehicles, traffic, road signs with text` |
| P-04 | 道路标线（M-016~020） | `flat geometric road markings, 1-2px crisp lines, dashed lane / zebra stripes / stop line / arrow / three-dot signal symbol, transparent background overlay` | `realistic traffic light pole, photo texture` |
| P-05 | 通勤流线层（M-021~025） | `abstract flow line segment on 2:1 isometric grid, flat ribbon, clean rounded caps, tileable, desaturated deep grey-blue #5B7A8C, three line weights (thin/medium/thick), no vehicles` | `cars, arrows with speed lines, particle trails, glow` |
| P-06 | 居住建筑 3 档（M-026~034） | 低档 `+ 2-3 storey gabled low-rise house, pitched roof, small detached volume, warm off-white with brick-red accents, 1x1 tile`；中档 `+ mid-rise slab block, 6-8 floors, flat roof, repeated modular window grid, balcony horizontal bands, light warm grey, 1x1 tile`；高档 `+ tower block, stepped crown, strong vertical fins, cool grey with glass blue, grouped silhouette, 2x2 tile`；共同 `+ readable silhouette at 50% scale, density tier distinguishable by height and mass` | `ornate facade, balcony furniture, people, windows with reflections` |
| P-07 | 商业建筑 3 档（M-035~040） | `+ large podium base, horizontal ribbon windows, signage band (blank, no text), grey-blue with a single muted orange accent, 1x1 / 2x2 tile by tier, higher tier adds podium skirt and rooftop marker` | `readable logo text, neon sign, illuminated billboard` |
| P-08 | 产业建筑 3 档（M-041~048） | `+ low-rise wide-span factory, sawtooth roof, grey-brown with desaturated orange-grey accents, 2x2 / 3x3 tile by tier, low height large footprint`；几何件 `+ standalone geometric cylindrical storage tank / square chimney, same three-tone shading` | `smoke, pollution cloud, workers, machinery detail` |
| P-09 | 植被（M-049~052） | `+ single geometric canopy cluster (round / polygonal / conical), short cylindrical trunk, muted green, 0.8 tile height, no individual leaves`；草地 `+ flat tileable micro-texture grass swatch` | `individual leaves, branches, photoreal foliage, flowers` |
| P-10 | 光照 / 投影（M-053~054） | `+ standalone soft elliptical drop shadow decal, flat semi-transparent dark grey, soft feathered edge, transparent background, NO building in image` | `building, object, hard shadow, cast shadow on object` |
| P-11 | 分区图案（M-056~059） | `+ seamless 2:1 isometric tileable pattern swatch, flat geometric (even dot grid / 45° fine hatch / orthogonal grid / cross), low opacity, single flat color on transparent background, no 3D` | `gradient, texture noise, multiple colors, illustration` |
| P-12 | UI 图标（M-070~084） | `+ solid filled 24x24 grid icon, 2px safe padding, pixel-aligned, single flat color on transparent, geometric silhouette, shape-coded (check / exclamation / cross / lock / up / down), no text` | `outlined stroke style mixed, gradient, drop shadow, text, emoji` |
| P-13 | UI 9-slice 基座（M-066~069） | `+ flat UI panel / button / tab base, 9-slice safe margins, solid light cool grey #F7F8FA, 2px rounded corners, no content, transparent outside` | `text, icons, sample content, glassmorphism, gradient` |
| P-14 | VFX 序列帧（M-085~089） | `+ flat geometric sweep / soft dust ring / pulse ring, 6-12 frame spritesheet layout, single accent color on transparent, crisp edges, no glow bloom` | `particle explosion, sparks, smoke, realistic dust` |
| P-15 | 品牌（M-091~092） | `+ clean geometric app icon / splash composition, municipal blue #2E6BE6 on light cool grey, modernist city block silhouette, bright daylight, no text` | `product name text, logo lettering, night, neon` |

### 3.4 可直接使用的完整提示词示例（拼装结果）

**示例 A · 居住·中密度 v2（M-030）**
```
2:1 dimetric isometric, orthographic, fixed top-left 45° baked light,
three-tone face shading (top 100% / lit side 85% / dark side 70%),
modernist functional geometric volumes, modular floors, rounded corners 2px,
flat vector-ish illustration, low-saturation cool clean palette,
no realistic materials, no PBR, no neon, no text, no strong perspective,
transparent background, crisp pixel-aligned edges, single asset centered,
game asset sheet style,
mid-rise slab residential block, 6-8 floors, flat roof, repeated modular window grid,
balcony horizontal bands, light warm grey with warm grey accents, 1x1 tile footprint,
readable silhouette at 50% scale
-- negative: photorealistic, 3D render shading, realistic materials, PBR textures,
neon, night, night scene, dark lighting, cyberpunk, gradient overload,
fairy-tale saturation, post-apocalyptic warm brown, medieval, cartoon exaggeration,
vehicles, individual cars, buses, trucks, pedestrians, citizens, people, crowds,
particle traffic, traffic simulation, cast shadow baked into sprite,
busy background, watermark, text, multiple angles, free rotation, perspective camera,
ornate facade, balcony furniture, people, windows with reflections
```

**示例 B · 产业·低密度 v1（M-041）**
```
[§3.1 通用正向],
low-rise wide-span factory, sawtooth roof, grey-brown with desaturated
orange-grey accents, 2x2 tile footprint, low height large footprint,
readable silhouette at 50% scale
-- negative: [§3.2 通用负向], smoke, pollution cloud, workers, machinery detail
```

**示例 C · 居住分区图案 M-056**
```
[§3.1 通用正向],
seamless 2:1 isometric tileable pattern swatch, flat even dot grid,
low opacity, single flat color #A8BE72 on transparent background, no 3D
-- negative: [§3.2 通用负向], gradient, texture noise, multiple colors, illustration
```

> `[§3.1 通用正向]` / `[§3.2 通用负向]` 为**整段代入**占位符，实际生成时必须展开为全文，不得只写占位符。

---

## 4. 生成后强制校验清单

> **任一资产在入图集前必须逐项通过；任一项不通过即重生成或人工修，不得带病入图集**（art-bible 附录 B）。校验结果记入资产审计表（§5.1）。

| # | 校验项 | 判据 | 不通过处置 |
|---|---|---|---|
| V-1 | **剪影可辨性** | 纯黑剪影 + 50% 缩放下仍可识别类别与密度档；居住 / 商业 / 产业三档高度与体量一眼可辨（锚点 3） | 重生成，优先调整轮廓而非加细节 |
| V-2 | **三分面明度一致性** | 顶面 100% / 亮侧 85% / 暗侧 70%（±5%），无第四明度面、无渐变高光 | 人工修或重生成 |
| V-3 | **光源方向一致** | 全资产左上 45°；亮侧 / 暗侧朝向与同图集其他资产一致 | 重生成（不可镜像翻转了事，会破坏等距朝向） |
| V-4 | **色值落在色板且未跨用令牌组** | 全部色值属于 art-bible §3 色板；**分区组（`#A8BE72`/`#4C96C9`/`#C08A62`/`#7B78C4`/`#2E9E7B`/`#9B8AD9`）与状态组（`#0B7A4B`/`#A85C00`/`#C0261D`/`#5B7A8C`）不得互相引用**；状态色不得出现在地块 / 建筑填充上（§3.4 规则 1/3） | 重生成并回到色板令牌 |
| V-5 | **尺寸为 128×64 整数倍** | 世界资产 `W=128×m, H=64×n`；UI 切片按 24/48 栅格且所属图集为 2048²；无半格、无非整数倍留白 | 重切片 |
| V-6 | **透明边距 ≤10%** | 四边透明留白合计按短边计 ≤10%；像素对齐、无毛边 | 重裁切 |
| V-7 | **分区图案与状态形状未混用** | 分区只用圆点阵 / 斜线 / 正交网格 / 十字 / 树冠散点 / 竖条；状态只用 ✓/!/✕/锁/↑↓/三角/横杠；**状态形状不得含任何分区图案，预览框 / 图标不得用分区图案表达状态**；去色后两类编码仍可区分 | 重生成 + 回到 `design/accessibility/accessibility-matrix.md` 的 A-01 验收项复验 |
| V-8 | **禁止回潮检查**（附加） | 图中不含车辆 / 行人 / 市民 / 霓虹 / 夜景 / 写实质感 /  baked-in 投影；不含倍速或暂停图标；不含 4 时段叠色、多套天空渐变、窗光点阵 | 直接废弃该批次，检查提示词是否漏带 §3.2 负向词 |

**校验顺序**：V-1 → V-2 → V-3 → V-4 → V-5 → V-6 → V-7 → V-8（顺序固定，先形状后颜色后工程约束，避免返工）。

---

## 5. 资产审计与交付纪律

### 5.1 审计表（每批资产交付时填写）

| 字段 | 要求 |
|---|---|
| 资产编号 | 必须与 §1.1 的 M-001~095 一一对应，禁止无编号资产 |
| 命名 | 符合 §0.3；`_l0/_l1/_l2` 派生切片不单独编号 |
| 格式 / 压缩 | 符合 §0.4；以 D-1 校准结论为准 |
| 尺寸 / 占格 | 符合 §2 对应行 |
| 图集 | 符合 §1.4；三档 LOD 同图集；留白 ≤10% |
| V-1~V-8 | 全部通过并留记录；未通过项不得入库 |
| 引用检查 | 该资产在 art-bible 附录 A 有对应条目；无孤立资产、无缺失引用 |

### 5.2 孤立资产与缺失引用检查

- **孤立资产**：出现在仓库但不在 §1.1 / §1.2 / §1.3 清单中的资产 → 一律退回，不得入包。
- **缺失引用**：清单中标记为 Must 但仓库无对应文件 → 阻塞 MVP 垂直切片交付。
- **跨档检查**：Should / Could 资产出现在 Must 图集或首包中 → 视为范围越界（GDD 5.2 切片验收只看闭环，不看内容量）。

### 5.3 禁止回潮清单（最高优先级）

以下资产**在任何档位、任何提示词、任何批次中均不得出现**：

1. 车辆 3 型（小汽车 / 公交 / 货车）、任何逐车模型、实时车流粒子。
2. 市民点状 / 胶囊人物、具名个体、可跟随市民、人群演出。
3. 暂停 / 倍速（×1×2×4）图标与常驻控件（仅 Should 期可选，且不得进 Must）。
4. 4 时段昼夜叠色参数、3 套额外天空渐变、窗光点阵小图集、季节外观（仅 Could）。
5. 公共服务 / 公园 / 办公建筑与图案进入 Must（应留 Should / Could）。
6. 状态色用于地块 / 建筑填充；状态形状借用分区图案。
7. 写实质感 / PBR / 霓虹 / 夜景主基调 / baked-in 投影。
8. 产品名（HC-01 为工作代号，产品名待用户拍板）。

### 5.4 图集打包审计

- 每图集 ≤ 2048×2048；留白 ≤ 10%；9-slice 切片单独标记。
- 同屏同图集优先，避免跨图集交替绘制打断 Cocos 自动合批。
- LOD 三档切片必须落入同一图集；切换不得触发跨图集批次抖动。
- 禁用逐对象独立材质与 Shader 变体。

---

## 6. 未决项（不替架构 / UX / 法务下结论）

| # | 事项 | 依赖方 | 说明 |
|---|---|---|---|
| U-1 | ASTC / ETC2 在 Cocos 3.x 鸿蒙导出的实际支持、自动合批行为、DrawCall / 内存 / 包体硬指标 | 程基岩（art-bible D-1 / D-8） | §0.4 的格式与压缩为建议基线，须真机校准后定稿；不阻塞规格定义 |
| U-2 | 字体授权与打包方式（HarmonyOS Sans 商用 / 打包条款、思源黑体 OFL） | 法务 / 程基岩（D-5） | M-090 优先系统字体引用以规避授权与包体风险 |
| U-3 | 系统字号联动、安全区 / hinge API（HarmonyOS 7 预览版） | 程基岩（D-2） | 影响 UI 资产的多尺寸导出与 9-slice 切法；Should 级平台特性，不阻断首版 |
| U-4 | 产品正式命名 | 用户 | M-091 / M-092 品牌资产不得预置产品名 |
| U-5 | 可访问性 A-01 验收中「状态色 vs 分区色不混淆」的判定工具 | art-director（第二波矩阵）+ QA | 见 `design/accessibility/accessibility-matrix.md` |
| U-6 | 低频 tick 与即时 UI 反馈（<100ms）的实现分层 | 程基岩（D-3，架构硬约束） | M-085 / M-070 的即时反馈不等待结算，需架构解耦 |

---

*文档结束 · v0.1 · 只定义规格，不产出图片资产。唯一上游为 `design/art/art-bible.md` v0.2；如上游升版，本文件须同步复核 §0.6 一致性对照表。*
