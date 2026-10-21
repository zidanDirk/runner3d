import { RULES } from '../game/config';

/** Frame time schedules fixed ticks; it never becomes the simulation dt. */
export class FixedClock {
  private accumulator = 0;

  advance(seconds: number, step: () => void): number {
    if (!Number.isFinite(seconds) || seconds < 0) return 0;
    this.accumulator += Math.min(seconds, 0.1);
    let ticks = 0;
    while (this.accumulator + 1e-12 >= RULES.fixedDt) {
      step();
      this.accumulator = Math.max(0, this.accumulator - RULES.fixedDt);
      ticks++;
    }
    return ticks;
  }

  reset(): void { this.accumulator = 0; }
}
