import { Component, Suspense, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useGLTF } from '@react-three/drei/core/Gltf.js';
import { Box3, Mesh, SkinnedMesh, Vector3 } from 'three';
import type { AnimationClip, Object3D, Skeleton } from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { assetIds, assetUrl, getAsset } from './catalog';
import type { AssetId } from './catalog';
import { getAssetTheme } from './theme';
import { AssetValidationError, loading, useAssetRevision } from './loading';
import type { AssetStatus } from './loading';
import { markSharedAssetResources } from './renderer-resources';

export type { AssetStatus } from './loading';
export const useAssetStatus = (id: AssetId): AssetStatus => useSyncExternalStore(loading.subscribe, () => loading.status(id), () => 'idle');

/** Preload only selected IDs; all hooks use the same URL/cache and no external decoders. */
export function preloadAssets(ids: readonly AssetId[] = assetIds): void {
  ids.forEach((id) => useGLTF.preload(assetUrl(id), false, false));
}

export function validateAssetDimensions(source: Object3D, dimensions: readonly number[]): void {
  const bounds = new Box3().setFromObject(source, true);
  const size = bounds.getSize(new Vector3());
  const center = bounds.getCenter(new Vector3());
  if (![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
    || size.toArray().some((value, axis) => Math.abs(value - (dimensions[axis] ?? Infinity)) > 0.005)
    || Math.abs(bounds.min.y) > 0.005 || Math.abs(center.x) > 0.005 || Math.abs(center.z) > 0.005) {
    throw new AssetValidationError('Generated GLB has incorrect dimensions or ground origin; run assets:generate / assets:validate');
  }
}

export function createAssetInstance(source: Object3D, dimensions: readonly number[]): Object3D {
  markSharedAssetResources(source);
  validateAssetDimensions(source, dimensions);
  let skinned = false;
  source.traverse((object) => { if (object instanceof SkinnedMesh) skinned = true; });
  const instance = skinned ? cloneSkeleton(source) : source.clone(true);
  if (skinned) {
    // SkeletonUtils clones once per primitive. Preserve the source's sharing
    // inside this instance while keeping bones independent of every other clone.
    const originals: SkinnedMesh[] = [];
    const copies: SkinnedMesh[] = [];
    const skeletons = new Map<Skeleton, Skeleton>();
    source.traverse((object) => { if (object instanceof SkinnedMesh) originals.push(object); });
    instance.traverse((object) => { if (object instanceof SkinnedMesh) copies.push(object); });
    copies.forEach((mesh, index) => {
      const original = originals[index];
      if (!original) throw new Error('Skinned clone hierarchy mismatch');
      const shared = skeletons.get(original.skeleton);
      if (shared) mesh.skeleton = shared;
      else skeletons.set(original.skeleton, mesh.skeleton);
    });
  }
  instance.traverse((object) => {
    if (object instanceof Mesh) { object.castShadow = true; object.receiveShadow = true; }
    // One nearby hero; its rest-pose per-part spheres cannot describe bent limbs.
    if (object instanceof SkinnedMesh) object.frustumCulled = false;
  });
  return instance;
}

export function AssetFallback({ id }: { id: AssetId }) {
  const asset = getAsset(id);
  const activeTheme = getAssetTheme(id);
  const width = asset.dimensions[0] ?? 1;
  const height = asset.dimensions[1] ?? 1;
  const depth = asset.dimensions[2] ?? 1;
  return <group name={`${id}-fallback`}>
    <mesh position={[0, height / 2, 0]} castShadow>
      {asset.type === 'traffic-cone' ? <coneGeometry args={[width / 2, height, 8]} /> : <boxGeometry args={[width, height, depth]} />}
      <meshStandardMaterial color={asset.type === 'building' ? activeTheme.materials.building.color : asset.type === 'street-lamp' ? activeTheme.materials.metal.color : activeTheme.materials.warning.color} roughness={0.8} />
    </mesh>
  </group>;
}

function LoadingFallback({ id, children }: { id: AssetId; children: ReactNode }) {
  useEffect(() => { loading.request(id); }, [id]);
  return children;
}

interface AssetProps {
  id: AssetId;
  fallback?: ReactNode;
  prepare?: (source: Object3D) => Object3D;
  castShadow?: boolean;
  renderInstance?: (instance: Object3D, clips: readonly AnimationClip[]) => ReactNode;
}

function LoadedAsset({ id, prepare, castShadow = true, renderInstance }: AssetProps) {
  const { scene, animations } = useGLTF(assetUrl(id), false, false);
  const revision = useAssetRevision(id);
  const instance = useMemo(() => {
    markSharedAssetResources(scene);
    const result = prepare ? prepare(scene) : createAssetInstance(scene, getAsset(id).dimensions);
    result.traverse((object) => { if (object instanceof Mesh) object.castShadow = castShadow; });
    return result;
  }, [scene, id, prepare, castShadow]);
  useEffect(() => { loading.loaded(id, revision); }, [id, instance, revision]);
  useEffect(() => () => {
    const skeletons = new Set<SkinnedMesh['skeleton']>();
    instance.traverse((object) => { if (object instanceof SkinnedMesh) skeletons.add(object.skeleton); });
    skeletons.forEach((skeleton) => skeleton.dispose());
  }, [instance]);
  return <group name={`${id}-model`} userData={{ assetId: id }} dispose={null}>{renderInstance ? renderInstance(instance, animations) : <primitive object={instance} />}</group>;
}

class ModelBoundary extends Component<{ id: AssetId; revision: number; fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) {
    loading.failed(this.props.id, error, this.props.revision, error instanceof AssetValidationError ? 'validation' : 'load');
    console.error(`[assets] ${this.props.id}: GLB 加载/校验失败，使用基础几何体回退。`, error);
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export function GeneratedAsset(props: AssetProps) {
  const fallback = props.fallback ?? <AssetFallback id={props.id} />;
  const revision = useAssetRevision(props.id);
  return <ModelBoundary key={`${props.id}-${getAsset(props.id).sha256}-${revision}`} id={props.id} revision={revision} fallback={fallback}>
    <Suspense fallback={<LoadingFallback id={props.id}>{fallback}</LoadingFallback>}><LoadedAsset {...props} /></Suspense>
  </ModelBoundary>;
}
