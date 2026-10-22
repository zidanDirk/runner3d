export const STATES = ['DISCOVERED', 'PROPOSED', 'AWAITING_APPROVAL', 'APPROVED', 'PLANNING', 'IMPLEMENTING', 'VALIDATING', 'READY_FOR_REVIEW', 'MERGED', 'REJECTED', 'BLOCKED', 'FAILED', 'CANCELLED'] as const;
export type State = typeof STATES[number];
export type Category = 'Gameplay' | 'UI/UX' | 'Performance' | 'Visual' | 'Animation' | 'Audio' | 'Accessibility' | 'Bug' | 'Technical Debt';
export interface Scores { impact: number; confidence: number; effort: number; risk: number; automation: number }
export interface Evidence { path: string; line: number; excerpt: string; sha256: string }
export interface Candidate {
  key: string; title: string; category: Category; kind: 'observed' | 'hypothesis' | 'acceptance-gap';
  problem: string; solution: string; benefit: string; complexity: string; risks: string[];
  evidence: Evidence[]; scores: Scores; priority: number; scope: string[]; acceptance: string[]; tests: string[];
}
export interface Config {
  schemaVersion: 1; maxTasks: number; maxConcurrency: number; maxRounds: number; maxFixes: number;
  maxTaskSeconds: number; maxCallSeconds: number; maxOutputBytes: number; maxInputChars: number;
  maxTokens: number; retainRuns: number; approvedLabel: string;
}
export interface Approval {
  source: 'local-human' | 'github-human' | 'dry-run'; actor: string; issueDigest: string;
  baseCommit: string; highRiskAccepted: boolean; at: string; eventId?: number;
}
export interface PlanStep { id: string; dependsOn: string[]; files: string[]; action: string; acceptance: string[] }
export interface Plan { steps: PlanStep[]; fast: string[]; full: string[]; requiresPerformance: boolean; requiresAssets: boolean; requiresBalance: boolean }
export interface Check { id: string; status: 'passed' | 'failed' | 'needs-review'; exitCode: number; durationMs: number; log: string; reason?: string }
export interface Transition { at: string; from: State | null; to: State; phase: string; issue: number | null; branch: string | null; summary: string }
export interface Task {
  schemaVersion: 1; id: string; mode: 'real' | 'dry-run'; state: State; candidate: Candidate; digest: string;
  issue: { number: number; url: string; bodyHash: string } | null; approval: Approval | null;
  branch: string | null; workspace: string | null; baseCommit: string | null;
  rounds: number; fixes: number; tokens: number; startedAt: string | null; updatedAt: string;
  events: Transition[]; plan: Plan | null; checks: Check[]; lastError: string | null;
  commit: string | null; prUrl: string | null; remoteIntent: 'issue' | 'pr' | null;
}
export interface CommandResult { exitCode: number; stdout: string; stderr: string; durationMs: number; reason?: string }
export interface RunOptions { cwd: string; timeoutMs?: number; maxBytes?: number; input?: string; env?: NodeJS.ProcessEnv }
export type Runner = (command: string, args: readonly string[], options: RunOptions) => Promise<CommandResult>;
export interface Edit { path: string; beforeSha256: string | null; content: string }
export interface Implementation { summary: string; edits: Edit[]; tokens: number }
export type Executor = (task: Task, workspace: string, feedback: string) => Promise<Implementation>;

export function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export function record(value: unknown): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'Expected object');
  return value as Record<string, unknown>;
}
export function fields(value: unknown, allowed: readonly string[], required = allowed): Record<string, unknown> {
  const obj = record(value);
  check(Object.keys(obj).every(k => allowed.includes(k)) && required.every(k => Object.hasOwn(obj, k)), 'Unknown or missing fields');
  return obj;
}
export function text(value: unknown, max = 4000): string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x08\x0b-\x1f\x7f]/.test(value), 'Invalid text'); return value;
}
export function strings(value: unknown, maxItems = 32): string[] {
  check(Array.isArray(value) && value.length <= maxItems, 'Invalid list'); return value.map(v => text(v));
}
