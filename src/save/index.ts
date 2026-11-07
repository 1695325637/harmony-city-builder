/**
 * HC-01 · 存档层统一出口（S-10 / T-140）
 *
 * 介质口径：内存模拟介质；真机持久化未验证（EX-03 顺延、准出阻塞）。
 * checksum 定位：防误改 / 防写坏，非反作弊 / 防篡改，无强加密。
 * H3：仅预留 `ISaveStorage.remote` 能力位签名，代码库零同步实现，feature flag 默认关。
 */

export * from './types.ts';
export * from './storage.ts';
export * from './save-service.ts';
