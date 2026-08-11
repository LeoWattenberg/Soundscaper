import { useCallback, useEffect } from 'react';

import { secondsToFrames } from '../../design-system-adapters.js';
import { commitTimelineTrimPointer } from './trim-pointer-routing.ts';

export function useTimelinePointerFinish({
	controller,
	snapshot,
	onRevealProjectBin,
	state,
	model,
	hitTesting,
	menuActions,
}) {
	const {
		pointerSession,
		touchPointers,
		pinchSession,
		setDraggingClipIds,
		setClipDragPreview,
		setTrackResizePreview,
		setLoopPreview,
		setSelectionPreview,
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
		pointerSession.current = null;
		setDraggingClipIds(null);
		setProjectBinDropActive(false);
		const dragPreview = session?.preview;
		setClipDragPreview(null);
		setTrackResizePreview(null);
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
			const endFrame = frameAtClientX(event.clientX, session.lane);
			setSelectionPreview(null);
			if (Math.abs(endFrame - session.startFrame) < Math.max(1, secondsToFrames(3 / pixelsPerSecond, { sampleRate }))) {
				run(() => controller.actions.transport.seek(endFrame));
				run(() => controller.actions.timeline.clearSelection());
				if (session.lane.dataset.rulerInteraction !== undefined && snapshot.timeline?.playbackOnRulerClick !== false && transportState === 'stopped') {
					run(() => controller.actions.transport.playPause());
				}
			} else {
				run(() => controller.actions.timeline.setSelection(session.startFrame, endFrame));
			}
			return;
		}
		if (session.kind === 'split') {
			const endFrame = frameAtClientX(event.clientX, session.lane);
			if (Math.abs(endFrame - session.startFrame) >= Math.max(1, secondsToFrames(3 / pixelsPerSecond, { sampleRate }))) {
				run(() => controller.actions.edit.splitAt(endFrame, session.trackIds));
			}
			return;
		}
		const deltaFrames = secondsToFrames(
			Math.abs(event.clientX - session.startX) / pixelsPerSecond,
			{ sampleRate },
		) * Math.sign(event.clientX - session.startX);
		if (Math.hypot(event.clientX - session.startX, event.clientY - session.startY) < 3) {
			run(() => controller.actions.transport.seek(frameAtClientX(event.clientX, session.lane)));
			return;
		}
		const clip = project.clips.find((item) => item.id === session.clipId);
		if (!clip) return;
		if (session.kind === 'move') {
			if (session.projectBinDrop) {
				run(() => controller.actions.projectBin.moveFromTimeline(clip.id));
				onRevealProjectBin?.();
				return;
			}
			if (dragPreview?.createTrack) {
				run(() => controller.actions.clip.moveToNewTrack(clip.id, dragPreview.timelineStartFrame));
				return;
			}
			const trackId = dragPreview?.trackId || trackAtClientY(event.clientY, session.trackId);
			const timelineStartFrame = dragPreview?.timelineStartFrame ?? Math.max(0, session.original.timelineStartFrame + deltaFrames);
			run(() => controller.actions.clip.move(clip.id, trackId, timelineStartFrame));
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
			commitTimelineTrimPointer({
				session, edge: session.kind === 'trim-left' ? 'left' : 'right', dragPreview: dragPreview || null,
				requestedBoundarySample: frameAtClientX(event.clientX, session.lane),
				canonicalVideoTrim: snapshot.capabilities?.videoCompositing === true,
				commitVideo: (request) => run(() => controller.actions.video.trim.commit(request)),
				commitAudio: (clipId, changes) => run(() => controller.actions.clip.trim(clipId, changes)),
			});
		}
	}, [controller, frameAtClientX, isOverOutputDock, onRevealProjectBin, pixelsPerSecond, project, run, sampleRate, setProjectBinDropActive, snapshot.capabilities?.videoCompositing, snapshot.timeline?.playbackOnRulerClick, trackAtClientY, transportState]);

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
		setLoopPreview(null);
		setTrackResizePreview(null);
		setProjectBinDropActive(false);
		return true;
	}, [setProjectBinDropActive]);

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
		globalThis.addEventListener('pointerup', finishOutsideTimeline, true);
		globalThis.addEventListener('pointercancel', cancelOutsideTimeline, true);
		return () => {
			globalThis.removeEventListener('pointerup', finishOutsideTimeline, true);
			globalThis.removeEventListener('pointercancel', cancelOutsideTimeline, true);
		};
	}, [finishPointerSession, finishTouch]);

	useEffect(() => {
		const cancelWithEscape = (event) => {
			if (event.key !== 'Escape' || !cancelPointerSession()) return;
			event.preventDefault();
			event.stopPropagation();
		};
		globalThis.addEventListener('keydown', cancelWithEscape, true);
		return () => globalThis.removeEventListener('keydown', cancelWithEscape, true);
	}, [cancelPointerSession]);

	return { finishPointerSession, finishTouch, cancelPointerSession };
}
