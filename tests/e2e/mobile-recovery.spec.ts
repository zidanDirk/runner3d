import { requestGameScene, startLiveGame } from './session-helpers';
import { chromium, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { captureThemeAt } from './theme-helpers';

test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

async function read(page: Page) {
  const view = await page.evaluate(() => window.__RUNNER_TEST__?.read());
  if (!view) throw new Error('Mobile recovery game hook missing');
  return view;
}

async function prepare(page: Page): Promise<void> {
  await page.goto('/');
  await startLiveGame(page);
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.models === 1 && window.__RUNNER_RENDER__.character.fallbacks === 0);
  await page.evaluate(() => window.__RUNNER_TEST__?.captureAt('RUNNER-01', 0));
}

test('context loss blocks Escape, resume buttons and audio until the actual context has restored', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('runner3d-quality-v1','low'));
  await prepare(page);
  const available = await page.evaluate(() => {
    const canvas = document.querySelector('canvas'); const gl = canvas?.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!canvas || !extension) return false;
    canvas.addEventListener('runner-test-restore-context', () => extension.restoreContext(), { once: true });
    extension.loseContext();
    return true;
  });
  expect(available, 'The previously verified Chromium WEBGL_lose_context extension must remain available').toBe(true);
  await expect(page.getByRole('alert').filter({ hasText: '图形连接已中断' })).toBeVisible();
  await expect.poll(async () => (await read(page)).status).toBe('paused');
  const paused = await read(page);
  // Unfreeze only the test scheduler, so an erroneous resume really would advance.
  await page.evaluate(() => {
    window.__RUNNER_TEST__?.freeze(false);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.keyboard.press('Escape');
  expect((await read(page)).status).toBe('paused');
  await expect(page.getByRole('button', { name: '继续奔跑', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '从头开始', exact: true })).toBeDisabled();
  await page.waitForTimeout(150);
  expect((await read(page)).tick).toBe(paused.tick);
  await page.waitForFunction(() => window.__FEEDBACK__?.audio.state === 'suspended');
  expect(await page.evaluate(() => window.__FEEDBACK__?.audio.paused)).toBe(true);
  await page.evaluate(() => document.querySelector('canvas')?.dispatchEvent(new Event('runner-test-restore-context')));
  await expect(page.getByRole('alert').filter({ hasText: '图形连接已中断' })).not.toBeVisible();
  await expect(page.getByRole('button', { name: '继续奔跑', exact: true })).toBeEnabled();
  expect((await read(page)).status).toBe('paused'); expect((await read(page)).tick).toBe(paused.tick);
  await page.getByRole('button', { name: '继续奔跑', exact: true }).tap();
  await expect.poll(async () => (await read(page)).tick).toBeGreaterThan(paused.tick);
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.models === 1 && window.__RUNNER_RENDER__.calls > 0);
  expect(await page.locator('canvas').count()).toBe(1);
  expect(await page.evaluate(()=>{const c=document.querySelector('canvas');return c?c.width/c.getBoundingClientRect().width:0;})).toBeCloseTo(1,1);
  expect(errors).toEqual([]);
});

test('Escape focused on the settings dialog itself closes it while game and audio remain paused', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: '游戏设置', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: '游戏设置' }); await expect(dialog).toBeVisible();
  await dialog.evaluate((element) => { if (element instanceof HTMLDialogElement) element.focus(); });
  expect(await dialog.evaluate((element) => document.activeElement === element)).toBe(true);
  const paused = await read(page); expect(paused.status).toBe('paused');
  await page.waitForFunction(() => window.__FEEDBACK__?.audio.state === 'suspended');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible(); expect((await read(page)).status).toBe('paused');
  await page.waitForTimeout(150);
  expect((await read(page)).tick).toBe(paused.tick);
  expect(await page.evaluate(() => window.__FEEDBACK__?.audio.paused)).toBe(true);
  expect(await page.evaluate(() => window.__FEEDBACK__?.audio.state)).toBe('suspended');
  await page.getByRole('button', { name: '继续奔跑', exact: true }).tap();
  await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(1));
  expect((await read(page)).tick).toBe(paused.tick + 1);
});

test('a real roadblock 404 can continue with fallback then retry into the actual GLB without restarting play', async ({ page }) => {
  let fail = true, requests = 0;
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.route((url) => url.pathname.endsWith('/models/generated/roadblock.glb'), async (route) => {
    requests++;
    if (fail) await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Roadblock unavailable for recovery test' });
    else await route.continue();
  });
  await page.goto('/');
  await requestGameScene(page);
  await expect(page.getByRole('button', { name: '使用基础模型继续', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: '开始奔跑', exact: true })).toBeDisabled();
  await page.keyboard.press('Space'); await page.keyboard.press('Escape');
  expect((await read(page)).status).toBe('ready');
  await page.getByRole('button', { name: '使用基础模型继续', exact: true }).tap();
  const notice = page.getByLabel('资源加载提示', { exact: true });
  await expect(notice).toContainText('roadblock');
  await startLiveGame(page);
  await expect(page.getByRole('button', { name: '暂停游戏', exact: true })).toBeEnabled();
  await page.evaluate(() => window.__RUNNER_TEST__?.captureAt('RUNNER-01', 0));
  const before = await read(page);
  expect(await page.evaluate(() => window.__RUNNER_RENDER__?.roadblock.fallbacks ?? 0)).toBeGreaterThan(0);
  expect(requests).toBe(1);
  fail = false;
  await notice.getByRole('button', { name: '重试资源加载', exact: true }).tap();
  await page.waitForFunction(() => (window.__RUNNER_RENDER__?.roadblock.models ?? 0) > 0 && window.__RUNNER_RENDER__?.roadblock.fallbacks === 0);
  await expect(notice).not.toBeVisible();
  const after = await read(page);
  expect({ tick: after.tick, seed: after.seed, score: after.score, status: after.status }).toEqual({ tick: before.tick, seed: before.seed, score: before.score, status: 'running' });
  expect(requests).toBe(2);
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.filter((error) => !error.includes('/models/generated/roadblock.glb?v='))).toEqual([]);
});

test('next-theme 404 is nonblocking, visible and retryable through the same bounded cache', async ({ page }) => {
  let fail = true, requests = 0;
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.route((url) => url.pathname.endsWith('/models/generated/neon-building-01.glb'), async (route) => {
    requests++;
    if (fail) await route.fulfill({ status: 404, contentType: 'text/plain', body: 'Neon model unavailable for recovery test' });
    else await route.continue();
  });
  await prepare(page); expect(requests).toBe(0);
  await page.evaluate(() => window.__RUNNER_TEST__?.captureAt('RUNNER-01', 350));
  const notice = page.getByLabel('资源加载提示', { exact: true });
  await expect(notice).toContainText('neon-building-01');
  const before = await read(page); expect(before.status).toBe('running');
  await expect(page.getByLabel('场景加载', { exact: true })).not.toBeVisible();
  fail = false;
  const response = page.waitForResponse((candidate) => new URL(candidate.url()).pathname.endsWith('/models/generated/neon-building-01.glb') && candidate.ok());
  await notice.getByRole('button', { name: '重试资源加载', exact: true }).tap(); await response;
  await expect(notice).not.toBeVisible();
  const after = await read(page); expect(after.tick).toBe(before.tick); expect(after.score).toBe(before.score); expect(after.status).toBe('running');
  await captureThemeAt(page, 780);
  expect(await page.evaluate(() => window.__CITY_RENDER__?.fallbackBatches)).toBe(0);
  await captureThemeAt(page, 95); await captureThemeAt(page, 780);
  expect(requests).toBe(2);
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.filter((error) => !error.includes('/models/generated/neon-building-01.glb?v='))).toEqual([]);
});

test('an isolated browser with WebGL disabled presents a finite visible graphics error instead of infinite progress', async ({ baseURL }) => {
  // Launch arguments affect only this dedicated browser, never the shared test browser.
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--disable-webgl'] });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(baseURL ?? 'http://127.0.0.1:5174');
    await requestGameScene(page);
    const fatal = page.getByRole('alert').filter({ has: page.getByRole('button', { name: '刷新页面', exact: true }) });
    await expect(fatal).toContainText(/WebGL|3D/);
    await expect(page.getByRole('button', { name: '刷新页面', exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('progressbar', { name: '模型加载进度' })).not.toBeVisible();
    await expect(page.getByText('正在启动 3D 场景…', { exact: true })).not.toBeVisible();
    await expect(page.getByRole('button', { name: '开始奔跑', exact: true })).toBeDisabled();
    await page.waitForFunction(() => !!window.__RUNNER_TEST__);
    expect(await page.evaluate(() => document.querySelector('canvas')?.getContext('webgl2') ?? null)).toBeNull();
    const result = await page.evaluate(() => ({ error: document.querySelector('.loading-panel')?.textContent, progressBars: document.querySelectorAll('progress').length, gameStatus: window.__RUNNER_TEST__?.read().status }));
    expect(result.progressBars).toBe(0); expect(result.gameStatus).toBe('ready');
    mkdirSync('artifacts/mobile', { recursive: true });
    await page.screenshot({ path: 'artifacts/mobile/webgl-disabled.png' });
    writeFileSync('artifacts/mobile/webgl-disabled.json', JSON.stringify({ scope: 'isolated desktop Chromium with --disable-webgl, mobile viewport simulation; not a physical GPU failure', ...result }, null, 2));
  } finally { await browser.close(); }
});
