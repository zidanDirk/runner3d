import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { candidateInputs, verifyResumeSource, verifyResumeArtifact } from '../../scripts/release/candidate.mjs';
import { verifyCandidateRun } from '../../scripts/release/preflight.mjs';
import { verifyRelease } from '../../scripts/release/verify.mjs';
import { fixture } from './release-fixture';
const sha = 'a'.repeat(40), id = 'original-build', digest = 'b'.repeat(64);
const inputs = { environment: 'preview', sourceRun: '321', buildId: id, manifestSha256: digest, confirmation: `RESUME ${id} ${digest}` };
const run = { id: 321, repository: { full_name: 'owner/repo' }, path: '.github/workflows/deploy-qiniu.yml', name: 'Reviewed Qiniu Beta candidate', event: 'workflow_dispatch', status: 'completed', conclusion: 'failure', head_sha: sha };

describe('explicit candidate recovery authorization and source identity', () => {
  it('separates new upload approval from exact-artifact resume approval', () => {
    expect(candidateInputs(inputs)).toBe('resume');
    expect(candidateInputs({ environment: 'preview', confirmation: 'UPLOAD REVIEWED CANDIDATE' })).toBe('new');
  });
  it('blocks new and resumed production candidate authorization until real Preview verification', () => {
    expect(() => candidateInputs({ environment: 'production', confirmation: 'UPLOAD REVIEWED CANDIDATE' })).toThrow('production uploads remain blocked');
    expect(() => candidateInputs({ ...inputs, environment: 'production' })).toThrow('production uploads remain blocked');
  });
  it.each([
    { environment: 'staging' }, { sourceRun: '' }, { sourceRun: '321;cmd' }, { sourceRun: '99999999999999999' },
    { buildId: '../entry' }, { manifestSha256: 'wrong' }, { confirmation: 'UPLOAD REVIEWED CANDIDATE' }, { confirmation: `RESUME other ${digest}` },
  ])('rejects incomplete/ambiguous/injected resume input %j', bad => expect(() => candidateInputs({ ...inputs, ...bad })).toThrow());
  it('accepts the failed upload as recovery evidence, while original promotion still refuses it', () => {
    expect(() => verifyResumeSource(run, 'owner/repo', sha, '321')).not.toThrow();
    expect(() => verifyCandidateRun(run, 'owner/repo')).toThrow('successful reviewed candidate');
    // A new completed recovery workflow (same exact SHA) can later become the
    // promotion source. This is a synthetic fixture, not an actual Actions run.
    expect(verifyCandidateRun({ ...run, id: 322, conclusion: 'success' }, 'owner/repo')).toBe(sha);
  });
  it.each([
    { id: 999 }, { repository: { full_name: 'attacker/repo' } }, { path: '.github/workflows/other.yml' },
    { name: 'other' }, { event: 'push' }, { status: 'in_progress' }, { head_sha: 'b'.repeat(40) }, { conclusion: 'unknown' },
  ])('rejects wrong repository/workflow/event/SHA/source state %j', bad => expect(() => verifyResumeSource({ ...run, ...bad }, 'owner/repo', sha, '321')).toThrow());
});

it('restores exact original bytes and gate without changing BuildID; refuses wrong SHA/env/hash or a failed gate', async () => fixture(async (root, files) => {
  const release = { version: '0.14.0-beta', buildId: id, commit: sha, buildTime: '2026-10-25T01:02:03.000Z', environment: 'production' };
  const body = JSON.stringify(release); await writeFile(join(root, 'release.json'), body);
  files['release.json'] = { bytes: Buffer.byteLength(body), sha256: createHash('sha256').update(body).digest('hex') };
  await writeFile(join(root, 'release-manifest.json'), JSON.stringify({ schemaVersion: 1, release, files }));
  const artifact = await verifyRelease(root), gateRoot = await mkdtemp(join(tmpdir(), 'runner3d-resume-gate-')), gatePath = join(gateRoot, 'report.json');
  try {
    await writeFile(gatePath, JSON.stringify({ status: 'passed', artifact }));
    const options = { directory: root, gatePath, environment: 'production', expectedCommit: sha, buildId: id, manifestSha256: artifact.manifestSha256 };
    const original = await readFile(join(root, 'release-manifest.json'));
    expect(await verifyResumeArtifact(options)).toEqual(artifact);
    for (const bad of [{ expectedCommit: 'b'.repeat(40) }, { buildId: 'other' }, { manifestSha256: digest }, { environment: 'preview' }]) await expect(verifyResumeArtifact({ ...options, ...bad })).rejects.toThrow('identity mismatch');
    await writeFile(gatePath, JSON.stringify({ status: 'failed', artifact }));
    await expect(verifyResumeArtifact(options)).rejects.toThrow('identity mismatch');
    expect(await readFile(join(root, 'release-manifest.json'))).toEqual(original);
  } finally { await rm(gateRoot, { recursive: true, force: true }); }
}, 'production'));

it('archives the restored artifact in the new run and gates both new and resume on unchanged remote/browser smoke', async () => {
  const workflow = await readFile('.github/workflows/deploy-qiniu.yml', 'utf8');
  expect(workflow).toContain('verifyResumeSource'); expect(workflow).toContain('verifyResumeArtifact');
  expect(workflow).toContain('run-id: ${{ inputs.resume_source_run_id }}');
  expect(workflow).toMatch(/run: npm run release:check\s+if: inputs\.resume_source_run_id == ''/);
  expect(workflow).toContain('name: reviewed-release'); expect(workflow).toContain('upload-artifact@v4');
  expect(workflow).toContain('qiniu.mjs upload --execute --resume');
  expect(workflow).toContain('node scripts/release/remote-smoke.mjs'); expect(workflow).toContain('npm run test:release');
});
