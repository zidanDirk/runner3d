import { useSyncExternalStore } from 'react';
import type { AnimationState } from '../character/animationConfig';

export interface MotionMetrics {
  tick: number; state: AnimationState; speed: number; runScale: number; phase: number;
  leanDegrees: number; landing: number; scaleY: number; reducedMotion: boolean;
  jumpStage: 'grounded' | 'rising' | 'falling'; jumpProgress: number; slideProgress: number;
  fov: number; camera: number[]; pelvisY: number; headY: number;
  soles: { left: number; right: number } | null;
}
export const debugMotionEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get('debugMotion') === '1';
let metrics: MotionMetrics | null = null;
const listeners = new Set<() => void>();
export function publishMotionMetrics(value: MotionMetrics): void { metrics = value; listeners.forEach((listener) => listener()); }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useMotionMetrics = () => useSyncExternalStore(subscribe, () => metrics, () => null);
