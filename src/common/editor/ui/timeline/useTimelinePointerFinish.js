import { useCallback, useEffect } from 'react';

import { secondsToFrames } from '../../design-system-adapters.js';
import { createBoundarySnapIndex, resolveBoundarySnap } from './boundary-snap.ts';
import { fadeDurationAtPointer, fadeField, fadeShapeAtPointer, fadeShapeField } from './clip-fade-geometry.ts';
import {
	commitTimelineRateStretchPointer,
	usesFrameCanonicalTimelineRateStretch,
} from './rate-stretch-pointer-routing.ts';
import { commitTimelineRollRippleTrimPointer } from './roll-ripple-trim-pointer-routing.ts';
import { commitTimelineSlipSlidePointer } from './slip-slide-pointer-routing.ts';
import {
	SPLIT_TOOL_DOUBLE_SPLIT_DISTANCE_PIXELS,
	resolveSplitToolGuidelineFrame,
	splitToolGuidelineDistancePixels,
	splitToolTargetTrackIds,
	splitToolTrackHasClipAt,
} from './timeline-tool-precedence.ts';
import { commitTimelineTrimPointer } from './trim-pointer-routing.ts';
import { timelineSelectionDragTrackIds } from './track-selection-scope.ts';

export function useTimelinePointerFinish({
	controller,
	snapshot,
	mutationsBlocked = false,
	splitToolActive,
	onRevealProjectBin,
	state,
	model,
	hitTesting,
	menuActions,
}) {
	const {
		pointerSession,
		scrollRef,
		touchPointers,
		pinchSession,
		setDraggingClipIds,
		setClipDragPreview,
		setTrackResizePreview,
		setLoopPreview,
		setSelectionPreview,
		setBoundarySnapGuideFrames = () => undefined,
	} = state;
	const {
		project,
		pixelsPerSecond,
		sampleRate,
		transportState,
	} = model;
	const {
		frameAtClientX,
		isOverOutputDock,
		setProjectBinDropActive,
		trackAtClientY,
	} = hitTesting;
	const { run } = menuActions;

	const finishPointerSession = useCallback((event, cancelled = false) => {
		const session = pointerSession.current;
		if ((session?.kind === 'fade' || session?.kind === 'fade-shape') && event.pointerId !== session.pointerId) return;
		pointerSession.current = null;
		setDraggingClipIds(null);
		setProjectBinDropActive(false);
		const dragPreview = session?.preview;
		setClipDragPreview(null);
		setTrackResizePreview(null);
		setSelectionPreview(null);
		setBoundarySnapGuideFrames([]);
		if (session?.kind === 'track-resize') {
			if (!cancelled && !pinchSession.current && project && session.height !== session.originalHeight) {
				run(() => controller.actions.timeline.resizeTrackHeight(
					session.trackId,
					session.height,
					session.fittedHeights,
				));
			}
			return;
		}
		if (session?.kind === 'loop') {
			setLoopPreview(null);
			if (cancelled || pinchSession.current || !project) return;
			const endFrame = frameAtClientX(event.clientX, session.lane);
			if (!session.moved) {
				if (session.insideLoop) run(() => controller.actions.transport.toggleLoop());
				return;
			}
			if (Math.abs(endFrame - session.startFrame) < Math.max(1, secondsToFrames(3 / pixelsPerSecond, { sampleRate }))) {
				return;
			}
			run(() => controller.actions.transport.setLoopRegion(session.startFrame, endFrame));
			return;
		}
		if (!session || cancelled || pinchSession.current || !project) return;
		if (session.kind === 'fade') {
			const clip = project.clips.find(item => item.id === session.clipId);
			const field = fadeField(session.edge);
			if (!clip || mutationsBlocked || clip.durationFrames !== session.original.durationFrames
				|| clip.timelineStartFrame !== session.original.timelineStartFrame
				|| (clip[field] ?? 0) !== session.initial) return;
			const value = fadeDurationAtPointer(session.edge, session.initial, session.startX, event.clientX,
				session.pixelsPerSecond, sampleRate, clip.durationFrames);
			if (value !== session.initial) run(() => controller.actions.clip.update(clip.id, { [field]: value }));
			return;
		}
		if (session.kind === 'fade-shape') {
			const clip = project.clips.find(item => item.id === session.clipId);
			const field = fadeShapeField(session.edge);
			if (!clip || mutationsBlocked || clip.durationFrames !== session.original.durationFrames
				|| clip.timelineStartFrame !== session.original.timelineStartFrame
				|| (clip[field] ?? 2) !== session.initial) return;
			const value = fadeShapeAtPointer(session.initial, session.startY, event.clientY,
				session.gainHeight, session.baseGain, session.startGain);
			if (value !== session.initial) run(() => controller.actions.clip.update(clip.id, { [field]: value }));
			return;
		}
		if (session.kind === 'move' && session.slipSlideMode) {
			const currentPointerSample = frameAtClientX(event.clientX, session.lane);
			commitTimelineSlipSlidePointer({
				session,
				currentPointerSample,
				commitSlipSlide: (request) => run(() => (
					controller.actions.video.trim.slipSlide.commit(request)
				)),
				commitOrdinary: () => null,
			});
			return;
		}
		if (usesFrameCanonicalTimelineRateStretch({
			session,
			canonicalVideoTrim: snapshot.capabilities?.videoCompositing === true,
		})) {
			commitTimelineRateStretchPointer({
				session,
				canonicalVideoTrim: true,
				requestedBoundarySample: frameAtClientX(event.clientX, session.lane),
				commitRateStretch: (request) => run(() => (
					controller.actions.video.trim.rateStretch.commit(request)
				)),
				commitOrdinary: () => null,
			});
			return;
		}
		if (session.kind === 'move' && isOverOutputDock(event.clientX, event.clientY)) return;
		if (session.kind === 'sample-pencil') {
			if (session.points.length) run(() => controller.actions.sampleEdit.pencil({
				clipId: session.clipId,
				channel: session.channel,
				points: session.points,
			}));
			return;
		}
		if (session.kind === 'selection') {
			const rawEndFrame = frameAtClientX(event.clientX, session.lane);
			if (!session.snapDisabled && session.snapIndex?.project !== project) {
				session.snapIndex = createBoundarySnapIndex(project);
			}
			const endSnap = session.snapDisabled ? { frame: rawEndFrame, snapped: false }
				: resolveBoundarySnap({
					project, index: session.snapIndex, frame: rawEndFrame,
					currentTrackId: session.lane.dataset.trackId ?? null,
					pixelsPerSecond, sampleRate, rightEdge: rawEndFrame >= session.startFrame,
				});
			const endFrame = endSnap.frame;
			const draggedTrackIds = timelineSelectionDragTrackIds(session.lane, scrollRef.current, event.clientY);
			const trackIds = draggedTrackIds ?? project.selection?.trackIds;
			if ((draggedTrackIds?.length ?? 0) <= 1 && Math.abs(endFrame - session.startFrame) < Math.max(1, secondsToFrames(3 / pixelsPerSecond, { sampleRate }))) {
				run(() => controller.actions.transport.seek(endFrame));
				run(() => controller.actions.timeline.clearSelection());
				if (session.lane.dataset.rulerInteraction !== undefined && snapshot.timeline?.playbackOnRulerClick !== false && transportState === 'stopped') {
					run(() => controller.actions.transport.playPause());
				}
			} else {
				const setSelection = (session.boundarySnapped || endSnap.snapped)
					? controller.actions.timeline.setExactSelection
					: controller.actions.timeline.setSelection;
				run(() => setSelection(session.startFrame, endFrame, trackIds ? { trackIds } : {}));
			}
			return;
		}
		if (session.kind === 'split') {
			if (!splitToolActive) return;
			const rawEndFrame = frameAtClientX(event.clientX, session.lane);
			const endFrame = resolveSplitToolGuidelineFrame({
				frame: rawEndFrame,
				pixelsPerSecond,
				project,
				sampleRate,
			});
			if (splitToolGuidelineDistancePixels(
				session.startFrame, endFrame, pixelsPerSecond, sampleRate,
			) >= SPLIT_TOOL_DOUBLE_SPLIT_DISTANCE_PIXELS) {
				const trackId = trackAtClientY(event.clientY, null);
				if (!trackId || !splitToolTrackHasClipAt(project.tracks, project.clips, trackId, rawEndFrame)) return;
				const trackIds = splitToolTargetTrackIds(project.tracks, trackId, event.shiftKey);
				run(() => controller.actions.edit.splitAt(endFrame, trackIds));
			}
			return;
		}
		const deltaFrames = secondsToFrames(
			Math.abs(event.clientX - session.startX) / pixelsPerSecond,
			{ sampleRate },
		) * Math.sign(event.clientX - session.startX);
		// Every session that reaches here began on a clip — its header, its trim or
		// stretch handles, or a whole-clip modifier gesture. A press that never
		// moved is a click that selects the clip, which pointer-down has already
		// done, so there is nothing left to commit and the playhead stays where it
		// is: picking a clip is not a request to move the transport.
		if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 3) return;
		const clip = project.clips.find((item) => item.id === session.clipId);
		if (!clip) return;
		if (session.kind === 'move') {
			const moveOptions = session.boundarySnapped
				? { ...session.moveOptions, exactFrame: true } : session.moveOptions;
			if (session.projectBinDrop) {
				run(() => controller.actions.projectBin.moveFromTimeline(clip.id));
				onRevealProjectBin?.();
				return;
			}
			if (dragPreview?.createTrack) {
				run(() => controller.actions.clip.moveToNewTrack(clip.id, dragPreview.timelineStartFrame, moveOptions));
				return;
			}
			const trackId = dragPreview?.trackId || trackAtClientY(event.clientY, session.trackId);
			const timelineStartFrame = session.moveOptions?.preserveTime
				? session.original.timelineStartFrame
				: dragPreview?.timelineStartFrame ?? Math.max(0, session.original.timelineStartFrame + deltaFrames);
			run(() => controller.actions.clip.move(clip.id, trackId, timelineStartFrame, moveOptions));
		} else if (session.kind === 'stretch-left') {
			const change = Math.max(
				-session.original.timelineStartFrame,
				Math.min(session.original.durationFrames - 1, deltaFrames),
			);
			run(() => controller.actions.clip.stretch(clip.id, {
				timelineStartFrame: session.original.timelineStartFrame + change,
				durationFrames: session.original.durationFrames - change,
			}));
		} else if (session.kind === 'stretch-right') {
			run(() => controller.actions.clip.stretch(clip.id, {
				durationFrames: Math.max(1, session.original.durationFrames + deltaFrames),
			}));
		} else if (session.kind === 'trim-left' || session.kind === 'trim-right') {
			const edge = session.kind === 'trim-left' ? 'left' : 'right';
			const requestedBoundarySample = frameAtClientX(event.clientX, session.lane);
			commitTimelineRollRippleTrimPointer({
				session,
				edge,
				requestedBoundarySample,
				commitRollRipple: (request) => run(() => (
					controller.actions.video.trim.rollRipple.commit(request)
				)),
				commitOrdinary: () => commitTimelineTrimPointer({
					session, edge, dragPreview: dragPreview || null, requestedBoundarySample,
					canonicalVideoTrim: snapshot.capabilities?.videoCompositing === true,
					commitVideo: (request) => run(() => controller.actions.video.trim.commit(request)),
					commitAudio: (clipId, changes) => run(() => controller.actions.clip.trim(clipId, changes)),
				}),
			});
		}
	}, [controller, frameAtClientX, isOverOutputDock, mutationsBlocked, onRevealProjectBin, pixelsPerSecond, project, run, sampleRate, setBoundarySnapGuideFrames, setProjectBinDropActive, snapshot.capabilities?.videoCompositing, snapshot.timeline?.playbackOnRulerClick, splitToolActive, trackAtClientY, transportState]);

	const finishTouch = useCallback((event) => {
		touchPointers.current.delete(event.pointerId);
		if (touchPointers.current.size < 2) pinchSession.current = null;
	}, []);

	const cancelPointerSession = useCallback(() => {
		if (!pointerSession.current) return false;
		pointerSession.current = null;
		setDraggingClipIds(null);
		setClipDragPreview(null);
		setSelectionPreview(null);
		setBoundarySnapGuideFrames([]);
		setLoopPreview(null);
		setTrackResizePreview(null);
		setProjectBinDropActive(false);
		return true;
	}, [setBoundarySnapGuideFrames, setProjectBinDropActive]);

	useEffect(() => {
		const finishOutsideTimeline = (event) => {
			if (!pointerSession.current) return;
			finishTouch(event);
			finishPointerSession(event);
		};
		const cancelOutsideTimeline = (event) => {
			const session = pointerSession.current;
			if (!session) return;
			finishTouch(event);
			const publishMousePencil = session.kind === 'sample-pencil'
				&& (event.pointerType === 'mouse' || event.pointerId === 0);
			finishPointerSession(event, !publishMousePencil);
		};
		const cancelLostFadeCapture = (event) => {
			const session = pointerSession.current;
			if ((session?.kind === 'fade' || session?.kind === 'fade-shape') && event.pointerId === session.pointerId) {
				finishPointerSession(event, true);
			}
		};
		globalThis.addEventListener('pointerup', finishOutsideTimeline, true);
		globalThis.addEventListener('pointercancel', cancelOutsideTimeline, true);
		globalThis.addEventListener('lostpointercapture', cancelLostFadeCapture, true);
		return () => {
			globalThis.removeEventListener('pointerup', finishOutsideTimeline, true);
			globalThis.removeEventListener('pointercancel', cancelOutsideTimeline, true);
			globalThis.removeEventListener('lostpointercapture', cancelLostFadeCapture, true);
		};
	}, [finishPointerSession, finishTouch]);

	useEffect(() => {
		const cancelWithEscape = (event) => {
			if (event.key !== 'Escape') return;
			const session = pointerSession.current;
			if (session?.projectBinDrop) {
				cancelPointerSession();
			} else if (session?.kind === 'selection' || (session?.kind === 'move' && !session.slipSlideMode)) {
				session.snapDisabled = true;
				session.boundarySnapped = false;
				setBoundarySnapGuideFrames([]);
				if (session.kind === 'selection') {
					session.startFrame = session.rawStartFrame ?? session.startFrame;
					session.startSnapGuideFrame = null;
					const endFrame = session.lastRawEndFrame ?? session.startFrame;
					setSelectionPreview({
						startFrame: Math.min(session.startFrame, endFrame),
						endFrame: Math.max(session.startFrame, endFrame),
						...(session.lastTrackIds ? { trackIds: session.lastTrackIds } : {}),
					});
				} else if (session.unsnappedPreview) {
					session.preview = session.unsnappedPreview;
					setClipDragPreview(session.unsnappedPreview);
				}
			} else if (!cancelPointerSession()) return;
			event.preventDefault();
			event.stopPropagation();
		};
		globalThis.addEventListener('keydown', cancelWithEscape, true);
		return () => globalThis.removeEventListener('keydown', cancelWithEscape, true);
	}, [cancelPointerSession, pointerSession, setBoundarySnapGuideFrames, setClipDragPreview, setSelectionPreview]);

	return { finishPointerSession, finishTouch, cancelPointerSession };
}
