/**
 * 核心类型定义。
 * 坐标系：毫米（mm），原点在纸面中心，x 向右、y 向下，与屏幕坐标方向一致。
 * 所有几何量都是物理尺寸，因此同一套工序可在任意分辨率下重放（600dpi 依然锐利）。
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** 颜料种类 */
export type PigmentKind = 'standard' | 'metallic' | 'base';

export interface Pigment {
  id: string;
  name: string;
  kind: PigmentKind;
  /** sRGB 0..1，存储的是艺术家选色用的显示色；渲染时转线性空间 */
  color: [number, number, number];
  /**
   * 扩散性 0..1。真实浮染中颜料稠度决定滴入后铺展半径：
   * 最终墨滴半径 = 基础半径 × (0.55 + 1.35×diffusion)
   */
  diffusion: number;
  /**
   * 胆汁（ox gall）用量 0..1。边缘活性剂，越大越容易在色环外缘推出白圈。
   */
  gall: number;
  /** 不透明度 0..1 */
  opacity: number;
  /** 金属颜料参数（kind === 'metallic' 时生效） */
  metallic?: {
    metalness: number; // 0..1
    roughness: number; // 0..1
    /** 金粉颗粒密度 0..1 */
    flakeDensity: number;
  };
}

/** 一滴墨中的一个同心色环 */
export interface DropRing {
  pigmentId: string;
  /** 该环外半径（mm），首环之外的环依次嵌套 */
  outerRadius: number;
}

/** 滴墨工序 */
export interface DropOp {
  kind: 'drop';
  id: string;
  x: number;
  y: number;
  /** 单调递增的工序序号，重放顺序即此顺序 */
  seq: number;
  rings: DropRing[];
}

/**
 * 梳齿工具参数。展开（expandComb）后得到若干条直线齿痕 StrokeSeg，
 * 展开函数是纯函数：相同参数 + 相同序号 => 完全相同的齿痕，保证重放一致。
 */
export type CombTool = 'single' | 'multi' | 'wavy';

export interface CombOp {
  kind: 'comb';
  id: string;
  seq: number;
  tool: CombTool;
  /** 梳齿行进的中心路径（起止点，mm） */
  start: Vec2;
  end: Vec2;
  /** 单根齿的长度（mm），垂直于行进方向 */
  toothLength: number;
  /** 齿痕宽度（mm，位移场高斯剖面的 w） */
  toothWidth: number;
  /** 位移强度（mm），约束 |strength| ≤ toothWidth 保证逆映射单调 */
  strength: number;
  /** 多齿梳齿距（mm） */
  spacing: number;
  /** 多齿梳齿数（single 时为 1） */
  teethCount: number;
  /** 波浪梳振幅（mm），single/multi 时为 0 */
  wavyAmplitude: number;
  /** 波浪梳波长（mm） */
  wavyWavelength: number;
  /** 来回次数（≥1），偶数次沿原路反向再梳 */
  passes: number;
  /** 波浪相位（弧度），由记录时的确定性随机数给出 */
  phase: number;
}

export type Operation = DropOp | CombOp;

/** 展开后的直线齿痕（GPU/CPU 追踪的最小单位） */
export interface StrokeSeg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  width: number;
  strength: number;
}

export interface PaperSettings {
  /** 纸基色 sRGB 0..1 */
  tint: [number, number, number];
  /** 纤维纹理密度（每毫米周期基数） */
  fiberScale: number;
  /** 纤维纹理强度 0..1 */
  fiberStrength: number;
  /** 吸墨晕边宽度（mm） */
  feather: number;
  /** 纸面颗粒强度 0..1 */
  grain: number;
}

export interface Project {
  name: string;
  /** 纸面尺寸（mm） */
  widthMm: number;
  heightMm: number;
  paper: PaperSettings;
  palette: Pigment[];
  operations: Operation[];
}

/** 印刷开本预设 */
export interface BookFormat {
  id: string;
  name: string;
  /** 单页尺寸 mm */
  widthMm: number;
  heightMm: number;
}

/** 老纸比对项目数据 */
export interface MatchRegion {
  id: string;
  /** 相对残页图的归一化多边形点 0..1 */
  polygon: Vec2[];
  /** 搭边（mm），默认 2 */
  overlapMm: number;
}
