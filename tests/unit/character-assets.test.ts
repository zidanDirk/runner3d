import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { assetContract, createJob, normalizeConfig, readConfig, PROJECT_ROOT } from '../../scripts/assets/config.mjs';
import { createManifestEntry, validateAsset, validateGlbStructure, validateMaterialTheme, validateThreeLoad } from '../../scripts/assets/validate.mjs';
import { validateCharacterAnatomy } from '../../scripts/assets/character-validation.mjs';
import type { AssetConfig, AssetContract, AssetDefinition, AssetTheme } from '../../scripts/assets/config.mjs';
import type { AssetValidation, CharacterValidation } from '../../scripts/assets/validate.mjs';

let config: AssetConfig;
let theme: AssetTheme;
let asset: AssetDefinition;
let contract: AssetContract;
let real: Buffer;
let actual: AssetValidation;
function fixture(changes: Record<string, unknown> = {}) {
  return { schemaVersion: 1, blenderVersion: '5.2.2', theme: 'low-poly-dusk-city', seed: 20261018, assets: [{
    id: 'city-runner', type: 'character', generator: 'humanoid-runner', height: 1.75,
    proportions: { headScale: 1.1, shoulderWidth: .48, legLengthRatio: .46 },
    outfit: { jacketColor: '#f47b45', pantsColor: '#253241', shoeColor: '#f5eee1', skinColor: '#e4b594' },
    accessories: { backpack: true }, ...changes,
  }] };
}
function characterData(): CharacterValidation {
  const value = actual.three.character;
  if (!value) throw new Error('Actual GLB character metadata is required');
  return structuredClone(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected record in generated GLB');
  return value as Record<string, unknown>;
}
/** Mutate the actual Blender export, preserving the actual binary geometry. */
function changedJson(mutate: (json: Record<string, unknown>, binary: Buffer) => void) {
  const length = real.readUInt32LE(12);
  const json = record(JSON.parse(real.subarray(20, 20 + length).toString('utf8')));
  const binary = Buffer.from(real.subarray(28 + length));
  mutate(json, binary);
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20); encoded.copy(padded);
  const tail = Buffer.concat([real.subarray(20 + length, 28 + length), binary]);
  const output = Buffer.alloc(20 + padded.length + tail.length);
  real.copy(output, 0, 0, 12); output.writeUInt32LE(output.length, 8); output.writeUInt32LE(padded.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16); padded.copy(output, 20); tail.copy(output, 20 + padded.length);
  return output;
}
function metadata(json: Record<string, unknown>) {
  if (!Array.isArray(json.nodes)) throw new Error('Expected actual nodes');
  const root: unknown = json.nodes.find((node: unknown) => record(node).name === 'city_runner_Root');
  return record(record(record(root).extras).character);
}

describe('strict humanoid generator configuration', () => {
  it('normalizes controlled colors and derives exact dimensions from validated proportions', async () => {
    const normalized = normalizeConfig(fixture());
    const runner = normalized.assets[0];
    if (!runner || runner.type !== 'character') throw new Error('Expected character config');
    expect(runner.outfit.jacketColor).toBe('#F47B45');
    expect(assetContract(runner).dimensions).toEqual([.72, 1.75, .5]);
    expect(assetContract(runner)).toMatchObject({ maxBytes: 409600, maxTriangles: 3500 });
    const { theme: palette } = await readConfig();
    expect(createJob(normalized, palette, 'city-runner').assets).toHaveLength(1);
  });
  it('rejects unsupported executable generator names, missing nested data and unknown nested fields', () => {
    for (const changes of [{ generator: '../../python' }, { proportions: null }, { proportions: { headScale: 1.1, shoulderWidth: .48, legLengthRatio: .46, eval: 'exec()' } }, { accessories: { backpack: true, helmet: true } }]) {
      expect(() => normalizeConfig(fixture(changes))).toThrow();
    }
  });
  it('rejects unsafe human proportions, nonfinite height, invalid colors and nonboolean accessories', () => {
    for (const height of [1.64, 1.81, NaN, Infinity, '1.75']) expect(() => normalizeConfig(fixture({ height }))).toThrow(/height/);
    for (const [key, values] of Object.entries({ headScale: [.99, 1.21], shoulderWidth: [.43, .57], legLengthRatio: [.42, .5] })) {
      for (const value of values) expect(() => normalizeConfig(fixture({ proportions: { headScale: 1.1, shoulderWidth: .48, legLengthRatio: .46, [key]: value } }))).toThrow(new RegExp(key));
    }
    expect(() => normalizeConfig(fixture({ outfit: { jacketColor: 'orange', pantsColor: '#253241', shoeColor: '#F5EEE1', skinColor: '#E4B594' } }))).toThrow(/#RRGGBB/);
    expect(() => normalizeConfig(fixture({ accessories: { backpack: 'true' } }))).toThrow(/boolean/);
  });
  it('accepts the supported parameter extremes and optional backpack switch deterministically', () => {
    for (const height of [1.65, 1.8]) for (const backpack of [true, false]) {
      const input = fixture({ height, accessories: { backpack }, proportions: { headScale: 1.2, shoulderWidth: .56, legLengthRatio: .49 } });
      expect(normalizeConfig(input)).toEqual(normalizeConfig(input));
      expect(normalizeConfig(input).assets[0]).toMatchObject({ height, accessories: { backpack } });
    }
  });
});

describe('real generated character geometry and anatomical contract', () => {
  beforeAll(async () => {
    ({ config, theme } = await readConfig());
    const found = config.assets.find((entry) => entry.id === 'city-runner');
    if (!found || found.type !== 'character') throw new Error('Expected committed character fixture');
    asset = found; contract = assetContract(asset, config.seed);
    real = await readFile(resolve(PROJECT_ROOT, contract.path));
    actual = await validateAsset({ manifest: contract, theme });
  });
  it('loads the actual Blender GLB, materials and hierarchy with Three.js, preserving ground and forward', () => {
    expect(actual.three.triangles).toBeGreaterThanOrEqual(1000);
    expect(actual.three.triangles).toBeLessThanOrEqual(3500);
    expect(actual.bytes).toBeLessThanOrEqual(409600);
    expect(actual.structure.json.meshes).toHaveLength(18);
    expect(actual.three.materials).toHaveLength(4);
    expect(actual.three.dimensions[1]).toBeCloseTo(1.75, 5);
    expect(actual.three.min[1]).toBeCloseTo(0, 5);
    const data = characterData();
    expect(Object.keys(data.parts)).toHaveLength(18);
    expect(data.parts.Head?.parent).toBe(null);
    expect(data.parts.LeftFoot?.parent).toBe(null);
    expect(data.joints.leftShoulder?.[0]).toBeCloseTo(-(data.joints.rightShoulder?.[0] ?? Infinity), 5);
  });
  it('derives character manifest height, part bounds and joints from the actual model', () => {
    const entry = createManifestEntry(asset, config, theme, actual);
    expect(entry).toMatchObject({ assetId: 'city-runner', type: 'character', role: 'player', height: actual.three.dimensions[1] });
    expect(entry.bounds).toEqual({ min: actual.three.min, max: actual.three.max });
    expect(entry.joints).toEqual(actual.three.character?.joints);
    expect(entry.parts).toEqual(actual.three.character?.parts);
  });
  it('rejects missing references, wrong forward, unregistered parts and unrelated nodes', () => {
    expect(() => validateGlbStructure(changedJson((json) => { delete metadata(json).joints; }), contract)).toThrow(/参考信息/);
    expect(() => validateGlbStructure(changedJson((json) => { metadata(json).forward = [0, 0, 1]; }), contract)).toThrow(/正前方/);
    expect(() => validateGlbStructure(changedJson((json) => { record(metadata(json).parts).Head = 'missing'; }), contract)).toThrow(/节点名称/);
    expect(() => validateGlbStructure(changedJson((json) => { if (Array.isArray(json.nodes)) json.nodes.push({ name: 'unrelated' }); }), contract)).toThrow(/无关节点/);
  });
  it('rejects forged joint values after actual Three.js loading', async () => {
    const corrupted = changedJson((json) => { record(metadata(json).joints).leftShoulder = [.99, .99, .99]; });
    await expect(validateThreeLoad(corrupted, contract)).rejects.toThrow(/关节 leftShoulder 远离实际 LeftUpperArm 几何体/);
  });
  it('rejects disconnected forearms even when metadata honestly follows the displaced joints', async () => {
    const disconnected = changedJson((json, binary) => {
      if (!Array.isArray(json.nodes)) throw new Error('Expected actual nodes');
      const shifted = new Set<number>();
      for (const node of json.nodes) {
        const value = record(node);
        if (!['city_runner_LeftLowerArm', 'city_runner_RightLowerArm', 'city_runner_LeftHand', 'city_runner_RightHand'].includes(String(value.name))) continue;
        if (!Array.isArray(json.meshes) || typeof value.mesh !== 'number') throw new Error('Expected actual part mesh');
        const primitives = record(json.meshes[value.mesh]).primitives;
        if (!Array.isArray(primitives)) throw new Error('Expected actual mesh primitives');
        for (const primitive of primitives) {
          const accessorId = record(record(primitive).attributes).POSITION;
          if (typeof accessorId !== 'number' || !Array.isArray(json.accessors) || !Array.isArray(json.bufferViews)) throw new Error('Expected actual POSITION accessor');
          if (shifted.has(accessorId)) continue; shifted.add(accessorId);
          const accessor = record(json.accessors[accessorId]);
          if (typeof accessor.bufferView !== 'number' || typeof accessor.count !== 'number' || accessor.componentType !== 5126) throw new Error('Expected FLOAT positions');
          const view = record(json.bufferViews[accessor.bufferView]);
          const offset = Number(view.byteOffset ?? 0) + Number(accessor.byteOffset ?? 0);
          const stride = Number(view.byteStride ?? 12);
          for (let i = 0; i < accessor.count; i++) { const y = offset + i * stride + 4; binary.writeFloatLE(binary.readFloatLE(y) - .25, y); }
        }
      }
      const joints = record(metadata(json).joints);
      for (const name of ['leftElbow', 'rightElbow', 'leftWrist', 'rightWrist']) {
        const point = joints[name];
        if (!Array.isArray(point) || typeof point[1] !== 'number') throw new Error('Expected actual joint coordinate');
        point[1] -= .25;
      }
    });
    await expect(validateThreeLoad(disconnected, contract)).rejects.toThrow(/过大空隙/);
  });
  it('rejects wrong configured jacket colors instead of accepting material names alone', () => {
    if (asset.type !== 'character') throw new Error('Expected character');
    const wrong = assetContract({ ...asset, outfit: { ...asset.outfit, jacketColor: '#000000' } });
    expect(() => validateMaterialTheme(actual.structure.json, wrong, theme)).toThrow(/颜色与主题/);
  });
  it('rejects asymmetry, suspended feet, overlapping legs and displaced backpacks', () => {
    const asymmetric = characterData(); const arm = asymmetric.parts.LeftUpperArm;
    if (!arm) throw new Error('Expected arm'); arm.bounds.max[0] = .9;
    expect(() => validateCharacterAnatomy(asymmetric.parts, asymmetric.joints, contract)).toThrow(/不对称/);
    const hovering = characterData();
    for (const name of ['LeftFoot', 'RightFoot']) { const foot = hovering.parts[name]; if (!foot) throw new Error('Expected foot'); foot.bounds.min[1] = .05; }
    expect(() => validateCharacterAnatomy(hovering.parts, hovering.joints, contract)).toThrow(/接地/);
    const overlap = characterData();
    for (const name of ['LeftUpperLeg', 'RightUpperLeg']) { const leg = overlap.parts[name]; if (!leg) throw new Error('Expected leg'); leg.bounds.min[0] = -.15; leg.bounds.max[0] = .15; }
    expect(() => validateCharacterAnatomy(overlap.parts, overlap.joints, contract)).toThrow(/重叠/);
    const detached = characterData(); const backpack = detached.parts.Backpack;
    if (!backpack) throw new Error('Expected backpack'); backpack.bounds.min[2] = 1; backpack.bounds.max[2] = 2;
    expect(() => validateCharacterAnatomy(detached.parts, detached.joints, contract)).toThrow(/背包/);
  });
});
