export type QualityLevel = 'low' | 'medium' | 'high';
export type QualityMode = 'auto' | QualityLevel;

/** Rendering budgets only. No profile owns gameplay timing, entities or collision. */
export interface QualityProfile {
  readonly level: QualityLevel;
  readonly dprCap: number;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly particleDensity: number;
  readonly decorationDensity: number;
}

export const QUALITY_PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = Object.freeze({
  low: Object.freeze({ level: 'low', dprCap: 1, shadows: false, shadowMapSize: 0, particleDensity: .4, decorationDensity: .35 }),
  medium: Object.freeze({ level: 'medium', dprCap: 1.25, shadows: true, shadowMapSize: 512, particleDensity: .65, decorationDensity: .65 }),
  high: Object.freeze({ level: 'high', dprCap: 1.5, shadows: true, shadowMapSize: 1024, particleDensity: 1, decorationDensity: 1 }),
});

export function isQualityMode(value: unknown): value is QualityMode {
  return value === 'auto' || value === 'low' || value === 'medium' || value === 'high';
}

export function resolveQualityDpr(profile: QualityProfile, deviceDpr: number): number {
  return Math.min(Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1, profile.dprCap);
}

export function initialQuality(width: number, height: number, coarse: boolean): QualityLevel {
  return width < 768 || (coarse && Math.min(width, height) < 900) ? 'medium' : 'high';
}

/** Stable membership by existing placement ID; no gameplay/city PRNG is consumed.
 * The nested threshold preserves every high-quality prop and avoids flickering on
 * chunk recycling or repeated profile changes. Buildings and lamps never use it. */
export function keepOptionalDecoration(id: string, density: number): boolean {
  if (density >= 1) return true;
  if (!Number.isFinite(density) || density <= 0) return false;
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) { hash ^= id.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) / 4294967296 < density;
}
