import { RULES, SHAPES, laneX } from './config';
import type { DeepReadonly, Entity, Player } from './types';

/** Primitive AABBs use real x/y positions, including mid-lane transitions. */
export function intersects(player: DeepReadonly<Player>, entity: DeepReadonly<Entity>, distance: number): boolean {
  const shape = SHAPES[entity.kind];
  const height = player.slideRemaining > 0 ? RULES.slidingHeight : RULES.standingHeight;
  return Math.abs(player.x - laneX(entity.lane)) < (RULES.playerWidth + shape.width) / 2
    && Math.abs(entity.distance - distance) < (RULES.playerDepth + shape.depth) / 2
    && player.y < shape.bottom + shape.height
    && player.y + height > shape.bottom;
}
