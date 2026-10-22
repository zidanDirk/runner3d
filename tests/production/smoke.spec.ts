import { expect, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';

test('production build loads without test hooks, renders and supports a complete retry loop', async ({ page }) => {
  const errors: string[] = [];
  let modelLoaded = false;
  let characterLoaded = false;
  const cityLoaded = new Set<string>();
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (path.endsWith('/models/generated/city-runner.glb')) {
      characterLoaded = response.ok();
      if (!response.ok()) errors.push(`Character GLB response: ${response.status()}`);
    }
    if (/\/(city-building-0[12]|street-lamp)\.glb$/.test(path)) {
      if (response.ok()) cityLoaded.add(path);
      else errors.push(`City GLB response: ${response.status()}`);
    }
    if (new URL(response.url()).pathname.endsWith('/models/generated/roadblock.glb')) {
      modelLoaded = response.ok();
      if (!response.ok()) errors.push(`GLB response: ${response.status()}`);
    }
  });
  page.on('requestfailed', (request) => errors.push(`Request failed: ${request.url()}`));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  await page.getByRole('button', { name: '开始奔跑', exact: true }).click();
  await expect.poll(async () => Number(await page.getByTestId('distance').innerText())).toBeGreaterThan(15);
  await expect.poll(async () => Number(await page.getByTestId('coins').innerText())).toBeGreaterThan(0);
  expect(modelLoaded).toBe(true);
  expect(characterLoaded).toBe(true);
  expect(cityLoaded.size).toBe(3);
  expect(await page.evaluate(() => '__RUNNER_TEST__' in window || '__RUNNER_RENDER__' in window || '__CITY_RENDER__' in window)).toBe(false);
  await page.screenshot({ path: 'artifacts/ui-ux/regression/screenshots/production-running.png' });
  await page.getByRole('button', { name: '暂停游戏' }).click();
  const distance = await page.getByTestId('distance').innerText();
  await page.waitForTimeout(150);
  expect(await page.getByTestId('distance').innerText()).toBe(distance);
  await page.getByRole('button', { name: '继续奔跑' }).click();
  // This seed has an obstacle in the left lane at the first decision.
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('button', { name: '再跑一次' })).toBeVisible({ timeout: 15000 });
  await page.getByRole('button', { name: '再跑一次' }).click();
  expect(Number(await page.getByTestId('distance').innerText())).toBeLessThan(5);
  expect(await page.getByTestId('coins').innerText()).toBe('0');
  expect(errors).toEqual([]);
});

test('development asset preview is disabled in the production build', async ({ page }) => {
  const output = new URL('../../dist/assets/', import.meta.url);
  const bundle = readdirSync(output).filter((name) => name.endsWith('.js')).map((name) => readFileSync(new URL(name, output), 'utf8')).join('\n');
  for (const developmentOnly of ['__RUNNER_TEST__', '__ASSET_PREVIEW__', 'installCaptureHooks', 'animationTime', 'character-skeleton-helper', 'debugMotion', '运动调试信息', '__FEEDBACK__', '__EFFECT_PREVIEW__', 'debugEffects', 'effectPreview', '反馈调试信息', 'stressEffects', '__RUNNER_INSPECT__', '__MOBILE_RENDER__', 'debugMobile', 'MobileFrameWindow', '移动端调试信息']) expect(bundle).not.toContain(developmentOnly);
  await page.goto('/?assetPreview=1&themePreview=neon-city&characterPreview=city-runner&animation=slide&animationTime=0.375&showSkeleton=1&showJoints=1&debugMotion=1&debugCity=1&testMode=1&distance=590&debugEffects=1&effectPreview=collision&debugMobile=1');
  await expect(page.getByRole('button', { name: '开始奔跑', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '城市资产工厂。' })).toHaveCount(0);
  expect(await page.evaluate(() => '__ASSET_PREVIEW__' in window)).toBe(false);
  await expect(page.getByLabel('城市调试信息')).toHaveCount(0);
  expect(await page.evaluate(() => '__CITY_RENDER__' in window || '__RUNNER_TEST__' in window)).toBe(false);
  await expect(page.getByRole('heading', { name: 'Neon City 主题预览。' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'City Runner 角色预览。' })).toHaveCount(0);
  await expect(page.locator('.home-screen')).toBeVisible();
  await expect(page.getByTestId('distance')).toHaveCount(0);
  await expect(page.getByTestId('wallet')).toHaveText('0');
  await expect(page.getByText('开发定位演示')).toHaveCount(0);
  await expect(page.getByLabel('显示骨骼')).toHaveCount(0);
  await expect(page.getByLabel('运动调试信息')).toHaveCount(0);
  await expect(page.getByLabel('反馈调试信息')).toHaveCount(0);
  await expect(page.getByLabel('移动端调试信息')).toHaveCount(0);
  expect(await page.evaluate(() => '__MOBILE_RENDER__' in window)).toBe(false);
});

test('production mobile touch and settings operate without any developer hook', async ({ browser }) => {
  const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true});
  const page=await context.newPage(); const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/'); await page.getByRole('button',{name:'开始奔跑',exact:true}).tap();
  await expect.poll(async()=>Number(await page.getByTestId('distance').innerText())).toBeGreaterThan(3);
  const cdp=await context.newCDPSession(page);const box=await page.locator('canvas').boundingBox();if(!box)throw new Error('No production canvas');
  const x=box.x+box.width*.5,y=box.y+box.height*.5;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-90,y}]});
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.getByRole('button',{name:'游戏设置',exact:true}).tap();
  const dialog=page.getByRole('dialog',{name:'游戏设置'});await dialog.getByLabel('画质',{exact:true}).selectOption('low');
  await dialog.getByRole('button',{name:'关闭设置'}).tap();
  await expect(page.getByRole('button',{name:'继续奔跑',exact:true})).toBeVisible();
  const distance=await page.getByTestId('distance').innerText();await page.waitForTimeout(120);expect(await page.getByTestId('distance').innerText()).toBe(distance);
  expect(await page.evaluate(()=>{const canvas=document.querySelector('canvas');return canvas ? canvas.width/canvas.getBoundingClientRect().width : 0;})).toBeCloseTo(1,1);
  expect(await page.evaluate(()=> '__MOBILE_RENDER__' in window || '__RUNNER_TEST__' in window)).toBe(false);
  await page.screenshot({path:'artifacts/ui-ux/regression/mobile-iteration/production-mobile-low.png'});
  await page.getByRole('button',{name:'继续奔跑',exact:true}).tap();
  await expect(page.getByRole('button',{name:'再跑一次',exact:true})).toBeVisible({timeout:15000});
  await page.getByRole('button',{name:'再跑一次',exact:true}).tap();
  await expect.poll(async()=>Number(await page.getByTestId('distance').innerText())).toBeGreaterThan(1);
  expect(errors).toEqual([]);await context.close();
});

test('production HTML gives a visible loading shell before scripts and a no-JavaScript explanation',async({page,browser})=>{
  let release:()=>void=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/assets/index-*.js',async(route)=>{await gate;await route.continue();});
  await page.goto('/',{waitUntil:'commit'});
  await expect(page.getByText('正在加载游戏脚本…',{exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'加载遇到问题？重新加载'})).toBeVisible();
  release();await expect(page.getByRole('button',{name:'开始奔跑',exact:true})).toBeEnabled();
  await expect(page.getByText('正在加载游戏脚本…',{exact:true})).toHaveCount(0);
  const context=await browser.newContext({javaScriptEnabled:false});const bare=await context.newPage();
  await bare.goto('http://127.0.0.1:4173/');
  // Playwright text selectors intentionally skip noscript; verify the real element and its DOM text.
  await expect(bare.locator('noscript')).toBeVisible();
  expect(await bare.locator('noscript').evaluate(element=>element.textContent)).toBe('请启用 JavaScript 后打开游戏。');
  expect(await bare.locator('canvas').count()).toBe(0);await context.close();
});
