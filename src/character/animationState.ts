import { RULES, laneX } from '../game/config';
import type { GameView } from '../game/types';
import { ANIMATION_SETTINGS } from './animationConfig';
import type { AnimationState } from './animationConfig';
import { calculateRunAnimationSpeed } from './motionMath';

export const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
// Engine uses semi-implicit gravity before position. This is its actual landing tick.
export const JUMP_FLIGHT_SECONDS = Math.ceil(2 * RULES.jumpVelocity / (RULES.gravity * RULES.fixedDt) - 1) * RULES.fixedDt;

/** Animation reads authoritative state. No second jump/slide timer or gameplay writes. */
export function animationState(view: GameView): AnimationState {
  if (view.status === 'ready') return 'idle';
  if (view.player.y > 0 || view.player.velocityY !== 0) return 'jump';
  if (view.player.slideRemaining > 0) return 'slide';
  return 'run';
}
export function jumpProgress(view: GameView): number {
  return clamp01((RULES.jumpVelocity - view.player.velocityY) / RULES.gravity / JUMP_FLIGHT_SECONDS);
}
export function slideProgress(view: GameView): number {
  return clamp01(1 - view.player.slideRemaining / RULES.slideDuration);
}
export function runTimeScale(speed: number): number {
  return calculateRunAnimationSpeed(speed);
}
export function laneLean(view: GameView, elapsed = view.player.laneElapsed): number {
  const t = clamp01(elapsed / RULES.laneChangeDuration);
  const direction = (laneX(view.player.lane) - view.player.fromX) / RULES.laneWidth;
  if (t === 0 || t === 1 || direction === 0) return 0;
  return Math.max(-ANIMATION_SETTINGS.maxLean, Math.min(ANIMATION_SETTINGS.maxLean, -direction * ANIMATION_SETTINGS.maxLean * 4 * t * (1 - t)));
}
