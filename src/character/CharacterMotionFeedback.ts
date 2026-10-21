import type { GameView } from '../game/types';
import { RULES } from '../game/config';
import { JUMP_FLIGHT_SECONDS, laneLean } from './animationState';
import { MOTION } from './motionConfig';
import { damp, landingEnvelope } from './motionMath';

/** Owns only the impact scale and independent lean groups, never skeleton/physics. */
export class CharacterMotionFeedback {
  lean = 0;
  landing = 0;
  scaleY = 1;
  private rawLean = 0;
  private view: GameView | undefined;
  private tick = 0;
  private airborne = false;
  private velocityY = 0;
  private landingTick = -Infinity;
  private laneStart = -Infinity;

  update(view: GameView, reducedMotion = false): void {
    const elapsed = view.tick - this.tick;
    const reset = view !== this.view || elapsed < 0 || elapsed > 30;
    const airborne = view.player.y > 0 || view.player.velocityY !== 0;
    if (reset || view.player.laneElapsed < RULES.laneChangeDuration) this.laneStart = view.tick - view.player.laneElapsed / RULES.fixedDt;
    if (reset || view.status === 'ready') {
      this.rawLean = laneLean(view);
      this.landingTick = -Infinity;
    } else if (view.status === 'running') {
      // Reconstruct the known lane easing at visual substeps; no extra player motion.
      for (let i = 1; i <= elapsed; i++) {
        const laneElapsed = Math.max(0, (this.tick + i - this.laneStart) * RULES.fixedDt);
        this.rawLean = damp(this.rawLean, laneLean(view, laneElapsed), MOTION.leanDamping, RULES.fixedDt);
      }
      if (this.airborne && !airborne && this.velocityY < 0) {
        const oldFlightTicks = Math.round((RULES.jumpVelocity - this.velocityY) / RULES.gravity / RULES.fixedDt);
        this.landingTick = Math.min(view.tick, this.tick + Math.max(1, Math.round(JUMP_FLIGHT_SECONDS / RULES.fixedDt) - oldFlightTicks));
      }
    }
    if (airborne || view.player.slideRemaining > 0) this.landingTick = -Infinity;
    this.lean = this.rawLean * (reducedMotion ? MOTION.reducedLeanGain : 1);
    this.landing = landingEnvelope((view.tick - this.landingTick) * RULES.fixedDt);
    this.scaleY = 1 - MOTION.landingCompression * this.landing * (reducedMotion ? 0 : 1);
    this.view = view; this.tick = view.tick; this.airborne = airborne; this.velocityY = view.player.velocityY;
  }
}
