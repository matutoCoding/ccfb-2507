import { useEffect, useRef } from 'react';
import { MarblingRenderer } from '../gl/MarblingRenderer';
import { useStudio } from '../engine/store';
import type { Project } from '../engine/types';

interface Props {
  project?: Project;
  samples?: 1 | 4;
  lightTilt?: number;
  className?: string;
  /** 转发内部 canvas，供离屏比对/裁切等场景直接取样 */
  canvasRef?: React.RefObject<HTMLCanvasElement | null>;
  onRenderer?: (r: MarblingRenderer | null) => void;
  onCounts?: (c: { dropCount: number; strokeCount: number }) => void;
}

/**
 * 浮染预览画布。
 * 画布像素尺寸按容器短边 × dpr 适配，物理坐标映射保证任何缩放下
 * 与导出图是同一数学函数（sampleMm 随分辨率变化，抗锯齿宽度随之缩放）。
 */
export function MarblingCanvas({ project: override, samples, lightTilt, className, canvasRef, onRenderer, onCounts }: Props) {
  const state = useStudio();
  const project = override ?? state.project;
  const localRef = useRef<HTMLCanvasElement | null>(null);
  const canvasCb = (c: HTMLCanvasElement | null) => {
    localRef.current = c;
    if (canvasRef) {
      (canvasRef as { current: HTMLCanvasElement | null }).current = c;
    }
  };
  const rendererRef = useRef<MarblingRenderer | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const onCountsRef = useRef(onCounts);
  onCountsRef.current = onCounts;

  useEffect(() => {
    const canvas = localRef.current;
    if (!canvas) return;
    let renderer: MarblingRenderer | null = null;
    try {
      renderer = new MarblingRenderer(canvas);
      rendererRef.current = renderer;
      onRenderer?.(renderer);
    } catch (e) {
      if (errorRef.current) {
        errorRef.current.textContent = `WebGL2 初始化失败：${(e as Error).message}。请使用最新版 Chrome/Edge/Firefox。`;
        errorRef.current.style.display = 'block';
      }
      return;
    }
    return () => {
      renderer?.dispose();
      rendererRef.current = null;
      onRenderer?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = localRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return;
    const parent = canvas.parentElement!;
    const pad = 24;
    const availW = parent.clientWidth - pad;
    const availH = parent.clientHeight - pad;
    const scale = Math.min(availW / project.widthMm, availH / project.heightMm);
    const cssW = Math.max(64, Math.round(project.widthMm * scale));
    const cssH = Math.max(64, Math.round(project.heightMm * scale));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const targetW = Math.round(cssW * dpr);
    const targetH = Math.round(cssH * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    try {
      const counts = renderer.renderToCanvas(project, {
        lightTilt: lightTilt ?? state.lightTilt,
        samples: samples ?? state.samples,
      });
      onCountsRef.current?.(counts);
    } catch (e) {
      if (errorRef.current) {
        errorRef.current.textContent = `渲染失败：${(e as Error).message}`;
        errorRef.current.style.display = 'block';
      }
    }
    // 仅在影响渲染结果的输入变化时重跑；回调经 ref 调用，不进依赖，避免 setState 回环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, state.lightTilt, state.samples, lightTilt, samples]);

  return (
    <>
      <canvas ref={canvasCb} className={className} style={{ display: 'block' }} />
      <div
        ref={errorRef}
        style={{ display: 'none', color: 'var(--danger)', padding: 16, fontSize: 12, maxWidth: 400 }}
      />
    </>
  );
}
