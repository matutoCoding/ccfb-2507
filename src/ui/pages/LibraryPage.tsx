import { useState } from 'react';
import { studioStore, useStudio } from '../../engine/store';
import { RECIPES } from '../../engine/recipes';
import { buildCombOp, buildDropOp, createProject } from '../../engine/project';
import { serializeProject, deserializeProject } from '../../engine/project';
import { MarblingCanvas } from '../MarblingCanvas';
import type { Project } from '../../engine/types';
import { downloadBlob } from '../../engine/geometry';

/** 把配方计划物化成一个新项目（同种子 => 同结果） */
function buildRecipeProject(recipeId: string, seed: number): Project {
  const recipe = RECIPES.find((r) => r.id === recipeId)!;
  const project = createProject(recipe.name);
  const paletteIds = project.palette.map((p) => p.id);
  const plan = recipe.build({ widthMm: project.widthMm, heightMm: project.heightMm, paletteIds, seed });
  plan.drops.forEach((d) => {
    const op = buildDropOp(project, {
      x: d.x,
      y: d.y,
      pigmentIds: d.pigmentCycle.slice(0, d.radii.length),
      baseRadiusMm: d.radii[0],
    });
    // 配方半径是精确给定的，直接覆盖（绕过扩散性二次修正）
    op.rings.forEach((ring, i) => (ring.outerRadius = d.radii[i]));
    project.operations.push(op);
  });
  if (plan.combo) {
    const req = { ...plan.combo };
    const op = buildCombOp(project, req, seed);
    project.operations.push(op);
  }
  return project;
}

export function LibraryPage({ onOpen }: { onOpen: () => void }) {
  const { project } = useStudio();
  const [seed, setSeed] = useState(20261120);
  const [previewId, setPreviewId] = useState<string | null>(null);

  function loadRecipe(id: string) {
    const p = buildRecipeProject(id, seed);
    studioStore.loadProject(p);
    onOpen();
  }

  function exportJson() {
    const blob = new Blob([serializeProject(project)], { type: 'application/json' });
    downloadBlob(blob, `${project.name || 'marbling'}.json`);
  }

  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const p = deserializeProject(String(reader.result));
        studioStore.loadProject(p);
        onOpen();
      } catch (e) {
        alert(`工程文件无效：${(e as Error).message}`);
      }
    };
    reader.readAsText(file);
  }

  return (
    <main className="main" style={{ overflowY: 'auto' }}>
      <div className="panel">
        <h3>经典纹样配方（按真实浮染工序组织）</h3>
        <p className="muted">
          每个配方由确定性序列生成：固定种子下逐滴位置、色环半径、波浪相位完全一致。载入后可在操作台上继续追加工序。
        </p>
        <label className="field" style={{ maxWidth: 260 }}>
          <span>配方种子 <b className="value-badge">{seed}</b></span>
          <input type="number" value={seed} onChange={(e) => setSeed(+e.target.value)} />
        </label>
        <div className="grid-2">
          {RECIPES.map((r) => (
            <div key={r.id} className="series-card" style={{ textAlign: 'left' }}>
              <h4 style={{ margin: '4px 0' }}>{r.name}</h4>
              <p className="muted" style={{ minHeight: 32 }}>{r.desc}</p>
              <div className="row">
                <button className="btn small" onClick={() => loadRecipe(r.id)}>载入到操作台</button>
                <button className="btn small ghost" onClick={() => setPreviewId(previewId === r.id ? null : r.id)}>
                  {previewId === r.id ? '关闭预览' : '快速预览'}
                </button>
              </div>
              {previewId === r.id && <RecipePreview recipeId={r.id} seed={seed} />}
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>工程存取（出图不存位图，只存工序 JSON）</h3>
        <div className="toolbar">
          <button className="btn ghost" onClick={exportJson}>导出工序 JSON</button>
          <label className="btn ghost" style={{ cursor: 'pointer' }}>
            导入工序 JSON
            <input type="file" accept=".json,application/json" hidden onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJson(f);
              e.target.value = '';
            }} />
          </label>
          <button className="btn ghost" onClick={() => { studioStore.loadProject(createProject()); onOpen(); }}>
            新建空白工程
          </button>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          当前工程：{project.name}，{project.operations.length} 道工序，纸面 {project.widthMm}×{project.heightMm}mm
        </p>
      </div>
    </main>
  );
}

function RecipePreview({ recipeId, seed }: { recipeId: string; seed: number }) {
  const project = buildRecipeProject(recipeId, seed);
  return (
    <div style={{ height: 260, marginTop: 8 }} className="canvas-stage">
      <MarblingCanvas project={project} samples={1} />
    </div>
  );
}
