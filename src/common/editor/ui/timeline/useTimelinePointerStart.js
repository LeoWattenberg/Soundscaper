import { useCallback } from 'react';

import { collectClipTransformIds, collectClipTrimIds } from '../../commands.js';
import {
	MINIMUM_TRACK_HEIGHT,
	RECORDING_INPUT_CONTROLS_HEIGHT,
} from './geometry.ts';
import {
	CLIP_TRIM_EDGE_HIT_WIDTH,
	TRACK_HEADER_RESIZE_HIT_HEIGHT,
} from './constants.ts';
import { captureTimelineRollRippleTrimPointerMode } from './roll-ripple-trim-pointer-routing.ts';
import { captureTimelineSlipSlidePointerGesture } from './slip-slide-pointer-routing.ts';
import { isRulerLoopBand, samplePointAtPointer } from './track-row-helpers.jsx';

export function useTimelinePointerStart({
	controller,
	snapshot,
	automationToolEnabled,
	showArmControls,
	splitToolActive,
	mutationsBlocked,
	state,
	model,
	hitTesting,
	menuActions,
}) {
	const {
		pointerSession,
		touchPointers,
		pinchSession,
		scrollRef,
		setDraggingClipIds,
		setSelectionPreview,
	} = state;
	const {
		project,
		pixelsPerSecond,
		sampleRate,
		timelineView,
		visualTrackHeight,
	} = model;
	const { frameAtClientX } = hitTesting;
	const { run } = menuActions;
	const onPointerDown = useCallback((event) => {
		if (event.target.closest?.('[data-timeline-annotation-interactive]')) return;
		if (event.pointerType === 'touch') {
			touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (touchPointers.current.size === 2) {
				const points = [...touchPointers.current.values()];
				pinchSession.current = {
					distance: Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)),
					pixelsPerSecond,
					midpoint: (points[0].x + points[1].x) / 2,
					scrollLeft: scrollRef.current?.scrollLeft || 0,
				};
				setSelectionPreview(null);
				pointerSession.current = null;
				return;
			}
		}
		if (event.button !== 0 || mutationsBlocked) return;
		const trackHeader = event.target.closest?.('[data-track-header]');
		const resizeTrackRow = trackHeader?.closest?.('[data-track-row]');
		if (trackHeader && resizeTrackRow) {
			const headerRect = trackHeader.getBoundingClientRect();
			const distanceFromTop = event.clientY - headerRect.top;
			const distanceFromBottom = headerRect.bottom - event.clientY;
			if (Math.min(distanceFromTop, distanceFromBottom) <= TRACK_HEADER_RESIZE_HIT_HEIGHT) {
				const trackId = resizeTrackRow.dataset.trackId;
				const track = project.tracks.find((item) => item.id === trackId);
				if (track) {
					const edge = distanceFromTop <= distanceFromBottom ? 'top' : 'bottom';
					const originalVisualHeight = visualTrackHeight(track);
					const controlsHeight = showArmControls && track.type === 'audio'
						? RECORDING_INPUT_CONTROLS_HEIGHT
						: 0;
					const originalHeight = Math.max(MINIMUM_TRACK_HEIGHT, originalVisualHeight - controlsHeight);
					const timelineInnerHeight = scrollRef.current?.querySelector('.audio-editor-timeline-inner')?.getBoundingClientRect().height || originalVisualHeight;
					pointerSession.current = {
						kind: 'track-resize',
						trackId,
						edge,
						startY: event.clientY,
						originalHeight,
						originalVisualHeight,
						minimumHeight: MINIMUM_TRACK_HEIGHT + controlsHeight,
						maximumHeight: Math.max(MINIMUM_TRACK_HEIGHT + controlsHeight, Math.floor(timelineInnerHeight * 0.9)),
						height: originalHeight,
						fittedHeights: Object.fromEntries(project.tracks.map((candidate) => {
							const candidateControlsHeight = showArmControls && candidate.type === 'audio'
								? RECORDING_INPUT_CONTROLS_HEIGHT
								: 0;
							return [candidate.id, Math.max(
								MINIMUM_TRACK_HEIGHT,
								visualTrackHeight(candidate) - candidateControlsHeight,
							)];
						})),
					};
					event.preventDefault();
					event.stopPropagation();
					event.currentTarget.setPointerCapture?.(event.pointerId);
					return;
				}
			}
		}
		const interactiveControl = event.target.closest?.('button, input, textarea, select, [role="menuitem"]');
		if (interactiveControl && !interactiveControl.classList.contains('clip-display__handle')) return;
		if (event.target.closest?.('[data-label-id]')) return;
		if (event.target.closest?.('.audio-editor-vertical-ruler')) return;
		const clipElement = event.target.closest('[data-clip-id]');
		const lane = event.target.closest('[data-track-lane]');
		if (!lane) return;
		if (lane.dataset.rulerInteraction !== undefined && isRulerLoopBand(event, lane)) {
			const startFrame = frameAtClientX(event.clientX, lane);
			const loop = project.loop;
			const insideLoop = Boolean(loop?.enabled && loop.endFrame > loop.startFrame
				&& startFrame >= loop.startFrame && startFrame <= loop.endFrame);
			pointerSession.current = {
				kind: 'loop',
				startFrame,
				startX: event.clientX,
				startY: event.clientY,
				insideLoop,
				moved: false,
				lane,
			};
			event.preventDefault();
			event.stopPropagation();
			event.currentTarget.setPointerCapture?.(event.pointerId);
			return;
		}
		if (!clipElement) {
			const laneTrack = project.tracks.find((track) => track.id === lane.dataset.trackId);
			if (automationToolEnabled && laneTrack?.type === 'audio') return;
			if (lane.dataset.trackId && lane.dataset.rulerInteraction === undefined) {
				run(() => controller.actions.timeline.selectTrack(lane.dataset.trackId));
			}
			const startFrame = frameAtClientX(event.clientX, lane);
			pointerSession.current = { kind: 'selection', startFrame, startX: event.clientX, lane };
			setSelectionPreview({ startFrame, endFrame: startFrame });
			event.currentTarget.setPointerCapture?.(event.pointerId);
			return;
		}
		const clipId = String(clipElement.dataset.clipId);
		const clip = project?.clips.find((item) => String(item.id) === clipId);
		const trackId = lane.dataset.trackId;
		if (!clip || !trackId) return;
		const source = project.sources.find((item) => item.id === clip.sourceId);
		const clipTrack = project.tracks.find((track) => track.id === trackId);
		const clipDisplayMode = clipTrack?.displayMode && clipTrack.displayMode !== 'waveform'
			? clipTrack.displayMode
			: timelineView;
		const sourceDurationFrames = clip.sourceDurationFrames || clip.durationFrames;
		const samplePencilAvailable = Boolean(clip.kind === 'audio' && source && clip.durationFrames && sourceDurationFrames
			&& clipDisplayMode === 'waveform'
			&& pixelsPerSecond >= sampleRate * sourceDurationFrames / clip.durationFrames);
		if (snapshot.sampleEdit?.available && snapshot.sampleEdit.mode === 'pencil' && samplePencilAvailable) {
			const point = samplePointAtPointer(event, lane, clip, source, frameAtClientX);
			pointerSession.current = {
				kind: 'sample-pencil',
				clipId: clip.id,
				trackId,
				channel: point.channel,
				points: [{ timelineFrame: point.timelineFrame, value: point.value }],
				lane,
			};
			run(() => controller.actions.timeline.selectClip(clip.id));
			if (event.pointerType !== 'mouse') event.preventDefault();
			// Firefox's synthesized mouse pointer uses id 0 and may cancel it
			// when capture is requested. A mouse pencil stroke stays within this
			// lane; touch/pen pointers retain capture so releasing outside the
			// clip still finalizes the stroke.
			if (event.pointerId > 0) event.currentTarget.setPointerCapture?.(event.pointerId);
			return;
		}
		if (automationToolEnabled && clipTrack?.type === 'audio') return;
		if (splitToolActive) {
			const startFrame = frameAtClientX(event.clientX, lane);
			const trackIds = event.shiftKey
				? project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id)
				: [trackId];
			pointerSession.current = { kind: 'split', startFrame, trackIds, lane };
			run(() => controller.actions.edit.splitAt(startFrame, trackIds));
			event.preventDefault();
			event.currentTarget.setPointerCapture?.(event.pointerId);
			return;
		}
		const clipEditHandle = event.target.closest('.clip-display__handle');
		let edgeKind = null;
		if (event.target.closest('.clip-display') && !clipEditHandle) {
			const clipRect = clipElement.getBoundingClientRect();
			const distanceFromLeft = event.clientX - clipRect.left;
			const distanceFromRight = clipRect.right - event.clientX;
			if (Math.min(distanceFromLeft, distanceFromRight) <= CLIP_TRIM_EDGE_HIT_WIDTH) {
				edgeKind = distanceFromLeft <= distanceFromRight ? 'trim-left' : 'trim-right';
			}
		}
		let kind = edgeKind || 'move';
		if (clipEditHandle) {
			if (clipEditHandle.classList.contains('clip-display__handle--trim-left')) kind = 'trim-left';
			else if (clipEditHandle.classList.contains('clip-display__handle--trim-right')) kind = 'trim-right';
			else if (clipEditHandle.classList.contains('clip-display__handle--stretch-left')) kind = 'stretch-left';
			else if (clipEditHandle.classList.contains('clip-display__handle--stretch-right')) kind = 'stretch-right';
		}
		const transformClipIds = collectClipTransformIds(project, clip.id);
		const interactionClipIds = kind === 'trim-left' || kind === 'trim-right'
			? collectClipTrimIds(project, clip.id, kind === 'trim-left' ? 'left' : 'right')
			: transformClipIds;
		const session = {
			kind,
			clipId: clip.id,
			clipIds: interactionClipIds,
			trackId,
			original: { ...clip },
			originals: Object.fromEntries(interactionClipIds.map((selectedId) => {
				const selectedClip = project.clips.find((item) => item.id === selectedId);
				return [selectedId, { ...selectedClip }];
			})),
			startX: event.clientX,
			startY: event.clientY,
			lane,
		};
		const slipSlideGesture = captureTimelineSlipSlidePointerGesture({
			session,
			canonicalVideoTrim: snapshot.capabilities?.videoCompositing === true,
			pointerType: event.pointerType,
			isPrimary: event.isPrimary,
			altKey: event.altKey,
			shiftKey: event.shiftKey,
			ctrlKey: event.ctrlKey,
			metaKey: event.metaKey,
			pointerDownSample: frameAtClientX(event.clientX, lane),
			capturePointerAuthority: (capture) => run(() => (
				controller.actions.video.trim.slipSlide.capturePointerAuthority(capture)
			)),
		});
		if (!event.target.closest('.clip-header') && !clipEditHandle && !edgeKind
			&& slipSlideGesture === null) {
			run(() => controller.actions.timeline.selectClip(null));
			const startFrame = frameAtClientX(event.clientX, lane);
			pointerSession.current = { kind: 'selection', startFrame, startX: event.clientX, lane };
			setSelectionPreview({ startFrame, endFrame: startFrame });
			event.currentTarget.setPointerCapture?.(event.pointerId);
			return;
		}
		const rollRippleMode = kind === 'trim-left' || kind === 'trim-right'
			? captureTimelineRollRippleTrimPointerMode({
				session,
				canonicalVideoTrim: snapshot.capabilities?.videoCompositing === true,
				pointerType: event.pointerType,
				altKey: event.altKey,
				shiftKey: event.shiftKey,
			})
			: null;
		const slipSlideMode = slipSlideGesture?.mode ?? null;
		pointerSession.current = {
			...session,
			rollRippleMode,
			slipSlideMode,
			slipSlidePointerAuthority: slipSlideGesture?.authority ?? null,
		};
		setDraggingClipIds(new Set(interactionClipIds));
		const selectedClipIds = project.selection?.clipIds || [];
		if (slipSlideMode !== null) {
			// The captured whole-clip modifier owns this gesture and suppresses selection changes.
		} else if (rollRippleMode === null && event.shiftKey) {
			run(() => controller.actions.timeline.selectClip(clip.id, { additive: true }));
		} else if (rollRippleMode === null && (event.metaKey || event.ctrlKey)) {
			run(() => controller.actions.timeline.selectClip(clip.id, { toggle: true }));
		} else if (!transformClipIds.every((selectedId) => selectedClipIds.includes(selectedId))) {
			run(() => controller.actions.timeline.selectClip(clip.id));
		}
		event.currentTarget.setPointerCapture?.(event.pointerId);
	}, [automationToolEnabled, controller, frameAtClientX, mutationsBlocked, pixelsPerSecond, project, run, sampleRate, showArmControls, snapshot.sampleEdit?.available, snapshot.sampleEdit?.mode, splitToolActive, timelineView, visualTrackHeight]);

	return { onPointerDown };
}
