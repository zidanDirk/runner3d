/** Visual parameters only. Physics constants remain owned by game/config.ts. */
export const MOTION = {
  runBaseScale: 1.08, runFastScale: 1.5, runMinScale: .85, runMaxScale: 1.55, runDamping: 12,
  leanDamping: 40, reducedLeanGain: .35,
  landingAttack: .025, landingRecovery: .195, landingCompression: .022,
  cameraFollow: .12, cameraDamping: 12, fovDamping: 5, baseFov: 51, fastFov: 55,
} as const;
