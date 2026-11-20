/**
 * GLSL ES 3.00 公共函数。
 * 哈希/噪声公式与 src/engine/rng.ts 中的 TS 实现严格对应，
 * 保证 CPU 参考路径与 GPU 路径数值一致。
 */
export const GLSL_COMMON = /* glsl */ `
// 与 rng.ts:hash21 位级对应。全程 uint 运算，避免有符号溢出未定义行为。
float hash21(vec2 p) {
  uvec2 ip = uvec2(ivec2(p));
  uint h = (ip.x * 374761393u) ^ (ip.y * 668265263u);
  h = (h ^ (h >> 13u)) * 1274126177u;
  h = h ^ (h >> 16u);
  return float(h) / 4294967296.0;
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm2(vec2 p, float scale) {
  vec2 q = p * scale;
  return vnoise(q) * 0.60
       + vnoise(q * 2.13) * 0.28
       + vnoise(q * 4.71) * 0.12;
}

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)),
             step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
             step(vec3(0.0031308), c));
}

// 金属反射：简化 Cook-Torrance 风格高光 + 金粉颗粒闪烁
float flakeSparkle(vec2 p, float density) {
  vec2 g = floor(p * 2.2);
  float h = hash21(g);
  float cell = vnoise(p * 2.2);
  return step(1.0 - density, h) * smoothstep(0.55, 0.95, cell);
}
`;
