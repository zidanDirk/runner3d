import { ERROR_MESSAGES, safeStack, validAnalytics } from './schema';
import type { AnalyticsData, AnalyticsName, ErrorCode, TelemetryContext } from './schema';
export interface ReleaseIdentity { readonly version: string; readonly buildId: string; readonly commit: string; readonly buildTime: string; readonly environment: 'development' | 'preview' | 'production' }
interface BaseEvent { readonly schemaVersion: 1; readonly sequence: number; readonly flowId: string; readonly timestamp: string; readonly release: ReleaseIdentity; readonly context: TelemetryContext }
export type TelemetryEvent =
  | (BaseEvent & { readonly kind: 'error'; readonly code: ErrorCode; readonly message: string; readonly stack?: string; readonly assetId?: string })
  | (BaseEvent & { readonly kind: 'analytics'; readonly name: AnalyticsName; readonly data: AnalyticsData })
  | (BaseEvent & { readonly kind: 'performance'; readonly data: PerformanceSummary });
export interface PerformanceSummary { readonly samples: number; readonly fps: number | null; readonly averageFrameMs: number | null; readonly p95FrameMs: number | null; readonly longFrames: number; readonly calls: number | null; readonly triangles: number | null; readonly chunks: number | null; readonly particles: number | null; readonly dpr: number | null; readonly gpuBytes: null }
export interface MonitoringAdapter { send(batch: readonly TelemetryEvent[], signal: AbortSignal): Promise<void> }
export interface MonitorSnapshot { readonly events: readonly TelemetryEvent[]; readonly firstRunDistanceMeters: number | null; readonly queued: number; readonly dropped: number; readonly analyticsCounts: Readonly<Partial<Record<AnalyticsName, number>>>; readonly analyticsEnabled: boolean; readonly remoteConsent: boolean; readonly connection: 'local-only' | 'disabled' | 'ready' | 'sending' | 'offline'; readonly performance: PerformanceSummary | null; readonly timings: Readonly<Record<string, number>> }
const LOCAL_CONTEXT: TelemetryContext = { browser: 'other', device: 'desktop', quality: 'unknown', gameState: 'home' };
export class Monitor {
  private readonly flowId = globalThis.crypto?.randomUUID?.() ?? `page-${Date.now().toString(36)}`;
  private offline = false;
  private events: TelemetryEvent[] = [];
  private queue: TelemetryEvent[] = [];
  private readonly pageEvents = new Set<AnalyticsName>();
  private readonly seen = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private firstRunId: number | undefined;
  private firstRunDistanceMeters: number | null = null;
  private analyticsCounts: Partial<Record<AnalyticsName, number>> = {};
  private sequence = 0; private dropped = 0; private analyticsEnabled = true; private remoteConsent = false;
  private adapter: MonitoringAdapter | undefined; private inFlight = false; private epoch = 0;
  private pendingAbort: AbortController | undefined;
  private nextSend = 0; private failures = 0; private rateStart = -Infinity; private rateCount = 0;
  private context: TelemetryContext = LOCAL_CONTEXT;
  private performance: PerformanceSummary | null = null;
  private timings: Record<string, number> = {};
  private snapshot: MonitorSnapshot;
  readonly release: ReleaseIdentity;
  constructor(release: ReleaseIdentity, private readonly now: () => number = Date.now) {
    this.release = Object.freeze({ version: release.version, buildId: release.buildId, commit: release.commit, buildTime: release.buildTime, environment: release.environment });
    this.snapshot = this.makeSnapshot();
  }
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = (): MonitorSnapshot => this.snapshot;
  setContext(context: TelemetryContext): void {
    this.context = { browser: context.browser, device: context.device, quality: context.quality, gameState: context.gameState };
  }
  private base(): BaseEvent { return { schemaVersion: 1, sequence: ++this.sequence, flowId: this.flowId, timestamp: new Date(this.now()).toISOString(), release: this.release, context: { ...this.context } }; }
  private unique(key: string, ttl: number): boolean {
    const now = this.now(); const previous = this.seen.get(key);
    if (previous !== undefined && now - previous < ttl) return false;
    this.seen.delete(key); this.seen.set(key, now);
    if (this.seen.size > 128) { const oldest = this.seen.keys().next().value; if (oldest !== undefined) this.seen.delete(oldest); }
    return true;
  }
  error(code: ErrorCode, options: { readonly error?: unknown; readonly assetId?: string } = {}): void {
    const assetId = options.assetId && /^[a-z][a-z0-9-]{0,63}$/.test(options.assetId) ? options.assetId : undefined;
    if (!this.unique(`error:${code}:${assetId ?? ''}`, 60000)) return;
    const now = this.now(); if (now - this.rateStart >= 60000) { this.rateStart = now; this.rateCount = 0; }
    if (this.rateCount++ >= 10) { this.dropped++; this.publish(); return; }
    const stack = safeStack(options.error);
    this.append({ ...this.base(), kind: 'error', code, message: ERROR_MESSAGES[code], ...(stack ? { stack } : {}), ...(assetId ? { assetId } : {}) });
  }
  track(name: AnalyticsName, key: string, data: AnalyticsData = {}): void {
    if (!this.analyticsEnabled || !validAnalytics(name, data)) return;
    const oncePerPage = name === 'APP_OPENED' || name === 'GAME_READY' || name === 'TUTORIAL_COMPLETED' || name === 'TUTORIAL_SKIPPED';
    if (oncePerPage && this.pageEvents.has(name)) return;
    if (!this.unique(`event:${name}:${key}`, Infinity)) return;
    if (oncePerPage) this.pageEvents.add(name);
    if (name === 'RUN_STARTED' && this.firstRunId === undefined) this.firstRunId = data.run;
    if (name === 'RUN_ENDED' && data.run === this.firstRunId && typeof data.distanceMeters === 'number' && this.firstRunDistanceMeters === null) this.firstRunDistanceMeters = data.distanceMeters;
    this.analyticsCounts = { ...this.analyticsCounts, [name]: (this.analyticsCounts[name] ?? 0) + 1 };
    this.append({ ...this.base(), kind: 'analytics', name, data: { ...data } });
  }
  sample(data: PerformanceSummary): void {
    const integer = (value: number | null): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
    const finite = (value: number | null, max = 60000): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max ? value : null;
    const samples = Math.min(600, integer(data.samples) ?? 0);
    this.performance = { samples, fps: samples ? finite(data.fps, 1000) : null, averageFrameMs: samples ? finite(data.averageFrameMs) : null,
      p95FrameMs: samples ? finite(data.p95FrameMs) : null, longFrames: integer(data.longFrames) ?? 0,
      calls: integer(data.calls), triangles: integer(data.triangles), chunks: integer(data.chunks), particles: integer(data.particles), dpr: finite(data.dpr, 8), gpuBytes: null };
    this.append({ ...this.base(), kind: 'performance', data: this.performance });
  }
  timing(name: 'pageInitializedMs' | 'pageLoadedMs' | 'coreReadyMs' | 'timeToPlayMs' | 'homeToPlayMs' | `glb:${string}`, duration: number): void {
    if (name.startsWith('glb:') && !/^glb:[a-z][a-z0-9-]{0,63}$/.test(name)) return;
    if (!Number.isFinite(duration) || duration < 0 || duration > 86400000 || Object.keys(this.timings).length >= 32 && !Object.hasOwn(this.timings, name)) return;
    this.timings = { ...this.timings, [name]: Math.round(duration) }; this.publish();
  }
  setAnalytics(enabled: boolean): void {
    this.analyticsEnabled = enabled;
    if (!enabled) { this.firstRunId = undefined; this.firstRunDistanceMeters = null; this.analyticsCounts = {}; this.events = this.events.filter(event => event.kind !== 'analytics'); this.queue = this.queue.filter(event => event.kind !== 'analytics'); }
    this.publish();
  }
  setRemoteConsent(enabled: boolean): void { this.remoteConsent = enabled; this.pendingAbort?.abort(); this.epoch++; this.queue = []; this.publish(); }
  configure(factory?: () => MonitoringAdapter): void {
    this.pendingAbort?.abort(); this.epoch++; this.queue = []; this.adapter = undefined; this.failures = 0; this.offline = false;
    try { this.adapter = factory?.(); } catch { this.error('ADAPTER_FAILURE'); }
    this.publish();
  }
  /** Called every30s, never every rendered frame. Offline failures keep at most100 new observations in memory. */
  async flush(online = true): Promise<void> {
    if (!this.adapter || !this.remoteConsent || this.inFlight || this.now() < this.nextSend || !this.queue.length) return;
    if (!online) { this.offline = true; this.publish(); return; }
    this.offline = false;
    const batch = this.queue.splice(0, 20); const epoch = this.epoch; const adapter = this.adapter;
    this.inFlight = true; this.publish();
    const controller = new AbortController(); this.pendingAbort = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<void>((_, reject) => {
      onAbort = () => reject(new Error('Monitoring transport cancelled'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => controller.abort(), 8000);
    });
    try { await Promise.race([adapter.send(batch, controller.signal), cancelled]); if (this.epoch === epoch) this.failures = 0; }
    catch { if (this.epoch === epoch && this.remoteConsent) { const retry = [...batch.filter(event => this.analyticsEnabled || event.kind !== 'analytics'), ...this.queue]; this.dropped += Math.max(0, retry.length - 100); this.queue = retry.slice(-100); this.failures++; } }
    finally { if (timer !== undefined) clearTimeout(timer); if (onAbort) controller.signal.removeEventListener('abort', onAbort); if (this.pendingAbort === controller) this.pendingAbort = undefined; this.inFlight = false; this.nextSend = this.now() + Math.min(300000, 30000 * 2 ** Math.min(4, this.failures)); this.publish(); }
  }
  private append(event: TelemetryEvent): void {
    this.events.push(event); if (this.events.length > 100) this.events.shift();
    if (this.adapter && this.remoteConsent) { this.queue.push(event); if (this.queue.length > 100) { this.queue.shift(); this.dropped++; } }
    this.publish();
  }
  private makeSnapshot(): MonitorSnapshot { return { events: this.events.slice(), firstRunDistanceMeters: this.firstRunDistanceMeters, queued: this.queue.length, dropped: this.dropped, analyticsCounts: this.analyticsCounts, analyticsEnabled: this.analyticsEnabled, remoteConsent: this.remoteConsent, connection: !this.adapter ? 'local-only' : !this.remoteConsent ? 'disabled' : this.inFlight ? 'sending' : this.offline || this.failures ? 'offline' : 'ready', performance: this.performance, timings: this.timings }; }
  private publish(): void { this.snapshot = this.makeSnapshot(); for (const listener of this.listeners) { try { listener(); } catch { /* Observers cannot stop the game. */ } } }
}
