import { POWERUP_BALANCE, validatePowerupBalance } from '../game/balance';
import { ECONOMY_BALANCE, MISSION_CHAINS, validateEconomyBalance } from './config';
/** Single tuning entry point; engine/progression retain their own ownership boundaries. */
export const GAMEPLAY_BALANCE = Object.freeze({ powerups: POWERUP_BALANCE, economy: ECONOMY_BALANCE, missions: MISSION_CHAINS });
export function validateGameplayBalance(): void { validatePowerupBalance(POWERUP_BALANCE); validateEconomyBalance(ECONOMY_BALANCE, MISSION_CHAINS); }
