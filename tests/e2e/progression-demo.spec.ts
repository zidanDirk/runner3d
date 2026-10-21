import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startProgression } from './progression-helpers';

test('records unpaused real gameplay with three natural pickups, shield break, coins and settlement', async ({ browser }) => {
  test.setTimeout(70000); mkdirSync('artifacts/progression', { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: 'test-results/progression-video', size: { width: 960, height: 666 } } });
  const page = await context.newPage(), timeline = [], events = new Map<string, unknown>();
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await startProgression(page, 'DEMO-11-4411'); await page.evaluate(() => window.__RUNNER_TEST__?.freeze(false));
  let jumped = false, slid = false, finish = false;
  const begin = Date.now();
  while (Date.now() - begin < 45000) {
    const record = await page.evaluate(() => ({ state: window.__RUNNER_TEST__?.read(), feedback: window.__FEEDBACK__ }));
    const s = record.state; if (!s) throw new Error('No real game');
    for (const event of record.feedback?.recent ?? []) events.set(event.id, event);
    timeline.push({ wallMs: Date.now() - begin, tick: s.tick, distance: s.distance, coins: s.coins, pickups: s.powerupsCollected, active: s.powerups, status: s.status });
    if (s.status === 'over') break;
    if (s.distance > 280 && s.powerupsCollected >= 3) finish = true;
    const lane = finish ? s.entities.find(e => e.kind !== 'coin' && e.distance > s.distance + 9)?.lane : s.rows.find(r => r.distance >= s.distance - 9)?.safeLane;
    if (lane !== undefined && lane !== s.player.lane) await page.keyboard.press(lane < s.player.lane ? 'ArrowLeft' : 'ArrowRight');
    if (!jumped && s.distance > 60) { jumped = true; await page.keyboard.press('Space'); }
    if (!slid && s.distance > 110) { slid = true; await page.keyboard.press('s'); }
    await page.waitForTimeout(75);
  }
  await expect(page.getByRole('heading', { name: '每一步，都算数。' })).toBeVisible();
  const final = await page.evaluate(() => window.__RUNNER_TEST__?.read()); expect(final?.powerupsCollected).toBeGreaterThanOrEqual(3);
  expect(final?.coins).toBeGreaterThan(10); expect(final?.scoreBonus).toBeGreaterThan(0);
  await expect(page.getByTestId('wallet')).toHaveText(String(final?.coins));
  expect([...events.values()].some(e => typeof e === 'object' && e !== null && 'type' in e && e.type === 'shield-broken')).toBe(true);
  await page.screenshot({ path: 'artifacts/progression/video-settlement.png' });
  await page.waitForTimeout(1200);
  const video = page.video(); await context.close(); if (!video) throw new Error('Actual video missing');
  await video.saveAs('artifacts/progression/gameplay.webm');
  writeFileSync('artifacts/progression/gameplay-timeline.json', JSON.stringify({ seed: 'DEMO-11-4411', capture: 'Actual unpaused RAF + trusted Playwright keyboard, no position/score/time injection during recorded play; operating-system scheduling is not deterministic; Playwright video may contain no audio track', events: [...events.values()], timeline, final, errors }, null, 2));
  expect(errors).toEqual([]);
});
