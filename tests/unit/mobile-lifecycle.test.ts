import { afterEach, describe, expect, it, vi } from 'vitest';
import { GameStore, game, startLoop } from '../../src/runtime/store';
import { attachPageLifecycle } from '../../src/runtime/page-lifecycle';
import type { PageLifecycleDependencies } from '../../src/runtime/page-lifecycle';

afterEach(() => { vi.unstubAllGlobals(); game.prepare('RUNNER-01'); });

describe('mobile page lifecycle', () => {
  function setup() {
    const page = new EventTarget();
    const document = Object.assign(new EventTarget(), { hidden: false });
    const store = new GameStore(); store.start(); store.advance(.1);
    const clear = vi.fn(); const setPaused = vi.fn();
    const dependencies: PageLifecycleDependencies = { window: page, document, game: store, input: { clear }, audio: { setPaused } };
    return { page, document, store, clear, setPaused, dependencies };
  }

  it.each(['blur', 'pagehide', 'pageshow'])('%s pauses without recreating the engine or resuming automatically', (name) => {
    const { page, store, clear, setPaused, dependencies } = setup();
    const view = store.view; const tick = view.tick; const detach = attachPageLifecycle(dependencies);
    page.dispatchEvent(new Event(name));
    expect(store.view).toBe(view); expect(store.view.status).toBe('paused');
    expect(clear).toHaveBeenCalledTimes(1); expect(setPaused).toHaveBeenLastCalledWith(true);
    store.advance(1000); expect(store.view.tick).toBe(tick);
    page.dispatchEvent(new Event('pageshow')); expect(store.view.status).toBe('paused');
    store.resume(); store.advance(1 / 120); expect(store.view.tick).toBe(tick + 1);
    detach();
  });

  it('clears queued commands on hidden and requires explicit resume on visible', () => {
    const { document, store, dependencies, setPaused } = setup(); const detach = attachPageLifecycle(dependencies);
    store.dispatch('left'); document.hidden = true; document.dispatchEvent(new Event('visibilitychange'));
    expect(store.view.status).toBe('paused');
    document.hidden = false; document.dispatchEvent(new Event('visibilitychange'));
    expect(store.view.status).toBe('paused'); expect(setPaused).toHaveBeenCalledTimes(1);
    store.resume(); store.advance(1 / 120); expect(store.view.player.lane).toBe(1);
    detach();
  });

  it('handles mounting while hidden and cleans every listener across StrictMode remounts', () => {
    const setupPage = setup(); setupPage.document.hidden = true;
    const detach = attachPageLifecycle(setupPage.dependencies);
    expect(setupPage.store.view.status).toBe('paused'); detach();
    setupPage.store.resume(); setupPage.page.dispatchEvent(new Event('pagehide'));
    expect(setupPage.store.view.status).toBe('running');
    setupPage.document.hidden = false;
    const detachAgain = attachPageLifecycle(setupPage.dependencies); const calls = setupPage.clear.mock.calls.length;
    setupPage.page.dispatchEvent(new Event('pagehide')); expect(setupPage.clear).toHaveBeenCalledTimes(calls + 1);
    detachAgain(); setupPage.store.resume();
    setupPage.document.hidden = true; setupPage.document.dispatchEvent(new Event('visibilitychange'));
    setupPage.page.dispatchEvent(new Event('blur')); setupPage.page.dispatchEvent(new Event('pageshow'));
    expect(setupPage.store.view.status).toBe('running');
  });
});

describe('RAF timing epochs', () => {
  function raf() {
    let sequence = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++sequence, callback); return sequence; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { callbacks.delete(id); });
    return {
      next: (time: number) => {
        const entry = callbacks.entries().next().value;
        if (!entry) throw new Error('No pending animation frame');
        callbacks.delete(entry[0]); entry[1](time);
      },
      pending: () => callbacks.size,
    };
  }

  it('discards a sleep-to-resume gap from simulation and feedback on the first frame', () => {
    const frame = raf(); const afterFrame = vi.fn(); game.restart(); const stop = startLoop(afterFrame);
    frame.next(0); frame.next(1000 / 60); expect(game.view.tick).toBe(2);
    game.pause(); const tick = game.view.tick;
    // Backgrounded browser did not deliver a RAF for a minute. User resumes before next RAF.
    game.resume(); frame.next(60000);
    expect(game.view.tick).toBe(tick); expect(afterFrame).toHaveBeenLastCalledWith(0);
    frame.next(60000 + 1000 / 60); expect(game.view.tick).toBe(tick + 2);
    stop(); expect(frame.pending()).toBe(0);
  });

  it('resets first-frame timing on restart, prepare/start and frozen capture release', () => {
    const frame = raf(); let advancing = true; game.restart(); const stop = startLoop(undefined, () => advancing);
    frame.next(0); frame.next(20); expect(game.view.tick).toBe(2);
    game.restart(); frame.next(10000); expect(game.view.tick).toBe(0);
    frame.next(10020); expect(game.view.tick).toBe(2);
    game.prepare('new'); game.start(); frame.next(20000); expect(game.view.tick).toBe(0);
    advancing = false; frame.next(20020); frame.next(30000);
    advancing = true; frame.next(40000); expect(game.view.tick).toBe(0);
    frame.next(40020); expect(game.view.tick).toBe(2);
    stop();
  });

  it('does not carry fractional fixed-step accumulation through pause or restart', () => {
    const store = new GameStore(); store.start(); store.advance(1 / 240);
    store.pause(); store.resume(); store.advance(1 / 240); expect(store.view.tick).toBe(0);
    store.advance(1 / 240); expect(store.view.tick).toBe(1);
    store.restart(); store.advance(1 / 240); expect(store.view.tick).toBe(0);
  });
});
