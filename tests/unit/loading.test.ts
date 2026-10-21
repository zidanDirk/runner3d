import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetLoadingStore } from '../../src/assets/loading';
import { CORE_ASSET_IDS, cityAssetIds, cityPreloadPlan, themeAssetIds } from '../../src/assets/city-loading';
import { CITY_THEMES } from '../../src/city/themes';
import { assetIds } from '../../src/assets/catalog';

afterEach(() => { vi.useRealTimers(); });
const startup = () => cityPreloadPlan(0).requested;
const completeStartup = (store: AssetLoadingStore) => { for (const id of startup()) store.loaded(id); };

describe('bounded current / next theme loading plan', () => {
  it('requests only core plus current Dusk kit at startup and preloads Neon before it enters view', () => {
    const initial = cityPreloadPlan(0);
    expect(initial.themeIds).toEqual(['dusk-city']);
    expect(initial.requested).toEqual([...CORE_ASSET_IDS, ...initial.current]);
    expect(initial.requested.some((id) => id.startsWith('neon'))).toBe(false);
    expect(cityPreloadPlan(349.9).themeIds).toEqual(['dusk-city']);
    expect(cityPreloadPlan(350).themeIds).toEqual(['dusk-city', 'neon-city']);
    expect(cityPreloadPlan(600).themeIds).toEqual(['neon-city', 'dusk-city']);
    expect(cityPreloadPlan(660).themeIds).toEqual(['neon-city']);
  });

  it('keeps finite unique resource IDs across distance jumps, repeated themes and resets', () => {
    const store = new AssetLoadingStore();
    for (const distance of [0, 350, 780, 10000, 0, 590, 1290, 10000, 0]) store.updateDistance(distance);
    const requested = store.getSnapshot().requested;
    expect(requested.length).toBe(new Set(requested).size);
    expect(new Set(requested)).toEqual(new Set([...CORE_ASSET_IDS, ...cityAssetIds]));
    expect(requested.length).toBeLessThanOrEqual(assetIds.length);
    expect(CITY_THEMES.flatMap(themeAssetIds).every((id) => requested.includes(id))).toBe(true);
  });

  it('does not publish or replace snapshots as every tick stays within one scheduling band', () => {
    const store = new AssetLoadingStore(); store.updateDistance(0);
    const snapshot = store.getSnapshot(); const listener = vi.fn(); const detach = store.subscribe(listener);
    for (let distance = 1; distance < 349; distance++) store.updateDistance(distance);
    expect(store.getSnapshot()).toBe(snapshot); expect(listener).not.toHaveBeenCalled();
    store.updateDistance(350); expect(listener).toHaveBeenCalledTimes(1);
    detach(); store.loaded('roadblock'); expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('actual settled GLB progress and explicit fallback', () => {
  it('does not count requests or renderer creation as loaded model progress', () => {
    const store = new AssetLoadingStore(); store.updateDistance(0);
    expect(store.getSnapshot()).toMatchObject({ phase: 'renderer', ready: false, core: { loaded: 0, total: 2 } });
    expect(store.getSnapshot().pending).toEqual(startup());
    store.setRendererReady();
    expect(store.getSnapshot()).toMatchObject({ phase: 'core', ready: false, core: { loaded: 0, total: 2 } });
    for (const id of CORE_ASSET_IDS) store.loaded(id);
    expect(store.getSnapshot()).toMatchObject({ phase: 'theme', ready: false, core: { loaded: 2, total: 2 } });
    completeStartup(store);
    expect(store.getSnapshot()).toMatchObject({ phase: 'ready', ready: true, pending: [], errors: [] });
    expect(store.getSnapshot().current.loaded).toBe(store.getSnapshot().current.total);
  });

  it('requires both actual renderer readiness and model completion', () => {
    const store = new AssetLoadingStore(); store.updateDistance(0); completeStartup(store);
    expect(store.getSnapshot().ready).toBe(false);
    store.setRendererReady(); expect(store.getSnapshot().ready).toBe(true);
    store.setRendererReady(false); expect(store.getSnapshot().ready).toBe(false);
  });

  it('retains a loaded status and does not publish duplicate loaded callbacks', () => {
    const store = new AssetLoadingStore(); store.updateDistance(0);
    store.loaded('roadblock'); const snapshot = store.getSnapshot();
    store.request('roadblock'); store.loaded('roadblock');
    expect(store.getSnapshot()).toBe(snapshot);
    expect(store.status('roadblock')).toBe('loaded');
  });

  it('reports real failure without fake completion and only permits explicit fallback after settlement', () => {
    const store = new AssetLoadingStore(); store.updateDistance(0); store.setRendererReady();
    store.failed('roadblock', new Error('404'));
    expect(store.getSnapshot()).toMatchObject({ phase: 'error', ready: false, canContinue: false });
    store.allowFallback(); expect(store.getSnapshot().ready).toBe(false);
    for (const id of startup().filter((id) => id !== 'roadblock')) store.loaded(id);
    expect(store.getSnapshot()).toMatchObject({ ready: false, canContinue: true, core: { loaded: 1, total: 2 } });
    expect(store.getSnapshot().errors).toEqual([{ id: 'roadblock', kind: 'load', message: '404' }]);
    store.allowFallback(); expect(store.getSnapshot()).toMatchObject({ ready: true, fallbackAllowed: true });
  });

  it('does not block a started game for optional next-theme prefetch failure', () => {
    const store = new AssetLoadingStore(); store.updateDistance(0); store.setRendererReady(); completeStartup(store);
    store.updateDistance(350); store.failed('neon-building-01', new Error('network'));
    expect(store.getSnapshot().ready).toBe(true);
    expect(store.getSnapshot().errors.some((error) => error.id === 'neon-building-01')).toBe(true);
    store.updateDistance(780); expect(store.getSnapshot().currentTheme).toBe('neon-city');
    expect(store.getSnapshot().ready).toBe(true);
  });

  it('rejects unregistered resource IDs rather than growing arbitrary caches', () => {
    const store = new AssetLoadingStore(); expect(store.status('traffic-cone')).toBe('idle');
    // Exercise the runtime boundary that an untyped external caller would hit.
    expect(() => Reflect.apply(store.request, store, ['unknown-model'])).toThrow('Unknown asset ID');
    expect(store.getSnapshot().requested).toHaveLength(0);
  });
});

describe('load retry and timeout lifecycle', () => {
  it('clears only a failed parse cache, revisions remount that ID and ignores stale failures', () => {
    const retry = vi.fn(); const store = new AssetLoadingStore(retry); store.updateDistance(0);
    store.loaded('city-runner'); store.failed('roadblock', new Error('offline'), 0);
    store.retryFailed();
    expect(retry).toHaveBeenCalledWith('roadblock', true);
    expect(store.assetRevision('roadblock')).toBe(1); expect(store.assetRevision('city-runner')).toBe(0);
    expect(store.status('roadblock')).toBe('loading');
    store.failed('roadblock', new Error('stale'), 0); expect(store.status('roadblock')).toBe('loading');
    store.loaded('roadblock', 1); expect(store.status('roadblock')).toBe('loaded');
  });

  it('never clears successful cached geometry for a later validation/controller failure', () => {
    const retry = vi.fn(); const store = new AssetLoadingStore(retry);
    store.loaded('city-runner'); store.failed('city-runner', new Error('invalid animation'), 0, 'validation');
    store.retryFailed(); expect(retry).toHaveBeenCalledWith('city-runner', false);
    expect(store.assetRevision('city-runner')).toBe(1);
  });

  it('times out hanging startup requests, supports fallback and reuses the pending request on retry', () => {
    vi.useFakeTimers(); const retry = vi.fn(); const store = new AssetLoadingStore(retry, 15000);
    const detach = store.attach(); store.updateDistance(0); store.setRendererReady();
    vi.advanceTimersByTime(14999); expect(store.getSnapshot().errors).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot().pending).toHaveLength(0);
    expect(store.getSnapshot().errors).toHaveLength(startup().length);
    expect(store.getSnapshot()).toMatchObject({ ready: false, canContinue: true });
    store.allowFallback(); store.retryFailed();
    expect(retry.mock.calls.every((call) => call[1] === false)).toBe(true);
    expect(store.getSnapshot().ready).toBe(true);
    completeStartup(store); expect(store.getSnapshot().errors).toHaveLength(0);
    detach(); expect(vi.getTimerCount()).toBe(0);
  });

  it('cleans all deadlines on detach, survives StrictMode remount and cancels settled deadlines', () => {
    vi.useFakeTimers(); const store = new AssetLoadingStore();
    const detach = store.attach(); store.updateDistance(0); expect(vi.getTimerCount()).toBe(startup().length);
    store.loaded('roadblock'); expect(vi.getTimerCount()).toBe(startup().length - 1);
    detach(); detach(); expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(20000); expect(store.getSnapshot().errors).toHaveLength(0);
    const detachAgain = store.attach(); expect(vi.getTimerCount()).toBe(startup().length - 1);
    completeStartup(store); expect(vi.getTimerCount()).toBe(0);
    detachAgain();
  });
});
