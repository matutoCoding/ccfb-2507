import { describe, it, expect } from 'vitest';
import { cullToTile, operationsBounds, type Box } from '../src/engine/culling';
import type { DropOp, StrokeSeg } from '../src/engine/types';

function drop(id: string, x: number, y: number, outer: number): DropOp {
  return { kind: 'drop', id, seq: 1, x, y, rings: [{ pigmentId: 'p', outerRadius: outer }] };
}

const stroke: StrokeSeg = { ax: 0, ay: 0, bx: 100, by: 0, width: 4, strength: 3 };

describe('瓦片操作裁剪', () => {
  const drops = [
    drop('a', 0, 0, 10),    // 中心
    drop('b', 200, 200, 10), // 远离中心
  ];

  it('保留与瓦片相交的滴墨，剔除远处的', () => {
    const tile: Box = { minX: -50, minY: -50, maxX: 50, maxY: 50 };
    const r = cullToTile({ drops, strokes: [] }, tile);
    expect(r.drops.map((d) => d.id)).toEqual(['a']);
  });

  it('瓦片覆盖全部时全部保留', () => {
    const tile: Box = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
    const r = cullToTile({ drops, strokes: [stroke] }, tile);
    expect(r.drops).toHaveLength(2);
    expect(r.strokes).toHaveLength(1);
  });

  it('齿痕按宽度衰减范围裁剪，远处瓦片不含该齿痕', () => {
    const farTile: Box = { minX: 400, minY: 400, maxX: 500, maxY: 500 };
    const r = cullToTile({ drops: [], strokes: [stroke] }, farTile);
    expect(r.strokes).toHaveLength(0);
  });

  it('齿痕附近瓦片保留该齿痕', () => {
    const nearTile: Box = { minX: 40, minY: -20, maxX: 60, maxY: 20 };
    const r = cullToTile({ drops: [], strokes: [stroke] }, nearTile);
    expect(r.strokes).toHaveLength(1);
  });

  it('空输入返回空集', () => {
    const r = cullToTile({ drops: [], strokes: [] }, { minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(r.drops).toEqual([]);
    expect(r.strokes).toEqual([]);
  });
});

describe('operationsBounds', () => {
  it('计算滴墨整体包围盒', () => {
    const b = operationsBounds([drop('a', 10, -20, 5)]);
    expect(b.maxX).toBeGreaterThan(10);
    expect(b.minY).toBeLessThan(-20);
  });
  it('无操作时返回零盒', () => {
    const b = operationsBounds([]);
    expect(b).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });
});
