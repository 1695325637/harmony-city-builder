/**
 * HC-01 · T-143 · 回退内核的静态纪律（SM-W4-04「代码库无任何逆运算路径」）
 *
 * 覆盖：
 * ① `src/simulation/**` 无逆运算 / 撤销算术实现（rollback.ts 零 budget 标识符、零复合赋值）；
 * ② 回退只经 `restore(` 反序列化（KEYFRAME 恢复），不重算模拟；
 * ③ D-03 契约不破：回退路径无二次幂等校验、无键集合读写；
 * ④ 平台 / 时钟 / 随机 / 渲染依赖零命中（零依赖口径）；
 * ⑤ 诚实口径留痕：真机未验证 / EX-03 / 不声称 D-2 达成；
 * ⑥ 版本头未改动（schemaVersion / configHash / engineVersion 常量与 schema.ts 未动）。
 *
 * 零依赖：Node 22 --experimental-strip-types + node:test。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { SCHEMA_VERSION, ENGINE_VERSION, createDefaultConfig, computeConfigHash } from '../../src/index.ts';

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

/** 去注释 + 去字符串（代码层静态扫描，避免注释里的反例说明误报） */
function stripNonCode(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  out = out.replace(/'(?:\\.|[^'\\\n])*'/g, "''");
  out = out.replace(/"(?:\\.|[^"\\\n])*"/g, '""');
  out = out.replace(/`(?:\\.|[^`\\])*`/g, '``');
  return out;
}

function simulationFiles(): string[] {
  return readdirSync(join(process.cwd(), 'src/simulation'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => 'src/simulation/' + f);
}

// ---------------------------------------------------------------------------
// ① 无逆运算
// ---------------------------------------------------------------------------

test('RT-1 SM-W4-04 无逆运算路径：rollback.ts 零 budget 标识符、零复合赋值', () => {
  const code = stripNonCode(read('src/simulation/rollback.ts'));
  // 回退不碰预算 / 不碰网格 —— 完全没有任何「加回去 / 减回去」的对象
  assert.equal(/\bbudget\b/.test(code), false, '回退内核不得触碰 budget（否则即为逆运算）');
  assert.equal(/[-+*/]=/.test(code), false, '不得出现任何复合赋值（+= / -= / *= / /=）');
  // cell 数组写：QA-R3 已钉死全库仅 6 处；回退内核必须零处
  assert.equal(/cells\.(zone|density|unlocked|region)\s*\[[^\]]*\]\s*=(?!=)/.test(code), false,
    '不得直接写 cells 数组');
  // 常见「撤销 / 逆推」命名
  for (const bad of [/\binverse\b/i, /\binvert\b/i, /\bundo\b/i, /\brevert\b/i, /\bbackout\b/i, /\bunapply\b/i]) {
    assert.equal(bad.test(code), false, '回退内核不得出现撤销 / 逆推实现：' + bad);
  }
  assert.equal(/\bframes\s*\./.test(code), false, '不得直接改写双帧（内容全部来自恢复态）');
});

test('RT-2 回退只经 restore 反序列化：不重算模拟、无求解器调用', () => {
  const code = stripNonCode(read('src/simulation/rollback.ts'));
  assert.ok(/\.restore\s*\(/.test(code), '必须经 store.restore( 反序列化 KEYFRAME');
  for (const banned of [/\brunTick\s*\(/, /\bsolveTraffic\s*\(/, /\badvanceDay\s*\(/,
    /\bcomputeBaselineS\s*\(/, /\baggregate\s*\(/, /\bcreateSimulation\s*\(/]) {
    assert.equal(banned.test(code), false, '回退路径不得重算模拟：' + banned);
  }
  // 只写三个「身份标签」（赋值，排除 === 比较），不写内容字段
  const identityWrites = (code.match(/\.(tickId|cycleId|cycleTickIndex)\s*=(?!=)/g) ?? []);
  assert.equal(identityWrites.length, 3, '仅重标 tickId / cycleId / cycleTickIndex 三个标签（实得 ' + identityWrites.length + '）');
});

test('RT-3 全 src/simulation 无逆运算命名（含既有文件）', () => {
  for (const f of simulationFiles()) {
    const code = stripNonCode(read(f));
    for (const bad of [/\binverse\b/i, /\binvert\b/i, /\bundo\b/i, /\brevert\b/i, /\bbackout\b/i]) {
      assert.equal(bad.test(code), false, f + ' 不得出现逆运算命名：' + bad);
    }
  }
});

// ---------------------------------------------------------------------------
// ③ D-03 契约不破
// ---------------------------------------------------------------------------

test('RT-4 D-03 契约不破：回退路径无二次幂等校验、无键集合读写', () => {
  const code = stripNonCode(read('src/simulation/rollback.ts'));
  for (const banned of [/\bseen\b/, /idempotencyKey/, /DUPLICATE/, /seenAdvanceKeys/, /CommandQueue/]) {
    assert.equal(banned.test(code), false, '回退内核不得下沉去重：' + banned);
  }
  const session = stripNonCode(read('src/simulation/session.ts'));
  // 去重仍在编排层（不得被搬走）
  assert.ok(/queue\.enqueue\(/.test(session), 'submit 仍委托 CommandQueue.enqueue');
  assert.ok(/seenAdvanceKeys/.test(session), 'ADVANCE 键集合仍在 session');
  // 回退入口委托 rollback 内核，且不加第二道校验
  assert.ok(/runCycleRetry\s*\(/.test(session), 'retryCycle 委托 rollback 内核');
  assert.equal(/idempotencyKey/.test(stripNonCode(read('src/simulation/rollback.ts'))), false,
    '内核仍不出现幂等键');
});

// ---------------------------------------------------------------------------
// ④ 零依赖 / 平台纪律
// ---------------------------------------------------------------------------

test('RT-5 零依赖：无 node: / 引擎 / 平台 / 渲染 import，无时钟 / 随机 / 定时器', () => {
  for (const f of ['src/simulation/rollback.ts', 'src/simulation/session.ts']) {
    const raw = read(f);
    assert.doesNotMatch(raw, /from\s+['"](?:node:|cocos|@ohos|@harmony|harmony|arkui|cc'|three|pixi)/i,
      f + ' 不得 import node: / 引擎 / 平台 / 渲染');
    const code = stripNonCode(raw);
    assert.equal(/Date\.now|new\s+Date\s*\(|performance\.now|process\.hrtime|Math\.random/.test(code), false,
      f + ' 不得读时钟 / 原生随机');
    assert.equal(/setInterval|setTimeout|requestAnimationFrame|autoPlay|autoplay/i.test(code), false,
      f + ' 不得出现定时器 / 自动播放');
  }
});

// ---------------------------------------------------------------------------
// ⑤ 诚实口径留痕
// ---------------------------------------------------------------------------

test('RT-6 诚实口径：真机未验证 / EX-03 / 不声称 D-2 达成（文档留痕）', () => {
  const src = read('src/simulation/rollback.ts');
  assert.ok(src.includes('EX-03'), '须标注真机半侧 EX-03 顺延');
  assert.ok(src.includes('未验证'), '须标注真机未验证');
  assert.ok(src.includes('不声称'), '须显式声明不声称 DoD D-2 达成');
  assert.ok(/D-2/.test(src), '须点名 DoD D-2 未判定');
  // 不得出现正面声称（与否定语境同句即可，这里只做禁词守卫）
  assert.equal(/已达标|已验证|真机实测|已达成断点/.test(src), false, '不得出现正面声称');
});

test('RT-8 cycleId 语义口径写死：回退后是「分支标签」≠「已玩周期数」（裁定 3）', () => {
  const src = read('src/simulation/rollback.ts');
  assert.ok(src.includes('分支标签'), 'rollback.ts 须显式标注 cycleId 是分支标签');
  assert.ok(src.includes('「已玩周期数」'), 'rollback.ts 须点名「已玩周期数」并否定之');
  assert.ok(/不等于|不是/.test(src), 'rollback.ts 须显式否定「已玩周期数」语义');
  assert.ok(/前进 2/.test(src), 'rollback.ts 须写明每次回退使其前进 2');
  assert.ok(/不得|不可/.test(src) && /周期序号|统计口径/.test(src),
    'rollback.ts 须警告下游不得当周期序号 / 统计口径');

  const doc = read('tests/verification/s11-rollback-verification.md');
  assert.ok(doc.includes('分支标签'), '自验记录须同步该口径');
  assert.ok(doc.includes('「已玩周期数」'), '自验记录须点名「已玩周期数」并否定之');
  assert.ok(/不等于|不是/.test(doc), '自验记录须显式否定「已玩周期数」语义');
  assert.ok(/前进 2/.test(doc), '自验记录须写明前进 2');
});

// ---------------------------------------------------------------------------
// ⑥ 版本头未改动
// ---------------------------------------------------------------------------

test('RT-7 版本头 / 配置兼容位未被改动（禁改版本头约束）', () => {
  assert.equal(SCHEMA_VERSION, 'HC01-SCHEMA-1', 'schemaVersion 未改');
  assert.equal(ENGINE_VERSION, 'HC01-CORE-0.1.0', 'engineVersion 未改');
  const config = createDefaultConfig();
  assert.equal(config.unlockedSide, 16, 'config.unlockedSide 未改（属 configHash）');
  assert.equal(computeConfigHash(config), computeConfigHash(createDefaultConfig()), '默认 configHash 稳定');
  // schema.ts 未新增回退相关导出（版本头单一来源）
  const schema = read('src/core/schema.ts');
  assert.equal(/rollback/i.test(schema), false, 'schema.ts 不得被回退逻辑污染');
  assert.equal(/SCHEMA_VERSION\s*=/.test(schema), false, 'schema.ts 不得重定义 SCHEMA_VERSION');
});
