/**
 * 确定性随机与哈希。
 * 渲染路径严禁使用 Math.random / Date.now：同一份工序数据在任何机器、
 * 任何时间重放都必须得到逐位一致的像素。
 */

/** mulberry32：小巧确定性 PRNG，用于工序录制时的波浪相位等 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 整数哈希（GPU 与 CPU 共用同一公式，见 shaders/common.glsl.ts） */
export function hash11(i: number): number {
  let x = i | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return (x >>> 0) / 4294967296;
}

/**
 * 二维整数格点哈希 -> [0,1)。
 * 全程无符号 32 位语义（>>>0），与 common.glsl.ts 的 hash21 位级对应。
 */
export function hash21(ix: number, iy: number): number {
  let h = (Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263)) >>> 0;
  h = Math.imul((h ^ (h >>> 13)) >>> 0, 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/** 二维值噪声（双线性平滑），输入物理毫米坐标 */
export function valueNoise2(x: number, y: number, scale: number): number {
  const sx = x * scale;
  const sy = y * scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash21(x0, y0);
  const b = hash21(x0 + 1, y0);
  const c = hash21(x0, y0 + 1);
  const d = hash21(x0 + 1, y0 + 1);
  return (
    a * (1 - ux) * (1 - uy) +
    b * ux * (1 - uy) +
    c * (1 - ux) * uy +
    d * ux * uy
  );
}

/** 分形值噪声（3 倍频） */
export function fbm2(x: number, y: number, scale: number): number {
  return (
    valueNoise2(x, y, scale) * 0.6 +
    valueNoise2(x, y, scale * 2.13) * 0.28 +
    valueNoise2(x, y, scale * 4.71) * 0.12
  );
}
