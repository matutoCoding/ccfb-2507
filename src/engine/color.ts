/**
 * 色彩科学工具。
 * - sRGB <-> 线性光：GPU 与 CPU 同公式
 * - CMYK：简化 Demichel-Neugebauer 胶印模型（铜版纸近似原色），
 *   用于分色预览与色域报警；正式印前仍应以打印机 ICC 配置文件为准，
 *   UI 上会明确标注"近似模型"。
 * - ΔE2000：老纸比对的色差指标
 */

export type RGB = [number, number, number];

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  const v = Math.max(0, Math.min(1, c));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function srgbToLinearRGB([r, g, b]: RGB): RGB {
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

export function linearToSrgbRGB([r, g, b]: RGB): RGB {
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(b)];
}

// ---- 白适应与 XYZ（D65） ----
export function srgbLinearToXyz([r, g, b]: RGB): [number, number, number] {
  return [
    0.4123908 * r + 0.3575843 * g + 0.1804808 * b,
    0.212639 * r + 0.7151687 * g + 0.0721923 * b,
    0.0193308 * r + 0.1191948 * g + 0.9505322 * b,
  ];
}

export function xyzToLab(xyz: [number, number, number]): [number, number, number] {
  const [x, y, z] = [xyz[0] / 0.95047, xyz[1] / 1.0, xyz[2] / 1.08883];
  const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function srgbToLab(rgb: RGB): [number, number, number] {
  return xyzToLab(srgbLinearToXyz(srgbToLinearRGB(rgb)));
}

/** CIEDE2000 色差 */
export function deltaE2000(
  lab1: [number, number, number],
  lab2: [number, number, number],
): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const avgL = (L1 + L2) / 2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const avgC = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = Math.atan2(b1, a1p) * (180 / Math.PI) + (b1 === 0 && a1p === 0 ? 0 : 0);
  const h2p = Math.atan2(b2, a2p) * (180 / Math.PI);
  const H1p = h1p < 0 ? h1p + 360 : h1p;
  const H2p = h2p < 0 ? h2p + 360 : h2p;
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = H2p - H1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);
  const avgLp = avgL;
  const avgCp = (C1p + C2p) / 2;
  let avgHp = H1p + H2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(H1p - H2p) > 180) {
      avgHp = H1p + H2p < 360 ? (H1p + H2p + 360) / 2 : (H1p + H2p - 360) / 2;
    } else {
      avgHp = (H1p + H2p) / 2;
    }
  }
  const T =
    1 -
    0.17 * Math.cos(((avgHp - 30) * Math.PI) / 180) +
    0.24 * Math.cos(((2 * avgHp) * Math.PI) / 180) +
    0.32 * Math.cos(((3 * avgHp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * avgHp - 63) * Math.PI) / 180);
  const dTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(avgLp - 50, 2)) / Math.sqrt(20 + Math.pow(avgLp - 50, 2));
  const Sc = 1 + 0.045 * avgCp;
  const Sh = 1 + 0.015 * avgCp * T;
  const Rt = -Math.sin((2 * dTheta * Math.PI) / 180) * Rc;
  return Math.sqrt(
    Math.pow(dLp / Sl, 2) +
      Math.pow(dCp / Sc, 2) +
      Math.pow(dHp / Sh, 2) +
      Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/**
 * 简化胶印模型：朴素 GCR 分色 + Demichel 网点叠合 + Neugebauer 原色混合。
 * 分色时先求 CMY，再以灰成分替代（UCR）引入 K；
 * 纸白权重 = (1-C)(1-M)(1-Y)(1-K)，因此深色不会错误地保留大面积纸白。
 */
export interface CMYK {
  c: number;
  m: number;
  y: number;
  k: number;
}

/** UCR 强度：灰成分转由黑墨承担的比例（典型胶印 0.55） */
const UCR = 0.55;

export function rgbToCmyk(rgb: RGB): CMYK {
  const [r, g, b] = rgb;
  const c0 = 1 - r;
  const m0 = 1 - g;
  const y0 = 1 - b;
  const gray = Math.min(c0, m0, y0);
  // 近白区无墨（纸白直通）：最大墨量低于 12% 视为纸白
  if (Math.max(c0, m0, y0) < 0.12) return { c: 0, m: 0, y: 0, k: 0 };
  // 近黑区直接走黑墨，避免四色叠印发灰
  if (gray > 0.92) {
    return { c: Math.max(0, c0 - gray), m: Math.max(0, m0 - gray), y: Math.max(0, y0 - gray), k: gray };
  }
  const k = gray * UCR;
  return {
    c: Math.max(0, c0 - k),
    m: Math.max(0, m0 - k),
    y: Math.max(0, y0 - k),
    k,
  };
}

// 铜版纸单墨反射率（线性 sRGB），对应 ISO 铜版纸典型实地色
const PAPER_WHITE: RGB = [0.96, 0.96, 0.97];
const INK_C: RGB = [0.13, 0.5, 0.8];
const INK_M: RGB = [0.8, 0.17, 0.38];
const INK_Y: RGB = [0.9, 0.78, 0.12];
const INK_K: RGB = [0.004, 0.004, 0.005];

/** 单墨在纸白上的吸光系数 α = -ln(R_ink/R_paper) */
function absorbance(ink: RGB): RGB {
  return [
    -Math.log(ink[0] / PAPER_WHITE[0]),
    -Math.log(ink[1] / PAPER_WHITE[1]),
    -Math.log(ink[2] / PAPER_WHITE[2]),
  ];
}
const A_C = absorbance(INK_C);
const A_M = absorbance(INK_M);
const A_Y = absorbance(INK_Y);
const A_K = absorbance(INK_K);

/**
 * CMYK -> 线性 sRGB。
 * Beer-Lambert 乘性吸光：R = R_paper · exp(−Σ a_i · 墨量)，
 * 墨层独立、自动保证多色叠印变暗，符合印刷品视觉规律。
 */
export function cmykToLinearRgb({ c, m, y, k }: CMYK): RGB {
  const out: RGB = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) {
    const a = A_C[ch] * c + A_M[ch] * m + A_Y[ch] * y + A_K[ch] * k;
    out[ch] = PAPER_WHITE[ch] * Math.exp(-a);
  }
  return out;
}

/** 单色版预览：仅该墨按其墨量在纸白上吸光 */
export function singlePlateToSrgb(plate: 'c' | 'm' | 'y' | 'k', amount: number): RGB {
  const A = { c: A_C, m: A_M, y: A_Y, k: A_K }[plate];
  const lin: RGB = [
    PAPER_WHITE[0] * Math.exp(-A[0] * amount),
    PAPER_WHITE[1] * Math.exp(-A[1] * amount),
    PAPER_WHITE[2] * Math.exp(-A[2] * amount),
  ];
  return linearToSrgbRGB(lin);
}

/**
 * 色域检测：把 sRGB 色经分色再正向叠印，比较 ΔE2000。
 * 阈值 3.5 以内视为可印刷（UI 可在 2~6 间调）。
 */
export function gamutDistance(rgb: RGB): number {
  const cmyk = rgbToCmyk(rgb);
  const repro = cmykToLinearRgb(cmyk);
  const reproSrgb = linearToSrgbRGB(repro);
  return deltaE2000(srgbToLab(rgb), srgbToLab(reproSrgb));
}

export function isOutOfGamut(rgb: RGB, threshold = 3.5): boolean {
  return gamutDistance(rgb) > threshold;
}

/** 十六进制 #rrggbb -> RGB 0..1 */
export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

export function rgbToHex([r, g, b]: RGB): string {
  const q = (v: number) =>
    Math.round(Math.max(0, Math.min(1, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${q(r)}${q(g)}${q(b)}`;
}
