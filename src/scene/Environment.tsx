import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { BackSide, Color, Fog, ShaderMaterial } from 'three';
import type { DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, Scene } from 'three';
import { getCityTheme } from '../city/themes';
import type { CityTheme } from '../city/types';
import { getThemeTransition } from '../city/zones';
import { game } from '../runtime/store';

type RoadRole = 'surfaceColor' | 'lineColor' | 'edgeColor' | 'sidewalkColor' | 'markerColor';
export type EnvironmentRole = RoadRole | 'planterColor';
type ColorMaterial = (MeshStandardMaterial | MeshBasicMaterial);
const materials = new WeakMap<Scene, Map<ColorMaterial, EnvironmentRole>>();
const palette = new Map<string, Map<string, Color>>();
function color(theme: CityTheme, value: string): Color {
  let cache = palette.get(theme.id);
  if (!cache) { cache = new Map(); palette.set(theme.id, cache); }
  let result = cache.get(value);
  if (!result) { result = new Color(value); cache.set(value, result); }
  return result;
}

/** Register only owned road/decoration materials. GLB materials are never recolored. */
export function ThemedMaterial({ role, unlit = false }: { role: EnvironmentRole; unlit?: boolean }) {
  const scene = useThree((state) => state.scene);
  const ref = useRef<ColorMaterial>(null);
  useLayoutEffect(() => {
    const material = ref.current;
    if (!material) return;
    let registry = materials.get(scene);
    if (!registry) { registry = new Map(); materials.set(scene, registry); }
    registry.set(material, role);
    return () => { registry.delete(material); };
  }, [scene, role]);
  return unlit ? <meshBasicMaterial ref={ref} /> : <meshStandardMaterial ref={ref} roughness={0.95} />;
}

const vertexShader = `varying vec3 worldDirection;
void main(){ vec4 world = modelMatrix * vec4(position,1.0); worldDirection=normalize(world.xyz-cameraPosition); gl_Position=projectionMatrix*viewMatrix*world; }`;
const fragmentShader = `uniform vec3 topColor; uniform vec3 horizonColor; varying vec3 worldDirection;
void main(){ float t=smoothstep(-0.1,0.65,worldDirection.y); gl_FragColor=vec4(mix(horizonColor,topColor,t),1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

export function Environment({ fixedThemeId, showSun = true }: { fixedThemeId?: string; showSun?: boolean }) {
  const { scene, camera } = useThree();
  const skyRoot = useRef<Mesh>(null);
  const hemi = useRef<HemisphereLight>(null);
  const key = useRef<DirectionalLight>(null);
  const rim = useRef<DirectionalLight>(null);
  const sun = useRef<MeshBasicMaterial>(null);
  const fog = useMemo(() => new Fog('#192d40', 45, 155), []);
  const background = useMemo(() => new Color(), []);
  const sky = useMemo(() => new ShaderMaterial({
    uniforms: { topColor: { value: new Color() }, horizonColor: { value: new Color() } },
    vertexShader, fragmentShader, depthWrite: false, side: BackSide, toneMapped: false,
  }), []);
  useLayoutEffect(() => {
    const previousFog = scene.fog;
    const previousBackground = scene.background;
    scene.fog = fog; scene.background = background;
    return () => { scene.fog = previousFog; scene.background = previousBackground; sky.dispose(); };
  }, [scene, fog, background, sky]);
  useFrame(() => {
    if (skyRoot.current) skyRoot.current.position.copy(camera.position);
    const state = getThemeTransition(game.view.distance);
    const from = getCityTheme(fixedThemeId ?? state.fromThemeId);
    const to = getCityTheme(fixedThemeId ?? state.toThemeId);
    const p = fixedThemeId ? 1 : state.progress;
    const t = p * p * (3 - 2 * p);
    const mix = (output: Color, a: string, b: string) => output.lerpColors(color(from, a), color(to, b), t);
    const scalar = (a: number, b: number) => a + (b - a) * t;
    mix(background, from.sky.background, to.sky.background);
    mix(fog.color, from.sky.horizon, to.sky.horizon);
    fog.near = scalar(from.atmosphere.fogNear, to.atmosphere.fogNear);
    fog.far = scalar(from.atmosphere.fogFar, to.atmosphere.fogFar);
    mix(sky.uniforms.topColor!.value, from.sky.background, to.sky.background);
    mix(sky.uniforms.horizonColor!.value, from.sky.horizon, to.sky.horizon);
    if (hemi.current) {
      mix(hemi.current.color, from.lighting.skyColor, to.lighting.skyColor);
      mix(hemi.current.groundColor, from.lighting.groundColor, to.lighting.groundColor);
      hemi.current.intensity = scalar(from.lighting.hemisphereIntensity, to.lighting.hemisphereIntensity);
    }
    if (key.current) {
      mix(key.current.color, from.lighting.keyColor, to.lighting.keyColor);
      key.current.intensity = scalar(from.lighting.keyIntensity, to.lighting.keyIntensity);
    }
    if (rim.current) {
      mix(rim.current.color, from.lighting.rimColor, to.lighting.rimColor);
      rim.current.intensity = scalar(from.lighting.rimIntensity, to.lighting.rimIntensity);
    }
    if (sun.current) {
      mix(sun.current.color, from.sky.sunColor, to.sky.sunColor);
      sun.current.opacity = scalar(from.sky.sunOpacity, to.sky.sunOpacity);
      sun.current.visible = sun.current.opacity > 0;
    }
    for (const [material, role] of materials.get(scene) ?? []) {
      mix(material.color, role === 'planterColor' ? from.decorations.planterColor : from.road[role],
        role === 'planterColor' ? to.decorations.planterColor : to.road[role]);
    }
  });
  return <>
    <mesh ref={skyRoot} renderOrder={-1000} frustumCulled={false} material={sky}><sphereGeometry args={[220, 12, 8]} /></mesh>
    <hemisphereLight ref={hemi} />
    <directionalLight ref={key} position={[-12, 24, 9]} castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-12} shadow-camera-right={12} shadow-camera-top={20} shadow-camera-bottom={-20} shadow-camera-far={70} shadow-bias={-0.0005} />
    <directionalLight ref={rim} position={[8, 8, -20]} />
    {showSun && <mesh position={[24, 18, -140]}><sphereGeometry args={[12, 32, 16]} /><meshBasicMaterial ref={sun} fog={false} transparent depthWrite={false} /></mesh>}
  </>;
}
