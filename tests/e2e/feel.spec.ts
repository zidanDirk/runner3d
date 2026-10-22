import { readActualAudio, waitForHomePreview, openGameSettings, closeGameSettings, startLiveGame } from './session-helpers';
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { prepareFeel, stepFeelTo, settleFeedback } from './feel-helpers';
import { captureThemeAt, waitForThemeAssets } from './theme-helpers';

test('actual collected coins immediately update HUD, emit pooled feedback and play bounded real Web Audio nodes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/'); await waitForHomePreview(page);
  expect((await readActualAudio(page)).contextCount).toBe(0);
  await startLiveGame(page);
  await page.evaluate(() => window.__RUNNER_TEST__?.captureAt('FEEL-09-194', 0));
  await page.waitForFunction(() => window.__FEEDBACK__?.audio.status === 'ready');
  await stepFeelTo(page, 82);
  const stats = await page.evaluate(() => window.__FEEDBACK__);
  expect(stats?.counts.coin).toBe(1); expect(stats?.particles).toBeGreaterThan(0); expect(stats?.particles).toBeLessThanOrEqual(192);
  expect(stats?.audio.contextCount).toBe(1); expect(stats?.audio.started).toBeGreaterThan(0); expect(stats?.audio.peakVoices).toBeLessThanOrEqual(12);
  await expect(page.getByTestId('coins')).toHaveText('1');
  await page.locator('.game-stage').screenshot({ path: 'artifacts/ui-ux/regression/screenshots/feel-coin.png' });
  await openGameSettings(page);
  await page.getByLabel('设置游戏音效', { exact: true }).uncheck();
  await settleFeedback(page); expect(await page.evaluate(() => window.__FEEDBACK__?.audio.activeVoices)).toBe(0);
  await page.getByLabel('设置音效音量', { exact: true }).fill('35'); await expect(page.getByRole('dialog', { name: '游戏设置' }).locator('output')).toHaveText('35%');
  await closeGameSettings(page);
  await page.reload(); await waitForHomePreview(page); await openGameSettings(page);
  await expect(page.getByLabel('设置游戏音效', { exact: true })).not.toBeChecked(); await expect(page.getByRole('dialog', { name: '游戏设置' }).locator('output')).toHaveText('35%');
  expect((await readActualAudio(page)).contextCount).toBe(0);
  expect(errors).toEqual([]);
});

test('real jump, landing, slide and lane facts are emitted once, pause freezes and reset clears pooled state', async ({ page }) => {
  await prepareFeel(page);
  let result = await stepFeelTo(page, 368); expect(result.effects?.counts.jump).toBe(1);
  await page.locator('.game-stage').screenshot({ path: 'artifacts/ui-ux/regression/screenshots/feel-jump.png' });
  result = await stepFeelTo(page, 482); expect(result.effects?.counts.land).toBe(1); expect(result.effects?.particles).toBeGreaterThan(0);
  await page.locator('.game-stage').screenshot({ path: 'artifacts/ui-ux/regression/screenshots/feel-land.png' });
  await page.keyboard.press('Escape'); await settleFeedback(page);
  const frozen = await page.evaluate(() => ({ time: window.__FEEDBACK__?.time, count: window.__FEEDBACK__?.particles, tick: window.__RUNNER_TEST__?.read().tick }));
  await page.waitForTimeout(150); await settleFeedback(page);
  expect(await page.evaluate(() => ({ time: window.__FEEDBACK__?.time, count: window.__FEEDBACK__?.particles, tick: window.__RUNNER_TEST__?.read().tick }))).toEqual(frozen);
  expect(await page.evaluate(() => window.__FEEDBACK__?.audio.state)).toBe('suspended');
  await openGameSettings(page);
  await page.getByLabel('设置音效音量', { exact: true }).click(); await page.keyboard.press('x'); await settleFeedback(page);
  expect(await page.evaluate(() => window.__FEEDBACK__?.audio.state)).toBe('suspended');
  await closeGameSettings(page);
  // Clear control focus: Esc is a gameplay key only when not editing a control.
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.keyboard.press('Escape'); await page.waitForFunction(() => window.__FEEDBACK__?.audio.status === 'ready');
  result = await stepFeelTo(page, 744); expect(result.effects?.counts.slide).toBe(1); expect(result.effects?.counts.lane).toBe(1);
  await page.locator('.game-stage').screenshot({ path: 'artifacts/ui-ux/regression/screenshots/feel-slide.png' });
  result = await stepFeelTo(page, 1020); expect(result.effects?.particles).toBe(0); expect(result.effects?.activeEffects).toBe(0);
  await page.keyboard.press('Escape'); await page.getByRole('button', { name: '从头开始' }).click();
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true)); await settleFeedback(page);
  expect(await page.evaluate(() => window.__FEEDBACK__?.particles)).toBe(0);
  expect(await page.evaluate(() => window.__FEEDBACK__?.audio.contextCount)).toBe(1);
});

test('collision ends immediately and its finite visual tail renders once before clean retry', async ({ page }) => {
  await prepareFeel(page); await stepFeelTo(page, 1200); const result = await stepFeelTo(page, 1350);
  expect(result.status).toBe('over'); expect(result.effects?.counts.collision).toBe(1); expect(result.effects?.counts['game-over']).toBe(1);
  const tick = result.tick;
  expect(result.effects?.particles).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: '再跑一次' })).toBeVisible();
  await page.locator('.game-stage').screenshot({ path: 'artifacts/ui-ux/regression/screenshots/feel-collision.png' });
  await page.evaluate(() => window.__RUNNER_TEST__?.stepFeedback(.2)); await settleFeedback(page);
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().tick)).toBe(tick);
  await page.evaluate(() => window.__RUNNER_TEST__?.stepFeedback(1)); await settleFeedback(page);
  expect(await page.evaluate(() => window.__FEEDBACK__?.particles)).toBe(0);
  await page.getByRole('button', { name: '再跑一次' }).click(); await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true)); await settleFeedback(page);
  expect(await page.evaluate(() => window.__FEEDBACK__?.particles)).toBe(0);
  expect(await page.evaluate(() => window.__FEEDBACK__?.counts.collision ?? 0)).toBe(0);
});

test('both themes, high speed edges and OS reduced motion preserve actual gameplay', async ({ page }) => {
  await prepareFeel(page); await captureThemeAt(page, 10000);
  await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(24)); await settleFeedback(page);
  expect(await page.evaluate(() => window.__FEEDBACK__?.edgeParticles)).toBeGreaterThan(0);
  await page.locator('.game-stage').screenshot({ path: 'artifacts/ui-ux/regression/screenshots/feel-speed.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await captureThemeAt(page, 10000); await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(24)); await settleFeedback(page);
  expect(await page.evaluate(() => window.__FEEDBACK__?.edgeParticles)).toBe(0);
  expect(await page.evaluate(() => window.__RUNNER_TEST__?.read().speed)).toBe(24);
  for (const [theme, distance] of [['dusk', 95], ['neon', 780]] as const) {
    await captureThemeAt(page, distance); await page.keyboard.press('Space'); await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(8)); await settleFeedback(page);
    expect(await page.evaluate(() => window.__FEEDBACK__?.counts.jump)).toBe(1);
    await page.locator('.game-stage').screenshot({ path: `artifacts/ui-ux/regression/screenshots/feel-${theme}.png` });
  }
});

test('fixed-seed isolated preview supports real rendering, pause, step and reduced particles without mounting the game', async ({ page }) => {
  await page.goto('/?effectPreview=coin&effectTime=.12&effectSeed=PREVIEW-09');
  await page.waitForFunction(() => window.__EFFECT_PREVIEW__?.particles === 9);
  expect(await page.evaluate(() => '__RUNNER_TEST__' in window)).toBe(false);
  await page.getByRole('button', { name: '单步 +1/60秒' }).click();
  await page.waitForFunction(() => (window.__EFFECT_PREVIEW__?.time ?? 0) > .13);
  await page.getByLabel('减少动态效果').check(); await page.waitForFunction(() => window.__EFFECT_PREVIEW__?.particles === 3);
  await page.getByRole('button', { name: '播放特效', exact: true }).click(); await page.waitForTimeout(120);
  await page.getByRole('button', { name: '暂停特效', exact: true }).click(); await settleFeedback(page);
  const time = await page.evaluate(() => window.__EFFECT_PREVIEW__?.time); await page.waitForTimeout(100); expect(await page.evaluate(() => window.__EFFECT_PREVIEW__?.time)).toBe(time);
  await page.getByRole('button', { name: '重播特效' }).click(); await page.waitForFunction(() => window.__EFFECT_PREVIEW__?.time === 0);
  await page.locator('.effect-preview-stage').screenshot({ path: 'artifacts/ui-ux/regression/screenshots/feel-preview.png' });
});

test('the explicitly synthetic pool probe still reaches its cap after real events and never changes the actual fact timeline', async ({ page }) => {
  await prepareFeel(page); await stepFeelTo(page, 200);
  const before = await page.evaluate(() => ({ coins: window.__RUNNER_TEST__?.read().coins, tick: window.__RUNNER_TEST__?.read().tick, counts: window.__FEEDBACK__?.counts }));
  await page.evaluate(() => window.__RUNNER_TEST__?.stressEffects(80)); await settleFeedback(page);
  expect(await page.evaluate(() => window.__FEEDBACK__?.particles)).toBe(192);
  expect(await page.evaluate(() => ({ coins: window.__RUNNER_TEST__?.read().coins, tick: window.__RUNNER_TEST__?.read().tick, counts: window.__FEEDBACK__?.counts }))).toEqual(before);
  await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(60)); await settleFeedback(page);
  await page.evaluate(() => window.__RUNNER_TEST__?.stressEffects(80)); await settleFeedback(page);
  expect(await page.evaluate(() => window.__FEEDBACK__?.particles)).toBe(192);
});

test('the exact procedural PCM renders through a real OfflineAudioContext; measurable audio is separate from listening', async ({ page }) => {
  await page.goto('/'); await waitForThemeAssets(page);
  const result = await page.evaluate(async () => {
    const path = '/src/audio/synthesis.ts';
    const synth: typeof import('../../src/audio/synthesis') = await import(/* @vite-ignore */ path);
    const sounds = [];
    for (const id of synth.SOUND_IDS) {
      const generated = synth.synthesizeSound(id, 44100, 0);
      const context = new OfflineAudioContext(1, generated.samples.length, 44100);
      const buffer = context.createBuffer(1, generated.samples.length, 44100); buffer.copyToChannel(new Float32Array(generated.samples), 0);
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); source.start();
      const rendered = await context.startRendering(); const data = rendered.getChannelData(0); let sum = 0; let peak = 0;
      for (const value of data) { sum += value * value; peak = Math.max(peak, Math.abs(value)); }
      sounds.push({ id, samples: Array.from(data), rms: Math.sqrt(sum / data.length), peak, duration: rendered.duration, provenance: generated.provenance });
    }
    return { rate: 44100, sounds };
  });
  mkdirSync('artifacts/ui-ux/regression/audio', { recursive: true });
  for (const sound of result.sounds) {
    expect(sound.peak).toBeGreaterThan(.05); expect(sound.peak).toBeLessThan(.3); expect(sound.rms).toBeGreaterThan(.005);
    const file = Buffer.alloc(44 + sound.samples.length * 2); file.write('RIFF'); file.writeUInt32LE(file.length - 8, 4); file.write('WAVEfmt ', 8); file.writeUInt32LE(16, 16); file.writeUInt16LE(1, 20); file.writeUInt16LE(1, 22); file.writeUInt32LE(result.rate, 24); file.writeUInt32LE(result.rate * 2, 28); file.writeUInt16LE(2, 32); file.writeUInt16LE(16, 34); file.write('data', 36); file.writeUInt32LE(file.length - 44, 40);
    sound.samples.forEach((value, index) => file.writeInt16LE(Math.round(Math.max(-1, Math.min(1, value)) * 32767), 44 + index * 2));
    writeFileSync(`artifacts/ui-ux/regression/audio/${sound.id}.wav`, file);
  }
  writeFileSync('artifacts/ui-ux/regression/audio/offline-validation.json', JSON.stringify({ rate: result.rate, scope: 'real OfflineAudioContext output from runtime synthesis; does not assert speaker listening or video audio capture', sounds: result.sounds.map(({ samples, ...data }) => ({ ...data, samples: samples.length })) }, null, 2));
});
