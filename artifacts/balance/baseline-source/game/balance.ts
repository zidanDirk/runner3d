export const POWERUP_TYPES = ['magnet', 'shield', 'double-score'] as const;
export type PowerUpType = typeof POWERUP_TYPES[number];
export type UpgradeLevels = Readonly<Record<PowerUpType, number>>;
export const BASE_UPGRADES: UpgradeLevels = Object.freeze({ magnet: 0, shield: 0, 'double-score': 0 });

/** All new rule tuning lives here; economy/mission tuning is re-exported below. */
export const POWERUP_BALANCE = Object.freeze({
  rowProbability: .18, firstDistance: 180, rowOffset: 7,
  durations: { magnet: [8, 10, 12, 14], shield: [15, 18, 21, 24], 'double-score': [10, 12, 14, 16] },
  magnetRadius: [3, 3.5, 4, 4.5], multiplier: 2,
  pickupWidth: .85, pickupHeight: .85, pickupDepth: .3, pickupBottom: .65,
});
export function upgradeLevel(level: number): number {
  if (!Number.isInteger(level) || level < 0 || level > 3) throw new Error('Power-up level must be 0..3');
  return level;
}
export function powerupDuration(type: PowerUpType, upgrades: UpgradeLevels): number {
  return POWERUP_BALANCE.durations[type][upgradeLevel(upgrades[type])] ?? 0;
}

export function validatePowerupBalance(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid power-up balance');
  const raw = value as Record<string, unknown>;
  const fields = Object.keys(POWERUP_BALANCE);
  if (Object.keys(raw).length !== fields.length || Object.keys(raw).some(key => !fields.includes(key))) throw new Error('Unknown/missing power-up balance field');
  for (const key of ['rowProbability', 'firstDistance', 'rowOffset', 'multiplier', 'pickupWidth', 'pickupHeight', 'pickupDepth', 'pickupBottom']) {
    const n = raw[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) throw new Error(`Invalid ${key}`);
  }
  if (Number(raw.rowProbability) > .5 || Number(raw.firstDistance) < 48 || Number(raw.rowOffset) < 6 || Number(raw.rowOffset) > 10
    || raw.multiplier !== 2 || Number(raw.pickupWidth) <= 0 || Number(raw.pickupHeight) <= 0 || Number(raw.pickupDepth) <= 0 || Number(raw.pickupWidth) > 1 || Number(raw.pickupHeight) > 1 || Number(raw.pickupDepth) > 1 || Number(raw.pickupBottom) > 1) throw new Error('Unsafe power-up balance');
  const durations = raw.durations;
  if (typeof durations !== 'object' || durations === null || Object.keys(durations).length !== 3) throw new Error('Invalid durations');
  const increasing = (array: unknown, min: number, max: number) => {
    if (!Array.isArray(array) || array.length !== 4 || array.some((n: unknown, i: number) => typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (i > 0 && n <= Number(array[i - 1])))) throw new Error('Invalid upgrade progression');
  };
  for (const type of POWERUP_TYPES) increasing((durations as Record<string, unknown>)[type], 1, 30);
  increasing(raw.magnetRadius, 1, 5);
}
validatePowerupBalance(POWERUP_BALANCE);
