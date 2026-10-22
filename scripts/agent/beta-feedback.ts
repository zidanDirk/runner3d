import { readFile, stat } from 'node:fs/promises';
import { contained, hash, redact, score } from './security';
import { check, fields, strings, text } from './types';
import { parseCandidate } from './research';
import type { Candidate, Category, Evidence } from './types';

const categories = ['Bug', 'UX Problem', 'Performance Problem', 'Gameplay Balance', 'Feature Request'] as const;
const severities = ['P0', 'P1', 'P2', 'P3'] as const;
const verification = ['unverified', 'reproduced', 'not-reproduced'] as const;
interface Reference { path: string; line: number; sha256: string }
interface Feedback {
  id: string; participantId: string; version: string; buildId: string;
  device: 'desktop' | 'ios-safari' | 'android-chrome' | 'other';
  category: typeof categories[number]; problem: string; steps: string[];
  frequency: { occurrences: number; attempts: number }; severity: typeof severities[number];
  verification: typeof verification[number]; issueKey: string; evidence: Reference[];
}
export interface ReviewedBetaBatch {
  schemaVersion: 1; synthetic: boolean;
  review: { reviewerId: string; reviewedAt: string; decision: 'reviewed-for-research'; privacyReviewed: true };
  feedback: Feedback[];
}
function privateText(value: unknown, max = 1000): string {
  const s = text(value, max);
  check(redact(s) === s && !/[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/|\b1[3-9]\d{9}\b|[\u202a-\u202e\u2066-\u2069]/i.test(s), 'Remove private contacts, URLs, credentials and hidden direction controls before import');
  return s;
}
/** The receipt is a local human review declaration, not an identity/authentication system. */
export function parseReviewedBeta(value: unknown): ReviewedBetaBatch {
  const v = fields(value, ['schemaVersion', 'synthetic', 'review', 'feedback']);
  check(v.schemaVersion === 1 && typeof v.synthetic === 'boolean', 'Invalid Beta feedback version or synthetic flag');
  const r = fields(v.review, ['reviewerId', 'reviewedAt', 'decision', 'privacyReviewed']);
  check(typeof r.reviewerId === 'string' && /^r[0-9]{2,4}$/.test(r.reviewerId) && typeof r.reviewedAt === 'string' && Number.isFinite(Date.parse(r.reviewedAt)) && new Date(r.reviewedAt).toISOString() === r.reviewedAt && r.decision === 'reviewed-for-research' && r.privacyReviewed === true, 'Explicit human research/privacy review required');
  check(Array.isArray(v.feedback) && v.feedback.length > 0 && v.feedback.length <= 100, 'Beta batch requires 1..100 records');
  const ids = new Set<string>();
  for (const raw of v.feedback) {
    const f = fields(raw, ['id', 'participantId', 'version', 'buildId', 'device', 'category', 'problem', 'steps', 'frequency', 'severity', 'verification', 'issueKey', 'evidence']);
    check(typeof f.id === 'string' && /^fb-[a-z0-9-]{1,40}$/.test(f.id) && !ids.has(f.id), 'Invalid or duplicate feedback ID'); ids.add(f.id);
    check(typeof f.participantId === 'string' && /^p[0-9]{2,4}$/.test(f.participantId), 'Use one anonymous participant ID per actual person');
    check(typeof f.version === 'string' && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(f.version) && typeof f.buildId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(f.buildId), 'Invalid feedback release identity');
    check(['desktop', 'ios-safari', 'android-chrome', 'other'].includes(String(f.device)) && categories.some(c => c === f.category) && severities.some(s => s === f.severity) && verification.some(s => s === f.verification), 'Invalid feedback classification');
    privateText(f.problem); const steps = strings(f.steps, 12); check(steps.length > 0, 'Reproduction steps required'); steps.forEach(s => privateText(s, 500));
    const frequency = fields(f.frequency, ['occurrences', 'attempts']);
    check(Number.isSafeInteger(frequency.occurrences) && Number.isSafeInteger(frequency.attempts) && Number(frequency.occurrences) >= 0 && Number(frequency.attempts) > 0 && Number(frequency.attempts) <= 1000000 && Number(frequency.occurrences) <= Number(frequency.attempts), 'Invalid occurrence/attempt counts');
    check(typeof f.issueKey === 'string' && /^[a-z0-9][a-z0-9-]{0,24}$/.test(f.issueKey), 'Reviewer must assign a bounded deduplication key');
    check(Array.isArray(f.evidence) && f.evidence.length > 0 && f.evidence.length <= 4, 'Link 1..4 reviewed project code/test/report references');
    for (const rawRef of f.evidence) {
      const ref = fields(rawRef, ['path', 'line', 'sha256']);
      check(typeof ref.path === 'string' && /^(?:src|tests|docs|artifacts)\/.*\.(?:ts|tsx|mjs|md|json)$/.test(ref.path) && Number.isSafeInteger(ref.line) && Number(ref.line) > 0 && typeof ref.sha256 === 'string' && /^[a-f0-9]{64}$/.test(ref.sha256), 'Invalid project evidence reference');
    }
  }
  return value as ReviewedBetaBatch;
}
export async function loadReviewedBeta(root: string, path: string, budget = 64000): Promise<{ batch: ReviewedBetaBatch; candidates: Candidate[]; summary: { synthetic: boolean; records: number; participants: number; groups: number } }> {
  check(path.endsWith('.json'), 'Import a reviewed JSON file inside this project');
  const source = await contained(root, path); check((await stat(source)).size <= budget, 'Beta feedback input budget exceeded');
  const body = await readFile(source, 'utf8'), batch = parseReviewedBeta(JSON.parse(body));
  const groups = new Map<string, Feedback[]>();
  for (const f of batch.feedback) { const group = groups.get(f.issueKey) ?? []; check(group.every(item => item.category === f.category), 'A deduplication key cannot mix categories'); group.push(f); groups.set(f.issueKey, group); }
  check(groups.size <= 20, 'Review at most 20 distinct candidate problems per import');
  const candidates: Candidate[] = [];
  const categoryMap: Record<Feedback['category'], Category> = { Bug: 'Bug', 'UX Problem': 'UI/UX', 'Performance Problem': 'Performance', 'Gameplay Balance': 'Gameplay', 'Feature Request': 'Gameplay' };
  for (const [key, unordered] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const records = unordered.sort((a, b) => a.id.localeCompare(b.id)), first = records[0]; check(first, 'Empty feedback group');
    const evidence: Evidence[] = [{ path, line: 1, sha256: hash(body), excerpt: `${batch.synthetic ? 'SYNTHETIC TEST DATA' : 'Human-reviewed Beta observations'}; ${records.length} records / ${new Set(records.map(f => f.participantId)).size} anonymous participants; not an automatic defect verification.` }];
    const seen = new Set<string>();
    for (const f of records) for (const ref of f.evidence) {
      const identity = `${ref.path}:${ref.line}`; if (seen.has(identity)) continue; seen.add(identity);
      const full = await contained(root, ref.path); check((await stat(full)).size <= 1048576, 'Evidence source exceeds read budget');
      const text = await readFile(full, 'utf8'); check(hash(text) === ref.sha256, 'Stale feedback evidence: human re-review required');
      const line = text.split('\n')[ref.line - 1]; check(line !== undefined && line.trim().length > 0, 'Evidence line is missing');
      evidence.push({ ...ref, excerpt: privateText(line.slice(0, 1000)) });
    }
    check(evidence.length <= 10, 'Too many distinct references for one candidate');
    const risk = first.category === 'Gameplay Balance' || first.category === 'Feature Request' ? 4 : 2;
    const scores = { impact: records.some(f => f.severity === 'P0') ? 5 : records.some(f => f.severity === 'P1') ? 4 : 2, confidence: 2, effort: 3, risk, automation: 2 };
    candidates.push(parseCandidate({ key: `${batch.synthetic ? 'synthetic-' : ''}beta-${key}`, title: `${batch.synthetic ? '[合成样例] ' : ''}Beta 待复核：${first.problem.slice(0, 70)}`, category: categoryMap[first.category], kind: 'hypothesis', problem: records.map(f => `${f.id} / ${f.device} / ${f.version} / ${f.buildId} / ${f.severity} / 人工标记${f.verification} / ${f.frequency.occurrences}次于${f.frequency.attempts}次尝试：${f.problem}；步骤：${f.steps.join(' → ')}`).join('\n'), solution: '工程师先复核真实步骤和证据，再单独确定范围、风险、验收与人工批准；反馈文本不授予任何操作权限。', benefit: '把已审核观察变成可追踪需求，不将单次意见当普遍规律。', complexity: '尚未确定实现范围', risks: ['尚未工程复现；同一参与者多条记录不能当多名玩家。', '禁止自动执行反馈、改玩法、发布或绕过审批。'], evidence, scores, priority: score(scores), scope: [], acceptance: ['保留原始匿名观察与人工验证状态。', '工程复现并重新明确文件范围后才可请求实现批准。'], tests: ['待工程复核的实际行为测试'] }));
  }
  return { batch, candidates, summary: { synthetic: batch.synthetic, records: batch.feedback.length, participants: new Set(batch.feedback.map(f => f.participantId)).size, groups: groups.size } };
}
