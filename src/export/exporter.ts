import type { Project } from '../engine/types';
import { MarblingRenderer } from '../gl/MarblingRenderer';
import { StreamingPngEncoder } from './png';

export interface ExportOptions {
  dpi: 300 | 600;
  samples: 1 | 4;
  lightTilt: number;
  /** 水平带高度（像素），全宽渲染，避免拼接缝隙 */
  bandHeight?: number;
  onProgress?: (fraction: number, message: string) => void;
}

export interface ExportResult {
  blob: Blob;
  widthPx: number;
  heightPx: number;
  elapsedMs: number;
}

const MM_PER_INCH = 25.4;

export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / MM_PER_INCH) * dpi);
}

/**
 * 高分辨率导出。
 * 全宽水平带逐带渲染回读，经流式 PNG 编码输出。
 * 物理坐标映射保证与交互预览是同一数学函数、同一套抗锯齿基准，
 * 因此同分辨率下与预览逐位一致，跨分辨率边界差异 ≤1 色阶。
 */
export async function exportPng(
  renderer: MarblingRenderer,
  project: Project,
  opts: ExportOptions,
): Promise<ExportResult> {
  const t0 = performance.now();
  const widthPx = mmToPx(project.widthMm, opts.dpi);
  const heightPx = mmToPx(project.heightMm, opts.dpi);
  const band = Math.min(opts.bandHeight ?? 1024, heightPx);
  const encoder = await StreamingPngEncoder.create(widthPx, heightPx, opts.dpi);

  const bands = Math.ceil(heightPx / band);
  for (let b = 0; b < bands; b++) {
    const y = b * band;
    const h = Math.min(band, heightPx - y);
    opts.onProgress?.(b / bands, `渲染第 ${b + 1}/${bands} 带（${opts.dpi}dpi）`);
    const rgba = renderer.renderTile(
      project,
      widthPx,
      heightPx,
      { x: 0, y, w: widthPx, h },
      { lightTilt: opts.lightTilt, samples: opts.samples },
    );
    await encoder.writeTile({ x: 0, y, w: widthPx, h, rgba });
    // 让 UI 进度条有机会刷新
    await new Promise((r) => setTimeout(r, 0));
  }
  opts.onProgress?.(0.95, 'PNG 编码中…');
  const blob = await encoder.finish();
  const elapsedMs = performance.now() - t0;
  opts.onProgress?.(1, `完成，耗时 ${(elapsedMs / 1000).toFixed(1)} 秒`);
  return { blob, widthPx, heightPx, elapsedMs };
}
