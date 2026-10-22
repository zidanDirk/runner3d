import { expect, test } from '@playwright/test';
import { endRun, playTo } from './progression-helpers';
import {
  PRODUCT_VIEWPORTS, captureProductScreen, chooseNeonAppearance, clearProductProgress,
  collectAtLeast, openTutorial, readProductFrame, readStoredProduct, startProductRun,
  waitForProductHome, writeProductEvidence,
} from './product-helpers';

/** Twenty approved product baselines; ordinary runs never create or update them. */
for (const viewport of PRODUCT_VIEWPORTS) test(`product UI screenshot evidence ${viewport.id}`, async ({ browser, baseURL }) => {
  test.setTimeout(100000);
  const context = await browser.newContext({ baseURL, viewport: { width: viewport.width, height: viewport.height },
    isMobile: viewport.mobile, hasTouch: viewport.mobile, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const frames: unknown[] = [];
  const capture = async (state: string) => {
    await captureProductScreen(page, viewport.id, state);
    await expect.soft(page).toHaveScreenshot(`product-${viewport.id}-${state}.png`, { animations: 'disabled' });
    frames.push({ state, actualFrame: await readProductFrame(page), saved: await readStoredProduct(page) });
  };
  try {
    await clearProductProgress(page); await waitForProductHome(page);
    await capture('home');
    if (viewport.id === 'desktop') {
      await openTutorial(page); await capture('tutorial');
      await page.getByRole('dialog', { name: '新手引导' }).getByRole('button', { name: '跳过引导', exact: true }).click();
    }
    if (viewport.id !== 'landscape') {
      await page.getByRole('button', { name: '角色外观', exact: true }).click();
      await page.getByRole('radio', { name: /Neon Cyan/ }).check();
      await capture('character');
      await page.getByRole('button', { name: '确认外观', exact: true }).click();
      await page.getByRole('button', { name: '升级商店', exact: true }).click();
      await capture('shop');
      await page.getByRole('button', { name: '关闭成长面板', exact: true }).click();
      await page.getByRole('button', { name: '任务', exact: true }).click();
      await capture('missions');
      await page.getByRole('button', { name: '关闭成长面板', exact: true }).click();
    } else await chooseNeonAppearance(page);
    await startProductRun(page); await playTo(page, 95); await capture('hud');
    if (viewport.id !== 'landscape') {
      await page.getByRole('button', { name: '暂停游戏', exact: true }).click();
      await capture('paused');
      if (viewport.id === 'desktop') {
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await capture('settings');
        await page.getByRole('button', { name: '关闭设置', exact: true }).click();
      }
      await page.getByRole('button', { name: '继续奔跑', exact: true }).click();
    }
    await collectAtLeast(page, 100); await endRun(page);
    await expect(page.getByTestId('record-badge')).toBeVisible();
    await capture(viewport.id === 'desktop' ? 'record' : 'results');
    if (viewport.id === 'desktop') {
      await page.getByRole('button', { name: '返回首页', exact: true }).click();
      await waitForProductHome(page); await startProductRun(page); await playTo(page, 150); await endRun(page);
      await expect(page.getByTestId('record-badge')).toHaveCount(0);
      await capture('results');
    }
    writeProductEvidence(`visual-${viewport.id}`, { viewport, scope: 'Actual Chromium screenshots with OS Reduced Motion for a stationary Idle preview; twenty product baselines approved after individual root view_image review; normal runs do not update snapshots', frames });
  } finally { await context.close(); }
});
