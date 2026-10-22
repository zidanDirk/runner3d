import { describe, it, expect, vi } from 'vitest';
import { Monitor } from '../../src/observability/Monitor';
import { SessionAnalytics } from '../../src/observability/SessionAnalytics';
import { browserCategory, safeStack, validAnalytics } from '../../src/observability/schema';
import { MobileFrameWindow } from '../../src/runtime/mobile-metrics';
import { GameEngine } from '../../src/game/engine';
const release = { version: '0.14.0-beta', commit: 'abcdef12345', buildId: 'test-14', buildTime: '2026-10-22T00:00:00.000Z', environment: 'preview' } as const;
const create = () => { let time = 100000; const monitor = new Monitor(release, () => time); return { monitor, advance: (ms: number) => { time += ms; } }; };
describe('privacy-safe bounded monitoring', () => {
  it('classifies browser without retaining raw UA and rejects unknown analytics fields', () => {
    expect(browserCategory('Mozilla Chrome/123 Safari/537')).toBe('chrome'); expect(browserCategory('Safari/604')).toBe('safari');
    expect(browserCategory('Chrome/123 Edg/99')).toBe('edge'); expect(browserCategory('Firefox/99')).toBe('firefox');
    expect(validAnalytics('RUN_STARTED', { run: 0 })).toBe(true); expect(validAnalytics('RUN_STARTED', { run: 0, wallet: 999 })).toBe(false);
    expect(validAnalytics('APP_OPENED', { url: 'https://private/?token=secret' })).toBe(false); expect(validAnalytics('UNKNOWN', {})).toBe(false); expect(validAnalytics('APP_OPENED', JSON.parse('{"__proto__":{"private":"secret"}}'))).toBe(false); expect(validAnalytics('UPGRADE_PURCHASED', { upgrade: { toString: () => 'shield', private: 'secret' }, level: 2 })).toBe(false);
    expect(validAnalytics('UPGRADE_PURCHASED', { upgrade: 'shield', level: 2 })).toBe(true);
  });
  it('redacts raw exception text, queries, full URL, input and profile from safe errors', () => {
    const { monitor } = create(); const error = new Error('email=private@example.com wallet=999');
    error.stack = 'Error: email=private@example.com\n at work (https://secret.test/assets/index-AbC123zz.js:12:34?token=secret)\n at unknown (https://private/real-name-ABC123zz.js:2:1)';
    monitor.error('JS_UNCAUGHT', { error }); const serialized = JSON.stringify(monitor.getSnapshot());
    expect(serialized).not.toMatch(/private|wallet|email|token|secret\.test/); expect(serialized).toContain('index-AbC123zz.js:12:34');
    expect(safeStack({ stack: 'raw private' })).toBeUndefined();
  });
  it('deduplicates errors by code/asset for60s, caps ten new errors per minute and limits recent records', () => {
    const { monitor, advance } = create(); for (let i = 0; i < 100; i++) monitor.error('GLB_LOAD', { assetId: 'roadblock' });
    expect(monitor.getSnapshot().events).toHaveLength(1);
    for (let i = 0; i < 20; i++) monitor.error('GLB_LOAD', { assetId: `asset-${i}` });
    expect(monitor.getSnapshot().events).toHaveLength(10); expect(monitor.getSnapshot().dropped).toBe(11);
    advance(60001); monitor.error('GLB_LOAD', { assetId: 'roadblock' }); expect(monitor.getSnapshot().events).toHaveLength(11);
    for (let i = 0; i < 1000; i++) monitor.track('SHOP_OPENED', String(i));
    expect(monitor.getSnapshot().events).toHaveLength(100); expect(monitor.getSnapshot().analyticsCounts.SHOP_OPENED).toBe(1000);
  });
  it('validates and deduplicates schema1 events; opt-out clears local and pending analytics', () => {
    const { monitor } = create(); monitor.track('RUN_STARTED', 'run0', { run: 0 }); monitor.track('RUN_STARTED', 'run0', { run: 0 });
    expect(monitor.getSnapshot().events).toHaveLength(1); expect(monitor.getSnapshot().events[0]?.schemaVersion).toBe(1);
    monitor.setAnalytics(false); monitor.track('SHOP_OPENED', 'one'); expect(monitor.getSnapshot().events).toHaveLength(0);
    expect(monitor.getSnapshot().analyticsCounts).toEqual({}); monitor.error('WEBGL_LOST'); expect(monitor.getSnapshot().events).toHaveLength(1);
  });
  it('has no transport before consent and never backfills earlier local events', async () => {
    const { monitor } = create(); const batches: unknown[] = []; monitor.configure(() => ({ send: async batch => { batches.push(batch); } }));
    monitor.track('APP_OPENED', 'one'); await monitor.flush(); expect(batches).toEqual([]);
    monitor.setRemoteConsent(true); monitor.track('SHOP_OPENED', 'one'); await monitor.flush();
    expect(batches).toHaveLength(1); expect(JSON.stringify(batches)).not.toContain('APP_OPENED');
  });
  it('handles missing SDK, offline, rejection, bounded queue and30s backoff without throwing', async () => {
    const { monitor, advance } = create(); monitor.configure(() => { throw new Error('secret endpoint'); });
    expect(monitor.getSnapshot().connection).toBe('local-only');
    let attempts = 0; monitor.configure(() => ({ send: async () => { attempts++; throw new Error('network'); } })); monitor.setRemoteConsent(true);
    for (let i = 0; i < 150; i++) monitor.track('SHOP_OPENED', String(i));
    expect(monitor.getSnapshot().queued).toBe(100); await monitor.flush(false); expect(attempts).toBe(0);
    await monitor.flush(); expect(attempts).toBe(1); expect(monitor.getSnapshot().connection).toBe('offline');
    await monitor.flush(); expect(attempts).toBe(1); advance(60001); await monitor.flush(); expect(attempts).toBe(2);
    monitor.setRemoteConsent(false); expect(monitor.getSnapshot().queued).toBe(0);
  });
  it('never restores queued observations after consent revoked during an in-flight failure', async () => {
    const { monitor } = create(); let reject: ((error: Error) => void) | undefined;
    monitor.configure(() => ({ send: () => new Promise<void>((_, no) => { reject = no; }) })); monitor.setRemoteConsent(true); monitor.track('APP_OPENED', 'one');
    const pending = monitor.flush(); monitor.setRemoteConsent(false); reject?.(new Error('offline')); await pending;
    expect(monitor.getSnapshot().queued).toBe(0); expect(monitor.getSnapshot().connection).toBe('disabled');
  });
  it('does not requeue analytics after opt-out while a batch is in flight', async () => {
    const { monitor } = create(); let reject: ((error: Error) => void) | undefined;
    monitor.configure(() => ({ send: () => new Promise<void>((_, no) => { reject = no; }) })); monitor.setRemoteConsent(true); monitor.track('APP_OPENED', 'one');
    const pending = monitor.flush(); monitor.setAnalytics(false); reject?.(new Error('offline')); await pending;
    expect(monitor.getSnapshot().queued).toBe(0);
  });
  it('times out a stalled transport after8s and aborts without leaving sending state', async () => {
    vi.useFakeTimers();
    try {
      const { monitor } = create(); let signal: AbortSignal | undefined;
      monitor.configure(() => ({ send: (_, current) => { signal = current; return new Promise<void>(() => {}); } }));
      monitor.setRemoteConsent(true); monitor.track('APP_OPENED', 'one'); const pending = monitor.flush();
      await vi.advanceTimersByTimeAsync(8000); await pending;
      expect(signal?.aborted).toBe(true); expect(monitor.getSnapshot().connection).toBe('offline'); expect(monitor.getSnapshot().queued).toBe(1);
    } finally { vi.useRealTimers(); }
  });
  it('retains only approved release/context/performance fields and validates numeric N/A values', () => {
    const extraRelease = { ...release, token: 'secret' }; const monitor = new Monitor(extraRelease);
    const context = { browser: 'chrome' as const, device: 'desktop' as const, quality: 'high' as const, gameState: 'home' as const, private: 'secret' };
    monitor.setContext(context);
    monitor.sample({ samples: 10, fps: Infinity, averageFrameMs: NaN, p95FrameMs: -2, longFrames: 0, calls: 123, triangles: 2000, chunks: 9, particles: 1, dpr: 1, gpuBytes: null });
    monitor.timing('glb:https://private.test?token=secret', 1);
    expect(JSON.stringify(monitor.getSnapshot())).not.toMatch(/secret|private/);
    expect(monitor.getSnapshot().performance).toMatchObject({ fps: null, averageFrameMs: null, p95FrameMs: null, gpuBytes: null, calls: 123 });
  });
  it('does not substitute a second completed run for an abandoned first run', () => {
    const { monitor } = create(); const session = new SessionAnalytics(monitor);
    const first = new GameEngine('FIRST'); first.start(); session.observe(first.view, 0); first.pause(); session.observe(first.view, 0);
    const second = new GameEngine('SECOND'); second.start(); session.observe(second.view, 1);
    while (second.view.status === 'running' && second.view.tick < 5000) second.step(); session.observe(second.view, 1);
    expect(second.view.status).toBe('over'); expect(monitor.getSnapshot().firstRunDistanceMeters).toBeNull();
  });
  it('keeps four page facts unique after the128-key rolling cache evicts old events', () => {
    const { monitor } = create(); monitor.track('APP_OPENED', 'page'); monitor.track('GAME_READY', 'page'); monitor.track('TUTORIAL_COMPLETED', 'tutorial'); monitor.track('TUTORIAL_SKIPPED', 'home');
    for (let i = 0; i < 1000; i++) monitor.track('SHOP_OPENED', String(i));
    monitor.track('APP_OPENED', 'page'); monitor.track('GAME_READY', 'page'); monitor.track('TUTORIAL_COMPLETED', 'tutorial'); monitor.track('TUTORIAL_SKIPPED', 'tutorial');
    expect(monitor.getSnapshot().analyticsCounts).toMatchObject({ APP_OPENED: 1, GAME_READY: 1, TUTORIAL_COMPLETED: 1, TUTORIAL_SKIPPED: 1, SHOP_OPENED: 1000 });
  });
  it('isolates failing observer and bounds timing keys', () => {
    const { monitor } = create(); monitor.subscribe(() => { throw new Error('observer'); }); expect(() => monitor.error('CACHE_FAILURE')).not.toThrow();
    monitor.timing('timeToPlayMs', NaN); expect(monitor.getSnapshot().timings).toEqual({});
    for (let i = 0; i < 100; i++) monitor.timing(`glb:asset-${i}`, 5); expect(Object.keys(monitor.getSnapshot().timings)).toHaveLength(32);
  });
  it('records actual start/pause/resume/restart/death facts once without touching the engine', () => {
    const { monitor } = create(); const session = new SessionAnalytics(monitor); const engine = new GameEngine('MONITOR-14');
    session.observe(engine.view, 0); engine.start(); session.observe(engine.view, 0); session.observe(engine.view, 0);
    engine.pause(); session.observe(engine.view, 0); engine.resume(); session.observe(engine.view, 0);
    while (engine.view.status === 'running' && engine.view.tick < 5000) engine.step();
    expect(engine.view.status).toBe('over'); const original = JSON.stringify(engine.view);
    session.observe(engine.view, 0); session.observe(engine.view, 0); expect(JSON.stringify(engine.view)).toBe(original); expect(monitor.getSnapshot().firstRunDistanceMeters).toBe(Math.floor(engine.view.distance));
    const second = new GameEngine('MONITOR-14'); second.start(); session.observe(second.view, 1);
    const names = monitor.getSnapshot().events.flatMap(event => event.kind === 'analytics' ? [event.name] : []);
    expect(names).toEqual(['RUN_STARTED', 'RUN_PAUSED', 'RUN_RESUMED', 'RUN_ENDED', 'RUN_STARTED', 'RUN_RESTARTED']);
  });
  it('excludes explicit developer previews', () => {
    const { monitor } = create(); const session = new SessionAnalytics(monitor); const engine = new GameEngine('PREVIEW'); engine.start(); session.observe(engine.view, 1, true);
    expect(monitor.getSnapshot().events).toEqual([]);
  });
  it('uses bounded completed-frame aggregation and explicit N/A for an insufficient sample', () => {
    const frames = new MobileFrameWindow(); frames.record(0); for (let i = 1; i <= 10; i++) frames.record(i * 20);
    expect(frames.read()).toMatchObject({ samples: 10, meanMs: 20, p95Ms: 20, fps: 50, p99Ms: null });
    for (let i = 11; i < 10000; i++) frames.record(i * 20); expect(frames.read().samples).toBe(600); frames.reset(); expect(frames.read().samples).toBe(0);
  });
});
