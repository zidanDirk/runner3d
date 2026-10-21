import { useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { SkeletonHelper } from 'three';
import type { AnimationClip, Group, Object3D } from 'three';
import { game } from '../runtime/store';
import { debugCityEnabled } from '../runtime/city-metrics';
import { CharacterAnimationController } from './CharacterAnimationController';
import type { AnimationState } from './animationConfig';
import { debugMotionEnabled } from '../runtime/motion-metrics';
import { SoleBanking } from './SoleBanking';

export interface PreviewPlayback {
  state: AnimationState; seconds: number; playing: boolean; speed: number; revision: number; showSkeleton: boolean;
}

/** The cloned skeleton owns its mixer. Geometry/materials remain loader-cache resources. */
export function AnimatedCharacter({ instance, clips, preview, banking }: { instance: Object3D; clips: readonly AnimationClip[]; preview?: PreviewPlayback; banking?: RefObject<Group | null> }) {
  const group = useRef<Group>(null);
  const controller = useRef<CharacterAnimationController | null>(null);
  const soles = useRef<SoleBanking | null>(null);
  useLayoutEffect(() => {
    const animation = new CharacterAnimationController(instance, clips, import.meta.env.MODE === 'e2e' || debugCityEnabled || debugMotionEnabled);
    controller.current = animation;
    if (banking) soles.current = new SoleBanking(instance);
    const object = group.current;
    if (object) {
      object.userData.animationController = animation;
      if (import.meta.env.DEV && soles.current) object.userData.bankingSamples = soles.current.sampleCount;
    }
    return () => {
      animation.dispose();
      if (object) { delete object.userData.animationController; delete object.userData.bankingSamples; }
      controller.current = null;
      soles.current = null;
    };
  }, [instance, clips, banking]);
  useLayoutEffect(() => {
    if (import.meta.env.DEV && preview) controller.current?.samplePreview(preview.state, preview.seconds);
  }, [instance, clips, preview?.state, preview?.seconds, preview?.revision]);
  useLayoutEffect(() => {
    if (!import.meta.env.DEV || !preview?.showSkeleton || !group.current) return;
    const object = group.current;
    const helper = new SkeletonHelper(instance);
    helper.name = 'character-skeleton-helper';
    for (const material of Array.isArray(helper.material) ? helper.material : [helper.material]) material.depthTest = false;
    helper.renderOrder = 100;
    object.add(helper);
    return () => { object.remove(helper); helper.dispose(); };
  }, [instance, preview?.showSkeleton]);
  useFrame((_, delta) => {
    if (import.meta.env.DEV && preview) controller.current?.playPreview(preview.state, delta, preview.speed, preview.playing);
    else controller.current?.updateGame(game.view, delta);
    if (banking?.current && soles.current) banking.current.position.y = game.view.player.y > 0 ? 0 : soles.current.liftForRoll(banking.current.rotation.z, controller.current?.blending);
  }, -2);
  return <group ref={group} name="animated-character" dispose={null}><primitive object={instance} /></group>;
}
