import { check, STATES } from './types';
import type { State, Task } from './types';

const edges: Record<State, readonly State[]> = {
  DISCOVERED: ['PROPOSED', 'CANCELLED'], PROPOSED: ['AWAITING_APPROVAL', 'CANCELLED'],
  AWAITING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED'], APPROVED: ['PLANNING', 'BLOCKED', 'CANCELLED'],
  PLANNING: ['IMPLEMENTING', 'FAILED', 'BLOCKED', 'CANCELLED'], IMPLEMENTING: ['VALIDATING', 'FAILED', 'BLOCKED', 'CANCELLED'],
  VALIDATING: ['IMPLEMENTING', 'READY_FOR_REVIEW', 'FAILED', 'BLOCKED', 'CANCELLED'],
  READY_FOR_REVIEW: ['MERGED', 'REJECTED', 'BLOCKED', 'CANCELLED'],
  BLOCKED: ['PLANNING', 'VALIDATING', 'CANCELLED', 'AWAITING_APPROVAL'], FAILED: ['PLANNING', 'VALIDATING', 'CANCELLED', 'AWAITING_APPROVAL'],
  MERGED: [], REJECTED: [], CANCELLED: [],
};
export function transition(task: Task, to: State, phase: string, summary: string): void {
  check(STATES.includes(to) && edges[task.state].includes(to), `Invalid transition ${task.state} -> ${to}`);
  check(task.events.length < 128, 'Audit event budget exhausted');
  const from = task.state, at = new Date().toISOString(); task.state = to; task.updatedAt = at;
  task.events.push({ at, from, to, phase, issue: task.issue?.number ?? null, branch: task.branch, summary });
}
export function assertApproved(task: Task, baseCommit: string, dryRun: boolean): void {
  const a = task.approval;
  check(a && a.issueDigest === task.digest && a.baseCommit === baseCommit, 'Human approval missing, stale or scope changed');
  check(task.mode === (dryRun ? 'dry-run' : 'real') && (dryRun ? a.source === 'dry-run' : a.source !== 'dry-run'), 'Dry Run approval cannot authorize real execution');
  check(task.candidate.scores.risk < 4 || a.highRiskAccepted, 'High risk requires additional explicit human approval');
  check(task.candidate.scope.length > 0 && task.candidate.acceptance.length > 0 && task.candidate.kind !== 'acceptance-gap', 'Insufficient implementation scope; return to human');
}
