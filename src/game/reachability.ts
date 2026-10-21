import { RULES, SHAPES } from './config';
import { DIFFICULTY_CONFIG } from './difficulty';
import { intersects } from './collision';
import { advanceMotion, initialPlayer } from './motion';
import type { MotionState } from './motion';
import type { Action, DeepReadonly, Entity, Lane, Player, TrackRow } from './types';

export interface ReachabilityScenario {
  readonly entities: readonly DeepReadonly<Entity>[];
  readonly startDistance: number;
  readonly endDistance: number;
  readonly player?: DeepReadonly<Player>;
  readonly reactionSeconds?: number;
  readonly decisionTicks?: number;
  readonly maxNodes?: number;
}
export interface WitnessAction { readonly tick: number; readonly action: Action }
export interface ReachabilityResult {
  readonly reachable: boolean;
  readonly status: 'certified' | 'search-exhausted' | 'unreachable';
  readonly expandedNodes: number;
  readonly actions: readonly WitnessAction[];
  readonly finalState: DeepReadonly<MotionState> | null;
}
const EMPTY: readonly Action[] = [];
const CHOICES: readonly (readonly Action[])[] = [EMPTY, ['left'], ['right'], ['jump'], ['slide']];
export const SEARCH_BEAM_WIDTH = 12;
const FORECAST_TICKS = 48;
function stateFor(s: ReachabilityScenario): MotionState {
  return { player: s.player ? { ...s.player } : initialPlayer(), tick: 0, distance: s.startDistance, speed: RULES.baseSpeed };
}
function clone(s: MotionState): MotionState { return { ...s, player: { ...s.player } }; }
function step(s: MotionState, actions: readonly Action[], entities: ReachabilityScenario['entities']): boolean {
  advanceMotion(s, actions);
  return !entities.some(e => e.kind !== 'coin' && !e.collected && intersects(s.player, e, s.distance));
}
function validate(s: ReachabilityScenario): void {
  if (!Number.isFinite(s.startDistance) || s.startDistance < 0 || !Number.isFinite(s.endDistance) || s.endDistance <= s.startDistance || s.endDistance - s.startDistance > 80) throw new Error('Reachability horizon must be finite, forward and≤80m');
  if (s.entities.length > 32 || s.entities.some(e => !Number.isFinite(e.distance) || ![0, 1, 2].includes(e.lane) || !Object.hasOwn(SHAPES, e.kind))) throw new Error('Invalid reachability obstacles');
  if (s.player && (Object.values(s.player).some(n => !Number.isFinite(n)) || ![0, 1, 2].includes(s.player.lane) || s.player.y < 0 || s.player.slideRemaining < 0)) throw new Error('Invalid initial movement state');
  const delay = s.reactionSeconds ?? 0, ticks = s.decisionTicks ?? DIFFICULTY_CONFIG.fairness.decisionTicks, nodes = s.maxNodes ?? DIFFICULTY_CONFIG.fairness.maxSearchNodes;
  if (!Number.isFinite(delay) || delay < 0 || delay > 2 || !Number.isInteger(ticks) || ticks < 1 || ticks > 12 || !Number.isInteger(nodes) || nodes < 1 || nodes > 16384) throw new Error('Invalid bounded search limits');
}
/** A positive answer is a replayed, exact120Hz witness; no powers or altered AABBs. */
export function replayWitness(s: ReachabilityScenario, actions: readonly WitnessAction[]): ReachabilityResult {
  validate(s); const state = stateFor(s); let index = 0;
  if (actions.some((a, i) => !Number.isSafeInteger(a.tick) || a.tick < Math.ceil((s.reactionSeconds ?? 0) / RULES.fixedDt) || (i > 0 && a.tick <= (actions[i - 1]?.tick ?? -1)) || !['left', 'right', 'jump', 'slide'].includes(a.action))) throw new Error('Invalid action witness');
  const maxTicks = Math.ceil((s.endDistance - s.startDistance) / RULES.baseSpeed / RULES.fixedDt) + 2;
  while (state.distance < s.endDistance && state.tick < maxTicks) {
    const action = actions[index]?.tick === state.tick ? actions[index++]?.action : undefined;
    if (!step(state, action ? [action] : EMPTY, s.entities)) return { reachable: false, status: 'unreachable', expandedNodes: state.tick, actions, finalState: null };
  }
  const reachable = state.distance >= s.endDistance;
  return { reachable, status: reachable ? 'certified' : 'search-exhausted', expandedNodes: state.tick, actions, finalState: reachable ? state : null };
}

/** Bounded beam search on a decision-time grid. Pruning never rounds retained physical states. */
export function findReachableRoute(s: ReachabilityScenario): ReachabilityResult {
  validate(s);
  const stride = s.decisionTicks ?? DIFFICULTY_CONFIG.fairness.decisionTicks;
  const maxNodes = s.maxNodes ?? DIFFICULTY_CONFIG.fairness.maxSearchNodes;
  const delayTicks = Math.ceil((s.reactionSeconds ?? 0) / RULES.fixedDt);
  const initial = stateFor(s);
  for (let i = 0; i < delayTicks && initial.distance < s.endDistance; i++) if (!step(initial, EMPTY, s.entities)) return { reachable: false, status: 'unreachable', expandedNodes: 0, actions: [], finalState: null };
  if (initial.distance >= s.endDistance) return replayWitness(s, []);
  let frontier = [{ state: initial, actions: [] as WitnessAction[] }], expandedNodes = 0;
  const maxTicks = Math.ceil((s.endDistance - s.startDistance) / RULES.baseSpeed / RULES.fixedDt) + stride;
  while (frontier.length > 0 && frontier[0] && frontier[0].state.tick <= maxTicks) {
    const next: typeof frontier = [], seen = new Set<string>();
    for (const node of frontier) for (const actions of CHOICES) {
      if (++expandedNodes > maxNodes) return { reachable: false, status: 'search-exhausted', expandedNodes: maxNodes, actions: [], finalState: null };
      const state = clone(node.state), action = actions[0], p = state.player;
      if (action === 'left' && p.lane === 0 || action === 'right' && p.lane === 2
        || action === 'jump' && (p.y !== 0 || p.slideRemaining > 0)
        || action === 'slide' && (p.y !== 0 || p.velocityY !== 0 || p.slideRemaining > 0)) continue;
      const history = action ? [...node.actions, { tick: state.tick, action }] : node.actions;
      let alive = true;
      for (let tick = 0; tick < stride && state.distance < s.endDistance; tick++) if (!step(state, tick === 0 ? actions : EMPTY, s.entities)) { alive = false; break; }
      if (!alive) continue;
      if (state.distance >= s.endDistance) {
        const replay = replayWitness(s, history);
        return { ...replay, expandedNodes };
      }
      const key = [p.lane, Math.round(p.x * 10), Math.round(p.fromX * 10), Math.round(p.laneElapsed * 120 / stride), Math.round(p.y * 10), Math.round(p.velocityY * 2), Math.ceil(p.slideRemaining * 120 / stride)].join(':');
      if (!seen.has(key)) { seen.add(key); next.push({ state, actions: history }); }
    }
    // Prefer prefixes that remain safe under actual unforced motion for the next0.4s.
    // This bounds branching, rather than exhausting the budget before the first obstacle.
    const ranked = next.map(node => {
      const forecast = clone(node.state); let safeTicks = 0;
      for (; safeTicks < FORECAST_TICKS && forecast.distance < s.endDistance; safeTicks++) if (!step(forecast, EMPTY, s.entities)) break;
      return { node, safeTicks };
    });
    ranked.sort((a, b) => b.safeTicks - a.safeTicks || a.node.actions.length - b.node.actions.length);
    frontier = ranked.slice(0, SEARCH_BEAM_WIDTH).map(item => item.node);
  }
  // No witness within this discrete action grid, not a proof for every possible continuous input.
  return { reachable: false, status: 'unreachable', expandedNodes, actions: [], finalState: null };
}

export interface RowCertificate {
  readonly reachable: boolean;
  readonly status: ReachabilityResult['status'];
  readonly testedLanes: number;
  readonly maxSpeed: number;
  readonly reactionSeconds: number;
  readonly expandedNodes: number;
  readonly witnesses: readonly { readonly lane: Lane; readonly actions: readonly WitnessAction[] }[];
}
const cache = new Map<string, RowCertificate>();
export const REACHABILITY_CACHE_CAPACITY = 64;
export function reachabilityCacheSize(): number { return cache.size; }
/** Translation-invariant layout certificate at actual saturated speed. At most64 layout templates retained. */
export function validateRowTransition(previous: DeepReadonly<TrackRow> | null, row: DeepReadonly<TrackRow>): RowCertificate {
  const clearance = (RULES.playerDepth + SHAPES.block.depth) / 2 + .1;
  const start = previous ? previous.distance + clearance : 0;
  if (row.distance <= start || row.distance - start > 80) throw new Error('Invalid row spacing for reachability');
  const obstacles = row.entities.filter(e => e.kind !== 'coin');
  const gap = previous ? row.distance - previous.distance - clearance : row.distance;
  const key = [gap, row.safeLane, ...obstacles.map(e => [e.kind, e.lane, e.distance - row.distance, e.collected].join(','))].join('|');
  const cached = cache.get(key); if (cached) return cached;
  // Translate the whole local problem to the point where the real curve reaches maximum speed.
  const saturation = (RULES.maxSpeed - RULES.baseSpeed) / DIFFICULTY_CONFIG.speed.perMeter;
  const target = saturation + gap;
  const entities = obstacles.map(e => ({ ...e, distance: target + e.distance - row.distance }));
  const delay = DIFFICULTY_CONFIG.fairness.reactionSeconds + DIFFICULTY_CONFIG.fairness.inputLatencySeconds;
  const witnesses: { lane: Lane; actions: readonly WitnessAction[] }[] = []; let expandedNodes = 0;
  for (const lane of [0, 1, 2] as const) {
    const scenario = { entities, startDistance: saturation, endDistance: target + clearance, player: initialPlayer(lane), reactionSeconds: delay };
    // Fast constructive witness uses actual lane timing; generic search handles unusual combinations.
    const state = stateFor(scenario), actions: WitnessAction[] = [];
    const delayTicks = Math.ceil(delay / RULES.fixedDt);
    let alive = true;
    while (state.distance < scenario.endDistance) {
      let action: Action | undefined;
      if (state.tick >= delayTicks && state.player.laneElapsed >= RULES.laneChangeDuration && state.player.lane !== row.safeLane) action = state.player.lane < row.safeLane ? 'right' : 'left';
      if (action) actions.push({ tick: state.tick, action });
      expandedNodes++;
      if (!step(state, action ? [action] : EMPTY, entities)) { alive = false; break; }
    }
    const result = alive ? replayWitness(scenario, actions) : findReachableRoute(scenario);
    if (!alive) expandedNodes += result.expandedNodes;
    if (!result.reachable) return { reachable: false, status: result.status, testedLanes: witnesses.length + 1, maxSpeed: RULES.maxSpeed, reactionSeconds: delay, expandedNodes, witnesses };
    witnesses.push({ lane, actions: result.actions });
  }
  const result: RowCertificate = Object.freeze({ reachable: true, status: 'certified', testedLanes: 3, maxSpeed: RULES.maxSpeed, reactionSeconds: delay, expandedNodes, witnesses: Object.freeze(witnesses.map(w => Object.freeze({ ...w, actions: Object.freeze(w.actions) }))) });
  if (cache.size >= REACHABILITY_CACHE_CAPACITY) cache.delete(cache.keys().next().value ?? '');
  cache.set(key, result); return result;
}
