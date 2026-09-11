// @ts-check
import { createCaptureComposition } from './controller/capture/capture-composition.ts';
import { startController } from './controller/composition/controller-startup.ts';
import { createControllerResources } from './controller/composition/controller-resources.ts';
import { bindSessionHistoryAdmission } from './controller/document/session-history-admission.ts';
import { createControllerDisposal } from './controller/composition/controller-disposal.ts';
import { createControllerBindings } from './controller/composition/controller-bindings.ts';
import { createControllerDocumentState, createControllerDocumentCheckpoints } from './controller/document/document-state.ts';
import { createEffectsComposition } from './controller/effects/effects-composition.ts';
import { createClipVideoComposition } from './controller/clip-video/clip-video-composition.ts';
import { createTrackAudioComposition } from './controller/track-audio/track-audio-composition.ts';
import { createEditorExportStateAccess } from './controller/export/export-state.ts';
import { loadNativeEditableProject } from './controller/document/native-project-admission.ts';
import { createControllerTimers } from './controller/composition/controller-timers.ts';
import { createRecordingCapturePoolBinding } from './controller/recording/recording-capture-pool-binding.ts';
import { createRecordingComposition } from './controller/recording/recording-composition.ts';
import {
	AUDIO_EDITOR_DEFAULT_PIXELS_PER_SECOND,
	AUDIO_EDITOR_MAX_PIXELS_PER_SECOND,
} from './timeline-zoom-limits.ts';
import { createAddTrackCommand } from './commands.js';
import { createAudioEditorEffectPresets, listAudioEditorEffectPresets } from './effect-presets.js';
import { audioSelectionEffectTypes } from './effects.js';
import { createControllerPresentationState } from './controller/composition/presentation-state.ts';
import { selectAudioEditorControllerEditBlock } from './edit-blocking.ts';
import { AUDIO_EDITOR_DEFAULT_SHORTCUTS, createAudioEditorPreferencesV1 } from './preferences.js';
import {
	AUDIO_EDITOR_SAMPLE_RATE,
	EDITOR_TIMELINE_MINIMUM_SECONDS,
	createStableId,
	findClip,
	findSource,
	findTrack,
	projectEnvelope,
} from './project.js';
import { AUDIO_EDITOR_TRACK_COLORS } from './project-audio-factory.js';
import { verifyProjectFallbackIntegrity } from './project-fallback-integrity.ts';
import {
	editorHistoryProjects,
	evictUnreferencedSourceCaches,
} from './retention.js';

import { productProfile } from '../products.js';
import { assertPlayAtSpeedStaffPadMemorySafe } from './engine.js';
import {
	RECORDING_INPUT_GAIN_DEFAULT,
	createRecordingController,
} from './recording.js';
import { RECORDING_DEFAULT_DEVICE_ID, recordingRoutingSettingKey } from './recording-routing.js';
import { createEbuR128MeterNode } from './ebu-r128-node.js';
import { acquireProjectLock } from './project-lock.js';
import { ENGLISH_COPY } from '../i18n/catalogs.js';
import { normalizeBcp47Locale } from '../i18n/locale.js';
import { EditorControllerLifetime, EditorProjectGeneration, isEditorDisposedError } from './controller/shared/lifecycle.ts';
import { deferredArchiveRuntime } from './controller/document/deferred-archive-runtime.ts';
import { connectControllerNativeRenderInput } from './controller/composition/native-render-input-composition.ts';
import { createAnalysisComposition } from './controller/analysis/analysis-composition.ts';
import { resolveProductCompositionDecision } from './controller/composition/product-composition-policy.ts';
import { createControllerActionComposition } from './controller/composition/controller-action-composition.ts';
import { productActionRuntime } from './controller/composition/product-action-runtime.ts'; import { createScapeProjectFileService } from './controller/document/scape-project-file-service.ts'; import { bindSoundscaperPersistentDeliveryRuntime } from './controller/export/soundscaper-persistent-delivery-runtime-binding.ts';

import { createControllerProjectQueries, createResolvedCommandProjectReader } from './controller/composition/controller-project-queries.ts';
import { createPreferencesComposition } from './controller/preferences/preferences-composition.ts';
import { createControllerSoundActivationPolicy } from './controller/recording/sound-activation-controller-composition.ts';
import { createDocumentComposition } from './controller/document/document-composition.ts';
import { createProjectBootstrapComposition } from './controller/document/project-bootstrap-composition.ts';
import { createProjectLifecycleComposition } from './controller/document/project-lifecycle-composition.ts';
import { resolveControllerProjectRuntime } from './controller/document/project-runtime.ts';
import { createControllerProjectRuntimeMetrics } from './controller/document/project-runtime-metrics.ts';
import {
	createPlaybackProjectService,
} from './controller/source/playback-project-service.ts';
import { createMicrophoneMeterService } from './controller/recording/microphone-meter-service.ts';

import { createNativeProjectComposition } from './controller/document/native-project-composition.ts';
import { createDawprojectAudioDecoder } from './controller/import/dawproject-audio-decode.ts';

import { createTakeCycleOpenRecoveryAppPort } from './controller/recording/take-cycle-open-recovery-app-port.ts';

import {
	abortError,
	classifyMobile,
	formatBytes,
	formatPlaybackRate,
	historyEntrySummary,
	normalizeProjectSampleRate,
	throwIfAborted,
} from './controller/shared/app-helpers.ts';
import {
	recordingPreviewSnapshot,
	streamAudioChannelCount,
} from './controller/recording/recording-model.ts';
import { createSettingPersistence } from './controller/preferences/setting-persistence.ts';
import { createControllerStorageCapacityService } from './controller/shared/storage-capacity-runtime.ts';
import { createSnapshotComposition } from './controller/composition/snapshot-composition.ts';
import { createEditorTaskProgressCoordinator } from './controller/shared/task-progress.ts';
import { SOURCE_CHUNK_FRAMES } from './controller/source/source-audio.ts';
import { createControllerOwnedStateComposition } from './controller/composition/controller-owned-state-composition.ts';
import { createTransportComposition } from './controller/transport/transport-composition.ts';
import { createProjectAdminService } from './controller/document/project-admin-service.ts';
import { bindProjectAdministrationActions } from './controller/document/project-admin-action-binding.ts';
import { createEditComposition } from './controller/edit/edit-composition.ts';
import { createImportComposition } from './controller/import/import-composition.ts';
import { createSourceRuntimeComposition } from './controller/source/source-runtime-composition.ts';

import { calculateAudioEditorMetronomeSchedule } from './controller/transport/transport-model.ts';

export { calculateAudioEditorMetronomeSchedule } from './controller/transport/transport-model.ts';
/** @param {Element | null} [_root] @param {import("./controller/composition/controller-options.ts").ControllerOptions} [options] */
export function createAudioEditorController(_root = null, options = {}) {
	/** @type {ReturnType<typeof createControllerBindings<import('./engine/public-api.ts').EnginePublicApi>>} */
	const bindings = createControllerBindings({
		clips: () => clips,
		doc: () => doc,
		documentChannel: () => documentChannel,
		edits: () => edits,
		effects: () => effects,
		imports: () => imports,
		microphoneMeterService: () => microphoneMeterService,
		nativeProjectService: () => nativeProjectService,
		preferences: () => preferences,
		preferencesService: () => preferencesService,
		presentationState: () => presentationState,
		projectAdminService: () => projectAdminService,
		projectBootstrapService: () => projectBootstrapService,
		projectLockService: () => projectLockService,
		projectSwitchService: () => projectSwitchService,
		recording: () => recording,
		sources: () => sources,
		storageCapacityService: () => storageCapacityService,
		telemetryChannel: () => telemetryChannel,
		tracks: () => tracks,
		viewStateService: () => viewStateService,
	});
	const lifetime = new EditorControllerLifetime();
	const projectGeneration = new EditorProjectGeneration();
	const projectRuntime = resolveControllerProjectRuntime(options.projectRuntime);
	const { projectDurationFrames, editorTimelineDurationFrames } = createControllerProjectRuntimeMetrics(projectRuntime);
	const copy = Object.freeze({ ...ENGLISH_COPY, ...(options.copy || {}) });
	const locale = normalizeBcp47Locale(options.locale);
	const product = productProfile(options.productId || options.product?.id || 'soundscaper');
	const productId = product.id;
	const capabilities = product.capabilities; const composition = resolveProductCompositionDecision(product), absentSubsystem = Object.freeze({ productName: product.name });
	const recentProjectsSettingKey = `${productId}:audio-editor-recent-project-ids`;
	const lastProjectSettingKey = `${productId}:last-project-id`;
	/** @param {string} name */
	const productSettingKey = (name) => productId === 'soundscaper' ? name : `${productId}:${name}`;
	const {
		fileService, store, sourceBuffers, mixRenderMemoryLimitBytes, sourceChunkProviders, sourcePeaks,
		stagedProjectBinSourceIds, sessionController: rawSessionController, engine, renderEngineFactory, clipTimePitchCache,
		clipTimePitchSourceResolver, ffmpeg, nyquistClient, nyquistEvaluator, playAtSpeedPitchPreserver,
	} = createControllerResources(options, {
		copy, onPosition: updatePlayhead, onMeter: bindings.updateMeters, onState: bindings.updateTransportState,
		setStatus: bindings.setStatus, updateExportProgress: bindings.updateExportProgress,
	});
	const sessionController = bindSessionHistoryAdmission(rawSessionController, (value) => projectRuntime.createHistory(value).present);
	const currentTimeMs = typeof options.now === 'function' ? options.now : () => Date.now();
	const { scheduleTimer, clearScheduledTimer, scheduleInterval, clearScheduledInterval } = createControllerTimers(options);
	/** @type {import('./controller/document/document-state.ts').ControllerDocumentState<import('./controller/document/document-composition-types.ts').DocumentProject, import('./controller/document/document-composition-types.ts').DocumentHistory>} */
	const documentState = createControllerDocumentState();
	const { activeSelection, normalizeExportSettings } = createControllerProjectQueries({ getProject: () => documentState.project, projectSampleRate: () => projectSampleRate() });
	const { state, effectsAccess, effectsStatePorts, recordingAccess, transportAccess,
		recordingPort, reconcileRecordingRouting,
	} = createControllerOwnedStateComposition({ document: documentState,
		preferences: createAudioEditorPreferencesV1({ workspace: { activeId: product.defaultWorkspace } }),
		effectPresets: createAudioEditorEffectPresets(),
		initialEffectType: audioSelectionEffectTypes()[0],
		phase: lifetime.phase,
		readyMessage: copy.ready,
		mobile: classifyMobile(),
		defaultPixelsPerSecond: AUDIO_EDITOR_DEFAULT_PIXELS_PER_SECOND,
		timelineMinimumSeconds: EDITOR_TIMELINE_MINIMUM_SECONDS,
		recordingInputGain: RECORDING_INPUT_GAIN_DEFAULT,
		preferredInputDeviceId: RECORDING_DEFAULT_DEVICE_ID,
	});
	const takeCycleOpenRecoveryBinding = createTakeCycleOpenRecoveryAppPort(), takeCycleOpenRecovery = takeCycleOpenRecoveryBinding.port;
	const soundActivationPolicyService = createControllerSoundActivationPolicy(state, bindings.updatePreferences, publishDocumentSnapshot);
	const storageCapacityService = createControllerStorageCapacityService({
		store, state,
		isInactive: () => lifetime.inactive || state.disposed,
		publish: publishDocumentSnapshot,
		copy: {
			storageOperationRecording: copy.storageOperationRecording,
			storageOperationExport: copy.storageOperationExport,
			storageOperationEffect: copy.storageOperationEffect, storageOperationProject: copy.storageOperationProject,
			storageOperationImport: copy.storageOperationImport,
			insufficientStorage: copy.insufficientStorage,
			formatBytes,
		},
	});
	const playbackProjectService = options.playbackProjectService
		|| createPlaybackProjectService(product.capabilities, product.id);
	/** @type {ReturnType<typeof createClipVideoComposition>['videoNavigation'] | null} */
	let videoNavigationService = null;
	/** @type {ReturnType<typeof import('./controller/capture/framescaper-capture-app-binding.ts').createFramescaperCaptureAppBinding> | null} */
	let framescaperCapture = null;
	const framescaperCaptureRuntime = options.framescaperCaptureRuntime ?? null;
	const framescaperCaptureAdminInterlock = framescaperCaptureRuntime?.createAdminInterlock() ?? null;
	const mediaDevices = options.mediaDevices || globalThis.navigator?.mediaDevices;
	/** @type {Parameters<typeof createSnapshotComposition>[0]['document']} */
	const documentSnapshotRuntime = {
		state, product, productId, capabilities, locale, projectForPlayback: (candidate) => playbackProjectService.projectForPlayback(candidate).project,
		getCurrentProject: () => state.history?.present ?? null,
		getProjectTabs: () => sessionController.getSnapshot().tabs,
		getCurrentTabMetadata: (projectId) => bindings.sessionTab(projectId)?.metadata || {},
		recordingPreviewSnapshot,
		getSoundActivationSnapshot: soundActivationPolicyService.getSnapshot,
		sampleEditingAvailable: bindings.sampleEditingAvailable,
		canUndo: projectRuntime.canUndo,
		canRedo: projectRuntime.canRedo,
		historyEntrySummary,
		getStorageStatus: () => store.getStatus?.() || {
			state: 'indexeddb',
			backend: 'indexeddb',
			persistent: true,
			ephemeral: false,
			degradedReason: null,
		},
		getVideoNavigationSnapshot: () => !state.disposed && documentState.project && capabilities.videoCompositing && videoNavigationService ? videoNavigationService.view() : null,
		getFramescaperCaptureSnapshot: () => framescaperCapture?.snapshot ?? null, getFramescaperWebVcrSnapshot: () => framescaperCapture?.webVcrSnapshot ?? null,
		getSelectionEffectParams: bindings.currentAudacityEffectParams,
	};
	const { document: documentChannel, telemetry: telemetryChannel } = createSnapshotComposition({
		document: documentSnapshotRuntime, telemetry: state, audioDevices: state, engine, mediaDevices, copy,
		videoEffectGestures: state.videoEffectGestures, videoEffectGestureKey: bindings.videoEffectGestureKey,
	});
	/** @type {((value: number) => void) | null} */
	let persistentExportProgressObserver = null;
	const taskProgress = createEditorTaskProgressCoordinator({ onChange: (progress) => {
		state.taskProgress = progress; if (progress?.kind === 'export' && typeof progress.value === 'number') persistentExportProgressObserver?.(progress.value); publishTelemetrySnapshot();
	} });
	const presentationState = createControllerPresentationState({ state, copy, publishDocument: publishDocumentSnapshot, publishTelemetry: publishTelemetrySnapshot, updateTaskProgress: (value) => taskProgress.updateActive(value) });
	const settingPersistence = createSettingPersistence({
		write: (key, value) => store.saveSetting(key, value),
		isInactive: () => state.disposed,
		onWarning: (error) => bindings.handleError(error),
	});
	const persistSetting = settingPersistence.persist;
	const recordingCapturePool = createRecordingCapturePoolBinding({
		pool: options.recordingCapturePool, mediaDevices, onChange: bindings.handleRecordingPoolChange,
	});
	const recordingControllerFactory = options.recordingControllerFactory || createRecordingController;
	const acquireLock = options.acquireProjectLock || acquireProjectLock;
	const microphoneMeterService = createMicrophoneMeterService({
		state: recordingAccess,
		defaultDeviceId: RECORDING_DEFAULT_DEVICE_ID,
		recordingCapturePool,
		getAudioContext: () => engine.getAudioContext({ resume: true }),
		createLoudnessMeterNode: createEbuR128MeterNode,
		streamAudioChannelCount,
		projectSampleRate: () => projectSampleRate(),
		persistSetting,
		publishDocumentSnapshot,
		publishTelemetrySnapshot,
		syncRecordingPoolSnapshot: bindings.syncRecordingPoolSnapshot,
		handleError: bindings.handleError,
		scheduleInterval,
		clearInterval: clearScheduledInterval,
		playbackLoudness: {
			pause: () => engine.pauseLoudnessMeasurement?.(),
			continue: () => engine.continueLoudnessMeasurement?.(),
			reset: () => engine.resetLoudnessMeasurement?.(),
		},
	});
	let removeDeviceChangeListener = () => {};
	const getCommandProject = createResolvedCommandProjectReader(() => documentState.project, (project) => projectRuntime.projectForCommandConsumers(project));
	/** @type {ReturnType<typeof createSourceRuntimeComposition<import('./engine/public-api.ts').EnginePublicApi>>} */
	const sources = createSourceRuntimeComposition({
		state, playbackCacheState: transportAccess, copy, lifetime, projectGeneration, store, engine, sourceBuffers, sourceChunkProviders, sourcePeaks,
		timePitchCache: clipTimePitchCache, sourceResolver: clipTimePitchSourceResolver, createRenderEngine: (renderOptions) => renderEngineFactory(renderOptions),
		playbackProjects: playbackProjectService, resolveProductVideoPreviewMedia: options.resolveProductVideoPreviewMedia, projectDurationFrames,
		getProject: () => documentState.project, publishDocumentSnapshot, setStatus: bindings.setStatus, handleError: bindings.handleError,
	});
	const preferences = createPreferencesComposition({
		productId, defaultWorkspace: product.defaultWorkspace, state, lifetime, copy,
		loadSetting: (key, fallback) => store.loadSetting(key, fallback), persistSetting, publish: publishDocumentSnapshot,
	});
	const preferencesService = preferences.service;
	const {
		activatePanelTabPreference, createWorkspacePreference, deleteWorkspacePreference, movePanelPreference, moveToolbarPreference,
		setPanelDockExtentPreference, setPanelFrameSizePreference, setPanelPreference, setPanelVisibilityPreference, setShortcutPreference, setToolbarButtonPreference, setWorkspacePreference,
		togglePanelPreference, toggleToolbarPreference, updateWorkspacePreference,
	} = preferences.actions;
	const doc = createDocumentComposition({
		state, copy, lifetime, projectGeneration, projectRuntime, product, capabilities, session: sessionController, store, engine, sourceBuffers, sourcePeaks,
		timePitchCache: clipTimePitchCache, protectedSourceIds: stagedProjectBinSourceIds, maximumPixelsPerSecond: AUDIO_EDITOR_MAX_PIXELS_PER_SECOND,
		settingKeys: { recentProjects: recentProjectsSettingKey, lastProject: lastProjectSettingKey }, scheduleTimer, clearTimer: clearScheduledTimer,
		prepareProjectSnapshot: options.prepareProjectSnapshot, sources,
		getProject: () => documentState.project, setProject: (value) => { documentState.project = value; },
		getHistory: () => state.history, setHistory: (history) => { state.history = history; },
		projectDurationFrames, editorTimelineDurationFrames, projectSampleRate: () => projectSampleRate(), persistSetting, preflightStorage: bindings.preflightStorage,
		garbageCollectSources: bindings.garbageCollectSources, refreshStorageUsage: bindings.refreshStorageUsage, editingBlocked,
		assertEditingAllowed: () => { if (documentState.project) framescaperCapture?.assertOriginEditAllowed(documentState.project.id); },
		updatePlayhead, synchronizeAutomaticSampleEditMode: bindings.synchronizeAutomaticSampleEditMode, synchronizeMicrophoneMeterTarget: bindings.synchronizeMicrophoneMeterTarget, stopProjectBinPreview: bindings.stopProjectBinPreview,
		reconcileRecordingRouting,
		persistRecordingRouting: bindings.persistRecordingRouting, publishDocumentSnapshot, handleError: bindings.handleError,
	});
	const projectAdminService = createProjectAdminService({
		cancelPlaybackCachePreparation: bindings.cancelPlaybackCachePreparation,
		clearScheduledTimer: globalThis.clearTimeout.bind(globalThis),
		clearWaveformPcmWindows: bindings.clearWaveformPcmWindows,
		clipTimePitchCache, commit: bindings.commit, copy, currentTimeMs, editorHistoryProjects, engine,
		evictUnreferencedSourceCaches, flushProject: bindings.flushProject, getProject: () => documentState.project, getRecordingRouting: recordingPort.getRouting, handleError: bindings.handleError,
		liveSessionClipIds: bindings.liveSessionClipIds, liveSessionLinkedOriginalSourceReferences: doc.retention.liveSessionLinkedOriginalSourceReferences, liveSessionSourceIds: bindings.liveSessionSourceIds, newProject: bindings.newProject, openProject: bindings.openProject, persistSetting,
		projectGeneration, projectSaveService: doc.saves, projectMaintenanceRuntime: options.projectMaintenanceRuntime, projectSessionService: doc.session, publishDocumentSnapshot,
		recordingRoutingSettingKey, releaseProjectLock: bindings.releaseProjectLock, revokeVideoVisuals: bindings.revokeVideoVisuals, saveNow: bindings.saveNow,
		scheduleTimer: globalThis.setTimeout.bind(globalThis), sessionController, sessionTab: bindings.sessionTab,
		setProject: (nextProject) => { documentState.project = nextProject; },
		disposeRenderEngines: sources.timePitchCaches.disposeRenderEngines, sourceBuffers, sourceChunkProviders, sourcePeaks, state, stopProjectBinPreview: bindings.stopProjectBinPreview, stopRecording: bindings.stopRecording, store,
		switchProject: bindings.switchProject, ...(framescaperCaptureAdminInterlock ? { beginCaptureInterlockedAdminOperation: framescaperCaptureAdminInterlock.beginAdminOperation } : {}),
	});
	const { prepareProjectHandoff, assertProjectHandoffAllowed, closeProjectTab, deleteProject, clearLocalData } =
		bindProjectAdministrationActions(projectAdminService, () => documentState.project, () => framescaperCapture);
	const analysisService = createAnalysisComposition({
		enabled: composition.analysis, productName: product.name, state, copy, lifetime, projectGeneration, store, taskProgress,
		getProject: () => documentState.project, getActiveSelection: activeSelection, projectDurationFrames,
		cloneProject: projectRuntime.cloneProject, projectSampleRate: () => projectSampleRate(), sourceBuffers, hasMissingTimelineSources: bindings.hasMissingTimelineSources,
		renderSnapshot: (...args) => renderSnapshot(...args), showAnalysis: bindings.showAnalysis, setStatus: bindings.setStatus, publish: publishDocumentSnapshot, handleError: bindings.handleError,
	});
	const unsubscribeParametricEqErrors = typeof engine.subscribeParametricEqErrors === 'function'
		? engine.subscribeParametricEqErrors((error) => bindings.handleError(error))
		: () => {};
	const { inspectScape, openScapeFile, scapeInspectionQuiescence } = createScapeProjectFileService({ lifetime, store, openScape: bindings.openScape, productCapabilities: product.capabilities, currentProjectSchemaFamily: product.id, inspectScapeProject: options.scapeProjectRuntime?.inspectScapeProject, scapeInspectionQuiescenceOptions: options.scapeInspectionQuiescenceOptions });
	const { locking: projectLockService, projects: projectSwitchService } = createProjectLifecycleComposition({
		locking: {
			state, cancelTask: (...args) => lifetime.cancelTask(...args),
			getProjectId: () => documentState.project?.id ?? null,
			getProjectMetadata: (projectId) => bindings.sessionTab(projectId)?.metadata || {},
			acquireProjectLock: acquireLock,
			setProjectReadOnly: (projectId, update) => sessionController.setProjectReadOnly(projectId, update),
			publishProjectState: bindings.publishProjectState,
			setStatus: bindings.setStatus,
			handleError: bindings.handleError,
			invalidateRecordingAuthority: bindings.invalidateTakeCycleRecording, revokeWriteAuthority: () => effects.rack.revokeWriteAuthority(),
			copy,
		},
		projects: {
			state, effectsState: effectsStatePorts.project, lifetime, scapeInspectionQuiescence, projectGeneration, copy, productCapabilities: product.capabilities,
			getProject: () => documentState.project,
			setProject: (nextProject) => { documentState.project = nextProject; },
			createProject: projectRuntime.createProject,
			normalizeProjectSampleRate,
			createInitialAudioTrackCommand: createAddTrackCommand,
			createHistory: projectRuntime.createHistory,
			executeCommand: projectRuntime.executeCommand,
			loadProject: projectRuntime.loadProject,
			playbackProjectService,
			verifyProjectFallbackIntegrity: (activeProject, verifyOptions) => verifyProjectFallbackIntegrity(activeProject, store, verifyOptions),
			assignPreferredInputToTrack: (trackId) => assignPreferredInputToTrack(trackId),
			cancelTimedRecording: bindings.cancelTimedRecording,
			cancelRecordingStart: bindings.cancelRecordingStart,
			cancelPlaybackCachePreparation: bindings.cancelPlaybackCachePreparation,
			cancelPlayAtSpeedPreparation: () => cancelPlayAtSpeedPreparation(),
			stopRecording: bindings.stopRecording,
			persistActiveSessionUiState: bindings.persistActiveSessionUiState,
			saveNow: bindings.saveNow,
			cancelScheduledSave: doc.saves.cancelScheduled,
			stopEngine: () => engine.stop(), stopProjectBinPreview: bindings.stopProjectBinPreview, disposeRenderEngines: sources.timePitchCaches.disposeRenderEngines,
			beginSourceChunkProviderReplacement: () => sourceChunkProviders.beginReplacement(),
			cancelEffectPreview: bindings.cancelAudacityEffectPreview,
			sessionTab: bindings.sessionTab,
			session: sessionController,
			loadRecordingRouting: bindings.loadRecordingRouting,
			restoreProjectSelection: doc.session.restoreProjectSelection,
			revokeOutputUrl: (url) => URL.revokeObjectURL(url),
			revokeVideoVisuals: bindings.revokeVideoVisuals,
			clearWaveformPcmWindows: bindings.clearWaveformPcmWindows,
			loadProjectSources: bindings.loadProjectSources, prepareRequiredProjectSources: sources.sourceLifecycle.prepareRequiredProjectSources,
			retainLiveClipIds: doc.retention.retainLiveClipIds,
			evictUnreferencedSourceCaches: () => evictUnreferencedSourceCaches(
				sourceBuffers, sourcePeaks, doc.retention.liveSessionSourceIds(),
			),
			loadEngineProject: (activeProject, transientBuffers, preparedSources) => engine.loadProject(activeProject, preparedSources?.sourceBuffers
					?? (transientBuffers?.size ? new Map([...sourceBuffers, ...transientBuffers]) : sourceBuffers), { chunkSources: preparedSources?.chunkSources ?? sourceChunkProviders }), openRecovery: takeCycleOpenRecovery,
			recordOpenedProject: (projectId, guard) => doc.session.recordOpenedProject(projectId, guard), maintainOpenedProject: (projectId, isCurrentWritable) => store.maintainOpenedProject?.(projectId, () => isCurrentWritable() ? doc.retention.liveSessionLinkedOriginalSourceReferences() : null),
			createProjectIfAbsent: options.createProjectIfAbsent,
			saveProject: (activeProject) => store.saveProject(activeProject, { protectedLinkedOriginalSourceReferences: doc.retention.liveSessionLinkedOriginalSourceReferences() }),
			listProjects: () => store.listProjects(),
			synchronizeMicrophoneMeterTarget: bindings.synchronizeMicrophoneMeterTarget,
			publishProjectState: bindings.publishProjectState,
			garbageCollectSources: bindings.garbageCollectSources,
			setStatus: bindings.setStatus,
			isDisposedError: isEditorDisposedError,
			clearSourceCaches: async () => {
				sourceBuffers.clear(); sourceChunkProviders.clear(); sourcePeaks.clear();
				await sourceChunkProviders.drain();
			},
		},
	});
	const projectBootstrapService = createProjectBootstrapComposition({
		state, effectsState: effectsStatePorts.bootstrap, recordingState: recordingAccess, transportState: transportAccess, lifetime, store, engine, mediaDevices, productSettingKey,
		automaticAudioDeviceEnumeration: capabilities.audioRecording === true,
		loadPreferences: bindings.loadPreferences,
		createEffectPresets: createAudioEditorEffectPresets,
		refreshAudioDevices: bindings.refreshAudioDevices,
		setRemoveDeviceChangeListener: (remove) => { removeDeviceChangeListener = remove; },
		loadRecentProjectState: (guard) => doc.session.loadRecentProjectState(guard), getStartupPreferences: () => state.preferences?.startup,
		openProject: (savedProject) => projectSwitchService.openProject(savedProject),
		newProject: () => projectSwitchService.newProject(), openRecovery: takeCycleOpenRecovery,
		publishProjectState: bindings.publishProjectState,
		saveNow: bindings.saveNow,
		refreshStorageUsage: bindings.refreshStorageUsage,
		hasMissingTimelineSources: bindings.hasMissingTimelineSources,
		setStatus: bindings.setStatus,
		handleError: bindings.handleError,
		isDisposed: () => state.disposed,
		copy,
	});
	const nativeProjectService = createNativeProjectComposition({
		lifetime, projectGeneration, state, copy, store, fileService, taskProgress,
		getProject: () => documentState.project,
		switchProject: bindings.switchProject,
		editingBlocked,
		flushProject: bindings.flushProject,
		hasMissingTimelineSources: bindings.hasMissingTimelineSources,
		estimateStorageForPreflight: bindings.estimateStorageForPreflight, preflightStorage: bindings.preflightStorage,
		projectFileExtension: product.projectFileExtension, currentProjectSchemaFamily: product.id,
		initialAup4Client: options.aup4Client || null,
		aup4Options: options.aup4 || {}, adaptAudacityProject: options.adaptAudacityProject,
		prepareAudacityProjectExport: options.prepareAudacityProjectExport, loadProject: (value) => loadNativeEditableProject(projectRuntime, value),
		importScapeProject: options.scapeProjectRuntime?.importScapeProject || deferredArchiveRuntime.importScapeProject,
		exportScapeProject: options.scapeProjectRuntime?.exportScapeProject || deferredArchiveRuntime.exportScapeProject,
		copyFutureScapeArchive: options.scapeProjectRuntime?.copyScapeArchive,
		sessionTab: bindings.sessionTab,
		updateProjectMetadata: (projectId, metadata) => sessionController.updateProjectMetadata(projectId, metadata),
		setStatus: bindings.setStatus,
		publishDocumentSnapshot,
		sourceBuffers,
		decodeAudioFile: createDawprojectAudioDecoder({ engine, ffmpeg, copy }), product,
	});
	const captureComposition = createCaptureComposition(framescaperCaptureRuntime, captureRuntime => ({
		proxy: {
			createScheduler: options.createFramescaperCaptureProxyScheduler, runtime: ffmpeg,
			helperTimingProbe: fileService.helperTimingProbe,
			saves: { getActiveProjectId: () => documentState.project?.id ?? null, hasUnsavedProjectChanges: () => Boolean(documentState.project && bindings.sessionTab(documentState.project.id)?.dirty), saves: doc.saves },
			activeProject: { getActiveProject: () => documentState.project, installActiveProject: captureRuntime.createProxyDocumentInstaller({ runtime: projectRuntime, setHistory: value => { state.history = value; }, synchronizeProject: bindings.applyProjectToPlaybackEngine }), publishProjectState: bindings.publishProjectState },
		},
		derivatives: {
			getOriginProject: async (projectId) => bindings.sessionTab(projectId)?.history?.present ?? store.loadProject(projectId), store,
			activateStoredSource: (source, metadata, activationOptions) => bindings.activateStoredSource(source, metadata, activationOptions),
			activateVideoSource: (source) => findSource(documentState.project, source.id) ? sources.projectVisual.activateVideoSource(source) : undefined,
		},
		authority: {
			getProjectAdmission: (projectId) => { const tab = bindings.sessionTab(projectId); return tab ? { readOnly: Boolean(tab.readOnly), intrinsicReadOnly: Boolean(tab.metadata?.intrinsicReadOnly || tab.metadata?.declaredReadOnly || tab.metadata?.featureRequirementsReadOnly) } : null; },
			getActiveProjectId: () => documentState.project?.id ?? null, getActiveReadOnly: () => state.readOnly,
			getActiveLock: () => state.projectLock, acquireProjectLock: (projectId) => acquireLock(projectId),
		},
		app: {
			productId,
			schemaFamily: 'framescaper', schemaVersion: 1,
			isDesktop: Boolean(fileService.isDesktop), embedded: globalThis.document?.documentElement?.dataset?.embedded === 'true',
			store, mediaDevices, getActivePlayheadFrame: () => state.positionFrame,
			...captureRuntime.createDocumentPorts({ adminInterlock: framescaperCaptureAdminInterlock, session: sessionController, runtime: projectRuntime,
				getProject: () => documentState.project, getHistory: () => state.history,
				setProject: value => { documentState.project = value; }, setHistory: value => { state.history = value; },
				synchronizeProject: async value => { await bindings.applyProjectToPlaybackEngine(value); bindings.publishProjectState(); } }),
			prepareCaptureStart: async () => { await bindings.flushProject(); },
			getAudioContext: () => engine.getAudioContext({ resume: false }),
			createStream: options.createStream, MediaRecorder: options.MediaRecorder,
			MediaStreamTrackProcessor: options.MediaStreamTrackProcessor,
			recordingControllerFactory: captureRuntime.adaptRecordingControllerFactory(options.recordingControllerFactory), AudioWorkletNode: options.AudioWorkletNode,
			helperTimingProbe: fileService.helperTimingProbe, ffmpeg,
			desktopBridge: globalThis.framescaperCaptureDesktop?.v1 ?? null, webVcrBridge: globalThis.framescaperWebVcr?.v1 ?? null, webVcrEnabled: product.applicationFeatures?.framescaperWebVcr === true, showWebVcrPanel: () => { void preferencesService.setPanelVisibility('web-vcr', true).catch(bindings.handleError); }, hideWebVcrPanel: () => { void preferencesService.setPanelVisibility('web-vcr', false).catch(bindings.handleError); },
			createId: createStableId, now: currentTimeMs,
			onWarning: bindings.handleError, onChange: publishDocumentSnapshot,
		},
	}));
	framescaperCapture = captureComposition.binding;
	const framescaperCaptureProxyScheduler = captureComposition.proxyScheduler;
	const ready = startController({
		lifetime, state, bootstrap: bindings.bootstrap, initializeCapture: () => framescaperCapture?.initialize(),
		getSnapshot: bindings.getSnapshot, publish: publishDocumentSnapshot,
		startMicrophoneMeter: () => bindings.setMicrophoneMetering(true), handleError: bindings.handleError,
	});
	const transportComposition = createTransportComposition({
		state: transportAccess, engine, copy, sampleRate: AUDIO_EDITOR_SAMPLE_RATE, maximumPixelsPerSecond: AUDIO_EDITOR_MAX_PIXELS_PER_SECOND, microphoneMeter: microphoneMeterService,
		abortError, activeSelection, assertPlayAtSpeedStaffPadMemorySafe, beginPlaybackCachePreparation: bindings.beginPlaybackCachePreparation, calculateAudioEditorMetronomeSchedule,
		cancelPlaybackCachePreparation: bindings.cancelPlaybackCachePreparation, playbackCachePreparationPending: sources.timePitchCaches.isPlaybackCachePreparationPending, cancelTimedRecording: bindings.cancelTimedRecording, commit: bindings.commit, editingBlocked, editorTimelineDurationFrames, findTrack, formatPlaybackRate,
		hasMissingTimelineSources: bindings.hasMissingTimelineSources, persistSetting, playAtSpeedPitchPreserver, productSettingKey, getProject: () => documentState.project,
		projectDurationFrames, publishDocumentSnapshot, publishProjectState: bindings.publishProjectState, publishTelemetrySnapshot, sampleEditingAvailable: bindings.sampleEditingAvailable, setSelection: bindings.setSelection, setStatus: bindings.setStatus,
		startRecording: bindings.startRecording, stopProjectBinPreview: bindings.stopProjectBinPreview, stopRecording: bindings.stopRecording, throwIfAborted,
	});
	const viewStateService = transportComposition.view;
	const {
		setPlayAtSpeedRate,
		cancelPlayAtSpeedPreparation, retireTimelinePlayback,
		handlePlayAtSpeed,
		handleTransport,
		clearLoopRegion,
		setLoopRegionToSelection,
		setLoopRegion,
		setSelectionToLoopRegion,
		setLoopRegionInOut,
		toggleSelectionFollowsLoop,
		toggleMetronome,
		stopMetronome,
		normalizeTimelineFrame,
		normalizePlaybackFrame,
		projectSampleRate,
	} = transportComposition.transport;
	const { adjustAllTrackHeights } = viewStateService;
	const clips = createClipVideoComposition({
		state, copy, lifetime, projectGeneration, projectRuntime, store, engine, ffmpeg, helperTimingProbe: fileService.helperTimingProbe, setEffectProcessing: effectsStatePorts.processing.set,
		sourceBuffers, sourcePeaks, sourceChunkFrames: SOURCE_CHUNK_FRAMES, taskProgress, currentTimeMs, monotonicNow: options.monotonicNow,
		setInterval: scheduleInterval, clearInterval: clearScheduledInterval, createVideoRetimeProgramOrdinalBridge: options.createProductVideoRetimeProgramOrdinalBridge,
		prepareCommittedOutput: (clip, source, prepareOptions) => clipTimePitchCache.prepareCommittedOutput(clip, source, prepareOptions),
		materializeTimePitchCacheEntry: (entry, signal) => sources.timePitchCaches.materializeTimePitchCacheEntry(entry, signal),
		retireSourceChunkProvider: sources.sourceLifecycle.retireSourceChunkProvider,
		getProject: () => documentState.project, getCommandProject, editingBlocked, commit: bindings.commit, publishProjectState: bindings.publishProjectState, publishDocumentSnapshot, setStatus: bindings.setStatus, handleError: bindings.handleError,
		normalizePlaybackFrame, cancelPlaybackCachePreparation: bindings.cancelPlaybackCachePreparation, cancelPlayAtSpeedPreparation, stopProjectBinPreview: bindings.stopProjectBinPreview, hasMissingTimelineSources: bindings.hasMissingTimelineSources,
		activateVideoSource: bindings.activateVideoSource, activateStoredSource: bindings.activateStoredSource, activeSelection, snapTimelineFrame: bindings.snapTimelineFrame, preflightStorage: bindings.preflightStorage, projectSampleRate, cacheSourceBuffer: bindings.cacheSourceBuffer,
	});
	videoNavigationService = clips.videoNavigation;
	const tracks = createTrackAudioComposition({
		state: transportAccess, copy, lifetime, projectGeneration, projectRuntime, controllerOptions: options, store, engine, sourceBuffers, sourceChunkProviders, sourcePeaks, setEffectProcessing: effectsStatePorts.processing.set,
		sourceResolver: clipTimePitchSourceResolver, sourceChunkFrames: SOURCE_CHUNK_FRAMES, mixRenderMemoryLimitBytes,
		defaultPixelsPerSecond: AUDIO_EDITOR_DEFAULT_PIXELS_PER_SECOND, maximumPixelsPerSecond: AUDIO_EDITOR_MAX_PIXELS_PER_SECOND, trackColors: AUDIO_EDITOR_TRACK_COLORS,
		taskProgress, microphoneMeter: microphoneMeterService,
		recording: recordingPort,
		export: {
			state: createEditorExportStateAccess(state),
			ffmpeg, fileService, playbackProjects: playbackProjectService, productName: product.name, prepareProjectForExport: options.prepareProjectForExport,
			normalizeExportSettings, toggleExport: bindings.toggleExport, updateExportProgress: bindings.updateExportProgress, setPersistentExportProgressObserver: (observer) => { persistentExportProgressObserver = observer; },
		},
		createRenderEngine: bindings.createCacheAwareRenderEngine, createPreviewEngine: (previewOptions) => renderEngineFactory(previewOptions), prepareCommittedTimePitchCaches: bindings.prepareCommittedTimePitchCaches,
		getProject: () => documentState.project, getCommandProject, editingBlocked, commit: bindings.commit, setStatus: bindings.setStatus, publishDocumentSnapshot, publishProjectState: bindings.publishProjectState, handleError: bindings.handleError, preflightStorage: bindings.preflightStorage,
		projectSampleRate, projectDurationFrames, editorTimelineDurationFrames, normalizeTimelineFrame, persistSetting, productSettingKey, activeSelection,
		activateStoredSource: bindings.activateStoredSource, cacheSourceBuffer: bindings.cacheSourceBuffer, retireSourceChunkProvider: sources.sourceLifecycle.retireSourceChunkProvider, renderDryTrackRange: bindings.renderDryTrackRange,
		hasMissingTimelineSources: bindings.hasMissingTimelineSources, updatePlayhead, updateSelection: bindings.updateSelection, synchronizeAutomaticSampleEditMode: bindings.synchronizeAutomaticSampleEditMode, updateRecordingDeviceRows: bindings.updateRecordingDeviceRows, persistRecordingRouting: bindings.persistRecordingRouting,
	});
	const {
		addTrack, addVideoTrackPair, assignPreferredInputToTrack, addLabelTrack,
		reorderTrack, moveTrack, setTrackDisplayMode, setTrackRate,
	} = tracks.trackActions;
	const { cancelPersistentAudioDelivery, exportVideo, handleExportAction, renderSnapshot } = tracks.export;
	bindSoundscaperPersistentDeliveryRuntime(options, { exportService: tracks.export, getProject: () => documentState.project, getSaveState: () => state.saveState, captureProjectGeneration: () => projectGeneration.capture(documentState.project?.id ?? null), assertProjectGeneration: (token) => projectGeneration.assertCurrent(token), deliveryReport: () => state.deliveryReport ?? null, cancelExport: cancelPersistentAudioDelivery, publishDocumentSnapshot });
	const effects = createEffectsComposition({
		state: effectsAccess, copy, locale, composition, absentSubsystem, lifetime, projectGeneration, projectRuntime, store, engine, sourceBuffers, sourcePeaks,
		taskProgress, nyquistEvaluator, getProject: () => documentState.project, getCommandProject, activeSelection, selectedTracksTimeRange: bindings.selectedTracksTimeRange, editingBlocked, setSelection: bindings.setSelection,
		persistSetting, publishDocumentSnapshot, setStatus: bindings.setStatus, preflightStorage: bindings.preflightStorage, renderSnapshot, prepareCommittedTimePitchCaches: bindings.prepareCommittedTimePitchCaches,
		createRenderEngine: bindings.createCacheAwareRenderEngine, commit: bindings.commit, cacheSourceBuffer: bindings.cacheSourceBuffer, snapTimelineFrame: bindings.snapTimelineFrame, projectDurationFrames, projectSampleRate, handleError: bindings.handleError,
	});
	const edits = createEditComposition({
		state, copy, lifetime, projectGeneration, projectRuntime, composition, absentSubsystem, session: sessionController, store, engine, setEffectProcessing: effectsStatePorts.processing.set,
		sourceBuffers, sourcePeaks, sourceChunkFrames: SOURCE_CHUNK_FRAMES, taskProgress, saveLabelFile: options.saveLabelFile, fileService, derivedSources: tracks.derivedAudio.derivedSources, updatePreferences: bindings.updatePreferences, confirmMonoConversion: options.confirmMonoConversion || (({ title, body }) => ({ accepted: typeof globalThis.confirm === 'function' ? globalThis.confirm(`${title}\n\n${body}`) : false, dontShowAgain: false })), confirmDeleteBehavior: options.confirmDeleteBehavior || (({ title, initialCloseGapBehavior }) => typeof globalThis.confirm === 'function' && globalThis.confirm(title) ? { accepted: true, deleteBehavior: 'leave-gap', closeGapBehavior: initialCloseGapBehavior } : { accepted: false }),
		effectTargets: (...args) => effects.selection.audacityEffectTargets(...args),
		persistEffectResults: (results, type, scope) => effects.result.persistAudacityEffectResults(results, type, scope),
		getProject: () => documentState.project, getCommandProject, editingBlocked, commit: bindings.commit, setStatus: bindings.setStatus, publishDocumentSnapshot, handleError: bindings.handleError, preflightStorage: bindings.preflightStorage,
		normalizeTimelineFrame, snapTimelineFrame: bindings.snapTimelineFrame, activeSelection, cacheSourceBuffer: bindings.cacheSourceBuffer, projectChanged: bindings.projectChanged, garbageCollectSources: bindings.garbageCollectSources, compactLiveSourceState: bindings.compactLiveSourceState,
	});
	const imports = createImportComposition({
		state, copy, lifetime, projectGeneration, store, engine, ffmpeg, helperTimingProbe: fileService.helperTimingProbe,
		sourceBuffers, sourceChunkProviders, sourcePeaks, sourceResolver: clipTimePitchSourceResolver, sourceChunkFrames: SOURCE_CHUNK_FRAMES,
		protectedSourceIds: stagedProjectBinSourceIds, trackColors: AUDIO_EDITOR_TRACK_COLORS, taskProgress, projectVisual: sources.projectVisual,
		createPreviewEngine: (previewOptions) => renderEngineFactory(previewOptions),
		getProject: () => documentState.project, editingBlocked, commit: bindings.commit, updateSelection: bindings.updateSelection, setStatus: bindings.setStatus, publishDocumentSnapshot, handleError: bindings.handleError, preflightStorage: bindings.preflightStorage, projectSampleRate,
		activateStoredSource: bindings.activateStoredSource, invalidateSourceRuntime: sources.sourceLifecycle.invalidateSourceRuntime, retireSourceChunkProvider: sources.sourceLifecycle.retireSourceChunkProvider,
		retireTimelinePlayback, cacheSourceBuffer: bindings.cacheSourceBuffer,
		...createControllerDocumentCheckpoints(documentState),
		switchProject: bindings.switchProject, projectChanged: bindings.projectChanged, warnEnvelope,
	});
	const recording = createRecordingComposition({
		state: recordingAccess, lifetime, projectGeneration, projectRuntime, session: sessionController, store, engine, copy, locale, mediaDevices,
		capturePool: recordingCapturePool, createRecorder: recordingControllerFactory, microphoneMeter: microphoneMeterService,
		soundActivation: soundActivationPolicyService, openRecovery: takeCycleOpenRecoveryBinding, retention: doc.retention,
		sourceBuffers, sourceChunkProviders, sourcePeaks, currentTimeMs, scheduleTimer, clearTimer: clearScheduledTimer, productSettingKey,
		getProject: () => documentState.project, setProject: (value) => { documentState.project = value; }, projectSampleRate,
		assignPreferredInputToTrack, addTrack, commit: bindings.commit, activateStoredSource: bindings.activateStoredSource, beginPlaybackCachePreparation: bindings.beginPlaybackCachePreparation, applyProjectToPlaybackEngine: bindings.applyProjectToPlaybackEngine,
		flushProject: bindings.flushProject, stopProjectBinPreview: bindings.stopProjectBinPreview, persistSetting, updatePreferences: bindings.updatePreferences, preflightStorage: bindings.preflightStorage, publishDocumentSnapshot,
		publishTelemetrySnapshot, publishProjectState: bindings.publishProjectState, updatePlayhead, updateTransportState: bindings.updateTransportState, setStatus: bindings.setStatus, handleError: bindings.handleError,
	});
	const actions = createControllerActionComposition(bindings, {
		AUDIO_EDITOR_DEFAULT_SHORTCUTS, addLabelTrack,
		addTrack, addVideoTrackPair, adjustAllTrackHeights,
		analysisService,
		cancelEffectMacro: effects.macro.cancelEffectMacro,
		capabilities,
		clearLocalData, clearLoopRegion, closeProjectTab,
		continueLoudnessMeasurement, copy,
		createStableId, createWorkspacePreference,
		deleteProject, deleteWorkspacePreference,
		engine,
		exportVideo, ffmpeg, fileService, findClip, findTrack,
		getVideoSourceVisualData: sources.projectVisual.getVideoSourceVisualData, handleEdit: edits.handleEdit,
		handleExportAction, handlePlayAtSpeed, handleTransport,
		importFiles: imports.importFiles, inspectScape,
		listAudioEditorEffectPresets,
		movePanelPreference, activatePanelTabPreference,
		moveToolbarPreference, moveTrack, normalizePlaybackFrame,
		openScapeFile, openDawproject: (file) => taskProgress.run('project-io', copy.importing, () => nativeProjectService.openDawproject(file)), saveDawproject: (saveOptions) => taskProgress.run('project-io', copy.dawprojectSaving, () => nativeProjectService.saveDawproject(saveOptions)),
		pauseLoudnessMeasurement,
		prepareProjectHandoff, assertProjectHandoffAllowed, previewAudacityEffectFromController: effects.execution.previewAudacityEffectFromController,
		product, productId: product.id, locale: options.locale, macroScriptStartedAt: () => new Date().toISOString(), getProject: () => documentState.project, projectSampleRate, beginMacroTransaction: () => doc.mutation.beginMacroTransaction(), timelineDurationFrames: () => projectDurationFrames(documentState.project),
		releaseVideoSourceVisual: bindings.revokeVideoVisual, reloadVideoSourceVisual, reportVideoPreviewPressure: options.reportProductVideoPreviewPressure || (() => undefined), canRelinkLinkedAudio: imports.projectBin.canRelinkLinkedAudio, classifyLinkedAudioRelink: imports.projectBin.classifyLinkedAudioRelink, relinkLinkedAudio: imports.projectBin.relinkLinkedAudio, canRelinkLinkedVideo: imports.projectBin.canRelinkLinkedVideo, classifyLinkedVideoRelink: imports.projectBin.classifyLinkedVideoRelink, relinkLinkedVideo: imports.projectBin.relinkLinkedVideo,
		reorderTrack,
		requestStoragePersistence: storageCapacityService.requestStoragePersistence,
		resetLoudnessMeasurement,
		setLoopRegion, setLoopRegionInOut,
		setLoopRegionToSelection, setPanelDockExtentPreference, setPanelFrameSizePreference, setPanelPreference, setPanelVisibilityPreference,
		setPlayAtSpeedRate,
		setExactSelection: tracks.selectionView.setExactSelection, setSelectionToLoopRegion, setShortcutPreference,
		effectSelectionService: effects.selection, effectLibraryState: effectsAccess, effectPreviewState: effectsStatePorts.preview,
		setToolbarButtonPreference, setTrackDisplayMode, setTrackRate,
		setWorkspacePreference,
		startTakeCycleRecording: () => recording.session.startTakeCycleRecording(),
		state, cleanupDisposableStorage: storageCapacityService.cleanupDisposableStorage, cleanupDerivativeCache: storageCapacityService.cleanupDerivativeCache,
		store, persistSetting, publishDocumentSnapshot,
		toggleMetronome, togglePanelPreference,
		toggleSelectionFollowsLoop,
		recoverTakeCycleRecording: (pending) => takeCycleOpenRecovery.resolve(pending, 'recover'), discardTakeCycleRecording: (pending) => takeCycleOpenRecovery.resolve(pending, 'discard'),
		toggleStretchToTempo: clips.clipProperty.toggleStretchToTempo,
		toggleToolbarPreference,
		selectionViewService: tracks.selectionView, sequenceTimingService: clips.sequenceTiming, timelineAnnotationService: doc.timelineAnnotation, regularIntervalAnnotationController: doc.regularIntervalAnnotation, trackFolderService: doc.trackFolder, trackStructuralOperations: tracks.track.structuralOperations, soundActivationPolicyService,
		audioWarpService: tracks.audioWarp, sourceMonitorService: clips.sourceMonitor, takeCompService: tracks.takeComp, taskProgress, videoTrimServices: clips.videoTrim, videoEditService: clips.videoEdit, videoNavigationService, videoSourceReprobeService: clips.videoSourceReprobe, framescaperCaptureActions: framescaperCapture ? { ...framescaperCapture.actions, openSetup: () => { framescaperCapture.actions.openSetup(); void preferencesService.setPanelVisibility('recording-setup', true).catch(bindings.handleError); } } : undefined, framescaperWebVcrActions: framescaperCapture?.webVcrActions, ...productActionRuntime(options),
		updateWorkspacePreference,
	}, () => lifetime.assertActive());
	const dispose = createControllerDisposal({
		lifetime, state, effectsState: effectsStatePorts.runtime, clearDiagnostics: () => state.localDiagnostics.clear(), clearTaskProgress: taskProgress.clear,
		closeInspections: () => scapeInspectionQuiescence.close(lifetime.signal.reason), drainInspections: () => scapeInspectionQuiescence.drain(),
		publish: () => publishDocumentSnapshot({ force: true }), clearDocumentChannel: documentChannel.clear, clearTelemetryChannel: telemetryChannel.clear,
		removeDeviceChangeListener: () => { removeDeviceChangeListener(); removeDeviceChangeListener = () => {}; },
		disposeCapture: () => framescaperCapture?.dispose(), disposeCaptureProxy: () => framescaperCaptureProxyScheduler?.dispose?.(),
		disposeOpenRecovery: () => takeCycleOpenRecovery.dispose(), invalidateProject: () => projectGeneration.invalidate(),
		disposeVisuals: sources.projectVisual.dispose, unsubscribeEngineErrors: unsubscribeParametricEqErrors,
		cancelTimedRecording: () => bindings.cancelTimedRecording({ publish: false, status: false }), cancelRecordingStart: bindings.cancelRecordingStart,
		cancelScheduledSave: doc.saves.cancelScheduled, clearSourceGcTimer: () => globalThis.clearTimeout(state.sourceGcTimer),
		cancelPlaybackPreparation: bindings.cancelPlaybackCachePreparation, cancelPlayAtSpeedPreparation, stopMetronome,
		cancelEffectWorkers: effects.worker.cancelWorkers, disposeNyquist: () => nyquistClient?.dispose(),
		cancelEffectPreview: () => bindings.cancelAudacityEffectPreview({ publish: false }), disposeMicrophoneMeter: microphoneMeterService.dispose,
		terminalFlush: doc.saves.terminalFlush, stopRecording: bindings.stopRecording, disposeCapturePool: () => recordingCapturePool.dispose?.(),
		releaseProjectLock: bindings.releaseProjectLock, revokeOutputUrl: (url) => URL.revokeObjectURL(url), disposeProjectBin: imports.projectBin.dispose,
		disposeAudioWarp: tracks.audioWarp.dispose, disposeTakeComp: tracks.takeComp.dispose,
		disposeRenderEngines: sources.timePitchCaches.disposeRenderEngines, disposeCodec: () => ffmpeg.dispose(),
		disposeNativeProject: nativeProjectService.dispose, disposeTimePitchCache: () => clipTimePitchCache.dispose?.(),
		disposeSession: () => sessionController.dispose?.(), disposeEngine: () => engine.dispose(),
		clearSourceBuffers: () => sourceBuffers.clear(), clearSourceProviders: () => sourceChunkProviders.clear(),
		drainSourceProviders: () => sourceChunkProviders.drain(), clearSourcePeaks: () => sourcePeaks.clear(),
		clearWaveformCaches: sources.clearWaveformPcmCaches, closeStore: () => store.close?.(),
	});
	if (options.productNativeRenderInputAuthority) connectControllerNativeRenderInput(options.productNativeRenderInputAuthority, {
		lifetime, projectGeneration, getProject: () => documentState.project, cloneProject: projectRuntime.cloneProject,
		sourceBuffers, renderSnapshot, createRenderEngine: bindings.createCacheAwareRenderEngine,
		prepareCommittedTimePitchCaches: bindings.prepareCommittedTimePitchCaches,
	});

	return {
		ready,
		get project() { return state.history?.present ?? null; },
		get engine() { return engine; },
		get clipTimePitchCache() { return clipTimePitchCache; },
		get sourceBufferCacheStats() {
			return Object.freeze({
				byteLength: sourceBuffers.byteLength,
				maxBytes: sourceBuffers.maxBytes,
				entryCount: sourceBuffers.size,
			});
		},
		get headless() { return true; },
		getSnapshot: bindings.getSnapshot, captureProjectGeneration: projectGeneration.capture.bind(projectGeneration), assertProjectGeneration: projectGeneration.assertCurrent.bind(projectGeneration),
		subscribe: documentChannel.subscribe,
		getTelemetrySnapshot: bindings.getTelemetrySnapshot, subscribeTelemetry: telemetryChannel.subscribe,
		getLocalDiagnosticsSnapshot: state.localDiagnostics.snapshot, recordLocalDiagnosticError: state.localDiagnostics.record,
		getClipVisualData: bindings.getClipVisualData,
		getProjectBinClipVisualData: bindings.getProjectBinClipVisualData, selectedMediaPreparation: effects.audio.selectedMediaPreparation,
		actions,
		dispose,
	};

	function publishDocumentSnapshot({ force = false } = {}) { documentChannel.publish({ force }); }
	function publishTelemetrySnapshot() { telemetryChannel.publish(); }
	async function reloadVideoSourceVisual(/** @type {string} */ sourceId) { const source = findSource(documentState.project, sourceId); if (!source || source.kind !== 'video') throw new ReferenceError(`Video source ${String(sourceId)} is missing.`); await bindings.revokeVideoVisual(source.id); return bindings.activateVideoSource(source); }

	function pauseLoudnessMeasurement(kind = 'playback') { return microphoneMeterService.pauseLoudnessMeasurement(kind); }
	function continueLoudnessMeasurement(kind = 'playback') { return microphoneMeterService.continueLoudnessMeasurement(kind); }
	function resetLoudnessMeasurement(kind = 'playback') { return microphoneMeterService.resetLoudnessMeasurement(kind); }

	function editingBlocked() {
		return selectAudioEditorControllerEditBlock(state).blocked
			|| Boolean(framescaperCapture?.originSnapshot(documentState.project?.id ?? null).editBlocked);
	}

	function updatePlayhead(frame = 0, duration = documentState.project ? projectDurationFrames(documentState.project) : 0) {
		return viewStateService.updatePlayhead(frame, duration);
	}

	function warnEnvelope() {
		const envelope = projectEnvelope(documentState.project, { mobile: state.mobile });
		if (!envelope.supported) bindings.setStatus(copy.capacityWarning
			.replace('{trackCount}', String(envelope.limits.trackCount))
			.replace('{stereoMinutes}', String(envelope.limits.stereoMinutes)));
	}
}
