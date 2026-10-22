import { expect } from '@playwright/test';
import type { BrowserContext, CDPSession, Page } from '@playwright/test';
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
export async function instrument(context: BrowserContext): Promise<void> {
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

export async function heap(cdp: CDPSession) {
  const forcedGc = await cdp.send('HeapProfiler.collectGarbage').then(() => true, () => false);
  const usage = await cdp.send('Runtime.getHeapUsage');
  const dom = await cdp.send('Memory.getDOMCounters');
  return { usedBytes: usage.usedSize, totalBytes: usage.totalSize, forcedGc,
    dom: { documents: dom.documents, nodes: dom.nodes, eventListeners: dom.jsEventListeners } };
}
export async function listeners(cdp: CDPSession) {
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
export async function snapshot(page: Page, cdp: CDPSession) {
  const heapSample = await heap(cdp);
  const sample = await page.evaluate(() => ({ probe: window.__PRODUCT_PERFORMANCE__?.(), lifecycle: window.__PRODUCT_LIFECYCLE__?.(),
    resourceOwnership: window.__PRODUCT_RESOURCES__?.(),
    screen: document.querySelector('[data-screen]')?.getAttribute('data-screen') ?? null,
    state: window.__RUNNER_TEST__ ? { status: window.__RUNNER_TEST__.read().status, tick: window.__RUNNER_TEST__.read().tick, distance: window.__RUNNER_TEST__.read().distance } : null,
    render: window.__RUNNER_RENDER__ ?? null, mobile: window.__MOBILE_RENDER__ ?? null,
  }));
  return { ...sample, heap: heapSample, listeners: await listeners(cdp) };
}
export async function settleHome(page: Page) {
  await expect(page.locator('[data-screen="home"]')).toBeVisible();
  await expect(page.locator('.character-preview')).toHaveAttribute('data-model-status', 'loaded');
  await expect(page.locator('canvas')).toHaveCount(1);
  // R3F asynchronously retires a detached root (including forceContextLoss).
  // Poll that observable cleanup, rather than assuming DOM removal disposes WebGL.
  await page.waitForFunction(() => window.__PRODUCT_PERFORMANCE__?.().contexts.retiredUnlost === 0);
  await page.waitForTimeout(300);
}
export async function observeResources(page: Page) {
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
export async function actualCollision(page: Page) {
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

interface WallClockFrames { readonly samples: number; readonly meanMs: number | null; readonly fps: number | null; readonly p95UpperBoundMs: number | null; readonly over50Ms: number; readonly maxMs: number; readonly intervalSumMs: number; readonly histogram1Ms: readonly number[] }
declare global { interface Window { __BETA_WALL_FRAMES__?: { read(): WallClockFrames; stop(): void } } }
/** Test-only one-millisecond histogram over every real presented interval, with fixed storage. */
export async function beginWallClockFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const bins = new Uint32Array(1000); let count = 0, sum = 0, max = 0, long = 0, previous: number | undefined, frame = 0;
    const record = () => {
      const now = performance.now();
      if (document.hidden || window.__RUNNER_TEST__?.read().status !== 'running') previous = undefined;
      else {
        if (previous !== undefined) { const interval = now - previous; count++; sum += interval; max = Math.max(max, interval); if (interval > 50) long++; const bin = Math.min(999, Math.max(0, Math.floor(interval))); bins[bin] = (bins[bin] ?? 0) + 1; }
        previous = now;
      }
      frame = requestAnimationFrame(record);
    };
    frame = requestAnimationFrame(record);
    window.__BETA_WALL_FRAMES__ = { read: () => {
      const rank = Math.ceil(count * .95); let cumulative = 0, p95: number | null = null;
      for (let i = 0; i < bins.length; i++) { cumulative += bins[i] ?? 0; if (cumulative >= rank && rank > 0) { p95 = i === 999 ? null : i + 1; break; } }
      return { samples: count, meanMs: count ? sum / count : null, fps: sum ? count * 1000 / sum : null, p95UpperBoundMs: p95, over50Ms: long, maxMs: max, intervalSumMs: sum, histogram1Ms: Array.from(bins) };
    }, stop: () => cancelAnimationFrame(frame) };
  });
}
