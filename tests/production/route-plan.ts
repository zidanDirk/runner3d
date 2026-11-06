import { RULES, SHAPES } from '../../src/game/config';
import { POWERUP_BALANCE, POWERUP_TYPES } from '../../src/game/balance';
import type { PowerUpType } from '../../src/game/balance';
import { speedAtDistance } from '../../src/game/difficulty';
import { LevelGenerator } from '../../src/game/level';
import { PowerUpGenerator } from '../../src/game/powerups';
import type { PowerUpPickup } from '../../src/game/powerups';
import type { Lane, TrackRow } from '../../src/game/types';

export const POWERUP_ROUTE = 'DEMO-11-4411';
export interface RouteRow { row: TrackRow; clearEnd: number; pickup: PowerUpPickup | null }
export interface RoutePlan { rows: RouteRow[]; required: PowerUpPickup[] }
export interface RouteSample {
  distance: number; speed: number; coins: number; status: string; sampledAtMs: number;
  powerups: Record<PowerUpType, boolean>;
}
export interface RouteTiming { nowMs: number; keyboardMs: number; pendingThrough: number | null }
export interface RouteDecision {
  kind: 'hold' | 'move' | 'unsafe'; lane: Lane; reason: string;
  forecastDistance: number; dangerStart: number | null; row: number;
}

/** Clear the OLD lane's AABB; full lane completion is tracked separately. */
function exitLaneSeconds(width: number): number {
  const fraction = (RULES.playerWidth + width) / (2 * RULES.laneWidth);
  if (fraction >= 1) throw new Error('Route obstacle cannot be cleared by one lane change');
  let low = 0, high = 1;
  for (let i = 0; i < 40; i++) {
    const t = (low + high) / 2;
    if (t * t * (3 - 2 * t) < fraction) low = t; else high = t;
  }
  return high * RULES.laneChangeDuration;
}

/** Poll without an extra sleep while a pickup/control deadline is approaching.
 * Each request still awaits a real browser observation; no busy loop or clock edit.
 */
export function routePollDelay(plan: RoutePlan, sample: RouteSample, collected: ReadonlySet<string>, readMs: number, keyboardMs: number): number {
  const lookAhead = forecastDistance(sample, (2 * readMs + keyboardMs + 75) / 1000 + RULES.laneChangeDuration);
  return plan.required.some(p => !collected.has(p.id) && p.distance <= lookAhead) ? 0 : 75;
}

export function createRoutePlan(seed = POWERUP_ROUTE): RoutePlan {
  const level = new LevelGenerator(seed), powers = new PowerUpGenerator(seed);
  const rows = Array.from({ length: 25 }, (): RouteRow => {
    const row = level.next();
    const depth = Math.max(0, ...row.entities.filter(e => e.kind !== 'coin').map(e => SHAPES[e.kind].depth));
    return { row, clearEnd: row.distance + (RULES.playerDepth + depth) / 2, pickup: powers.forRow(row) };
  });
  const required = rows.flatMap(r => r.pickup && r.pickup.distance <= 280 ? [r.pickup] : []);
  // This bot verifies this explicit fixture, not arbitrary/repeated refreshes.
  if (required.length !== 3 || POWERUP_TYPES.some(type => required.filter(p => p.type === type).length !== 1)) throw new Error('Power-up route fixture changed: audit the collection checkpoint');
  return { rows, required };
}

/** Upper travel bound: rounded HUD, 50ms publication cadence, acceleration cap.
 * A slow renderer may advance LESS than wall time; never assume that to be safe.
 */
export function forecastDistance(sample: RouteSample, seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid route horizon');
  const start = sample.distance + 1;
  const speed = Math.max(speedAtDistance(start), sample.speed + .05);
  const horizon = seconds + .05 + RULES.fixedDt;
  const upperSpeed = Math.min(RULES.maxSpeed, speed + RULES.accelerationPerMeter * RULES.maxSpeed * horizon);
  return start + upperSpeed * horizon;
}

export function observePickups(plan: RoutePlan, sample: RouteSample, collected: Set<string>): void {
  for (const pickup of plan.required) {
    const contactStart = pickup.distance - (RULES.playerDepth + POWERUP_BALANCE.pickupDepth) / 2;
    if (sample.distance + 1 >= contactStart && sample.powerups[pickup.type]) collected.add(pickup.id);
  }
}

/** Non-steering calls must leave room for the following observation AND move. */
export function controlWindow(plan: RoutePlan, sample: RouteSample, lane: Lane, seconds: number) {
  const dangerStart = Math.min(...plan.rows.flatMap(r => r.row.entities)
    .filter(e => e.kind !== 'coin' && e.lane === lane && e.distance + (RULES.playerDepth + SHAPES[e.kind].depth) / 2 >= sample.distance)
    .map(e => e.distance - (RULES.playerDepth + SHAPES[e.kind].depth) / 2));
  const end = forecastDistance(sample, seconds);
  return { safe: end < dangerStart, dangerStart, forecastDistance: end };
}

export function planRouteStep(plan: RoutePlan, sample: RouteSample, lane: Lane, collected: ReadonlySet<string>, timing: RouteTiming): RouteDecision {
  const age = (timing.nowMs - sample.sampledAtMs) / 1000;
  const forecast = forecastDistance(sample, Math.max(0, age) + timing.keyboardMs / 1000 + RULES.laneChangeDuration);
  const answer = (kind: RouteDecision['kind'], target: Lane, reason: string, row: number, dangerStart: number | null = null): RouteDecision =>
    ({ kind, lane: target, reason, forecastDistance: forecast, dangerStart, row });
  if (!Number.isFinite(age) || age < -.01 || !Number.isFinite(timing.keyboardMs) || timing.keyboardMs < 0) return answer('unsafe', lane, 'invalid sample clock or keyboard latency', -1);
  for (const item of plan.rows) {
    const required = item.pickup && plan.required.some(p => p.id === item.pickup?.id) ? item.pickup : null;
    if (sample.distance > item.clearEnd && (!required || collected.has(required.id))) continue;
    if (required && !collected.has(required.id) && sample.distance > required.distance + 1 + (RULES.playerDepth + POWERUP_BALANCE.pickupDepth) / 2) return answer('unsafe', lane, `missed required pickup ${required.id}`, item.row.index);
    const target = item.row.safeLane;
    if (target === lane) return answer('hold', lane, required && !collected.has(required.id) ? 'retain pickup lane until actual HUD activation' : 'already in safe lane', item.row.index);
    const blocking = item.row.entities.filter(e => e.kind !== 'coin' && e.lane === lane);
    const danger = Math.min(...blocking.map(e => e.distance - (RULES.playerDepth + SHAPES[e.kind].depth) / 2));
    const dangerStart = Number.isFinite(danger) ? danger : null;
    const exitSeconds = Math.max(0, ...blocking.map(e => exitLaneSeconds(SHAPES[e.kind].width)));
    if (timing.pendingThrough !== null && sample.distance < timing.pendingThrough) {
      const afterPending = forecastDistance({ ...sample, distance: timing.pendingThrough }, timing.keyboardMs / 1000 + exitSeconds);
      if (dangerStart !== null && Math.max(afterPending, forecast) >= dangerStart) return answer('unsafe', target, 'pending input leaves no safe window for the next move', item.row.index, dangerStart);
      return answer('hold', lane, 'previous real input still pending by simulated distance', item.row.index, dangerStart);
    }
    if (Math.abs(target - lane) !== 1) return answer('unsafe', lane, 'route requires more than one adjacent move', item.row.index, dangerStart);
    const clearForecast = forecastDistance(sample, Math.max(0, age) + timing.keyboardMs / 1000 + exitSeconds);
    if (dangerStart !== null && clearForecast >= dangerStart) return { ...answer('unsafe', target, 'stale sample/input budget exceeds safe lane-change window', item.row.index, dangerStart), forecastDistance: clearForecast };
    return { ...answer('move', target, 'old obstacle cleared and required pickup confirmed', item.row.index, dangerStart), forecastDistance: clearForecast };
  }
  return answer('unsafe', lane, 'route plan exhausted before checkpoint', -1);
}
