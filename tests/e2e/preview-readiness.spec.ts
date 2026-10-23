import { expect, test } from '@playwright/test';
import { waitForCharacterPreview } from './preview-readiness';

test('waits for the real preview after delayed initial canvas layout', async ({ page }) => {
  // Reproduce a cold Canvas startup, before GeneratedAsset can request the GLB.
  // Only the browser layout notification is delayed; the real renderer/loader run.
  await page.addInitScript(() => {
    const Original = window.ResizeObserver;
    window.ResizeObserver = class extends Original {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) => { setTimeout(() => callback(entries, observer), 8000); });
      }
    };
  });
  const models: number[] = [];
  page.on('response', response => { if (response.url().includes('/models/generated/city-runner.glb')) models.push(response.status()); });
  await page.goto('/');
  await expect(page.locator('.character-preview')).toHaveAttribute('data-model-status', 'idle');
  await waitForCharacterPreview(page);
  expect(models).toEqual([200]);
  await expect(page.locator('.character-preview canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__PRODUCT_PREVIEW__?.().animation?.actionCount)).toBe(4);
});
