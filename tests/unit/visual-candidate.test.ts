import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertNoSnapshotUpdates, candidateComparisonSummary, safeVisualHostFacts, selectCandidateDiagnostic, visualSourceFacts } from '../../scripts/visual/candidate.mjs';
import { selectVisualPlatform } from '../../scripts/visual/platform.mjs';
import type { VisualHostFacts } from '../../scripts/visual/platform.mjs';

const image = '20261021.0445.8';
const facts: VisualHostFacts = { githubActions: 'true', runnerEnvironment: 'github-hosted', runnerOS: 'macOS', runnerArch: 'ARM64',
  platform: 'darwin', arch: 'arm64', release: '25.6.0', macosVersion: '26.6.2', node: 'v22.17.0', imageOS: 'macos-26-arm64', imageVersion: image };

describe('separate candidate evidence path', () => {
  it('permits only explicitly requested candidate facts and never approves them', () => {
    expect(selectCandidateDiagnostic('candidate-only', image, undefined, facts)).toMatchObject({ id: 'candidate-diagnostic', reference: 'github-macos-26', imageVersion: image, approvalStatus: 'REVIEW_REQUIRED', eligibleForRelease: false });
    expect(() => selectVisualPlatform('github-macos-26', facts)).toThrow('imageVersion=20261013.0424.1');
  });
  it.each([
    [undefined, image, undefined], ['candidate', image, undefined], ['candidate-only', undefined, undefined],
    ['candidate-only', '20261013.0424.1', undefined], ['candidate-only', image, 'github-macos-26'], ['candidate-only', image, ''],
  ])('rejects implicit or mismatched candidate request %s %s %s', (mode, version, formal) => {
    expect(() => selectCandidateDiagnostic(mode, version, formal, facts)).toThrow();
  });
  it.each([
    ['githubActions', 'false'], ['runnerEnvironment', 'self-hosted'], ['runnerOS', 'Linux'], ['runnerArch', 'X64'],
    ['platform', 'linux'], ['arch', 'x64'], ['release', '24.0.0'], ['macosVersion', '27.0'], ['node', 'v24.0.0'], ['imageVersion', undefined],
  ] as const)('rejects unsupported actual %s without changing formal selection', (key, value) => {
    expect(() => selectCandidateDiagnostic('candidate-only', image, undefined, { ...facts, [key]: value })).toThrow();
  });
  it.each([['--update-snapshots'], ['--update-snapshots=all'], ['--update-snapshots=none'], ['-u'], ['-u=all'], ['-uall']])('rejects snapshot update override %s', option => {
    expect(() => assertNoSnapshotUpdates([option])).toThrow('never update');
  });
  it('accepts normal diagnostics arguments', () => { expect(() => assertNoSnapshotUpdates(['node', 'playwright', '--config', 'playwright.visual-candidate.config.ts'])).not.toThrow(); });
  it('accepts actual GitHub ImageOS names without broad environment output', () => {
    expect(safeVisualHostFacts({ ...facts, imageOS: 'macos26' }).imageOS).toBe('macos26');
    expect(safeVisualHostFacts({ ...facts, imageOS: 'macos-26-arm64' }).imageOS).toBe('macos-26-arm64');
  });
  it('records SHA and run identity using bounded public fields only', () => {
    const sha = 'a'.repeat(40);
    expect(visualSourceFacts({ GITHUB_SHA: sha, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2', GITHUB_REPOSITORY: 'zidanDirk/runner3d', SECRET: 'never-output' })).toMatchObject({ sourceSHA: sha, runId: '123', runAttempt: '2', runURL: 'https://github.com/zidanDirk/runner3d/actions/runs/123', lockSHA256: expect.stringMatching(/^[a-f0-9]{64}$/), playwrightVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
    const invalid = visualSourceFacts({ GITHUB_SHA: 'never-output', GITHUB_RUN_ID: 'never-output', GITHUB_REPOSITORY: 'never-output' });
    expect(invalid).toMatchObject({ sourceSHA: null, runId: null, runURL: null }); expect(JSON.stringify(invalid)).not.toContain('never-output');
  });
  it('records only bounded public fact fields and no raw invalid values', () => {
    const secret = 'secret-not-for-report';
    const report = safeVisualHostFacts({ ...facts, imageVersion: secret, runnerOS: secret, ignoredSecret: secret } as VisualHostFacts);
    expect(report).toMatchObject({ imageVersion: '<invalid>', runnerOS: '<invalid>', platform: 'darwin' });
    expect(JSON.stringify(report)).not.toContain(secret); expect(report).not.toHaveProperty('ignoredSecret');
    expect(safeVisualHostFacts({ ...facts, imageVersion: '20261021.0445.' + '8'.repeat(200) }).imageVersion).toBe('<invalid>');
  });
});

describe('candidate completeness is separate from image approval', () => {
  const full = { stats: { expected: 77, unexpected: 0, flaky: 0, skipped: 0 }, errors: [] };
  it('records a complete green comparison without granting approval', () => {
    expect(candidateComparisonSummary(full)).toMatchObject({ comparisonStatus: 'PASS', total: 77, approvalStatus: 'REVIEW_REQUIRED', eligibleForRelease: false });
  });
  it.each([undefined, {}, { ...full, stats: { ...full.stats, expected: 76 } }, { ...full, stats: { expected: 76, unexpected: 1, flaky: 0, skipped: 0 } },
    { ...full, stats: { expected: 76, unexpected: 0, flaky: 1, skipped: 0 } }, { ...full, stats: { expected: 76, unexpected: 0, flaky: 0, skipped: 1 } },
    { ...full, stats: { ...full.stats, expected: -1 } }, { ...full, errors: [{}] }, { stats: full.stats },
  ])('cannot pass failed, skipped, flaky, malformed or incomplete evidence', report => {
    expect(candidateComparisonSummary(report)).toMatchObject({ comparisonStatus: 'FAIL_OR_INCOMPLETE', eligibleForRelease: false });
  });
});

describe('diagnostics workflow safety contract', () => {
  const workflow = readFileSync('.github/workflows/visual-candidate.yml', 'utf8');
  const config = readFileSync('playwright.visual-candidate.config.ts', 'utf8');
  it('is manual, SHA bound, read only and isolated from the formal selector', () => {
    expect(workflow).toMatch(/\non:\n  workflow_dispatch:/);
    expect(workflow).not.toMatch(/^  (?:push|pull_request|schedule|workflow_run):/m);
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).toContain('REVIEWED_SHA !== SOURCE_SHA'); expect(workflow).toContain('DIAGNOSE ${REVIEWED_SHA}');
    expect(workflow).not.toMatch(/secrets\.|deploy-qiniu|promote-qiniu|RUNNER3D_VISUAL_PLATFORM:|continue-on-error|update-snapshots/);
    expect(workflow).toContain('timeout-minutes: 60');
  });
  it('reuses the full visual command, existing thresholds and read-only references', () => {
    expect(workflow).toContain('npm run test:visual -- --config playwright.visual-candidate.config.ts');
    expect(config).toContain("updateSnapshots: 'none'"); expect(config).toContain("screenshot: 'on'");
    expect(config).not.toMatch(/maxDiff|threshold|grep|testIgnore|testMatch|timeout:/);
    expect(workflow).toContain('references-before.json'); expect(workflow).toContain('references-after.json');
    expect(workflow).toContain('if: always()'); expect(workflow).toContain('test-results/**/*.png'); expect(workflow).toContain('test-results/**/trace.zip');
  });
});
