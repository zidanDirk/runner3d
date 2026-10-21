import { useSyncExternalStore } from 'react';
import { getDifficulty } from '../game/difficulty';
import { RULES } from '../game/config';
import { analyzeReactionWindow } from '../game/reaction';
import { game } from './store';
import { profile } from './profile';

export const debugBalanceEnabled = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debugBalance') === '1';
function collectBalanceMetrics() {
  const state = game.view;
  return {
    tick: state.tick, seed: state.seed, distance: state.distance,
    difficulty: getDifficulty(state.distance), speed: state.speed, maxSpeed: RULES.maxSpeed, planningDistance: RULES.rowSpacing,
    generation: game.generationValidation,
    reaction: analyzeReactionWindow({ visibleDistance: RULES.rowSpacing, speed: RULES.maxSpeed, kind: 'block', action: 'lane' }),
    wallet: profile.snapshot.walletCoins, upgrades: profile.snapshot.upgrades,
  };
}
export type BalanceDebugMetrics = ReturnType<typeof collectBalanceMetrics>;
let snapshot: BalanceDebugMetrics | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useBalanceDebug = () => useSyncExternalStore(subscribe, () => snapshot, () => null);
/** Only mounted by the DEV lazy panel. Four reads per second; no level search,
 * scene traversal or additional RAF/tick observer runs in normal gameplay. */
export function attachBalanceDebug(): () => void {
  if (!debugBalanceEnabled) return () => {};
  const publish = () => { snapshot = collectBalanceMetrics(); for (const listener of listeners) listener(); };
  publish(); const timer = window.setInterval(publish, 250);
  return () => { window.clearInterval(timer); snapshot = null; };
}
