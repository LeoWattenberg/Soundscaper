export interface ContextSubmenuAnchorRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
}

export interface ContextSubmenuSize {
  readonly height: number;
  readonly width: number;
}

export interface ContextSubmenuViewport {
  readonly height: number;
  readonly width: number;
}

export interface ContextSubmenuPosition {
  readonly left: number;
  readonly top: number;
}

const VIEWPORT_MARGIN = 10;

/** Position a fixed submenu beside its live row without crossing the viewport. */
export function contextSubmenuPosition(
  anchor: ContextSubmenuAnchorRect,
  submenu: ContextSubmenuSize,
  viewport: ContextSubmenuViewport,
): ContextSubmenuPosition {
  const maximumLeft = Math.max(VIEWPORT_MARGIN, viewport.width - VIEWPORT_MARGIN - submenu.width);
  const opensRight = anchor.right + submenu.width <= viewport.width - VIEWPORT_MARGIN;
  const preferredLeft = opensRight ? anchor.right : anchor.left - submenu.width;
  const left = Math.min(maximumLeft, Math.max(VIEWPORT_MARGIN, preferredLeft));
  const maximumTop = Math.max(VIEWPORT_MARGIN, viewport.height - VIEWPORT_MARGIN - submenu.height);
  const top = Math.min(maximumTop, Math.max(VIEWPORT_MARGIN, anchor.top));
  return { left, top };
}
