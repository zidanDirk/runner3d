import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/visual-actual-evidence.yml', 'utf8');
const approved = workflow.slice(workflow.indexOf('  approved_equivalence:'), workflow.indexOf('  candidate_collect:'));
const candidate = workflow.slice(workflow.indexOf('  candidate_collect:'));
const sha = 'a'.repeat(40);
const validator = workflow.match(/node --input-type=module <<'JS'\n([\s\S]*?)\n          JS/)?.[1]?.replace(/^          /gm, '');
if (!validator) throw new Error('Manual source validator is missing from the actual-evidence workflow');

function validateManual(overrides: Record<string, string | undefined> = {}) {
  const environment: Record<string, string | undefined> = { EVENT_NAME: 'workflow_dispatch', SENDER_TYPE: 'User', SOURCE_SHA: sha, REVIEWED_SHA: sha, CONFIRMATION: `CAPTURE ${sha}`, ...overrides };
  // Execute the real workflow validation block with only synthetic public fields.
  // No shell, inherited credentials or GitHub requests are involved.
  return spawnSync(process.execPath, ['--input-type=module', '-'], { input: validator, env: environment, encoding: 'utf8', timeout: 5000 });
}

describe('manual reviewed-source authorization', () => {
  it('accepts an exact manually confirmed source SHA', () => {
    const result = validateManual();
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0);
    expect(result.stdout).toBe(''); expect(result.stderr).toBe('');
  });
  it.each([
    { EVENT_NAME: 'push' }, { EVENT_NAME: 'pull_request' }, { EVENT_NAME: 'workflow_run' },
    { SENDER_TYPE: 'Bot' }, { SENDER_TYPE: undefined },
    { REVIEWED_SHA: 'b'.repeat(40) }, { REVIEWED_SHA: 'a'.repeat(39) }, { REVIEWED_SHA: sha.toUpperCase() },
    { REVIEWED_SHA: undefined }, { SOURCE_SHA: undefined },
    { CONFIRMATION: `CAPTURE ${'b'.repeat(40)}` }, { CONFIRMATION: undefined },
  ])('rejects a nonhuman, nonmanual or unbound request %j', overrides => {
    const result = validateManual(overrides);
    expect(result.error).toBeUndefined(); expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Manual review, exact source SHA, and CAPTURE confirmation are required');
  });
  it('treats hostile inputs as data and does not reflect their contents in errors', () => {
    const hostile = 'PRIVATE_MARKER_$(touch injected-file);`echo secret`';
    const result = validateManual({ REVIEWED_SHA: hostile, CONFIRMATION: hostile });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).not.toContain(hostile);
    expect(result.stdout + result.stderr).not.toContain('PRIVATE_MARKER_');
  });
});

describe('exact actual evidence workflow isolation', () => {
  it('is dispatch-only, read-only and provides no deployment secrets or automatic trigger', () => {
    expect(workflow).toMatch(/\non:\n  workflow_dispatch:/);
    expect(workflow).not.toMatch(/^  (?:push|pull_request|schedule|workflow_run|workflow_call|repository_dispatch):/m);
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow).not.toMatch(/secrets\.|github-token:|actions:\s*(?:read|write)|environment:|deploy-qiniu|promote-qiniu|continue-on-error/);
    expect(workflow).not.toMatch(/RUNNER3D_VISUAL_PLATFORM:|--update-snapshots|test:visual:update|git push|gh workflow run|gh pr /);
    expect((workflow.match(/persist-credentials: false/g) ?? []).length).toBe(2);
    expect((workflow.match(/ref: \$\{\{ github\.sha \}\}/g) ?? []).length).toBe(2);
  });
  it('cannot request a different phase, image or external proof as a manual input', () => {
    const inputs = workflow.slice(workflow.indexOf('    inputs:'), workflow.indexOf('\npermissions:'));
    expect(inputs.match(/^      [a-z_]+:/gm)).toEqual(['      reviewed_sha:', '      confirm_capture:']);
    expect(approved).toContain('RUNNER3D_ACTUAL_PHASE: approved-equivalence');
    expect(approved).toContain("RUNNER3D_ACTUAL_EXPECTED_IMAGE: '20261013.0424.1'");
    expect(candidate).toContain('RUNNER3D_ACTUAL_PHASE: candidate-collect');
    expect(candidate).toContain("RUNNER3D_ACTUAL_EXPECTED_IMAGE: '20261021.0445.8'");
    expect((workflow.match(/node-version: '22\.17\.0'/g) ?? []).length).toBe(2);
  });
  it('requires approved-image job success and authentic same-run proof before candidate capture', () => {
    expect(candidate).toContain('needs: approved_equivalence');
    expect(candidate).toContain("if: needs.approved_equivalence.result == 'success'");
    expect(approved).toContain('proof_sha256: ${{ steps.collect.outputs.proof_sha256 }}');
    expect(candidate).toContain('RUNNER3D_ACTUAL_PROOF_SHA256: ${{ needs.approved_equivalence.outputs.proof_sha256 }}');
    expect(candidate).toContain('uses: actions/download-artifact@v4');
    expect(candidate).toContain('name: actual-approved-${{ github.run_id }}-${{ github.run_attempt }}');
    expect(candidate).toContain('path: artifacts/visual-actual/prerequisite/');
    expect(candidate).not.toMatch(/run-id:|repository:|github-token:/);
    expect(candidate.indexOf('uses: actions/download-artifact@v4')).toBeLessThan(candidate.indexOf('run: node scripts/visual/actual-evidence.mjs run'));
  });
  it('publishes an approved proof only after successful validation and preserves failures separately', () => {
    const proof = approved.slice(approved.indexOf('      - name: Publish proof'), approved.indexOf('      - name: Preserve approved-image evidence'));
    expect(proof).toContain('if: success()'); expect(proof).toContain('path: artifacts/visual-actual/proof.json');
    expect(proof).toContain('if-no-files-found: error');
    expect(approved.indexOf('run: node scripts/visual/actual-evidence.mjs validate')).toBeLessThan(approved.indexOf('      - name: Publish proof'));
    for (const job of [approved, candidate]) {
      expect(job).toContain("if: always() && steps.checkout.outcome == 'success'");
      expect(job).toContain('references-workflow-before.json'); expect(job).toContain('references-workflow-after.json');
      expect(job).toContain('artifacts/visual-actual/'); expect(job).toContain('test-results/**/visual-provenance.json');
      expect(job).toContain('test-results/**/error-context.md'); expect(job).toContain('test-results/**/*.png');
      expect(job).toContain('test-results/**/trace.zip'); expect(job).toContain('if: always()');
      expect(job).toContain('retention-days: 14');
    }
  });
  it('bounds both jobs and checks the real host before browser setup', () => {
    expect(approved).toContain('timeout-minutes: 90'); expect(approved).toContain('timeout-minutes: 80');
    expect(candidate).toContain('timeout-minutes: 60'); expect(candidate).toContain('timeout-minutes: 38');
    for (const job of [approved, candidate]) {
      expect(job.indexOf('run: node scripts/visual/actual-evidence.mjs observe')).toBeLessThan(job.indexOf('- run: npm ci'));
      expect(job.indexOf('run: node scripts/visual/actual-evidence.mjs observe')).toBeLessThan(job.indexOf('swift scripts/release/ensure-ci-font.swift'));
    }
  });
});
