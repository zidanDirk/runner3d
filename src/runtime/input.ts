import { GestureRecognizer } from '../input/GestureRecognizer';
import { InputController } from '../input/InputController';
import { isInputControl } from '../input/dom';
import { inputPreferences } from '../input/preferences';
import { game } from './store';

export { inputPreferences, useInputMode } from '../input/preferences';
export type { InputCommand, InputSource, InputMode } from '../input/InputController';

export const input = new InputController({
  get status() { return game.view.status; },
  dispatch: game.dispatch,
  togglePause: game.togglePause,
}, () => inputPreferences.getSnapshot().mode);

/** One Pointer Events adapter on the game region; it never cancels document scrolling. */
export function attachGestureInput(element: HTMLElement): () => void {
  const recognizer = new GestureRecognizer();
  const captured = new Set<number>();
  const point = (event: PointerEvent) => ({ id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp });
  const release = (id: number): void => {
    captured.delete(id);
    try { if (element.hasPointerCapture(id)) element.releasePointerCapture(id); } catch { /* Browser may already have released it. */ }
  };
  const clear = (): void => {
    recognizer.clear();
    for (const id of captured) release(id);
  };
  const down = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') return;
    const eligible = game.view.status === 'running' && inputPreferences.getSnapshot().mode !== 'buttons' && !isInputControl(event.target, true);
    const capture = recognizer.down(point(event), eligible);
    if (!capture) return;
    try { element.setPointerCapture(event.pointerId); captured.add(event.pointerId); } catch { /* A canceled pointer remains harmless without capture. */ }
  };
  const move = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse') return;
    const action = recognizer.move(point(event));
    if (action) input.send(action, 'gesture');
  };
  const up = (event: PointerEvent): void => { recognizer.up(event.pointerId); release(event.pointerId); };
  const cancel = (event: PointerEvent): void => { recognizer.up(event.pointerId); release(event.pointerId); };
  const lost = (event: PointerEvent): void => { captured.delete(event.pointerId); recognizer.up(event.pointerId); };
  const unsubscribeInput = input.onClear(clear);
  const unsubscribePreferences = inputPreferences.subscribe(clear);
  let observedView = game.view;
  let observedTick = observedView.tick;
  const unsubscribeGame = game.subscribe(() => {
    const view = game.view;
    if (view.status !== 'running' || view !== observedView || view.tick < observedTick) clear();
    observedView = view; observedTick = view.tick;
  });
  const options = { passive: true } as const;
  element.addEventListener('pointerdown', down, options);
  element.addEventListener('pointermove', move, options);
  element.addEventListener('pointerup', up, options);
  element.addEventListener('pointercancel', cancel, options);
  element.addEventListener('lostpointercapture', lost, options);
  return () => {
    unsubscribeInput(); unsubscribePreferences(); unsubscribeGame(); clear();
    element.removeEventListener('pointerdown', down);
    element.removeEventListener('pointermove', move);
    element.removeEventListener('pointerup', up);
    element.removeEventListener('pointercancel', cancel);
    element.removeEventListener('lostpointercapture', lost);
  };
}
