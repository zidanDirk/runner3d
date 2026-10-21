import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** Enter the real product flow. Freeze only the existing e2e scheduler, never game facts. */
export async function requestGameScene(page: Page, freeze = true): Promise<void> {
  await page.waitForFunction(() => !!window.__RUNNER_TEST__);
  const status = await page.evaluate(() => window.__RUNNER_TEST__?.read().status);
  if (status === 'ready' && await page.locator('.game-stage').count() === 0) {
    await expect(page.locator('.home-screen')).toBeVisible();
    await page.evaluate(value => window.__RUNNER_TEST__?.freeze(value), freeze);
    await page.getByRole('button', { name: '开始奔跑', exact: true }).click();
  } else {
    expect(['ready', 'running', 'paused', 'over']).toContain(status);
  }
  await expect(page.locator('.game-stage')).toBeVisible();
}

/** Use when an old test starts real RAF play after its loaded/frozen scene checks. */
export async function startLiveGame(page: Page): Promise<void> {
  await requestGameScene(page, false);
  await page.waitForFunction(() => window.__RUNNER_TEST__?.read().status === 'running');
  await page.evaluate(() => { window.__RUNNER_TEST__?.freeze(false); if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
}

/** Seed remains a real ready-screen form; applying it does not start or settle a run. */
export async function showRouteSeed(page: Page): Promise<void> {
  const details = page.locator('.route-details');
  await expect(details).toHaveCount(1);
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
  await expect(page.getByRole('textbox', { name: '路线 Seed', exact: true })).toBeVisible();
}

export async function openGameSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: '游戏设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '游戏设置' })).toBeVisible();
}

export async function closeGameSettings(page: Page, resume = false): Promise<void> {
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '游戏设置' })).toHaveCount(0);
  const status = await page.evaluate(() => window.__RUNNER_TEST__?.read().status);
  if (resume) {
    expect(status).toBe('paused');
    await page.getByRole('button', { name: '继续奔跑', exact: true }).click();
    await page.waitForFunction(() => window.__RUNNER_TEST__?.read().status === 'running');
  }
}

/** Home has a character preview, never a city or running simulation. */
export async function waitForHomePreview(page: Page): Promise<void> {
  await page.waitForFunction(() => !!window.__RUNNER_TEST__);
  await expect(page.locator('.home-screen')).toBeVisible();
  await expect(page.locator('.home-screen [data-model-status="loaded"]')).toBeVisible();
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().status)).toBe('ready');
}

/** Read the existing audio manager before the game-only render diagnostic is mounted. */
export async function readActualAudio(page: Page) {
  return page.evaluate(async () => {
    const path = '/src/runtime/feedback.ts';
    const runtime: typeof import('../../src/runtime/feedback') = await import(/* @vite-ignore */ path);
    return runtime.feedback.audio.diagnostics();
  });
}
