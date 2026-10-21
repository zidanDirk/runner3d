import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { addAfterEffect, useFrame } from '@react-three/fiber';
import { Color, DynamicDrawUsage, Object3D } from 'three';
import type { InstancedMesh, Mesh, MeshBasicMaterial } from 'three';
import type { EffectManager } from '../effects/EffectManager';
import { feedback } from '../runtime/feedback';
import { feedbackDOM } from '../runtime/feedback-dom';
import { motionPreferences } from '../runtime/motion-preferences';
import { game } from '../runtime/store';
import { debugEffectsEnabled, publishEffectsMetrics } from '../runtime/effects-metrics';

/** One pooled batch and one impact outline; no particle React components. */
export function FeedbackEffects({ manager = feedback.effects, preview = false }: { manager?: EffectManager; preview?: boolean }) {
  const batch = useRef<InstancedMesh>(null);
  const ring = useRef<Mesh>(null);
  const scratch = useMemo(() => ({ transform: new Object3D(), color: new Color() }), []);
  useLayoutEffect(() => {
    if (!batch.current) return;
    batch.current.count = 0;
    batch.current.setColorAt(0, scratch.color.setRGB(1, 1, 1));
    batch.current.instanceMatrix.setUsage(DynamicDrawUsage);
  }, [scratch]);
  useEffect(() => {
    if (batch.current) batch.current.instanceMatrix.setUsage(DynamicDrawUsage);
    if (preview) return;
    return addAfterEffect(() => {
      if (import.meta.env.MODE === 'e2e') window.__FEEDBACK__ = feedback.diagnostics();
      if (debugEffectsEnabled) publishEffectsMetrics(feedback.diagnostics());
    });
  }, [preview]);
  useFrame(() => {
    const mesh = batch.current;
    if (!mesh) return;
    const particles = manager.particles;
    let count = 0;
    for (let i = 0; i < particles.capacity; i++) {
      if (!particles.alive[i]) continue;
      const x = particles.x[i] ?? 0; const y = particles.y[i] ?? 0; const z = particles.z[i] ?? 0;
      const size = particles.size[i] ?? 0;
      scratch.transform.position.set(x, y, z);
      scratch.transform.scale.set(size, size, size * (particles.stretch[i] ?? 1));
      scratch.transform.rotation.set(0, .4, .35); scratch.transform.updateMatrix();
      mesh.setMatrixAt(count, scratch.transform.matrix);
      scratch.color.setRGB(particles.r[i] ?? 0, particles.g[i] ?? 0, particles.b[i] ?? 0);
      mesh.setColorAt(count, scratch.color); count++;
    }
    mesh.count = count; mesh.visible = count > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (ring.current) {
      ring.current.visible = manager.hitPulse > .001;
      ring.current.position.set(preview ? 0 : game.view.player.x, .8 + (preview ? 0 : game.view.player.y), .25);
      const size = 1 + (1 - manager.hitPulse) * .25; ring.current.scale.setScalar(size);
      (ring.current.material as MeshBasicMaterial).opacity = manager.hitPulse * .4;
    }
    if (!preview) {
      const reduced = motionPreferences.getSnapshot();
      if (feedbackDOM.coins) {
        feedbackDOM.coins.style.transform = `scale(${1 + manager.coinPulse * (reduced ? .025 : .12)})`;
        feedbackDOM.coins.style.filter = manager.coinPulse > .05 ? 'brightness(1.18)' : '';
      }
      if (feedbackDOM.impact) feedbackDOM.impact.style.opacity = String(manager.hitPulse * .65);
      if (feedbackDOM.speed) feedbackDOM.speed.style.opacity = String(manager.speedNotice);
    }
  }, -1);
  return <group name="feedback-effects">
    <instancedMesh ref={batch} args={[undefined, undefined, manager.particles.capacity]} frustumCulled={false}>
      <boxGeometry /><meshBasicMaterial toneMapped={false} />
    </instancedMesh>
    <mesh ref={ring} visible={false} frustumCulled={false}>
      <torusGeometry args={[.62, .012, 3, 32]} /><meshBasicMaterial color="#ef997c" transparent opacity={0} depthWrite={false} toneMapped={false} />
    </mesh>
  </group>;
}
