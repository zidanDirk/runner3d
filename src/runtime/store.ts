import { useSyncExternalStore } from 'react';
import { DEFAULT_SEED } from '../game/config';
import { GameEngine } from '../game/engine';
import type { Action, GameSnapshot, GameView } from '../game/types';
import { FixedClock } from './clock';
import { profile } from './profile';
import { POWERUP_TYPES } from '../game/balance';

const BEST_KEY = 'runner3d-best-v1';
export type StepObserver = (view: GameView) => void;

function loadBest(): number {
  try {
    const value = Number(localStorage.getItem(BEST_KEY));
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  } catch { return 0; }
}

export class GameStore {
  private runUpgrades = profile.snapshot.upgrades;
  private engine = new GameEngine(DEFAULT_SEED, undefined, { upgrades: this.runUpgrades });
  private runSequence = 0;
  private readonly clock = new FixedClock();
  private best = Math.max(loadBest(), profile.snapshot.bestScore);
  private previewDepth = 0;
  private previewRun = false;
  private snapshot: GameSnapshot = this.makeSnapshot();
  private readonly listeners = new Set<() => void>();
  private readonly observers = new Set<StepObserver>();
  private sincePublish = 0;
  private timingEpoch = 0;

  get view(): GameView { return this.engine.view; }
  get generationValidation() { return this.engine.generationValidation; }
  get isPreview(): boolean { return this.previewRun; }
  get runId(): number { return this.runSequence; }
  get frameEpoch(): number { return this.timingEpoch; }
  getSnapshot = (): GameSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  /** A read-only seam after every actual tick and lifecycle change, before UI batching. */
  observe = (observer: StepObserver): (() => void) => {
    this.observers.add(observer);
    observer(this.view);
    return () => { this.observers.delete(observer); };
  };

  beginPreview(): () => void { this.previewDepth++; this.previewRun = true; return () => { this.previewDepth--; }; }

  private resetTiming(): void { this.clock.reset(); this.timingEpoch++; }
  start = (): void => {
    if (this.view.status === 'ready' && POWERUP_TYPES.some(type => this.runUpgrades[type] !== profile.snapshot.upgrades[type])) {
      this.runUpgrades = profile.snapshot.upgrades;
      this.engine = new GameEngine(this.view.seed, undefined, { upgrades: this.runUpgrades }); this.runSequence++;
    }
    this.engine.start(); this.resetTiming(); this.publish();
  };
  dispatch = (action: Action): void => { this.engine.dispatch(action); };
  pause = (): void => { this.engine.pause(); this.resetTiming(); this.publish(); };
  resume = (): void => { this.engine.resume(); this.resetTiming(); this.publish(); };
  togglePause = (): void => {
    if (this.view.status === 'running') this.pause();
    else if (this.view.status === 'paused') this.resume();
  };
  restart = (seed = this.view.seed): void => {
    profile.flush();
    this.previewRun = this.previewDepth > 0;
    this.runUpgrades = profile.snapshot.upgrades;
    this.engine = new GameEngine(seed.trim().slice(0, 40) || DEFAULT_SEED, undefined, { upgrades: this.runUpgrades });
    this.runSequence++;
    this.resetTiming();
    this.sincePublish = 0;
    this.engine.start();
    this.publish();
  };
  prepare = (seed: string): void => {
    profile.flush();
    this.previewRun = this.previewDepth > 0;
    this.runUpgrades = profile.snapshot.upgrades;
    this.engine = new GameEngine(seed.trim().slice(0, 40) || DEFAULT_SEED, undefined, { upgrades: this.runUpgrades });
    this.runSequence++;
    this.resetTiming();
    this.sincePublish = 0;
    this.publish();
  };

  advance = (seconds: number): void => {
    if (this.view.status !== 'running') return;
    this.clock.advance(seconds, () => {
      const coins = this.view.coins;
      this.engine.step();
      for (const observer of this.observers) observer(this.view);
      if (this.view.coins !== coins || this.view.powerupFacts.length > 0) this.publish();
    });
    this.sincePublish += Math.min(seconds, 0.1);
    if (this.sincePublish >= 0.05 || this.view.status !== 'running') {
      this.sincePublish = 0;
      this.publish();
    }
  };

  private makeSnapshot(): GameSnapshot {
    const s = this.view;
    return { status: s.status, seed: s.seed, distance: s.distance, speed: s.speed, score: s.score, coins: s.coins, best: this.best, hit: s.hit,
      powerups: { ...s.powerups }, powerupsCollected: s.powerupsCollected, scoreBonus: s.scoreBonus };
  }

  private publish(): void {
    for (const observer of this.observers) observer(this.view);
    if (!this.previewRun) this.best = Math.max(this.best, this.view.score, profile.snapshot.bestScore);
    if (!this.previewRun && this.view.status === 'over') {
      try { localStorage.setItem(BEST_KEY, String(this.best)); } catch { /* Session best remains available. */ }
    }
    this.snapshot = this.makeSnapshot();
    for (const listener of this.listeners) listener();
  }
}

export const game = new GameStore();
export const useGame = (): GameSnapshot => useSyncExternalStore(game.subscribe, game.getSnapshot, game.getSnapshot);

/** Exactly one RAF owns simulation; React's StrictMode can safely mount/clean/remount it. */
export function startLoop(onFrame?: (seconds: number) => void, shouldAdvance: () => boolean = () => true): () => void {
  let frame = 0;
  let previous: number | undefined;
  let epoch = game.frameEpoch;
  let wasAdvancing = shouldAdvance();
  const loop = (now: number): void => {
    const advancing = shouldAdvance();
    const currentEpoch = game.frameEpoch;
    const changed = currentEpoch !== epoch || (advancing && !wasAdvancing);
    const seconds = previous === undefined || changed || !Number.isFinite(previous) || !Number.isFinite(now) ? 0 : Math.min(.1, Math.max(0, (now - previous) / 1000));
    if (advancing) game.advance(seconds);
    onFrame?.(seconds);
    previous = now;
    epoch = currentEpoch;
    wasAdvancing = advancing;
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);
  return () => cancelAnimationFrame(frame);
}
