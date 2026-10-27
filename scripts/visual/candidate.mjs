import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REVIEWED_IMAGE_VERSION, visualHostFacts } from './platform.mjs';

export const CANDIDATE_REFERENCE = 'github-macos-26';
const referenceTemplate = '{testDir}/{testFilePath}-snapshots/github-macos-26/{arg}{ext}';
const imagePattern = /^\d{8}\.\d{4}\.\d+$/;

/** Candidate comparison is evidence collection, never approval or a release gate. */
export function selectCandidateDiagnostic(mode, expectedImageVersion, formalSelector, facts) {
  if (mode !== 'candidate-only' || formalSelector !== undefined) throw new Error('Explicit candidate-only mode without a formal platform selector is required');
  if (!imagePattern.test(expectedImageVersion ?? '') || expectedImageVersion !== facts.imageVersion) throw new Error('Candidate image must match the explicitly requested image version');
  const required = { githubActions: 'true', runnerEnvironment: 'github-hosted', runnerOS: 'macOS', runnerArch: 'ARM64', platform: 'darwin', arch: 'arm64', node: 'v22.17.0' };
  for (const [name, value] of Object.entries(required)) if (facts[name] !== value) throw new Error(`Candidate requires the expected ${name}`);
  if (!/^25\./.test(facts.release ?? '') || !/^26\./.test(facts.macosVersion ?? '')) throw new Error('Candidate requires actual macOS 26 / Darwin 25');
  return { id: 'candidate-diagnostic', reference: CANDIDATE_REFERENCE, snapshotPathTemplate: referenceTemplate,
    imageVersion: expectedImageVersion, approvedReferenceImageVersion: REVIEWED_IMAGE_VERSION,
    approvalStatus: 'REVIEW_REQUIRED', eligibleForRelease: false };
}

export function assertNoSnapshotUpdates(argv) {
  if (argv.some(value => /^-u/.test(value) || /^--update-snapshots(?:=|$)/.test(value))) throw new Error('Candidate diagnostics never update snapshots');
}

export function currentCandidateDiagnostic() {
  assertNoSnapshotUpdates(process.argv);
  return selectCandidateDiagnostic(process.env.RUNNER3D_VISUAL_DIAGNOSTICS, process.env.RUNNER3D_CANDIDATE_IMAGE_VERSION, process.env.RUNNER3D_VISUAL_PLATFORM, visualHostFacts());
}

/** Public fields only, with bounded formats. No environment dump or raw errors. */
export function safeVisualHostFacts(facts) {
  const formats = {
    githubActions: /^(?:true|false)$/, runnerEnvironment: /^(?:github-hosted|self-hosted)$/,
    runnerOS: /^(?:macOS|Linux|Windows)$/, runnerArch: /^(?:ARM64|X64|X86)$/,
    imageOS: /^macos(?:\d{2}|-[a-z0-9-]{1,40})$/i, imageVersion: imagePattern,
    platform: /^(?:darwin|linux|win32)$/, arch: /^(?:arm64|x64|ia32)$/,
    release: /^\d+(?:\.\d+){1,3}(?:-[a-zA-Z0-9.-]{1,50})?$/, node: /^v\d+\.\d+\.\d+$/,
    macosVersion: /^\d+(?:\.\d+){1,3}$/,
  };
  return Object.fromEntries(Object.entries(formats).map(([key, pattern]) => [key, facts[key] == null ? null : typeof facts[key] === 'string' && facts[key].length <= 128 && pattern.test(facts[key]) ? facts[key] : '<invalid>']));
}

/** Public immutable source identifiers; absent fields stay null. */
export function visualSourceFacts(environment = process.env) {
  const sha = /^[a-f0-9]{40}$/.test(environment.GITHUB_SHA ?? '') ? environment.GITHUB_SHA : null;
  const runId = /^\d{1,20}$/.test(environment.GITHUB_RUN_ID ?? '') ? environment.GITHUB_RUN_ID : null;
  const attempt = /^\d{1,8}$/.test(environment.GITHUB_RUN_ATTEMPT ?? '') ? environment.GITHUB_RUN_ATTEMPT : null;
  const repository = environment.GITHUB_REPOSITORY === 'zidanDirk/runner3d' ? environment.GITHUB_REPOSITORY : null;
  const fileHash = path => { try { return createHash('sha256').update(readFileSync(path)).digest('hex'); } catch { return null; } };
  let playwrightVersion = null, macosBuild = null;
  try { const version = JSON.parse(readFileSync('node_modules/@playwright/test/package.json', 'utf8')).version; if (/^\d+\.\d+\.\d+$/.test(version)) playwrightVersion = version; } catch { /* Uninstalled browser tooling remains explicit. */ }
  if (process.platform === 'darwin') {
    try { const value = execFileSync('/usr/bin/sw_vers', ['-buildVersion'], { encoding: 'utf8', timeout: 5000 }).trim(); if (/^[0-9]{2}[A-Z][0-9]{1,6}[a-z]?$/.test(value)) macosBuild = value; } catch { /* Missing system facts do not become fabricated values. */ }
  }
  return { sourceSHA: sha, runId, runAttempt: attempt, runURL: repository && runId ? `https://github.com/${repository}/actions/runs/${runId}` : null,
    lockSHA256: fileHash('package-lock.json'), playwrightVersion, macosBuild };
}

export function candidateComparisonSummary(report) {
  const stats = report?.stats;
  const count = key => Number.isSafeInteger(stats?.[key]) && stats[key] >= 0 ? stats[key] : null;
  const expected = count('expected'), unexpected = count('unexpected'), flaky = count('flaky'), skipped = count('skipped');
  const total = [expected, unexpected, flaky, skipped].every(value => value !== null) ? expected + unexpected + flaky + skipped : null;
  const comparisonPassed = total === 77 && expected === 77 && unexpected === 0 && flaky === 0 && skipped === 0 && Array.isArray(report?.errors) && report.errors.length === 0;
  return { approvalStatus: 'REVIEW_REQUIRED', eligibleForRelease: false, comparisonStatus: comparisonPassed ? 'PASS' : 'FAIL_OR_INCOMPLETE', requiredTests: 77, total, expected, unexpected, flaky, skipped };
}

function save(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(value, null, 2) + '\n'); }
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const command = process.argv[2];
  if (command === 'observe') {
    save('artifacts/visual-environment/host.json', { schemaVersion: 1, scope: 'host-observation-only', approvalStatus: 'NOT_EVALUATED', runner: safeVisualHostFacts(visualHostFacts()), source: visualSourceFacts() });
  } else if (command === 'candidate') {
    const facts = visualHostFacts();
    const report = { schemaVersion: 1, scope: 'candidate-diagnostic', testedAt: new Date().toISOString(), approvalStatus: 'REVIEW_REQUIRED', eligibleForRelease: false, runner: safeVisualHostFacts(facts), source: visualSourceFacts() };
    try { save('artifacts/visual-candidate/host.json', { ...report, readiness: 'READY', comparison: currentCandidateDiagnostic() }); }
    catch { save('artifacts/visual-candidate/host.json', { ...report, readiness: 'BLOCKED', errorCode: 'CANDIDATE_ENVIRONMENT_MISMATCH' }); process.exitCode = 1; }
  } else if (command === 'summary') {
    let report;
    try { report = JSON.parse(readFileSync('artifacts/visual-candidate/comparison.json', 'utf8')); } catch { /* Missing/malformed evidence cannot pass. */ }
    const result = candidateComparisonSummary(report);
    save('artifacts/visual-candidate/summary.json', result);
    console.log(`Candidate comparison: ${result.comparisonStatus}; approval: REVIEW_REQUIRED; release eligible: false`);
    if (result.comparisonStatus !== 'PASS') process.exitCode = 1;
  } else { console.error('Expected observe, candidate, or summary'); process.exitCode = 1; }
}
