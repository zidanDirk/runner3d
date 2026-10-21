import type { EffectPalette, FeedbackEvent, RGB } from '../feedback/types';
import { EFFECTS, type EffectBurst } from './effectConfig';
import { ParticleSystem, type ParticleSpawn } from './ParticleSystem';

interface EffectPlayer { readonly x: number; readonly y: number; readonly slideRemaining: number }

/** One bounded, deterministic visual consumer. The game state is always read-only. */
export class EffectManager {
  readonly particles = new ParticleSystem();
  density = 1;
  time = 0;
  coinPulse = 0;
  hitPulse = 0;
  speedNotice = 0;
  private readonly eventIds: (string | undefined)[] = new Array<string | undefined>(EFFECTS.rememberedEvents);
  private remembered = 0;
  private eventCursor = 0;
  private latestRun = -1;
  private latestTick = -1;
  private randomState = 1;
  private groupSequence = 0;
  private coinTime = -Infinity;
  private hitTime = -Infinity;
  private speedTime = -Infinity;
  private collisionSeen = false;
  private emissionStopped = false;
  private nextSlideTime = Infinity;
  private nextSpeedTime: number = EFFECTS.speedInterval;
  private previousDistance = 0;
  private previousX = 0;
  private previousY = 0;
  private previousSlideRemaining = 0;
  private hasPlayer = false;
  private readonly scratch: ParticleSpawn = {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    size: .05, life: .3, gravity: 0, r: 1, g: 1, b: 1, group: 0, stretch: 1,
  };

  constructor(seed = 'effects') { this.reset(seed); }

  reset(seed: string, distance = 0): void {
    this.time = 0; this.coinPulse = 0; this.hitPulse = 0; this.speedNotice = 0;
    this.coinTime = -Infinity; this.hitTime = -Infinity; this.speedTime = -Infinity;
    this.collisionSeen = false; this.emissionStopped = false;
    this.nextSlideTime = Infinity; this.nextSpeedTime = EFFECTS.speedInterval;
    this.eventIds.fill(undefined); this.remembered = 0; this.eventCursor = 0; this.groupSequence = 0;
    this.latestRun = -1; this.latestTick = -1;
    this.previousDistance = Number.isFinite(distance) ? distance : 0;
    this.previousX = 0; this.previousY = 0; this.previousSlideRemaining = 0; this.hasPlayer = false;
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
    this.randomState = hash >>> 0 || 1;
    this.particles.reset(this.previousDistance);
  }

  handle(event: FeedbackEvent, palette: EffectPalette, reduced: boolean): void {
    if (!this.remember(event)) return;
    const [x, y, z] = event.position;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(event.distance)) return;
    switch (event.type) {
      case 'coin':
        this.coinTime = this.time; this.coinPulse = 1;
        if (event.attracted) this.magnetFlight(event);
        this.burst('coin', x, y, z, event.distance, palette.coin, reduced, event.intensity);
        break;
      case 'jump':
      case 'land':
        this.burst(event.type, x, y + .045, z, event.distance, palette.dust, reduced, event.intensity);
        break;
      case 'slide':
        this.nextSlideTime = this.time + EFFECTS.slideInterval;
        this.previousSlideRemaining = Math.max(0, event.duration);
        this.previousX = x; this.previousY = y; this.hasPlayer = true;
        this.burst('slide', x, y + .055, z + .24, event.distance, palette.dust, reduced, event.intensity);
        break;
      case 'collision':
        if (this.collisionSeen) break;
        this.collisionSeen = true; this.hitTime = this.time; this.hitPulse = 1;
        this.emissionStopped = true;
        this.nextSlideTime = Infinity;
        this.burst('collision', x, y, z, event.distance, palette.impact, reduced, event.intensity);
        break;
      case 'powerup-activated': this.burst('coin', x, y, z, event.distance, event.powerup === 'shield' ? [.25, .9, 1] : palette.coin, reduced, 1); break;
      case 'shield-broken': this.burst('collision', x, y, z, event.distance, [.25, .9, 1], reduced, .8); break;
      case 'speed': this.speedTime = this.time; this.speedNotice = 1; break;
      // Existing lean/camera already provide symmetric lane feedback. The game-over UI owns its message.
      case 'lane': break;
      case 'game-over': this.nextSlideTime = Infinity; this.emissionStopped = true; break;
    }
  }

  advance(dt: number, distance: number, player: EffectPlayer, speed: number, reduced: boolean, palette: EffectPalette): void {
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(distance)) return;
    const start = this.time;
    this.time += dt;
    this.particles.advance(dt, distance);
    this.coinPulse = this.pulse(this.coinTime, EFFECTS.coinPulseDuration);
    this.hitPulse = this.pulse(this.hitTime, EFFECTS.hitPulseDuration);
    this.speedNotice = this.pulse(this.speedTime, EFFECTS.speedNoticeDuration);
    if (!this.hasPlayer) { this.previousX = player.x; this.previousY = player.y; this.hasPlayer = true; }

    // Schedule in seconds, not render frames. Interpolation only locates visual emission between observations.
    const slideEnd = player.slideRemaining > 0 ? this.time
      : start + Math.min(dt, Math.max(0, this.previousSlideRemaining));
    if (!this.emissionStopped && (player.slideRemaining > 0 || this.previousSlideRemaining > 0)) {
      while (this.nextSlideTime <= slideEnd + 1e-10) {
        const t = Math.min(1, Math.max(0, (this.nextSlideTime - start) / dt));
        this.burst('slide', this.previousX + (player.x - this.previousX) * t,
          this.previousY + (player.y - this.previousY) * t + .055, .24,
          this.previousDistance + (distance - this.previousDistance) * t,
          palette.dust, reduced, 1, this.nextSlideTime);
        this.nextSlideTime += EFFECTS.slideInterval;
      }
    }
    if (player.slideRemaining <= 0) this.nextSlideTime = Infinity;

    if (!reduced && !this.emissionStopped && speed > EFFECTS.speedThreshold) {
      while (this.nextSpeedTime <= this.time + 1e-10) {
        const t = Math.min(1, Math.max(0, (this.nextSpeedTime - start) / dt));
        this.edgeTrails(this.nextSpeedTime, this.previousDistance + (distance - this.previousDistance) * t, palette.trail);
        this.nextSpeedTime += EFFECTS.speedInterval;
      }
    } else this.nextSpeedTime = (Math.floor((this.time + 1e-10) / EFFECTS.speedInterval) + 1) * EFFECTS.speedInterval;

    this.previousDistance = distance; this.previousX = player.x; this.previousY = player.y;
    this.previousSlideRemaining = player.slideRemaining;
  }

  stats(): { particles: number; capacity: number; peak: number; activeEffects: number; rememberedEvents: number; free: number } {
    return { particles: this.particles.count, capacity: this.particles.capacity, peak: this.particles.peak,
      activeEffects: this.particles.activeGroups(), rememberedEvents: this.remembered, free: this.particles.available };
  }

  private pulse(start: number, duration: number): number {
    return Math.max(0, 1 - (this.time - start) / duration);
  }

  private remember(event: FeedbackEvent): boolean {
    // The source delivers completed ticks in order. Reject old facts even after their
    // IDs leave the ring; the ring handles the small set of facts sharing one tick.
    if (event.runId < this.latestRun || (event.runId === this.latestRun && event.tick < this.latestTick)) return false;
    if (event.runId > this.latestRun) {
      this.latestRun = event.runId; this.latestTick = -1;
      this.eventIds.fill(undefined); this.remembered = 0; this.eventCursor = 0;
    }
    for (let i = 0; i < this.remembered; i++) if (this.eventIds[i] === event.id) return false;
    this.latestTick = event.tick;
    this.eventIds[this.eventCursor] = event.id;
    this.eventCursor = (this.eventCursor + 1) % EFFECTS.rememberedEvents;
    this.remembered = Math.min(EFFECTS.rememberedEvents, this.remembered + 1);
    return true;
  }

  private random(): number {
    let value = this.randomState;
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    this.randomState = value >>> 0;
    return this.randomState / 4294967296;
  }

  private nextGroup(): number {
    this.groupSequence = (this.groupSequence + 1) >>> 0 || 1;
    return this.groupSequence;
  }

  private burst(kind: EffectBurst, x: number, y: number, z: number, distance: number,
    color: RGB, reduced: boolean, intensity: number, bornTime = this.time): void {
    const preset = EFFECTS[kind];
    const density = Math.max(0, Math.min(1, this.density));
    const count = Math.round(preset.count * density * (reduced ? EFFECTS.reducedParticleRatio : 1));
    const force = Number.isFinite(intensity) ? Math.min(1.2, Math.max(.6, intensity)) : 1;
    const group = this.nextGroup();
    const angularOffset = this.random() * Math.PI * 2;
    const p = this.scratch;
    p.group = group; p.stretch = 1; p.life = preset.life; p.gravity = preset.gravity;
    p.r = color[0]; p.g = color[1]; p.b = color[2];
    for (let i = 0; i < count; i++) {
      const angle = angularOffset + i / count * Math.PI * 2;
      const outward = preset.horizontal * (.65 + this.random() * .35) * force;
      p.x = x + Math.cos(angle) * preset.spread * this.random();
      p.y = y + (kind === 'coin' || kind === 'collision' ? (this.random() - .5) * preset.spread : 0);
      p.z = z + Math.sin(angle) * preset.spread * this.random();
      p.vx = Math.cos(angle) * outward;
      p.vy = preset.upward * (.6 + this.random() * .4) * force;
      p.vz = Math.sin(angle) * outward + (kind === 'slide' ? 1.7 : .4);
      p.size = preset.size * (.75 + this.random() * .25);
      this.particles.spawn(p, bornTime, distance);
    }
  }

  private magnetFlight(event: FeedbackEvent & { type: 'coin' }): void {
    const p = this.scratch;
    const [x, y, z] = event.position;
    p.x = x; p.y = y; p.z = z; p.life = .22; p.gravity = 0;
    p.vx = ((event.targetX ?? x) - x) / p.life;
    p.vy = ((event.targetY ?? y) - y) / p.life;
    p.vz = -z / p.life - (event.speed ?? 16);
    p.r = 1; p.g = .8; p.b = .25; p.size = .15; p.group = this.nextGroup(); p.stretch = 1;
    this.particles.spawn(p, this.time, event.distance);
  }

  private edgeTrails(bornTime: number, distance: number, color: RGB): void {
    const group = this.nextGroup();
    if ((group % 100) / 100 >= Math.max(0, Math.min(1, this.density))) return;
    const p = this.scratch;
    p.group = group; p.stretch = EFFECTS.speed.stretch; p.size = EFFECTS.speed.size;
    p.life = EFFECTS.speed.life; p.gravity = 0; p.vx = 0; p.vy = 0; p.vz = 2.2;
    p.r = color[0]; p.g = color[1]; p.b = color[2]; p.y = .2;
    for (let side = -1; side <= 1; side += 2) {
      p.x = side * EFFECTS.roadEdgeX;
      p.z = -8 - this.random() * 8;
      this.particles.spawn(p, bornTime, distance);
    }
  }
}
