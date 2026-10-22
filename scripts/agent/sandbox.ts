import { realpath, mkdir, lstat, open, access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, dirname, resolve, relative, sep } from 'node:path';
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
    const cache = resolve(cwd, '.agent-cache');
    try { await mkdir(cache); } catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'EEXIST')) throw e; }
    check((await lstat(cache)).isDirectory() && !(await lstat(cache)).isSymbolicLink(), 'QA cache symlink forbidden');
    // macOS AF_UNIX paths are short. A deeply nested worktree TMPDIR breaks Chromium SingletonSocket.
    const temporary = await mkdtemp('/private/tmp/r3dqa-');
    const userConfig = resolve(cache, 'npm-user.npmrc'), globalConfig = resolve(cache, 'npm-global.npmrc');
    for (const path of [userConfig, globalConfig]) { const file = await open(path, constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); await file.close(); }
    // Nested legacy runners preserve PATH but may intentionally drop other environment variables.
    // A fixed local shim keeps their Git fixtures independent of unreadable host credentials/config.
    const bin = resolve(cache, 'bin'); try { await mkdir(bin); } catch (e) { if (!(e instanceof Error && 'code' in e && e.code === 'EEXIST')) throw e; }
    check((await lstat(bin)).isDirectory() && !(await lstat(bin)).isSymbolicLink(), 'QA tool directory symlink forbidden');
    let realGit: string | null = null;
    for (const path of (process.env.PATH ?? '').split(delimiter).map(directory => resolve(directory, 'git'))) {
      if (path.includes('/.agent-cache/')) continue;
      try { await access(path, constants.X_OK); realGit = await realpath(path); break; } catch { /* Next installed Git. */ }
    }
    check(realGit, 'No installed Git executable available for QA');
    const git = await open(resolve(bin, 'git'), constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | constants.O_NOFOLLOW, 0o700);
    const quotedGit = "'" + realGit.replace(/'/g, "'\\''") + "'";
    try { await git.writeFile(`#!/bin/sh\nGIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null exec ${quotedGit} "$@"\n`); await git.chmod(0o700); } finally { await git.close(); }
    const nodePrefix = resolve(dirname(await realpath(process.execPath)), '..');
    const roots = [cwd, temporary, resolve(repository, '.git'), nodePrefix, resolve(homedir(), 'Library/Caches/ms-playwright')];
    const subpath = (p: string): string => `(subpath ${JSON.stringify(p)})`;
    const profile = `(version 1)
(deny default)
(allow process*)
(allow signal (target same-sandbox))
(allow sysctl-read)
(allow mach-lookup)
(allow mach-register)
(allow iokit-open (iokit-connection "IOAccelerator") (iokit-user-client-class "IOSurfaceRootUserClient") (iokit-user-client-class "IOSurfaceSendRight") (iokit-user-client-class "RootDomainUserClient") (iokit-user-client-class "IOAccelerationUserClient"))
(allow ipc-posix-shm-read* (ipc-posix-name-prefix "apple."))
(allow file-read-metadata)
(allow file-read* (require-all (require-not (subpath "/Users")) (require-not (subpath "/Volumes")) (require-not (subpath "/Network")) (require-not (subpath "/private/var/folders")) (require-not (subpath "/private/tmp"))) ${roots.map(subpath).join(' ')})
(allow file-write* ${subpath(cwd)} ${subpath(temporary)} (subpath "/dev"))
(allow network-outbound (remote ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
(allow network-bind (local ip "localhost:*"))
(allow network-bind (local unix-socket ${subpath(temporary)}))
(allow network-outbound (remote unix-socket ${subpath(temporary)}))
(allow network-inbound (local unix-socket ${subpath(temporary)}))
`;
    const inherited = safeEnv(options.env);
    const env = { ...inherited, PATH: `${bin}:${inherited.PATH ?? '/usr/bin:/bin'}`, TMPDIR: temporary, MAC_CHROMIUM_TMPDIR: temporary, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', NPM_CONFIG_CACHE: resolve(cache, 'npm'), NPM_CONFIG_USERCONFIG: userConfig, NPM_CONFIG_GLOBALCONFIG: globalConfig, ...(options.env?.BLENDER_PATH ? { BLENDER_PATH: options.env.BLENDER_PATH } : {}) };
    try { return await runner('/usr/bin/sandbox-exec', ['-p', profile, command, ...args], { ...options, cwd, env }); }
    finally { await rm(temporary, { recursive: true, force: true }); }
  };
}
