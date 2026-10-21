import { ECONOMY_BALANCE, MISSIONS_BY_KIND, PROFILE_KEY } from './config';
import { cappedAdd, freezeProfile, getMissionViews, isSafeCounter, isUpgradeType, loadProfile, missionTotal } from './profile';
import type { MissionKind, MissionView, PlayerProfile, ProfileStorage, ProgressionEvent, RunProgress, RunSettlement, TransactionResult, UpgradeLevel, UpgradeType } from './types';

interface RunWatermark {
  readonly id: string;
  tick: number;
  distance: number;
  coins: number;
  powerupsCollected: number;
  settled: boolean;
  status: RunProgress['status'];
}

function validRun(run: RunProgress): boolean {
  return typeof run.id === 'string' && run.id.length > 0 && run.id.length <= 160 && isSafeCounter(run.tick)
    && Number.isFinite(run.distance) && run.distance >= 0 && run.distance <= Number.MAX_SAFE_INTEGER
    && isSafeCounter(run.coins) && isSafeCounter(run.powerupsCollected) && isSafeCounter(run.score)
    && ['ready', 'running', 'paused', 'over'].includes(run.status);
}

/** Synchronous in-memory transactions, with a single failure-tolerant persistence seam. */
export class ProfileController {
  private profile: PlayerProfile;
  private run: RunWatermark | null = null;
  private readonly retiredIds: string[] = [];
  private readonly events: ProgressionEvent[] = [];
  private readonly completed = new Set<string>();
  private dirty = false;
  private storageFailed = false;
  private settlement: RunSettlement | null = null;
  readonly recovered: boolean;
  readonly migrated: boolean;
  readonly unsupportedSchema: boolean;

  constructor(private readonly storage?: ProfileStorage) {
    const loaded = loadProfile(storage);
    this.profile = loaded.profile;
    this.recovered = loaded.recovered;
    this.migrated = loaded.migrated;
    this.unsupportedSchema = loaded.unsupportedSchema;
    this.storageFailed = loaded.unsupportedSchema;
    this.dirty = loaded.recovered || loaded.migrated;
    // Loading an already complete task must not replay its completion sound.
    for (const mission of this.missions()) if (mission.completed) this.completed.add(mission.id);
  }

  get snapshot(): PlayerProfile { return this.profile; }
  getSnapshot = (): PlayerProfile => this.profile;
  get persistenceFailed(): boolean { return this.storageFailed; }
  get lastSettlement(): RunSettlement | null { return this.settlement; }
  missions(): readonly MissionView[] { return getMissionViews(this.profile); }

  /** UI can show each chain's first unclaimed tier, or its final claimed tier. */
  currentMissions(): readonly MissionView[] {
    const all = this.missions();
    return ['coins', 'distance', 'powerups'].flatMap((kind) => {
      const chain = all.filter((mission) => mission.kind === kind);
      const current = chain.find((mission) => !mission.claimed) ?? chain.at(-1);
      return current === undefined ? [] : [current];
    });
  }

  get hasEvents(): boolean { return this.events.length > 0; }

  drainEvents(): readonly ProgressionEvent[] { return this.events.splice(0); }

  /** Runtime supplies a new identity at tick zero; only completed runs enter the wallet. */
  observeRun(facts: RunProgress): RunSettlement | null {
    if (!validRun(facts)) return null;
    if (this.run?.id !== facts.id) {
      if (this.retiredIds.includes(facts.id) || facts.tick !== 0 || (facts.status !== 'ready' && facts.status !== 'running')) return null;
      if (this.run !== null) {
        this.retiredIds.push(this.run.id);
        if (this.retiredIds.length > ECONOMY_BALANCE.retiredRunCapacity) this.retiredIds.shift();
      }
      this.run = { id: facts.id, tick: -1, distance: 0, coins: 0, powerupsCollected: 0, settled: false, status: facts.status };
      this.settlement = null;
    }
    const run = this.run;
    if (run.settled || facts.tick < run.tick) return null;
    if (facts.tick === run.tick && facts.status === run.status) return null;
    const distance = Math.floor(facts.distance);
    const distanceDelta = Math.max(0, distance - run.distance);
    const coinsDelta = Math.max(0, facts.coins - run.coins);
    const powerupsDelta = Math.max(0, facts.powerupsCollected - run.powerupsCollected);
    const previous = this.profile;
    const over = facts.status === 'over';
    const walletAdded = over ? Math.min(facts.coins, Number.MAX_SAFE_INTEGER - previous.walletCoins) : 0;
    if (!over && distanceDelta === 0 && coinsDelta === 0 && powerupsDelta === 0
      && facts.score <= previous.bestScore && distance <= previous.bestDistance) {
      run.tick = facts.tick; run.status = facts.status;
      if (facts.status === 'paused') this.flush();
      return null;
    }
    const next: PlayerProfile = {
      ...previous, walletCoins: previous.walletCoins + walletAdded,
      bestDistance: Math.max(previous.bestDistance, distance), bestScore: Math.max(previous.bestScore, facts.score),
      statistics: {
        totalCoins: cappedAdd(previous.statistics.totalCoins, coinsDelta),
        totalDistance: cappedAdd(previous.statistics.totalDistance, distanceDelta),
        powerupsCollected: cappedAdd(previous.statistics.powerupsCollected, powerupsDelta),
        runsCompleted: cappedAdd(previous.statistics.runsCompleted, over ? 1 : 0),
      },
    };
    run.tick = facts.tick;
    run.status = facts.status;
    run.distance = Math.max(run.distance, distance);
    run.coins = Math.max(run.coins, facts.coins);
    run.powerupsCollected = Math.max(run.powerupsCollected, facts.powerupsCollected);
    if (distanceDelta !== 0 || coinsDelta !== 0 || powerupsDelta !== 0 || over || next.bestScore !== previous.bestScore || next.bestDistance !== previous.bestDistance) this.replace(next);
    if (coinsDelta !== 0) this.detectCompletion('coins');
    if (distanceDelta !== 0) this.detectCompletion('distance');
    if (powerupsDelta !== 0) this.detectCompletion('powerups');
    if (over) {
      run.settled = true;
      this.settlement = Object.freeze({ runId: facts.id, runCoins: facts.coins, walletAdded, walletCoins: this.profile.walletCoins, score: facts.score, distance });
      this.flush();
      return this.settlement;
    }
    if (facts.status === 'paused') this.flush();
    return null;
  }

  purchase(type: UpgradeType, expectedLevel: UpgradeLevel): TransactionResult {
    if (!isUpgradeType(type)) return { ok: false, reason: 'invalid-upgrade' };
    const level = this.profile.upgrades[type];
    if (expectedLevel !== level) return { ok: false, reason: 'stale-level' };
    if (level === ECONOMY_BALANCE.maxUpgradeLevel) return { ok: false, reason: 'max-level' };
    const price = ECONOMY_BALANCE.upgradePrices[level];
    if (this.profile.walletCoins < price) return { ok: false, reason: 'insufficient-coins' };
    const nextLevel: UpgradeLevel = level === 0 ? 1 : level === 1 ? 2 : 3;
    this.replace({ ...this.profile, walletCoins: this.profile.walletCoins - price, upgrades: { ...this.profile.upgrades, [type]: nextLevel } });
    const event: ProgressionEvent = { type: 'UPGRADE_PURCHASED', upgrade: type, level: nextLevel, price, walletCoins: this.profile.walletCoins };
    this.emit(event);
    this.flush();
    return { ok: true, event };
  }

  claim(missionId: string): TransactionResult {
    const mission = this.missions().find((candidate) => candidate.id === missionId);
    if (mission === undefined) return { ok: false, reason: 'unknown-mission' };
    if (mission.claimed) return { ok: false, reason: 'already-claimed' };
    if (!mission.unlocked) return { ok: false, reason: 'locked' };
    if (!mission.completed) return { ok: false, reason: 'incomplete' };
    const reward = Math.min(mission.reward, Number.MAX_SAFE_INTEGER - this.profile.walletCoins);
    this.replace({ ...this.profile, walletCoins: this.profile.walletCoins + reward, missions: { claimed: [...this.profile.missions.claimed, mission.id] } });
    const event: ProgressionEvent = { type: 'MISSION_REWARD_CLAIMED', missionId: mission.id, reward, walletCoins: this.profile.walletCoins };
    this.emit(event);
    this.detectCompletion(mission.kind);
    this.flush();
    return { ok: true, event };
  }

  /** Pause, hidden-page and transactions are checkpoints; fixed ticks never write storage. */
  flush(): boolean {
    // A downgraded application may play in memory, but must preserve newer saved data.
    if (this.unsupportedSchema) return false;
    if (!this.dirty) return !this.storageFailed;
    if (this.storage === undefined) return true;
    try {
      this.storage.setItem(PROFILE_KEY, JSON.stringify(this.profile));
      this.dirty = false;
      this.storageFailed = false;
      return true;
    } catch {
      this.storageFailed = true;
      return false;
    }
  }

  private replace(next: PlayerProfile): void { this.profile = freezeProfile(next); this.dirty = true; }

  private detectCompletion(kind: MissionKind): void {
    const mission = MISSIONS_BY_KIND[kind].find((candidate) => !this.profile.missions.claimed.includes(candidate.id));
    if (mission === undefined || this.completed.has(mission.id) || missionTotal(this.profile, kind) < mission.target) return;
    this.completed.add(mission.id);
    this.emit({ type: 'MISSION_COMPLETED', missionId: mission.id, reward: mission.reward });
  }

  private emit(event: ProgressionEvent): void {
    this.events.push(Object.freeze(event));
    if (this.events.length > ECONOMY_BALANCE.eventCapacity) this.events.shift();
  }
}
