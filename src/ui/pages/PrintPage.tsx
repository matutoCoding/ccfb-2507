import { useEffect, useRef, useState } from 'react';
import { useStudio } from '../../engine/store';
import { exportPng, mmToPx, type ExportResult } from '../../export/exporter';
import { rgbToCmyk, isOutOfGamut, singlePlateToSrgb } from '../../engine/color';
import { recolorOperations } from '../../engine/project';
import { BUILTIN_PIGMENTS } from '../../engine/pigments';
import type { BookFormat, Project } from '../../engine/types';
import { MarblingCanvas } from '../MarblingCanvas';
import type { MarblingRenderer } from '../../gl/MarblingRenderer';
import { downloadBlob } from '../../engine/geometry';

const FORMATS: BookFormat[] = [
  { id: 'a4', name: 'A4（16 开）', widthMm: 210, heightMm: 297 },
  { id: 'a3', name: 'A3（8 开）', widthMm: 297, heightMm: 420 },
  { id: 'b5', name: 'B5（大 32 开）', widthMm: 176, heightMm: 250 },
  { id: '32k', name: '小 32 开', widthMm: 130, heightMm: 184 },
  { id: '16k', name: '正 16 开', widthMm: 184, heightMm: 260 },
];

type PlateMode = 'rgb' | 'c' | 'm' | 'y' | 'k' | 'gamut';

export function PrintPage() {
  const state = useStudio();
  const { project } = state;
  const [format, setFormat] = useState<BookFormat>(FORMATS[1]);
  const [dpi, setDpi] = useState<300 | 600>(600);
  const [mirror, setMirror] = useState(true);
  const [plate, setPlate] = useState<PlateMode>('rgb');
  const [gamutThreshold, setGamutThreshold] = useState(6);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<ExportResult | null>(null);
  const rendererRef = useRef<MarblingRenderer | null>(null);

  const pxW = mmToPx(format.widthMm, dpi);
  const pxH = mmToPx(format.heightMm, dpi);

  async function doExport(alsoMirror: boolean) {
    if (!rendererRef.current) return;
    setBusy(true);
    setProgress(0);
    try {
      const sized: Project = { ...project, widthMm: format.widthMm, heightMm: format.heightMm };
      const result = await exportPng(rendererRef.current, sized, {
        dpi,
        samples: dpi >= 600 ? 1 : 4,
        lightTilt: state.lightTilt,
        onProgress: (f, m) => { setProgress(f); setMessage(m); },
      });
      downloadBlob(result.blob, `${project.name}_${format.id}_${dpi}dpi.png`);
      if (alsoMirror) {
        const mirrored: Project = {
          ...sized,
          operations: sized.operations.map((op) =>
            op.kind === 'drop'
              ? { ...op, x: -op.x }
              : op.kind === 'comb'
                ? { ...op, start: { ...op.start, x: -op.start.x }, end: { ...op.end, x: -op.end.x } }
                : op,
          ),
        };
        setMessage('正在渲染右衬页（镜像）…');
        const r2 = await exportPng(rendererRef.current, mirrored, {
          dpi, samples: 1, lightTilt: state.lightTilt,
          onProgress: (f, m) => { setProgress(f); setMessage(m); },
        });
        downloadBlob(r2.blob, `${project.name}_${format.id}_${dpi}dpi_镜像.png`);
      }
      setLastResult(result);
    } catch (e) {
      alert(`导出失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <aside className="sidebar">
        <div className="panel">
          <h3>开本与分辨率</h3>
          <label className="field">
            <span>书的开本</span>
            <select value={format.id} onChange={(e) => setFormat(FORMATS.find((f) => f.id === e.target.value)!)}>
              {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.name} · {f.widthMm}×{f.heightMm}mm</option>)}
            </select>
          </label>
          <div className="row">
            <button className={`btn small ${dpi === 300 ? '' : 'ghost'}`} onClick={() => setDpi(300)}>300 dpi</button>
            <button className={`btn small ${dpi === 600 ? '' : 'ghost'}`} onClick={() => setDpi(600)}>600 dpi</button>
          </div>
          <p className="muted" style={{ marginTop: 6 }}>
            输出像素 {pxW} × {pxH}（{(pxW * pxH / 1e6).toFixed(1)} MP），PNG 内嵌 pHYs 物理分辨率。
          </p>
          <label className="field" style={{ marginTop: 8 }}>
            <span>
              <input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /> 同时导出左右镜像衬页
            </span>
          </label>
        </div>

        <div className="panel">
          <h3>分色预览（简化胶印模型）</h3>
          <div className="toolbar">
            {([['rgb', '合成'], ['c', '青 C'], ['m', '品 M'], ['y', '黄 Y'], ['k', '黑 K'], ['gamut', '色域报警']] as Array<[PlateMode, string]>).map(
              ([m, n]) => <span key={m} className={`chip ${plate === m ? 'active' : ''}`} onClick={() => setPlate(m)}>{n}</span>,
            )}
          </div>
          <label className="field" style={{ marginTop: 8 }}>
            <span>色域报警阈值 ΔE <b className="value-badge">{gamutThreshold}</b></span>
            <input type="range" min={2} max={12} step={0.5} value={gamutThreshold}
              onChange={(e) => setGamutThreshold(+e.target.value)} />
          </label>
          <p className="muted">
            Beer-Lambert 吸光近似 + UCR 黑版，用于预检；正式制版请接打印机 ICC profile。
          </p>
        </div>

        <div className="panel">
          <h3>导出</h3>
          <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={() => doExport(mirror)}>
            {busy ? '导出中…' : `导出 ${dpi}dpi PNG${mirror ? '（含镜像）' : ''}`}
          </button>
          {busy && (
            <div style={{ marginTop: 10 }}>
              <div className="progress"><div style={{ width: `${progress * 100}%` }} /></div>
              <div className="muted" style={{ marginTop: 4 }}>{message}</div>
            </div>
          )}
          {lastResult && !busy && (
            <p className="muted" style={{ marginTop: 8 }}>
              上次导出 {lastResult.widthPx}×{lastResult.heightPx}，耗时 <b className="value-badge">
              {(lastResult.elapsedMs / 1000).toFixed(1)} 秒</b>（目标 ≤20 秒）
            </p>
          )}
        </div>
      </aside>

      <main className="main">
        <div className="panel" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <h3>版面预览 · {format.name}{mirror ? ' · 左右衬页镜像对称' : ''}</h3>
          <div className="canvas-stage">
            <PlatePreview plate={plate} gamutThreshold={gamutThreshold} format={format} mirror={mirror} />
          </div>
          <div style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}>
            <MarblingCanvas
              project={{ ...project, widthMm: format.widthMm, heightMm: format.heightMm }}
              samples={1}
              onRenderer={(r) => (rendererRef.current = r)}
            />
          </div>
        </div>
        <div className="panel">
          <h3>系列配色（同一套工序，换配色并排）</h3>
          <SeriesSection />
        </div>
      </main>
    </>
  );
}

/** 分色/色域预览：取设计渲染 canvas 的 2D 快照逐像素处理 */
function PlatePreview({ plate, gamutThreshold, format, mirror }: {
  plate: PlateMode;
  gamutThreshold: number;
  format: BookFormat;
  mirror: boolean;
}) {
  const { project, lightTilt } = useStudio();
  const srcRef = useRef<HTMLCanvasElement | null>(null);
  const outRef = useRef<HTMLCanvasElement>(null);

  const sized = { ...project, widthMm: format.widthMm, heightMm: format.heightMm };

  function process() {
    const src = srcRef.current;
    const out = outRef.current;
    if (!src || !out) return;
    const w = src.width;
    const h = src.height;
    out.width = w;
    out.height = h;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    if (plate === 'rgb' && !mirror) return;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const rgb: [number, number, number] = [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255];
      if (plate === 'gamut') {
        const out2 = isOutOfGamut(rgb, gamutThreshold);
        if (out2) {
          d[i] = 230; d[i + 1] = 40; d[i + 2] = 30;
        } else {
          const v = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
          d[i] = d[i + 1] = d[i + 2] = v;
        }
      } else if (plate !== 'rgb') {
        const cmyk = rgbToCmyk(rgb);
        const amount = cmyk[plate as 'c' | 'm' | 'y' | 'k'];
        const srgb = singlePlateToSrgb(plate as 'c' | 'm' | 'y' | 'k', amount);
        d[i] = srgb[0] * 255;
        d[i + 1] = srgb[1] * 255;
        d[i + 2] = srgb[2] * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (mirror) {
      // 右半画镜像稿：简化处理为水平翻转显示
      const tmp = document.createElement('canvas');
      tmp.width = w;
      tmp.height = h;
      tmp.getContext('2d')!.drawImage(out, 0, 0);
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.globalAlpha = 0.85;
      ctx.drawImage(tmp, -w / 2, 0, w / 2, h);
      ctx.restore();
    }
  }

  // 项目/分色模式变化后，等 MarblingCanvas 重绘完成再处理快照
  useEffect(() => {
    const id = window.setTimeout(process, 80);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, plate, gamutThreshold, mirror, format]);

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', maxWidth: '100%' }}>
      <div style={{ position: 'relative', height: '78vh' }}>
        <canvas ref={outRef} style={{ maxHeight: '78vh', border: '1px solid var(--line)', background: '#fff' }} />
        {mirror && (
          <div className="muted" style={{ position: 'absolute', top: 6, left: 8, background: 'rgba(255,255,255,0.8)', padding: '2px 8px', borderRadius: 4 }}>
            左：原版 ｜ 右：镜像（书脊中线对称）
          </div>
        )}
      </div>
      <div style={{ width: 1, height: 1, overflow: 'hidden', position: 'absolute' }}>
        <MarblingCanvas project={sized} samples={1} lightTilt={lightTilt} canvasRef={srcRef} />
      </div>
      <button className="btn ghost small" onClick={process}>刷新分色预览</button>
    </div>
  );
}

/** 系列配色：同一工序换 N 套配色并排 */
export function SeriesSection() {
  const { project } = useStudio();
  const variants = [
    { name: '原配色', map: new Map<string, string>() },
    {
      name: '暖金系列',
      map: new Map(
        project.palette.filter((p) => p.kind === 'standard').map((p, i) => {
          const warm = [BUILTIN_PIGMENTS.find((q) => q.id === 'pg-vermilion')!, BUILTIN_PIGMENTS.find((q) => q.id === 'pg-ochre')!, BUILTIN_PIGMENTS.find((q) => q.id === 'pg-gold')!];
          return [p.id, warm[i % warm.length].id];
        }),
      ),
    },
    {
      name: '青蓝系列',
      map: new Map(
        project.palette.filter((p) => p.kind === 'standard').map((p, i) => {
          const cool = [BUILTIN_PIGMENTS.find((q) => q.id === 'pg-prussian')!, BUILTIN_PIGMENTS.find((q) => q.id === 'pg-ultramarine')!, BUILTIN_PIGMENTS.find((q) => q.id === 'pg-viridian')!];
          return [p.id, cool[i % cool.length].id];
        }),
      ),
    },
  ];

  return (
    <div className="grid-3">
      {variants.map((v) => {
        const operations = recolorOperations(project.operations, v.map);
        // 变体可能引用当前调色板之外的颜料，补齐调色板避免着色器找不到 id
        const extra = BUILTIN_PIGMENTS.filter(
          (q) => !project.palette.some((p) => p.id === q.id) &&
            operations.some((o) => o.kind === 'drop' && o.rings.some((r) => r.pigmentId === q.id)),
        );
        const p: Project = { ...project, operations, palette: [...project.palette, ...extra] };
        return (
          <div key={v.name} className="series-card">
            <h4>{v.name}</h4>
            <div style={{ height: 200 }} className="canvas-stage">
              <MarblingCanvas project={p} samples={1} />
            </div>
            <div className="muted" style={{ fontSize: 10, marginTop: 4 }}>同工序 · 换配色</div>
          </div>
        );
      })}
    </div>
  );
}
