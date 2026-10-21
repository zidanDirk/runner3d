import { useSyncExternalStore } from 'react';

const KEY = 'runner3d-reduced-motion-v1';
/** The preference affects only visual response, never the GameStore. */
export class MotionPreferences {
  private system = false;
  private override: boolean | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly save: (value: boolean | null) => void = () => {}) {}
  getSnapshot = (): boolean => this.override ?? this.system;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  setSystem(value: boolean): void { const previous = this.getSnapshot(); this.system = value; if (previous !== this.getSnapshot()) this.publish(); }
  set(value: boolean | null): void { this.override = value; this.save(value); this.publish(); }
  private publish(): void { for (const listener of this.listeners) listener(); }
}
export const motionPreferences = new MotionPreferences((value) => {
  try { if (value === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, String(value)); } catch { /* Optional preference persistence. */ }
});
export const useReducedMotion = () => useSyncExternalStore(motionPreferences.subscribe, motionPreferences.getSnapshot, () => false);
export function attachMotionPreferences(): () => void {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  motionPreferences.setSystem(media.matches);
  try { const value = localStorage.getItem(KEY); if (value === 'true' || value === 'false') motionPreferences.set(value === 'true'); } catch { /* Keep OS preference. */ }
  const changed = (): void => motionPreferences.setSystem(media.matches);
  media.addEventListener('change', changed);
  return () => media.removeEventListener('change', changed);
}
