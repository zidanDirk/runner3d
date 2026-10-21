import { describe, expect, it } from 'vitest';
import { RULES, SHAPES, laneX } from '../../src/game/config';
import { intersects } from '../../src/game/collision';
import { GameEngine } from '../../src/game/engine';
import { LevelGenerator } from '../../src/game/level';
import { createRandom } from '../../src/game/random';
import type { Entity, EntityKind, LevelSource, Player } from '../../src/game/types';
import { FixedClock } from '../../src/runtime/clock';

function fixture(kind: EntityKind, distance = 16): LevelSource {
  let index = 0;
  return { next: () => {
    const rowIndex = index++;
    return { index: rowIndex, safeLane: 0, distance: distance + rowIndex * RULES.rowSpacing,
      entities: rowIndex === 0 ? [{ id: 'fixture', kind, lane: 1, distance, collected: false }] : [] };
  } };
}

function untilDistance(engine: GameEngine, distance: number): void {
  while (engine.view.distance < distance && engine.view.status === 'running') engine.step();
}

const standing = (): Player => ({ lane: 1, x: 0, fromX: 0, laneElapsed: 1, y: 0, velocityY: 0, slideRemaining: 0 });
const entity = (kind: EntityKind): Entity => ({ id: kind, kind, lane: 1, distance: 10, collected: false });

describe('seeded generation and continuous routes', () => {
  it('reproduces the random stream and separates different seeds', () => {
    const stream = (seed: string) => { const random = createRandom(seed); return Array.from({ length: 100 }, random); };
    expect(stream('固定种子')).toEqual(stream('固定种子'));
    expect(stream('first')).not.toEqual(stream('second'));
    expect(stream('limits').every((n) => n >= 0 && n < 1)).toBe(true);
  });

  it('reproduces complete level rows', () => {
    const a = new LevelGenerator('replay');
    const b = new LevelGenerator('replay');
    for (let i = 0; i < 100; i++) expect(a.next()).toEqual(b.next());
  });

  it('keeps a reachable empty lane across 50 seeds and 50,000 rows', () => {
    const kinds = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const level = new LevelGenerator(`route-${seed}`);
      let previous = 1;
      let previousDistance = RULES.firstRow - RULES.rowSpacing;
      for (let i = 0; i < 1000; i++) {
        const row = level.next();
        const obstacles = row.entities.filter((e) => e.kind !== 'coin');
        expect(obstacles.every((e) => e.lane !== row.safeLane)).toBe(true);
        expect(obstacles.length).toBeLessThanOrEqual(2);
        expect(Math.abs(row.safeLane - previous)).toBeLessThanOrEqual(1);
        const clearTravelTime = (row.distance - previousDistance - 2 * SHAPES.block.depth - RULES.playerDepth) / RULES.maxSpeed;
        expect(clearTravelTime).toBeGreaterThan(RULES.laneChangeDuration + 0.5);
        obstacles.forEach((e) => kinds.add(e.kind));
        previous = row.safeLane;
        previousDistance = row.distance;
      }
    }
    expect([...kinds].sort()).toEqual(['block', 'gate', 'hurdle']);
  });

  it('survives 6 seeded 5km routes in the real simulator, at maximum speed, with bounded entities', () => {
    for (let seed = 0; seed < 6; seed++) {
      const engine = new GameEngine(`solver-${seed}`);
      engine.start();
      while (engine.view.distance < 5000 && engine.view.status === 'running') {
        const s = engine.view;
        const row = s.rows.find((candidate) => candidate.distance > s.distance - 3);
        if (row && row.safeLane !== s.player.lane) engine.dispatch(row.safeLane < s.player.lane ? 'left' : 'right');
        engine.step();
        if (engine.view.tick % 1000 === 0) expect(engine.view.entities.length).toBeLessThan(65);
      }
      expect(engine.view.status, `seed ${seed} at ${engine.view.distance}m`).toBe('running');
      expect(engine.view.speed).toBe(RULES.maxSpeed);
      expect(engine.view.rows.length).toBeLessThan(10);
    }
  }, 15000);
});

describe('fixed clock and deterministic simulation', () => {
  it('advances identical tick sequences at 30, 60 and 144 fps', () => {
    const simulate = (fps: number) => {
      const engine = new GameEngine('frames', fixture('coin', 5));
      const clock = new FixedClock();
      engine.start();
      for (let frame = 0; frame < fps * 2; frame++) clock.advance(1 / fps, () => {
        if (engine.view.tick === 40) engine.dispatch('jump');
        if (engine.view.tick === 180) engine.dispatch('left');
        engine.step();
      });
      return engine.view;
    };
    expect(simulate(30)).toEqual(simulate(60));
    expect(simulate(144)).toEqual(simulate(60));
    expect(simulate(60).tick).toBe(240);
  });

  it('clamps stalls and rejects invalid deltas', () => {
    const clock = new FixedClock();
    let steps = 0;
    const step = () => { steps++; };
    expect(clock.advance(60, step)).toBe(12);
    expect(clock.advance(NaN, step)).toBe(0);
    expect(clock.advance(-1, step)).toBe(0);
    expect(steps).toBe(12);
  });

  it('discards residual time on reset', () => {
    const clock = new FixedClock();
    clock.advance(RULES.fixedDt / 2, () => {});
    clock.reset();
    expect(clock.advance(RULES.fixedDt / 2, () => {})).toBe(0);
  });
});

describe('movement, actions and lifecycle', () => {
  it('waits for start and automatically moves forward', () => {
    const engine = new GameEngine('start');
    engine.step();
    expect(engine.view.distance).toBe(0);
    engine.start();
    engine.step();
    expect(engine.view.distance).toBeCloseTo(RULES.baseSpeed * RULES.fixedDt);
  });

  it('smoothly changes lanes and clamps both edges', () => {
    const engine = new GameEngine('lanes');
    engine.start();
    engine.dispatch('left'); engine.step();
    expect(engine.view.player.x).toBeLessThan(0);
    expect(engine.view.player.x).toBeGreaterThan(laneX(0));
    for (let i = 0; i < 30; i++) { engine.dispatch('left'); engine.step(); }
    expect(engine.view.player.lane).toBe(0);
    expect(engine.view.player.x).toBe(laneX(0));
    engine.dispatch('right'); engine.dispatch('right'); engine.dispatch('right');
    for (let i = 0; i < 30; i++) engine.step();
    expect(engine.view.player.lane).toBe(2);
    expect(engine.view.player.x).toBe(laneX(2));
  });

  it('jumps, rejects double jump, and lands at exactly zero', () => {
    const engine = new GameEngine('jump');
    engine.start(); engine.dispatch('jump'); engine.step();
    const velocity = engine.view.player.velocityY;
    engine.dispatch('jump'); engine.step();
    expect(engine.view.player.velocityY).toBeLessThan(velocity);
    for (let i = 0; i < 140; i++) engine.step();
    expect(engine.view.player.y).toBe(0);
    expect(engine.view.player.velocityY).toBe(0);
  });

  it('slides for a bounded duration and rejects jumping during the slide', () => {
    const engine = new GameEngine('slide');
    engine.start(); engine.dispatch('slide'); engine.step();
    expect(engine.view.player.slideRemaining).toBeGreaterThan(0);
    engine.dispatch('jump'); engine.step();
    expect(engine.view.player.y).toBe(0);
    for (let i = 0; i < 100; i++) engine.step();
    expect(engine.view.player.slideRemaining).toBe(0);
    engine.dispatch('jump'); engine.step();
    engine.dispatch('slide'); engine.step();
    expect(engine.view.player.slideRemaining).toBe(0);
    expect(engine.view.player.y).toBeGreaterThan(0);
  });

  it('pauses without advancing and discards queued input before resume', () => {
    const engine = new GameEngine('pause');
    engine.start(); engine.step(); engine.dispatch('left'); engine.pause();
    const distance = engine.view.distance;
    engine.dispatch('right');
    for (let i = 0; i < 50; i++) engine.step();
    expect(engine.view.distance).toBe(distance);
    engine.resume(); engine.step();
    expect(engine.view.player.lane).toBe(1);
    expect(engine.view.distance).toBeGreaterThan(distance);
  });

  it('recreating the engine fully resets the same seeded run', () => {
    const fresh = new GameEngine('retry');
    const originalRows = structuredClone(fresh.view.rows);
    fresh.start(); fresh.dispatch('left'); untilDistance(fresh, 30);
    const retry = new GameEngine('retry');
    expect(retry.view.rows).toEqual(originalRows);
    expect(retry.view.distance).toBe(0);
    expect(retry.view.coins).toBe(0);
    expect(retry.view.player.x).toBe(0);
    expect(retry.view.status).toBe('ready');
  });
});

describe('collisions, pickups and score', () => {
  it.each(['hurdle', 'gate', 'block'] as const)('ends a run on a standing collision with %s', (kind) => {
    const engine = new GameEngine('collision', fixture(kind));
    engine.start(); untilDistance(engine, 20);
    expect(engine.view.status).toBe('over');
    expect(engine.view.hit).toBe(kind);
    const distance = engine.view.distance;
    engine.dispatch('jump'); engine.start(); engine.resume(); engine.step();
    expect(engine.view.distance).toBe(distance);
  });

  it('allows a timed jump over a low hurdle', () => {
    const engine = new GameEngine('jump-hurdle', fixture('hurdle'));
    engine.start(); untilDistance(engine, 10); engine.dispatch('jump'); untilDistance(engine, 20);
    expect(engine.view.status).toBe('running');
  });

  it('allows a timed slide under a gate', () => {
    const engine = new GameEngine('slide-gate', fixture('gate'));
    engine.start(); untilDistance(engine, 11); engine.dispatch('slide'); untilDistance(engine, 20);
    expect(engine.view.status).toBe('running');
  });

  it('keeps high walls dangerous even while jumping', () => {
    const engine = new GameEngine('wall', fixture('block'));
    engine.start(); untilDistance(engine, 10); engine.dispatch('jump'); untilDistance(engine, 20);
    expect(engine.view.status).toBe('over');
  });

  it('uses actual position during a lane transition', () => {
    const p = standing();
    p.lane = 0; p.x = -0.1;
    expect(intersects(p, entity('block'), 10)).toBe(true);
    p.x = laneX(0);
    expect(intersects(p, entity('block'), 10)).toBe(false);
  });

  it('matches jump/slide vertical collision volumes', () => {
    const p = standing();
    p.y = 1;
    expect(intersects(p, entity('hurdle'), 10)).toBe(false);
    expect(intersects(p, entity('gate'), 10)).toBe(true);
    p.y = 0; p.slideRemaining = 0.5;
    expect(intersects(p, entity('gate'), 10)).toBe(false);
    expect(intersects(p, entity('hurdle'), 10)).toBe(true);
  });

  it('collects each coin once and combines distance and pickup score', () => {
    const engine = new GameEngine('coin', fixture('coin', 5));
    engine.start(); untilDistance(engine, 6);
    expect(engine.view.coins).toBe(1);
    expect(engine.view.score).toBe(Math.floor(engine.view.distance) + RULES.coinValue);
    untilDistance(engine, 8);
    expect(engine.view.coins).toBe(1);
    expect(engine.view.entities.find((e) => e.id === 'fixture')?.collected).toBe(true);
  });

  it('does not miss the narrowest collider at maximum speed', () => {
    const collisionWindow = (RULES.playerDepth + SHAPES.coin.depth) / 2;
    expect(RULES.maxSpeed * RULES.fixedDt).toBeLessThan(collisionWindow);
  });
});
