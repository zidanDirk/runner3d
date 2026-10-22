import { showRouteSeed, startLiveGame } from './session-helpers';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

async function read(page: Page) {
  const state = await page.evaluate(() => window.__RUNNER_TEST__?.read());
  if (!state) throw new Error('Read-only E2E state hook missing');
  return state;
}

async function begin(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await startLiveGame(page);
  await expect.poll(async () => (await read(page)).status).toBe('running');
}

test('renders a real 3D scene, advances, collects coins and pauses without drift', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '三条跑道，一路向前。' })).toBeVisible();
  await expect(page.locator('.home-screen [data-model-status="loaded"]')).toBeVisible();
  await page.screenshot({ path: 'artifacts/ui-ux/regression/screenshots/desktop-ready.png' });
  await startLiveGame(page);
  await expect.poll(async () => page.evaluate(() => window.__RUNNER_RENDER__?.triangles ?? 0)).toBeGreaterThan(100);
  await expect.poll(async () => (await read(page)).distance).toBeGreaterThan(15);
  expect((await read(page)).coins).toBeGreaterThan(0);
  expect((await read(page)).score).toBeGreaterThan(25);
  await page.screenshot({ path: 'artifacts/ui-ux/regression/screenshots/desktop-running.png' });
  await page.getByRole('button', { name: '暂停游戏' }).click();
  const paused = (await read(page)).distance;
  await page.waitForTimeout(200);
  expect((await read(page)).distance).toBe(paused);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await read(page)).distance).toBeGreaterThan(paused);
  const diagnostics = await page.evaluate(() => window.__RUNNER_RENDER__);
  const gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_debug_renderer_info');
    return { renderer: gl && extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : 'unavailable', dpr: Math.min(devicePixelRatio, 1.5) };
  });
  writeFileSync('artifacts/ui-ux/regression/render-metrics.json', JSON.stringify({ viewport: { width: 1440, height: 1000 }, ...diagnostics, ...gpu }, null, 2));
  expect(diagnostics?.triangles).toBeGreaterThan(100);
  expect(diagnostics?.calls).toBeLessThan(300);
  expect(diagnostics?.geometries).toBeLessThan(300);
  expect(errors).toEqual([]);
});

test('real A/D and arrow keys change lanes; Space jumps; S and down arrow slide', async ({ page }) => {
  await begin(page);
  for (const [key, lane] of [['a', 0], ['d', 1], ['ArrowRight', 2], ['ArrowLeft', 1]] as const) {
    await page.keyboard.press(key);
    await expect.poll(async () => (await read(page)).player.lane).toBe(lane);
  }
  await page.keyboard.press('Space');
  await expect.poll(async () => (await read(page)).player.y, { intervals: [20, 30] }).toBeGreaterThan(0.2);
  await expect.poll(async () => (await read(page)).player.y, { intervals: [50] }).toBe(0);
  await page.keyboard.press('s');
  await expect.poll(async () => (await read(page)).player.slideRemaining, { intervals: [20] }).toBeGreaterThan(0.1);
  // A fresh run keeps action checks independent of the first obstacle timing.
  await page.getByRole('button', { name: '暂停游戏' }).click();
  await page.getByRole('button', { name: '从头开始' }).click();
  await page.keyboard.press('ArrowDown');
  await expect.poll(async () => (await read(page)).player.slideRemaining, { intervals: [20] }).toBeGreaterThan(0.1);
});

test('collision ends the run and retry resets the same seed and world', async ({ page }) => {
  await begin(page);
  // Seek the first real obstacle with keyboard input; never inject an artificial collision.
  const initial = await read(page);
  const first = initial.entities.find((entity) => entity.kind !== 'coin');
  if (!first) throw new Error('Expected seeded obstacles');
  for (let i = initial.player.lane; i > first.lane; i--) await page.keyboard.press('ArrowLeft');
  for (let i = initial.player.lane; i < first.lane; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('heading', { name: '每一步，都算数。' })).toBeVisible({ timeout: 15000 });
  const ended = await read(page);
  expect(ended.status).toBe('over');
  expect(ended.hit).toBe(first.kind);
  await page.screenshot({ path: 'artifacts/ui-ux/regression/screenshots/desktop-over.png' });
  await page.getByRole('button', { name: '再跑一次' }).click();
  const retry = await read(page);
  expect(retry.status).toBe('running');
  expect(retry.seed).toBe(initial.seed);
  expect(retry.distance).toBeLessThan(5);
  expect(retry.coins).toBe(0);
  expect(retry.player.lane).toBe(1);
  expect(retry.entities.filter((entity) => entity.kind !== 'coin')).toEqual(initial.entities.filter((entity) => entity.kind !== 'coin'));
});

test('supports seed editing and prevents gameplay from intercepting the input field', async ({ page }) => {
  await page.goto('/');
  await showRouteSeed(page);
  await page.getByRole('textbox', { name: '路线 Seed' }).fill('A D S seed 2026');
  await page.getByRole('button', { name: '应用路线' }).click();
  expect((await read(page)).seed).toBe('A D S seed 2026');
  expect((await read(page)).player.lane).toBe(1);
  const rows = (await read(page)).rows;
  await startLiveGame(page);
  await showRouteSeed(page);
  await expect(page.getByRole('textbox', { name: '路线 Seed' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '从头开始' }).click();
  expect((await read(page)).rows).toEqual(rows);
});

test('pauses on lost window focus and never auto-resumes', async ({ page }) => {
  await begin(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(async () => (await read(page)).status).toBe('paused');
  const distance = (await read(page)).distance;
  await page.waitForTimeout(100);
  expect((await read(page)).distance).toBe(distance);
  await page.getByRole('button', { name: '继续奔跑' }).click();
  await expect.poll(async () => (await read(page)).distance).toBeGreaterThan(distance);
});

test('narrow layout fits and screen buttons control actual simulation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await begin(page);
  await page.getByRole('button', { name: '向左换道' }).click();
  await expect.poll(async () => (await read(page)).player.lane).toBe(0);
  await page.getByRole('button', { name: '向右换道' }).click();
  await expect.poll(async () => (await read(page)).player.lane).toBe(1);
  await page.getByRole('button', { name: '跳跃', exact: true }).click();
  await expect.poll(async () => (await read(page)).player.y, { intervals: [20] }).toBeGreaterThan(0.1);
  await page.screenshot({ path: 'artifacts/ui-ux/regression/screenshots/mobile-running.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const name of ['向左换道', '向右换道', '跳跃', '滑铲']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  await expect.poll(async () => (await read(page)).player.y).toBe(0);
  await page.getByRole('button', { name: '滑铲', exact: true }).click();
  await expect.poll(async () => (await read(page)).player.slideRemaining, { intervals: [20] }).toBeGreaterThan(0.1);
});
