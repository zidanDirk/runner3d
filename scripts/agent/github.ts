import { hash, redact, safeEnv } from './security';
import { check, record, text } from './types';
import type { Runner, Task } from './types';
import { issueBody } from './research';

export interface Issue { number: number; title: string; body: string; url: string; state: string; labels: string[] }
export interface IssueIndex { available: boolean; complete: boolean; issues: Issue[]; error?: string }
function parseIssue(raw: unknown): Issue {
  const v = record(raw); check(typeof v.number === 'number' && Number.isSafeInteger(v.number) && v.number > 0 && typeof v.title === 'string' && typeof v.html_url === 'string' && typeof v.state === 'string' && Array.isArray(v.labels), 'Invalid GitHub Issue');
  return { number: v.number, title: v.title.slice(0, 200), body: typeof v.body === 'string' ? v.body.slice(0, 64000) : '', url: v.html_url, state: v.state, labels: v.labels.map(l => text(record(l).name, 100)) };
}
export function duplicate(key: string, title: string, issues: Issue[]): Issue | undefined {
  const normalize = (s: string): string => s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
  return issues.find(i => i.body.includes(`<!-- runner3d-agent:v1:${key} -->`) || normalize(i.title) === normalize(title));
}
export class GitHub {
  constructor(readonly repository: string, private runner: Runner, private cwd: string, private executable = 'gh') { check(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository), 'Unsafe GitHub repository'); }
  private environment(): NodeJS.ProcessEnv { const env = safeEnv(); for (const key of ['GH_TOKEN', 'GITHUB_TOKEN']) if (process.env[key]) env[key] = process.env[key]; return env; }
  private async api(path: string, body?: unknown): Promise<unknown> {
    const args = ['api', `repos/${this.repository}/${path}`, ...(body === undefined ? [] : ['--method', 'POST', '--input', '-'])];
    const result = await this.runner(this.executable, args, { cwd: this.cwd, timeoutMs: 20000, maxBytes: 1048576, env: this.environment(), ...(body === undefined ? {} : { input: JSON.stringify(body) }) });
    check(result.exitCode === 0, 'GITHUB_UNAVAILABLE_OR_PERMISSION_DENIED'); return JSON.parse(result.stdout) as unknown;
  }
  async index(): Promise<IssueIndex> {
    const issues: Issue[] = [];
    try { for (let page = 1; page <= 10; page++) { const data = await this.api(`issues?state=all&per_page=100&page=${page}`); check(Array.isArray(data), 'Invalid Issue index'); issues.push(...data.filter(x => !Object.hasOwn(record(x), 'pull_request')).map(parseIssue)); if (data.length < 100) return { available: true, complete: true, issues }; } return { available: true, complete: false, issues, error: 'Index exceeds 1000 records; publishing blocked until a complete search' }; }
    catch { return { available: false, complete: false, issues, error: 'GITHUB_UNAVAILABLE_OR_PERMISSION_DENIED; local drafts retained' }; }
  }
  async issue(number: number): Promise<Issue> { check(Number.isSafeInteger(number) && number > 0, 'Invalid Issue number'); return parseIssue(await this.api(`issues/${number}`)); }
  async permissions(): Promise<unknown> {
    const result = await this.runner(this.executable, ['api', `repos/${this.repository}`, '--jq', '{default_branch,permissions,archived}'], { cwd: this.cwd, timeoutMs: 20000, env: this.environment() });
    return result.exitCode === 0 ? JSON.parse(result.stdout) as unknown : { available: false, reason: 'GITHUB_UNAVAILABLE_OR_PERMISSION_DENIED' };
  }
  async publishIssue(task: Task): Promise<{ number: number; url: string; bodyHash: string }> {
    const index = await this.index(); check(index.available && index.complete, 'A complete live duplicate check is required');
    const existing = duplicate(task.candidate.key, task.candidate.title, index.issues);
    let issue = existing;
    if (!issue) {
      const labels = await this.api('labels?per_page=100'); check(Array.isArray(labels), 'Cannot inspect existing labels');
      const names = labels.map(l => record(l).name); const preferred = task.candidate.category === 'Bug' ? 'bug' : task.candidate.category === 'Accessibility' ? 'accessibility' : 'enhancement';
      issue = parseIssue(await this.api('issues', { title: task.candidate.title, body: issueBody(task.candidate), labels: names.includes(preferred) ? [preferred] : [] }));
    }
    return { number: issue.number, url: issue.url, bodyHash: hash(issue.body) };
  }
  async humanApproval(task: Task, label: string): Promise<{ actor: string; eventId: number }> {
    check(task.issue, 'No published Issue'); const issue = await this.issue(task.issue.number);
    check(issue.state === 'open' && issue.labels.includes(label) && hash(issue.body) === task.issue.bodyHash, 'Issue approval missing, revoked, closed or content changed');
    let latest: Record<string, unknown> | undefined;
    for (let page = 1; page <= 10; page++) {
      const events = await this.api(`issues/${issue.number}/events?per_page=100&page=${page}`); check(Array.isArray(events), 'Invalid approval events');
      for (const raw of events) { const e = record(raw); if (['labeled', 'unlabeled'].includes(String(e.event)) && e.label && record(e.label).name === label) latest = e; }
      if (events.length < 100) break; check(page < 10, 'Approval history incomplete');
    }
    check(latest?.event === 'labeled' && typeof latest.id === 'number', 'No auditable human label event');
    const actor = record(latest.actor); check(actor.type === 'User' && typeof actor.login === 'string' && /^[a-zA-Z0-9-]{1,39}$/.test(actor.login), 'Bots cannot approve tasks');
    const permission = record(await this.api(`collaborators/${actor.login}/permission`));
    check(['admin', 'maintain', 'write'].includes(String(permission.permission)), 'Approver must have repository write permission');
    return { actor: actor.login, eventId: latest.id };
  }
  async validateIssue(task: Task): Promise<void> {
    if (!task.issue) return; const current = await this.issue(task.issue.number);
    check(current.state === 'open' && hash(current.body) === task.issue.bodyHash && !current.labels.some(l => ['拒绝', '挂起', 'rejected', 'on-hold'].includes(l)), 'Issue changed, held, rejected or closed; approval must be renewed');
  }
  async draftPR(task: Task, body: string): Promise<string> {
    check(task.branch && task.branch.startsWith('codex/agent/'), 'Only owned task branches may open PRs');
    const data = await this.api(`pulls?state=all&head=${encodeURIComponent(this.repository.split('/')[0] + ':' + task.branch)}&per_page=100`);
    check(Array.isArray(data) && data.length < 100, 'PR duplicate index incomplete');
    if (data.length) { const existing = record(data[0]); check(typeof existing.html_url === 'string', 'Invalid PR URL'); return existing.html_url; }
    const pr = record(await this.api('pulls', { title: redact(task.candidate.title), body, head: task.branch, base: 'master', draft: true }));
    check(typeof pr.html_url === 'string', 'GitHub did not return a PR URL'); return pr.html_url;
  }
}
