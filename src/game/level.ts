import { RULES } from './config';
import { DIFFICULTY_CONFIG } from './difficulty';
import { createRandom } from './random';
import { validateRowTransition } from './reachability';
import type { RowCertificate } from './reachability';
import type { Entity, Lane, LevelSource, ObstacleKind, TrackRow } from './types';

const LANES: readonly Lane[] = [0, 1, 2];
const KINDS: readonly ObstacleKind[] = ['hurdle', 'gate', 'block'];

export class LevelGenerator implements LevelSource {
  private readonly random: () => number;
  private index = 0;
  private safeLane: Lane = 1;
  private previous: TrackRow | null = null;
  private certificate: RowCertificate | null = null;
  private readonly certify: typeof validateRowTransition;

  constructor(seed: string, certify: typeof validateRowTransition = validateRowTransition) {
    this.random = createRandom(seed);
    this.certify = certify;
  }
  get lastValidation(): RowCertificate | null { return this.certificate; }

  next(): TrackRow {
    for (let attempt = 0; attempt < DIFFICULTY_CONFIG.fairness.maxAttempts; attempt++) {
      const row = this.candidate();
      const certificate = this.certify(this.previous, row);
      this.certificate = certificate;
      if (certificate.reachable) {
        this.index++; this.safeLane = row.safeLane; this.previous = row;
        return row;
      }
    }
    throw new Error(`Level reachability failed after${DIFFICULTY_CONFIG.fairness.maxAttempts} bounded attempt(s)`);
  }

  private candidate(): TrackRow {
    const index = this.index;
    const distance = RULES.firstRow + index * RULES.rowSpacing;
    const candidates = LANES.filter((lane) => Math.abs(lane - this.safeLane) <= 1);
    const safeLane = candidates[Math.floor(this.random() * candidates.length)] ?? 1;
    const entities: Entity[] = [];
    const { recoveryEvery, blockedLanes, weights } = DIFFICULTY_CONFIG.obstacles;
    const recovery = index % recoveryEvery === recoveryEvery - 1;
    let blocked = 0;
    for (const lane of LANES) {
      if (!recovery && lane !== safeLane && blocked < blockedLanes) {
        let weight = this.random() * (weights.hurdle + weights.gate + weights.block);
        let kind: ObstacleKind = 'block';
        for (const candidate of KINDS) { weight -= weights[candidate]; if (weight < 0) { kind = candidate; break; } }
        entities.push({ id: `${index}-${lane}-obstacle`, lane, kind, distance, collected: false });
        blocked++;
      }
    }
    // The reward trail also communicates a route through each decision.
    for (let coin = 0; coin < DIFFICULTY_CONFIG.coins.trailCount; coin++) {
      entities.push({
        id: `${index}-coin-${coin}`,
        lane: safeLane,
        kind: 'coin',
        distance: distance + DIFFICULTY_CONFIG.coins.trailStart + coin * DIFFICULTY_CONFIG.coins.trailSpacing,
        collected: false,
      });
    }
    return { index, distance, safeLane, entities };
  }
}
