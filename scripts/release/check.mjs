import { execFileSync, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { verifyRelease } from './verify.mjs';

const environment = process.env.RELEASE_ENV ?? 'preview';
if (!['preview', 'production'].includes(environment)) throw new Error('release:check requires RELEASE_ENV=preview or production');
const output = process.env.RELEASE_REPORT_DIR ?? 'artifacts/beta-release/gate';
let source = { headCommit: 'unknown', dirty: null, changedPathCount: null, commitProvenance: 'Git metadata unavailable; archive exact artifact' };
try {
  const headCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  source = { headCommit, dirty: status.length > 0, changedPathCount: status ? status.split('\n').length : 0, commitProvenance: status ? 'HEAD only: local dirty source is identified by buildId and exact artifact manifest, not by commit alone' : 'Clean checkout at check start; archive exact artifact and retain CI source revision' };
} catch { /* Local source archives remain checkable; no fake clean-SHA claim. */ }
await mkdir(output, { recursive: true });
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), environment, source, status: 'running', checks: [], notIncluded: ['Full visual comparison (separate CI job)', '50 lifecycle cycles and 10-minute wall-clock soak', 'Remote deployment/HTTPS', 'Real iOS/Android and human audio acceptance'] };
const tasks = [
  ['strict', ['run', 'typecheck']],
  ['unit', ['test']],
  ['asset-config', ['run', 'assets:config']],
  ['assets', ['run', 'assets:validate']],
  ['build', ['run', 'build', '--', '--mode', environment]],
  ['core-browser', ['run', 'test:e2e', '--', 'tests/e2e/game.spec.ts', 'tests/e2e/product.spec.ts', 'tests/e2e/mobile-recovery.spec.ts', '--output=test-results/task14/gate-core']],
  ['beta-adapters', ['run', 'test:beta']],
  ['production-smoke', ['run', 'test:release']],
];
try {
  for (const [name, args] of tasks) {
    console.log(`\n[release:check] ${name}`);
    const start = Date.now();
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: 'inherit', shell: false, env: { ...process.env, RELEASE_ENV: environment, PLAYWRIGHT_HTML_OUTPUT_DIR: 'test-results/task14/gate-report' } });
      child.once('error', reject); child.once('exit', code => resolve(code ?? 1));
    });
    report.checks.push({ name, exitCode, durationMs: Date.now() - start });
    if (exitCode !== 0) throw new Error(`${name} failed (${exitCode}); release blocked`);
    if (name === 'build') { report.artifact = await verifyRelease(); report.checks.push({ name: 'built-version-and-integrity', exitCode: 0 }); }
  }
  report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = error instanceof Error ? error.message : 'Check failed'; process.exitCode = 1; }
finally { report.completedAt = new Date().toISOString(); await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n'); console.log(`[release:check] ${report.status}; ${output}/report.json`); }
