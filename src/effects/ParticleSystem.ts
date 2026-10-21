import { EFFECTS } from './effectConfig';

/** Mutable input is copied immediately; a caller may reuse one scratch object. */
export interface ParticleSpawn {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  size: number; life: number; gravity: number;
  r: number; g: number; b: number;
  group: number;
  stretch: number;
}

/** Fixed CPU pool. Outputs are sampled analytically, never integrated per render frame. */
export class ParticleSystem {
  readonly capacity: number;
  readonly alive: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  readonly r: Float32Array;
  readonly g: Float32Array;
  readonly b: Float32Array;
  /** Stretch of the shared cube's local Z axis. No extra geometry is required. */
  readonly stretch: Float32Array;
  readonly group: Uint32Array;
  count = 0;
  peak = 0;
  time = 0;
  distance = 0;
  private freeCount: number;
  private readonly free: Uint16Array;
  private readonly seenGroups: Uint32Array;
  private readonly born: Float64Array;
  private readonly bornDistance: Float64Array;
  private readonly originX: Float64Array;
  private readonly originY: Float64Array;
  private readonly originZ: Float64Array;
  private readonly vx: Float64Array;
  private readonly vy: Float64Array;
  private readonly vz: Float64Array;
  private readonly initialSize: Float64Array;
  private readonly life: Float64Array;
  private readonly gravity: Float64Array;

  constructor(capacity: number = EFFECTS.capacity) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > EFFECTS.capacity) {
      throw new RangeError(`Particle capacity must be an integer in 1..${EFFECTS.capacity}`);
    }
    this.capacity = capacity;
    this.alive = new Uint8Array(capacity);
    this.x = new Float32Array(capacity); this.y = new Float32Array(capacity); this.z = new Float32Array(capacity);
    this.size = new Float32Array(capacity); this.alpha = new Float32Array(capacity);
    this.r = new Float32Array(capacity); this.g = new Float32Array(capacity); this.b = new Float32Array(capacity);
    this.stretch = new Float32Array(capacity); this.group = new Uint32Array(capacity);
    this.free = new Uint16Array(capacity); this.seenGroups = new Uint32Array(capacity);
    this.born = new Float64Array(capacity); this.bornDistance = new Float64Array(capacity);
    this.originX = new Float64Array(capacity); this.originY = new Float64Array(capacity); this.originZ = new Float64Array(capacity);
    this.vx = new Float64Array(capacity); this.vy = new Float64Array(capacity); this.vz = new Float64Array(capacity);
    this.initialSize = new Float64Array(capacity); this.life = new Float64Array(capacity); this.gravity = new Float64Array(capacity);
    this.freeCount = capacity;
    this.reset();
  }

  reset(distance = 0): void {
    this.count = 0; this.peak = 0; this.time = 0;
    this.distance = Number.isFinite(distance) ? distance : 0;
    this.alive.fill(0); this.size.fill(0); this.alpha.fill(0); this.group.fill(0);
    this.x.fill(0); this.y.fill(0); this.z.fill(0);
    this.r.fill(0); this.g.fill(0); this.b.fill(0); this.stretch.fill(0);
    this.freeCount = this.capacity;
    for (let i = 0; i < this.capacity; i++) this.free[i] = this.capacity - 1 - i;
  }

  get available(): number { return this.freeCount; }

  spawn(p: ParticleSpawn, bornTime = this.time, bornDistance = this.distance): boolean {
    if (this.freeCount === 0 || !Number.isFinite(bornTime) || !Number.isFinite(bornDistance)
      || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)
      || !Number.isFinite(p.vx) || !Number.isFinite(p.vy) || !Number.isFinite(p.vz)
      || !Number.isFinite(p.size) || !Number.isFinite(p.life) || !Number.isFinite(p.gravity)
      || !Number.isFinite(p.r) || !Number.isFinite(p.g) || !Number.isFinite(p.b)
      || !Number.isFinite(p.stretch) || p.size <= 0 || p.life <= 0
      || bornTime > this.time + 1e-8 || this.time - bornTime >= p.life) return false;
    const slot = this.free[--this.freeCount];
    if (slot === undefined) return false;
    this.alive[slot] = 1; this.count++; this.peak = Math.max(this.peak, this.count);
    this.born[slot] = bornTime; this.bornDistance[slot] = bornDistance;
    this.originX[slot] = p.x; this.originY[slot] = p.y; this.originZ[slot] = p.z;
    this.vx[slot] = p.vx; this.vy[slot] = p.vy; this.vz[slot] = p.vz;
    this.initialSize[slot] = p.size; this.life[slot] = p.life; this.gravity[slot] = p.gravity;
    this.r[slot] = Math.min(1, Math.max(0, p.r));
    this.g[slot] = Math.min(1, Math.max(0, p.g));
    this.b[slot] = Math.min(1, Math.max(0, p.b));
    this.group[slot] = p.group >>> 0; this.stretch[slot] = Math.min(12, Math.max(1, p.stretch));
    this.sample(slot);
    return true;
  }

  /** Not calling advance is the complete pause operation; there are no implicit clocks. */
  advance(dt: number, distance: number): void {
    if (!Number.isFinite(dt) || dt <= 0 || !Number.isFinite(distance)) return;
    this.time += dt; this.distance = distance;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      if (this.time - (this.born[i] ?? 0) >= (this.life[i] ?? 0) - 1e-10) {
        this.alive[i] = 0; this.size[i] = 0; this.alpha[i] = 0; this.group[i] = 0;
        this.free[this.freeCount++] = i; this.count--;
      } else this.sample(i);
    }
  }

  /** Counts distinct live bursts in fixed scratch storage, without retaining history. */
  activeGroups(): number {
    let groups = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      const id = this.group[i] ?? 0;
      let seen = false;
      for (let j = 0; j < groups; j++) if (this.seenGroups[j] === id) { seen = true; break; }
      if (!seen) this.seenGroups[groups++] = id;
    }
    return groups;
  }

  private sample(i: number): void {
    const age = Math.max(0, this.time - (this.born[i] ?? 0));
    const fraction = Math.min(1, age / (this.life[i] ?? 1));
    this.x[i] = (this.originX[i] ?? 0) + (this.vx[i] ?? 0) * age;
    const shrinkingSize = (this.initialSize[i] ?? 0) * (1 - fraction) ** .65;
    this.y[i] = Math.max(shrinkingSize / 2,
      (this.originY[i] ?? 0) + (this.vy[i] ?? 0) * age - .5 * (this.gravity[i] ?? 0) * age * age);
    // A deposited effect remains in the moving world, rather than following the runner/camera.
    this.z[i] = (this.originZ[i] ?? 0) + (this.vz[i] ?? 0) * age + this.distance - (this.bornDistance[i] ?? 0);
    this.size[i] = shrinkingSize; this.alpha[i] = (1 - fraction) ** .6;
  }
}
