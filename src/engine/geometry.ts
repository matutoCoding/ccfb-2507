import type { Vec2 } from './types';

/** 点在多边形内（射线法） */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function polygonBounds(poly: Vec2[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** 多边形向外扩 mm（按包围盒中心做简单径向扩展，配合 2mm 搭边使用） */
export function expandPolygon(poly: Vec2[], amountMm: number): Vec2[] {
  const b = polygonBounds(poly);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return poly.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * amountMm, y: p.y + (dy / len) * amountMm };
  });
}

/** 把归一化多边形（相对残页图 0..1）映射到纸面 mm 坐标的指定矩形区域 */
export function mapPolygonToMm(
  poly: Vec2[],
  target: { x: number; y: number; w: number; h: number },
): Vec2[] {
  return poly.map((p) => ({
    x: target.x + p.x * target.w,
    y: target.y + p.y * target.h,
  }));
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
