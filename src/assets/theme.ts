import { assetManifest, getAsset } from './catalog';
import type { AssetId } from './catalog';

interface MaterialStyle { color: string; roughness: number; metalness: number; emissive?: string; emissiveStrength?: number }
interface ThemeDefinition {
  id: string;
  materials: Record<'warning' | 'light' | 'base' | 'building' | 'buildingAccent' | 'window' | 'warmWindow' | 'metal' | 'lamp', MaterialStyle>;
  scene: { road: string; background: string; coin: string; keyLight: string };
}

// Vite builds a local, finite theme registry. A config ID cannot import arbitrary code.
const themes = import.meta.glob<ThemeDefinition>('../../themes/*.json', { eager: true, import: 'default' });
const selected = themes[`../../themes/${assetManifest.theme}.json`];
if (!selected || selected.id !== assetManifest.theme) throw new Error(`Unknown generated asset theme: ${assetManifest.theme}`);
export const activeTheme = selected;
export function getAssetTheme(id: AssetId): ThemeDefinition {
  const themeId = getAsset(id).themeId;
  const theme = themes[`../../themes/${themeId}.json`];
  if (!theme || theme.id !== themeId) throw new Error(`Unknown asset palette: ${themeId}`);
  return theme;
}
