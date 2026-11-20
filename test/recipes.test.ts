import { describe, it, expect } from 'vitest';
import { expandComb, planBirdNest, planPeacock, planTurkishStone } from '../src/engine/recipes';
import type { CombOp } from '../src/engine/types';
import { mulberry32 } from '../src/engine/rng';

function baseComb(over: Partial<CombOp> = {}): CombOp {
  return {
    kind: 'comb',
    id: 'c1',
    seq: 1,
    tool: 'multi',
    start: { x: 0, y: -50 },
    end: { x: 0, y: 50 },
    toothLength: 80,
    toothWidth: 4,
    strength: 3,
    spacing: 8,
    teethCount: 5,
    wavyAmplitude: 0,
    wavyWavelength: 0,
    passes: 1,
    phase: 0,
    ...over,
  };
}

describe('梳齿展开', () => {
  it('多齿梳展开段数 = 齿数 × 来回次数', () => {
    const segs = expandComb(baseComb({ teethCount: 5, passes: 2 }));
    expect(segs).toHaveLength(10);
  });

  it('单齿梳只产生一段', () => {
    const segs = expandComb(baseComb({ tool: 'single', teethCount: 1 }));
    expect(segs).toHaveLength(1);
  });

  it('来回第二次强度取反、几何位置相同', () => {
    const segs = expandComb(baseComb({ teethCount: 1, passes: 2 }));
    expect(segs[0].strength).toBeCloseTo(3, 10);
    expect(segs[1].strength).toBeCloseTo(-3, 10);
    expect(segs[0].ax).toBeCloseTo(segs[1].ax, 10);
  });

  it('波浪梳细分为多段且总数随来回翻倍', () => {
    const op = baseComb({
      tool: 'wavy',
      teethCount: 1,
      wavyAmplitude: 10,
      wavyWavelength: 20,
      passes: 1,
      phase: 1.2,
    });
    const once = expandComb(op);
    expect(once.length).toBeGreaterThanOrEqual(8);
    const twice = expandComb({ ...op, passes: 2 });
    expect(twice.length).toBe(once.length * 2);
  });

  it('相同参数展开结果逐位一致（确定性）', () => {
    const op = baseComb({ phase: 0.7 });
    expect(expandComb(op)).toEqual(expandComb(op));
  });
});

describe('经典纹样配方', () => {
  const ctx = { widthMm: 300, heightMm: 400, paletteIds: ['a', 'b', 'c'], seed: 42 };

  it('鸟巢纹生成指定滴数且每滴半径递减', () => {
    const plan = planBirdNest(ctx, 30);
    expect(plan.drops).toHaveLength(30);
    for (const d of plan.drops) {
      for (let i = 1; i < d.radii.length; i++) expect(d.radii[i]).toBeLessThan(d.radii[i - 1]);
    }
  });

  it('孔雀纹带收束梳工序', () => {
    const plan = planPeacock(ctx);
    expect(plan.combo?.tool).toBe('single');
    expect(plan.drops.length).toBeGreaterThan(1);
  });

  it('土耳其石纹使用多齿梳且来回 2 次', () => {
    const plan = planTurkishStone(ctx);
    expect(plan.combo?.tool).toBe('multi');
    expect(plan.combo?.passes).toBe(2);
  });

  it('同种子配方完全一致', () => {
    const a = planBirdNest(ctx, 20);
    const b = planBirdNest(ctx, 20);
    expect(a).toEqual(b);
  });

  it('mulberry32 序列确定', () => {
    const r1 = mulberry32(123)();
    const r2 = mulberry32(123)();
    expect(r1).toBe(r2);
  });
});
