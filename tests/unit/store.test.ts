import { afterEach, describe, expect, it, vi } from 'vitest';
import { RULES } from '../../src/game/config';
import { GameStore } from '../../src/runtime/store';

afterEach(() => { vi.unstubAllGlobals(); });

describe('browser runtime lifecycle', () => {
  it('persists the record even when the last published score already equals the best', () => {
    const values = new Map<string, string>();
    const setItem = vi.fn((key: string, value: string) => { values.set(key, value); });
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem });
    const store = new GameStore();
    store.start();
    let lastPublishedBest = 0;
    for (let tick = 0; tick < 10000 && store.view.status === 'running'; tick++) {
      store.advance(RULES.fixedDt);
      // Publish every live tick; persistence cannot depend on a later score increment.
      if (store.view.status === 'running') {
        store.pause(); store.resume();
        lastPublishedBest = store.getSnapshot().best;
      }
    }
    expect(store.view.status).toBe('over');
    expect(store.view.score).toBe(lastPublishedBest);
    expect(setItem).toHaveBeenCalled();
    expect(Number(values.get('runner3d-best-v1'))).toBe(store.getSnapshot().best);
    expect(new GameStore().getSnapshot().best).toBe(store.getSnapshot().best);
  });

  it('continues play with unavailable storage and fully resets runtime state on retry', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    const store = new GameStore();
    store.start();
    for (let i = 0; i < 1000 && store.view.status === 'running'; i++) store.advance(0.1);
    expect(store.view.status).toBe('over');
    store.restart();
    expect(store.view.status).toBe('running');
    expect(store.view.distance).toBe(0);
    expect(store.view.score).toBe(0);
    expect(store.view.coins).toBe(0);
    expect(store.view.player.lane).toBe(1);
    store.advance(RULES.fixedDt / 2);
    expect(store.view.tick).toBe(0);
  });

  it('normalizes seeds, resets to ready and clears paused time', () => {
    const store = new GameStore();
    store.start(); store.advance(0.1); store.pause();
    const distance = store.view.distance;
    store.advance(60);
    expect(store.view.distance).toBe(distance);
    store.prepare('  hello  ');
    expect(store.view.seed).toBe('hello');
    expect(store.view.status).toBe('ready');
    expect(store.view.distance).toBe(0);
  });
});

it('developer preview never raises the best or writes legacy best, then restart restores normal records', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  const store = new GameStore(); const before = store.getSnapshot().best;
  const finish = store.beginPreview(); store.restart('preview'); finish();
  for (let i = 0; i < 2000 && store.view.status === 'running'; i++) store.advance(1 / 120);
  expect(store.getSnapshot().best).toBe(before); expect(values.has('runner3d-best-v1')).toBe(false);
  store.restart('normal'); for (let i = 0; i < 2000 && store.view.status === 'running'; i++) store.advance(1 / 120);
  expect(store.getSnapshot().best).toBeGreaterThan(0); expect(values.has('runner3d-best-v1')).toBe(true);
  vi.unstubAllGlobals();
});

it('preserves the prepared view on ordinary start so Idle-to-Run animation retains its lifecycle', () => {
  const store = new GameStore(); const prepared = store.view;
  store.start(); expect(store.view).toBe(prepared); expect(store.view.status).toBe('running');
});
