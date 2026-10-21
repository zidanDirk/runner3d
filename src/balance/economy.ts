import { ProfileController } from '../progression/ProfileController';
import { ECONOMY_BALANCE, MISSION_CHAINS } from '../progression/config';
import { POWERUP_TYPES } from '../game/balance';
import { simulateRun, PRODUCTION_BINDINGS } from './simulator';
import type { SimulationBindings, SimulationResult } from './simulator';
import type { BotProfileName } from './profiles';
import type { UpgradeType, UpgradeLevel, MissionDefinition } from '../progression/types';

export const PURCHASE_ORDERS = ['magnet-first', 'shield-first', 'double-score-first', 'cheapest-first'] as const;
export type PurchaseOrder = typeof PURCHASE_ORDERS[number];
export interface EconomyBindings { readonly Profile: typeof ProfileController; readonly prices: readonly number[]; readonly missions: readonly MissionDefinition[] }
export const PRODUCTION_ECONOMY: EconomyBindings = { Profile: ProfileController, prices: ECONOMY_BALANCE.upgradePrices, missions: MISSION_CHAINS };
export interface PurchaseRecord { readonly run: number; readonly item: UpgradeType; readonly level: number; readonly cost: number; readonly cumulativeSeconds: number }
export interface CareerResult {
  readonly profile: BotProfileName; readonly order: PurchaseOrder; readonly seed: string; readonly runs: number; readonly deaths: number; readonly censoredRuns: number;
  readonly seconds: number; readonly ticks: number; readonly distance: number; readonly score: number; readonly settledCoins: number; readonly observedCoins: number; readonly missionRewards: number;
  readonly rewardShare: number; readonly spent: number; readonly wallet: number; readonly firstUpgradeRun: number | null; readonly secondUpgradeRun: number | null;
  readonly maxLevelRun: number | null; readonly maxLevelCensored: boolean; readonly missionClaimRun: Readonly<Record<string, number | null>>; readonly purchases: readonly PurchaseRecord[];
  readonly finalUpgrades: Readonly<Record<UpgradeType, UpgradeLevel>>;
}
function nextPurchase(profile: ProfileController, order: PurchaseOrder, prices: readonly number[]): UpgradeType | null {
  const available = POWERUP_TYPES.filter(type => profile.snapshot.upgrades[type] < 3);
  if (order === 'cheapest-first') return [...available].sort((a, b) => (prices[profile.snapshot.upgrades[a]] ?? Infinity) - (prices[profile.snapshot.upgrades[b]] ?? Infinity))[0] ?? null;
  const priority: readonly UpgradeType[] = order === 'magnet-first' ? ['magnet', 'shield', 'double-score'] : order === 'shield-first' ? ['shield', 'magnet', 'double-score'] : ['double-score', 'magnet', 'shield'];
  return priority.find(type => available.includes(type)) ?? null;
}
/** Real careers settle actual deaths; a cap survivor is an abandoned/censored run, never fabricated as a death. */
export function simulateCareer(input: { seed: string; profile: BotProfileName; order: PurchaseOrder; runs: number; distance: number }, game: SimulationBindings = PRODUCTION_BINDINGS, economy: EconomyBindings = PRODUCTION_ECONOMY): CareerResult {
  if (!Number.isInteger(input.runs) || input.runs < 1 || input.runs > 1000 || !PURCHASE_ORDERS.includes(input.order)) throw new Error('Invalid career options');
  const profile = new economy.Profile(), purchases: PurchaseRecord[] = [];
  const missionClaimRun = Object.fromEntries(economy.missions.map(mission => [mission.id, null])) as Record<string, number | null>;
  let deaths = 0, censoredRuns = 0, seconds = 0, ticks = 0, distance = 0, score = 0, settledCoins = 0, observedCoins = 0, missionRewards = 0, spent = 0, maxLevelRun: number | null = null;
  for (let index = 0; index < input.runs; index++) {
    const run = index + 1, seed = `${input.seed}:${input.profile}:career:${index}`;
    const result: SimulationResult = simulateRun({ seed, profile: input.profile, distance: input.distance, upgrades: profile.snapshot.upgrades }, game);
    profile.observeRun({ id: seed, tick: 0, distance: 0, coins: 0, powerupsCollected: 0, score: 0, status: 'running' });
    const facts = { id: seed, tick: result.ticks, distance: result.distance, coins: result.coins, powerupsCollected: result.pickups, score: result.score, status: result.status === 'over' ? 'over' as const : 'running' as const };
    profile.observeRun(facts);
    // Verify the actual controller's duplicate-settlement guard on every career run.
    const wallet = profile.snapshot.walletCoins; profile.observeRun(facts);
    if (profile.snapshot.walletCoins !== wallet) throw new Error('Duplicate career settlement detected');
    if (result.status === 'over') { deaths++; settledCoins += result.coins; } else censoredRuns++;
    ticks += result.ticks; seconds += result.seconds; distance += result.distance; score += result.score; observedCoins += result.coins;
    for (let tier = 0; tier < 3; tier++) for (const mission of profile.currentMissions()) if (mission.completed && !mission.claimed) {
      const claim = profile.claim(mission.id);
      if (!claim.ok || claim.event.type !== 'MISSION_REWARD_CLAIMED') throw new Error('Valid career claim failed');
      missionRewards += claim.event.reward; missionClaimRun[mission.id] = run;
      if (profile.claim(mission.id).ok) throw new Error('Duplicate career reward detected');
    }
    for (let count = 0; count < 9; count++) {
      const item = nextPurchase(profile, input.order, economy.prices);
      if (item === null) break;
      const level = profile.snapshot.upgrades[item], cost = economy.prices[level];
      if (cost === undefined || profile.snapshot.walletCoins < cost) break;
      const transaction = profile.purchase(item, level);
      if (!transaction.ok) throw new Error('Affordable career purchase failed');
      spent += cost; purchases.push({ run, item, level: level + 1, cost, cumulativeSeconds: seconds });
    }
    if (maxLevelRun === null && POWERUP_TYPES.every(type => profile.snapshot.upgrades[type] === 3)) maxLevelRun = run;
    profile.drainEvents();
  }
  if (settledCoins + missionRewards - spent !== profile.snapshot.walletCoins) throw new Error('Career money conservation failed');
  return { profile: input.profile, order: input.order, seed: input.seed, runs: input.runs, deaths, censoredRuns, seconds, ticks, distance, score, settledCoins, observedCoins, missionRewards,
    rewardShare: missionRewards / Math.max(1, settledCoins + missionRewards), spent, wallet: profile.snapshot.walletCoins,
    firstUpgradeRun: purchases[0]?.run ?? null, secondUpgradeRun: purchases[1]?.run ?? null, maxLevelRun, maxLevelCensored: maxLevelRun === null, missionClaimRun, purchases, finalUpgrades: profile.snapshot.upgrades };
}
