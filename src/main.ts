import './style.css';
import { init, surface, effect, frameLoop, storage } from 'vgpu';
import type { FrameLoopHandle } from 'vgpu';
import shader from './glass.wgsl';
import { Fluid } from './physics';


const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('fluid');
const fluid = new Fluid();
const abort = new AbortController();
const listen = (target: EventTarget, event: string, handler: EventListener) => target.addEventListener(event, handler, { signal: abort.signal });
let color = '#508acb';
let rainbow = false;
let material = 0;
let splashSize = 1;
function setMaterial(value: number) {
  material = value;
  document.querySelectorAll<HTMLButtonElement>('[data-material]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.material) === value)));
}
document.querySelectorAll<HTMLButtonElement>('[data-material]').forEach(button => listen(button, 'click', () => setMaterial(Number(button.dataset.material))));
let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
let waterTime = 0;
let loop: FrameLoopHandle | undefined;
let gpu: Awaited<ReturnType<typeof init>> | undefined;
let disposed = false;
let keyboardTilt = 0;
function setColor(hex: string, name: string) {
  rainbow = hex === 'rainbow';
  if (!rainbow) color = hex;
  $('color-name').textContent = name;
  document.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(button => {
    const selected = button.dataset.color === hex;
    button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected));
  });
}
function updateRange(id: 'viscosity' | 'tension' | 'splash-size') {
  const input = $<HTMLInputElement>(id);
  const value = Number(input.value);
  if (id === 'splash-size') splashSize = value / 100;
  else fluid[id] = value / 100;
  $(id + '-value').textContent = id === 'splash-size' ? (value / 100).toFixed(1) + '×' : value + '%';
  input.style.setProperty('--progress', `${(value - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
}
for (const id of ['viscosity', 'tension', 'splash-size'] as const) {
  updateRange(id);
  listen($(id), 'input', () => updateRange(id));
}
document.querySelectorAll<HTMLButtonElement>('[data-color]').forEach(button => listen(button, 'click', () => setColor(button.dataset.color!, button.dataset.name!)));

let pointer: { id: number; x: number; y: number } | null = null;
function point(event: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
}
listen(canvas, 'pointerdown', ((event: PointerEvent) => {
  const p = point(event);
  pointer = { id: event.pointerId, ...p }; paused = false;
  canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true });
  fluid.disturb(p.x, -4, 0.028 * splashSize, p.y);
}) as EventListener);
listen(canvas, 'pointermove', ((event: PointerEvent) => {
  if (!pointer || pointer.id !== event.pointerId) return;
  const p = point(event);
  const distance = Math.hypot((p.x - pointer.x) * fluid.aspect, p.y - pointer.y);
  fluid.disturb(p.x, -Math.min(4, distance * 90 + 0.25), 0.024 * splashSize, p.y);
  pointer = { id: event.pointerId, ...p };
}) as EventListener);
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, event, () => { pointer = null; });
listen(canvas, 'keydown', ((event: KeyboardEvent) => {
  if (event.code === 'Space') { event.preventDefault(); paused = false; fluid.disturb(0.5, 4, 0.035 * splashSize, 0.5); }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); keyboardTilt = event.key === 'ArrowLeft' ? -0.6 : 0.6; }
}) as EventListener);
listen(canvas, 'keyup', ((event: KeyboardEvent) => { if (event.key.startsWith('Arrow')) keyboardTilt = 0; }) as EventListener);
listen(canvas, 'blur', () => { keyboardTilt = 0; pointer = null; });

const settings = $<HTMLDialogElement>('settings');
listen($('settings-open'), 'click', () => {
  if (settings.open) settings.close();
  else { settings.show(); $('settings-open').setAttribute('aria-expanded', 'true'); }
});
listen(settings, 'close', () => { $('settings-open').setAttribute('aria-expanded', 'false'); });
listen(document, 'keydown', ((event: KeyboardEvent) => {
  if (event.key === 'Escape' && settings.open) { settings.close(); $('settings-open').focus(); }
}) as EventListener);
listen($('settings-close'), 'click', () => settings.close());
function rgb(hex: string) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255); }
function fail(error: unknown) {
  console.error('Fluid renderer:', error); loop?.stop();
  $('loading').hidden = false;
  $('loading').replaceChildren(document.createTextNode('This pool needs WebGPU.'));
  const detail = document.createElement('span'); detail.textContent = 'Try a current browser with WebGPU and hardware acceleration enabled, then reload.'; $('loading').append(detail);
  $('engine-status').textContent = 'Renderer unavailable';
}
async function start() {
  try {
    gpu = await init();
    if (disposed) { gpu.dispose(); return; }
    gpu.onError(fail);
    void gpu.gpu.lost.then(info => { if (!disposed) fail(info.message); });
    const target = surface(gpu, canvas, { dpr: [1, 1.75] });
    fluid.aspect = target.size[0] / target.size[1];
    const waveBuffer = storage(gpu, fluid.heights.byteLength, 'read');
    waveBuffer.write(fluid.heights);
    const glass = effect(gpu, shader, { label: 'Fluid pool', set: {
      params: { resolution: target.size, fill: fluid.fill, color: rgb(color), waterTime: 0, material, rainbow: Number(rainbow), viscosity: fluid.viscosity },
      heights: waveBuffer,
    } });
    target.onResize(({ width, height }) => {
      fluid.aspect = width / height;
      glass.set({ params: { resolution: [width, height] } });
    });
    await glass.compile({ colors: [navigator.gpu.getPreferredCanvasFormat()] });
    if (disposed) return;
    $('loading').hidden = true;
    if (!paused) fluid.disturb(0.62, 4, 0.035 * splashSize, 0.43);
    let previous = performance.now();
    let fpsStart = previous, frames = 0;
    let lastColor = color;
    loop = frameLoop(gpu, frame => {
      const now = performance.now(); const dt = Math.min((now - previous) / 1000, 0.05); previous = now;
      if (document.hidden) return;
      if (!paused) {
        waterTime += dt * (1 - 0.96 * fluid.viscosity ** 2);

        fluid.tilt += (keyboardTilt - fluid.tilt) * Math.min(1, dt * 5);
        fluid.step(dt);
        glass.set({ params: { waterTime, material, rainbow: Number(rainbow), viscosity: fluid.viscosity } });
        waveBuffer.write(fluid.heights);
      } else {
        // Property changes still render with reduced motion.
        glass.set({ params: { waterTime, material, rainbow: Number(rainbow), viscosity: fluid.viscosity } });
        waveBuffer.write(fluid.heights);
      }
      if (lastColor !== color) { glass.set({ params: { color: rgb(color) } }); lastColor = color; }
      frame.pass(target, glass);
      frames++;
      if (now - fpsStart > 800) {
        $('engine-status').textContent = paused ? 'PAUSED' : Math.round(frames * 1000 / (now - fpsStart)) + ' FPS';
        frames = 0; fpsStart = now;
      }
    });
  } catch (error) { fail(error); }
}
void start();
function cleanup() { disposed = true; loop?.stop(); gpu?.dispose(); abort.abort(); }
window.addEventListener('pagehide', event => { if (!event.persisted) cleanup(); });
if (import.meta.hot) import.meta.hot.dispose(cleanup);
