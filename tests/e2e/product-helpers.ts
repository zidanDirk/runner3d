import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { defaultProfile, parseProfile } from '../../src/progression/profile';
import { PROFILE_KEY } from '../../src/progression/config';
import { PRODUCT_PREFERENCES_KEY, parseProductPreferences } from '../../src/product/preferences';
import { endRun, playTo, seekPower } from './progression-helpers';
import { getCharacterSkin } from '../../src/character/appearance';
import { BASE_UPGRADES, powerupDuration } from '../../src/game/balance';
import { waitForThemeAssets } from './theme-helpers';

export const PRODUCT_SEED = 'PROGRESSION-11';
export const PRODUCT_VIEWPORTS = [
  { id: 'desktop', width: 1440, height: 900, mobile: false },
  { id: 'portrait', width: 390, height: 844, mobile: true },
  { id: 'landscape', width: 844, height: 390, mobile: true },
] as const;

export function writeProductEvidence(name: string, value: unknown): void {
  mkdirSync('artifacts/ui-ux', { recursive: true });
  writeFileSync(`artifacts/ui-ux/${name}.json`, `${JSON.stringify(value, null, 2)}\n`);
}

/** Clears only this game's test-owned progress, preserving unrelated browser settings. */
export async function clearProductProgress(page: Page): Promise<void> {
  await page.addInitScript(({ profile, product }) => {
    const marker = 'runner3d-product-e2e-cleared';
    if (sessionStorage.getItem(marker) === 'yes') return;
    localStorage.removeItem(profile);
    localStorage.removeItem(product);
    localStorage.removeItem('runner3d-best-v1');
    sessionStorage.setItem(marker, 'yes');
  }, { profile: PROFILE_KEY, product: PRODUCT_PREFERENCES_KEY });
  await page.goto('/');
}

export async function waitForProductHome(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: '开始奔跑', exact: true })).toBeEnabled({ timeout: 25000 });
  await page.waitForFunction(() => !!window.__RUNNER_TEST__);
  await expect(page.locator('[data-model-status="loaded"]').first()).toBeVisible({ timeout: 25000 });
  expect(await page.locator('canvas').count()).toBe(1);
}

export async function openTutorial(page: Page): Promise<void> {
  await page.getByRole('button', { name: '查看引导', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭引导', exact: true })).toBeVisible();
}

export async function completeProductTutorial(page: Page): Promise<void> {
  for (let step = 0; step < 8; step++) {
    const finish = page.getByRole('button', { name: '完成引导', exact: true });
    if (await finish.isVisible()) { await finish.click(); return; }
    await page.getByRole('button', { name: '下一步', exact: true }).click();
  }
  throw new Error('Tutorial never reached its finite completion action');
}

export async function chooseNeonAppearance(page: Page): Promise<void> {
  await page.getByRole('button', { name: '角色外观', exact: true }).click();
  await page.getByRole('radio', { name: /Neon Cyan/ }).check();
  await page.getByRole('button', { name: '确认外观', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭角色', exact: true })).toHaveCount(0);
  await expect(page.locator('[data-model-status="loaded"][data-skin-id="neon-cyan"]').first()).toBeVisible();
}

/** Starts normally; only the existing e2e clock is frozen, never game state or wallet. */
export async function startProductRun(page: Page, seed = PRODUCT_SEED): Promise<void> {
  const seedInput = page.getByLabel('路线 Seed', { exact: true });
  if (!await seedInput.isVisible()) await page.locator('.route-details > summary').click();
  await seedInput.fill(seed);
  const apply = page.getByRole('button', { name: '应用路线', exact: true });
  if (await apply.isEnabled()) await apply.click();
  if (await page.locator('.route-details[open]').count()) await page.locator('.route-details > summary').click();
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true));
  await page.getByRole('button', { name: '开始奔跑', exact: true }).click();
  await page.waitForFunction(() => window.__RUNNER_TEST__?.read().status === 'running', undefined, { timeout: 30000 });
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true));
  await waitForThemeAssets(page);
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().seed)).toBe(seed);
  await expect(page.getByTestId('distance')).toBeVisible();
}

export async function readStoredProduct(page: Page) {
  const raw = await page.evaluate(({ profile, product }) => ({
    profile: localStorage.getItem(profile), preferences: localStorage.getItem(product),
  }), { profile: PROFILE_KEY, product: PRODUCT_PREFERENCES_KEY });
  const profile = raw.profile === null ? defaultProfile() : parseProfile(JSON.parse(raw.profile));
  const preferences = raw.preferences === null ? null : parseProductPreferences(JSON.parse(raw.preferences));
  if (profile === null) throw new Error('Actual saved profile did not pass its production parser');
  return { profile, preferences, raw };
}

export async function readProductFrame(page: Page) {
  return page.evaluate(() => ({
    view: window.__RUNNER_TEST__?.read(), render: window.__RUNNER_RENDER__, city: window.__CITY_RENDER__,
    feedback: window.__FEEDBACK__, canvasCount: document.querySelectorAll('canvas').length,
    preview: document.querySelector('[data-model-status]')?.getAttribute('data-model-status') ?? null,
  }));
}

/** Ensures the screenshot reflects the current simulation and actually loaded models. */
export async function settleProductFrame(page: Page): Promise<void> {
  const scene = await page.locator('.game-stage').isVisible();
  if (scene) {
    await waitForThemeAssets(page);
    await page.waitForFunction(() => {
      const view = window.__RUNNER_TEST__?.read();
      return !!view && window.__RUNNER_RENDER__?.tick === view.tick && window.__CITY_RENDER__?.distance === view.distance;
    });
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

export async function captureProductScreen(page: Page, viewport: string, state: string): Promise<void> {
  await settleProductFrame(page);
  const width = page.viewportSize()?.width;
  if (width === undefined) throw new Error('Screenshot requires a fixed actual viewport');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  const dialogs = page.getByRole('dialog');
  if (await dialogs.count()) {
    const box = await dialogs.boundingBox();
    if (box === null) throw new Error('Open panel has no browser layout box');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual((page.viewportSize()?.height ?? 0) + 1);
  }
  mkdirSync('artifacts/ui-ux/screenshots', { recursive: true });
  await page.screenshot({ path: `artifacts/ui-ux/screenshots/${viewport}-${state}.png`, animations: 'disabled' });
}

export async function collectAtLeast(page: Page, coins: number, minimumDistance = 1100): Promise<void> {
  await playTo(page, minimumDistance);
  for (let iteration = 0; iteration < 20; iteration++) {
    const state = await page.evaluate(() => window.__RUNNER_TEST__?.read());
    if (!state) throw new Error('No actual game state');
    if (state.coins >= coins) return;
    await playTo(page, state.distance + 100);
  }
  throw new Error(`The legal seeded run did not collect ${coins} coins within its bounded test route`);
}

type ProductViewport = typeof PRODUCT_VIEWPORTS[number];
export async function runProductJourney(page: Page, viewport: ProductViewport, evidenceId: string = viewport.id, recording = false) {
  if (recording) await page.addInitScript(() => {
    window.addEventListener('DOMContentLoaded', () => {
      const label = document.createElement('div');
      label.textContent = '自动化流程录像 · 真实操作，路线含固定步加速推进';
      label.style.cssText = 'position:fixed;right:12px;bottom:8px;z-index:9999;padding:5px 9px;background:#14283ddd;color:#fff;font:11px sans-serif;border-radius:5px;pointer-events:none';
      document.body.append(label);
    }, { once: true });
  });
  const errors: string[] = [];
  const requests: string[] = [];
  const timeline: unknown[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => { if (new URL(request.url()).pathname.endsWith('.glb')) requests.push(request.url()); });
  const checkpoint = async (state: string) => {
    timeline.push({ state, browserTimeMs: await page.evaluate(() => performance.now()), saved: await readStoredProduct(page), frame: await readProductFrame(page) });
    writeProductEvidence(`journey-progress-${evidenceId}`, { complete: false, timeline, errors });
    if (recording) await page.waitForTimeout(900);
    else if (viewport.id === 'desktop') await page.waitForTimeout(300);
  };
    await clearProductProgress(page);
    await waitForProductHome(page);
    await expect(page.getByText('初次上路', { exact: false })).toBeVisible();
    await checkpoint('new-home');
    await openTutorial(page);
    if (viewport.id === 'desktop') await completeProductTutorial(page);
    else await page.getByRole('button', { name: '跳过引导', exact: true }).click();
    const tutorialStatus = viewport.id === 'desktop' ? 'done' : 'skipped';
    expect((await readStoredProduct(page)).preferences?.tutorial).toBe(tutorialStatus);
    await checkpoint(`tutorial-${tutorialStatus}`);
    // Reviewing guidance is an actual core menu action, even after first-use dismissal.
    await openTutorial(page);
    await page.getByRole('button', { name: '关闭引导', exact: true }).click();
    expect((await readStoredProduct(page)).preferences?.tutorial).toBe(tutorialStatus);
    await chooseNeonAppearance(page);
    await checkpoint('neon-appearance-selected');
    await startProductRun(page);
    if (recording) {
      await page.evaluate(() => window.__RUNNER_TEST__?.autopilot(true));
      await page.waitForTimeout(2000);
      await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true));
    }
    await collectAtLeast(page, 100);
    const running = await readProductFrame(page);
    expect(running.view?.coins).toBeGreaterThanOrEqual(100);
    expect(running.view?.status).toBe('running');
    expect(running.view?.powerupsCollected).toBeGreaterThan(0);
    expect(running.render?.character.models).toBe(1);
    await checkpoint('first-run-earned');
    await endRun(page);
    const firstOver = await readProductFrame(page);
    const coins = firstOver.view?.coins ?? 0;
    const settled = await readStoredProduct(page);
    expect(settled.profile.walletCoins).toBe(coins);
    expect(settled.profile.statistics.runsCompleted).toBe(1);
    await expect(page.getByTestId('run-wallet-added')).toContainText(String(coins));
    await expect(page.getByTestId('record-badge')).toBeVisible();
    await checkpoint('first-results');
    await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(1200));
    expect((await readStoredProduct(page)).profile).toEqual(settled.profile);
    await page.getByRole('button', { name: '返回首页', exact: true }).click();
    await waitForProductHome(page);
    await expect(page.getByTestId('wallet')).toHaveText(coins.toLocaleString('en-US'));
    await checkpoint('wallet-back-home');
    await page.getByRole('button', { name: '升级商店', exact: true }).click();
    await expect(page.getByTestId('panel-wallet')).toHaveText(coins.toLocaleString('en-US'));
    const buy = page.getByRole('button', { name: '升级磁铁', exact: true });
    await expect(buy).toBeEnabled();
    await buy.dblclick();
    await expect(page.getByLabel('磁铁升级', { exact: true })).toContainText('Lv.1 / 3');
    await expect(buy).toBeDisabled();
    const purchased = await readStoredProduct(page);
    expect(purchased.profile.walletCoins).toBe(coins - 100);
    expect(purchased.profile.upgrades.magnet).toBe(1);
    await checkpoint('actual-magnet-purchase');
    await page.getByRole('button', { name: '关闭成长面板', exact: true }).click();
    await page.getByRole('button', { name: '任务', exact: true }).click();
    await expect(page.getByTestId('mission-distance')).toHaveText('1,000 / 1,000 m');
    await page.getByRole('button', { name: '领取累计奔跑距离奖励', exact: true }).dblclick();
    const claimed = await readStoredProduct(page);
    expect(claimed.profile.walletCoins).toBe(coins - 100 + 40);
    expect(claimed.profile.missions.claimed).toEqual(['distance-1']);
    await expect(page.getByTestId('mission-distance')).toContainText('/ 3,000 m');
    await checkpoint('actual-distance-mission-claimed-once');
    await page.getByRole('button', { name: '关闭成长面板', exact: true }).click();
    await startProductRun(page);
    const magnet = await seekPower(page, 'magnet');
    await playTo(page, magnet + .2);
    await expect(page.getByTestId('active-magnet')).toBeVisible();
    const upgraded = await readProductFrame(page);
    expect(upgraded.view?.powerups.magnet).toBeGreaterThan(powerupDuration('magnet', BASE_UPGRADES));
    expect(upgraded.view?.powerups.magnet).toBeLessThanOrEqual(powerupDuration('magnet', { ...BASE_UPGRADES, magnet: 1 }));
    expect(upgraded.render?.character.models).toBe(1);
    const appearance = upgraded.render?.character;
    expect(appearance && 'appearance' in appearance ? appearance.appearance : null).toMatchObject({
      skinId: 'neon-cyan', jacketColors: [getCharacterSkin('neon-cyan').colors.jacket.toLowerCase()],
    });
    await checkpoint('second-run-real-upgraded-magnet-and-skin');
    await page.keyboard.press('Escape');
    const beforeReload = await readStoredProduct(page);
    const beforeReloadRequests = [...requests];
    expect(beforeReloadRequests.filter((url) => new URL(url).pathname.endsWith('/city-runner.glb'))).toHaveLength(1);
    await page.reload();
    await waitForProductHome(page);
    const restored = await readStoredProduct(page);
    expect(restored.profile).toEqual(beforeReload.profile);
    expect(restored.preferences).toMatchObject({ tutorial: tutorialStatus, skinId: 'neon-cyan' });
    expect(restored.profile.walletCoins).toBe(coins - 60);
    expect(restored.profile.statistics.runsCompleted).toBe(1);
    await expect(page.locator('[data-model-status="loaded"][data-skin-id="neon-cyan"]').first()).toBeVisible();
    await expect(page.getByText('初次上路', { exact: false })).toHaveCount(0);
    await checkpoint('refreshed-profile-and-free-skin-restored');
    expect(errors).toEqual([]);
    writeProductEvidence(`journey-${evidenceId}`, {
      viewport, scope: 'Chromium desktop/mobile viewport emulation; fixed-clock gameplay is accelerated through real intents and original rules, not a continuous realtime 1100m run',
      walletTransactions: { firstRunCoins: coins, walletSettled: settled.profile.walletCoins, magnetPrice: 100, walletAfterPurchase: purchased.profile.walletCoins, missionReward: 40, walletAfterClaim: claimed.profile.walletCoins, walletAfterReload: restored.profile.walletCoins },
      requests, beforeReloadRequests,
      cityRunnerRequestCount: requests.filter((url) => new URL(url).pathname.endsWith('/city-runner.glb')).length,
      errors, timeline,
    });
}

