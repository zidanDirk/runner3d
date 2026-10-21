import { createServer } from 'vite';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { parseOptions } from './options.mjs';
import { generateReport } from './report.mjs';

export async function run(argv = process.argv.slice(2)) {
  const options = parseOptions([...argv]), output = resolve(options.output);
  mkdirSync(output, { recursive: true });
  if (options.command === 'report') { generateReport(output); return; }
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const start = performance.now();
    const moduleRoot = options.variant === 'baseline' ? '/artifacts/balance/baseline-source' : '/src';
    const [{ simulateRun }, { summarizeRuns }, { BOT_PROFILES, BOT_VERSION }, { GameEngine }, { PowerUpGenerator }, { LevelGenerator }, { RULES, SHAPES }, { POWERUP_BALANCE }, progression, { ProfileController }, { simulateCareer, PURCHASE_ORDERS }] = await Promise.all([
      server.ssrLoadModule('/src/balance/simulator.ts'), server.ssrLoadModule('/src/balance/statistics.ts'), server.ssrLoadModule('/src/balance/profiles.ts'),
      server.ssrLoadModule(`${moduleRoot}/game/engine.ts`), server.ssrLoadModule(`${moduleRoot}/game/powerups.ts`), server.ssrLoadModule(`${moduleRoot}/game/level.ts`),
      server.ssrLoadModule(`${moduleRoot}/game/config.ts`), server.ssrLoadModule(`${moduleRoot}/game/balance.ts`), server.ssrLoadModule(`${moduleRoot}/progression/config.ts`),
      server.ssrLoadModule(`${moduleRoot}/progression/ProfileController.ts`), server.ssrLoadModule('/src/balance/economy.ts'),
    ]);
    const bindings = { Engine: GameEngine, Pickup: PowerUpGenerator, fixedDt: RULES.fixedDt };
    let actualTicks = 0, actualRuns = 0;
    const execute = input => { const row = simulateRun(input, bindings); actualTicks += row.ticks; actualRuns++; return row; };
    const profiles = options.profile === 'all' ? Object.keys(BOT_PROFILES) : [options.profile];
    const designConfiguration = options.variant === 'proposed' ? (await server.ssrLoadModule(`${moduleRoot}/game/difficulty.ts`)).DIFFICULTY_CONFIG : null;
    const metadata = { schemaVersion: 1, variant: options.variant, moduleRoot, designConfiguration, parameters: { rules: RULES, shapes: SHAPES, powerups: POWERUP_BALANCE, economy: progression.ECONOMY_BALANCE, missions: progression.MISSION_CHAINS },
      assumptions: { botVersion: BOT_VERSION, profiles: BOT_PROFILES, distanceCap: options.distance, seedRoot: options.seed, seeds: '`${seedRoot}:${profile}:${index}`, index0..runs-1; profile namespaces are distinct; same strings matched across variants',
        policy: 'Only currently visible concrete row entities are observed; safeLane metadata is never read. Seeded decision errors, reaction jitter, input delay and action cooldown; may hold a blocked lane and issue a timed jump/slide; rejected actions remain real engine rejections. No score/position/power injection.',
        censoring: 'Distance-cap survivors remain running and are right-censored; never forced to die or treated as full deaths. Survival distributions are restricted observed distance, lower bounds on uncapped lifetime.',
        bias: 'Bots use exact known entity positions within a configurable horizon and simple row planning; no visual recognition, fatigue, learning or real touch latency. No human satisfaction or retention inference.',
        powerComparison: 'Allowed subsets filter natural independent pickup types without reallocating probability. No powers are injected; combination means allowed to spawn, actual overlap depends on real collection. Upgrades keep all natural types and alter one purchased level.' },
      generation: generationStats(LevelGenerator, PowerUpGenerator, RULES, options.seed, options.distance, Math.min(options.runs, 100)),
      policySourceHashes: Object.fromEntries(['src/balance/profiles.ts', 'src/balance/simulator.ts', 'src/balance/statistics.ts', 'src/balance/economy.ts'].map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')])),
      sourceHashes: Object.fromEntries(['game/config.ts', 'game/engine.ts', 'game/level.ts', 'game/collision.ts', 'game/random.ts', 'game/types.ts', 'game/motion.ts', 'game/difficulty.ts', 'game/reachability.ts', 'game/balance.ts', 'game/powerups.ts', 'progression/config.ts', 'progression/ProfileController.ts'].filter(path => existsSync(resolve(moduleRoot.slice(1), path))).map(path => {
        const file = resolve(moduleRoot.slice(1), path); return [relative(process.cwd(), file), createHash('sha256').update(readFileSync(file)).digest('hex')];
      })),
    };
    const summary = {}, raw = {};
    const mainStart = performance.now();
    for (const profile of profiles) {
      const sample = [];
      for (let index = 0; index < options.runs; index++) sample.push(execute({ seed: `${options.seed}:${profile}:${index}`, profile, distance: options.distance }));
      summary[profile] = summarizeRuns(sample); raw[profile] = sample;
      console.log(`[${options.variant}] ${profile}: ${sample.length} actual-engine runs; mean ${summary[profile].distance.mean.toFixed(2)}m; ${summary[profile].censored} capped`);
    }
    const mainMilliseconds = performance.now() - mainStart;
    const report = { ...metadata, summaries: summary, runs: raw };
    writeFileSync(join(output, `${options.variant}.json`), JSON.stringify(report, null, 2));
    if (options.command === 'analyze') {
      const comparison = {}, upgradeValues = {}, careers = [];
      const subsets = [[], ['magnet'], ['shield'], ['double-score'], ['magnet', 'shield'], ['magnet', 'double-score'], ['shield', 'double-score'], ['magnet', 'shield', 'double-score']];
      for (const profile of profiles) {
        comparison[profile] = {};
        for (const allowedPowers of subsets) {
          const sample = Array.from({ length: options.comparisons }, (_, index) => execute({ seed: `${options.seed}:utility:${profile}:${index}`, profile, distance: options.distance, allowedPowers }));
          comparison[profile][allowedPowers.join('+') || 'none'] = summarizeRuns(sample);
        }
        upgradeValues[profile] = {};
        const prices = progression.ECONOMY_BALANCE.upgradePrices;
        for (const type of ['magnet', 'shield', 'double-score']) {
          const levels = [];
          for (let level = 0; level <= 3; level++) {
            const sample = Array.from({ length: options.comparisons }, (_, index) => execute({ seed: `${options.seed}:utility:${profile}:${index}`, profile, distance: options.distance, upgrades: { magnet: 0, shield: 0, 'double-score': 0, [type]: level } }));
            const stats = summarizeRuns(sample), previous = levels.at(-1)?.statistics;
            const deltaCoins = previous ? stats.coins.mean - previous.coins.mean : null;
            levels.push({ level, price: level === 0 ? 0 : prices[level - 1], statistics: stats,
              marginal: previous ? { coinsPerRun: deltaCoins, distancePerRun: stats.distance.mean - previous.distance.mean, scorePerRun: stats.score.mean - previous.score.mean,
                shieldConsumptionRate: stats.shield.consumptionPerPickup === null || previous.shield.consumptionPerPickup === null ? null : stats.shield.consumptionPerPickup - previous.shield.consumptionPerPickup,
                magnetEconomicPaybackRuns: type === 'magnet' && deltaCoins > 0 ? prices[level - 1] / deltaCoins : null,
                paybackCaveat: 'Matched natural-spawn bot sample only. Nonpositive coin gains have no finite measured payback; score/survival are reported in their own units.' } : null });
          }
          upgradeValues[profile][type] = levels;
        }
        for (const order of PURCHASE_ORDERS) for (let cohort = 0; cohort < options.careers; cohort++) {
          const career = simulateCareer({ seed: `${options.seed}:cohort:${cohort}`, profile, order, runs: options.careerRuns, distance: options.distance }, bindings,
            { Profile: ProfileController, prices, missions: progression.MISSION_CHAINS });
          careers.push(career); actualRuns += career.runs; actualTicks += career.ticks;
        }
        console.log(`[${options.variant}] ${profile}: eight subsets, 12 item-level cohorts, ${PURCHASE_ORDERS.length * options.careers} real-ProfileController careers complete`);
      }
      writeFileSync(join(output, `${options.variant}-utility.json`), JSON.stringify({ schemaVersion: 1, comparisonsPerCell: options.comparisons, careersPerOrder: options.careers, careerRunCap: options.careerRuns, comparison, upgradeValues, careers }, null, 2));
    }
    for (const [file, expected] of Object.entries({ ...metadata.sourceHashes, ...metadata.policySourceHashes })) if (createHash('sha256').update(readFileSync(file)).digest('hex') !== expected) throw new Error(`Source changed during analysis: ${file}; rerun with stable sources`);
    const elapsed = performance.now() - start;
    const mainTicks = Object.values(raw).flat().reduce((n, sample) => n + sample.ticks, 0);
    writeFileSync(join(output, `${options.variant}-timing.json`), JSON.stringify({ options, wallMilliseconds: elapsed, mainRuns: options.runs * profiles.length, mainTicks, mainMilliseconds, mainTicksPerSecond: mainTicks / (mainMilliseconds / 1000), actualRuns, actualTicks, overallTicksPerSecondIncludingLoaderAndReports: actualTicks / (elapsed / 1000),
      caveat: 'Wall time includes loader and, for analyze, utility/career work; do not divide mainTicks by analyze wall time as total simulation throughput.' }, null, 2));
    console.log(`[${options.variant}] wrote ${relative(process.cwd(), output)}; ${(elapsed / 1000).toFixed(2)}s`);
  } finally { await server.close(); }
}
function generationStats(Level, Pickup, rules, seed, distance, seeds) {
  const edges = [0, 250, 600, 1200, 2000, 5000, 10000, 100000].filter((value, index, all) => index === 0 || all[index - 1] < distance);
  const bins = edges.slice(0, -1).map((from, index) => ({ from, to: Math.min(distance, edges[index + 1]), rows: 0, obstacleRows: 0, obstacles: { hurdle: 0, gate: 0, block: 0 }, coins: 0, pickups: { magnet: 0, shield: 0, 'double-score': 0 }, minimumOpenLanes: 3, routeLaneChanges: 0 }));
  let rows = 0;
  for (let index = 0; index < seeds; index++) {
    let previousLane = 1;
    const generator = new Level(`${seed}:generation:${index}`), pickups = new Pickup(`${seed}:generation:${index}`);
    for (let row = generator.next(); row.distance <= distance; row = generator.next()) {
      rows++;
      const laneChanges = Math.abs(row.safeLane - previousLane); previousLane = row.safeLane;
      const bin = bins.find(item => row.distance >= item.from && row.distance <= item.to);
      if (!bin) continue;
      bin.rows++; bin.routeLaneChanges += laneChanges;
      const hazards = row.entities.filter(entity => entity.kind !== 'coin');
      if (hazards.length > 0) bin.obstacleRows++;
      bin.minimumOpenLanes = Math.min(bin.minimumOpenLanes, 3 - new Set(hazards.map(entity => entity.lane)).size);
      for (const entity of row.entities) { if (entity.kind === 'coin') bin.coins++; else bin.obstacles[entity.kind]++; }
      const pickup = pickups.forRow(row); if (pickup !== null) bin.pickups[pickup.type]++;
    }
  }
  return { seeds, seedPattern: `${seed}:generation:0..${seeds - 1}`, rows, 
    bins: bins.map(bin => ({ ...bin, obstaclesPerMeter: Object.values(bin.obstacles).reduce((a, b) => a + b, 0) / ((bin.to - bin.from) * seeds), coinsPerMeter: bin.coins / ((bin.to - bin.from) * seeds), obstacleRowFraction: bin.rows === 0 ? null : bin.obstacleRows / bin.rows,
      routeChangesPerMeter: bin.routeLaneChanges / ((bin.to - bin.from) * seeds),
      speedAtStart: Math.min(rules.maxSpeed, rules.baseSpeed + bin.from * rules.accelerationPerMeter), speedAtEnd: Math.min(rules.maxSpeed, rules.baseSpeed + bin.to * rules.accelerationPerMeter) })) };
}
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.dirname, 'cli.mjs')) run().catch(error => { console.error(`[balance] ${error.message}`); process.exitCode = 1; });
