import { Component, lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { addAfterEffect, Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei/core/PerspectiveCamera.js';
import { ACESFilmicToneMapping, Bone, Box3, Fog, Frustum, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, SkinnedMesh, Vector3 } from 'three';
import { World } from './World';
import { Runner, RunnerAssetStatus } from './Runner';
import { PowerUps, ActivePowerUpVisuals } from './PowerUps';
import { Obstacles } from './Obstacles';
import { game } from '../runtime/store';
import { Environment } from './Environment';
import { CityDiagnostics } from './CityDiagnostics';
import { debugCityEnabled } from '../runtime/city-metrics';
import { CityDebug } from '../ui/CityDebug';
import { CharacterAnimationController } from '../character/CharacterAnimationController';
import type { AnimationDiagnostics } from '../character/CharacterAnimationController';
import { CameraMotionController } from './CameraMotionController';
import { motionPreferences } from '../runtime/motion-preferences';
import { debugMotionEnabled, publishMotionMetrics } from '../runtime/motion-metrics';
import { CharacterMotionFeedback } from '../character/CharacterMotionFeedback';
import { jumpProgress, slideProgress } from '../character/animationState';
import { FeedbackEffects } from './FeedbackEffects';
import { debugEffectsEnabled } from '../runtime/effects-metrics';
import { AssetWarmup } from '../assets/AssetWarmup';
import { loading } from '../assets/loading';
import { input } from '../runtime/input';
import { feedback } from '../runtime/feedback';
import { QualityController } from './QualityController';
import { quality, useQuality } from '../runtime/quality';
import { cameraLayout } from './cameraLayout';
import { debugMobileEnabled } from '../runtime/mobile-metrics';
import { graphics } from '../runtime/graphics';

const MotionDebug = import.meta.env.DEV ? lazy(() => import('../ui/MotionDebug').then((module) => ({ default: module.MotionDebug }))) : () => null;
const EffectsDebug = import.meta.env.DEV ? lazy(() => import('../ui/EffectsDebug').then((module) => ({ default: module.EffectsDebug }))) : () => null;
const MobileDiagnostics = import.meta.env.DEV ? lazy(() => import('./MobileDiagnostics').then((module) => ({ default: module.MobileDiagnostics }))) : () => null;
const MobileDebug = import.meta.env.DEV ? lazy(() => import('../ui/MobileDebug').then((module) => ({ default: module.MobileDebug }))) : () => null;

function CameraRig() {
  const { camera, size } = useThree();
  const layout = cameraLayout(size.width, size.height);
  const response = useRef<CameraMotionController | null>(null);
  if (!response.current) response.current = new CameraMotionController();
  useFrame(() => {
    const motion = response.current;
    if (!motion) return;
    motion.update(game.view, layout, motionPreferences.getSnapshot());
    camera.position.set(motion.x, motion.y, motion.z);
    if ('fov' in camera && typeof camera.fov === 'number' && Math.abs(camera.fov - motion.fov) > .00001) { camera.fov = motion.fov; camera.updateProjectionMatrix(); }
    camera.lookAt(0, layout.targetY, layout.targetZ);
  });
  return null;
}

function Diagnostics() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    if (import.meta.env.MODE !== 'e2e' && !debugMotionEnabled) return;
    if (import.meta.env.MODE === 'e2e') window.__RUNNER_INSPECT__ = () => {
      const batches: { id: string; count: number; declared: number; uuid: string; version: number; matrix: number[]; items: number[][] }[] = [];
      scene.traverse((object) => { if (object instanceof InstancedMesh && object.userData.cityAsset) {
        const matrix = new Matrix4(); const items: number[][] = [];
        for (let i = 0; i < object.count; i++) { object.getMatrixAt(i, matrix); items.push(matrix.elements.slice()); }
        batches.push({ id: String(object.userData.cityAsset), count: object.count, declared: Number(object.userData.instanceCount), uuid: object.uuid, version: object.instanceMatrix.version, matrix: object.matrixWorld.elements.slice(), items });
      } });
      return { camera: { position: camera.position.toArray(), world: camera.matrixWorld.elements.slice(), inverse: camera.matrixWorldInverse.elements.slice(), projection: camera.projectionMatrix.elements.slice() }, fog: scene.fog instanceof Fog ? { near: scene.fog.near, far: scene.fog.far } : null, batches };
    };
    let nextSample = 0;
    let nextPublish = 0;
    const stop = addAfterEffect(() => {
      if (import.meta.env.MODE !== 'e2e' && performance.now() < nextSample) return;
      nextSample = performance.now() + 250;
      const powers = { models: 0, visible: 0, triangles: 0, types: [] as string[], pickups: game.view.pickups.filter(p => !p.collected).length };
      let models = 0;
      let fallbacks = 0;
      let visible = 0;
      let bounds: { size: number[]; minY: number; materials: string[] } | null = null;
      const character = { appearance: { skinId: '', jacketColors: [] as string[] }, models: 0, fallbacks: 0, visible: 0, meshes: 0, triangles: 0, materials: [] as string[], bounds: null as { size: number[]; minY: number } | null, position: [0, 0, 0], scale: [1, 1, 1], jointMetadata: false, skinnedMeshes: 0, skinCount: 0, bones: {} as Record<string, number[]>, animation: null as AnimationDiagnostics | null, lean: 0, bankLift: 0, bankSamples: 0, impact: { landing: 0, scaleY: 1 }, soles: null as { left: number; right: number } | null };
      scene.updateMatrixWorld();
      camera.updateMatrixWorld();
      const frustum = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      scene.traverse((object) => {
        if (object instanceof Mesh) {
          let powerup = false, shown = object.visible;
          for (let p = object.parent; p; p = p.parent) { powerup ||= p.userData.powerupVisual === true; shown &&= p.visible; }
          if (powerup && shown && (!object.frustumCulled || frustum.intersectsObject(object))) {
            const material = Array.isArray(object.material) ? object.material[0] : object.material;
            // WebGLRenderer reports wireframe as lines, never triangle submissions.
            if (material && !('wireframe' in material && material.wireframe)) powers.triangles += Math.min(object.geometry.drawRange.count, object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
          }
        }
        if (/^powerup-(magnet|shield|double-score)-model$/.test(object.name)) {
          powers.models++; powers.types.push(object.name);
          let shown = object.visible; for (let p = object.parent; p; p = p.parent) shown = shown && p.visible;
          if (shown && frustum.intersectsBox(new Box3().setFromObject(object))) powers.visible++;
        }
        if (object.name === 'city-runner-fallback') character.fallbacks++;
        if (object.name === 'runner-root') character.position = object.position.toArray();
        if (object.name === 'runner-visual-lean') { character.lean = object.rotation.z; character.bankLift = object.position.y; }
        if (object.name === 'runner-motion-feedback' && object.userData.motionFeedback instanceof CharacterMotionFeedback) character.impact = { landing: object.userData.motionFeedback.landing, scaleY: object.scale.y };
        if (object.name === 'city-runner-model') {
          character.models++;
          const box = new Box3().setFromObject(object, true);
          character.bounds = { size: box.getSize(new Vector3()).toArray(), minY: box.min.y };
          character.scale = object.getWorldScale(new Vector3()).toArray();
          let shown = object.visible;
          for (let parent = object.parent; parent; parent = parent.parent) shown = shown && parent.visible;
          if (shown && frustum.intersectsBox(box)) character.visible++;
          const names = new Set<string>();
          const skeletons = new Set<SkinnedMesh['skeleton']>();
          object.traverse((child) => {
            if (child.name === 'character-appearance' && typeof child.userData.skinId === 'string') character.appearance.skinId = child.userData.skinId;
            if (child.userData.animationController instanceof CharacterAnimationController) character.animation = child.userData.animationController.diagnostics();
            if (typeof child.userData.bankingSamples === 'number') character.bankSamples = child.userData.bankingSamples;
            if (child instanceof Bone) character.bones[child.name] = child.getWorldPosition(new Vector3()).toArray();
            if (child instanceof SkinnedMesh) { character.skinnedMeshes++; skeletons.add(child.skeleton); }
            if (child.userData.character) character.jointMetadata = true;
            if (!(child instanceof Mesh)) return;
            character.meshes++;
            character.triangles += (child.geometry.index?.count ?? child.geometry.getAttribute('position').count) / 3;
            for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
              names.add(material.name);
              if (material.name === 'city_runner_jacket' && material instanceof MeshStandardMaterial) {
                const color = '#' + material.color.getHexString();
                if (!character.appearance.jacketColors.includes(color)) character.appearance.jacketColors.push(color);
              }
            }
          });
          character.materials = [...names].sort();
          character.skinCount = skeletons.size;
          const left = object.getObjectByName('city_runner_LeftFoot'); const right = object.getObjectByName('city_runner_RightFoot');
          if (left && right) character.soles = { left: new Box3().setFromObject(left, true).min.y, right: new Box3().setFromObject(right, true).min.y };
        }
        if (object.name === 'roadblock-fallback') fallbacks++;
        if (object.name !== 'roadblock-model') return;
        models++;
        let shown = object.visible;
        for (let parent = object.parent; parent; parent = parent.parent) shown = shown && parent.visible;
        const box = new Box3().setFromObject(object);
        if (shown && frustum.intersectsBox(box)) visible++;
        if (bounds) return;
        const materials = new Set<string>();
        object.traverse((child) => {
          if (child instanceof Mesh) {
            for (const material of Array.isArray(child.material) ? child.material : [child.material]) materials.add(material.name);
          }
        });
        bounds = { size: box.getSize(new Vector3()).toArray(), minY: box.min.y, materials: [...materials].sort() };
      });
      const cameraStats = { position: camera.position.toArray(), quaternion: camera.quaternion.toArray(), fov: 'fov' in camera && typeof camera.fov === 'number' ? camera.fov : 0 };
      if (import.meta.env.MODE === 'e2e') window.__RUNNER_RENDER__ = {
        tick: game.view.tick,
        camera: cameraStats,
        calls: gl.info.render.calls,
        triangles: gl.info.render.triangles,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
        roadblock: { models, fallbacks, visible, bounds },
        character, powerups: powers,
      };
      if (debugMotionEnabled && character.animation && performance.now() >= nextPublish) {
        nextPublish = performance.now() + 250;
        const s = game.view; const a = character.animation;
        publishMotionMetrics({ tick: s.tick, state: a.state, speed: s.speed, runScale: a.runScale, phase: a.time / a.duration,
          leanDegrees: character.lean * 180 / Math.PI, landing: character.impact.landing, scaleY: character.impact.scaleY,
          reducedMotion: motionPreferences.getSnapshot(), jumpStage: s.player.y === 0 ? 'grounded' : s.player.velocityY > 0 ? 'rising' : 'falling',
          jumpProgress: s.player.y === 0 ? 0 : jumpProgress(s), slideProgress: s.player.slideRemaining > 0 ? slideProgress(s) : 0,
          fov: cameraStats.fov, camera: cameraStats.position, pelvisY: character.bones.Hips?.[1] ?? 0, headY: character.bones.Head?.[1] ?? 0, soles: character.soles });
      }
    });
    return () => { stop(); if (import.meta.env.MODE === 'e2e') delete window.__RUNNER_INSPECT__; };
  }, [gl, scene, camera]);
  return null;
}

function ContextWatcher({ onLost }: { onLost: (lost: boolean) => void }) {
  const { gl } = useThree();
  useEffect(() => {
    const lost = (event: Event): void => { event.preventDefault(); graphics.setAvailable(false); input.setBlocked(true); game.pause(); feedback.audio.setPaused(true); quality.resetSampling(); onLost(true); };
    const restored = (): void => { graphics.setAvailable(true); input.setBlocked(false); quality.resetSampling(); onLost(false); };
    gl.domElement.addEventListener('webglcontextlost', lost);
    gl.domElement.addEventListener('webglcontextrestored', restored);
    return () => { gl.domElement.removeEventListener('webglcontextlost', lost); gl.domElement.removeEventListener('webglcontextrestored', restored); graphics.setAvailable(true); input.setBlocked(false); };
  }, [gl, onLost]);
  return null;
}

class SceneBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(): void { loading.setRendererFailed('请启用浏览器硬件加速和 WebGL，然后刷新页面。'); }
  render() {
    if (this.state.error) return <div className="scene-error" role="alert">3D 场景无法启动，请启用浏览器硬件加速后刷新。</div>;
    return this.props.children;
  }
}

export function GameScene() {
  const [lostContext, setLostContext] = useState(false);
  const { profile, deviceDpr } = useQuality();
  return <SceneBoundary>
    <Canvas
      shadows={profile.shadows ? 'soft' : false}
      dpr={Math.min(deviceDpr, profile.dprCap)}
      gl={{ antialias: true, powerPreference: 'high-performance', toneMapping: ACESFilmicToneMapping }}
      onCreated={({ gl }) => {
        gl.domElement.setAttribute('aria-label', 'Runner3D 三跑道游戏场景');
        loading.setRendererReady();
      }}
      fallback={<div className="scene-error">此浏览器不支持 WebGL，请使用开启硬件加速的现代浏览器。</div>}
    >
      <PerspectiveCamera makeDefault fov={51} near={0.1} far={250} position={[0, 7.8, 12]} />
      <CameraRig />
      <ContextWatcher onLost={setLostContext} />
      <Environment />
      <QualityController active={!lostContext} />
      <AssetWarmup />
      <Suspense fallback={null}><World /><Obstacles /><PowerUps /><Runner /><ActivePowerUpVisuals /></Suspense>
      <FeedbackEffects />
      <Diagnostics />
      {(debugCityEnabled || import.meta.env.MODE === 'e2e') && <CityDiagnostics />}
      {(debugMobileEnabled || import.meta.env.MODE === 'e2e') && <Suspense fallback={null}><MobileDiagnostics /></Suspense>}
    </Canvas>
    {debugCityEnabled && <CityDebug />}
    {debugMotionEnabled && <Suspense fallback={null}><MotionDebug /></Suspense>}
    {debugEffectsEnabled && <Suspense fallback={null}><EffectsDebug /></Suspense>}
    {debugMobileEnabled && <Suspense fallback={null}><MobileDebug /></Suspense>}
    <RunnerAssetStatus />
    {lostContext && <div className="scene-error context-error" role="alert">图形连接已中断，游戏已暂停。<p>恢复连接后请手动继续；若无法恢复，可刷新重新开始。</p><button type="button" onClick={() => window.location.reload()}>刷新页面</button></div>}
  </SceneBoundary>;
}
