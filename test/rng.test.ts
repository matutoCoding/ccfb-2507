import { describe, it, expect } from 'vitest';
import { hash21, valueNoise2, fbm2, mulberry32 } from '../src/engine/rng';

describe('hash21 确定性（与 GLSL hash21 位级对应）', () => {
  it('锁定值，防止 TS/GLSL 实现漂移', () => {
    expect(hash21(0, 0)).toBeCloseTo(0.0, 10);
    expect(hash21(1, 0)).toBeCloseTo(0.5081244609, 10);
    expect(hash21(0, 1)).toBeCloseTo(0.7682745543, 10);
    expect(hash21(-3, 7)).toBeCloseTo(0.3137954113, 10);
    expect(hash21(100, -200)).toBeCloseTo(0.7399480061, 10);
    expect(hash21(12345, 67890)).toBeCloseTo(0.4887159329, 10);
  });

  it('输出始终落在 [0,1)', () => {
    for (let i = -50; i < 50; i++) {
      const v = hash21(i, i * 3 + 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('负坐标不产生 NaN', () => {
    expect(Number.isNaN(hash21(-999, -1))).toBe(false);
  });
});

describe('噪声', () => {
  it('valueNoise2 确定且有界', () => {
    const a = valueNoise2(3.7, -2.1, 0.5);
    const b = valueNoise2(3.7, -2.1, 0.5);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
  });

  it('fbm2 确定且有界', () => {
    const a = fbm2(1.5, 2.5, 1.2);
    const b = fbm2(1.5, 2.5, 1.2);
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(1);
  });
});

describe('mulberry32', () => {
  it('同种子序列一致', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 10; i++) expect(a()).toBe(b());
  });
});
