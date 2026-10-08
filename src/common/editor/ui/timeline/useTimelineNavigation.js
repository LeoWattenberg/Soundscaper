import { useCallback, useEffect, useRef } from 'react';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

import { framesToSeconds } from '../../design-system-adapters.js';
import {
	MINIMUM_TRACK_HEIGHT,
	trackOptionalControlsHeight,
} from './geometry.ts';
import {
	focusCandidate,
	focusFirst,
	focusPanelControl,
	trackNavigationRow,
} from './timeline-navigation.js';
import {
	readTimelineScrollScale,
	timelineDomScrollForElement,
} from './timeline-scroll-space.ts';

export function useTimelineNavigation({
	controller,
	trackHeaderDrawer = null,
	showArmControls,
	automationVisibleTrackIds,
	searchRevealRequest,
	state,
	model,
}) {
	const {
		navigationRootRef,
		scrollRef,
		setScrollX,
		timelineRef,
	} = state;
	const {
		project,
		pixelsPerSecond,
		sampleRate,
		timelineWidth,
		viewportWidth,
		visualTrackHeight,
	} = model;
	const searchRevealRef = useRef(/** @type {{ clipId: string, revision: number | undefined, completed: boolean, activeElement: Element | null } | null} */ (null));

	useEffect(() => {
		controller.actions.timeline.setVisibleTrackHeights(Object.fromEntries((project?.tracks || []).map((track) => {
			const controlsHeight = trackOptionalControlsHeight(
				track, showArmControls, automationVisibleTrackIds?.has(track.id) === true,
			);
			return [track.id, Math.max(MINIMUM_TRACK_HEIGHT, visualTrackHeight(track) - controlsHeight)];
		})));
	}, [automationVisibleTrackIds, controller, project?.tracks, showArmControls, visualTrackHeight]);

	const focusTimelineRuler = useCallback(() => {
		return focusFirst(navigationRootRef.current?.querySelector('[data-ruler-focus]'));
	}, []);
	const focusTrackContainer = useCallback((trackIndex) => {
		return focusFirst(trackNavigationRow(navigationRootRef.current, trackIndex)?.querySelector('.track'));
	}, []);
	const focusTrackPanelControl = useCallback((trackIndex, last = false) => {
		const focusPanel = () => focusPanelControl(
			trackNavigationRow(navigationRootRef.current, trackIndex)?.querySelector('.track-control-panel'),
			last,
		);
		// A hidden header cannot take focus: open the drawer first and focus once it shows.
		if (trackHeaderDrawer && !trackHeaderDrawer.isOpen) {
			trackHeaderDrawer.toggle();
			requestAnimationFrame(() => focusPanel());
			return true;
		}
		return focusPanel();
	}, [trackHeaderDrawer]);
	const focusTrackClip = useCallback((trackIndex, last = false, clipId = null) => {
		const row = trackNavigationRow(navigationRootRef.current, trackIndex);
		if (clipId !== null) {
			const matchingClip = [...(row?.querySelectorAll('[data-clip-id][role="group"]') || [])]
				.find((element) => String(element.dataset.clipId) === String(clipId));
			if (matchingClip) return focusFirst(matchingClip);
		}
		return focusCandidate(row, '[data-clip-id][role="group"]', last);
	}, []);
	const focusTrackRuler = useCallback((trackIndex) => {
		return focusFirst(trackNavigationRow(navigationRootRef.current, trackIndex)?.querySelector('[data-track-ruler]'));
	}, []);
	const focusSelectionToolbar = useCallback(() => {
		const editor = navigationRootRef.current?.closest('#kw-audio-editor-design-system');
		const selectionToolbar = editor?.querySelector('[data-selection-toolbar] .selection-toolbar');
		return focusCandidate(selectionToolbar, '[role="group"], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
	}, []);
	useEffect(() => {
		const clipId = searchRevealRequest?.clipId;
		if (!clipId || !project) return undefined;
		const previous = searchRevealRef.current;
		const sameRequest = previous?.clipId === clipId && previous.revision === searchRevealRequest.revision;
		if (sameRequest && previous.completed) return undefined;
		const clip = project.clips.find((candidate) => String(candidate.id) === String(clipId));
		const trackIndex = project.tracks.findIndex((track) => track.clipIds?.includes(clip?.id));
		const scroll = scrollRef.current;
		if (!clip || trackIndex < 0 || !scroll) return undefined;
		const request = sameRequest ? previous : {
			clipId, revision: searchRevealRequest.revision,
			completed: false, activeElement: scroll.ownerDocument.activeElement,
		};
		searchRevealRef.current = request;
		const clipCenterPixels = CLIP_CONTENT_OFFSET + framesToSeconds(
			clip.timelineStartFrame + clip.durationFrames / 2,
			{ sampleRate },
		) * pixelsPerSecond;
		scroll.scrollLeft = timelineDomScrollForElement(scroll, clipCenterPixels - viewportWidth / 2);

		let frame = 0;
		let attempts = 0;
		const focusRevealedClip = () => {
			const active = scroll.ownerDocument.activeElement;
			// A search is one request, not a continuing claim on the clip. Preserve
			// deliberate focus while waiting for its virtualized row to mount.
			if (active?.isConnected && active !== request.activeElement
				&& active !== scroll.ownerDocument.body) {
				request.completed = true;
				return;
			}
			attempts += 1;
			const row = trackNavigationRow(navigationRootRef.current, trackIndex);
			const target = [...(row?.querySelectorAll('[data-clip-id][role="group"]') || [])]
				.find((element) => String(element.dataset.clipId) === String(clip.id));
			if (target && focusFirst(target)) {
				request.completed = true;
				return;
			}
			if (attempts >= 8) return;
			frame = globalThis.requestAnimationFrame(focusRevealedClip);
		};
		frame = globalThis.requestAnimationFrame(focusRevealedClip);
		return () => globalThis.cancelAnimationFrame(frame);
	}, [
		pixelsPerSecond,
		project,
		sampleRate,
		searchRevealRequest?.clipId,
		searchRevealRequest?.revision,
		viewportWidth,
	]);
	const setTimelineNode = useCallback((node) => {
		timelineRef(node);
		navigationRootRef.current = node;
	}, [timelineRef]);

	const handleTimelineScroll = useCallback((event) => {
		const maximumScroll = Math.max(0, timelineWidth - viewportWidth);
		const nextScrollX = Math.max(0, Math.min(maximumScroll, event.currentTarget.scrollLeft));
		if (event.currentTarget.scrollLeft !== nextScrollX) event.currentTarget.scrollLeft = nextScrollX;
		// Scrolled content is drawn at its content coordinate plus this origin,
		// which stays zero until the surface is capped at deep zoom.
		const scale = readTimelineScrollScale(event.currentTarget);
		const renderOriginX = scale === 1 ? 0 : nextScrollX - nextScrollX * scale;
		const panelStyle = event.currentTarget.closest('.audio-editor-timeline-panel')?.style;
		panelStyle?.setProperty('--timeline-scroll-x', `${nextScrollX}px`);
		panelStyle?.setProperty('--timeline-render-origin-x', `${renderOriginX}px`);
		setScrollX(nextScrollX);
	}, [timelineWidth, viewportWidth]);

	return {
		focusTimelineRuler,
		focusTrackContainer,
		focusTrackPanelControl,
		focusTrackClip,
		focusTrackRuler,
		focusSelectionToolbar,
		setTimelineNode,
		handleTimelineScroll,
	};
}
