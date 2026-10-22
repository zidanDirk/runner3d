import { Box3, BufferGeometry, InstancedMesh, Matrix4, Mesh, SkinnedMesh, Vector3 } from 'three';
import type { Material, Object3D } from 'three';
import { markSharedResource } from './renderer-resources';

export interface CityPrimitive {
  readonly key: string;
  readonly geometry: BufferGeometry;
  readonly material: Material;
  /** Asset-local transform, including the source root's local transform. Treat as immutable. */
  readonly matrix: Matrix4;
}

interface PreparedCityAsset {
  readonly primitives: readonly CityPrimitive[];
  readonly bounds: Box3;
  readonly ownedViews: readonly BufferGeometry[];
}

const cache = new WeakMap<Object3D, PreparedCityAsset>();
const tolerance = 0.005;

function fail(reason: string): never {
  throw new Error(`City GLB cannot be instanced: ${reason}`);
}

function validateBounds(bounds: Box3, dimensions: readonly number[]): void {
  if (dimensions.length !== 3 || dimensions.some((dimension) => !Number.isFinite(dimension) || dimension <= 0)) {
    fail('expected dimensions must contain three positive finite values');
  }
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
    || size.toArray().some((value, axis) => Math.abs(value - (dimensions[axis] ?? Infinity)) > tolerance)
    || Math.abs(bounds.min.y) > tolerance || Math.abs(center.x) > tolerance || Math.abs(center.z) > tolerance) {
    fail('incorrect dimensions or ground origin; run assets:validate');
  }
}

function drawRange(geometry: BufferGeometry): { start: number; end: number } {
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize !== 3 || position.count === 0) fail('mesh has no valid position attribute');
  const total = geometry.index?.count ?? position.count;
  const { start, count } = geometry.drawRange;
  if (!Number.isInteger(start) || start < 0 || start > total
    || (count !== Infinity && (!Number.isInteger(count) || count < 0))) fail('invalid geometry draw range');
  const end = Math.min(start + count, total);
  if (start % 3 !== 0 || (end - start) % 3 !== 0) fail('only complete triangle primitives are supported');
  return { start, end };
}

/** A geometry view owns its draw range, while borrowing all vertex/index buffers. */
function groupView(source: BufferGeometry, start: number, count: number): BufferGeometry {
  const geometry = new BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, attribute);
  geometry.setIndex(source.index);
  geometry.setDrawRange(start, count);
  geometry.boundingBox = source.boundingBox?.clone() ?? null;
  geometry.boundingSphere = source.boundingSphere?.clone() ?? null;
  return geometry;
}

/**
 * Flatten a static GLB into one instancing batch per mesh/material primitive.
 * The source and its buffers remain unchanged. Assets are immutable after loading;
 * cached views live as long as that source, never as long as an individual city chunk.
 */
export function getCityPrimitives(source: Object3D, dimensions: readonly number[]): readonly CityPrimitive[] {
  const existing = cache.get(source);
  if (existing) {
    validateBounds(existing.bounds, dimensions);
    return existing.primitives;
  }
  const primitives: CityPrimitive[] = [];
  const ownedViews: BufferGeometry[] = [];
  const bounds = new Box3();
  const vertex = new Vector3();
  function visit(object: Object3D, parentMatrix: Matrix4, path: string): void {
    if (object.animations.length) fail('animated objects are unsupported');
    if (object instanceof SkinnedMesh || object instanceof InstancedMesh) fail('skinned or already instanced meshes are unsupported');
    const local = object.matrixAutoUpdate
      ? new Matrix4().compose(object.position, object.quaternion, object.scale)
      : object.matrix;
    const matrix = new Matrix4().multiplyMatrices(parentMatrix, local);
    if (!matrix.elements.every(Number.isFinite)) fail('non-finite object transform');
    if (!object.visible) return;
    if (object instanceof Mesh) {
      const geometry: BufferGeometry = object.geometry;
      const materials: Material | Material[] = object.material;
      if (Object.values(geometry.morphAttributes).some((attributes) => attributes.length > 0)) fail('morph targets are unsupported');
      const range = drawRange(geometry);
      const position = geometry.getAttribute('position');
      for (let index = 0; index < position.count; index += 1) {
        vertex.fromBufferAttribute(position, index).applyMatrix4(matrix);
        if (!vertex.toArray().every(Number.isFinite)) fail('non-finite vertex position');
        bounds.expandByPoint(vertex);
      }
      if (Array.isArray(materials)) {
        if (!geometry.groups.length) fail('multi-material mesh requires explicit geometry groups');
        geometry.groups.forEach((group, index) => {
          const materialIndex = group.materialIndex ?? 0;
          const material = materials[materialIndex];
          if (!Number.isInteger(materialIndex) || materialIndex < 0 || !material) fail('geometry group references a missing material');
          const total = geometry.index?.count ?? position.count;
          if (!Number.isInteger(group.start) || !Number.isInteger(group.count) || group.start < 0 || group.count < 0
            || group.start + group.count > total) fail('invalid geometry group range');
          const start = Math.max(group.start, range.start);
          const end = Math.min(group.start + group.count, range.end);
          if (end <= start) return;
          if (start % 3 !== 0 || (end - start) % 3 !== 0) fail('geometry group splits a triangle');
          const view = groupView(geometry, start, end - start);
          ownedViews.push(view);
          primitives.push(Object.freeze({ key: `${path}:group-${index}:material-${materialIndex}`, geometry: view, material, matrix }));
        });
      } else if (range.end > range.start) {
        if (!materials) fail('mesh has no material');
        primitives.push(Object.freeze({ key: `${path}:material-0`, geometry, material: materials, matrix }));
      }
    }
    object.children.forEach((child, index) => visit(child, matrix, `${path}/${index}`));
  }
  try {
    visit(source, new Matrix4(), 'root');
    if (!primitives.length) fail('no renderable mesh primitives');
    validateBounds(bounds, dimensions);
    const result = Object.freeze(primitives);
    for (const primitive of result) { markSharedResource(primitive.geometry); markSharedResource(primitive.material); }
    cache.set(source, { primitives: result, bounds, ownedViews });
    return result;
  } catch (error) {
    ownedViews.forEach((geometry) => geometry.dispose());
    throw error;
  }
}

/** Only call when evicting the whole source asset; never on chunk recycling. */
export function disposeCityPrimitiveViews(source: Object3D): void {
  const prepared = cache.get(source);
  if (!prepared) return;
  cache.delete(source);
  prepared.ownedViews.forEach((geometry) => geometry.dispose());
}
