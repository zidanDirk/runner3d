import { useSyncExternalStore } from 'react';
import { RULES } from '../game/config';
import type { GameView } from '../game/types';
import { FeedbackEventSource } from '../feedback/FeedbackEventSource';
import type { FeedbackEvent, FeedbackKind } from '../feedback/types';
import { EffectManager } from '../effects/EffectManager';
import { effectPalette } from '../effects/theme';
import { AudioManager } from '../audio/AudioManager';
import { motionPreferences } from './motion-preferences';
import { game } from './store';
import { quality } from './quality';
import { input } from './input';

interface FeedbackUI { readonly coinSerial: number; readonly speed: number; readonly run: number; readonly notice: string }
export class FeedbackRuntime {
  readonly effects = new EffectManager();
  readonly audio = new AudioManager();
  private readonly source = new FeedbackEventSource();
  private view: GameView | undefined;
  private tick = 0;
  private quiet = 0;
  private postTime = 0;
  private counts: Partial<Record<FeedbackKind, number>> = {};
  private readonly recent: FeedbackEvent[] = [];
  private readonly listeners = new Set<() => void>();
  private ui: FeedbackUI = { coinSerial: 0, speed: 0, run: 0, notice: '' };
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = (): FeedbackUI => this.ui;
  private publish(): void { for (const listener of this.listeners) listener(); }

  observe = (view: GameView): void => {
    if (this.quiet) return;
    this.effects.density = quality.getSnapshot().profile.particleDensity;
    if (view !== this.view || view.tick < this.tick) {
      this.view = view; this.tick = view.tick; this.postTime = 0;
      this.source.reset(view); this.effects.reset(`${view.seed}:feedback-v1`, view.distance); this.audio.reset();
      this.counts = {}; this.recent.length = 0;
      this.ui = { coinSerial: 0, speed: 0, run: this.ui.run + 1, notice: '' }; this.publish();
    }
    this.audio.setPaused(view.status === 'paused' || view.status === 'ready');
    const elapsed = view.tick - this.tick;
    const palette = effectPalette(view.distance);
    if (elapsed > 0) this.effects.advance(elapsed * RULES.fixedDt, view.distance, view.player, view.speed, motionPreferences.getSnapshot(), palette);
    this.tick = view.tick;
    this.source.observe(view, event => this.handle(event));
  };

  get runId(): number { return this.source.identity; }
  handle(event: FeedbackEvent): void {
    const palette = effectPalette(event.distance);
    this.effects.handle(event, palette, motionPreferences.getSnapshot()); this.audio.handle(event, palette);
    this.counts[event.type] = (this.counts[event.type] ?? 0) + 1;
    this.recent.push(event); if (this.recent.length > 48) this.recent.shift();
    if (event.type === 'coin') { this.ui = { ...this.ui, coinSerial: this.ui.coinSerial + 1 }; this.publish(); }
    if (event.type === 'speed') { this.ui = { ...this.ui, speed: event.speed }; this.publish(); }
    if (event.type === 'powerup-collected' || event.type === 'shield-broken') {
      const labels = { magnet: '磁铁已激活', shield: '护盾已激活 · 可抵挡一次碰撞', 'double-score': '双倍得分已激活 · 2×' };
      this.ui = { ...this.ui, notice: event.type === 'shield-broken' ? '护盾已抵挡碰撞' : labels[event.powerup] }; this.publish();
    }
  }

  /** Death is immediate in the engine; only the finite feedback tail keeps ticking. */
  advancePost(seconds: number): void {
    if (this.quiet || !this.view || this.view.status !== 'over' || this.postTime >= 1.2) return;
    this.effects.density = quality.getSnapshot().profile.particleDensity;
    const dt = Math.max(0, Math.min(seconds, .1, 1.2 - this.postTime));
    this.postTime += dt;
    this.effects.advance(dt, this.view.distance, this.view.player, this.view.speed, motionPreferences.getSnapshot(), effectPalette(this.view.distance));
  }

  withQuiet<T>(operation: () => T): T {
    this.quiet++;
    try { return operation(); } finally {
      this.quiet--;
      if (!this.quiet) { this.view = undefined; this.observe(game.view); }
    }
  }
  diagnostics() {
    let edgeParticles = 0;
    const pool = this.effects.particles;
    for (let i = 0; i < pool.capacity; i++) if (pool.alive[i] && (pool.stretch[i] ?? 0) > 1) edgeParticles++;
    return { ...this.effects.stats(), edgeParticles, counts: { ...this.counts }, recent: [...this.recent], audio: this.audio.diagnostics(),
      reducedMotion: motionPreferences.getSnapshot(), time: this.effects.time, postTime: this.postTime };
  }
}

export const feedback = new FeedbackRuntime();
export const useFeedbackUI = () => useSyncExternalStore(feedback.subscribe, feedback.getSnapshot, feedback.getSnapshot);
export const useAudioSettings = () => useSyncExternalStore(feedback.audio.subscribe, feedback.audio.getSnapshot, feedback.audio.getSnapshot);

/** Context creation/resume is exclusively reached through actual DOM input. */
export function attachFeedback(): () => void {
  const detach = game.observe(feedback.observe);
  const unlock = (event: Event): void => {
    if (!event.isTrusted || document.hidden || input.isBlocked) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('.settings-panel,dialog[open]')) return;
    const button = target?.closest<HTMLButtonElement>('button[data-audio-unlock]');
    const activateButton = button && !button.disabled && (event.type === 'pointerdown' || (event instanceof KeyboardEvent && (event.code === 'Enter' || event.code === 'Space')));
    const resumeKey = event instanceof KeyboardEvent && event.code === 'Escape' && game.view.status === 'paused' && !target?.closest('input,textarea,select,button,[contenteditable="true"]');
    if (game.view.status === 'running' || activateButton || resumeKey) void feedback.audio.unlock();
  };
  window.addEventListener('pointerdown', unlock, { passive: true, capture: true });
  window.addEventListener('keydown', unlock, true);
  return () => {
    detach(); window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true);
    feedback.audio.reset(); feedback.audio.setPaused(true);
  };
}
