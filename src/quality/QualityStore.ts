import { initialQuality, isQualityMode, QUALITY_PROFILES, resolveQualityDpr } from './profiles';
import type { QualityLevel, QualityMode, QualityProfile } from './profiles';

export const QUALITY_SAMPLING = Object.freeze({
  warmupMs: 4000, windowMs: 4000, cooldownMs: 12000,
  downMeanMs: 26, downP95Ms: 42, badWindows: 2,
  upMeanMs: 17.8, upP95Ms: 21, goodWindows: 4,
});

export interface QualitySnapshot {
  readonly mode: QualityMode;
  readonly level: QualityLevel;
  readonly profile: QualityProfile;
  readonly width: number;
  readonly height: number;
  readonly deviceDpr: number;
  readonly coarse: boolean;
}
export interface QualityPersistence { load(): unknown; save(mode: QualityMode): void }
export interface QualitySamplingStats {
  readonly samples: number;
  readonly windowMs: number;
  readonly warmupMs: number;
  readonly meanMs: number;
  readonly p95Ms: number;
  readonly badWindows: number;
  readonly goodWindows: number;
  readonly switches: number;
  readonly lastReason: 'initial' | 'environment' | 'manual' | 'slow-frames' | 'headroom';
}

/** Bounded frame histogram and external store, independent of browser/React/game.
 * All times below are actual active rendering time supplied by the adapter.
 * A single stall cannot toggle a profile; manual selection always takes priority. */
export class QualityStore {
  private snapshot: QualitySnapshot;
  private readonly listeners = new Set<() => void>();
  // Half-millisecond bins, bounded to 0..1000ms; no arrays allocated per frame.
  private readonly histogram = new Uint32Array(2001);
  private environmentInitialized = false;
  private compact = false;
  private activeMs = 0;
  private lastSwitchMs = 0;
  private warmupMs = 0;
  private windowMs = 0;
  private samples = 0;
  private badWindows = 0;
  private goodWindows = 0;
  private meanMs = 0;
  private p95Ms = 0;
  private switches = 0;
  private lastReason: QualitySamplingStats['lastReason'] = 'initial';

  constructor(private readonly persistence?: QualityPersistence) {
    let mode: QualityMode = 'auto';
    try { const stored = persistence?.load(); if (isQualityMode(stored)) mode = stored; } catch { /* Optional storage. */ }
    const level = mode === 'auto' ? 'high' : mode;
    this.snapshot = Object.freeze({ mode, level, profile: QUALITY_PROFILES[level], width: 0, height: 0, deviceDpr: 1, coarse: false });
  }

  getSnapshot = (): QualitySnapshot => this.snapshot;
  getDpr = (): number => resolveQualityDpr(this.snapshot.profile, this.snapshot.deviceDpr);
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  setMode(mode: QualityMode): void {
    if (!isQualityMode(mode)) return;
    try { this.persistence?.save(mode); } catch { /* Keep session preference. */ }
    if (this.snapshot.mode === mode) return;
    const { width, height, coarse } = this.snapshot;
    const level = mode === 'auto' ? (this.environmentInitialized ? initialQuality(width, height, coarse) : 'high') : mode;
    this.lastReason = 'manual'; this.lastSwitchMs = this.activeMs; this.resetSampling();
    this.publish({ ...this.snapshot, mode, level, profile: QUALITY_PROFILES[level] });
  }

  setEnvironment(width: number, height: number, deviceDpr: number, coarse: boolean): void {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    const dpr = Number.isFinite(deviceDpr) && deviceDpr > 0 ? deviceDpr : 1;
    const compact = initialQuality(width, height, coarse) === 'medium';
    const current = this.snapshot;
    if (this.environmentInitialized && width === current.width && height === current.height && dpr === current.deviceDpr && coarse === current.coarse) return;
    const chooseInitial = !this.environmentInitialized || compact !== this.compact;
    this.environmentInitialized = true; this.compact = compact;
    const level = current.mode === 'auto' && chooseInitial ? initialQuality(width, height, coarse) : current.level;
    if (level !== current.level) { this.lastReason = 'environment'; this.lastSwitchMs = this.activeMs; }
    this.resetSampling();
    this.publish({ ...current, width, height, deviceDpr: dpr, coarse, level, profile: QUALITY_PROFILES[level] });
  }

  resetSampling(): void {
    this.warmupMs = 0; this.clearWindow(); this.badWindows = 0; this.goodWindows = 0;
    this.meanMs = 0; this.p95Ms = 0;
  }

  sampleFrame(milliseconds: number, active = true): void {
    if (!active) {
      if (this.warmupMs || this.samples || this.badWindows || this.goodWindows) this.resetSampling();
      return;
    }
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
    if (milliseconds > 1000) { this.resetSampling(); return; }
    if (this.snapshot.mode !== 'auto') return;
    this.activeMs += milliseconds;
    if (this.warmupMs < QUALITY_SAMPLING.warmupMs) { this.warmupMs += milliseconds; return; }
    this.windowMs += milliseconds; this.samples++;
    const bin = Math.min(this.histogram.length - 1, Math.ceil(milliseconds * 2));
    this.histogram[bin] = (this.histogram[bin] ?? 0) + 1;
    if (this.windowMs < QUALITY_SAMPLING.windowMs) return;
    this.meanMs = this.windowMs / this.samples;
    let accumulated = 0;
    const target = Math.ceil(this.samples * .95);
    for (let i = 0; i < this.histogram.length; i++) {
      accumulated += this.histogram[i] ?? 0;
      if (accumulated >= target) { this.p95Ms = i / 2; break; }
    }
    const bad = this.meanMs > QUALITY_SAMPLING.downMeanMs || this.p95Ms > QUALITY_SAMPLING.downP95Ms;
    const good = this.meanMs < QUALITY_SAMPLING.upMeanMs && this.p95Ms < QUALITY_SAMPLING.upP95Ms;
    this.badWindows = bad ? Math.min(QUALITY_SAMPLING.badWindows, this.badWindows + 1) : 0;
    this.goodWindows = good ? Math.min(QUALITY_SAMPLING.goodWindows, this.goodWindows + 1) : 0;
    this.clearWindow();
    if (this.activeMs - this.lastSwitchMs < QUALITY_SAMPLING.cooldownMs) return;
    const level = this.snapshot.level;
    if (this.badWindows >= QUALITY_SAMPLING.badWindows && level !== 'low') {
      this.changeLevel(level === 'high' ? 'medium' : 'low', 'slow-frames');
    } else if (this.goodWindows >= QUALITY_SAMPLING.goodWindows && level !== 'high') {
      this.changeLevel(level === 'low' ? 'medium' : 'high', 'headroom');
    }
  }

  getSamplingStats(): QualitySamplingStats {
    return { samples: this.samples, windowMs: this.windowMs, warmupMs: this.warmupMs,
      meanMs: this.meanMs, p95Ms: this.p95Ms, badWindows: this.badWindows, goodWindows: this.goodWindows,
      switches: this.switches, lastReason: this.lastReason };
  }

  private clearWindow(): void { this.histogram.fill(0); this.windowMs = 0; this.samples = 0; }
  private changeLevel(level: QualityLevel, reason: QualitySamplingStats['lastReason']): void {
    this.switches++; this.lastReason = reason; this.lastSwitchMs = this.activeMs;
    this.resetSampling(); this.publish({ ...this.snapshot, level, profile: QUALITY_PROFILES[level] });
  }
  private publish(next: QualitySnapshot): void { this.snapshot = Object.freeze(next); for (const listener of this.listeners) listener(); }
}
