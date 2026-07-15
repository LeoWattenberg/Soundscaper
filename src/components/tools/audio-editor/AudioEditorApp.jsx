import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Button,
	DialogHeader,
	DialogSideNav,
	Dropdown,
	Flyout,
	Icon,
	Knob,
	LabeledCheckbox,
	LabeledRadio,
	MasterMeter,
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
	TrackMeter,
	TransportButton,
	ToolButton,
} from '@dilsonspickles/components';
import '@dilsonspickles/components/style.css';

import { normalizeBcp47Locale } from '../../../i18n/locale.js';
import { createAudioEditorController } from '../../../lib/tools/audio-editor/app.js';
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
import { projectDurationFrames } from '../../../lib/tools/audio-editor/project.js';
import {
	AnalysisDialog,
	AudioEditorEffectsOverlay,
	AudioEditorMacroManagerDialog,
	ClipPropertiesDialog,
	ExportDialog,
	SelectionEffectsDialog,
} from './AudioEditorInspector.jsx';
import AudioEditorMenuBar from './AudioEditorMenuBar.jsx';
import AudioEditorTimeline from './AudioEditorTimeline.jsx';
import {
	DesignSystemProviders,
	useAudioEditorSnapshot,
	useAudioEditorTelemetry,
	useAudioEditorThemeVariables,
} from './DesignSystemRuntime.jsx';
import AudioEditorButtonTooltips from './AudioEditorButtonTooltips.jsx';
import AudioEditorResizableSurface from './AudioEditorResizableSurface.jsx';
import RecordingInputSelectors from './RecordingInputSelectors.jsx';
import './audio-editor-design-system.css';

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

function AudioEditorWorkspace({ locale, copy }) {
	const editorThemeVariables = useAudioEditorThemeVariables();
	const controller = useMemo(() => createAudioEditorController(null, {
		headless: true,
		locale,
		copy,
	}), [copy, locale]);
	const parityRuntime = useMemo(() => createAudacityActionRuntime(controller), [controller]);
	const [parityUi, setParityUi] = useState(() => parityRuntime.uiController.getSnapshot());
	const snapshot = useAudioEditorSnapshot(controller);
	const [activeSurface, setActiveSurface] = useState(null);
	const [effectsOverlay, setEffectsOverlay] = useState(null);
	const [macroDraft, setMacroDraft] = useState(() => ({ name: copy.untitledMacro, effects: [] }));
	const [dialog, setDialog] = useState(null);
	const [dialogValue, setDialogValue] = useState('');
	const [dialogSourceKey, setDialogSourceKey] = useState('global');
	const [localError, setLocalError] = useState('');
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [showArmControls, setShowArmControls] = useState(false);
	const [automationToolEnabled, setAutomationToolEnabled] = useState(false);
	const [generatorType, setGeneratorType] = useState('tone');
	const [analysisMode, setAnalysisMode] = useState('levels');
	const [preferencesPage, setPreferencesPage] = useState('shortcuts');
	const importInputRef = useRef(null);
	const labelInputRef = useRef(null);
	const aup4InputRef = useRef(null);
	const legacyAupInputRef = useRef(null);
	const legacyDataInputRef = useRef(null);
	const pendingLegacyProjectRef = useRef(null);
	const editorRef = useRef(null);
	const workspaceRef = useRef(null);
	const isCompact = useMediaQuery('(max-width: 900px)');
	const project = snapshot.project;
	const preferences = snapshot.preferences;
	const toolbarPreferences = preferences?.workspace?.toolbars || {};
	const toolbarButtonPreferences = preferences?.workspace?.toolbarButtons || {};
	const blocked = Boolean(
		snapshot.importing
		|| snapshot.recordingStarting
		|| snapshot.recording
		|| snapshot.exporting
		|| snapshot.processingEffect
		|| snapshot.analysisProcessing
		|| snapshot.sampleEdit?.processing,
	);
	const editBlocked = blocked || snapshot.readOnly;
	const selectionActive = Boolean(snapshot.selection);
	const selectedClip = project?.clips.find((clip) => clip.id === snapshot.selectedClipId) || null;
	const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId) || null;
	const selectedAudioTrack = selectedTrack?.type === 'label' ? null : selectedTrack;
	const selectedAudioTrackRate = trackSourceRate(project, selectedAudioTrack, project?.sampleRate || 48_000);

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
	const zoomProject = useCallback((direction) => run(() => (
		direction === 'in'
			? controller.actions.timeline.zoomIn()
			: controller.actions.timeline.zoomOut()
	)), [controller, run]);

	useEffect(() => {
		const editor = editorRef.current;
		if (!editor) return undefined;
		const onWheel = (event) => {
			if (event.altKey || (!event.ctrlKey && !event.metaKey) || event.deltaY === 0) return;
			event.preventDefault();
			zoomProject(event.deltaY < 0 ? 'in' : 'out');
		};
		editor.addEventListener('wheel', onWheel, { passive: false });
		return () => editor.removeEventListener('wheel', onWheel);
	}, [zoomProject]);

	const toggleFullscreen = useCallback(() => {
		setIsFullscreen((current) => !current);
	}, []);
	const toggleSplitTool = useCallback(() => {
		setAutomationToolEnabled(false);
		return parityRuntime.actions.tools.toggleSplitTool();
	}, [parityRuntime]);
	const toggleAutomationTool = useCallback(() => {
		setAutomationToolEnabled((enabled) => {
			if (!enabled && parityRuntime.uiController.getSnapshot().flags.splitTool) {
				parityRuntime.actions.tools.toggleSplitTool();
			}
			return !enabled;
		});
	}, [parityRuntime]);

	const toggleRecording = useCallback(() => {
		if (snapshot.recording) return run(() => controller.actions.recording.stop());
		const trackId = showArmControls ? undefined : snapshot.selectedTrackId || project?.tracks[0]?.id;
		return run(() => controller.actions.recording.start({ trackId }));
	}, [controller, project?.tracks, run, showArmControls, snapshot.recording, snapshot.selectedTrackId]);

	const openProjects = useCallback(() => {
		setDialog('projects');
		run(() => controller.actions.project.list());
	}, [controller, run]);

	const openSurface = useCallback((surface, options = {}) => {
		setEffectsOverlay(null);
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

	const openEffects = useCallback((trackId, anchorRect = null, scope = 'track') => {
		if (!trackId && scope !== 'master') return;
		setActiveSurface(null);
		setEffectsOverlay((current) => {
			if (current?.trackId === trackId && current.scope === scope) {
				requestAnimationFrame(() => current.returnFocus?.focus?.({ preventScroll: true }));
				return null;
			}
			return {
				trackId,
				scope,
				anchorRect,
				returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
			};
		});
	}, []);

	const closeEffects = useCallback(() => {
		setEffectsOverlay((current) => {
			requestAnimationFrame(() => current?.returnFocus?.focus?.({ preventScroll: true }));
			return null;
		});
	}, []);

	useEffect(() => {
		if (!effectsOverlay) return undefined;
		const onKeyDown = (event) => {
			if (event.key !== 'Escape') return;
			if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="listbox"], [role="menu"]')) return;
			event.preventDefault();
			closeEffects();
		};
		document.addEventListener('keydown', onKeyDown, true);
		return () => document.removeEventListener('keydown', onKeyDown, true);
	}, [closeEffects, effectsOverlay]);

	const durationFrames = project ? projectDurationFrames(project) : 0;
	const statusMessage = localError || snapshot.status?.message || copy.ready;
	const statusState = localError ? 'error' : snapshot.status?.state || 'info';
	const saveText = snapshot.save?.state === 'saving'
		? copy.projectSaving
		: snapshot.save?.state === 'dirty'
			? copy.projectDirty
			: copy.projectSaved;
	const recordLabel = showArmControls ? copy.record : copy.recordActiveTrack;

	const editItems = [
		{ action: 'cut', label: copy.cut, icon: 'cut', disabled: editBlocked || !selectionActive },
		{ action: 'copy', label: copy.copy, icon: 'copy', disabled: editBlocked || !selectionActive },
		{ action: 'paste', label: copy.paste, icon: 'paste', disabled: editBlocked || !snapshot.history?.hasClipboard },
		{ action: 'split', label: copy.split, icon: 'split', disabled: editBlocked || !selectedClip },
		{ action: 'delete', label: copy.liftDelete, icon: 'trash', disabled: editBlocked || (!selectionActive && !selectedClip) },
		{ action: 'rippleDelete', label: copy.rippleDelete, icon: 'trim', disabled: editBlocked || !selectionActive },
	];

	const executeEdit = (action) => run(() => controller.actions.edit[action]());
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
	const openWorkspacePanel = useCallback((panelId) => {
		run(() => controller.actions.preferences.setPanel(panelId, { visible: true }));
		requestAnimationFrame(() => {
			const panel = workspaceRef.current?.querySelector(`[data-workspace-panel="${panelId}"]`);
			if (!panel) return;
			panel.tabIndex = -1;
			panel.focus({ preventScroll: false });
		});
	}, [controller, run]);
	const openExternal = useCallback((url) => {
		const opened = globalThis.open?.(url, '_blank', 'noopener,noreferrer');
		if (opened) opened.opener = null;
	}, []);
	useEffect(() => {
		const request = parityUi.request;
		if (!request) return;
		const payload = request.payload || {};
		if (request.type === 'open-surface') {
			if (payload.surface === 'generator') setGeneratorType(payload.type || 'tone');
			if (payload.surface === 'selection-effect' && payload.type) {
				run(() => controller.actions.effects.setSelectionType(payload.type));
			}
			openSurface(payload.surface || null, payload);
		} else if (request.type === 'open-external') openExternal(payload.url);
		else if (request.type === 'toggle-fullscreen') toggleFullscreen();
		else if (request.type === 'choose-audio-files') importInputRef.current?.click();
		else if (request.type === 'open-about') setDialog('about');
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
		openWorkspacePanel,
		parityUi.request?.revision,
		project?.sampleRate,
		run,
		selectedAudioTrackRate,
		selectedTrack?.name,
		snapshot.timeline?.pixelsPerSecond,
		toggleFullscreen,
	]);
	const applicationMenus = createApplicationMenus({
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
		effectsOverlay,
		uiFlags,
		actionRuntime: parityRuntime.actions,
			actions: {
			newProject: () => run(() => controller.actions.project.create()),
			openProjects,
			openRecentProject: (projectId) => run(() => controller.actions.project.openRecent(projectId)),
			clearRecentProjects: () => run(() => controller.actions.project.clearRecent()),
			closeProject: () => run(() => controller.actions.project.close()),
			openAup4: () => aup4InputRef.current?.click(),
			openLegacyAup: () => legacyAupInputRef.current?.click(),
			saveProject: () => run(() => controller.actions.project.save()),
			saveAup4: () => run(() => controller.actions.project.saveAup4({ saveCopy: snapshot.readOnly })),
				importAudio: () => importInputRef.current?.click(),
				importLabels: () => labelInputRef.current?.click(),
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
			zoomIn: () => run(() => controller.actions.timeline.zoomIn()),
			zoomOut: () => run(() => controller.actions.timeline.zoomOut()),
			zoomDefault: () => run(() => parityRuntime.actions.timeline.zoomDefault()),
			zoomSelection: () => run(() => parityRuntime.actions.timeline.zoomSelection()),
			zoomToggle: () => run(() => parityRuntime.actions.timeline.zoomToggle()),
			zoomFit: () => run(() => controller.actions.timeline.zoomFit()),
			centerOnPlayhead: () => run(() => parityRuntime.actions.timeline.centerOnPlayhead()),
			fullscreen: () => run(toggleFullscreen),
			record: toggleRecording,
			recordNewTrack: () => run(() => controller.actions.recording.startNewTrack()),
			pauseRecording: () => run(() => controller.actions.recording.pause()),
			toggleLeadIn: () => run(() => controller.actions.recording.toggleLeadIn()),
			toggleMetronome: () => run(() => controller.actions.transport.toggleMetronome()),
			toggleArmControls: () => setShowArmControls((current) => !current),
			stop: () => run(() => controller.actions.transport.stop()),
			playPause: () => run(() => controller.actions.transport.playPause()),
			toggleMonitoring: () => run(() => controller.actions.recording.setMonitoring(!snapshot.monitor?.enabled)),
			requestInputAccess: () => run(() => controller.actions.recording.requestInputAccess()),
			refreshInputs: () => run(() => controller.actions.recording.refreshInputs()),
			releaseInputs: () => run(() => controller.actions.recording.releaseInputs()),
			openRecordingOffset: () => {
				setDialogValue(String(snapshot.monitor?.latencyOffsetMs ?? 0));
				setDialogSourceKey('global');
				setDialog('recording-offset');
			},
			addTrack: () => run(() => controller.actions.track.add()),
			addAudioTrack: () => run(() => controller.actions.track.add()),
			addMonoTrack: () => run(() => controller.actions.track.addMono()),
			addStereoTrack: () => run(() => controller.actions.track.addStereo()),
			addLabelTrack: () => run(() => controller.actions.track.addLabel()),
			duplicateTrack: () => snapshot.selectedTrackId && run(() => controller.actions.track.duplicate(snapshot.selectedTrackId)),
			removeTrack: () => snapshot.selectedTrackId && run(() => controller.actions.track.remove(snapshot.selectedTrackId)),
			moveTrackUp: () => snapshot.selectedTrackId && run(() => controller.actions.track.moveUp(snapshot.selectedTrackId)),
			moveTrackDown: () => snapshot.selectedTrackId && run(() => controller.actions.track.moveDown(snapshot.selectedTrackId)),
			moveTrackTop: () => snapshot.selectedTrackId && run(() => controller.actions.track.moveTop(snapshot.selectedTrackId)),
			moveTrackBottom: () => snapshot.selectedTrackId && run(() => controller.actions.track.moveBottom(snapshot.selectedTrackId)),
			makeStereoTrack: () => run(() => controller.actions.track.makeStereo(snapshot.selectedTrackId)),
			swapTrackChannels: () => run(() => controller.actions.track.swapChannels(snapshot.selectedTrackId)),
			splitStereoLr: () => run(() => controller.actions.track.splitStereoLR(snapshot.selectedTrackId)),
			splitStereoCenter: () => run(() => controller.actions.track.splitStereoCenter(snapshot.selectedTrackId)),
			collapseAllTracks: () => run(() => controller.actions.track.collapseAll()),
			expandAllTracks: () => run(() => controller.actions.track.expandAll()),
			setTrackDisplay: (mode) => snapshot.selectedTrackId && run(() => controller.actions.track.setDisplayMode(snapshot.selectedTrackId, mode)),
			setTrackRate: (sampleRate) => snapshot.selectedTrackId && run(() => controller.actions.track.setRate(snapshot.selectedTrackId, sampleRate)),
			setTrackSampleFormat: (sampleFormat) => snapshot.selectedTrackId && run(() => controller.actions.track.setSampleFormat(snapshot.selectedTrackId, sampleFormat)),
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
			openAnalysis: (mode = 'levels') => {
				setAnalysisMode(mode);
				openSurface('analysis');
				const scope = selectedAudioTrack ? 'track' : 'master';
				if (mode === 'spectrum') run(() => controller.actions.analysis.plotSpectrum(scope));
				else if (mode === 'clipping') run(() => controller.actions.analysis.findClipping(scope));
			},
			setWorkspace: (workspaceId) => run(() => controller.actions.preferences.setWorkspace(workspaceId)),
			toggleToolbar: (toolbarId) => run(() => controller.actions.preferences.toggleToolbar(toolbarId)),
			togglePanel: (panelId) => run(() => controller.actions.preferences.togglePanel(panelId)),
			quickHelp: () => workspaceRef.current?.querySelector('.kw-audio-editor__keyboard-help')?.focus?.(),
			manual: () => openExternal('https://support.audacityteam.org/au4'),
			tutorials: () => openExternal('https://support.audacityteam.org/au4'),
			support: () => openExternal('mailto:team@kw.media?subject=Soundscaper%20support'),
			about: () => setDialog('about'),
		},
	});
	const effectsPosition = effectsOverlay
		? resolveEffectsOverlayPosition(workspaceRef.current, effectsOverlay.anchorRect, isCompact)
		: null;

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
				accept="audio/*,.aac,.aif,.aiff,.aup3,.flac,.m4a,.mp2,.mp3,.oga,.ogg,.opus,.wav,.webm,.wv"
				multiple
				onChange={(event) => {
					const files = [...event.currentTarget.files];
					event.currentTarget.value = '';
					if (files.length) run(() => controller.actions.project.importFiles(files));
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
				editBlocked={editBlocked}
				blocked={blocked}
				executeEdit={executeEdit}
				onSaveAup4={() => run(() => controller.actions.project.saveAup4({ saveCopy: snapshot.readOnly }))}
				onExportAudio={() => openSurface('export')}
				onToggleMixer={() => run(() => controller.actions.preferences.togglePanel('mixer'))}
			/>

			<div className="kw-audio-editor__toolbars">
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
					automationToolEnabled={automationToolEnabled}
					onToggleAutomationTool={toggleAutomationTool}
					actionRuntime={parityRuntime.actions}
					onOpenSpectralSelection={openSpectralSelection}
				/>
			</div>

			{snapshot.monitor?.enabled && (
				<div className="kw-audio-editor__monitor-warning" role="alert">{copy.monitorWarning}</div>
			)}

			<div
				ref={workspaceRef}
				className={`kw-audio-editor__workspace${effectsOverlay ? ' kw-audio-editor__workspace--effects-open' : ''}`}
			>
				<WorkspacePanelDock
					dock="left"
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					run={run}
					showArmControls={showArmControls}
					onOpenEffects={openEffects}
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
						onToggleArmControls={() => setShowArmControls((current) => !current)}
					/>
					<p className="kw-audio-editor__keyboard-help" tabIndex={-1}>{copy.keyboardHelp}</p>
				</main>
				<WorkspacePanelDock
					dock="bottom"
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					run={run}
					showArmControls={showArmControls}
					onOpenEffects={openEffects}
				/>
				</div>}
				<WorkspacePanelDock
					dock="right"
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					run={run}
					showArmControls={showArmControls}
					onOpenEffects={openEffects}
				/>
				<WorkspacePanelDock
					dock="floating"
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					run={run}
					showArmControls={showArmControls}
					onOpenEffects={openEffects}
				/>

				{effectsOverlay && effectsPosition && (
					<div
						className="kw-audio-editor__effects-surface"
						data-effects-overlay
						style={{
							'--effects-left': `${effectsPosition.left}px`,
							'--effects-top': `${effectsPosition.top}px`,
							'--effects-width': `${effectsPosition.width}px`,
							'--effects-panel-height': `${effectsPosition.panelHeight}px`,
						}}
					>
						<AudioEditorEffectsOverlay
							isOpen
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							locale={locale}
							trackId={effectsOverlay.trackId}
							scope={effectsOverlay.scope}
							onClose={closeEffects}
							position={{
								left: effectsPosition.left,
								top: effectsPosition.top,
								width: effectsPosition.width,
								height: effectsPosition.panelHeight,
							}}
						/>
					</div>
				)}
			</div>

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
					<ClipPropertiesDialog
						isOpen
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						onClose={() => setActiveSurface(null)}
					/>
				</div>
			)}
			{activeSurface === 'selection-effect' && (
				<div data-editor-surface="selection-effect">
					<SelectionEffectsDialog
						isOpen
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						locale={locale}
						onClose={() => setActiveSurface(null)}
					/>
				</div>
			)}
			{activeSurface === 'macro-manager' && (
				<div data-editor-surface="macro-manager">
					<AudioEditorMacroManagerDialog
						isOpen
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						locale={locale}
						draft={macroDraft}
						onDraftChange={setMacroDraft}
						onClose={() => setActiveSurface(null)}
					/>
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
			{activeSurface === 'analysis' && (
				<div data-editor-surface="analysis">
					<AnalysisDialog
						isOpen
						mode={analysisMode}
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						locale={locale}
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
			{activeSurface === 'export' && (
				<div data-editor-surface="export">
					<ExportDialog
						isOpen
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						locale={locale}
						onClose={() => setActiveSurface(null)}
					/>
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
						menus={applicationMenus}
						run={run}
						initialPage={preferencesPage}
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
	automationToolEnabled,
	onToggleAutomationTool,
	actionRuntime,
	onOpenSpectralSelection,
}) {
	const telemetry = useAudioEditorTelemetry(controller);
	const project = snapshot.project;
	const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId && track.type !== 'label');
	const spectralTrackSelected = Boolean(selectedTrack && (
		selectedTrack.displayMode === 'spectrogram'
		|| selectedTrack.displayMode === 'multiview'
		|| snapshot.timeline?.view === 'spectrogram'
	));
	const spectralBrushReason = audacityActionReason('spectral-brush', copy);
	const masterMeter = telemetry.meters?.master;
	const inputMeterDb = telemetry.inputMeterDb ?? -60;
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
	const transportButtonsVisible = ['play', 'stop', 'record', 'jump-start', 'jump-end', 'loop']
		.some(isToolbarButtonVisible);
	const viewButtonsVisible = ['split-tool', 'volume-automation', 'waveform-view', 'spectrogram-view', 'spectral-box-select', 'spectral-brush']
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
		{ id: 'waveform-view', label: copy.waveformView, icon: 'waveform' },
		{ id: 'spectrogram-view', label: copy.spectrogramView, icon: 'spectrogram' },
		{ id: 'spectral-box-select', label: copy.spectralBoxSelect, icon: 'spectrogram' },
		{ id: 'spectral-brush', label: copy.spectralBrush, icon: 'brush' },
		{ id: 'zoom-in', label: copy.zoomIn, icon: 'zoom-in' },
		{ id: 'zoom-out', label: copy.zoomOut, icon: 'zoom-out' },
		{ id: 'zoom-fit', label: copy.zoomFit, icon: 'zoom-to-fit' },
		...editItems.map((item) => ({ id: item.action, label: item.label, icon: item.icon })),
		{ id: 'time-display', label: copy.playhead, icon: 'playhead' },
		{ id: 'monitor', label: copy.monitor, icon: 'microphone' },
		{ id: 'playback-volume', label: copy.playbackVolume, icon: 'volume' },
	];
	const openToolbarSettings = () => {
		const rect = toolbarSettingsTriggerRef.current?.getBoundingClientRect();
		if (!rect) return;
		setToolbarSettingsPosition({ x: rect.left + rect.width / 2, y: rect.bottom });
	};
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
				rightContent={(
					<ToolbarButtonGroup className="kw-audio-editor__toolbar-settings-trigger" gap={2}>
						<span ref={setToolbarSettingsTrigger}>
							<ToolButton icon="cog" ariaLabel={copy.toolbarCustomize} onClick={openToolbarSettings} />
						</span>
					</ToolbarButtonGroup>
				)}
			>
				{toolbars.transport?.visible !== false && transportButtonsVisible && <ToolbarButtonGroup className="kw-audio-editor__transport" gap={2}>
					{isToolbarButtonVisible('play') && <TransportButton
						icon={telemetry.transportState === 'playing' ? 'pause' : 'play'}
						className="kw-audio-editor__transport-play"
						ariaLabel={telemetry.transportState === 'playing' ? copy.pause : copy.play}
						disabled={blocked && !snapshot.recording}
						active={telemetry.transportState === 'playing'}
						onClick={() => run(() => controller.actions.transport.playPause())}
					/>
					}
					{isToolbarButtonVisible('stop') && <TransportButton icon="stop" ariaLabel={copy.stop} onClick={() => run(() => controller.actions.transport.stop())} />}
					{isToolbarButtonVisible('record') && <span data-transport="record">
						<AccessibleTransportButton
							icon="record"
							className="kw-audio-editor__transport-record"
							ariaLabel={recordControlLabel}
							recording={snapshot.recording}
							pressed={Boolean(snapshot.recording)}
							disabled={snapshot.readOnly || snapshot.importing || snapshot.exporting || snapshot.transportState === 'playing'}
							onClick={toggleRecording}
						/>
					</span>
					}
					{isToolbarButtonVisible('jump-start') && <TransportButton icon="skip-back" ariaLabel={copy.jumpStart} disabled={blocked} onClick={() => run(() => controller.actions.transport.jumpStart())} />}
					{isToolbarButtonVisible('jump-end') && <TransportButton icon="skip-forward" ariaLabel={copy.jumpEnd} disabled={blocked} onClick={() => run(() => controller.actions.transport.jumpEnd())} />}
					{isToolbarButtonVisible('loop') && <AccessibleTransportButton
						icon="loop"
						ariaLabel={copy.loop}
						active={Boolean(project?.loop?.enabled)}
						pressed={Boolean(project?.loop?.enabled)}
						disabled={!selectionActive}
						onClick={() => run(() => controller.actions.transport.toggleLoop())}
					/>
					}
				</ToolbarButtonGroup>}

				{toolbars.tools?.visible !== false && <>
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
					{isToolbarButtonVisible('waveform-view') && <ToggleToolButton icon="waveform" isActive={snapshot.timeline?.view === 'waveform'} ariaLabel={copy.waveformView} onClick={() => run(() => controller.actions.timeline.setView('waveform'))} />}
					{isToolbarButtonVisible('spectrogram-view') && <ToggleToolButton icon="spectrogram" isActive={snapshot.timeline?.view === 'spectrogram'} ariaLabel={copy.spectrogramView} onClick={() => run(() => controller.actions.timeline.setView('spectrogram'))} />}
					{isToolbarButtonVisible('spectral-box-select') && <span data-action-id="spectral-box-select">
						<ToolButton
							icon="spectrogram"
							ariaLabel={copy.spectralBoxSelect}
							disabled={!spectralTrackSelected}
							onClick={onOpenSpectralSelection}
						/>
					</span>
					}
					{isToolbarButtonVisible('spectral-brush') && <span
						data-action-id="spectral-brush"
						data-disabled-reason={spectralBrushReason}
						aria-disabled="true"
						title={spectralBrushReason}
					>
						<ToolButton
							icon="brush"
							ariaLabel={`${copy.spectralBrush}: ${spectralBrushReason}`}
							disabled
						/>
					</span>
					}
				</ToolbarButtonGroup>
				}

				{zoomButtonsVisible && <ToolbarButtonGroup className="kw-audio-editor__zoom-actions" gap={2}>
					{isToolbarButtonVisible('zoom-in') && <ToolButton icon="zoom-in" ariaLabel={copy.zoomIn} onClick={() => run(() => controller.actions.timeline.zoomIn())} />}
					{isToolbarButtonVisible('zoom-out') && <ToolButton icon="zoom-out" ariaLabel={copy.zoomOut} onClick={() => run(() => controller.actions.timeline.zoomOut())} />}
					{isToolbarButtonVisible('zoom-fit') && <ToolButton icon="zoom-to-fit" ariaLabel={copy.zoomFit} onClick={() => run(() => controller.actions.timeline.zoomFit())} />}
				</ToolbarButtonGroup>
				}
				</>}

				{toolbars.edit?.visible !== false && visibleEditItems.length > 0 && <ToolbarButtonGroup className="kw-audio-editor__edit-actions" gap={2}>
					{visibleEditItems.map((item) => (
						<span key={item.action} data-edit={item.action === 'rippleDelete' ? 'ripple-delete' : item.action}>
							<ToolButton icon={item.icon} ariaLabel={item.label} disabled={item.disabled} onClick={() => executeEdit(item.action)} />
						</span>
					))}
				</ToolbarButtonGroup>}

				{toolbars.meter?.visible !== false && <>
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
				<label className="kw-audio-editor__tempo-control" data-action-id="playback-bpm">
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
				</label>
				<label className="kw-audio-editor__signature-control" data-action-id="playback-time-signature">
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
				</label>

				{uiFlags.microphoneMetering && isToolbarButtonVisible('monitor') && <ToolbarButtonGroup className="kw-audio-editor__recording-meter" gap={4}>
					<span data-monitor-input>
						<ToggleToolButton
							icon="microphone"
							isActive={Boolean(snapshot.monitor?.enabled)}
							ariaLabel={copy.monitor}
							disabled={snapshot.recordingStarting}
							onClick={() => run(() => controller.actions.recording.setMonitoring(!snapshot.monitor?.enabled))}
						/>
					</span>
					<div
						className="kw-audio-editor__input-meter"
						data-input-meter
						role="meter"
						aria-label={copy.inputLevel}
						aria-valuemin={-60}
						aria-valuemax={0}
						aria-valuenow={inputMeterDb}
					>
						<TrackMeter volume={meterPercent(inputMeterDb)} clipped={uiFlags.clipping && inputMeterDb >= 0} variant="stereo" />
					</div>
					<label className="kw-audio-editor__recording-level" data-recording-level>
						<span className="kw-audio-editor-sr-only">{copy.recordLevel}</span>
						<input
							type="range"
							min="0"
							max="2"
							step="0.01"
							value={snapshot.recordingOptions?.inputGain ?? 1}
							aria-label={copy.recordLevel}
							onChange={(event) => run(() => controller.actions.recording.setLevel(Number(event.currentTarget.value)))}
						/>
					</label>
				</ToolbarButtonGroup>}

				{uiFlags.masterTrack && isToolbarButtonVisible('playback-volume') && <ToolbarButtonGroup className="kw-audio-editor__playback-meter" gap={6}>
					<ToolButton
						icon="volume"
						ariaLabel={copy.playbackVolume}
						onClick={(event) => {
							const group = event.currentTarget.closest('.kw-audio-editor__playback-meter');
							group?.querySelector('[role="slider"], input')?.focus?.();
						}}
					/>
					<div className="kw-audio-editor__master-meter" aria-label={copy.metering}>
						<MasterMeter
							levelLeft={masterMeter?.dbfs ?? -60}
							levelRight={masterMeter?.dbfs ?? -60}
							clippedLeft={uiFlags.clipping && (masterMeter?.peak || 0) >= 1}
							clippedRight={uiFlags.clipping && (masterMeter?.peak || 0) >= 1}
							volume={Math.min(1, project?.master?.gain ?? 1)}
							onVolumeChange={(gain) => run(() => controller.actions.effects.setMasterGain(gain))}
							defaultWidth={isCompact ? 165 : 280}
							minWidth={120}
							resizable={!isCompact}
					/>
					</div>
				</ToolbarButtonGroup>}
				</>}
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
							<span aria-hidden="true"><Icon name={button.icon} size={16} /></span>
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

function EditorActionBar({
	copy,
	snapshot,
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
					{copy.saveAup4}
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
						className="kw-audio-editor__action-bar-button"
						icon={iconNameToChar('MIXER')}
						aria-pressed={mixerVisible}
						onClick={onToggleMixer}
					>
						{copy.panelMixer}
					</Button>
				</span>
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

const WORKSPACE_PANEL_IDS = Object.freeze(['history', 'labels', 'metadata', 'effects', 'mixer', 'spectrogram']);
const WORKSPACE_TOOLBAR_IDS = Object.freeze(['transport', 'tools', 'edit', 'meter']);
const WORKSPACE_DOCK_IDS = Object.freeze(['left', 'right', 'bottom', 'floating']);

function WorkspacePanelDock({ dock, controller, snapshot, copy, run, showArmControls, onOpenEffects }) {
	const panels = WORKSPACE_PANEL_IDS
		.map((id) => [id, snapshot.preferences?.workspace?.panels?.[id]])
		.filter(([, panel]) => panel?.visible && panel.dock === dock)
		.sort((left, right) => left[1].order - right[1].order);
	if (!panels.length) return null;
	return (
		<aside className={`kw-audio-editor__panel-dock kw-audio-editor__panel-dock--${dock}`} data-panel-dock={dock} aria-label={copy.panels}>
			{panels.map(([panelId, panel]) => (
				<section
					key={panelId}
					className="kw-audio-editor__workspace-panel"
					data-workspace-panel={panelId}
					style={{ '--workspace-panel-size': `${panel.size}px` }}
				>
					<header className="kw-audio-editor__workspace-panel-header">
						<h2>{workspacePanelLabel(copy, panelId)}</h2>
						<label className="kw-audio-editor__panel-dock-picker">
							<span className="kw-audio-editor-sr-only">{copy.panelDock}</span>
							<select
								aria-label={`${workspacePanelLabel(copy, panelId)}: ${copy.panelDock}`}
								value={panel.dock}
								onChange={(event) => run(() => controller.actions.preferences.setPanel(panelId, { dock: event.currentTarget.value }))}
							>
								{WORKSPACE_DOCK_IDS.map((dockId) => <option key={dockId} value={dockId}>{workspaceDockLabel(copy, dockId)}</option>)}
							</select>
						</label>
						<button
							type="button"
							className="kw-audio-editor__workspace-panel-close"
							aria-label={`${copy.close}: ${workspacePanelLabel(copy, panelId)}`}
							onClick={() => run(() => controller.actions.preferences.togglePanel(panelId))}
						>×</button>
					</header>
					<div className="kw-audio-editor__workspace-panel-content">
						<WorkspacePanelContent
							panelId={panelId}
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							run={run}
							showArmControls={showArmControls}
							onOpenEffects={onOpenEffects}
						/>
					</div>
				</section>
			))}
		</aside>
	);
}

function WorkspacePanelContent({ panelId, controller, snapshot, copy, run, showArmControls, onOpenEffects }) {
	const project = snapshot.project;
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
		const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId && track.type !== 'label');
		return (
			<>
				<p>{selectedTrack ? selectedTrack.name : copy.noAudioTrackSelected}</p>
				<Button disabled={!selectedTrack} onClick={() => selectedTrack && onOpenEffects(selectedTrack.id)}>{copy.trackMasterEffects}</Button>
				<Button variant="secondary" disabled={!selectedTrack} onClick={() => run(() => controller.actions.effects.applySelection())}>{copy.applyAudacityEffect}</Button>
			</>
		);
	}
	if (panelId === 'mixer') {
		return <AudioEditorMixerPanel controller={controller} snapshot={snapshot} copy={copy} run={run} showArmControls={showArmControls} onOpenEffects={onOpenEffects} />;
	}
	const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId && track.type !== 'label') || null;
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

function AudioEditorMixerPanel({ controller, snapshot, copy, run, showArmControls, onOpenEffects }) {
	const telemetry = useAudioEditorTelemetry(controller);
	const project = snapshot.project;
	const tracks = (project?.tracks || []).filter((track) => track.type !== 'label');
	const groups = project?.mixer?.groups || [];
	const sends = project?.mixer?.sends || [];
	const routes = project?.mixer?.routes || {};
	const mixerBuses = [
		...groups.map((bus) => ({ type: 'group', bus })),
		...sends.map((bus) => ({ type: 'send', bus })),
	];
	const effectLabels = new Map((snapshot.effects?.rackTypes || []).map(({ type, label }) => [type, label]));
	const effectProps = (effects, scope, targetId) => (effects || []).map((effect) => ({
		name: effectLabels.get(effect.type) || effect.type,
		enabled: effect.enabled !== false && effect.bypassed !== true,
		onToggle: () => run(() => controller.actions.effects.update(scope, targetId, effect.id, { enabled: effect.enabled === false })),
		onRemoveEffect: () => run(() => controller.actions.effects.remove(scope, targetId, effect.id)),
		...(scope !== 'master' ? { onClick: () => onOpenEffects(targetId, null, scope) } : {}),
	}));
	const channelProps = (channel, type) => {
		const isTrack = type === 'track';
		const isMaster = type === 'master';
		const targetId = channel.id || 'master';
		const scope = isTrack ? 'track' : type;
		const meter = isMaster ? telemetry.meters?.master : telemetry.meters?.[`${type}s`]?.[targetId];
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
							disabled={snapshot.readOnly || snapshot.recording || snapshot.recordingStarting}
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
					disabled={snapshot.recording || snapshot.recordingStarting || typeof controller.actions.recording.requestInputAccess !== 'function'}
					onClick={() => run(() => snapshot.recordingInputs?.hasOpenInputs
						? controller.actions.recording.refreshInputs()
						: controller.actions.recording.requestInputAccess())}
				>{snapshot.recordingInputs?.hasOpenInputs ? copy.recordingRefreshInputs : copy.recordingAllowInputs}</Button>}
				{snapshot.recordingInputs?.hasOpenInputs && <Button
					variant="secondary"
					disabled={snapshot.recording || snapshot.recordingStarting}
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

function WorkspacePreferencesDialog({ controller, snapshot, copy, locale, menus, run, initialPage = 'shortcuts', onClose }) {
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
		{ id: 'toolbars', label: copy.toolbarsMenu, icon: iconNameToChar('TOOLBAR_GRIP') },
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

						{selectedPage === 'toolbars' && (
							<PreferencePanel title={copy.toolbarsMenu}>
								<div className="kw-audio-editor-preferences__checks">
									{WORKSPACE_TOOLBAR_IDS.map((toolbarId) => (
										<PreferenceCheckbox
											key={toolbarId}
											label={workspaceToolbarLabel(copy, toolbarId)}
											checked={preferences.workspace.toolbars[toolbarId]?.visible !== false}
											onChange={() => run(() => controller.actions.preferences.toggleToolbar(toolbarId))}
										/>
									))}
								</div>
							</PreferencePanel>
						)}

						{selectedPage === 'panels' && (
							<PreferencePanel title={copy.panels}>
								<div className="kw-audio-editor-preferences__panel-list">
									{WORKSPACE_PANEL_IDS.map((panelId) => {
										const panel = preferences.workspace.panels[panelId];
										const label = workspacePanelLabel(copy, panelId);
										return (
											<div key={panelId}>
												<PreferenceCheckbox label={label} checked={panel.visible} onChange={() => run(() => controller.actions.preferences.togglePanel(panelId))} />
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

function EditorDialog({ type, value, onValueChange, sourceKey = 'global', onSourceKeyChange, controller, snapshot, copy, locale, run, onClose }) {
	const panelRef = useRef(null);
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
				onClose();
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

	const title = type === 'projects'
		? copy.projectsTitle
		: type === 'rename'
			? copy.renameProject
			: type === 'track-rename'
				? copy.trackName
			: type === 'recording-offset'
				? copy.recordingOffset
			: type === 'track-rate'
				? copy.sampleRate
			: type === 'resample'
				? copy.resample
			: type === 'about'
				? copy.aboutEditor
			: type === 'clear'
				? copy.clearData
				: copy.deleteTitle;
	const offsetSources = recordingOffsetSources(snapshot, copy);
	return (
		<div className="kw-audio-editor-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<AudioEditorResizableSurface ref={panelRef} tabIndex={-1} className="kw-audio-editor-dialog" role="dialog" aria-modal="true" aria-label={title} resizeLabel={`Resize: ${title}`}>
				<DialogHeader title={title} os="windows" onClose={onClose} />
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
							<p>{copy.intro}</p>
							<p>{copy.privacy}</p>
							<p><code>{copy.audacityParityRevision.replace('{revision}', AUDACITY_ACTION_SOURCE.commit)}</code></p>
							<div className="kw-audio-editor-dialog__actions"><Button onClick={onClose}>{copy.close}</Button></div>
						</>
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
	const track = project?.tracks.find((candidate) => candidate.id === snapshot.selectedTrackId && candidate.type !== 'label') || null;
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
	['volumeCompression', ['audacity-amplify', 'audacity-auto-duck', 'audacity-compressor', 'audacity-legacy-compressor', 'audacity-limiter', 'audacity-loudness-normalization', 'audacity-normalize', 'audacity-remove-dc-offset']],
	['fading', ['audacity-fade-in', 'audacity-fade-out']],
	['eqFilters', ['audacity-bass-treble', 'audacity-filter-curve-eq', 'audacity-graphic-eq', 'audacity-classic-filters']],
	['noiseRepair', ['audacity-click-removal', 'audacity-noise-reduction', 'audacity-repair']],
	['delayReverb', ['audacity-echo', 'audacity-reverb']],
	['distortionModulation', ['audacity-distortion', 'audacity-phaser', 'audacity-wahwah']],
	['specialEffects', ['audacity-invert', 'audacity-paulstretch', 'audacity-repeat', 'audacity-reverse', 'audacity-truncate-silence']],
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
	if (!project || !track || track.type === 'label') return [];
	const clipById = new Map((project.clips || []).map((clip) => [clip.id, clip]));
	const sourceById = new Map((project.sources || []).map((source) => [source.id, source]));
	return [...new Map((track.clipIds || []).map((clipId) => {
		const source = sourceById.get(clipById.get(clipId)?.sourceId) || null;
		return [source?.id, source];
	}).filter(([, source]) => source)).values()];
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
	effectsOverlay,
	uiFlags,
	actionRuntime,
	actions,
}) {
	const divider = () => ({ divider: true });
	const unavailable = (id, label) => ({ id, label, disabled: true });
	const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId) || null;
	const selectedAudioTrack = selectedTrack?.type === 'label' ? null : selectedTrack;
	const selectedTrackIndex = selectedTrack ? project.tracks.findIndex((track) => track.id === selectedTrack.id) : -1;
	const selectedAudioChannelCount = trackSourceChannelCount(project, selectedAudioTrack);
	const selectedAudioSources = trackSources(project, selectedAudioTrack);
	const selectedAudioSampleRates = new Set(selectedAudioSources.map((source) => source.sampleRate));
	const selectedAudioSampleFormats = new Set(selectedAudioSources.map((source) => source.sampleFormat));
	const compatibleMonoTracks = Boolean(selectedAudioChannelCount === 1 && project?.tracks.some((track) => (
		track.id !== selectedAudioTrack.id && track.type !== 'label' && trackSourceChannelCount(project, track) === 1
	)));
	const selectedClipIds = project?.selection?.clipIds?.length
		? project.selection.clipIds
		: selectedClip ? [selectedClip.id] : [];
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

	return applyAudacityParityToMenus([
		{
			id: 'file',
			label: copy.fileMenu,
			items: [
				{ id: 'new-project', label: copy.newProject, shortcut: 'Ctrl+N', disabled: blocked, onClick: actions.newProject },
				{ id: 'open-project', label: copy.openProject, shortcut: 'Ctrl+O', disabled: blocked, onClick: actions.openProjects },
				{ id: 'open-aup4', label: copy.openAup4, disabled: blocked, onClick: actions.openAup4 },
				{ id: 'open-legacy-aup', label: copy.openLegacyAup, disabled: blocked, onClick: actions.openLegacyAup },
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
				{ id: 'save-project-as', label: copy.saveAup4, shortcut: 'Ctrl+Shift+S', disabled: blocked, onClick: actions.saveAup4 },
				unavailable('backup-project', copy.backupProject),
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
				unavailable('export-multiple', copy.exportMultiple),
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
				{ id: 'cut', label: copy.cut, shortcut: 'Ctrl+X', disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('cut') },
				{ id: 'delete', label: copy.liftDelete, shortcut: 'Delete', disabled: editBlocked || (!selectionActive && !selectedClip), onClick: () => actions.executeEdit('delete') },
				{ id: 'copy', label: copy.copy, shortcut: 'Ctrl+C', disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('copy') },
				{ id: 'paste', label: copy.paste, shortcut: 'Ctrl+V', disabled: editBlocked || !snapshot.history?.hasClipboard, onClick: () => actions.executeEdit('paste') },
				{ id: 'duplicate-audio', label: copy.duplicateAudio, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('duplicate') },
				{
					id: 'paste-special',
					label: copy.pasteSpecial,
					items: [
						{ id: 'action://trackedit/paste-overlap', label: copy.pasteOverlap, disabled: editBlocked || !snapshot.history?.hasClipboard, onClick: () => actions.executeEdit('pasteOverlap') },
						{ id: 'action://trackedit/paste-insert', label: copy.pasteInsert, disabled: editBlocked || !snapshot.history?.hasClipboard, onClick: () => actions.executeEdit('pasteInsert') },
						{ id: 'action://trackedit/paste-insert-all-tracks-ripple', label: copy.pasteSync, disabled: editBlocked || !snapshot.history?.hasClipboard, onClick: () => actions.executeEdit('pasteAllTracksRipple') },
					],
				},
				{
					id: 'remove-special',
					label: copy.removeSpecial,
					items: [
						{ id: 'cut-leave-gap', label: copy.cutLeaveGap, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('cutLeaveGap') },
						{ id: 'cut-per-clip-ripple', label: copy.cutPerClipRipple, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('cutPerClipRipple') },
						{ id: 'cut-per-track-ripple', label: copy.cutPerTrackRipple, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('cutPerTrackRipple') },
						{ id: 'cut-all-tracks-ripple', label: copy.cutAllTracksRipple, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('cutAllTracksRipple') },
						{ id: 'delete-leave-gap', label: copy.deleteLeaveGap, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('deleteLeaveGap') },
						{ id: 'delete-per-clip-ripple', label: copy.deletePerClipRipple, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('deletePerClipRipple') },
						{ id: 'delete-per-track-ripple', label: copy.deletePerTrackRipple, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('deletePerTrackRipple') },
						{ id: 'delete-all-tracks-ripple', label: copy.deleteAllTracksRipple, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('deleteAllTracksRipple') },
						{ id: 'trim-audio-outside-selection', label: copy.trimOutsideSelection, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('trimOutsideSelection') },
						{ id: 'silence-audio', label: copy.silenceAudio, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('silenceSelection') },
					],
				},
				{
					id: 'clip-boundaries',
					label: copy.clipBoundaries,
					items: [
						{ id: 'split', label: copy.split, shortcut: 'S', disabled: editBlocked || !selectedClip, onClick: () => actions.executeEdit('split') },
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
				{ id: 'select-none', label: copy.selectNone, shortcut: 'Ctrl+Shift+A', disabled: !selectionActive, onClick: actions.selectNone },
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
				unavailable('store-selection', copy.storeSelection),
				unavailable('retrieve-selection', copy.retrieveSelection),
				{ id: 'zero-crossings', label: copy.zeroCrossings, shortcut: 'Z', disabled: editBlocked || !selectionActive, onClick: actions.zeroCross },
			],
		},
		{
			id: 'view',
			label: copy.viewMenu,
			items: [
				{
					id: 'toolbars',
					label: copy.toolbarsMenu,
					items: [
						{ id: 'transport-toolbar', label: copy.toolbarTransport, checked: preferences.workspace.toolbars.transport.visible, onClick: () => actions.toggleToolbar('transport') },
						{ id: 'tools-toolbar', label: copy.toolbarTools, checked: preferences.workspace.toolbars.tools.visible, onClick: () => actions.toggleToolbar('tools') },
						{ id: 'edit-toolbar', label: copy.toolbarEdit, checked: preferences.workspace.toolbars.edit.visible, onClick: () => actions.toggleToolbar('edit') },
						{ id: 'meter-toolbar', label: copy.toolbarMeter, checked: preferences.workspace.toolbars.meter.visible, onClick: () => actions.toggleToolbar('meter') },
						{ id: 'selection-toolbar', label: copy.selectionToolbar, checked: uiFlags.selectionToolbar },
						{ id: 'action://record/toggle-mic-metering', label: copy.microphoneMetering, checked: uiFlags.microphoneMetering },
					],
				},
				{
					id: 'panels',
					label: copy.panels,
					items: [
						{ id: 'toggle-tracks', label: copy.tracksPanel, checked: uiFlags.tracksPanel },
						...WORKSPACE_PANEL_IDS.map((panelId) => ({
							id: `panel-${panelId}`,
							label: workspacePanelLabel(copy, panelId),
							checked: preferences.workspace.panels[panelId].visible,
							onClick: () => actions.togglePanel(panelId),
						})),
					],
				},
				{
					id: 'workspace-preset',
					label: copy.workspace,
					items: [
						{ id: 'workspace-modern', label: copy.workspaceModern, checked: preferences.workspace.activeId === 'modern', onClick: () => actions.setWorkspace('modern') },
						{ id: 'workspace-music', label: copy.workspaceMusic, checked: preferences.workspace.activeId === 'music', onClick: () => actions.setWorkspace('music') },
						{ id: 'workspace-classic', label: copy.workspaceClassic, checked: preferences.workspace.activeId === 'classic', onClick: () => actions.setWorkspace('classic') },
						...preferences.workspace.custom.map((workspace) => ({ id: `workspace-${workspace.id}`, label: workspace.name, checked: preferences.workspace.activeId === workspace.id, onClick: () => actions.setWorkspace(workspace.id) })),
					],
				},
				{ id: 'show-effects', label: copy.showEffects, checked: Boolean(effectsOverlay), disabled: !selectedAudioTrack, onClick: actions.openEffects },
				{ id: 'show-arm-controls', label: copy.showArmControls, checked: showArmControls, onClick: actions.toggleArmControls },
				{ id: 'show-rms', label: copy.showRms, checked: Boolean(snapshot.timeline?.showRms), onClick: actions.toggleRms },
				{ id: 'show-rulers', label: copy.showVerticalRulers, checked: snapshot.timeline?.showVerticalRulers !== false, onClick: actions.toggleVerticalRulers },
				{ id: 'toggle-clipping-in-waveform', label: copy.showClipping, checked: uiFlags.clipping },
				{ id: 'show-master-track', label: copy.masterTrack, checked: uiFlags.masterTrack },
				{ id: 'toggle-statusbar', label: copy.statusBar, checked: uiFlags.statusbar },
				divider(),
				{ id: 'waveform-view', label: copy.waveformView, checked: snapshot.timeline?.view === 'waveform', onClick: () => actions.setTimelineView('waveform') },
				{ id: 'action://trackedit/global-view-spectrogram', label: copy.spectrogramView, checked: snapshot.timeline?.view === 'spectrogram', onClick: () => actions.setTimelineView(snapshot.timeline?.view === 'spectrogram' ? 'waveform' : 'spectrogram') },
				{ id: 'toggle-update-display-while-playing', label: copy.updateDisplayWhilePlaying, checked: snapshot.timeline?.updateDisplayWhilePlaying !== false, onClick: actions.toggleUpdateWhilePlaying },
				{ id: 'toggle-pinned-play-head', label: copy.pinnedPlayhead, checked: Boolean(snapshot.timeline?.pinnedPlayhead), onClick: actions.togglePinnedPlayhead },
				{ id: 'toggle-playback-on-ruler-click-enabled', label: copy.playbackOnRulerClick, checked: snapshot.timeline?.playbackOnRulerClick !== false, onClick: actions.toggleRulerPlayback },
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
				{ id: 'skip-to', label: copy.skipTo, items: [
					unavailable('skip-to-selection-start', copy.selectionStart),
					unavailable('skip-to-selection-end', copy.selectionEnd),
				] },
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
			id: 'record',
			label: copy.recordMenu,
			preserveLabel: true,
			items: [
				{ id: 'record', label: snapshot.recording ? copy.stopRecording : recordLabel, preserveLabel: Boolean(snapshot.recording), shortcut: 'R', disabled: snapshot.readOnly || snapshot.importing || snapshot.exporting || snapshot.transportState === 'playing', disabledReason: snapshot.readOnly ? copy.projectReadOnly : undefined, onClick: actions.record },
				{ id: 'record-new-track', label: copy.recordNewTrack, shortcut: 'Shift+R', disabled: snapshot.readOnly || snapshot.recording || snapshot.recordingStarting, onClick: actions.recordNewTrack },
				{ id: 'stop', label: copy.stop, onClick: actions.stop },
				{ id: 'pause-recording', label: snapshot.recordingOptions?.paused ? (copy.resumeRecording || copy.record) : copy.pauseRecording, preserveLabel: true, disabled: !snapshot.recording, checked: Boolean(snapshot.recordingOptions?.paused), onClick: actions.pauseRecording },
				divider(),
				{
					id: 'recording-input-access',
					label: snapshot.recordingInputs?.hasOpenInputs ? copy.recordingRefreshInputs : copy.recordingAllowInputs,
					disabled: snapshot.recording || snapshot.recordingStarting,
					onClick: snapshot.recordingInputs?.hasOpenInputs ? actions.refreshInputs : actions.requestInputAccess,
				},
				...(snapshot.recordingInputs?.hasOpenInputs ? [{
					id: 'recording-release-inputs',
					label: copy.recordingReleaseInputs,
					disabled: snapshot.recording || snapshot.recordingStarting,
					onClick: actions.releaseInputs,
				}] : []),
				divider(),
				{ id: 'monitor-input', label: copy.monitor, checked: Boolean(snapshot.monitor?.enabled), disabled: snapshot.recordingStarting, onClick: actions.toggleMonitoring },
				{ id: 'recording-offset', label: copy.recordingOffset, onClick: actions.openRecordingOffset },
				{ id: 'lead-in-time', label: copy.leadInTime, checked: Boolean(snapshot.recordingOptions?.leadIn), disabled: snapshot.recording || snapshot.recordingStarting, onClick: actions.toggleLeadIn },
				unavailable('set-up-timed-recording', copy.timedRecording),
				unavailable('toggle-sound-activated-recording', copy.soundActivatedRecording),
				unavailable('set-sound-activation-level', copy.soundActivationLevel),
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
						{ id: 'track-move-top', label: copy.moveTrackTop, disabled: selectedTrackIndex <= 0, onClick: actions.moveTrackTop },
						{ id: 'track-move-up', label: copy.moveTrackUp, disabled: selectedTrackIndex <= 0, onClick: actions.moveTrackUp },
						{ id: 'track-move-down', label: copy.moveTrackDown, disabled: selectedTrackIndex < 0 || selectedTrackIndex >= project.tracks.length - 1, onClick: actions.moveTrackDown },
						{ id: 'track-move-bottom', label: copy.moveTrackBottom, disabled: selectedTrackIndex < 0 || selectedTrackIndex >= project.tracks.length - 1, onClick: actions.moveTrackBottom },
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
				{ id: 'mix', label: copy.mixMenu, items: [unavailable('mixdown-to', copy.mixdownTo)] },
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
				] },
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
			],
		},
		{
			id: 'tools',
			label: copy.toolsMenu,
			items: [
				{ id: 'manage-macros', label: copy.macroManager, disabled: !project, onClick: actions.openMacroManager },
				unavailable('raw-data-import', copy.rawDataImport),
				unavailable('reset-configuration', copy.resetConfiguration),
			],
		},
		{
			id: 'help',
			label: copy.helpMenu,
			items: [
				{ id: 'quick-help', label: copy.quickHelp, shortcut: 'F1', onClick: actions.quickHelp },
				{ id: 'tutorials', label: copy.tutorials || copy.quickHelp, onClick: actions.tutorials },
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

function resolveEffectsOverlayPosition(workspace, anchorRect, compact) {
	const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
	const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
	const bounds = workspace?.getBoundingClientRect() || {
		left: 0,
		top: 0,
		width: viewportWidth,
		height: viewportHeight,
	};
	const inset = 8;
	const adapterHeight = 78;
	const width = Math.max(240, Math.min(compact ? 372 : 340, bounds.width - inset * 2));
	const availableHeight = Math.max(320, bounds.height - inset * 2);
	const totalHeight = Math.min(compact ? 520 : 570, availableHeight);
	const panelHeight = Math.max(250, totalHeight - adapterHeight);
	let left = anchorRect
		? anchorRect.right - bounds.left + 6
		: inset;
	if (left + width + inset > bounds.width) {
		left = anchorRect
			? anchorRect.left - bounds.left - width - 6
			: bounds.width - width - inset;
	}
	left = Math.max(inset, Math.min(left, Math.max(inset, bounds.width - width - inset)));
	let top = anchorRect ? anchorRect.top - bounds.top : inset;
	top = Math.max(inset, Math.min(top, Math.max(inset, bounds.height - totalHeight - inset)));
	return { left, top, width, panelHeight, totalHeight };
}

function meterPercent(dbfs) {
	const value = Number.isFinite(dbfs) ? dbfs : -60;
	return (Math.max(-60, Math.min(0, value)) + 60) / 60 * 100;
}

function formatDate(value, locale) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(normalizeBcp47Locale(locale));
}
