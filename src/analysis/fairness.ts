import { LevelGenerator } from '../game/level';
import { findReachableRoute, reachabilityCacheSize, REACHABILITY_CACHE_CAPACITY, SEARCH_BEAM_WIDTH } from '../game/reachability';
import { RULES } from '../game/config';
import { DIFFICULTY_CONFIG } from '../game/difficulty';
import type { Entity, Lane } from '../game/types';

export function analyzeFairness(seed: string, runs: number, distance: number) {
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > 10000 || !Number.isFinite(distance) || distance < 48 || distance > 10000 || seed.length < 1 || seed.length > 100) throw new Error('Invalid fairness sample bounds');
  let rows = 0, certified = 0, failed = 0;
  const failures: { seed: string; row: number; status: string }[] = [];
  for (let i = 0; i < runs; i++) {
    const actualSeed = `${seed}:${i}`, generator = new LevelGenerator(actualSeed);
    for (let row = generator.next(); row.distance <= distance; row = generator.next()) {
      rows++;
      const certificate = generator.lastValidation;
      if (certificate?.reachable && certificate.testedLanes === 3) certified++;
      else { failed++; if (failures.length < 20) failures.push({ seed: actualSeed, row: row.index, status: certificate?.status ?? 'missing' }); }
    }
  }
  const obstacle = (kind: 'hurdle' | 'gate' | 'block', at: number, lane: Lane = 1): Entity => ({ id: `${kind}-${at}-${lane}`, kind, distance: at, lane, collected: false });
  const probes = [
    { name: 'forced-jump', entities: [obstacle('block', 16, 0), obstacle('hurdle', 16), obstacle('block', 16, 2)], endDistance: 18, expectedReachable: true },
    { name: 'incompatible-jump-slide', entities: [0, 1, 2].flatMap(lane => [obstacle('hurdle', 16, lane as Lane), obstacle('gate', 17, lane as Lane)]), endDistance: 20, expectedReachable: false },
  ].map(probe => ({ ...probe, result: findReachableRoute({ entities: probe.entities, startDistance: 0, endDistance: probe.endDistance, maxNodes: 16384 }) }));
  return { schemaVersion: 1, seedRoot: seed, seedPattern: `${seed}:0..${runs - 1}`, seeds: runs, distance, rows, certified, failed,
    failureFraction: rows ? failed / rows : null, failures, testedInitialLanesPerRow: 3, laneStarts: 'grounded at actual lane center after the previous maximum collider has cleared',
    method: 'Production fixed120Hz motion kernel and AABB collision; no powers; every row has a concrete safe-lane witness from each starting lane, evaluated at saturated24m/s with0.43s delay. Grounded/settled witness endpoints compose between rows.',
    assumptions: { maximumSpeed: RULES.maxSpeed, reactionSeconds: DIFFICULTY_CONFIG.fairness.reactionSeconds, inputLatencySeconds: DIFFICULTY_CONFIG.fairness.inputLatencySeconds },
    search: { decisionTicks: DIFFICULTY_CONFIG.fairness.decisionTicks, beamWidth: SEARCH_BEAM_WIDTH, defaultMaxNodes: DIFFICULTY_CONFIG.fairness.maxSearchNodes,
      caveat: 'Retained states use exact physics. Dedup keys quantize x/y0.1m,velocity0.5m/s,timers to decision ticks. Positive witnesses replay exact; no witness or budget exhaustion is not proof of continuous impossibility. Human visibility is analyzed separately.' },
    cacheCapacity: REACHABILITY_CACHE_CAPACITY, cacheSize: reachabilityCacheSize(), probes };
}
