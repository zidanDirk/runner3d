import { describe, expect, it } from 'vitest';
import { EffectManager } from '../../src/effects/EffectManager';
import { EFFECTS } from '../../src/effects/effectConfig';
import { ParticleSystem, type ParticleSpawn } from '../../src/effects/ParticleSystem';
import type { EffectPalette, FeedbackEvent } from '../../src/feedback/types';

const dusk: EffectPalette = { coin: [1, .65, .08], dust: [.24, .3, .4], impact: [1, .35, .15], trail: [.4, .65, 1], neon: 0 };
const neon: EffectPalette = { coin: dusk.coin, dust: [.18, .12, .42], impact: [.6, .3, 1], trail: [.2, .5, 1], neon: 1 };
const standing = { x: 0, y: 0, slideRemaining: 0 };

function event(type: FeedbackEvent['type'], id: string = type): FeedbackEvent {
  const common = { id, runId: 1, tick: 1, time: 1 / 120, distance: 0, position: [0, .8, 0] as const, intensity: 1 };
  switch (type) {
    case 'coin': return { ...common, type, entityId: 'coin-1', total: 1 };
    case 'slide': return { ...common, type, duration: .75, position: [0, 0, 0] };
    case 'lane': return { ...common, type, direction: -1, duration: .18 };
    case 'collision': return { ...common, type, obstacle: 'hurdle' };
    case 'speed': return { ...common, type, speed: 20 };
    case 'jump': case 'land': return { ...common, type, position: [0, 0, 0] };
    case 'powerup-collected': case 'powerup-activated': case 'powerup-expired': case 'shield-broken': return { ...common, type, powerup: 'shield', entityId: 'probe' };
    case 'upgrade-purchased': case 'mission-completed': case 'mission-reward-claimed':
    case 'game-over': return { ...common, type };
  }
}

function particle(): ParticleSpawn {
  return { x: 1, y: 2, z: -3, vx: .5, vy: 1, vz: 2, size: .1, life: .4, gravity: 3,
    r: 1, g: .5, b: .1, group: 1, stretch: 1 };
}

function liveValues(pool: ParticleSystem): number[][] {
  const values: number[][] = [];
  for (let i = 0; i < pool.capacity; i++) if (pool.alive[i]) {
    values.push([pool.x[i] ?? 0, pool.y[i] ?? 0, pool.z[i] ?? 0, pool.size[i] ?? 0,
      pool.r[i] ?? 0, pool.g[i] ?? 0, pool.b[i] ?? 0, pool.stretch[i] ?? 0]);
  }
  return values.sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0));
}

describe('fixed analytic particle pool', () => {
  it('enforces a hard capacity and reuses the same typed arrays/slots after decay', () => {
    const pool = new ParticleSystem(8); const p = particle(); const arrays = [pool.alive, pool.x, pool.y, pool.z, pool.size, pool.r, pool.g, pool.b];
    for (let i = 0; i < 8; i++) expect(pool.spawn(p)).toBe(true);
    expect(pool.spawn(p)).toBe(false); expect(pool.count).toBe(8); expect(pool.available).toBe(0); expect(pool.peak).toBe(8);
    pool.advance(.4, 6.4); expect(pool.count).toBe(0); expect(pool.available).toBe(8);
    for (let i = 0; i < 8; i++) expect(pool.spawn(p)).toBe(true);
    expect([pool.alive, pool.x, pool.y, pool.z, pool.size, pool.r, pool.g, pool.b]).toEqual(arrays);
    expect(pool.peak).toBe(8); expect(() => new ParticleSystem(193)).toThrow(); expect(() => new ParticleSystem(.5)).toThrow();
  });

  it('shrinks and deposits particles in world coordinates with analytic gravity', () => {
    const pool = new ParticleSystem(); pool.reset(100); pool.spawn(particle()); pool.advance(.2, 103.2);
    expect(pool.x[0]).toBeCloseTo(1.1); expect(pool.y[0]).toBeCloseTo(2.14);
    expect(pool.z[0]).toBeCloseTo(.6); expect(pool.size[0]).toBeGreaterThan(0); expect(pool.size[0]).toBeLessThan(.1);
    expect(pool.alpha[0]).toBeGreaterThan(0); expect(pool.alpha[0]).toBeLessThan(1);
  });

  it('has the same sampled trajectory under different dt partitions and rejects invalid inputs', () => {
    const one = new ParticleSystem(); const many = new ParticleSystem(); one.spawn(particle()); many.spawn(particle());
    one.advance(.3, 4.8); for (let i = 1; i <= 36; i++) many.advance(1 / 120, i / 120 * 16);
    expect(liveValues(one)).toEqual(liveValues(many));
    const bad = particle(); bad.vx = NaN; expect(one.spawn(bad)).toBe(false);
    one.advance(NaN, 0); one.advance(-1, 0); one.advance(0, 0); expect(one.time).toBe(.3);
    expect(one.spawn(particle(), 100)).toBe(false);
  });

  it('counts only live groups and resets all visible data without reallocating', () => {
    const pool = new ParticleSystem(); const p = particle(); pool.spawn(p); p.group = 2; pool.spawn(p); pool.spawn(p);
    expect(pool.activeGroups()).toBe(2); const x = pool.x; pool.reset(42);
    expect(pool.x).toBe(x); expect(pool.time).toBe(0); expect(pool.distance).toBe(42);
    expect(pool.count).toBe(0); expect(pool.peak).toBe(0); expect(pool.activeGroups()).toBe(0);
    expect(Array.from(pool.x)).toEqual(new Array<number>(pool.capacity).fill(0));
  });
});

describe('single visual feedback manager', () => {
  it('produces deterministic coin bursts, merges the pulse and deduplicates repeated events', () => {
    const a = new EffectManager('gold'); const b = new EffectManager('gold'); const c = new EffectManager('other');
    const coin = Object.freeze(event('coin')); a.handle(coin, dusk, false); b.handle(coin, dusk, false); c.handle(coin, dusk, false);
    expect(a.particles.count).toBe(9); expect(a.coinPulse).toBe(1); expect(liveValues(a.particles)).toEqual(liveValues(b.particles));
    expect(liveValues(a.particles)).not.toEqual(liveValues(c.particles));
    a.handle(coin, dusk, false); expect(a.particles.count).toBe(9);
    a.advance(.1, 1.6, standing, 16, false, dusk); expect(a.coinPulse).toBeCloseTo(.5);
    a.handle(event('coin', 'second'), dusk, false); expect(a.coinPulse).toBe(1); expect(a.particles.count).toBe(18);
    a.advance(.41, 8.16, standing, 16, false, dusk); expect(a.coinPulse).toBe(0); expect(a.particles.count).toBe(0);
  });

  it('emits dust on true jump/land facts but never emits continuous airborne dust', () => {
    const f = new EffectManager('feet'); f.handle(event('jump'), dusk, false); expect(f.particles.count).toBe(6);
    f.advance(.31, 4.96, { x: 0, y: 2, slideRemaining: 0 }, 16, false, dusk); expect(f.particles.count).toBe(0);
    f.handle(event('land'), dusk, false); expect(f.particles.count).toBe(8);
    f.handle(event('land'), dusk, false); expect(f.particles.count).toBe(8);
  });

  it('rejects old ordered facts even after their IDs have left the bounded dedup ring', () => {
    const f = new EffectManager(); const original = event('coin', 'original'); f.handle(original, dusk, false);
    for (let tick = 2; tick <= 300; tick++) f.handle({ ...event('lane', `lane-${tick}`), tick }, dusk, false);
    expect(f.stats().rememberedEvents).toBe(128); f.advance(.5, 8, standing, 16, false, dusk);
    f.handle(original, dusk, false); expect(f.particles.count).toBe(0); expect(f.coinPulse).toBe(0);
    f.reset('again'); f.handle(original, dusk, false); expect(f.particles.count).toBe(9);
  });

  it('uses a fixed slide emission schedule and stops from actual remaining time', () => {
    const f = new EffectManager('slide'); f.handle(event('slide'), dusk, false); expect(f.particles.count).toBe(3);
    for (let tick = 1; tick <= 90; tick++) f.advance(1 / 120, tick * 16 / 120,
      { x: 0, y: 0, slideRemaining: Math.max(0, .75 - tick / 120) }, 16, false, dusk);
    expect(f.particles.count).toBeGreaterThan(0); expect(f.particles.peak).toBeLessThanOrEqual(12);
    f.advance(.4, 18.4, standing, 16, false, dusk); expect(f.particles.count).toBe(0);
    f.advance(2, 50.4, standing, 16, false, dusk); expect(f.particles.count).toBe(0);
  });

  it('has equivalent scheduled slide sampling when observations are batched', () => {
    const a = new EffectManager('partition'); const b = new EffectManager('partition'); a.handle(event('slide'), dusk, false); b.handle(event('slide'), dusk, false);
    a.advance(.24, 3.84, { x: 1, y: 0, slideRemaining: .51 }, 16, false, dusk);
    for (let i = 1; i <= 24; i++) b.advance(.01, i * .16, { x: i / 24, y: 0, slideRemaining: .75 - i * .01 }, 16, false, dusk);
    const av = liveValues(a.particles); const bv = liveValues(b.particles); expect(av.length).toBe(bv.length);
    av.forEach((row, i) => row.forEach((value, j) => expect(value).toBeCloseTo(bv[i]?.[j] ?? NaN, 6)));
  });

  it('retains lean/camera lane feedback without adding asymmetric or queued particles', () => {
    const left = new EffectManager(); const right = new EffectManager(); const l = event('lane');
    if (l.type !== 'lane') throw new Error('lane fixture');
    left.handle(l, dusk, false); right.handle({ ...l, direction: 1 }, dusk, false);
    expect(left.stats()).toEqual(right.stats()); expect(left.particles.count).toBe(0);
  });

  it('allows one collision pulse to render after death and expires it without moving gameplay', () => {
    const f = new EffectManager(); const hit = event('collision'); f.handle(hit, dusk, false); f.handle(event('game-over'), dusk, false);
    expect(f.particles.count).toBe(14); expect(f.hitPulse).toBe(1);
    f.handle(event('collision', 'another-duplicate-hit'), dusk, false); expect(f.particles.count).toBe(14);
    const player = Object.freeze({ ...standing }); f.advance(.2, 0, player, 24, false, dusk);
    expect(f.particles.count).toBe(14); expect(f.hitPulse).toBeGreaterThan(0);
    f.advance(.3, 0, player, 24, false, dusk); expect(f.particles.count).toBe(0); expect(f.hitPulse).toBe(0);
    expect(player).toEqual(standing);
    const onlyOver = new EffectManager(); onlyOver.handle(event('game-over'), dusk, false);
    onlyOver.advance(.5, 0, standing, 24, false, dusk); expect(onlyOver.particles.count).toBe(0);
  });

  it('shows one speed notice and only sparse edge trails above the reachable threshold', () => {
    const f = new EffectManager('fast'); f.advance(.4, 8, standing, 20, false, dusk); expect(f.particles.count).toBe(0);
    f.handle(event('speed'), dusk, false); expect(f.speedNotice).toBe(1);
    f.advance(.2, 12.4, standing, 22, false, dusk); expect(f.particles.count).toBe(2);
    for (let i = 0; i < f.particles.capacity; i++) if (f.particles.alive[i]) {
      expect(Math.abs(f.particles.x[i] ?? 0)).toBeCloseTo(4.3); expect(f.particles.y[i]).toBeCloseTo(.2);
      expect(f.particles.stretch[i]).toBe(12); expect(f.particles.z[i]).toBeLessThan(-5);
    }
    f.advance(2, 44.4, standing, 16, false, dusk); expect(f.speedNotice).toBe(0); expect(f.particles.count).toBe(0);
  });

  it('reduces local bursts to 25–35% and disables nonessential fast trails', () => {
    for (const kind of ['coin', 'jump', 'land', 'slide', 'collision'] as const) {
      const normal = new EffectManager(); const reduced = new EffectManager();
      normal.handle(event(kind), dusk, false); reduced.handle(event(kind), dusk, true);
      expect(reduced.particles.count / normal.particles.count).toBeGreaterThanOrEqual(.25);
      expect(reduced.particles.count / normal.particles.count).toBeLessThanOrEqual(.35);
    }
    const f = new EffectManager(); f.handle(event('coin'), dusk, true); expect(f.coinPulse).toBe(1);
    f.advance(.5, 12, standing, 24, true, dusk); expect(f.particles.count).toBe(0);
  });

  it('takes theme colors at birth while old deposits keep their original color', () => {
    const f = new EffectManager('colors'); f.handle(event('land', 'dusk'), dusk, false);
    const oldRed = f.particles.r[0]; f.handle(event('land', 'neon'), neon, false);
    expect(f.particles.r[0]).toBe(oldRed); expect(f.particles.r[8]).toBeCloseTo(neon.dust[0]);
    expect(f.particles.b[8]).toBeCloseTo(neon.dust[2]);
    const gold = new EffectManager(); gold.handle(event('coin'), neon, false); expect(gold.particles.r[0]).toBe(1);
  });

  it('freezes completely when callers pause and resets particles, schedules, pulses and dedup on retry', () => {
    const f = new EffectManager('retry'); f.handle(event('slide'), dusk, false); f.handle(event('coin'), dusk, false);
    const values = liveValues(f.particles); const stats = f.stats();
    for (let i = 0; i < 120; i++) { f.stats(); f.advance(0, 0, standing, 16, false, dusk); }
    expect(liveValues(f.particles)).toEqual(values); expect(f.stats()).toEqual(stats); expect(f.time).toBe(0);
    f.advance(.1, 1.6, { x: 0, y: 0, slideRemaining: .65 }, 16, false, dusk); expect(f.time).toBe(.1);
    f.reset('retry', 100); expect(f.particles.count).toBe(0); expect(f.coinPulse).toBe(0); expect(f.hitPulse).toBe(0); expect(f.speedNotice).toBe(0);
    expect(f.stats().rememberedEvents).toBe(0); f.handle({ ...event('coin'), distance: 100 }, dusk, false); expect(f.particles.count).toBe(9);
    f.advance(.5, 108, standing, 16, false, dusk); expect(f.particles.count).toBe(0);
  });

  it('stays bounded under 10,000 mixed facts, theme changes and repeated resets', () => {
    const f = new EffectManager('stress'); const arrays = [f.particles.x, f.particles.y, f.particles.z, f.particles.size];
    const kinds = ['coin', 'jump', 'land', 'slide', 'lane', 'collision', 'game-over', 'speed'] as const;
    let distance = 0;
    for (let i = 0; i < 10000; i++) {
      if (i % 200 === 0) f.reset(`run-${i}`, distance);
      const kind = kinds[i % kinds.length]; if (kind === undefined) throw new Error('stress fixture');
      const palette = i % 2 === 0 ? dusk : neon;
      f.handle({ ...event(kind, `event-${i}`), distance }, palette, i % 3 === 0);
      distance += 16 / 120; f.advance(1 / 120, distance, standing, 16, false, palette);
      expect(f.particles.count).toBeLessThanOrEqual(EFFECTS.capacity);
      expect(f.stats().activeEffects).toBeLessThanOrEqual(EFFECTS.capacity); expect(f.stats().rememberedEvents).toBeLessThanOrEqual(128);
    }
    f.advance(2, distance, standing, 16, false, dusk); expect(f.particles.count).toBe(0); expect(f.stats().activeEffects).toBe(0);
    expect([f.particles.x, f.particles.y, f.particles.z, f.particles.size]).toEqual(arrays);
    expect(Array.from(f.particles.x).every(Number.isFinite)).toBe(true);
  });
});
