import { describe, expect, it, vi } from 'vitest';
import { LEGACY_BEST_KEY, PROFILE_KEY, ProfileController } from '../../src/progression';
import type { ProfileStorage } from '../../src/progression';
import { DEFAULT_PRODUCT_PREFERENCES, PRODUCT_PREFERENCES_KEY, ProductPreferencesStore, parseProductPreferences } from '../../src/product/preferences';

class Storage implements ProfileStorage {
  readonly values = new Map<string, string>();
  writes = 0;
  failRead = false;
  failWrite = false;
  getItem(key: string): string | null {
    if (this.failRead) throw new Error('Unavailable');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrite) throw new Error('Quota');
    this.writes++;
    this.values.set(key, value);
  }
}

describe('isolated tutorial and free appearance preferences', () => {
  it('defaults to an unseen tutorial and the real original skin without writing storage', () => {
    const storage = new Storage();
    const preferences = new ProductPreferencesStore(storage);
    expect(preferences.snapshot).toBe(DEFAULT_PRODUCT_PREFERENCES);
    expect(preferences.snapshot).toEqual({ schemaVersion: 1, tutorial: 'unseen', skinId: 'original-orange' });
    expect(preferences.recovered).toBe(false);
    expect(preferences.flush()).toBe(true);
    expect(storage.writes).toBe(0);
  });

  it.each(['done', 'skipped'] as const)('persists %s onboarding without showing it again after reload', (tutorial) => {
    const storage = new Storage();
    const preferences = new ProductPreferencesStore(storage);
    expect(preferences.setTutorial(tutorial)).toBe(true);
    const reopened = new ProductPreferencesStore(storage);
    expect(reopened.snapshot.tutorial).toBe(tutorial);
    expect(reopened.recovered).toBe(false);
  });

  it.each(['original-orange', 'neon-cyan', 'midnight-violet'] as const)('retains the selected %s appearance independently of gameplay stats', (skinId) => {
    const storage = new Storage();
    storage.values.set('runner3d-audio-v1', '{"muted":true}');
    storage.values.set('runner3d-quality-v1', 'low');
    const preferences = new ProductPreferencesStore(storage);
    preferences.setSkin(skinId);
    expect(new ProductPreferencesStore(storage).snapshot.skinId).toBe(skinId);
    expect(storage.values.get('runner3d-audio-v1')).toBe('{"muted":true}');
    expect(storage.values.get('runner3d-quality-v1')).toBe('low');
    expect(storage.values.has(PROFILE_KEY)).toBe(false);
  });

  it('publishes one stable immutable snapshot per change and cleans up subscribers', () => {
    const preferences = new ProductPreferencesStore();
    const listener = vi.fn();
    const unsubscribe = preferences.subscribe(listener);
    const old = preferences.getSnapshot();
    preferences.setSkin('neon-cyan');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(preferences.getSnapshot()).toBe(preferences.getSnapshot());
    expect(preferences.snapshot).not.toBe(old);
    expect(Object.isFrozen(preferences.snapshot)).toBe(true);
    expect(old.skinId).toBe('original-orange');
    preferences.setSkin('neon-cyan');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    preferences.setTutorial('done');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each(['not-json', '{', 'null', '[]', '{"schemaVersion":1,"tutorial":"done","skinId":"missing"}', '{"schemaVersion":1,"tutorial":"done","skinId":"original-orange","wallet":99}'])('recovers invalid optional data %s', (raw) => {
    const storage = new Storage();
    storage.values.set(PRODUCT_PREFERENCES_KEY, raw);
    const preferences = new ProductPreferencesStore(storage);
    expect(preferences.snapshot).toBe(DEFAULT_PRODUCT_PREFERENCES);
    expect(preferences.recovered).toBe(true);
    preferences.setTutorial('done');
    expect(new ProductPreferencesStore(storage).snapshot.tutorial).toBe('done');
  });

  it('preserves future schemas while allowing valid session-only choices', () => {
    const storage = new Storage();
    const future = '{"schemaVersion":2,"tutorial":"done","skinId":"future-model","future":true}';
    storage.values.set(PRODUCT_PREFERENCES_KEY, future);
    const preferences = new ProductPreferencesStore(storage);
    preferences.setSkin('midnight-violet');
    preferences.setTutorial('skipped');
    expect(preferences.snapshot.skinId).toBe('midnight-violet');
    expect(preferences.unsupportedSchema).toBe(true);
    expect(preferences.persistenceFailed).toBe(true);
    expect(preferences.flush()).toBe(false);
    expect(storage.writes).toBe(0);
    expect(storage.values.get(PRODUCT_PREFERENCES_KEY)).toBe(future);
  });

  it('survives inaccessible storage and retries failed writes without losing the session choice', () => {
    const storage = new Storage(); storage.failRead = true; storage.failWrite = true;
    const preferences = new ProductPreferencesStore(storage);
    expect(() => preferences.setSkin('neon-cyan')).not.toThrow();
    expect(preferences.persistenceFailed).toBe(true);
    expect(preferences.snapshot.skinId).toBe('neon-cyan');
    storage.failRead = false; storage.failWrite = false;
    expect(preferences.flush()).toBe(true);
    expect(preferences.persistenceFailed).toBe(false);
    expect(new ProductPreferencesStore(storage).snapshot.skinId).toBe('neon-cyan');
  });

  it('never changes legacy record migration, the profile schema, or existing setting keys', () => {
    const storage = new Storage();
    storage.values.set(LEGACY_BEST_KEY, '8750');
    storage.values.set('runner3d-reduced-motion-v1', 'true');
    const profile = new ProfileController(storage); profile.flush();
    const oldProfile = storage.values.get(PROFILE_KEY);
    const preferences = new ProductPreferencesStore(storage);
    preferences.setSkin('neon-cyan'); preferences.setTutorial('done');
    expect(storage.values.get(PROFILE_KEY)).toBe(oldProfile);
    expect(new ProfileController(storage).snapshot.bestScore).toBe(8750);
    expect(storage.values.get('runner3d-reduced-motion-v1')).toBe('true');
  });

  it('rejects missing, incorrectly typed and unknown fields without partial salvage', () => {
    for (const value of [
      {}, { schemaVersion: 1, tutorial: 'done' }, { ...DEFAULT_PRODUCT_PREFERENCES, schemaVersion: '1' },
      { ...DEFAULT_PRODUCT_PREFERENCES, tutorial: true }, { ...DEFAULT_PRODUCT_PREFERENCES, skinId: null },
      { ...DEFAULT_PRODUCT_PREFERENCES, extra: 1 },
    ]) expect(parseProductPreferences(value)).toBeNull();
  });
});
