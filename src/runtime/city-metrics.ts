import { useSyncExternalStore } from 'react';

export interface CityMetrics {
  seed: string; currentChunk: number; revision: number; chunkIds: readonly number[];
  buildings: number; lamps: number; decorations: number;
  calls: number; triangles: number; geometries: number; textures: number;
  batches: number; fallbackBatches: number; renderedInstances: Record<string, number>;
  visibleBySide: Record<string, [number, number]>;
  sample: number; distance: number;
  themeId: string; themeName: string; zoneId: number; nextThemeId: string;
  transitionProgress: number; distanceToBoundary: number;
  chunkThemes: readonly { id: number; themeId: string; zoneId: number }[];
  props: number; expectedBatches: number; activeAssetIds: readonly string[];
  culledInstances: number;
  environment: { background: string; road: string };
  frameTimeMs: number; fps: number;
}
export const debugCityEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get('debugCity') === '1';
let metrics: CityMetrics | null = null;
const listeners = new Set<() => void>();
export function publishCityMetrics(value: CityMetrics): void {
  metrics = value;
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const useCityMetrics = () => useSyncExternalStore(subscribe, () => metrics, () => null);
