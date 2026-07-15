import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Button,
	ContextMenu,
	ContextMenuItem,
	FrequencyRuler,
	Icon,
	LabelMarker,
	Menu,
	PlayheadCursor,
	TextInput,
	TimelineRuler,
	ToggleToolButton,
	TrackControlPanel,
	TrackNew,
	useAccessibilityProfile,
	useTabOrder,
	VerticalRuler,
} from '@dilsonspickles/components';

import {
	designValueToPan,
	designVolumeToGainDb,
	framesToSeconds,
	gainDbToDesignVolume,
	panToDesignValue,
	prepareBoundedWaveformWindow,
	projectClipsToViewport,
	secondsToFrames,
} from '../../../lib/tools/audio-editor/design-system-adapters.js';
import {
	envelopeFramesToDesignPoints,
	mergeDesignEnvelopePoints,
} from '../../../lib/tools/audio-editor/automation.js';
import {
	AUDACITY_CLIP_CONTEXT_ACTION_IDS,
	AUDACITY_TRACK_CONTEXT_ACTION_IDS,
	audacityContextMenuAction,
} from '../../../lib/tools/audio-editor/audacity-context-menu.js';
import { projectDurationFrames } from '../../../lib/tools/audio-editor/project.js';
import { useAudioEditorTelemetry, useElementSize } from './DesignSystemRuntime.jsx';
import AudioEditorSampleTools from './AudioEditorSampleTools.jsx';
import RecordingInputSelectors from './RecordingInputSelectors.jsx';

const DESKTOP_TRACK_PANEL_WIDTH = 268;
const COMPACT_TRACK_PANEL_WIDTH = 164;
const TRACK_HEIGHT = 114;
const COLLAPSED_TRACK_HEIGHT = 54;
const RECORDING_INPUT_CONTROLS_HEIGHT = 24;
const VERTICAL_RULER_WIDTH = 40;
const SPECTROGRAM_RULER_WIDTH = 56;
const MINIMUM_TIMELINE_SECONDS = 10;
const MINIMUM_VISIBLE_CLIP_PIXELS = 48;

export default function AudioEditorTimeline({
	controller,
	snapshot,
	locale,
	copy,
	mobile,
	showArmControls,
	splitToolEnabled = false,
	automationToolEnabled = false,
	onToggleSplitTool,
	onError,
	onOpenEffects,
	onOpenClipProperties,
	onExportClip,
	onToggleArmControls,
}) {
	const project = snapshot.project;
	const [timelineRef, timelineSize] = useElementSize();
	const navigationRootRef = useRef(null);
	const scrollRef = useRef(null);
	const pointerSession = useRef(null);
	const touchPointers = useRef(new Map());
	const pinchSession = useRef(null);
	const splitToolTimer = useRef(0);
	const splitToolPress = useRef(null);
	const splitToolHeldRef = useRef(false);
	const [splitToolHeld, setSplitToolHeld] = useState(false);
	const [scrollX, setScrollX] = useState(0);
	const [selectionPreview, setSelectionPreview] = useState(null);
	const [trackMenu, setTrackMenu] = useState(null);
	const [clipMenu, setClipMenu] = useState(null);
	const [draggingClipId, setDraggingClipId] = useState(null);
	const [clipDragPreview, setClipDragPreview] = useState(null);
	const telemetry = useAudioEditorTelemetry(controller);
	const { activeProfile } = useAccessibilityProfile();
	const isFlatNavigation = activeProfile.config.tabNavigation === 'sequential';
	const timelineRulerTabIndex = useTabOrder('timeline-ruler');
	const trackBaseTabIndex = useTabOrder('tracks');
	const addTrackTabIndex = useTabOrder('add-track');
	const panelWidth = mobile ? COMPACT_TRACK_PANEL_WIDTH : DESKTOP_TRACK_PANEL_WIDTH;
	const timelineView = snapshot.timeline?.view;
	const hasFrequencyRuler = snapshot.timeline?.showVerticalRulers !== false
		&& project?.tracks.some((track) => {
			if (track.type === 'label') return false;
			const mode = track.displayMode && track.displayMode !== 'waveform' ? track.displayMode : timelineView;
			return mode === 'spectrogram' || mode === 'multiview';
		});
	const verticalRulerWidth = snapshot.timeline?.showVerticalRulers === false
		? 0
		: (hasFrequencyRuler ? SPECTROGRAM_RULER_WIDTH : VERTICAL_RULER_WIDTH);
	const viewportWidth = Math.max(1, timelineSize.width - panelWidth - verticalRulerWidth);
	const pixelsPerSecond = snapshot.timeline?.pixelsPerSecond || 120;
	const sampleRate = project?.sampleRate || 48_000;
	const recordingPreviews = snapshot.recordingPreviews?.length
		? snapshot.recordingPreviews
		: snapshot.recordingPreview ? [snapshot.recordingPreview] : [];
	const durationFrames = Math.max(
		sampleRate * MINIMUM_TIMELINE_SECONDS,
		project ? projectDurationFrames(project) : 0,
		...recordingPreviews.map((preview) => preview.startFrame + preview.durationFrames),
	);
	const durationSeconds = framesToSeconds(durationFrames, { sampleRate });
	const timelineWidth = Math.max(viewportWidth, Math.ceil(durationSeconds * pixelsPerSecond));
	const viewportStartFrame = Math.max(0, secondsToFrames(scrollX / pixelsPerSecond, { sampleRate }));
	const viewportDurationFrames = Math.max(1, secondsToFrames(viewportWidth / pixelsPerSecond, { sampleRate }));
	const documentSelection = selectionPreview || snapshot.selection;
	const timeSelection = documentSelection && documentSelection.endFrame > documentSelection.startFrame
		? {
			startTime: framesToSeconds(documentSelection.startFrame, { sampleRate }),
			endTime: framesToSeconds(documentSelection.endFrame, { sampleRate }),
		}
		: null;
	const totalTrackHeight = project?.tracks.reduce((total, track) => total + trackVisualHeight(track, showArmControls), 0) || TRACK_HEIGHT;
	const splitToolActive = Boolean(splitToolEnabled || splitToolHeld);

	useEffect(() => {
		const editableTarget = (target) => target instanceof Element && Boolean(target.closest(
			'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]',
		));
		const clearTimer = () => {
			globalThis.clearTimeout(splitToolTimer.current);
			splitToolTimer.current = 0;
		};
		const keyDown = (event) => {
			if (event.repeat || event.key.toLowerCase() !== 's' || event.altKey || event.ctrlKey || event.metaKey || editableTarget(event.target)) return;
			event.preventDefault();
			splitToolPress.current = { persistentBefore: Boolean(splitToolEnabled), held: false };
			splitToolHeldRef.current = true;
			setSplitToolHeld(true);
			clearTimer();
			splitToolTimer.current = globalThis.setTimeout(() => {
				if (splitToolPress.current) splitToolPress.current.held = true;
			}, 300);
		};
		const keyUp = (event) => {
			if (event.key.toLowerCase() !== 's' || !splitToolPress.current) return;
			event.preventDefault();
			const press = splitToolPress.current;
			splitToolPress.current = null;
			clearTimer();
			splitToolHeldRef.current = false;
			setSplitToolHeld(false);
			if (!press.held || press.persistentBefore) onToggleSplitTool?.();
		};
		const blur = () => {
			const press = splitToolPress.current;
			splitToolPress.current = null;
			clearTimer();
			splitToolHeldRef.current = false;
			setSplitToolHeld(false);
			if (press?.persistentBefore) onToggleSplitTool?.();
		};
		const escape = (event) => {
			if (event.key !== 'Escape' || (!splitToolEnabled && !splitToolHeldRef.current)) return;
			event.preventDefault();
			splitToolPress.current = null;
			clearTimer();
			splitToolHeldRef.current = false;
			setSplitToolHeld(false);
			if (splitToolEnabled) onToggleSplitTool?.();
		};
		globalThis.addEventListener('keydown', keyDown, true);
		globalThis.addEventListener('keyup', keyUp, true);
		globalThis.addEventListener('blur', blur);
		globalThis.addEventListener('keydown', escape);
		return () => {
			clearTimer();
			globalThis.removeEventListener('keydown', keyDown, true);
			globalThis.removeEventListener('keyup', keyUp, true);
			globalThis.removeEventListener('blur', blur);
			globalThis.removeEventListener('keydown', escape);
		};
	}, [onToggleSplitTool, splitToolEnabled]);

	const focusTimelineRuler = useCallback(() => {
		return focusFirst(navigationRootRef.current?.querySelector('[data-ruler-focus]'));
	}, []);
	const focusTrackContainer = useCallback((trackIndex) => {
		return focusFirst(trackNavigationRow(navigationRootRef.current, trackIndex)?.querySelector('.track'));
	}, []);
	const focusTrackPanelControl = useCallback((trackIndex, last = false) => {
		const panel = trackNavigationRow(navigationRootRef.current, trackIndex)?.querySelector('.track-control-panel');
		return focusPanelControl(panel, last);
	}, []);
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
	const setTimelineNode = useCallback((node) => {
		timelineRef(node);
		navigationRootRef.current = node;
	}, [timelineRef]);

	const handleTimelineScroll = useCallback((event) => {
		const nextScrollX = Math.max(0, event.currentTarget.scrollLeft);
		event.currentTarget.closest('.audio-editor-timeline-panel')?.style
			.setProperty('--timeline-scroll-x', `${nextScrollX}px`);
		setScrollX(nextScrollX);
	}, []);

	useEffect(() => {
		const element = scrollRef.current;
		if (
			!element
			|| !snapshot.timeline?.pinnedPlayhead
			|| snapshot.timeline?.updateDisplayWhilePlaying === false
			|| telemetry.transportState !== 'playing'
		) return;
		const positionPixels = framesToSeconds(telemetry.positionFrame || 0, { sampleRate }) * pixelsPerSecond;
		const maximumScroll = Math.max(0, timelineWidth - viewportWidth);
		const nextScroll = Math.max(0, Math.min(maximumScroll, positionPixels - viewportWidth / 2));
		if (Math.abs(element.scrollLeft - nextScroll) > 1) element.scrollLeft = nextScroll;
	}, [pixelsPerSecond, sampleRate, snapshot.timeline?.pinnedPlayhead, snapshot.timeline?.updateDisplayWhilePlaying, telemetry.positionFrame, telemetry.transportState, timelineWidth, viewportWidth]);

	const run = useCallback((action) => {
		try {
			const value = action();
			if (value && typeof value.catch === 'function') value.catch(onError);
			return value;
		} catch (error) {
			onError(error);
			return undefined;
		}
	}, [onError]);

	const openClipMenu = useCallback((clipId, x, y, openedViaKeyboard = false) => {
		const clip = project?.clips.find((item) => String(item.id) === String(clipId));
		if (!clip) return;
		run(() => controller.actions.timeline.selectClip(clip.id));
		setClipMenu({
			clipId: clip.id,
			x: Number.isFinite(x) ? x : 0,
			y: Number.isFinite(y) ? y : 0,
			autoFocus: Boolean(openedViaKeyboard),
		});
	}, [controller, project, run]);

	const onClipContextMenu = useCallback((event) => {
		const clipElement = event.target.closest?.('[data-clip-id]');
		if (!clipElement) return;
		event.preventDefault();
		event.stopPropagation();
		openClipMenu(clipElement.dataset.clipId, event.clientX, event.clientY);
	}, [openClipMenu]);

	const frameAtClientX = useCallback((clientX, lane) => {
		const rect = lane.getBoundingClientRect();
		return secondsToFrames(Math.max(0, (scrollX + clientX - rect.left) / pixelsPerSecond), {
			maximumFrame: durationFrames,
			sampleRate,
		});
	}, [durationFrames, pixelsPerSecond, sampleRate, scrollX]);

	const trackAtClientY = useCallback((clientY, fallbackTrackId) => {
		for (const lane of document.querySelectorAll('[data-track-lane]')) {
			if (lane.closest('[data-label-track]')) continue;
			const rect = lane.getBoundingClientRect();
			if (clientY >= rect.top && clientY < rect.bottom) return lane.dataset.trackId || fallbackTrackId;
		}
		return fallbackTrackId;
	}, []);

	const finishPointerSession = useCallback((event, cancelled = false) => {
		const session = pointerSession.current;
		pointerSession.current = null;
		setDraggingClipId(null);
		const dragPreview = session?.preview;
		setClipDragPreview(null);
		if (!session || cancelled || pinchSession.current || !project) return;
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
				if (session.lane.dataset.rulerInteraction !== undefined && snapshot.timeline?.playbackOnRulerClick !== false && telemetry.transportState === 'stopped') {
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
		if (Math.abs(deltaFrames) < Math.max(1, secondsToFrames(3 / pixelsPerSecond, { sampleRate }))) {
			run(() => controller.actions.transport.seek(frameAtClientX(event.clientX, session.lane)));
			return;
		}
		const clip = project.clips.find((item) => item.id === session.clipId);
		if (!clip) return;
		if (session.kind === 'move') {
			const trackId = dragPreview?.trackId || trackAtClientY(event.clientY, session.trackId);
			const timelineStartFrame = dragPreview?.timelineStartFrame ?? Math.max(0, session.original.timelineStartFrame + deltaFrames);
			const targetTrack = project.tracks.find((track) => track.id === trackId);
			const overlaps = targetTrack?.clipIds.some((clipId) => {
				if (clipId === clip.id) return false;
				const inactiveClip = project.clips.find((item) => item.id === clipId);
				return inactiveClip
					&& timelineStartFrame < inactiveClip.timelineStartFrame + inactiveClip.durationFrames
					&& inactiveClip.timelineStartFrame < timelineStartFrame + clip.durationFrames;
			});
			if (overlaps) {
				run(() => controller.actions.clip.overwrite(clip.id, trackId, { timelineStartFrame }));
			} else {
				run(() => controller.actions.clip.move(clip.id, trackId, timelineStartFrame));
			}
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
		} else if (session.kind === 'trim-left') {
			const source = project.sources.find((item) => item.id === clip.sourceId);
			const sourceExtension = session.original.reversed
				? source.frameCount - session.original.sourceStartFrame - session.original.durationFrames
				: session.original.sourceStartFrame;
			const change = Math.max(
				-Math.min(session.original.timelineStartFrame, sourceExtension),
				Math.min(session.original.durationFrames - 1, deltaFrames),
			);
			run(() => controller.actions.clip.overwrite(clip.id, session.trackId, {
				timelineStartFrame: session.original.timelineStartFrame + change,
				sourceStartFrame: session.original.sourceStartFrame + (session.original.reversed ? 0 : change),
				durationFrames: session.original.durationFrames - change,
			}));
		} else if (session.kind === 'trim-right') {
			const source = project.sources.find((item) => item.id === clip.sourceId);
			const maximum = session.original.reversed
				? session.original.sourceStartFrame + session.original.durationFrames
				: source.frameCount - session.original.sourceStartFrame;
			const nextDuration = Math.max(1, Math.min(maximum, session.original.durationFrames + deltaFrames));
			run(() => controller.actions.clip.overwrite(clip.id, session.trackId, {
				sourceStartFrame: session.original.reversed
					? session.original.sourceStartFrame + session.original.durationFrames - nextDuration
					: session.original.sourceStartFrame,
				durationFrames: nextDuration,
			}));
		}
	}, [controller, frameAtClientX, pixelsPerSecond, project, run, sampleRate, snapshot.timeline?.playbackOnRulerClick, telemetry.transportState, trackAtClientY]);

	const onPointerDown = useCallback((event) => {
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
				pointerSession.current = null;
				return;
			}
		}
		if (event.button !== 0 || snapshot.readOnly || snapshot.recording || snapshot.recordingStarting) return;
		const interactiveControl = event.target.closest?.('button, input, textarea, select, [role="menuitem"]');
		if (interactiveControl && !interactiveControl.classList.contains('clip-display__handle')) return;
		if (event.target.closest?.('[data-label-id]')) return;
		const clipElement = event.target.closest('[data-clip-id]');
		const lane = event.target.closest('[data-track-lane]');
		if (!lane) return;
		if (automationToolEnabled && !lane.closest('[data-label-track]')) return;
		if (!clipElement) {
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
		if (snapshot.sampleEdit?.available && snapshot.sampleEdit.mode === 'pencil') {
			const source = project.sources.find((item) => item.id === clip.sourceId);
			if (!source) return;
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
		const clipEditHandle = event.target.closest('.clip-display__handle');
		if (!event.target.closest('.clip-header') && !clipEditHandle) {
			const startFrame = frameAtClientX(event.clientX, lane);
			pointerSession.current = { kind: 'selection', startFrame, startX: event.clientX, lane };
			setSelectionPreview({ startFrame, endFrame: startFrame });
			event.currentTarget.setPointerCapture?.(event.pointerId);
			return;
		}
		let kind = 'move';
		if (event.target.closest('.clip-display__handle--trim-left')) kind = 'trim-left';
		if (event.target.closest('.clip-display__handle--trim-right')) kind = 'trim-right';
		if (event.target.closest('.clip-display__handle--stretch-left')) kind = 'stretch-left';
		if (event.target.closest('.clip-display__handle--stretch-right')) kind = 'stretch-right';
		pointerSession.current = { kind, clipId: clip.id, trackId, original: { ...clip }, startX: event.clientX, lane };
		setDraggingClipId(clip.id);
		if (!event.shiftKey && !event.metaKey && !event.ctrlKey) {
			run(() => controller.actions.timeline.selectClip(clip.id));
		}
		event.currentTarget.setPointerCapture?.(event.pointerId);
	}, [automationToolEnabled, controller, frameAtClientX, pixelsPerSecond, project, run, snapshot.readOnly, snapshot.recording, snapshot.recordingStarting, snapshot.sampleEdit?.available, snapshot.sampleEdit?.mode, splitToolActive]);

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
				run(() => controller.actions.timeline.setZoom(nextZoom));
				requestAnimationFrame(() => {
					if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, anchorSeconds * nextZoom - (midpoint - (rect?.left || 0) - panelWidth));
				});
			}
			return;
		}
		const session = pointerSession.current;
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
			const deltaFrames = secondsToFrames(
				Math.abs(event.clientX - session.startX) / pixelsPerSecond,
				{ sampleRate },
			) * Math.sign(event.clientX - session.startX);
			const preview = {
				clipId: session.clipId,
				trackId: trackAtClientY(event.clientY, session.trackId),
				timelineStartFrame: Math.max(0, session.original.timelineStartFrame + deltaFrames),
			};
			session.preview = preview;
			setClipDragPreview((current) => (
				current?.clipId === preview.clipId
				&& current.trackId === preview.trackId
				&& current.timelineStartFrame === preview.timelineStartFrame
					? current
					: preview
			));
		} else if (session?.kind === 'stretch-left' || session?.kind === 'stretch-right') {
			const deltaFrames = secondsToFrames(
				Math.abs(event.clientX - session.startX) / pixelsPerSecond,
				{ sampleRate },
			) * Math.sign(event.clientX - session.startX);
			const change = session.kind === 'stretch-left'
				? Math.max(-session.original.timelineStartFrame, Math.min(session.original.durationFrames - 1, deltaFrames))
				: 0;
			const preview = {
				clipId: session.clipId,
				trackId: session.trackId,
				timelineStartFrame: session.original.timelineStartFrame + change,
				durationFrames: session.kind === 'stretch-left'
					? session.original.durationFrames - change
					: Math.max(1, session.original.durationFrames + deltaFrames),
			};
			session.preview = preview;
			setClipDragPreview(preview);
		}
	}, [controller, frameAtClientX, panelWidth, pixelsPerSecond, project, run, sampleRate, trackAtClientY]);

	const finishTouch = useCallback((event) => {
		touchPointers.current.delete(event.pointerId);
		if (touchPointers.current.size < 2) pinchSession.current = null;
	}, []);

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

	if (!project) {
		return <div className="audio-editor-timeline-loading" role="status">{copy.loading}</div>;
	}

	const menuTrack = trackMenu ? project.tracks.find((track) => track.id === trackMenu.trackId) : null;
	const menuClip = clipMenu ? project.clips.find((clip) => clip.id === clipMenu.clipId) : null;
	const mutationsBlocked = snapshot.readOnly
		|| snapshot.importing
		|| snapshot.recording
		|| snapshot.recordingStarting
		|| snapshot.exporting
		|| snapshot.processingEffect;
	const contextLocale = locale;
	const unavailableReason = copy.unavailable;
	const trackMenuItems = menuTrack ? [
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.showArmControls, copy.showArmControls, {
			checked: showArmControls,
			onClick: onToggleArmControls,
		}, contextLocale, unavailableReason),
		{ divider: true, label: '' },
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.duplicate, copy.duplicateTrack, {
			disabled: snapshot.readOnly || menuTrack.type === 'label',
			onClick: () => run(() => controller.actions.track.duplicate(menuTrack.id)),
		}, contextLocale, unavailableReason),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveTop, copy.moveTrackTop, {
			disabled: snapshot.readOnly || project.tracks[0]?.id === menuTrack.id,
			onClick: () => run(() => controller.actions.track.moveTop(menuTrack.id)),
		}, contextLocale, unavailableReason),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveUp, copy.moveTrackUp, {
			disabled: snapshot.readOnly || project.tracks[0]?.id === menuTrack.id,
			onClick: () => run(() => controller.actions.track.moveUp(menuTrack.id)),
		}, contextLocale, unavailableReason),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveDown, copy.moveTrackDown, {
			disabled: snapshot.readOnly || project.tracks.at(-1)?.id === menuTrack.id,
			onClick: () => run(() => controller.actions.track.moveDown(menuTrack.id)),
		}, contextLocale, unavailableReason),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveBottom, copy.moveTrackBottom, {
			disabled: snapshot.readOnly || project.tracks.at(-1)?.id === menuTrack.id,
			onClick: () => run(() => controller.actions.track.moveBottom(menuTrack.id)),
		}, contextLocale, unavailableReason),
		...(menuTrack.type === 'label' ? [] : [
			{ divider: true, label: '' },
			manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.waveform, copy.waveformView, {
				checked: menuTrack.displayMode === 'waveform',
				onClick: () => run(() => controller.actions.track.setWaveformView(menuTrack.id)),
			}, contextLocale, unavailableReason),
			manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.spectrogram, copy.spectrogramView, {
				checked: menuTrack.displayMode === 'spectrogram',
				onClick: () => run(() => controller.actions.track.setSpectrogramView(menuTrack.id)),
			}, contextLocale, unavailableReason),
			manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.multiview, copy.multiview, {
				checked: menuTrack.displayMode === 'multiview',
				onClick: () => run(() => controller.actions.track.setMultiView(menuTrack.id)),
			}, contextLocale, unavailableReason),
		]),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.toggleCollapsed, menuTrack.collapsed ? copy.expandTrack : copy.collapseTrack, {
			disabled: snapshot.readOnly,
			onClick: () => run(() => controller.actions.track.update(menuTrack.id, { collapsed: !menuTrack.collapsed })),
		}, contextLocale, unavailableReason),
		{ divider: true, label: '' },
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.remove, copy.deleteTrack, {
			disabled: snapshot.readOnly,
			onClick: () => run(() => controller.actions.track.remove(menuTrack.id)),
		}, contextLocale, unavailableReason),
	].filter(Boolean) : [];
	return (
		<section
			className="audio-editor-timeline-panel"
			aria-label={copy.timeline}
			ref={setTimelineNode}
			data-sample-pencil={snapshot.sampleEdit?.mode === 'pencil' ? 'true' : 'false'}
			data-split-tool={splitToolActive ? 'true' : 'false'}
			data-automation-tool={automationToolEnabled ? 'true' : 'false'}
			style={{
				'--track-panel-width': `${panelWidth}px`,
				'--timeline-viewport-width': `${viewportWidth}px`,
				'--timeline-scroll-x': `${scrollX}px`,
				'--vertical-ruler-width': `${verticalRulerWidth}px`,
			}}
		>
			<div
				className="audio-editor-timeline-scroll"
				data-timeline
				ref={scrollRef}
				onScroll={handleTimelineScroll}
				onPointerDownCapture={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={(event) => { finishTouch(event); finishPointerSession(event); }}
				onPointerCancel={(event) => {
					finishTouch(event);
					// Firefox can cancel its id-0 mouse pointer after a valid drawn
					// segment. Publish that partial pencil stroke; true touch/pen
					// cancellations remain transactional rollbacks.
					const mouseCancellation = event.pointerType === 'mouse' || event.pointerId === 0;
					finishPointerSession(event, !mouseCancellation);
				}}
				onContextMenu={onClipContextMenu}
				onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
				onDrop={(event) => {
					event.preventDefault();
					const files = [...event.dataTransfer.files];
					if (files.length) run(() => controller.actions.project.importFiles(files));
				}}
			>
				<div className="audio-editor-timeline-inner" style={{
					width: panelWidth + timelineWidth + verticalRulerWidth,
					'--audio-editor-track-sidebar-width': `${panelWidth}px`,
				}}>
					<div className="audio-editor-ruler-row">
						<div className="audio-editor-ruler-corner" style={{ width: panelWidth }}>
							<span>{copy.tracks}</span>
							<Button
								variant="secondary"
								size="small"
								icon={<Icon name="plus" size={14} />}
								disabled={mutationsBlocked}
								tabIndex={addTrackTabIndex}
								onClick={() => run(() => controller.actions.track.add())}
							>
								{copy.addTrack}
							</Button>
						</div>
						<div
							className="audio-editor-ruler-viewport"
							data-ruler
							data-ruler-focus
							data-ruler-interaction
							data-track-lane
							data-track-id={snapshot.selectedTrackId || project.tracks[0]?.id || ''}
							role="region"
							aria-label={copy.timeline}
							tabIndex={timelineRulerTabIndex}
							style={{ left: panelWidth, width: viewportWidth }}
							onKeyDown={(event) => {
								if (event.key === 'Tab' && !event.shiftKey && project.tracks.length) {
									event.preventDefault();
									focusTrackContainer(0);
								} else if (event.key === 'Escape') {
									event.currentTarget.blur();
								}
							}}
						>
							<TelemetryTimelineRuler
								controller={controller}
								pixelsPerSecond={pixelsPerSecond}
								scrollX={scrollX}
								totalDuration={durationSeconds}
								width={timelineWidth}
								viewportWidth={viewportWidth}
								timeSelection={timeSelection}
								sampleRate={sampleRate}
								loopRegionEnabled={Boolean(project.loop?.enabled)}
								loopRegionStart={framesToSeconds(project.loop?.startFrame || 0, { sampleRate })}
								loopRegionEnd={framesToSeconds(project.loop?.endFrame || 0, { sampleRate })}
								onLoopRegionEnabledToggle={() => run(() => controller.actions.transport.toggleLoop())}
							/>
						</div>
						{verticalRulerWidth > 0 && <div
							className="audio-editor-ruler-scale-corner"
							aria-hidden="true"
							style={{ left: panelWidth + viewportWidth, width: verticalRulerWidth }}
						/>}
					</div>

					<div className="audio-editor-track-list" data-track-list>
						{project.tracks.map((track, trackIndex) => track.type === 'label' ? (
							<LabelTrackRow
								key={track.id}
								controller={controller}
								track={track}
								trackIndex={trackIndex}
								panelWidth={panelWidth}
								timelineWidth={timelineWidth}
								verticalRulerWidth={verticalRulerWidth}
								pixelsPerSecond={pixelsPerSecond}
								sampleRate={sampleRate}
								selection={documentSelection}
								selected={snapshot.selectedTrackId === track.id}
								blocked={snapshot.readOnly || snapshot.importing || snapshot.recording || snapshot.recordingStarting || snapshot.exporting || snapshot.processingEffect}
								copy={copy}
								run={run}
								onMenu={(anchor) => setTrackMenu({ trackId: track.id, anchor })}
							/>
						) : (
							<TrackRow
								key={track.id}
								controller={controller}
								project={project}
								track={track}
								trackIndex={trackIndex}
								trackCount={project.tracks.length}
								isFlatNavigation={isFlatNavigation}
								trackBaseTabIndex={trackBaseTabIndex}
								panelWidth={panelWidth}
								viewportWidth={viewportWidth}
								viewportStartFrame={viewportStartFrame}
								viewportDurationFrames={viewportDurationFrames}
								pixelsPerSecond={pixelsPerSecond}
								sampleRate={sampleRate}
								timelineWidth={timelineWidth}
								verticalRulerWidth={verticalRulerWidth}
								selection={timeSelection}
								spectralSelection={documentSelection?.frequencyRange ? documentSelection : null}
								selectedTrackId={snapshot.selectedTrackId}
								selectedClipId={snapshot.selectedClipId}
								selectedClipIds={project.selection?.clipIds || []}
								timelineView={snapshot.timeline?.view}
								showRms={Boolean(snapshot.timeline?.showRms)}
								clipStyle={snapshot.preferences?.appearance?.clipStyle}
								recordingPreview={recordingPreviews.find((preview) => preview.trackId === track.id) || null}
								draggingClipId={draggingClipId}
								clipDragPreview={clipDragPreview}
								automationToolEnabled={automationToolEnabled}
								blocked={snapshot.readOnly || snapshot.importing || snapshot.recording || snapshot.recordingStarting || snapshot.exporting || snapshot.processingEffect}
								showArmControls={showArmControls}
								recordingInputs={snapshot.recordingInputs}
								copy={copy}
								run={run}
								onMenu={(anchor) => setTrackMenu({ trackId: track.id, anchor })}
								onOpenEffects={onOpenEffects}
								onOpenClipMenu={openClipMenu}
								onFocusTimelineRuler={focusTimelineRuler}
								onFocusTrackContainer={focusTrackContainer}
								onFocusTrackPanelControl={focusTrackPanelControl}
								onFocusTrackClip={focusTrackClip}
								onFocusTrackRuler={focusTrackRuler}
								onFocusSelectionToolbar={focusSelectionToolbar}
							/>
						))}
					</div>

					{project.tracks.length === 0 && project.clips.length === 0 && (
						<div className="audio-editor-empty-state" style={{ left: panelWidth + 24 }}>
							<strong>{copy.emptyTitle}</strong>
							<p>{copy.emptyText}</p>
						</div>
					)}

					<TelemetryPlayhead
						controller={controller}
						copy={copy}
						durationFrames={durationFrames}
						panelWidth={panelWidth}
						viewportWidth={viewportWidth}
						pixelsPerSecond={pixelsPerSecond}
						sampleRate={sampleRate}
						height={Math.max(TRACK_HEIGHT, totalTrackHeight)}
						scrollX={scrollX}
						run={run}
					/>
				</div>
			</div>

			<AudioEditorSampleTools controller={controller} snapshot={snapshot} copy={copy} run={run} />

			<Menu
				isOpen={Boolean(trackMenu && menuTrack)}
				anchorEl={trackMenu?.anchor || null}
				onClose={() => setTrackMenu(null)}
				className="audio-editor-track-menu"
				items={trackMenuItems}
			/>

			<ContextMenu
				isOpen={Boolean(clipMenu && menuClip)}
				x={clipMenu?.x || 0}
				y={clipMenu?.y || 0}
				autoFocus={Boolean(clipMenu?.autoFocus)}
				onClose={() => setClipMenu(null)}
				className="audio-editor-clip-context-menu"
			>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.properties}
					label={copy.clipPropertiesCommand}
					disabled={!menuClip}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => {
						if (!menuClip) return;
						run(() => controller.actions.timeline.selectClip(menuClip.id));
						const clipElement = document.querySelector(`[data-clip-id="${menuClip.id}"]`);
						clipElement?.focus?.({ preventScroll: true });
						onOpenClipProperties?.(menuClip.id);
					}}
					onClose={() => setClipMenu(null)}
				/>
				<ContextMenuItem isDivider />
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.split}
					label={copy.split}
					disabled={mutationsBlocked || !menuClip}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.edit.split())}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.reverse}
					label={copy.reverse}
					disabled={mutationsBlocked || !menuClip}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.reverse(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.normalizePeak}
					label={copy.normalizePeak}
					disabled={mutationsBlocked || !menuClip}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.normalizePeak(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.renderPitchSpeed}
					label={copy.renderPitchSpeed}
					disabled={mutationsBlocked || !menuClip || (menuClip.pitchCents === 0 && menuClip.speedRatio === 1)}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.renderPitchSpeed(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.resetPitchSpeed}
					label={copy.resetPitchSpeed}
					disabled={mutationsBlocked || !menuClip || (menuClip.pitchCents === 0 && menuClip.speedRatio === 1)}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.resetPitchSpeed(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.stretchToTempo}
					label={copy.stretchToTempo}
					checked={Boolean(menuClip?.stretchToTempo)}
					disabled={mutationsBlocked || !menuClip}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.toggleStretchToTempo(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ContextMenuItem isDivider />
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.export}
					label={copy.exportClip}
					disabled={!menuClip}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && onExportClip?.(menuClip.id)}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.remove}
					label={copy.deleteClip || copy.liftDelete}
					disabled={mutationsBlocked || !menuClip}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.remove(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
			</ContextMenu>
		</section>
	);
}

function manifestMenuItem(actionId, label, item, locale, disabledReason) {
	const action = audacityContextMenuAction(actionId, {
		locale,
		label,
		disabled: item.disabled,
		disabledReason,
		shortcut: item.shortcut,
	});
	if (action.hidden) return null;
	return {
		...item,
		label: <ContextActionLabel action={action} />,
		shortcut: action.shortcut || undefined,
		disabled: action.disabled,
		onClick: action.disabled ? undefined : item.onClick,
	};
}

function ManifestContextMenuItem({ actionId, label, disabled, disabledReason, locale, onClick, ...props }) {
	const action = audacityContextMenuAction(actionId, { locale, label, disabled, disabledReason });
	if (action.hidden) return null;
	return (
		<ContextMenuItem
			{...props}
			label={<ContextActionLabel action={action} />}
			shortcut={action.shortcut || undefined}
			disabled={action.disabled}
			onClick={action.disabled ? undefined : onClick}
		/>
	);
}

function ContextActionLabel({ action }) {
	return (
		<span
			data-action-id={action.actionId}
			data-parity-status={action.parityStatus}
			data-action-origin={action.origin}
			data-enable-when={action.enableWhen || undefined}
			data-upstream-action={action.upstreamAction || undefined}
			data-disabled-reason={action.disabledReason || undefined}
			title={action.disabledReason || undefined}
		>
			{action.label}
		</span>
	);
}

function TelemetryTimelineRuler({ controller, sampleRate, ...props }) {
	const telemetry = useAudioEditorTelemetry(controller);
	return <TimelineRuler {...props} cursorPosition={framesToSeconds(telemetry.positionFrame || 0, { sampleRate })} />;
}

function TelemetryPlayhead({
	controller,
	copy,
	durationFrames,
	panelWidth,
	viewportWidth,
	pixelsPerSecond,
	sampleRate,
	height,
	scrollX,
	run,
}) {
	const telemetry = useAudioEditorTelemetry(controller);
	return (
		<div
			className="audio-editor-playhead-boundary"
			data-playhead
			role="slider"
			tabIndex={0}
			aria-label={copy.playhead}
			aria-valuemin={0}
			aria-valuemax={durationFrames}
			aria-valuenow={telemetry.positionFrame || 0}
			style={{ left: panelWidth, width: viewportWidth }}
			onKeyDown={(event) => {
				const amount = event.shiftKey ? Math.round(sampleRate / 10) : 1;
				if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
					event.preventDefault();
					run(() => controller.actions.transport.seek((telemetry.positionFrame || 0) + (event.key === 'ArrowLeft' ? -amount : amount)));
				} else if (event.key === 'Home' || event.key === 'End') {
					event.preventDefault();
					run(() => controller.actions.transport.seek(event.key === 'Home' ? 0 : durationFrames));
				}
			}}
		>
			<PlayheadCursor
				position={framesToSeconds(telemetry.positionFrame || 0, { sampleRate })}
				pixelsPerSecond={pixelsPerSecond}
				height={height}
				showTopIcon
				iconTopOffset={-17}
				scrollX={scrollX}
				minPosition={0}
				onPositionChange={(seconds) => run(() => controller.actions.transport.seek(secondsToFrames(seconds, { maximumFrame: durationFrames, sampleRate })))}
			/>
		</div>
	);
}

function TrackRow({
	controller,
	project,
	track,
	trackIndex,
	trackCount,
	isFlatNavigation,
	trackBaseTabIndex,
	panelWidth,
	viewportWidth,
	viewportStartFrame,
	viewportDurationFrames,
	pixelsPerSecond,
	sampleRate,
	timelineWidth,
	verticalRulerWidth,
	selection,
	spectralSelection,
	selectedTrackId,
	selectedClipId,
	selectedClipIds,
	timelineView,
	showRms,
	clipStyle,
	recordingPreview,
	draggingClipId,
	clipDragPreview,
	automationToolEnabled,
	blocked,
	showArmControls,
	recordingInputs,
	copy,
	run,
	onMenu,
	onOpenEffects,
	onOpenClipMenu,
	onFocusTimelineRuler,
	onFocusTrackContainer,
	onFocusTrackPanelControl,
	onFocusTrackClip,
	onFocusTrackRuler,
	onFocusSelectionToolbar,
}) {
	const trackWindowRef = useRef(null);
	const envelopePreviewRef = useRef(new Map());
	const [envelopePreviewRevision, setEnvelopePreviewRevision] = useState(0);
	const trackHeight = trackVisualHeight(track, showArmControls);
	const displayMode = track.displayMode && track.displayMode !== 'waveform' ? track.displayMode : timelineView;
	const spectrogramScale = normalizeSpectrogramScale(track.spectrogram?.scale);
	const clipLookup = useMemo(() => new Map(project.clips.map((clip) => [clip.id, clip])), [project.clips]);
	const selectedClipIdSet = useMemo(() => new Set(selectedClipIds || []), [selectedClipIds]);
	const clips = useMemo(() => {
		const trackClips = track.clipIds.map((clipId) => clipLookup.get(clipId)).filter(Boolean);
		const withRecordingPreview = recordingPreview?.durationFrames > 0 ? [...trackClips, {
			id: recordingPreviewId(track.id),
			timelineStartFrame: recordingPreview.startFrame,
			durationFrames: recordingPreview.durationFrames,
			sourceDurationFrames: recordingPreview.durationFrames,
			isRecordingPreview: true,
		}] : trackClips;
		if (!clipDragPreview) return withRecordingPreview;
		const draggedClip = clipLookup.get(clipDragPreview.clipId);
		if (!draggedClip) return withRecordingPreview;
		if (track.id === clipDragPreview.trackId) {
			const previewClip = { ...draggedClip, ...clipDragPreview };
			return withRecordingPreview.some((clip) => clip.id === draggedClip.id)
				? withRecordingPreview.map((clip) => (clip.id === draggedClip.id ? previewClip : clip))
				: [...withRecordingPreview, previewClip];
		}
		return withRecordingPreview.filter((clip) => clip.id !== draggedClip.id);
	}, [clipDragPreview, clipLookup, recordingPreview, track.clipIds, track.id]);
	const projection = useMemo(() => projectClipsToViewport(clips, {
		viewportStartFrame,
		viewportDurationFrames,
		sampleRate,
	}), [clips, sampleRate, viewportDurationFrames, viewportStartFrame]);
	const windowLeft = framesToSeconds(projection.overscanStartFrame, { sampleRate }) * pixelsPerSecond;
	const windowFrames = Math.max(1, projection.overscanEndFrame - projection.overscanStartFrame);
	const windowWidth = Math.max(1, framesToSeconds(windowFrames, { sampleRate }) * pixelsPerSecond);
	const projectedClips = projection.clips.map((clip) => clip.isRecordingPreview
		? toDesignRecordingPreview(clip, recordingPreview, projection.overscanStartFrame, pixelsPerSecond, sampleRate, copy)
		: toDesignClip(
			controller,
			project,
			clip,
			projection.overscanStartFrame,
			pixelsPerSecond,
			selectedClipIdSet.size ? selectedClipIdSet : selectedClipId,
			sampleRate,
			copy,
			showRms,
			displayMode === 'half-wave',
		)).map((clip) => {
			const preview = envelopePreviewRef.current.get(String(clip.id));
			return preview ? { ...clip, envelopePoints: preview.designPoints } : clip;
		});
	const projectedSelection = selection ? {
		startTime: selection.startTime - framesToSeconds(projection.overscanStartFrame, { sampleRate }),
		endTime: selection.endTime - framesToSeconds(projection.overscanStartFrame, { sampleRate }),
	} : null;
	const activeSpectralSelection = spectralSelection?.frequencyRange && selectedTrackId === track.id
		? spectralSelection
		: null;
	const tabIndexFor = (offset) => isFlatNavigation ? 0 : trackBaseTabIndex + trackIndex * 4 + offset;

	useEffect(() => {
		const finishEnvelopeEdit = () => queueMicrotask(() => {
			const previews = [...envelopePreviewRef.current.values()];
			if (!previews.length) return;
			envelopePreviewRef.current.clear();
			setEnvelopePreviewRevision((revision) => revision + 1);
			for (const preview of previews) {
				run(() => controller.actions.clip.update(preview.clipId, { envelope: preview.envelope }));
			}
		});
		document.addEventListener('mouseup', finishEnvelopeEdit);
		return () => document.removeEventListener('mouseup', finishEnvelopeEdit);
	}, [controller, run]);

	useEffect(() => {
		if (automationToolEnabled) return;
		envelopePreviewRef.current.clear();
		setEnvelopePreviewRevision((revision) => revision + 1);
	}, [automationToolEnabled]);

	const updateEnvelope = (clipId, designPoints) => {
		if (blocked || !automationToolEnabled) return;
		const canonical = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		const projected = projection.clips.find((clip) => String(clip.id) === String(clipId));
		if (!canonical || !projected) return;
		const startFrame = projected.waveformStartFrame;
		const endFrame = projected.waveformEndFrame;
		envelopePreviewRef.current.set(String(canonical.id), {
			clipId: canonical.id,
			designPoints,
			envelope: mergeDesignEnvelopePoints(
				canonical.envelope,
				designPoints,
				sampleRate,
				canonical.durationFrames,
				{ startFrame, endFrame, maximumValue: 2 },
			),
		});
		setEnvelopePreviewRevision((revision) => revision + 1);
	};
	void envelopePreviewRevision;

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
	}, [isFlatNavigation, projectedClips, trackBaseTabIndex, trackIndex]);
	const focusBeforeTrack = () => {
		if (trackIndex === 0) return onFocusTimelineRuler();
		const previousTrack = trackIndex - 1;
		if (onFocusTrackRuler(previousTrack)) return true;
		if (onFocusTrackClip(previousTrack, true)) return true;
		if (onFocusTrackPanelControl(previousTrack, true)) return true;
		return onFocusTrackContainer(previousTrack);
	};
	const focusAfterPanel = () => {
		if (onFocusTrackClip(trackIndex)) return true;
		return onFocusTrackRuler(trackIndex);
	};
	const focusBeforeRuler = () => {
		if (onFocusTrackClip(trackIndex, true)) return true;
		if (onFocusTrackPanelControl(trackIndex, true)) return true;
		return onFocusTrackContainer(trackIndex);
	};
	const focusAfterRuler = () => {
		if (trackIndex + 1 < trackCount) return onFocusTrackContainer(trackIndex + 1);
		return onFocusSelectionToolbar();
	};
	const moveClipBySeconds = (clipId, deltaSeconds) => {
		if (blocked) return;
		const clip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		const deltaFrames = secondsDeltaToFrames(deltaSeconds, sampleRate);
		if (!clip || !deltaFrames) return;
		run(() => controller.actions.clip.move(
			clip.id,
			track.id,
			Math.max(0, clip.timelineStartFrame + deltaFrames),
		));
	};
	const moveClipToTrack = (clipId, direction) => {
		if (blocked) return;
		const clip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		const targetTrackIndex = trackIndex + direction;
		const targetTrack = project.tracks[targetTrackIndex];
		if (!clip || !targetTrack || targetTrack.type === 'label') return;
		const moved = run(() => controller.actions.clip.move(clip.id, targetTrack.id, clip.timelineStartFrame));
		if (!moved) return;
		requestAnimationFrame(() => requestAnimationFrame(() => {
			onFocusTrackClip(targetTrackIndex, false, clip.id);
		}));
	};
	const navigateClipVertical = (clipId, direction) => {
		const sourceClip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		if (!sourceClip || trackCount < 2) return;
		for (let distance = 1; distance < trackCount; distance += 1) {
			const candidateIndex = (trackIndex + direction * distance + trackCount) % trackCount;
			const candidateTrack = project.tracks[candidateIndex];
			if (!Array.isArray(candidateTrack.clipIds)) continue;
			const candidateClips = candidateTrack.clipIds
				.map((candidateId) => clipLookup.get(candidateId))
				.filter(Boolean);
			if (!candidateClips.length) continue;
			const closest = candidateClips.reduce((best, candidate) => (
				Math.abs(candidate.timelineStartFrame - sourceClip.timelineStartFrame)
					< Math.abs(best.timelineStartFrame - sourceClip.timelineStartFrame)
					? candidate
					: best
			));
			onFocusTrackClip(candidateIndex, false, closest.id);
			return;
		}
	};
	const trimClipBySeconds = (clipId, edge, deltaSeconds) => {
		if (blocked) return;
		const clip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		const source = clip ? project.sources.find((item) => item.id === clip.sourceId) : null;
		const deltaFrames = secondsDeltaToFrames(deltaSeconds, sampleRate);
		if (!clip || !source || !deltaFrames) return;
		if (edge === 'left') {
			const sourceExtension = clip.reversed
				? source.frameCount - clip.sourceStartFrame - clip.durationFrames
				: clip.sourceStartFrame;
			const change = Math.max(
				-Math.min(clip.timelineStartFrame, sourceExtension),
				Math.min(clip.durationFrames - 1, deltaFrames),
			);
			if (!change) return;
			run(() => controller.actions.clip.trim(clip.id, {
				timelineStartFrame: clip.timelineStartFrame + change,
				sourceStartFrame: clip.sourceStartFrame + (clip.reversed ? 0 : change),
				durationFrames: clip.durationFrames - change,
			}));
			return;
		}
		const maximumDuration = clip.reversed
			? clip.sourceStartFrame + clip.durationFrames
			: source.frameCount - clip.sourceStartFrame;
		const nextDuration = Math.max(1, Math.min(maximumDuration, clip.durationFrames - deltaFrames));
		if (nextDuration === clip.durationFrames) return;
		run(() => controller.actions.clip.trim(clip.id, {
			sourceStartFrame: clip.reversed
				? clip.sourceStartFrame + clip.durationFrames - nextDuration
				: clip.sourceStartFrame,
			durationFrames: nextDuration,
		}));
	};
	const stretchClipBySeconds = (clipId, edge, deltaSeconds) => {
		if (blocked) return;
		const clip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		const deltaFrames = secondsDeltaToFrames(deltaSeconds, sampleRate);
		if (!clip || !deltaFrames) return;
		if (edge === 'left') {
			const change = Math.max(-clip.timelineStartFrame, Math.min(clip.durationFrames - 1, deltaFrames));
			if (!change) return;
			run(() => controller.actions.clip.stretch(clip.id, {
				timelineStartFrame: clip.timelineStartFrame + change,
				durationFrames: clip.durationFrames - change,
			}));
			return;
		}
		const durationFrames = Math.max(1, clip.durationFrames + deltaFrames);
		if (durationFrames === clip.durationFrames) return;
		run(() => controller.actions.clip.stretch(clip.id, { durationFrames }));
	};

	return (
		<div
			className="audio-editor-track-row"
			data-track-row
			data-track-id={track.id}
			data-track-index={trackIndex}
			data-collapsed={track.collapsed ? 'true' : 'false'}
			data-display-mode={displayMode || 'waveform'}
			style={{ height: trackHeight }}
		>
			<TrackControls
				controller={controller}
				track={track}
				trackHeight={trackHeight}
				panelWidth={panelWidth}
				selected={selectedTrackId === track.id}
				blocked={blocked}
				showArmControls={showArmControls}
				recordingInputs={recordingInputs}
				isFlatNavigation={isFlatNavigation}
				copy={copy}
				run={run}
				onMenu={onMenu}
				onOpenEffects={onOpenEffects}
				onTabOut={focusAfterPanel}
				onShiftTabOut={() => onFocusTrackContainer(trackIndex)}
				onNavigateVertical={(direction) => {
					const targetIndex = trackIndex + (direction === 'down' ? 1 : -1);
					if (targetIndex >= 0 && targetIndex < trackCount) {
						onFocusTrackPanelControl(targetIndex);
					}
				}}
			/>
			<div
				className="audio-editor-track-lane"
				data-track-lane
				data-track-id={track.id}
				data-spectrogram-scale={track.spectrogram?.scale || 'mel'}
				data-spectrogram-minimum-frequency={track.spectrogram?.minimumFrequency ?? 0}
				data-spectrogram-maximum-frequency={track.spectrogram?.maximumFrequency ?? sampleRate / 2}
				data-spectrogram-window-size={track.spectrogram?.windowSize ?? 2048}
				data-spectrogram-range={track.spectrogram?.range ?? 80}
				aria-label={track.name}
				data-selected={selectedTrackId === track.id}
				style={{ marginLeft: panelWidth, width: timelineWidth + verticalRulerWidth, height: trackHeight }}
				onClick={(event) => {
					if (event.target.closest('[data-clip-id]')) return;
					run(() => controller.actions.timeline.selectTrack(track.id));
				}}
			>
				<div
					ref={trackWindowRef}
					className="audio-editor-track-window"
					style={{ left: windowLeft, width: windowWidth }}
					onFocusCapture={(event) => {
						if (isFlatNavigation || !event.target.matches?.('[data-clip-id][role="group"]')) return;
						for (const clip of clipGroups(trackWindowRef.current)) clip.tabIndex = -1;
						event.target.tabIndex = tabIndexFor(2);
					}}
					onKeyDownCapture={(event) => {
						if (!event.target.matches?.('[data-clip-id][role="group"]')) return;
						if (event.key === 'Enter') {
							event.preventDefault();
							event.stopPropagation();
							run(() => controller.actions.timeline.selectClip(String(event.target.dataset.clipId), {
								additive: event.shiftKey,
								toggle: event.metaKey || event.ctrlKey,
							}));
							return;
						}
						if (
							event.altKey
							|| event.ctrlKey
							|| event.metaKey
							|| event.shiftKey
							|| (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
						) return;
						const clips = clipGroups(trackWindowRef.current);
						const currentIndex = clips.indexOf(event.target);
						if (currentIndex < 0 || clips.length < 2) return;
						event.preventDefault();
						event.stopPropagation();
						const direction = event.key === 'ArrowRight' ? 1 : -1;
						const next = clips[(currentIndex + direction + clips.length) % clips.length];
						if (!isFlatNavigation) {
							for (const clip of clips) clip.tabIndex = clip === next ? tabIndexFor(2) : -1;
						}
						focusFirst(next);
					}}
				>
					<TrackNew
						clips={projectedClips}
						height={trackHeight}
						trackIndex={trackIndex}
						isSelected={selectedTrackId === track.id}
						isMuted={track.mute}
						envelopeMode={automationToolEnabled && !blocked}
						onEnvelopePointsChange={updateEnvelope}
						pixelsPerSecond={pixelsPerSecond}
						width={windowWidth}
						spectrogramMode={displayMode === 'spectrogram' && !recordingPreview}
						splitView={displayMode === 'multiview'}
						spectrogramScale={spectrogramScale}
						timeSelection={projectedSelection}
						clipStyle={clipStyle === 'classic' ? 'classic' : 'colourful'}
						draggingClipIds={draggingClipId ? new Set([draggingClipId]) : undefined}
						tabIndex={tabIndexFor(2)}
						trackTabIndex={tabIndexFor(0)}
						onTrackNavigateVertical={(direction) => {
							const targetIndex = trackIndex + direction;
							if (targetIndex >= 0 && targetIndex < trackCount) onFocusTrackContainer(targetIndex);
						}}
						onContainerFocusChange={(hasFocus) => {
							if (hasFocus && selectedTrackId !== track.id) {
								run(() => controller.actions.timeline.selectTrack(track.id));
							}
						}}
						onEnterPanel={() => onFocusTrackPanelControl(trackIndex)}
						onShiftTabOut={focusBeforeTrack}
						onContainerEnter={() => run(() => controller.actions.timeline.selectTrack(track.id))}
						onTabFromLastClip={() => onFocusTrackRuler(trackIndex)}
						onClipClick={(clipId, shiftKey, metaKey) => {
							if (!shiftKey && !metaKey) return;
							run(() => controller.actions.timeline.selectClip(String(clipId), {
								additive: Boolean(shiftKey),
								toggle: Boolean(metaKey),
							}));
						}}
						onClipHeaderClick={(clipId, _clipStartTime, shiftKey, metaKey) => {
							if (!shiftKey && !metaKey) return;
							run(() => controller.actions.timeline.selectClip(String(clipId), {
								additive: Boolean(shiftKey),
								toggle: Boolean(metaKey),
							}));
						}}
						onClipMenuClick={onOpenClipMenu}
						onClipTrimEdge={() => {
							// Pointer geometry is committed by the frame-canonical adapter on pointer-up.
						}}
						onClipMove={moveClipBySeconds}
						onClipMoveToTrack={moveClipToTrack}
						onClipNavigateVertical={navigateClipVertical}
						onClipTrim={trimClipBySeconds}
							onClipStretch={stretchClipBySeconds}
					/>
					{activeSpectralSelection && ['spectrogram', 'multiview'].includes(displayMode) && (
						<SpectralSelectionOverlay
							selection={activeSpectralSelection}
							track={track}
							displayMode={displayMode}
							trackHeight={trackHeight}
							windowWidth={windowWidth}
							overscanStartFrame={projection.overscanStartFrame}
							pixelsPerSecond={pixelsPerSecond}
							sampleRate={sampleRate}
							maximumFrame={Math.max(projectDurationFrames(project), activeSpectralSelection.endFrame)}
							disabled={blocked}
							copy={copy}
							onCommit={(next) => run(() => {
								controller.actions.timeline.setSelection(next.startFrame, next.endFrame);
								controller.actions.spectral.boxSelect({
									minimumFrequency: next.minimumFrequency,
									maximumFrequency: next.maximumFrequency,
								});
							})}
						/>
					)}
				</div>
				{verticalRulerWidth > 0 && <div
					className="audio-editor-vertical-ruler"
					data-track-ruler
					role="region"
					aria-label={`${track.name}: ${displayMode === 'spectrogram' ? copy.spectrogramView : displayMode === 'multiview' ? copy.multiview : copy.waveformView}`}
					tabIndex={tabIndexFor(3)}
					onKeyDown={(event) => {
						if (event.key === 'Tab') {
							event.preventDefault();
							if (event.shiftKey) focusBeforeRuler();
							else focusAfterRuler();
						} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
							event.preventDefault();
							const targetIndex = trackIndex + (event.key === 'ArrowDown' ? 1 : -1);
							if (targetIndex >= 0 && targetIndex < trackCount) onFocusTrackRuler(targetIndex);
						} else if (event.key === 'Escape') {
							event.preventDefault();
							onFocusTrackContainer(trackIndex);
						}
					}}
				>
					{displayMode === 'spectrogram' ? (
						<FrequencyRuler
							height={trackHeight}
							minFreq={track.spectrogram?.minimumFrequency || 0}
							maxFreq={track.spectrogram?.maximumFrequency || sampleRate / 2}
							scale={spectrogramScale}
							width={verticalRulerWidth}
						/>
					) : displayMode === 'multiview' ? (
						<>
							<FrequencyRuler
								height={Math.floor(trackHeight / 2)}
								minFreq={track.spectrogram?.minimumFrequency || 0}
								maxFreq={track.spectrogram?.maximumFrequency || sampleRate / 2}
								scale={spectrogramScale}
								width={verticalRulerWidth}
							/>
							<VerticalRuler height={Math.ceil(trackHeight / 2)} min={-1} max={1} majorDivisions={2} minorDivisions={1} width={verticalRulerWidth} />
						</>
					) : (
						<VerticalRuler
							height={trackHeight}
							min={displayMode === 'half-wave' ? 0 : -1}
							max={1}
							majorDivisions={displayMode === 'half-wave' ? 2 : 3}
							minorDivisions={1}
							width={verticalRulerWidth}
						/>
					)}
				</div>}
			</div>
		</div>
	);
}

function SpectralSelectionOverlay({
	selection,
	track,
	displayMode,
	trackHeight,
	windowWidth,
	overscanStartFrame,
	pixelsPerSecond,
	sampleRate,
	maximumFrame,
	disabled,
	copy,
	onCommit,
}) {
	const dragRef = useRef(null);
	const initial = spectralSelectionState(selection);
	const previewRef = useRef(initial);
	const [preview, setPreview] = useState(initial);
	const displayMinimum = Math.max(0, Number(track.spectrogram?.minimumFrequency) || 0);
	const displayMaximum = Math.max(
		displayMinimum + 1,
		Math.min(sampleRate / 2, Number(track.spectrogram?.maximumFrequency) || sampleRate / 2),
	);
	const scale = normalizeSpectrogramScale(track.spectrogram?.scale);
	const spectralHeight = displayMode === 'multiview' ? Math.max(1, Math.floor(trackHeight / 2)) : trackHeight;

	useEffect(() => {
		if (dragRef.current) return;
		const next = spectralSelectionState(selection);
		previewRef.current = next;
		setPreview(next);
	}, [
		selection.endFrame,
		selection.frequencyRange.maximumFrequency,
		selection.frequencyRange.minimumFrequency,
		selection.startFrame,
	]);

	const setPreviewState = (next) => {
		previewRef.current = next;
		setPreview(next);
	};
	const publish = (next) => {
		setPreviewState(next);
		onCommit(next);
	};
	const stopClick = (event) => {
		event.preventDefault();
		event.stopPropagation();
	};
	const beginDrag = (kind, event) => {
		if (disabled) return;
		stopClick(event);
		dragRef.current = {
			kind,
			pointerId: event.pointerId,
			windowRect: event.currentTarget.closest('.audio-editor-track-window')?.getBoundingClientRect(),
			laneRect: event.currentTarget.closest('[data-track-lane]')?.getBoundingClientRect(),
		};
		event.currentTarget.setPointerCapture?.(event.pointerId);
	};
	const moveDrag = (event) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		stopClick(event);
		const next = { ...previewRef.current };
		if (drag.kind === 'start-time' || drag.kind === 'end-time') {
			if (!drag.windowRect) return;
			const frame = Math.round(overscanStartFrame + Math.max(0, event.clientX - drag.windowRect.left) / pixelsPerSecond * sampleRate);
			if (drag.kind === 'start-time') next.startFrame = clamp(frame, 0, next.endFrame - 1);
			else next.endFrame = clamp(frame, next.startFrame + 1, maximumFrame);
		} else {
			if (!drag.laneRect) return;
			const verticalFraction = 1 - clamp((event.clientY - drag.laneRect.top) / spectralHeight, 0, 1);
			const frequency = Math.round(spectrogramFrequencyAtFraction(verticalFraction, scale, displayMinimum, displayMaximum));
			if (drag.kind === 'minimum-frequency') {
				next.minimumFrequency = clamp(frequency, 0, next.maximumFrequency - 1);
			} else next.maximumFrequency = clamp(frequency, next.minimumFrequency + 1, sampleRate / 2);
		}
		setPreviewState(next);
	};
	const endDrag = (event, cancelled = false) => {
		const drag = dragRef.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		stopClick(event);
		dragRef.current = null;
		if (cancelled) {
			setPreviewState(spectralSelectionState(selection));
			return;
		}
		publish(previewRef.current);
	};
	const adjustTime = (edge, event) => {
		if (disabled) return;
		let requested = null;
		const amount = event.shiftKey ? Math.max(1, Math.round(sampleRate / 10)) : 1;
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') requested = preview[`${edge}Frame`] - amount;
		else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') requested = preview[`${edge}Frame`] + amount;
		else if (event.key === 'PageDown') requested = preview[`${edge}Frame`] - sampleRate;
		else if (event.key === 'PageUp') requested = preview[`${edge}Frame`] + sampleRate;
		else if (event.key === 'Home') requested = edge === 'start' ? 0 : preview.startFrame + 1;
		else if (event.key === 'End') requested = edge === 'start' ? preview.endFrame - 1 : maximumFrame;
		if (requested == null) return;
		stopClick(event);
		publish({
			...preview,
			[`${edge}Frame`]: edge === 'start'
				? clamp(requested, 0, preview.endFrame - 1)
				: clamp(requested, preview.startFrame + 1, maximumFrame),
		});
	};
	const adjustFrequency = (edge, event) => {
		if (disabled) return;
		let requested = null;
		const amount = event.shiftKey ? 100 : 10;
		const name = edge === 'minimum' ? 'minimumFrequency' : 'maximumFrequency';
		if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') requested = preview[name] - amount;
		else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') requested = preview[name] + amount;
		else if (event.key === 'PageDown') requested = preview[name] - 1_000;
		else if (event.key === 'PageUp') requested = preview[name] + 1_000;
		else if (event.key === 'Home') requested = edge === 'minimum' ? 0 : preview.minimumFrequency + 1;
		else if (event.key === 'End') requested = edge === 'minimum' ? preview.maximumFrequency - 1 : sampleRate / 2;
		if (requested == null) return;
		stopClick(event);
		publish({
			...preview,
			[name]: edge === 'minimum'
				? clamp(requested, 0, preview.maximumFrequency - 1)
				: clamp(requested, preview.minimumFrequency + 1, sampleRate / 2),
		});
	};

	const startPixels = framesToSeconds(preview.startFrame - overscanStartFrame, { sampleRate }) * pixelsPerSecond;
	const endPixels = framesToSeconds(preview.endFrame - overscanStartFrame, { sampleRate }) * pixelsPerSecond;
	const left = clamp(startPixels, 0, windowWidth);
	const right = clamp(endPixels, 0, windowWidth);
	if (right <= left) return null;
	const lowFraction = spectrogramFrequencyFraction(preview.minimumFrequency, scale, displayMinimum, displayMaximum);
	const highFraction = spectrogramFrequencyFraction(preview.maximumFrequency, scale, displayMinimum, displayMaximum);
	const top = (1 - highFraction) * spectralHeight;
	const height = Math.max(2, (highFraction - lowFraction) * spectralHeight);
	const timeMaximumSeconds = framesToSeconds(maximumFrame, { sampleRate });
	const handleProps = (kind) => ({
		type: 'button',
		disabled,
		onClick: stopClick,
		onPointerDown: (event) => beginDrag(kind, event),
		onPointerMove: moveDrag,
		onPointerUp: endDrag,
		onPointerCancel: (event) => endDrag(event, true),
	});

	return (
		<div
			className="audio-editor-spectral-selection"
			data-spectral-selection
			style={{ left, top, width: Math.max(2, right - left), height }}
		>
			<button
				{...handleProps('start-time')}
				className="audio-editor-spectral-selection__handle audio-editor-spectral-selection__handle--time-start"
				role="slider"
				aria-orientation="horizontal"
				aria-label={copy.spectralTimeStartHandle}
				aria-valuemin={0}
				aria-valuemax={framesToSeconds(preview.endFrame - 1, { sampleRate })}
				aria-valuenow={framesToSeconds(preview.startFrame, { sampleRate })}
				aria-valuetext={`${framesToSeconds(preview.startFrame, { sampleRate }).toFixed(3)} s`}
				onKeyDown={(event) => adjustTime('start', event)}
			/>
			<button
				{...handleProps('end-time')}
				className="audio-editor-spectral-selection__handle audio-editor-spectral-selection__handle--time-end"
				role="slider"
				aria-orientation="horizontal"
				aria-label={copy.spectralTimeEndHandle}
				aria-valuemin={framesToSeconds(preview.startFrame + 1, { sampleRate })}
				aria-valuemax={timeMaximumSeconds}
				aria-valuenow={framesToSeconds(preview.endFrame, { sampleRate })}
				aria-valuetext={`${framesToSeconds(preview.endFrame, { sampleRate }).toFixed(3)} s`}
				onKeyDown={(event) => adjustTime('end', event)}
			/>
			<button
				{...handleProps('maximum-frequency')}
				className="audio-editor-spectral-selection__handle audio-editor-spectral-selection__handle--frequency-maximum"
				role="slider"
				aria-orientation="vertical"
				aria-label={copy.spectralMaximumHandle}
				aria-valuemin={preview.minimumFrequency + 1}
				aria-valuemax={sampleRate / 2}
				aria-valuenow={preview.maximumFrequency}
				aria-valuetext={`${Math.round(preview.maximumFrequency)} Hz`}
				onKeyDown={(event) => adjustFrequency('maximum', event)}
			/>
			<button
				{...handleProps('minimum-frequency')}
				className="audio-editor-spectral-selection__handle audio-editor-spectral-selection__handle--frequency-minimum"
				role="slider"
				aria-orientation="vertical"
				aria-label={copy.spectralMinimumHandle}
				aria-valuemin={0}
				aria-valuemax={preview.maximumFrequency - 1}
				aria-valuenow={preview.minimumFrequency}
				aria-valuetext={`${Math.round(preview.minimumFrequency)} Hz`}
				onKeyDown={(event) => adjustFrequency('minimum', event)}
			/>
		</div>
	);
}

function LabelTrackRow({
	controller,
	track,
	trackIndex,
	panelWidth,
	timelineWidth,
	verticalRulerWidth,
	pixelsPerSecond,
	sampleRate,
	selection,
	selected,
	blocked,
	copy,
	run,
	onMenu,
}) {
	const trackHeight = trackVisualHeight(track);
	const laneRef = useRef(null);
	const [editingName, setEditingName] = useState(false);
	const [selectedLabelId, setSelectedLabelId] = useState(null);
	const [editingLabelId, setEditingLabelId] = useState(null);
	const addLabel = (event = null) => {
		if (blocked) return;
		const pointerFrame = event?.clientX != null && laneRef.current
			? frameAtLabelClientX(event.clientX, laneRef.current, pixelsPerSecond, sampleRate)
			: null;
		const startFrame = pointerFrame ?? selection?.startFrame ?? 0;
		const endFrame = pointerFrame ?? selection?.endFrame ?? startFrame;
		const labelId = run(() => controller.actions.labels.add(track.id, {
			title: '',
			startFrame,
			endFrame,
		}));
		if (labelId) {
			setSelectedLabelId(labelId);
			setEditingLabelId(labelId);
		}
	};
	return (
		<div
			className="audio-editor-track-row audio-editor-label-track-row"
			data-track-row
			data-label-track
			data-track-id={track.id}
			data-track-index={trackIndex}
			data-collapsed={track.collapsed ? 'true' : 'false'}
			style={{ height: trackHeight }}
		>
			<div className="audio-editor-label-track-controls" style={{ width: panelWidth }}>
				<div className="audio-editor-label-track-title">
					<span aria-hidden="true">T</span>
					{editingName ? (
						<TrackNameEditor
							track={track}
							label={copy.trackName}
							blocked={blocked}
							controller={controller}
							run={run}
							onClose={() => setEditingName(false)}
						/>
					) : (
						<span
							data-track-name
							className="track-control-panel__track-name-text"
							onDoubleClick={() => !blocked && setEditingName(true)}
						>
							{track.name}
						</span>
					)}
				</div>
				<div className="audio-editor-label-track-actions">
					<Button variant="secondary" aria-label={copy.addLabel} disabled={blocked} onClick={() => addLabel()}>+</Button>
					<Button variant="tertiary" aria-label={copy.trackMenu || copy.tracksMenu} onClick={(event) => onMenu(event.currentTarget)}>⋯</Button>
				</div>
			</div>
			<div
				ref={laneRef}
				className="audio-editor-track-lane audio-editor-label-lane"
				data-track-lane
				data-track-id={track.id}
				data-selected={selected}
				role="region"
				aria-label={track.name}
				style={{ marginLeft: panelWidth, width: timelineWidth + verticalRulerWidth, height: trackHeight }}
				onClick={(event) => {
					if (!event.target.closest('[data-label-id]')) {
						setSelectedLabelId(null);
						run(() => controller.actions.timeline.selectTrack(track.id));
					}
				}}
				onDoubleClick={(event) => {
					if (!event.target.closest('[data-label-id]')) addLabel(event);
				}}
			>
				{track.labels.map((label) => {
					const startSeconds = framesToSeconds(label.startFrame, { sampleRate });
					const endSeconds = framesToSeconds(label.endFrame, { sampleRate });
					return (
						<AudacityLabelMarker
							key={label.id}
							controller={controller}
							trackId={track.id}
							label={label}
							left={startSeconds * pixelsPerSecond}
							trackHeight={trackHeight}
							pixelsPerSecond={pixelsPerSecond}
							sampleRate={sampleRate}
							laneRef={laneRef}
							selected={selectedLabelId === label.id}
							editing={editingLabelId === label.id}
							blocked={blocked}
							copy={copy}
							run={run}
							onSelect={() => setSelectedLabelId(label.id)}
							onEdit={() => setEditingLabelId(label.id)}
							onFinishEdit={() => setEditingLabelId(null)}
							onRemove={() => {
								setSelectedLabelId(null);
								setEditingLabelId(null);
								run(() => controller.actions.labels.remove(track.id, label.id));
							}}
						/>
					);
				})}
			</div>
		</div>
	);
}

function AudacityLabelMarker({
	controller,
	trackId,
	label,
	left,
	trackHeight,
	pixelsPerSecond,
	sampleRate,
	laneRef,
	selected,
	editing,
	blocked,
	copy,
	run,
	onSelect,
	onEdit,
	onFinishEdit,
	onRemove,
}) {
	const inputRef = useRef(null);
	const baselineRef = useRef(label);
	const pendingRef = useRef(null);
	const [preview, setPreview] = useState(null);
	const point = label.startFrame === label.endFrame;
	const displayed = preview || label;
	const displayedLeft = left + (displayed.startFrame - label.startFrame) / sampleRate * pixelsPerSecond;
	const displayedWidth = Math.max(1, (displayed.endFrame - displayed.startFrame) / sampleRate * pixelsPerSecond);

	useEffect(() => {
		if (!editing) return;
		inputRef.current?.focus();
		inputRef.current?.select();
	}, [editing]);

	useEffect(() => {
		const finishDrag = () => queueMicrotask(() => {
			const pending = pendingRef.current;
			if (!pending) return;
			pendingRef.current = null;
			setPreview(null);
			run(() => controller.actions.labels.update(trackId, label.id, pending));
		});
		document.addEventListener('mouseup', finishDrag);
		return () => document.removeEventListener('mouseup', finishDrag);
	}, [controller, label.id, run, trackId]);

	const previewRange = (startFrame, endFrame) => {
		const changes = {
			startFrame: Math.max(0, Math.min(startFrame, endFrame)),
			endFrame: Math.max(0, Math.max(startFrame, endFrame)),
		};
		pendingRef.current = changes;
		setPreview({ ...label, ...changes });
	};
	const select = () => {
		onSelect();
		baselineRef.current = preview || label;
		run(() => controller.actions.timeline.selectTrack(trackId));
		run(() => controller.actions.timeline.setSelection(label.startFrame, label.endFrame));
	};
	return (
		<div
			className="audio-editor-label-marker"
			data-label-id={label.id}
			data-point-label={point ? 'true' : 'false'}
			style={{ left: displayedLeft, width: displayedWidth }}
			role="group"
			tabIndex={0}
			aria-label={`${copy.editLabels}: ${label.title || copy.newLabel}`}
			onKeyDown={(event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					onEdit();
				} else if ((event.key === 'Delete' || event.key === 'Backspace') && !editing && !blocked) {
					event.preventDefault();
					onRemove();
				}
			}}
		>
			<LabelMarker
				text={label.title || copy.newLabel}
				type={point ? 'point' : 'region'}
				width={displayedWidth}
				stalkHeight={Math.max(24, trackHeight - 18)}
				selected={selected}
				onClick={select}
				onDoubleClick={() => !blocked && onEdit()}
				onSelect={() => {
					select();
					baselineRef.current = preview || label;
				}}
				onLabelMove={blocked ? undefined : (deltaX) => {
					const baseline = baselineRef.current || label;
					const deltaFrames = Math.round(deltaX / pixelsPerSecond * sampleRate);
					const duration = baseline.endFrame - baseline.startFrame;
					const startFrame = Math.max(0, baseline.startFrame + deltaFrames);
					previewRange(startFrame, startFrame + duration);
				}}
				onRegionResize={blocked ? undefined : ({ side, clientX }) => {
					const frame = frameAtLabelClientX(clientX, laneRef.current, pixelsPerSecond, sampleRate);
					if (side === 'left') previewRange(frame, label.endFrame);
					else previewRange(label.startFrame, frame);
				}}
			/>
			{editing && <input
				ref={inputRef}
				className="audio-editor-label-title-input"
				defaultValue={label.title}
				disabled={blocked}
				aria-label={`${copy.editLabels}: ${label.title || copy.newLabel}`}
				onClick={(event) => event.stopPropagation()}
				onBlur={(event) => {
					const title = event.currentTarget.value;
					if (title !== label.title) run(() => controller.actions.labels.update(trackId, label.id, { title }));
					onFinishEdit();
				}}
				onKeyDown={(event) => {
					if (event.key === 'Enter') event.currentTarget.blur();
					else if (event.key === 'Escape') {
						event.currentTarget.value = label.title;
						event.currentTarget.blur();
					}
				}}
			/>}
		</div>
	);
}

function frameAtLabelClientX(clientX, lane, pixelsPerSecond, sampleRate) {
	if (!lane) return 0;
	const rect = lane.getBoundingClientRect();
	return Math.max(0, Math.round(Math.max(0, clientX - rect.left) / pixelsPerSecond * sampleRate));
}

function TrackControls({
	controller,
	track,
	trackHeight,
	panelWidth,
	selected,
	blocked,
	showArmControls,
	recordingInputs,
	isFlatNavigation,
	copy,
	run,
	onMenu,
	onOpenEffects,
	onTabOut,
	onShiftTabOut,
	onNavigateVertical,
}) {
	const telemetry = useAudioEditorTelemetry(controller);
	const controlsRef = useRef(null);
	const [editingName, setEditingName] = useState(false);
	const meter = telemetry.meters?.tracks?.[track.id];
	const meterVolume = meterPercent(meter?.dbfs);
	const adapterSelector = '.audio-editor-track-adapters input:not([disabled]), .audio-editor-track-adapters button:not([disabled]), .audio-editor-track-input select:not([disabled])';
	const focusAdapterControl = (last = false) => focusCandidate(
		controlsRef.current,
		adapterSelector,
		last,
	);
	const handleAdapterTab = (event) => {
		if (event.key !== 'Tab') return;
		const adapters = [...controlsRef.current.querySelectorAll(adapterSelector)];
		const currentIndex = adapters.indexOf(document.activeElement);
		if (currentIndex < 0) return;
		event.preventDefault();
		event.stopPropagation();
		if (event.shiftKey) {
			if (currentIndex > 0) focusFirst(adapters[currentIndex - 1]);
			else if (!focusPanelControl(controlsRef.current?.querySelector('.track-control-panel'), true)) onShiftTabOut?.();
		} else if (currentIndex < adapters.length - 1) {
			focusFirst(adapters[currentIndex + 1]);
		} else {
			onTabOut?.();
		}
	};

	useEffect(() => {
		const adapters = controlsRef.current?.querySelectorAll(
			'.audio-editor-track-adapters input:not([disabled]), .audio-editor-track-adapters button:not([disabled]), .audio-editor-track-input select:not([disabled])',
		);
		for (const adapter of adapters || []) adapter.tabIndex = isFlatNavigation ? 0 : -1;
	}, [blocked, isFlatNavigation, recordingInputs, showArmControls, track.id]);

	return (
		<div ref={controlsRef} className="audio-editor-track-controls" data-track-header style={{ width: panelWidth }} onDoubleClick={(event) => {
			if (blocked || !(event.target instanceof Element) || !event.target.closest('.track-control-panel__track-name-text')) return;
			setEditingName(true);
		}}>
			<TrackControlPanel
				trackName={track.name}
				trackType="stereo"
				volume={gainDbToDesignVolume(linearToDb(track.gain))}
				pan={panToDesignValue(track.pan)}
				isMuted={track.mute}
				isSolo={track.solo}
				isFocused={selected}
				height={panelWidth <= COMPACT_TRACK_PANEL_WIDTH ? 'truncated' : 'default'}
				trackHeight={trackHeight}
				meterLevelLeft={meterVolume}
				meterLevelRight={meterVolume}
				meterClippedLeft={(meter?.peak || 0) >= 1}
				meterClippedRight={(meter?.peak || 0) >= 1}
				tabIndex={-1}
				onTabOut={() => {
					if (!focusAdapterControl()) onTabOut?.();
				}}
				onShiftTabOut={onShiftTabOut}
				onNavigateVertical={onNavigateVertical}
				onVolumeChange={(volume) => !blocked && run(() => controller.actions.track.update(track.id, {
					gain: dbToLinear(designVolumeToGainDb(volume)),
				}))}
				onPanChange={(pan) => !blocked && run(() => controller.actions.track.update(track.id, { pan: designValueToPan(pan) }))}
				onMuteToggle={() => !blocked && run(() => controller.actions.track.update(track.id, { mute: !track.mute }))}
				onSoloToggle={() => !blocked && run(() => controller.actions.track.update(track.id, { solo: !track.solo }))}
				onEffectsClick={() => {
					if (!selected) run(() => controller.actions.timeline.selectTrack(track.id));
					onOpenEffects?.(track.id, controlsRef.current?.getBoundingClientRect() || null);
				}}
				onMenuClick={(event) => onMenu(event.currentTarget)}
				onClick={() => !selected && run(() => controller.actions.timeline.selectTrack(track.id))}
			/>
			<div className="audio-editor-track-adapters" onKeyDownCapture={handleAdapterTab}>
				{editingName && <TrackNameEditor
					track={track}
					label={copy.trackName}
					blocked={blocked}
					controller={controller}
					run={run}
					onClose={() => setEditingName(false)}
				/>}
				{showArmControls && (
					<span data-track-action="arm">
						<ToggleToolButton
							icon="record"
							isActive={track.armed}
							disabled={blocked}
							ariaLabel={`${copy.arm}: ${track.name}`}
							onClick={() => run(() => controller.actions.track.update(track.id, { armed: !track.armed }))}
						/>
					</span>
				)}
			</div>
			{showArmControls && (
				<div className="audio-editor-track-input" onKeyDownCapture={handleAdapterTab}>
					<RecordingInputSelectors
						controller={controller}
						recordingInputs={recordingInputs}
						track={track}
						copy={copy}
						run={run}
						disabled={blocked}
						surface="track"
					/>
				</div>
			)}
		</div>
	);
}

function TrackNameEditor({ track, label, blocked, controller, run, onClose }) {
	const editorRef = useRef(null);
	const [name, setName] = useState(track.name);
	useEffect(() => setName(track.name), [track.name]);
	useEffect(() => {
		const input = editorRef.current?.querySelector('input');
		input?.focus();
		input?.select();
	}, []);
	const commit = () => {
		const nextName = name.trim();
		if (!nextName) {
			setName(track.name);
			onClose();
			return;
		}
		if (nextName !== track.name) run(() => controller.actions.track.update(track.id, { name: nextName }));
		onClose();
	};
	return (
		<label ref={editorRef} data-track-name onBlur={commit} onKeyDown={(event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				event.currentTarget.querySelector('input')?.blur();
			} else if (event.key === 'Escape') {
				event.preventDefault();
				setName(track.name);
				onClose();
			}
		}}>
			<span className="kw-audio-editor-sr-only">{label}: {track.name}</span>
			<TextInput value={name} disabled={blocked} width="100%" onChange={setName} />
		</label>
	);
}

function samplePointAtPointer(event, lane, clip, source, frameAtClientX, lockedChannel = null) {
	const rect = lane.getBoundingClientRect();
	const channelCount = Math.max(1, Number(source.channelCount) || 1);
	const localY = Math.max(0, Math.min(Math.max(1, rect.height) - Number.EPSILON, event.clientY - rect.top));
	const channelHeight = Math.max(1, rect.height / channelCount);
	const channel = lockedChannel == null
		? Math.max(0, Math.min(channelCount - 1, Math.floor(localY / channelHeight)))
		: Math.max(0, Math.min(channelCount - 1, Number(lockedChannel) || 0));
	const channelY = Math.max(0, Math.min(channelHeight, localY - channel * channelHeight));
	const timelineFrame = Math.max(
		clip.timelineStartFrame,
		Math.min(clip.timelineStartFrame + clip.durationFrames - 1, frameAtClientX(event.clientX, lane)),
	);
	return {
		channel,
		timelineFrame,
		value: Math.max(-1, Math.min(1, 1 - 2 * channelY / channelHeight)),
	};
}

function recordingPreviewId(trackId) {
	return `recording-preview-${trackId}`;
}

function toDesignRecordingPreview(clip, preview, overscanStartFrame, pixelsPerSecond, sampleRate, copy) {
	const output = {
		id: clip.id,
		name: copy.recordingLabel,
		start: framesToSeconds(Math.max(0, Math.max(clip.timelineStartFrame, overscanStartFrame) - overscanStartFrame), { sampleRate }),
		duration: Math.max(
			framesToSeconds(clip.waveformEndFrame - clip.waveformStartFrame, { sampleRate }),
			MINIMUM_VISIBLE_CLIP_PIXELS / pixelsPerSecond,
		),
		selected: false,
		trimStart: framesToSeconds(clip.waveformStartFrame, { sampleRate }),
		fullDuration: framesToSeconds(clip.durationFrames, { sampleRate }),
		stretchFactor: 1,
	};
	if (!preview?.channels?.length || !clip.isVisible) return output;
	const waveformChannels = preview.channels.map((channel) => recordingPreviewWaveformWindow(channel, clip));
	if (waveformChannels.length > 1) {
		output.waveformLeft = waveformChannels[0];
		output.waveformRight = waveformChannels[1];
	} else {
		output.waveform = waveformChannels[0];
	}
	return output;
}

function recordingPreviewWaveformWindow(channel, clip) {
	if (!channel?.length || !clip.durationFrames) return [];
	const pairCount = Math.max(1, Math.floor(channel.length / 2));
	const startPair = Math.max(0, Math.min(pairCount - 1, Math.floor(clip.waveformStartFrame / clip.durationFrames * pairCount)));
	const endPair = Math.max(startPair + 1, Math.min(pairCount, Math.ceil(clip.waveformEndFrame / clip.durationFrames * pairCount)));
	return [...channel.slice(startPair * 2, endPair * 2)];
}

function toDesignClip(
	controller,
	project,
	clip,
	overscanStartFrame,
	pixelsPerSecond,
	selectedClipIds,
	sampleRate,
	copy,
	showRms = false,
	halfWave = false,
) {
	const visual = controller.getClipVisualData(clip.id);
	const source = visual?.source || project.sources.find((item) => item.id === clip.sourceId);
	const selected = selectedClipIds instanceof Set
		? selectedClipIds.has(clip.id)
		: selectedClipIds === clip.id;
	const output = {
		id: clip.id,
		name: source?.name || copy.clip,
		start: framesToSeconds(Math.max(0, Math.max(clip.timelineStartFrame, overscanStartFrame) - overscanStartFrame), { sampleRate }),
		duration: Math.max(
			framesToSeconds(clip.waveformEndFrame - clip.waveformStartFrame, { sampleRate }),
			MINIMUM_VISIBLE_CLIP_PIXELS / pixelsPerSecond,
		),
		selected,
		trimStart: framesToSeconds(clip.waveformStartFrame, { sampleRate }),
		fullDuration: framesToSeconds(clip.sourceDurationFrames || clip.durationFrames, { sampleRate }),
		stretchFactor: clip.durationFrames / Math.max(1, clip.sourceDurationFrames || clip.durationFrames),
		envelopePoints: envelopeFramesToDesignPoints(clip.envelope, sampleRate, {
			startFrame: clip.waveformStartFrame,
			endFrame: clip.waveformEndFrame,
		}),
	};
	if (!visual?.buffer || !clip.isVisible) return output;
	try {
		const channels = Array.from(
			{ length: visual.buffer.numberOfChannels },
			(_, channel) => visual.buffer.getChannelData(channel),
		);
		const maximumSamples = Math.max(32, Math.min(4096, Math.ceil(clip.duration * pixelsPerSecond * 2)));
		const waveform = prepareBoundedWaveformWindow(channels, clip, {
			startFrame: clip.waveformStartFrame,
			endFrame: clip.waveformEndFrame,
			maxSamples: maximumSamples,
		});
		const visualChannels = halfWave
			? waveform.channels.map((channel) => channel.map((sample) => Math.max(0, sample)))
			: waveform.channels;
		if (visualChannels.length > 1) {
			output.waveformLeft = [...visualChannels[0]];
			output.waveformRight = [...visualChannels[1]];
			if (showRms) {
				output.waveformLeftRms = rmsEnvelope(visualChannels[0]);
				output.waveformRightRms = rmsEnvelope(visualChannels[1]);
			}
		} else {
			output.waveform = [...visualChannels[0]];
			if (showRms) output.waveformRms = rmsEnvelope(visualChannels[0]);
		}
	} catch {
		// The source may still be loading. TrackNew renders a bounded placeholder.
	}
	return output;
}

function rmsEnvelope(samples, radius = 8) {
	const output = new Array(samples.length);
	let sum = 0;
	let start = 0;
	for (let index = 0; index < samples.length; index += 1) {
		const sample = Number(samples[index]) || 0;
		sum += sample * sample;
		while (start < index - radius * 2) {
			const removed = Number(samples[start]) || 0;
			sum -= removed * removed;
			start += 1;
		}
		output[index] = Math.sqrt(Math.max(0, sum) / (index - start + 1));
	}
	return output;
}

function normalizeSpectrogramScale(value) {
	const scale = String(value || 'mel').toLowerCase();
	if (scale === 'log') return 'logarithmic';
	return ['linear', 'logarithmic', 'mel', 'bark', 'erb', 'period'].includes(scale) ? scale : 'mel';
}

function spectralSelectionState(selection) {
	return {
		startFrame: selection.startFrame,
		endFrame: selection.endFrame,
		minimumFrequency: selection.frequencyRange.minimumFrequency,
		maximumFrequency: selection.frequencyRange.maximumFrequency,
	};
}

function spectrogramFrequencyFraction(frequency, scale, minimumFrequency, maximumFrequency) {
	const minimum = spectrogramScaleValue(minimumFrequency, scale);
	const maximum = spectrogramScaleValue(maximumFrequency, scale);
	const value = spectrogramScaleValue(clamp(frequency, minimumFrequency, maximumFrequency), scale);
	return maximum > minimum ? clamp((value - minimum) / (maximum - minimum), 0, 1) : 0;
}

function spectrogramFrequencyAtFraction(fraction, scale, minimumFrequency, maximumFrequency) {
	const target = clamp(fraction, 0, 1);
	let low = minimumFrequency;
	let high = maximumFrequency;
	for (let iteration = 0; iteration < 32; iteration += 1) {
		const midpoint = (low + high) / 2;
		if (spectrogramFrequencyFraction(midpoint, scale, minimumFrequency, maximumFrequency) < target) low = midpoint;
		else high = midpoint;
	}
	return (low + high) / 2;
}

function spectrogramScaleValue(frequency, scale) {
	const value = Math.max(0, Number(frequency) || 0);
	if (scale === 'linear') return value;
	if (scale === 'logarithmic') return Math.log1p(value);
	if (scale === 'bark') return 13 * Math.atan(0.00076 * value) + 3.5 * Math.atan((value / 7_500) ** 2);
	if (scale === 'erb') return 21.4 * Math.log10(1 + 0.00437 * value);
	if (scale === 'period') return value / (value + 1_000);
	return 2_595 * Math.log10(1 + value / 700);
}

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}

function trackNavigationRow(root, trackIndex) {
	return root?.querySelector(`.audio-editor-track-row[data-track-index="${trackIndex}"]`) || null;
}

function clipGroups(root) {
	return [...(root?.querySelectorAll('[data-clip-id][role="group"]') || [])];
}

function normalizeClipSemantics(root, { flat, tabIndex }) {
	const clips = [...root.querySelectorAll('[data-clip-id]')]
		.filter((element) => element.parentElement?.closest('[data-clip-id]') === null);
	const activeClip = clips.includes(document.activeElement) ? document.activeElement : null;
	clips.forEach((clip, index) => {
		if (clip.getAttribute('role') !== 'group') clip.setAttribute('role', 'group');
		const nextTabIndex = flat ? 0 : clip === activeClip || (!activeClip && index === 0) ? tabIndex : -1;
		if (clip.tabIndex !== nextTabIndex) clip.tabIndex = nextTabIndex;
		for (const control of clip.querySelectorAll('button, input, select, textarea, [role="button"]')) {
			if (control.tabIndex !== -1) control.tabIndex = -1;
		}
	});
}

function focusPanelControl(panel, last = false) {
	return focusCandidate(
		panel,
		'button:not([disabled]):not([aria-label="Track icon"]), input:not([disabled]), [role="slider"]:not([aria-disabled="true"])',
		last,
	) || focusFirst(panel);
}

function focusCandidate(root, selector, last = false) {
	const candidates = [...(root?.querySelectorAll(selector) || [])]
		.filter((element) => element.getAttribute('aria-disabled') !== 'true');
	if (last) candidates.reverse();
	for (const candidate of candidates) {
		if (focusFirst(candidate)) return true;
	}
	return false;
}

function focusFirst(element) {
	if (!element || typeof element.focus !== 'function') return false;
	try {
		element.focus({ preventScroll: true });
	} catch {
		element.focus();
	}
	if (document.activeElement !== element) return false;
	element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
	return true;
}

function secondsDeltaToFrames(seconds, sampleRate = 48_000) {
	const value = Number(seconds);
	if (!Number.isFinite(value) || value === 0) return 0;
	return secondsToFrames(Math.abs(value), { sampleRate }) * Math.sign(value);
}

function trackVisualHeight(track, showArmControls = false) {
	const baseHeight = track?.collapsed ? COLLAPSED_TRACK_HEIGHT : TRACK_HEIGHT;
	if (!showArmControls || track?.type === 'label') return baseHeight;
	return track?.collapsed
		? Math.min(70, baseHeight + RECORDING_INPUT_CONTROLS_HEIGHT)
		: baseHeight + RECORDING_INPUT_CONTROLS_HEIGHT;
}

function linearToDb(value) {
	const number = Number(value);
	return number > 0 ? Math.max(-60, Math.min(12, 20 * Math.log10(number))) : -60;
}

function dbToLinear(value) {
	const db = Math.max(-60, Math.min(12, Number(value) || 0));
	return 10 ** (db / 20);
}

function meterPercent(dbfs) {
	const value = Number.isFinite(dbfs) ? dbfs : -60;
	return (Math.max(-60, Math.min(0, value)) + 60) / 60 * 100;
}
