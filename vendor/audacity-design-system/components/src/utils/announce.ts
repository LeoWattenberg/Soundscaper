/**
 * Screen-reader announcer.
 *
 * Lazily mounts a single off-screen `aria-live="polite"` div on the
 * body and pushes status text into it. Used for non-DOM-focus events
 * — e.g. a keyboard trim shortcut changes the clip duration, but
 * VoiceOver doesn't automatically re-read the focused element's
 * `aria-label` on change, so we drive the announcement explicitly.
 *
 * Setting the same string twice in a row is a no-op for assistive
 * tech, so we clear-then-set on a microtask to coax a re-read.
 */

let announcerEl: HTMLDivElement | null = null;

function getEl(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  if (announcerEl) return announcerEl;
  const el = document.createElement('div');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.setAttribute('role', 'status');
  // Visually hidden but still in the accessibility tree.
  el.style.cssText = [
    'position:absolute',
    'width:1px',
    'height:1px',
    'padding:0',
    'margin:-1px',
    'overflow:hidden',
    'clip:rect(0,0,0,0)',
    'white-space:nowrap',
    'border:0',
  ].join(';');
  document.body.appendChild(el);
  announcerEl = el;
  return el;
}

export function announce(message: string): void {
  const el = getEl();
  if (!el) return;
  // Clear first so VoiceOver picks up the change even if the text is
  // identical to the previous announcement (back-to-back trims at the
  // same edge will produce identical strings sometimes).
  el.textContent = '';
  // requestAnimationFrame keeps the clear/set on the same paint and
  // avoids burning a real timer.
  requestAnimationFrame(() => {
    if (announcerEl) announcerEl.textContent = message;
  });
}

/**
 * Format a time in seconds for screen readers — full English words
 * rather than the "0:02.5" digits the visual timeline uses, since
 * VoiceOver reads colons as "colon" and decimal points as "point".
 *
 *   0      → "0 seconds"
 *   0.5    → "0.5 seconds"
 *   1      → "1 second"
 *   65     → "1 minute 5 seconds"
 *   3725   → "1 hour 2 minutes 5 seconds"
 */
export function formatTimeForA11y(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0 seconds';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rawSecs = seconds - hours * 3600 - minutes * 60;
  const rounded = Math.round(rawSecs * 10) / 10;
  const secs = rounded === Math.floor(rounded) ? `${Math.floor(rounded)}` : `${rounded}`;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  if (rounded > 0 || parts.length === 0) {
    parts.push(`${secs} ${rounded === 1 ? 'second' : 'seconds'}`);
  }
  return parts.join(' ');
}
