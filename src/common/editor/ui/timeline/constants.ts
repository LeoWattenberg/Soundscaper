export const DESKTOP_TRACK_PANEL_WIDTH = 268;
export const COMPACT_TRACK_PANEL_WIDTH = 164;
// The ruler corner's width while it is only the closed track-header drawer's handle.
export const TRACK_HEADER_DRAWER_HANDLE_WIDTH = 40;
export const AUTO_FIT_TRACK_HEIGHT = 300;
export const COLLAPSED_TRACK_HEIGHT = 54;
export const VERTICAL_RULER_WIDTH = 40;
export const SPECTROGRAM_RULER_WIDTH = 56;
// Mirrors the `.audio-editor-ruler-row` heights in the design system, including
// the taller row that hosts the timeline annotation lane.
export const TIMELINE_RULER_ROW_HEIGHT = 34;
export const TIMELINE_RULER_ROW_HEIGHT_WITH_ANNOTATIONS = 67;
export const CLIP_TRIM_EDGE_HIT_WIDTH = 6;
export const TRACK_HEADER_RESIZE_HIT_HEIGHT = 4;
export const NEW_AUDIO_TRACK_DROP_TARGET = '__new-audio-track__';
export const NEW_AUDIO_TRACK_DROP_ZONE_HEIGHT = 48;
export const EMPTY_TIMELINE_CLIPS = Object.freeze([]);

/**
 * The lane offset and the header element width. In the compact layout's
 * track-header drawer the lanes start at the left edge while the headers keep
 * their full desktop width and slide over the lanes when opened.
 */
export function resolveTrackPanelGeometry({ drawer, mobile }: { readonly drawer: boolean; readonly mobile: boolean }) {
	if (drawer) return { panelWidth: 0, trackHeaderWidth: DESKTOP_TRACK_PANEL_WIDTH };
	const columnWidth = mobile ? COMPACT_TRACK_PANEL_WIDTH : DESKTOP_TRACK_PANEL_WIDTH;
	return { panelWidth: columnWidth, trackHeaderWidth: columnWidth };
}
