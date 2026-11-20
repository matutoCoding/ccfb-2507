import { fbm2, hash21, mulberry32 } from './rng';

export interface AgedPaperOptions {
  widthPx: number;
  heightPx: number;
  seed: number;
  /** 泛黄强度 0..1 */
  yellowing: number;
  /** 水渍数量 */
  waterStains: number;
  /** 缺角数量（0..3） */
  missingCorners: number;
  /** 折痕数量 */
  folds: number;
  /** 可选：叠加淡淡的旧大理石纹残迹 */
  faintMarbling?: boolean;
}

/**
 * 程序化生成"老纸残页"测试图（Canvas2D）。
 * 所有随机量由 seed 决定 => 同参数逐位可复现，便于测试比对流程。
 * 输出带 alpha 通道，缺角区域为透明。
 */
export function generateAgedPaper(opts: AgedPaperOptions): HTMLCanvasElement {
  const { widthPx: w, heightPx: h } = opts;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const rnd = mulberry32(opts.seed);
  const mmScale = w / 210; // 假定 A4 宽 210mm

  // 1) 纸基 + 泛黄 + 颗粒
  const img = ctx.createImageData(w, h);
  const base = [232, 218, 186];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const mx = x / mmScale;
      const my = y / mmScale;
      const age = fbm2(mx, my, 0.05);
      const grain = hash21(x, y);
      const stain = fbm2(mx + 50, my + 50, 0.02);
      const yell = opts.yellowing * (0.5 + age * 0.8) * 40 + stain * opts.yellowing * 25;
      const idx = (y * w + x) * 4;
      img.data[idx] = clamp(base[0] - yell * 0.6 + (grain - 0.5) * 18);
      img.data[idx + 1] = clamp(base[1] - yell * 0.9 + (grain - 0.5) * 16);
      img.data[idx + 2] = clamp(base[2] - yell * 1.3 + (grain - 0.5) * 14);
      img.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // 2) 水渍：深色柔边圆斑
  for (let i = 0; i < opts.waterStains; i++) {
    const cx = rnd() * w;
    const cy = rnd() * h;
    const r = (20 + rnd() * 60) * (w / 800);
    const grad = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
    grad.addColorStop(0, `rgba(110, 85, 45, ${0.1 + rnd() * 0.12})`);
    grad.addColorStop(0.75, `rgba(120, 95, 55, ${0.06 + rnd() * 0.08})`);
    grad.addColorStop(1, 'rgba(120,95,55,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // 水渍轮廓线
    ctx.strokeStyle = `rgba(90, 70, 40, ${0.12 + rnd() * 0.1})`;
    ctx.lineWidth = 1 + rnd() * 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r * (0.8 + rnd() * 0.15), 0, Math.PI * 2);
    ctx.stroke();
  }

  // 3) 折痕
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < opts.folds; i++) {
    const x0 = rnd() * w;
    const grad = ctx.createLinearGradient(x0 - 3, 0, x0 + 3, 0);
    grad.addColorStop(0, 'rgba(120,100,70,0)');
    grad.addColorStop(0.5, `rgba(100,80,50,${0.1 + rnd() * 0.12})`);
    grad.addColorStop(1, 'rgba(120,100,70,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x0 - 4, 0, 8, h);
  }
  ctx.globalCompositeOperation = 'source-over';

  // 4) 旧大理石纹残迹（很淡）
  if (opts.faintMarbling) {
    ctx.globalAlpha = 0.12;
    for (let i = 0; i < 8; i++) {
      ctx.strokeStyle = ['#5a3a28', '#3a4a5a', '#6a4a3a'][i % 3];
      ctx.lineWidth = 2 + rnd() * 3;
      ctx.beginPath();
      const y0 = (i / 8) * h + rnd() * 20;
      ctx.moveTo(0, y0);
      for (let x = 0; x <= w; x += 20) {
        ctx.lineTo(x, y0 + Math.sin(x * 0.02 + i) * (10 + rnd() * 8));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // 5) 缺角：多边形挖空（destination-out）
  const corners = [
    [0, 0],
    [w, 0],
    [0, h],
    [w, h],
  ];
  const picked = new Set<number>();
  for (let i = 0; i < opts.missingCorners; i++) {
    let c = Math.floor(rnd() * 4);
    while (picked.has(c)) c = (c + 1) % 4;
    picked.add(c);
    const [cx, cy] = corners[c];
    const size = (0.12 + rnd() * 0.16) * Math.min(w, h);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    const steps = 5;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const edge1 = t * size * (0.8 + rnd() * 0.4);
      const edge2 = (1 - t) * size * (0.8 + rnd() * 0.4);
      const px = cx === 0 ? edge1 : w - edge1;
      const py = cy === 0 ? edge2 : h - edge2;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // 缺角毛边
    ctx.strokeStyle = 'rgba(90,70,45,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 6) 边缘磨损暗角
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.4, w / 2, h / 2, Math.max(w, h) * 0.7);
  vg.addColorStop(0, 'rgba(80,60,30,0)');
  vg.addColorStop(1, 'rgba(80,60,30,0.22)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);

  return canvas;
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, v));
}
