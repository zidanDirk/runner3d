import type { AssetConfig, AssetContract, AssetDefinition, AssetTheme } from './config.mjs';
import type { CharacterMotionAnalysis } from './character-motion-analysis.mjs';
export type AssetManifest = AssetContract;
export interface GlbStructure { json: Record<string, unknown>; triangles: number; primitiveCount: number }
export interface CharacterPart { nodeName: string; parent: string | null; origin: number[]; bounds: { min: number[]; max: number[] }; triangles: number; meshCount: number }
export interface DeformedBounds { min: number[]; max: number[] }
export interface AnimationSample { progress: number; bounds: DeformedBounds; bones: Record<string, { position: number[]; quaternion: number[] }> }
export interface CharacterRigValidation { boneCount: number; skinCount: number; skinnedMeshCount: number; animationCount: number; animations: { idle: 'Idle'; run: 'Run'; jump: 'Jump'; slide: 'Slide' }; animationClips: { name: string; duration: number; trackCount: number }[]; animationSamples: Record<string, AnimationSample[]>; poseTests: Record<string, DeformedBounds>; motionQuality: CharacterMotionAnalysis }
export interface CharacterValidation extends CharacterRigValidation { joints: Record<string, number[]>; parts: Record<string, CharacterPart> }
export interface ThreeValidation { dimensions: number[]; triangles: number; materials: string[]; min: number[]; max: number[]; character?: CharacterValidation }
export interface AssetValidation { filePath: string; bytes: number; sha256: string; structure: GlbStructure; three: ThreeValidation }
export interface GeneratedAssetEntry {
  path: string; themeId: string; type: AssetDefinition['type']; role: 'obstacle' | 'decoration' | 'preview' | 'player' | 'pickup'; dimensions: number[];
  triangles: number; meshCount: number; primitiveCount: number; materialCount: number; materials: string[];
  bytes: number; sha256: string; generatorVersion: string; blenderVersion: string; configHash: string; config: AssetDefinition;
  boneCount?: number; skinCount?: number; skinnedMeshCount?: number; animationCount?: number; animations?: CharacterRigValidation['animations']; animationClips?: CharacterRigValidation['animationClips']; animationSamples?: Record<string, Pick<AnimationSample, 'progress' | 'bounds'>[]>; poseTests?: CharacterRigValidation['poseTests'];
  assetId?: string; height?: number; bounds?: { min: number[]; max: number[] }; joints?: Record<string, number[]>; parts?: Record<string, CharacterPart>;
}
export interface GeneratedManifest {
  schemaVersion: 1; generatorVersion: string; blenderVersion: string; theme: string; seed: number;
  configHash: string; assets: Record<string, GeneratedAssetEntry>;
}
export const PROJECT_ROOT: string;
export const DEFAULT_MANIFEST: string;
export function readManifest(configPath?: string, id?: string): Promise<AssetManifest>;
export function validateGlbStructure(buffer: Buffer, manifest: AssetManifest): GlbStructure;
export function validateThreeLoad(buffer: Buffer, manifest: AssetManifest): Promise<ThreeValidation>;
export function validateAsset(options?: { filePath?: string; configPath?: string; manifest?: AssetContract; theme?: AssetTheme; log?: (message: string) => void }): Promise<AssetValidation>;
export function validateMaterialTheme(json: Record<string, unknown>, contract: AssetContract, theme: AssetTheme): void;
export function assetRole(type: AssetDefinition['type']): GeneratedAssetEntry['role'];
export function createManifestEntry(asset: AssetDefinition, config: AssetConfig, theme: AssetTheme, result: AssetValidation): GeneratedAssetEntry;
export function createGeneratedManifest(config: AssetConfig, theme: AssetTheme, entries: Record<string, GeneratedAssetEntry>, themes?: Record<string, AssetTheme>): GeneratedManifest;
export function validateManifestShape(manifest: unknown, config: AssetConfig, theme: AssetTheme, options?: { allowStaleRoot?: boolean; themes?: Record<string, AssetTheme> }): GeneratedManifest;
export function assertEntryCurrent(entry: GeneratedAssetEntry, asset: AssetDefinition, config: AssetConfig, theme: AssetTheme): void;
export function assertEntryMatches(entry: GeneratedAssetEntry, actual: GeneratedAssetEntry, id: string): void;
export function readGeneratedManifest(path?: string): Promise<GeneratedManifest>;
export function validateAssets(options?: { configPath?: string; manifestPath?: string; log?: (message: string) => void }): Promise<{ config: AssetConfig; theme: AssetTheme; manifest: GeneratedManifest; results: Record<string, AssetValidation> }>;
