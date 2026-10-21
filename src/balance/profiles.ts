/** Explanatory bot assumptions, not measurements of real players. */
export const BOT_PROFILES = {
  beginner: { reactionSeconds: .48, inputLagSeconds: .10, errorRate: .16, actionCooldownSeconds: .32, coinAppetite: .58, actionPreference: .30, visibilityMeters: 32 },
  casual: { reactionSeconds: .30, inputLagSeconds: .065, errorRate: .065, actionCooldownSeconds: .23, coinAppetite: .82, actionPreference: .42, visibilityMeters: 42 },
  expert: { reactionSeconds: .17, inputLagSeconds: .035, errorRate: .022, actionCooldownSeconds: .185, coinAppetite: .95, actionPreference: .56, visibilityMeters: 52 },
} as const;
export type BotProfileName = keyof typeof BOT_PROFILES;
export interface BotProfile { readonly reactionSeconds: number; readonly inputLagSeconds: number; readonly errorRate: number; readonly actionCooldownSeconds: number; readonly coinAppetite: number; readonly actionPreference: number; readonly visibilityMeters: number }
export const BOT_VERSION = '1.0.0';
export function validateBotProfile(value: unknown): asserts value is BotProfile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Bot profile must be an object');
  const raw = value as Record<string, unknown>;
  const fields = Object.keys(BOT_PROFILES.casual);
  if (Object.keys(raw).length !== fields.length || fields.some(key => !Object.hasOwn(raw, key))) throw new Error('Bot profile has unknown or missing fields');
  for (const key of fields) if (typeof raw[key] !== 'number' || !Number.isFinite(raw[key]) || Number(raw[key]) < 0) throw new Error(`Invalid bot ${key}`);
  for (const key of ['errorRate', 'coinAppetite', 'actionPreference']) if (Number(raw[key]) > 1) throw new Error(`Invalid bot ${key}`);
  if (Number(raw.reactionSeconds) > 2 || Number(raw.inputLagSeconds) > 1 || Number(raw.actionCooldownSeconds) < .05 || Number(raw.actionCooldownSeconds) > 2 || Number(raw.visibilityMeters) < 5 || Number(raw.visibilityMeters) > 170) throw new Error('Unsafe bot timing or visibility');
}
export function profileName(value: string): BotProfileName {
  if (value !== 'beginner' && value !== 'casual' && value !== 'expert') throw new Error(`Unknown profile: ${value}`);
  return value;
}
Object.values(BOT_PROFILES).forEach(validateBotProfile);
