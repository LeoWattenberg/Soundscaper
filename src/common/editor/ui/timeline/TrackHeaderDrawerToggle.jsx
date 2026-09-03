/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The compact layout's handle for the track-header drawer. It lives in the
 * sticky ruler corner, so it never scrolls away; the corner widens to the
 * header width while the drawer is open and shows its usual content there.
 */
export function TrackHeaderDrawerToggle({ copy, drawer }) {
	return (
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
	);
}
