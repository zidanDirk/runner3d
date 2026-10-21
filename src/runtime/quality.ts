import { useSyncExternalStore } from 'react';
import { QualityStore } from '../quality/QualityStore';
import { isQualityMode } from '../quality/profiles';

const KEY = 'runner3d-quality-v1';
export const quality = new QualityStore({
  load: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  save: (mode) => { try { localStorage.setItem(KEY, mode); } catch { /* Session preference remains usable. */ } },
});
export const useQuality = () => useSyncExternalStore(quality.subscribe, quality.getSnapshot, quality.getSnapshot);

/** Storage events synchronize a preference, not frame measurements. StrictMode safe. */
export function attachQualityPreferences(): () => void {
  const changed = (event: StorageEvent): void => {
    if (event.key === KEY && isQualityMode(event.newValue)) quality.setMode(event.newValue);
  };
  window.addEventListener('storage', changed);
  return () => window.removeEventListener('storage', changed);
}
export { resolveQualityDpr } from '../quality/profiles';
export type { QualityLevel, QualityMode, QualityProfile } from '../quality/profiles';
