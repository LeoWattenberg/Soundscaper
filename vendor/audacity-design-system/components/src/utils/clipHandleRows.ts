/**
 * clipHandleRows — where a clip's TRIM and STRETCH handle rows sit, by
 * the real app's rule (ClipHandles.qml `handleHeight`, matched
 * 2026-10-07, "look in the real build to see how we handle clip handles
 * on collapsed clips"): each row is HALF the room — half the clip when
 * it is collapsed (its header hidden), half the clip under the header
 * otherwise — clamped between 22 and 32px; the trim row is on top (at
 * the clip's top when collapsed, under the 20px header otherwise) and
 * the stretch row directly beneath it. So a 44px collapsed clip gets two
 * 22px rows that split it exactly, a 60px collapsed clip two 30px rows,
 * a 72px clip two 26px rows under its header, and from 84px up the 32px
 * rows the Figma "hit zones" frame specifies. Before this the rows were FIXED at 20–52 and 52–84, so on
 * any clip under 84px the stretch row hung off the bottom and on a
 * collapsed clip both rows were off it.
 *
 * ONE function for every consumer: the handles in Clip (CSS variables on
 * the clip's root), TrackNew's buried-edge duplicates, the fade length
 * handle's box (it sits in the trim row) and the edge zones (the trim
 * row is their height). A second copy is how the rows drift apart.
 */

/** The clip header's height; the trim row starts under it */
export const CLIP_HEADER_HEIGHT = 20;
/** UNDER this height a clip is COLLAPSED — its header hidden until
 *  hovered, the handle rows from its top, no fade controls. The real
 *  app's TRACK_COLLAPSE_HEIGHT (projectviewstate.cpp), adopted
 *  2026-10-08 after a 46px track showed the problem with 44: between 45
 *  and 63px a clip kept its header but had no room for two 22px rows
 *  under it, so the stretch row hung below the clip and the fade
 *  handles crowded in ("responsive issue here"). From 72 up, (h − 20)/2
 *  is at least 26, and two rows always fit under the header. */
export const CLIP_COLLAPSE_HEIGHT = 72;
export const isClipCollapsed = (clipHeight: number) => clipHeight < CLIP_COLLAPSE_HEIGHT;
/** The rows' clamp — the real app's handleMinH / handleMaxH */
export const HANDLE_ROW_MIN = 22;
export const HANDLE_ROW_MAX = 32;

export interface ClipHandleRows {
  /** The clip is collapsed: header hidden, rows from the top */
  collapsed: boolean;
  /** The trim row's top, from the clip's top */
  trimTop: number;
  /** The stretch row's top — directly under the trim row */
  stretchTop: number;
  /** Both rows' height */
  rowHeight: number;
}

export function clipHandleRows(clipHeight: number): ClipHandleRows {
  const collapsed = isClipCollapsed(clipHeight);
  const room = collapsed ? clipHeight / 2 : (clipHeight - CLIP_HEADER_HEIGHT) / 2;
  const rowHeight = Math.min(HANDLE_ROW_MAX, Math.max(HANDLE_ROW_MIN, Math.round(room)));
  const trimTop = collapsed ? 0 : CLIP_HEADER_HEIGHT;
  return { collapsed, trimTop, stretchTop: trimTop + rowHeight, rowHeight };
}
