import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/game/engine';
import { initialPlayer } from '../../src/game/motion';
import { RULES } from '../../src/game/config';
import { findReachableRoute, replayWitness, validateRowTransition, reachabilityCacheSize, REACHABILITY_CACHE_CAPACITY } from '../../src/game/reachability';
import { LevelGenerator } from '../../src/game/level';
import type { Entity, Lane, LevelSource, TrackRow } from '../../src/game/types';

const obstacle = (kind: 'hurdle' | 'gate' | 'block', distance: number, lane: Lane = 1): Entity => ({ id: `${kind}-${lane}-${distance}`, kind, lane, distance, collected: false });
function source(entities: Entity[]): LevelSource {
  let index = 0;
  return { next: () => ({ index: index++, distance: 16 + index * 26, safeLane: 1, entities: index === 1 ? entities : [] }) };
}
function replayInEngine(entities: Entity[], actions: readonly { tick: number; action: 'left' | 'right' | 'jump' | 'slide' }[], end: number) {
  const engine = new GameEngine('witness', source(entities), { powerups: false }); engine.start();
  while (engine.view.status === 'running' && engine.view.distance < end) {
    for (const event of actions) if (event.tick === engine.view.tick) engine.dispatch(event.action);
    engine.step();
  }
  return engine;
}
describe('actual fixed-step reachability', () => {
  it.each([0, 1, 2] as const)('certifies an actual route from initial lane%s without any powers', lane => {
    const entities = [obstacle('block', 20, 0), obstacle('block', 20, 1)];
    const scenario = { entities, startDistance: 0, endDistance: 24, player: initialPlayer(lane), reactionSeconds: .43 };
    const result = findReachableRoute(scenario);
    expect(result.reachable).toBe(true);
    expect(replayWitness(scenario, result.actions).reachable).toBe(true);
  });
  it('searches and replays a forced actual jump without replacing game physics', () => {
    const entities = [obstacle('block', 16, 0), obstacle('hurdle', 16, 1), obstacle('block', 16, 2)];
    const scenario = { entities, startDistance: 0, endDistance: 18, maxNodes: 16384 };
    const result = findReachableRoute(scenario);
    expect(result.reachable).toBe(true); expect(result.actions.some(a => a.action === 'jump')).toBe(true);
    expect(replayInEngine(entities, result.actions, 18).view.status).toBe('running');
  });
  it('certifies jump→slide and slide→jump only when the actual mutual exclusion permits them', () => {
    for (const [a, b] of [['hurdle', 'gate'], ['gate', 'hurdle']] as const) {
      const entities = [obstacle(a, 16), obstacle(b, 42)];
      const actions = [{ tick: 55, action: a === 'hurdle' ? 'jump' as const : 'slide' as const }, { tick: 230, action: b === 'hurdle' ? 'jump' as const : 'slide' as const }];
      const result = replayWitness({ entities, startDistance: 0, endDistance: 45 }, actions);
      expect(result.reachable).toBe(true);
      const engine = replayInEngine(entities, actions, 45);
      expect(engine.view.status).toBe('running'); expect(engine.view.player).toEqual(result.finalState?.player);
    }
  });
  it('rejects a close jump/slide sequence with no route and never treats an exhausted budget as reachable', () => {
    const entities = [0, 1, 2].flatMap(lane => [obstacle('hurdle', 16, lane as Lane), obstacle('gate', 17, lane as Lane)]);
    const scenario = { entities, startDistance: 0, endDistance: 20 };
    expect(findReachableRoute(scenario).reachable).toBe(false);
    expect(findReachableRoute({ ...scenario, maxNodes: 1 })).toMatchObject({ reachable: false, status: 'search-exhausted', expandedNodes: 1 });
  });
  it('certifies consecutive lane changes at saturated speed from every lane with an explicit delay', () => {
    const previous: TrackRow = { index: 0, distance: 2000, safeLane: 0, entities: [] };
    const row: TrackRow = { index: 1, distance: 2026, safeLane: 2, entities: [obstacle('block', 2026, 0), obstacle('block', 2026, 1)] };
    const result = validateRowTransition(previous, row);
    expect(result).toMatchObject({ reachable: true, testedLanes: 3, maxSpeed: 24, reactionSeconds: .43 });
    expect(result.witnesses.find(w => w.lane === 0)?.actions.map(a => a.action)).toEqual(['right', 'right']);
    expect(result.witnesses.every(w => w.actions.every(a => a.tick >= Math.ceil(.43 / RULES.fixedDt)))).toBe(true);
  });
  it('retains at most64 layout templates and no seed history', () => {
    for (let seed = 0; seed < 50; seed++) {
      const level = new LevelGenerator(`bounded-${seed}`);
      for (let i = 0; i < 400; i++) expect(level.next().entities.length).toBeLessThanOrEqual(6);
    }
    expect(reachabilityCacheSize()).toBeLessThanOrEqual(REACHABILITY_CACHE_CAPACITY);
  });
  it('bounds deterministic failed-generation attempts rather than retrying indefinitely', () => {
    let calls = 0;
    const level = new LevelGenerator('reject', () => { calls++; return { reachable: false, status: 'search-exhausted', testedLanes: 1, maxSpeed: 24, reactionSeconds: .43, expandedNodes: 4096, witnesses: [] }; });
    expect(() => level.next()).toThrow(/bounded attempt/); expect(calls).toBe(1);
  });
  it('never reuses a cleared-obstacle certificate for live obstacles', () => {
    const row: TrackRow = { index: 1, distance: 52, safeLane: 1, entities: [0, 1, 2].map(lane => ({ ...obstacle('block', 52, lane as Lane), collected: true })) };
    expect(validateRowTransition(null, row).reachable).toBe(true);
    expect(validateRowTransition(null, { ...row, entities: row.entities.map(e => ({ ...e, collected: false })) }).reachable).toBe(false);
  });
  it('rejects malformed scenarios and witnesses that act before the assumed reaction budget', () => {
    expect(() => findReachableRoute({ entities: [], startDistance: 0, endDistance: Infinity })).toThrow();
    expect(() => replayWitness({ entities: [], startDistance: 0, endDistance: 20, reactionSeconds: .4 }, [{ tick: 0, action: 'left' }])).toThrow();
  });
  it('stops reaction waiting at the scenario horizon instead of colliding with later obstacles', () => {
    const scenario = { entities: [0, 1, 2].map(lane => obstacle('block', 16, lane as Lane)), startDistance: 0, endDistance: 1, reactionSeconds: 2 };
    const result = findReachableRoute(scenario);
    expect(result.reachable).toBe(true); expect(result.finalState).toEqual(replayWitness(scenario, []).finalState);
  });
});
