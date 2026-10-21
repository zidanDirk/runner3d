import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { captureThemeAt, waitForThemeAssets } from './theme-helpers';

const cases = ['portrait-dusk-high','portrait-neon','landscape-dusk','landscape-neon','jump','slide','obstacle','over','pause','settings','low','reduced'] as const;
for (const name of cases) test(`mobile visual ${name}`, async ({ browser }) => {
  const landscape = name.startsWith('landscape');
  const context = await browser.newContext({ viewport:landscape ? {width:844,height:390} : {width:390,height:844}, hasTouch:true, isMobile:true, deviceScaleFactor:2, reducedMotion:name === 'reduced' ? 'reduce' : 'no-preference' });
  await context.addInitScript((quality) => localStorage.setItem('runner3d-quality-v1', quality), name === 'low' ? 'low' : name.endsWith('high') ? 'high' : 'medium');
  const page = await context.newPage(); const errors:string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/'); await expect(page.getByRole('button',{name:'开始奔跑',exact:true})).toBeEnabled(); await waitForThemeAssets(page);
  await captureThemeAt(page, name.includes('neon') ? 780 : name === 'obstacle' ? 39 : name === 'jump' || name === 'slide' ? 18 : 95);
  if (name === 'jump' || name === 'slide') { await page.keyboard.press(name === 'jump' ? 'Space' : 's'); await page.evaluate((ticks) => window.__RUNNER_TEST__?.stepTicks(ticks), name === 'jump' ? 48 : 20); }
  if (name === 'over') {
    await captureThemeAt(page, 0);
    await page.evaluate(() => { for(let i=0; i<10 && window.__RUNNER_TEST__?.read().status === 'running'; i++) window.__RUNNER_TEST__.stepTicks(1200); window.__RUNNER_TEST__?.stepFeedback(.2); });
    await expect(page.getByRole('heading', {name:'每一步，都算数。'})).toBeVisible();
  }
  if (name === 'pause') await page.keyboard.press('Escape');
  if (name === 'settings') { await page.getByRole('button',{name:'游戏设置',exact:true}).tap(); await expect(page.getByRole('dialog')).toBeVisible(); }
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.tick === window.__RUNNER_TEST__?.read().tick);
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
  const scene = await page.evaluate(() => window.__RUNNER_INSPECT__?.());
  expect(scene?.camera.position[1]).toBe(landscape ? 6.5 : 7.8);
  expect(scene?.camera.position[2]).toBe(landscape ? 10 : 12);
  for (const batch of scene?.batches ?? []) {
    expect(batch.count).toBe(batch.declared);
    for (const matrix of batch.items) expect(Math.abs(matrix[12] ?? 0)).toBeGreaterThan(6);
  }
  mkdirSync('artifacts/mobile-visual-actual',{recursive:true});
  await page.screenshot({path:`artifacts/mobile-visual-actual/${name}.png`});
  await expect(page).toHaveScreenshot(`mobile-${name}.png`,{animations:'disabled',maxDiffPixelRatio:.003});
  expect(errors).toEqual([]); await context.close();
});
