import { useSyncExternalStore } from 'react';
import { ProductPreferencesStore } from '../product/preferences';

/** Optional browser persistence is isolated from both preferences and the game domain. */
export const productPreferences = new ProductPreferencesStore({
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
});

export const useProductPreferences = () => useSyncExternalStore(
  productPreferences.subscribe, productPreferences.getSnapshot, productPreferences.getSnapshot,
);
