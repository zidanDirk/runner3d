import { RULES, laneX } from '../game/config';
import type { GameView } from '../game/types';
import type { FeedbackEvent, FeedbackKind } from './types';

/** Observes each completed fixed tick, never animation completion or input intent. */
export class FeedbackEventSource {
  private view: GameView | undefined;
  private runId = 0;
  private tick = 0;
  private y = 0;
  private velocityY = 0;
  private slide = 0;
  private lane = 1;
  private coins = 0;
  private speed: number = RULES.baseSpeed;
  private over = false;
  private readonly collected = new Set<string>();

  get identity(): number { return this.runId; }

  reset(view: GameView): void {
    if (view !== this.view) this.runId++;
    this.view = view;
    this.collected.clear();
    for (const entity of view.entities) if (entity.collected) this.collected.add(entity.id);
    this.commit(view);
  }

  observe(view: GameView, emit: (event: FeedbackEvent) => void, silent = false): void {
    if (view !== this.view || view.tick < this.tick) { this.reset(view); return; }
    if (view.tick === this.tick) return;
    if (silent || view.tick !== this.tick + 1) { this.reset(view); return; }
    const p = view.player;
    const base = (type: FeedbackKind, position: readonly [number, number, number], intensity = 1) => ({
      id: `${this.runId}:${view.tick}:${type}`, runId: this.runId, tick: view.tick,
      time: view.tick * RULES.fixedDt, distance: view.distance, position, intensity,
    });
    if (view.coins > this.coins) {
      let total = this.coins;
      for (const entity of view.entities) {
        if (entity.kind !== 'coin' || !entity.collected || this.collected.has(entity.id)) continue;
        this.collected.add(entity.id);
        const context = base('coin', [laneX(entity.lane), 1.075, view.distance - entity.distance]);
        emit({ ...context, id: `${context.id}:${entity.id}`, type: 'coin', entityId: entity.id, total: ++total, ...(entity.magnetCollected ? { attracted: true, targetX: p.x, targetY: p.y + .9, speed: view.speed } : {}) });
      }
    }
    for (const fact of view.powerupFacts) {
      const context = base(fact.type, [p.x, p.y + 1, 0]);
      emit({ ...context, ...fact, id: `${context.id}:${fact.entityId}` });
    }
    if (this.y === 0 && p.y > 0) emit({ ...base('jump', [p.x, .06, 0]), type: 'jump' });
    if (this.y > 0 && p.y === 0) emit({ ...base('land', [p.x, .04, 0], Math.min(1, Math.abs(this.velocityY) / RULES.jumpVelocity)), type: 'land' });
    if (this.slide <= 0 && p.slideRemaining > 0) emit({ ...base('slide', [p.x, .08, .15]), type: 'slide', duration: RULES.slideDuration });
    if (p.lane !== this.lane) emit({ ...base('lane', [p.x, p.y + .6, 0]), type: 'lane', direction: p.lane < this.lane ? -1 : 1, duration: RULES.laneChangeDuration });
    for (const threshold of [18, 20, 22] as const) {
      if (this.speed < threshold && view.speed >= threshold) emit({ ...base('speed', [p.x, .2, 0]), id: `${this.runId}:${view.tick}:speed:${threshold}`, type: 'speed', speed: threshold });
    }
    if (!this.over && view.status === 'over') {
      if (view.hit) emit({ ...base('collision', [p.x, Math.min(1.1, p.y + .8), -.25]), type: 'collision', obstacle: view.hit });
      emit({ ...base('game-over', [p.x, p.y, 0]), type: 'game-over' });
    }
    if (view.tick % 240 === 0) {
      for (const id of this.collected) if (!view.entities.some((entity) => entity.id === id)) this.collected.delete(id);
    }
    this.commit(view);
  }

  private commit(view: GameView): void {
    this.tick = view.tick; this.y = view.player.y; this.velocityY = view.player.velocityY;
    this.slide = view.player.slideRemaining; this.lane = view.player.lane; this.coins = view.coins;
    this.speed = view.speed; this.over = view.status === 'over';
  }
}
