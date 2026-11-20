/**
 * CPU 参考渲染器。
 * 与 GPU 着色器同公式的 TypeScript 实现，用于：
 * 1. 单元测试中的逐像素基准；
 * 2. 无 WebGL2 环境下的兜底导出（慢但确定）。
 */
import { srgbToLinear, linearToSrgb, srgbToLinearRGB } from './color';
import { fbm2, hash21, valueNoise2 } from './rng';
import { tracePoint } from './trace';
import { flattenOps } from '../gl/MarblingRenderer';
import type { Project } from './types';

export interface CpuRenderOptions {
  widthPx: number;
  heightPx: number;
  lightTilt?: number;
  samples?: 1 | 4;
}

const JITTER: Array<[number, number]> = [
  [0.375, 0.125],
  [0.875, 0.375],
  [0.125, 0.625],
  [0.625, 0.875],
];

function shadePoint(project: Project, x: number, y: number, sampleMm: number, lightTilt: number): [number, number, number] {
  const { drops, strokes } = flattenOps(project.operations);
  const result = tracePoint(x, y, { drops, strokes });

  // 纸基：纤维 + 颗粒（全部物理坐标，与分辨率解耦，对齐 GPU 着色器）
  const paperLin = srgbToLinearRGB(project.paper.tint);
  const fiber = fbm2(x, y, project.paper.fiberScale);
  const grain = hash21(Math.floor(x * 8.0), Math.floor(y * 8.0));
  let paper = paperLin.map(
    (c) => c * (1 + (fiber - 0.5) * project.paper.fiberStrength) * (1 + (grain - 0.5) * project.paper.grain),
  ) as [number, number, number];

  if (!result.hit) return paper;
  const drop = drops[result.hit.dropIndex];
  const ring = drop.rings[result.hit.ringIndex];
  const pigment = project.palette.find((p) => p.id === ring.pigmentId);
  if (!pigment) return paper;
  const ink = srgbToLinearRGB(pigment.color);

  const dEdge = result.hit.ringOuter - result.hit.localRadius;
  const band = Math.max(sampleMm * 1.5, pigment.gall * 0.9);
  const gallMix = 1 - smoothstep(0, band, dEdge);
  const outerFade = smoothstep(0, Math.max(sampleMm * 1.5, project.paper.feather), dEdge);
  const dInner = result.hit.localRadius - result.hit.ringInner;
  const innerFade = smoothstep(0, Math.max(sampleMm, project.paper.feather * 0.4), dInner);

  let col: [number, number, number] = [
    paper[0] + (ink[0] - paper[0]) * pigment.opacity * innerFade * outerFade,
    paper[1] + (ink[1] - paper[1]) * pigment.opacity * innerFade * outerFade,
    paper[2] + (ink[2] - paper[2]) * pigment.opacity * innerFade * outerFade,
  ];
  col = col.map((c, i) => c + (paper[i] - c) * gallMix * pigment.gall * 0.85) as [number, number, number];

  if (pigment.kind === 'metallic' && pigment.metallic) {
    // 严格复刻 GPU 着色器的金属 BRDF（见 marbling.fs.ts）
    const { metalness, roughness, flakeDensity } = pigment.metallic;
    const n1 = valueNoise2(x, y, 1.7);
    // GLSL: vnoise(seed*1.7 + 11.3)，标量加到两个分量
    const n2 = valueNoise2(x + 11.3 / 1.7, y + 11.3 / 1.7, 1.7);
    const nx = (n1 - 0.5) * 0.6;
    const ny = (n2 - 0.5) * 0.6;
    const nl = Math.hypot(nx, ny, 1);
    const n: [number, number, number] = [nx / nl, ny / nl, 1 / nl];
    const Lraw: [number, number, number] = [0.45, -0.35, 0.8 + lightTilt * 0.6];
    const ll = Math.hypot(...Lraw);
    const L: [number, number, number] = [Lraw[0] / ll, Lraw[1] / ll, Lraw[2] / ll];
    const V: [number, number, number] = [0, 0, 1];
    const Hraw: [number, number, number] = [L[0] + V[0], L[1] + V[1], L[2] + V[2]];
    const hl = Math.hypot(...Hraw);
    const H: [number, number, number] = [Hraw[0] / hl, Hraw[1] / hl, Hraw[2] / hl];
    const spec = Math.pow(Math.max(0, dot3(n, H)), 120 + (18 - 120) * roughness);
    // flakeSparkle：step(1-density, hash) * smoothstep(0.55,0.95, vnoise(seed*2.2))
    const hsh = hash21(Math.floor(x * 2.2), Math.floor(y * 2.2));
    const cell = valueNoise2(x, y, 2.2);
    const sparkle = (hsh > 1 - flakeDensity ? 1 : 0) * smoothstep(0.55, 0.95, cell) * (0.5 + lightTilt);
    const ndl = Math.max(0, dot3(n, L));
    const metalTint: [number, number, number] = [
      ink[0] * (0.55 + 0.45 * ndl),
      ink[1] * (0.55 + 0.45 * ndl),
      ink[2] * (0.55 + 0.45 * ndl),
    ];
    const add = spec * (1 - roughness) + sparkle * 0.6;
    col = col.map((c, i) => c + (metalTint[i] + add - c) * metalness) as [number, number, number];
  }
  return col;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** 渲染为 RGBA（sRGB 8bit），行序自上而下 */
export function renderCpu(project: Project, opts: CpuRenderOptions): Uint8Array {
  const { widthPx, heightPx } = opts;
  const sampleMm = project.widthMm / widthPx;
  const n = opts.samples === 4 ? 4 : 1;
  const lightTilt = opts.lightTilt ?? 0.4;
  const out = new Uint8Array(widthPx * heightPx * 4);
  for (let py = 0; py < heightPx; py++) {
    for (let px = 0; px < widthPx; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let s = 0; s < n; s++) {
        const jx = n === 4 ? JITTER[s][0] : 0;
        const jy = n === 4 ? JITTER[s][1] : 0;
        // +0.5 对齐 GPU gl_FragCoord 的像素中心约定
        const mx = (px + 0.5 + jx) * sampleMm - project.widthMm / 2;
        // 与 GPU gl_FragCoord 原点（左下）对齐：输出顶行 py=0 对应负的物理 y
        const my = (py + 0.5 + jy) * sampleMm - project.heightMm / 2;
        const c = shadePoint(project, mx, my, sampleMm, lightTilt);
        r += c[0];
        g += c[1];
        b += c[2];
      }
      const idx = (py * widthPx + px) * 4;
      out[idx] = clamp8(linearToSrgb(r / n) * 255);
      out[idx + 1] = clamp8(linearToSrgb(g / n) * 255);
      out[idx + 2] = clamp8(linearToSrgb(b / n) * 255);
      out[idx + 3] = 255;
    }
  }
  return out;
}

function clamp8(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

export { srgbToLinear };
