import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Orchestrator } from './orchestrator';
import { check } from './types';
import type { Candidate, Config, Runner } from './types';
import { hash, score } from './security';
import { Store } from './store';

/** Synthetic Issue + mock Codex, but real Git worktrees, file writes, failing/passing Node tests and commits. No remote adapter. */
export async function dryRun(root: string, config: Config, runner: Runner): Promise<unknown> {
  const outer = new Store(root); await outer.init();
  const runs = await readdir(resolve(outer.root, 'dry-runs')); check(runs.length < config.retainRuns, 'Dry Run retention budget reached; archive reviewed local runs before creating another');
  const fixture = await mkdtemp(resolve(outer.root, 'dry-runs', 'run-'));
  await mkdir(resolve(fixture, 'src')); await mkdir(resolve(fixture, 'tests'));
  await writeFile(resolve(fixture, '.gitignore'), '.agent-data/\nnode_modules/\n');
  await writeFile(resolve(fixture, 'src/value.mjs'), 'export const value = 0;\n');
  await writeFile(resolve(fixture, 'tests/value.test.mjs'), "import { test } from 'node:test'; import assert from 'node:assert/strict'; import {value} from '../src/value.mjs'; test('approved value becomes one', () => assert.equal(value, 1));\n");
  const git = async (args: string[]): Promise<string> => { const result = await runner('git', args, { cwd: fixture, timeoutMs: 15000 }); check(result.exitCode === 0, `Fixture Git ${args[0]} failed`); return result.stdout.trim(); };
  await git(['init', '--initial-branch=master']); await git(['config', 'user.name', 'Runner3D Dry Run']); await git(['config', 'user.email', 'dry-run@localhost.invalid']);
  await git(['add', '.']); await git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'synthetic fixture']);
  const initialHead = await git(['rev-parse', 'HEAD']);
  const scores = { impact: 1, confidence: 5, effort: 1, risk: 1, automation: 5 };
  const candidate: Candidate = { key: 'fixture-value', title: 'Synthetic test value', category: 'Bug', kind: 'observed', problem: 'Fixture value differs from its test expectation.', solution: 'Change only src/value.mjs.', benefit: 'Exercise real failing/passing tests.', complexity: 'Synthetic one-file change', risks: ['Not a real game task or human approval.'], evidence: [{ path: 'src/value.mjs', line: 1, excerpt: 'export const value = 0;', sha256: hash('export const value = 0;\n') }], scores, priority: score(scores), scope: ['src/value.mjs'], acceptance: ['Real Node test passes.'], tests: ['node --test'] };
  let calls = 0;
  const agent = new Orchestrator(fixture, config, runner, async (_task, workspace) => {
    calls++; return { summary: 'Synthetic deterministic Codex fixture', edits: [{ path: 'src/value.mjs', beforeSha256: hash(await readFile(resolve(workspace, 'src/value.mjs'))), content: calls === 1 ? 'export const value = 0; // deliberate fixture failure\n' : 'export const value = 1;\n' }], tokens: 0 };
  }, null, async (task, level) => {
    check(task.workspace, 'No fixture workspace'); const result = await runner(process.execPath, ['--test', 'tests/value.test.mjs'], { cwd: task.workspace, timeoutMs: 15000 });
    const log = `logs/${task.id}-${task.rounds}-${level}-fixture.log`; await agent.store.write(log, result.stdout + result.stderr);
    return [{ id: `synthetic-${level}-actual-node-test`, exitCode: result.exitCode, status: result.exitCode === 0 ? 'passed' : 'failed', durationMs: result.durationMs, log }];
  });
  await agent.init(); const task = await agent.propose(candidate, 'dry-run');
  await agent.approve(task.id, task.digest, 'synthetic-driver (not a human)', false, 'dry-run'); await agent.plan(task.id);
  const completed = await agent.execute(task.id, true);
  check(completed.state === 'READY_FOR_REVIEW' && completed.rounds === 2 && completed.fixes === 1, 'Dry Run repair/state assertions failed');
  check(await git(['rev-parse', 'HEAD']) === initialHead && !(await git(['status', '--porcelain=v1'])), 'Fixture primary checkout changed');
  const again = await agent.propose(candidate, 'dry-run'); check(again.id === completed.id && again.state === 'READY_FOR_REVIEW', 'Dry Run idempotency failed');
  const report = { schemaVersion: 1, at: new Date().toISOString(), fixture, mode: 'dry-run', mockCodex: true, realGitWorktree: true, realFailThenPassNodeTests: true, remoteCalls: 0, calls, state: completed.state, rounds: completed.rounds, fixes: completed.fixes, events: completed.events, checks: completed.checks, localSideEffects: ['isolated temporary Git repository/worktree/branch', 'synthetic source edit and commit', 'approval tagged dry-run only', 'local state, logs, patch, PR draft'], unchangedMainCheckout: true, notVerified: ['real model', 'full game QA', 'remote GitHub', 'long unattended execution'] };
  await outer.write('reports/dry-run.json', report); return report;
}
