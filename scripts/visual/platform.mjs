import { execFileSync } from 'node:child_process';
import { release } from 'node:os';

export const REVIEWED_IMAGE_VERSION = '20261013.0424.1';
export const REVIEWED_BROWSER_VERSION = '156.0.8078.4';
const originalTemplate = '{testDir}/{testFilePath}-snapshots/{arg}{ext}';

/** Explicit, fail-closed selection. Facts are injected only by unit tests. */
export function selectVisualPlatform(requested, facts) {
  if (requested === undefined) return { id: 'local-original', snapshotPathTemplate: originalTemplate };
  if (requested !== 'github-macos-26') throw new Error(`Unknown visual platform: ${requested}`);
  const required = {
    githubActions: 'true', runnerEnvironment: 'github-hosted', runnerOS: 'macOS', runnerArch: 'ARM64',
    platform: 'darwin', arch: 'arm64', node: 'v22.17.0', imageVersion: REVIEWED_IMAGE_VERSION,
  };
  for (const [name, expected] of Object.entries(required)) {
    if (facts[name] !== expected) throw new Error(`github-macos-26 requires ${name}=${expected}; received ${facts[name] ?? 'missing'}`);
  }
  if (!/^25\./.test(facts.release ?? '') || !/^26\./.test(facts.macosVersion ?? '')) throw new Error('github-macos-26 requires actual macOS 26 / Darwin 25');
  return { id: requested, snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/github-macos-26/{arg}{ext}' };
}

/** Reads an allowlist of public provenance fields, never the whole environment. */
export function visualHostFacts() {
  return {
    githubActions: process.env.GITHUB_ACTIONS, runnerEnvironment: process.env.RUNNER_ENVIRONMENT,
    runnerOS: process.env.RUNNER_OS, runnerArch: process.env.RUNNER_ARCH,
    imageOS: process.env.ImageOS, imageVersion: process.env.ImageVersion,
    platform: process.platform, arch: process.arch, release: release(), node: process.version,
    macosVersion: process.platform === 'darwin' ? execFileSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8', timeout: 5000 }).trim() : null,
  };
}

export function currentVisualPlatform() {
  const requested = process.env.RUNNER3D_VISUAL_PLATFORM;
  return selectVisualPlatform(requested, requested === undefined ? {} : visualHostFacts());
}
