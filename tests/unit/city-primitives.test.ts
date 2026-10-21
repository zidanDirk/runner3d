import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AnimationClip, Box3, BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, SkinnedMesh, Vector3 } from 'three';
import type { Material } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { disposeCityPrimitiveViews, getCityPrimitives } from '../../src/assets/city-primitives';
import { getAsset } from '../../src/assets/catalog';

function groundedBox(width = 2, height = 4, depth = 6) {
  const source = new Group();
  const geometry = new BoxGeometry(width, height, depth);
  const material = new MeshStandardMaterial();
  const mesh: Mesh<BufferGeometry, Material | Material[]> = new Mesh(geometry, material);
  mesh.position.y = height / 2;
  source.add(mesh);
  return { source, mesh, geometry, material };
}

function cleanup(source: Group): void {
  disposeCityPrimitiveViews(source);
  source.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

function primitiveBounds(primitives: ReturnType<typeof getCityPrimitives>): Box3 {
  const bounds = new Box3();
  const point = new Vector3();
  for (const primitive of primitives) {
    const position = primitive.geometry.getAttribute('position');
    for (let index = 0; index < position.count; index += 1) {
      bounds.expandByPoint(point.fromBufferAttribute(position, index).applyMatrix4(primitive.matrix));
    }
  }
  return bounds;
}

describe('static GLB city primitive extraction', () => {
  it.each(['city-building-01', 'city-building-02', 'street-lamp'] as const)('loads the real %s and preserves its material primitives and ground contract', async (id) => {
    const asset = getAsset(id);
    const bytes = readFileSync(new URL(`../../public/${asset.path}`, import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(new Uint8Array(bytes).buffer, '');
    const primitives = getCityPrimitives(gltf.scene, asset.dimensions);
    expect(primitives).toHaveLength(asset.primitiveCount);
    expect(new Set(primitives.map((primitive) => primitive.material.name)).size).toBe(asset.materialCount);
    const meshes: Mesh[] = [];
    gltf.scene.traverse((object) => { if (object instanceof Mesh) meshes.push(object); });
    primitives.forEach((primitive) => {
      expect(meshes.some((mesh) => mesh.geometry === primitive.geometry && mesh.material === primitive.material)).toBe(true);
      expect(primitive.material.name).toMatch(new RegExp(`^${id.replaceAll('-', '_')}_`));
    });
    const bounds = primitiveBounds(primitives);
    bounds.getSize(new Vector3()).toArray().forEach((value, axis) => expect(value).toBeCloseTo(asset.dimensions[axis] ?? 0, 4));
    expect(bounds.min.y).toBeCloseTo(0, 5);
    expect(bounds.getCenter(new Vector3()).x).toBeCloseTo(0, 5);
    expect(bounds.getCenter(new Vector3()).z).toBeCloseTo(0, 5);
    expect(getCityPrimitives(gltf.scene, asset.dimensions)).toBe(primitives);
    cleanup(gltf.scene);
  });

  it('flattens nested transforms including the asset root while ignoring an external parent', () => {
    const source = new Group();
    source.rotation.y = Math.PI / 2;
    source.position.y = 1;
    const outer = new Group();
    outer.position.set(100, 100, 100);
    outer.add(source);
    const middle = new Group();
    middle.position.y = 1;
    middle.scale.x = 2;
    source.add(middle);
    const mesh = new Mesh(new BoxGeometry(2, 4, 6), new MeshStandardMaterial());
    middle.add(mesh);
    const primitives = getCityPrimitives(source, [6, 4, 4]);
    source.updateMatrix(); middle.updateMatrix(); mesh.updateMatrix();
    const expected = new Matrix4().multiplyMatrices(source.matrix, middle.matrix).multiply(mesh.matrix);
    expect(primitives[0]?.matrix.elements).toEqual(expected.elements);
    expect(primitiveBounds(primitives).min.y).toBeCloseTo(0);
    expect(mesh.geometry).toBe(primitives[0]?.geometry);
    cleanup(source);
  });

  it('splits multi-material groups into cached views without copying vertex/index buffers or changing the source', () => {
    const source = new Group();
    const geometry = new BoxGeometry(2, 4, 6);
    geometry.groups.forEach((group, index) => { group.materialIndex = index % 2; });
    geometry.setDrawRange(6, 24);
    const originalGroups = geometry.groups.map((group) => ({ ...group }));
    const materials = [new MeshStandardMaterial(), new MeshStandardMaterial()];
    const mesh = new Mesh(geometry, materials);
    mesh.position.y = 2;
    source.add(mesh);
    const primitives = getCityPrimitives(source, [2, 4, 6]);
    expect(primitives).toHaveLength(4);
    primitives.forEach((primitive, index) => {
      expect(primitive.geometry).not.toBe(geometry);
      expect(primitive.geometry.getAttribute('position')).toBe(geometry.getAttribute('position'));
      expect(primitive.geometry.index).toBe(geometry.index);
      expect(primitive.geometry.groups).toHaveLength(0);
      expect(primitive.geometry.drawRange).toEqual({ start: (index + 1) * 6, count: 6 });
      expect(primitive.material).toBe(materials[(index + 1) % 2]);
    });
    expect(geometry.groups).toEqual(originalGroups);
    expect(geometry.drawRange).toEqual({ start: 6, count: 24 });
    expect(getCityPrimitives(source, [2, 4, 6])).toBe(primitives);
    let viewsDisposed = 0;
    let sourceDisposed = 0;
    primitives.forEach((primitive) => primitive.geometry.addEventListener('dispose', () => { viewsDisposed += 1; }));
    geometry.addEventListener('dispose', () => { sourceDisposed += 1; });
    disposeCityPrimitiveViews(source);
    expect(viewsDisposed).toBe(4);
    expect(sourceDisposed).toBe(0);
    disposeCityPrimitiveViews(source);
    expect(viewsDisposed).toBe(4);
    cleanup(source);
  });

  it('validates dimensions even on a cache hit and rejects a floating or non-finite model', () => {
    const { source, mesh } = groundedBox();
    getCityPrimitives(source, [2, 4, 6]);
    expect(() => getCityPrimitives(source, [20, 4, 6])).toThrow('dimensions');
    expect(() => getCityPrimitives(source, [2, NaN, 6])).toThrow('positive finite');
    cleanup(source);
    mesh.position.y = 3;
    expect(() => getCityPrimitives(source, [2, 4, 6])).toThrow('ground origin');
    mesh.position.y = Infinity;
    expect(() => getCityPrimitives(source, [2, 4, 6])).toThrow('non-finite object transform');
  });

  it('fails explicitly for empty, animated, skinned, already instanced or morphing models', () => {
    expect(() => getCityPrimitives(new Group(), [2, 4, 6])).toThrow('no renderable');
    const { source, geometry, material } = groundedBox();
    source.animations = [new AnimationClip('moving', 1, [])];
    expect(() => getCityPrimitives(source, [2, 4, 6])).toThrow('animated');
    source.animations = [];
    for (const unsupported of [new SkinnedMesh(geometry, material), new InstancedMesh(geometry, material, 1)]) {
      const group = new Group(); group.add(unsupported);
      expect(() => getCityPrimitives(group, [2, 4, 6])).toThrow('skinned or already instanced');
    }
    geometry.morphAttributes.position = [geometry.getAttribute('position')];
    expect(() => getCityPrimitives(source, [2, 4, 6])).toThrow('morph targets');
    cleanup(source);
  });

  it('rejects malformed groups, missing positions and invalid draw ranges', () => {
    const { source, mesh, geometry, material } = groundedBox();
    mesh.material = [material];
    geometry.clearGroups();
    expect(() => getCityPrimitives(source, [2, 4, 6])).toThrow('explicit geometry groups');
    geometry.addGroup(0, 6, 1);
    expect(() => getCityPrimitives(source, [2, 4, 6])).toThrow('missing material');
    geometry.clearGroups(); geometry.addGroup(0, 3_000, 0);
    expect(() => getCityPrimitives(source, [2, 4, 6])).toThrow('invalid geometry group range');
    mesh.material = material;
    geometry.setDrawRange(1, 6);
    expect(() => getCityPrimitives(source, [2, 4, 6])).toThrow('complete triangle');
    mesh.geometry = new BufferGeometry();
    expect(() => getCityPrimitives(source, [2, 4, 6])).toThrow('position attribute');
    mesh.geometry.setAttribute('position', new Float32BufferAttribute([0, NaN, 0, 1, 0, 0, 0, 1, 0], 3));
    expect(() => getCityPrimitives(source, [2, 4, 6])).toThrow('non-finite vertex');
    geometry.dispose(); cleanup(source);
  });
});
