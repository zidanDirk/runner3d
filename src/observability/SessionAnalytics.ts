import type { GameView } from '../game/types';
import type { Monitor } from './Monitor';
import { distanceBand } from './schema';
/** Observes facts once at lifecycle edges; never sends per-tick positions or individual coins. */
export class SessionAnalytics {
  private previous = ''; private previousRun = -1; private starts = 0;
  constructor(private readonly monitor: Monitor, private readonly onStart: () => void = () => {}) {}
  observe(view: GameView, run: number, preview = false): void {
    if (preview) return;
    if (run === this.previousRun && view.status === this.previous) return;
    const old = this.previous; const changed = run !== this.previousRun;
    this.previous = view.status; this.previousRun = run;
    if (view.status === 'running' && (changed || old === 'ready' || old === '')) {
      this.monitor.track('RUN_STARTED', String(run), { run });
      if (this.starts++) this.monitor.track('RUN_RESTARTED', String(run), { run });
      this.onStart();
    } else if (view.status === 'paused') this.monitor.track('RUN_PAUSED', `${run}:${view.tick}`, { run });
    else if (view.status === 'running' && old === 'paused') this.monitor.track('RUN_RESUMED', `${run}:${view.tick}`, { run });
    else if (view.status === 'over') this.monitor.track('RUN_ENDED', String(run), {
      run, distanceMeters: Math.floor(view.distance), distanceBand: distanceBand(view.distance), durationSeconds: Math.round(view.tick / 120), coins: view.coins,
      obstacle: view.hit ?? 'unknown', usedPowerup: view.powerupsCollected > 0,
    });
  }
}
