import { useRef, useState } from 'react';
import { useStudio } from '../../engine/store';
import { generateAgedPaper, type AgedPaperOptions } from '../../engine/agedPaper';
import { srgbToLab, deltaE2000, rgbToHex } from '../../engine/color';
import { expandPolygon, pointInPolygon, polygonBounds, downloadBlob } from '../../engine/geometry';
import type { Vec2 } from '../../engine/types';
import { MarblingCanvas } from '../MarblingCanvas';

type Tab = 'import' | 'compare' | 'cut';
const STAGE_W = 760;
const STAGE_H = 1000;

export function MatchPage() {
  const { project } = useStudio();
  const [tab, setTab] = useState<Tab>('import');
  const [photoCanvas, setPhotoCanvas] = useState<HTMLCanvasElement | null>(null);
  const [genOpts, setGenOpts] = useState<AgedPaperOptions>({
    widthPx: 900, heightPx: 1200, seed: 7, yellowing: 0.6, waterStains: 5,
    missingCorners: 2, folds: 2, faintMarbling: true,
  });
  const [polygon, setPolygon] = useState<Vec2[]>([]);
  const [overlapMm, setOverlapMm] = useState(2);
  const [opacity, setOpacity] = useState(0.55);
  const [blockSize, setBlockSize] = useState(16);
  const [heatUrl, setHeatUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<{ mean: number; max: number; p95: number } | null>(null);
  const designCanvasRef = useRef<HTMLCanvasElement | null>(null);

  function onUpload(file: File) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = STAGE_W;
      c.height = STAGE_H;
      c.getContext('2d')!.drawImage(img, 0, 0, STAGE_W, STAGE_H);
      setPhotoCanvas(c);
      setPolygon([]);
      setHeatUrl(null);
      setTab('compare');
    };
    img.src = URL.createObjectURL(file);
  }

  function generate() {
    const c = generateAgedPaper({ ...genOpts, widthPx: STAGE_W, heightPx: STAGE_H });
    setPhotoCanvas(c);
    setPolygon([]);
    setHeatUrl(null);
    setTab('compare');
  }

  function stageClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setPolygon((poly) => [
      ...poly,
      {
        x: (e.clientX - rect.left) / rect.width,
        y: (e.clientY - rect.top) / rect.height,
      },
    ]);
  }

  function computeDeltaE() {
    if (!photoCanvas || polygon.length < 3) {
      alert('请先在残页上框出至少 3 个点的配补区域');
      return;
    }
    const design = designCanvasRef.current;
    if (!design) return;
    const w = STAGE_W;
    const h = STAGE_H;
    const pctx = photoCanvas.getContext('2d')!;
    const photoData = pctx.getImageData(0, 0, w, h).data;
    const dc = document.createElement('canvas');
    dc.width = w;
    dc.height = h;
    dc.getContext('2d')!.drawImage(design, 0, 0, w, h);
    const designData = dc.getContext('2d')!.getImageData(0, 0, w, h).data;

    const heat = new ImageData(w, h);
    const values: number[] = [];
    for (let by = 0; by < h; by += blockSize) {
      for (let bx = 0; bx < w; bx += blockSize) {
        let sum = 0;
        let n = 0;
        const inside: Array<[number, number]> = [];
        for (let y = by; y < Math.min(by + blockSize, h); y++) {
          for (let x = bx; x < Math.min(bx + blockSize, w); x++) {
            if (!pointInPolygon({ x: x / w, y: y / h }, polygon)) continue;
            const i = (y * w + x) * 4;
            const lab1 = srgbToLab([photoData[i] / 255, photoData[i + 1] / 255, photoData[i + 2] / 255]);
            const lab2 = srgbToLab([designData[i] / 255, designData[i + 1] / 255, designData[i + 2] / 255]);
            sum += deltaE2000(lab1, lab2);
            n++;
            inside.push([x, y]);
          }
        }
        if (n === 0) continue;
        const mean = sum / n;
        values.push(mean);
        const [r, g, b2] = heatColor(mean);
        for (const [x, y] of inside) {
          const i = (y * w + x) * 4;
          heat.data[i] = r;
          heat.data[i + 1] = g;
          heat.data[i + 2] = b2;
          heat.data[i + 3] = 170;
        }
      }
    }
    const hc = document.createElement('canvas');
    hc.width = w;
    hc.height = h;
    hc.getContext('2d')!.putImageData(heat, 0, 0);
    setHeatUrl(hc.toDataURL());
    values.sort((a, b) => a - b);
    setStats({
      mean: values.reduce((a, b) => a + b, 0) / Math.max(1, values.length),
      max: values.at(-1) ?? 0,
      p95: values[Math.floor(values.length * 0.95)] ?? 0,
    });
  }

  function cutRegion() {
    const design = designCanvasRef.current;
    if (!design || polygon.length < 3) return;
    const b = polygonBounds(polygon);
    const pxPerMm = STAGE_W / 210; // 残页按 A4 宽标定
    const pad = overlapMm * pxPerMm;
    const x0 = Math.max(0, b.minX * STAGE_W - pad);
    const y0 = Math.max(0, b.minY * STAGE_H - pad);
    const x1 = Math.min(STAGE_W, b.maxX * STAGE_W + pad);
    const y1 = Math.min(STAGE_H, b.maxY * STAGE_H + pad);
    const out = document.createElement('canvas');
    out.width = Math.round(x1 - x0);
    out.height = Math.round(y1 - y0);
    const ctx = out.getContext('2d')!;
    ctx.save();
    ctx.beginPath();
    expandPolygon(polygon, overlapMm / 210).forEach((p, i) => {
      const x = p.x * STAGE_W - x0;
      const y = p.y * STAGE_H - y0;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(design, -x0, -y0);
    ctx.restore();
    ctx.strokeStyle = '#a33a2e';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.stroke();
    out.toBlob((blob) => {
      if (blob) downloadBlob(blob, `配补裁切_${overlapMm}mm搭边.png`);
    });
  }

  return (
    <>
      <aside className="sidebar">
        <div className="panel">
          <h3>流程</h3>
          <div className="toolbar">
            <span className={`chip ${tab === 'import' ? 'active' : ''}`} onClick={() => setTab('import')}>1 残页</span>
            <span className={`chip ${tab === 'compare' ? 'active' : ''}`} onClick={() => setTab('compare')}>2 比对</span>
            <span className={`chip ${tab === 'cut' ? 'active' : ''}`} onClick={() => setTab('cut')}>3 裁切</span>
          </div>
        </div>

        {tab === 'import' && (
          <div className="panel">
            <h3>导入真实残页</h3>
            <label className="btn ghost" style={{ cursor: 'pointer', display: 'block', textAlign: 'center' }}>
              选择照片
              <input type="file" accept="image/*" hidden onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
              }} />
            </label>
            <h4>或生成测试残页（程序化、可复现）</h4>
            <label className="field"><span>种子</span><input type="number" value={genOpts.seed}
              onChange={(e) => setGenOpts({ ...genOpts, seed: +e.target.value })} /></label>
            <label className="field"><span>泛黄 <b className="value-badge">{genOpts.yellowing.toFixed(2)}</b></span>
              <input type="range" min={0} max={1} step={0.05} value={genOpts.yellowing}
                onChange={(e) => setGenOpts({ ...genOpts, yellowing: +e.target.value })} /></label>
            <label className="field"><span>水渍数量 <b className="value-badge">{genOpts.waterStains}</b></span>
              <input type="range" min={0} max={12} step={1} value={genOpts.waterStains}
                onChange={(e) => setGenOpts({ ...genOpts, waterStains: +e.target.value })} /></label>
            <label className="field"><span>缺角数量 <b className="value-badge">{genOpts.missingCorners}</b></span>
              <input type="range" min={0} max={3} step={1} value={genOpts.missingCorners}
                onChange={(e) => setGenOpts({ ...genOpts, missingCorners: +e.target.value })} /></label>
            <label className="field"><span>折痕 <b className="value-badge">{genOpts.folds}</b></span>
              <input type="range" min={0} max={5} step={1} value={genOpts.folds}
                onChange={(e) => setGenOpts({ ...genOpts, folds: +e.target.value })} /></label>
            <button className="btn" style={{ width: '100%' }} onClick={generate}>生成残页</button>
          </div>
        )}

        {tab === 'compare' && (
          <div className="panel">
            <h3>配补区域与色差</h3>
            <p className="muted">在残页图上依次点击圈出残缺形状（≥3 点）。</p>
            <div className="row">
              <button className="btn small ghost" onClick={() => setPolygon([])}>清除选区</button>
              <button className="btn small ghost" onClick={() => setPolygon((p) => p.slice(0, -1))}>撤销一点</button>
            </div>
            <label className="field" style={{ marginTop: 8 }}>
              <span>纹样叠加不透明度 <b className="value-badge">{opacity.toFixed(2)}</b></span>
              <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(+e.target.value)} />
            </label>
            <label className="field">
              <span>色差块大小（px）<b className="value-badge">{blockSize}</b></span>
              <input type="range" min={4} max={32} step={2} value={blockSize} onChange={(e) => setBlockSize(+e.target.value)} />
            </label>
            <button className="btn" style={{ width: '100%' }} onClick={computeDeltaE} disabled={polygon.length < 3}>
              计算分块色差 ΔE2000
            </button>
            {stats && (
              <table className="cmyk" style={{ marginTop: 10 }}>
                <tbody>
                  <tr><th>平均 ΔE</th><td>{stats.mean.toFixed(2)}</td></tr>
                  <tr><th>95 分位</th><td>{stats.p95.toFixed(2)}</td></tr>
                  <tr><th>最大 ΔE</th><td>{stats.max.toFixed(2)}</td></tr>
                </tbody>
              </table>
            )}
            <div className="muted" style={{ marginTop: 8, lineHeight: 1.9 }}>
              <span className="legend-dot" style={{ background: rgbToHex([0.2, 0.8, 0.3]) }} />≤3 良好
              <span className="legend-dot" style={{ background: rgbToHex([0.95, 0.75, 0.2]), marginLeft: 8 }} />3~6 可接受
              <span className="legend-dot" style={{ background: rgbToHex([0.85, 0.2, 0.15]), marginLeft: 8 }} />&gt;6 需调色
            </div>
          </div>
        )}

        {tab === 'cut' && (
          <div className="panel">
            <h3>配补裁切</h3>
            <label className="field">
              <span>搭边 <b className="value-badge">{overlapMm} mm</b>（手工装裱常规 2mm）</span>
              <input type="range" min={0} max={5} step={0.5} value={overlapMm} onChange={(e) => setOverlapMm(+e.target.value)} />
            </label>
            <button className="btn" style={{ width: '100%' }} onClick={cutRegion} disabled={polygon.length < 3}>
              按残缺形状导出裁切 PNG
            </button>
            <p className="muted" style={{ marginTop: 8 }}>
              输出沿选区外扩 {overlapMm}mm，红色虚线为搭边轮廓，便于托纸粘合对位。
            </p>
          </div>
        )}
      </aside>

      <main className="main">
        <div className="panel" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <h3>残页 × 设计纹样叠加</h3>
          <div className="canvas-stage">
            {!photoCanvas && <div className="muted">请先导入照片或生成测试残页</div>}
            {photoCanvas && (
              <div style={{ position: 'relative', height: '92%', aspectRatio: `${STAGE_W} / ${STAGE_H}` }}
                onClick={stageClick}>
                {/* 底层：残页 */}
                <img src={photoCanvas.toDataURL()} alt="残页"
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill' }} />
                {/* 中层：设计纹样半透明叠加（隐藏源 canvas 经缩放显示） */}
                <div style={{ position: 'absolute', inset: 0, opacity, overflow: 'hidden' }}>
                  <HiddenDesign designRef={designCanvasRef} project={project} />
                </div>
                {/* 热力图层 */}
                {heatUrl && (
                  <img src={heatUrl} alt="色差热力图"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', mixBlendMode: 'multiply' }} />
                )}
                {/* 选区矢量层 */}
                <svg viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
                  {polygon.length > 0 && (
                    <polygon points={polygon.map((p) => `${p.x * STAGE_W},${p.y * STAGE_H}`).join(' ')}
                      fill="rgba(138,75,50,0.15)" stroke="#8a4b32" strokeWidth={2.5} strokeDasharray="8 5" />
                  )}
                  {polygon.map((p, i) => (
                    <circle key={i} cx={p.x * STAGE_W} cy={p.y * STAGE_H} r={5} fill="#8a4b32" stroke="#fff" strokeWidth={1.5} />
                  ))}
                </svg>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

/** 隐藏的全尺寸设计渲染源，拉伸填满叠加容器（与残页同尺寸对齐） */
function HiddenDesign({ designRef, project }: { designRef: React.MutableRefObject<HTMLCanvasElement | null>; project: ReturnType<typeof useStudio>['project'] }) {
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <div style={{ width: '100%', height: '100%' }}>
        <MarblingCanvas project={project} samples={1} canvasRef={designRef} />
      </div>
    </div>
  );
}

function heatColor(dE: number): [number, number, number] {
  if (dE <= 3) return [51, 204, 77];
  if (dE <= 6) return [242, 191, 51];
  return [217, 51, 38];
}
