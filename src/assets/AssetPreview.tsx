import { useEffect, useState } from 'react';
import { Canvas, addAfterEffect, useThree } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { ACESFilmicToneMapping, Bone, Box3, Mesh, Vector3 } from 'three';
import { assetIds, assetLabel, assetManifest, getAsset } from './catalog';
import type { AssetId } from './catalog';
import { GeneratedAsset, preloadAssets, useAssetStatus } from './GeneratedAsset';
import { CITY_THEMES, getCityTheme } from '../city/themes';
import { themeAssetIds } from './city-loading';
import { Environment, ThemedMaterial } from '../scene/Environment';
import { CharacterControls, CharacterJoints, characterCamera } from './CharacterPreview';
import type { CharacterLight, CharacterView } from './CharacterPreview';
import { AnimatedCharacter } from '../character/AnimatedCharacter';
import type { PreviewPlayback } from '../character/AnimatedCharacter';
import { CharacterAnimationController } from '../character/CharacterAnimationController';
import type { AnimationDiagnostics } from '../character/CharacterAnimationController';
import { ANIMATION_STATES } from '../character/animationConfig';
import type { AnimationState } from '../character/animationConfig';
import { AnimationPreviewControls, clipDurations } from './AnimationPreviewControls';
import './asset-preview.css';

type View = AssetId | 'all';
interface PreviewStats { calls: number; triangles: number; animation?: AnimationDiagnostics; footSoles?: { left: number[]; right: number[] }; pelvisY?: number }
interface PreviewOptions { themeId?: string; characterId?: string; showJoints?: boolean; showSkeleton?: boolean; animation?: string; animationTime?: string }

function PreviewDiagnostics({ onStats, preset, light, joints }: { onStats: (value: PreviewStats) => void; preset?: CharacterView; light?: CharacterLight; joints: boolean }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    let next = 0;
    return addAfterEffect(() => {
    if (performance.now() < next) return;
    next = performance.now() + 300;
    const models: Record<string, { size: number[]; minY: number; materials: string[]; emissiveMaterials: number }> = {};
    const jointMarkers: Record<string, number[]> = {};
    let animation: AnimationDiagnostics | undefined;
    const bones: Record<string, number[]> = {};
    let skeletonHelpers = 0;
    scene.updateMatrixWorld();
    scene.traverse((object) => {
      if (object.userData.animationController instanceof CharacterAnimationController) animation = object.userData.animationController.diagnostics();
      if (object instanceof Bone) bones[object.name] = object.getWorldPosition(new Vector3()).toArray();
      if (object.name === 'character-skeleton-helper') skeletonHelpers++;
      if (object instanceof Mesh && object.name.startsWith('joint-')) jointMarkers[object.name.slice(6)] = object.getWorldPosition(new Vector3()).toArray();
      const id: unknown = object.userData.assetId;
      if (typeof id !== 'string') return;
      const bounds = new Box3().setFromObject(object, true);
      const materials = new Set<string>();
      const emissive = new Set<string>();
      object.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
          materials.add(material.name);
          if ('emissive' in material && 'emissiveIntensity' in material && typeof material.emissiveIntensity === 'number' && material.emissiveIntensity > 0) {
            const color: unknown = material.emissive;
            if (color && typeof color === 'object' && 'getHex' in color && typeof color.getHex === 'function' && color.getHex() !== 0) emissive.add(material.name);
          }
        }
      });
      models[id] = { size: bounds.getSize(new Vector3()).toArray(), minY: bounds.min.y, materials: [...materials].sort(), emissiveMaterials: emissive.size };
    });
    const sole = (side: string) => {
      const object = scene.getObjectByName(`city_runner_${side}Foot`);
      if (!object) return undefined;
      const box = new Box3().setFromObject(object, true); const center = box.getCenter(new Vector3()).toArray(); center[1] = box.min.y; return center;
    };
    const left = sole('Left'); const right = sole('Right');
    const footSoles = left && right ? { left, right } : undefined;
    const stats = { calls: gl.info.render.calls, triangles: gl.info.render.triangles, animation, footSoles, pelvisY: bones.Hips?.[1] };
    onStats(stats);
    if (import.meta.env.MODE === 'e2e') window.__ASSET_PREVIEW__ = { models, camera: camera.position.toArray(), ...stats, preset, light, joints, jointMarkers, bones, skeletonHelpers };
    });
  }, [gl, scene, camera, onStats, preset, light, joints]);
  useEffect(() => () => { delete window.__ASSET_PREVIEW__; }, []);
  return null;
}

function AssetObjects({ view, ids, playback }: { view: View; ids: readonly AssetId[]; playback?: PreviewPlayback }) {
  if (view !== 'all') return <GeneratedAsset id={view} renderInstance={playback ? (instance, clips) => <AnimatedCharacter instance={instance} clips={clips} preview={playback} /> : undefined} />;
  const buildings = ids.filter((id) => getAsset(id).type === 'building');
  const small = ids.filter((id) => getAsset(id).type !== 'building');
  return <>
    {small.map((id, index) => <group key={id} position={[(index - (small.length - 1) / 2) * 4, 0, 5]}><GeneratedAsset id={id} /></group>)}
    {buildings.map((id, index) => <group key={id} position={[(index % 3 - (Math.min(buildings.length, 3) - 1) / 2) * 9, 0, -6 - Math.floor(index / 3) * 11]}><GeneratedAsset id={id} /></group>)}
  </>;
}

function Viewer({ view, reset, ids, themeId, onStats, characterView, characterLight, showJoints = false, playback }: { view: View; reset: number; ids: readonly AssetId[]; themeId?: string; onStats: (value: PreviewStats) => void; characterView?: CharacterView; characterLight?: CharacterLight; showJoints?: boolean; playback?: PreviewPlayback }) {
  const dimensions = view === 'all' ? [20, 18, 20] : getAsset(view).dimensions;
  const height = dimensions[1] ?? 1;
  const extent = Math.max(...dimensions);
  const target: [number, number, number] = [0, view === 'all' ? 6 : height / 2, 0];
  const distance = view === 'all' ? 34 : extent * 1.75;
  const neutral = characterLight === 'neutral';
  return <Canvas key={`${view}-${reset}-${characterView}-${characterLight}`} shadows dpr={[1, 1.5]} gl={{ antialias: true, toneMapping: ACESFilmicToneMapping }}>
    <PerspectiveCamera makeDefault fov={42} near={0.05} far={250} position={characterView ? characterCamera(characterView, distance, target[1]) : [distance * 0.8, target[1] + distance * 0.45, distance]} />
    <OrbitControls makeDefault target={target} minDistance={extent * 0.6} maxDistance={extent * 7} maxPolarAngle={Math.PI * 0.49} enablePan />
    {neutral ? <>
      <color attach="background" args={['#c7d0d6']} />
      <hemisphereLight args={['#ffffff', '#748291', 2]} />
      <directionalLight position={[-3, 5, -4]} intensity={2.5} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-3} shadow-camera-right={3} shadow-camera-top={3} shadow-camera-bottom={-3} shadow-bias={-0.0005} />
      <directionalLight position={[3, 3, 4]} intensity={1.2} />
    </> : <Environment fixedThemeId={characterLight ?? themeId ?? 'dusk-city'} showSun={false} />}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.008, 0]} receiveShadow><planeGeometry args={[160, 160]} />{neutral ? <meshStandardMaterial color="#9aa8b1" roughness={0.95} /> : <ThemedMaterial role="sidewalkColor" />}</mesh>
    <gridHelper args={[characterView ? 8 : 100, characterView ? 16 : 100, '#62766f', '#354b59']} position={[0, 0.002, 0]} />
    <AssetObjects view={view} ids={ids} playback={playback} />
    {showJoints && view !== 'all' && <CharacterJoints id={view} />}
    <PreviewDiagnostics onStats={onStats} preset={characterView} light={characterLight} joints={showJoints} />
  </Canvas>;
}

function AssetCard({ id, selected, onSelect }: { id: AssetId; selected: boolean; onSelect: () => void }) {
  const status = useAssetStatus(id);
  const asset = getAsset(id);
  return <button className={`asset-card${selected ? ' is-selected' : ''}`} type="button" aria-pressed={selected} aria-label={`查看 ${id}`} onClick={onSelect} data-asset-status={status}>
    <span className={`asset-card-symbol symbol-${asset.type}`} aria-hidden="true">{asset.type === 'building' ? '▥' : asset.type === 'street-lamp' ? '⌐' : asset.type === 'traffic-cone' ? '△' : '▰'}</span>
    <span className="asset-card-copy"><strong>{assetLabel(id)}</strong><small>{id}</small><span>{asset.dimensions.map((value) => Number(value.toFixed(2))).join(' × ')} m</span></span>
    <span className={`asset-dot ${status}`} title={status === 'loaded' ? '已加载 GLB' : status === 'error' ? '已回退几何体' : '等待加载'} />
  </button>;
}

function PreviewPage({ themeId, characterId, showJoints = false, showSkeleton = false, animation = 'idle', animationTime = '0' }: Omit<PreviewOptions, 'characterId' | 'animation'> & { characterId?: AssetId; animation?: AnimationState }) {
  const [playback, setPlayback] = useState<PreviewPlayback>({ state: animation, seconds: Number(animationTime), playing: false, speed: 1, revision: 0, showSkeleton });
  const [view, setView] = useState<View>(characterId ?? 'all');
  const [characterView, setCharacterView] = useState<CharacterView>('three-quarter');
  const [characterLight, setCharacterLight] = useState<CharacterLight>('neutral');
  const [joints, setJoints] = useState(showJoints);
  const [reset, setReset] = useState(0);
  const [preloaded, setPreloaded] = useState(false);
  const selected = view === 'all' ? null : getAsset(view);
  const cityTheme = themeId ? getCityTheme(themeId) : undefined;
  const visibleIds = characterId ? [characterId] : cityTheme ? themeAssetIds(cityTheme) : assetIds;
  const [renderStats, setRenderStats] = useState<PreviewStats>({ calls: 0, triangles: 0 });
  useEffect(() => { preloadAssets(visibleIds); }, [themeId, characterId]);
  return <div className="asset-preview-shell">
    <header className="asset-preview-header"><a href="./" className="brand"><span className="brand-mark">↗</span><span>runner<span className="brand-3d">3D</span>.</span></a><span className="asset-lab-tag">ASSET FACTORY <span>/</span> DEV ONLY</span><a className="back-to-game" href="./">返回游戏 ↗</a></header>
    <div className="asset-lab-heading"><div><p>{characterId ? 'ORIGINAL LOW POLY CHARACTER' : cityTheme?.name.toUpperCase() ?? 'CITY ASSET FACTORY'} / {assetManifest.generatorVersion}</p><h1>{characterId ? 'City Runner 角色预览' : cityTheme ? `${cityTheme.name} 主题预览` : '城市资产工厂'}<span>。</span></h1><span>{characterId ? '原创城市运动员 · 米制尺度 · 前进 −Z · 20骨骼 · 四动作 · 真实蒙皮' : '同一个主题，同一套尺度。拖动查看每个细节。'}</span></div><div className="asset-lab-version">BLENDER {assetManifest.blenderVersion}<br /><small>SEED {assetManifest.seed}</small></div></div>
    <nav className="theme-preview-nav" aria-label="主题预览"><a href="?assetPreview=1">全部资源</a><a href="?characterPreview=city-runner" aria-current={characterId ? 'page' : undefined}>City Runner</a>{CITY_THEMES.map(({ id, name }) => <a key={id} href={`?themePreview=${id}`} aria-current={id === themeId ? 'page' : undefined}>{name}</a>)}</nav>
    <main className="asset-lab-layout">
      <aside className="asset-library" aria-label="资产列表"><div className="asset-library-title"><strong>资源清单</strong><span>{String(visibleIds.length).padStart(2, '0')} ASSETS</span></div>
        {!characterId && <button type="button" className={`asset-all-button${view === 'all' ? ' is-selected' : ''}`} aria-pressed={view === 'all'} onClick={() => setView('all')}>全部资源 · 同尺度对比 <span>↗</span></button>}
        {visibleIds.map((id) => <AssetCard key={id} id={id} selected={view === id} onSelect={() => setView(id)} />)}
        <p className="asset-library-note">所有尺寸以米为单位。<br />路灯发光材质用于视觉展示，不增加实时光源。</p>
      </aside>
      <section className="asset-viewer-column" aria-label="模型预览">
        <div className={`asset-viewport${characterId && characterLight === 'neutral' ? ' neutral-preview' : ''}`}><Viewer view={view} reset={reset} ids={visibleIds} themeId={themeId} onStats={setRenderStats} characterView={characterId ? characterView : undefined} characterLight={characterId ? characterLight : undefined} showJoints={!!characterId && joints} playback={characterId ? playback : undefined} /><div className="asset-viewer-label"><span className="asset-label-dot" />{view === 'all' ? cityTheme?.name ?? '同尺度对比' : assetLabel(view)}<small>{view === 'all' ? 'COLLECTION VIEW' : view}</small></div><div className="asset-viewer-hint">拖动旋转 <span>·</span> 滚轮缩放 <span>·</span> 右键平移</div></div>
        {characterId && <CharacterControls view={characterView} light={characterLight} joints={joints} onView={setCharacterView} onLight={setCharacterLight} onJoints={setJoints} />}
        {characterId && <AnimationPreviewControls value={playback} onChange={setPlayback} durations={clipDurations(getAsset(characterId))} actualTime={renderStats.animation?.time} footSoles={renderStats.footSoles} pelvisY={renderStats.pelvisY} />}
        <div className="asset-viewer-toolbar"><span>地面 Y = 0 <span className="asset-toolbar-divider">/</span> {selected ? `${selected.triangles.toLocaleString()} TRIANGLES` : 'REAL-WORLD SCALE'}</span><div><button type="button" onClick={() => { preloadAssets(visibleIds); setPreloaded(true); }}>预加载全部</button><button type="button" onClick={() => setReset((value) => value + 1)}>重置视角 ↻</button></div></div>
        <div className="asset-details" aria-label="资产统计">{selected ? <>
          <div><span>{characterId ? `模型尺寸 · 高 ${selected.dimensions[1]?.toFixed(2)}m` : '模型尺寸'}</span><strong data-testid="asset-dimensions">{selected.dimensions.map((value) => Number(value.toFixed(3))).join(' × ')}<small> m</small></strong></div>
          <div><span>三角形</span><strong data-testid="asset-triangles">{selected.triangles.toLocaleString()}</strong></div>
          <div><span>MESH / 材质</span><strong>{selected.meshCount} / {selected.materialCount}</strong></div>
          <div><span>GLB 大小</span><strong>{(selected.bytes / 1024).toFixed(1)}<small> KiB</small></strong></div>
        </> : <><div><span>主题 / 资源</span><strong>{cityTheme?.name ?? '全部'} · {visibleIds.length}</strong></div><div><span>Draw Call</span><strong data-testid="preview-calls">{renderStats.calls}</strong></div><div><span>三角形</span><strong data-testid="preview-triangles">{renderStats.triangles.toLocaleString('en-US')}</strong></div><div><span>材质 / 纹理</span><strong>共享 / 无</strong></div></>}</div>
        {preloaded && <p className="asset-preload-note" role="status">已请求预加载全部资源；列表绿点表示模型已实际挂载。</p>}
      </section>
    </main>
    <footer className="asset-preview-footer"><span>CONFIG → BLENDER → GLB → MANIFEST → THREE.JS</span><span>开发预览与正式跑酷玩法独立。</span></footer>
  </div>;
}

export function AssetPreview({ themeId, characterId, showJoints, showSkeleton, animation = 'idle', animationTime = '0' }: PreviewOptions) {
  if (characterId !== undefined) {
    const id = assetIds.find((id) => id === characterId && getAsset(id).type === 'character');
    if (!id) return <div className="asset-preview-shell"><p role="alert">未知角色资源：{characterId}</p><a href="?assetPreview=1">返回资产工厂</a></div>;
    const state = ANIMATION_STATES.find((state) => state === animation);
    const seconds = Number(animationTime);
    if (!state || !Number.isFinite(seconds) || seconds < 0 || seconds > clipDurations(getAsset(id))[state] + .00001) return <div className="asset-preview-shell"><p role="alert">动画或时间参数无效（时间单位：秒）</p><a href="?characterPreview=city-runner">返回角色预览</a></div>;
    return <PreviewPage characterId={id} showJoints={showJoints} showSkeleton={showSkeleton} animation={state} animationTime={animationTime} />;
  }
  if (themeId && !CITY_THEMES.some((theme) => theme.id === themeId)) return <div className="asset-preview-shell"><p role="alert">未知城市主题：{themeId}</p><a href="?assetPreview=1">返回资产工厂</a></div>;
  return <PreviewPage themeId={themeId} />;
}
