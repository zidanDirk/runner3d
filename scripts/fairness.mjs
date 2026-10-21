import { createServer } from 'vite';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--(runs|distance|seed|output)=(.+)$/.exec(arg);
  if (!match) throw new Error('Use --runs=N --distance=M --seed=TEXT --output=DIR');
  return [match[1], match[2]];
}));
const output = args.output ?? 'artifacts/balance';
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const [{ analyzeFairness }, { LevelGenerator }, { getDifficulty, DIFFICULTY_CONFIG }, { RULES }, { validateRowTransition, findReachableRoute }, { initialPlayer, advancePlayer }] = await Promise.all([
    server.ssrLoadModule('/src/analysis/fairness.ts'), server.ssrLoadModule('/src/game/level.ts'), server.ssrLoadModule('/src/game/difficulty.ts'), server.ssrLoadModule('/src/game/config.ts'),
    server.ssrLoadModule('/src/game/reachability.ts'),
    server.ssrLoadModule('/src/game/motion.ts'),
  ]);
  const coldStart = performance.now(); new LevelGenerator('FAIRNESS-COLD').next(); const coldMilliseconds = performance.now() - coldStart;
  const start = performance.now();
  const result = analyzeFairness(args.seed ?? 'Runner3D-fairness-v1', Number(args.runs ?? 3000), Number(args.distance ?? 10000));
  const elapsed = performance.now() - start;
  const probe = { index: 0, distance: 57, safeLane: 1, entities: [0, 2].map(lane => ({ id: `probe-${lane}`, lane, kind: 'block', distance: 57, collected: false })) };
  const validationStart = performance.now(); validateRowTransition(null, probe); const coldValidationMilliseconds = performance.now() - validationStart;
  const cachedStart = performance.now(); for (let i = 0; i < 10000; i++) validateRowTransition(null, probe); const cachedValidation10000Milliseconds = performance.now() - cachedStart;
  const searchStart = performance.now();
  const search = findReachableRoute({ startDistance: 0, endDistance: 18, entities: [0, 1, 2].map(lane => ({ id: `jump-${lane}`, lane, kind: lane === 1 ? 'hurdle' : 'block', distance: 16, collected: false })), maxNodes: 16384 });
  const searchProbeMilliseconds = performance.now() - searchStart;
  if (!search.reachable) throw new Error('Actual jump search probe did not find a witness');
  const timing = { coldFirstRowMilliseconds: coldMilliseconds, totalMilliseconds: elapsed, rowsPerSecondIncludingValidation: result.rows / (elapsed / 1000),
    coldStandaloneValidationMilliseconds: coldValidationMilliseconds, cachedValidation10000Milliseconds, cachedValidationMeanMicroseconds: cachedValidation10000Milliseconds / 10, searchProbeMilliseconds, searchExpandedNodes: search.expandedNodes,
    scope: 'Node on this host; elapsed includes real level generation, bounded certificate-cache lookup/cold proof and analysis accounting, not browser GPU time.' };
  const jumper = initialPlayer(); let jumpTicks = 0, maximumJumpHeight = 0;
  do { advancePlayer(jumper, jumpTicks === 0 ? ['jump'] : []); jumpTicks++; maximumJumpHeight = Math.max(maximumJumpHeight, jumper.y); } while (jumper.y > 0 && jumpTicks < 240);
  const slider = initialPlayer(); let slideTicks = 0;
  do { advancePlayer(slider, slideTicks === 0 ? ['slide'] : []); slideTicks++; } while (slider.slideRemaining > 0 && slideTicks < 240);
  const physicsMeasurements = { method: 'Executed the production fixed-step motion kernel, not continuous analytic approximations', maximumJumpHeight, jumpFlightTicks: jumpTicks, jumpFlightSeconds: jumpTicks * RULES.fixedDt, slideUntilZeroTicks: slideTicks, slideUntilZeroSeconds: slideTicks * RULES.fixedDt, laneChangeTicks: Math.ceil(RULES.laneChangeDuration / RULES.fixedDt) };
  mkdirSync(output, { recursive: true });
  const files = ['difficulty', 'motion', 'reachability', 'level', 'engine', 'config', 'collision'];
  const hashes = Object.fromEntries(files.map(name => { const path = `src/game/${name}.ts`; return [path, createHash('sha256').update(readFileSync(path)).digest('hex')]; }));
  writeFileSync(`${output}/fairness.json`, JSON.stringify({ ...result, physicsMeasurements, timing, sourceHashes: hashes }, null, 2));
  const csv = ['distance_m,stage,speed_mps,expected_obstacles_per_m,expected_obstacles_per_second,rows_per_second,expected_coins_per_second,powerup_probability_per_eligible_row,internal_difficulty_index,center_headway_seconds'];
  for (let distance = 0; distance <= 10000; distance += 50) {
    const d = getDifficulty(distance);
    csv.push([distance, d.stage.id, d.speed, d.obstaclesPerMeter, d.obstaclesPerMeter * d.speed, d.rowsPerSecond, d.rowsPerSecond * DIFFICULTY_CONFIG.coins.trailCount, d.powerupProbability, d.difficultyScore, RULES.rowSpacing / d.speed].join(','));
  }
  writeFileSync(`${output}/difficulty.csv`, csv.join('\n') + '\n');
  console.log(JSON.stringify({ seeds: result.seeds, rows: result.rows, certified: result.certified, failed: result.failed, cache: result.cacheSize, timing }, null, 2));
  if (result.failed || result.probes.some(probe => probe.result.reachable !== probe.expectedReachable)) process.exitCode = 1;
} finally { await server.close(); }
