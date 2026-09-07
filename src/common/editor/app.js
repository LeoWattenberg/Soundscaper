import { createControllerDisposal } from './controller/controller-disposal.ts';
import { deferControllerMethods, deferAsyncControllerMethods } from './controller/deferred-controller-methods.ts';
import { createControllerDocumentState } from './controller/document-state.ts';
import { createEffectsComposition } from './controller/effects-composition.ts';
import { createClipVideoComposition } from './controller/clip-video-composition.ts';
import { createTrackAudioComposition } from './controller/track-audio-composition.ts';
import { AUDIO_DEVICE_PREFERENCES_SETTING_KEY, createRecordingComposition } from './controller/recording-composition.ts';
import {
	AUDIO_EDITOR_DEFAULT_PIXELS_PER_SECOND,
	AUDIO_EDITOR_MAX_PIXELS_PER_SECOND,
} from './timeline-zoom-limits.ts';
import {
	createAddTrackCommand,
} from './commands.js';
import {
	ClipTimePitchRenderCacheCoordinator,
	loadStoredSourceChannels,
} from './clip-time-pitch-cache.js';
import { createAudioEditorEffectPresets, listAudioEditorEffectPresets } from './effect-presets.js';
import { audioSelectionEffectTypes } from './effects.js';
import { createControllerPresentationState } from './controller/presentation-state.ts';
import { selectAudioEditorControllerEditBlock } from './edit-blocking.ts';
import { createAudioEditorFileService } from './file-service.js';
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
import { SCAPE_MIME_TYPE } from './scape-project-format.ts';
import { createAudioEditorSessionController } from './session.js';
import {
	audioEditorVideoThumbnailTimes,
	createAudioEditorVideoFrameExtractor,
} from './video-media.js';

import { productProfile } from '../products.js';
import { withProjectFileExtension } from '../project-file-extensions.ts';
import {
	AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES,
} from './audacity-effects/contracts.js';
import { assertPlayAtSpeedStaffPadMemorySafe, createAudioEditorEngine } from './engine.js';
import {
	RECORDING_INPUT_GAIN_DEFAULT,
	createRecordingCapturePool,
	createRecordingController,
	normalizeRecordingInputGain,
	requestDisplayInput,
	requestHardwareInput,
} from './recording.js';
import {
	RECORDING_DEFAULT_DEVICE_ID,
	normalizeRecordingRouting,
	recordingRoutingSettingKey,
} from './recording-routing.js';
import { createEditorCodecRuntime } from './editor-codec-runtime.ts'; import { createSourceBufferCache } from './source-buffer-cache.js'; import { createEbuR128MeterNode } from './ebu-r128-node.js';
import { acquireProjectLock } from './project-lock.js';
import { createProjectStore } from './storage.js';
import { ENGLISH_COPY } from '../i18n/catalogs.js';
import { normalizeBcp47Locale } from '../i18n/locale.js';
import { EditorControllerLifetime, EditorProjectGeneration, isEditorDisposedError } from './controller/lifecycle.ts';
import { deferredArchiveRuntime } from './controller/deferred-archive-runtime.ts';
import { deferredEffectRuntime } from './controller/deferred-effect-runtime.ts';
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
import { createProjectBootstrapService } from './controller/project-bootstrap-service.ts'; import { resolveStartupProjectId } from './startup-preferences.ts';
import { createProjectLockService } from './controller/project-lock-service.ts';
import { createProjectSwitchService } from './controller/project-switch-service.ts';
import { resolveControllerProjectRuntime } from './controller/project-runtime.ts';
import { createControllerProjectRuntimeMetrics } from './controller/project-runtime-metrics.ts';
import { SourceChunkProviderRegistry } from './controller/source-chunk-provider-registry.ts';
import {
	createPlaybackProjectService,
} from './controller/playback-project-service.ts';
import { createMicrophoneMeterService } from './controller/microphone-meter-service.ts';

import { createNativeProjectService } from './controller/native-project-service.ts'; import { createDawprojectAudioDecoder } from './controller/dawproject-audio-decode.ts'; import { applicationVersion } from './application-version.ts';

import { createTakeCycleOpenRecoveryAppPort } from './controller/take-cycle-open-recovery-app-port.ts';

import {
	abortError,
	aup4ReportHasMissingPcm,
	classifyMobile,
	ensureAup4FileName,
	formatBytes,
	formatPlaybackRate,
	historyEntrySummary,
	normalizeAup4CompatibilityReport,
	normalizeProjectSampleRate,
	throwIfAborted,
} from './controller/app-helpers.ts';
import {
	normalizeAudioDevicePreferences,
	normalizeLatencyOffset,
	recordingPreviewSnapshot,
	streamAudioChannelCount,
} from './controller/recording-model.ts';
import { createSettingPersistence } from './controller/setting-persistence.ts';
import { createControllerStorageCapacityService } from './controller/storage-capacity-runtime.ts';
import { createSnapshotComposition } from './controller/snapshot-composition.ts';
import { createEditorTaskProgressCoordinator } from './controller/task-progress.ts';
import {
	SOURCE_CHUNK_FRAMES,
	audioBufferChannels,
	normalizeByteLimit,
	sourcePcmBytes,
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
const PROJECT_LOCK_RETRY_MAX_MS = 30_000;

/** @param {Element | null} [_root] */
export function createAudioEditorController(_root = null, options = {}) {
	const { bootstrap } = deferAsyncControllerMethods(() => projectBootstrapService, ['bootstrap']);
	const { openProject } = deferAsyncControllerMethods(() => projectSwitchService, ['openProject']);
	const { claimProjectLock } = deferAsyncControllerMethods(() => projectLockService, ['claimProjectLock']);
	const { loadProjectSources } = deferAsyncControllerMethods(() => sources.sourceLifecycle, ['loadProjectSources']);
	const { listProjects, clearRecentProjects, renameProject, duplicateProject, garbageCollectSources } = deferAsyncControllerMethods(() => projectAdminService, ['listProjects', 'clearRecentProjects', 'renameProject', 'duplicateProject', 'garbageCollectSources']);
	const { prepareProjectBinReplacement, cancelProjectBinReplacement, playPauseProjectBinClip } = deferAsyncControllerMethods(() => imports.projectBin, ['prepareProjectBinReplacement', 'cancelProjectBinReplacement', 'playPauseProjectBinClip']);
	const { importLabelFile, exportLabels } = deferAsyncControllerMethods(() => edits.labels, ['importLabelFile', 'exportLabels']);
	const { disjoinSelectedClip } = deferAsyncControllerMethods(() => edits.clipboard, ['disjoinSelectedClip']);
	const { generateSelectionSilence, generateSignal, repeatLastGenerator } = deferAsyncControllerMethods(() => edits, ['generateSelectionSilence', 'generateSignal', 'repeatLastGenerator']);
	const { requestInputAccess, setPreferredInputDevice, configureDisplayInput, setPreferredInputChannelCount, setAudioOutputDevice, setRecordingSourceLatency, setRetainInputs } = deferAsyncControllerMethods(() => recording.routing, ['requestInputAccess', 'setPreferredInputDevice', 'configureDisplayInput', 'setPreferredInputChannelCount', 'setAudioOutputDevice', 'setRecordingSourceLatency', 'setRetainInputs']);
	const { setRecordingTrackInput } = deferAsyncControllerMethods(() => recording.inputs, ['setRecordingTrackInput']);
	const { setMicrophoneMetering } = deferAsyncControllerMethods(() => microphoneMeterService, ['setMicrophoneMetering']);
	const { apply: applyProjectToPlaybackEngine } = deferAsyncControllerMethods(() => sources.playbackApply, ['apply']);
	const { stopRecording } = deferAsyncControllerMethods(() => recording.session, ['stopRecording']);
	// Resolve service dependencies at invocation while preserving their owning types.
	const { get: getSnapshot } = deferControllerMethods(() => documentChannel, ['get']);
	const { get: getTelemetrySnapshot } = deferControllerMethods(() => telemetryChannel, ['get']);
	const { getClipVisualData, getProjectBinClipVisualData, revokeVideoVisuals, revokeVideoVisual, activateVideoSource, hasMissingTimelineSources, getVisibleClips } = deferControllerMethods(() => sources.projectVisual, ['getClipVisualData', 'getProjectBinClipVisualData', 'revokeVideoVisuals', 'revokeVideoVisual', 'activateVideoSource', 'hasMissingTimelineSources', 'getVisibleClips']);
	const { update: updatePreferences, revertFactorySettings } = deferControllerMethods(() => preferencesService, ['update', 'revertFactorySettings']);
	const { sessionTab, persistActiveSessionUiState } = deferControllerMethods(() => doc.session, ['sessionTab', 'persistActiveSessionUiState']);
	const { dismissAup4CompatibilitySummary } = deferControllerMethods(() => nativeProjectService, ['dismissAup4CompatibilitySummary']);
	const { cacheSourceBuffer, clearWaveformPcmWindows } = deferControllerMethods(() => sources.sourceLifecycle, ['cacheSourceBuffer', 'clearWaveformPcmWindows']);
	const { renameProjectBinClip, removeProjectBinClip, setProjectBinClipColor, projectBinInstanceCount, selectProjectBinInstances, removeProjectBinSource } = deferControllerMethods(() => imports.projectBin, ['renameProjectBinClip', 'removeProjectBinClip', 'setProjectBinClipColor', 'projectBinInstanceCount', 'selectProjectBinInstances', 'removeProjectBinSource']);
	const { mixAndRenderTracks, resampleTrack, resampleClip, swapTrackChannels, splitStereoTrack, makeStereoTrack } = deferControllerMethods(() => tracks, ['mixAndRenderTracks', 'resampleTrack', 'resampleClip', 'swapTrackChannels', 'splitStereoTrack', 'makeStereoTrack']);
	const { splitAtFrame } = deferControllerMethods(() => edits.clipboard, ['splitAtFrame']);
	const { selectTrack, selectAllTracks, selectTrackStartToCursor, selectCursorToTrackEnd, selectTrackStartToEnd, selectedTracksTimeRange, toggleRmsWaveform, toggleVerticalRulers, toggleUpdateWhilePlaying, togglePinnedPlayhead, toggleRulerPlayback, selectAtZeroCrossings, setZoom } = deferControllerMethods(() => tracks.selectionView, ['selectTrack', 'selectAllTracks', 'selectTrackStartToCursor', 'selectCursorToTrackEnd', 'selectTrackStartToEnd', 'selectedTracksTimeRange', 'toggleRmsWaveform', 'toggleVerticalRulers', 'toggleUpdateWhilePlaying', 'togglePinnedPlayhead', 'toggleRulerPlayback', 'selectAtZeroCrossings', 'setZoom']);
	const { synchronizeAutomaticSampleEditMode, cancelSampleEdit } = deferControllerMethods(() => clips.sampleEdit, ['synchronizeAutomaticSampleEditMode', 'cancelSampleEdit']);
	const { persistRecordingRouting, releaseInputs } = deferControllerMethods(() => recording.routing, ['persistRecordingRouting', 'releaseInputs']);
	const { syncRecordingPoolSnapshot, setMonitoring, setRecordingInputGain, setLatencyOffset, invalidateTakeCycleRecording } = deferControllerMethods(() => recording, ['syncRecordingPoolSnapshot', 'setMonitoring', 'setRecordingInputGain', 'setLatencyOffset', 'invalidateTakeCycleRecording']);
	const { handleRecordingPoolChange } = deferControllerMethods(() => recording.inputs, ['handleRecordingPoolChange']);
	const { synchronizeTarget: synchronizeMicrophoneMeterTarget } = deferControllerMethods(() => microphoneMeterService, ['synchronizeTarget']);
	const { commit, updateSelection, projectChanged, saveNow, flushProject } = deferControllerMethods(() => doc.mutation, ['commit', 'updateSelection', 'projectChanged', 'saveNow', 'flushProject']);
	const { compactLiveSourceState, liveSessionSourceIds, liveSessionClipIds } = deferControllerMethods(() => doc.retention, ['compactLiveSourceState', 'liveSessionSourceIds', 'liveSessionClipIds']);
	const { publishProjectState, setTimelineView, setAllTracksView } = deferControllerMethods(() => doc.view, ['publishProjectState', 'setTimelineView', 'setAllTracksView']);
	const { duplicateTrack } = deferControllerMethods(() => doc.trackDuplication, ['duplicateTrack']);
	const { handleClipAction, setClipTimePitch, stretchClip, resetClipPitchSpeed } = deferControllerMethods(() => clips.clipProperty, ['handleClipAction', 'setClipTimePitch', 'stretchClip', 'resetClipPitchSpeed']);
	const { moveClips, moveClipsToNewTrack, trimClips, overwriteClips } = deferControllerMethods(() => clips.clipTransform, ['moveClips', 'moveClipsToNewTrack', 'trimClips', 'overwriteClips']);
	const { renderClipPitchSpeed } = deferControllerMethods(() => clips, ['renderClipPitchSpeed']);
	const { createCacheAwareRenderEngine, prepareCommittedTimePitchCaches, beginPlaybackCachePreparation, cancelPlaybackCachePreparation } = deferControllerMethods(() => sources.timePitchCaches, ['createCacheAwareRenderEngine', 'prepareCommittedTimePitchCaches', 'beginPlaybackCachePreparation', 'cancelPlaybackCachePreparation']);
	const { videoEffectGestureKey, reorderVideoClipEffect, removeVideoClipEffect, beginVideoEffectGesture, cancelVideoEffectGesture } = deferControllerMethods(() => clips.videoEffect, ['videoEffectGestureKey', 'reorderVideoClipEffect', 'removeVideoClipEffect', 'beginVideoEffectGesture', 'cancelVideoEffectGesture']);
	const { addEffect, updateRackEffect, beginRackEffectGesture, previewRackEffect, commitRackEffectGesture, cancelRackEffectGesture, beginParametricEqGesture, previewParametricEq, commitParametricEqGesture, cancelParametricEqGesture, copyEffectStack, pasteEffectStack } = deferControllerMethods(() => effects.rack, ['addEffect', 'updateRackEffect', 'beginRackEffectGesture', 'previewRackEffect', 'commitRackEffectGesture', 'cancelRackEffectGesture', 'beginParametricEqGesture', 'previewParametricEq', 'commitParametricEqGesture', 'cancelParametricEqGesture', 'copyEffectStack', 'pasteEffectStack']);
	const { runEffectMacro, applyAudacityEffectFromController, repeatLastAudacityEffect, applySpectralSelection, captureSelectedNoiseProfile, runNyquistEvaluation } = deferControllerMethods(() => effects, ['runEffectMacro', 'applyAudacityEffectFromController', 'repeatLastAudacityEffect', 'applySpectralSelection', 'captureSelectedNoiseProfile', 'runNyquistEvaluation']);
	const { currentAudacityEffectParams, setAudacityEffectType, setAudacityEffectParamsFromController, setAudacityControlTrack, applyEffectPreset, saveEffectPreset, deleteEffectPreset, importEffectPresets, exportEffectPreset, cancelAudacityEffectPreview, captureRackNoiseProfileFromController } = deferControllerMethods(() => effects.controls, ['currentAudacityEffectParams', 'setAudacityEffectType', 'setAudacityEffectParamsFromController', 'setAudacityControlTrack', 'applyEffectPreset', 'saveEffectPreset', 'deleteEffectPreset', 'importEffectPresets', 'exportEffectPreset', 'cancelAudacityEffectPreview', 'captureRackNoiseProfileFromController']);
	const { renderDryTrackRange } = deferControllerMethods(() => effects.audio, ['renderDryTrackRange']);
	const { cancelNyquistEvaluation } = deferControllerMethods(() => effects.nyquistHost, ['cancelNyquistEvaluation']);
	const { toggleRecordingPause, toggleLeadInRecording, cancelRecordingStart } = deferControllerMethods(() => recording.session, ['toggleRecordingPause', 'toggleLeadInRecording', 'cancelRecordingStart']);
	const { updateTransportState, updateMeters, updateZoom, setTimelineViewportWidth, setAutoFitTrackHeight, adjustTrackHeight } = deferControllerMethods(() => viewStateService, ['updateTransportState', 'updateMeters', 'updateZoom', 'setTimelineViewportWidth', 'setAutoFitTrackHeight', 'adjustTrackHeight']);
	const { toggleExport, updateExportProgress, showAnalysis, setStatus, handleError } = deferControllerMethods(() => presentationState, ['toggleExport', 'updateExportProgress', 'showAnalysis', 'setStatus', 'handleError']);
	const { refreshStorageUsage, estimateStorageForPreflight, preflightStorage } = deferControllerMethods(() => storageCapacityService, ['refreshStorageUsage', 'estimateStorageForPreflight', 'preflightStorage']);

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
	const fileService = options.fileService || createAudioEditorFileService();
	const store = options.store || createProjectStore({ memoryFallback: !fileService.isDesktop, linkedOriginalPort: fileService.linkedOriginalPort, linkedVideoOriginalPort: fileService.linkedVideoOriginalPort });
	const sourceBuffers = createSourceBufferCache({ maxBytes: options.sourceBufferCacheMaxBytes });
	const mixRenderMemoryLimitBytes = normalizeByteLimit(options.mixRenderMemoryLimitBytes, AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES);
	const sourceChunkProviders = new SourceChunkProviderRegistry();
	const sourcePeaks = new Map(), stagedProjectBinSourceIds = new Set();
	const sessionController = options.sessionController || createAudioEditorSessionController();
	const currentTimeMs = typeof options.now === 'function' ? options.now : () => Date.now();
	const scheduleTimer = typeof options.setTimeout === 'function' ? options.setTimeout : globalThis.setTimeout.bind(globalThis);
	const clearScheduledTimer = typeof options.clearTimeout === 'function' ? options.clearTimeout : globalThis.clearTimeout.bind(globalThis);
	const scheduleInterval = typeof options.setInterval === 'function' ? options.setInterval : globalThis.setInterval.bind(globalThis);
	const clearScheduledInterval = typeof options.clearInterval === 'function' ? options.clearInterval : globalThis.clearInterval.bind(globalThis);
	const engine = options.engine || createAudioEditorEngine({
		onPosition: updatePlayhead,
		onMeter: updateMeters,
		onState: updateTransportState,
	});
	const renderEngineFactory = options.engineFactory || createAudioEditorEngine;
	const clipTimePitchCache = options.clipTimePitchCache || new ClipTimePitchRenderCacheCoordinator({
		store,
		client: options.staffPadRenderClient,
		loadSourceChannels: async (source, context = {}) => {
			const buffer = sourceBuffers.get(source.id);
			// AudioBuffer channel views are borrowed and must never be detached.
			// Give StaffPad owned copies so the worker can transfer every input
			// without retaining a duplicate on the main thread.
			if (buffer) return audioBufferChannels(buffer).map((channel) => channel.slice());
			return loadStoredSourceChannels(store, source, context);
		},
		transferLoadedSourceChannels: true,
		maximumResidentChannelBytes: options.clipTimePitchMaximumResidentChannelBytes,
		onWarning: (warning) => setStatus(copy.staffPadRangeWarning.replace('{stageCount}', String(warning.stageCount))),
	});
	const clipTimePitchSourceResolver = clipTimePitchCache.createEngineSourceResolver();
	engine.setSourceResolver?.(clipTimePitchSourceResolver);
	const ffmpeg = options.ffmpeg || createEditorCodecRuntime({
		onLoading: () => setStatus(copy.ffmpegLoading),
		onProgress: (progress) => updateExportProgress(progress), fileService,
	});
	const nyquistClient = options.nyquistEvaluator ? null : deferredEffectRuntime.createNyquistClient(options.nyquistClientOptions);
	const nyquistEvaluator = options.nyquistEvaluator || ((request, evaluateOptions) => (
		nyquistClient.evaluate(request, evaluateOptions)
	));
	const playAtSpeedPitchPreserver = options.playAtSpeedPitchPreserver || (async (
		channels,
		sampleRate,
		rate,
		{ signal, onProgress } = {},
	) => deferredEffectRuntime.applyAudacityEffectAsync(
		'audacity-change-tempo',
		channels,
		sampleRate,
		{ tempoPercent: (rate - 1) * 100 },
		{
			isCancelled: () => Boolean(signal?.aborted),
			onProgress,
		},
	));
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
	const soundActivationPolicyService = createControllerSoundActivationPolicy(state, updatePreferences, publishDocumentSnapshot);
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
		getCurrentTabMetadata: (projectId) => sessionTab(projectId)?.metadata || {},
		recordingPreviewSnapshot,
		getSoundActivationSnapshot: soundActivationPolicyService.getSnapshot,
		sampleEditingAvailable,
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
		getSelectionEffectParams: currentAudacityEffectParams,
	};
	const { document: documentChannel, telemetry: telemetryChannel } = createSnapshotComposition({
		document: documentSnapshotRuntime, telemetry: state, audioDevices: state, engine, mediaDevices, copy,
		videoEffectGestures: state.videoEffectGestures, videoEffectGestureKey,
	});
	let persistentExportProgressObserver = null;
	const taskProgress = createEditorTaskProgressCoordinator({ onChange: (progress) => {
		state.taskProgress = progress; if (progress?.kind === 'export' && typeof progress.value === 'number') persistentExportProgressObserver?.(progress.value); publishTelemetrySnapshot();
	} });
	const presentationState = createControllerPresentationState({ state, copy, publishDocument: publishDocumentSnapshot, publishTelemetry: publishTelemetrySnapshot, updateTaskProgress: (value) => taskProgress.updateActive(value) });
	const settingPersistence = createSettingPersistence({
		write: (key, value) => store.saveSetting(key, value),
		isInactive: () => state.disposed,
		onWarning: (error) => handleError(error),
	});
	const recordingCapturePool = options.recordingCapturePool || createRecordingCapturePool({
		requestHardwareInput: (captureOptions) => requestHardwareInput({
			...captureOptions,
			deviceId: captureOptions.deviceId === RECORDING_DEFAULT_DEVICE_ID ? undefined : captureOptions.deviceId,
			mediaDevices,
		}),
		requestDisplayInput: (captureOptions) => requestDisplayInput({ ...captureOptions, mediaDevices }),
		onChange: handleRecordingPoolChange,
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
		syncRecordingPoolSnapshot,
		handleError,
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
		getProject: () => documentState.project, publishDocumentSnapshot, setStatus, handleError,
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
		projectDurationFrames, editorTimelineDurationFrames, projectSampleRate: () => projectSampleRate(), persistSetting, preflightStorage,
		garbageCollectSources, refreshStorageUsage, editingBlocked,
		assertEditingAllowed: () => { if (documentState.project) framescaperCapture?.assertOriginEditAllowed(documentState.project.id); },
		updatePlayhead, synchronizeAutomaticSampleEditMode, synchronizeMicrophoneMeterTarget, stopProjectBinPreview, persistRecordingRouting, publishDocumentSnapshot, handleError,
	});
	const projectAdminService = createProjectAdminService({
		cancelPlaybackCachePreparation,
		clearScheduledTimer: globalThis.clearTimeout.bind(globalThis),
		clearWaveformPcmWindows,
		clipTimePitchCache, commit, copy, currentTimeMs, editorHistoryProjects, engine,
		evictUnreferencedSourceCaches, flushProject, getProject: () => documentState.project, handleError,
		liveSessionClipIds, liveSessionLinkedOriginalSourceReferences: doc.retention.liveSessionLinkedOriginalSourceReferences, liveSessionSourceIds, newProject, openProject, persistSetting,
		projectGeneration, projectSaveService: doc.saves, projectMaintenanceRuntime: options.projectMaintenanceRuntime, projectSessionService: doc.session, publishDocumentSnapshot,
		recordingRoutingSettingKey, releaseProjectLock, revokeVideoVisuals, saveNow,
		scheduleTimer: globalThis.setTimeout.bind(globalThis), sessionController, sessionTab,
		setProject: (nextProject) => { documentState.project = nextProject; },
		disposeRenderEngines: sources.timePitchCaches.disposeRenderEngines, sourceBuffers, sourceChunkProviders, sourcePeaks, state, stopProjectBinPreview, stopRecording, store,
		switchProject, ...(framescaperCaptureAdminInterlock ? { beginCaptureInterlockedAdminOperation: framescaperCaptureAdminInterlock.beginAdminOperation } : {}),
	});
	const analysisService = createAnalysisComposition({
		enabled: composition.analysis, productName: product.name, state, copy, lifetime, projectGeneration, store, taskProgress,
		getProject: () => documentState.project, getActiveSelection: activeSelection, projectDurationFrames,
		cloneProject: projectRuntime.cloneProject, projectSampleRate: () => projectSampleRate(), sourceBuffers, hasMissingTimelineSources,
		renderSnapshot: (...args) => renderSnapshot(...args), showAnalysis, setStatus, publish: publishDocumentSnapshot, handleError,
	});
	const unsubscribeParametricEqErrors = typeof engine.subscribeParametricEqErrors === 'function'
		? engine.subscribeParametricEqErrors((error) => handleError(error))
		: () => {};
	const projectLockService = createProjectLockService({
		state, cancelTask: (...args) => lifetime.cancelTask(...args),
		getProjectId: () => documentState.project?.id ?? null,
		getProjectMetadata: (projectId) => sessionTab(projectId)?.metadata || {},
		acquireProjectLock: acquireLock,
		setProjectReadOnly: (projectId, update) => sessionController.setProjectReadOnly(projectId, update),
		publishProjectState,
		setStatus,
		handleError,
		invalidateRecordingAuthority: invalidateTakeCycleRecording, revokeWriteAuthority: () => effects.rack.revokeWriteAuthority(),
		copy,
		retryMaximumMs: PROJECT_LOCK_RETRY_MAX_MS,
		currentTimeMs: Date.now,
		scheduleTimer: (callback, delayMs) => Number(globalThis.setTimeout(callback, delayMs)),
		clearTimer: (timer) => globalThis.clearTimeout(timer),
	});
	const { inspectScape, openScapeFile, scapeInspectionQuiescence } = createScapeProjectFileService({ lifetime, store, openScape, productCapabilities: product.capabilities, currentProjectSchemaFamily: product.id, inspectScapeProject: options.scapeProjectRuntime?.inspectScapeProject, scapeInspectionQuiescenceOptions: options.scapeInspectionQuiescenceOptions });
	const projectSwitchService = createProjectSwitchService({
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
		cancelTimedRecording,
		cancelRecordingStart,
		cancelPlaybackCachePreparation,
		cancelPlayAtSpeedPreparation: () => cancelPlayAtSpeedPreparation(),
		stopRecording,
		persistActiveSessionUiState,
		saveNow,
		cancelScheduledSave: doc.saves.cancelScheduled,
		stopEngine: () => engine.stop(), stopProjectBinPreview, disposeRenderEngines: sources.timePitchCaches.disposeRenderEngines,
		beginSourceChunkProviderReplacement: () => sourceChunkProviders.beginReplacement(),
		cancelEffectPreview: cancelAudacityEffectPreview,
		releaseProjectLock: (...args) => projectLockService.releaseProjectLock(...args),
		acquireProjectLock: acquireLock,
		watchProjectLockLoss: projectLockService.watchProjectLockLoss,
		scheduleProjectLockRecovery: projectLockService.scheduleProjectLockRecovery,
		sessionTab,
		session: sessionController,
		loadRecordingRouting,
		restoreProjectSelection: doc.session.restoreProjectSelection,
		revokeOutputUrl: (url) => URL.revokeObjectURL(url),
		revokeVideoVisuals,
		clearWaveformPcmWindows,
		loadProjectSources, prepareRequiredProjectSources: sources.sourceLifecycle.prepareRequiredProjectSources,
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
		synchronizeMicrophoneMeterTarget,
		publishProjectState,
		garbageCollectSources,
		setStatus,
		isDisposedError: isEditorDisposedError,
		clearSourceCaches: async () => {
			sourceBuffers.clear(); sourceChunkProviders.clear(); sourcePeaks.clear();
			await sourceChunkProviders.drain();
		},
	});
	const projectBootstrapService = createProjectBootstrapService({
		state, lifetimeSignal: lifetime.signal, store, engine, mediaDevices, productSettingKey,
		automaticAudioDeviceEnumeration: capabilities.audioRecording === true,
		audioDevicePreferencesSettingKey: AUDIO_DEVICE_PREFERENCES_SETTING_KEY, recordingInputGainDefault: RECORDING_INPUT_GAIN_DEFAULT,
		loadPreferences,
		createEffectPresets: createAudioEditorEffectPresets,
		normalizeRecordingInputGain,
		normalizeLatencyOffset,
		normalizeAudioDevicePreferences,
		refreshAudioDevices,
		setRemoveDeviceChangeListener: (remove) => { removeDeviceChangeListener = remove; },
		loadRecentProjectState: (guard) => doc.session.loadRecentProjectState(guard), startupProjectId: (lastProjectId) => resolveStartupProjectId(state.preferences?.startup, lastProjectId),
		openProject: (savedProject) => projectSwitchService.openProject(savedProject),
		newProject: () => projectSwitchService.newProject(), openRecovery: takeCycleOpenRecovery,
		publishProjectState,
		saveNow,
		refreshStorageUsage,
		hasMissingTimelineSources,
		setStatus,
		handleError,
		isDisposed: () => state.disposed,
		isDisposedError: isEditorDisposedError,
		guard: (value, token) => lifetime.guard(value, token),
		copy,
	});
	const nativeProjectService = createNativeProjectService({
		lifetime, projectGeneration, state, copy, store, fileService, taskProgress,
		getProject: () => documentState.project,
		switchProject,
		editingBlocked,
		flushProject,
		hasMissingTimelineSources,
		estimateStorageForPreflight, preflightStorage,
		createStableId,
		ensureAup4FileName,
		projectFileExtension: product.projectFileExtension, ensureProjectFileName: withProjectFileExtension,
		sourcePcmBytes,
		loadStoredSourceChannels,
		requestAup4FileHandle: deferredArchiveRuntime.requestAup4FileHandle,
		saveAup4Result: deferredArchiveRuntime.saveAup4Result,
		createAup4Client: deferredArchiveRuntime.createAup4Client,
		initialAup4Client: options.aup4Client || null,
		aup4Options: options.aup4 || {}, adaptAudacityProject: options.adaptAudacityProject,
		prepareAudacityProjectExport: options.prepareAudacityProjectExport, loadProject: projectRuntime.loadProject,
		importScapeProject: options.scapeProjectRuntime?.importScapeProject || deferredArchiveRuntime.importScapeProject,
		exportScapeProject: options.scapeProjectRuntime?.exportScapeProject || deferredArchiveRuntime.exportScapeProject,
		copyFutureScapeArchive: options.scapeProjectRuntime?.copyScapeArchive || deferredArchiveRuntime.copyFutureScapeArchive,
		normalizeCompatibilityReport: normalizeAup4CompatibilityReport,
		reportHasMissingPcm: aup4ReportHasMissingPcm,
		sessionTab,
		updateProjectMetadata: (projectId, metadata) => sessionController.updateProjectMetadata(projectId, metadata),
		setStatus,
		publishDocumentSnapshot,
		sourceBuffers,
		sourceChunkFrames: SOURCE_CHUNK_FRAMES, decodeAudioFile: createDawprojectAudioDecoder({ engine, ffmpeg, copy }), product, applicationVersion: applicationVersion(),
		scapeMimeType: SCAPE_MIME_TYPE,
	});
	const framescaperCaptureProxyScheduler = (framescaperCaptureRuntime
		&& options.createFramescaperCaptureProxyScheduler?.({ runtime: ffmpeg, helperTimingProbe: fileService.helperTimingProbe, quiesceProjectSaves: framescaperCaptureRuntime.createProxySaveQuiescence({ getActiveProjectId: () => documentState.project?.id ?? null, hasUnsavedProjectChanges: () => Boolean(documentState.project && sessionTab(documentState.project.id)?.dirty), saves: doc.saves }), synchronizeActiveProject: framescaperCaptureRuntime.createProxyActiveProjectSynchronizer({ getActiveProject: () => documentState.project, setActiveProject: (value) => { documentState.project = value; }, setActiveHistory: (value) => { state.history = value; }, applyProjectToPlaybackEngine, publishProjectState }) })) ?? null, framescaperCaptureDerivatives = framescaperCaptureRuntime
		? framescaperCaptureRuntime.createDerivativeScheduler({
			getOriginProject: async (projectId) => sessionTab(projectId)?.history?.present ?? store.loadProject(projectId),
			store,
			activateStoredSource: (source, metadata, activationOptions) => activateStoredSource(source, metadata, activationOptions),
			activateVideoSource: (source) => findSource(documentState.project, source.id) ? sources.projectVisual.activateVideoSource(source) : undefined,
			createVideoFrameExtractor: createAudioEditorVideoFrameExtractor, videoThumbnailTimes: audioEditorVideoThumbnailTimes,
			...(framescaperCaptureProxyScheduler ? { scheduleProxy: framescaperCaptureProxyScheduler } : {}),
		}) : null;
	const framescaperCaptureWriteAuthority = framescaperCaptureRuntime
		? framescaperCaptureRuntime.createProjectWriteAuthority({
			getProjectAdmission: (projectId) => { const tab = sessionTab(projectId); return tab ? { readOnly: Boolean(tab.readOnly), intrinsicReadOnly: Boolean(tab.metadata?.intrinsicReadOnly || tab.metadata?.declaredReadOnly || tab.metadata?.featureRequirementsReadOnly) } : null; },
			getActiveProjectId: () => documentState.project?.id ?? null, getActiveReadOnly: () => state.readOnly,
			getActiveLock: () => state.projectLock, acquireProjectLock: (projectId) => acquireLock(projectId),
		}) : null;
	framescaperCapture = framescaperCaptureRuntime?.createAppBinding({
		productId, adminInterlock: framescaperCaptureAdminInterlock,
		schemaFamily: 'framescaper', schemaVersion: 1,
		isDesktop: Boolean(fileService.isDesktop), embedded: globalThis.document?.documentElement?.dataset?.embedded === 'true',
		store, sessionController, projectRuntime, mediaDevices,
		getActiveProject: () => documentState.project, getActiveHistory: () => state.history,
		getActivePlayheadFrame: () => state.positionFrame,
		setActiveProject: (value) => { documentState.project = value; }, setActiveHistory: (value) => { state.history = value; },
		synchronizeProject: async (value) => { await applyProjectToPlaybackEngine(value); publishProjectState(); },
		assertProjectWritable: framescaperCaptureWriteAuthority?.assertProjectWritable,
		acquireProjectWriteAuthority: framescaperCaptureWriteAuthority?.acquireProjectWriteAuthority,
		prepareCaptureStart: flushProject,
		getAudioContext: () => engine.getAudioContext({ resume: false }),
		createStream: options.createStream, MediaRecorder: options.MediaRecorder,
		MediaStreamTrackProcessor: options.MediaStreamTrackProcessor,
		recordingControllerFactory: options.recordingControllerFactory, AudioWorkletNode: options.AudioWorkletNode,
		helperTimingProbe: fileService.helperTimingProbe, ffmpeg,
		desktopBridge: globalThis.framescaperCaptureDesktop?.v1 ?? null, webVcrBridge: globalThis.framescaperWebVcr?.v1 ?? null, webVcrEnabled: product.applicationFeatures?.framescaperWebVcr === true, showWebVcrPanel: () => preferencesService.setPanelVisibility('web-vcr', true), hideWebVcrPanel: () => preferencesService.setPanelVisibility('web-vcr', false),
		createId: createStableId, now: currentTimeMs,
		...(framescaperCaptureDerivatives ? { scheduleDerivatives: framescaperCaptureDerivatives } : {}),
		onWarning: handleError, onChange: publishDocumentSnapshot,
	});
	const bootstrapToken = lifetime.capture();
	const ready = bootstrap(bootstrapToken)
		.then(async () => {
			if (lifetime.inactive) return getSnapshot();
			await framescaperCapture?.initialize();
			if (lifetime.inactive) return getSnapshot();
			lifetime.markReady();
			state.phase = lifetime.phase;
			publishDocumentSnapshot();
			if (state.microphoneMetering) {
				void setMicrophoneMetering(true).catch((error) => {
					if (!state.disposed) handleError(error);
				});
			}
			return getSnapshot();
		})
		.catch((error) => {
			if (isEditorDisposedError(error) || lifetime.inactive) return getSnapshot();
			lifetime.markError();
			state.phase = lifetime.phase;
			handleError(error);
			publishDocumentSnapshot();
			return getSnapshot();
		});
	const transportComposition = createTransportComposition({
		state, engine, copy, sampleRate: AUDIO_EDITOR_SAMPLE_RATE, maximumPixelsPerSecond: MAX_PIXELS_PER_SECOND, microphoneMeter: microphoneMeterService,
		abortError, activeSelection, assertPlayAtSpeedStaffPadMemorySafe, beginPlaybackCachePreparation, calculateAudioEditorMetronomeSchedule,
		cancelPlaybackCachePreparation, cancelTimedRecording, commit, editingBlocked, editorTimelineDurationFrames, findTrack, formatPlaybackRate,
		hasMissingTimelineSources, persistSetting, playAtSpeedPitchPreserver, productSettingKey, getProject: () => documentState.project,
		projectDurationFrames, publishDocumentSnapshot, publishProjectState, publishTelemetrySnapshot, sampleEditingAvailable, setSelection, setStatus,
		startRecording, stopProjectBinPreview, stopRecording, throwIfAborted,
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
		getProject: () => documentState.project, getCommandProject, editingBlocked, commit, publishProjectState, publishDocumentSnapshot, setStatus, handleError,
		normalizePlaybackFrame, cancelPlaybackCachePreparation, cancelPlayAtSpeedPreparation, stopProjectBinPreview, hasMissingTimelineSources,
		activateVideoSource, activateStoredSource, activeSelection, snapTimelineFrame, preflightStorage, projectSampleRate, cacheSourceBuffer,
	});
	videoNavigationService = clips.videoNavigation;
	const tracks = createTrackAudioComposition({
		state, copy, lifetime, projectGeneration, projectRuntime, controllerOptions: options, store, engine, sourceBuffers, sourceChunkProviders, sourcePeaks,
		sourceResolver: clipTimePitchSourceResolver, sourceChunkFrames: SOURCE_CHUNK_FRAMES, mixRenderMemoryLimitBytes,
		defaultPixelsPerSecond: DEFAULT_PIXELS_PER_SECOND, maximumPixelsPerSecond: MAX_PIXELS_PER_SECOND, trackColors: AUDIO_EDITOR_TRACK_COLORS,
		taskProgress, microphoneMeter: microphoneMeterService,
		export: {
			ffmpeg, fileService, playbackProjects: playbackProjectService, productName: product.name, prepareProjectForExport: options.prepareProjectForExport,
			normalizeExportSettings, toggleExport, updateExportProgress, setPersistentExportProgressObserver: (observer) => { persistentExportProgressObserver = observer; },
		},
		createRenderEngine: createCacheAwareRenderEngine, createPreviewEngine: (previewOptions) => renderEngineFactory(previewOptions), prepareCommittedTimePitchCaches,
		getProject: () => documentState.project, editingBlocked, commit, setStatus, publishDocumentSnapshot, publishProjectState, handleError, preflightStorage,
		projectSampleRate, projectDurationFrames, editorTimelineDurationFrames, normalizeTimelineFrame, persistSetting, productSettingKey, activeSelection,
		activateStoredSource, cacheSourceBuffer, retireSourceChunkProvider: sources.sourceLifecycle.retireSourceChunkProvider, renderDryTrackRange,
		hasMissingTimelineSources, updatePlayhead, updateSelection, synchronizeAutomaticSampleEditMode, updateRecordingDeviceRows, persistRecordingRouting,
	});
	const {
		addTrack, addVideoTrackPair, assignPreferredInputToTrack, addLabelTrack,
		reorderTrack, moveTrack, setTrackDisplayMode, setTrackRate,
	} = tracks.trackActions;
	const { cancelPersistentAudioDelivery, exportVideo, handleExportAction, renderSnapshot } = tracks.export;
	bindSoundscaperPersistentDeliveryRuntime(options, { exportService: tracks.export, getProject: () => documentState.project, getSaveState: () => state.saveState, captureProjectGeneration: () => projectGeneration.capture(documentState.project?.id ?? null), assertProjectGeneration: (token) => projectGeneration.assertCurrent(token), deliveryReport: () => state.deliveryReport ?? null, cancelExport: cancelPersistentAudioDelivery, publishDocumentSnapshot });
	const effects = createEffectsComposition({
		state, copy, locale, composition, absentSubsystem, lifetime, projectGeneration, projectRuntime, store, engine, sourceBuffers, sourcePeaks,
		taskProgress, nyquistEvaluator, getProject: () => documentState.project, activeSelection, selectedTracksTimeRange, editingBlocked, setSelection,
		persistSetting, publishDocumentSnapshot, setStatus, preflightStorage, renderSnapshot, prepareCommittedTimePitchCaches,
		createRenderEngine: createCacheAwareRenderEngine, commit, cacheSourceBuffer, snapTimelineFrame, projectDurationFrames, projectSampleRate, handleError,
	});
	const edits = createEditComposition({
		state, copy, lifetime, projectGeneration, projectRuntime, composition, absentSubsystem, session: sessionController, store, engine,
		sourceBuffers, sourcePeaks, sourceChunkFrames: SOURCE_CHUNK_FRAMES, taskProgress, saveLabelFile: options.saveLabelFile, fileService,
		effectTargets: (...args) => effects.selection.audacityEffectTargets(...args),
		persistEffectResults: (results, type, scope) => effects.result.persistAudacityEffectResults(results, type, scope),
		getProject: () => documentState.project, getCommandProject, editingBlocked, commit, setStatus, publishDocumentSnapshot, handleError, preflightStorage,
		normalizeTimelineFrame, snapTimelineFrame, activeSelection, cacheSourceBuffer, projectChanged, garbageCollectSources, compactLiveSourceState,
	});
	const imports = createImportComposition({
		state, copy, lifetime, projectGeneration, store, engine, ffmpeg, helperTimingProbe: fileService.helperTimingProbe,
		sourceBuffers, sourceChunkProviders, sourcePeaks, sourceResolver: clipTimePitchSourceResolver, sourceChunkFrames: SOURCE_CHUNK_FRAMES,
		protectedSourceIds: stagedProjectBinSourceIds, trackColors: AUDIO_EDITOR_TRACK_COLORS, taskProgress, projectVisual: sources.projectVisual,
		createPreviewEngine: (previewOptions) => renderEngineFactory(previewOptions),
		getProject: () => documentState.project, editingBlocked, commit, updateSelection, setStatus, publishDocumentSnapshot, handleError, preflightStorage, projectSampleRate,
		activateStoredSource, invalidateSourceRuntime: sources.sourceLifecycle.invalidateSourceRuntime, retireSourceChunkProvider: sources.sourceLifecycle.retireSourceChunkProvider,
		retireTimelinePlayback, cacheSourceBuffer,
		captureActiveDocument: () => ({ history: state.history, project: documentState.project }),
		restoreActiveDocument: (snapshot) => { state.history = snapshot.history; documentState.project = snapshot.project; },
		switchProject, projectChanged, warnEnvelope,
	});
	const recording = createRecordingComposition({
		state, lifetime, projectGeneration, projectRuntime, session: sessionController, store, engine, copy, locale, mediaDevices,
		capturePool: recordingCapturePool, createRecorder: recordingControllerFactory, microphoneMeter: microphoneMeterService,
		soundActivation: soundActivationPolicyService, openRecovery: takeCycleOpenRecoveryBinding, retention: doc.retention,
		sourceBuffers, sourceChunkProviders, sourcePeaks, currentTimeMs, scheduleTimer, clearTimer: clearScheduledTimer, productSettingKey,
		getProject: () => documentState.project, setProject: (value) => { documentState.project = value; }, projectSampleRate,
		assignPreferredInputToTrack, addTrack, commit, activateStoredSource, beginPlaybackCachePreparation, applyProjectToPlaybackEngine,
		flushProject, stopProjectBinPreview, persistSetting, updatePreferences, preflightStorage, publishDocumentSnapshot,
		publishTelemetrySnapshot, publishProjectState, updatePlayhead, updateTransportState, setStatus, handleError,
	});
	const actions = guardEditorControllerActions(createGroupedEditorActions({
		AUDIO_EDITOR_DEFAULT_SHORTCUTS, addEffect, addLabel, addLabelTrack,
		addTrack, addVideoClipEffect, addVideoTrackPair, adjustAllTrackHeights,
		adjustTrackHeight, analysisService, applyAudacityEffectFromController, applyEffectPreset,
		applyProjectBinReplacement, applySamplePencil, applySpectralSelection, beginParametricEqGesture,
		beginRackEffectGesture, beginVideoEffectGesture, bypassVideoClipEffect, cancelAudacityEffectPreview,
		cancelEffectMacro: effects.macro.cancelEffectMacro, cancelNyquistEvaluation, cancelParametricEqGesture, cancelPlaybackCachePreparation, cancelProjectBinReplacement,
		cancelRackEffectGesture, cancelSampleEdit, cancelTimedRecording, cancelVideoEffectGesture,
		capabilities, captureRackNoiseProfileFromController, captureSelectedNoiseProfile, claimProjectLock,
		clearLocalData, clearLoopRegion, clearRecentProjects, closeProjectTab,
		commit, commitParametricEqGesture, commitRackEffectGesture, commitVideoEffectGesture,
		configureDisplayInput, continueLoudnessMeasurement, copy, copyEffectStack,
		createStableId, createWorkspacePreference, currentAudacityEffectParams, deleteEffectPreset,
		deleteProject, deleteWorkspacePreference, disjoinSelectedClip, dismissAup4CompatibilitySummary,
		duplicateProject, duplicateTrack, engine, exportEffectPreset,
		exportLabels, exportVideo, ffmpeg, fileService, findClip, findTrack,
		flushProject, generateSelectionSilence, generateSignal, repeatLastGenerator, getClipVisualData,
		getProjectBinClipVisualData, getVideoSourceVisualData: sources.projectVisual.getVideoSourceVisualData, getVisibleClips, handleClipAction, handleEdit: edits.handleEdit,
		handleExportAction, handlePlayAtSpeed, handleTransport, hasMissingTimelineSources,
		importEffectPresets, importFiles: imports.importFiles, importLabelFile, inspectScape,
		listAudioEditorEffectPresets, listProjects, makeStereoTrack, mixAndRenderTracks,
		moveClips, moveClipsToNewTrack, moveClipsToProjectBin, movePanelPreference, activatePanelTabPreference,
		moveToolbarPreference, moveTrack, newProject, normalizePlaybackFrame,
		openAudacityProject, openAup4, openProject, openScape, openScapeFile, overwriteClips, openDawproject: (file) => taskProgress.run('project-io', copy.importing, () => nativeProjectService.openDawproject(file)), saveDawproject: (saveOptions) => taskProgress.run('project-io', copy.dawprojectSaving, () => nativeProjectService.saveDawproject(saveOptions)),
		pasteEffectStack, pauseLoudnessMeasurement, placeProjectBinClip, playPauseProjectBinClip,
		prepareProjectBinReplacement, prepareProjectHandoff, assertProjectHandoffAllowed: () => { if (documentState.project) framescaperCapture?.assertOriginHandoffAllowed(documentState.project.id); projectAdminService.assertProjectHandoffAllowed(); }, previewAudacityEffectFromController: effects.execution.previewAudacityEffectFromController, previewParametricEq,
		previewRackEffect, previewVideoEffectGesture, product, productId: product.id, locale: options.locale, macroScriptStartedAt: () => new Date().toISOString(), getProject: () => documentState.project, projectSampleRate, beginMacroTransaction: () => doc.mutation.beginMacroTransaction(), timelineDurationFrames: () => projectDurationFrames(documentState.project),
		projectBinInstanceCount, refreshAudioDevices, refreshRecordingInputs, refreshStorageUsage, releaseInputs, releaseVideoSourceVisual: revokeVideoVisual, reloadVideoSourceVisual, reportVideoPreviewPressure: options.reportProductVideoPreviewPressure || (() => undefined), canRelinkLinkedAudio: imports.projectBin.canRelinkLinkedAudio, classifyLinkedAudioRelink: imports.projectBin.classifyLinkedAudioRelink, relinkLinkedAudio: imports.projectBin.relinkLinkedAudio, canRelinkLinkedVideo: imports.projectBin.canRelinkLinkedVideo, classifyLinkedVideoRelink: imports.projectBin.classifyLinkedVideoRelink, relinkLinkedVideo: imports.projectBin.relinkLinkedVideo,
		removeProjectBinClip, removeProjectBinSource, removeVideoClipEffect, renameProject,
		renameProjectBinClip, renderClipPitchSpeed, reorderTrack, reorderVideoClipEffect,
		repeatLastAudacityEffect, requestInputAccess, requestStoragePersistence: storageCapacityService.requestStoragePersistence, requestWaveformPcmWindow, resampleClip, resampleTrack,
		resetClipPitchSpeed, resetLoudnessMeasurement, resizeTrackHeight, revertFactorySettings,
		runEffectMacro, runNyquistEvaluation, saveAup4, saveEffectPreset,
		saveNow, saveScape, scheduleTimedRecording, selectAllTracks,
		selectAtZeroCrossings, selectClip, selectCursorToTrackEnd, selectLeftOfPlaybackPosition,
		selectProjectBinInstances, selectRightOfPlaybackPosition, selectTrack, selectTrackStartToCursor,
		selectTrackStartToEnd, sessionTab, setAllTracksView, setAudacityControlTrack,
		setAudacityEffectParamsFromController, setAudacityEffectType, setAudioOutputDevice, setAutoFitTrackHeight,
		setClipTimePitch, setLatencyOffset, setLoopRegion, setLoopRegionInOut, setStatus,
		setLoopRegionToSelection, setMicrophoneMetering, setMonitoring, setPanelDockExtentPreference, setPanelFrameSizePreference, setPanelPreference, setPanelVisibilityPreference,
		setPlayAtSpeedRate, setPreferredInputChannelCount, setPreferredInputDevice, setProjectBinClipColor,
		setRecordingInputGain, setRecordingSourceLatency, setRecordingTrackInput, setRetainInputs,
		setExactSelection: tracks.selectionView.setExactSelection, setSampleEditMode, setSelection, setSelectionToLoopRegion, setShortcutPreference,
		setSnapSettings, effectSelectionService: effects.selection, setTimelineView, setTimelineViewportWidth,
		setToolbarButtonPreference, setTrackDisplayMode, setTrackRate,
		setVisibleTrackHeights, setWorkspacePreference, setZoom, smoothSelectedSamples,
		snapTimelineFrame, splitAtFrame, splitStereoTrack, startRecording, startTakeCycleRecording: () => recording.session.startTakeCycleRecording(),
		startRecordingOnNewTrack, state, stopProjectBinPreview, stopRecording, cleanupDisposableStorage: storageCapacityService.cleanupDisposableStorage, cleanupDerivativeCache: storageCapacityService.cleanupDerivativeCache,
		store, stretchClip, swapTrackChannels, switchProject, persistSetting, publishDocumentSnapshot, handleError,
		toggleLeadInRecording, toggleMetronome, togglePanelPreference, togglePinnedPlayhead,
		toggleRecordingPause, toggleRmsWaveform, toggleRulerPlayback, toggleSelectionFollowsLoop,
		recoverTakeCycleRecording: (pending) => takeCycleOpenRecovery.resolve(pending, 'recover'), discardTakeCycleRecording: (pending) => takeCycleOpenRecovery.resolve(pending, 'discard'),
		toggleStretchToTempo: clips.clipProperty.toggleStretchToTempo,
		toggleToolbarPreference, toggleUpdateWhilePlaying, toggleVerticalRulers, toggleVideoClipEffect,
		selectionViewService: tracks.selectionView, sequenceTimingService: clips.sequenceTiming, timelineAnnotationService: doc.timelineAnnotation, regularIntervalAnnotationController: doc.regularIntervalAnnotation, trackFolderService: doc.trackFolder, trackStructuralOperations: tracks.track.structuralOperations, soundActivationPolicyService, trimClips, updatePreferences, updateRackEffect,
		audioWarpService: tracks.audioWarp, sourceMonitorService: clips.sourceMonitor, takeCompService: tracks.takeComp, taskProgress, videoTrimServices: clips.videoTrim, videoEditService: clips.videoEdit, videoNavigationService, videoSourceReprobeService: clips.videoSourceReprobe, framescaperCaptureActions: framescaperCapture ? { ...framescaperCapture.actions, openSetup: () => { framescaperCapture.actions.openSetup(); preferencesService.setPanelVisibility('recording-setup', true); } } : undefined, framescaperWebVcrActions: framescaperCapture?.webVcrActions, ...productActionRuntime(options),
		updateVideoClipEffect, updateWorkspacePreference, updateZoom,
	}), () => lifetime.assertActive());
	const dispose = createControllerDisposal({
		lifetime, state, clearDiagnostics: () => state.localDiagnostics.clear(), clearTaskProgress: taskProgress.clear,
		closeInspections: () => scapeInspectionQuiescence.close(lifetime.signal.reason), drainInspections: () => scapeInspectionQuiescence.drain(),
		publish: () => publishDocumentSnapshot({ force: true }), clearDocumentChannel: documentChannel.clear, clearTelemetryChannel: telemetryChannel.clear,
		removeDeviceChangeListener: () => { removeDeviceChangeListener(); removeDeviceChangeListener = () => {}; },
		disposeCapture: () => framescaperCapture?.dispose(), disposeCaptureProxy: () => framescaperCaptureProxyScheduler?.dispose?.(),
		disposeOpenRecovery: () => takeCycleOpenRecovery.dispose(), invalidateProject: () => projectGeneration.invalidate(),
		disposeVisuals: sources.projectVisual.dispose, unsubscribeEngineErrors: unsubscribeParametricEqErrors,
		cancelTimedRecording: () => cancelTimedRecording({ publish: false, status: false }), cancelRecordingStart,
		cancelScheduledSave: doc.saves.cancelScheduled, clearSourceGcTimer: () => globalThis.clearTimeout(state.sourceGcTimer),
		cancelPlaybackPreparation: cancelPlaybackCachePreparation, cancelPlayAtSpeedPreparation, stopMetronome,
		cancelEffectWorkers: effects.worker.cancelWorkers, disposeNyquist: () => nyquistClient?.dispose(),
		cancelEffectPreview: () => cancelAudacityEffectPreview({ publish: false }), disposeMicrophoneMeter: microphoneMeterService.dispose,
		terminalFlush: doc.saves.terminalFlush, stopRecording, disposeCapturePool: () => recordingCapturePool.dispose?.(),
		releaseProjectLock, revokeOutputUrl: (url) => URL.revokeObjectURL(url), disposeProjectBin: imports.projectBin.dispose,
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
		return Object.freeze({ project: snapshot, signal: task.signal, assertCurrent, finish: task.finish, renderAudio: async (renderProject, range) => { assertCurrent(); const rendered = await renderSnapshot(renderProject, range, sourceBuffers, task.signal); assertCurrent(); return rendered; }, renderAudioToSink: (renderProject, range, sink) => renderProductNativeAudioToSink({ sourceBuffers, signal: task.signal, assertCurrent, createRenderEngine: createCacheAwareRenderEngine, prepareCommittedTimePitchCaches }, renderProject, range, sink) }); });

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
		getSnapshot, captureProjectGeneration: projectGeneration.capture.bind(projectGeneration), assertProjectGeneration: projectGeneration.assertCurrent.bind(projectGeneration),
		subscribe: (listener) => documentChannel.subscribe(listener),
		getTelemetrySnapshot, subscribeTelemetry: (listener) => telemetryChannel.subscribe(listener),
		getLocalDiagnosticsSnapshot: state.localDiagnostics.snapshot, recordLocalDiagnosticError: state.localDiagnostics.record,
		getClipVisualData,
		getProjectBinClipVisualData, selectedMediaPreparation: effects.audio.selectedMediaPreparation,
		actions,
		dispose,
	};

	function publishDocumentSnapshot({ force = false } = {}) { documentChannel.publish({ force }); }
	function publishTelemetrySnapshot() { telemetryChannel.publish(); }
	async function reloadVideoSourceVisual(sourceId) { const source = findSource(documentState.project, sourceId); if (!source || source.kind !== 'video') throw new ReferenceError(`Video source ${String(sourceId)} is missing.`); await revokeVideoVisual(source.id); return activateVideoSource(source); }

	function loadPreferences(token) { return preferences.load(token); }
	async function persistSetting(key, value, { policy = 'best-effort' } = {}) { return settingPersistence.persist(key, value, { policy }); }

	async function newProject(options = {}) {
		return projectSwitchService.newProject(options);
	}

	function switchProject(nextProject, options = {}) {
		return projectSwitchService.switchProject(nextProject, options);
	}

	async function releaseProjectLock(lock = state.projectLock) {
		return projectLockService.releaseProjectLock(lock);
	}

	async function openScape(file, openOptions = {}) {
		return taskProgress.run('project-io', copy.importing, () => nativeProjectService.openScape(file, openOptions));
	}

	async function saveScape(options = {}) {
		return taskProgress.run('project-io', copy.projectSaving, () => nativeProjectService.saveScape(options));
	}

	async function openAup4(file) { return openAudacityProject(file); }

	async function openAudacityProject(file) { return taskProgress.run('project-io', copy.importing, () => nativeProjectService.openAudacityProject(file)); }

	async function saveAup4(options = {}) {
		return taskProgress.run('project-io', copy.aup4Saving, () => nativeProjectService.saveAup4(options));
	}

	async function requestWaveformPcmWindow(clipId, options = {}) {
		return sources.sourceLifecycle.requestWaveformPcmWindow(clipId, options);
	}

	async function activateStoredSource(source, metadata, activationOptions = {}) {
		return sources.sourceLifecycle.activateStoredSource(source, metadata, activationOptions);
	}

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

	function moveClipsToProjectBin(clipId = state.selectedClipId) { return imports.projectBin.moveClipsToProjectBin(clipId); }
	function placeProjectBinClip(binClipId, placement = {}) { return imports.projectBin.placeProjectBinClip(binClipId, placement); }
	function applyProjectBinReplacement(token, shortfallMode = 'keep-spacing') { return imports.projectBin.applyProjectBinReplacement(token, shortfallMode); }
	async function stopProjectBinPreview({ dispose = false } = {}) { return imports.projectBin.stopProjectBinPreview({ dispose }); }

	function addLabel(trackId, labelOptions = {}) { return tracks.track.addLabel(trackId, labelOptions); }

	function selectClip(clipId, options = {}) { return tracks.selectionView.selectClip(clipId, options); }
	function setSelection(startFrame, endFrame, details = {}) { return tracks.selectionView.setSelection(startFrame, endFrame, details); }

	function selectLeftOfPlaybackPosition(requestedStartFrame = null) { return tracks.selectionView.selectLeftOfPlaybackPosition(requestedStartFrame); }
	function selectRightOfPlaybackPosition(requestedEndFrame = null) { return tracks.selectionView.selectRightOfPlaybackPosition(requestedEndFrame); }

	function setSnapSettings(settings = {}) { return tracks.selectionView.setSnapSettings(settings); }
	function snapTimelineFrame(value, overrides = {}) { return tracks.selectionView.snapTimelineFrame(value, overrides); }

	function sampleEditingAvailable(clipId = state.selectedClipId) { return clips.sampleEdit.sampleEditingAvailable(clipId); }

	function setSampleEditMode(mode = null) { return clips.sampleEdit.setSampleEditMode(mode); }

	function applySamplePencil(options = {}) { return clips.applySamplePencil(options); }
	function smoothSelectedSamples(options = {}) { return clips.smoothSelectedSamples(options); }

	async function loadRecordingRouting(currentProject = documentState.project) {
		return recording.routing.loadRecordingRouting(currentProject);
	}

	async function refreshRecordingInputs({ probe = true } = {}) {
		return recording.routing.refreshRecordingInputs({ probe });
	}

	async function refreshAudioDevices({ probe = true, publish = true, nativeInventory = null } = {}) {
		return recording.routing.refreshAudioDevices({ probe, publish, nativeInventory });
	}

	function updateRecordingDeviceRows(discovered = state.recordingDevices) {
		return recording.routing.updateRecordingDeviceRows(discovered);
	}

	function pauseLoudnessMeasurement(kind = 'playback') { return microphoneMeterService.pauseLoudnessMeasurement(kind); }
	function continueLoudnessMeasurement(kind = 'playback') { return microphoneMeterService.continueLoudnessMeasurement(kind); }
	function resetLoudnessMeasurement(kind = 'playback') { return microphoneMeterService.resetLoudnessMeasurement(kind); }

	function addVideoClipEffect(clipId = state.selectedClipId, type, options = {}) { return clips.videoEffect.addVideoClipEffect(clipId, type, options); }
	function updateVideoClipEffect(clipId, effectId, changes = {}) { return clips.videoEffect.updateVideoClipEffect(clipId, effectId, changes); }
	function toggleVideoClipEffect(clipId, effectId, enabled = undefined) { return clips.videoEffect.toggleVideoClipEffect(clipId, effectId, enabled); }
	function bypassVideoClipEffect(clipId, effectId, bypassed = true) { return clips.videoEffect.bypassVideoClipEffect(clipId, effectId, bypassed); }

	function previewVideoEffectGesture(clipId, effectId, params = {}) { return clips.videoEffect.previewVideoEffectGesture(clipId, effectId, params); }
	function commitVideoEffectGesture(clipId, effectId, params = {}) { return clips.videoEffect.commitVideoEffectGesture(clipId, effectId, params); }

	async function startRecordingOnNewTrack(options = {}) {
		return recording.session.startRecordingOnNewTrack(options);
	}

	async function scheduleTimedRecording(startTime, options = {}) {
		return recording.timed.scheduleTimedRecording(startTime, options);
	}

	function cancelTimedRecording(options = {}) {
		return recording.timed.cancelTimedRecording(options);
	}

	function startRecording(options = {}) {
		return recording.session.startRecording(options);
	}

	function editingBlocked() {
		return selectAudioEditorControllerEditBlock(state).blocked
			|| Boolean(framescaperCapture?.originSnapshot(documentState.project?.id ?? null).editBlocked);
	}

	function updatePlayhead(frame = 0, duration = documentState.project ? projectDurationFrames(documentState.project) : 0) {
		return viewStateService.updatePlayhead(frame, duration);
	}

	function setVisibleTrackHeights(heights = {}) {
		return viewStateService.setVisibleTrackHeights(heights);
	}

	function resizeTrackHeight(trackId, requestedHeight, fittedHeights = {}) {
		return viewStateService.resizeTrackHeight(trackId, requestedHeight, fittedHeights);
	}

	function normalizeExportSettings(value = {}) {
		return normalizeEditorExportSettings(value, projectSampleRate(), documentState.project.metadata?.tags || {});
	}

	function warnEnvelope() {
		const envelope = projectEnvelope(documentState.project, { mobile: state.mobile });
		if (!envelope.supported) setStatus(copy.capacityWarning
			.replace('{trackCount}', String(envelope.limits.trackCount))
			.replace('{stereoMinutes}', String(envelope.limits.stereoMinutes)));
	}

	function activeSelection() {
		const selection = documentState.project?.selection;
		return selection && selection.endFrame > selection.startFrame ? selection : null;
	}
}
