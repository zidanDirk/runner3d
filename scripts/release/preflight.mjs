import { readFile, realpath, lstat, stat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const requireValue = (value, message) => { if (!value) throw new Error(message); };
const exact = (v, names) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const states = ['PASS', 'FAIL', 'PENDING', 'BLOCKED'];
export const BETA_CHECKS = ['ci', 'preview', 'https', 'glb', 'browserSmoke', 'ios', 'android', 'humanAudio', 'humanPlay', 'monitoring', 'privacy', 'rollback', 'knownIssues'];

/** Read-only observations, never credentials or a deployment operation. */
export function deploymentPreflight(o) {
  requireValue(exact(o, ['masterCommit', 'ci', 'environmentNames', 'secretNames', 'variables', 'productionProtection', 'uploadAuthorizationCommit']), 'Invalid deployment audit fields');
  requireValue(sha(o.masterCommit) && exact(o.ci, ['commit', 'releaseGate', 'visualComparison']) && (o.ci.commit === null || sha(o.ci.commit)) && states.includes(o.ci.releaseGate) && states.includes(o.ci.visualComparison), 'Invalid CI observation');
  requireValue([o.environmentNames, o.secretNames].every(list => Array.isArray(list) && list.length <= 100 && list.every(name => typeof name === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(name))), 'Use names only for environments/secrets');
  requireValue(exact(o.variables, ['QINIU_BUCKET', 'RELEASE_BASE_URL', 'RELEASE_APPROVAL_CONFIGURED']) && Object.values(o.variables).every(v => v === null || typeof v === 'string'), 'Only public deployment variables are accepted');
  requireValue(exact(o.productionProtection, ['requiredReviewers', 'preventSelfReview', 'branchPolicyConfigured']) && Number.isSafeInteger(o.productionProtection.requiredReviewers) && o.productionProtection.requiredReviewers >= 0 && typeof o.productionProtection.preventSelfReview === 'boolean' && typeof o.productionProtection.branchPolicyConfigured === 'boolean', 'Invalid observed protection rules');
  requireValue(o.uploadAuthorizationCommit === null || sha(o.uploadAuthorizationCommit), 'Upload authorization must name an exact reviewed commit');
  const blockers = [];
  if (o.ci.commit !== o.masterCommit || o.ci.releaseGate !== 'PASS' || o.ci.visualComparison !== 'PASS') blockers.push('Exact candidate CI release-gate and visual-comparison must both pass');
  if (!o.environmentNames.includes('preview')) blockers.push('Create/configure the preview environment');
  for (const name of ['QINIU_AK', 'QINIU_SK']) if (!o.secretNames.includes(name)) blockers.push(`Missing secret name: ${name}`);
  if (!o.variables.QINIU_BUCKET || !/^[A-Za-z0-9._-]+$/.test(o.variables.QINIU_BUCKET)) blockers.push('Configure public variable QINIU_BUCKET; a secret with that name is not this variable');
  let baseURL = null;
  try { const url = new URL(o.variables.RELEASE_BASE_URL ?? ''); requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && /^\/(?:[A-Za-z0-9_-]+\/)*$/.test(url.pathname), 'Invalid base'); baseURL = url.href; }
  catch { blockers.push('Configure trailing-slash HTTPS RELEASE_BASE_URL with no credentials/query'); }
  const productionReady = o.environmentNames.includes('production') && o.productionProtection.requiredReviewers > 0 && o.productionProtection.preventSelfReview && o.productionProtection.branchPolicyConfigured && o.variables.RELEASE_APPROVAL_CONFIGURED === 'true';
  if (o.uploadAuthorizationCommit !== o.masterCommit) blockers.push('No explicit upload authorization for this candidate commit');
  return { mode: 'read-only', candidateCommit: o.masterCommit, baseURL, uploadReady: blockers.length === 0, productionApprovalConfigured: productionReady, promotionReady: false, blockers, note: 'Secret names do not prove usable credential values; live CDN/TLS and human acceptance remain separate. No upload, promotion or environment changes were performed.' };
}

export function verifyCandidateRun(run, repository) {
  requireValue(run && run.repository?.full_name === repository && run.name === 'Reviewed Qiniu Beta candidate' && run.path === '.github/workflows/deploy-qiniu.yml' && run.event === 'workflow_dispatch' && run.status === 'completed' && run.conclusion === 'success' && sha(run.head_sha), 'Source is not a successful reviewed candidate workflow in this repository');
  return run.head_sha;
}
export function verifyCandidateCI(runs, expectedCommit) {
  requireValue(sha(expectedCommit) && Array.isArray(runs) && runs.length <= 100, 'Invalid CI search result');
  const passed = runs.find(run => run.head_sha === expectedCommit && run.path === '.github/workflows/ci.yml' && run.status === 'completed' && run.conclusion === 'success');
  requireValue(passed && typeof passed.html_url === 'string' && passed.html_url.startsWith('https://github.com/'), 'Exact reviewed commit has no successful full CI run; uploading is blocked');
  return passed.html_url;
}

/** Evaluates declared evidence. Human attestations must be supplied by actual testers, never inferred. */
export function assessBetaEvidence(input) {
  requireValue(exact(input, ['candidateCommit', 'localGate', 'checks', 'openFindings', 'technicalPreviewAuthorizationCommit']) && sha(input.candidateCommit) && states.includes(input.localGate) && exact(input.checks, BETA_CHECKS) && Array.isArray(input.openFindings), 'Invalid Beta evidence table');
  for (const [name, item] of Object.entries(input.checks)) {
    requireValue(exact(item, ['status', 'kind', 'source']) && states.includes(item.status) && ['automated', 'human', 'external', 'none'].includes(item.kind) && typeof item.source === 'string' && item.source.length <= 1000, 'Invalid check evidence');
    if (item.status === 'PASS') requireValue(item.source.trim().length > 0 && item.kind !== 'none' && (!['ios', 'android', 'humanAudio', 'humanPlay'].includes(name) || item.kind === 'human'), 'PASS requires actual evidence; browser emulation cannot attest human/device acceptance');
  }
  requireValue(input.openFindings.length <= 100 && input.openFindings.every(f => exact(f, ['id', 'severity']) && typeof f.id === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(f.id) && ['P0', 'P1', 'P2', 'P3'].includes(f.severity)), 'Invalid finding severity');
  requireValue(input.technicalPreviewAuthorizationCommit === null || sha(input.technicalPreviewAuthorizationCommit), 'Technical preview authorization must name an exact commit');
  const passed = names => names.every(name => input.checks[name].status === 'PASS');
  const engineeringReady = input.localGate === 'PASS' && passed(['ci']);
  const previewDeployed = passed(['preview', 'https', 'glb', 'browserSmoke']);
  const realDeviceAccepted = passed(['ios', 'android', 'humanAudio', 'humanPlay']);
  const critical = input.openFindings.some(f => ['P0', 'P1'].includes(f.severity));
  const allPassed = passed(BETA_CHECKS);
  const controlled = engineeringReady && previewDeployed && passed(['monitoring', 'privacy', 'rollback', 'knownIssues']) && input.technicalPreviewAuthorizationCommit === input.candidateCommit && !critical && Object.values(input.checks).every(c => ['PASS', 'PENDING'].includes(c.status));
  return { engineeringReady, previewDeployed, realDeviceAccepted, betaDecision: engineeringReady && allPassed && !critical ? 'GO' : controlled ? 'CONDITIONAL GO' : 'NO-GO', criticalOpenFindings: critical, pending: BETA_CHECKS.filter(name => input.checks[name].status !== 'PASS'), note: 'A decision over recorded evidence, not proof that unperformed tests occurred. CONDITIONAL GO permits only the specifically authorized technical preview, never automatic public launch/promotion.' };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const file = process.argv[2] ?? ''; requireValue(/^[A-Za-z0-9][A-Za-z0-9_./-]*\.json$/.test(file) && file.split('/').every(p => p && p !== '.' && p !== '..' && !p.startsWith('.')), 'Provide a project-relative public audit JSON');
    const root = await realpath(process.cwd()); let path = root;
    for (const part of file.split('/')) { path = resolve(path, part); requireValue(!(await lstat(path)).isSymbolicLink(), 'Audit symlinks are forbidden'); }
    requireValue(!relative(root, path).startsWith(`..${sep}`) && (await stat(path)).size <= 64000, 'Invalid audit path/budget');
    const report = deploymentPreflight(JSON.parse(await readFile(path, 'utf8'))); console.log(JSON.stringify(report, null, 2)); if (!report.uploadReady) process.exitCode = 1;
  } catch (error) { console.error(`[release:preflight] ${error instanceof Error ? error.message : 'Failed'}`); process.exitCode = 1; }
}
