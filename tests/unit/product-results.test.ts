import { describe, expect, it } from 'vitest';
import { PROFILE_KEY, ProfileController, defaultProfile } from '../../src/progression';
import type { ProfileStorage, RunProgress } from '../../src/progression';
import { createRunResults } from '../../src/product/results';

const facts = (overrides: Partial<RunProgress> = {}): RunProgress => ({
  id: 'product-run-1', tick: 0, distance: 0, coins: 0, powerupsCollected: 0, score: 0, status: 'running', ...overrides,
});

describe('read-only committed run results', () => {
  it('never creates a settlement for a running, paused, or abandoned attempt', () => {
    const profile = new ProfileController(); const before = profile.snapshot;
    profile.observeRun(facts());
    profile.observeRun(facts({ tick: 120, distance: 16, coins: 12, score: 316 }));
    profile.observeRun(facts({ tick: 120, distance: 16, coins: 12, score: 316, status: 'paused' }));
    expect(createRunResults(before, profile.lastSettlement, profile.snapshot)).toBeNull();
    expect(profile.snapshot.walletCoins).toBe(0);
    profile.observeRun(facts({ id: 'product-run-2' }));
    expect(createRunResults(before, profile.lastSettlement, profile.snapshot)).toBeNull();
    expect(profile.snapshot.statistics.runsCompleted).toBe(0);
    expect(profile.snapshot.statistics.totalCoins).toBe(12);
  });

  it('compares with the pre-run record even though actual profile records update during play', () => {
    const profile = new ProfileController(); const before = profile.snapshot;
    profile.observeRun(facts());
    profile.observeRun(facts({ tick: 1, distance: 26.9, coins: 6, score: 176 }));
    expect(profile.snapshot.bestScore).toBe(176);
    const settlement = profile.observeRun(facts({ tick: 2, distance: 27.1, coins: 6, score: 177, status: 'over' }));
    expect(createRunResults(before, settlement, profile.snapshot)).toMatchObject({
      runId: 'product-run-1', score: 177, distance: 27, runCoins: 6, walletAdded: 6, walletCoinsAtSettlement: 6,
      records: { score: true, distance: true, previousScore: 0, previousDistance: 0 },
    });
  });

  it('does not call tied records new and keeps score records separate from distance records', () => {
    const initial = { ...defaultProfile(), bestScore: 400, bestDistance: 200 };
    const storage: ProfileStorage = { getItem: (key) => key === PROFILE_KEY ? JSON.stringify(initial) : null, setItem: () => {} };
    const profile = new ProfileController(storage); const before = profile.snapshot;
    profile.observeRun(facts());
    const settlement = profile.observeRun(facts({ tick: 1, score: 400, distance: 201.7, status: 'over' }));
    expect(createRunResults(before, settlement, profile.snapshot)?.records).toEqual({ score: false, distance: true, previousScore: 400, previousDistance: 200 });
  });

  it('reports real mission progress and available configured prices after legally earned coins', () => {
    const profile = new ProfileController(); const before = profile.snapshot;
    profile.observeRun(facts());
    const settlement = profile.observeRun(facts({ tick: 1, distance: 1000, coins: 100, powerupsCollected: 5, score: 3500, status: 'over' }));
    const summary = createRunResults(before, settlement, profile.snapshot);
    expect(summary?.walletAdded).toBe(100);
    expect(summary?.affordableUpgradeCount).toBe(3);
    expect(summary?.claimableMissionCount).toBe(3);
    expect(summary?.missions.find((mission) => mission.id === 'coins-1')).toMatchObject({ beforeProgress: 0, progress: 100, delta: 100, target: 100, reward: 40, completedThisRun: true, claimed: false });
    expect(profile.purchase('magnet', 0).ok).toBe(true);
    expect(profile.snapshot.walletCoins).toBe(0);
    expect(profile.purchase('magnet', 0)).toMatchObject({ ok: false, reason: 'stale-level' });
    expect(profile.claim('coins-1').ok).toBe(true);
    expect(profile.claim('coins-1')).toMatchObject({ ok: false, reason: 'already-claimed' });
    expect(profile.snapshot.walletCoins).toBe(40);
    // The committed result is a historical summary, not a live wallet after shopping.
    expect(summary?.walletCoinsAtSettlement).toBe(100);
  });

  it('can render repeatedly without wallet writes, extra settlement, or extra mission rewards', () => {
    let writes = 0;
    const storage: ProfileStorage = { getItem: () => null, setItem: () => { writes++; } };
    const profile = new ProfileController(storage); const before = profile.snapshot;
    profile.observeRun(facts());
    const end = facts({ tick: 1, coins: 100, score: 2500, status: 'over' });
    profile.observeRun(end);
    const after = profile.snapshot;
    const first = createRunResults(before, profile.lastSettlement, after);
    const committedWrites = writes;
    for (let count = 0; count < 100; count++) {
      expect(createRunResults(before, profile.lastSettlement, after)).toEqual(first);
      expect(profile.observeRun(end)).toBeNull();
    }
    expect(profile.snapshot).toBe(after);
    expect(profile.snapshot.walletCoins).toBe(100);
    expect(profile.snapshot.statistics.runsCompleted).toBe(1);
    expect(writes).toBe(committedWrites);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first?.records)).toBe(true);
    expect(Object.isFrozen(first?.missions)).toBe(true);
  });

  it('uses actual capped wallet credit rather than pretending all collected coins were paid', () => {
    const initial = { ...defaultProfile(), walletCoins: Number.MAX_SAFE_INTEGER - 2 };
    const storage: ProfileStorage = { getItem: () => JSON.stringify(initial), setItem: () => {} };
    const profile = new ProfileController(storage); const before = profile.snapshot;
    profile.observeRun(facts());
    const settlement = profile.observeRun(facts({ tick: 1, coins: 10, status: 'over' }));
    expect(createRunResults(before, settlement, profile.snapshot)).toMatchObject({ runCoins: 10, walletAdded: 2, walletCoinsAtSettlement: Number.MAX_SAFE_INTEGER });
  });

  it('shows all-maxed separately from affordability without inventing another coin sink', () => {
    const initial = { ...defaultProfile(), walletCoins: 1000, upgrades: { magnet: 3, shield: 3, 'double-score': 3 } };
    const storage: ProfileStorage = { getItem: () => JSON.stringify(initial), setItem: () => {} };
    const profile = new ProfileController(storage); const before = profile.snapshot;
    profile.observeRun(facts());
    const settlement = profile.observeRun(facts({ tick: 1, coins: 2, status: 'over' }));
    expect(createRunResults(before, settlement, profile.snapshot)).toMatchObject({ allUpgradesMaxed: true, affordableUpgradeCount: 0, walletCoinsAtSettlement: 1002 });
  });
});
