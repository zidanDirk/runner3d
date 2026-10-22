import { createHash } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { check, fields, text } from './types';
import type { Config, Scores } from './types';

export function hash(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
export function redact(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/g, '[REDACTED]')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|password|secret|QINIU_AK|QINIU_SK|authorization)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[REDACTED]@')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
}
export function safeEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const keys = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL'];
  return { ...Object.fromEntries(keys.filter(k => source[k] !== undefined).map(k => [k, source[k]])), CI: '1', NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0' };
}
export function safePath(path: string): string {
  check(path.length <= 180 && /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(path) && !isAbsolute(path), 'Unsafe repository path');
  check(path.split('/').every(p => p !== '.' && p !== '..' && p.length > 0 && !p.startsWith('.')), 'Hidden/traversal path is forbidden');
  check(!/(?:^|\/)(?:node_modules|dist|coverage|test-results|playwright-report)(?:\/|$)/.test(path), 'Generated/private path is forbidden');
  return path;
}
export function editablePath(path: string): string {
  safePath(path);
  check(!/^(?:AGENTS\.md|agent\.config\.json|package(?:-lock)?\.json|vite\.config\.ts|tsconfig[^/]*|playwright[^/]*|scripts\/(?:agent|release)\/)/.test(path), 'Control-plane/release configuration is protected');
  check(!/snapshots\//.test(path) && !/\.(?:pem|key|p12|log|heapsnapshot)$/.test(path), 'Baselines and private files are protected');
  return path;
}
/** Walk every ancestor: containment by string alone is insufficient for symlinks. */
export async function contained(root: string, path: string): Promise<string> {
  safePath(path); const base = await realpath(root); let current = base;
  for (const part of path.split('/')) {
    current = resolve(current, part);
    try { const stat = await lstat(current); check(!stat.isSymbolicLink(), 'Symlink path is forbidden'); }
    catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'ENOENT')) throw e; }
  }
  const rel = relative(base, current); check(rel !== '..' && !rel.startsWith(`..${sep}`), 'Path escaped workspace'); return current;
}
export function score(s: Scores): number {
  for (const v of Object.values(s)) check(Number.isInteger(v) && v >= 1 && v <= 5, 'Score must be integer 1..5');
  return Math.round(100 * s.impact * s.confidence * s.automation / (s.effort * s.risk)) / 100;
}
export function parseConfig(value: unknown): Config {
  const v = fields(value, ['schemaVersion', 'maxTasks', 'maxConcurrency', 'maxRounds', 'maxFixes', 'maxTaskSeconds', 'maxCallSeconds', 'maxOutputBytes', 'maxInputChars', 'maxTokens', 'retainRuns', 'approvedLabel']);
  check(v.schemaVersion === 1 && v.maxTasks === 1 && v.maxConcurrency === 1, 'Only schema1 serial single-task execution is supported');
  const integer = (key: string, min: number, max: number): number => { const n = v[key]; check(typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max, `Invalid budget ${key}`); return n; };
  const result: Config = { schemaVersion: 1, maxTasks: 1, maxConcurrency: 1, maxRounds: integer('maxRounds', 1, 4), maxFixes: integer('maxFixes', 0, 3), maxTaskSeconds: integer('maxTaskSeconds', 30, 3600), maxCallSeconds: integer('maxCallSeconds', 1, 300), maxOutputBytes: integer('maxOutputBytes', 4096, 1048576), maxInputChars: integer('maxInputChars', 1000, 128000), maxTokens: integer('maxTokens', 1000, 100000), retainRuns: integer('retainRuns', 1, 50), approvedLabel: text(v.approvedLabel, 50) };
  check(result.maxRounds <= result.maxFixes + 1 && result.maxCallSeconds <= result.maxTaskSeconds, 'Inconsistent budgets'); return result;
}
export function branchName(id: string): string { check(/^[a-z0-9][a-z0-9-]{0,63}$/.test(id), 'Invalid task ID'); return `codex/agent/${id}`; }
