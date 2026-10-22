import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { prepareFeel, settleFeedback, stepFeelTo } from './feel-helpers';
import { captureThemeAt } from './theme-helpers';

const cases = ['coin', 'jump', 'land', 'slide', 'collision', 'speed', 'dusk', 'neon', 'reduced'] as const;
for (const name of cases) test(`visual feedback ${name}`, async ({ page }) => {
  await prepareFeel(page);
  if (name === 'speed') { await captureThemeAt(page, 10000); await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(24)); }
  else if (name === 'dusk' || name === 'neon' || name === 'reduced') {
    if (name === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
    await captureThemeAt(page, name === 'neon' ? 780 : 95); await page.keyboard.press('Space'); await page.evaluate(() => window.__RUNNER_TEST__?.stepTicks(8));
  } else {
    const target = { coin: 82, jump: 368, land: 482, slide: 744, collision: 1350 }[name];
    for (let tick = 8; tick < target; tick += 8) await stepFeelTo(page, tick);
    await stepFeelTo(page, target);
    if (name === 'collision') await page.evaluate(() => window.__RUNNER_TEST__?.stepFeedback(.08));
  }
  await settleFeedback(page);
  await page.evaluate(() => document.fonts.ready);
  mkdirSync('artifacts/ui-ux/regression/feel-visual-actual', { recursive: true });
  await page.locator('.game-stage').screenshot({ path: `artifacts/ui-ux/regression/feel-visual-actual/${name}.png` });
  await expect(page.locator('.game-stage')).toHaveScreenshot(`feel-${name}.png`, { animations: 'disabled', maxDiffPixelRatio: .003 });
});

// Task10: keep the existing image contract under repeated host lifecycles.
test('camera and instance matrices remain finite across capture and jump', async({browser})=>{
  test.setTimeout(120000);mkdirSync('artifacts/ui-ux/regression/mobile-investigation',{recursive:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();const frames=[];
  await prepareFeel(page);
  for(let i=0;i<30;i++) {
    await captureThemeAt(page,95);await page.keyboard.press('Space');await page.evaluate(()=>window.__RUNNER_TEST__?.stepTicks(8));
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    const before=await page.evaluate(()=>({render:window.__RUNNER_RENDER__,scene:window.__RUNNER_INSPECT__?.()}));
    const screenshot = await page.locator('.game-stage').screenshot({path:`artifacts/ui-ux/regression/mobile-investigation/capture-${i}.png`,animations:'disabled'});
    expect(screenshot).toMatchSnapshot('feel-dusk.png',{maxDiffPixelRatio:.003});
    const after=await page.evaluate(()=>({render:window.__RUNNER_RENDER__,scene:window.__RUNNER_INSPECT__?.()}));
    frames.push({i,before,after});
    expect(after.render?.character.visible).toBe(1);
  }
  writeFileSync('artifacts/ui-ux/regression/mobile-investigation/captures.json',JSON.stringify(frames,null,2));
  await context.close();
});

test('fresh scene loading never leaves constructor identity instances after captures',async({browser})=>{
 test.setTimeout(160000);const reports=[];
 for(let i=0;i<30;i++) {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
  await prepareFeel(page);await captureThemeAt(page,95);await page.keyboard.press('Space');await page.evaluate(()=>window.__RUNNER_TEST__?.stepTicks(8));
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const inspect=await page.evaluate(()=>({render:window.__RUNNER_RENDER__,scene:window.__RUNNER_INSPECT__?.()}));
  reports.push({i,...inspect});writeFileSync('artifacts/ui-ux/regression/mobile-investigation/fresh.json',JSON.stringify(reports,null,2));
  const screenshot = await page.locator('.game-stage').screenshot({path:`artifacts/ui-ux/regression/mobile-investigation/fresh-${i}.png`,animations:'disabled'});
  expect(screenshot).toMatchSnapshot('feel-dusk.png',{maxDiffPixelRatio:.003});
  for(const batch of inspect.scene?.batches??[]) {
   expect(batch.count).toBe(batch.declared);
   for(const matrix of batch.items) expect(Math.abs(matrix[12]??0)).toBeGreaterThan(6);
  }
  await context.close();
 }
});

