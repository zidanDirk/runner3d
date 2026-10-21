import { memo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RULES, SHAPES, laneX } from '../game/config';
import type { DeepReadonly, Entity } from '../game/types';
import { game, useGame } from '../runtime/store';
import type { Group } from 'three';
import { Roadblock } from '../assets/generated/Roadblock';

const Hazard = memo(function Hazard({ entity }: { entity: DeepReadonly<Entity> }) {
  const root = useRef<Group>(null);
  const token = useRef<Group>(null);
  useFrame(() => {
    if (!root.current) return;
    root.current.position.set(laneX(entity.lane), 0, game.view.distance - entity.distance);
    root.current.visible = !entity.collected && !entity.shieldCleared && entity.distance - game.view.distance < RULES.lookAhead;
    if (token.current) token.current.rotation.y = game.view.tick / 90;
  });
  const shape = SHAPES[entity.kind];

  return <group ref={root} position={[laneX(entity.lane), 0, -entity.distance]}>
    {entity.kind === 'coin' ? <group ref={token} position={[0, 1.075, 0]}>
      <mesh rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.32, 0.32, 0.105, 12]} /><meshStandardMaterial color="#ffd36b" metalness={0.55} roughness={0.25} emissive="#b66b16" emissiveIntensity={0.25} /></mesh>
      <mesh position={[0, 0, 0.058]}><boxGeometry args={[0.055, 0.33, 0.02]} /><meshBasicMaterial color="#fff0b3" /></mesh>
    </group> : <>
      <mesh position={[0, 0.015, 1.3]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[2.15, 0.09]} /><meshBasicMaterial color={entity.kind === 'gate' ? '#81d2bd' : '#ef986c'} /></mesh>
      {entity.kind === 'hurdle' ? <Roadblock /> : <>
      <mesh position={[0, shape.bottom + shape.height / 2, 0]} castShadow>
        <boxGeometry args={[shape.width, shape.height, shape.depth]} />
        <meshStandardMaterial color={entity.kind === 'gate' ? '#70b7ad' : '#485c6c'} roughness={0.7} />
      </mesh>
      {entity.kind === 'gate' && ([-1, 1] as const).map((side) => <mesh key={side} position={[side * 1.025, 0.525, 0]}><boxGeometry args={[0.14, 1.05, 0.8]} /><meshStandardMaterial color="#70b7ad" /></mesh>)}
      <mesh position={[0, shape.bottom + shape.height * 0.6, shape.depth / 2 + 0.012]}>
        <boxGeometry args={[shape.width * 0.8, entity.kind === 'block' ? 0.15 : 0.1, 0.025]} /><meshBasicMaterial color={entity.kind === 'gate' ? '#c9f1dc' : '#ffe4ad'} />
      </mesh>
      {entity.kind === 'block' && [-0.52, 0.52].map((x) => <mesh key={x} position={[x, 1.5, shape.depth / 2 + 0.025]} rotation={[0, 0, -0.28]}><boxGeometry args={[0.21, 2.4, 0.025]} /><meshStandardMaterial color="#c6b48a" /></mesh>)}
      </>}
    </>}
  </group>;
});

export function Obstacles() {
  useGame();
  return <group>{game.view.entities.map((entity) => <Hazard key={entity.id} entity={entity} />)}</group>;
}
