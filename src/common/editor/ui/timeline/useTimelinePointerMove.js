import { useCallback, useEffect, useRef } from 'react';
import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

import { secondsToFrames } from '../../design-system-adapters.js';
import { resolveBoundarySnap, resolveClipMoveBoundarySnap } from './boundary-snap.ts';
import { fadeDurationAtPointer, fadeField } from './clip-fade-geometry.ts';
import { createClipTrimPreview } from './interaction-helpers.js';
import { compatibleMediaTrack, MINIMUM_TRACK_HEIGHT } from './geometry.ts';
import { NEW_AUDIO_TRACK_DROP_TARGET } from './constants.ts';
import { resolveTimelineRateStretchPointerPreview } from './rate-stretch-pointer-routing.ts';
import { resolveTimelineRollRippleTrimPointerPreview } from './roll-ripple-trim-pointer-routing.ts';
import { resolveTimelineSlipSlidePointerPreview } from './slip-slide-pointer-routing.ts';
import { samplePointAtPointer } from './track-row-helpers.jsx';
import { resolveTimelineTrimPointerPreview } from './trim-pointer-routing.ts';
import { timelineSelectionDragTrackIds } from './track-selection-scope.ts';

const NOOP = () => undefined;

export function useTimelinePointerMove({
	controller,
	snapshot,
	splitToolActive,
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
		setBoundarySnapGuideFrames = NOOP,
		setSplitToolGuideline = NOOP,
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
	const fadePreviewFrame = useRef(null);
	useEffect(() => () => {
		if (fadePreviewFrame.current !== null) cancelAnimationFrame(fadePreviewFrame.current);
	}, []);
	const splitToolGuidelineRuntimeRef = useRef(
		/** @type {typeof import('./split-tool-guideline.ts') | null} */ (null),
	);
	const splitToolHoverRef = useRef(null);
	const splitToolGuidelineRef = useRef(null);
	const clearSplitToolGuideline = useCallback(() => {
		splitToolHoverRef.current = null;
		splitToolGuidelineRef.current = null;
		setSplitToolGuideline(null);
	}, [setSplitToolGuideline]);
	const resolveCurrentSplitToolGuideline = useCallback(() => {
		const hover = splitToolHoverRef.current;
		const runtime = splitToolGuidelineRuntimeRef.current;
		return hover && runtime ? runtime.resolveSplitToolHoverGuideline({
			...hover,
			frameAtClientX,
			pixelsPerSecond,
			project,
			sampleRate,
			scrollRoot: scrollRef.current,
		}) : null;
	}, [frameAtClientX, pixelsPerSecond, project, sampleRate, scrollRef]);

	useEffect(() => {
		let subscribed = true;
		if (!splitToolActive && splitToolHoverRef.current?.allTracks) {
			splitToolHoverRef.current = { ...splitToolHoverRef.current, allTracks: false };
		}
		const currentGuideline = splitToolActive ? resolveCurrentSplitToolGuideline() : null;
		splitToolGuidelineRef.current = currentGuideline;
		setSplitToolGuideline((current) => sameSplitToolGuideline(current, currentGuideline)
			? current
			: currentGuideline);
		if (splitToolActive && !splitToolGuidelineRuntimeRef.current) {
			void import('./split-tool-guideline.ts').then((runtime) => {
				if (!subscribed) return;
				splitToolGuidelineRuntimeRef.current = runtime;
				const loadedGuideline = resolveCurrentSplitToolGuideline();
				splitToolGuidelineRef.current = loadedGuideline;
				setSplitToolGuideline((current) => sameSplitToolGuideline(current, loadedGuideline)
					? current
					: loadedGuideline);
			});
		}
		const setAllTracks = (allTracks) => {
			if (splitToolHoverRef.current) {
				splitToolHoverRef.current = { ...splitToolHoverRef.current, allTracks };
			}
			const guideline = splitToolGuidelineRuntimeRef.current?.setSplitToolGuidelineAllTracks(
				splitToolGuidelineRef.current,
				allTracks,
			) ?? splitToolGuidelineRef.current;
			splitToolGuidelineRef.current = guideline;
			if (splitToolActive) setSplitToolGuideline(guideline);
		};
		const updateShiftSpan = (event) => {
			if (event.key === 'Shift') setAllTracks(event.type === 'keydown');
		};
		const resetShiftSpan = () => setAllTracks(false);
		globalThis.addEventListener('keydown', updateShiftSpan, true);
		globalThis.addEventListener('keyup', updateShiftSpan, true);
		globalThis.addEventListener('blur', resetShiftSpan);
		return () => {
			subscribed = false;
			globalThis.removeEventListener('keydown', updateShiftSpan, true);
			globalThis.removeEventListener('keyup', updateShiftSpan, true);
			globalThis.removeEventListener('blur', resetShiftSpan);
		};
	}, [resolveCurrentSplitToolGuideline, setSplitToolGuideline, splitToolActive]);

	const onPointerMove = useCallback((event) => {
		if (touchPointers.current.has(event.pointerId)) {
			clearSplitToolGuideline();
			touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (touchPointers.current.size === 2 && pinchSession.current) {
				event.preventDefault();
				const points = [...touchPointers.current.values()];
				const distance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
				const midpoint = (points[0].x + points[1].x) / 2;
				const session = pinchSession.current;
				const nextZoom = session.pixelsPerSecond * distance / session.distance;
				const rect = scrollRef.current?.getBoundingClientRect();
				const anchorSeconds = (session.scrollLeft + session.midpoint - (rect?.left || 0)
					- panelWidth - CLIP_CONTENT_OFFSET) / session.pixelsPerSecond;
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
		if (session?.kind === 'fade') {
			if (session.pointerId !== event.pointerId) return;
			const value = fadeDurationAtPointer(session.edge, session.initial, session.startX, event.clientX,
				session.pixelsPerSecond, sampleRate, session.original.durationFrames);
			session.preview = { clipId: session.clipId, trackId: session.trackId, [fadeField(session.edge)]: value };
			if (fadePreviewFrame.current === null) fadePreviewFrame.current = requestAnimationFrame(() => {
				fadePreviewFrame.current = null;
				if (pointerSession.current === session) setClipDragPreview(session.preview);
			});
			event.preventDefault();
			return;
		}
		const runtime = splitToolGuidelineRuntimeRef.current;
		const lane = runtime ? runtime.resolveSplitToolPointerLane(
			event.target, event.clientY, scrollRef.current,
			session?.kind === 'split' ? session.lane : null,
		) : event.target?.closest?.('.audio-editor-track-lane[data-track-lane]')
			?? (session?.kind === 'split' ? session.lane : null);
		splitToolHoverRef.current = lane ? {
			allTracks: event.shiftKey,
			clientX: event.clientX,
			lane,
		} : null;
		const guideline = splitToolActive ? resolveCurrentSplitToolGuideline() : null;
		splitToolGuidelineRef.current = guideline;
		if (splitToolActive) {
			setSplitToolGuideline((current) => sameSplitToolGuideline(current, guideline)
				? current
				: guideline);
		}
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
			const rawEndFrame = frameAtClientX(event.clientX, session.lane);
			const endSnap = session.snapDisabled ? { frame: rawEndFrame, snapped: false }
				: resolveBoundarySnap({
					project, frame: rawEndFrame, currentTrackId: session.lane.dataset.trackId ?? null,
					pixelsPerSecond, sampleRate, rightEdge: rawEndFrame >= session.startFrame,
				});
			const endFrame = endSnap.frame;
			const trackIds = timelineSelectionDragTrackIds(session.lane, scrollRef.current, event.clientY);
			session.lastRawEndFrame = rawEndFrame;
			session.lastTrackIds = trackIds;
			session.boundarySnapped = Number.isSafeInteger(session.startSnapGuideFrame) || endSnap.snapped;
			setBoundarySnapGuideFrames([...new Set([
				session.startSnapGuideFrame, endSnap.snapped ? endFrame : null,
			].filter(Number.isSafeInteger))]);
			setSelectionPreview({
				startFrame: Math.min(session.startFrame, endFrame),
				endFrame: Math.max(session.startFrame, endFrame),
				trackIds,
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
				setBoundarySnapGuideFrames([]);
				setProjectBinDropActive(false);
				event.preventDefault();
				return;
			}
			if (isOverProjectBin(event.clientX, event.clientY)) {
				session.projectBinDrop = true;
				session.preview = null;
				setClipDragPreview(null);
				setBoundarySnapGuideFrames([]);
				setProjectBinDropActive(true);
				event.preventDefault();
				return;
			}
			if (session.projectBinDrop) {
				session.projectBinDrop = false;
				setProjectBinDropActive(false);
			}
			const deltaFrames = session.moveOptions?.preserveTime ? 0 : secondsToFrames(
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
			const trackDelta = createsTrack
				? mediaTracks.length - Math.min(...sourceTrackIndices)
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
			const activeStartFrame = activeClip?.timelineStartFrame ?? session.original?.timelineStartFrame ?? 0;
			const rawActiveStartFrame = activeStartFrame + clampedDeltaFrames;
			const snap = session.snapDisabled || session.moveOptions?.preserveTime
				? { startFrame: rawActiveStartFrame, guideFrame: null }
				: resolveClipMoveBoundarySnap({
					project, clipId: session.clipId, movingClipIds: session.clipIds,
					rawStartFrame: rawActiveStartFrame, currentTrackId: session.trackId,
					pixelsPerSecond, sampleRate, preferRightEdge: session.preferRightSnap === true,
				});
			const snappedDeltaFrames = Math.max(snap.startFrame - activeStartFrame, -earliestMovingFrame);
			const createPreviews = (delta) => movingClips.map((clip, index) => {
				const destinationIndex = sourceTrackIndices[index] + trackDelta;
				return {
					clipId: clip.id,
					trackId: mediaTracks[destinationIndex]?.id || `${NEW_AUDIO_TRACK_DROP_TARGET}-${destinationIndex}`,
					timelineStartFrame: clip.timelineStartFrame + delta,
				};
			});
			const previews = createPreviews(snappedDeltaFrames);
			const activePreview = previews.find((preview) => preview.clipId === session.clipId);
			const preview = { ...activePreview, createTrack: createsTrack, previews };
			const rawPreviews = createPreviews(clampedDeltaFrames);
			session.unsnappedPreview = {
				...rawPreviews.find(({ clipId }) => clipId === session.clipId),
				createTrack: createsTrack, previews: rawPreviews,
			};
			session.preview = preview;
			session.boundarySnapped = snap.guideFrame !== null
				&& snappedDeltaFrames === snap.startFrame - activeStartFrame;
			setBoundarySnapGuideFrames(session.boundarySnapped ? [snap.guideFrame] : []);
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
	}, [clearSplitToolGuideline, controller, frameAtClientX, isOverOutputDock, isOverProjectBin, panelWidth, pixelsPerSecond, project, projectIndex, resolveCurrentSplitToolGuideline, run, sampleRate, setBoundarySnapGuideFrames, setDraggingClipIds, setProjectBinDropActive, setSplitToolGuideline, snapshot.capabilities?.videoCompositing, splitToolActive, trackAtClientY]);

	return { onPointerMove, clearSplitToolGuideline };
}

function sameSplitToolGuideline(left, right) {
	if (left === right) return true;
	if (!left || !right) return false;
	return left.frame === right.frame
		&& left.allTracks === right.allTracks
		&& left.singleTop === right.singleTop
		&& left.singleHeight === right.singleHeight
		&& left.allTop === right.allTop
		&& left.allHeight === right.allHeight;
}
