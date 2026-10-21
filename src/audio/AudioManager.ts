import type { EffectPalette, FeedbackEvent } from '../feedback/types';
import { createBrowserAudioContext } from './backend';
import type { AudioClip, AudioContextBackend, AudioVoice } from './backend';
import { SOUND_IDS, synthesizeSound } from './synthesis';
import type { SoundId } from './synthesis';

export const AUDIO_STORAGE_KEY = 'runner3d-audio-v1';
const MAX_VOICES = 12;
const DEDUP_CAPACITY = 256;
export type AudioStatus = 'locked' | 'ready' | 'suspended' | 'blocked' | 'unsupported' | 'disposed';
export interface AudioSnapshot {
  readonly muted: boolean;
  readonly volume: number;
  readonly enabled: boolean;
  readonly status: AudioStatus;
}
export interface AudioStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
export interface AudioManagerOptions { readonly contextFactory?: () => AudioContextBackend; readonly storage?: AudioStorage | null }
interface VoiceRecord { readonly voice: AudioVoice; readonly kind: SoundId }

function browserStorage(): AudioStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}
/** One lazy context, 16 cached mono buffers, <=12 physical source nodes, and no queued stale sounds. */
export class AudioManager {
  private readonly createContext: () => AudioContextBackend;
  private readonly storage: AudioStorage | null;
  private context: AudioContextBackend | null = null;
  private detachState: (() => void) | null = null;
  private readonly buffers = new Map<SoundId, readonly [AudioClip, AudioClip]>();
  private readonly voices = new Map<number, VoiceRecord>();
  private voiceId = 0;
  private paused = false;
  private disposed = false;
  private unlockPromise: Promise<void> | null = null;
  private pendingSuspends = 0;
  private disposePromise: Promise<void> | null = null;
  private snapshot: AudioSnapshot = Object.freeze({ muted: false, volume: .55, enabled: false, status: 'locked' });
  private readonly listeners = new Set<() => void>();
  private readonly seen = new Set<string>();
  private latestTick = -1;
  private runId: number | null = null;
  private coinTime = -Infinity;
  private coinStreak = 0;
  private contextCount = 0;
  private peakVoices = 0;
  private started = 0;
  private ended = 0;
  private stopped = 0;
  private dropped = 0;
  private duplicates = 0;
  private errors = 0;
  private eventsStarted = 0;
  private storageFailures = 0;
  private lastError: string | null = null;
  private lastEventId: string | null = null;
  private lastCoinPlaybackRate = 1;

  constructor(options: AudioManagerOptions = {}) {
    this.createContext = options.contextFactory ?? createBrowserAudioContext;
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    try {
      const raw = this.storage?.getItem(AUDIO_STORAGE_KEY);
      if (raw) {
        const value: unknown = JSON.parse(raw);
        if (typeof value === 'object' && value !== null && 'muted' in value && typeof value.muted === 'boolean'
          && 'volume' in value && typeof value.volume === 'number' && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1) {
          this.snapshot = Object.freeze({ ...this.snapshot, muted: value.muted, volume: value.volume });
        }
      }
    } catch { this.storageFailures++; }
  }

  getSnapshot = (): AudioSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  /** Must be called synchronously inside a trusted pointer/keyboard interaction. Never called by handle(). */
  unlock(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.paused = false;
    if (this.unlockPromise) return this.unlockPromise;
    try {
      if (!this.context) {
        const context = this.createContext();
        this.context = context; this.contextCount++;
        this.detachState = context.subscribeState(() => this.refreshStatus());
        context.setMasterVolume(this.snapshot.muted ? 0 : this.snapshot.volume);
      }
      const context = this.context;
      // Prime once inside the first gesture; subsequent events create no PCM arrays or oscillators.
      // A failed allocation can retry missing pairs without replacing the owned AudioContext.
      for (const id of SOUND_IDS) if (!this.buffers.has(id)) this.buffers.set(id, [context.createBuffer(synthesizeSound(id, context.sampleRate, 0).samples), context.createBuffer(synthesizeSound(id, context.sampleRate, 1).samples)]);
      // A suspend command can still be queued while state reads running. Enqueue the gesture's
      // resume after it now, rather than trying to resume later outside the user activation.
      const resume = context.state === 'running' && this.pendingSuspends === 0 ? Promise.resolve() : context.resume();
      this.refreshStatus();
      const pending = resume.then(() => {
        if (this.disposed || this.context !== context) return;
        if (this.paused) { this.requestSuspend(context); return; }
        if (context.state !== 'running') { this.update('blocked'); return; }
        this.lastError = null; this.refreshStatus();
      }).catch((error: unknown) => {
        if (this.disposed) return;
        this.recordError(error); this.update('blocked');
      }).finally(() => { if (this.unlockPromise === pending) this.unlockPromise = null; });
      this.unlockPromise = pending;
      return pending;
    } catch (error: unknown) {
      this.recordError(error);
      this.update(this.context ? 'blocked' : 'unsupported');
      return Promise.resolve();
    }
  }

  handle(event: FeedbackEvent, palette: EffectPalette): void {
    if (this.disposed) return;
    if (this.runId !== null && event.runId < this.runId) { this.duplicates++; return; }
    if (this.runId !== event.runId) { this.reset(); this.runId = event.runId; }
    // The runtime delivers completed simulation ticks in order. A watermark rejects old replays
    // indefinitely without retaining a run's entire history; same-tick overload keeps the first 256.
    if (event.tick < this.latestTick) { this.duplicates++; return; }
    if (event.tick > this.latestTick) { this.latestTick = event.tick; this.seen.clear(); }
    if (this.seen.has(event.id)) { this.duplicates++; return; }
    if (this.seen.size >= DEDUP_CAPACITY) { this.dropped++; return; }
    this.seen.add(event.id);
    this.lastEventId = event.id;
    const context = this.context;
    if (!context || context.state !== 'running' || this.paused || this.snapshot.muted || this.snapshot.volume <= 0 || !Number.isFinite(event.intensity)) { this.dropped++; return; }
    const sound = soundForEvent(event);
    const buffers = sound ? this.buffers.get(sound) : undefined;
    if (!buffers || !sound) { this.dropped++; return; }
    const blend = Number.isFinite(palette.neon) ? Math.max(0, Math.min(1, palette.neon)) : 0;
    const warm = 1 - blend;
    const layers = (warm > .001 ? 1 : 0) + (blend > .001 ? 1 : 0);
    if (this.voices.size + layers > MAX_VOICES) {
      if (event.type === 'collision' || event.type === 'game-over' || event.type === 'shield-broken') {
        while (this.voices.size + layers > MAX_VOICES) {
          const oldest = this.voices.keys().next().value;
          if (oldest === undefined) break;
          this.finishVoice(oldest, true);
        }
      } else { this.dropped++; return; }
    }
    let rate = event.type === 'powerup-collected' ? 1.35 : event.type === 'shield-broken' ? 1.6 : event.type === 'upgrade-purchased' ? 1.2 : 1;
    if (event.type === 'coin') {
      this.coinStreak = event.time >= this.coinTime && event.time - this.coinTime <= .5 ? Math.min(4, this.coinStreak + 1) : 0;
      this.coinTime = event.time;
      rate = 2 ** (this.coinStreak * .3 / 12);
      this.lastCoinPlaybackRate = rate;
    }
    const gain = .6 * (.45 + .55 * Math.max(0, Math.min(1, event.intensity)));
    const before = this.started;
    if (warm > .001) this.startVoice(context, buffers[0], sound, rate, gain * warm);
    if (blend > .001) this.startVoice(context, buffers[1], sound, rate, gain * blend);
    if (this.started > before) this.eventsStarted++;
  }

  setPaused(value: boolean): void {
    if (this.disposed || value === this.paused) return;
    this.paused = value;
    if (value) {
      this.stopVoices();
      if (this.context) this.requestSuspend(this.context);
    }
    // Unpausing does not resume the hardware. Only a fresh trusted unlock may do that.
    this.refreshStatus();
  }
  reset(): void {
    this.stopVoices(); this.seen.clear(); this.latestTick = -1;
    this.runId = null; this.coinStreak = 0; this.coinTime = -Infinity; this.lastEventId = null; this.lastCoinPlaybackRate = 1;
  }
  setMuted(muted: boolean): void {
    if (this.disposed || muted === this.snapshot.muted) return;
    this.snapshot = Object.freeze({ ...this.snapshot, muted });
    if (muted) this.stopVoices();
    this.applyVolume(); this.persist(); this.update(this.snapshot.status, true);
  }
  setVolume(value: number): void {
    if (this.disposed || !Number.isFinite(value)) return;
    const volume = Math.max(0, Math.min(1, value));
    if (volume === this.snapshot.volume) return;
    this.snapshot = Object.freeze({ ...this.snapshot, volume });
    if (volume === 0) this.stopVoices();
    this.applyVolume(); this.persist(); this.update(this.snapshot.status, true);
  }
  diagnostics() {
    return {
      contextCount: this.contextCount, activeContexts: this.context && this.context.state !== 'closed' ? 1 : 0,
      state: this.context?.state ?? 'none', status: this.snapshot.status, sampleRate: this.context?.sampleRate ?? 0,
      activeVoices: this.voices.size, maxVoices: MAX_VOICES, peakVoices: this.peakVoices,
      bufferCount: this.buffers.size * 2, started: this.started, ended: this.ended, stopped: this.stopped,
      dropped: this.dropped, duplicates: this.duplicates, eventsStarted: this.eventsStarted, errors: this.errors,
      lastError: this.lastError, storageFailures: this.storageFailures, dedupSize: this.seen.size,
      dedupCapacity: DEDUP_CAPACITY, listenerCount: this.listeners.size, stateListenerCount: this.detachState ? 1 : 0,
      paused: this.paused, pendingUnlock: this.unlockPromise !== null, pendingSuspends: this.pendingSuspends, lastEventId: this.lastEventId,
      lastCoinPlaybackRate: this.lastCoinPlaybackRate,
    };
  }
  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.reset(); this.detachState?.(); this.detachState = null; this.buffers.clear();
    this.update('disposed'); this.listeners.clear();
    const context = this.context;
    try { this.disposePromise = context ? context.close().catch((error: unknown) => this.recordError(error)) : Promise.resolve(); }
    catch (error: unknown) { this.recordError(error); this.disposePromise = Promise.resolve(); }
    return this.disposePromise;
  }

  private startVoice(context: AudioContextBackend, buffer: AudioClip, kind: SoundId, rate: number, gain: number): void {
    const id = ++this.voiceId;
    try {
      const voice = context.createVoice(buffer, rate, gain, () => this.finishVoice(id, false));
      this.voices.set(id, { voice, kind });
      this.started++; this.peakVoices = Math.max(this.peakVoices, this.voices.size);
    } catch (error: unknown) { this.recordError(error); this.dropped++; }
  }
  private finishVoice(id: number, stop: boolean): void {
    const record = this.voices.get(id);
    if (!record) return;
    this.voices.delete(id);
    try { if (stop) { record.voice.stop(); this.stopped++; } else this.ended++; } catch (error: unknown) { this.recordError(error); }
    try { record.voice.disconnect(); } catch (error: unknown) { this.recordError(error); }
  }
  private stopVoices(): void { for (const id of this.voices.keys()) this.finishVoice(id, true); }
  private requestSuspend(context: AudioContextBackend): void {
    if (context.state === 'closed') return;
    this.pendingSuspends++;
    try {
      void context.suspend().then(() => { if (!this.disposed) this.refreshStatus(); }).catch((error: unknown) => { if (!this.disposed) { this.recordError(error); this.refreshStatus(); } }).finally(() => { this.pendingSuspends--; });
    } catch (error: unknown) { this.pendingSuspends--; this.recordError(error); this.refreshStatus(); }
  }
  private refreshStatus(): void {
    if (this.disposed) return;
    if (!this.context) { this.update(this.snapshot.status); return; }
    const state = this.context.state;
    if (state !== 'running') this.stopVoices();
    this.update(state === 'closed' ? 'blocked' : this.paused || state !== 'running' ? 'suspended' : 'ready');
  }
  private update(status: AudioStatus, force = false): void {
    const enabled = status === 'ready' && !this.paused && !this.snapshot.muted && this.snapshot.volume > 0;
    if (!force && this.snapshot.status === status && this.snapshot.enabled === enabled) return;
    this.snapshot = Object.freeze({ ...this.snapshot, status, enabled });
    for (const listener of this.listeners) listener();
  }
  private applyVolume(): void {
    try { this.context?.setMasterVolume(this.snapshot.muted ? 0 : this.snapshot.volume); } catch (error: unknown) { this.recordError(error); }
  }
  private persist(): void {
    try { this.storage?.setItem(AUDIO_STORAGE_KEY, JSON.stringify({ muted: this.snapshot.muted, volume: this.snapshot.volume })); } catch { this.storageFailures++; }
  }
  private recordError(error: unknown): void {
    this.errors++;
    this.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 200);
  }
}

/** Reuse the original deterministic PCM bank with authored playback rates; no extra contexts/buffers. */
export function soundForEvent(event: FeedbackEvent): SoundId | null {
  switch (event.type) {
    case 'powerup-collected': case 'mission-completed': return 'speed';
    case 'shield-broken': return 'collision';
    case 'mission-reward-claimed': return 'coin';
    case 'upgrade-purchased': return 'jump';
    case 'powerup-activated': case 'powerup-expired': return null;
    default: return event.type;
  }
}
