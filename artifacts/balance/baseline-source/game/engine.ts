import { RULES, laneX } from './config';
import { intersects } from './collision';
import { LevelGenerator } from './level';
import type { Action, GameState, GameView, Lane, LevelSource } from './types';
import { PowerUpGenerator, PowerUpSystem, touchesPowerUp } from './powerups';
import type { PowerUpSource } from './powerups';
import type { UpgradeLevels } from './balance';

export interface EngineOptions { upgrades?: UpgradeLevels; pickupSource?: PowerUpSource; powerups?: boolean }

export class GameEngine {
  private readonly state: GameState;
  private readonly actions: Action[] = [];
  private readonly level: LevelSource;
  private generatedThrough = -Infinity;
  private readonly powers: PowerUpSystem;
  private readonly pickups: PowerUpSource | null;

  constructor(seed: string, level: LevelSource = new LevelGenerator(seed), options: EngineOptions = {}) {
    this.level = level;
    this.powers = new PowerUpSystem(options.upgrades);
    this.pickups = options.powerups === false ? null : options.pickupSource ?? new PowerUpGenerator(seed);
    this.state = {
      seed, status: 'ready', tick: 0, distance: 0, speed: RULES.baseSpeed, score: 0, coins: 0,
      player: { lane: 1, x: 0, fromX: 0, laneElapsed: RULES.laneChangeDuration, y: 0, velocityY: 0, slideRemaining: 0 },
      rows: [], entities: [], hit: null,
      pickups: [], powerups: this.powers.active, powerupFacts: this.powers.facts, powerupsCollected: 0, scoreBonus: 0,
    };
    for (let i = 0; i < 6; i++) {
      this.state.entities.push({ id: `intro-${i}`, lane: 1, kind: 'coin', distance: 10 + i * 4, collected: false });
    }
    this.extendLevel();
  }

  get view(): GameView { return this.state; }

  start(): void {
    if (this.state.status === 'ready') this.state.status = 'running';
  }

  pause(): void {
    if (this.state.status === 'running') this.state.status = 'paused';
    this.actions.length = 0;
  }

  resume(): void {
    if (this.state.status === 'paused') this.state.status = 'running';
  }

  dispatch(action: Action): void {
    if (this.state.status === 'running' && this.actions.length < 8) this.actions.push(action);
  }

  /** The only simulation entry point; every call advances exactly one fixed tick. */
  step(): void {
    const s = this.state;
    if (s.status !== 'running') return;
    const p = s.player;
    const dt = RULES.fixedDt;
    const previousBaseScore = Math.floor(s.distance) + s.coins * RULES.coinValue;
    this.powers.step();
    for (const action of this.actions) {
      if (action === 'left' || action === 'right') {
        const next = Math.max(0, Math.min(2, p.lane + (action === 'left' ? -1 : 1))) as Lane;
        if (next !== p.lane) {
          p.fromX = p.x;
          p.lane = next;
          p.laneElapsed = 0;
        }
      } else if (action === 'jump' && p.y === 0 && p.slideRemaining <= 0) {
        p.velocityY = RULES.jumpVelocity;
      } else if (action === 'slide' && p.y === 0 && p.velocityY === 0 && p.slideRemaining <= 0) {
        p.slideRemaining = RULES.slideDuration;
      }
    }
    this.actions.length = 0;
    p.laneElapsed = Math.min(RULES.laneChangeDuration, p.laneElapsed + dt);
    const t = p.laneElapsed / RULES.laneChangeDuration;
    const ease = t * t * (3 - 2 * t);
    p.x = p.fromX + (laneX(p.lane) - p.fromX) * ease;
    p.slideRemaining = Math.max(0, p.slideRemaining - dt);
    if (p.velocityY !== 0 || p.y > 0) {
      p.velocityY -= RULES.gravity * dt;
      p.y = Math.max(0, p.y + p.velocityY * dt);
      if (p.y === 0) p.velocityY = 0;
    }
    s.tick++;
    s.speed = Math.min(RULES.maxSpeed, RULES.baseSpeed + s.distance * RULES.accelerationPerMeter);
    s.distance += s.speed * dt;
    for (const pickup of s.pickups) {
      if (!pickup.collected && touchesPowerUp(p, pickup, s.distance)) {
        this.powers.collect(pickup); s.powerupsCollected++;
      }
    }
    // At max speed movement is 0.2m/tick, below the narrowest collision window (0.625m).
    for (const entity of s.entities) {
      if (entity.collected) continue;
      const touching = intersects(p, entity, s.distance);
      const attracted = entity.kind === 'coin' && this.powers.attracts(p, entity.lane, entity.distance, s.distance);
      if (!touching && !attracted) continue;
      if (entity.kind === 'coin') {
        entity.collected = true;
        if (attracted && !touching) entity.magnetCollected = true;
        s.coins++;
      } else {
        if (this.powers.interceptCollision(entity.id)) { entity.shieldCleared = true; continue; }
        s.hit = entity.kind;
        s.status = 'over';
        this.actions.length = 0;
        break;
      }
    }
    const baseScore = Math.floor(s.distance) + s.coins * RULES.coinValue;
    s.scoreBonus += (baseScore - previousBaseScore) * (this.powers.multiplier - 1);
    s.score = baseScore + s.scoreBonus;
    s.entities = s.entities.filter((entity) => entity.distance >= s.distance - RULES.recycleBehind);
    s.rows = s.rows.filter((row) => row.distance >= s.distance - RULES.recycleBehind);
    s.pickups = s.pickups.filter((pickup) => pickup.distance >= s.distance - RULES.recycleBehind);
    if (s.tick % 240 === 0) this.powers.recycle(new Set(s.entities.map((entity) => entity.id)));
    this.extendLevel();
  }

  private extendLevel(): void {
    while (this.generatedThrough < this.state.distance + RULES.lookAhead) {
      const row = this.level.next();
      if (row.distance <= this.generatedThrough) throw new Error('Level rows must advance in distance');
      this.generatedThrough = row.distance;
      this.state.rows.push(row);
      this.state.entities.push(...row.entities);
      const pickup = this.pickups?.forRow(row);
      if (pickup) this.state.pickups.push(pickup);
    }
  }
}
