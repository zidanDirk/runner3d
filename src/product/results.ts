import { ECONOMY_BALANCE, UPGRADE_TYPES } from '../progression/config';
import { getMissionViews } from '../progression/profile';
import type { MissionView, PlayerProfile, RunSettlement } from '../progression/types';

export interface RunMissionSummary extends MissionView {
  readonly beforeProgress: number;
  readonly delta: number;
  readonly completedThisRun: boolean;
}

export interface RunResults {
  readonly runId: string;
  readonly score: number;
  readonly distance: number;
  readonly runCoins: number;
  readonly walletAdded: number;
  readonly walletCoinsAtSettlement: number;
  readonly records: {
    readonly score: boolean;
    readonly distance: boolean;
    readonly previousScore: number;
    readonly previousDistance: number;
  };
  readonly missions: readonly RunMissionSummary[];
  readonly claimableMissionCount: number;
  readonly affordableUpgradeCount: number;
  readonly allUpgradesMaxed: boolean;
}

/**
 * Capture `before` at actual run start: career records already update while running.
 * `settlement` must be ProfileController.lastSettlement for that completed run.
 * This function only describes committed facts and cannot grant money or rewards.
 */
export function createRunResults(before: PlayerProfile, settlement: RunSettlement | null, after: PlayerProfile): RunResults | null {
  if (settlement === null) return null;
  const oldMissions = getMissionViews(before);
  const missions = Object.freeze(getMissionViews(after).map((mission): RunMissionSummary => {
    const previous = oldMissions.find((candidate) => candidate.id === mission.id);
    const beforeProgress = previous?.progress ?? 0;
    return Object.freeze({ ...mission, beforeProgress, delta: Math.max(0, mission.progress - beforeProgress),
      completedThisRun: mission.completed && previous?.completed !== true && !mission.claimed });
  }));
  const affordableUpgradeCount = UPGRADE_TYPES.filter((type) => {
    const level = after.upgrades[type];
    if (level === ECONOMY_BALANCE.maxUpgradeLevel) return false;
    return settlement.walletCoins >= ECONOMY_BALANCE.upgradePrices[level];
  }).length;
  return Object.freeze({
    runId: settlement.runId, score: settlement.score, distance: settlement.distance,
    runCoins: settlement.runCoins, walletAdded: settlement.walletAdded, walletCoinsAtSettlement: settlement.walletCoins,
    records: Object.freeze({ score: settlement.score > before.bestScore, distance: settlement.distance > before.bestDistance,
      previousScore: before.bestScore, previousDistance: before.bestDistance }),
    missions, claimableMissionCount: missions.filter((mission) => mission.completed && !mission.claimed).length,
    affordableUpgradeCount, allUpgradesMaxed: UPGRADE_TYPES.every((type) => after.upgrades[type] === ECONOMY_BALANCE.maxUpgradeLevel),
  });
}
