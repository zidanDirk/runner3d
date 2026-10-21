import { getAsset } from './catalog';
import type { AssetId } from './catalog';
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { Group } from 'three';

export type CharacterView = 'front' | 'back' | 'left' | 'right' | 'three-quarter';
export type CharacterLight = 'neutral' | 'dusk-city' | 'neon-city';
const views: readonly [CharacterView, string][] = [['front', '正面'], ['back', '背面'], ['left', '左侧'], ['right', '右侧'], ['three-quarter', '45°']];

/** Presets move the camera, never rotate/scale the exported character. Forward is -Z. */
export function characterCamera(view: CharacterView, distance: number, targetY: number): [number, number, number] {
  switch (view) {
    case 'front': return [0, targetY, -distance];
    case 'back': return [0, targetY, distance];
    case 'left': return [-distance, targetY, 0];
    case 'right': return [distance, targetY, 0];
    case 'three-quarter': return [-distance * 0.75, targetY + distance * 0.1, -distance * 0.75];
  }
}

export function jointEntries(value: unknown): [string, [number, number, number]][] {
  if (!value || typeof value !== 'object') return [];
  const result: [string, [number, number, number]][] = [];
  for (const [name, point] of Object.entries(value)) {
    if (Array.isArray(point) && point.length === 3 && point.every((v: unknown) => typeof v === 'number' && Number.isFinite(v))) result.push([name, [Number(point[0]), Number(point[1]), Number(point[2])]]);
  }
  return result;
}

/** Marker coordinates are the validated generator output, not an invented skeleton. */
export function CharacterJoints({ id }: { id: AssetId }) {
  const asset = getAsset(id);
  const entries = jointEntries('joints' in asset ? asset.joints : null);
  const root = useRef<Group>(null);
  const scene = useThree((state) => state.scene);
  const point = useMemo(() => new Vector3(), []);
  useFrame(() => {
    if (!root.current) return;
    scene.updateMatrixWorld(true);
    for (const [joint] of entries) {
      const boneName = joint === 'center' ? 'Hips' : joint === 'head' ? 'Head' : joint === 'neck' ? 'Neck'
        : joint.replace(/^left/, 'Left').replace(/^right/, 'Right').replace(/Shoulder$/, 'UpperArm').replace(/Elbow$/, 'LowerArm').replace(/Wrist$/, 'Hand').replace(/Hip$/, 'UpperLeg').replace(/Knee$/, 'LowerLeg').replace(/Ankle$/, 'Foot');
      const bone = scene.getObjectByName(boneName);
      const marker = root.current.getObjectByName(`joint-${joint}`);
      if (bone && marker) marker.position.copy(root.current.worldToLocal(bone.getWorldPosition(point)));
    }
  });
  return <group ref={root} name="character-joint-preview">
    {entries.map(([name, point]) => <mesh key={name} name={`joint-${name}`} position={point} renderOrder={100}>
      <sphereGeometry args={[0.015, 8, 6]} /><meshBasicMaterial color={name.startsWith('left') ? '#35edff' : name.startsWith('right') ? '#ff68bd' : '#f7e389'} depthTest={false} />
    </mesh>)}
  </group>;
}

export function CharacterControls({ view, light, joints, onView, onLight, onJoints }: {
  view: CharacterView; light: CharacterLight; joints: boolean;
  onView: (view: CharacterView) => void; onLight: (light: CharacterLight) => void; onJoints: (show: boolean) => void;
}) {
  return <div className="character-controls">
    <div role="group" aria-label="角色视角">{views.map(([id, name]) => <button key={id} type="button" aria-pressed={view === id} onClick={() => onView(id)}>{name}</button>)}</div>
    <label>光照 <select aria-label="角色光照" value={light} onChange={(event) => {
      const value = event.target.value;
      if (value === 'neutral' || value === 'dusk-city' || value === 'neon-city') onLight(value);
    }}><option value="neutral">中性</option><option value="dusk-city">Dusk City</option><option value="neon-city">Neon City</option></select></label>
    <label><input type="checkbox" checked={joints} onChange={(event) => onJoints(event.target.checked)} />关节参考</label>
  </div>;
}
