import { createHash } from 'node:crypto';
import { validateVisualReferences, APPROVED_PROPOSAL_SHA256 } from './validate.mjs';

export const LEGACY_VISUAL_CONTRACT_ID = 'github-macos-26-20261013-0424-1-v1';
export const PROPOSED_VISUAL_CONTRACT_ID = 'github-macos-26-20261021-0445-8-v1';
// SHA256 of sorted UTF-8 `${platformPath}\0${platformSha256}\n` rows.
export const REFERENCE_SET_SHA256 = '5de38a3343bf3e24812b7bcd7c8e2d6a9dba053f8f66a057138533e8aa2adc28';
const renderer = 'ANGLE (Apple, ANGLE Metal Renderer: Apple Paravirtual device, Unspecified Version)';
const commonHost = { githubActions: 'true', runnerEnvironment: 'github-hosted', runnerOS: 'macOS', runnerArch: 'ARM64',
  platform: 'darwin', arch: 'arm64', release: '25.6.0', macosVersion: '26.6.2', node: 'v22.17.0' };
const commonReference = { proposalSha256: APPROVED_PROPOSAL_SHA256, referenceSetSha256: REFERENCE_SET_SHA256, directoryId: 'github-macos-26' };
function freeze(value) {
  for (const nested of Object.values(value)) if (nested && typeof nested === 'object') freeze(nested);
  return Object.freeze(value);
}

/** A proposed row is an immutable review record, never runtime authorization.
 * Approval requires a separate reviewed code change; no environment override exists. */
export const VISUAL_CONTRACTS = freeze([
  { id: LEGACY_VISUAL_CONTRACT_ID, aliases: ['github-macos-26'], approvalStatus: 'APPROVED',
    host: { ...commonHost, imageVersion: '20261013.0424.1' },
    runtime: { browserVersion: '156.0.8078.4', fontPostScriptNames: ['PingFangSC-Semibold'], renderer },
    reference: { ...commonReference, bindingStatus: 'APPROVED' } },
  { id: PROPOSED_VISUAL_CONTRACT_ID, aliases: [], approvalStatus: 'PENDING',
    host: { ...commonHost, imageVersion: '20261021.0445.8' },
    runtime: { browserVersion: '156.0.8078.4', fontPostScriptNames: ['PingFangSC-Semibold'], renderer, vendor: 'Google Inc. (Apple)', devicePixelRatio: 1 },
    // This is a proposed reuse binding, not proof that all candidate actuals match.
    reference: { ...commonReference, bindingStatus: 'PROPOSED_REUSE' } },
]);

export function getVisualContract(selector) {
  const contract = VISUAL_CONTRACTS.find(row => row.id === selector || row.aliases.includes(selector));
  if (!contract) throw new Error(`Unknown visual platform: ${selector}`);
  return contract;
}

/** Pure fingerprint comparison. It does not grant approval to a pending row. */
export function validateContractHostFacts(contract, facts) {
  for (const [name, expected] of Object.entries(contract.host)) {
    if (facts[name] !== expected) throw new Error(`${contract.aliases[0] ?? contract.id} requires ${name}=${expected}; received ${facts[name] ?? 'missing'}`);
  }
}

/** Use actual Chromium/CDP/WebGL observations before any formal screenshot test. */
export function assertVisualRuntimeContract(selector, facts) {
  const contract = getVisualContract(selector);
  if (contract.approvalStatus !== 'APPROVED') throw new Error(`${contract.id} requires human approval`);
  validateContractRuntimeFacts(contract, facts);
}

/** Pure runtime comparison for review/testing; this never grants image approval. */
export function validateContractRuntimeFacts(contract, facts) {
  const expected = contract.runtime;
  if (facts.browserVersion !== expected.browserVersion) throw new Error('Visual contract requires the reviewed Chromium version');
  if (facts.renderer !== expected.renderer) throw new Error('Visual contract requires the reviewed WebGL renderer');
  if (expected.vendor !== undefined && facts.vendor !== expected.vendor) throw new Error('Visual contract requires the reviewed WebGL vendor');
  if (expected.devicePixelRatio !== undefined && facts.devicePixelRatio !== expected.devicePixelRatio) throw new Error('Visual contract requires the reviewed device pixel ratio');
  if (!Array.isArray(facts.actualFonts) || facts.actualFonts.length === 0 || facts.actualFonts.some(font =>
    !expected.fontPostScriptNames.includes(font.postScriptName) || font.isCustomFont !== false || !Number.isSafeInteger(font.glyphCount) || font.glyphCount <= 0)) {
    throw new Error('Visual contract requires the actual reviewed system font with rendered glyphs');
  }
  for (const name of expected.fontPostScriptNames) if (!facts.actualFonts.some(font => font.postScriptName === name)) throw new Error('Visual contract requires every reviewed system font');
}

/** Bind shared reference paths to reviewed immutable content, never to directory name alone. */
export function validateContractReferences(root) {
  const report = validateVisualReferences(root);
  const rows = report.entries.map(row => [row.platform, row.platformSha256]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const referenceSetSha256 = createHash('sha256').update(rows.map(([path, sha]) => `${path}\0${sha}\n`).join('')).digest('hex');
  if (referenceSetSha256 !== REFERENCE_SET_SHA256) throw new Error('Versioned visual reference set hash changed');
  for (const contract of VISUAL_CONTRACTS) {
    if (contract.reference.proposalSha256 !== report.proposalSha256 || contract.reference.referenceSetSha256 !== referenceSetSha256 || contract.reference.directoryId !== 'github-macos-26') throw new Error('Visual contract reference binding changed');
  }
  return { referenceProposalSha256: report.proposalSha256, referenceSetSha256, count: rows.length,
    contracts: VISUAL_CONTRACTS.map(({ id, approvalStatus, reference }) => ({ id, approvalStatus, referenceSetSha256: reference.referenceSetSha256, bindingStatus: reference.bindingStatus })) };
}
