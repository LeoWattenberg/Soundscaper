/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useMediaQuery } from '../workspace-runtime.js';

// Below this width the desktop chrome (menubar, action bar, tool toolbar) and
// the track-header column move into drawers unless the layout preference says
// otherwise. Phones and portrait tablets sit under it; a ten-inch tablet in
// landscape sits above it and keeps the desktop layout.
export const COMPACT_LAYOUT_VIEWPORT_QUERY = '(max-width: 900px)';
export const COMPACT_PROJECT_BIN_VIEWPORT_QUERY = '(max-width: 520px)';

/**
 * @param {'auto'|'compact'|'desktop'|undefined} layoutPreference
 * @param {boolean} narrowViewport
 * @returns {'compact'|'desktop'}
 */
export function resolveWorkspaceLayoutMode(layoutPreference, narrowViewport) {
	if (layoutPreference === 'compact') return 'compact';
	if (layoutPreference === 'desktop') return 'desktop';
	return narrowViewport ? 'compact' : 'desktop';
}

/**
 * Decides between the desktop and the compact (drawer) layout and owns the
 * transient open state of the chrome drawer. The drawer is session state, not
 * a preference: it closes whenever the layout stops being compact so a window
 * resized back to desktop width never keeps an invisible open drawer.
 *
 * @param {{layoutPreference?: 'auto'|'compact'|'desktop'}} [options]
 */
export function useWorkspaceCompactLayout({ layoutPreference = 'auto' } = {}) {
	const isCompact = useMediaQuery(COMPACT_LAYOUT_VIEWPORT_QUERY);
	const isProjectBinCompact = useMediaQuery(COMPACT_PROJECT_BIN_VIEWPORT_QUERY);
	const compactLayout = resolveWorkspaceLayoutMode(layoutPreference, isCompact) === 'compact';
	const [chromeDrawerOpen, setChromeDrawerOpen] = useState(false);
	useEffect(() => {
		if (!compactLayout) setChromeDrawerOpen(false);
	}, [compactLayout]);
	const open = useCallback(() => setChromeDrawerOpen(true), []);
	const close = useCallback(() => setChromeDrawerOpen(false), []);
	const toggle = useCallback(() => setChromeDrawerOpen((current) => !current), []);
	const chromeDrawer = useMemo(() => ({
		isOpen: compactLayout && chromeDrawerOpen,
		open,
		close,
		toggle,
	}), [chromeDrawerOpen, close, compactLayout, open, toggle]);
	return { chromeDrawer, compactLayout, isCompact, isProjectBinCompact };
}
