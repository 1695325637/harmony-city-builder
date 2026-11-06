/**
 * HC-01 · UI 层 · 即时反馈分发计时探针（S-07）
 *
 * ⚠️ **口径声明（不得越界引用）**
 * 本文件测的是「**进程内 UI 分发延迟**」——从调用某个 UI 动作函数到反馈事件派发完成
 * 的耗时（`performance.now()` 差值）。它**不是**真机「点按 → 首帧可见」的 <100ms
 * 达标率：
 * - 不含触摸采样 / 输入事件队列 / 线程切换 / 布局计算 / 绘制 / 合成 / 垂直同步；
 * - 不含 Cocos 渲染管线与 HarmonyOS 系统层（本机无 Cocos Creator、无真机）；
 * - 因此样本只能作为**回归基线**（同一台机器的相对变化），不能作为达标证据。
 * ADR-004 §6 R-1 / §7 A1 要求真机测「达标率（%）」，该测量**未进行**。
 *
 * 纪律：`performance.now()` **全项目只允许出现在本文件**（静态扫描用例
 * `ui-static-scan.test.ts` 钉定）；其他 UI 文件不得读时钟、不得用 `Date.now`。
 */

/** 样本作用域标识：命名与导出名都强调「进程内分发」，避免被当成真机达标率 */
export const DISPATCH_LATENCY_SCOPE = 'in-process-dispatch-only' as const;

/**
 * 供验证记录 / 遥测直接引用的免责声明（逐字使用，不得改写成达标结论）。
 */
export const DISPATCH_LATENCY_DISCLAIMER =
  '进程内 UI 分发延迟样本：不含触摸采样、布局、绘制、合成与真机系统层；不构成「<100ms 达标率」。真机未测。';

export interface DispatchSample {
  readonly action: string;
  readonly latencyMs: number;
  readonly scope: typeof DISPATCH_LATENCY_SCOPE;
}

export type DispatchSampleSink = (sample: DispatchSample) => void;

/**
 * 采样一次「进程内分发延迟」并原样返回被包裹函数的返回值。
 * 名字刻意写成 `sampleDispatchLatency`（而非 `measureUiLatency`），
 * 提醒调用方这是**分发**耗时，不是真机可见延迟。
 */
export function sampleDispatchLatency<T>(action: string, run: () => T, sink?: DispatchSampleSink): T {
  const t0 = performance.now();
  try {
    return run();
  } finally {
    const latencyMs = performance.now() - t0;
    if (sink !== undefined) {
      sink({ action, latencyMs, scope: DISPATCH_LATENCY_SCOPE });
    }
  }
}

/**
 * 百分位（nearest-rank）：返回升序排列后第 `ceil(p/100 * n)` 个样本。
 * - `p` 会被钳到 `[0, 100]`；`p = 0` 返回最小值，`p = 100` 返回最大值；
 * - 空样本返回 `NaN`（如实标注「无样本」，不伪造 0）。
 */
export function percentile(samples: readonly number[], p: number): number {
  const n = samples.length;
  if (n === 0) return Number.NaN;
  const sorted = samples.slice().sort((a, b) => a - b);
  const clamped = p <= 0 ? 0 : p >= 100 ? 100 : p;
  const rank = Math.max(1, Math.ceil((clamped / 100) * n));
  return sorted[rank - 1];
}

export interface DispatchProbeReport {
  readonly scope: typeof DISPATCH_LATENCY_SCOPE;
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly p50: number;
  readonly p95: number;
  readonly median: number;
  readonly disclaimer: string;
}

export interface DispatchProbe {
  readonly scope: typeof DISPATCH_LATENCY_SCOPE;
  readonly count: number;
  /** 采样一次分发延迟（薄封装，便于测试与界面埋点复用） */
  sample<T>(action: string, run: () => T): T;
  samples(): readonly DispatchSample[];
  latencies(): readonly number[];
  percentile(p: number): number;
  report(): DispatchProbeReport;
  reset(): void;
}

/**
 * 创建一个独立的采样探针。每个探针自带样本缓冲，互不共享——
 * 避免把不同界面的延迟混成一个「看似漂亮」的总体分布。
 */
export function createDispatchProbe(): DispatchProbe {
  let samples: DispatchSample[] = [];
  const probe: DispatchProbe = {
    scope: DISPATCH_LATENCY_SCOPE,
    get count(): number {
      return samples.length;
    },
    sample<T>(action: string, run: () => T): T {
      return sampleDispatchLatency(action, run, (s) => {
        samples.push(s);
      });
    },
    samples(): readonly DispatchSample[] {
      return samples;
    },
    latencies(): readonly number[] {
      const out: number[] = [];
      for (let i = 0; i < samples.length; i++) out.push(samples[i].latencyMs);
      return out;
    },
    percentile(p: number): number {
      return percentile(
        samples.map((s) => s.latencyMs),
        p,
      );
    },
    report(): DispatchProbeReport {
      const lat = samples.map((s) => s.latencyMs);
      const sorted = lat.slice().sort((a, b) => a - b);
      return Object.freeze({
        scope: DISPATCH_LATENCY_SCOPE,
        count: lat.length,
        min: lat.length === 0 ? Number.NaN : sorted[0],
        max: lat.length === 0 ? Number.NaN : sorted[sorted.length - 1],
        p50: percentile(lat, 50),
        p95: percentile(lat, 95),
        median: percentile(lat, 50),
        disclaimer: DISPATCH_LATENCY_DISCLAIMER,
      });
    },
    reset(): void {
      samples = [];
    },
  };
  return probe;
}
