import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/game/engine';
import { FixedClock } from '../../src/runtime/clock';
import { RULES } from '../../src/game/config';
import type { Lane } from '../../src/game/types';
import { controlWindow, createRoutePlan, forecastDistance, observePickups, planRouteStep, POWERUP_ROUTE, routePollDelay } from '../production/route-plan';
import type { RouteSample } from '../production/route-plan';

const plan = createRoutePlan();
const sample = (distance: number, shield = false): RouteSample => ({ distance, speed: 16 + distance * .004, coins: 1, status: 'running', sampledAtMs: 1000,
  powerups: { magnet: distance >= 211, shield, 'double-score': distance >= 263 } });

describe('production route navigation windows', () => {
  it('preserves both obstacle clearance and the 237m shield pickup', () => {
    expect(plan.required.map(p => [p.type, p.distance, p.lane])).toEqual([['magnet', 211, 1], ['shield', 237, 1], ['double-score', 263, 2]]);
    const collected = new Set(['powerup-6']);
    expect(planRouteStep(plan, sample(232), 1, collected, { nowMs: 1000, keyboardMs: 300, pendingThrough: null })).toMatchObject({ kind: 'hold', lane: 1 });
    const atPickup = sample(237, true); observePickups(plan, atPickup, collected);
    expect(planRouteStep(plan, atPickup, 1, collected, { nowMs: 1300, keyboardMs: 300, pendingThrough: null })).toMatchObject({ kind: 'move', lane: 2 });
  });
  it('rejects the trace stale 250m decision instead of silently spending a shield', () => {
    const collected = new Set(['powerup-6', 'powerup-7']);
    expect(planRouteStep(plan, sample(250, true), 1, collected, { nowMs: 1500, keyboardMs: 300, pendingThrough: null })).toMatchObject({ kind: 'unsafe', dangerStart: 255 });
  });
  it('does not send another move while the previous input has not completed in simulation distance', () => {
    expect(planRouteStep(plan, sample(51), 2, new Set(), { nowMs: 1000, keyboardMs: 100, pendingThrough: 55 })).toMatchObject({ kind: 'hold', lane: 2 });
  });
  it('rejects a pending input whose completion would miss the next obstacle deadline', () => {
    expect(planRouteStep(plan, sample(250, true), 1, new Set(['powerup-6', 'powerup-7']), { nowMs: 1500, keyboardMs: 300, pendingThrough: 260 })).toMatchObject({ kind: 'unsafe', dangerStart: 255 });
  });
  it('fails a missed pickup and an invalid timestamp rather than pretending collection', () => {
    expect(planRouteStep(plan, sample(241), 1, new Set(['powerup-6']), { nowMs: 1000, keyboardMs: 100, pendingThrough: null })).toMatchObject({ kind: 'unsafe' });
    expect(planRouteStep(plan, sample(30), 1, new Set(), { nowMs: 900, keyboardMs: 100, pendingThrough: null })).toMatchObject({ kind: 'unsafe' });
  });
  it('defers a non-steering RPC until the lane has room for its read and follow-up move', () => {
    expect(controlWindow(plan, sample(71), 1, 2.1).safe).toBe(false);
    expect(controlWindow(plan, sample(127), 1, 2.1).safe).toBe(true);
  });
  it('uses actual entities: the 282m recovery row is empty, with the next right-lane gate at 308m', () => {
    expect(plan.rows[9]?.row.entities.filter(e => e.kind !== 'coin')).toEqual([]);
    expect(controlWindow(plan, sample(270), 2, 0).dangerStart).toBeCloseTo(307.3);
  });
  it('requires landing relative to the actual jump, even when global distance already exceeds 20m', () => {
    const engine = new GameEngine(POWERUP_ROUTE);
    engine.start(); engine.dispatch('right');
    while (engine.view.distance < 29) engine.step();
    const jumpDistance = Math.floor(engine.view.distance);
    engine.dispatch('jump'); engine.step();
    expect(engine.view.player.y).toBeGreaterThan(0);
    const landing = forecastDistance(sample(jumpDistance), 2 * RULES.jumpVelocity / RULES.gravity);
    expect(landing).toBeGreaterThan(20);
    while (engine.view.distance <= landing) engine.step();
    expect(engine.view.player.y).toBe(0);
    engine.dispatch('slide'); engine.step();
    expect(engine.view.player.slideRemaining).toBeGreaterThan(0);
  });
  it('replays the actual 254m late-key shield consumption and earlier safe inputs', () => {
    for (const [rightAt, shouldBreak] of [[254, true], [254.2, true], [254.4, true], [248, false], [249, false], [250, false]] as const) {
      const engine = new GameEngine(POWERUP_ROUTE);
      let breaks = 0;
      const step = () => {
        engine.step(); breaks += engine.view.powerupFacts.filter(f => f.type === 'shield-broken').length;
        expect(engine.view.status).toBe('running');
      };
      engine.start();
      while (engine.view.distance < 235) {
        const target = plan.rows.find(r => r.row.distance >= engine.view.distance - 9)?.row.safeLane;
        if (target !== undefined && target !== engine.view.player.lane) engine.dispatch(target < engine.view.player.lane ? 'left' : 'right');
        step();
      }
      while (engine.view.distance < rightAt) step();
      expect(engine.view.powerups.shield).toBeGreaterThan(0);
      engine.dispatch('right');
      while (engine.view.distance < 272) step();
      expect(engine.view.powerupsCollected).toBe(3);
      expect(breaks).toBe(shouldBreak ? 1 : 0);
      expect(engine.view.powerups.shield > 0).toBe(!shouldBreak);
    }
  });
  for (const fps of [60, 15, 8]) for (const delayMs of [0, 100, 300]) {
    it(`real fixed-step engine: ${fps}Hz render scheduling, ${delayMs}ms stale reads and input delay`, () => {
      for (const phase of [0, .013, .027, .041, .055, .069]) {
        const engine = new GameEngine(POWERUP_ROUTE), clock = new FixedClock(), collected = new Set<string>();
        let wall = 0, nextFrame = 1 / fps, lane: Lane = 1, pendingThrough: number | null = null;
        let shieldBreaks = 0, commands = 0;
        const advanceTo = (until: number) => {
          while (nextFrame <= until + 1e-9) {
            clock.advance(1 / fps, () => { engine.step(); shieldBreaks += engine.view.powerupFacts.filter(f => f.type === 'shield-broken').length; });
            nextFrame += 1 / fps;
          }
          wall = until;
        };
        engine.start(); advanceTo(phase);
        while (engine.view.distance < 272 && wall < 75 && engine.view.status === 'running') {
          const view = engine.view;
          const read: RouteSample = { distance: Math.floor(view.distance), speed: Number(view.speed.toFixed(1)), coins: view.coins, status: view.status, sampledAtMs: wall * 1000,
            powerups: { magnet: view.powerups.magnet > 0, shield: view.powerups.shield > 0, 'double-score': view.powerups['double-score'] > 0 } };
          advanceTo(wall + delayMs / 1000);
          observePickups(plan, read, collected);
          if (pendingThrough !== null && read.distance >= pendingThrough) pendingThrough = null;
          const decision = planRouteStep(plan, read, lane, collected, { nowMs: wall * 1000, keyboardMs: delayMs, pendingThrough });
          expect(decision.kind, JSON.stringify({ fps, delayMs, phase, read, decision })).not.toBe('unsafe');
          if (decision.kind === 'move') {
            advanceTo(wall + delayMs / 1000);
            const keyDistance = Math.floor(engine.view.distance);
            engine.dispatch(decision.lane < lane ? 'left' : 'right'); lane = decision.lane; commands++;
            pendingThrough = forecastDistance({ ...read, distance: keyDistance }, RULES.laneChangeDuration);
          }
          // Even an immediate browser read yields to the event loop in reality.
          advanceTo(wall + Math.max(.001, routePollDelay(plan, read, collected, delayMs, delayMs) / 1000));
        }
        expect(engine.view.status).toBe('running');
        expect(engine.view.distance).toBeGreaterThan(266);
        expect(engine.view.powerupsCollected).toBe(3);
        expect(Object.values(engine.view.powerups).every(v => v > 0)).toBe(true);
        expect(shieldBreaks).toBe(0);
        expect(commands).toBeLessThan(20);
      }
    });
  }
});
