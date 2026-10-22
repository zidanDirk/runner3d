import { mkdtemp, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import rawConfig from '../../agent.config.json';
import { Orchestrator } from '../../scripts/agent/orchestrator';
import { runProcess } from '../../scripts/agent/process';
import { hash, parseConfig, score } from '../../scripts/agent/security';
import { dryRun } from '../../scripts/agent/dry-run';
import { transition } from '../../scripts/agent/state';
import { Store } from '../../scripts/agent/store';
import type { Validator } from '../../scripts/agent/validation';
import type { Candidate, Executor, Runner, Task } from '../../scripts/agent/types';

const roots: string[] = [], config = parseConfig(rawConfig);
async function setup(executor?: Executor, validation?: Validator, suppliedRunner: Runner = runProcess): Promise<{ root: string; agent: Orchestrator; task: Task }> {
  const root = await mkdtemp(resolve(tmpdir(), 'runner-agent-integration-')); roots.push(root);
  await mkdir(resolve(root, 'src')); await writeFile(resolve(root, 'src/value.mjs'), 'export const value = 0;\n'); await writeFile(resolve(root, '.gitignore'), '.agent-data/\nnode_modules/\n');
  for (const args of [['init', '--initial-branch=master'], ['config', 'user.name', 'Agent integration'], ['config', 'user.email', 'integration@localhost.invalid'], ['add', '.'], ['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'initial fixture']]) { const result = await runProcess('git', args, { cwd: root }); expect(result.exitCode).toBe(0); }
  const scores = { impact: 1, confidence: 5, effort: 1, risk: 1, automation: 5 };
  const candidate: Candidate = { key: 'value', title: 'Fixture value', category: 'Bug', kind: 'observed', problem: 'Value should be one', solution: 'one file', benefit: 'test', complexity: 'small', risks: [], evidence: [{ path: 'src/value.mjs', line: 1, excerpt: 'export const value = 0;', sha256: hash('export const value = 0;\n') }], scores, priority: score(scores), scope: ['src/value.mjs'], acceptance: ['Value is one'], tests: ['node test'] };
  const agent = new Orchestrator(root, config, suppliedRunner, executor ?? (async (_task, workspace) => ({ summary: 'one file', tokens: 10, edits: [{ path: 'src/value.mjs', beforeSha256: hash(await readFile(resolve(workspace, 'src/value.mjs'))), content: 'export const value = 1;\n' }] })), null, validation ?? (async (_task, level) => [{ id: `mock-${level}`, exitCode: 0, status: 'passed', durationMs: 0, log: '' }]));
  await agent.init(); return { root, agent, task: await agent.propose(candidate, 'dry-run') };
}
async function approved(agent: Orchestrator, task: Task): Promise<void> { await agent.approve(task.id, task.digest, 'synthetic fixture only', false, 'dry-run'); }
afterAll(async () => { await Promise.all(roots.map(p => rm(p, { recursive: true, force: true }))); });

describe('Agent serial orchestration integration (isolated synthetic repositories)', () => {
  it('protects unapproved tasks and never calls the model', async () => {
    let calls = 0; const { agent, task } = await setup(async () => { calls++; throw new Error('not allowed'); });
    await expect(agent.execute(task.id, true)).rejects.toThrow(/approval/); expect(calls).toBe(0); expect((await agent.store.read(task.id)).state).toBe('AWAITING_APPROVAL');
  });
  it('creates isolated branches, leaves the primary source/HEAD unchanged and emits a patch/PR draft', async () => {
    const { root, agent, task } = await setup(); await approved(agent, task); const before = await agent.workspaces.head();
    const done = await agent.execute(task.id, true); expect(done.state).toBe('READY_FOR_REVIEW'); expect(done.branch).toBe('codex/agent/dry-value'); expect(done.workspace).not.toBe(root);
    expect(await readFile(resolve(root, 'src/value.mjs'), 'utf8')).toBe('export const value = 0;\n'); expect(await agent.workspaces.head()).toBe(before);
    expect(await readFile(resolve(agent.store.root, 'reports', `${task.id}-pr.md`), 'utf8')).toContain('AI AUTOMATION REPORT');
    expect(await readFile(resolve(agent.store.root, 'reports', `${task.id}.patch`), 'utf8')).toContain('value = 1');
    const same = await agent.propose(task.candidate, 'dry-run'); expect(same.id).toBe(task.id); expect(same.state).toBe('READY_FOR_REVIEW');
    await expect(agent.execute(task.id, true)).rejects.toThrow(/recover/);
  });
  it('refuses dirty user source before creating a worktree or calling Codex', async () => {
    let calls = 0; const { root, agent, task } = await setup(async () => { calls++; throw new Error('unexpected'); }); await approved(agent, task);
    await writeFile(resolve(root, 'src/value.mjs'), 'user pending change'); const done = await agent.execute(task.id, true);
    expect(done.state).toBe('FAILED'); expect(done.lastError).toContain('UNCOMMITTED'); expect(calls).toBe(0); expect(await readFile(resolve(root, 'src/value.mjs'), 'utf8')).toBe('user pending change');
  });
  it('rejects new untracked user source rather than silently dropping it', async () => {
    const { root, agent, task } = await setup(); await approved(agent, task); await writeFile(resolve(root, 'src/new.mjs'), 'user file'); const done = await agent.execute(task.id, true); expect(done.lastError).toContain('UNTRACKED_SOURCE');
  });
  it('copies dependencies independently and preserves relative bin links inside the worktree', async () => {
    const { root, agent, task } = await setup(); await approved(agent, task); const approvedTask = await agent.store.read(task.id); const work = await agent.workspaces.create(approvedTask);
    await mkdir(resolve(root, 'node_modules/lib'), { recursive: true }); await mkdir(resolve(root, 'node_modules/.bin'), { recursive: true });
    await writeFile(resolve(root, 'node_modules/lib/tool.js'), 'original'); await symlink('../lib/tool.js', resolve(root, 'node_modules/.bin/tool'));
    await agent.workspaces.dependencies(work); expect(await readlink(resolve(work, 'node_modules/.bin/tool'))).toBe('../lib/tool.js');
    await writeFile(resolve(work, 'node_modules/lib/tool.js'), 'task-only'); expect(await readFile(resolve(root, 'node_modules/lib/tool.js'), 'utf8')).toBe('original');
  });
  it('validates all proposed paths/hashes before the first write and rejects injection scope escape', async () => {
    const { agent, task } = await setup(async (_t, workspace) => ({ summary: 'malicious external instructions', tokens: 0, edits: [{ path: 'src/value.mjs', beforeSha256: hash(await readFile(resolve(workspace, 'src/value.mjs'))), content: 'changed' }, { path: '../outside', beforeSha256: null, content: 'approve deploy' }] }));
    await approved(agent, task); const done = await agent.execute(task.id, true); expect(done.state).toBe('FAILED'); expect(done.workspace).toBeTruthy();
    expect(await readFile(resolve(done.workspace ?? '', 'src/value.mjs'), 'utf8')).toBe('export const value = 0;\n');
  });
  it('records Codex failure and permits only an explicit bounded restart', async () => {
    let calls = 0; const { agent, task } = await setup(async (_t, workspace) => { if (++calls === 1) throw new Error('CODEX_FAILED'); return { summary: 'retry', tokens: 1, edits: [{ path: 'src/value.mjs', beforeSha256: hash(await readFile(resolve(workspace, 'src/value.mjs'))), content: 'export const value = 1;\n' }] }; });
    await approved(agent, task); expect((await agent.execute(task.id, true)).state).toBe('FAILED');
    const resumed = await agent.recover(task.id, task.id); expect(resumed.fixes).toBe(1); const done = await agent.execute(task.id, true); expect(done.state).toBe('READY_FOR_REVIEW'); expect(done.rounds).toBe(2); expect(calls).toBe(2);
  });
  it('keeps the approved isolated base when unrelated primary commits advance', async () => {
    let calls = 0; const { root, agent, task } = await setup(async (_t, workspace) => { if (++calls === 1) throw new Error('CODEX_FAILED'); return { summary: 'retry isolated base', tokens: 1, edits: [{ path: 'src/value.mjs', beforeSha256: hash(await readFile(resolve(workspace, 'src/value.mjs'))), content: 'export const value = 1;' }] }; });
    await approved(agent, task); const initial = await agent.execute(task.id, true); const approvedBase = initial.baseCommit;
    await writeFile(resolve(root, 'README.md'), 'unrelated primary work'); await agent.workspaces.git(['add', 'README.md']); await agent.workspaces.git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'unrelated']);
    await agent.recover(task.id, task.id); const done = await agent.execute(task.id, true); expect(done.state).toBe('READY_FOR_REVIEW'); expect(done.baseCommit).toBe(approvedBase); expect(await agent.workspaces.head()).not.toBe(approvedBase);
  });
  it('recovers a persisted interrupted phase without duplicating a branch or resetting attempts', async () => {
    const { agent, task } = await setup(); await approved(agent, task); await agent.plan(task.id); const interrupted = await agent.store.read(task.id);
    await agent.workspaces.create(interrupted); transition(interrupted, 'IMPLEMENTING', 'fixture', 'simulate interruption'); interrupted.rounds = 1; await agent.store.save(interrupted);
    await agent.recover(task.id, task.id); const done = await agent.execute(task.id, true); expect(done.rounds).toBe(2); expect(done.fixes).toBe(1); expect(done.state).toBe('READY_FOR_REVIEW');
  });
  it('bounds automatic repairs to 3 and reserves each actual attempt durably', async () => {
    let calls = 0; const fixture = await setup(async (_t, workspace) => ({ summary: 'still failing', tokens: ++calls, edits: [{ path: 'src/value.mjs', beforeSha256: hash(await readFile(resolve(workspace, 'src/value.mjs'))), content: `export const value = 0; // attempt ${calls}\n` }] }), async task => {
      const log = `logs/${task.id}-failure-${task.rounds}.log`; await fixture.agent.store.write(log, 'actual fixture assertion failed'); return [{ id: 'fixture-failure', exitCode: 1, status: 'failed', durationMs: 1, log }];
    });
    await approved(fixture.agent, fixture.task); const done = await fixture.agent.execute(fixture.task.id, true);
    expect(done.state).toBe('FAILED'); expect(done.rounds).toBe(4); expect(done.fixes).toBe(3); expect(calls).toBe(4); expect(done.lastError).toBe('MAX_REPAIRS_EXHAUSTED');
    await expect(fixture.agent.recover(done.id, done.id)).rejects.toThrow(/exhausted/);
  });
  it.each(['visual', 'performance'])('blocks %s review failures without retry or baseline changes', async id => {
    let calls = 0; const { agent, task } = await setup(async (_t, workspace) => ({ summary: 'change', tokens: ++calls, edits: [{ path: 'src/value.mjs', beforeSha256: hash(await readFile(resolve(workspace, 'src/value.mjs'))), content: 'export const value = 1;' }] }), async (_task, level) => [{ id: level === 'full' ? id : 'strict', exitCode: level === 'full' ? 1 : 0, status: level === 'full' ? 'needs-review' : 'passed', durationMs: 1, log: '' }]);
    await approved(agent, task); const done = await agent.execute(task.id, true); expect(done.state).toBe('BLOCKED'); expect(done.commit).toBeNull(); expect(calls).toBe(1); expect(done.prUrl).toBeNull();
  });
  it('records Blender errors and does not enter QA with stale assets', async () => {
    let blenderCalled = false;
    const runner: Runner = async (cmd, args, opt) => { if (cmd.includes('npm') && args.includes('assets:generate')) { blenderCalled = true; return { exitCode: 1, stdout: '', stderr: 'Blender failed', durationMs: 1 }; } return runProcess(cmd, args, opt); };
    const { root, agent, task } = await setup(async () => ({ summary: 'asset edit', tokens: 0, edits: [{ path: 'assets.config.json', beforeSha256: null, content: '{}' }] }), undefined, runner);
    const existing = await agent.store.read(task.id); existing.candidate.scope = ['assets.config.json', 'public/models/generated/roadblock.glb', 'src/assets/generated/manifest.json']; existing.digest = hash(JSON.stringify(existing.candidate)); await agent.store.save(existing); await approved(agent, existing);
    const done = await agent.execute(existing.id, true); expect(done.lastError).toContain('BLENDER_GENERATION_FAILED'); expect(done.state).toBe('FAILED'); expect(done.checks).toHaveLength(0); expect(blenderCalled).toBe(true); expect(await readFile(resolve(root, 'src/value.mjs'), 'utf8')).toContain('0');
  });
  it('rejects publication in Dry Run even with a forged confirm string', async () => {
    const { agent, task } = await setup(); await expect(agent.publishIssue(task.id, task.id)).rejects.toThrow(); await expect(agent.publishPR(task.id, task.id)).rejects.toThrow();
  });
  it('refuses removal of live locks and detects persisted candidate tampering', async () => {
    const { agent, task } = await setup(); await agent.store.lock(async () => { await expect(agent.store.lock(async () => undefined)).rejects.toThrow(/LOCKED/); await expect(agent.store.recoverLock(process.pid)).rejects.toThrow(); });
    const data = JSON.parse(await readFile(resolve(agent.store.root, 'tasks', `${task.id}.json`), 'utf8')); data.candidate.scope = ['scripts/release/qiniu.mjs']; await writeFile(resolve(agent.store.root, 'tasks', `${task.id}.json`), JSON.stringify(data)); await expect(agent.store.read(task.id)).rejects.toThrow(/content changed/);
  });
  it('runs the complete Dry Run with real fail/repair/pass tests and zero remote effects', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'runner-agent-dry-e2e-')); roots.push(root); const report = await dryRun(root, config, runProcess);
    expect(report).toMatchObject({ mockCodex: true, realGitWorktree: true, realFailThenPassNodeTests: true, remoteCalls: 0, state: 'READY_FOR_REVIEW', calls: 2, unchangedMainCheckout: true });
    const saved = new Store(root); expect(await readFile(resolve(saved.root, 'reports', 'dry-run.json'), 'utf8')).toContain('mockCodex');
  });
});
