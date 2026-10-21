import { LEGACY_BEST_KEY, MISSION_CHAINS, PROFILE_KEY, UPGRADE_TYPES } from './config';
import type { MissionKind, MissionView, PlayerProfile, ProfileStorage, UpgradeLevel, UpgradeType } from './types';

export function isSafeCounter(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function cappedAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

export function isUpgradeType(value: unknown): value is UpgradeType {
  return value === 'magnet' || value === 'shield' || value === 'double-score';
}

export function isUpgradeLevel(value: unknown): value is UpgradeLevel {
  return isSafeCounter(value) && value <= 3;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

export function freezeProfile(profile: PlayerProfile): PlayerProfile {
  Object.freeze(profile.upgrades);
  Object.freeze(profile.missions.claimed);
  Object.freeze(profile.missions);
  Object.freeze(profile.statistics);
  return Object.freeze(profile);
}

export function defaultProfile(bestScore = 0): PlayerProfile {
  return freezeProfile({
    schemaVersion: 1, walletCoins: 0, bestScore, bestDistance: 0,
    upgrades: { magnet: 0, shield: 0, 'double-score': 0 },
    missions: { claimed: [] },
    statistics: { totalCoins: 0, totalDistance: 0, powerupsCollected: 0, runsCompleted: 0 },
  });
}

export function missionTotal(profile: PlayerProfile, kind: MissionKind): number {
  if (kind === 'coins') return profile.statistics.totalCoins;
  if (kind === 'distance') return profile.statistics.totalDistance;
  return profile.statistics.powerupsCollected;
}

export function getMissionViews(profile: PlayerProfile): readonly MissionView[] {
  return MISSION_CHAINS.map((mission) => {
    const previous = MISSION_CHAINS.find((candidate) => candidate.kind === mission.kind && candidate.tier === mission.tier - 1);
    const unlocked = previous === undefined || profile.missions.claimed.includes(previous.id);
    const progress = Math.min(mission.target, missionTotal(profile, mission.kind));
    return { ...mission, progress, completed: unlocked && progress >= mission.target, claimed: profile.missions.claimed.includes(mission.id), unlocked };
  });
}

/** Reject malformed or future schemas as a whole; never reinterpret them as trusted money. */
export function parseProfile(value: unknown): PlayerProfile | null {
  if (!record(value) || !keys(value, ['schemaVersion', 'walletCoins', 'bestScore', 'bestDistance', 'upgrades', 'missions', 'statistics']) || value.schemaVersion !== 1) return null;
  const { walletCoins, bestScore, bestDistance, upgrades, missions, statistics } = value;
  if (!isSafeCounter(walletCoins) || !isSafeCounter(bestScore) || !isSafeCounter(bestDistance)) return null;
  if (!record(upgrades) || !keys(upgrades, UPGRADE_TYPES) || !isUpgradeLevel(upgrades.magnet) || !isUpgradeLevel(upgrades.shield) || !isUpgradeLevel(upgrades['double-score'])) return null;
  if (!record(missions) || !keys(missions, ['claimed']) || !Array.isArray(missions.claimed) || missions.claimed.length > MISSION_CHAINS.length) return null;
  const claimed: string[] = [];
  for (const id of missions.claimed) {
    if (typeof id !== 'string' || claimed.includes(id) || !MISSION_CHAINS.some((mission) => mission.id === id)) return null;
    claimed.push(id);
  }
  if (!record(statistics) || !keys(statistics, ['totalCoins', 'totalDistance', 'powerupsCollected', 'runsCompleted'])) return null;
  const { totalCoins, totalDistance, powerupsCollected, runsCompleted } = statistics;
  if (!isSafeCounter(totalCoins) || !isSafeCounter(totalDistance) || !isSafeCounter(powerupsCollected) || !isSafeCounter(runsCompleted)) return null;
  const profile = { schemaVersion: 1 as const, walletCoins, bestScore, bestDistance,
    upgrades: { magnet: upgrades.magnet, shield: upgrades.shield, 'double-score': upgrades['double-score'] },
    missions: { claimed }, statistics: { totalCoins, totalDistance, powerupsCollected, runsCompleted } };
  for (const mission of MISSION_CHAINS) {
    if (!claimed.includes(mission.id)) continue;
    if (missionTotal(profile, mission.kind) < mission.target) return null;
    const previous = MISSION_CHAINS.find((candidate) => candidate.kind === mission.kind && candidate.tier === mission.tier - 1);
    if (previous !== undefined && !claimed.includes(previous.id)) return null;
  }
  return freezeProfile(profile);
}

export interface LoadedProfile { readonly profile: PlayerProfile; readonly recovered: boolean; readonly migrated: boolean; readonly unsupportedSchema: boolean }

export function loadProfile(storage?: ProfileStorage): LoadedProfile {
  let recovered = false;
  let unsupportedSchema = false;
  try {
    const raw = storage?.getItem(PROFILE_KEY);
    if (raw !== undefined && raw !== null) {
      const data: unknown = JSON.parse(raw);
      unsupportedSchema = record(data) && typeof data.schemaVersion === 'number' && Number.isFinite(data.schemaVersion) && data.schemaVersion > 1;
      const profile = parseProfile(data);
      if (profile !== null) return { profile, recovered: false, migrated: false, unsupportedSchema: false };
      recovered = true;
    }
  } catch { recovered = true; }
  try {
    const legacy = storage?.getItem(LEGACY_BEST_KEY);
    if (legacy !== undefined && legacy !== null && /^\d+$/.test(legacy.trim())) {
      const best = Number(legacy);
      if (isSafeCounter(best)) return { profile: defaultProfile(best), recovered, migrated: true, unsupportedSchema };
    }
  } catch { /* Defaults remain playable when storage is unavailable. */ }
  return { profile: defaultProfile(), recovered, migrated: false, unsupportedSchema };
}
