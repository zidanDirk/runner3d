import { useSyncExternalStore } from 'react';
import type { InputMode } from './InputController';

export const INPUT_MODE_KEY = 'runner3d-input-mode-v1';
export interface InputSettings { readonly mode: InputMode }
export interface PreferenceStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }
const DEFAULT_SETTINGS: InputSettings = { mode: 'both' };

function isInputMode(value: unknown): value is InputMode { return value === 'gestures' || value === 'buttons' || value === 'both'; }

export class InputPreferences {
  private settings: InputSettings = DEFAULT_SETTINGS;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly storage?: PreferenceStorage) {
    try {
      const mode = storage?.getItem(INPUT_MODE_KEY);
      if (isInputMode(mode)) this.settings = { mode };
    } catch { /* Persistence is optional. */ }
  }
  getSnapshot = (): InputSettings => this.settings;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  setMode(mode: InputMode): void {
    if (!isInputMode(mode) || mode === this.settings.mode) return;
    this.settings = { mode };
    try { this.storage?.setItem(INPUT_MODE_KEY, mode); } catch { /* Keep the in-session preference. */ }
    for (const listener of this.listeners) listener();
  }
}

function browserStorage(): PreferenceStorage | undefined { try { return localStorage; } catch { return undefined; } }
export const inputPreferences = new InputPreferences(browserStorage());
export const useInputMode = (): InputMode => useSyncExternalStore(inputPreferences.subscribe, inputPreferences.getSnapshot, () => DEFAULT_SETTINGS).mode;
