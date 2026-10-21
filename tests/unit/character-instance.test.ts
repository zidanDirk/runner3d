import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createAssetInstance } from '../../src/assets/GeneratedAsset';
import { getAsset } from '../../src/assets/catalog';

// Actual exported skin fixture; no handcrafted success model.
describe('independent skeleton instances with shared immutable geometry', () => {
  it('clones bones once per instance and preserves shared Skeletons across its material primitives', async () => {
    const buffer = await readFile(new URL('../../public/models/generated/city-runner.glb', import.meta.url));
    const asset = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    asset.scene.updateMatrixWorld(true);
    const a = createAssetInstance(asset.scene, getAsset('city-runner').dimensions);
    const b = createAssetInstance(asset.scene, getAsset('city-runner').dimensions);
    const meshes = (root: typeof a) => { const result: SkinnedMesh[] = []; root.traverse((object) => { if (object instanceof SkinnedMesh) result.push(object); }); return result; };
    const original = meshes(asset.scene); const first = meshes(a); const second = meshes(b);
    expect(original.length).toBeGreaterThan(0); expect(first).toHaveLength(original.length); expect(second).toHaveLength(original.length);
    expect(new Set(first.map((mesh) => mesh.skeleton)).size).toBe(new Set(original.map((mesh) => mesh.skeleton)).size);
    for (let i = 0; i < first.length; i++) {
      const source = original[i]; const one = first[i]; const two = second[i];
      if (!source || !one || !two) throw new Error('Expected actual skin primitives');
      expect(one.geometry).toBe(source.geometry); expect(one.material).toBe(source.material);
      expect(two.geometry).toBe(source.geometry); expect(two.material).toBe(source.material);
      expect(one.skeleton).not.toBe(two.skeleton); expect(one.skeleton.bones[0]).not.toBe(two.skeleton.bones[0]);
    }
    const left = a.getObjectByName('LeftUpperLeg'); const other = b.getObjectByName('LeftUpperLeg');
    if (!left || !other) throw new Error('Actual bones missing');
    const before = other.quaternion.toArray(); left.rotation.x += .5; a.updateMatrixWorld(true);
    expect(other.quaternion.toArray()).toEqual(before);
    for (const root of [a, b]) new Set(meshes(root).map((mesh) => mesh.skeleton)).forEach((skin) => skin.dispose());
  });
});
