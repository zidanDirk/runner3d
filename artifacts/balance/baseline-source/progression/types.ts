export type UpgradeType = 'magnet' | 'shield' | 'double-score';
export type UpgradeLevel = 0 | 1 | 2 | 3;
export type MissionKind = 'coins' | 'distance' | 'powerups';

export interface PlayerProfile {
  readonly schemaVersion: 1;
  readonly walletCoins: number;
  readonly bestScore: number;
  readonly bestDistance: number;
  readonly upgrades: Readonly<Record<UpgradeType, UpgradeLevel>>;
  readonly missions: { readonly claimed: readonly string[] };
  readonly statistics: {
    readonly totalCoins: number;
    readonly totalDistance: number;
    readonly powerupsCollected: number;
    readonly runsCompleted: number;
  };
}

export interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RunProgress {
  readonly id: string;
  readonly tick: number;
  readonly distance: number;
  readonly coins: number;
  readonly powerupsCollected: number;
  readonly score: number;
  readonly status: 'ready' | 'running' | 'paused' | 'over';
}

export interface MissionDefinition {
  readonly id: string;
  readonly kind: MissionKind;
  readonly tier: 1 | 2 | 3;
  readonly target: number;
  readonly reward: number;
}

export interface MissionView extends MissionDefinition {
  readonly progress: number;
  readonly completed: boolean;
  readonly claimed: boolean;
  readonly unlocked: boolean;
}

export type ProgressionEvent =
  | { readonly type: 'MISSION_COMPLETED'; readonly missionId: string; readonly reward: number }
  | { readonly type: 'MISSION_REWARD_CLAIMED'; readonly missionId: string; readonly reward: number; readonly walletCoins: number }
  | { readonly type: 'UPGRADE_PURCHASED'; readonly upgrade: UpgradeType; readonly level: UpgradeLevel; readonly price: number; readonly walletCoins: number };

export type TransactionFailure = 'invalid-upgrade' | 'stale-level' | 'max-level' | 'insufficient-coins' | 'unknown-mission' | 'locked' | 'incomplete' | 'already-claimed';
export type TransactionResult = { readonly ok: true; readonly event: ProgressionEvent } | { readonly ok: false; readonly reason: TransactionFailure };

export interface RunSettlement {
  readonly runId: string;
  readonly runCoins: number;
  readonly walletAdded: number;
  readonly walletCoins: number;
  readonly score: number;
  readonly distance: number;
}
