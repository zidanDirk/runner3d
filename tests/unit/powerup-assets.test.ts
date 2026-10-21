import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { assetContract, createJob, normalizeConfig, POWERUP_GENERATOR, PROJECT_ROOT, readConfig } from '../../scripts/assets/config.mjs';
import { validateAsset, validateGlbStructure, validateMaterialTheme } from '../../scripts/assets/validate.mjs';
import type { AssetConfig, AssetDefinition, AssetTheme } from '../../scripts/assets/config.mjs';

const variants = ['magnet', 'shield', 'double-score'] as const;
const root = (asset: unknown) => ({ schemaVersion: 1, blenderVersion: '5.2.2', theme: 'low-poly-dusk-city', seed: 20261018, assets: [asset] });
let config: AssetConfig;
let theme: AssetTheme;
let themes: Record<string, AssetTheme>;
function pickup(variant: typeof variants[number]): Extract<AssetDefinition, { type: 'powerup' }> {
  const result = config.assets.find((asset) => asset.id === `powerup-${variant}`);
  if (!result || result.type !== 'powerup') throw new Error(`Missing powerup fixture ${variant}`);
  return result;
}
beforeAll(async () => { ({ config, theme, themes } = await readConfig()); });

describe('procedural pickup assets', () => {
  it('normalizes only the registered versioned icon generator and bounded dimensions', () => {
    for (const variant of variants) {
      const normalized = normalizeConfig(root({ id: `powerup-${variant}`, type: 'powerup', variant }));
      expect(normalized.assets[0]).toMatchObject({ generator: POWERUP_GENERATOR, width: .85, height: .85, depth: .3 });
      expect(assetContract(pickup(variant)).materials).toEqual(['body', 'accent', 'mark'].map((role) => `powerup_${variant.replaceAll('-', '_')}_${role}`));
    }
  });

  it('rejects unknown variants, generator injection, excess dimensions and unknown data', () => {
    const base = { id: 'powerup-test', type: 'powerup', variant: 'magnet' };
    for (const change of [{ variant: 'coin' }, { generator: 'import evil' }, { width: 1.01 }, { height: 0 }, { depth: .41 }, { depth: NaN }, { script: 'exec()' }, { variant: null }]) {
      expect(() => normalizeConfig(root({ ...base, ...change }))).toThrow();
    }
  });

  it('limits only jobs to the requested pickup without reordering or consuming other seeds', () => {
    const all = createJob(config, theme, undefined, themes);
    for (const variant of variants) {
      const id = `powerup-${variant}`;
      const only = createJob(config, theme, id, themes);
      expect(only.assets).toEqual(all.assets.filter((asset) => asset.id === id));
      expect(only.assets).toHaveLength(1);
    }
  });

  it.each(variants)('loads the actual %s GLB with ground-centered dimensions and small geometry', async (variant) => {
    const contract = assetContract(pickup(variant), config.seed);
    const result = await validateAsset({ manifest: contract, theme });
    expect(result.structure.primitiveCount).toBe(3);
    expect(result.structure.triangles).toBeGreaterThan(20);
    expect(result.structure.triangles).toBeLessThanOrEqual(1000);
    expect(result.bytes).toBeLessThanOrEqual(128 * 1024);
    expect(result.three.dimensions[0]).toBeCloseTo(.85, 5);
    expect(result.three.dimensions[1]).toBeCloseTo(.85, 5);
    expect(result.three.dimensions[2]).toBeCloseTo(.3, 5);
    expect(result.three.min[1]).toBeCloseTo(0, 5);
    expect((result.three.min[0] ?? 0) + (result.three.max[0] ?? 0)).toBeCloseTo(0, 5);
    expect((result.three.min[2] ?? 0) + (result.three.max[2] ?? 0)).toBeCloseTo(0, 5);
  });

  it('rejects a corrupted GLB and pickup palette substitution through the real validator', async () => {
    const contract = assetContract(pickup('shield'), config.seed);
    const bytes = await readFile(resolve(PROJECT_ROOT, contract.path));
    const badLength = Buffer.from(bytes);
    badLength.writeUInt32LE(0, 8);
    expect(() => validateGlbStructure(badLength, contract)).toThrow(/长度/);
    const { json } = validateGlbStructure(bytes, contract);
    expect(() => validateMaterialTheme(json, contract, theme)).not.toThrow();
    // The same geometry/material identifiers must not be silently relabeled red.
    expect(() => validateMaterialTheme(json, { ...contract, ...pickup('magnet'), id: contract.id }, theme)).toThrow(/颜色/);
  });
});
