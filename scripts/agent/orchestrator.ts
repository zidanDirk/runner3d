import { lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assertApproved, transition } from './state';
import { branchName, contained, editablePath, hash, redact } from './security';
import { check } from './types';
import type { Candidate, Config, Executor, Runner, Task } from './types';
import { Store } from './store';
import { Workspaces } from './workspace';
import { GitHub, duplicate } from './github';
import { issueBody, research, SCORING } from './research';
import { baselineHashes, planTask, reportBody, validator } from './validation';
import type { Validator } from './validation';

export class Orchestrator {
  readonly store: Store; readonly workspaces: Workspaces; private validate: Validator;
  constructor(readonly root: string, readonly config: Config, private runner: Runner, private executor: Executor | null, readonly github: GitHub | null = null, validate?: Validator, private qaRunner?: Runner) {
    this.store = new Store(root); this.workspaces = new Workspaces(root, runner, resolve(this.store.root, 'worktrees'));
    this.validate = validate ?? ((task, level) => {
      const driver = task.mode === 'dry-run' ? runner : this.qaRunner; check(driver, 'QA_SANDBOX_REQUIRED: real tasks cannot use an unrestricted runner');
      return validator(driver, this.store, config)(task, level);
    });
  }
  async init(): Promise<void> { await this.store.init(); }
  async propose(candidate: Candidate, mode: Task['mode'] = 'real'): Promise<Task> {
    for (const path of candidate.scope) editablePath(path);
    const task = await this.store.create(candidate, mode);
    if (task.state === 'DISCOVERED') transition(task, 'PROPOSED', 'research', 'Evidence and fixed scoring recorded');
    if (task.state === 'PROPOSED') transition(task, 'AWAITING_APPROVAL', 'research', 'Human approval required');
    await this.store.save(task); await this.store.write(`drafts/${task.id}-issue.md`, issueBody(candidate)); return task;
  }
  async research(): Promise<Task[]> {
    return this.store.lock(async () => {
      const index = this.github ? await this.github.index() : { available: false, complete: false, issues: [], error: 'No GitHub adapter' };
      const tasks: Task[] = [];
      for (const c of await research(this.root)) {
        const task = await this.propose(c), existing = duplicate(c.key, c.title, index.issues);
        if (existing && !task.issue) { task.issue = { number: existing.number, url: existing.url, bodyHash: hash(existing.body) }; await this.store.save(task); } tasks.push(task);
      }
      await this.store.write('reports/research.json', { at: new Date().toISOString(), scoring: SCORING, github: { available: index.available, complete: index.complete, error: index.error ?? null }, candidates: tasks.map(t => ({ id: t.id, state: t.state, candidate: t.candidate, duplicateIssue: t.issue?.url ?? null })) }); return tasks;
    });
  }
  async approve(id: string, confirm: string, actor: string, highRisk = false, source: 'local-human' | 'dry-run' = 'local-human'): Promise<Task> {
    return this.store.lock(async () => {
      const task = await this.store.read(id); check(confirm === task.digest && actor.trim().length > 0 && actor.length < 100, 'Exact issue digest and human reviewer are required');
      if ((task.state === 'FAILED' || task.state === 'BLOCKED') && task.rounds === 0 && task.workspace === null) { transition(task, 'AWAITING_APPROVAL', 'human', 'No implementation attempt/workspace exists; operator rebinds unchanged scope to current base'); task.approval = null; }
      check(task.state === 'AWAITING_APPROVAL', 'Only awaiting tasks may be approved');
      check((source === 'dry-run') === (task.mode === 'dry-run'), 'Synthetic approval cannot approve a real task');
      for (const e of task.candidate.evidence) check(hash(await readFile(await contained(this.root, e.path))) === e.sha256, 'Evidence changed: rerun research and request fresh approval');
      for (const p of task.candidate.scope) editablePath(p);
      task.approval = { source, actor: redact(actor), issueDigest: task.digest, baseCommit: await this.workspaces.head(), highRiskAccepted: highRisk, at: new Date().toISOString() };
      assertApproved(task, task.approval.baseCommit, source === 'dry-run'); transition(task, 'APPROVED', 'human', 'Explicit scope/content/base-bound approval recorded'); await this.store.save(task); return task;
    });
  }
  async approveFromGitHub(id: string): Promise<Task> {
    return this.store.lock(async () => {
      const task = await this.store.read(id); check(this.github && task.state === 'AWAITING_APPROVAL' && task.mode === 'real', 'Real awaiting GitHub Issue required');
      for (const e of task.candidate.evidence) check(hash(await readFile(await contained(this.root, e.path))) === e.sha256, 'Evidence changed: human review required');
      const receipt = await this.github.humanApproval(task, this.config.approvedLabel);
      task.approval = { source: 'github-human', actor: receipt.actor, eventId: receipt.eventId, issueDigest: task.digest, baseCommit: await this.workspaces.head(), highRiskAccepted: false, at: new Date().toISOString() };
      assertApproved(task, task.approval.baseCommit, false); transition(task, 'APPROVED', 'human', 'Authorized human GitHub label event verified'); await this.store.save(task); return task;
    });
  }
  private async approval(task: Task): Promise<void> {
    assertApproved(task, task.baseCommit ?? await this.workspaces.head(), task.mode === 'dry-run');
    if (task.workspace && task.baseCommit) {
      let exists = false; try { exists = (await lstat(task.workspace)).isDirectory(); } catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e; }
      if (exists) { check(await this.workspaces.git(['branch', '--show-current'], task.workspace) === task.branch, 'Owned task branch changed'); check(await this.workspaces.git(['merge-base', task.baseCommit, 'HEAD'], task.workspace) === task.baseCommit, 'Approved workspace base changed'); }
    }
    if (task.mode === 'real' && task.issue) { check(this.github, 'Live Issue approval cannot be checked offline'); await this.github.validateIssue(task); }
    if (task.approval?.source === 'github-human') { check(this.github, 'GitHub approval requires live verification'); const current = await this.github.humanApproval(task, this.config.approvedLabel); check(current.eventId === task.approval.eventId, 'Approval event changed; reapproval required'); }
  }
  async plan(id: string): Promise<Task> {
    return this.store.lock(async () => { const task = await this.store.read(id); await this.approval(task); check(task.state === 'APPROVED' || task.state === 'PLANNING', 'Task is not approved for planning'); if (task.state === 'APPROVED') transition(task, 'PLANNING', 'planning', 'Bounded one-level file/dependency/test plan'); task.plan = planTask(task); await this.store.save(task); await this.store.write(`reports/${id}-plan.json`, task.plan); return task; });
  }
  private budget(task: Task): void {
    check(task.rounds < this.config.maxRounds && task.fixes <= this.config.maxFixes && task.tokens < this.config.maxTokens, 'Execution/repair/token budget exhausted');
    check(task.startedAt && Date.now() - Date.parse(task.startedAt) < this.config.maxTaskSeconds * 1000, 'Task wall-time budget exhausted');
  }
  async execute(id: string, allowDryRun = false): Promise<Task> {
    return this.store.lock(async () => {
      const task = await this.store.read(id); check(this.executor, 'No Codex executor available');
      check(task.mode === 'real' || allowDryRun, 'Dry Run requires the dedicated simulator');
      await this.approval(task); check(['APPROVED', 'PLANNING'].includes(task.state), 'Use explicit recover/verify for interrupted or failed tasks');
      if (task.state === 'APPROVED') transition(task, 'PLANNING', 'planning', 'Bounded task plan'); task.plan ??= planTask(task);
      task.startedAt ??= new Date().toISOString();
      try {
        const workspace = await this.workspaces.create(task, () => this.store.save(task)); await this.store.save(task);
        if (!allowDryRun) await this.workspaces.dependencies(workspace);
        const visualBefore = await baselineHashes(this.runner, workspace); let feedback = '';
        transition(task, 'IMPLEMENTING', 'implementation', 'Read-only Codex proposals; controller owns writes'); await this.store.save(task);
        for (;;) {
          this.budget(task); await this.approval(task); task.rounds++; await this.store.save(task); // Reserve attempt before any model side effect.
          const proposal = await this.executor(task, workspace, feedback); task.tokens += proposal.tokens;
          check(task.tokens <= this.config.maxTokens, 'Reported token budget exceeded; response not applied');
          await this.workspaces.apply(task, proposal.edits, this.config.maxOutputBytes); await this.workspaces.changes(task);
          transition(task, 'VALIDATING', 'qa', 'Fast Validation then repository Full Validation'); await this.store.save(task);
          if (task.plan.requiresAssets) await this.generate(task);
          const fast = await this.validate(task, 'fast'); task.checks.push(...fast);
          const full = fast.every(c => c.status === 'passed') ? await this.validate(task, 'full') : []; task.checks.push(...full);
          const visualAfter = await baselineHashes(this.runner, workspace); check(JSON.stringify(visualBefore) === JSON.stringify(visualAfter), 'VISUAL_BASELINE_CHANGED: manual approval is required');
          await this.workspaces.changes(task); const current = [...fast, ...full]; check(current.length > 0, 'QA returned no checks');
          if (current.every(c => c.status === 'passed') && full.length > 0) {
            await this.approval(task); task.commit = await this.workspaces.commit(task); transition(task, 'READY_FOR_REVIEW', 'qa', 'Actual checks passed; human review/merge still required'); task.lastError = null; break;
          }
          if (current.some(c => c.status === 'needs-review')) { task.lastError = 'VISUAL_OR_PERFORMANCE_REVIEW_REQUIRED'; transition(task, 'BLOCKED', 'qa', 'Keep baseline/actual/diff; never auto-update'); break; }
          if (task.fixes >= this.config.maxFixes || task.rounds >= this.config.maxRounds) { task.lastError = 'MAX_REPAIRS_EXHAUSTED'; transition(task, 'FAILED', 'qa', task.lastError); break; }
          task.fixes++;
          feedback = (await Promise.all(current.filter(c => c.status === 'failed').map(c => readFile(resolve(this.store.root, c.log), 'utf8')))).join('\n');
          transition(task, 'IMPLEMENTING', 'repair', 'Bounded repair after actual QA failure'); await this.store.save(task);
        }
      } catch (error) {
        task.lastError = redact(error instanceof Error ? error.message : 'AGENT_FAILED').slice(0, 1000);
        if (['APPROVED', 'PLANNING', 'IMPLEMENTING', 'VALIDATING'].includes(task.state)) transition(task, task.lastError.includes('CANCELLED') ? 'CANCELLED' : 'FAILED', 'orchestrator', task.lastError);
      }
      await this.store.save(task); await this.reportTask(task); return task;
    });
  }
  private async generate(task: Task): Promise<void> {
    check(task.workspace, 'No workspace');
    const ids = task.candidate.scope.map(p => /^public\/models\/generated\/([a-z0-9-]+)\.glb$/.exec(p)?.[1]).filter((s): s is string => !!s);
    check(ids.length > 0 && task.candidate.scope.includes('src/assets/generated/manifest.json'), 'Asset generation needs explicit GLB/Manifest approval');
    for (const id of ids) {
      const driver = task.mode === 'dry-run' ? this.runner : this.qaRunner; check(driver, 'QA_SANDBOX_REQUIRED');
      const result = await driver(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'assets:generate', '--', `--only=${id}`], { cwd: task.workspace, timeoutMs: this.config.maxCallSeconds * 1000, maxBytes: this.config.maxOutputBytes, env: { ...(await import('./security')).safeEnv(), ...(process.env.BLENDER_PATH ? { BLENDER_PATH: process.env.BLENDER_PATH } : {}) } });
      const log = `logs/${task.id}-blender-${task.rounds}-${id}.log`; await this.store.write(log, redact(result.stdout + '\n' + result.stderr));
      check(result.exitCode === 0, 'BLENDER_GENERATION_FAILED');
    }
    const manifest: unknown = JSON.parse(await readFile(resolve(task.workspace, 'src/assets/generated/manifest.json'), 'utf8'));
    await this.store.write(`reports/${task.id}-generated-assets.json`, manifest); // Actual factory statistics/version/seed/hash, never model-provided values.
  }
  async verify(id: string): Promise<Task> {
    return this.store.lock(async () => {
      const task = await this.store.read(id); await this.approval(task); check(task.workspace && ['BLOCKED', 'FAILED', 'VALIDATING'].includes(task.state), 'No interrupted validation to resume');
      await this.workspaces.changes(task); const visualBefore = await baselineHashes(this.runner, task.workspace);
      if (task.state !== 'VALIDATING') transition(task, 'VALIDATING', 'recovery', 'Operator requested validation of retained local work');
      await this.store.save(task);
      const fast = await this.validate(task, 'fast'); const full = fast.every(c => c.status === 'passed') ? await this.validate(task, 'full') : []; task.checks.push(...fast, ...full);
      const unchanged = JSON.stringify(visualBefore) === JSON.stringify(await baselineHashes(this.runner, task.workspace));
      await this.workspaces.changes(task);
      if (unchanged && [...fast, ...full].every(c => c.status === 'passed') && full.length > 0) { await this.approval(task); task.commit = await this.workspaces.commit(task); task.lastError = null; transition(task, 'READY_FOR_REVIEW', 'recovery', 'Retained approved-scope work passed fresh Fast/Full checks; human code review still required'); }
      else { task.lastError = 'VALIDATION_OR_BASELINE_REVIEW_REQUIRED'; transition(task, 'BLOCKED', 'recovery', task.lastError); }
      await this.store.save(task); await this.reportTask(task); return task;
    });
  }
  async recover(id: string, confirm: string): Promise<Task> {
    return this.store.lock(async () => {
      const task = await this.store.read(id); check(confirm === id && ['IMPLEMENTING', 'PLANNING', 'VALIDATING', 'FAILED', 'BLOCKED'].includes(task.state), 'Recovery requires exact task ID and interrupted task');
      await this.approval(task);
      if (['IMPLEMENTING', 'PLANNING', 'VALIDATING'].includes(task.state)) transition(task, 'BLOCKED', 'recovery', 'Interrupted result unknown; retained workspace, no remote replay');
      check(task.rounds < this.config.maxRounds && task.fixes < this.config.maxFixes, 'Recovery cannot reset exhausted budgets');
      task.fixes++; transition(task, 'PLANNING', 'recovery', 'Explicit operator resume; next call uses current file hashes'); await this.store.save(task); return task;
    });
  }
  async reportTask(task: Task): Promise<void> {
    let changed: string[] = [];
    if (task.workspace) { try { changed = await this.workspaces.changes(task); } catch { changed = ['Scope/workspace validation failed; inspect retained local work before resuming.']; } }
    await this.store.write(`reports/${task.id}-pr.md`, reportBody(task, changed));
    if (task.workspace) { try { await this.store.write(`reports/${task.id}.patch`, await this.workspaces.patch(task)); } catch { await this.store.write(`reports/${task.id}.patch`, 'Patch unavailable: workspace is incomplete or exceeds artifact limits. Inspect retained workspace; no remote success claimed.'); } }
  }
  async publishIssue(id: string, confirm: string): Promise<Task> {
    return this.store.lock(async () => {
      const task = await this.store.read(id); check(task.mode === 'real' && confirm === id && this.github, 'Explicit real GitHub write authorization required');
      if (task.issue) return task; task.remoteIntent = 'issue'; await this.store.save(task); // Crash ambiguity is resolved by live marker lookup on retry.
      task.issue = await this.github.publishIssue(task); task.remoteIntent = null; await this.store.save(task); return task;
    });
  }
  async cancel(id: string, confirm: string): Promise<Task> {
    return this.store.lock(async () => { const task = await this.store.read(id); check(confirm === id, 'Exact task ID required'); transition(task, 'CANCELLED', 'human', 'Operator cancelled; retained local work and audit'); await this.store.save(task); return task; });
  }
  async publishPR(id: string, confirm: string): Promise<Task> {
    return this.store.lock(async () => {
      const task = await this.store.read(id); check(task.mode === 'real' && confirm === id && this.github && task.branch === branchName(id), 'Explicit owned-branch PR authorization required');
      check(task.state === 'READY_FOR_REVIEW' && task.commit, 'Failed/blocked work remains a local Draft; never mark it complete'); await this.approval(task);
      if (task.prUrl) return task; task.remoteIntent = 'pr'; await this.store.save(task);
      await this.workspaces.push(task); const body = await readFile(resolve(this.store.root, 'reports', `${id}-pr.md`), 'utf8');
      task.prUrl = await this.github.draftPR(task, body); task.remoteIntent = null; await this.store.save(task); return task;
    });
  }
}
