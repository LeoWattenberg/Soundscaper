/* SPDX-License-Identifier: AGPL-3.0-only */

import { useCallback, useEffect } from 'react';

import { clipGroups, focusFirst, normalizeClipSemantics } from './timeline-navigation.js';

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
}) {
	const focusAfterTrack = () => {
		if (trackIndex + 1 < trackCount) return onFocusTrackContainer(trackIndex + 1);
		return onFocusSelectionToolbar();
	};
	const focusBeforeTrack = () => {
		if (trackIndex === 0) return onFocusTimelineRuler();
		const previousTrack = trackIndex - 1;
		if (hasTrackRuler && onFocusTrackRuler(previousTrack)) return true;
		if (onFocusTrackClip(previousTrack, true)) return true;
		if (onFocusTrackPanelControl(previousTrack, true)) return true;
		return onFocusTrackContainer(previousTrack);
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
		const targetIndex = trackIndex + (direction === 'down' ? 1 : -1);
		if (targetIndex >= 0 && targetIndex < trackCount) {
			return onFocusTrackPanelControl(targetIndex);
		}
		return false;
	};
	const focusTrackVertical = (direction) => {
		const targetIndex = trackIndex + direction;
		if (targetIndex >= 0 && targetIndex < trackCount) return onFocusTrackContainer(targetIndex);
		return false;
	};
	const focusRulerVertical = (direction) => {
		const targetIndex = trackIndex + (direction === 'down' ? 1 : -1);
		if (targetIndex >= 0 && targetIndex < trackCount) return onFocusTrackRuler(targetIndex);
		return false;
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
	routeClipKey,
}) {
	const tabIndexFor = useCallback(
		(offset) => isFlatNavigation ? 0 : trackBaseTabIndex + trackIndex * 4 + offset,
		[isFlatNavigation, trackBaseTabIndex, trackIndex],
	);

	useEffect(() => {
		const root = trackWindowRef.current;
		if (!root) return undefined;
		const normalize = () => normalizeClipSemantics(root, {
			flat: isFlatNavigation,
			tabIndex: tabIndexFor(2),
		});
		normalize();
		const observer = new MutationObserver(normalize);
		observer.observe(root, {
			attributes: true,
			attributeFilter: ['role', 'tabindex'],
			childList: true,
			subtree: true,
		});
		return () => observer.disconnect();
	}, [isFlatNavigation, renderedClips, tabIndexFor, trackWindowRef]);

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
	});
	const handleClipFocusCapture = (event) => {
		if (isFlatNavigation || !isClipGroup(event.target)) return;
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
