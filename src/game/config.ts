import { DIFFICULTY_CONFIG } from './difficulty';

export const RULES = {
  fixedDt: 1 / 120,
  laneWidth: 2.8,
  laneChangeDuration: 0.18,
  baseSpeed: DIFFICULTY_CONFIG.speed.initial,
  maxSpeed: DIFFICULTY_CONFIG.speed.maximum,
  accelerationPerMeter: DIFFICULTY_CONFIG.speed.perMeter,
  gravity: 22,
  jumpVelocity: 10.5,
  slideDuration: 0.75,
  playerWidth: 0.7,
  playerDepth: 0.6,
  standingHeight: 1.8,
  slidingHeight: 0.68,
  rowSpacing: DIFFICULTY_CONFIG.track.rowSpacing,
  firstRow: DIFFICULTY_CONFIG.track.firstRow,
  lookAhead: DIFFICULTY_CONFIG.track.lookAhead,
  recycleBehind: DIFFICULTY_CONFIG.track.recycleBehind,
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
