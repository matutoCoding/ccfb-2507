import type { CombOp, StrokeSeg, Vec2 } from './types';
import { mulberry32 } from './rng';

/**
 * 梳齿工序展开。
 * 记录的是高级参数（工具、齿距、波浪、来回次数），渲染与重放时统一调用
 * 本纯函数展开为直线齿痕。CPU 与 GPU 看到的是同一份展开结果，
 * 不依赖任何运行时状态（波浪相位存在工序里），因此可逐位复现。
 */
export function expandComb(op: CombOp): StrokeSeg[] {
  const dir = norm(sub(op.end, op.start));
  // 齿长方向：行进方向逆时针 90°
  const toothDir: Vec2 = { x: -dir.y, y: dir.x };
  const pathLen = dist(op.start, op.end);
  const segs: StrokeSeg[] = [];

  const pushStroke = (a: Vec2, b: Vec2, sign: number) => {
    // 来回次数：反向 pass 强度取反（位移方向相反），位置相同
    const s = op.strength * sign;
    if (Math.abs(s) < 1e-6) return;
    segs.push({
      ax: a.x,
      ay: a.y,
      bx: b.x,
      by: b.y,
      width: op.toothWidth,
      strength: s,
    });
  };

  const half = op.toothLength / 2;

  if (op.tool === 'wavy') {
    // 波浪梳：单齿沿正弦曲线行走，按波长细分为短直线段
    const waveCount = Math.max(1, Math.ceil(pathLen / Math.max(op.wavyWavelength, 1e-3)));
    const subdivs = Math.max(8, waveCount * 12);
    const pointAt = (t: number): Vec2 => {
      const along = t * pathLen;
      const off =
        op.wavyAmplitude * Math.sin((along / Math.max(op.wavyWavelength, 1e-3)) * Math.PI * 2 + op.phase);
      return {
        x: op.start.x + dir.x * along + toothDir.x * off,
        y: op.start.y + dir.y * along + toothDir.y * off,
      };
    };
    for (let pass = 0; pass < op.passes; pass++) {
      const sign = pass % 2 === 0 ? 1 : -1;
      // 反向 pass 从终点往起点梳，逐段方向反转、强度取反，几何段保持一致
      for (let i = 0; i < subdivs; i++) {
        const t0 = i / subdivs;
        const t1 = (i + 1) / subdivs;
        const p0 = pass % 2 === 0 ? pointAt(t0) : pointAt(t1);
        const p1 = pass % 2 === 0 ? pointAt(t1) : pointAt(t0);
        const a = { x: p0.x + toothDir.x * half, y: p0.y + toothDir.y * half };
        const b = { x: p1.x + toothDir.x * half, y: p1.y + toothDir.y * half };
        pushStroke(a, b, sign);
      }
    }
    return segs;
  }

  // 单齿 / 多齿：各齿沿行进方向平移 toothSpacing
  const teeth = op.tool === 'single' ? 1 : Math.max(1, op.teethCount);
  const centers: Vec2[] = [];
  for (let k = 0; k < teeth; k++) {
    const offset = (k - (teeth - 1) / 2) * op.spacing;
    centers.push({
      x: op.start.x + dir.x * offset,
      y: op.start.y + dir.y * offset,
    });
  }
  for (let pass = 0; pass < op.passes; pass++) {
    const sign = pass % 2 === 0 ? 1 : -1;
    for (const c of centers) {
      const cEnd = { x: c.x + dir.x * pathLen, y: c.y + dir.y * pathLen };
      const a = { x: c.x + toothDir.x * half, y: c.y + toothDir.y * half };
      const b = { x: cEnd.x + toothDir.x * half, y: cEnd.y + toothDir.y * half };
      pushStroke(a, b, sign);
    }
  }
  return segs;
}

/**
 * 经典纹样配方。按真实浮染工序组织，返回的操作在录制时按顺序执行；
 * 随机量通过固定种子生成，因此同一配方的"基础版"每次完全一致，
 * 用户随后可以在操作台上继续加滴、加梳。
 */
export interface RecipeContext {
  widthMm: number;
  heightMm: number;
  paletteIds: string[];
  seed: number;
}

export interface PlannedDrop {
  x: number;
  y: number;
  /** 各环半径（mm），由颜料扩散性与滴数共同决定 */
  radii: number[];
  pigmentCycle: string[];
}

export interface RecipePlan {
  drops: PlannedDrop[];
  /** 配方结束后建议执行的梳齿（如孔雀纹的收束梳） */
  combo?: Omit<CombOp, 'id' | 'seq'>;
}

/** 鸟巢纹（hatip/karalama）：满版交替滴墨后不梳，靠层层外推形成同心嵌套 */
export function planBirdNest(ctx: RecipeContext, dropCount = 46): RecipePlan {
  const rnd = mulberry32(ctx.seed);
  const drops: PlannedDrop[] = [];
  const base = Math.min(ctx.widthMm, ctx.heightMm) * 0.16;
  for (let i = 0; i < dropCount; i++) {
    const x = (rnd() - 0.5) * ctx.widthMm * 0.5;
    const y = (rnd() - 0.5) * ctx.heightMm * 0.5;
    const ringN = 2 + Math.floor(rnd() * 3);
    const radii: number[] = [];
    let r = base * (0.5 + rnd() * 0.5);
    for (let k = 0; k < ringN; k++) {
      radii.push(r);
      r *= 0.62 + rnd() * 0.1;
    }
    const start = i % ctx.paletteIds.length;
    drops.push({
      x,
      y,
      radii,
      pigmentCycle: ctx.paletteIds.map((_, j) => ctx.paletteIds[(start + j) % ctx.paletteIds.length]),
    });
  }
  return { drops };
}

/** 孔雀纹（peacock / yalova）：多色环大墨滴排成一列，再用单齿梳横向拉出羽枝 */
export function planPeacock(ctx: RecipeContext): RecipePlan {
  const rnd = mulberry32(ctx.seed);
  const drops: PlannedDrop[] = [];
  const cols = Math.max(3, Math.floor(ctx.widthMm / 55));
  const rows = Math.max(2, Math.floor(ctx.heightMm / 70));
  const big = Math.min(ctx.widthMm, ctx.heightMm) * 0.11;
  let i = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -ctx.widthMm / 2 + ((c + 0.5) / cols) * ctx.widthMm + (rnd() - 0.5) * 6;
      const y = -ctx.heightMm / 2 + ((r + 0.5) / rows) * ctx.heightMm + (rnd() - 0.5) * 6;
      const radii: number[] = [];
      let rr = big * (0.9 + rnd() * 0.2);
      for (let k = 0; k < ctx.paletteIds.length; k++) {
        radii.push(rr);
        rr *= 0.72;
      }
      const start = i % ctx.paletteIds.length;
      drops.push({
        x,
        y,
        radii,
        pigmentCycle: ctx.paletteIds.map((_, j) => ctx.paletteIds[(start + j) % ctx.paletteIds.length]),
      });
      i++;
    }
  }
  const combo: RecipePlan['combo'] = {
    kind: 'comb',
    tool: 'single',
    start: { x: -ctx.widthMm / 2 + 4, y: 0 },
    end: { x: ctx.widthMm / 2 - 4, y: 0 },
    toothLength: ctx.heightMm * 0.92,
    toothWidth: 9,
    strength: 6,
    spacing: 0,
    teethCount: 1,
    wavyAmplitude: 0,
    wavyWavelength: 0,
    passes: 1,
    phase: 0,
  };
  return { drops, combo };
}

/** 土耳其石纹（gel-git / türkmen taşı）：多齿梳来回走，形成细密平行纹带 */
export function planTurkishStone(ctx: RecipeContext): RecipePlan {
  const base = planBirdNest(ctx, 28);
  const combo: RecipePlan['combo'] = {
    kind: 'comb',
    tool: 'multi',
    start: { x: 0, y: -ctx.heightMm / 2 + 4 },
    end: { x: 0, y: ctx.heightMm / 2 - 4 },
    toothLength: ctx.widthMm * 0.85,
    toothWidth: 3.2,
    strength: 2.4,
    spacing: 7,
    teethCount: Math.max(6, Math.floor((ctx.widthMm * 0.85) / 7)),
    wavyAmplitude: 0,
    wavyWavelength: 0,
    passes: 2,
    phase: 0,
  };
  return { ...base, combo };
}

/** 波浪梳纹（taraklı）：满版底墨 + 波浪梳收尾 */
export function planWavyComb(ctx: RecipeContext): RecipePlan {
  const base = planBirdNest(ctx, 20);
  const combo: RecipePlan['combo'] = {
    kind: 'comb',
    tool: 'wavy',
    start: { x: -ctx.widthMm / 2 + 4, y: 0 },
    end: { x: ctx.widthMm / 2 - 4, y: 0 },
    toothLength: ctx.heightMm * 0.9,
    toothWidth: 5,
    strength: 3.2,
    spacing: 0,
    teethCount: 1,
    wavyAmplitude: 10,
    wavyWavelength: 36,
    passes: 1,
    phase: mulberry32(ctx.seed ^ 0x9e3779b9)() * Math.PI * 2,
  };
  return { ...base, combo };
}

export const RECIPES = [
  { id: 'bird-nest', name: '鸟巢纹', build: planBirdNest, desc: '满版交替滴墨，层层外推的同心嵌套，不梳' },
  { id: 'peacock', name: '孔雀纹', build: planPeacock, desc: '多色环大墨滴成列，单齿梳横向拉出羽枝' },
  { id: 'turkish-stone', name: '土耳其石纹', build: planTurkishStone, desc: '底墨后多齿梳来回走，细密平行纹带' },
  { id: 'wavy-comb', name: '波浪梳纹', build: planWavyComb, desc: '底墨后波浪梳收尾，行云流水纹' },
] as const;

// ---- 小向量工具（与 GLSL 实现保持同名同义） ----
function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}
function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}
function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
