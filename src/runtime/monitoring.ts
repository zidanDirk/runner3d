import { useSyncExternalStore } from 'react';
import { monitor, browser } from '../observability/client';
import { SessionAnalytics } from '../observability/SessionAnalytics';
import { game } from './store';
import { quality } from './quality';
import { loading } from '../assets/loading';
import { feedback } from './feedback';
import { profile } from './profile';
export { monitor } from '../observability/client';
export const useMonitoring = () => useSyncExternalStore(monitor.subscribe, monitor.getSnapshot, monitor.getSnapshot);
let launchAt: number | undefined;
let navigationSerial = 0;
export function markLaunch(): void { launchAt = performance.now(); }
export function trackPanel(panel: string): void {
  if (panel === 'shop') monitor.track('SHOP_OPENED', String(++navigationSerial));
  if (panel === 'tutorial') monitor.track('TUTORIAL_STARTED', String(++navigationSerial));
}
const sessions = new SessionAnalytics(monitor, () => {
  if (!Object.hasOwn(monitor.getSnapshot().timings, 'timeToPlayMs')) monitor.timing('timeToPlayMs', performance.now());
  if (launchAt !== undefined) { monitor.timing('homeToPlayMs', performance.now() - launchAt); launchAt = undefined; }
});
let pageSerial = 0;
/** Root-owned subscriptions; no new gameplay loop, timers or network dependency. */
export function attachMonitoring(): () => void {
  const context = (): void => monitor.setContext({ browser, device: matchMedia('(pointer: coarse)').matches ? 'mobile' : 'desktop', quality: quality.getSnapshot().level, gameState: game.view.status === 'ready' ? 'home' : game.view.status });
  context(); monitor.track('APP_OPENED', 'page');
  if (profile.recovered) monitor.error('PROFILE_INVALID');
  if (profile.unsupportedSchema) monitor.error('PROFILE_FUTURE');
  let status = ''; let run = -1;
  const stopGame = game.observe(view => {
    if (view.status === status && game.runId === run) return;
    status = view.status; run = game.runId;
    context(); sessions.observe(view, game.runId, game.isPreview);
  });
  const stopQuality = quality.subscribe(context);
  const pending = new Map<string, number>();
  const loaded = new Set<string>();
  const assets = (): void => {
    const snapshot = loading.getSnapshot();
    for (const id of snapshot.pending) if (!pending.has(id)) pending.set(id, performance.now());
    for (const id of snapshot.requested) if (loading.status(id) === 'loaded' && !loaded.has(id)) {
      loaded.add(id); const start = pending.get(id); if (start !== undefined) monitor.timing(`glb:${id}`, performance.now() - start); pending.delete(id);
    }
    for (const error of snapshot.errors) monitor.error(error.kind === 'timeout' ? 'GLB_TIMEOUT' : error.kind === 'validation' ? 'GLB_VALIDATION' : 'GLB_LOAD', { assetId: error.id });
    if (snapshot.rendererError) monitor.error('WEBGL_INIT');
    if (snapshot.ready) { monitor.track('GAME_READY', 'page'); if (!Object.hasOwn(monitor.getSnapshot().timings, 'coreReadyMs')) monitor.timing('coreReadyMs', performance.now()); }
  };
  const stopLoading = loading.subscribe(assets); assets();
  let audioErrors = feedback.audio.diagnostics().errors;
  const stopAudio = feedback.audio.subscribe(() => { const count = feedback.audio.diagnostics().errors; if (count > audioErrors) monitor.error('AUDIO_INIT'); audioErrors = count; });
  const visibility = (): void => monitor.track(document.hidden ? 'PAGE_HIDDEN' : 'PAGE_VISIBLE', String(++pageSerial));
  const ended = (): void => { monitor.track('PAGE_ENDED', String(++pageSerial)); void monitor.flush(navigator.onLine); };
  document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', ended);
  const timer = window.setInterval(() => { void monitor.flush(navigator.onLine); }, 30000);
  if (import.meta.env.MODE === 'e2e') window.__BETA_MONITOR__ = monitor.getSnapshot;
  return () => { stopGame(); stopQuality(); stopLoading(); stopAudio(); clearInterval(timer); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', ended); if (import.meta.env.MODE === 'e2e') delete window.__BETA_MONITOR__; };
}
