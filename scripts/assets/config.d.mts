export type AssetType = 'roadblock' | 'traffic-cone' | 'street-lamp' | 'building' | 'billboard' | 'character' | 'powerup';
type AssetShape = { id: string; type: 'roadblock'; width: number; height: number; depth: number }
  | { id: string; type: 'traffic-cone'; height: number; baseSize: number; segments: number }
  | { id: string; type: 'street-lamp'; height: number; armLength: number; baseSize: number; style: 'classic' | 'tech' }
  | { id: string; type: 'building'; width: number; height: number; depth: number; variant: 'residential' | 'office'; floors: number; windowsPerFloor: number; roofStyle: 'flat' | 'equipment' | 'terrace'; accentStyle: 'plain' | 'neon' }
  | { id: string; type: 'billboard'; width: number; height: number; depth: number }
  | { id: string; type: 'powerup'; generator: 'pickup-icon-v1'; variant: 'magnet' | 'shield' | 'double-score'; width: number; height: number; depth: number }
  | { id: string; type: 'character'; generator: 'humanoid-runner'; height: number; proportions: { headScale: number; shoulderWidth: number; legLengthRatio: number }; outfit: { jacketColor: string; pantsColor: string; shoeColor: string; skinColor: string }; accessories: { backpack: boolean } };
export type AssetDefinition = AssetShape & { theme?: string };
export interface AssetConfig { schemaVersion: 1; blenderVersion: '5.2.2'; theme: string; seed: number; assets: AssetDefinition[] }
export interface ThemeMaterial { color: string; roughness: number; metalness: number; emissive?: string; emissiveStrength?: number }
export interface AssetTheme { id: string; shading: 'flat'; materials: Record<string, ThemeMaterial>; scene: Record<string, string> }
export type AssetContract = AssetDefinition & { path: string; dimensions: number[]; materials: string[]; tolerance: number; maxTriangles: number; maxBytes: number; assetSeed: number };
type WithoutPath<T> = T extends unknown ? Omit<T, 'path'> : never;
export type GenerationAsset = WithoutPath<AssetContract> & { themeId: string };
export interface GenerationJob { schemaVersion: 1; generatorVersion: string; blenderVersion: string; themes: Record<string, AssetTheme>; seed: number; assets: GenerationAsset[] }
export const PROJECT_ROOT: string;
export const DEFAULT_CONFIG: string;
export const GENERATED_MANIFEST: string;
export const GENERATOR_VERSION: '2.1.0';
export const BLENDER_VERSION: '5.2.2';
export const ASSET_TYPES: readonly AssetType[];
export const POWERUP_GENERATOR: 'pickup-icon-v1';
export function powerupPalette(asset: AssetDefinition): Record<string, ThemeMaterial>;
export function stableStringify(value: unknown): string;
export function hashValue(value: unknown): string;
export function normalizeConfig(input: unknown): AssetConfig;
export function validateTheme(input: unknown, expectedId: string): AssetTheme;
export function readTheme(id: string): Promise<AssetTheme>;
export function readConfig(path?: string): Promise<{ config: AssetConfig; theme: AssetTheme; themes: Record<string, AssetTheme> }>;
export function selectAssets(config: AssetConfig, only?: string): AssetDefinition[];
export function assetSeed(seed: number, id: string): number;
export function assetContract(asset: AssetDefinition, seed?: number): AssetContract;
export function configHash(config: AssetConfig, theme: AssetTheme, themes?: Record<string, AssetTheme>): string;
export function assetConfigHash(asset: AssetDefinition, config: AssetConfig, theme: AssetTheme): string;
export function createJob(config: AssetConfig, theme: AssetTheme, only?: string, themes?: Record<string, AssetTheme>): GenerationJob;
export function parseCli(args: string[], options?: { file?: boolean; only?: boolean }): { config?: string; file?: string; only?: string };

export function selectedTheme(asset: AssetDefinition, config: AssetConfig, themes: Record<string, AssetTheme>): AssetTheme;
