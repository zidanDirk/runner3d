import input from '../../city.config.json';
import type { CityConfig } from './types';
import { CITY_THEME_IDS } from './themes';

export const CITY_GENERATOR_VERSION = '2.0.0';
export const CITY_FOG_DISTANCE = 155;

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`city.config.json: ${path} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new Error(`city.config.json: unknown field ${path}.${key}`);
  }
  return value as Record<string, unknown>;
}

function number(value: unknown, path: string, minimum: number, maximum: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
    throw new Error(`city.config.json: ${path} must be ${integer ? 'an integer' : 'a number'} in ${minimum}..${maximum}`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`city.config.json: ${path} must be a boolean`);
  return value;
}

/** Strict configuration boundary; no user-controlled loops or unbounded densities. */
export function parseCityConfig(value: unknown): CityConfig {
  const config = record(value, 'root', ['theme', 'seed', 'chunkLength', 'aheadChunks', 'behindChunks', 'buildings', 'streetLamps', 'zones']);
  if (config.theme !== 'low-poly-dusk-city') throw new Error('city.config.json: theme must be low-poly-dusk-city');
  const buildings = record(config.buildings, 'buildings', ['enabled', 'density', 'minSpacing']);
  const lamps = record(config.streetLamps, 'streetLamps', ['enabled', 'spacing']);
  const chunkLength = number(config.chunkLength, 'chunkLength', 24, 40, true);
  const aheadChunks = number(config.aheadChunks, 'aheadChunks', 4, 6, true);
  if (chunkLength * aheadChunks < CITY_FOG_DISTANCE) {
    throw new Error(`city.config.json: aheadChunks × chunkLength must cover at least ${CITY_FOG_DISTANCE}m of fog visibility`);
  }
  // Existing city configs receive bounded defaults aligned to their chunk size.
  const zones = config.zones === undefined
    ? { length: Math.ceil(600 / chunkLength) * chunkLength, transitionChunks: 2, sequence: ['dusk-city', 'neon-city'] }
    : record(config.zones, 'zones', ['length', 'transitionChunks', 'sequence']);
  const zoneLength = number(zones.length, 'zones.length', 300, 1800, true);
  const transitionChunks = number(zones.transitionChunks, 'zones.transitionChunks', 1, 4, true);
  if (zoneLength % chunkLength !== 0) throw new Error('city.config.json: zones.length must be a whole multiple of chunkLength');
  if (transitionChunks * chunkLength > zoneLength / 2) throw new Error('city.config.json: transition must occupy at most half a zone');
  if (!Array.isArray(zones.sequence) || zones.sequence.length < 1 || zones.sequence.length > 8 ||
      !zones.sequence.every((id: unknown) => typeof id === 'string' && CITY_THEME_IDS.includes(id))) {
    throw new Error('city.config.json: zones.sequence must contain 1..8 registered theme IDs');
  }
  return Object.freeze({
    theme: config.theme,
    seed: number(config.seed, 'seed', 0, 0xffffffff, true),
    chunkLength,
    aheadChunks,
    behindChunks: number(config.behindChunks, 'behindChunks', 1, 2, true),
    zones: Object.freeze({ length: zoneLength, transitionChunks, sequence: Object.freeze([...zones.sequence]) }),
    buildings: Object.freeze({
      enabled: boolean(buildings.enabled, 'buildings.enabled'),
      density: number(buildings.density, 'buildings.density', 0, 1),
      minSpacing: number(buildings.minSpacing, 'buildings.minSpacing', 1, 4),
    }),
    streetLamps: Object.freeze({
      enabled: boolean(lamps.enabled, 'streetLamps.enabled'),
      // Integer metres keep half-open lattice membership exact at chunk edges.
      spacing: number(lamps.spacing, 'streetLamps.spacing', 8, 24, true),
    }),
  });
}

export const CITY_CONFIG = parseCityConfig(input);
