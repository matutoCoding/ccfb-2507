import { GLSL_COMMON } from './common.glsl';

/**
 * 浮染主片元着色器。
 * 数据通过三张 RGBA32F 纹理传入（nearest 采样，无插值 => 逐位确定）：
 *  uDropTex   每滴占 ceil(maxRings/2) 行，首行 (x,y,outer,r0)，续行存环半径
 *  uStrokeTex 每条齿痕一行 (ax,ay,bx,by)，下一行 (width,strength,0,0)
 *  uPigTex    每种颜料一行 (r,g,b 线性, kind)，下一行 (diffusion,gall,opacity,metalness)，
 *             第三行 (roughness, flakeDensity, 0,0)
 *
 * 与 src/engine/trace.ts 的公式一一对应；修改任一处必须同步另一处。
 */
export const MARBLING_FS = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

${GLSL_COMMON}

out vec4 fragColor;

uniform vec2 uPaperMm;        // 纸面尺寸（mm）
uniform int uDropCount;
uniform int uDropRows;        // 每滴占用行数
uniform int uMaxRings;        // 单滴最大色环数（= uDropRows*2）
uniform int uStrokeCount;     // 齿痕条数（每条 2 行）
uniform int uPigCount;
uniform sampler2D uDropTex;
uniform sampler2D uStrokeTex;
uniform sampler2D uPigTex;
uniform vec3 uPaperTint;      // 线性纸基色
uniform float uFiberScale;
uniform float uFiberStrength;
uniform float uFeatherMm;     // 晕边宽度（mm）
uniform float uGrain;
uniform float uLightTilt;     // 观察倾角 0..1（金属反光用）
uniform float uSampleMm;      // 一个输出像素对应的物理尺寸（mm），抗锯齿宽度基准
uniform int uSamples;         // 1 或 4
uniform vec2 uJitter[4];      // 旋转网格子样本偏移（像素单位）
uniform vec2 uTileOffset;     // 瓦片左下角在整图中的像素偏移（预览时为 0）

int PIG_ROWS = 3;

// texelFetch 行号与上传源数组行号一一对应（无需翻转）
vec4 dropRow(int dropIdx, int row) {
  int r = dropIdx * uDropRows + row;
  return texelFetch(uDropTex, ivec2(0, r), 0);
}
vec4 strokeRow(int i, int row) {
  int r = i * 2 + row;
  return texelFetch(uStrokeTex, ivec2(0, r), 0);
}
vec4 pigRow(int i, int row) {
  int r = i * PIG_ROWS + row;
  return texelFetch(uPigTex, ivec2(0, r), 0);
}
int pigIndexById(int id) {
  for (int i = 0; i < 64; i++) {
    if (i >= uPigCount) break;
    if (int(pigRow(i, 0).a + 0.5) == id) return i;
  }
  return 0;
}

const int MAX_RINGS = 8;

struct Hit {
  bool ok;
  int pigId;
  float localR;
  float ringOuter;
  float ringInner;
};

// ---- 滴墨逆映射（对应 trace.ts: traceDropInv） ----
vec2 traceDrop(vec2 p, int dropIdx, inout Hit hit) {
  vec4 h0 = dropRow(dropIdx, 0);
  vec2 c = h0.xy;
  float outer = h0.z;
  vec2 d = p - c;
  float rp = length(d);
  if (rp <= outer) {
    // 选环：续行 rgba 依次存各环外半径（首环半径已在 h0.z）
    int ringCount = min(uMaxRings, MAX_RINGS);
    int ringIdx = ringCount - 1;
    for (int k = 0; k < MAX_RINGS; k++) {
      if (k >= ringCount) break;
      float rad;
      if (k == 0) rad = outer;
      else {
        vec4 rr = dropRow(dropIdx, 1 + (k - 1) / 2);
        rad = (k - 1) % 2 == 0 ? rr.x : rr.y;
      }
      if (rad < 0.0) { ringIdx = k - 1; break; }
      if (rp <= rad) { ringIdx = k; break; }
    }
    float ringOuter;
    float ringInner;
    if (ringIdx == 0) {
      ringOuter = outer;
      ringInner = uDropRows >= 2 ? max(dropRow(dropIdx, 1).x, 0.0) : 0.0;
    } else {
      vec4 ro = dropRow(dropIdx, 1 + (ringIdx - 1) / 2);
      ringOuter = (ringIdx - 1) % 2 == 0 ? ro.x : ro.y;
      if (ringIdx + 1 < ringCount) {
        vec4 ri = dropRow(dropIdx, 1 + ringIdx / 2);
        ringInner = ringIdx % 2 == 0 ? ri.x : ri.y;
        ringInner = max(ringInner, 0.0);
      } else {
        ringInner = 0.0;
      }
    }
    // 该环颜料 id 存在最后一个通道：首行 w = 首环 id，续行 z/w 成对
    int pigId;
    if (ringIdx == 0) pigId = int(h0.w + 0.5);
    else {
      vec4 ids = dropRow(dropIdx, 1 + (ringIdx - 1) / 2);
      pigId = int(((ringIdx - 1) % 2 == 0 ? ids.z : ids.w) + 0.5);
    }
    hit = Hit(true, pigId, rp, ringOuter, ringInner);
    return c;
  }
  float rho = sqrt(max(0.0, rp * rp - outer * outer));
  float s = rp > 1e-9 ? rho / rp : 0.0;
  return c + d * s;
}

// ---- 齿痕逆映射（对应 trace.ts: traceStrokeInv，固定 12 次二分） ----
vec2 traceStroke(vec2 p, int i) {
  vec4 s0 = strokeRow(i, 0);
  vec4 s1 = strokeRow(i, 1);
  vec2 a = s0.xy;
  vec2 b = s0.zw;
  float w = s1.x;
  float strength = s1.y;
  vec2 ab = b - a;
  float L2 = dot(ab, ab);
  if (L2 < 1e-12) return p;
  float L = sqrt(L2);
  vec2 q = p - a;
  float u = dot(q, ab) / L;
  float v = dot(q, vec2(-ab.y, ab.x)) / L;
  float env = exp(-(v * v) / (w * w));
  float k = (strength / L) * env;
  float target = u / L;
  // 齿痕端点之外位移恒为 0，域外点直接恒等返回
  if (target <= 0.0 || target >= 1.0) return p;
  float lo = 0.0;
  float hi = 1.0;
  for (int j = 0; j < 20; j++) {
    float tj = (lo + hi) * 0.5;
    float hj = tj * tj * (3.0 - 2.0 * tj);
    float bump = 4.0 * hj * (1.0 - hj);
    if (tj + k * bump < target) lo = tj;
    else hi = tj;
  }
  float t = (lo + hi) * 0.5;
  float uOld = t * L;
  return a + (uOld * ab + v * vec2(-ab.y, ab.x)) / L;
}

vec3 paperColor(vec2 p) {
  // 全部基于物理毫米坐标，与输出分辨率解耦，保证跨分辨率/跨实现一致
  float fiber = fbm2(p, uFiberScale);
  float grainN = hash21(floor(p * 8.0));
  vec3 c = uPaperTint;
  c *= 1.0 + (fiber - 0.5) * uFiberStrength;
  c *= 1.0 + (grainN - 0.5) * uGrain;
  return c;
}

vec3 shade(vec2 seed) {
  vec2 p = seed;
  // 1) 逆序穿过所有齿痕
  for (int i = 0; i < 4096; i++) {
    if (i >= uStrokeCount) break;
    p = traceStroke(p, uStrokeCount - 1 - i);
  }
  // 2) 逆序穿过滴墨，命中即停
  Hit hit = Hit(false, 0, 0.0, 0.0, 0.0);
  for (int i = 0; i < 512; i++) {
    if (i >= uDropCount) break;
    p = traceDrop(p, uDropCount - 1 - i, hit);
    if (hit.ok) break;
  }
  vec3 paper = paperColor(seed);
  if (!hit.ok) return paper;

  int pi = pigIndexById(hit.pigId);
  vec4 p0 = pigRow(pi, 0);
  vec4 p1 = pigRow(pi, 1);
  vec4 p2 = pigRow(pi, 2);
  vec3 ink = p0.rgb;
  int kind = int(p0.a + 0.5) % 10; // 0 standard 1 metallic 2 base
  float gall = p1.y;
  float opacity = p1.z;
  float metalness = p1.w;
  float roughness = p2.x;
  float flakeDensity = p2.y;

  // 胆汁白圈：环外缘 gall*0.35 mm 的带内向纸基色过渡
  float band = max(uSampleMm * 1.5, gall * 0.9);
  float dEdge = hit.ringOuter - hit.localR;
  float gallMix = 1.0 - smoothstep(0.0, band, dEdge);
  // 全局吸墨晕边：最外环外缘向纸淡出
  float outerFade = smoothstep(0.0, max(uSampleMm * 1.5, uFeatherMm), dEdge + 0.0);
  // 内缘也做轻微晕化（色环之间）
  float dInner = hit.localR - hit.ringInner;
  float innerFade = smoothstep(0.0, max(uSampleMm, uFeatherMm * 0.4), dInner);

  vec3 col = mix(paper, ink, opacity * innerFade * outerFade);
  col = mix(col, paper, gallMix * gall * 0.85);

  if (kind == 1) {
    // 金属反光：方向光 + 视角倾角控制的各向异性高光 + 金粉闪烁
    vec3 n = normalize(vec3((vnoise(seed * 1.7) - 0.5) * 0.6,
                            (vnoise(seed * 1.7 + 11.3) - 0.5) * 0.6, 1.0));
    vec3 L = normalize(vec3(0.45, -0.35, 0.8 + uLightTilt * 0.6));
    vec3 V = normalize(vec3(0.0, 0.0, 1.0));
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(n, H), 0.0), mix(120.0, 18.0, roughness));
    float sparkle = flakeSparkle(seed, flakeDensity) * (0.5 + uLightTilt);
    vec3 metalTint = ink * (0.55 + 0.45 * max(dot(n, L), 0.0));
    col = mix(col, metalTint + vec3(spec * (1.0 - roughness) + sparkle * 0.6), metalness);
  }
  return col;
}

void main() {
  vec2 px = gl_FragCoord.xy;
  vec3 acc = vec3(0.0);
  int sampleN = uSamples == 4 ? 4 : 1;
  for (int s = 0; s < 4; s++) {
    if (s >= sampleN) break;
    vec2 j = sampleN == 4 ? uJitter[s] : vec2(0.0);
    vec2 sp = (px + uTileOffset + j) * uSampleMm - uPaperMm * 0.5;
    acc += shade(sp);
  }
  vec3 lin = acc / float(sampleN);
  vec3 outColor = linearToSrgb(lin);
  fragColor = vec4(outColor, 1.0);
}
`;
