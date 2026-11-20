import { describe, it, expect } from 'vitest';
import { traceDropInv, traceStrokeInv, tracePoint } from '../src/engine/trace';
import type { DropOp, StrokeSeg } from '../src/engine/types';

function drop(overrides: Partial<DropOp> = {}): DropOp {
  return {
    kind: 'drop',
    id: 'd',
    seq: 1,
    x: 0,
    y: 0,
    rings: [
      { pigmentId: 'a', outerRadius: 10 },
      { pigmentId: 'b', outerRadius: 6 },
      { pigmentId: 'c', outerRadius: 3 },
    ],
    ...overrides,
  };
}

describe('滴墨面积守恒变换', () => {
  const d = drop();

  it('盘内点命中最内层对应色环', () => {
    const r = traceDropInv(0, 2, d, 0);
    expect(r.hit).not.toBeNull();
    expect(r.hit!.ringIndex).toBe(2);
    expect(r.hit!.dropIndex).toBe(0);
  });

  it('中间半径命中对应环', () => {
    const r = traceDropInv(7, 0, d, 0);
    expect(r.hit!.ringIndex).toBe(0);
    const r2 = traceDropInv(5, 0, d, 0);
    expect(r2.hit!.ringIndex).toBe(1);
  });

  it('盘外点满足逆映射 ρ = √(ρ′² − r²)', () => {
    const r = traceDropInv(15, 0, d, 0);
    expect(r.hit).toBeNull();
    expect(r.x).toBeCloseTo(Math.sqrt(15 * 15 - 10 * 10), 10);
  });

  it('正反映射复合为恒等（雅可比面积守恒的数值验证）', () => {
    // 正映射: ρ' = √(ρ²+r²)；逆映射后应还原
    const outer = 10;
    for (const rho of [10.01, 12, 20, 50]) {
      const rhoFwd = Math.sqrt(rho * rho + outer * outer);
      const back = Math.sqrt(rhoFwd * rhoFwd - outer * outer);
      expect(back).toBeCloseTo(rho, 10);
    }
  });

  it('环面积守恒：外推前后相邻粒子间距保持面积比例', () => {
    // 数值雅可比：映射 f(ρ)=√(ρ²+r²) 的极坐标面积元 |det J| = (ρ'/ρ)·(dρ'/dρ) 恒为 1
    const r = 10;
    const f = (rho: number) => Math.sqrt(rho * rho + r * r);
    for (const rho of [10.1, 14, 30]) {
      const eps = 1e-5;
      const dRho = (f(rho + eps) - f(rho - eps)) / (2 * eps);
      const jac = (f(rho) / rho) * dRho;
      expect(jac).toBeCloseTo(1, 6);
    }
  });

  it('偏移滴墨的盘外点方向不变', () => {
    const d2 = drop({ x: 5, y: 5 });
    const r = traceDropInv(5, 20, d2, 0);
    const dx = r.x - 5;
    const dy = r.y - 5;
    expect(Math.atan2(dy, dx)).toBeCloseTo(Math.atan2(15, 0), 10);
  });
});

describe('齿痕逆映射', () => {
  const seg: StrokeSeg = { ax: -50, ay: 0, bx: 50, by: 0, width: 8, strength: 5 };

  it('齿痕外（垂直距离远）位移趋近 0', () => {
    const r = traceStrokeInv(0, 80, seg);
    expect(r.x).toBeCloseTo(0, 4);
    expect(r.y).toBeCloseTo(80, 4);
  });

  it('逆映射复合正映射还原（一维单调求逆正确性）', () => {
    const L = 100;
    const w = 8;
    const s = 5;
    const bump = (t: number) => {
      const h = t * t * (3 - 2 * t);
      return 4 * h * (1 - h);
    };
    // 取 v=0 的线上若干点，正映射后逆映射，应还原
    for (const u0 of [-40, -10, 0, 10, 40]) {
      const v = 0;
      const t0 = (u0 + 50) / L;
      const uFwd = u0 + s * Math.exp(-(v * v) / (w * w)) * bump(t0);
      const back = traceStrokeInv(uFwd, v, seg);
      expect(back.x).toBeCloseTo(u0, 3);
      expect(back.y).toBeCloseTo(v, 3);
    }
  });

  it('反向齿痕（strength<0）同样可正确求逆', () => {
    const neg: StrokeSeg = { ...seg, strength: -5 };
    const L = 100;
    const bump = (t: number) => {
      const h = t * t * (3 - 2 * t);
      return 4 * h * (1 - h);
    };
    const u0 = 12;
    const uFwd = u0 - 5 * bump((u0 + 50) / L);
    const back = traceStrokeInv(uFwd, 0, neg);
    expect(back.x).toBeCloseTo(u0, 3);
  });

  it('端点外位移为零（钳制正确）', () => {
    const r = traceStrokeInv(60, 0, seg);
    expect(r.x).toBeCloseTo(60, 3);
  });

  it('退化齿痕（零长度）直接返回原点', () => {
    const bad: StrokeSeg = { ax: 1, ay: 1, bx: 1, by: 1, width: 5, strength: 2 };
    const r = traceStrokeInv(3, 3, bad);
    expect(r).toEqual({ x: 3, y: 3 });
  });
});

describe('完整反向追踪', () => {
  it('无操作时坐标原样返回、命中为空', () => {
    const r = tracePoint(3, 4, { drops: [], strokes: [] });
    expect(r.x).toBe(3);
    expect(r.y).toBe(4);
    expect(r.hit).toBeNull();
  });

  it('两滴叠放：新滴覆盖区命中新滴，旧滴被外推', () => {
    const d1 = drop({ x: 0, y: 0, seq: 1, id: 'd1' });
    const d2 = drop({ x: 0, y: 0, seq: 2, id: 'd2', rings: [{ pigmentId: 'x', outerRadius: 4 }] });
    const r = tracePoint(0, 0, { drops: [d1, d2], strokes: [] });
    expect(r.hit!.dropIndex).toBe(1);
    // d2 盘外、d1 盘内的点仍命中 d1
    const r2 = tracePoint(7, 0, { drops: [d1, d2], strokes: [] });
    expect(r2.hit!.dropIndex).toBe(0);
  });

  it('追踪结果对相同输入逐位确定', () => {
    const d = drop();
    const a = tracePoint(12.345, -7.89, { drops: [d], strokes: [] });
    const b = tracePoint(12.345, -7.89, { drops: [d], strokes: [] });
    expect(a).toEqual(b);
  });
});
