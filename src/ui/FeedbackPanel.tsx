import { useState } from 'react';
import { BetaFeedback } from './BetaFeedback';
import { monitor, browser } from '../observability/client';
import { quality } from '../runtime/quality';
import { releaseInfo } from '../release/info';
import type { FeedbackDiagnostics } from '../beta-feedback/schema';
export function FeedbackPanel() {
  // Snapshot on opening, so the visible payload cannot change during composition.
  const [diagnostics] = useState<FeedbackDiagnostics>(() => {
    const snapshot = monitor.getSnapshot();
    const sampled = snapshot.events.filter(event => event.kind === 'performance').at(-1);
    const p = sampled?.context.quality === quality.getSnapshot().level ? snapshot.performance : null;
    return { release: releaseInfo, browser, quality: quality.getSnapshot().level,
      recentErrorCodes: snapshot.events.flatMap(event => event.kind === 'error' ? [event.code] : []).slice(-5),
      performance: { fps: p?.fps ?? null, averageFrameMs: p?.averageFrameMs ?? null, p95FrameMs: p?.p95FrameMs ?? null } };
  });
  return <BetaFeedback diagnostics={diagnostics} />;
}
