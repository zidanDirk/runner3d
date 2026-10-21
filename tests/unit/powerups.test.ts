import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/game/engine';
import type { EngineOptions } from '../../src/game/engine';
import { PowerUpGenerator, PowerUpSystem } from '../../src/game/powerups';
import type { PowerUpSource } from '../../src/game/powerups';
import { BASE_UPGRADES, POWERUP_BALANCE } from '../../src/game/balance';
import type { PowerUpType } from '../../src/game/balance';
import { LevelGenerator } from '../../src/game/level';
import { RULES } from '../../src/game/config';
import type { Entity, LevelSource, Player } from '../../src/game/types';
import { FeedbackEventSource } from '../../src/feedback/FeedbackEventSource';

const player: Player = { lane: 1, x: 0, fromX: 0, laneElapsed: 1, y: 0, velocityY: 0, slideRemaining: 0 };
function fixture(types: readonly PowerUpType[] = [], entities: Entity[] = [], options: EngineOptions = {}) {
  let i = 0;
  const level: LevelSource = { next: () => { const index = i++; return { index, distance: 3 + index * 26, safeLane: 1, entities: index === 0 ? entities : [] }; } };
  const pickupSource: PowerUpSource = { forRow: (row) => {
    const type = types[row.index];
    return type ? { id: `p${row.index}`, type, lane: 1, distance: 2 + row.index * 2, collected: false } : null;
  } };
  const engine = new GameEngine('powers', level, { pickupSource, ...options });
  engine.start(); return engine;
}
function step(engine: GameEngine, ticks: number) { for (let i = 0; i < ticks; i++) engine.step(); }
function to(engine: GameEngine, distance: number) { while (engine.view.status === 'running' && engine.view.distance < distance) engine.step(); }
const pickup = (type: PowerUpType, id: string = type) => ({ id, type, lane: 1 as const, distance: 0, collected: false });

describe('power-up lifetime and score', () => {
  it('activates a collected magnet for eight game seconds', () => { const e = fixture(['magnet']); to(e, 2); expect(e.view.powerups.magnet).toBeGreaterThan(7.9); expect(e.view.powerupsCollected).toBe(1); });
  it('checks a spherical magnet range including adjacent lanes and vertical position', () => {
    const p = new PowerUpSystem(); p.collect(pickup('magnet'));
    expect(p.attracts(player, 0, 0, 0)).toBe(true); expect(p.attracts(player, 0, 2, 0)).toBe(false);
    expect(p.attracts({ ...player, y: 5 }, 1, 0, 0)).toBe(false);
  });
  it('collects adjacent coins through the ordinary coin/feedback path exactly once', () => {
    const e = fixture(['magnet'], [{ id: 'adjacent', kind: 'coin', lane: 0, distance: 6, collected: false }]);
    const source = new FeedbackEventSource(); source.reset(e.view); const ids: string[] = [];
    for (let t = 0; t < 80; t++) { e.step(); source.observe(e.view, event => { if (event.type === 'coin') ids.push(event.entityId); }); }
    expect(ids.filter(id => id === 'adjacent')).toHaveLength(1);
    expect(e.view.entities.find(x => x.id === 'adjacent')?.magnetCollected).toBe(true);
    expect(e.view.score).toBe(Math.floor(e.view.distance) + e.view.coins * 25);
  });
  it('stops attraction at expiry', () => { const p = new PowerUpSystem(); p.collect(pickup('magnet')); for (let i = 0; i < 960; i++) p.step(); expect(p.active.magnet).toBe(0); expect(p.attracts(player, 1, 0, 0)).toBe(false); });
  it('shield absorbs exactly one actual obstacle and suppresses its consecutive ticks', () => {
    const e = fixture(['shield'], [{ id: 'a', kind: 'block', lane: 1, distance: 5, collected: false }]); to(e, 7);
    expect(e.view.status).toBe('running'); expect(e.view.powerups.shield).toBe(0); expect(e.view.hit).toBeNull();
  });
  it('a different obstacle after shield consumption still kills', () => {
    const e = fixture(['shield'], ['a', 'b'].map((id, i) => ({ id, kind: 'block', lane: 1, distance: 5 + i * 5, collected: false })));
    to(e, 12); expect(e.view.status).toBe('over'); expect(e.view.distance).toBeGreaterThan(8);
  });
  it('expired shield cannot intercept collision', () => { const p = new PowerUpSystem(); p.collect(pickup('shield')); for (let i = 0; i < 1800; i++) p.step(); expect(p.interceptCollision('new')).toBe(false); });
  it('collision dedup is specific to the obstacle, with no time-based global immunity', () => { const p = new PowerUpSystem(); p.collect(pickup('shield')); expect(p.interceptCollision('a')).toBe(true); expect(p.interceptCollision('a')).toBe(true); expect(p.interceptCollision('b')).toBe(false); p.recycle(new Set()); expect(p.interceptCollision('a')).toBe(false); });
  it('double score only multiplies new distance and coin points, never coin count', () => {
    const e = fixture(['double-score']); to(e, 1); const old = e.view.score; to(e, 20);
    const base = Math.floor(e.view.distance) + e.view.coins * 25;
    expect(e.view.score).toBe(base + e.view.scoreBonus); expect(e.view.scoreBonus).toBe(base - old); expect(e.view.coins).toBe(3);
  });
  it('refreshes duplicate pickups without stacking time, charges or multiplier', () => { const p = new PowerUpSystem(); for (const type of ['magnet', 'shield', 'double-score'] as const) { p.collect(pickup(type)); p.step(); p.collect(pickup(type, 'again')); expect(p.active[type]).toBe(POWERUP_BALANCE.durations[type][0]); } expect(p.multiplier).toBe(2); });
  it('cannot collect the same pickup twice', () => { const p = new PowerUpSystem(); const x = pickup('magnet'); p.collect(x); p.step(); p.collect(x); expect(p.active.magnet).toBeLessThan(8); expect(p.facts).toHaveLength(0); });
  it('all three powers can coexist independently', () => { const e = fixture(['magnet', 'shield', 'double-score']); to(e, 7); for (const type of ['magnet', 'shield', 'double-score'] as const) expect(e.view.powerups[type]).toBeGreaterThan(0); });
  it('pause freezes duration and pickup/score, then resumes by fixed time', () => { const e = fixture(['magnet']); to(e, 4); e.pause(); const before = structuredClone(e.view); step(e, 1200); expect(e.view).toEqual(before); e.resume(); e.step(); expect(e.view.powerups.magnet).toBeCloseTo(before.powerups.magnet - RULES.fixedDt); });
  it('game over freezes powers and score', () => { const e = fixture(['magnet'], [{ id: 'kill', kind: 'block', lane: 1, distance: 8, collected: false }]); to(e, 10); const before = structuredClone(e.view); step(e, 500); expect(e.view).toEqual(before); });
  it('a new run clears all powers and prior bonus', () => { const e = fixture(['shield']); to(e, 4); const n = new GameEngine('powers'); expect(n.view.powerups).toEqual({ magnet: 0, shield: 0, 'double-score': 0 }); expect(n.view.powerupsCollected).toBe(0); expect(n.view.scoreBonus).toBe(0); });
  it('levels extend duration and magnet reach without increasing multiplier/charges', () => { const p = new PowerUpSystem({ magnet: 3, shield: 3, 'double-score': 3 }); for (const type of ['magnet', 'shield', 'double-score'] as const) p.collect(pickup(type)); expect(p.active).toEqual({ magnet: 14, shield: 24, 'double-score': 16 }); expect(p.attracts(player, 0, 3, 0)).toBe(true); expect(p.multiplier).toBe(2); expect(p.interceptCollision('a')).toBe(true); expect(p.interceptCollision('b')).toBe(false); });
  it('rejects invalid levels and spawn probabilities', () => { expect(() => new PowerUpSystem({ ...BASE_UPGRADES, magnet: 4 })).toThrow(); for (const value of [NaN, Infinity, -1, 2]) expect(() => new PowerUpGenerator('x', value)).toThrow(); });
  it('restores 1x after ten seconds without recomputing history', () => { const e = fixture(['double-score']); step(e, 1300); const bonus = e.view.scoreBonus; expect(e.view.powerups['double-score']).toBe(0); step(e, 120); expect(e.view.scoreBonus).toBe(bonus); expect(e.view.score).toBe(Math.floor(e.view.distance) + e.view.coins * 25 + bonus); });
});

describe('independent seeded pickup generation', () => {
  it('is reproducible and independent of generation order', () => { const l = new LevelGenerator('p'); const rows = Array.from({ length: 50 }, () => l.next()); const a = new PowerUpGenerator('p', 1); const b = new PowerUpGenerator('p', 1); expect(rows.map(r => a.forRow(r))).toEqual(rows.slice().reverse().map(r => b.forRow(r)).reverse()); });
  it('preserves all obstacle and coin rows with powers enabled or disabled', () => { const a = new GameEngine('same'); const b = new GameEngine('same', undefined, { powerups: false }); expect(a.view.rows).toEqual(b.view.rows); expect(a.view.entities).toEqual(b.view.entities); });
  it('spawns on the existing reachable safe lane without overlapping coins or obstacles', () => { for (let seed = 0; seed < 20; seed++) { const l = new LevelGenerator(`route${seed}`), p = new PowerUpGenerator(`route${seed}`, 1); for (let i = 0; i < 400; i++) { const row = l.next(), x = p.forRow(row); if (!x) continue; expect(x.lane).toBe(row.safeLane); expect(row.entities.every(e => Math.abs(e.distance - x.distance) > 1.5)).toBe(true); } } });
  it('10km actual fixed-step routes stay reachable and memory bounded with or without pickups', () => {
    for (const enabled of [true, false]) {
      const e = new GameEngine('long-powers', undefined, { powerups: enabled }); e.start();
      while (e.view.distance < 10000 && e.view.status === 'running') {
        const s = e.view, row = s.rows.find(r => r.distance >= s.distance - 2);
        if (row && row.safeLane !== s.player.lane) e.dispatch(row.safeLane < s.player.lane ? 'left' : 'right'); e.step();
        if (s.tick % 240 === 0) { expect(e.view.pickups.length).toBeLessThan(10); expect(e.view.entities.length).toBeLessThan(65); }
      }
      expect(e.view.status).toBe('running'); expect(e.view.distance).toBeGreaterThanOrEqual(10000);
    }
  }, 15000);
});

import { validatePowerupBalance } from '../../src/game/balance';
it('strictly rejects unknown fields, unsafe spawn placement, multipliers, and invalid level arrays', () => {
  validatePowerupBalance(POWERUP_BALANCE);
  for (const change of [{ extra: true }, { rowProbability: NaN }, { rowProbability: 1 }, { multiplier: 4 }, { rowOffset: 0 }, { magnetRadius: [3, 4, 5] }, { durations: { magnet: [8, 7, 9, 10], shield: [15, 18, 21, 24], 'double-score': [10, 12, 14, 16] } }]) {
    expect(() => validatePowerupBalance({ ...POWERUP_BALANCE, ...change })).toThrow();
  }
});

it('one shield cannot block two distinct simultaneous obstacle contacts', () => {
  const e = fixture(['shield'], ['a', 'b'].map(id => ({ id, kind: 'block', lane: 1, distance: 5, collected: false })));
  to(e, 8); expect(e.view.status).toBe('over'); expect(e.view.powerups.shield).toBe(0);
});

import { FixedClock } from '../../src/runtime/clock';
it('active powers, score and pickups produce identical fixed ticks at30/60/144 display FPS', () => {
  const simulate = (fps: number) => {
    const e = fixture(['magnet', 'shield', 'double-score']); const clock = new FixedClock();
    for (let frame = 0; frame < fps * 20; frame++) clock.advance(1 / fps, () => {
      if (e.view.tick === 60) e.dispatch('jump'); if (e.view.tick === 300) e.dispatch('slide');
      e.step();
    }); return e.view;
  };
  expect(simulate(30)).toEqual(simulate(60)); expect(simulate(144)).toEqual(simulate(60));
  expect(simulate(60).tick).toBe(2400); expect(simulate(60).scoreBonus).toBeGreaterThan(0);
});
