import { monitor } from '../observability/client';
import { Component, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei/core/Gltf.js';
import { ACESFilmicToneMapping } from 'three';
import type { AnimationClip, Group, Object3D } from 'three';
import { GeneratedAsset, useAssetStatus } from '../assets/GeneratedAsset';
import { assetUrl } from '../assets/catalog';
import { loading, registerAssetCacheClear } from '../assets/loading';
import { CharacterAppearance } from '../character/CharacterAppearance';
import { getCharacterSkin } from '../character/appearance';
import type { SkinId } from '../character/appearance';
import { CharacterAnimationController } from '../character/CharacterAnimationController';
import { useReducedMotion } from '../runtime/motion-preferences';
import { useProductPreferences } from '../runtime/product-preferences';
import { RendererResources } from '../assets/RendererResources';

function PreviewFallback({ skinId }: { skinId: SkinId }) {
  const { colors } = getCharacterSkin(skinId);
  return <group name="character-preview-fallback">
    <mesh position={[0, 1.09, 0]}><boxGeometry args={[.57, .65, .35]} /><meshStandardMaterial color={colors.jacket} /></mesh>
    <mesh position={[0, 1.59, -.02]}><boxGeometry args={[.45, .38, .39]} /><meshStandardMaterial color="#E4B594" /></mesh>
    {([-1, 1] as const).map((side) => <group key={side}>
      <mesh position={[side * .16, .42, 0]}><boxGeometry args={[.22, .7, .27]} /><meshStandardMaterial color={colors.pants} /></mesh>
      <mesh position={[side * .16, .08, -.055]}><boxGeometry args={[.26, .16, .4]} /><meshStandardMaterial color={colors.shoe} /></mesh>
      <mesh position={[side * .4, 1.1, 0]}><boxGeometry args={[.19, .57, .22]} /><meshStandardMaterial color={colors.jacket} /></mesh>
    </group>)}
  </group>;
}

/** Production Idle preview uses the same four-action controller, independent of GameStore. */
function PreviewAnimation({ instance, clips, active }: { instance: Object3D; clips: readonly AnimationClip[]; active: boolean }) {
  const controller = useRef<CharacterAnimationController | null>(null);
  const group = useRef<Group>(null);
  const { scene } = useThree();
  useLayoutEffect(() => {
    const animation = new CharacterAnimationController(instance, clips);
    animation.samplePreview('idle', 0);
    controller.current = animation;
    const object = group.current;
    if (object) object.userData.animationController = animation;
    return () => { animation.dispose(); controller.current = null; if (object) delete object.userData.animationController; };
  }, [instance, clips]);
  useLayoutEffect(() => {
    if (import.meta.env.MODE !== 'e2e') return;
    const inspect = (): NonNullable<ReturnType<NonNullable<Window['__PRODUCT_PREVIEW__']>>> => ({
      animation: controller.current?.diagnostics() ?? null,
      rotation: scene.getObjectByName('character-preview-turntable')?.rotation.y ?? 0,
      active,
    });
    window.__PRODUCT_PREVIEW__ = inspect;
    return () => { if (window.__PRODUCT_PREVIEW__ === inspect) delete window.__PRODUCT_PREVIEW__; };
  }, [scene, active]);
  useFrame((_, delta) => controller.current?.playPreview('idle', delta, 1, active));
  return <group name="character-preview-animation" ref={group} dispose={null}><primitive object={instance} /></group>;
}

function PreviewCamera() {
  const { camera } = useThree();
  useLayoutEffect(() => { camera.lookAt(0, .9, 0); camera.updateMatrixWorld(); }, [camera]);
  return null;
}

function PreviewContext({ onLost }: { onLost: (lost: boolean) => void }) {
  const { gl, invalidate } = useThree();
  useEffect(() => {
    const lost = (event: Event): void => { event.preventDefault(); onLost(true); };
    const restored = (): void => { onLost(false); invalidate(); };
    gl.domElement.addEventListener('webglcontextlost', lost);
    gl.domElement.addEventListener('webglcontextrestored', restored);
    return () => { gl.domElement.removeEventListener('webglcontextlost', lost); gl.domElement.removeEventListener('webglcontextrestored', restored); };
  }, [gl, invalidate, onLost]);
  return null;
}

class PreviewBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { monitor.error('WEBGL_INIT'); console.error('[preview] City Runner 预览无法启动。', error); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Mount this instead of the game Canvas: one lightweight renderer, one cached GLB, no city. */
export function CharacterPreview({ skinId: selectedSkin, interactive = true, className = '' }: { skinId?: SkinId; interactive?: boolean; className?: string }) {
  const { skinId: savedSkin } = useProductPreferences();
  const skinId = selectedSkin ?? savedSkin;
  const reducedMotion = useReducedMotion();
  const status = useAssetStatus('city-runner');
  const [rotation, setRotation] = useState(0);
  const [rendererRevision, setRendererRevision] = useState(0);
  const [lost, setLost] = useState(false);
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    // Unlike attachAssetLoading, this attaches timeout handling without requesting city kits.
    const detachLoading = loading.attach();
    const detachCache = registerAssetCacheClear((id) => { if (id === 'city-runner') useGLTF.clear(assetUrl(id)); });
    const changed = (): void => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', changed);
    return () => { detachCache(); detachLoading(); document.removeEventListener('visibilitychange', changed); };
  }, []);
  const unavailable = <div className="character-preview__unavailable" role="status">
    <p>3D 预览暂不可用。你仍可选择外观或开始游戏。</p>
    <button type="button" onClick={() => { setLost(false); setRendererRevision((value) => value + 1); }}>重试 3D 预览</button>
  </div>;
  return <div className={`character-preview ${className}`} data-skin-id={skinId} data-model-status={status}>
    <div className="character-preview__stage" role="img" aria-label={`City Runner 真实 3D 角色预览，${getCharacterSkin(skinId).label}`}>
      <PreviewBoundary key={rendererRevision} fallback={unavailable}>
        <Canvas
          camera={{ fov: 34, near: .1, far: 20, position: [2.5, 1.65, -4.2] }}
          dpr={[1, 1.25]}
          frameloop={reducedMotion || !visible || lost ? 'demand' : 'always'}
          gl={{ antialias: true, alpha: true, powerPreference: 'low-power', toneMapping: ACESFilmicToneMapping }}
          onCreated={({ gl }) => { gl.domElement.setAttribute('aria-label', 'City Runner 角色预览画布'); }}
          fallback={unavailable}
        >
          <RendererResources /><PreviewCamera /><PreviewContext onLost={setLost} />
          <ambientLight intensity={.85} /><hemisphereLight args={['#d2e8ff', '#293850', 1.3]} />
          <directionalLight position={[3, 5, -4]} color="#ffecd5" intensity={2.5} />
          <group rotation={[0, rotation, 0]} name="character-preview-turntable">
            <GeneratedAsset id="city-runner" fallback={<PreviewFallback skinId={skinId} />} castShadow={false}
              renderInstance={(instance, clips) => <CharacterAppearance instance={instance} skinId={skinId}><PreviewAnimation instance={instance} clips={clips} active={!reducedMotion && visible && !lost} /></CharacterAppearance>} />
          </group>
          <mesh position={[0, -.055, 0]}><cylinderGeometry args={[.95, 1.02, .1, 32]} /><meshStandardMaterial color="#23364e" roughness={.86} /></mesh>
        </Canvas>
      </PreviewBoundary>
      {lost && <div className="character-preview__notice" role="status">图形连接已中断。恢复后可继续查看；你也可以直接开始游戏。</div>}
    </div>
    {interactive && <div className="character-preview__controls" role="group" aria-label="旋转角色预览">
      <button type="button" aria-label="向左旋转角色" onClick={() => setRotation((value) => value - Math.PI / 4)}>↶</button>
      <span>旋转查看</span>
      <button type="button" aria-label="向右旋转角色" onClick={() => setRotation((value) => value + Math.PI / 4)}>↷</button>
      <button type="button" onClick={() => setRotation(0)}>复位</button>
    </div>}
    {(status === 'idle' || status === 'loading') && <p className="character-preview__status" role="status">正在加载 City Runner… 暂用基础模型预览。</p>}
    {status === 'error' && <div className="character-preview__status" role="status"><p>City Runner 加载失败，暂用基础模型。外观选择仍会保存。</p><button type="button" onClick={loading.retryFailed}>重试角色模型</button></div>}
    {reducedMotion && <span className="character-preview__motion-note">减少动态效果 · 静止预览</span>}
  </div>;
}
