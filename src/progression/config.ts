import type { MissionDefinition, MissionKind, UpgradeType } from './types';

export const PROFILE_KEY = 'runner3d-profile-v1';
export const LEGACY_BEST_KEY = 'runner3d-best-v1';

export const UPGRADE_TYPES: readonly UpgradeType[] = Object.freeze(['magnet', 'shield', 'double-score']);

/** Cumulative career totals: claiming a tier never resets its progress. */
export const MISSION_CHAINS: readonly MissionDefinition[] = Object.freeze(([
  { id: 'coins-1', kind: 'coins', tier: 1, target: 100, reward: 40 },
  { id: 'coins-2', kind: 'coins', tier: 2, target: 300, reward: 80 },
  { id: 'coins-3', kind: 'coins', tier: 3, target: 800, reward: 150 },
  { id: 'distance-1', kind: 'distance', tier: 1, target: 1000, reward: 40 },
  { id: 'distance-2', kind: 'distance', tier: 2, target: 3000, reward: 80 },
  { id: 'distance-3', kind: 'distance', tier: 3, target: 10000, reward: 150 },
  { id: 'powerups-1', kind: 'powerups', tier: 1, target: 5, reward: 40 },
  { id: 'powerups-2', kind: 'powerups', tier: 2, target: 15, reward: 80 },
  { id: 'powerups-3', kind: 'powerups', tier: 3, target: 40, reward: 150 },
] satisfies MissionDefinition[]).map((mission) => Object.freeze(mission)));

export const ECONOMY_BALANCE = Object.freeze({
  upgradePrices: Object.freeze([100, 250, 500] as const),
  maxUpgradeLevel: 3 as const,
  retiredRunCapacity: 32,
  eventCapacity: 32,
});

export const MISSIONS_BY_KIND: Readonly<Record<MissionKind, readonly MissionDefinition[]>> = Object.freeze({
  coins: Object.freeze(MISSION_CHAINS.filter((mission) => mission.kind === 'coins')),
  distance: Object.freeze(MISSION_CHAINS.filter((mission) => mission.kind === 'distance')),
  powerups: Object.freeze(MISSION_CHAINS.filter((mission) => mission.kind === 'powerups')),
});

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function positive(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function exactKeys(value: Record<string, unknown>, names: readonly string[]): boolean {
  return Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
}

/** Fail early when balance data is edited; unknown fields and unsafe rewards cannot leak into money transactions. */
export function validateEconomyBalance(balance: unknown = ECONOMY_BALANCE, missions: unknown = MISSION_CHAINS): void {
  if (!object(balance) || !exactKeys(balance, ['upgradePrices', 'maxUpgradeLevel', 'retiredRunCapacity', 'eventCapacity'])) throw new Error('Economy balance has invalid fields');
  if (!Array.isArray(balance.upgradePrices) || balance.upgradePrices.length !== 3) throw new Error('Upgrade prices require exactly three levels');
  let previousPrice = 0;
  for (const price of balance.upgradePrices) {
    if (!positive(price) || price <= previousPrice) throw new Error('Upgrade prices must be safe, positive and increasing');
    previousPrice = price;
  }
  if (balance.maxUpgradeLevel !== 3 || !positive(balance.retiredRunCapacity) || balance.retiredRunCapacity > 128 || !positive(balance.eventCapacity) || balance.eventCapacity > 128) throw new Error('Economy capacity or level limit is invalid');
  if (!Array.isArray(missions) || missions.length !== 9) throw new Error('Missions require three fixed chains of three tiers');
  const ids = new Set<string>();
  const chains: Record<MissionKind, { tier: number; target: number }> = { coins: { tier: 0, target: 0 }, distance: { tier: 0, target: 0 }, powerups: { tier: 0, target: 0 } };
  for (const mission of missions) {
    if (!object(mission) || !exactKeys(mission, ['id', 'kind', 'tier', 'target', 'reward'])) throw new Error('Mission has invalid fields');
    if (typeof mission.id !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(mission.id) || ids.has(mission.id)) throw new Error('Mission ID must be unique lowercase kebab-case');
    ids.add(mission.id);
    const kind = mission.kind;
    if (kind !== 'coins' && kind !== 'distance' && kind !== 'powerups') throw new Error('Unknown mission kind');
    const chain = chains[kind];
    if (mission.tier !== chain.tier + 1 || !positive(mission.target) || mission.target <= chain.target || !positive(mission.reward)) throw new Error('Mission tiers, targets or rewards are invalid');
    chain.tier = mission.tier;
    chain.target = mission.target;
  }
  if (Object.values(chains).some((chain) => chain.tier !== 3)) throw new Error('Every mission chain needs three tiers');
}

validateEconomyBalance();
