import { useSyncExternalStore } from 'react';
import { assetIds } from './catalog';
import type { AssetId } from './catalog';
import { cityPreloadPlan, CORE_ASSET_IDS, NEXT_THEME_PRELOAD_DISTANCE } from './city-loading';
import { game } from '../runtime/store';
import { CITY_CONFIG } from '../city/config';

export type AssetStatus = 'idle' | 'loading' | 'loaded' | 'error';
export type LoadingFailure = 'load' | 'validation' | 'timeout';
export interface AssetLoadError { readonly id: AssetId; readonly message: string; readonly kind: LoadingFailure }
export interface LoadingProgress { readonly loaded: number; readonly total: number }
export interface LoadingSnapshot {
  readonly phase: 'renderer' | 'core' | 'theme' | 'ready' | 'error';
  readonly rendererReady: boolean;
  readonly rendererError: string | null;
  readonly currentTheme: string;
  readonly core: LoadingProgress;
  readonly current: LoadingProgress;
  readonly requested: readonly AssetId[];
  readonly pending: readonly AssetId[];
  readonly errors: readonly AssetLoadError[];
  readonly ready: boolean;
  readonly canContinue: boolean;
  readonly fallbackAllowed: boolean;
  readonly revision: number;
}
interface Entry { status: AssetStatus; revision: number; parsed: boolean; error?: AssetLoadError; timer?: ReturnType<typeof setTimeout> }
export class AssetValidationError extends Error {}

/** Records settled GLTFLoader results, not optimistic preload calls or invented byte progress. */
export class AssetLoadingStore {
  private readonly entries = new Map<AssetId, Entry>();
  private readonly listeners = new Set<() => void>();
  private rendererReady = false;
  private rendererError: string | null = null;
  private currentTheme = '';
  private currentIds: readonly AssetId[] = [];
  private startupIds: readonly AssetId[] | undefined;
  private fallbackAllowed = false;
  private planKey = '';
  private distanceBand = '';
  private connections = 0;
  private revision = 0;
  private snapshot: LoadingSnapshot;

  constructor(private readonly retryAsset: (id: AssetId, clearFailedCache: boolean) => void = () => {}, private readonly timeoutMs = 15000) { this.snapshot = this.makeSnapshot(); }
  getSnapshot = (): LoadingSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  status = (id: AssetId): AssetStatus => this.entries.get(id)?.status ?? 'idle';
  assetRevision = (id: AssetId): number => this.entries.get(id)?.revision ?? 0;

  attach(): () => void {
    this.connections++;
    if (this.connections === 1) for (const [id, entry] of this.entries) if (entry.status === 'loading') this.startTimer(id, entry);
    let active = true;
    return () => {
      if (!active) return; active = false;
      this.connections--;
      if (!this.connections) for (const entry of this.entries.values()) this.stopTimer(entry);
    };
  }

  updateDistance(distance: number): void {
    // Plan changes only at zone / transition / preload boundaries, never at every tick.
    if (!Number.isFinite(distance) || distance < 0) return;
    const zone = Math.floor(distance / CITY_CONFIG.zones.length);
    const local = distance - zone * CITY_CONFIG.zones.length;
    const band = `${zone}:${local < CITY_CONFIG.zones.transitionChunks * CITY_CONFIG.chunkLength}:${CITY_CONFIG.zones.length - local <= NEXT_THEME_PRELOAD_DISTANCE}`;
    if (band === this.distanceBand) return;
    this.distanceBand = band;
    const plan = cityPreloadPlan(distance);
    if (plan.key === this.planKey) return;
    this.planKey = plan.key; this.currentTheme = plan.currentTheme; this.currentIds = plan.current;
    this.startupIds ??= [...CORE_ASSET_IDS, ...plan.current];
    for (const id of plan.requested) this.request(id, false);
    this.publish();
  }

  request(id: AssetId, publish = true): number {
    if (!assetIds.includes(id)) throw new Error(`Unknown asset ID ${id}`);
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { status: 'loading', revision: 0, parsed: false }; this.entries.set(id, entry); this.startTimer(id, entry);
      if (publish) this.publish();
    }
    return entry.revision;
  }

  loaded(id: AssetId, revision = this.assetRevision(id)): void {
    this.request(id, false);
    const entry = this.entries.get(id);
    if (!entry || revision !== entry.revision || entry.status === 'loaded') return;
    this.stopTimer(entry); entry.status = 'loaded'; entry.parsed = true; delete entry.error; this.publish();
  }

  failed(id: AssetId, error: unknown, revision = this.assetRevision(id), kind: LoadingFailure = 'load'): void {
    this.request(id, false);
    const entry = this.entries.get(id);
    if (!entry || revision !== entry.revision) return;
    if (entry.status === 'error' && entry.error?.kind === kind) return;
    this.stopTimer(entry); entry.status = 'error';
    entry.error = { id, kind, message: error instanceof Error ? error.message : String(error) };
    if (kind === 'validation') entry.parsed = true;
    this.publish();
  }

  setRendererReady = (ready = true): void => { if (ready !== this.rendererReady || (ready && this.rendererError)) { this.rendererReady = ready; if (ready) this.rendererError = null; this.publish(); } };
  setRendererFailed = (message: string): void => { this.rendererError = message; this.rendererReady = false; this.publish(); };
  allowFallback = (): void => { if (this.snapshot.canContinue && !this.fallbackAllowed) { this.fallbackAllowed = true; this.publish(); } };
  retryFailed = (): void => {
    let changed = false;
    for (const [id, entry] of this.entries) if (entry.status === 'error') {
      // A timed-out request is still in useLoader's pending cache. Reuse it; never
      // start a second request/parse while the browser's original request is alive.
      const clearCache = entry.error?.kind === 'load' && !entry.parsed;
      this.retryAsset(id, clearCache);
      entry.revision++; entry.status = 'loading'; delete entry.error; this.startTimer(id, entry); changed = true;
    }
    if (changed) { this.revision++; this.publish(); }
  };

  private stopTimer(entry: Entry): void { if (entry.timer !== undefined) clearTimeout(entry.timer); delete entry.timer; }
  private startTimer(id: AssetId, entry: Entry): void {
    this.stopTimer(entry);
    if (!this.connections) return;
    const revision = entry.revision;
    entry.timer = setTimeout(() => this.failed(id, new Error('模型加载超过15秒，可重试或使用基础模型继续。'), revision, 'timeout'), this.timeoutMs);
  }
  private progress(ids: readonly AssetId[]): LoadingProgress { return { loaded: ids.filter((id) => this.status(id) === 'loaded').length, total: ids.length }; }
  private makeSnapshot(): LoadingSnapshot {
    const requested = [...this.entries.keys()];
    const pending = requested.filter((id) => this.status(id) === 'loading');
    const errors = [...this.entries.values()].flatMap((entry) => entry.error ? [entry.error] : []);
    const startup = this.startupIds ?? [];
    const startupLoaded = !!this.startupIds && startup.every((id) => this.status(id) === 'loaded');
    const startupSettled = !!this.startupIds && startup.every((id) => this.status(id) === 'loaded' || this.status(id) === 'error');
    const startupFailed = startup.some((id) => this.status(id) === 'error');
    const canContinue = this.rendererReady && startupSettled && startupFailed;
    const ready = this.rendererReady && (startupLoaded || this.fallbackAllowed);
    const core = this.progress(CORE_ASSET_IDS); const current = this.progress(this.currentIds);
    const phase = ready ? 'ready' : startupFailed || this.rendererError ? 'error' : !this.rendererReady ? 'renderer' : core.loaded < core.total ? 'core' : 'theme';
    return { phase, rendererReady: this.rendererReady, rendererError: this.rendererError, currentTheme: this.currentTheme, core, current, requested, pending, errors, ready, canContinue, fallbackAllowed: this.fallbackAllowed, revision: this.revision };
  }
  private publish(): void { this.snapshot = this.makeSnapshot(); for (const listener of this.listeners) listener(); }
}

let clearAssetCache: ((id: AssetId) => void) | undefined;
/** The scene installs its existing GLTF cache adapter. The loading shell needs no Three.js. */
export function registerAssetCacheClear(clear: (id: AssetId) => void): () => void {
  clearAssetCache = clear;
  return () => { if (clearAssetCache === clear) clearAssetCache = undefined; };
}
export const loading = new AssetLoadingStore((id, clearFailedCache) => { if (clearFailedCache) clearAssetCache?.(id); });
export const useLoading = (): LoadingSnapshot => useSyncExternalStore(loading.subscribe, loading.getSnapshot, loading.getSnapshot);
export const useAssetRevision = (id: AssetId): number => useSyncExternalStore(loading.subscribe, () => loading.assetRevision(id), () => 0);
export function attachAssetLoading(): () => void {
  const detach = loading.attach();
  loading.updateDistance(game.view.distance);
  const stop = game.observe((view) => loading.updateDistance(view.distance));
  return () => { stop(); detach(); };
}
