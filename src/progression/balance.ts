import { POWERUP_BALANCE, validatePowerupBalance } from '../game/balance';
import { ECONOMY_BALANCE, MISSION_CHAINS, validateEconomyBalance } from './config';
import { DIFFICULTY_CONFIG, validateDifficultyConfig } from '../game/difficulty';
/** Single tuning entry point; engine/progression retain their own ownership boundaries. */
export const GAMEPLAY_BALANCE = Object.freeze({ version: 1, difficulty: DIFFICULTY_CONFIG, powerups: POWERUP_BALANCE, economy: ECONOMY_BALANCE, missions: MISSION_CHAINS });
export function validateGameplayBalance(): void { validateDifficultyConfig(DIFFICULTY_CONFIG); validatePowerupBalance(POWERUP_BALANCE); validateEconomyBalance(ECONOMY_BALANCE, MISSION_CHAINS); }
