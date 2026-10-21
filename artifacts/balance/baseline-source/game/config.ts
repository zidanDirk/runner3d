export const RULES = {
  fixedDt: 1 / 120,
  laneWidth: 2.8,
  laneChangeDuration: 0.18,
  baseSpeed: 16,
  maxSpeed: 24,
  accelerationPerMeter: 0.004,
  gravity: 22,
  jumpVelocity: 10.5,
  slideDuration: 0.75,
  playerWidth: 0.7,
  playerDepth: 0.6,
  standingHeight: 1.8,
  slidingHeight: 0.68,
  rowSpacing: 26,
  firstRow: 48,
  lookAhead: 170,
  recycleBehind: 12,
  coinValue: 25,
} as const;

export const DEFAULT_SEED = 'RUNNER-01';
export const laneX = (lane: number): number => (lane - 1) * RULES.laneWidth;

export const SHAPES = {
  hurdle: { width: 2, height: 0.85, depth: 0.9, bottom: 0 },
  gate: { width: 2.1, height: 1.5, depth: 0.8, bottom: 1.05 },
  block: { width: 2.05, height: 3, depth: 1.4, bottom: 0 },
  coin: { width: 0.65, height: 0.65, depth: 0.65, bottom: 0.75 },
} as const;
