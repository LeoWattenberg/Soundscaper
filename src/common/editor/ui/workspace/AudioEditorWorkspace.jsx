import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { productProfile } from '../../../products.js';
import { useControllerOwnedActionRuntime } from './useControllerOwnedActionRuntime.js';
import { projectDurationFrames } from '../../project.js';
import { useAudioEditorSnapshot, useAudioEditorThemeVariables } from '../DesignSystemRuntime.jsx';
import {
	selectAudioEditorBusyBlock,
	selectAudioEditorEditBlock,
	selectAudioEditorProjectHandoffBlock,
} from '../edit-blocking.ts';
import { loadPlaybackMeterSettings, loadRecordingMeterSettings } from '../meter-settings.ts';
import { resolveMeterPanelSettingsChange } from './meter-panel-settings.ts';
import AudioEditorWorkspaceView from './AudioEditorWorkspaceView.jsx';
import { resolveWorkspaceRuntimeProjection } from './workspace-runtime-projection.ts';
import { workspaceStatusPresentation } from './workspace-status-presentation.ts';
import { withDesktopProjectReadDescriptor } from './desktop-project-file-routing.ts';
import { workspacePreferencesPage } from './workspace-preferences-routing.ts';
import { focusOpenedWorkspacePanel } from './workspace-panel-opening-focus.ts';
import { useTimelineNavigation } from './useTimelineNavigation.js';
import { useWorkspaceToolbarDocking } from './useWorkspaceToolbarDocking.js';
import { useWorkspaceClipPropertiesPanel } from './useWorkspaceClipPropertiesPanel.ts';
import { useAudioEditorWorkspaceLifecycle } from './useAudioEditorWorkspaceLifecycle.js';
import { useDesktopEditorBridge } from './useDesktopEditorBridge.js';
import { useScapeOpenDecisionContinuation } from './useScapeOpenDecisionContinuation.ts';
import { useLaunchedFileImports } from './useLaunchedFileImports.ts';
import { useWorkspaceParityRequests } from './useWorkspaceParityRequests.js';
import { useWorkspaceSearchRuntime } from './useWorkspaceSearchRuntime.js'; import { useWorkspaceAssistanceSearchRuntime } from './useWorkspaceAssistanceSearchRuntime.js';
import { useSoundscaperWorkflowWorkspace } from '../soundscaper-workflow-product-runtime.tsx';
import { useTrackRateDialog } from './useTrackRateDialog.js';
import { useWorkspaceThemePreference } from './useWorkspaceThemePreference.js';
import {
	createWorkspaceApplicationMenus,
	useFramescaperNativeServicesMenuRefresh,
	useSoundscaperNativeServicesMenuRefresh,
} from './workspace-application-menu-runtime.js';
import { usePrivacyPolicySurface } from '../use-privacy-policy-surface.ts';
import { useTakeCycleRecoverySurface } from '../use-take-cycle-recovery-surface.ts';
import { supportsDisplayAudioCapture } from '../../recording-display-input.ts';
import { importWorkspaceRoutedFiles } from './import-workspace-routed-files.ts';
import { openWorkspaceProjectFile } from './open-workspace-project-file.ts';
import { desktopExternalDestination } from '../workspace-runtime.js'; import { createTimedRecordingDialogValue } from '../dialogs/timed-recording-dialog-model.ts';
import { useTrackHeaderDrawerFlag, useWorkspaceCompactLayout } from './useWorkspaceCompactLayout.js';
import { useWorkspaceEffectsPanel } from './useWorkspaceEffectsPanel.js';
import { useWorkspaceEffectWindows } from './WorkspaceEffectWindows.tsx';
import { useAutoShowVideoPreview } from './useAutoShowVideoPreview.ts';
import { createWorkspaceEditItems } from './workspace-edit-items.js';
import { resolveEditingActionAvailability } from '../../commands/editing-selection-authority.ts';
import { useCueImportWorkspace } from './cue-import-workspace.tsx'; import { useFreesoundClipUploadCommand } from './freesound-clip-upload-command.ts';
import { createWorkspaceOverlayModel } from './workspace-model-boundaries.ts';
const DEFERRED_WEB_VCR_PANEL_ID = 'web-vcr'; export default function AudioEditorWorkspace({
	locale,
	copy,
	productId = 'soundscaper',
	controller,
	fileService, confirmFileSizeWarning,
	selectedMediaPreparation = controller?.selectedMediaPreparation ?? null, assistanceSearchSource = null,
	projectForRuntimeConsumers, crossProductHandoffAvailable = false, initialSurface = null,
}) {
	const product = useMemo(() => productProfile(productId), [productId]);
	useFramescaperNativeServicesMenuRefresh({ productId });
	useSoundscaperNativeServicesMenuRefresh({ productId, copy, engine: controller?.engine, controller });
	const capabilities = product.capabilities;
	const aboutLabel = productId === 'framescaper' ? copy.aboutFramescaper : copy.aboutEditor;
	const editorThemeVariables = useAudioEditorThemeVariables();
	const parityRuntime = useControllerOwnedActionRuntime(controller, productId, locale);
	const snapshot = useAudioEditorSnapshot(controller);
	const [activeSurface, setActiveSurface] = useTakeCycleRecoverySurface(productId, snapshot.takeCycleRecovery);
	usePrivacyPolicySurface(productId, initialSurface, setActiveSurface);
	const { windows: effectWindows, open: setEffectWindow, close: closeEffectWindow } = useWorkspaceEffectWindows(snapshot.project?.id ?? null);
	const [macroDraft, setMacroDraft] = useState(null);
	const [dialog, setDialog] = useState(null);
	const [dialogValue, setDialogValue] = useState('');
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [showArmControls, setShowArmControls] = useState(false);
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
	const { cueImportDialog, importInputRef, requestCueImport } = useCueImportWorkspace(controller, snapshot.project?.id);
	const aup4InputRef = useRef(null);
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
		setToolbarDock,
	} = useWorkspaceToolbarDocking(editorRef, productId);
	const project = snapshot.project;
	// Resolved above every surface boundary, so a document the projection
	// refuses becomes a value here and fails under the timeline's own boundary.
	const projection = useMemo(() => resolveWorkspaceRuntimeProjection(
		project, { projectForRuntimeConsumers, projectDurationFrames },
	), [project, projectForRuntimeConsumers]);
	const { runtimeProject, durationFrames } = projection;
	const preferences = snapshot.preferences;
	const { chromeDrawer, compactLayout, isCompact, isProjectBinCompact } = useWorkspaceCompactLayout({ layoutPreference: preferences?.appearance?.layout });
	useWorkspaceThemePreference(preferences?.appearance?.theme, productId);
	const isVideoEditorWorkspace = preferences?.workspace?.activeId === 'video-editor';
	const projectBinPreferenceVisible = preferences?.workspace?.panels?.['project-bin']?.visible === true;
	const projectBinEffectivelyOpen = projectBinPreferenceVisible
		&& (isVideoEditorWorkspace || !isProjectBinCompact || projectBinSessionOpened);
	const toolbarPreferences = preferences?.workspace?.toolbars || {};
	const toolbarButtonPreferences = preferences?.workspace?.toolbarButtons || {};
	const {
		clearError, dismissWebFileLimitPrompt,
		desktopEnvironment,
		desktopHostRuntime,
		localError, webFileLimitPrompt,
		onError,
		parityUi,
		run,
		uiFlags,
	} = useAudioEditorWorkspaceLifecycle({
		controller,
		copy,
		fileService,
		parityRuntime, phase: snapshot.phase,
		playbackMeterSettings,
		preferences,
		product,
		productId,
		recordingMeterSettings,
		setDialog,
		setPlaybackMeterSettings,
		setRecordingMeterSettings,
	});
	const showVideoPreview = useCallback(() => {
		run(() => controller.actions.preferences.setPanelVisibility('video-preview', true));
	}, [controller, run]);
	useAutoShowVideoPreview(project, preferences?.workspace?.panels?.['video-preview']?.visible === true, showVideoPreview, productId === 'soundscaper');
	const trackHeaderDrawer = useTrackHeaderDrawerFlag(parityRuntime.uiController, uiFlags.trackHeaderDrawer, compactLayout);
	const automationToolEnabled = Boolean(uiFlags.automationTool);
	const busyBlock = selectAudioEditorBusyBlock(snapshot);
	const editBlock = selectAudioEditorEditBlock(snapshot);
	const handoffBlock = selectAudioEditorProjectHandoffBlock(snapshot);
	const blocked = busyBlock.blocked;
	const editBlocked = editBlock.blocked;
	const handoffBlocked = handoffBlock.blocked;
	const displayAudioSupported = fileService.isDesktop
		? desktopEnvironment?.capabilities?.displayAudio === true
		: supportsDisplayAudioCapture();
	const selectedClip = project?.clips.find((clip) => clip.id === snapshot.selectedClipId) || null;
	const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId) || null;
	const selectedAudioTrack = selectedTrack?.type === 'audio' ? selectedTrack : null;
	const editingActions = resolveEditingActionAvailability({
		project,
		focusedClipId: snapshot.selectedClipId,
		focusedTrackId: snapshot.selectedTrackId,
	});
	const selectionActive = editingActions.range !== null;
	const editSelectionActive = editingActions.editSelectionActive;
	const { dialogTrackId, openTrackRate } = useTrackRateDialog(project, setDialog, setDialogValue);
	const { jumpToEnd, jumpToStart, zoomProject } = useTimelineNavigation({
		controller,
		editorRef,
		project,
		run,
		snapshot,
		workspaceRef,
	});
	const moveWorkspacePanel = useCallback((panelId, placement) => {
		setDraggedWorkspacePanelId(null);
		return run(() => controller.actions.preferences.movePanel(panelId, placement));
	}, [controller, run]);
	const toggleFullscreen = useCallback(() => {
		if (fileService.isDesktop) return fileService.runWindowAction('toggle-fullscreen');
		setIsFullscreen((current) => !current);
		return undefined;
	}, [fileService]);
	const toggleSplitTool = useCallback(() => (
		run(() => parityRuntime.actions.tools.toggleSplitTool())
	), [parityRuntime, run]);
	const toggleAutomationTool = useCallback(() => (
		run(() => parityRuntime.actions.tools.toggleAutomationTool())
	), [parityRuntime, run]);
	useEffect(() => {
		if (snapshot.sampleEdit?.mode !== 'pencil') return;
		parityRuntime.actions.tools.synchronizeDrawTool();
	}, [parityRuntime, snapshot.sampleEdit?.mode]);
	const toggleRecording = useCallback(() => {
		if (snapshot.recording) return run(() => snapshot.recordingKind === 'take-cycle'
			? controller.actions.transport.stop()
			: controller.actions.recording.pause());
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
	}, [controller, project?.tracks, run, showArmControls, snapshot.recording, snapshot.recordingKind, snapshot.recordingScheduling, snapshot.scheduledRecording, snapshot.selectedTrackId]);

	const openTimedRecording = useCallback(() => {
		const startTimeMs = snapshot.scheduledRecording?.startTimeMs ?? Date.now() + 5 * 60_000;
		setDialogValue(createTimedRecordingDialogValue(startTimeMs, snapshot.scheduledRecording?.endTimeMs));
		setDialog('timed-recording');
	}, [snapshot.scheduledRecording?.endTimeMs, snapshot.scheduledRecording?.startTimeMs]);
	const openProjects = useCallback(() => {
		setDialog('projects');
		run(() => controller.actions.project.list());
	}, [controller, run]);
	const openScapeProjectFile = useCallback((file) => (
		controller.actions.project.openScapeFile(file, requestScapeOpenDecision)
	), [controller, requestScapeOpenDecision]);
	const openProjectFile = useCallback((file, desktopSesx = false) => openWorkspaceProjectFile(
		controller, file, openScapeProjectFile, (legacyFile) => {
			pendingLegacyProjectRef.current = legacyFile;
			legacyDataInputRef.current?.click();
		}, desktopSesx, (cueFile) => requestCueImport(cueFile, controller.getSnapshot().project?.id)), [controller, openScapeProjectFile, requestCueImport]);
	const openDesktopProjectDescriptor = useCallback((descriptor) => withDesktopProjectReadDescriptor(
		fileService,
		descriptor,
		{ openMaterialized: (file) => openProjectFile(file, true), openScape: openScapeProjectFile },
	), [fileService, openProjectFile, openScapeProjectFile]);
	const importRoutedFiles = useCallback((files, importOptions = {}) => importWorkspaceRoutedFiles({
		controller, files, importOptions, openProjectFile,
		projectBinVisible: projectBinEffectivelyOpen, requestCueImport,
	}), [controller, openProjectFile, projectBinEffectivelyOpen, requestCueImport]);
	useLaunchedFileImports({
		controller, importFiles: importRoutedFiles, onError, desktop: fileService.isDesktop,
	});
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
	const { clipPropertiesFocusRequest, openClipPropertiesSurface } = useWorkspaceClipPropertiesPanel({
		controller, run, setActiveSurface, selectedClipId: snapshot.selectedClipId ?? null,
		projectId: project?.id ?? null, panelVisible: Boolean(preferences?.workspace?.panels?.['clip-properties']?.visible),
	});
	const openSurface = useCallback((surface, options = {}) => {
		if (openClipPropertiesSurface(surface, options?.clipId)) return;
		if (surface === 'preferences') {
			setPreferencesPage(workspacePreferencesPage(options?.section));
		}
		setActiveSurface(surface);
	}, [openClipPropertiesSurface, setActiveSurface]);
	const soundscaperWorkflow = useSoundscaperWorkflowWorkspace({ productId, controller, project, selectedTrackId: snapshot.selectedTrackId, openSurface });
	const { effectsPanelTarget, openEffects } = useWorkspaceEffectsPanel({
		controller, run, setActiveSurface, selectedTrackId: snapshot.selectedTrackId,
		effectsVisible: snapshot.preferences?.workspace?.panels?.effects?.visible, workspaceRef,
	});
	const { statusMessage, statusState, statusError } = workspaceStatusPresentation(snapshot.status, localError, copy.ready);
	const aup4Compatibility = snapshot.aup4Compatibility;
	const saveText = snapshot.save?.state === 'saving'
		? copy.projectSaving
		: snapshot.save?.state === 'dirty'
			? copy.projectDirty
			: copy.projectSaved;
	const recordLabel = showArmControls ? copy.record : copy.recordActiveTrack;
	const editItems = createWorkspaceEditItems({
		copy, editBlocked, editSelectionActive, hasClipboard: Boolean(snapshot.history?.hasClipboard), splitAvailable: editingActions.split,
	});

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
	const closeNyquist = useCallback(({ cancelEvaluation = true } = {}) => {
		if (cancelEvaluation) controller.actions.nyquist.cancel();
		setActiveSurface(null);
	}, [controller, setActiveSurface]);
	const openWorkspacePanel = useCallback((panelId) => {
		if (panelId === 'project-bin') setProjectBinSessionOpened(true);
		if (panelId === 'playback-meter') setPlaybackMeterSettings((settings) => ({ ...settings, position: 'panel' }));
		if (panelId === 'recording-meter') setRecordingMeterSettings((settings) => ({ ...settings, position: 'panel' }));
		run(() => controller.actions.preferences.setPanelVisibility(panelId, true));
		requestAnimationFrame(() => {
			focusOpenedWorkspacePanel(editorRef.current?.querySelector(`[data-workspace-panel="${panelId}"]`) ?? null);
		});
	}, [controller, run]);
	const toggleWorkspacePanel = useCallback((panelId) => {
		if (panelId === DEFERRED_WEB_VCR_PANEL_ID) return run(() => controller.actions.webVcr.close());
		if (panelId === 'playback-meter' || panelId === 'recording-meter') {
			const visible = !preferences.workspace.panels[panelId]?.visible;
			const setSettings = panelId === 'playback-meter' ? setPlaybackMeterSettings : setRecordingMeterSettings;
			setSettings((settings) => ({ ...settings, position: visible ? 'panel' : 'flyout' }));
			return run(() => controller.actions.preferences.setPanelVisibility(panelId, visible));
		}
		if (panelId !== 'project-bin') return run(() => controller.actions.preferences.togglePanel(panelId));
		if (!projectBinEffectivelyOpen) setProjectBinSessionOpened(true);
		return run(() => controller.actions.preferences.setPanelVisibility(panelId, !projectBinEffectivelyOpen));
	}, [controller, preferences.workspace.panels, projectBinEffectivelyOpen, run]);
	const revealProjectBin = useCallback(
		() => openWorkspacePanel('project-bin'),
		[openWorkspacePanel],
	);
	const uploadClipToFreesound = useFreesoundClipUploadCommand({ controller, project, missingSourceIds: snapshot.missingSourceIds, onError, openPanel: openWorkspacePanel });
	useEffect(() => {
		const binItemId = projectBinSearchReveal?.binItemId;
		if (!binItemId) return undefined;
		let frame = 0;
		let attempts = 0;
		const revealItem = () => {
			attempts += 1;
			const item = [...(editorRef.current?.querySelectorAll('[data-project-bin-item]') || [])]
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
	const assistanceSearchRuntime = useWorkspaceAssistanceSearchRuntime({ project, source: assistanceSearchSource });
	useWorkspaceParityRequests({
		controller,
		importInputRef,
		openExternal,
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
		compactLayout,
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
		locale,
		openDesktopFiles,
		openEffects, openAssistanceSearch: assistanceSearchRuntime.openAssistanceSearch,
		openExternal,
		openGenerator,
		openProjects,
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
		soundscaperWorkflow,
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
		editorRef,
		openWorkspacePanel,
		parityRuntime,
		project,
		run,
		setProjectBinSearchReveal,
		setTimelineSearchReveal,
		snapshot,
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
	const meterSettingsChange = (panelId, settings, setSettings) => (update) => {
		const next = resolveMeterPanelSettingsChange(settings, update, Boolean(preferences.workspace.panels[panelId]?.visible));
		setSettings(next.settings);
		run(() => controller.actions.preferences.setPanelVisibility(panelId, next.panelVisible));
	};
	const changePlaybackMeterSettings = meterSettingsChange('playback-meter', playbackMeterSettings, setPlaybackMeterSettings);
	const changeRecordingMeterSettings = meterSettingsChange('recording-meter', recordingMeterSettings, setRecordingMeterSettings);
	const toolbarProps = {
		actionRuntime: parityRuntime.actions, menus: applicationMenus, automationToolEnabled, blocked, capabilities, controller, copy, durationFrames, locale, productId,
		editItems, executeEdit, isCompact: isCompact || compactLayout, onGripperMouseDown: handleToolbarGripperMouseDown, onJumpToEnd: jumpToEnd,
		onJumpToStart: jumpToStart, onOpenSpectralSelection: openSpectralSelection,
		onOpenTakeCycleRecovery: () => openSurface('take-cycle-recovery'), onOpenTimedRecording: openTimedRecording,
		onPlaybackMeterSettingsChange: changePlaybackMeterSettings, onRecordingMeterSettingsChange: changeRecordingMeterSettings,
		onToggleAutomationTool: toggleAutomationTool, onToggleSplitTool: toggleSplitTool, playbackMeterSettings, recordLabel, recordingMeterSettings, run, snapshot,
		toggleRecording, toolbarButtons: toolbarButtonPreferences, toolbars: toolbarPreferences, uiFlags, zoomProject, toolbarDock, onToolbarDock: setToolbarDock,
	};
	const overlayModel = createWorkspaceOverlayModel({
		activeSurface, applicationMenus, aboutLabel, capabilities, closeNyquist,
		controller, copy, dialog, displayAudioSupported, dialogTrackId, dialogValue,
		effectWindows, editBlocked, fileService, confirmFileSizeWarning, generatorType, locale, macroDraft,
		nyquistTarget, preferences, preferencesPage, projectBinEffectivelyOpen, productId,
		run, scapeOpenDecision, setActiveSurface, setDialog, setDialogValue,
		closeEffectWindow, setMacroDraft, selectedMediaPreparation, settleScapeOpenDecision,
		showArmControls, soundscaperWorkflow, snapshot, toggleWorkspacePanel,
	});

	return <AudioEditorWorkspaceView model={{
		activateSearchEntry, assistanceSearchRuntime, confirmFileSizeWarning,
		aup4Compatibility,
		aup4InputRef,
		automationToolEnabled,
		blocked,
		chromeDrawer, compactLayout, dismissWebFileLimitPrompt,
		clipPropertiesFocusRequest,
		desktopChrome,
		draggedWorkspacePanelId,
		durationFrames,
		editBlock,
		editorOverlayTarget,
		editorRef,
		editorThemeVariables,
		effectsPanelTarget,
		executeEdit,
		floatingToolbarPosition,
		floatingToolbarRef,
		cueImportDialog, importInputRef,
		importRoutedFiles,
		isCompact,
		isFullscreen,
		isVideoEditorWorkspace,
		legacyDataInputRef,
		moveWorkspacePanel,
		onError,
		openEffects,
		openProjectFile,
		openSurface,
		parityRuntime,
		pendingLegacyProjectRef,
		playbackMeterSettings,
		project,
		runtimeProject,
		recordingMeterSettings,
		revealProjectBin,
		saveText,
		searchEntries,
		setDraggedWorkspacePanelId,
		setEditorOverlayTarget,
		setEffectWindow,
		setPlaybackMeterSettings: changePlaybackMeterSettings,
		setRecordingMeterSettings: changeRecordingMeterSettings,
		setShowArmControls,
		statusMessage,
		statusState,
		statusError,
		timelineSearchReveal,
		toggleFullscreen,
		toggleSplitTool,
		uploadClipToFreesound,
		toolbarButtonPreferences,
		toolbarDock,
		setToolbarDock, toolbarProps, trackHeaderDrawer,
		uiFlags,
		workspaceRef,
		overlayModel,
		clearError,
		localError, webFileLimitPrompt,
	}} />;
}
