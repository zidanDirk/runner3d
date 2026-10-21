import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/game/engine';
import { RULES } from '../../src/game/config';
import type { FeedbackEvent } from '../../src/feedback/types';
import { FeedbackEventSource } from '../../src/feedback/FeedbackEventSource';
import { effectPalette } from '../../src/effects/theme';

function emptyEngine() {
  let row = 0;
  return new GameEngine('FEEDBACK-UNIT', { next: () => ({ index: row++, distance: row * 100000, safeLane: 1, entities: [] }) });
}
function fixture(engine = emptyEngine()) {
  const source = new FeedbackEventSource(); const events: FeedbackEvent[] = [];
  source.reset(engine.view); engine.start();
  const step = (count = 1) => { for (let i = 0; i < count; i++) { engine.step(); source.observe(engine.view, (event) => events.push(event)); } };
  return { engine, source, events, step };
}

describe('actual fixed-step feedback facts', () => {
  it('collects each actual entity once with its world position and fixed time, without changing the score', () => {
    const { engine, source, events, step } = fixture(); step(240);
    const coins = events.filter((event) => event.type === 'coin');
    expect(coins).toHaveLength(6); expect(new Set(coins.map((event) => event.id)).size).toBe(6);
    expect(coins.map((event) => event.total)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const event of coins) { expect(event.time).toBe(event.tick * RULES.fixedDt); expect(event.position[1]).toBe(1.075); }
    source.observe(engine.view, (event) => events.push(event)); expect(events).toHaveLength(6);
    expect(engine.view.score).toBe(Math.floor(engine.view.distance) + 6 * 25);
  });
  it('emits one real takeoff and landing, rejected air input and animation timing do not trigger new events', () => {
    const { engine, events, step } = fixture(); engine.dispatch('jump'); step();
    engine.dispatch('jump'); engine.dispatch('slide'); step(113);
    expect(engine.view.player.y).toBe(0);
    expect(events.filter((event) => event.type === 'jump')).toHaveLength(1);
    const land = events.filter((event) => event.type === 'land'); expect(land).toHaveLength(1); expect(land[0]?.tick).toBe(114);
    expect(events.some((event) => event.type === 'slide')).toBe(false);
    step(60); expect(events.filter((event) => event.type === 'land')).toHaveLength(1);
  });
  it('reports accepted slide and symmetric lane changes, ignoring clamps and repeated held slide', () => {
    const { engine, events, step } = fixture();
    engine.dispatch('left'); engine.dispatch('slide'); step(); engine.dispatch('left'); engine.dispatch('slide'); step();
    engine.dispatch('right'); step();
    expect(events.filter((event) => event.type === 'lane').map((event) => event.direction)).toEqual([-1, 1]);
    expect(events.filter((event) => event.type === 'slide')).toHaveLength(1);
    step(90); expect(engine.view.player.slideRemaining).toBe(0);
  });
  it('emits collision and game over on the original death tick once, with no delayed death', () => {
    let row = 0;
    const engine = new GameEngine('hit', { next: () => ({ index: row++, distance: row * 20, safeLane: 0, entities: [{ id: `block-${row}`, kind: 'block', lane: 1, distance: row * 20, collected: false }] }) });
    const f = fixture(engine); f.step(200);
    const hit = f.events.find((event) => event.type === 'collision'); const over = f.events.find((event) => event.type === 'game-over');
    expect(engine.view.status).toBe('over'); expect(hit?.tick).toBe(engine.view.tick); expect(over?.tick).toBe(hit?.tick);
    expect(f.events.filter((event) => event.type === 'collision')).toHaveLength(1);
    f.step(120); expect(engine.view.tick).toBe(hit?.tick);
  });
  it('pause and quiet seeks do not replay missed events; restart gives a new identity', () => {
    const { engine, source, events, step } = fixture(); engine.dispatch('jump'); step(10);
    engine.pause(); const count = events.length; step(120); expect(events).toHaveLength(count);
    engine.resume(); step(104); expect(events.filter((event) => event.type === 'land')).toHaveLength(1);
    for (let i = 0; i < 400; i++) { engine.step(); source.observe(engine.view, (event) => events.push(event), true); }
    const n = events.length; step(); expect(events).toHaveLength(n);
    const next = emptyEngine(); source.reset(next.view); next.start(); next.dispatch('jump'); next.step(); source.observe(next.view, (event) => events.push(event));
    expect(events.at(-1)?.runId).not.toBe(events[0]?.runId);
  });
  it('reaches actual 18/20/22m/s milestones once and preserves exact complete engine state', () => {
    const a = fixture(); const b = emptyEngine(); b.start();
    for (let i = 0; i < 16000; i++) { a.step(); b.step(); }
    expect(a.events.filter((event) => event.type === 'speed').map((event) => event.speed)).toEqual([18, 20, 22]);
    expect(a.engine.view).toEqual(b.view); expect(a.engine.view.speed).toBe(24);
  });
  it('effects use the same continuous city transition, with unchanged coin identity', () => {
    expect(effectPalette(599).neon).toBe(0); expect(effectPalette(600).neon).toBe(0);
    expect(effectPalette(630).neon).toBeCloseTo(.5); expect(effectPalette(660).neon).toBe(1);
    expect(effectPalette(1200).neon).toBe(1); expect(effectPalette(1260).neon).toBe(0);
    expect(effectPalette(95).coin[0]).toBe(effectPalette(780).coin[0]);
  });
});
