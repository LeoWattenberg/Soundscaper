import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import readmeMarkdown from '../../../../README.md?raw';
import {
	Button,
	ContextMenuItem,
	DialogHeader,
	DialogSideNav,
	Dropdown,
	Flyout,
	Icon,
	Knob,
	LabeledCheckbox,
	LabeledRadio,
	MixerPanel,
	NumberStepper,
	PreferencePanel,
	PreferenceThumbnail,
	SelectionToolbar,
	Separator,
	TimeCode,
	TextInput,
	ToggleToolButton,
	Toolbar,
	ToolbarButtonGroup,
	ToolbarDivider,
	TransportButton,
	ToolButton,
} from '@dilsonspickles/components';
import '@dilsonspickles/components/style.css';

import { normalizeBcp47Locale } from '../../../i18n/locale.js';
import { ROUTE_LOCALES } from '../../../i18n/locales.js';
import { createAudioEditorController } from '../../../lib/tools/audio-editor/app.js';
import { createAudioEditorFileService } from '../../../lib/tools/audio-editor/file-service.js';
import {
	applyAudacityParityToMenus,
	AUDACITY_ACTION_SOURCE,
	audacityActionReason,
	collectAudacityShortcutCommands,
	resolveAudacityActionHandler,
	resolveAudacityActionId,
} from '../../../lib/tools/audio-editor/audacity-action-parity.js';
import { createAudacityActionRuntime } from '../../../lib/tools/audio-editor/audacity-action-runtime.js';
import { iconNameToChar } from '../../../lib/tools/audio-editor/audacity-iconcodes.js';
import { framesToSeconds, secondsToFrames } from '../../../lib/tools/audio-editor/design-system-adapters.js';
import {
	findAudioEditorShortcutConflicts,
	normalizeAudioEditorShortcut,
} from '../../../lib/tools/audio-editor/preferences.js';
import {
	AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE,
	clearActiveProjectBinDragPayload,
	createProjectBinDragPayload,
} from '../../../lib/tools/audio-editor/project-bin-dnd.js';
import {
	ebuMeterBounds,
	ebuMeterPercent,
	ebuMeterTicks,
	playbackMeterAmplitudeToDb,
	playbackMeterFullSteps,
	playbackMeterGainFromPosition,
	playbackMeterPercent,
} from '../../../lib/tools/audio-editor/playback-meter.js';
import { projectDurationFrames } from '../../../lib/tools/audio-editor/project.js';
import { resolveActiveVideoLayers } from '../../../lib/tools/audio-editor/video-timeline.js';
import {
	getNyquistPlugin,
	listNyquistPlugins,
	loadNyquistPluginSource,
} from '../../../lib/tools/audio-editor/nyquist/plugin-registry.js';
import AudioEditorMenuBar from './AudioEditorMenuBar.jsx';
import AudioEditorTimeline from './AudioEditorTimeline.jsx';
import {
	DesignSystemProviders,
	useAudioEditorSnapshot,
	useAudioEditorTelemetrySelector,
	useAudioEditorThemeVariables,
} from './DesignSystemRuntime.jsx';
import AudioEditorButtonTooltips from './AudioEditorButtonTooltips.jsx';
import AudioEditorResizableSurface from './AudioEditorResizableSurface.jsx';
import AudioEditorSplitButton from './AudioEditorSplitButton.jsx';
import RecordingInputSelectors from './RecordingInputSelectors.jsx';
import './audio-editor-design-system.css';

const loadAudioEditorInspector = () => import('./AudioEditorInspector.jsx');
const AnalysisPanel = React.lazy(() => loadAudioEditorInspector().then((module) => ({ default: module.AnalysisPanel })));
const AudioEditorEffectsOverlay = React.lazy(() => loadAudioEditorInspector().then((module) => ({ default: module.AudioEditorEffectsOverlay })));
const AudioEditorMacroManagerDialog = React.lazy(() => loadAudioEditorInspector().then((module) => ({ default: module.AudioEditorMacroManagerDialog })));
const ClipPropertiesDialog = React.lazy(() => loadAudioEditorInspector().then((module) => ({ default: module.ClipPropertiesDialog })));
const ExportDialog = React.lazy(() => loadAudioEditorInspector().then((module) => ({ default: module.ExportDialog })));
const SelectionEffectsDialog = React.lazy(() => loadAudioEditorInspector().then((module) => ({ default: module.SelectionEffectsDialog })));

const PLAYBACK_METER_SETTINGS_STORAGE_KEY = 'soundscaper-playback-meter-settings-v2';
const RECORDING_METER_SETTINGS_STORAGE_KEY = 'soundscaper-recording-meter-settings-v2';
const LEGACY_PLAYBACK_METER_SETTINGS_STORAGE_KEY = 'soundscaper-playback-meter-settings-v1';
const LEGACY_RECORDING_METER_SETTINGS_STORAGE_KEY = 'soundscaper-recording-meter-settings-v1';
const METER_POSITIONS = Object.freeze(['flyout', 'top', 'side']);
const METER_STYLES = Object.freeze(['default', 'rms', 'gradient']);
const METER_TYPES = Object.freeze(['db-log', 'db-linear', 'amplitude', 'ebu-r128']);
const METER_DB_RANGES = Object.freeze([36, 48, 60, 72, 84, 96, 120, 144]);
const EBU_METER_SCALES = Object.freeze(['plus9', 'plus18']);
const EBU_METER_UNITS = Object.freeze(['absolute', 'relative']);
const EBU_METER_LIVE_VALUES = Object.freeze(['momentary', 'short-term']);
const AUDIO_EDITOR_AUDIO_FILE_ACCEPT = 'audio/*,video/mp4,video/webm,.aac,.aif,.aiff,.aup3,.flac,.m4a,.m4v,.mp2,.mp3,.mp4,.oga,.ogg,.opus,.wav,.webm,.wv';
const ANALYSIS_MODE_PANEL_IDS = Object.freeze({
	levels: 'analysis',
	spectrum: 'spectrum',
	clipping: 'clipping',
	contrast: 'contrast',
});
const DEFAULT_PLAYBACK_METER_SETTINGS = Object.freeze({
	position: 'side',
	style: 'default',
	type: 'db-log',
	dbRange: 60,
	ebuScale: 'plus9',
	ebuUnit: 'absolute',
	ebuLiveValue: 'momentary',
});
const DEFAULT_RECORDING_METER_SETTINGS = Object.freeze({
	position: 'side',
	style: 'default',
	type: 'db-log',
	dbRange: 60,
	ebuScale: 'plus9',
	ebuUnit: 'absolute',
	ebuLiveValue: 'momentary',
});

export default function AudioEditorApp(props) {
	return (
		<AudioEditorErrorBoundary copy={props.copy}>
			<DesignSystemProviders copy={props.copy}>
				<AudioEditorWorkspace {...props} />
			</DesignSystemProviders>
		</AudioEditorErrorBoundary>
	);
}

class AudioEditorErrorBoundary extends React.Component {
	constructor(props) {
		super(props);
		this.state = { error: null };
	}

	static getDerivedStateFromError(error) {
		return { error };
	}

	render() {
		if (!this.state.error) return this.props.children;
		const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
		return (
			<div id="kw-audio-editor-design-system" className="kw-audio-editor-error" role="alert" data-audio-editor-bound="false">
				<strong>{this.props.copy.title}</strong>
				<p>{this.props.copy.genericError.replace('{message}', message)}</p>
			</div>
		);
	}
}

function LazyInspectorFallback({ copy }) {
	return <div className="audio-editor-timeline-loading" role="status" aria-live="polite">{copy.loading}</div>;
}

function AudioEditorWorkspace({ locale, copy }) {
	const editorThemeVariables = useAudioEditorThemeVariables();
	const fileService = useMemo(() => createAudioEditorFileService(), []);
	const controller = useMemo(() => createAudioEditorController(null, {
		headless: true,
		locale,
		copy,
		fileService,
	}), [copy, fileService, locale]);
	const parityRuntime = useMemo(() => createAudacityActionRuntime(controller), [controller]);
	const [parityUi, setParityUi] = useState(() => parityRuntime.uiController.getSnapshot());
	const snapshot = useAudioEditorSnapshot(controller);
	const [activeSurface, setActiveSurface] = useState(null);
	const [effectsPanelTarget, setEffectsPanelTarget] = useState(null);
	const [effectWindow, setEffectWindow] = useState(null);
	const [macroDraft, setMacroDraft] = useState(() => ({ name: copy.untitledMacro, effects: [] }));
	const [dialog, setDialog] = useState(null);
	const [dialogValue, setDialogValue] = useState('');
	const [dialogSourceKey, setDialogSourceKey] = useState('global');
	const [localError, setLocalError] = useState('');
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [desktopEnvironment, setDesktopEnvironment] = useState(null);
	const [showArmControls, setShowArmControls] = useState(false);
	const [automationToolEnabled, setAutomationToolEnabled] = useState(false);
	const [generatorType, setGeneratorType] = useState('tone');
	const [nyquistTarget, setNyquistTarget] = useState(() => ({ prompt: true, pluginId: null }));
	const [preferencesPage, setPreferencesPage] = useState('shortcuts');
	const [draggedWorkspacePanelId, setDraggedWorkspacePanelId] = useState(null);
	const [projectBinSessionOpened, setProjectBinSessionOpened] = useState(false);
	const [toolbarDock, setToolbarDock] = useState('top');
	const [floatingToolbarPosition, setFloatingToolbarPosition] = useState({ x: 24, y: 104 });
	const [playbackMeterSettings, setPlaybackMeterSettings] = useState(loadPlaybackMeterSettings);
	const [recordingMeterSettings, setRecordingMeterSettings] = useState(loadRecordingMeterSettings);
	const meterWorkspaceRef = useRef(null);
	const toolbarDragRef = useRef(null);
	const floatingToolbarRef = useRef(null);
	const importInputRef = useRef(null);
	const labelInputRef = useRef(null);
	const aup4InputRef = useRef(null);
	const legacyAupInputRef = useRef(null);
	const legacyDataInputRef = useRef(null);
	const pendingLegacyProjectRef = useRef(null);
	const desktopReadySignalledRef = useRef(false);
	const desktopOpenQueueRef = useRef(Promise.resolve());
	const editorRef = useRef(null);
	const workspaceRef = useRef(null);
	const isCompact = useMediaQuery('(max-width: 900px)');
	const isProjectBinCompact = useMediaQuery('(max-width: 520px)');
	const project = snapshot.project;
	const preferences = snapshot.preferences;
	const isVideoEditorWorkspace = preferences?.workspace?.activeId === 'video-editor';
	const projectBinPreferenceVisible = preferences?.workspace?.panels?.['project-bin']?.visible === true;
	const projectBinEffectivelyOpen = projectBinPreferenceVisible
		&& (isVideoEditorWorkspace || !isProjectBinCompact || projectBinSessionOpened);
	const toolbarPreferences = preferences?.workspace?.toolbars || {};
	const toolbarButtonPreferences = preferences?.workspace?.toolbarButtons || {};
	const blocked = Boolean(
		snapshot.importing
		|| snapshot.recordingStarting
		|| snapshot.recordingScheduling
		|| snapshot.scheduledRecording
		|| snapshot.recording
		|| snapshot.playbackOptions?.preparing
		|| snapshot.exporting
		|| snapshot.processingEffect
		|| snapshot.analysisProcessing
		|| snapshot.sampleEdit?.processing,
	);
	const editBlocked = blocked || snapshot.readOnly;
	const displayAudioSupported = fileService.isDesktop
		? desktopEnvironment?.capabilities?.displayAudio === true
		: undefined;
	const selectionActive = Boolean(snapshot.selection);
	const selectedClip = project?.clips.find((clip) => clip.id === snapshot.selectedClipId) || null;
	const clipSelectionActive = Boolean(selectedClip || project?.selection?.clipIds?.some((clipId) => (
		project.clips.some((clip) => clip.id === clipId)
	)));
	const editSelectionActive = selectionActive || clipSelectionActive;
	const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId) || null;
	const selectedAudioTrack = selectedTrack?.type === 'audio' ? selectedTrack : null;
	const selectedAudioTrackRate = trackSourceRate(project, selectedAudioTrack, project?.sampleRate || 48_000);
	const splitAvailable = Boolean(
		selectedClip
		|| selectedAudioTrack?.clipIds?.length
		|| project?.selection?.clipIds?.some((clipId) => project.clips.some((clip) => clip.id === clipId))
		|| project?.selection?.trackIds?.some((trackId) => (
			project.tracks.some((track) => track.id === trackId && track.type === 'audio' && track.clipIds.length)
		)),
	);
	const finishToolbarDrag = useCallback(() => {
		const drag = toolbarDragRef.current;
		if (drag?.frame) cancelAnimationFrame(drag.frame);
		if (drag?.moved) {
			setToolbarDock(drag.dock);
			if (drag.dock === 'floating') {
				setFloatingToolbarPosition({ x: drag.x, y: drag.y });
			}
		}
		toolbarDragRef.current = null;
	}, []);
	const handleToolbarGripperMouseDown = useCallback((event, toolbarRect) => {
		if (event.button !== 0 || !editorRef.current) return;
		event.preventDefault();
		const editorRect = editorRef.current.getBoundingClientRect();
		toolbarDragRef.current = {
			startX: event.clientX,
			startY: event.clientY,
			offsetX: event.clientX - toolbarRect.left,
			offsetY: event.clientY - toolbarRect.top,
			editorLeft: editorRect.left,
			editorTop: editorRect.top,
			editorBottom: editorRect.bottom,
			dock: toolbarDock,
			x: floatingToolbarPosition.x,
			y: floatingToolbarPosition.y,
			frame: 0,
			moved: false,
		};
	}, [floatingToolbarPosition.x, floatingToolbarPosition.y, toolbarDock]);
	useEffect(() => {
		const handleToolbarDrag = (event) => {
			const drag = toolbarDragRef.current;
			if (!drag) return;
			const moved = drag.moved || Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4;
			if (!moved) return;
			drag.moved = true;
			const edgeDistance = 56;
			if (event.clientY - drag.editorTop <= edgeDistance) {
				if (drag.dock !== 'top') {
					drag.dock = 'top';
					setToolbarDock('top');
				}
				return;
			}
			if (drag.editorBottom - event.clientY <= edgeDistance) {
				if (drag.dock !== 'bottom') {
					drag.dock = 'bottom';
					setToolbarDock('bottom');
				}
				return;
			}
			drag.x = Math.max(0, event.clientX - drag.editorLeft - drag.offsetX);
			drag.y = Math.max(0, event.clientY - drag.editorTop - drag.offsetY);
			if (drag.dock !== 'floating') {
				drag.dock = 'floating';
				setToolbarDock('floating');
			}
			if (drag.frame) return;
			drag.frame = requestAnimationFrame(() => {
				drag.frame = 0;
				if (toolbarDragRef.current !== drag || drag.dock !== 'floating') return;
				const toolbar = floatingToolbarRef.current;
				if (!toolbar) return;
				toolbar.style.left = `${drag.x}px`;
				toolbar.style.top = `${drag.y}px`;
			});
		};
		window.addEventListener('mousemove', handleToolbarDrag);
		window.addEventListener('mouseup', finishToolbarDrag);
		return () => {
			window.removeEventListener('mousemove', handleToolbarDrag);
			window.removeEventListener('mouseup', finishToolbarDrag);
			const drag = toolbarDragRef.current;
			if (drag?.frame) {
				cancelAnimationFrame(drag.frame);
				drag.frame = 0;
			}
		};
	}, [finishToolbarDrag]);

	useEffect(() => {
		setParityUi(parityRuntime.uiController.getSnapshot());
		const unsubscribe = parityRuntime.uiController.subscribe(() => {
			setParityUi(parityRuntime.uiController.getSnapshot());
		});
		return () => {
			unsubscribe();
			parityRuntime.dispose();
			void controller.dispose();
		};
	}, [controller, parityRuntime]);
	useEffect(() => {
		try {
			globalThis.localStorage?.setItem(
				PLAYBACK_METER_SETTINGS_STORAGE_KEY,
				JSON.stringify(playbackMeterSettings),
			);
		} catch {
			// Meter presentation preferences are best-effort in restricted storage contexts.
		}
	}, [playbackMeterSettings]);
	useEffect(() => {
		try {
			globalThis.localStorage?.setItem(
				RECORDING_METER_SETTINGS_STORAGE_KEY,
				JSON.stringify(recordingMeterSettings),
			);
		} catch {
			// Meter presentation preferences are best-effort in restricted storage contexts.
		}
	}, [recordingMeterSettings]);
	useEffect(() => {
		const activeWorkspaceId = preferences?.workspace?.activeId || 'modern';
		const previousWorkspaceId = meterWorkspaceRef.current;
		meterWorkspaceRef.current = activeWorkspaceId;
		if (!previousWorkspaceId || previousWorkspaceId === activeWorkspaceId || activeWorkspaceId !== 'modern') return;
		setPlaybackMeterSettings((settings) => settings.position === 'side'
			? settings
			: { ...settings, position: 'side' });
		setRecordingMeterSettings((settings) => settings.position === 'side'
			? settings
			: { ...settings, position: 'side' });
	}, [preferences?.workspace?.activeId]);
	const uiFlags = parityUi.flags;

	const onError = useCallback((error) => {
		const message = error instanceof Error ? error.message : String(error || copy.unknownError);
		setLocalError(copy.genericError.replace('{message}', message));
	}, [copy.genericError, copy.unknownError]);

	const run = useCallback((action) => {
		setLocalError('');
		try {
			const value = action();
			if (value && typeof value.catch === 'function') value.catch(onError);
			return value;
		} catch (error) {
			onError(error);
			return undefined;
		}
	}, [onError]);
	const workspaceSwitcherOptions = useMemo(() => [
		{ id: 'modern', name: copy.workspaceModern },
		{ id: 'music', name: copy.workspaceMusic },
		{ id: 'classic', name: copy.workspaceClassic },
		{ id: 'video-editor', name: copy.workspaceVideo },
		...(preferences?.workspace?.custom || []).map(({ id, name }) => ({ id, name })),
	], [
		copy.workspaceClassic,
		copy.workspaceModern,
		copy.workspaceMusic,
		copy.workspaceVideo,
		preferences?.workspace?.custom,
	]);
	const publishWorkspaceSwitcherState = useCallback(() => {
		globalThis.dispatchEvent?.(new CustomEvent('soundscaper:workspace-state', {
			detail: {
				activeId: preferences?.workspace?.activeId || 'modern',
				workspaces: workspaceSwitcherOptions,
			},
		}));
	}, [preferences?.workspace?.activeId, workspaceSwitcherOptions]);
	useEffect(() => {
		const handleWorkspaceRequest = (event) => {
			const workspaceId = event?.detail?.workspaceId;
			if (!workspaceSwitcherOptions.some(({ id }) => id === workspaceId)) return;
			run(() => controller.actions.preferences.setWorkspace(workspaceId));
		};
		globalThis.addEventListener?.('soundscaper:workspace-request', handleWorkspaceRequest);
		globalThis.addEventListener?.('soundscaper:workspace-ready', publishWorkspaceSwitcherState);
		publishWorkspaceSwitcherState();
		return () => {
			globalThis.removeEventListener?.('soundscaper:workspace-request', handleWorkspaceRequest);
			globalThis.removeEventListener?.('soundscaper:workspace-ready', publishWorkspaceSwitcherState);
		};
	}, [controller, publishWorkspaceSwitcherState, run, workspaceSwitcherOptions]);
	useEffect(() => {
		if (!fileService.isDesktop) return undefined;
		let active = true;
		Promise.resolve(fileService.getEnvironment())
			.then((environment) => {
				if (active) setDesktopEnvironment(environment);
			})
			.catch(onError);
		return () => { active = false; };
	}, [fileService, onError]);
	const moveWorkspacePanel = useCallback((panelId, dock, index) => {
		setDraggedWorkspacePanelId(null);
		return run(() => controller.actions.preferences.movePanel(panelId, dock, index));
	}, [controller, run]);
	const zoomProject = useCallback((direction, anchor = null) => {
		const scroll = workspaceRef.current?.querySelector('.audio-editor-timeline-scroll');
		const timeline = scroll?.closest('.audio-editor-timeline-panel');
		if (!scroll || !timeline) return undefined;
		const rect = scroll.getBoundingClientRect();
		const panelWidth = Number.parseFloat(getComputedStyle(timeline).getPropertyValue('--track-panel-width')) || 0;
		const currentZoom = snapshot.timeline?.pixelsPerSecond || 120;
		let anchorSeconds;
		let anchorOffset;
		if (anchor === 'playhead') {
			const positionFrame = controller.getTelemetrySnapshot?.().positionFrame || 0;
			anchorSeconds = positionFrame / (project?.sampleRate || 48_000);
			anchorOffset = panelWidth + Math.max(0, scroll.clientWidth - panelWidth) / 2;
		} else {
			const clientX = anchor?.clientX ?? rect.left + scroll.clientWidth / 2;
			anchorSeconds = (scroll.scrollLeft + clientX - rect.left - panelWidth) / currentZoom;
			anchorOffset = clientX - rect.left;
		}
		const action = direction === 'in'
			? controller.actions.timeline.zoomIn
			: controller.actions.timeline.zoomOut;
		const nextZoom = run(() => action());
		requestAnimationFrame(() => {
			const element = workspaceRef.current?.querySelector('.audio-editor-timeline-scroll');
			if (!element) return;
			const appliedZoom = Number(nextZoom) || currentZoom * (direction === 'in' ? 2 : 0.5);
			const maximumScroll = Math.max(0, element.scrollWidth - element.clientWidth);
			element.scrollLeft = Math.max(0, Math.min(maximumScroll, anchorSeconds * appliedZoom - anchorOffset));
		});
		return nextZoom;
	}, [controller, project?.sampleRate, run, snapshot.timeline?.pixelsPerSecond]);
	const jumpTransport = useCallback((action) => {
		const value = run(action);
		requestAnimationFrame(() => {
			const scroll = workspaceRef.current?.querySelector('.audio-editor-timeline-scroll');
			if (!scroll) return;
			const positionFrame = controller.getTelemetrySnapshot?.().positionFrame || 0;
			const pixelsPerSecond = snapshot.timeline?.pixelsPerSecond || 120;
			const sampleRate = project?.sampleRate || 48_000;
			const nextScroll = positionFrame / sampleRate * pixelsPerSecond - scroll.clientWidth / 2;
			const maximumScroll = Math.max(0, scroll.scrollWidth - scroll.clientWidth);
			scroll.scrollLeft = Math.max(0, Math.min(maximumScroll, nextScroll));
		});
		return value;
	}, [controller, project?.sampleRate, run, snapshot.timeline?.pixelsPerSecond]);
	const jumpToStart = useCallback(
		() => jumpTransport(() => controller.actions.transport.jumpStart()),
		[controller, jumpTransport],
	);
	const jumpToEnd = useCallback(
		() => jumpTransport(() => controller.actions.transport.jumpEnd()),
		[controller, jumpTransport],
	);

	useEffect(() => {
		const editor = editorRef.current;
		if (!editor) return undefined;
		const onWheel = (event) => {
			if (event.altKey || (!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return;
			event.preventDefault();
			zoomProject(event.deltaY < 0 ? 'in' : 'out', { clientX: event.clientX });
		};
		editor.addEventListener('wheel', onWheel, { passive: false });
		return () => editor.removeEventListener('wheel', onWheel);
	}, [zoomProject]);

	const toggleFullscreen = useCallback(async () => {
		const next = !isFullscreen;
		setIsFullscreen(next);
		try {
			await fileService.setFullscreen(next);
		} catch (error) {
			setIsFullscreen(!next);
			throw error;
		}
	}, [fileService, isFullscreen]);
	const toggleSplitTool = useCallback(() => {
		if (snapshot.sampleEdit?.mode === 'pencil') run(() => controller.actions.sampleEdit.setMode(null));
		setAutomationToolEnabled(false);
		return parityRuntime.actions.tools.toggleSplitTool();
	}, [controller, parityRuntime, run, snapshot.sampleEdit?.mode]);
	const toggleAutomationTool = useCallback(() => {
		if (snapshot.sampleEdit?.mode === 'pencil') run(() => controller.actions.sampleEdit.setMode(null));
		setAutomationToolEnabled((enabled) => {
			if (!enabled && parityRuntime.uiController.getSnapshot().flags.splitTool) {
				parityRuntime.actions.tools.toggleSplitTool();
			}
			return !enabled;
		});
	}, [controller, parityRuntime, run, snapshot.sampleEdit?.mode]);
	useEffect(() => {
		if (snapshot.sampleEdit?.mode !== 'pencil') return;
		if (uiFlags.splitTool) parityRuntime.actions.tools.toggleSplitTool();
		setAutomationToolEnabled(false);
	}, [parityRuntime, snapshot.sampleEdit?.mode, uiFlags.splitTool]);

	const toggleRecording = useCallback(() => {
		if (snapshot.recording) return run(() => controller.actions.recording.stop());
		if (snapshot.scheduledRecording || snapshot.recordingScheduling) return undefined;
		const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId);
		const pairedAudioTrack = selectedTrack?.type === 'video' && selectedTrack.laneGroupId
			? project?.tracks.find((track) => (
				track.type === 'audio' && track.laneGroupId === selectedTrack.laneGroupId
			))
			: null;
		const trackId = showArmControls
			? undefined
			: selectedTrack?.type === 'audio'
				? selectedTrack.id
				: pairedAudioTrack?.id || project?.tracks.find((track) => track.type === 'audio')?.id;
		return run(() => controller.actions.recording.start({ trackId }));
	}, [controller, project?.tracks, run, showArmControls, snapshot.recording, snapshot.recordingScheduling, snapshot.scheduledRecording, snapshot.selectedTrackId]);

	const openTimedRecording = useCallback(() => {
		const startTimeMs = snapshot.scheduledRecording?.startTimeMs ?? Date.now() + 5 * 60_000;
		setDialogValue(formatDateTimeLocalInput(startTimeMs));
		setDialog('timed-recording');
	}, [snapshot.scheduledRecording?.startTimeMs]);
	const openRecordingOffset = useCallback(() => {
		setDialogValue(String(snapshot.monitor?.latencyOffsetMs ?? 0));
		setDialogSourceKey('global');
		setDialog('recording-offset');
	}, [snapshot.monitor?.latencyOffsetMs]);

	const openProjects = useCallback(() => {
		setDialog('projects');
		run(() => controller.actions.project.list());
	}, [controller, run]);
	const openDesktopFiles = useCallback(async (purpose, multiple = false, importOptions = {}) => {
		const descriptors = await fileService.chooseFiles({ purpose, multiple });
		const files = [];
		for (const descriptor of descriptors) files.push(await fileService.openReadDescriptor(descriptor));
		if (purpose === 'project') {
			for (const file of files) await controller.actions.project.openAup4(file);
		} else if (purpose === 'labels') {
			for (const file of files) await controller.actions.labels.importFile(file);
		} else if (files.length) {
			await controller.actions.project.importFiles(files, {
				destination: 'auto',
				projectBinVisible: projectBinEffectivelyOpen,
				...importOptions,
			});
		}
		return files.length;
	}, [controller, fileService, projectBinEffectivelyOpen]);

	const openSurface = useCallback((surface, options = {}) => {
		if (surface === 'preferences') {
			const requestedSection = options?.section;
			setPreferencesPage(requestedSection === 'workspace'
				? 'workspace'
				: requestedSection === 'snap' || requestedSection === 'editing'
					? 'editing'
					: 'shortcuts');
		}
		setActiveSurface(surface);
	}, []);

	const openEffects = useCallback((trackId, _anchorRect = null, scope = 'track') => {
		if (!trackId && scope !== 'master') return;
		setActiveSurface(null);
		setEffectsPanelTarget({ trackId: scope === 'master' ? null : trackId, scope });
		run(() => {
			if (scope === 'track' && trackId !== snapshot.selectedTrackId) {
				controller.actions.timeline.selectTrack(trackId);
			}
			controller.actions.preferences.setPanel('effects', { visible: true });
		});
		requestAnimationFrame(() => {
			const panel = workspaceRef.current?.querySelector('[data-workspace-panel="effects"]');
			if (!panel) return;
			panel.tabIndex = -1;
			panel.focus({ preventScroll: false });
		});
	}, [controller, run, snapshot.selectedTrackId]);

	const durationFrames = project ? projectDurationFrames(project) : 0;
	const statusMessage = localError || snapshot.status?.message || copy.ready;
	const statusState = localError ? 'error' : snapshot.status?.state || 'info';
	const aup4Compatibility = snapshot.aup4Compatibility;
	const saveText = snapshot.save?.state === 'saving'
		? copy.projectSaving
		: snapshot.save?.state === 'dirty'
			? copy.projectDirty
			: copy.projectSaved;
	const recordLabel = showArmControls ? copy.record : copy.recordActiveTrack;

	const editItems = [
		{ action: 'cutPerTrackRipple', label: copy.cutPerTrackRipple, icon: 'cut', disabled: editBlocked || !editSelectionActive },
		{ action: 'cutLeaveGap', label: copy.cutLeaveGap, icon: 'cut', disabled: editBlocked || !editSelectionActive },
		{ action: 'cutAllTracksRipple', label: copy.cutAllTracksRipple, icon: 'cut', disabled: editBlocked || !editSelectionActive },
		{ action: 'copy', label: copy.copy, icon: 'copy', disabled: editBlocked || !editSelectionActive },
		{ action: 'paste', label: copy.paste, icon: 'paste', disabled: editBlocked || !snapshot.history?.hasClipboard },
		{ action: 'split', label: copy.split, icon: 'split', disabled: editBlocked || !splitAvailable },
		{ action: 'deletePerTrackRipple', label: copy.deletePerTrackRipple, icon: 'trash', disabled: editBlocked || !editSelectionActive },
		{ action: 'deleteLeaveGap', label: copy.deleteLeaveGap, icon: 'trash', disabled: editBlocked || !editSelectionActive },
		{ action: 'deleteAllTracksRipple', label: copy.deleteAllTracksRipple, icon: 'trash', disabled: editBlocked || !editSelectionActive },
	];

	const executeEdit = useCallback(
		(action) => run(() => controller.actions.edit[action]()),
		[controller, run],
	);
	const openSelectionEffect = useCallback((type = null) => {
		if (type) run(() => controller.actions.effects.setSelectionType(type));
		openSurface('selection-effect');
	}, [controller, openSurface, run]);
	const openSpectralSelection = useCallback(() => {
		openSurface('spectral-selection');
	}, [openSurface]);
	const openGenerator = useCallback((type) => {
		setGeneratorType(type);
		openSurface('generator');
	}, [openSurface]);
	const closeNyquist = useCallback(() => {
		controller.actions.nyquist.cancel();
		setActiveSurface(null);
	}, [controller]);
	const openWorkspacePanel = useCallback((panelId) => {
		if (panelId === 'project-bin') setProjectBinSessionOpened(true);
		run(() => controller.actions.preferences.setPanel(panelId, { visible: true }));
		requestAnimationFrame(() => {
			const panel = workspaceRef.current?.querySelector(`[data-workspace-panel="${panelId}"]`);
			if (!panel) return;
			panel.tabIndex = -1;
			panel.focus({ preventScroll: false });
		});
	}, [controller, run]);
	const toggleWorkspacePanel = useCallback((panelId) => {
		if (panelId !== 'project-bin') {
			return run(() => controller.actions.preferences.togglePanel(panelId));
		}
		if (projectBinEffectivelyOpen) {
			return run(() => controller.actions.preferences.setPanel(panelId, { visible: false }));
		}
		setProjectBinSessionOpened(true);
		return run(() => controller.actions.preferences.setPanel(panelId, { visible: true }));
	}, [controller, projectBinEffectivelyOpen, run]);
	const revealProjectBin = useCallback(
		() => openWorkspacePanel('project-bin'),
		[openWorkspacePanel],
	);
	const openExternal = useCallback((url) => {
		if (fileService.isDesktop) return fileService.openExternal(desktopExternalDestination(url));
		const opened = globalThis.open?.(url, '_blank', 'noopener,noreferrer');
		if (opened) opened.opener = null;
		return undefined;
	}, [fileService]);
	useEffect(() => {
		const request = parityUi.request;
		if (!request) return;
		const payload = request.payload || {};
		if (request.type === 'open-surface') {
			if (payload.surface === 'generator') setGeneratorType(payload.type || 'tone');
			if (payload.surface === 'nyquist') setNyquistTarget({
				prompt: !payload.pluginId,
				pluginId: payload.pluginId || null,
			});
			if (payload.surface === 'selection-effect' && payload.type) {
				run(() => controller.actions.effects.setSelectionType(payload.type));
			}
			openSurface(payload.surface || null, payload);
		} else if (request.type === 'open-external') openExternal(payload.url);
		else if (request.type === 'toggle-fullscreen') toggleFullscreen();
		else if (request.type === 'choose-audio-files') importInputRef.current?.click();
		else if (request.type === 'open-about') setDialog('about');
		else if (request.type === 'open-timed-recording') openTimedRecording();
		else if (request.type === 'close-project') run(() => controller.actions.project.close(payload.projectId, payload));
		else if (request.type === 'set-custom-track-rate') {
			setDialogValue(String(selectedAudioTrackRate));
			setDialog('track-rate');
		} else if (request.type === 'rename-track') {
			setDialogValue(selectedTrack?.name || '');
			setDialog('track-rename');
		} else if (request.type === 'focus-panel') {
			if (payload.panel) openWorkspacePanel(payload.panel);
			else requestAnimationFrame(() => {
				const regions = [...(workspaceRef.current?.querySelectorAll(
					'[data-workspace-panel], [data-editor-tool-toolbar], .audio-editor-timeline-panel, [data-selection-toolbar]',
				) || [])].filter((element) => element.getClientRects().length > 0);
				if (!regions.length) return;
				const current = regions.findIndex((element) => element === document.activeElement || element.contains(document.activeElement));
				const direction = payload.direction === 'previous' ? -1 : 1;
				const next = regions[(Math.max(0, current) + direction + regions.length) % regions.length];
				next.tabIndex = -1;
				next.focus({ preventScroll: false });
			});
		} else if (request.type === 'center-playhead') {
			const scroll = workspaceRef.current?.querySelector('.audio-editor-timeline-scroll');
			const positionFrame = controller.getTelemetrySnapshot?.().positionFrame || 0;
			const pixelsPerSecond = snapshot.timeline?.pixelsPerSecond || 120;
			const sampleRate = project?.sampleRate || 48_000;
			if (scroll) scroll.scrollLeft = Math.max(0, positionFrame / sampleRate * pixelsPerSecond - scroll.clientWidth / 2);
		} else if (request.type === 'open-context-menu') {
			const selectedId = payload.clipId || payload.trackId;
			const attribute = payload.clipId ? 'data-clip-id' : 'data-track-id';
			const target = [...(workspaceRef.current?.querySelectorAll(`[${attribute}]`) || [])]
				.find((element) => String(element.getAttribute(attribute)) === String(selectedId));
			const rect = target?.getBoundingClientRect?.();
			if (target && rect) target.dispatchEvent(new MouseEvent('contextmenu', {
				bubbles: true,
				cancelable: true,
				clientX: rect.left + Math.min(24, rect.width / 2),
				clientY: rect.top + Math.min(24, rect.height / 2),
			}));
		} else if (request.type === 'focus-recording-level') {
			requestAnimationFrame(() => workspaceRef.current
				?.closest('#kw-audio-editor-design-system')
				?.querySelector('[data-recording-level] input')
				?.focus());
		}
	}, [
		controller,
		openExternal,
		openSurface,
		openRecordingOffset,
		openTimedRecording,
		openWorkspacePanel,
		parityUi.request?.revision,
		project?.sampleRate,
		run,
		selectedAudioTrackRate,
		selectedTrack?.name,
		snapshot.timeline?.pixelsPerSecond,
		toggleFullscreen,
	]);
	const recentProjectsMenuKey = (snapshot.recentProjects || [])
		.map(({ id, title }) => `${id}:${title}`)
		.join('\n');
	const applicationMenus = useMemo(() => createApplicationMenus({
		locale,
		copy,
		project,
		snapshot,
		blocked,
		editBlocked,
		showArmControls,
		recordLabel,
		selectionActive,
		selectedClip,
		durationFrames,
		effectsPanelOpen: Boolean(snapshot.preferences?.workspace?.panels?.effects?.visible),
		projectBinEffectivelyOpen,
		uiFlags,
		actionRuntime: parityRuntime.actions,
			actions: {
			newProject: () => run(() => controller.actions.project.create()),
			openProjects,
			openRecentProject: (projectId) => run(() => controller.actions.project.openRecent(projectId)),
			clearRecentProjects: () => run(() => controller.actions.project.clearRecent()),
			closeProject: () => run(() => controller.actions.project.close()),
			openAup4: () => fileService.isDesktop
				? run(() => openDesktopFiles('project'))
				: aup4InputRef.current?.click(),
			openLegacyAup: () => legacyAupInputRef.current?.click(),
			saveProject: () => run(() => controller.actions.project.save()),
			saveAup4: () => run(() => controller.actions.project.saveAup4({ saveCopy: snapshot.readOnly })),
			openAup4CompatibilityReport: () => setDialog('aup4-compatibility'),
				importAudio: () => fileService.isDesktop
					? run(() => openDesktopFiles('media', true))
					: importInputRef.current?.click(),
				importLabels: () => fileService.isDesktop
					? run(() => openDesktopFiles('labels', true))
					: labelInputRef.current?.click(),
				exportAudio: () => openSurface('export'),
				exportLabels: (format) => run(() => controller.actions.labels.export({ format })),
			renameProject: () => { setDialogValue(project?.title || ''); setDialog('rename'); },
			duplicateProject: () => run(() => controller.actions.project.duplicate()),
			deleteProject: () => setDialog('delete'),
			clearData: () => setDialog('clear'),
			executeEdit,
			openLabels: () => openWorkspacePanel('labels'),
			openMetadata: () => openWorkspacePanel('metadata'),
			openClipProperties: () => openSurface('clip'),
			openPreferences: () => openSurface('preferences'),
			selectAll: () => run(() => controller.actions.timeline.setSelection(0, durationFrames)),
			selectNone: () => run(() => controller.actions.timeline.clearSelection()),
			selectAllTracks: () => run(() => controller.actions.timeline.selectAllTracks()),
			selectLeftOfPlayback: () => run(() => controller.actions.timeline.selectLeftOfPlayback()),
			selectRightOfPlayback: () => run(() => controller.actions.timeline.selectRightOfPlayback()),
			selectTrackStartToCursor: () => run(() => controller.actions.timeline.selectTrackStartToCursor()),
			selectCursorToTrackEnd: () => run(() => controller.actions.timeline.selectCursorToTrackEnd()),
			selectTrackStartToEnd: () => run(() => controller.actions.timeline.selectTrackStartToEnd()),
			toggleLoop: () => run(() => controller.actions.transport.toggleLoop()),
			clearLoop: () => run(() => controller.actions.transport.clearLoop()),
			loopToSelection: () => run(() => controller.actions.transport.loopToSelection()),
			selectionToLoop: () => run(() => controller.actions.transport.selectionToLoop()),
			setLoopInOut: () => run(() => controller.actions.transport.setLoopInOut()),
			toggleSelectionFollowsLoop: () => run(() => controller.actions.transport.toggleSelectionFollowsLoop()),
			setTimelineView: (view) => run(() => controller.actions.timeline.setView(view)),
			toggleRms: () => run(() => controller.actions.timeline.toggleRms()),
			toggleVerticalRulers: () => run(() => controller.actions.timeline.toggleVerticalRulers()),
			toggleUpdateWhilePlaying: () => run(() => controller.actions.timeline.toggleUpdateWhilePlaying()),
			togglePinnedPlayhead: () => run(() => controller.actions.timeline.togglePinnedPlayhead()),
			toggleRulerPlayback: () => run(() => controller.actions.timeline.toggleRulerPlayback()),
				setSnap: (settings) => run(() => controller.actions.timeline.setSnap(settings)),
			zoomIn: () => zoomProject('in', 'playhead'),
			zoomOut: () => zoomProject('out', 'playhead'),
			zoomDefault: () => run(() => parityRuntime.actions.timeline.zoomDefault()),
			zoomSelection: () => run(() => parityRuntime.actions.timeline.zoomSelection()),
			zoomToggle: () => run(() => parityRuntime.actions.timeline.zoomToggle()),
			zoomFit: () => run(() => controller.actions.timeline.zoomFit()),
			centerOnPlayhead: () => run(() => parityRuntime.actions.timeline.centerOnPlayhead()),
			fullscreen: () => run(toggleFullscreen),
			record: toggleRecording,
			recordNewTrack: () => run(() => controller.actions.recording.startNewTrack()),
			pauseRecording: () => run(() => controller.actions.recording.pause()),
			openTimedRecording,
			toggleLeadIn: () => run(() => controller.actions.recording.toggleLeadIn()),
			toggleMetronome: () => run(() => controller.actions.transport.toggleMetronome()),
			toggleArmControls: () => setShowArmControls((current) => !current),
			stop: () => run(() => controller.actions.transport.stop()),
			playPause: () => run(() => controller.actions.transport.playPause()),
			playAtSpeed: () => run(() => controller.actions.transport.playAtSpeed()),
			toggleMonitoring: () => run(() => controller.actions.recording.setMonitoring(!snapshot.monitor?.enabled)),
			requestInputAccess: () => run(() => controller.actions.recording.requestInputAccess()),
			refreshInputs: () => run(() => controller.actions.recording.refreshInputs()),
			releaseInputs: () => run(() => controller.actions.recording.releaseInputs()),
			openRecordingOffset,
			addTrack: () => run(() => controller.actions.track.add()),
			addAudioTrack: () => run(() => controller.actions.track.add()),
			addMonoTrack: () => run(() => controller.actions.track.addMono()),
			addStereoTrack: () => run(() => controller.actions.track.addStereo()),
			addLabelTrack: () => run(() => controller.actions.track.addLabel()),
			duplicateTrack: () => snapshot.selectedTrackId && run(() => controller.actions.track.duplicate(snapshot.selectedTrackId)),
			removeTrack: () => snapshot.selectedTrackId && run(() => controller.actions.track.remove(snapshot.selectedTrackId)),
			moveTrackUp: () => snapshot.selectedTrackId && run(() => moveAudioEditorTrackBlock(
				controller,
				project?.tracks || [],
				snapshot.selectedTrackId,
				'up',
			)),
			moveTrackDown: () => snapshot.selectedTrackId && run(() => moveAudioEditorTrackBlock(
				controller,
				project?.tracks || [],
				snapshot.selectedTrackId,
				'down',
			)),
			moveTrackTop: () => snapshot.selectedTrackId && run(() => moveAudioEditorTrackBlock(
				controller,
				project?.tracks || [],
				snapshot.selectedTrackId,
				'top',
			)),
			moveTrackBottom: () => snapshot.selectedTrackId && run(() => moveAudioEditorTrackBlock(
				controller,
				project?.tracks || [],
				snapshot.selectedTrackId,
				'bottom',
			)),
			makeStereoTrack: () => run(() => controller.actions.track.makeStereo(snapshot.selectedTrackId)),
			swapTrackChannels: () => run(() => controller.actions.track.swapChannels(snapshot.selectedTrackId)),
			splitStereoLr: () => run(() => controller.actions.track.splitStereoLR(snapshot.selectedTrackId)),
			splitStereoCenter: () => run(() => controller.actions.track.splitStereoCenter(snapshot.selectedTrackId)),
			collapseAllTracks: () => run(() => controller.actions.track.collapseAll()),
			expandAllTracks: () => run(() => controller.actions.track.expandAll()),
			setTrackDisplay: (mode) => snapshot.selectedTrackId && run(() => controller.actions.track.setDisplayMode(snapshot.selectedTrackId, mode)),
			setTrackRate: (sampleRate) => snapshot.selectedTrackId && run(() => controller.actions.track.setRate(snapshot.selectedTrackId, sampleRate)),
			setTrackSampleFormat: (sampleFormat) => snapshot.selectedTrackId && run(() => controller.actions.track.setSampleFormat(snapshot.selectedTrackId, sampleFormat)),
			mixAndRender: () => run(() => controller.actions.track.mixAndRender()),
			openTrackRate: () => {
				setDialogValue(String(trackSourceRate(project, selectedAudioTrack, project?.sampleRate || 48_000)));
				setDialog('track-rate');
			},
			openResample: () => {
				setDialogValue(String(trackSourceRate(project, selectedAudioTrack, project?.sampleRate || 48_000)));
				setDialog('resample');
			},
				zeroCross: () => run(() => controller.actions.timeline.zeroCross()),
			toggleTrackMute: () => {
				const track = project?.tracks.find((candidate) => candidate.id === snapshot.selectedTrackId);
				if (track) run(() => controller.actions.track.update(track.id, { mute: !track.mute }));
			},
			openEffects: () => openEffects(snapshot.selectedTrackId),
			openMacroManager: () => openSurface('macro-manager'),
			openSelectionEffect,
			repeatLastEffect: () => run(() => controller.actions.effects.repeatLast()),
			openSpectralSelection,
			deleteSpectralSelection: () => run(() => controller.actions.spectral.delete()),
			amplifySpectralSelection: () => openSpectralSelection(),
			openGenerator,
			openNyquist: (pluginId = null) => {
				setNyquistTarget({ prompt: !pluginId, pluginId });
				openSurface('nyquist');
			},
			openAnalysis: (mode = 'levels') => {
				openWorkspacePanel(ANALYSIS_MODE_PANEL_IDS[mode] || 'analysis');
				const scope = selectedAudioTrack ? 'track' : 'master';
				if (mode === 'spectrum') run(() => controller.actions.analysis.plotSpectrum(scope));
				else if (mode === 'clipping') run(() => controller.actions.analysis.findClipping(scope));
			},
				openEbuR128: () => openWorkspacePanel('ebu-r128'),
				setWorkspace: (workspaceId) => run(() => controller.actions.preferences.setWorkspace(workspaceId)),
				togglePanel: toggleWorkspacePanel,
				manual: () => openExternal('https://support.audacityteam.org/au4'),
				tutorials: () => openExternal('https://support.audacityteam.org/au4'),
				support: () => openExternal('mailto:team@kw.media?subject=Soundscaper%20support'),
				about: () => setDialog('about'),
			},
	}), [
		blocked,
		controller,
		copy,
		durationFrames,
		editBlocked,
		snapshot.preferences?.workspace?.panels?.effects?.visible,
		executeEdit,
		fileService,
		locale,
		openDesktopFiles,
		openEffects,
		openExternal,
		openGenerator,
		openProjects,
		openRecordingOffset,
		openSelectionEffect,
		openSpectralSelection,
		openSurface,
		openTimedRecording,
		openWorkspacePanel,
		parityRuntime.actions,
		project,
		projectBinEffectivelyOpen,
		recentProjectsMenuKey,
		recordLabel,
		run,
		selectedClip,
		selectionActive,
		showArmControls,
		snapshot.effects?.canRepeatLast,
		snapshot.aup4Compatibility?.dismissed,
		snapshot.aup4Compatibility?.report,
		snapshot.history?.canRedo,
		snapshot.history?.canUndo,
		snapshot.history?.hasClipboard,
		snapshot.loopOptions?.selectionFollows,
		snapshot.monitor?.enabled,
		snapshot.preferences,
		snapshot.readOnly,
		snapshot.recordingOptions?.metronome,
		snapshot.selectedTrackId,
		snapshot.timeline?.pinnedPlayhead,
		snapshot.timeline?.playbackOnRulerClick,
		snapshot.timeline?.showRms,
		snapshot.timeline?.showVerticalRulers,
		snapshot.timeline?.updateDisplayWhilePlaying,
		snapshot.timeline?.view,
		toggleFullscreen,
		toggleRecording,
		toggleWorkspacePanel,
		uiFlags.clipping,
		uiFlags.masterTrack,
		uiFlags.statusbar,
		uiFlags.tracksPanel,
		zoomProject,
	]);
	useEffect(() => {
		if (!fileService.isDesktop) return undefined;
		let active = true;
		const openDescriptor = (descriptor) => {
			const operation = desktopOpenQueueRef.current
				.catch(() => undefined)
				.then(() => fileService.openReadDescriptor(descriptor))
				.then((file) => controller.actions.project.openAup4(file));
			desktopOpenQueueRef.current = operation;
			void operation.catch(onError);
		};
		const handleMenuCommand = ({ command } = {}) => {
			const edit = (action) => isDesktopTextEditingElement(document.activeElement, action)
				? fileService.editText(action)
				: controller.actions.edit[action]();
			const actions = {
				'project:open': () => openDesktopFiles('project'),
				'project:save': () => controller.actions.project.flush(),
				'project:save-as': () => controller.actions.project.saveAup4({ saveCopy: snapshot.readOnly }),
				'audio:export': () => openSurface('export'),
				'edit:undo': () => edit('undo'),
				'edit:redo': () => edit('redo'),
				'edit:cut': () => edit('cut'),
				'edit:copy': () => edit('copy'),
				'edit:paste': () => edit('paste'),
				'edit:select-all': () => isDesktopTextEditingElement(document.activeElement, 'selectAll')
					? fileService.editText('selectAll')
					: controller.actions.timeline.setSelection(0, durationFrames),
				preferences: () => openSurface('preferences'),
				'view:toggle-fullscreen': toggleFullscreen,
			};
			const action = actions[command];
			if (action) run(action);
		};
		const handleClose = async ({ requestId } = {}) => {
			let allow = false;
			try {
				const current = controller.getSnapshot();
				const activeWork = current.importing
					|| current.recording
					|| current.recordingStarting
					|| current.recordingScheduling
					|| current.scheduledRecording
					|| current.exporting
					|| current.processingEffect
					|| current.analysisProcessing
					|| current.sampleEdit?.processing;
				if (activeWork) {
					const stopAndQuit = globalThis.confirm?.('Soundscaper is still recording or processing. Stop the active work and quit?') ?? false;
					if (!stopAndQuit) return;
					await Promise.resolve(controller.actions.export.cancel());
					await Promise.resolve(controller.actions.recording.cancelScheduled());
					await Promise.resolve(controller.actions.recording.stop());
					await Promise.resolve(controller.actions.sampleEdit.cancel());
					await Promise.resolve(controller.actions.nyquist.cancel());
					await Promise.resolve(controller.actions.transport.stop());
					const remaining = controller.getSnapshot();
					if (remaining.importing || remaining.processingEffect || remaining.analysisProcessing) return;
				}
				await controller.actions.project.flush();
				allow = true;
			} catch (error) {
				onError(error);
			} finally {
				await fileService.respondToClose({ requestId, allow });
			}
		};
		const unsubscribers = [
			fileService.onOpenProject(openDescriptor),
			fileService.onMenuCommand(handleMenuCommand),
			fileService.onCloseRequested((request) => { void handleClose(request).catch(onError); }),
			fileService.onFullscreenChanged(({ fullscreen } = {}) => setIsFullscreen(Boolean(fullscreen))),
		];
		void controller.ready.then(() => {
			if (active && !desktopReadySignalledRef.current) {
				desktopReadySignalledRef.current = true;
				return fileService.signalReady();
			}
			return undefined;
		}).catch(onError);
		return () => {
			active = false;
			for (const unsubscribe of unsubscribers) unsubscribe();
		};
	}, [controller, fileService, onError, openDesktopFiles, openSurface, run, snapshot.readOnly, toggleFullscreen]);
	const editorToolbar = (
		<EditorToolToolbar
			controller={controller}
			snapshot={snapshot}
			locale={locale}
			copy={copy}
			isCompact={isCompact}
			blocked={blocked}
			selectionActive={selectionActive}
			durationFrames={durationFrames}
			editItems={editItems}
			executeEdit={executeEdit}
			recordLabel={recordLabel}
			toggleRecording={toggleRecording}
			run={run}
			toolbars={toolbarPreferences}
			toolbarButtons={toolbarButtonPreferences}
			uiFlags={uiFlags}
			playbackMeterSettings={playbackMeterSettings}
			onPlaybackMeterSettingsChange={setPlaybackMeterSettings}
			recordingMeterSettings={recordingMeterSettings}
			onRecordingMeterSettingsChange={setRecordingMeterSettings}
			automationToolEnabled={automationToolEnabled}
			onToggleAutomationTool={toggleAutomationTool}
			actionRuntime={parityRuntime.actions}
			onOpenSpectralSelection={openSpectralSelection}
				onOpenRecordingOffset={openRecordingOffset}
			onOpenTimedRecording={openTimedRecording}
			onJumpToStart={jumpToStart}
			onJumpToEnd={jumpToEnd}
			onGripperMouseDown={handleToolbarGripperMouseDown}
		/>
	);

	return (
		<div
			ref={editorRef}
			id="kw-audio-editor-design-system"
			style={editorThemeVariables}
			className={`kw-audio-editor ${isCompact ? 'kw-audio-editor--compact' : ''}${isFullscreen ? ' kw-audio-editor--viewport-fullscreen' : ''}`}
			data-audio-editor
			data-audio-editor-bound="true"
			data-project-id={project?.id || ''}
			data-track-count={project?.tracks.length || 0}
			data-clip-count={project?.clips.length || 0}
			data-timeline-view={snapshot.timeline?.view || 'waveform'}
			data-editor-theme={preferences?.appearance?.theme || 'system'}
			data-clip-style={preferences?.appearance?.clipStyle || 'colorful'}
			data-workspace-preset={preferences?.workspace?.activeId || 'modern'}
			onKeyDown={(event) => handleWorkspaceKeyboard(event, snapshot, run, {
				actionRuntime: parityRuntime.actions,
				menus: applicationMenus,
			})}
			onContextMenu={(event) => event.preventDefault()}
		>
			<AudioEditorMenuBar
				appName={copy.title}
				copy={copy}
				locale={locale}
				menus={applicationMenus}
				projectName={project?.title || copy.untitledProject}
				saveState={snapshot.save?.state || 'saved'}
				saveText={saveText}
				onFullscreen={() => run(toggleFullscreen)}
				projectTabs={<ProjectTabs
					projects={snapshot.projectTabs || snapshot.projects || []}
					activeProjectId={project?.id}
					copy={copy}
					disabled={blocked}
					onSelect={(projectId) => run(() => controller.actions.project.openById(projectId))}
					onNew={() => run(() => controller.actions.project.create())}
				/>}
			/>

			<input
				ref={aup4InputRef}
				className="kw-audio-editor__file-input"
				data-aup4-input
				aria-label={copy.openAup4}
				type="file"
				tabIndex={-1}
				accept=".aup4,application/x-audacity-project"
				onChange={(event) => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = '';
					if (file) run(() => controller.actions.project.openAup4(file));
				}}
			/>

			<input
				ref={legacyAupInputRef}
				className="kw-audio-editor__file-input"
				data-legacy-aup-input
				aria-label={copy.openLegacyAup}
				type="file"
				tabIndex={-1}
				accept=".aup,application/xml,text/xml"
				onChange={(event) => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = '';
					if (!file) return;
					pendingLegacyProjectRef.current = file;
					legacyDataInputRef.current?.click();
				}}
			/>

			<input
				ref={legacyDataInputRef}
				className="kw-audio-editor__file-input"
				data-legacy-data-input
				aria-label={copy.chooseLegacyData}
				type="file"
				tabIndex={-1}
				multiple
				webkitdirectory=""
				directory=""
				onChange={(event) => {
					const projectFile = pendingLegacyProjectRef.current;
					const files = [...event.currentTarget.files];
					event.currentTarget.value = '';
					pendingLegacyProjectRef.current = null;
					if (projectFile && files.length) run(() => controller.actions.project.importFiles([projectFile, ...files]));
				}}
			/>

			<input
				ref={importInputRef}
				className="kw-audio-editor__file-input"
				data-import-input
				aria-label={copy.importAudio}
				type="file"
				tabIndex={-1}
				accept={AUDIO_EDITOR_AUDIO_FILE_ACCEPT}
				multiple
				onChange={(event) => {
					const files = [...event.currentTarget.files];
					event.currentTarget.value = '';
					if (files.length) run(() => controller.actions.project.importFiles(files, {
						destination: 'auto',
						projectBinVisible: projectBinEffectivelyOpen,
					}));
				}}
			/>

			<input
				ref={labelInputRef}
				className="kw-audio-editor__file-input"
				data-label-input
				aria-label={copy.importLabels}
				type="file"
				tabIndex={-1}
				accept=".txt,.srt,.vtt,text/plain,text/vtt,application/x-subrip"
				onChange={(event) => {
					const file = event.currentTarget.files?.[0];
					event.currentTarget.value = '';
					if (file) run(() => controller.actions.labels.importFile(file));
				}}
			/>

			<EditorActionBar
				copy={copy}
				snapshot={snapshot}
				controller={controller}
				run={run}
				editBlocked={editBlocked}
				blocked={blocked}
				executeEdit={executeEdit}
				onSaveAup4={() => run(() => controller.actions.project.saveAup4({ saveCopy: snapshot.readOnly }))}
				onExportAudio={() => openSurface('export')}
				onToggleMixer={() => run(() => controller.actions.preferences.togglePanel('mixer'))}
			/>

			{isVideoEditorWorkspace && <VideoEditorWorkspacePanels
				controller={controller}
				snapshot={snapshot}
				copy={copy}
				locale={locale}
				fileService={fileService}
				playbackMeterSettings={playbackMeterSettings}
				run={run}
				showArmControls={showArmControls}
				displayAudioSupported={displayAudioSupported}
				onOpenEffects={openEffects}
				effectsPanelTarget={effectsPanelTarget}
				onEffectWindowChange={setEffectWindow}
				onTogglePanel={toggleWorkspacePanel}
				blocked={blocked}
			/>}

			{toolbarDock === 'top' && <div className="kw-audio-editor__toolbars" data-toolbar-dock="top">{editorToolbar}</div>}

			{snapshot.monitor?.enabled && (
				<div className="kw-audio-editor__monitor-warning" role="alert">{copy.monitorWarning}</div>
			)}
			{aup4Compatibility?.report && !aup4Compatibility.dismissed && (
				<aside className="kw-audio-editor__aup4-compatibility" role="status" data-aup4-compatibility-summary>
					<div>
						<strong>{copy.aup4CompatibilityReport}</strong>
						<p>{formatAup4CompatibilitySummary(aup4Compatibility.report, copy)}</p>
					</div>
					<div className="kw-audio-editor__aup4-compatibility-actions">
						<Button variant="secondary" onClick={() => setDialog('aup4-compatibility')}>
							{copy.aup4CompatibilityViewReport}
						</Button>
						<button
							type="button"
							className="kw-audio-editor__aup4-compatibility-dismiss"
							aria-label={copy.aup4CompatibilityDismiss}
							title={copy.aup4CompatibilityDismiss}
							onClick={() => controller.actions.project.dismissAup4CompatibilitySummary()}
						>×</button>
					</div>
				</aside>
			)}

			<div
				ref={workspaceRef}
				className="kw-audio-editor__workspace"
			>
				<WorkspacePanelDock
					dock="left"
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					locale={locale}
					fileService={fileService}
					playbackMeterSettings={playbackMeterSettings}
					run={run}
					showArmControls={showArmControls}
					displayAudioSupported={displayAudioSupported}
					onOpenEffects={openEffects}
					effectsPanelTarget={effectsPanelTarget}
					onEffectWindowChange={setEffectWindow}
					draggedPanelId={draggedWorkspacePanelId}
					onPanelDragStart={setDraggedWorkspacePanelId}
					onPanelDragEnd={() => setDraggedWorkspacePanelId(null)}
					onPanelMove={moveWorkspacePanel}
					onTogglePanel={toggleWorkspacePanel}
					projectBinEffectivelyOpen={projectBinEffectivelyOpen}
					blocked={blocked}
				/>
				{uiFlags.tracksPanel && <div className="kw-audio-editor__workspace-main">
				<main className="kw-audio-editor__canvas">
					<AudioEditorTimeline
						controller={controller}
						snapshot={snapshot}
						locale={locale}
						copy={copy}
						mobile={isCompact}
						showArmControls={showArmControls}
						displayAudioSupported={displayAudioSupported}
						splitToolEnabled={uiFlags.splitTool}
						automationToolEnabled={automationToolEnabled}
						onToggleSplitTool={toggleSplitTool}
						onError={onError}
						onOpenEffects={openEffects}
						onOpenClipProperties={() => openSurface('clip')}
						onExportClip={(clipId) => {
							const clip = project?.clips.find((candidate) => candidate.id === clipId);
							if (!clip) return;
							run(() => controller.actions.timeline.selectClip(clip.id));
							run(() => controller.actions.timeline.setSelection(clip.timelineStartFrame, clip.timelineStartFrame + clip.durationFrames));
							openSurface('export');
						}}
						onRevealProjectBin={revealProjectBin}
						onToggleArmControls={() => setShowArmControls((current) => !current)}
					/>
					<p className="kw-audio-editor__keyboard-help" tabIndex={-1}>{copy.keyboardHelp}</p>
				</main>
				<WorkspacePanelDock
					dock="bottom"
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					locale={locale}
					fileService={fileService}
					playbackMeterSettings={playbackMeterSettings}
					run={run}
					showArmControls={showArmControls}
					displayAudioSupported={displayAudioSupported}
					onOpenEffects={openEffects}
					effectsPanelTarget={effectsPanelTarget}
					onEffectWindowChange={setEffectWindow}
					draggedPanelId={draggedWorkspacePanelId}
					onPanelDragStart={setDraggedWorkspacePanelId}
					onPanelDragEnd={() => setDraggedWorkspacePanelId(null)}
					onPanelMove={moveWorkspacePanel}
					onTogglePanel={toggleWorkspacePanel}
					projectBinEffectivelyOpen={projectBinEffectivelyOpen}
					blocked={blocked}
				/>
				</div>}
				<WorkspacePanelDock
					dock="right"
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					locale={locale}
					fileService={fileService}
					playbackMeterSettings={playbackMeterSettings}
					run={run}
					showArmControls={showArmControls}
					displayAudioSupported={displayAudioSupported}
					onOpenEffects={openEffects}
					effectsPanelTarget={effectsPanelTarget}
					onEffectWindowChange={setEffectWindow}
					draggedPanelId={draggedWorkspacePanelId}
					onPanelDragStart={setDraggedWorkspacePanelId}
					onPanelDragEnd={() => setDraggedWorkspacePanelId(null)}
					onPanelMove={moveWorkspacePanel}
					onTogglePanel={toggleWorkspacePanel}
					projectBinEffectivelyOpen={projectBinEffectivelyOpen}
					blocked={blocked}
				/>
				{uiFlags.masterTrack
					&& toolbarButtonPreferences['playback-volume'] !== false
					&& playbackMeterSettings.position === 'side'
					&& <SidePlaybackMeter
						controller={controller}
						copy={copy}
						project={project}
						settings={playbackMeterSettings}
						onSettingsChange={setPlaybackMeterSettings}
						clippingEnabled={uiFlags.clipping}
						run={run}
					/>}
				{toolbarButtonPreferences.monitor !== false
					&& recordingMeterSettings.position === 'side'
					&& <SideRecordingMeter
						controller={controller}
						copy={copy}
						snapshot={snapshot}
						settings={recordingMeterSettings}
						onSettingsChange={setRecordingMeterSettings}
						run={run}
					/>}
				<WorkspacePanelDock
					dock="floating"
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					locale={locale}
					fileService={fileService}
					playbackMeterSettings={playbackMeterSettings}
					run={run}
					showArmControls={showArmControls}
					displayAudioSupported={displayAudioSupported}
					onOpenEffects={openEffects}
					effectsPanelTarget={effectsPanelTarget}
					onEffectWindowChange={setEffectWindow}
					draggedPanelId={draggedWorkspacePanelId}
					onPanelDragStart={setDraggedWorkspacePanelId}
					onPanelDragEnd={() => setDraggedWorkspacePanelId(null)}
					onPanelMove={moveWorkspacePanel}
					onTogglePanel={toggleWorkspacePanel}
					projectBinEffectivelyOpen={projectBinEffectivelyOpen}
					blocked={blocked}
				/>
				<div
					className={`kw-audio-editor__workspace-drop-targets${draggedWorkspacePanelId ? ' kw-audio-editor__workspace-drop-targets--active' : ''}`}
					data-workspace-drop-targets
					aria-hidden={draggedWorkspacePanelId ? undefined : 'true'}
				>
						{WORKSPACE_DOCK_IDS.map((dockId) => (
							<div
								key={dockId}
								className={`kw-audio-editor__workspace-drop-target kw-audio-editor__workspace-drop-target--${dockId}`}
								data-workspace-drop-target={dockId}
								onDragOver={(event) => {
									event.preventDefault();
									event.dataTransfer.dropEffect = 'move';
								}}
								onDrop={(event) => {
									if (!draggedWorkspacePanelId) return;
									event.preventDefault();
									moveWorkspacePanel(draggedWorkspacePanelId, dockId, Number.MAX_SAFE_INTEGER);
								}}
							>{workspaceDockLabel(copy, dockId)}</div>
						))}
				</div>

			</div>

			{effectWindow && (
				<div data-effects-window-host>
					<React.Suspense fallback={null}>
						<AudioEditorEffectsOverlay
							isOpen
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							locale={locale}
							fileService={fileService}
							trackId={effectWindow.trackId}
							scope={effectWindow.scope}
							selectedEffect={effectWindow.selectedEffect}
							onSelectedEffectChange={(selectedEffect) => setEffectWindow(selectedEffect
								? { ...effectWindow, selectedEffect }
								: null)}
							renderRack={false}
						/>
					</React.Suspense>
				</div>
			)}

			{toolbarDock === 'bottom' && <div className="kw-audio-editor__toolbars" data-toolbar-dock="bottom">{editorToolbar}</div>}
			{toolbarDock === 'floating' && <div
				ref={floatingToolbarRef}
				className="kw-audio-editor__floating-toolbar"
				data-toolbar-dock="floating"
				style={{
					left: `${toolbarDragRef.current?.dock === 'floating' ? toolbarDragRef.current.x : floatingToolbarPosition.x}px`,
					top: `${toolbarDragRef.current?.dock === 'floating' ? toolbarDragRef.current.y : floatingToolbarPosition.y}px`,
				}}
			>{editorToolbar}</div>}

			{(uiFlags.selectionToolbar || uiFlags.statusbar) && <AccessibleSelectionToolbar
				controller={controller}
				snapshot={snapshot}
				copy={copy}
				statusMessage={statusMessage}
				statusState={statusState}
				durationFrames={durationFrames}
				disabled={editBlocked}
				showSelectionToolbar={uiFlags.selectionToolbar}
				showStatusbar={uiFlags.statusbar}
				run={run}
			/>}

			{activeSurface === 'clip' && (
				<div data-editor-surface="clip">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<ClipPropertiesDialog
							isOpen
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{activeSurface === 'selection-effect' && (
				<div data-editor-surface="selection-effect">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<SelectionEffectsDialog
							isOpen
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							locale={locale}
							fileService={fileService}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{activeSurface === 'macro-manager' && (
				<div data-editor-surface="macro-manager">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<AudioEditorMacroManagerDialog
							isOpen
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							locale={locale}
							fileService={fileService}
							draft={macroDraft}
							onDraftChange={setMacroDraft}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{activeSurface === 'spectral-selection' && (
				<div data-editor-surface="spectral-selection">
					<SpectralSelectionDialog
						isOpen
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						run={run}
						onClose={() => setActiveSurface(null)}
					/>
				</div>
			)}
			{activeSurface === 'generator' && (
				<div data-editor-surface="generator">
					<GeneratorDialog
						isOpen
						type={generatorType}
						controller={controller}
						copy={copy}
						locale={locale}
						run={run}
						onClose={() => setActiveSurface(null)}
					/>
				</div>
			)}
			{activeSurface === 'nyquist' && (
				<div data-editor-surface="nyquist">
					<NyquistDialog
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						target={nyquistTarget}
						run={run}
						onClose={closeNyquist}
					/>
				</div>
			)}
			{activeSurface === 'export' && (
				<div data-editor-surface="export">
					<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
						<ExportDialog
							isOpen
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							locale={locale}
							onClose={() => setActiveSurface(null)}
						/>
					</React.Suspense>
				</div>
			)}
			{activeSurface === 'preferences' && (
				<div data-editor-surface="preferences">
					<WorkspacePreferencesDialog
						isOpen
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						locale={locale}
						fileService={fileService}
						menus={applicationMenus}
						run={run}
						initialPage={preferencesPage}
						isPanelVisible={(panelId) => (
							panelId === 'project-bin'
								? projectBinEffectivelyOpen
								: preferences.workspace.panels[panelId]?.visible === true
						)}
						onTogglePanel={toggleWorkspacePanel}
						onClose={() => setActiveSurface(null)}
					/>
				</div>
			)}

			{dialog && (
				<EditorDialog
					type={dialog}
					value={dialogValue}
					onValueChange={setDialogValue}
					sourceKey={dialogSourceKey}
					onSourceKeyChange={setDialogSourceKey}
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					locale={locale}
					run={run}
					showArmControls={showArmControls}
					onClose={() => setDialog(null)}
				/>
			)}
			<AudioEditorButtonTooltips rootRef={editorRef} />
		</div>
	);
}

function ProjectTabs({ projects, activeProjectId, copy, disabled, onSelect, onNew }) {
	const unique = [];
	const seen = new Set();
	for (const project of projects || []) {
		if (!project?.id || seen.has(project.id)) continue;
		seen.add(project.id);
		unique.push(project);
	}
	return (
		<nav className="kw-audio-editor__project-tabs" aria-label={copy.projectTabs}>
			<div role="tablist" aria-label={copy.projectTabs}>
				{unique.map((project) => <button
					key={project.id}
					type="button"
					role="tab"
					aria-selected={project.id === activeProjectId}
					disabled={disabled}
					onClick={() => onSelect(project.id)}
				>{project.title}</button>)}
			</div>
			<button type="button" className="kw-audio-editor__project-tab-new" disabled={disabled} onClick={onNew} aria-label={copy.newProject}>+</button>
		</nav>
	);
}

function EditorToolToolbar({
	controller,
	snapshot,
	locale,
	copy,
	isCompact,
	blocked,
	selectionActive,
	durationFrames,
	editItems,
	executeEdit,
	recordLabel,
	toggleRecording,
	run,
	toolbars,
	toolbarButtons,
	uiFlags,
	playbackMeterSettings,
	onPlaybackMeterSettingsChange,
	recordingMeterSettings,
	onRecordingMeterSettingsChange,
	automationToolEnabled,
	onToggleAutomationTool,
	actionRuntime,
	onOpenSpectralSelection,
	onOpenRecordingOffset,
	onOpenTimedRecording,
	onJumpToStart,
	onJumpToEnd,
	onGripperMouseDown,
}) {
	const positionFrame = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.positionFrame || 0);
	const transportState = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.transportState);
	const playbackMode = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.playbackMode);
	const masterMeter = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.meters?.master);
	const telemetry = { playbackMode, positionFrame, transportState };
	const project = snapshot.project;
	const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId && track.type === 'audio');
	const spectralTrackSelected = Boolean(selectedTrack && (
		selectedTrack.displayMode === 'spectrogram'
		|| selectedTrack.displayMode === 'multiview'
		|| snapshot.timeline?.view === 'spectrogram'
	));
	const spectralBrushReason = audacityActionReason('spectral-brush', copy);
	const recordControlLabel = snapshot.readOnly
		? `${recordLabel} — ${copy.projectReadOnly}`
		: recordLabel;
	const toolbarSettingsTriggerRef = useRef(null);
	const [toolbarSettingsPosition, setToolbarSettingsPosition] = useState(null);
	const setToolbarSettingsTrigger = useCallback((element) => {
		toolbarSettingsTriggerRef.current = element?.querySelector('button') || null;
	}, []);
	const isToolbarButtonVisible = (buttonId) => toolbarButtons?.[buttonId] !== false;
	const visibleEditItems = editItems.filter((item) => isToolbarButtonVisible(item.action));
	const showMusicalTiming = snapshot.preferences?.workspace?.activeId === 'music';
	const transportButtonsVisible = ['play', 'stop', 'record', 'jump-start', 'jump-end', 'loop']
		.some(isToolbarButtonVisible);
	const viewButtonsVisible = ['split-tool', 'volume-automation', 'spectrogram-view', 'spectral-box-select', 'spectral-brush']
		.some(isToolbarButtonVisible);
	const zoomButtonsVisible = ['zoom-in', 'zoom-out', 'zoom-fit'].some(isToolbarButtonVisible);
	const toolbarButtonOptions = [
		{ id: 'play', label: copy.play, icon: 'play' },
		{ id: 'stop', label: copy.stop, icon: 'stop' },
		{ id: 'record', label: recordLabel, icon: 'record' },
		{ id: 'jump-start', label: copy.jumpStart, icon: 'skip-back' },
		{ id: 'jump-end', label: copy.jumpEnd, icon: 'skip-forward' },
		{ id: 'loop', label: copy.loop, icon: 'loop' },
		{ id: 'split-tool', label: copy.splitTool, icon: 'split' },
		{ id: 'volume-automation', label: copy.clipGain, icon: 'automation' },
		{ id: 'spectrogram-view', label: copy.spectrogramView, icon: 'spectrogram' },
		{ id: 'spectral-box-select', label: copy.spectralBoxSelect, icon: 'spectrogram' },
		{ id: 'spectral-brush', label: copy.spectralBrush, icon: 'brush' },
		{ id: 'zoom-in', label: copy.zoomIn, icon: 'zoom-in' },
		{ id: 'zoom-out', label: copy.zoomOut, icon: 'zoom-out' },
		{ id: 'zoom-fit', label: copy.zoomFit, icon: 'zoom-to-fit' },
		...editItems.map((item) => ({ id: item.action, label: item.label, icon: item.icon })),
		{ id: 'time-display', label: copy.playhead, icon: 'playhead' },
		{ id: 'monitor', label: copy.recordLevel, icon: iconNameToChar('MICROPHONE') },
		{ id: 'playback-volume', label: copy.playbackVolume, icon: iconNameToChar('AUDIO') },
	];
	const openToolbarSettings = () => {
		const rect = toolbarSettingsTriggerRef.current?.getBoundingClientRect();
		if (!rect) return;
		setToolbarSettingsPosition({ x: rect.left + rect.width / 2, y: rect.bottom });
	};
	const toolbarSectionProps = (toolbarId) => ({
		toolbarId,
		order: toolbars[toolbarId]?.order ?? WORKSPACE_TOOLBAR_IDS.indexOf(toolbarId),
	});
	return (
		<div
			data-editor-tool-toolbar
			onKeyDownCapture={handleEditorToolbarKeyDown}
			onFocusCapture={handleEditorToolbarFocus}
			onBlurCapture={handleEditorToolbarBlur}
		>
			<Toolbar
				height={48}
				className="kw-audio-editor__tool-toolbar"
				enableTabGroup
				tabGroupId="tool-toolbar"
				showGripper
				onGripperMouseDown={onGripperMouseDown}
				rightContent={(
					<ToolbarButtonGroup className="kw-audio-editor__toolbar-settings-trigger" gap={2}>
						<span ref={setToolbarSettingsTrigger}>
							<ToolButton icon="cog" ariaLabel={copy.toolbarCustomize} onClick={openToolbarSettings} />
						</span>
					</ToolbarButtonGroup>
				)}
			>
				{[
				transportButtonsVisible && <WorkspaceToolbarSection key="transport" {...toolbarSectionProps('transport')}>
				<ToolbarButtonGroup className="kw-audio-editor__transport" gap={2}>
					{isToolbarButtonVisible('play') && <AudioEditorSplitButton
						icon={telemetry.transportState === 'playing' ? 'pause' : 'play'}
						className="kw-audio-editor__transport-play kw-audio-editor__transport-play-split"
						ariaLabel={telemetry.transportState === 'playing' ? copy.pause : copy.play}
						disabled={blocked && !snapshot.recording}
						active={telemetry.transportState === 'playing'}
						pressed={telemetry.transportState === 'playing'}
						onClick={() => run(() => controller.actions.transport.playPause())}
					>
						{({ close }) => <PlaySpeedFlyout copy={copy} snapshot={snapshot} telemetry={telemetry} blocked={blocked} controller={controller} run={run} close={close} />}
					</AudioEditorSplitButton>}
					{isToolbarButtonVisible('stop') && <TransportButton icon="stop" ariaLabel={copy.stop} onClick={() => run(() => controller.actions.transport.stop())} />}
					{isToolbarButtonVisible('record') && <span data-transport="record">
						<AudioEditorSplitButton
							icon="record"
							className="kw-audio-editor__transport-record kw-audio-editor__transport-record-split"
							ariaLabel={recordControlLabel}
							optionsLabel={copy.recordMenu}
							recording={snapshot.recording}
							pressed={Boolean(snapshot.recording)}
							disabled={snapshot.readOnly || snapshot.importing || snapshot.exporting || snapshot.transportState === 'playing' || snapshot.recordingScheduling || snapshot.scheduledRecording}
							onClick={toggleRecording}
						>
							{({ close }) => <RecordFlyout
								copy={copy}
								snapshot={snapshot}
								controller={controller}
								recordLabel={recordLabel}
								toggleRecording={toggleRecording}
								run={run}
								onOpenRecordingOffset={onOpenRecordingOffset}
								onOpenTimedRecording={onOpenTimedRecording}
								onClose={close}
							/>}
						</AudioEditorSplitButton>
					</span>
					}
					{isToolbarButtonVisible('jump-start') && <TransportButton icon="skip-back" ariaLabel={copy.jumpStart} disabled={blocked} onClick={onJumpToStart} />}
					{isToolbarButtonVisible('jump-end') && <TransportButton icon="skip-forward" ariaLabel={copy.jumpEnd} disabled={blocked} onClick={onJumpToEnd} />}
					{isToolbarButtonVisible('loop') && <AccessibleTransportButton
						icon="loop"
						ariaLabel={copy.loop}
						active={Boolean(project?.loop?.enabled)}
						pressed={Boolean(project?.loop?.enabled)}
						disabled={blocked}
						onClick={() => run(() => controller.actions.transport.toggleLoop())}
					/>
					}
				</ToolbarButtonGroup>
				</WorkspaceToolbarSection>,

				<WorkspaceToolbarSection key="tools" {...toolbarSectionProps('tools')}>
				{viewButtonsVisible && <ToolbarDivider />}
				{viewButtonsVisible && <ToolbarButtonGroup className="kw-audio-editor__view-actions" gap={2}>
					{isToolbarButtonVisible('split-tool') && <span data-action-id="split-tool">
						<ToggleToolButton
							icon="split"
							isActive={uiFlags.splitTool}
							ariaLabel={copy.splitTool}
							onClick={() => {
								if (automationToolEnabled) onToggleAutomationTool();
								actionRuntime.tools.toggleSplitTool();
							}}
						/>
					</span>
					}
					{isToolbarButtonVisible('volume-automation') && <span data-action-id="volume-automation">
						<ToggleToolButton
							icon="automation"
							isActive={automationToolEnabled}
							ariaLabel={copy.clipGain}
							disabled={!selectedTrack || blocked}
							onClick={onToggleAutomationTool}
						/>
					</span>
					}
					{isToolbarButtonVisible('spectrogram-view') && <AudioEditorSplitButton
						icon="spectrogram"
						toggle
						pressed={snapshot.timeline?.view === 'spectrogram'}
						ariaLabel={copy.spectrogramView}
						onClick={() => run(() => controller.actions.timeline.setAllTracksView(snapshot.timeline?.view === 'spectrogram' ? 'waveform' : 'spectrogram'))}
					>
						{({ close }) => <div className="kw-audio-editor__split-button-options kw-audio-editor__spectrogram-tool-options">
							{isToolbarButtonVisible('spectral-box-select') && <span data-action-id="spectral-box-select">
								<ContextMenuItem
									label={copy.spectralBoxSelect}
									disabled={!spectralTrackSelected}
									onClick={() => {
										close();
										onOpenSpectralSelection();
									}}
								/>
							</span>}
							{isToolbarButtonVisible('spectral-brush') && <span
								data-action-id="spectral-brush"
								data-disabled-reason={spectralBrushReason}
								aria-disabled="true"
								title={spectralBrushReason}
							>
								<ContextMenuItem label={`${copy.spectralBrush}: ${spectralBrushReason}`} disabled />
							</span>}
						</div>}
					</AudioEditorSplitButton>}
				</ToolbarButtonGroup>
				}

				{zoomButtonsVisible && <ToolbarButtonGroup className="kw-audio-editor__zoom-actions" gap={2}>
					{isToolbarButtonVisible('zoom-in') && <ToolButton icon="zoom-in" ariaLabel={copy.zoomIn} onClick={() => run(() => controller.actions.timeline.zoomIn())} />}
					{isToolbarButtonVisible('zoom-out') && <ToolButton icon="zoom-out" ariaLabel={copy.zoomOut} onClick={() => run(() => controller.actions.timeline.zoomOut())} />}
					{isToolbarButtonVisible('zoom-fit') && <ToolButton icon="zoom-to-fit" ariaLabel={copy.zoomFit} onClick={() => run(() => controller.actions.timeline.zoomFit())} />}
				</ToolbarButtonGroup>
				}
				</WorkspaceToolbarSection>,

				visibleEditItems.length > 0 && <WorkspaceToolbarSection key="edit" {...toolbarSectionProps('edit')}>
				<ToolbarButtonGroup className="kw-audio-editor__edit-actions" gap={2}>
					{visibleEditItems.map((item) => (
						<span key={item.action} data-edit={item.action === 'rippleDelete' ? 'ripple-delete' : item.action}>
							<ToolButton icon={item.icon} ariaLabel={item.label} disabled={item.disabled} onClick={() => executeEdit(item.action)} />
						</span>
					))}
				</ToolbarButtonGroup>
				</WorkspaceToolbarSection>,

				<WorkspaceToolbarSection key="meter" {...toolbarSectionProps('meter')}>
				{isToolbarButtonVisible('time-display') && <div className="kw-audio-editor__timecode" data-time-display>
					<AccessibleTimeCode
						ariaLabel={`${copy.playhead}: ${copy.format}`}
						value={framesToSeconds(telemetry.positionFrame || 0, { sampleRate: project?.sampleRate })}
						sampleRate={project?.sampleRate || 48_000}
						showFormatSelector={!isCompact}
						disabled={snapshot.recording}
						onChange={(seconds) => run(() => controller.actions.transport.seek(secondsToFrames(seconds, { maximumFrame: durationFrames, sampleRate: project?.sampleRate })))}
					/>
				</div>}
				{showMusicalTiming && <label className="kw-audio-editor__tempo-control" data-action-id="playback-bpm">
					<span>{copy.projectTempo}</span>
					<input
						type="number"
						min="1"
						max="1000"
						step="0.01"
						value={project?.tempo?.bpm || 120}
						disabled={snapshot.readOnly || snapshot.recording}
						onChange={(event) => {
							const bpm = Number(event.currentTarget.value);
							if (Number.isFinite(bpm) && bpm >= 1) run(() => controller.actions.project.setTempo(bpm));
						}}
					/>
				</label>}
				{showMusicalTiming && <label className="kw-audio-editor__signature-control" data-action-id="playback-time-signature">
					<span>{copy.timeSignature}</span>
					<span className="kw-audio-editor__signature-fields">
						<input
							type="number"
							min="1"
							max="32"
							aria-label={`${copy.timeSignature}: ${copy.numerator}`}
							value={project?.tempo?.timeSignature?.numerator || 4}
							disabled={snapshot.readOnly || snapshot.recording}
							onChange={(event) => run(() => controller.actions.project.setTimeSignature(Number(event.currentTarget.value), project?.tempo?.timeSignature?.denominator || 4))}
						/>
						<span aria-hidden="true">/</span>
						<input
							type="number"
							min="1"
							max="32"
							aria-label={`${copy.timeSignature}: ${copy.denominator}`}
							value={project?.tempo?.timeSignature?.denominator || 4}
							disabled={snapshot.readOnly || snapshot.recording}
							onChange={(event) => run(() => controller.actions.project.setTimeSignature(project?.tempo?.timeSignature?.numerator || 4, Number(event.currentTarget.value)))}
						/>
					</span>
				</label>}

				{isToolbarButtonVisible('monitor') && recordingMeterSettings.position !== 'side' && <RecordingMeterToolbarGroup
					copy={copy}
					snapshot={snapshot}
					controller={controller}
					run={run}
					settings={recordingMeterSettings}
					onSettingsChange={onRecordingMeterSettingsChange}
				/>}

				{uiFlags.masterTrack
					&& isToolbarButtonVisible('playback-volume')
					&& playbackMeterSettings.position !== 'side'
					&& <ToolbarButtonGroup className="kw-audio-editor__playback-meter" gap={6}>
					<AudacityToolbarFlyoutButton
						icon={iconNameToChar('AUDIO')}
						ariaLabel={copy.playbackMeterSettings}
						flyoutClassName="kw-audio-editor__playback-meter-flyout"
					>
						<MeterSettingsFlyout
							copy={copy}
							settings={playbackMeterSettings}
							onChange={onPlaybackMeterSettingsChange}
						/>
					</AudacityToolbarFlyoutButton>
					{playbackMeterSettings.position === 'top' && <AudacityAudioMeter
						copy={copy}
						meter={masterMeter}
						settings={playbackMeterSettings}
						orientation="horizontal"
						clipped={uiFlags.clipping && (masterMeter?.peak || 0) >= 1}
						slider={playbackMeterSlider(
							copy,
							Math.min(1, project?.master?.gain ?? 1),
							playbackMeterSettings,
							(gain) => run(() => controller.actions.effects.setMasterGain(gain)),
						)}
						compact={isCompact}
					/>}
				</ToolbarButtonGroup>}
				</WorkspaceToolbarSection>,
				].filter(Boolean).sort((left, right) => left.props.order - right.props.order)}
			</Toolbar>
			<Flyout
				isOpen={Boolean(toolbarSettingsPosition)}
				onClose={() => setToolbarSettingsPosition(null)}
				x={toolbarSettingsPosition?.x || 0}
				y={toolbarSettingsPosition?.y || 0}
				direction="down"
				triggerRef={toolbarSettingsTriggerRef}
				ariaLabel={copy.toolbarCustomize}
				role="dialog"
				className="kw-audio-editor__toolbar-settings"
			>
				<div className="kw-audio-editor__toolbar-settings-content">
					<strong>{copy.toolbarButtons}</strong>
					<div className="kw-audio-editor__toolbar-settings-list">
						{toolbarButtonOptions.map((button) => <div key={button.id} className="kw-audio-editor__toolbar-settings-option">
							<span aria-hidden="true">
								{button.icon.length === 1
									? <span className="musescore-icon">{button.icon}</span>
									: <Icon name={button.icon} size={16} />}
							</span>
							<PreferenceCheckbox
								label={button.label}
								checked={isToolbarButtonVisible(button.id)}
								onChange={(visible) => run(() => controller.actions.preferences.setToolbarButton(button.id, visible))}
							/>
						</div>)}
					</div>
				</div>
			</Flyout>
		</div>
	);
}

function WorkspaceToolbarSection({
	toolbarId,
	children,
}) {
	return (
		<div
			className="kw-audio-editor__workspace-toolbar"
			data-workspace-toolbar={toolbarId}
		>
			{children}
		</div>
	);
}

// Browser adaptations of Audacity's RecordLevel.qml/RecordLevelPopup.qml and
// PlaybackLevel.qml/PlaybackMeterCustomisePopup.qml at eee7be71d602bfd852d6d30e58b70a8ab43ed28f.
function AudacityToolbarFlyoutButton({
	icon,
	ariaLabel,
	flyoutClassName,
	children,
}) {
	const triggerRef = useRef(null);
	const [position, setPosition] = useState(null);
	const setTrigger = useCallback((element) => {
		triggerRef.current = element?.querySelector('button') || null;
	}, []);
	const close = useCallback(() => setPosition(null), []);
	const toggle = (event) => {
		if (position) {
			close();
			return;
		}
		const rect = triggerRef.current?.getBoundingClientRect();
		if (!rect) return;
		setPosition({
			x: rect.left + rect.width / 2,
			y: rect.bottom,
			direction: window.innerHeight - rect.bottom >= 320 ? 'down' : 'up',
			autoFocus: event.nativeEvent?.detail === 0,
		});
	};

	useEffect(() => {
		triggerRef.current?.setAttribute('aria-expanded', String(Boolean(position)));
	}, [position]);

	return (
		<>
			<span ref={setTrigger} className="kw-audio-editor__audacity-level-trigger">
				<button
					type="button"
					className="tool-button tool-button--default tool-button--idle kw-audio-editor__audacity-level-button"
					aria-label={ariaLabel}
					aria-expanded={Boolean(position)}
					onClick={toggle}
				>
					<span className="musescore-icon tool-button__icon" aria-hidden="true">{icon}</span>
				</button>
			</span>
			<Flyout
				isOpen={Boolean(position)}
				onClose={close}
				x={position?.x || 0}
				y={position?.y || 0}
				direction={position?.direction || 'down'}
				autoFocus={Boolean(position?.autoFocus)}
				triggerRef={triggerRef}
				showArrow
				closeOnOutsideClick
				closeOnEscape
				ariaLabel={ariaLabel}
				role="dialog"
				className={`kw-audio-editor__audacity-level-flyout ${flyoutClassName}`}
			>
				{children}
			</Flyout>
		</>
	);
}

function useRecordingMeter(controller) {
	return useAudioEditorTelemetrySelector(
		controller,
		(telemetry) => telemetry.inputMeter
			|| Math.max(-60, Math.min(0, telemetry.inputMeterDb ?? -60)),
	);
}

function recordingMeterData(dbfs) {
	const peak = dbfs <= -60 ? 0 : 10 ** (dbfs / 20);
	return { dbfs, peak, rms: peak };
}

function recordingMeterChannelCount(snapshot) {
	return snapshot.recordingInputs?.routes?.[snapshot.selectedTrackId]?.channelCount === 2 ? 2 : 1;
}

function recordingMeterSlider(copy, snapshot, controller, run) {
	const inputGain = snapshot.recordingOptions?.inputGain ?? 1;
	const inputGainDb = Math.max(-60, Math.min(6, inputGain > 0 ? 20 * Math.log10(inputGain) : -60));
	return {
		minimum: -60,
		maximum: 6,
		step: 0.1,
		value: inputGainDb,
		label: copy.recordLevel,
		valueText: formatDb(inputGainDb),
		onChange: (value) => run(() => controller.actions.recording.setLevel(value <= -60 ? 0 : 10 ** (value / 20))),
	};
}

function playbackMeterSlider(copy, volume, settings, onChange) {
	const range = settings.type === 'amplitude' ? 60 : settings.dbRange;
	const position = playbackMeterPercent(
		playbackMeterAmplitudeToDb(volume, range),
		settings.type,
		range,
	) / 100;
	const valueText = settings.type === 'amplitude'
		? volume.toFixed(2)
		: volume <= 0
			? '−∞ dB'
			: `${String(Math.round(playbackMeterAmplitudeToDb(volume, range) * 10) / 10).replace('-', '−')} dB`;
	return {
		minimum: 0,
		maximum: 1,
		step: 0.001,
		value: position,
		label: copy.playbackVolume,
		valueText,
		onChange: (nextPosition) => onChange(playbackMeterGainFromPosition(nextPosition, settings.type, range)),
	};
}

function RecordingMeterToolbarGroup({
	copy,
	snapshot,
	controller,
	run,
	settings,
	onSettingsChange,
}) {
	const meterValue = useRecordingMeter(controller);
	const meter = typeof meterValue === 'number' ? recordingMeterData(meterValue) : meterValue;
	const meterVisible = Boolean(snapshot.recording || snapshot.monitor?.metering);
	const slider = recordingMeterSlider(copy, snapshot, controller, run);

	return (
		<ToolbarButtonGroup className="kw-audio-editor__recording-meter" gap={4}>
			<AudacityToolbarFlyoutButton
				icon={iconNameToChar('MICROPHONE')}
				ariaLabel={copy.recordLevel}
				flyoutClassName="kw-audio-editor__microphone-level-flyout"
			>
				<RecordingMeterFlyout
					copy={copy}
					snapshot={snapshot}
					meter={meter}
					controller={controller}
					run={run}
					settings={settings}
					onSettingsChange={onSettingsChange}
				/>
			</AudacityToolbarFlyoutButton>
			{meterVisible && settings.position === 'flyout' && <AudacityAudioMeter
				copy={copy}
				meter={meter}
				settings={settings}
				orientation="horizontal"
				channelCount={recordingMeterChannelCount(snapshot)}
				meterLabel={copy.inputLevel}
				meterKind="recording"
				compact
				className="kw-audio-editor__idle-input-meter"
				dataMeterAttribute="idle-input-meter"
			/>}
			{settings.position === 'top' && <AudacityAudioMeter
				copy={copy}
				meter={meter}
				settings={settings}
				orientation="horizontal"
				channelCount={recordingMeterChannelCount(snapshot)}
				meterLabel={copy.inputLevel}
				meterKind="recording"
				slider={slider}
			/>}
		</ToolbarButtonGroup>
	);
}

function RecordingMeterFlyout({
	copy,
	snapshot,
	meter,
	controller,
	run,
	settings,
	onSettingsChange,
}) {
	const slider = recordingMeterSlider(copy, snapshot, controller, run);

	return (
		<div className="kw-audio-editor__microphone-level-content" data-microphone-level-flyout>
			<strong>{copy.microphoneLevel}</strong>
			{settings.position === 'flyout' && <AudacityAudioMeter
				copy={copy}
				meter={meter}
				settings={settings}
				orientation="horizontal"
				channelCount={recordingMeterChannelCount(snapshot)}
				meterLabel={copy.inputLevel}
				meterKind="recording"
				dataMeterAttribute="input-meter"
				slider={slider}
			/>}
			<p>{copy.microphoneLevelNote}</p>
			<Separator />
			<MeterSettingsFlyout
				copy={copy}
				settings={settings}
				onChange={onSettingsChange}
				meterKind="recording"
				recordingOptions={(
					<>
						<PreferenceCheckbox
							label={copy.inputMonitoringDetailed}
							checked={Boolean(snapshot.monitor?.enabled)}
							onChange={(enabled) => run(() => controller.actions.recording.setMonitoring(enabled))}
						/>
						<PreferenceCheckbox
							label={copy.microphoneMeteringInactive}
							checked={Boolean(snapshot.monitor?.metering)}
							onChange={(enabled) => run(() => controller.actions.recording.setMetering(enabled))}
						/>
					</>
				)}
			/>
		</div>
	);
}

function AudioDevicesFlyout({
	copy,
	snapshot,
	controller,
	run,
}) {
	const devices = snapshot.audioDevices || {};
	const inputs = Array.isArray(devices.inputs) ? devices.inputs : [];
	const outputs = Array.isArray(devices.outputs) ? devices.outputs : [];
	const preferredInput = devices.preferredInputDeviceId || 'default';
	const preferredInputChannelCount = devices.preferredInputChannelCount === 2 ? 2 : 1;
	const displayInputSelected = preferredInput === 'display';
	const preferredOutput = devices.preferredOutputDeviceId || '';
	const selectedInput = inputs.find((device) => device.deviceId === preferredInput);
	const stereoUnavailable = Number(selectedInput?.channelCount) === 1;
	const missingInput = preferredInput === 'display'
		? !devices.displayInputSupported
		: preferredInput !== 'default' && !inputs.some((device) => device.deviceId === preferredInput);
	const missingOutput = Boolean(preferredOutput)
		&& !outputs.some((device) => device.deviceId === preferredOutput);
	const outputMessage = devices.outputStatus === 'unavailable'
		? copy.audioDeviceOutputUnavailable
		: devices.outputStatus === 'denied'
			? copy.audioDeviceOutputDenied
			: !devices.outputSupported
				? copy.audioDeviceOutputUnsupported
				: '';

	return (
		<div className="kw-audio-editor__audio-devices-content" data-audio-devices-flyout>
			<strong>{copy.audioDevices}</strong>
			<label>
				<span>{copy.audioInputDevice}</span>
				<select
					aria-label={copy.audioInputDevice}
					value={preferredInput}
					disabled={!devices.inputSupported}
					onChange={(event) => run(() => controller.actions.audioDevices.setPreferredInput(event.currentTarget.value))}
				>
					<option value="default">{copy.audioDeviceSystemDefault}</option>
					{missingInput && <option value={preferredInput}>{copy.audioDevicePreferredUnavailable}</option>}
					{inputs
						.filter((device) => device.deviceId !== 'default')
						.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
					{devices.displayInputSupported && <option value="display">{copy.recordingDesktopAudio}</option>}
				</select>
			</label>
			{!displayInputSelected && !devices.inputAccess && devices.microphoneInputSupported && (
				<p className="kw-audio-editor__audio-devices-note">{copy.audioDeviceInputAccessRequired}</p>
			)}
			{displayInputSelected && (
				<Button
					variant="secondary"
					onClick={() => run(() => controller.actions.audioDevices.configureDisplayInput())}
				>
					{devices.displayCaptureOpen ? copy.audioDeviceChangeDisplaySource : copy.audioDeviceChooseDisplaySource}
				</Button>
			)}
			<fieldset
				className="kw-audio-editor__audio-device-channels"
				role="radiogroup"
				aria-label={copy.audioDeviceRecordingChannels}
			>
				<legend>{copy.audioDeviceRecordingChannels}</legend>
				<label>
					<input
						type="radio"
						name="audio-device-recording-channels"
						value="1"
						checked={preferredInputChannelCount === 1}
						onChange={() => run(() => controller.actions.audioDevices.setPreferredInputChannelCount(1))}
					/>
					<span>{copy.mono}</span>
				</label>
				<label>
					<input
						type="radio"
						name="audio-device-recording-channels"
						value="2"
						checked={preferredInputChannelCount === 2}
						disabled={stereoUnavailable}
						onChange={() => run(() => controller.actions.audioDevices.setPreferredInputChannelCount(2))}
					/>
					<span>{copy.stereo}</span>
				</label>
			</fieldset>
			<p className="kw-audio-editor__audio-devices-note">{copy.audioDeviceRecordingChannelsNote}</p>
			<label>
				<span>{copy.audioOutputDevice}</span>
				<select
					aria-label={copy.audioOutputDevice}
					value={preferredOutput}
					disabled={!devices.outputSupported}
					onChange={(event) => run(() => controller.actions.audioDevices.setOutput(event.currentTarget.value))}
				>
					<option value="">{copy.audioDeviceSystemDefault}</option>
					{missingOutput && <option value={preferredOutput}>{copy.audioDevicePreferredUnavailable}</option>}
					{outputs.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}
				</select>
			</label>
			{outputMessage && <p className="kw-audio-editor__audio-devices-note" role="status">{outputMessage}</p>}
			<div className="kw-audio-editor__audio-devices-actions">
				{!displayInputSelected && !devices.inputAccess && devices.microphoneInputSupported && (
					<Button variant="secondary" onClick={() => run(() => controller.actions.audioDevices.requestAccess())}>
						{copy.audioDeviceAllowAccess}
					</Button>
				)}
				<Button variant="secondary" onClick={() => run(() => controller.actions.audioDevices.refresh())}>
					{copy.audioDeviceRefresh}
				</Button>
			</div>
		</div>
	);
}

function SidePlaybackMeter({
	controller,
	copy,
	project,
	settings,
	onSettingsChange,
	clippingEnabled,
	run,
}) {
	const masterMeter = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.meters?.master);
	return (
		<aside
			className="kw-audio-editor__side-playback-meter"
			data-side-playback-meter
			aria-label={copy.playbackMeterSettings}
		>
			<AudacityToolbarFlyoutButton
				icon={iconNameToChar('AUDIO')}
				ariaLabel={copy.playbackMeterSettings}
				flyoutClassName="kw-audio-editor__playback-meter-flyout"
			>
				<MeterSettingsFlyout
					copy={copy}
					settings={settings}
					onChange={onSettingsChange}
				/>
			</AudacityToolbarFlyoutButton>
			<AudacityAudioMeter
				copy={copy}
				meter={masterMeter}
				settings={settings}
				orientation="vertical"
				clipped={clippingEnabled && (masterMeter?.peak || 0) >= 1}
				slider={playbackMeterSlider(
					copy,
					Math.min(1, project?.master?.gain ?? 1),
					settings,
					(gain) => run(() => controller.actions.effects.setMasterGain(gain)),
				)}
			/>
		</aside>
	);
}

function SideRecordingMeter({
	controller,
	copy,
	snapshot,
	settings,
	onSettingsChange,
	run,
}) {
	const meterValue = useRecordingMeter(controller);
	const meter = typeof meterValue === 'number' ? recordingMeterData(meterValue) : meterValue;
	const slider = recordingMeterSlider(copy, snapshot, controller, run);
	return (
		<aside
			className="kw-audio-editor__side-recording-meter"
			data-side-recording-meter
			aria-label={copy.recordLevel}
		>
			<AudacityToolbarFlyoutButton
				icon={iconNameToChar('MICROPHONE')}
				ariaLabel={copy.recordLevel}
				flyoutClassName="kw-audio-editor__microphone-level-flyout"
			>
				<RecordingMeterFlyout
					copy={copy}
					snapshot={snapshot}
					meter={meter}
					controller={controller}
					run={run}
					settings={settings}
					onSettingsChange={onSettingsChange}
				/>
			</AudacityToolbarFlyoutButton>
			<AudacityAudioMeter
				copy={copy}
				meter={meter}
				settings={settings}
				orientation="vertical"
				channelCount={recordingMeterChannelCount(snapshot)}
				meterLabel={copy.inputLevel}
				meterKind="recording"
				slider={slider}
			/>
		</aside>
	);
}

function AudacityAudioMeter({
	copy,
	meter,
	settings,
	orientation,
	clipped,
	slider,
	channelCount = 2,
	meterLabel,
	meterKind = 'playback',
	compact = false,
	className = '',
	dataMeterAttribute,
}) {
	const meterRef = useRef(null);
	const [meterSize, setMeterSize] = useState(orientation === 'vertical' ? 500 : 280);
	const isEbu = settings.type === 'ebu-r128';
	const loudness = meter?.loudness || {};
	const ebuBounds = ebuMeterBounds(settings.ebuScale);
	const liveLufs = settings.ebuLiveValue === 'short-term'
		? loudness.shortTermLufs
		: loudness.momentaryLufs;
	const range = settings.type === 'amplitude' ? 60 : settings.dbRange;
	const peakDb = Number.isFinite(meter?.dbfs)
		? meter.dbfs
		: playbackMeterAmplitudeToDb(meter?.peak, range);
	const rmsDb = playbackMeterAmplitudeToDb(meter?.rms, range);
	const peakPercent = isEbu
		? ebuMeterPercent(liveLufs, settings.ebuScale)
		: playbackMeterPercent(peakDb, settings.type, range);
	const rmsPercent = isEbu
		? peakPercent
		: Math.min(peakPercent, playbackMeterPercent(rmsDb, settings.type, range));
	const absoluteDisplayedValue = Math.max(
		ebuBounds.minimumLufs,
		Math.min(ebuBounds.maximumLufs, Number.isFinite(liveLufs) ? liveLufs : ebuBounds.minimumLufs),
	);
	const displayedValue = isEbu
		? settings.ebuUnit === 'relative' ? absoluteDisplayedValue + 23 : absoluteDisplayedValue
		: settings.type === 'amplitude'
			? Math.max(0, Math.min(1, Number(meter?.peak) || 0))
			: Math.max(-range, Math.min(0, peakDb));
	const ticks = isEbu
		? ebuMeterTicks(settings.ebuScale, settings.ebuUnit, meterSize)
		: playbackMeterTicks(settings.type, range, meterSize);
	const ebuMinimum = settings.ebuUnit === 'relative'
		? ebuBounds.minimumLufs + 23
		: ebuBounds.minimumLufs;
	const ebuMaximum = settings.ebuUnit === 'relative'
		? ebuBounds.maximumLufs + 23
		: ebuBounds.maximumLufs;
	const ebuUnit = settings.ebuUnit === 'relative' ? 'LU' : 'LUFS';
	const truePeakExceeded = Number.isFinite(loudness.maximumTruePeakDbtp)
		&& loudness.maximumTruePeakDbtp > -1;
	const style = {
		'--playback-meter-peak': `${peakPercent}%`,
		'--playback-meter-rms': `${rmsPercent}%`,
	};
	useEffect(() => {
		const element = meterRef.current;
		if (!element) return undefined;
		const update = () => {
			const rect = element.getBoundingClientRect();
			const length = orientation === 'vertical' ? rect.height : rect.width;
			const next = Math.max(0, Math.round(length - 22));
			setMeterSize((current) => current === next ? current : next);
		};
		update();
		if (typeof ResizeObserver !== 'function') return undefined;
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, [orientation]);
	return (
		<div
			ref={meterRef}
			className={`kw-audio-editor__master-meter kw-audio-editor__playback-meter-surface kw-audio-editor__playback-meter-surface--${orientation}${compact ? ' kw-audio-editor__playback-meter-surface--compact' : ''}${className ? ` ${className}` : ''}`}
			data-playback-meter={!meterLabel ? '' : undefined}
			data-audio-meter
			data-meter-kind={meterKind}
			data-input-meter={dataMeterAttribute === 'input-meter' ? '' : undefined}
			data-idle-input-meter={dataMeterAttribute === 'idle-input-meter' ? '' : undefined}
			data-meter-position={settings.position}
			data-meter-style={settings.style}
			data-meter-type={settings.type}
			data-meter-db-range={range}
			data-ebu-scale={isEbu ? settings.ebuScale : undefined}
			data-ebu-unit={isEbu ? settings.ebuUnit : undefined}
			data-ebu-live-value={isEbu ? settings.ebuLiveValue : undefined}
			data-meter-orientation={orientation}
			style={style}
		>
			<div
				className="kw-audio-editor__playback-meter-channels"
				role="meter"
				aria-label={meterLabel || copy.metering}
				aria-valuemin={isEbu ? ebuMinimum : settings.type === 'amplitude' ? 0 : -range}
				aria-valuemax={isEbu ? ebuMaximum : settings.type === 'amplitude' ? 1 : 0}
				aria-valuenow={displayedValue}
				aria-valuetext={isEbu ? formatEbuLoudness(liveLufs, settings.ebuUnit) : undefined}
			>
				{Array.from({ length: isEbu ? 1 : channelCount === 2 ? 2 : 1 }, (_, channel) => (
					<span className="kw-audio-editor__playback-meter-channel" key={channel} aria-hidden="true">
						<i className="kw-audio-editor__playback-meter-peak" />
						{settings.style === 'rms' && <i className="kw-audio-editor__playback-meter-rms" />}
						<b className="kw-audio-editor__playback-meter-peak-mark" />
					</span>
				))}
			</div>
			<div className="kw-audio-editor__playback-meter-ruler" aria-hidden="true">
				{ticks.map((tick) => (
					<span
						key={`${tick.label}-${tick.position}`}
						data-ebu-target={isEbu && tick.target ? '' : undefined}
						style={{ '--playback-meter-tick': `${tick.position}%` }}
					>{tick.label}</span>
				))}
			</div>
			{isEbu && <div className="kw-audio-editor__ebu-compact-readout" aria-hidden="true">
				<span>{settings.ebuLiveValue === 'short-term' ? 'S' : 'M'} {formatEbuLoudness(liveLufs, settings.ebuUnit)}</span>
				<span>I {formatEbuLoudness(loudness.integratedLufs, settings.ebuUnit)}</span>
				<span className={truePeakExceeded ? 'is-over' : ''}>
					TP {formatDbtp(loudness.truePeakDbtp)}
				</span>
			</div>}
			{slider && <input
				className="kw-audio-editor__playback-meter-volume"
				type="range"
				min={slider.minimum}
				max={slider.maximum}
				step={slider.step}
				value={slider.value}
				aria-label={slider.label}
				aria-orientation={orientation}
				aria-valuetext={slider.valueText}
				orient={orientation === 'vertical' ? 'vertical' : undefined}
				onChange={(event) => slider.onChange(Number(event.currentTarget.value))}
			/>}
			{(clipped || truePeakExceeded) && <span className="kw-audio-editor__playback-meter-clipped" aria-hidden="true" />}
		</div>
	);
}

function MeterSettingsFlyout({
	copy,
	settings,
	onChange,
	meterKind = 'playback',
	recordingOptions = null,
}) {
	const update = (key, value) => onChange((current) => ({ ...current, [key]: value }));
	const isEbu = settings.type === 'ebu-r128';
	const positions = [
		['flyout', copy.meterPositionFlyout],
		['top', copy.meterPositionTop],
		['side', copy.meterPositionSide],
	];
	const styles = [
		['default', copy.defaultOption],
		['rms', 'RMS'],
		['gradient', copy.gradient],
	];
	const types = [
		['db-log', copy.meterTypeLogarithmic],
		['db-linear', copy.meterTypeLinearDb],
		['amplitude', copy.meterTypeLinearAmplitude],
		['ebu-r128', copy.meterTypeEbuR128],
	];

	return (
		<div className="kw-audio-editor__playback-meter-settings" data-playback-meter-settings>
			<fieldset>
				<legend>{copy.position}</legend>
				{positions.map(([value, label]) => (
					<label key={value} className="kw-audio-editor__playback-meter-radio">
						<input
							type="radio"
							name="meter-position"
							value={value}
							checked={settings.position === value}
							onChange={() => update('position', value)}
						/>
						<span>{label}</span>
					</label>
				))}
			</fieldset>
			<div className="kw-audio-editor__playback-meter-settings-row">
				{!isEbu && <fieldset>
					<legend>{copy.meterStyle}</legend>
					{styles.map(([value, label]) => (
						<label key={value} className="kw-audio-editor__playback-meter-radio">
							<input
								type="radio"
								name="meter-style"
								value={value}
								checked={settings.style === value}
								onChange={() => update('style', value)}
							/>
							<span>{label}</span>
						</label>
					))}
				</fieldset>}
				<fieldset>
					<legend>{copy.meterType}</legend>
					{types.map(([value, label]) => (
						<label key={value} className="kw-audio-editor__playback-meter-radio">
							<input
								type="radio"
								name="meter-type"
								value={value}
								checked={settings.type === value}
								onChange={() => update('type', value)}
							/>
							<span>{label}</span>
						</label>
					))}
				</fieldset>
			</div>
			{isEbu ? <div className="kw-audio-editor__ebu-settings">
				<fieldset>
					<legend>{copy.ebuScale}</legend>
					{[
						['plus9', copy.ebuScalePlus9],
						['plus18', copy.ebuScalePlus18],
					].map(([value, label]) => (
						<label key={value} className="kw-audio-editor__playback-meter-radio">
							<input
								type="radio"
								name={`ebu-scale-${meterKind}`}
								value={value}
								checked={settings.ebuScale === value}
								onChange={() => update('ebuScale', value)}
							/>
							<span>{label}</span>
						</label>
					))}
				</fieldset>
				<fieldset>
					<legend>{copy.ebuUnits}</legend>
					{[
						['absolute', copy.ebuUnitsAbsolute],
						['relative', copy.ebuUnitsRelative],
					].map(([value, label]) => (
						<label key={value} className="kw-audio-editor__playback-meter-radio">
							<input
								type="radio"
								name={`ebu-units-${meterKind}`}
								value={value}
								checked={settings.ebuUnit === value}
								onChange={() => update('ebuUnit', value)}
							/>
							<span>{label}</span>
						</label>
					))}
				</fieldset>
				<fieldset>
					<legend>{copy.ebuLiveValue}</legend>
					{[
						['momentary', copy.ebuMomentary],
						['short-term', copy.ebuShortTerm],
					].map(([value, label]) => (
						<label key={value} className="kw-audio-editor__playback-meter-radio">
							<input
								type="radio"
								name={`ebu-live-${meterKind}`}
								value={value}
								checked={settings.ebuLiveValue === value}
								onChange={() => update('ebuLiveValue', value)}
							/>
							<span>{label}</span>
						</label>
					))}
				</fieldset>
			</div> : <label className="kw-audio-editor__playback-meter-range">
				<span>{copy.dbRange}</span>
				<select
					value={settings.dbRange}
					disabled={settings.type === 'amplitude'}
					onChange={(event) => update('dbRange', Number(event.currentTarget.value))}
				>
					{METER_DB_RANGES.map((range) => (
						<option key={range} value={range}>−{range === 144 ? 145 : range} dB – 0 dB</option>
					))}
				</select>
			</label>}
			{recordingOptions && <div className="kw-audio-editor__microphone-level-options" data-recording-meter-options>
				{recordingOptions}
			</div>}
		</div>
	);
}

function EbuMeterDashboard({ copy, loudness = {}, unit, meterKind, controller }) {
	const values = [
		['M', copy.ebuMomentary, formatEbuLoudness(loudness?.momentaryLufs, unit)],
		['S', copy.ebuShortTerm, formatEbuLoudness(loudness?.shortTermLufs, unit)],
		['I', copy.ebuIntegrated, formatEbuLoudness(loudness?.integratedLufs, unit)],
		['maxM', copy.ebuMaximumMomentary, formatEbuLoudness(loudness?.maximumMomentaryLufs, unit)],
		['maxS', copy.ebuMaximumShortTerm, formatEbuLoudness(loudness?.maximumShortTermLufs, unit)],
		['lra', copy.ebuLoudnessRange, formatLra(loudness?.loudnessRangeLu)],
		['tp', copy.ebuMaximumTruePeak, formatDbtp(loudness?.maximumTruePeakDbtp)],
	];
	const running = loudness?.state === 'running';
	const provisional = !loudness?.loudnessRangeStable && Number(loudness?.measuredSeconds) < 60;
	return (
		<section className="kw-audio-editor__ebu-dashboard" aria-label={copy.ebuR128Readout}>
			<header>
				<strong>{copy.meterTypeEbuR128}</strong>
				<span data-ebu-state={running ? 'running' : 'standby'}>
					{running ? copy.ebuRunning : copy.ebuStandby}
				</span>
			</header>
			<div className="kw-audio-editor__ebu-values">
				{values.map(([key, label, value]) => (
					<div key={key} data-ebu-value={key}>
						<span>{label}</span>
						<strong>{value}</strong>
					</div>
				))}
			</div>
			{provisional && <p>{copy.ebuLraProvisional}</p>}
			<div className="kw-audio-editor__ebu-actions">
				<Button
					variant="secondary"
					onClick={() => controller?.actions.metering[
						running ? 'pause' : 'continue'
					]?.(meterKind)}
				>
					{running ? copy.ebuPause : copy.ebuContinue}
				</Button>
				<Button
					variant="secondary"
					onClick={() => controller?.actions.metering.reset?.(meterKind)}
				>
					{copy.ebuReset}
				</Button>
			</div>
		</section>
	);
}

function EbuR128WorkspacePanel({ copy, controller, settings }) {
	const masterMeter = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.meters?.master);
	return (
		<EbuMeterDashboard
			copy={copy}
			loudness={masterMeter?.loudness}
			unit={settings?.ebuUnit || 'absolute'}
			meterKind="playback"
			controller={controller}
		/>
	);
}

function PlaySpeedFlyout({ copy, snapshot, telemetry, blocked, controller, run, close }) {
	const playAtSpeedPreparing = Boolean(snapshot.playbackOptions?.preparing);
	const playAtSpeedActive = telemetry.transportState === 'playing'
		&& ['naive', 'staffpad'].includes(telemetry.playbackMode);
	const playAtSpeedLabel = playAtSpeedPreparing
		? copy.cancelPlayAtSpeed
		: playAtSpeedActive ? copy.pausePlayAtSpeed : copy.playAtSpeed;
	return (
		<div className="kw-audio-editor__split-button-options" data-play-at-speed>
			<ContextMenuItem
				label={playAtSpeedLabel}
				disabled={blocked && !playAtSpeedPreparing}
				onClick={() => {
					close();
					run(() => controller.actions.transport.playAtSpeed());
				}}
			/>
			<label className="kw-audio-editor__play-at-speed-slider">
				<span>{copy.playbackSpeed}</span>
				<input
					type="range"
					min="0.5"
					max="2"
					step="0.05"
					value={snapshot.playbackOptions?.rate || 1}
					aria-label={copy.playbackSpeed}
					disabled={blocked || telemetry.transportState === 'playing'}
					onChange={(event) => run(() => controller.actions.transport.setPlayAtSpeedRate(Number(event.currentTarget.value)))}
				/>
				<output aria-hidden="true">{formatPlaybackSpeed(snapshot.playbackOptions?.rate || 1)}×</output>
			</label>
		</div>
	);
}

function RecordFlyout({
	copy,
	snapshot,
	recordLabel,
	toggleRecording,
	controller,
	run,
	onOpenRecordingOffset,
	onOpenTimedRecording,
	onClose,
}) {
	const recordingInputBlocked = snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling || snapshot.scheduledRecording;
	const items = [
		{
			label: snapshot.recording ? copy.stopRecording : recordLabel,
			shortcut: 'R',
			disabled: snapshot.readOnly || snapshot.importing || snapshot.exporting || snapshot.transportState === 'playing' || snapshot.recordingScheduling || snapshot.scheduledRecording,
			onClick: toggleRecording,
		},
		{
			id: 'record-on-new-track',
			label: copy.recordNewTrack,
			shortcut: 'Shift+R',
			disabled: snapshot.readOnly || recordingInputBlocked,
			onClick: () => run(() => controller.actions.recording.startNewTrack()),
		},
		{ label: copy.stop, onClick: () => run(() => controller.actions.transport.stop()) },
		{
			id: 'action://record/pause',
			label: snapshot.recordingOptions?.paused ? (copy.resumeRecording || copy.record) : copy.pauseRecording,
			disabled: !snapshot.recording,
			checked: Boolean(snapshot.recordingOptions?.paused),
			onClick: () => run(() => controller.actions.recording.pause()),
		},
		{ divider: true },
		{
			label: snapshot.recordingInputs?.hasOpenInputs ? copy.recordingRefreshInputs : copy.recordingAllowInputs,
			disabled: recordingInputBlocked,
			onClick: () => run(() => snapshot.recordingInputs?.hasOpenInputs
				? controller.actions.recording.refreshInputs()
				: controller.actions.recording.requestInputAccess()),
		},
		...(snapshot.recordingInputs?.hasOpenInputs ? [{
			label: copy.recordingReleaseInputs,
			disabled: recordingInputBlocked,
			onClick: () => run(() => controller.actions.recording.releaseInputs()),
		}] : []),
		{ divider: true },
		{
			label: copy.monitor,
			checked: Boolean(snapshot.monitor?.enabled),
			disabled: snapshot.recordingStarting,
			onClick: () => run(() => controller.actions.recording.setMonitoring(!snapshot.monitor?.enabled)),
		},
		{ label: copy.recordingOffset, onClick: onOpenRecordingOffset },
		{
			id: 'action://record/lead-in-recording',
			label: copy.leadInTime,
			checked: Boolean(snapshot.recordingOptions?.leadIn),
			disabled: recordingInputBlocked,
			onClick: () => run(() => controller.actions.recording.toggleLeadIn()),
		},
		{
			label: copy.timedRecording,
			disabled: snapshot.readOnly || snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling,
			onClick: onOpenTimedRecording,
		},
		{ label: copy.soundActivatedRecording, disabled: true },
		{ label: copy.soundActivationLevel, disabled: true },
	];
	return <SplitButtonMenuItems items={items} onClose={onClose} />;
}

function SplitButtonMenuItems({ items, onClose }) {
	return items.map((item, index) => item.divider
		? <ContextMenuItem key={`divider-${index}`} isDivider />
		: <ContextMenuItem
			key={`${item.label}-${index}`}
			label={item.label}
			shortcut={item.shortcut}
			disabled={item.disabled}
			checked={item.checked}
			onClick={item.disabled ? undefined : () => {
				onClose();
				item.onClick?.();
			}}
		/>);
}

function EditorActionBar({
	copy,
	snapshot,
	controller,
	run,
	editBlocked,
	blocked,
	executeEdit,
	onSaveAup4,
	onExportAudio,
	onToggleMixer,
}) {
	const canUndo = snapshot.history?.canUndo;
	const canRedo = snapshot.history?.canRedo;
	const mixerVisible = Boolean(snapshot.preferences?.workspace?.panels?.mixer?.visible);
	return (
		<div className="kw-audio-editor__action-bar" data-action-bar role="toolbar" aria-label={copy.actionBar}>
			<div className="kw-audio-editor__action-bar-center">
				<Button
					variant="secondary"
					size="small"
					className="kw-audio-editor__action-bar-button"
					icon={<Icon name="save" size={14} />}
					disabled={blocked}
					onClick={onSaveAup4}
				>
					{copy.saveAsAup4}
				</Button>
				<Button
					variant="secondary"
					size="small"
					className="kw-audio-editor__action-bar-button"
					icon={<Icon name="export" size={14} />}
					disabled={blocked}
					onClick={onExportAudio}
				>
					{copy.exportAudio}
				</Button>
				<span className="kw-audio-editor__action-bar-toggle" data-action="mixer">
					<Button
						variant={mixerVisible ? 'primary' : 'secondary'}
						size="small"
						className={`kw-audio-editor__action-bar-button${mixerVisible ? ' kw-audio-editor__action-bar-button--active' : ''}`}
						icon={iconNameToChar('MIXER')}
						aria-pressed={mixerVisible}
						onClick={onToggleMixer}
					>
						{copy.panelMixer}
					</Button>
				</span>
				<ActionBarAudioDevicesButton
					copy={copy}
					snapshot={snapshot}
					controller={controller}
					run={run}
				/>
			</div>
			<div className="kw-audio-editor__action-bar-right">
				<span data-edit="undo">
					<ToolButton icon="undo" ariaLabel={copy.undo} disabled={editBlocked || !canUndo} onClick={() => executeEdit('undo')} />
				</span>
				<span data-edit="redo">
					<ToolButton icon="redo" ariaLabel={copy.redo} disabled={editBlocked || !canRedo} onClick={() => executeEdit('redo')} />
				</span>
			</div>
		</div>
	);
}

function ActionBarAudioDevicesButton({ copy, snapshot, controller, run }) {
	const triggerRef = useRef(null);
	const [position, setPosition] = useState(null);
	const setTrigger = useCallback((element) => {
		triggerRef.current = element?.querySelector('button') || null;
	}, []);
	const close = useCallback(() => setPosition(null), []);
	const toggle = (event) => {
		if (position) {
			close();
			return;
		}
		const rect = triggerRef.current?.getBoundingClientRect();
		if (!rect) return;
		setPosition({
			x: rect.left + rect.width / 2,
			y: rect.bottom,
			direction: window.innerHeight - rect.bottom >= 320 ? 'down' : 'up',
			autoFocus: event.nativeEvent?.detail === 0,
		});
	};

	useEffect(() => {
		triggerRef.current?.setAttribute('aria-expanded', String(Boolean(position)));
	}, [position]);

	return (
		<>
			<span ref={setTrigger} className="kw-audio-editor__action-bar-toggle" data-action="audio-devices">
				<Button
					variant="secondary"
					size="small"
					className="kw-audio-editor__action-bar-button"
					icon={<span className="musescore-icon" aria-hidden="true">{iconNameToChar('AUDIO')}</span>}
					aria-expanded={Boolean(position)}
					onClick={toggle}
				>
					{copy.audioDevices}
				</Button>
			</span>
			<Flyout
				isOpen={Boolean(position)}
				onClose={close}
				x={position?.x || 0}
				y={position?.y || 0}
				direction={position?.direction || 'down'}
				autoFocus={Boolean(position?.autoFocus)}
				triggerRef={triggerRef}
				showArrow
				closeOnOutsideClick
				closeOnEscape
				ariaLabel={copy.audioDevices}
				role="dialog"
				className="kw-audio-editor__audacity-level-flyout kw-audio-editor__audio-devices-flyout"
			>
				<AudioDevicesFlyout copy={copy} snapshot={snapshot} controller={controller} run={run} />
			</Flyout>
		</>
	);
}

function AccessibleTimeCode({ ariaLabel, ...props }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		wrapperRef.current?.querySelector('.timecode__format-button')?.setAttribute('aria-label', ariaLabel);
	}, [ariaLabel]);
	return <span ref={wrapperRef}><TimeCode {...props} /></span>;
}

function AccessibleTransportButton({ pressed, ...props }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		wrapperRef.current?.querySelector('button')?.setAttribute('aria-pressed', String(Boolean(pressed)));
	}, [pressed]);
	return <span ref={wrapperRef} className="kw-audio-editor__transport-state"><TransportButton {...props} /></span>;
}

function AccessibleSelectionToolbar({
	controller,
	snapshot,
	copy,
	statusMessage,
	statusState,
	durationFrames,
	disabled,
	showSelectionToolbar,
	showStatusbar,
	run,
}) {
	const wrapperRef = useRef(null);
	const [format, setFormat] = useState('hh:mm:ss+milliseconds');
	const [durationFormat, setDurationFormat] = useState('hh:mm:ss+milliseconds');
	const selection = snapshot.selection;
	const sampleRate = snapshot.project?.sampleRate || 48_000;
	const canEdit = Boolean(selection && !disabled);
	const selectionStart = selection ? framesToSeconds(selection.startFrame, { sampleRate }) : null;
	const selectionEnd = selection ? framesToSeconds(selection.endFrame, { sampleRate }) : null;

	useEffect(() => {
		const root = wrapperRef.current;
		if (!root) return;
		const toolbar = root.querySelector('.selection-toolbar');
		if (toolbar) {
			toolbar.setAttribute('role', 'toolbar');
			toolbar.setAttribute('aria-label', 'Selection toolbar');
		}
		const status = root.querySelector('.selection-toolbar__status-text');
		if (status) {
			status.setAttribute('data-status', '');
			status.setAttribute('data-editor-status', '');
			status.setAttribute('data-state', statusState);
			status.setAttribute('role', 'status');
			status.setAttribute('aria-live', 'polite');
		}
		const timecodes = [...root.querySelectorAll('.selection-toolbar__timecodes .timecode')];
		const timecodeLabels = [
			copy.selectionStart || `${copy.selection}: ${copy.clipStart}`,
			copy.selectionEnd || `${copy.selection}: ${copy.clipStart} + ${copy.clipDuration}`,
			copy.selectionDuration || copy.clipDuration,
		];
		timecodes.forEach((timecode, index) => {
			timecode.setAttribute('aria-label', timecodeLabels[index] || copy.selection);
			timecode.setAttribute('aria-disabled', String(!canEdit && index < 2));
			timecode.querySelector('.timecode__format-button')?.setAttribute(
				'aria-label',
				`${timecodeLabels[index] || copy.selection}: ${copy.format}`,
			);
		});
	}, [canEdit, copy, format, durationFormat, statusMessage, statusState]);

	const updateStart = (seconds) => {
		if (!canEdit) return;
		const startFrame = secondsToFrames(seconds, { maximumFrame: selection.endFrame, sampleRate });
		run(() => controller.actions.timeline.setSelection(startFrame, selection.endFrame));
	};
	const updateEnd = (seconds) => {
		if (!canEdit) return;
		const endFrame = secondsToFrames(seconds, {
			minimumFrame: selection.startFrame,
			maximumFrame: Math.max(selection.startFrame, durationFrames),
			sampleRate,
		});
		run(() => controller.actions.timeline.setSelection(selection.startFrame, endFrame));
	};
	if (!showSelectionToolbar) {
		return (
			<div
				ref={wrapperRef}
				className="kw-audio-editor__selection-surface kw-audio-editor__selection-surface--status-only"
				data-selection-toolbar
			>
				<p data-status data-editor-status data-state={statusState} role="status" aria-live="polite">
					{showStatusbar ? statusMessage : ''}
				</p>
			</div>
		);
	}

	return (
		<div
			ref={wrapperRef}
			className="kw-audio-editor__selection-surface"
			data-selection-toolbar
			aria-disabled={disabled ? 'true' : 'false'}
		>
			<SelectionToolbar
				selectionStart={selectionStart}
				selectionEnd={selectionEnd}
				status={showStatusbar ? statusMessage : ''}
				instructionText={copy.timelineHint}
				format={format}
				durationFormat={durationFormat}
				sampleRate={sampleRate}
				onFormatChange={setFormat}
				onDurationFormatChange={setDurationFormat}
				onSelectionStartChange={updateStart}
				onSelectionEndChange={updateEnd}
				showDuration
			/>
		</div>
	);
}

const WORKSPACE_PANEL_IDS = Object.freeze([
	'project-bin',
	'video-preview',
	'history',
	'labels',
	'metadata',
	'effects',
	'mixer',
	'spectrogram',
	'analysis',
	'spectrum',
	'clipping',
	'contrast',
	'ebu-r128',
]);
const WORKSPACE_TOOLBAR_IDS = Object.freeze(['transport', 'tools', 'edit', 'meter']);
const WORKSPACE_DOCK_IDS = Object.freeze(['left', 'right', 'bottom', 'floating']);
const FLOATING_PANEL_MIN_WIDTH = 240;
const FLOATING_PANEL_MIN_HEIGHT = 120;

function clampFloatingPanelGeometry(panel, workspaceBounds = {}) {
	const raw = {
		x: Math.max(0, Number(panel?.x) || 0),
		y: Math.max(0, Number(panel?.y) || 0),
		width: Math.max(80, Number(panel?.width ?? panel?.size) || 320),
		height: Math.max(80, Number(panel?.height) || 320),
	};
	const workspaceWidth = Math.max(0, Number(workspaceBounds.width) || 0);
	const workspaceHeight = Math.max(0, Number(workspaceBounds.height) || 0);
	if (!workspaceWidth || !workspaceHeight) return raw;
	const minimumWidth = Math.min(FLOATING_PANEL_MIN_WIDTH, workspaceWidth);
	const minimumHeight = Math.min(FLOATING_PANEL_MIN_HEIGHT, workspaceHeight);
	const width = Math.min(workspaceWidth, Math.max(minimumWidth, raw.width));
	const height = Math.min(workspaceHeight, Math.max(minimumHeight, raw.height));
	return {
		x: Math.min(Math.max(0, raw.x), workspaceWidth - width),
		y: Math.min(Math.max(0, raw.y), workspaceHeight - height),
		width,
		height,
	};
}

function VideoEditorWorkspacePanels({
	controller,
	snapshot,
	copy,
	locale,
	fileService,
	playbackMeterSettings,
	run,
	showArmControls,
	displayAudioSupported,
	onOpenEffects,
	effectsPanelTarget,
	onEffectWindowChange,
	onTogglePanel,
	blocked,
}) {
	const panelIds = ['project-bin', 'video-preview'].filter((panelId) => (
		snapshot.preferences?.workspace?.panels?.[panelId]?.visible
	));
	if (!panelIds.length) return null;
	return (
		<section
			className="kw-audio-editor__video-workspace"
			data-video-workspace
			aria-label={`${copy.workspace}: ${copy.workspaceVideo}`}
		>
			{panelIds.map((panelId) => (
				<section
					key={panelId}
					className="kw-audio-editor__workspace-panel kw-audio-editor__video-workspace-panel"
					data-workspace-panel={panelId}
					data-video-workspace-panel={panelId}
				>
					<header className="kw-audio-editor__workspace-panel-header">
						<h2>{workspacePanelLabel(copy, panelId)}</h2>
						<button
							type="button"
							className="kw-audio-editor__workspace-panel-close"
							aria-label={`${copy.close}: ${workspacePanelLabel(copy, panelId)}`}
							onClick={() => onTogglePanel(panelId)}
						>×</button>
					</header>
					<div className="kw-audio-editor__workspace-panel-content">
						<WorkspacePanelContent
							panelId={panelId}
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							locale={locale}
							fileService={fileService}
							playbackMeterSettings={playbackMeterSettings}
							run={run}
							showArmControls={showArmControls}
							displayAudioSupported={displayAudioSupported}
							onOpenEffects={onOpenEffects}
							effectsPanelTarget={effectsPanelTarget}
							onEffectWindowChange={onEffectWindowChange}
							blocked={blocked}
						/>
					</div>
				</section>
			))}
		</section>
	);
}

function WorkspacePanelDock({
	dock,
	controller,
	snapshot,
	copy,
	locale,
	fileService,
	playbackMeterSettings,
	run,
	showArmControls,
	displayAudioSupported,
	onOpenEffects,
	effectsPanelTarget,
	onEffectWindowChange,
	draggedPanelId,
	onPanelDragStart,
	onPanelDragEnd,
	onPanelMove,
	onTogglePanel,
	projectBinEffectivelyOpen,
	blocked,
}) {
	const dockRef = useRef(null);
	const resizeSessionRef = useRef(null);
	const moveSessionRef = useRef(null);
	const [floatingBounds, setFloatingBounds] = useState({ width: 0, height: 0 });
	const [activeFloatingPanelId, setActiveFloatingPanelId] = useState(null);
	const panels = WORKSPACE_PANEL_IDS
		.map((id) => [id, snapshot.preferences?.workspace?.panels?.[id]])
		.filter(([id, panel]) => (
			panel?.visible
			&& panel.dock === dock
			&& !(snapshot.preferences?.workspace?.activeId === 'video-editor'
				&& (id === 'project-bin' || id === 'video-preview'))
			&& (id !== 'project-bin' || projectBinEffectivelyOpen)
			&& (id !== 'video-preview' || snapshot.project?.tracks?.some((track) => (
				track.type === 'video' && track.clipIds?.length
			)))
		))
		.sort((left, right) => left[1].order - right[1].order);
	useEffect(() => {
		if (dock !== 'floating') return undefined;
		const element = dockRef.current;
		if (!element) return undefined;
		const update = () => {
			const bounds = element.getBoundingClientRect();
			const next = { width: Math.round(bounds.width), height: Math.round(bounds.height) };
			setFloatingBounds((current) => (
				current.width === next.width && current.height === next.height ? current : next
			));
		};
		update();
		if (typeof ResizeObserver !== 'function') {
			window.addEventListener('resize', update);
			return () => window.removeEventListener('resize', update);
		}
		const observer = new ResizeObserver(update);
		observer.observe(element);
		return () => observer.disconnect();
	}, [dock, panels.length]);
	useEffect(() => {
		const resize = (event) => {
			const session = resizeSessionRef.current;
			if (!session || dock === 'floating' || event.pointerId !== session.pointerId) return;
			event.preventDefault();
			const pointerDelta = session.horizontal
				? event.clientX - session.startClientX
				: event.clientY - session.startClientY;
			const delta = pointerDelta * (session.invertDelta ? -1 : 1);
			const size = Math.max(session.minimumSize, Math.min(session.maximumSize, session.initialSize + delta));
			session.element.style[session.sizeProperty] = `${Math.round(size)}px`;
		};
		const finishResize = (event) => {
			const session = resizeSessionRef.current;
			if (event?.type === 'pointerup' && session?.pointerId !== event.pointerId) return;
			resizeSessionRef.current = null;
			if (!session?.element?.isConnected) return;
			const bounds = session.element.getBoundingClientRect();
			if (dock === 'floating') {
				const containerBounds = dockRef.current?.getBoundingClientRect();
				if (!containerBounds) return;
				const geometry = clampFloatingPanelGeometry({
					x: bounds.left - containerBounds.left,
					y: bounds.top - containerBounds.top,
					width: bounds.width,
					height: bounds.height,
				}, containerBounds);
				if (Math.abs(geometry.width - session.initialWidth) < 2
					&& Math.abs(geometry.height - session.initialHeight) < 2) return;
				Object.assign(session.element.style, {
					left: `${geometry.x}px`,
					top: `${geometry.y}px`,
					width: `${geometry.width}px`,
					height: `${geometry.height}px`,
				});
				run(() => controller.actions.preferences.setPanel(session.panelId, {
					...geometry,
				}));
				return;
			}
			const size = Math.round(session.horizontal ? bounds.width : bounds.height);
			if (!Number.isFinite(size) || Math.abs(size - session.initialSize) < 2) {
				session.element.style.removeProperty(session.sizeProperty);
				return;
			}
			session.element.style.setProperty(session.cssSizeProperty || '--workspace-panel-size', `${size}px`);
			session.element.style.removeProperty(session.sizeProperty);
			run(() => {
				for (const panelId of session.panelIds || [session.panelId]) {
					controller.actions.preferences.setPanel(panelId, {
						[session.preferenceProperty || 'size']: size,
					});
				}
			});
		};
		const cancelResize = (event) => {
			const session = resizeSessionRef.current;
			if (session?.pointerId !== undefined && event?.pointerId !== session.pointerId) return;
			resizeSessionRef.current = null;
			if (session?.manual && session.sizeProperty) session.element?.style.removeProperty(session.sizeProperty);
		};
		window.addEventListener('pointermove', resize, { passive: false });
		window.addEventListener('pointerup', finishResize);
		window.addEventListener('mouseup', finishResize);
		window.addEventListener('pointercancel', cancelResize);
		return () => {
			window.removeEventListener('pointermove', resize);
			window.removeEventListener('pointerup', finishResize);
			window.removeEventListener('mouseup', finishResize);
			window.removeEventListener('pointercancel', cancelResize);
		};
	}, [controller, dock, run]);
	useEffect(() => {
		if (dock !== 'floating') return undefined;
		const move = (event) => {
			const session = moveSessionRef.current;
			if (!session || event.pointerId !== session.pointerId) return;
			event.preventDefault();
			const geometry = clampFloatingPanelGeometry({
				...session.startGeometry,
				x: session.startGeometry.x + event.clientX - session.startClientX,
				y: session.startGeometry.y + event.clientY - session.startClientY,
			}, session.workspaceBounds);
			session.geometry = geometry;
			session.moved = session.moved
				|| Math.abs(geometry.x - session.startGeometry.x) >= 1
				|| Math.abs(geometry.y - session.startGeometry.y) >= 1;
			Object.assign(session.element.style, {
				left: `${geometry.x}px`,
				top: `${geometry.y}px`,
			});
		};
		const finish = (event) => {
			const session = moveSessionRef.current;
			if (!session || event.pointerId !== session.pointerId) return;
			moveSessionRef.current = null;
			session.element.classList.remove('kw-audio-editor__workspace-panel--moving');
			if (!session.moved) return;
			run(() => controller.actions.preferences.setPanel(session.panelId, {
				x: Math.round(session.geometry.x),
				y: Math.round(session.geometry.y),
			}));
		};
		const cancel = (event) => {
			const session = moveSessionRef.current;
			if (!session || event.pointerId !== session.pointerId) return;
			moveSessionRef.current = null;
			session.element.classList.remove('kw-audio-editor__workspace-panel--moving');
			Object.assign(session.element.style, {
				left: `${session.startGeometry.x}px`,
				top: `${session.startGeometry.y}px`,
			});
		};
		window.addEventListener('pointermove', move, { passive: false });
		window.addEventListener('pointerup', finish);
		window.addEventListener('pointercancel', cancel);
		return () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', finish);
			window.removeEventListener('pointercancel', cancel);
			moveSessionRef.current?.element?.classList.remove('kw-audio-editor__workspace-panel--moving');
			moveSessionRef.current = null;
		};
	}, [controller, dock, run]);
	const beginResize = (event) => {
		if (event.button !== 0) return;
		const dockResizeHandle = event.target.closest?.('[data-workspace-dock-resize-handle]');
		if ((dock === 'left' || dock === 'right') && dockResizeHandle?.closest('[data-panel-dock]') === dockRef.current) {
			const element = dockRef.current;
			const bounds = element?.getBoundingClientRect();
			const workspaceBounds = element?.parentElement?.getBoundingClientRect();
			if (!element || !bounds) return;
			const hasEffects = panels.some(([panelId]) => panelId === 'effects');
			const minimumSize = hasEffects ? 360 : 240;
			const maximumSize = Math.max(
				minimumSize,
				Math.min(hasEffects ? 520 : 420, Math.round((workspaceBounds?.width || window.innerWidth) * 0.65)),
			);
			resizeSessionRef.current = {
				element,
				horizontal: true,
				invertDelta: dock === 'right',
				initialWidth: Math.round(bounds.width),
				initialHeight: Math.round(bounds.height),
				initialSize: Math.round(bounds.width),
				maximumSize,
				minimumSize,
				manual: true,
				panelId: panels[0][0],
				panelIds: panels.map(([panelId]) => panelId),
				pointerId: event.pointerId,
				sizeProperty: 'width',
				cssSizeProperty: '--workspace-dock-width',
				preferenceProperty: 'width',
				startClientX: event.clientX,
				startClientY: event.clientY,
			};
			event.preventDefault();
			return;
		}
		if (dock === 'bottom' && dockResizeHandle?.closest('[data-panel-dock]') === dockRef.current) {
			const element = dockRef.current;
			const bounds = element?.getBoundingClientRect();
			if (!element || !bounds) return;
			resizeSessionRef.current = {
				element,
				horizontal: false,
				invertDelta: true,
				initialWidth: Math.round(bounds.width),
				initialHeight: Math.round(bounds.height),
				initialSize: Math.round(bounds.height),
				maximumSize: Number.POSITIVE_INFINITY,
				minimumSize: 120,
				manual: true,
				panelId: panels[0][0],
				panelIds: panels.map(([panelId]) => panelId),
				pointerId: event.pointerId,
				sizeProperty: 'height',
				startClientX: event.clientX,
				startClientY: event.clientY,
			};
			event.preventDefault();
			return;
		}
		const element = event.target.closest?.('[data-workspace-panel]');
		if (!element) return;
		const bounds = element.getBoundingClientRect();
		const threshold = 14;
		const horizontal = dock === 'bottom' || dock === 'floating';
		const onResizeEdge = dock === 'floating'
			? event.clientX >= bounds.right - threshold || event.clientY >= bounds.bottom - threshold
			: horizontal
				? event.clientX >= bounds.right - threshold
				: event.clientY >= bounds.bottom - threshold;
		if (!onResizeEdge) return;
		const dockBounds = dockRef.current?.getBoundingClientRect();
		resizeSessionRef.current = {
			element,
			horizontal,
			initialWidth: Math.round(bounds.width),
			initialHeight: Math.round(bounds.height),
			initialSize: Math.round(horizontal ? bounds.width : bounds.height),
			maximumSize: Math.max(
				horizontal ? FLOATING_PANEL_MIN_WIDTH : FLOATING_PANEL_MIN_HEIGHT,
				dock === 'floating'
					? Number.POSITIVE_INFINITY
					: Math.round(horizontal ? dockBounds?.width || bounds.width : dockBounds?.height || bounds.height),
			),
			minimumSize: horizontal ? FLOATING_PANEL_MIN_WIDTH : FLOATING_PANEL_MIN_HEIGHT,
			manual: dock !== 'floating',
			panelId: element.dataset.workspacePanel,
			pointerId: event.pointerId,
			sizeProperty: horizontal ? 'width' : 'height',
			startClientX: event.clientX,
			startClientY: event.clientY,
		};
		if (dock !== 'floating') event.preventDefault();
	};
	const beginFloatingMove = (event, panelId) => {
		if (dock !== 'floating' || event.button !== 0 || resizeSessionRef.current) return;
		if (event.target.closest('button, select, input, label, a')) return;
		const element = event.currentTarget.closest('[data-workspace-panel]');
		const workspace = dockRef.current;
		if (!element || !workspace) return;
		const workspaceBounds = workspace.getBoundingClientRect();
		const elementBounds = element.getBoundingClientRect();
		const startGeometry = clampFloatingPanelGeometry({
			x: elementBounds.left - workspaceBounds.left,
			y: elementBounds.top - workspaceBounds.top,
			width: elementBounds.width,
			height: elementBounds.height,
		}, workspaceBounds);
		moveSessionRef.current = {
			panelId,
			element,
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			startGeometry,
			geometry: startGeometry,
			workspaceBounds,
			moved: false,
		};
		setActiveFloatingPanelId(panelId);
		element.classList.add('kw-audio-editor__workspace-panel--moving');
		event.currentTarget.setPointerCapture?.(event.pointerId);
		event.preventDefault();
	};
	const adjustFloatingPanelGeometry = (event, panelId, panel, mode) => {
		if (dock !== 'floating' || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return false;
		const workspaceBounds = dockRef.current?.getBoundingClientRect();
		if (!workspaceBounds) return false;
		event.preventDefault();
		const step = event.shiftKey ? 48 : 16;
		const current = clampFloatingPanelGeometry(panel, workspaceBounds);
		const next = { ...current };
		if (mode === 'resize') {
			if (event.key === 'ArrowLeft') next.width -= step;
			else if (event.key === 'ArrowRight') next.width += step;
			else if (event.key === 'ArrowUp') next.height -= step;
			else next.height += step;
		} else {
			if (event.key === 'ArrowLeft') next.x -= step;
			else if (event.key === 'ArrowRight') next.x += step;
			else if (event.key === 'ArrowUp') next.y -= step;
			else next.y += step;
		}
		const geometry = clampFloatingPanelGeometry(next, workspaceBounds);
		setActiveFloatingPanelId(panelId);
		run(() => controller.actions.preferences.setPanel(panelId, {
			x: Math.round(geometry.x),
			y: Math.round(geometry.y),
			width: Math.round(geometry.width),
			height: Math.round(geometry.height),
		}));
		return true;
	};
	const adjustBottomDockSize = (event) => {
		if (dock !== 'bottom' || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
		const bounds = dockRef.current?.getBoundingClientRect();
		if (!bounds) return;
		event.preventDefault();
		const step = event.shiftKey ? 48 : 16;
		const size = Math.max(120, bounds.height + (event.key === 'ArrowUp' ? step : -step));
		run(() => {
			for (const [panelId] of panels) controller.actions.preferences.setPanel(panelId, { size });
		});
	};
	const adjustSideDockSize = (event) => {
		if ((dock !== 'left' && dock !== 'right') || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
		const bounds = dockRef.current?.getBoundingClientRect();
		const workspaceBounds = dockRef.current?.parentElement?.getBoundingClientRect();
		if (!bounds) return;
		event.preventDefault();
		const hasEffects = panels.some(([panelId]) => panelId === 'effects');
		const minimumSize = hasEffects ? 360 : 240;
		const maximumSize = Math.max(
			minimumSize,
			Math.min(hasEffects ? 520 : 420, Math.round((workspaceBounds?.width || window.innerWidth) * 0.65)),
		);
		const step = event.shiftKey ? 48 : 16;
		const expands = dock === 'left' ? event.key === 'ArrowRight' : event.key === 'ArrowLeft';
		const width = Math.max(minimumSize, Math.min(maximumSize, bounds.width + (expands ? step : -step)));
		run(() => {
			for (const [panelId] of panels) controller.actions.preferences.setPanel(panelId, { width });
		});
	};
	if (!panels.length) return null;
	const dockStyle = dock === 'bottom'
		? {
			'--workspace-panel-size': `${panels[0][1].size}px`,
			'--workspace-panel-count': panels.length,
		}
		: (dock === 'left' || dock === 'right')
			? { '--workspace-dock-width': `${panels[0][1].width}px` }
			: undefined;
	return (
		<aside
			ref={dockRef}
			className={`kw-audio-editor__panel-dock kw-audio-editor__panel-dock--${dock}`}
			data-panel-dock={dock}
			style={dockStyle}
			aria-label={copy.panels}
			onPointerDownCapture={beginResize}
			onDragOver={(event) => {
				if (!draggedPanelId) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = 'move';
			}}
			onDrop={(event) => {
				if (!draggedPanelId) return;
				event.preventDefault();
				onPanelMove(draggedPanelId, dock, panels.filter(([id]) => id !== draggedPanelId).length);
			}}
		>
			{(dock === 'left' || dock === 'right') && <button
				type="button"
				className={`kw-audio-editor__workspace-dock-resize-handle kw-audio-editor__workspace-dock-resize-handle--${dock}`}
				data-workspace-dock-resize-handle={dock}
				aria-label={`${copy.workspaceResize}: ${workspaceDockLabel(copy, dock)}`}
				onKeyDown={adjustSideDockSize}
			>↔</button>}
			{dock === 'bottom' && <button
				type="button"
				className="kw-audio-editor__workspace-dock-resize-handle"
				data-workspace-dock-resize-handle={dock}
				aria-label={`${copy.workspaceResize}: ${workspaceDockLabel(copy, dock)}`}
				onKeyDown={adjustBottomDockSize}
			>↕</button>}
			{panels.map(([panelId, panel], panelIndex) => {
				const geometry = dock === 'floating'
					? clampFloatingPanelGeometry(panel, floatingBounds)
					: null;
				const panelStyle = geometry
					? {
						'--workspace-panel-size': `${geometry.width}px`,
						left: `${geometry.x}px`,
						top: `${geometry.y}px`,
						width: `${geometry.width}px`,
						height: `${geometry.height}px`,
						minWidth: `${Math.min(FLOATING_PANEL_MIN_WIDTH, floatingBounds.width || FLOATING_PANEL_MIN_WIDTH)}px`,
						minHeight: `${Math.min(FLOATING_PANEL_MIN_HEIGHT, floatingBounds.height || FLOATING_PANEL_MIN_HEIGHT)}px`,
						maxWidth: floatingBounds.width ? `${Math.max(1, floatingBounds.width - geometry.x)}px` : '100%',
						maxHeight: floatingBounds.height ? `${Math.max(1, floatingBounds.height - geometry.y)}px` : '100%',
					}
					: dock === 'bottom' ? undefined : { '--workspace-panel-size': `${panel.size}px` };
				return (
				<section
					key={panelId}
					className={`kw-audio-editor__workspace-panel${draggedPanelId === panelId ? ' kw-audio-editor__workspace-panel--dragging' : ''}${activeFloatingPanelId === panelId ? ' kw-audio-editor__workspace-panel--active' : ''}`}
					data-workspace-panel={panelId}
					data-workspace-panel-size={panel.size}
					data-workspace-panel-x={geometry?.x}
					data-workspace-panel-y={geometry?.y}
					data-workspace-panel-width={geometry?.width}
					data-workspace-panel-height={geometry?.height}
					style={panelStyle}
					onPointerDownCapture={() => {
						if (dock === 'floating') setActiveFloatingPanelId(panelId);
					}}
					onFocusCapture={() => {
						if (dock === 'floating') setActiveFloatingPanelId(panelId);
					}}
					onDragOver={(event) => {
						if (!draggedPanelId || draggedPanelId === panelId) return;
						event.preventDefault();
						event.stopPropagation();
						event.dataTransfer.dropEffect = 'move';
					}}
					onDrop={(event) => {
						if (!draggedPanelId) return;
						event.preventDefault();
						event.stopPropagation();
						if (draggedPanelId === panelId) return;
						const remaining = panels.filter(([id]) => id !== draggedPanelId);
						const targetIndex = remaining.findIndex(([id]) => id === panelId);
						const bounds = event.currentTarget.getBoundingClientRect();
						const after = dock === 'bottom'
							? event.clientX > bounds.left + bounds.width / 2
							: event.clientY > bounds.top + bounds.height / 2;
						onPanelMove(draggedPanelId, dock, targetIndex + (after ? 1 : 0));
					}}
				>
					<header
						className="kw-audio-editor__workspace-panel-header"
						data-floating-panel-move-handle={dock === 'floating' ? panelId : undefined}
						onPointerDown={(event) => beginFloatingMove(event, panelId)}
					>
						<button
							type="button"
							className="kw-audio-editor__workspace-drag-handle"
							data-workspace-panel-drag-handle={panelId}
							draggable
							aria-label={`${copy.workspaceMove}: ${workspacePanelLabel(copy, panelId)}`}
							onClick={(event) => event.currentTarget.focus()}
							onDragStart={(event) => {
								event.dataTransfer.effectAllowed = 'move';
								event.dataTransfer.setData('text/plain', panelId);
								onPanelDragStart(panelId);
							}}
							onDragEnd={onPanelDragEnd}
							onKeyDown={(event) => {
								if (adjustFloatingPanelGeometry(event, panelId, panel, 'move')) return;
								const backwards = dock === 'bottom' ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
								const forwards = dock === 'bottom' ? event.key === 'ArrowRight' : event.key === 'ArrowDown';
								if (!backwards && !forwards) return;
								event.preventDefault();
								onPanelMove(panelId, dock, panelIndex + (forwards ? 1 : -1));
							}}
						>⠿</button>
						<h2>{workspacePanelLabel(copy, panelId)}</h2>
						{dock === 'floating' && <button
							type="button"
							className="kw-audio-editor__workspace-resize-handle"
							data-floating-panel-resize-handle={panelId}
							aria-label={`${copy.workspaceResize}: ${workspacePanelLabel(copy, panelId)}`}
							onClick={(event) => event.currentTarget.focus()}
							onKeyDown={(event) => adjustFloatingPanelGeometry(event, panelId, panel, 'resize')}
						>↘</button>}
						<label className="kw-audio-editor__panel-dock-picker">
							<span className="kw-audio-editor-sr-only">{copy.panelDock}</span>
							<select
								data-workspace-panel-dock-picker={panelId}
								aria-label={`${workspacePanelLabel(copy, panelId)}: ${copy.panelDock}`}
								value={panel.dock}
								onChange={(event) => {
									const ownerDocument = event.currentTarget.ownerDocument;
									const nextDock = event.currentTarget.value;
									run(() => controller.actions.preferences.setPanel(panelId, { dock: nextDock }));
									let remainingAttempts = 4;
									const restoreFocus = () => {
										const picker = ownerDocument.querySelector(`[data-workspace-panel-dock-picker="${panelId}"]`);
										if (picker instanceof HTMLElement) {
											picker.focus();
											return;
										}
										remainingAttempts -= 1;
										if (remainingAttempts > 0) requestAnimationFrame(restoreFocus);
									};
									requestAnimationFrame(restoreFocus);
								}}
							>
								{WORKSPACE_DOCK_IDS.map((dockId) => <option key={dockId} value={dockId}>{workspaceDockLabel(copy, dockId)}</option>)}
							</select>
						</label>
						<button
							type="button"
							className="kw-audio-editor__workspace-panel-close"
							aria-label={`${copy.close}: ${workspacePanelLabel(copy, panelId)}`}
							onClick={() => onTogglePanel(panelId)}
						>×</button>
					</header>
					<div className="kw-audio-editor__workspace-panel-content">
						<WorkspacePanelContent
							panelId={panelId}
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							locale={locale}
							fileService={fileService}
							playbackMeterSettings={playbackMeterSettings}
							run={run}
							showArmControls={showArmControls}
							displayAudioSupported={displayAudioSupported}
							onOpenEffects={onOpenEffects}
							effectsPanelTarget={effectsPanelTarget}
							onEffectWindowChange={onEffectWindowChange}
							blocked={blocked}
						/>
					</div>
				</section>
				);
			})}
		</aside>
	);
}

function WorkspacePanelContent({
	panelId,
	controller,
	snapshot,
	copy,
	locale,
	fileService,
	playbackMeterSettings,
	run,
	showArmControls,
	displayAudioSupported,
	onOpenEffects,
	effectsPanelTarget,
	onEffectWindowChange,
	blocked,
}) {
	const project = snapshot.project;
	if (panelId === 'project-bin') {
		return (
			<ProjectBinPanel
				controller={controller}
				snapshot={snapshot}
				copy={copy}
				locale={locale}
				fileService={fileService}
				run={run}
				blocked={blocked}
			/>
		);
	}
	if (panelId === 'video-preview') {
		return <VideoPreviewPanel controller={controller} snapshot={snapshot} copy={copy} />;
	}
	const analysisMode = Object.entries(ANALYSIS_MODE_PANEL_IDS)
		.find(([, candidatePanelId]) => candidatePanelId === panelId)?.[0];
	if (analysisMode) {
		return (
			<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
				<AnalysisPanel
					mode={analysisMode}
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					locale={locale}
					fileService={fileService}
				/>
			</React.Suspense>
		);
	}
	if (panelId === 'ebu-r128') {
		return (
			<EbuR128WorkspacePanel
				controller={controller}
				copy={copy}
				settings={playbackMeterSettings}
			/>
		);
	}
	if (panelId === 'history') {
		const undoEntries = snapshot.history?.undoEntries || [];
		const redoEntries = snapshot.history?.redoEntries || [];
		return (
			<>
				<div className="kw-audio-editor__panel-actions-inline">
					<Button variant="secondary" disabled={!snapshot.history?.canUndo} onClick={() => run(() => controller.actions.edit.undo())}>{copy.undo}</Button>
					<Button variant="secondary" disabled={!snapshot.history?.canRedo} onClick={() => run(() => controller.actions.edit.redo())}>{copy.redo}</Button>
				</div>
				{!undoEntries.length && !redoEntries.length
					? <p className="kw-audio-editor__panel-empty">{copy.historyEmpty}</p>
					: <ol className="kw-audio-editor__panel-list" data-history-list>
						{undoEntries.map((entry, index) => <li key={`undo-${index}`}>{historyCommandLabel(copy, entry)}</li>)}
						{redoEntries.map((entry, index) => <li key={`redo-${index}`} data-redo="true">{copy.redo}: {historyCommandLabel(copy, entry)}</li>)}
					</ol>}
			</>
		);
	}
	if (panelId === 'labels') {
		const labelTracks = (project?.tracks || []).filter((track) => track.type === 'label');
		const labels = labelTracks.flatMap((track) => (track.labels || []).map((label) => ({
			...label,
			trackId: track.id,
			trackName: track.name,
		})));
		const targetTrack = labelTracks.find((track) => track.id === snapshot.selectedTrackId) || labelTracks[0];
		return (
			<>
				<div className="kw-audio-editor__panel-actions-inline">
					<Button
						variant="secondary"
						disabled={snapshot.readOnly || !targetTrack}
						onClick={() => run(() => controller.actions.labels.add(targetTrack.id, {
							title: copy.newLabel || copy.untitledLabel,
							startFrame: snapshot.selection?.startFrame || 0,
							endFrame: snapshot.selection?.endFrame || snapshot.selection?.startFrame || 0,
						}))}
					>{copy.newLabel || copy.addLabelTrack}</Button>
				</div>
				{labels.length ? (
					<ul className="kw-audio-editor__panel-list kw-audio-editor__label-manager" data-labels-panel-list>
						{labels.map((label) => (
							<LabelManagerRow
								key={label.id}
								label={label}
								sampleRate={project.sampleRate}
								controller={controller}
								copy={copy}
								disabled={snapshot.readOnly}
								run={run}
							/>
						))}
					</ul>
				) : <p className="kw-audio-editor__panel-empty">{copy.labelsEmpty}</p>}
			</>
		);
	}
	if (panelId === 'metadata') {
		const metadata = project?.metadata || {};
		const fields = [
			['title', copy.metadataTitle], ['artist', copy.metadataArtist], ['album', copy.metadataAlbum],
			['trackNumber', copy.metadataTrack], ['year', copy.metadataYear], ['comments', copy.metadataComments],
		];
		return (
			<div className="kw-audio-editor__metadata-list" data-metadata-editor>
				{fields.map(([key, label]) => (
					<MetadataEditorField
						key={key}
						name={key}
						label={label}
						value={metadata[key] || ''}
						disabled={snapshot.readOnly}
						onCommit={(value) => run(() => controller.actions.metadata.update({ [key]: value }))}
					/>
				))}
				{Object.entries(metadata.tags || {}).map(([key, value]) => (
					<MetadataEditorField
						key={key}
						name={`tag-${key}`}
						label={key}
						value={value || ''}
						disabled={snapshot.readOnly}
						onCommit={(nextValue) => run(() => controller.actions.metadata.update({
							tags: { ...metadata.tags, [key]: nextValue },
						}))}
					/>
				))}
			</div>
		);
	}
	if (panelId === 'effects') {
		const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId && track.type === 'audio');
		const scope = effectsPanelTarget?.scope || 'track';
		const targetId = scope === 'track'
			? selectedTrack?.id || null
			: effectsPanelTarget?.trackId || null;
		return <AudioEditorEffectsOverlay
			isOpen
			controller={controller}
			snapshot={snapshot}
			copy={copy}
			locale={locale}
			fileService={fileService}
			trackId={targetId}
			scope={scope}
			layout="docked"
			onClose={() => undefined}
			selectedEffect={null}
			onSelectedEffectChange={(selectedEffect) => {
				if (!selectedEffect) return;
				onEffectWindowChange?.({
					trackId: selectedEffect.scope === 'master' ? null : targetId,
					scope: selectedEffect.scope,
					selectedEffect,
				});
			}}
			renderDialogs={false}
		/>;
	}
	if (panelId === 'mixer') {
		return <AudioEditorMixerPanel controller={controller} snapshot={snapshot} copy={copy} run={run} showArmControls={showArmControls} displayAudioSupported={displayAudioSupported} onOpenEffects={onOpenEffects} />;
	}
	const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId && track.type === 'audio') || null;
	const defaultSpectrogram = snapshot.preferences?.spectrogram || {};
	const nyquist = Math.max(1, (project?.sampleRate || 48_000) / 2);
	const spectrogram = { ...defaultSpectrogram, ...(selectedTrack?.spectrogram || {}) };
	const updateSpectrogram = (changes) => {
		if (selectedTrack) {
			return controller.actions.track.update(selectedTrack.id, {
				spectrogram: { ...spectrogram, ...changes },
			});
		}
		return controller.actions.preferences.update({
			spectrogram: { ...defaultSpectrogram, ...changes },
		});
	};
	const updateFrequency = (name, requestedValue) => {
		const value = Number(requestedValue);
		if (!Number.isFinite(value) || value < 0 || value > nyquist) return;
		const next = { ...spectrogram, [name]: value };
		if (next.maximumFrequency <= next.minimumFrequency) return;
		run(() => updateSpectrogram({ [name]: value }));
	};
	return (
		<div
			className="kw-audio-editor__spectrogram-settings"
			data-spectrogram-settings
			data-spectrogram-target={selectedTrack ? selectedTrack.id : 'defaults'}
		>
			<p data-spectrogram-target-name>{selectedTrack?.name || copy.spectrogramDefaults}</p>
			<Button
				variant="secondary"
				onClick={() => run(() => selectedTrack
					? controller.actions.track.setSpectrogramView(selectedTrack.id)
					: controller.actions.timeline.setView('spectrogram'))}
			>{copy.spectrogramView}</Button>
			<label><span>{copy.spectrogramScale}</span>
				<select aria-label={copy.spectrogramScale} disabled={snapshot.readOnly} value={spectrogram.scale} onChange={(event) => run(() => updateSpectrogram({ scale: event.currentTarget.value }))}>
					<option value="mel">{copy.spectrogramMel}</option><option value="linear">{copy.linear}</option><option value="log">{copy.logarithmic}</option>
				</select>
			</label>
			<label><span>{copy.minimumFrequency}</span><input aria-label={copy.minimumFrequency} disabled={snapshot.readOnly} type="number" min="0" max={Math.max(0, spectrogram.maximumFrequency - 1)} step="1" value={spectrogram.minimumFrequency} onChange={(event) => updateFrequency('minimumFrequency', event.currentTarget.value)} /></label>
			<label><span>{copy.maximumFrequency}</span><input aria-label={copy.maximumFrequency} disabled={snapshot.readOnly} type="number" min={Math.min(nyquist, spectrogram.minimumFrequency + 1)} max={nyquist} step="1" value={spectrogram.maximumFrequency} onChange={(event) => updateFrequency('maximumFrequency', event.currentTarget.value)} /></label>
			<label><span>{copy.spectrogramRange}</span><input aria-label={copy.spectrogramRange} disabled={snapshot.readOnly} type="number" min="1" max="240" value={spectrogram.range} onChange={(event) => {
				const value = Number(event.currentTarget.value);
				if (Number.isFinite(value) && value >= 1 && value <= 240) run(() => updateSpectrogram({ range: value }));
			}} /></label>
			<label><span>{copy.spectrogramWindow}</span>
				<select aria-label={copy.spectrogramWindow} disabled={snapshot.readOnly} value={spectrogram.windowSize} onChange={(event) => run(() => updateSpectrogram({ windowSize: Number(event.currentTarget.value) }))}>
					{[512, 1024, 2048, 4096, 8192].map((value) => <option key={value} value={value}>{value}</option>)}
				</select>
			</label>
			<label><span>{copy.spectrogramWindowType}</span>
				<select aria-label={copy.spectrogramWindowType} disabled={snapshot.readOnly} value={spectrogram.windowType} onChange={(event) => run(() => updateSpectrogram({ windowType: event.currentTarget.value }))}>
					<option value="hann">{copy.spectrogramWindowHann}</option><option value="hamming">{copy.spectrogramWindowHamming}</option><option value="blackman">{copy.spectrogramWindowBlackman}</option>
				</select>
			</label>
		</div>
	);
}

function VideoPreviewPanel({ controller, snapshot, copy }) {
	const positionFrame = useAudioEditorTelemetrySelector(
		controller,
		(value) => Math.max(0, Number(value.positionFrame) || 0),
	);
	const transportState = useAudioEditorTelemetrySelector(
		controller,
		(value) => value.transportState || 'stopped',
	);
	const playbackRate = useAudioEditorTelemetrySelector(
		controller,
		(value) => Math.max(0.001, Number(value.playbackRate) || 1),
	);
	const project = snapshot.project;
	const layers = useMemo(() => {
		if (!project) return [];
		try {
			return resolveActiveVideoLayers(project, positionFrame);
		} catch {
			return [];
		}
	}, [positionFrame, project]);
	const missingSourceIds = useMemo(
		() => new Set(snapshot.missingSourceIds || []),
		[snapshot.missingSourceIds],
	);
	const resolvedLayers = layers.map((layer) => ({
		...layer,
		clips: (layer.clips || []).map((entry) => {
			const visual = controller.actions.video?.getClipVisualData?.(entry.clipId)
				|| controller.actions.timeline.getClipVisualData?.(entry.clipId);
			const sourceUrl = visual?.mediaUrl || visual?.url || null;
			return {
				...entry,
				sourceUrl,
				available: Boolean(
					entry.source
					&& sourceUrl
					&& visual?.available !== false
					&& !missingSourceIds.has(entry.sourceId),
				),
			};
		}),
	}));
	const activeEntries = resolvedLayers.flatMap((layer) => layer.clips);
	const renderableEntries = activeEntries.filter((entry) => entry.available);
	const unavailableCount = activeEntries.length - renderableEntries.length;
	const topActiveEntry = [...activeEntries].reverse().find((entry) => entry.opacity > 0) || null;

	return (
		<div
			className="kw-audio-editor__video-preview"
			data-video-preview
			data-active-clip-id={topActiveEntry?.clipId || ''}
			data-active-clip-ids={activeEntries.map((entry) => entry.clipId).join(' ')}
			data-active-track-count={resolvedLayers.length}
			data-renderable-clip-count={renderableEntries.length}
			data-unavailable-clip-count={unavailableCount}
		>
			{resolvedLayers.map((layer) => {
				const renderableClips = layer.clips.filter((entry) => entry.available);
				return (
					<div
						key={layer.trackId}
						className="kw-audio-editor__video-preview-layer"
						data-video-preview-layer
						data-track-id={layer.trackId}
						data-track-index={layer.trackIndex}
					>
						{renderableClips.map((entry) => (
							<VideoPreviewClip
								key={entry.clipId}
								entry={entry}
								transportState={transportState}
								transportPlaybackRate={playbackRate}
								copy={copy}
							/>
						))}
					</div>
				);
			})}
			{!renderableEntries.length && (
				<div className="kw-audio-editor__video-preview-empty" role="status">
					{activeEntries.length ? copy.videoPreviewUnavailable : copy.videoPreviewEmpty}
				</div>
			)}
			{unavailableCount > 0 && renderableEntries.length > 0 && (
				<div
					className="kw-audio-editor__video-preview-status"
					data-video-preview-unavailable
					role="status"
				>
					{copy.videoPreviewUnavailable}
				</div>
			)}
		</div>
	);
}

function VideoPreviewClip({
	entry,
	transportState,
	transportPlaybackRate,
	copy,
}) {
	const videoRef = useRef(null);
	const syncVideo = useCallback(() => {
		const video = videoRef.current;
		if (!video) return;
		const targetTime = Math.max(0, Number(entry.sourceTimeSeconds) || 0);
		if (Math.abs((Number(video.currentTime) || 0) - targetTime) > 0.08) {
			try {
				video.currentTime = targetTime;
			} catch {
				// Metadata can still be loading; media readiness callbacks retry the seek.
			}
		}
		video.playbackRate = Math.max(
			0.0625,
			Math.min(16, (Number(entry.playbackRate) || 1) * transportPlaybackRate),
		);
		if (transportState === 'playing') {
			void video.play?.().catch(() => undefined);
		} else video.pause?.();
	}, [
		entry.playbackRate,
		entry.sourceTimeSeconds,
		transportPlaybackRate,
		transportState,
	]);

	useEffect(() => {
		syncVideo();
	}, [syncVideo]);

	useEffect(() => () => {
		videoRef.current?.pause?.();
	}, []);

	const opacity = Math.max(0, Math.min(1, Number(entry.opacity) || 0));
	return (
		<video
			ref={videoRef}
			className="kw-audio-editor__video-preview-clip"
			data-video-preview-clip
			data-clip-id={entry.clipId}
			data-transition-role={entry.role || 'single'}
			data-opacity={opacity}
			src={entry.sourceUrl}
			muted
			playsInline
			preload="auto"
			aria-label={`${copy.panelVideoPreview}: ${entry.clip?.title || entry.source?.name || copy.videoClip}`}
			style={{
				opacity,
				mixBlendMode: entry.role === 'incoming' ? 'plus-lighter' : 'normal',
			}}
			onLoadedMetadata={syncVideo}
			onCanPlay={syncVideo}
		/>
	);
}

function ProjectBinPanel({ controller, snapshot, copy, locale, fileService, run, blocked }) {
	const inputRef = useRef(null);
	const dragDepthRef = useRef(0);
	const [dropActive, setDropActive] = useState(false);
	const project = snapshot.project;
	const clips = project?.projectBin?.clips || [];
	const items = projectBinItems(clips);
	const sourceById = new Map((project?.sources || []).map((source) => [source.id, source]));
	const missingSourceIds = new Set(snapshot.missingSourceIds || []);
	const mutationBlocked = Boolean(blocked || snapshot.readOnly);
	const positionFrame = useAudioEditorTelemetrySelector(
		controller,
		(telemetry) => Math.max(0, Number(telemetry.positionFrame) || 0),
	);
	const selectedMediaTrack = project?.tracks.find((track) => (
		track.id === snapshot.selectedTrackId && ['audio', 'video'].includes(track.type)
	)) || null;

	const importFiles = (files) => {
		if (mutationBlocked || !files.length) return undefined;
		return controller.actions.project.importFiles(files, { destination: 'project-bin' });
	};
	const chooseFiles = () => run(async () => {
		if (mutationBlocked) return;
		if (!fileService.isDesktop) {
			inputRef.current?.click();
			return;
		}
		const descriptors = await fileService.chooseFiles({ purpose: 'media', multiple: true });
		const files = [];
		for (const descriptor of descriptors) files.push(await fileService.openReadDescriptor(descriptor));
		if (files.length) await importFiles(files);
	});
	const isFileDrag = (dataTransfer) => {
		const types = [...(dataTransfer?.types || [])];
		return types.includes('Files') || [...(dataTransfer?.items || [])].some((item) => item.kind === 'file');
	};
	const resetDropState = (element = null) => {
		dragDepthRef.current = 0;
		setDropActive(false);
		element?.removeAttribute('data-drop-active');
	};

	return (
		<div
			className="kw-audio-editor__project-bin"
			data-project-bin-drop-target
			data-drop-active={dropActive ? 'true' : 'false'}
			data-project-bin-disabled={mutationBlocked ? 'true' : 'false'}
			aria-disabled={mutationBlocked ? 'true' : undefined}
			onDragEnter={(event) => {
				if (mutationBlocked || !isFileDrag(event.dataTransfer)) return;
				event.preventDefault();
				event.stopPropagation();
				dragDepthRef.current += 1;
				setDropActive(true);
			}}
			onDragOver={(event) => {
				if (mutationBlocked || !isFileDrag(event.dataTransfer)) return;
				event.preventDefault();
				event.stopPropagation();
				event.dataTransfer.dropEffect = 'copy';
				setDropActive(true);
			}}
			onDragLeave={(event) => {
				if (!isFileDrag(event.dataTransfer)) return;
				event.stopPropagation();
				dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
				if (!dragDepthRef.current) setDropActive(false);
			}}
			onDrop={(event) => {
				if (!isFileDrag(event.dataTransfer)) return;
				event.preventDefault();
				event.stopPropagation();
				resetDropState(event.currentTarget);
				if (mutationBlocked) return;
				const files = [...(event.dataTransfer.files || [])];
				if (files.length) run(() => importFiles(files));
			}}
		>
			<input
				ref={inputRef}
				className="kw-audio-editor__file-input"
				data-project-bin-input
				aria-label={copy.projectBinImport}
				type="file"
				tabIndex={-1}
				accept={AUDIO_EDITOR_AUDIO_FILE_ACCEPT}
				multiple
				onChange={(event) => {
					const files = [...event.currentTarget.files];
					event.currentTarget.value = '';
					if (files.length) run(() => importFiles(files));
				}}
			/>
			<div className="kw-audio-editor__project-bin-import" data-project-bin-import>
				<div aria-hidden="true" className="kw-audio-editor__project-bin-import-icon">＋</div>
				<p>
					<strong>{copy.projectBinDropTitle}</strong>
					<span>{copy.projectBinDropHint}</span>
				</p>
				<Button variant="secondary" disabled={mutationBlocked} onClick={chooseFiles}>
					{copy.projectBinImport}
				</Button>
			</div>
			{snapshot.readOnly && (
				<p className="kw-audio-editor__project-bin-notice" role="status">{copy.projectBinReadOnly}</p>
			)}
			{!snapshot.readOnly && blocked && (
				<p className="kw-audio-editor__project-bin-notice" role="status">{copy.projectBinBusy}</p>
			)}
			{items.length ? (
				<ul className="kw-audio-editor__project-bin-list" data-project-bin-list>
					{items.map((item) => (
						<ProjectBinCard
							key={item.id}
							clip={item.primaryClip}
							itemClips={item.clips}
							source={sourceById.get(item.primaryClip.sourceId) || null}
							sources={item.clips.map((clip) => sourceById.get(clip.sourceId) || null)}
							project={project}
							controller={controller}
							copy={copy}
							locale={locale}
							mutationBlocked={mutationBlocked}
							missing={item.clips.some((clip) => missingSourceIds.has(clip.sourceId))}
							selectedMediaTrack={selectedMediaTrack}
							positionFrame={positionFrame}
							run={run}
							onDragEnd={(element) => resetDropState(element)}
						/>
					))}
				</ul>
			) : (
				<p className="kw-audio-editor__panel-empty kw-audio-editor__project-bin-empty">
					{copy.projectBinEmpty}
				</p>
			)}
		</div>
	);
}

function ProjectBinCard({
	clip,
	itemClips,
	source,
	sources,
	project,
	controller,
	copy,
	locale,
	mutationBlocked,
	missing,
	selectedMediaTrack,
	positionFrame,
	run,
	onDragEnd,
}) {
	let visual = null;
	try {
		visual = controller.actions.projectBin.getVisualData(clip.id);
	} catch {
		// The source can still be activating while the project document is already visible.
	}
	const unavailable = Boolean(missing || !source || visual?.available === false);
	const disabled = mutationBlocked || unavailable;
	const name = clip.title || source?.name || copy.clip;
	const waveformPath = projectBinWaveformPath(visual, clip);
	const transformBadges = [...new Set(itemClips.flatMap((itemClip, index) => (
		projectBinTransformBadges(itemClip, sources[index], copy)
	)))];
	const format = formatProjectBinSource(source, copy);
	const duration = formatProjectBinDuration(clip.durationFrames, project?.sampleRate, locale);
	const videoClip = itemClips.find((itemClip) => itemClip.kind === 'video') || null;
	const posterUrl = visual?.posterUrl || visual?.thumbnails?.[0]?.url || null;

	return (
		<li
			className={`kw-audio-editor__project-bin-card${unavailable ? ' kw-audio-editor__project-bin-card--unavailable' : ''}`}
			data-project-bin-item={clip.binItemId || clip.id}
			data-project-bin-media-kind={videoClip ? 'video' : 'audio'}
			data-source-id={clip.sourceId}
			data-unavailable={unavailable ? 'true' : 'false'}
			draggable={!disabled}
			onDragStart={(event) => {
				if (disabled) {
					event.preventDefault();
					return;
				}
				event.dataTransfer.effectAllowed = 'copy';
				event.dataTransfer.setData(
					AUDIO_EDITOR_PROJECT_BIN_DRAG_TYPE,
					createProjectBinDragPayload(project.id, clip.id),
				);
				event.dataTransfer.setData('text/plain', name);
				event.currentTarget.dataset.dragging = 'true';
			}}
			onDragEnd={(event) => {
				delete event.currentTarget.dataset.dragging;
				clearActiveProjectBinDragPayload();
				onDragEnd(event.currentTarget.closest('[data-project-bin-drop-target]'));
			}}
		>
			{videoClip ? (
				<div
					className="kw-audio-editor__project-bin-video"
					data-project-bin-video
					aria-label={`${copy.videoClip}: ${name}`}
					role="img"
				>
					{posterUrl
						? <img src={posterUrl} alt="" draggable="false" />
						: <span aria-hidden="true">▶</span>}
					<span>{itemClips.some((itemClip) => itemClip.kind === 'audio') ? copy.videoHasAudio : copy.videoSilent}</span>
				</div>
			) : (
				<div
					className="kw-audio-editor__project-bin-waveform"
					data-project-bin-waveform
					aria-label={`${copy.projectBinWaveform}: ${name}`}
					role="img"
				>
					<svg viewBox="0 0 160 44" preserveAspectRatio="none" aria-hidden="true" focusable="false">
						<path className="kw-audio-editor__project-bin-waveform-zero" d="M0 22 H160" />
						{waveformPath && <path className="kw-audio-editor__project-bin-waveform-peaks" d={waveformPath} />}
					</svg>
				</div>
			)}
			<div className="kw-audio-editor__project-bin-card-body">
				<ProjectBinNameEditor
					clip={clip}
					name={name}
					copy={copy}
					disabled={mutationBlocked}
					onCommit={(nextName) => run(() => controller.actions.projectBin.rename(clip.id, nextName))}
				/>
				<p className="kw-audio-editor__project-bin-meta">
					<span>{duration}</span>
					<span aria-hidden="true">·</span>
					<span>{format}</span>
				</p>
				{transformBadges.length > 0 && (
					<ul className="kw-audio-editor__project-bin-badges" aria-label={copy.projectBinTransformations}>
						{transformBadges.map((badge) => <li key={badge}>{badge}</li>)}
					</ul>
				)}
				{unavailable && (
					<p className="kw-audio-editor__project-bin-unavailable" role="status">
						{copy.projectBinUnavailable}
					</p>
				)}
				<div className="kw-audio-editor__project-bin-card-actions">
					<Button
						variant="secondary"
						disabled={disabled}
						onClick={() => run(() => controller.actions.projectBin.place(clip.id, {
							...(selectedMediaTrack ? { trackId: selectedMediaTrack.id } : {}),
							timelineStartFrame: positionFrame,
						}))}
					>
						{copy.projectBinAddToTimeline}
					</Button>
					<Button
						variant="secondary"
						disabled={mutationBlocked}
						aria-label={`${copy.projectBinDelete}: ${name}`}
						onClick={() => run(() => controller.actions.projectBin.remove(clip.id))}
					>
						{copy.projectBinDelete}
					</Button>
				</div>
			</div>
		</li>
	);
}

function projectBinItems(clips) {
	const grouped = new Map();
	for (const clip of clips || []) {
		const id = clip.binItemId || clip.id;
		const item = grouped.get(id) || [];
		item.push(clip);
		grouped.set(id, item);
	}
	return [...grouped].map(([id, itemClips]) => Object.freeze({
		id,
		clips: Object.freeze(itemClips),
		primaryClip: itemClips.find((clip) => clip.kind === 'video') || itemClips[0],
	}));
}

function ProjectBinNameEditor({ clip, name, copy, disabled, onCommit }) {
	const [draft, setDraft] = useState(name);
	useEffect(() => setDraft(name), [clip.id, name]);
	const commit = () => {
		const nextName = draft.trim();
		if (!nextName) {
			setDraft(name);
			return;
		}
		if (nextName !== name) onCommit(nextName);
	};
	return (
		<label className="kw-audio-editor__project-bin-name">
			<span className="kw-audio-editor-sr-only">{copy.projectBinRename}</span>
			<input
				data-project-bin-name
				aria-label={`${copy.projectBinRename}: ${name}`}
				value={draft}
				disabled={disabled}
				onChange={(event) => setDraft(event.currentTarget.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === 'Enter') event.currentTarget.blur();
					else if (event.key === 'Escape') {
						event.preventDefault();
						setDraft(name);
						event.currentTarget.blur();
					}
				}}
			/>
		</label>
	);
}

function projectBinTransformBadges(clip, source, copy) {
	const badges = [];
	const sourceEnd = (clip.sourceStartFrame || 0) + (clip.sourceDurationFrames || clip.durationFrames);
	if ((clip.trimStartFrames || 0) > 0
		|| (clip.trimEndFrames || 0) > 0
		|| (clip.sourceStartFrame || 0) > 0
		|| (source?.frameCount && sourceEnd < source.frameCount)) badges.push(copy.projectBinTransformTrim);
	if (Math.abs((clip.gain ?? 1) - 1) > 1e-9) badges.push(copy.projectBinTransformGain);
	if ((clip.fadeInFrames || 0) > 0 || (clip.fadeOutFrames || 0) > 0) badges.push(copy.projectBinTransformFade);
	if (clip.envelope?.length) badges.push(copy.projectBinTransformEnvelope);
	if (clip.reversed) badges.push(copy.projectBinTransformReverse);
	if (Math.abs(clip.pitchCents || 0) > 1e-9) badges.push(copy.projectBinTransformPitch);
	if (Math.abs((clip.speedRatio ?? 1) - 1) > 1e-9 || clip.stretchToTempo) {
		badges.push(copy.projectBinTransformSpeed);
	}
	if (clip.preserveFormants) badges.push(copy.projectBinTransformFormants);
	if ((clip.renderCacheRevision || 0) > 0) badges.push(copy.projectBinTransformRendered);
	return badges;
}

function formatProjectBinDuration(durationFrames, sampleRate, locale) {
	const seconds = Math.max(0, Number(durationFrames) || 0) / Math.max(1, Number(sampleRate) || 48_000);
	const wholeMinutes = Math.floor(seconds / 60);
	const remaining = seconds - wholeMinutes * 60;
	const number = new Intl.NumberFormat(locale, {
		minimumIntegerDigits: 2,
		minimumFractionDigits: remaining < 10 ? 1 : 0,
		maximumFractionDigits: 1,
	}).format(remaining);
	return `${wholeMinutes}:${number}`;
}

function formatProjectBinSource(source, copy) {
	if (!source) return copy.projectBinUnknownFormat;
	const mimeSubtype = String(source.mimeType || '')
		.replace(/^(?:audio|video)\//i, '')
		.replace(/^x-/i, '')
		.replace('mpeg', 'mp3');
	const format = mimeSubtype ? mimeSubtype.toUpperCase() : copy.projectBinUnknownFormat;
	if (source.kind === 'video') {
		const resolution = source.width && source.height ? `${source.width}×${source.height}` : copy.videoResolution;
		return `${format} · ${resolution}`;
	}
	const channels = Number(source.channelCount) === 1
		? copy.projectBinMono
		: copy.projectBinChannels.replace('{count}', String(source.channelCount || 0));
	return `${format} · ${channels}`;
}

function projectBinWaveformPath(visual, clip, width = 160, height = 44) {
	if (!visual) return '';
	const ranges = projectBinPeakRanges(visual, clip, width);
	if (!ranges.length) return '';
	const middle = height / 2;
	const amplitude = Math.max(1, middle - 3);
	return ranges.map(({ minimum, maximum }, index) => {
		const x = ranges.length === 1 ? width / 2 : index * width / (ranges.length - 1);
		const top = middle - Math.max(-1, Math.min(1, maximum)) * amplitude;
		const bottom = middle - Math.max(-1, Math.min(1, minimum)) * amplitude;
		return `M${x.toFixed(2)} ${top.toFixed(2)}V${bottom.toFixed(2)}`;
	}).join('');
}

function projectBinPeakRanges(visual, clip, maximumColumns) {
	const sourceStartFrame = Math.max(0, Number(clip.sourceStartFrame) || 0);
	const sourceDurationFrames = Math.max(1, Number(clip.sourceDurationFrames || clip.durationFrames) || 1);
	const levels = visual.peaks?.levels || [];
	let level = levels[levels.length - 1] || null;
	for (const candidate of levels) {
		const count = Math.ceil(sourceDurationFrames / Math.max(1, Number(candidate.blockSize) || 1));
		if (count <= maximumColumns) {
			level = candidate;
			break;
		}
	}
	if (level?.minimums?.length && level?.maximums?.length) {
		const blockSize = Math.max(1, Number(level.blockSize) || 1);
		const start = Math.max(0, Math.floor(sourceStartFrame / blockSize));
		const end = Math.min(
			level.minimums.length,
			Math.max(start + 1, Math.ceil((sourceStartFrame + sourceDurationFrames) / blockSize)),
		);
		return aggregateProjectBinRanges(level.minimums, level.maximums, start, end, maximumColumns);
	}
	const buffer = visual.buffer;
	if (!buffer?.numberOfChannels || !buffer.length || typeof buffer.getChannelData !== 'function') return [];
	const end = Math.min(buffer.length, sourceStartFrame + sourceDurationFrames);
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
	const columns = Math.max(1, Math.min(maximumColumns, end - sourceStartFrame));
	const ranges = [];
	for (let column = 0; column < columns; column += 1) {
		const startFrame = Math.floor(sourceStartFrame + column * (end - sourceStartFrame) / columns);
		const endFrame = Math.max(startFrame + 1, Math.ceil(sourceStartFrame + (column + 1) * (end - sourceStartFrame) / columns));
		let minimum = 1;
		let maximum = -1;
		const stride = Math.max(1, Math.floor((endFrame - startFrame) / 32));
		for (let frame = startFrame; frame < endFrame; frame += stride) {
			let sample = 0;
			for (const channel of channels) sample += (Number(channel[frame]) || 0) / channels.length;
			minimum = Math.min(minimum, sample);
			maximum = Math.max(maximum, sample);
		}
		ranges.push({ minimum, maximum });
	}
	return ranges;
}

function aggregateProjectBinRanges(minimums, maximums, start, end, maximumColumns) {
	const columns = Math.max(1, Math.min(maximumColumns, end - start));
	const ranges = [];
	for (let column = 0; column < columns; column += 1) {
		const rangeStart = Math.floor(start + column * (end - start) / columns);
		const rangeEnd = Math.max(rangeStart + 1, Math.ceil(start + (column + 1) * (end - start) / columns));
		let minimum = 1;
		let maximum = -1;
		for (let index = rangeStart; index < rangeEnd; index += 1) {
			minimum = Math.min(minimum, Number(minimums[index]) || 0);
			maximum = Math.max(maximum, Number(maximums[index]) || 0);
		}
		ranges.push({ minimum, maximum });
	}
	return ranges;
}

function AudioEditorMixerPanel({ controller, snapshot, copy, run, showArmControls, displayAudioSupported, onOpenEffects }) {
	const meters = useAudioEditorTelemetrySelector(controller, (telemetry) => telemetry.meters);
	const project = snapshot.project;
	const tracks = (project?.tracks || []).filter((track) => track.type === 'audio');
	const groups = project?.mixer?.groups || [];
	const sends = project?.mixer?.sends || [];
	const routes = project?.mixer?.routes || {};
	const mixerBuses = [
		...groups.map((bus) => ({ type: 'group', bus })),
		...sends.map((bus) => ({ type: 'send', bus })),
	];
	const effectLabels = new Map((snapshot.effects?.rackTypes || []).map(({ type, label }) => [type, label]));
	const effectProps = (effects, scope, targetId) => (effects || []).map((effect) => ({
		name: rackEffectLabel(effect, effectLabels, copy),
		enabled: effect.type === 'missing'
			? effect.enabled !== false
			: effect.enabled !== false && effect.bypassed !== true,
		onToggle: () => run(() => controller.actions.effects.update(scope, targetId, effect.id, { enabled: effect.enabled === false })),
		onRemoveEffect: () => run(() => controller.actions.effects.remove(scope, targetId, effect.id)),
		...(scope !== 'master' ? { onClick: () => onOpenEffects(targetId, null, scope) } : {}),
	}));
	const channelProps = (channel, type) => {
		const isTrack = type === 'track';
		const isMaster = type === 'master';
		const targetId = channel.id || 'master';
		const scope = isTrack ? 'track' : type;
		const meter = isMaster ? meters?.master : meters?.[`${type}s`]?.[targetId];
		const update = (changes) => {
			if (isTrack) return controller.actions.track.update(targetId, changes);
			if (isMaster) return controller.actions.mixer.updateMaster(changes);
			return controller.actions.mixer.updateBus(type, targetId, changes);
		};
		return {
			className: `kw-audio-editor__mixer-channel kw-audio-editor__mixer-channel--${type}`,
			trackName: isMaster ? copy.master : channel.name,
			trackColor: mixerChannelColor(channel.color, type),
			variant: 'stereo',
			volume: linearMixerGainToDb(channel.gain),
			pan: Math.round((channel.pan || 0) * 100),
			muted: Boolean(channel.mute),
			soloed: Boolean(channel.solo),
			meterLeft: mixerMeterPercent(meter),
			meterRight: mixerMeterPercent(meter),
			effects: effectProps(channel.effects, scope, targetId),
			onVolumeChange: (value) => run(() => update({ gain: mixerDbToLinearGain(value) })),
			onPanChange: (value) => run(() => update({ pan: Math.max(-1, Math.min(1, Number(value) / 100)) })),
			onMuteToggle: () => run(() => update({ mute: !channel.mute })),
			onSoloToggle: () => run(() => update({ solo: !channel.solo })),
			...(isTrack ? {
				onAddEffect: () => onOpenEffects(targetId, null, scope),
				...(sends.length ? {
					effectFooter: <MixerSendControls
						track={channel}
						route={routes[targetId] || { sends: {} }}
						sends={sends}
						copy={copy}
						disabled={snapshot.readOnly}
						onChange={(sendId, gain) => run(() => controller.actions.mixer.setSend(targetId, sendId, gain))}
					/>,
				} : {}),
				...(showArmControls ? {
					inputControls: (
						<RecordingInputSelectors
							controller={controller}
							recordingInputs={snapshot.recordingInputs}
							track={channel}
							copy={copy}
							run={run}
							displayAudioSupported={displayAudioSupported}
							disabled={snapshot.readOnly || snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling || snapshot.scheduledRecording}
							surface="mixer"
						/>
					),
				} : {}),
			} : !isMaster ? {
				onAddEffect: () => onOpenEffects(targetId, null, scope),
			} : {}),
		};
	};
	const channels = [
		...tracks.map((track) => ({ id: track.id, channelProps: channelProps(track, 'track') })),
		...mixerBuses.map(({ type, bus }) => ({ id: bus.id, channelProps: channelProps(bus, type) })),
	];
	const addBus = (type) => run(() => controller.actions.mixer.addBus(type, {
		name: `${type === 'group' ? copy.groupBus : copy.sendBus} ${(type === 'group' ? groups : sends).length + 1}`,
	}));
	return (
		<div className="kw-audio-editor__mixer" data-mixer-panel>
			<div className="kw-audio-editor__mixer-toolbar">
				<strong>{copy.mixerRouting}</strong>
				{showArmControls && <Button
					variant="secondary"
					disabled={snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling || snapshot.scheduledRecording || typeof controller.actions.recording.requestInputAccess !== 'function'}
					onClick={() => run(() => snapshot.recordingInputs?.hasOpenInputs
						? controller.actions.recording.refreshInputs()
						: controller.actions.recording.requestInputAccess())}
				>{snapshot.recordingInputs?.hasOpenInputs ? copy.recordingRefreshInputs : copy.recordingAllowInputs}</Button>}
				{snapshot.recordingInputs?.hasOpenInputs && <Button
					variant="secondary"
					disabled={snapshot.recording || snapshot.recordingStarting || snapshot.recordingScheduling || snapshot.scheduledRecording}
					onClick={() => run(() => controller.actions.recording.releaseInputs())}
				>{copy.recordingReleaseInputs}</Button>}
				<Button variant="secondary" disabled={snapshot.readOnly} onClick={() => addBus('group')}>{copy.addGroupBus}</Button>
				<Button variant="secondary" disabled={snapshot.readOnly} onClick={() => addBus('send')}>{copy.addSendBus}</Button>
				{mixerBuses.length > 0 && <select aria-label={copy.removeBus} disabled={snapshot.readOnly} value="" onChange={(event) => {
					const selected = mixerBuses.find(({ type, bus }) => `${type}:${bus.id}` === event.currentTarget.value);
					if (selected) run(() => controller.actions.mixer.removeBus(selected.type, selected.bus.id));
				}}>
					<option value="">{copy.removeBus}</option>
					{mixerBuses.map(({ type, bus }) => <option key={bus.id} value={`${type}:${bus.id}`}>{type === 'group' ? copy.groupBus : copy.sendBus}: {bus.name}</option>)}
				</select>}
			</div>
			{groups.length > 0 && <div className="kw-audio-editor__mixer-routing" role="region" aria-label={copy.mixerRouting}>
				<table>
					<thead><tr><th>{copy.track}</th><th>{copy.output}</th></tr></thead>
					<tbody>{tracks.map((track) => {
						const route = routes[track.id] || { groupId: null, sends: {} };
						return <tr key={track.id}>
							<th scope="row">{track.name}</th>
							<td><select aria-label={`${copy.output}: ${track.name}`} disabled={snapshot.readOnly} value={route.groupId || ''} onChange={(event) => run(() => controller.actions.mixer.setRoute(track.id, { groupId: event.currentTarget.value || null }))}>
								<option value="">{copy.master}</option>
								{groups.map((bus) => <option key={bus.id} value={bus.id}>{bus.name}</option>)}
							</select></td>
						</tr>;
					})}</tbody>
				</table>
			</div>}
			{tracks.length || groups.length || sends.length ? <MixerPanel
				hideHeader
				className="kw-audio-editor__audacity-mixer"
				channels={channels}
				masterChannel={channelProps(project.master || {}, 'master')}
				effectFooterLabel={sends.length ? copy.sends : undefined}
			/> : <p className="kw-audio-editor__panel-empty">{copy.noAudioTrackSelected}</p>}
		</div>
	);
}

function MixerSendControls({ track, route, sends, copy, disabled, onChange }) {
	const [sendId, setSendId] = useState(() => sends[0]?.id || '');
	const selectedSend = sends.find((bus) => bus.id === sendId) || sends[0] || null;
	useEffect(() => {
		if (selectedSend?.id !== sendId) setSendId(selectedSend?.id || '');
	}, [selectedSend?.id, sendId]);
	if (!selectedSend) return null;
	const label = `${copy.sendLevel}: ${track.name} → ${selectedSend.name}`;
	const gain = linearMixerGainToDb(route.sends?.[selectedSend.id] || 0);
	return (
		<div className="kw-audio-editor__mixer-send-controls" data-mixer-sends={track.id}>
			<MixerSendKnob label={label} value={gain} disabled={disabled} onChange={(value) => onChange(selectedSend.id, mixerDbToLinearGain(value))} />
			<select aria-label={`${copy.sends}: ${track.name}`} disabled={disabled} value={selectedSend.id} onChange={(event) => setSendId(event.currentTarget.value)}>
				{sends.map((bus) => <option key={bus.id} value={bus.id}>{bus.name}</option>)}
			</select>
		</div>
	);
}

function MixerSendKnob({ label, value, disabled, onChange }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		const knob = wrapperRef.current?.querySelector('.knob');
		if (!knob) return undefined;
		knob.setAttribute('type', 'button');
		knob.setAttribute('aria-label', label);
		const handleKeyDown = (event) => {
			if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
			event.preventDefault();
			if (event.key === 'Home') onChange(-60);
			else if (event.key === 'End') onChange(12);
			else onChange(Math.max(-60, Math.min(12, value + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1))));
		};
		knob.addEventListener('keydown', handleKeyDown);
		return () => knob.removeEventListener('keydown', handleKeyDown);
	}, [label, onChange, value]);
	return <div ref={wrapperRef} className="kw-audio-editor__mixer-send-knob"><Knob value={value} min={-60} max={12} step={1} label={label} mode="unipolar" disabled={disabled} onChange={onChange} /></div>;
}

function linearMixerGainToDb(gain, floor = -60) {
	const value = Number(gain);
	return value > 0 ? Math.max(floor, Math.min(12, 20 * Math.log10(value))) : floor;
}

function mixerDbToLinearGain(db, offValue = Number.NEGATIVE_INFINITY) {
	const value = Number(db);
	return value <= offValue ? 0 : Math.min(4, 10 ** (value / 20));
}

function mixerMeterPercent(meter) {
	const db = Number(meter?.dbfs);
	return Number.isFinite(db) ? Math.max(0, Math.min(100, (db + 60) / 60 * 100)) : 0;
}

function mixerChannelColor(color, type) {
	if (typeof color === 'string' && color.startsWith('#')) return color;
	if (type === 'group') return '#4f87c8';
	if (type === 'send') return '#8c6fd1';
	if (type === 'master') return '#56606f';
	return { red: '#c95d68', orange: '#ce7a43', yellow: '#b69a3f', green: '#4d9669', blue: '#4f87c8', purple: '#8c6fd1' }[color] || '#4f87c8';
}

function LabelManagerRow({ label, sampleRate, controller, copy, disabled, run }) {
	const [title, setTitle] = useState(label.title || '');
	const [startSeconds, setStartSeconds] = useState(() => framesToSeconds(label.startFrame, { sampleRate }).toFixed(3));
	const [endSeconds, setEndSeconds] = useState(() => framesToSeconds(label.endFrame, { sampleRate }).toFixed(3));
	useEffect(() => {
		setTitle(label.title || '');
		setStartSeconds(framesToSeconds(label.startFrame, { sampleRate }).toFixed(3));
		setEndSeconds(framesToSeconds(label.endFrame, { sampleRate }).toFixed(3));
	}, [label.endFrame, label.startFrame, label.title, sampleRate]);
	const updateRange = () => {
		const startValue = Number(startSeconds);
		const endValue = Number(endSeconds);
		if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || startValue < 0 || endValue < startValue) {
			setStartSeconds(framesToSeconds(label.startFrame, { sampleRate }).toFixed(3));
			setEndSeconds(framesToSeconds(label.endFrame, { sampleRate }).toFixed(3));
			return;
		}
		const startFrame = secondsToFrames(startValue, { sampleRate });
		const endFrame = secondsToFrames(endValue, { minimumFrame: startFrame, sampleRate });
		if (startFrame === label.startFrame && endFrame === label.endFrame) return;
		run(() => controller.actions.labels.update(label.trackId, label.id, { startFrame, endFrame }));
	};
	return (
		<li data-label-id={label.id}>
			<div className="kw-audio-editor__label-manager-heading">
				<input
					aria-label={`${copy.labelTitle || copy.trackName}: ${label.trackName}`}
					value={title}
					disabled={disabled}
					onChange={(event) => setTitle(event.currentTarget.value)}
					onBlur={() => {
						if (title !== label.title) run(() => controller.actions.labels.update(label.trackId, label.id, { title }));
					}}
				/>
				<button
					type="button"
					className="kw-audio-editor__workspace-panel-close"
					aria-label={`${copy.deleteLabel || copy.liftDelete}: ${title || copy.untitledLabel}`}
					disabled={disabled}
					onClick={() => run(() => controller.actions.labels.remove(label.trackId, label.id))}
				>×</button>
			</div>
			<small>{label.trackName}</small>
			<div className="kw-audio-editor__label-manager-range">
				<label><span>{copy.selectionStart || copy.clipStart}</span><input type="number" min="0" step="0.001" value={startSeconds} disabled={disabled} onChange={(event) => setStartSeconds(event.currentTarget.value)} onBlur={updateRange} /></label>
				<label><span>{copy.selectionEnd || copy.clipDuration}</span><input type="number" min="0" step="0.001" value={endSeconds} disabled={disabled} onChange={(event) => setEndSeconds(event.currentTarget.value)} onBlur={updateRange} /></label>
			</div>
			<Button variant="secondary" onClick={() => run(() => controller.actions.timeline.setSelection(label.startFrame, label.endFrame))}>{copy.select || copy.selection}</Button>
		</li>
	);
}

function MetadataEditorField({ name, label, value, disabled, onCommit }) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const commit = () => {
		if (draft !== value) onCommit(draft);
	};
	return (
		<label>
			<span>{label}</span>
			<input
				name={name}
				value={draft}
				disabled={disabled}
				onChange={(event) => setDraft(event.currentTarget.value)}
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === 'Enter') event.currentTarget.blur();
					else if (event.key === 'Escape') {
						setDraft(value);
						event.currentTarget.blur();
					}
				}}
			/>
		</label>
	);
}

function WorkspacePreferencesDialog({
	controller,
	snapshot,
	copy,
	locale,
	fileService,
	menus,
	run,
	initialPage = 'shortcuts',
	isPanelVisible = null,
	onTogglePanel,
	onClose,
}) {
	const panelRef = useRef(null);
	const sideNavRef = useRef(null);
	const [selectedPage, setSelectedPage] = useState(initialPage);
	const [shortcutSearch, setShortcutSearch] = useState('');
	const [workspaceName, setWorkspaceName] = useState('');
	const preferences = snapshot.preferences;
	const commands = useMemo(() => collectAudacityShortcutCommands(menus, { locale, copy }), [copy, locale, menus]);
	const visibleCommands = commands.filter((command) => `${command.label} ${command.id}`.toLowerCase().includes(shortcutSearch.trim().toLowerCase()));
	const activeCustom = preferences.workspace.custom.find((workspace) => workspace.id === preferences.workspace.activeId);
	const pages = [
		{ id: 'appearance', label: copy.appearance, icon: iconNameToChar('BRUSH') },
		{ id: 'editing', label: copy.preferencesEditing, icon: iconNameToChar('WAVEFORM') },
		{ id: 'workspace', label: copy.workspace, icon: iconNameToChar('WORKSPACE') },
		{ id: 'panels', label: copy.panels, icon: iconNameToChar('SPLIT_VIEW_VERTICAL') },
		{ id: 'shortcuts', label: copy.shortcuts, icon: iconNameToChar('SHORTCUTS') },
	];
	const selectedPageLabel = pages.find((page) => page.id === selectedPage)?.label || copy.preferencesTitle;
	const appearanceTheme = preferences.appearance.theme;
	const highContrastTheme = appearanceTheme.startsWith('high-contrast');
	const darkAppearanceTheme = appearanceTheme.endsWith('dark');
	const setAppearanceTheme = (theme) => run(() => controller.actions.preferences.setTheme(theme));
	const renderedThemeIsDark = () => darkAppearanceTheme
		|| (appearanceTheme === 'system' && document.documentElement.dataset.theme === 'dark');
	useEffect(() => setSelectedPage(initialPage), [initialPage]);
	const handleSideNavKeyDown = (event) => {
		if (!event.target.closest('[role="tab"]') || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		event.stopPropagation();
		const currentIndex = Math.max(0, pages.findIndex((page) => page.id === selectedPage));
		const nextIndex = event.key === 'Home'
			? 0
			: event.key === 'End'
				? pages.length - 1
				: (currentIndex + (['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1) + pages.length) % pages.length;
		const nextPage = pages[nextIndex];
		setSelectedPage(nextPage.id);
		queueMicrotask(() => sideNavRef.current?.querySelector(`[aria-controls="dialog-panel-${nextPage.id}"]`)?.focus());
	};

	useEffect(() => {
		const previous = document.activeElement;
		panelRef.current?.focus();
		const onKeyDown = (event) => {
			if (event.key === 'Escape') { event.preventDefault(); onClose(); }
		};
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
			if (previous instanceof HTMLElement) previous.focus();
		};
	}, [onClose]);

	useEffect(() => {
		sideNavRef.current?.querySelectorAll('[role="tab"]').forEach((tab) => {
			tab.tabIndex = tab.getAttribute('aria-controls') === `dialog-panel-${selectedPage}` ? 0 : -1;
		});
	}, [selectedPage]);

	return (
		<div className="kw-audio-editor-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<AudioEditorResizableSurface ref={panelRef} tabIndex={-1} className="kw-audio-editor-dialog kw-audio-editor-preferences" role="dialog" aria-modal="true" aria-label={copy.preferencesTitle} resizeLabel={`Resize: ${copy.preferencesTitle}`}>
				<DialogHeader title={copy.preferencesTitle} os="windows" onClose={onClose} />
				<div className="kw-audio-editor-preferences__body">
					<div ref={sideNavRef} className="kw-audio-editor-preferences__sidebar-adapter" onKeyDownCapture={handleSideNavKeyDown}>
						<DialogSideNav
							items={pages}
							selectedId={selectedPage}
							onSelectId={setSelectedPage}
							ariaLabel={copy.preferencesTitle}
							className="kw-audio-editor-preferences__sidebar"
						/>
					</div>
					<main
						className="kw-audio-editor-preferences__page"
						role="tabpanel"
						id={`dialog-panel-${selectedPage}`}
						aria-label={selectedPageLabel}
					>
						{selectedPage === 'appearance' && (
							<div className="kw-audio-editor-preferences__appearance">
								{fileService.isDesktop && (
									<>
										<PreferencePanel title={copy.languageLabel}>
											<PreferenceDropdownField
												label={copy.languageLabel}
												value={locale}
												onChange={(value) => run(async () => {
													await controller.actions.project.flush();
													await fileService.setLocale(value);
												})}
												options={ROUTE_LOCALES.map((descriptor) => ({
													value: descriptor.locale,
													label: descriptor.nativeName,
												}))}
											/>
										</PreferencePanel>
										<Separator />
									</>
								)}
								<PreferencePanel title={highContrastTheme ? copy.highContrastTheme : copy.theme}>
									<div className="kw-audio-editor-preferences__thumbnails">
										<PreferenceChoice
											selectLabel={copy.selectPreference}
											src={preferencePreview(highContrastTheme ? 'high-contrast-light' : 'light')}
											alt={highContrastTheme ? copy.themeHighContrastLight : copy.themeLight}
											label={highContrastTheme ? copy.themeHighContrastLight : copy.themeLight}
											checked={appearanceTheme === (highContrastTheme ? 'high-contrast-light' : 'light')}
											onChange={(checked) => checked && setAppearanceTheme(highContrastTheme ? 'high-contrast-light' : 'light')}
											name="audio-editor-theme"
											value={highContrastTheme ? 'high-contrast-light' : 'light'}
										/>
										<PreferenceChoice
											selectLabel={copy.selectPreference}
											src={preferencePreview(highContrastTheme ? 'high-contrast-dark' : 'dark')}
											alt={highContrastTheme ? copy.themeHighContrastDark : copy.themeDark}
											label={highContrastTheme ? copy.themeHighContrastDark : copy.themeDark}
											checked={appearanceTheme === (highContrastTheme ? 'high-contrast-dark' : 'dark')}
											onChange={(checked) => checked && setAppearanceTheme(highContrastTheme ? 'high-contrast-dark' : 'dark')}
											name="audio-editor-theme"
											value={highContrastTheme ? 'high-contrast-dark' : 'dark'}
										/>
									</div>
									<div className="kw-audio-editor-preferences__appearance-checks">
										<PreferenceCheckbox
											label={copy.followSystemTheme}
											checked={appearanceTheme === 'system'}
											onChange={(checked) => setAppearanceTheme(checked ? 'system' : renderedThemeIsDark() ? 'dark' : 'light')}
										/>
										<PreferenceCheckbox
											label={copy.enableHighContrast}
											checked={highContrastTheme}
											onChange={(checked) => setAppearanceTheme(checked
												? renderedThemeIsDark() ? 'high-contrast-dark' : 'high-contrast-light'
												: renderedThemeIsDark() ? 'dark' : 'light')}
										/>
									</div>
								</PreferencePanel>
								<Separator />
								<PreferencePanel title={copy.clipStyle}>
									<div className="kw-audio-editor-preferences__thumbnails">
										<PreferenceChoice
											selectLabel={copy.selectPreference}
											src={preferencePreview('colorful')}
											alt={copy.clipStyleColorful}
											label={copy.clipStyleColorful}
											checked={preferences.appearance.clipStyle === 'colorful'}
											onChange={(checked) => checked && run(() => controller.actions.preferences.setClipStyle('colorful'))}
											name="audio-editor-clip-style"
											value="colorful"
										/>
										<PreferenceChoice
											selectLabel={copy.selectPreference}
											src={preferencePreview('classic')}
											alt={copy.clipStyleClassic}
											label={copy.clipStyleClassic}
											checked={preferences.appearance.clipStyle === 'classic'}
											onChange={(checked) => checked && run(() => controller.actions.preferences.setClipStyle('classic'))}
											name="audio-editor-clip-style"
											value="classic"
										/>
									</div>
								</PreferencePanel>
							</div>
						)}

						{selectedPage === 'workspace' && (
							<PreferencePanel title={copy.workspace}>
								<PreferenceDropdownField
									label={copy.workspacePreset}
									value={preferences.workspace.activeId}
									onChange={(value) => run(() => controller.actions.preferences.setWorkspace(value))}
									options={[
										{ value: 'modern', label: copy.workspaceModern },
										{ value: 'music', label: copy.workspaceMusic },
										{ value: 'classic', label: copy.workspaceClassic },
										{ value: 'video-editor', label: copy.workspaceVideo },
										...preferences.workspace.custom.map((workspace) => ({ value: workspace.id, label: workspace.name })),
									]}
								/>
								<label className="kw-audio-editor-preferences__workspace-name">
									<span>{copy.workspaceName}</span>
									<input aria-label={copy.workspaceName} placeholder={copy.workspaceName} value={workspaceName} onChange={(event) => setWorkspaceName(event.currentTarget.value)} />
								</label>
								<div className="kw-audio-editor__custom-workspace-actions">
									<Button variant="secondary" disabled={!workspaceName.trim()} onClick={() => {
										run(() => controller.actions.preferences.createWorkspace(workspaceName.trim()));
										setWorkspaceName('');
									}}>{copy.workspaceCreate}</Button>
									<Button variant="secondary" disabled={!activeCustom} onClick={() => run(() => controller.actions.preferences.updateWorkspace(activeCustom.id, workspaceName.trim() ? { name: workspaceName.trim() } : {}))}>{copy.workspaceUpdate}</Button>
									<Button variant="secondary" disabled={!activeCustom} onClick={() => run(() => controller.actions.preferences.deleteWorkspace(activeCustom.id))}>{copy.workspaceDelete}</Button>
								</div>
							</PreferencePanel>
						)}

						{selectedPage === 'editing' && (
							<>
								<PreferencePanel title={copy.preferencesEditing}>
									<div className="kw-audio-editor-preferences__grid">
										<PreferenceDropdownField
											label={copy.rippleEditing}
											value={preferences.editing.rippleMode}
											onChange={(value) => run(() => controller.actions.preferences.update({ editing: { rippleMode: value } }))}
											options={[
												{ value: 'off', label: copy.preferenceOff },
												{ value: 'per-track', label: copy.preferencePerTrack },
												{ value: 'all-tracks', label: copy.allTracks },
											]}
										/>
									</div>
									<div className="kw-audio-editor-preferences__checks">
										<PreferenceCheckbox
											label={copy.snapZeroCrossings}
											checked={preferences.editing.snapToZeroCrossings}
											onChange={(checked) => run(() => controller.actions.preferences.update({ editing: { snapToZeroCrossings: checked } }))}
										/>
									</div>
								</PreferencePanel>
								<Separator />
								<PreferencePanel title={copy.playAtSpeed}>
									<div className="kw-audio-editor-preferences__grid">
										<PreferenceDropdownField
											label={copy.playAtSpeedMode}
											value={preferences.playback?.playAtSpeedMode || 'naive'}
											onChange={(value) => run(() => controller.actions.preferences.update({ playback: { playAtSpeedMode: value } }))}
											options={[
												{ value: 'naive', label: copy.playAtSpeedNaive },
												{ value: 'staffpad', label: copy.playAtSpeedStaffPad },
											]}
										/>
									</div>
								</PreferencePanel>
								<Separator />
								<PreferencePanel title={copy.recordingPreferences}>
									<div className="kw-audio-editor-preferences__checks kw-audio-editor-preferences__recording">
										<PreferenceCheckbox
											label={copy.recordingKeepInputsOpen}
											checked={snapshot.recordingInputs?.retainInputs ?? preferences.recording?.retainInputs ?? true}
											onChange={(checked) => run(() => controller.actions.recording.setRetainInputs(checked))}
										/>
										<small>{copy.recordingKeepInputsOpenDescription}</small>
									</div>
								</PreferencePanel>
							</>
						)}

						{selectedPage === 'panels' && (
							<PreferencePanel title={copy.panels}>
								<div className="kw-audio-editor-preferences__panel-list">
									{WORKSPACE_PANEL_IDS.map((panelId) => {
										const panel = preferences.workspace.panels[panelId];
										const label = workspacePanelLabel(copy, panelId);
										return (
											<div key={panelId}>
												<PreferenceCheckbox
													label={label}
													checked={isPanelVisible ? isPanelVisible(panelId) : panel.visible}
													onChange={() => (
														onTogglePanel
															? onTogglePanel(panelId)
															: run(() => controller.actions.preferences.togglePanel(panelId))
													)}
												/>
												<PreferenceDropdownField
													label={`${label}: ${copy.panelDock}`}
													visuallyHiddenLabel
													value={panel.dock}
													onChange={(value) => run(() => controller.actions.preferences.setPanel(panelId, { dock: value }))}
													options={WORKSPACE_DOCK_IDS.map((dockId) => ({ value: dockId, label: workspaceDockLabel(copy, dockId) }))}
												/>
											</div>
										);
									})}
								</div>
							</PreferencePanel>
						)}

						{selectedPage === 'shortcuts' && (
							<PreferencePanel title={copy.shortcuts} className="kw-audio-editor-preferences__shortcuts">
								<label className="kw-audio-editor-preferences__search">
									<span className="kw-audio-editor-sr-only">{copy.shortcutSearch}</span>
									<input type="search" value={shortcutSearch} onChange={(event) => setShortcutSearch(event.currentTarget.value)} placeholder={copy.shortcutSearch} aria-label={copy.shortcutSearch} />
								</label>
								<div className="kw-audio-editor-preferences__shortcut-header" aria-hidden="true">
									<span>{copy.commandColumn}</span>
									<span>{copy.shortcutColumn}</span>
									<span>{copy.actionColumn}</span>
								</div>
								<div className="kw-audio-editor-preferences__shortcut-list">
									{visibleCommands.map((command) => <ShortcutEditorRow key={command.id} command={command} preferences={preferences} controller={controller} copy={copy} run={run} />)}
								</div>
								<Button variant="secondary" onClick={() => run(() => controller.actions.preferences.resetShortcuts())}>{copy.shortcutsReset}</Button>
							</PreferencePanel>
						)}
					</main>
				</div>
				<div className="kw-audio-editor-dialog__actions kw-audio-editor-preferences__footer"><Button onClick={onClose}>{copy.close}</Button></div>
			</AudioEditorResizableSurface>
		</div>
	);
}

function PreferenceDropdownField({ label, options, value, visuallyHiddenLabel = false, onChange }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		wrapperRef.current?.querySelector('.dropdown__trigger')?.setAttribute('aria-label', label);
	}, [label]);
	return (
		<div ref={wrapperRef} className="kw-audio-editor-preferences__field" role="group" aria-label={label}>
			<span className={visuallyHiddenLabel ? 'kw-audio-editor-sr-only' : undefined}>{label}</span>
			<Dropdown options={options} value={value} onChange={onChange} width="100%" />
		</div>
	);
}

function PreferenceCheckbox({ label, checked, onChange }) {
	const pendingValue = useRef(null);
	const handleChange = (next) => {
		if (pendingValue.current === next) return;
		pendingValue.current = next;
		queueMicrotask(() => { pendingValue.current = null; });
		onChange(next);
	};
	return <LabeledCheckbox label={label} checked={checked} onChange={handleChange} />;
}

function AccessiblePreferenceButton({ ariaLabel, ...props }) {
	const buttonRef = useRef(null);
	useEffect(() => {
		buttonRef.current?.setAttribute('aria-label', ariaLabel);
	}, [ariaLabel]);
	return <Button ref={buttonRef} {...props} />;
}

function PreferenceChoice({ selectLabel, label, ...props }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		wrapperRef.current?.querySelector('.preference-thumbnail__image-button')?.setAttribute(
			'aria-label',
			`${selectLabel}: ${label}`,
		);
	}, [label, selectLabel]);
	return <div ref={wrapperRef}><PreferenceThumbnail label={label} {...props} /></div>;
}

function preferencePreview(kind) {
	const dark = kind.includes('dark') || ['colorful', 'classic'].includes(kind);
	const contrast = kind.startsWith('high-contrast');
	const background = contrast ? dark ? '#000000' : '#ffffff' : dark ? '#202126' : '#f5f5f7';
	const surface = contrast ? dark ? '#111111' : '#ffffff' : dark ? '#303139' : '#ffffff';
	const line = contrast ? dark ? '#ffffff' : '#000000' : dark ? '#555861' : '#c9cbd2';
	const text = contrast ? dark ? '#ffffff' : '#000000' : dark ? '#e4e5e7' : '#25262b';
	const colorful = kind === 'colorful';
	const classic = kind === 'classic';
	const firstClip = colorful ? '#7c68ee' : classic ? '#6f737d' : '#6577df';
	const secondClip = colorful ? '#d65b91' : classic ? '#858995' : '#56a3a6';
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 188 106">
		<rect width="188" height="106" rx="4" fill="${background}"/>
		<rect x="6" y="6" width="176" height="16" rx="2" fill="${surface}" stroke="${line}"/>
		<circle cx="15" cy="14" r="3" fill="${firstClip}"/><path d="M24 14h45m8 0h25" stroke="${text}" stroke-width="2" opacity=".7"/>
		<rect x="6" y="28" width="34" height="70" rx="2" fill="${surface}" stroke="${line}"/>
		<path d="M13 39h20M13 49h14M13 78h20M13 88h16" stroke="${text}" opacity=".55"/>
		<rect x="46" y="28" width="136" height="32" rx="3" fill="${firstClip}" opacity=".88"/>
		<rect x="64" y="65" width="102" height="33" rx="3" fill="${secondClip}" opacity=".88"/>
		<path d="M50 44l5-7 5 15 5-11 5 6 5-13 5 18 5-11 5 5 5-9 5 13 5-7 5 3 5-10 5 15 5-9 5 4 5-6 5 8 5-5 5 2 5-6 5 9" fill="none" stroke="${text}" stroke-width="1" opacity=".85"/>
		<path d="M68 82l5-5 5 11 5-8 5 4 5-10 5 15 5-8 5 3 5-6 5 9 5-5 5 2 5-7 5 11 5-6 5 3 5-5 5 7" fill="none" stroke="${text}" stroke-width="1" opacity=".85"/>
	</svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function ShortcutEditorRow({ command, preferences, controller, copy, run }) {
	const preferenceId = command.id;
	const persisted = preferences.shortcuts[command.id]?.[0] || preferences.shortcuts[command.preferenceId]?.[0] || '';
	const [binding, setBinding] = useState(persisted);
	useEffect(() => setBinding(persisted), [persisted]);
	let normalized = '';
	let conflict = null;
	if (!command.disabled && binding.trim()) {
		try {
			normalized = normalizeAudioEditorShortcut(binding);
			const shortcuts = { ...preferences.shortcuts, [preferenceId]: [normalized] };
			conflict = findAudioEditorShortcutConflicts(shortcuts).find((entry) => entry.actionIds.includes(preferenceId)) || null;
		} catch {
			conflict = { binding, actionIds: [preferenceId] };
		}
	}
	const conflictAction = conflict?.actionIds.find((id) => id !== preferenceId);
	const error = conflict
		? (conflictAction
			? copy.shortcutConflict.replace('{binding}', conflict.binding).replace('{action}', conflictAction)
			: copy.shortcutInvalid)
		: '';
	return (
		<div
			className="kw-audio-editor-preferences__shortcut-row"
			data-shortcut-action={command.id}
			data-disabled-reason={command.disabledReason || undefined}
			aria-disabled={command.disabled ? 'true' : undefined}
			title={command.disabledReason || undefined}
		>
			<label><span>{command.label}</span><input disabled={command.disabled} value={binding} aria-invalid={error ? 'true' : 'false'} onChange={(event) => setBinding(event.currentTarget.value)} /></label>
			<Button variant="secondary" disabled={command.disabled || Boolean(error) || normalized === persisted} onClick={() => run(() => controller.actions.preferences.setShortcut(preferenceId, normalized))}>{copy.shortcutAssign}</Button>
			{error && <small role="alert">{error}</small>}
			{command.disabledReason && <small data-shortcut-disabled-reason>{command.disabledReason}</small>}
		</div>
	);
}

function workspacePanelLabel(copy, panelId) {
	const analyzerLabels = {
		'project-bin': copy.panelProjectBin,
		'video-preview': copy.panelVideoPreview,
		analysis: copy.analysisCommand,
		spectrum: copy.plotSpectrum,
		clipping: copy.findClipping,
		contrast: copy.contrast,
		'ebu-r128': copy.meterTypeEbuR128,
	};
	if (analyzerLabels[panelId]) return analyzerLabels[panelId];
	return copy[`panel${panelId[0].toUpperCase()}${panelId.slice(1)}`] || panelId;
}

function workspaceToolbarLabel(copy, toolbarId) {
	return copy[`toolbar${toolbarId[0].toUpperCase()}${toolbarId.slice(1)}`] || toolbarId;
}

function workspaceDockLabel(copy, dockId) {
	return copy[`dock${dockId[0].toUpperCase()}${dockId.slice(1)}`] || dockId;
}

function historyCommandLabel(copy, entry) {
	const type = entry.commands?.[0] || entry.type;
	return copy.historyCommand?.replace('{command}', type).replace('{count}', String(entry.commandCount || 1)) || type;
}

function NyquistDialog({ controller, snapshot, copy, target, run, onClose }) {
	const plugin = target?.pluginId ? getNyquistPlugin(target.pluginId) : null;
	const prompt = !plugin;
	const panelRef = useRef(null);
	const submissionRef = useRef(null);
	const [source, setSource] = useState(() => loadNyquistPromptSource(copy.nyquistPromptDefault));
	const [language, setLanguage] = useState('lisp');
	const [debug, setDebug] = useState(false);
	const [controls, setControls] = useState(() => nyquistControlDefaults(plugin));
	const [output, setOutput] = useState('');
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		setControls(nyquistControlDefaults(plugin));
		setOutput('');
		setDebug(Boolean(plugin?.debugEnabled));
		if (prompt) setSource(loadNyquistPromptSource(copy.nyquistPromptDefault));
	}, [copy.nyquistPromptDefault, plugin, prompt]);
	useEffect(() => {
		if (prompt) storeNyquistPromptSource(source);
	}, [prompt, source]);
	const cancelAndClose = useCallback(() => {
		submissionRef.current?.abort();
		submissionRef.current = null;
		onClose();
	}, [onClose]);

	useEffect(() => {
		const previouslyFocused = document.activeElement;
		panelRef.current?.querySelector('textarea, input, select, button')?.focus();
		const onKeyDown = (event) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			cancelAndClose();
		};
		document.addEventListener('keydown', onKeyDown);
		return () => {
			submissionRef.current?.abort();
			submissionRef.current = null;
			document.removeEventListener('keydown', onKeyDown);
			previouslyFocused?.focus?.();
		};
	}, [cancelAndClose]);

	const reset = () => {
		submissionRef.current?.abort();
		submissionRef.current = null;
		controller.actions.nyquist.cancel();
		setControls(nyquistControlDefaults(plugin));
		setOutput('');
		setDebug(Boolean(plugin?.debugEnabled));
		if (prompt) {
			setLanguage('lisp');
			setSource(copy.nyquistPromptDefault);
			storeNyquistPromptSource(copy.nyquistPromptDefault);
		}
	};
	const submit = async (preview = false) => {
		if (busy) return;
		const submission = new AbortController();
		submissionRef.current?.abort();
		submissionRef.current = submission;
		setBusy(true);
		setOutput('');
		try {
			const promise = run(async () => {
				try {
					const evaluationSource = prompt
						? source
						: await loadNyquistPluginSource(plugin, { signal: submission.signal });
					if (submission.signal.aborted) return null;
					if (prompt) storeNyquistPromptSource(source);
					const request = {
						source: evaluationSource,
						language: prompt ? language : 'lisp',
						role: plugin?.role || 'prompt',
						pluginType: plugin?.type,
						controls,
						debug,
						name: plugin?.name || copy.nyquistPrompt,
					};
					return preview
						? controller.actions.nyquist.preview(request)
						: controller.actions.nyquist.evaluate(request);
				} catch (error) {
					if (submission.signal.aborted || error?.name === 'AbortError') return null;
					throw error;
				}
			});
			const result = promise ? await promise : null;
			if (result && !submission.signal.aborted) setOutput(formatNyquistDialogResult(result));
		} catch {
			// The workspace's shared runner publishes the localized error.
		} finally {
			if (submissionRef.current === submission) {
				submissionRef.current = null;
				setBusy(false);
			}
		}
	};
	const processing = busy || snapshot.nyquist?.processing;
	const previewing = Boolean(snapshot.effects?.previewing);
	const canPreview = !plugin || plugin.role !== 'analyze';
	const title = plugin?.name || copy.nyquistPrompt;

	return (
		<div className="kw-audio-editor-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) cancelAndClose(); }}>
			<AudioEditorResizableSurface ref={panelRef} tabIndex={-1} className="kw-audio-editor-dialog kw-audio-editor-dialog--nyquist" role="dialog" aria-modal="true" aria-label={title} resizeLabel={`Resize: ${title}`} data-nyquist-plugin={plugin?.id || 'prompt'}>
				<DialogHeader title={title} os="windows" onClose={cancelAndClose} />
				<div className="kw-audio-editor-dialog__body">
					<p className="kw-audio-editor__nyquist-sandbox">{copy.nyquistSandboxNotice}</p>
					{prompt && <>
						<label className="kw-audio-editor-dialog__field">
							<span>{copy.nyquistLanguage}</span>
							<select value={language} disabled={processing} onChange={(event) => setLanguage(event.currentTarget.value)}>
								<option value="lisp">{copy.nyquistLanguageLisp}</option>
								<option value="sal">{copy.nyquistLanguageSal}</option>
							</select>
						</label>
						<label className="kw-audio-editor-dialog__field kw-audio-editor-dialog__field--source">
							<span>{copy.nyquistSource}</span>
							<textarea rows={12} spellCheck="false" value={source} disabled={processing} onChange={(event) => setSource(event.currentTarget.value)} />
						</label>
					</>}
					{plugin?.controls?.length > 0 && <fieldset className="kw-audio-editor__nyquist-controls">
						<legend>{copy.nyquistControls}</legend>
						{plugin.controls.map((control, index) => <NyquistControl
							key={control.variable || `text-${index}`}
							control={control}
							value={control.variable ? controls[control.variable] : null}
							disabled={processing}
							onChange={(value) => control.variable && setControls((current) => ({ ...current, [control.variable]: value }))}
						/>)}
					</fieldset>}
					<label className="kw-audio-editor__nyquist-debug">
						<input type="checkbox" checked={debug} disabled={processing} onChange={(event) => setDebug(event.currentTarget.checked)} />
						<span>{copy.nyquistDebug}</span>
					</label>
					{output && <section className="kw-audio-editor__nyquist-output" aria-live="polite">
						<strong>{copy.nyquistOutput}</strong>
						<pre>{output}</pre>
					</section>}
					<div className="kw-audio-editor-dialog__actions">
						<Button variant="secondary" onClick={cancelAndClose}>{copy.cancel}</Button>
						<Button variant="secondary" disabled={processing} onClick={reset}>{copy.nyquistReset}</Button>
						{canPreview && <Button variant="secondary" disabled={processing || (!plugin && !source.trim())} onClick={() => previewing ? controller.actions.nyquist.cancel() : submit(true)}>{previewing ? copy.stopPreview : copy.previewEffect}</Button>}
						<Button disabled={processing || snapshot.readOnly || (!plugin && !source.trim())} onClick={() => submit(false)}>{prompt ? copy.nyquistRun : copy.nyquistApply}</Button>
					</div>
				</div>
			</AudioEditorResizableSurface>
		</div>
	);
}

function NyquistControl({ control, value, disabled, onChange }) {
	if (control.kind === 'text') return <p className="kw-audio-editor__nyquist-control-note">{control.label}</p>;
	if (control.kind === 'choice') return (
		<label className="kw-audio-editor-dialog__field">
			<span>{control.label}</span>
			<select value={String(value ?? control.defaultValue ?? 0)} disabled={disabled} onChange={(event) => onChange(Number(event.currentTarget.value))}>
				{control.options.map((option) => <option key={`${option.value}-${option.symbol || option.label}`} value={option.value}>{option.label}</option>)}
			</select>
		</label>
	);
	if (control.kind === 'string') return (
		<label className="kw-audio-editor-dialog__field">
			<span>{control.label}</span>
			<input type="text" value={String(value ?? '')} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)} />
		</label>
	);
	const integer = control.type === 'int' || control.type === 'int-text';
	return (
		<label className="kw-audio-editor-dialog__field">
			<span>{control.label}{control.unit ? ` — ${control.unit}` : ''}</span>
			<input
				type="number"
				value={String(value ?? control.defaultValue ?? 0)}
				disabled={disabled}
				min={Number.isFinite(control.min) ? control.min : undefined}
				max={Number.isFinite(control.max) ? control.max : undefined}
				step={integer ? 1 : 'any'}
				onChange={(event) => onChange(integer ? Math.round(Number(event.currentTarget.value)) : Number(event.currentTarget.value))}
			/>
		</label>
	);
}

function nyquistControlDefaults(plugin) {
	return Object.fromEntries((plugin?.controls || [])
		.filter((control) => control.variable)
		.map((control) => [control.variable, control.defaultValue]));
}

function formatNyquistDialogResult(result) {
	if (!result) return '';
	if (result.type === 'multiple') return result.results.map(formatNyquistDialogResult).filter(Boolean).join('\n');
	const output = String(result.output || '').trim();
	let summary = '';
	if (result.type === 'message') summary = String(result.message || '');
	else if (result.type === 'number') summary = String(result.value);
	else if (result.type === 'labels') summary = `${result.labels?.length || 0} label(s)`;
	else if (result.type === 'audio') summary = `${result.frameCount || result.channels?.[0]?.length || 0} frames, ${result.channelCount || result.channels?.length || 0} channel(s)`;
	return [summary, output && output !== summary ? output : ''].filter(Boolean).join('\n');
}

const NYQUIST_PROMPT_STORAGE_KEY = 'soundscaper-nyquist-prompt-v1';

function loadNyquistPromptSource(fallback) {
	try { return globalThis.localStorage?.getItem(NYQUIST_PROMPT_STORAGE_KEY) || fallback; }
	catch { return fallback; }
}

function storeNyquistPromptSource(source) {
	try { globalThis.localStorage?.setItem(NYQUIST_PROMPT_STORAGE_KEY, String(source)); }
	catch { /* Local persistence can be unavailable in privacy modes. */ }
}

function GeneratorDialog({ type, controller, copy, locale, run, onClose }) {
	const [params, setParams] = useState(() => generatorDefaults(type));
	useEffect(() => setParams(generatorDefaults(type)), [type]);
	const update = (name, value) => setParams((current) => ({ ...current, [name]: value }));
	const labels = generatorLayoutLabels(copy);
	const dtmfTiming = generatorDtmfTiming(params);
	const numberField = (name, label, options = {}) => (
		<GeneratorNumberField
			name={name}
			label={label}
			ariaLabel={options.ariaLabel}
			value={params[name]}
			min={options.min}
			max={options.max}
			step={options.step ?? 0.01}
			onChange={(value) => update(name, value)}
		/>
	);
	const updateDtmfTiming = ({ totalSeconds, dutyPercent }) => {
		setParams((current) => {
			const currentTiming = generatorDtmfTiming(current);
			const next = generatorDtmfDurations(
				totalSeconds ?? currentTiming.totalSeconds,
				dutyPercent ?? currentTiming.dutyPercent,
				currentTiming.symbolCount,
			);
			return {
				...current,
				durationSeconds: next.totalSeconds,
				toneSeconds: next.toneSeconds,
				silenceSeconds: next.silenceSeconds,
			};
		});
	};
	const updateDtmfSequence = (sequence) => {
		setParams((current) => {
			const currentTiming = generatorDtmfTiming(current);
			const next = generatorDtmfDurations(
				currentTiming.totalSeconds,
				currentTiming.dutyPercent,
				generatorDtmfSymbolCount(sequence),
			);
			return {
				...current,
				sequence,
				durationSeconds: next.totalSeconds,
				toneSeconds: next.toneSeconds,
				silenceSeconds: next.silenceSeconds,
			};
		});
	};
	return (
		<div className="kw-audio-editor-dialog-layer" data-open="true">
			<AudioEditorResizableSurface className="kw-audio-editor-dialog kw-audio-editor-dialog--generator" role="dialog" aria-modal="true" aria-label={generatorLabel(type, copy)} resizeLabel={`Resize: ${generatorLabel(type, copy)}`} data-generator-type={type}>
				<DialogHeader title={generatorLabel(type, copy)} onClose={onClose} />
				<form className="kw-audio-editor-generator" onSubmit={(event) => {
					event.preventDefault();
					const options = type === 'dtmf'
						? { ...params, durationSeconds: dtmfTiming.totalSeconds, toneSeconds: dtmfTiming.toneSeconds, silenceSeconds: dtmfTiming.silenceSeconds }
						: params;
					run(() => controller.actions.generators.generate(type, options));
					onClose();
				}}>
					<div className="kw-audio-editor-generator__content">
						{type === 'tone' && (
							<div className="kw-audio-editor-generator__standard-grid" data-generator-layout="tone">
								<GeneratorSelect label={copy.generatorWaveform} value={params.waveform} onChange={(value) => update('waveform', value)} options={[
									['sine', copy.generatorSine], ['square', copy.generatorSquare], ['sawtooth', copy.generatorSawtooth],
								]} />
								{numberField('frequency', copy.generatorFrequency, { min: 0.01, max: 96_000, step: 1 })}
								{numberField('amplitude', copy.generatorAmplitude, { min: 0, max: 1, step: 0.01 })}
								{numberField('durationSeconds', copy.generatorDuration, { min: 0.001, max: 86_400, step: 0.1 })}
							</div>
						)}

						{type === 'chirp' && (
							<div className="kw-audio-editor-generator__chirp" data-generator-layout="chirp">
								<GeneratorSelect
									label={copy.generatorWaveform}
									value="sine"
									disabled
									onChange={() => {}}
									options={[['sine', copy.generatorSine]]}
								/>
								<div role="group" aria-label={labels.frequencySweep}>
									<PreferencePanel title={labels.frequencySweep} className="kw-audio-editor-generator__card">
										<GeneratorRadioGroup
											label={copy.generatorInterpolation}
											value={params.interpolation}
											onChange={(value) => update('interpolation', value)}
											options={[
												['linear', copy.linear],
												['logarithmic', copy.logarithmic],
											]}
										/>
										<Separator />
										<div className="kw-audio-editor-generator__pair">
											{numberField('startFrequency', copy.generatorStartFrequency, { min: 0.01, max: 96_000, step: 1 })}
											{numberField('endFrequency', copy.generatorEndFrequency, { min: 0.01, max: 96_000, step: 1 })}
										</div>
									</PreferencePanel>
								</div>
								<div role="group" aria-label={labels.amplitudeSweep}>
									<PreferencePanel title={labels.amplitudeSweep} className="kw-audio-editor-generator__card">
										{numberField('amplitude', copy.generatorAmplitude, { min: 0, max: 1, step: 0.01 })}
										<p className="kw-audio-editor-generator__explanation">{labels.amplitudeExplanation}</p>
									</PreferencePanel>
								</div>
								{numberField('durationSeconds', copy.generatorDuration, { min: 0.001, max: 86_400, step: 0.1 })}
							</div>
						)}

						{type === 'noise' && (
							<div className="kw-audio-editor-generator__standard-grid" data-generator-layout="noise">
								<GeneratorSelect label={copy.generatorNoiseColor} value={params.color} onChange={(value) => update('color', value)} options={[
									['white', copy.generatorWhite], ['pink', copy.generatorPink], ['brown', copy.generatorBrown],
								]} />
								{numberField('amplitude', copy.generatorAmplitude, { min: 0, max: 1, step: 0.01 })}
								{numberField('durationSeconds', copy.generatorDuration, { min: 0.001, max: 86_400, step: 0.1 })}
							</div>
						)}

						{type === 'silence' && (
							<div className="kw-audio-editor-generator__standard-grid kw-audio-editor-generator__standard-grid--single" data-generator-layout="silence">
								{numberField('durationSeconds', copy.generatorDuration, { min: 0.001, max: 86_400, step: 0.1 })}
							</div>
						)}

						{type === 'dtmf' && (
							<div className="kw-audio-editor-generator__dtmf" data-generator-layout="dtmf">
								<div role="group" aria-label={generatorLabel(type, copy)}>
									<PreferencePanel className="kw-audio-editor-generator__card kw-audio-editor-generator__dtmf-fields">
										<label className="kw-audio-editor-dialog__field" data-generator-field="sequence">
											<span>{copy.generatorSequence}</span>
											<TextInput value={params.sequence} onChange={updateDtmfSequence} />
										</label>
										<p className="kw-audio-editor-generator__explanation">{labels.dtmfExplanation}</p>
										{numberField('amplitude', copy.generatorAmplitude, { min: 0, max: 1, step: 0.01 })}
										<GeneratorNumberField
											name="durationSeconds"
											label={copy.generatorDuration}
											value={dtmfTiming.totalSeconds}
											min={0.001}
											max={86_400}
											step={0.01}
											onChange={(value) => updateDtmfTiming({ totalSeconds: value })}
										/>
									</PreferencePanel>
								</div>
								<div role="group" aria-label={labels.toneSilenceRatio}>
									<PreferencePanel title={labels.toneSilenceRatio} className="kw-audio-editor-generator__card kw-audio-editor-generator__ratio-card">
										<div className="kw-audio-editor-generator__ratio-control">
											<GeneratorKnob
												value={dtmfTiming.dutyPercent}
												label={labels.dutyCycle}
												onChange={(value) => updateDtmfTiming({ dutyPercent: value })}
											/>
											<GeneratorNumberField
												name="dutyPercent"
												label={labels.dutyCycle}
												value={dtmfTiming.dutyPercent}
												min={1}
												max={100}
												step={1}
												onChange={(value) => updateDtmfTiming({ dutyPercent: value })}
											/>
										</div>
										<Separator />
										<dl className="kw-audio-editor-generator__timing-summary">
											<div><dt>{labels.dutyCycle}</dt><dd>{formatGeneratorNumber(dtmfTiming.dutyPercent, locale)}%</dd></div>
											<div><dt>{copy.generatorToneDuration}</dt><dd>{formatGeneratorNumber(dtmfTiming.toneSeconds, locale)} s</dd></div>
											<div><dt>{copy.generatorSilenceDuration}</dt><dd>{formatGeneratorNumber(dtmfTiming.silenceSeconds, locale)} s</dd></div>
										</dl>
									</PreferencePanel>
								</div>
							</div>
						)}
					</div>
					<div className="kw-audio-editor-dialog__actions">
						<Button type="button" variant="secondary" onClick={onClose}>{copy.cancel}</Button>
						<Button type="submit">{copy.generate}</Button>
					</div>
				</form>
			</AudioEditorResizableSurface>
		</div>
	);
}

function GeneratorNumberField({ name, label, ariaLabel = label, value, min, max, step, onChange }) {
	const inputRef = useRef(null);
	const valueRef = useRef(value);
	const [draft, setDraft] = useState(() => String(value));
	valueRef.current = value;
	useEffect(() => {
		const input = inputRef.current;
		if (!input) return undefined;
		input.setAttribute('aria-label', ariaLabel);
		const handleBlur = () => {
			setDraft((current) => current.trim() && Number.isFinite(Number(current)) ? current : String(valueRef.current));
		};
		input.addEventListener('blur', handleBlur);
		return () => input.removeEventListener('blur', handleBlur);
	}, [ariaLabel]);
	useEffect(() => {
		if (document.activeElement !== inputRef.current) setDraft(String(value));
	}, [value]);
	return (
		<label className="kw-audio-editor-dialog__field" data-generator-field={name}>
			<span>{label}</span>
			<NumberStepper
				ref={inputRef}
				value={draft}
				min={min}
				max={max}
				step={step}
				width="100%"
				onChange={(next) => {
					setDraft(next);
					if (next.trim() && Number.isFinite(Number(next))) onChange(Number(next));
				}}
			/>
		</label>
	);
}

function GeneratorSelect({ label, value, disabled = false, onChange, options }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		wrapperRef.current?.querySelector('.dropdown__trigger')?.setAttribute('aria-label', label);
	}, [label]);
	return (
		<div ref={wrapperRef} className="kw-audio-editor-dialog__field" data-generator-field={label} role="group" aria-label={label}>
			<span>{label}</span>
			<Dropdown
				disabled={disabled}
				value={value}
				onChange={onChange}
				options={options.map(([id, text]) => ({ value: id, label: text }))}
				width="100%"
			/>
		</div>
	);
}

function GeneratorRadioGroup({ label, value, onChange, options }) {
	const groupRef = useRef(null);
	useEffect(() => {
		const radios = [...(groupRef.current?.querySelectorAll('[role="radio"]') || [])];
		radios.forEach((radio, index) => {
			radio.setAttribute('aria-label', options[index][1]);
			radio.setAttribute('tabindex', options[index][0] === value ? '0' : '-1');
		});
	}, [options, value]);
	const selectAndFocus = (nextValue) => {
		onChange(nextValue);
		queueMicrotask(() => groupRef.current?.querySelector(`[data-generator-radio-value="${nextValue}"] [role="radio"]`)?.focus());
	};
	return (
		<div
			ref={groupRef}
			className="kw-audio-editor-generator__radio-group"
			role="radiogroup"
			aria-label={label}
			onKeyDown={(event) => {
				if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
				event.preventDefault();
				const currentIndex = Math.max(0, options.findIndex(([id]) => id === value));
				const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1;
				const nextIndex = (currentIndex + direction + options.length) % options.length;
				selectAndFocus(options[nextIndex][0]);
			}}
		>
			{options.map(([id, text]) => (
				<div
					key={id}
					className="kw-audio-editor-generator__radio-option"
					data-generator-radio-value={id}
					onClick={(event) => {
						if (!event.target.closest('[role="radio"]')) selectAndFocus(id);
					}}
				>
					<LabeledRadio label={text} name="generator-interpolation" value={id} checked={value === id} tabIndex={value === id ? 0 : -1} onChange={() => onChange(id)} />
				</div>
			))}
		</div>
	);
}

function GeneratorKnob({ value, label, onChange }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		const knob = wrapperRef.current?.querySelector('.knob');
		if (!knob) return undefined;
		knob.setAttribute('type', 'button');
		const handleKeyDown = (event) => {
			if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
			event.preventDefault();
			if (event.key === 'Home') onChange(1);
			else if (event.key === 'End') onChange(100);
			else onChange(Math.max(1, Math.min(100, value + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1))));
		};
		knob.addEventListener('keydown', handleKeyDown);
		return () => knob.removeEventListener('keydown', handleKeyDown);
	}, [onChange, value]);
	return (
		<div ref={wrapperRef} className="kw-audio-editor-generator__knob">
			<Knob value={value} min={1} max={100} step={1} label={label} mode="unipolar" onChange={onChange} />
		</div>
	);
}

function generatorDtmfTiming(params) {
	const symbolCount = generatorDtmfSymbolCount(params.sequence);
	const toneSeconds = Number(params.toneSeconds) || 0;
	const silenceSeconds = Number(params.silenceSeconds) || 0;
	const dutyPercent = toneSeconds + silenceSeconds > 0
		? toneSeconds / (toneSeconds + silenceSeconds) * 100
		: 100;
	const totalSeconds = Number(params.durationSeconds) > 0 ? Number(params.durationSeconds) : 1;
	const durations = generatorDtmfDurations(totalSeconds, dutyPercent, symbolCount);
	return {
		symbolCount,
		...durations,
		dutyPercent: roundGeneratorNumber(dutyPercent),
	};
}

function generatorDtmfSymbolCount(sequence) {
	const normalized = String(sequence ?? '').toUpperCase().replace(/[\s,-]+/g, '');
	return Math.max(1, normalized.length);
}

function generatorDtmfDurations(totalSeconds, dutyPercent, symbolCount) {
	const total = Number(totalSeconds);
	const duty = Math.max(1, Math.min(100, Number(dutyPercent))) / 100;
	const gaps = Math.max(0, symbolCount - 1);
	const denominator = symbolCount + gaps * (1 - duty) / duty;
	const toneSeconds = total / denominator;
	const silenceSeconds = duty === 1 ? 0 : toneSeconds * (1 - duty) / duty;
	return {
		totalSeconds: roundGeneratorNumber(total),
		toneSeconds: roundGeneratorNumber(toneSeconds),
		silenceSeconds: roundGeneratorNumber(silenceSeconds),
	};
}

function roundGeneratorNumber(value) {
	return Number(Number(value).toFixed(6));
}

function formatGeneratorNumber(value, locale) {
	return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(value);
}

function generatorLayoutLabels(copy) {
	return {
		frequencySweep: copy.generatorFrequencySweep,
		amplitudeSweep: copy.generatorAmplitudeSweep,
		amplitudeExplanation: copy.generatorAmplitudeExplanation,
		toneSilenceRatio: copy.generatorToneSilenceRatio,
		dutyCycle: copy.generatorDutyCycle,
		dtmfExplanation: copy.generatorDtmfExplanation,
	};
}

function generatorDefaults(type) {
	const common = { durationSeconds: 1, amplitude: 0.8 };
	if (type === 'tone') return { ...common, frequency: 440, waveform: 'sine' };
	if (type === 'chirp') return { ...common, startFrequency: 440, endFrequency: 1320, interpolation: 'logarithmic' };
	if (type === 'noise') return { ...common, color: 'white' };
	if (type === 'dtmf') {
		const durations = generatorDtmfDurations(1, 2 / 3 * 100, 3);
		return { ...common, sequence: '123', toneSeconds: durations.toneSeconds, silenceSeconds: durations.silenceSeconds };
	}
	return { durationSeconds: 1 };
}

function generatorLabel(type, copy) {
	return { silence: copy.silenceGenerator, tone: copy.toneGenerator, chirp: copy.chirpGenerator, noise: copy.noiseGenerator, dtmf: copy.dtmfGenerator }[type] || copy.generateMenu;
}

function EditorDialog({ type, value, onValueChange, sourceKey = 'global', onSourceKeyChange, controller, snapshot, copy, locale, run, showArmControls = false, onClose }) {
	const panelRef = useRef(null);
	const cancelTimedRecordingOnClose = useRef(false);
	cancelTimedRecordingOnClose.current = type === 'timed-recording' && snapshot.recordingScheduling;
	const closeDialog = () => {
		if (cancelTimedRecordingOnClose.current) run(() => controller.actions.recording.cancelScheduled());
		onClose();
	};
	useEffect(() => {
		const previouslyFocused = document.activeElement;
		const panel = panelRef.current;
		const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
		const focusInitial = () => {
			const initial = ['rename', 'track-rename'].includes(type) ? panel?.querySelector('input') : panel?.querySelector(focusableSelector);
			(initial || panel)?.focus();
		};
		focusInitial();
		const onKeyDown = (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				closeDialog();
				return;
			}
			if (event.key !== 'Tab' || !panel) return;
			const focusable = [...panel.querySelectorAll(focusableSelector)];
			if (!focusable.length) {
				event.preventDefault();
				panel.focus();
				return;
			}
			const first = focusable[0];
			const last = focusable.at(-1);
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
			if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
		};
	}, [type]);

	const title = {
		projects: copy.projectsTitle,
		rename: copy.renameProject,
		'track-rename': copy.trackName,
		'timed-recording': copy.timedRecording,
		'recording-offset': copy.recordingOffset,
		'track-rate': copy.sampleRate,
		resample: copy.resample,
		'aup4-compatibility': copy.aup4CompatibilityReport,
		about: copy.aboutEditor,
		clear: copy.clearData,
	}[type] || copy.deleteTitle;
	const offsetSources = recordingOffsetSources(snapshot, copy);
	return (
		<div className="kw-audio-editor-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
			<AudioEditorResizableSurface ref={panelRef} tabIndex={-1} className="kw-audio-editor-dialog" role="dialog" aria-modal="true" aria-label={title} resizeLabel={`Resize: ${title}`}>
				<DialogHeader title={title} os="windows" onClose={closeDialog} />
				<div className="kw-audio-editor-dialog__body">
					{type === 'projects' && (
						<>
							<p>{copy.projectsDescription}</p>
							<ul className="kw-audio-editor-project-list" data-project-list>
								{snapshot.projects?.map((project) => (
									<li key={project.id}>
										<Button variant="secondary" onClick={() => { run(() => controller.actions.project.openById(project.id)); onClose(); }}>
											<span>{project.title}</span>
											<small>{copy.lastEdited}: {formatDate(project.updatedAt, locale)}</small>
										</Button>
									</li>
								))}
							</ul>
							{!snapshot.projects?.length && <p data-project-list-empty>{copy.noProjects}</p>}
						</>
					)}
					{type === 'rename' && (
						<form onSubmit={(event) => {
							event.preventDefault();
							if (!value.trim()) return;
							run(() => controller.actions.project.rename(value));
							onClose();
						}}>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.projectName}</span>
								<span data-project-name-input>
									<TextInput value={value} onChange={onValueChange} width="100%" />
								</span>
							</label>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button type="submit" disabled={!value.trim()}>{copy.saveName}</Button>
							</div>
						</form>
					)}
					{type === 'track-rename' && (
						<form onSubmit={(event) => {
							event.preventDefault();
							if (!value.trim() || !snapshot.selectedTrackId) return;
							run(() => controller.actions.track.update(snapshot.selectedTrackId, { name: value.trim() }));
							onClose();
						}}>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.trackName}</span>
								<TextInput value={value} onChange={onValueChange} width="100%" />
							</label>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button type="submit" disabled={!value.trim()}>{copy.saveName}</Button>
							</div>
						</form>
					)}
					{type === 'timed-recording' && (
						<form data-timed-recording-dialog onSubmit={(event) => {
							event.preventDefault();
							const startTimeMs = new Date(value).getTime();
							if (!Number.isFinite(startTimeMs) || startTimeMs <= Date.now()) return;
							const trackId = showArmControls
								? undefined
								: (() => {
									const selectedTrack = snapshot.project?.tracks.find((track) => track.id === snapshot.selectedTrackId);
									if (selectedTrack?.type === 'audio') return selectedTrack.id;
									if (selectedTrack?.type === 'video' && selectedTrack.laneGroupId) {
										const pairedTrack = snapshot.project?.tracks.find((track) => (
											track.type === 'audio' && track.laneGroupId === selectedTrack.laneGroupId
										));
										if (pairedTrack) return pairedTrack.id;
									}
									return snapshot.project?.tracks.find((track) => track.type === 'audio')?.id;
								})();
							const operation = run(() => controller.actions.recording.schedule(startTimeMs, { trackId }));
							if (operation && typeof operation.then === 'function') {
								operation.then((scheduled) => { if (scheduled) onClose(); }, () => undefined);
							} else if (operation !== undefined) onClose();
						}}>
							<p>{copy.timedRecordingDescription}</p>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.timedRecordingStartTime}</span>
								<input
									type="datetime-local"
									step="1"
									value={value}
									onChange={(event) => onValueChange(event.currentTarget.value)}
								/>
							</label>
							{snapshot.scheduledRecording && <p>{copy.timedRecordingCurrent.replace(
								'{time}',
								new Date(snapshot.scheduledRecording.startTimeMs).toLocaleString(locale),
							)}</p>}
							<div className="kw-audio-editor-dialog__actions">
								{snapshot.scheduledRecording && <Button variant="secondary" onClick={() => {
									run(() => controller.actions.recording.cancelScheduled());
									onClose();
								}}>{copy.timedRecordingCancel}</Button>}
								<Button variant="secondary" onClick={closeDialog}>{copy.cancel}</Button>
								<Button type="submit" disabled={Boolean(snapshot.scheduledRecording) || !Number.isFinite(new Date(value).getTime()) || new Date(value).getTime() <= Date.now()}>
									{copy.timedRecordingSchedule}
								</Button>
							</div>
						</form>
					)}
					{type === 'recording-offset' && (
						<form onSubmit={(event) => {
							event.preventDefault();
							run(() => sourceKey === 'global'
								? controller.actions.recording.setLatencyOffset(value)
								: controller.actions.recording.setSourceOffset(sourceKey, value));
							onClose();
						}}>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.recordingOffsetSource}</span>
								<select value={sourceKey} onChange={(event) => {
									const nextSourceKey = event.currentTarget.value;
									onSourceKeyChange?.(nextSourceKey);
									onValueChange(String(nextSourceKey === 'global'
										? snapshot.monitor?.latencyOffsetMs ?? 0
										: snapshot.recordingInputs?.offsets?.[nextSourceKey] ?? 0));
								}}>
									{offsetSources.map((source) => <option key={source.key} value={source.key}>{source.label}</option>)}
								</select>
							</label>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.latencyOffset}</span>
								<NumberStepper
									value={String(value)}
									min={-500}
									max={500}
									step={1}
									width="100%"
									onChange={onValueChange}
								/>
							</label>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button type="submit">{copy.save}</Button>
							</div>
						</form>
					)}
					{type === 'resample' && (
						<form onSubmit={(event) => {
							event.preventDefault();
							const trackId = snapshot.selectedTrackId;
							if (!trackId) return;
							run(() => controller.actions.track.resample(trackId, Number(value)));
							onClose();
						}}>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.sampleRate} (Hz)</span>
								<NumberStepper value={String(value)} min={8_000} max={384_000} step={1_000} width="100%" onChange={onValueChange} />
							</label>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button type="submit">{copy.resample}</Button>
							</div>
						</form>
					)}
					{type === 'track-rate' && (
						<form onSubmit={(event) => {
							event.preventDefault();
							const trackId = snapshot.selectedTrackId;
							if (!trackId) return;
							run(() => controller.actions.track.setRate(trackId, Number(value)));
							onClose();
						}}>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.sampleRate} (Hz)</span>
								<NumberStepper value={String(value)} min={8_000} max={384_000} step={1_000} width="100%" onChange={onValueChange} />
							</label>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button type="submit">{copy.save}</Button>
							</div>
						</form>
					)}
					{type === 'about' && (
						<>
							<pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit' }}>{readmeMarkdown}</pre>
							<div className="kw-audio-editor-dialog__actions"><Button onClick={onClose}>{copy.close}</Button></div>
						</>
					)}
					{type === 'aup4-compatibility' && (
						<Aup4CompatibilityReport
							report={snapshot.aup4Compatibility?.report}
							copy={copy}
							onClose={onClose}
						/>
					)}
					{(type === 'delete' || type === 'clear') && (
						<>
							<p>{type === 'delete' ? copy.deleteDescription : copy.clearData}</p>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button onClick={() => {
									run(() => type === 'delete' ? controller.actions.project.remove() : controller.actions.project.clear());
									onClose();
								}}>{type === 'delete' ? copy.confirmDelete : copy.clearData}</Button>
							</div>
						</>
					)}
				</div>
			</AudioEditorResizableSurface>
		</div>
	);
}

function Aup4CompatibilityReport({ report, copy, onClose }) {
	const visibleItems = aup4CompatibilityItems(report);
	const counts = report?.counts || {};
	const visibleCount = (disposition) => visibleItems.filter((item) => item?.disposition === disposition).length;
	const displayCount = (disposition) => Math.max(compatibilityCount(counts[disposition]), visibleCount(disposition));
	return (
		<div data-aup4-compatibility-report>
			<p>{copy.aup4CompatibilityDescription}</p>
			<p>{formatAup4CompatibilitySummary(report, copy)}</p>
			<dl className="kw-audio-editor-compatibility-counts">
				<div><dt>{copy.aup4CompatibilityPreserved}</dt><dd>{displayCount('preserved')}</dd></div>
				<div><dt>{copy.aup4CompatibilityConverted}</dt><dd>{displayCount('converted')}</dd></div>
				<div><dt>{copy.aup4CompatibilityMissing}</dt><dd>{displayCount('missing')}</dd></div>
				<div><dt>{copy.aup4CompatibilityOmitted}</dt><dd>{displayCount('omitted')}</dd></div>
			</dl>
			<h3>{copy.aup4CompatibilityDetails}</h3>
			{visibleItems.length ? (
				<ul className="kw-audio-editor-compatibility-items">
					{visibleItems.map((item, index) => (
						<li key={`${item?.code || 'AUP4'}-${index}`} data-severity={item?.severity || 'info'}>
							<strong>{formatAup4CompatibilityItem(item, copy)}</strong>
							{item?.scope && <small>{formatAup4CompatibilityScope(item.scope)}</small>}
						</li>
					))}
				</ul>
			) : <p>{copy.aup4CompatibilityNoIssues}</p>}
			<div className="kw-audio-editor-dialog__actions">
				<Button onClick={onClose}>{copy.close}</Button>
			</div>
		</div>
	);
}

function formatAup4CompatibilitySummary(report, copy) {
	const counts = report?.counts || {};
	const items = aup4CompatibilityItems(report);
	const count = (disposition) => Math.max(
		compatibilityCount(counts[disposition]),
		items.filter((item) => item?.disposition === disposition).length,
	);
	return copy.aup4CompatibilitySummary
		.replace('{direction}', report?.direction === 'open' ? copy.aup4CompatibilityOpen : copy.aup4CompatibilitySave)
		.replace('{converted}', String(count('converted')))
		.replace('{missing}', String(count('missing')))
		.replace('{omitted}', String(count('omitted')));
}

function aup4CompatibilityItems(report) {
	const items = [...(Array.isArray(report?.items) ? report.items : [])];
	const legacyItems = [
		...(report?.missingAudio || []).map((entry) => ({
			code: 'MISSING_LOCAL_AUDIO',
			severity: 'warning',
			disposition: 'missing',
			data: entry,
		})),
		...(Number(report?.discardedCloudMetadata?.discardedEntries) > 0 ? [{
			code: 'EXCLUDED_CLOUD_METADATA',
			severity: 'warning',
			disposition: 'omitted',
			data: report.discardedCloudMetadata,
		}] : []),
	];
	const key = (item) => `${item?.code || ''}:${item?.data?.blockId ?? ''}`;
	const seen = new Set(items.map(key));
	for (const item of legacyItems) {
		const itemKey = key(item);
		if (!seen.has(itemKey)) {
			seen.add(itemKey);
			items.push(item);
		}
	}
	return items;
}

function formatAup4CompatibilityItem(item, copy) {
	const name = String(item?.data?.name || item?.name || '').trim();
	if (item?.disposition === 'missing' && name) {
		return copy.missingEffectLabel.replace('{name}', name);
	}
	const message = String(item?.message || '').trim();
	if (message) return message;
	return String(item?.code || copy.aup4CompatibilityDetails).replaceAll('_', ' ');
}

function rackEffectLabel(effect, labels, copy) {
	if (effect?.type === 'missing') {
		const name = String(effect.missing?.name || copy.missingEffectUnknown).trim() || copy.missingEffectUnknown;
		return copy.missingEffectLabel.replace('{name}', name);
	}
	return labels.get(effect?.type) || String(effect?.type || '');
}

function formatAup4CompatibilityScope(scope) {
	if (typeof scope === 'string') return scope;
	if (!scope || typeof scope !== 'object') return '';
	return [scope.kind || scope.type, scope.name || scope.trackName].filter(Boolean).join(': ');
}

function compatibilityCount(value, items = [], disposition = '') {
	const count = Number(value);
	if (Number.isSafeInteger(count) && count >= 0) return count;
	return items.filter((item) => item?.disposition === disposition).length;
}

function recordingOffsetSources(snapshot, copy) {
	const inputs = snapshot.recordingInputs || {};
	const sources = new Map([['global', copy.recordingDefaultInput]]);
	for (const [index, device] of (inputs.devices || []).entries()) {
		sources.set(`device:${device.deviceId}`, device.label || copy.recordingInputUnnamedDevice.replace('{number}', String(index + 1)));
	}
	for (const route of Object.values(inputs.routes || {})) {
		if (route?.kind === 'display') sources.set('display', route.label || copy.recordingDesktopAudio);
		else if (route?.kind === 'device' && route.deviceId) sources.set(`device:${route.deviceId}`, route.deviceLabel || copy.recordingInputUnknownDevice);
	}
	for (const source of inputs.sources || []) {
		const key = source.key || source.sourceKey;
		if (!key || sources.has(key)) continue;
		sources.set(key, source.label || (key === 'display' ? copy.recordingDesktopAudio : copy.recordingInputUnknownDevice));
	}
	for (const key of Object.keys(inputs.offsets || {})) {
		if (!sources.has(key)) sources.set(key, key === 'display' ? copy.recordingDesktopAudio : copy.recordingInputUnknownDevice);
	}
	return [...sources].map(([key, label]) => ({ key, label }));
}

function SpectralSelectionDialog({ controller, snapshot, copy, run, onClose }) {
	const panelRef = useRef(null);
	const project = snapshot.project;
	const track = project?.tracks.find((candidate) => candidate.id === snapshot.selectedTrackId && candidate.type === 'audio') || null;
	const nyquist = Math.max(1, (project?.sampleRate || 48_000) / 2);
	const existing = snapshot.selection?.frequencyRange;
	const [minimumFrequency, setMinimumFrequency] = useState(existing?.minimumFrequency ?? track?.spectrogram?.minimumFrequency ?? 0);
	const [maximumFrequency, setMaximumFrequency] = useState(existing?.maximumFrequency ?? track?.spectrogram?.maximumFrequency ?? Math.min(20_000, nyquist));
	const [gainDb, setGainDb] = useState(6);

	useEffect(() => {
		const previouslyFocused = document.activeElement;
		panelRef.current?.querySelector('input, button')?.focus();
		const onKeyDown = (event) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			onClose();
		};
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
			previouslyFocused?.focus?.();
		};
	}, [onClose]);

	const selectionOptions = () => ({
		minimumFrequency: Number(minimumFrequency),
		maximumFrequency: Number(maximumFrequency),
	});
	const submit = (operation) => {
		run(async () => {
			controller.actions.spectral.boxSelect(selectionOptions());
			if (operation === 'delete') await controller.actions.spectral.delete();
			if (operation === 'amplify') await controller.actions.spectral.amplify(Number(gainDb));
		});
		onClose();
	};
	const validRange = Number.isFinite(Number(minimumFrequency))
		&& Number.isFinite(Number(maximumFrequency))
		&& Number(minimumFrequency) >= 0
		&& Number(maximumFrequency) <= nyquist
		&& Number(maximumFrequency) > Number(minimumFrequency);

	return (
		<div className="kw-audio-editor-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<AudioEditorResizableSurface ref={panelRef} tabIndex={-1} className="kw-audio-editor-dialog" role="dialog" aria-modal="true" aria-label={copy.spectralSelection} resizeLabel={`Resize: ${copy.spectralSelection}`}>
				<DialogHeader title={copy.spectralSelection} os="windows" onClose={onClose} />
				<div className="kw-audio-editor-dialog__body">
					<label className="kw-audio-editor-dialog__field">
						<span>{copy.minimumFrequency}</span>
						<NumberStepper value={String(minimumFrequency)} min={0} max={Math.max(0, nyquist - 1)} step={10} width="100%" onChange={setMinimumFrequency} />
					</label>
					<label className="kw-audio-editor-dialog__field">
						<span>{copy.maximumFrequency}</span>
						<NumberStepper value={String(maximumFrequency)} min={1} max={nyquist} step={10} width="100%" onChange={setMaximumFrequency} />
					</label>
					<label className="kw-audio-editor-dialog__field">
						<span>{copy.spectralGain}</span>
						<NumberStepper value={String(gainDb)} min={-60} max={60} step={1} width="100%" onChange={setGainDb} />
					</label>
					<div className="kw-audio-editor-dialog__actions">
						<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
						<Button variant="secondary" disabled={!validRange} onClick={() => submit('select')}>{copy.selectFrequencyRange}</Button>
						<Button variant="secondary" disabled={!validRange} onClick={() => submit('delete')}>{copy.spectralDelete}</Button>
						<Button disabled={!validRange || !Number.isFinite(Number(gainDb))} onClick={() => submit('amplify')}>{copy.spectralAmplify}</Button>
					</div>
				</div>
			</AudioEditorResizableSurface>
		</div>
	);
}

const EFFECT_MENU_GROUPS = Object.freeze([
	['volumeCompression', ['audacity-amplify', 'audacity-auto-duck', 'audacity-compressor', 'audacity-limiter', 'audacity-loudness-normalization', 'audacity-normalize', 'audacity-remove-dc-offset']],
	['fading', ['audacity-fade-in', 'audacity-fade-out']],
	['eqFilters', ['eq', 'audacity-bass-treble', 'audacity-filter-curve-eq', 'audacity-graphic-eq']],
	['noiseRepair', ['audacity-click-removal', 'audacity-noise-reduction', 'audacity-repair']],
	['delayReverb', ['audacity-echo', 'audacity-reverb']],
	['distortionModulation', ['audacity-distortion', 'audacity-phaser', 'audacity-wahwah']],
	['specialEffects', ['audacity-invert', 'audacity-repeat', 'audacity-reverse', 'audacity-truncate-silence']],
	['legacyEffects', ['audacity-legacy-compressor', 'audacity-classic-filters']],
]);

const MUSICAL_SNAP_ITEMS = Object.freeze([
	['bar', 'snapBar'], ['1/2', null], ['1/4', null], ['1/8', null], ['1/16', null], ['1/32', null], ['1/64', null], ['1/128', null],
]);
const TIME_SNAP_ITEMS = Object.freeze([
	['seconds', 'snapSeconds'], ['deciseconds', 'snapDeciseconds'], ['centiseconds', 'snapCentiseconds'],
	['milliseconds', 'snapMilliseconds'], ['samples', 'snapSamples'],
]);
const VIDEO_SNAP_ITEMS = Object.freeze([
	['video-24', 'snapFilm'], ['video-ntsc', 'snapNtsc'], ['video-ntsc-drop', 'snapNtscDrop'], ['video-pal', 'snapPal'],
]);

function createSnapMenu(copy, project, editBlocked, setSnap) {
	const snap = project?.snap || {};
	const storedUnit = String(snap.division || snap.unit || 'seconds');
	const unit = ({ beats: '1/4', frames: 'video-24' }[storedUnit] || storedUnit).replace(/-triplet$/, '');
	const triplets = Boolean(snap.triplets || /-triplet$/.test(storedUnit));
	const item = ([id, copyKey]) => ({
		id: `snap-${id.replace(/[^a-z0-9]+/gi, '-')}`,
		label: copyKey ? copy[copyKey] : id,
		checked: unit === id,
		disabled: editBlocked,
		onClick: () => setSnap({ unit: id, division: id }),
	});
	const musical = MUSICAL_SNAP_ITEMS.some(([id]) => id === unit);
	return {
		id: 'snap',
		label: copy.snap,
		items: [
			{ id: 'snap-enabled', label: copy.snapEnabled, checked: Boolean(snap.enabled), disabled: editBlocked, onClick: () => setSnap({ enabled: !snap.enabled }) },
			{ id: 'snap-triplets', label: copy.snapTriplets, checked: triplets, disabled: editBlocked || !musical || unit === 'bar', onClick: () => setSnap({ triplets: !triplets }) },
			{ id: 'snap-musical', label: copy.snapMusical, items: MUSICAL_SNAP_ITEMS.map(item) },
			{ id: 'snap-time', label: copy.snapTime, items: TIME_SNAP_ITEMS.map(item) },
			{ id: 'snap-video', label: copy.snapVideo, items: VIDEO_SNAP_ITEMS.map(item) },
			{ id: 'snap-cd', label: copy.snapCd, items: [item(['cdda', 'snapCdda'])] },
		],
	};
}

function trackSources(project, track) {
	if (!project || !track || track.type !== 'audio') return [];
	const clipById = new Map((project.clips || []).map((clip) => [clip.id, clip]));
	const sourceById = new Map((project.sources || []).map((source) => [source.id, source]));
	return [...new Map((track.clipIds || []).map((clipId) => {
		const source = sourceById.get(clipById.get(clipId)?.sourceId) || null;
		return [source?.id, source];
	}).filter(([, source]) => source)).values()];
}

function audioEditorTrackBlockBounds(tracks, trackId) {
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

function moveAudioEditorTrackBlock(controller, tracks, trackId, direction) {
	const bounds = audioEditorTrackBlockBounds(tracks, trackId);
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

function trackSourceChannelCount(project, track) {
	return trackSources(project, track).reduce((maximum, source) => Math.max(maximum, Number(source.channelCount) || 0), 0);
}

function trackSourceRate(project, track, fallback) {
	const rates = new Set(trackSources(project, track).map((source) => Number(source.sampleRate)).filter(Number.isFinite));
	return rates.size === 1 ? [...rates][0] : fallback;
}

function createApplicationMenus({
	locale,
	copy,
	project,
	snapshot,
	blocked,
	editBlocked,
	showArmControls,
	recordLabel,
	selectionActive,
	selectedClip,
	durationFrames,
	effectsPanelOpen,
	projectBinEffectivelyOpen,
	uiFlags,
	actionRuntime,
	actions,
}) {
	const divider = () => ({ divider: true });
	const unavailable = (id, label) => ({ id, label, disabled: true });
	const clipSelectionActive = Boolean(selectedClip || project?.selection?.clipIds?.some((clipId) => (
		project.clips.some((clip) => clip.id === clipId)
	)));
	const editSelectionActive = selectionActive || clipSelectionActive;
	const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId) || null;
	const selectedAudioTrack = selectedTrack?.type === 'audio' ? selectedTrack : null;
	const selectedTrackBlock = selectedTrack ? audioEditorTrackBlockBounds(project.tracks, selectedTrack.id) : null;
	const selectedAudioChannelCount = trackSourceChannelCount(project, selectedAudioTrack);
	const selectedAudioSources = trackSources(project, selectedAudioTrack);
	const selectedAudioSampleRates = new Set(selectedAudioSources.map((source) => source.sampleRate));
	const selectedAudioSampleFormats = new Set(selectedAudioSources.map((source) => source.sampleFormat));
	const selectedMixTrackIds = new Set((project?.selection?.trackIds || []).filter((trackId) => (
		project?.tracks.some((track) => track.id === trackId && track.type === 'audio')
	)));
	if (!selectedMixTrackIds.size && selectedAudioTrack) selectedMixTrackIds.add(selectedAudioTrack.id);
	const mixableAudioSelected = project?.tracks.some((track) => (
		track.type === 'audio' && selectedMixTrackIds.has(track.id) && track.clipIds.length
	));
	const compatibleMonoTracks = Boolean(selectedAudioChannelCount === 1 && project?.tracks.some((track) => (
		track.id !== selectedAudioTrack.id && track.type === 'audio' && trackSourceChannelCount(project, track) === 1
	)));
	const selectedClipIds = project?.selection?.clipIds?.length
		? project.selection.clipIds
		: selectedClip ? [selectedClip.id] : [];
	const splitAvailable = Boolean(
		selectedClipIds.some((clipId) => project?.clips.some((clip) => clip.id === clipId))
		|| selectedAudioTrack?.clipIds?.length
		|| project?.selection?.trackIds?.some((trackId) => (
			project.tracks.some((track) => track.id === trackId && track.type === 'audio' && track.clipIds.length)
		)),
	);
	const multipleSelectedClips = selectedClipIds.length > 1;
	const groupedSelectedClips = selectedClipIds.some((clipId) => project?.clips.find((clip) => clip.id === clipId)?.groupId);
	const frequencySelectionActive = Boolean(snapshot.selection?.frequencyRange);
	const spectralTrackSelected = Boolean(selectedAudioTrack && (
		selectedAudioTrack.displayMode === 'spectrogram'
		|| selectedAudioTrack.displayMode === 'multiview'
		|| snapshot.timeline?.view === 'spectrogram'
	));
	const labelTracks = project?.tracks.filter((track) => track.type === 'label') || [];
	const preferences = snapshot.preferences;
	const effectLabels = new Map((snapshot.effects?.selectionTypes || []).map(({ type, label }) => [type, label]));
	const effectGroups = EFFECT_MENU_GROUPS.map(([labelKey, types]) => ({
		id: labelKey,
		label: copy[labelKey],
		items: types.filter((type) => effectLabels.has(type)).map((type) => ({
			id: type,
			label: effectLabels.get(type),
			disabled: editBlocked || !selectedAudioTrack,
			onClick: () => actions.openSelectionEffect(type),
		})),
	})).filter((group) => group.items.length);
	const nyquistPlugins = listNyquistPlugins();
	const nyquistDisabled = (plugin) => {
		if (plugin.category === 'legacy') return editBlocked || !selectedAudioTrack || (plugin.spectral && !frequencySelectionActive);
		if (plugin.category === 'generate') return editBlocked;
		if (plugin.category === 'analyze') return blocked || !selectedAudioTrack;
		return editBlocked || !selectedAudioTrack;
	};
	const nyquistItem = (plugin, disabled) => ({
		id: plugin.id,
		label: plugin.name,
		disabled,
		onClick: () => actions.openNyquist(plugin.id),
	});
	const nyquistItems = (category) => nyquistPlugins
		.filter((plugin) => plugin.category === category)
		.map((plugin) => nyquistItem(plugin, nyquistDisabled(plugin)));

	return applyAudacityParityToMenus([
		{
			id: 'file',
			label: copy.fileMenu,
			items: [
				{ id: 'new-project', label: copy.newProject, shortcut: 'Ctrl+N', disabled: blocked, onClick: actions.newProject },
				{ id: 'open-project', label: copy.openProject, shortcut: 'Ctrl+O', disabled: blocked, onClick: actions.openProjects },
				{
					id: 'audacity-projects',
					label: copy.audacityProjects,
					disabled: blocked,
					items: [
						{ id: 'open-aup4', label: copy.openAup4, disabled: blocked, onClick: actions.openAup4 },
						{ id: 'open-legacy-aup', label: copy.openLegacyAup, disabled: blocked, onClick: actions.openLegacyAup },
						{ id: 'save-project-as', label: copy.saveAsAup4, preserveLabel: true, shortcut: 'Ctrl+Shift+S', disabled: blocked, onClick: actions.saveAup4 },
						{
							id: 'aup4-compatibility-report',
							label: copy.aup4CompatibilityReport,
							disabled: !snapshot.aup4Compatibility?.report,
							onClick: actions.openAup4CompatibilityReport,
						},
					],
				},
				{
					id: 'recent-projects',
					label: copy.recentProjects,
					disabled: blocked,
					items: [
						...(snapshot.recentProjects || []).map((recentProject) => ({
							id: `recent-project-${recentProject.id}`,
							label: recentProject.title,
							onClick: () => actions.openRecentProject(recentProject.id),
						})),
						...(snapshot.recentProjects?.length ? [divider()] : []),
						{ id: 'clear-recent', label: copy.clearRecentProjects, disabled: !snapshot.recentProjects?.length, onClick: actions.clearRecentProjects },
					],
				},
				{ id: 'file-close', label: copy.closeProject, shortcut: 'Ctrl+W', disabled: blocked, onClick: actions.closeProject },
				divider(),
				{ id: 'save-project', label: copy.saveProject, shortcut: 'Ctrl+S', disabled: snapshot.readOnly || blocked, onClick: actions.saveProject },
				divider(),
					{ id: 'import-audio', label: copy.importAudio, shortcut: 'Ctrl+I', disabled: blocked, onClick: actions.importAudio },
				{ id: 'import-labels', label: copy.importLabels, disabled: editBlocked, onClick: actions.importLabels },
				{ id: 'export-audio', label: copy.exportAudio, shortcut: 'Ctrl+Shift+E', disabled: blocked, onClick: actions.exportAudio },
				{
					id: 'export-other',
					label: copy.exportOther,
					parityLabel: copy.audacityParityMatchExportOther,
					items: [
						{
							id: 'export-labels',
							label: copy.exportLabels,
							disabled: blocked || !labelTracks.length,
							items: [
								{ id: 'export-labels-txt', label: copy.exportLabelsTxt, onClick: () => actions.exportLabels('txt') },
								{ id: 'export-labels-srt', label: copy.exportLabelsSrt, onClick: () => actions.exportLabels('srt') },
								{ id: 'export-labels-vtt', label: copy.exportLabelsVtt, onClick: () => actions.exportLabels('vtt') },
							],
						},
						unavailable('export-midi', copy.exportMidi),
					],
				},
					divider(),
				{ id: 'rename-project', label: copy.renameProject, disabled: editBlocked, onClick: actions.renameProject },
				{ id: 'duplicate-project', label: copy.duplicateProject, disabled: blocked, onClick: actions.duplicateProject },
				{ id: 'delete-project', label: copy.deleteProject, disabled: editBlocked, onClick: actions.deleteProject },
				{ id: 'clear-data', label: copy.clearData, disabled: blocked, onClick: actions.clearData },
			],
		},
		{
			id: 'edit',
			label: copy.editMenu,
			items: [
				{ id: 'undo', label: copy.undo, shortcut: 'Ctrl+Z', disabled: editBlocked || !snapshot.history?.canUndo, onClick: () => actions.executeEdit('undo') },
				{ id: 'redo', label: copy.redo, shortcut: 'Ctrl+Shift+Z', disabled: editBlocked || !snapshot.history?.canRedo, onClick: () => actions.executeEdit('redo') },
				divider(),
					{
						id: 'cut',
						label: copy.cut,
						items: [
							{ id: 'cut-leave-gap', label: copy.cutLeaveGap, shortcut: 'Ctrl+X', disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('cutLeaveGap') },
							{ id: 'cut-per-clip-ripple', label: copy.cutPerClipRipple, disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('cutPerClipRipple') },
							{ id: 'cut-per-track-ripple', label: copy.cutPerTrackRipple, shortcut: 'Shift+X', disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('cutPerTrackRipple') },
							{ id: 'cut-all-tracks-ripple', label: copy.cutAllTracksRipple, shortcut: 'Shift+Ctrl+X', disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('cutAllTracksRipple') },
						],
					},
					{
						id: 'delete',
						label: copy.liftDelete,
						items: [
							{ id: 'delete-leave-gap', label: copy.deleteLeaveGap, shortcut: 'Delete', disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('deleteLeaveGap') },
							{ id: 'delete-per-clip-ripple', label: copy.deletePerClipRipple, disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('deletePerClipRipple') },
							{ id: 'delete-per-track-ripple', label: copy.deletePerTrackRipple, shortcut: 'Backspace', disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('deletePerTrackRipple') },
							{ id: 'delete-all-tracks-ripple', label: copy.deleteAllTracksRipple, shortcut: 'Ctrl+Delete, Ctrl+Backspace', disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('deleteAllTracksRipple') },
						],
					},
				{ id: 'copy', label: copy.copy, shortcut: 'Ctrl+C', disabled: editBlocked || !editSelectionActive, onClick: () => actions.executeEdit('copy') },
				{
					id: 'paste',
					label: copy.paste,
					items: [
						{ id: 'action://paste', label: copy.paste, shortcut: 'Ctrl+V', disabled: editBlocked || !snapshot.history?.hasClipboard, onClick: () => actions.executeEdit('paste') },
						{ id: 'action://trackedit/paste-insert', label: copy.pasteInsert, disabled: editBlocked || !snapshot.history?.hasClipboard, onClick: () => actions.executeEdit('pasteInsert') },
						{ id: 'action://trackedit/paste-insert-all-tracks-ripple', label: copy.pasteSync, disabled: editBlocked || !snapshot.history?.hasClipboard, onClick: () => actions.executeEdit('pasteAllTracksRipple') },
					],
				},
				{ id: 'duplicate-audio', label: copy.duplicateAudio, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('duplicate') },
				{
					id: 'remove-special',
					label: copy.removeSpecial,
					items: [
						{ id: 'trim-audio-outside-selection', label: copy.trimOutsideSelection, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('trimOutsideSelection') },
						{ id: 'silence-audio', label: copy.silenceAudio, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('silenceSelection') },
					],
				},
				{
					id: 'clip-boundaries',
					label: copy.clipBoundaries,
					items: [
						{ id: 'split', label: copy.split, shortcut: 'S', disabled: editBlocked || !splitAvailable, onClick: () => actions.executeEdit('split') },
						{ id: 'split-into-new-track', label: copy.splitIntoNewTrack, disabled: editBlocked || !selectedClip, onClick: () => actions.executeEdit('splitIntoNewTrack') },
						{ id: 'join', label: copy.joinClips, disabled: editBlocked || !multipleSelectedClips, onClick: () => actions.executeEdit('join') },
						{ id: 'disjoin', label: copy.disjoinClips, disabled: editBlocked || !selectedClip, onClick: () => actions.executeEdit('disjoin') },
						{ id: 'group-clips', label: copy.groupClips, disabled: editBlocked || !multipleSelectedClips, onClick: () => actions.executeEdit('group') },
						{ id: 'ungroup-clips', label: copy.ungroupClips, disabled: editBlocked || !groupedSelectedClips, onClick: () => actions.executeEdit('ungroup') },
						{ id: 'clip-properties', label: copy.clipPropertiesCommand, disabled: !selectedClip, onClick: actions.openClipProperties },
					],
				},
				divider(),
				{ id: 'labels', label: copy.editLabels, onClick: actions.openLabels },
				{ id: 'metadata', label: copy.metadata, onClick: actions.openMetadata },
				{ id: 'preferences', label: copy.preferences, onClick: actions.openPreferences },
			],
		},
		{
			id: 'select',
			label: copy.selectMenu,
			items: [
				{ id: 'select-all', label: copy.selectAll, shortcut: 'Ctrl+A', disabled: editBlocked || durationFrames <= 0, onClick: actions.selectAll },
				{ id: 'select-none', label: copy.selectNone, shortcut: 'Ctrl+Shift+A', disabled: !editSelectionActive, onClick: actions.selectNone },
				divider(),
				{ id: 'select-tracks', label: copy.selectTracks, items: [
					{ id: 'select-all-tracks', label: copy.allTracks, disabled: !project?.tracks.length, onClick: actions.selectAllTracks },
					unavailable('select-no-tracks', copy.noTracks),
				] },
				{ id: 'menu-selection-audio-clips', label: copy.selectAudioClips, items: [
					unavailable('select-previous-clip-boundary-to-cursor', copy.previousClipBoundaryToCursor),
					unavailable('select-cursor-to-next-clip-boundary', copy.cursorToNextClipBoundary),
					unavailable('select-previous-clip', copy.previousClip),
					unavailable('select-next-clip', copy.nextClip),
				] },
				{ id: 'menu-selection-spectral', label: copy.selectSpectral, items: [
					unavailable('toggle-spectral-selection', copy.toggleSpectralSelection),
				] },
				{
					id: 'select-region',
					label: copy.selectRegion,
					items: [
						{ id: 'left-at-playback', label: copy.leftAtPlayback, onClick: actions.selectLeftOfPlayback },
						{ id: 'right-at-playback', label: copy.rightAtPlayback, onClick: actions.selectRightOfPlayback },
						{ id: 'track-start-cursor', label: copy.trackStartToCursor, onClick: actions.selectTrackStartToCursor },
						{ id: 'cursor-track-end', label: copy.cursorToTrackEnd, onClick: actions.selectCursorToTrackEnd },
						{ id: 'select-track-start-to-end', label: copy.trackStartToEnd || copy.selectAll, onClick: actions.selectTrackStartToEnd },
					],
				},
				{
					id: 'looping',
					label: copy.loopRegion,
					items: [
						{ id: 'toggle-loop-region', label: copy.loop, shortcut: 'L', checked: Boolean(project?.loop?.enabled), onClick: actions.toggleLoop },
						{ id: 'clear-loop-region', label: copy.clearLoopRegion || copy.selectNone, disabled: !project?.loop?.enabled, onClick: actions.clearLoop },
						{ id: 'set-loop-region-to-selection', label: copy.loopToSelection || copy.loop, disabled: !selectionActive, onClick: actions.loopToSelection },
						{ id: 'set-selection-to-loop', label: copy.selectionToLoop, disabled: !project?.loop?.enabled, onClick: actions.selectionToLoop },
						{ id: 'set-loop-region-in-out', label: copy.setLoopInOut || copy.loopRegion, onClick: actions.setLoopInOut },
						{ id: 'toggle-selection-follows-loop-region', label: copy.selectionFollowsLoop, checked: Boolean(snapshot.loopOptions?.selectionFollows), onClick: actions.toggleSelectionFollowsLoop },
						],
					},
					{ id: 'zero-crossings', label: copy.zeroCrossings, shortcut: 'Z', disabled: editBlocked || !selectionActive, onClick: actions.zeroCross },
				],
			},
		{
			id: 'view',
			label: copy.viewMenu,
			items: [
				{
					id: 'panels',
					label: copy.panels,
					items: [
						{ id: 'toggle-tracks', label: copy.tracksPanel, checked: uiFlags.tracksPanel },
						...WORKSPACE_PANEL_IDS.map((panelId) => panelId === 'effects'
							? {
								id: 'show-effects',
								label: copy.showEffects,
								checked: effectsPanelOpen,
								disabled: !selectedAudioTrack,
								onClick: actions.openEffects,
							}
							: {
								id: `panel-${panelId}`,
								label: workspacePanelLabel(copy, panelId),
								checked: panelId === 'project-bin'
									? projectBinEffectivelyOpen
									: preferences.workspace.panels[panelId].visible,
								onClick: () => actions.togglePanel(panelId),
							}),
					],
				},
				{
					id: 'workspace-preset',
					label: copy.workspace,
					items: [
						{ id: 'workspace-modern', label: copy.workspaceModern, checked: preferences.workspace.activeId === 'modern', onClick: () => actions.setWorkspace('modern') },
						{ id: 'workspace-music', label: copy.workspaceMusic, checked: preferences.workspace.activeId === 'music', onClick: () => actions.setWorkspace('music') },
						{ id: 'workspace-classic', label: copy.workspaceClassic, checked: preferences.workspace.activeId === 'classic', onClick: () => actions.setWorkspace('classic') },
						{ id: 'workspace-video-editor', label: copy.workspaceVideo, checked: preferences.workspace.activeId === 'video-editor', onClick: () => actions.setWorkspace('video-editor') },
						...preferences.workspace.custom.map((workspace) => ({ id: `workspace-${workspace.id}`, label: workspace.name, checked: preferences.workspace.activeId === workspace.id, onClick: () => actions.setWorkspace(workspace.id) })),
					],
				},
				{ id: 'show-arm-controls', label: copy.enableMultiTrackRecording, checked: showArmControls, onClick: actions.toggleArmControls },
				{ id: 'show-rms', label: copy.showRms, checked: Boolean(snapshot.timeline?.showRms), onClick: actions.toggleRms },
				{ id: 'show-rulers', label: copy.showVerticalRulers, checked: snapshot.timeline?.showVerticalRulers !== false, onClick: actions.toggleVerticalRulers },
				{ id: 'toggle-clipping-in-waveform', label: copy.showClipping, checked: uiFlags.clipping },
				{ id: 'show-master-track', label: copy.masterTrack, checked: uiFlags.masterTrack },
				{ id: 'toggle-statusbar', label: copy.statusBar, checked: uiFlags.statusbar },
				divider(),
				createSnapMenu(copy, project, editBlocked, actions.setSnap),
				{
					id: 'zoom',
					label: copy.zoomMenu,
					items: [
						{ id: 'zoom-in', label: copy.zoomIn, shortcut: 'Ctrl+1', onClick: actions.zoomIn },
						{ id: 'zoom-default', label: copy.zoomNormal, shortcut: 'Ctrl+2', onClick: actions.zoomDefault },
						{ id: 'zoom-out', label: copy.zoomOut, shortcut: 'Ctrl+3', onClick: actions.zoomOut },
						{ id: 'zoom-to-selection', label: copy.zoomSelection, disabled: !selectionActive, onClick: actions.zoomSelection },
						{ id: 'zoom-toggle', label: copy.zoomToggle, onClick: actions.zoomToggle },
						{ id: 'zoom-fit', label: copy.zoomFit, shortcut: 'Ctrl+F', onClick: actions.zoomFit },
						{ id: 'center-view-on-playhead', label: copy.centerViewOnPlayhead, onClick: actions.centerOnPlayhead },
						divider(),
						{ id: 'collapse-all-tracks', label: copy.collapseAllTracks, disabled: !project?.tracks.length, onClick: actions.collapseAllTracks },
						{ id: 'expand-all-tracks', label: copy.expandAllTracks, disabled: !project?.tracks.length, onClick: actions.expandAllTracks },
					],
				},
				divider(),
				{ id: 'fullscreen', label: copy.fullscreen, shortcut: 'F11', onClick: actions.fullscreen },
			],
		},
		{
			id: 'transport-menu',
			label: copy.transport,
			items: [
				{ id: 'action://playback/play', label: copy.play, shortcut: 'Space', onClick: actions.playPause },
				{ id: 'action://playback/stop', label: copy.stop, onClick: actions.stop },
				divider(),
				{ id: 'toggle-loop-region', label: copy.loop, checked: Boolean(project?.loop?.enabled), onClick: actions.toggleLoop },
				{ id: 'metronome', label: copy.metronome, checked: Boolean(snapshot.recordingOptions?.metronome), onClick: actions.toggleMetronome },
			],
		},
		{
			id: 'tracks',
			label: copy.tracksMenu,
			items: [
				{
					id: 'add-new-track',
					label: copy.addNewTrack,
					items: [
						{ id: 'new-audio-track', label: copy.audioTrack, disabled: editBlocked, onClick: actions.addAudioTrack },
						{ id: 'new-label-track', label: copy.labelTrack, disabled: editBlocked, onClick: actions.addLabelTrack },
					],
				},
				{ id: 'duplicate-track', label: copy.duplicateTrack, disabled: editBlocked || !selectedAudioTrack, onClick: actions.duplicateTrack },
				{ id: 'remove-track', label: copy.removeTracks, disabled: editBlocked || !selectedTrack, onClick: actions.removeTrack },
				{
					id: 'move-track',
					label: copy.moveTrack,
					disabled: editBlocked || !selectedTrack,
					items: [
						{ id: 'track-move-top', label: copy.moveTrackTop, disabled: !selectedTrackBlock || selectedTrackBlock.start === 0, onClick: actions.moveTrackTop },
						{ id: 'track-move-up', label: copy.moveTrackUp, disabled: !selectedTrackBlock || selectedTrackBlock.start === 0, onClick: actions.moveTrackUp },
						{ id: 'track-move-down', label: copy.moveTrackDown, disabled: !selectedTrackBlock || selectedTrackBlock.end === project.tracks.length - 1, onClick: actions.moveTrackDown },
						{ id: 'track-move-bottom', label: copy.moveTrackBottom, disabled: !selectedTrackBlock || selectedTrackBlock.end === project.tracks.length - 1, onClick: actions.moveTrackBottom },
					],
				},
				{
					id: 'track-display',
					label: copy.trackDisplay,
					disabled: !selectedAudioTrack,
					items: [
						{ id: 'action://trackedit/track-view-waveform', label: copy.waveformView, checked: selectedAudioTrack?.displayMode === 'waveform', onClick: () => actions.setTrackDisplay('waveform') },
						{ id: 'action://trackedit/track-view-spectrogram', label: copy.spectrogramView, checked: selectedAudioTrack?.displayMode === 'spectrogram', onClick: () => actions.setTrackDisplay('spectrogram') },
						{ id: 'action://trackedit/track-view-multi', label: copy.multiview, checked: selectedAudioTrack?.displayMode === 'multiview', onClick: () => actions.setTrackDisplay('multiview') },
					],
				},
				{
					id: 'track-rate',
					label: copy.sampleRate,
					disabled: editBlocked || !selectedAudioTrack,
					items: [44_100, 48_000, 88_200, 96_000, 192_000].map((sampleRate) => ({
						id: `action://trackedit/track/change-rate?rate=${sampleRate}`,
						label: `${sampleRate} Hz`,
						checked: selectedAudioSampleRates.size === 1 && selectedAudioSampleRates.has(sampleRate),
						onClick: () => actions.setTrackRate(sampleRate),
					})).concat([{ id: 'track-change-rate-custom', label: `${copy.sampleRate}`, onClick: actions.openTrackRate }]),
				},
				{
					id: 'track-format',
					label: copy.sampleFormat,
					disabled: editBlocked || !selectedAudioTrack,
					items: [
						['int16', copy.sampleFormatPcm.replace('{bits}', '16')],
						['int24', copy.sampleFormatPcm.replace('{bits}', '24')],
						['float32', copy.sampleFormatFloat32],
					].map(([sampleFormat, label]) => ({
						id: `action://trackedit/track/change-format?format=${sampleFormat}`,
						label,
						checked: selectedAudioSampleFormats.size === 1 && selectedAudioSampleFormats.has(sampleFormat),
						onClick: () => actions.setTrackSampleFormat(sampleFormat),
					})),
				},
				{
					id: 'track-channels',
					label: copy.trackChannels,
					disabled: editBlocked || !selectedAudioTrack,
					items: [
						{ id: 'track-make-stereo', label: copy.makeStereoTrack, disabled: !compatibleMonoTracks, onClick: actions.makeStereoTrack },
						{ id: 'track-swap-channels', label: copy.swapStereoChannels, disabled: selectedAudioChannelCount !== 2, onClick: actions.swapTrackChannels },
						{ id: 'track-split-stereo-to-lr', label: copy.splitStereoLr, disabled: selectedAudioChannelCount !== 2, onClick: actions.splitStereoLr },
						{ id: 'track-split-stereo-to-center', label: copy.splitStereoCenter, disabled: selectedAudioChannelCount !== 2, onClick: actions.splitStereoCenter },
					],
				},
				divider(),
				{ id: 'mute-track', label: selectedAudioTrack?.mute ? copy.unmuteTrack : copy.muteTrack, disabled: editBlocked || !selectedAudioTrack, onClick: actions.toggleTrackMute },
				unavailable('mute-all', copy.muteAllTracks),
				unavailable('unmute-all', copy.unmuteAllTracks),
				{ id: 'mix', label: copy.mixMenu, items: [{
					id: 'mixdown-to',
					label: copy.mixdownTo,
					disabled: editBlocked || !mixableAudioSelected,
					onClick: actions.mixAndRender,
				}] },
				{ id: 'resample', label: copy.resample, disabled: editBlocked || !selectedAudioTrack, onClick: actions.openResample },
				{ id: 'menu-align', label: copy.alignTracks, items: [
					unavailable('align-end-to-end', copy.alignEndToEnd),
					unavailable('align-together', copy.alignTogether),
				] },
				{ id: 'menu-sort', label: copy.sortTracks, items: [
					unavailable('sort-by-time', copy.sortByTime),
					unavailable('sort-by-name', copy.sortByName),
				] },
			],
		},
		{
			id: 'generate',
			label: copy.generateMenu,
			items: [
				unavailable('repeat-generator', copy.repeatLastGenerator),
				divider(),
				{ id: 'silence-generator', label: copy.silenceGenerator, disabled: editBlocked, onClick: () => actions.openGenerator('silence') },
				{ id: 'tone-generator', label: copy.toneGenerator, disabled: editBlocked, onClick: () => actions.openGenerator('tone') },
				{ id: 'chirp-generator', label: copy.chirpGenerator, disabled: editBlocked, onClick: () => actions.openGenerator('chirp') },
				{ id: 'dtmf-generator', label: copy.dtmfGenerator, disabled: editBlocked, onClick: () => actions.openGenerator('dtmf') },
				{ id: 'noise-generator', label: copy.noiseGenerator, disabled: editBlocked, onClick: () => actions.openGenerator('noise') },
				{ id: 'nyquist-generators', label: copy.nyquist, items: nyquistItems('generate') },
			],
		},
		{
			id: 'effect',
			label: copy.effectMenu,
			items: [
				{ id: 'realtime-effects', label: copy.addRealtimeEffects, disabled: !selectedAudioTrack, onClick: actions.openEffects },
				{ id: 'repeat-effect', label: copy.repeatLastEffect, disabled: editBlocked || !selectionActive || !snapshot.effects?.canRepeatLast, onClick: actions.repeatLastEffect },
				divider(),
				...effectGroups,
				{ id: 'pitch-tempo', label: copy.pitchTempo, items: [
					{ id: 'change-pitch', label: copy.changePitch, disabled: editBlocked || !selectedAudioTrack, onClick: () => actions.openSelectionEffect('audacity-change-pitch') },
					{ id: 'change-tempo', label: copy.changeTempo, disabled: editBlocked || !selectedAudioTrack, onClick: () => actions.openSelectionEffect('audacity-change-tempo') },
					{ id: 'effect://builtin/change-speed-pitch', label: copy.changeSpeedPitch, disabled: editBlocked || !selectedAudioTrack, onClick: () => actions.openSelectionEffect('audacity-change-speed-pitch') },
					{ id: 'effect://builtin/sliding-stretch', label: copy.slidingStretch, disabled: editBlocked || !selectedAudioTrack, onClick: () => actions.openSelectionEffect('audacity-sliding-stretch') },
					...(effectLabels.has('audacity-paulstretch') ? [{
						id: 'audacity-paulstretch',
						label: effectLabels.get('audacity-paulstretch') || 'Paulstretch',
						disabled: editBlocked || !selectedAudioTrack,
						onClick: () => actions.openSelectionEffect('audacity-paulstretch'),
					}] : []),
				] },
				{
					id: 'nyquist-effects',
					label: copy.nyquist,
					items: nyquistItems('legacy'),
				},
				{
					id: 'spectral-effects',
					label: copy.spectralEffects,
					items: [
						{ id: 'spectral-box-select', label: copy.spectralBoxSelect, disabled: editBlocked || !spectralTrackSelected, onClick: actions.openSpectralSelection },
						{ id: 'spectral-delete', label: copy.spectralDelete, disabled: editBlocked || !frequencySelectionActive, onClick: actions.deleteSpectralSelection },
						{ id: 'spectral-amplify', label: copy.spectralAmplify, disabled: editBlocked || !frequencySelectionActive, onClick: actions.amplifySpectralSelection },
					],
				},
			],
		},
		{
			id: 'analyze',
			label: copy.analyzeMenu,
			items: [
				unavailable('repeat-analyzer', copy.repeatLastAnalyzer),
				divider(),
				{ id: 'analysis', label: copy.analysisCommand, disabled: blocked || !project?.clips.length, onClick: () => actions.openAnalysis('levels') },
				{ id: 'plot-spectrum', label: copy.plotSpectrum, disabled: blocked || !selectionActive || !selectedAudioTrack, onClick: () => actions.openAnalysis('spectrum') },
				{ id: 'find-clipping', label: copy.findClipping, disabled: blocked || !selectionActive || !selectedAudioTrack, onClick: () => actions.openAnalysis('clipping') },
				{ id: 'contrast', label: copy.contrast, disabled: blocked || !selectionActive || !selectedAudioTrack, onClick: () => actions.openAnalysis('contrast') },
				{ id: 'ebu-r128-metrics', label: copy.meterTypeEbuR128, disabled: !project, onClick: actions.openEbuR128 },
				{ id: 'nyquist-analyzers', label: copy.nyquist, items: nyquistItems('analyze') },
			],
		},
		{
			id: 'tools',
			label: copy.toolsMenu,
			items: [
				{ id: 'manage-macros', label: copy.macroManager, disabled: !project, onClick: actions.openMacroManager },
				{ id: 'nyquist-prompt', label: copy.nyquistPrompt, disabled: !project, onClick: () => actions.openNyquist() },
				unavailable('reset-configuration', copy.resetConfiguration),
			],
		},
			{
				id: 'help',
				label: copy.helpMenu,
				items: [
					{ id: 'tutorials', label: copy.tutorials, onClick: actions.tutorials },
					{ id: 'manual', label: copy.manual, onClick: actions.manual },
				{ id: 'support', label: copy.support, onClick: actions.support },
				divider(),
				{ id: 'about', label: copy.aboutEditor, onClick: actions.about },
			],
		},
	], { locale, copy, materializeDisabled: true, actionRuntime });
}

function handleWorkspaceKeyboard(event, snapshot, run, registry = {}) {
	if (event.defaultPrevented) return;
	const zoomActionId = projectZoomShortcut(event);
	if (zoomActionId) {
		const handler = resolveAudioEditorShortcutHandler(zoomActionId, registry);
		if (handler) {
			run(handler);
			event.preventDefault();
		}
		return;
	}
	if (event.target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="menu"], [role="menubar"], [role="toolbar"], [role="slider"], [role="spinbutton"]')) return;
	const shortcutAction = matchAudioEditorShortcut(event, snapshot.preferences?.shortcuts || {});
	const handler = shortcutAction ? resolveAudioEditorShortcutHandler(shortcutAction, registry) : null;
	if (handler) {
		run(handler);
		event.preventDefault();
	}
}

function projectZoomShortcut(event) {
	if (event.altKey || (!event.ctrlKey && !event.metaKey)) return null;
	if (event.key === '+' || event.key === '=') return 'zoom-in';
	if (event.key === '-' || event.key === '_') return 'zoom-out';
	return null;
}

function matchAudioEditorShortcut(event, shortcuts) {
	const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
	const modifiers = [];
	if (event.ctrlKey || event.metaKey) modifiers.push('Ctrl');
	if (event.altKey) modifiers.push('Alt');
	if (event.shiftKey) modifiers.push('Shift');
	const binding = [...modifiers, key].join('+').toLowerCase();
	for (const [actionId, bindings] of Object.entries(shortcuts)) {
		if (bindings.some((candidate) => normalizeAudioEditorShortcut(candidate).toLowerCase() === binding)) return actionId;
	}
	return null;
}

function resolveAudioEditorShortcutHandler(actionId, { actionRuntime, menus = [] } = {}) {
	const canonicalActionId = resolveAudacityActionId(actionId);
	const menuMatch = findShortcutMenuHandler(menus, canonicalActionId);
	if (menuMatch.matched) return menuMatch.handler;
	return resolveAudacityActionHandler(canonicalActionId, actionRuntime);
}

function findShortcutMenuHandler(items, canonicalActionId) {
	for (const item of items || []) {
		if (!item || item.divider) continue;
		const itemActionId = resolveAudacityActionId(item.parityActionId || item.id);
		if (itemActionId === canonicalActionId && !item.items?.length) {
			return {
				matched: true,
				handler: item.disabled || typeof item.onClick !== 'function' ? null : item.onClick,
			};
		}
		const childMatch = findShortcutMenuHandler(item.items, canonicalActionId);
		if (childMatch.matched) return childMatch;
	}
	return { matched: false, handler: null };
}

function handleEditorToolbarKeyDown(event) {
	if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
	const toolbar = event.currentTarget.querySelector('.toolbar[role="toolbar"]');
	if (!toolbar) return;
	const focusables = editorToolbarFocusables(toolbar);
	const current = focusables.findIndex((element) => element === document.activeElement || element.contains(document.activeElement));
	if (current < 0 || !focusables.length) return;
	event.preventDefault();
	event.stopPropagation();
	let next = current;
	if (event.key === 'Home') next = 0;
	else if (event.key === 'End') next = focusables.length - 1;
	else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % focusables.length;
	else next = (current - 1 + focusables.length) % focusables.length;
	const activeTabIndex = Math.max(0, Number.parseInt(focusables[current].getAttribute('tabindex') || '0', 10));
	focusables.forEach((element, index) => { element.tabIndex = index === next ? activeTabIndex : -1; });
	focusables[next].focus({ preventScroll: true });
	focusables[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function handleEditorToolbarFocus(event) {
	const toolbar = event.currentTarget.querySelector('.toolbar[role="toolbar"]');
	if (!toolbar) return;
	const focusables = editorToolbarFocusables(toolbar);
	const current = focusables.findIndex((element) => element === event.target || element.contains(event.target));
	if (current < 0) return;
	const activeTabIndex = Math.max(0, ...focusables.map((element) => Number.parseInt(element.getAttribute('tabindex') || '-1', 10)));
	focusables.forEach((element, index) => { element.tabIndex = index === current ? activeTabIndex : -1; });
}

function handleEditorToolbarBlur(event) {
	if (event.currentTarget.contains(event.relatedTarget)) return;
	const toolbar = event.currentTarget.querySelector('.toolbar[role="toolbar"]');
	if (!toolbar) return;
	const focusables = editorToolbarFocusables(toolbar);
	const activeTabIndex = Math.max(0, ...focusables.map((element) => Number.parseInt(element.getAttribute('tabindex') || '-1', 10)));
	focusables.forEach((element, index) => { element.tabIndex = index === 0 ? activeTabIndex : -1; });
}

function editorToolbarFocusables(toolbar) {
	return [...toolbar.querySelectorAll('button, select, input, [role="group"]')].filter((element) => {
		if (element.matches(':disabled, [aria-disabled="true"]')) return false;
		if (element.getAttribute('role') !== 'group' && element.closest('[role="group"]')) return false;
		return element.getClientRects().length > 0;
	});
}

function useMediaQuery(query) {
	const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
	useEffect(() => {
		const media = window.matchMedia(query);
		const update = () => setMatches(media.matches);
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	}, [query]);
	return matches;
}

function playbackMeterTicks(type, range, meterSize) {
	return playbackMeterFullSteps(type, range, meterSize).map((step) => {
		const db = type === 'amplitude'
			? playbackMeterAmplitudeToDb(step, range)
			: step;
		return {
			label: type === 'amplitude' ? step.toFixed(2) : String(Math.abs(Math.round(step))),
			position: type === 'amplitude'
				? step * 100
				: playbackMeterPercent(db, type, range),
		};
	});
}

function loadPlaybackMeterSettings() {
	return loadMeterSettings(
		PLAYBACK_METER_SETTINGS_STORAGE_KEY,
		LEGACY_PLAYBACK_METER_SETTINGS_STORAGE_KEY,
		DEFAULT_PLAYBACK_METER_SETTINGS,
	);
}

function loadRecordingMeterSettings() {
	return loadMeterSettings(
		RECORDING_METER_SETTINGS_STORAGE_KEY,
		LEGACY_RECORDING_METER_SETTINGS_STORAGE_KEY,
		DEFAULT_RECORDING_METER_SETTINGS,
	);
}

function loadMeterSettings(storageKey, legacyStorageKey, defaults) {
	try {
		return normalizeMeterSettings(
			JSON.parse(
				globalThis.localStorage?.getItem(storageKey)
				|| globalThis.localStorage?.getItem(legacyStorageKey)
				|| 'null',
			),
			defaults,
		);
	} catch {
		return { ...defaults };
	}
}

function normalizeMeterSettings(value, defaults) {
	const position = METER_POSITIONS.includes(value?.position) ? value.position : defaults.position;
	const style = METER_STYLES.includes(value?.style) ? value.style : defaults.style;
	const type = METER_TYPES.includes(value?.type) ? value.type : defaults.type;
	const dbRange = METER_DB_RANGES.includes(Number(value?.dbRange))
		? Number(value.dbRange)
		: defaults.dbRange;
	const ebuScale = EBU_METER_SCALES.includes(value?.ebuScale) ? value.ebuScale : defaults.ebuScale;
	const ebuUnit = EBU_METER_UNITS.includes(value?.ebuUnit) ? value.ebuUnit : defaults.ebuUnit;
	const ebuLiveValue = EBU_METER_LIVE_VALUES.includes(value?.ebuLiveValue)
		? value.ebuLiveValue
		: defaults.ebuLiveValue;
	return { position, style, type, dbRange, ebuScale, ebuUnit, ebuLiveValue };
}

function formatDb(value) {
	if (!Number.isFinite(value) || value <= -60) return '−∞ dB';
	const rounded = Math.round(value * 10) / 10;
	return `${String(rounded).replace('-', '−')} dB`;
}

function formatEbuLoudness(value, unit = 'absolute') {
	const suffix = unit === 'relative' ? 'LU' : 'LUFS';
	if (!Number.isFinite(value)) return `— ${suffix}`;
	const displayed = unit === 'relative' ? value + 23 : value;
	return `${String(displayed.toFixed(1)).replace('-', '−')} ${suffix}`;
}

function formatLra(value) {
	return Number.isFinite(value)
		? `${String(value.toFixed(1)).replace('-', '−')} LU`
		: '— LU';
}

function formatDbtp(value) {
	return Number.isFinite(value)
		? `${String(value.toFixed(1)).replace('-', '−')} dBTP`
		: '— dBTP';
}

function formatPlaybackSpeed(rate) {
	return Number(rate).toFixed(2).replace(/\.00$/u, '').replace(/(\.\d)0$/u, '$1');
}

function desktopExternalDestination(url) {
	if (String(url).startsWith('mailto:')) return 'support';
	if (String(url).includes('support.audacityteam.org')) return 'manual';
	return 'homepage';
}

function isDesktopTextEditingElement(element, action) {
	if (!element || element.disabled || (element.readOnly && !['copy', 'selectAll'].includes(action))) return false;
	if (element.isContentEditable) return true;
	if (typeof HTMLTextAreaElement === 'function' && element instanceof HTMLTextAreaElement) return true;
	if (typeof HTMLInputElement !== 'function' || !(element instanceof HTMLInputElement)) return false;
	return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(element.type);
}

function formatDate(value, locale) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(normalizeBcp47Locale(locale));
}

function formatDateTimeLocalInput(value) {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 19);
}
