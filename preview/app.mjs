/**
 * HC-01 · S-06 浏览器预览应用（T-118 交付 / T-121 P-01 修复）
 *
 * 全部绘制数据来自 `preview/dist/`（由 `node preview/build.mjs` 从 src/ 剥类型生成）：
 * 单一真源，预览页不复制任何渲染逻辑。
 *
 * 本页展示：
 *  - 16×16 起步地图（空地 / 三类分区 / 道路）用**语义令牌**取色（无本地 hex）；
 *  - **默认 L0 全图概览 + 世界包围盒居中**（P-01 修复）；切档保持视口中心不动；
 *  - L0 / L1 / L2 三档固定缩放 + 「概览」按钮回 L0 + 双击回 L1；
 *  - `?lod=L0|L1|L2` URL 参数（便于自动化截图核验，默认 L0）；
 *  - 点击拾取（screenToGrid）命中格高亮；
 *  - 深度排序后的绘制顺序、按图集聚合的批次与 DrawCall 估算；
 *  - 当前 LOD 的图集加载集（resident / onDemand / excluded / Could 预留标记）；
 *  - 高对比模式开关（图案 18% → 30% + 1px 深色描边，A-05 / M-093）。
 *
 * ⚠️ 演示数据说明：本页直接构造一份 16×16 **示例 state** 充当渲染输入（不是权威存档，
 *    也不接 session）；Cocos 适配未验证（本机无编辑器），真机 / 编辑器验证随 W4。
 */

import { createDefaultConfig } from './dist/config.mjs';
import { createInitialState, zoneIndex } from './dist/schema.mjs';
import { buildViewModel } from './dist/view-model.mjs';
import { buildSemanticTokenMap, tokenById } from './dist/semantic-tokens.mjs';
import { VIRTUAL_ATLAS_MANIFEST, resolveLoadSet } from './dist/atlas.mjs';
import { buildDrawList, DRAW_CALL_BASELINE } from './dist/draw-list.mjs';
import { pickCell, CELL_W, CELL_H, cellWorldBounds, fitTransform, screenToWorldPoint } from './dist/iso.mjs';
import { probeTextureFormat, probeUiTextureFormat } from './dist/texture-format.mjs';

// ---------------------------------------------------------------------------
// 示例地图（16×16：4 格路网 + 三类分区 + 三档密度）
// ---------------------------------------------------------------------------

const config = createDefaultConfig();
const state = createInitialState(config);

let highContrast = false;
let tokens = buildSemanticTokenMap(config.zoneTypes, { highContrast });

const zoneIdOfIndex = (index) => (index < 2 ? (index === 0 ? 'EMPTY' : 'ROAD') : config.zoneTypes[index - 2] ?? 'UNKNOWN');

for (let y = 0; y < 16; y++) {
  for (let x = 0; x < 16; x++) {
    const i = y * state.side + x;
    state.cells.unlocked[i] = 1;
    const onGrid = x % 4 === 0 || y % 4 === 0;
    if (onGrid) {
      state.cells.zone[i] = zoneIndex(config, 'ROAD');
      continue;
    }
    const block = ((x >> 2) + (y >> 2)) % 3;
    const zoneId = block === 0 ? 'R' : block === 1 ? 'C' : 'I';
    state.cells.zone[i] = zoneIndex(config, zoneId);
    state.cells.density[i] = onGrid ? 0 : ((x + y) % 3) + 1;
    state.cells.inputVersion[i] = i + 1;
  }
}

// ---------------------------------------------------------------------------
// 相机：世界包围盒 + 固定三档缩放（P-01）
// ---------------------------------------------------------------------------

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');

/**
 * 世界包围盒与视口变换：**直接复用内核** `cellWorldBounds` / `fitTransform`
 * （P-01：此前预览页自算锚点 (500,48) 导致 16×16 在 L1 被裁下缘且不居中；
 *  现按包围盒居中，且切档保持视口中心不动——等价于以画布中心为锚点 zoomAround）。
 */
const bounds = cellWorldBounds(state.side, (gx, gy) => state.cells.unlocked[gy * state.side + gx] === 1);
const boundsW = bounds.maxX - bounds.minX;
const boundsH = bounds.maxY - bounds.minY;

function transformFor(lod) {
  return fitTransform(bounds, canvas.width, canvas.height, lod);
}

/**
 * 指针坐标 → 世界坐标。
 * P-02（T-126）：画布改用 CSS 缩放（`width:100%; height:auto`，内部坐标系仍 1060×740），
 * `getBoundingClientRect()` 返回的是 **CSS 像素**，必须按 `canvas.width / rect.width`
 * 换算回内部像素再拾取，否则缩放后点击会偏移（窄屏尤其明显）。
 */
function screenToWorld(lod, clientX, clientY, rect) {
  const t = transformFor(lod);
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
  return screenToWorldPoint({ x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY }, t);
}

const LODS = ['L0', 'L1', 'L2'];
const urlLod = new URLSearchParams(window.location.search).get('lod');
let lod = LODS.indexOf(urlLod) >= 0 ? urlLod : 'L0'; // P-01：默认 L0 全图概览
let selected = null;

// ---------------------------------------------------------------------------
// 叠加层演示数据（状态 / 通勤形状）：**演示构造，不是模拟结果**
// 真实链路里状态来自 P4 归因、通勤态来自 P2 求解（尚未接入 session）。
// ---------------------------------------------------------------------------

const overlaySpecs = [];
{
  const tokenOf = (id) => tokenById(tokens, id);
  for (let gy = 0; gy < 16; gy++) {
    for (let gx = 0; gx < 16; gx++) {
      const i = gy * state.side + gx;
      if (state.cells.zone[i] !== zoneIndex(config, 'ROAD')) continue;
      if ((gx + gy) % 7 === 0) overlaySpecs.push({ cellIndex: i, layer: 'flow', token: tokenOf('flow.congested') });
      else if ((gx + gy) % 5 === 0) overlaySpecs.push({ cellIndex: i, layer: 'flow', token: tokenOf('flow.slow') });
    }
  }
  // 一处状态示例（预算警告）挂在一栋居住建筑上，演示 status 形状在 L1/L2 生效
  for (let i = 0; i < state.side * state.side; i++) {
    if (state.cells.zone[i] === zoneIndex(config, 'R') && state.cells.density[i] > 0) {
      overlaySpecs.push({ cellIndex: i, layer: 'status', token: tokenOf('status.warning') });
      break;
    }
  }
}

/** L1 形状内描边令牌：base.ink（渲染层不自造色值） */
const outlineInk = { id: 'base.ink', color: tokenById(tokens, 'base.ink').color };

function diamondPath(cx, cy, hw = CELL_W / 2, hh = CELL_H / 2) {
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + hw, cy + hh);
  ctx.lineTo(cx, cy + 2 * hh);
  ctx.lineTo(cx - hw, cy + hh);
  ctx.closePath();
}

function zoneTokenOf(zoneIndexValue) {
  const zoneId = zoneIdOfIndex(zoneIndexValue);
  const t = tokens.zones['zone.' + zoneId];
  return t ?? tokenById(tokens, 'base.tile');
}

/** 分区图案编码（圆点阵 / 45° 斜线 / 正交网格）——只用令牌 ink 色，不引入新色值 */
function drawPattern(cx, cy, pattern, token) {
  if (pattern === 'none') return;
  ctx.save();
  ctx.globalAlpha = tokens.patternAlpha; // A-05：18%（常规）/ 30%（高对比）
  ctx.strokeStyle = token.ink;
  ctx.fillStyle = token.ink;
  ctx.lineWidth = 1.5;
  if (pattern === 'dots') {
    for (let dx = -32; dx <= 32; dx += 16) {
      for (let dy = -8; dy <= 8; dy += 8) {
        ctx.beginPath();
        ctx.arc(cx + dx, cy + 24 + dy, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (pattern === 'diagonal-45') {
    for (let k = -56; k <= 56; k += 14) {
      ctx.beginPath();
      ctx.moveTo(cx + k, cy + 8);
      ctx.lineTo(cx + k + 24, cy + 40);
      ctx.stroke();
    }
  } else if (pattern === 'grid-lines') {
    for (let k = -32; k <= 32; k += 16) {
      ctx.beginPath();
      ctx.moveTo(cx + k, cy + 10);
      ctx.lineTo(cx + k, cy + 38);
      ctx.stroke();
    }
  }
  ctx.restore();
  if (tokens.patternInkOutlineWidth > 0) {
    // 高对比模式 1px 深色描边（M-093；占位实现：仍用令牌 ink 色，不引入新色值）
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = token.ink;
    ctx.lineWidth = tokens.patternInkOutlineWidth;
    diamondPath(cx, cy);
    ctx.stroke();
    ctx.restore();
  }
}

function drawSprite(s) {
  const cx = s.x;
  const cy = s.y;
  if (s.kind === 'terrain') {
    diamondPath(cx, cy);
    ctx.fillStyle = tokenById(tokens, 'base.tile').color;
    ctx.fill();
    ctx.strokeStyle = tokenById(tokens, 'base.divider').color;
    ctx.lineWidth = 1;
    ctx.stroke();
    return;
  }
  if (s.kind === 'road') {
    diamondPath(cx, cy);
    ctx.fillStyle = tokenById(tokens, 'base.divider').color;
    ctx.fill();
    return;
  }
  // building：分区色顶面 + 两侧面（同色降透明度，不引入新色值）+ 图案叠层
  const token = zoneTokenOf(state.cells.zone[s.cellIndex]);
  // Q-4（T-129）：图集层 d1/d2/d3 = 64/128/192（1:2:3），预览高度同比取 20/40/60，体量差一致
  const height = s.assetKey.endsWith('d3') ? 60 : s.assetKey.endsWith('d2') ? 40 : 20;
  const hw = CELL_W / 2;
  const hh = CELL_H / 2;
  ctx.beginPath();
  ctx.moveTo(cx - hw, cy + hh);
  ctx.lineTo(cx, cy + 2 * hh);
  ctx.lineTo(cx, cy + 2 * hh - height);
  ctx.lineTo(cx - hw, cy + hh - height);
  ctx.closePath();
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = token.color;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx + hw, cy + hh);
  ctx.lineTo(cx, cy + 2 * hh);
  ctx.lineTo(cx, cy + 2 * hh - height);
  ctx.lineTo(cx + hw, cy + hh - height);
  ctx.closePath();
  ctx.globalAlpha = 0.86;
  ctx.fill();
  ctx.globalAlpha = 1;
  diamondPath(cx, cy - height);
  ctx.fillStyle = token.color;
  ctx.fill();
  ctx.strokeStyle = tokenById(tokens, 'base.canvas').color;
  ctx.lineWidth = 1;
  ctx.stroke();
  drawPattern(cx, cy - height, token.pattern, token);
}

/**
 * 叠加层绘制（T-129 / Q-1 裁定 A）：
 * - L0：**不画任何形状**；通勤态以线宽 / 亮度表达（o.line 非空）；
 * - L1 / L2：画形状（✓ / ! / ✕ / 锁 / ↑ / ↓），L1 额外用 `base.ink` 画 1px 内描边；
 * - 状态类在 L0 无形状亦无线编码（远景态，由 DrawList.hiddenOverlayCount 计数）。
 */
function drawOverlay(o) {
  const cx = o.x;
  const cy = o.y + CELL_H * 0.5; // 菱形几何中心
  if (o.line !== null) {
    // L0 线宽 / 亮度编码
    ctx.save();
    ctx.globalAlpha = o.line.brightness;
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.line.widthScale * 2;
    ctx.beginPath();
    ctx.moveTo(cx - CELL_W * 0.28, cy);
    ctx.lineTo(cx + CELL_W * 0.28, cy);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (!o.shapeVisible) return; // L0 的 status：形状关闭且无替代编码
  const r = 11;
  ctx.save();
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  if (o.shape === 'check') {
    ctx.moveTo(cx - r * 0.8, cy);
    ctx.lineTo(cx - r * 0.1, cy + r * 0.7);
    ctx.lineTo(cx + r * 0.9, cy - r * 0.8);
    ctx.stroke();
  } else if (o.shape === 'exclamation') {
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r * 0.25);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + r * 0.85, 2.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (o.shape === 'cross') {
    ctx.moveTo(cx - r * 0.75, cy - r * 0.75);
    ctx.lineTo(cx + r * 0.75, cy + r * 0.75);
    ctx.moveTo(cx + r * 0.75, cy - r * 0.75);
    ctx.lineTo(cx - r * 0.75, cy + r * 0.75);
    ctx.stroke();
  } else if (o.shape === 'lock') {
    ctx.moveTo(cx - r * 0.55, cy - r * 0.1);
    ctx.lineTo(cx - r * 0.55, cy - r * 0.55);
    ctx.lineTo(cx + r * 0.55, cy - r * 0.55);
    ctx.lineTo(cx + r * 0.55, cy - r * 0.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.75, cy - r * 0.05);
    ctx.lineTo(cx + r * 0.75, cy - r * 0.05);
    ctx.lineTo(cx + r * 0.75, cy + r * 0.75);
    ctx.lineTo(cx - r * 0.75, cy + r * 0.75);
    ctx.closePath();
    ctx.stroke();
  } else if (o.shape === 'arrow-up' || o.shape === 'arrow-down') {
    const dir = o.shape === 'arrow-up' ? -1 : 1;
    ctx.moveTo(cx, cy + dir * r * 0.9);
    ctx.lineTo(cx, cy - dir * r * 0.9);
    ctx.moveTo(cx - r * 0.55, cy - dir * r * 0.9 + dir * r * 0.5);
    ctx.lineTo(cx, cy - dir * r * 0.9);
    ctx.lineTo(cx + r * 0.55, cy - dir * r * 0.9 + dir * r * 0.5);
    ctx.stroke();
  } else {
    ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (o.outline !== undefined) {
    // L1 内描边：1px，颜色取 base.ink 令牌（不自造色值）
    ctx.strokeStyle = o.outline.color;
    ctx.lineWidth = o.outline.width;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function render() {
  const vm = buildViewModel(state);
  const drawList = buildDrawList(vm, VIRTUAL_ATLAS_MANIFEST, lod, { overlays: overlaySpecs, outlineInk });
  const t = transformFor(lod);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = tokenById(tokens, 'base.canvas').color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(t.zoom, 0, 0, t.zoom, t.tx, t.ty);

  for (const s of drawList.sprites) drawSprite(s);
  // 叠加层独立层（art-bible §3.3）：地形 / 建筑之后统一绘制
  for (const o of drawList.overlays) drawOverlay(o);

  if (selected !== null) {
    const gx = selected % state.side;
    const gy = Math.floor(selected / state.side);
    const sprite = drawList.sprites.find((s) => s.cellIndex === selected && s.kind === 'terrain');
    const cx = sprite !== undefined ? sprite.x : (gx - gy) * (CELL_W / 2);
    const cy = sprite !== undefined ? sprite.y : (gx + gy) * (CELL_H / 2);
    ctx.save();
    ctx.strokeStyle = tokenById(tokens, 'status.selected').color;
    ctx.lineWidth = 2 / t.zoom;
    diamondPath(cx, cy);
    ctx.stroke();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = tokenById(tokens, 'status.selected').color;
    ctx.fill();
    ctx.restore();
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  updatePanels(vm, drawList);
}

function updatePanels(vm, drawList) {
  const baseline = DRAW_CALL_BASELINE[lod];
  // P-02 自检：横向溢出（用于截图核验；无 DOM 桩环境下 documentElement 为桩，值无害）
  const docEl = document.documentElement;
  const noHScroll = docEl.scrollWidth <= docEl.clientWidth;
  document.getElementById('summary').innerHTML =
    'LOD <b>' + lod + '</b> · zoom ' + drawList.zoom + '× · 世界 ' + Math.round(boundsW) + '×' + Math.round(boundsH) + '（已居中）<br>' +
    'tick ' + vm.tickId + ' · S=' + vm.S.toFixed(1) + ' · 议题 ' + vm.issueCount + '<br>' +
    'sprite ' + drawList.spriteCount + ' · 跳过(缺帧) ' + drawList.skipped + '<br>' +
    (selected === null ? '未选中格' : '选中格 ' + (selected % state.side) + ',' + Math.floor(selected / state.side)) +
    '<br>布局：' + docEl.scrollWidth + ' / ' + docEl.clientWidth + (noHScroll ? '（无横向溢出 ✓）' : '（存在横向溢出 ✗）') +
    '<br>叠加层：形状 ' + drawList.shapeSpriteCount + ' · 线宽/亮度 ' + drawList.lineEncodedCount + ' · 隐藏 ' + drawList.hiddenOverlayCount +
    (drawList.shapeSpriteCount === 0 ? '（L0 不画形状，通勤态以线宽/亮度表达）' : '');

  const depthRows = drawList.sprites.slice(0, 14).map((s) => {
    return '<li>#' + s.index + ' (' + s.gx + ',' + s.gy + ') ' + s.kind + ' · <code>' + s.frameKey + '</code> <span class="tag">' + s.atlasId + '</span></li>';
  });
  document.getElementById('depthList').innerHTML = depthRows.join('');

  const batchRows = drawList.batches
    .map((b) => '<li><code>' + b.atlasId + '</code> × ' + b.sprites.length + '</li>')
    .join('');
  document.getElementById('batchInfo').innerHTML =
    '批次(= 估算 DrawCall) <b>' + drawList.estimatedDrawCalls + '</b> · 建议基线 L0≤30 / L1≤60–80 / L2≤120（当前 ' + lod + ' 基线 ' + baseline + '）<br>' +
    '<span class="muted">估算值，非实测；不作门禁</span><ul>' + batchRows + '</ul>';

  const loadSet = resolveLoadSet(config.zoneTypes, lod, VIRTUAL_ATLAS_MANIFEST);
  const mark = (id) => (loadSet.deferredCould.indexOf(id) >= 0 ? id + '（Could 预留，MVP 不加载）' : id);
  document.getElementById('loadSet').innerHTML =
    '<b>常驻</b> ' + loadSet.resident.join(' / ') + '<br>' +
    '<b>按需</b> ' + loadSet.onDemand.map(mark).join(' / ') + '<br>' +
    '<b>排除</b> ' + loadSet.excluded.map(mark).join(' / ') + '<br>' +
    '<b>非图集</b> ' + loadSet.nonAtlas.join(' / ') + '<br>' +
    '<span class="muted">未激活分区不进常驻 / 按需（切 LOD 不卸载建筑图集）；天气 / 昼夜窗光属 Could 预留，本页不绘制</span>';

  const worldCaps = { astc: false, etc2: true, rgb565: true };
  const w = probeTextureFormat(worldCaps, true);
  const ui = probeUiTextureFormat(worldCaps);
  document.getElementById('formatInfo').innerHTML =
    '世界资产 → <b>' + w.chosen + '</b>（degraded=' + w.degraded + '）· ' + w.reason + '<br>' +
    'UI 图集 → <b>' + ui.chosen + '</b> · ' + ui.reason + '<br>' +
    '<span class="muted">模拟能力：ASTC 不支持，走 ETC2 回退（真实能力随真机校准）</span>';

  document.getElementById('a11yInfo').innerHTML =
    '高对比模式 <b>' + (tokens.highContrast ? '开' : '关') + '</b> · 图案不透明度 ' + Math.round(tokens.patternAlpha * 100) + '%' +
    ' · 图案描边 ' + tokens.patternInkOutlineWidth + 'px<br>' +
    '<span class="muted">常规 18%（art-bible §3.2）；高对比 30% + 1px 深色描边（M-093）。默认关闭，视觉与 T-118 一致</span>';
}

function syncLodButtons() {
  document.querySelectorAll('#lodRow button[data-lod]').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.lod === lod));
  });
}

document.querySelectorAll('#lodRow button[data-lod]').forEach((btn) => {
  btn.addEventListener('click', () => {
    lod = btn.dataset.lod;
    syncLodButtons();
    render();
  });
});

const overviewBtn = document.getElementById('overviewBtn');
if (overviewBtn !== null) {
  overviewBtn.addEventListener('click', () => {
    lod = 'L0'; // 概览：回到全图（视口中心世界点不变）
    syncLodButtons();
    render();
  });
}

const contrastToggle = document.getElementById('highContrast');
if (contrastToggle !== null) {
  contrastToggle.addEventListener('change', () => {
    highContrast = contrastToggle.checked;
    tokens = buildSemanticTokenMap(config.zoneTypes, { highContrast });
    render();
  });
}

canvas.addEventListener('click', (ev) => {
  const rect = canvas.getBoundingClientRect();
  const p = screenToWorld(lod, ev.clientX, ev.clientY, rect);
  const hit = pickCell(p.x, p.y);
  if (hit.gx < 0 || hit.gy < 0 || hit.gx >= state.side || hit.gy >= state.side) {
    selected = null;
  } else {
    selected = hit.gy * state.side + hit.gx;
  }
  render();
});

// 双击回 L1（art-bible §2.2；不改变视口中心对应的世界点）
canvas.addEventListener('dblclick', () => {
  lod = 'L1';
  syncLodButtons();
  render();
});

syncLodButtons();
render();
