import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertVisualRuntimeContract, getVisualContract, LEGACY_VISUAL_CONTRACT_ID,
  PROPOSED_VISUAL_CONTRACT_ID, REFERENCE_SET_SHA256, validateContractHostFacts,
  validateContractReferences, validateContractRuntimeFacts, VISUAL_CONTRACTS,
} from '../../scripts/visual/contracts.mjs';
import { selectVisualPlatform } from '../../scripts/visual/platform.mjs';
import type { VisualHostFacts } from '../../scripts/visual/platform.mjs';
import { APPROVED_PROPOSAL_SHA256, validateVisualReferences } from '../../scripts/visual/validate.mjs';

const legacyHost: VisualHostFacts = {
  githubActions: 'true', runnerEnvironment: 'github-hosted', runnerOS: 'macOS', runnerArch: 'ARM64',
  platform: 'darwin', arch: 'arm64', release: '25.6.0', macosVersion: '26.6.2',
  node: 'v22.17.0', imageVersion: '20261013.0424.1',
};
const proposedHost: VisualHostFacts = { ...legacyHost, imageVersion: '20261021.0445.8' };
const runtime = {
  browserVersion: '156.0.8078.4',
  actualFonts: [{ postScriptName: 'PingFangSC-Semibold', isCustomFont: false, glyphCount: 10 }],
  renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple Paravirtual device, Unspecified Version)',
  vendor: 'Google Inc. (Apple)', devicePixelRatio: 1,
};

describe('versioned image approval and fingerprint contracts', () => {
  it('keeps the legacy alias and exact version bound to the same approved contract', () => {
    const legacy = getVisualContract(LEGACY_VISUAL_CONTRACT_ID);
    expect(getVisualContract('github-macos-26')).toBe(legacy);
    expect(legacy).toMatchObject({ id: LEGACY_VISUAL_CONTRACT_ID, approvalStatus: 'APPROVED', host: { imageVersion: '20261013.0424.1' } });
    for (const selector of ['github-macos-26', LEGACY_VISUAL_CONTRACT_ID]) {
      expect(selectVisualPlatform(selector, legacyHost)).toMatchObject({
        contractId: LEGACY_VISUAL_CONTRACT_ID, referenceSetSha256: REFERENCE_SET_SHA256,
        snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/github-macos-26/{arg}{ext}',
      });
      expect(() => assertVisualRuntimeContract(selector, runtime)).not.toThrow();
    }
  });
  it('records the candidate mapping and proposed reference reuse without granting approval', () => {
    const proposed = getVisualContract(PROPOSED_VISUAL_CONTRACT_ID);
    expect(proposed).toMatchObject({
      id: 'github-macos-26-20261021-0445-8-v1', approvalStatus: 'PENDING',
      host: { imageVersion: '20261021.0445.8' },
      reference: { referenceSetSha256: REFERENCE_SET_SHA256, directoryId: 'github-macos-26', bindingStatus: 'PROPOSED_REUSE' },
    });
    expect(() => validateContractHostFacts(proposed, proposedHost)).not.toThrow();
    expect(() => selectVisualPlatform(PROPOSED_VISUAL_CONTRACT_ID, proposedHost)).toThrow('human approval');
    expect(() => assertVisualRuntimeContract(PROPOSED_VISUAL_CONTRACT_ID, runtime)).toThrow('human approval');
    expect(proposed.approvalStatus).toBe('PENDING');
  });
  it('does not let the new image use the legacy alias or legacy image claim the new mapping', () => {
    expect(() => selectVisualPlatform('github-macos-26', proposedHost)).toThrow('imageVersion=20261013.0424.1');
    expect(() => validateContractHostFacts(getVisualContract(PROPOSED_VISUAL_CONTRACT_ID), legacyHost)).toThrow('imageVersion=20261021.0445.8');
  });
  it.each(['github-macos-26-20261022-0000-1-v1', 'latest', 'github-macos-26-20261021-0445-8-v2', '../github-macos-26'])('rejects unknown version %s without selecting a nearby contract', selector => {
    expect(() => getVisualContract(selector)).toThrow('Unknown visual platform');
    expect(() => selectVisualPlatform(selector, proposedHost)).toThrow('Unknown visual platform');
    expect(() => assertVisualRuntimeContract(selector, runtime)).toThrow('Unknown visual platform');
  });
  it.each([
    ['githubActions', 'false'], ['runnerEnvironment', 'self-hosted'], ['runnerOS', 'Linux'], ['runnerArch', 'X64'],
    ['platform', 'linux'], ['arch', 'x64'], ['release', '25.7.0'], ['macosVersion', '26.6.3'],
    ['node', 'v22.17.1'], ['imageVersion', '20261022.0000.1'], ['macosVersion', undefined], ['release', undefined],
  ] as const)('rejects an individually mismatched host field %s', (key, value) => {
    expect(() => validateContractHostFacts(getVisualContract(LEGACY_VISUAL_CONTRACT_ID), { ...legacyHost, [key]: value })).toThrow('requires');
    expect(() => validateContractHostFacts(getVisualContract(PROPOSED_VISUAL_CONTRACT_ID), { ...proposedHost, [key]: value })).toThrow('requires');
  });
  it('makes the real approval record and reference binding immutable', () => {
    expect(Object.isFrozen(VISUAL_CONTRACTS)).toBe(true);
    for (const contract of VISUAL_CONTRACTS) {
      expect(Object.isFrozen(contract)).toBe(true);
      expect(Object.isFrozen(contract.host)).toBe(true);
      expect(Object.isFrozen(contract.runtime)).toBe(true);
      expect(Object.isFrozen(contract.reference)).toBe(true);
      expect(Object.isFrozen(contract.aliases)).toBe(true);
      expect(Object.isFrozen(contract.runtime.fontPostScriptNames)).toBe(true);
      expect(Reflect.set(contract.reference, 'referenceSetSha256', '0'.repeat(64))).toBe(false);
    }
    expect(Reflect.set(getVisualContract(PROPOSED_VISUAL_CONTRACT_ID), 'approvalStatus', 'APPROVED')).toBe(false);
    expect(() => selectVisualPlatform(PROPOSED_VISUAL_CONTRACT_ID, proposedHost)).toThrow('human approval');
  });
});

describe('actual Chromium, rendered system font and renderer are required', () => {
  it('can inspect proposed host and runtime facts without authorizing the proposed image', () => {
    const proposed = getVisualContract(PROPOSED_VISUAL_CONTRACT_ID);
    expect(() => validateContractHostFacts(proposed, proposedHost)).not.toThrow();
    expect(() => validateContractRuntimeFacts(proposed, runtime)).not.toThrow();
    expect(proposed.approvalStatus).toBe('PENDING');
    expect(() => selectVisualPlatform(PROPOSED_VISUAL_CONTRACT_ID, proposedHost)).toThrow('human approval');
    expect(() => assertVisualRuntimeContract(PROPOSED_VISUAL_CONTRACT_ID, runtime)).toThrow('human approval');
  });
  it.each([null, undefined, '', 'Google Inc. (Intel)', runtime.vendor + ' '])('rejects missing or changed proposed WebGL vendor %s', vendor => {
    expect(() => validateContractRuntimeFacts(getVisualContract(PROPOSED_VISUAL_CONTRACT_ID), { ...runtime, vendor })).toThrow('vendor');
  });
  it.each([undefined, 0, 2, Number.NaN, Number.POSITIVE_INFINITY])('rejects missing or changed proposed DPR %s', devicePixelRatio => {
    expect(() => validateContractRuntimeFacts(getVisualContract(PROPOSED_VISUAL_CONTRACT_ID), { ...runtime, devicePixelRatio })).toThrow('pixel ratio');
  });
  it('requires all proposed browser, font and GPU observations even for non-authorizing inspection', () => {
    const proposed = getVisualContract(PROPOSED_VISUAL_CONTRACT_ID);
    expect(() => validateContractRuntimeFacts(proposed, { ...runtime, browserVersion: '156.0.8078.5' })).toThrow('Chromium');
    expect(() => validateContractRuntimeFacts(proposed, { ...runtime, renderer: 'SwiftShader' })).toThrow('renderer');
    expect(() => validateContractRuntimeFacts(proposed, { ...runtime, actualFonts: [] })).toThrow('font');
  });
  it.each(['156.0.8078.5', '155.0.8059.40', '', '156.0.8078.4 '])('rejects an unreviewed Chromium version %s', browserVersion => {
    expect(() => assertVisualRuntimeContract(LEGACY_VISUAL_CONTRACT_ID, { ...runtime, browserVersion })).toThrow('Chromium');
  });
  it.each([null, '', 'SwiftShader', runtime.renderer + ' '])('rejects missing or changed WebGL renderer %s', renderer => {
    expect(() => assertVisualRuntimeContract(LEGACY_VISUAL_CONTRACT_ID, { ...runtime, renderer })).toThrow('renderer');
  });
  it.each(['browserVersion', 'actualFonts', 'renderer'])('rejects a missing observed %s', key => {
    const missing = { ...runtime };
    Reflect.deleteProperty(missing, key);
    expect(() => assertVisualRuntimeContract(LEGACY_VISUAL_CONTRACT_ID, missing)).toThrow();
  });
  it('rejects empty font observations and unreviewed fallback fonts', () => {
    expect(() => assertVisualRuntimeContract(LEGACY_VISUAL_CONTRACT_ID, { ...runtime, actualFonts: [] })).toThrow('font');
    expect(() => assertVisualRuntimeContract(LEGACY_VISUAL_CONTRACT_ID, { ...runtime,
      actualFonts: [{ postScriptName: 'Helvetica', isCustomFont: false, glyphCount: 10 }],
    })).toThrow('font');
    expect(() => assertVisualRuntimeContract(LEGACY_VISUAL_CONTRACT_ID, { ...runtime,
      actualFonts: [...runtime.actualFonts, { postScriptName: 'Helvetica', isCustomFont: false, glyphCount: 1 }],
    })).toThrow('font');
  });
  it('rejects a web font impersonating the reviewed PostScript name', () => {
    expect(() => assertVisualRuntimeContract(LEGACY_VISUAL_CONTRACT_ID, { ...runtime,
      actualFonts: [{ postScriptName: 'PingFangSC-Semibold', isCustomFont: true, glyphCount: 10 }],
    })).toThrow('font');
  });
  it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])('requires positive integer rendered glyph count %s', glyphCount => {
    expect(() => assertVisualRuntimeContract(LEGACY_VISUAL_CONTRACT_ID, { ...runtime,
      actualFonts: [{ postScriptName: 'PingFangSC-Semibold', isCustomFont: false, glyphCount }],
    })).toThrow('font');
  });
});

describe('formal runtime inspection cannot be replaced by candidate or observation metadata', () => {
  const config = readFileSync('playwright.config.ts', 'utf8');
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  const observation = readFileSync('playwright.visual-observe.config.ts', 'utf8');
  const candidate = readFileSync('playwright.visual-candidate.config.ts', 'utf8');
  const setup = readFileSync('tests/e2e/visual-contract-setup.ts', 'utf8');
  const provenance = readFileSync('tests/e2e/00-visual-provenance.spec.ts', 'utf8');
  const collector = readFileSync('tests/e2e/visual-provenance.ts', 'utf8');
  it('runs the real browser preflight before any formal screenshot test', () => {
    expect(config).toContain("globalSetup: visualPlatform.id === 'local-original' ? undefined : './tests/e2e/visual-contract-setup.ts'");
    expect(setup).toContain('chromium.launch(');
    expect(setup).toContain('collectVisualProvenance(page, browser.version())');
    expect(setup).toContain('assertVisualRuntimeContract(comparison.id');
    expect(setup).toContain("errorCode: 'VISUAL_RUNTIME_CONTRACT_REJECTED'");
    expect(setup).toContain('await browser?.close()');
    expect(config).toContain('timeout: 35000');
    expect(config).toContain("updateSnapshots: 'none'");
  });
  it('limits the pre-font observation configuration to the single provenance test', () => {
    expect(observation).toContain("testMatch: '**/00-visual-provenance.spec.ts'");
    expect(observation).toContain('metadata: { visualObservationOnly: true }');
    expect(observation).toContain('globalSetup: []');
    expect(observation).not.toMatch(/testIgnore|grep|snapshotPathTemplate|RUNNER3D_VISUAL_PLATFORM/);
    expect(workflow).toContain('npx playwright test --config playwright.visual-observe.config.ts --output=test-results/visual-provenance');
    expect(workflow).toContain('- run: npm run test:visual\n');
    expect(workflow).toContain('test-results/visual-contract/result.json');
  });
  it('continues to collect actual browser, CDP fonts and WebGL facts', () => {
    expect(collector).toContain("cdp.send('CSS.getPlatformFontsForNode'");
    expect(collector).toContain("gl?.getExtension('WEBGL_debug_renderer_info')");
    expect(collector).toContain('gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)');
    expect(collector).toContain('gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)');
    expect(collector).not.toContain('process.env');
    // Formal runtime validation belongs to globalSetup; preserve all existing visual tests.
    expect(createHash('sha256').update(provenance).digest('hex')).toBe('e6042a4245a9bd5e1d0637ffd833e5a0724f012afa02abd0627ce5fcf095a61f');
    expect(provenance).toContain('browser.version()');
  });
  it('keeps candidate evidence explicitly separate from the formal preflight and approval', () => {
    expect(candidate).toContain('globalSetup: []');
    expect(candidate).toContain('currentCandidateDiagnostic()');
    expect(candidate).toContain('metadata: { visualCandidate: candidate }');
    expect(candidate).toContain("updateSnapshots: 'none'");
    expect(candidate).not.toMatch(/APPROVED|approvalStatus:|maxDiff|threshold|testIgnore|testMatch|timeout:/);
    const commands = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    expect(commands['test:visual']).toBe('playwright test ' + [
      '00-visual-provenance', 'city-visual', 'themes-visual', 'character-visual', 'animation-visual',
      'motion-visual', 'feel-visual', 'mobile-visual', 'progression-visual', 'product-visual',
    ].map(name => `tests/e2e/${name}.spec.ts`).join(' '));
  });
});

describe('explicit immutable reuse of the complete reviewed reference set', () => {
  const referenceReport = validateVisualReferences();
  const proposal = 'artifacts/beta-launch/platform-reference-proposal.json';
  let root: string;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'runner3d-versioned-reference-contract-'));
    for (const path of [proposal, ...referenceReport.entries.flatMap(row => [row.original, row.platform])]) {
      mkdirSync(dirname(join(root, path)), { recursive: true }); copyFileSync(path, join(root, path));
    }
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  it('binds both version IDs to exact reviewed hashes without creating or replacing PNGs', () => {
    const sorted = referenceReport.entries.map(row => ({ path: row.platform, sha256: row.platformSha256 }))
      .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    const actualSetHash = createHash('sha256').update(sorted.map(row => `${row.path}\0${row.sha256}\n`).join('')).digest('hex');
    expect(actualSetHash).toBe('5de38a3343bf3e24812b7bcd7c8e2d6a9dba053f8f66a057138533e8aa2adc28');
    expect(actualSetHash).toBe(REFERENCE_SET_SHA256);
    expect(validateContractReferences(root)).toEqual({
      referenceProposalSha256: APPROVED_PROPOSAL_SHA256, referenceSetSha256: actualSetHash, count: 91,
      contracts: [
        { id: LEGACY_VISUAL_CONTRACT_ID, approvalStatus: 'APPROVED', referenceSetSha256: actualSetHash, bindingStatus: 'APPROVED' },
        { id: PROPOSED_VISUAL_CONTRACT_ID, approvalStatus: 'PENDING', referenceSetSha256: actualSetHash, bindingStatus: 'PROPOSED_REUSE' },
      ],
    });
    expect(validateVisualReferences(root)).toEqual(referenceReport);
  });
  it.each(['original', 'platform'] as const)('rejects one changed %s file before authorizing a shared reference binding', kind => {
    const path = join(root, referenceReport.entries[0]![kind]), bytes = readFileSync(path);
    try {
      writeFileSync(path, Buffer.concat([bytes, Buffer.from([0])]));
      expect(() => validateContractReferences(root)).toThrow('hash mismatch');
    } finally { writeFileSync(path, bytes); }
  });
  it('rejects changed proposal metadata despite unchanged PNG paths', () => {
    const path = join(root, proposal), bytes = readFileSync(path);
    try {
      writeFileSync(path, Buffer.concat([bytes, Buffer.from(' ')]));
      expect(() => validateContractReferences(root)).toThrow('proposal hash changed');
    } finally { writeFileSync(path, bytes); }
  });
});
