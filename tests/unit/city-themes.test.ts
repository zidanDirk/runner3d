import { describe, expect, it } from 'vitest';
import input from '../../themes/city-themes.json';
import manifest from '../../src/assets/generated/manifest.json';
import { CITY_CONFIG, parseCityConfig } from '../../src/city/config';
import { cityFootprint, generateCityChunk, getCityLimits, CITY_ROAD_CLEARANCE } from '../../src/city/generator';
import { CityManager } from '../../src/city/manager';
import { CITY_THEMES, CITY_THEME_IDS, getCityTheme, parseCityThemes } from '../../src/city/themes';
import { getCityZone, getThemeTransition, getZoneThemeId } from '../../src/city/zones';
import { LevelGenerator } from '../../src/game/level';

function changedTheme(changes: Record<string, unknown>): unknown {
  return { ...input, themes: [{ ...input.themes[0], ...changes }, ...input.themes.slice(1)] };
}

describe('strict versioned city theme registry', () => {
  it('parses the two real themes and all referenced assets from the generated manifest', () => {
    expect(parseCityThemes(input)).toEqual(CITY_THEMES);
    expect(CITY_THEME_IDS).toEqual(['dusk-city', 'neon-city']);
    expect(getCityTheme('dusk-city').buildings.assetIds).toHaveLength(4);
    expect(getCityTheme('neon-city').buildings.assetIds).toHaveLength(2);
    for (const theme of CITY_THEMES) {
      expect(Object.isFrozen(theme)).toBe(true);
      expect(Object.isFrozen(theme.buildings.assetIds)).toBe(true);
      for (const id of [...theme.buildings.assetIds, theme.decorations.lampAssetId, ...(theme.decorations.billboardAssetId ? [theme.decorations.billboardAssetId] : [])]) {
        expect(manifest.assets[id].role).toBe('decoration');
        expect(manifest.assets[id].bytes).toBeGreaterThan(0);
      }
    }
    expect(() => getCityTheme('unknown-theme')).toThrow(/unknown theme/);
  });

  it('rejects unknown fields at the root and every theme section', () => {
    const first = input.themes[0];
    if (!first) throw new Error('Missing theme fixture');
    for (const invalid of [null, [], { ...input, arbitrary: true }, { ...input, schemaVersion: 2 }, changedTheme({ exec: 'forbidden' })]) {
      expect(() => parseCityThemes(invalid)).toThrow(/City themes/);
    }
    for (const section of ['sky', 'lighting', 'road', 'buildings', 'decorations', 'atmosphere'] as const) {
      expect(() => parseCityThemes(changedTheme({ [section]: { ...first[section], arbitrary: true } }))).toThrow(/unknown field/);
      expect(() => parseCityThemes(changedTheme({ [section]: null }))).toThrow(/must be an object/);
    }
  });

  it('rejects duplicate or invalid IDs, unsupported versions and invalid registry sizes', () => {
    for (const invalid of [
      { ...input, themes: [] }, { ...input, themes: Array.from({ length: 9 }, () => input.themes[0]) },
      { ...input, themes: [input.themes[0], input.themes[0]] },
      changedTheme({ id: '../other' }), changedTheme({ id: 'neon-city\n' }), changedTheme({ id: '' }),
      changedTheme({ name: '  ' }), changedTheme({ version: 'latest' }), changedTheme({ version: '01.0.0' }),
    ]) expect(() => parseCityThemes(invalid)).toThrow(/City themes/);
  });

  it('validates colors, finite illumination, sky opacity and fog visibility budgets', () => {
    const first = input.themes[0];
    if (!first) throw new Error('Missing theme fixture');
    for (const background of ['red', '#xyzxyz', '#123', '#12345678', '#123456\n', 'url(example)', 2]) {
      expect(() => parseCityThemes(changedTheme({ sky: { ...first.sky, background } }))).toThrow(/background/);
    }
    for (const hemisphereIntensity of [-1, 5, NaN, Infinity, '2']) {
      expect(() => parseCityThemes(changedTheme({ lighting: { ...first.lighting, hemisphereIntensity } }))).toThrow(/hemisphereIntensity/);
    }
    expect(() => parseCityThemes(changedTheme({ sky: { ...first.sky, sunOpacity: 1.1 } }))).toThrow(/sunOpacity/);
    expect(() => parseCityThemes(changedTheme({ atmosphere: { fogNear: 80, fogFar: 100 } }))).toThrow(/fog range/);
    expect(() => parseCityThemes(changedTheme({ atmosphere: { fogNear: 45, fogFar: 156 } }))).toThrow(/fogFar/);
  });

  it('rejects missing, duplicate, wrong-role and wrong-type resource references', () => {
    const first = input.themes[0];
    if (!first) throw new Error('Missing theme fixture');
    for (const assetIds of [[], ['not-an-asset'], ['roadblock'], ['street-lamp'], ['city-building-01', 'city-building-01']]) {
      expect(() => parseCityThemes(changedTheme({ buildings: { assetIds } }))).toThrow(/City themes/);
    }
    expect(() => parseCityThemes(changedTheme({ decorations: { ...first.decorations, lampAssetId: 'city-building-01' } }))).toThrow(/street-lamp/);
    expect(() => parseCityThemes(changedTheme({ decorations: { ...first.decorations, billboardAssetId: 'street-lamp' } }))).toThrow(/billboard/);
    const assets = structuredClone(manifest.assets);
    assets['city-building-01'].role = 'obstacle';
    expect(() => parseCityThemes(input, assets)).toThrow(/invalid building/);
  });

  it('uses real manifest dimensions to reject unsafe asset footprints and invalid bounds', () => {
    for (const dimensions of [[6, 12, 4], [4, 31, 4], [4, 12, 6], [0, 12, 4], [4, NaN, 4], [4, 12]]) {
      const assets = structuredClone(manifest.assets);
      assets['city-building-01'].dimensions = dimensions;
      expect(() => parseCityThemes(input, assets)).toThrow(/dimensions/);
    }
  });

  it('can add a third data-only theme using valid registered assets', () => {
    const extra = { ...input.themes[0], id: 'third-city', name: 'Third City', version: '2.1.0' };
    expect(parseCityThemes({ ...input, themes: [...input.themes, extra] }).map((theme) => theme.id)).toContain('third-city');
  });
});

describe('deterministic zones and continuous environment transitions', () => {
  it('supplies aligned defaults for legacy configs and rejects invalid zone bounds', () => {
    const { zones: _zones, ...legacy } = CITY_CONFIG;
    expect(parseCityConfig(legacy).zones).toEqual(CITY_CONFIG.zones);
    expect(parseCityConfig({ ...legacy, chunkLength: 31 }).zones.length % 31).toBe(0);
    for (const zones of [null, [], { ...CITY_CONFIG.zones, extra: 1 },
      { ...CITY_CONFIG.zones, length: 0 }, { ...CITY_CONFIG.zones, length: 1801 }, { ...CITY_CONFIG.zones, length: 601 },
      { ...CITY_CONFIG.zones, transitionChunks: 0 }, { ...CITY_CONFIG.zones, transitionChunks: 5 }, { ...CITY_CONFIG.zones, transitionChunks: 1.5 },
      { ...CITY_CONFIG.zones, sequence: [] }, { ...CITY_CONFIG.zones, sequence: ['unknown'] },
      { ...CITY_CONFIG.zones, sequence: Array.from({ length: 9 }, () => 'dusk-city') },
    ]) expect(() => parseCityConfig({ ...CITY_CONFIG, zones })).toThrow(/city\.config\.json/);
  });

  it('derives theme ownership solely from zone ID, independent of generation order', () => {
    expect(Array.from({ length: 6 }, (_, id) => getZoneThemeId(id))).toEqual(['dusk-city', 'neon-city', 'dusk-city', 'neon-city', 'dusk-city', 'neon-city']);
    const ordered = Array.from({ length: 16 }, (_, id) => getZoneThemeId(id));
    for (const id of [15, 1, 7, 0, 9, 2]) expect(getZoneThemeId(id)).toBe(ordered[id]);
    for (const seed of ['RUNNER-01', 'another-run']) {
      expect(generateCityChunk(20, seed).themeId).toBe(getZoneThemeId(1));
      expect(generateCityChunk(40, seed).themeId).toBe(getZoneThemeId(2));
    }
    expect(getCityZone(-60)).toEqual({ zoneId: 0, themeId: 'dusk-city', startDistance: 0, endDistance: 600 });
    expect(getCityZone(599.999).zoneId).toBe(0);
    expect(getCityZone(600).zoneId).toBe(1);
    for (const id of [-1, NaN, Infinity, 1.5]) expect(() => getZoneThemeId(id)).toThrow(/zone ID/);
  });

  it('computes exact transition boundaries without changing stable chunk ownership', () => {
    expect(getThemeTransition(590)).toMatchObject({ themeId: 'dusk-city', fromThemeId: 'dusk-city', toThemeId: 'dusk-city', nextThemeId: 'neon-city', progress: 1, distanceToBoundary: 10 });
    expect(getThemeTransition(600)).toMatchObject({ zoneId: 1, themeId: 'neon-city', fromThemeId: 'dusk-city', toThemeId: 'neon-city', progress: 0, distanceToBoundary: 600 });
    expect(getThemeTransition(615).progress).toBe(0.25);
    expect(getThemeTransition(630).progress).toBe(0.5);
    expect(getThemeTransition(660).progress).toBe(1);
    expect(getThemeTransition(1199.999).progress).toBe(1);
    expect(getThemeTransition(1200)).toMatchObject({ fromThemeId: 'neon-city', toThemeId: 'dusk-city', progress: 0, nextThemeId: 'neon-city' });
    expect(getThemeTransition(1230).progress).toBe(0.5);
    for (const distance of [-1, NaN, Infinity, Number.MAX_VALUE]) expect(() => getThemeTransition(distance)).toThrow(/distance/);
  });

  it('supports configurable zone and transition lengths', () => {
    const config = parseCityConfig({ ...CITY_CONFIG, zones: { length: 900, transitionChunks: 3, sequence: ['neon-city', 'dusk-city'] } });
    expect(getThemeTransition(0, config).themeId).toBe('neon-city');
    expect(getThemeTransition(900, config)).toMatchObject({ fromThemeId: 'neon-city', toThemeId: 'dusk-city', progress: 0 });
    expect(getThemeTransition(945, config).progress).toBe(0.5);
    expect(getThemeTransition(990, config).progress).toBe(1);
  });

  it('holds the same chunk objects and layouts as the transition progresses', () => {
    const manager = new CityManager(CITY_CONFIG, 'transition-stability');
    manager.update(590);
    const ahead = manager.snapshot.chunks.find((chunk) => chunk.id === 20);
    expect(ahead?.themeId).toBe('neon-city');
    for (const distance of [600, 630, 660]) {
      manager.update(distance);
      expect(manager.snapshot.chunks.find((chunk) => chunk.id === 20)).toBe(ahead);
    }
    const first = generateCityChunk(20, 'transition-stability');
    expect(ahead).toEqual(first);
    expect(first.seed).toContain('neon-city');
    expect(first.seed).toContain(getCityTheme('neon-city').version);
  });

  it('resets themes and all instance counts when restarting the run', () => {
    const manager = new CityManager(CITY_CONFIG, 'restart-theme');
    const initial = manager.snapshot;
    manager.update(945);
    expect(manager.snapshot.chunks.every((chunk) => chunk.themeId === 'neon-city')).toBe(true);
    expect(manager.snapshot.propCount).toBe(18);
    expect(manager.snapshot.decorationCount).toBe(0);
    manager.reset();
    expect(manager.snapshot.chunks).toEqual(initial.chunks);
    expect(manager.snapshot.chunks[0]).not.toBe(initial.chunks[0]);
    expect(manager.snapshot.chunks.every((chunk) => chunk.themeId === 'dusk-city')).toBe(true);
    expect(manager.snapshot.propCount).toBe(0);
    expect(manager.snapshot.decorationCount).toBe(18);
  });

  it('keeps advertisements outside the road and uses theme-specific models without overlap', () => {
    const dusk = generateCityChunk(0, 'props'); const neon = generateCityChunk(20, 'props');
    expect(dusk.props).toHaveLength(0);
    expect(dusk.decorations).toHaveLength(2);
    expect(neon.props).toHaveLength(2);
    expect(neon.decorations).toHaveLength(0);
    for (const chunk of [dusk, neon]) {
      const theme = getCityTheme(chunk.themeId);
      for (const building of chunk.buildings) expect(theme.buildings.assetIds).toContain(building.assetId);
      for (const lamp of chunk.lamps) expect(lamp.assetId).toBe(theme.decorations.lampAssetId);
      for (const prop of chunk.props) {
        expect(prop.assetId).toBe(theme.decorations.billboardAssetId);
        expect(prop.position[1]).toBe(0);
        expect(Math.abs(prop.position[0]) - cityFootprint(prop)[0] / 2).toBeGreaterThan(CITY_ROAD_CLEARANCE);
      }
    }
  });

  it('leaves the obstacle sequence identical while repeatedly switching themes', () => {
    const source = new LevelGenerator('unchanged-gameplay'); const control = new LevelGenerator('unchanged-gameplay');
    for (let zone = 0; zone < 40; zone++) {
      generateCityChunk(zone * 20, 'unchanged-gameplay');
      expect(source.next().entities.filter((entity) => entity.kind !== 'coin')).toEqual(control.next().entities.filter((entity) => entity.kind !== 'coin'));
    }
  });

  it('leaves the coin sequence identical while repeatedly switching themes', () => {
    const source = new LevelGenerator('unchanged-coins'); const control = new LevelGenerator('unchanged-coins');
    for (let zone = 0; zone < 40; zone++) {
      generateCityChunk(zone * 20, 'unchanged-coins');
      expect(source.next().entities.filter((entity) => entity.kind === 'coin')).toEqual(control.next().entities.filter((entity) => entity.kind === 'coin'));
    }
  });

  it('crosses all 10km zones with a complete bounded window and valid theme assets', () => {
    const manager = new CityManager(CITY_CONFIG, 'theme-long-distance');
    const limits = getCityLimits(); const zones = new Set<number>();
    let checkedRevision = -1;
    for (let distance = 0; distance <= 10_000; distance++) {
      manager.update(distance);
      expect(manager.snapshot.chunks).toHaveLength(9);
      if (manager.snapshot.revision === checkedRevision) continue;
      checkedRevision = manager.snapshot.revision;
      expect(manager.snapshot.buildingCount).toBeLessThanOrEqual(limits.buildings);
      expect(manager.snapshot.lampCount).toBeLessThanOrEqual(limits.lamps);
      expect(manager.snapshot.propCount).toBeLessThanOrEqual(limits.props);
      expect(manager.snapshot.decorationCount + manager.snapshot.propCount).toBe(18);
      const current = Math.floor(distance / CITY_CONFIG.chunkLength);
      expect(manager.snapshot.chunks.map((chunk) => chunk.id)).toEqual(Array.from({ length: 9 }, (_, index) => current - 2 + index));
      for (const chunk of manager.snapshot.chunks) {
        const zone = getCityZone(chunk.startDistance);
        zones.add(chunk.zoneId);
        expect(chunk.zoneId).toBe(zone.zoneId);
        expect(chunk.themeId).toBe(zone.themeId);
        const theme = getCityTheme(chunk.themeId);
        for (const building of chunk.buildings) expect(theme.buildings.assetIds).toContain(building.assetId);
        for (const lamp of chunk.lamps) expect(lamp.assetId).toBe(theme.decorations.lampAssetId);
        for (const prop of chunk.props) expect(prop.assetId).toBe(theme.decorations.billboardAssetId);
      }
    }
    expect([...zones]).toEqual(Array.from({ length: 17 }, (_, index) => index));
    expect(getThemeTransition(10000)).toMatchObject({ zoneId: 16, themeId: 'dusk-city', progress: 1 });
  });
});
