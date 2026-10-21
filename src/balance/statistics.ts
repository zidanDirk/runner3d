import type { SimulationResult } from './simulator';
export const DISTANCE_BINS = [0, 250, 600, 1200, 2000, 5000, 10000, 100000] as const;
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0 || fraction < 0 || fraction > 1) throw new Error('Invalid percentile sample');
  const ordered = [...values].sort((a, b) => a - b), index = (ordered.length - 1) * fraction;
  const low = ordered[Math.floor(index)] ?? 0, high = ordered[Math.ceil(index)] ?? low;
  return low + (high - low) * (index - Math.floor(index));
}
export function distribution(values: readonly number[]): { mean: number; median: number; p10: number; p90: number; min: number; max: number } {
  if (values.length === 0) throw new Error('Cannot summarize empty sample');
  return { mean: values.reduce((a, b) => a + b, 0) / values.length, median: percentile(values, .5), p10: percentile(values, .1), p90: percentile(values, .9), min: Math.min(...values), max: Math.max(...values) };
}
export function summarizeRuns(runs: readonly SimulationResult[]) {
  if (runs.length === 0) throw new Error('Cannot summarize empty run set');
  const total = (key: 'collisions' | 'shieldBreaks' | 'shieldExpirations' | 'shieldRefreshes' | 'magnetCoins' | 'decisions' | 'mistakenDecisions' | 'actionPlans' | 'routePlans') => runs.reduce((sum, run) => sum + run[key], 0);
  const shieldCollected = runs.reduce((sum, run) => sum + run.collectedByType.shield, 0);
  const failures = { hurdle: 0, gate: 0, block: 0 };
  for (const run of runs) if (run.death !== null) failures[run.death]++;
  const ended = runs.filter(run => run.status === 'over').length;
  return { samples: runs.length, ended, censored: runs.length - ended, censoringRate: (runs.length - ended) / runs.length,
    distance: distribution(runs.map(run => run.distance)), seconds: distribution(runs.map(run => run.seconds)), coins: distribution(runs.map(run => run.coins)),
    score: distribution(runs.map(run => run.score)), scoreBonus: distribution(runs.map(run => run.scoreBonus)), pickups: distribution(runs.map(run => run.pickups)),
    collisions: total('collisions'), averageCollisions: total('collisions') / runs.length, failures,
    failureProportions: Object.fromEntries(Object.entries(failures).map(([kind, count]) => [kind, ended === 0 ? null : count / ended])),
    deathDistance: DISTANCE_BINS.slice(0, -1).map((from, i) => ({ from, to: DISTANCE_BINS[i + 1] ?? 100000, count: runs.filter(run => run.status === 'over' && run.distance >= from && run.distance < (DISTANCE_BINS[i + 1] ?? 100000)).length })),
    shield: { collected: shieldCollected, consumed: total('shieldBreaks'), expiredUnused: total('shieldExpirations'), refreshedBeforeExit: total('shieldRefreshes'),
      consumptionPerPickup: shieldCollected === 0 ? null : total('shieldBreaks') / shieldCollected, expiryPerPickup: shieldCollected === 0 ? null : total('shieldExpirations') / shieldCollected,
      unresolved: shieldCollected - total('shieldBreaks') - total('shieldExpirations') - total('shieldRefreshes') },
    activeMaskSeconds: Array.from({ length: 8 }, (_, mask) => ({ mask, totalSeconds: runs.reduce((n, run) => n + (run.activeMaskSeconds[mask] ?? 0), 0) })),
    averageMagnetOnlyCoins: total('magnetCoins') / runs.length,
    observedCoinCollectionFraction: runs.reduce((sum, run) => sum + run.coins, 0) / Math.max(1, runs.reduce((sum, run) => sum + run.coinsPassed, 0)),
    behavior: { decisions: total('decisions'), mistakenDecisions: total('mistakenDecisions'), actionPlans: total('actionPlans'), routePlans: total('routePlans'),
      actions: { left: runs.reduce((n, run) => n + run.actions.left, 0), right: runs.reduce((n, run) => n + run.actions.right, 0), jump: runs.reduce((n, run) => n + run.actions.jump, 0), slide: runs.reduce((n, run) => n + run.actions.slide, 0) } },
  };
}
