import { forwardRef, useEffect } from 'react';

import { retainEditorFocusHistory } from './focus-restoration.ts';

/**
 * Editor overlay tiers mirrored by audio-editor-design-system.css. Keeping the
 * names here gives portal owners a stable vocabulary without coupling them to
 * individual menu/dialog implementations.
 */
export const EDITOR_OVERLAY_Z_INDEX_TIERS = Object.freeze({
	editorSurface: 9_999,
	flyout: 10_020,
	effects: 10_030,
} as const);

/** Stable portal target for timeline menus and other editor-scoped overlays. */
const EditorOverlayHost = forwardRef<HTMLDivElement>(function EditorOverlayHost(_props, ref) {
	useEffect(() => retainEditorFocusHistory(document), []);
	return (
		<div
			ref={ref}
			className="kw-audio-editor__overlay-layer"
			data-editor-overlay-layer
		/>
	);
});

export default EditorOverlayHost;
