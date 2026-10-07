/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect, useMemo } from 'react';

import { clipGroups, focusFirst, normalizeClipSemantics } from './timeline-navigation.js';
import { focusTrackRowNeighbor } from './track-row-neighbor-focus.ts';
import { createTimelineClipRemovalFocus } from './timeline-clip-removal-focus.ts';

export function createTrackRowFocusRouter({
	trackIndex,
	trackCount,
	hasTrackRuler,
	onFocusTimelineRuler,
	onFocusTrackContainer,
	onFocusTrackPanelControl,
	onFocusTrackClip,
	onFocusTrackRuler,
	onFocusSelectionToolbar,
	onExtendTrackSelection = /** @type {((index: number) => unknown) | null} */ (null),
}) {
	const focusAfterTrack = () => {
		return focusTrackRowNeighbor(trackIndex, trackCount, 1, onFocusTrackContainer)
			|| onFocusSelectionToolbar();
	};
	const focusBeforeTrack = () => {
		return focusTrackRowNeighbor(trackIndex, trackCount, -1, (previousTrack) => {
			if (hasTrackRuler && onFocusTrackRuler(previousTrack)) return true;
			if (onFocusTrackClip(previousTrack, true)) return true;
			if (onFocusTrackPanelControl(previousTrack, true)) return true;
			return onFocusTrackContainer(previousTrack);
		}) || onFocusTimelineRuler();
	};
	const focusAfterPanel = () => {
		if (onFocusTrackClip(trackIndex)) return true;
		if (hasTrackRuler) return onFocusTrackRuler(trackIndex);
		return focusAfterTrack();
	};
	const focusBeforeRuler = () => {
		if (onFocusTrackClip(trackIndex, true)) return true;
		if (onFocusTrackPanelControl(trackIndex, true)) return true;
		return onFocusTrackContainer(trackIndex);
	};
	const focusPanelVertical = (direction) => {
		return focusTrackRowNeighbor(trackIndex, trackCount, direction === 'down' ? 1 : -1, onFocusTrackPanelControl);
	};
	const focusTrackVertical = (direction, extend = false) => {
		return focusTrackRowNeighbor(trackIndex, trackCount, direction, (targetIndex) => {
			if (!onFocusTrackContainer(targetIndex)) return false;
			if (extend) onExtendTrackSelection?.(targetIndex);
			return true;
		});
	};
	const focusRulerVertical = (direction) => {
		return focusTrackRowNeighbor(trackIndex, trackCount, direction === 'down' ? 1 : -1, onFocusTrackRuler);
	};

	return {
		focusAfterPanel,
		focusAfterRuler: focusAfterTrack,
		focusAfterTrack,
		focusBeforeRuler,
		focusBeforeTrack,
		focusCurrentPanel: (last = false) => onFocusTrackPanelControl(trackIndex, last),
		focusCurrentRuler: () => onFocusTrackRuler(trackIndex),
		focusCurrentTrack: () => onFocusTrackContainer(trackIndex),
		focusPanelVertical,
		focusRulerVertical,
		focusTrackVertical,
	};
}

export function routeTrackRowClipKeyDown(event, {
	root,
	isFlatNavigation,
	tabIndex,
	onSelectClip,
	routeClipKey = null,
	router = null,
}) {
	if (!isClipGroup(event.target)) return;
	if (routeClipKey?.(event, router) === true) return;
	if (event.key === 'Enter') {
		event.preventDefault();
		event.stopPropagation();
		onSelectClip(String(event.target.dataset.clipId), {
			additive: event.shiftKey,
			toggle: event.metaKey || event.ctrlKey,
		});
		return;
	}
	if (
		event.altKey
		|| event.ctrlKey
		|| event.metaKey
		|| event.shiftKey
		|| (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
	) return;
	const clips = clipGroups(root);
	const currentIndex = clips.indexOf(event.target);
	if (currentIndex < 0 || clips.length < 2) return;
	event.preventDefault();
	event.stopPropagation();
	const direction = event.key === 'ArrowRight' ? 1 : -1;
	const next = clips[(currentIndex + direction + clips.length) % clips.length];
	if (!isFlatNavigation) {
		for (const clip of clips) clip.tabIndex = clip === next ? tabIndex : -1;
	}
	focusFirst(next);
}

export function useTrackRowFocusNavigation({
	trackWindowRef,
	renderedClips,
	trackIndex,
	trackCount,
	isFlatNavigation,
	trackBaseTabIndex,
	hasTrackRuler,
	onFocusTimelineRuler,
	onFocusTrackContainer,
	onFocusTrackPanelControl,
	onFocusTrackClip,
	onFocusTrackRuler = () => false,
	onFocusSelectionToolbar,
	onSelectClip,
	onExtendTrackSelection,
	routeClipKey,
}) {
	const tabIndexFor = useCallback(
		(offset) => isFlatNavigation ? 0 : trackBaseTabIndex + trackIndex * 4 + offset,
		[isFlatNavigation, trackBaseTabIndex, trackIndex],
	);
	const clipRemovalFocus = useMemo(() => createTimelineClipRemovalFocus(() => trackWindowRef.current), [trackWindowRef]);

	useEffect(() => {
		const root = trackWindowRef.current;
		if (!root) return undefined;
		const normalize = () => {
			clipRemovalFocus.restore();
			normalizeClipSemantics(root, { flat: isFlatNavigation, tabIndex: tabIndexFor(2) });
		};
		normalize();
		const observer = new MutationObserver(normalize);
		observer.observe(root, {
			attributes: true,
			attributeFilter: ['role', 'tabindex'],
			childList: true,
			subtree: true,
		});
		return () => observer.disconnect();
	}, [clipRemovalFocus, isFlatNavigation, renderedClips, tabIndexFor, trackWindowRef]);

	const router = createTrackRowFocusRouter({
		trackIndex,
		trackCount,
		hasTrackRuler,
		onFocusTimelineRuler,
		onFocusTrackContainer,
		onFocusTrackPanelControl,
		onFocusTrackClip,
		onFocusTrackRuler,
		onFocusSelectionToolbar,
		onExtendTrackSelection,
	});
	const handleClipFocusCapture = (event) => {
		if (!isClipGroup(event.target)) return;
		clipRemovalFocus.remember(event.target);
		if (isFlatNavigation) return;
		for (const clip of clipGroups(trackWindowRef.current)) clip.tabIndex = -1;
		event.target.tabIndex = tabIndexFor(2);
	};
	const handleClipKeyDownCapture = (event) => routeTrackRowClipKeyDown(event, {
		root: trackWindowRef.current,
		isFlatNavigation,
		tabIndex: tabIndexFor(2),
		onSelectClip,
		routeClipKey,
		router,
	});

	return {
		...router,
		handleClipFocusCapture,
		handleClipKeyDownCapture,
		tabIndexFor,
	};
}

function isClipGroup(target) {
	return target.matches?.('[data-clip-id][role="group"]') === true;
}
