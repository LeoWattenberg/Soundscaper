/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback } from 'react';

const TRACK_HEADER_DRAWER_SELECTOR = [
	'[data-track-header]',
	'[data-output-track-header]',
	'.audio-editor-track-folder-row__panel',
	'[data-track-header-drawer-strip]',
].join(', ');

/** Whether an event target lies inside the open track-header drawer or its handle. */
export function isWithinTrackHeaderDrawer(target) {
	return Boolean(target && typeof target.closest === 'function' && target.closest(TRACK_HEADER_DRAWER_SELECTOR));
}

/**
 * Dismissal for the compact layout's track-header drawer. A pointer that goes
 * down on the lanes while the drawer is open closes it and is swallowed, so
 * the tap that dismisses the headers never also moves the selection; Escape
 * inside a header closes it unless a control (such as the name editor)
 * already handled the key.
 */
export function useTrackHeaderDrawerDismissal({ drawer, onPointerDown }) {
	const onPointerDownCapture = useCallback((event) => {
		if (drawer?.isOpen && !isWithinTrackHeaderDrawer(event.target)) {
			event.preventDefault();
			event.stopPropagation();
			drawer.close();
			return;
		}
		onPointerDown(event);
	}, [drawer, onPointerDown]);
	const onKeyDown = useCallback((event) => {
		if (!drawer?.isOpen || event.key !== 'Escape' || event.defaultPrevented) return;
		if (!isWithinTrackHeaderDrawer(event.target)) return;
		event.preventDefault();
		drawer.close();
	}, [drawer]);
	return { onPointerDownCapture, onKeyDown };
}
