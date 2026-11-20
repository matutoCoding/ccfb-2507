import type { Operation } from '../engine/types';
import { studioStore, useStudio } from '../engine/store';
import { replayOrder } from '../engine/project';

const TOOL_NAME: Record<string, string> = {
  single: '单齿梳',
  multi: '多齿梳',
  wavy: '波浪梳',
};

export function OperationList() {
  const { project, selectedOpId } = useStudio();
  const ops = replayOrder(project.operations);

  return (
    <div className="op-list">
      {ops.length === 0 && <div className="muted" style={{ padding: 10 }}>还没有工序。在画布上滴墨或使用梳齿开始创作。</div>}
      {ops.map((op, i) => (
        <OpRow key={op.id} op={op} index={i} selected={op.id === selectedOpId} />
      ))}
    </div>
  );
}

function OpRow({ op, index, selected }: { op: Operation; index: number; selected: boolean }) {
  const label =
    op.kind === 'drop'
      ? `滴墨 · ${op.rings.length} 环 · r${op.rings[0].outerRadius.toFixed(1)}mm`
      : `${TOOL_NAME[op.tool]} · ${op.passes} 来回 · 齿距${op.spacing.toFixed(1)}mm`;
  const colors = op.kind === 'drop' ? op.rings.map((r) => r.pigmentId) : [];
  const palette = studioStore.getState().project.palette;

  return (
    <div
      className={`op-item ${selected ? 'selected' : ''}`}
      onClick={() => studioStore.selectOp(selected ? null : op.id)}
    >
      <span className="seq">{index + 1}</span>
      <span className="grow">{label}</span>
      {colors.map((id, i) => {
        const p = palette.find((q) => q.id === id);
        return (
          <span
            key={i}
            className="swatch"
            style={{ background: p ? rgbCss(p.color) : '#999' }}
            title={p?.name}
          />
        );
      })}
      <button
        className="btn small ghost"
        onClick={(e) => {
          e.stopPropagation();
          studioStore.deleteOperation(op.id);
        }}
        title="删除该工序"
      >
        删
      </button>
    </div>
  );
}

function rgbCss(c: [number, number, number]): string {
  return `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
}
