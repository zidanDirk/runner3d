import { MOTION } from './motionConfig';

export const ANIMATION_NAMES = { idle: 'Idle', run: 'Run', jump: 'Jump', slide: 'Slide' } as const;
export type AnimationState = keyof typeof ANIMATION_NAMES;
export const ANIMATION_STATES = ['idle', 'run', 'jump', 'slide'] as const;
export const ANIMATION_SETTINGS = {
  crossfade: .12,
  slideEntryFade: .06,
  jumpEntryFade: .08,
  landingFade: .10,
  slideRecoveryFade: .14,
  minRunScale: MOTION.runMinScale,
  maxRunScale: MOTION.runMaxScale,
  maxLean: Math.PI / 16,
} as const;
