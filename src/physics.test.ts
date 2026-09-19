import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fluid } from './physics.ts';
const energy = (f: Fluid) => f.heights.reduce((s, h, i) => s + h * h * 5 + f.velocities[i] ** 2, 0);
test('2D pool remains finite and volume preserving under repeated impulses and tilt', () => {
  const f = new Fluid(); f.viscosity = 0; f.tilt = .8; f.depthTilt = .7;
  for (let i = 0; i < 300; i++) {
    if (i % 17 === 0) f.disturb((i % 100) / 100, 5, .04, (i % 70) / 70);
    f.step(1 / 60);
    assert.ok(f.heights.every(Number.isFinite)); assert.ok(f.velocities.every(Number.isFinite));
    assert.ok(Math.abs(f.heights.reduce((a, b) => a + b, 0)) < .001);
    assert.ok(f.heights.every(v => Math.abs(v) < .401));
  }
});
test('ripples are local in both axes and propagate away from touch', () => {
  const f = new Fluid(); f.disturb(.5, 5, .025, .25);
  assert.ok(f.velocities[24 * 128 + 64] > 3);
  assert.ok(f.velocities[72 * 128 + 64] < .001);
  for (let i = 0; i < 30; i++) f.step(1 / 60);
  assert.ok(Math.abs(f.heights[35 * 128 + 64]) > .0001);
});
test('viscosity dissipates ripples faster', () => {
  const low = new Fluid(), high = new Fluid(); low.viscosity = .05; high.viscosity = .94;
  for (const f of [low, high]) { f.disturb(.3, 5, .03, .6); for (let i = 0; i < 120; i++) f.step(1 / 60); }
  assert.ok(energy(high) < energy(low) * .2);
});
test('fixed-step behavior is independent of refresh rate and reset clears the field', () => {
  const a = new Fluid(), b = new Fluid(); a.disturb(.35, 4); b.disturb(.35, 4);
  for (let i = 0; i < 60; i++) a.step(1 / 60);
  for (let i = 0; i < 30; i++) b.step(1 / 30);
  for (let i = 0; i < a.heights.length; i++) assert.ok(Math.abs(a.heights[i] - b.heights[i]) < .00001);
  a.reset(); assert.equal(energy(a), 0);
});

// Compare the physical spread of one impulse before it reaches the walls.
// A circular wave has equal second moments along the two screen axes.
for (const aspect of [0.2, 390 / 844, 1, 16 / 9, 3]) {
  test(`splash stays circular and stable at aspect ${aspect}`, () => {
    const f = new Fluid(); f.aspect = aspect; f.viscosity = 0;
    f.disturb(.5, 4, .025, .5);
    for (let step = 0; step < 18; step++) f.step(1 / 120);
    let xx = 0, yy = 0;
    for (let row = 0; row < f.height; row++) for (let col = 0; col < f.width; col++) {
      // Remove the uniform volume-conservation offset outside the ripple.
      const weight = (f.heights[row * f.width + col] - f.heights[0]) ** 2;
      xx += weight * ((col / (f.width - 1) - .5) * aspect) ** 2;
      yy += weight * (row / (f.height - 1) - .5) ** 2;
    }
    const ratio = Math.sqrt(xx / yy);
    assert.ok(Math.abs(ratio - 1) < .12, `horizontal/vertical spread: ${ratio}`);
    for (let i = 0; i < 120; i++) { if (i % 15 === 0) f.disturb(.5, 5); f.step(1 / 60); }
    assert.ok(f.heights.every(Number.isFinite));
    assert.ok(f.heights.every(h => Math.abs(h) <= .401));
    assert.ok(Math.abs(f.heights.reduce((sum, h) => sum + h, 0)) < .001);
  });
}
