export const APPROVED_PROPOSAL_SHA256: string;
export interface VisualReferenceReport { schemaVersion: number; proposalSha256: string; sourceCommit: string; sourceRun: string; originalCount: number; platformCount: number; reviewedActualCount: number; unchangedCopyCount: number; allMatched: boolean; entries: { original: string; platform: string; originalSha256: string; platformSha256: string; sourceKind: string; width: number; height: number; matched: boolean }[]; }
export function validateVisualReferences(root?: string): VisualReferenceReport;
