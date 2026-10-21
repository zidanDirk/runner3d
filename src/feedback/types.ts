import type { PowerUpType } from '../game/balance';
import type { ObstacleKind } from '../game/types';

export type FeedbackKind = 'coin' | 'jump' | 'land' | 'slide' | 'lane' | 'collision' | 'game-over' | 'speed' | 'powerup-collected' | 'powerup-activated' | 'powerup-expired' | 'shield-broken' | 'upgrade-purchased' | 'mission-completed' | 'mission-reward-claimed';
interface Context {
  readonly id: string;
  readonly runId: number;
  readonly tick: number;
  readonly time: number;
  readonly distance: number;
  readonly position: readonly [number, number, number];
  readonly intensity: number;
}
/** Facts observed after a real engine step. Consumers cannot modify the simulation. */
export type FeedbackEvent = Context & (
  | { readonly type: 'coin'; readonly entityId: string; readonly total: number; readonly attracted?: boolean; readonly targetX?: number; readonly targetY?: number; readonly speed?: number }
  | { readonly type: 'jump' | 'land' | 'game-over' }
  | { readonly type: 'slide'; readonly duration: number }
  | { readonly type: 'lane'; readonly direction: -1 | 1; readonly duration: number }
  | { readonly type: 'collision'; readonly obstacle: ObstacleKind }
  | { readonly type: 'speed'; readonly speed: number }
  | { readonly type: 'powerup-collected' | 'powerup-activated' | 'powerup-expired' | 'shield-broken'; readonly powerup: PowerUpType; readonly entityId: string }
  | { readonly type: 'upgrade-purchased' | 'mission-completed' | 'mission-reward-claimed' }
);
export type RGB = readonly [number, number, number];
export interface EffectPalette {
  readonly coin: RGB;
  readonly dust: RGB;
  readonly impact: RGB;
  readonly trail: RGB;
  /** Smooth theme blend, 0=warm Dusk and 1=electronic Neon. */
  readonly neon: number;
}
