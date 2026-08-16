/**
 * Global input-mode tracking.
 *
 * Distinguishes "the user is driving with a pointer" from "the user is
 * driving with the keyboard" so focus-style decisions (e.g. track
 * container-focus bars: blue for mouse, black/white for keyboard) can
 * stay consistent across whichever event eventually sets focus.
 *
 * Mode transitions:
 *   - Mouse down → 'mouse'.
 *   - Tab key down → 'keyboard'.
 *   - Escape → 'mouse' (the user has exited keyboard nav; subsequent
 *     arrow navigation should show the relaxed blue outline, not the
 *     keyboard Tab bars, until the next Tab re-enters keyboard mode).
 *   - Arrow / Home / End — inherit whichever mode was last established.
 *
 * Listeners are installed once on first import.
 */

let mode: 'mouse' | 'keyboard' = 'keyboard';
let installed = false;

const ensureInstalled = () => {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('mousedown', () => {
    mode = 'mouse';
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      mode = 'keyboard';
    } else if (e.key === 'Escape') {
      mode = 'mouse';
    }
  }, true);
};

ensureInstalled();

export function getInputMode(): 'mouse' | 'keyboard' {
  return mode;
}
