import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DIFFICULTY_CONFIG } from '../../src/game/difficulty';
import { analyzeReactionWindow, REACTION_ASSUMPTIONS } from '../../src/game/reaction';
import { startProgression, playTo } from './progression-helpers';
import { waitForThemeAssets } from './theme-helpers';

const glyphs = { hurdle: '↑', gate: '↓', block: '■', clear: '·' };
for (const viewport of [{ name: 'portrait', width: 390, height: 844 }, { name: 'landscape', width: 844, height: 390 }]) test(`compact ${viewport.name} provides read-only typed obstacle warning before low-poly recognition`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize(viewport); await startProgression(page, 'RUNNER-01');
  const preview = page.getByTestId('hazard-preview'); await expect(preview).toHaveCount(0);
  await page.evaluate(() => window.__RUNNER_TEST__?.captureAt('RUNNER-01', 2400));
  const target = await page.evaluate(() => {
    const state = window.__RUNNER_TEST__?.read();
    const row = state?.rows.find(row => row.distance > state.distance + 50 && row.distance < state.distance + 90 && row.entities.some(entity => entity.kind !== 'coin'));
    if (!row) throw new Error('Natural next warning row not generated'); return row.distance;
  });
  await page.evaluate(distance => window.__RUNNER_TEST__?.advanceTo(distance - 49), target);
  await expect(preview).toBeVisible(); await waitForThemeAssets(page); await page.waitForFunction(() => window.__MOBILE_RENDER__?.game.tick === window.__RUNNER_TEST__?.read().tick);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  const state = await page.evaluate(() => window.__RUNNER_TEST__?.read()); if (!state) throw new Error('No actual game state');
  expect(state.speed).toBe(24);
  const displayed = await preview.getByTestId('hazard-row').evaluateAll(elements => elements.map(row => ({
    distance: Number(row.getAttribute('data-distance')), id: Number(row.getAttribute('data-row-id')),
    kinds: Array.from(row.querySelectorAll('.hazard-glyph')).map(icon => icon.getAttribute('data-kind')),
    glyphs: Array.from(row.querySelectorAll('.hazard-glyph')).map(icon => icon.textContent),
  })));
  expect(displayed.length).toBeGreaterThan(0); expect(displayed.length).toBeLessThanOrEqual(2);
  expect(displayed.some(row => row.distance === target)).toBe(true);
  for (const row of displayed) {
    const actual = state.rows.find(actual => actual.index === row.id); if (!actual) throw new Error('Warning row is not a real generated row');
    expect(row.distance).toBe(actual.distance);
    const kinds = [0, 1, 2].map(lane => actual.entities.find(entity => entity.lane === lane && entity.kind !== 'coin')?.kind ?? 'clear');
    expect(row.kinds).toEqual(kinds);
    expect(row.glyphs).toEqual(kinds.map(kind => kind === 'hurdle' ? glyphs.hurdle : kind === 'gate' ? glyphs.gate : kind === 'block' ? glyphs.block : glyphs.clear));
  }
  for (const icon of await preview.locator('.hazard-glyph').all()) {
    const box = await icon.boundingBox(); if (!box) throw new Error('Warning icon invisible');
    expect(box.width).toBeGreaterThanOrEqual(24); expect(box.height).toBeGreaterThanOrEqual(24);
    expect(await icon.evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(24);
  }
  const before = JSON.stringify(state); await page.waitForTimeout(350);
  expect(await page.evaluate(() => JSON.stringify(window.__RUNNER_TEST__?.read()))).toBe(before);
  const bounds = await preview.boundingBox(), canvas = await page.locator('canvas').boundingBox(); if (!bounds || !canvas) throw new Error('Warning/canvas layout missing');
  const projection = await page.evaluate(() => window.__MOBILE_RENDER__?.camera); if (!projection) throw new Error('Actual mobile camera projection missing');
  const points = [projection.playerPixels.foot, projection.playerPixels.head].map(([x, y]) => ({ x: canvas.x + x, y: canvas.y + y }));
  const forward = projection.projections.forwardHazard;
  points.push({ x: canvas.x + (forward[0] + 1) * canvas.width / 2, y: canvas.y + (1 - forward[1]) * canvas.height / 2 });
  for (const point of points) expect(point.x < bounds.x - 8 || point.x > bounds.x + bounds.width + 8 || point.y < bounds.y - 8 || point.y > bounds.y + bounds.height + 8).toBe(true);
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
  mkdirSync('artifacts/ui-ux/regression/balance/screenshots', { recursive: true });
  await page.screenshot({ path: `artifacts/ui-ux/regression/balance/screenshots/mobile-high-warning${viewport.name === 'landscape' ? '-landscape' : ''}.png` });
  const config = DIFFICULTY_CONFIG.telegraph;
  const windows = Object.fromEntries((['slow', 'ordinary', 'fast'] as const).map(profile => [profile, analyzeReactionWindow({ visibleDistance: config.lookAhead, speed: 24, kind: 'hurdle', action: 'jump', assumptions: REACTION_ASSUMPTIONS[profile] })]));
  const observedWindows = Object.fromEntries((['slow', 'ordinary', 'fast'] as const).map(profile => [profile, analyzeReactionWindow({ visibleDistance: target - state.distance, speed: 24, kind: 'hurdle', action: 'jump', assumptions: REACTION_ASSUMPTIONS[profile] })]));
  const afterAssumedPresentationDelay = Object.fromEntries((['slow', 'ordinary', 'fast'] as const).map(profile => [profile, analyzeReactionWindow({ visibleDistance: config.lookAhead - 24 * .20, speed: 24, kind: 'hurdle', action: 'jump', assumptions: REACTION_ASSUMPTIONS[profile] })]));
  const record = { viewport, seed: state.seed, speed: state.speed, distance: state.distance, targetRow: target, targetAhead: target - state.distance, displayed, bounds, actualCamera: projection, protectedReferencePoints: points, symbolCssPixels: 24, config, conservativeWindowsAt50m: windows, conservativeWindowsAtObservedRow: observedWindows, nominalHudPublicationThresholdSeconds: .05, assumedPublicationAndPresentationDelaySeconds: .20, conservativeWindowsAfterAssumedPresentationDelay: afterAssumedPresentationDelay,
    limitations: ['This verifies factual obstacle telegraph geometry and budget, not human understanding/recognition', '24CSSpx warning icons are screen-space and do not shrink with3D perspective; icon comprehension still requires human/device testing', '50m is designed look-ahead;0.05sHUD publication threshold is not maximum lag.0.20s publication/presentation delay is an additional sensitivity assumption, not a measured latency bound; host stalls can be longer', 'The approximately49m read and screenshot are frozen samples, not measurement of first live visible pixels', 'Reference-point separation is not proof that every future trajectory or all body pixels are unobscured', 'Actual Chromium viewport emulation, not real iOS/Android device'] };
  await page.keyboard.press('Escape'); await expect(preview).toHaveCount(0);
  await page.getByRole('button', { name: '继续奔跑', exact: true }).click(); await expect(preview).toBeVisible();
  // A genuine1000m mission completion overlaps the high-speed warning. This is
  // a normal run through the existing input seam, not an injected notification.
  await startProgression(page, 'DEMO-11-4411'); await playTo(page, 1005); await waitForThemeAssets(page);
  // Let the genuine1.4s speed toast finish through real RAF gameplay; its frozen
  // presentation otherwise overlaps the pre-existing power-up timer in this layout capture.
  await page.evaluate(() => window.__RUNNER_TEST__?.autopilot(true));
  await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('.speed-feedback')!).opacity) < .02);
  const careerState = await page.evaluate(() => {
    const hooks = window.__RUNNER_TEST__; if (!hooks) throw new Error('No actual clock');
    hooks.freeze(true); hooks.autopilot(false); return { tick: hooks.read().tick, distance: hooks.read().distance, status: hooks.read().status };
  });
  expect(careerState.status).toBe('running');
  // Asset diagnostics can still describe the previous frame. Require the exact
  // current distance/tick rather than accepting an old fallback-free snapshot.
  await page.waitForFunction(target => {
    const city = window.__CITY_RENDER__;
    return city?.distance === target.distance && city.fallbackBatches === 0 && city.expectedBatches > 0 && city.batches === city.expectedBatches && window.__MOBILE_RENDER__?.game.tick === target.tick;
  }, careerState);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const banner = page.getByLabel('任务完成提示'); await expect(banner).toBeVisible(); await expect(preview).toBeVisible();
  const bannerBox = await banner.boundingBox(), warningBox = await preview.boundingBox();
  if (!bannerBox || !warningBox) throw new Error('Actual completion banner or warning missing');
  expect(bannerBox.x + bannerBox.width <= warningBox.x || warningBox.x + warningBox.width <= bannerBox.x || bannerBox.y + bannerBox.height <= warningBox.y || warningBox.y + warningBox.height <= bannerBox.y).toBe(true);
  const timerBoxes = [];
  for (const timer of await page.locator('.powerup-timer').all()) {
    const box = await timer.boundingBox(); if (box) expect(box.x + box.width <= warningBox.x || warningBox.x + warningBox.width <= box.x || box.y + box.height <= warningBox.y || warningBox.y + warningBox.height <= box.y).toBe(true);
    timerBoxes.push({ label: await timer.innerText(), bounds: box });
  }
  await page.screenshot({ path: `artifacts/ui-ux/regression/balance/screenshots/mobile-high-warning-career-${viewport.name}.png` });
  let prior: unknown[] = [];
  try { const data: unknown = JSON.parse(readFileSync('artifacts/ui-ux/regression/balance/telegraph-analysis.json', 'utf8')); if (Array.isArray(data)) prior = data.filter(item => !(item && typeof item === 'object' && 'viewport' in item && item.viewport && typeof item.viewport === 'object' && 'name' in item.viewport && item.viewport.name === viewport.name)); } catch { /* First viewport starts this evidence artifact. */ }
  const models = await page.evaluate(() => ({ city: window.__CITY_RENDER__, character: window.__RUNNER_RENDER__?.character }));
  writeFileSync('artifacts/ui-ux/regression/balance/telegraph-analysis.json', JSON.stringify([...prior, { ...record, actualCareerLayout: { careerState, bannerBox, warningBox, timerBoxes, models } }], null, 2));
  await page.setViewportSize({ width: 1440, height: 1000 }); await expect(preview).toBeHidden();
  await page.goto('/'); await waitForThemeAssets(page); await expect(preview).toHaveCount(0);
  expect(errors).toEqual([]);
});
