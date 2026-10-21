import { CITY_CONFIG, parseCityConfig } from './config';
import { citySeed, generateCityChunk } from './generator';
import type { CityChunk, CityConfig, CitySnapshot } from './types';

/** Bounded active window; generation is triggered only by a chunk boundary. */
export class CityManager {
  readonly config: CityConfig;
  private runSeed: string;
  private active = new Map<number, CityChunk>();
  private snapshotValue: CitySnapshot;
  private revision = 0;

  constructor(config: CityConfig = CITY_CONFIG, runSeed = 'RUNNER-01') {
    this.config = parseCityConfig(config);
    this.runSeed = runSeed;
    this.snapshotValue = Object.freeze({
      revision: 0, currentChunk: 0, anchorDistance: 0, seed: citySeed(runSeed, this.config),
      chunks: Object.freeze([]), buildingCount: 0, lampCount: 0, decorationCount: 0, propCount: 0,
    });
    this.update(0);
  }

  get snapshot(): CitySnapshot { return this.snapshotValue; }

  update(distance: number): boolean {
    if (!Number.isFinite(distance) || distance < 0 || distance > Number.MAX_SAFE_INTEGER - (this.config.aheadChunks + 3) * this.config.chunkLength) {
      throw new Error('City distance must be finite, nonnegative and within the safe integer range');
    }
    const currentChunk = Math.floor(distance / this.config.chunkLength);
    if (this.active.size > 0 && currentChunk === this.snapshotValue.currentChunk) return false;
    const next = new Map<number, CityChunk>();
    for (let id = currentChunk - this.config.behindChunks; id <= currentChunk + this.config.aheadChunks; id++) {
      next.set(id, this.active.get(id) ?? generateCityChunk(id, this.runSeed, this.config));
    }
    // No historical chunk cache: removed chunks lose their manager reference.
    this.active = next;
    const chunks = Object.freeze([...next.values()]);
    this.snapshotValue = Object.freeze({
      revision: ++this.revision, currentChunk,
      anchorDistance: currentChunk * this.config.chunkLength,
      seed: citySeed(this.runSeed, this.config), chunks,
      buildingCount: chunks.reduce((sum, chunk) => sum + chunk.buildings.length, 0),
      lampCount: chunks.reduce((sum, chunk) => sum + chunk.lamps.length, 0),
      decorationCount: chunks.reduce((sum, chunk) => sum + chunk.decorations.length, 0),
      propCount: chunks.reduce((sum, chunk) => sum + chunk.props.length, 0),
    });
    return true;
  }

  reset(runSeed = this.runSeed): void {
    // Validate before replacing the previous valid state.
    citySeed(runSeed, this.config);
    this.runSeed = runSeed;
    this.active.clear();
    this.update(0);
  }
}
