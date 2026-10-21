import { useLayoutEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Object3D } from 'three';
import type { Group, InstancedMesh } from 'three';
import { game } from '../runtime/store';
import { City } from './City';
import { ThemedMaterial } from './Environment';
import type { EnvironmentRole } from './Environment';

type Vec3 = [number, number, number];
interface Box { position: Vec3; scale: Vec3; rotationY?: number }

/** Each repeated material role is one draw call, independent of tile count. */
function Boxes({ items, color, role, unlit = false }: { items: readonly Box[]; color: string; role?: EnvironmentRole; unlit?: boolean }) {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const transform = new Object3D();
    items.forEach((item, index) => {
      transform.position.set(...item.position);
      transform.scale.set(...item.scale);
      transform.rotation.set(0, item.rotationY ?? 0, 0);
      transform.updateMatrix();
      mesh.current?.setMatrixAt(index, transform.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={mesh} args={[undefined, undefined, items.length]}>
    <boxGeometry />{role ? <ThemedMaterial role={role} unlit={unlit} /> : unlit ? <meshBasicMaterial color={color} /> : <meshStandardMaterial color={color} roughness={0.95} />}
  </instancedMesh>;
}

const seams: Box[] = [];
const arrows: Box[] = [];
const posts: Box[] = [];
const lamps: Box[] = [];
const supports: Box[] = [];
for (let i = 0; i < 15; i++) {
  const z = 14 - i * 14;
  seams.push({ position: [0, -0.014, z], scale: [9.1, 0.02, 0.045] });
  for (const x of [-2.8, 0, 2.8]) {
    arrows.push({ position: [x - 0.15, 0.005, z], scale: [0.055, 0.02, 0.5], rotationY: -0.6 });
    arrows.push({ position: [x + 0.15, 0.005, z], scale: [0.055, 0.02, 0.5], rotationY: 0.6 });
  }
  for (const x of [-5.2, 5.2]) {
    posts.push({ position: [x, 0.5, z], scale: [0.15, 1, 0.15] });
    lamps.push({ position: [x, 1.05, z], scale: [0.3, 0.08, 0.3] });
    supports.push({ position: [x, -2.5, z], scale: [0.28, 5, 0.5] });
  }
}

export function World() {
  const repeating = useRef<Group>(null);
  useFrame(() => {
    if (repeating.current) repeating.current.position.z = game.view.distance % 14;
  });
  return <>
    <mesh name="city-road" position={[0, -0.38, -86]} receiveShadow><boxGeometry args={[9.2, 0.7, 210]} /><ThemedMaterial role="surfaceColor" /></mesh>
    {[-1.4, 1.4].map((x) => <mesh key={x} position={[x, -0.017, -86]}><boxGeometry args={[0.045, 0.025, 210]} /><ThemedMaterial role="lineColor" unlit /></mesh>)}
    {[-4.65, 4.65].map((x) => <group key={x}>
      <mesh position={[x, -0.15, -86]}><boxGeometry args={[0.16, 0.7, 210]} /><meshStandardMaterial color="#a0b8b4" /></mesh>
      <mesh position={[x, 0.21, -86]}><boxGeometry args={[0.08, 0.045, 210]} /><ThemedMaterial role="edgeColor" unlit /></mesh>
    </group>)}
    <group ref={repeating}>
      <Boxes items={seams} color="#526575" unlit />
      <Boxes items={arrows} color="#6b808a" role="markerColor" unlit />
      <Boxes items={posts} color="#7b939b" />
      <Boxes items={lamps} color="#ffcc87" unlit />
      <Boxes items={supports} color="#2a3f50" />
    </group>
    {[-19.2, 19.2].map((x) => <mesh key={x} position={[x, -0.125, -86]} receiveShadow>
      <boxGeometry args={[28.5, 0.25, 210]} /><ThemedMaterial role="sidewalkColor" />
    </mesh>)}
    <City />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -7, -70]}><planeGeometry args={[500, 500]} /><meshStandardMaterial color="#192e40" /></mesh>
  </>;
}
