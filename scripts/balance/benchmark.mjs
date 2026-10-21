import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { simulateRun } = await server.ssrLoadModule('/src/balance/simulator.ts');
  const { summarizeRuns } = await server.ssrLoadModule('/src/balance/statistics.ts');
  const sourceRoot = process.argv.includes('--proposed') ? '/src' : '/artifacts/balance/baseline-source';
  const { GameEngine } = await server.ssrLoadModule(`${sourceRoot}/game/engine.ts`);
  const { PowerUpGenerator } = await server.ssrLoadModule(`${sourceRoot}/game/powerups.ts`);
  const { RULES } = await server.ssrLoadModule(`${sourceRoot}/game/config.ts`);
  const before = performance.now();
  const reports = {};
  for (const profile of ['beginner', 'casual', 'expert']) {
    const runs = Array.from({ length: 30 }, (_, index) => simulateRun({ seed: `Runner3D-original-benchmark:${profile}:${index}`, profile, distance: 5000 }, { Engine: GameEngine, Pickup: PowerUpGenerator, fixedDt: RULES.fixedDt }));
    reports[profile] = summarizeRuns(runs);
  }
  const result = { originalPreservedEngine: !process.argv.includes('--proposed'), totalRuns: 90, reports, durationMilliseconds: performance.now() - before };
  writeFileSync(`artifacts/balance/${process.argv.includes('--proposed') ? 'proposed' : 'baseline'}-benchmark.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await server.close(); }
