import { describe, expect, it } from 'vitest';
import { DIFFICULTY_CONFIG, getDifficulty, speedAtDistance, validateDifficultyConfig } from '../../src/game/difficulty';
import { RULES } from '../../src/game/config';
import { LevelGenerator } from '../../src/game/level';
import { LevelGenerator as OriginalLevel } from '../../artifacts/balance/baseline-source/game/level';
import { GameEngine } from '../../src/game/engine';
import { GameEngine as OriginalEngine } from '../../artifacts/balance/baseline-source/game/engine';
import { createRandom } from '../../src/game/random';
import { ProfileController } from '../../src/progression/ProfileController';
import { ProfileController as OriginalProfile } from '../../artifacts/balance/baseline-source/progression/ProfileController';

describe('versioned difficulty and compatibility', () => {
  it('has one validated immutable source for speed, density, rewards and power-up frequency', () => {
    expect(() => validateDifficultyConfig(DIFFICULTY_CONFIG)).not.toThrow();
    expect(Object.isFrozen(DIFFICULTY_CONFIG.stages)).toBe(true);
    expect(RULES.baseSpeed).toBe(DIFFICULTY_CONFIG.speed.initial);
    expect(RULES.rowSpacing).toBe(DIFFICULTY_CONFIG.track.rowSpacing);
  });
  it.each([NaN, Infinity, -1])('rejects non-finite or negative distance %s', distance => expect(() => getDifficulty(distance)).toThrow());
  it.each([
    { version: 2 }, { unexpected: true }, { speed: { initial: 16, maximum: 25, perMeter: .004 } },
    { track: { ...DIFFICULTY_CONFIG.track, rowSpacing: 10 } },
    { obstacles: { ...DIFFICULTY_CONFIG.obstacles, weights: { hurdle: 0, gate: 0, block: 0 } } },
    { fairness: { ...DIFFICULTY_CONFIG.fairness, maxAttempts: 0 } },
    { fairness: { ...DIFFICULTY_CONFIG.fairness, reactionSeconds: .6, inputLatencySeconds: .15 } },
    { stages: [{ id: 'beginner', name: 'a', startDistance: 1 }, { id: 'beginner', name: 'b', startDistance: 2 }] },
    { coins: { ...DIFFICULTY_CONFIG.coins, trailSpacing: 100 } },
    { powerups: { rowProbability: Infinity, firstDistance: 180 } },
  ])('rejects unsafe or incompatible configuration %j', patch => expect(() => validateDifficultyConfig({ ...DIFFICULTY_CONFIG, ...patch })).toThrow());
  it('keeps the measured16→24m/s curve continuous at every stage and caps temporal pressure', () => {
    expect([0, 250, 600, 1200, 2000, 10000].map(distance => speedAtDistance(distance))).toEqual([16, 17, 18.4, 20.8, 24, 24]);
    for (const stage of DIFFICULTY_CONFIG.stages.slice(1)) {
      expect(getDifficulty(stage.startDistance).stage.id).toBe(stage.id);
      expect(speedAtDistance(stage.startDistance + .000001) - speedAtDistance(stage.startDistance - .000001)).toBeLessThan(.000001);
    }
    expect(getDifficulty(0).obstaclesPerMeter).toBeCloseTo(1.6 / 26);
    expect(getDifficulty(10000).rowsPerSecond).toBeCloseTo(24 / 26);
    expect(getDifficulty(2000).difficultyScore).toBe(getDifficulty(10000).difficultyScore);
  });
  it('keeps every obstacle/coin row identical to the captured production generator across10000 rows', () => {
    for (let seed = 0; seed < 50; seed++) {
      const original = new OriginalLevel(`compat-${seed}`), next = new LevelGenerator(`compat-${seed}`);
      for (let row = 0; row < 200; row++) expect(next.next()).toEqual(original.next());
      expect(next.lastValidation).toMatchObject({ reachable: true, testedLanes: 3, maxSpeed: 24 });
    }
  });
  it('keeps queued actions, mid-lane physics, collisions, powers and scoring identical to the original engine', () => {
    for (let seed = 0; seed < 12; seed++) {
      const original = new OriginalEngine(`compat-input-${seed}`), next = new GameEngine(`compat-input-${seed}`), random = createRandom(`inputs-${seed}`);
      original.start(); next.start();
      for (let tick = 0; tick < 5000 && original.view.status === 'running'; tick++) {
        if (tick % 17 === 0) {
          const action = (['left', 'right', 'jump', 'slide'] as const)[Math.floor(random() * 4)] ?? 'left';
          original.dispatch(action); next.dispatch(action);
        }
        original.step(); next.step();
        if (tick % 17 === 0) expect(next.view).toEqual(original.view);
      }
      expect(next.view).toEqual(original.view);
    }
  });
  it('restores an actual Task11 purchased/claimed save without removing upgrades or reissuing rewards', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    const original = new OriginalProfile(storage);
    original.observeRun({ id: 'old', tick: 0, distance: 0, coins: 0, powerupsCollected: 0, score: 0, status: 'running' });
    original.observeRun({ id: 'old', tick: 5000, distance: 1100, coins: 120, powerupsCollected: 6, score: 4500, status: 'over' });
    expect(original.claim('coins-1').ok).toBe(true); expect(original.purchase('magnet', 0).ok).toBe(true); original.flush();
    const current = new ProfileController(storage);
    expect(current.snapshot).toEqual(original.snapshot);
    expect(current.claim('coins-1')).toEqual({ ok: false, reason: 'already-claimed' });
    expect(current.snapshot.upgrades.magnet).toBe(1);
  });
});
