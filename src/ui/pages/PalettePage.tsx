import { useState } from 'react';
import { studioStore, useStudio } from '../../engine/store';
import { BUILTIN_PIGMENTS, CUSTOM_PIGMENT_PREFIX } from '../../engine/pigments';
import { nextId } from '../../engine/project';
import { rgbToHex, hexToRgb, gamutDistance } from '../../engine/color';
import type { Pigment } from '../../engine/types';
import { MarblingCanvas } from '../MarblingCanvas';

export function PalettePage() {
  const { project } = useStudio();
  const [selectedId, setSelectedId] = useState(project.palette[0]?.id ?? '');
  const selected = project.palette.find((p) => p.id === selectedId) ?? project.palette[0];

  function update(patch: Partial<Pigment>) {
    if (!selected) return;
    const palette = project.palette.map((p) => (p.id === selected.id ? { ...p, ...patch } : p));
    studioStore.commitProject({ ...project, palette });
  }

  function addCustom() {
    const pg: Pigment = {
      id: `${CUSTOM_PIGMENT_PREFIX}${nextId('p')}`,
      name: `自定义颜料 ${project.palette.length + 1}`,
      kind: 'standard',
      color: [0.4, 0.3, 0.25],
      diffusion: 0.45,
      gall: 0.4,
      opacity: 0.95,
    };
    studioStore.commitProject({ ...project, palette: [...project.palette, pg] });
    setSelectedId(pg.id);
  }

  function remove(id: string) {
    const used = project.operations.some((o) => o.kind === 'drop' && o.rings.some((r) => r.pigmentId === id));
    if (used && !confirm('该颜料正被工序引用，删除后相关色环会显示为纸基色。确认删除？')) return;
    studioStore.commitProject({ ...project, palette: project.palette.filter((p) => p.id !== id) });
  }

  function addBuiltin(p: Pigment) {
    if (project.palette.some((q) => q.id === p.id)) return;
    studioStore.commitProject({ ...project, palette: [...project.palette, p] });
  }

  const available = BUILTIN_PIGMENTS.filter((p) => !project.palette.some((q) => q.id === p.id));

  return (
    <>
      <aside className="sidebar">
        <div className="panel">
          <h3>当前调色板（{project.palette.length}）</h3>
          {project.palette.map((p) => (
            <div key={p.id} className={`op-item ${selected?.id === p.id ? 'selected' : ''}`} onClick={() => setSelectedId(p.id)}>
              <span className="swatch" style={{ background: rgbToHex(p.color) }} />
              <span className="grow">{p.name}{p.kind === 'metallic' ? ' ✦' : ''}</span>
              <button className="btn small danger" onClick={(e) => { e.stopPropagation(); remove(p.id); }}>删</button>
            </div>
          ))}
          <button className="btn" style={{ width: '100%', marginTop: 8 }} onClick={addCustom}>+ 自定义颜料</button>
        </div>
        <div className="panel">
          <h3>内置颜料库</h3>
          {available.length === 0 && <div className="muted">已全部加入调色板</div>}
          {available.map((p) => (
            <div key={p.id} className="op-item" onClick={() => addBuiltin(p)}>
              <span className="swatch" style={{ background: rgbToHex(p.color) }} />
              <span className="grow">{p.name}</span>
              <span className="muted">+ 加入</span>
            </div>
          ))}
        </div>
      </aside>

      <main className="main">
        {selected ? (
          <div className="grid-2" style={{ overflowY: 'auto' }}>
            <div className="panel">
              <h3>颜料参数 · {selected.name}</h3>
              <label className="field">
                <span>名称</span>
                <input type="text" value={selected.name} onChange={(e) => update({ name: e.target.value })} />
              </label>
              <label className="field">
                <span>颜色（sRGB）</span>
                <input type="color" value={rgbToHex(selected.color)}
                  onChange={(e) => update({ color: hexToRgb(e.target.value) })} />
              </label>
              <div className="grid-2">
                <label className="field">
                  <span>类型</span>
                  <select value={selected.kind} onChange={(e) => update({ kind: e.target.value as Pigment['kind'] })}>
                    <option value="standard">普通色料</option>
                    <option value="metallic">金属粉</option>
                    <option value="base">基底色</option>
                  </select>
                </label>
                <label className="field">
                  <span>不透明度 <b className="value-badge">{selected.opacity.toFixed(2)}</b></span>
                  <input type="range" min={0.3} max={1} step={0.01} value={selected.opacity}
                    onChange={(e) => update({ opacity: +e.target.value })} />
                </label>
              </div>
              <label className="field">
                <span>扩散性 <b className="value-badge">{selected.diffusion.toFixed(2)}</b> — 越大滴入铺展半径越大</span>
                <input type="range" min={0.05} max={1} step={0.01} value={selected.diffusion}
                  onChange={(e) => update({ diffusion: +e.target.value })} />
              </label>
              <label className="field">
                <span>胆汁用量 <b className="value-badge">{selected.gall.toFixed(2)}</b> — 越高边缘白圈越明显</span>
                <input type="range" min={0} max={1} step={0.01} value={selected.gall}
                  onChange={(e) => update({ gall: +e.target.value })} />
              </label>
              {selected.kind === 'metallic' && (
                <div className="grid-2">
                  <label className="field">
                    <span>金属度 <b className="value-badge">{(selected.metallic?.metalness ?? 0.8).toFixed(2)}</b></span>
                    <input type="range" min={0} max={1} step={0.01} value={selected.metallic?.metalness ?? 0.8}
                      onChange={(e) => update({ metallic: { ...selected.metallic!, metalness: +e.target.value } })} />
                  </label>
                  <label className="field">
                    <span>粗糙度 <b className="value-badge">{(selected.metallic?.roughness ?? 0.35).toFixed(2)}</b></span>
                    <input type="range" min={0.05} max={1} step={0.01} value={selected.metallic?.roughness ?? 0.35}
                      onChange={(e) => update({ metallic: { ...selected.metallic!, roughness: +e.target.value } })} />
                  </label>
                  <label className="field">
                    <span>金粉密度 <b className="value-badge">{(selected.metallic?.flakeDensity ?? 0.6).toFixed(2)}</b></span>
                    <input type="range" min={0} max={1} step={0.01} value={selected.metallic?.flakeDensity ?? 0.6}
                      onChange={(e) => update({ metallic: { ...selected.metallic!, flakeDensity: +e.target.value } })} />
                  </label>
                </div>
              )}
              <GamutBadge color={selected.color} />
            </div>
            <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
              <h3>实时预览（参数改动立即重算）</h3>
              <div className="canvas-stage" style={{ minHeight: 320 }}>
                <MarblingCanvas />
              </div>
            </div>
          </div>
        ) : (
          <div className="muted">调色板为空，请先添加颜料。</div>
        )}
      </main>
    </>
  );
}

function GamutBadge({ color }: { color: [number, number, number] }) {
  const dist = gamutDistance(color);
  const out = dist > 6;
  return (
    <div style={{ marginTop: 8, padding: 10, borderRadius: 6, background: out ? '#f6e0db' : '#e2eee0', fontSize: 12 }}>
      {out ? (
        <>⚠ 该色超出简化胶印色域（ΔE={dist.toFixed(1)}），印刷输出页会标红，建议降低饱和度。</>
      ) : (
        <>✓ 在简化胶印色域内（ΔE={dist.toFixed(1)}）。模型为近似，正式印前请以 ICC 为准。</>
      )}
    </div>
  );
}
