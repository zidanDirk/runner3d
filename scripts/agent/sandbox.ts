import { realpath, mkdir, lstat, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { check } from './types';
import type { Runner } from './types';
import { safeEnv } from './security';

/** OS boundary for model-authored tests/Blender code. This is not a prompt or a command blacklist. */
export function sandboxedQA(runner: Runner, repository: string): Runner {
  return async (command, args, options) => {
    check(process.platform === 'darwin', 'QA_SANDBOX_UNAVAILABLE: this implementation requires macOS Seatbelt; provision an isolated runner on other systems');
    const cwd = await realpath(options.cwd), root = await realpath(resolve(repository, '.agent-data', 'worktrees'));
    const rel = relative(root, cwd); check(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.includes(sep), 'QA must run in an owned direct task worktree');
    const cache = resolve(cwd, '.agent-cache'), temporary = resolve(cache, 'tmp');
    for (const path of [cache, temporary]) { try { await mkdir(path); } catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'EEXIST')) throw e; } const stat = await lstat(path); check(stat.isDirectory() && !stat.isSymbolicLink(), 'QA cache symlink forbidden'); }
    const userConfig = resolve(cache, 'npm-user.npmrc'), globalConfig = resolve(cache, 'npm-global.npmrc');
    for (const path of [userConfig, globalConfig]) { const file = await open(path, constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); await file.close(); }
    const nodePrefix = resolve(dirname(await realpath(process.execPath)), '..');
    const roots = [cwd, resolve(repository, '.git'), nodePrefix, resolve(homedir(), 'Library/Caches/ms-playwright')];
    const subpath = (p: string): string => `(subpath ${JSON.stringify(p)})`;
    const profile = `(version 1)
(deny default)
(allow process*)
(allow sysctl-read)
(allow mach-lookup)
(allow file-read-metadata)
(allow file-read* (require-all (require-not (subpath "/Users")) (require-not (subpath "/Volumes")) (require-not (subpath "/Network")) (require-not (subpath "/private/var/folders")) (require-not (subpath "/private/tmp"))) ${roots.map(subpath).join(' ')})
(allow file-write* ${subpath(cwd)} (subpath "/dev"))
(allow network-outbound (remote ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
(allow network-bind (local ip "localhost:*"))
`;
    const env = { ...safeEnv(options.env), TMPDIR: temporary, NPM_CONFIG_CACHE: resolve(cache, 'npm'), NPM_CONFIG_USERCONFIG: userConfig, NPM_CONFIG_GLOBALCONFIG: globalConfig, ...(options.env?.BLENDER_PATH ? { BLENDER_PATH: options.env.BLENDER_PATH } : {}) };
    return runner('/usr/bin/sandbox-exec', ['-p', profile, command, ...args], { ...options, cwd, env });
  };
}
