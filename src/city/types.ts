import type manifest from '../assets/generated/manifest.json';

/** Asset IDs are finite, generated build inputs, never executable configuration. */
export type CityAssetId = keyof typeof manifest.assets;
export type CityThemeId = string;
export type CityVector = readonly [number, number, number];

export interface CityTheme {
  readonly id: CityThemeId;
  readonly name: string;
  readonly version: string;
  readonly sky: { readonly background: string; readonly horizon: string; readonly sunColor: string; readonly sunOpacity: number };
  readonly lighting: {
    readonly skyColor: string; readonly groundColor: string; readonly hemisphereIntensity: number;
    readonly keyColor: string; readonly keyIntensity: number; readonly rimColor: string; readonly rimIntensity: number;
  };
  readonly road: {
    readonly surfaceColor: string; readonly lineColor: string; readonly edgeColor: string;
    readonly sidewalkColor: string; readonly markerColor: string;
  };
  readonly buildings: { readonly assetIds: readonly CityAssetId[] };
  readonly decorations: { readonly lampAssetId: CityAssetId; readonly billboardAssetId?: CityAssetId; readonly planterColor: string };
  readonly atmosphere: { readonly fogNear: number; readonly fogFar: number };
}

export interface CityConfig {
  readonly theme: 'low-poly-dusk-city';
  readonly seed: number;
  readonly chunkLength: number;
  readonly aheadChunks: number;
  readonly behindChunks: number;
  readonly zones: {
    readonly length: number;
    readonly transitionChunks: number;
    readonly sequence: readonly CityThemeId[];
  };
  readonly buildings: {
    readonly enabled: boolean;
    readonly density: number;
    readonly minSpacing: number;
  };
  readonly streetLamps: {
    readonly enabled: boolean;
    readonly spacing: number;
  };
}

/** Ground-centered transforms. Z is negative local forward distance in this chunk. */
export interface CityTransform {
  readonly id: string;
  readonly chunkId: number;
  readonly position: CityVector;
  readonly rotationY: number;
  readonly scale: CityVector;
}

export interface CityPlacement extends CityTransform {
  readonly assetId: CityAssetId;
}

export interface CityDecoration extends CityTransform {
  readonly kind: 'planter';
}

export interface CityChunk {
  readonly id: number;
  readonly zoneId: number;
  readonly themeId: CityThemeId;
  readonly startDistance: number;
  readonly length: number;
  readonly seed: string;
  readonly buildings: readonly CityPlacement[];
  readonly lamps: readonly CityPlacement[];
  readonly decorations: readonly CityDecoration[];
  readonly props: readonly CityPlacement[];
}

export interface CitySnapshot {
  readonly revision: number;
  readonly currentChunk: number;
  readonly anchorDistance: number;
  readonly seed: string;
  readonly chunks: readonly CityChunk[];
  readonly buildingCount: number;
  readonly lampCount: number;
  readonly decorationCount: number;
  readonly propCount: number;
}

export interface CityLimits {
  readonly chunks: number;
  readonly buildingsPerChunk: number;
  readonly lampsPerChunk: number;
  readonly decorationsPerChunk: number;
  readonly propsPerChunk: number;
  readonly buildings: number;
  readonly lamps: number;
  readonly decorations: number;
  readonly props: number;
}
