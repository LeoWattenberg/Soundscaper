import { useCallback } from 'react';
import { CLIP_CONTENT_OFFSET } from '@dilsonspickles/components';

import { clearActiveProjectBinDragPayload } from '../../project-bin-dnd.js';
import { secondsToFrames } from '../../design-system-adapters.js';
import {
	NEW_AUDIO_TRACK_DROP_TARGET,
	NEW_AUDIO_TRACK_DROP_ZONE_HEIGHT,
} from './constants.ts';

export function useTimelineHitTesting({ state, model }) {
	const {
		navigationRootRef,
		scrollRef,
		scrollX,
		setDraggingClipIds,
		setProjectBinDragPreview,
	} = state;
	const { durationFrames, pixelsPerSecond, sampleRate } = model;

	const frameAtClientX = useCallback((clientX, lane) => {
		const rect = lane.getBoundingClientRect();
		const currentScrollX = lane.dataset.rulerInteraction !== undefined
			? (scrollRef.current?.scrollLeft ?? scrollX)
			: 0;
		return secondsToFrames(Math.max(0, (currentScrollX + clientX - rect.left - CLIP_CONTENT_OFFSET) / pixelsPerSecond), {
			maximumFrame: durationFrames,
			sampleRate,
		});
	}, [durationFrames, pixelsPerSecond, sampleRate, scrollX]);

	const isInNewTrackDropZone = useCallback((clientY) => {
		const rect = scrollRef.current?.querySelector('.audio-editor-timeline-inner')?.getBoundingClientRect();
		return Boolean(rect
			&& clientY >= Math.max(rect.top, rect.bottom - NEW_AUDIO_TRACK_DROP_ZONE_HEIGHT)
			&& clientY < rect.bottom);
	}, []);

	const trackAtClientY = useCallback((clientY, fallbackTrackId) => {
		if (isInNewTrackDropZone(clientY)) return NEW_AUDIO_TRACK_DROP_TARGET;
		for (const lane of scrollRef.current?.querySelectorAll('[data-track-lane]') || []) {
			if (lane.closest('[data-label-track]')) continue;
			const rect = lane.getBoundingClientRect();
			if (clientY >= rect.top && clientY < rect.bottom) return lane.dataset.trackId || fallbackTrackId;
		}
		const trackList = scrollRef.current?.querySelector('[data-track-list]');
		const trackRows = [...(trackList?.querySelectorAll('.audio-editor-track-row') || [])];
		const dropSurfaceRect = scrollRef.current?.querySelector('.audio-editor-timeline-inner')?.getBoundingClientRect();
		const lastTrackBottom = trackRows.length
			? Math.max(...trackRows.map((row) => row.getBoundingClientRect().bottom))
			: dropSurfaceRect?.top;
		if (dropSurfaceRect && clientY >= lastTrackBottom && clientY < dropSurfaceRect.bottom) {
			return NEW_AUDIO_TRACK_DROP_TARGET;
		}
		return fallbackTrackId;
	}, [isInNewTrackDropZone]);

	const projectBinDropTarget = useCallback(() => {
		const editor = navigationRootRef.current?.closest('#kw-audio-editor-design-system');
		return editor?.querySelector('[data-project-bin-drop-target]') || null;
	}, []);

	const setProjectBinDropActive = useCallback((active) => {
		const target = projectBinDropTarget();
		if (!target) return;
		if (active) target.dataset.dropActive = 'true';
		else target.removeAttribute('data-drop-active');
	}, [projectBinDropTarget]);

	const isOverProjectBin = useCallback((clientX, clientY) => {
		const target = projectBinDropTarget();
		if (!target) return false;
		const rect = target.getBoundingClientRect();
		return clientX >= rect.left && clientX < rect.right && clientY >= rect.top && clientY < rect.bottom;
	}, [projectBinDropTarget]);

	const isOverOutputDock = useCallback((clientX, clientY) => {
		const dock = navigationRootRef.current?.querySelector('[data-output-track-dock]');
		if (!dock) return false;
		const rect = dock.getBoundingClientRect();
		return clientX >= rect.left && clientX < rect.right && clientY >= rect.top && clientY < rect.bottom;
	}, []);

	const timelineDropTargetAt = useCallback((event) => {
		const eventLane = event.target?.closest?.('.audio-editor-track-lane[data-track-lane]');
		const lane = eventLane && !eventLane.closest('[data-label-track]') && !isInNewTrackDropZone(event.clientY)
			? eventLane
			: null;
		const coordinateLane = eventLane
			|| scrollRef.current?.querySelector('.audio-editor-track-lane[data-track-lane]')
			|| scrollRef.current?.querySelector('[data-ruler-interaction]');
		return {
			trackId: lane?.dataset.trackId || null,
			timelineStartFrame: coordinateLane ? frameAtClientX(event.clientX, coordinateLane) : 0,
			createTrack: !lane,
		};
	}, [frameAtClientX, isInNewTrackDropZone]);

	const clearProjectBinDragState = useCallback((clearPayload = false) => {
		setProjectBinDragPreview(null);
		setDraggingClipIds(null);
		setProjectBinDropActive(false);
		if (clearPayload) clearActiveProjectBinDragPayload();
	}, [setProjectBinDropActive]);

	return {
		frameAtClientX,
		isInNewTrackDropZone,
		trackAtClientY,
		projectBinDropTarget,
		setProjectBinDropActive,
		isOverProjectBin,
		isOverOutputDock,
		timelineDropTargetAt,
		clearProjectBinDragState,
	};
}
