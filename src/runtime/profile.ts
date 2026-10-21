import { useSyncExternalStore } from 'react';
import { ProfileController } from '../progression';
import type { PlayerProfile, ProfileStorage } from '../progression';
function storage(): ProfileStorage { return { getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value) }; }
export const profile = new ProfileController(storage());
const listeners = new Set<() => void>();
let snapshot = profile.snapshot;
export function publishProfile(): void {
  if (snapshot === profile.snapshot) return;
  snapshot = profile.snapshot;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useProfile = (): PlayerProfile => useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
