import type { CombOp, DropOp, DropRing, Operation, Pigment, Project, Vec2 } from './types';
import { BUILTIN_PIGMENTS } from './pigments';
import { mulberry32 } from './rng';

let idCounter = 1;
export function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`;
}

export function defaultPaper(): Project['paper'] {
  return {
    tint: [0.93, 0.91, 0.86],
    fiberScale: 0.9,
    fiberStrength: 0.16,
    feather: 0.35,
    grain: 0.05,
  };
}

export function createProject(name = '未命名纹样'): Project {
  return {
    name,
    widthMm: 297,
    heightMm: 420,
    paper: defaultPaper(),
    palette: BUILTIN_PIGMENTS.filter((p) =>
      ['pg-indigo', 'pg-vermilion', 'pg-ochre', 'pg-ivory-black', 'pg-gold'].includes(p.id),
    ),
    operations: [],
  };
}

/** 由颜料扩散性计算墨滴基础半径（mm），扩散性越强铺得越大 */
export function dropRadiusFor(pigment: Pigment, baseMm: number): number {
  return baseMm * (0.55 + 1.35 * pigment.diffusion);
}

export interface DropRequest {
  x: number;
  y: number;
  /** 同心环颜料 id，由外到内 */
  pigmentIds: string[];
  /** 最外环目标半径（mm） */
  baseRadiusMm: number;
  /** 相邻环半径比 */
  ringRatio?: number;
}

/** 录制一滴墨：半径经扩散性修正，保证面积守恒由渲染数学保证 */
export function buildDropOp(project: Project, req: DropRequest): DropOp {
  const seq = nextSeq(project.operations);
  const rings: DropRing[] = [];
  const ratio = req.ringRatio ?? 0.68;
  let r = req.baseRadiusMm;
  req.pigmentIds.forEach((pid, i) => {
    const pigment = project.palette.find((p) => p.id === pid);
    const radius = pigment ? dropRadiusFor(pigment, r) : r;
    rings.push({ pigmentId: pid, outerRadius: i === 0 ? Math.max(radius, r * 0.9) : radius });
    r *= ratio;
  });
  // 半径必须严格递减，否则着色器选环会乱
  for (let i = 1; i < rings.length; i++) {
    rings[i].outerRadius = Math.min(rings[i].outerRadius, rings[i - 1].outerRadius * 0.85);
  }
  return { kind: 'drop', id: nextId('drop'), seq, x: req.x, y: req.y, rings };
}

export interface CombRequest {
  tool: CombOp['tool'];
  start: Vec2;
  end: Vec2;
  toothLength: number;
  toothWidth: number;
  strength: number;
  spacing: number;
  teethCount: number;
  wavyAmplitude: number;
  wavyWavelength: number;
  passes: number;
}

export function buildCombOp(project: Project, req: CombRequest, rngSeed?: number): CombOp {
  const seq = nextSeq(project.operations);
  const rnd = mulberry32(rngSeed ?? (seq * 2654435761) >>> 0);
  // 单调性约束：|strength| ≤ toothWidth
  const strength = Math.min(Math.abs(req.strength), req.toothWidth * 0.98) * Math.sign(req.strength || 1);
  return {
    kind: 'comb',
    id: nextId('comb'),
    seq,
    tool: req.tool,
    start: req.start,
    end: req.end,
    toothLength: req.toothLength,
    toothWidth: req.toothWidth,
    strength,
    spacing: req.spacing,
    teethCount: req.teethCount,
    wavyAmplitude: req.wavyAmplitude,
    wavyWavelength: req.wavyWavelength,
    passes: Math.max(1, Math.round(req.passes)),
    phase: rnd() * Math.PI * 2,
  };
}

export function nextSeq(operations: Operation[]): number {
  return operations.reduce((m, o) => Math.max(m, o.seq), 0) + 1;
}

/** 在指定位置插入工序，其后的工序 seq 顺延 */
export function insertOperation(operations: Operation[], op: Operation, atIndex?: number): Operation[] {
  const sorted = [...operations].sort((a, b) => a.seq - b.seq);
  const idx = atIndex ?? sorted.length;
  const seqAt = idx < sorted.length ? sorted[idx].seq : nextSeq(sorted);
  const next = sorted.map((o) => (o.seq >= seqAt ? { ...o, seq: o.seq + 1 } : o));
  next.splice(idx, 0, { ...op, seq: seqAt });
  return next;
}

export function removeOperation(operations: Operation[], id: string): Operation[] {
  return operations.filter((o) => o.id !== id);
}

/** 重放 = 直接按 seq 排序后交给渲染器；本函数只做校验与排序 */
export function replayOrder(operations: Operation[]): Operation[] {
  return [...operations].sort((a, b) => a.seq - b.seq);
}

/** 换配色：保持工序结构，只替换颜料 id 映射 */
export function recolorOperations(
  operations: Operation[],
  mapping: Map<string, string>,
): Operation[] {
  return operations.map((op) => {
    if (op.kind !== 'drop') return op;
    return {
      ...op,
      rings: op.rings.map((r) => ({ ...r, pigmentId: mapping.get(r.pigmentId) ?? r.pigmentId })),
    };
  });
}

export function serializeProject(project: Project): string {
  return JSON.stringify({ version: 1, ...project }, null, 2);
}

export function deserializeProject(text: string): Project {
  const data = JSON.parse(text) as Project & { version?: number };
  if (!data.operations || !data.palette) throw new Error('文件不是有效的纹样工程');
  return data;
}
