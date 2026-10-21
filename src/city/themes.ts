import input from '../../themes/city-themes.json';
import manifest from '../assets/generated/manifest.json';
import type { CityAssetId, CityTheme, CityThemeId } from './types';

export interface CityThemeAssetMetadata {
  readonly type: string;
  readonly role: string;
  readonly dimensions: readonly number[];
}
type AssetRegistry = Readonly<Record<string, CityThemeAssetMetadata>>;

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`City themes: ${path} must be an object`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`City themes: unknown field ${path}.${key}`);
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string, pattern: RegExp, maximum = 80): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum || value.trim() !== value || !pattern.test(value)) throw new Error(`City themes: invalid ${path}`);
  return value;
}

function color(value: unknown, path: string): string { return text(value, path, /^#[\da-fA-F]{6}$/); }
function number(value: unknown, path: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) throw new Error(`City themes: ${path} must be finite in ${minimum}..${maximum}`);
  return value;
}

function asset(value: unknown, path: string, type: string, assets: AssetRegistry): CityAssetId {
  const id = text(value, path, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 64);
  const metadata = assets[id];
  if (!metadata || metadata.type !== type || metadata.role !== 'decoration') throw new Error(`City themes: ${path} references invalid ${type} asset ${id}`);
  const [width, height, depth] = metadata.dimensions;
  if (metadata.dimensions.length !== 3 || width === undefined || height === undefined || depth === undefined ||
      !metadata.dimensions.every((value) => Number.isFinite(value) && value > 0)) throw new Error(`City themes: invalid dimensions for ${id}`);
  const limit = type === 'building' ? [5.001, 30, 5.001] : type === 'street-lamp' ? [2, 6, 1] : [3, 5, 1];
  if (width > (limit[0] ?? 0) || height > (limit[1] ?? 0) || depth > (limit[2] ?? 0)) throw new Error(`City themes: dimensions exceed layout budget for ${id}`);
  // IDs have been checked against the real finite Manifest, not trusted JSON alone.
  return id as CityAssetId;
}

/** The same data boundary is used by runtime and tests. No dynamic code or URL imports. */
export function parseCityThemes(value: unknown, assets: AssetRegistry = manifest.assets): readonly CityTheme[] {
  const root = record(value, 'root', ['schemaVersion', 'themes']);
  if (root.schemaVersion !== 1) throw new Error('City themes: unsupported schemaVersion');
  if (!Array.isArray(root.themes) || root.themes.length < 1 || root.themes.length > 8) throw new Error('City themes: themes must contain 1..8 entries');
  const ids = new Set<string>();
  return Object.freeze(root.themes.map((value: unknown, index: number): CityTheme => {
    const path = `themes[${index}]`;
    const theme = record(value, path, ['id', 'name', 'version', 'sky', 'lighting', 'road', 'buildings', 'decorations', 'atmosphere']);
    const id = text(theme.id, `${path}.id`, /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 64);
    if (ids.has(id)) throw new Error(`City themes: duplicate theme ID ${id}`);
    ids.add(id);
    const sky = record(theme.sky, `${path}.sky`, ['background', 'horizon', 'sunColor', 'sunOpacity']);
    const lighting = record(theme.lighting, `${path}.lighting`, ['skyColor', 'groundColor', 'hemisphereIntensity', 'keyColor', 'keyIntensity', 'rimColor', 'rimIntensity']);
    const road = record(theme.road, `${path}.road`, ['surfaceColor', 'lineColor', 'edgeColor', 'sidewalkColor', 'markerColor']);
    const buildings = record(theme.buildings, `${path}.buildings`, ['assetIds']);
    const decorations = record(theme.decorations, `${path}.decorations`, ['lampAssetId', 'billboardAssetId', 'planterColor']);
    const atmosphere = record(theme.atmosphere, `${path}.atmosphere`, ['fogNear', 'fogFar']);
    if (!Array.isArray(buildings.assetIds) || buildings.assetIds.length < 1 || buildings.assetIds.length > 8) throw new Error(`City themes: ${path}.buildings.assetIds must contain 1..8 entries`);
    const assetIds = buildings.assetIds.map((id: unknown) => asset(id, `${path}.buildings.assetIds`, 'building', assets));
    if (new Set(assetIds).size !== assetIds.length) throw new Error(`City themes: duplicate building asset ID in ${id}`);
    const fogNear = number(atmosphere.fogNear, `${path}.atmosphere.fogNear`, 25, 80);
    const fogFar = number(atmosphere.fogFar, `${path}.atmosphere.fogFar`, 100, 155);
    if (fogFar <= fogNear + 40) throw new Error(`City themes: ${path}.atmosphere fog range is too short`);
    return Object.freeze({
      id, name: text(theme.name, `${path}.name`, /\S/), version: text(theme.version, `${path}.version`, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/),
      sky: Object.freeze({ background: color(sky.background, `${path}.sky.background`), horizon: color(sky.horizon, `${path}.sky.horizon`), sunColor: color(sky.sunColor, `${path}.sky.sunColor`), sunOpacity: number(sky.sunOpacity, `${path}.sky.sunOpacity`, 0, 1) }),
      lighting: Object.freeze({
        skyColor: color(lighting.skyColor, `${path}.lighting.skyColor`), groundColor: color(lighting.groundColor, `${path}.lighting.groundColor`),
        hemisphereIntensity: number(lighting.hemisphereIntensity, `${path}.lighting.hemisphereIntensity`, 0.5, 4),
        keyColor: color(lighting.keyColor, `${path}.lighting.keyColor`), keyIntensity: number(lighting.keyIntensity, `${path}.lighting.keyIntensity`, 0.5, 4),
        rimColor: color(lighting.rimColor, `${path}.lighting.rimColor`), rimIntensity: number(lighting.rimIntensity, `${path}.lighting.rimIntensity`, 0, 3),
      }),
      road: Object.freeze({ surfaceColor: color(road.surfaceColor, `${path}.road.surfaceColor`), lineColor: color(road.lineColor, `${path}.road.lineColor`), edgeColor: color(road.edgeColor, `${path}.road.edgeColor`), sidewalkColor: color(road.sidewalkColor, `${path}.road.sidewalkColor`), markerColor: color(road.markerColor, `${path}.road.markerColor`) }),
      buildings: Object.freeze({ assetIds: Object.freeze(assetIds) }),
      decorations: Object.freeze({ lampAssetId: asset(decorations.lampAssetId, `${path}.decorations.lampAssetId`, 'street-lamp', assets), ...(decorations.billboardAssetId === undefined ? {} : { billboardAssetId: asset(decorations.billboardAssetId, `${path}.decorations.billboardAssetId`, 'billboard', assets) }), planterColor: color(decorations.planterColor, `${path}.decorations.planterColor`) }),
      atmosphere: Object.freeze({ fogNear, fogFar }),
    });
  }));
}

export const CITY_THEMES = parseCityThemes(input);
export const CITY_THEME_IDS: readonly CityThemeId[] = Object.freeze(CITY_THEMES.map((theme) => theme.id));

export function getCityTheme(id: CityThemeId): CityTheme {
  const theme = CITY_THEMES.find((theme) => theme.id === id);
  if (!theme) throw new Error(`City themes: unknown theme ${id}`);
  return theme;
}
