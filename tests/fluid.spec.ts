import { test, expect, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
async function ready(page: Page) { await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/'); await expect(page.locator('#loading')).toBeHidden(); }
async function open(page: Page) { await page.getByRole('button', { name: 'Settings', exact: true }).click(); }
async function close(page: Page) { await page.getByRole('button', { name: 'Close settings', exact: true }).click(); }
async function capture(page: Page) { return PNG.sync.read(await page.locator('canvas').screenshot()); }
function changed(a: PNG, b: PNG) { let count = 0; for (let i = 0; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 15) count++; return count; }
test('compact floating menu aligns with the orb and stays open outside and closes with explicit controls', async ({ page }) => {
  await ready(page); await open(page);
  await expect(page.locator('#fill,[data-preset],#foam,#motion')).toHaveCount(0);
  const orb = (await page.locator('#settings-open').boundingBox())!, menu = (await page.locator('#settings').boundingBox())!;
  expect(menu.width).toBeLessThanOrEqual(300); expect(menu.height).toBeLessThan(470);
  expect(Math.abs(menu.x + menu.width - orb.x - orb.width)).toBeLessThan(1); expect(menu.y).toBeGreaterThan(orb.y + orb.height);
  await page.screenshot({ path: 'artifacts/floating-settings.png' });
  await open(page); await expect(page.locator('#settings')).toBeHidden();
  await open(page); await page.keyboard.press('Escape'); await expect(page.locator('#settings-open')).toBeFocused();
  await open(page); await page.mouse.click(10, 100); await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#settings-done')).toHaveCount(0);
  await expect(page.locator('.window-footer')).not.toContainText('WEBGPU'); await close(page);
  await page.setViewportSize({ width: 390, height: 844 }); await open(page);
  await page.screenshot({ path: 'artifacts/floating-mobile.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await close(page);
});
test('rainbow and amber change the water and blue restores the default', async ({ page }) => {
  await ready(page); const blue = await capture(page); await open(page);
  await page.getByRole('button', { name: 'Rainbow', exact: true }).click();
  await expect(page.locator('#color-name')).toHaveText('Rainbow'); await close(page);
  expect(changed(blue, await capture(page))).toBeGreaterThan(20000);
  await page.screenshot({ path: 'artifacts/rainbow-pool.png' });
  await open(page); await page.getByRole('button', { name: 'Amber', exact: true }).click(); await close(page);
  expect(changed(blue, await capture(page))).toBeGreaterThan(20000);
  await page.screenshot({ path: 'artifacts/amber-pool.png' });
  await open(page); await page.getByRole('button', { name: 'Blue', exact: true }).click(); await close(page);
  expect(changed(blue, await capture(page))).toBe(0);
});
test('silver metallic, opaque and transparent remain distinct', async ({ page }) => {
  await ready(page); const water = await capture(page); await open(page);
  await page.getByRole('button', { name: 'Silver', exact: true }).click(); await page.getByRole('button', { name: 'Metallic', exact: true }).click(); await close(page);
  const metal = await capture(page); expect(changed(water, metal)).toBeGreaterThan(20000);
  await open(page); await page.getByRole('button', { name: 'Opaque', exact: true }).click(); await close(page);
  expect(changed(metal, await capture(page))).toBeGreaterThan(20000);
});
test('portrait drag works with the menu open and resize is stable', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 320, height: 900 }); await ready(page); const still = await capture(page);
  await open(page); await page.mouse.click(160, 650);
  await expect(page.locator('#settings')).toBeVisible(); expect(changed(still, await capture(page))).toBeGreaterThan(1000);
  await page.setViewportSize({ width: 900, height: 320 });
  await page.getByRole('button', { name: 'Rainbow', exact: true }).click(); await close(page);
  await expect(page.locator('#loading')).toBeHidden(); expect(errors).toEqual([]);
});

test('splash size changes the footprint of a splash', async ({ page }) => {
  const footprints: number[] = [];
  for (const size of ['50', '300']) {
    await ready(page); await open(page);
    await page.getByRole('slider', { name: 'Splash size' }).fill(size);
    await expect(page.locator('#splash-size-value')).toHaveText(size === '50' ? '0.5×' : '3.0×');
    await close(page); const still = await capture(page);
    await page.mouse.click(480, 525);
    footprints.push(changed(still, await capture(page)));
  }
  expect(footprints[1]).toBeGreaterThan(footprints[0] * 2);
});
