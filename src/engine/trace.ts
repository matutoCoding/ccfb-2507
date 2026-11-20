/**
 * 反向追踪（backward advection）——整个系统的数学核心。
 *
 * 设计原则：
 * 1. 每个操作都是面积守恒（雅可比行列式 = 1）的坐标映射；
 * 2. 渲染时对输出像素逆序穿过所有操作，反推它在操作前的坐标，
 *    最终定位到初始墨滴的某个色环或纸基；
 * 3. 本文件是 TypeScript 参考实现，GLSL 着色器（trace.glsl.ts）
 *    与它逐公式对应；两套实现共用同一批单元测试数值。
 */

import type { DropOp, StrokeSeg } from './types';

export interface DropTrace {
  /** 命中的滴墨序号（在 drops 数组中的下标），-1 表示纸基 */
  dropIndex: number;
  /** 色环下标（由外到内 0..n-1） */
  ringIndex: number;
  /** 命中点在该滴局部坐标中的半径（mm），环外点为映射后半径 */
  localRadius: number;
  /** 该环外半径（mm） */
  ringOuter: number;
  /** 该环内半径（mm，首环为 0） */
  ringInner: number;
}

const BISECT_STEPS = 20;

/**
 * 单条直线齿痕的逆映射。
 * 正映射（沿齿方向 u 的位移场，垂直距离 v 不变 => 面积守恒）：
 *   u' = u + s · exp(-v²/w²) · bump(t),  t = u/L ∈ [0,1]
 *   bump(t) = smoothstep(0,1,t) · (1 - smoothstep(0,1,t)) × 4，端点处归零
 * 逆映射对单调函数 g(t) = t + (s/L)·exp(-v²/w²)·bump(t) 做固定步数二分。
 * 约束 |s| ≤ w 保证 g 单调（UI 层强制）。
 */
export function traceStrokeInv(x: number, y: number, seg: StrokeSeg): { x: number; y: number } {
  const dx = seg.bx - seg.ax;
  const dy = seg.by - seg.ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return { x, y };
  const L = Math.sqrt(len2);
  // 以 a 为原点的局部坐标
  const px = x - seg.ax;
  const py = y - seg.ay;
  const u = (px * dx + py * dy) / L; // 投影到齿方向
  const v = (-px * dy + py * dx) / L; // 垂直距离
  const env = Math.exp(-(v * v) / (seg.width * seg.width));
  const k = (seg.strength / L) * env;

  const bump = (t: number): number => {
    const h = t * t * (3 - 2 * t);
    return 4 * h * (1 - h);
  };
  const g = (t: number): number => t + k * bump(t);

  const target = u / L;
  // 齿痕端点之外位移恒为 0（bump 在端点归零），正映射在端点连续，
  // 故域外点直接恒等返回，不能钳制到端点二分。
  if (target <= 0 || target >= 1) return { x, y };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < BISECT_STEPS; i++) {
    const mid = (lo + hi) * 0.5;
    if (g(mid) < target) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) * 0.5;
  const uOld = t * L;
  // 由局部坐标还原：u 沿 (dx,dy)/L，v 沿 (-dy,dx)/L
  return {
    x: seg.ax + (uOld * dx - v * dy) / L,
    y: seg.ay + (uOld * dy + v * dx) / L,
  };
}

/**
 * 单滴墨的逆映射。
 * 正映射（严格面积守恒的径向不可压变换）：
 *   盘内 ρ ≤ r  =>  0（被新墨覆盖）
 *   盘外 ρ > r  =>  ρ' = √(ρ² + r²)
 * 逆映射：盘内点回到局部原点并记录色环；盘外点 ρ = √(ρ'² - r²)。
 */
export function traceDropInv(
  x: number,
  y: number,
  drop: DropOp,
  dropIndex: number,
): { x: number; y: number; hit: DropTrace | null } {
  const dx = x - drop.x;
  const dy = y - drop.y;
  const rp = Math.hypot(dx, dy);
  const outer = drop.rings[0].outerRadius;

  if (rp <= outer) {
    // 命中本滴：选环（环半径由外到内单调递减）
    let ringIndex = drop.rings.length - 1;
    for (let i = 0; i < drop.rings.length; i++) {
      if (rp <= drop.rings[i].outerRadius) ringIndex = i;
    }
    const ringOuter = drop.rings[ringIndex].outerRadius;
    const ringInner = ringIndex + 1 < drop.rings.length ? drop.rings[ringIndex + 1].outerRadius : 0;
    return {
      x: drop.x,
      y: drop.y,
      hit: { dropIndex, ringIndex, localRadius: rp, ringOuter, ringInner },
    };
  }
  const rho = Math.sqrt(Math.max(0, rp * rp - outer * outer));
  const s = rp > 1e-9 ? rho / rp : 0;
  return {
    x: drop.x + dx * s,
    y: drop.y + dy * s,
    hit: null,
  };
}

export interface TraceInput {
  drops: DropOp[];
  strokes: StrokeSeg[];
}

export interface TraceResult {
  x: number;
  y: number;
  hit: DropTrace | null;
}

/**
 * 完整反向追踪：先逆序穿过所有齿痕，再逆序穿过所有滴墨。
 * 一旦命中某滴，坐标即固定到该滴（更早的滴被它覆盖），
 * 但仍需继续走完剩余滴逆映射吗？不需要——命中即终止滴循环，
 * 因为该点的最终颜色由命中滴决定。齿痕必须全部走完（它们晚于所有滴）。
 */
export function tracePoint(px: number, py: number, input: TraceInput): TraceResult {
  let x = px;
  let y = py;
  for (let i = input.strokes.length - 1; i >= 0; i--) {
    const r = traceStrokeInv(x, y, input.strokes[i]);
    x = r.x;
    y = r.y;
  }
  let hit: DropTrace | null = null;
  for (let i = input.drops.length - 1; i >= 0; i--) {
    const r = traceDropInv(x, y, input.drops[i], i);
    x = r.x;
    y = r.y;
    if (r.hit) {
      hit = r.hit;
      break;
    }
  }
  return { x, y, hit };
}
