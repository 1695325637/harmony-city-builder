/**
 * HC-01 · S-06 渲染内核 · 只读视图模型单测
 *
 * 覆盖：buildViewModel 只读指纹不变（ADR-004 §2）、零拷贝引用、结构冻结、
 * diffViewModel 正确性（inputVersion 优先 + zone/density/unlocked 兜底）、
 * `src/render/` 无写 state 路径 / 无 'cc' 依赖 / 无墙上时钟（静态扫描）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  canonicalize,
  createDefaultConfig,
  createInitialState,
  createTickWorkspace,
  deserializeState,
  makeCommand,
  runTick,
  serializeState,
  zoneIndex,
  buildViewModel,
  diffViewModel,
  isViewModelFrozen,
  cellIndexToGrid,
} from '../../src/index.ts';

function freshState() {
  const config = createDefaultConfig();
  const state = createInitialState(config);
  return { config, state };
}

test('VM-1 buildViewModel 只读：调用前后状态指纹逐字节不变', () => {
  const { state } = freshState();
  const before = canonicalize(state);
  const vm = buildViewModel(state);
  const after = canonicalize(state);
  assert.equal(after, before, 'buildViewModel 不得改动权威状态（ADR-004 §2）');
  assert.equal(vm.fingerprint, before, 'VM 指纹 = 构建时状态指纹');
  // 连续构建两次仍不变
  buildViewModel(state);
  assert.equal(canonicalize(state), before);
});

test('VM-2 零拷贝：cells 视图与状态共享同一 TypedArray 引用（仅变更戳快照为拷贝）', () => {
  const { state } = freshState();
  const vm = buildViewModel(state);
  assert.equal(vm.cells.zone, state.cells.zone);
  assert.equal(vm.cells.density, state.cells.density);
  assert.equal(vm.cells.unlocked, state.cells.unlocked);
  assert.equal(vm.cells.region, state.cells.region);
  assert.equal(vm.cells.inputVersion, state.cells.inputVersion);
  // 唯一复制项：变更戳（4KB Uint32），否则相邻 tick 复用 stateScratch 时 diff 恒为空
  assert.notEqual(vm.changeStamp, state.cells.inputVersion, 'changeStamp 是快照拷贝而非引用');
  assert.deepEqual(Array.from(vm.changeStamp), Array.from(state.cells.inputVersion));
  assert.equal(vm.changeStamp.byteLength, state.side * state.side * 4, '快照大小 = 1024 × 4B');
});

test('VM-3 结构冻结：VM 与嵌套视图 Object.freeze（写入即抛错）', () => {
  const { state } = freshState();
  const vm = buildViewModel(state);
  assert.ok(isViewModelFrozen(vm), 'VM 及其嵌套视图均已冻结');
  assert.throws(() => {
    (vm as unknown as { side: number }).side = 99;
  }, TypeError, '冻结后写属性抛 TypeError（ESM 严格模式）');
  assert.throws(() => {
    (vm.cells as unknown as { zone: Uint8Array }).zone = new Uint8Array(1);
  }, TypeError);
});

test('VM-4 diffViewModel 兜底：不同 state 对象（版本未 bump）时按 zone/density/unlocked 检出', () => {
  const { config, state } = freshState();
  const before = buildViewModel(state);
  // 另一份 state（底层数组不同——真实场景为跨序列化 / 回放加载）
  const other = deserializeState(JSON.parse(JSON.stringify(serializeState(state))), config);
  const i = 4 * state.side + 3;
  other.cells.zone[i] = zoneIndex(config, 'R');
  other.cells.density[i] = 2;
  const after = buildViewModel(other);
  const changed = diffViewModel(before, after);
  assert.deepEqual(changed, [i], '仅该格被标记重绘（兜底比对 zone/density）');
  assert.deepEqual(cellIndexToGrid(state.side, changed[0]), { gx: 3, gy: 4 });
});

test('VM-4b 契约：同一 state 就地改写且不 bump inputVersion → diff 不检出（内核 P1 必 bump）', () => {
  const { config, state } = freshState();
  const before = buildViewModel(state);
  const i = 4 * state.side + 3;
  state.cells.zone[i] = zoneIndex(config, 'R'); // 故意不 bump
  const after = buildViewModel(state);
  assert.deepEqual(diffViewModel(before, after), [], '版本戳未变 + 同底层数组 → 无差异（显式契约，非缺陷）');
  // 补上 P1 契约该做的 bump 后立即可检出
  state.cells.inputVersion[i] += 1;
  const after2 = buildViewModel(state);
  assert.deepEqual(diffViewModel(after, after2), [i]);
});

test('VM-6 diffViewModel：无变化返回空、side 变化返回全量', () => {
  const { state } = freshState();
  const a = buildViewModel(state);
  const b = buildViewModel(state);
  assert.deepEqual(diffViewModel(a, b), [], '同一状态两次投影：零差异');
  // side 变化（构造一个 side 不同的 VM 视图）
  const wide = { ...b, side: b.side + 1 };
  const all = diffViewModel(a, wide as unknown as typeof b);
  assert.equal(all.length, wide.side * wide.side, 'side 变化按全量重绘处理');
});

test('VM-7 结算后 diff 只命中真实变化格（runTick 集成路径）', () => {
  const { config, state } = freshState();
  const ws = createTickWorkspace(config, state.side);
  const before = buildViewModel(state);
  const r = runTick(state, [makeCommand.zone('vm-z1', 1, 3, 5, 'R', 2), makeCommand.advance('vm-a1', 2)], config, ws);
  const after = buildViewModel(r.state);
  const changed = diffViewModel(before, after);
  const target = 5 * state.side + 3;
  assert.ok(changed.indexOf(target) >= 0, '被分区写入的格必须出现在差异集中');
  // 其余格未被误标（除目标格外差异集应为空）
  for (const idx of changed) assert.equal(idx, target, '仅目标格变化');
});

test('VM-8 静态纪律：src/render 无写 state 路径、无 cc 导入、无时钟随机（D-06 扩展绕过面）', () => {
  const root = join(process.cwd(), 'src', 'render');
  const files = readdirSync(root, { recursive: true })
    .map((f) => String(f))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => join(root, f));
  assert.ok(files.length >= 9, '扫描到 render 源文件（实际 ' + files.length + '）');
  const banned: { name: string; re: RegExp }[] = [
    { name: '写 cells 数组（下标）', re: /\.cells\.(zone|density|unlocked|region|inputVersion)\s*\[[^\]]*\]\s*=(?!=)/ },
    { name: '写 cells 数组（.set / .fill）', re: /\.cells\.(zone|density|unlocked|region|inputVersion)\s*\.\s*(set|fill)\s*\(/ },
    { name: 'Object.assign 写 state / cells', re: /Object\.assign\s*\(\s*(?:state|cells)/ },
    { name: '整体替换 state 引用', re: /(?<![\w.])state\s*=(?!=)/ },
    { name: '写 state 标量', re: /state\.(tickId|cycleId|cycleTickIndex|issueCount|unlockedRegions|side|seed|configHash)\s*=(?!=)/ },
    { name: '写 state.budget', re: /state\.budget\.\w+\s*=(?!=)/ },
    { name: '写 state.frames', re: /state\.frames\.(prev|current)\.\w+\s*=(?!=)/ },
    { name: "静态 import 'cc' / '@ohos'", re: /^[ \t]*import[^\n]*from[ \t]*['"](?:cc|@ohos|@harmony)[^'"]*['"]/m },
    { name: '动态 import / require 引擎', re: /(?:import|require)\s*\(\s*['"](?:cc|@ohos|@harmony)[^'"]*['"]\s*\)/ },
    { name: '墙上时钟 / 性能计时', re: /Date\.now|performance\.now|process\.hrtime/ },
    { name: '原生随机', re: /Math\.random/ },
    { name: '越层依赖 simulation', re: /from\s+['"][^'"]*\/simulation\// },
  ];
  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const b of banned) {
      assert.equal(b.re.test(src), false, file + ' 命中禁令：' + b.name);
    }
  }
});

/** 去注释（仅用于静态扫描，避免文档里的反例描述被误判） */
function stripComments(input: string): string {
  return input.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
