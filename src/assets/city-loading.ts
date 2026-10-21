import { CITY_THEMES } from '../city/themes';
import type { CityTheme } from '../city/types';
import { getThemeTransition } from '../city/zones';
import { assetUrl } from './catalog';
import type { AssetId } from './catalog';

export const themeAssetIds = (theme: CityTheme): readonly AssetId[] => [
  ...theme.buildings.assetIds, theme.decorations.lampAssetId,
  ...(theme.decorations.billboardAssetId ? [theme.decorations.billboardAssetId] : []),
];
export const cityAssetIds: readonly AssetId[] = [...new Set(CITY_THEMES.flatMap(themeAssetIds))];
export const CORE_ASSET_IDS: readonly AssetId[] = ['city-runner', 'roadblock'];
export const NEXT_THEME_PRELOAD_DISTANCE = 250;

/** A finite current kit, with the next kit warmed before it can enter the city window. */
export function cityPreloadPlan(distance: number): { readonly key: string; readonly currentTheme: string; readonly themeIds: readonly string[]; readonly current: readonly AssetId[]; readonly requested: readonly AssetId[] } {
  const transition = getThemeTransition(distance);
  const themeIds = new Set([transition.themeId]);
  if (transition.progress < 1) themeIds.add(transition.fromThemeId);
  if (transition.distanceToBoundary <= NEXT_THEME_PRELOAD_DISTANCE) themeIds.add(transition.nextThemeId);
  const currentTheme = CITY_THEMES.find((theme) => theme.id === transition.themeId);
  if (!currentTheme) throw new Error(`Unknown loading theme ${transition.themeId}`);
  const current = themeAssetIds(currentTheme);
  const requested = [...new Set([...CORE_ASSET_IDS, ...CITY_THEMES.filter((theme) => themeIds.has(theme.id)).flatMap(themeAssetIds)])];
  return { key: [...themeIds].join(':'), currentTheme: currentTheme.id, themeIds: [...themeIds], current, requested };
}

/** Compatibility entry for explicit preloads. All calls share useGLTF's URL cache. */
export async function preloadCityAssets(distance = 0): Promise<void> {
  const { useGLTF } = await import('@react-three/drei/core/Gltf.js');
  for (const id of cityPreloadPlan(distance).requested) useGLTF.preload(assetUrl(id), false, false);
}
