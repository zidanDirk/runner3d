import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateReport } from '../../scripts/balance/report.mjs';
import { BOT_PROFILES, validateBotProfile } from '../../src/balance/profiles';
import { simulateRun } from '../../src/balance/simulator';
import { summarizeRuns, distribution, percentile } from '../../src/balance/statistics';
import { simulateCareer } from '../../src/balance/economy';
import { parseOptions } from '../../scripts/balance/options.mjs';

const careful = { ...BOT_PROFILES.expert, errorRate: 0, coinAppetite: 1 };
describe('balance analysis uses actual simulation with reproducible constrained policies', () => {
  it('repeats identical seed and input policy, including timestamps and power facts', () => {
    const input = { seed: 'balance-repeat', profile: 'casual' as const, distance: 1500, trace: true };
    expect(simulateRun(input)).toEqual(simulateRun(input));
  });
  it('labels a cap survivor as censored and leaves death unset', () => {
    const result = simulateRun({ seed: 'cap-safe', profile: careful, distance: 80, allowedPowers: [] });
    expect(result.status).toBe('censored'); expect(result.death).toBeNull(); expect(result.distance).toBeGreaterThanOrEqual(80);
    expect(result.collisions).toBe(0); expect(result.pickups).toBe(0);
  });
  it('respects reaction/cooldown across real dispatches and uses multiple actual actions', () => {
    const actions = { left: 0, right: 0, jump: 0, slide: 0 };
    for (let i = 0; i < 16; i++) {
      const result = simulateRun({ seed: `balance-action-${i}`, profile: 'casual', distance: 1500, trace: true });
      const trace = result.trace ?? [];
      for (let index = 1; index < trace.length; index++) expect((trace[index]?.tick ?? 0) - (trace[index - 1]?.tick ?? 0)).toBeGreaterThanOrEqual(Math.ceil(BOT_PROFILES.casual.actionCooldownSeconds * 120));
      for (const key of ['left', 'right', 'jump', 'slide'] as const) actions[key] += result.actions[key];
      expect(result.mistakenDecisions).toBeLessThanOrEqual(result.decisions);
    }
    for (const count of Object.values(actions)) expect(count).toBeGreaterThan(0);
  });
  it('keeps Double Score outside the wallet/coin generator and only adds permitted score', () => {
    let observedBonus = 0;
    for (let i = 0; i < 12; i++) {
      const options = { seed: `double-compare-${i}`, profile: careful, distance: 1000 };
      const none = simulateRun({ ...options, allowedPowers: [] }), doubled = simulateRun({ ...options, allowedPowers: ['double-score'] });
      expect(doubled.coins).toBe(none.coins); expect(doubled.distance).toBe(none.distance);
      expect(doubled.score).toBe(none.score + doubled.scoreBonus); observedBonus += doubled.scoreBonus;
    }
    expect(observedBonus).toBeGreaterThan(0);
  });
  it('sums actual shield collisions rather than fabricating invulnerability', () => {
    const results = Array.from({ length: 12 }, (_, i) => simulateRun({ seed: `shield-audit-${i}`, profile: 'casual', distance: 1800 }));
    for (const result of results) {
      expect(result.collisions).toBe(result.shieldBreaks + (result.death === null ? 0 : 1));
      expect(result.shieldBreaks + result.shieldExpirations + result.shieldRefreshes).toBeLessThanOrEqual(result.collectedByType.shield);
    }
    expect(results.reduce((n, row) => n + row.collectedByType.shield, 0)).toBeGreaterThan(0);
  });
  it('records multiple seed outcomes and observed coin collection is bounded', () => {
    const rows = Array.from({ length: 10 }, (_, i) => simulateRun({ seed: `spread-${i}`, profile: 'beginner', distance: 1000 }));
    expect(new Set(rows.map(row => row.seed)).size).toBe(10);
    expect(new Set(rows.map(row => row.distance)).size).toBeGreaterThan(1);
    const summary = summarizeRuns(rows);
    expect(summary.ended + summary.censored).toBe(rows.length);
    expect(Object.values(summary.failures).reduce((a, b) => a + b, 0)).toBe(summary.ended);
    expect(summary.observedCoinCollectionFraction).toBeLessThanOrEqual(1);
  });
  it('rejects malformed assumptions and unsupported run input', () => {
    expect(() => validateBotProfile({ ...careful, surprise: 1 })).toThrow();
    expect(() => validateBotProfile({ ...careful, errorRate: 1.1 })).toThrow();
    expect(() => validateBotProfile({ ...careful, reactionSeconds: NaN })).toThrow();
    expect(() => validateBotProfile({ ...careful, actionCooldownSeconds: 0 })).toThrow();
    expect(() => simulateRun({ seed: '', profile: 'casual', distance: 100 })).toThrow();
    expect(() => simulateRun({ seed: 'x', profile: 'casual', distance: Infinity })).toThrow();
    expect(() => simulateRun({ seed: 'x', profile: 'casual', distance: 10 })).toThrow();
    expect(() => simulateRun({ seed: 'x', profile: 'casual', distance: 100, allowedPowers: ['shield', 'shield'] })).toThrow();
  });
});
describe('economic analysis settles actual runs and tracks censored purchase goals', () => {
  it('is deterministic, conserves coins, and records true transactions and mission claims', () => {
    const options = { seed: 'economic-real', profile: 'beginner' as const, order: 'cheapest-first' as const, runs: 12, distance: 1500 };
    const result = simulateCareer(options);
    expect(result).toEqual(simulateCareer(options));
    expect(result.settledCoins + result.missionRewards - result.spent).toBe(result.wallet);
    expect(result.deaths + result.censoredRuns).toBe(12);
    expect(result.missionRewards).toBeLessThanOrEqual(810);
    expect(result.purchases.length).toBeGreaterThan(0);
    expect(result.purchases.reduce((n, purchase) => n + purchase.cost, 0)).toBe(result.spent);
    expect(result.maxLevelCensored).toBe(result.maxLevelRun === null);
  });
  it('never settles cap survivors as fake deaths to accelerate purchases', () => {
    const result = simulateCareer({ seed: 'tiny-career', profile: 'expert', order: 'magnet-first', runs: 1, distance: 48 });
    expect(result.censoredRuns).toBe(1); expect(result.deaths).toBe(0);
    expect(result.settledCoins).toBe(0); expect(result.wallet).toBe(0);
    expect(result.maxLevelCensored).toBe(true); expect(result.firstUpgradeRun).toBeNull();
  });
});
describe('simulation command and statistics contracts', () => {
  it('parses documented deterministic options and rejects misspellings/unsafe requests', () => {
    expect(parseOptions(['simulate', '--seed=fixed', '--runs', '12', '--profile', 'expert', '--distance', '2000', '--variant', 'baseline', '--output', 'artifacts/balance-small'])).toMatchObject({ command: 'simulate', seed: 'fixed', runs: 12, profile: 'expert', distance: 2000, variant: 'baseline' });
    for (const args of [['--profile', 'perfect'], ['--run', '1'], ['--runs', '0'], ['--runs', '1.5'], ['--runs', '2', '--runs', '3'], ['--distance', 'NaN'], ['--seed'], ['--variant', 'legacy']]) expect(() => parseOptions(args)).toThrow();
  });
  it('refuses to publish a report from stale source files', () => {
    const folder = mkdtempSync(join(tmpdir(), 'runner-balance-stale-'));
    try {
      const source = join(folder, 'source-fixture.txt'); writeFileSync(source, 'changed source');
      // These are negative fixtures, never written into canonical measured artifacts.
      for (const variant of ['baseline', 'proposed']) writeFileSync(join(folder, `${variant}.json`), JSON.stringify({ variant, sourceHashes: { [source]: 'old-hash' } }));
      writeFileSync(join(folder, 'proposed-utility.json'), '{}');
      expect(() => generateReport(folder)).toThrow(/Source changed/);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });
  it('calculates interpolation quantiles and refuses invalid/empty samples', () => {
    expect(distribution([1, 2, 3, 4])).toEqual({ mean: 2.5, median: 2.5, p10: 1.3, p90: 3.7, min: 1, max: 4 });
    expect(percentile([7], .9)).toBe(7);
    expect(() => summarizeRuns([])).toThrow(); expect(() => percentile([], .5)).toThrow();
  });
});
