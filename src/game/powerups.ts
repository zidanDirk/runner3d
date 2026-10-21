import { laneX, RULES } from './config';
import { BASE_UPGRADES, POWERUP_BALANCE, POWERUP_TYPES, powerupDuration, upgradeLevel } from './balance';
import type { PowerUpType, UpgradeLevels } from './balance';
import { createRandom } from './random';
import type { DeepReadonly, Player, TrackRow } from './types';

export const MAX_POWERUP_PICKUPS = Math.ceil((RULES.lookAhead + RULES.rowSpacing + RULES.recycleBehind + POWERUP_BALANCE.rowOffset) / RULES.rowSpacing);

export interface PowerUpPickup { id: string; type: PowerUpType; lane: 0 | 1 | 2; distance: number; collected: boolean }
export interface PowerUpFact { type: 'powerup-collected' | 'powerup-activated' | 'powerup-expired' | 'shield-broken'; powerup: PowerUpType; entityId: string }
export interface PowerUpSource { forRow(row: DeepReadonly<TrackRow>): PowerUpPickup | null }
export class PowerUpGenerator implements PowerUpSource {
  constructor(private readonly seed: string, private readonly probability: number = POWERUP_BALANCE.rowProbability) {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Invalid power-up probability');
  }
  forRow(row: DeepReadonly<TrackRow>): PowerUpPickup | null {
    if (row.distance < POWERUP_BALANCE.firstDistance) return null;
    // Per-row independent stream: neither call order nor any other PRNG can change a pickup.
    const random = createRandom(`${this.seed}:powerups-v1:${row.index}`);
    if (random() >= this.probability) return null;
    return { id: `powerup-${row.index}`, type: POWERUP_TYPES[Math.floor(random() * 3)] ?? 'magnet',
      lane: row.safeLane, distance: row.distance + POWERUP_BALANCE.rowOffset, collected: false };
  }
}

export class PowerUpSystem {
  readonly active: Record<PowerUpType, number> = { magnet: 0, shield: 0, 'double-score': 0 };
  readonly facts: PowerUpFact[] = [];
  private readonly protectedObstacles = new Set<string>();
  readonly upgrades: UpgradeLevels;
  constructor(upgrades: UpgradeLevels = BASE_UPGRADES) {
    for (const type of POWERUP_TYPES) upgradeLevel(upgrades[type]);
    this.upgrades = { ...upgrades };
  }
  step(): void {
    this.facts.length = 0;
    for (const type of POWERUP_TYPES) {
      const before = this.active[type];
      this.active[type] = Math.max(0, before - RULES.fixedDt);
      if (before > 0 && this.active[type] <= 1e-9) {
        this.active[type] = 0;
        this.facts.push({ type: 'powerup-expired', powerup: type, entityId: type });
      }
    }
  }
  collect(pickup: PowerUpPickup): void {
    if (pickup.collected) return;
    pickup.collected = true;
    // Refresh to the level's full duration, never stack time or multipliers/charges.
    this.active[pickup.type] = powerupDuration(pickup.type, this.upgrades);
    this.facts.push({ type: 'powerup-collected', powerup: pickup.type, entityId: pickup.id },
      { type: 'powerup-activated', powerup: pickup.type, entityId: pickup.id });
  }
  interceptCollision(id: string): boolean {
    if (this.protectedObstacles.has(id)) return true;
    if (this.active.shield <= 0) return false;
    this.active.shield = 0;
    this.protectedObstacles.add(id);
    this.facts.push({ type: 'shield-broken', powerup: 'shield', entityId: id });
    return true;
  }
  recycle(existing: ReadonlySet<string>): void {
    for (const id of this.protectedObstacles) if (!existing.has(id)) this.protectedObstacles.delete(id);
  }
  attracts(player: DeepReadonly<Player>, lane: 0 | 1 | 2, coinDistance: number, distance: number): boolean {
    if (this.active.magnet <= 0) return false;
    const radius = POWERUP_BALANCE.magnetRadius[this.upgrades.magnet] ?? 3;
    return Math.hypot(player.x - laneX(lane), player.y + .9 - 1.075, distance - coinDistance) <= radius;
  }
  get multiplier(): number { return this.active['double-score'] > 0 ? POWERUP_BALANCE.multiplier : 1; }
}

export function touchesPowerUp(player: DeepReadonly<Player>, pickup: DeepReadonly<PowerUpPickup>, distance: number): boolean {
  const b = POWERUP_BALANCE;
  return Math.abs(player.x - laneX(pickup.lane)) < (RULES.playerWidth + b.pickupWidth) / 2
    && Math.abs(distance - pickup.distance) < (RULES.playerDepth + b.pickupDepth) / 2
    && player.y < b.pickupBottom + b.pickupHeight
    && player.y + (player.slideRemaining > 0 ? RULES.slidingHeight : RULES.standingHeight) > b.pickupBottom;
}
