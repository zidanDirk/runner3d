import { describe, expect, it } from 'vitest';
import { GameEngine } from '../../src/game/engine';
import { RULES } from '../../src/game/config';
import { CharacterMotionFeedback } from '../../src/character/CharacterMotionFeedback';
import { CameraMotionController } from '../../src/scene/CameraMotionController';
import { calculateCameraFov, calculateRunAnimationSpeed, damp, landingEnvelope, runPhaseAtDistance } from '../../src/character/motionMath';
import { laneLean, jumpProgress, slideProgress } from '../../src/character/animationState';
import { MotionPreferences } from '../../src/runtime/motion-preferences';

describe('visual response math and preferences', () => {
  it('maps speed continuously with explicit bounds without changing gameplay', () => {
    expect(calculateRunAnimationSpeed(16)).toBe(1.08); expect(calculateRunAnimationSpeed(24)).toBe(1.5);
    expect(calculateRunAnimationSpeed(-100)).toBe(.85); expect(calculateRunAnimationSpeed(100)).toBe(1.55);
    expect(calculateRunAnimationSpeed(NaN)).toBe(1.08);
    expect(calculateRunAnimationSpeed(20.0001) - calculateRunAnimationSpeed(20)).toBeLessThan(.00001);
    expect(runPhaseAtDistance(0)).toBe(0); expect(runPhaseAtDistance(10000)).toBeGreaterThan(runPhaseAtDistance(9999));
  });
  it('exponential damping has the same response at 30, 60 and 144Hz', () => {
    const results = [30, 60, 144].map((hz) => { let value = 0; for (let i = 0; i < hz; i++) value = damp(value, 1, 12, 1 / hz); return value; });
    expect(results[0]).toBeCloseTo(results[1] ?? 0, 12); expect(results[1]).toBeCloseTo(results[2] ?? 0, 12);
    expect(damp(.5, 1, 12, 0)).toBe(.5);
  });
  it('landing feedback attacks and fully expires without negative scale', () => {
    expect(landingEnvelope(-.1)).toBe(0); expect(landingEnvelope(0)).toBe(0); expect(landingEnvelope(.025)).toBe(1);
    expect(landingEnvelope(.1)).toBeGreaterThan(0); expect(landingEnvelope(.22)).toBe(0); expect(landingEnvelope(1)).toBe(0);
  });
  it('maps FOV within readable bounds and removes dynamic FOV for reduced motion', () => {
    expect(calculateCameraFov(16)).toBe(51); expect(calculateCameraFov(24)).toBe(55);
    expect(calculateCameraFov(100)).toBe(55); expect(calculateCameraFov(-1)).toBe(51); expect(calculateCameraFov(24, true)).toBe(51);
  });
  it('honors OS preference, persistent override and subscription cleanup', () => {
    const saved: (boolean | null)[] = []; const p = new MotionPreferences((value) => saved.push(value)); let notifications = 0;
    const stop = p.subscribe(() => notifications++);
    p.setSystem(true); expect(p.getSnapshot()).toBe(true); p.set(false); p.setSystem(true); expect(p.getSnapshot()).toBe(false);
    p.set(null); expect(p.getSnapshot()).toBe(true); stop(); const count = notifications; p.setSystem(false); expect(notifications).toBe(count);
    expect(saved).toEqual([false, null]);
  });
});

describe('read-only motion feedback and camera lifecycle', () => {
  it('leans with lane velocity rather than snapping to maximum on input', () => {
    const left = new GameEngine('motion'); const right = new GameEngine('motion'); left.start(); right.start();
    const l = new CharacterMotionFeedback(); const r = new CharacterMotionFeedback(); l.update(left.view); r.update(right.view);
    left.dispatch('left'); right.dispatch('right'); let peak = 0;
    for (let i = 0; i < 80; i++) {
      left.step(); right.step(); l.update(left.view); r.update(right.view);
      expect(l.lean).toBeCloseTo(-r.lean, 10); expect(Math.abs(l.lean)).toBeLessThanOrEqual(Math.PI / 16);
      peak = Math.max(peak, Math.abs(l.lean)); if (i === 0) expect(Math.abs(l.lean)).toBeLessThan(.02);
    }
    expect(peak).toBeGreaterThan(5 * Math.PI / 180); expect(Math.abs(l.lean)).toBeLessThan(.000001); expect(laneLean(left.view)).toBe(0);
  });
  it('buffers the real landing, freezes on pause and cancels on another jump', () => {
    const e = new GameEngine('land-motion'); const f = new CharacterMotionFeedback(); e.start(); f.update(e.view); e.dispatch('jump');
    e.step(); f.update(e.view); expect(jumpProgress(e.view)).toBeGreaterThan(0);
    while (e.view.player.y > 0) { e.step(); f.update(e.view); }
    for (let i = 0; i < 3; i++) { e.step(); f.update(e.view); }
    expect(f.landing).toBeCloseTo(1); expect(f.scaleY).toBeCloseTo(.978); expect(e.view.player.y).toBe(0);
    e.pause(); const before = [f.lean, f.landing, f.scaleY]; for (let i = 0; i < 90; i++) f.update(e.view);
    expect([f.lean, f.landing, f.scaleY]).toEqual(before);
    e.resume(); e.dispatch('jump'); e.step(); f.update(e.view); expect(f.scaleY).toBe(1); expect(f.landing).toBe(0);
  });
  it('keeps slide timing physical and reduced motion removes impact scaling', () => {
    const e = new GameEngine('slide-motion'); e.start(); const f = new CharacterMotionFeedback(); f.update(e.view); e.dispatch('slide');
    for (let i = 0; i < 20; i++) { e.step(); f.update(e.view, true); }
    expect(slideProgress(e.view)).toBeCloseTo(20 / 90); expect(f.scaleY).toBe(1);
    e.dispatch('left'); for (let i = 0; i < 10; i++) { e.step(); f.update(e.view, true); }
    expect(Math.abs(f.lean)).toBeLessThan(.07);
  });
  it('handles rapid opposite inputs without accumulating root offsets or rotation', () => {
    const e = new GameEngine('rapid-motion'); e.start(); const f = new CharacterMotionFeedback(); const c = new CameraMotionController(); f.update(e.view); c.update(e.view, false, false);
    for (let i = 0; i < 120; i++) {
      if (i % 12 === 0) e.dispatch(i % 24 === 0 ? 'left' : 'right');
      e.step(); const snapshot = JSON.stringify(e.view); f.update(e.view); c.update(e.view, false, false);
      expect(JSON.stringify(e.view)).toBe(snapshot); expect(Number.isFinite(f.lean)).toBe(true); expect(Math.abs(c.x)).toBeLessThan(.337); expect(f.scaleY).toBe(1);
    }
    const fresh = new GameEngine('restart-motion'); f.update(fresh.view); c.update(fresh.view, false, false);
    expect(f.lean).toBe(0); expect(f.scaleY).toBe(1); expect(c.x).toBe(0); expect(c.fov).toBe(51);
  });
  it('camera lags lightly, freezes paused and handles narrow/reduced-motion modes', () => {
    const e = new GameEngine('camera-motion'); e.start(); const c = new CameraMotionController(); c.update(e.view, false, false); e.dispatch('left');
    for (let i = 0; i < 8; i++) { e.step(); c.update(e.view, false, false); }
    expect(c.x).toBeLessThan(0); expect(c.x).toBeGreaterThan(e.view.player.x * .12);
    e.pause(); const before = [c.x, c.y, c.z, c.fov]; for (let i = 0; i < 90; i++) c.update(e.view, false, false); expect([c.x, c.y, c.z, c.fov]).toEqual(before);
    c.update(e.view, true, true); expect(c.x).toBe(0); expect(c.fov).toBe(51); expect(c.y).toBe(10); expect(c.z).toBe(18);
  });
  it('fixed visual substeps give stable feedback and camera under render batching', () => {
    const simulate = (batch: number) => {
      const e = new GameEngine('batch-motion'); e.start(); const f = new CharacterMotionFeedback(); const c = new CameraMotionController(); f.update(e.view); c.update(e.view, false, false); e.dispatch('left');
      for (let i = 1; i <= 24; i++) { e.step(); if (i % batch === 0) { f.update(e.view); c.update(e.view, false, false); } }
      return [f.lean, f.scaleY, c.x, c.fov];
    };
    const reference = simulate(1);
    // FOV reads linearly reconstructed speed between render observations;
    // tolerate <0.00005 degree while lane easing is reconstructed exactly.
    for (const batch of [2, 4, 8]) simulate(batch).forEach((value, i) => expect(value).toBeCloseTo(reference[i] ?? 0, i === 3 ? 4 : 10));
    expect(RULES.fixedDt).toBe(1 / 120);
  });
});
