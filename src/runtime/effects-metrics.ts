import { useSyncExternalStore } from 'react';
import type { FeedbackRuntime } from './feedback';
export type EffectsMetrics = ReturnType<FeedbackRuntime['diagnostics']>;
export const debugEffectsEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get('debugEffects') === '1';
let snapshot: EffectsMetrics | null = null;
let next = 0;
const listeners = new Set<() => void>();
export function publishEffectsMetrics(value: EffectsMetrics): void {
  if (!debugEffectsEnabled || performance.now() < next) return;
  next = performance.now() + 250; snapshot = value;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useEffectsMetrics = () => useSyncExternalStore(subscribe, () => snapshot, () => null);
