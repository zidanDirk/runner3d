import { useSyncExternalStore } from 'react';
import { CityManager } from '../city/manager';
import { CITY_CONFIG } from '../city/config';
import { game } from './store';

export const city = new CityManager(CITY_CONFIG, game.view.seed);
let source = game.view;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
const snapshot = () => city.snapshot;
export const useCity = () => useSyncExternalStore(subscribe, snapshot, snapshot);

/** Runtime owns generation. The scene only copies transforms, never consumes random numbers. */
export function syncCity(): void {
  let changed = false;
  if (source !== game.view) {
    source = game.view;
    city.reset(source.seed);
    changed = true;
  } else changed = city.update(source.distance);
  if (changed) listeners.forEach((listener) => listener());
}

export function attachCity(): () => void {
  syncCity();
  return game.subscribe(syncCity);
}
