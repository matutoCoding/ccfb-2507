import { describe, it, expect } from 'vitest';
import {
  srgbToLinear,
  linearToSrgb,
  rgbToCmyk,
  cmykToLinearRgb,
  deltaE2000,
  isOutOfGamut,
  hexToRgb,
  rgbToHex,
} from '../src/engine/color';

describe('sRGB 传递函数', () => {
  it('往返一致', () => {
    for (const v of [0, 0.03, 0.5, 0.9, 1]) {
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 10);
    }
  });
  it('暗部线性段、亮部幂段', () => {
    expect(srgbToLinear(0.02)).toBeCloseTo(0.02 / 12.92, 10);
    expect(srgbToLinear(0.8)).toBeCloseTo(Math.pow((0.855) / 1.055, 2.4), 10);
  });
});

describe('CMYK 分色与 Neugebauer 正向', () => {
  it('纯黑分色 K=1', () => {
    expect(rgbToCmyk([0, 0, 0]).k).toBeCloseTo(1, 6);
  });
  it('纯白分色全 0', () => {
    const k = rgbToCmyk([1, 1, 1]);
    expect(k.k).toBeCloseTo(0, 10);
    expect(k.c + k.m + k.y).toBeCloseTo(0, 10);
  });
  it('分色再叠印的浅色保持明亮', () => {
    const repro = cmykToLinearRgb(rgbToCmyk([0.9, 0.9, 0.9]));
    expect(repro[0]).toBeGreaterThan(0.75);
  });
  it('高饱和青色触发出色域', () => {
    expect(isOutOfGamut([0, 1, 1], 10)).toBe(true);
  });
  it('暗色在色域内（阈值 8，近似模型）', () => {
    expect(isOutOfGamut([0.2, 0.15, 0.1], 8)).toBe(false);
  });
});

describe('ΔE2000', () => {
  it('同色色差为 0', () => {
    const lab = [50, 20, -30] as [number, number, number];
    expect(deltaE2000(lab, lab)).toBeCloseTo(0, 10);
  });
  it('黑与白色差很大', () => {
    const d = deltaE2000([0, 0, 0], [100, 0, 0]);
    expect(d).toBeGreaterThan(90);
  });
});

describe('hex 转换', () => {
  it('往返', () => {
    const rgb = hexToRgb('#3a7bd5');
    expect(rgbToHex(rgb).toLowerCase()).toBe('#3a7bd5');
  });
});
