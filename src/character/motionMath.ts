import { RULES } from '../game/config';
import { MOTION } from './motionConfig';

export const bounded = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
export const smoothStep = (value: number): number => { const t = bounded(value, 0, 1); return t * t * (3 - 2 * t); };
/** Exact exponential response to a constant target; not a fixed per-frame lerp. */
export function damp(current: number, target: number, rate: number, deltaTime: number): number {
  return target + (current - target) * Math.exp(-rate * Math.max(0, deltaTime));
}
export function calculateRunAnimationSpeed(gameSpeed: number): number {
  const speed = Number.isNaN(gameSpeed) ? RULES.baseSpeed : gameSpeed;
  return bounded(MOTION.runBaseScale + (MOTION.runFastScale - MOTION.runBaseScale) * (speed - RULES.baseSpeed) / (RULES.maxSpeed - RULES.baseSpeed), MOTION.runMinScale, MOTION.runMaxScale);
}
export function calculateCameraFov(gameSpeed: number, reducedMotion = false): number {
  if (reducedMotion) return MOTION.baseFov;
  return MOTION.baseFov + (MOTION.fastFov - MOTION.baseFov) * bounded((gameSpeed - RULES.baseSpeed) / (RULES.maxSpeed - RULES.baseSpeed), 0, 1);
}
export function landingEnvelope(seconds: number): number {
  if (seconds < 0 || seconds >= MOTION.landingAttack + MOTION.landingRecovery) return 0;
  return seconds < MOTION.landingAttack ? smoothStep(seconds / MOTION.landingAttack)
    : 1 - smoothStep((seconds - MOTION.landingAttack) / MOTION.landingRecovery);
}

/** Integral of the *visual* target cadence along authoritative distance.
 * Used only to seed a seek/restart pose; normal phase integrates the damped rate.
 */
export function runPhaseAtDistance(distance: number): number {
  const rampDistance = (RULES.maxSpeed - RULES.baseSpeed) / RULES.accelerationPerMeter;
  const ramp = bounded(distance, 0, rampDistance);
  const slope = (MOTION.runFastScale - MOTION.runBaseScale) / (RULES.maxSpeed - RULES.baseSpeed);
  const phase = slope * ramp + (MOTION.runBaseScale - slope * RULES.baseSpeed) / RULES.accelerationPerMeter
    * Math.log1p(RULES.accelerationPerMeter * ramp / RULES.baseSpeed);
  return phase + Math.max(0, distance - rampDistance) * MOTION.runFastScale / RULES.maxSpeed;
}
