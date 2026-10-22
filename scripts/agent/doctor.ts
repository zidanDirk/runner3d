import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { discoverCodex } from './codex';
import { GitHub } from './github';
import { check } from './types';
import type { Runner } from './types';
import { discoverBlender } from '../assets/find-blender.mjs';

export async function repositoryName(root: string, runner: Runner): Promise<string | null> {
  const result = await runner('git', ['remote', 'get-url', 'origin'], { cwd: root });
  if (result.exitCode !== 0) return null;
  return /^(?:https:\/\/github\.com\/|git@github\.com:)([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+?)(?:\.git)?\s*$/.exec(result.stdout)?.[1] ?? null;
}
export async function doctor(root: string, runner: Runner): Promise<unknown> {
  const name = await repositoryName(root, runner);
  let codex: unknown; try { codex = await discoverCodex(runner, root); } catch { codex = { available: false, reason: 'No compatible Codex; set CODEX_PATH' }; }
  let blender: unknown;
  try { const path = discoverBlender(); const result = await runner(path, ['--version'], { cwd: root, timeoutMs: 10000 }); blender = { path, version: /^Blender ([^\n]+)/m.exec(result.stdout)?.[1] ?? null, exitCode: result.exitCode, apiProbe: 'separate explicit background probe required; --version alone is not Python API verification' }; } catch { blender = { available: false, reason: 'Set BLENDER_PATH to the pinned 5.2.2 executable' }; }
  const gh = await runner('gh', ['--version'], { cwd: root, timeoutMs: 10000 });
  const git = await runner('git', ['--version'], { cwd: root, timeoutMs: 10000 });
  const github = name ? new GitHub(name, runner, root) : null;
  const pkg: unknown = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const status = await runner('git', ['status', '--porcelain=v1', '--untracked-files=no'], { cwd: root });
  const index = await github?.index();
  return { at: new Date().toISOString(), repository: name, trackedChanges: status.stdout.trim().length > 0, git: git.stdout.trim(), githubCli: gh.exitCode === 0 ? gh.stdout.split('\n')[0] : 'missing', githubPermissions: await github?.permissions() ?? null, issueIndex: index ? { available: index.available, complete: index.complete, count: index.issues.length, error: index.error ?? null } : null, remoteCI: await github?.latestCI() ?? null, codex, blender, package: pkg, limits: ['No Issue/PR mutation or publication by doctor', 'Permission response is not proof of a successful write', 'No HTTPS/device acceptance inferred'] };
}
export async function blenderProbe(root: string, runner: Runner): Promise<unknown> {
  const executable = discoverBlender();
  const result = await runner(executable, ['--background', '--factory-startup', '--python-exit-code', '1', '--python-expr', 'import bpy; print("RUNNER_AGENT_API", bpy.app.version_string, callable(bpy.ops.export_scene.gltf))'], { cwd: root, timeoutMs: 30000 });
  check(result.exitCode === 0 && result.stdout.includes('RUNNER_AGENT_API 5.2.2 LTS True'), 'Blender API/version probe failed');
  return { executable, exitCode: result.exitCode, version: '5.2.2 LTS', pythonApi: true, generation: false };
}
/** Small clean probe directory avoids reading user project instructions or running game code. */
export async function prepareProbe(root: string, runner: Runner): Promise<string> {
  const path = resolve(root, '.agent-data', 'probe'); await mkdir(path, { recursive: true });
  await writeFile(resolve(path, '.gitignore'), '*\n');
  const result = await runner('git', ['init', '--initial-branch=codex-agent-probe'], { cwd: path, timeoutMs: 15000 }); check(result.exitCode === 0, 'Probe initialization failed'); return path;
}
