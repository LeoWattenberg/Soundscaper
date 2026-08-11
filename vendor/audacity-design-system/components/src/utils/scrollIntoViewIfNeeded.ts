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
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
}
