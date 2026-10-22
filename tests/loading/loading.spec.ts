import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

for (const profile of [{ name: 'desktop', width: 1440, height: 900, dpr: 1, touch: false }, { name: 'mobile-emulated', width: 390, height: 844, dpr: 3, touch: true }]) {
  test(`production cold/warm startup ${profile.name}`, async ({ browser }) => {
    const before = process.env.LOAD_BASELINE === '1';
    const context = await browser.newContext({ viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: profile.dpr, hasTouch: profile.touch, isMobile: profile.touch });
    await context.addInitScript((mode) => localStorage.setItem('runner3d-quality-v1', mode), profile.touch ? 'medium' : 'high');
    const page = await context.newPage(); const passes = [];
    for (const pass of ['cold', 'warm']) {
      const errors: string[] = []; const requests: string[] = [];
      const requestEvents: { path: string; method: string; type: string }[] = []; const responseEvents: { path: string; status: number }[] = []; const failedRequests: string[] = [];
      const requested = (request: import('@playwright/test').Request) => requestEvents.push({path:new URL(request.url()).pathname,method:request.method(),type:request.resourceType()});
      const requestFailed = (request: import('@playwright/test').Request) => failedRequests.push(request.url()); const failed = (e: Error) => errors.push(e.message);
      page.on('pageerror', failed);
      const receive = (response: import('@playwright/test').Response) => { responseEvents.push({path:new URL(response.url()).pathname,status:response.status()}); if (response.ok()) requests.push(new URL(response.url()).pathname); };
      page.on('response', receive); page.on('request',requested); page.on('requestfailed',requestFailed);
      await page.goto('http://127.0.0.1:4175/');
      const start = page.getByRole('button', { name: '开始奔跑', exact: true }); await expect(start).toBeEnabled(); const readyButtonMs = await page.evaluate(() => performance.now()); await start.click();
      await expect.poll(async () => Number((await page.getByTestId('distance').innerText()).replaceAll(',', ''))).toBeGreaterThan(2);
      const playableProbeMs = await page.evaluate(() => performance.now());
      await expect.poll(async () => Number(await page.getByTestId('coins').innerText())).toBeGreaterThan(0);
      const resources = await page.evaluate(() => ({
        paint: performance.getEntriesByType('paint').map((entry) => entry.toJSON()),
        navigation: performance.getEntriesByType('navigation').map((entry) => entry.toJSON()),
        resources: performance.getEntriesByType('resource').map((entry) => entry.toJSON()),
        canvas: { width: document.querySelector('canvas')?.width, height: document.querySelector('canvas')?.height, css: document.querySelector('canvas')?.getBoundingClientRect().toJSON() },
        pageWidth: document.documentElement.scrollWidth, viewport: [innerWidth, innerHeight],
      }));
      mkdirSync('artifacts/ui-ux/regression/mobile-baseline', { recursive: true });
      await page.screenshot({ path: `artifacts/ui-ux/regression/mobile-baseline/${before ? 'before' : 'after'}-${profile.name}-${pass}.png`, fullPage: true });
      passes.push({ pass, readyButtonMs, playableProbeMs, requests, requestEvents, responseEvents, failedRequests, ...resources, errors });
      page.off('pageerror', failed); page.off('response', receive); page.off('request',requested); page.off('requestfailed',requestFailed); expect(errors).toEqual([]); expect(failedRequests).toEqual([]);
    }
    writeFileSync(`artifacts/ui-ux/regression/mobile-baseline/${before ? 'before' : 'after'}-${profile.name}.json`, JSON.stringify({ browser: browser.version(), profile, scope: 'local production preview cold/warm context; readiness probe is real start followed by distance>2m; not internet TTI or phone hardware; old startup button had no resource gate', passes }, null, 2));
    await context.close();
  });
}
