import { expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { GameEngine } from '../../src/game/engine';
import { createRandom } from '../../src/game/random';
import { ProfileController } from '../../src/progression';
import { validateGameplayBalance, GAMEPLAY_BALANCE } from '../../src/progression/balance';
import type { EngineOptions } from '../../src/game/engine';

interface Result { coins: number; score: number; distance: number; pickups: number; deathsProtected: number; ticks: number; ended: boolean }
function simulate(seed: string, options: EngineOptions, mistakes: number, cap = 1000): Result {
  const engine = new GameEngine(seed, undefined, options), random = createRandom(`${seed}:bot-v1`);
  let decision = -1, chosen = 1, breaks = 0;
  engine.start();
  while (engine.view.status === 'running' && engine.view.distance < cap + 150) {
    const s = engine.view, row = s.rows.find(r => r.distance >= s.distance - 9);
    if (row && row.index !== decision) {
      decision = row.index; chosen = row.safeLane;
      if (s.distance > cap || random() < mistakes) chosen = (row.safeLane + 1) % 3;
    }
    if (chosen !== s.player.lane) engine.dispatch(chosen < s.player.lane ? 'left' : 'right');
    engine.step(); breaks += engine.view.powerupFacts.filter(f => f.type === 'shield-broken').length;
  }
  const s = engine.view;
  return { coins: s.coins, score: s.score, distance: s.distance, pickups: s.powerupsCollected, deathsProtected: breaks, ticks: s.tick, ended: s.status === 'over' };
}
function summary(rows: Result[]) {
  const avg = (key: 'coins' | 'score' | 'distance' | 'pickups') => rows.reduce((a, r) => a + r[key], 0) / rows.length;
  return { samples: rows.length, averageCoins: avg('coins'), averageScore: avg('score'), averageDistance: avg('distance'), averagePickups: avg('pickups'), ended: rows.filter(r => r.ended).length, shieldBreaks: rows.reduce((a, r) => a + r.deathsProtected, 0) };
}
it('simulates seeded novice income, equal-policy powers, upgrades and duplicate reward attempts', () => {
  validateGameplayBalance();
  const novices = Array.from({ length: 100 }, (_, i) => simulate(`novice-${i}`, {}, .18));
  expect(novices.every(r => r.ended)).toBe(true);
  const comparisons = Object.fromEntries(['none', 'magnet', 'shield', 'double-score', 'all-l0', 'all-l3'].map(mode => {
    const options: EngineOptions = mode === 'none' ? { powerups: false } : mode.startsWith('all') ? { upgrades: { magnet: mode === 'all-l3' ? 3 : 0, shield: mode === 'all-l3' ? 3 : 0, 'double-score': mode === 'all-l3' ? 3 : 0 } } : {};
    // A filtered independent generator, never a new random spawn sequence for comparisons.
    return [mode, { options, results: [] as Result[] }];
  }));
  const averages: Record<string, ReturnType<typeof summary>> = {};
  for (const mode of Object.keys(comparisons)) {
    const rows: Result[] = [];
    for (let i = 0; i < 40; i++) {
      const seed = `matched-${i}`;
      const generator = new PowerUpGenerator(seed);
      const options = comparisons[mode]?.options ?? {};
      if (!mode.startsWith('all') && mode !== 'none') options.pickupSource = { forRow: row => { const p = generator.forRow(row); return p?.type === mode ? p : null; } };
      rows.push(simulate(seed, options, .06));
    }
    averages[mode] = summary(rows);
  }
  const profile = new ProfileController(); let total = 0, firstUpgradeRun: number | null = null;
  for (let i = 0; i < novices.length; i++) {
    const result = novices[i]; if (!result) continue;
    const id = `session-${i}`; profile.observeRun({ id, tick: 0, distance: 0, coins: 0, powerupsCollected: 0, score: 0, status: 'running' });
    const fact = { id, tick: result.ticks, distance: result.distance, coins: result.coins, powerupsCollected: result.pickups, score: result.score, status: 'over' as const };
    profile.observeRun(fact); const wallet = profile.snapshot.walletCoins;
    for (let j = 0; j < 20; j++) profile.observeRun(fact);
    expect(profile.snapshot.walletCoins).toBe(wallet);
    for (const mission of profile.currentMissions()) if (mission.completed && !mission.claimed) { const claim = profile.claim(mission.id); expect(claim.ok).toBe(true); expect(profile.claim(mission.id).ok).toBe(false); }
    total += result.coins;
    if (firstUpgradeRun === null && profile.snapshot.walletCoins >= 100) firstUpgradeRun = i + 1;
  }
  const firstUpgradeCohorts: number[] = [];
  for (let cohort = 0; cohort < 25; cohort++) {
    const career = new ProfileController();
    for (let i = 0; i < novices.length; i++) {
      const result = novices[(cohort * 4 + i) % novices.length]; if (!result) continue;
      const id = `c${cohort}-run${i}`;
      career.observeRun({ id, tick: 0, distance: 0, coins: 0, powerupsCollected: 0, score: 0, status: 'running' });
      career.observeRun({ id, tick: result.ticks, distance: result.distance, coins: result.coins, powerupsCollected: result.pickups, score: result.score, status: 'over' });
      for (const mission of career.currentMissions()) if (mission.completed && !mission.claimed) career.claim(mission.id);
      if (career.snapshot.walletCoins >= 100) { firstUpgradeCohorts.push(i + 1); break; }
    }
  }
  expect(firstUpgradeCohorts).toHaveLength(25);
  expect(firstUpgradeRun).not.toBeNull();
  expect(profile.snapshot.statistics.totalCoins).toBe(total);
  expect(averages['double-score']?.averageCoins).toBe(averages.none?.averageCoins);
  mkdirSync('artifacts/progression', { recursive: true });
  writeFileSync('artifacts/progression/balance.json', JSON.stringify({ model: '100 independent novice seeds, 18% wrong lane per row; matched 40 seeds at 6%; safe-lane intent held until row+9m; cap1000m then seek collision; actual 120Hz engine, no human-player inference', balance: GAMEPLAY_BALANCE, novices: summary(novices), firstUpgradeRunWithMissionClaims: firstUpgradeRun, firstUpgradeCohorts: { method: '25 cyclic starting points in the same100 actually simulated novice outcomes; not25 additional independent cohorts', runs: firstUpgradeCohorts, mean: firstUpgradeCohorts.reduce((a, b) => a + b, 0) / firstUpgradeCohorts.length, min: Math.min(...firstUpgradeCohorts), max: Math.max(...firstUpgradeCohorts) }, incomeOnlyExpectedRuns: 100 / summary(novices).averageCoins, comparisons: averages, noviceRuns: novices, finalProfile: profile.snapshot }, null, 2));
}, 30000);
import { PowerUpGenerator } from '../../src/game/powerups';
