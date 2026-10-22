import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { startProgression } from './progression-helpers';
import { captureThemeAt } from './theme-helpers';

test('records real unpaused play at three difficulty ranges with disclosed preview cuts', async ({ browser }) => {
  test.setTimeout(80000); mkdirSync('artifacts/ui-ux/regression/balance', { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: 'artifacts/ui-ux/regression/balance/video-raw', size: { width: 960, height: 666 } } });
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await startProgression(page, 'RUNNER-01');
  const segments = [];
  for (const segment of [{ name: '初始难度', start: 0 }, { name: '中等难度', start: 900 }, { name: '高速难度', start: 2400 }]) {
    // A disclosed cut uses the pre-existing preview API, which advances the
    // actual engine along its safe route. Each following segment is live RAF.
    await captureThemeAt(page, segment.start);
    await page.evaluate(name => {
      const label = document.createElement('div'); label.id = 'balance-video-label'; label.textContent = `${name} · 开发定位剪切后实时奔跑`;
      label.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:99;padding:9px 16px;border-radius:6px;background:#0b172bef;color:#e9f0e8;font:14px sans-serif;pointer-events:none'; document.body.append(label);
      window.__RUNNER_TEST__?.freeze(false);
    }, segment.name);
    const timeline = [], begin = Date.now(); let jumped = false, slid = false;
    while (Date.now() - begin < 6500) {
      const state = await page.evaluate(() => window.__RUNNER_TEST__?.read()); if (!state) throw new Error('Game state missing');
      expect(state.status).toBe('running');
      timeline.push({ wallMs: Date.now() - begin, tick: state.tick, distance: state.distance, speed: state.speed, lane: state.player.lane, y: state.player.y, slideRemaining: state.player.slideRemaining, coins: state.coins, powerups: state.powerups });
      const row = state.rows.find(row => row.distance >= state.distance - 2);
      if (row && row.safeLane !== state.player.lane) await page.keyboard.press(row.safeLane < state.player.lane ? 'ArrowLeft' : 'ArrowRight');
      // Demonstrate actual legal motions while following an unobstructed lane.
      if (!jumped && Date.now() - begin > 1200) { jumped = true; await page.keyboard.press('Space'); }
      if (!slid && Date.now() - begin > 3200) { slid = true; await page.keyboard.press('s'); }
      await page.waitForTimeout(65);
    }
    await page.evaluate(() => { window.__RUNNER_TEST__?.freeze(true); document.getElementById('balance-video-label')?.remove(); });
    expect(timeline.length).toBeGreaterThan(30);
    expect(timeline.at(-1)!.tick - timeline[0]!.tick).toBeGreaterThan(600);
    expect(timeline.some(frame => frame.y > 0)).toBe(true); expect(timeline.some(frame => frame.slideRemaining > 0)).toBe(true);
    segments.push({ ...segment, durationMs: Date.now() - begin, method: 'Real unpaused RAF and trusted Playwright keyboard; no state/score/entity injection during segment', timeline });
  }
  const video = page.video(); await context.close(); if (!video) throw new Error('Actual video not produced'); await video.saveAs('artifacts/ui-ux/regression/balance/gameplay.webm');
  writeFileSync('artifacts/ui-ux/regression/balance/gameplay-timeline.json', JSON.stringify({ seed: 'RUNNER-01', method: 'Three sequential live segments with explicit preview seek cuts to0/900/2400m; NOT one continuous run or cross-tick deterministic video. Playwright video can have no audio track.', segments, errors }, null, 2));
  expect(errors).toEqual([]);
});
