import { describe, expect, it } from 'vitest';
import {
  ECONOMY_BALANCE, LEGACY_BEST_KEY, MISSION_CHAINS, PROFILE_KEY, ProfileController,
  defaultProfile, getMissionViews, parseProfile, validateEconomyBalance,
} from '../../src/progression';
import type { PlayerProfile, ProfileStorage, RunProgress, UpgradeType } from '../../src/progression';

class MemoryStorage implements ProfileStorage {
  readonly data = new Map<string, string>();
  writes = 0;
  failRead = false;
  failWrite = false;
  getItem(key: string): string | null {
    if (this.failRead) throw new Error('Storage denied');
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrite) throw new Error('Storage quota');
    this.writes++;
    this.data.set(key, value);
  }
}

function saved(overrides: Partial<PlayerProfile> = {}): MemoryStorage {
  const storage = new MemoryStorage();
  storage.data.set(PROFILE_KEY, JSON.stringify({ ...defaultProfile(), ...overrides }));
  return storage;
}

function facts(overrides: Partial<RunProgress> = {}): RunProgress {
  return { id: 'run-1', tick: 0, distance: 0, coins: 0, powerupsCollected: 0, score: 0, status: 'running', ...overrides };
}

function start(controller: ProfileController, id = 'run-1'): void { controller.observeRun(facts({ id })); }

describe('wallet settlement and bounded run observation', () => {
  it('credits wallet only once at actual game over and keeps run coins separate from score', () => {
    const storage = new MemoryStorage(); const profile = new ProfileController(storage); start(profile);
    const running = facts({ tick: 120, distance: 16.5, coins: 7, score: 366 });
    profile.observeRun(running);
    expect(profile.snapshot.walletCoins).toBe(0);
    expect(profile.snapshot.statistics.totalCoins).toBe(7);
    const over = { ...running, status: 'over' as const };
    expect(profile.observeRun(over)).toEqual({ runId: 'run-1', runCoins: 7, walletAdded: 7, walletCoins: 7, score: 366, distance: 16 });
    for (let i = 0; i < 10; i++) profile.observeRun(over);
    expect(profile.snapshot.walletCoins).toBe(7);
    expect(profile.snapshot.statistics.runsCompleted).toBe(1);
    expect(storage.writes).toBe(1);
  });

  it('ignores repeated, stale and regressing facts without recounting positive deltas', () => {
    const profile = new ProfileController(); start(profile);
    const first = facts({ tick: 10, distance: 8.9, coins: 3, powerupsCollected: 1, score: 83 });
    profile.observeRun(first); const snapshot = profile.snapshot;
    profile.observeRun(first);
    profile.observeRun({ ...first, tick: 9, coins: 999, distance: 999 });
    expect(profile.snapshot).toBe(snapshot);
    profile.observeRun({ ...first, tick: 11, distance: 7, coins: 2, powerupsCollected: 0 });
    profile.observeRun({ ...first, tick: 12, distance: 9.1, coins: 4, powerupsCollected: 2 });
    expect(profile.snapshot.statistics).toEqual({ totalCoins: 4, totalDistance: 9, powerupsCollected: 2, runsCompleted: 0 });
  });

  it('retains career progress from abandonment but awards no wallet coins', () => {
    const profile = new ProfileController(); start(profile);
    profile.observeRun(facts({ tick: 50, distance: 101.8, coins: 12, powerupsCollected: 2, score: 401 }));
    start(profile, 'run-2');
    expect(profile.lastSettlement).toBeNull();
    expect(profile.snapshot.walletCoins).toBe(0);
    profile.observeRun(facts({ id: 'run-2', tick: 1, distance: 2.5, coins: 3, score: 77, status: 'over' }));
    expect(profile.snapshot.walletCoins).toBe(3);
    expect(profile.snapshot.statistics).toEqual({ totalCoins: 15, totalDistance: 103, powerupsCollected: 2, runsCompleted: 1 });
    expect(profile.snapshot.bestScore).toBe(401);
    expect(profile.snapshot.bestDistance).toBe(101);
  });

  it('never reopens a recently retired run and rejects unknown mid-run events', () => {
    const profile = new ProfileController(); start(profile);
    profile.observeRun(facts({ tick: 2, coins: 10, status: 'over' }));
    start(profile, 'run-2');
    profile.observeRun(facts());
    profile.observeRun(facts({ tick: 2, coins: 10, status: 'over' }));
    profile.observeRun(facts({ id: 'unregistered', tick: 100, coins: 100, status: 'over' }));
    expect(profile.snapshot.walletCoins).toBe(10);
    expect(profile.snapshot.statistics.runsCompleted).toBe(1);
  });

  it('new run IDs do not duplicate a completed run when counters reset', () => {
    const profile = new ProfileController();
    for (let run = 0; run < 100; run++) {
      const id = `session-run-${run}`; start(profile, id);
      profile.observeRun(facts({ id, tick: 50, distance: 10.7, coins: 5, powerupsCollected: 1, score: 135, status: 'over' }));
    }
    expect(profile.snapshot.walletCoins).toBe(500);
    expect(profile.snapshot.statistics).toEqual({ totalCoins: 500, totalDistance: 1000, powerupsCollected: 100, runsCompleted: 100 });
    expect(profile.drainEvents().length).toBeLessThanOrEqual(ECONOMY_BALANCE.eventCapacity);
  });

  it('flushes on pause and game over, with zero per-tick storage writes', () => {
    const storage = new MemoryStorage(); const profile = new ProfileController(storage); start(profile);
    for (let tick = 1; tick <= 1200; tick++) profile.observeRun(facts({ tick, distance: tick * .14, coins: Math.floor(tick / 40), score: tick }));
    expect(storage.writes).toBe(0);
    profile.observeRun(facts({ tick: 1200, distance: 168, coins: 30, score: 1200, status: 'paused' }));
    expect(storage.writes).toBe(1);
    profile.observeRun(facts({ tick: 1200, distance: 168, coins: 30, score: 1200, status: 'paused' }));
    expect(storage.writes).toBe(1);
    profile.observeRun(facts({ tick: 1201, distance: 168.14, coins: 30, score: 1201, status: 'over' }));
    expect(storage.writes).toBe(2);
  });

  it('uses integer cumulative meters without dropping each tick fractional movement', () => {
    const profile = new ProfileController(); start(profile);
    for (let tick = 1; tick <= 120; tick++) profile.observeRun(facts({ tick, distance: tick / 120 * 16, score: Math.floor(tick / 120 * 16) }));
    expect(profile.snapshot.statistics.totalDistance).toBe(16);
    expect(profile.snapshot.bestDistance).toBe(16);
  });

  it.each([NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1])('rejects illegal numeric run facts %s', (illegal) => {
    const profile = new ProfileController(); start(profile);
    const before = profile.snapshot;
    profile.observeRun(facts({ tick: 1, coins: illegal }));
    profile.observeRun(facts({ tick: 1, score: illegal }));
    profile.observeRun(facts({ tick: 1, distance: illegal }));
    profile.observeRun(facts({ tick: illegal }));
    expect(profile.snapshot).toBe(before);
  });

  it('saturates valid counter additions and never produces an unsafe wallet', () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    const storage = saved({ walletCoins: maximum - 2, statistics: { totalCoins: maximum - 1, totalDistance: maximum - 1, powerupsCollected: maximum - 1, runsCompleted: maximum } });
    const profile = new ProfileController(storage); start(profile);
    const settlement = profile.observeRun(facts({ tick: 1, distance: 100, coins: 10, powerupsCollected: 3, score: 350, status: 'over' }));
    expect(settlement?.walletAdded).toBe(2);
    expect(profile.snapshot.walletCoins).toBe(maximum);
    expect(Object.values(profile.snapshot.statistics).every((value) => Number.isSafeInteger(value) && value >= 0)).toBe(true);
    expect(profile.snapshot.statistics).toEqual({ totalCoins: maximum, totalDistance: maximum, powerupsCollected: maximum, runsCompleted: maximum });
  });
});

describe('upgrade purchase transactions', () => {
  it.each<UpgradeType>(['magnet', 'shield', 'double-score'])('buys all three levels of %s using configured increasing prices', (type) => {
    const storage = saved({ walletCoins: 850 }); const profile = new ProfileController(storage);
    expect(profile.purchase(type, 0)).toMatchObject({ ok: true, event: { type: 'UPGRADE_PURCHASED', upgrade: type, level: 1, price: 100 } });
    expect(profile.purchase(type, 1)).toMatchObject({ ok: true, event: { level: 2, price: 250 } });
    expect(profile.purchase(type, 2)).toMatchObject({ ok: true, event: { level: 3, price: 500 } });
    expect(profile.snapshot.walletCoins).toBe(0);
    expect(profile.snapshot.upgrades[type]).toBe(3);
    expect(profile.purchase(type, 3)).toEqual({ ok: false, reason: 'max-level' });
    expect(storage.writes).toBe(3);
    expect(new ProfileController(storage).snapshot).toEqual(profile.snapshot);
  });

  it('rejects insufficient balance without mutation, notification or storage write', () => {
    const storage = saved({ walletCoins: 99 }); const profile = new ProfileController(storage); const before = profile.snapshot;
    expect(profile.purchase('magnet', 0)).toEqual({ ok: false, reason: 'insufficient-coins' });
    expect(profile.snapshot).toBe(before); expect(profile.drainEvents()).toEqual([]); expect(storage.writes).toBe(0);
  });

  it('guards stale duplicate clicks with the level displayed when the button was rendered', () => {
    const profile = new ProfileController(saved({ walletCoins: 1000 }));
    expect(profile.purchase('shield', 0).ok).toBe(true);
    for (let click = 0; click < 30; click++) expect(profile.purchase('shield', 0)).toEqual({ ok: false, reason: 'stale-level' });
    expect(profile.snapshot.walletCoins).toBe(900); expect(profile.snapshot.upgrades.shield).toBe(1);
    expect(profile.drainEvents()).toHaveLength(1);
  });

  it('purchasing one item leaves other levels and unrelated profile facts unchanged', () => {
    const profile = new ProfileController(saved({ walletCoins: 500, bestScore: 1234, bestDistance: 550 }));
    profile.purchase('double-score', 0);
    expect(profile.snapshot.upgrades).toEqual({ magnet: 0, shield: 0, 'double-score': 1 });
    expect(profile.snapshot.bestScore).toBe(1234); expect(profile.snapshot.bestDistance).toBe(550);
    expect(profile.snapshot.statistics).toEqual(defaultProfile().statistics);
  });
});

describe('cumulative fixed mission chains', () => {
  it('updates progress from earned run deltas and emits completion exactly once', () => {
    const profile = new ProfileController(); start(profile);
    profile.observeRun(facts({ tick: 1, coins: 99, distance: 999.8, powerupsCollected: 4 }));
    expect(profile.currentMissions().map((mission) => mission.progress)).toEqual([99, 999, 4]);
    expect(profile.drainEvents()).toEqual([]);
    const event = facts({ tick: 2, coins: 100, distance: 1000, powerupsCollected: 5 });
    profile.observeRun(event); profile.observeRun(event);
    expect(profile.drainEvents().map((completion) => completion.type)).toEqual(['MISSION_COMPLETED', 'MISSION_COMPLETED', 'MISSION_COMPLETED']);
    expect(profile.drainEvents()).toEqual([]);
    expect(profile.snapshot.walletCoins).toBe(0);
    expect(profile.currentMissions().every((mission) => mission.completed)).toBe(true);
  });

  it('grants a configured reward once and unlocks the next cumulative tier', () => {
    const profile = new ProfileController(); start(profile);
    profile.observeRun(facts({ tick: 1, coins: 120 })); profile.drainEvents();
    expect(profile.claim('coins-1')).toMatchObject({ ok: true, event: { type: 'MISSION_REWARD_CLAIMED', missionId: 'coins-1', reward: 40 } });
    expect(profile.snapshot.walletCoins).toBe(40);
    expect(profile.currentMissions()[0]).toMatchObject({ id: 'coins-2', progress: 120, target: 300, unlocked: true, completed: false });
    for (let click = 0; click < 20; click++) expect(profile.claim('coins-1')).toEqual({ ok: false, reason: 'already-claimed' });
    expect(profile.snapshot.walletCoins).toBe(40);
  });

  it('cannot claim incomplete, locked or unknown missions', () => {
    const profile = new ProfileController();
    expect(profile.claim('coins-1')).toEqual({ ok: false, reason: 'incomplete' });
    expect(profile.claim('coins-2')).toEqual({ ok: false, reason: 'locked' });
    expect(profile.claim('unknown')).toEqual({ ok: false, reason: 'unknown-mission' });
    expect(profile.snapshot.walletCoins).toBe(0); expect(profile.drainEvents()).toEqual([]);
  });

  it('unlocks already-reached higher tiers at claim time without recounting totals', () => {
    const profile = new ProfileController(); start(profile);
    profile.observeRun(facts({ tick: 1, coins: 800 }));
    expect(profile.drainEvents()).toEqual([{ type: 'MISSION_COMPLETED', missionId: 'coins-1', reward: 40 }]);
    profile.claim('coins-1');
    expect(profile.drainEvents()).toEqual([
      { type: 'MISSION_REWARD_CLAIMED', missionId: 'coins-1', reward: 40, walletCoins: 40 },
      { type: 'MISSION_COMPLETED', missionId: 'coins-2', reward: 80 },
    ]);
    profile.claim('coins-2'); profile.claim('coins-3');
    expect(profile.snapshot.statistics.totalCoins).toBe(800);
    expect(profile.snapshot.walletCoins).toBe(270);
    expect(profile.currentMissions()[0]).toMatchObject({ id: 'coins-3', completed: true, claimed: true });
    expect(profile.snapshot.missions.claimed).toEqual(['coins-1', 'coins-2', 'coins-3']);
  });

  it('restores claimed missions and never replays stored completion events', () => {
    const storage = new MemoryStorage(); const first = new ProfileController(storage); start(first);
    first.observeRun(facts({ tick: 1, coins: 300, distance: 1000, powerupsCollected: 5 }));
    first.claim('coins-1'); first.flush();
    const reopened = new ProfileController(storage);
    expect(reopened.snapshot).toEqual(first.snapshot);
    expect(reopened.drainEvents()).toEqual([]);
    expect(reopened.claim('coins-1')).toEqual({ ok: false, reason: 'already-claimed' });
    expect(reopened.claim('coins-2').ok).toBe(true);
    expect(reopened.snapshot.walletCoins).toBe(120);
  });

  it('has only nine finite tasks with unique IDs and increasing goals', () => {
    expect(MISSION_CHAINS).toHaveLength(9);
    expect(new Set(MISSION_CHAINS.map((mission) => mission.id)).size).toBe(9);
    for (const kind of ['coins', 'distance', 'powerups']) {
      const chain = MISSION_CHAINS.filter((mission) => mission.kind === kind);
      expect(chain.map((mission) => mission.tier)).toEqual([1, 2, 3]);
      expect(chain.every((mission, index) => index === 0 || mission.target > (chain[index - 1]?.target ?? Infinity))).toBe(true);
    }
    expect(getMissionViews(defaultProfile()).filter((mission) => mission.unlocked)).toHaveLength(3);
  });
});

describe('schema validation, migration and storage failure recovery', () => {
  it('loads a valid schema using immutable snapshots', () => {
    const storage = saved({ walletCoins: 321, bestScore: 444, bestDistance: 222, upgrades: { magnet: 1, shield: 2, 'double-score': 3 } });
    const profile = new ProfileController(storage);
    expect(profile.snapshot).toMatchObject({ schemaVersion: 1, walletCoins: 321, bestScore: 444, bestDistance: 222 });
    expect(profile.getSnapshot()).toBe(profile.snapshot);
    expect(Object.isFrozen(profile.snapshot)).toBe(true);
    expect(Object.isFrozen(profile.snapshot.upgrades)).toBe(true);
    expect(Object.isFrozen(profile.snapshot.missions.claimed)).toBe(true);
    expect(profile.recovered).toBe(false); expect(profile.migrated).toBe(false);
  });

  it('migrates the legacy personal-best key without removing unrelated settings', () => {
    const storage = new MemoryStorage(); storage.data.set(LEGACY_BEST_KEY, '8750');
    storage.data.set('runner3d-quality-v1', 'low'); storage.data.set('runner3d-audio-v1', '{"muted":true}');
    const profile = new ProfileController(storage);
    expect(profile.snapshot.bestScore).toBe(8750); expect(profile.migrated).toBe(true);
    profile.flush();
    expect(new ProfileController(storage).snapshot.bestScore).toBe(8750);
    expect(storage.data.get(LEGACY_BEST_KEY)).toBe('8750');
    expect(storage.data.get('runner3d-quality-v1')).toBe('low');
    expect(storage.data.get('runner3d-audio-v1')).toBe('{"muted":true}');
  });

  it.each(['not-json', '{', 'null', '[]'])('safely recovers invalid storage %s', (raw) => {
    const storage = new MemoryStorage(); storage.data.set(PROFILE_KEY, raw);
    const profile = new ProfileController(storage);
    expect(profile.snapshot).toEqual(defaultProfile()); expect(profile.recovered).toBe(true);
    profile.flush(); expect(new ProfileController(storage).snapshot).toEqual(defaultProfile());
  });

  it('preserves newer-schema raw data while allowing memory-only play', () => {
    const storage = new MemoryStorage(); const future = '{"schemaVersion":2,"walletCoins":9999,"futureField":true}';
    storage.data.set(PROFILE_KEY, future);
    const profile = new ProfileController(storage); start(profile);
    profile.observeRun(facts({ tick: 1, coins: 100, status: 'over' }));
    expect(profile.snapshot.walletCoins).toBe(100);
    expect(profile.purchase('magnet', 0).ok).toBe(true);
    expect(profile.flush()).toBe(false);
    expect(profile.unsupportedSchema).toBe(true); expect(profile.persistenceFailed).toBe(true);
    expect(storage.writes).toBe(0); expect(storage.data.get(PROFILE_KEY)).toBe(future);
  });

  it.each([-1, .5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects illegal persisted money/counters %s', (value) => {
    expect(parseProfile({ ...defaultProfile(), walletCoins: value })).toBeNull();
    expect(parseProfile({ ...defaultProfile(), bestScore: value })).toBeNull();
    expect(parseProfile({ ...defaultProfile(), statistics: { ...defaultProfile().statistics, totalCoins: value } })).toBeNull();
  });

  it('rejects unknown fields, missing fields, impossible upgrade levels and invalid task states', () => {
    const base = defaultProfile();
    expect(parseProfile({ ...base, schemaVersion: 99 })).toBeNull();
    expect(parseProfile({ ...base, bonusCoins: 999 })).toBeNull();
    expect(parseProfile({ ...base, upgrades: { ...base.upgrades, magnet: 4 } })).toBeNull();
    expect(parseProfile({ ...base, upgrades: { ...base.upgrades, shield: 1.5 } })).toBeNull();
    expect(parseProfile({ ...base, upgrades: { magnet: 0, shield: 0 } })).toBeNull();
    expect(parseProfile({ ...base, missions: { claimed: ['coins-1', 'coins-1'] } })).toBeNull();
    expect(parseProfile({ ...base, missions: { claimed: ['nonexistent'] } })).toBeNull();
    expect(parseProfile({ ...base, missions: { claimed: ['coins-1'] } })).toBeNull();
    expect(parseProfile({ ...base, statistics: { ...base.statistics, totalCoins: 800 }, missions: { claimed: ['coins-3'] } })).toBeNull();
    expect(parseProfile({ ...base, missions: { claimed: [], active: 'coins-1' } })).toBeNull();
  });

  it('survives unavailable storage and quota failures while transactions remain usable in memory', () => {
    const unavailable = new MemoryStorage(); unavailable.failRead = true; unavailable.failWrite = true;
    const profile = new ProfileController(unavailable); start(profile);
    expect(() => profile.observeRun(facts({ tick: 1, coins: 100, status: 'over' }))).not.toThrow();
    expect(profile.snapshot.walletCoins).toBe(100); expect(profile.persistenceFailed).toBe(true);
    expect(profile.purchase('magnet', 0).ok).toBe(true);
    expect(profile.snapshot.walletCoins).toBe(0); expect(profile.snapshot.upgrades.magnet).toBe(1);
    unavailable.failRead = false; unavailable.failWrite = false;
    expect(profile.flush()).toBe(true); expect(profile.persistenceFailed).toBe(false);
    expect(new ProfileController(unavailable).snapshot).toEqual(profile.snapshot);
  });

  it('does not repeatedly write unchanged profiles and supports explicitly injected absence of storage', () => {
    const storage = saved(); const profile = new ProfileController(storage);
    expect(profile.flush()).toBe(true); expect(profile.flush()).toBe(true); expect(storage.writes).toBe(0);
    const ephemeral = new ProfileController(); start(ephemeral);
    ephemeral.observeRun(facts({ tick: 1, coins: 3, status: 'over' }));
    expect(ephemeral.flush()).toBe(true); expect(ephemeral.snapshot.walletCoins).toBe(3);
  });

  it('invalid legacy best cannot create unsafe profile counters', () => {
    for (const value of ['NaN', 'Infinity', '-1', '1.5', '9007199254740992', '']) {
      const storage = new MemoryStorage(); storage.data.set(LEGACY_BEST_KEY, value);
      expect(new ProfileController(storage).snapshot.bestScore).toBe(0);
    }
  });
});

describe('economy balance validation', () => {
  it('accepts actual balance configuration and fixed cumulative chains', () => {
    expect(() => validateEconomyBalance()).not.toThrow();
    expect(ECONOMY_BALANCE.upgradePrices).toEqual([100, 250, 500]);
  });

  it.each([[0, 250, 500], [100, 100, 500], [100, 500, 250], [100, 250], [100, 250, Infinity], [100, 250, Number.MAX_SAFE_INTEGER + 1]])('rejects unsafe or non-increasing prices %j', (...prices) => {
    expect(() => validateEconomyBalance({ ...ECONOMY_BALANCE, upgradePrices: prices })).toThrow();
  });

  it('rejects unknown fields, excessive capacities and changed level count', () => {
    expect(() => validateEconomyBalance({ ...ECONOMY_BALANCE, unknown: true })).toThrow();
    expect(() => validateEconomyBalance({ ...ECONOMY_BALANCE, maxUpgradeLevel: 4 })).toThrow();
    expect(() => validateEconomyBalance({ ...ECONOMY_BALANCE, eventCapacity: 0 })).toThrow();
    expect(() => validateEconomyBalance({ ...ECONOMY_BALANCE, retiredRunCapacity: 129 })).toThrow();
  });

  it('rejects duplicated IDs, broken tiers, decreasing targets and unsafe rewards', () => {
    const first = MISSION_CHAINS[0];
    if (first === undefined) throw new Error('Expected configured mission');
    for (const replacement of [
      { ...first, id: 'coins-2' }, { ...first, id: 'Bad ID' }, { ...first, kind: 'daily' },
      { ...first, tier: 2 }, { ...first, target: 0 }, { ...first, reward: NaN }, { ...first, reward: .5 }, { ...first, extra: true },
    ]) expect(() => validateEconomyBalance(ECONOMY_BALANCE, [replacement, ...MISSION_CHAINS.slice(1)])).toThrow();
    expect(() => validateEconomyBalance(ECONOMY_BALANCE, MISSION_CHAINS.slice(1))).toThrow();
    const decreasing = MISSION_CHAINS.map((mission) => mission.id === 'coins-2' ? { ...mission, target: 99 } : mission);
    expect(() => validateEconomyBalance(ECONOMY_BALANCE, decreasing)).toThrow();
  });
});
