import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { Bone, Mesh, MeshStandardMaterial, SkinnedMesh } from 'three';
import type { Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createAssetInstance } from '../../src/assets/GeneratedAsset';
import { getAsset } from '../../src/assets/catalog';
import { applyAppearance } from '../../src/character/CharacterAppearance';
import { CHARACTER_SKINS, getCharacterSkin, isSkinId } from '../../src/character/appearance';
import { CharacterAnimationController } from '../../src/character/CharacterAnimationController';

let fixture: GLTF;
beforeAll(async () => {
  const bytes = await readFile(new URL('../../public/models/generated/city-runner.glb', import.meta.url));
  fixture = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  fixture.scene.updateMatrixWorld(true);
});
const clone = () => createAssetInstance(fixture.scene, getAsset('city-runner').dimensions);
function meshes(root: Object3D): Mesh[] { const result: Mesh[] = []; root.traverse((object) => { if (object instanceof Mesh) result.push(object); }); return result; }
function disposeBones(root: Object3D): void {
  const skeletons = new Set<SkinnedMesh['skeleton']>();
  root.traverse((object) => { if (object instanceof SkinnedMesh) skeletons.add(object.skeleton); });
  skeletons.forEach((skeleton) => skeleton.dispose());
}
function materialAt(root: Object3D, name: string): MeshStandardMaterial {
  const mesh = root.getObjectByName(name);
  if (!(mesh instanceof Mesh) || !(mesh.material instanceof MeshStandardMaterial)) throw new Error(`Expected actual clothing primitive ${name}`);
  return mesh.material;
}

describe('three free City Runner clothing appearances', () => {
  it('uses one explicit set of stable IDs and rejects unknown skin IDs', () => {
    expect(CHARACTER_SKINS.map((skin) => skin.id)).toEqual(['original-orange', 'neon-cyan', 'midnight-violet']);
    for (const skin of CHARACTER_SKINS) { expect(isSkinId(skin.id)).toBe(true); expect(getCharacterSkin(skin.id)).toBe(skin); expect(Object.isFrozen(skin.colors)).toBe(true); }
    for (const value of [null, '', 'city-runner', 'unknown', 2, {}, 'NEON-CYAN']) expect(isSkinId(value)).toBe(false);
  });
  it('preserves original-orange cached materials and all their properties exactly', () => {
    const instance = clone();
    const before = meshes(instance).map((mesh) => ({ material: mesh.material, json: JSON.stringify(Array.isArray(mesh.material) ? mesh.material.map((value) => value.toJSON()) : mesh.material.toJSON()) }));
    const lease = applyAppearance(instance, 'original-orange');
    expect(lease.materials).toHaveLength(0);
    meshes(instance).forEach((mesh, index) => { expect(mesh.material).toBe(before[index]?.material); expect(JSON.stringify(Array.isArray(mesh.material) ? mesh.material.map((value) => value.toJSON()) : mesh.material.toJSON())).toBe(before[index]?.json); });
    lease.dispose(); disposeBones(instance);
  });
  it.each(['neon-cyan', 'midnight-violet'] as const)('%s changes only privately cloned clothing colors, never the source, face or another instance', (skinId) => {
    const instance = clone(); const other = clone();
    const original = materialAt(fixture.scene, 'city_runner_Torso_mesh');
    const originalColor = original.color.getHexString();
    const face = materialAt(instance, 'city_runner_Head_mesh_1');
    const hair = materialAt(instance, 'city_runner_Hair');
    const sourceSkin = materialAt(instance, 'city_runner_Head_mesh');
    const lease = applyAppearance(instance, skinId);
    expect(lease.materials).toHaveLength(3);
    const jacket = materialAt(instance, 'city_runner_Torso_mesh');
    expect(jacket).not.toBe(original);
    expect(jacket.color.getHexString()).toBe(getCharacterSkin(skinId).colors.jacket.slice(1).toLowerCase());
    expect(materialAt(instance, 'city_runner_Pelvis').color.getHexString()).toBe(getCharacterSkin(skinId).colors.pants.slice(1).toLowerCase());
    expect(materialAt(instance, 'city_runner_LeftFoot_mesh').color.getHexString()).toBe(getCharacterSkin(skinId).colors.shoe.slice(1).toLowerCase());
    expect(materialAt(other, 'city_runner_Torso_mesh')).toBe(original); expect(original.color.getHexString()).toBe(originalColor);
    expect(materialAt(instance, 'city_runner_Head_mesh_1')).toBe(face); expect(materialAt(instance, 'city_runner_Hair')).toBe(hair); expect(materialAt(instance, 'city_runner_Head_mesh')).toBe(sourceSkin);
    expect(jacket.roughness).toBe(original.roughness); expect(jacket.metalness).toBe(original.metalness); expect(jacket.name).toBe(original.name);
    lease.dispose(); expect(materialAt(instance, 'city_runner_Torso_mesh')).toBe(original); disposeBones(instance); disposeBones(other);
  });
  it('shares the three private clothing materials across primitives and releases only its own materials once', () => {
    const instance = clone();
    const geometries = meshes(instance).map((mesh) => mesh.geometry);
    const sharedDispose = vi.fn();
    const original = materialAt(fixture.scene, 'city_runner_Torso_mesh'); original.addEventListener('dispose', sharedDispose);
    const geometryDispose = vi.fn(); for (const geometry of new Set(geometries)) geometry.addEventListener('dispose', geometryDispose);
    const lease = applyAppearance(instance, 'neon-cyan');
    expect(materialAt(instance, 'city_runner_Torso_mesh')).toBe(materialAt(instance, 'city_runner_LeftUpperArm'));
    const privateDisposed = vi.fn(); for (const material of lease.materials) material.addEventListener('dispose', privateDisposed);
    lease.dispose(); lease.dispose();
    expect(privateDisposed).toHaveBeenCalledTimes(3); expect(sharedDispose).not.toHaveBeenCalled(); expect(geometryDispose).not.toHaveBeenCalled();
    meshes(instance).forEach((mesh, index) => expect(mesh.geometry).toBe(geometries[index]));
    original.removeEventListener('dispose', sharedDispose); for (const geometry of new Set(geometries)) geometry.removeEventListener('dispose', geometryDispose);
    disposeBones(instance);
  });
  it('replaces an old lease cleanly and restores the loader materials after repeated switches', () => {
    const instance = clone(); const original = materialAt(instance, 'city_runner_Torso_mesh');
    const cyan = applyAppearance(instance, 'neon-cyan'); const violet = applyAppearance(instance, 'midnight-violet');
    cyan.dispose(); expect(materialAt(instance, 'city_runner_Torso_mesh').color.getHexString()).toBe('9c79df');
    violet.dispose(); expect(materialAt(instance, 'city_runner_Torso_mesh')).toBe(original);
    const again = applyAppearance(instance, 'neon-cyan'); applyAppearance(instance, 'original-orange'); again.dispose();
    expect(materialAt(instance, 'city_runner_Torso_mesh')).toBe(original); disposeBones(instance);
  });
  it('leaves geometry, skeleton bindings, bone transforms and animation clips untouched while animating the selected variant', () => {
    const instance = clone();
    const bound = meshes(instance).filter((mesh): mesh is SkinnedMesh => mesh instanceof SkinnedMesh).map((mesh) => ({ mesh, skeleton: mesh.skeleton, binding: mesh.bindMatrix.toArray(), geometry: mesh.geometry }));
    const beforeBones: number[][] = []; instance.traverse((object) => { if (object instanceof Bone) beforeBones.push([...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()]); });
    const clips = fixture.animations.map((clip) => JSON.stringify(clip.toJSON()));
    const lease = applyAppearance(instance, 'midnight-violet');
    const afterBones: number[][] = []; instance.traverse((object) => { if (object instanceof Bone) afterBones.push([...object.position.toArray(), ...object.quaternion.toArray(), ...object.scale.toArray()]); });
    expect(afterBones).toEqual(beforeBones);
    for (const entry of bound) { expect(entry.mesh.skeleton).toBe(entry.skeleton); expect(entry.mesh.geometry).toBe(entry.geometry); expect(entry.mesh.bindMatrix.toArray()).toEqual(entry.binding); }
    const controller = new CharacterAnimationController(instance, fixture.animations);
    controller.playPreview('idle', .1, 1, true); expect(controller.diagnostics().time).toBeCloseTo(.1, 6);
    const time = controller.diagnostics().time; controller.playPreview('idle', .1, 1, false); expect(controller.diagnostics().time).toBe(time);
    expect(fixture.animations.map((clip) => JSON.stringify(clip.toJSON()))).toEqual(clips);
    controller.dispose(); lease.dispose(); disposeBones(instance);
  });
});
