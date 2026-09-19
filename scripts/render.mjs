import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { Fluid } from '../src/physics.ts';
import { init, effect, target, storage } from 'vgpu/node';
const shader = readFileSync('src/glass.wgsl', 'utf8');
mkdirSync('artifacts', { recursive: true });
const gpu = await init();
try {
  const width = 640, height = 560;
  const output = target(gpu, { size: [width, height] });
  const heights = new Float32Array(128 * 96);
  for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) heights[y * 128 + x] = Math.sin(Math.hypot(x - 64, y - 48) * .5) * Math.exp(-Math.hypot(x - 64, y - 48) * .04) * .04;
  const waveBuffer = storage(gpu, heights.byteLength, 'read'); waveBuffer.write(heights);
  const render = effect(gpu, shader, { set: { params: { resolution: [width, height], waterTime: 2, viscosity: .22, material: 0, rainbow: 0, fill: 0.62, color: [80/255, 138/255, 203/255] }, heights: waveBuffer } });
  await render.compile(output); render.draw(output);
  const pixels = await output.color.read({ mipLevel: 0, region: 'all' });
  render.draw(output);
  const repeat = await output.color.read({ mipLevel: 0, region: 'all' });
  assert.deepEqual(pixels, repeat, 'fixed uniforms must render deterministically');
  const png = new PNG({ width, height }); png.data.set(pixels); writeFileSync('artifacts/pool.png', PNG.sync.write(png));
  const center = (Math.floor(height * .65) * width + width / 2) * 4;
  assert.ok(pixels[center + 2] > pixels[center] + 30, 'liquid body must visibly contain blue');
  for (const i of [0, (width - 1) * 4, (height - 1) * width * 4, (width * height - 1) * 4]) {
    assert.ok(pixels[i + 2] > pixels[i] + 15, 'pool must reach every corner');
  }
  // Compare idle water over equal elapsed time.
  waveBuffer.write(new Float32Array(128 * 96));
  const movement = [];
  for (const viscosity of [0.05, 0.94]) {
    render.set({ params: { viscosity, waterTime: 0 } }); render.draw(output);
    const before = await output.color.read({ mipLevel: 0, region: 'all' });
    render.set({ params: { waterTime: 2 * (1 - .96 * viscosity ** 2) } }); render.draw(output);
    const after = await output.color.read({ mipLevel: 0, region: 'all' });
    let delta = 0;
    for (let i = 0; i < before.length; i++) if (i % 4 !== 3) delta += Math.abs(before[i] - after[i]);
    movement.push(delta);
  }
  assert.ok(movement[1] < movement[0] * .5, 'thick idle fluid should move visibly less than thin fluid');
  writeFileSync('artifacts/viscosity-evidence.json', JSON.stringify({ thinMovement: movement[0], thickMovement: movement[1] }, null, 2));
  const mercury = new Fluid(); mercury.aspect = width / height; mercury.viscosity = .18; mercury.tension = .88;
  for (const state of ['idle', 'ripple']) {
    if (state === 'ripple') {
      mercury.disturb(.5, -4, .028, .5);
      for (let step = 0; step < 18; step++) mercury.step(1 / 60);
    }
    waveBuffer.write(mercury.heights);
    for (const material of [1, 2]) {
      render.set({ params: { material, viscosity: .18, waterTime: 2, color: [.776, .8, .831], fill: .2 } }); render.draw(output);
      const shallow = await output.color.read({ mipLevel: 0, region: 'all' });
      render.set({ params: { fill: .85 } }); render.draw(output);
      assert.deepEqual(await output.color.read({ mipLevel: 0, region: 'all' }), shallow, 'opaque material must not reveal the floor at any depth');
      const png = new PNG({ width, height }); png.data.set(shallow); writeFileSync(`artifacts/material-${material}-${state}.png`, PNG.sync.write(png));
    }
  }
  // A portrait idle view catches repeating normal-map-like patterns that a
  // single splash screenshot can hide. Keep the same default Mercury state.
  const portrait = target(gpu, { size: [390, 844] });
  waveBuffer.write(new Float32Array(128 * 96));
  render.set({ params: { resolution: [390, 844], material: 2, viscosity: .18, waterTime: 8 } }); render.draw(portrait);
  const portraitPixels = await portrait.color.read({ mipLevel: 0, region: 'all' });
  const portraitPng = new PNG({ width: 390, height: 844 }); portraitPng.data.set(portraitPixels); writeFileSync('artifacts/mercury-portrait-idle.png', PNG.sync.write(portraitPng));
  render.set({ params: { resolution: [width, height], material: 0, rainbow: 0, color: [198/255, 204/255, 212/255] } }); render.draw(output);
  const silver = await output.color.read({ mipLevel: 0, region: 'all' });
  for (let i = 0; i < silver.length; i += 4) assert.ok(Math.abs(silver[i] - silver[i + 2]) <= 1, 'transparent silver must remain neutral');
  const silverPng = new PNG({ width, height }); silverPng.data.set(silver); writeFileSync('artifacts/silver-transparent.png', PNG.sync.write(silverPng));
  const helpers = shader.slice(shader.indexOf('fn fresnel'), shader.indexOf('// End optical helpers.'));
  const probe = target(gpu, { size: [2, 1] });
  effect(gpu, `${helpers}
    @fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
      if (uv.x < 0.5) { return vec4f(fresnel(0.2), fresnel(0.5), fresnel(1.0), 1.0); }
      return vec4f(transmission(vec3f(0.16, 0.61, 0.57), 1.4), 1.0);
    }`).draw(probe);
  const values = await probe.color.read({ mipLevel: 0, region: 'all' });
  const reference = [0.2, 0.5, 1].map(v => .02037 + (1 - .02037) * (1 - v) ** 5).concat([.16, .61, .57].map(v => Math.exp(-(1 - v) * 1.4)));
  const actual = [0, 1, 2, 4, 5, 6].map(i => values[i] / 255);
  const error = Math.max(...actual.map((v, i) => Math.abs(v - reference[i])));
  writeFileSync('artifacts/shader-probes.json', JSON.stringify({ reference, actual, maxError: error, tolerance: 2 / 255 }, null, 2));
  assert.ok(error <= 2 / 255);
  console.log('PASS: deterministic pool pixels, full-viewport water, Fresnel and transmission probes.');
} finally { gpu.dispose(); }
