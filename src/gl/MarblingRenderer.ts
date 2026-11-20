import type { DropOp, Operation, PaperSettings, Pigment, Project, StrokeSeg } from '../engine/types';
import { expandComb } from '../engine/recipes';
import { cullToTile } from '../engine/culling';
import { srgbToLinearRGB } from '../engine/color';
import { FULLSCREEN_VS } from '../gl/fullscreen.vs';
import { MARBLING_FS } from '../gl/marbling.fs';

export const MAX_DROPS = 512;
export const MAX_STROKES = 4096;
export const MAX_PIGMENTS = 64;
export const MAX_RINGS = 8;

export interface RenderParams {
  lightTilt: number;
  samples: 1 | 4;
  /** 额外覆盖像素物理尺寸（瓦片渲染时由外部按总分辨率给定） */
  sampleMmOverride?: number;
}

export interface GpuProgram {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('无法创建着色器');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('着色器编译失败: ' + log);
  }
  return sh;
}

function linkProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): GpuProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('着色器链接失败: ' + gl.getProgramInfoLog(program));
  }
  const names = [
    'uPaperMm', 'uDropCount', 'uDropRows', 'uMaxRings', 'uStrokeCount', 'uPigCount',
    'uDropTex', 'uStrokeTex', 'uPigTex', 'uPaperTint', 'uFiberScale', 'uFiberStrength',
    'uFeatherMm', 'uGrain', 'uLightTilt', 'uSampleMm', 'uSamples', 'uJitter', 'uTileOffset',
  ];
  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) uniforms[n] = gl.getUniformLocation(program, n);
  return { gl, program, uniforms };
}

/** 展开项目中的全部工序为渲染输入 */
export function flattenOps(operations: Operation[]): { drops: DropOp[]; strokes: StrokeSeg[] } {
  const drops = operations.filter((o): o is DropOp => o.kind === 'drop')
    .slice()
    .sort((a, b) => a.seq - b.seq);
  const strokes: StrokeSeg[] = [];
  operations
    .filter((o): o is CombOp => o.kind === 'comb')
    .sort((a, b) => a.seq - b.seq)
    .forEach((c) => strokes.push(...expandComb(c)));
  return { drops, strokes };
}

type CombOp = Extract<Operation, { kind: 'comb' }>;

function makeFloatTexture(gl: WebGL2RenderingContext, height: number): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, height, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}


/** 颜料 id 在项目内是字符串，这里映射成着色器用的紧凑整数 id */
export function buildPigmentIndex(palette: Pigment[]): Map<string, number> {
  const m = new Map<string, number>();
  palette.forEach((p, i) => m.set(p.id, i));
  return m;
}

export class MarblingRenderer {
  readonly gl: WebGL2RenderingContext;
  private gp: GpuProgram;
  private dropTex: WebGLTexture;
  private strokeTex: WebGLTexture;
  private pigTex: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private dropRowsPerDrop = Math.ceil(MAX_RINGS / 2);

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: false,
      alpha: false,
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('缺少 EXT_color_buffer_float 扩展，无法进行浮点纹理渲染');
    }
    this.gl = gl;
    this.gp = linkProgram(gl, FULLSCREEN_VS, MARBLING_FS);
    this.vao = gl.createVertexArray()!;
    this.dropTex = makeFloatTexture(gl, MAX_DROPS * this.dropRowsPerDrop);
    this.strokeTex = makeFloatTexture(gl, MAX_STROKES * 2);
    this.pigTex = makeFloatTexture(gl, MAX_PIGMENTS * 3);
  }

  private uploadPigments(palette: Pigment[]) {
    const gl = this.gl;
    // 纹理宽 4，每个颜料占 3 行 => 总 float 数 = 4 × (MAX×3) × 4 通道
    const data = new Float32Array(4 * MAX_PIGMENTS * 3 * 4);
    palette.forEach((p, i) => {
      const base = i * 3 * 16;
      const lin = srgbToLinearRGB(p.color);
      const kind = p.kind === 'standard' ? 0 : p.kind === 'metallic' ? 1 : 2;
      data[base + 0] = lin[0];
      data[base + 1] = lin[1];
      data[base + 2] = lin[2];
      data[base + 3] = kind;
      // 第二行（跨一整行 16 float）
      data[base + 16 + 0] = p.diffusion;
      data[base + 16 + 1] = p.gall;
      data[base + 16 + 2] = p.opacity;
      data[base + 16 + 3] = p.metallic?.metalness ?? 0;
      // 第三行
      data[base + 32 + 0] = p.metallic?.roughness ?? 0.5;
      data[base + 32 + 1] = p.metallic?.flakeDensity ?? 0;
    });
    gl.bindTexture(gl.TEXTURE_2D, this.pigTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, MAX_PIGMENTS * 3, gl.RGBA, gl.FLOAT, data);
    this.assertNoGlError('uploadPigments');
  }

  private assertNoGlError(label: string) {
    const e = this.gl.getError();
    if (e !== 0) throw new Error(`WebGL 错误 0x${e.toString(16)} @ ${label}`);
  }

  private uploadDrops(drops: DropOp[], idMap: Map<string, number>) {
    const gl = this.gl;
    const rows = this.dropRowsPerDrop;
    const data = new Float32Array(4 * MAX_DROPS * rows * 4);
    drops.forEach((d, di) => {
      const base = di * rows * 16;
      data[base + 0] = d.x;
      data[base + 1] = d.y;
      data[base + 2] = d.rings[0].outerRadius;
      data[base + 3] = idMap.get(d.rings[0].pigmentId) ?? 0;
      d.rings.forEach((ring, k) => {
        if (k === 0) return;
        const row = 1 + Math.floor((k - 1) / 2);
        const slot = (k - 1) % 2;
        const off = base + row * 16 + slot * 2;
        data[off] = ring.outerRadius;
        data[off + 1] = idMap.get(ring.pigmentId) ?? 0;
      });
    });
    gl.bindTexture(gl.TEXTURE_2D, this.dropTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, MAX_DROPS * rows, gl.RGBA, gl.FLOAT, data);
    this.assertNoGlError('uploadDrops');
  }

  private uploadStrokes(strokes: StrokeSeg[]) {
    const gl = this.gl;
    const data = new Float32Array(4 * MAX_STROKES * 2 * 4);
    strokes.forEach((s, i) => {
      const base = i * 2 * 16;
      data[base + 0] = s.ax;
      data[base + 1] = s.ay;
      data[base + 2] = s.bx;
      data[base + 3] = s.by;
      // width/strength 在第二行
      data[base + 16 + 0] = s.width;
      data[base + 16 + 1] = s.strength;
    });
    gl.bindTexture(gl.TEXTURE_2D, this.strokeTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, MAX_STROKES * 2, gl.RGBA, gl.FLOAT, data);
    this.assertNoGlError('uploadStrokes');
  }

  /** 上传项目数据（操作列表或调色板变更后调用） */
  upload(project: Project) {
    const { drops, strokes } = flattenOps(project.operations);
    return this.uploadFlat(project, drops, strokes);
  }

  /** 直接上传扁平后的滴墨/齿痕（瓦片裁剪路径复用） */
  uploadFlat(project: Project, drops: DropOp[], strokes: StrokeSeg[]) {
    this.gl.getError(); // 清除可能的历史错误标志，避免误判本次上传
    if (drops.length > MAX_DROPS) throw new Error(`滴墨数量超过上限 ${MAX_DROPS}`);
    if (strokes.length > MAX_STROKES) throw new Error(`齿痕段数量超过上限 ${MAX_STROKES}`);
    if (project.palette.length > MAX_PIGMENTS) throw new Error(`颜料数量超过上限 ${MAX_PIGMENTS}`);
    const idMap = buildPigmentIndex(project.palette);
    this.uploadPigments(project.palette);
    this.uploadDrops(drops, idMap);
    this.uploadStrokes(strokes);
    return { dropCount: drops.length, strokeCount: strokes.length };
  }

  private bindCommon(
    paper: PaperSettings,
    widthMm: number,
    heightMm: number,
    counts: { dropCount: number; strokeCount: number; pigCount: number },
    params: RenderParams,
    sampleMm: number,
  ) {
    const gl = this.gl;
    const u = this.gp.uniforms;
    gl.useProgram(this.gp.program);
    gl.bindVertexArray(this.vao);
    gl.uniform2f(u.uPaperMm!, widthMm, heightMm);
    gl.uniform1i(u.uDropCount!, counts.dropCount);
    gl.uniform1i(u.uDropRows!, this.dropRowsPerDrop);
    gl.uniform1i(u.uMaxRings!, MAX_RINGS);
    gl.uniform1i(u.uStrokeCount!, counts.strokeCount);
    gl.uniform1i(u.uPigCount!, counts.pigCount);
    const tint = srgbToLinearRGB(paper.tint);
    gl.uniform3f(u.uPaperTint!, tint[0], tint[1], tint[2]);
    gl.uniform1f(u.uFiberScale!, paper.fiberScale);
    gl.uniform1f(u.uFiberStrength!, paper.fiberStrength);
    gl.uniform1f(u.uFeatherMm!, paper.feather);
    gl.uniform1f(u.uGrain!, paper.grain);
    gl.uniform1f(u.uLightTilt!, params.lightTilt);
    gl.uniform1f(u.uSampleMm!, params.sampleMmOverride ?? sampleMm);
    gl.uniform1i(u.uSamples!, params.samples);
    // 旋转网格 4 样本偏移（像素）
    const jitters = new Float32Array([
      0.375, 0.125, 0.875, 0.375, 0.125, 0.625, 0.625, 0.875,
    ]);
    gl.uniform2fv(u.uJitter!, jitters);
    gl.uniform2f(u.uTileOffset!, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.dropTex);
    gl.uniform1i(u.uDropTex!, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.strokeTex);
    gl.uniform1i(u.uStrokeTex!, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.pigTex);
    gl.uniform1i(u.uPigTex!, 2);
  }

  /** 渲染到画布（交互预览） */
  renderToCanvas(project: Project, params: RenderParams): { dropCount: number; strokeCount: number } {
    const gl = this.gl;
    const counts = this.upload(project);
    const canvas = gl.canvas as HTMLCanvasElement;
    gl.viewport(0, 0, canvas.width, canvas.height);
    const sampleMm = project.widthMm / canvas.width;
    this.bindCommon(project.paper, project.widthMm, project.heightMm,
      { ...counts, pigCount: project.palette.length }, params, sampleMm);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return counts;
  }

  /**
   * 瓦片离屏渲染并回读。tileX/tileY 为瓦片左下角（像素，原点左下），
   * 输出区物理坐标 = (fragCoord + tileOffset) × sampleMm - paper/2。
   * 当前着色器按总分辨率 sampleMm 直接映射，瓦片间通过 gl_FragCoord 偏移修正：
   * 这里用 viewport + 临时 uniform 注入偏移。
   */
  renderTile(
    project: Project,
    widthPx: number,
    _heightPx: number,
    tile: { x: number; y: number; w: number; h: number },
    params: RenderParams,
  ): Uint8Array {
    const gl = this.gl;
    // 瓦片物理包围盒（mm，原点在纸面中心；y 轴与像素一致向下为正）
    const sampleMm0 = project.widthMm / widthPx;
    const tileBox = {
      minX: tile.x * sampleMm0 - project.widthMm / 2,
      maxX: (tile.x + tile.w) * sampleMm0 - project.widthMm / 2,
      minY: tile.y * sampleMm0 - project.heightMm / 2,
      maxY: (tile.y + tile.h) * sampleMm0 - project.heightMm / 2,
    };
    const culled = cullToTile(flattenOps(project.operations), tileBox);
    const counts = this.uploadFlat(project, culled.drops, culled.strokes);
    let fb = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const targetFb = gl.createFramebuffer()!;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tile.w, tile.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, tile.w, tile.h);
    const sampleMm = project.widthMm / widthPx;
    this.bindCommon(project.paper, project.widthMm, project.heightMm,
      { ...counts, pigCount: project.palette.length },
      { ...params, sampleMmOverride: sampleMm }, sampleMm);
    // 瓦片偏移：在 viewport 内 fragCoord 从 0 开始，需补 tile 原点
    gl.uniform2f(this.gp.uniforms.uTileOffset!, tile.x, tile.y);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const out = new Uint8Array(tile.w * tile.h * 4);
    gl.readPixels(0, 0, tile.w, tile.h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.deleteFramebuffer(targetFb);
    gl.deleteTexture(tex);
    return out;
  }

  dispose() {
    const gl = this.gl;
    gl.deleteTexture(this.dropTex);
    gl.deleteTexture(this.strokeTex);
    gl.deleteTexture(this.pigTex);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.gp.program);
  }
}
