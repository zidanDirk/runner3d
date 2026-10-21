/** Visual budgets only. These values never enter the game simulation. */
export const EFFECTS = {
  capacity: 192,
  rememberedEvents: 128,
  reducedParticleRatio: .3,
  coinPulseDuration: .2,
  hitPulseDuration: .45,
  speedNoticeDuration: 1.4,
  slideInterval: .08,
  speedInterval: .2,
  speedThreshold: 20,
  roadEdgeX: 4.3,
  coin: { count: 9, life: .4, size: .072, spread: .1, horizontal: 1.45, upward: 1.4, gravity: 4.8 },
  jump: { count: 6, life: .3, size: .065, spread: .22, horizontal: 1.05, upward: .6, gravity: 2.3 },
  land: { count: 8, life: .32, size: .075, spread: .25, horizontal: 1.5, upward: .55, gravity: 2.3 },
  slide: { count: 3, life: .28, size: .055, spread: .17, horizontal: .5, upward: .3, gravity: 1.6 },
  collision: { count: 14, life: .45, size: .085, spread: .18, horizontal: 2.1, upward: 1.65, gravity: 3.2 },
  speed: { count: 2, life: .22, size: .025, stretch: 12 },
} as const;

export type EffectBurst = 'coin' | 'jump' | 'land' | 'slide' | 'collision';
