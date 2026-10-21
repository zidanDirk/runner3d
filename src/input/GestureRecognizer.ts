import type { Action } from '../game/types';

export const GESTURE_CONFIG = { threshold: 34, axisRatio: 1.2, maxDurationMs: 650 } as const;
export interface GesturePoint { readonly id: number; readonly x: number; readonly y: number; readonly time: number }
interface GestureStart extends GesturePoint { consumed: boolean }

/** CSS-pixel recognition with a single command per contact and no browser dependencies. */
export class GestureRecognizer {
  private readonly pointers = new Set<number>();
  private start: GestureStart | undefined;

  down(point: GesturePoint, eligible = true): boolean {
    this.pointers.add(point.id);
    if (this.pointers.size !== 1 || !eligible) { this.start = undefined; return false; }
    this.start = { ...point, consumed: false };
    return true;
  }

  move(point: GesturePoint): Action | undefined {
    const start = this.start;
    if (!start || start.id !== point.id || start.consumed || this.pointers.size !== 1) return undefined;
    const elapsed = point.time - start.time;
    if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > GESTURE_CONFIG.maxDurationMs) {
      start.consumed = true;
      return undefined;
    }
    const dx = point.x - start.x;
    const dy = point.y - start.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return undefined;
    const x = Math.abs(dx), y = Math.abs(dy);
    let action: Action | undefined;
    if (x >= GESTURE_CONFIG.threshold && x >= y * GESTURE_CONFIG.axisRatio) action = dx < 0 ? 'left' : 'right';
    else if (y >= GESTURE_CONFIG.threshold && y >= x * GESTURE_CONFIG.axisRatio) action = dy < 0 ? 'jump' : 'slide';
    if (action) start.consumed = true;
    return action;
  }

  up(id: number): void {
    this.pointers.delete(id);
    if (this.start?.id === id || this.pointers.size === 0) this.start = undefined;
    // After multiple fingers, a remaining contact never becomes a new gesture.
  }

  clear = (): void => { this.pointers.clear(); this.start = undefined; };
}
