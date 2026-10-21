import { constants, accessSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

export const BLENDER_INSTALL_HELP = [
  '当前未检测到 Blender。请从 https://www.blender.org/download/ 安装 Blender。',
  'macOS 示例：BLENDER_PATH="/Applications/Blender.app/Contents/MacOS/Blender" npm run assets:generate',
  '也可将 BLENDER_PATH 设为 Blender.app 路径；Windows 指向 blender.exe，Linux 指向 blender 可执行文件。',
].join('\n');

function appExecutable(candidate, platform) {
  return platform === 'darwin' && candidate.replace(/\/$/, '').endsWith('.app')
    ? join(candidate, 'Contents', 'MacOS', 'Blender')
    : candidate;
}

function usable(candidate, platform) {
  try {
    if (!statSync(candidate).isFile()) return false;
    accessSync(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function matchingDirectories(directory, match) {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && match(entry.name))
      .map((entry) => join(directory, entry.name)).sort().reverse();
  } catch {
    return [];
  }
}

function commonCandidates(platform, env) {
  const home = env.HOME || env.USERPROFILE || homedir();
  if (platform === 'darwin') {
    const appDirectories = ['/Applications', join(home, 'Applications')];
    return [
      '/Applications/Blender.app', join(home, 'Applications', 'Blender.app'),
      ...appDirectories.flatMap((directory) => matchingDirectories(directory, (name) => /^Blender.*\.app$/i.test(name))),
      '/opt/homebrew/bin/blender', '/usr/local/bin/blender',
    ];
  }
  if (platform === 'win32') {
    const roots = [env.ProgramFiles || 'C:\\Program Files', env.LOCALAPPDATA].filter(Boolean);
    return roots.flatMap((root) => {
      const foundation = join(root, 'Blender Foundation');
      return [
        join(foundation, 'Blender', 'blender.exe'),
        ...matchingDirectories(foundation, (name) => /^Blender/i.test(name)).map((directory) => join(directory, 'blender.exe')),
      ];
    });
  }
  return ['/usr/bin/blender', '/usr/local/bin/blender', '/snap/bin/blender', join(home, '.local', 'bin', 'blender')];
}

/** Explicit BLENDER_PATH always wins: a typo must never silently select another installation. */
export function discoverBlender({ env = process.env, platform = process.platform, pathCandidates, searchDirs } = {}) {
  if (Object.hasOwn(env, 'BLENDER_PATH')) {
    const specified = env.BLENDER_PATH?.trim();
    if (!specified) throw new Error(`BLENDER_PATH 已设置但为空。\n${BLENDER_INSTALL_HELP}`);
    const candidate = appExecutable(isAbsolute(specified) ? specified : resolve(specified), platform);
    if (!usable(candidate, platform)) {
      throw new Error(`BLENDER_PATH 指向的文件不存在或不可执行：${candidate}\n${BLENDER_INSTALL_HELP}`);
    }
    return candidate;
  }

  const directories = searchDirs ?? (env.PATH || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const names = platform === 'win32' ? ['blender.exe', 'Blender.exe'] : ['blender', 'Blender'];
  const candidates = [
    ...directories.flatMap((directory) => names.map((name) => join(directory, name))),
    ...(pathCandidates ?? commonCandidates(platform, env)),
  ];
  for (const raw of new Set(candidates)) {
    const candidate = appExecutable(resolve(raw), platform);
    if (usable(candidate, platform)) return candidate;
  }
  throw new Error(BLENDER_INSTALL_HELP);
}
