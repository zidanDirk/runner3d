import type { VisualHostFacts } from './platform.mjs';
export const CANDIDATE_REFERENCE: string;
export interface CandidateDiagnostic { id: 'candidate-diagnostic'; reference: string; snapshotPathTemplate: string; imageVersion: string; approvedReferenceImageVersion: string; approvalStatus: 'REVIEW_REQUIRED'; eligibleForRelease: false; }
export function selectCandidateDiagnostic(mode: string | undefined, expectedImageVersion: string | undefined, formalSelector: string | undefined, facts: VisualHostFacts): CandidateDiagnostic;
export function assertNoSnapshotUpdates(argv: string[]): void;
export function currentCandidateDiagnostic(): CandidateDiagnostic;
export function safeVisualHostFacts(facts: VisualHostFacts): Record<string, string | null>;
export function candidateComparisonSummary(report: unknown): { approvalStatus: 'REVIEW_REQUIRED'; eligibleForRelease: false; comparisonStatus: 'PASS' | 'FAIL_OR_INCOMPLETE'; requiredTests: number; total: number | null; expected: number | null; unexpected: number | null; flaky: number | null; skipped: number | null; };
export function visualSourceFacts(environment?: Record<string, string | undefined>): { sourceSHA: string | null; runId: string | null; runAttempt: string | null; runURL: string | null; lockSHA256: string | null; playwrightVersion: string | null; macosBuild: string | null; };
