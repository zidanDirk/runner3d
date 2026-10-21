import { expect, it } from 'vitest';
import { LevelGenerator } from '../../src/game/level';
import { PowerUpGenerator } from '../../src/game/powerups';
import { mkdirSync, writeFileSync } from 'node:fs';
it('finds a naturally generated short demonstration with three consecutive power-ups', () => {
  let result: { seed: string; pickups: unknown[] } | undefined;
  for (let i = 0; i < 30000; i++) {
    const seed = `DEMO-11-${i}`, level = new LevelGenerator(seed), powers = new PowerUpGenerator(seed);
    const rows = Array.from({ length: 9 }, () => level.next());
    const pickups = rows.slice(6).map(row => powers.forRow(row));
    if (pickups[0]?.type === 'magnet' && pickups[1]?.type === 'shield' && pickups[2]?.type === 'double-score') { result = { seed, pickups }; break; }
  }
  expect(result).toBeDefined(); mkdirSync('artifacts/progression', { recursive: true });
  writeFileSync('artifacts/progression/demo-seed.json', JSON.stringify(result, null, 2));
});
