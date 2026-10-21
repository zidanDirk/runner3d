import type { Action } from '../game/types';
import { isInputControl } from '../input/dom';
import { input } from './input';
import { game } from './store';

const KEYS: Readonly<Record<string, Action>> = {
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  Space: 'jump', KeyS: 'slide', ArrowDown: 'slide',
};

export function attachKeyboard(): () => void {
  const down = (event: KeyboardEvent): void => {
    if (isInputControl(event.target) || (typeof document !== 'undefined' && document.querySelector('dialog[open]'))) return;
    if (event.code === 'Escape') {
      if (!event.repeat) input.send('pause', 'keyboard');
      return;
    }
    const action = KEYS[event.code];
    if (!action || game.view.status !== 'running') return;
    event.preventDefault();
    if (!event.repeat) input.send(action, 'keyboard');
  };
  window.addEventListener('keydown', down);
  return () => {
    window.removeEventListener('keydown', down);
  };
}
