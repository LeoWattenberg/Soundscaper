import { findNearestAudioZeroCrossing } from './analysis.js';
import { createAiffStreamEncoder, encodeAiff } from './aiff.js';
import { decodeLegacyAupProject } from './aup-legacy.js';
import { convertLegacyAupToProject } from './aup-legacy-conversion.js';
import { createAup4Client, requestAup4FileHandle, saveAup4Result } from './aup4-client.js';
import {
	collectRelatedClipIds,
	createAddClipCommand,
	createAddSourceCommand,
	createAddTrackCommand,
	createClipboardDescriptor,
	createReplaceClipSourceCommand,
	prepareDisjointRangeDeleteCommand,
	prepareGroupClipsCommand,
	prepareKeepRangeCommand,
	prepareLinkedSplitCommand,
	preparePasteCommand,
	preparePunchCommand,
	prepareRangeDeleteCommand,
	prepareRangeReplacementCommand,
	resolveEditingSelection,
} from './commands.js';
import {
	ClipTimePitchRenderCacheCoordinator,
	loadStoredSourceChannels,
} from './clip-time-pitch-cache.js';
import { createAudioEditorEffectPresets, listAudioEditorEffectPresets } from './effect-presets.js';
import {
	AUDIO_SELECTION_EFFECT_DEFINITIONS,
	audioEffectLabel,
	audioEffectTypes,
	audioSelectionEffectLabel,
	audioSelectionEffectTypes,
	isAudacityRackEffectType,
	normalizeAudioSelectionEffectParams,
	rackTailFrames,
} from './effects.js';
import { createExportPlan } from './export.js';
import { selectAudioEditorControllerEditBlock } from './edit-blocking.ts';
import { createAudioEditorFileService } from './file-service.js';
import { applyMediaChannelMapping } from './media-export.js';
import {
	AUDIO_EDITOR_DEFAULT_SHORTCUTS,
	applyAudioEditorWorkspace,
	createAudioEditorPreferencesV1,
	createCustomAudioEditorWorkspace,
	deleteCustomAudioEditorWorkspace,
	findAudioEditorShortcutConflicts,
	loadAudioEditorPreferencesV1,
	normalizeAudioEditorShortcut,
	updateAudioEditorPreferencesV1,
	updateCustomAudioEditorWorkspace,
} from './preferences.js';
import {
	AUDIO_EDITOR_SAMPLE_RATE,
	EDITOR_TIMELINE_MINIMUM_SECONDS,
	createStableId,
	findClip,
	findClipTrack,
	findSource,
	findTrack,
	projectEnvelope,
} from './project.js';
import { AUDIO_EDITOR_TRACK_COLORS, audioTrackChannelCountV2 } from './project-v2.js';
import { verifyProjectFallbackIntegrity } from './project-fallback-integrity.ts';
import { createStreamingWindowedSincResampler } from './resample.js';
import {
	compactEditorHistorySourceMetadata,
	editorHistoryProjects,
	evictUnreferencedSourceCaches,
} from './retention.js';
import {
	canEditAudioSamplesAtZoom,
	createPencilSampleEdits,
	createSmoothSampleRange,
	persistImmutableSampleEdit,
} from './sample-edit.js';
import { copyFutureScapeArchive } from './scape-archive-copy.ts';
import { SCAPE_MIME_TYPE, exportScapeProject, importScapeProject } from './scape-project.js';
import {
	applyAudioSelectionEffectAsync,
	estimateAudioSelectionEffectOutputFrames,
	estimateAudioSelectionEffectPeakBytes,
} from './selection-effects.js';
import { createAudioEditorSessionController } from './session.js';
import { snapAudioEditorFrameWithProject } from './snap-grid.js';
import { applySpectralGain } from './spectral-edit.js';
import {
	audioEditorVideoThumbnailTimes,
	createAudioEditorVideoFrameExtractor,
	isAudioEditorVideoFile,
} from './video-media.js';
import {
	VIDEO_EFFECT_DEFINITIONS,
	VIDEO_EFFECT_TYPES,
	cloneVideoEffects,
} from './video-effects.js';
import { createVideoExportPlan } from './video-export.js';
import { productProfile } from '../products.js';
import {
	AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES,
	applyAudacityEffectAsync,
	assertAudacityEffectOutput,
	captureAudacityNoiseProfile,
	estimateAudacityEffectPeakBytes,
} from './audacity-effects/index.js';
import {
	audacitySelectionChannelCount,
	matchAudacitySelectionChannels,
} from './audacity-selection.js';
import { initializePffft } from './pffft.js';
import {
	assertPlayAtSpeedStaffPadMemorySafe,
	createAudioEditorEngine,
	effectRackLatencyFrames, isAudioEditorEngineSupported,
} from './engine.js';
import { loadParametricEqWasmModule } from './parametric-eq/index.js';
import {
	RECORDING_CHANNEL_COUNT_MAXIMUM,
	RECORDING_INPUT_GAIN_DEFAULT,
	createRecordingCapturePool,
	createRecordingController,
	normalizeRecordingInputGain,
	requestDisplayInput,
	requestHardwareInput,
} from './recording.js';
import {
	RECORDING_DEFAULT_DEVICE_ID,
	RECORDING_DISPLAY_SOURCE_KEY,
	normalizeRecordingRouting,
	recordingRouteSourceKey,
	recordingRoutingSettingKey,
	setRecordingSourceOffset,
	setRecordingTrackRoute,
} from './recording-routing.js';
import { createEditorFfmpeg } from './ffmpeg.js';
import { inspectEncodedAudioSampleRate } from './audio-file-metadata.js';
import { createSourceBufferCache } from './source-buffer-cache.js';
import { createEbuR128MeterNode } from './ebu-r128-node.js';
import { createEbuR128Meter } from './ebu-r128.js';
import { acquireProjectLock } from './project-lock.js';
import { createProjectStore } from './storage.js';
import { createWavStreamEncoder, encodeWav } from './wav.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from './wav-import.js';
import { NyquistEvaluationClient } from './nyquist/client.js';
import { ENGLISH_COPY } from '../i18n/catalogs.js';
import { normalizeBcp47Locale } from '../i18n/locale.js';
import { EditorControllerLifetime, EditorProjectGeneration, isEditorDisposedError } from './controller/lifecycle.ts';
import { createAudioAnalysisService } from './controller/analysis-service.ts';
import { createEditorAnalysisVisuals } from './controller/analysis-visuals.ts';
import { createGroupedEditorActions } from './controller/action-facade.ts';
import { guardEditorControllerActions } from './controller/controller-action-guard.ts';
import { productActionRuntime } from './controller/product-action-runtime.ts'; import { createScapeProjectFileService } from './controller/scape-project-file-service.ts';
import { createEditorEditService } from './controller/edit-service.ts';
import { createLabelService } from './controller/label-service.ts';
import { createClipboardEditService } from './controller/clipboard-edit-service.ts';
import { createAudioGeneratorService } from './controller/generator-service.ts';
import { createRegularIntervalAnnotationController } from './controller/regular-interval-annotation-controller.ts';
import { createSelectionEffectResultService } from './controller/effect-result-service.ts';
import { createSelectionEffectExecutionService } from './controller/effect-execution-service.ts';
import { createEffectControlsService } from './controller/effect-controls-service.ts';
import { createEffectSelectionService } from './controller/effect-selection-service.ts';
import { createEffectMacroService } from './controller/effect-macro-service.ts';
import { createEffectAudioService } from './controller/effect-audio-service.ts';
import { createSelectionEffectWorkerService } from './controller/selection-effect-worker-service.ts';
import { createNyquistHostService } from './controller/nyquist-host-service.ts';
import { createNyquistGeneratedAudioService } from './controller/nyquist-generated-audio-service.ts';
import { createEditorExportService } from './controller/export-service.ts';
import { normalizeEditorExportSettings } from './controller/export-settings.ts';
import { createEditorPreferencesService } from './controller/preferences-service.ts';
import { createControllerSoundActivationPolicy } from './controller/sound-activation-controller-composition.ts';
import { createProjectSaveService } from './controller/project-save-service.ts';
import { createProjectMutationService } from './controller/project-mutation-service.ts';
import { createProjectRetentionService } from './controller/project-retention-service.ts';
import { createProjectViewService } from './controller/project-view-service.ts';
import { createTrackDuplicationService } from './controller/track-duplication-service.ts';
import { createProjectSessionService } from './controller/project-session-service.ts';
import { createProjectBootstrapService } from './controller/project-bootstrap-service.ts';
import { createProjectLockService } from './controller/project-lock-service.ts';
import { createProjectSwitchService } from './controller/project-switch-service.ts';
import { resolveControllerProjectRuntime } from './controller/project-runtime.ts';
import { createControllerProjectRuntimeMetrics } from './controller/project-runtime-metrics.ts';
import { SourceChunkProviderRegistry } from './controller/source-chunk-provider-registry.ts';
import {
	createPlaybackProjectApplyService,
	createPlaybackProjectService,
} from './controller/playback-project-service.ts';
import { createRecordingRoutingService } from './controller/recording-routing-service.ts';
import { createRecordingInputCoordinationService } from './controller/recording-input-coordination-service.ts';
import { createMicrophoneMeterService } from './controller/microphone-meter-service.ts';
import {
	createRecordingSessionService,
	createRoutedRecordingController as createCoordinatedRoutedRecordingController,
} from './controller/recording-session-service.ts';
import { createLegacyRecordingCaptureService } from './controller/legacy-recording-capture-service.ts';
import { createRoutedRecordingCaptureService } from './controller/routed-recording-capture-service.ts';
import { createLegacyRecordingFinalization } from './controller/legacy-recording-finalization.ts';
import { createRoutedRecordingFinalization } from './controller/routed-recording-finalization.ts';
import { createSampleEditService } from './controller/sample-edit-service.ts';
import { createSelectionViewService } from './controller/selection-view-service.ts';
import { createSourceLifecycleService } from './controller/source-lifecycle-service.ts';
import { createDerivedSourceService } from './controller/derived-source-service.ts';
import { createMixRenderService } from './controller/mix-render-service.ts';
import { createNativeProjectService } from './controller/native-project-service.ts';
import { createTrackActionAdapter } from './controller/track-action-adapter.ts';
import { createTimelineAnnotationService } from './controller/timeline-annotation-service.ts';
import { createSequenceTimingService } from './controller/sequence-timing-service.ts';
import { createVideoSourceReprobeService } from './controller/video-source-reprobe-service.ts';
import { createSourceMonitorService } from './controller/source-monitor-service.ts';
import { createVideoEditService } from './controller/video-edit-service.ts';
import { createVideoNavigationService } from './controller/video-navigation-service.ts';
import { createVideoTrimServices } from './controller/video-trim-composition.ts';
import { prepareThreePointEditCommand } from './commands/three-point-edit-runtime.js';
import { createTrackFolderService } from './controller/track-folder-service.ts';
import { createTakeCompControllerComposition } from './controller/take-comp-composition.ts';
import { createTakeCycleAppComposition } from './controller/take-cycle-app-composition.ts';
import { createTakeCycleRecordingAppSession } from './controller/take-cycle-recording-app-session.ts';
import { createTakeCycleOpenRecoveryAppPort, createTakeCycleOpenRecoveryCoordinator } from './controller/take-cycle-open-recovery-app-port.ts';
import { createAudioWarpControllerComposition } from './controller/audio-warp-composition.ts';
import { createEditorTrackService } from './controller/track-service.ts';
import { createTrackTransformService } from './controller/track-transform-service.ts';
import { createClipTransformService } from './controller/clip-transform-service.ts';
import { createClipPropertyService } from './controller/clip-property-service.ts';
import { createClipTimePitchCacheService } from './controller/clip-time-pitch-service.ts';
import { createClipTimePitchRenderService } from './controller/clip-time-pitch-render-service.ts';
import { createViewStateService } from './controller/view-state-service.ts';
import { createTimedRecordingService } from './controller/timed-recording-service.ts';
import { createTimedRecordingInputService } from './controller/timed-recording-input-service.ts';
import {
	abortError,
	aup4ReportHasMissingPcm,
	classifyMobile,
	ensureAup4FileName,
	ensureScapeFileName,
	formatLegacyAupWarning,
	formatBytes,
	formatPlaybackRate,
	historyEntrySummary,
	isLegacyAupFile,
	isLegacyBlockFile,
	isWavFile,
	normalizeAup4CompatibilityReport,
	normalizeProjectSampleRate,
	saveLabelExport,
	stripExtension,
	throwIfAborted,
} from './controller/app-helpers.ts';
import {
	audacityEffectMemoryError,
	freezeNyquistResult,
	mixNyquistPreviewChannels,
	normalizeNyquistRole,
	nyquistAudioResultBytes,
	nyquistMaximumOutputFrames,
	nyquistResultStatus,
} from './controller/nyquist-audio.ts';
import {
	appendRecordingPreview,
	createRecordingPreview,
	normalizeAudioDevicePreferences,
	normalizeLatencyOffset,
	normalizePreferredInputDeviceId,
	normalizePreferredOutputDeviceId,
	normalizeTimedRecordingStart,
	recordingPreviewSnapshot,
	recordingStreamIsLive,
	scaleRecordingFrames,
	streamAudioChannelCount,
} from './controller/recording-model.ts';
import { createSettingPersistence } from './controller/setting-persistence.ts';
import { createControllerStorageCapacityService } from './controller/storage-capacity-runtime.ts';
import { createEditorDocumentSnapshot } from './controller/document-snapshot.ts';
import {
	applyVideoEffectGesturePreviews,
	createAudioDeviceSnapshot,
	createEditorTelemetrySnapshot,
} from './controller/snapshot-model.ts';
import { createSnapshotChannel } from './controller/snapshot-channel.ts';
import { createEditorTaskProgressCoordinator } from './controller/task-progress.ts';
import {
	SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES,
	SOURCE_CHUNK_FRAMES,
	audioBufferChannels,
	bufferFromChannels,
	canonicalizeBuffer,
	createCoalescingSourceWriter,
	createStoredChunkProvider,
	isStreamableStoredSource,
	normalizeByteLimit,
	readStoredAudioBuffer,
	resampleBuffer,
	resampleChannelsWindowedSinc,
	serializeAudacityNoiseProfile,
	sourceAudioBufferBytes,
	sourcePcmBytes,
	writeBuffer,
} from './controller/source-audio.ts';
import { createEditorControllerState } from './controller/state.ts';
import { createEditorTransportService } from './controller/transport-service.ts';
import { createImportVideoFile } from './controller/source-import.ts';
import { createProjectImportService } from './controller/project-import-service.ts';
import { createProjectAdminService } from './controller/project-admin-service.ts';
import { fitAudioBufferToFrames } from './controller/audio-buffer-frame-fit.ts';
import { createProjectBinService } from './controller/project-bin-service.ts';
import { admitChangedContentVideoCandidate } from './controller/video-relink-probe.ts';
import { digestMediaContent } from './storage/media-content-digest.ts';
import { createProjectVisualService } from './controller/project-visual-service.ts';
import { createRackEffectService } from './controller/rack-effect-service.ts';
import { createVideoEffectService } from './controller/video-effect-service.ts';
import {
	createTemporaryFileSink,
	stemProject,
} from './controller/temporary-export.ts';
import { createStreamingStemArchive } from './controller/stem-archive.ts';
import { calculateAudioEditorMetronomeSchedule } from './controller/transport-model.ts';
import {
	analyzeChannelsInWorker,
	clipSourceWindowRange,
	generateStoredWaveformPeaks,
	generateWaveformPeaks,
	legacyPeakCacheKey,
	peakCacheKey,
	readWaveformPcmWindow,
	waveformPcmWindowContains,
	waveformPeaksHaveRms,
} from './controller/waveform-analysis.ts';

export { calculateAudioEditorMetronomeSchedule } from './controller/transport-model.ts';

const DEFAULT_PIXELS_PER_SECOND = 120;
const MAX_PIXELS_PER_SECOND = AUDIO_EDITOR_SAMPLE_RATE;
const MAX_TIMELINE_PIXELS = 16_000_000;
const NYQUIST_AGGREGATE_AUDIO_LIMIT_BYTES = 128 * 1024 * 1024;
const LIVE_RECORDING_WAVEFORM_PUBLISH_INTERVAL_MS = 80;
const MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES = 262_144;
const MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES = 32;
const MAXIMUM_TIMER_DELAY_MS = 2_147_000_000;
const PROJECT_LOCK_RETRY_MAX_MS = 30_000;
const AUDIO_DEVICE_PREFERENCES_SETTING_KEY = 'audio-device-preferences-v1';

export function createAudioEditorController(_root = null, options = {}) {
	const lifetime = new EditorControllerLifetime();
	const projectGeneration = new EditorProjectGeneration();
	const projectRuntime = resolveControllerProjectRuntime(options.projectRuntime);
	const { projectDurationFrames, editorTimelineDurationFrames } = createControllerProjectRuntimeMetrics(projectRuntime);
	const copy = Object.freeze({ ...ENGLISH_COPY, ...(options.copy || {}) });
	const locale = normalizeBcp47Locale(options.locale);
	const product = productProfile(options.productId || options.product?.id || 'soundscaper');
	const productId = product.id;
	const capabilities = product.capabilities;
	const preferenceSettingKey = `${productId}:audio-editor-preferences-v1`;
	const recentProjectsSettingKey = `${productId}:audio-editor-recent-project-ids`;
	const lastProjectSettingKey = `${productId}:last-project-id`;
	const productSettingKey = (name) => productId === 'soundscaper' ? name : `${productId}:${name}`;
	const fileService = options.fileService || createAudioEditorFileService();
	const store = options.store || createProjectStore({ memoryFallback: !fileService.isDesktop, linkedOriginalPort: fileService.linkedOriginalPort, linkedVideoOriginalPort: fileService.linkedVideoOriginalPort, desktopProjectBridge: fileService.isDesktop ? (fileService.bridge ?? {}) : null });
	const sourceBuffers = createSourceBufferCache({ maxBytes: options.sourceBufferCacheMaxBytes });
	const mixRenderMemoryLimitBytes = normalizeByteLimit(options.mixRenderMemoryLimitBytes, AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES);
	const sourceChunkProviders = new SourceChunkProviderRegistry();
	const sourcePeaks = new Map();
	const clipWaveformPcmWindows = new Map();
	const clipWaveformPcmRequests = new Map();
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
	const ffmpeg = options.ffmpeg || createEditorFfmpeg({
		onLoading: () => setStatus(copy.ffmpegLoading),
		onProgress: (progress) => updateExportProgress(progress),
	});
	const nyquistClient = options.nyquistEvaluator ? null : new NyquistEvaluationClient(options.nyquistClientOptions);
	const nyquistEvaluator = options.nyquistEvaluator || ((request, evaluateOptions) => (
		nyquistClient.evaluate(request, evaluateOptions)
	));
	const playAtSpeedPitchPreserver = options.playAtSpeedPitchPreserver || (async (
		channels,
		sampleRate,
		rate,
		{ signal, onProgress } = {},
	) => applyAudacityEffectAsync(
		'audacity-change-tempo',
		channels,
		sampleRate,
		{ tempoPercent: (rate - 1) * 100 },
		{
			isCancelled: () => Boolean(signal?.aborted),
			onProgress,
		},
	));
	const state = createEditorControllerState({
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
	const playbackProjectService = options.playbackProjectService || createPlaybackProjectService(product.capabilities);
	let videoNavigationService = null;
	const documentSnapshotRuntime = {
		state, product, productId, capabilities, locale, projectForPlayback: (candidate) => playbackProjectService.projectForPlayback(candidate).project,
		getCurrentProject: () => projectWithVideoEffectGestures(state.history?.present ?? null),
		getProjectTabs: () => sessionController.getSnapshot().tabs,
		getCurrentTabMetadata: (projectId) => sessionTab(projectId)?.metadata || {},
		recordingPreviewSnapshot,
		getAudioDevicesSnapshot: audioDevicesSnapshot, getSoundActivationSnapshot: soundActivationPolicyService.getSnapshot,
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
		getRackEffectTypes: () => audioEffectTypes().map((type) => Object.freeze({
			type,
			label: audioEffectLabel(type, copy),
		})),
		getVideoEffectTypes: () => VIDEO_EFFECT_TYPES.map((type) => VIDEO_EFFECT_DEFINITIONS[type]),
		getVideoNavigationSnapshot: () => !state.disposed && project && capabilities.videoCompositing && videoNavigationService ? videoNavigationService.view() : null,
		getSelectionEffectTypes: () => audioSelectionEffectTypes().map((type) => Object.freeze({
			type,
			label: audioSelectionEffectLabel(type, copy),
		})),
		getSelectionEffectParams: currentAudacityEffectParams,
		getSelectionEffectDefinition: () => AUDIO_SELECTION_EFFECT_DEFINITIONS[state.audacityEffectType] || null,
		getEffectPresets: () => listAudioEditorEffectPresets(state.effectPresets, state.audacityEffectType),
	};
	const documentChannel = createSnapshotChannel({
		build: buildDocumentSnapshot,
		canPublish: () => !state.disposed,
	});
	const telemetryChannel = createSnapshotChannel({
		build: buildTelemetrySnapshot,
		canPublish: () => !state.disposed,
	});
	const taskProgress = createEditorTaskProgressCoordinator({ onChange: (progress) => {
		state.taskProgress = progress;
		publishTelemetrySnapshot();
	} });
	const settingPersistence = createSettingPersistence({
		write: (key, value) => store.saveSetting(key, value),
		isInactive: () => state.disposed,
		onWarning: (error) => handleError(error),
	});
	const mediaDevices = options.mediaDevices || globalThis.navigator?.mediaDevices;
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
	let project = null;
	const getCommandProject = () => projectRuntime.projectForCommandConsumers(project);
	const projectVisualService = createProjectVisualService({
		getProject: () => project, captureProject: (projectId) => projectGeneration.capture(projectId), assertProject: (token) => projectGeneration.assertCurrent(token),
		missingSourceIds: state.missingSourceIds,
		sourceBuffers,
		sourcePeaks,
		waveformPcmWindows: clipWaveformPcmWindows,
		store,
		projectDurationFrames,
		url: {
			createObjectURL: (blob) => globalThis.URL?.createObjectURL?.(blob) || null,
			revokeObjectURL: (url) => globalThis.URL?.revokeObjectURL?.(url),
		},
	});
	const clipTimePitchCacheService = createClipTimePitchCacheService({
		lifetime,
		state,
		cache: clipTimePitchCache,
		sourceResolver: clipTimePitchSourceResolver,
		sourceChunkProviders,
		getProject: () => project,
		captureProject: (projectId) => projectGeneration.capture(projectId),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		createBufferFromChannels: async (channels, sampleRate) => {
			const context = await engine.getAudioContext?.({ resume: false });
			return bufferFromChannels([...channels], sampleRate, context, copy);
		},
		createRenderEngine: (renderOptions) => renderEngineFactory(renderOptions),
		applyProjectToPlaybackEngine,
		getPlaybackState: () => engine.getState().state,
		handleError,
	});
	const sourceLifecycleService = createSourceLifecycleService({
		MAXIMUM_WAVEFORM_PCM_WINDOW_ENTRIES, MAXIMUM_WAVEFORM_PCM_WINDOW_FRAMES,
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES, activateVideoSource, allProjectClips,
		audioBufferChannels, clipSourceWindowRange, clipWaveformPcmRequests,
		clipWaveformPcmWindows, copy, createStoredChunkProvider, engine, findClip,
		findSource, generateStoredWaveformPeaks, generateWaveformPeaks,
		getProject: () => project, isStreamableStoredSource, legacyPeakCacheKey,
		peakCacheKey, publishDocumentSnapshot, readStoredAudioBuffer,
		readWaveformPcmWindow, setStatus, sourceAudioBufferBytes, sourceBuffers,
		sourceChunkProviders, sourcePcmBytes, sourcePeaks, state, store,
		waveformPcmWindowContains, waveformPeaksHaveRms,
	});
	const playbackProjectApplyService = createPlaybackProjectApplyService({
		lifetime, projectForPlayback: playbackProjectService.projectForPlayback, getCurrentProject: () => project,
		ensureProjectSourcesAvailable, prepareRequiredProjectSources: sourceLifecycleService.prepareRequiredProjectSources, sourceBuffers, sourceChunkProviders, engine,
		setReadyStatus: () => setStatus(copy.ready),
	});
	const preferencesService = createEditorPreferencesService({
		productId,
		preferenceSettingKey,
		defaultWorkspace: product.defaultWorkspace,
		newerSchemaMessage: copy.preferencesNewerSchema,
		shortcutActionRequired: copy.shortcutActionRequired,
		shortcutConflict: copy.shortcutConflict,
		getPreferences: () => state.preferences,
		setPreferences: (preferences) => { state.preferences = preferences; },
		getReadOnly: () => state.preferencesReadOnly,
		setReadOnly: (readOnly) => { state.preferencesReadOnly = readOnly; },
		loadSetting: (key, fallback) => store.loadSetting(key, fallback),
		persistSetting: (key, value) => persistSetting(key, value),
		persistSettingRequired: (key, value) => persistSetting(key, value, { policy: 'required' }),
		publish: publishDocumentSnapshot,
		loadPreferences: loadAudioEditorPreferencesV1,
		createPreferences: (activeId) => createAudioEditorPreferencesV1({ workspace: { activeId } }),
		applyWorkspace: applyAudioEditorWorkspace,
		updatePreferences: updateAudioEditorPreferencesV1,
		normalizeShortcut: normalizeAudioEditorShortcut,
		findShortcutConflicts: findAudioEditorShortcutConflicts,
		createWorkspace: createCustomAudioEditorWorkspace,
		updateWorkspace: updateCustomAudioEditorWorkspace,
		deleteWorkspace: deleteCustomAudioEditorWorkspace,
	});
	const projectSessionService = createProjectSessionService({
		productId,
		recentProjectsSettingKey,
		lastProjectSettingKey,
		getRecentProjectIds: () => state.recentProjectIds,
		setRecentProjectIds: (projectIds) => { state.recentProjectIds = projectIds; },
		getActiveProjectId: () => project?.id ?? null,
		state, findTrack, findClip,
		getTabs: () => sessionController.getSnapshot().tabs,
		updateProjectMetadata: (projectId, metadata) => sessionController.updateProjectMetadata(projectId, metadata),
		loadSetting: (key, fallback) => store.loadSetting(key, fallback),
		persistSetting: (key, value) => persistSetting(key, value),
		publish: publishDocumentSnapshot,
	});
	const projectSaveService = createProjectSaveService({
		state,
		getProject: () => project,
		hasHistory: () => Boolean(state.history), hasUnsavedProjectChanges: () => Boolean(project && sessionTab(project.id)?.dirty),
		isReadOnly: () => state.readOnly || Boolean(state.takeCycleRecovery || state.takeCycleRecoveryInspecting),
		cloneProject: projectRuntime.cloneProject, admitProjectPublication: (bytes) => preflightStorage(bytes, 'project'), collectProtectedLinkedOriginalSourceReferences: () => projectRetentionService.liveSessionLinkedOriginalSourceReferences(),
		saveProject: (snapshot, options) => store.saveProject(snapshot, options),
		persistActiveProjectId: async (projectId) => {
			await persistSetting(lastProjectSettingKey, projectId);
			if (productId === 'soundscaper') await persistSetting('last-project-id', projectId);
		},
		isCurrentProject: (projectId) => project?.id === projectId,
		hasSessionTab: (projectId) => Boolean(sessionTab(projectId)),
		markProjectSaved: (projectId) => sessionController.markProjectSaved(projectId),
		publish: publishDocumentSnapshot,
		garbageCollect: garbageCollectSources,
		refreshStorageUsage,
		handleError,
		scheduleTimer,
		clearTimer: clearScheduledTimer,
	});
	const projectRetentionService = createProjectRetentionService({
		state,
		getProject: () => project,
		setProject: (nextProject) => { project = nextProject; },
		compactHistory: compactEditorHistorySourceMetadata,
		sessionTab,
		updateProjectHistory: (projectId, history, updateOptions) => (
			sessionController.updateProjectHistory(projectId, history, updateOptions)
		),
		getSourceReferenceCounts: () => sessionController.getSourceReferenceCounts(),
		getSessionTabs: () => sessionController.getSnapshot().tabs,
		editorHistoryProjects,
		allProjectClips,
		clipCache: clipTimePitchCache,
		sourceBuffers,
		sourcePeaks,
		evictSourceCaches: evictUnreferencedSourceCaches,
	});
	const projectViewService = createProjectViewService({
		lifetime, state, getProject: () => project, projectDurationFrames, editorTimelineDurationFrames,
		projectSampleRate: () => projectSampleRate(),
		maximumTimelinePixels: MAX_TIMELINE_PIXELS,
		synchronizeAutomaticSampleEditMode, updatePlayhead, publishDocumentSnapshot, editingBlocked, commit,
		getEnginePositionFrames: () => engine.getPositionFrames(),
	});
	const timelineAnnotationService = createTimelineAnnotationService({
		lifetime, state, getProject: () => project, editingBlocked, createId: createStableId,
		getPositionFrames: () => engine.getPositionFrames(), commit, updateSelection, publishProjectState,
	});
	const regularIntervalAnnotationController = createRegularIntervalAnnotationController({ getProject: () => project, editingBlocked, createId: createStableId, commit });
	const trackFolderService = createTrackFolderService({
		lifetime, getProject: () => project, editingBlocked, createId: createStableId,
		commit, publishProjectState,
	});
	const projectMutationService = createProjectMutationService({
		lifetime,
		state,
		productName: product.name,
		capabilities,
		projectReadOnlyMessage: copy.projectReadOnly,
		getProject: () => project,
		setProject: (nextProject) => { project = nextProject; },
		getHistory: () => state.history,
		setHistory: (history) => { state.history = history; },
		executeEditorCommand: projectRuntime.executeCommand,
		applyEditorCommand: projectRuntime.applyCommand,
		retention: projectRetentionService,
		publisher: projectViewService,
		saves: projectSaveService,
		stopProjectBinPreview,
		clearWaveformPcmWindows,
		normalizeRecordingRouting,
		persistRecordingRouting,
		findClip,
		findTrack,
		synchronizeMicrophoneMeterTarget,
		synchronizeAnnotationFocus: () => timelineAnnotationService.synchronizeFocus(false),
		getPlaybackState: () => engine.getState().state,
		projectHasTimePitchClips,
		beginPlaybackCachePreparation,
		applyProjectToPlaybackEngine,
		captureProject: (projectId) => projectGeneration.capture(projectId),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		handleError,
		isExpectedCancellation: (error) => (
			isEditorDisposedError(error) || error?.name === 'AbortError'
		),
	});
	const trackDuplicationService = createTrackDuplicationService({
		lifetime,
		copySuffix: copy.projectCopySuffix,
		editingBlocked,
		getProject: () => project,
		createId: createStableId,
		findClip,
		cloneVideoEffects,
		createAddTrackCommand,
		createAddClipCommand, prepareTrackDuplicateCarrier: projectRuntime.prepareTrackDuplicateCarrier,
		commit,
	});
	const projectAdminService = createProjectAdminService({
		cancelPlaybackCachePreparation,
		clearScheduledTimer: globalThis.clearTimeout.bind(globalThis),
		clearWaveformPcmWindows,
		clipTimePitchCache, commit, copy, currentTimeMs, editorHistoryProjects, engine,
		evictUnreferencedSourceCaches, flushProject, getProject: () => project, handleError,
		liveSessionClipIds, liveSessionLinkedOriginalSourceReferences: projectRetentionService.liveSessionLinkedOriginalSourceReferences, liveSessionSourceIds, newProject, openProject, persistSetting,
		projectGeneration, projectSaveService, projectMaintenanceRuntime: options.projectMaintenanceRuntime, projectSessionService, publishDocumentSnapshot,
		recordingRoutingSettingKey, releaseProjectLock, revokeVideoVisuals, saveNow,
		scheduleTimer: globalThis.setTimeout.bind(globalThis), sessionController, sessionTab,
		setProject: (nextProject) => { project = nextProject; },
		disposeRenderEngines: clipTimePitchCacheService.disposeRenderEngines, sourceBuffers, sourceChunkProviders, sourcePeaks, state, stopProjectBinPreview, stopRecording, store,
		switchProject,
	});
	const analysisService = createAudioAnalysisService({
		lifetime, copy, state,
		captureProject: () => projectGeneration.capture(project?.id ?? null),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		getProject: () => project,
		getSelectedTrackId: () => state.selectedTrackId,
		getRange: analysisRange,
		getActiveSelection: activeSelection,
		getSpectrumWindowSize: () => state.preferences?.spectrogram?.windowSize ?? 2_048,
		getContrastSelections: () => state.contrastSelections,
		setContrastSelections: (value) => { state.contrastSelections = value; },
		loadAnalysis: (key) => store.loadAnalysis(key),
		saveAnalysis: (key, value) => store.saveAnalysis(key, value),
		renderAudio: renderAnalysisAudio,
		analyzeChannels: (channels, sampleRate, signal) => analyzeChannelsInWorker(channels, sampleRate, copy, 65_536, signal),
		createVisuals: createAnalysisVisuals,
		showAnalysis,
		setProcessing: (processing) => { state.analysisProcessing = processing; },
		setStatus,
		publish: publishDocumentSnapshot,
		handleError,
	});
	const progressAnalysisService = Object.freeze({
		...analysisService,
		run: (...args) => taskProgress.run('analysis', copy.analysisRendering, () => analysisService.run(...args)),
		plotSpectrum: (...args) => taskProgress.run('analysis', copy.analysisRendering, () => analysisService.plotSpectrum(...args)),
		findClipping: (...args) => taskProgress.run('analysis', copy.analysisRendering, () => analysisService.findClipping(...args)),
		captureContrast: (...args) => taskProgress.run('analysis', copy.contrastAnalyzing, () => analysisService.captureContrast(...args)), repeatLast: (...args) => taskProgress.run('analysis', copy.analysisRendering, () => analysisService.repeatLast(...args)), measureLoudness: (...args) => taskProgress.run('analysis', copy.measuringLoudness, () => analysisService.measureLoudness(...args)),
	});
	const unsubscribeParametricEqErrors = typeof engine.subscribeParametricEqErrors === 'function'
		? engine.subscribeParametricEqErrors((error) => handleError(error))
		: () => {};
	const projectLockService = createProjectLockService({
		state, cancelTask: (...args) => lifetime.cancelTask(...args),
		getProjectId: () => project?.id ?? null,
		getProjectMetadata: (projectId) => sessionTab(projectId)?.metadata || {},
		acquireProjectLock: acquireLock,
		setProjectReadOnly: (projectId, update) => sessionController.setProjectReadOnly(projectId, update),
		publishProjectState,
		setStatus,
		handleError,
		invalidateRecordingAuthority: invalidateTakeCycleRecording, revokeWriteAuthority: () => rackEffectService.revokeWriteAuthority(),
		copy,
		retryMaximumMs: PROJECT_LOCK_RETRY_MAX_MS,
		currentTimeMs: Date.now,
		scheduleTimer: (callback, delayMs) => Number(globalThis.setTimeout(callback, delayMs)),
		clearTimer: (timer) => globalThis.clearTimeout(timer),
	});
	const { inspectScape, openScapeFile, scapeInspectionQuiescence } = createScapeProjectFileService({ lifetime, store, openScape, productCapabilities: product.capabilities, inspectScapeProject: options.scapeProjectRuntime?.inspectScapeProject, scapeInspectionQuiescenceOptions: options.scapeInspectionQuiescenceOptions });
	const projectSwitchService = createProjectSwitchService({
		state, lifetime, scapeInspectionQuiescence, projectGeneration, copy, productCapabilities: product.capabilities,
		getProject: () => project,
		setProject: (nextProject) => { project = nextProject; },
		createProject: projectRuntime.createProject,
		normalizeProjectSampleRate,
		createInitialAudioTrackCommand: createAddTrackCommand,
		createHistory: projectRuntime.createHistory,
		executeCommand: projectRuntime.executeCommand,
		migrateProject: projectRuntime.migrateProject,
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
		cancelScheduledSave: projectSaveService.cancelScheduled,
		stopEngine: () => engine.stop(), stopProjectBinPreview, disposeRenderEngines: clipTimePitchCacheService.disposeRenderEngines,
		beginSourceChunkProviderReplacement: () => sourceChunkProviders.beginReplacement(),
		cancelEffectPreview: cancelAudacityEffectPreview,
		releaseProjectLock: (...args) => projectLockService.releaseProjectLock(...args),
		acquireProjectLock: acquireLock,
		watchProjectLockLoss: projectLockService.watchProjectLockLoss,
		scheduleProjectLockRecovery: projectLockService.scheduleProjectLockRecovery,
		sessionTab,
		session: sessionController,
		loadRecordingRouting,
		restoreProjectSelection: projectSessionService.restoreProjectSelection,
		revokeOutputUrl: (url) => URL.revokeObjectURL(url),
		revokeVideoVisuals,
		clearWaveformPcmWindows,
		loadProjectSources, prepareRequiredProjectSources: sourceLifecycleService.prepareRequiredProjectSources,
		retainLiveClipIds: projectRetentionService.retainLiveClipIds,
		evictUnreferencedSourceCaches: () => evictUnreferencedSourceCaches(
			sourceBuffers, sourcePeaks, projectRetentionService.liveSessionSourceIds(),
		),
		loadEngineProject: (activeProject, transientBuffers, preparedSources) => engine.loadProject(activeProject, preparedSources?.sourceBuffers
				?? (transientBuffers?.size ? new Map([...sourceBuffers, ...transientBuffers]) : sourceBuffers), { chunkSources: preparedSources?.chunkSources ?? sourceChunkProviders }), openRecovery: takeCycleOpenRecovery,
		recordOpenedProject: (projectId, guard) => projectSessionService.recordOpenedProject(projectId, guard), maintainOpenedProject: (projectId, isCurrentWritable) => store.maintainOpenedProject?.(projectId, () => isCurrentWritable() ? projectRetentionService.liveSessionLinkedOriginalSourceReferences() : null),
		createProjectIfAbsent: options.createProjectIfAbsent,
		saveProject: (activeProject) => store.saveProject(activeProject, { protectedLinkedOriginalSourceReferences: projectRetentionService.liveSessionLinkedOriginalSourceReferences() }),
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
		audioDevicePreferencesSettingKey: AUDIO_DEVICE_PREFERENCES_SETTING_KEY,
		recordingInputGainDefault: RECORDING_INPUT_GAIN_DEFAULT,
		loadPreferences,
		createEffectPresets: createAudioEditorEffectPresets,
		normalizeRecordingInputGain,
		normalizeLatencyOffset,
		normalizeAudioDevicePreferences,
		refreshAudioDevices,
		setRemoveDeviceChangeListener: (remove) => { removeDeviceChangeListener = remove; },
		loadRecentProjectState: (guard) => projectSessionService.loadRecentProjectState(guard),
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
		getProject: () => project,
		switchProject,
		editingBlocked,
		flushProject,
		hasMissingTimelineSources,
		estimateStorageForPreflight, preflightStorage,
		createStableId,
		ensureAup4FileName,
		ensureScapeFileName,
		sourcePcmBytes,
		loadStoredSourceChannels,
		requestAup4FileHandle,
		saveAup4Result,
		createAup4Client,
		initialAup4Client: options.aup4Client || null,
		aup4Options: options.aup4 || {}, adaptAudacityProject: options.adaptAudacityProject,
		migrateProject: projectRuntime.migrateProject,
		importScapeProject: options.scapeProjectRuntime?.importScapeProject || importScapeProject,
		exportScapeProject: options.scapeProjectRuntime?.exportScapeProject || exportScapeProject,
		copyFutureScapeArchive: options.scapeProjectRuntime?.copyScapeArchive || copyFutureScapeArchive,
		normalizeCompatibilityReport: normalizeAup4CompatibilityReport,
		reportHasMissingPcm: aup4ReportHasMissingPcm,
		sessionTab,
		updateProjectMetadata: (projectId, metadata) => sessionController.updateProjectMetadata(projectId, metadata),
		setStatus,
		publishDocumentSnapshot,
		sourceBuffers,
		sourceChunkFrames: SOURCE_CHUNK_FRAMES,
		scapeMimeType: SCAPE_MIME_TYPE,
	});

	const bootstrapToken = lifetime.capture();
	const ready = bootstrap(bootstrapToken)
		.then(() => {
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
	const {
		setPlayAtSpeedRate,
		cancelPlayAtSpeedPreparation,
		handlePlayAtSpeed,
		handleTransport,
		clearLoopRegion,
		setLoopRegionToSelection,
		setLoopRegion,
		setSelectionToLoopRegion,
		setLoopRegionInOut,
		toggleSelectionFollowsLoop,
		toggleMetronome,
		syncMetronome,
		stopMetronome,
		normalizeTimelineFrame,
		normalizePlaybackFrame,
		projectSampleRate,
	} = createEditorTransportService({
		AUDIO_EDITOR_SAMPLE_RATE, abortError, activeSelection, assertPlayAtSpeedStaffPadMemorySafe,
		beginPlaybackCachePreparation, calculateAudioEditorMetronomeSchedule, cancelPlaybackCachePreparation, cancelTimedRecording,
		commit, copy, editorTimelineDurationFrames, engine,
		formatPlaybackRate, hasMissingTimelineSources, persistSetting, playAtSpeedPitchPreserver,
		productSettingKey, getProject: () => project, projectDurationFrames, publishDocumentSnapshot,
		setSelection, setStatus, startRecording, state,
		stopProjectBinPreview, stopRecording, throwIfAborted,
	});
	const sequenceTimingService = createSequenceTimingService({
		lifetime, getProject: () => project, editingBlocked, commit, publishProjectState,
		getPositionFrames: () => engine.getPositionFrames(),
		seek: (frame) => engine.seek(normalizePlaybackFrame(frame)),
	});
	const sourceMonitorService = createSourceMonitorService({
		lifetime, getProject: getCommandProject, publishProjectState,
	});
	const videoEditService = createVideoEditService({
		lifetime, getProject: getCommandProject, editingBlocked, commit, publishProjectState,
		getSelectedTrackId: () => state.selectedTrackId,
		prepareThreePointEditCommand: (commandProject, options) => (
			prepareThreePointEditCommand(commandProject, options, createStableId)
		),
		getPositionFrames: () => engine.getPositionFrames(),
		sourceMonitor: sourceMonitorService,
	});
	videoNavigationService = createVideoNavigationService({
		lifetime, getProject: getCommandProject, getProjectIdentity: () => project,
		getTargets: () => videoEditService.targets(), getPositionFrames: () => engine.getPositionFrames(),
		now: typeof options.monotonicNow === 'function' ? options.monotonicNow : () => globalThis.performance?.now?.() ?? currentTimeMs(),
		setInterval: scheduleInterval, clearInterval: clearScheduledInterval,
		scrub: async (frame) => {
			cancelPlaybackCachePreparation(); cancelPlayAtSpeedPreparation(); engine.pause();
			const previewStop = stopProjectBinPreview();
			const target = normalizePlaybackFrame(frame);
			const result = hasMissingTimelineSources() || typeof engine.scrub !== 'function'
				? engine.seek(target)
				: engine.scrub(target);
			await previewStop;
			return result;
		},
		seek: (frame) => engine.seek(normalizePlaybackFrame(frame)), endScrub: () => engine.endScrub?.(),
		publish: publishDocumentSnapshot, handleError,
	});
	const videoTrimServices = createVideoTrimServices({
		lifetime, getProject: getCommandProject, editingBlocked, commit,
		copy, label: sequenceTimingService.label, setStatus,
	});
	const videoSourceReprobeService = createVideoSourceReprobeService({
		lifetime, store, ffmpeg, getProject: () => project, editingBlocked, commit, publishProjectState,
		captureProject: (projectId) => projectGeneration.capture(projectId),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		createAudioEditorVideoFrameExtractor,
		activateVideoSource: (source, options) => activateVideoSource(source, options),
	});
	const viewStateService = createViewStateService({
		MAX_PIXELS_PER_SECOND, MAX_TIMELINE_PIXELS, commit, copy, editingBlocked,
		editorTimelineDurationFrames, findTrack,
		getMicrophoneMeterSession: microphoneMeterService.getSession,
		getProject: () => project,
		getRoutedInputLoudnessMeter: microphoneMeterService.getRoutedLoudnessMeter,
		projectDurationFrames, projectSampleRate, publishProjectState,
		publishTelemetrySnapshot, sampleEditingAvailable, state,
		stopMicrophoneMetering, syncMetronome,
	});
	const sampleEditService = createSampleEditService({
		activeSelection, activateStoredSource, canEditAudioSamplesAtZoom, commit, copy,
		createAddSourceCommand, createPencilSampleEdits, createReplaceClipSourceCommand,
		createSmoothSampleRange, createStableId, editingBlocked, findClip, findClipTrack,
		findSource, getProject: () => project, peakCacheKey, persistImmutableSampleEdit,
		preflightStorage, projectSampleRate, publishDocumentSnapshot, setStatus,
		retireSourceChunkProvider: sourceLifecycleService.retireSourceChunkProvider, sourceBuffers, sourcePeaks, state, store, throwIfAborted,
	});
	const clipTransformService = createClipTransformService({
		lifetime,
		copy,
		getProject: getCommandProject,
		getSelectedClipId: () => state.selectedClipId,
		editingBlocked,
		createId: createStableId,
		snapTimelineFrame,
		activeSelection,
		commit,
	});
	const clipPropertyService = createClipPropertyService({
		lifetime,
		copy,
		sourceBuffers,
		getProject: () => project,
		getSelectedClipId: () => state.selectedClipId,
		editingBlocked,
		captureProject: () => projectGeneration.capture(project?.id ?? null),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		analyzeChannels: (channels, sampleRate, signal) => (
			analyzeChannelsInWorker([...channels], sampleRate, copy, 65_536, signal)
		),
		createId: createStableId,
		commit,
	});
	const clipTimePitchRenderService = createClipTimePitchRenderService({
		lifetime,
		copy,
		store,
		sourceBuffers,
		sourcePeaks,
		sourceChunkFrames: SOURCE_CHUNK_FRAMES,
		getProject: () => project,
		getSelectedClipId: () => state.selectedClipId,
		editingBlocked,
		captureProject: () => projectGeneration.capture(project?.id ?? null),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		prepareCommittedOutput: (clip, source, { signal }) => (
			clipTimePitchCache.prepareCommittedOutput(clip, source, { signal, onProgress: (value) => taskProgress.updateActive(value) })
		),
		materializeEntry: (entry, signal) => (
			clipTimePitchCacheService.materializeTimePitchCacheEntry(entry, signal)
		),
		preflightStorage,
		createId: createStableId,
		writeBuffer,
		generateWaveformPeaks: (channels, _signal) => generateWaveformPeaks([...channels], copy),
		peakCacheKey,
		cacheSourceBuffer,
		commit,
		setProcessing: (processing) => { state.audacityEffectProcessing = processing; },
		setStatus,
		publish: publishDocumentSnapshot,
	});
	let trackService;
	const recordingRoutingService = createRecordingRoutingService({
		AUDIO_DEVICE_PREFERENCES_SETTING_KEY, RECORDING_CHANNEL_COUNT_MAXIMUM, RECORDING_DEFAULT_DEVICE_ID,
		RECORDING_DISPLAY_SOURCE_KEY,
		assignPreferredInputToTrack: (...args) => trackService.assignPreferredInputToTrack(...args),
		engine,
		getMicrophoneMeterSession: microphoneMeterService.getSession,
		invalidateMicrophoneMeter: microphoneMeterService.invalidate,
		mediaDevices, microphoneMeterDeviceId: microphoneMeterService.getDeviceId, normalizePreferredInputDeviceId,
		normalizePreferredOutputDeviceId, normalizeRecordingRouting, persistSetting,
		productSettingKey, getProject: () => project, projectSampleRate,
		publishDocumentSnapshot, recordingCapturePool, recordingRouteSourceKey,
		recordingRoutingSettingKey, setRecordingSourceOffset, setRecordingTrackInput,
		state, stopMicrophoneMetering, store, updatePreferences,
	});
	const derivedSourceService = createDerivedSourceService({
		lifetime, copy, store, retireSourceChunkProvider: sourceLifecycleService.retireSourceChunkProvider, sourceBuffers, sourcePeaks,
		sourceChunkFrames: SOURCE_CHUNK_FRAMES,
		getProject: () => project,
		captureProject: () => projectGeneration.capture(project?.id ?? null),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		createId: createStableId,
		projectSampleRate,
		getAudioContext: () => engine.getAudioContext({ resume: false }),
		createBufferFromChannels: (channels, sampleRate, context) => (
			bufferFromChannels(channels, sampleRate, context, copy)
		),
		loadSourceChannels: (source) => loadStoredSourceChannels(store, source),
		writeBuffer,
		generateWaveformPeaks: (channels) => generateWaveformPeaks(channels, copy),
		peakCacheKey,
		cacheSourceBuffer,
	});
	const trackTransformService = createTrackTransformService({
		lifetime, copy, derivedSources: derivedSourceService,
		getProject: () => project,
		getSelectedTrackId: () => state.selectedTrackId,
		editingBlocked,
		captureProject: () => projectGeneration.capture(project?.id ?? null),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		createId: createStableId,
		commit,
		projectSampleRate,
		normalizeProjectSampleRate,
		audioTrackChannelCount: audioTrackChannelCountV2,
		preflightStorage,
		setProcessing: (processing) => { state.audacityEffectProcessing = processing; },
		setStatus,
		publish: publishDocumentSnapshot,
		resampleChannels: resampleChannelsWindowedSinc,
		renderDryTrackRange,
	});
	trackService = createEditorTrackService({
		lifetime, copy, trackColors: AUDIO_EDITOR_TRACK_COLORS,
		getProject: () => project,
		getSelectedTrackId: () => state.selectedTrackId,
		editingBlocked,
		createId: createStableId,
		commit,
		getPositionFrames: () => engine.getPositionFrames(),
		snapTimelineFrame,
		setTimelineView: (value) => { state.timelineView = value; },
		resampleTrack: (...args) => trackTransformService.resampleTrack(...args),
		recording: {
			defaultDeviceId: RECORDING_DEFAULT_DEVICE_ID,
			displaySourceKey: RECORDING_DISPLAY_SOURCE_KEY,
			getRouting: () => state.recordingRouting,
			setRouting: (routing) => { state.recordingRouting = routing; },
			getPreferredDeviceId: () => state.preferredInputDeviceId,
			getPreferredChannelCount: () => state.preferredInputChannelCount,
			getDevices: () => state.recordingDevices,
			getPoolSources: () => state.recordingPoolSources,
			setTrackRoute: setRecordingTrackRoute,
			setRouteHealth: (trackId, health) => { state.recordingRouteHealth[trackId] = health; },
			updateDeviceRows: updateRecordingDeviceRows,
			persistRouting: persistRecordingRouting,
			publish: publishDocumentSnapshot,
		},
	});
	const {
		addTrack, addVideoTrackPair, assignPreferredInputToTrack, addLabelTrack,
		reorderTrack, moveTrack, setTrackDisplayMode, setTrackRate, setTrackSampleFormat,
	} = createTrackActionAdapter({
		service: trackService,
		getSelectedTrackId: () => state.selectedTrackId,
		projectSampleRate,
	});
	const {
		exportVideo,
		handleExportAction,
		renderSnapshot,
	} = createEditorExportService({
		abortError, applyMediaChannelMapping, audioBufferChannels, cloneProject: projectRuntime.cloneProject,
		copy, createAiffStreamEncoder, createCacheAwareRenderEngine, createExportPlan,
		createStableId, createStreamingStemArchive, createStreamingWindowedSincResampler, createTemporaryFileSink,
		createVideoExportPlan, createWavStreamEncoder, encodeAiff, encodeWav,
		ffmpeg, fileService, findClip, findSource,
		handleError, hasMissingTimelineSources, lifetime, normalizeExportSettings, playbackProjects: playbackProjectService,
		normalizeProjectSampleRate, options, preflightStorage, prepareCommittedTimePitchCaches,
		getProject: () => project, productName: product.name, projectGeneration, projectSampleRate, publishDocumentSnapshot,
		resampleBuffer, setStatus, sourceBuffers, sourceChunkProviders, state,
		stemProject, store, throwIfAborted, toggleExport,
		updateExportProgress, taskProgress, verifyProjectFallbackIntegrity,
	});
	const takeCompService = createTakeCompControllerComposition({
		lifetime, sourceBuffers, sourceChunkProviders, sourceResolver: clipTimePitchSourceResolver,
		derivedSources: derivedSourceService, getProject: () => project, editingBlocked, commit,
		createId: createStableId, captureProject: () => projectGeneration.capture(project?.id ?? null),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		createPreviewEngine: (previewOptions) => renderEngineFactory(previewOptions),
		stopPlayback: () => engine.stop(), renderSnapshot, setStatus,
	});
	const audioWarpService = createAudioWarpControllerComposition({ lifetime, store, getProject: () => project, getSelectedClipId: () => state.selectedClipId, editingBlocked, commit, captureProject: () => projectGeneration.capture(project?.id ?? null), assertProject: (token) => projectGeneration.assertCurrent(token), getRenderStatus: () => engine.getAudioWarpRenderStatus(), setAnalysisProcessing: (processing) => { state.analysisProcessing = processing; }, publish: publishDocumentSnapshot });
	const mixRenderService = createMixRenderService({
		lifetime, copy, derivedSources: derivedSourceService,
		store, sourceBuffers, sourceChunkFrames: SOURCE_CHUNK_FRAMES,
		memoryLimitBytes: mixRenderMemoryLimitBytes,
		getProject: () => project,
		getSelectedTrackId: () => state.selectedTrackId,
		getSelectedClipId: () => state.selectedClipId,
		editingBlocked,
		captureProject: () => projectGeneration.capture(project?.id ?? null),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		createId: createStableId,
		commit,
		preflightStorage,
		setProcessing: (processing) => { state.audacityEffectProcessing = processing; },
		setStatus,
		publish: publishDocumentSnapshot,
		handleError,
		rackTailFrames,
		isFixedStereoEffect: isAudacityRackEffectType,
		renderSnapshot,
		getAudioContext: () => engine.getAudioContext({ resume: false }),
		createBufferFromChannels: (channels, sampleRate, context) => (
			bufferFromChannels(channels, sampleRate, context, copy)
		),
		createRenderEngine: createCacheAwareRenderEngine,
		createStreamingWriter: createCoalescingSourceWriter,
		prepareCommittedTimePitchCaches,
		activateStoredSource,
	});
	const selectionViewService = createSelectionViewService({
		DEFAULT_PIXELS_PER_SECOND, MAX_PIXELS_PER_SECOND, MAX_TIMELINE_PIXELS,
		activeSelection, audioBufferChannels, cloneProject: projectRuntime.cloneProject, collectRelatedClipIds,
		commit, copy, editorTimelineDurationFrames, engine, findClip, findClipTrack,
		findNearestAudioZeroCrossing, findTrack, getProject: () => project, handleError,
		normalizeTimelineFrame, persistSetting, productSettingKey, projectDurationFrames,
		projectSampleRate, publishDocumentSnapshot, publishProjectState, renderSnapshot,
		resetRoutedInputMeter: microphoneMeterService.clearRoutedLoudnessMeter,
		setStatus, snapAudioEditorFrameWithProject, state, synchronizeAutomaticSampleEditMode,
		synchronizeMicrophoneMeterTarget: microphoneMeterService.synchronizeTarget, updatePlayhead, updateSelection,
	});
	const selectionEffectWorkerService = createSelectionEffectWorkerService({
		state,
		copy,
		captureProject: () => projectGeneration.capture(project.id),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		loadParametricEqWasmModule,
		initializePffft,
		captureNoiseProfile: captureAudacityNoiseProfile,
		applySelectionEffect: applyAudioSelectionEffectAsync,
		applySpectralGain,
		onProgress: (value) => taskProgress.updateActive(value),
	});
	const effectSelectionService = createEffectSelectionService({
		state,
		copy,
		getProject: () => project,
		activeSelection,
		resolveEditingSelection,
		audacitySelectionChannelCount,
		audioTrackChannelCount: audioTrackChannelCountV2,
		selectedTracksTimeRange,
		projectSampleRate,
		editingBlocked,
		setSelection: (...args) => setSelection(...args),
	});
	const effectControlsService = createEffectControlsService({
		state,
		copy,
		createId: createStableId,
		getProject: () => project,
		persistSetting,
		publishDocumentSnapshot,
		setStatus,
		applySelectedAudacityEffect: () => applySelectedAudacityEffect(),
		captureRackNoiseProfile: (...args) => effectAudioService.captureRackNoiseProfile(...args),
	});
	const effectAudioService = createEffectAudioService({
		lifetime,
		captureProject: () => projectGeneration.capture(project.id),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		state,
		copy,
		memoryLimitBytes: AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES,
		getProject: () => project,
		activeSelection,
		audacityEffectTarget: (...args) => effectSelectionService.audacityEffectTarget(...args),
		audacityEffectTargets: (...args) => effectSelectionService.audacityEffectTargets(...args),
		audacityEffectSelectionDetails: (...args) => effectSelectionService.audacityEffectSelectionDetails(...args),
		editingBlocked,
		projectSampleRate,
		currentAudacityEffectParams: (...args) => effectControlsService.currentAudacityEffectParams(...args),
		estimateAudacityEffectPeakBytes,
		audacityEffectMemoryError: () => audacityEffectMemoryError(copy),
		preflightStorage,
		cloneProject: projectRuntime.cloneProject,
		audacitySelectionChannelCount,
		renderSnapshot,
		prepareCommittedTimePitchCaches,
		createRenderEngine: createCacheAwareRenderEngine,
		sourceBuffers,
		audioBufferChannels,
		matchAudacitySelectionChannels,
		runSelectionEffectWorker: (...args) => selectionEffectWorkerService.runSelectionEffectWorker(...args),
		runSpectralEditWorker: (...args) => selectionEffectWorkerService.runSpectralEditWorker(...args),
		serializeNoiseProfile: serializeAudacityNoiseProfile,
		commit,
		persistAudacityEffectResults: (...args) => persistAudacityEffectResults(...args),
		setStatus,
		publishDocumentSnapshot,
	});
	const nyquistHostService = createNyquistHostService({
		state,
		copy,
		locale,
		getProject: () => project,
		captureProject: () => projectGeneration.capture(project.id),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		activeSelection,
		projectSampleRate,
		getPositionFrames: () => engine.getPositionFrames(),
		getAudioContext: () => engine.getAudioContext({ resume: true }),
		pauseTransport: () => engine.pause(),
		assertAudioOutput: assertAudacityEffectOutput,
		bufferFromChannels: (channels, sampleRate, context) => (
			bufferFromChannels(channels, sampleRate, context, copy)
		),
		cancelAudacityEffectPreview: (...args) => effectControlsService.cancelAudacityEffectPreview(...args),
		createId: createStableId,
		commit,
		setStatus,
		publishDocumentSnapshot,
	});
	const nyquistGeneratedAudioService = createNyquistGeneratedAudioService({
		state,
		copy,
		sourceChunkFrames: SOURCE_CHUNK_FRAMES,
		getProject: () => project,
		captureProject: () => projectGeneration.capture(project.id),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		activeSelection,
		audacityEffectTarget: (...args) => effectSelectionService.audacityEffectTarget(...args),
		persistAudacityEffectResult: (...args) => persistAudacityEffectResult(...args),
		matchAudacitySelectionChannels,
		assertAudioOutput: assertAudacityEffectOutput,
		projectSampleRate,
		preflightStorage,
		createId: createStableId,
		getAudioContext: () => engine.getAudioContext({ resume: false }),
		bufferFromChannels: (channels, sampleRate, context) => (
			bufferFromChannels(channels, sampleRate, context, copy)
		),
		store,
		writeBuffer,
		snapTimelineFrame,
		getPositionFrames: () => engine.getPositionFrames(),
		cacheSourceBuffer,
		generateWaveformPeaks,
		peakCacheKey,
		sourceBuffers,
		sourcePeaks,
		commit,
	});
	const effectMacroService = createEffectMacroService({
		lifetime,
		projectGeneration,
		copy,
		memoryLimitBytes: AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES,
		getProject: () => project,
		audacityEffectTarget: (...args) => effectSelectionService.audacityEffectTarget(...args),
		editingBlocked,
		materializeRackEffect: (...args) => materializeRackEffect(...args),
		projectSampleRate,
		effectRackLatencyFrames,
		isAudacityRackEffectType,
		estimateAudacityEffectPeakBytes,
		audacityEffectMemoryError: () => audacityEffectMemoryError(copy),
		setProcessing: (value) => { state.audacityEffectProcessing = value; },
		setStatus,
		publishDocumentSnapshot,
		preflightStorage,
		cloneProject: projectRuntime.cloneProject,
		renderSnapshot,
		audioBufferChannels,
		matchAudacitySelectionChannels,
		persistAudacityEffectResult: (...args) => persistAudacityEffectResult(...args),
		handleError,
	});
	const {
		applySelectedAudacityEffect,
		previewAudacityEffectFromController,
		runNyquistEvaluation: runNyquistEvaluationOperation,
	} = createSelectionEffectExecutionService({
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES, AUDIO_SELECTION_EFFECT_DEFINITIONS, NYQUIST_AGGREGATE_AUDIO_LIMIT_BYTES, abortError,
		activeSelection, assertAudacityEffectOutput, audacityEffectMemoryError, audacityEffectSelectionDetails,
		audacityEffectTarget, audacityEffectTargets, audacitySpectralEffectContext, bufferFromChannels,
		cancelAudacityEffectPreview, copy, currentAudacityEffectParams, editingBlocked,
		engine, estimateAudioSelectionEffectOutputFrames, estimateAudioSelectionEffectPeakBytes, freezeNyquistResult,
		mixNyquistPreviewChannels, normalizeAudioSelectionEffectParams, normalizeNyquistRole, nyquistAudioResultBytes,
		nyquistEvaluator, nyquistHostProperties, nyquistMaximumOutputFrames, nyquistResultStatus,
		persistAudacityEffectResults: (...args) => persistAudacityEffectResults(...args),
		persistNyquistGeneratedAudio, persistNyquistLabels, playNyquistPreview,
		preflightStorage, getProject: () => project, projectDurationFrames, projectSampleRate,
		publishDocumentSnapshot, renderDryTrackRange, resolveInteractiveAudacityParams, runSelectionEffectWorker,
		setAudacityControlTrack, setAudacityEffectParamsFromController, setAudacityEffectType, setStatus,
		state, throwIfAborted, updateTaskProgress: (value) => taskProgress.updateActive(value),
	});
	const { persistAudacityEffectResults } = createSelectionEffectResultService({
		SOURCE_CHUNK_FRAMES, assertAudacityEffectOutput, audioSelectionEffectLabel, bufferFromChannels,
		cacheSourceBuffer, commit, copy, createStableId,
		engine, generateWaveformPeaks, peakCacheKey, preparePasteCommand,
		prepareRangeDeleteCommand, prepareRangeReplacementCommand, getProject: () => project, projectSampleRate,
		sourceBuffers, sourcePeaks, state, store,
		throwIfAborted, writeBuffer,
	});
	const labelService = createLabelService({
		lifetime,
		projectGeneration,
		state,
		copy,
		getProject: () => project,
		editingBlocked,
		createId: createStableId,
		commit,
		setStatus,
		publish: publishDocumentSnapshot,
		saveExport: (result) => saveLabelExport(result, options.saveLabelFile, fileService),
	});
	const clipboardEditService = createClipboardEditService({
		lifetime,
		state,
		copy,
		session: sessionController,
		sourceBuffers,
		getProject: getCommandProject,
		editingBlocked,
		getPositionFrames: () => engine.getPositionFrames(),
		normalizeFrame: normalizeTimelineFrame,
		snapFrame: snapTimelineFrame,
		createId: createStableId,
		commit,
		setStatus,
	});
	const audioGeneratorService = createAudioGeneratorService({
		lifetime,
		projectGeneration,
		state,
		copy,
		store,
		sourceBuffers,
		sourcePeaks,
		sourceChunkFrames: SOURCE_CHUNK_FRAMES,
		getProject: () => project,
		editingBlocked,
		getPositionFrames: () => engine.getPositionFrames(),
		snapFrame: snapTimelineFrame,
		trackChannelCount: audioTrackChannelCountV2,
		effectTargets: audacityEffectTargets,
		persistEffectResults: (results, type, scope) => (
			persistAudacityEffectResults(results, type, scope)
		),
		preflightStorage,
		getAudioContext: () => engine.getAudioContext({ resume: false }),
		createBuffer: (channels, sampleRate, context) => (
			bufferFromChannels([...channels], sampleRate, context, copy)
		),
		writeBuffer,
		cacheSourceBuffer,
		generatePeaks: (channels) => generateWaveformPeaks([...channels], copy),
		peakCacheKey,
		createId: createStableId,
		commit,
		setStatus,
		publish: publishDocumentSnapshot,
	});
	const handleEdit = createEditorEditService({
		activeSelection, commit, commitSplitAtFrames: clipboardEditService.commitSplitAtFrames, compactLiveSourceState,
		copy, createAddTrackCommand, createClipboardDescriptor: (commandProject, descriptorOptions) => projectRuntime.prepareEditClipboardDescriptor(project, createClipboardDescriptor(commandProject, descriptorOptions)), createStableId,
		editingBlocked, engine, findClip, findClipTrack,
		findTrack, garbageCollectSources, handleError, normalizeTimelineFrame,
		prepareControllerPaste: clipboardEditService.prepareControllerPaste, prepareDisjointRangeDeleteCommand, prepareGroupClipsCommand, prepareKeepRangeCommand,
		prepareLinkedSplitCommand, prepareRangeDeleteCommand, getProject: getCommandProject, projectChanged,
		publishDocumentSnapshot, redoEditorCommand: projectRuntime.redo, resolveEditingSelection, setSessionClipboard: clipboardEditService.setSessionClipboard,
		state, undoEditorCommand: projectRuntime.undo,
	});
	const {
		importFile,
		importFiles,
		normalizeImportOptions,
		normalizeImportTimelineStartFrame,
	} = createProjectImportService({
		SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES, SOURCE_CHUNK_FRAMES, activateStoredSource, audioBufferChannels,
		bufferFromChannels, cacheSourceBuffer, canonicalizeBuffer, commit,
		convertLegacyAupToProject, copy, createAddClipCommand, createAddSourceCommand,
		createAddTrackCommand, createStableId, decodeLegacyAupProject,
		editingBlocked, engine, ffmpeg, findTrack,
		formatLegacyAupWarning, generateWaveformPeaks, handleError, importVideoFile: (...args) => importVideoFile(...args),
		inspectEncodedAudioSampleRate, inspectWavBlobPcm, isAudioEditorVideoFile, isAudioEditorEngineSupported,
		isLegacyAupFile, isLegacyBlockFile, isWavFile,
		peakCacheKey, preflightStorage, getProject: () => project, captureProject: () => projectGeneration.capture(project?.id ?? null), assertProject: (token) => projectGeneration.assertCurrent(token), projectSampleRate, retireSourceChunkProvider: sourceLifecycleService.retireSourceChunkProvider,
		publishDocumentSnapshot, setStatus, sourceBuffers, sourceChunkProviders,
		sourcePcmBytes, sourcePeaks, state, store,
		streamWavBlobPcm, stripExtension, switchProject, warnEnvelope,
		writeBuffer, taskProgress,
	});
	const importVideoFile = createImportVideoFile({
		SOURCE_CHUNK_FRAMES, activateVideoSource, audioBufferChannels, audioEditorVideoThumbnailTimes,
		bufferFromChannels, cacheSourceBuffer, canonicalizeBuffer, commit,
		copy, createAddClipCommand, createAddSourceCommand, createAddTrackCommand,
		createAudioEditorVideoFrameExtractor, createStableId, engine, ffmpeg, helperTimingProbe: fileService.helperTimingProbe,
		findTrack, fitAudioBufferToFrames, generateWaveformPeaks, inspectEncodedAudioSampleRate,
		normalizeImportOptions, peakCacheKey, preflightStorage, getProject: () => project, captureProject: () => projectGeneration.capture(project?.id ?? null), assertProject: (token) => projectGeneration.assertCurrent(token),
		projectSampleRate, revokeVideoVisual, sourceBuffers, sourcePeaks,
		store, stripExtension, warnEnvelope, writeBuffer,
	});
	const projectBinService = createProjectBinService({
		lifetime, copy, trackColors: AUDIO_EDITOR_TRACK_COLORS,
		playbackEngine: engine, sourceBuffers, sourceChunkProviders, sourcePeaks,
		missingSourceIds: state.missingSourceIds,
		sourceResolver: clipTimePitchSourceResolver, store, activateVideoSource,
		createPreviewEngine: (previewOptions) => renderEngineFactory(previewOptions),
		createId: createStableId,
		captureProject: () => projectGeneration.capture(project?.id ?? null),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		getProject: () => project,
		getSelectedClipId: () => state.selectedClipId,
		getSelectedTrackId: () => state.selectedTrackId,
		setSelectedClipId: (clipId) => { state.selectedClipId = clipId; },
		setSelectedTrackId: (trackId) => { state.selectedTrackId = trackId; },
		getPreview: () => state.projectBinPreview,
		setPreview: (preview) => { state.projectBinPreview = preview; },
		editingBlocked, commit, updateSelection,
		getPositionFrames: () => engine.getPositionFrames(),
		normalizeTimelineStartFrame: normalizeImportTimelineStartFrame,
		getVisualData: getProjectBinClipVisualData,
		captureActiveDocument: () => ({ history: state.history, project }),
		restoreActiveDocument: (snapshot) => {
			state.history = snapshot.history;
			project = snapshot.project;
		},
		setImporting: (importing) => { state.importing = importing; },
		importProjectBinFile: async (file, { signal }) => {
			throwIfAborted(signal);
			const result = await importFile(file, normalizeImportOptions({ destination: 'project-bin' }));
			throwIfAborted(signal);
			return result;
		},
		activateStoredSource, invalidateSourceRuntime: sourceLifecycleService.invalidateSourceRuntime, projectChanged, publish: publishDocumentSnapshot, retireSourceChunkProvider: sourceLifecycleService.retireSourceChunkProvider, revokeVideoVisual,
		digestMediaContent, deleteVideoDerivative: (sourceId) => store.deleteVideoDerivative(sourceId),
		admitChangedContentVideoCandidate: (file, source, probeOptions) => admitChangedContentVideoCandidate(file, source, { createAudioEditorVideoFrameExtractor, engine, ffmpeg }, probeOptions),
	});
	const videoEffectService = createVideoEffectService({
		state, copy, getProject: () => project,
		captureProject: () => projectGeneration.capture(project?.id ?? null),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		editingBlocked, commit, publishDocumentSnapshot,
	});
	const rackEffectService = createRackEffectService({
		state, copy, engine, getProject: () => project,
		captureProject: () => projectGeneration.capture(project?.id ?? null),
		assertProject: (token) => projectGeneration.assertCurrent(token),
		editingBlocked, commit, handleError, publishDocumentSnapshot, setStatus,
	});
	const recordingCaptureRuntime = {
		state, soundActivation: soundActivationPolicyService,
		engine,
		capturePool: recordingCapturePool,
		defaultDeviceId: RECORDING_DEFAULT_DEVICE_ID,
		sourceChunkFrames: SOURCE_CHUNK_FRAMES,
		messages: {
			armTrack: copy.armTrackForRecording,
			preparedInputClosed: copy.recordingPreparedInputClosed,
			recording: copy.recording,
			recordingLabel: copy.recordingLabel,
			timedRecordingPast: copy.timedRecordingPast,
			assignInput: copy.recordingAssignInput,
			noInputsAvailable: copy.recordingNoInputsAvailable,
		},
		getProject: () => project,
		findTrack: (targetProject, trackId) => findTrack(targetProject, trackId) || null,
		projectSampleRate: (targetProject) => Number.isSafeInteger(targetProject.sampleRate)
			&& targetProject.sampleRate > 0 ? targetProject.sampleRate : AUDIO_EDITOR_SAMPLE_RATE,
		activeSelection: (targetProject) => {
			const selection = targetProject.selection;
			return selection && selection.endFrame > selection.startFrame ? selection : null;
		},
		beginPlaybackCachePreparation,
		currentTimeMs,
		createStableId,
		createRecordingName: () => `${copy.recordingLabel} ${new Date().toLocaleTimeString(locale)}`,
		openSourceWriter: async (sourceId, metadata) => createCoalescingSourceWriter(
			await store.beginSourceWrite(sourceId, metadata),
		),
		createPreview: createRecordingPreview,
		createPreviewResampler: createStreamingWindowedSincResampler,
		appendPreview: appendRecordingPreview,
		scaleFrames: scaleRecordingFrames,
		streamAudioChannelCount,
		recordingStreamIsLive,
		createRecorder: recordingControllerFactory,
		preflightStorage,
		startMicrophoneMetering: () => microphoneMeterService.startMicrophoneMetering({ force: true }),
		syncRecordingPoolSnapshot,
		releaseUnretainedRecordingInputs,
		publishDocumentSnapshot,
		publishRecordingPreview,
		updatePlayhead,
		stopRecording,
		finalizeRecording,
		handleError,
		setStatus,
		updateTransportState,
	};
	const legacyRecordingCapture = createLegacyRecordingCaptureService(recordingCaptureRuntime);
	const routedRecordingCapture = createRoutedRecordingCaptureService({
		...recordingCaptureRuntime,
		recordingRouteSourceKey,
		createRoutedController: createCoordinatedRoutedRecordingController,
		createLoudnessMeter: createEbuR128Meter,
		getLoudnessMeter: () => ({
			meter: microphoneMeterService.getRoutedLoudnessMeter(),
			key: microphoneMeterService.getRoutedLoudnessMeterKey(),
		}),
		setLoudnessMeter: microphoneMeterService.setRoutedLoudnessMeter,
	});
	const recordingFinalizationRuntime = {
		sourceChunkFrames: SOURCE_CHUNK_FRAMES,
		captureProjectScope: () => {
			const capturedProject = project;
			if (!capturedProject) throw abortError();
			const token = projectGeneration.capture(capturedProject.id);
			return Object.freeze({
				project: capturedProject,
				projectId: capturedProject.id,
				assertCurrent: () => {
					projectGeneration.assertCurrent(token);
					if (project !== capturedProject) throw abortError();
				},
			});
		},
		projectSampleRate: (targetProject) => Number.isSafeInteger(targetProject.sampleRate)
			&& targetProject.sampleRate > 0 ? targetProject.sampleRate : AUDIO_EDITOR_SAMPLE_RATE,
		pauseTransport: () => engine.pause(),
		disposeRecorder: async (recorder) => { await recorder.dispose?.({ stopTracks: false }); },
		appendPreview: appendRecordingPreview,
		scaleFrames: scaleRecordingFrames,
		createStableId,
		createAddSourceCommand,
		preparePunchCommand,
		activateStoredSource,
		commitBatch: (targetProject, commands, selection) => {
			if (targetProject !== project) throw abortError();
			commit({ type: 'batch', commands }, selection);
		},
		setStatusDone: () => setStatus(copy.done, 'success'),
		deactivateSource: async (sourceId) => {
			sourceBuffers.delete(sourceId);
			sourceChunkProviders.delete(sourceId);
			engine.setChunkSources(sourceChunkProviders);
			await sourceChunkProviders.drain();
			sourcePeaks.delete(sourceId);
		},
		deleteStoredSource: (sourceId) => store.deleteSource(sourceId),
	};
	const legacyRecordingFinalization = createLegacyRecordingFinalization(recordingFinalizationRuntime);
	const routedRecordingFinalization = createRoutedRecordingFinalization({
		...recordingFinalizationRuntime,
		setRouteHealth: (trackId, health) => { state.recordingRouteHealth[trackId] = health; },
		deleteSourceAnalysis: (sourceId) => Promise.resolve(
			store.deleteAnalysis?.(peakCacheKey(sourceId)),
		),
	});
	const takeCycleRecording = createTakeCycleAppComposition({ lifetime, store, session: sessionController, projectGeneration, state, recording: recordingCaptureRuntime, getProject: () => project, setProject: (value) => { project = value; }, activeSelection,
		findAudioSource: (value, mediaId) => findSource(value, mediaId), trackName: (value, trackId) => findTrack(value, trackId)?.name || copy.recordingLabel, getRoutes: () => state.recordingRouting.routes,
		soundActivationEnabled: () => soundActivationPolicyService.getSnapshot().preferences.enabled, recordingRouteSourceKey, createId: createStableId, createRecordingName: (name) => `${name} ${new Date().toLocaleTimeString(locale)}`,
		preflightRecording: (bytes) => preflightStorage(bytes, 'recording'), releaseInputs: releaseUnretainedRecordingInputs, activateStoredSource: (source, metadata) => activateStoredSource(source, metadata, { requireChunkStream: true }), applyProjectCommand: projectRuntime.applyCommand, validateProject: (value) => { projectRuntime.cloneProject(value); },
		publishProject: () => { projectRetentionService.retainLiveClipIds(); publishProjectState(); }, synchronizeProject: async (value) => { await applyProjectToPlaybackEngine(value); publishProjectState(); }, now: () => new Date(currentTimeMs()) });
	takeCycleOpenRecoveryBinding.bind(createTakeCycleOpenRecoveryCoordinator({ state, inspect: takeCycleRecording.inspectOpenRecovery, recover: takeCycleRecording.recoverOnOpen, getCurrentProjectId: () => project?.id ?? null, isDisposed: () => state.disposed, isCurrentProjectWritable: () => Boolean(project && state.projectLock && !state.readOnly && !state.projectLock.readOnly), publish: publishDocumentSnapshot }));
	const takeCycleRecordingSession = createTakeCycleRecordingAppSession({ cycle: takeCycleRecording, prepareCurrentProject: flushProject, recordingMessage: copy.recording, setTransportState: updateTransportState, setStatus });
	let timedRecordingService;
	const recordingSessionService = createRecordingSessionService({
		state,
		getProjectId: () => project?.id || null,
		abortError,
		addTrack: (trackOptions) => addTrack(trackOptions),
		stopProjectBinPreview,
		cancelTimedRecording: () => timedRecordingService.cancelTimedRecording(),
		beginRecording: (recordingOptions, scope) => {
			const route = recordingOptions.trackId
				? state.recordingRouting.routes[recordingOptions.trackId]
				: null;
			const routed = route && (
				route.kind === 'display'
				|| route.deviceId !== RECORDING_DEFAULT_DEVICE_ID
				|| route.channelStart > 0
				|| route.channelCount !== 2
			);
			return recordingOptions.trackId && !routed
				? legacyRecordingCapture.capture(recordingOptions, scope)
				: routedRecordingCapture.capture(recordingOptions, scope);
		},
		beginTakeCycleRecording: takeCycleRecordingSession.begin,
		performLegacyFinalization: legacyRecordingFinalization.finalize,
		performRoutedFinalization: routedRecordingFinalization.finalize,
		releaseUnretainedRecordingInputs,
		retainInputs: () => state.preferences.recording.retainInputs,
		playTransport: () => engine.play(),
		pauseTransport: () => engine.pause(),
		getTransportState: () => engine.getState().state,
		updateTransportState,
		persistLeadIn: (enabled) => persistSetting('recording-lead-in', enabled),
		publishDocumentSnapshot,
		publishTelemetrySnapshot,
		syncRecordingPoolSnapshot, resetSoundActivationSources: soundActivationPolicyService.resetSources,
		handleError,
	});
	const timedRecordingInputService = createTimedRecordingInputService({
		getProject: () => project,
		findTrack: (targetProject, trackId) => findTrack(targetProject, trackId) || null,
		projectSampleRate: (targetProject) => Number.isSafeInteger(targetProject.sampleRate)
			&& targetProject.sampleRate > 0 ? targetProject.sampleRate : AUDIO_EDITOR_SAMPLE_RATE,
		getPreferredInputChannelCount: () => state.preferredInputChannelCount,
		getRecordingRoutes: () => state.recordingRouting.routes,
		setRecordingRouteHealth: (trackId, health) => {
			state.recordingRouteHealth[trackId] = health;
		},
		capturePool: recordingCapturePool,
		defaultDeviceId: RECORDING_DEFAULT_DEVICE_ID,
		recordingRouteSourceKey,
		streamAudioChannelCount,
		recordingStreamIsLive,
		messages: {
			armTrack: copy.armTrackForRecording,
			assignInput: copy.recordingAssignInput,
			preparedInputClosed: copy.recordingPreparedInputClosed,
			assignedInputsUnavailable: copy.timedRecordingAssignedInputsUnavailable,
		},
	});
	timedRecordingService = createTimedRecordingService({
		state,
		getProjectId: () => project?.id || null,
		normalizeStartTime: normalizeTimedRecordingStart,
		currentTimeMs,
		prepareInputs: timedRecordingInputService.prepareTimedRecordingInputs,
		prepareContext: async () => {
			const context = await engine.getAudioContext();
			await context.resume();
		},
		startRecording: recordingSessionService.startRecording,
		cancelRecordingStart: recordingSessionService.cancelRecordingStart,
		finalizeRecording: recordingSessionService.finalizeRecording,
		activatePreparedRecording: activatePreparedTimedRecording,
		scheduleTimer,
		clearTimer: clearScheduledTimer,
		maximumTimerDelayMs: MAXIMUM_TIMER_DELAY_MS,
		retainInputs: () => state.preferences.recording.retainInputs,
		releaseUnretainedRecordingInputs,
		syncRecordingPoolSnapshot,
		publishDocumentSnapshot,
		setStatus,
		handleError,
		abortError,
		formatScheduledTime: (value) => new Date(value).toLocaleString(locale),
		messages: {
			projectReadOnly: copy.projectReadOnly,
			past: copy.timedRecordingPast,
			preparing: copy.timedRecordingPreparing,
			missed: copy.timedRecordingMissed || copy.timedRecordingPast,
			scheduled: (time) => copy.timedRecordingScheduled.replace('{time}', time),
			cancelled: copy.timedRecordingCancelled,
		},
	});
	const recordingInputCoordinationService = createRecordingInputCoordinationService({
		state,
		capturePool: recordingCapturePool,
		captureOperation: () => {
			const lifetimeToken = lifetime.capture();
			const targetProject = project;
			const projectToken = targetProject
				? projectGeneration.capture(targetProject.id)
				: null;
			return Object.freeze({
				assertCurrent() {
					lifetime.assertActive(lifetimeToken);
					if (projectToken) projectGeneration.assertCurrent(projectToken);
					if (project !== targetProject) throw abortError();
				},
			});
		},
		meter: microphoneMeterService,
		routing: {
			persistRecordingRouting: recordingRoutingService.persistRecordingRouting,
			releaseUnretainedRecordingInputs: recordingRoutingService.releaseUnretainedRecordingInputs,
			syncRecordingPoolSnapshot: recordingRoutingService.syncRecordingPoolSnapshot,
			updateRecordingDeviceRows: recordingRoutingService.updateRecordingDeviceRows,
		},
		cancelTimedRecording: timedRecordingService.cancelTimedRecording,
		getTrack: (trackId) => findTrack(project, trackId) || null,
		projectSampleRate,
		publishDocumentSnapshot,
		recordingRouteSourceKey,
		setRecordingTrackRoute,
		streamAudioChannelCount,
	});
	const actions = guardEditorControllerActions(createGroupedEditorActions({
		AUDIO_EDITOR_DEFAULT_SHORTCUTS, addEffect, addLabel, addLabelTrack,
		addTrack, addVideoClipEffect, addVideoTrackPair, adjustAllTrackHeights,
		adjustTrackHeight, analysisService: progressAnalysisService, applyAudacityEffectFromController, applyEffectPreset,
		applyProjectBinReplacement, applySamplePencil, applySpectralSelection, beginParametricEqGesture,
		beginRackEffectGesture, beginVideoEffectGesture, bypassVideoClipEffect, cancelAudacityEffectPreview,
		cancelNyquistEvaluation, cancelParametricEqGesture, cancelPlaybackCachePreparation, cancelProjectBinReplacement,
		cancelRackEffectGesture, cancelSampleEdit, cancelTimedRecording, cancelVideoEffectGesture,
		capabilities, captureRackNoiseProfileFromController, captureSelectedNoiseProfile, claimProjectLock,
		clearLocalData, clearLoopRegion, clearRecentProjects, closeProjectTab,
		commit, commitParametricEqGesture, commitRackEffectGesture, commitVideoEffectGesture,
		configureDisplayInput, continueLoudnessMeasurement, copy, copyEffectStack,
		createStableId, createWorkspacePreference, currentAudacityEffectParams, deleteEffectPreset,
		deleteProject, deleteWorkspacePreference, disjoinSelectedClip, dismissAup4CompatibilitySummary,
		duplicateProject, duplicateTrack, engine, exportEffectPreset,
		exportLabels, exportVideo, ffmpeg, findClip, findTrack,
		flushProject, generateSelectionSilence, generateSignal, repeatLastGenerator, getClipVisualData,
		getProjectBinClipVisualData, getVideoSourceVisualData: projectVisualService.getVideoSourceVisualData, getVisibleClips, handleClipAction, handleEdit,
		handleExportAction, handlePlayAtSpeed, handleTransport, hasMissingTimelineSources,
		importEffectPresets, importFiles, importLabelFile, inspectScape,
		listAudioEditorEffectPresets, listProjects, makeStereoTrack, mixAndRenderTracks,
		moveClips, moveClipsToNewTrack, moveClipsToProjectBin, movePanelPreference,
		moveToolbarPreference, moveTrack, newProject, normalizePlaybackFrame,
		openAudacityProject, openAup4, openProject, openScape, openScapeFile, overwriteClips,
		pasteEffectStack, pauseLoudnessMeasurement, placeProjectBinClip, playPauseProjectBinClip,
		prepareProjectBinReplacement, prepareProjectHandoff, previewAudacityEffectFromController, previewParametricEq,
		previewRackEffect, previewVideoEffectGesture, product, getProject: () => project,
		projectBinInstanceCount, refreshAudioDevices, refreshRecordingInputs, refreshStorageUsage, releaseInputs, releaseVideoSourceVisual: revokeVideoVisual, canRelinkLinkedAudio: projectBinService.canRelinkLinkedAudio, relinkLinkedAudio: projectBinService.relinkLinkedAudio, canRelinkLinkedVideo: projectBinService.canRelinkLinkedVideo, classifyLinkedVideoRelink: projectBinService.classifyLinkedVideoRelink, relinkLinkedVideo: projectBinService.relinkLinkedVideo,
		removeProjectBinClip, removeProjectBinSource, removeVideoClipEffect, renameProject,
		renameProjectBinClip, renderClipPitchSpeed, reorderTrack, reorderVideoClipEffect,
		repeatLastAudacityEffect, requestInputAccess, requestStoragePersistence: storageCapacityService.requestStoragePersistence, requestWaveformPcmWindow, resampleTrack,
		resetClipPitchSpeed, resetLoudnessMeasurement, resizeTrackHeight, revertFactorySettings,
		runEffectMacro, runNyquistEvaluation, saveAup4, saveEffectPreset,
		saveNow, saveScape, scheduleTimedRecording, selectAllTracks,
		selectAtZeroCrossings, selectClip, selectCursorToTrackEnd, selectLeftOfPlaybackPosition,
		selectProjectBinInstances, selectRightOfPlaybackPosition, selectTrack, selectTrackStartToCursor,
		selectTrackStartToEnd, sessionTab, setAllTracksView, setAudacityControlTrack,
		setAudacityEffectParamsFromController, setAudacityEffectType, setAudioOutputDevice, setAutoFitTrackHeight,
		setClipTimePitch, setLatencyOffset, setLoopRegion, setLoopRegionInOut, setStatus,
		setLoopRegionToSelection, setMicrophoneMetering, setMonitoring, setPanelPreference,
		setPlayAtSpeedRate, setPreferredInputChannelCount, setPreferredInputDevice, setProjectBinClipColor,
		setRecordingInputGain, setRecordingSourceLatency, setRecordingTrackInput, setRetainInputs,
		setSampleEditMode, setSelection, setSelectionToLoopRegion, setShortcutPreference,
		setSnapSettings, effectSelectionService, setTimelineView, setTimelineViewportWidth,
		setToolbarButtonPreference, setTrackDisplayMode, setTrackRate, setTrackSampleFormat,
		setVisibleTrackHeights, setWorkspacePreference, setZoom, smoothSelectedSamples,
		snapTimelineFrame, splitAtFrame, splitStereoTrack, startRecording, startTakeCycleRecording: () => recordingSessionService.startTakeCycleRecording(),
		startRecordingOnNewTrack, state, stopProjectBinPreview, stopRecording, cleanupDisposableStorage: storageCapacityService.cleanupDisposableStorage, cleanupDerivativeCache: storageCapacityService.cleanupDerivativeCache,
		store, stretchClip, swapTrackChannels, switchProject, persistSetting, publishDocumentSnapshot,
		toggleLeadInRecording, toggleMetronome, togglePanelPreference, togglePinnedPlayhead,
		toggleRecordingPause, toggleRmsWaveform, toggleRulerPlayback, toggleSelectionFollowsLoop,
		recoverTakeCycleRecording: (pending) => takeCycleOpenRecovery.resolve(pending, 'recover'), discardTakeCycleRecording: (pending) => takeCycleOpenRecovery.resolve(pending, 'discard'),
		toggleStretchToTempo: clipPropertyService.toggleStretchToTempo,
		toggleToolbarPreference, toggleUpdateWhilePlaying, toggleVerticalRulers, toggleVideoClipEffect,
		selectionViewService, sequenceTimingService, timelineAnnotationService, regularIntervalAnnotationController, trackFolderService, trackStructuralOperations: trackService.structuralOperations, soundActivationPolicyService, trimClips, updatePreferences, updateRackEffect,
		audioWarpService, sourceMonitorService, takeCompService, taskProgress, videoTrimServices, videoEditService, videoNavigationService, videoSourceReprobeService, ...productActionRuntime(options),
		updateVideoClipEffect, updateWorkspacePreference, updateZoom,
	}), () => lifetime.assertActive());
	let disposePromise = null;

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
		getSnapshot,
		subscribe: (listener) => documentChannel.subscribe(listener),
		getTelemetrySnapshot,
		subscribeTelemetry: (listener) => telemetryChannel.subscribe(listener),
		getClipVisualData,
		getProjectBinClipVisualData,
		actions,
		dispose() {
			if (disposePromise) return disposePromise;
			lifetime.beginDisposal();
			scapeInspectionQuiescence.close(lifetime.signal.reason);
			taskProgress.clear();
			state.disposed = true;
			state.phase = lifetime.phase;
			publishDocumentSnapshot({ force: true });
			disposePromise = disposeController();
			return disposePromise;
		},
	};

	async function disposeController() {
		let disposalError = null, sourceRetirementError = null;
		const cleanup = async (operation, fencesSourceRetirement = false) => {
			try { await operation(); } catch (error) { disposalError ||= error; if (fencesSourceRetirement) sourceRetirementError ||= error; }
		};
		try {
			takeCycleOpenRecovery.dispose(); projectGeneration.invalidate();
			const visualDisposal = projectVisualService.dispose(), scapeInspectionDrain = scapeInspectionQuiescence.drain();
			removeDeviceChangeListener();
			removeDeviceChangeListener = () => {};
			unsubscribeParametricEqErrors();
			cancelTimedRecording({ publish: false, status: false });
			cancelRecordingStart();
			state.exportGeneration += 1;
			state.exportAbort?.abort();
			state.exportAbort = null;
			projectSaveService.cancelScheduled();
			globalThis.clearTimeout(state.sourceGcTimer);
			state.sourceGcTimer = 0;
			cancelPlaybackCachePreparation();
			cancelPlayAtSpeedPreparation();
			state.sampleEditAbort?.abort();
			stopMetronome();
			selectionEffectWorkerService.cancelWorkers();
			state.audacityEffectWorker?.terminate();
			state.audacityEffectWorker = null;
			state.nyquistAbort?.abort();
			state.nyquistAbort = null;
			nyquistClient?.dispose();
			cancelAudacityEffectPreview({ publish: false });
			state.spectralWorker?.terminate();
			state.spectralWorker = null;
			microphoneMeterService.dispose();
			await cleanup(() => scapeInspectionDrain);
			await cleanup(() => state.projectQueue);
			await cleanup(() => projectSaveService.terminalFlush());
			await cleanup(() => stopRecording());
			await cleanup(() => Promise.resolve(recordingCapturePool.dispose?.()));
			await cleanup(() => releaseProjectLock());
			if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
			await cleanup(() => Promise.resolve(state.outputCleanup?.()));
			await cleanup(() => projectBinService.dispose(), true);
			audioWarpService.dispose(); await cleanup(() => takeCompService.dispose(), true);
			await cleanup(() => clipTimePitchCacheService.disposeRenderEngines(), true);
			await cleanup(() => Promise.resolve(ffmpeg.dispose()));
			await cleanup(() => nativeProjectService.dispose());
			clipTimePitchCache.dispose?.();
			await cleanup(() => Promise.resolve(sessionController.dispose?.()));
			await cleanup(() => Promise.resolve(engine.dispose()), true);
			if (!sourceRetirementError) {
				sourceBuffers.clear(); sourceChunkProviders.clear();
				await cleanup(() => sourceChunkProviders.drain(), true); sourcePeaks.clear();
			}
			clipWaveformPcmWindows.clear();
			clipWaveformPcmRequests.clear();
			await cleanup(() => visualDisposal);
			if (!sourceRetirementError) await cleanup(() => Promise.resolve(store.close?.()));
		} finally {
			lifetime.finishDisposal();
			state.phase = lifetime.phase;
			publishDocumentSnapshot({ force: true });
			documentChannel.clear();
			telemetryChannel.clear();
		}
		if (disposalError) throw disposalError;
	}

	function getSnapshot() {
		return documentChannel.get();
	}
	function getTelemetrySnapshot() {
		return telemetryChannel.get();
	}
	function publishDocumentSnapshot({ force = false } = {}) {
		documentChannel.publish({ force });
	}
	function publishRecordingPreview() {
		const now = globalThis.performance?.now?.() ?? Date.now();
		if (now - state.recordingPreviewLastPublishedAt < LIVE_RECORDING_WAVEFORM_PUBLISH_INTERVAL_MS) return;
		state.recordingPreviewLastPublishedAt = now;
		publishDocumentSnapshot();
	}
	function publishTelemetrySnapshot() {
		telemetryChannel.publish();
	}
	function buildDocumentSnapshot() {
		return createEditorDocumentSnapshot(documentSnapshotRuntime);
	}
	function projectWithVideoEffectGestures(currentProject) {
		return applyVideoEffectGesturePreviews(
			currentProject,
			state.videoEffectGestures,
			videoEffectGestureKey,
		);
	}
	function buildTelemetrySnapshot() {
		return createEditorTelemetrySnapshot(state, engine);
	}
	function audioDevicesSnapshot() {
		return createAudioDeviceSnapshot(
			state,
			engine,
			mediaDevices,
			RECORDING_DEFAULT_DEVICE_ID,
			RECORDING_DISPLAY_SOURCE_KEY,
		);
	}
	function getClipVisualData(...args) {
		return projectVisualService.getClipVisualData(...args);
	}
	function getProjectBinClipVisualData(...args) {
		return projectVisualService.getProjectBinClipVisualData(...args);
	}
	function revokeVideoVisuals() {
		return projectVisualService.revokeVideoVisuals();
	}
	function revokeVideoVisual(...args) {
		return projectVisualService.revokeVideoVisual(...args);
	}
	function activateVideoSource(...args) {
		return projectVisualService.activateVideoSource(...args);
	}
	function allProjectClips(...args) {
		return projectVisualService.allProjectClips(...args);
	}
	function hasMissingTimelineSources(...args) {
		return projectVisualService.hasMissingTimelineSources(...args);
	}
	function getVisibleClips(...args) {
		return projectVisualService.getVisibleClips(...args);
	}
	async function loadPreferences(token = lifetime.capture()) {
		return preferencesService.load((value) => lifetime.guard(value, token));
	}
	async function persistSetting(key, value, { policy = 'best-effort' } = {}) {
		return settingPersistence.persist(key, value, { policy });
	}
	function updatePreferences(patch) {
		return preferencesService.update(patch);
	}
	function revertFactorySettings() {
		return preferencesService.revertFactorySettings();
	}
	function setWorkspacePreference(workspaceId) {
		return preferencesService.setWorkspace(workspaceId);
	}
	function toggleToolbarPreference(toolbarId) {
		return preferencesService.toggleToolbar(toolbarId);
	}
	function moveToolbarPreference(toolbarId, requestedIndex) {
		return preferencesService.moveToolbar(toolbarId, requestedIndex);
	}
	function setToolbarButtonPreference(buttonId, visible) {
		return preferencesService.setToolbarButton(buttonId, visible);
	}
	function togglePanelPreference(panelId) {
		return preferencesService.togglePanel(panelId);
	}
	function setPanelPreference(panelId, changes = {}) {
		return preferencesService.setPanel(panelId, changes);
	}
	function movePanelPreference(panelId, dock, requestedIndex) {
		return preferencesService.movePanel(panelId, dock, requestedIndex);
	}
	function setShortcutPreference(actionId, bindings) {
		return preferencesService.setShortcut(actionId, bindings);
	}
	function createWorkspacePreference(name, workspaceId = createStableId('workspace')) {
		return preferencesService.createWorkspace(name, workspaceId);
	}
	function updateWorkspacePreference(workspaceId, changes = {}) {
		return preferencesService.updateWorkspace(workspaceId, changes);
	}
	function deleteWorkspacePreference(workspaceId) {
		return preferencesService.deleteWorkspace(workspaceId);
	}
	function sessionTab(projectId) {
		return projectSessionService.sessionTab(projectId);
	}
	function persistActiveSessionUiState() {
		return projectSessionService.persistActiveSessionUiState();
	}
	async function bootstrap(token) {
		return projectBootstrapService.bootstrap(token);
	}

	async function newProject(options = {}) {
		return projectSwitchService.newProject(options);
	}

	async function openProject(value) {
		return projectSwitchService.openProject(value);
	}

	function switchProject(nextProject, options = {}) {
		return projectSwitchService.switchProject(nextProject, options);
	}

	async function releaseProjectLock(lock = state.projectLock) {
		return projectLockService.releaseProjectLock(lock);
	}

	async function claimProjectLock() {
		return projectLockService.claimProjectLock();
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

	function dismissAup4CompatibilitySummary() {
		return nativeProjectService.dismissAup4CompatibilitySummary();
	}

	function cacheSourceBuffer(sourceId, buffer) {
		return sourceLifecycleService.cacheSourceBuffer(sourceId, buffer);
	}

	async function requestWaveformPcmWindow(clipId, options = {}) {
		return sourceLifecycleService.requestWaveformPcmWindow(clipId, options);
	}

	function clearWaveformPcmWindows() {
		return sourceLifecycleService.clearWaveformPcmWindows();
	}

	async function loadProjectSources(project, options) {
		return sourceLifecycleService.loadProjectSources(project, options);
	}

	async function activateStoredSource(source, metadata, activationOptions = {}) {
		return sourceLifecycleService.activateStoredSource(source, metadata, activationOptions);
	}

	async function ensureProjectSourcesAvailable(snapshot, options) {
		return sourceLifecycleService.ensureProjectSourcesAvailable(snapshot, options);
	}

	async function listProjects() {
		return projectAdminService.listProjects();
	}

	async function prepareProjectHandoff() {
		return projectAdminService.prepareProjectHandoff();
	}

	async function clearRecentProjects() {
		return projectAdminService.clearRecentProjects();
	}

	async function closeProjectTab(projectId = project?.id, closeOptions = {}) {
		return projectAdminService.closeProjectTab(projectId, closeOptions);
	}

	async function renameProject(requestedTitle) {
		return projectAdminService.renameProject(requestedTitle);
	}

	async function duplicateProject(requestedTitle) {
		return projectAdminService.duplicateProject(requestedTitle);
	}

	async function deleteProject() {
		return projectAdminService.deleteProject();
	}

	async function garbageCollectSources() {
		return projectAdminService.garbageCollectSources();
	}

	async function clearLocalData() {
		return projectAdminService.clearLocalData();
	}

	function moveClipsToProjectBin(clipId = state.selectedClipId) {
		return projectBinService.moveClipsToProjectBin(clipId);
	}

	function placeProjectBinClip(binClipId, placement = {}) {
		return projectBinService.placeProjectBinClip(binClipId, placement);
	}

	function renameProjectBinClip(clipId, requestedName) {
		return projectBinService.renameProjectBinClip(clipId, requestedName);
	}

	function removeProjectBinClip(clipId) {
		return projectBinService.removeProjectBinClip(clipId);
	}

	function setProjectBinClipColor(clipId, color) {
		return projectBinService.setProjectBinClipColor(clipId, color);
	}

	function projectBinInstanceCount(clipId) { return projectBinService.projectBinInstanceCount(clipId); }
	function selectProjectBinInstances(clipId) { return projectBinService.selectProjectBinInstances(clipId); }

	function removeProjectBinSource(clipId) {
		return projectBinService.removeProjectBinSource(clipId);
	}

	async function prepareProjectBinReplacement(clipId, file) {
		return projectBinService.prepareProjectBinReplacement(clipId, file);
	}

	function applyProjectBinReplacement(token, shortfallMode = 'keep-spacing') {
		return projectBinService.applyProjectBinReplacement(token, shortfallMode);
	}

	async function cancelProjectBinReplacement(token) {
		return projectBinService.cancelProjectBinReplacement(token);
	}

	async function playPauseProjectBinClip(clipId) {
		return projectBinService.playPauseProjectBinClip(clipId);
	}

	async function stopProjectBinPreview({ dispose = false } = {}) {
		return projectBinService.stopProjectBinPreview({ dispose });
	}

	async function mixAndRenderTracks() {
		return taskProgress.run('render', copy.rendering, () => mixRenderService.mixAndRenderTracks());
	}

	async function resampleTrack(trackId = state.selectedTrackId, requestedSampleRate = projectSampleRate()) {
		return taskProgress.run('transform', copy.resamplingTrack || copy.audacityProcessing, () => trackTransformService.resampleTrack(trackId, requestedSampleRate));
	}

	async function swapTrackChannels(trackId = state.selectedTrackId) {
		return taskProgress.run('transform', copy.rewritingChannels || copy.audacityProcessing, () => trackTransformService.swapTrackChannels(trackId));
	}

	async function splitStereoTrack(trackId = state.selectedTrackId, panChannels = true) {
		return taskProgress.run('transform', copy.rewritingChannels || copy.audacityProcessing, () => trackTransformService.splitStereoTrack(trackId, panChannels));
	}

	async function makeStereoTrack(trackId = state.selectedTrackId, partnerTrackId = null) {
		return taskProgress.run('transform', copy.rewritingChannels || copy.audacityProcessing, () => trackTransformService.makeStereoTrack(trackId, partnerTrackId));
	}

	function addLabel(trackId, labelOptions = {}) {
		return trackService.addLabel(trackId, labelOptions);
	}
	async function importLabelFile(...args) {
		return labelService.importLabelFile(...args);
	}
	async function exportLabels(...args) {
		return labelService.exportLabels(...args);
	}

	function splitAtFrame(...args) {
		return clipboardEditService.splitAtFrame(...args);
	}

	async function disjoinSelectedClip(...args) {
		return clipboardEditService.disjoinSelectedClip(...args);
	}

	async function generateSelectionSilence(...args) {
		return taskProgress.run('generate', copy.generatingAudio, () => audioGeneratorService.generateSelectionSilence(...args));
	}

	async function generateSignal(...args) {
		return taskProgress.run('generate', copy.generatingAudio, () => audioGeneratorService.generateSignal(...args));
	}

	async function repeatLastGenerator(...args) { return taskProgress.run('generate', copy.generatingAudio, () => audioGeneratorService.repeatLast(...args)); }

	function selectTrack(trackId) {
		return selectionViewService.selectTrack(trackId);
	}

	function selectClip(clipId, options = {}) {
		return selectionViewService.selectClip(clipId, options);
	}

	function setSelection(startFrame, endFrame, details = {}) {
		return selectionViewService.setSelection(startFrame, endFrame, details);
	}

	function selectAllTracks() {
		return selectionViewService.selectAllTracks();
	}

	function selectLeftOfPlaybackPosition(requestedStartFrame = null) {
		return selectionViewService.selectLeftOfPlaybackPosition(requestedStartFrame);
	}

	function selectRightOfPlaybackPosition(requestedEndFrame = null) {
		return selectionViewService.selectRightOfPlaybackPosition(requestedEndFrame);
	}

	function selectTrackStartToCursor() {
		return selectionViewService.selectTrackStartToCursor();
	}

	function selectCursorToTrackEnd() {
		return selectionViewService.selectCursorToTrackEnd();
	}

	function selectTrackStartToEnd() {
		return selectionViewService.selectTrackStartToEnd();
	}

	function selectedTracksTimeRange() {
		return selectionViewService.selectedTracksTimeRange();
	}

	function toggleRmsWaveform() {
		return selectionViewService.toggleRmsWaveform();
	}

	function toggleVerticalRulers() {
		return selectionViewService.toggleVerticalRulers();
	}

	function toggleUpdateWhilePlaying() {
		return selectionViewService.toggleUpdateWhilePlaying();
	}

	function togglePinnedPlayhead() {
		return selectionViewService.togglePinnedPlayhead();
	}

	function toggleRulerPlayback() {
		return selectionViewService.toggleRulerPlayback();
	}

	async function selectAtZeroCrossings() {
		return selectionViewService.selectAtZeroCrossings();
	}

	function setSnapSettings(settings = {}) {
		return selectionViewService.setSnapSettings(settings);
	}

	function snapTimelineFrame(value, overrides = {}) {
		return selectionViewService.snapTimelineFrame(value, overrides);
	}

	function setZoom(pixelsPerSecond) {
		return selectionViewService.setZoom(pixelsPerSecond);
	}

	function sampleEditingAvailable(clipId = state.selectedClipId) {
		return sampleEditService.sampleEditingAvailable(clipId);
	}

	function synchronizeAutomaticSampleEditMode() {
		return sampleEditService.synchronizeAutomaticSampleEditMode();
	}

	function setSampleEditMode(mode = null) {
		return sampleEditService.setSampleEditMode(mode);
	}

	function cancelSampleEdit() {
		return sampleEditService.cancelSampleEdit();
	}

	function applySamplePencil(options = {}) {
		return taskProgress.run('sample-edit', copy.sampleEditSaving, () => sampleEditService.applySamplePencil(options));
	}

	function smoothSelectedSamples(options = {}) {
		return taskProgress.run('sample-edit', copy.sampleEditSaving, () => sampleEditService.smoothSelectedSamples(options));
	}

	async function loadRecordingRouting(currentProject = project) {
		return recordingRoutingService.loadRecordingRouting(currentProject);
	}

	function persistRecordingRouting() {
		return recordingRoutingService.persistRecordingRouting();
	}

	async function requestInputAccess() {
		return recordingRoutingService.requestInputAccess();
	}

	async function refreshRecordingInputs({ probe = true } = {}) {
		return recordingRoutingService.refreshRecordingInputs({ probe });
	}

	async function refreshAudioDevices({ probe = true, publish = true } = {}) {
		return recordingRoutingService.refreshAudioDevices({ probe, publish });
	}

	async function setPreferredInputDevice(deviceId) {
		return recordingRoutingService.setPreferredInputDevice(deviceId);
	}

	async function configureDisplayInput() {
		return recordingRoutingService.configureDisplayInput();
	}

	async function setPreferredInputChannelCount(channelCount) {
		return recordingRoutingService.setPreferredInputChannelCount(channelCount);
	}

	async function setAudioOutputDevice(deviceId) {
		return recordingRoutingService.setAudioOutputDevice(deviceId);
	}

	function updateRecordingDeviceRows(discovered = state.recordingDevices) {
		return recordingRoutingService.updateRecordingDeviceRows(discovered);
	}

	async function setRecordingTrackInput(trackId, route) {
		return recordingInputCoordinationService.setRecordingTrackInput(trackId, route);
	}

	async function setRecordingSourceLatency(sourceKey, value) {
		return recordingRoutingService.setRecordingSourceLatency(sourceKey, value);
	}

	async function setRetainInputs(enabled) {
		return recordingRoutingService.setRetainInputs(enabled);
	}

	function releaseInputs() {
		return recordingRoutingService.releaseInputs();
	}

	function releaseUnretainedRecordingInputs({ force = false } = {}) {
		return recordingRoutingService.releaseUnretainedRecordingInputs({ force });
	}

	function syncRecordingPoolSnapshot() {
		return recordingRoutingService.syncRecordingPoolSnapshot();
	}

	function handleRecordingPoolChange(sources) {
		return recordingInputCoordinationService.handleRecordingPoolChange(sources);
	}

	function setMonitoring(enabled) {
		state.monitoring = Boolean(enabled);
		state.recorder?.setMonitoring(state.monitoring);
		void persistSetting('input-monitor', state.monitoring);
		publishDocumentSnapshot();
		return state.monitoring;
	}

	function pauseLoudnessMeasurement(kind = 'playback') {
		return microphoneMeterService.pauseLoudnessMeasurement(kind);
	}

	function continueLoudnessMeasurement(kind = 'playback') {
		return microphoneMeterService.continueLoudnessMeasurement(kind);
	}

	function resetLoudnessMeasurement(kind = 'playback') {
		return microphoneMeterService.resetLoudnessMeasurement(kind);
	}

	async function setMicrophoneMetering(enabled) {
		return microphoneMeterService.setMicrophoneMetering(enabled);
	}

	function stopMicrophoneMetering(options = {}) {
		return microphoneMeterService.stopMicrophoneMetering(options);
	}

	function synchronizeMicrophoneMeterTarget() {
		return microphoneMeterService.synchronizeTarget();
	}

	function setRecordingInputGain(value) {
		return microphoneMeterService.setRecordingInputGain(value, normalizeRecordingInputGain);
	}

	function setLatencyOffset(value) {
		state.latencyOffsetMs = normalizeLatencyOffset(value);
		void persistSetting('recording-latency-offset-ms', state.latencyOffsetMs);
		publishDocumentSnapshot();
		return state.latencyOffsetMs;
	}

	function commit(...args) {
		return projectMutationService.commit(...args);
	}

	function updateSelection(...args) {
		return projectMutationService.updateSelection(...args);
	}

	function projectChanged(...args) {
		return projectMutationService.projectChanged(...args);
	}

	function scheduleAutosave(...args) {
		return projectMutationService.scheduleAutosave(...args);
	}

	function saveNow(...args) {
		return projectMutationService.saveNow(...args);
	}

	function flushProject(...args) {
		return projectMutationService.flushProject(...args);
	}

	function compactLiveSourceState(...args) {
		return projectRetentionService.compactLiveSourceState(...args);
	}

	function liveSessionSourceIds() {
		return projectRetentionService.liveSessionSourceIds();
	}

	function liveSessionClipIds() {
		return projectRetentionService.liveSessionClipIds();
	}

	function publishProjectState() {
		return projectViewService.publishProjectState();
	}

	function setTimelineView(...args) {
		return projectViewService.setTimelineView(...args);
	}

	function setAllTracksView(...args) {
		return projectViewService.setAllTracksView(...args);
	}

	function duplicateTrack(...args) {
		return trackDuplicationService.duplicateTrack(...args);
	}

	function handleClipAction(...args) {
		return clipPropertyService.handleClipAction(...args);
	}

	function moveClips(...args) { return clipTransformService.moveClips(...args); }
	function moveClipsToNewTrack(...args) { return clipTransformService.moveClipsToNewTrack(...args); }
	function trimClips(...args) { return clipTransformService.trimClips(...args); }
	function overwriteClips(...args) { return clipTransformService.overwriteClips(...args); }

	function setClipTimePitch(...args) {
		return clipPropertyService.setClipTimePitch(...args);
	}

	function stretchClip(...args) {
		return clipPropertyService.stretchClip(...args);
	}

	function resetClipPitchSpeed(...args) {
		return clipPropertyService.resetClipPitchSpeed(...args);
	}

	function renderClipPitchSpeed(...args) {
		return taskProgress.run('render', copy.rendering, () => clipTimePitchRenderService.renderClipPitchSpeed(...args));
	}

	function projectHasTimePitchClips(...args) {
		return clipTimePitchCacheService.projectHasTimePitchClips(...args);
	}

	function createCacheAwareRenderEngine(...args) {
		return clipTimePitchCacheService.createCacheAwareRenderEngine(...args);
	}

	function prepareCommittedTimePitchCaches(...args) {
		return clipTimePitchCacheService.prepareCommittedTimePitchCaches(...args);
	}

	async function applyProjectToPlaybackEngine(snapshot) {
		return playbackProjectApplyService.apply(snapshot);
	}

	function beginPlaybackCachePreparation(...args) {
		return clipTimePitchCacheService.beginPlaybackCachePreparation(...args);
	}

	function cancelPlaybackCachePreparation(...args) {
		return clipTimePitchCacheService.cancelPlaybackCachePreparation(...args);
	}

	function videoEffectGestureKey(clipId, effectId) {
		return videoEffectService.videoEffectGestureKey(clipId, effectId);
	}

	function addVideoClipEffect(clipId = state.selectedClipId, type, options = {}) {
		return videoEffectService.addVideoClipEffect(clipId, type, options);
	}

	function updateVideoClipEffect(clipId, effectId, changes = {}) {
		return videoEffectService.updateVideoClipEffect(clipId, effectId, changes);
	}

	function toggleVideoClipEffect(clipId, effectId, enabled = undefined) {
		return videoEffectService.toggleVideoClipEffect(clipId, effectId, enabled);
	}

	function bypassVideoClipEffect(clipId, effectId, bypassed = true) {
		return videoEffectService.bypassVideoClipEffect(clipId, effectId, bypassed);
	}

	function reorderVideoClipEffect(clipId, effectId, toIndex) {
		return videoEffectService.reorderVideoClipEffect(clipId, effectId, toIndex);
	}

	function removeVideoClipEffect(clipId, effectId) {
		return videoEffectService.removeVideoClipEffect(clipId, effectId);
	}

	function beginVideoEffectGesture(clipId, effectId) {
		return videoEffectService.beginVideoEffectGesture(clipId, effectId);
	}

	function previewVideoEffectGesture(clipId, effectId, params = {}) {
		return videoEffectService.previewVideoEffectGesture(clipId, effectId, params);
	}

	function commitVideoEffectGesture(clipId, effectId, params = {}) {
		return videoEffectService.commitVideoEffectGesture(clipId, effectId, params);
	}

	function cancelVideoEffectGesture(clipId, effectId) {
		return videoEffectService.cancelVideoEffectGesture(clipId, effectId);
	}

	function addEffect(request = {}) {
		return rackEffectService.addEffect(request);
	}

	function updateRackEffect(scope, trackId, effectId, changes = {}) {
		return rackEffectService.updateRackEffect(scope, trackId, effectId, changes);
	}

	function beginRackEffectGesture(scope, targetId, effectId) {
		return rackEffectService.beginRackEffectGesture(scope, targetId, effectId);
	}

	function previewRackEffect(scope, targetId, effectId, params) {
		return rackEffectService.previewRackEffect(scope, targetId, effectId, params);
	}

	function commitRackEffectGesture(scope, targetId, effectId, params) {
		return rackEffectService.commitRackEffectGesture(scope, targetId, effectId, params);
	}

	function cancelRackEffectGesture(scope, targetId, effectId) {
		return rackEffectService.cancelRackEffectGesture(scope, targetId, effectId);
	}

	function beginParametricEqGesture(scope, targetId, effectId) {
		return rackEffectService.beginParametricEqGesture(scope, targetId, effectId);
	}

	function previewParametricEq(scope, targetId, effectId, params) {
		return rackEffectService.previewParametricEq(scope, targetId, effectId, params);
	}

	function commitParametricEqGesture(scope, targetId, effectId, params) {
		return rackEffectService.commitParametricEqGesture(scope, targetId, effectId, params);
	}

	function cancelParametricEqGesture(scope, targetId, effectId) {
		return rackEffectService.cancelParametricEqGesture(scope, targetId, effectId);
	}

	function copyEffectStack(scope, trackId = state.selectedTrackId) {
		return rackEffectService.copyEffectStack(scope, trackId);
	}

	function pasteEffectStack(scope, trackId = state.selectedTrackId) {
		return rackEffectService.pasteEffectStack(scope, trackId);
	}

	function materializeRackEffect(effect, scope, trackId, options = {}) {
		return rackEffectService.materializeRackEffect(effect, scope, trackId, options);
	}

	function runEffectMacro(...args) {
		return taskProgress.run('effect', copy.macroProcessing || copy.audacityProcessing, () => effectMacroService.runEffectMacro(...args));
	}

	function currentAudacityEffectParams(...args) {
		return effectControlsService.currentAudacityEffectParams(...args);
	}

	function setAudacityEffectType(...args) {
		return effectControlsService.setAudacityEffectType(...args);
	}

	function setAudacityEffectParamsFromController(...args) {
		return effectControlsService.setAudacityEffectParamsFromController(...args);
	}

	function setAudacityControlTrack(...args) {
		return effectControlsService.setAudacityControlTrack(...args);
	}

	function applyEffectPreset(...args) {
		return effectControlsService.applyEffectPreset(...args);
	}

	function saveEffectPreset(...args) {
		return effectControlsService.saveEffectPreset(...args);
	}

	function deleteEffectPreset(...args) {
		return effectControlsService.deleteEffectPreset(...args);
	}

	function importEffectPresets(...args) {
		return effectControlsService.importEffectPresets(...args);
	}

	function exportEffectPreset(...args) {
		return effectControlsService.exportEffectPreset(...args);
	}

	function applyAudacityEffectFromController(...args) {
		return taskProgress.run('effect', copy.audacityProcessing, () => effectControlsService.applyAudacityEffectFromController(...args));
	}

	function cancelAudacityEffectPreview(...args) {
		return effectControlsService.cancelAudacityEffectPreview(...args);
	}

	function repeatLastAudacityEffect(...args) {
		return taskProgress.run('effect', copy.audacityProcessing, () => effectControlsService.repeatLastAudacityEffect(...args));
	}

	function captureRackNoiseProfileFromController(...args) {
		return effectControlsService.captureRackNoiseProfileFromController(...args);
	}

	function resolveInteractiveAudacityParams(...args) {
		return effectControlsService.resolveInteractiveAudacityParams(...args);
	}

	function audacityEffectTarget(...args) {
		return effectSelectionService.audacityEffectTarget(...args);
	}

	function audacityEffectTargets(...args) {
		return effectSelectionService.audacityEffectTargets(...args);
	}

	function audacityEffectSelectionDetails(...args) {
		return effectSelectionService.audacityEffectSelectionDetails(...args);
	}

	function audacitySpectralEffectContext(...args) {
		return effectSelectionService.audacitySpectralEffectContext(...args);
	}

	function applySpectralSelection(...args) {
		return taskProgress.run('effect', copy.spectralProcessing || copy.audacityProcessing, () => effectAudioService.applySpectralSelection(...args));
	}

	function captureSelectedNoiseProfile(...args) {
		return taskProgress.run('effect', copy.audacityProcessing, () => effectAudioService.captureSelectedNoiseProfile(...args));
	}

	function renderDryTrackRange(...args) {
		return effectAudioService.renderDryTrackRange(...args);
	}

	function cancelNyquistEvaluation(...args) {
		return nyquistHostService.cancelNyquistEvaluation(...args);
	}

	function runNyquistEvaluation(...args) {
		return taskProgress.run('effect', copy.nyquistProcessing || copy.audacityProcessing, () => runNyquistEvaluationOperation(...args));
	}

	function nyquistHostProperties(...args) {
		return nyquistHostService.nyquistHostProperties(...args);
	}

	function playNyquistPreview(...args) {
		return nyquistHostService.playNyquistPreview(...args);
	}

	function persistNyquistGeneratedAudio(...args) {
		return nyquistGeneratedAudioService.persistNyquistGeneratedAudio(...args);
	}

	function persistNyquistLabels(...args) {
		return nyquistHostService.persistNyquistLabels(...args);
	}

	async function persistAudacityEffectResult(target, type, channels, options = {}) {
		return persistAudacityEffectResults([{ target, channels }], type, options);
	}

	function runSelectionEffectWorker(...args) {
		return selectionEffectWorkerService.runSelectionEffectWorker(...args);
	}

	function analysisRange() {
		const selection = activeSelection();
		return Object.freeze({
			startFrame: selection?.startFrame ?? 0,
			endFrame: selection?.endFrame ?? projectDurationFrames(project),
		});
	}

	async function renderAnalysisAudio(scope, range, signal = null) {
		if (hasMissingTimelineSources()) throw new Error(copy.localSourcesMissing);
		let snapshot = projectRuntime.cloneProject(project);
		if (scope === 'track') {
			const selectedTrack = findTrack(snapshot, state.selectedTrackId);
			if (!selectedTrack || selectedTrack.type !== 'audio') throw new Error(copy.audioTrackRequired);
			for (const track of snapshot.tracks) {
				if (track.type !== 'audio') continue;
				track.mute = track.id !== selectedTrack.id;
				track.solo = false;
			}
			snapshot.master = { gain: 1, effects: [] };
		} else if (scope !== 'master') throw new RangeError(copy.analysisScopeInvalid);
		return renderSnapshot(snapshot, {
			startFrame: range.startFrame,
			endFrame: range.endFrame,
			includeTail: false,
			preRollFrames: Math.min(range.startFrame, projectSampleRate() * 10),
		}, sourceBuffers, signal);
	}

	async function startRecordingOnNewTrack(options = {}) {
		return recordingSessionService.startRecordingOnNewTrack(options);
	}

	function toggleRecordingPause() {
		return recordingSessionService.toggleRecordingPause();
	}

	function toggleLeadInRecording() {
		return recordingSessionService.toggleLeadInRecording();
	}

	async function scheduleTimedRecording(startTime, options = {}) {
		return timedRecordingService.scheduleTimedRecording(startTime, options);
	}

	async function activatePreparedTimedRecording() {
		for (const entry of state.recordingEntries || []) state.recordingRouteHealth[entry.trackId] = 'recording';
		await engine.play();
		setStatus(copy.recording);
		updateTransportState('recording');
		publishDocumentSnapshot();
	}

	function cancelTimedRecording(options = {}) {
		return timedRecordingService.cancelTimedRecording(options);
	}

	function cancelRecordingStart() {
		return recordingSessionService.cancelRecordingStart();
	}

	function startRecording(options = {}) {
		return recordingSessionService.startRecording(options);
	}
	async function invalidateTakeCycleRecording(reason) { state.recordingStartGeneration += 1; takeCycleRecording.cancel(reason); await stopRecording().catch(handleError); }

	async function stopRecording() {
		return recordingSessionService.stopRecording();
	}

	function finalizeRecording() {
		return recordingSessionService.finalizeRecording();
	}

	function editingBlocked() {
		return selectAudioEditorControllerEditBlock(state).blocked;
	}

	function updatePlayhead(frame = 0, duration = project ? projectDurationFrames(project) : 0) {
		return viewStateService.updatePlayhead(frame, duration);
	}

	function updateTransportState(value) {
		return viewStateService.updateTransportState(value);
	}

	function updateMeters(meters) {
		return viewStateService.updateMeters(meters);
	}

	function updateZoom(action, requestedViewportWidth) {
		return viewStateService.updateZoom(action, requestedViewportWidth);
	}

	function setTimelineViewportWidth(width) {
		return viewStateService.setTimelineViewportWidth(width);
	}

	function setAutoFitTrackHeight(enabled) {
		return viewStateService.setAutoFitTrackHeight(enabled);
	}

	function setVisibleTrackHeights(heights = {}) {
		return viewStateService.setVisibleTrackHeights(heights);
	}

	function adjustTrackHeight(trackId, delta) {
		return viewStateService.adjustTrackHeight(trackId, delta);
	}

	function adjustAllTrackHeights(delta) {
		return viewStateService.adjustAllTrackHeights(delta);
	}

	function resizeTrackHeight(trackId, requestedHeight, fittedHeights = {}) {
		return viewStateService.resizeTrackHeight(trackId, requestedHeight, fittedHeights);
	}

	function normalizeExportSettings(value = {}) {
		return normalizeEditorExportSettings(value, projectSampleRate(), project.metadata?.tags || {});
	}

	function toggleExport(active) {
		if (!active) {
			state.exportProgress = 0;
			publishTelemetrySnapshot();
		}
		publishDocumentSnapshot();
	}

	function updateExportProgress(progress) {
		state.exportProgress = Math.max(0, Math.min(1, Number(progress) || 0));
		taskProgress.updateActive(state.exportProgress);
		publishTelemetrySnapshot();
	}

	function showAnalysis(result, visuals = null, report = null) {
		state.analysisResult = result || null;
		state.analysisVisuals = visuals;
		state.analysisReport = report;
		publishDocumentSnapshot();
	}

	function createAnalysisVisuals(channels, sampleRate) {
		return createEditorAnalysisVisuals(channels, sampleRate);
	}

	function setStatus(message, status = 'info') {
		const resolvedMessage = message || copy.ready;
		state.status = { message: resolvedMessage, state: status };
		publishDocumentSnapshot();
	}

	function handleError(error) {
		const message = error?.message || String(error) || copy.unknownError;
		setStatus(copy.genericError.replace('{message}', message), 'error');
		return null;
	}

	function warnEnvelope() {
		const envelope = projectEnvelope(project, { mobile: state.mobile });
		if (!envelope.supported) setStatus(copy.capacityWarning
			.replace('{trackCount}', String(envelope.limits.trackCount))
			.replace('{stereoMinutes}', String(envelope.limits.stereoMinutes)));
	}

	function refreshStorageUsage() { return storageCapacityService.refreshStorageUsage(); }
	function estimateStorageForPreflight(requiredBytes, operation, signal) {
		return storageCapacityService.estimateStorageForPreflight(requiredBytes, operation, signal);
	}
	function preflightStorage(requiredBytes, operation) { return storageCapacityService.preflightStorage(requiredBytes, operation); }

	function activeSelection() {
		const selection = project?.selection;
		return selection && selection.endFrame > selection.startFrame ? selection : null;
	}
}
