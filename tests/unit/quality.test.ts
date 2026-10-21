import { describe, expect, it } from 'vitest';
import { QUALITY_SAMPLING, QualityStore } from '../../src/quality/QualityStore';
import { initialQuality, isQualityMode, keepOptionalDecoration, QUALITY_PROFILES, resolveQualityDpr } from '../../src/quality/profiles';
import { CityManager } from '../../src/city/manager';
import { GameEngine } from '../../src/game/engine';

function feed(store: QualityStore, milliseconds: number, duration: number): void {
  for (let elapsed = 0; elapsed < duration - 1e-6; elapsed += milliseconds) store.sampleFrame(milliseconds);
}

describe('visual-only quality budgets', () => {
  it('caps actual DPR instead of blindly using high-density screen resolution', () => {
    expect(resolveQualityDpr(QUALITY_PROFILES.low, 3)).toBe(1);
    expect(resolveQualityDpr(QUALITY_PROFILES.medium, 3)).toBe(1.25);
    expect(resolveQualityDpr(QUALITY_PROFILES.high, 3)).toBe(1.5);
    expect(resolveQualityDpr(QUALITY_PROFILES.high, 1)).toBe(1);
    expect(resolveQualityDpr(QUALITY_PROFILES.low, .75)).toBe(.75);
    for (const invalid of [0, -1, NaN, Infinity]) expect(resolveQualityDpr(QUALITY_PROFILES.high, invalid)).toBe(1);
    expect(QUALITY_PROFILES.high).toEqual({ level: 'high', dprCap: 1.5, shadows: true, shadowMapSize: 1024, particleDensity: 1, decorationDensity: 1 });
    expect(QUALITY_PROFILES.low.shadows).toBe(false);
    expect(Object.isFrozen(QUALITY_PROFILES.medium)).toBe(true);
  });

  it('uses viewport and pointer capabilities without device-brand assumptions', () => {
    expect(initialQuality(390, 844, true)).toBe('medium');
    expect(initialQuality(844, 390, true)).toBe('medium');
    expect(initialQuality(1440, 1000, false)).toBe('high');
    expect(initialQuality(700, 1000, false)).toBe('medium');
    expect(initialQuality(1024, 1366, true)).toBe('high');
    expect(isQualityMode('auto')).toBe(true); expect(isQualityMode('medium')).toBe(true);
    for (const invalid of [null, {}, 'ultra', 'HIGH', 0]) expect(isQualityMode(invalid)).toBe(false);
  });

  it('thins optional decoration deterministically and keeps nested profile sets', () => {
    const city = new CityManager(); city.update(780);
    const before = JSON.stringify(city.snapshot);
    const decorations = city.snapshot.chunks.flatMap((chunk) => [...chunk.props, ...chunk.decorations]);
    const ids = decorations.map((item) => item.id);
    const low = ids.filter((id) => keepOptionalDecoration(id, .35));
    const medium = ids.filter((id) => keepOptionalDecoration(id, .65));
    expect(ids.filter((id) => keepOptionalDecoration(id, 1))).toEqual(ids);
    expect(low.length).toBeGreaterThan(0); expect(low.length).toBeLessThan(medium.length);
    expect(medium.length).toBeLessThan(ids.length);
    expect(low.every((id) => medium.includes(id))).toBe(true);
    expect([...ids].reverse().filter((id) => keepOptionalDecoration(id, .35)).reverse()).toEqual(low);
    expect(city.snapshot.chunks).toHaveLength(9);
    expect(JSON.stringify(city.snapshot)).toBe(before);
    expect(keepOptionalDecoration('invalid-density', NaN)).toBe(false);
  });
});

describe('persistent quality external store', () => {
  it('validates storage, survives unavailable storage and preserves manual priority', () => {
    const saved: string[] = [];
    const store = new QualityStore({ load: () => 'low', save: (value) => saved.push(value) });
    store.setEnvironment(1440, 1000, 3, false);
    expect(store.getSnapshot().level).toBe('low'); expect(store.getDpr()).toBe(1);
    store.setMode('high'); store.setEnvironment(390, 844, 3, true);
    feed(store, 50, 120000);
    expect(store.getSnapshot().level).toBe('high'); expect(store.getSnapshot().mode).toBe('high');
    store.setMode('auto'); expect(store.getSnapshot().level).toBe('medium');
    expect(saved).toEqual(['high', 'auto']);
    const unavailable = new QualityStore({ load: () => { throw new Error('blocked'); }, save: () => { throw new Error('quota'); } });
    expect(unavailable.getSnapshot().mode).toBe('auto');
    expect(() => unavailable.setMode('low')).not.toThrow(); expect(unavailable.getSnapshot().level).toBe('low');
    expect(new QualityStore({ load: () => '{invalid}', save: () => {} }).getSnapshot().mode).toBe('auto');
  });

  it('publishes stable snapshots only for settings/environment/profile changes', () => {
    const store = new QualityStore(); let notifications = 0;
    const stop = store.subscribe(() => notifications++);
    const initial = store.getSnapshot(); feed(store, 16, 3000);
    expect(store.getSnapshot()).toBe(initial); expect(notifications).toBe(0);
    store.setEnvironment(1440, 1000, 2, false); const environment = store.getSnapshot();
    store.setEnvironment(1440, 1000, 2, false); feed(store, 16, 5000);
    expect(store.getSnapshot()).toBe(environment); expect(notifications).toBe(1);
    store.setMode('medium'); expect(notifications).toBe(2);
    store.setMode('medium'); expect(notifications).toBe(2);
    stop(); store.setMode('low'); expect(notifications).toBe(2);
  });

  it('changes initial environment safely but never overrides a manual level on rotation', () => {
    const store = new QualityStore(); store.setEnvironment(390, 844, 3, true);
    expect(store.getSnapshot().level).toBe('medium');
    store.setEnvironment(844, 390, 3, true); expect(store.getSnapshot().level).toBe('medium');
    store.setMode('low'); store.setEnvironment(1440, 1000, 2, false); expect(store.getSnapshot().level).toBe('low');
    store.setMode('auto'); expect(store.getSnapshot().level).toBe('high');
    const valid = store.getSnapshot(); store.setEnvironment(NaN, 800, 2, true); expect(store.getSnapshot()).toBe(valid);
  });
});

describe('automatic frame-window quality adaptation', () => {
  it('requires warmup, two slow windows and a minimum switch interval', () => {
    const store = new QualityStore();
    feed(store, 40, QUALITY_SAMPLING.warmupMs + QUALITY_SAMPLING.windowMs);
    expect(store.getSnapshot().level).toBe('high'); expect(store.getSamplingStats().badWindows).toBe(1);
    feed(store, 40, QUALITY_SAMPLING.windowMs); expect(store.getSnapshot().level).toBe('medium');
    expect(store.getSamplingStats().switches).toBe(1); expect(store.getSamplingStats().lastReason).toBe('slow-frames');
    feed(store, 40, 8000); expect(store.getSnapshot().level).toBe('medium');
    feed(store, 40, 4000); expect(store.getSnapshot().level).toBe('low');
    feed(store, 40, 60000); expect(store.getSnapshot().level).toBe('low');
    expect(store.getSamplingStats().switches).toBe(2);
  });

  it('does not downgrade from one long frame or one slow window', () => {
    const store = new QualityStore(); feed(store, 16, 4000); store.sampleFrame(200);
    feed(store, 16, 4000); expect(store.getSnapshot().level).toBe('high');
    feed(store, 40, 4000); expect(store.getSnapshot().level).toBe('high');
    feed(store, 16, 12000); expect(store.getSnapshot().level).toBe('high');
    expect(store.getSamplingStats().switches).toBe(0);
  });

  it('upgrades slowly and keeps a hysteresis band without profile flapping', () => {
    const store = new QualityStore(); store.setEnvironment(390, 844, 3, true);
    feed(store, 16, 16000); expect(store.getSnapshot().level).toBe('medium');
    feed(store, 16, 4000); expect(store.getSnapshot().level).toBe('high');
    expect(store.getSamplingStats().lastReason).toBe('headroom');
    feed(store, 24, 120000); expect(store.getSnapshot().level).toBe('high');
    expect(store.getSamplingStats().switches).toBe(1);
  });

  it('uses P95 as well as the mean so sustained stalls can trigger a downgrade', () => {
    const store = new QualityStore(); feed(store, 16, 4000);
    // One 60ms frame in every 10: mean 20.4ms, but P95 is 60ms.
    for (let i = 0; i < 800; i++) store.sampleFrame(i % 10 === 0 ? 60 : 16);
    expect(store.getSnapshot().level).toBe('medium'); expect(store.getSamplingStats().switches).toBe(1);
  });

  it('excludes paused, hidden, context-loss and capture time through the inactive seam', () => {
    const store = new QualityStore(); feed(store, 40, 8000);
    for (let i = 0; i < 100; i++) store.sampleFrame(40, false);
    expect(store.getSamplingStats().badWindows).toBe(0); expect(store.getSamplingStats().warmupMs).toBe(0);
    feed(store, 40, 8000); expect(store.getSnapshot().level).toBe('high');
    feed(store, 40, 4000); expect(store.getSnapshot().level).toBe('medium');
    store.sampleFrame(10000); expect(store.getSamplingStats().warmupMs).toBe(0);
    for (const invalid of [NaN, Infinity, -10, 0]) store.sampleFrame(invalid);
    expect(store.getSamplingStats().samples).toBe(0);
  });

  it('remains bounded over ten minutes and cannot mutate gameplay or layout', () => {
    const quality = new QualityStore(); quality.setEnvironment(390, 844, 3, true);
    const engine = new GameEngine('quality-parity'); const reference = new GameEngine('quality-parity'); engine.start(); reference.start();
    for (let i = 0; i < 72000; i++) {
      if (i % 120 === 0) { const action = i % 240 === 0 ? 'left' : 'right'; engine.dispatch(action); reference.dispatch(action); }
      engine.step(); reference.step();
      if (i % 2 === 0) quality.sampleFrame(1000 / 60);
    }
    expect(engine.view).toEqual(reference.view);
    expect(quality.getSamplingStats().samples).toBeLessThanOrEqual(241);
    expect(quality.getSamplingStats().switches).toBe(1);
    const snapshot = quality.getSnapshot();
    for (let i = 0; i < 1000; i++) quality.sampleFrame(1000 / 60);
    expect(quality.getSnapshot()).toBe(snapshot);
  });
});
