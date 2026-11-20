import type { Operation, StrokeSeg, Vec2 } from './types';
import { expandComb } from './recipes';
import type { DropOp } from './types';

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CullInput {
  drops: DropOp[];
  strokes: StrokeSeg[];
}

/** 滴墨影响范围：盘内覆盖 + 盘外任意距离都被径向映射，故用一个保守的有效半径。
 *  超过若干倍 outer 后位移趋于 0，裁剪时留足余量。 */
const DROP_INFLUENCE_FACTOR = 8;

function dropBox(d: DropOp, marginMm: number): Box {
  const r = d.rings[0].outerRadius * DROP_INFLUENCE_FACTOR + marginMm;
  return { minX: d.x - r, minY: d.y - r, maxX: d.x + r, maxY: d.y + r };
}

function strokeBox(s: StrokeSeg, marginMm: number): Box {
  // 位移场按 exp(-v²/w²) 衰减，3w 外可忽略；端点 bump 平滑，留 2mm 余量
  const r = s.width * 3 + Math.abs(s.strength) + marginMm;
  return {
    minX: Math.min(s.ax, s.bx) - r,
    minY: Math.min(s.ay, s.by) - r,
    maxX: Math.max(s.ax, s.bx) + r,
    maxY: Math.max(s.ay, s.by) + r,
  };
}

function intersects(a: Box, b: Box): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}

/**
 * 瓦片级操作裁剪：只保留物理包围盒与瓦片矩形相交的操作。
 * 注意滴墨的径向变换在远处仍有微小位移，这里用 8 倍半径的保守边界，
 * 视觉误差远小于 1 色阶（ρ 很大时 √(ρ²+r²)−ρ ≈ r²/2ρ → 0）。
 */
export function cullToTile(input: CullInput, tileBox: Box, marginMm = 2): CullInput {
  return {
    drops: input.drops.filter((d) => intersects(dropBox(d, marginMm), tileBox)),
    strokes: input.strokes.filter((s) => intersects(strokeBox(s, marginMm), tileBox)),
  };
}

/** 计算全部操作的整体包围盒（供导出分带参考） */
export function operationsBounds(operations: Operation[]): Box {
  const flat: CullInput = {
    drops: operations.filter((o): o is DropOp => o.kind === 'drop'),
    strokes: operations.filter((o) => o.kind === 'comb').flatMap((o) => expandComb(o)),
  };
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const d of flat.drops) {
    const b = dropBox(d, 0);
    box.minX = Math.min(box.minX, b.minX);
    box.minY = Math.min(box.minY, b.minY);
    box.maxX = Math.max(box.maxX, b.maxX);
    box.maxY = Math.max(box.maxY, b.maxY);
  }
  for (const s of flat.strokes) {
    const b = strokeBox(s, 0);
    box.minX = Math.min(box.minX, b.minX);
    box.minY = Math.min(box.minY, b.minY);
    box.maxX = Math.max(box.maxX, b.maxX);
    box.maxY = Math.max(box.maxY, b.maxY);
  }
  return Number.isFinite(box.minX) ? box : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

export function vecBox(center: Vec2, half: number): Box {
  return { minX: center.x - half, minY: center.y - half, maxX: center.x + half, maxY: center.y + half };
}
