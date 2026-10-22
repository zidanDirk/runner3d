import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { branchName, hash, redact } from './security';
import { check, record, STATES } from './types';
import type { Candidate, Task } from './types';

export class Store {
  readonly root: string;
  constructor(repository: string) { this.root = resolve(repository, '.agent-data'); }
  async init(): Promise<void> {
    try { check(!(await lstat(this.root)).isSymbolicLink(), 'Agent state root cannot be a symlink'); } catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e; }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const name of ['tasks', 'reports', 'logs', 'worktrees', 'drafts', 'dry-runs']) { const path = resolve(this.root, name); await mkdir(path, { recursive: true, mode: 0o700 }); check(!(await lstat(path)).isSymbolicLink(), 'State directory cannot be a symlink'); }
  }
  async write(path: string, data: unknown): Promise<void> {
    check(/^(?:tasks|reports|logs|drafts)\/[a-zA-Z0-9._-]+$/.test(path), 'Invalid state artifact path');
    const target = resolve(this.root, path); try { check(!(await lstat(target)).isSymbolicLink(), 'State artifact symlink forbidden'); } catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e; }
    if (path.startsWith('logs/')) { let exists = false; try { await lstat(target); exists = true; } catch { /* New immutable log. */ } check(!exists, 'LOG_COLLISION: existing audit log must never be overwritten'); }
    const body = typeof data === 'string' ? redact(data) : JSON.stringify(data, null, 2) + '\n';
    check(Buffer.byteLength(body) <= 1048576, 'State artifact exceeds 1MiB');
    const temporary = `${target}.${randomUUID()}.tmp`, file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(body); await file.sync(); } finally { await file.close(); }
    await rename(temporary, target);
  }
  async read(id: string): Promise<Task> {
    branchName(id); const path = resolve(this.root, 'tasks', `${id}.json`); check(!(await lstat(path)).isSymbolicLink(), 'State symlink forbidden');
    check((await stat(path)).size <= 1048576, 'State artifact exceeds 1MiB');
    const value: unknown = JSON.parse(await readFile(path, 'utf8')); const obj = record(value);
    check(obj.schemaVersion === 1 && obj.id === id && typeof obj.state === 'string' && STATES.some(s => s === obj.state), 'Invalid task state');
    // Local state is trusted operator-owned data, still detect accidental candidate tampering.
    const task = value as Task; check(task.digest === hash(JSON.stringify(task.candidate)), 'Task content changed: approval invalid'); return task;
  }
  save(task: Task): Promise<void> { task.updatedAt = new Date().toISOString(); return this.write(`tasks/${task.id}.json`, task); }
  async create(candidate: Candidate, mode: Task['mode'] = 'real'): Promise<Task> {
    const id = `${mode === 'dry-run' ? 'dry-' : ''}${candidate.key}`; branchName(id);
    try {
      const existing = await this.read(id);
      if (existing.digest !== hash(JSON.stringify(candidate))) {
        check(existing.state === 'AWAITING_APPROVAL', 'Candidate evidence changed after approval: human review/new task required');
        check(existing.events.length < 128, 'Audit event budget exhausted');
        existing.candidate = candidate; existing.digest = hash(JSON.stringify(candidate)); existing.approval = null;
        existing.events.push({ at: new Date().toISOString(), from: existing.state, to: existing.state, phase: 'research', issue: existing.issue?.number ?? null, branch: existing.branch, summary: 'Unapproved evidence revised; digest/approval invalidated' });
        await this.save(existing);
      }
      return existing;
    } catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e; }
    check((await readdir(resolve(this.root, 'tasks'))).filter(p => p.endsWith('.json')).length < 100, 'Local task retention limit (100) reached');
    const now = new Date().toISOString();
    const task: Task = { schemaVersion: 1, id, mode, state: 'DISCOVERED', candidate, digest: hash(JSON.stringify(candidate)), issue: null, approval: null, branch: null, workspace: null, baseCommit: null, rounds: 0, fixes: 0, tokens: 0, startedAt: null, updatedAt: now, plan: null, checks: [], lastError: null, commit: null, prUrl: null, remoteIntent: null, events: [{ at: now, from: null, to: 'DISCOVERED', phase: 'research', issue: null, branch: null, summary: 'Evidence-backed candidate created' }] };
    await this.save(task); return task;
  }
  async list(): Promise<Task[]> { const result: Task[] = []; for (const name of (await readdir(resolve(this.root, 'tasks'))).sort()) if (/^[a-z0-9-]+\.json$/.test(name)) result.push(await this.read(name.slice(0, -5))); return result; }
  async lock<T>(action: () => Promise<T>): Promise<T> {
    const path = resolve(this.root, 'run.lock'), owner = randomUUID();
    try { await mkdir(path, { mode: 0o700 }); } catch { throw new Error('AGENT_LOCKED: another operation or interrupted lock exists; inspect status/recover first'); }
    const metadata = { owner, pid: process.pid, host: hostname(), at: new Date().toISOString() };
    await (await import('node:fs/promises')).writeFile(resolve(path, 'owner.json'), JSON.stringify(metadata), { mode: 0o600 });
    try { return await action(); } finally { const current: unknown = JSON.parse(await readFile(resolve(path, 'owner.json'), 'utf8')); if (record(current).owner === owner) await rm(path, { recursive: true }); }
  }
  /** An operator explicitly recovers our dead, same-host lock. Never delete somebody else's live lock. */
  async recoverLock(confirmPid: number): Promise<void> {
    const path = resolve(this.root, 'run.lock'); check(!(await lstat(path)).isSymbolicLink(), 'Lock symlink forbidden');
    const data = record(JSON.parse(await readFile(resolve(path, 'owner.json'), 'utf8')));
    check(data.host === hostname() && data.pid === confirmPid && Number.isSafeInteger(confirmPid), 'Lock identity mismatch');
    let dead = false; try { process.kill(confirmPid, 0); } catch (e) { dead = e instanceof Error && 'code' in e && e.code === 'ESRCH'; }
    check(dead, 'Lock owner is alive or inaccessible; recovery denied'); await rm(path, { recursive: true });
  }
}
