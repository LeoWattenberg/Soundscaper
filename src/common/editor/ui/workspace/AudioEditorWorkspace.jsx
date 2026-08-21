import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { productProfile } from '../../../products.js';
import { createAudacityActionRuntime } from '../../audacity-action-runtime.js';
import { projectDurationFrames } from '../../project.js';
import { useAudioEditorSnapshot, useAudioEditorThemeVariables } from '../DesignSystemRuntime.jsx';
import {
	selectAudioEditorBusyBlock,
	selectAudioEditorEditBlock,
	selectAudioEditorProjectHandoffBlock,
} from '../edit-blocking.ts';

import { loadPlaybackMeterSettings, loadRecordingMeterSettings } from '../meter-settings.ts';
import EditorToolToolbar from '../toolbar/EditorToolToolbar.jsx';
import AudioEditorWorkspaceView from './AudioEditorWorkspaceView.jsx';
import { withDesktopProjectReadDescriptor } from './desktop-project-file-routing.ts';
import { useTimelineNavigation } from './useTimelineNavigation.js';
import { useWorkspaceToolbarDocking } from './useWorkspaceToolbarDocking.js';
import { useAudioEditorWorkspaceLifecycle } from './useAudioEditorWorkspaceLifecycle.js';
import { useDesktopEditorBridge } from './useDesktopEditorBridge.js';
import { useScapeOpenDecisionContinuation } from './useScapeOpenDecisionContinuation.ts';
import { useWorkspaceParityRequests } from './useWorkspaceParityRequests.js';
import { useWorkspaceSearchRuntime } from './useWorkspaceSearchRuntime.js';
import { useSoundscaperProductionWorkspace } from './useSoundscaperProductionWorkspace.ts';
import { useTrackRateDialog } from './useTrackRateDialog.js';
import { useWorkspaceThemePreference } from './useWorkspaceThemePreference.js';
import { createWorkspaceApplicationMenus, useSoundscaperNativeServicesMenuRefresh } from './workspace-application-menu-runtime.js';
import { useTakeCycleRecoverySurface } from '../use-take-cycle-recovery-surface.ts';
import { partitionWorkspaceFiles } from './workspace-file-routing.js';
import { desktopExternalDestination, formatDateTimeLocalInput, useMediaQuery } from '../workspace-runtime.js';
import { WEB_VCR_PANEL_ID } from '../web-vcr-ui-model.ts';
export default function AudioEditorWorkspace({
	locale,
	copy,
	productId = 'soundscaper',
	controller,
	fileService,
	projectForRuntimeConsumers,
	crossProductHandoffAvailable = false,
}) {
	const product = useMemo(() => productProfile(productId), [productId]);
	useSoundscaperNativeServicesMenuRefresh({ productId });
	const capabilities = product.capabilities;
	const aboutLabel = productId === 'framescaper' ? copy.aboutFramescaper : copy.aboutEditor;
	const editorThemeVariables = useAudioEditorThemeVariables();
	const parityRuntime = useMemo(() => createAudacityActionRuntime(controller, { productId }), [controller, productId]);
	const snapshot = useAudioEditorSnapshot(controller);
	const [activeSurface, setActiveSurface] = useTakeCycleRecoverySurface(productId, snapshot.takeCycleRecovery);
	const [effectsPanelTarget, setEffectsPanelTarget] = useState(null);
	const [effectWindow, setEffectWindow] = useState(null);
	const [macroDraft, setMacroDraft] = useState(() => ({ name: copy.untitledMacro, effects: [] }));
	const [dialog, setDialog] = useState(null);
	const [dialogValue, setDialogValue] = useState('');
	const [dialogSourceKey, setDialogSourceKey] = useState('global');
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [showArmControls, setShowArmControls] = useState(false);
	const [automationToolEnabled, setAutomationToolEnabled] = useState(false);
	const [generatorType, setGeneratorType] = useState('tone');
	const [nyquistTarget, setNyquistTarget] = useState(() => ({ prompt: true, pluginId: null }));
	const [preferencesPage, setPreferencesPage] = useState('shortcuts');
	const [draggedWorkspacePanelId, setDraggedWorkspacePanelId] = useState(null);
	const [projectBinSessionOpened, setProjectBinSessionOpened] = useState(false);
	const [timelineSearchReveal, setTimelineSearchReveal] = useState(null);
	const [projectBinSearchReveal, setProjectBinSearchReveal] = useState(null);
	const [editorOverlayTarget, setEditorOverlayTarget] = useState(null);
	const [playbackMeterSettings, setPlaybackMeterSettings] = useState(() => loadPlaybackMeterSettings(productId));
	const [recordingMeterSettings, setRecordingMeterSettings] = useState(() => loadRecordingMeterSettings(productId));
	const importInputRef = useRef(null);
	const aup4InputRef = useRef(null);
	const legacyAupInputRef = useRef(null);
	const legacyDataInputRef = useRef(null);
	const pendingLegacyProjectRef = useRef(null);
	const editorRef = useRef(null);
	const workspaceRef = useRef(null);
	const {
		requestScapeOpenDecision,
		scapeOpenDecision,
		settleScapeOpenDecision,
	} = useScapeOpenDecisionContinuation();
	const {
		floatingToolbarPosition,
		floatingToolbarRef,
		handleToolbarGripperMouseDown,
		toolbarDock,
		toolbarDragRef,
	} = useWorkspaceToolbarDocking(editorRef);
	const isCompact = useMediaQuery('(max-width: 900px)');
	const isProjectBinCompact = useMediaQuery('(max-width: 520px)');
	const project = snapshot.project;
	const runtimeProject = useMemo(() => (
		project && projectForRuntimeConsumers ? projectForRuntimeConsumers(project) : null
	), [project, projectForRuntimeConsumers]);
	const preferences = snapshot.preferences;
	useWorkspaceThemePreference(preferences?.appearance?.theme);
	const isVideoEditorWorkspace = preferences?.workspace?.activeId === 'video-editor';
	const projectBinPreferenceVisible = preferences?.workspace?.panels?.['project-bin']?.visible === true;
	const projectBinEffectivelyOpen = projectBinPreferenceVisible
		&& (isVideoEditorWorkspace || !isProjectBinCompact || projectBinSessionOpened);
	const toolbarPreferences = preferences?.workspace?.toolbars || {};
	const toolbarButtonPreferences = preferences?.workspace?.toolbarButtons || {};
	const {
		desktopEnvironment,
		desktopHostRuntime,
		localError,
		onError,
		parityUi,
		run,
		uiFlags,
	} = useAudioEditorWorkspaceLifecycle({
		controller,
		copy,
		fileService,
		parityRuntime,
		playbackMeterSettings,
		preferences,
		product,
		productId,
		recordingMeterSettings,
		setPlaybackMeterSettings,
		setRecordingMeterSettings,
	});
	const busyBlock = selectAudioEditorBusyBlock(snapshot);
	const editBlock = selectAudioEditorEditBlock(snapshot);
	const handoffBlock = selectAudioEditorProjectHandoffBlock(snapshot);
	const blocked = busyBlock.blocked;
	const editBlocked = editBlock.blocked;
	const handoffBlocked = handoffBlock.blocked;
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
	const { dialogTrackId, openTrackRate } = useTrackRateDialog(project, setDialog, setDialogValue);
	const splitAvailable = Boolean(
		selectedClip
		|| selectedAudioTrack?.clipIds?.length
		|| project?.selection?.clipIds?.some((clipId) => project.clips.some((clip) => clip.id === clipId))
		|| project?.selection?.trackIds?.some((trackId) => (
			project.tracks.some((track) => track.id === trackId && track.type === 'audio' && track.clipIds.length)
		)),
	);
	const { jumpToEnd, jumpToStart, zoomProject } = useTimelineNavigation({
		controller,
		editorRef,
		project,
		run,
		snapshot,
		workspaceRef,
	});
	const moveWorkspacePanel = useCallback((panelId, dock, index) => {
		setDraggedWorkspacePanelId(null);
		return run(() => controller.actions.preferences.movePanel(panelId, dock, index));
	}, [controller, run]);
	const toggleFullscreen = useCallback(() => {
		if (fileService.isDesktop) return fileService.runWindowAction('toggle-fullscreen');
		setIsFullscreen((current) => !current);
		return undefined;
	}, [fileService]);
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
	const openScapeProjectFile = useCallback((file) => (
		controller.actions.project.openScapeFile(file, requestScapeOpenDecision)
	), [controller, requestScapeOpenDecision]);
	const openProjectFile = useCallback((file) => (/\.scape$/iu.test(file?.name || '')
		? openScapeProjectFile(file)
		: controller.actions.project.openAudacityProject(file)), [controller, openScapeProjectFile]);
	const openDesktopProjectDescriptor = useCallback((descriptor) => withDesktopProjectReadDescriptor(
		fileService,
		descriptor,
		{ openMaterialized: openProjectFile, openScape: openScapeProjectFile },
	), [fileService, openProjectFile, openScapeProjectFile]);
	const importRoutedFiles = useCallback(async (files, importOptions = {}) => {
		const routed = partitionWorkspaceFiles(files);
		for (const file of routed.projects) await openProjectFile(file);
		if (routed.media.length) {
			await controller.actions.project.importFiles(routed.media, {
				destination: 'auto',
				projectBinVisible: projectBinEffectivelyOpen,
				...importOptions,
			});
		}
		for (const file of routed.labels) await controller.actions.labels.importFile(file);
		return files.length;
	}, [controller, openProjectFile, projectBinEffectivelyOpen]);
	const openDesktopFiles = useCallback(async (purpose, multiple = false, importOptions = {}) => {
		const descriptors = await fileService.chooseFiles({ purpose, multiple });
		if (purpose === 'project') {
			for (const descriptor of descriptors) await openDesktopProjectDescriptor(descriptor);
			return descriptors.length;
		}
		return fileService.withReadDescriptors(descriptors, {}, async (files) => {
			if (files.length) await importRoutedFiles(files, importOptions);
			return files.length;
		});
	}, [fileService, importRoutedFiles, openDesktopProjectDescriptor]);

	const openSurface = useCallback((surface, options = {}) => {
		if (surface === 'preferences') {
			const requestedSection = options?.section;
			setPreferencesPage(['appearance', 'editing', 'workspace', 'panels', 'shortcuts', 'spectrogram', 'sound-activation'].includes(requestedSection)
				? requestedSection
				: requestedSection === 'snap' ? 'editing' : 'shortcuts');
		}
		setActiveSurface(surface);
	}, [setActiveSurface]);
	const soundscaperProduction = useSoundscaperProductionWorkspace({ productId, controller, project, selectedTrackId: snapshot.selectedTrackId, openSurface });

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
	}, [controller, run, setActiveSurface, snapshot.selectedTrackId]);

	const durationFrames = project ? projectDurationFrames(runtimeProject ?? project) : 0;
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
	}, [controller, setActiveSurface]);
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
		if (panelId === WEB_VCR_PANEL_ID) return run(() => controller.actions.webVcr.close());
		if (panelId !== 'project-bin') return run(() => controller.actions.preferences.togglePanel(panelId));
		if (!projectBinEffectivelyOpen) setProjectBinSessionOpened(true);
		return run(() => controller.actions.preferences.setPanel(panelId, { visible: !projectBinEffectivelyOpen }));
	}, [controller, projectBinEffectivelyOpen, run]);
	const revealProjectBin = useCallback(
		() => openWorkspacePanel('project-bin'),
		[openWorkspacePanel],
	);
	useEffect(() => {
		const binItemId = projectBinSearchReveal?.binItemId;
		if (!binItemId) return undefined;
		let frame = 0;
		let attempts = 0;
		const revealItem = () => {
			attempts += 1;
			const item = [...(workspaceRef.current?.querySelectorAll('[data-project-bin-item]') || [])]
				.find((candidate) => String(candidate.dataset.projectBinItem) === String(binItemId));
			if (item) {
				item.focus({ preventScroll: true });
				item.scrollIntoView({ block: 'nearest', inline: 'nearest' });
				return;
			}
			if (attempts < 8) frame = requestAnimationFrame(revealItem);
		};
		frame = requestAnimationFrame(revealItem);
		return () => cancelAnimationFrame(frame);
	}, [projectBinSearchReveal]);
	const openExternal = useCallback((url) => {
		if (fileService.isDesktop) return fileService.openExternal(desktopExternalDestination(url));
		const opened = globalThis.open?.(url, '_blank', 'noopener,noreferrer');
		if (opened) opened.opener = null;
		return undefined;
	}, [fileService]);
	useWorkspaceParityRequests({
		controller,
		importInputRef,
		openExternal,
		openRecordingOffset,
		openSurface,
		openTimedRecording,
		openTrackRate,
		openWorkspacePanel,
		parityUi,
		project,
		run,
		selectedTrack,
		setDialog,
		setDialogValue,
		setGeneratorType,
		setNyquistTarget,
		snapshot,
		toggleFullscreen,
		workspaceRef,
	});
	const applicationMenus = createWorkspaceApplicationMenus({
		aboutLabel,
		aup4InputRef,
		blocked,
		capabilities,
		controller,
		copy,
		crossProductHandoffAvailable,
		desktopHostRuntime,
		durationFrames,
		editBlocked,
		handoffBlocked,
		executeEdit,
		fileService,
		importInputRef,
		legacyAupInputRef,
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
		openTrackRate,
		openWorkspacePanel,
		parityRuntime,
		productId,
		project,
		projectBinEffectivelyOpen,
		recordLabel,
		run,
		selectedClip,
		selectedAudioTrack,
		selectionActive,
		setDialog,
		setDialogValue,
		setNyquistTarget,
		setShowArmControls,
		showArmControls,
		soundscaperProduction,
		snapshot,
		toggleFullscreen,
		toggleRecording,
		toggleWorkspacePanel,
		uiFlags,
		zoomProject,
	});
	const { activateSearchEntry, searchEntries } = useWorkspaceSearchRuntime({
		applicationMenus,
		controller,
		openWorkspacePanel,
		parityRuntime,
		project,
		run,
		setProjectBinSearchReveal,
		setTimelineSearchReveal,
	});
	const desktopChrome = useDesktopEditorBridge({
		copy,
		controller,
		desktopEnvironment,
		durationFrames,
		fileService,
		isFullscreen,
		onError,
		openDesktopFiles,
		openDesktopProjectDescriptor,
		openSurface,
		run,
		setIsFullscreen,
		snapshot,
		toggleFullscreen,
	});
	const editorToolbar = (
		<EditorToolToolbar
			capabilities={capabilities}
			controller={controller}
			snapshot={snapshot}
			locale={locale}
			copy={copy}
			isCompact={isCompact}
			zoomProject={zoomProject}
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
			onOpenTakeCycleRecovery={() => openSurface('take-cycle-recovery')}
			onJumpToStart={jumpToStart}
			onJumpToEnd={jumpToEnd}
			onGripperMouseDown={handleToolbarGripperMouseDown}
		/>
	);

	return <AudioEditorWorkspaceView model={{
		aboutLabel,
		activateSearchEntry,
		activeSurface,
		applicationMenus,
		aup4Compatibility,
		aup4InputRef,
		automationToolEnabled,
		blocked,
		capabilities,
		closeNyquist,
		controller,
		copy,
		dialog,
		dialogSourceKey,
		dialogTrackId,
		dialogValue,
		displayAudioSupported,
		desktopChrome,
		draggedWorkspacePanelId,
		durationFrames,
		editBlock,
		editBlocked,
		editorOverlayTarget,
		editorRef,
		editorThemeVariables,
		editorToolbar,
		effectWindow,
		effectsPanelTarget,
		executeEdit,
		fileService,
		floatingToolbarPosition,
		floatingToolbarRef,
		generatorType,
		importInputRef,
		importRoutedFiles,
		isCompact,
		isFullscreen,
		isVideoEditorWorkspace,
		legacyAupInputRef,
		legacyDataInputRef,
		locale,
		macroDraft,
		moveWorkspacePanel,
		nyquistTarget,
		onError,
		openEffects,
		openTrackRate,
		openProjectFile,
		openSurface,
		parityRuntime,
		pendingLegacyProjectRef,
		playbackMeterSettings,
		preferences,
		preferencesPage,
		productId,
		project,
		runtimeProject,
		projectBinEffectivelyOpen,
		recordingMeterSettings,
		revealProjectBin,
		run,
		saveText,
		scapeOpenDecision,
		searchEntries,
		setActiveSurface,
		setDialog,
		setDialogSourceKey,
		setDialogValue,
		setDraggedWorkspacePanelId,
		setEditorOverlayTarget,
		setEffectWindow,
		setMacroDraft,
		setPlaybackMeterSettings,
		setRecordingMeterSettings,
		setShowArmControls,
		settleScapeOpenDecision,
		showArmControls,
		soundscaperProduction,
		snapshot,
		statusMessage,
		statusState,
		timelineSearchReveal,
		toggleFullscreen,
		toggleSplitTool,
		toggleWorkspacePanel,
		toolbarButtonPreferences,
		toolbarDock,
		toolbarDragRef,
		uiFlags,
		workspaceRef,
	}} />;
}
