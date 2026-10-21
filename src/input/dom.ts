/** Settings, menus and native controls keep their browser interactions. */
export function isInputControl(target: EventTarget | null, gestures = false): boolean {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return false;
  if (typeof HTMLElement !== 'undefined' && target instanceof HTMLElement && target.isContentEditable) return true;
  const controls = 'input,textarea,select,button,a,[role="button"],[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"],[data-no-gesture],.settings-panel,dialog[open]';
  return Boolean(target.closest(gestures ? `${controls},.run-menu,.settings-panel,[data-input-ui]` : controls));
}
