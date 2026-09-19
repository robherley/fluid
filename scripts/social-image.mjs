import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import { init, effect, target, storage } from 'vgpu/node';
import { Fluid } from '../src/physics.ts';

// Render the actual pool at social-card dimensions, without interface overlays.
const width = 1200, height = 630;
const fluid = new Fluid();
fluid.aspect = width / height;
fluid.disturb(.38, -4, .035, .52);
for (let i = 0; i < 42; i++) fluid.step(1 / 60);
fluid.disturb(.73, 3, .025, .36);
for (let i = 0; i < 15; i++) fluid.step(1 / 60);
const gpu = await init();
try {
  const output = target(gpu, { size: [width, height] });
  const heights = storage(gpu, fluid.heights.byteLength, 'read');
  heights.write(fluid.heights);
  const render = effect(gpu, readFileSync('src/glass.wgsl', 'utf8'), { set: {
    params: { resolution: [width, height], fill: .62, color: [80/255, 138/255, 203/255], waterTime: 2, viscosity: .22, material: 0, rainbow: 0 },
    heights,
  } });
  await render.compile(output);
  render.draw(output);
  const png = new PNG({ width, height });
  png.data.set(await output.color.read({ mipLevel: 0, region: 'all' }));
  writeFileSync('public/og-image.png', PNG.sync.write(png));
  console.log('Generated public/og-image.png (1200 × 630)');
} finally { gpu.dispose(); }
