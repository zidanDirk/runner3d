import { execFileSync } from 'node:child_process';
import { release } from 'node:os';
import { getVisualContract, validateContractHostFacts, validateContractReferences } from './contracts.mjs';

export const REVIEWED_IMAGE_VERSION = '20261013.0424.1';
export const REVIEWED_BROWSER_VERSION = '156.0.8078.4';
const originalTemplate = '{testDir}/{testFilePath}-snapshots/{arg}{ext}';

/** Explicit, fail-closed selection. Facts are injected only by unit tests. */
export function selectVisualPlatform(requested, facts) {
  if (requested === undefined) return { id: 'local-original', snapshotPathTemplate: originalTemplate };
  const contract = getVisualContract(requested);
  if (contract.approvalStatus !== 'APPROVED') throw new Error(`${contract.id} requires human approval`);
  validateContractHostFacts(contract, facts);
  return { id: requested, contractId: contract.id, referenceSetSha256: contract.reference.referenceSetSha256,
    snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/github-macos-26/{arg}{ext}' };
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
  const platform = selectVisualPlatform(requested, requested === undefined ? {} : visualHostFacts());
  if (requested !== undefined) validateContractReferences();
  return platform;
}
