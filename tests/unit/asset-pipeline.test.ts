import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverBlender } from '../../scripts/assets/find-blender.mjs';
import { PROJECT_ROOT, readManifest, validateAsset, validateGlbStructure, validateThreeLoad } from '../../scripts/assets/validate.mjs';
import type { AssetManifest } from '../../scripts/assets/validate.mjs';

let temporary: string;

beforeAll(async () => { temporary = await mkdtemp(join(tmpdir(), 'runner3d-assets-test-')); });
afterAll(async () => { await rm(temporary, { recursive: true, force: true }); });

async function executable(path: string) {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, '#!/bin/sh\nexit 0\n');
  await chmod(path, 0o755);
  return path;
}

describe('Blender executable discovery', () => {
  it('accepts an explicit executable even when PATH is empty', async () => {
    const path = await executable(join(temporary, 'manual', 'blender'));
    expect(discoverBlender({ env: { BLENDER_PATH: path, PATH: '' }, platform: 'linux', pathCandidates: [] })).toBe(path);
  });

  it('resolves a macOS app bundle without relying on PATH', async () => {
    const app = join(temporary, 'Blender.app');
    const path = await executable(join(app, 'Contents', 'MacOS', 'Blender'));
    expect(discoverBlender({ env: { BLENDER_PATH: app }, platform: 'darwin', pathCandidates: [], searchDirs: [] })).toBe(path);
  });

  it('searches PATH and common candidates when no explicit override exists', async () => {
    const path = await executable(join(temporary, 'search', 'blender'));
    expect(discoverBlender({ env: { PATH: resolve(path, '..') }, platform: 'linux', pathCandidates: [] })).toBe(path);
    expect(discoverBlender({ env: { PATH: '' }, platform: 'linux', pathCandidates: [path] })).toBe(path);
  });

  it('reports a broken explicit path instead of silently selecting a different executable', async () => {
    const fallback = await executable(join(temporary, 'fallback', 'blender'));
    expect(() => discoverBlender({ env: { BLENDER_PATH: join(temporary, 'missing') }, pathCandidates: [fallback], searchDirs: [] })).toThrow(/BLENDER_PATH.*不存在/);
    expect(() => discoverBlender({ env: { BLENDER_PATH: '' }, pathCandidates: [fallback], searchDirs: [] })).toThrow(/BLENDER_PATH.*为空/);
  });

  it('gives actionable installation and environment configuration guidance when absent', () => {
    expect(() => discoverBlender({ env: { PATH: '' }, platform: 'linux', pathCandidates: [], searchDirs: [] })).toThrow(/当前未检测到 Blender.*https:\/\/www.blender.org\/download\//s);
    expect(() => discoverBlender({ env: {}, pathCandidates: [], searchDirs: [] })).toThrow(/BLENDER_PATH/);
  });
});

/** Corrupt the JSON chunk of the real Blender output; never manufacture a replacement success asset. */
function changedJson(source: Buffer, mutate: (json: Record<string, unknown>) => void) {
  const jsonLength = source.readUInt32LE(12);
  const json: Record<string, unknown> = JSON.parse(source.subarray(20, 20 + jsonLength).toString('utf8'));
  mutate(json);
  const content = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(content.length / 4) * 4, 0x20);
  content.copy(padded);
  const rest = source.subarray(20 + jsonLength);
  const output = Buffer.alloc(20 + padded.length + rest.length);
  source.copy(output, 0, 0, 12);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(padded.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(output, 20);
  rest.copy(output, 20 + padded.length);
  return output;
}

describe('generated roadblock contract and real Three.js loading', () => {
  let manifest: AssetManifest;
  let real: Buffer;

  beforeAll(async () => {
    manifest = await readManifest();
    // A fresh checkout must run assets:generate first; missing Blender output is a failure, never a skip.
    real = await readFile(resolve(PROJECT_ROOT, manifest.path));
  });

  it('loads the actual generated GLB with Three.js and checks its bounds, budget and materials', async () => {
    const result = await validateAsset();
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.three.triangles).toBeGreaterThan(0);
    expect(result.three.triangles).toBeLessThanOrEqual(manifest.maxTriangles);
    expect(result.three.materials.sort()).toEqual([...manifest.materials].sort());
    result.three.dimensions.forEach((value, axis) => {
      expect(Math.abs(value - (manifest.dimensions[axis] ?? 0))).toBeLessThanOrEqual(manifest.tolerance);
    });
    expect(Math.abs(result.three.min[1] ?? Infinity)).toBeLessThanOrEqual(manifest.tolerance);
  });

  it('rejects missing, empty and oversized files', async () => {
    await expect(validateAsset({ filePath: join(temporary, 'missing.glb') })).rejects.toThrow();
    const empty = join(temporary, 'empty.glb');
    await writeFile(empty, '');
    await expect(validateAsset({ filePath: empty })).rejects.toThrow(/为空/);
    const oversized = join(temporary, 'oversized.glb');
    await writeFile(oversized, Buffer.alloc(manifest.maxBytes + 1));
    await expect(validateAsset({ filePath: oversized })).rejects.toThrow(/超出上限/);
  });

  it('rejects corrupt magic, version, declared length and chunk bounds', () => {
    const magic = Buffer.from(real); magic.writeUInt32LE(0, 0);
    expect(() => validateGlbStructure(magic, manifest)).toThrow(/magic/);
    const version = Buffer.from(real); version.writeUInt32LE(1, 4);
    expect(() => validateGlbStructure(version, manifest)).toThrow(/version/);
    const length = Buffer.from(real); length.writeUInt32LE(length.length - 4, 8);
    expect(() => validateGlbStructure(length, manifest)).toThrow(/声明长度/);
    const chunk = Buffer.from(real); chunk.writeUInt32LE(real.length, 12);
    expect(() => validateGlbStructure(chunk, manifest)).toThrow(/chunk 长度/);
  });

  it('rejects a missing mesh, missing POSITION, renamed material and external content', () => {
    expect(() => validateGlbStructure(changedJson(real, (json) => { json.meshes = []; }), manifest)).toThrow(/Mesh 缺失/);
    expect(() => validateGlbStructure(changedJson(real, (json) => { json.meshes = [{ primitives: [{ attributes: {}, material: 0 }] }]; }), manifest)).toThrow(/POSITION/);
    expect(() => validateGlbStructure(changedJson(real, (json) => { json.materials = manifest.materials.map((name) => ({ name: `${name}_wrong` })); }), manifest)).toThrow(/材质名称/);
    expect(() => validateGlbStructure(changedJson(real, (json) => { json.buffers = [{ byteLength: 4, uri: 'https://example.invalid/model.bin' }]; }), manifest)).toThrow(/外部 URI/);
    expect(() => validateGlbStructure(changedJson(real, (json) => { json.images = [{ uri: 'texture.png' }]; }), manifest)).toThrow(/images/);
  });

  it('rejects malformed buffer ranges and negative node scale', () => {
    expect(() => validateGlbStructure(changedJson(real, (json) => { json.bufferViews = [{ buffer: 0, byteOffset: real.length * 2, byteLength: 4 }]; }), manifest)).toThrow(/超出 BIN/);
    expect(() => validateGlbStructure(changedJson(real, (json) => { json.nodes = [{ mesh: 0, scale: [-1, 1, 1] }]; }), manifest)).toThrow(/负缩放/);
  });

  it('keeps Skin and animation exceptions exclusive to the character contract', () => {
    expect(() => validateGlbStructure(changedJson(real, (json) => { json.skins = [{ joints: [0] }]; }), manifest)).toThrow(/不允许 skins/);
    expect(() => validateGlbStructure(changedJson(real, (json) => { json.animations = [{ name: 'Idle', channels: [], samplers: [] }]; }), manifest)).toThrow(/不允许 animations/);
  });

  it('rejects actual Three.js dimensions outside the manifest contract', async () => {
    await expect(validateThreeLoad(real, { ...manifest, dimensions: [200, 85, 90] })).rejects.toThrow(/模型尺寸异常/);
  });

  it('rejects an actual Three.js model lifted off the ground', async () => {
    const lifted = changedJson(real, (json) => {
      const nodes = json.nodes;
      const scenes = json.scenes;
      if (!Array.isArray(nodes) || !Array.isArray(scenes)) throw new Error('Generated GLB nodes/scenes are missing');
      const sceneIndex = typeof json.scene === 'number' ? json.scene : 0;
      const scene: unknown = scenes[sceneIndex];
      if (!scene || typeof scene !== 'object' || !('nodes' in scene) || !Array.isArray(scene.nodes)) throw new Error('Generated GLB scene is missing');
      const wrapper = nodes.length;
      nodes.push({ children: scene.nodes, translation: [0, 1, 0] });
      scene.nodes = [wrapper];
    });
    await expect(validateThreeLoad(lifted, manifest)).rejects.toThrow(/模型原点异常/);
  });
});
