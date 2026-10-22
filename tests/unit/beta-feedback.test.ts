import { describe, expect, it, vi } from 'vitest';
import { FEEDBACK_CATEGORIES, FEEDBACK_MAX_LENGTH, formatFeedback, sanitizeFeedbackDiagnostics, validateFeedback } from '../../src/beta-feedback/schema';
import { FeedbackSubmission, manualFeedbackAdapter } from '../../src/beta-feedback/adapter';
import type { FeedbackAdapter, FeedbackAdapterResult } from '../../src/beta-feedback/adapter';

const diagnostics = {
  release: { version: '0.14.0-beta', buildId: 'preview-0123456', environment: 'preview' },
  browser: 'chrome', quality: 'medium', recentErrorCodes: ['GLB_LOAD_FAILED'],
  performance: { fps: 59.987, averageFrameMs: 16.674, p95FrameMs: 18.124 },
};

describe('Beta feedback validation and data minimization', () => {
  it.each(FEEDBACK_CATEGORIES)('accepts the $id category and normalizes line endings', ({ id }) => {
    const result = validateFeedback(id, '  在手机上\r\n跳跃按钮没有响应。  ');
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('Expected valid feedback');
    expect(result.payload).toEqual({ schemaVersion: 1, release: { version: 'unavailable', buildId: 'unavailable', environment: 'development' }, category: id, message: '在手机上\n跳跃按钮没有响应。' });
    expect(Object.isFrozen(result.payload)).toBe(true);
    expect(result.payload).not.toHaveProperty('diagnostics');
  });

  it('rejects unknown categories, wrong types, whitespace, controls and oversized drafts', () => {
    for (const [category, message] of [['unregistered', '描述足够长。'], ['audio', undefined], ['audio', '    '], ['audio', 'abcd'], ['audio', '有效描述\u0000控制字符'], ['audio', 'x'.repeat(FEEDBACK_MAX_LENGTH + 1)]]) {
      expect(validateFeedback(category, message).valid).toBe(false);
    }
    expect(validateFeedback('audio', 'x'.repeat(FEEDBACK_MAX_LENGTH)).valid).toBe(true);
  });

  it('includes only opt-in whitelisted diagnostics and removes identifying values and unknown keys', () => {
    const raw = {
      ...diagnostics, url: 'https://private.invalid/?email=person@example.com', profile: { walletCoins: 500 }, userAgent: 'unique user agent',
      release: { ...diagnostics.release, secret: 'credential' },
      recentErrorCodes: ['GLB_LOAD_FAILED', 'GLB_LOAD_FAILED', 'private@example.com', 'https://private.invalid', 'PROFILE_WRITE_FAILED'],
      performance: { ...diagnostics.performance, gpuMemory: 999, exactPosition: [1, 2, 3] },
    };
    const result = validateFeedback('graphics', '模型偶尔无法显示。', raw);
    expect(result.valid).toBe(true);
    if (!result.valid) throw new Error('Expected valid feedback');
    expect(result.payload.diagnostics).toEqual({
      release: diagnostics.release, browser: 'chrome', quality: 'medium', recentErrorCodes: ['GLB_LOAD_FAILED', 'PROFILE_WRITE_FAILED'],
      performance: { fps: 60, averageFrameMs: 16.7, p95FrameMs: 18.1 },
    });
    const encoded = JSON.stringify(result.payload);
    for (const removed of ['person@example.com', 'credential', 'walletCoins', 'unique user agent', 'gpuMemory', 'exactPosition']) expect(encoded).not.toContain(removed);
    expect(Object.isFrozen(result.payload.diagnostics?.release)).toBe(true);
    expect(raw.profile.walletCoins).toBe(500);
  });

  it('does not accept URLs or messages as release identifiers and limits recent codes', () => {
    const safe = sanitizeFeedbackDiagnostics({
      ...diagnostics, release: { version: 'https://secret.invalid', buildId: 'someone@example.com', environment: 'unknown' },
      recentErrorCodes: ['A', 'A0', 'B0', 'C0', 'D0', 'E0', 'F0', 'mixedCase'],
      performance: { fps: Infinity, averageFrameMs: NaN, p95FrameMs: -1 },
    });
    expect(safe.release).toEqual({ version: 'unavailable', buildId: 'unavailable', environment: 'development' });
    expect(safe.recentErrorCodes).toEqual(['A0', 'B0', 'C0', 'D0', 'E0']);
    expect(safe.performance).toEqual({ fps: null, averageFrameMs: null, p95FrameMs: null });
    expect(sanitizeFeedbackDiagnostics(null).browser).toBe('other');
    expect(sanitizeFeedbackDiagnostics({ performance: { fps: 10_000, averageFrameMs: '17', p95FrameMs: 60_001 } }).performance).toEqual({ fps: null, averageFrameMs: null, p95FrameMs: null });
  });

  it('offers exactly the opted-in draft and visible diagnostics in plain text', async () => {
    const input = validateFeedback('difficulty', '前期速度偏快，很难避开。', diagnostics);
    if (!input.valid) throw new Error('Expected valid feedback');
    const result = await manualFeedbackAdapter.submit(input.payload);
    expect(result.status).toBe('manual');
    if (result.status !== 'manual') throw new Error('Manual adapter must not claim acceptance');
    expect(result.text).toBe(formatFeedback(input.payload));
    expect(result.text).toContain('类型：难度问题');
    expect(result.text).toContain('前期速度偏快，很难避开。');
    expect(result.text).toContain('0.14.0-beta');
    expect(result.text).not.toContain('已提交');
    const without = validateFeedback('other', '希望有更清楚的说明。');
    if (!without.valid) throw new Error('Expected valid feedback');
    expect(formatFeedback(without.payload)).toContain('未附带诊断信息。');
    expect(formatFeedback(without.payload)).not.toContain('GLB_LOAD_FAILED');
  });

  it('can associate a build without attaching optional diagnostics', () => {
    const result = validateFeedback('other', '希望有更清楚的说明。', undefined, diagnostics.release);
    if (!result.valid) throw new Error('Expected valid feedback');
    expect(result.payload.release).toEqual(diagnostics.release);
    expect(result.payload).not.toHaveProperty('diagnostics');
    expect(formatFeedback(result.payload)).toContain('Build ID：preview-0123456');
    expect(formatFeedback(result.payload)).toContain('未附带诊断信息。');
  });
});

describe('replaceable feedback adapter and bounded submission', () => {
  it('defaults to local preparation and returns a recoverable duplicate draft', async () => {
    const submission = new FeedbackSubmission();
    const first = await submission.submit('controls', '左右操作有点难掌握。');
    expect(first.status).toBe('manual');
    const second = await submission.submit('controls', '左右操作有点难掌握。');
    expect(second.status).toBe('duplicate');
    if (first.status === 'manual' && second.status === 'duplicate') expect(second.text).toBe(first.text);
    expect((await submission.submit('controls', '左右操作有点难掌握。希望加提示。')).status).toBe('manual');
  });

  it('prevents concurrent and repeated successful remote submissions', async () => {
    let finish: ((value: FeedbackAdapterResult) => void) | undefined;
    const submit = vi.fn(() => new Promise<FeedbackAdapterResult>(resolve => { finish = resolve; }));
    const adapter: FeedbackAdapter = { mode: 'remote', submit };
    const submission = new FeedbackSubmission(adapter);
    const first = submission.submit('audio', '落地声音有点太响了。');
    expect((await submission.submit('audio', '落地声音有点太响了。')).status).toBe('busy');
    expect(submit).toHaveBeenCalledTimes(1);
    finish?.({ status: 'accepted' });
    expect((await first).status).toBe('accepted');
    expect((await submission.submit('audio', '落地声音有点太响了。')).status).toBe('duplicate');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('keeps failed drafts retryable and never displays arbitrary exception data', async () => {
    const submit = vi.fn<FeedbackAdapter['submit']>().mockRejectedValueOnce(new Error('secret@example.com private payload')).mockResolvedValue({ status: 'accepted' });
    const submission = new FeedbackSubmission({ mode: 'remote', submit });
    const first = await submission.submit('performance', '玩一会儿以后出现明显卡顿。');
    expect(first.status).toBe('failure');
    expect(JSON.stringify(first)).not.toContain('secret@example.com');
    expect((await submission.submit('performance', '玩一会儿以后出现明显卡顿。')).status).toBe('accepted');
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid feedback before invoking adapters and never treats local output as remote acceptance', async () => {
    const submit = vi.fn<FeedbackAdapter['submit']>().mockResolvedValue({ status: 'manual', text: 'untrusted response' });
    const submission = new FeedbackSubmission({ mode: 'remote', submit });
    expect((await submission.submit('other', '')).status).toBe('invalid');
    expect(submit).not.toHaveBeenCalled();
    expect((await submission.submit('other', '希望增加操作说明。')).status).toBe('failure');
    expect((await submission.submit('other', '希望增加操作说明。')).status).toBe('failure');
    expect(submit).toHaveBeenCalledTimes(2);
    const manual = new FeedbackSubmission({ mode: 'manual', submit: async () => ({ status: 'accepted' }) });
    expect((await manual.submit('other', '希望增加操作说明。')).status).toBe('manual');
  });
});
