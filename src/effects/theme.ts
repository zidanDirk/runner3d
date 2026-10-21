import { getThemeTransition } from '../city/zones';
import type { EffectPalette } from '../feedback/types';

/** Palettes adapt the existing zone transition; there is no second theme clock. */
export function effectPalette(distance: number): EffectPalette {
  const t = getThemeTransition(distance);
  const progress = t.progress * t.progress * (3 - 2 * t.progress);
  const neon = (t.fromThemeId === 'neon-city' ? 1 : 0) * (1 - progress) + (t.toThemeId === 'neon-city' ? 1 : 0) * progress;
  return {
    coin: [1, .67 + .05 * neon, .22 + .12 * neon],
    dust: [.30 + .07 * neon, .40 - .03 * neon, .47 + .20 * neon],
    impact: [1, .32 + .06 * neon, .20 + .13 * neon],
    trail: [.38 + .07 * neon, .62 - .02 * neon, .64 + .26 * neon], neon,
  };
}
