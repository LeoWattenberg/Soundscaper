/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The compact layout's handle for the track-header drawer. It sits over the
 * top-left corner of the timeline, outside the scroll container, so it never
 * scrolls away; while the drawer is open it widens to the header width and
 * hosts the ruler-corner content (the Tracks label and Add track).
 */
export function TrackHeaderDrawerStrip({ children, copy, drawer, height, width }) {
	return (
		<div
			className="audio-editor-track-header-drawer-strip"
			data-track-header-drawer-strip
			data-open={drawer.isOpen ? 'true' : 'false'}
			style={{ height, width: drawer.isOpen ? width : undefined }}
		>
			<button
				type="button"
				className="audio-editor-track-header-toggle"
				data-track-header-toggle
				aria-expanded={drawer.isOpen}
				aria-label={drawer.isOpen ? copy.trackHeadersHide : copy.trackHeadersShow}
				onClick={() => drawer.toggle()}
			>
				<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
					<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
					<path d="M6 2.5v11" />
				</svg>
			</button>
			{drawer.isOpen && <div className="audio-editor-track-header-drawer-strip__content">{children}</div>}
		</div>
	);
}
