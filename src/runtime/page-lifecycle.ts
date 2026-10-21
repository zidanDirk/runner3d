import { feedback } from './feedback';
import { input } from './input';
import { game } from './store';

export interface PageLifecycleDependencies {
  readonly window: EventTarget;
  readonly document: EventTarget & { readonly hidden: boolean };
  readonly game: { pause(): void };
  readonly input: { clear(): void };
  readonly audio: { setPaused(value: boolean): void };
}

/** Returning from BFCache or background requires an explicit user resume. */
export function attachPageLifecycle(dependencies: PageLifecycleDependencies = {
  window, document, game, input, audio: feedback.audio,
}): () => void {
  const suspend = (): void => {
    dependencies.input.clear();
    dependencies.game.pause();
    dependencies.audio.setPaused(true);
  };
  const visibility = (): void => { if (dependencies.document.hidden) suspend(); };
  dependencies.window.addEventListener('blur', suspend);
  dependencies.window.addEventListener('pagehide', suspend);
  dependencies.window.addEventListener('pageshow', suspend);
  dependencies.document.addEventListener('visibilitychange', visibility);
  if (dependencies.document.hidden) suspend();
  return () => {
    dependencies.window.removeEventListener('blur', suspend);
    dependencies.window.removeEventListener('pagehide', suspend);
    dependencies.window.removeEventListener('pageshow', suspend);
    dependencies.document.removeEventListener('visibilitychange', visibility);
  };
}
