import { useCallback } from 'react';

import { secondsToFrames } from '../../design-system-adapters.js';
import { createClipTrimPreview } from './interaction-helpers.js';
import { compatibleMediaTrack, MINIMUM_TRACK_HEIGHT } from './geometry.ts';
import { NEW_AUDIO_TRACK_DROP_TARGET } from './constants.ts';
import { resolveTimelineRateStretchPointerPreview } from './rate-stretch-pointer-routing.ts';
import { resolveTimelineRollRippleTrimPointerPreview } from './roll-ripple-trim-pointer-routing.ts';
import { resolveTimelineSlipSlidePointerPreview } from './slip-slide-pointer-routing.ts';
import { samplePointAtPointer } from './track-row-helpers.jsx';
import { resolveTimelineTrimPointerPreview } from './trim-pointer-routing.ts';

export function useTimelinePointerMove({
	controller,
	snapshot,
	state,
	model,
	hitTesting,
	menuActions,
}) {
	const {
		pointerSession,
		touchPointers,
		pinchSession,
		pendingPinchAnchorRef,
		scrollRef,
		setDraggingClipIds,
		setClipDragPreview,
		setTrackResizePreview,
		setLoopPreview,
		setSelectionPreview,
	} = state;
	const {
		project,
		projectIndex,
		panelWidth,
		pixelsPerSecond,
		sampleRate,
	} = model;
	const {
		frameAtClientX,
		isOverOutputDock,
		isOverProjectBin,
		setProjectBinDropActive,
		trackAtClientY,
	} = hitTesting;
	const { run } = menuActions;

	const onPointerMove = useCallback((event) => {
		if (touchPointers.current.has(event.pointerId)) {
			touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (touchPointers.current.size === 2 && pinchSession.current) {
				event.preventDefault();
				const points = [...touchPointers.current.values()];
				const distance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
				const midpoint = (points[0].x + points[1].x) / 2;
				const session = pinchSession.current;
				const nextZoom = session.pixelsPerSecond * distance / session.distance;
				const rect = scrollRef.current?.getBoundingClientRect();
				const anchorSeconds = (session.scrollLeft + session.midpoint - (rect?.left || 0) - panelWidth) / session.pixelsPerSecond;
				pendingPinchAnchorRef.current = {
					anchorSeconds,
					anchorOffset: midpoint - (rect?.left || 0) - panelWidth,
				};
				const appliedZoom = run(() => controller.actions.timeline.setZoom(nextZoom));
				if (!Number.isFinite(Number(appliedZoom)) || Number(appliedZoom) === pixelsPerSecond) {
					pendingPinchAnchorRef.current = null;
				}
			}
			return;
		}
		const session = pointerSession.current;
		if (session?.kind === 'track-resize') {
			const delta = (event.clientY - session.startY) * (session.edge === 'top' ? -1 : 1);
			const visualHeight = Math.max(
				session.minimumHeight,
				Math.min(session.maximumHeight, Math.round(session.originalVisualHeight + delta)),
			);
			const controlsHeight = session.originalVisualHeight - session.originalHeight;
			session.height = Math.max(MINIMUM_TRACK_HEIGHT, visualHeight - controlsHeight);
			setTrackResizePreview({ trackId: session.trackId, height: session.height });
			event.preventDefault();
			return;
		}
		if (session?.kind === 'loop') {
			const endFrame = frameAtClientX(event.clientX, session.lane);
			if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) >= 3) {
				session.moved = true;
				setLoopPreview({
					startFrame: Math.min(session.startFrame, endFrame),
					endFrame: Math.max(session.startFrame, endFrame),
				});
			}
			event.preventDefault();
			return;
		}
		if (session?.kind === 'sample-pencil') {
			const clip = project?.clips.find((item) => item.id === session.clipId);
			const source = clip ? project.sources.find((item) => item.id === clip.sourceId) : null;
			if (!clip || !source) return;
			const point = samplePointAtPointer(event, session.lane, clip, source, frameAtClientX, session.channel);
			const previous = session.points.at(-1);
			if (previous?.timelineFrame === point.timelineFrame && previous.value === point.value) return;
			if (session.points.length >= 4_096) session.points.splice(1, 1);
			session.points.push({ timelineFrame: point.timelineFrame, value: point.value });
			event.preventDefault();
		} else if (session?.kind === 'selection') {
			const endFrame = frameAtClientX(event.clientX, session.lane);
			setSelectionPreview({
				startFrame: Math.min(session.startFrame, endFrame),
				endFrame: Math.max(session.startFrame, endFrame),
			});
		} else if (session?.kind === 'move') {
			if (session.slipSlideMode) {
				const currentPointerSample = frameAtClientX(event.clientX, session.lane);
				const preview = resolveTimelineSlipSlidePointerPreview({
					session,
					currentPointerSample,
					previewSlipSlide: (request) => run(() => (
						controller.actions.video.trim.slipSlide.preview(request)
					)),
					clipKind: (clipId) => projectIndex.clipById.get(clipId)?.kind ?? null,
					previewOrdinary: () => null,
				});
				if (!preview) {
					session.preview = null;
					setClipDragPreview(null);
					setDraggingClipIds(new Set(session.clipIds));
					return;
				}
				session.preview = preview;
				setClipDragPreview(preview);
				setDraggingClipIds(new Set(preview.previews.map(({ clipId }) => clipId)));
				return;
			}
			if (isOverOutputDock(event.clientX, event.clientY)) {
				session.projectBinDrop = false;
				session.preview = null;
				setClipDragPreview(null);
				setProjectBinDropActive(false);
				event.preventDefault();
				return;
			}
			if (isOverProjectBin(event.clientX, event.clientY)) {
				session.projectBinDrop = true;
				session.preview = null;
				setClipDragPreview(null);
				setProjectBinDropActive(true);
				event.preventDefault();
				return;
			}
			if (session.projectBinDrop) {
				session.projectBinDrop = false;
				setProjectBinDropActive(false);
			}
			const deltaFrames = secondsToFrames(
				Math.abs(event.clientX - session.startX) / pixelsPerSecond,
				{ sampleRate },
			) * Math.sign(event.clientX - session.startX);
			const movingClips = session.clipIds
				.map((clipId) => project.clips.find((clip) => clip.id === clipId))
				.filter(Boolean);
			const mediaTracks = project.tracks.filter((track) => Array.isArray(track.clipIds));
			const sourceTrackIndices = movingClips.map((clip) => mediaTracks.findIndex((track) => track.clipIds.includes(clip.id)));
			const activeClip = movingClips.find((clip) => clip.id === session.clipId);
			const activeTrackIndex = mediaTracks.findIndex((track) => track.id === session.trackId);
			const rawRequestedTrackId = trackAtClientY(event.clientY, session.trackId);
			const createsTrack = rawRequestedTrackId === NEW_AUDIO_TRACK_DROP_TARGET;
			const compatibleTrack = createsTrack
				? null
				: compatibleMediaTrack(project, rawRequestedTrackId, activeClip?.kind);
			const requestedTrackId = compatibleTrack?.id || session.trackId;
			const requestedTrackIndex = createsTrack
				? mediaTracks.length
				: mediaTracks.findIndex((track) => track.id === requestedTrackId);
			const minimumTrackDelta = -Math.min(...sourceTrackIndices);
			const maximumTrackDelta = mediaTracks.length - 1 - Math.max(...sourceTrackIndices);
			const movingAvLinks = new Set(movingClips.map((clip) => clip.avLinkId).filter(Boolean));
			const movesLinkedAvPair = [...movingAvLinks].some((avLinkId) => {
				const linked = movingClips.filter((clip) => clip.avLinkId === avLinkId);
				return linked.some((clip) => clip.kind === 'video')
					&& linked.some((clip) => clip.kind === 'audio');
			});
			const trackDelta = createsTrack
				? movesLinkedAvPair
					? mediaTracks.length - Math.min(...sourceTrackIndices)
					: requestedTrackIndex - activeTrackIndex
				: Math.max(
					minimumTrackDelta,
					Math.min(maximumTrackDelta, requestedTrackIndex - activeTrackIndex),
				);
			const selection = project.selection;
			const movesSelection = selection?.endFrame > selection?.startFrame
				&& selection.clipIds?.includes(session.clipId);
			const earliestMovingFrame = Math.min(
				...movingClips.map((clip) => clip.timelineStartFrame),
				...(movesSelection ? [selection.startFrame] : []),
			);
			const clampedDeltaFrames = Math.max(deltaFrames, -earliestMovingFrame);
			const previews = movingClips.map((clip, index) => {
				const destinationIndex = sourceTrackIndices[index] + trackDelta;
				return {
					clipId: clip.id,
					trackId: mediaTracks[destinationIndex]?.id || `${NEW_AUDIO_TRACK_DROP_TARGET}-${destinationIndex}`,
					timelineStartFrame: clip.timelineStartFrame + clampedDeltaFrames,
				};
			});
			const activePreview = previews.find((preview) => preview.clipId === session.clipId);
			const preview = { ...activePreview, createTrack: createsTrack, previews };
			session.preview = preview;
			setClipDragPreview((current) => (
				current?.clipId === preview.clipId
				&& current.trackId === preview.trackId
				&& current.timelineStartFrame === preview.timelineStartFrame
					? current
					: preview
			));
		} else if (session?.kind === 'stretch-left' || session?.kind === 'stretch-right') {
			const preview = resolveTimelineRateStretchPointerPreview({
				session,
				canonicalVideoTrim: snapshot.capabilities?.videoCompositing === true,
				requestedBoundarySample: frameAtClientX(event.clientX, session.lane),
				previewRateStretch: (request) => run(() => (
					controller.actions.video.trim.rateStretch.preview(request)
				)),
				clipKind: (clipId) => projectIndex.clipById.get(clipId)?.kind ?? null,
				previewOrdinary: () => {
					const deltaFrames = secondsToFrames(
						Math.abs(event.clientX - session.startX) / pixelsPerSecond,
						{ sampleRate },
					) * Math.sign(event.clientX - session.startX);
					const change = session.kind === 'stretch-left'
						? Math.max(-session.original.timelineStartFrame, Math.min(session.original.durationFrames - 1, deltaFrames))
						: 0;
					return {
						clipId: session.clipId,
						trackId: session.trackId,
						timelineStartFrame: session.original.timelineStartFrame + change,
						durationFrames: session.kind === 'stretch-left'
							? session.original.durationFrames - change
							: Math.max(1, session.original.durationFrames + deltaFrames),
					};
				},
			});
			if (!preview) {
				session.preview = null;
				setClipDragPreview(null);
				setDraggingClipIds(new Set(session.clipIds));
				return;
			}
			session.preview = preview;
			setClipDragPreview(preview);
			if (preview.previews) {
				setDraggingClipIds(new Set(preview.previews.map(({ clipId }) => clipId)));
			}
		} else if (session?.kind === 'trim-left' || session?.kind === 'trim-right') {
			const edge = session.kind === 'trim-left' ? 'left' : 'right';
			const requestedBoundarySample = frameAtClientX(event.clientX, session.lane);
			const preview = resolveTimelineRollRippleTrimPointerPreview({
				session,
				edge,
				requestedBoundarySample,
				previewRollRipple: (request) => run(() => (
					controller.actions.video.trim.rollRipple.preview(request)
				)),
				clipKind: (clipId) => projectIndex.clipById.get(clipId)?.kind ?? null,
				previewOrdinary: () => resolveTimelineTrimPointerPreview({
					projectIndex, session, edge, requestedBoundarySample,
					canonicalVideoTrim: snapshot.capabilities?.videoCompositing === true,
					legacyRequestedDelta: () => secondsToFrames(
						Math.abs(event.clientX - session.startX) / pixelsPerSecond,
						{ sampleRate },
					) * Math.sign(event.clientX - session.startX),
					previewVideo: (request) => run(() => controller.actions.video.trim.preview(request)),
					createLegacyPreview: createClipTrimPreview,
				}),
			});
			if (!preview) {
				session.preview = null;
				setClipDragPreview(null);
				setDraggingClipIds(new Set(session.clipIds));
				return;
			}
			session.preview = preview;
			setClipDragPreview(preview);
			if (session.rollRippleMode) {
				setDraggingClipIds(new Set(preview.previews.map(({ clipId }) => clipId)));
			}
		}
	}, [controller, frameAtClientX, isOverOutputDock, isOverProjectBin, panelWidth, pixelsPerSecond, project, projectIndex, run, sampleRate, setDraggingClipIds, setProjectBinDropActive, snapshot.capabilities?.videoCompositing, trackAtClientY]);

	return { onPointerMove };
}
