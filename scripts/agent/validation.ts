import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hash, redact } from './security';
import { check, fields } from './types';
import type { Check, Config, Plan, Runner, Task } from './types';
import type { Store } from './store';

export const COMMANDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  strict: ['run', 'typecheck'], unit: ['test'], 'asset-config': ['run', 'assets:config'], assets: ['run', 'assets:validate'],
  build: ['run', 'build'], release: ['run', 'release:check'], visual: ['run', 'test:visual'],
  e2e: ['run', 'test:e2e'], production: ['run', 'test:production'], loading: ['run', 'test:loading'],
  performance: ['run', 'test:performance'], balance: ['run', 'balance:simulate', '--', '--runs=30', '--comparisons=10', '--careers=1', '--career-runs=10', '--output=artifacts/agent-balance'], fairness: ['run', 'balance:fairness'],
});
export function planTask(task: Task): Plan {
  const scope = task.candidate.scope; check(scope.length > 0 && scope.length <= 12, 'Task requires human scope refinement (1..12 files)');
  const requiresAssets = scope.some(p => /^(?:scripts\/blender\/|assets\.config\.json|themes\/)/.test(p));
  const requiresBalance = scope.some(p => /^src\/(?:game|progression|balance)\//.test(p));
  const requiresPerformance = requiresAssets || scope.some(p => /^src\/(?:scene|city|character|effects|ui|assets)\//.test(p));
  return {
    steps: scope.map((file, i) => ({ id: `step-${i + 1}`, dependsOn: i ? [`step-${i}`] : [], files: [file], action: `按批准范围修改 ${file}；不扩展设计或权限。`, acceptance: task.candidate.acceptance })),
    fast: ['strict', 'unit', ...(requiresAssets ? ['asset-config', 'assets'] : []), ...(requiresBalance ? ['balance', 'fairness'] : [])],
    full: ['release', 'visual', 'production', 'loading', ...(requiresPerformance ? ['performance'] : [])], requiresAssets, requiresBalance, requiresPerformance,
  };
}
export interface PerformanceSample {
  conditions: { viewport: string; quality: string; dpr: number; seed: string; browser: string; theme: string; distance: number };
  samples: number;
  metrics: { drawCalls: number; triangles: number; fps: number; averageFrameMs: number; p95FrameMs: number; heapBytes: number | null; chunks: number; particles: number; resourceLoadMs: number | null };
}
export function parsePerformance(raw: unknown): PerformanceSample {
  const v = fields(raw, ['conditions', 'samples', 'metrics']), c = fields(v.conditions, ['viewport', 'quality', 'dpr', 'seed', 'browser', 'theme', 'distance']);
  check(['viewport', 'quality', 'seed', 'browser', 'theme'].every(k => typeof c[k] === 'string' && String(c[k]).length > 0 && String(c[k]).length <= 180) && typeof c.dpr === 'number' && c.dpr > 0 && c.dpr <= 4 && typeof c.distance === 'number' && Number.isFinite(c.distance) && c.distance >= 0, 'Invalid performance conditions');
  const m = fields(v.metrics, ['drawCalls', 'triangles', 'fps', 'averageFrameMs', 'p95FrameMs', 'heapBytes', 'chunks', 'particles', 'resourceLoadMs']);
  for (const [key, n] of Object.entries(m)) check((n === null && ['heapBytes', 'resourceLoadMs'].includes(key)) || (typeof n === 'number' && Number.isFinite(n) && n >= 0), 'Invalid performance metric');
  check(typeof v.samples === 'number' && Number.isSafeInteger(v.samples) && v.samples >= 100, 'At least 100 real frame samples are required');
  return raw as PerformanceSample;
}
export function comparePerformance(before: PerformanceSample, after: PerformanceSample): { status: 'passed' | 'needs-review'; reason: string } {
  const a = parsePerformance(before), b = parsePerformance(after);
  if (Object.keys(a.conditions).some(key => a.conditions[key as keyof typeof a.conditions] !== b.conditions[key as keyof typeof b.conditions])) return { status: 'needs-review', reason: 'INCOMPARABLE_CONDITIONS: no speedup or regression claim permitted' };
  const regressions: string[] = [];
  for (const key of ['drawCalls', 'triangles', 'averageFrameMs', 'p95FrameMs', 'heapBytes', 'resourceLoadMs'] as const) { const x = a.metrics[key], y = b.metrics[key]; if (x !== null && y !== null && y > x * 1.15 && y - x > (key.includes('Ms') ? 2 : 1)) regressions.push(key); }
  if (b.metrics.fps < a.metrics.fps * .85 || b.metrics.chunks !== a.metrics.chunks) regressions.push('fps/chunks');
  return { status: regressions.length ? 'needs-review' : 'passed', reason: regressions.length ? `PERFORMANCE_REGRESSION:${regressions.join(',')}` : 'Within fixed 15% review thresholds; unavailable metrics remain N/A, no GPU memory claim' };
}
export type Validator = (task: Task, level: 'fast' | 'full', manualDeadline?: number) => Promise<Check[]>;
export function classifyFailure(id: string, exitCode: number, output: string, reason?: string): Check['status'] {
  if (exitCode === 0) return 'passed';
  if (id === 'visual' || id === 'performance' || reason === 'SPAWN_FAILED' || reason === 'TIMEOUT' || /kill EPERM|sandbox-exec:|QA_SANDBOX_|Operation not permitted|EACCES|EADDRINUSE|is already used|port[^\n]*already in use/i.test(output)) return 'needs-review';
  return 'failed';
}
export function validator(runner: Runner, store: Store, config: Config): Validator {
  return async (task, level, manualDeadline) => {
    check(task.workspace && task.plan && task.startedAt, 'Validation requires isolated workspace and plan'); const checks: Check[] = [];
    const budgetEnd = manualDeadline ?? Date.parse(task.startedAt) + config.maxTaskSeconds * 1000;
    const ids = level === 'fast' ? task.plan.fast : task.plan.full;
    for (const id of ids) {
      const args = COMMANDS[id]; check(args, 'Unknown validation command');
      const remaining = budgetEnd - Date.now(); check(remaining > 0, 'Task wall-time budget exhausted');
      const result = await runner(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: task.workspace, timeoutMs: remaining, maxBytes: config.maxOutputBytes });
      const log = `logs/${task.id}-r${task.rounds}-v${manualDeadline ? task.verifications ?? 0 : 0}-${level}-${id}.log`; await store.write(log, redact(result.stdout + '\n' + result.stderr));
      const item: Check = { id, status: classifyFailure(id, result.exitCode, result.stdout + result.stderr, result.reason), exitCode: result.exitCode, durationMs: result.durationMs, log, ...(result.reason ? { reason: result.reason } : {}) }; checks.push(item);
      if (item.status !== 'passed') break;
    }
    // This mode never fabricates a comparison from unmatched or missing measurements.
    if (level === 'full' && task.plan.requiresPerformance && checks.every(c => c.status === 'passed')) {
      let status: Check['status'] = 'needs-review', reason = 'PERFORMANCE_BASELINE_REQUIRED: normalize actual before/after monitor reports with matching conditions';
      try {
        const before: unknown = JSON.parse(await readFile(resolve(store.root, 'reports', `${task.id}-performance-before.json`), 'utf8'));
        const after: unknown = JSON.parse(await readFile(resolve(store.root, 'reports', `${task.id}-performance-after.json`), 'utf8'));
        ({ status, reason } = comparePerformance(parsePerformance(before), parsePerformance(after)));
      } catch { /* Missing/invalid data is a review blocker, never a pass. */ }
      checks.push({ id: 'performance-comparison', status, reason, exitCode: status === 'passed' ? 0 : 1, durationMs: 0, log: '' });
    }
    return checks;
  };
}
export async function baselineHashes(runner: Runner, workspace: string): Promise<Record<string, string>> {
  const files = await runner('git', ['ls-files', '-z', '--', 'tests'], { cwd: workspace, timeoutMs: 20000, maxBytes: 1048576 }); check(files.exitCode === 0, 'Cannot inventory visual baselines');
  const hashes: Record<string, string> = {};
  for (const path of files.stdout.split('\0').filter(p => p.includes('-snapshots/') && p.endsWith('.png'))) hashes[path] = hash(await readFile(resolve(workspace, path)));
  return hashes;
}
export function reportBody(task: Task, changed: string[]): string {
  const checks = task.checks.map((c, index) => { const superseded = task.checks.slice(index + 1).some(later => later.log && later.log === c.log); return `- ${c.id}: ${c.status}, exit=${c.exitCode}, ${c.durationMs}ms; ${superseded ? 'legacy log filename was reused; original output no longer available (metadata retained)' : c.log}${c.reason ? `; ${c.reason}` : ''}`; }).join('\n');
  const recovery = task.verifications ?? task.events.filter(e => e.phase === 'recovery' && e.to === 'VALIDATING').length;
  const budgetStop = task.events.some(e => /token budget|token.*exhausted/i.test(e.summary));
  return `# ${task.candidate.title}\n\n## Summary\n${task.state === 'READY_FOR_REVIEW' ? '实现和本轮完整门禁通过，等待人工审核。' : '尚未完成，Draft / 需要人工审核。'}\n\n## Motivation\n${task.candidate.problem}\n\n## Related Issue\n${task.issue?.url ?? `本地Issue草稿 ${task.id}；未创建远程Issue。`}\n\n## Files Changed\n${changed.map(p => `- ${p}`).join('\n') || '暂无代码改动。'}\n\n## Test Results\n${checks || '未执行。'}\n\n## Visual Evidence\n普通比较，禁止更新基线。实际截图/基线/diff保留在隔离工作区test-results与Playwright报告；失败须人工审查。\n\n## Performance\n${task.plan?.requiresPerformance ? '需要同条件监控数据；缺失或明显退化会阻止READY。' : '本任务不改运行时；性能前后对比不适用，未宣称改善。'}\n\n## Risks\n${task.candidate.risks.join('\n')}\n最后错误：${task.lastError ?? '无'}\n\n## AI AUTOMATION REPORT\n状态=${task.state}；执行轮次=${task.rounds}；修复=${task.fixes}；已报告模型token=${task.tokens}（不代表美元成本）。\n人工重验=${recovery}；${budgetStop ? '曾因模型token预算停止并拒绝响应；后续重验不再调用模型，不应称为无人干预成功。' : '实际中断与恢复以本地状态审计为准。'}\n分支=${task.branch ?? '未创建'}；提交=${task.commit ?? '未提交'}。\n只有批准范围可写；不修改master/main、不自动合并、发布或改远程监控。人工仍需审查代码、视觉差异、设备/音效与设计判断。\n`;
}
