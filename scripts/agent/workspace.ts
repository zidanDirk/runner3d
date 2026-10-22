import { constants } from 'node:fs';
import { cp, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { branchName, contained, editablePath, hash, safePath } from './security';
import { check } from './types';
import type { Edit, Runner, Task } from './types';

export class Workspaces {
  constructor(readonly repository: string, private runner: Runner, readonly directory: string) {}
  async git(args: string[], cwd = this.repository): Promise<string> {
    const result = await this.runner('git', args, { cwd, timeoutMs: 30000, maxBytes: 1048576 });
    check(result.exitCode === 0, `GIT_FAILED: ${args[0]}`); return result.stdout.trim();
  }
  async head(): Promise<string> { return this.git(['rev-parse', 'HEAD']); }
  async clean(): Promise<void> {
    check(!(await this.git(['status', '--porcelain=v1', '--untracked-files=no'])), 'UNCOMMITTED_CHANGES: commit or preserve user changes before starting');
    const untracked = await this.git(['ls-files', '--others', '--exclude-standard']);
    const source = untracked.split('\n').filter(path => path && !path.startsWith('artifacts/'));
    check(source.length === 0, 'UNTRACKED_SOURCE: user files must not be silently omitted from the task base');
  }
  async create(task: Task, reserve?: () => Promise<void>): Promise<string> {
    check(task.approval, 'Missing approval');
    const path = resolve(this.directory, task.id), branch = branchName(task.id);
    let exists = false; try { exists = (await lstat(path)).isDirectory(); } catch { /* Not created. */ }
    if (exists) {
      check(task.workspace === path && task.branch === branch && !(await lstat(path)).isSymbolicLink(), 'Existing workspace is not owned by this task');
      check(await this.git(['branch', '--show-current'], path) === branch, 'Workspace branch mismatch');
      check(await this.git(['merge-base', task.approval.baseCommit, 'HEAD'], path) === task.approval.baseCommit, 'Workspace base mismatch');
    } else {
      const reserved = task.workspace === path && task.branch === branch && task.baseCommit === task.approval.baseCommit;
      const branchStatus = await this.runner('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: this.repository, timeoutMs: 15000 });
      check(branchStatus.exitCode === 0 || branchStatus.exitCode === 1, 'Cannot inspect task branch');
      if (!reserved) {
        await this.clean(); check(task.approval.baseCommit === await this.head(), 'Repository HEAD changed since approval');
        check(branchStatus.exitCode !== 0, 'Existing unowned branch must not be reset/reused');
        task.branch = branch; task.workspace = path; task.baseCommit = task.approval.baseCommit;
        await reserve?.(); // Crash-safe allocation intent before Git creates the branch/worktree.
      }
      if (branchStatus.exitCode === 0) {
        check(await this.git(['rev-parse', branch]) === task.approval.baseCommit, 'Reserved branch advanced unexpectedly');
        await this.git(['worktree', 'add', path, branch]);
      } else await this.git(['worktree', 'add', '--no-track', '-b', branch, path, task.approval.baseCommit]);
    }
    task.branch = branch; task.workspace = path; task.baseCommit = task.approval.baseCommit;
    return path;
  }
  async dependencies(path: string): Promise<void> {
    const target = resolve(path, 'node_modules'); try { const stat = await lstat(target); check(stat.isDirectory() && !stat.isSymbolicLink(), 'Shared dependency symlink is forbidden'); return; } catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e; }
    // Reflink when available, independent files otherwise. Never link writable caches to user work.
    await cp(resolve(this.repository, 'node_modules'), target, { recursive: true, mode: constants.COPYFILE_FICLONE, force: false, errorOnExist: true, verbatimSymlinks: true });
  }
  async apply(task: Task, edits: Edit[], maxBytes: number): Promise<void> {
    check(task.workspace && task.branch === branchName(task.id), 'Not an isolated task workspace');
    check(await this.git(['branch', '--show-current'], task.workspace) === task.branch, 'Protected or changed branch');
    check(edits.length > 0 && edits.length <= 20 && new Set(edits.map(e => e.path)).size === edits.length, 'Invalid edit batch');
    let bytes = 0;
    const pending: { path: string; content: string }[] = [];
    for (const edit of edits) {
      editablePath(edit.path); check(task.candidate.scope.includes(edit.path), 'Edit exceeds human-approved scope');
      check(edit.path !== 'src/assets/generated/manifest.json', 'Generated Manifest may only be written by the asset factory');
      check(!/\.(?:glb|png|jpg|webp|wav|mp4|webm)$/.test(edit.path), 'Binary assets must use the validated factory');
      bytes += Buffer.byteLength(edit.content); check(bytes <= maxBytes && !edit.content.includes('\0'), 'Invalid/oversize edit content');
      check(!/-----BEGIN [^-]*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9_]{24,}|github_pat_[A-Za-z0-9_]{24,}|sk-[A-Za-z0-9_-]{24,})\b/.test(edit.content), 'Possible credential in model output; review required');
      const path = await contained(task.workspace, edit.path); let existing: string | null = null;
      try { existing = hash(await readFile(path)); } catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e; }
      check(existing === edit.beforeSha256, 'STALE_EDIT: original content hash does not match');
      check(!/(?:\bit|\btest|\bdescribe)\.(?:skip|todo|only)\s*\(/.test(edit.content), 'Skipping or isolating tests is forbidden');
      pending.push({ path, content: edit.content });
    }
    // Validate the entire batch before the first write. Crash recovery retains any partial local edits.
    for (const edit of pending) { await mkdir(resolve(edit.path, '..'), { recursive: true }); await writeFile(edit.path, edit.content, { mode: 0o644 }); }
  }
  async changes(task: Task): Promise<string[]> {
    check(task.workspace && task.baseCommit, 'No workspace');
    const tracked = await this.git(['diff', '--name-only', task.baseCommit], task.workspace);
    const untracked = await this.git(['ls-files', '--others', '--exclude-standard'], task.workspace);
    const paths = [...new Set([...tracked.split('\n'), ...untracked.split('\n').filter(p => !p.startsWith('artifacts/') || task.candidate.scope.includes(p))].filter(Boolean))];
    for (const path of paths) { safePath(path); check(task.candidate.scope.includes(path), `OUT_OF_SCOPE: ${path}`); }
    return paths;
  }
  async commit(task: Task): Promise<string> {
    check(task.workspace && task.branch === branchName(task.id), 'Task workspace required');
    check(await this.git(['branch', '--show-current'], task.workspace) === task.branch, 'Refusing commit on protected branch');
    const files = await this.changes(task); check(files.length > 0, 'NO_CHANGES: cannot claim implementation success');
    await this.git(['add', '--', ...files], task.workspace);
    await this.git(['-c', 'core.hooksPath=/dev/null', 'commit', '-m', `agent: ${task.candidate.key}`], task.workspace);
    return this.git(['rev-parse', 'HEAD'], task.workspace);
  }
  async patch(task: Task): Promise<string> {
    check(task.workspace && task.baseCommit, 'No task workspace');
    let patch = await this.git(['diff', '--binary', task.baseCommit], task.workspace);
    const untracked = (await this.git(['ls-files', '--others', '--exclude-standard'], task.workspace)).split('\n').filter(p => task.candidate.scope.includes(p));
    for (const path of untracked) {
      const result = await this.runner('git', ['diff', '--no-index', '--binary', '--', '/dev/null', path], { cwd: task.workspace, maxBytes: 1048576 });
      check(result.exitCode === 0 || result.exitCode === 1, 'Cannot capture new file in local patch'); patch += '\n' + result.stdout;
    }
    return patch;
  }
  async push(task: Task): Promise<void> {
    check(task.workspace && task.commit && task.branch === branchName(task.id), 'Owned committed branch required');
    check(await this.git(['rev-parse', 'HEAD'], task.workspace) === task.commit, 'Workspace changed after QA');
    check(!(await this.git(['status', '--porcelain=v1', '--untracked-files=no'], task.workspace)), 'Uncommitted task workspace');
    const unknown = (await this.git(['ls-files', '--others', '--exclude-standard'], task.workspace)).split('\n').filter(p => p && !p.startsWith('artifacts/'));
    check(unknown.length === 0, 'Untracked task source cannot be pushed');
    await this.git(['fetch', 'origin', 'master'], task.workspace);
    const ancestor = await this.runner('git', ['merge-base', '--is-ancestor', task.baseCommit ?? '', 'origin/master'], { cwd: task.workspace, timeoutMs: 15000 });
    check(ancestor.exitCode === 0, 'PR_BASE_NOT_PUBLISHED: base must already be in remote master; do not smuggle unrelated parent changes into the Issue PR');
    await this.git(['-c', 'core.hooksPath=/dev/null', 'push', 'origin', `${task.commit}:refs/heads/${task.branch}`], task.workspace);
  }
}
