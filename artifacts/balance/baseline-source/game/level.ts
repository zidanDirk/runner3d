import { RULES } from './config';
import { createRandom } from './random';
import type { Entity, Lane, LevelSource, ObstacleKind, TrackRow } from './types';

const LANES: readonly Lane[] = [0, 1, 2];
const KINDS: readonly ObstacleKind[] = ['hurdle', 'gate', 'block'];

export class LevelGenerator implements LevelSource {
  private readonly random: () => number;
  private index = 0;
  private safeLane: Lane = 1;

  constructor(seed: string) {
    this.random = createRandom(seed);
  }

  next(): TrackRow {
    const index = this.index++;
    const distance = RULES.firstRow + index * RULES.rowSpacing;
    const candidates = LANES.filter((lane) => Math.abs(lane - this.safeLane) <= 1);
    this.safeLane = candidates[Math.floor(this.random() * candidates.length)] ?? 1;
    const entities: Entity[] = [];
    const recovery = index % 5 === 4;
    for (const lane of LANES) {
      if (!recovery && lane !== this.safeLane) {
        const kind = KINDS[Math.floor(this.random() * KINDS.length)] ?? 'hurdle';
        entities.push({ id: `${index}-${lane}-obstacle`, lane, kind, distance, collected: false });
      }
    }
    // The reward trail also communicates a route through each decision.
    for (let coin = 0; coin < 4; coin++) {
      entities.push({
        id: `${index}-coin-${coin}`,
        lane: this.safeLane,
        kind: 'coin',
        distance: distance - 9 + coin * 4,
        collected: false,
      });
    }
    return { index, distance, safeLane: this.safeLane, entities };
  }
}
