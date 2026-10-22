import { test, expect, chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { startProductRun, waitForProductHome } from '../e2e/product-helpers';
import { endRun, playTo } from '../e2e/progression-helpers';
import { openGameSettings, closeGameSettings } from '../e2e/session-helpers';
for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
  test(`Beta feedback/version/opt-out and genuine run loop ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); const external: string[] = [], errors: string[] = [];
    page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()); });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto('/'); await waitForProductHome(page);
    await expect(page.getByTestId('release-version')).toContainText('0.14.0-beta');
    await page.getByRole('button', { name: '反馈', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Beta 反馈' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: '主动附带诊断信息' })).not.toBeChecked();
    await page.getByLabel('反馈内容', { exact: true }).fill('触屏换道很清楚，希望新手引导再说明金币用途。');
    await page.getByRole('checkbox', { name: '主动附带诊断信息' }).check();
    await expect(page.getByLabel('待附带的诊断信息')).toContainText('0.14.0-beta');
    await page.getByRole('button', { name: '生成反馈文本', exact: true }).click();
    await expect(page.locator('.beta-feedback__notice')).toContainText('尚未发送');
    const payload = await page.getByRole('textbox', { name: '即将复制或下载的完整内容' }).inputValue();
    expect(payload).toContain('0.14.0-beta'); expect(payload).not.toMatch(/walletCoins|localStorage|http:|RUNNER-01/);
    mkdirSync('artifacts/beta/screenshots', { recursive: true });
    await page.getByRole('dialog', { name: 'Beta 反馈' }).evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: `artifacts/beta/screenshots/feedback-${viewport.width}.png` });
    await page.getByRole('textbox', { name: '即将复制或下载的完整内容' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `artifacts/beta/screenshots/feedback-prepared-${viewport.width}.png` });
    await page.getByRole('button', { name: '关闭反馈', exact: true }).click();
    await startProductRun(page); await playTo(page, 100); await endRun(page);
    await expect.poll(() => page.evaluate(() => window.__BETA_MONITOR__?.().analyticsCounts.RUN_ENDED)).toBe(1);
    const settled = await page.evaluate(() => localStorage.getItem('runner3d-profile-v1'));
    await page.getByRole('button', { name: '反馈', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Beta 反馈' })).toBeVisible();
    await page.getByRole('button', { name: '关闭反馈', exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem('runner3d-profile-v1'))).toBe(settled);
    await page.getByRole('button', { name: '再跑一次', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.__BETA_MONITOR__?.().analyticsCounts.RUN_RESTARTED)).toBe(1);
    await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true));
    await openGameSettings(page); await page.getByText('Beta 隐私与反馈', { exact: true }).click();
    await page.getByRole('checkbox', { name: '本页匿名流程统计' }).uncheck();
    expect(await page.evaluate(() => window.__BETA_MONITOR__?.().analyticsCounts)).toEqual({});
    await page.getByRole('button', { name: '提供 Beta 反馈', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Beta 反馈' })).toBeVisible();
    await page.getByRole('button', { name: '关闭反馈', exact: true }).click();
    expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().status)).toBe('paused');
    expect(external).toEqual([]); expect(errors).toEqual([]);
  });
}
test('structured uncaught/rejection observations redact input and deduplicate without changing saved money', async ({ page }) => {
  await page.goto('/'); await waitForProductHome(page);
  const before = await page.evaluate(() => localStorage.getItem('runner3d-profile-v1'));
  await page.evaluate(() => {
    for (let i = 0; i < 20; i++) window.dispatchEvent(new ErrorEvent('error', { error: new Error('secret@example.com?token=private') }));
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('private original save') }));
  });
  const snapshot = await page.evaluate(() => window.__BETA_MONITOR__?.());
  expect(snapshot?.events.filter(e => e.kind === 'error')).toHaveLength(2);
  expect(JSON.stringify(snapshot)).not.toMatch(/secret@example|token=|private original/);
  expect(snapshot?.connection).toBe('local-only'); expect(snapshot?.remoteConsent).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('runner3d-profile-v1'))).toBe(before);
});
test('GLB network failure is recorded and local feedback remains usable without a backend', async ({ page }) => {
  await page.route('**/city-runner.glb*', route => route.fulfill({ status: 503, body: 'test unavailable' }));
  await page.goto('/'); await page.waitForFunction(() => window.__BETA_MONITOR__?.().events.some(e => e.kind === 'error' && e.code === 'GLB_LOAD'));
  expect(await page.evaluate(() => window.__BETA_MONITOR__?.().events.filter(e => e.kind === 'error' && e.code === 'GLB_LOAD').length)).toBe(1);
  await page.getByRole('button', { name: '反馈', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Beta 反馈' })).toBeVisible();
  await expect(page.getByRole('button', { name: '生成反馈文本' })).toBeVisible();
});
test('real context loss/recovery and hidden-page facts keep a single paused game and version identity', async ({ page }) => {
  await page.goto('/'); await waitForProductHome(page); await startProductRun(page);
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pagehide')); });
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().status)).toBe('paused');
  await page.getByRole('button', { name: '继续奔跑', exact: true }).click();
  const available = await page.evaluate(() => {
    const canvas = document.querySelector('canvas'); const gl = canvas?.getContext('webgl2'); const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) return false; ext.loseContext(); setTimeout(() => ext.restoreContext(), 300); return true;
  });
  test.skip(!available, 'WEBGL_lose_context unavailable; no simulated substitute');
  await page.waitForFunction(() => window.__BETA_MONITOR__?.().events.some(e => e.kind === 'error' && e.code === 'WEBGL_LOST'));
  await page.waitForFunction(() => !document.querySelector('.context-error'));
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().status)).toBe('paused'); await expect(page.locator('canvas')).toHaveCount(1);
  await openGameSettings(page); await closeGameSettings(page);
});

test('AudioContext initialization failure is classified without blocking the real game', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'AudioContext', { configurable: true, value: class { constructor() { throw new Error('private backend failure'); } } }); });
  await page.goto('/'); await waitForProductHome(page); await startProductRun(page);
  await page.waitForFunction(() => window.__BETA_MONITOR__?.().events.some(e => e.kind === 'error' && e.code === 'AUDIO_INIT'));
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().status)).toBe('running');
  expect(JSON.stringify(await page.evaluate(() => window.__BETA_MONITOR__?.()))).not.toContain('private backend');
});
test('profile read/write exceptions stay local and cannot crash real settlement', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) { if (key === 'runner3d-profile-v1') throw new Error('private persisted body'); return get.call(this, key); };
    Storage.prototype.setItem = function (key, value) { if (key === 'runner3d-profile-v1') throw new Error('quota'); set.call(this, key, value); };
  });
  await page.goto('/'); await waitForProductHome(page); await startProductRun(page); await playTo(page, 100); await endRun(page);
  const snapshot = await page.evaluate(() => window.__BETA_MONITOR__?.());
  const codes = snapshot?.events.flatMap(e => e.kind === 'error' ? [e.code] : []);
  expect(codes).toContain('PROFILE_READ'); expect(codes).toContain('PROFILE_WRITE'); expect(JSON.stringify(snapshot)).not.toContain('private persisted body');
  await expect(page.getByRole('button', { name: '再跑一次' })).toBeVisible();
});

// Real browser launch failure, rather than a manufactured monitoring event.
test('WebGL initialization failure is classified in an isolated unsupported browser', async ({ baseURL }) => {
  const browser = await chromium.launch({ channel: 'chromium', headless: true, args: ['--disable-webgl'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(baseURL ?? 'http://127.0.0.1:5184');
    await page.waitForFunction(() => window.__BETA_MONITOR__?.().events.some(event => event.kind === 'error' && event.code === 'WEBGL_INIT'));
    await expect(page.getByRole('button', { name: '反馈', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().status)).toBe('ready');
  } finally { await browser.close(); }
});
