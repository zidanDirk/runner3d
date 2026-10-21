import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { assetContract, readConfig, PROJECT_ROOT } from '../../scripts/assets/config.mjs';
import { createManifestEntry, validateAsset, validateGlbStructure, validateThreeLoad } from '../../scripts/assets/validate.mjs';
import { validateRigManifest } from '../../scripts/assets/character-rig-validation.mjs';
import type { AssetContract } from '../../scripts/assets/config.mjs';
import type { AssetValidation, GeneratedAssetEntry } from '../../scripts/assets/validate.mjs';

let real: Buffer;
let contract: AssetContract;
let actual: AssetValidation;
let entry: GeneratedAssetEntry;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected GLB record');
  return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('Expected GLB array'); return value; }
function number(value: unknown): number { if (typeof value !== 'number') throw new Error('Expected GLB number'); return value; }
function at(json: Record<string, unknown>, collection: string, id: unknown) { return record(list(json[collection])[number(id)]); }
function altered(mutate: (json: Record<string, unknown>, binary: Buffer) => void) {
  const size = real.readUInt32LE(12);
  const json = record(JSON.parse(real.subarray(20, 20 + size).toString('utf8')));
  const binary = Buffer.from(real.subarray(28 + size));
  mutate(json, binary);
  const encoded = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20); encoded.copy(padded);
  const result = Buffer.alloc(28 + padded.length + binary.length);
  real.copy(result, 0, 0, 12); result.writeUInt32LE(result.length, 8); result.writeUInt32LE(padded.length, 12);
  result.writeUInt32LE(0x4e4f534a, 16); padded.copy(result, 20);
  result.writeUInt32LE(binary.length, 20 + padded.length); result.writeUInt32LE(0x004e4942, 24 + padded.length); binary.copy(result, 28 + padded.length);
  return result;
}
function firstPrimitive(json: Record<string, unknown>) { return record(list(record(list(json.meshes)[0]).primitives)[0]); }
function accessor(json: Record<string, unknown>, id: unknown) {
  const value = at(json, 'accessors', id); const view = at(json, 'bufferViews', value.bufferView);
  return { value, offset: number(view.byteOffset ?? 0) + number(value.byteOffset ?? 0), stride: number(view.byteStride ?? 0) };
}
function clip(json: Record<string, unknown>, name: string) { return record(list(json.animations).find((item) => record(item).name === name)); }
function boneId(json: Record<string, unknown>, name: string) { return list(json.nodes).findIndex((node) => record(node).name === name); }

describe('actual exported character Skin, Skeleton and AnimationMixer validation', () => {
  beforeAll(async () => {
    const { config, theme } = await readConfig();
    const asset = config.assets.find((item) => item.id === 'city-runner');
    if (!asset) throw new Error('Committed city-runner fixture missing');
    contract = assetContract(asset, config.seed); real = await readFile(resolve(PROJECT_ROOT, contract.path));
    actual = await validateAsset({ manifest: contract, theme });
    entry = createManifestEntry(asset, config, theme, actual);
  });
  it('rejects forged manifest bone counts, clip duration and actual sample summaries', () => {
    expect(() => validateRigManifest(entry)).not.toThrow();
    expect(() => validateRigManifest({ ...entry, boneCount: 0 })).toThrow(/数量/);
    expect(() => validateRigManifest({ ...entry, animationClips: entry.animationClips?.map((clip) => ({ ...clip, duration: Infinity })) })).toThrow(/时长/);
    expect(() => validateRigManifest({ ...entry, animationSamples: {} })).toThrow(/采样缺失/);
  });
  it('recognizes genuine SkinnedMesh and measures deformed vertices at four clips and four joint probes', () => {
    const rig = actual.three.character;
    expect(rig).toMatchObject({ boneCount: 20, skinCount: 1, animationCount: 4, animations: { idle: 'Idle', run: 'Run', jump: 'Jump', slide: 'Slide' } });
    expect(rig?.skinnedMeshCount).toBe(actual.structure.primitiveCount);
    expect(rig?.animationClips.map((item) => item.name).sort()).toEqual(['Idle', 'Jump', 'Run', 'Slide']);
    for (const item of rig?.animationClips ?? []) { expect(item.duration).toBeGreaterThan(0); expect(item.trackCount).toBeGreaterThan(0); }
    for (const samples of Object.values(rig?.animationSamples ?? {})) expect(samples.map((item) => item.progress)).toEqual([0, .25, .5, .75, 1]);
    expect(Object.keys(rig?.poseTests ?? {})).toEqual(['armRaise', 'elbowBend', 'legRaise', 'kneeBend']);
  });
  it('rejects absent Skin, omitted critical bones and a broken actual bone parent', () => {
    expect(() => validateGlbStructure(altered((json) => { json.skins = []; }), contract)).toThrow(/Skin/);
    expect(() => validateGlbStructure(altered((json) => { const skin = record(list(json.skins)[0]); skin.joints = list(skin.joints).slice(1); }), contract)).toThrow(/骨骼索引/);
    expect(() => validateGlbStructure(altered((json) => {
      const shoulder = at(json, 'nodes', boneId(json, 'LeftShoulder')); shoulder.children = [];
    }), contract)).toThrow(/无关节点|层级/);
  });
  it('rejects real binary out-of-range joint indices and zero/NaN skin weights', () => {
    const wrongJoint = altered((json, binary) => {
      const id = record(firstPrimitive(json).attributes).JOINTS_0; const data = accessor(json, id);
      if (data.value.componentType === 5121) binary.writeUInt8(255, data.offset); else binary.writeUInt16LE(65535, data.offset);
    });
    expect(() => validateGlbStructure(wrongJoint, contract)).toThrow(/骨骼索引越界/);
    for (const invalid of [0, NaN]) {
      const wrongWeight = altered((json, binary) => {
        const id = record(firstPrimitive(json).attributes).WEIGHTS_0; const data = accessor(json, id);
        expect(data.value.componentType).toBe(5126);
        for (let i = 0; i < 4; i++) binary.writeFloatLE(invalid, data.offset + i * 4);
      });
      expect(() => validateGlbStructure(wrongWeight, contract)).toThrow(/权重|NaN/);
    }
  });
  it('rejects invalid inverse bind matrices from actual binary data', () => {
    const corrupt = altered((json, binary) => { const data = accessor(json, record(list(json.skins)[0]).inverseBindMatrices); binary.fill(0, data.offset, data.offset + 64); });
    expect(() => validateGlbStructure(corrupt, contract)).toThrow(/逆绑定矩阵不可逆/);
  });
  it('rejects missing action names, bad target nodes and malformed track samples', () => {
    expect(() => validateGlbStructure(altered((json) => { clip(json, 'Run').name = 'Walk'; }), contract)).toThrow(/四个动作/);
    expect(() => validateGlbStructure(altered((json) => { record(record(list(clip(json, 'Run').channels)[0]).target).node = 99999; }), contract)).toThrow(/动画目标/);
    expect(() => validateGlbStructure(altered((json) => { record(list(clip(json, 'Run').samplers)[0]).interpolation = 'INVALID'; }), contract)).toThrow(/插值/);
    expect(() => validateGlbStructure(altered((json, binary) => {
      const sample = record(list(clip(json, 'Run').samplers)[0]); const data = accessor(json, sample.input); binary.writeFloatLE(NaN, data.offset);
    }), contract)).toThrow(/NaN/);
  });
  it('rejects horizontal root motion in a real exported Hips track', () => {
    const corrupt = altered((json, binary) => {
      const action = clip(json, 'Run');
      const target = record(list(action.channels).find((item) => { const t = record(record(item).target); return t.node === boneId(json, 'Hips') && t.path === 'translation'; }));
      const sampler = record(list(action.samplers)[number(target.sampler)]); const data = accessor(json, sampler.output);
      binary.writeFloatLE(.5, data.offset + (data.stride || 12));
    });
    expect(() => validateGlbStructure(corrupt, contract)).toThrow(/Root Motion/);
  });
  it('detects actual skinned foot penetration despite unchanged rest geometry and valid structural data', async () => {
    const corrupt = altered((json, binary) => {
      const action = clip(json, 'Slide');
      const target = record(list(action.channels).find((item) => { const t = record(record(item).target); return t.node === boneId(json, 'Hips') && t.path === 'translation'; }));
      const sampler = record(list(action.samplers)[number(target.sampler)]); const data = accessor(json, sampler.output);
      expect(sampler.interpolation ?? 'LINEAR').toBe('LINEAR');
      for (let i = 0; i < number(data.value.count); i++) {
        const y = data.offset + i * (data.stride || 12) + 4; binary.writeFloatLE(binary.readFloatLE(y) - .2, y);
      }
    });
    expect(() => validateGlbStructure(corrupt, contract)).not.toThrow();
    await expect(validateThreeLoad(corrupt, contract)).rejects.toThrow(/明显穿地/);
  });
  it('rejects a Jump pose that adds a second upward root trajectory to the game jump', async () => {
    const corrupt = altered((json, binary) => {
      const action = clip(json, 'Jump');
      const target = record(list(action.channels).find((item) => { const t = record(record(item).target); return t.node === boneId(json, 'Hips') && t.path === 'translation'; }));
      const sampler = record(list(action.samplers)[number(target.sampler)]); const data = accessor(json, sampler.output);
      expect(sampler.interpolation ?? 'LINEAR').toBe('LINEAR');
      for (let i = 0; i < number(data.value.count); i++) {
        const y = data.offset + i * (data.stride || 12) + 4; binary.writeFloatLE(binary.readFloatLE(y) + .3, y);
      }
    });
    expect(() => validateGlbStructure(corrupt, contract)).not.toThrow();
    await expect(validateThreeLoad(corrupt, contract)).rejects.toThrow(/叠加骨盆向上 Root Motion/);
  });
  it('rejects a valid quaternion track that drives the left knee across the body center', async () => {
    const corrupt = altered((json, binary) => {
      const id = boneId(json, 'LeftUpperLeg'); const action = clip(json, 'Slide');
      const target = record(list(action.channels).find((item) => { const t = record(record(item).target); return t.node === id && t.path === 'rotation'; }));
      const sampler = record(list(action.samplers)[number(target.sampler)]); const data = accessor(json, sampler.output);
      const rest = list(at(json, 'nodes', id).rotation).map(number);
      const crossed = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2).multiply(new Quaternion().fromArray(rest)).normalize().toArray();
      for (let i = 0; i < number(data.value.count); i++) crossed.forEach((value, axis) => binary.writeFloatLE(value, data.offset + i * (data.stride || 16) + axis * 4));
    });
    expect(() => validateGlbStructure(corrupt, contract)).not.toThrow();
    await expect(validateThreeLoad(corrupt, contract)).rejects.toThrow(/膝关节跨过身体中线或左右交叉/);
  });
  it('rejects loop discontinuity after actual AnimationMixer playback', async () => {
    const corrupt = altered((json, binary) => {
      const action = clip(json, 'Run');
      const target = record(list(action.channels).find((item) => { const t = record(record(item).target); return t.node === boneId(json, 'LeftUpperLeg') && t.path === 'rotation'; }));
      const sampler = record(list(action.samplers)[number(target.sampler)]); const data = accessor(json, sampler.output);
      const offset = data.offset + (number(data.value.count) - 1) * (data.stride || 16);
      for (const [i, value] of [Math.sin(.3), 0, 0, Math.cos(.3)].entries()) binary.writeFloatLE(value, offset + i * 4);
    });
    await expect(validateThreeLoad(corrupt, contract)).rejects.toThrow(/首尾不连续|明显穿地/);
  });
});
