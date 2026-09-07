import { createCaptureComposition } from './controller/capture-composition.ts';
import { startController } from './controller/controller-startup.ts';
import { createControllerResources } from './controller/controller-resources.ts';
import { createControllerDisposal } from './controller/controller-disposal.ts';
import { createControllerBindings } from './controller/controller-bindings.ts';
import { createControllerDocumentState } from './controller/document-state.ts';
import { createEffectsComposition } from './controller/effects-composition.ts';
import { createClipVideoComposition } from './controller/clip-video-composition.ts';
import { createTrackAudioComposition } from './controller/track-audio-composition.ts';
import { createRecordingComposition } from './controller/recording-composition.ts';
import {
	AUDIO_EDITOR_DEFAULT_PIXELS_PER_SECOND,
	AUDIO_EDITOR_MAX_PIXELS_PER_SECOND,
} from './timeline-zoom-limits.ts';
import {
	createAddTrackCommand,
} from './commands.js';
import { createAudioEditorEffectPresets, listAudioEditorEffectPresets } from './effect-presets.js';
import { audioSelectionEffectTypes } from './effects.js';
import { createControllerPresentationState } from './controller/presentation-state.ts';
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
	createRecordingCapturePool,
	createRecordingController,
	requestDisplayInput,
	requestHardwareInput,
} from './recording.js';
import {
	RECORDING_DEFAULT_DEVICE_ID,
	normalizeRecordingRouting,
	recordingRoutingSettingKey,
} from './recording-routing.js';
import { createEbuR128MeterNode } from './ebu-r128-node.js';
import { acquireProjectLock } from './project-lock.js';
import { ENGLISH_COPY } from '../i18n/catalogs.js';
import { normalizeBcp47Locale } from '../i18n/locale.js';
import { EditorControllerLifetime, EditorProjectGeneration, isEditorDisposedError } from './controller/lifecycle.ts';
import { deferredArchiveRuntime } from './controller/deferred-archive-runtime.ts';
import { connectProductNativeRenderInputAuthority } from './controller/product-native-render-input-authority.ts'; import { renderProductNativeAudioToSink } from './controller/product-native-render-audio-stream.ts';
import { createAnalysisComposition } from './controller/analysis-composition.ts';
import { resolveProductCompositionDecision } from './controller/product-composition-policy.ts';
import { createGroupedEditorActions } from './controller/action-facade.ts';
import { guardEditorControllerActions } from './controller/controller-action-guard.ts';
import { productActionRuntime } from './controller/product-action-runtime.ts'; import { createScapeProjectFileService } from './controller/scape-project-file-service.ts'; import { bindSoundscaperPersistentDeliveryRuntime } from './controller/soundscaper-persistent-delivery-runtime-binding.ts';

import { normalizeEditorExportSettings } from './controller/export-settings.ts';
import { createPreferencesComposition } from './controller/preferences-composition.ts';
import { createControllerSoundActivationPolicy } from './controller/sound-activation-controller-composition.ts';
import { createDocumentComposition } from './controller/document-composition.ts';
import { createProjectBootstrapComposition } from './controller/project-bootstrap-composition.ts';
import { createProjectLifecycleComposition } from './controller/project-lifecycle-composition.ts';
import { resolveControllerProjectRuntime } from './controller/project-runtime.ts';
import { createControllerProjectRuntimeMetrics } from './controller/project-runtime-metrics.ts';
import {
	createPlaybackProjectService,
} from './controller/playback-project-service.ts';
import { createMicrophoneMeterService } from './controller/microphone-meter-service.ts';

import { createNativeProjectComposition } from './controller/native-project-composition.ts';
import { createDawprojectAudioDecoder } from './controller/dawproject-audio-decode.ts';

import { createTakeCycleOpenRecoveryAppPort } from './controller/take-cycle-open-recovery-app-port.ts';

import {
	abortError,
	classifyMobile,
	formatBytes,
	formatPlaybackRate,
	historyEntrySummary,
	normalizeProjectSampleRate,
	throwIfAborted,
} from './controller/app-helpers.ts';
import {
	recordingPreviewSnapshot,
	streamAudioChannelCount,
} from './controller/recording-model.ts';
import { createSettingPersistence } from './controller/setting-persistence.ts';
import { createControllerStorageCapacityService } from './controller/storage-capacity-runtime.ts';
import { createSnapshotComposition } from './controller/snapshot-composition.ts';
import { createEditorTaskProgressCoordinator } from './controller/task-progress.ts';
import {
	SOURCE_CHUNK_FRAMES,
} from './controller/source-audio.ts';
import { createEditorControllerState } from './controller/state.ts';
import { createTransportComposition } from './controller/transport-composition.ts';
import { createProjectAdminService } from './controller/project-admin-service.ts';
import { createEditComposition } from './controller/edit-composition.ts';
import { createImportComposition } from './controller/import-composition.ts';
import { createSourceRuntimeComposition } from './controller/source-runtime-composition.ts';

import { calculateAudioEditorMetronomeSchedule } from './controller/transport-model.ts';

export { calculateAudioEditorMetronomeSchedule } from './controller/transport-model.ts';

const DEFAULT_PIXELS_PER_SECOND = AUDIO_EDITOR_DEFAULT_PIXELS_PER_SECOND;
const MAX_PIXELS_PER_SECOND = AUDIO_EDITOR_MAX_PIXELS_PER_SECOND;

/** @param {Element | null} [_root] */
export function createAudioEditorController(_root = null, options = {}) {
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
	// Resolve service dependencies at invocation while preserving their owning types.
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
	const productSettingKey = (name) => productId === 'soundscaper' ? name : `${productId}:${name}`;
	const {
		fileService, store, sourceBuffers, mixRenderMemoryLimitBytes, sourceChunkProviders, sourcePeaks,
		stagedProjectBinSourceIds, sessionController, engine, renderEngineFactory, clipTimePitchCache,
		clipTimePitchSourceResolver, ffmpeg, nyquistClient, nyquistEvaluator, playAtSpeedPitchPreserver,
	} = createControllerResources(options, {
		copy, onPosition: updatePlayhead, onMeter: bindings.updateMeters, onState: bindings.updateTransportState,
		setStatus: bindings.setStatus, updateExportProgress: bindings.updateExportProgress,
	});
	const currentTimeMs = typeof options.now === 'function' ? options.now : () => Date.now();
	const scheduleTimer = typeof options.setTimeout === 'function' ? options.setTimeout : globalThis.setTimeout.bind(globalThis);
	const clearScheduledTimer = typeof options.clearTimeout === 'function' ? options.clearTimeout : globalThis.clearTimeout.bind(globalThis);
	const scheduleInterval = typeof options.setInterval === 'function' ? options.setInterval : globalThis.setInterval.bind(globalThis);
	const clearScheduledInterval = typeof options.clearInterval === 'function' ? options.clearInterval : globalThis.clearInterval.bind(globalThis);
	const documentState = createControllerDocumentState();
	const state = createEditorControllerState({ document: documentState,
		preferences: createAudioEditorPreferencesV1({ workspace: { activeId: product.defaultWorkspace } }),
		recordingRouting: normalizeRecordingRouting(),
		effectPresets: createAudioEditorEffectPresets(),
		initialEffectType: audioSelectionEffectTypes()[0],
		phase: lifetime.phase,
		readyMessage: copy.ready,
		mobile: classifyMobile(),
		defaultPixelsPerSecond: DEFAULT_PIXELS_PER_SECOND,
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
	let videoNavigationService = null, framescaperCapture = null;
	const framescaperCaptureRuntime = options.framescaperCaptureRuntime ?? null;
	const framescaperCaptureAdminInterlock = framescaperCaptureRuntime?.createAdminInterlock() ?? null;
	const mediaDevices = options.mediaDevices || globalThis.navigator?.mediaDevices;
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
	const recordingCapturePool = options.recordingCapturePool || createRecordingCapturePool({
		requestHardwareInput: (captureOptions) => requestHardwareInput({
			...captureOptions,
			deviceId: captureOptions.deviceId === RECORDING_DEFAULT_DEVICE_ID ? undefined : captureOptions.deviceId,
			mediaDevices,
		}),
		requestDisplayInput: (captureOptions) => requestDisplayInput({ ...captureOptions, mediaDevices }),
		onChange: bindings.handleRecordingPoolChange,
	});
	const recordingControllerFactory = options.recordingControllerFactory || createRecordingController;
	const acquireLock = options.acquireProjectLock || acquireProjectLock;
	const microphoneMeterService = createMicrophoneMeterService({
		state,
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
	const getCommandProject = () => projectRuntime.projectForCommandConsumers(documentState.project);
	const sources = createSourceRuntimeComposition({
		state, copy, lifetime, projectGeneration, store, engine, sourceBuffers, sourceChunkProviders, sourcePeaks,
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
		timePitchCache: clipTimePitchCache, protectedSourceIds: stagedProjectBinSourceIds, maximumPixelsPerSecond: MAX_PIXELS_PER_SECOND,
		settingKeys: { recentProjects: recentProjectsSettingKey, lastProject: lastProjectSettingKey }, scheduleTimer, clearTimer: clearScheduledTimer,
		prepareProjectSnapshot: options.prepareProjectSnapshot, sources,
		getProject: () => documentState.project, setProject: (value) => { documentState.project = value; },
		getHistory: () => state.history, setHistory: (history) => { state.history = history; },
		projectDurationFrames, editorTimelineDurationFrames, projectSampleRate: () => projectSampleRate(), persistSetting, preflightStorage: bindings.preflightStorage,
		garbageCollectSources: bindings.garbageCollectSources, refreshStorageUsage: bindings.refreshStorageUsage, editingBlocked,
		assertEditingAllowed: () => { if (documentState.project) framescaperCapture?.assertOriginEditAllowed(documentState.project.id); },
		updatePlayhead, synchronizeAutomaticSampleEditMode: bindings.synchronizeAutomaticSampleEditMode, synchronizeMicrophoneMeterTarget: bindings.synchronizeMicrophoneMeterTarget, stopProjectBinPreview: bindings.stopProjectBinPreview, persistRecordingRouting: bindings.persistRecordingRouting, publishDocumentSnapshot, handleError: bindings.handleError,
	});
	const projectAdminService = createProjectAdminService({
		cancelPlaybackCachePreparation: bindings.cancelPlaybackCachePreparation,
		clearScheduledTimer: globalThis.clearTimeout.bind(globalThis),
		clearWaveformPcmWindows: bindings.clearWaveformPcmWindows,
		clipTimePitchCache, commit: bindings.commit, copy, currentTimeMs, editorHistoryProjects, engine,
		evictUnreferencedSourceCaches, flushProject: bindings.flushProject, getProject: () => documentState.project, handleError: bindings.handleError,
		liveSessionClipIds: bindings.liveSessionClipIds, liveSessionLinkedOriginalSourceReferences: doc.retention.liveSessionLinkedOriginalSourceReferences, liveSessionSourceIds: bindings.liveSessionSourceIds, newProject: bindings.newProject, openProject: bindings.openProject, persistSetting,
		projectGeneration, projectSaveService: doc.saves, projectMaintenanceRuntime: options.projectMaintenanceRuntime, projectSessionService: doc.session, publishDocumentSnapshot,
		recordingRoutingSettingKey, releaseProjectLock: bindings.releaseProjectLock, revokeVideoVisuals: bindings.revokeVideoVisuals, saveNow: bindings.saveNow,
		scheduleTimer: globalThis.setTimeout.bind(globalThis), sessionController, sessionTab: bindings.sessionTab,
		setProject: (nextProject) => { documentState.project = nextProject; },
		disposeRenderEngines: sources.timePitchCaches.disposeRenderEngines, sourceBuffers, sourceChunkProviders, sourcePeaks, state, stopProjectBinPreview: bindings.stopProjectBinPreview, stopRecording: bindings.stopRecording, store,
		switchProject: bindings.switchProject, ...(framescaperCaptureAdminInterlock ? { beginCaptureInterlockedAdminOperation: framescaperCaptureAdminInterlock.beginAdminOperation } : {}),
	});
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
			state, lifetime, scapeInspectionQuiescence, projectGeneration, copy, productCapabilities: product.capabilities,
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
		state, lifetime, store, engine, mediaDevices, productSettingKey,
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
		prepareAudacityProjectExport: options.prepareAudacityProjectExport, loadProject: projectRuntime.loadProject,
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
	const captureComposition = createCaptureComposition(framescaperCaptureRuntime, () => ({
		proxy: {
			createScheduler: options.createFramescaperCaptureProxyScheduler, runtime: ffmpeg,
			helperTimingProbe: fileService.helperTimingProbe,
			saves: { getActiveProjectId: () => documentState.project?.id ?? null, hasUnsavedProjectChanges: () => Boolean(documentState.project && bindings.sessionTab(documentState.project.id)?.dirty), saves: doc.saves },
			activeProject: { getActiveProject: () => documentState.project, setActiveProject: (value) => { documentState.project = value; }, setActiveHistory: (value) => { state.history = value; }, applyProjectToPlaybackEngine: bindings.applyProjectToPlaybackEngine, publishProjectState: bindings.publishProjectState },
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
			productId, adminInterlock: framescaperCaptureAdminInterlock,
			schemaFamily: 'framescaper', schemaVersion: 1,
			isDesktop: Boolean(fileService.isDesktop), embedded: globalThis.document?.documentElement?.dataset?.embedded === 'true',
			store, sessionController, projectRuntime, mediaDevices,
			getActiveProject: () => documentState.project, getActiveHistory: () => state.history,
			getActivePlayheadFrame: () => state.positionFrame,
			setActiveProject: (value) => { documentState.project = value; }, setActiveHistory: (value) => { state.history = value; },
			synchronizeProject: async (value) => { await bindings.applyProjectToPlaybackEngine(value); bindings.publishProjectState(); },
			prepareCaptureStart: bindings.flushProject,
			getAudioContext: () => engine.getAudioContext({ resume: false }),
			createStream: options.createStream, MediaRecorder: options.MediaRecorder,
			MediaStreamTrackProcessor: options.MediaStreamTrackProcessor,
			recordingControllerFactory: options.recordingControllerFactory, AudioWorkletNode: options.AudioWorkletNode,
			helperTimingProbe: fileService.helperTimingProbe, ffmpeg,
			desktopBridge: globalThis.framescaperCaptureDesktop?.v1 ?? null, webVcrBridge: globalThis.framescaperWebVcr?.v1 ?? null, webVcrEnabled: product.applicationFeatures?.framescaperWebVcr === true, showWebVcrPanel: () => preferencesService.setPanelVisibility('web-vcr', true), hideWebVcrPanel: () => preferencesService.setPanelVisibility('web-vcr', false),
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
		state, engine, copy, sampleRate: AUDIO_EDITOR_SAMPLE_RATE, maximumPixelsPerSecond: MAX_PIXELS_PER_SECOND, microphoneMeter: microphoneMeterService,
		abortError, activeSelection, assertPlayAtSpeedStaffPadMemorySafe, beginPlaybackCachePreparation: bindings.beginPlaybackCachePreparation, calculateAudioEditorMetronomeSchedule,
		cancelPlaybackCachePreparation: bindings.cancelPlaybackCachePreparation, cancelTimedRecording: bindings.cancelTimedRecording, commit: bindings.commit, editingBlocked, editorTimelineDurationFrames, findTrack, formatPlaybackRate,
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
		state, copy, lifetime, projectGeneration, projectRuntime, store, engine, ffmpeg, helperTimingProbe: fileService.helperTimingProbe,
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
		state, copy, lifetime, projectGeneration, projectRuntime, controllerOptions: options, store, engine, sourceBuffers, sourceChunkProviders, sourcePeaks,
		sourceResolver: clipTimePitchSourceResolver, sourceChunkFrames: SOURCE_CHUNK_FRAMES, mixRenderMemoryLimitBytes,
		defaultPixelsPerSecond: DEFAULT_PIXELS_PER_SECOND, maximumPixelsPerSecond: MAX_PIXELS_PER_SECOND, trackColors: AUDIO_EDITOR_TRACK_COLORS,
		taskProgress, microphoneMeter: microphoneMeterService,
		export: {
			ffmpeg, fileService, playbackProjects: playbackProjectService, productName: product.name, prepareProjectForExport: options.prepareProjectForExport,
			normalizeExportSettings, toggleExport: bindings.toggleExport, updateExportProgress: bindings.updateExportProgress, setPersistentExportProgressObserver: (observer) => { persistentExportProgressObserver = observer; },
		},
		createRenderEngine: bindings.createCacheAwareRenderEngine, createPreviewEngine: (previewOptions) => renderEngineFactory(previewOptions), prepareCommittedTimePitchCaches: bindings.prepareCommittedTimePitchCaches,
		getProject: () => documentState.project, editingBlocked, commit: bindings.commit, setStatus: bindings.setStatus, publishDocumentSnapshot, publishProjectState: bindings.publishProjectState, handleError: bindings.handleError, preflightStorage: bindings.preflightStorage,
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
		state, copy, locale, composition, absentSubsystem, lifetime, projectGeneration, projectRuntime, store, engine, sourceBuffers, sourcePeaks,
		taskProgress, nyquistEvaluator, getProject: () => documentState.project, activeSelection, selectedTracksTimeRange: bindings.selectedTracksTimeRange, editingBlocked, setSelection: bindings.setSelection,
		persistSetting, publishDocumentSnapshot, setStatus: bindings.setStatus, preflightStorage: bindings.preflightStorage, renderSnapshot, prepareCommittedTimePitchCaches: bindings.prepareCommittedTimePitchCaches,
		createRenderEngine: bindings.createCacheAwareRenderEngine, commit: bindings.commit, cacheSourceBuffer: bindings.cacheSourceBuffer, snapTimelineFrame: bindings.snapTimelineFrame, projectDurationFrames, projectSampleRate, handleError: bindings.handleError,
	});
	const edits = createEditComposition({
		state, copy, lifetime, projectGeneration, projectRuntime, composition, absentSubsystem, session: sessionController, store, engine,
		sourceBuffers, sourcePeaks, sourceChunkFrames: SOURCE_CHUNK_FRAMES, taskProgress, saveLabelFile: options.saveLabelFile, fileService,
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
		captureActiveDocument: () => ({ history: state.history, project: documentState.project }),
		restoreActiveDocument: (snapshot) => { state.history = snapshot.history; documentState.project = snapshot.project; },
		switchProject: bindings.switchProject, projectChanged: bindings.projectChanged, warnEnvelope,
	});
	const recording = createRecordingComposition({
		state, lifetime, projectGeneration, projectRuntime, session: sessionController, store, engine, copy, locale, mediaDevices,
		capturePool: recordingCapturePool, createRecorder: recordingControllerFactory, microphoneMeter: microphoneMeterService,
		soundActivation: soundActivationPolicyService, openRecovery: takeCycleOpenRecoveryBinding, retention: doc.retention,
		sourceBuffers, sourceChunkProviders, sourcePeaks, currentTimeMs, scheduleTimer, clearTimer: clearScheduledTimer, productSettingKey,
		getProject: () => documentState.project, setProject: (value) => { documentState.project = value; }, projectSampleRate,
		assignPreferredInputToTrack, addTrack, commit: bindings.commit, activateStoredSource: bindings.activateStoredSource, beginPlaybackCachePreparation: bindings.beginPlaybackCachePreparation, applyProjectToPlaybackEngine: bindings.applyProjectToPlaybackEngine,
		flushProject: bindings.flushProject, stopProjectBinPreview: bindings.stopProjectBinPreview, persistSetting, updatePreferences: bindings.updatePreferences, preflightStorage: bindings.preflightStorage, publishDocumentSnapshot,
		publishTelemetrySnapshot, publishProjectState: bindings.publishProjectState, updatePlayhead, updateTransportState: bindings.updateTransportState, setStatus: bindings.setStatus, handleError: bindings.handleError,
	});
	const actions = guardEditorControllerActions(createGroupedEditorActions({
		AUDIO_EDITOR_DEFAULT_SHORTCUTS, addEffect: bindings.addEffect, addLabel: bindings.addLabel, addLabelTrack,
		addTrack, addVideoClipEffect: bindings.addVideoClipEffect, addVideoTrackPair, adjustAllTrackHeights,
		adjustTrackHeight: bindings.adjustTrackHeight, analysisService, applyAudacityEffectFromController: bindings.applyAudacityEffectFromController, applyEffectPreset: bindings.applyEffectPreset,
		applyProjectBinReplacement: bindings.applyProjectBinReplacement, applySamplePencil: bindings.applySamplePencil, applySpectralSelection: bindings.applySpectralSelection, beginParametricEqGesture: bindings.beginParametricEqGesture,
		beginRackEffectGesture: bindings.beginRackEffectGesture, beginVideoEffectGesture: bindings.beginVideoEffectGesture, bypassVideoClipEffect: bindings.bypassVideoClipEffect, cancelAudacityEffectPreview: bindings.cancelAudacityEffectPreview,
		cancelEffectMacro: effects.macro.cancelEffectMacro, cancelNyquistEvaluation: bindings.cancelNyquistEvaluation, cancelParametricEqGesture: bindings.cancelParametricEqGesture, cancelPlaybackCachePreparation: bindings.cancelPlaybackCachePreparation, cancelProjectBinReplacement: bindings.cancelProjectBinReplacement,
		cancelRackEffectGesture: bindings.cancelRackEffectGesture, cancelSampleEdit: bindings.cancelSampleEdit, cancelTimedRecording: bindings.cancelTimedRecording, cancelVideoEffectGesture: bindings.cancelVideoEffectGesture,
		capabilities, captureRackNoiseProfileFromController: bindings.captureRackNoiseProfileFromController, captureSelectedNoiseProfile: bindings.captureSelectedNoiseProfile, claimProjectLock: bindings.claimProjectLock,
		clearLocalData, clearLoopRegion, clearRecentProjects: bindings.clearRecentProjects, closeProjectTab,
		commit: bindings.commit, commitParametricEqGesture: bindings.commitParametricEqGesture, commitRackEffectGesture: bindings.commitRackEffectGesture, commitVideoEffectGesture: bindings.commitVideoEffectGesture,
		configureDisplayInput: bindings.configureDisplayInput, continueLoudnessMeasurement, copy, copyEffectStack: bindings.copyEffectStack,
		createStableId, createWorkspacePreference, currentAudacityEffectParams: bindings.currentAudacityEffectParams, deleteEffectPreset: bindings.deleteEffectPreset,
		deleteProject, deleteWorkspacePreference, disjoinSelectedClip: bindings.disjoinSelectedClip, dismissAup4CompatibilitySummary: bindings.dismissAup4CompatibilitySummary,
		duplicateProject: bindings.duplicateProject, duplicateTrack: bindings.duplicateTrack, engine, exportEffectPreset: bindings.exportEffectPreset,
		exportLabels: bindings.exportLabels, exportVideo, ffmpeg, fileService, findClip, findTrack,
		flushProject: bindings.flushProject, generateSelectionSilence: bindings.generateSelectionSilence, generateSignal: bindings.generateSignal, repeatLastGenerator: bindings.repeatLastGenerator, getClipVisualData: bindings.getClipVisualData,
		getProjectBinClipVisualData: bindings.getProjectBinClipVisualData, getVideoSourceVisualData: sources.projectVisual.getVideoSourceVisualData, getVisibleClips: bindings.getVisibleClips, handleClipAction: bindings.handleClipAction, handleEdit: edits.handleEdit,
		handleExportAction, handlePlayAtSpeed, handleTransport, hasMissingTimelineSources: bindings.hasMissingTimelineSources,
		importEffectPresets: bindings.importEffectPresets, importFiles: imports.importFiles, importLabelFile: bindings.importLabelFile, inspectScape,
		listAudioEditorEffectPresets, listProjects: bindings.listProjects, makeStereoTrack: bindings.makeStereoTrack, mixAndRenderTracks: bindings.mixAndRenderTracks,
		moveClips: bindings.moveClips, moveClipsToNewTrack: bindings.moveClipsToNewTrack, moveClipsToProjectBin: bindings.moveClipsToProjectBin, movePanelPreference, activatePanelTabPreference,
		moveToolbarPreference, moveTrack, newProject: bindings.newProject, normalizePlaybackFrame,
		openAudacityProject: bindings.openAudacityProject, openAup4: bindings.openAup4, openProject: bindings.openProject, openScape: bindings.openScape, openScapeFile, overwriteClips: bindings.overwriteClips, openDawproject: (file) => taskProgress.run('project-io', copy.importing, () => nativeProjectService.openDawproject(file)), saveDawproject: (saveOptions) => taskProgress.run('project-io', copy.dawprojectSaving, () => nativeProjectService.saveDawproject(saveOptions)),
		pasteEffectStack: bindings.pasteEffectStack, pauseLoudnessMeasurement, placeProjectBinClip: bindings.placeProjectBinClip, playPauseProjectBinClip: bindings.playPauseProjectBinClip,
		prepareProjectBinReplacement: bindings.prepareProjectBinReplacement, prepareProjectHandoff, assertProjectHandoffAllowed: () => { if (documentState.project) framescaperCapture?.assertOriginHandoffAllowed(documentState.project.id); projectAdminService.assertProjectHandoffAllowed(); }, previewAudacityEffectFromController: effects.execution.previewAudacityEffectFromController, previewParametricEq: bindings.previewParametricEq,
		previewRackEffect: bindings.previewRackEffect, previewVideoEffectGesture: bindings.previewVideoEffectGesture, product, productId: product.id, locale: options.locale, macroScriptStartedAt: () => new Date().toISOString(), getProject: () => documentState.project, projectSampleRate, beginMacroTransaction: () => doc.mutation.beginMacroTransaction(), timelineDurationFrames: () => projectDurationFrames(documentState.project),
		projectBinInstanceCount: bindings.projectBinInstanceCount, refreshAudioDevices: bindings.refreshAudioDevices, refreshRecordingInputs: bindings.refreshRecordingInputs, refreshStorageUsage: bindings.refreshStorageUsage, releaseInputs: bindings.releaseInputs, releaseVideoSourceVisual: bindings.revokeVideoVisual, reloadVideoSourceVisual, reportVideoPreviewPressure: options.reportProductVideoPreviewPressure || (() => undefined), canRelinkLinkedAudio: imports.projectBin.canRelinkLinkedAudio, classifyLinkedAudioRelink: imports.projectBin.classifyLinkedAudioRelink, relinkLinkedAudio: imports.projectBin.relinkLinkedAudio, canRelinkLinkedVideo: imports.projectBin.canRelinkLinkedVideo, classifyLinkedVideoRelink: imports.projectBin.classifyLinkedVideoRelink, relinkLinkedVideo: imports.projectBin.relinkLinkedVideo,
		removeProjectBinClip: bindings.removeProjectBinClip, removeProjectBinSource: bindings.removeProjectBinSource, removeVideoClipEffect: bindings.removeVideoClipEffect, renameProject: bindings.renameProject,
		renameProjectBinClip: bindings.renameProjectBinClip, renderClipPitchSpeed: bindings.renderClipPitchSpeed, reorderTrack, reorderVideoClipEffect: bindings.reorderVideoClipEffect,
		repeatLastAudacityEffect: bindings.repeatLastAudacityEffect, requestInputAccess: bindings.requestInputAccess, requestStoragePersistence: storageCapacityService.requestStoragePersistence, requestWaveformPcmWindow: bindings.requestWaveformPcmWindow, resampleClip: bindings.resampleClip, resampleTrack: bindings.resampleTrack,
		resetClipPitchSpeed: bindings.resetClipPitchSpeed, resetLoudnessMeasurement, resizeTrackHeight: bindings.resizeTrackHeight, revertFactorySettings: bindings.revertFactorySettings,
		runEffectMacro: bindings.runEffectMacro, runNyquistEvaluation: bindings.runNyquistEvaluation, saveAup4: bindings.saveAup4, saveEffectPreset: bindings.saveEffectPreset,
		saveNow: bindings.saveNow, saveScape: bindings.saveScape, scheduleTimedRecording: bindings.scheduleTimedRecording, selectAllTracks: bindings.selectAllTracks,
		selectAtZeroCrossings: bindings.selectAtZeroCrossings, selectClip: bindings.selectClip, selectCursorToTrackEnd: bindings.selectCursorToTrackEnd, selectLeftOfPlaybackPosition: bindings.selectLeftOfPlaybackPosition,
		selectProjectBinInstances: bindings.selectProjectBinInstances, selectRightOfPlaybackPosition: bindings.selectRightOfPlaybackPosition, selectTrack: bindings.selectTrack, selectTrackStartToCursor: bindings.selectTrackStartToCursor,
		selectTrackStartToEnd: bindings.selectTrackStartToEnd, sessionTab: bindings.sessionTab, setAllTracksView: bindings.setAllTracksView, setAudacityControlTrack: bindings.setAudacityControlTrack,
		setAudacityEffectParamsFromController: bindings.setAudacityEffectParamsFromController, setAudacityEffectType: bindings.setAudacityEffectType, setAudioOutputDevice: bindings.setAudioOutputDevice, setAutoFitTrackHeight: bindings.setAutoFitTrackHeight,
		setClipTimePitch: bindings.setClipTimePitch, setLatencyOffset: bindings.setLatencyOffset, setLoopRegion, setLoopRegionInOut, setStatus: bindings.setStatus,
		setLoopRegionToSelection, setMicrophoneMetering: bindings.setMicrophoneMetering, setMonitoring: bindings.setMonitoring, setPanelDockExtentPreference, setPanelFrameSizePreference, setPanelPreference, setPanelVisibilityPreference,
		setPlayAtSpeedRate, setPreferredInputChannelCount: bindings.setPreferredInputChannelCount, setPreferredInputDevice: bindings.setPreferredInputDevice, setProjectBinClipColor: bindings.setProjectBinClipColor,
		setRecordingInputGain: bindings.setRecordingInputGain, setRecordingSourceLatency: bindings.setRecordingSourceLatency, setRecordingTrackInput: bindings.setRecordingTrackInput, setRetainInputs: bindings.setRetainInputs,
		setExactSelection: tracks.selectionView.setExactSelection, setSampleEditMode: bindings.setSampleEditMode, setSelection: bindings.setSelection, setSelectionToLoopRegion, setShortcutPreference,
		setSnapSettings: bindings.setSnapSettings, effectSelectionService: effects.selection, setTimelineView: bindings.setTimelineView, setTimelineViewportWidth: bindings.setTimelineViewportWidth,
		setToolbarButtonPreference, setTrackDisplayMode, setTrackRate,
		setVisibleTrackHeights: bindings.setVisibleTrackHeights, setWorkspacePreference, setZoom: bindings.setZoom, smoothSelectedSamples: bindings.smoothSelectedSamples,
		snapTimelineFrame: bindings.snapTimelineFrame, splitAtFrame: bindings.splitAtFrame, splitStereoTrack: bindings.splitStereoTrack, startRecording: bindings.startRecording, startTakeCycleRecording: () => recording.session.startTakeCycleRecording(),
		startRecordingOnNewTrack: bindings.startRecordingOnNewTrack, state, stopProjectBinPreview: bindings.stopProjectBinPreview, stopRecording: bindings.stopRecording, cleanupDisposableStorage: storageCapacityService.cleanupDisposableStorage, cleanupDerivativeCache: storageCapacityService.cleanupDerivativeCache,
		store, stretchClip: bindings.stretchClip, swapTrackChannels: bindings.swapTrackChannels, switchProject: bindings.switchProject, persistSetting, publishDocumentSnapshot, handleError: bindings.handleError,
		toggleLeadInRecording: bindings.toggleLeadInRecording, toggleMetronome, togglePanelPreference, togglePinnedPlayhead: bindings.togglePinnedPlayhead,
		toggleRecordingPause: bindings.toggleRecordingPause, toggleRmsWaveform: bindings.toggleRmsWaveform, toggleRulerPlayback: bindings.toggleRulerPlayback, toggleSelectionFollowsLoop,
		recoverTakeCycleRecording: (pending) => takeCycleOpenRecovery.resolve(pending, 'recover'), discardTakeCycleRecording: (pending) => takeCycleOpenRecovery.resolve(pending, 'discard'),
		toggleStretchToTempo: clips.clipProperty.toggleStretchToTempo,
		toggleToolbarPreference, toggleUpdateWhilePlaying: bindings.toggleUpdateWhilePlaying, toggleVerticalRulers: bindings.toggleVerticalRulers, toggleVideoClipEffect: bindings.toggleVideoClipEffect,
		selectionViewService: tracks.selectionView, sequenceTimingService: clips.sequenceTiming, timelineAnnotationService: doc.timelineAnnotation, regularIntervalAnnotationController: doc.regularIntervalAnnotation, trackFolderService: doc.trackFolder, trackStructuralOperations: tracks.track.structuralOperations, soundActivationPolicyService, trimClips: bindings.trimClips, updatePreferences: bindings.updatePreferences, updateRackEffect: bindings.updateRackEffect,
		audioWarpService: tracks.audioWarp, sourceMonitorService: clips.sourceMonitor, takeCompService: tracks.takeComp, taskProgress, videoTrimServices: clips.videoTrim, videoEditService: clips.videoEdit, videoNavigationService, videoSourceReprobeService: clips.videoSourceReprobe, framescaperCaptureActions: framescaperCapture ? { ...framescaperCapture.actions, openSetup: () => { framescaperCapture.actions.openSetup(); preferencesService.setPanelVisibility('recording-setup', true); } } : undefined, framescaperWebVcrActions: framescaperCapture?.webVcrActions, ...productActionRuntime(options),
		updateVideoClipEffect: bindings.updateVideoClipEffect, updateWorkspacePreference, updateZoom: bindings.updateZoom,
	}), () => lifetime.assertActive());
	const dispose = createControllerDisposal({
		lifetime, state, clearDiagnostics: () => state.localDiagnostics.clear(), clearTaskProgress: taskProgress.clear,
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
	if (options.productNativeRenderInputAuthority) connectProductNativeRenderInputAuthority(options.productNativeRenderInputAuthority, () => {
		const currentProject = documentState.project; if (!currentProject) throw new Error('A current project is required for native render-input production.');
		const projectToken = projectGeneration.capture(currentProject.id), snapshot = projectRuntime.cloneProject(currentProject), task = lifetime.startTask('product-native-render-input'), assertCurrent = () => { task.assertCurrent(); projectGeneration.assertCurrent(projectToken); if (documentState.project !== currentProject) throw abortError(); };
		return Object.freeze({ project: snapshot, signal: task.signal, assertCurrent, finish: task.finish, renderAudio: async (renderProject, range) => { assertCurrent(); const rendered = await renderSnapshot(renderProject, range, sourceBuffers, task.signal); assertCurrent(); return rendered; }, renderAudioToSink: (renderProject, range, sink) => renderProductNativeAudioToSink({ sourceBuffers, signal: task.signal, assertCurrent, createRenderEngine: bindings.createCacheAwareRenderEngine, prepareCommittedTimePitchCaches: bindings.prepareCommittedTimePitchCaches }, renderProject, range, sink) }); });

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
		subscribe: (listener) => documentChannel.subscribe(listener),
		getTelemetrySnapshot: bindings.getTelemetrySnapshot, subscribeTelemetry: (listener) => telemetryChannel.subscribe(listener),
		getLocalDiagnosticsSnapshot: state.localDiagnostics.snapshot, recordLocalDiagnosticError: state.localDiagnostics.record,
		getClipVisualData: bindings.getClipVisualData,
		getProjectBinClipVisualData: bindings.getProjectBinClipVisualData, selectedMediaPreparation: effects.audio.selectedMediaPreparation,
		actions,
		dispose,
	};

	function publishDocumentSnapshot({ force = false } = {}) { documentChannel.publish({ force }); }
	function publishTelemetrySnapshot() { telemetryChannel.publish(); }
	async function reloadVideoSourceVisual(sourceId) { const source = findSource(documentState.project, sourceId); if (!source || source.kind !== 'video') throw new ReferenceError(`Video source ${String(sourceId)} is missing.`); await bindings.revokeVideoVisual(source.id); return bindings.activateVideoSource(source); }

	async function persistSetting(key, value, { policy = 'best-effort' } = {}) { return settingPersistence.persist(key, value, { policy }); }

	async function prepareProjectHandoff(expected) {
		if (documentState.project) framescaperCapture?.assertOriginHandoffAllowed(documentState.project.id);
		return projectAdminService.prepareProjectHandoff(expected);
	}

	async function closeProjectTab(projectId = documentState.project?.id, closeOptions = {}) {
		if (projectId) framescaperCapture?.assertOriginCloseAllowed(projectId);
		return projectAdminService.closeProjectTab(projectId, closeOptions);
	}

	async function deleteProject() {
		if (documentState.project) framescaperCapture?.assertOriginDeleteAllowed(documentState.project.id);
		return projectAdminService.deleteProject();
	}

	async function clearLocalData() {
		const origin = framescaperCapture?.originSnapshot().origin;
		if (origin) framescaperCapture.assertOriginDeleteAllowed(origin.projectId);
		return projectAdminService.clearLocalData();
	}

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

	function normalizeExportSettings(value = {}) {
		return normalizeEditorExportSettings(value, projectSampleRate(), documentState.project.metadata?.tags || {});
	}

	function warnEnvelope() {
		const envelope = projectEnvelope(documentState.project, { mobile: state.mobile });
		if (!envelope.supported) bindings.setStatus(copy.capacityWarning
			.replace('{trackCount}', String(envelope.limits.trackCount))
			.replace('{stereoMinutes}', String(envelope.limits.stereoMinutes)));
	}

	function activeSelection() {
		const selection = documentState.project?.selection;
		return selection && selection.endFrame > selection.startFrame ? selection : null;
	}
}
