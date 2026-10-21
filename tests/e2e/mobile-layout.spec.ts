import { requestGameScene, startLiveGame } from './session-helpers';
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { captureThemeAt, waitForThemeAssets } from './theme-helpers';

for (const [width,height] of [[320,568],[375,667],[390,844],[430,932],[667,375],[844,390],[1024,768],[1440,900]] as const) test(`responsive layout ${width}x${height}`, async ({browser}) => {
  const context=await browser.newContext({viewport:{width,height},hasTouch:width<1100,isMobile:width<900,deviceScaleFactor:2});
  await context.addInitScript(()=>localStorage.setItem('runner3d-quality-v1','high'));
  const page=await context.newPage(); const errors:string[]=[]; page.on('pageerror',(error)=>errors.push(error.message));
  await page.goto('/'); await expect(page.getByRole('button',{name:'开始奔跑',exact:true})).toBeEnabled(); await waitForThemeAssets(page);
  await captureThemeAt(page,95);
  const bounds=await page.locator('.game-stage').boundingBox(); if(!bounds) throw new Error('No game bounds');
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y+bounds.height).toBeLessThanOrEqual(height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  for(const name of ['向左换道','向右换道','跳跃','滑铲','暂停游戏']) {
    const button=page.getByRole('button',{name,exact:true}); const box=await button.boundingBox(); if(!box) throw new Error(`No ${name}`);
    expect(box.width).toBeGreaterThanOrEqual(width<1100?44:36); expect(box.height).toBeGreaterThanOrEqual(width<1100?44:36);
    expect(box.y+box.height).toBeLessThanOrEqual(height); expect(box.x+box.width).toBeLessThanOrEqual(width);
  }
  await captureThemeAt(page,0);
  await page.keyboard.press('ArrowLeft'); await page.evaluate(()=>window.__RUNNER_TEST__?.stepTicks(28));
  await page.keyboard.press('Space'); await page.evaluate(()=>window.__RUNNER_TEST__?.stepTicks(48));
  const render=await page.evaluate(()=>window.__RUNNER_RENDER__); expect(render?.character.visible).toBe(1);
  const root=await page.evaluate(()=>window.__RUNNER_TEST__?.read().player); expect(root?.y).toBeGreaterThan(2);
  mkdirSync('artifacts/mobile-layout',{recursive:true}); await page.screenshot({path:`artifacts/mobile-layout/${width}x${height}-jump.png`});
  if(width<1100) {
    await page.getByRole('button',{name:'游戏设置',exact:true}).tap();
    const dialog=page.getByRole('dialog',{name:'游戏设置'}); await expect(dialog).toBeVisible();
    const box=await dialog.boundingBox(); expect(box?.x).toBeGreaterThanOrEqual(0); expect((box?.y??0)+(box?.height??0)).toBeLessThanOrEqual(height+1);
    await dialog.getByLabel('画质',{exact:true}).selectOption('low');
    await dialog.getByRole('button',{name:'关闭设置'}).tap();
    await expect(page.getByRole('heading',{name:'稍作停留。'})).toBeVisible();
  }
  expect(errors).toEqual([]); await context.close();
});

test('model loading is staged, retriable and cache shared with rendered models',async({page})=>{
  let fail=true; const urls:string[]=[];
  await page.route('**/models/generated/roadblock.glb*',async(route)=>{ if(fail) await route.abort('failed');else await route.continue(); });
  page.on('request',request=>{if(request.url().includes('.glb'))urls.push(request.url());});
  await page.goto('/'); await requestGameScene(page); await expect(page.getByRole('button',{name:'重试资源加载'})).toBeVisible();
  await expect(page.getByRole('button',{name:'开始奔跑',exact:true})).toBeDisabled();
  fail=false; await page.getByRole('button',{name:'重试资源加载'}).click();
  await waitForThemeAssets(page); await expect(page.getByRole('button',{name:'暂停游戏',exact:true})).toBeEnabled();
  expect(urls.filter(url=>url.includes('/roadblock.glb'))).toHaveLength(2);
  expect(urls.filter(url=>url.includes('/neon-'))).toHaveLength(0);
  await captureThemeAt(page,360); await captureThemeAt(page,780); await captureThemeAt(page,95); await captureThemeAt(page,780);
  const ids=urls.filter(url=>!url.includes('/roadblock.glb')); expect(new Set(ids).size).toBe(ids.length);
  expect(ids.filter(url=>url.includes('/neon-'))).toHaveLength(4);
});

test('resize during a frozen real jump reuses Canvas and preserves physics while recomputing camera projection',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
  await context.addInitScript(()=>localStorage.setItem('runner3d-quality-v1','low'));
  const page=await context.newPage();await page.goto('/');await waitForThemeAssets(page);await captureThemeAt(page,0);
  await page.keyboard.press('Space');await page.evaluate(()=>window.__RUNNER_TEST__?.stepTicks(48));
  const before=await page.evaluate(()=>{const canvas=document.querySelector('canvas');if(canvas)canvas.dataset.rotationProbe='same';return window.__RUNNER_TEST__?.read();});
  for(const viewport of [{width:844,height:390},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(({width,height})=>window.__MOBILE_RENDER__?.viewport.width===width && window.__MOBILE_RENDER__.viewport.height===height,viewport);
    await page.waitForFunction(()=>window.__RUNNER_RENDER__?.tick===window.__RUNNER_TEST__?.read().tick);
    expect(await page.evaluate(()=>window.__RUNNER_TEST__?.read())).toEqual(before);
    expect(await page.locator('canvas').getAttribute('data-rotation-probe')).toBe('same');
    const render=await page.evaluate(()=>window.__MOBILE_RENDER__);expect(render?.camera.fov).toBeGreaterThan(51);
    expect(render?.camera.projections.playerHead[1]).toBeGreaterThan(-1);expect(render?.camera.projections.playerHead[1]).toBeLessThan(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(viewport.width);
    expect(await page.evaluate(()=>window.__MOBILE_RENDER__?.dpr)).toBe(1);
  }
  await context.close();
});

test('smallest HUD keeps earned five-digit distance and scores separate',async({browser})=>{
  const context=await browser.newContext({viewport:{width:320,height:568},hasTouch:true,isMobile:true,deviceScaleFactor:2});
  const page=await context.newPage();await page.goto('/');await waitForThemeAssets(page);await captureThemeAt(page,10000);
  const distance=await page.getByTestId('distance').boundingBox(), score=await page.getByTestId('score').boundingBox(),coins=await page.getByTestId('coins').boundingBox();
  for(const box of [distance,score,coins]) {if(!box)throw new Error('HUD missing');expect(box.x).toBeGreaterThan(10);expect(box.x+box.width).toBeLessThan(310);}
  if(!distance||!score||!coins)throw new Error('HUD missing');
  const overlaps=(a:typeof distance,b:typeof score)=>a.x<b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y;
  expect(overlaps(distance,score)).toBe(false);expect(overlaps(distance,coins)).toBe(false);expect(overlaps(score,coins)).toBe(false);
  await page.screenshot({path:'artifacts/mobile-layout/320x568-long-run.png'});await context.close();
});

test('development mobile panel reports completed frames without intercepting game controls',async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:2});
  await context.addInitScript(()=>localStorage.setItem('runner3d-quality-v1','low'));
  const page=await context.newPage();await page.goto('/?debugMobile=1');await waitForThemeAssets(page);
  const panel=page.getByLabel('移动端调试信息');await expect(panel).toBeVisible();
  await page.waitForFunction(()=> (window.__MOBILE_RENDER__?.frames.samples??0)>=100);
  await expect(panel).toContainText('DPR 1.00');await expect(panel).toContainText('Chunk 9');await expect(panel).toContainText('P99');await expect(panel).toContainText('GPU');
  await startLiveGame(page);
  await expect.poll(async()=>await page.evaluate(()=>window.__RUNNER_TEST__?.read().distance??0)).toBeGreaterThan(1);
  await page.getByRole('button',{name:'向左换道',exact:true}).tap();
  await expect.poll(async()=>await page.evaluate(()=>window.__RUNNER_TEST__?.read().player.lane)).toBe(0);
  await page.keyboard.press('Escape');await page.screenshot({path:'artifacts/mobile-iteration/debug-mobile.png'});
  await context.close();
});
