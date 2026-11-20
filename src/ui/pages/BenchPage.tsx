import { useRef, useState } from 'react';
import { MarblingCanvas } from '../MarblingCanvas';
import { OperationList } from '../OperationList';
import { studioStore, useStudio } from '../../engine/store';
import { buildCombOp, buildDropOp } from '../../engine/project';
import type { CombOp, Vec2 } from '../../engine/types';
import { MAX_DROPS, MAX_STROKES, type MarblingRenderer } from '../../gl/MarblingRenderer';
import { flattenOps } from '../../gl/MarblingRenderer';

type Tool = 'drop' | 'single' | 'multi' | 'wavy';

export function BenchPage() {
  const state = useStudio();
  const { project } = state;
  const [tool, setTool] = useState<Tool>('drop');
  const [baseRadius, setBaseRadius] = useState(22);
  const [ringCount, setRingCount] = useState(3);
  const [toothWidth, setToothWidth] = useState(5);
  const [strength, setStrength] = useState(3.5);
  const [spacing, setSpacing] = useState(8);
  const [teethCount, setTeethCount] = useState(7);
  const [wavyAmp, setWavyAmp] = useState(9);
  const [wavyLen, setWavyLen] = useState(34);
  const [passes, setPasses] = useState(1);
  const [dragStart, setDragStart] = useState<Vec2 | null>(null);
  const [counts, setCounts] = useState({ dropCount: 0, strokeCount: 0 });
  const rendererRef = useRef<MarblingRenderer | null>(null);

  const flat = flattenOps(project.operations);

  function eventToMm(e: React.MouseEvent<HTMLDivElement>): Vec2 {
    const stage = e.currentTarget.getBoundingClientRect();
    const canvas = e.currentTarget.querySelector('canvas')!.getBoundingClientRect();
    const nx = (e.clientX - canvas.left) / canvas.width;
    const ny = (e.clientY - canvas.top) / canvas.height;
    void stage;
    return {
      x: nx * project.widthMm - project.widthMm / 2,
      y: ny * project.heightMm - project.heightMm / 2,
    };
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (tool !== 'drop') return;
    if (flat.drops.length >= MAX_DROPS) {
      alert(`已达到滴墨上限 ${MAX_DROPS} 滴`);
      return;
    }
    const p = eventToMm(e);
    const ids = project.palette.filter((q) => q.kind !== 'base').map((q) => q.id);
    if (ids.length === 0) return;
    const pigmentIds = Array.from({ length: Math.min(ringCount, 8) }, (_, i) => ids[i % ids.length]);
    const op = buildDropOp(project, { x: p.x, y: p.y, pigmentIds, baseRadiusMm: baseRadius });
    studioStore.addOperation(op);
  }

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (tool === 'drop') return;
    setDragStart(eventToMm(e));
  }
  function handleMouseUp(e: React.MouseEvent<HTMLDivElement>) {
    if (!dragStart || tool === 'drop') return;
    const end = eventToMm(e);
    const dist = Math.hypot(end.x - dragStart.x, end.y - dragStart.y);
    if (dist < 8) {
      setDragStart(null);
      return; // 太短视为误触
    }
    if (flat.strokes.length + teethCount * passes > MAX_STROKES) {
      alert(`齿痕段将超过上限 ${MAX_STROKES}，请减少齿数或来回次数`);
      setDragStart(null);
      return;
    }
    const combTool = tool as CombOp['tool'];
    const dir = norm(sub(end, dragStart));
    const toothDir = { x: -dir.y, y: dir.x };
    const op = buildCombOp(project, {
      tool: combTool,
      start: dragStart,
      end,
      toothLength: (combTool === 'single' ? Math.min(project.widthMm, project.heightMm) * 0.9 : teethCount * spacing + toothWidth),
      toothWidth,
      strength,
      spacing,
      teethCount: combTool === 'single' ? 1 : teethCount,
      wavyAmplitude: combTool === 'wavy' ? wavyAmp : 0,
      wavyWavelength: combTool === 'wavy' ? wavyLen : 0,
      passes,
    });
    void toothDir;
    studioStore.addOperation(op);
    setDragStart(null);
  }

  return (
    <>
      <aside className="sidebar">
        <div className="panel">
          <h3>工具</h3>
          <div className="toolbar">
            <span className={`chip ${tool === 'drop' ? 'active' : ''}`} onClick={() => setTool('drop')}>滴墨</span>
            <span className={`chip ${tool === 'single' ? 'active' : ''}`} onClick={() => setTool('single')}>单齿梳</span>
            <span className={`chip ${tool === 'multi' ? 'active' : ''}`} onClick={() => setTool('multi')}>多齿梳</span>
            <span className={`chip ${tool === 'wavy' ? 'active' : ''}`} onClick={() => setTool('wavy')}>波浪梳</span>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            {tool === 'drop' ? '在画布上点击落墨，每滴自动把已有色环向外推（面积守恒）。' : '按住拖动画出梳齿行进路径，松开完成。'}
          </p>
        </div>

        {tool === 'drop' && (
          <div className="panel">
            <h3>滴墨参数</h3>
            <label className="field">
              <span>基础半径 <b className="value-badge">{baseRadius.toFixed(1)} mm</b>（实际随颜料扩散性变化）</span>
              <input type="range" min={4} max={60} step={0.5} value={baseRadius} onChange={(e) => setBaseRadius(+e.target.value)} />
            </label>
            <label className="field">
              <span>同心环数 <b className="value-badge">{ringCount}</b></span>
              <input type="range" min={1} max={8} step={1} value={ringCount} onChange={(e) => setRingCount(+e.target.value)} />
            </label>
            <p className="muted">环颜料按配色页色序循环取用。</p>
          </div>
        )}

        {tool !== 'drop' && (
          <div className="panel">
            <h3>梳齿参数</h3>
            <label className="field">
              <span>齿痕宽度 w <b className="value-badge">{toothWidth.toFixed(1)} mm</b></span>
              <input type="range" min={1} max={16} step={0.5} value={toothWidth} onChange={(e) => setToothWidth(+e.target.value)} />
            </label>
            <label className="field">
              <span>位移强度 s <b className="value-badge">{strength.toFixed(1)} mm</b>（约束 s≤w 保证可逆）</span>
              <input type="range" min={0.5} max={16} step={0.1} value={Math.min(strength, toothWidth * 0.98)}
                onChange={(e) => setStrength(+e.target.value)} />
            </label>
            {tool === 'multi' && (
              <>
                <label className="field">
                  <span>齿距 <b className="value-badge">{spacing.toFixed(1)} mm</b></span>
                  <input type="range" min={3} max={20} step={0.5} value={spacing} onChange={(e) => setSpacing(+e.target.value)} />
                </label>
                <label className="field">
                  <span>齿数 <b className="value-badge">{teethCount}</b></span>
                  <input type="range" min={2} max={24} step={1} value={teethCount} onChange={(e) => setTeethCount(+e.target.value)} />
                </label>
              </>
            )}
            {tool === 'wavy' && (
              <>
                <label className="field">
                  <span>波浪振幅 <b className="value-badge">{wavyAmp} mm</b></span>
                  <input type="range" min={2} max={24} step={1} value={wavyAmp} onChange={(e) => setWavyAmp(+e.target.value)} />
                </label>
                <label className="field">
                  <span>波长 <b className="value-badge">{wavyLen} mm</b></span>
                  <input type="range" min={12} max={80} step={1} value={wavyLen} onChange={(e) => setWavyLen(+e.target.value)} />
                </label>
              </>
            )}
            <label className="field">
              <span>来回次数 <b className="value-badge">{passes}</b></span>
              <input type="range" min={1} max={4} step={1} value={passes} onChange={(e) => setPasses(+e.target.value)} />
            </label>
          </div>
        )}

        <div className="panel">
          <h3>工序（{project.operations.length}）</h3>
          <OperationList />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn ghost" onClick={() => studioStore.undo()} disabled={state.history.length === 0}>撤销</button>
            <button className="btn ghost" onClick={() => studioStore.redo()} disabled={state.future.length === 0}>重做</button>
          </div>
          <p className="muted" style={{ marginTop: 8 }}>
            渲染输入：{counts.dropCount} 滴 / {counts.strokeCount} 齿痕段。删除中间工序后从头重算，不存任何位图。
          </p>
        </div>

        <div className="panel">
          <h3>观察与画质</h3>
          <label className="field">
            <span>观察倾角（金属反光）<b className="value-badge">{state.lightTilt.toFixed(2)}</b></span>
            <input type="range" min={0} max={1} step={0.01} value={state.lightTilt}
              onChange={(e) => studioStore.setLightTilt(+e.target.value)} />
          </label>
          <div className="row">
            <button className={`btn small ${state.samples === 1 ? '' : 'ghost'}`} onClick={() => studioStore.setSamples(1)}>单样本（快）</button>
            <button className={`btn small ${state.samples === 4 ? '' : 'ghost'}`} onClick={() => studioStore.setSamples(4)}>4× 抗锯齿</button>
          </div>
        </div>
      </aside>

      <main className="main">
        <div
          className="canvas-stage"
          style={{ cursor: tool === 'drop' ? 'crosshair' : 'crosshair' }}
          onClick={handleClick}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
        >
          <MarblingCanvas onRenderer={(r) => (rendererRef.current = r)} onCounts={setCounts} />
          {dragStart && <div className="muted" style={{ position: 'absolute', bottom: 10, left: 12 }}>松开完成梳齿…</div>}
        </div>
      </main>
    </>
  );
}

function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}
function norm(v: Vec2): Vec2 {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
}
