import type { VisualHostFacts } from './platform.mjs';
export const LEGACY_VISUAL_CONTRACT_ID: 'github-macos-26-20261013-0424-1-v1';
export const PROPOSED_VISUAL_CONTRACT_ID: 'github-macos-26-20261021-0445-8-v1';
export const REFERENCE_SET_SHA256: string;
export interface VisualRuntimeFacts { browserVersion: string; actualFonts: readonly { postScriptName: string; isCustomFont: boolean; glyphCount: number }[]; renderer: string | null; vendor?: string | null; devicePixelRatio?: number; }
export interface VisualContract { readonly id: string; readonly aliases: readonly string[]; readonly approvalStatus: 'APPROVED' | 'PENDING'; readonly host: Readonly<VisualHostFacts>; readonly runtime: Readonly<{ browserVersion: string; fontPostScriptNames: readonly string[]; renderer: string; vendor?: string; devicePixelRatio?: number }>; readonly reference: Readonly<{ proposalSha256: string; referenceSetSha256: string; directoryId: string; bindingStatus: 'APPROVED' | 'PROPOSED_REUSE' }>; }
export const VISUAL_CONTRACTS: readonly VisualContract[];
export function getVisualContract(selector: string): VisualContract;
export function validateContractHostFacts(contract: VisualContract, facts: VisualHostFacts): void;
export function validateContractRuntimeFacts(contract: VisualContract, facts: VisualRuntimeFacts): void;
export function assertVisualRuntimeContract(selector: string, facts: VisualRuntimeFacts): void;
export function validateContractReferences(root?: string): { referenceProposalSha256: string; referenceSetSha256: string; count: number; contracts: { id: string; approvalStatus: 'APPROVED' | 'PENDING'; referenceSetSha256: string; bindingStatus: 'APPROVED' | 'PROPOSED_REUSE' }[] };
