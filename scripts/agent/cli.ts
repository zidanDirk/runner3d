import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { codexExecutor, CodexFailure, discoverCodex, parseImplementation } from './codex';
import { blenderProbe, doctor, prepareProbe, repositoryName } from './doctor';
import { dryRun } from './dry-run';
import { GitHub } from './github';
import { Orchestrator } from './orchestrator';
import { runProcess } from './process';
import { parseCandidate } from './research';
import { contained, parseConfig, redact } from './security';
import { Store } from './store';
import { sandboxedQA } from './sandbox';
import { browserProbe, sandboxProbe } from './probes';
import { check, record } from './types';
import type { Candidate } from './types';

const HELP = `Runner3D 本地 Agent（无服务器/无调度/无自动合并）
doctor | research | plan | execute | verify | report | status | dry-run | probe | blender-probe | sandbox-probe
browser-probe --task=<id>               已批准工作区的固定浏览器/WebGL探针
import --file=<candidate.json>
beta-feedback --file=<human-reviewed-beta.json>  只读审核文件、查重并生成未审核草稿
approve --task=<id> --confirm=<digest> --reviewer=<human> [--high-risk=true]
approve-github --task=<id>                 验证真实人工label事件/权限/正文
publish-issue --task=<id> --confirm=<id>   明确写入GitHub
publish-pr --task=<id> --confirm=<id>      仅推送任务分支并创建Draft PR
recover --task=<id> --confirm=<id>        保留改动，消耗一轮修复预算
cancel --task=<id> --confirm=<id>         取消空闲任务，保留工作区与日志
recover-lock --pid=<dead-owner-pid>       仅恢复本机已确认死亡的锁
所有数据在 .agent-data/；CODEX_PATH 可指定兼容CLI，BLENDER_PATH沿用原工厂。
`;
export function options(args: string[]): { command: string; flags: Record<string, string> } {
  const command = args[0] ?? 'status', flags: Record<string, string> = {};
  const known = new Set(['task', 'confirm', 'reviewer', 'high-risk', 'file', 'pid']);
  for (const arg of args.slice(1)) { const match = /^--([a-z-]+)=(.+)$/.exec(arg); check(match?.[1] && match[2] && known.has(match[1]) && !Object.hasOwn(flags, match[1]), 'Unknown, duplicate or missing CLI option (use --key=value)'); flags[match[1]] = match[2]; }
  return { command, flags };
}
export async function main(args = process.argv.slice(2), root = process.cwd()): Promise<void> {
  const { command, flags } = options(args); if (command === 'help' || command === '--help') { console.log(HELP); return; }
  const config = parseConfig(JSON.parse(await readFile(resolve(root, 'agent.config.json'), 'utf8')));
  const store = new Store(root); await store.init();
  if (command === 'doctor') { const data = await doctor(root, runProcess); await store.write('reports/doctor.json', data); console.log(JSON.stringify(data, null, 2)); return; }
  if (command === 'blender-probe') { const data = await blenderProbe(root, runProcess); await store.write('reports/blender-probe.json', data); console.log(JSON.stringify(data, null, 2)); return; }
  if (command === 'sandbox-probe') { console.log(JSON.stringify(await store.lock(() => sandboxProbe(root, store, runProcess)), null, 2)); return; }
  if (command === 'browser-probe') { check(flags.task, '--task required'); console.log(JSON.stringify(await store.lock(() => browserProbe(root, store, runProcess, flags.task ?? '')), null, 2)); return; }
  if (command === 'dry-run') { const data = await store.lock(() => dryRun(root, config, runProcess)); console.log(JSON.stringify(data, null, 2)); return; }
  if (command === 'probe') {
    await store.lock(async () => {
    const capability = await discoverCodex(runProcess, root); check(capability.supported, 'Compatible Codex not found');
    const directory = await prepareProbe(root, runProcess);
    const fake: Candidate = { key: 'readonly-probe', title: 'Read-only model capability probe', category: 'Technical Debt', kind: 'observed', problem: 'Return a structured empty edit list to verify invocation only.', solution: 'Return summary=READ_ONLY_PROBE_OK and edits=[]. Do not call tools.', benefit: 'Verify real CLI/auth, no implementation or approval.', complexity: 'Read-only', risks: [], evidence: [], scores: { impact: 1, confidence: 1, effort: 1, risk: 1, automation: 1 }, priority: 1, scope: [], acceptance: ['No code writes'], tests: [] };
    const task = await store.create(fake); let previous: Record<string, unknown> | null = null;
    try { previous = record(JSON.parse(await readFile(resolve(store.root, 'reports/codex-probe.json'), 'utf8'))); } catch { /* No successful capability probe. */ }
    if (previous?.implementation === false && previous.result) { const result = record(previous.result); if (typeof result.tokens === 'number' && task.rounds === 0) { task.rounds = 1; task.tokens = result.tokens; await store.save(task); } }
    check(flags.confirm === undefined || flags.confirm === 'rerun-readonly-probe', 'Use exact --confirm=rerun-readonly-probe for another model call');
    if (previous && flags.confirm === undefined) { console.log(JSON.stringify({ cached: true, capabilityNow: capability, previousProbe: previous, note: 'Historical real-model result; no new inference/authentication check performed' }, null, 2)); return; }
    check(task.rounds < config.maxRounds && task.tokens < config.maxTokens, 'Read-only probe call/token budget exhausted'); task.rounds++; await store.save(task);
    try {
      const result = await codexExecutor(runProcess, store, config, capability)(task, directory, ''); task.tokens += result.tokens; await store.save(task);
      check(task.tokens <= config.maxTokens, 'Probe token budget exceeded; result not accepted'); parseImplementation({ summary: result.summary, edits: result.edits }); check(result.edits.length === 0, 'Probe must not propose edits');
      const report = { at: new Date().toISOString(), capability, result, implementation: false, remoteGitHubSideEffects: false }; await store.write('reports/codex-probe.json', report); console.log(JSON.stringify(report, null, 2));
    } catch (error) { if (error instanceof CodexFailure) { task.tokens += error.reportedTokens; await store.save(task); } throw error; }
    }); return;
  }
  const name = await repositoryName(root, runProcess), github = name ? new GitHub(name, runProcess, root) : null;
  let executor = null;
  if (command === 'execute') { const capability = await discoverCodex(runProcess, root); check(capability.supported, 'Compatible Codex not found; set CODEX_PATH'); executor = codexExecutor(runProcess, store, config, capability); }
  const agent = new Orchestrator(root, config, runProcess, executor, github, undefined, sandboxedQA(runProcess, root)); await agent.init();
  const taskId = (): string => { check(flags.task, '--task=<id> required'); return flags.task; };
  switch (command) {
    case 'research': { const tasks = await agent.research(); console.table(tasks.map(t => ({ id: t.id, state: t.state, priority: t.candidate.priority, type: t.candidate.kind, issue: t.issue?.number ?? 'local draft' }))); break; }
    case 'import': { check(flags.file && !flags.file.startsWith('-'), '--file is required'); const content = await readFile(await contained(root, relative(root, resolve(root, flags.file)))); check(content.length < config.maxInputChars, 'Candidate exceeds input budget'); const task = await agent.store.lock(() => agent.propose(parseCandidate(JSON.parse(content.toString('utf8'))))); console.log(JSON.stringify(task, null, 2)); break; }
    case 'beta-feedback': { check(flags.file, '--file is required'); const path = relative(root, resolve(root, flags.file)); const tasks = await agent.importBetaFeedback(path); console.table(tasks.map(t => ({ id: t.id, state: t.state, issue: t.issue?.url ?? 'local draft', synthetic: t.mode === 'dry-run' }))); break; }
    case 'approve': console.log(JSON.stringify(await agent.approve(taskId(), flags.confirm ?? '', flags.reviewer ?? '', flags['high-risk'] === 'true'), null, 2)); break;
    case 'approve-github': console.log(JSON.stringify(await agent.approveFromGitHub(taskId()), null, 2)); break;
    case 'plan': console.log(JSON.stringify((await agent.plan(taskId())).plan, null, 2)); break;
    case 'execute': { const task = await agent.execute(taskId()); console.log(JSON.stringify({ id: task.id, state: task.state, branch: task.branch, commit: task.commit, error: task.lastError }, null, 2)); if (task.state !== 'READY_FOR_REVIEW') process.exitCode = 1; break; }
    case 'verify': { const task = await agent.verify(taskId()); console.log(JSON.stringify(task.checks, null, 2)); if (task.state !== 'READY_FOR_REVIEW') process.exitCode = 1; break; }
    case 'report': { const task = await agent.store.read(taskId()); await agent.reportTask(task); console.log(resolve(store.root, 'reports', `${task.id}-pr.md`)); break; }
    case 'publish-issue': console.log(JSON.stringify((await agent.publishIssue(taskId(), flags.confirm ?? '')).issue, null, 2)); break;
    case 'publish-pr': console.log(JSON.stringify((await agent.publishPR(taskId(), flags.confirm ?? '')).prUrl, null, 2)); break;
    case 'recover': console.log(JSON.stringify({ state: (await agent.recover(taskId(), flags.confirm ?? '')).state })); break;
    case 'cancel': console.log(JSON.stringify({ state: (await agent.cancel(taskId(), flags.confirm ?? '')).state })); break;
    case 'sync': console.log(JSON.stringify({ state: (await agent.sync(taskId())).state })); break;
    case 'recover-lock': await agent.store.recoverLock(Number(flags.pid)); console.log('Dead owned lock recovered. Task state has not been replayed.'); break;
    case 'status': console.table((await agent.store.list()).map(t => ({ id: t.id, phase: t.events.at(-1)?.phase, status: t.state, issue: t.issue?.number ?? 'local', branch: t.branch, rounds: t.rounds, checks: t.state === 'VALIDATING' ? 'running' : t.checks.at(-1)?.status ?? 'not run', lastError: t.lastError, artifacts: `${store.root}/reports/${t.id}-pr.md` }))); break;
    default: throw new Error(`Unknown command.\n${HELP}`);
  }
}
export function fail(error: unknown): void { console.error(`[agent] ${redact(error instanceof Error ? error.message : 'Unknown failure')}`); process.exitCode = 1; }
