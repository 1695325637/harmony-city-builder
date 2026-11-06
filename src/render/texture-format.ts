/**
 * HC-01 · 渲染内核 · 纹理格式探测（S-06）
 *
 * 权威口径：asset-spec §0.2 / §0.4 —— 世界资产入图集后 **ASTC 首选 → ETC2 回退 →
 * 不透明底可用 RGB565**；UI 图标 / 文字图集用 RGBA8888 或不压缩保清晰。
 * art-bible U-1 / D-1：ASTC / ETC2 在 Cocos 3.x 鸿蒙导出的实际支持须真机校准后定稿。
 *
 * 本模块只做**能力探测与决策**，不实现压缩；结果需写入真机校准记录（S-04 / S-12）。
 */

export type TextureFormat = 'ASTC' | 'ETC2' | 'RGB565' | 'RGBA8888' | 'NONE';

export interface TextureCaps {
  astc: boolean;
  etc2: boolean;
  rgb565: boolean;
}

export interface TextureProbeResult {
  chosen: TextureFormat;
  degraded: boolean;
  reason: string;
}

/**
 * 按 ASTC → ETC2 → RGB565 → NONE 的降级链选择世界资产压缩格式。
 * `opaqueBackground=true` 时 RGB565 才可用（透明底必须带 alpha，不能掉到 RGB565）。
 */
export function probeTextureFormat(caps: TextureCaps, opaqueBackground = true): TextureProbeResult {
  if (caps.astc) return { chosen: 'ASTC', degraded: false, reason: 'ASTC supported (首选)' };
  if (caps.etc2) return { chosen: 'ETC2', degraded: true, reason: 'ASTC unsupported → ETC2 回退' };
  if (caps.rgb565 && opaqueBackground) return { chosen: 'RGB565', degraded: true, reason: 'ASTC/ETC2 unsupported → RGB565（仅不透明底）' };
  return { chosen: 'NONE', degraded: true, reason: '无压缩纹理能力可用 → 不压缩 + 维持 RGBA8888 保正确性（需真机校准）' };
}

/** UI 图标 / 文字图集：按 art-bible §9.3 固定 RGBA8888 或不压缩，不参与压缩降级链 */
export function probeUiTextureFormat(caps: TextureCaps): TextureProbeResult {
  return {
    chosen: 'RGBA8888',
    degraded: false,
    reason: 'UI 图标 / 文字图集保清晰度，不压缩（art-bible §9.3）；ASTC=' + String(caps.astc) + ' ETC2=' + String(caps.etc2),
  };
}
