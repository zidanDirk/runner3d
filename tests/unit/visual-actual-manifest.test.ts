import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { SOURCE_PINS } from '../../scripts/visual/actual-instrumentation.cjs';
import { COMPARISON_POLICIES, collectorSourceHashes, compareTestReports, validateApprovedProof, validateAssertionRecord } from '../../scripts/visual/actual-evidence.mjs';
import { REFERENCE_SET_SHA256 } from '../../scripts/visual/contracts.mjs';
import { APPROVED_PROPOSAL_SHA256 } from '../../scripts/visual/validate.mjs';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const root = mkdtempSync(join(tmpdir(), 'runner3d-actual-manifest-'));
const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3kQAAAAASUVORK5CYII=', 'base64');
const ref = { path: 'tests/e2e/fixture.spec.ts-snapshots/fixture.png', sha256: hash(bytes), comparisonOptions: { comparator: 'pixelmatch', threshold: .2, maxDiffPixels: 0, maxDiffPixelRatio: null } };
const folder = 'artifacts/visual-actual/suite-instrumented/raw/' + 'a'.repeat(32) + '-r0-x0';
for (const path of [ref.path, `${folder}/actual.png`, `${folder}/expected.png`, `${folder}/diff.png`]) {
  mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes);
}
afterAll(() => rmSync(root, { recursive: true, force: true }));
function record() {
  return { schemaVersion: 1, eligibleForRelease: false, captureStatus: 'VERIFIED', referencePath: ref.path, referenceSha256: ref.sha256,
    assertionId: 'a'.repeat(32), assertionOrdinal: 1, retry: 0, repeatEachIndex: 0, testFile: 'tests/e2e/fixture.spec.ts', matcher: 'toHaveScreenshot',
    actualPath: `${folder}/actual.png`, expectedPath: `${folder}/expected.png`, diffPath: `${folder}/diff.png`, actualSha256: ref.sha256,
    actualDimensions: { width: 1, height: 1 }, expectedDimensions: { width: 1, height: 1 },
    options: { capture: { scale: 'css', animations: 'disabled' }, comparison: { comparator: 'pixelmatch', threshold: .2, maxDiffPixels: 0, maxDiffPixelRatio: null } },
    comparison: { status: 'PASS', sizeMismatch: false, timedOut: false, differentPixels: 0, allowedDiffPixels: 0 },
    proof: { method: 'native-matcher-buffer-v1', nativeAssertionId: 'a'.repeat(32), bufferRoute: 'server-comparator-rpc-archive',
      nativeComparedActualSha256: ref.sha256, returnedActualSha256: ref.sha256, archivedActualSha256: ref.sha256,
      byteEquality: true, nativeReturnedBytesEqual: true, metricExpectedBytesEqual: true, nativeMetricsMatched: true, sourcePins: SOURCE_PINS, collectorSha256: collectorSourceHashes() } };
}
describe('exact native Buffer manifest integrity', () => {
  it('validates a structurally complete synthetic record separately from real browser proof', () => {
    expect(validateAssertionRecord(record(), ref, { root })).toMatchObject({ actualSha256: ref.sha256, eligibleForRelease: false });
  });
  it.each(['method', 'nativeAssertionId', 'bufferRoute', 'nativeComparedActualSha256', 'returnedActualSha256', 'archivedActualSha256'] as const)('rejects changed proof field %s', key => {
    const value = record(); value.proof[key] = 'changed'; expect(() => validateAssertionRecord(value, ref, { root })).toThrow();
  });
  it.each(['byteEquality', 'nativeReturnedBytesEqual', 'metricExpectedBytesEqual', 'nativeMetricsMatched'] as const)('rejects missing byte proof %s', key => {
    const value = record(); value.proof[key] = false; expect(() => validateAssertionRecord(value, ref, { root })).toThrow();
  });
  it('rejects collector drift and a wrong direct-Buffer route', () => {
    const value = record(); value.proof.collectorSha256.instrumentation = '0'.repeat(64);
    expect(() => validateAssertionRecord(value, ref, { root })).toThrow('collector');
    const direct = record(); direct.matcher = 'toMatchSnapshot'; expect(() => validateAssertionRecord(direct, ref, { root })).toThrow('route');
  });
  it('rejects altered actual bytes and retry metadata', () => {
    const path = join(root, `${folder}/actual.png`);
    try { writeFileSync(path, Buffer.concat([bytes, Buffer.from([0])])); expect(() => validateAssertionRecord(record(), ref, { root })).toThrow('hashes differ'); }
    finally { writeFileSync(path, bytes); }
    const value = record(); value.retry = 1; expect(() => validateAssertionRecord(value, ref, { root })).toThrow('Retries');
  });
  it('rejects changing comparison limits or claiming a pass beyond native tolerance', () => {
    const value = record(); value.comparison.allowedDiffPixels = 5; expect(() => validateAssertionRecord(value, ref, { root })).toThrow('allowed');
    const beyond = record(); beyond.comparison.differentPixels = 1; expect(() => validateAssertionRecord(beyond, ref, { root })).toThrow('metrics');
  });
  it('keeps the original per-file thresholds distinct and rejects a changed threshold', () => {
    expect(COMPARISON_POLICIES['tests/e2e/city-visual.spec.ts']).toMatchObject({ threshold: .22, maxDiffPixelRatio: .01 });
    expect(COMPARISON_POLICIES['tests/e2e/feel-visual.spec.ts']).toMatchObject({ threshold: .2, maxDiffPixelRatio: .003 });
    const value = record(); value.options.comparison.threshold = .22; expect(() => validateAssertionRecord(value, ref, { root })).toThrow('options');
  });
  it('retains a failed native comparison actual instead of substituting an adjacent screenshot', () => {
    const value = record(); value.comparison.status = 'FAIL'; value.comparison.differentPixels = 1;
    expect(validateAssertionRecord(value, ref, { root })).toMatchObject({ comparison: { status: 'FAIL' }, actualSha256: ref.sha256, eligibleForRelease: false });
  });
});

function report(status = 'expected') { return { errors: [], suites: [{ specs: [{ file: 'fixture.spec.ts', title: 'fixture', ok: true, tests: [{ status, projectName: 'chromium', results: [{ status: 'passed', retry: 0 }] }] }] }] }; }
describe('native report equivalence', () => {
  it('requires identical successful test identities', () => { expect(compareTestReports(report(), report())).toMatchObject({ status: 'PASS', tests: 1, eligibleForRelease: false }); });
  it.each(['skipped', 'unexpected', 'flaky'])('rejects status %s', status => { expect(() => compareTestReports(report(), report(status))).toThrow(); });
  it('rejects different tests and global errors', () => {
    const changed = report(); changed.suites[0]!.specs[0]!.title = 'different'; expect(() => compareTestReports(report(), changed)).toThrow('differ');
    expect(() => compareTestReports(report(), { errors: ['failure'], suites: [] })).toThrow();
  });
});

const sourceSHA = 'a'.repeat(40), runId = '123456', attempt = '1';
function proof() {
  return { schemaVersion: 1, phase: 'approved-equivalence', status: 'PASS', eligibleForRelease: false, sourceSHA, runId, attempt,
    imageVersion: '20261013.0424.1', tests: 77, primaryAssertions: 91, totalAssertions: 151,
    fixtureEquivalence: { status: 'PASS' }, suiteEquivalence: { status: 'PASS', tests: 77 }, sourcePins: SOURCE_PINS,
    collectorSha256: collectorSourceHashes(), referenceProposalSha256: APPROVED_PROPOSAL_SHA256, referenceSetSha256: REFERENCE_SET_SHA256,
    context: { selection: { phase: 'approved-equivalence', expectedImage: '20261013.0424.1' }, source: { sourceSHA, runId, runAttempt: attempt },
      runner: { githubActions: 'true', runnerEnvironment: 'github-hosted', runnerOS: 'macOS', runnerArch: 'ARM64', platform: 'darwin', arch: 'arm64',
        release: '25.6.0', macosVersion: '26.6.2', node: 'v22.17.0', imageVersion: '20261013.0424.1' },
      host: { browser: '156.0.8078.4' }, actualFonts: [{ postScriptName: 'PingFangSC-Semibold', isCustomFont: false, glyphCount: 10 }],
      renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple Paravirtual device, Unspecified Version)' } };
}
function validate(value: ReturnType<typeof proof>) { const raw = Buffer.from(JSON.stringify(value)); return validateApprovedProof(value, { sourceSHA, runId, attempt, proofSha256: hash(raw) }, raw); }
describe('approved-image prerequisite never accepts local or unrelated evidence', () => {
  it('checks synthetic same-run metadata without performing a real GitHub validation', () => { expect(validate(proof())).toBe(true); });
  it.each(['sourceSHA', 'runId', 'attempt', 'phase', 'imageVersion', 'referenceSetSha256'] as const)('rejects changed %s', key => {
    const value = proof(); value[key] = 'different'; expect(() => validate(value)).toThrow();
  });
  it('rejects incomplete equivalence, bad bytes and wrong actual source', () => {
    const value = proof(); value.primaryAssertions = 90; expect(() => validate(value)).toThrow('coverage');
    const source = proof(); source.context.source.sourceSHA = 'b'.repeat(40); expect(() => validate(source)).toThrow('source');
    expect(() => validateApprovedProof(proof(), { sourceSHA, runId, attempt, proofSha256: '0'.repeat(64) }, Buffer.from('{}'))).toThrow('hash');
  });
});
