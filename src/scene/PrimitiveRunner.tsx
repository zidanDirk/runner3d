import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { game } from '../runtime/store';
import type { Group } from 'three';

/** The original character, retained as a visible, playable loading/error fallback. */
export function PrimitiveRunner() {
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  useFrame(() => {
    const s = game.view;
    const p = s.player;
    const stride = s.status === 'running' && p.y === 0 && p.slideRemaining === 0 ? Math.sin(s.distance * 1.5) * 0.55 : 0;
    if (leftLeg.current) leftLeg.current.rotation.x = stride;
    if (rightLeg.current) rightLeg.current.rotation.x = -stride;
    if (leftArm.current) leftArm.current.rotation.x = -stride * 0.8;
    if (rightArm.current) rightArm.current.rotation.x = stride * 0.8;
  });
  return <group name="city-runner-fallback">
        <mesh position={[0, 1.08, 0]} castShadow>
          <boxGeometry args={[0.68, 0.7, 0.44]} /><meshStandardMaterial color="#fc7644" roughness={0.65} />
        </mesh>
        <mesh position={[0, 1.59, -0.02]} castShadow>
          <boxGeometry args={[0.55, 0.43, 0.48]} /><meshStandardMaterial color="#f9e9d4" roughness={0.75} />
        </mesh>
        <mesh position={[0, 1.67, 0.23]}>
          <boxGeometry args={[0.39, 0.14, 0.025]} /><meshStandardMaterial color="#25384a" />
        </mesh>
        <mesh position={[0, 1.14, 0.26]}>
          <boxGeometry args={[0.38, 0.31, 0.13]} /><meshStandardMaterial color="#213244" />
        </mesh>
        <mesh position={[0, 1.18, 0.34]}>
          <boxGeometry args={[0.07, 0.17, 0.015]} /><meshBasicMaterial color="#f4d476" />
        </mesh>
        {([-1, 1] as const).map((side) => <group key={side} ref={side < 0 ? leftLeg : rightLeg} position={[side * 0.2, 0.73, 0]}>
          <mesh position={[0, -0.29, 0]} castShadow><boxGeometry args={[0.25, 0.58, 0.3]} /><meshStandardMaterial color="#d8dedb" /></mesh>
          <mesh position={[0, -0.64, -0.06]} castShadow><boxGeometry args={[0.29, 0.16, 0.43]} /><meshStandardMaterial color="#fc7644" /></mesh>
        </group>)}
        {([-1, 1] as const).map((side) => <group key={side} ref={side < 0 ? leftArm : rightArm} position={[side * 0.46, 1.3, 0]}>
          <mesh position={[0, -0.22, 0]} castShadow><boxGeometry args={[0.2, 0.55, 0.23]} /><meshStandardMaterial color="#fc7644" /></mesh>
          <mesh position={[0, -0.5, 0]}><boxGeometry args={[0.19, 0.16, 0.21]} /><meshStandardMaterial color="#f5e3cc" /></mesh>
        </group>)}
  </group>;
}
