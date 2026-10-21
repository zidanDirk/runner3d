import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RULES } from '../game/config';
import { game } from '../runtime/store';
import { GeneratedAsset, useAssetStatus } from '../assets/GeneratedAsset';
import { PrimitiveRunner } from './PrimitiveRunner';
import type { Group, Mesh } from 'three';
import { AnimatedCharacter } from '../character/AnimatedCharacter';
import { CharacterMotionFeedback } from '../character/CharacterMotionFeedback';
import { motionPreferences } from '../runtime/motion-preferences';
import { useProductPreferences } from '../runtime/product-preferences';
import { CharacterAppearance } from '../character/CharacterAppearance';

/** Visual adaptation only. Physics still uses RULES, never the GLB bounds. */
export function Runner() {
  const { skinId } = useProductPreferences();
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const impact = useRef<Group>(null);
  const feedback = useRef<CharacterMotionFeedback | null>(null);
  if (!feedback.current) feedback.current = new CharacterMotionFeedback();
  const shadow = useRef<Mesh>(null);
  const loaded = useAssetStatus('city-runner') === 'loaded';
  useFrame(() => {
    const p = game.view.player;
    if (!root.current || !body.current || !impact.current || !feedback.current) return;
    feedback.current.update(game.view, motionPreferences.getSnapshot());
    root.current.position.set(p.x, p.y, 0);
    body.current.rotation.z = feedback.current.lean;
    body.current.position.y = !loaded ? .345 * Math.abs(Math.sin(feedback.current.lean)) : 0;
    const scaleY = feedback.current.scaleY;
    impact.current.scale.set(1 / Math.sqrt(scaleY), scaleY, 1 / Math.sqrt(scaleY));
    if (import.meta.env.DEV) impact.current.userData.motionFeedback = feedback.current;
    body.current.scale.y = !loaded && p.slideRemaining > 0 ? RULES.slidingHeight / RULES.standingHeight : 1;
    if (shadow.current) {
      shadow.current.position.x = p.x;
      shadow.current.scale.setScalar(1 - Math.min(p.y, 3) * 0.12);
    }
  }, -3);
  return <>
    <mesh ref={shadow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
      <circleGeometry args={[0.64, 24]} /><meshBasicMaterial color="#06101c" transparent opacity={0.55} depthWrite={false} />
    </mesh>
    <group ref={root} name="runner-root"><group ref={impact} name="runner-motion-feedback"><group ref={body} name="runner-visual-lean">
      <GeneratedAsset id="city-runner" fallback={<PrimitiveRunner />} renderInstance={(instance, clips) => <CharacterAppearance instance={instance} skinId={skinId}><AnimatedCharacter instance={instance} clips={clips} banking={body} /></CharacterAppearance>} />
    </group></group></group>
  </>;
}

export function RunnerAssetStatus() {
  const status = useAssetStatus('city-runner');
  return status === 'error' ? <div className="runner-asset-error" role="status" aria-label="角色资源状态">City Runner 模型加载失败，正在使用基础角色。移动与碰撞仍可正常运行。</div> : null;
}
