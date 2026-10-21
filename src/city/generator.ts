import manifest from '../assets/generated/manifest.json';
import { createRandom } from '../game/random';
import { CITY_CONFIG, CITY_GENERATOR_VERSION, parseCityConfig } from './config';
import type { CityAssetId, CityChunk, CityConfig, CityDecoration, CityLimits, CityPlacement, CityVector } from './types';
import { CITY_THEMES, getCityTheme } from './themes';
import { getCityZone } from './zones';

const BUILDINGS = [...new Set(CITY_THEMES.flatMap((theme) => theme.buildings.assetIds))];
const MAX_BUILDING_SCALE = 1.15;
export const CITY_ROAD_CLEARANCE = 4.7;
export const CITY_BUILDING_INNER_EDGE = 10;
export const CITY_LAMP_X = 6.4;

function vector(x: number, y: number, z: number): CityVector {
  return Object.freeze([x, y, z]);
}

function dimensions(id: CityAssetId): CityVector {
  const values = manifest.assets[id].dimensions;
  const [x, y, z] = values;
  if (x === undefined || y === undefined || z === undefined || values.length !== 3 || !values.every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error(`Invalid city asset dimensions: ${id}`);
  }
  return vector(x, y, z);
}

/** Footprints follow the real asset manifest, never an independent visual scale. */
export const CITY_ASSET_DIMENSIONS: Readonly<Record<CityAssetId, CityVector>> = Object.freeze(Object.fromEntries(
  (Object.keys(manifest.assets) as CityAssetId[]).map((id) => [id, dimensions(id)]),
) as Record<CityAssetId, CityVector>);

const maximumBuildingDepth = Math.max(...BUILDINGS.flatMap((id) => [CITY_ASSET_DIMENSIONS[id][0], CITY_ASSET_DIMENSIONS[id][2]])) * MAX_BUILDING_SCALE;

function buildingSlots(config: CityConfig): number {
  const count = Math.floor(config.chunkLength / (maximumBuildingDepth + config.buildings.minSpacing));
  if (count < 1) throw new Error('City building assets do not fit the configured chunk length and minimum spacing');
  return count;
}

export function getCityLimits(config: CityConfig = CITY_CONFIG): CityLimits {
  const chunks = config.aheadChunks + config.behindChunks + 1;
  const buildingsPerChunk = config.buildings.enabled && config.buildings.density > 0 ? 2 * buildingSlots(config) : 0;
  // A half-open global lamp lattice has at most ceil(length / spacing) positions.
  const lampsPerChunk = config.streetLamps.enabled ? 2 * Math.ceil(config.chunkLength / config.streetLamps.spacing) : 0;
  const decorationsPerChunk = config.buildings.enabled ? 2 : 0;
  const propsPerChunk = config.buildings.enabled && CITY_THEMES.some((theme) => theme.decorations.billboardAssetId) ? 2 : 0;
  return Object.freeze({
    chunks, buildingsPerChunk, lampsPerChunk, decorationsPerChunk, propsPerChunk,
    buildings: chunks * buildingsPerChunk,
    lamps: chunks * lampsPerChunk,
    decorations: chunks * decorationsPerChunk,
    props: chunks * propsPerChunk,
  });
}

export function citySeed(runSeed: string | number, config: CityConfig = CITY_CONFIG): string {
  if ((typeof runSeed !== 'number' && typeof runSeed !== 'string') ||
      (typeof runSeed === 'number' && (!Number.isInteger(runSeed) || runSeed < 0 || runSeed > 0xffffffff)) ||
      (typeof runSeed === 'string' && (runSeed.length === 0 || runSeed.length > 256))) {
    throw new Error('City run seed must be a nonempty string up to 256 characters or uint32');
  }
  return JSON.stringify([CITY_GENERATOR_VERSION, config.seed, runSeed]);
}

/** Axis-aligned footprint of a rotated source model, used by layout safety checks. */
export function cityFootprint(placement: CityPlacement): readonly [number, number] {
  const size = CITY_ASSET_DIMENSIONS[placement.assetId];
  const cos = Math.abs(Math.cos(placement.rotationY));
  const sin = Math.abs(Math.sin(placement.rotationY));
  return Object.freeze([
    cos * size[0] * placement.scale[0] + sin * size[2] * placement.scale[2],
    sin * size[0] * placement.scale[0] + cos * size[2] * placement.scale[2],
  ]);
}

export function generateCityChunk(id: number, runSeed: string | number, config: CityConfig = CITY_CONFIG): CityChunk {
  // Public callers can construct typed objects without going through JSON first.
  // Validate before using configuration values as loop bounds.
  config = parseCityConfig(config);
  if (!Number.isSafeInteger(id) || Math.abs(id) > Math.floor(Number.MAX_SAFE_INTEGER / config.chunkLength) - 2) {
    throw new Error('City chunk ID must be a safe integer within the supported distance range');
  }
  const startDistance = id * config.chunkLength;
  const zone = getCityZone(startDistance, config);
  const theme = getCityTheme(zone.themeId);
  const seed = JSON.stringify([citySeed(runSeed, config), id, theme.id, theme.version]);
  // This PRNG belongs only to this chunk; no gameplay random state is touched.
  const random = createRandom(seed);
  const buildings: CityPlacement[] = [];
  const lamps: CityPlacement[] = [];
  const decorations: CityDecoration[] = [];
  const props: CityPlacement[] = [];
  const slots = buildingSlots(config);

  if (config.buildings.enabled && config.buildings.density > 0) {
    const cellLength = config.chunkLength / slots;
    for (const side of [-1, 1]) {
      for (let slot = 0; slot < slots; slot++) {
        if (random() >= config.buildings.density) continue;
        const assetId = theme.buildings.assetIds[Math.floor(random() * theme.buildings.assetIds.length)];
        if (!assetId) throw new Error(`City theme has no building variants: ${theme.id}`);
        const scale = vector(0.85 + random() * 0.3, 0.72 + random() * 0.48, 0.85 + random() * 0.3);
        const rotationY = Math.floor(random() * 4) * Math.PI / 2;
        const transform = { id: `${id}:building:${side}:${slot}`, chunkId: id, assetId, rotationY, scale };
        const footprint = cityFootprint({ ...transform, position: vector(0, 0, 0) });
        // Each cell reserves half the configured gap at both ends. This also
        // guarantees the full gap across independently generated chunk edges.
        const jitter = Math.max(0, (cellLength - footprint[1] - config.buildings.minSpacing) / 2);
        const localDistance = (slot + 0.5) * cellLength + (random() * 2 - 1) * jitter;
        const x = side * (CITY_BUILDING_INNER_EDGE + footprint[0] / 2 + random() * 3.2);
        buildings.push(Object.freeze({ ...transform, position: vector(x, 0, -localDistance) }));
      }
    }
  }

  if (config.streetLamps.enabled) {
    const spacing = config.streetLamps.spacing;
    const firstIndex = Math.ceil((startDistance - spacing / 2) / spacing);
    const candidates = Math.ceil(config.chunkLength / spacing) + 1;
    for (let offset = 0; offset < candidates; offset++) {
      const index = firstIndex + offset;
      const distance = (index + 0.5) * spacing;
      if (distance >= startDistance + config.chunkLength) break;
      for (const side of [-1, 1]) {
        lamps.push(Object.freeze({
          id: `${id}:lamp:${side}:${index}`, chunkId: id, assetId: theme.decorations.lampAssetId,
          position: vector(side * CITY_LAMP_X, 0, -(distance - startDistance)),
          rotationY: side < 0 ? 0 : Math.PI,
          scale: vector(1, 1, 1),
        }));
      }
    }
  }

  if (config.buildings.enabled) {
    for (const side of [-1, 1]) {
      if (theme.decorations.billboardAssetId) props.push(Object.freeze({
        id: `${id}:billboard:${side}`, chunkId: id, assetId: theme.decorations.billboardAssetId,
        position: vector(side * 8.5, 0, -config.chunkLength / 2),
        rotationY: side < 0 ? Math.PI / 8 : -Math.PI / 8, scale: vector(1, 1, 1),
      }));
      else decorations.push(Object.freeze({
        id: `${id}:planter:${side}`, chunkId: id, kind: 'planter',
        position: vector(side * 8.2, 0, -config.chunkLength / 2),
        rotationY: 0, scale: vector(1, 0.6, 1),
      }));
    }
  }

  return Object.freeze({
    id, zoneId: zone.zoneId, themeId: theme.id, startDistance, length: config.chunkLength, seed,
    buildings: Object.freeze(buildings), lamps: Object.freeze(lamps), decorations: Object.freeze(decorations), props: Object.freeze(props),
  });
}
