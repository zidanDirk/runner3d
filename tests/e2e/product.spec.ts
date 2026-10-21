import { expect, test } from '@playwright/test';
import { endRun, playTo } from './progression-helpers';
import {
  PRODUCT_VIEWPORTS, chooseNeonAppearance, clearProductProgress, collectAtLeast,
  openTutorial, readProductFrame, readStoredProduct, runProductJourney,
  startProductRun, waitForProductHome, writeProductEvidence,
} from './product-helpers';

for (const viewport of PRODUCT_VIEWPORTS) test(`complete new-player product journey ${viewport.id}`, async ({ browser, baseURL }) => {
  test.setTimeout(90000);
  const context = await browser.newContext({
    baseURL, viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.mobile, hasTouch: viewport.mobile, deviceScaleFactor: 1,
  });
  context.setDefaultTimeout(15000);
  try { await runProductJourney(await context.newPage(), viewport); }
  finally { await context.close(); }
});

test('paused settings block gameplay, preserve focus and settings, confirm abandonment without settlement', async ({ page }) => {
  await clearProductProgress(page); await waitForProductHome(page);
  await startProductRun(page); await playTo(page, 100);
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  const before = await readProductFrame(page);
  expect(before.view?.status).toBe('paused');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '游戏设置' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('画质', { exact: true }).selectOption('low');
  await dialog.getByLabel('操作方式', { exact: true }).selectOption('buttons');
  await dialog.getByLabel('设置减少动态效果', { exact: true }).check();
  await dialog.getByLabel('设置游戏音效', { exact: true }).uncheck();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Space');
  await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(120));
  const blocked = await readProductFrame(page);
  expect(blocked.view).toEqual(before.view);
  expect(blocked.feedback?.audio.paused).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect((await readProductFrame(page)).view?.status).toBe('paused');
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeFocused();
  await page.getByRole('button', { name: '继续奔跑', exact: true }).click();
  await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(1));
  expect((await readProductFrame(page)).view?.tick).toBe((before.view?.tick ?? 0) + 1);
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await expect(page.getByRole('button', { name: '确认退出', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '留在暂停页', exact: true }).click();
  expect((await readProductFrame(page)).view?.status).toBe('paused');
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await page.getByRole('button', { name: '确认退出', exact: true }).click();
  await waitForProductHome(page);
  const abandoned = await readStoredProduct(page);
  expect(abandoned.profile.walletCoins).toBe(0);
  expect(abandoned.profile.statistics.runsCompleted).toBe(0);
  expect(abandoned.profile.statistics.totalCoins).toBeGreaterThan(0);
  await expect(page.getByTestId('run-wallet-added')).toHaveCount(0);
  await page.reload(); await waitForProductHome(page);
  await page.getByRole('button', { name: '游戏设置', exact: true }).click();
  await expect(page.getByLabel('画质', { exact: true })).toHaveValue('low');
  await expect(page.getByLabel('操作方式', { exact: true })).toHaveValue('buttons');
  await expect(page.getByLabel('设置减少动态效果', { exact: true })).toBeChecked();
  await expect(page.getByLabel('设置游戏音效', { exact: true })).not.toBeChecked();
  writeProductEvidence('abandonment-and-settings', { before, blocked, abandoned, afterReload: await readStoredProduct(page) });
});

test('backgrounding keeps a run paused until an explicit continue, then home reuses a single preview', async ({ page }) => {
  await clearProductProgress(page); await waitForProductHome(page); await startProductRun(page); await playTo(page, 100);
  const before = await readProductFrame(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect.poll(async () => (await readProductFrame(page)).view?.status).toBe('paused');
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.__RUNNER_TEST__?.stepTicks(120); });
  expect((await readProductFrame(page)).view?.tick).toBe(before.view?.tick);
  await page.getByRole('button', { name: '继续奔跑', exact: true }).click();
  await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(1));
  expect((await readProductFrame(page)).view?.tick).toBe((before.view?.tick ?? 0) + 1);
  await endRun(page);
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await waitForProductHome(page);
  for (const entry of ['升级商店', '任务', '角色外观', '游戏设置'] as const) {
    await page.getByRole('button', { name: entry, exact: true }).click();
    expect(await page.locator('canvas').count()).toBe(1);
    await page.keyboard.press('Escape');
    expect(await page.locator('canvas').count()).toBe(1);
  }
});

test('malformed progress is recoverable while the UI keeps storage failure playable in memory', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL });
  await context.addInitScript(() => {
    localStorage.setItem('runner3d-profile-v1', '{broken');
    localStorage.setItem('runner3d-product-v1', '{broken');
    Storage.prototype.setItem = () => { throw new DOMException('Intentional storage outage', 'QuotaExceededError'); };
  });
  const page = await context.newPage();
  try {
    await page.goto('/'); await waitForProductHome(page);
    await openTutorial(page); await page.getByRole('button', { name: '跳过引导', exact: true }).click();
    await chooseNeonAppearance(page);
    await startProductRun(page); await collectAtLeast(page, 100); await endRun(page);
    const actualCoins = (await readProductFrame(page)).view?.coins ?? 0;
    await expect(page.getByTestId('wallet')).toHaveText(actualCoins.toLocaleString('en-US'));
    await page.getByRole('button', { name: '升级商店', exact: true }).click();
    await page.getByRole('button', { name: '升级磁铁', exact: true }).click();
    await expect(page.getByLabel('磁铁升级', { exact: true })).toContainText('Lv.1 / 3');
    await expect(page.getByText('当前进度仅保留在本页，存储暂时不可用。')).toBeVisible();
    await expect(page.getByTestId('panel-wallet')).toHaveText((actualCoins - 100).toLocaleString('en-US'));
    writeProductEvidence('corrupt-and-unavailable-storage', { actualCoins, expectedMemoryWallet: actualCoins - 100, persistedRaw: await page.evaluate(() => localStorage.getItem('runner3d-profile-v1')) });
  } finally { await context.close(); }
});

test('home character failure exposes finite fallback and retries the same asset without changing earned money', async ({ page }) => {
  let failing = true; let requests = 0;
  await page.route('**/models/generated/city-runner.glb*', async (route) => {
    requests++;
    if (failing) await route.fulfill({ status: 503, body: 'Intentional home character outage' });
    else await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('[data-model-status="error"]').first()).toBeVisible({ timeout: 25000 });
  await expect(page.getByRole('button', { name: /重试.*(?:角色|模型|资源)/ }).first()).toBeVisible();
  const before = await readStoredProduct(page);
  failing = false;
  await page.getByRole('button', { name: /重试.*(?:角色|模型|资源)/ }).first().click();
  await expect(page.locator('[data-model-status="loaded"]').first()).toBeVisible({ timeout: 25000 });
  expect(requests).toBe(2);
  expect((await readStoredProduct(page)).profile.walletCoins).toBe(before.profile.walletCoins);
  expect(await page.locator('canvas').count()).toBe(1);
  writeProductEvidence('home-character-recovery', { scope: 'intentional HTTP503 then real GLB retry', requests, before, after: await readStoredProduct(page) });
});

test('leaving during delayed first-game loading cancels pending launch until another explicit start', async ({ page }) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let held = false;
  await page.route('**/models/generated/city-building-01.glb*', async (route) => {
    held = true;
    await gate;
    await route.continue();
  });
  try {
    await clearProductProgress(page); await waitForProductHome(page);
    await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true));
    await page.getByRole('button', { name: '开始奔跑', exact: true }).click();
    await expect.poll(() => held).toBe(true);
    expect((await readProductFrame(page)).view?.status).toBe('ready');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await waitForProductHome(page);
    await expect(page.getByText('准备期间页面已离开，本局尚未开始。点击开始奔跑即可重新出发。', { exact: true })).toBeVisible();
    const loaded = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/city-building-01.glb') && response.ok());
    release();
    await loaded;
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.__RUNNER_TEST__?.stepTicks(120); });
    expect((await readProductFrame(page)).view?.status).toBe('ready');
    expect((await readProductFrame(page)).view?.tick).toBe(0);
    expect((await readStoredProduct(page)).profile.statistics.runsCompleted).toBe(0);
    await startProductRun(page);
    expect((await readProductFrame(page)).view?.status).toBe('running');
    writeProductEvidence('loading-launch-cancellation', { scope: 'held real city GLB request, simulated blur, real response release, explicit second start', held, frame: await readProductFrame(page), saved: await readStoredProduct(page) });
  } finally { release(); }
});

test('phone button-input tutorial teaches actual touch buttons instead of keyboard controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await clearProductProgress(page); await waitForProductHome(page);
  await page.getByRole('button', { name: '游戏设置', exact: true }).click();
  await page.getByLabel('操作方式', { exact: true }).selectOption('buttons');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await openTutorial(page);
  const steps = page.locator('.tutorial-steps');
  await expect(steps).toContainText('点击左移 / 右移按钮换道');
  await expect(steps).toContainText('点击跳跃按钮');
  await expect(steps).toContainText('点击滑铲按钮');
  await expect(steps).not.toContainText('Space');
  await expect(steps).not.toContainText('A / D');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(steps).toContainText('低栏：点击跳跃');
  await expect(steps).toContainText('高架：点击滑铲');
  writeProductEvidence('button-tutorial', { viewport: page.viewportSize(), inputPreference: await page.evaluate(() => localStorage.getItem('runner3d-input-v1')), instructions: await steps.innerText() });
});
