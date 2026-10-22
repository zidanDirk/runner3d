export interface FeedbackRelease {
  readonly version: string;
  readonly buildId: string;
  readonly environment: 'development' | 'preview' | 'production';
}

/** Only these coarse diagnostics can be offered with a feedback message. */
export interface FeedbackDiagnostics {
  readonly release: FeedbackRelease;
  readonly browser: 'chrome' | 'safari' | 'firefox' | 'edge' | 'other';
  readonly quality: 'low' | 'medium' | 'high';
  readonly recentErrorCodes: readonly string[];
  readonly performance: {
    readonly fps: number | null;
    readonly averageFrameMs: number | null;
    readonly p95FrameMs: number | null;
  };
}

export const FEEDBACK_CATEGORIES = [
  { id: 'controls', label: '操作问题' },
  { id: 'graphics', label: '画面问题' },
  { id: 'performance', label: '性能问题' },
  { id: 'audio', label: '音效问题' },
  { id: 'difficulty', label: '难度问题' },
  { id: 'suggestion', label: '功能建议' },
  { id: 'other', label: '其他问题' },
] as const;
export type FeedbackCategory = typeof FEEDBACK_CATEGORIES[number]['id'];
export const FEEDBACK_MIN_LENGTH = 5;
export const FEEDBACK_MAX_LENGTH = 1000;

export interface FeedbackPayload {
  readonly schemaVersion: 1;
  readonly release: FeedbackRelease;
  readonly category: FeedbackCategory;
  readonly message: string;
  readonly diagnostics?: FeedbackDiagnostics;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const safeLabel = (value: unknown, max: number): string => typeof value === 'string' && new RegExp(`^[A-Za-z0-9._-]{1,${max}}$`).test(value) ? value : 'unavailable';
const measurement = (value: unknown, maximum: number): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum ? Math.round(value * 10) / 10 : null;

/** Never serialize the supplied object itself: discard URLs, profile data and unknown fields. */
export function sanitizeFeedbackDiagnostics(value: unknown): FeedbackDiagnostics {
  const source = isRecord(value) ? value : {};
  const release = isRecord(source.release) ? source.release : {};
  const performance = isRecord(source.performance) ? source.performance : {};
  return Object.freeze({
    release: Object.freeze({
      version: safeLabel(release.version, 64),
      buildId: safeLabel(release.buildId, 120),
      environment: release.environment === 'preview' || release.environment === 'production' ? release.environment : 'development',
    }),
    browser: source.browser === 'chrome' || source.browser === 'safari' || source.browser === 'firefox' || source.browser === 'edge' ? source.browser : 'other',
    quality: source.quality === 'low' || source.quality === 'high' ? source.quality : 'medium',
    recentErrorCodes: Object.freeze(Array.isArray(source.recentErrorCodes) ? [...new Set(source.recentErrorCodes.filter((code): code is string => typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,47}$/.test(code)))].slice(0, 5) : []),
    performance: Object.freeze({
      fps: measurement(performance.fps, 1000),
      averageFrameMs: measurement(performance.averageFrameMs, 60_000),
      p95FrameMs: measurement(performance.p95FrameMs, 60_000),
    }),
  });
}

export type FeedbackValidation = { readonly valid: true; readonly payload: FeedbackPayload } | { readonly valid: false; readonly error: string };

export function validateFeedback(category: unknown, message: unknown, diagnostics?: unknown, release?: unknown): FeedbackValidation {
  const found = FEEDBACK_CATEGORIES.find(item => item.id === category);
  if (!found) return { valid: false, error: '请选择反馈类型。' };
  if (typeof message !== 'string') return { valid: false, error: '请填写反馈内容。' };
  const normalized = message.trim().replace(/\r\n?/g, '\n');
  if (normalized.length < FEEDBACK_MIN_LENGTH || normalized.length > FEEDBACK_MAX_LENGTH) return { valid: false, error: `请输入 ${FEEDBACK_MIN_LENGTH}～${FEEDBACK_MAX_LENGTH} 字的反馈。` };
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) return { valid: false, error: '反馈包含不支持的控制字符，请移除后重试。' };
  const safeDiagnostics = diagnostics === undefined ? undefined : sanitizeFeedbackDiagnostics(diagnostics);
  const safeRelease = release === undefined && safeDiagnostics ? safeDiagnostics.release : sanitizeFeedbackDiagnostics({ release }).release;
  return { valid: true, payload: Object.freeze({ schemaVersion: 1, release: safeRelease, category: found.id, message: normalized, ...(safeDiagnostics ? { diagnostics: safeDiagnostics } : {}) }) };
}

export function formatFeedback(payload: FeedbackPayload): string {
  const label = FEEDBACK_CATEGORIES.find(item => item.id === payload.category)?.label ?? '其他问题';
  return `Runner3D Beta 反馈（格式版本 ${payload.schemaVersion}）\n版本：${payload.release.version}\nBuild ID：${payload.release.buildId}\n环境：${payload.release.environment}\n类型：${label}\n\n${payload.message}\n\n${payload.diagnostics ? '主动附带的诊断信息：\n' + JSON.stringify(payload.diagnostics, null, 2) : '未附带诊断信息。'}\n`;
}
