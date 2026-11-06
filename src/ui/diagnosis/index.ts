/**
 * HC-01 · UI 层 · S-09 诊断数据层入口（第一批 A 线 · 自查自出口）
 *
 * 「自查自出口」两层含义：
 * ① **自出口**：本文件只 re-export `src/ui/diagnosis/**`，不挂到 `src/ui/index.ts`
 *    （后者属 B 线红线文件，本批禁止触碰）。应用侧 / 第二批 L2 面板从本文件取用：
 *
 * ```ts
 * const vm = queryDiagnosis(store, tickId);          // 单 tick，只读
 * const chain = queryCycleRange(store, 0, 2);        // 跨 2~3 周期完整归因链
 * vm.setLayer('L2');                                 // 单值切换，同屏 ≤1 面板
 * ```
 *
 * ② **自查**：下方编译期断言把「结构化只读端口」与真实 `SnapshotStore` 的兼容性
 *    做成 tsc 可检查的承诺（仿 D-14，纯 `import type`，零运行期依赖、零类型逃逸）。
 *    若模拟层端口形状漂移（get / getCycleRange 签名或 TickSnapshot 字段变化），
 *    `tsc --strict` 立刻变红，而不是等诊断面板在运行时静默错位。
 *
 * 零依赖：不 import 引擎、不 import `node:`、不 import 结算内核、不读时钟。
 * 本层只读汇聚 `TickSnapshot.delta` + `attribution`，绝不重算模拟、绝不写回状态。
 */

export * from './types.ts';
export * from './diagnosis-query.ts';

// ---------------------------------------------------------------------------
// 层间端口兼容性的唯一落点（自查）——**实现文件不得 import 模拟层实现**
//
// `DiagnosisSnapshotSource`（定义在 types.ts）是本层对存储的唯一可见面：只有两个
// 只读方法，没有 put / submit / state。真实 `SnapshotStore` 由结构化类型满足它。
// 这里把等价关系做成**编译期**断言：端口一漂移，`tsc --strict` 即红（TS2344 点名）。
//
// 为什么放 barrel 而不是实现文件：实现文件保持「看不见模拟层」，避免后来的人因为
// 「能 import 就用它的字段」而绕过只读端口（等于给写回开后门）。
// ---------------------------------------------------------------------------
import type { SnapshotStore } from '../../simulation/snapshot.ts';
import type { DiagnosisSnapshotSource } from './types.ts';

/** `T` 必须可赋给 `U`（方向写反会报 TS2344） */
type AssertAssignable<T extends U, U> = T;

// 类型别名本身即断言，无需被引用（本项目无 linter + --strict 不含 noUnusedLocals）
type _SnapshotStoreSatisfiesDiagnosisPort = AssertAssignable<SnapshotStore, DiagnosisSnapshotSource>;
