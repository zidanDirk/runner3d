import type { Object3D } from 'three';
import type { AssetContract } from './config.mjs';
import type { CharacterPart, CharacterValidation, GeneratedAssetEntry } from './validate.mjs';
export function validateCharacterStructure(json: Record<string, unknown>, contract: AssetContract): void;
export function validateCharacterLoaded(scene: Object3D, contract: AssetContract): Pick<CharacterValidation, 'joints' | 'parts'>;
export function validateCharacterAnatomy(parts: Record<string, CharacterPart>, joints: Record<string, number[]>, contract: AssetContract): void;
export function validateCharacterManifest(entry: GeneratedAssetEntry, contract: AssetContract): void;
