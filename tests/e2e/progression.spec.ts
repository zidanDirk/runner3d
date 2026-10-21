import { startLiveGame, waitForHomePreview } from './session-helpers';
import { expect, test } from '@playwright/test';
import { startProgression, seekPower, playTo, endRun } from './progression-helpers';

for (const type of ['magnet', 'shield', 'double-score'] as const) test(`real seeded ${type} GLB pickup and fixed-clock expiry`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await startProgression(page); const target = await seekPower(page, type);
  await playTo(page, target + .2);
  await expect(page.getByTestId(`active-${type}`)).toBeVisible();
  const before = await page.evaluate(type => ({ active: window.__RUNNER_TEST__?.read().powerups[type], score: window.__RUNNER_TEST__?.read().score, bonus: window.__RUNNER_TEST__?.read().scoreBonus, coins: window.__RUNNER_TEST__?.read().coins }), type);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(1200));
  expect(await page.evaluate(type => window.__RUNNER_TEST__?.read().powerups[type], type)).toBe(before.active);
  await page.getByRole('button', { name: '继续奔跑', exact: true }).click();
  await playTo(page, target + 350);
  expect(await page.evaluate(type => window.__RUNNER_TEST__?.read().powerups[type], type)).toBe(0);
  if (type === 'double-score') expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().scoreBonus)).toBeGreaterThan(before.bonus ?? 0);
  expect(errors).toEqual([]);
});

test('magnet confirms early remote coins once through feedback, shield blocks exactly one collision', async ({ page }) => {
  await startProgression(page); const magnet = await seekPower(page, 'magnet'); await playTo(page, magnet + 1);
  await playTo(page, magnet + 55);
  expect(await page.evaluate(() => window.__FEEDBACK__?.recent.some(e => e.type === 'coin' && e.attracted))).toBe(true);
  const shield = await seekPower(page, 'shield', magnet + 55); await playTo(page, shield + 1);
  await page.evaluate(() => {
    const h = window.__RUNNER_TEST__; if (!h) throw new Error('No clock');
    while (h.read().powerups.shield > 0 && h.read().status === 'running') {
      const s = h.read(), e = s.entities.find(e => e.kind !== 'coin' && e.distance > s.distance + 8);
      if (e && e.lane !== s.player.lane) window.dispatchEvent(new KeyboardEvent('keydown', { code: e.lane < s.player.lane ? 'ArrowLeft' : 'ArrowRight', bubbles: true }));
      h.stepTicks(1);
    }
    h.stepTicks(8);
  });
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().status)).toBe('running');
  expect(await page.evaluate(() => window.__FEEDBACK__?.recent.some(e => e.type === 'shield-broken'))).toBe(true);
  await endRun(page);
});

test('one-time wallet settlement, mission claim, purchase and reload keep unrelated settings', async ({ page }) => {
  test.setTimeout(60000);
  await startProgression(page); await playTo(page, 1100); await endRun(page);
  const coins = await page.evaluate(() => window.__RUNNER_TEST__?.read().coins ?? 0);
  await expect(page.getByTestId('wallet')).toHaveText(coins.toLocaleString('en-US'));
  await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(1200));
  await expect(page.getByTestId('wallet')).toHaveText(coins.toLocaleString('en-US'));
  await page.getByRole('button', { name: '任务', exact: false }).click();
  await expect(page.getByTestId('mission-distance')).toHaveText('1,000 / 1,000 m');
  await page.getByRole('button', { name: '领取累计奔跑距离奖励', exact: true }).click();
  await expect(page.getByTestId('panel-wallet')).toHaveText((coins + 40).toLocaleString('en-US'));
  await expect(page.getByTestId('mission-distance')).toContainText('/ 3,000 m');
  await page.getByRole('button', { name: '关闭成长面板' }).click();
  await page.getByRole('button', { name: '升级商店', exact: true }).click();
  const audioBefore = await page.evaluate(() => window.__FEEDBACK__?.audio.started ?? 0);
  await page.getByRole('button', { name: '升级磁铁', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__FEEDBACK__?.audio.started ?? 0)).toBeGreaterThan(audioBefore);
  await expect(page.getByLabel('磁铁升级', { exact: true })).toContainText('Lv.1 / 3');
  await expect(page.getByRole('button', { name: '升级磁铁', exact: true })).toBeDisabled();
  await page.evaluate(() => localStorage.setItem('runner3d-quality-v1', 'low'));
  await page.reload();
  await expect(page.getByTestId('wallet')).toHaveText((coins + 40 - 100).toLocaleString('en-US'));
  await page.getByRole('button', { name: '升级商店', exact: true }).click();
  await expect(page.getByLabel('磁铁升级', { exact: true })).toContainText('Lv.1 / 3');
  expect(await page.evaluate(() => localStorage.getItem('runner3d-quality-v1'))).toBe('low');
  await page.getByRole('button', { name: '关闭成长面板' }).click();
  await startLiveGame(page);
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().powerups)).toEqual({ magnet: 0, shield: 0, 'double-score': 0 });
});

test('growth dialogs remain usable across eight desktop/tablet/mobile viewports and Reduced Motion', async ({ page }) => {
  test.setTimeout(60000); await page.emulateMedia({ reducedMotion: 'reduce' }); await startProgression(page); await page.keyboard.press('Escape');
  for (const [width, height] of [[320,568],[375,667],[390,844],[430,932],[667,375],[844,390],[1024,768],[1440,900]] as const) {
    await page.setViewportSize({ width, height });
    for (const name of ['升级商店', '任务']) {
      await page.getByRole('button', { name, exact: true }).click();
      const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
      const bounds = await dialog.boundingBox(); expect(bounds?.x).toBeGreaterThanOrEqual(0); expect(bounds?.y).toBeGreaterThanOrEqual(0);
      expect((bounds?.y ?? 0) + (bounds?.height ?? 0)).toBeLessThanOrEqual(height);
      const button = page.getByRole('button', { name: '返回游戏', exact: true }); await button.scrollIntoViewIfNeeded(); await expect(button).toBeInViewport();
      const box = await button.boundingBox(); expect(box?.height).toBeGreaterThanOrEqual(44);
      await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().status)).toBe('paused');
    }
  }
});

test('failed local storage keeps settlement and upgrades playable in memory', async ({ page }) => {
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('No storage', 'QuotaExceededError'); }; });
  await startProgression(page); await playTo(page, 150); await endRun(page);
  const coins = await page.evaluate(() => window.__RUNNER_TEST__?.read().coins ?? 0); expect(coins).toBeGreaterThan(0);
  await expect(page.getByTestId('wallet')).toHaveText(String(coins));
  await page.getByRole('button', { name: '升级商店', exact: true }).click();
  await expect(page.getByText('当前进度仅保留在本页，存储暂时不可用。')).toBeVisible();
  await page.getByRole('button', { name: '关闭成长面板' }).click();
  await page.getByRole('button', { name: '再跑一次', exact: true }).click();
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().status)).toBe('running');
});

test('developer positioning cannot earn career coins, normal restarted runs still can', async ({ page }) => {
  await startProgression(page);
  await page.evaluate(() => window.__RUNNER_TEST__?.captureAt('PROGRESSION-11', 1100)); await endRun(page);
  await expect(page.getByTestId('wallet')).toHaveText('0');
  await page.getByRole('button', { name: '再跑一次', exact: true }).click();
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true)); await playTo(page, 150); await endRun(page);
  const coins = await page.evaluate(() => window.__RUNNER_TEST__?.read().coins ?? 0);
  await expect(page.getByTestId('wallet')).toHaveText(String(coins));
});

test('profile best is restored without legacy key and preview cannot persist a record', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('runner3d-profile-v1', JSON.stringify({ schemaVersion: 1, walletCoins: 0, bestScore: 5000, bestDistance: 0, upgrades: { magnet: 0, shield: 0, 'double-score': 0 }, missions: { claimed: [] }, statistics: { totalCoins: 0, totalDistance: 0, powerupsCollected: 0, runsCompleted: 0 } })));
  await startProgression(page);
  await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await page.getByRole('button', { name: '确认退出', exact: true }).click();
  await waitForHomePreview(page); await expect(page.locator('.home-records strong').first()).toContainText('5,000');
  await startLiveGame(page);
  await page.evaluate(() => window.__RUNNER_TEST__?.captureAt('PROGRESSION-11', 10000)); await endRun(page);
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await waitForHomePreview(page); await expect(page.locator('.home-records strong').first()).toContainText('5,000');
  expect(await page.evaluate(() => localStorage.getItem('runner3d-best-v1'))).toBeNull();
});

test('shop feedback obeys the existing graphics/audio lock during WebGL loss', async ({ page }) => {
  await startProgression(page); await playTo(page, 1100); await endRun(page);
  await page.getByRole('button', { name: '升级商店', exact: true }).click();
  await page.evaluate(() => {
    const canvas = document.querySelector('canvas'); const gl = canvas?.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context'); if (!extension) throw new Error('Real WebGL context loss extension unavailable'); canvas?.addEventListener('progression-restore-context', () => extension.restoreContext(), { once: true }); extension.loseContext();
  });
  await expect(page.getByRole('alert').filter({ hasText: '图形连接已中断' })).toBeVisible();
  await page.getByRole('button', { name: '升级磁铁', exact: true }).click();
  // Existing diagnostics sample pauses with lost context; query the actual backend state through
  // the last published AudioSnapshot DOM-free diagnostic is stale, so resume rendering before reading.
  await page.evaluate(() => document.querySelector('canvas')?.dispatchEvent(new Event('progression-restore-context')));
  await expect(page.getByRole('alert').filter({ hasText: '图形连接已中断' })).toHaveCount(0);
  await page.waitForFunction(() => window.__FEEDBACK__?.audio.paused === true);
  expect(await page.evaluate(() => window.__FEEDBACK__?.audio.activeVoices)).toBe(0);
});

test('power-up GLB failure falls back without changing pickup, then retries the shared asset cache', async ({ page }) => {
  let failing = true; await page.route('**/models/generated/powerup-magnet.glb*', route => failing ? route.fulfill({ status: 503, body: 'intentional power-up outage' }) : route.continue());
  await startProgression(page, 'DEMO-11-4411'); await playTo(page, 200);
  await expect(page.getByLabel('资源加载提示')).toContainText('powerup-magnet');
  expect(await page.evaluate(() => window.__RUNNER_RENDER__?.powerups.types.includes('powerup-magnet-model'))).toBe(false);
  await playTo(page, 212); await expect(page.getByTestId('active-magnet')).toBeVisible();
  failing = false; await page.getByRole('button', { name: '重试资源加载', exact: true }).click();
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.powerups.types.includes('powerup-magnet-model'));
  await expect(page.getByLabel('资源加载提示')).toHaveCount(0);
});

test('Reduced Motion preserves real power-ups and collection while using the shared reduced effects policy', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await startProgression(page, 'DEMO-11-4411'); await playTo(page, 270);
  for (const type of ['magnet', 'shield', 'double-score']) await expect(page.getByTestId(`active-${type}`)).toBeVisible();
  expect(await page.evaluate(() => window.__FEEDBACK__?.reducedMotion)).toBe(true);
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().powerupsCollected)).toBe(3);
  await page.screenshot({ path: 'artifacts/progression/reduced-active.png' });
});

test('mission completion produces a brief visible game-time banner without opening a modal', async ({ page }) => {
  await startProgression(page);
  for (let i = 0; i < 400; i++) {
    const state = await page.evaluate(() => window.__RUNNER_TEST__?.read()); if (!state || state.coins >= 100) break;
    await playTo(page, state.distance + 3);
  }
  await expect(page.getByLabel('任务完成提示')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.screenshot({ path: 'artifacts/progression/mission-banner.png' });
  const distance = await page.evaluate(() => window.__RUNNER_TEST__?.read().distance ?? 0); await playTo(page, distance + 70);
  await expect(page.getByLabel('任务完成提示')).toHaveCount(0);
});

test('maximum safe wallet remains readable and cannot overflow the narrow shop', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.addInitScript(() => localStorage.setItem('runner3d-profile-v1', JSON.stringify({ schemaVersion: 1, walletCoins: Number.MAX_SAFE_INTEGER, bestScore: 0, bestDistance: 0, upgrades: { magnet: 0, shield: 0, 'double-score': 0 }, missions: { claimed: [] }, statistics: { totalCoins: 0, totalDistance: 0, powerupsCollected: 0, runsCompleted: 0 } })));
  await page.goto('/'); await page.getByRole('button', { name: '升级商店', exact: true }).click();
  await expect(page.getByTestId('panel-wallet')).toHaveText('9,007,199,254,740,991');
  const panel = page.getByRole('dialog'); expect(await panel.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  await page.getByRole('button', { name: '升级磁铁', exact: true }).dblclick();
  await expect(page.getByTestId('panel-wallet')).toHaveText('9,007,199,254,740,891');
  await expect(page.getByLabel('磁铁升级', { exact: true })).toContainText('Lv.1 / 3');
});

test('rejected invalid developer seek leaves normal settlement enabled', async ({ page }) => {
  await startProgression(page);
  const rejected = await page.evaluate(() => { try { window.__RUNNER_TEST__?.captureAt('invalid', NaN); return false; } catch { return true; } });
  expect(rejected).toBe(true); await playTo(page, 150); await endRun(page);
  const coins = await page.evaluate(() => window.__RUNNER_TEST__?.read().coins ?? 0);
  await expect(page.getByTestId('wallet')).toHaveText(String(coins)); expect(coins).toBeGreaterThan(0);
});
