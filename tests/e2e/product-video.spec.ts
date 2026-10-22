import { test } from '@playwright/test';
import { PRODUCT_VIEWPORTS, runProductJourney } from './product-helpers';

test.use({ viewport: { width: 1440, height: 900 }, video: { mode: 'on', size: { width: 960, height: 666 } } });

test('record full product flow through the normal page fixture', async ({ page }) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(15000);
  await runProductJourney(page, PRODUCT_VIEWPORTS[0], 'desktop-video', true);
  // The normal fixture finalizes its own video; no custom context close/save race.
});
