import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const workflow = readFileSync('.github/workflows/qiniu-home-cache.yml', 'utf8');
const sha = 'a'.repeat(40);
const confirmation = 'SET NO-STORE supergames:runner/index.html Fsydo-Rs3kzKg93e_csZgcGEPOmk';
function inline(name: string): string {
  const section = workflow.split(`      - name: ${name}\n`)[1]?.split('\n      - ')[0];
  const body = section?.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n          JS/)?.[1];
  if (!body) throw new Error(`Missing actual workflow inline source: ${name}`);
  return body;
}

const authorization = inline('Require manual master review before credentials are available');
const environment = { EVENT_NAME: 'workflow_dispatch', SOURCE_REF: 'refs/heads/master', SENDER_TYPE: 'User', SOURCE_SHA: sha, REVIEWED_SHA: sha, MAINTENANCE_MODE: 'dry-run', CONFIRMATION: '', PATH: '' };
it.each([
  ['dry-run', {}, 0],
  ['execute', { MAINTENANCE_MODE: 'execute', CONFIRMATION: confirmation }, 0],
  ['non-master branch', { SOURCE_REF: 'refs/heads/codex/test' }, 1],
  ['tag named master', { SOURCE_REF: 'refs/tags/master' }, 1],
  ['push event', { EVENT_NAME: 'push' }, 1],
  ['bot sender', { SENDER_TYPE: 'Bot' }, 1],
  ['wrong SHA', { REVIEWED_SHA: 'b'.repeat(40) }, 1],
  ['short SHA', { REVIEWED_SHA: 'a'.repeat(16) }, 1],
  ['execute without confirmation', { MAINTENANCE_MODE: 'execute' }, 1],
  ['confirmation for another object', { MAINTENANCE_MODE: 'execute', CONFIRMATION: confirmation.replace('runner/index', 'runner/other') }, 1],
  ['unknown mode', { MAINTENANCE_MODE: 'production' }, 1],
  ['confirmation mixed into dry-run', { CONFIRMATION: confirmation }, 1],
] as const)('runs the actual authorization gate: %s', (_name, change, expected) => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', authorization], { encoding: 'utf8', timeout: 5000, env: { ...environment, ...change } });
  expect(child.status, child.stderr).toBe(expected);
  if (expected) expect(child.stdout).not.toContain('accepted');
});

const summary = inline('Summarize maintenance without credentials or raw API responses');
interface SummaryCase { name: string; mode?: string; changes?: Record<string, unknown>; missing?: boolean; raw?: string; pass?: boolean }
const cases: SummaryCase[] = [
  { name: 'real dry-run without writes', pass: true },
  { name: 'verified update', mode: 'execute', changes: { outcome: 'UPDATED', writesAttempted: 1, writesAcknowledged: 1 }, pass: true },
  { name: 'already no-store', mode: 'execute', changes: { outcome: 'UNCHANGED' }, pass: true },
  { name: 'missing report', missing: true },
  { name: 'failed report', changes: { status: 'FAIL' } },
  { name: 'synthetic report', changes: { scope: 'synthetic-test' } },
  { name: 'wrong report mode', changes: { mode: 'execute' } },
  { name: 'unknown requested mode', mode: 'invalid' },
  { name: 'two write attempts', mode: 'execute', changes: { outcome: 'UPDATED', writesAttempted: 2, writesAcknowledged: 1 } },
  { name: 'acknowledged without attempt', changes: { writesAcknowledged: 1 } },
  { name: 'fractional count', changes: { writesAttempted: 0.5 } },
  { name: 'missing count', changes: { writesAttempted: null } },
  { name: 'string count', changes: { writesAttempted: '0' } },
  { name: 'dry-run attempted mutation', changes: { writesAttempted: 1, writesAcknowledged: 1 } },
  { name: 'execute with unknown result', mode: 'execute', changes: { outcome: 'UNKNOWN', writesAttempted: 1, writesAcknowledged: 0 } },
  { name: 'malformed report', raw: '{untrusted-raw-response' },
];
it.each(cases)('does not overclaim the actual Summary: $name', async scenario => {
  const root = await mkdtemp(join(tmpdir(), 'runner-home-cache-summary-'));
  try {
    const directory = join(root, 'artifacts/qiniu-home-cache'), output = join(root, 'summary.md');
    await mkdir(directory, { recursive: true });
    const mode = scenario.mode ?? 'dry-run';
    const report = { status: 'PASS', mode, scope: 'real-api', writesAttempted: 0, writesAcknowledged: 0, outcome: 'NOT_ATTEMPTED', before: { untrusted: 'DO_NOT_PRINT_API_BODY_OR_AUTHORIZATION' }, ...scenario.changes };
    if (!scenario.missing) await writeFile(join(directory, 'report.json'), scenario.raw ?? JSON.stringify(report));
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', summary], { encoding: 'utf8', timeout: 5000, cwd: root, env: { PATH: '', MAINTENANCE_MODE: mode, GITHUB_STEP_SUMMARY: output } });
    expect(child.status, child.stderr).toBe(0);
    const text = await readFile(output, 'utf8');
    expect(text).toContain(`maintenance: ${scenario.pass ? 'PASS' : 'FAIL'}`);
    expect(text).toContain('CDN was not refreshed');
    for (const untrusted of ['DO_NOT_PRINT_API_BODY_OR_AUTHORIZATION', 'untrusted-raw-response']) expect(text + child.stdout + child.stderr).not.toContain(untrusted);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it('keeps maintenance manual, master-reviewed, single-purpose and serialized with existing object writers', () => {
  expect(workflow).toMatch(/\non:\n  workflow_dispatch:/);
  expect(workflow).not.toMatch(/^  (?:push|pull_request|schedule|workflow_run):/m);
  expect(workflow).toMatch(/permissions:\n  contents: read\n/);
  expect(workflow).toContain('group: reviewed-qiniu-release');
  expect(workflow).toContain('cancel-in-progress: false');
  expect(workflow).toContain('default: dry-run');
  expect(workflow).toContain('needs: authorize');
  expect(workflow).toContain('environment: preview');
  expect(workflow).toContain('ref: ${{ github.sha }}');
  expect(workflow).toContain('persist-credentials: false');
  expect(workflow).toContain('node scripts/release/qiniu-home-cache.mjs --dry-run');
  expect(workflow).toContain('node scripts/release/qiniu-home-cache.mjs --execute');
  expect(workflow).toContain('if: always()');
  expect(workflow).toContain('if-no-files-found: error');
  expect(workflow).toContain('path: artifacts/qiniu-home-cache/report.json');
  const authorizationJob = workflow.split('  maintenance:')[0];
  expect(authorizationJob).not.toContain('secrets.');
  expect(workflow.match(/secrets\.QINIU_AK/g)).toHaveLength(1);
  expect(workflow.match(/secrets\.QINIU_SK/g)).toHaveLength(1);
  for (const unsupported of ['npm ci', 'workflow run', 'deploy-qiniu.yml', 'promote-qiniu.yml', 'qiniu.mjs upload', 'qiniu.mjs promote']) expect(workflow).not.toContain(unsupported);
});
