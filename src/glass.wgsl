struct Params {
  resolution: vec2f,
  fill: f32,
  color: vec3f,
  waterTime: f32,
  viscosity: f32,
  material: f32,
  rainbow: f32,
}
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> heights: array<f32, 12288>;
fn liquidColor(uv: vec2f) -> vec3f {
  if (params.rainbow < 0.5) { return params.color; }
  let phase = uv.x * params.resolution.x / params.resolution.y * 0.45 + uv.y * 0.38 + params.waterTime * 0.025;
  return vec3f(0.48) + vec3f(0.40) * cos(6.283185 * (vec3f(phase) + vec3f(0.0, 0.3333, 0.6667)));
}
fn heightAt(uv: vec2f) -> f32 {
  let p = clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(127.0, 95.0);
  let cell = min(vec2u(p), vec2u(126u, 94u));
  let f = p - vec2f(cell);
  let i = cell.y * 128u + cell.x;
  return mix(mix(heights[i], heights[i + 1u], f.x), mix(heights[i + 128u], heights[i + 129u], f.x), f.y);
}
fn ambient(p: vec2f) -> f32 {
  let t = params.waterTime * 0.34;
  return (sin(p.x * 3.1 + p.y * 2.4 + t) + sin(p.x * -2.3 + p.y * 4.0 - t * 1.1) * 0.6 + sin(p.x * 6.7 + p.y * 3.1 + t * 1.4) * 0.25) * 0.006 * (1.0 - params.viscosity * 0.92);
}
fn surfaceHeight(uv: vec2f) -> f32 {
  let p = uv * vec2f(params.resolution.x / params.resolution.y, 1.0) * 6.0;
  if (params.material > 1.5) {
    // A nearly level metal surface: short periodic swell creates an embossed
    // pattern when reflected, even though it is subtle in transparent water.
    let t = params.waterTime * 0.16;
    let swell = sin(p.x * 0.9 + p.y * 0.6 + t) + sin(p.x * -0.6 + p.y * 1.1 - t * 0.8) * 0.5;
    return heightAt(uv) + swell * 0.0025 * (1.0 - params.viscosity * 0.92);
  }
  return heightAt(uv) + ambient(p);
}
fn fresnel(facing: f32) -> f32 {
  return 0.02037 + (1.0 - 0.02037) * pow(1.0 - clamp(facing, 0.0, 1.0), 5.0);
}
fn transmission(color: vec3f, depth: f32) -> vec3f {
  return exp(-(vec3f(1.0) - color) * depth);
}
// End optical helpers.
fn caustics(p: vec2f, time: f32) -> f32 {
  var q = p;
  q += vec2f(sin(p.y * 1.2 + time * 0.31), cos(p.x * 1.1 - time * 0.27)) * 0.65;
  let a = sin(q.x * 2.0 + sin(q.y * 1.7 + time * 0.2)) + sin(q.y * 2.1 + cos(q.x * 1.3 - time * 0.22));
  let b = sin(q.x * 1.6 - q.y * 1.2 + time * 0.18) + cos(q.y * 2.4 + q.x * 0.9 - time * 0.23);
  return pow(max(0.0, 1.0 - abs(a) * 0.9), 12.0) * 0.7 + pow(max(0.0, 1.0 - abs(b) * 0.9), 16.0) * 0.45;
}

fn poolTiles(p: vec2f) -> vec3f {
  let tile = p * 2.4; let edge = min(fract(tile), 1.0 - fract(tile));
  let grout = 1.0 - smoothstep(0.006, 0.022, min(edge.x, edge.y));
  let variation = sin(floor(tile.x) * 13.4 + floor(tile.y) * 7.1) * 0.02;
  return mix(vec3f(0.55, 0.85, 0.91) + variation, vec3f(0.24, 0.57, 0.67), grout * 0.45);
}
// Signed distance to a rectangular studio light, softened by surface roughness.
fn panel(p: vec2f, center: vec2f, size: vec2f, softness: f32) -> f32 {
  let q = abs(p - center) - size;
  let distance = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0);
  return 1.0 - smoothstep(-softness, softness, distance);
}
fn silverReflection(uv: vec2f, normal: vec3f, height: f32, aspect: f32) -> vec3f {
  let position = vec3f((uv - 0.5) * vec2f(aspect, 1.0) * 2.0, height * 2.0);
  let view = normalize(vec3f(-position.xy * 0.16, 1.0));
  let ray = reflect(-view, normal);
  // Intersect the reflected ray with a broad overhead studio. Including the
  // surface position gives one coherent reflection instead of repeated blobs.
  let ceiling = position.xy + ray.xy * (2.4 - position.z) / max(0.18, ray.z);
  let backdrop = mix(vec3f(0.16, 0.18, 0.21), vec3f(0.48, 0.50, 0.53), smoothstep(-2.0, 2.0, ceiling.y));
  let key = panel(ceiling, vec2f(-aspect * 0.72, -0.30), vec2f(aspect * 0.34, 2.8), 0.08);
  let rim = panel(ceiling, vec2f(aspect * 0.83, 0.15), vec2f(aspect * 0.075, 2.8), 0.04);
  let fill = panel(ceiling, vec2f(0.0, 2.1), vec2f(2.0, 0.6), 0.32);
  let radiance = backdrop + vec3f(1.75, 1.78, 1.82) * key + vec3f(1.30) * rim + vec3f(0.50) * fill;
  let facing = clamp(dot(normal, view), 0.0, 1.0);
  let f0 = clamp(liquidColor(uv) * 0.92, vec3f(0.0), vec3f(0.98));
  let conductor = f0 + (vec3f(1.0) - f0) * pow(1.0 - facing, 5.0);
  let reflected = radiance * conductor;
  // A smooth exposure shoulder keeps highlights silver rather than clipping
  // to flat white, followed by display gamma for the unorm surface.
  return pow(reflected / (reflected + vec3f(0.6)), vec3f(1.0 / 2.2));
}
@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let aspect = params.resolution.x / params.resolution.y;
  let color = liquidColor(uv);
  let eps = vec2f(1.0 / 127.0, 1.0 / 95.0);
  let dx = (surfaceHeight(uv + vec2f(eps.x, 0.0)) - surfaceHeight(uv - vec2f(eps.x, 0.0))) / (2.0 * eps.x * aspect);
  let dy = (surfaceHeight(uv + vec2f(0.0, eps.y)) - surfaceHeight(uv - vec2f(0.0, eps.y))) / (2.0 * eps.y);
  let normal = normalize(vec3f(-dx, -dy, 1.0));
  let view = normalize(vec3f(0.0, -0.18, 1.0));
  if (params.material > 1.5) {
    return vec4f(silverReflection(uv, normal, surfaceHeight(uv), aspect), 1.0);
  }
  if (params.material > 0.5) {
    // Opaque surfaces reflect studio lights; the pool floor never contributes.
    let n = normalize(vec3f(-dx * 2.2, -dy * 2.2, 1.0));
    let r = reflect(-view, n);
    let ceiling = smoothstep(-0.35, 0.55, r.y) * 0.34;
    let softbox = exp(-pow((r.y + 0.12) * 4.8, 4.0))
      * (0.45 + 0.55 * exp(-pow((r.x + 0.22) * 1.4, 4.0)));
    let strip = exp(-pow((r.x - 0.48) * 14.0, 2.0)) * 0.85;
    let darkBand = 1.0 - exp(-pow((r.y - 0.23) * 12.0, 2.0)) * 0.83;
    let environment = (vec3f(0.055, 0.065, 0.085) + vec3f(0.68, 0.73, 0.80) * ceiling
      + vec3f(0.95, 0.97, 1.0) * softbox + vec3f(1.0, 0.94, 0.83) * strip) * darkBand;
    let facing = max(0.0, dot(n, view));
    var opaque = color * (0.28 + 0.52 * max(0.0, dot(n, normalize(vec3f(-0.4, -0.6, 1.0)))));
    opaque = mix(opaque, environment, 0.12 + pow(1.0 - facing, 5.0) * 0.6);
    return vec4f(clamp(opaque, vec3f(0.0), vec3f(1.0)), 1.0);
  }
  let ray = refract(-view, normal, 1.0 / 1.333);
  let depth = 0.4 + params.fill * 1.8;
  let floorPoint = uv * vec2f(aspect, 1.0) * 6.0 + ray.xy / max(0.15, -ray.z) * depth;
  var floorColor = poolTiles(floorPoint);
  // Neutralize the blue tile cast for warm dyes so amber stays coppery,
  // rather than mixing with the floor into yellow-green.
  let warmth = smoothstep(0.05, 0.45, color.r - color.b);
  floorColor = mix(floorColor, vec3f(dot(floorColor, vec3f(0.2126, 0.7152, 0.0722))), warmth);
  let trans = transmission(color, depth * mix(0.65, 1.15, warmth));
  var col = floorColor * trans + color * (1.0 - trans) * 0.53;
  let caustic = caustics(floorPoint * 2.0 + vec2f(dx, dy) * 1.6, params.waterTime);
  let focusing = clamp(1.0 + (surfaceHeight(uv + eps) + surfaceHeight(uv - eps) - 2.0 * surfaceHeight(uv)) * 250.0, 0.2, 2.0);
  col += mix(vec3f(0.46, 0.8, 0.66), vec3f(0.90, 0.72, 0.50), warmth) * caustic * 0.32 * focusing;
  let light = normalize(vec3f(-0.32, -0.48, 1.0));
  let halfway = normalize(light + view);
  let specular = pow(max(0.0, dot(normal, halfway)), 110.0);
  let broad = pow(max(0.0, dot(normal, halfway)), 10.0);
  let reflected = vec3f(0.72, 0.88, 0.92) * (0.6 + broad * 0.4);
  col = mix(col, reflected, fresnel(dot(normal, view)) * 0.7);
  col += vec3f(0.75, 0.93, 0.88) * specular * 0.68;
  col *= 0.88 + 0.12 * (1.0 - smoothstep(0.0, 1.0, length(uv - 0.5)));
  // Neutral dyes should not inherit the cyan pool tiles and water highlights.
  let chroma = max(color.r, max(color.g, color.b)) - min(color.r, min(color.g, color.b));
  let neutral = 1.0 - smoothstep(0.07, 0.18, chroma);
  col = mix(col, vec3f(dot(col, vec3f(0.2126, 0.7152, 0.0722))), neutral);
  return vec4f(col, 1.0);
}
