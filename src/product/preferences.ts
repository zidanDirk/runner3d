import { isSkinId } from '../character/appearance';
import type { SkinId } from '../character/appearance';
import type { ProfileStorage } from '../progression/types';

export { isSkinId } from '../character/appearance';
export type { SkinId } from '../character/appearance';

export const PRODUCT_PREFERENCES_KEY = 'runner3d-product-v1';
export type TutorialStatus = 'unseen' | 'done' | 'skipped';
export interface ProductPreferences {
  readonly schemaVersion: 1;
  readonly tutorial: TutorialStatus;
  readonly skinId: SkinId;
}

export const DEFAULT_PRODUCT_PREFERENCES: ProductPreferences = Object.freeze({
  schemaVersion: 1, tutorial: 'unseen', skinId: 'original-orange',
});

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTutorialStatus(value: unknown): value is TutorialStatus {
  return value === 'unseen' || value === 'done' || value === 'skipped';
}

/** A separate optional preference record leaves money, legacy profiles and settings intact. */
export function parseProductPreferences(value: unknown): ProductPreferences | null {
  if (!object(value) || Object.keys(value).length !== 3
    || !Object.hasOwn(value, 'schemaVersion') || !Object.hasOwn(value, 'tutorial') || !Object.hasOwn(value, 'skinId')
    || value.schemaVersion !== 1 || !isTutorialStatus(value.tutorial) || !isSkinId(value.skinId)) return null;
  return Object.freeze({ schemaVersion: 1, tutorial: value.tutorial, skinId: value.skinId });
}

/** Injectable storage, immutable stable snapshots, and no browser/React dependency. */
export class ProductPreferencesStore {
  private value = DEFAULT_PRODUCT_PREFERENCES;
  private readonly listeners = new Set<() => void>();
  private dirty = false;
  private storageFailed = false;
  readonly recovered: boolean;
  readonly unsupportedSchema: boolean;

  constructor(private readonly storage?: ProfileStorage) {
    let recovered = false;
    let unsupportedSchema = false;
    try {
      const raw = storage?.getItem(PRODUCT_PREFERENCES_KEY);
      if (raw !== null && raw !== undefined) {
        const parsed: unknown = JSON.parse(raw);
        unsupportedSchema = object(parsed) && typeof parsed.schemaVersion === 'number' && Number.isFinite(parsed.schemaVersion) && parsed.schemaVersion > 1;
        const valid = parseProductPreferences(parsed);
        if (valid === null) recovered = true;
        else this.value = valid;
      }
    } catch { recovered = true; this.storageFailed = true; }
    this.recovered = recovered;
    this.unsupportedSchema = unsupportedSchema;
    if (unsupportedSchema) this.storageFailed = true;
  }

  get snapshot(): ProductPreferences { return this.value; }
  getSnapshot = (): ProductPreferences => this.value;
  get persistenceFailed(): boolean { return this.storageFailed; }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  setSkin(skinId: SkinId): boolean {
    if (!isSkinId(skinId)) return false;
    if (skinId === this.value.skinId) return true;
    return this.replace({ ...this.value, skinId });
  }

  setTutorial(tutorial: TutorialStatus): boolean {
    if (!isTutorialStatus(tutorial)) return false;
    if (tutorial === this.value.tutorial) return true;
    return this.replace({ ...this.value, tutorial });
  }

  /** A newer application's preference file is never overwritten by a downgraded app. */
  flush(): boolean {
    if (this.unsupportedSchema) return false;
    if (!this.dirty) return !this.storageFailed;
    if (this.storage === undefined) return true;
    try {
      this.storage.setItem(PRODUCT_PREFERENCES_KEY, JSON.stringify(this.value));
      this.dirty = false;
      this.storageFailed = false;
      return true;
    } catch { this.storageFailed = true; return false; }
  }

  private replace(value: ProductPreferences): boolean {
    this.value = Object.freeze(value);
    this.dirty = true;
    this.flush();
    for (const listener of this.listeners) listener();
    // Session choice remains effective when persistence is unavailable.
    return true;
  }
}
