import { describe, expect, it } from 'vitest';
import { INITIAL_NAVIGATION, acceptsGameplayInput, navigationReducer } from '../../src/product/navigation';
import type { NavigationState, ProductPanel } from '../../src/product/navigation';

const sync = (state: NavigationState, status: 'ready' | 'running' | 'paused' | 'over') => navigationReducer(state, { type: 'sync-game', status });

describe('mutually exclusive product navigation', () => {
  it.each<Exclude<ProductPanel, 'quit-confirm'>>(['character', 'shop', 'missions', 'settings', 'tutorial'])('opens the %s home entry and returns directly to home', (panel) => {
    const open = navigationReducer(INITIAL_NAVIGATION, { type: 'open-panel', panel });
    expect(open).toEqual({ screen: 'home', panel });
    expect(navigationReducer(open, { type: 'close-panel' })).toBe(INITIAL_NAVIGATION);
  });

  it('replaces a single panel rather than building a circular navigation history', () => {
    let state = INITIAL_NAVIGATION;
    for (let index = 0; index < 100; index++) {
      state = navigationReducer(state, { type: 'open-panel', panel: index % 2 === 0 ? 'shop' : 'missions' });
    }
    expect(state).toEqual({ screen: 'home', panel: 'missions' });
    expect(navigationReducer(state, { type: 'close-panel' })).toBe(INITIAL_NAVIGATION);
  });

  it('only actual runtime status synchronization enters, pauses and resumes gameplay', () => {
    const playing = sync(INITIAL_NAVIGATION, 'running');
    const paused = sync(playing, 'paused');
    const settings = navigationReducer(paused, { type: 'open-panel', panel: 'settings' });
    expect(acceptsGameplayInput(playing)).toBe(true);
    expect(acceptsGameplayInput(settings)).toBe(false);
    expect(navigationReducer(settings, { type: 'close-panel' })).toEqual(paused);
    expect(sync(settings, 'running')).toEqual(playing);
    expect(sync(playing, 'over')).toEqual({ screen: 'results', panel: null });
  });

  it('does not permit menus or an unconfirmed home transition during active gameplay', () => {
    const playing = sync(INITIAL_NAVIGATION, 'running');
    expect(navigationReducer(playing, { type: 'open-panel', panel: 'shop' })).toBe(playing);
    expect(navigationReducer(playing, { type: 'request-home' })).toBe(playing);
    expect(navigationReducer(playing, { type: 'confirm-quit' })).toBe(playing);
  });

  it('requires paused-run quit confirmation, preserves cancel, and ignores repeated confirmation', () => {
    const paused = sync(INITIAL_NAVIGATION, 'paused');
    const confirm = navigationReducer(paused, { type: 'request-home' });
    expect(confirm).toEqual({ screen: 'paused', panel: 'quit-confirm' });
    expect(navigationReducer(confirm, { type: 'open-panel', panel: 'shop' })).toBe(confirm);
    expect(navigationReducer(confirm, { type: 'request-home' })).toBe(confirm);
    expect(navigationReducer(confirm, { type: 'close-panel' })).toEqual(paused);
    const home = navigationReducer(confirm, { type: 'confirm-quit' });
    expect(home).toBe(INITIAL_NAVIGATION);
    expect(navigationReducer(home, { type: 'confirm-quit' })).toBe(home);
  });

  it('keeps result panels stable under repeated over notifications, then clears them for replay', () => {
    const results = sync(INITIAL_NAVIGATION, 'over');
    const shop = navigationReducer(results, { type: 'open-panel', panel: 'shop' });
    expect(sync(shop, 'over')).toBe(shop);
    expect(navigationReducer(shop, { type: 'close-panel' })).toEqual(results);
    expect(sync(shop, 'running')).toEqual({ screen: 'playing', panel: null });
    expect(navigationReducer(results, { type: 'request-home' })).toBe(INITIAL_NAVIGATION);
  });

  it('clears transient panels on lifecycle transitions without mutating previous snapshots', () => {
    const old = navigationReducer(INITIAL_NAVIGATION, { type: 'open-panel', panel: 'character' });
    expect(sync(old, 'paused')).toEqual({ screen: 'paused', panel: null });
    expect(old).toEqual({ screen: 'home', panel: 'character' });
    expect(Object.isFrozen(old)).toBe(true);
    expect(sync(INITIAL_NAVIGATION, 'ready')).toBe(INITIAL_NAVIGATION);
  });
});
