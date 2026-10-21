import type { Object3D } from 'three';
import { SHAPES } from '../../game/config';
import { createAssetInstance, GeneratedAsset } from '../GeneratedAsset';
import { assetUrl } from '../catalog';

export const ROADBLOCK_URL = assetUrl('roadblock');

/** Shared geometries/materials, independent transforms per obstacle. Never resize to hide a bad export. */
export function createRoadblockInstance(source: Object3D): Object3D {
  const expected = SHAPES.hurdle;
  return createAssetInstance(source, [expected.width, expected.height, expected.depth]);
}

function PrimitiveRoadblock() {
  const shape = SHAPES.hurdle;
  return <group name="roadblock-fallback">
    <mesh position={[0, shape.height / 2, 0]} castShadow>
      <boxGeometry args={[shape.width, shape.height, shape.depth]} /><meshStandardMaterial color="#f87c55" roughness={0.7} />
    </mesh>
    <mesh position={[0, shape.height * 0.6, shape.depth / 2 + 0.012]}>
      <boxGeometry args={[shape.width * 0.8, 0.1, 0.025]} /><meshBasicMaterial color="#ffe4ad" />
    </mesh>
  </group>;
}

export function Roadblock() {
  return <GeneratedAsset id="roadblock" prepare={createRoadblockInstance} fallback={<PrimitiveRoadblock />} />;
}
