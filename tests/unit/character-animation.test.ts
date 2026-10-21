import { describe, expect, it } from 'vitest';
import { AnimationClip, Bone, Group, Quaternion, QuaternionKeyframeTrack, Vector3, VectorKeyframeTrack } from 'three';
import { CharacterAnimationController } from '../../src/character/CharacterAnimationController';
import { ANIMATION_NAMES } from '../../src/character/animationConfig';
import { animationState, JUMP_FLIGHT_SECONDS, jumpProgress, laneLean, runTimeScale, slideProgress } from '../../src/character/animationState';
import { GameEngine } from '../../src/game/engine';
import { RULES } from '../../src/game/config';
import type { GameView } from '../../src/game/types';

function fixture() {
  const root = new Group(); const hips = new Bone(); hips.name = 'Hips'; hips.position.y = 1; root.add(hips);
  const left = new Bone(); left.name = 'LeftUpperLeg'; hips.add(left);
  const right = new Bone(); right.name = 'RightUpperLeg'; hips.add(right);
  const axis = new Vector3(1, 0, 0);
  const angles = (name: string, values: number[]) => new QuaternionKeyframeTrack(`${name}.quaternion`, [0, .36, .72], values.flatMap((value) => new Quaternion().setFromAxisAngle(axis, value).toArray()));
  const clips = [new AnimationClip('Idle', 2, [new VectorKeyframeTrack('Hips.position', [0, 1, 2], [0, 1, 0, 0, 1.02, 0, 0, 1, 0])]),
    new AnimationClip('Run', .72, [angles(left.name, [-.5, .5, -.5]), angles(right.name, [.5, -.5, .5])]),
    new AnimationClip('Jump', .95, [new VectorKeyframeTrack('Hips.position', [0, .475, .95], [0, 1, 0, 0, .95, 0, 0, 1, 0])]),
    new AnimationClip('Slide', .75, [new VectorKeyframeTrack('Hips.position', [0, .375, .75], [0, .3, 0, 0, .3, 0, 0, .3, 0])])];
  root.updateMatrixWorld(true);
  return { root, hips, left, right, clips };
}
function ticks(engine: GameEngine, controller: CharacterAnimationController, count: number) {
  for (let i = 0; i < count; i++) { engine.step(); controller.updateGame(engine.view, RULES.fixedDt); }
}

describe('authoritative animation state and time mapping', () => {
  it('prioritizes ready, airborne, slide then run without modifying gameplay data', () => {
    const e = new GameEngine('animations'); expect(animationState(e.view)).toBe('idle');
    e.start(); expect(animationState(e.view)).toBe('run');
    const simultaneous: GameView = { ...e.view, player: { ...e.view.player, y: .5, velocityY: 2, slideRemaining: .4 } };
    expect(animationState(simultaneous)).toBe('jump');
    expect(animationState({ ...simultaneous, player: { ...simultaneous.player, y: 0, velocityY: 0 } })).toBe('slide');
  });
  it('maps Jump progress from actual fixed-step velocity through the real landing tick', () => {
    const e = new GameEngine('jump'); e.start(); e.dispatch('jump'); let prior = -1; let airborneTicks = 0;
    do { e.step(); if (e.view.player.y > 0) { const progress = jumpProgress(e.view); expect(progress).toBeGreaterThan(prior); expect(progress).toBeLessThan(1); prior = progress; airborneTicks++; } } while (e.view.player.y > 0);
    expect(JUMP_FLIGHT_SECONDS).toBeCloseTo(.95, 6); expect((airborneTicks + 1) * RULES.fixedDt).toBeCloseTo(JUMP_FLIGHT_SECONDS, 6);
  });
  it('maps slide remaining time, clamps step frequency and produces symmetric bounded lean', () => {
    const e = new GameEngine('slide'); e.start(); e.dispatch('slide'); e.step();
    expect(slideProgress(e.view)).toBeCloseTo(RULES.fixedDt / RULES.slideDuration, 5);
    expect(runTimeScale(RULES.baseSpeed)).toBe(1.08); expect(runTimeScale(RULES.maxSpeed)).toBe(1.5);
    expect(runTimeScale(0)).toBe(.85); expect(runTimeScale(100)).toBe(1.55);
    const left = new GameEngine('lean'); left.start(); left.dispatch('left'); left.step();
    const right = new GameEngine('lean'); right.start(); right.dispatch('right'); right.step();
    expect(laneLean(left.view)).toBeCloseTo(-laneLean(right.view), 8); expect(Math.abs(laneLean(left.view))).toBeLessThan(Math.PI / 15);
    for (let i = 0; i < 40; i++) { left.step(); right.step(); }
    expect(laneLean(left.view)).toBe(0); expect(laneLean(right.view)).toBe(0);
  });
});

describe('cached AnimationMixer transitions and lifecycle', () => {
  it('requires all four real clip names and tracks instead of accepting an animations array', () => {
    const f = fixture();
    for (const state of Object.keys(ANIMATION_NAMES)) expect(() => new CharacterAnimationController(f.root, f.clips.filter((clip) => clip.name !== ANIMATION_NAMES[state as keyof typeof ANIMATION_NAMES]))).toThrow(/缺少有效/);
  });
  it('crossfades Run/Jump/Run and Run/Slide/Run with normalized interrupted weights', () => {
    const f = fixture(); const c = new CharacterAnimationController(f.root, f.clips); const e = new GameEngine('controller');
    c.updateGame(e.view, 0); e.start(); ticks(e, c, 2); expect(c.diagnostics().state).toBe('run');
    e.dispatch('jump'); ticks(e, c, 1); expect(c.diagnostics().state).toBe('jump');
    expect(c.diagnostics().weights.run).toBeGreaterThan(0); expect(c.diagnostics().weights.jump).toBeGreaterThan(0);
    ticks(e, c, 115); expect(c.diagnostics().state).toBe('run');
    e.dispatch('slide'); ticks(e, c, 1); expect(c.diagnostics().state).toBe('slide');
    for (let i = 0; i < 120; i++) { ticks(e, c, 1); expect(Object.values(c.diagnostics().weights).reduce((sum, n) => sum + n, 0)).toBeCloseTo(1, 8); }
    expect(c.diagnostics().state).toBe('run'); expect(c.diagnostics().weights.slide).toBe(0);
    c.dispose();
  });
  it('freezes the actual bone pose while paused and resumes without advancing a second clock', () => {
    const f = fixture(); const c = new CharacterAnimationController(f.root, f.clips); const e = new GameEngine('pause'); e.start(); ticks(e, c, 20);
    e.pause(); c.updateGame(e.view, .1); const pose = f.left.quaternion.toArray(); const time = c.diagnostics().time;
    for (let i = 0; i < 60; i++) c.updateGame(e.view, .1);
    expect(f.left.quaternion.toArray()).toEqual(pose); expect(c.diagnostics().time).toBe(time);
    e.resume(); ticks(e, c, 6); expect(c.diagnostics().time).not.toBe(time); expect(f.left.quaternion.toArray()).not.toEqual(pose);
    c.dispose();
  });
  it('keeps the mixer/actions on restart, resets pose and supports exact preview time/replay/disposal', () => {
    const f = fixture(); const c = new CharacterAnimationController(f.root, f.clips); const e = new GameEngine('restart'); e.start(); ticks(e, c, 20);
    const mixer = c.mixer; const actions = c.actions;
    c.updateGame(new GameEngine('restart').view, 0);
    expect(c.diagnostics().state).toBe('idle'); expect(c.diagnostics().weights.idle).toBe(1); expect(c.diagnostics().time).toBe(0);
    c.samplePreview('run', .18); const left = f.left.quaternion.toArray(); c.samplePreview('run', .54);
    expect(f.left.quaternion.toArray()).not.toEqual(left);
    c.playPreview('run', .1, 1.5, false); expect(c.diagnostics().time).toBe(.54);
    c.samplePreview('run', 0); c.playPreview('run', .1, 1.5, true); expect(c.diagnostics().time).toBeCloseTo(.15, 6);
    expect(c.mixer).toBe(mixer); expect(c.actions).toBe(actions); expect(c.diagnostics().actionCount).toBe(4);
    c.dispose(); c.dispose(); const time = c.diagnostics().time; c.playPreview('run', 1, 1, true); expect(c.diagnostics().time).toBe(time);
  });
  it('runs the real engine for 10km with one mixer and four cached actions across inputs and restart', () => {
    const f = fixture(); const c = new CharacterAnimationController(f.root, f.clips); const e = new GameEngine('long-animation'); e.start();
    const mixer = c.mixer; const actions = c.actions; let jumps = 0; let slides = 0;
    while (e.view.distance < 10000 && e.view.status === 'running') {
      const s = e.view; const row = s.rows.find((candidate) => candidate.distance >= s.distance - 2);
      if (row && row.safeLane !== s.player.lane) e.dispatch(row.safeLane < s.player.lane ? 'left' : 'right');
      if (s.tick % 480 === 0 && s.player.y === 0) { e.dispatch('jump'); jumps++; }
      if (s.tick % 480 === 240 && s.player.y === 0) { e.dispatch('slide'); slides++; }
      e.step();
      if (e.view.tick % 6 === 0) {
        c.updateGame(e.view, .05); const info = c.diagnostics();
        expect(Number.isFinite(info.time)).toBe(true); expect(Object.values(info.weights).reduce((sum, n) => sum + n, 0)).toBeCloseTo(1, 7);
      }
    }
    expect(e.view.status).toBe('running'); expect(e.view.distance).toBeGreaterThanOrEqual(10000); expect(jumps).toBeGreaterThan(20); expect(slides).toBeGreaterThan(20);
    expect(c.mixer).toBe(mixer); expect(c.actions).toBe(actions); expect(c.diagnostics().actionCount).toBe(4);
    c.updateGame(new GameEngine('long-animation').view, 0); expect(c.diagnostics().state).toBe('idle'); c.dispose();
  }, 20000);
  it('integrates the same smoothed cadence and phase at 24, 30, 60 and 120Hz', () => {
    const simulate = (batch: number) => {
      const f = fixture(); const c = new CharacterAnimationController(f.root, f.clips); const e = new GameEngine('cadence'); e.start();
      const view = { ...e.view, player: { ...e.view.player }, rows: [], entities: [] };
      c.updateGame(view, 0);
      for (let tick = batch; tick <= 120; tick += batch) { view.tick = tick; view.speed = 16 + 8 * tick / 120; c.updateGame(view, batch / 120); }
      const result = c.diagnostics(); c.dispose(); return result;
    };
    const reference = simulate(1);
    for (const batch of [2, 4, 5]) {
      expect(simulate(batch).runScale).toBeCloseTo(reference.runScale, 10);
      expect(simulate(batch).time).toBeCloseTo(reference.time, 10);
    }
    expect(reference.runScale).toBeGreaterThan(1.4); expect(reference.runScale).toBeLessThan(1.5);
  });
  it('cadence smoothing changes the sampled phase rather than only the action label', () => {
    const f = fixture(); const c = new CharacterAnimationController(f.root, f.clips); const e = new GameEngine('rate'); e.start();
    const view = { ...e.view, player: { ...e.view.player }, rows: [], entities: [] }; c.updateGame(view, 0);
    view.speed = 24; view.tick = 1; c.updateGame(view, RULES.fixedDt);
    expect(c.diagnostics().runScale).toBeGreaterThan(1.08); expect(c.diagnostics().runScale).toBeLessThan(1.5);
    expect(c.diagnostics().time).toBeGreaterThan(1.08 * RULES.fixedDt); expect(c.diagnostics().time).toBeLessThan(1.5 * RULES.fixedDt);
    c.dispose();
  });
});
