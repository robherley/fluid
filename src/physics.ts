/** A two-dimensional damped wave field with reflective pool boundaries. */
export class Fluid {
  readonly width = 128;
  readonly height = 96;
  readonly heights = new Float32Array(this.width * this.height);
  readonly velocities = new Float32Array(this.heights.length);
  viscosity = 0.22;
  tension = 0.55;
  fill = 0.62;
  tilt = 0;
  depthTilt = 0;
  aspect = 1;
  private accumulator = 0;

  reset() { this.heights.fill(0); this.velocities.fill(0); this.accumulator = 0; }
  disturb(x: number, force: number, radius = 0.045, y = 0.5) {
    x = Math.max(0, Math.min(1, x)); y = Math.max(0, Math.min(1, y));
    const strength = Math.max(-6, Math.min(6, force));
    for (let row = 0; row < this.height; row++) {
      for (let col = 0; col < this.width; col++) {
        const dx = (col / (this.width - 1) - x) * this.aspect / radius;
        const dy = (row / (this.height - 1) - y) / radius;
        this.velocities[row * this.width + col] += strength * Math.exp(-(dx * dx + dy * dy));
      }
    }
  }
  step(delta: number) {
    this.accumulator += Math.min(Math.max(delta, 0), 0.05);
    const k = 700 + this.tension * 1200;
    // Equal wave speed in screen space requires accounting for cell spacing
    // on both axes. Capping only kx squashes ripples on portrait screens.
    const kx = k * ((this.width - 1) / (this.height - 1) / this.aspect) ** 2;
    // Keep the full aspect correction and reduce the timestep when needed
    // to satisfy the 2D wave equation's stability limit.
    const dt = Math.min(1 / 240, 0.85 / Math.sqrt(kx + k));
    while (this.accumulator >= dt) {
      this.accumulator -= dt;
      const damping = Math.exp(-(0.25 + this.viscosity ** 3 * 90) * dt);
      for (let row = 0; row < this.height; row++) {
        for (let col = 0; col < this.width; col++) {
          const i = row * this.width + col;
          const h = this.heights[i];
          const lapX = this.heights[row * this.width + Math.max(0, col - 1)] + this.heights[row * this.width + Math.min(this.width - 1, col + 1)] - 2 * h;
          const lapY = this.heights[Math.max(0, row - 1) * this.width + col] + this.heights[Math.min(this.height - 1, row + 1) * this.width + col] - 2 * h;
          const equilibrium = -((col / (this.width - 1) * 2 - 1) * this.tilt + (row / (this.height - 1) * 2 - 1) * this.depthTilt) * 0.15;
          this.velocities[i] = (this.velocities[i] + (lapX * kx + lapY * k - 5 * (h - equilibrium)) * dt) * damping;
        }
      }
      let mean = 0, velocityMean = 0;
      for (let i = 0; i < this.heights.length; i++) { this.heights[i] += this.velocities[i] * dt; mean += this.heights[i]; velocityMean += this.velocities[i]; }
      mean /= this.heights.length; velocityMean /= this.heights.length;
      let peak = 0;
      for (let i = 0; i < this.heights.length; i++) { this.heights[i] -= mean; this.velocities[i] -= velocityMean; peak = Math.max(peak, Math.abs(this.heights[i])); }
      if (peak > 0.4) for (let i = 0; i < this.heights.length; i++) { this.heights[i] *= 0.4 / peak; this.velocities[i] *= 0.95; }
    }
  }
}
