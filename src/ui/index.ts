/**
 * HC-01 · UI 层入口（S-07）
 *
 * 只导出 `src/ui/**`，**不改根 `src/index.ts`**（避免与并行进行的渲染层改造冲突）。
 * 应用侧（Cocos 场景树 / 预览页）从本文件取 UI 层能力：
 *
 * ```ts
 * const tokens = buildSemanticTokenMap(config.zoneTypes);
 * const controller = createInteractionController({ session: sim, tokens });
 * controller.select(4, 5);                                  // 通道 A 即时
 * const r = controller.advanceDay('day-1');                 // 通道 B 结算后
 * const view = compose(renderViewModel, controller.layer);  // 只读合成视图
 * ```
 *
 * 零依赖：不 import 引擎、不 import `tick-pipeline`、不读时钟（除 feedback-timing）。
 */

export * from './feedback-bus.ts';
export * from './optimistic-view.ts';
export * from './interaction-controller.ts';
export * from './motion-policy.ts';
export * from './feedback-timing.ts';
export * from './hud/index.ts';

// ---------------------------------------------------------------------------
// 层间契约的唯一落点（D-14）——**实现文件不得 import `Simulation`**
//
// `UiSessionPort`（定义在 `interaction-controller.ts`）是 UI 层对会话的唯一可见面；
// 真实的 `Simulation` 必须始终满足它，否则 UI 与内核会静默错位（本层 14 条交互用例
// 只证明「运行时兼容」，类型层没有断言）。此处把等价关系做成**编译期**断言：
// `Simulation` 签名一漂移（方法参数 / 返回值 / 计数器类型变化），`tsc --strict` 即红。
//
// 为什么放 barrel 而不是实现文件：
// ① 这是**层间承诺**（两层的边界），不是某个实现的细节；
// ② 让「知道外面有 `Simulation`」只发生在边界文件——实现文件保持看不见它，
//    避免后来的人因为「能 import 就用它的字段」而绕过端口（等于给真问题开后门）。
//
// 为什么用类型别名而不是 `const _x: Port = null as unknown as Simulation`：
// 零运行期语句、零 `as unknown as` 类型逃逸口，且错误信息**点名缺失属性**。
// （惯用法已在实现前用 tsc 实测：方向写反会报 TS2344 并指出 `Property 'x' is missing`。）
// ---------------------------------------------------------------------------
import type { Simulation } from '../simulation/session.ts';
import type { UiSessionPort } from './interaction-controller.ts';

/** `T` 必须可赋给 `U`（方向写反会报 TS2344） */
type AssertAssignable<T extends U, U> = T;

// 类型别名本身即断言，无需被引用（本项目无 linter + --strict 不含 noUnusedLocals）
type _SimulationSatisfiesUiSessionPort = AssertAssignable<Simulation, UiSessionPort>;
