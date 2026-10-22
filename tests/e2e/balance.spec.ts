import { waitForHomePreview, startLiveGame } from './session-helpers';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Matrix4, Vector3 } from 'three';
import { LevelGenerator } from '../../src/game/level';
import { RULES, SHAPES, laneX } from '../../src/game/config';
import type { Lane, ObstacleKind } from '../../src/game/types';
import { analyzeReactionWindow, REACTION_ASSUMPTIONS } from '../../src/game/reaction';
import { startProgression, playTo, endRun } from './progression-helpers';
import { captureThemeAt, waitForThemeAssets } from './theme-helpers';

const OUTPUT = 'artifacts/ui-ux/regression/balance';
const errorsByPage = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; errorsByPage.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
});
test.afterEach(async ({ page }) => { expect(errorsByPage.get(page) ?? []).toEqual([]); });
const artifact = (name: string, value: unknown) => { mkdirSync(OUTPUT, { recursive: true }); writeFileSync(`${OUTPUT}/${name}.json`, JSON.stringify(value, null, 2)); };
async function settled(page: Page) {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}
async function image(page: Page, name: string) { await settled(page); mkdirSync(`${OUTPUT}/screenshots`, { recursive: true }); await page.screenshot({ path: `${OUTPUT}/screenshots/${name}.png` }); }

const level = new LevelGenerator('RUNNER-01');
const rows = Array.from({ length: 120 }, () => level.next());
const consecutive = rows.find((r, i) => i > 2 && rows[i + 1] && rows[i + 2] && r.safeLane !== rows[i + 1]?.safeLane && rows[i + 1]?.safeLane !== rows[i + 2]?.safeLane);
if (!consecutive) throw new Error('RUNNER-01 lacks consecutive real lane changes');
const jumpSlide = rows.flatMap((first, i) => {
  const second = rows[i + 1]; if (!second || first.index < 2) return [];
  for (const lane of [0, 1, 2] as const) if (first.entities.some(e => e.lane === lane && e.kind === 'hurdle') && second.entities.some(e => e.lane === lane && e.kind === 'gate')) return [{ first: first.distance, second: second.distance, lane }];
  return [];
})[0];
if (!jumpSlide) throw new Error('RUNNER-01 lacks a genuine jump-slide obstacle pair');

test('balance deterministic easy route and original seed replay', async ({ page }) => {
  await startProgression(page, 'RUNNER-01');
  const runs = [];
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(() => window.__RUNNER_TEST__?.captureAt('RUNNER-01', 0)); await playTo(page, 200);
    const state = await page.evaluate(() => window.__RUNNER_TEST__?.read());
    expect(state?.coins).toBeGreaterThan(10); expect(state?.speed).toBeGreaterThanOrEqual(16); expect(state?.speed).toBeLessThan(17);
    runs.push(state);
    if (pass === 0) { await page.evaluate(() => window.__RUNNER_TEST__?.captureAt('RUNNER-01', 80)); await image(page, 'difficulty-initial'); }
  }
  expect(runs[1]).toEqual(runs[0]); artifact('replay-easy', { seed: 'RUNNER-01', strategy: 'Actual fixed steps and original keyboard input adapter; preview excludes profile', identical: true, final: runs[0] });
});

test('balance consecutive real lane changes remain repeatable without powers', async ({ page }) => {
  await startProgression(page, 'RUNNER-01');
  const start = consecutive.distance - 20, target = consecutive.distance + RULES.rowSpacing * 2 + 3;
  const replays = [];
  for (let pass = 0; pass < 2; pass++) {
    await page.evaluate(start => window.__RUNNER_TEST__?.captureAt('RUNNER-01', start), start);
    const before = await page.evaluate(() => window.__RUNNER_TEST__?.read());
    await playTo(page, target, false);
    const after = await page.evaluate(() => window.__RUNNER_TEST__?.read());
    expect(after?.status).toBe('running');
    replays.push({ startTick: before?.tick, end: after });
  }
  expect(replays[1]).toEqual(replays[0]); artifact('replay-consecutive-lanes', { seed: 'RUNNER-01', start, target, firstRow: consecutive.index, replays });
});

test('balance actual jump followed by slide clears genuine consecutive obstacles', async ({ page }) => {
  await startProgression(page, 'RUNNER-01');
  const scenario = jumpSlide;
  await page.evaluate(start => window.__RUNNER_TEST__?.captureAt('RUNNER-01', start), scenario.first - 20);
  const run = await page.evaluate(scenario => {
    const hook = window.__RUNNER_TEST__; if (!hook) throw new Error('Fixed input seam absent');
    let jumped = false, slid = false, airborne = false, sliding = false;
    const log: { tick: number; distance: number; action: string }[] = [];
    while (hook.read().status === 'running' && hook.read().distance < scenario.second + 2) {
      const state = hook.read();
      const send = (code: string) => { window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })); log.push({ tick: state.tick, distance: state.distance, action: code }); };
      if (scenario.lane !== state.player.lane) send(scenario.lane < state.player.lane ? 'ArrowLeft' : 'ArrowRight');
      if (!jumped && state.distance >= scenario.first - 6) { send('Space'); jumped = true; }
      if (!slid && state.distance >= scenario.second - 6) { send('KeyS'); slid = true; }
      hook.stepTicks(1); airborne ||= hook.read().player.y > .85; sliding ||= hook.read().player.slideRemaining > 0;
    }
    return { final: hook.read(), log, airborne, sliding };
  }, scenario);
  expect(run.final.status).toBe('running'); expect(run.airborne).toBe(true); expect(run.sliding).toBe(true);
  expect(run.log.some(e => e.action === 'Space')).toBe(true); expect(run.log.some(e => e.action === 'KeyS')).toBe(true);
  artifact('replay-jump-slide', { seed: 'RUNNER-01', scenario, ...run });
  await page.evaluate(start => window.__RUNNER_TEST__?.captureAt('RUNNER-01', start), scenario.first - 5);
  await image(page, 'continuous-obstacles');
});

test('balance high speed and both themes retain normal play and render', async ({ page }) => {
  await startProgression(page);
  const medium = await captureThemeAt(page, 900); await image(page, 'difficulty-medium');
  expect(medium.themeId).toBe('neon-city');
  await captureThemeAt(page, 2400); await image(page, 'difficulty-high');
  const start = await page.evaluate(() => window.__RUNNER_TEST__?.read());
  expect(start?.speed).toBe(24); await playTo(page, 2600, false);
  const end = await page.evaluate(() => window.__RUNNER_TEST__?.read());
  expect(end?.status).toBe('running'); expect(end?.speed).toBe(24);
  artifact('replay-high-speed', { seed: 'RUNNER-01', medium, start, end });
});

test('balance natural triple powers, real settlement, purchase, missions and reload', async ({ page }) => {
  await startProgression(page, 'DEMO-11-4411'); await playTo(page, 270);
  for (const type of ['magnet', 'shield', 'double-score']) await expect(page.getByTestId(`active-${type}`)).toBeVisible();
  await image(page, 'powerups-active');
  const triple = await page.evaluate(() => window.__RUNNER_TEST__?.read()); expect(triple?.powerupsCollected).toBe(3); expect(triple?.scoreBonus).toBeGreaterThan(0);
  await playTo(page, 1100); await endRun(page);
  const earned = await page.evaluate(() => window.__RUNNER_TEST__?.read().coins ?? 0); expect(earned).toBeGreaterThanOrEqual(100);
  await expect(page.getByTestId('wallet')).toHaveText(String(earned));
  await page.getByRole('button', { name: '升级商店', exact: true }).click(); await page.getByRole('button', { name: '升级磁铁', exact: true }).click();
  await expect(page.getByLabel('磁铁升级', { exact: true })).toContainText('Lv.1 / 3'); await image(page, 'upgrade-shop');
  await page.getByRole('button', { name: '返回结算', exact: true }).click(); await page.getByRole('button', { name: '任务', exact: false }).click();
  await expect(page.getByTestId('mission-distance')).toContainText('1,000 / 1,000'); await image(page, 'mission-progress');
  await page.getByRole('button', { name: '领取累计奔跑距离奖励', exact: true }).click();
  const wallet = await page.getByTestId('panel-wallet').innerText();
  await page.reload(); await waitForHomePreview(page); await expect(page.getByTestId('wallet')).toHaveText(wallet);
  await page.getByRole('button', { name: '升级商店', exact: true }).click(); await expect(page.getByLabel('磁铁升级', { exact: true })).toContainText('Lv.1 / 3');
  artifact('replay-triple-powers', { seed: 'DEMO-11-4411', triple, actualEarnedCoins: earned, restoredWallet: wallet });
});

test('balance panel is opt-in, read-only, throttled and mobile layouts remain usable', async ({ page }) => {
  await page.goto('/?debugBalance=1&walletCoins=999999&magnet=3'); await waitForThemeAssets(page);
  const panel = page.getByLabel('游戏平衡调试信息'); await expect(panel).toBeVisible();
  await expect(panel).toContainText('阶段 适应'); await expect(panel).toContainText('钱包 0'); await expect(panel).toContainText('等级 M0 / S0 / D0');
  await expect(panel).toContainText('certified');
  await startLiveGame(page);
  const changes = await panel.evaluate(element => new Promise<number>(resolve => {
    let count = 0; const observer = new MutationObserver(() => count++); observer.observe(element, { childList: true, subtree: true, characterData: true });
    setTimeout(() => { observer.disconnect(); resolve(count); }, 1000);
  }));
  expect(changes).toBeGreaterThanOrEqual(2); expect(changes).toBeLessThanOrEqual(5);
  await page.reload(); await waitForThemeAssets(page);
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size); await settled(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await panel.boundingBox(); expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width);
    await startLiveGame(page);
    await page.keyboard.press('Escape'); await page.getByRole('button', { name: '升级商店', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '升级商店' })).toBeVisible(); await page.getByRole('button', { name: '返回游戏', exact: true }).click();
    await page.reload(); await waitForThemeAssets(page);
  }
  await page.goto('/'); await waitForThemeAssets(page); await expect(page.getByLabel('游戏平衡调试信息')).toHaveCount(0);
});

interface CameraSample { readonly inverse: number[]; readonly projection: number[] }
/** Project real collision-shape corners with the actual completed-frame camera
 * matrices. This is a geometry/fog proxy, not an image-recognition experiment. */
function recognizableDistance(camera: CameraSample, width: number, height: number, fog: { near: number; far: number }, kind: ObstacleKind, lane: Lane) {
  const inverse = new Matrix4().fromArray(camera.inverse), projection = new Matrix4().fromArray(camera.projection);
  const shape = SHAPES[kind], point = new Vector3();
  for (let distance = RULES.lookAhead; distance >= 1; distance -= REACTION_ASSUMPTIONS.readability.scanStepMeters) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, clipped = false;
    for (const x of [-1, 1]) for (const y of [0, 1]) for (const z of [-1, 1]) {
      point.set(laneX(lane) + x * shape.width / 2, shape.bottom + y * shape.height, -distance + z * shape.depth / 2).applyMatrix4(inverse).applyMatrix4(projection);
      clipped ||= Math.abs(point.x) > 1 || Math.abs(point.y) > 1 || Math.abs(point.z) > 1;
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x); minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
    }
    const pixels = Math.min((maxX - minX) * width / 2, (maxY - minY) * height / 2);
    point.set(laneX(lane), shape.bottom + shape.height / 2, -distance).applyMatrix4(inverse);
    const fraction = Math.max(0, Math.min(1, (-point.z - fog.near) / (fog.far - fog.near)));
    const unfoggedFraction = 1 - fraction * fraction * (3 - 2 * fraction);
    if (!clipped && pixels >= REACTION_ASSUMPTIONS.readability.minimumCssPixels && unfoggedFraction >= REACTION_ASSUMPTIONS.readability.minimumUnfoggedFraction) return { distance, projectedMinimumPixels: pixels, unfoggedFraction };
  }
  throw new Error(`No recognizable projected ${kind} on lane ${lane}`);
}

test('balance reaction visibility proxy uses real desktop and portrait cameras and fog', async ({ page }) => {
  const measurements = [];
  for (const viewport of [{ name: 'Desktop', width: 1440, height: 900 }, { name: 'MobilePortrait', width: 390, height: 844 }]) {
    await page.setViewportSize(viewport); await startProgression(page);
    for (const distance of [80, 900, 2400]) {
      const city = await captureThemeAt(page, distance);
      const inspection = await page.evaluate(() => window.__RUNNER_INSPECT__?.());
      const camera = inspection?.camera, fog = inspection?.fog; if (!camera || !fog) throw new Error('Actual camera matrices/fog unavailable');
      const canvas = await page.getByLabel('Runner3D 三跑道游戏场景', { exact: true }).boundingBox(); if (!canvas) throw new Error('Canvas CSS extent unavailable');
      for (const kind of ['hurdle', 'gate', 'block'] as const) for (const lane of [0, 1, 2] as const) {
        const visible = recognizableDistance(camera, canvas.width, canvas.height, fog, kind, lane);
        const action = kind === 'hurdle' ? 'jump' : kind === 'gate' ? 'slide' : 'lane';
        const windows = Object.fromEntries((['slow', 'ordinary', 'fast'] as const).map(profile => [profile, analyzeReactionWindow({ visibleDistance: visible.distance, speed: RULES.maxSpeed, kind, action, assumptions: REACTION_ASSUMPTIONS[profile] })]));
        expect(windows.ordinary?.sufficient).toBe(true);
        measurements.push({ viewport, gameDistance: distance, theme: city.themeId, canvas, camera, fog, kind, lane, ...visible, conservativeSpeed: RULES.maxSpeed, windows });
      }
    }
  }
  artifact('reaction-visibility', { method: 'Actual completed-frame Three.js projection/inverse matrices + production AABB extents; CSS pixel threshold and fog smoothstep proxy; scanned far-to-near in0.25m increments', assumptions: REACTION_ASSUMPTIONS, limitations: ['12 CSS pixels and35% unfogged fraction are unvalidated design assumptions, not human recognition thresholds', 'No occlusion/GLB silhouette/texture/contrast/color-vision/UI-cover/attention model; earlier obstacles can obscure later ones', 'Frozen camera at each sampled speed/lane; actual lane-camera damping and recognition differ', 'All approach budgets use24m/s for acceleration conservatism; no collision geometry changes', 'Chromium simulated mobile viewport, not physical mobile hardware'], measurements });
});
