/**
 * Smoothly scrolls an element into view only if it's partially or fully
 * outside its scroll container. Does nothing when the element is already
 * fully visible (within a small tolerance for sub-pixel rounding).
 *
 * @param element      The element to scroll into view
 * @param container    The scrollable ancestor. When omitted the function
 *                     walks up to the nearest `.canvas-scroll-container`.
 * @param tolerance    Pixel tolerance for the "fully visible" check (default 2)
 */
export function scrollIntoViewIfNeeded(
  element: HTMLElement,
  container?: HTMLElement | null,
  tolerance = 2,
): void {
  const scrollParent =
    container ?? (element.closest('.canvas-scroll-container') as HTMLElement);
  if (!scrollParent) return;

  const elRect = element.getBoundingClientRect();
  const cRect = scrollParent.getBoundingClientRect();

  const fullyVisible =
    elRect.left >= cRect.left - tolerance &&
    elRect.right <= cRect.right + tolerance &&
    elRect.top >= cRect.top - tolerance &&
    elRect.bottom <= cRect.bottom + tolerance;

  if (!fullyVisible) {
    // Horizontal `center` gives the "smooth pan the focused clip into
    // view" feel the sighted keyboard flow expects — Tab across the
    // timeline glides the current clip toward the middle instead of
    // stopping the moment its edge crosses the viewport. Vertical
    // stays `nearest` so a Tab into a same-row clip doesn't
    // gratuitously scroll the tracks.
    //
    // The earlier `inline: 'nearest'` was chosen for VoiceOver's
    // benefit (VO snapshots the focus rect the instant focus lands,
    // before the smooth scroll settles). Sighted keyboard use
    // dominates here, so we prioritise the visual pan and accept a
    // brief VO frame lag.
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
}
