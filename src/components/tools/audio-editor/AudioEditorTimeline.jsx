import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Button,
	CLIP_CONTENT_OFFSET,
	ContextMenu,
	ContextMenuItem,
	DbRuler,
	EnvelopeCurve,
	EnvelopeInteractionLayer,
	FrequencyRuler,
	GhostButton,
	Icon,
	LabelMarker,
	Menu,
	PlayheadCursor,
	RulerFlyout,
	TextInput,
	TimelineRuler,
	TimelineRulerContextMenu,
	ToggleToolButton,
	TrackControlPanel,
	TrackNew,
	useAccessibilityProfile,
	useTabOrder,
	VerticalRuler,
} from '@dilsonspickles/components';

import {
	createTimelineProjectIndex,
	designValueToPan,
	designVolumeToGainDb,
	framesToSeconds,
	gainDbToDesignVolume,
	panToDesignValue,
	prepareBoundedWaveformWindow,
	preparePeakPyramidWaveformWindow,
	projectClipsToViewport,
	rightmostVisibleClip,
	secondsToFrames,
} from '../../../lib/tools/audio-editor/design-system-adapters.js';
import {
	createEnvelopeValueEvaluator,
	envelopeValueToDb,
	envelopeFramesToDesignPoints,
	mergeDesignEnvelopePoints,
} from '../../../lib/tools/audio-editor/automation.js';
import {
	AUDACITY_CLIP_CONTEXT_ACTION_IDS,
	AUDACITY_TRACK_CONTEXT_ACTION_IDS,
	audacityContextMenuAction,
} from '../../../lib/tools/audio-editor/audacity-context-menu.js';
import {
	collectClipTransformIds,
	collectClipTrimIds,
} from '../../../lib/tools/audio-editor/commands.js';
import { AUDIO_EDITOR_TRACK_COLORS } from '../../../lib/tools/audio-editor/project-v2.js';
import { editorTimelineDurationFrames } from '../../../lib/tools/audio-editor/project.js';
import {
	AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE,
	clearActiveProjectBinDragPayload,
	getActiveProjectBinDragPayload,
	parseProjectBinDragPayload,
} from '../../../lib/tools/audio-editor/project-bin-dnd.js';
import {
	selectVideoThumbnailTimestamps,
	validateVideoTrackComposition,
} from '../../../lib/tools/audio-editor/video-timeline.js';
import { drawAudacityWaveformChannel } from '../../../lib/tools/audio-editor/audacity-waveform-renderer.js';
import {
	pffftSpectrogramRevision,
	renderPffftSpectrogram,
	subscribePffftSpectrogram,
} from '../../../lib/tools/audio-editor/pffft-spectrogram.js';
import { useAudioEditorTelemetrySelector, useElementSize } from './DesignSystemRuntime.jsx';
import AudioEditorSampleTools from './AudioEditorSampleTools.jsx';
import RecordingInputSelectors from './RecordingInputSelectors.jsx';

const DESKTOP_TRACK_PANEL_WIDTH = 268;
const COMPACT_TRACK_PANEL_WIDTH = 164;
const TRACK_HEIGHT = 114;
const COLLAPSED_TRACK_HEIGHT = 54;
const RECORDING_INPUT_CONTROLS_HEIGHT = 24;
const VERTICAL_RULER_WIDTH = 40;
const SPECTROGRAM_RULER_WIDTH = 56;
const MINIMUM_VISIBLE_CLIP_PIXELS = 48;
const CLIP_TRIM_EDGE_HIT_WIDTH = 6;
const CLIP_HEADER_TRACK_RESIZE_HIT_HEIGHT = 4;
const MINIMUM_TRACK_HEIGHT = 40;
const NEW_AUDIO_TRACK_DROP_TARGET = '__new-audio-track__';
const DEFAULT_WAVEFORM_RULER_STATE = Object.freeze({ format: 'linear-amp', zoom: 0 });
const MAXIMUM_WAVEFORM_VERTICAL_ZOOM = 8;
const EMPTY_TIMELINE_CLIPS = Object.freeze([]);
const EMPTY_DESIGN_SYSTEM_WAVEFORM = Object.freeze([]);

function dataTransferHasType(dataTransfer, type) {
	return Array.from(dataTransfer?.types || []).includes(type);
}

function projectBinPayloadFromDataTransfer(dataTransfer) {
	let serialized = '';
	try {
		serialized = dataTransfer?.getData?.(AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE) || '';
	} catch {
		// Browsers can protect drag data until drop; the in-memory payload covers same-document drags.
	}
	return parseProjectBinDragPayload(serialized) || getActiveProjectBinDragPayload();
}

function ContainerAddTrackFlyout({
	isOpen,
	onSelectTrackType,
	mutationsBlocked,
	showMasterTrack,
	onToggleMasterTrack,
	onClose,
	x,
	y,
	autoFocus,
	triggerRef,
	className = '',
	copy,
}) {
	const flyoutRef = useRef(null);
	const firstOptionRef = useRef(null);

	useEffect(() => {
		if (!isOpen) return undefined;
		const handleClickOutside = (event) => {
			if (flyoutRef.current && !flyoutRef.current.contains(event.target)) onClose();
		};
		const timer = window.setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
		return () => {
			window.clearTimeout(timer);
			document.removeEventListener('mousedown', handleClickOutside);
		};
	}, [isOpen, onClose]);

	useEffect(() => {
		if (!isOpen) return undefined;
		const handleKeyDown = (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
				window.setTimeout(() => triggerRef?.current?.focus(), 0);
				return;
			}
			if (event.key === 'Tab') {
				onClose();
				return;
			}
			if (!['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
			const options = [...(flyoutRef.current?.querySelectorAll('.add-track-flyout__option:not(:disabled)') || [])];
			const currentIndex = options.indexOf(document.activeElement);
			if (currentIndex < 0 || !options.length) return;
			event.preventDefault();
			const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
			const nextIndex = (currentIndex + direction + options.length) % options.length;
			options[currentIndex].tabIndex = -1;
			options[nextIndex].tabIndex = 0;
			options[nextIndex].focus();
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [isOpen, onClose, triggerRef]);

	useEffect(() => {
		if (!isOpen || !autoFocus) return undefined;
		const timer = window.setTimeout(() => {
			const firstEnabled = flyoutRef.current?.querySelector('.add-track-flyout__option:not(:disabled)');
			(firstEnabled || firstOptionRef.current)?.focus();
		}, 0);
		return () => window.clearTimeout(timer);
	}, [autoFocus, isOpen]);

	useEffect(() => {
		if (!isOpen || !flyoutRef.current) return;
		const flyout = flyoutRef.current;
		const rect = flyout.getBoundingClientRect();
		const adjustedX = Math.max(10, Math.min(x, window.innerWidth - rect.width - 10));
		const adjustedY = Math.max(10, Math.min(y, window.innerHeight - rect.height - 10));
		flyout.style.left = `${adjustedX}px`;
		flyout.style.top = `${adjustedY}px`;
	}, [isOpen, x, y]);

	if (!isOpen) return null;
	const options = [
		{ type: 'audio', label: copy.audioTrack, icon: 'microphone' },
		{ type: 'video', label: copy.videoTrack || 'Video track', icon: 'play' },
		{ type: 'label', label: copy.labelTrack, icon: 'label' },
		{ type: 'send', label: copy.addSendTrack || copy.addSendBus, icon: 'automation' },
	];
	return (
		<div
			ref={flyoutRef}
			className={`add-track-flyout ${className}`}
			style={{ position: 'fixed', left: `${x}px`, top: `${y}px` }}
		>
			<div className="add-track-flyout__triangle" style={{ left: 88 }} />
			<div className="add-track-flyout__body" role="menu" aria-label={copy.addTrack}>
				{options.map((option, index) => (
					<button
						key={option.type}
						ref={index === 0 ? firstOptionRef : undefined}
						type="button"
						className="add-track-flyout__option"
						role="menuitem"
						tabIndex={index === 0 ? 0 : -1}
						disabled={mutationsBlocked}
						onClick={() => onSelectTrackType(option.type)}
					>
						<Icon name={option.icon} size={16} />
						<span className="add-track-flyout__option-label">{option.label}</span>
					</button>
				))}
				<div className="add-track-flyout__separator" role="separator" />
				<div className="add-track-flyout__row">
					<button
						type="button"
						className="add-track-flyout__option add-track-flyout__checkbox"
						role="menuitemcheckbox"
						aria-checked={showMasterTrack}
						tabIndex={-1}
						onClick={onToggleMasterTrack}
					>
						<span className="add-track-flyout__check" aria-hidden="true">{showMasterTrack ? '✓' : ''}</span>
						<span className="add-track-flyout__option-label">{copy.masterTrack}</span>
					</button>
				</div>
			</div>
		</div>
	);
}

function TrackColorPicker({ isOpen, x, y, color, copy, onChange, onClose }) {
	return (
		<ContextMenu
			isOpen={isOpen}
			x={x}
			y={y}
			autoFocus
			onClose={onClose}
			className="audio-editor-track-color-picker"
		>
			<div className="audio-editor-track-color-picker__label">{copy.trackColor}</div>
			{AUDIO_EDITOR_TRACK_COLORS.map((candidate) => (
				<button
					key={candidate}
					type="button"
					role="menuitem"
					className="audio-editor-track-color-picker__swatch"
					data-color={candidate}
					data-selected={color === candidate ? 'true' : 'false'}
					style={{ backgroundColor: `var(--clip-${candidate}-body)` }}
					aria-label={`${copy.trackColor}: ${colorName(copy, candidate)}`}
					aria-current={color === candidate ? 'true' : undefined}
					onClick={() => {
						onChange(candidate);
						onClose();
					}}
				/>
			))}
		</ContextMenu>
	);
}

function createClipTrimPreview(projectIndex, session, requestedDelta, edge) {
	const originals = session.clipIds
		.map((clipId) => session.originals?.[clipId])
		.filter(Boolean);
	if (!originals.length) return null;
	let lowerBound = Number.NEGATIVE_INFINITY;
	let upperBound = Number.POSITIVE_INFINITY;
	for (const clip of originals) {
		const source = projectIndex.sourceById.get(clip.sourceId);
		if (!source) return null;
		const sourceDurationFrames = clip.sourceDurationFrames || clip.durationFrames;
		const sourceFramesPerTimelineFrame = sourceDurationFrames / clip.durationFrames;
		const sourceExtension = edge === 'left'
			? (clip.reversed
				? source.frameCount - clip.sourceStartFrame - sourceDurationFrames
				: clip.sourceStartFrame)
			: (clip.reversed
				? clip.sourceStartFrame
				: source.frameCount - clip.sourceStartFrame - sourceDurationFrames);
		if (edge === 'left') {
			lowerBound = Math.max(
				lowerBound,
				-Math.min(clip.timelineStartFrame, Math.floor(sourceExtension / sourceFramesPerTimelineFrame)),
			);
			upperBound = Math.min(upperBound, clip.durationFrames - 1);
		} else {
			lowerBound = Math.max(lowerBound, 1 - clip.durationFrames);
			upperBound = Math.min(upperBound, Math.floor(sourceExtension / sourceFramesPerTimelineFrame));
		}
	}
	const deltaFrames = Math.max(lowerBound, Math.min(upperBound, requestedDelta));
	const previews = originals.map((clip) => {
		const source = projectIndex.sourceById.get(clip.sourceId);
		const track = projectIndex.trackByClipId.get(clip.id);
		const sourceDurationFrames = clip.sourceDurationFrames || clip.durationFrames;
		const durationFrames = edge === 'left'
			? clip.durationFrames - deltaFrames
			: clip.durationFrames + deltaFrames;
		const sourceExtension = edge === 'left'
			? (clip.reversed
				? source.frameCount - clip.sourceStartFrame - sourceDurationFrames
				: clip.sourceStartFrame)
			: (clip.reversed
				? clip.sourceStartFrame
				: source.frameCount - clip.sourceStartFrame - sourceDurationFrames);
		const nextSourceDurationFrames = Math.max(1, Math.min(
			sourceDurationFrames + sourceExtension,
			Math.round(sourceDurationFrames * durationFrames / clip.durationFrames),
		));
		const removedSourceFrames = sourceDurationFrames - nextSourceDurationFrames;
		const trimsSourceStart = edge === 'left' ? !clip.reversed : clip.reversed;
		return {
			clipId: clip.id,
			trackId: track?.id,
			...(edge === 'left' ? {
				timelineStartFrame: clip.timelineStartFrame + deltaFrames,
				sourceStartFrame: clip.sourceStartFrame + (clip.reversed ? 0 : removedSourceFrames),
			} : {
				timelineStartFrame: clip.timelineStartFrame,
				sourceStartFrame: clip.reversed
					? clip.sourceStartFrame + removedSourceFrames
					: clip.sourceStartFrame,
			}),
			sourceDurationFrames: nextSourceDurationFrames,
			durationFrames,
			trimStartFrames: Math.max(0, (clip.trimStartFrames || 0) + (trimsSourceStart ? removedSourceFrames : 0)),
			trimEndFrames: Math.max(0, (clip.trimEndFrames || 0) + (trimsSourceStart ? 0 : removedSourceFrames)),
			fadeInFrames: Math.min(clip.fadeInFrames || 0, durationFrames),
			fadeOutFrames: Math.min(clip.fadeOutFrames || 0, durationFrames),
		};
	});
	const active = previews.find((preview) => preview.clipId === session.clipId);
	return active ? { ...active, previews } : null;
}

export default function AudioEditorTimeline({
	controller,
	snapshot,
	locale,
	copy,
	mobile,
	showArmControls,
	displayAudioSupported,
	splitToolEnabled = false,
	automationToolEnabled = false,
	onToggleSplitTool,
	onError,
	onOpenEffects,
	onOpenClipProperties,
	onExportClip,
	onRevealProjectBin,
	onToggleArmControls,
}) {
	const project = snapshot.project;
	const mutationsBlocked = snapshot.readOnly
		|| snapshot.importing
		|| snapshot.recording
		|| snapshot.recordingStarting
		|| snapshot.recordingScheduling
		|| snapshot.scheduledRecording
		|| snapshot.playbackOptions?.preparing
		|| snapshot.exporting
		|| snapshot.processingEffect
		|| snapshot.analysisProcessing
		|| snapshot.sampleEdit?.processing;
	const [timelineRef, timelineSize] = useElementSize();
	const navigationRootRef = useRef(null);
	const scrollRef = useRef(null);
	const pointerSession = useRef(null);
	const touchPointers = useRef(new Map());
	const pinchSession = useRef(null);
	const splitToolTimer = useRef(0);
	const splitToolPress = useRef(null);
	const splitToolHeldRef = useRef(false);
	const waveformCacheRef = useRef(new Map());
	const [splitToolHeld, setSplitToolHeld] = useState(false);
	const [scrollX, setScrollX] = useState(0);
	const [selectionPreview, setSelectionPreview] = useState(null);
	const [loopPreview, setLoopPreview] = useState(null);
	const [trackMenu, setTrackMenu] = useState(null);
	const [outputMenu, setOutputMenu] = useState(null);
	const [focusedOutputKey, setFocusedOutputKey] = useState(null);
	const [trackColorMenu, setTrackColorMenu] = useState(null);
	const [clipMenu, setClipMenu] = useState(null);
	const [timelineRulerMenu, setTimelineRulerMenu] = useState(null);
	const [trackRulerFlyout, setTrackRulerFlyout] = useState(null);
	const [waveformRulerState, setWaveformRulerState] = useState({});
	const [addTrackFlyout, setAddTrackFlyout] = useState(null);
	const addTrackTriggerRef = useRef(null);
	const closeAddTrackFlyout = useCallback(() => setAddTrackFlyout(null), []);
	const [draggingClipIds, setDraggingClipIds] = useState(null);
	const [clipDragPreview, setClipDragPreview] = useState(null);
	const [trackResizePreview, setTrackResizePreview] = useState(null);
	const [projectBinDragPreview, setProjectBinDragPreview] = useState(null);
	const transportState = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.transportState);
	const { activeProfile } = useAccessibilityProfile();
	const isFlatNavigation = activeProfile.config.tabNavigation === 'sequential';
	const timelineRulerTabIndex = useTabOrder('timeline-ruler');
	const trackBaseTabIndex = useTabOrder('tracks');
	const addTrackTabIndex = useTabOrder('add-track');
	const panelWidth = mobile ? COMPACT_TRACK_PANEL_WIDTH : DESKTOP_TRACK_PANEL_WIDTH;
	const showMasterTrack = Boolean(snapshot.preferences?.view?.showMasterTrack);
	const outputTracks = useMemo(() => [
		...(project?.mixer?.groups || []).map((bus) => ({ key: `group:${bus.id}`, scope: 'group', bus })),
		...(project?.mixer?.sends || []).map((bus) => ({ key: `send:${bus.id}`, scope: 'send', bus })),
		...(showMasterTrack && project?.master
			? [{ key: 'master', scope: 'master', bus: project.master }]
			: []),
	], [project?.master, project?.mixer?.groups, project?.mixer?.sends, showMasterTrack]);
	const outputDockContentHeight = outputTracks.reduce(
		(total, { bus }) => total + (bus.collapsed === false ? TRACK_HEIGHT : COLLAPSED_TRACK_HEIGHT),
		0,
	);
	const outputDockMaximumHeight = Math.max(
		COLLAPSED_TRACK_HEIGHT,
		Math.floor((timelineSize.height || COLLAPSED_TRACK_HEIGHT * 3) / 3),
	);
	const outputDockHeight = Math.min(outputDockContentHeight, outputDockMaximumHeight);
	const timelineView = snapshot.timeline?.view;
	const hasFrequencyRuler = snapshot.timeline?.showVerticalRulers !== false
		&& project?.tracks.some((track) => {
			if (track.type !== 'audio') return false;
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
		project ? editorTimelineDurationFrames(project, sampleRate) : sampleRate * 30,
		...recordingPreviews.map((preview) => preview.startFrame + preview.durationFrames),
	);
	const durationSeconds = framesToSeconds(durationFrames, { sampleRate });
	const timelineWidth = Math.max(viewportWidth, Math.ceil(durationSeconds * pixelsPerSecond));
	const viewportStartFrame = Math.max(0, secondsToFrames(scrollX / pixelsPerSecond, { sampleRate }));
	const viewportDurationFrames = Math.max(1, secondsToFrames(viewportWidth / pixelsPerSecond, { sampleRate }));
	const projectIndex = useMemo(
		() => createTimelineProjectIndex(project),
		[project?.clips, project?.sources, project?.tracks],
	);
	const projectClipIds = useMemo(
		() => new Set([...projectIndex.clipById.keys()].map(String)),
		[projectIndex],
	);
	const selectedClipIdSet = useMemo(
		() => new Set(project?.selection?.clipIds || []),
		[project?.selection?.clipIds],
	);
	for (const clipId of waveformCacheRef.current.keys()) {
		if (!projectClipIds.has(clipId)) waveformCacheRef.current.delete(clipId);
	}

	useEffect(() => {
		controller.actions.timeline.setViewportWidth(viewportWidth);
	}, [controller, viewportWidth]);

	const documentSelection = selectionPreview || snapshot.selection;
	const timeSelection = documentSelection && documentSelection.endFrame > documentSelection.startFrame
		? {
			startTime: framesToSeconds(documentSelection.startFrame, { sampleRate }),
			endTime: framesToSeconds(documentSelection.endFrame, { sampleRate }),
		}
		: null;
	const visualTrackHeight = useCallback((track) => trackVisualHeight(
		track,
		showArmControls,
		trackResizePreview?.trackId === track.id ? trackResizePreview.height : undefined,
	), [showArmControls, trackResizePreview]);
	const totalTrackHeight = project?.tracks.reduce((total, track) => total + visualTrackHeight(track), 0) || TRACK_HEIGHT;
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

	const openAddTrackFlyout = useCallback((event) => {
		if (addTrackFlyout) {
			setAddTrackFlyout(null);
			return;
		}
		const rect = event.currentTarget.getBoundingClientRect();
		setAddTrackFlyout({
			x: rect.left + rect.width / 2 - 96,
			y: rect.bottom + 8,
			autoFocus: event.nativeEvent.detail === 0,
		});
	}, [addTrackFlyout]);

	const addTrackFromFlyout = useCallback((type) => {
		setAddTrackFlyout(null);
		if (type === 'audio') return run(() => controller.actions.track.add());
		if (type === 'video') return run(() => controller.actions.track.addVideo());
		if (type === 'label') return run(() => controller.actions.track.addLabel());
		if (type === 'send') return run(() => controller.actions.mixer.addBus('send', {
			name: `${copy.sendBus} ${(project?.mixer?.sends?.length || 0) + 1}`,
		}));
		return undefined;
	}, [controller, copy.sendBus, project?.mixer?.sends?.length, run]);

	const toggleMasterTrack = useCallback(() => run(() => controller.actions.preferences.update({
		view: { showMasterTrack: !showMasterTrack },
	})), [controller, run, showMasterTrack]);

	const openClipMenu = useCallback((clipId, x, y, openedViaKeyboard = false) => {
		const clip = project?.clips.find((item) => String(item.id) === String(clipId));
		if (!clip) return;
		if (!project.selection?.clipIds?.includes(clip.id)) {
			run(() => controller.actions.timeline.selectClip(clip.id));
		}
		setClipMenu({
			clipId: clip.id,
			x: Number.isFinite(x) ? x : 0,
			y: Number.isFinite(y) ? y : 0,
			autoFocus: Boolean(openedViaKeyboard),
		});
	}, [controller, project, run]);

	const openTimelineRulerMenu = useCallback((event) => {
		event.preventDefault();
		event.stopPropagation();
		const rect = event.currentTarget.getBoundingClientRect();
		const openedViaKeyboard = event.type === 'keydown';
		setTrackRulerFlyout(null);
		setTimelineRulerMenu({
			x: openedViaKeyboard ? rect.left + 12 : event.clientX,
			y: openedViaKeyboard ? rect.bottom - 4 : event.clientY,
			autoFocus: openedViaKeyboard,
		});
	}, []);

	const openTrackRulerFlyout = useCallback((track, displayMode, event) => {
		event.preventDefault();
		event.stopPropagation();
		const rect = event.currentTarget.getBoundingClientRect();
		const openedViaKeyboard = event.type === 'keydown';
		const mode = displayMode === 'spectrogram'
			|| (displayMode === 'multiview' && (openedViaKeyboard || event.clientY < rect.top + rect.height / 2))
			? 'spectrogram'
			: 'waveform';
		const popupHeight = mode === 'spectrogram' ? 430 : 260;
		const requestedY = openedViaKeyboard ? rect.top : event.clientY + 8;
		setTimelineRulerMenu(null);
		setTrackRulerFlyout({
			trackId: track.id,
			mode,
			x: Math.max(8, rect.left - 208),
			y: Math.max(8, Math.min(requestedY, globalThis.innerHeight - popupHeight - 8)),
			trigger: event.currentTarget,
		});
	}, []);

	const onClipContextMenu = useCallback((event) => {
		const clipElement = event.target.closest?.('[data-clip-id]');
		if (!clipElement) return;
		event.preventDefault();
		event.stopPropagation();
		openClipMenu(clipElement.dataset.clipId, event.clientX, event.clientY);
	}, [openClipMenu]);

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

	const trackAtClientY = useCallback((clientY, fallbackTrackId) => {
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
	}, []);

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
		const lane = eventLane && !eventLane.closest('[data-label-track]') ? eventLane : null;
		const coordinateLane = lane
			|| scrollRef.current?.querySelector('.audio-editor-track-lane[data-track-lane]')
			|| scrollRef.current?.querySelector('[data-ruler-interaction]');
		return {
			trackId: lane?.dataset.trackId || null,
			timelineStartFrame: coordinateLane ? frameAtClientX(event.clientX, coordinateLane) : 0,
			createTrack: !lane,
		};
	}, [frameAtClientX]);

	const clearProjectBinDragState = useCallback((clearPayload = false) => {
		setProjectBinDragPreview(null);
		setDraggingClipIds(null);
		setProjectBinDropActive(false);
		if (clearPayload) clearActiveProjectBinDragPayload();
	}, [setProjectBinDropActive]);

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
				run(() => controller.actions.track.update(session.trackId, { height: session.height }));
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
		} else if (session.kind === 'trim-left') {
			const trimPreview = dragPreview || null;
			const nextTimelineStartFrame = Number(trimPreview?.timelineStartFrame);
			const nextDurationFrames = Number(trimPreview?.durationFrames);
			const changes = {};
			if (Number.isSafeInteger(nextTimelineStartFrame) && nextTimelineStartFrame !== session.original.timelineStartFrame) {
				changes.timelineStartFrame = nextTimelineStartFrame;
			}
			if (Number.isSafeInteger(nextDurationFrames) && nextDurationFrames !== session.original.durationFrames) {
				changes.durationFrames = nextDurationFrames;
			}
			if (Object.keys(changes).length) {
				run(() => controller.actions.clip.trim(clip.id, changes));
			}
		} else if (session.kind === 'trim-right') {
			const trimPreview = dragPreview || null;
			const nextDurationFrames = Number(trimPreview?.durationFrames);
			if (Number.isSafeInteger(nextDurationFrames) && nextDurationFrames !== session.original.durationFrames) {
				run(() => controller.actions.clip.trim(clip.id, { durationFrames: nextDurationFrames }));
			}
		}
	}, [controller, frameAtClientX, isOverOutputDock, onRevealProjectBin, pixelsPerSecond, project, run, sampleRate, setProjectBinDropActive, snapshot.timeline?.playbackOnRulerClick, trackAtClientY, transportState]);

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
		if (event.button !== 0 || mutationsBlocked) return;
		const clipHeader = event.target.closest?.('.clip-header');
		const resizeTrackRow = clipHeader?.closest?.('[data-track-row]');
		if (clipHeader && resizeTrackRow?.dataset.collapsed !== 'true') {
			const headerRect = clipHeader.getBoundingClientRect();
			const distanceFromTop = event.clientY - headerRect.top;
			const distanceFromBottom = headerRect.bottom - event.clientY;
			if (Math.min(distanceFromTop, distanceFromBottom) <= CLIP_HEADER_TRACK_RESIZE_HIT_HEIGHT) {
				const trackId = resizeTrackRow.dataset.trackId;
				const track = project.tracks.find((item) => item.id === trackId);
				if (track) {
					const edge = distanceFromTop <= distanceFromBottom ? 'top' : 'bottom';
					const controlsHeight = showArmControls && track.type === 'audio'
						? RECORDING_INPUT_CONTROLS_HEIGHT
						: 0;
					const originalHeight = Math.max(MINIMUM_TRACK_HEIGHT, Number(track.height) || TRACK_HEIGHT);
					const originalVisualHeight = trackVisualHeight(track, showArmControls);
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
		if (!event.target.closest('.clip-header') && !clipEditHandle && !edgeKind) {
			run(() => controller.actions.timeline.selectClip(null));
			const startFrame = frameAtClientX(event.clientX, lane);
			pointerSession.current = { kind: 'selection', startFrame, startX: event.clientX, lane };
			setSelectionPreview({ startFrame, endFrame: startFrame });
			event.currentTarget.setPointerCapture?.(event.pointerId);
			return;
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
		pointerSession.current = {
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
		setDraggingClipIds(new Set(interactionClipIds));
		const selectedClipIds = project.selection?.clipIds || [];
		if (event.shiftKey) {
			run(() => controller.actions.timeline.selectClip(clip.id, { additive: true }));
		} else if (event.metaKey || event.ctrlKey) {
			run(() => controller.actions.timeline.selectClip(clip.id, { toggle: true }));
		} else if (!transformClipIds.every((selectedId) => selectedClipIds.includes(selectedId))) {
			run(() => controller.actions.timeline.selectClip(clip.id));
		}
		event.currentTarget.setPointerCapture?.(event.pointerId);
	}, [automationToolEnabled, controller, frameAtClientX, mutationsBlocked, pixelsPerSecond, project, run, sampleRate, showArmControls, snapshot.sampleEdit?.available, snapshot.sampleEdit?.mode, splitToolActive, timelineView]);

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
		} else if (session?.kind === 'trim-left') {
			const deltaFrames = secondsToFrames(
				Math.abs(event.clientX - session.startX) / pixelsPerSecond,
				{ sampleRate },
			) * Math.sign(event.clientX - session.startX);
			const preview = createClipTrimPreview(projectIndex, session, deltaFrames, 'left');
			if (!preview) return;
			session.preview = preview;
			setClipDragPreview(preview);
		} else if (session?.kind === 'trim-right') {
			const deltaFrames = secondsToFrames(
				Math.abs(event.clientX - session.startX) / pixelsPerSecond,
				{ sampleRate },
			) * Math.sign(event.clientX - session.startX);
			const preview = createClipTrimPreview(projectIndex, session, deltaFrames, 'right');
			if (!preview) return;
			session.preview = preview;
			setClipDragPreview(preview);
		}
	}, [controller, frameAtClientX, isOverOutputDock, isOverProjectBin, panelWidth, pixelsPerSecond, project, projectIndex, run, sampleRate, setProjectBinDropActive, trackAtClientY]);

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

	const onTimelineDragOver = useCallback((event) => {
		const binDrag = dataTransferHasType(event.dataTransfer, AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE);
		const fileDrag = dataTransferHasType(event.dataTransfer, 'Files');
		if (!binDrag && !fileDrag) return;
		event.preventDefault();
		if (mutationsBlocked || !project) {
			event.dataTransfer.dropEffect = 'none';
			clearProjectBinDragState();
			return;
		}
		event.dataTransfer.dropEffect = 'copy';
		if (!binDrag) {
			setProjectBinDragPreview(null);
			setDraggingClipIds(null);
			return;
		}
		const payload = projectBinPayloadFromDataTransfer(event.dataTransfer);
		const clip = payload && String(payload.projectId) === String(project.id)
			? project.projectBin?.clips.find((item) => String(item.id) === String(payload.clipId))
			: null;
		if (!clip) {
			event.dataTransfer.dropEffect = 'none';
			clearProjectBinDragState();
			return;
		}
		const target = timelineDropTargetAt(event);
		const itemClips = clip.binItemId
			? project.projectBin.clips.filter((candidate) => candidate.binItemId === clip.binItemId)
			: [clip];
		const compatibleTracks = itemClips.map((itemClip) => (
			target.trackId ? compatibleMediaTrack(project, target.trackId, itemClip.kind) : null
		));
		const previewCreatesTrack = target.createTrack
			|| Boolean(target.trackId && compatibleTracks.some((candidate) => !candidate));
		const previews = itemClips.map((itemClip, index) => {
			const previewTrack = compatibleTracks[index];
			return {
				clip: itemClip,
				clipId: itemClip.id,
				trackId: previewCreatesTrack
					? `${NEW_AUDIO_TRACK_DROP_TARGET}-${index}`
					: previewTrack?.id || target.trackId,
				timelineStartFrame: target.timelineStartFrame,
			};
		});
		const activePreview = previews.find((preview) => preview.clipId === clip.id) || previews[0];
		const preview = {
			...activePreview,
			createTrack: previewCreatesTrack,
			previews,
		};
		setProjectBinDragPreview((current) => (
			current?.clipId === preview.clipId
			&& current.trackId === preview.trackId
			&& current.timelineStartFrame === preview.timelineStartFrame
			&& current.createTrack === preview.createTrack
				? current
				: preview
		));
		setDraggingClipIds((current) => (
			current?.size === previews.length
			&& previews.every((item) => current.has(String(item.clipId)))
				? current
				: new Set(previews.map((item) => String(item.clipId)))
		));
	}, [clearProjectBinDragState, mutationsBlocked, project, timelineDropTargetAt]);

	const onTimelineDragLeave = useCallback((event) => {
		const rect = event.currentTarget.getBoundingClientRect();
		if (
			event.clientX >= rect.left
			&& event.clientX < rect.right
			&& event.clientY >= rect.top
			&& event.clientY < rect.bottom
		) return;
		clearProjectBinDragState();
	}, [clearProjectBinDragState]);

	const onTimelineDrop = useCallback((event) => {
		const binDrag = dataTransferHasType(event.dataTransfer, AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE);
		const files = [...(event.dataTransfer?.files || [])];
		if (!binDrag && !files.length) return;
		event.preventDefault();
		const payload = binDrag ? projectBinPayloadFromDataTransfer(event.dataTransfer) : null;
		const target = timelineDropTargetAt(event);
		clearProjectBinDragState(true);
		if (mutationsBlocked || !project) return;
		if (payload) {
			if (String(payload.projectId) !== String(project.id)) return;
			const clip = project.projectBin?.clips.find((item) => String(item.id) === String(payload.clipId));
			if (!clip) return;
			run(() => controller.actions.projectBin.place(clip.id, {
				...(target.trackId ? { trackId: target.trackId } : {}),
				timelineStartFrame: target.timelineStartFrame,
			}));
			return;
		}
		if (files.length) {
			run(() => controller.actions.project.importFiles(files, {
				destination: 'timeline',
				...(target.trackId ? { trackId: target.trackId } : {}),
				timelineStartFrame: target.timelineStartFrame,
			}));
		}
	}, [clearProjectBinDragState, controller, mutationsBlocked, project, run, timelineDropTargetAt]);

	useEffect(() => {
		const finishHtmlDrag = () => clearProjectBinDragState(true);
		globalThis.addEventListener('dragend', finishHtmlDrag, true);
		return () => globalThis.removeEventListener('dragend', finishHtmlDrag, true);
	}, [clearProjectBinDragState]);

	if (!project) {
		return <div className="audio-editor-timeline-loading" role="status">{copy.loading}</div>;
	}

	const menuTrack = trackMenu ? project.tracks.find((track) => track.id === trackMenu.trackId) : null;
	const menuTrackBlock = menuTrack ? mediaTrackBlockBounds(project.tracks, menuTrack.id) : null;
	const colorMenuTrack = trackColorMenu ? project.tracks.find((track) => track.id === trackColorMenu.trackId) : null;
	const menuClip = clipMenu ? project.clips.find((clip) => clip.id === clipMenu.clipId) : null;
	const rulerFlyoutTrack = trackRulerFlyout
		? project.tracks.find((track) => track.id === trackRulerFlyout.trackId && track.type === 'audio')
		: null;
	const activeWaveformRuler = rulerFlyoutTrack
		? normalizeWaveformRulerState(waveformRulerState[rulerFlyoutTrack.id])
		: DEFAULT_WAVEFORM_RULER_STATE;
	const contextLocale = locale;
	const unavailableReason = copy.unavailable;
	const updateWaveformRuler = (trackId, changes) => {
		setWaveformRulerState((current) => ({
			...current,
			[trackId]: {
				...(current[trackId] || DEFAULT_WAVEFORM_RULER_STATE),
				...changes,
			},
		}));
	};
	const updateTrackSpectrogram = (track, changes) => {
		if (!track || mutationsBlocked) return;
		run(() => controller.actions.track.update(track.id, {
			spectrogram: { ...track.spectrogram, ...changes },
		}));
	};
	const zoomSpectrogram = (track, direction) => {
		if (!track || mutationsBlocked) return;
		const nyquist = sampleRate / 2;
		const minimum = Math.max(0, Number(track.spectrogram?.minimumFrequency) || 0);
		const maximum = Math.min(nyquist, Number(track.spectrogram?.maximumFrequency) || nyquist);
		const center = (minimum + maximum) / 2;
		const requestedSpan = (maximum - minimum) * (direction === 'in' ? 0.5 : 2);
		const span = Math.max(10, Math.min(nyquist, requestedSpan));
		const nextMinimum = Math.max(0, Math.min(nyquist - span, center - span / 2));
		updateTrackSpectrogram(track, {
			minimumFrequency: Math.round(nextMinimum),
			maximumFrequency: Math.round(nextMinimum + span),
		});
	};
	const trackMenuItems = menuTrack ? [
		...(menuTrack.type === 'audio' ? [
			manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.showArmControls, copy.showArmControls, {
				checked: showArmControls,
				onClick: onToggleArmControls,
			}, contextLocale, unavailableReason),
			{ divider: true, label: '' },
		] : []),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.duplicate, copy.duplicateTrack, {
			disabled: snapshot.readOnly || menuTrack.type !== 'audio',
			onClick: () => run(() => controller.actions.track.duplicate(menuTrack.id)),
		}, contextLocale, unavailableReason),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveTop, copy.moveTrackTop, {
			disabled: snapshot.readOnly || menuTrackBlock?.start === 0,
			onClick: () => run(() => moveMediaTrackBlock(controller, project.tracks, menuTrack.id, 'top')),
		}, contextLocale, unavailableReason),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveUp, copy.moveTrackUp, {
			disabled: snapshot.readOnly || menuTrackBlock?.start === 0,
			onClick: () => run(() => moveMediaTrackBlock(controller, project.tracks, menuTrack.id, 'up')),
		}, contextLocale, unavailableReason),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveDown, copy.moveTrackDown, {
			disabled: snapshot.readOnly || menuTrackBlock?.end === project.tracks.length - 1,
			onClick: () => run(() => moveMediaTrackBlock(controller, project.tracks, menuTrack.id, 'down')),
		}, contextLocale, unavailableReason),
		manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.moveBottom, copy.moveTrackBottom, {
			disabled: snapshot.readOnly || menuTrackBlock?.end === project.tracks.length - 1,
			onClick: () => run(() => moveMediaTrackBlock(controller, project.tracks, menuTrack.id, 'bottom')),
		}, contextLocale, unavailableReason),
		...(menuTrack.type === 'audio' ? [
			{ divider: true, label: '' },
			manifestMenuItem(AUDACITY_TRACK_CONTEXT_ACTION_IDS.changeColor, copy.trackColor, {
				disabled: mutationsBlocked,
				onClick: () => {
					const rect = trackMenu?.anchor?.getBoundingClientRect();
					setTrackColorMenu({
						trackId: menuTrack.id,
						x: rect?.right || 0,
						y: rect?.top || 0,
					});
				},
			}, contextLocale, unavailableReason),
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
		] : []),
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
	const outputMenuTarget = outputMenu?.scope === 'master'
		? project.master
		: project.mixer?.[`${outputMenu?.scope || ''}s`]?.find((bus) => bus.id === outputMenu?.busId) || null;
	const updateOutputMenuTarget = (changes) => {
		if (!outputMenuTarget || !outputMenu) return undefined;
		if (outputMenu.scope === 'master') return controller.actions.mixer.updateMaster(changes);
		return controller.actions.mixer.updateBus(outputMenu.scope, outputMenuTarget.id, changes);
	};
	const outputMenuItems = outputMenuTarget ? [
		{
			label: outputMenuTarget.collapsed === false ? copy.collapseTrack : copy.expandTrack,
			disabled: mutationsBlocked,
			onClick: () => run(() => updateOutputMenuTarget({ collapsed: outputMenuTarget.collapsed === false })),
		},
		...(outputMenu?.scope === 'master' ? [] : [
			{ divider: true, label: '' },
			{
				label: copy.removeBus,
				disabled: mutationsBlocked,
				onClick: () => run(() => controller.actions.mixer.removeBus(outputMenu.scope, outputMenuTarget.id)),
			},
		]),
	] : [];
	const displayedLoop = loopPreview || project.loop || {};
	return (
		<section
			className="audio-editor-timeline-panel"
			aria-label={copy.timeline}
			ref={setTimelineNode}
			data-has-output-tracks={outputTracks.length ? 'true' : 'false'}
			data-output-track-count={outputTracks.length}
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
				onDragOver={onTimelineDragOver}
				onDragLeave={onTimelineDragLeave}
				onDrop={onTimelineDrop}
			>
				<div className="audio-editor-timeline-inner" style={{
					width: panelWidth + timelineWidth + verticalRulerWidth,
					'--audio-editor-track-sidebar-width': `${panelWidth}px`,
				}}>
					<div className="audio-editor-ruler-row">
						<div className="audio-editor-ruler-corner" style={{ width: panelWidth }}>
							<span>{copy.tracks}</span>
							<Button
								ref={addTrackTriggerRef}
								variant="secondary"
								size="small"
								icon={<Icon name="plus" size={14} />}
								tabIndex={addTrackTabIndex}
								onClick={openAddTrackFlyout}
							>
								{copy.addTrack}
							</Button>
						</div>
						<div
							className="audio-editor-ruler-viewport"
							data-ruler
							data-ruler-focus
							data-ruler-interaction
							data-time-format={project.timeDisplay?.format === 'beats+measures' ? 'beats-measures' : 'minutes-seconds'}
							data-track-lane
							data-track-id={snapshot.selectedTrackId || project.tracks[0]?.id || ''}
							role="region"
							aria-label={copy.timeline}
							tabIndex={timelineRulerTabIndex}
							style={{ left: panelWidth, width: viewportWidth }}
							onContextMenu={openTimelineRulerMenu}
							onKeyDown={(event) => {
								if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
									openTimelineRulerMenu(event);
								} else if (event.key === 'Tab' && !event.shiftKey && project.tracks.length) {
									event.preventDefault();
									focusTrackContainer(0);
								} else if (event.key === 'Escape') {
									event.currentTarget.blur();
								}
							}}
						>
							<TimelineRuler
								pixelsPerSecond={pixelsPerSecond}
								scrollX={scrollX}
								totalDuration={durationSeconds}
								width={timelineWidth}
								viewportWidth={viewportWidth}
								timeSelection={timeSelection}
								sampleRate={sampleRate}
								timeFormat={project.timeDisplay?.format === 'beats+measures' ? 'beats-measures' : 'minutes-seconds'}
								bpm={project.tempo?.bpm || 120}
								beatsPerMeasure={project.tempo?.timeSignature?.numerator || 4}
								loopRegionEnabled={loopPreview ? true : Boolean(project.loop?.enabled)}
								loopRegionStart={framesToSeconds(displayedLoop.startFrame || 0, { sampleRate })}
								loopRegionEnd={framesToSeconds(displayedLoop.endFrame || 0, { sampleRate })}
								onLoopRegionEnabledToggle={() => run(() => controller.actions.transport.toggleLoop())}
							/>
							<TelemetryRulerPlayhead
								controller={controller}
								pixelsPerSecond={pixelsPerSecond}
								scrollX={scrollX}
								sampleRate={sampleRate}
								viewportWidth={viewportWidth}
							/>
						</div>
						{verticalRulerWidth > 0 && <div
							className="audio-editor-ruler-scale-corner"
							aria-hidden="true"
							style={{ left: panelWidth + viewportWidth, width: verticalRulerWidth }}
						/>}
					</div>

					<ContainerAddTrackFlyout
						isOpen={Boolean(addTrackFlyout)}
						x={addTrackFlyout?.x || 0}
						y={addTrackFlyout?.y || 0}
						autoFocus={Boolean(addTrackFlyout?.autoFocus)}
						triggerRef={addTrackTriggerRef}
						className="kw-audio-editor__add-track-flyout"
						copy={copy}
						mutationsBlocked={mutationsBlocked}
						showMasterTrack={showMasterTrack}
						onToggleMasterTrack={toggleMasterTrack}
						onSelectTrackType={addTrackFromFlyout}
						onClose={closeAddTrackFlyout}
					/>

					<div className="audio-editor-track-list" data-track-list>
						{project.tracks.map((track, trackIndex) => track.type === 'label' ? (
							<LabelTrackRow
								key={track.id}
								controller={controller}
								track={track}
								visualHeight={visualTrackHeight(track)}
								trackIndex={trackIndex}
								panelWidth={panelWidth}
								timelineWidth={timelineWidth}
								verticalRulerWidth={verticalRulerWidth}
								pixelsPerSecond={pixelsPerSecond}
								sampleRate={sampleRate}
								selection={documentSelection}
								selected={snapshot.selectedTrackId === track.id}
									blocked={snapshot.readOnly || snapshot.importing || snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling || snapshot.scheduledRecording || snapshot.exporting || snapshot.processingEffect}
								copy={copy}
								run={run}
								onMenu={(anchor) => setTrackMenu({ trackId: track.id, anchor })}
							/>
						) : track.type === 'video' ? (
							<VideoTrackRow
								key={track.id}
								controller={controller}
								track={track}
								visualHeight={visualTrackHeight(track)}
								trackClips={projectIndex.clipsByTrackId.get(track.id) || EMPTY_TIMELINE_CLIPS}
								clipLookup={projectIndex.clipById}
								sourceLookup={projectIndex.sourceById}
								trackIndex={trackIndex}
								trackCount={project.tracks.length}
								isFlatNavigation={isFlatNavigation}
								trackBaseTabIndex={trackBaseTabIndex}
								panelWidth={panelWidth}
								viewportStartFrame={viewportStartFrame}
								viewportDurationFrames={viewportDurationFrames}
								pixelsPerSecond={pixelsPerSecond}
								sampleRate={sampleRate}
								timelineWidth={timelineWidth}
								verticalRulerWidth={verticalRulerWidth}
								selectedTrackId={snapshot.selectedTrackId}
								selectedClipId={snapshot.selectedClipId}
								selectedClipIdSet={selectedClipIdSet}
								draggingClipIds={draggingClipIds}
								clipDragPreview={clipDragPreview}
								projectBinDragPreview={projectBinDragPreview}
								blocked={snapshot.readOnly || snapshot.importing || snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling || snapshot.scheduledRecording || snapshot.exporting || snapshot.processingEffect}
								copy={copy}
								run={run}
								onMenu={(anchor) => setTrackMenu({ trackId: track.id, anchor })}
								onOpenClipMenu={openClipMenu}
								onFocusTimelineRuler={focusTimelineRuler}
								onFocusTrackContainer={focusTrackContainer}
								onFocusTrackPanelControl={focusTrackPanelControl}
								onFocusTrackClip={focusTrackClip}
								onFocusSelectionToolbar={focusSelectionToolbar}
							/>
						) : (
							<TrackRow
								key={track.id}
								controller={controller}
								project={project}
								track={track}
								visualHeight={visualTrackHeight(track)}
								trackClips={projectIndex.clipsByTrackId.get(track.id) || EMPTY_TIMELINE_CLIPS}
								clipLookup={projectIndex.clipById}
								sourceLookup={projectIndex.sourceById}
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
								selectedClipIdSet={selectedClipIdSet}
								timelineView={snapshot.timeline?.view}
								showRms={Boolean(snapshot.timeline?.showRms)}
								waveformRulerFormat={normalizeWaveformRulerState(waveformRulerState[track.id]).format}
								waveformZoom={normalizeWaveformRulerState(waveformRulerState[track.id]).zoom}
								clipStyle={snapshot.preferences?.appearance?.clipStyle}
								recordingPreview={recordingPreviews.find((preview) => preview.trackId === track.id) || null}
								draggingClipIds={draggingClipIds}
								clipDragPreview={clipDragPreview}
								projectBinDragPreview={projectBinDragPreview}
								waveformCache={waveformCacheRef.current}
								automationToolEnabled={automationToolEnabled}
									blocked={snapshot.readOnly || snapshot.importing || snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling || snapshot.scheduledRecording || snapshot.exporting || snapshot.processingEffect}
								showArmControls={showArmControls}
								displayAudioSupported={displayAudioSupported}
								recordingInputs={snapshot.recordingInputs}
								copy={copy}
								run={run}
								onMenu={(anchor) => setTrackMenu({ trackId: track.id, anchor })}
								onOpenEffects={onOpenEffects}
								onOpenClipMenu={openClipMenu}
								onOpenRulerFlyout={(displayMode, event) => openTrackRulerFlyout(track, displayMode, event)}
								onFocusTimelineRuler={focusTimelineRuler}
								onFocusTrackContainer={focusTrackContainer}
								onFocusTrackPanelControl={focusTrackPanelControl}
								onFocusTrackClip={focusTrackClip}
								onFocusTrackRuler={focusTrackRuler}
								onFocusSelectionToolbar={focusSelectionToolbar}
							/>
						))}
						{(clipDragPreview?.createTrack || projectBinDragPreview?.createTrack) && (
							<div className="audio-editor-new-track-drop-preview" aria-live="polite">
								<span>{projectBinDragPreview?.clip?.title || copy.audioTrack}</span>
							</div>
						)}
					</div>

					<TimeSelectionOverlay
						selection={timeSelection}
						panelWidth={panelWidth}
						pixelsPerSecond={pixelsPerSecond}
						height={totalTrackHeight}
					/>

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
						run={run}
					/>
					<PinnedPlayheadScroller
						controller={controller}
						enabled={Boolean(
							snapshot.timeline?.pinnedPlayhead
							&& snapshot.timeline?.updateDisplayWhilePlaying !== false
						)}
						pixelsPerSecond={pixelsPerSecond}
						sampleRate={sampleRate}
						scrollRef={scrollRef}
						timelineWidth={timelineWidth}
						transportState={transportState}
						viewportWidth={viewportWidth}
					/>
				</div>
			</div>

			{outputTracks.length > 0 && <OutputTrackDock
				controller={controller}
				rows={outputTracks}
				focusedOutputKey={focusedOutputKey}
				onFocusOutput={setFocusedOutputKey}
				onMenu={(scope, busId, anchor) => {
					const rect = anchor?.getBoundingClientRect?.();
					setOutputMenu({
						scope,
						busId,
						anchor,
						x: rect?.right || 0,
						y: rect?.top || 0,
					});
				}}
				panelWidth={panelWidth}
				verticalRulerWidth={verticalRulerWidth}
				viewportWidth={viewportWidth}
				timelineWidth={timelineWidth}
				scrollX={scrollX}
				pixelsPerSecond={pixelsPerSecond}
				sampleRate={sampleRate}
				durationFrames={durationFrames}
				selection={timeSelection}
				height={outputDockHeight}
				automationToolEnabled={automationToolEnabled}
				blocked={mutationsBlocked}
				mobile={mobile}
				copy={copy}
				run={run}
				onOpenEffects={onOpenEffects}
			/>}

			<AudioEditorSampleTools controller={controller} snapshot={snapshot} copy={copy} run={run} />

			<TimelineRulerContextMenu
				isOpen={Boolean(timelineRulerMenu)}
				x={timelineRulerMenu?.x || 0}
				y={timelineRulerMenu?.y || 0}
				autoFocus={Boolean(timelineRulerMenu?.autoFocus)}
				onClose={() => setTimelineRulerMenu(null)}
				timeFormat={project.timeDisplay?.format === 'beats+measures' ? 'beats-measures' : 'minutes-seconds'}
				onTimeFormatChange={(format) => run(() => controller.actions.project.setTimeDisplay(
					format === 'beats-measures' ? 'beats+measures' : 'hh:mm:ss+milliseconds',
				))}
				updateDisplayWhilePlaying={snapshot.timeline?.updateDisplayWhilePlaying !== false}
				onToggleUpdateDisplay={() => run(() => controller.actions.timeline.toggleUpdateWhilePlaying())}
				pinnedPlayHead={Boolean(snapshot.timeline?.pinnedPlayhead)}
				onTogglePinnedPlayHead={() => run(() => controller.actions.timeline.togglePinnedPlayhead())}
				clickRulerToStartPlayback={snapshot.timeline?.playbackOnRulerClick !== false}
				onToggleClickRulerToStartPlayback={() => run(() => controller.actions.timeline.toggleRulerPlayback())}
				loopRegionEnabled={Boolean(project.loop?.enabled)}
				onToggleLoopRegion={() => run(() => controller.actions.transport.toggleLoop())}
				onClearLoopRegion={() => run(() => controller.actions.transport.clearLoop())}
				onSetLoopRegionToSelection={() => run(() => controller.actions.transport.loopToSelection())}
				onSetSelectionToLoop={() => run(() => controller.actions.transport.selectionToLoop())}
				creatingLoopSelectsAudio={Boolean(snapshot.loopOptions?.selectionFollows)}
				onToggleCreatingLoopSelectsAudio={() => run(() => controller.actions.transport.toggleSelectionFollowsLoop())}
				showVerticalRulers={snapshot.timeline?.showVerticalRulers !== false}
				onToggleVerticalRulers={() => run(() => controller.actions.timeline.toggleVerticalRulers())}
			/>

			<RulerFlyout
				isOpen={Boolean(trackRulerFlyout && rulerFlyoutTrack)}
				x={trackRulerFlyout?.x || 0}
				y={trackRulerFlyout?.y || 0}
				mode={trackRulerFlyout?.mode || 'waveform'}
				className="audio-editor-ruler-flyout"
				triggerRef={{ current: trackRulerFlyout?.trigger || null }}
				onClose={() => setTrackRulerFlyout(null)}
				rulerFormat={activeWaveformRuler.format}
				onRulerFormatChange={(format) => {
					if (rulerFlyoutTrack) updateWaveformRuler(rulerFlyoutTrack.id, { format: normalizeWaveformRulerFormat(format) });
				}}
				halfWave={rulerFlyoutTrack?.displayMode === 'half-wave'}
				onHalfWaveChange={(enabled) => {
					if (!rulerFlyoutTrack || mutationsBlocked) return;
					run(() => controller.actions.track.setDisplayMode(
						rulerFlyoutTrack.id,
						enabled ? 'half-wave' : 'waveform',
					));
				}}
				spectrogramScale={normalizeSpectrogramScale(rulerFlyoutTrack?.spectrogram?.scale)}
				onSpectrogramScaleChange={(scale) => updateTrackSpectrogram(rulerFlyoutTrack, {
					scale: scale === 'logarithmic' ? 'log' : scale,
				})}
				minFreq={rulerFlyoutTrack?.spectrogram?.minimumFrequency || 0}
				onMinFreqChange={(minimumFrequency) => updateTrackSpectrogram(rulerFlyoutTrack, { minimumFrequency })}
				maxFreq={rulerFlyoutTrack?.spectrogram?.maximumFrequency || Math.min(20_000, sampleRate / 2)}
				onMaxFreqChange={(maximumFrequency) => updateTrackSpectrogram(rulerFlyoutTrack, { maximumFrequency })}
				onZoomIn={() => {
					if (!rulerFlyoutTrack) return;
					if (trackRulerFlyout?.mode === 'spectrogram') zoomSpectrogram(rulerFlyoutTrack, 'in');
					else updateWaveformRuler(rulerFlyoutTrack.id, {
						zoom: Math.min(MAXIMUM_WAVEFORM_VERTICAL_ZOOM, activeWaveformRuler.zoom + 1),
					});
				}}
				onZoomOut={() => {
					if (!rulerFlyoutTrack) return;
					if (trackRulerFlyout?.mode === 'spectrogram') zoomSpectrogram(rulerFlyoutTrack, 'out');
					else updateWaveformRuler(rulerFlyoutTrack.id, {
						zoom: Math.max(0, activeWaveformRuler.zoom - 1),
					});
				}}
				onReset={() => {
					if (!rulerFlyoutTrack) return;
					if (trackRulerFlyout?.mode === 'spectrogram') updateTrackSpectrogram(rulerFlyoutTrack, {
						minimumFrequency: 0,
						maximumFrequency: Math.min(20_000, sampleRate / 2),
					});
					else updateWaveformRuler(rulerFlyoutTrack.id, { zoom: 0 });
				}}
			/>

			<Menu
				isOpen={Boolean(trackMenu && menuTrack)}
				anchorEl={trackMenu?.anchor || null}
				onClose={() => setTrackMenu(null)}
				className="audio-editor-track-menu"
				items={trackMenuItems}
			/>

			<ContextMenu
				isOpen={Boolean(outputMenu && outputMenuTarget)}
				x={outputMenu?.x || 0}
				y={outputMenu?.y || 0}
				autoFocus
				onClose={() => setOutputMenu(null)}
				className="audio-editor-output-track-menu"
			>
				{outputMenuItems.map((item, index) => item.divider ? (
					<ContextMenuItem key={`divider-${index}`} isDivider />
				) : (
					<ContextMenuItem
						key={item.label}
						label={item.label}
						disabled={item.disabled}
						onClick={item.onClick}
						onClose={() => setOutputMenu(null)}
					/>
				))}
			</ContextMenu>

			<TrackColorPicker
				isOpen={Boolean(trackColorMenu && colorMenuTrack)}
				x={trackColorMenu?.x || 0}
				y={trackColorMenu?.y || 0}
				color={resolveAudioEditorColor(colorMenuTrack?.color)}
				copy={copy}
				onChange={(color) => colorMenuTrack && run(() => controller.actions.track.update(colorMenuTrack.id, { color }))}
				onClose={() => setTrackColorMenu(null)}
			/>

			<ContextMenu
				isOpen={Boolean(clipMenu && menuClip)}
				x={clipMenu?.x || 0}
				y={clipMenu?.y || 0}
				autoFocus={Boolean(clipMenu?.autoFocus)}
				onClose={() => setClipMenu(null)}
				className="audio-editor-clip-context-menu"
			>
				<ContextMenuItem label={copy.clipColor} hasSubmenu onClose={() => setClipMenu(null)}>
					<ManifestContextMenuItem
						actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.useTrackColor}
						label={copy.followTrackColor}
						checked={menuClip?.color === 'auto'}
						disabled={mutationsBlocked || !menuClip}
						disabledReason={unavailableReason}
						locale={contextLocale}
						onClick={() => menuClip && run(() => controller.actions.clip.update(menuClip.id, { color: 'auto' }))}
					/>
					<ContextMenuItem isDivider />
					{AUDIO_EDITOR_TRACK_COLORS.map((color, colorIndex) => (
						<ManifestContextMenuItem
							key={color}
							actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.changeColor.replace('%1', colorIndex)}
							label={colorName(copy, color)}
							checked={menuClip?.color === color}
							disabled={mutationsBlocked || !menuClip}
							disabledReason={unavailableReason}
							locale={contextLocale}
							onClick={() => menuClip && run(() => controller.actions.clip.update(menuClip.id, { color }))}
						/>
					))}
				</ContextMenuItem>
				<ContextMenuItem isDivider />
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.properties}
					label={copy.clipPropertiesCommand}
					disabled={!menuClip || menuClip.kind !== 'audio'}
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
					disabled={mutationsBlocked || !menuClip || menuClip.kind !== 'audio'}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.reverse(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.normalizePeak}
					label={copy.normalizePeak}
					disabled={mutationsBlocked || !menuClip || menuClip.kind !== 'audio'}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.normalizePeak(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.renderPitchSpeed}
					label={copy.renderPitchSpeed}
					disabled={mutationsBlocked || !menuClip || menuClip.kind !== 'audio' || (menuClip.pitchCents === 0 && menuClip.speedRatio === 1)}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.renderPitchSpeed(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.resetPitchSpeed}
					label={copy.resetPitchSpeed}
					disabled={mutationsBlocked || !menuClip || menuClip.kind !== 'audio' || (menuClip.pitchCents === 0 && menuClip.speedRatio === 1)}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => menuClip && run(() => controller.actions.clip.resetPitchSpeed(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ManifestContextMenuItem
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.stretchToTempo}
					label={copy.stretchToTempo}
					checked={Boolean(menuClip?.stretchToTempo)}
					disabled={mutationsBlocked || !menuClip || menuClip.kind !== 'audio'}
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
					actionId={AUDACITY_CLIP_CONTEXT_ACTION_IDS.moveToProjectBin}
					label={copy.moveToProjectBin || 'Move to Project bin'}
					disabled={mutationsBlocked || !menuClip}
					disabledReason={unavailableReason}
					locale={contextLocale}
					onClick={() => {
						if (!menuClip) return;
						run(() => controller.actions.projectBin.moveFromTimeline(menuClip.id));
						onRevealProjectBin?.();
					}}
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

function colorName(copy, color) {
	return copy[`color${color[0].toUpperCase()}${color.slice(1)}`] || color;
}

function resolveAudioEditorColor(color, fallback = AUDIO_EDITOR_TRACK_COLORS[0]) {
	if (AUDIO_EDITOR_TRACK_COLORS.includes(color)) return color;
	const aliases = { purple: 'violet', pink: 'magenta', grey: fallback, gray: fallback };
	if (aliases[color]) return aliases[color];
	const index = Number(color);
	return Number.isSafeInteger(index)
		? AUDIO_EDITOR_TRACK_COLORS[index % AUDIO_EDITOR_TRACK_COLORS.length]
		: fallback;
}

function TelemetryRulerPlayhead({
	controller,
	pixelsPerSecond,
	scrollX,
	sampleRate,
	viewportWidth,
}) {
	const positionFrame = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.positionFrame || 0);
	const transportState = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.transportState);
	const cursorRef = useRef(null);
	useEffect(() => {
		const cursor = cursorRef.current;
		if (!cursor) return undefined;
		let animationFrame = 0;
		const update = (frame) => {
			const x = CLIP_CONTENT_OFFSET + framesToSeconds(frame, { sampleRate }) * pixelsPerSecond - scrollX;
			cursor.style.transform = `translate3d(${x}px, 0, 0)`;
			cursor.style.visibility = x >= CLIP_CONTENT_OFFSET && x <= viewportWidth ? 'visible' : 'hidden';
		};
		const draw = () => {
			update(controller.engine?.getPositionFrames?.() ?? positionFrame);
			animationFrame = globalThis.requestAnimationFrame(draw);
		};
		update(positionFrame);
		if (transportState === 'playing') animationFrame = globalThis.requestAnimationFrame(draw);
		return () => {
			if (animationFrame) globalThis.cancelAnimationFrame(animationFrame);
		};
	}, [controller, pixelsPerSecond, positionFrame, sampleRate, scrollX, transportState, viewportWidth]);
	const x = CLIP_CONTENT_OFFSET + framesToSeconds(positionFrame, { sampleRate }) * pixelsPerSecond - scrollX;
	return (
		<div
			className="audio-editor-ruler-playhead"
			aria-hidden="true"
			ref={cursorRef}
			style={{
				transform: `translate3d(${x}px, 0, 0)`,
				visibility: x >= CLIP_CONTENT_OFFSET && x <= viewportWidth ? 'visible' : 'hidden',
			}}
		/>
	);
}

function PinnedPlayheadScroller({
	controller,
	enabled,
	pixelsPerSecond,
	sampleRate,
	scrollRef,
	timelineWidth,
	transportState,
	viewportWidth,
}) {
	const positionFrame = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.positionFrame || 0);
	useEffect(() => {
		const element = scrollRef.current;
		if (!element || !enabled || transportState !== 'playing') return;
		const positionPixels = framesToSeconds(positionFrame, { sampleRate }) * pixelsPerSecond;
		const maximumScroll = Math.max(0, timelineWidth - viewportWidth);
		const nextScroll = Math.max(0, Math.min(maximumScroll, positionPixels - viewportWidth / 2));
		if (Math.abs(element.scrollLeft - nextScroll) > 1) element.scrollLeft = nextScroll;
	}, [enabled, pixelsPerSecond, positionFrame, sampleRate, scrollRef, timelineWidth, transportState, viewportWidth]);
	return null;
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
	run,
}) {
	const positionFrame = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.positionFrame || 0);
	const transportState = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.transportState);
	const playheadRef = useRef(null);
	const scrubbingRef = useRef(false);
	const scrubDragRef = useRef(null);
	const finishScrub = useCallback(() => {
		if (!scrubbingRef.current) return;
		scrubbingRef.current = false;
		scrubDragRef.current = null;
		run(() => controller.actions.transport.endScrub?.());
	}, [controller, run]);
	const finishPointerScrub = useCallback((event) => {
		if (event?.pointerId != null && scrubDragRef.current?.pointerId !== event.pointerId) return;
		finishScrub();
	}, [finishScrub]);
	useEffect(() => {
		globalThis.addEventListener('pointerup', finishPointerScrub);
		globalThis.addEventListener('pointercancel', finishPointerScrub);
		globalThis.addEventListener('blur', finishScrub);
		return () => {
			globalThis.removeEventListener('pointerup', finishPointerScrub);
			globalThis.removeEventListener('pointercancel', finishPointerScrub);
			globalThis.removeEventListener('blur', finishScrub);
			finishScrub();
		};
	}, [finishPointerScrub, finishScrub]);
	useEffect(() => {
		const playhead = playheadRef.current;
		if (!playhead) return undefined;
		let animationFrame = 0;
		const update = (frame) => {
			const x = CLIP_CONTENT_OFFSET + framesToSeconds(frame, { sampleRate }) * pixelsPerSecond;
			playhead.style.setProperty('--playhead-x', `${x}px`);
		};
		const draw = () => {
			update(controller.engine?.getPositionFrames?.() ?? positionFrame);
			animationFrame = globalThis.requestAnimationFrame(draw);
		};
		update(positionFrame);
		if (transportState === 'playing') animationFrame = globalThis.requestAnimationFrame(draw);
		return () => {
			if (animationFrame) globalThis.cancelAnimationFrame(animationFrame);
		};
	}, [controller, pixelsPerSecond, positionFrame, sampleRate, transportState]);
	const positionPixels = CLIP_CONTENT_OFFSET + framesToSeconds(positionFrame, { sampleRate }) * pixelsPerSecond;
	return (
		<div
			className="audio-editor-playhead-boundary"
			data-playhead
			ref={playheadRef}
			role="slider"
			tabIndex={0}
			aria-label={copy.playhead}
			aria-valuemin={0}
			aria-valuemax={durationFrames}
			aria-valuenow={positionFrame}
			style={{
				'--playhead-x': `${positionPixels}px`,
				left: panelWidth,
				width: viewportWidth,
				touchAction: 'none',
			}}
			onPointerDownCapture={(event) => {
				if (event.button !== 0 || event.isPrimary === false || !event.target.closest?.('.playhead-cursor')) return;
				event.preventDefault();
				event.stopPropagation();
				const liveFrame = Math.max(0, Math.round(
					controller.engine?.getPositionFrames?.() ?? positionFrame,
				));
				scrubDragRef.current = {
					pointerId: event.pointerId,
					clientX: event.clientX,
					startFrame: liveFrame,
				};
				event.currentTarget.setPointerCapture?.(event.pointerId);
				scrubbingRef.current = true;
				// Resume Web Audio from the initiating gesture; later pointer moves
				// are not consistently treated as activation by browsers.
				run(() => controller.actions.transport.scrub(liveFrame));
			}}
			onPointerMoveCapture={(event) => {
				const drag = scrubDragRef.current;
				if (!drag || drag.pointerId !== event.pointerId) return;
				event.preventDefault();
				event.stopPropagation();
				const frame = Math.max(0, Math.min(
					durationFrames,
					Math.round(drag.startFrame + (event.clientX - drag.clientX) / pixelsPerSecond * sampleRate),
				));
				run(() => controller.actions.transport.scrub(frame));
			}}
			onPointerUpCapture={(event) => {
				if (scrubDragRef.current?.pointerId !== event.pointerId) return;
				event.preventDefault();
				event.stopPropagation();
				event.currentTarget.releasePointerCapture?.(event.pointerId);
				finishScrub();
			}}
				onPointerCancelCapture={finishPointerScrub}
				onLostPointerCapture={finishPointerScrub}
			onKeyDown={(event) => {
				const amount = event.shiftKey ? Math.round(sampleRate / 10) : 1;
				if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
					event.preventDefault();
					run(() => controller.actions.transport.seek(positionFrame + (event.key === 'ArrowLeft' ? -amount : amount)));
				} else if (event.key === 'Home' || event.key === 'End') {
					event.preventDefault();
					run(() => controller.actions.transport.seek(event.key === 'Home' ? 0 : durationFrames));
				}
			}}
		>
			<PlayheadCursor
				position={framesToSeconds(positionFrame, { sampleRate })}
				pixelsPerSecond={pixelsPerSecond}
				height={height}
				showTopIcon
				iconTopOffset={-17}
				minPosition={0}
				onPositionChange={(seconds) => {
					const frame = secondsToFrames(seconds, { maximumFrame: durationFrames, sampleRate });
					return run(() => scrubbingRef.current
						? controller.actions.transport.scrub(frame)
						: controller.actions.transport.seek(frame));
				}}
			/>
		</div>
	);
}

function TimeSelectionOverlay({ selection, panelWidth, pixelsPerSecond, height }) {
	if (!selection || selection.endTime <= selection.startTime) return null;
	return (
		<div
			className="audio-editor-time-selection-overlay"
			data-time-selection-overlay
			aria-hidden="true"
			style={{
				left: panelWidth + CLIP_CONTENT_OFFSET + selection.startTime * pixelsPerSecond,
				width: Math.max(1, (selection.endTime - selection.startTime) * pixelsPerSecond),
				height,
			}}
		/>
	);
}

function OutputTrackDock({
	controller,
	rows,
	focusedOutputKey,
	onFocusOutput,
	onMenu,
	panelWidth,
	verticalRulerWidth,
	viewportWidth,
	timelineWidth,
	scrollX,
	pixelsPerSecond,
	sampleRate,
	durationFrames,
	selection,
	height,
	automationToolEnabled,
	blocked,
	mobile,
	copy,
	run,
	onOpenEffects,
}) {
	const dockRef = useRef(null);
	const positionFrame = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.positionFrame || 0);
	const transportState = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.transportState);
	const playheadX = CLIP_CONTENT_OFFSET + framesToSeconds(positionFrame, { sampleRate }) * pixelsPerSecond;
	const outputRows = useCallback(() => [
		...(dockRef.current?.querySelectorAll(':scope > [data-output-track-row]') || []),
	], []);
	const focusOutputPanel = useCallback((rowIndex, lastControl = false) => {
		const panel = outputRows()[rowIndex]?.querySelector('.track-control-panel');
		return lastControl ? focusPanelControl(panel, true) : focusFirst(panel);
	}, [outputRows]);
	const focusOutputLane = useCallback((rowIndex) => (
		focusFirst(outputRows()[rowIndex]?.querySelector('[data-output-lane]'))
	), [outputRows]);

	useEffect(() => {
		const dock = dockRef.current;
		if (!dock) return undefined;
		let animationFrame = 0;
		const update = (frame) => {
			const x = CLIP_CONTENT_OFFSET + framesToSeconds(frame, { sampleRate }) * pixelsPerSecond;
			dock.style.setProperty('--output-playhead-x', `${x}px`);
		};
		const draw = () => {
			update(controller.engine?.getPositionFrames?.() ?? positionFrame);
			animationFrame = globalThis.requestAnimationFrame(draw);
		};
		update(positionFrame);
		if (transportState === 'playing') animationFrame = globalThis.requestAnimationFrame(draw);
		return () => {
			if (animationFrame) globalThis.cancelAnimationFrame(animationFrame);
		};
	}, [controller, pixelsPerSecond, positionFrame, sampleRate, transportState]);

	return (
		<div
			ref={dockRef}
			className="audio-editor-output-dock"
			data-output-track-dock
			aria-label={copy.output}
			style={{ height, '--output-playhead-x': `${playheadX}px` }}
			onDragEnter={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
			onDragOver={(event) => {
				event.preventDefault();
				event.stopPropagation();
				if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
			}}
			onDrop={(event) => {
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			{rows.map(({ key, scope, bus }, rowIndex) => <OutputTrackRow
				key={key}
				controller={controller}
				rowKey={key}
				scope={scope}
				bus={bus}
				focused={focusedOutputKey === key}
				onFocus={() => onFocusOutput(key)}
				onMenu={(anchor) => onMenu(scope, scope === 'master' ? null : bus.id, anchor)}
				onFocusPanel={(lastControl = false) => focusOutputPanel(rowIndex, lastControl)}
				onFocusLane={() => focusOutputLane(rowIndex)}
				onFocusPreviousLane={() => rowIndex > 0 && focusOutputLane(rowIndex - 1)}
				onFocusNextPanel={() => rowIndex + 1 < rows.length && focusOutputPanel(rowIndex + 1)}
				onNavigatePanel={(direction) => {
					const targetIndex = rowIndex + (direction === 'down' ? 1 : -1);
					return targetIndex >= 0 && targetIndex < rows.length && focusOutputPanel(targetIndex);
				}}
				onNavigateLane={(direction) => {
					const targetIndex = rowIndex + (direction === 'down' ? 1 : -1);
					return targetIndex >= 0 && targetIndex < rows.length && focusOutputLane(targetIndex);
				}}
				panelWidth={panelWidth}
				verticalRulerWidth={verticalRulerWidth}
				viewportWidth={viewportWidth}
				timelineWidth={timelineWidth}
				scrollX={scrollX}
				pixelsPerSecond={pixelsPerSecond}
				sampleRate={sampleRate}
				durationFrames={durationFrames}
				selection={selection}
				automationToolEnabled={automationToolEnabled}
				blocked={blocked}
				mobile={mobile}
				copy={copy}
				run={run}
				onOpenEffects={onOpenEffects}
			/>)}
		</div>
	);
}

function OutputTrackRow({
	controller,
	rowKey,
	scope,
	bus,
	focused,
	onFocus,
	onMenu,
	onFocusPanel,
	onFocusLane,
	onFocusPreviousLane,
	onFocusNextPanel,
	onNavigatePanel,
	onNavigateLane,
	panelWidth,
	verticalRulerWidth,
	viewportWidth,
	timelineWidth,
	scrollX,
	pixelsPerSecond,
	sampleRate,
	durationFrames,
	selection,
	automationToolEnabled,
	blocked,
	mobile,
	copy,
	run,
	onOpenEffects,
}) {
	const canonicalDurationFrames = Math.max(1, durationFrames);
	const envelopeStartFrame = Math.max(0, Math.min(
		canonicalDurationFrames - 1,
		Math.floor(scrollX / pixelsPerSecond * sampleRate),
	));
	const envelopeEndFrame = Math.max(
		envelopeStartFrame + 1,
		Math.min(
			canonicalDurationFrames,
			Math.ceil((scrollX + viewportWidth) / pixelsPerSecond * sampleRate),
		),
	);
	const envelopeDurationFrames = envelopeEndFrame - envelopeStartFrame;
	const envelopeDurationSeconds = framesToSeconds(envelopeDurationFrames, { sampleRate });
	const envelopeLeft = CLIP_CONTENT_OFFSET
		+ framesToSeconds(envelopeStartFrame, { sampleRate }) * pixelsPerSecond;
	const envelopeWidth = Math.max(1, envelopeDurationSeconds * pixelsPerSecond);
	const rowHeight = bus.collapsed === false ? TRACK_HEIGHT : COLLAPSED_TRACK_HEIGHT;
	const canonicalPoints = useMemo(() => {
		const projected = envelopeFramesToDesignPoints(bus.envelope, sampleRate, {
			startFrame: envelopeStartFrame,
			endFrame: envelopeEndFrame,
		});
		const evaluate = createEnvelopeValueEvaluator(bus.envelope, canonicalDurationFrames);
		const withBoundaries = [...projected];
		if (!withBoundaries.some((point) => point.time === 0)) {
			withBoundaries.unshift({ time: 0, db: envelopeValueToDb(evaluate(envelopeStartFrame)) });
		}
		if (!withBoundaries.some((point) => Math.abs(point.time - envelopeDurationSeconds) < 1e-6)) {
			withBoundaries.push({
				time: envelopeDurationSeconds,
				db: envelopeValueToDb(evaluate(envelopeEndFrame)),
			});
		}
		return withBoundaries;
	}, [
		bus.envelope,
		canonicalDurationFrames,
		envelopeDurationSeconds,
		envelopeEndFrame,
		envelopeStartFrame,
		sampleRate,
	]);
	const previewRef = useRef(null);
	const rowRef = useRef(null);
	const [previewPoints, setPreviewPoints] = useState(null);
	const [envelopeEditActive, setEnvelopeEditActive] = useState(false);
	const displayedPoints = previewPoints || canonicalPoints;
	const curvePoints = displayedPoints;
	const update = useCallback((changes) => {
		if (scope === 'master') return controller.actions.mixer.updateMaster(changes);
		return controller.actions.mixer.updateBus(scope, bus.id, changes);
	}, [bus.id, controller, scope]);

	useEffect(() => {
		if (!envelopeEditActive) return undefined;
		const finishEnvelopeEdit = () => globalThis.setTimeout(() => {
			const points = previewRef.current;
			setEnvelopeEditActive(false);
			if (!points) return;
			previewRef.current = null;
			setPreviewPoints(null);
			run(() => update({
				envelope: mergeDesignEnvelopePoints(
					bus.envelope,
					points,
					sampleRate,
					canonicalDurationFrames,
					{
						startFrame: envelopeStartFrame,
						endFrame: envelopeEndFrame,
						maximumValue: 16,
					},
				),
			}));
		}, 0);
		document.addEventListener('mouseup', finishEnvelopeEdit);
		return () => document.removeEventListener('mouseup', finishEnvelopeEdit);
	}, [bus.envelope, canonicalDurationFrames, envelopeEditActive, envelopeEndFrame, envelopeStartFrame, run, sampleRate, update]);

	useEffect(() => {
		if (automationToolEnabled) return;
		previewRef.current = null;
		setPreviewPoints(null);
		setEnvelopeEditActive(false);
	}, [automationToolEnabled]);
	useEffect(() => {
		if (previewRef.current === null) setPreviewPoints(null);
	}, [bus.envelope]);

	const lineColor = scope === 'group' ? '#3975ad' : scope === 'send' ? '#7854b8' : '#7f8996';
	return (
		<div
			ref={rowRef}
			className="audio-editor-output-track-row"
			data-output-track-row
			data-output-scope={scope}
			data-output-id={scope === 'master' ? 'master' : bus.id}
			data-output-key={rowKey}
			data-collapsed={bus.collapsed === false ? 'false' : 'true'}
			data-focused={focused ? 'true' : 'false'}
			style={{ height: rowHeight, '--output-track-color': lineColor }}
		>
			<OutputTrackControls
				controller={controller}
				scope={scope}
				bus={bus}
				trackHeight={rowHeight}
				panelWidth={panelWidth}
				focused={focused}
				onFocus={onFocus}
				onMenu={onMenu}
				onFocusPanel={onFocusPanel}
				onTabOut={onFocusLane}
				onShiftTabOut={onFocusPreviousLane}
				onNavigateVertical={onNavigatePanel}
				blocked={blocked}
				mobile={mobile}
				copy={copy}
				run={run}
				update={update}
				onOpenEffects={onOpenEffects}
			/>
			<div
				className="audio-editor-output-lane-viewport"
				style={{ left: panelWidth, right: verticalRulerWidth, width: viewportWidth }}
			>
				<div
					className="audio-editor-output-lane"
					data-output-lane
					data-output-scope={scope}
					data-output-id={scope === 'master' ? 'master' : bus.id}
					role="region"
					tabIndex={0}
					aria-label={`${scope === 'master' ? copy.master : bus.name}: ${copy.volumeEnvelope || copy.clipGain}`}
					style={{
						width: timelineWidth,
						height: rowHeight,
						transform: `translate3d(${-scrollX}px, 0, 0)`,
					}}
					onFocus={onFocus}
					onKeyDown={(event) => {
						if (event.key === 'Tab') {
							const moved = event.shiftKey ? onFocusPanel() : onFocusNextPanel();
							if (!moved) return;
							event.preventDefault();
							event.stopPropagation();
						} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
							if (!onNavigateLane(event.key === 'ArrowDown' ? 'down' : 'up')) return;
							event.preventDefault();
							event.stopPropagation();
						} else if (event.key === 'Escape') {
							event.preventDefault();
							event.stopPropagation();
							onFocusPanel();
						} else if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
							event.preventDefault();
							event.stopPropagation();
							const anchor = rowRef.current?.querySelector('[aria-label="Track menu"]')
								|| rowRef.current?.querySelector('.track-control-panel');
							onMenu(anchor);
						}
					}}
				>
					{selection && <div
						className="audio-editor-output-time-selection"
						aria-hidden="true"
						style={{
							left: CLIP_CONTENT_OFFSET + selection.startTime * pixelsPerSecond,
							width: Math.max(1, (selection.endTime - selection.startTime) * pixelsPerSecond),
						}}
					/>}
					<div
						className="audio-editor-output-envelope"
						style={{ left: envelopeLeft, width: envelopeWidth }}
						onMouseDownCapture={(event) => {
							if (event.button === 0 && automationToolEnabled && !blocked) setEnvelopeEditActive(true);
						}}
					>
						<EnvelopeCurve
							points={curvePoints}
							x={0}
							y={0}
							width={envelopeWidth}
							height={rowHeight}
							startTime={0}
							duration={envelopeDurationSeconds}
							pixelsPerSecond={pixelsPerSecond}
							lineColor={lineColor}
							pointColor="#ffffff"
							active={false}
						/>
						<EnvelopeInteractionLayer
							envelopePoints={displayedPoints}
							onEnvelopePointsChange={(points) => {
								if (blocked || !automationToolEnabled) return;
								previewRef.current = points;
								setPreviewPoints(points);
								setEnvelopeEditActive(true);
							}}
							enabled={automationToolEnabled && !blocked}
							width={envelopeWidth}
							height={rowHeight}
							duration={envelopeDurationSeconds}
						/>
					</div>
					<div
						className="audio-editor-output-playhead"
						aria-hidden="true"
						style={{ transform: 'translate3d(var(--output-playhead-x), 0, 0)' }}
					/>
				</div>
			</div>
			{verticalRulerWidth > 0 && <div
				className="audio-editor-output-ruler"
				aria-hidden="true"
				style={{ width: verticalRulerWidth }}
			/>}
		</div>
	);
}

function OutputTrackControls({
	controller,
	scope,
	bus,
	trackHeight,
	panelWidth,
	focused,
	onFocus,
	onMenu,
	onFocusPanel,
	onTabOut,
	onShiftTabOut,
	onNavigateVertical,
	blocked,
	mobile,
	copy,
	run,
	update,
	onOpenEffects,
}) {
	const controlsRef = useRef(null);
	const [editingName, setEditingName] = useState(false);
	const meter = useAudioEditorTelemetrySelector(controller, (telemetry) => scope === 'master'
		? telemetry.meters?.master
		: telemetry.meters?.[`${scope}s`]?.[bus.id]);
	const meterVolume = meterPercent(meter?.dbfs);
	const label = scope === 'master' ? copy.master : bus.name;
	return (
		<div
			ref={controlsRef}
			className="audio-editor-track-controls audio-editor-output-track-controls"
			data-output-track-header
			style={{ width: panelWidth }}
			onKeyDownCapture={(event) => {
				const panel = controlsRef.current?.querySelector('.track-control-panel');
				if (event.key !== 'Tab' || event.target !== panel) return;
				const moved = event.shiftKey ? onShiftTabOut?.() : onTabOut?.();
				if (moved) event.preventDefault();
				event.stopPropagation();
			}}
			onDoubleClick={(event) => {
				if (scope === 'master' || blocked || !(event.target instanceof Element)) return;
				if (event.target.closest('.track-control-panel__track-name-text')) setEditingName(true);
			}}
		>
			<TrackControlPanel
				trackName={label}
				trackType="stereo"
				volume={gainDbToDesignVolume(linearToDb(bus.gain))}
				pan={panToDesignValue(bus.pan)}
				isMuted={Boolean(bus.mute)}
				isSolo={Boolean(bus.solo)}
				isFocused={focused}
				height={bus.collapsed === false ? (mobile ? 'truncated' : 'default') : 'collapsed'}
				trackHeight={trackHeight}
				meterLevelLeft={meterVolume}
				meterLevelRight={meterVolume}
				meterClippedLeft={(meter?.peak || 0) >= 1}
				meterClippedRight={(meter?.peak || 0) >= 1}
				tabIndex={0}
				onVolumeChange={(volume) => !blocked && run(() => update({
					gain: dbToLinear(designVolumeToGainDb(volume)),
				}))}
				onPanChange={(pan) => !blocked && run(() => update({ pan: designValueToPan(pan) }))}
				onMuteToggle={() => !blocked && run(() => update({ mute: !bus.mute }))}
				onSoloToggle={() => !blocked && run(() => update({ solo: !bus.solo }))}
				onEffectsClick={() => onOpenEffects?.(
					scope === 'master' ? null : bus.id,
					controlsRef.current?.getBoundingClientRect() || null,
					scope,
				)}
				onMenuClick={(event) => onMenu(event.currentTarget)}
				onClick={onFocus}
				onFocusChange={(hasFocus) => hasFocus && onFocus()}
				onNavigateVertical={onNavigateVertical}
				onTabOut={onTabOut}
				onShiftTabOut={() => {
					const panel = controlsRef.current?.querySelector('.track-control-panel');
					if (document.activeElement !== panel) return onFocusPanel?.();
					return onShiftTabOut?.();
				}}
			/>
			{editingName && <OutputTrackNameEditor
				name={bus.name}
				label={copy.trackName}
				blocked={blocked}
				onCommit={(name) => run(() => update({ name }))}
				onClose={() => setEditingName(false)}
			/>}
		</div>
	);
}

function OutputTrackNameEditor({ name: initialName, label, blocked, onCommit, onClose }) {
	const editorRef = useRef(null);
	const [name, setName] = useState(initialName);
	useEffect(() => setName(initialName), [initialName]);
	useEffect(() => {
		const input = editorRef.current?.querySelector('input');
		input?.focus();
		input?.select();
	}, []);
	const commit = () => {
		const nextName = name.trim();
		if (nextName && nextName !== initialName) onCommit(nextName);
		onClose();
	};
	return (
		<label
			ref={editorRef}
			className="audio-editor-output-name-editor"
			onBlur={commit}
			onKeyDown={(event) => {
				if (event.key === 'Enter') {
					event.preventDefault();
					event.currentTarget.querySelector('input')?.blur();
				} else if (event.key === 'Escape') {
					event.preventDefault();
					setName(initialName);
					onClose();
				}
			}}
		>
			<span className="kw-audio-editor-sr-only">{label}: {initialName}</span>
			<TextInput value={name} disabled={blocked} width="100%" onChange={setName} />
		</label>
	);
}

function VideoTrackRow({
	controller,
	track,
	visualHeight,
	trackClips,
	clipLookup,
	sourceLookup,
	trackIndex,
	trackCount,
	isFlatNavigation,
	trackBaseTabIndex,
	panelWidth,
	viewportStartFrame,
	viewportDurationFrames,
	pixelsPerSecond,
	sampleRate,
	timelineWidth,
	verticalRulerWidth,
	selectedTrackId,
	selectedClipId,
	selectedClipIdSet,
	draggingClipIds,
	clipDragPreview,
	projectBinDragPreview,
	blocked,
	copy,
	run,
	onMenu,
	onOpenClipMenu,
	onFocusTimelineRuler,
	onFocusTrackContainer,
	onFocusTrackPanelControl,
	onFocusTrackClip,
	onFocusSelectionToolbar,
}) {
	const trackWindowRef = useRef(null);
	const trackHeight = visualHeight;
	const clips = useMemo(() => {
		const projected = [...trackClips];
		if (clipDragPreview) {
			const previews = clipDragPreview.previews || [clipDragPreview];
			const previewIds = new Set(previews.map((preview) => preview.clipId));
			const stationary = projected.filter((clip) => !previewIds.has(clip.id));
			projected.splice(0, projected.length, ...stationary);
			for (const preview of previews) {
				if (track.id !== preview.trackId) continue;
				const draggedClip = clipLookup.get(preview.clipId);
				if (draggedClip?.kind === 'video') projected.push({ ...draggedClip, ...preview });
			}
		}
		for (const preview of projectBinDragPreview?.previews || (projectBinDragPreview ? [projectBinDragPreview] : [])) {
			if (preview.trackId !== track.id || preview.clip?.kind !== 'video') continue;
			projected.push({
				...preview.clip,
				timelineStartFrame: preview.timelineStartFrame,
				groupId: null,
				projectBinClipId: preview.clip.id,
			});
		}
		return projected;
	}, [clipDragPreview, clipLookup, projectBinDragPreview, track.id, trackClips]);
	const projection = useMemo(() => projectClipsToViewport(clips, {
		viewportStartFrame,
		viewportDurationFrames,
		sampleRate,
	}), [clips, sampleRate, viewportDurationFrames, viewportStartFrame]);
	const windowLeft = framesToSeconds(projection.overscanStartFrame, { sampleRate }) * pixelsPerSecond;
	const windowFrames = Math.max(1, projection.overscanEndFrame - projection.overscanStartFrame);
	const windowWidth = Math.max(1, framesToSeconds(windowFrames, { sampleRate }) * pixelsPerSecond);
	const overlapPresentation = useMemo(() => createVideoOverlapPresentation(
		clips,
		projection.overscanStartFrame,
		projection.overscanEndFrame,
		pixelsPerSecond,
		sampleRate,
	), [
		clips,
		pixelsPerSecond,
		projection.overscanEndFrame,
		projection.overscanStartFrame,
		sampleRate,
	]);
	const overlapState = overlapPresentation.invalid
		? 'invalid'
		: overlapPresentation.overlays.length
			? 'crossfade'
			: 'none';
	const tabIndexFor = (offset) => isFlatNavigation ? 0 : trackBaseTabIndex + trackIndex * 4 + offset;

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
	}, [isFlatNavigation, projection.clips, trackBaseTabIndex, trackIndex]);

	const focusBeforeTrack = () => {
		if (trackIndex === 0) return onFocusTimelineRuler();
		const previousTrack = trackIndex - 1;
		if (onFocusTrackClip(previousTrack, true)) return true;
		if (onFocusTrackPanelControl(previousTrack, true)) return true;
		return onFocusTrackContainer(previousTrack);
	};
	const focusAfterTrack = () => {
		if (trackIndex + 1 < trackCount) return onFocusTrackContainer(trackIndex + 1);
		return onFocusSelectionToolbar();
	};
	const focusAfterPanel = () => {
		if (onFocusTrackClip(trackIndex)) return true;
		return focusAfterTrack();
	};

	return (
		<div
			className="audio-editor-track-row audio-editor-video-track-row"
			data-track-row
			data-video-track
			data-track-id={track.id}
			data-track-index={trackIndex}
			data-collapsed={track.collapsed ? 'true' : 'false'}
			data-hidden={track.hidden ? 'true' : 'false'}
			data-video-overlap-state={overlapState}
			data-video-overlap-valid={overlapPresentation.invalid ? 'false' : 'true'}
			style={{ height: trackHeight }}
		>
			<VideoTrackControls
				controller={controller}
				track={track}
				panelWidth={panelWidth}
				selected={selectedTrackId === track.id}
				blocked={blocked}
				isFlatNavigation={isFlatNavigation}
				copy={copy}
				run={run}
				onMenu={onMenu}
				onTabOut={focusAfterPanel}
				onShiftTabOut={() => onFocusTrackContainer(trackIndex)}
				onNavigateVertical={(direction) => {
					const targetIndex = trackIndex + (direction === 'down' ? 1 : -1);
					if (targetIndex >= 0 && targetIndex < trackCount) onFocusTrackPanelControl(targetIndex);
				}}
			/>
			<div
				className="audio-editor-track-lane audio-editor-video-track-lane"
				data-track-lane
				data-track-id={track.id}
				data-selected={selectedTrackId === track.id}
				aria-invalid={overlapPresentation.invalid ? 'true' : undefined}
				aria-label={track.name}
				style={{ marginLeft: panelWidth, width: timelineWidth + verticalRulerWidth, height: trackHeight }}
				onClick={(event) => {
					if (event.target.closest('[data-clip-id]')) return;
					run(() => controller.actions.timeline.selectTrack(track.id));
				}}
			>
				<div
					ref={trackWindowRef}
					className="audio-editor-track-window audio-editor-video-track-window"
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
						if (event.key === 'Tab') {
							event.preventDefault();
							event.stopPropagation();
							if (event.shiftKey) onFocusTrackPanelControl(trackIndex, true);
							else focusAfterTrack();
							return;
						}
						if (
							event.altKey
							|| event.ctrlKey
							|| event.metaKey
							|| event.shiftKey
							|| (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
						) return;
						const clipElements = clipGroups(trackWindowRef.current);
						const currentIndex = clipElements.indexOf(event.target);
						if (currentIndex < 0 || clipElements.length < 2) return;
						event.preventDefault();
						event.stopPropagation();
						const direction = event.key === 'ArrowRight' ? 1 : -1;
						const next = clipElements[(currentIndex + direction + clipElements.length) % clipElements.length];
						if (!isFlatNavigation) {
							for (const clipElement of clipElements) {
								clipElement.tabIndex = clipElement === next ? tabIndexFor(2) : -1;
							}
						}
						focusFirst(next);
					}}
				>
					<div
						className="track audio-editor-video-track-surface"
						role="group"
						aria-label={track.name}
						tabIndex={tabIndexFor(0)}
						onFocus={() => {
							if (selectedTrackId !== track.id) run(() => controller.actions.timeline.selectTrack(track.id));
						}}
						onKeyDown={(event) => {
							if (event.key === 'Tab') {
								event.preventDefault();
								if (event.shiftKey) focusBeforeTrack();
								else onFocusTrackPanelControl(trackIndex);
							} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
								event.preventDefault();
								const targetIndex = trackIndex + (event.key === 'ArrowDown' ? 1 : -1);
								if (targetIndex >= 0 && targetIndex < trackCount) onFocusTrackContainer(targetIndex);
							}
						}}
					>
						{projection.clips.map((clip) => (
							<VideoFilmstripClip
								key={`${clip.projectBinClipId ? 'project-bin-' : ''}${clip.id}`}
								controller={controller}
								clip={clip}
								source={sourceLookup.get(clip.sourceId)}
								overscanStartFrame={projection.overscanStartFrame}
								overscanEndFrame={projection.overscanEndFrame}
								pixelsPerSecond={pixelsPerSecond}
								sampleRate={sampleRate}
								selected={selectedClipIdSet.size
									? selectedClipIdSet.has(clip.id)
									: String(selectedClipId) === String(clip.id)}
								dragging={Boolean(draggingClipIds?.has(clip.id))}
								invalidOverlap={overlapPresentation.invalidClipIds.has(clip.id)}
								hidden={track.hidden}
								blocked={blocked}
								copy={copy}
								onOpenMenu={onOpenClipMenu}
							/>
						))}
					</div>
					<AutomaticCrossfadeOverlays overlays={overlapPresentation.overlays} />
				</div>
			</div>
		</div>
	);
}

function VideoTrackControls({
	controller,
	track,
	panelWidth,
	selected,
	blocked,
	isFlatNavigation,
	copy,
	run,
	onMenu,
	onTabOut,
	onShiftTabOut,
	onNavigateVertical,
}) {
	const controlsRef = useRef(null);
	const [editingName, setEditingName] = useState(false);
	const controlTabIndex = isFlatNavigation ? 0 : -1;
	const handleKeyDown = (event) => {
		if (event.key === 'Tab') {
			const controls = [...controlsRef.current.querySelectorAll('button:not([disabled]), input:not([disabled])')];
			const currentIndex = controls.indexOf(document.activeElement);
			if (currentIndex < 0) return;
			event.preventDefault();
			if (event.shiftKey) {
				if (currentIndex > 0) focusFirst(controls[currentIndex - 1]);
				else onShiftTabOut?.();
			} else if (currentIndex < controls.length - 1) {
				focusFirst(controls[currentIndex + 1]);
			} else onTabOut?.();
		} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			onNavigateVertical?.(event.key === 'ArrowDown' ? 'down' : 'up');
		}
	};
	return (
		<div
			ref={controlsRef}
			className="audio-editor-video-track-controls track-control-panel"
			data-track-header
			data-selected={selected ? 'true' : 'false'}
			style={{ width: panelWidth }}
			onClick={() => !selected && run(() => controller.actions.timeline.selectTrack(track.id))}
			onKeyDownCapture={handleKeyDown}
		>
			<div className="audio-editor-video-track-controls__title">
				<span className="audio-editor-video-track-controls__icon" aria-hidden="true">
					<Icon name="play" size={14} />
				</span>
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
						title={track.name}
						onDoubleClick={() => !blocked && setEditingName(true)}
					>
						{track.name}
					</span>
				)}
				<GhostButton
					ariaLabel={copy.trackMenu || copy.tracksMenu}
					tabIndex={controlTabIndex}
					onClick={(event) => onMenu(event.currentTarget)}
				/>
			</div>
			<div className="audio-editor-video-track-controls__actions">
				<button
					type="button"
					className="audio-editor-video-track-control"
					data-track-action="visibility"
					aria-pressed={!track.hidden}
					disabled={blocked}
					tabIndex={controlTabIndex}
					onClick={(event) => {
						event.stopPropagation();
						run(() => controller.actions.track.update(track.id, { hidden: !track.hidden }));
					}}
				>
					{track.hidden ? (copy.videoVisible || 'Show video') : (copy.videoHidden || 'Hide video')}
				</button>
				<button
					type="button"
					className="audio-editor-video-track-control"
					data-track-action="collapse"
					aria-expanded={!track.collapsed}
					disabled={blocked}
					tabIndex={controlTabIndex}
					onClick={(event) => {
						event.stopPropagation();
						run(() => controller.actions.track.update(track.id, { collapsed: !track.collapsed }));
					}}
				>
					{track.collapsed ? copy.expandTrack : copy.collapseTrack}
				</button>
			</div>
		</div>
	);
}

function VideoFilmstripClip({
	controller,
	clip,
	source,
	overscanStartFrame,
	overscanEndFrame,
	pixelsPerSecond,
	sampleRate,
	selected,
	dragging,
	invalidOverlap,
	hidden,
	blocked,
	copy,
	onOpenMenu,
}) {
	const clipEndFrame = clip.timelineStartFrame + clip.durationFrames;
	const visibleStartFrame = Math.max(clip.timelineStartFrame, overscanStartFrame);
	const visibleEndFrame = Math.min(clipEndFrame, overscanEndFrame);
	const left = CLIP_CONTENT_OFFSET
		+ framesToSeconds(visibleStartFrame - overscanStartFrame, { sampleRate }) * pixelsPerSecond;
	const width = Math.max(2, framesToSeconds(visibleEndFrame - visibleStartFrame, { sampleRate }) * pixelsPerSecond);
	const clippedAtStart = visibleStartFrame !== clip.timelineStartFrame;
	const clippedAtEnd = visibleEndFrame !== clipEndFrame;
	const speedRatio = Number(clip.speedRatio) || 1;
	const visualData = useVideoClipVisualData(controller, clip);
	const thumbnailPoints = useMemo(() => {
		if (!source || visibleEndFrame <= visibleStartFrame) return [];
		try {
			return selectVideoThumbnailTimestamps(clip, source, {
				projectSampleRate: sampleRate,
				visibleStartFrame,
				visibleEndFrame,
				pixelsPerSecond,
				baseIntervalSeconds: 5,
				minimumSpacingPixels: 72,
			});
		} catch {
			return [];
		}
	}, [
		clip,
		pixelsPerSecond,
		sampleRate,
		source,
		visibleEndFrame,
		visibleStartFrame,
	]);
	const fallbackPosterUrl = videoPosterUrl(visualData, source);
	return (
		<div
			className="audio-editor-video-clip"
			data-clip-id={clip.id}
			data-clip-kind="video"
			data-dragging={dragging ? 'true' : 'false'}
			data-project-bin-preview={clip.projectBinClipId ? 'true' : undefined}
			data-invalid-overlap={invalidOverlap ? 'true' : undefined}
			role="group"
			tabIndex={-1}
			aria-label={`${copy.videoClip || 'Video clip'}: ${clip.title}`}
			style={{ left, width }}
			onContextMenu={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onOpenMenu(clip.id, event.clientX, event.clientY);
			}}
		>
			<div
				className={`clip-display audio-editor-video-clip__display${selected ? ' clip-display--selected' : ''}`}
				data-hidden={hidden ? 'true' : 'false'}
				data-unavailable={visualData?.available === false ? 'true' : 'false'}
			>
				{!clippedAtStart && <>
					<span
						className="clip-display__handle clip-display__handle--trim-left audio-editor-video-clip__trim-handle"
						aria-hidden="true"
					/>
					<span
						className="clip-display__handle clip-display__handle--stretch-left audio-editor-video-clip__stretch-handle"
						aria-hidden="true"
					/>
				</>}
				{!clippedAtEnd && <>
					<span
						className="clip-display__handle clip-display__handle--trim-right audio-editor-video-clip__trim-handle"
						aria-hidden="true"
					/>
					<span
						className="clip-display__handle clip-display__handle--stretch-right audio-editor-video-clip__stretch-handle"
						aria-hidden="true"
					/>
				</>}
				<div className="clip-header audio-editor-video-clip__header">
					<span className="audio-editor-video-clip__title" title={clip.title}>{clip.title}</span>
					{speedRatio !== 1 && (
						<span className="audio-editor-video-clip__speed" aria-label={`${speedRatio.toFixed(2)}×`}>
							{speedRatio.toFixed(2)}×
						</span>
					)}
				</div>
				<div className="audio-editor-video-clip__filmstrip" aria-hidden="true">
					{thumbnailPoints.length ? thumbnailPoints.map((point, index) => {
						const nextTimelineFrame = thumbnailPoints[index + 1]?.timelineFrame ?? visibleEndFrame;
						const cellLeft = framesToSeconds(point.timelineFrame - visibleStartFrame, { sampleRate }) * pixelsPerSecond;
						const cellWidth = Math.max(
							1,
							framesToSeconds(nextTimelineFrame - point.timelineFrame, { sampleRate }) * pixelsPerSecond,
						);
						const thumbnailUrl = videoThumbnailUrl(visualData, point, index) || fallbackPosterUrl;
						return (
							<span
								key={`${point.sourceFrame}-${index}`}
								className="audio-editor-video-clip__thumbnail"
								style={{ left: cellLeft, width: cellWidth }}
								title={`${point.sourceTimeSeconds.toFixed(1)} s`}
							>
								{thumbnailUrl && <img src={thumbnailUrl} alt="" draggable="false" />}
								{!thumbnailUrl && <span className="audio-editor-video-clip__thumbnail-time">
									{formatThumbnailTime(point.sourceTimeSeconds)}
								</span>}
							</span>
						);
					}) : (
						<span className="audio-editor-video-clip__thumbnail audio-editor-video-clip__thumbnail--fallback">
							{fallbackPosterUrl
								? <img src={fallbackPosterUrl} alt="" draggable="false" />
								: <span className="audio-editor-video-clip__thumbnail-time">{copy.videoClip || 'Video'}</span>}
						</span>
					)}
				</div>
				{blocked && <span className="audio-editor-video-clip__blocked" aria-hidden="true" />}
			</div>
		</div>
	);
}

function useVideoClipVisualData(controller, clip) {
	const request = useMemo(() => {
		const getter = controller.actions.video?.getClipVisualData
			|| controller.actions.timeline?.getClipVisualData;
		if (!getter) return null;
		try {
			return getter(clip.id);
		} catch {
			return null;
		}
	}, [
		clip.durationFrames,
		clip.id,
		clip.sourceDurationFrames,
		clip.sourceId,
		clip.sourceStartFrame,
		controller,
	]);
	const [asyncVisualData, setAsyncVisualData] = useState(null);
	const pending = Boolean(request && typeof request.then === 'function');
	useEffect(() => {
		let active = true;
		if (!pending) {
			setAsyncVisualData(null);
			return () => {
				active = false;
			};
		}
		setAsyncVisualData(null);
		Promise.resolve(request).then(
			(value) => {
				if (active) setAsyncVisualData(value || null);
			},
			() => {
				if (active) setAsyncVisualData(null);
			},
		);
		return () => {
			active = false;
		};
	}, [pending, request]);
	return pending ? asyncVisualData : request;
}

function videoPosterUrl(visualData, source) {
	return firstUsableUrl(
		visualData?.posterUrl,
		visualData?.poster?.url,
		visualData?.poster?.objectUrl,
		visualData?.thumbnailUrl,
		source?.posterUrl,
		source?.thumbnailUrl,
	);
}

function videoThumbnailUrl(visualData, point, index) {
	const direct = visualData?.thumbnailUrlAt?.(point.sourceTimeSeconds);
	if (typeof direct === 'string' && direct) return direct;
	const candidates = visualData?.thumbnails ?? visualData?.thumbnailUrls ?? visualData?.frames;
	if (candidates instanceof Map) {
		return firstUsableUrl(
			candidates.get(point.sourceTimeSeconds),
			candidates.get(point.sourceFrame),
			candidates.get(String(point.sourceTimeSeconds)),
			candidates.get(String(point.sourceFrame)),
		);
	}
	if (Array.isArray(candidates)) {
		if (typeof candidates[index] === 'string') return candidates[index];
		const matching = candidates.find((candidate) => {
			const timestamp = Number(candidate?.sourceTimeSeconds ?? candidate?.timestamp ?? candidate?.time);
			return Number.isFinite(timestamp) && Math.abs(timestamp - point.sourceTimeSeconds) < 0.05;
		});
		const indexed = candidates[point.gridIndex] || candidates[index];
		return firstUsableUrl(
			matching?.url,
			matching?.objectUrl,
			matching?.src,
			indexed?.url,
			indexed?.objectUrl,
			indexed?.src,
		);
	}
	if (candidates && typeof candidates === 'object') {
		const keyed = candidates[point.sourceTimeSeconds]
			?? candidates[point.sourceFrame]
			?? candidates[String(point.sourceTimeSeconds)]
			?? candidates[String(point.sourceFrame)];
		return firstUsableUrl(keyed?.url, keyed?.objectUrl, keyed?.src, keyed);
	}
	return null;
}

function firstUsableUrl(...values) {
	for (const value of values) {
		if (typeof value === 'string' && value) return value;
	}
	return null;
}

function formatThumbnailTime(seconds) {
	const value = Math.max(0, Number(seconds) || 0);
	const minutes = Math.floor(value / 60);
	const remaining = Math.floor(value % 60);
	return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function TrackRow({
	controller,
	project,
	track,
	visualHeight,
	trackClips,
	clipLookup,
	sourceLookup,
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
	selectedClipIdSet,
	timelineView,
	showRms,
	waveformRulerFormat,
	waveformZoom,
	clipStyle,
	recordingPreview,
	draggingClipIds,
	clipDragPreview,
	projectBinDragPreview,
	waveformCache,
	automationToolEnabled,
	blocked,
	showArmControls,
	displayAudioSupported,
	recordingInputs,
	copy,
	run,
	onMenu,
	onOpenEffects,
	onOpenClipMenu,
	onOpenRulerFlyout,
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
	const trackHeight = visualHeight;
	const displayMode = track.displayMode && track.displayMode !== 'waveform' ? track.displayMode : timelineView;
	const spectrogramScale = normalizeSpectrogramScale(track.spectrogram?.scale);
	const clips = useMemo(() => {
		const withRecordingPreview = recordingPreview?.durationFrames > 0 ? [...trackClips, {
			id: recordingPreviewId(track.id),
			timelineStartFrame: recordingPreview.startFrame,
			durationFrames: recordingPreview.durationFrames,
			sourceDurationFrames: recordingPreview.durationFrames,
			isRecordingPreview: true,
		}] : trackClips;
		const projected = [...withRecordingPreview];
		if (clipDragPreview) {
			const previews = clipDragPreview.previews || [clipDragPreview];
			const previewIds = new Set(previews.map((preview) => preview.clipId));
			projected.splice(0, projected.length, ...withRecordingPreview.filter((clip) => !previewIds.has(clip.id)));
			for (const preview of previews) {
				if (track.id !== preview.trackId) continue;
				const draggedClip = clipLookup.get(preview.clipId);
				if (draggedClip) projected.push({ ...draggedClip, ...preview });
			}
		}
		for (const preview of projectBinDragPreview?.previews || (projectBinDragPreview ? [projectBinDragPreview] : [])) {
			if (preview.trackId !== track.id || preview.clip?.kind !== track.type) continue;
			projected.push({
				...preview.clip,
				timelineStartFrame: preview.timelineStartFrame,
				groupId: null,
				projectBinClipId: preview.clip.id,
			});
		}
		return projected;
	}, [clipDragPreview, clipLookup, projectBinDragPreview, recordingPreview, track.id, trackClips]);
	const movingPreviewClipIds = useMemo(() => new Set(
		[
			...(clipDragPreview?.previews || (clipDragPreview ? [clipDragPreview] : [])),
			...(projectBinDragPreview?.previews || (projectBinDragPreview ? [projectBinDragPreview] : [])),
		]
			.filter((preview) => !Object.hasOwn(preview, 'durationFrames'))
			.map((preview) => String(preview.clipId)),
	), [clipDragPreview, projectBinDragPreview]);
	const projection = useMemo(() => projectClipsToViewport(clips, {
		viewportStartFrame,
		viewportDurationFrames,
		sampleRate,
	}), [clips, sampleRate, viewportDurationFrames, viewportStartFrame]);
	const windowLeft = framesToSeconds(projection.overscanStartFrame, { sampleRate }) * pixelsPerSecond;
	const windowFrames = Math.max(1, projection.overscanEndFrame - projection.overscanStartFrame);
	const windowWidth = Math.max(1, framesToSeconds(windowFrames, { sampleRate }) * pixelsPerSecond);
	const projectedClips = projection.clips.map((clip) => clip.isRecordingPreview
		? toDesignRecordingPreview(
			clip,
			recordingPreview,
			projection.overscanStartFrame,
			pixelsPerSecond,
			sampleRate,
			copy,
			displayMode === 'multiview',
		)
		: toDesignClip(
			controller,
			sourceLookup,
			clip,
			projection.overscanStartFrame,
			pixelsPerSecond,
			selectedClipIdSet.size ? selectedClipIdSet : selectedClipId,
			sampleRate,
			copy,
			showRms,
			displayMode === 'half-wave',
			resolveAudioEditorColor(clip.color, resolveAudioEditorColor(track.color)),
			waveformCache,
			movingPreviewClipIds.has(String(clip.id)),
			displayMode === 'waveform' || displayMode === 'half-wave',
			displayMode !== 'spectrogram',
			false,
			displayMode === 'spectrogram' || displayMode === 'multiview',
		)).map((clip) => {
			const preview = envelopePreviewRef.current.get(String(clip.id));
			return preview ? {
				...clip,
				envelopePoints: preview.designPoints,
				audacityWaveform: clip.audacityWaveform
					? { ...clip.audacityWaveform, envelope: preview.envelope }
					: undefined,
			} : clip;
		});
	const crossfadeOverlays = useMemo(() => createCrossfadeOverlays(
		projection.clips,
		projection.overscanStartFrame,
		pixelsPerSecond,
		sampleRate,
	), [pixelsPerSecond, projection.clips, projection.overscanStartFrame, sampleRate]);
	const measuredProjectionClip = rightmostVisibleClip(projection.clips);
	const measuredClip = measuredProjectionClip
		? projectedClips.find((clip) => String(clip.id) === String(measuredProjectionClip.id))
		: null;
	const measuredSource = measuredProjectionClip?.sourceId
		? sourceLookup.get(measuredProjectionClip.sourceId)
		: null;
	const rulerChannelCount = Math.max(1, Math.min(2,
		measuredClip?.audacityWaveform?.channels?.length
			|| measuredClip?.channelCount
			|| measuredSource?.channelCount
			|| 1,
	));
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
		let targetTrackIndex = trackIndex + direction;
		const targetType = clip?.kind || track.type;
		while (
			targetTrackIndex >= 0
			&& targetTrackIndex < project.tracks.length
			&& project.tracks[targetTrackIndex]?.type !== targetType
		) {
			targetTrackIndex += direction;
		}
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
		const source = clip ? sourceLookup.get(clip.sourceId) : null;
		const deltaFrames = secondsDeltaToFrames(deltaSeconds, sampleRate);
		if (!clip || !source || !deltaFrames) return;
		const sourceDurationFrames = clip.sourceDurationFrames || clip.durationFrames;
		const sourceFramesPerTimelineFrame = sourceDurationFrames / clip.durationFrames;
		if (edge === 'left') {
			const sourceExtension = clip.reversed
				? source.frameCount - clip.sourceStartFrame - sourceDurationFrames
				: clip.sourceStartFrame;
			const timelineExtension = Math.floor(sourceExtension / sourceFramesPerTimelineFrame);
			const change = Math.max(
				-Math.min(clip.timelineStartFrame, timelineExtension),
				Math.min(clip.durationFrames - 1, deltaFrames),
			);
			if (!change) return;
			run(() => controller.actions.clip.trim(clip.id, {
				timelineStartFrame: clip.timelineStartFrame + change,
				durationFrames: clip.durationFrames - change,
			}));
			return;
		}
		const sourceExtension = clip.reversed
			? clip.sourceStartFrame
			: source.frameCount - clip.sourceStartFrame - sourceDurationFrames;
		const maximumDuration = clip.durationFrames
			+ Math.floor(sourceExtension / sourceFramesPerTimelineFrame);
		const nextDuration = Math.max(1, Math.min(maximumDuration, clip.durationFrames - deltaFrames));
		if (nextDuration === clip.durationFrames) return;
		run(() => controller.actions.clip.trim(clip.id, {
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
			data-track-color={resolveAudioEditorColor(track.color)}
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
				displayAudioSupported={displayAudioSupported}
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
						color={resolveAudioEditorColor(track.color)}
						draggingClipIds={draggingClipIds || undefined}
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
					<AudacityWaveformCanvases
						rootRef={trackWindowRef}
						clips={projectedClips}
						displayMode={displayMode === 'spectrogram' && recordingPreview?.durationFrames > 0 ? 'waveform' : displayMode}
						pixelsPerSecond={pixelsPerSecond}
						timeSelection={selectedTrackId === track.id ? projectedSelection : null}
						showRms={showRms}
						halfWave={displayMode === 'half-wave'}
						spectrogramScale={spectrogramScale}
					/>
					<AutomaticCrossfadeOverlays overlays={crossfadeOverlays} />
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
							maximumFrame={Math.max(editorTimelineDurationFrames(project, sampleRate), activeSpectralSelection.endFrame)}
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
					data-ruler-format={waveformRulerFormat}
					data-ruler-zoom={waveformZoom}
					role="region"
					aria-label={`${track.name}: ${displayMode === 'spectrogram' ? copy.spectrogramView : displayMode === 'multiview' ? copy.multiview : copy.waveformView}`}
					tabIndex={tabIndexFor(3)}
					onContextMenu={(event) => onOpenRulerFlyout(displayMode, event)}
					onKeyDown={(event) => {
						if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
							onOpenRulerFlyout(displayMode, event);
						} else if (event.key === 'Tab') {
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
							{renderAmplitudeRulers(
								rulerChannelCount,
								trackHeight - Math.floor(trackHeight / 2),
								verticalRulerWidth,
								displayMode,
								waveformRulerFormat,
								waveformZoom,
							)}
						</>
					) : (
						renderAmplitudeRulers(
							rulerChannelCount,
							trackHeight,
							verticalRulerWidth,
							displayMode,
							waveformRulerFormat,
							waveformZoom,
						)
					)}
				</div>}
			</div>
		</div>
	);
}

function createVideoOverlapPresentation(
	clips,
	overscanStartFrame,
	overscanEndFrame,
	pixelsPerSecond,
	sampleRate,
) {
	const ordered = clips
		.filter((clip) => !clip.isRecordingPreview && Number(clip.durationFrames) > 0)
		.slice()
		.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || String(left.id).localeCompare(String(right.id)));
	const overlaps = [];
	const invalidClipIds = new Set();
	let invalid = false;
	try {
		validateVideoTrackComposition({
			id: 'video-drag-preview',
			type: 'video',
			clipIds: ordered.map((clip) => clip.id),
		}, new Map(ordered.map((clip) => [clip.id, clip])));
	} catch {
		invalid = true;
	}
	for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
		const left = ordered[leftIndex];
		const leftStart = left.timelineStartFrame;
		const leftEnd = leftStart + left.durationFrames;
		for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
			const right = ordered[rightIndex];
			const rightStart = right.timelineStartFrame;
			const rightEnd = rightStart + right.durationFrames;
			if (rightStart >= leftEnd) break;
			const startFrame = Math.max(leftStart, rightStart);
			const endFrame = Math.min(leftEnd, rightEnd);
			if (endFrame <= startFrame) continue;
			const thirdClipActive = ordered.some((candidate, candidateIndex) => {
				if (candidateIndex === leftIndex || candidateIndex === rightIndex) return false;
				const candidateStart = candidate.timelineStartFrame;
				const candidateEnd = candidateStart + candidate.durationFrames;
				return candidateStart < endFrame && candidateEnd > startFrame;
			});
			const valid = leftStart < rightStart && leftEnd < rightEnd && !thirdClipActive;
			if (!valid) {
				invalid = true;
				invalidClipIds.add(left.id);
				invalidClipIds.add(right.id);
			}
			const visibleStartFrame = Math.max(startFrame, overscanStartFrame);
			const visibleEndFrame = Math.min(endFrame, overscanEndFrame);
			if (visibleEndFrame <= visibleStartFrame) continue;
			overlaps.push({
				id: `${left.id}:${right.id}:${startFrame}:${endFrame}`,
				left: CLIP_CONTENT_OFFSET
					+ (visibleStartFrame - overscanStartFrame) / sampleRate * pixelsPerSecond,
				width: Math.max(2, (visibleEndFrame - visibleStartFrame) / sampleRate * pixelsPerSecond),
				valid,
				label: valid
					? `Automatic crossfade between ${left.title || left.id} and ${right.title || right.id}`
					: `Invalid video overlap between ${left.title || left.id} and ${right.title || right.id}`,
			});
		}
	}
	return {
		invalid,
		invalidClipIds,
		overlays: overlaps,
	};
}

function createCrossfadeOverlays(clips, overscanStartFrame, pixelsPerSecond, sampleRate) {
	const ordered = clips
		.filter((clip) => !clip.isRecordingPreview && clip.isVisible)
		.slice()
		.sort((left, right) => left.timelineStartFrame - right.timelineStartFrame || String(left.id).localeCompare(String(right.id)));
	const overlays = [];
	for (let leftIndex = 0; leftIndex < ordered.length; leftIndex += 1) {
		const left = ordered[leftIndex];
		const leftEnd = left.timelineStartFrame + left.durationFrames;
		for (let rightIndex = leftIndex + 1; rightIndex < ordered.length; rightIndex += 1) {
			const right = ordered[rightIndex];
			if (right.timelineStartFrame >= leftEnd) break;
			const startFrame = Math.max(left.timelineStartFrame, right.timelineStartFrame);
			const endFrame = Math.min(leftEnd, right.timelineStartFrame + right.durationFrames);
			if (endFrame <= startFrame) continue;
			overlays.push({
				id: `${left.id}:${right.id}:${startFrame}:${endFrame}`,
				left: (startFrame - overscanStartFrame) / sampleRate * pixelsPerSecond,
				width: Math.max(2, (endFrame - startFrame) / sampleRate * pixelsPerSecond),
				label: `Automatic crossfade between ${left.name || left.id} and ${right.name || right.id}`,
			});
		}
	}
	return overlays;
}

function AutomaticCrossfadeOverlays({ overlays }) {
	return overlays.map((overlay) => (
		<div
			key={overlay.id}
			className={`audio-editor-automatic-crossfade${overlay.valid === false ? ' audio-editor-automatic-crossfade--invalid' : ''}`}
			data-automatic-crossfade={overlay.valid === false ? undefined : 'true'}
			data-invalid-video-overlap={overlay.valid === false ? 'true' : undefined}
			style={{ left: overlay.left, width: overlay.width }}
			role="img"
			aria-label={overlay.label}
			title={overlay.label}
		/>
	));
}

function AudacityWaveformCanvases({
	rootRef,
	clips,
	displayMode,
	pixelsPerSecond,
	timeSelection,
	showRms,
	halfWave,
	spectrogramScale,
}) {
	const [spectrogramRevision, setSpectrogramRevision] = useState(pffftSpectrogramRevision);
	useEffect(() => subscribePffftSpectrogram(setSpectrogramRevision), []);
	useEffect(() => {
		const root = rootRef.current;
		if (!root) return undefined;
		let animationFrame = 0;
		const draw = () => {
			animationFrame = 0;
			const clipById = new Map(clips.map((clip) => [String(clip.id), clip]));
			const drawKey = [
				displayMode,
				pixelsPerSecond,
				showRms,
				halfWave,
				spectrogramScale,
				spectrogramRevision,
				timeSelection?.startTime ?? '',
				timeSelection?.endTime ?? '',
			].join('|');
			for (const clipElement of root.querySelectorAll('[data-clip-id]')) {
				const clip = clipById.get(String(clipElement.dataset.clipId));
				if (!clip?.audacityWaveform) continue;
				const canvas = clipElement.querySelector('canvas.clip-body__waveform');
				if (!canvas) continue;
				const canvasDrawKey = [
					drawKey,
					canvas.clientWidth,
					canvas.clientHeight,
					window.devicePixelRatio || 1,
				].join('|');
				if (canvas.__kwWaveformPlan === clip.audacityWaveform && canvas.__kwWaveformDrawKey === canvasDrawKey) continue;
				drawAudacityClipCanvas(canvas, clip, {
					displayMode,
					pixelsPerSecond,
					timeSelection,
					showRms,
					halfWave,
					spectrogramScale,
				});
				canvas.__kwWaveformPlan = clip.audacityWaveform;
				canvas.__kwWaveformDrawKey = canvasDrawKey;
			}
		};
		const scheduleDraw = () => {
			if (animationFrame) window.cancelAnimationFrame(animationFrame);
			animationFrame = window.requestAnimationFrame(draw);
		};

		draw();
		scheduleDraw();
		const observer = new MutationObserver(scheduleDraw);
		observer.observe(root, {
			attributes: true,
			attributeFilter: ['width', 'height'],
			childList: true,
			subtree: true,
		});
		return () => {
			observer.disconnect();
			if (animationFrame) window.cancelAnimationFrame(animationFrame);
		};
	}, [clips, displayMode, halfWave, pixelsPerSecond, rootRef, showRms, spectrogramRevision, spectrogramScale, timeSelection]);
	return null;
}

function drawAudacityClipCanvas(canvas, clip, options) {
	const rendering = clip.audacityWaveform;
	const context = canvas.getContext('2d', { alpha: true });
	if (!context || !rendering.channels.length) return;
	const width = Number.parseFloat(canvas.style.width) || canvas.clientWidth || rendering.pixelWidth;
	const height = Number.parseFloat(canvas.style.height) || canvas.clientHeight;
	if (!(width > 0) || !(height > 0)) return;
	const devicePixelRatio = window.devicePixelRatio || 1;
	const deviceWidth = Math.max(1, Math.round(width * devicePixelRatio));
	const deviceHeight = Math.max(1, Math.round(height * devicePixelRatio));
	if (canvas.width !== deviceWidth) canvas.width = deviceWidth;
	if (canvas.height !== deviceHeight) canvas.height = deviceHeight;
	const pixelRatioX = canvas.width / width;
	const pixelRatioY = canvas.height / height;
	if (!(pixelRatioX > 0) || !(pixelRatioY > 0)) return;

	const body = canvas.closest('.clip-body');
	const color = body?.dataset.color || 'blue';
	const style = getComputedStyle(canvas);
	const baseWaveform = cssColor(style, `--clip-${color}-waveform`, '#172533');
	const selectedWaveform = cssColor(style, `--clip-${color}-time-selection-waveform`, baseWaveform);
	const baseRms = cssColor(style, `--clip-${color}-waveform-rms`, baseWaveform);
	const selectedRms = cssColor(style, `--clip-${color}-time-selection-waveform-rms`, baseRms);
	const divider = cssColor(style, `--clip-${color}-divider`, 'rgba(0, 0, 0, 0.35)');
	const splitSeparator = cssColor(style, '--split-separator', divider);
	const selection = clipSelectionPixels(clip, options.timeSelection, options.pixelsPerSecond, width);
	const splitY = options.displayMode === 'spectrogram'
		? height
		: options.displayMode === 'multiview' ? height / 2 : 0;
	const waveformHeight = height - splitY;
	const channelCount = Math.min(2, rendering.channels.length);
	const channelHeight = waveformHeight / channelCount;
	const evaluateEnvelope = rendering.envelope?.length
		? createEnvelopeValueEvaluator(rendering.envelope, rendering.durationFrames)
		: null;
	const envelopeGain = evaluateEnvelope
		? (x) => evaluateEnvelope(rendering.startFrame + x / width * rendering.frameCount)
		: undefined;
	const waveformColor = (x) => x >= selection.start && x < selection.end
		? selectedWaveform
		: baseWaveform;
	const rmsColor = (x) => x >= selection.start && x < selection.end ? selectedRms : baseRms;
	if (body) {
		if (options.halfWave) {
			body.dataset.halfWave = 'true';
			body.dataset.waveformChannels = String(channelCount);
		} else {
			delete body.dataset.halfWave;
			delete body.dataset.waveformChannels;
		}
	}

	context.save();
	context.setTransform(pixelRatioX, 0, 0, pixelRatioY, 0, 0);
	context.globalAlpha = 1;
	context.globalCompositeOperation = 'source-over';
	context.clearRect(0, 0, width, height);
	if (splitY > 0) {
		drawAudacityClipSpectrogram(context, clip.spectrogramWaveform, {
			width,
			height: splitY,
			backgroundColor: cssColor(style, '--spectrogram-background', '#010101'),
			dividerColor: divider,
			scale: options.spectrogramScale,
		});
	} else delete canvas.dataset.spectrogramRenderer;
	if (waveformHeight > 0 && selection.end > selection.start) {
		context.fillStyle = cssColor(style, `--clip-${color}-time-selection-body`, 'rgba(255, 255, 255, 0.15)');
		context.fillRect(selection.start, splitY, selection.end - selection.start, waveformHeight);
	}
	for (let channel = 0; waveformHeight > 0 && channel < channelCount; channel += 1) {
		drawAudacityWaveformChannel(context, rendering, {
			channel,
			width,
			centerY: splitY + channelHeight * (channel + 0.5),
			maxAmplitude: Math.max(0, channelHeight / 2 - 2),
			halfWave: options.halfWave,
			envelopeGain,
			sampleColor: waveformColor,
			rmsColor,
			centerLineColor: divider,
			showRms: options.showRms,
		});
	}
	context.strokeStyle = divider;
	context.lineWidth = 1;
	if (waveformHeight > 0 && channelCount > 1) drawHorizontalCanvasLine(context, splitY + channelHeight, width);
	if (splitY > 0 && waveformHeight > 0) {
		context.strokeStyle = splitSeparator;
		drawHorizontalCanvasLine(context, splitY, width);
	}
	context.restore();
	canvas.dataset.waveformRenderer = 'audacity';
	canvas.dataset.waveformMode = rendering.mode;
	canvas.dataset.waveformOwner = 'audacity';
}

function drawAudacityClipSpectrogram(context, channels, options) {
	context.fillStyle = options.backgroundColor;
	context.fillRect(0, 0, options.width, options.height);
	if (!channels?.length || !channels[0]?.length) return;
	const spectrogramOptions = {
		frequencyBands: 16,
		fftWindowSize: 64,
		intensityMultiplier: 1.5,
		pixelSkip: 4,
		scale: options.scale,
	};
	const channelCount = Math.min(2, channels.length);
	const channelHeight = options.height / channelCount;
	let pffftRendered = true;
	for (let channel = 0; channel < channelCount; channel += 1) {
		pffftRendered = renderPffftSpectrogram(
			context,
			channels[channel],
			0,
			channel * channelHeight,
			options.width,
			channelHeight,
			spectrogramOptions,
		) && pffftRendered;
	}
	context.canvas.dataset.spectrogramRenderer = pffftRendered ? 'pffft-wasm' : 'loading-pffft';
	if (channelCount > 1) {
		context.strokeStyle = options.dividerColor;
		context.lineWidth = 1;
		drawHorizontalCanvasLine(context, channelHeight, options.width);
	}
}

function clipSelectionPixels(clip, selection, pixelsPerSecond, width) {
	if (!selection) return { start: -1, end: -1 };
	const overlapStart = Math.max(clip.start, selection.startTime);
	const overlapEnd = Math.min(clip.start + clip.duration, selection.endTime);
	if (overlapStart >= overlapEnd) return { start: -1, end: -1 };
	return {
		start: Math.max(0, Math.min(width, (overlapStart - clip.start) * pixelsPerSecond)),
		end: Math.max(0, Math.min(width, (overlapEnd - clip.start) * pixelsPerSecond)),
	};
}

function cssColor(style, property, fallback) {
	return style.getPropertyValue(property).trim() || fallback;
}

function drawHorizontalCanvasLine(context, y, width) {
	context.beginPath();
	context.moveTo(0, y);
	context.lineTo(width, y);
	context.stroke();
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
	visualHeight,
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
	const trackHeight = visualHeight;
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
					<Icon name="label" size={16} aria-hidden="true" />
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
					<GhostButton
						ariaLabel={copy.trackMenu || copy.tracksMenu}
						tabIndex={-1}
						onClick={(event) => onMenu(event.currentTarget)}
					/>
				</div>
				<div className="audio-editor-label-track-actions">
					<Button variant="secondary" size="small" aria-label={copy.addLabel} disabled={blocked} onClick={() => addLabel()}>
						{copy.addLabel}
					</Button>
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

	const finishDrag = useCallback(() => {
		const pending = pendingRef.current;
		if (!pending) return;
		pendingRef.current = null;
		setPreview(null);
		run(() => controller.actions.labels.update(trackId, label.id, pending));
	}, [controller, label.id, run, trackId]);

	useEffect(() => {
		document.addEventListener('mouseup', finishDrag);
		document.addEventListener('pointerup', finishDrag);
		return () => {
			document.removeEventListener('mouseup', finishDrag);
			document.removeEventListener('pointerup', finishDrag);
		};
	}, [finishDrag]);

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
			onMouseUp={finishDrag}
			onPointerUp={finishDrag}
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
	displayAudioSupported,
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
	const controlsRef = useRef(null);
	const [editingName, setEditingName] = useState(false);
	const meter = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.meters?.tracks?.[track.id]);
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
						displayAudioSupported={displayAudioSupported}
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

function isRulerLoopBand(event, lane) {
	const ruler = lane.querySelector('canvas.timeline-ruler');
	const rect = ruler?.getBoundingClientRect() || lane.getBoundingClientRect();
	return event.clientY - rect.top <= rect.height / 2;
}

function recordingPreviewId(trackId) {
	return `recording-preview-${trackId}`;
}

function toDesignRecordingPreview(
	clip,
	preview,
	overscanStartFrame,
	pixelsPerSecond,
	sampleRate,
	copy,
	provideAudacitySpectrogram = false,
) {
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
	output.audacityWaveform = prepareRecordingPreviewWaveform(
		waveformChannels,
		clip,
		output.duration * pixelsPerSecond,
	);
	output.waveform = EMPTY_DESIGN_SYSTEM_WAVEFORM;
	if (provideAudacitySpectrogram) output.spectrogramWaveform = waveformChannels;
	return output;
}

function recordingPreviewWaveformWindow(channel, clip) {
	if (!channel?.length || !clip.durationFrames) return [];
	const pairCount = Math.max(1, Math.floor(channel.length / 2));
	const startPair = Math.max(0, Math.min(pairCount - 1, Math.floor(clip.waveformStartFrame / clip.durationFrames * pairCount)));
	const endPair = Math.max(startPair + 1, Math.min(pairCount, Math.ceil(clip.waveformEndFrame / clip.durationFrames * pairCount)));
	return [...channel.slice(startPair * 2, endPair * 2)];
}

function prepareRecordingPreviewWaveform(channels, clip, pixelWidth) {
	const columnCount = Math.max(1, Math.ceil(pixelWidth));
	return {
		mode: 'summary',
		pixelWidth,
		pixelsPerSample: 0,
		startFrame: clip.waveformStartFrame,
		endFrame: clip.waveformEndFrame,
		frameCount: clip.waveformEndFrame - clip.waveformStartFrame,
		durationFrames: clip.durationFrames,
		envelope: [],
		channels: channels.map((channel) => {
			const pairCount = Math.max(1, Math.floor(channel.length / 2));
			const minimum = new Float32Array(columnCount);
			const maximum = new Float32Array(columnCount);
			for (let column = 0; column < columnCount; column += 1) {
				let pairStart;
				let pairEnd;
				if (pairCount >= columnCount) {
					pairStart = Math.round(column * pairCount / columnCount);
					pairEnd = Math.max(pairStart + 1, Math.round((column + 1) * pairCount / columnCount));
				} else {
					pairStart = Math.floor(column * pairCount / columnCount);
					pairEnd = pairStart + 1;
				}
				pairEnd = Math.min(pairCount, pairEnd);
				let bucketMinimum = Number.POSITIVE_INFINITY;
				let bucketMaximum = Number.NEGATIVE_INFINITY;
				for (let pair = pairStart; pair < pairEnd; pair += 1) {
					bucketMinimum = Math.min(bucketMinimum, Number(channel[pair * 2]) || 0);
					bucketMaximum = Math.max(bucketMaximum, Number(channel[pair * 2 + 1]) || 0);
				}
				if (column > 0 && minimum[column - 1] > bucketMaximum) bucketMaximum = minimum[column - 1];
				if (column > 0 && maximum[column - 1] < bucketMinimum) bucketMinimum = maximum[column - 1];
				minimum[column] = bucketMinimum;
				maximum[column] = bucketMaximum;
			}
			return { minimum, maximum, rms: null };
		}),
	};
}

function toDesignClip(
	controller,
	sourceLookup,
	clip,
	overscanStartFrame,
	pixelsPerSecond,
	selectedClipIds,
	sampleRate,
	copy,
	showRms = false,
	halfWave = false,
	color = AUDIO_EDITOR_TRACK_COLORS[0],
	waveformCache = null,
	freezeWaveform = false,
	reuseSummaryForCompatibility = false,
	allowPeakPyramid = true,
	provideDesignSystemSpectrogram = true,
	provideAudacitySpectrogram = false,
) {
	const visual = controller.getClipVisualData(clip.id)
		|| controller.getProjectBinClipVisualData?.(clip.projectBinClipId || clip.id);
	const source = visual?.source || sourceLookup.get(clip.sourceId);
	const sourceRate = Number(source?.sampleRate) > 0 ? Number(source.sampleRate) : sampleRate;
	const sourceDurationFrames = clip.sourceDurationFrames || clip.durationFrames;
	const selected = selectedClipIds instanceof Set
		? selectedClipIds.has(clip.id)
		: selectedClipIds === clip.id;
	const output = {
		id: clip.id,
		name: source?.name || clip.title || copy.clip,
		start: framesToSeconds(Math.max(0, Math.max(clip.timelineStartFrame, overscanStartFrame) - overscanStartFrame), { sampleRate }),
		duration: Math.max(
			framesToSeconds(clip.waveformEndFrame - clip.waveformStartFrame, { sampleRate }),
			MINIMUM_VISIBLE_CLIP_PIXELS / pixelsPerSecond,
		),
		selected,
		color,
		trimStart: framesToSeconds(clip.waveformStartFrame, { sampleRate }),
		fullDuration: sourceDurationFrames / sourceRate,
		// Compare durations, rather than frame counts. A source recorded at
		// 44.1 kHz and a 48 kHz project can have different frame counts while
		// still being exactly the same length and requiring no stretch.
		stretchFactor: (clip.durationFrames / sampleRate) / (sourceDurationFrames / sourceRate),
		envelopePoints: envelopeFramesToDesignPoints(clip.envelope, sampleRate, {
			startFrame: clip.waveformStartFrame,
			endFrame: clip.waveformEndFrame,
		}),
	};
	const waveformSource = visual?.buffer || (allowPeakPyramid ? visual?.peaks : null);
	if (!waveformSource || !clip.isVisible) return output;
	try {
		const pixelWidth = output.duration * pixelsPerSecond;
		const contentSignature = [
			clip.sourceId,
			clip.durationFrames,
			clip.sourceStartFrame,
			sourceDurationFrames,
			clip.gain,
			clip.fadeInFrames,
			clip.fadeOutFrames,
			clip.reversed,
			showRms,
			halfWave,
			pixelsPerSecond,
			reuseSummaryForCompatibility,
			provideDesignSystemSpectrogram,
			provideAudacitySpectrogram,
		].join('|');
		const cacheSignature = [
			contentSignature,
			clip.waveformStartFrame,
			clip.waveformEndFrame,
			pixelWidth,
		].join('|');
		const cached = waveformCache?.get(String(clip.id));
		if (
			cached?.source === waveformSource
			&& cached.envelope === clip.envelope
			&& (cached.signature === cacheSignature
				|| (freezeWaveform && cached.contentSignature === contentSignature))
		) {
			Object.assign(output, cached.data);
			return output;
		}
		const maximumSamples = Math.max(32, Math.min(4096, Math.ceil(pixelWidth) * 2));
		const waveform = visual.buffer
			? prepareBoundedWaveformWindow(Array.from(
				{ length: visual.buffer.numberOfChannels },
				(_, channel) => visual.buffer.getChannelData(channel),
			), clip, {
				startFrame: clip.waveformStartFrame,
				endFrame: clip.waveformEndFrame,
				maxSamples: maximumSamples,
				pixelWidth,
				reuseSummaryForCompatibility,
			})
			: preparePeakPyramidWaveformWindow(visual.peaks, clip, {
				startFrame: clip.waveformStartFrame,
				endFrame: clip.waveformEndFrame,
				maxSamples: maximumSamples,
				pixelWidth,
				channelCount: Math.max(1, Math.min(2, Number(source?.channelCount) || 1)),
				sourceFrameCount: source?.frameCount,
			});
		const waveformData = {
			audacityWaveform: {
				...waveform.rendering,
				durationFrames: clip.durationFrames,
				envelope: clip.envelope || [],
			},
		};
		if (!provideDesignSystemSpectrogram && !provideAudacitySpectrogram) {
			// TrackNew requires waveformData to create its canvas, but an empty
			// mono array makes its legacy drawing effect return before touching
			// the context. The Audacity renderer is the sole canvas owner.
			waveformData.waveform = EMPTY_DESIGN_SYSTEM_WAVEFORM;
		} else {
			const visualChannels = halfWave
				? waveform.channels.map((channel) => channel.map((sample) => Math.max(0, sample)))
				: waveform.channels;
			if (provideAudacitySpectrogram) {
				waveformData.waveform = EMPTY_DESIGN_SYSTEM_WAVEFORM;
				waveformData.spectrogramWaveform = visualChannels.map((channel) => [...channel]);
			} else if (visualChannels.length > 1) {
				waveformData.waveformLeft = [...visualChannels[0]];
				waveformData.waveformRight = [...visualChannels[1]];
				if (showRms && visual.buffer) {
					waveformData.waveformLeftRms = rmsEnvelope(visualChannels[0]);
					waveformData.waveformRightRms = rmsEnvelope(visualChannels[1]);
				}
			} else {
				waveformData.waveform = [...visualChannels[0]];
				if (showRms && visual.buffer) waveformData.waveformRms = rmsEnvelope(visualChannels[0]);
			}
		}
		waveformCache?.set(String(clip.id), {
			source: waveformSource,
			envelope: clip.envelope,
			contentSignature,
			signature: cacheSignature,
			data: waveformData,
		});
		Object.assign(output, waveformData);
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

function normalizeWaveformRulerFormat(value) {
	return value === 'linear-db' ? value : DEFAULT_WAVEFORM_RULER_STATE.format;
}

function normalizeWaveformRulerState(value) {
	return {
		...DEFAULT_WAVEFORM_RULER_STATE,
		...value,
		format: normalizeWaveformRulerFormat(value?.format),
	};
}

function renderAmplitudeRulers(
	channelCount,
	height,
	width,
	displayMode,
	rulerFormat = DEFAULT_WAVEFORM_RULER_STATE.format,
	zoom = DEFAULT_WAVEFORM_RULER_STATE.zoom,
) {
	const normalizedChannelCount = Math.max(1, Math.min(2, Number(channelCount) || 1));
	const channelHeight = Math.floor(height / normalizedChannelCount);
	const halfWave = displayMode === 'half-wave';
	const normalizedZoom = Math.max(0, Math.min(MAXIMUM_WAVEFORM_VERTICAL_ZOOM, Number(zoom) || 0));
	const baseSpan = halfWave ? 1 : 2;
	const center = halfWave ? 0.5 : 0;
	const span = baseSpan / 2 ** normalizedZoom;
	const minimum = center - span / 2;
	const maximum = center + span / 2;
	return Array.from({ length: normalizedChannelCount }, (_, channel) => {
		const rulerHeight = channel === normalizedChannelCount - 1
			? height - channelHeight * channel
			: channelHeight;
		const ruler = (Ruler, props) => halfWave ? (
			<div className="audio-editor-half-wave-ruler" style={{ height: rulerHeight, overflow: 'hidden' }}>
				<Ruler {...props} height={rulerHeight / 2} />
			</div>
		) : <Ruler {...props} height={rulerHeight} />;
		if (rulerFormat !== 'linear-amp') {
			return React.cloneElement(ruler(DbRuler, {
				scale: rulerFormat === 'linear-db' ? 'linear' : 'logarithmic',
				width,
			}), { key: channel });
		}
		return React.cloneElement(ruler(VerticalRuler, {
			min: minimum,
			max: maximum,
			majorDivisions: halfWave ? 2 : 3,
			minorDivisions: 1,
			width,
		}), { key: channel });
	});
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

function compatibleMediaTrack(project, requestedTrackId, clipKind) {
	const requested = project?.tracks.find((track) => track.id === requestedTrackId);
	if (!requested || !Array.isArray(requested.clipIds)) return null;
	if (!clipKind || requested.type === clipKind) return requested;
	if (!requested.laneGroupId) return null;
	return project.tracks.find((track) => (
		track.type === clipKind && track.laneGroupId === requested.laneGroupId
	)) || null;
}

function mediaTrackBlockBounds(tracks, trackId) {
	const index = tracks.findIndex((track) => track.id === trackId);
	if (index < 0) return null;
	const laneGroupId = tracks[index].laneGroupId;
	if (!laneGroupId) return { start: index, end: index };
	const indexes = tracks
		.map((track, trackIndex) => track.laneGroupId === laneGroupId ? trackIndex : -1)
		.filter((trackIndex) => trackIndex >= 0);
	return {
		start: Math.min(...indexes),
		end: Math.max(...indexes),
	};
}

function moveMediaTrackBlock(controller, tracks, trackId, direction) {
	const bounds = mediaTrackBlockBounds(tracks, trackId);
	if (!bounds) return null;
	const destination = direction === 'top'
		? 0
		: direction === 'bottom'
			? tracks.length - 1
			: direction === 'up'
				? Math.max(0, bounds.start - 1)
				: direction === 'down'
					? Math.min(tracks.length - 1, bounds.end + 1)
					: bounds.start;
	return controller.actions.track.reorder(trackId, destination);
}

function trackVisualHeight(track, showArmControls = false, heightOverride = undefined) {
	const expandedHeight = Math.max(
		MINIMUM_TRACK_HEIGHT,
		Number(heightOverride ?? track?.height) || TRACK_HEIGHT,
	);
	const baseHeight = track?.collapsed ? COLLAPSED_TRACK_HEIGHT : expandedHeight;
	if (!showArmControls || track?.type !== 'audio') return baseHeight;
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
