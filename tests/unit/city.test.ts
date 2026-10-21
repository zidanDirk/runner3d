import { describe, expect, it } from 'vitest';
import input from '../../city.config.json';
import { CITY_CONFIG, CITY_FOG_DISTANCE, CITY_GENERATOR_VERSION, parseCityConfig } from '../../src/city/config';
import { CITY_BUILDING_INNER_EDGE, CITY_ROAD_CLEARANCE, cityFootprint, citySeed, generateCityChunk, getCityLimits } from '../../src/city/generator';
import { CityManager } from '../../src/city/manager';
import type { CityChunk, CityConfig, CityPlacement } from '../../src/city/types';
import { LevelGenerator } from '../../src/game/level';
import { CITY_THEMES } from '../../src/city/themes';

function withConfig(changes: Partial<CityConfig>): CityConfig {
  const chunkLength = changes.chunkLength ?? input.chunkLength;
  return parseCityConfig({ ...input, ...changes, zones: changes.zones ?? { ...input.zones, length: Math.ceil(input.zones.length / chunkLength) * chunkLength } });
}

function worldForward(chunk: CityChunk, placement: CityPlacement): number {
  return chunk.startDistance - placement.position[2];
}

describe('strict city configuration', () => {
  it('ships bounded defaults with enough visibility and actual instance capacities', () => {
    expect(CITY_CONFIG).toEqual(input);
    expect(CITY_CONFIG.aheadChunks * CITY_CONFIG.chunkLength).toBeGreaterThanOrEqual(CITY_FOG_DISTANCE);
    expect(getCityLimits()).toEqual({ chunks: 9, buildingsPerChunk: 6, lampsPerChunk: 4, decorationsPerChunk: 2, propsPerChunk: 2, buildings: 54, lamps: 36, decorations: 18, props: 18 });
    expect(Object.isFrozen(CITY_CONFIG.buildings)).toBe(true);
  });

  it('rejects unknown fields at every level and unsupported themes', () => {
    for (const invalid of [
      { ...input, extra: true },
      { ...input, buildings: { ...input.buildings, extra: 1 } },
      { ...input, streetLamps: { ...input.streetLamps, extra: 1 } },
      { ...input, theme: 'different-city' },
      null, [], false,
      { ...input, buildings: [] },
      { ...input, streetLamps: null },
    ]) expect(() => parseCityConfig(invalid)).toThrow(/city\.config\.json/);
  });

  it('rejects invalid numbers and loop bounds instead of clamping them silently', () => {
    const invalid: unknown[] = [
      { ...input, seed: -1 }, { ...input, seed: 0x100000000 }, { ...input, seed: 1.5 },
      { ...input, chunkLength: 0 }, { ...input, chunkLength: 41 }, { ...input, chunkLength: 30.5 },
      { ...input, aheadChunks: 7 }, { ...input, aheadChunks: Infinity },
      { ...input, behindChunks: 0 }, { ...input, behindChunks: NaN },
      { ...input, buildings: { ...input.buildings, density: -0.1 } },
      { ...input, buildings: { ...input.buildings, density: 1.1 } },
      { ...input, buildings: { ...input.buildings, minSpacing: 0 } },
      { ...input, buildings: { ...input.buildings, enabled: 'true' } },
      { ...input, streetLamps: { ...input.streetLamps, spacing: 0 } },
      { ...input, streetLamps: { ...input.streetLamps, spacing: 8.5 } },
      { ...input, streetLamps: { ...input.streetLamps, spacing: 25 } },
      { ...input, streetLamps: { ...input.streetLamps, enabled: 1 } },
    ];
    for (const value of invalid) expect(() => parseCityConfig(value)).toThrow(/city\.config\.json/);
    expect(() => generateCityChunk(0, 'test', { ...CITY_CONFIG, chunkLength: Infinity })).toThrow(/chunkLength/);
  });

  it('checks coupled visibility bounds and accepts a wider four-chunk horizon', () => {
    expect(() => withConfig({ aheadChunks: 5 })).toThrow(/155m/);
    expect(withConfig({ chunkLength: 40, aheadChunks: 4, behindChunks: 1 }).aheadChunks).toBe(4);
  });
});

describe('deterministic independent city chunks', () => {
  it('recreates identical data from the same seed, ID and generator version', () => {
    const first = generateCityChunk(3, 'RUNNER-01');
    const second = generateCityChunk(3, 'RUNNER-01');
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.seed).toContain(CITY_GENERATOR_VERSION);
    expect(Object.isFrozen(first.buildings)).toBe(true);
    expect(Object.isFrozen(first.buildings[0]?.position)).toBe(true);
  });

  it('changes layout with global seed, game seed and chunk ID', () => {
    const first = generateCityChunk(3, 'RUNNER-01');
    expect(generateCityChunk(3, 'another-run').buildings).not.toEqual(first.buildings);
    expect(generateCityChunk(3, 'RUNNER-01', withConfig({ seed: 7 })).buildings).not.toEqual(first.buildings);
    expect(generateCityChunk(4, 'RUNNER-01').seed).not.toEqual(first.seed);
    expect(citySeed(5)).not.toEqual(citySeed('5'));
  });

  it('does not depend on chunk request order or consume gameplay random state', () => {
    const ordered = [-2, 0, 3, 10].map((id) => generateCityChunk(id, 'order'));
    const shuffled = [10, 3, -2, 0].map((id) => generateCityChunk(id, 'order'));
    for (const chunk of ordered) expect(shuffled.find((value) => value.id === chunk.id)).toEqual(chunk);
    const level = new LevelGenerator('independent');
    const control = new LevelGenerator('independent');
    for (let id = 0; id < 20; id++) {
      generateCityChunk(id, 'independent');
      expect(level.next()).toEqual(control.next());
    }
  });

  it('uses stable IDs, ground origins, asset variants and sensible scale variation', () => {
    const chunks = Array.from({ length: 25 }, (_, id) => generateCityChunk(id - 2, 'variation'));
    const placements = chunks.flatMap((chunk) => [...chunk.buildings, ...chunk.lamps, ...chunk.decorations, ...chunk.props]);
    expect(new Set(placements.map((value) => value.id)).size).toBe(placements.length);
    expect(new Set(chunks.flatMap((chunk) => chunk.buildings.map((value) => value.assetId)))).toEqual(new Set(CITY_THEMES.flatMap((theme) => theme.buildings.assetIds)));
    expect(new Set(chunks.flatMap((chunk) => chunk.buildings.map((value) => value.scale[1]))).size).toBeGreaterThan(10);
    for (const chunk of chunks) {
      expect(chunk.startDistance).toBe(chunk.id * CITY_CONFIG.chunkLength);
      expect(chunk.length).toBe(CITY_CONFIG.chunkLength);
      for (const placement of [...chunk.buildings, ...chunk.lamps, ...chunk.decorations, ...chunk.props]) {
        expect(placement.chunkId).toBe(chunk.id);
        expect(placement.position[1]).toBe(0);
        expect(placement.position[2]).toBeLessThanOrEqual(0);
        expect(placement.position[2]).toBeGreaterThan(-chunk.length);
      }
    }
  });

  it('keeps the full rotated building footprint outside the road and camera corridor', () => {
    for (let seed = 0; seed < 25; seed++) for (let id = -2; id < 15; id++) {
      for (const placement of generateCityChunk(id, seed).buildings) {
        const footprint = cityFootprint(placement);
        expect(Math.abs(placement.position[0]) - footprint[0] / 2).toBeGreaterThanOrEqual(CITY_BUILDING_INNER_EDGE - 1e-10);
        expect(placement.scale[0]).toBeGreaterThanOrEqual(0.85);
        expect(placement.scale[0]).toBeLessThanOrEqual(1.15);
        expect(placement.scale[1]).toBeGreaterThanOrEqual(0.72);
        expect(placement.scale[1]).toBeLessThanOrEqual(1.2);
      }
    }
  });

  it('reserves minimum building spacing inside and across independently generated chunks', () => {
    for (const config of [CITY_CONFIG, withConfig({ chunkLength: 40, buildings: { ...CITY_CONFIG.buildings, density: 1, minSpacing: 1 } }), withConfig({ buildings: { ...CITY_CONFIG.buildings, density: 1, minSpacing: 4 } })]) {
      for (let seed = 0; seed < 12; seed++) {
        const chunks = Array.from({ length: 15 }, (_, id) => generateCityChunk(id - 2, seed, config));
        for (const side of [-1, 1]) {
          const buildings = chunks.flatMap((chunk) => chunk.buildings.filter((value) => Math.sign(value.position[0]) === side).map((placement) => ({ placement, distance: worldForward(chunk, placement) })));
          buildings.sort((a, b) => a.distance - b.distance);
          for (let index = 1; index < buildings.length; index++) {
            const previous = buildings[index - 1];
            const current = buildings[index];
            if (!previous || !current) throw new Error('Expected neighboring buildings');
            const gap = current.distance - previous.distance - (cityFootprint(previous.placement)[1] + cityFootprint(current.placement)[1]) / 2;
            expect(gap).toBeGreaterThanOrEqual(config.buildings.minSpacing - 1e-10);
          }
        }
      }
    }
  });

  it('places lamps on one continuous lattice for divisible and non-divisible chunk lengths', () => {
    for (const config of [CITY_CONFIG, withConfig({ chunkLength: 31, streetLamps: { ...CITY_CONFIG.streetLamps, spacing: 13 } })]) {
      const chunks = Array.from({ length: 20 }, (_, id) => generateCityChunk(id - 2, 'lamps', config));
      for (const side of [-1, 1]) {
        const lamps = chunks.flatMap((chunk) => chunk.lamps.filter((lamp) => Math.sign(lamp.position[0]) === side).map((lamp) => ({ lamp, distance: worldForward(chunk, lamp) })));
        lamps.sort((a, b) => a.distance - b.distance);
        expect(new Set(lamps.map(({ distance }) => distance)).size).toBe(lamps.length);
        for (const { lamp } of lamps) {
          expect(Math.abs(lamp.position[0]) - cityFootprint(lamp)[0] / 2).toBeGreaterThan(CITY_ROAD_CLEARANCE);
          expect(lamp.rotationY).toBe(side === -1 ? 0 : Math.PI);
        }
        for (let index = 1; index < lamps.length; index++) {
          const previous = lamps[index - 1]; const current = lamps[index];
          if (!previous || !current) throw new Error('Expected neighboring lamps');
          expect(current.distance - previous.distance).toBeCloseTo(config.streetLamps.spacing, 10);
        }
      }
    }
  });

  it('bounds density and respects both disable switches', () => {
    const dense = withConfig({ buildings: { ...CITY_CONFIG.buildings, density: 1 } });
    const sparse = withConfig({ buildings: { ...CITY_CONFIG.buildings, density: 0 } });
    expect(generateCityChunk(0, 'density', dense).buildings).toHaveLength(getCityLimits(dense).buildingsPerChunk);
    expect(generateCityChunk(0, 'density', sparse).buildings).toHaveLength(0);
    const disabled = withConfig({ buildings: { ...CITY_CONFIG.buildings, enabled: false }, streetLamps: { ...CITY_CONFIG.streetLamps, enabled: false } });
    const chunk = generateCityChunk(0, 'disabled', disabled);
    expect([...chunk.buildings, ...chunk.lamps, ...chunk.decorations, ...chunk.props]).toHaveLength(0);
  });

  it('keeps configured maximum density and lamp interval inside declared capacities', () => {
    for (const chunkLength of [26, 31, 40]) for (const spacing of [8, 13, 24]) {
      const config = withConfig({ chunkLength, buildings: { ...CITY_CONFIG.buildings, density: 1, minSpacing: 1 }, streetLamps: { ...CITY_CONFIG.streetLamps, spacing } });
      const limits = getCityLimits(config);
      for (let id = -5; id < 30; id++) {
        const chunk = generateCityChunk(id, 'maximum-capacity', config);
        expect(chunk.buildings).toHaveLength(limits.buildingsPerChunk);
        expect(chunk.lamps.length).toBeLessThanOrEqual(limits.lampsPerChunk);
        expect([...chunk.decorations, ...chunk.props]).toHaveLength(limits.decorationsPerChunk);
        expect(chunk.props.length).toBeLessThanOrEqual(limits.propsPerChunk);
      }
    }
  });

  it('rejects unsafe IDs, invalid run seeds and malformed typed configuration', () => {
    for (const id of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) expect(() => generateCityChunk(id, 'id')).toThrow(/chunk ID/);
    for (const seed of ['', 'a'.repeat(257), NaN, -1, Infinity, 0x100000000]) expect(() => generateCityChunk(0, seed)).toThrow(/seed/);
    expect(() => new CityManager({ ...CITY_CONFIG, aheadChunks: Infinity })).toThrow(/aheadChunks/);
  });
});

describe('bounded city chunk lifecycle', () => {
  it('starts with negative chunks behind the camera and updates only at boundaries', () => {
    const manager = new CityManager();
    const first = manager.snapshot;
    expect(first.currentChunk).toBe(0);
    expect(first.anchorDistance).toBe(0);
    expect(first.chunks.map((chunk) => chunk.id)).toEqual([-2, -1, 0, 1, 2, 3, 4, 5, 6]);
    expect(manager.update(29.99999)).toBe(false);
    expect(manager.snapshot).toBe(first);
    expect(manager.update(30)).toBe(true);
    expect(manager.snapshot.currentChunk).toBe(1);
    expect(manager.snapshot.anchorDistance).toBe(30);
    expect(manager.snapshot.revision).toBe(first.revision + 1);
    expect(manager.snapshot.chunks.map((chunk) => chunk.id)).toEqual([-1, 0, 1, 2, 3, 4, 5, 6, 7]);
    for (const retained of manager.snapshot.chunks.filter((chunk) => chunk.id <= 6)) {
      expect(retained).toBe(first.chunks.find((chunk) => chunk.id === retained.id));
    }
  });

  it('seeks directly to a distant bounded window and regenerates evicted data exactly', () => {
    const manager = new CityManager();
    const original = manager.snapshot.chunks;
    manager.update(10000);
    expect(manager.snapshot.revision).toBe(2);
    expect(manager.snapshot.chunks.map((chunk) => chunk.id)).toEqual([331, 332, 333, 334, 335, 336, 337, 338, 339]);
    expect(manager.snapshot.chunks).toHaveLength(9);
    manager.update(0);
    expect(manager.snapshot.chunks).toEqual(original);
    expect(manager.snapshot.chunks[0]).not.toBe(original[0]);
  });

  it('resets the entire city deterministically and can apply a new game seed', () => {
    const manager = new CityManager(CITY_CONFIG, 'first');
    const original = manager.snapshot;
    manager.update(900);
    manager.reset();
    expect(manager.snapshot.currentChunk).toBe(0);
    expect(manager.snapshot.anchorDistance).toBe(0);
    expect(manager.snapshot.chunks).toEqual(original.chunks);
    expect(manager.snapshot.chunks[0]).not.toBe(original.chunks[0]);
    expect(manager.snapshot.revision).toBeGreaterThan(original.revision);
    manager.reset('second');
    expect(manager.snapshot.seed).not.toBe(original.seed);
    expect(manager.snapshot.chunks).not.toEqual(original.chunks);
  });

  it('keeps the previous valid state when an invalid reset or distance is rejected', () => {
    const manager = new CityManager(); const before = manager.snapshot;
    for (const distance of [-1, NaN, Infinity, Number.MAX_VALUE]) expect(() => manager.update(distance)).toThrow(/City distance/);
    expect(() => manager.reset('')).toThrow(/seed/);
    expect(manager.snapshot).toBe(before);
  });

  it('simulates every metre through 10,000m without gaps, growth or nondeterministic data', () => {
    const manager = new CityManager(CITY_CONFIG, 'long-distance');
    const reference = new Map<number, CityChunk>();
    const limits = getCityLimits();
    let maximumChunks = 0;
    for (let distance = 0; distance <= 10000; distance++) {
      manager.update(distance);
      const snapshot = manager.snapshot;
      const current = Math.floor(distance / CITY_CONFIG.chunkLength);
      expect(snapshot.currentChunk).toBe(current);
      expect(snapshot.chunks.map((chunk) => chunk.id)).toEqual(Array.from({ length: limits.chunks }, (_, index) => current - CITY_CONFIG.behindChunks + index));
      expect(snapshot.chunks[0]?.startDistance).toBe((current - CITY_CONFIG.behindChunks) * CITY_CONFIG.chunkLength);
      expect(snapshot.buildingCount).toBeLessThanOrEqual(limits.buildings);
      expect(snapshot.lampCount).toBeLessThanOrEqual(limits.lamps);
      maximumChunks = Math.max(maximumChunks, snapshot.chunks.length);
      for (const chunk of snapshot.chunks) {
        const known = reference.get(chunk.id);
        if (known) expect(chunk).toBe(known);
        else {
          expect(chunk).toEqual(generateCityChunk(chunk.id, 'long-distance'));
          reference.set(chunk.id, chunk);
        }
      }
    }
    expect(maximumChunks).toBe(9);
    expect(reference.size).toBe(342);
    expect(manager.snapshot.currentChunk).toBe(333);
    expect(manager.snapshot.chunks).toEqual(new CityManager(CITY_CONFIG, 'long-distance').snapshot.chunks.map((chunk) => generateCityChunk(chunk.id + 333, 'long-distance')));
  });
});
