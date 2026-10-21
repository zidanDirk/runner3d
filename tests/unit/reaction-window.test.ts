import { describe, expect, it } from 'vitest';
import { RULES, SHAPES } from '../../src/game/config';
import { advancePlayer, initialPlayer } from '../../src/game/motion';
import { actionLeadSeconds, analyzeReactionWindow, REACTION_ASSUMPTIONS, validateReactionAssumptions } from '../../src/game/reaction';

describe('reaction budgets use actual fixed-step actuation and explicit human assumptions', () => {
  it('uses the real jump kernel to find the first clearance tick', () => {
    const player = initialPlayer(); const ticks = Math.round(actionLeadSeconds('jump') / RULES.fixedDt);
    for (let tick = 1; tick < ticks; tick++) advancePlayer(player, tick === 1 ? ['jump'] : []);
    expect(player.y).toBeLessThan(SHAPES.hurdle.height);
    advancePlayer(player, []); expect(player.y).toBeGreaterThanOrEqual(SHAPES.hurdle.height);
  });
  it('budgets one or two complete lane transitions and one slide tick', () => {
    expect(actionLeadSeconds('lane')).toBe(RULES.laneChangeDuration);
    expect(actionLeadSeconds('lane', 2)).toBe(2 * RULES.laneChangeDuration);
    expect(actionLeadSeconds('slide')).toBe(RULES.fixedDt);
    expect(() => actionLeadSeconds('lane', 3)).toThrow();
  });
  it('subtracts collision entry, actuation, latency and preparation before reaction', () => {
    const actual = analyzeReactionWindow({ visibleDistance: 26, speed: 24, kind: 'block', action: 'lane' });
    expect(actual.timeToContactSeconds).toBeCloseTo(25 / 24);
    expect(actual.decisionWindowSeconds).toBeCloseTo(25 / 24 - .18 - .08 - .05);
    expect(actual.slackSeconds).toBeCloseTo(actual.decisionWindowSeconds - .35);
    expect(actual.sufficient).toBe(true);
  });
  it('reveals too-close fast approaches rather than changing collision geometry', () => {
    expect(analyzeReactionWindow({ visibleDistance: 8, speed: 24, kind: 'hurdle', action: 'jump' }).sufficient).toBe(false);
    expect(SHAPES.hurdle).toEqual({ width: 2, height: .85, depth: .9, bottom: 0 });
  });
  it('ranks sensitivity assumptions and bounds acceleration conservatively at maximum speed', () => {
    const input = { visibleDistance: 35, speed: 24, kind: 'block', action: 'lane', laneChanges: 2 } as const;
    const slow = analyzeReactionWindow({ ...input, assumptions: REACTION_ASSUMPTIONS.slow });
    const ordinary = analyzeReactionWindow({ ...input, assumptions: REACTION_ASSUMPTIONS.ordinary });
    const fast = analyzeReactionWindow({ ...input, assumptions: REACTION_ASSUMPTIONS.fast });
    expect(slow.slackSeconds).toBeLessThan(ordinary.slackSeconds); expect(ordinary.slackSeconds).toBeLessThan(fast.slackSeconds);
    expect(analyzeReactionWindow({ ...input, speed: 16 }).decisionWindowSeconds).toBeGreaterThan(ordinary.decisionWindowSeconds);
  });
  it('rejects missing/unknown assumptions and nonfinite, negative or excessive values', () => {
    for (const value of [NaN, Infinity, -1, 2.01]) expect(() => validateReactionAssumptions({ reactionSeconds: value, inputLatencySeconds: .08, preparationSeconds: .05 })).toThrow();
    const unknown = { ...REACTION_ASSUMPTIONS.ordinary, unknown: true };
    expect(() => validateReactionAssumptions(unknown)).toThrow();
    for (const visibleDistance of [-1, NaN, Infinity]) expect(() => analyzeReactionWindow({ visibleDistance, speed: 24, kind: 'gate', action: 'slide' })).toThrow();
    for (const speed of [0, -1, NaN, Infinity, 101]) expect(() => analyzeReactionWindow({ visibleDistance: 26, speed, kind: 'gate', action: 'slide' })).toThrow();
  });
});
