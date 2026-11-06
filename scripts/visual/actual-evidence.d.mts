import type { VisualHostFacts } from './platform.mjs';
export interface ActualSelection { phase: 'local-verification' | 'approved-equivalence' | 'candidate-collect'; expectedImage: string | null; contractId: string | null; snapshotPathTemplate: string; eligibleForRelease: false; }
export function currentActualSelection(): ActualSelection;
export function collectorSourceHashes(): { instrumentation: string; preload: string };
export const COMPARISON_POLICIES: Readonly<Record<string, Readonly<{ comparator: string; threshold: number; maxDiffPixels: number | null; maxDiffPixelRatio: number | null }>>>;
export function assertActualRuntime(selection: ActualSelection, report: { host: { browser: string }; actualFonts: { postScriptName: string; isCustomFont: boolean; glyphCount: number }[]; renderer: string | null; vendor?: string | null; devicePixelRatio?: number; runner?: VisualHostFacts }): void;
export function validateAssertionRecord(record: unknown, reference: { path: string; sha256: string; comparisonOptions?: { comparator: string; threshold: number; maxDiffPixels: number | null; maxDiffPixelRatio: number | null } }, options?: { root?: string }): unknown;
export function compareTestReports(native: unknown, instrumented: unknown): { status: 'PASS'; tests: number; cases: unknown[]; eligibleForRelease: false };
export function validateApprovedProof(proof: unknown, expected: { sourceSHA: string; runId: string; attempt: string; proofSha256: string }, rawBytes: Buffer): true;
export function buildCoverage(context: unknown, references: unknown, suiteReport: unknown): unknown;
