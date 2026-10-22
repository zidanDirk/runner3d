import { expect, type Page } from '@playwright/test';
import { LevelGenerator } from '../../src/game/level';

export const POWERUP_ROUTE = 'DEMO-11-4411';

/** Real production input bot, not a human playtest or a production state hook. */
export async function followPowerupRoute(page: Page, capturePath: string, maxMs = 33000): Promise<void> {
  const level = new LevelGenerator(POWERUP_ROUTE);
  const rows = Array.from({ length: 25 }, () => level.next());
  let lane = 1, captured = false;
  const start = Date.now();
  while (Date.now() - start < maxMs && !await page.getByRole('button', { name: '再跑一次', exact: true }).isVisible()) {
    const distance = Number((await page.getByTestId('distance').innerText()).replaceAll(',', ''));
    if (distance > 266 && !captured) {
      for (const type of ['magnet', 'shield', 'double-score']) await expect(page.getByTestId(`active-${type}`)).toBeVisible();
      await page.screenshot({ path: capturePath });
      captured = true;
    }
    const target = distance > 280
      ? rows.flatMap(row => row.entities).find(entity => entity.kind !== 'coin' && entity.distance > distance + 9)?.lane
      : rows.find(row => row.distance >= distance - 9)?.safeLane;
    if (target !== undefined && lane !== target) {
      await page.keyboard.press(target < lane ? 'ArrowLeft' : 'ArrowRight');
      lane += target < lane ? -1 : 1;
    }
    await page.waitForTimeout(75);
  }
  await expect(page.getByRole('button', { name: '再跑一次', exact: true })).toBeVisible();
  expect(captured, 'all three powerups must be actually collected in the real run').toBe(true);
}
