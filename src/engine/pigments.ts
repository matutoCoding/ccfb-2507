import type { Pigment } from './types';

/**
 * 浮染颜料库。参数参考传统土耳其 Ebru 与手工大理石纹纸常用颜料调性：
 * 矿物/土质颜料扩散慢、色层稠；有机色淀扩散快；金属粉（金粉/银粉）
 * 漂浮性好但需要较高胆汁量才能均匀铺展。
 */
export const BUILTIN_PIGMENTS: Pigment[] = [
  {
    id: 'pg-base-white',
    name: '基底白（氧化锌）',
    kind: 'base',
    color: [0.93, 0.91, 0.86],
    diffusion: 0.5,
    gall: 0.2,
    opacity: 1,
  },
  {
    id: 'pg-indigo',
    name: '靛青（天然靛蓝）',
    kind: 'standard',
    color: [0.08, 0.14, 0.28],
    diffusion: 0.32,
    gall: 0.35,
    opacity: 0.96,
  },
  {
    id: 'pg-ultramarine',
    name: '群青',
    kind: 'standard',
    color: [0.16, 0.2, 0.55],
    diffusion: 0.4,
    gall: 0.4,
    opacity: 0.95,
  },
  {
    id: 'pg-prussian',
    name: '普鲁士蓝',
    kind: 'standard',
    color: [0.05, 0.16, 0.27],
    diffusion: 0.3,
    gall: 0.3,
    opacity: 0.97,
  },
  {
    id: 'pg-vermilion',
    name: '朱砂',
    kind: 'standard',
    color: [0.72, 0.16, 0.12],
    diffusion: 0.38,
    gall: 0.45,
    opacity: 0.96,
  },
  {
    id: 'pg-red-oxide',
    name: '铁红（氧化铁红）',
    kind: 'standard',
    color: [0.5, 0.16, 0.1],
    diffusion: 0.26,
    gall: 0.3,
    opacity: 0.97,
  },
  {
    id: 'pg-ochre',
    name: '赭石',
    kind: 'standard',
    color: [0.62, 0.42, 0.18],
    diffusion: 0.3,
    gall: 0.35,
    opacity: 0.95,
  },
  {
    id: 'pg-raw-umber',
    name: '生褐',
    kind: 'standard',
    color: [0.3, 0.22, 0.13],
    diffusion: 0.25,
    gall: 0.3,
    opacity: 0.96,
  },
  {
    id: 'pg-viridian',
    name: '铬绿',
    kind: 'standard',
    color: [0.1, 0.38, 0.28],
    diffusion: 0.36,
    gall: 0.4,
    opacity: 0.95,
  },
  {
    id: 'pg-ivory-black',
    name: '象牙黑',
    kind: 'standard',
    color: [0.07, 0.06, 0.055],
    diffusion: 0.28,
    gall: 0.35,
    opacity: 0.98,
  },
  {
    id: 'pg-carmine',
    name: '胭脂红（色淀）',
    kind: 'standard',
    color: [0.6, 0.1, 0.22],
    diffusion: 0.62,
    gall: 0.55,
    opacity: 0.92,
  },
  {
    id: 'pg-saffron',
    name: '藤黄',
    kind: 'standard',
    color: [0.86, 0.66, 0.18],
    diffusion: 0.58,
    gall: 0.5,
    opacity: 0.9,
  },
  {
    id: 'pg-gold',
    name: '金粉（铜锌合金粉）',
    kind: 'metallic',
    color: [0.78, 0.58, 0.22],
    diffusion: 0.5,
    gall: 0.6,
    opacity: 0.9,
    metallic: { metalness: 0.85, roughness: 0.35, flakeDensity: 0.7 },
  },
  {
    id: 'pg-silver',
    name: '银粉（铝粉）',
    kind: 'metallic',
    color: [0.72, 0.73, 0.74],
    diffusion: 0.46,
    gall: 0.55,
    opacity: 0.9,
    metallic: { metalness: 0.9, roughness: 0.28, flakeDensity: 0.6 },
  },
];

export function pigmentById(palette: Pigment[], id: string): Pigment | undefined {
  return palette.find((p) => p.id === id);
}

/** 用户自定义颜料的 id 前缀，避免与内置库冲突 */
export const CUSTOM_PIGMENT_PREFIX = 'pg-custom-';
