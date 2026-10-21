import { useEffect, useLayoutEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { DirectionalLight, PointLight, SpotLight } from 'three';
import { quality, useQuality } from '../runtime/quality';
import { game } from '../runtime/store';

type ShadowLight = DirectionalLight | PointLight | SpotLight;
interface OriginalShadow { castShadow: boolean; width: number; height: number }

function discardShadowMap(light: ShadowLight): void {
  light.shadow.map?.dispose(); light.shadow.map = null;
  light.shadow.mapPass?.dispose(); light.shadow.mapPass = null;
}

/** Adapts one existing renderer; never remounts Canvas or changes simulation. */
export function QualityController({ active = true }: { active?: boolean }) {
  const { gl, scene, size, setDpr } = useThree();
  const { profile, deviceDpr } = useQuality();
  const originals = useRef(new Map<ShadowLight, OriginalShadow>());
  const originalRenderer = useRef({ enabled: gl.shadowMap.enabled, dpr: gl.getPixelRatio() });
  const contextLost = useRef(false);
  const previousTick = useRef(game.view.tick);
  const previousEpoch = useRef(game.frameEpoch);
  const stagnantMs = useRef(0);

  useLayoutEffect(() => {
    const pointer = window.matchMedia('(pointer: coarse)');
    const update = (): void => quality.setEnvironment(size.width, size.height, window.devicePixelRatio, pointer.matches);
    update(); pointer.addEventListener('change', update); window.addEventListener('resize', update);
    return () => { pointer.removeEventListener('change', update); window.removeEventListener('resize', update); };
  }, [size.width, size.height]);

  useLayoutEffect(() => {
    setDpr(Math.min(deviceDpr, profile.dprCap));
    const changed = gl.shadowMap.enabled !== profile.shadows;
    gl.shadowMap.enabled = profile.shadows;
    scene.traverse((object) => {
      if (!(object instanceof DirectionalLight || object instanceof SpotLight || object instanceof PointLight)) return;
      if (!originals.current.has(object)) originals.current.set(object, { castShadow: object.castShadow, width: object.shadow.mapSize.x, height: object.shadow.mapSize.y });
      const original = originals.current.get(object);
      if (!original?.castShadow) return;
      const resize = profile.shadows && (object.shadow.mapSize.x !== profile.shadowMapSize || object.shadow.mapSize.y !== profile.shadowMapSize);
      if (resize || !profile.shadows) discardShadowMap(object);
      object.castShadow = profile.shadows;
      if (profile.shadows) object.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
      if (resize || changed) object.shadow.needsUpdate = true;
    });
    if (changed) gl.shadowMap.needsUpdate = true;
  }, [profile, deviceDpr, gl, scene, setDpr]);

  useEffect(() => {
    const original = originalRenderer.current;
    const remembered = originals.current;
    const lost = (): void => { contextLost.current = true; quality.resetSampling(); };
    const restored = (): void => { contextLost.current = false; quality.resetSampling(); };
    const visibility = (): void => quality.resetSampling();
    gl.domElement.addEventListener('webglcontextlost', lost);
    gl.domElement.addEventListener('webglcontextrestored', restored);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      gl.domElement.removeEventListener('webglcontextlost', lost);
      gl.domElement.removeEventListener('webglcontextrestored', restored);
      document.removeEventListener('visibilitychange', visibility);
      for (const [light, value] of remembered) {
        if (light.shadow.mapSize.x !== value.width || light.shadow.mapSize.y !== value.height) discardShadowMap(light);
        light.castShadow = value.castShadow; light.shadow.mapSize.set(value.width, value.height);
      }
      remembered.clear(); gl.shadowMap.enabled = original.enabled; gl.shadowMap.needsUpdate = true;
      setDpr(original.dpr); quality.resetSampling();
    };
  }, [gl, setDpr]);

  useFrame((_, delta) => {
    const tick = game.view.tick; const epoch = game.frameEpoch;
    // Rendering may run faster than the 120Hz simulation. A tick need not advance
    // on every rendered frame; sustained capture freezes still stop sampling.
    stagnantMs.current = tick > previousTick.current ? 0 : stagnantMs.current + delta * 1000;
    const sampling = active && !contextLost.current && !gl.getContext().isContextLost() &&
      document.visibilityState === 'visible' && game.view.status === 'running' &&
      stagnantMs.current < 50 && epoch === previousEpoch.current;
    quality.sampleFrame(delta * 1000, sampling);
    previousTick.current = tick; previousEpoch.current = epoch;
  });
  return null;
}
