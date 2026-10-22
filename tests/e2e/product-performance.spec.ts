import { expect, test } from '@playwright/test';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release } from 'node:os';
import { playTo } from './progression-helpers';

const OUTPUT = 'artifacts/ui-ux';
interface BrowserProbe {
  contexts: { created: number; connected: number; retiredUnlost: number; lost: number; collected: number };
  audio: { created: number; live: number; running: number; suspended: number; interrupted: number; closed: number; collected: number };
  timers: { timeouts: number; intervals: number; animationFrames: number };
  canvases: number;
}
interface MixerLifecycle { created: number; disposed: number; active: number }
declare global {
  interface Window {
    __PRODUCT_PERFORMANCE__?: () => BrowserProbe;
    __PRODUCT_LIFECYCLE__?: () => { mixers: MixerLifecycle };
  }
}

/** The instrument itself retains only WeakRefs to canvases, contexts and audio.
 * It observes native objects, never manufactures renderer disposal or calls GC. */
async function instrument(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    localStorage.setItem('runner3d-product-v1', JSON.stringify({ schemaVersion: 1, tutorial: 'skipped', skinId: 'original-orange' }));
    localStorage.setItem('runner3d-quality-v1', 'high');
    localStorage.setItem('runner3d-reduced-motion-v1', 'false');
    performance.setResourceTimingBufferSize(3000);
    type Context = WebGLRenderingContext | WebGL2RenderingContext;
    const contexts: { canvas: WeakRef<HTMLCanvasElement>; context: WeakRef<Context>; lost: boolean }[] = [];
    const known = new WeakSet<Context>();
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true, writable: true,
      value: function (this: HTMLCanvasElement, contextId: string, options?: unknown): unknown {
        const result: unknown = Reflect.apply(getContext, this, [contextId, options]);
        if ((contextId === 'webgl2' || contextId === 'webgl' || contextId === 'experimental-webgl')
          && (result instanceof WebGLRenderingContext || result instanceof WebGL2RenderingContext) && !known.has(result)) {
          known.add(result);
          const entry = { canvas: new WeakRef(this), context: new WeakRef(result), lost: false };
          contexts.push(entry);
          this.addEventListener('webglcontextlost', () => { entry.lost = true; });
          this.addEventListener('webglcontextrestored', () => { entry.lost = false; });
        }
        return result;
      },
    });
    const audio: WeakRef<AudioContext>[] = [];
    const NativeAudio = window.AudioContext;
    if (NativeAudio) Object.defineProperty(window, 'AudioContext', {
      configurable: true, writable: true,
      value: new Proxy(NativeAudio, { construct(target, args, newTarget) {
        const result = Reflect.construct(target, args, newTarget) as AudioContext;
        audio.push(new WeakRef(result)); return result;
      } }),
    });
    const timeouts = new Set<number>(), intervals = new Set<number>(), frames = new Set<number>();
    const nativeTimeout = window.setTimeout.bind(window), nativeInterval = window.setInterval.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window), nativeClearInterval = window.clearInterval.bind(window);
    Object.defineProperty(window, 'setTimeout', { configurable: true, writable: true, value: (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      let id = 0;
      const callback = typeof handler === 'function' ? () => { timeouts.delete(id); Reflect.apply(handler, window, args); } : handler;
      id = nativeTimeout(callback, delay); timeouts.add(id); return id;
    } });
    Object.defineProperty(window, 'setInterval', { configurable: true, writable: true, value: (handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      const id = nativeInterval(handler, delay, ...args); intervals.add(id); return id;
    } });
    Object.defineProperty(window, 'clearTimeout', { configurable: true, writable: true, value: (id?: number) => { if (id !== undefined) { timeouts.delete(id); intervals.delete(id); } nativeClearTimeout(id); } });
    Object.defineProperty(window, 'clearInterval', { configurable: true, writable: true, value: (id?: number) => { if (id !== undefined) { timeouts.delete(id); intervals.delete(id); } nativeClearInterval(id); } });
    const nativeFrame = window.requestAnimationFrame.bind(window), nativeCancel = window.cancelAnimationFrame.bind(window);
    Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, writable: true, value: (callback: FrameRequestCallback) => {
      let id = 0; id = nativeFrame(time => { frames.delete(id); callback(time); }); frames.add(id); return id;
    } });
    Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, writable: true, value: (id: number) => { frames.delete(id); nativeCancel(id); } });
    window.__PRODUCT_PERFORMANCE__ = () => {
      const contextCounts = { created: contexts.length, connected: 0, retiredUnlost: 0, lost: 0, collected: 0 };
      for (const entry of contexts) {
        const context = entry.context.deref(), canvas = entry.canvas.deref();
        if (!context || !canvas) { contextCounts.collected++; continue; }
        const lost = entry.lost || context.isContextLost();
        if (lost) contextCounts.lost++;
        if (canvas.isConnected) contextCounts.connected++;
        else if (!lost) contextCounts.retiredUnlost++;
      }
      const audioCounts = { created: audio.length, live: 0, running: 0, suspended: 0, interrupted: 0, closed: 0, collected: 0 };
      for (const reference of audio) {
        const context = reference.deref();
        if (!context) { audioCounts.collected++; continue; }
        if (context.state === 'closed') audioCounts.closed++;
        else { audioCounts.live++; audioCounts[context.state]++; }
      }
      return { contexts: contextCounts, audio: audioCounts,
        timers: { timeouts: timeouts.size, intervals: intervals.size, animationFrames: frames.size }, canvases: document.querySelectorAll('canvas').length };
    };
  });
}

async function heap(cdp: CDPSession) {
  const forcedGc = await cdp.send('HeapProfiler.collectGarbage').then(() => true, () => false);
  const usage = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  return { usedBytes: usage.usedSize, totalBytes: usage.totalSize, forcedGc,
    dom: { documents: dom.documents, nodes: dom.nodes, eventListeners: dom.jsEventListeners } };
}
async function listeners(cdp: CDPSession) {
  const result: Record<string, { total: number; byType: Record<string, number> } | null> = {};
  try {
    for (const [label, expression] of [['window', 'window'], ['document', 'document'], ['canvas', 'document.querySelector("canvas")']] as const) {
      const remote = await cdp.send('Runtime.evaluate', { expression, objectGroup: 'product-performance-listeners' });
      const id = remote.result.objectId;
      if (!id) { result[label] = null; continue; }
      const inventory = await cdp.send('DOMDebugger.getEventListeners', { objectId: id });
      const byType: Record<string, number> = {};
      for (const listener of inventory.listeners) byType[listener.type] = (byType[listener.type] ?? 0) + 1;
      result[label] = { total: inventory.listeners.length, byType };
      // CDP allocates remote handles for returned listener functions separately
      // from our evaluated target group. Retaining those handles can retain a
      // detached Canvas and its renderer through the listener's closure.
      const handlers = new Set(inventory.listeners.flatMap(listener => [listener.handler?.objectId, listener.originalHandler?.objectId]).filter((handle): handle is string => !!handle));
      for (const objectId of handlers) await cdp.send('Runtime.releaseObject', { objectId });
    }
  } finally { await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'product-performance-listeners' }).catch(() => {}); }
  return result;
}
async function snapshot(page: Page, cdp: CDPSession) {
  const sample = await page.evaluate(() => ({ probe: window.__PRODUCT_PERFORMANCE__?.(), lifecycle: window.__PRODUCT_LIFECYCLE__?.(),
    resourceOwnership: window.__PRODUCT_RESOURCES__?.(),
    screen: document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null,
    state: window.__RUNNER_TEST__ ? { status: window.__RUNNER_TEST__.read().status, tick: window.__RUNNER_TEST__.read().tick, distance: window.__RUNNER_TEST__.read().distance } : null,
    render: window.__RUNNER_RENDER__ ?? null, mobile: window.__MOBILE_RENDER__ ?? null,
  }));
  return { ...sample, heap: await heap(cdp), listeners: await listeners(cdp) };
}
async function settleHome(page: Page) {
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await expect(page.locator('.character-preview')).toHaveAttribute('data-model-status', 'loaded');
  await expect(page.locator('canvas')).toHaveCount(1);
  // R3F asynchronously retires a detached root (including forceContextLoss).
  // Poll that observable cleanup, rather than assuming DOM removal disposes WebGL.
  await page.waitForFunction(() => window.__PRODUCT_PERFORMANCE__?.().contexts.retiredUnlost === 0);
  await page.waitForTimeout(300);
}
async function observeResources(page: Page) {
  return page.evaluate(() => {
    const resources = performance.getEntriesByType('resource').filter((entry): entry is PerformanceResourceTiming => entry instanceof PerformanceResourceTiming).map(entry => ({
      name: entry.name, initiatorType: entry.initiatorType, durationMs: entry.duration,
      transferBytes: entry.transferSize, encodedBodyBytes: entry.encodedBodySize, decodedBodyBytes: entry.decodedBodySize,
    }));
    const scripts = resources.filter(entry => /\.(?:m?js|tsx?)(?:\?|$)/.test(new URL(entry.name).pathname + new URL(entry.name).search) || entry.initiatorType === 'script');
    const navigation = performance.getEntriesByType('navigation')[0];
    return { navigation: navigation instanceof PerformanceNavigationTiming ? { startTime: navigation.startTime, responseEndMs: navigation.responseEnd, domContentLoadedMs: navigation.domContentLoadedEventEnd, loadEventEndMs: navigation.loadEventEnd } : null,
      resources, scripts, scriptTransferBytes: scripts.reduce((sum, entry) => sum + entry.transferBytes, 0),
      scriptEncodedBodyBytes: scripts.reduce((sum, entry) => sum + entry.encodedBodyBytes, 0), scriptDecodedBodyBytes: scripts.reduce((sum, entry) => sum + entry.decodedBodyBytes, 0) };
  });
}
async function actualCollision(page: Page) {
  return page.evaluate(() => {
    const hook = window.__RUNNER_TEST__; if (!hook) throw new Error('Actual fixed-step seam missing');
    hook.freeze(true);
    const initial = hook.read().tick;
    const inputs: { tick: number; code: string }[] = [];
    while (hook.read().status === 'running' && hook.read().tick - initial < 10000) {
      const state = hook.read();
      const target = state.entities.find(entity => entity.kind !== 'coin' && entity.distance > state.distance + 8);
      if (target && target.lane !== state.player.lane) {
        const code = target.lane < state.player.lane ? 'ArrowLeft' : 'ArrowRight';
        window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })); inputs.push({ tick: state.tick, code });
      }
      hook.stepTicks(1);
    }
    const end = hook.read();
    return { status: end.status, seed: end.seed, tick: end.tick, distance: end.distance, coins: end.coins, score: end.score, inputs };
  });
}
async function sampleLiveFrames(page: Page) {
  return page.evaluate(() => new Promise<{
    samples: number; durationMs: number; meanMs: number; p95Ms: number; p99Ms: null;
    start: { tick: number; distance: number }; end: { tick: number; distance: number; status: string };
    completed: { calls: number; triangles: number } | null;
  }>((resolve, reject) => {
    const hook = window.__RUNNER_TEST__; if (!hook) { reject(new Error('Actual engine missing')); return; }
    const before = hook.read(); const start = { tick: before.tick, distance: before.distance };
    const intervals: number[] = []; let previous = 0;
    hook.freeze(false);
    const frame = (now: number): void => {
      if (previous) intervals.push(now - previous); previous = now;
      if (intervals.length < 90) { requestAnimationFrame(frame); return; }
      hook.freeze(true);
      const state = hook.read(), render = window.__RUNNER_RENDER__;
      const sorted = [...intervals].sort((a, b) => a - b), durationMs = intervals.reduce((sum, value) => sum + value, 0);
      resolve({ samples: intervals.length, durationMs, meanMs: durationMs / intervals.length, p95Ms: sorted[Math.ceil(sorted.length * .95) - 1] ?? 0, p99Ms: null,
        start, end: { tick: state.tick, distance: state.distance, status: state.status }, completed: render ? { calls: render.calls, triangles: render.triangles } : null });
    };
    requestAnimationFrame(frame);
  }));
}

// This test deliberately uses ordinary profile logic and genuine collision death.
// It sets optional tutorial/quality preferences, never profile, wallet or game state.
test('product homepage costs and six real settlement/navigation cycles retain one Canvas and bounded native resources', async ({ browser, baseURL }) => {
  test.setTimeout(240000);
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await instrument(context);
  const page = await context.newPage(); const cdp = await context.newCDPSession(page);
  const errors: string[] = [], models: string[] = [];
  mkdirSync(OUTPUT, { recursive: true });
  const cycleEvidence: unknown[] = [];
  const checkpoint = (stage: string, details: unknown): void => {
    writeFileSync(`${OUTPUT}/product-performance-progress.json`, JSON.stringify({
      observedAt: new Date().toISOString(), complete: false, stage, details,
      completedCycles: cycleEvidence, requests: models, errors,
      note: 'Incremental observations only. This file is not a passing test result; use the formal product-performance.json and Playwright outcome.',
    }, null, 2));
  };
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('.glb')) models.push(request.url()); });
  try {
    await page.goto('/'); await page.bringToFront();
    const startButton = page.getByRole('button', { name: '开始奔跑', exact: true });
    await expect(startButton).toBeVisible(); await expect(startButton).toBeEnabled();
    const observedInteractiveMs = await page.evaluate(() => performance.now());
    await settleHome(page);
    const homeResources = await observeResources(page), homeRequests = [...models], initial = await snapshot(page, cdp);
    checkpoint('initial-home', { observedInteractiveMs, homeResources, homeRequests, initial });
    expect(homeRequests).toHaveLength(1); expect(new URL(homeRequests[0] ?? '').pathname.endsWith('/city-runner.glb')).toBe(true);
    expect(initial.probe?.contexts.connected).toBe(1); expect(initial.probe?.audio.created).toBe(0);
    const cycles = [];
    for (let cycle = 0; cycle < 6; cycle++) {
      const clickStartMs = await page.evaluate(() => performance.now());
      await startButton.click();
      await page.waitForFunction(() => window.__RUNNER_TEST__?.read().status === 'running');
      const runningObservedMs = await page.evaluate(() => { window.__RUNNER_TEST__?.freeze(true); return performance.now(); });
      await page.waitForFunction(() => {
        const render = window.__RUNNER_RENDER__, city = window.__CITY_RENDER__;
        return render?.character.models === 1 && render.character.fallbacks === 0 && !!render.character.animation
          && render.roadblock.models > 0 && render.roadblock.fallbacks === 0
          && !!city && city.batches === city.expectedBatches && city.batches > 0 && city.fallbackBatches === 0;
      });
      const actualModelReadyMs = await page.evaluate(() => performance.now());
      await expect(page.locator('canvas')).toHaveCount(1);
      await page.waitForFunction(() => window.__PRODUCT_PERFORMANCE__?.().contexts.retiredUnlost === 0);
      const liveFrames = cycle === 0 ? await sampleLiveFrames(page) : null;
      if (liveFrames) { expect(liveFrames.samples).toBe(90); expect(liveFrames.end.status).toBe('running'); expect(liveFrames.end.tick).toBeGreaterThan(liveFrames.start.tick); }
      const playing = await snapshot(page, cdp);
      expect(playing.probe?.audio.created).toBe(1); expect(playing.probe?.audio.live).toBe(1);
      expect(playing.probe?.contexts.connected).toBe(1);
      if (playing.lifecycle) expect(playing.lifecycle.mixers.active).toBe(1);
      // Earn through the original safe-lane input helper before steering into a
      // genuine obstacle. Seeking a collision immediately can legitimately miss
      // every coin; it is not evidence of a failed settlement or page lifecycle.
      await playTo(page, 95);
      const death = await actualCollision(page); expect(death.status).toBe('over'); expect(death.distance).toBeGreaterThan(95); expect(death.coins).toBeGreaterThan(0);
      await expect(page.locator('[data-screen="results"]')).toBeVisible();
      const walletAfterDeath = await page.getByTestId('wallet').innerText();
      const shopOpenedAt = await page.evaluate(() => performance.now());
      await page.getByRole('button', { name: '升级商店', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '升级商店', exact: true })).toBeVisible();
      const shopVisibleMs = await page.evaluate(() => performance.now());
      const shop = await snapshot(page, cdp);
      await page.getByRole('button', { name: '关闭成长面板', exact: true }).click();
      await page.getByRole('button', { name: '返回首页', exact: true }).click();
      await settleHome(page);
      const home = await snapshot(page, cdp);
      checkpoint(`cycle-${cycle + 1}-home-before-assertions`, { playing, liveFrames, death, walletAfterDeath, shop, home });
      const walletAtHome = await page.getByTestId('wallet').innerText(); expect(walletAtHome).toBe(walletAfterDeath);
      expect(home.probe?.contexts.connected).toBe(1); expect(home.probe?.contexts.retiredUnlost).toBe(0);
      expect(home.probe?.audio.created).toBe(1); expect(home.probe?.audio.live).toBe(1); expect(home.probe?.audio.running).toBe(0);
      if (home.lifecycle) { expect(home.lifecycle.mixers.active).toBe(1); expect(home.lifecycle.mixers.created - home.lifecycle.mixers.disposed).toBe(1); }
      const stateBeforeWait = home.state;
      expect(stateBeforeWait, 'Home must expose an actual read-only game state to measure simulation retirement').not.toBeNull();
      expect(stateBeforeWait?.status).toBe('ready');
      await page.waitForTimeout(200);
      const stateAfterWait = await page.evaluate(() => { const state = window.__RUNNER_TEST__?.read(); return state ? { status: state.status, tick: state.tick, distance: state.distance } : null; });
      expect(stateAfterWait).toEqual(stateBeforeWait);
      const completedCycle = { cycle: cycle + 1, startClickToRunningObservedMs: runningObservedMs - clickStartMs,
        startClickToRealModelsReadyObservedMs: actualModelReadyMs - clickStartMs, shopOpenToVisibleObservedMs: shopVisibleMs - shopOpenedAt,
        playing, liveFrames, death, walletAfterDeath, shop, home, homeSimulationStopped: true };
      cycles.push(completedCycle); cycleEvidence.push(completedCycle);
      checkpoint(`cycle-${cycle + 1}-completed`, { completedCycles: cycles.length });
    }
    const afterWarmup = cycles[0]?.home, final = cycles.at(-1)?.home;
    if (!afterWarmup || !final) throw new Error('Missing completed lifecycle samples');
    // Compare the same home screen after caches have warmed. A short bounded run
    // can expose accumulation, but cannot establish indefinite leak freedom.
    for (const name of ['window', 'document', 'canvas']) {
      const before = afterWarmup.listeners[name], after = final.listeners[name];
      if (before && after) expect(after.total, `${name} listeners after six cycles`).toBeLessThanOrEqual(before.total);
    }
    expect(final.probe?.timers.intervals).toBeLessThanOrEqual(afterWarmup.probe?.timers.intervals ?? 0);
    expect(final.probe?.timers.timeouts).toBeLessThanOrEqual((afterWarmup.probe?.timers.timeouts ?? 0) + 1);
    expect(final.probe?.timers.animationFrames).toBeLessThanOrEqual((afterWarmup.probe?.timers.animationFrames ?? 0) + 1);
    expect(final.heap.usedBytes).toBeLessThan(afterWarmup.heap.usedBytes + 8 * 1024 * 1024);
    if (process.env.PRODUCT_OPTIMIZED === '1') {
      expect(final.heap.dom.nodes).toBeLessThanOrEqual(afterWarmup.heap.dom.nodes + 5);
      expect(final.heap.dom.eventListeners).toBeLessThanOrEqual(afterWarmup.heap.dom.eventListeners);
      expect(final.resourceOwnership).toEqual(afterWarmup.resourceOwnership);
      expect(final.resourceOwnership?.owners).toBe(1);
      const native = final.probe?.contexts;
      if (!native) throw new Error('Native WebGL ownership probe unavailable');
      expect(native.collected).toBeGreaterThanOrEqual(native.created - 2);
    }
    expect(models.filter(url => new URL(url).pathname.endsWith('/city-runner.glb'))).toHaveLength(1);
    expect(errors).toEqual([]);
    if (process.env.PRODUCT_HEAP_SNAPSHOT === '1') {
      const chunks: string[] = [];
      const captureChunk = ({ chunk }: { chunk: string }) => chunks.push(chunk);
      cdp.on('HeapProfiler.addHeapSnapshotChunk', captureChunk);
      try {
        await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
        writeFileSync(`${OUTPUT}/product-memory.heapsnapshot`, chunks.join(''));
      } finally { cdp.off('HeapProfiler.addHeapSnapshotChunk', captureChunk); }
    }
    writeFileSync(`${OUTPUT}/${process.env.PRODUCT_OPTIMIZED === '1' ? 'product-performance-optimized.json' : 'product-performance.json'}`, JSON.stringify({ finished: new Date().toISOString(),
      scope: `Desktop Chromium / ${process.env.PRODUCT_OPTIMIZED === '1' ? 'optimized E2E build without React Refresh; explicit test hooks retained, distinct from the separately verified production build' : 'Vite e2e development server with React Refresh, which retains unmounted roots'};1440×900, device DPR1, explicit High quality. Timings include driver scheduling, not standardized TTI or CDN timings. First navigation is cold in this context; later parsed GLTF caches persist.`,
      optimized: process.env.PRODUCT_OPTIMIZED === '1',
      host: { os: platform(), release: release(), cpu: cpus()[0]?.model ?? null, browser: browser.version() },
      initialPageInteractiveObservedMs: observedInteractiveMs, homeResources, homeRequests, initial, cycles,
      requests: models, errors,
      limitations: [
        'One visible Canvas and observed native WebGL context retirement are measured. Renderer object lifetime is not inferred from canvas removal alone.',
        'Mixer counts are included only when the real e2e controller lifecycle hook is present; missing hook means unmeasured, not zero.',
        'The optional tutorial is marked skipped to isolate returning-player navigation performance. No PlayerProfile, wallet, settlement or death state is injected.',
        'Six deaths use actual fixed-step GameEngine plus ordinary keyboard lane intents. These are accelerated gameplay loops; the first game separately includes90 real active RAF intervals.',
        'RAF intervals are main-thread presentation cadence, not GPU time or headroom. Completed-frame counts use the existing main-pass diagnostic, not shadow-pass totals.',
        'CDP forced-GC heap samples and listener inventories include e2e diagnostics and weak instrumentation. The8MiB short-run growth budget cannot prove indefinite leak freedom.',
        'One lazily created AudioContext and parsed GLTF, immutable geometry/material/animation caches are intentionally shared across pages; retention is not itself a leak.',
        'This test has no physical phone, iOS Safari, Android Chrome, thermals, GPU byte measurements or human-perceived loading claims.',
      ] }, null, 2));
  } finally { await cdp.detach(); await context.close(); }
});
