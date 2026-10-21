import { RULES, SHAPES } from './config';
import { DIFFICULTY_CONFIG } from './difficulty';
import { advancePlayer, initialPlayer } from './motion';
import type { ObstacleKind } from './types';

export interface ReactionAssumptions {
  readonly reactionSeconds: number;
  readonly inputLatencySeconds: number;
  readonly preparationSeconds: number;
}
/** Design sensitivity assumptions, not measured human response times. */
export const REACTION_ASSUMPTIONS = {
  version: 1,
  slow: { reactionSeconds: .65, inputLatencySeconds: .12, preparationSeconds: .10 },
  ordinary: { reactionSeconds: DIFFICULTY_CONFIG.fairness.reactionSeconds, inputLatencySeconds: DIFFICULTY_CONFIG.fairness.inputLatencySeconds, preparationSeconds: .05 },
  fast: { reactionSeconds: .20, inputLatencySeconds: .04, preparationSeconds: .03 },
  readability: { minimumCssPixels: 12, minimumUnfoggedFraction: .35, scanStepMeters: .25 },
} as const;
export type ReactionAction = 'lane' | 'jump' | 'slide';

export function validateReactionAssumptions(value: ReactionAssumptions): void {
  if (Object.keys(value).sort().join(',') !== 'inputLatencySeconds,preparationSeconds,reactionSeconds') throw new Error('Unknown or missing reaction assumption');
  for (const delay of Object.values(value)) if (!Number.isFinite(delay) || delay < 0 || delay > 2) throw new Error('Reaction assumptions must be finite seconds in 0..2');
}

/** Sample the same discrete physics kernel as GameEngine. No analytic substitute
 * or second jump simulation is used; cache the grounded actuation budget once. */
function jumpLeadSeconds(): number {
  const player = initialPlayer();
  for (let tick = 1; tick <= 240; tick++) {
    advancePlayer(player, tick === 1 ? ['jump'] : []);
    if (player.y >= SHAPES.hurdle.height) return tick * RULES.fixedDt;
  }
  throw new Error('Current jump cannot clear hurdle height');
}
const jumpLead = jumpLeadSeconds();

export function actionLeadSeconds(action: ReactionAction, laneChanges = 1): number {
  if (!Number.isInteger(laneChanges) || laneChanges < 0 || laneChanges > 2) throw new Error('Lane changes must be 0..2');
  if (action === 'lane') return laneChanges * RULES.laneChangeDuration;
  if (action === 'jump') return jumpLead;
  if (action === 'slide') return RULES.fixedDt;
  throw new Error('Unknown reaction action');
}

export interface ReactionWindowInput {
  readonly visibleDistance: number;
  readonly speed: number;
  readonly kind: ObstacleKind;
  readonly action: ReactionAction;
  readonly laneChanges?: number;
  readonly assumptions?: ReactionAssumptions;
}
export interface ReactionWindow {
  readonly timeToContactSeconds: number;
  readonly actuationSeconds: number;
  readonly decisionWindowSeconds: number;
  readonly requiredReactionSeconds: number;
  readonly slackSeconds: number;
  readonly sufficient: boolean;
}
/** Conservative constant-speed planning budget. Use maximum speed to bound an
 * accelerating approach. Geometry visibility is an external measured input;
 * this function cannot establish actual recognition, contrast or occlusion. */
export function analyzeReactionWindow(input: ReactionWindowInput): ReactionWindow {
  const assumptions = input.assumptions ?? REACTION_ASSUMPTIONS.ordinary;
  validateReactionAssumptions(assumptions);
  if (!Number.isFinite(input.visibleDistance) || input.visibleDistance < 0 || !Number.isFinite(input.speed) || input.speed <= 0 || input.speed > 100) throw new Error('Invalid reaction distance or speed');
  const shape = SHAPES[input.kind];
  if (!shape || !['hurdle', 'gate', 'block'].includes(input.kind)) throw new Error('Unknown obstacle kind');
  const contactMargin = (RULES.playerDepth + shape.depth) / 2;
  const timeToContactSeconds = Math.max(0, input.visibleDistance - contactMargin) / input.speed;
  const actuationSeconds = actionLeadSeconds(input.action, input.laneChanges);
  const decisionWindowSeconds = timeToContactSeconds - actuationSeconds - assumptions.inputLatencySeconds - assumptions.preparationSeconds;
  const slackSeconds = decisionWindowSeconds - assumptions.reactionSeconds;
  return { timeToContactSeconds, actuationSeconds, decisionWindowSeconds, requiredReactionSeconds: assumptions.reactionSeconds, slackSeconds, sufficient: slackSeconds >= 0 };
}
