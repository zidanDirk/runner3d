import { useSyncExternalStore } from 'react';
import type { QualitySamplingStats } from '../quality/QualityStore';
import type { QualityMode, QualityProfile } from '../quality/profiles';
import type { Status } from '../game/types';
import type { FeedbackRuntime } from './feedback';

export interface MobileFrameMetrics {
  readonly samples: number;
  readonly durationMs: number;
  readonly meanMs: number;
  readonly p95Ms: number;
  /** Fewer than100 intervals are insufficient for a meaningful P99. */
  readonly p99Ms: number | null;
  readonly fps: number;
  readonly over33Ms: number;
  readonly over50Ms: number;
}
export interface MobileMetrics {
  readonly sample: number;
  readonly measuredAt: number;
  readonly viewport: { readonly width: number; readonly height: number; readonly deviceDpr: number; readonly canvasWidth: number; readonly canvasHeight: number };
  readonly drawingBuffer: { readonly width: number; readonly height: number };
  readonly dpr: number;
  readonly quality: { readonly mode: QualityMode; readonly profile: QualityProfile; readonly sampling: QualitySamplingStats };
  readonly frames: MobileFrameMetrics;
  readonly render: { readonly calls: number; readonly triangles: number; readonly geometries: number; readonly textures: number; readonly programs: number; readonly sceneObjects: number };
  readonly camera: {
    readonly position: readonly number[];
    readonly fov: number | null;
    readonly aspect: number | null;
    readonly playerPixels: { readonly foot: readonly [number, number]; readonly head: readonly [number, number] };
    /** Reference points in NDC, not inferred visibility of an actual GLB mesh. */
    readonly projections: Readonly<Record<'leftFoot' | 'leftHead' | 'rightFoot' | 'rightHead' | 'playerFoot' | 'playerHead' | 'jumpTop' | 'forwardHazard', readonly [number, number, number]>>;
  };
  readonly game: { readonly status: Status; readonly seed: string; readonly tick: number; readonly distance: number; readonly themeId: string; readonly zoneId: number };
  readonly city: { readonly chunks: number; readonly revision: number; readonly buildings: number; readonly lamps: number; readonly logicalDecorations: number; readonly logicalProps: number; readonly mountedAssetIds: readonly string[] };
  readonly particles: { readonly active: number; readonly capacity: number; readonly peak: number; readonly activeEffects: number; readonly free: number };
  readonly audio: ReturnType<FeedbackRuntime['audio']['diagnostics']>;
  readonly heap: { readonly usedBytes: number; readonly totalBytes: number; readonly limitBytes: number } | null;
  readonly gpu: string | null;
  readonly contextLost: boolean;
}

/** At most600 actual completed-frame intervals; sort only for a low-frequency read. */
export class MobileFrameWindow {
  private readonly intervals = new Float64Array(600);
  private cursor = 0;
  private count = 0;
  private previous: number | undefined;
  record(now: number): void {
    if (!Number.isFinite(now)) return;
    if (this.previous !== undefined && now > this.previous) {
      this.intervals[this.cursor] = now - this.previous;
      this.cursor = (this.cursor + 1) % this.intervals.length;
      this.count = Math.min(this.intervals.length, this.count + 1);
    }
    this.previous = now;
  }
  reset(): void { this.cursor = 0; this.count = 0; this.previous = undefined; }
  read(): MobileFrameMetrics {
    const sorted = Array.from(this.intervals.subarray(0, this.count)).sort((a, b) => a - b);
    const durationMs = sorted.reduce((sum, value) => sum + value, 0);
    const meanMs = this.count ? durationMs / this.count : 0;
    return { samples: this.count, durationMs, meanMs, p95Ms: sorted[Math.max(0, Math.ceil(this.count * .95) - 1)] ?? 0,
      p99Ms: this.count >= 100 ? sorted[Math.ceil(this.count * .99) - 1] ?? null : null,
      fps: meanMs > 0 ? 1000 / meanMs : 0,
      over33Ms: sorted.filter((value) => value > 1000 / 30).length, over50Ms: sorted.filter((value) => value > 50).length };
  }
}

export const debugMobileEnabled = import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debugMobile') === '1';
let snapshot: MobileMetrics | null = null;
const listeners = new Set<() => void>();
export function publishMobileMetrics(value: MobileMetrics): void {
  if (!debugMobileEnabled && import.meta.env.MODE !== 'e2e') return;
  snapshot = value; for (const listener of listeners) listener();
}
export function clearMobileMetrics(): void { snapshot = null; for (const listener of listeners) listener(); }
const subscribe = (listener: () => void): (() => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useMobileMetrics = () => useSyncExternalStore(subscribe, () => snapshot, () => null);

declare global { interface Window { __MOBILE_RENDER__?: MobileMetrics } }
