import { showRouteSeed, requestGameScene } from './session-helpers';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { waitForThemeAssets } from './theme-helpers';
export const SEED = 'PROGRESSION-11';
export async function startProgression(page: Page, seed = SEED) {
  await page.goto('/'); await page.waitForFunction(() => !!window.__RUNNER_TEST__);
  if (seed !== 'RUNNER-01') { await showRouteSeed(page); await page.getByLabel('路线 Seed').fill(seed); await page.getByRole('button', { name: '应用路线', exact: true }).click(); }
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true));
  await requestGameScene(page); await waitForThemeAssets(page);
  await page.waitForFunction(() => window.__RUNNER_TEST__?.read().status === 'running');
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true));
}
/** Uses the existing fixed-tick input seam. No state injection, settlement shortcut or clock timers. */
export async function playTo(page: Page, target: number, collect = true) {
  await page.evaluate(({ target, collect }) => {
    const hook = window.__RUNNER_TEST__; if (!hook) throw new Error('No fixed clock');
    const start = hook.read().tick;
    while (hook.read().status === 'running' && hook.read().distance < target && hook.read().tick - start < 80000) {
      const s = hook.read();
      const row = s.rows.find(r => r.distance >= s.distance - (collect ? 9 : 2));
      if (row && row.safeLane !== s.player.lane) window.dispatchEvent(new KeyboardEvent('keydown', { code: row.safeLane < s.player.lane ? 'ArrowLeft' : 'ArrowRight', bubbles: true }));
      hook.stepTicks(1);
    }
  }, { target, collect });
  const state = await page.evaluate(() => window.__RUNNER_TEST__?.read());
  expect(state?.status).toBe('running'); expect(state?.distance).toBeGreaterThanOrEqual(target);
}
export async function seekPower(page: Page, type: 'magnet' | 'shield' | 'double-score', before = 0) {
  let target = await page.evaluate(({ type, before }) => window.__RUNNER_TEST__?.read().pickups.find(p => p.type === type && !p.collected && p.distance > before)?.distance ?? 0, { type, before });
  for (let i = 0; !target && i < 40; i++) {
    const distance = await page.evaluate(() => window.__RUNNER_TEST__?.read().distance ?? 0);
    await playTo(page, distance + 50);
    target = await page.evaluate(({ type, before }) => window.__RUNNER_TEST__?.read().pickups.find(p => p.type === type && !p.collected && p.distance > before)?.distance ?? 0, { type, before });
  }
  expect(target, `seed has reachable ${type}`).toBeGreaterThan(0);
  await playTo(page, target - 10);
  await page.waitForFunction(type => (window.__RUNNER_RENDER__?.powerups.types ?? []).includes(`powerup-${type}-model`) && (window.__RUNNER_RENDER__?.powerups.visible ?? 0) > 0, type);
  return target;
}
export async function endRun(page: Page) {
  await page.evaluate(() => {
    const hook = window.__RUNNER_TEST__; if (!hook) throw new Error('No clock');
    const start = hook.read().tick;
    while (hook.read().status === 'running' && hook.read().tick - start < 10000) {
      const s = hook.read(); const threat = s.entities.find(e => e.kind !== 'coin' && e.distance > s.distance + 8);
      if (threat && threat.lane !== s.player.lane) window.dispatchEvent(new KeyboardEvent('keydown', { code: threat.lane < s.player.lane ? 'ArrowLeft' : 'ArrowRight', bubbles: true }));
      hook.stepTicks(1);
    }
  });
  await expect(page.getByRole('heading', { name: '每一步，都算数。' })).toBeVisible();
}
export async function breakShield(page: Page) {
  await page.evaluate(() => {
    const h = window.__RUNNER_TEST__; if (!h) throw new Error('No clock');
    while (h.read().powerups.shield > 0 && h.read().status === 'running') {
      const s = h.read(), e = s.entities.find(e => e.kind !== 'coin' && e.distance > s.distance + 8);
      if (e && e.lane !== s.player.lane) window.dispatchEvent(new KeyboardEvent('keydown', { code: e.lane < s.player.lane ? 'ArrowLeft' : 'ArrowRight', bubbles: true }));
      h.stepTicks(1);
    }
  });
  await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(8));
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().status)).toBe('running');
  expect(await page.evaluate(() => window.__FEEDBACK__?.recent.some(e => e.type === 'shield-broken'))).toBe(true);
}
