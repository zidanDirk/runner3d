import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Action, Status } from '../../src/game/types';
import { GestureRecognizer } from '../../src/input/GestureRecognizer';
import { InputController } from '../../src/input/InputController';
import type { InputMode } from '../../src/input/InputController';
import { INPUT_MODE_KEY, InputPreferences } from '../../src/input/preferences';
import { isInputControl } from '../../src/input/dom';
import { attachKeyboard } from '../../src/runtime/keyboard';
import { game } from '../../src/runtime/store';

afterEach(() => { vi.unstubAllGlobals(); game.prepare('RUNNER-01'); });
const p = (x: number, y: number, time = 100, id = 1) => ({ id, x, y, time });

describe('unified input intentions', () => {
  function setup() {
    let status: Status = 'running';
    let mode: InputMode = 'both';
    const dispatch = vi.fn<(action: Action) => void>();
    const togglePause = vi.fn(() => { status = status === 'running' ? 'paused' : 'running'; });
    const controller = new InputController({ get status() { return status; }, dispatch, togglePause }, () => mode);
    return { controller, dispatch, togglePause, status: (value: Status) => { status = value; }, mode: (value: InputMode) => { mode = value; } };
  }

  it('maps all input sources to the same existing actions, without its own movement state', () => {
    const { controller, dispatch } = setup();
    controller.send('left', 'keyboard'); controller.send('right', 'gesture');
    controller.send('jump', 'button'); controller.send('slide');
    expect(dispatch.mock.calls.flat()).toEqual(['left', 'right', 'jump', 'slide']);
  });

  it('gates movement in ready, pause and game over, while allowing explicit pause/resume', () => {
    const setupInput = setup();
    const cleared = vi.fn(); setupInput.controller.onClear(cleared);
    for (const status of ['ready', 'paused', 'over'] as const) {
      setupInput.status(status);
      expect(setupInput.controller.send('jump', 'gesture')).toBe(false);
    }
    expect(setupInput.dispatch).not.toHaveBeenCalled();
    expect(setupInput.controller.send('pause')).toBe(false);
    setupInput.status('running');
    expect(setupInput.controller.send('pause', 'keyboard')).toBe(true);
    expect(setupInput.controller.send('left', 'keyboard')).toBe(false);
    expect(setupInput.controller.send('pause', 'button')).toBe(true);
    expect(setupInput.togglePause).toHaveBeenCalledTimes(2);
    expect(cleared).toHaveBeenCalledTimes(2);
  });

  it('honors mode changes for touch adapters while keeping keyboard and pause available', () => {
    const { controller, mode, dispatch } = setup();
    mode('buttons');
    expect(controller.send('left', 'gesture')).toBe(false);
    expect(controller.send('left', 'button')).toBe(true);
    mode('gestures');
    expect(controller.send('right', 'button')).toBe(false);
    expect(controller.send('right', 'gesture')).toBe(true);
    expect(controller.send('jump', 'keyboard')).toBe(true);
    expect(controller.send('pause', 'button')).toBe(true);
    expect(dispatch.mock.calls.flat()).toEqual(['left', 'right', 'jump']);
  });

  it('clears adapter state and removes clear subscriptions', () => {
    const { controller } = setup();
    const clear = vi.fn(); const detach = controller.onClear(clear);
    controller.clear(); detach(); controller.clear();
    expect(clear).toHaveBeenCalledTimes(1);
  });
});

describe('pointer gesture recognition', () => {
  it.each([
    [-70, 2, 'left'], [70, -3, 'right'], [2, -70, 'jump'], [-3, 70, 'slide'],
  ] as const)('recognizes a quick dominant-axis swipe (%i,%i) as %s only once', (x, y, action) => {
    const gesture = new GestureRecognizer();
    expect(gesture.down(p(0, 0))).toBe(true);
    expect(gesture.move(p(x, y, 110))).toBe(action);
    expect(gesture.move(p(-x * 3, -y * 3, 130))).toBeUndefined();
    gesture.up(1);
    expect(gesture.move(p(x * 4, y * 4, 140))).toBeUndefined();
  });

  it('ignores taps and small movement, and resolves ambiguous diagonals only after intent becomes clear', () => {
    const gesture = new GestureRecognizer(); gesture.down(p(0, 0));
    expect(gesture.move(p(30, 2))).toBeUndefined();
    expect(gesture.move(p(50, 50))).toBeUndefined();
    expect(gesture.move(p(58, 50))).toBeUndefined();
    expect(gesture.move(p(68, 50))).toBe('right');
  });

  it('expires a slow drag instead of triggering later and accepts a fresh contact', () => {
    const gesture = new GestureRecognizer(); gesture.down(p(0, 0));
    expect(gesture.move(p(10, 0, 760))).toBeUndefined();
    expect(gesture.move(p(100, 0, 761))).toBeUndefined();
    gesture.up(1); gesture.down(p(100, 0, 800));
    expect(gesture.move(p(0, 0, 820))).toBe('left');
  });

  it('handles repeated left/right contacts and rapid reversals as one action per contact', () => {
    const gesture = new GestureRecognizer(); const actions: Array<Action | undefined> = [];
    for (const x of [-70, -70, 70, 70, -70]) {
      gesture.down(p(0, 0)); actions.push(gesture.move(p(x, 0, 120))); gesture.up(1);
    }
    expect(actions).toEqual(['left', 'left', 'right', 'right', 'left']);
  });

  it('cancels multi-finger gestures until every contact has left', () => {
    const gesture = new GestureRecognizer(); gesture.down(p(0, 0));
    expect(gesture.down(p(0, 0, 110, 2))).toBe(false);
    expect(gesture.move(p(-100, 0, 120))).toBeUndefined();
    gesture.up(2);
    expect(gesture.move(p(-120, 0, 130))).toBeUndefined();
    expect(gesture.down(p(0, 0, 140, 3))).toBe(false);
    gesture.up(1); gesture.up(3);
    gesture.down(p(0, 0, 150, 4));
    expect(gesture.move(p(100, 0, 160, 4))).toBe('right');
  });

  it('does not transform an ineligible menu contact into a later gesture', () => {
    const gesture = new GestureRecognizer();
    expect(gesture.down(p(0, 0), false)).toBe(false);
    expect(gesture.move(p(-100, 0, 120))).toBeUndefined();
    gesture.up(1); gesture.down(p(0, 0)); gesture.clear();
    expect(gesture.move(p(100, 0, 130))).toBeUndefined();
    gesture.down(p(0, 0, 150)); expect(gesture.move(p(0, 100, 170))).toBe('slide');
  });

  it('rejects invalid timing and nonfinite coordinates', () => {
    const gesture = new GestureRecognizer(); gesture.down(p(0, 0));
    expect(gesture.move(p(Infinity, 0, 110))).toBeUndefined();
    expect(gesture.move(p(100, 0, 90))).toBeUndefined();
    expect(gesture.move(p(100, 0, 120))).toBeUndefined();
  });
});

describe('input settings and keyboard compatibility', () => {
  it('stores a stable snapshot and only publishes meaningful preference changes', () => {
    const values = new Map<string, string>([[INPUT_MODE_KEY, 'gestures']]);
    const preferences = new InputPreferences({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } });
    const snapshot = preferences.getSnapshot(); const changed = vi.fn(); const detach = preferences.subscribe(changed);
    expect(snapshot.mode).toBe('gestures'); expect(preferences.getSnapshot()).toBe(snapshot);
    preferences.setMode('gestures'); expect(changed).not.toHaveBeenCalled();
    preferences.setMode('buttons'); expect(changed).toHaveBeenCalledTimes(1);
    expect(values.get(INPUT_MODE_KEY)).toBe('buttons');
    detach(); preferences.setMode('both'); expect(changed).toHaveBeenCalledTimes(1);
  });

  it('uses both controls when storage is missing, invalid or throws', () => {
    expect(new InputPreferences().getSnapshot().mode).toBe('both');
    expect(new InputPreferences({ getItem: () => 'invalid', setItem: () => {} }).getSnapshot().mode).toBe('both');
    const preferences = new InputPreferences({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } });
    expect(preferences.getSnapshot().mode).toBe('both');
    expect(() => preferences.setMode('gestures')).not.toThrow(); expect(preferences.getSnapshot().mode).toBe('gestures');
  });

  it('filters native controls, inherited editable content, menus and settings without blocking the game region', () => {
    class ElementTarget extends EventTarget { constructor(private readonly matches: string[]) { super(); } closest(selector: string) { return this.matches.some((match) => selector.includes(match)) ? this : null; } }
    vi.stubGlobal('Element', ElementTarget);
    expect(isInputControl(new ElementTarget(['input']))).toBe(true);
    expect(isInputControl(new ElementTarget(['contenteditable']))).toBe(true);
    expect(isInputControl(new ElementTarget(['.run-menu']), true)).toBe(true);
    expect(isInputControl(new ElementTarget(['.settings-panel']), true)).toBe(true);
    expect(isInputControl(new ElementTarget([]), true)).toBe(false);
  });

  it('keeps keyboard mappings, repeat suppression, focus protection and cleanup', () => {
    const target = new EventTarget(); vi.stubGlobal('window', target);
    class Control extends EventTarget { closest() { return this; } }
    vi.stubGlobal('Element', Control);
    const detach = attachKeyboard(); game.start();
    const key = (code: string, repeat = false) => {
      const event = new Event('keydown', { cancelable: true });
      Object.defineProperties(event, { code: { value: code }, repeat: { value: repeat } });
      target.dispatchEvent(event); return event;
    };
    expect(key('KeyA', true).defaultPrevented).toBe(true);
    game.advance(1 / 120); expect(game.view.player.lane).toBe(1);
    key('KeyA'); game.advance(1 / 120); expect(game.view.player.lane).toBe(0);
    key('ArrowRight'); game.advance(1 / 120); expect(game.view.player.lane).toBe(1);
    key('Space'); game.advance(1 / 120); expect(game.view.player.y).toBeGreaterThan(0);
    key('Escape'); expect(game.view.status).toBe('paused');
    key('Escape', true); expect(game.view.status).toBe('paused');
    key('Escape'); expect(game.view.status).toBe('running');
    const focused = new Event('keydown', { cancelable: true }); Object.defineProperties(focused, { code: { value: 'KeyD' }, target: { value: new Control() } });
    target.dispatchEvent(focused); game.advance(1 / 120); expect(game.view.player.lane).toBe(1);
    detach(); key('KeyA'); game.advance(1 / 120); expect(game.view.player.lane).toBe(1);
  });
});
