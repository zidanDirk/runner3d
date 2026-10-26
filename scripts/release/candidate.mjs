import { readFile } from 'node:fs/promises';
import { verifyRelease } from './verify.mjs';

export function candidateInputs({ environment, confirmation, sourceRun = '', buildId = '', manifestSha256 = '' }) {
  if (environment !== 'preview') throw new Error('Only preview candidates are enabled; production uploads remain blocked pending real Preview deployment verification and separate review');
  if (!sourceRun) {
    if (buildId || manifestSha256 || confirmation !== 'UPLOAD REVIEWED CANDIDATE') throw new Error('New upload requires empty resume fields and explicit upload confirmation');
    return 'new';
  }
  if (!/^[1-9]\d{0,15}$/.test(sourceRun) || !Number.isSafeInteger(Number(sourceRun)) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(buildId) || !/^[a-f0-9]{64}$/.test(manifestSha256) || confirmation !== `RESUME ${buildId} ${manifestSha256}`) throw new Error('Resume requires exact source run, BuildID, original manifest SHA256 and RESUME confirmation');
  return 'resume';
}

/** A failed upload run may supply its original passed gate, never promotion. */
export function verifyResumeSource(run, repository, expectedCommit, sourceRun) {
  if (!/^[a-f0-9]{40}$/.test(expectedCommit) || run?.id !== Number(sourceRun) || run.repository?.full_name !== repository || run.path !== '.github/workflows/deploy-qiniu.yml' || run.name !== 'Reviewed Qiniu Beta candidate' || run.event !== 'workflow_dispatch' || run.status !== 'completed' || !['success', 'failure', 'cancelled', 'timed_out'].includes(run.conclusion) || run.head_sha !== expectedCommit) throw new Error('Resume source must be a completed candidate run in this repository at the SAME source SHA');
}

export async function verifyResumeArtifact({ directory = 'dist', gatePath = 'artifacts/beta-release/gate/report.json', environment, expectedCommit, buildId, manifestSha256 }) {
  const artifact = await verifyRelease(directory);
  const gate = JSON.parse(await readFile(gatePath, 'utf8'));
  if (artifact.release.commit !== expectedCommit || artifact.release.buildId !== buildId || artifact.release.environment !== environment || artifact.manifestSha256 !== manifestSha256 || gate.status !== 'passed' || gate.artifact?.manifestSha256 !== manifestSha256 || JSON.stringify(gate.artifact.release) !== JSON.stringify(artifact.release)) throw new Error('Restored artifact/gate identity mismatch; do not rebuild or change the original BuildID');
  return artifact;
}
