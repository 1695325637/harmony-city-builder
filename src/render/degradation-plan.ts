/**
 * HC-01 · 渲染层 · `architecture.md §10.4` 降级顺序的**可执行契约**（S-12 验收 3）
 *
 * 上游原文（§10.4，逐字对齐，不新增也不删步）：
 *   「预算不达标时按序降级：天气粒子 / 雨雪 → 夜间窗光 / 接触 AO → VFX 粒子数量
 *     → 更早进入 L0 表现 → 低性能档关闭全部 VFX。**禁止降级**：§9.2 可访问性
 *    （语义令牌 / 图案层 / 形状编码 / 热区 / 文本缩放 / 静态校验）
 *    与 <100ms 即时反馈（美术圣经 D-8）。」
 *
 * 本模块是**纯声明 + 纯断言**（无副作用、无引擎依赖、无时钟、无随机、零 hex 色值、
 * 不 import simulation）。它不执行降级，只把「顺序」和「禁止触碰」变成可断言的数据，
 * 供质量侧门禁与将来真实渲染组合点共同消费。
 *
 * ⚠️ 口径边界（与 a11y 断言层同款）：本模块通过 ≠ 真机降级顺序已验证。
 * 它证明的是「契约数据与 §10.4 一致、且任何触碰受保护能力的改动会被断言拦住」；
 * 真机上粒子/窗光是否真按此序关闭，须按校准手册实测（EX-03 阻塞项）。
 */

/** §10.4 五步，顺序即语义；不得重排、不得跳步。 */
export type DegradationStepId =
  | 'weatherParticles'
  | 'nightWindowAO'
  | 'vfxParticleCount'
  | 'earlyL0'
  | 'disableAllVfx';

export interface DegradationStep {
  readonly id: DegradationStepId;
  /** §10.4 原文的中文步名（供报告与报错可读） */
  readonly label: string;
  /**
   * 该步关闭的能力名。**只允许表现层能力**，禁止出现任何 `PROTECTED_CAPABILITIES`。
   * 这是 `assertDegradationPlan` 的判定输入——不是注释，是可被扫描的数据。
   */
  readonly disables: readonly string[];
}

/** §10.4 五步降级序列（唯一真源；低档关闭全部 VFX 为第 5 步）。 */
export const DEGRADATION_ORDER: readonly DegradationStep[] = Object.freeze([
  Object.freeze({
    id: 'weatherParticles',
    label: '天气粒子 / 雨雪',
    disables: Object.freeze(['weather.particles', 'weather.rainSnow']),
  }),
  Object.freeze({
    id: 'nightWindowAO',
    label: '夜间窗光 / 接触 AO',
    disables: Object.freeze(['lighting.nightWindow', 'lighting.contactAO']),
  }),
  Object.freeze({
    id: 'vfxParticleCount',
    label: 'VFX 粒子数量',
    disables: Object.freeze(['vfx.particleBudget']),
  }),
  Object.freeze({
    id: 'earlyL0',
    label: '更早进入 L0 表现',
    disables: Object.freeze(['lod.l1Detail', 'lod.l2Detail']),
  }),
  Object.freeze({
    id: 'disableAllVfx',
    label: '低性能档关闭全部 VFX',
    disables: Object.freeze(['vfx.all']),
  }),
]);

/** §9.2 可访问性 6 项 + <100ms 即时反馈（美术圣经 D-8 / 评审门 G6 否决项）。 */
export type ProtectedCapabilityId =
  | 'semanticTokens'
  | 'patternLayer'
  | 'shapeEncoding'
  | 'tapTarget'
  | 'textScale'
  | 'staticCheck'
  | 'immediateFeedback100ms';

export const PROTECTED_CAPABILITIES: readonly ProtectedCapabilityId[] = Object.freeze([
  'semanticTokens',
  'patternLayer',
  'shapeEncoding',
  'tapTarget',
  'textScale',
  'staticCheck',
  'immediateFeedback100ms',
]);

export interface DegradationPlan {
  /** 已应用的降级步数 0..5（0 = 无降级，5 = 低性能档全关 VFX） */
  readonly level: number;
  /** 已应用的步 id，必须是 `DEGRADATION_ORDER` 的**前缀** */
  readonly steps: readonly DegradationStepId[];
  /** 受保护能力在任何 level 下都必须保持启用 */
  readonly protectedState: Readonly<Record<ProtectedCapabilityId, boolean>>;
}

/** 构造一份按 §10.4 顺序应用前 `level` 步的计划。 */
export function buildDegradationPlan(level: number): DegradationPlan {
  if (!Number.isInteger(level) || level < 0 || level > DEGRADATION_ORDER.length) {
    throw new Error('降级 level 必须是 0..' + DEGRADATION_ORDER.length + ' 的整数，实得 ' + level);
  }
  const protectedState = {} as Record<ProtectedCapabilityId, boolean>;
  for (const id of PROTECTED_CAPABILITIES) protectedState[id] = true;
  return Object.freeze({
    level,
    steps: Object.freeze(DEGRADATION_ORDER.slice(0, level).map((s) => s.id)),
    protectedState: Object.freeze(protectedState),
  });
}

/**
 * 断言一份降级计划符合 §10.4 + G6 否决项。
 *
 * **有牙齿**：这是对**任意输入**都可判的断言器，不是自证。调用方可以（测试里也确实会）
 * 构造乱序 / 跳步 / 触碰受保护能力 / 关掉即时反馈的假计划，本函数必须抛错。
 * 构造器 `buildDegradationPlan` 恒返回合法计划这件事，由单测另行逐项钉死。
 */
export function assertDegradationPlan(plan: DegradationPlan): void {
  if (!Number.isInteger(plan.level) || plan.level < 0 || plan.level > DEGRADATION_ORDER.length) {
    throw new Error('降级 level 越界：' + plan.level);
  }
  const expected = DEGRADATION_ORDER.slice(0, plan.level).map((s) => s.id);
  if (plan.steps.length !== expected.length) {
    throw new Error('降级步数与 level 不符：steps=' + plan.steps.length + ' level=' + plan.level);
  }
  for (let i = 0; i < expected.length; i++) {
    if (plan.steps[i] !== expected[i]) {
      throw new Error(
        '降级顺序违反 §10.4：第 ' + (i + 1) + ' 步应为 ' + expected[i] +
        '，实得 ' + plan.steps[i] + '（不得跳步 / 重排 / 提前进入 L0）',
      );
    }
  }
  // 禁止降级项：每一步关闭的能力都不得命中受保护集合
  for (let i = 0; i < plan.level; i++) {
    const step = DEGRADATION_ORDER[i];
    for (const disabled of step.disables) {
      if ((PROTECTED_CAPABILITIES as readonly string[]).includes(disabled)) {
        throw new Error('§10.4 禁止降级项被第 ' + (i + 1) + ' 步关闭：' + disabled);
      }
    }
  }
  for (const id of PROTECTED_CAPABILITIES) {
    if (plan.protectedState[id] !== true) {
      throw new Error('受保护能力在任何降级档位下都必须保持启用，' + id + ' 被关闭（G6 否决项）');
    }
  }
}
