import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { analyzeCharacterMotion, analyzeMotionFile, assertCharacterMotionQuality, compareMotionAnalysis, DEFAULT_SPEED_CASES } from '../../scripts/assets/character-motion-analysis.mjs';
import type { CharacterMotionAnalysis } from '../../scripts/assets/character-motion-analysis.mjs';
import { calculateRunAnimationSpeed } from '../../src/character/motionMath';
import { PROJECT_ROOT } from '../../scripts/assets/config.mjs';

const run = promisify(execFile);
const source = resolve(PROJECT_ROOT, 'public/models/generated/city-runner.glb');
const script = resolve(PROJECT_ROOT, 'scripts/assets/character-motion-analysis.mjs');
let directory: string;
let real: Buffer;
let actual: CharacterMotionAnalysis;
let fixtureId = 0;
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected actual GLB record'); return value as Record<string, unknown>; }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('Expected actual GLB array'); return value; }
function number(value: unknown): number { if (typeof value !== 'number') throw new Error('Expected actual GLB number'); return value; }
function item(json: Record<string, unknown>, collection: string, id: unknown) { return record(array(json[collection])[number(id)]); }
function accessor(json: Record<string, unknown>, id: unknown) {
  const value = item(json, 'accessors', id); const view = item(json, 'bufferViews', value.bufferView);
  return { value, offset: number(view.byteOffset ?? 0) + number(value.byteOffset ?? 0), stride: number(view.byteStride ?? 0) };
}
function runClip(json: Record<string, unknown>) { return record(array(json.animations).find((clip) => record(clip).name === 'Run')); }
function hipsTrack(json: Record<string, unknown>) {
  const id = array(json.nodes).findIndex((node) => record(node).name === 'Hips'); const clip = runClip(json);
  const channel = record(array(clip.channels).find((entry) => { const target = record(record(entry).target); return target.node === id && target.path === 'translation'; }));
  return accessor(json, record(array(clip.samplers)[number(channel.sampler)]).output);
}
async function mutated(mutate: (json: Record<string, unknown>, binary: Buffer) => void) {
  const buffer = Buffer.from(real); const jsonLength = buffer.readUInt32LE(12);
  const json = record(JSON.parse(buffer.subarray(20, 20 + jsonLength).toString('utf8')));
  mutate(json, buffer.subarray(28 + jsonLength));
  const path = join(directory, `corrupt-${fixtureId++}.glb`); await writeFile(path, buffer);
  return analyzeMotionFile({ filePath: path, includeSamples: false });
}
function shiftFoot(json: Record<string, unknown>, binary: Buffer, axis: number, amount: number) {
  const node = record(array(json.nodes).find((value) => record(value).name === 'city_runner_LeftFoot'));
  const seen = new Set<number>();
  for (const primitive of array(item(json, 'meshes', node.mesh).primitives)) {
    const id = number(record(record(primitive).attributes).POSITION); if (seen.has(id)) continue; seen.add(id);
    const data = accessor(json, id); expect(data.value.componentType).toBe(5126);
    for (let i = 0; i < number(data.value.count); i++) { const offset = data.offset + i * (data.stride || 12) + axis * 4; binary.writeFloatLE(binary.readFloatLE(offset) + amount, offset); }
  }
}

describe('actual geometry-based source motion quality', () => {
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'runner-motion-quality-'));
    real = await readFile(source); actual = await analyzeMotionFile({ filePath: source });
  });
  afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

  it('uses actual sole vertices, records quarters/dense samples and meets the measured Task 8 targets', () => {
    expect(actual.reference.feet.left.vertices.length).toBeGreaterThanOrEqual(3);
    expect(actual.reference.feet.right.vertices.length).toBeGreaterThanOrEqual(3);
    for (const side of ['left', 'right'] as const) {
      expect(actual.reference.feet[side].vertices.every((vertex) => vertex.restPosition[1] !== undefined && Math.abs(vertex.restPosition[1]) < .001)).toBe(true);
      expect(actual.quarterSamples[0]?.[side].ankle[1]).toBeGreaterThan(.1);
      expect(actual.feet[side].foreAftSpan).toBeGreaterThan(.60);
    }
    expect(actual.samples).toHaveLength(241);
    expect(actual.quarterSamples.map(({ progress }) => progress)).toEqual([0, .25, .5, .75, 1]);
    expect(actual.penetration).toBeLessThanOrEqual(.003);
    expect(actual.symmetry.max).toBeLessThanOrEqual(.005);
    expect(actual.bodyVelocitySeam).toBeLessThanOrEqual(.08);
    expect(() => assertCharacterMotionQuality(actual, { requireTargets: true })).not.toThrow();
  });
  it('distinguishes near-ground geometry from support candidates and reports large residual slip honestly', () => {
    expect(DEFAULT_SPEED_CASES).toEqual([16, 24].map((gameSpeed) => ({ gameSpeed, timeScale: calculateRunAnimationSpeed(gameSpeed) })));
    for (const side of ['left', 'right'] as const) {
      const metrics = actual.feet[side];
      expect(metrics.nearGroundDuty).toBeGreaterThan(metrics.supportCandidateDuty);
      expect(metrics.supportCandidateDuty).toBeGreaterThan(.4);
      expect(metrics.supportCandidateDuty).toBeLessThan(.5);
      expect(metrics.backwardSpeed.mean).toBeGreaterThan(1.8);
      for (const scenario of metrics.speedCases) {
        expect(scenario.meanResidualFraction).toBeGreaterThan(.8);
        expect(scenario.residualSlip.mean).toBeCloseTo(scenario.gameSpeed - metrics.backwardSpeed.mean * scenario.timeScale, 8);
      }
    }
  });
  it('restores the caller pose and produces a repeatable analysis without persistent pose state', async () => {
    const data = new ArrayBuffer(real.byteLength); new Uint8Array(data).set(real);
    const gltf = await new GLTFLoader().parseAsync(data, '');
    const bone = gltf.scene.getObjectByName('LeftUpperArm'); if (!bone) throw new Error('Expected actual bone'); bone.rotateX(.2);
    const before: number[][] = []; gltf.scene.traverse((object) => { before.push([...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()]); });
    const first = analyzeCharacterMotion(gltf, { includeSamples: false }); const second = analyzeCharacterMotion(gltf, { includeSamples: false });
    expect(first).toEqual(second);
    const after: number[][] = []; gltf.scene.traverse((object) => { after.push([...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()]); });
    expect(after).toEqual(before);
    expect(first.samples).toBeUndefined(); expect(first.quarterSamples).toHaveLength(5);
  });
  it('detects real shoe penetration even though the ankle skeleton stays safely above ground', async () => {
    const bad = await mutated((json, binary) => shiftFoot(json, binary, 1, -.02));
    expect(bad.quarterSamples[0]?.left.ankle[1]).toBeGreaterThan(.1);
    expect(bad.penetration).toBeGreaterThan(.02);
    expect(() => assertCharacterMotionQuality(bad)).toThrow(/sole-penetration/);
  });
  it('detects a shifted real left shoe as half-cycle asymmetry', async () => {
    const bad = await mutated((json, binary) => shiftFoot(json, binary, 0, .025));
    expect(bad.symmetry.rms).toBeGreaterThan(.02);
    expect(() => assertCharacterMotionQuality(bad)).toThrow(/mirrored-rms/);
  });
  it('detects a velocity seam even when the first and last bone poses still coincide', async () => {
    const bad = await mutated((json, binary) => {
      const data = hipsTrack(json); const offset = data.offset + (data.stride || 12) + 4;
      binary.writeFloatLE(binary.readFloatLE(offset) + .02, offset);
    });
    expect(bad.loop.hips.positionError).toBeLessThan(.001);
    expect(bad.bodyVelocitySeam).toBeGreaterThan(.25);
    expect(() => assertCharacterMotionQuality(bad)).toThrow(/body-velocity-seam/);
  });
  it('detects actual backward gait support after reversing the valid exported Run track values and times', async () => {
    const bad = await mutated((json, binary) => {
      const clip = runClip(json); const outputs = new Set<number>(); const inputs = new Set<number>();
      for (const value of array(clip.samplers)) {
        const sampler = record(value); expect(sampler.interpolation ?? 'LINEAR').toBe('LINEAR');
        const outputId = number(sampler.output);
        if (!outputs.has(outputId)) {
          outputs.add(outputId); const data = accessor(json, outputId); const size = data.value.type === 'VEC4' ? 4 : 3;
          const count = number(data.value.count); const rows = Array.from({ length: count }, (_, i) => Array.from({ length: size }, (_, axis) => binary.readFloatLE(data.offset + i * (data.stride || size * 4) + axis * 4)));
          rows.reverse().forEach((row, i) => row.forEach((n, axis) => binary.writeFloatLE(n, data.offset + i * (data.stride || size * 4) + axis * 4)));
        }
        const inputId = number(sampler.input);
        if (!inputs.has(inputId)) {
          inputs.add(inputId); const data = accessor(json, inputId); const count = number(data.value.count);
          const times = Array.from({ length: count }, (_, i) => binary.readFloatLE(data.offset + i * (data.stride || 4)));
          times.reverse().forEach((time, i) => binary.writeFloatLE(actual.duration - time, data.offset + i * (data.stride || 4)));
        }
      }
    });
    expect(bad.feet.left.backwardSpeed.mean).toBeLessThan(0);
    expect(bad.feet.left.reversedSupportFraction).toBeGreaterThan(.9);
    expect(() => assertCharacterMotionQuality(bad)).toThrow(/reversed-support/);
  });
  it('rejects actual NaN track data and invalid sampling options', async () => {
    await expect(mutated((json, binary) => { const data = hipsTrack(json); binary.writeFloatLE(NaN, data.offset + 4); })).rejects.toThrow(/NaN|Infinity|无效/);
    await expect(analyzeMotionFile({ intervals: 33 })).rejects.toThrow(/4的倍数/);
    await expect(analyzeMotionFile({ speedCases: [{ gameSpeed: NaN, timeScale: 1 }] })).rejects.toThrow(/速度比较输入/);
  });
  it('supports a real CLI report, compact before/after comparison and explicit failure', async () => {
    const output = join(directory, 'quality.json');
    const result = await run(process.execPath, [script, `--file=${source}`, `--output=${output}`]);
    expect(result.stdout).toContain('残余脚滑');
    const loaded: unknown = JSON.parse(await readFile(output, 'utf8'));
    expect(record(loaded).source).toMatchObject({ file: source, bytes: real.length });
    expect(compareMotionAnalysis(actual, actual).penetration).toBe(0);
    expect(() => compareMotionAnalysis({ ...actual, penetration: NaN }, actual)).toThrow(/有限实测值/);
    await expect(run(process.execPath, [script, '--unsupported=1'])).rejects.toThrow(/未知或重复参数/);
    await expect(run(process.execPath, [script, `--file=${join(directory, 'missing.glb')}`])).rejects.toThrow(/ENOENT/);
  });
});
