import { GameEngine } from '../game/engine';
import { createRandom } from '../game/random';
import { PowerUpGenerator } from '../game/powerups';
import { BASE_UPGRADES, POWERUP_TYPES } from '../game/balance';
import { RULES } from '../game/config';
import type { EngineOptions } from '../game/engine';
import type { PowerUpSource } from '../game/powerups';
import type { PowerUpType, UpgradeLevels } from '../game/balance';
import type { Action, GameView, Lane, LevelSource, TrackRow, DeepReadonly } from '../game/types';
import { BOT_PROFILES, BOT_VERSION, validateBotProfile } from './profiles';
import type { BotProfile, BotProfileName } from './profiles';

export interface EngineLike { readonly view: GameView; start(): void; step(): void; dispatch(action: Action): void }
export interface EngineConstructor { new(seed: string, level?: LevelSource, options?: EngineOptions): EngineLike }
export interface SimulationBindings { readonly Engine: EngineConstructor; readonly Pickup: new(seed: string) => PowerUpSource; readonly fixedDt: number }
export const PRODUCTION_BINDINGS: SimulationBindings = { Engine: GameEngine, Pickup: PowerUpGenerator, fixedDt: RULES.fixedDt };
export interface SimulationOptions {
  readonly seed: string; readonly profile: BotProfileName | BotProfile; readonly distance: number;
  readonly upgrades?: UpgradeLevels; readonly allowedPowers?: readonly PowerUpType[]; readonly trace?: boolean;
}
export interface ActionRecord { readonly tick: number; readonly action: Action }
export interface SimulationResult {
  readonly seed: string; readonly profile: BotProfileName | 'custom'; readonly botVersion: string;
  readonly distance: number; readonly seconds: number; readonly ticks: number; readonly status: 'over' | 'censored';
  readonly death: 'hurdle' | 'gate' | 'block' | null; readonly coins: number; readonly score: number; readonly scoreBonus: number;
  readonly pickups: number; readonly collisions: number; readonly shieldBreaks: number; readonly shieldExpirations: number; readonly shieldRefreshes: number;
  readonly magnetCoins: number; readonly coinsPassed: number; readonly activeSeconds: Readonly<Record<PowerUpType, number>>;
  readonly collectedByType: Readonly<Record<PowerUpType, number>>; readonly activeMaskSeconds: readonly number[]; readonly actions: Readonly<Record<Action, number>>;
  readonly decisions: number; readonly mistakenDecisions: number; readonly actionPlans: number; readonly routePlans: number;
  readonly trace?: readonly ActionRecord[];
}
interface Plan { readonly row: DeepReadonly<TrackRow>; readonly target: Lane; readonly action: 'jump' | 'slide' | null; readonly readyTick: number; performed: boolean }

/** A limited-horizon observation/decision policy. It only dispatches the production input API. */
export class SimulatedPlayer {
  private readonly random: () => number;
  private plan: Plan | null = null;
  private lastActionTick = -Infinity;
  readonly actions: Record<Action, number> = { left: 0, right: 0, jump: 0, slide: 0 };
  readonly trace: ActionRecord[] = [];
  decisions = 0;
  mistakenDecisions = 0;
  actionPlans = 0;
  routePlans = 0;
  constructor(private readonly seed: string, readonly profile: BotProfile, private readonly fixedDt: number, private readonly keepTrace = false) {
    validateBotProfile(profile);
    if (!Number.isFinite(fixedDt) || fixedDt <= 0 || fixedDt > .1) throw new Error('Invalid simulation time step');
    this.random = createRandom(`${seed}:balance-bot:${BOT_VERSION}`);
  }
  get seedIdentity(): string { return this.seed; }
  update(engine: EngineLike): void {
    const s = engine.view;
    // Keep the selected route until its trailing coin/power-up opportunity has passed.
    if (this.plan !== null && s.distance > this.plan.row.distance + 9) this.plan = null;
    if (this.plan === null) {
      const row = s.rows.find(candidate => candidate.distance > s.distance - 1 && candidate.distance - s.distance <= this.profile.visibilityMeters);
      if (row !== undefined) this.plan = this.decide(s, row);
    }
    const plan = this.plan;
    if (plan === null || s.tick < plan.readyTick || s.tick - this.lastActionTick < Math.ceil(this.profile.actionCooldownSeconds / this.fixedDt)) return;
    if (s.player.lane !== plan.target) {
      this.send(engine, plan.target < s.player.lane ? 'left' : 'right');
      return;
    }
    if (plan.action === null || plan.performed) return;
    // Timed inputs rather than an alternative jump integrator. The actual engine may reject an input.
    const timeToRow = (plan.row.distance - s.distance) / s.speed;
    const lead = plan.action === 'jump' ? .40 : .29;
    if (timeToRow <= lead && timeToRow >= -.08) {
      plan.performed = true;
      this.send(engine, plan.action);
    }
  }
  private decide(s: GameView, row: DeepReadonly<TrackRow>): Plan {
    this.decisions++;
    // The policy sees concrete visible entities, not the generator's safeLane metadata.
    const obstacles = row.entities.filter(entity => entity.kind !== 'coin');
    const open = ([0, 1, 2] as const).filter(lane => !obstacles.some(entity => entity.lane === lane));
    const coinLane = row.entities.find(entity => entity.kind === 'coin')?.lane ?? s.player.lane;
    let target: Lane = open.includes(s.player.lane) ? s.player.lane : open.reduce<Lane>((best, lane) => Math.abs(lane - s.player.lane) < Math.abs(best - s.player.lane) ? lane : best, open[0] ?? s.player.lane);
    let action: 'jump' | 'slide' | null = null;
    const harvest = this.random() < this.profile.coinAppetite;
    const currentObstacle = obstacles.find(entity => entity.lane === s.player.lane);
    const useAction = this.random() < this.profile.actionPreference;
    if (currentObstacle !== undefined && currentObstacle.kind !== 'block' && useAction && !harvest) {
      target = s.player.lane; action = currentObstacle.kind === 'hurdle' ? 'jump' : 'slide'; this.actionPlans++;
    } else {
      if (harvest && open.includes(coinLane)) target = coinLane;
      this.routePlans++;
    }
    if (this.random() < this.profile.errorRate) {
      this.mistakenDecisions++;
      // Explainable error mixture: ignored cue, wrong lane, or wrong vertical action.
      const mistake = Math.floor(this.random() * 3);
      if (mistake === 0) { target = s.player.lane; action = null; }
      else if (mistake === 1) { target = ((target + 1 + Math.floor(this.random() * 2)) % 3) as Lane; action = null; }
      else { target = s.player.lane; action = currentObstacle?.kind === 'gate' ? 'jump' : 'slide'; }
    }
    const delay = this.profile.reactionSeconds * (.8 + this.random() * .4) + this.profile.inputLagSeconds;
    return { row, target, action, readyTick: s.tick + Math.ceil(delay / this.fixedDt), performed: false };
  }
  private send(engine: EngineLike, action: Action): void {
    this.lastActionTick = engine.view.tick;
    this.actions[action]++;
    if (this.keepTrace) this.trace.push({ tick: engine.view.tick, action });
    engine.dispatch(action);
  }
}

export function simulateRun(options: SimulationOptions, bindings: SimulationBindings = PRODUCTION_BINDINGS): SimulationResult {
  if (options.seed.length === 0 || options.seed.length > 160) throw new Error('Simulation seed must have 1..160 characters');
  if (!Number.isFinite(options.distance) || options.distance < 48 || options.distance > 100_000) throw new Error('Simulation distance must be 48..100000m');
  const profile = typeof options.profile === 'string' ? BOT_PROFILES[options.profile] : options.profile;
  if (profile === undefined) throw new Error('Unknown simulation profile');
  validateBotProfile(profile);
  const allowed = options.allowedPowers ?? POWERUP_TYPES;
  if (new Set(allowed).size !== allowed.length || allowed.some(type => !POWERUP_TYPES.includes(type))) throw new Error('Invalid power-up subset');
  const generator = new bindings.Pickup(options.seed);
  const engine = new bindings.Engine(options.seed, undefined, { upgrades: options.upgrades ?? BASE_UPGRADES, powerups: allowed.length > 0,
    pickupSource: { forRow: row => { const pickup = generator.forRow(row); return pickup !== null && allowed.includes(pickup.type) ? pickup : null; } } });
  const bot = new SimulatedPlayer(options.seed, profile, bindings.fixedDt, options.trace);
  const activeSeconds: Record<PowerUpType, number> = { magnet: 0, shield: 0, 'double-score': 0 };
  const collectedByType: Record<PowerUpType, number> = { magnet: 0, shield: 0, 'double-score': 0 };
  const activeMaskSeconds = [0, 0, 0, 0, 0, 0, 0, 0];
  const countedMagnet = new Set<string>(), countedPassed = new Set<string>();
  let shieldBreaks = 0, shieldExpirations = 0, shieldRefreshes = 0, magnetCoins = 0, coinsPassed = 0;
  engine.start();
  const maximumTicks = Math.ceil(options.distance / 1 / bindings.fixedDt) + 1;
  while (engine.view.status === 'running' && engine.view.distance < options.distance) {
    const beforeShield = engine.view.powerups.shield;
    bot.update(engine); engine.step();
    const s = engine.view;
    let mask = 0;
    for (let index = 0; index < POWERUP_TYPES.length; index++) {
      const type = POWERUP_TYPES[index];
      if (type !== undefined && s.powerups[type] > 0) { activeSeconds[type] += bindings.fixedDt; mask |= 1 << index; }
    }
    activeMaskSeconds[mask] = (activeMaskSeconds[mask] ?? 0) + bindings.fixedDt;
    for (const fact of s.powerupFacts) {
      if (fact.type === 'shield-broken') shieldBreaks++;
      if (fact.type === 'powerup-expired' && fact.powerup === 'shield') shieldExpirations++;
      if (fact.type === 'powerup-collected') { collectedByType[fact.powerup]++; if (fact.powerup === 'shield' && beforeShield > bindings.fixedDt) shieldRefreshes++; }
    }
    for (const entity of s.entities) if (entity.kind === 'coin') {
      if (entity.magnetCollected === true && !countedMagnet.has(entity.id)) { countedMagnet.add(entity.id); magnetCoins++; }
      if ((entity.distance <= s.distance || entity.collected) && !countedPassed.has(entity.id)) { countedPassed.add(entity.id); coinsPassed++; }
    }
    if (s.tick % 240 === 0) {
      const current = new Set(s.entities.map(entity => entity.id));
      for (const id of countedMagnet) if (!current.has(id)) countedMagnet.delete(id);
      for (const id of countedPassed) if (!current.has(id)) countedPassed.delete(id);
    }
    if (s.tick > maximumTicks) throw new Error('Simulation exceeded its bounded tick budget');
  }
  const s = engine.view;
  return { seed: options.seed, profile: typeof options.profile === 'string' ? options.profile : 'custom', botVersion: BOT_VERSION,
    distance: s.distance, seconds: s.tick * bindings.fixedDt, ticks: s.tick, status: s.status === 'over' ? 'over' : 'censored', death: s.hit,
    coins: s.coins, score: s.score, scoreBonus: s.scoreBonus, pickups: s.powerupsCollected, collisions: shieldBreaks + (s.hit === null ? 0 : 1),
    shieldBreaks, shieldExpirations, shieldRefreshes, magnetCoins, coinsPassed, activeSeconds, collectedByType, activeMaskSeconds,
    actions: { ...bot.actions }, decisions: bot.decisions, mistakenDecisions: bot.mistakenDecisions, actionPlans: bot.actionPlans, routePlans: bot.routePlans,
    ...(options.trace === true ? { trace: bot.trace } : {}) };
}
