export const BETA_CHECKS: readonly string[];
export function deploymentPreflight(observation: unknown): { mode: string; candidateCommit: string; baseURL: string | null; uploadReady: boolean; productionApprovalConfigured: boolean; promotionReady: boolean; blockers: string[]; note: string };
export function verifyCandidateRun(run: unknown, repository: string): string;
export function verifyCandidateCI(runs: unknown, expectedCommit: string): string;
export function assessBetaEvidence(input: unknown): { engineeringReady: boolean; previewDeployed: boolean; realDeviceAccepted: boolean; betaDecision: string; criticalOpenFindings: boolean; pending: string[]; note: string };
