import { startLiveGame } from './session-helpers';
import { expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

// Chromium touch emulation on the desktop host. These checks do not represent
// iOS Safari / Android hardware or system-level background / BFCache testing.
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

interface TouchPoint { readonly id: number; readonly x: number; readonly y: number }
interface TouchDriver {
  readonly center: { readonly x: number; readonly y: number };
  send(type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: readonly TouchPoint[]): Promise<void>;
  swipe(dx: number, dy: number): Promise<void>;
}

async function state(page: Page) {
  const view = await page.evaluate(() => window.__RUNNER_TEST__?.read());
  if (!view) throw new Error('Read-only mobile game capture hook missing');
  return view;
}

async function step(page: Page, ticks = 1) {
  await page.evaluate((count) => window.__RUNNER_TEST__?.stepTicks(count), ticks);
  return state(page);
}

async function reset(page: Page): Promise<void> {
  await page.evaluate(() => window.__RUNNER_TEST__?.captureAt('MOBILE-10-INPUT', 0));
  expect((await state(page)).tick).toBe(0);
  expect((await state(page)).status).toBe('running');
}

async function begin(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('canvas')).toBeVisible();
  await startLiveGame(page);
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.models === 1 && window.__RUNNER_RENDER__.character.fallbacks === 0);
  await reset(page);
}

async function touches(page: Page, session: CDPSession): Promise<TouchDriver> {
  const bounds = await page.locator('canvas').boundingBox();
  if (!bounds) throw new Error('Canvas bounds unavailable');
  const center = { x: Math.round(bounds.x + bounds.width * .5), y: Math.round(bounds.y + bounds.height * .48) };
  const send = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: readonly TouchPoint[]) => {
    await session.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((point) => ({ ...point, radiusX: 4, radiusY: 4, force: 1 })) });
    // CDP acknowledgement precedes delivery of coalesced pointermove events.
    // Complete a browser frame before advancing a frozen simulation tick.
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  };
  const swipe = async (dx: number, dy: number) => {
    await send('touchStart', [{ id: 1, ...center }]);
    await send('touchMove', [{ id: 1, x: center.x + dx, y: center.y + dy }]);
    await send('touchEnd', []);
  };
  return { center, send, swipe };
}

async function setMode(page: Page, mode: 'gestures' | 'buttons' | 'both'): Promise<void> {
  await page.getByRole('button', { name: '游戏设置', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: '游戏设置' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('操作方式', { exact: true }).selectOption(mode);
  await dialog.getByRole('button', { name: '关闭设置' }).tap();
  await expect(dialog).not.toBeVisible();
  expect((await state(page)).status).toBe('paused');
  await page.getByRole('button', { name: '继续奔跑', exact: true }).tap();
}

test('real emulated touch swipes map four directions and a held contact never changes two lanes', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await begin(page); const session = await context.newCDPSession(page); const touch = await touches(page, session);
  await touch.swipe(-80, 2); expect((await step(page)).player.lane).toBe(0);
  const c = touch.center;
  await touch.send('touchStart', [{ id: 1, ...c }]);
  await touch.send('touchMove', [{ id: 1, x: c.x + 55, y: c.y }]);
  expect((await step(page)).player.lane).toBe(1);
  // Further moves and even a reversal remain this same already-consumed contact.
  await touch.send('touchMove', [{ id: 1, x: c.x + 120, y: c.y + 2 }]);
  await touch.send('touchMove', [{ id: 1, x: c.x - 90, y: c.y }]);
  expect((await step(page)).player.lane).toBe(1);
  await touch.send('touchEnd', []); expect((await step(page)).player.lane).toBe(1);
  for (const [dx, lane] of [[-80, 0], [-80, 0], [80, 1], [80, 2], [-80, 1]] as const) {
    await touch.swipe(dx, 0); expect((await step(page)).player.lane).toBe(lane);
  }
  await touch.swipe(0, -80); expect((await step(page)).player.y).toBeGreaterThan(0);
  await reset(page); await touch.swipe(0, 80); expect((await step(page)).player.slideRemaining).toBeGreaterThan(.7);
  expect(errors).toEqual([]); await session.detach();
});

test('ambiguous diagonal, taps, cancellation, slow drag and multiple fingers cannot leak commands', async ({ page, context }) => {
  await begin(page); const session = await context.newCDPSession(page); const touch = await touches(page, session); const c = touch.center;
  await touch.send('touchStart', [{ id: 1, ...c }]);
  await touch.send('touchMove', [{ id: 1, x: c.x + 50, y: c.y + 50 }]);
  let view = await step(page); expect(view.player.lane).toBe(1); expect(view.player.slideRemaining).toBe(0);
  await touch.send('touchMove', [{ id: 1, x: c.x + 78, y: c.y + 50 }]);
  expect((await step(page)).player.lane).toBe(2);
  await touch.send('touchEnd', []); await reset(page);

  await touch.swipe(12, -6); view = await step(page); expect(view.player.lane).toBe(1); expect(view.player.y).toBe(0);
  await touch.send('touchStart', [{ id: 1, ...c }]);
  await touch.send('touchMove', [{ id: 1, x: c.x - 12, y: c.y }]);
  await touch.send('touchCancel', []); expect((await step(page)).player.lane).toBe(1);

  await touch.send('touchStart', [{ id: 1, ...c }]);
  await page.waitForTimeout(700); // Real elapsed pointer time tests the configured 650ms expiry.
  await touch.send('touchMove', [{ id: 1, x: c.x - 90, y: c.y }]);
  await touch.send('touchEnd', []); expect((await step(page)).player.lane).toBe(1);

  await touch.send('touchStart', [{ id: 1, ...c }]);
  await touch.send('touchStart', [{ id: 1, ...c }, { id: 2, x: c.x + 30, y: c.y }]);
  await touch.send('touchMove', [{ id: 1, x: c.x - 70, y: c.y }, { id: 2, x: c.x + 30, y: c.y + 10 }]);
  expect((await step(page)).player.lane).toBe(1);
  // Chromium dispatches touchEnd for the supplied changed contact, rather than
  // treating this list as the contacts remaining on the screen.
  await touch.send('touchEnd', [{ id: 2, x: c.x + 30, y: c.y + 10 }]);
  await touch.send('touchMove', [{ id: 1, x: c.x - 100, y: c.y }]);
  expect((await step(page)).player.lane).toBe(1);
  await touch.send('touchEnd', []);
  await touch.swipe(80, 0); expect((await step(page)).player.lane).toBe(2);
  await session.detach();
});

test('buttons and gesture modes switch immediately, persist and preserve desktop keyboard input', async ({ page, context }) => {
  await begin(page); const session = await context.newCDPSession(page); const touch = await touches(page, session);
  await setMode(page, 'buttons');
  await touch.swipe(-80, 0); expect((await step(page)).player.lane).toBe(1);
  await page.getByRole('button', { name: '向左换道', exact: true }).tap();
  expect((await step(page)).player.lane).toBe(0); // A pointerdown+click must dispatch only once.
  await page.getByRole('button', { name: '向右换道', exact: true }).tap();
  expect((await step(page)).player.lane).toBe(1);
  await page.getByRole('button', { name: '跳跃', exact: true }).tap(); expect((await step(page)).player.y).toBeGreaterThan(0);
  await reset(page); await page.getByRole('button', { name: '滑铲', exact: true }).tap(); expect((await step(page)).player.slideRemaining).toBeGreaterThan(.7);
  await reset(page); await setMode(page, 'gestures');
  await expect(page.getByRole('button', { name: '向左换道', exact: true })).not.toBeVisible();
  await touch.swipe(-80, 0); expect((await step(page)).player.lane).toBe(0);
  await page.keyboard.press('ArrowRight'); expect((await step(page)).player.lane).toBe(1);
  await page.keyboard.press('Space'); expect((await step(page)).player.y).toBeGreaterThan(0);
  await reset(page); await setMode(page, 'both');
  await expect(page.getByRole('button', { name: '向左换道', exact: true })).toBeVisible();
  await touch.swipe(-80, 0); expect((await step(page)).player.lane).toBe(0);
  await page.getByRole('button', { name: '向右换道', exact: true }).tap(); expect((await step(page)).player.lane).toBe(1);
  await setMode(page, 'buttons'); await page.reload();
  await page.getByRole('button', { name: '游戏设置', exact: true }).tap();
  await expect(page.getByRole('dialog', { name: '游戏设置' }).getByLabel('操作方式', { exact: true })).toHaveValue('buttons');
  await session.detach();
});

test('settings UI touches do not issue movement and closing settings leaves the game paused', async ({ page, context }) => {
  await begin(page); const session = await context.newCDPSession(page);
  await page.getByRole('button', { name: '游戏设置', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: '游戏设置' }); await expect(dialog).toBeVisible();
  const before = await state(page); expect(before.status).toBe('paused');
  const bounds = await dialog.boundingBox(); if (!bounds) throw new Error('Settings dialog bounds missing');
  const x = Math.round(bounds.x + bounds.width * .5), y = Math.round(bounds.y + bounds.height * .5);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: x - 75, y }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect((await state(page)).player).toEqual(before.player); expect((await state(page)).tick).toBe(before.tick);
  await dialog.getByLabel('画质', { exact: true }).selectOption('low');
  await dialog.getByLabel('操作方式', { exact: true }).selectOption('both');
  await dialog.getByRole('button', { name: '关闭设置' }).tap();
  expect((await state(page)).status).toBe('paused');
  await page.getByRole('button', { name: '继续奔跑', exact: true }).tap();
  expect((await step(page)).player.lane).toBe(before.player.lane);
  await session.detach();
});

test('paused and ended touch gestures cannot queue movement into resume or retry', async ({ page, context }) => {
  await begin(page); const session = await context.newCDPSession(page); const touch = await touches(page, session);
  await page.getByRole('button', { name: '暂停游戏', exact: true }).tap();
  const paused = await state(page); await touch.swipe(-80, 0); await touch.swipe(0, -80);
  expect((await state(page)).player).toEqual(paused.player);
  await page.getByRole('button', { name: '继续奔跑', exact: true }).tap();
  let view = await step(page); expect(view.player.lane).toBe(1); expect(view.player.y).toBe(0);
  const obstacle = view.entities.find((entity) => entity.kind !== 'coin');
  if (!obstacle) throw new Error('Expected a seeded obstacle for a genuine collision');
  while (view.player.lane !== obstacle.lane) {
    await touch.swipe(view.player.lane > obstacle.lane ? -80 : 80, 0); view = await step(page);
  }
  for (let i = 0; i < 20 && view.status === 'running'; i++) view = await step(page, 60);
  expect(view.status).toBe('over'); expect(view.hit).toBe(obstacle.kind);
  await touch.swipe(80, 0); await touch.swipe(0, 80);
  expect((await state(page)).tick).toBe(view.tick);
  await page.getByRole('button', { name: '再跑一次', exact: true }).tap();
  await page.evaluate(() => window.__RUNNER_TEST__?.freeze(true));
  view = await step(page); expect(view.player.lane).toBe(1); expect(view.player.y).toBe(0); expect(view.player.slideRemaining).toBe(0);
  await session.detach();
});

test('synthetic browser page lifecycle events pause the same game and audio until explicit user resume', async ({ page }) => {
  await begin(page);
  for (const name of ['blur', 'pagehide', 'pageshow'] as const) {
    const before = await state(page);
    await page.evaluate((type) => window.dispatchEvent(new Event(type)), name);
    await expect.poll(async () => (await state(page)).status).toBe('paused');
    await page.waitForTimeout(100);
    const held = await state(page); expect(held.tick).toBe(before.tick); expect(held.seed).toBe(before.seed); expect(held.score).toBe(before.score);
    await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
    expect((await state(page)).status).toBe('paused');
    await page.waitForFunction(() => window.__FEEDBACK__?.audio.state === 'suspended' || window.__FEEDBACK__?.audio.status === 'unsupported');
    await page.getByRole('button', { name: '继续奔跑', exact: true }).tap();
    expect((await step(page)).tick).toBe(before.tick + 1);
  }
  expect(await page.locator('canvas').count()).toBe(1);
});

test('the real WEBGL_lose_context extension restores one renderer with unchanged game state and explicit resume', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await begin(page);
  const recovery = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas'); const gl = canvas?.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!canvas || !gl || !extension) return { supported: false as const };
    const before = window.__RUNNER_TEST__?.read(); if (!before) throw new Error('Game state unavailable');
    const original = { tick: before.tick, score: before.score, seed: before.seed, distance: before.distance };
    let lost = 0, restored = 0;
    let lossStatus: string | undefined;
    await new Promise<void>((resolve) => {
      canvas.addEventListener('webglcontextlost', () => {
        lost++;
        // The application and Three.js receive the real GPU-context event.
        setTimeout(() => { lossStatus = window.__RUNNER_TEST__?.read().status; extension.restoreContext(); }, 150);
      }, { once: true });
      canvas.addEventListener('webglcontextrestored', () => { restored++; resolve(); }, { once: true });
      extension.loseContext();
    });
    const after = window.__RUNNER_TEST__?.read();
    return { supported: true as const, original, after: after && { tick: after.tick, score: after.score, seed: after.seed, distance: after.distance, status: after.status }, lost, restored, lossStatus, contextLost: gl.isContextLost() };
  });
  mkdirSync('artifacts/ui-ux/regression/mobile', { recursive: true });
  writeFileSync('artifacts/ui-ux/regression/mobile/context-recovery.json', JSON.stringify({ scope: 'real WEBGL_lose_context extension in desktop Chromium touch emulation; not hardware GPU reclamation', ...recovery }, null, 2));
  test.skip(!recovery.supported, 'This Chromium renderer does not expose WEBGL_lose_context; real context recovery remains unverified.');
  if (!recovery.supported) return;
  expect(recovery.lost).toBe(1); expect(recovery.restored).toBe(1); expect(recovery.contextLost).toBe(false); expect(recovery.lossStatus).toBe('paused');
  expect(recovery.after).toEqual({ ...recovery.original, status: 'paused' });
  await expect(page.getByRole('button', { name: '继续奔跑', exact: true })).toBeVisible();
  expect(await page.locator('canvas').count()).toBe(1);
  await page.getByRole('button', { name: '继续奔跑', exact: true }).tap(); await step(page, 2);
  await page.waitForFunction(() => window.__RUNNER_RENDER__?.character.models === 1 && window.__RUNNER_RENDER__.calls > 0 && window.__RUNNER_RENDER__.tick === window.__RUNNER_TEST__?.read().tick);
  expect(await page.locator('canvas').count()).toBe(1); expect(errors).toEqual([]);
});
