import type { Action, Status } from '../game/types';

export type InputCommand = Action | 'pause';
export type InputSource = 'keyboard' | 'gesture' | 'button';
export type InputMode = 'gestures' | 'buttons' | 'both';

export interface InputTarget {
  readonly status: Status;
  dispatch(action: Action): void;
  togglePause(): void;
}

/** Adapters submit intentions here; the existing engine remains the only rules owner. */
export class InputController {
  private blocked = false;
  private menuBlocked = false;
  private readonly clearListeners = new Set<() => void>();

  constructor(private readonly target: InputTarget, private readonly mode: () => InputMode = () => 'both') {}

  send(command: InputCommand, source: InputSource = 'button'): boolean {
    if (this.blocked || this.menuBlocked) return false;
    if (command === 'pause') {
      if (this.target.status !== 'running' && this.target.status !== 'paused') return false;
      this.clear();
      this.target.togglePause();
      return true;
    }
    if (this.target.status !== 'running') return false;
    const mode = this.mode();
    if ((source === 'gesture' && mode === 'buttons') || (source === 'button' && mode === 'gestures')) return false;
    this.target.dispatch(command);
    return true;
  }

  /** There are no held actions or deferred input timers. Adapters release their own pointers. */
  clear = (): void => { for (const listener of this.clearListeners) listener(); };
  setBlocked(value: boolean): void { this.blocked = value; this.clear(); }
  /** Menus stop gameplay intents without treating a trusted purchase as graphics loss. */
  setMenuBlocked(value: boolean): void { this.menuBlocked = value; this.clear(); }
  get isBlocked(): boolean { return this.blocked; }
  onClear(listener: () => void): () => void {
    this.clearListeners.add(listener);
    return () => { this.clearListeners.delete(listener); };
  }
}
