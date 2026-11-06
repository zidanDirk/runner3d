import { test, expect, type Page, type Locator } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { LevelGenerator } from '../../src/game/level';
import { beginPowerupRoute, followPowerupRoute, POWERUP_ROUTE } from './route-journey';

const variant = process.env.ROUTE_VARIANT ?? 'current';
const profile = process.env.ROUTE_PROFILE ?? 'normal';
if (!['legacy', 'current'].includes(variant) || !['normal', 'latency100', 'latency300', 'ci-lag', 'capture-lag'].includes(profile)) throw new Error('Unknown route experiment');
const delayMs = profile === 'normal' ? 0 : profile === 'latency100' ? 100 : 300;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
interface Observation { at: number; type: string; data: unknown }
declare global { interface Window {
  __routeExperimentSink?: (observation: Observation) => Promise<void>;
  __stopRouteWorkload?: () => void;
} }

// Add wall-clock latency only to the bot's real Playwright calls. Reads return
// their original, genuinely stale result. Native keyboard events remain trusted.
function delayedPage(page: Page, record: (event: Observation) => void): Page {
  const delayed = (target: object, method: string, before: boolean, label?: string) => async (...args: unknown[]): Promise<unknown> => {
    const requestedAt = Date.now();
    if (before || (method === 'screenshot' && profile === 'capture-lag')) await sleep(method === 'screenshot' ? 1200 : delayMs);
    const result: unknown = await Reflect.apply(Reflect.get(target, method), target, args);
    const browserCallReturnedAt = Date.now();
    if (!before) await sleep(delayMs);
    record({ at: Date.now(), type: 'rpc', data: { method, label, key: method === 'press' ? args[0] : undefined, requestedAt, browserCallReturnedAt, returnedAt: Date.now(), injectedMs: delayMs,
      result: typeof result === 'string' || typeof result === 'boolean' ? result : undefined } });
    return result;
  };
  const locator = (value: Locator, label: string) => new Proxy(value, { get(target, key) {
    if (key === 'innerText' || key === 'isVisible') return delayed(target, key, false, label);
    const member: unknown = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
  } });
  return new Proxy(page, { get(target, key) {
    if (key === 'evaluate' || key === 'waitForTimeout' || key === 'screenshot') return delayed(target, key, false);
    if (key === 'keyboard') return new Proxy(target.keyboard, { get(keyboard, member) {
      if (member === 'press') return delayed(keyboard, member, true);
      const value: unknown = Reflect.get(keyboard, member); return typeof value === 'function' ? value.bind(keyboard) : value;
    } });
    if (key === 'getByRole' || key === 'getByTestId') return (...args: unknown[]) => locator(Reflect.apply(Reflect.get(target, key), target, args), `${key}:${String(args[0])}`);
    const value: unknown = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
}

test(`real release route ${variant} ${profile}`, async ({ page }, info) => {
  test.setTimeout(120000); // Unchanged first Release Smoke budget.
  const observations: Observation[] = [], errors: string[] = [], models = new Set<string>();
  const record = (event: Observation) => { if (observations.length >= 4096) observations.shift(); observations.push(event); };
  await page.exposeBinding('__routeExperimentSink', (_source, event: Observation) => record(event));
  await page.addInitScript(() => {
    let pending = 0, dropped = 0, last = 0;
    const frames: number[] = [];
    const emit = (type: string, data: unknown) => {
      if (pending >= 8 || !window.__routeExperimentSink) { dropped++; return; }
      pending++; void window.__routeExperimentSink({ at: Date.now(), type, data }).catch(() => { dropped++; }).finally(() => { pending--; });
    };
    const frame = (at: number) => { if (last) frames.push(at - last); last = at; requestAnimationFrame(frame); };
    requestAnimationFrame(frame);
    window.addEventListener('keydown', e => emit('keydown', { key: e.key, trusted: e.isTrusted, distance: document.querySelector('[data-testid="distance"]')?.textContent }));
    setInterval(() => {
      const distance = document.querySelector('[data-testid="distance"]')?.textContent ?? null;
      emit('ui', { distance, status: document.querySelector<HTMLElement>('.game-overlay')?.dataset.status,
        powerups: ['magnet', 'shield', 'double-score'].filter(id => document.querySelector(`[data-testid="active-${id}"]`)),
        notices: Array.from(document.querySelectorAll('[role="status"]')).map(e => e.textContent), dropped });
      if (frames.length) { emit('frames', { intervals: frames.splice(0), distance }); }
    }, 100);
  });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', r => errors.push(new URL(r.url()).pathname));
  page.on('response', r => { const path = new URL(r.url()).pathname; if (/powerup-(magnet|shield|double-score)\.glb$/.test(path)) { expect(r.ok()).toBe(true); models.add(path); } });
  let passed = false;
  try {
    await page.goto('./');
    await expect(page.locator('.character-preview')).toHaveAttribute('data-model-status', 'loaded');
    await page.locator('.route-details > summary').click();
    await page.getByLabel('路线 Seed').fill(POWERUP_ROUTE);
    await page.getByRole('button', { name: '应用路线', exact: true }).click();
    if (profile === 'ci-lag') { record({ at: Date.now(), type: 'workload-start', data: { busyMsPerFrame: 80 } }); await page.evaluate(() => {
      // Real bounded CPU contention slows the actual browser's frame scheduler.
      // It does not replace rAF, edit the game clock or alter any game state.
      let active = true, id = 0; const startedAt = performance.now();
      const work = () => {
        if (!active || performance.now() - startedAt > 90000) return;
        const end = performance.now() + 80;
        while (performance.now() < end) { /* diagnostic CPU workload */ }
        id = requestAnimationFrame(work);
      };
      id = requestAnimationFrame(work);
      window.__stopRouteWorkload = () => { active = false; cancelAnimationFrame(id); };
    }); }
    await page.getByRole('button', { name: '开始奔跑', exact: true }).click();
    await expect(page.getByRole('button', { name: '暂停游戏', exact: true })).toBeVisible();
    await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
    const bot = delayedPage(page, record);
    const routeStart = variant === 'current' ? await beginPowerupRoute(bot, info.outputPath('active.png')) : undefined;
    if (variant === 'legacy') {
      await page.keyboard.press('Space');
      await expect.poll(async () => Number(await page.getByTestId('distance').innerText())).toBeGreaterThan(20);
      await page.keyboard.press('ArrowDown');
    }
    if (variant === 'legacy') await legacyRoute(bot, info.outputPath('active.png'), 75000);
    else await followPowerupRoute(bot, info.outputPath('active.png'), 75000, routeStart);
    expect(models.size).toBe(3);
    const coins = await page.getByTestId('coins').innerText(); expect(Number(coins)).toBeGreaterThan(0);
    await expect(page.getByTestId('wallet')).toHaveText(coins);
    expect(await page.evaluate(() => '__RUNNER_TEST__' in window || '__RUNNER_RENDER__' in window)).toBe(false);
    expect(errors).toEqual([]); passed = true;
  } finally {
    await page.evaluate(() => { window.__stopRouteWorkload?.(); delete window.__stopRouteWorkload; }).catch(() => {});
    const path = info.outputPath('experiment.json');
    writeFileSync(path, JSON.stringify({ schemaVersion: 1, diagnosticOnly: true, eligibleForRelease: false, variant, profile, delayMs,
      passed, browser: page.context().browser()?.version(), viewport: page.viewportSize(), errors, observations }, null, 2) + '\n');
    await info.attach('route-experiment', { path, contentType: 'application/json' });
  }
});

// Immutable diagnostic control: original PR #7 helper, without logic changes.
/** Real production input bot, not a human playtest or a production state hook. */
async function legacyRoute(page: Page, capturePath: string, maxMs = 33000): Promise<void> {
  const level = new LevelGenerator(POWERUP_ROUTE);
  const rows = Array.from({ length: 25 }, () => level.next());
  let lane = 1, captured = false;
  const start = Date.now();
  while (Date.now() - start < maxMs && !await page.getByRole('button', { name: '再跑一次', exact: true }).isVisible()) {
    const distance = Number((await page.getByTestId('distance').innerText()).replaceAll(',', ''));
    if (distance > 266 && !captured) {
      for (const type of ['magnet', 'shield', 'double-score']) await expect(page.getByTestId(`active-${type}`)).toBeVisible();
      await page.screenshot({ path: capturePath });
      captured = true;
    }
    const target = distance > 280
      ? rows.flatMap(row => row.entities).find(entity => entity.kind !== 'coin' && entity.distance > distance + 9)?.lane
      : rows.find(row => row.distance >= distance - 9)?.safeLane;
    if (target !== undefined && lane !== target) {
      await page.keyboard.press(target < lane ? 'ArrowLeft' : 'ArrowRight');
      lane += target < lane ? -1 : 1;
    }
    await page.waitForTimeout(75);
  }
  await expect(page.getByRole('button', { name: '再跑一次', exact: true })).toBeVisible();
  expect(captured, 'all three powerups must be actually collected in the real run').toBe(true);
}
