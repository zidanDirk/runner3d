import { expect, it } from 'vitest';
import { BETA_CHECKS, assessBetaEvidence, deploymentPreflight, verifyCandidateCI, verifyCandidateRun } from '../../scripts/release/preflight.mjs';

const commit = 'a'.repeat(40);
function audit() {
  return { masterCommit: commit, ci: { commit, releaseGate: 'PASS', visualComparison: 'PASS' }, environmentNames: ['preview', 'production'], secretNames: ['QINIU_AK', 'QINIU_SK'], variables: { QINIU_BUCKET: 'test-bucket', RELEASE_BASE_URL: 'https://example.invalid/runner/', RELEASE_APPROVAL_CONFIGURED: 'true' }, productionProtection: { requiredReviewers: 1, preventSelfReview: true, branchPolicyConfigured: true }, uploadAuthorizationCommit: commit };
}
function evidence() {
  // Deliberate synthetic decision-table fixture, not actual device/participant evidence.
  const checks: Record<string, { status: string; kind: string; source: string }> = Object.fromEntries(BETA_CHECKS.map(name => [name, { status: 'PASS', kind: ['ios', 'android', 'humanAudio', 'humanPlay'].includes(name) ? 'human' : 'automated', source: 'synthetic fixture only' }]));
  return { candidateCommit: commit, localGate: 'PASS', checks, openFindings: [] as { id: string; severity: string }[], technicalPreviewAuthorizationCommit: null as string | null };
}

it('reports read-only upload readiness only for the exact CI-tested and authorized candidate', () => {
  expect(deploymentPreflight(audit())).toMatchObject({ mode: 'read-only', uploadReady: true, productionApprovalConfigured: true, promotionReady: false });
  for (const observation of [
    { ...audit(), uploadAuthorizationCommit: null }, { ...audit(), uploadAuthorizationCommit: 'b'.repeat(40) },
    { ...audit(), ci: { ...audit().ci, commit: 'b'.repeat(40) } }, { ...audit(), ci: { ...audit().ci, visualComparison: 'FAIL' } },
    { ...audit(), environmentNames: [] }, { ...audit(), secretNames: [] },
    { ...audit(), variables: { ...audit().variables, QINIU_BUCKET: null } },
    { ...audit(), variables: { ...audit().variables, RELEASE_BASE_URL: 'http://example.invalid/' } },
  ]) expect(deploymentPreflight(observation).uploadReady).toBe(false);
});

it('does not confuse an old Bucket secret with a public Bucket variable or declare production approval by flag alone', () => {
  expect(deploymentPreflight({ ...audit(), secretNames: ['QINIU_AK', 'QINIU_SK', 'QINIU_BUCKET'], variables: { ...audit().variables, QINIU_BUCKET: null } }).blockers.join(' ')).toContain('not this variable');
  for (const productionProtection of [{ requiredReviewers: 0, preventSelfReview: true, branchPolicyConfigured: true }, { requiredReviewers: 1, preventSelfReview: false, branchPolicyConfigured: true }, { requiredReviewers: 1, preventSelfReview: true, branchPolicyConfigured: false }]) expect(deploymentPreflight({ ...audit(), productionProtection }).productionApprovalConfigured).toBe(false);
  expect(() => deploymentPreflight({ ...audit(), QINIU_AK: 'must not be read' })).toThrow('fields');
});

it('binds promotion source to the actual repository, workflow path/event/result and commit', () => {
  const run = { repository: { full_name: 'owner/repo' }, name: 'Reviewed Qiniu Beta candidate', path: '.github/workflows/deploy-qiniu.yml', event: 'workflow_dispatch', status: 'completed', conclusion: 'success', head_sha: commit };
  expect(verifyCandidateRun(run, 'owner/repo')).toBe(commit);
  for (const changed of [{ path: '.github/workflows/other.yml' }, { event: 'push' }, { conclusion: 'failure' }, { status: 'in_progress' }, { head_sha: 'unknown' }, { repository: { full_name: 'other/repo' } }]) expect(() => verifyCandidateRun({ ...run, ...changed }, 'owner/repo')).toThrow('Source');
});
it('requires actual completed full-CI success at the exact candidate SHA', () => {
  const run = { head_sha: commit, path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', html_url: 'https://github.com/owner/repo/actions/runs/1' };
  expect(verifyCandidateCI([run], commit)).toBe(run.html_url);
  for (const changed of [{ head_sha: 'b'.repeat(40) }, { conclusion: 'failure' }, { status: 'in_progress' }, { path: '.github/workflows/other.yml' }]) expect(() => verifyCandidateCI([{ ...run, ...changed }], commit)).toThrow('blocked');
  expect(() => verifyCandidateCI([], commit)).toThrow('blocked');
});

it('keeps engineering, actual deployment, real-device acceptance and Beta decision independent', () => {
  const fixture = evidence(); expect(assessBetaEvidence(fixture)).toMatchObject({ engineeringReady: true, previewDeployed: true, realDeviceAccepted: true, betaDecision: 'GO' });
  for (const name of ['preview', 'https', 'glb', 'browserSmoke']) {
    const x = evidence(); x.checks[name] = { status: 'BLOCKED', kind: 'none', source: '' };
    expect(assessBetaEvidence(x)).toMatchObject({ engineeringReady: true, previewDeployed: false, betaDecision: 'NO-GO' });
  }
  const x = evidence(); x.checks.ci = { status: 'FAIL', kind: 'automated', source: 'synthetic failed CI' };
  expect(assessBetaEvidence(x)).toMatchObject({ engineeringReady: false, betaDecision: 'NO-GO' });
});

it('cannot use simulated phones or an absent tester as human acceptance', () => {
  for (const name of ['ios', 'android', 'humanAudio', 'humanPlay']) {
    const x = evidence(); x.checks[name] = { status: 'PASS', kind: 'automated', source: 'synthetic Chromium emulation' };
    expect(() => assessBetaEvidence(x)).toThrow('human/device');
    x.checks[name] = { status: 'PENDING', kind: 'none', source: '' };
    expect(assessBetaEvidence(x)).toMatchObject({ engineeringReady: true, realDeviceAccepted: false, betaDecision: 'NO-GO' });
  }
});

it('allows only explicitly authorized limited technical previews with pending human checks', () => {
  const x = evidence(); x.checks.ios = { status: 'PENDING', kind: 'none', source: '' };
  expect(assessBetaEvidence(x).betaDecision).toBe('NO-GO'); x.technicalPreviewAuthorizationCommit = commit;
  expect(assessBetaEvidence(x)).toMatchObject({ betaDecision: 'CONDITIONAL GO', realDeviceAccepted: false });
  x.checks.https = { status: 'PENDING', kind: 'none', source: '' }; expect(assessBetaEvidence(x).betaDecision).toBe('NO-GO');
});

it.each(['P0', 'P1'])('blocks public/limited expansion for an open %s issue', severity => {
  const x = evidence(); x.openFindings = [{ id: 'actual-review-required', severity }];
  expect(assessBetaEvidence(x)).toMatchObject({ betaDecision: 'NO-GO', criticalOpenFindings: true });
});

it('rejects unknown or evidence-free pass declarations and incomplete tables', () => {
  expect(() => assessBetaEvidence({ ...evidence(), unexpected: true })).toThrow('table');
  const x = evidence(); x.checks.https = { status: 'PASS', kind: 'external', source: '' }; expect(() => assessBetaEvidence(x)).toThrow('evidence');
  delete x.checks.https; expect(() => assessBetaEvidence(x)).toThrow('table');
});
