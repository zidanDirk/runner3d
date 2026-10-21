import { useSyncExternalStore } from 'react';
let available = true;
const listeners = new Set<() => void>();
export const graphics = {
  getSnapshot: () => available,
  setAvailable(value: boolean) { if (available === value) return; available = value; for (const listener of listeners) listener(); },
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
};
export const useGraphicsAvailable = () => useSyncExternalStore(graphics.subscribe, graphics.getSnapshot, graphics.getSnapshot);
