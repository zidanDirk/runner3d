import type { PowerUpType } from './balance';
import type { PowerUpFact, PowerUpPickup } from './powerups';
export type Lane = 0 | 1 | 2;
export type Action = 'left' | 'right' | 'jump' | 'slide';
export type Status = 'ready' | 'running' | 'paused' | 'over';
export type ObstacleKind = 'hurdle' | 'gate' | 'block';
export type EntityKind = ObstacleKind | 'coin';

export interface Entity {
  id: string;
  kind: EntityKind;
  lane: Lane;
  distance: number;
  collected: boolean;
  magnetCollected?: boolean;
  /** Visual-only removal after an intercepted collision; the AABB stays in the rule system. */
  shieldCleared?: boolean;
}

export interface TrackRow {
  index: number;
  distance: number;
  safeLane: Lane;
  entities: Entity[];
}

export interface LevelSource {
  next(): TrackRow;
}

export interface Player {
  lane: Lane;
  x: number;
  fromX: number;
  laneElapsed: number;
  y: number;
  velocityY: number;
  slideRemaining: number;
}

export interface GameState {
  seed: string;
  status: Status;
  tick: number;
  distance: number;
  speed: number;
  score: number;
  coins: number;
  player: Player;
  rows: TrackRow[];
  entities: Entity[];
  hit: ObstacleKind | null;
  pickups: PowerUpPickup[];
  powerups: Record<PowerUpType, number>;
  powerupFacts: PowerUpFact[];
  powerupsCollected: number;
  scoreBonus: number;
}

export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type GameView = DeepReadonly<GameState>;

export interface GameSnapshot {
  status: Status;
  seed: string;
  distance: number;
  speed: number;
  score: number;
  coins: number;
  best: number;
  hit: ObstacleKind | null;
  powerups: Readonly<Record<PowerUpType, number>>;
  powerupsCollected: number;
  scoreBonus: number;
}
