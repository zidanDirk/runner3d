import { AnimationMixer, LoopOnce, LoopRepeat } from 'three';
import type { AnimationAction, AnimationClip, Object3D } from 'three';
import type { GameView } from '../game/types';
import { RULES } from '../game/config';
import { ANIMATION_NAMES, ANIMATION_SETTINGS, ANIMATION_STATES } from './animationConfig';
import type { AnimationState } from './animationConfig';
import { animationState, clamp01, jumpProgress, runTimeScale, slideProgress } from './animationState';
import { MOTION } from './motionConfig';
import { runPhaseAtDistance, smoothStep } from './motionMath';

let nextMixerId = 0;
// Test-only lifecycle observation of real construction/disposal; no production hook.
const lifecycle = { created: 0, disposed: 0, active: 0 };
export interface AnimationDiagnostics {
  mixerId: number; actionCount: number; state: AnimationState; time: number; duration: number; runScale: number;
  weights: Record<AnimationState, number>; paused: boolean;
  cpu: { samples: number; meanMs: number; maxMs: number };
}

/** One mixer and four cached actions per skeleton clone. All phase sampling is visual. */
export class CharacterAnimationController {
  readonly mixer: AnimationMixer;
  readonly mixerId = ++nextMixerId;
  readonly actions: Readonly<Record<AnimationState, AnimationAction>>;
  private readonly weights = new Float64Array([1, 0, 0, 0]);
  private readonly blendFrom = new Float64Array([1, 0, 0, 0]);
  private state: AnimationState = 'idle';
  private blendElapsed = 1;
  private blendDuration: number = ANIMATION_SETTINGS.crossfade;
  private view: GameView | undefined;
  private lastTick = 0;
  private paused = false;
  private disposed = false;
  private cpuSamples = 0;
  private cpuSum = 0;
  private cpuMax = 0;
  private runPhase = 0;
  private filteredRunScale: number = MOTION.runBaseScale;
  private previousRunTarget: number = MOTION.runBaseScale;
  get blending(): boolean { return this.blendElapsed < this.blendDuration; }

  constructor(readonly root: Object3D, clips: readonly AnimationClip[], private readonly measure = false) {
    this.mixer = new AnimationMixer(root);
    const actions = {} as Record<AnimationState, AnimationAction>;
    for (const state of ANIMATION_STATES) {
      const matches = clips.filter((clip) => clip.name === ANIMATION_NAMES[state]);
      const clip = matches[0];
      if (matches.length !== 1 || !clip || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.tracks.length === 0) throw new Error(`City Runner 缺少有效的 ${ANIMATION_NAMES[state]} 动画`);
      const action = this.mixer.clipAction(clip);
      action.setLoop(state === 'idle' || state === 'run' ? LoopRepeat : LoopOnce, state === 'idle' || state === 'run' ? Infinity : 1);
      action.clampWhenFinished = true;
      action.setEffectiveWeight(state === 'idle' ? 1 : 0).play();
      actions[state] = action;
    }
    this.actions = actions;
    this.sample('idle', 0);
    if (import.meta.env.MODE === 'e2e') {
      lifecycle.created++; lifecycle.active++;
      window.__PRODUCT_LIFECYCLE__ = () => ({ mixers: { ...lifecycle } });
    }
  }

  private transition(next: AnimationState, immediate = false): void {
    if (next === this.state && !immediate) return;
    this.blendFrom.set(this.weights);
    const previous = this.state;
    this.state = next;
    this.blendElapsed = 0;
    this.blendDuration = next === 'slide' ? ANIMATION_SETTINGS.slideEntryFade
      : next === 'jump' ? ANIMATION_SETTINGS.jumpEntryFade
      : next === 'run' && previous === 'slide' ? ANIMATION_SETTINGS.slideRecoveryFade
      : next === 'run' && previous === 'jump' ? ANIMATION_SETTINGS.landingFade : ANIMATION_SETTINGS.crossfade;
    this.actions[next].reset().play();
    if (immediate) {
      for (let i = 0; i < ANIMATION_STATES.length; i++) this.weights[i] = ANIMATION_STATES[i] === next ? 1 : 0;
      this.blendFrom.set(this.weights);
      this.blendElapsed = this.blendDuration;
    }
  }

  private blend(dt: number): void {
    this.blendElapsed += dt;
    const t = smoothStep(clamp01(this.blendElapsed / this.blendDuration));
    // Fade from the current normalized weights, including interrupted transitions.
    for (let i = 0; i < ANIMATION_STATES.length; i++) {
      const state = ANIMATION_STATES[i];
      if (!state) continue;
      const weight = (this.blendFrom[i] ?? 0) * (1 - t) + (state === this.state ? t : 0);
      this.weights[i] = weight;
      this.actions[state].setEffectiveWeight(weight);
    }
  }

  private sample(state: AnimationState, seconds: number): void {
    const action = this.actions[state];
    action.enabled = true;
    action.paused = false;
    action.time = Math.max(0, Math.min(action.getClip().duration, seconds));
    this.mixer.update(0);
    this.root.updateMatrixWorld(true);
  }

  updateGame(view: GameView, renderDelta: number): void {
    if (this.disposed) return;
    const started = this.measure ? performance.now() : 0;
    const reset = view !== this.view || view.tick < this.lastTick;
    const elapsed = reset ? 0 : (view.tick - this.lastTick) * RULES.fixedDt;
    this.view = view;
    this.lastTick = view.tick;
    this.paused = view.status === 'paused' || view.status === 'over';
    if (this.paused && !reset) return;
    const next = animationState(view);
    const seek = reset || elapsed > .25;
    this.transition(next, seek);
    const dt = view.status === 'ready' ? Math.min(Math.max(renderDelta, 0), .1) : Math.min(elapsed, .25);
    const target = runTimeScale(view.speed);
    if (seek) {
      this.filteredRunScale = target;
      this.runPhase = runPhaseAtDistance(view.distance) % this.actions.run.getClip().duration;
    } else if (dt > 0 && view.status === 'running') {
      // Exact exponential filter/integral for a linearly changing cadence target.
      // Phase uses the same filtered rate as the Action instead of overriding it
      // with the former distance/16 clock, which would cancel speed smoothing.
      const rate = MOTION.runDamping;
      const slope = (target - this.previousRunTarget) / dt;
      const residual = this.filteredRunScale - this.previousRunTarget + slope / rate;
      const decay = Math.exp(-rate * dt);
      const phaseDelta = (this.previousRunTarget - slope / rate) * dt + .5 * slope * dt * dt + residual * (1 - decay) / rate;
      this.filteredRunScale = target - slope / rate + residual * decay;
      this.runPhase = (this.runPhase + phaseDelta) % this.actions.run.getClip().duration;
    }
    this.previousRunTarget = target;
    this.actions.run.setEffectiveTimeScale(this.filteredRunScale);
    this.blend(dt);
    this.mixer.update(dt);
    const duration = this.actions[next].getClip().duration;
    const seconds = next === 'run' ? this.runPhase
      : next === 'jump' ? jumpProgress(view) * duration
      : next === 'slide' ? slideProgress(view) * duration : this.actions.idle.time;
    this.sample(next, seconds);
    if (this.measure && dt > 0) {
      const cost = performance.now() - started;
      this.cpuSamples++; this.cpuSum += cost; this.cpuMax = Math.max(this.cpuMax, cost);
    }
  }

  /** Exact seconds, never a random RAF timestamp; used by development previews. */
  samplePreview(state: AnimationState, seconds: number): void {
    if (this.disposed || !Number.isFinite(seconds)) return;
    this.transition(state, true);
    this.blend(0);
    this.sample(state, seconds);
    this.paused = true;
  }

  playPreview(state: AnimationState, dt: number, scale: number, playing: boolean): void {
    if (this.disposed) return;
    this.paused = !playing;
    this.transition(state);
    if (!playing) return;
    const elapsed = Math.min(Math.max(dt, 0), .1) * Math.max(.25, Math.min(2, scale));
    this.blend(elapsed);
    this.actions[state].setEffectiveTimeScale(1);
    this.mixer.update(elapsed);
    this.root.updateMatrixWorld(true);
  }

  diagnostics(): AnimationDiagnostics {
    return { mixerId: this.mixerId, actionCount: ANIMATION_STATES.length, state: this.state,
      time: this.actions[this.state].time, duration: this.actions[this.state].getClip().duration,
      runScale: this.actions.run.timeScale, weights: { idle: this.weights[0] ?? 0, run: this.weights[1] ?? 0, jump: this.weights[2] ?? 0, slide: this.weights[3] ?? 0 },
      paused: this.paused, cpu: { samples: this.cpuSamples, meanMs: this.cpuSamples ? this.cpuSum / this.cpuSamples : 0, maxMs: this.cpuMax } };
  }

  dispose(): void {
    if (this.disposed) return;
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.disposed = true;
    if (import.meta.env.MODE === 'e2e') { lifecycle.disposed++; lifecycle.active--; }
  }
}
