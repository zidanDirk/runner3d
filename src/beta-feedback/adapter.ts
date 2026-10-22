import { formatFeedback, validateFeedback } from './schema';
import type { FeedbackPayload } from './schema';

export type FeedbackAdapterResult = { readonly status: 'manual'; readonly text: string } | { readonly status: 'accepted' };
/** A future remote implementation must define destination, consent, retention and failure behavior first. */
export interface FeedbackAdapter {
  readonly mode: 'manual' | 'remote';
  submit(payload: FeedbackPayload): Promise<FeedbackAdapterResult>;
}

export const manualFeedbackAdapter: FeedbackAdapter = Object.freeze({
  mode: 'manual',
  submit: async (payload: FeedbackPayload): Promise<FeedbackAdapterResult> => ({ status: 'manual', text: formatFeedback(payload) }),
});

export type FeedbackSubmissionResult = FeedbackAdapterResult
  | { readonly status: 'invalid' | 'failure'; readonly error: string }
  | { readonly status: 'busy' }
  | { readonly status: 'duplicate'; readonly text?: string };

/** At most one request and one completed draft are remembered; no storage or background retry. */
export class FeedbackSubmission {
  private inFlight = false;
  private completedKey: string | null = null;

  constructor(private readonly adapter: FeedbackAdapter = manualFeedbackAdapter) {}

  async submit(category: unknown, message: unknown, diagnostics?: unknown, release?: unknown): Promise<FeedbackSubmissionResult> {
    const validation = validateFeedback(category, message, diagnostics, release);
    if (!validation.valid) return { status: 'invalid', error: validation.error };
    if (this.inFlight) return { status: 'busy' };
    const key = JSON.stringify(validation.payload);
    if (key === this.completedKey) return { status: 'duplicate', ...(this.adapter.mode === 'manual' ? { text: formatFeedback(validation.payload) } : {}) };
    this.inFlight = true;
    try {
      const result = await this.adapter.submit(validation.payload);
      if (this.adapter.mode === 'manual') {
        // Local preparation can never be mistaken for server acceptance.
        this.completedKey = key;
        return { status: 'manual', text: formatFeedback(validation.payload) };
      }
      if (result.status !== 'accepted') return { status: 'failure', error: '接收服务未确认，请稍后重试或使用手动反馈。' };
      this.completedKey = key;
      return { status: 'accepted' };
    } catch {
      return { status: 'failure', error: '反馈未发送，内容仍保留在本页。请重试或使用手动反馈。' };
    } finally {
      this.inFlight = false;
    }
  }
}
