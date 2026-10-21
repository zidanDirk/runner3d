import { describe, expect, it } from 'vitest';
import { InputController } from '../../src/input/InputController';

describe('product menu input isolation', () => {
  it('blocks every gameplay source and resume while keeping hardware availability independent', () => {
    const commands: string[] = [];
    const input = new InputController({ status: 'running', dispatch: action => commands.push(action), togglePause: () => commands.push('pause') });
    input.setMenuBlocked(true);
    for (const source of ['keyboard', 'gesture', 'button'] as const) {
      expect(input.send('left', source)).toBe(false);
      expect(input.send('pause', source)).toBe(false);
    }
    expect(commands).toEqual([]);
    expect(input.isBlocked).toBe(false);
    input.setBlocked(true); input.setMenuBlocked(false);
    expect(input.send('jump')).toBe(false);
    expect(input.isBlocked).toBe(true);
    input.setBlocked(false);
    expect(input.send('jump')).toBe(true);
    expect(commands).toEqual(['jump']);
  });
  it('clears pending adapter gestures whenever a menu opens or closes', () => {
    let clears = 0;
    const input = new InputController({ status: 'paused', dispatch() {}, togglePause() {} });
    const detach = input.onClear(() => clears++);
    input.setMenuBlocked(true); input.setMenuBlocked(false);
    expect(clears).toBe(2);
    detach(); input.setMenuBlocked(true);
    expect(clears).toBe(2);
  });
});
