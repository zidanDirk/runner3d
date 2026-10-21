import { memo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, Mesh } from 'three';
import { GeneratedAsset } from '../assets/GeneratedAsset';
import { game, useGame } from '../runtime/store';
import { laneX } from '../game/config';
import { POWERUP_BALANCE } from '../game/balance';
import type { PowerUpType } from '../game/balance';
import type { DeepReadonly } from '../game/types';
import type { PowerUpPickup } from '../game/powerups';
import { motionPreferences } from '../runtime/motion-preferences';

const ids = { magnet: 'powerup-magnet', shield: 'powerup-shield', 'double-score': 'powerup-double-score' } as const;
export const POWERUP_COLORS: Record<PowerUpType, string> = { magnet: '#ffb44e', shield: '#64e8f1', 'double-score': '#d7a1ff' };
const Pickup = memo(function Pickup({ pickup }: { pickup: DeepReadonly<PowerUpPickup> }) {
  const root = useRef<Group>(null), icon = useRef<Group>(null);
  useFrame(() => {
    const view = game.view;
    if (root.current) { root.current.position.set(laneX(pickup.lane), POWERUP_BALANCE.pickupBottom, view.distance - pickup.distance); root.current.visible = !pickup.collected; }
    if (icon.current) {
      const time = view.tick / 120, reduced = motionPreferences.getSnapshot();
      icon.current.rotation.y = reduced ? 0 : Math.sin(time * .9) * .4;
      icon.current.position.y = reduced ? 0 : Math.sin(time * 2) * .06;
    }
  });
  return <group name={`pickup-${pickup.type}`} ref={root} position={[laneX(pickup.lane), POWERUP_BALANCE.pickupBottom, -pickup.distance]}>
    <group ref={icon}><GeneratedAsset id={ids[pickup.type]} castShadow={false} fallback={<mesh position={[0, .425, 0]}><octahedronGeometry args={[.42, 0]} /><meshStandardMaterial color={POWERUP_COLORS[pickup.type]} /></mesh>} /></group>
  </group>;
});
export function PowerUps() {
  useGame();
  return <group name="powerup-pickups" userData={{ powerupVisual: true }}>{game.view.pickups.map(pickup => <Pickup key={pickup.id} pickup={pickup} />)}</group>;
}
/** Two shared-material visual shells, no lights or collision dimensions. */
export function ActivePowerUpVisuals() {
  const shield = useRef<Mesh>(null), magnet = useRef<Mesh>(null);
  useFrame(() => {
    const view = game.view;
    if (shield.current) { shield.current.visible = view.powerups.shield > 0 && view.status !== 'over'; shield.current.position.set(view.player.x, view.player.y + .9, 0); }
    if (magnet.current) { magnet.current.visible = view.powerups.magnet > 0 && view.status !== 'over'; magnet.current.position.x = view.player.x; }
  });
  return <group name="powerup-active-visuals" userData={{ powerupVisual: true }}>
    <mesh ref={shield} name="active-shield" visible={false}><icosahedronGeometry args={[1.15, 1]} /><meshBasicMaterial color="#6ce9ee" wireframe transparent opacity={.32} depthWrite={false} /></mesh>
    <mesh ref={magnet} name="active-magnet" visible={false} rotation={[-Math.PI / 2, 0, 0]} position={[0, .025, 0]}><ringGeometry args={[.8, .86, 24]} /><meshBasicMaterial color="#ffc16c" transparent opacity={.8} depthWrite={false} /></mesh>
  </group>;
}
