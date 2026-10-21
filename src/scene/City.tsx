import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei/core/Gltf.js';
import { Matrix4, Object3D } from 'three';
import type { BufferGeometry, Group, InstancedMesh, Material } from 'three';
import { assetUrl, getAsset } from '../assets/catalog';
import { getCityPrimitives } from '../assets/city-primitives';
import { getAssetTheme } from '../assets/theme';
import { cityAssetIds } from '../assets/city-loading';
import type { CityAssetId, CityDecoration, CitySnapshot } from '../city/types';
import { CITY_ASSET_DIMENSIONS, cityFootprint, getCityLimits } from '../city/generator';
import { useCity } from '../runtime/city';
import { game } from '../runtime/store';
import { useQuality } from '../runtime/quality';
import { keepOptionalDecoration } from '../quality/profiles';
import { ThemedMaterial } from './Environment';
import { useAssetRevision } from '../assets/loading';
import { CityInstanceWriter, releaseDetachedInstance } from './CityInstanceWriter';
import type { CityInstance } from './CityInstanceWriter';

const ids = cityAssetIds;
// Bounded by validated configuration, independent of distance and placement density.
const limits = getCityLimits();
const capacity = Math.max(limits.buildings, limits.lamps, limits.props, 1);
type Instance = CityInstance;

function Batch({ id, items, geometry, material, localMatrix, fallback = false }: {
  id: CityAssetId; items: readonly Instance[]; geometry?: BufferGeometry; material?: Material;
  localMatrix?: Matrix4; fallback?: boolean;
}) {
  const ref = useRef<InstancedMesh>(null);
  const dimensions = CITY_ASSET_DIMENSIONS[id];
  const activeTheme = getAssetTheme(id);
  const writer = useRef<CityInstanceWriter | null>(null);
  if (!writer.current) writer.current = new CityInstanceWriter();
  useEffect(() => {
    const mesh = ref.current;
    // Instanced buffers belong to this batch; GLB geometry/material belong to the loader cache.
    return () => { if (mesh) releaseDetachedInstance(mesh); };
  }, [geometry, material]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    writer.current?.sync(mesh, items, localMatrix, fallback ? dimensions[1] : 0);
  }, [items, localMatrix, dimensions, fallback, geometry, material]);
  useFrame(() => { if (ref.current) writer.current?.sync(ref.current, items, localMatrix, fallback ? dimensions[1] : 0); }, -1);
  return <instancedMesh ref={ref} name={`city-${id}-${fallback ? 'fallback' : 'primitive'}`}
    args={[geometry, material, capacity]} count={0} dispose={geometry ? null : undefined}
    userData={{ cityAsset: id, fallback, instanceCount: items.length }} castShadow={false} receiveShadow={false}>
    {fallback && <>
      <boxGeometry args={[dimensions[0], dimensions[1], dimensions[2]]} />
      <meshStandardMaterial color={id === 'street-lamp' ? activeTheme.materials.metal.color : activeTheme.materials.building.color} roughness={0.95} />
    </>}
  </instancedMesh>;
}

function Models({ id, items }: { id: CityAssetId; items: readonly Instance[] }) {
  const { scene } = useGLTF(assetUrl(id), false, false);
  const primitives = useMemo(() => getCityPrimitives(scene, getAsset(id).dimensions), [scene, id]);
  return <>{primitives.map((primitive) => <Batch key={primitive.key} id={id} items={items}
    geometry={primitive.geometry} material={primitive.material} localMatrix={primitive.matrix} />)}</>;
}

class CityAssetBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function CityAsset({ id, items }: { id: CityAssetId; items: readonly Instance[] }) {
  const revision = useAssetRevision(id);
  const fallback = <Batch id={id} items={items} fallback />;
  return <CityAssetBoundary key={`${id}-${revision}`} fallback={fallback}><Suspense fallback={fallback}><Models id={id} items={items} /></Suspense></CityAssetBoundary>;
}

function Decorations({ snapshot, density }: { snapshot: CitySnapshot; density: number }) {
  const base = useRef<InstancedMesh>(null);
  const green = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const transform = new Object3D();
    let index = 0;
    const place = (item: CityDecoration, chunkStart: number, part: 'base' | 'green') => {
      const y = part === 'base' ? 0.28 : 0.75;
      transform.position.set(item.position[0], item.scale[1] * y, item.position[2] - chunkStart + snapshot.anchorDistance);
      transform.rotation.set(0, item.rotationY, 0);
      transform.scale.set(item.scale[0] * (part === 'base' ? 1 : 0.8), item.scale[1] * (part === 'base' ? 0.56 : 0.4), item.scale[2] * (part === 'base' ? 1 : 0.8));
      transform.updateMatrix();
      (part === 'base' ? base : green).current?.setMatrixAt(index, transform.matrix);
    };
    for (const chunk of snapshot.chunks) for (const item of chunk.decorations) {
      if (!keepOptionalDecoration(item.id, density)) continue;
      place(item, chunk.startDistance, 'base'); place(item, chunk.startDistance, 'green'); index++;
    }
    for (const ref of [base, green]) if (ref.current) {
      ref.current.count = index;
      ref.current.instanceMatrix.needsUpdate = true;
      ref.current.computeBoundingBox(); ref.current.computeBoundingSphere();
    }
  }, [snapshot, density]);
  return <>
    <instancedMesh ref={base} args={[undefined, undefined, Math.max(limits.decorations, 1)]}><boxGeometry /><ThemedMaterial role="planterColor" /></instancedMesh>
    <instancedMesh ref={green} args={[undefined, undefined, Math.max(limits.decorations, 1)]}><boxGeometry /><meshStandardMaterial color="#496358" roughness={1} /></instancedMesh>
  </>;
}

export function City() {
  const snapshot = useCity();
  const density = useQuality().profile.decorationDensity;
  const root = useRef<Group>(null);
  // Bounded by the theme registry. An unused theme must not mount useGLTF just
  // to submit an empty batch; once needed, keep its cached batches through reset
  // and theme changes, with count=0 when absent from the current city window.
  const seenIds = useRef(new Set<CityAssetId>());
  const instances = useMemo(() => {
    const result = new Map<CityAssetId, Instance[]>(ids.map((id) => [id, []]));
    let culled = 0;
    for (const chunk of snapshot.chunks) {
      const offset = chunk.startDistance - snapshot.anchorDistance;
      // All logical chunks, buildings and street lamps remain intact at every
      // quality. Only optional billboard props and planters are thinned.
      for (const placement of [...chunk.buildings, ...chunk.lamps, ...chunk.props.filter((item) => keepOptionalDecoration(item.id, density))]) {
        // Entire footprint is behind even the portrait camera (Z18, tilted down).
        // It moves farther behind throughout this chunk, so skipping it cannot pop into view.
        const forwardEdge = chunk.startDistance - placement.position[2] + cityFootprint(placement)[1] / 2;
        if (forwardEdge < snapshot.anchorDistance - 22) { culled++; continue; }
        const batch = result.get(placement.assetId);
        if (!batch) throw new Error(`City asset ${placement.assetId} is absent from theme registry`);
        batch.push({ placement, offset });
      }
    }
    return { batches: result, culled };
  }, [snapshot, density]);
  for (const id of ids) if ((instances.batches.get(id)?.length ?? 0) > 0) seenIds.current.add(id);
  // Registry order retains the original high-quality visible drawing order.
  const mountedIds = ids.filter((id) => seenIds.current.has(id));
  useFrame(() => {
    if (root.current) root.current.position.z = game.view.distance - snapshot.anchorDistance;
  });
  return <group ref={root} name="procedural-city" userData={{ revision: snapshot.revision, culledInstances: instances.culled, mountedAssetIds: mountedIds }} position={[0, 0, game.view.distance - snapshot.anchorDistance]}>
    <Decorations snapshot={snapshot} density={density} />
    {mountedIds.map((id) => <CityAsset key={id} id={id} items={instances.batches.get(id) ?? []} />)}
  </group>;
}
