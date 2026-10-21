import { CITY_CONFIG } from './config';
import type { CityConfig, CityThemeId } from './types';

export interface CityZone {
  readonly zoneId: number;
  readonly themeId: CityThemeId;
  readonly startDistance: number;
  readonly endDistance: number;
}

export interface CityThemeTransition {
  readonly zoneId: number;
  readonly themeId: CityThemeId;
  readonly nextThemeId: CityThemeId;
  readonly fromThemeId: CityThemeId;
  readonly toThemeId: CityThemeId;
  readonly progress: number;
  readonly distanceToBoundary: number;
}

/** Theme sequence has no mutable RNG. Zone 0 also owns initial behind-camera chunks. */
export function getZoneThemeId(zoneId: number, config: CityConfig = CITY_CONFIG): CityThemeId {
  if (!Number.isSafeInteger(zoneId) || zoneId < 0) throw new Error('City zone ID must be a nonnegative safe integer');
  const themeId = config.zones.sequence[zoneId % config.zones.sequence.length];
  if (!themeId) throw new Error('City zone sequence must contain a registered theme');
  return themeId;
}

/** Distance may be negative only for the small initial behind-camera chunk window. */
export function getCityZone(distance: number, config: CityConfig = CITY_CONFIG): CityZone {
  if (!Number.isFinite(distance) || Math.abs(distance) > Number.MAX_SAFE_INTEGER - config.zones.length) throw new Error('City zone distance must be finite and within the supported range');
  const zoneId = Math.max(0, Math.floor(distance / config.zones.length));
  return Object.freeze({ zoneId, themeId: getZoneThemeId(zoneId, config), startDistance: zoneId * config.zones.length, endDistance: (zoneId + 1) * config.zones.length });
}

/** Linear environmental blend in the first transitionChunks of a new zone. */
export function getThemeTransition(distance: number, config: CityConfig = CITY_CONFIG): CityThemeTransition {
  if (distance < 0) throw new Error('City transition distance must be nonnegative');
  const zone = getCityZone(distance, config);
  const progress = zone.zoneId === 0 ? 1 : Math.min(1, (distance - zone.startDistance) / (config.zones.transitionChunks * config.chunkLength));
  return Object.freeze({
    zoneId: zone.zoneId,
    themeId: zone.themeId,
    nextThemeId: getZoneThemeId(zone.zoneId + 1, config),
    fromThemeId: zone.zoneId === 0 ? zone.themeId : getZoneThemeId(zone.zoneId - 1, config),
    toThemeId: zone.themeId,
    progress,
    distanceToBoundary: zone.endDistance - distance,
  });
}
