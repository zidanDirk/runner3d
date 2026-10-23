import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** A loaded model is required; the primitive fallback is never accepted. */
export async function waitForCharacterPreview(page: Page): Promise<void> {
  // Match the existing product-home asset readiness budget, rather than the
  // 7s UI assertion default. A cold hosted Canvas can mount near that deadline.
  await expect(page.locator('.character-preview')).toHaveAttribute('data-model-status', 'loaded', { timeout: 25000 });
}
