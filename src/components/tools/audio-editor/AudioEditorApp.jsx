import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Button,
	DialogHeader,
	MasterMeter,
	NumberStepper,
	SelectionToolbar,
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

import { createAudioEditorController } from '../../../lib/tools/audio-editor/app.js';
import {
	applyAudacityParityToMenus,
	audacityActionReason,
	collectAudacityShortcutCommands,
	resolveAudacityActionHandler,
	resolveAudacityActionId,
} from '../../../lib/tools/audio-editor/audacity-action-parity.js';
import { createAudacityActionRuntime } from '../../../lib/tools/audio-editor/audacity-action-runtime.js';
import { framesToSeconds, secondsToFrames } from '../../../lib/tools/audio-editor/design-system-adapters.js';
import {
	findAudioEditorShortcutConflicts,
	normalizeAudioEditorShortcut,
} from '../../../lib/tools/audio-editor/preferences.js';
import { projectDurationFrames } from '../../../lib/tools/audio-editor/project.js';
import {
	AnalysisDialog,
	AudioEditorEffectsOverlay,
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
} from './DesignSystemRuntime.jsx';
import './audio-editor-design-system.css';

export default function AudioEditorApp(props) {
	return (
		<AudioEditorErrorBoundary copy={props.copy}>
			<DesignSystemProviders>
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
	const [dialog, setDialog] = useState(null);
	const [dialogValue, setDialogValue] = useState('');
	const [localError, setLocalError] = useState('');
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [showArmControls, setShowArmControls] = useState(false);
	const [generatorType, setGeneratorType] = useState('tone');
	const [analysisMode, setAnalysisMode] = useState('levels');
	const importInputRef = useRef(null);
	const labelInputRef = useRef(null);
	const aup4InputRef = useRef(null);
	const legacyAupInputRef = useRef(null);
	const legacyDataInputRef = useRef(null);
	const pendingLegacyProjectRef = useRef(null);
	const workspaceRef = useRef(null);
	const isCompact = useMediaQuery('(max-width: 900px)');
	const project = snapshot.project;
	const preferences = snapshot.preferences;
	const toolbarPreferences = preferences?.workspace?.toolbars || {};
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
		const message = error instanceof Error ? error.message : String(error || 'Unknown error');
		setLocalError(copy.genericError.replace('{message}', message));
	}, [copy.genericError]);

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

	const toggleFullscreen = useCallback(() => {
		setIsFullscreen((current) => !current);
	}, []);
	const toggleSplitTool = useCallback(() => {
		return parityRuntime.actions.tools.toggleSplitTool();
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

	const openSurface = useCallback((surface) => {
		setEffectsOverlay(null);
		setActiveSurface(surface);
	}, []);

	const openEffects = useCallback((trackId, anchorRect = null) => {
		if (!trackId) return;
		setActiveSurface(null);
		setEffectsOverlay((current) => {
			if (current?.trackId === trackId) {
				requestAnimationFrame(() => current.returnFocus?.focus?.({ preventScroll: true }));
				return null;
			}
			return {
				trackId,
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
		{ action: 'undo', label: copy.undo, icon: 'undo', disabled: editBlocked || !snapshot.history?.canUndo },
		{ action: 'redo', label: copy.redo, icon: 'redo', disabled: editBlocked || !snapshot.history?.canRedo },
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
			openSurface(payload.surface || null);
		} else if (request.type === 'open-external') openExternal(payload.url);
		else if (request.type === 'toggle-fullscreen') toggleFullscreen();
		else if (request.type === 'choose-audio-files') importInputRef.current?.click();
		else if (request.type === 'open-about') setDialog('about');
		else if (request.type === 'close-project') run(() => controller.actions.project.close(payload.projectId, payload));
		else if (request.type === 'set-custom-track-rate') {
			setDialogValue(String(selectedAudioTrack?.sampleRate || project?.sampleRate || 48_000));
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
		selectedAudioTrack?.sampleRate,
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
			openRecordingOffset: () => {
				setDialogValue(String(snapshot.monitor?.latencyOffsetMs ?? 0));
				setDialog('recording-offset');
			},
			addTrack: () => run(() => controller.actions.track.add()),
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
				setDialogValue(String(selectedAudioTrack?.sampleRate || project?.sampleRate || 48_000));
				setDialog('track-rate');
			},
			openResample: () => {
				setDialogValue(String(selectedAudioTrack?.sampleRate || project?.sampleRate || 48_000));
				setDialog('resample');
			},
			zeroCross: () => run(() => controller.actions.timeline.zeroCross()),
			toggleTrackMute: () => {
				const track = project?.tracks.find((candidate) => candidate.id === snapshot.selectedTrackId);
				if (track) run(() => controller.actions.track.update(track.id, { mute: !track.mute }));
			},
			openEffects: () => openEffects(snapshot.selectedTrackId),
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
			id="kw-audio-editor-design-system"
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
		>
			<AudioEditorMenuBar
				appName={copy.title}
				copy={copy}
				menus={applicationMenus}
				projectName={project?.title || copy.untitledProject}
				saveState={snapshot.save?.state || 'saved'}
				saveText={saveText}
				onFullscreen={() => run(toggleFullscreen)}
			/>
			<ProjectTabs
				projects={snapshot.projectTabs || snapshot.projects || []}
				activeProjectId={project?.id}
				copy={copy}
				disabled={blocked}
				onSelect={(projectId) => run(() => controller.actions.project.openById(projectId))}
				onNew={() => run(() => controller.actions.project.create())}
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
					uiFlags={uiFlags}
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
					onOpenEffects={() => openEffects(snapshot.selectedTrackId)}
				/>
				{uiFlags.tracksPanel && <div className="kw-audio-editor__workspace-main">
				<main className="kw-audio-editor__canvas">
					<AudioEditorTimeline
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						mobile={isCompact}
						showArmControls={showArmControls}
						splitToolEnabled={uiFlags.splitTool}
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
					onOpenEffects={() => openEffects(snapshot.selectedTrackId)}
				/>
				</div>}
				<WorkspacePanelDock
					dock="right"
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					run={run}
					onOpenEffects={() => openEffects(snapshot.selectedTrackId)}
				/>
				<WorkspacePanelDock
					dock="floating"
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					run={run}
					onOpenEffects={() => openEffects(snapshot.selectedTrackId)}
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
						onClose={() => setActiveSurface(null)}
					/>
				</div>
			)}

			{dialog && (
				<EditorDialog
					type={dialog}
					value={dialogValue}
					onValueChange={setDialogValue}
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					locale={locale}
					run={run}
					onClose={() => setDialog(null)}
				/>
			)}
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
	uiFlags,
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
	const spectralBrushReason = audacityActionReason('spectral-brush', locale);
	const masterMeter = telemetry.meters?.master;
	const inputMeterDb = telemetry.inputMeterDb ?? -60;
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
			>
				{toolbars.transport?.visible !== false && <ToolbarButtonGroup className="kw-audio-editor__transport" gap={2}>
					<TransportButton
						icon={telemetry.transportState === 'playing' ? 'pause' : 'play'}
						ariaLabel={telemetry.transportState === 'playing' ? copy.pause : copy.play}
						disabled={blocked && !snapshot.recording}
						active={telemetry.transportState === 'playing'}
						onClick={() => run(() => controller.actions.transport.playPause())}
					/>
					<TransportButton icon="stop" ariaLabel={copy.stop} onClick={() => run(() => controller.actions.transport.stop())} />
					<span data-transport="record">
						<AccessibleTransportButton
							icon="record"
							ariaLabel={recordLabel}
							recording={snapshot.recording}
							pressed={Boolean(snapshot.recording)}
							disabled={snapshot.readOnly || snapshot.importing || snapshot.exporting}
							onClick={toggleRecording}
						/>
					</span>
					<TransportButton icon="skip-back" ariaLabel={copy.jumpStart} disabled={blocked} onClick={() => run(() => controller.actions.transport.jumpStart())} />
					<TransportButton icon="skip-forward" ariaLabel={copy.jumpEnd} disabled={blocked} onClick={() => run(() => controller.actions.transport.jumpEnd())} />
					<AccessibleTransportButton
						icon="loop"
						ariaLabel={copy.loop}
						active={Boolean(project?.loop?.enabled)}
						pressed={Boolean(project?.loop?.enabled)}
						disabled={!selectionActive}
						onClick={() => run(() => controller.actions.transport.toggleLoop())}
					/>
				</ToolbarButtonGroup>}

				{toolbars.tools?.visible !== false && <>
				<ToolbarDivider />
				<ToolbarButtonGroup className="kw-audio-editor__view-actions" gap={2}>
					<span data-action-id="split-tool">
						<ToggleToolButton
							icon="split"
							isActive={uiFlags.splitTool}
							ariaLabel={copy.splitTool}
							onClick={() => actionRuntime.tools.toggleSplitTool()}
						/>
					</span>
					<ToggleToolButton icon="waveform" isActive={snapshot.timeline?.view === 'waveform'} ariaLabel={copy.waveformView} onClick={() => run(() => controller.actions.timeline.setView('waveform'))} />
					<ToggleToolButton icon="spectrogram" isActive={snapshot.timeline?.view === 'spectrogram'} ariaLabel={copy.spectrogramView} onClick={() => run(() => controller.actions.timeline.setView('spectrogram'))} />
					<span data-action-id="spectral-box-select">
						<ToolButton
							icon="spectrogram"
							ariaLabel={copy.spectralBoxSelect}
							disabled={!spectralTrackSelected}
							onClick={onOpenSpectralSelection}
						/>
					</span>
					<span
						data-action-id="spectral-brush"
						data-disabled-reason={spectralBrushReason}
						aria-disabled="true"
						title={spectralBrushReason}
					>
						<ToolButton
							icon="spectrogram"
							ariaLabel={`${copy.spectralBrush}: ${spectralBrushReason}`}
							disabled
						/>
					</span>
				</ToolbarButtonGroup>

				<ToolbarButtonGroup className="kw-audio-editor__zoom-actions" gap={2}>
					<ToolButton icon="zoom-in" ariaLabel={copy.zoomIn} onClick={() => run(() => controller.actions.timeline.zoomIn())} />
					<ToolButton icon="zoom-out" ariaLabel={copy.zoomOut} onClick={() => run(() => controller.actions.timeline.zoomOut())} />
					<ToolButton icon="zoom-to-fit" ariaLabel={copy.zoomFit} onClick={() => run(() => controller.actions.timeline.zoomFit())} />
				</ToolbarButtonGroup>
				</>}

				{toolbars.edit?.visible !== false && <ToolbarButtonGroup className="kw-audio-editor__edit-actions" gap={2}>
					{editItems.map((item) => (
						<span key={item.action} data-edit={item.action === 'rippleDelete' ? 'ripple-delete' : item.action}>
							<ToolButton icon={item.icon} ariaLabel={item.label} disabled={item.disabled} onClick={() => executeEdit(item.action)} />
						</span>
					))}
				</ToolbarButtonGroup>}

				{toolbars.meter?.visible !== false && <>
				<div className="kw-audio-editor__timecode" data-time-display>
					<AccessibleTimeCode
						ariaLabel={`${copy.playhead}: ${copy.format}`}
						value={framesToSeconds(telemetry.positionFrame || 0, { sampleRate: project?.sampleRate })}
						sampleRate={project?.sampleRate || 48_000}
						showFormatSelector={!isCompact}
						disabled={snapshot.recording}
						onChange={(seconds) => run(() => controller.actions.transport.seek(secondsToFrames(seconds, { maximumFrame: durationFrames, sampleRate: project?.sampleRate })))}
					/>
				</div>
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
							aria-label={`${copy.timeSignature}: ${copy.numerator || 'numerator'}`}
							value={project?.tempo?.timeSignature?.numerator || 4}
							disabled={snapshot.readOnly || snapshot.recording}
							onChange={(event) => run(() => controller.actions.project.setTimeSignature(Number(event.currentTarget.value), project?.tempo?.timeSignature?.denominator || 4))}
						/>
						<span aria-hidden="true">/</span>
						<input
							type="number"
							min="1"
							max="32"
							aria-label={`${copy.timeSignature}: ${copy.denominator || 'denominator'}`}
							value={project?.tempo?.timeSignature?.denominator || 4}
							disabled={snapshot.readOnly || snapshot.recording}
							onChange={(event) => run(() => controller.actions.project.setTimeSignature(project?.tempo?.timeSignature?.numerator || 4, Number(event.currentTarget.value)))}
						/>
					</span>
				</label>

				{uiFlags.microphoneMetering && <ToolbarButtonGroup className="kw-audio-editor__recording-meter" gap={4}>
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

				{uiFlags.masterTrack && <ToolbarButtonGroup className="kw-audio-editor__playback-meter" gap={6}>
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

function WorkspacePanelDock({ dock, controller, snapshot, copy, run, onOpenEffects }) {
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
							onOpenEffects={onOpenEffects}
						/>
					</div>
				</section>
			))}
		</aside>
	);
}

function WorkspacePanelContent({ panelId, controller, snapshot, copy, run, onOpenEffects }) {
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
				<Button disabled={!selectedTrack} onClick={onOpenEffects}>{copy.trackMasterEffects}</Button>
				<Button variant="secondary" disabled={!selectedTrack} onClick={() => run(() => controller.actions.effects.applySelection())}>{copy.applyAudacityEffect}</Button>
			</>
		);
	}
	if (panelId === 'mixer') {
		const tracks = (project?.tracks || []).filter((track) => track.type !== 'label');
		return tracks.length ? (
			<div className="kw-audio-editor__mixer-list">
				{tracks.map((track) => (
					<fieldset key={track.id} disabled={snapshot.readOnly}>
						<legend>{track.name}</legend>
						<label><span>{copy.gain}</span><input type="range" min="0" max="2" step="0.01" value={track.gain} onChange={(event) => run(() => controller.actions.track.update(track.id, { gain: Number(event.currentTarget.value) }))} /></label>
						<label><span>{copy.pan}</span><input type="range" min="-1" max="1" step="0.01" value={track.pan} onChange={(event) => run(() => controller.actions.track.update(track.id, { pan: Number(event.currentTarget.value) }))} /></label>
					</fieldset>
				))}
			</div>
		) : <p className="kw-audio-editor__panel-empty">{copy.noAudioTrackSelected}</p>;
	}
	const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId && track.type !== 'label') || null;
	const defaultSpectrogram = snapshot.preferences?.spectrogram || {};
	const nyquist = Math.max(1, (selectedTrack?.sampleRate || project?.sampleRate || 48_000) / 2);
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
					<option value="mel">Mel</option><option value="linear">{copy.linear}</option><option value="log">{copy.logarithmic}</option>
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
					<option value="hann">Hann</option><option value="hamming">Hamming</option><option value="blackman">Blackman</option>
				</select>
			</label>
		</div>
	);
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

function WorkspacePreferencesDialog({ controller, snapshot, copy, locale, menus, run, onClose }) {
	const panelRef = useRef(null);
	const [shortcutSearch, setShortcutSearch] = useState('');
	const [workspaceName, setWorkspaceName] = useState('');
	const preferences = snapshot.preferences;
	const commands = useMemo(() => collectAudacityShortcutCommands(menus, { locale }), [locale, menus]);
	const visibleCommands = commands.filter((command) => `${command.label} ${command.id}`.toLowerCase().includes(shortcutSearch.trim().toLowerCase()));
	const activeCustom = preferences.workspace.custom.find((workspace) => workspace.id === preferences.workspace.activeId);

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

	return (
		<div className="kw-audio-editor-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<section ref={panelRef} tabIndex={-1} className="kw-audio-editor-dialog kw-audio-editor-preferences" role="dialog" aria-modal="true" aria-label={copy.preferencesTitle}>
				<DialogHeader title={copy.preferencesTitle} os="windows" onClose={onClose} />
				<div className="kw-audio-editor-preferences__body">
					<section>
						<h3>{copy.appearance}</h3>
						<div className="kw-audio-editor-preferences__grid">
							<label><span>{copy.theme}</span><select value={preferences.appearance.theme} onChange={(event) => run(() => controller.actions.preferences.setTheme(event.currentTarget.value))}>
								<option value="system">{copy.themeSystem}</option><option value="light">{copy.themeLight}</option><option value="dark">{copy.themeDark}</option><option value="high-contrast-light">{copy.themeHighContrastLight}</option><option value="high-contrast-dark">{copy.themeHighContrastDark}</option>
							</select></label>
							<label><span>{copy.clipStyle}</span><select value={preferences.appearance.clipStyle} onChange={(event) => run(() => controller.actions.preferences.setClipStyle(event.currentTarget.value))}>
								<option value="colorful">{copy.clipStyleColorful}</option><option value="classic">{copy.clipStyleClassic}</option>
							</select></label>
						</div>
					</section>

					<section>
						<h3>{copy.workspace}</h3>
						<label className="kw-audio-editor-preferences__wide"><span>{copy.workspacePreset}</span><select value={preferences.workspace.activeId} onChange={(event) => run(() => controller.actions.preferences.setWorkspace(event.currentTarget.value))}>
							<option value="modern">{copy.workspaceModern}</option><option value="music">{copy.workspaceMusic}</option><option value="classic">{copy.workspaceClassic}</option>
							{preferences.workspace.custom.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
						</select></label>
						<div className="kw-audio-editor__custom-workspace-actions">
							<input aria-label={copy.workspaceName} placeholder={copy.workspaceName} value={workspaceName} onChange={(event) => setWorkspaceName(event.currentTarget.value)} />
							<Button variant="secondary" disabled={!workspaceName.trim()} onClick={() => {
								run(() => controller.actions.preferences.createWorkspace(workspaceName.trim()));
								setWorkspaceName('');
							}}>{copy.workspaceCreate}</Button>
							<Button variant="secondary" disabled={!activeCustom} onClick={() => run(() => controller.actions.preferences.updateWorkspace(activeCustom.id, workspaceName.trim() ? { name: workspaceName.trim() } : {}))}>{copy.workspaceUpdate}</Button>
							<Button variant="secondary" disabled={!activeCustom} onClick={() => run(() => controller.actions.preferences.deleteWorkspace(activeCustom.id))}>{copy.workspaceDelete}</Button>
						</div>
					</section>

					<section>
						<h3>{copy.toolbarsMenu}</h3>
						<div className="kw-audio-editor-preferences__checks">
							{WORKSPACE_TOOLBAR_IDS.map((toolbarId) => <label key={toolbarId}><input type="checkbox" checked={preferences.workspace.toolbars[toolbarId]?.visible !== false} onChange={() => run(() => controller.actions.preferences.toggleToolbar(toolbarId))} /> {workspaceToolbarLabel(copy, toolbarId)}</label>)}
						</div>
					</section>

					<section>
						<h3>{copy.panels}</h3>
						<div className="kw-audio-editor-preferences__panel-list">
							{WORKSPACE_PANEL_IDS.map((panelId) => {
								const panel = preferences.workspace.panels[panelId];
								return <div key={panelId}><label><input type="checkbox" checked={panel.visible} onChange={() => run(() => controller.actions.preferences.togglePanel(panelId))} /> {workspacePanelLabel(copy, panelId)}</label><select aria-label={`${workspacePanelLabel(copy, panelId)}: ${copy.panelDock}`} value={panel.dock} onChange={(event) => run(() => controller.actions.preferences.setPanel(panelId, { dock: event.currentTarget.value }))}>{WORKSPACE_DOCK_IDS.map((dockId) => <option key={dockId} value={dockId}>{workspaceDockLabel(copy, dockId)}</option>)}</select></div>;
							})}
						</div>
					</section>

					<section className="kw-audio-editor-preferences__shortcuts">
						<h3>{copy.shortcuts}</h3>
						<input type="search" value={shortcutSearch} onChange={(event) => setShortcutSearch(event.currentTarget.value)} placeholder={copy.shortcutSearch} aria-label={copy.shortcutSearch} />
						<div className="kw-audio-editor-preferences__shortcut-list">
							{visibleCommands.map((command) => <ShortcutEditorRow key={command.id} command={command} preferences={preferences} controller={controller} copy={copy} run={run} />)}
						</div>
						<Button variant="secondary" onClick={() => run(() => controller.actions.preferences.resetShortcuts())}>{copy.shortcutsReset}</Button>
					</section>
				</div>
				<div className="kw-audio-editor-dialog__actions kw-audio-editor-preferences__footer"><Button onClick={onClose}>{copy.close}</Button></div>
			</section>
		</div>
	);
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

function GeneratorDialog({ type, controller, copy, run, onClose }) {
	const [params, setParams] = useState(() => generatorDefaults(type));
	useEffect(() => setParams(generatorDefaults(type)), [type]);
	const update = (name, value) => setParams((current) => ({ ...current, [name]: value }));
	const numberField = (name, label, options = {}) => (
		<label className="kw-audio-editor-dialog__field">
			<span>{label}</span>
			<NumberStepper
				value={String(params[name])}
				min={options.min}
				max={options.max}
				step={options.step ?? 0.01}
				width="100%"
				onChange={(value) => update(name, Number(value))}
			/>
		</label>
	);
	return (
		<div className="kw-audio-editor-dialog-layer" data-open="true">
			<section className="kw-audio-editor-dialog kw-audio-editor-dialog--generator" role="dialog" aria-modal="true" aria-labelledby="audio-editor-generator-title">
				<DialogHeader id="audio-editor-generator-title" title={generatorLabel(type, copy)} onClose={onClose} />
				<form onSubmit={(event) => {
					event.preventDefault();
					run(() => controller.actions.generators.generate(type, params));
					onClose();
				}}>
					{numberField('durationSeconds', copy.generatorDuration, { min: 0.001, max: 86_400, step: 0.1 })}
					{type !== 'silence' && numberField('amplitude', copy.generatorAmplitude, { min: 0, max: 1, step: 0.01 })}
					{type === 'tone' && <>
						{numberField('frequency', copy.generatorFrequency, { min: 0.01, max: 96_000, step: 1 })}
						<GeneratorSelect label={copy.generatorWaveform} value={params.waveform} onChange={(value) => update('waveform', value)} options={[
							['sine', copy.generatorSine], ['square', copy.generatorSquare], ['sawtooth', copy.generatorSawtooth],
						]} />
					</>}
					{type === 'chirp' && <>
						{numberField('startFrequency', copy.generatorStartFrequency, { min: 0.01, max: 96_000, step: 1 })}
						{numberField('endFrequency', copy.generatorEndFrequency, { min: 0.01, max: 96_000, step: 1 })}
						<GeneratorSelect label={copy.generatorInterpolation} value={params.interpolation} onChange={(value) => update('interpolation', value)} options={[
							['linear', copy.linear], ['logarithmic', copy.logarithmic],
						]} />
					</>}
					{type === 'noise' && <GeneratorSelect label={copy.generatorNoiseColor} value={params.color} onChange={(value) => update('color', value)} options={[
						['white', copy.generatorWhite], ['pink', copy.generatorPink], ['brown', copy.generatorBrown],
					]} />}
					{type === 'dtmf' && <>
						<label className="kw-audio-editor-dialog__field"><span>{copy.generatorSequence}</span><TextInput value={params.sequence} onChange={(value) => update('sequence', value)} /></label>
						{numberField('toneSeconds', copy.generatorToneDuration, { min: 0.001, max: 60, step: 0.01 })}
						{numberField('silenceSeconds', copy.generatorSilenceDuration, { min: 0, max: 60, step: 0.01 })}
					</>}
					<div className="kw-audio-editor-dialog__actions">
						<Button type="button" variant="secondary" onClick={onClose}>{copy.cancel}</Button>
						<Button type="submit">{copy.generate}</Button>
					</div>
				</form>
			</section>
		</div>
	);
}

function GeneratorSelect({ label, value, onChange, options }) {
	return <label className="kw-audio-editor-dialog__field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.currentTarget.value)}>{options.map(([id, text]) => <option key={id} value={id}>{text}</option>)}</select></label>;
}

function generatorDefaults(type) {
	const common = { durationSeconds: 1, amplitude: 0.8 };
	if (type === 'tone') return { ...common, frequency: 440, waveform: 'sine' };
	if (type === 'chirp') return { ...common, startFrequency: 440, endFrequency: 1320, interpolation: 'logarithmic' };
	if (type === 'noise') return { ...common, color: 'white' };
	if (type === 'dtmf') return { ...common, sequence: '123', toneSeconds: 0.1, silenceSeconds: 0.05 };
	return { durationSeconds: 1 };
}

function generatorLabel(type, copy) {
	return { silence: copy.silenceGenerator, tone: copy.toneGenerator, chirp: copy.chirpGenerator, noise: copy.noiseGenerator, dtmf: copy.dtmfGenerator }[type] || copy.generateMenu;
}

function EditorDialog({ type, value, onValueChange, controller, snapshot, copy, locale, run, onClose }) {
	const panelRef = useRef(null);
	useEffect(() => {
		const previouslyFocused = document.activeElement;
		const panel = panelRef.current;
		const focusableSelector = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
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
	return (
		<div className="kw-audio-editor-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<section ref={panelRef} tabIndex={-1} className="kw-audio-editor-dialog" role="dialog" aria-modal="true" aria-label={title}>
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
							run(() => controller.actions.recording.setLatencyOffset(value));
							onClose();
						}}>
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
							<p><code>Audacity 4 parity: 908ad0a526e5bfdab68de780e893cebe172d27eb</code></p>
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
			</section>
		</div>
	);
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
			<section ref={panelRef} tabIndex={-1} className="kw-audio-editor-dialog" role="dialog" aria-modal="true" aria-label={copy.spectralSelection}>
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
			</section>
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
	const compatibleMonoTracks = Boolean(selectedAudioTrack?.channelCount === 1 && project?.tracks.some((track) => (
		track.id !== selectedAudioTrack.id && track.type !== 'label' && track.channelCount === 1
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
					parityLabel: 'Export other',
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
				{ id: 'metronome', label: copy.metronome || 'Metronome', checked: Boolean(snapshot.recordingOptions?.metronome), onClick: actions.toggleMetronome },
			],
		},
		{
			id: 'record',
			label: copy.recordMenu,
			items: [
				{ id: 'record', label: snapshot.recording ? copy.stopRecording : recordLabel, shortcut: 'R', disabled: snapshot.readOnly || snapshot.importing || snapshot.exporting, onClick: actions.record },
				{ id: 'record-new-track', label: copy.recordNewTrack, shortcut: 'Shift+R', disabled: snapshot.readOnly || snapshot.recording || snapshot.recordingStarting, onClick: actions.recordNewTrack },
				{ id: 'stop', label: copy.stop, onClick: actions.stop },
				{ id: 'pause-recording', label: snapshot.recordingOptions?.paused ? (copy.resumeRecording || copy.record) : copy.pauseRecording, disabled: !snapshot.recording, checked: Boolean(snapshot.recordingOptions?.paused), onClick: actions.pauseRecording },
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
						{ id: 'audio-track', label: copy.audioTrack, disabled: editBlocked, onClick: actions.addTrack },
						{ id: 'new-mono-track', label: copy.newMonoTrack, disabled: editBlocked, onClick: actions.addMonoTrack },
						{ id: 'new-stereo-track', label: copy.newStereoTrack, disabled: editBlocked, onClick: actions.addStereoTrack },
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
						checked: selectedAudioTrack?.sampleRate === sampleRate,
						onClick: () => actions.setTrackRate(sampleRate),
					})).concat([{ id: 'track-change-rate-custom', label: `${copy.sampleRate}…`, onClick: actions.openTrackRate }]),
				},
				{
					id: 'track-format',
					label: copy.sampleFormat,
					disabled: editBlocked || !selectedAudioTrack,
					items: [
						['int16', copy.sampleFormatPcm?.replace('{bits}', '16') || '16-bit PCM'],
						['int24', copy.sampleFormatPcm?.replace('{bits}', '24') || '24-bit PCM'],
						['float32', copy.sampleFormatFloat32 || '32-bit Float'],
					].map(([sampleFormat, label]) => ({
						id: `action://trackedit/track/change-format?format=${sampleFormat}`,
						label,
						checked: selectedAudioTrack?.sampleFormat === sampleFormat,
						onClick: () => actions.setTrackSampleFormat(sampleFormat),
					})),
				},
				{
					id: 'track-channels',
					label: copy.trackChannels,
					disabled: editBlocked || !selectedAudioTrack,
					items: [
						{ id: 'track-make-stereo', label: copy.makeStereoTrack, disabled: !compatibleMonoTracks, onClick: actions.makeStereoTrack },
						{ id: 'track-swap-channels', label: copy.swapStereoChannels, disabled: selectedAudioTrack?.channelCount !== 2, onClick: actions.swapTrackChannels },
						{ id: 'track-split-stereo-to-lr', label: copy.splitStereoLr, disabled: selectedAudioTrack?.channelCount !== 2, onClick: actions.splitStereoLr },
						{ id: 'track-split-stereo-to-center', label: copy.splitStereoCenter, disabled: selectedAudioTrack?.channelCount !== 2, onClick: actions.splitStereoCenter },
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
				unavailable('manage-macros', copy.macroManager),
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
	], { locale, materializeDisabled: true, actionRuntime });
}

function handleWorkspaceKeyboard(event, snapshot, run, registry = {}) {
	if (event.defaultPrevented) return;
	if (event.target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="menu"], [role="menubar"], [role="toolbar"], [role="slider"], [role="spinbutton"]')) return;
	const shortcutAction = matchAudioEditorShortcut(event, snapshot.preferences?.shortcuts || {});
	const handler = shortcutAction ? resolveAudioEditorShortcutHandler(shortcutAction, registry) : null;
	if (handler) {
		run(handler);
		event.preventDefault();
	}
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
	return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(locale === 'de' ? 'de-DE' : 'en-US');
}
