import { laneX, RULES } from './config';
import { speedAtDistance } from './difficulty';
import type { Action, Lane, Player } from './types';

export function initialPlayer(lane: Lane = 1): Player {
  return { lane, x: laneX(lane), fromX: laneX(lane), laneElapsed: RULES.laneChangeDuration, y: 0, velocityY: 0, slideRemaining: 0 };
}
/** Production's exact fixed-step kernel, shared by GameEngine and reachability. */
export function advancePlayer(p: Player, actions: readonly Action[]): void {
  const dt = RULES.fixedDt;
  for (const action of actions) {
    if (action === 'left' || action === 'right') {
      const next = Math.max(0, Math.min(2, p.lane + (action === 'left' ? -1 : 1))) as Lane;
      if (next !== p.lane) { p.fromX = p.x; p.lane = next; p.laneElapsed = 0; }
    } else if (action === 'jump' && p.y === 0 && p.slideRemaining <= 0) p.velocityY = RULES.jumpVelocity;
    else if (action === 'slide' && p.y === 0 && p.velocityY === 0 && p.slideRemaining <= 0) p.slideRemaining = RULES.slideDuration;
  }
  p.laneElapsed = Math.min(RULES.laneChangeDuration, p.laneElapsed + dt);
  const t = p.laneElapsed / RULES.laneChangeDuration;
  const ease = t * t * (3 - 2 * t);
  p.x = p.fromX + (laneX(p.lane) - p.fromX) * ease;
  p.slideRemaining = Math.max(0, p.slideRemaining - dt);
  if (p.velocityY !== 0 || p.y > 0) {
    p.velocityY -= RULES.gravity * dt;
    p.y = Math.max(0, p.y + p.velocityY * dt);
    if (p.y === 0) p.velocityY = 0;
  }
}
export interface MotionState { player: Player; tick: number; distance: number; speed: number }
export function advanceMotion(state: MotionState, actions: readonly Action[]): void {
  advancePlayer(state.player, actions);
  state.tick++;
  state.speed = speedAtDistance(state.distance);
  state.distance += state.speed * RULES.fixedDt;
}
