import type { GameView } from '../game/types';
import { RULES, laneX } from '../game/config';
import { MOTION } from '../character/motionConfig';
import { calculateCameraFov, damp, smoothStep } from '../character/motionMath';
import type { CameraLayout } from './cameraLayout';

/** Numeric camera response, independent of React, Three.js and game mutation. */
export class CameraMotionController {
  x = 0; y = 7.8; z = 12; fov: number = MOTION.baseFov;
  private view: GameView | undefined;
  private tick = 0;
  private speed: number = RULES.baseSpeed;
  private layoutKey = '';
  private reduced = false;
  private laneStart = -Infinity;

  update(view: GameView, layout: boolean | CameraLayout, reducedMotion: boolean): void {
    const profile = typeof layout === 'boolean' ? { y: layout ? 10 : 7.8, z: layout ? 18 : 12, baseFov: 51 } : layout;
    const key = `${profile.y}:${profile.z}:${profile.baseFov}`;
    const fov = (speed: number) => profile.baseFov + calculateCameraFov(speed, reducedMotion) - MOTION.baseFov;
    const elapsed = view.tick - this.tick;
    const reset = view !== this.view || elapsed < 0 || elapsed > 30 || key !== this.layoutKey || reducedMotion !== this.reduced;
    if (reset || view.player.laneElapsed < RULES.laneChangeDuration) this.laneStart = view.tick - view.player.laneElapsed / RULES.fixedDt;
    this.y = profile.y; this.z = profile.z;
    if (reset) {
      this.x = reducedMotion ? 0 : view.player.x * MOTION.cameraFollow;
      this.fov = fov(view.speed);
    } else if (view.status === 'running') {
      for (let i = 1; i <= elapsed; i++) {
        const laneElapsed = Math.max(0, (this.tick + i - this.laneStart) * RULES.fixedDt);
        const x = view.player.fromX + (laneX(view.player.lane) - view.player.fromX) * smoothStep(laneElapsed / RULES.laneChangeDuration);
        const speed = this.speed + (view.speed - this.speed) * i / elapsed;
        this.x = damp(this.x, reducedMotion ? 0 : x * MOTION.cameraFollow, MOTION.cameraDamping, RULES.fixedDt);
        this.fov = damp(this.fov, fov(speed), MOTION.fovDamping, RULES.fixedDt);
      }
    }
    this.view = view; this.tick = view.tick; this.speed = view.speed; this.layoutKey = key; this.reduced = reducedMotion;
  }
}
