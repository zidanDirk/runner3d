import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetConfigHash, assetContract, assetSeed, configHash, createJob, normalizeConfig, parseCli, readConfig, selectedTheme, stableStringify, validateTheme } from '../../scripts/assets/config.mjs';
import { assertEntryCurrent, assertEntryMatches, createGeneratedManifest, createManifestEntry, validateAsset, validateAssets, validateManifestShape, validateMaterialTheme } from '../../scripts/assets/validate.mjs';
import { generationLayout, publishGeneration, verifyBlenderVersion } from '../../scripts/assets/generate.mjs';
import type { AssetConfig, AssetDefinition, AssetTheme } from '../../scripts/assets/config.mjs';
import type { GeneratedManifest, GeneratedAssetEntry } from '../../scripts/assets/validate.mjs';

let temporary: string;
let config: AssetConfig;
let theme: AssetTheme;
let themes: Record<string, AssetTheme>;
beforeAll(async () => {
  temporary = await mkdtemp(join(tmpdir(), 'runner3d-factory-test-'));
  ({ config, theme, themes } = await readConfig());
});
afterAll(async () => { await rm(temporary, { recursive: true, force: true }); });
function resource(configValue: AssetConfig, id: string): AssetDefinition {
  const asset = configValue.assets.find((item) => item.id === id);
  if (!asset) throw new Error(`Missing test fixture ${id}`);
  return asset;
}
function root(assets: unknown[]) { return { schemaVersion: 1, blenderVersion: '5.2.2', theme: 'low-poly-dusk-city', seed: 20261018, assets }; }
function changedAsset(changes: Record<string, unknown>) { return root([{ id: 'cone', type: 'traffic-cone', ...changes }]); }

describe('strict parameterized asset configuration', () => {
  it('normalizes defaults for every registered generator and derives controlled output paths', () => {
    const parsed = normalizeConfig(root([{ id: 'roadblock', type: 'roadblock' }, { id: 'cone', type: 'traffic-cone' }, { id: 'lamp', type: 'street-lamp' }, { id: 'tower', type: 'building', variant: 'office' }]));
    expect(assetContract(resource(parsed, 'roadblock')).dimensions).toEqual([2, .85, .9]);
    expect(assetContract(resource(parsed, 'cone')).dimensions).toEqual([.6, 1.2, .6]);
    expect(assetContract(resource(parsed, 'lamp')).dimensions).toEqual([1.4, 4, .5]);
    expect(resource(parsed, 'tower')).toMatchObject({ floors: 6, windowsPerFloor: 4 });
    expect(assetContract(resource(parsed, 'tower')).path).toBe('public/models/generated/tower.glb');
  });

  it('rejects unknown root/asset fields and code or output-path injection', () => {
    expect(() => normalizeConfig({ ...root([{ id: 'cone', type: 'traffic-cone' }]), python: 'import os' })).toThrow(/未知字段/);
    expect(() => normalizeConfig(changedAsset({ script: '__import__("os")' }))).toThrow(/未知字段/);
    expect(() => normalizeConfig(changedAsset({ path: '/tmp/out.glb' }))).toThrow(/未知字段/);
    expect(() => normalizeConfig(changedAsset({ id: '../cone' }))).toThrow(/kebab-case/);
    expect(() => normalizeConfig({ ...root([{ id: 'cone', type: 'traffic-cone' }]), theme: '../../tmp/theme' })).toThrow(/受控主题/);
  });

  it('rejects duplicate IDs and unsupported generator types', () => {
    expect(() => normalizeConfig(root([{ id: 'same', type: 'roadblock' }, { id: 'same', type: 'traffic-cone' }]))).toThrow(/ID 重复/);
    expect(() => normalizeConfig(root([{ id: 'anything', type: 'python' }]))).toThrow(/不受支持/);
  });

  it('rejects nonfinite, null, negative, oversized and noninteger parameters', () => {
    for (const height of [NaN, Infinity, -1, 0, 4, null, '1.2']) expect(() => normalizeConfig(changedAsset({ height }))).toThrow(/height/);
    for (const segments of [7, 17, 8.5]) expect(() => normalizeConfig(changedAsset({ segments }))).toThrow(/segments/);
    expect(() => normalizeConfig(root([{ id: 'tower', type: 'building', variant: 'warehouse' }]))).toThrow(/variant/);
    expect(() => normalizeConfig(root([{ id: 'tower', type: 'building', floors: 16, windowsPerFloor: 8 }]))).toThrow(/不能超过/);
  });

  it('rejects invalid seeds and an unlocked Blender version', () => {
    for (const seed of [-1, 0x100000000, .1, NaN, '2026']) expect(() => normalizeConfig({ ...root([{ id: 'cone', type: 'traffic-cone' }]), seed })).toThrow(/seed/);
    expect(() => normalizeConfig({ ...root([{ id: 'cone', type: 'traffic-cone' }]), blenderVersion: '5.2' })).toThrow(/锁定 5.2.2/);
  });

  it('validates complete themes and refuses arbitrary shader options or unbounded emission', () => {
    expect(validateTheme(theme, config.theme)).toEqual(theme);
    const badColor = structuredClone(theme); badColor.materials.warning = { color: 'red', roughness: .5, metalness: 0 };
    expect(() => validateTheme(badColor, config.theme)).toThrow(/#RRGGBB/);
    const badStrength = structuredClone(theme); badStrength.materials.lamp = { color: '#FFCC87', roughness: .5, metalness: 0, emissive: '#FFCC87', emissiveStrength: 10 };
    expect(() => validateTheme(badStrength, config.theme)).toThrow(/emissiveStrength/);
    expect(() => validateTheme({ ...theme, python: 'exec()' }, config.theme)).toThrow(/未知字段/);
    expect(() => validateTheme(theme, 'different-theme')).toThrow(/一致/);
  });

  it('keeps seeds and config hashes stable across object key order and unrelated resources', () => {
    const asset = resource(config, 'city-building-01');
    expect(stableStringify({ z: 1, a: 2 })).toBe(stableStringify({ a: 2, z: 1 }));
    expect(assetSeed(config.seed, asset.id)).toBe(assetSeed(config.seed, asset.id));
    expect(assetSeed(config.seed + 1, asset.id)).not.toBe(assetSeed(config.seed, asset.id));
    expect(assetSeed(config.seed, 'different-id')).not.toBe(assetSeed(config.seed, asset.id));
    const changed = { ...config, assets: [...config.assets, { id: 'extra-cone', type: 'traffic-cone', height: 1.2, baseSize: .6, segments: 8 } satisfies AssetDefinition] };
    expect(assetConfigHash(asset, changed, theme)).toBe(assetConfigHash(asset, config, theme));
    expect(configHash(changed, theme)).not.toBe(configHash(config, theme));
    const changedTheme = structuredClone(theme); changedTheme.scene.road = '#123456';
    expect(assetConfigHash(asset, config, changedTheme)).not.toBe(assetConfigHash(asset, config, theme));
  });

  it('passes only the requested ID to the Blender job and never accepts CLI options silently', () => {
    const job = createJob(config, theme, 'traffic-cone', themes);
    expect(job.assets.map((asset) => asset.id)).toEqual(['traffic-cone']);
    expect(job.assets[0]).not.toHaveProperty('path');
    expect(createJob(config, theme, undefined, themes).assets).toHaveLength(config.assets.length);
    expect(() => createJob(config, theme, 'missing')).toThrow(/不存在/);
    expect(parseCli(['--only=traffic-cone', '--config', 'other.json'], { only: true })).toEqual({ only: 'traffic-cone', config: 'other.json' });
    for (const args of [['--only'], ['--only=a', '--only=b'], ['--unknown=x']]) expect(() => parseCli(args, { only: true })).toThrow();
  });

  it('enforces the exact actual Blender patch version before generation', () => {
    expect(verifyBlenderVersion('Blender 5.2.2 LTS\n')).toBe('5.2.2');
    for (const version of ['Blender 5.2.1\n', 'Blender 5.3.0\n', 'Blender 5.2\n', 'Not Blender 5.2.2\n']) expect(() => verifyBlenderVersion(version)).toThrow(/版本不一致/);
  });
});

describe('generated manifest follows real asset content', () => {
  let manifest: GeneratedManifest;
  let asset: AssetDefinition;
  let singleConfig: AssetConfig;
  let entry: GeneratedAssetEntry;
  beforeAll(async () => {
    asset = resource(config, 'roadblock');
    singleConfig = { ...config, assets: [asset] };
    const result = await validateAsset({ manifest: assetContract(asset, config.seed), theme });
    entry = createManifestEntry(asset, singleConfig, theme, result);
    manifest = createGeneratedManifest(singleConfig, theme, { roadblock: entry });
  });

  it('creates metadata from actual GLB and actual Three.js measurements', () => {
    expect(validateManifestShape(manifest, singleConfig, theme)).toBe(manifest);
    expect(entry).toMatchObject({ meshCount: 1, materialCount: 3, primitiveCount: 3, role: 'obstacle' });
    expect(entry.triangles).toBeGreaterThan(0);
    expect(entry.bytes).toBeGreaterThan(0);
    expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(() => assertEntryCurrent(entry, asset, singleConfig, theme)).not.toThrow();
  });

  it('parses every committed generated asset with Three.js and verifies the full manifest', async () => {
    const result = await validateAssets();
    expect(Object.keys(result.results)).toEqual(config.assets.map((item) => item.id));
    for (const item of config.assets) {
      expect(result.results[item.id]?.three.triangles).toBeGreaterThan(0);
      if (item.type === 'character') expect(result.manifest.assets[item.id]?.meshCount).toBeGreaterThanOrEqual(17);
      else expect(result.manifest.assets[item.id]?.meshCount).toBe(1);
    }
  });

  it('rejects missing/extra IDs, unexpected paths, stale version and unknown metadata fields', () => {
    expect(() => validateManifestShape({ ...manifest, assets: {} }, singleConfig, theme)).toThrow(/字段/);
    expect(() => validateManifestShape({ ...manifest, assets: { ...manifest.assets, extra: entry } }, singleConfig, theme)).toThrow(/字段/);
    expect(() => validateManifestShape({ ...manifest, blenderVersion: '5.2.1' }, singleConfig, theme)).toThrow(/版本/);
    expect(() => validateManifestShape({ ...manifest, fake: 1 }, singleConfig, theme)).toThrow(/字段/);
    expect(() => validateManifestShape({ ...manifest, assets: { roadblock: { ...entry, path: '../rogue.glb' } } }, singleConfig, theme)).toThrow(/路径/);
  });

  it('rejects changed config/theme and metadata tampering instead of relabeling an old GLB', () => {
    const changed = { ...asset, height: 1 };
    expect(() => assertEntryCurrent(entry, changed, singleConfig, theme)).toThrow(/过期/);
    expect(() => assertEntryMatches({ ...entry, triangles: entry.triangles + 1 }, entry, asset.id)).toThrow(/不一致/);
    expect(() => validateManifestShape({ ...manifest, configHash: '0'.repeat(64) }, singleConfig, theme)).toThrow(/摘要/);
  });

  it('validates a real temporary manifest and detects its forged file hash', async () => {
    const configPath = join(temporary, 'single.config.json');
    const manifestPath = join(temporary, 'manifest.json');
    await writeFile(configPath, JSON.stringify(singleConfig));
    await writeFile(manifestPath, JSON.stringify(manifest));
    const result = await validateAssets({ configPath, manifestPath });
    expect(result.results.roadblock?.sha256).toBe(entry.sha256);
    await writeFile(manifestPath, JSON.stringify({ ...manifest, assets: { roadblock: { ...entry, sha256: '0'.repeat(64) } } }));
    await expect(validateAssets({ configPath, manifestPath })).rejects.toThrow(/实际 GLB/);
  });

  it('checks actual material colors and emission against the selected theme', async () => {
    const result = await validateAsset({ manifest: assetContract(asset, config.seed), theme });
    const changed = structuredClone(theme); changed.materials.warning = { color: '#000000', roughness: .72, metalness: 0 };
    expect(() => validateMaterialTheme(result.structure.json, assetContract(asset, config.seed), changed)).toThrow(/颜色与主题/);
  });
});

describe('finite theme-specific asset variants', () => {
  it('resolves a controlled per-asset palette while preserving the default palette', () => {
    expect(Object.keys(themes).sort()).toEqual(['low-poly-dusk-city', 'neon-city']);
    const job = createJob(config, theme, undefined, themes);
    expect(job.assets).toHaveLength(config.assets.length);
    expect(job.assets.find((asset) => asset.id === 'roadblock')?.themeId).toBe('low-poly-dusk-city');
    expect(job.assets.find((asset) => asset.id === 'neon-building-01')?.themeId).toBe('neon-city');
    expect(createJob(config, theme, 'neon-billboard', themes).assets.map((asset) => asset.id)).toEqual(['neon-billboard']);
    expect(() => createJob(config, theme, 'neon-building-01')).toThrow(/未加载主题/);
  });

  it('rejects theme path injection, unsupported geometry variants and explicit null defaults', () => {
    for (const changes of [{ theme: '../../evil' }, { roofStyle: 'python' }, { accentStyle: 'shader' }, { roofStyle: null }]) {
      expect(() => normalizeConfig(root([{ id: 'tower', type: 'building', ...changes }]))).toThrow();
    }
    expect(() => normalizeConfig(root([{ id: 'lamp', type: 'street-lamp', style: 'laser' }]))).toThrow(/style/);
    expect(() => normalizeConfig(root([{ id: 'sign', type: 'billboard', width: 40 }]))).toThrow(/width/);
  });

  it('includes every selected palette in root hashes and each actual palette in entry hashes', () => {
    const neon = resource(config, 'neon-building-01');
    const palette = selectedTheme(neon, config, themes);
    const modified = structuredClone(themes);
    const changed = modified['neon-city'];
    if (!changed) throw new Error('Expected fixture theme');
    changed.materials.window = { color: '#112233', roughness: .5, metalness: 0 };
    expect(configHash(config, theme, modified)).not.toBe(configHash(config, theme, themes));
    expect(assetConfigHash(neon, config, changed)).not.toBe(assetConfigHash(neon, config, palette));
    expect(assetConfigHash(resource(config, 'roadblock'), config, theme)).toBe(assetConfigHash(resource(config, 'roadblock'), config, themes['low-poly-dusk-city'] ?? theme));
  });

  it('verifies actual neon geometry, shared emissive palettes and rejects a mismatched theme', async () => {
    const neon = resource(config, 'neon-building-02');
    const palette = selectedTheme(neon, config, themes);
    const result = await validateAsset({ manifest: assetContract(neon, config.seed), theme: palette });
    expect(result.three.triangles).toBeGreaterThan(288); // strips and roof equipment are real geometry
    expect(result.structure.primitiveCount).toBe(4);
    expect(Object.values(palette.materials).filter((material) => material.emissiveStrength).length).toBe(3);
    expect(() => validateMaterialTheme(result.structure.json, assetContract(neon), theme)).toThrow(/颜色与主题/);
    const entry = createManifestEntry(neon, config, palette, result);
    expect(entry.themeId).toBe('neon-city');
    const single = { ...config, assets: [neon] };
    const manifest = createGeneratedManifest(single, theme, { [neon.id]: entry }, themes);
    expect(() => validateManifestShape({ ...manifest, assets: { [neon.id]: { ...entry, themeId: theme.id } } }, single, theme, { themes })).toThrow(/主题不一致/);
  });
});

describe('validated batch publication transaction', () => {
  it('keeps the input job outside the empty Blender output directory', () => {
    const layout = generationLayout('/tmp/example-staging');
    expect(dirname(layout.jobPath)).toBe('/tmp/example-staging');
    expect(layout.output).toBe('/tmp/example-staging/output');
    expect(dirname(layout.reportPath)).toBe(layout.output);
    expect(dirname(layout.jobPath)).not.toBe(layout.output);
  });
  it('publishes new files and writes its manifest after the files', async () => {
    const directory = join(temporary, 'publish-success'); await mkdir(directory);
    const source = join(directory, 'new.glb'); const target = join(directory, 'target.glb'); const manifestPath = join(directory, 'published.json');
    await writeFile(source, 'new'); await writeFile(target, 'old');
    await publishGeneration([{ source, target }], { verified: true }, directory, manifestPath);
    expect(await readFile(target, 'utf8')).toBe('new');
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual({ verified: true });
  });

  it('restores all replaced files if a later file cannot be published', async () => {
    const directory = join(temporary, 'publish-failure'); await mkdir(directory);
    const source = join(directory, 'new.glb'); const first = join(directory, 'first.glb'); const second = join(directory, 'second.glb'); const manifestPath = join(directory, 'published.json');
    await writeFile(source, 'new'); await writeFile(first, 'old-first'); await writeFile(second, 'old-second'); await writeFile(manifestPath, 'old-manifest');
    await expect(publishGeneration([{ source, target: first }, { source: join(directory, 'missing.glb'), target: second }], { verified: true }, directory, manifestPath)).rejects.toThrow();
    expect(await readFile(first, 'utf8')).toBe('old-first'); expect(await readFile(second, 'utf8')).toBe('old-second');
    expect(await readFile(manifestPath, 'utf8')).toBe('old-manifest');
  });

  it('rolls back files if manifest publication fails', async () => {
    const directory = join(temporary, 'manifest-failure'); await mkdir(directory);
    const source = join(directory, 'new.glb'); const target = join(directory, 'target.glb'); const invalidParent = join(directory, 'not-directory');
    await writeFile(source, 'new'); await writeFile(target, 'old'); await writeFile(invalidParent, 'file');
    await expect(publishGeneration([{ source, target }], {}, directory, join(invalidParent, 'manifest.json'))).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe('old');
  });
});
