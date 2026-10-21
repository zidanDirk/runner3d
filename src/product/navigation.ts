import type { Status } from '../game/types';

export type ProductScreen = 'home' | 'playing' | 'paused' | 'results';
export type ProductPanel = 'character' | 'shop' | 'missions' | 'settings' | 'tutorial' | 'quit-confirm';

/** A panel belongs to one base screen; there is no navigation stack to grow or cycle. */
export type NavigationState =
  | { readonly screen: 'playing'; readonly panel: null }
  | { readonly screen: Exclude<ProductScreen, 'playing'>; readonly panel: ProductPanel | null };

export type NavigationEvent =
  | { readonly type: 'sync-game'; readonly status: Status }
  | { readonly type: 'open-panel'; readonly panel: Exclude<ProductPanel, 'quit-confirm'> }
  | { readonly type: 'close-panel' }
  | { readonly type: 'request-home' }
  | { readonly type: 'confirm-quit' };

export const INITIAL_NAVIGATION: NavigationState = Object.freeze({ screen: 'home', panel: null });

function screenState(screen: ProductScreen): NavigationState {
  return screen === 'home' ? INITIAL_NAVIGATION : Object.freeze({ screen, panel: null });
}

/**
 * UI state only. Runtime owns start/pause/resume/reset and then supplies sync-game.
 * Pause must precede request-home during a run. Only a confirmed quit can return a
 * paused run home; its runtime reset retires it without manufacturing game over.
 */
export function navigationReducer(state: NavigationState, event: NavigationEvent): NavigationState {
  if (event.type === 'sync-game') {
    const screen: ProductScreen = event.status === 'ready' ? 'home' : event.status === 'running' ? 'playing' : event.status === 'over' ? 'results' : 'paused';
    return screen === state.screen ? state : screenState(screen);
  }
  if (event.type === 'open-panel') {
    if (state.screen === 'playing' || state.panel === 'quit-confirm' || state.panel === event.panel) return state;
    return Object.freeze({ screen: state.screen, panel: event.panel });
  }
  if (event.type === 'close-panel') {
    return state.panel === null ? state : screenState(state.screen);
  }
  if (event.type === 'request-home') {
    if (state.screen === 'playing' || state.panel === 'quit-confirm') return state;
    if (state.screen === 'paused') return Object.freeze({ screen: 'paused', panel: 'quit-confirm' });
    return INITIAL_NAVIGATION;
  }
  return state.screen === 'paused' && state.panel === 'quit-confirm' ? INITIAL_NAVIGATION : state;
}

export function acceptsGameplayInput(state: NavigationState): boolean {
  return state.screen === 'playing' && state.panel === null;
}
