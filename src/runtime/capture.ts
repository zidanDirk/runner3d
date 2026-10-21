import { withPreviewProgression } from './progression';
import { RULES } from '../game/config';
import { game } from './store';
import { city, syncCity } from './city';
import { feedback } from './feedback';
import { effectPalette } from '../effects/theme';
import { motionPreferences } from './motion-preferences';

/** Dynamically imported only by e2e or explicit DEV testMode; production strips both entries. */
export function installCaptureHooks() {
  let frozen = false;
  let automatic = false;
  let stressSequence = 0;
  const driveFrame = () => {
    if (!automatic || frozen || game.view.status !== 'running') return;
    const state = game.view;
    const row = state.rows.find((candidate) => candidate.distance >= state.distance - 2);
    if (row && row.safeLane !== state.player.lane) game.dispatch(row.safeLane < state.player.lane ? 'left' : 'right');
  };
  const advanceTo = (distance: number) => {
    if (!Number.isFinite(distance) || distance < game.view.distance || distance > 10000) throw new Error('Advance distance must be current..10000m');
    return withPreviewProgression(() => feedback.withQuiet(() => {
    frozen = true;
    while (game.view.distance < distance && game.view.status === 'running') {
      const state = game.view;
      const row = state.rows.find((candidate) => candidate.distance >= state.distance - 2);
      if (row && row.safeLane !== state.player.lane) game.dispatch(row.safeLane < state.player.lane ? 'left' : 'right');
      game.advance(RULES.fixedDt);
      syncCity();
    }
    if (game.view.status !== 'running') throw new Error(`Capture route collided at ${game.view.distance}m`);
    game.pause(); game.resume(); syncCity();
    return { seed: game.view.seed, distance: game.view.distance, tick: game.view.tick, chunk: city.snapshot.currentChunk };
  }));
  };
  window.__RUNNER_TEST__ = {
    read: () => game.view,
    freeze: (value: boolean) => { frozen = value; },
    autopilot: (value: boolean) => { automatic = value; if (value) frozen = false; },
    advanceTo,
    stepTicks: (count: number) => {
      if (!Number.isSafeInteger(count) || count < 1 || count > 1200) throw new Error('Capture ticks must be 1..1200');
      frozen = true;
      automatic = false;
      for (let i = 0; i < count && game.view.status === 'running'; i++) { game.advance(RULES.fixedDt); syncCity(); }
      return { seed: game.view.seed, distance: game.view.distance, tick: game.view.tick, chunk: city.snapshot.currentChunk };
    },
    stepFeedback: (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds < 0 || seconds > 2) throw new Error('Feedback tail step must be 0..2s');
      for (let remaining = seconds; remaining > 1e-8; remaining -= RULES.fixedDt) feedback.advancePost(Math.min(remaining, RULES.fixedDt));
      return feedback.diagnostics();
    },
    // Explicit synthetic visual/audio load probe. It does not enter the real event timeline.
    stressEffects: (count: number) => {
      if (!Number.isSafeInteger(count) || count < 1 || count > 256) throw new Error('Synthetic stress count must be 1..256');
      const view = game.view; const palette = effectPalette(view.distance);
      const runId = feedback.diagnostics().recent.at(-1)?.runId ?? 0;
      const sequence = ++stressSequence;
      for (let i = 0; i < count; i++) {
        const type = (['coin', 'jump', 'land'] as const)[i % 3] ?? 'coin';
        const base = { id: `synthetic:${sequence}:${view.tick}:${i}`, runId, tick: view.tick, time: view.tick * RULES.fixedDt, distance: view.distance, position: [view.player.x, type === 'coin' ? 1.075 : .05, 0] as const, intensity: 1 };
        const event = type === 'coin' ? { ...base, type, total: view.coins, entityId: `synthetic-${i}` } : { ...base, type };
        feedback.effects.handle(event, palette, motionPreferences.getSnapshot()); feedback.audio.handle(event, palette);
      }
      return feedback.diagnostics();
    },
    captureAt: (seed: string, distance: number) => {
      if (!Number.isFinite(distance) || distance < 0 || distance > 10000) throw new Error('Capture distance must be 0..10000m');
      return withPreviewProgression(() => {
      frozen = true;
      automatic = false;
      game.restart(seed);
      // Drive the real fixed-step engine; no direct state or score injection.
      return advanceTo(distance);
      });
    },
  };
  return {
    isFrozen: () => frozen,
    driveFrame,
    dispose: () => { delete window.__RUNNER_TEST__; },
  };
}
