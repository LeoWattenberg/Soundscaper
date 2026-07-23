import {
	AUDIO_EDITOR_SAMPLE_RATE,
	AUDIO_EDITOR_TRACK_COLORS,
	AUDIO_EDITOR_DEFAULT_SHORTCUTS,
	AUDIO_SELECTION_EFFECT_DEFINITIONS,
	applyEditorCommand,
	applyAudioSelectionEffectAsync,
	applyAudioEditorWorkspace,
	applyAudioEditorEffectPreset,
	applyMediaChannelMapping,
	applySpectralGain,
	analyzeAudioChannels,
	audioTrackChannelCountV2,
	audioEffectLabel,
	audioEffectTypes,
	audioSelectionEffectDefaults,
	audioSelectionEffectLabel,
	audioSelectionEffectTypes,
	canEditAudioSamplesAtZoom,
	canRedo,
	canUndo,
	cloneProject,
	clipNeedsTimePitchRender,
	ClipTimePitchRenderCacheCoordinator,
	collectClipTransformIds,
	collectClipTrimIds,
	collectRelatedClipIds,
	createAup4Client,
	createAiffStreamEncoder,
	createAudioEditorPreferencesV1,
	createAudioEditorEffectPresets,
	createAudioEditorSessionController,
	createCustomAudioEditorWorkspace,
	createAddClipCommand,
	createAddLabelCommand,
	createAddLabelTrackCommand,
	createAddSourceCommand,
	createAddTrackCommand,
	createAudioEditorProjectV5,
	createAudioEditorVideoFrameExtractor,
	convertStructuredAup3ToProjectV2,
	createClipboardDescriptor,
	createEditorHistory,
	createEffect,
	createVideoEffect,
	createExportPlan,
	createVideoExportPlan,
	createAudioEditorFileService,
	createPencilSampleEdits,
	createReplaceClipSourceCommand,
	createSmoothSampleRange,
	createStableId,
	calculateAudioSpectrum,
	compactEditorHistorySourceMetadata,
	editorHistoryProjects,
	encodeAiff,
	evictUnreferencedSourceCaches,
	executeEditorCommand,
	findClip,
	findClipTrack,
	findAudioClippingRegions,
	findNearestAudioZeroCrossing,
	findAudioEditorShortcutConflicts,
	findProjectBinClip,
	findSource,
	findTrack,
	EDITOR_TIMELINE_MINIMUM_SECONDS,
	editorTimelineDurationFrames,
	estimateAudioSelectionEffectOutputFrames,
	estimateAudioSelectionEffectPeakBytes,
	isAudacityRackEffectType,
	isAudioEditorVideoFile,
	loadAudioEditorPreferencesV1,
	loadStoredSourceChannels,
	migrateAudioEditorProject,
	generateAudioEditorSignal,
	normalizeAudioEditorShortcut,
	normalizeAudioSelectionEffectParams,
	normalizeEffect,
	normalizeVideoEffect,
	cloneVideoEffects,
	VIDEO_EFFECT_DEFINITIONS,
	VIDEO_EFFECT_TYPES,
	normalizeRecordingInputGain,
	RECORDING_INPUT_GAIN_DEFAULT,
	prepareCut,
	prepareDisjointRangeDeleteCommand,
	prepareGroupClipsCommand,
	prepareKeepRangeCommand,
	preparePasteCommand,
	preparePunchCommand,
	prepareRangeDeleteCommand,
	prepareRangeReplacementCommand,
	resolveEditingSelection,
	prepareOverwriteClipCommand,
	prepareTransformClipsCommand,
	prepareSplitCommand,
	prepareLinkedSplitCommand,
	projectDurationFrames,
	projectEnvelope,
	rackTailFrames,
	parseAudioEditorLabels,
	persistImmutableSampleEdit,
	requestAup4FileHandle,
	saveAup4Result,
	exportScapeProject,
	importScapeProject,
	inspectScapeProject,
	SCAPE_MIME_TYPE,
	serializeAudioEditorLabels,
	snapAudioEditorFrameWithProject,
	updateAudioEditorPreferencesV1,
	updateCustomAudioEditorWorkspace,
	deleteCustomAudioEditorWorkspace,
	deleteAudioEditorEffectPreset,
	decodeLegacyAupProject,
	exportAudioEditorEffectPreset,
	importAudioEditorEffectPresets,
	listAudioEditorEffectPresets,
	saveAudioEditorEffectPreset,
	createStreamingWindowedSincResampler,
	redoEditorCommand,
	undoEditorCommand,
	audioEditorVideoThumbnailTimes,
} from './index.js';
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
	effectRackLatencyFrames,
} from './engine.js';
import {
	loadParametricEqWasmModule,
} from './parametric-eq/index.js';
import {
	RECORDING_CHANNEL_COUNT_MAXIMUM,
	createRecordingCapturePool,
	createRecordingController,
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
import { createPlanarPcmChunkCoalescer } from './pcm-chunks.js';
import { createSourceBufferCache } from './source-buffer-cache.js';
import { createEbuR128MeterNode } from './ebu-r128-node.js';
import { createEbuR128Meter } from './ebu-r128.js';
import { acquireProjectLock } from './project-lock.js';
import { createProjectStore } from './storage.js';
import { createWavStreamEncoder, encodeWav } from './wav.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from './wav-import.js';
import { NyquistEvaluationClient } from './nyquist/client.js';
import { decodeAup3File } from '../aup3-browser.js';
import { ENGLISH_COPY } from '../i18n/catalogs.js';
import { normalizeBcp47Locale } from '../i18n/locale.js';

const DEFAULT_PIXELS_PER_SECOND = 120;
const MAX_PIXELS_PER_SECOND = AUDIO_EDITOR_SAMPLE_RATE;
const MAX_TIMELINE_PIXELS = 16_000_000;
const SOURCE_CHUNK_FRAMES = 65_536;
const SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES = 32 * 1024 * 1024;
const NYQUIST_AGGREGATE_AUDIO_LIMIT_BYTES = 128 * 1024 * 1024;
const LIVE_RECORDING_WAVEFORM_BUCKET_FRAMES = 64;
const LIVE_RECORDING_WAVEFORM_MAXIMUM_BUCKETS = 2_048;
const LIVE_RECORDING_WAVEFORM_PUBLISH_INTERVAL_MS = 80;
const MAXIMUM_TIMER_DELAY_MS = 2_147_000_000;
const PROJECT_LOCK_RETRY_MAX_MS = 30_000;
const AUDIO_DEVICE_PREFERENCES_SETTING_KEY = 'audio-device-preferences-v1';

export function calculateAudioEditorMetronomeSchedule({
	bpm,
	sampleRate,
	positionFrame = 0,
	playbackRate = 1,
}) {
	const normalizedBpm = Math.max(1, Number(bpm) || 120);
	const normalizedSampleRate = Math.max(1, Number(sampleRate) || AUDIO_EDITOR_SAMPLE_RATE);
	const normalizedPosition = Math.max(0, Number(positionFrame) || 0);
	const requestedPlaybackRate = Number(playbackRate);
	const normalizedPlaybackRate = Number.isFinite(requestedPlaybackRate) && requestedPlaybackRate > 0
		? requestedPlaybackRate
		: 1;
	const beatFrames = normalizedSampleRate * 60 / normalizedBpm;
	const beatIndex = Math.ceil(normalizedPosition / beatFrames);
	const nextBeatFrame = beatIndex * beatFrames;
	return Object.freeze({
		beatIndex,
		delaySeconds: Math.max(0, (nextBeatFrame - normalizedPosition) / (normalizedSampleRate * normalizedPlaybackRate)),
		beatDurationSeconds: 60 / (normalizedBpm * normalizedPlaybackRate),
	});
}

export function createAudioEditorController(_root = null, options = {}) {
	const copy = Object.freeze({ ...ENGLISH_COPY, ...(options.copy || {}) });
	const locale = normalizeBcp47Locale(options.locale);
	const product = productProfile(options.productId || options.product?.id || 'soundscaper');
	const productId = product.id;
	const capabilities = product.capabilities;
	const preferenceSettingKey = `${productId}:audio-editor-preferences-v1`;
	const recentProjectsSettingKey = `${productId}:audio-editor-recent-project-ids`;
	const lastProjectSettingKey = `${productId}:last-project-id`;
	const productSettingKey = (name) => productId === 'soundscaper' ? name : `${productId}:${name}`;
	const documentListeners = new Set();
	const telemetryListeners = new Set();
	let documentSnapshot = null;
	let telemetrySnapshot = null;
	const fileService = options.fileService || createAudioEditorFileService();
	const store = options.store || createProjectStore({ memoryFallback: !fileService.isDesktop });
	const sourceBuffers = createSourceBufferCache({
		maxBytes: options.sourceBufferCacheMaxBytes,
	});
	const mixRenderMemoryLimitBytes = normalizeByteLimit(
		options.mixRenderMemoryLimitBytes,
		AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES,
	);
	const sourceChunkProviders = new Map();
	const sourcePeaks = new Map();
	const videoVisuals = new Map();
	const sessionController = options.sessionController || createAudioEditorSessionController();
	const currentTimeMs = typeof options.now === 'function' ? options.now : () => Date.now();
	const scheduleTimer = typeof options.setTimeout === 'function' ? options.setTimeout : globalThis.setTimeout.bind(globalThis);
	const clearScheduledTimer = typeof options.clearTimeout === 'function' ? options.clearTimeout : globalThis.clearTimeout.bind(globalThis);
	const scheduleInterval = typeof options.setInterval === 'function' ? options.setInterval : globalThis.setInterval.bind(globalThis);
	const clearScheduledInterval = typeof options.clearInterval === 'function' ? options.clearInterval : globalThis.clearInterval.bind(globalThis);
	let aup4Client = options.aup4Client || null;
	let aup4Environment = null;
	let aup4Initialized = false;
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
	const state = {
		history: null,
		preferences: createAudioEditorPreferencesV1({ workspace: { activeId: product.defaultWorkspace } }),
		preferencesReadOnly: false,
		selectedTrackId: null,
		selectedClipId: null,
		clipboard: null,
		effectClipboard: null,
		pixelsPerSecond: DEFAULT_PIXELS_PER_SECOND,
		timelineViewportWidth: 0,
		autoFitTrackHeight: true,
		visibleTrackHeights: {},
		mobile: classifyMobile(),
	timelineWidth: EDITOR_TIMELINE_MINIMUM_SECONDS * DEFAULT_PIXELS_PER_SECOND,
		timelineView: 'waveform',
		readOnly: false,
		projectLock: null,
		projectLockRetryTimer: 0,
		autosaveTimer: 0,
		sourceGcTimer: 0,
		saveGeneration: 0,
		pendingSaveSnapshots: new Set(),
		saveQueue: Promise.resolve(),
		recorder: null,
		recordingWriter: null,
		recordingStream: null,
		recordingStarting: false,
		recordingStartGeneration: 0,
		recordingStartPromise: null,
		timedRecording: null,
		timedRecordingTimer: null,
		timedRecordingGeneration: 0,
		timedRecordingPreparing: false,
		timedRecordingCancelling: false,
		recordingPaused: false,
		recordingInputGain: RECORDING_INPUT_GAIN_DEFAULT,
		leadInRecording: false,
		importing: false,
		projectBinPreview: null,
		recordingSourceId: null,
		recordingStartFrame: 0,
		recordingSourceOffsetFrames: 0,
		recordingSampleRate: null,
		recordingTrackId: null,
		recordingSelection: null,
		recordingResampler: null,
		recordingPreview: null,
		recordingPreviews: [],
		recordingEntries: null,
		recordingPreviewLastPublishedAt: 0,
		recordingCleanup: null,
		recordingFinishing: false,
		recordingFinalizePromise: null,
		recordingFatalError: null,
		recordingDiscardRequested: false,
		recordingReleaseAfterStop: false,
		recordingRouting: normalizeRecordingRouting(),
		recordingDevices: [],
		recordingEnumeratedDeviceIds: new Set(),
		audioInputDevices: [],
		audioOutputDevices: [],
		audioInputAccess: false,
		preferredInputDeviceId: RECORDING_DEFAULT_DEVICE_ID,
		preferredInputChannelCount: 1,
		preferredOutputDeviceId: '',
		activeOutputDeviceId: '',
		audioOutputStatus: 'default',
		recordingRouteHealth: {},
		recordingPoolSources: [],
		inputMeters: {},
		playbackCacheAbort: null,
		playbackCacheGeneration: 0,
		playAtSpeedRate: 1,
		playAtSpeedAbort: null,
		playAtSpeedGeneration: 0,
		exportAbort: null,
		exportGeneration: 0,
		outputUrl: null,
		outputCleanup: null,
		projectQueue: Promise.resolve(),
		missingSourceIds: new Set(),
		audacityEffectType: audioSelectionEffectTypes()[0],
		audacityEffectParams: {},
		audacityEffectTouchedParams: new Map(),
		effectPresets: createAudioEditorEffectPresets(),
		rackEffectGestures: new Map(),
		parametricEqGestures: new Map(),
		videoEffectGestures: new Map(),
		audacityControlTrackId: null,
		audacityNoiseProfile: null,
		audacityEffectProcessing: false,
		audacityPreviewSource: null,
		audacityPreviewAuditionBandId: null,
		audacityPreviewGeneration: 0,
		lastAudacityEffect: null,
		audacityEffectWorker: null,
		nyquistAbort: null,
		nyquistResult: null,
		spectralWorker: null,
		phase: 'loading',
		projects: [],
		recentProjectIds: [],
		status: { message: copy.ready, state: 'info' },
		saveState: 'saved',
		storageEstimate: { usage: null, quota: null },
		analysisResult: null,
		analysisVisuals: null,
		analysisReport: null,
		analysisProcessing: false,
		contrastSelections: { foreground: null, background: null },
		sampleEditMode: null,
		sampleEditAvailable: false,
		sampleEditProcessing: false,
		sampleEditAbort: null,
		exportProgress: 0,
		exportOutput: null,
		monitoring: false,
		microphoneMetering: false,
		latencyOffsetMs: 0,
		showRms: false,
		showVerticalRulers: true,
		updateDisplayWhilePlaying: true,
		pinnedPlayhead: false,
		playbackOnRulerClick: true,
		metronomeEnabled: false,
		selectionFollowsLoop: false,
		metronomeTimer: 0,
		positionFrame: 0,
		durationFrames: 0,
		transportState: 'stopped',
		meters: { tracks: {}, master: null },
		inputMeterDb: -60,
		inputMeter: null,
		inputLoudnessMeasurementManuallyPaused: false,
		inputLoudnessMeasurementExplicitlyRunning: false,
		disposed: false,
	};
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
	let microphoneMeterSession = null;
	let microphoneMeterStartPromise = null;
	let microphoneMeterGeneration = 0;
	let microphoneMeterTargetKey = null;
	let routedInputLoudnessMeter = null;
	let routedInputLoudnessMeterKey = null;
	let projectBinPreviewEngine = null;
	const projectBinReplacementStages = new Map();
	let removeDeviceChangeListener = () => {};
	let project = null;
	const unsubscribeParametricEqErrors = typeof engine.subscribeParametricEqErrors === 'function'
		? engine.subscribeParametricEqErrors((error) => handleError(error))
		: () => {};

	const ready = bootstrap()
		.then(() => {
			state.phase = 'ready';
			publishDocumentSnapshot();
			if (state.microphoneMetering) {
				void setMicrophoneMetering(true).catch((error) => {
					if (!state.disposed) handleError(error);
				});
			}
			return getSnapshot();
		})
		.catch((error) => {
			state.phase = 'error';
			handleError(error);
			publishDocumentSnapshot();
			return getSnapshot();
		});
	const actions = createControllerActions();

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
		subscribe: (listener) => subscribeTo(documentListeners, listener),
		getTelemetrySnapshot,
		subscribeTelemetry: (listener) => subscribeTo(telemetryListeners, listener),
		getClipVisualData,
		getProjectBinClipVisualData,
		actions,
		async dispose() {
			if (state.disposed) return;
			state.disposed = true;
			removeDeviceChangeListener();
			removeDeviceChangeListener = () => {};
			unsubscribeParametricEqErrors();
			cancelTimedRecording({ publish: false, status: false });
			cancelRecordingStart();
			state.phase = 'disposed';
			publishDocumentSnapshot();
			globalThis.clearTimeout(state.autosaveTimer);
			globalThis.clearTimeout(state.sourceGcTimer);
			cancelPlaybackCachePreparation();
			cancelPlayAtSpeedPreparation();
			state.sampleEditAbort?.abort();
			stopMetronome();
			state.audacityEffectWorker?.terminate();
			state.audacityEffectWorker = null;
			state.nyquistAbort?.abort();
			state.nyquistAbort = null;
			nyquistClient?.dispose();
			cancelAudacityEffectPreview({ publish: false });
			state.spectralWorker?.terminate();
			state.spectralWorker = null;
			state.microphoneMetering = false;
			microphoneMeterGeneration += 1;
			stopMicrophoneMetering({ releaseInput: false });
			await stopRecording().catch(() => undefined);
			await Promise.resolve(recordingCapturePool.dispose?.());
			await releaseProjectLock();
			if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
			await state.outputCleanup?.();
			await stopProjectBinPreview({ dispose: true });
			for (const token of [...projectBinReplacementStages.keys()]) {
				await cancelProjectBinReplacement(token);
			}
			ffmpeg.dispose();
			aup4Client?.dispose();
			aup4Client = null;
			aup4Initialized = false;
			clipTimePitchCache.dispose?.();
			sessionController.dispose?.();
			await engine.dispose();
			sourceBuffers.clear();
			sourceChunkProviders.clear();
			sourcePeaks.clear();
			revokeVideoVisuals();
			await store.close?.();
			documentListeners.clear();
			telemetryListeners.clear();
		},
	};

	function subscribeTo(listeners, listener) {
		if (typeof listener !== 'function') throw new TypeError('Audio editor subscribers must be functions.');
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	function getSnapshot() {
		if (!documentSnapshot) documentSnapshot = buildDocumentSnapshot();
		return documentSnapshot;
	}

	function getTelemetrySnapshot() {
		if (!telemetrySnapshot) telemetrySnapshot = buildTelemetrySnapshot();
		return telemetrySnapshot;
	}

	function publishDocumentSnapshot() {
		documentSnapshot = buildDocumentSnapshot();
		for (const listener of [...documentListeners]) listener();
	}

	function publishRecordingPreview() {
		const now = globalThis.performance?.now?.() ?? Date.now();
		if (now - state.recordingPreviewLastPublishedAt < LIVE_RECORDING_WAVEFORM_PUBLISH_INTERVAL_MS) return;
		state.recordingPreviewLastPublishedAt = now;
		publishDocumentSnapshot();
	}

	function publishTelemetrySnapshot() {
		telemetrySnapshot = buildTelemetrySnapshot();
		for (const listener of [...telemetryListeners]) listener();
	}

	function buildDocumentSnapshot() {
		const currentProject = projectWithVideoEffectGestures(state.history?.present ?? null);
		const currentTabMetadata = currentProject ? sessionTab(currentProject.id)?.metadata || {} : {};
		const selection = currentProject?.selection && currentProject.selection.endFrame > currentProject.selection.startFrame
			? currentProject.selection
			: null;
		return Object.freeze({
			product,
			productId,
			capabilities,
			ready: state.phase === 'ready',
			phase: state.phase,
			headless: true,
			locale,
			project: currentProject,
			projects: state.projects,
			recentProjects: Object.freeze(state.recentProjectIds
				.map((projectId) => state.projects.find((candidate) => candidate.id === projectId))
				.filter(Boolean)),
			projectTabs: Object.freeze(sessionController.getSnapshot().tabs.map((tab) => Object.freeze({
				id: tab.projectId,
				title: tab.title,
				dirty: tab.dirty,
				readOnly: tab.readOnly,
			}))),
			preferences: state.preferences,
			preferencesReadOnly: state.preferencesReadOnly,
			selectedTrackId: state.selectedTrackId,
			selectedClipId: state.selectedClipId,
			selection,
			transportState: state.transportState,
			projectBinPreview: state.projectBinPreview
				? Object.freeze({ ...state.projectBinPreview })
				: null,
			playbackOptions: Object.freeze({
				rate: state.playAtSpeedRate,
				mode: state.preferences.playback?.playAtSpeedMode || 'naive',
				preparing: Boolean(state.playAtSpeedAbort),
			}),
			readOnly: state.readOnly,
			lockReadOnly: Boolean(state.projectLock?.readOnly),
			importing: state.importing,
			recordingStarting: state.recordingStarting,
			recordingScheduling: state.timedRecordingPreparing,
			scheduledRecording: state.timedRecording
				? Object.freeze({
					startTimeMs: state.timedRecording.startTimeMs,
					startTime: new Date(state.timedRecording.startTimeMs).toISOString(),
					trackId: state.timedRecording.options.trackId || null,
				})
				: null,
			recording: Boolean(state.recorder && !state.timedRecording && !state.timedRecordingCancelling),
			recordingPreview: recordingPreviewSnapshot(state.recordingPreview),
			recordingPreviews: Object.freeze(state.recordingPreviews
				.map(recordingPreviewSnapshot)
				.filter(Boolean)),
			recordingInputs: Object.freeze({
				devices: Object.freeze(state.recordingDevices),
				routes: state.recordingRouting.routes,
				offsets: state.recordingRouting.offsets,
				health: Object.freeze({ ...state.recordingRouteHealth }),
				sources: Object.freeze(state.recordingPoolSources),
				retainInputs: state.preferences.recording.retainInputs,
				hasOpenInputs: state.recordingPoolSources.length > 0,
			}),
			audioDevices: audioDevicesSnapshot(),
			processingEffect: state.audacityEffectProcessing,
			exporting: Boolean(state.exportAbort),
			timeline: Object.freeze({
				view: state.timelineView,
				showRms: state.showRms,
				showVerticalRulers: state.showVerticalRulers,
				updateDisplayWhilePlaying: state.updateDisplayWhilePlaying,
				pinnedPlayhead: state.pinnedPlayhead,
				playbackOnRulerClick: state.playbackOnRulerClick,
				pixelsPerSecond: state.pixelsPerSecond,
				width: state.timelineWidth,
				autoFitTrackHeight: state.autoFitTrackHeight,
			}),
			sampleEdit: Object.freeze({
				available: sampleEditingAvailable(),
				mode: state.sampleEditMode,
				processing: state.sampleEditProcessing,
			}),
			history: Object.freeze({
				canUndo: Boolean(state.history && canUndo(state.history)),
				canRedo: Boolean(state.history && canRedo(state.history)),
				hasClipboard: Boolean(state.clipboard),
				undoEntries: Object.freeze((state.history?.undoStack || []).slice(-20).reverse().map(historyEntrySummary)),
				redoEntries: Object.freeze((state.history?.redoStack || []).slice(-20).reverse().map(historyEntrySummary)),
			}),
			status: Object.freeze({ ...state.status }),
			save: Object.freeze({ state: state.saveState }),
			aup4Compatibility: currentTabMetadata.aup4CompatibilityReport
				? Object.freeze({
					report: currentTabMetadata.aup4CompatibilityReport,
					dismissed: Boolean(currentTabMetadata.aup4CompatibilityReportDismissed),
				})
				: null,
			storage: Object.freeze({ ...state.storageEstimate }),
			analysis: state.analysisResult,
			analysisVisuals: state.analysisVisuals,
			analysisReport: state.analysisReport,
			analysisProcessing: state.analysisProcessing,
			export: Object.freeze({ progress: state.exportProgress, output: state.exportOutput }),
			effects: Object.freeze({
				rackTypes: Object.freeze(audioEffectTypes().map((type) => Object.freeze({ type, label: audioEffectLabel(type, copy) }))),
				videoTypes: Object.freeze(VIDEO_EFFECT_TYPES.map((type) => VIDEO_EFFECT_DEFINITIONS[type])),
				hasStackClipboard: state.effectClipboard !== null,
				selectionTypes: Object.freeze(audioSelectionEffectTypes().map((type) => Object.freeze({
					type,
					label: audioSelectionEffectLabel(type, copy),
				}))),
				selectionType: state.audacityEffectType,
				selectionParams: currentAudacityEffectParams(),
				selectionDefinition: AUDIO_SELECTION_EFFECT_DEFINITIONS[state.audacityEffectType] || null,
				controlTrackId: state.audacityControlTrackId,
				noiseProfileReady: Boolean(state.audacityNoiseProfile),
				canRepeatLast: Boolean(state.lastAudacityEffect),
				previewing: Boolean(state.audacityPreviewSource),
				presets: listAudioEditorEffectPresets(state.effectPresets, state.audacityEffectType),
			}),
			nyquist: Object.freeze({
				processing: Boolean(state.nyquistAbort),
				result: state.nyquistResult,
			}),
			monitor: Object.freeze({
				enabled: state.monitoring,
				metering: state.microphoneMetering,
				latencyOffsetMs: state.latencyOffsetMs,
			}),
			recordingOptions: Object.freeze({
				paused: state.recordingPaused,
				leadIn: state.leadInRecording,
				metronome: state.metronomeEnabled,
				inputGain: state.recordingInputGain,
			}),
			loopOptions: Object.freeze({ selectionFollows: state.selectionFollowsLoop }),
			missingSourceIds: Object.freeze([...state.missingSourceIds]),
			disposed: state.disposed,
		});
	}

	function projectWithVideoEffectGestures(currentProject) {
		if (!currentProject || !state.videoEffectGestures.size) return currentProject;
		let changed = false;
		const clips = currentProject.clips.map((clip) => {
			if (clip.kind !== 'video' || !Array.isArray(clip.videoEffects)) return clip;
			let clipChanged = false;
			const videoEffects = clip.videoEffects.map((effect) => {
				const gesture = state.videoEffectGestures.get(videoEffectGestureKey(clip.id, effect.id));
				if (!gesture) return effect;
				clipChanged = true;
				return { ...effect, params: structuredClone(gesture.params) };
			});
			if (!clipChanged) return clip;
			changed = true;
			return { ...clip, videoEffects };
		});
		return changed ? { ...currentProject, clips } : currentProject;
	}

	function buildTelemetrySnapshot() {
		const playback = engine.getState?.() || {};
		return Object.freeze({
			positionFrame: state.positionFrame,
			durationFrames: state.durationFrames,
			transportState: state.transportState,
			playbackMode: playback.playbackMode || 'normal',
			playbackRate: Number(playback.playbackRate) || 1,
			recording: Boolean(state.recorder && !state.timedRecording && !state.timedRecordingCancelling),
			meters: state.meters,
			inputMeterDb: state.inputMeterDb,
			inputMeter: state.inputMeter,
			inputMeters: Object.freeze({ ...state.inputMeters }),
			exportProgress: state.exportProgress,
		});
	}

	function audioDevicesSnapshot() {
		const outputState = engine.getOutputDeviceState?.() || {};
		const preferredInputAvailable = state.preferredInputDeviceId === RECORDING_DEFAULT_DEVICE_ID
			|| (state.preferredInputDeviceId === RECORDING_DISPLAY_SOURCE_KEY && Boolean(mediaDevices?.getDisplayMedia))
			|| state.audioInputDevices.some((device) => device.deviceId === state.preferredInputDeviceId);
		const preferredOutputAvailable = !state.preferredOutputDeviceId
			|| state.audioOutputDevices.some((device) => device.deviceId === state.preferredOutputDeviceId);
		return Object.freeze({
			inputs: Object.freeze(state.audioInputDevices),
			outputs: Object.freeze(state.audioOutputDevices),
			preferredInputDeviceId: state.preferredInputDeviceId,
			preferredInputChannelCount: state.preferredInputChannelCount,
			preferredOutputDeviceId: state.preferredOutputDeviceId,
			activeOutputDeviceId: outputState.activeDeviceId ?? state.activeOutputDeviceId,
			inputAccess: state.audioInputAccess,
			inputSupported: Boolean(mediaDevices?.getUserMedia || mediaDevices?.getDisplayMedia),
			microphoneInputSupported: Boolean(mediaDevices?.getUserMedia),
			displayInputSupported: Boolean(mediaDevices?.getDisplayMedia),
			displayCaptureOpen: state.recordingPoolSources.some((source) => source.kind === 'display'),
			outputSupported: Boolean(outputState.supported),
			preferredInputAvailable,
			preferredOutputAvailable,
			outputStatus: state.audioOutputStatus,
		});
	}

	function getClipVisualData(clipId) {
		const clip = project ? findClip(project, clipId) : null;
		if (!clip) return null;
		const source = findSource(project, clip.sourceId);
		const video = clip.kind === 'video' ? videoVisuals.get(clip.sourceId) : null;
		return Object.freeze({
			clip,
			track: findClipTrack(project, clip.id),
			source,
			buffer: sourceBuffers.get(clip.sourceId) || null,
			peaks: sourcePeaks.get(clip.sourceId) || null,
			available: Boolean(source && !state.missingSourceIds.has(source.id)),
			mediaUrl: video?.mediaUrl || null,
			posterUrl: video?.posterUrl || null,
			thumbnails: video?.thumbnails || Object.freeze([]),
		});
	}

	function getProjectBinClipVisualData(clipId) {
		const clip = project ? findProjectBinClip(project, clipId) : null;
		if (!clip) return null;
		const source = findSource(project, clip.sourceId);
		const itemClips = project.schemaVersion >= 4
			? projectBinClips(project).filter((candidate) => candidate.binItemId === clip.binItemId)
			: [clip];
		const videoClip = itemClips.find((candidate) => candidate.kind === 'video') || null;
		const video = videoClip ? videoVisuals.get(videoClip.sourceId) : null;
		const visual = {
			clip,
			track: null,
			source,
			buffer: sourceBuffers.get(clip.sourceId) || null,
			peaks: sourcePeaks.get(clip.sourceId) || null,
			available: Boolean(source && !state.missingSourceIds.has(source.id)),
		};
		if (videoClip) Object.assign(visual, {
			itemClips: Object.freeze(itemClips),
			videoClip,
			mediaUrl: video?.mediaUrl || null,
			posterUrl: video?.posterUrl || null,
			thumbnails: video?.thumbnails || Object.freeze([]),
		});
		return Object.freeze(visual);
	}

	function revokeVideoVisuals() {
		for (const sourceId of [...videoVisuals.keys()]) revokeVideoVisual(sourceId);
	}

	function revokeVideoVisual(sourceId) {
		const visual = videoVisuals.get(sourceId);
		if (!visual) return;
		for (const url of [
			visual.mediaUrl,
			visual.posterUrl,
			...(visual.thumbnails || []).map((thumbnail) => thumbnail.url),
		]) {
			if (url) globalThis.URL?.revokeObjectURL?.(url);
		}
		videoVisuals.delete(sourceId);
	}

	async function activateVideoSource(source) {
		const sourceId = source.storageKey || source.id;
		const mediaBlob = await store.loadMediaAsset(sourceId);
		if (!mediaBlob) throw new Error('The original video file is missing.');
		const mediaUrl = globalThis.URL?.createObjectURL?.(mediaBlob) || null;
		let posterUrl = null;
		const thumbnails = [];
		const derivatives = await store.listVideoDerivatives(sourceId);
		for (const derivative of derivatives) {
			const blob = await store.loadVideoDerivative(sourceId, derivative);
			const url = blob && globalThis.URL?.createObjectURL?.(blob);
			if (!url) continue;
			if (derivative.type === 'poster') posterUrl = url;
			else if (derivative.type === 'thumbnail') {
				thumbnails.push(Object.freeze({
					sourceTimeSeconds: derivative.timestamp,
					timestampSeconds: derivative.timestamp,
					url,
					width: derivative.width,
					height: derivative.height,
				}));
			} else globalThis.URL?.revokeObjectURL?.(url);
		}
		videoVisuals.set(source.id, Object.freeze({
			mediaUrl,
			posterUrl: posterUrl || thumbnails[0]?.url || null,
			thumbnails: Object.freeze(thumbnails),
		}));
	}

	function projectBinClips(snapshot = project) {
		return Array.isArray(snapshot?.projectBin?.clips) ? snapshot.projectBin.clips : [];
	}

	function allProjectClips(snapshot = project) {
		return [...(snapshot?.clips || []), ...projectBinClips(snapshot)];
	}

	function hasMissingTimelineSources(snapshot = project, options = {}) {
		if (!state.missingSourceIds.size) return false;
		const sourceById = options.audioOnly
			? new Map((snapshot?.sources || []).map((source) => [source.id, source]))
			: null;
		return (snapshot?.clips || []).some((clip) => (
			(!options.audioOnly || (clip.kind !== 'video' && sourceById.get(clip.sourceId)?.kind !== 'video'))
			&& state.missingSourceIds.has(clip.sourceId)
		));
	}

	function getVisibleClips(options = {}) {
		if (!project) return [];
		const startFrame = Math.max(0, Number.isSafeInteger(options.startFrame) ? options.startFrame : 0);
		const defaultEndFrame = Math.max(startFrame, projectDurationFrames(project));
		const endFrame = Math.max(startFrame, Number.isSafeInteger(options.endFrame) ? options.endFrame : defaultEndFrame);
		const overscanFrames = Math.max(0, Number.isSafeInteger(options.overscanFrames) ? options.overscanFrames : endFrame - startFrame);
		const visibleStart = Math.max(0, startFrame - overscanFrames);
		const visibleEnd = endFrame + overscanFrames;
		return project.clips
			.filter((clip) => clip.timelineStartFrame < visibleEnd && clip.timelineStartFrame + clip.durationFrames > visibleStart)
			.map((clip) => getClipVisualData(clip.id));
	}

	function createControllerActions() {
		const restricted = (capability, action) => (...args) => {
			if (!capabilities[capability]) {
				throw new RangeError(`${product.name} does not support ${capability}.`);
			}
			return action(...args);
		};
		return Object.freeze({
			project: Object.freeze({
				create: (projectOptions) => newProject(projectOptions),
				open: (value) => openProject(value),
				openRecent: async (projectId = null) => {
					if (projectId == null) return state.recentProjectIds
						.map((id) => state.projects.find((candidate) => candidate.id === id))
						.filter(Boolean);
					if (!state.recentProjectIds.includes(projectId)) throw new Error(copy.projectNotFound);
					const openTab = sessionTab(projectId);
					if (openTab) return switchProject(openTab.history.present);
					const saved = await store.loadProject(projectId);
					if (!saved) throw new Error(copy.projectNotFound);
					return openProject(saved);
				},
				clearRecent: clearRecentProjects,
				openAup4,
				openScape,
				inspectScape: (file) => inspectScapeProject(file, store),
				saveAup4,
				saveScape,
				saveAs: saveScape,
				dismissAup4CompatibilitySummary,
				close: closeProjectTab,
				openById: async (projectId) => {
					const openTab = sessionTab(projectId);
					if (openTab) return switchProject(openTab.history.present);
					const saved = await store.loadProject(projectId);
					if (!saved) throw new Error(copy.projectNotFound);
					return openProject(saved);
				},
				list: listProjects,
				save: saveNow,
				flush: flushProject,
				prepareHandoff: prepareProjectHandoff,
				claimLock: claimProjectLock,
				rename: (title) => renameProject(title),
				duplicate: (title) => duplicateProject(title),
				remove: deleteProject,
				clear: clearLocalData,
				importFiles,
				setTempo: (bpm) => commit({ type: 'tempo/set', bpm }),
				setTimeSignature: (numerator, denominator) => commit({ type: 'tempo/set', numerator, denominator }),
				setTimeDisplay: (format) => commit({ type: 'time-display/set', format }),
			}),
			projectBin: Object.freeze({
				moveFromTimeline: moveClipsToProjectBin,
				place: placeProjectBinClip,
				rename: renameProjectBinClip,
				setColor: setProjectBinClipColor,
				remove: removeProjectBinClip,
				removeFromBin: removeProjectBinClip,
				removeFromProject: removeProjectBinSource,
				selectInstances: selectProjectBinInstances,
				instanceCount: projectBinInstanceCount,
				prepareReplacement: prepareProjectBinReplacement,
				applyReplacement: applyProjectBinReplacement,
				cancelReplacement: cancelProjectBinReplacement,
				playPause: playPauseProjectBinClip,
				stopPreview: stopProjectBinPreview,
				getVisualData: getProjectBinClipVisualData,
			}),
			video: Object.freeze({
				getClipVisualData,
				export: exportVideo,
				effects: Object.freeze({
					add: restricted('videoEffects', addVideoClipEffect),
					update: restricted('videoEffects', updateVideoClipEffect),
					bypass: restricted('videoEffects', bypassVideoClipEffect),
					toggle: restricted('videoEffects', toggleVideoClipEffect),
					reorder: restricted('videoEffects', reorderVideoClipEffect),
					remove: restricted('videoEffects', removeVideoClipEffect),
					beginGesture: restricted('videoEffects', beginVideoEffectGesture),
					preview: restricted('videoEffects', previewVideoEffectGesture),
					commit: restricted('videoEffects', commitVideoEffectGesture),
					cancel: restricted('videoEffects', cancelVideoEffectGesture),
				}),
				link: (videoClipId, audioClipId) => commit({
					type: 'clip/link-av',
					videoClipId,
					audioClipId,
					avLinkId: createStableId('av-link'),
				}),
				unlink: (clipId) => commit({ type: 'clip/unlink-av', clipId }),
			}),
			edit: Object.freeze({
				execute: handleEdit,
				commit,
				undo: () => handleEdit('undo'),
				redo: () => handleEdit('redo'),
				copy: () => handleEdit('copy'),
				cut: () => handleEdit('cut'),
				paste: () => handleEdit('paste'),
				pasteOverlap: () => handleEdit('paste-overlap'),
				pasteInsert: () => handleEdit('paste-insert'),
				pasteAllTracksRipple: () => handleEdit('paste-all-tracks-ripple'),
				split: () => handleEdit('split'),
				splitAt: splitAtFrame,
				splitIntoNewTrack: () => handleEdit('split-new-track'),
				join: () => handleEdit('join'),
				disjoin: () => disjoinSelectedClip(),
				group: () => handleEdit('group'),
				ungroup: () => handleEdit('ungroup'),
				duplicate: () => handleEdit('duplicate'),
				delete: () => handleEdit('delete'),
				rippleDelete: () => handleEdit('ripple-delete'),
				cutLeaveGap: () => handleEdit('cut-leave-gap'),
				cutPerClipRipple: () => handleEdit('cut-per-clip-ripple'),
				cutPerTrackRipple: () => handleEdit('cut-per-track-ripple'),
				cutAllTracksRipple: () => handleEdit('cut-all-tracks-ripple'),
				deleteLeaveGap: () => handleEdit('delete-leave-gap'),
				deletePerClipRipple: () => handleEdit('delete-per-clip-ripple'),
				deletePerTrackRipple: () => handleEdit('delete-per-track-ripple'),
				deleteAllTracksRipple: () => handleEdit('delete-all-tracks-ripple'),
				trimOutsideSelection: () => handleEdit('trim-outside-selection'),
				silenceSelection: restricted('audioGenerators', () => generateSelectionSilence()),
			}),
			transport: Object.freeze({
				playPause: () => handleTransport('play'),
				playAtSpeed: (rate = state.playAtSpeedRate) => handlePlayAtSpeed(rate),
				setPlayAtSpeedRate,
				stop: () => handleTransport('stop'),
				seek: (frame) => engine.seek(normalizePlaybackFrame(frame)),
				scrub: (frame) => {
					if (state.recordingStarting || state.timedRecordingPreparing || state.timedRecording || state.recorder) {
						return engine.getPositionFrames();
					}
					if (hasMissingTimelineSources()) throw new Error(copy.localSourcesMissing);
					cancelPlaybackCachePreparation();
					const nextFrame = normalizePlaybackFrame(frame);
					return typeof engine.scrub === 'function' ? engine.scrub(nextFrame) : engine.seek(nextFrame);
				},
				endScrub: () => engine.endScrub?.(),
				jumpStart: () => handleTransport('jump-start'),
				jumpEnd: () => handleTransport('jump-end'),
				rewind: () => handleTransport('rewind'),
				forward: () => handleTransport('forward'),
				toggleLoop: () => handleTransport('loop'),
				clearLoop: clearLoopRegion,
				setLoopRegion,
				loopToSelection: setLoopRegionToSelection,
				selectionToLoop: setSelectionToLoopRegion,
				setLoopInOut: setLoopRegionInOut,
				toggleSelectionFollowsLoop: toggleSelectionFollowsLoop,
				toggleMetronome,
			}),
			recording: Object.freeze({
				start: restricted('audioRecording', startRecording),
				startNewTrack: restricted('audioRecording', startRecordingOnNewTrack),
				schedule: restricted('audioRecording', scheduleTimedRecording),
				cancelScheduled: cancelTimedRecording,
				pause: toggleRecordingPause,
				stop: stopRecording,
				toggleLeadIn: restricted('audioRecording', toggleLeadInRecording),
				setMonitoring: restricted('audioRecording', setMonitoring),
				setMetering: restricted('audioRecording', setMicrophoneMetering),
				setLevel: restricted('audioRecording', setRecordingInputGain),
				setLatencyOffset: restricted('audioRecording', setLatencyOffset),
				requestInputAccess: restricted('audioRecording', requestInputAccess),
				refreshInputs: restricted('audioRecording', refreshRecordingInputs),
				setTrackInput: restricted('audioRecording', setRecordingTrackInput),
				clearTrackInput: restricted('audioRecording', (trackId) => setRecordingTrackInput(trackId, null)),
				setSourceOffset: restricted('audioRecording', setRecordingSourceLatency),
				setRetainInputs: restricted('audioRecording', setRetainInputs),
				releaseInputs,
			}),
			metering: Object.freeze({
				pause: pauseLoudnessMeasurement,
				continue: continueLoudnessMeasurement,
				reset: resetLoudnessMeasurement,
			}),
			audioDevices: Object.freeze({
				requestAccess: requestInputAccess,
				refresh: () => refreshAudioDevices({ probe: true }),
				setPreferredInput: setPreferredInputDevice,
				setPreferredInputChannelCount,
				configureDisplayInput,
				setOutput: setAudioOutputDevice,
			}),
		timeline: Object.freeze({
			selectTrack,
			selectClip,
			setSelection,
			clearSelection: () => {
				state.selectedClipId = null;
				return updateSelection({
					type: 'selection/set',
					startFrame: 0,
					endFrame: 0,
					trackIds: [],
					clipIds: [],
					frequencyRange: null,
				});
			},
			selectAllTracks,
				selectLeftOfPlayback: selectLeftOfPlaybackPosition,
				selectRightOfPlayback: selectRightOfPlaybackPosition,
				selectTrackStartToCursor,
				selectCursorToTrackEnd,
				selectTrackStartToEnd,
				setSnap: setSnapSettings,
				snapFrame: (frame, overrides) => snapTimelineFrame(frame, overrides),
				zeroCross: selectAtZeroCrossings,
				setView: setTimelineView,
				setAllTracksView: setAllTracksView,
				toggleRms: toggleRmsWaveform,
				toggleVerticalRulers,
				toggleUpdateWhilePlaying,
				togglePinnedPlayhead,
			toggleRulerPlayback,
			setViewportWidth: setTimelineViewportWidth,
			setZoom,
				zoomIn: () => updateZoom('in'),
				zoomOut: () => updateZoom('out'),
				zoomFit: (viewportWidth) => updateZoom('fit', viewportWidth),
				fitHeight: () => setAutoFitTrackHeight(true),
				resizeTrackHeight,
				setVisibleTrackHeights,
				getClipVisualData,
				getVisibleClips,
			}),
			sampleEdit: Object.freeze({
				setMode: restricted('audioSampleEditing', setSampleEditMode),
				pencil: restricted('audioSampleEditing', applySamplePencil),
				smooth: restricted('audioSampleEditing', smoothSelectedSamples),
				cancel: cancelSampleEdit,
			}),
			spectral: Object.freeze({
				boxSelect: restricted('audioSpectralEditing', setSpectralBoxSelection),
				delete: restricted('audioSpectralEditing', () => applySpectralSelection(-Infinity)),
				amplify: restricted('audioSpectralEditing', (gainDb = 6) => applySpectralSelection(gainDb)),
			}),
			track: Object.freeze({
				add: addTrack,
				addVideo: addVideoTrackPair,
				// Compatibility aliases for Audacity's two add-track commands. The
				// resulting browser track has no media layout until it contains clips.
				addMono: addTrack,
				addStereo: addTrack,
				addLabel: addLabelTrack,
				update: (trackId, changes) => commit({ type: 'track/update', trackId, changes }, { selectTrackId: trackId }),
				reorder: reorderTrack,
				moveUp: (trackId = state.selectedTrackId) => moveTrack(trackId, 'up'),
				moveDown: (trackId = state.selectedTrackId) => moveTrack(trackId, 'down'),
				moveTop: (trackId = state.selectedTrackId) => moveTrack(trackId, 'top'),
				moveBottom: (trackId = state.selectedTrackId) => moveTrack(trackId, 'bottom'),
				makeStereo: restricted('audioEffects', makeStereoTrack),
				swapChannels: restricted('audioEffects', swapTrackChannels),
				splitStereoLR: restricted('audioEffects', (trackId = state.selectedTrackId) => splitStereoTrack(trackId, true)),
				splitStereoCenter: restricted('audioEffects', (trackId = state.selectedTrackId) => splitStereoTrack(trackId, false)),
				decreaseHeight: (trackId = state.selectedTrackId) => adjustTrackHeight(trackId, -16),
				increaseHeight: (trackId = state.selectedTrackId) => adjustTrackHeight(trackId, 16),
				decreaseAllHeights: () => adjustAllTrackHeights(-16),
				increaseAllHeights: () => adjustAllTrackHeights(16),
				setDisplayMode: setTrackDisplayMode,
				setRate: restricted('audioEffects', setTrackRate),
				setSampleFormat: restricted('audioEffects', setTrackSampleFormat),
				setWaveformView: (trackId = state.selectedTrackId) => setTrackDisplayMode(trackId, 'waveform'),
				setSpectrogramView: restricted('audioSpectralEditing', (trackId = state.selectedTrackId) => setTrackDisplayMode(trackId, 'spectrogram')),
				setMultiView: restricted('audioSpectralEditing', (trackId = state.selectedTrackId) => setTrackDisplayMode(trackId, 'multiview')),
				mixAndRender: restricted('audioEffects', mixAndRenderTracks),
				resample: restricted('audioEffects', resampleTrack),
				duplicate: (trackId) => duplicateTrack(findTrack(project, trackId)),
				remove: (trackId) => commit({ type: 'track/remove', trackId }),
			}),
			mixer: Object.freeze({
				addBus: (busType, options = {}) => {
					const id = options.id || createStableId(`${busType}-bus`);
					commit({ type: 'mixer/bus-add', busType, bus: { ...options, id } });
					return id;
				},
				updateBus: (busType, busId, changes) => commit({ type: 'mixer/bus-update', busType, busId, changes }),
				removeBus: (busType, busId) => commit({ type: 'mixer/bus-remove', busType, busId }),
				setRoute: (trackId, changes) => commit({ type: 'mixer/route-update', trackId, changes }),
				setSend: (trackId, sendId, gain) => commit({
					type: 'mixer/route-update', trackId, changes: { sends: { [sendId]: gain } },
				}),
				updateMaster: (changes) => commit({ type: 'master/update', changes }),
			}),
			generators: Object.freeze({
				generate: restricted('audioGenerators', generateSignal),
			}),
			nyquist: Object.freeze({
				evaluate: restricted('audioEffects', (request) => runNyquistEvaluation(request)),
				preview: restricted('audioEffects', (request) => runNyquistEvaluation({ ...request, preview: true })),
				cancel: cancelNyquistEvaluation,
			}),
			labels: Object.freeze({
				add: addLabel,
				update: (trackId, labelId, changes) => commit({ type: 'label/update', trackId, labelId, changes }),
				remove: (trackId, labelId) => commit({ type: 'label/remove', trackId, labelId }),
				importFile: importLabelFile,
				export: exportLabels,
			}),
			metadata: Object.freeze({
				update: (changes) => commit({ type: 'metadata/update', changes }),
			}),
			preferences: Object.freeze({
				update: updatePreferences,
				setWorkspace: setWorkspacePreference,
				setTheme: (theme) => updatePreferences({ appearance: { theme } }),
				setClipStyle: (clipStyle) => updatePreferences({ appearance: { clipStyle } }),
				toggleToolbar: toggleToolbarPreference,
				moveToolbar: moveToolbarPreference,
				setToolbarButton: setToolbarButtonPreference,
				togglePanel: togglePanelPreference,
				setPanel: setPanelPreference,
				movePanel: movePanelPreference,
				setShortcut: setShortcutPreference,
				resetShortcuts: () => updatePreferences({ shortcuts: AUDIO_EDITOR_DEFAULT_SHORTCUTS }),
				createWorkspace: createWorkspacePreference,
				updateWorkspace: updateWorkspacePreference,
				deleteWorkspace: deleteWorkspacePreference,
			}),
			clip: Object.freeze({
				update: (clipId, changes) => commit({ type: 'clip/update', clipId, changes }, { selectClipId: clipId }),
				setTimePitch: restricted('audioEffects', setClipTimePitch),
				stretch: restricted('audioEffects', stretchClip),
				toggleStretchToTempo: restricted('audioEffects', (clipId = state.selectedClipId) => {
					const clip = clipId ? findClip(project, clipId) : null;
					if (!clip) throw new Error(copy.audioClipNotFound);
					return commit({
						type: 'clip/update',
						clipId: clip.id,
						changes: { stretchToTempo: !clip.stretchToTempo, renderCacheRevision: (clip.renderCacheRevision || 0) + 1 },
					}, { selectClipId: clip.id });
				}),
				resetPitchSpeed: restricted('audioEffects', resetClipPitchSpeed),
				renderPitchSpeed: restricted('audioEffects', renderClipPitchSpeed),
				move: moveClips,
				moveToNewTrack: moveClipsToNewTrack,
				trim: trimClips,
				overwrite: overwriteClips,
				remove: (clipId) => commit({ type: 'clip/remove', clipId }),
				reverse: restricted('audioEffects', (clipId) => handleClipAction('reverse', clipId)),
				normalizePeak: restricted('audioEffects', (clipId) => handleClipAction('normalize-peak', clipId)),
				normalizeLoudness: restricted('audioEffects', (clipId) => handleClipAction('normalize-lufs', clipId)),
			}),
			effects: Object.freeze({
				add: restricted('audioEffects', addEffect),
				update: restricted('audioEffects', updateRackEffect),
				beginRackEffectGesture: restricted('audioEffects', beginRackEffectGesture),
				previewRackEffect: restricted('audioEffects', previewRackEffect),
				commitRackEffectGesture: restricted('audioEffects', commitRackEffectGesture),
				cancelRackEffectGesture: restricted('audioEffects', cancelRackEffectGesture),
				beginParametricEqGesture: restricted('audioEffects', beginParametricEqGesture),
				previewParametricEq: restricted('audioEffects', previewParametricEq),
				commitParametricEqGesture: restricted('audioEffects', commitParametricEqGesture),
				cancelParametricEqGesture: restricted('audioEffects', cancelParametricEqGesture),
				auditionParametricEq: (scope, trackId, effectId, bandId) => engine.auditionParametricEq?.(scope, trackId, effectId, bandId) ?? false,
				readParametricEqSpectrum: (scope, trackId, effectId, which, target) => engine.readParametricEqSpectrum?.(scope, trackId, effectId, which, target) ?? null,
				readSelectionParametricEqSpectrum: (which, target) => state.audacityPreviewSource?.readSpectrum?.(which, target) ?? null,
				auditionSelectionParametricEq: (bandId) => {
					state.audacityPreviewAuditionBandId = bandId == null ? null : String(bandId);
					return state.audacityPreviewSource?.audition?.(state.audacityPreviewAuditionBandId) ?? false;
				},
				remove: restricted('audioEffects', (scope, trackId, effectId) => commit({ type: 'effect/remove', scope, trackId, busId: trackId, effectId })),
				reorder: restricted('audioEffects', (scope, trackId, effectId, toIndex) => commit({ type: 'effect/reorder', scope, trackId, busId: trackId, effectId, toIndex })),
				copyStack: restricted('audioEffects', copyEffectStack),
				pasteStack: restricted('audioEffects', pasteEffectStack),
				setMasterGain: (gain) => commit({ type: 'master/update', changes: { gain: Math.max(0, Math.min(4, Number(gain))) } }),
				setSelectionType: restricted('audioEffects', setAudacityEffectType),
				setSelectionParams: restricted('audioEffects', setAudacityEffectParamsFromController),
				setControlTrack: restricted('audioEffects', setAudacityControlTrack),
				captureNoiseProfile: restricted('audioEffects', captureSelectedNoiseProfile),
				captureRackNoiseProfile: restricted('audioEffects', captureRackNoiseProfileFromController),
				applySelection: restricted('audioEffects', applyAudacityEffectFromController),
				previewSelection: restricted('audioEffects', previewAudacityEffectFromController),
				cancelPreview: () => cancelAudacityEffectPreview(),
				repeatLast: restricted('audioEffects', repeatLastAudacityEffect),
				presets: Object.freeze({
					list: (effectType = state.audacityEffectType) => listAudioEditorEffectPresets(state.effectPresets, effectType),
					apply: restricted('audioEffects', applyEffectPreset),
					save: restricted('audioEffects', saveEffectPreset),
					saveAs: restricted('audioEffects', (name, params = currentAudacityEffectParams()) => saveEffectPreset({ name, params })),
					delete: restricted('audioEffects', deleteEffectPreset),
					import: restricted('audioEffects', importEffectPresets),
					export: restricted('audioEffects', exportEffectPreset),
				}),
			}),
			macros: Object.freeze({
				run: restricted('audioMacros', runEffectMacro),
			}),
			analysis: Object.freeze({
				run: restricted('audioAnalysis', runAnalysis),
				plotSpectrum: restricted('audioAnalysis', (scope = 'master') => runSpecializedAnalysis('spectrum', scope)),
				findClipping: restricted('audioAnalysis', (scope = 'master', options) => runSpecializedAnalysis('clipping', scope, options)),
				contrast: restricted('audioAnalysis', captureContrastSelection),
			}),
			export: Object.freeze({
				start: (settings) => handleExportAction('start', settings),
				cancel: () => handleExportAction('cancel'),
			}),
		});
	}

	async function loadPreferences() {
		let saved = await store.loadSetting(preferenceSettingKey, null);
		if (!saved && productId === 'soundscaper') {
			saved = await store.loadSetting('audio-editor-preferences-v1', null);
		}
		if (!saved) return state.preferences;
		try {
			const loaded = loadAudioEditorPreferencesV1(saved);
			if (loaded.readOnly) {
				state.preferencesReadOnly = true;
				return state.preferences;
			}
			state.preferences = productId === 'soundscaper' && loaded.preferences.workspace.activeId === 'video-editor'
				? applyAudioEditorWorkspace(loaded.preferences, 'modern')
				: loaded.preferences;
			await store.saveSetting(preferenceSettingKey, state.preferences);
			return state.preferences;
		} catch {
			state.preferences = createAudioEditorPreferencesV1({ workspace: { activeId: product.defaultWorkspace } });
			await store.saveSetting(preferenceSettingKey, state.preferences);
			return state.preferences;
		}
	}

	function persistPreferences(nextPreferences) {
		if (state.preferencesReadOnly) {
			throw new Error(copy.preferencesNewerSchema);
		}
		state.preferences = nextPreferences;
		publishDocumentSnapshot();
		return Promise.all([
			store.saveSetting(preferenceSettingKey, nextPreferences),
			...(productId === 'soundscaper' ? [store.saveSetting('audio-editor-preferences-v1', nextPreferences)] : []),
		])
			.then(() => nextPreferences)
			.catch((error) => {
				handleError(error);
				throw error;
			});
	}

	function updatePreferences(patch) {
		return persistPreferences(updateAudioEditorPreferencesV1(state.preferences, patch));
	}

	function setWorkspacePreference(workspaceId) {
		return persistPreferences(applyAudioEditorWorkspace(state.preferences, workspaceId));
	}

	function toggleToolbarPreference(toolbarId) {
		const toolbar = state.preferences.workspace.toolbars[toolbarId];
		if (!toolbar) throw new ReferenceError(`Toolbar ${toolbarId} does not exist.`);
		return updatePreferences({ workspace: { toolbars: { [toolbarId]: { ...toolbar, visible: !toolbar.visible } } } });
	}

	function moveToolbarPreference(toolbarId, requestedIndex) {
		const toolbars = state.preferences.workspace.toolbars;
		if (!toolbars[toolbarId]) throw new ReferenceError(`Toolbar ${toolbarId} does not exist.`);
		const orderedIds = Object.keys(toolbars)
			.filter((id) => id !== toolbarId)
			.sort((left, right) => toolbars[left].order - toolbars[right].order);
		const index = Math.max(0, Math.min(orderedIds.length, Math.round(Number(requestedIndex) || 0)));
		orderedIds.splice(index, 0, toolbarId);
		const changes = Object.fromEntries(orderedIds.map((id, order) => [id, { ...toolbars[id], order }]));
		return updatePreferences({ workspace: { toolbars: changes } });
	}

	function setToolbarButtonPreference(buttonId, visible) {
		if (typeof buttonId !== 'string' || !buttonId.trim()) throw new TypeError('Toolbar button ID is required.');
		if (typeof visible !== 'boolean') throw new TypeError('Toolbar button visibility must be boolean.');
		return updatePreferences({ workspace: { toolbarButtons: { [buttonId]: visible } } });
	}

	function togglePanelPreference(panelId) {
		const panel = state.preferences.workspace.panels[panelId];
		if (!panel) throw new ReferenceError(`Panel ${panelId} does not exist.`);
		return setPanelPreference(panelId, { visible: !panel.visible });
	}

	function setPanelPreference(panelId, changes = {}) {
		const panel = state.preferences.workspace.panels[panelId];
		if (!panel) throw new ReferenceError(`Panel ${panelId} does not exist.`);
		return updatePreferences({ workspace: { panels: { [panelId]: { ...panel, ...changes } } } });
	}

	function movePanelPreference(panelId, dock, requestedIndex) {
		const panels = state.preferences.workspace.panels;
		const panel = panels[panelId];
		if (!panel) throw new ReferenceError(`Panel ${panelId} does not exist.`);
		const destinationIds = Object.keys(panels)
			.filter((id) => id !== panelId && panels[id].dock === dock)
			.sort((left, right) => panels[left].order - panels[right].order);
		const visibleDestinationIds = destinationIds.filter((id) => panels[id].visible);
		const index = Math.max(0, Math.min(visibleDestinationIds.length, Math.round(Number(requestedIndex) || 0)));
		const nextVisibleId = visibleDestinationIds[index];
		const previousVisibleId = visibleDestinationIds[index - 1];
		const insertionIndex = nextVisibleId
			? destinationIds.indexOf(nextVisibleId)
			: previousVisibleId
				? destinationIds.indexOf(previousVisibleId) + 1
				: destinationIds.length;
		destinationIds.splice(insertionIndex, 0, panelId);
		const changes = Object.fromEntries(destinationIds.map((id, order) => [id, {
			...panels[id],
			dock,
			order,
		}]));
		if (panel.dock !== dock) {
			Object.keys(panels)
				.filter((id) => id !== panelId && panels[id].dock === panel.dock)
				.sort((left, right) => panels[left].order - panels[right].order)
				.forEach((id, order) => { changes[id] = { ...panels[id], order }; });
		}
		return updatePreferences({ workspace: { panels: changes } });
	}

	function setShortcutPreference(actionId, bindings) {
		if (typeof actionId !== 'string' || !actionId.trim()) throw new TypeError(copy.shortcutActionRequired);
		const shortcuts = { ...state.preferences.shortcuts };
		const values = (Array.isArray(bindings) ? bindings : [bindings])
			.map((binding) => String(binding ?? '').trim())
			.filter(Boolean)
			.map(normalizeAudioEditorShortcut);
		if (values.length) shortcuts[actionId] = [...new Set(values)];
		else delete shortcuts[actionId];
		const conflict = findAudioEditorShortcutConflicts(shortcuts)
			.find((entry) => entry.actionIds.includes(actionId));
		if (conflict) {
			const message = copy.shortcutConflict;
			throw new RangeError(message
				.replace('{binding}', conflict.binding)
				.replace('{action}', conflict.actionIds.find((id) => id !== actionId) || actionId));
		}
		return updatePreferences({ shortcuts });
	}

	function createWorkspacePreference(name, workspaceId = createStableId('workspace')) {
		return persistPreferences(createCustomAudioEditorWorkspace(state.preferences, {
			id: workspaceId,
			name: String(name || '').trim(),
		}));
	}

	function updateWorkspacePreference(workspaceId, changes = {}) {
		return persistPreferences(updateCustomAudioEditorWorkspace(state.preferences, workspaceId, changes));
	}

	function deleteWorkspacePreference(workspaceId) {
		return persistPreferences(deleteCustomAudioEditorWorkspace(state.preferences, workspaceId));
	}

	function sessionTab(projectId) {
		if (!projectId) return null;
		return sessionController.getSnapshot().tabs.find((tab) => tab.projectId === projectId) || null;
	}

	function persistActiveSessionUiState() {
		if (!project || !sessionTab(project.id)) return;
		sessionController.updateProjectMetadata(project.id, {
			selectedTrackId: state.selectedTrackId,
			selectedClipId: state.selectedClipId,
		});
	}

	async function bootstrap() {
		if (!engine || typeof engine.loadProject !== 'function') throw new Error(copy.webAudioUnsupported);
		await store.ready();
		await store.cleanupTemporaryAssets?.();
		void store.requestPersistentStorage();
		await loadPreferences();
		try {
			state.effectPresets = createAudioEditorEffectPresets(await store.loadSetting('audio-editor-effect-presets-v1', null) || {});
		} catch {
			state.effectPresets = createAudioEditorEffectPresets();
		}
		state.monitoring = Boolean(await store.loadSetting('input-monitor', false));
		state.microphoneMetering = Boolean(await store.loadSetting('microphone-metering', false));
		try {
			state.recordingInputGain = normalizeRecordingInputGain(await store.loadSetting(
				'recording-input-gain',
				RECORDING_INPUT_GAIN_DEFAULT,
			));
		} catch {
			state.recordingInputGain = RECORDING_INPUT_GAIN_DEFAULT;
		}
		state.latencyOffsetMs = normalizeLatencyOffset(await store.loadSetting('recording-latency-offset-ms', 0));
		state.leadInRecording = Boolean(await store.loadSetting('recording-lead-in', false));
		state.showRms = Boolean(await store.loadSetting(productSettingKey('waveform-show-rms'), false));
		state.showVerticalRulers = Boolean(await store.loadSetting(productSettingKey('timeline-show-vertical-rulers'), true));
		state.updateDisplayWhilePlaying = Boolean(await store.loadSetting(productSettingKey('timeline-update-while-playing'), true));
		state.pinnedPlayhead = Boolean(await store.loadSetting(productSettingKey('timeline-pinned-playhead'), false));
		state.playbackOnRulerClick = Boolean(await store.loadSetting(productSettingKey('timeline-ruler-playback'), true));
		state.metronomeEnabled = Boolean(await store.loadSetting(productSettingKey('transport-metronome'), false));
		state.selectionFollowsLoop = Boolean(await store.loadSetting(productSettingKey('selection-follows-loop'), false));
		const savedAudioDevices = normalizeAudioDevicePreferences(await store.loadSetting(
			productSettingKey(AUDIO_DEVICE_PREFERENCES_SETTING_KEY),
			null,
		));
		state.preferredInputDeviceId = savedAudioDevices.inputDeviceId;
		state.preferredInputChannelCount = savedAudioDevices.inputChannelCount;
		state.preferredOutputDeviceId = savedAudioDevices.outputDeviceId;
		await Promise.resolve(engine.setOutputDevice?.(state.preferredOutputDeviceId)).catch(() => undefined);
		await refreshAudioDevices({ probe: false, publish: false });
		if (typeof mediaDevices?.addEventListener === 'function') {
			const handleDeviceChange = () => {
				void refreshAudioDevices({ probe: false }).catch((error) => {
					if (!state.disposed) handleError(error);
				});
			};
			mediaDevices.addEventListener('devicechange', handleDeviceChange);
			removeDeviceChangeListener = () => mediaDevices.removeEventListener?.('devicechange', handleDeviceChange);
		}
		let storedRecentProjectIds = await store.loadSetting(recentProjectsSettingKey, null);
		if (!storedRecentProjectIds && productId === 'soundscaper') {
			storedRecentProjectIds = await store.loadSetting('audio-editor-recent-project-ids', []);
		}
		storedRecentProjectIds ||= [];
		state.recentProjectIds = Array.isArray(storedRecentProjectIds)
			? [...new Set(storedRecentProjectIds.filter((projectId) => typeof projectId === 'string' && projectId))]
			: [];
		let lastProjectId = await store.loadSetting(lastProjectSettingKey, null);
		if (!lastProjectId && productId === 'soundscaper') lastProjectId = await store.loadSetting('last-project-id', null);
		const saved = lastProjectId ? await store.loadProject(lastProjectId) : null;
		if (saved) await openProject(saved);
		else await newProject();
		publishProjectState();
		if (!state.readOnly) await saveNow();
		await refreshStorageUsage();
		if (hasMissingTimelineSources()) setStatus(copy.missingSourcesBlocked, 'error');
		else if (!state.readOnly) setStatus(copy.ready, 'success');
	}

	async function newProject(options = {}) {
		const title = String(options.title || copy.untitledProject).trim() || copy.untitledProject;
		const nextProject = createAudioEditorProjectV5({ title, sampleRate: normalizeProjectSampleRate(options.sampleRate) });
		const track = createAddTrackCommand({
			schemaVersion: 2,
			type: 'audio',
			name: `${copy.track} 1`,
			armed: true,
			height: 300,
		});
		const history = executeEditorCommand(createEditorHistory(nextProject), track);
		await switchProject(history.present, { save: true, skipFlush: options.skipFlush });
		const firstAudioTrack = project.tracks.find((candidate) => candidate.type === 'audio');
		if (firstAudioTrack) assignPreferredInputToTrack(firstAudioTrack.id);
	}

	async function openProject(value) {
		const loaded = migrateAudioEditorProject(value);
		const readOnlyReason = loaded.readOnly ? copy.futureProjectReadOnly : null;
		await switchProject(loaded.project, { readOnly: loaded.readOnly, readOnlyReason });
	}

	function switchProject(nextProject, options = {}) {
		const operation = state.projectQueue.then(() => performProjectSwitch(nextProject, options));
		state.projectQueue = operation.catch(() => undefined);
		return operation;
	}

	async function releaseProjectLock(lock = state.projectLock) {
		globalThis.clearTimeout(state.projectLockRetryTimer);
		state.projectLockRetryTimer = 0;
		if (!lock) return;
		if (state.projectLock === lock) state.projectLock = null;
		lock.release();
		await Promise.resolve(lock.finished).catch(() => undefined);
	}

	function scheduleProjectLockRecovery(projectId, lock) {
		globalThis.clearTimeout(state.projectLockRetryTimer);
		state.projectLockRetryTimer = 0;
		if (!lock?.readOnly || state.disposed || state.projectLock !== lock || project?.id !== projectId) return;
		if (lock.available) {
			void lock.available.then((availableLock) => {
				if (availableLock) return recoverProjectLock(projectId, lock, availableLock);
				if (state.projectLock === lock && project?.id === projectId && !state.disposed) {
					lock.available = null;
					lock.retryAt = Date.now() + 1_000;
					scheduleProjectLockRecovery(projectId, lock);
				}
				return undefined;
			}).catch((error) => handleProjectLockRecoveryError(projectId, lock, error));
			return;
		}
		const retryAt = Number.isFinite(lock.retryAt) ? lock.retryAt : Date.now() + 1_000;
		const delay = Math.max(100, Math.min(PROJECT_LOCK_RETRY_MAX_MS, retryAt - Date.now() + 25));
		state.projectLockRetryTimer = globalThis.setTimeout(() => {
			state.projectLockRetryTimer = 0;
			void recoverProjectLock(projectId, lock)
				.catch((error) => handleProjectLockRecoveryError(projectId, lock, error));
		}, delay);
	}

	function watchProjectLockLoss(projectId, lock) {
		if (!lock?.lost) return;
		void lock.lost.then(() => {
			if (state.disposed || state.projectLock !== lock || project?.id !== projectId) return;
			return recoverProjectLock(projectId, lock);
		}).catch((error) => handleProjectLockRecoveryError(projectId, lock, error));
	}

	async function claimProjectLock() {
		const projectId = project?.id;
		const previousLock = state.projectLock;
		const metadata = projectId ? sessionTab(projectId)?.metadata || {} : {};
		if (!projectId || !previousLock?.readOnly || metadata.intrinsicReadOnly) return false;
		await releaseProjectLock(previousLock);
		const nextLock = await acquireLock(projectId, { force: true });
		if (state.disposed || project?.id !== projectId) {
			nextLock.release();
			await Promise.resolve(nextLock.finished).catch(() => undefined);
			return false;
		}
		state.projectLock = nextLock;
		if (nextLock.readOnly) {
			state.readOnly = true;
			scheduleProjectLockRecovery(projectId, nextLock);
			publishProjectState();
			setStatus(copy.projectOpenOtherTab, 'error');
			return false;
		}
		watchProjectLockLoss(projectId, nextLock);
		state.readOnly = false;
		sessionController.setProjectReadOnly(projectId, {
			readOnly: false,
			reason: null,
			lockMethod: nextLock.method,
		});
		publishProjectState();
		setStatus(copy.ready, 'success');
		return true;
	}

	function handleProjectLockRecoveryError(projectId, lock, error) {
		if (state.projectLock === lock && project?.id === projectId && !state.disposed) {
			scheduleProjectLockRecovery(projectId, lock);
			handleError(error);
		}
	}

	async function recoverProjectLock(projectId, previousLock, availableLock = null) {
		if (state.disposed || state.projectLock !== previousLock || project?.id !== projectId) return;
		const nextLock = availableLock || await acquireLock(projectId);
		if (state.disposed || state.projectLock !== previousLock || project?.id !== projectId) {
			nextLock.release();
			await Promise.resolve(nextLock.finished).catch(() => undefined);
			return;
		}
		if (previousLock !== nextLock && nextLock.handoffFrom !== previousLock) previousLock.release();
		state.projectLock = nextLock;
		if (nextLock.readOnly) {
			state.readOnly = true;
			sessionController.setProjectReadOnly(projectId, {
				readOnly: true,
				reason: 'project-lock',
				lockMethod: nextLock.method,
			});
			scheduleProjectLockRecovery(projectId, nextLock);
			publishProjectState();
			setStatus(copy.projectOpenOtherTab, 'error');
			return;
		}
		watchProjectLockLoss(projectId, nextLock);

		const metadata = sessionTab(projectId)?.metadata || {};
		const intrinsicReadOnly = Boolean(metadata.intrinsicReadOnly);
		const intrinsicReadOnlyReason = metadata.intrinsicReadOnlyReason || null;
		state.readOnly = intrinsicReadOnly;
		sessionController.setProjectReadOnly(projectId, {
			readOnly: intrinsicReadOnly,
			reason: intrinsicReadOnlyReason,
			lockMethod: nextLock.method,
		});
		publishProjectState();
		setStatus(intrinsicReadOnly ? intrinsicReadOnlyReason || copy.projectReadOnly : copy.ready, intrinsicReadOnly ? 'error' : 'success');
	}

	async function performProjectSwitch(nextProject, options = {}) {
		state.rackEffectGestures.clear();
		state.parametricEqGestures.clear();
		state.videoEffectGestures.clear();
		cancelTimedRecording({ publish: false, status: false });
		cancelRecordingStart();
		state.exportAbort?.abort();
		state.exportAbort = null;
		state.sampleEditAbort?.abort();
		state.sampleEditMode = null;
		state.sampleEditAvailable = false;
		cancelPlaybackCachePreparation();
		cancelPlayAtSpeedPreparation();
		await stopRecording().catch(() => undefined);
		persistActiveSessionUiState();
		if (!options.skipFlush && project && project.id !== nextProject.id && !state.readOnly) await saveNow();
		globalThis.clearTimeout(state.autosaveTimer);
		state.autosaveTimer = 0;
		engine.stop();
		cancelAudacityEffectPreview({ publish: false });
		if (!state.projectLock || state.projectLock.projectId !== nextProject.id || state.projectLock.readOnly) {
			await releaseProjectLock();
			state.projectLock = await acquireLock(nextProject.id);
		}
		watchProjectLockLoss(nextProject.id, state.projectLock);
		const lockReadOnly = Boolean(state.projectLock.readOnly);
		const existingTab = sessionTab(nextProject.id);
		const existingMetadata = existingTab?.metadata || {};
		const intrinsicReadOnly = options.readOnly == null
			? Boolean(existingMetadata.intrinsicReadOnly)
			: Boolean(options.readOnly);
		const intrinsicReadOnlyReason = options.readOnlyReason
			?? existingMetadata.intrinsicReadOnlyReason
			?? null;
		state.readOnly = Boolean(intrinsicReadOnly || lockReadOnly);
		if (existingTab) sessionController.switchProject(nextProject.id);
		else sessionController.openProject(nextProject, {
			history: options.history,
			readOnly: state.readOnly,
			readOnlyReason: lockReadOnly ? 'project-lock' : intrinsicReadOnlyReason,
			lockMethod: state.projectLock.method,
			metadata: {
				intrinsicReadOnly,
				intrinsicReadOnlyReason,
			},
		});
		sessionController.updateProjectMetadata(nextProject.id, {
			intrinsicReadOnly,
			intrinsicReadOnlyReason,
		});
		sessionController.setProjectReadOnly(nextProject.id, {
			readOnly: state.readOnly,
			reason: lockReadOnly ? 'project-lock' : intrinsicReadOnlyReason,
			lockMethod: state.projectLock.method,
		});
		state.history = sessionController.getProjectHistory(nextProject.id);
		project = state.history.present;
		await loadRecordingRouting(project);
		const tabMetadata = sessionTab(nextProject.id)?.metadata || {};
		state.selectedTrackId = findTrack(project, tabMetadata.selectedTrackId)?.id
			?? project.tracks.find((track) => track.type !== 'label')?.id
			?? project.tracks[0]?.id
			?? null;
		state.selectedClipId = findClip(project, tabMetadata.selectedClipId)?.id ?? null;
		state.clipboard = sessionController.clipboardForProject(nextProject.id)?.descriptor ?? null;
		state.audacityNoiseProfile = null;
		state.audacityControlTrackId = null;
		state.analysisResult = null;
		state.analysisVisuals = null;
		state.analysisReport = null;
		state.analysisProcessing = false;
		state.contrastSelections = { foreground: null, background: null };
		if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
		state.outputUrl = null;
		await state.outputCleanup?.();
		state.outputCleanup = null;
		state.exportOutput = null;
		state.missingSourceIds.clear();
		revokeVideoVisuals();
		await loadProjectSources(project);
		clipTimePitchCache.retainClipIds?.(liveSessionClipIds());
		evictUnreferencedSourceCaches(sourceBuffers, sourcePeaks, liveSessionSourceIds());
		engine.loadProject(project, sourceBuffers, { chunkSources: sourceChunkProviders });
		await store.saveSetting(lastProjectSettingKey, nextProject.id);
		if (productId === 'soundscaper') await store.saveSetting('last-project-id', nextProject.id);
		state.recentProjectIds = [nextProject.id, ...state.recentProjectIds.filter((projectId) => projectId !== nextProject.id)].slice(0, 20);
		await store.saveSetting(recentProjectsSettingKey, state.recentProjectIds);
		if (productId === 'soundscaper') await store.saveSetting('audio-editor-recent-project-ids', state.recentProjectIds);
		if (options.save && !state.readOnly) {
			await store.saveProject(project);
			sessionController.markProjectSaved(project.id);
		}
		state.saveState = sessionTab(project.id)?.dirty ? 'dirty' : 'saved';
		state.projects = Object.freeze(await store.listProjects());
		synchronizeMicrophoneMeterTarget();
		publishProjectState();
		await garbageCollectSources();
		if (lockReadOnly) setStatus(copy.projectOpenOtherTab, 'error');
		else if (state.readOnly) setStatus(options.readOnlyReason || copy.projectReadOnly, 'error');
		scheduleProjectLockRecovery(nextProject.id, state.projectLock);
	}

	async function getAup4Client() {
		if (!aup4Client) aup4Client = createAup4Client(options.aup4 || {});
		if (!aup4Initialized) {
			aup4Environment = await aup4Client.initialize();
			aup4Initialized = true;
		}
		return aup4Client;
	}

	async function openScape(file, openOptions = {}) {
		if (!file || !/\.scape$/i.test(String(file.name || ''))) throw new TypeError('Choose a .scape project file.');
		if (editingBlocked()) return null;
		state.importing = true;
		publishDocumentSnapshot();
		try {
			const imported = await importScapeProject(file, store, { collision: openOptions.collision || 'copy' });
			await switchProject(imported.project, {
				readOnly: imported.readOnly,
				readOnlyReason: imported.readOnly ? copy.futureProjectReadOnly : null,
				skipFlush: false,
			});
			setStatus(`${copy.projectSaved}`, 'success');
			return imported;
		} finally {
			state.importing = false;
			publishDocumentSnapshot();
		}
	}

	async function saveScape(options = {}) {
		if (!project) throw new Error(copy.projectNotFound);
		if (state.readOnly && !options.saveCopy) throw new Error(copy.projectReadOnly);
		if (hasMissingTimelineSources(project)) throw new Error(copy.missingSourcesPreventSave);
		await flushProject();
		state.saveState = 'saving';
		publishDocumentSnapshot();
		try {
			const exported = await exportScapeProject(project, store);
			const saved = await fileService.saveFile({
				purpose: 'project',
				blob: exported.blob,
				suggestedName: ensureScapeFileName(options.fileName || project.title),
				mimeType: SCAPE_MIME_TYPE,
				target: options.saveTarget,
				useFileSystemAccess: options.useFileSystemAccess !== false,
			});
			state.saveState = 'saved';
			setStatus(copy.projectSaved, 'success');
			publishDocumentSnapshot();
			return { ...saved, manifest: exported.manifest };
		} catch (error) {
			state.saveState = 'dirty';
			publishDocumentSnapshot();
			throw error;
		}
	}

	async function openAup4(file) {
		if (!file || !/\.aup4$/i.test(String(file.name || ''))) throw new TypeError(copy.chooseAup4File);
		if (editingBlocked()) return;
		state.importing = true;
		publishDocumentSnapshot();
		setStatus(copy.aup4Validating);
		const nativeId = createStableId('aup4').replace(/[^a-z0-9_-]/gi, '-');
		const persistedSourceIds = [];
		try {
			const client = await getAup4Client();
			const storage = await store.estimateStorage();
			const opened = await client.openFile(nativeId, file, {
				mobile: state.mobile,
				opfs: aup4Environment?.opfs,
				quota: storage.quota,
				usage: storage.usage,
				workingBytes: file.size,
				onProgress: (progress) => updateNativeProjectProgress(progress, copy.importing),
			});
			const decoded = await client.decode(nativeId, {
				title: file.name,
				onProgress: (progress) => updateNativeProjectProgress(progress, copy.importing),
			});
			const importedProject = migrateAudioEditorProject(decoded.project).project;
			await preflightStorage(decoded.sources.reduce((sum, source) => sum + source.channels.reduce((total, channel) => total + channel.byteLength, 0), 0), 'import');
			for (const sourceAudio of decoded.sources) {
				const source = importedProject.sources.find((candidate) => candidate.id === sourceAudio.sourceId);
				if (!source) continue;
				const writer = await store.beginSourceWrite(source.id, {
					name: source.name,
					mimeType: source.mimeType,
					sampleRate: source.sampleRate,
					channelCount: source.channelCount,
					chunkFrames: SOURCE_CHUNK_FRAMES,
				});
				try {
					for (let offset = 0; offset < source.frameCount; offset += SOURCE_CHUNK_FRAMES) {
						const end = Math.min(source.frameCount, offset + SOURCE_CHUNK_FRAMES);
						await writer.write(sourceAudio.channels.map((channel) => channel.subarray(offset, end)));
					}
					await writer.commit({ sampleRate: source.sampleRate, channelCount: source.channelCount });
					persistedSourceIds.push(source.id);
				} catch (error) {
					await writer.abort();
					throw error;
				}
			}
			const compatibilityIssues = opened.validation?.issues || decoded.validation?.issues || [];
			const readOnlyIssue = compatibilityIssues.find((issue) => ['NEWER_DATABASE', 'NEWER_XML', 'EDITABLE_LIMIT_EXCEEDED', 'MISSING_LOCAL_AUDIO'].includes(issue.code));
			await switchProject(importedProject, {
				readOnly: opened.readOnly,
				readOnlyReason: readOnlyIssue?.message,
				save: !opened.readOnly,
			});
			const compatibilityReport = rememberAup4CompatibilityReport(
				decoded.compatibilityReport
					|| decoded.validation?.compatibilityReport
					|| opened.validation?.compatibilityReport,
				'open',
			);
			const validationWarnings = compatibilityIssues.filter((issue) => issue.level === 'warning').map((issue) => issue.message);
			const allWarnings = [...validationWarnings, ...(decoded.warnings || [])];
			const warning = allWarnings.length ? ` ${allWarnings.join(' ')}` : '';
			if (opened.readOnly) setStatus(
				readOnlyIssue?.code === 'EDITABLE_LIMIT_EXCEEDED'
					? copy.oversizedAup4ReadOnly
					: readOnlyIssue?.message || copy.newerAup4ReadOnly,
				'error',
			);
			else setStatus(`${copy.aup4Opened}${warning}`, allWarnings.length ? 'info' : 'success');
			return {
				project: importedProject,
				validation: decoded.validation,
				warnings: decoded.warnings || [],
				compatibilityReport,
			};
		} catch (error) {
			for (const sourceId of persistedSourceIds) await store.deleteSource(sourceId).catch(() => undefined);
			throw error;
		} finally {
			await Promise.resolve(
				typeof aup4Client?.delete === 'function'
					? aup4Client.delete(nativeId)
					: aup4Client?.close?.(nativeId),
			).catch(() => undefined);
			state.importing = false;
			publishDocumentSnapshot();
		}
	}

	async function saveAup4(options = {}) {
		if (!project || project.schemaVersion < 2) throw new Error(copy.aup4OnlyV2);
		if (hasMissingTimelineSources(project, { audioOnly: true })) throw new Error(copy.missingSourcesPreventSave);
		if (aup4ReportHasMissingPcm(sessionTab(project.id)?.metadata?.aup4CompatibilityReport)) {
			throw new Error(copy.missingSourcesPreventSave);
		}
		if (state.readOnly && !options.saveCopy) throw new Error(copy.projectReadOnly);
		let fileHandle = options.fileHandle;
		let saveTarget = options.saveTarget;
		if (fileService.isDesktop && saveTarget === undefined) {
			try {
				saveTarget = await fileService.chooseSaveTarget({
					purpose: 'aup4',
					suggestedName: ensureAup4FileName(options.fileName || project.title),
					mimeType: 'application/x-audacity-project',
				});
			} catch (error) {
				if (error?.name === 'AbortError') return { cancelled: true };
				throw error;
			}
			if (!saveTarget) return { cancelled: true };
		} else if (!fileHandle && options.useFileSystemAccess !== false) {
			try { fileHandle = await requestAup4FileHandle({ fileName: options.fileName || project.title }); }
			catch (error) {
				if (error?.name === 'AbortError') return { cancelled: true };
				throw error;
			}
		}
		const client = await getAup4Client();
		// AUP4 is an interchange export, not the backing store for the local
		// project. Every export gets an independent native database identity.
		const nativeId = createStableId('aup4-export').replace(/[^a-z0-9_-]/gi, '-');
		let nativeCreated = false;
		const referencedSources = project.sources.filter((candidate) => (
			candidate.kind !== 'video'
			&& project.clips.some((clip) => clip.kind !== 'video' && clip.sourceId === candidate.id)
		));
		const sourceBytes = referencedSources.reduce((sum, source) => sum + sourcePcmBytes(source), 0);
		const workingBytes = referencedSources.reduce((maximum, source) => (
			Math.max(maximum, sourcePcmBytes(source))
		), 0);
		await preflightStorage(sourceBytes, 'export');
		const storage = await store.estimateStorage();
		const portableOptions = {
			mobile: state.mobile,
			opfs: aup4Environment?.opfs,
			quota: storage.quota,
			usage: storage.usage,
			workingBytes,
		};
		state.saveState = 'saving';
		publishDocumentSnapshot();
		try {
			await client.create(nativeId);
			nativeCreated = true;
			const written = await client.writeSnapshot(nativeId, project, readAup4SourceAudio(referencedSources), {
				...portableOptions,
				onProgress: (progress) => updateNativeProjectProgress(progress, copy.aup4Saving),
			});
			await client.commit(nativeId);
			const result = await client.export(nativeId, {
				...portableOptions,
				onProgress: (progress) => updateNativeProjectProgress(progress, copy.aup4Saving),
			});
			const saved = await saveAup4Result(result, {
				fileName: options.fileName || project.title,
				fileHandle,
				fileService,
				saveTarget,
			});
			const validation = result?.validation || await client.inspect(nativeId);
			const compatibilityReport = rememberAup4CompatibilityReport(
				written?.compatibilityReport
					|| result?.compatibilityReport
					|| validation?.compatibilityReport,
				'save',
			);
			state.saveState = 'saved';
			setStatus(copy.aup4Saved, 'success');
			publishDocumentSnapshot();
			return { ...saved, validation, compatibilityReport };
		} catch (error) {
			state.saveState = 'dirty';
			publishDocumentSnapshot();
			throw error;
		} finally {
			if (nativeCreated) {
				await Promise.resolve(
					typeof client.delete === 'function' ? client.delete(nativeId) : client.close?.(nativeId),
				).catch(() => undefined);
			}
		}

		async function* readAup4SourceAudio(sources) {
			for (const source of sources) {
				const buffer = sourceBuffers.get(source.id);
				const channels = buffer
					? Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))
					: await loadStoredSourceChannels(store, source);
				if (!channels?.length) {
					throw new Error(copy.sourcePcmUnavailable.replace('{source}', source.name || source.id));
				}
				yield { sourceId: source.id, sampleRate: source.sampleRate, channels };
			}
		}
	}

	function updateNativeProjectProgress(progress, prefix) {
		const percentage = Math.round(Math.max(0, Math.min(1, Number(progress?.value) || 0)) * 100);
		setStatus(`${prefix} ${percentage}%`);
	}

	function rememberAup4CompatibilityReport(report, direction) {
		const normalized = normalizeAup4CompatibilityReport(report, direction);
		if (project && sessionTab(project.id)) {
			sessionController.updateProjectMetadata(project.id, {
				aup4CompatibilityReport: normalized,
				aup4CompatibilityReportDismissed: false,
			});
			publishDocumentSnapshot();
		}
		return normalized;
	}

	function dismissAup4CompatibilitySummary() {
		if (!project || !sessionTab(project.id)) return false;
		const metadata = sessionTab(project.id).metadata || {};
		if (!metadata.aup4CompatibilityReport || metadata.aup4CompatibilityReportDismissed) return false;
		sessionController.updateProjectMetadata(project.id, {
			aup4CompatibilityReportDismissed: true,
		});
		publishDocumentSnapshot();
		return true;
	}

	function cacheSourceBuffer(sourceId, buffer) {
		if (!buffer || sourceAudioBufferBytes(buffer) > SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES) {
			sourceBuffers.delete(sourceId);
			return false;
		}
		if (sourceBuffers.setIfFits(sourceId, buffer)) return true;
		sourceBuffers.delete(sourceId);
		return false;
	}

	async function loadProjectSources(project) {
		const usedSourceIds = new Set(allProjectClips(project).map((clip) => clip.sourceId));
		if (!usedSourceIds.size) return;
		const context = await engine.getAudioContext?.({ resume: false });
		for (const source of project.sources.filter((candidate) => usedSourceIds.has(candidate.id))) {
			try {
				if (source.kind === 'video') {
					await activateVideoSource(source);
					continue;
				}
				const metadata = await store.getSourceMetadata(source.storageKey || source.id);
				const chunkProvider = registerStoredChunkProvider(source, metadata);
				const useChunkStream = Boolean(chunkProvider)
					&& sourcePcmBytes(source) > SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES;
				let peaks = await store.loadAnalysis(peakCacheKey(source.id));
				if (useChunkStream) {
					sourceBuffers.delete(source.id);
					if (!waveformPeaksHaveRms(peaks)) {
						peaks = await generateStoredWaveformPeaks(store, source, copy);
						await store.saveAnalysis(peakCacheKey(source.id), peaks);
					}
				} else {
					const buffer = sourceBuffers.get(source.id) || await readStoredAudioBuffer(store, source, context);
					if (!buffer) continue;
					cacheSourceBuffer(source.id, buffer);
					if (!waveformPeaksHaveRms(peaks)) {
						peaks = await generateWaveformPeaks(audioBufferChannels(buffer), copy);
						await store.saveAnalysis(peakCacheKey(source.id), peaks);
					}
				}
				if (peaks?.levels) sourcePeaks.set(source.id, peaks);
			} catch (error) {
				state.missingSourceIds.add(source.id);
				setStatus(`${source.name}: ${error.message}`, 'error');
			}
		}
	}

	function registerStoredChunkProvider(source, metadata) {
		if (typeof store.readSourceChunk !== 'function' || !isStreamableStoredSource(source, metadata)) return null;
		const provider = createStoredChunkProvider(store, source, metadata);
		sourceChunkProviders.set(source.id, provider);
		return provider;
	}

	async function activateStoredSource(source, metadata, { buffer = null } = {}) {
		const provider = registerStoredChunkProvider(source, metadata);
		let peakBuffer = buffer;
		if (provider && sourcePcmBytes(source) > SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES) {
			sourceBuffers.delete(source.id);
		} else {
			peakBuffer ||= await readStoredAudioBuffer(store, source, await engine.getAudioContext?.({ resume: false }));
			if (peakBuffer) cacheSourceBuffer(source.id, peakBuffer);
		}
		const peaks = peakBuffer
			? await generateWaveformPeaks(audioBufferChannels(peakBuffer), copy)
			: await generateStoredWaveformPeaks(store, source, copy);
		sourcePeaks.set(source.id, peaks);
		await store.saveAnalysis(peakCacheKey(source.id), peaks);
		return peaks;
	}

	async function ensureProjectSourcesAvailable(snapshot) {
		const usedSourceIds = new Set((snapshot?.clips || [])
			.filter((clip) => clip.kind !== 'video')
			.map((clip) => clip.sourceId));
		const transientBuffers = new Map();
		let context = null;
		for (const source of (snapshot?.sources || []).filter((candidate) => (
			candidate.kind !== 'video' && usedSourceIds.has(candidate.id)
		))) {
			if (!sourceChunkProviders.has(source.id)) {
				const metadata = await store.getSourceMetadata(source.storageKey || source.id);
				if (!metadata) continue;
				registerStoredChunkProvider(source, metadata);
			}
			if (sourceChunkProviders.has(source.id) || sourceBuffers.has(source.id)) continue;
			context ||= await engine.getAudioContext?.({ resume: false });
			const buffer = await readStoredAudioBuffer(store, source, context);
			if (!buffer) continue;
			if (!cacheSourceBuffer(source.id, buffer)) transientBuffers.set(source.id, buffer);
		}
		return transientBuffers;
	}

	async function listProjects() {
		await saveNow();
		state.projects = Object.freeze(await store.listProjects());
		publishDocumentSnapshot();
		return state.projects;
	}

	async function prepareProjectHandoff() {
		if (!project) throw new Error(copy.projectNotFound);
		if (state.readOnly) throw new Error(copy.projectReadOnly);
		await flushProject();
		const projectId = project.id;
		await releaseProjectLock();
		return Object.freeze({ projectId, revision: project.revision });
	}

	async function clearRecentProjects() {
		state.recentProjectIds = [];
		await store.saveSetting(recentProjectsSettingKey, state.recentProjectIds);
		if (productId === 'soundscaper') await store.saveSetting('audio-editor-recent-project-ids', state.recentProjectIds);
		publishDocumentSnapshot();
		return state.recentProjectIds;
	}

	async function closeProjectTab(projectId = project?.id, closeOptions = {}) {
		const tab = sessionTab(projectId);
		if (!tab) throw new Error(copy.projectNotFound);
		const active = project?.id === projectId;
		if (tab.dirty && closeOptions.discard !== true) {
			if (active) {
				if (!state.readOnly) await saveNow();
			} else if (!tab.readOnly) {
				await store.saveProject(tab.history.present);
				sessionController.markProjectSaved(projectId);
			}
		}
		const result = sessionController.closeProject(projectId, { force: true });
		if (!result.closed) return result;
		if (!active) {
			clipTimePitchCache.retainClipIds?.(liveSessionClipIds());
			evictUnreferencedSourceCaches(sourceBuffers, sourcePeaks, liveSessionSourceIds());
			publishDocumentSnapshot();
			await garbageCollectSources();
			return result;
		}

		globalThis.clearTimeout(state.autosaveTimer);
		state.autosaveTimer = 0;
		await releaseProjectLock();
		engine.stop();
		state.history = null;
		project = null;
		state.selectedTrackId = null;
		state.selectedClipId = null;
		state.missingSourceIds.clear();
		const nextTab = result.activeProjectId ? sessionTab(result.activeProjectId) : null;
		if (nextTab) await switchProject(nextTab.history.present, { skipFlush: true });
		else await newProject({ skipFlush: true });
		state.projects = Object.freeze(await store.listProjects());
		clipTimePitchCache.retainClipIds?.(liveSessionClipIds());
		evictUnreferencedSourceCaches(sourceBuffers, sourcePeaks, liveSessionSourceIds());
		publishDocumentSnapshot();
		await garbageCollectSources();
		return result;
	}

	async function renameProject(requestedTitle) {
		if (state.readOnly) return;
		if (requestedTitle == null) throw new TypeError(copy.projectTitleRequired);
		const title = String(requestedTitle).trim();
		if (title) commit({ type: 'project/rename', title });
	}

	async function duplicateProject(requestedTitle) {
		if (!project) return;
		await saveNow();
		const title = String(requestedTitle || `${project.title} ${copy.projectCopySuffix}`).trim();
		const duplicated = await store.duplicateProject(project.id, { title });
		await store.saveSetting(recordingRoutingSettingKey(duplicated.id), state.recordingRouting);
		await openProject(duplicated);
		return duplicated;
	}

	async function deleteProject() {
		if (!project || state.readOnly) return;
		await stopRecording();
		const id = project.id;
		await releaseProjectLock();
		await store.deleteProject(id);
		await store.saveSetting(recordingRoutingSettingKey(id), null);
		sessionController.closeProject(id, { force: true });
		state.history = null;
		project = null;
		state.missingSourceIds.clear();
		evictUnreferencedSourceCaches(sourceBuffers, sourcePeaks, liveSessionSourceIds());
		await garbageCollectSources();
		await newProject({ skipFlush: true });
		await listProjects();
	}

	async function garbageCollectSources() {
		if (!store.pruneUnreferencedSources) return;
		globalThis.clearTimeout(state.sourceGcTimer);
		state.sourceGcTimer = 0;
		const protectedSourceIds = liveSessionSourceIds();
		for (const sourceId of sourceBuffers.keys()) protectedSourceIds.add(sourceId);
		for (const sourceId of sourcePeaks.keys()) protectedSourceIds.add(sourceId);
		const result = await store.pruneUnreferencedSources({
			protectedProjects: [
				...sessionHistoryProjects(),
				...state.pendingSaveSnapshots,
			],
			protectedSourceIds,
		});
		for (const sourceId of result.deletedSourceIds || []) {
			sourceBuffers.delete(sourceId);
			sourceChunkProviders.delete(sourceId);
			sourcePeaks.delete(sourceId);
			state.missingSourceIds.delete(sourceId);
		}
		if (result.nextEligibleAt != null && !state.disposed) {
			const delay = Math.max(1_000, Math.min(2_147_000_000, result.nextEligibleAt - Date.now() + 50));
			state.sourceGcTimer = globalThis.setTimeout(() => {
				state.sourceGcTimer = 0;
				void garbageCollectSources().catch(handleError);
			}, delay);
		}
	}

	function sessionHistoryProjects() {
		return sessionController.getSnapshot().tabs
			.flatMap((tab) => editorHistoryProjects(tab.history));
	}

	async function clearLocalData() {
		await stopRecording();
		cancelPlaybackCachePreparation();
		await releaseProjectLock();
		engine.stop();
		clipTimePitchCache.clear?.();
		sourceBuffers.clear();
		sourceChunkProviders.clear();
		sourcePeaks.clear();
		revokeVideoVisuals();
		await store.clear();
		sessionController.clearClipboard();
		for (const tab of [...sessionController.getSnapshot().tabs]) {
			sessionController.closeProject(tab.projectId, { force: true });
		}
		state.history = null;
		project = null;
		await newProject({ skipFlush: true });
		state.projects = Object.freeze([]);
		publishDocumentSnapshot();
	}

	function moveClipsToProjectBin(clipId = state.selectedClipId) {
		if (editingBlocked()) return null;
		const requestedIds = Array.isArray(clipId) ? clipId : [clipId];
		const participatingIds = new Set();
		for (const requestedId of requestedIds) {
			for (const participatingId of collectClipTransformIds(project, requestedId)) {
				participatingIds.add(participatingId);
			}
		}
		const clipIds = project.clips
			.filter((clip) => participatingIds.has(clip.id))
			.map((clip) => clip.id);
		if (!clipIds.length) throw new Error(copy.audioClipNotFound);
		commit({
			type: 'project-bin/move-from-timeline',
			clipIds,
		}, { selectClipId: null });
		return Object.freeze(clipIds);
	}

	function placeProjectBinClip(binClipId, placement = {}) {
		if (editingBlocked()) return null;
		const binClip = findProjectBinClip(project, binClipId);
		if (!binClip) throw new Error(copy.audioClipNotFound);
		const itemClips = project.schemaVersion >= 4
			? projectBinClips(project).filter((clip) => clip.binItemId === binClip.binItemId)
			: [binClip];
		for (const itemClip of itemClips) {
			const source = findSource(project, itemClip.sourceId);
			if (!source || state.missingSourceIds.has(source.id)) throw new Error(copy.localSourcesMissing);
		}
		const videoClip = itemClips.find((clip) => clip.kind === 'video') || null;
		const audioClip = itemClips.find((clip) => clip.kind !== 'video') || null;
		const requestedTrack = findTrack(project, placement.trackId ?? state.selectedTrackId);
		const commands = [];
		let videoTrack = requestedTrack?.type === 'video' ? requestedTrack : null;
		let audioTrack = requestedTrack?.type === 'audio' ? requestedTrack : null;
		if (requestedTrack?.laneGroupId) {
			videoTrack ||= project.tracks.find((track) => (
				track.type === 'video' && track.laneGroupId === requestedTrack.laneGroupId
			)) || null;
			audioTrack ||= project.tracks.find((track) => (
				track.type === 'audio' && track.laneGroupId === requestedTrack.laneGroupId
			)) || null;
		}
		if (
			videoClip
			&& audioClip
			&& (
				!videoTrack?.laneGroupId
				|| videoTrack.laneGroupId !== audioTrack?.laneGroupId
			)
		) {
			videoTrack = null;
			audioTrack = null;
		}
		if (videoClip && !videoTrack) {
			const laneGroupId = createStableId('media-lane');
			const videoTrackId = createStableId('video-track');
			const audioTrackId = createStableId('track');
			const insertion = project.tracks.length;
			commands.push({
				...createAddTrackCommand({
					schemaVersion: 4,
					type: 'video',
					id: videoTrackId,
					name: binClip.title || 'Video',
					laneGroupId,
				}),
				index: insertion,
			}, {
				...createAddTrackCommand({
					schemaVersion: 4,
					type: 'audio',
					id: audioTrackId,
					name: `${binClip.title || copy.track} Audio`,
					laneGroupId,
					armed: false,
				}),
				index: insertion + 1,
			});
			videoTrack = { id: videoTrackId, type: 'video', laneGroupId };
			audioTrack = { id: audioTrackId, type: 'audio', laneGroupId };
		} else if (audioClip && !audioTrack) {
			const audioTrackId = createStableId('track');
			commands.push(createAddTrackCommand({
				schemaVersion: project.schemaVersion,
				type: 'audio',
				id: audioTrackId,
				name: binClip.title || `${copy.track} ${project.tracks.length + 1}`,
			}));
			audioTrack = { id: audioTrackId, type: 'audio', laneGroupId: null };
		}
		const timelineStartFrame = normalizeImportTimelineStartFrame(
			placement.timelineStartFrame ?? engine.getPositionFrames(),
		);
		const placements = itemClips.map((itemClip) => ({
			binClipId: itemClip.id,
			trackId: itemClip.kind === 'video' ? videoTrack?.id : audioTrack?.id,
			clipId: createStableId('clip'),
			...(itemClip.kind === 'video' && itemClip.videoEffects?.length ? {
				videoEffectIds: itemClip.videoEffects.map(() => createStableId('video-effect')),
			} : {}),
		}));
		const selectedPlacement = placements.find((candidate) => candidate.binClipId === videoClip?.id)
			|| placements[0];
		commands.push({
			type: 'project-bin/place',
			binClipId: binClip.id,
			timelineStartFrame,
			placements,
			...(itemClips.length === 2 ? { avLinkId: createStableId('av-link') } : {}),
		});
		commit(commands.length === 1 ? commands[0] : { type: 'batch', commands }, {
			selectTrackId: videoClip ? videoTrack.id : audioTrack.id,
			selectClipId: selectedPlacement.clipId,
		});
		return selectedPlacement.clipId;
	}

	function renameProjectBinClip(clipId, requestedName) {
		if (editingBlocked()) return null;
		if (!findProjectBinClip(project, clipId)) throw new Error(copy.audioClipNotFound);
		const title = String(requestedName ?? '').trim();
		if (!title) throw new TypeError('A project-bin clip name is required.');
		commit({ type: 'project-bin/update', clipId, changes: { title } });
		return title;
	}

	function removeProjectBinClip(clipId) {
		if (editingBlocked()) return null;
		if (!findProjectBinClip(project, clipId)) throw new Error(copy.audioClipNotFound);
		commit({ type: 'project-bin/remove', clipId });
		return clipId;
	}

	function setProjectBinClipColor(clipId, color) {
		if (editingBlocked()) return null;
		if (!findProjectBinClip(project, clipId)) throw new Error(copy.audioClipNotFound);
		if (!AUDIO_EDITOR_TRACK_COLORS.includes(color)) throw new RangeError('Unsupported Project Bin color.');
		commit({ type: 'project-bin/update', clipId, changes: { color } });
		return color;
	}

	function projectBinSourceIds(clipId, snapshot = project) {
		const clip = findProjectBinClip(snapshot, clipId);
		if (!clip) throw new Error(copy.audioClipNotFound);
		const itemClips = snapshot.schemaVersion >= 4
			? projectBinClips(snapshot).filter((candidate) => candidate.binItemId === clip.binItemId)
			: [clip];
		return new Set(itemClips.map((candidate) => candidate.sourceId));
	}

	function projectBinInstanceIds(clipId, snapshot = project) {
		const sourceIds = projectBinSourceIds(clipId, snapshot);
		return snapshot.clips
			.filter((clip) => sourceIds.has(clip.sourceId))
			.map((clip) => clip.id);
	}

	function projectBinInstanceCount(clipId) {
		return projectBinInstanceIds(clipId).length;
	}

	function selectProjectBinInstances(clipId) {
		const clipIds = collectRelatedClipIds(project, projectBinInstanceIds(clipId));
		if (!clipIds.length) return Object.freeze([]);
		const trackIds = [...new Set(clipIds
			.map((id) => findClipTrack(project, id)?.id)
			.filter(Boolean))];
		state.selectedClipId = clipIds[0] || null;
		state.selectedTrackId = trackIds[0] || null;
		updateSelection({
			type: 'selection/set',
			startFrame: 0,
			endFrame: 0,
			trackIds,
			clipIds,
			frequencyRange: null,
		});
		return Object.freeze(clipIds);
	}

	function removeProjectBinSource(clipId) {
		if (editingBlocked()) return null;
		const instanceIds = projectBinInstanceIds(clipId);
		commit({ type: 'project-bin/remove-from-project', clipId }, {
			selectClipId: null,
		});
		return Object.freeze(instanceIds);
	}

	async function prepareProjectBinReplacement(clipId, file) {
		if (!file || editingBlocked()) return null;
		const target = findProjectBinClip(project, clipId);
		if (!target) throw new Error(copy.audioClipNotFound);
		const baseHistory = state.history;
		const baseProject = project;
		state.importing = true;
		publishDocumentSnapshot();
		let result;
		let importedProject;
		try {
			result = await importFile(file, normalizeImportOptions({ destination: 'project-bin' }));
			importedProject = project;
		} finally {
			state.history = baseHistory;
			project = baseProject;
			state.importing = false;
			projectChanged();
			publishDocumentSnapshot();
		}
		if (!result || !importedProject) return null;
		const importedClip = findProjectBinClip(importedProject, result.clipId);
		const importedItemClips = importedClip && importedProject.schemaVersion >= 4
			? importedProject.projectBin.clips.filter((clip) => clip.binItemId === importedClip.binItemId)
			: importedClip ? [importedClip] : [];
		const targetItemClips = baseProject.schemaVersion >= 4
			? baseProject.projectBin.clips.filter((clip) => clip.binItemId === target.binItemId)
			: [target];
		const importedKinds = importedItemClips.map((clip) => clip.kind || 'audio').sort();
		const targetKinds = targetItemClips.map((clip) => clip.kind || 'audio').sort();
		const importedSources = importedItemClips.map((clip) => findSource(importedProject, clip.sourceId)).filter(Boolean);
		if (JSON.stringify(importedKinds) !== JSON.stringify(targetKinds) || importedSources.length !== targetItemClips.length) {
			await discardImportedReplacement(importedSources);
			throw new Error(copy.projectBinReplacementIncompatible || 'The replacement file is not compatible with this Project Bin item.');
		}
		const importedByKind = new Map(importedItemClips.map((clip) => [clip.kind || 'audio', clip]));
		const replacements = targetItemClips.map((clip) => ({
			oldSourceId: clip.sourceId,
			newSourceId: importedByKind.get(clip.kind || 'audio').sourceId,
		}));
		const newSourceByOldId = new Map(replacements.map((entry) => [
			entry.oldSourceId,
			findSource(importedProject, entry.newSourceId),
		]));
		const sourceIds = new Set(replacements.map((entry) => entry.oldSourceId));
		const affectedClips = [...baseProject.clips, ...baseProject.projectBin.clips]
			.filter((clip) => sourceIds.has(clip.sourceId));
		const shortenedClipIds = affectedClips.filter((clip) => {
			const oldSource = findSource(baseProject, clip.sourceId);
			const newSource = newSourceByOldId.get(clip.sourceId);
			if (!oldSource || !newSource) return true;
			const newRate = Math.max(1, newSource.sampleRate || baseProject.sampleRate);
			const oldRate = Math.max(1, oldSource.sampleRate || baseProject.sampleRate);
			const start = Math.round(clip.sourceStartFrame / oldRate * newRate);
			const duration = Math.round(clip.sourceDurationFrames / oldRate * newRate);
			return start + duration > newSource.frameCount;
		}).map((clip) => clip.id);
		const token = createStableId('project-bin-replacement');
		projectBinReplacementStages.set(token, Object.freeze({
			token,
			projectId: baseProject.id,
			baseProject,
			clipId,
			replacements: Object.freeze(replacements),
			sources: Object.freeze(importedSources),
			templates: Object.freeze(importedItemClips),
			shortenedClipIds: Object.freeze(shortenedClipIds),
		}));
		return Object.freeze({
			token,
			requiresChoice: shortenedClipIds.some((id) => baseProject.clips.some((clip) => clip.id === id)),
			shortenedClipIds: Object.freeze(shortenedClipIds),
		});
	}

	function applyProjectBinReplacement(token, shortfallMode = 'keep-spacing') {
		if (editingBlocked()) return null;
		const stage = projectBinReplacementStages.get(token);
		if (!stage) throw new Error('The staged Project Bin replacement is no longer available.');
		if (project !== stage.baseProject || project.id !== stage.projectId) {
			void cancelProjectBinReplacement(token);
			throw new Error('The project changed before the replacement could be applied.');
		}
		const commands = [
			...stage.sources.map((source) => createAddSourceCommand(source)),
			{
				type: 'project-bin/replace-media',
				clipId: stage.clipId,
				replacements: stage.replacements,
				templates: stage.templates,
				shortfallMode,
			},
		];
		commit({ type: 'batch', commands });
		projectBinReplacementStages.delete(token);
		return stage.clipId;
	}

	async function cancelProjectBinReplacement(token) {
		const stage = projectBinReplacementStages.get(token);
		if (!stage) return false;
		projectBinReplacementStages.delete(token);
		await discardImportedReplacement(stage.sources);
		return true;
	}

	async function discardImportedReplacement(sources) {
		for (const source of sources || []) {
			sourceBuffers.delete(source.id);
			sourceChunkProviders.delete(source.id);
			sourcePeaks.delete(source.id);
			state.missingSourceIds.delete(source.id);
			if (source.kind === 'video') {
				revokeVideoVisual(source.id);
				await store.deleteMediaAsset?.(source.id).catch(() => undefined);
			} else {
				await store.deleteSource(source.id).catch(() => undefined);
			}
		}
	}

	async function playPauseProjectBinClip(clipId) {
		const clip = findProjectBinClip(project, clipId);
		if (!clip) throw new Error(copy.audioClipNotFound);
		const itemClips = project.schemaVersion >= 4
			? projectBinClips(project).filter((candidate) => candidate.binItemId === clip.binItemId)
			: [clip];
		const videoClip = itemClips.find((candidate) => candidate.kind === 'video') || null;
		const active = state.projectBinPreview;
		if (active?.clipId === clipId) {
			if (active.state === 'playing') {
				if (projectBinPreviewEngine) projectBinPreviewEngine.pause();
				state.projectBinPreview = { ...active, state: 'paused' };
				publishDocumentSnapshot();
				return state.projectBinPreview;
			}
			if (videoClip) {
				state.projectBinPreview = { ...active, state: 'playing' };
				publishDocumentSnapshot();
				return state.projectBinPreview;
			}
			await projectBinPreviewEngine?.play();
			state.projectBinPreview = { ...active, state: 'playing' };
			publishDocumentSnapshot();
			return state.projectBinPreview;
		}
		await stopProjectBinPreview();
		if (engine.getState().state === 'playing') engine.stop();
		if (videoClip) {
			const visual = getProjectBinClipVisualData(clipId);
			state.projectBinPreview = {
				clipId,
				binItemId: clip.binItemId || clip.id,
				state: 'playing',
				kind: 'video',
				mediaUrl: visual?.mediaUrl || null,
			};
			publishDocumentSnapshot();
			return state.projectBinPreview;
		}
		const audioClip = itemClips.find((candidate) => candidate.kind !== 'video') || clip;
		const source = findSource(project, audioClip.sourceId);
		if (!source || state.missingSourceIds.has(source.id)) throw new Error(copy.localSourcesMissing);
		projectBinPreviewEngine ||= renderEngineFactory({
			onState: (previewState) => {
				if (!state.projectBinPreview || previewState === 'playing') return;
				state.projectBinPreview = { ...state.projectBinPreview, state: previewState === 'paused' ? 'paused' : 'stopped' };
				publishDocumentSnapshot();
			},
		});
		projectBinPreviewEngine.setSourceResolver?.(clipTimePitchSourceResolver);
		const previewTrackId = createStableId('project-bin-preview-track');
		const previewClip = {
			...audioClip,
			id: createStableId('project-bin-preview-clip'),
			timelineStartFrame: 0,
			groupId: null,
			avLinkId: null,
			binItemId: null,
		};
		const previewProject = createAudioEditorProjectV5({
			title: 'Project Bin preview',
			sampleRate: project.sampleRate,
			sources: [source],
			clips: [previewClip],
			tracks: [{
				type: 'audio',
				id: previewTrackId,
				name: previewClip.title,
				clipIds: [previewClip.id],
				armed: false,
			}],
			projectBin: { clips: [] },
		});
		projectBinPreviewEngine.loadProject(previewProject, sourceBuffers, { chunkSources: sourceChunkProviders });
		state.projectBinPreview = {
			clipId,
			binItemId: clip.binItemId || clip.id,
			state: 'playing',
			kind: 'audio',
		};
		publishDocumentSnapshot();
		await projectBinPreviewEngine.play();
		return state.projectBinPreview;
	}

	async function stopProjectBinPreview({ dispose = false } = {}) {
		if (projectBinPreviewEngine) {
			projectBinPreviewEngine.stop?.();
			if (dispose) {
				await projectBinPreviewEngine.dispose?.();
				projectBinPreviewEngine = null;
			}
		}
		const changed = Boolean(state.projectBinPreview);
		state.projectBinPreview = null;
		if (changed && !state.disposed) publishDocumentSnapshot();
		return changed;
	}

	async function importFiles(fileList, requestedOptions = {}) {
		const files = [...(fileList || [])];
		if (!files.length || editingBlocked()) return;
		const importOptions = normalizeImportOptions(requestedOptions);
		state.importing = true;
		publishDocumentSnapshot();
		setStatus(copy.importing);
		let failures = 0;
		let successes = 0;
		const notices = [];
		let importQueue = files;
		const legacyProject = files.find(isLegacyAupFile);
		if (legacyProject) {
			try {
				const result = await importStructuredAudacityProject(
					legacyProject,
					files.filter((file) => file !== legacyProject && !isLegacyAupFile(file)),
				);
				if (result?.notice) notices.push(result.notice);
				successes += 1;
			} catch (error) {
				failures += 1;
				handleError(error);
			}
			// `.au` files selected with a legacy project are its immutable block
			// store, not independent media imports.
			importQueue = files.filter((file) => file !== legacyProject && !isLegacyAupFile(file) && !isLegacyBlockFile(file));
		}
		let audioFileIndex = 0;
		for (const file of importQueue) {
			try {
				const result = await importFile(file, importFilePlacement(importOptions, audioFileIndex));
				if (result?.notice) notices.push(result.notice);
				successes += 1;
			} catch (error) {
				failures += 1;
				handleError(error);
			}
			audioFileIndex += 1;
		}
		try {
			if (!failures) setStatus(notices.length ? notices.join(' ') : copy.done, 'success');
			else setStatus(copy.importSummary
				.replace('{successes}', String(successes))
				.replace('{failures}', String(failures)), 'error');
		} finally {
			state.importing = false;
			publishDocumentSnapshot();
		}
	}

	function normalizeImportOptions(value = {}) {
		const requestedDestination = value?.destination ?? 'auto';
		if (!['auto', 'timeline', 'project-bin'].includes(requestedDestination)) {
			throw new RangeError(`Unsupported audio import destination: ${requestedDestination}.`);
		}
		const destination = requestedDestination === 'auto'
			? value?.projectBinVisible ? 'project-bin' : 'timeline'
			: requestedDestination;
		return Object.freeze({
			destination,
			trackId: value?.trackId == null ? null : String(value.trackId),
			timelineStartFrame: normalizeImportTimelineStartFrame(value?.timelineStartFrame ?? 0),
		});
	}

	function normalizeImportTimelineStartFrame(value) {
		const frame = Number(value);
		if (!Number.isFinite(frame)) throw new TypeError(copy.timelineFramesFinite);
		const rounded = Math.max(0, Math.round(frame));
		if (!Number.isSafeInteger(rounded)) throw new RangeError(copy.timelineFramesFinite);
		return rounded;
	}

	function importFilePlacement(importOptions, fileIndex) {
		if (importOptions.destination !== 'timeline' || !importOptions.trackId) return importOptions;
		if (fileIndex === 0) return importOptions;
		const targetTrackIndex = project.tracks.findIndex((track) => track.id === importOptions.trackId);
		return Object.freeze({
			...importOptions,
			trackId: null,
			trackIndex: targetTrackIndex < 0 ? undefined : targetTrackIndex + fileIndex,
		});
	}

	function prepareImportedMediaCommand(source, clip, trackName, importOptions) {
		const commands = [createAddSourceCommand(source)];
		if (importOptions.destination === 'project-bin') {
			commands.push({ type: 'project-bin/add', clip });
			return {
				command: { type: 'batch', commands },
				selection: {},
				result: Object.freeze({
					destination: 'project-bin',
					sourceId: source.id,
					clipId: clip.id,
					trackId: null,
				}),
			};
		}

		let track = null;
		if (importOptions.trackId) {
			track = findTrack(project, importOptions.trackId);
			if (!track || track.type !== 'audio') throw new Error(copy.audioTrackNotFound);
		}
		const trackId = track?.id || createStableId('track');
		if (!track) {
			commands.push({
				...createAddTrackCommand({
					schemaVersion: 2,
					type: 'audio',
					id: trackId,
					name: trackName,
				}),
				...(Number.isSafeInteger(importOptions.trackIndex) ? { index: importOptions.trackIndex } : {}),
			});
		}
		commands.push(createAddClipCommand(trackId, {
			...clip,
			timelineStartFrame: importOptions.timelineStartFrame,
		}));
		return {
			command: { type: 'batch', commands },
			selection: { selectTrackId: trackId, selectClipId: clip.id },
			result: Object.freeze({
				destination: 'timeline',
				sourceId: source.id,
				clipId: clip.id,
				trackId,
			}),
		};
	}

	function validateImportTimelineTrack(importOptions) {
		if (importOptions.destination !== 'timeline' || !importOptions.trackId) return null;
		const track = findTrack(project, importOptions.trackId);
		if (!track || track.type !== 'audio') throw new Error(copy.audioTrackNotFound);
		return track;
	}

	async function importFile(file, importOptions = normalizeImportOptions()) {
		if (isAup3File(file)) {
			await preflightStorage(Math.max(file.size * 8, 8 * 1024 * 1024), 'import');
			return importStructuredAudacityProject(file);
		}
		if (isAudioEditorVideoFile(file)) return importVideoFile(file, importOptions);
		validateImportTimelineTrack(importOptions);
		const incrementalWav = await inspectIncrementalWav(file);
		if (incrementalWav) return importIncrementalWav(file, incrementalWav, importOptions);
		await preflightStorage(Math.max(file.size * 8, 8 * 1024 * 1024), 'import');
		const context = await engine.getAudioContext({ resume: false });
		let decoded;
		let originalSampleRate = null;
		try {
			const encoded = await file.arrayBuffer();
			originalSampleRate = inspectEncodedAudioSampleRate(encoded);
			decoded = await engine.decodeAudioData(encoded);
		} catch {
			const fallback = await ffmpeg.decode(file, { sampleRate: projectSampleRate() });
			decoded = await bufferFromChannels(fallback.channels, fallback.sampleRate, context, copy);
			originalSampleRate ??= fallback.sampleRate;
		}
		const canonical = await canonicalizeBuffer(decoded, context, null, copy);
		await preflightStorage(canonical.length * canonical.numberOfChannels * Float32Array.BYTES_PER_ELEMENT, 'import');
		const sourceId = createStableId('source');
		const clipId = createStableId('clip');
		const trackName = stripExtension(file.name) || `${copy.track} ${project.tracks.length + 1}`;
		const sourceName = file.name;
		const mimeType = file.type || 'audio/wav';
		const writer = await store.beginSourceWrite(sourceId, {
			name: sourceName,
			mimeType,
			sampleRate: canonical.sampleRate,
			channelCount: canonical.numberOfChannels,
			chunkFrames: SOURCE_CHUNK_FRAMES,
		});
		try {
			await writeBuffer(writer, canonical);
			await writer.commit({ sampleRate: canonical.sampleRate, channelCount: canonical.numberOfChannels });
		} catch (error) {
			await writer.abort();
			throw error;
		}

		const prepared = prepareImportedMediaCommand({
			schemaVersion: 2,
			sampleFormat: 'float32',
			chunkFrames: SOURCE_CHUNK_FRAMES,
			id: sourceId,
			storageKey: sourceId,
			name: sourceName,
			mimeType,
			frameCount: canonical.length,
			channelCount: canonical.numberOfChannels,
			sampleRate: canonical.sampleRate,
			originalSampleRate: originalSampleRate || decoded.sampleRate,
		}, {
			schemaVersion: 2,
			title: trackName,
			sourceDurationFrames: canonical.length,
			id: clipId,
			sourceId,
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			durationFrames: Math.max(1, Math.round(canonical.length * projectSampleRate() / canonical.sampleRate)),
		}, trackName, importOptions);
		cacheSourceBuffer(sourceId, canonical);
		try {
			const peaks = await generateWaveformPeaks(audioBufferChannels(canonical), copy);
			sourcePeaks.set(sourceId, peaks);
			await store.saveAnalysis(peakCacheKey(sourceId), peaks);
			commit(prepared.command, prepared.selection);
		} catch (error) {
			sourceBuffers.delete(sourceId);
			sourcePeaks.delete(sourceId);
			await store.deleteSource(sourceId);
			throw error;
		}
		warnEnvelope();
		return prepared.result;
	}

	async function importVideoFile(file, importOptions = normalizeImportOptions()) {
		await preflightStorage(Math.max(file.size * 2, 16 * 1024 * 1024), 'import');
		const extractor = await createAudioEditorVideoFrameExtractor(file);
		const sampleRate = projectSampleRate();
		const durationFrames = Math.max(1, Math.round(extractor.metadata.durationSeconds * sampleRate));
		const videoSourceId = createStableId('video-source');
		const videoClipId = createStableId('video-clip');
		const binItemId = createStableId('bin-item');
		const trackName = stripExtension(file.name) || `Video ${project.tracks.filter((track) => track.type === 'video').length + 1}`;
		const sourceName = file.name || `${trackName}.mp4`;
		let audioSourceId = null;
		let audioClipId = null;
		let canonicalAudio = null;
		let originalAudioSampleRate = sampleRate;
		let mediaPersisted = false;
		let audioPersisted = false;
		try {
			await store.writeMediaAsset(videoSourceId, file, {
				name: sourceName,
				mimeType: file.type || 'video/mp4',
				width: extractor.metadata.width,
				height: extractor.metadata.height,
				durationSeconds: extractor.metadata.durationSeconds,
			});
			mediaPersisted = true;
			const thumbnailTimes = audioEditorVideoThumbnailTimes(extractor.metadata.durationSeconds);
			try {
				const poster = await extractor.capture(0, { maximumWidth: 640, maximumHeight: 360 });
				await store.saveVideoDerivative(videoSourceId, {
					timestamp: 0,
					type: 'poster',
					blob: poster.blob,
					metadata: {
						width: poster.width,
						height: poster.height,
						mimeType: poster.mimeType,
					},
				});
			} catch {
				// A preview derivative is disposable; the original media remains importable.
			}
			for (const timestamp of thumbnailTimes) {
				try {
					const thumbnail = await extractor.capture(timestamp);
					await store.saveVideoDerivative(videoSourceId, {
						timestamp: thumbnail.timestampSeconds,
						type: 'thumbnail',
						blob: thumbnail.blob,
						metadata: {
							width: thumbnail.width,
							height: thumbnail.height,
							mimeType: thumbnail.mimeType,
						},
					});
				} catch {
					// Keep the rest of the filmstrip when one seek/capture fails.
				}
			}

			const context = await engine.getAudioContext({ resume: false });
			try {
				let decodedAudio;
				let declaredAudioSampleRate = null;
				try {
					// The browser has already decoded this container for thumbnails,
					// and native Web Audio handles AAC tracks that may be unavailable
					// to a particular FFmpeg core build.
					const encoded = await file.arrayBuffer();
					declaredAudioSampleRate = inspectEncodedAudioSampleRate(encoded);
					decodedAudio = await engine.decodeAudioData(encoded);
				} catch {
					decodedAudio = await ffmpeg.decode(file, { sampleRate });
				}
				const decodedChannels = decodedAudio?.channels?.length
					? decodedAudio.channels
					: decodedAudio?.numberOfChannels
						? audioBufferChannels(decodedAudio)
						: null;
				if (decodedChannels?.length) {
					originalAudioSampleRate = declaredAudioSampleRate || decodedAudio.sampleRate || sampleRate;
					const decodedBuffer = await bufferFromChannels(
						decodedChannels,
						decodedAudio.sampleRate,
						context,
						copy,
					);
					const resampled = await canonicalizeBuffer(decodedBuffer, context, sampleRate, copy);
					canonicalAudio = fitAudioBufferToFrames(resampled, durationFrames, context);
				}
			} catch {
				canonicalAudio = null;
			}

			if (canonicalAudio) {
				await preflightStorage(
					canonicalAudio.length * canonicalAudio.numberOfChannels * Float32Array.BYTES_PER_ELEMENT,
					'import',
				);
				audioSourceId = createStableId('source');
				audioClipId = createStableId('clip');
				const writer = await store.beginSourceWrite(audioSourceId, {
					name: `${trackName} Audio`,
					mimeType: 'audio/x-soundscaper-extracted',
					sampleRate: canonicalAudio.sampleRate,
					channelCount: canonicalAudio.numberOfChannels,
					chunkFrames: SOURCE_CHUNK_FRAMES,
				});
				try {
					await writeBuffer(writer, canonicalAudio);
					await writer.commit({
						sampleRate: canonicalAudio.sampleRate,
						channelCount: canonicalAudio.numberOfChannels,
					});
					audioPersisted = true;
				} catch (error) {
					await writer.abort().catch(() => undefined);
					throw error;
				}
				cacheSourceBuffer(audioSourceId, canonicalAudio);
				const peaks = await generateWaveformPeaks(audioBufferChannels(canonicalAudio), copy);
				sourcePeaks.set(audioSourceId, peaks);
				await store.saveAnalysis(peakCacheKey(audioSourceId), peaks);
			}

			const videoSource = {
				kind: 'video',
				id: videoSourceId,
				storageKey: videoSourceId,
				name: sourceName,
				mimeType: file.type || 'video/mp4',
				frameCount: durationFrames,
				sampleRate,
				width: extractor.metadata.width,
				height: extractor.metadata.height,
				frameRate: 30,
				videoCodec: 'unknown',
				audioCodec: canonicalAudio ? 'unknown' : null,
				hasAudio: Boolean(canonicalAudio),
				posterStorageKey: `${videoSourceId}:poster`,
				thumbnailStorageKey: `${videoSourceId}:thumbnail`,
				opaqueExtensions: {},
			};
			const audioSource = canonicalAudio ? {
				kind: 'audio',
				schemaVersion: 4,
				sampleFormat: 'float32',
				chunkFrames: SOURCE_CHUNK_FRAMES,
				id: audioSourceId,
				storageKey: audioSourceId,
				name: `${trackName} Audio`,
				mimeType: 'audio/x-soundscaper-extracted',
				frameCount: canonicalAudio.length,
				channelCount: canonicalAudio.numberOfChannels,
				sampleRate: canonicalAudio.sampleRate,
				originalSampleRate: originalAudioSampleRate,
				opaqueExtensions: { originVideoSourceId: videoSourceId },
			} : null;
			const videoClip = {
				kind: 'video',
				id: videoClipId,
				sourceId: videoSourceId,
				title: trackName,
				timelineStartFrame: importOptions.timelineStartFrame,
				sourceStartFrame: 0,
				sourceDurationFrames: durationFrames,
				durationFrames,
				trimStartFrames: 0,
				trimEndFrames: 0,
				groupId: null,
				color: 'auto',
				speedRatio: 1,
				avLinkId: null,
				binItemId: importOptions.destination === 'project-bin' ? binItemId : null,
				opaqueExtensions: {},
			};
			const audioClip = canonicalAudio ? {
				kind: 'audio',
				schemaVersion: 4,
				id: audioClipId,
				sourceId: audioSourceId,
				title: `${trackName} Audio`,
				timelineStartFrame: importOptions.timelineStartFrame,
				sourceStartFrame: 0,
				sourceDurationFrames: durationFrames,
				durationFrames,
				trimStartFrames: 0,
				trimEndFrames: 0,
				groupId: null,
				avLinkId: null,
				binItemId: importOptions.destination === 'project-bin' ? binItemId : null,
			} : null;
			const commands = [createAddSourceCommand(videoSource)];
			if (audioSource) commands.push(createAddSourceCommand(audioSource));
			let selectedTrackId = null;
			if (importOptions.destination === 'project-bin') {
				commands.push({ type: 'project-bin/add', clip: videoClip });
				if (audioClip) commands.push({ type: 'project-bin/add', clip: audioClip });
			} else {
				const target = importOptions.trackId ? findTrack(project, importOptions.trackId) : null;
				const laneGroupId = target?.laneGroupId || createStableId('media-lane');
				let videoTrack = target?.type === 'video' ? target : null;
				let audioTrack = target?.type === 'audio' ? target : null;
				if (target?.laneGroupId) {
					videoTrack ||= project.tracks.find((track) => (
						track.type === 'video' && track.laneGroupId === target.laneGroupId
					)) || null;
					audioTrack ||= project.tracks.find((track) => (
						track.type === 'audio' && track.laneGroupId === target.laneGroupId
					)) || null;
				}
				if (!videoTrack || !audioTrack) {
					const videoTrackId = createStableId('video-track');
					const audioTrackId = createStableId('track');
					const index = Number.isSafeInteger(importOptions.trackIndex)
						? importOptions.trackIndex
						: project.tracks.length;
					commands.push({
						...createAddTrackCommand({
							schemaVersion: 4,
							type: 'video',
							id: videoTrackId,
							name: trackName,
							laneGroupId,
						}),
						index,
					}, {
						...createAddTrackCommand({
							schemaVersion: 4,
							type: 'audio',
							id: audioTrackId,
							name: `${trackName} Audio`,
							laneGroupId,
							armed: false,
						}),
						index: index + 1,
					});
					videoTrack = { id: videoTrackId };
					audioTrack = { id: audioTrackId };
				}
				selectedTrackId = videoTrack.id;
				const avLinkId = audioClip ? createStableId('av-link') : null;
				commands.push(createAddClipCommand(videoTrack.id, { ...videoClip, avLinkId }));
				if (audioClip) commands.push(createAddClipCommand(audioTrack.id, { ...audioClip, avLinkId }));
			}
			await activateVideoSource(videoSource);
			commit({ type: 'batch', commands }, {
				selectTrackId: selectedTrackId,
				selectClipId: videoClipId,
			});
			warnEnvelope();
			return Object.freeze({
				destination: importOptions.destination,
				sourceId: videoSourceId,
				audioSourceId,
				clipId: videoClipId,
				audioClipId,
				trackId: selectedTrackId,
			});
		} catch (error) {
			revokeVideoVisual(videoSourceId);
			if (audioSourceId) {
				sourceBuffers.delete(audioSourceId);
				sourcePeaks.delete(audioSourceId);
				if (audioPersisted) await store.deleteSource(audioSourceId).catch(() => undefined);
			}
			if (mediaPersisted) await store.deleteMediaAsset(videoSourceId).catch(() => undefined);
			throw error;
		} finally {
			extractor.dispose();
		}
	}

	function fitAudioBufferToFrames(buffer, frameCount, context) {
		if (buffer.length === frameCount) return buffer;
		const output = context.createBuffer(buffer.numberOfChannels, frameCount, buffer.sampleRate);
		for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
			output.getChannelData(channel).set(buffer.getChannelData(channel).subarray(0, frameCount));
		}
		return output;
	}

	async function inspectIncrementalWav(file) {
		if (!isWavFile(file) || typeof file?.slice !== 'function') return null;
		try {
			const descriptor = await inspectWavBlobPcm(file);
			if (descriptor.channelCount > 2
				|| sourcePcmBytes(descriptor) <= SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES) return null;
			return descriptor;
		} catch {
			return null;
		}
	}

	async function importIncrementalWav(file, descriptor, importOptions = normalizeImportOptions()) {
		const pcmBytes = sourcePcmBytes(descriptor);
		await preflightStorage(pcmBytes, 'import');
		const sourceId = createStableId('source');
		const clipId = createStableId('clip');
		const trackName = stripExtension(file.name) || `${copy.track} ${project.tracks.length + 1}`;
		const sourceName = file.name;
		const mimeType = file.type || 'audio/wav';
		const writer = await store.beginSourceWrite(sourceId, {
			name: sourceName,
			mimeType,
			sampleRate: descriptor.sampleRate,
			channelCount: descriptor.channelCount,
			chunkFrames: SOURCE_CHUNK_FRAMES,
		});
		let metadata;
		try {
			await streamWavBlobPcm(file, {
				descriptor,
				chunkFrames: SOURCE_CHUNK_FRAMES,
				onChunk: (channels) => writer.write(channels),
			});
			metadata = await writer.commit({
				sampleRate: descriptor.sampleRate,
				channelCount: descriptor.channelCount,
				chunkFrames: SOURCE_CHUNK_FRAMES,
			});
		} catch (error) {
			await writer.abort().catch(() => undefined);
			throw error;
		}

		const source = {
			schemaVersion: 2,
			sampleFormat: 'float32',
			chunkFrames: SOURCE_CHUNK_FRAMES,
			id: sourceId,
			storageKey: sourceId,
			name: sourceName,
			mimeType,
			frameCount: descriptor.frameCount,
			channelCount: descriptor.channelCount,
			sampleRate: descriptor.sampleRate,
			originalSampleRate: descriptor.sampleRate,
		};
		const prepared = prepareImportedMediaCommand(source, {
			schemaVersion: 2,
			title: trackName,
			sourceDurationFrames: descriptor.frameCount,
			id: clipId,
			sourceId,
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			durationFrames: Math.max(1, Math.round(descriptor.frameCount * projectSampleRate() / descriptor.sampleRate)),
		}, trackName, importOptions);
		try {
			await activateStoredSource(source, metadata);
			commit(prepared.command, prepared.selection);
		} catch (error) {
			sourceBuffers.delete(sourceId);
			sourceChunkProviders.delete(sourceId);
			sourcePeaks.delete(sourceId);
			await store.deleteSource(sourceId).catch(() => undefined);
			throw error;
		}
		warnEnvelope();
		return prepared.result;
	}

	async function importStructuredAudacityProject(file, legacyDataFiles = []) {
		const legacy = isLegacyAupFile(file);
		setStatus(legacy ? copy.aupImporting : copy.aup3Importing);
		const structure = legacy
			? await decodeLegacyAupProject(file, legacyDataFiles, { onProgress: updateAup3ImportProgress })
			: await decodeAup3File(file, { structured: true, onProgress: updateAup3ImportProgress });
		const decoded = convertStructuredAup3ToProjectV2(structure, {
			title: stripExtension(file.name),
			projectId: createStableId('project'),
		});
		const importedProject = await persistImportedProject(decoded);
		const detail = decoded.warnings.map(formatAup3Warning).filter(Boolean).join(' ');
		const message = legacy ? copy.aupImported : copy.aup3Imported;
		return { project: importedProject, warnings: decoded.warnings, notice: detail ? `${message} ${detail}` : message };
	}

	async function persistImportedProject(decoded) {
		if (!decoded?.project || !Array.isArray(decoded.sources)) throw new TypeError(copy.structuredProjectRequired);
		const importedProject = migrateAudioEditorProject(decoded.project).project;
		const sourceById = new Map(importedProject.sources.map((source) => [source.id, source]));
		const totalBytes = decoded.sources.reduce((sum, source) => (
			sum + (source.channels || []).reduce((channelSum, channel) => channelSum + (channel?.byteLength || 0), 0)
		), 0);
		await preflightStorage(totalBytes, 'import');
		const persistedSourceIds = [];
		let projectSaved = false;
		try {
			for (const sourceAudio of decoded.sources) {
				const source = sourceById.get(sourceAudio.sourceId);
				if (!source) throw new Error(copy.importedSourceDescriptorMissing.replace('{source}', sourceAudio.sourceId));
				const channels = sourceAudio.channels;
				if (!Array.isArray(channels) || channels.length !== source.channelCount
					|| !channels.every((channel) => channel instanceof Float32Array && channel.length === source.frameCount)) {
					throw new Error(copy.importedSourcePcmInvalid.replace('{source}', source.name || source.id));
				}
				const writer = await store.beginSourceWrite(source.id, {
					name: source.name,
					mimeType: source.mimeType,
					sampleRate: source.sampleRate,
					channelCount: source.channelCount,
					chunkFrames: SOURCE_CHUNK_FRAMES,
				});
				try {
					for (let offset = 0; offset < source.frameCount; offset += SOURCE_CHUNK_FRAMES) {
						const end = Math.min(source.frameCount, offset + SOURCE_CHUNK_FRAMES);
						await writer.write(channels.map((channel) => channel.subarray(offset, end)));
					}
					await writer.commit({ sampleRate: source.sampleRate, channelCount: source.channelCount });
					persistedSourceIds.push(source.id);
					await store.saveAnalysis(peakCacheKey(source.id), await generateWaveformPeaks(channels, copy));
				} catch (error) {
					await writer.abort();
					throw error;
				}
			}
			await store.saveProject(importedProject);
			projectSaved = true;
			await switchProject(importedProject, { save: false });
			return importedProject;
		} catch (error) {
			if (projectSaved && project?.id !== importedProject.id) {
				await store.deleteProject(importedProject.id).catch(() => undefined);
			}
			if (project?.id !== importedProject.id) {
				for (const sourceId of persistedSourceIds) await store.deleteSource(sourceId).catch(() => undefined);
			}
			throw error;
		}
	}

	function updateAup3ImportProgress(progress) {
		const rawValue = typeof progress === 'number'
			? progress
			: Number(progress?.progress ?? progress?.value);
		if (!Number.isFinite(rawValue)) return;
		const percentage = rawValue <= 1 ? rawValue * 100 : rawValue;
		setStatus(`${copy.aup3Importing} ${Math.max(0, Math.min(100, Math.round(percentage)))}%`);
	}

	function addTrack(options = {}) {
		if (editingBlocked()) return;
		const trackId = options.id || createStableId('track');
		const track = createAddTrackCommand({
			...options,
			schemaVersion: 2,
			type: 'audio',
			id: trackId,
			name: String(options.name || `${copy.track} ${project.tracks.length + 1}`).trim() || copy.track,
			color: options.color || AUDIO_EDITOR_TRACK_COLORS[project.tracks.filter((item) => item.type === 'audio').length % AUDIO_EDITOR_TRACK_COLORS.length],
			armed: options.armed ?? project.tracks.length === 0,
			height: options.height ?? 300,
		});
		commit(track, { selectTrackId: trackId });
		assignPreferredInputToTrack(trackId);
		return trackId;
	}

	function addVideoTrackPair(options = {}) {
		if (editingBlocked()) return null;
		const laneGroupId = options.laneGroupId || createStableId('media-lane');
		const videoTrackId = options.videoTrackId || options.id || createStableId('video-track');
		const audioTrackId = options.audioTrackId || createStableId('track');
		const requestedIndex = options.index == null
			? project.tracks.length
			: Math.max(0, Math.min(project.tracks.length, Math.round(Number(options.index))));
		if (!Number.isSafeInteger(requestedIndex)) throw new TypeError(copy.trackDestinationInvalid);
		const baseName = String(options.name || `Video ${project.tracks.filter((track) => track.type === 'video').length + 1}`).trim();
		const commands = [
			{
				...createAddTrackCommand({
					schemaVersion: 4,
					type: 'video',
					id: videoTrackId,
					name: baseName,
					laneGroupId,
					height: options.height ?? options.videoHeight ?? 300,
				}),
				index: requestedIndex,
			},
			{
				...createAddTrackCommand({
					schemaVersion: 4,
					type: 'audio',
					id: audioTrackId,
					name: `${baseName} Audio`,
					laneGroupId,
					armed: false,
					height: options.height ?? options.audioHeight ?? 300,
				}),
				index: requestedIndex + 1,
			},
		];
		commit({ type: 'batch', commands }, { selectTrackId: videoTrackId });
		return videoTrackId;
	}

	function assignPreferredInputToTrack(trackId) {
		if (!project || state.recordingRouting.routes[trackId]) return false;
		const track = findTrack(project, trackId);
		if (!track || track.type !== 'audio') return false;
		const deviceId = state.preferredInputDeviceId || RECORDING_DEFAULT_DEVICE_ID;
		const displayInput = deviceId === RECORDING_DISPLAY_SOURCE_KEY;
		const device = state.recordingDevices.find((candidate) => candidate.deviceId === deviceId);
		const channelCount = state.preferredInputChannelCount === 2 ? 2 : 1;
		const displaySource = displayInput
			? state.recordingPoolSources.find((source) => source.kind === 'display')
			: null;
		const discoveredChannelCount = Math.max(0, Number(displaySource?.channelCount ?? device?.channelCount) || 0);
		if (discoveredChannelCount > 0 && discoveredChannelCount < channelCount) return false;
		const maximumChannels = Math.max(channelCount, discoveredChannelCount || 2);
		for (let channelStart = 0; channelStart + channelCount <= maximumChannels; channelStart += channelCount) {
			try {
				state.recordingRouting = setRecordingTrackRoute(state.recordingRouting, track, {
					...(displayInput
						? { kind: 'display', label: copy.recordingDesktopAudio }
						: { kind: 'device', deviceId, deviceLabel: device?.label || '' }),
					channelStart,
					channelCount,
				});
				state.recordingRouteHealth[trackId] = device?.status || 'available';
				updateRecordingDeviceRows();
				void persistRecordingRouting();
				publishDocumentSnapshot();
				return true;
			} catch {
				// Try the next free mono channel; leave the track unassigned when none remain.
			}
		}
		return false;
	}

	function addLabelTrack(options = {}) {
		if (editingBlocked()) return null;
		const trackId = options.id || createStableId('label-track');
		const command = createAddLabelTrackCommand({
			...options,
			id: trackId,
			name: String(options.name || copy.labels).trim(),
			height: options.height ?? 300,
		});
		commit(command, { selectTrackId: trackId });
		return trackId;
	}

	function reorderTrack(trackId, requestedIndex) {
		if (editingBlocked()) return null;
		const track = findTrack(project, trackId);
		if (!track) throw new Error(copy.trackNotFound);
		const index = Math.max(0, Math.min(project.tracks.length - 1, Math.round(Number(requestedIndex))));
		if (!Number.isFinite(index)) throw new TypeError(copy.trackDestinationInvalid);
		if (project.tracks[index]?.id === track.id) return track.id;
		commit({ type: 'track/reorder', trackId: track.id, index }, { selectTrackId: track.id });
		return track.id;
	}

	function moveTrack(trackId, direction) {
		if (!trackId) return null;
		const index = project.tracks.findIndex((track) => track.id === trackId);
		if (index < 0) throw new Error(copy.trackNotFound);
		const blocks = [];
		const consumedLaneGroups = new Set();
		for (const track of project.tracks) {
			if (!track.laneGroupId) {
				blocks.push([track]);
				continue;
			}
			if (consumedLaneGroups.has(track.laneGroupId)) continue;
			consumedLaneGroups.add(track.laneGroupId);
			blocks.push(project.tracks.filter((candidate) => candidate.laneGroupId === track.laneGroupId));
		}
		const blockIndex = blocks.findIndex((block) => block.some((track) => track.id === trackId));
		const adjacentBlock = direction === 'up'
			? blocks[blockIndex - 1]
			: direction === 'down'
				? blocks[blockIndex + 1]
				: null;
		const destination = direction === 'top'
			? 0
			: direction === 'bottom'
				? project.tracks.length - 1
				: direction === 'up'
					? project.tracks.findIndex((track) => track.id === adjacentBlock?.[0]?.id)
					: direction === 'down'
						? project.tracks.findIndex((track) => track.id === adjacentBlock?.[0]?.id)
						: index;
		if (destination < 0) return trackId;
		return reorderTrack(trackId, destination);
	}

	function setTrackDisplayMode(trackId, displayMode) {
		if (editingBlocked()) return null;
		if (project.schemaVersion < 2) throw new Error(copy.v2Required);
		const track = findTrack(project, trackId);
		if (!track || track.type !== 'audio') throw new Error(copy.audioTrackRequired);
		if (!['waveform', 'spectrogram', 'multiview', 'half-wave'].includes(displayMode)) throw new RangeError(copy.unknownTrackDisplay);
		state.timelineView = displayMode;
		return commit({ type: 'track/update', trackId: track.id, changes: { displayMode } }, { selectTrackId: track.id });
	}

	function setTrackRate(trackId = state.selectedTrackId, requestedSampleRate = projectSampleRate()) {
		return resampleTrack(trackId, requestedSampleRate);
	}

	function setTrackSampleFormat(trackId = state.selectedTrackId, sampleFormat = 'float32') {
		if (editingBlocked()) return null;
		if (project.schemaVersion < 2) throw new Error(copy.v2Required);
		const track = findTrack(project, trackId);
		if (!track || track.type !== 'audio') throw new Error(copy.audioTrackRequired);
		if (!['int16', 'int24', 'int32', 'float32', 'float64'].includes(sampleFormat)) {
			throw new RangeError(copy.unsupportedSampleFormat);
		}
		const sourceIds = new Set(track.clipIds.map((clipId) => findClip(project, clipId)?.sourceId).filter(Boolean));
		// Sample PCM is stored as Float32; this descriptor records the requested
		// interchange format on each clip source rather than on its container.
		const commands = [...sourceIds].map((sourceId) => ({
			type: 'source/update',
			sourceId,
			changes: { sampleFormat },
		}));
		if (!commands.length) return track.id;
		return commit({ type: 'batch', commands }, { selectTrackId: track.id });
	}

	async function mixAndRenderTracks() {
		if (editingBlocked()) return null;
		if (project.schemaVersion < 2) throw new Error(copy.v2Required);
		const targetTracks = selectedAudioTracksForMix();
		const targetClips = targetTracks.flatMap((track) => (
			track.clipIds.map((clipId) => findClip(project, clipId)).filter(Boolean)
		));
		if (!targetTracks.length || !targetClips.length) {
			throw new Error(copy.mixRenderRequiresAudio || copy.audacitySelectionHint || copy.audioTrackRequired);
		}

		const sampleRate = projectSampleRate();
		const startFrame = Math.min(...targetClips.map((clip) => clip.timelineStartFrame));
		const endFrame = Math.max(...targetClips.map((clip) => clip.timelineStartFrame + clip.durationFrames));
		const renderSnapshotProject = createMixRenderSnapshot(targetTracks);
		const tailFrames = mixRenderTailFrames(targetTracks, renderSnapshotProject, sampleRate);
		const preRollFrames = Math.min(startFrame, sampleRate * 10);
		const outputFrames = endFrame - startFrame + tailFrames;
		// The Web Audio graph renders at most stereo. Reserve that conservative
		// storage bound; bounded offline renders may later prove a mono fold is
		// lossless, while the streamed path remains stereo without scanning it.
		const outputBytes = outputFrames * 2 * Float32Array.BYTES_PER_ELEMENT;
		const processingFrames = outputFrames + preRollFrames;
		const streamToStorage = processingFrames * 2 * Float32Array.BYTES_PER_ELEMENT * 3
			> mixRenderMemoryLimitBytes;

		// Claim the shared destructive-render slot before the first await so a
		// second activation cannot create a competing immutable source.
		state.audacityEffectProcessing = true;
		setStatus(copy.rendering);
		publishDocumentSnapshot();
		let renderedSource = null;
		let published = false;
		try {
			await preflightStorage(outputBytes, 'effect');
			const mixName = targetTracks.length === 1
				? targetTracks[0].name
				: copy.mixedTrack || 'Mix';
			const sourceName = `${mixName} — ${copy.mixRender || copy.mixdownTo || 'Mix and render'}.wav`;
			if (streamToStorage) {
				renderedSource = await persistStreamedMixSource(renderSnapshotProject, {
					name: sourceName,
					startFrame,
					endFrame,
					tailFrames,
					preRollFrames,
					outputFrames,
					sampleRate,
				});
			} else {
				const rendered = await renderSnapshot(renderSnapshotProject, {
					startFrame,
					endFrame,
					includeTail: tailFrames ? tailFrames / sampleRate : false,
					includeMaster: false,
					includeTrackPan: true,
					respectMuteSolo: false,
					preRollFrames,
				});
				const outputChannelCount = mixRenderOutputChannelCount(
					targetTracks,
					renderSnapshotProject,
					rendered,
				);
				const output = await normalizeMixRenderOutput(rendered, outputChannelCount);
				renderedSource = await persistRenderedMixSource(output, sourceName);
			}
			const result = prepareMixRenderCommit(targetTracks, renderedSource.source, {
				startFrame,
				mixName,
			});
			commit(result.command, { selectTrackId: result.trackId, selectClipId: result.clipId });
			published = true;
			setStatus(copy.done, 'success');
			return Object.freeze({
				trackId: result.trackId,
				clipId: result.clipId,
				sourceId: renderedSource.source.id,
			});
		} catch (error) {
			if (renderedSource && !published) await rollbackDerivedSources([renderedSource]);
			handleError(error);
			throw error;
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	function selectedAudioTracksForMix() {
		const selectionIds = new Set((project.selection?.trackIds || []).filter((trackId) => (
			findTrack(project, trackId)?.type === 'audio'
		)));
		if (!selectionIds.size) {
			const focusedTrack = findTrack(project, state.selectedTrackId);
			if (focusedTrack?.type === 'audio') selectionIds.add(focusedTrack.id);
		}
		if (!selectionIds.size && state.selectedClipId) {
			const clipTrack = findClipTrack(project, state.selectedClipId);
			if (clipTrack?.type === 'audio') selectionIds.add(clipTrack.id);
		}
		return project.tracks.filter((track) => track.type === 'audio' && selectionIds.has(track.id));
	}

	function mixRenderOutputChannelCount(targetTracks, snapshot, rendered) {
		const allSourcesMono = targetTracks.every((track) => track.clipIds.every((clipId) => {
			const clip = findClip(project, clipId);
			return findSource(project, clip?.sourceId)?.channelCount === 1;
		}));
		const allTracksCentered = targetTracks.every((track) => Number(track.pan ?? 0) === 0);
		if (!allSourcesMono || !allTracksCentered) return 2;

		const buses = [
			...(snapshot?.mixer?.groups || []),
			...(snapshot?.mixer?.sends || []),
		];
		if (buses.some((bus) => Number(bus.pan ?? 0) !== 0)) return 2;
		const rackEffects = [
			...targetTracks.flatMap((track) => track.effectsActive === false ? [] : track.effects || []),
			...buses.flatMap((bus) => bus.effectsActive === false ? [] : bus.effects || []),
		].filter((effect) => effect?.enabled !== false && effect?.bypassed !== true);
		// Audacity worklets expose a fixed stereo output even for mono input. Do
		// not apply the centered-mono inverse to that dual-channel signal: it can
		// change level or discard channel-specific processor state.
		if (rackEffects.some((effect) => isAudacityRackEffectType(effect.type))) return 2;

		const channels = audioBufferChannels(rendered);
		if (channels.length < 2) return 1;
		if (channels[0].length !== channels[1].length) return 2;
		for (let frame = 0; frame < channels[0].length; frame += 1) {
			if (channels[0][frame] !== channels[1][frame]) return 2;
		}
		return 1;
	}

	function createMixRenderSnapshot(targetTracks) {
		const snapshot = cloneProject(project);
		const targetIds = new Set(targetTracks.map((track) => track.id));
		const multipleTracks = targetTracks.length > 1;
		const relevantBusIds = multipleTracks ? mixRenderBusIds(snapshot, targetIds) : new Set();
		const relevantBuses = [
			...(snapshot.mixer?.groups || []),
			...(snapshot.mixer?.sends || []),
		].filter((bus) => relevantBusIds.has(bus.id));
		const controlTrackIds = new Set([
			...targetTracks.flatMap((track) => track.effectsActive === false ? [] : track.effects || []),
			...relevantBuses.flatMap((bus) => bus.effectsActive === false ? [] : bus.effects || []),
		].filter((effect) => effect.type === 'audacity-auto-duck' && effect.enabled !== false && effect.bypassed !== true)
			.map((effect) => effect.context?.controlTrackId)
			.filter((trackId) => findTrack(snapshot, trackId)?.type === 'audio'));
		const renderTrackIds = new Set([...targetIds, ...controlTrackIds]);
		snapshot.tracks = snapshot.tracks
			.filter((track) => track.type === 'audio' && renderTrackIds.has(track.id))
			.map((track) => targetIds.has(track.id)
				? { ...track, mute: false, solo: false }
				: { ...track, gain: 0, pan: 0, mute: false, solo: false, effects: [], envelope: [] });
		const renderClipIds = new Set(snapshot.tracks.flatMap((track) => track.clipIds));
		snapshot.clips = snapshot.clips.filter((clip) => renderClipIds.has(clip.id));
		const renderSourceIds = new Set(snapshot.clips.map((clip) => clip.sourceId));
		snapshot.sources = snapshot.sources.filter((source) => renderSourceIds.has(source.id));
		snapshot.selection = {
			startFrame: 0,
			endFrame: 0,
			trackIds: [],
			clipIds: [],
			frequencyRange: null,
		};

		if (!multipleTracks) {
			snapshot.mixer = { groups: [], sends: [], routes: {} };
			return snapshot;
		}
		const filterBuses = (buses) => (buses || []).filter((bus) => relevantBusIds.has(bus.id));
		const routes = {};
		for (const trackId of renderTrackIds) {
			const route = snapshot.mixer?.routes?.[trackId];
			if (!route) continue;
			routes[trackId] = {
				...route,
				groupId: relevantBusIds.has(route.groupId) ? route.groupId : null,
				sends: Object.fromEntries(Object.entries(route.sends || {})
					.filter(([sendId]) => relevantBusIds.has(sendId))),
			};
		}
		snapshot.mixer = {
			groups: filterBuses(snapshot.mixer?.groups),
			sends: filterBuses(snapshot.mixer?.sends),
			routes,
		};
		return snapshot;
	}

	function mixRenderBusIds(snapshot, targetIds) {
		const ids = new Set();
		for (const trackId of targetIds) {
			const route = snapshot.mixer?.routes?.[trackId];
			if (route?.groupId) ids.add(route.groupId);
			for (const [sendId, gain] of Object.entries(route?.sends || {})) {
				if (Number(gain) > 0) ids.add(sendId);
			}
		}
		return ids;
	}

	function mixRenderTailFrames(targetTracks, snapshot, sampleRate) {
		const trackTail = Math.max(0, ...targetTracks.map((track) => (
			track.effectsActive === false ? 0 : rackTailFrames(track.effects || [], sampleRate, 10)
		)));
		const busTail = targetTracks.length > 1
			? Math.max(0, ...[
				...(snapshot.mixer?.groups || []),
				...(snapshot.mixer?.sends || []),
			].map((bus) => bus.effectsActive === false ? 0 : rackTailFrames(bus.effects || [], sampleRate, 10)))
			: 0;
		return Math.min(sampleRate * 10, trackTail + busTail);
	}

	async function normalizeMixRenderOutput(rendered, outputChannelCount) {
		const channels = audioBufferChannels(rendered);
		if (!channels.length || channels.length > 2 || !channels[0]?.length
			|| channels.some((channel) => channel.length !== channels[0].length)
			|| Number(rendered.sampleRate) !== projectSampleRate()) {
			throw new Error(copy.effectInvalidAudio);
		}
		if (outputChannelCount === 2) {
			if (channels.length !== 2) throw new Error(copy.effectInvalidAudio);
			return rendered;
		}
		if (channels.length === 1) return rendered;

		// StereoPannerNode distributes a centered mono input equally at -3 dB
		// per side. Its mono inverse is therefore (left + right) / sqrt(2):
		// averaging would make a centered Mix and Render 3 dB too quiet, while
		// an unscaled sum would make it 3 dB too loud.
		const mono = new Float32Array(channels[0].length);
		for (let frame = 0; frame < mono.length; frame += 1) {
			mono[frame] = (channels[0][frame] + channels[1][frame]) * Math.SQRT1_2;
		}
		const context = await engine.getAudioContext({ resume: false });
		return bufferFromChannels([mono], rendered.sampleRate, context, copy);
	}

	async function persistRenderedMixSource(rendered, name) {
		const channels = audioBufferChannels(rendered);
		if (!channels.length || channels.length > 2 || !channels[0]?.length
			|| channels.some((channel) => channel.length !== channels[0].length)) {
			throw new Error(copy.effectInvalidAudio);
		}
		const sampleRate = projectSampleRate();
		if (Number(rendered.sampleRate) !== sampleRate) throw new Error(copy.effectInvalidAudio);
		const sourceId = createStableId('mixed-source');
		const writer = await store.beginSourceWrite(sourceId, {
			name,
			mimeType: 'audio/wav',
			sampleRate,
			channelCount: channels.length,
			chunkFrames: SOURCE_CHUNK_FRAMES,
		});
		try {
			await writeBuffer(writer, rendered);
			await writer.commit({ sampleRate, channelCount: channels.length });
		} catch (error) {
			await writer.abort();
			throw error;
		}
		const source = {
			schemaVersion: 2,
			id: sourceId,
			storageKey: sourceId,
			name,
			mimeType: 'audio/wav',
			frameCount: channels[0].length,
			channelCount: channels.length,
			sampleRate,
			originalSampleRate: sampleRate,
			sampleFormat: 'float32',
			chunkFrames: SOURCE_CHUNK_FRAMES,
			opaqueExtensions: {},
		};
		cacheSourceBuffer(sourceId, rendered);
		try {
			const peaks = await generateWaveformPeaks(channels, copy);
			sourcePeaks.set(sourceId, peaks);
			await store.saveAnalysis(peakCacheKey(sourceId), peaks);
			return { source, buffer: rendered, channels };
		} catch (error) {
			sourceBuffers.delete(sourceId);
			sourcePeaks.delete(sourceId);
			await store.deleteSource(sourceId).catch(() => undefined);
			throw error;
		}
	}

	async function persistStreamedMixSource(snapshot, {
		name,
		startFrame,
		endFrame,
		tailFrames,
		preRollFrames,
		outputFrames,
		sampleRate,
	}) {
		const sourceId = createStableId('mixed-source');
		const renderEngine = createCacheAwareRenderEngine();
		let writer = null;
		let committed = false;
		try {
			await prepareCommittedTimePitchCaches(snapshot);
			writer = createCoalescingSourceWriter(await store.beginSourceWrite(sourceId, {
				name,
				mimeType: 'audio/wav',
				sampleRate,
				channelCount: 2,
				chunkFrames: SOURCE_CHUNK_FRAMES,
			}));
			renderEngine.loadProject(snapshot, sourceBuffers);
			const result = await renderEngine.renderMixToSink({
				sink: writer,
				startFrame,
				endFrame,
				includeTail: tailFrames ? tailFrames / sampleRate : false,
				includeMaster: false,
				includeTrackPan: true,
				respectMuteSolo: false,
				preRollFrames,
				outputFrames,
				sampleRate,
			});
			if (Number(result?.sampleRate) !== sampleRate
				|| Number(result?.channelCount) !== 2
				|| Number(result?.frameCount) !== outputFrames
				|| writer.channelCount !== 2
				|| writer.framesWritten !== outputFrames) {
				throw new Error(copy.effectInvalidAudio);
			}
			const metadata = await writer.commit({
				sampleRate,
				channelCount: 2,
				chunkFrames: SOURCE_CHUNK_FRAMES,
			});
			committed = true;
			const source = {
				schemaVersion: 2,
				id: sourceId,
				storageKey: sourceId,
				name,
				mimeType: 'audio/wav',
				frameCount: outputFrames,
				channelCount: 2,
				sampleRate,
				originalSampleRate: sampleRate,
				sampleFormat: 'float32',
				chunkFrames: SOURCE_CHUNK_FRAMES,
				opaqueExtensions: {},
			};
			await activateStoredSource(source, metadata);
			return { source, buffer: null, channels: null };
		} catch (error) {
			if (committed) await rollbackDerivedSources([{ source: { id: sourceId } }]);
			else await writer?.abort?.().catch(() => undefined);
			throw error;
		} finally {
			await renderEngine.dispose();
		}
	}

	function prepareMixRenderCommit(targetTracks, source, { startFrame, mixName }) {
		const targetIds = new Set(targetTracks.map((track) => track.id));
		const bottomTrack = targetTracks[targetTracks.length - 1];
		const singleTrack = targetTracks.length === 1;
		const trackId = singleTrack ? bottomTrack.id : createStableId('mixed-track');
		const clipId = createStableId('mixed-clip');
		const commands = [createAddSourceCommand(source)];
		if (singleTrack) {
			commands.push(
				...bottomTrack.clipIds.map((existingClipId) => ({ type: 'clip/remove', clipId: existingClipId })),
				...(bottomTrack.effects || []).map((effect) => ({
					type: 'effect/remove', scope: 'track', trackId, effectId: effect.id,
				})),
				{
					type: 'track/update',
					trackId,
					changes: { gain: 1, pan: 0, mute: false, solo: false, armed: false, envelope: [] },
				},
			);
		} else {
			const bottomIndex = project.tracks.findIndex((track) => track.id === bottomTrack.id);
			const insertIndex = project.tracks.slice(0, bottomIndex)
				.filter((track) => !targetIds.has(track.id)).length;
			commands.push(
				...targetTracks.map((track) => ({ type: 'track/remove', trackId: track.id })),
				{
					...createAddTrackCommand({
						...bottomTrack,
						id: trackId,
						name: mixName,
						gain: 1,
						pan: 0,
						mute: false,
						solo: false,
						armed: false,
						envelope: [],
						effects: [],
						clipIds: [],
						opaqueExtensions: {},
					}),
					index: insertIndex,
				},
			);
		}
		commands.push(
			createAddClipCommand(trackId, {
				id: clipId,
				sourceId: source.id,
				title: mixName,
				timelineStartFrame: startFrame,
				sourceStartFrame: 0,
				sourceDurationFrames: source.frameCount,
				durationFrames: source.frameCount,
			}),
			{
				type: 'selection/set',
				startFrame: project.selection?.startFrame || 0,
				endFrame: project.selection?.endFrame || 0,
				trackIds: [trackId],
				clipIds: [],
				frequencyRange: null,
			},
		);
		return { type: 'mix-render', command: { type: 'batch', commands }, trackId, clipId };
	}

	async function resampleTrack(trackId = state.selectedTrackId, requestedSampleRate = projectSampleRate()) {
		if (editingBlocked()) return null;
		if (project.schemaVersion < 2) throw new Error(copy.v2Required);
		const track = findTrack(project, trackId);
		if (!track || track.type !== 'audio') throw new Error(copy.audioTrackRequired);
		const sampleRate = normalizeProjectSampleRate(requestedSampleRate);
		const clips = track.clipIds.map((clipId) => findClip(project, clipId)).filter(Boolean);
		const sources = [...new Map(clips.map((clip) => {
			const source = findSource(project, clip.sourceId);
			return [source?.id, source];
		})).values()].filter(Boolean);
		const sourcesToResample = sources.filter((source) => source.sampleRate !== sampleRate);
		if (!sourcesToResample.length) return track.id;
		const estimatedBytes = sourcesToResample.reduce((sum, source) => (
			sum + Math.max(1, Math.round(source.frameCount * sampleRate / source.sampleRate))
				* source.channelCount * Float32Array.BYTES_PER_ELEMENT
		), 0);
		await preflightStorage(estimatedBytes, 'effect');
		state.audacityEffectProcessing = true;
		setStatus(copy.resamplingTrack || copy.audacityProcessing);
		publishDocumentSnapshot();
		const replacements = new Map();
		const persistedSourceIds = [];
		try {
			const context = await engine.getAudioContext({ resume: false });
			for (const source of sourcesToResample) {
				const input = sourceBuffers.get(source.id)
					? audioBufferChannels(sourceBuffers.get(source.id))
					: await loadStoredSourceChannels(store, source);
				const outputFrames = Math.max(1, Math.round(source.frameCount * sampleRate / source.sampleRate));
				const channels = resampleChannelsWindowedSinc(input, source.sampleRate, sampleRate, outputFrames);
				const sourceId = createStableId('resampled-source');
				const name = `${source.name || track.name} (${sampleRate} Hz)`;
				const buffer = await bufferFromChannels(channels, sampleRate, context, copy);
				const writer = await store.beginSourceWrite(sourceId, {
					name,
					mimeType: source.mimeType || 'audio/wav',
					sampleRate,
					channelCount: source.channelCount,
					chunkFrames: SOURCE_CHUNK_FRAMES,
				});
				try {
					await writeBuffer(writer, buffer);
					await writer.commit({ sampleRate, channelCount: source.channelCount });
				} catch (error) {
					await writer.abort();
					throw error;
				}
				persistedSourceIds.push(sourceId);
				const nextSource = {
					...source,
					id: sourceId,
					storageKey: sourceId,
					name,
					frameCount: outputFrames,
					sampleRate,
					originalSampleRate: source.originalSampleRate || source.sampleRate,
				};
				replacements.set(source.id, { source: nextSource, buffer, channels });
				cacheSourceBuffer(sourceId, buffer);
				const peaks = await generateWaveformPeaks(channels, copy);
				sourcePeaks.set(sourceId, peaks);
				await store.saveAnalysis(peakCacheKey(sourceId), peaks);
			}
			const commands = [...replacements.values()].map(({ source }) => createAddSourceCommand(source));
			for (const clip of clips) {
				const originalSource = findSource(project, clip.sourceId);
				const replacement = replacements.get(clip.sourceId);
				if (!originalSource || !replacement) continue;
				const ratio = sampleRate / originalSource.sampleRate;
				const sourceStartFrame = Math.min(
					replacement.source.frameCount - 1,
					Math.max(0, Math.round(clip.sourceStartFrame * ratio)),
				);
				const requestedDuration = Math.max(1, Math.round((clip.sourceDurationFrames || clip.durationFrames) * ratio));
				const sourceDurationFrames = Math.min(requestedDuration, replacement.source.frameCount - sourceStartFrame);
				const trimStartFrames = Math.min(sourceStartFrame, Math.max(0, Math.round((clip.trimStartFrames || 0) * ratio)));
				const trimEndFrames = Math.min(
					replacement.source.frameCount - sourceStartFrame - sourceDurationFrames,
					Math.max(0, Math.round((clip.trimEndFrames || 0) * ratio)),
				);
				commands.push(
					{ type: 'clip/remove', clipId: clip.id },
					createAddClipCommand(track.id, {
						...clip,
						sourceId: replacement.source.id,
						sourceStartFrame,
						sourceDurationFrames,
						trimStartFrames,
						trimEndFrames,
					}),
				);
			}
			commit({ type: 'batch', commands }, { selectTrackId: track.id });
			setStatus(copy.done, 'success');
			return track.id;
		} catch (error) {
			for (const sourceId of persistedSourceIds) {
				sourceBuffers.delete(sourceId);
				sourcePeaks.delete(sourceId);
				await store.deleteSource(sourceId).catch(() => undefined);
			}
			throw error;
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	async function swapTrackChannels(trackId = state.selectedTrackId) {
		if (editingBlocked()) return null;
		if (project.schemaVersion < 2) throw new Error(copy.v2Required);
		const track = findTrack(project, trackId);
		if (!track || track.type === 'label' || audioTrackChannelCountV2(project, track) !== 2) throw new Error(copy.stereoTrackRequired || copy.audioTrackRequired);
		const clips = track.clipIds.map((clipId) => findClip(project, clipId)).filter(Boolean);
		const sources = uniqueClipSources(clips).filter((source) => source.channelCount > 1);
		if (!sources.length) return track.id;
		await preflightStorage(sources.reduce((sum, source) => sum + source.frameCount * 2 * Float32Array.BYTES_PER_ELEMENT, 0), 'effect');
		state.audacityEffectProcessing = true;
		setStatus(copy.rewritingChannels || copy.audacityProcessing);
		publishDocumentSnapshot();
		const derived = [];
		try {
			const replacements = new Map();
			for (const source of sources) {
				const channels = await sourceChannelsForEdit(source);
				const record = await persistDerivedSource(source, [channels[1], channels[0]], `${source.name} — ${copy.channelsSwapped}`, 'swapped-source');
				derived.push(record);
				replacements.set(source.id, record.source);
			}
			const commands = derived.map(({ source }) => createAddSourceCommand(source));
			for (const clip of clips) {
				const source = replacements.get(clip.sourceId);
				if (source) commands.push(createReplaceClipSourceCommand(clip.id, source.id));
			}
			commit({ type: 'batch', commands }, { selectTrackId: track.id });
			setStatus(copy.done, 'success');
			return track.id;
		} catch (error) {
			await rollbackDerivedSources(derived);
			throw error;
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	async function splitStereoTrack(trackId = state.selectedTrackId, panChannels = true) {
		if (editingBlocked()) return null;
		if (project.schemaVersion < 2) throw new Error(copy.v2Required);
		const track = findTrack(project, trackId);
		if (!track || track.type === 'label' || audioTrackChannelCountV2(project, track) !== 2) throw new Error(copy.stereoTrackRequired || copy.audioTrackRequired);
		const trackIndex = project.tracks.findIndex((candidate) => candidate.id === track.id);
		const clips = track.clipIds.map((clipId) => findClip(project, clipId)).filter(Boolean);
		const sources = uniqueClipSources(clips);
		await preflightStorage(sources.reduce((sum, source) => sum + source.frameCount * 2 * Float32Array.BYTES_PER_ELEMENT, 0), 'effect');
		state.audacityEffectProcessing = true;
		setStatus(copy.rewritingChannels || copy.audacityProcessing);
		publishDocumentSnapshot();
		const derived = [];
		try {
			const sourcePairs = new Map();
			for (const source of sources) {
				const channels = await sourceChannelsForEdit(source);
				const left = await persistDerivedSource(source, [channels[0]], `${source.name} — ${copy.leftChannel}`, 'left-source');
				derived.push(left);
				const right = await persistDerivedSource(source, [channels[1] || channels[0]], `${source.name} — ${copy.rightChannel}`, 'right-source');
				derived.push(right);
				sourcePairs.set(source.id, { left: left.source, right: right.source });
			}
			const rightTrackId = createStableId('track');
			const leftTrack = {
				...track,
				clipIds: [],
				name: `${track.name} — ${copy.leftChannel}`,
				pan: panChannels ? -1 : 0,
			};
			const rightTrack = {
				...track,
				id: rightTrackId,
				clipIds: [],
				name: `${track.name} — ${copy.rightChannel}`,
				pan: panChannels ? 1 : 0,
				armed: false,
				effects: (track.effects || []).map((effect) => ({ ...effect, id: createStableId('effect') })),
			};
			const commands = [
				...derived.map(({ source }) => createAddSourceCommand(source)),
				{ type: 'track/remove', trackId: track.id },
				{ ...createAddTrackCommand(leftTrack), index: trackIndex },
				{ ...createAddTrackCommand(rightTrack), index: trackIndex + 1 },
			];
			for (const clip of clips) {
				const pair = sourcePairs.get(clip.sourceId);
				if (!pair) continue;
				commands.push(
					createAddClipCommand(track.id, { ...clip, sourceId: pair.left.id }),
					createAddClipCommand(rightTrackId, {
						...clip,
						id: createStableId('clip'),
						sourceId: pair.right.id,
						title: `${clip.title} — ${copy.rightChannel}`,
					}),
				);
			}
			commit({ type: 'batch', commands }, { selectTrackId: track.id });
			setStatus(copy.done, 'success');
			return { leftTrackId: track.id, rightTrackId };
		} catch (error) {
			await rollbackDerivedSources(derived);
			throw error;
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	async function makeStereoTrack(trackId = state.selectedTrackId, partnerTrackId = null) {
		if (editingBlocked()) return null;
		if (project.schemaVersion < 2) throw new Error(copy.v2Required);
		const track = findTrack(project, trackId);
		if (!track || track.type === 'label' || audioTrackChannelCountV2(project, track) !== 1) throw new Error(copy.monoTrackRequired || copy.audioTrackRequired);
		const trackIndex = project.tracks.findIndex((candidate) => candidate.id === track.id);
		const partner = findTrack(project, partnerTrackId) || project.tracks.find((candidate, index) => (
			candidate.id !== track.id && candidate.type !== 'label' && audioTrackChannelCountV2(project, candidate) === 1 && index > trackIndex
		)) || project.tracks.find((candidate) => candidate.id !== track.id && candidate.type !== 'label' && audioTrackChannelCountV2(project, candidate) === 1);
		if (!partner) throw new Error(copy.compatibleMonoTrackRequired || copy.monoTrackRequired || copy.audioTrackRequired);
		const partnerIndex = project.tracks.findIndex((candidate) => candidate.id === partner.id);
		const clips = [...track.clipIds, ...partner.clipIds].map((clipId) => findClip(project, clipId)).filter(Boolean);
		const startFrame = clips.length ? Math.min(...clips.map((clip) => clip.timelineStartFrame)) : 0;
		const endFrame = clips.length ? Math.max(...clips.map((clip) => clip.timelineStartFrame + clip.durationFrames)) : 0;
		if (endFrame <= startFrame) {
			return commit({ type: 'batch', commands: [
				{ type: 'track/update', trackId: track.id, changes: { pan: 0 } },
				{ type: 'track/remove', trackId: partner.id },
			] }, { selectTrackId: track.id });
		}
		const frameCount = endFrame - startFrame;
		await preflightStorage(frameCount * 2 * Float32Array.BYTES_PER_ELEMENT, 'effect');
		state.audacityEffectProcessing = true;
		setStatus(copy.rewritingChannels || copy.audacityProcessing);
		publishDocumentSnapshot();
		const derived = [];
		try {
			const [leftChannels, rightChannels] = await Promise.all([
				renderDryTrackRange(track.id, startFrame, endFrame, 1),
				renderDryTrackRange(partner.id, startFrame, endFrame, 1),
			]);
			const template = findSource(project, clips[0]?.sourceId) || {
				name: track.name,
				mimeType: 'audio/wav',
				sampleRate: projectSampleRate(),
				originalSampleRate: projectSampleRate(),
				sampleFormat: 'float32',
				chunkFrames: SOURCE_CHUNK_FRAMES,
				opaqueExtensions: {},
			};
			const stereo = await persistDerivedSource({
				...template,
				sampleRate: projectSampleRate(),
				originalSampleRate: template.originalSampleRate || template.sampleRate || projectSampleRate(),
			}, [leftChannels[0], rightChannels[0]], `${track.name} — ${copy.stereo}`, 'stereo-source');
			derived.push(stereo);
			const insertIndex = Math.min(trackIndex, partnerIndex);
			const stereoTrack = { ...track, clipIds: [], pan: 0 };
			const clipId = createStableId('clip');
			commit({ type: 'batch', commands: [
				createAddSourceCommand(stereo.source),
				{ type: 'track/remove', trackId: track.id },
				{ type: 'track/remove', trackId: partner.id },
				{ ...createAddTrackCommand(stereoTrack), index: insertIndex },
				createAddClipCommand(track.id, {
					id: clipId,
					sourceId: stereo.source.id,
					title: track.name,
					timelineStartFrame: startFrame,
					sourceStartFrame: 0,
					sourceDurationFrames: frameCount,
					durationFrames: frameCount,
				}),
			] }, { selectTrackId: track.id, selectClipId: clipId });
			setStatus(copy.done, 'success');
			return track.id;
		} catch (error) {
			await rollbackDerivedSources(derived);
			throw error;
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	function uniqueClipSources(clips) {
		return [...new Map(clips.map((clip) => {
			const source = findSource(project, clip.sourceId);
			return [source?.id, source];
		})).values()].filter(Boolean);
	}

	async function sourceChannelsForEdit(source) {
		const buffer = sourceBuffers.get(source.id);
		return buffer ? audioBufferChannels(buffer) : loadStoredSourceChannels(store, source);
	}

	async function persistDerivedSource(template, channels, name, idPrefix = 'derived-source') {
		const sampleRate = template.sampleRate || projectSampleRate();
		const context = await engine.getAudioContext({ resume: false });
		const buffer = await bufferFromChannels(channels, sampleRate, context, copy);
		const sourceId = createStableId(idPrefix);
		const writer = await store.beginSourceWrite(sourceId, {
			name,
			mimeType: template.mimeType || 'audio/wav',
			sampleRate,
			channelCount: channels.length,
			chunkFrames: SOURCE_CHUNK_FRAMES,
		});
		try {
			await writeBuffer(writer, buffer);
			await writer.commit({ sampleRate, channelCount: channels.length });
		} catch (error) {
			await writer.abort();
			throw error;
		}
		const source = {
			...template,
			id: sourceId,
			storageKey: sourceId,
			name,
			frameCount: channels[0].length,
			channelCount: channels.length,
			sampleRate,
			originalSampleRate: template.originalSampleRate || sampleRate,
		};
		cacheSourceBuffer(sourceId, buffer);
		try {
			const peaks = await generateWaveformPeaks(channels, copy);
			sourcePeaks.set(sourceId, peaks);
			await store.saveAnalysis(peakCacheKey(sourceId), peaks);
			return { source, buffer, channels };
		} catch (error) {
			sourceBuffers.delete(sourceId);
			sourcePeaks.delete(sourceId);
			await store.deleteSource(sourceId).catch(() => undefined);
			throw error;
		}
	}

	async function rollbackDerivedSources(records) {
		for (const { source } of records) {
			sourceBuffers.delete(source.id);
			sourceChunkProviders.delete(source.id);
			sourcePeaks.delete(source.id);
			await Promise.resolve(store.deleteAnalysis?.(peakCacheKey(source.id))).catch(() => undefined);
			await store.deleteSource(source.id).catch(() => undefined);
		}
	}

	function addLabel(trackId, labelOptions = {}) {
		if (editingBlocked()) return null;
		let target = trackId ? findTrack(project, trackId) : findTrack(project, state.selectedTrackId);
		if (target?.type !== 'label') {
			const createdTrackId = addLabelTrack();
			target = findTrack(project, createdTrackId);
		}
		const startFrame = snapTimelineFrame(labelOptions.startFrame ?? engine.getPositionFrames());
		const endFrame = snapTimelineFrame(labelOptions.endFrame ?? startFrame);
		const command = createAddLabelCommand(target.id, {
			...labelOptions,
			startFrame: Math.min(startFrame, endFrame),
			endFrame: Math.max(startFrame, endFrame),
		});
		commit(command, { selectTrackId: target.id });
		return command.label.id;
	}

	async function importLabelFile(file, importOptions = {}) {
		if (!file || editingBlocked()) return null;
		state.importing = true;
		publishDocumentSnapshot();
		setStatus(copy.labelsImporting);
		try {
			const data = typeof file.arrayBuffer === 'function' ? await file.arrayBuffer() : await file.text();
			const parsed = parseAudioEditorLabels(data, {
				filename: file.name,
				format: importOptions.format,
				sampleRate: projectSampleRate(),
				strict: importOptions.strict,
				idFactory: () => createStableId('label'),
			});
			if (!parsed.labels.length) throw new Error(copy.labelsImportEmpty);
			const trackId = createStableId('label-track');
			commit(createAddLabelTrackCommand({
				id: trackId,
				name: String(importOptions.name || stripExtension(file.name) || copy.labels).trim(),
				labels: parsed.labels,
			}), { selectTrackId: trackId });
			setStatus(copy.labelsImported.replace('{count}', String(parsed.labels.length)), parsed.warnings.length ? 'info' : 'success');
			return { ...parsed, trackId };
		} finally {
			state.importing = false;
			publishDocumentSnapshot();
		}
	}

	async function exportLabels(exportOptions = {}) {
		const requestedIds = Array.isArray(exportOptions.trackIds) ? new Set(exportOptions.trackIds) : null;
		let tracks = project.tracks.filter((track) => track.type === 'label' && (!requestedIds || requestedIds.has(track.id)));
		const selected = tracks.find((track) => track.id === state.selectedTrackId);
		if (!requestedIds && selected) tracks = [selected];
		if (!tracks.length) throw new Error(copy.labelTrackMissing);
		const format = String(exportOptions.format || 'txt').toLowerCase().replace(/^\./, '');
		const labels = tracks.flatMap((track) => track.labels);
		const text = serializeAudioEditorLabels(labels, { format, sampleRate: projectSampleRate() });
		const fileName = labelExportFileName(exportOptions.fileName || project.title, format);
		const result = Object.freeze({
			format,
			fileName,
			mimeType: labelMimeType(format),
			text,
			labelCount: labels.length,
			trackIds: Object.freeze(tracks.map((track) => track.id)),
		});
		const saved = exportOptions.download !== false
			? await saveLabelExport(result, options.saveLabelFile, fileService)
			: null;
		if (saved?.cancelled) return { ...result, cancelled: true };
		setStatus(copy.labelsExported.replace('{count}', String(labels.length)), 'success');
		return result;
	}

	function handleEdit(action) {
		if (!state.history || editingBlocked()) return;
		try {
			if (action === 'undo') {
				state.videoEffectGestures.clear();
				state.history = undoEditorCommand(state.history);
				projectChanged();
				return;
			}
			if (action === 'redo') {
				state.videoEffectGestures.clear();
				state.history = redoEditorCommand(state.history);
				projectChanged();
				return;
			}
			const audioTrackIds = project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
			const selectedTrack = findTrack(project, state.selectedTrackId);
			const baseSelection = activeSelection();
			const editingSelection = resolveEditingSelection(project, { selectedClipId: state.selectedClipId });
			const selectedClipCandidates = editingSelection?.kind === 'clips' ? editingSelection.clipIds : [];
			const selectedClips = selectedClipCandidates
				.map((clipId) => findClip(project, clipId))
				.filter(Boolean);
			const selectedClipIds = selectedClips.map((clip) => clip.id);
			const selectedClipRange = editingSelection?.kind === 'clips'
				? {
					startFrame: editingSelection.startFrame,
					endFrame: editingSelection.endFrame,
					clipIds: selectedClipIds,
				}
				: null;
			const selection = baseSelection || (selectedClipRange && selectedClipRange.endFrame > selectedClipRange.startFrame ? selectedClipRange : null);
			const selectedClipTrackIds = [...new Set(selectedClips
				.map((clip) => findClipTrack(project, clip.id)?.id)
				.filter(Boolean))];
			const rangeTrackIds = project.selection?.trackIds?.filter((trackId) => audioTrackIds.includes(trackId)) || selectedClipTrackIds;
			const trackIds = rangeTrackIds.length
				? rangeTrackIds
				: selectedTrack && Array.isArray(selectedTrack.clipIds) ? [selectedTrack.id] : audioTrackIds;
			const cutModes = {
				cut: 'none',
				'cut-leave-gap': 'none',
				'cut-per-clip-ripple': 'clip',
				'cut-per-track-ripple': 'track',
				'cut-all-tracks-ripple': 'track',
			};
			if (action === 'copy' || Object.hasOwn(cutModes, action)) {
				if (!selection) throw new Error(copy.timeSelectionRequired);
				const exactClipSelection = !baseSelection && selectedClipIds.length > 0;
				const exactClipEdit = exactClipSelection && action !== 'cut-all-tracks-ripple';
				const affectedTrackIds = action === 'cut-all-tracks-ripple' ? audioTrackIds : trackIds;
				const clipboardOptions = {
					...selection,
					trackIds: exactClipSelection ? selectedClipTrackIds : affectedTrackIds,
					...(exactClipSelection ? { clipIds: selectedClipIds } : {}),
				};
				if (action === 'copy') {
					setSessionClipboard(createClipboardDescriptor(project, clipboardOptions));
					compactLiveSourceState();
					void garbageCollectSources().catch(handleError);
				}
				else {
					setSessionClipboard(createClipboardDescriptor(project, clipboardOptions));
					commit(exactClipEdit
						? {
							type: 'clip/remove-many',
							clipIds: selectedClipIds,
							rippleMode: cutModes[action],
						}
						: !baseSelection && action === 'cut-all-tracks-ripple'
							? prepareDisjointRangeDeleteCommand(project, {
								ranges: editingSelection.ranges,
								trackIds: audioTrackIds,
								rippleMode: 'track',
							})
						: prepareRangeDeleteCommand(project, {
							...selection,
							trackIds: affectedTrackIds,
							rippleMode: cutModes[action],
						}));
					if (!baseSelection) state.selectedClipId = null;
				}
				publishDocumentSnapshot();
				return;
			}
			if (['paste', 'paste-overlap', 'paste-insert', 'paste-all-tracks-ripple'].includes(action)) {
				if (!state.clipboard) return;
				const mode = action === 'paste-insert'
					? 'insert-track'
					: action === 'paste-all-tracks-ripple'
						? 'insert-all'
						: 'overlap';
				commit(prepareControllerPaste(mode));
				return;
			}
			if (action === 'duplicate') {
				if (!selection) throw new Error(copy.timeSelectionRequired);
				const exactClipEdit = !baseSelection && selectedClipIds.length > 0;
				setSessionClipboard(createClipboardDescriptor(project, {
					...selection,
					trackIds: exactClipEdit ? selectedClipTrackIds : trackIds,
					...(exactClipEdit ? { clipIds: selectedClipIds } : {}),
				}));
				const duplicateCommand = prepareControllerPaste('overlap', selection.endFrame);
				if (exactClipEdit) {
					const pasteCommand = duplicateCommand.type === 'clipboard/paste'
						? duplicateCommand
						: duplicateCommand.commands.find((command) => command.type === 'clipboard/paste');
					const pastedClipIds = Object.values(pasteCommand?.clipIds || {});
					const pastedTrackIds = [...new Set(Object.values(pasteCommand?.trackMap || {}))];
					commit({
						type: 'batch',
						commands: [
							...(duplicateCommand.type === 'batch' ? duplicateCommand.commands : [duplicateCommand]),
							{
								type: 'selection/set',
								startFrame: 0,
								endFrame: 0,
								trackIds: pastedTrackIds,
								clipIds: pastedClipIds,
								frequencyRange: null,
							},
						],
					}, { selectClipId: pastedClipIds[0] || null });
				} else commit(duplicateCommand);
				return;
			}
			if (action === 'split') {
				const boundaries = baseSelection
					? [baseSelection.startFrame, baseSelection.endFrame]
					: [normalizeTimelineFrame(engine.getPositionFrames())];
				commitSplitAtFrames(boundaries);
				return;
			}
			if (action === 'split-new-track') {
				const clip = state.selectedClipId ? findClip(project, state.selectedClipId) : null;
				const sourceTrack = clip ? findClipTrack(project, clip.id) : null;
				if (!clip || !sourceTrack) return;
				if (clip.avLinkId || clip.kind === 'video') return;
				const atFrame = engine.getPositionFrames();
				const split = prepareSplitCommand(clip.id, atFrame);
				const trackId = createStableId('track');
				commit({
					type: 'batch',
					commands: [
						createAddTrackCommand({ ...sourceTrack, schemaVersion: project.schemaVersion, id: trackId, name: `${sourceTrack.name} 2`, clipIds: [], effects: [] }),
						split,
						{ type: 'clip/move', clipId: split.rightClipId, trackId, timelineStartFrame: atFrame },
					],
				}, { selectTrackId: trackId, selectClipId: split.rightClipId });
				return;
			}
			if (action === 'join' && selectedClipIds.length > 1) {
				commit({ type: 'clip/join', clipIds: selectedClipIds }, { selectClipId: selectedClipIds[0] });
				return;
			}
			if (action === 'group' && selectedClipIds.length > 1) {
				commit(prepareGroupClipsCommand(selectedClipIds));
				return;
			}
			if (action === 'ungroup' && selectedClipIds.length) {
				commit({ type: 'clip/ungroup', clipIds: selectedClipIds });
				return;
			}
			if (action === 'trim-outside-selection' && baseSelection) {
				commit(prepareKeepRangeCommand(project, { ...baseSelection, trackIds }));
				return;
			}
			const deleteModes = {
				delete: 'none',
				'delete-leave-gap': 'none',
				'ripple-delete': 'track',
				'delete-per-clip-ripple': 'clip',
				'delete-per-track-ripple': 'track',
				'delete-all-tracks-ripple': 'track',
			};
			if (
				!baseSelection
				&& selectedClipIds.length
				&& Object.hasOwn(deleteModes, action)
				&& action !== 'delete-all-tracks-ripple'
			) {
				commit({
					type: 'clip/remove-many',
					clipIds: selectedClipIds,
					rippleMode: deleteModes[action],
				});
				state.selectedClipId = null;
				return;
			}
			if (selection && Object.hasOwn(deleteModes, action)) {
				commit(!baseSelection && action === 'delete-all-tracks-ripple'
					? prepareDisjointRangeDeleteCommand(project, {
						ranges: editingSelection.ranges,
						trackIds: audioTrackIds,
						rippleMode: 'track',
					})
					: prepareRangeDeleteCommand(project, {
						...selection,
						trackIds: action === 'delete-all-tracks-ripple' ? audioTrackIds : trackIds,
						rippleMode: deleteModes[action],
					}));
				if (!baseSelection) state.selectedClipId = null;
			}
		} catch (error) {
			handleError(error);
		}
	}

	function setSessionClipboard(descriptor) {
		const result = sessionController.setClipboard(descriptor, { originProjectId: project.id });
		state.clipboard = result.clipboard.descriptor;
		return state.clipboard;
	}

	function splitAtFrame(requestedFrame, requestedTrackIds = null) {
		if (editingBlocked()) return null;
		const frame = snapTimelineFrame(normalizeTimelineFrame(requestedFrame));
		return commitSplitAtFrames([frame], requestedTrackIds);
	}

	function commitSplitAtFrames(requestedFrames, requestedTrackIds = null) {
		const targetClipIds = collectSplitTargetClipIds(requestedTrackIds);
		const frames = [...new Set(requestedFrames
			.map((frame) => normalizeTimelineFrame(frame)))]
			.sort((left, right) => right - left);
		const commands = [];
		const handledLinks = new Set();
		for (const clipId of targetClipIds) {
			const clip = findClip(project, clipId);
			if (!clip) continue;
			if (clip.avLinkId && handledLinks.has(clip.avLinkId)) continue;
			if (clip.avLinkId) handledLinks.add(clip.avLinkId);
			const clipEndFrame = clip.timelineStartFrame + clip.durationFrames;
			for (const frame of frames) {
				if (frame <= clip.timelineStartFrame || frame >= clipEndFrame) continue;
				// Descending boundaries keep the original ID on the left, so a
				// second boundary can split that same clip in one atomic batch.
				commands.push(prepareLinkedSplitCommand(project, clip.id, frame));
			}
		}
		if (!commands.length) return null;
		const command = commands.length === 1 ? commands[0] : { type: 'batch', commands };
		return commit(command);
	}

	function collectSplitTargetClipIds(requestedTrackIds = null) {
		if (requestedTrackIds != null) {
			const trackIds = new Set((Array.isArray(requestedTrackIds) ? requestedTrackIds : [requestedTrackIds]).filter(Boolean));
			return project.tracks
				.filter((track) => trackIds.has(track.id) && Array.isArray(track.clipIds))
				.flatMap((track) => track.clipIds);
		}

		const selectedClipIds = state.selectedClipId
			? project.selection?.clipIds?.filter((clipId) => findClip(project, clipId)) || []
			: [];
		const seedClipIds = selectedClipIds.length
			? selectedClipIds
			: state.selectedClipId && findClip(project, state.selectedClipId) ? [state.selectedClipId] : [];
		if (seedClipIds.length) {
			const targetIds = new Set(seedClipIds.flatMap((clipId) => collectClipTransformIds(project, clipId)));
			return project.clips.filter((clip) => targetIds.has(clip.id)).map((clip) => clip.id);
		}

		const selectedTrackIds = project.selection?.trackIds?.length
			? project.selection.trackIds
			: state.selectedTrackId ? [state.selectedTrackId] : [];
		const trackIds = new Set(selectedTrackIds);
		return project.tracks
			.filter((track) => trackIds.has(track.id) && Array.isArray(track.clipIds))
			.flatMap((track) => track.clipIds);
	}

	function prepareControllerPaste(mode, atFrame = engine.getPositionFrames()) {
		const trackMap = {};
		const sessionClipboard = sessionController.clipboardForProject(project.id);
		const commands = (sessionClipboard?.sources || [])
			.filter((source) => !findSource(project, source.id))
			.map((source) => createAddSourceCommand(source));
		let addedTrackCount = 0;
		const usedTrackIds = new Set();
		const selected = findTrack(project, state.selectedTrackId);
		const clipboardTracks = state.clipboard.tracks || [];
		const clipboardTrackType = (clipboardTrack) => (
			clipboardTrack.sourceTrackType
			|| clipboardTrack.clips?.[0]?.kind
			|| 'audio'
		);
		const targetMatches = (target, clipboardTrack) => Boolean(
			target
			&& Array.isArray(target.clipIds)
			&& target.type === clipboardTrackType(clipboardTrack)
			&& !usedTrackIds.has(target.id)
		);
		const assignTarget = (clipboardTrack, target) => {
			trackMap[clipboardTrack.sourceTrackId] = target.id;
			usedTrackIds.add(target.id);
		};
		const laneGroups = new Map();
		for (const clipboardTrack of clipboardTracks) {
			if (!clipboardTrack.sourceLaneGroupId) continue;
			const grouped = laneGroups.get(clipboardTrack.sourceLaneGroupId) || [];
			grouped.push(clipboardTrack);
			laneGroups.set(clipboardTrack.sourceLaneGroupId, grouped);
		}
		const findTargetLanePair = (candidate) => {
			if (!candidate?.laneGroupId) return null;
			const grouped = project.tracks.filter((track) => track.laneGroupId === candidate.laneGroupId);
			if (
				grouped.length !== 2
				|| grouped[0].type !== 'video'
				|| grouped[1].type !== 'audio'
				|| grouped.some((track) => usedTrackIds.has(track.id))
			) return null;
			return grouped;
		};
		const createTargetTrack = (clipboardTrack, laneGroupId = null) => {
			const type = clipboardTrackType(clipboardTrack);
			if (type === 'video' && project.schemaVersion < 4) {
				throw new RangeError('Video clipboard tracks require an AudioEditorProjectV4 project.');
			}
			const trackId = createStableId(type === 'video' ? 'video-track' : 'track');
			addedTrackCount += 1;
			commands.push(createAddTrackCommand({
				schemaVersion: project.schemaVersion,
				type,
				id: trackId,
				name: clipboardTrack.sourceTrackName || `${copy.track} ${project.tracks.length + addedTrackCount}`,
				laneGroupId,
			}));
			return { id: trackId, type, laneGroupId, clipIds: [] };
		};

		for (const [index, clipboardTrack] of clipboardTracks.entries()) {
			if (trackMap[clipboardTrack.sourceTrackId]) continue;
			const grouped = clipboardTrack.sourceLaneGroupId
				? laneGroups.get(clipboardTrack.sourceLaneGroupId)
				: null;
			const videoClipboardTrack = grouped?.find((track) => clipboardTrackType(track) === 'video');
			const audioClipboardTrack = grouped?.find((track) => clipboardTrackType(track) === 'audio');
			if (grouped?.length === 2 && videoClipboardTrack && audioClipboardTrack) {
				const existingVideo = findTrack(project, videoClipboardTrack.sourceTrackId);
				const existingAudio = findTrack(project, audioClipboardTrack.sourceTrackId);
				let targetPair = (
					targetMatches(existingVideo, videoClipboardTrack)
					&& targetMatches(existingAudio, audioClipboardTrack)
					&& existingVideo.laneGroupId
					&& existingVideo.laneGroupId === existingAudio.laneGroupId
				) ? [existingVideo, existingAudio] : null;
				if (
					!targetPair
					&& (
						targetMatches(selected, videoClipboardTrack)
						|| targetMatches(selected, audioClipboardTrack)
					)
				) {
					targetPair = findTargetLanePair(selected);
				}
				if (!targetPair) {
					const laneGroupId = createStableId('media-lanes');
					targetPair = [
						createTargetTrack(videoClipboardTrack, laneGroupId),
						createTargetTrack(audioClipboardTrack, laneGroupId),
					];
				}
				assignTarget(videoClipboardTrack, targetPair[0]);
				assignTarget(audioClipboardTrack, targetPair[1]);
				continue;
			}

			let target = findTrack(project, clipboardTrack.sourceTrackId);
			if (!targetMatches(target, clipboardTrack)) target = null;
			if (!target && index === 0 && targetMatches(selected, clipboardTrack)) target = selected;
			if (!target) target = createTargetTrack(clipboardTrack);
			assignTarget(clipboardTrack, target);
		}
		commands.push(preparePasteCommand(state.clipboard, { project, atFrame, trackMap, mode }));
		return commands.length === 1 ? commands[0] : { type: 'batch', commands };
	}

	async function disjoinSelectedClip() {
		if (editingBlocked()) return;
		const clip = state.selectedClipId ? findClip(project, state.selectedClipId) : null;
		const buffer = clip ? sourceBuffers.get(clip.sourceId) : null;
		if (!clip || !buffer) return;
		const sourceDurationFrames = clip.sourceDurationFrames ?? clip.durationFrames;
		const minimumSilenceFrames = Math.max(1, Math.round(buffer.sampleRate * 0.01));
		const regions = [];
		let silenceStart = null;
		for (let relativeSourceFrame = 0; relativeSourceFrame < sourceDurationFrames; relativeSourceFrame += 1) {
			const sourceFrame = clip.reversed
				? clip.sourceStartFrame + sourceDurationFrames - 1 - relativeSourceFrame
				: clip.sourceStartFrame + relativeSourceFrame;
			let peak = 0;
			for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
				peak = Math.max(peak, Math.abs(buffer.getChannelData(channel)[sourceFrame] || 0));
			}
			if (peak <= 0.001) silenceStart ??= relativeSourceFrame;
			else if (silenceStart != null) {
				if (relativeSourceFrame - silenceStart >= minimumSilenceFrames) regions.push([silenceStart, relativeSourceFrame]);
				silenceStart = null;
			}
		}
		if (silenceStart != null && sourceDurationFrames - silenceStart >= minimumSilenceFrames) regions.push([silenceStart, sourceDurationFrames]);
		const timelineRegions = regions.map(([start, end]) => [
			clip.timelineStartFrame + Math.round(start / sourceDurationFrames * clip.durationFrames),
			clip.timelineStartFrame + Math.round(end / sourceDurationFrames * clip.durationFrames),
		]).filter(([start, end]) => start > clip.timelineStartFrame && end < clip.timelineStartFrame + clip.durationFrames && end > start)
			.slice(0, 128);
		if (!timelineRegions.length) {
			setStatus(copy.noSilencesFound, 'info');
			return;
		}
		const commands = [];
		if (clip.avLinkId) commands.push({ type: 'clip/unlink-av', clipId: clip.id });
		for (const [startFrame, endFrame] of timelineRegions.reverse()) {
			const after = prepareSplitCommand(clip.id, endFrame);
			const silence = prepareSplitCommand(clip.id, startFrame);
			commands.push(after, silence, { type: 'clip/remove', clipId: silence.rightClipId });
		}
		commit({ type: 'batch', commands }, { selectClipId: clip.id });
	}

	async function generateSelectionSilence() {
		const selection = activeSelection();
		if (!selection) {
			const targets = audacityEffectTargets();
			if (!targets.length) throw new Error(copy.timeSelectionRequired);
			const results = targets.map((target) => ({
				target,
				channels: Array.from({ length: target.channelCount }, () => new Float32Array(target.durationFrames)),
			}));
			await preflightStorage(results.reduce((sum, result) => (
				sum + result.target.durationFrames * result.target.channelCount * Float32Array.BYTES_PER_ELEMENT
			), 0), 'effect');
			state.audacityEffectProcessing = true;
			setStatus(copy.generatingAudio);
			publishDocumentSnapshot();
			try {
				await persistAudacityEffectResults(results, null, { effectName: copy.silenceAudio });
				setStatus(copy.done, 'success');
				return true;
			} finally {
				state.audacityEffectProcessing = false;
				publishDocumentSnapshot();
			}
		}
		return generateSignal('silence', { durationSeconds: (selection.endFrame - selection.startFrame) / projectSampleRate() });
	}

	async function generateSignal(type, generatorOptions = {}) {
		if (editingBlocked()) return;
		const selection = activeSelection();
		let targetTrack = findTrack(project, generatorOptions.trackId || state.selectedTrackId);
		if (targetTrack?.type !== 'audio') targetTrack = project.tracks.find((track) => track.type === 'audio') || null;
		const sampleRate = projectSampleRate();
		const durationSeconds = generatorOptions.durationSeconds
			?? (selection ? (selection.endFrame - selection.startFrame) / sampleRate : 30);
		const channelCount = Number(generatorOptions.channelCount
			|| audioTrackChannelCountV2(project, targetTrack, project.masterChannels || 2));
		const generated = generateAudioEditorSignal(type, {
			...generatorOptions,
			durationSeconds,
			sampleRate,
			channelCount,
		});
		await preflightStorage(generated.frameCount * generated.channelCount * Float32Array.BYTES_PER_ELEMENT, 'effect');
		state.audacityEffectProcessing = true;
		setStatus(copy.generatingAudio);
		publishDocumentSnapshot();
		const sourceId = createStableId('generator');
		const name = generatorName(type, copy);
		const context = await engine.getAudioContext({ resume: false });
		const buffer = await bufferFromChannels(generated.channels, sampleRate, context, copy);
		const writer = await store.beginSourceWrite(sourceId, {
			name,
			mimeType: 'audio/wav',
			sampleRate,
			channelCount,
			chunkFrames: SOURCE_CHUNK_FRAMES,
		});
		try {
			await writeBuffer(writer, buffer);
			await writer.commit({ sampleRate, channelCount });
			const source = {
				schemaVersion: 2,
				sampleRate,
				sampleFormat: 'float32',
				chunkFrames: SOURCE_CHUNK_FRAMES,
				id: sourceId,
				storageKey: sourceId,
				name,
				mimeType: 'audio/wav',
				frameCount: generated.frameCount,
				channelCount,
				originalSampleRate: sampleRate,
			};
			let command;
			let selectedClipId;
			if (selection && targetTrack) {
				const replacement = prepareRangeReplacementCommand(project, {
					trackId: targetTrack.id,
					startFrame: selection.startFrame,
					endFrame: selection.endFrame,
					source,
				});
				selectedClipId = replacement.clipId;
				command = replacement;
			} else {
				const startFrame = snapTimelineFrame(generatorOptions.atFrame ?? selection?.startFrame ?? engine.getPositionFrames());
				const endFrame = startFrame + generated.frameCount;
				if (!targetTrack || targetTrack.clipIds.some((clipId) => {
					const clip = findClip(project, clipId);
					return clip && clip.timelineStartFrame < endFrame && clip.timelineStartFrame + clip.durationFrames > startFrame;
				})) {
					const trackId = createStableId('track');
					targetTrack = { id: trackId };
					command = { type: 'batch', commands: [
						createAddSourceCommand(source),
						createAddTrackCommand({
							schemaVersion: 2,
							type: 'audio',
							id: trackId,
							name,
						}),
					] };
				} else command = { type: 'batch', commands: [createAddSourceCommand(source)] };
				selectedClipId = createStableId('clip');
				command.commands.push(createAddClipCommand(targetTrack.id, {
					schemaVersion: 2,
					title: name,
					sourceDurationFrames: generated.frameCount,
					id: selectedClipId,
					sourceId,
					timelineStartFrame: startFrame,
					sourceStartFrame: 0,
					durationFrames: generated.frameCount,
				}));
			}
			cacheSourceBuffer(sourceId, buffer);
			const peaks = await generateWaveformPeaks(generated.channels, copy);
			sourcePeaks.set(sourceId, peaks);
			await store.saveAnalysis(peakCacheKey(sourceId), peaks);
			commit(command, { selectTrackId: targetTrack.id, selectClipId: selectedClipId });
			setStatus(copy.done, 'success');
			return selectedClipId;
		} catch (error) {
			await Promise.resolve(writer.abort()).catch(() => undefined);
			sourceBuffers.delete(sourceId);
			sourcePeaks.delete(sourceId);
			await store.deleteSource(sourceId).catch(() => undefined);
			throw error;
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	function setPlayAtSpeedRate(value) {
		const rate = Number(value);
		if (!Number.isFinite(rate) || rate < 0.5 || rate > 2) {
			throw new RangeError('Playback speed must be between 0.5 and 2.');
		}
		state.playAtSpeedRate = rate;
		publishDocumentSnapshot();
		return rate;
	}

	function cancelPlayAtSpeedPreparation({ status = false } = {}) {
		const active = state.playAtSpeedAbort;
		state.playAtSpeedGeneration += 1;
		state.playAtSpeedAbort = null;
		active?.abort();
		if (active) {
			if (status) setStatus(copy.ready);
			else publishDocumentSnapshot();
		}
		return Boolean(active);
	}

	async function handlePlayAtSpeed(requestedRate = state.playAtSpeedRate) {
		if (state.recordingStarting || state.timedRecordingPreparing || state.timedRecording || state.recorder) return false;
		if (hasMissingTimelineSources()) throw new Error(copy.localSourcesMissing);
		const rate = setPlayAtSpeedRate(requestedRate);
		const currentPlayback = engine.getState();
		const playAtSpeedActive = currentPlayback.state === 'playing'
			&& ['naive', 'staffpad'].includes(currentPlayback.playbackMode);
		if (playAtSpeedActive) {
			cancelPlaybackCachePreparation();
			return engine.pause();
		}
		if (state.playAtSpeedAbort) {
			cancelPlayAtSpeedPreparation({ status: true });
			return false;
		}
		if (currentPlayback.state === 'playing') engine.pause();
		const preservePitch = state.preferences.playback?.playAtSpeedMode === 'staffpad';
		if (preservePitch) assertPlayAtSpeedStaffPadMemorySafe(
			projectDurationFrames(project),
			projectSampleRate(),
			rate,
		);
		const snapshot = project;
		const generation = ++state.playAtSpeedGeneration;
		const abort = new AbortController();
		state.playAtSpeedAbort = abort;
		if (preservePitch) setStatus(copy.playAtSpeedPreparing);
		else publishDocumentSnapshot();
		try {
			await beginPlaybackCachePreparation(snapshot, { abortController: abort });
			throwIfAborted(abort.signal);
			if (snapshot !== project) throw createAbortError();
			if (typeof engine.playAtSpeed !== 'function') return engine.play();
			await engine.playAtSpeed(rate, {
				preservePitch,
				pitchPreserver: playAtSpeedPitchPreserver,
				signal: abort.signal,
			});
			if (generation === state.playAtSpeedGeneration && !abort.signal.aborted) {
				setStatus(copy.playAtSpeedPlaying.replace('{rate}', formatPlaybackRate(rate)), 'success');
			}
			return true;
		} catch (error) {
			if (error?.name === 'AbortError' || abort.signal.aborted) return false;
			throw error;
		} finally {
			if (generation === state.playAtSpeedGeneration) {
				state.playAtSpeedAbort = null;
				publishDocumentSnapshot();
			}
		}
	}

	async function handleTransport(action) {
		if ((state.recordingStarting || state.timedRecordingPreparing || state.timedRecording || state.recorder)
			&& action !== 'stop' && action !== 'record') return;
		if ((action === 'play' || action === 'record') && state.projectBinPreview) {
			await stopProjectBinPreview();
		}
		if (hasMissingTimelineSources() && action === 'play') throw new Error(copy.localSourcesMissing);
		if (action === 'play') {
			cancelPlayAtSpeedPreparation();
			if (engine.getState().state === 'playing') {
				cancelPlaybackCachePreparation();
				return engine.pause();
			}
			if (state.playbackCacheAbort) {
				cancelPlaybackCachePreparation();
				return;
			}
			const snapshot = project;
			await beginPlaybackCachePreparation(snapshot);
			if (snapshot !== project) return;
			return engine.play();
		}
		if (action === 'stop') {
			cancelPlaybackCachePreparation();
			cancelPlayAtSpeedPreparation();
			if (state.timedRecording || state.timedRecordingPreparing) return cancelTimedRecording();
			return state.recorder ? stopRecording() : engine.stop();
		}
		if (action === 'jump-start') return engine.seek(0);
		if (action === 'jump-end') return engine.seek(editorTimelineDurationFrames(project, projectSampleRate()));
		if (action === 'rewind') return engine.seek(engine.getPositionFrames() - projectSampleRate() * 5);
		if (action === 'forward') return engine.seek(engine.getPositionFrames() + projectSampleRate() * 5);
		if (action === 'loop') {
			const selection = activeSelection();
			const enabled = !project?.loop?.enabled;
			const storedLoop = project.loop?.endFrame > project.loop?.startFrame
				? project.loop
				: null;
			const range = storedLoop || selection || {
				startFrame: 0,
				endFrame: Math.max(1, Math.round(projectSampleRate() * 4)),
			};
			const next = commitLoopRange({ ...range, enabled });
			engine.setLoop(next.loop);
			return;
		}
		if (action === 'record') return state.recorder ? stopRecording() : startRecording();
	}

	function clearLoopRegion() {
		const current = project.loop || { startFrame: 0, endFrame: 0 };
		const next = commit({ type: 'loop/set', enabled: false, ...current });
		engine.setLoop(next.loop);
		return next.loop;
	}

	function setLoopRegionToSelection() {
		const selection = activeSelection();
		if (!selection) throw new Error(copy.timeSelectionRequired);
		const next = commitLoopRange({ enabled: true, ...selection });
		engine.setLoop(next.loop);
		return next.loop;
	}

	function setLoopRegion(startFrame, endFrame) {
		const start = normalizeTimelineFrame(Math.min(startFrame, endFrame));
		const end = normalizeTimelineFrame(Math.max(startFrame, endFrame));
		if (end <= start) throw new Error(copy.timeSelectionRequired);
		const next = commitLoopRange({ enabled: true, startFrame: start, endFrame: end });
		engine.setLoop(next.loop);
		return next.loop;
	}

	function setSelectionToLoopRegion() {
		const loop = project.loop;
		if (!loop?.enabled || loop.endFrame <= loop.startFrame) throw new Error(copy.timeSelectionRequired);
		return setSelection(loop.startFrame, loop.endFrame);
	}

	function setLoopRegionInOut() {
		const selection = activeSelection();
		if (selection) return setLoopRegionToSelection();
		const startFrame = normalizeTimelineFrame(engine.getPositionFrames());
		const endFrame = projectDurationFrames(project);
		if (endFrame <= startFrame) throw new Error(copy.timeSelectionRequired);
		const next = commitLoopRange({ enabled: true, startFrame, endFrame });
		engine.setLoop(next.loop);
		return next.loop;
	}

	function toggleSelectionFollowsLoop() {
		state.selectionFollowsLoop = !state.selectionFollowsLoop;
		void store.saveSetting(productSettingKey('selection-follows-loop'), state.selectionFollowsLoop);
		if (state.selectionFollowsLoop && project.loop?.enabled) setSelectionToLoopRegion();
		else publishDocumentSnapshot();
		return state.selectionFollowsLoop;
	}

	function commitLoopRange(range) {
		const loopCommand = { type: 'loop/set', ...range };
		if (!range.enabled || !state.selectionFollowsLoop) return commit(loopCommand);
		const selection = project.selection || {};
		return commit({
			type: 'batch',
			commands: [loopCommand, {
				type: 'selection/set',
				startFrame: range.startFrame,
				endFrame: range.endFrame,
				...(project.schemaVersion >= 2 ? {
					trackIds: selection.trackIds || [],
					clipIds: selection.clipIds || [],
					frequencyRange: selection.frequencyRange || null,
				} : {}),
			}],
		});
	}

	function toggleMetronome() {
		state.metronomeEnabled = !state.metronomeEnabled;
		void store.saveSetting(productSettingKey('transport-metronome'), state.metronomeEnabled);
		syncMetronome();
		publishDocumentSnapshot();
		return state.metronomeEnabled;
	}

	function syncMetronome() {
		stopMetronome();
		if (!state.metronomeEnabled || !['playing', 'recording'].includes(state.transportState)) return;
		void scheduleMetronomeClick();
	}

	async function scheduleMetronomeClick() {
		if (!state.metronomeEnabled || !['playing', 'recording'].includes(state.transportState) || state.disposed) return;
		const bpm = Math.max(1, Number(project?.tempo?.bpm) || 120);
		const sampleRate = projectSampleRate();
		const position = Math.max(0, engine.getPositionFrames());
		const playbackRate = state.transportState === 'playing'
			? Number(engine.getState?.().playbackRate) || 1
			: 1;
		const {
			beatIndex,
			delaySeconds,
			beatDurationSeconds,
		} = calculateAudioEditorMetronomeSchedule({ bpm, sampleRate, positionFrame: position, playbackRate });
		try {
			const context = await engine.getAudioContext?.({ resume: false });
			if (context?.createOscillator && context?.createGain && context.destination) {
				const oscillator = context.createOscillator();
				const gain = context.createGain();
				const numerator = Math.max(1, Number(project?.tempo?.timeSignature?.numerator) || 4);
				const when = context.currentTime + delaySeconds;
				oscillator.frequency.setValueAtTime(beatIndex % numerator === 0 ? 1320 : 880, when);
				gain.gain.setValueAtTime(0.0001, when);
				gain.gain.exponentialRampToValueAtTime(0.12, when + 0.002);
				gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
				oscillator.connect(gain);
				gain.connect(context.destination);
				oscillator.start(when);
				oscillator.stop(when + 0.04);
				oscillator.onended = () => {
					try { oscillator.disconnect(); } catch { /* Already disconnected. */ }
					try { gain.disconnect(); } catch { /* Already disconnected. */ }
				};
			}
		} catch {
			// A missing oscillator API must not interrupt transport or recording.
		}
		const delayMs = Math.max(10, (delaySeconds + beatDurationSeconds) * 1000);
		state.metronomeTimer = globalThis.setTimeout(() => {
			state.metronomeTimer = 0;
			void scheduleMetronomeClick();
		}, delayMs);
		state.metronomeTimer?.unref?.();
	}

	function stopMetronome() {
		globalThis.clearTimeout(state.metronomeTimer);
		state.metronomeTimer = 0;
	}

	function normalizeTimelineFrame(value) {
		const maximum = project ? projectDurationFrames(project) : 0;
		const frame = Number(value);
		if (!Number.isFinite(frame)) throw new TypeError(copy.timelineFramesFinite);
		return Math.max(0, Math.min(maximum, Math.round(frame)));
	}

	function normalizePlaybackFrame(value) {
		const maximum = project ? editorTimelineDurationFrames(project, projectSampleRate()) : 0;
		const frame = Number(value);
		if (!Number.isFinite(frame)) throw new TypeError(copy.timelineFramesFinite);
		return Math.max(0, Math.min(maximum, Math.round(frame)));
	}

	function projectSampleRate() {
		return Number.isSafeInteger(project?.sampleRate) && project.sampleRate > 0
			? project.sampleRate
			: AUDIO_EDITOR_SAMPLE_RATE;
	}

	function selectTrack(trackId) {
		if (trackId != null && !findTrack(project, trackId)) throw new Error(copy.audioTrackNotFound);
		const changed = state.selectedTrackId !== (trackId || null);
		state.selectedTrackId = trackId || null;
		state.selectedClipId = null;
		if (changed) {
			routedInputLoudnessMeter = null;
			routedInputLoudnessMeterKey = null;
			state.inputMeter = null;
		}
		synchronizeMicrophoneMeterTarget();
		publishProjectState();
	}

	function expandSelectedClipIds(rawClipIds) {
		return collectRelatedClipIds(project, rawClipIds || []);
	}

	function selectClip(clipId, options = {}) {
		if (clipId == null) {
			state.selectedClipId = null;
			if (project?.schemaVersion >= 2 && project.selection?.clipIds?.length) {
				const selection = project.selection;
				return updateSelection({
					type: 'selection/set',
					startFrame: selection.startFrame,
					endFrame: selection.endFrame,
					trackIds: [],
					clipIds: [],
					frequencyRange: selection.frequencyRange || null,
				});
			}
			publishProjectState();
			return null;
		}
		const clip = findClip(project, clipId);
		const track = clip ? findClipTrack(project, clip.id) : null;
		if (!clip || !track) throw new Error(copy.audioClipNotFound);
		if (project.schemaVersion < 2) {
			state.selectedTrackId = track.id;
			state.selectedClipId = clip.id;
			synchronizeMicrophoneMeterTarget();
			publishProjectState();
			return clip.id;
		}

		const currentClipIds = project.selection?.clipIds || [];
		let clipIds;
		if (options.toggle) {
			const toggledClipIds = new Set(expandSelectedClipIds([clip.id]));
			clipIds = currentClipIds.includes(clip.id)
				? currentClipIds.filter((selectedId) => !toggledClipIds.has(selectedId))
				: [...currentClipIds, ...toggledClipIds];
		} else if (options.additive) {
			clipIds = currentClipIds.includes(clip.id) ? currentClipIds : [...currentClipIds, clip.id];
		} else clipIds = [clip.id];
		const nextClipIds = expandSelectedClipIds(clipIds);
		const trackIds = [...new Set(nextClipIds.map((selectedId) => findClipTrack(project, selectedId)?.id).filter(Boolean))];
		const activeClipId = nextClipIds.includes(clip.id) ? clip.id : nextClipIds.at(-1) || null;
		const activeTrack = activeClipId ? findClipTrack(project, activeClipId) : null;
		state.selectedTrackId = activeTrack?.id || null;
		state.selectedClipId = activeClipId;
		updateSelection({
			type: 'selection/set',
			startFrame: 0,
			endFrame: 0,
			trackIds,
			clipIds: nextClipIds,
			frequencyRange: null,
		});
		return activeClipId;
	}

	function setSelection(startFrame, endFrame, details = {}) {
		if (!Number.isFinite(Number(startFrame)) || !Number.isFinite(Number(endFrame))) {
			throw new TypeError(copy.selectionFramesFinite);
		}
		const maximumFrame = project.tracks.length
			? editorTimelineDurationFrames(project, projectSampleRate())
			: projectDurationFrames(project);
		const clampSelectionFrame = (value) => Math.max(0, Math.min(maximumFrame, Math.round(Number(value))));
		const start = snapTimelineFrame(clampSelectionFrame(Math.min(Number(startFrame), Number(endFrame))), { maximumFrame });
		const end = snapTimelineFrame(clampSelectionFrame(Math.max(Number(startFrame), Number(endFrame))), { maximumFrame });
		state.selectedClipId = null;
		const command = { type: 'selection/set', startFrame: start, endFrame: end };
		if (Object.keys(details).length) Object.assign(command, details, { clipIds: [] });
		return updateSelection(command);
	}

	function selectAllTracks() {
		if (!project) return null;
		const selection = project.selection || { startFrame: 0, endFrame: 0 };
		const trackIds = project.tracks.map((track) => track.id);
		const next = setSelection(selection.startFrame, selection.endFrame, { trackIds });
		if (!state.selectedTrackId && trackIds.length) {
			state.selectedTrackId = trackIds[0];
			synchronizeMicrophoneMeterTarget();
		}
		return next.selection;
	}

	function selectLeftOfPlaybackPosition(requestedStartFrame = null) {
		const playbackFrame = normalizeTimelineFrame(engine.getPositionFrames());
		let startFrame = requestedStartFrame == null
			? (activeSelection()?.startFrame ?? 0)
			: normalizeTimelineFrame(requestedStartFrame);
		if (startFrame >= playbackFrame) startFrame = 0;
		return setSelection(startFrame, playbackFrame).selection;
	}

	function selectRightOfPlaybackPosition(requestedEndFrame = null) {
		const playbackFrame = normalizeTimelineFrame(engine.getPositionFrames());
		let endFrame = requestedEndFrame == null
			? (activeSelection()?.endFrame ?? projectDurationFrames(project))
			: normalizeTimelineFrame(requestedEndFrame);
		if (endFrame <= playbackFrame) endFrame = projectDurationFrames(project);
		return setSelection(playbackFrame, endFrame).selection;
	}

	function selectTrackStartToCursor() {
		const range = selectedTracksTimeRange();
		return setSelection(range?.startFrame ?? 0, normalizeTimelineFrame(engine.getPositionFrames())).selection;
	}

	function selectCursorToTrackEnd() {
		const range = selectedTracksTimeRange();
		const playbackFrame = normalizeTimelineFrame(engine.getPositionFrames());
		return range?.endFrame > playbackFrame
			? setSelection(playbackFrame, range.endFrame).selection
			: selectTrackStartToCursor();
	}

	function selectTrackStartToEnd() {
		const range = selectedTracksTimeRange();
		if (!range) return null;
		return setSelection(range.startFrame, range.endFrame).selection;
	}

	function selectedTracksTimeRange() {
		const requestedIds = project.selection?.trackIds?.length
			? project.selection.trackIds
			: state.selectedTrackId ? [state.selectedTrackId] : [];
		const tracks = requestedIds.map((trackId) => findTrack(project, trackId)).filter(Boolean);
		const ranges = [];
		for (const track of tracks) {
			if (track.type === 'label') {
				for (const label of track.labels || []) ranges.push([label.startFrame, label.endFrame]);
			} else {
				for (const clipId of track.clipIds || []) {
					const clip = findClip(project, clipId);
					if (clip) ranges.push([clip.timelineStartFrame, clip.timelineStartFrame + clip.durationFrames]);
				}
			}
		}
		if (!ranges.length && tracks.length) {
			return {
				startFrame: 0,
				endFrame: editorTimelineDurationFrames(project, projectSampleRate()),
			};
		}
		if (!ranges.length) return null;
		return {
			startFrame: Math.min(...ranges.map(([startFrame]) => startFrame)),
			endFrame: Math.max(...ranges.map(([, endFrame]) => endFrame)),
		};
	}

	function toggleRmsWaveform() {
		state.showRms = !state.showRms;
		void store.saveSetting(productSettingKey('waveform-show-rms'), state.showRms);
		publishDocumentSnapshot();
		return state.showRms;
	}

	function toggleVerticalRulers() {
		state.showVerticalRulers = !state.showVerticalRulers;
		void store.saveSetting(productSettingKey('timeline-show-vertical-rulers'), state.showVerticalRulers);
		publishDocumentSnapshot();
		return state.showVerticalRulers;
	}

	function toggleUpdateWhilePlaying() {
		state.updateDisplayWhilePlaying = !state.updateDisplayWhilePlaying;
		void store.saveSetting(productSettingKey('timeline-update-while-playing'), state.updateDisplayWhilePlaying);
		publishDocumentSnapshot();
		return state.updateDisplayWhilePlaying;
	}

	function togglePinnedPlayhead() {
		state.pinnedPlayhead = !state.pinnedPlayhead;
		void store.saveSetting(productSettingKey('timeline-pinned-playhead'), state.pinnedPlayhead);
		publishDocumentSnapshot();
		return state.pinnedPlayhead;
	}

	function toggleRulerPlayback() {
		state.playbackOnRulerClick = !state.playbackOnRulerClick;
		void store.saveSetting(productSettingKey('timeline-ruler-playback'), state.playbackOnRulerClick);
		publishDocumentSnapshot();
		return state.playbackOnRulerClick;
	}

	async function selectAtZeroCrossings() {
		const selection = activeSelection();
		if (!selection || state.analysisProcessing) return null;
		const radius = Math.max(1, Math.round(projectSampleRate() * 0.01));
		const renderStart = Math.max(0, selection.startFrame - radius);
		const renderEnd = Math.min(projectDurationFrames(project), selection.endFrame + radius);
		state.analysisProcessing = true;
		publishDocumentSnapshot();
		try {
			const rendered = await renderSnapshot(cloneProject(project), {
				startFrame: renderStart,
				endFrame: renderEnd,
				includeTail: false,
				outputFrames: renderEnd - renderStart,
			});
			const channels = audioBufferChannels(rendered);
			const startFrame = renderStart + findNearestAudioZeroCrossing(
				channels,
				selection.startFrame - renderStart,
				{ maximumDistance: radius },
			);
			const endFrame = renderStart + findNearestAudioZeroCrossing(
				channels,
				selection.endFrame - renderStart,
				{ maximumDistance: radius },
			);
			const next = commit({
				type: 'selection/set',
				startFrame: Math.min(startFrame, endFrame),
				endFrame: Math.max(startFrame, endFrame),
			});
			setStatus(copy.zeroCrossingsAligned, 'success');
			return next.selection;
		} catch (error) {
			handleError(error);
			return null;
		} finally {
			state.analysisProcessing = false;
			publishDocumentSnapshot();
		}
	}

	function setSnapSettings(settings = {}) {
		if (!project || project.schemaVersion < 2) throw new Error(copy.v2Required);
		return commit({ type: 'snap/set', settings });
	}

	function snapTimelineFrame(value, overrides = {}) {
		const frame = Number(value);
		if (!Number.isFinite(frame)) throw new TypeError(copy.timelineFramesFinite);
		const rounded = Math.round(frame);
		if (!project || project.schemaVersion < 2) return Math.max(0, rounded);
		return snapAudioEditorFrameWithProject(rounded, project, { minimumFrame: 0, ...overrides });
	}

	function setZoom(pixelsPerSecond) {
		const durationSeconds = editorTimelineDurationFrames(project, projectSampleRate()) / projectSampleRate();
		const maximum = Math.min(MAX_PIXELS_PER_SECOND, MAX_TIMELINE_PIXELS / durationSeconds);
		const minimum = state.timelineViewportWidth > 0 ? state.timelineViewportWidth / durationSeconds : 1;
		state.pixelsPerSecond = Math.max(minimum, Math.min(maximum, Number(pixelsPerSecond) || DEFAULT_PIXELS_PER_SECOND));
		synchronizeAutomaticSampleEditMode();
		updatePlayhead(engine.getPositionFrames());
		publishDocumentSnapshot();
		return state.pixelsPerSecond;
	}

	function sampleEditingAvailable(clipId = state.selectedClipId) {
		if (!project || project.schemaVersion < 2 || !clipId) return false;
		const clip = findClip(project, clipId);
		const source = clip ? findSource(project, clip.sourceId) : null;
		const track = clip ? findClipTrack(project, clip.id) : null;
		const displayMode = track?.displayMode && track.displayMode !== 'waveform'
			? track.displayMode
			: state.timelineView;
		if (!clip || !source || displayMode !== 'waveform' || !clip.durationFrames || !clip.sourceDurationFrames) return false;
		const visibleSourceSamplesPerSecond = projectSampleRate() * clip.sourceDurationFrames / clip.durationFrames;
		return canEditAudioSamplesAtZoom(state.pixelsPerSecond, visibleSourceSamplesPerSecond);
	}

	function synchronizeAutomaticSampleEditMode() {
		const available = sampleEditingAvailable();
		if (!available) state.sampleEditMode = null;
		else if (!state.sampleEditAvailable) state.sampleEditMode = 'pencil';
		state.sampleEditAvailable = available;
	}

	function setSampleEditMode(mode = null) {
		if (mode != null && mode !== 'pencil') throw new RangeError('Unsupported sample-edit mode.');
		if (mode && !sampleEditingAvailable()) throw new Error(copy.sampleEditZoomRequired);
		state.sampleEditMode = mode;
		publishDocumentSnapshot();
		return state.sampleEditMode;
	}

	function cancelSampleEdit() {
		state.sampleEditAbort?.abort();
		return Boolean(state.sampleEditAbort);
	}

	function applySamplePencil(options = {}) {
		const clipId = options.clipId || state.selectedClipId;
		const clip = clipId ? findClip(project, clipId) : null;
		const source = clip ? findSource(project, clip.sourceId) : null;
		if (!clip || !source) throw new Error(copy.audioClipNotFound);
		const edits = createPencilSampleEdits({
			clip,
			source,
			channel: options.channel ?? 0,
			points: options.points,
		});
		return applyImmutableSampleEdit({ clip, source, edits });
	}

	function smoothSelectedSamples(options = {}) {
		const clipId = options.clipId || state.selectedClipId;
		const clip = clipId ? findClip(project, clipId) : null;
		const source = clip ? findSource(project, clip.sourceId) : null;
		const selection = activeSelection();
		if (!clip || !source) throw new Error(copy.audioClipNotFound);
		if (!selection) throw new Error(copy.timeSelectionRequired);
		const smooth = createSmoothSampleRange({
			clip,
			source,
			startFrame: selection.startFrame,
			endFrame: selection.endFrame,
			channel: options.channel ?? null,
		});
		return applyImmutableSampleEdit({ clip, source, smooth, radius: options.radius });
	}

	async function applyImmutableSampleEdit({ clip, source, edits = null, smooth = null, radius = 2 }) {
		if (editingBlocked()) return null;
		if (!sampleEditingAvailable(clip.id)) throw new Error(copy.sampleEditZoomRequired);
		const projectAtStart = project;
		const sourceId = createStableId('sample-edit');
		const abort = new AbortController();
		state.sampleEditAbort?.abort();
		state.sampleEditAbort = abort;
		state.sampleEditProcessing = true;
		publishDocumentSnapshot();
		setStatus(copy.sampleEditSaving);
		let persisted = null;
		let published = false;
		try {
			await preflightStorage(sampleEditStorageBytes(source, edits, smooth), 'effect');
			persisted = await persistImmutableSampleEdit({
				store,
				source,
				edits,
				smooth,
				sourceId,
				radius,
				signal: abort.signal,
			});
			throwIfAborted(abort.signal);
			const liveClip = project === projectAtStart ? findClip(project, clip.id) : null;
			if (!liveClip || liveClip.sourceId !== source.id) throw new Error('The clip changed while its sample edit was being prepared.');
			await activateStoredSource(persisted.source, persisted.metadata);
			throwIfAborted(abort.signal);
			commit({
				type: 'batch',
				commands: [
					createAddSourceCommand(persisted.source),
					createReplaceClipSourceCommand(clip.id, sourceId),
				],
			}, { selectTrackId: findClipTrack(project, clip.id)?.id, selectClipId: clip.id });
			published = true;
			setStatus(copy.sampleEditDone, 'success');
			return persisted;
		} catch (error) {
			if (!published) {
				sourceBuffers.delete(sourceId);
				sourceChunkProviders.delete(sourceId);
				sourcePeaks.delete(sourceId);
				await Promise.resolve(store.deleteAnalysis?.(peakCacheKey(sourceId))).catch(() => undefined);
				await persisted?.rollback().catch(() => undefined);
			}
			if (error?.name === 'AbortError') {
				setStatus(copy.sampleEditCancelled);
				return null;
			}
			throw error;
		} finally {
			if (state.sampleEditAbort === abort) state.sampleEditAbort = null;
			state.sampleEditProcessing = false;
			publishDocumentSnapshot();
		}
	}

	function sampleEditStorageBytes(source, edits, smooth) {
		const chunkIndices = new Set();
		for (const edit of edits || []) chunkIndices.add(Math.floor(edit.frame / source.chunkFrames));
		if (smooth) {
			const first = Math.floor(smooth.startFrame / source.chunkFrames);
			const last = Math.floor((smooth.endFrame - 1) / source.chunkFrames);
			for (let index = first; index <= last; index += 1) chunkIndices.add(index);
		}
		return Math.max(1, chunkIndices.size) * source.chunkFrames * source.channelCount * Float32Array.BYTES_PER_ELEMENT;
	}

	async function loadRecordingRouting(currentProject = project) {
		if (!currentProject) {
			state.recordingRouting = normalizeRecordingRouting();
			state.recordingDevices = [];
			state.recordingRouteHealth = {};
			return state.recordingRouting;
		}
		let saved = null;
		try {
			saved = await store.loadSetting(recordingRoutingSettingKey(currentProject.id), null);
		} catch {
			// Local routing is optional and must never prevent a project from opening.
		}
		state.recordingRouting = normalizeRecordingRouting(saved || {}, currentProject.tracks);
		state.recordingRouteHealth = Object.fromEntries(Object.keys(state.recordingRouting.routes)
			.map((trackId) => [trackId, 'unavailable']));
		updateRecordingDeviceRows();
		syncRecordingPoolSnapshot();
		return state.recordingRouting;
	}

	function persistRecordingRouting() {
		if (!project) return Promise.resolve(state.recordingRouting);
		return Promise.resolve(store.saveSetting(recordingRoutingSettingKey(project.id), state.recordingRouting))
			.then(() => state.recordingRouting)
			.catch((error) => {
				handleError(error);
				throw error;
			});
	}

	async function requestInputAccess() {
		if (!mediaDevices?.getUserMedia) throw new Error('Hardware audio recording is not supported in this browser.');
		const sampleRate = projectSampleRate();
		const opened = [];
		const failures = [];
		try {
			await recordingCapturePool.acquireHardware(RECORDING_DEFAULT_DEVICE_ID, { channelCount: RECORDING_CHANNEL_COUNT_MAXIMUM, sampleRate });
			opened.push(RECORDING_DEFAULT_DEVICE_ID);
		} catch (error) {
			failures.push(error);
		}
		await refreshRecordingInputs({ probe: false });
		const deviceIds = state.recordingDevices
			.map((device) => device.deviceId)
			.filter((deviceId) => deviceId && deviceId !== RECORDING_DEFAULT_DEVICE_ID);
		const results = await Promise.allSettled(deviceIds.map((deviceId) => (
			recordingCapturePool.acquireHardware(deviceId, { channelCount: RECORDING_CHANNEL_COUNT_MAXIMUM, sampleRate })
		)));
		for (let index = 0; index < results.length; index += 1) {
			if (results[index].status === 'fulfilled') opened.push(deviceIds[index]);
			else failures.push(results[index].reason);
		}
		state.audioInputAccess = opened.length > 0;
		syncRecordingPoolSnapshot();
		await refreshRecordingInputs({ probe: false });
		if (!state.recorder) releaseUnretainedRecordingInputs();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		if (!opened.length && failures[0]) throw failures[0];
		return state.recordingDevices;
	}

	async function refreshRecordingInputs({ probe = true } = {}) {
		return refreshAudioDevices({ probe });
	}

	async function refreshAudioDevices({ probe = true, publish = true } = {}) {
		const discoveredInputs = [];
		const discoveredOutputs = [];
		if (mediaDevices?.enumerateDevices) {
			const devices = await mediaDevices.enumerateDevices();
			for (const device of devices || []) {
				if (!device?.deviceId) continue;
				const row = {
					deviceId: String(device.deviceId),
					label: String(device.label || ''),
					groupId: String(device.groupId || ''),
				};
				if (device.kind === 'audioinput') discoveredInputs.push(row);
				else if (device.kind === 'audiooutput' && row.deviceId !== 'default') discoveredOutputs.push(row);
			}
		}
		state.recordingEnumeratedDeviceIds = new Set(discoveredInputs.map((device) => device.deviceId));
		if (discoveredInputs.some((device) => device.label)) state.audioInputAccess = true;
		updateRecordingDeviceRows(discoveredInputs);
		state.audioInputDevices = Object.freeze(state.recordingDevices.map((device, index) => Object.freeze({
			deviceId: device.deviceId,
			label: device.label || `Audio input ${index + 1}`,
			channelCount: device.channelCount,
			status: device.status,
		})));
		state.audioOutputDevices = Object.freeze(discoveredOutputs.map((device, index) => Object.freeze({
			deviceId: device.deviceId,
			label: device.label || `Audio output ${index + 1}`,
		})));
		if (probe) {
			await Promise.allSettled(discoveredInputs.map((device) => recordingCapturePool.acquireHardware(device.deviceId, {
				channelCount: RECORDING_CHANNEL_COUNT_MAXIMUM,
				sampleRate: projectSampleRate(),
			})));
			syncRecordingPoolSnapshot();
			if (!state.recorder) releaseUnretainedRecordingInputs();
			syncRecordingPoolSnapshot();
			updateRecordingDeviceRows(discoveredInputs);
			state.audioInputDevices = Object.freeze(state.recordingDevices.map((device) => Object.freeze({
				deviceId: device.deviceId,
				label: device.label,
				channelCount: device.channelCount,
				status: device.status,
			})));
		}
		await reconcilePreferredOutputDevice();
		if (publish) publishDocumentSnapshot();
		return state.recordingDevices;
	}

	async function setPreferredInputDevice(deviceId) {
		const normalized = normalizePreferredInputDeviceId(deviceId);
		if (normalized !== RECORDING_DEFAULT_DEVICE_ID
			&& normalized !== RECORDING_DISPLAY_SOURCE_KEY
			&& !state.audioInputDevices.some((device) => device.deviceId === normalized)) {
			throw new Error('The selected audio input is unavailable.');
		}
		if (normalized === RECORDING_DISPLAY_SOURCE_KEY && !mediaDevices?.getDisplayMedia) {
			throw new Error('Display audio capture is not supported in this browser.');
		}
		await keepSelectedRecordingInputsOpen();
		state.preferredInputDeviceId = normalized;
		await persistAudioDevicePreferences();
		if (normalized !== RECORDING_DISPLAY_SOURCE_KEY) {
			await recordingCapturePool.acquireHardware(normalized, {
				channelCount: state.preferredInputChannelCount,
				sampleRate: projectSampleRate(),
			});
			syncRecordingPoolSnapshot();
		}
		publishDocumentSnapshot();
		return normalized;
	}

	async function configureDisplayInput() {
		if (!mediaDevices?.getDisplayMedia) throw new Error('Display audio capture is not supported in this browser.');
		if (state.recorder || state.recordingStarting || state.timedRecordingPreparing || state.timedRecording) {
			throw new Error('The display source cannot be changed while recording is active.');
		}
		await keepSelectedRecordingInputsOpen();
		const hasDisplay = Boolean(recordingCapturePool.getDisplay?.());
		const stream = hasDisplay && typeof recordingCapturePool.replaceDisplay === 'function'
			? await recordingCapturePool.replaceDisplay()
			: await recordingCapturePool.acquireDisplay();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		return stream;
	}

	function keepSelectedRecordingInputsOpen() {
		if (state.preferences.recording.retainInputs) return Promise.resolve(state.preferences);
		return updatePreferences({ recording: { retainInputs: true } });
	}

	async function setPreferredInputChannelCount(channelCount) {
		const normalized = Number(channelCount) === 2 ? 2 : 1;
		state.preferredInputChannelCount = normalized;
		if (!state.recordingRouting.routes[state.selectedTrackId]) {
			assignPreferredInputToTrack(state.selectedTrackId);
		}
		const selectedRoute = state.recordingRouting.routes[state.selectedTrackId];
		if (selectedRoute?.kind === 'device'
			&& selectedRoute.deviceId === state.preferredInputDeviceId
			&& selectedRoute.channelStart === 0
			&& selectedRoute.channelCount !== normalized) {
			try {
				await setRecordingTrackInput(state.selectedTrackId, {
					...selectedRoute,
					channelCount: normalized,
				});
			} catch {
				// Keep the preference for new tracks when the selected route cannot use it.
			}
		}
		publishDocumentSnapshot();
		await persistAudioDevicePreferences();
		return normalized;
	}

	async function setAudioOutputDevice(deviceId) {
		const normalized = normalizePreferredOutputDeviceId(deviceId);
		if (normalized && !state.audioOutputDevices.some((device) => device.deviceId === normalized)) {
			throw new Error('The selected audio output is unavailable.');
		}
		const previous = state.preferredOutputDeviceId;
		try {
			const result = await Promise.resolve(engine.setOutputDevice?.(normalized));
			state.preferredOutputDeviceId = normalized;
			state.activeOutputDeviceId = result?.activeDeviceId ?? normalized;
			state.audioOutputStatus = normalized ? 'active' : 'default';
			await persistAudioDevicePreferences();
			publishDocumentSnapshot();
			return normalized;
		} catch (error) {
			state.preferredOutputDeviceId = previous;
			state.audioOutputStatus = error?.name === 'NotSupportedError'
				? 'unsupported'
				: error?.name === 'NotAllowedError' || error?.name === 'SecurityError'
					? 'denied'
					: 'error';
			publishDocumentSnapshot();
			throw error;
		}
	}

	async function reconcilePreferredOutputDevice() {
		const preferred = state.preferredOutputDeviceId;
		if (!preferred) {
			await Promise.resolve(engine.setOutputDevice?.('')).catch(() => undefined);
			state.activeOutputDeviceId = '';
			state.audioOutputStatus = 'default';
			return;
		}
		const available = state.audioOutputDevices.some((device) => device.deviceId === preferred);
		if (!available) {
			await Promise.resolve(engine.setOutputDevice?.('')).catch(() => undefined);
			state.activeOutputDeviceId = '';
			state.audioOutputStatus = 'unavailable';
			return;
		}
		try {
			const result = await Promise.resolve(engine.setOutputDevice?.(preferred));
			state.activeOutputDeviceId = result?.activeDeviceId ?? preferred;
			state.audioOutputStatus = 'active';
		} catch (error) {
			await Promise.resolve(engine.setOutputDevice?.('')).catch(() => undefined);
			state.activeOutputDeviceId = '';
			state.audioOutputStatus = error?.name === 'NotSupportedError' ? 'unsupported' : 'denied';
		}
	}

	function persistAudioDevicePreferences() {
		return store.saveSetting(productSettingKey(AUDIO_DEVICE_PREFERENCES_SETTING_KEY), {
			inputDeviceId: state.preferredInputDeviceId,
			inputChannelCount: state.preferredInputChannelCount,
			outputDeviceId: state.preferredOutputDeviceId,
		});
	}

	function updateRecordingDeviceRows(discovered = state.recordingDevices) {
		const rows = new Map();
		for (const device of discovered || []) {
			if (!device?.deviceId) continue;
			rows.set(device.deviceId, { ...device });
		}
		for (const route of Object.values(state.recordingRouting.routes || {})) {
			if (route.kind !== 'device' || rows.has(route.deviceId)) continue;
			rows.set(route.deviceId, {
				deviceId: route.deviceId,
				label: route.deviceLabel || (route.deviceId === RECORDING_DEFAULT_DEVICE_ID ? 'Default audio input' : 'Missing audio input'),
			});
		}
		for (const source of state.recordingPoolSources) {
			if (source.kind !== 'device') continue;
			const existing = rows.get(source.deviceId) || { deviceId: source.deviceId, label: '' };
			rows.set(source.deviceId, { ...existing, channelCount: source.channelCount });
		}
		state.recordingDevices = Object.freeze([...rows.values()].map((device) => Object.freeze({
			deviceId: device.deviceId,
			label: device.label || (device.deviceId === RECORDING_DEFAULT_DEVICE_ID ? 'Default audio input' : 'Audio input'),
			channelCount: Math.max(0, Number(device.channelCount) || 0),
			status: state.recordingPoolSources.some((source) => source.key === `device:${device.deviceId}`)
				? 'open'
				: state.recordingEnumeratedDeviceIds.has(device.deviceId) || device.deviceId === RECORDING_DEFAULT_DEVICE_ID
					? 'available'
					: 'unavailable',
		})));
	}

	async function setRecordingTrackInput(trackId, route) {
		if (state.timedRecordingPreparing || state.timedRecording) return state.recordingRouting.routes[trackId] || null;
		const meterRouteBefore = state.microphoneMetering ? microphoneMeterRoute() : null;
		const track = findTrack(project, trackId);
		state.recordingRouting = setRecordingTrackRoute(state.recordingRouting, track, route);
		if (trackId === state.selectedTrackId) {
			routedInputLoudnessMeter = null;
			routedInputLoudnessMeterKey = null;
			state.inputMeter = null;
		}
		if (route == null) delete state.recordingRouteHealth[trackId];
		else state.recordingRouteHealth[trackId] = 'unavailable';
		updateRecordingDeviceRows();
		publishDocumentSnapshot();
		const persist = persistRecordingRouting();
		const normalized = state.recordingRouting.routes[trackId];
		const meterRouteAfter = state.microphoneMetering ? microphoneMeterRoute() : null;
		const restartMetering = Boolean(
			state.microphoneMetering
			&& !state.recorder
			&& microphoneMeterRouteKey(meterRouteBefore) !== microphoneMeterRouteKey(meterRouteAfter),
		);
		let meterRestartGeneration = null;
		if (restartMetering) {
			meterRestartGeneration = ++microphoneMeterGeneration;
			stopMicrophoneMetering({
				releaseInput: meterRouteBefore?.deviceId !== meterRouteAfter?.deviceId,
			});
		}
		if (!normalized) {
			await persist;
			if (restartMetering && state.microphoneMetering && microphoneMeterGeneration === meterRestartGeneration) {
				await setMicrophoneMetering(true);
			}
			return null;
		}
		try {
			const stream = normalized.kind === 'display'
				? await recordingCapturePool.acquireDisplay()
				: await recordingCapturePool.acquireHardware(normalized.deviceId, {
					channelCount: normalized.channelStart + normalized.channelCount,
					sampleRate: projectSampleRate(),
				});
			const availableChannels = streamAudioChannelCount(stream);
			state.recordingRouteHealth[trackId] = normalized.kind === 'display'
				|| normalized.channelStart + normalized.channelCount <= availableChannels
				? 'open'
				: 'unavailable';
			syncRecordingPoolSnapshot();
			if (!state.recorder) {
				releaseUnretainedRecordingInputs();
				syncRecordingPoolSnapshot();
			}
		} catch {
			// The pin is intentionally retained so a missing or denied source remains visible.
			state.recordingRouteHealth[trackId] = 'unavailable';
		}
		await persist;
		updateRecordingDeviceRows();
		publishDocumentSnapshot();
		if (restartMetering && state.microphoneMetering && microphoneMeterGeneration === meterRestartGeneration) {
			await setMicrophoneMetering(true);
		}
		return normalized;
	}

	async function setRecordingSourceLatency(sourceKey, value) {
		state.recordingRouting = setRecordingSourceOffset(state.recordingRouting, sourceKey, value);
		publishDocumentSnapshot();
		await persistRecordingRouting();
		return state.recordingRouting.offsets[sourceKey];
	}

	async function setRetainInputs(enabled) {
		const retainInputs = Boolean(enabled);
		await updatePreferences({ recording: { retainInputs } });
		if (retainInputs) state.recordingReleaseAfterStop = false;
		else if (state.recorder || state.recordingStarting || state.timedRecordingPreparing || state.timedRecording) {
			state.recordingReleaseAfterStop = true;
		}
		else releaseUnretainedRecordingInputs();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		return retainInputs;
	}

	function releaseInputs() {
		if (state.recorder || state.recordingStarting || state.timedRecordingPreparing || state.timedRecording || state.recordingFinishing) return false;
		if (state.microphoneMetering) {
			state.microphoneMetering = false;
			microphoneMeterGeneration += 1;
			stopMicrophoneMetering({ releaseInput: false });
			void store.saveSetting('microphone-metering', false);
		}
		const released = recordingCapturePool.releaseAll();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		return released;
	}

	function releaseUnretainedRecordingInputs({ force = false } = {}) {
		if (!force && state.preferences.recording.retainInputs) return false;
		if (!state.microphoneMetering) return recordingCapturePool.releaseAll();
		const meterDeviceId = microphoneMeterSession?.deviceId || microphoneMeterDeviceId();
		let released = false;
		for (const source of recordingCapturePool.getSnapshot?.() || []) {
			if (source.kind === 'display') {
				released = recordingCapturePool.releaseDisplay() || released;
			} else if (source.kind === 'device' && source.deviceId !== meterDeviceId) {
				released = recordingCapturePool.releaseHardware(source.deviceId) || released;
			}
		}
		return released;
	}

	function syncRecordingPoolSnapshot() {
		state.recordingPoolSources = Object.freeze(recordingCapturePool.getSnapshot?.() || []);
		if (!state.recorder) {
			const open = new Map(state.recordingPoolSources.map((source) => [source.key, source]));
			for (const [trackId, route] of Object.entries(state.recordingRouting.routes || {})) {
				const previous = state.recordingRouteHealth[trackId];
				const source = open.get(recordingRouteSourceKey(route));
				state.recordingRouteHealth[trackId] = source
					? route.kind === 'display' || route.channelStart + route.channelCount <= source.channelCount ? 'open' : 'skipped'
					: previous === 'disconnected' ? 'disconnected' : 'unavailable';
			}
		}
		updateRecordingDeviceRows();
	}

	function handleRecordingPoolChange(sources) {
		state.recordingPoolSources = Object.freeze(sources || []);
		const scheduled = state.timedRecording;
		if (scheduled?.inputKeys?.length) {
			const openKeys = new Set(state.recordingPoolSources.map((source) => source.key));
			if (scheduled.inputKeys.some((key) => !openKeys.has(key))) {
				cancelTimedRecording();
				return;
			}
		}
		if (!state.recorder) {
			const open = new Map(state.recordingPoolSources.map((source) => [source.key, source]));
			for (const [trackId, route] of Object.entries(state.recordingRouting.routes || {})) {
				const previous = state.recordingRouteHealth[trackId];
				const source = open.get(recordingRouteSourceKey(route));
				state.recordingRouteHealth[trackId] = source
					? route.kind === 'display' || route.channelStart + route.channelCount <= source.channelCount ? 'open' : 'skipped'
					: previous === 'disconnected' ? 'disconnected' : 'unavailable';
			}
		}
		updateRecordingDeviceRows();
		reconcileMicrophoneMeterInput();
		if (!state.disposed) publishDocumentSnapshot();
	}

	function reconcileMicrophoneMeterInput({ endedSession = null } = {}) {
		const session = endedSession || microphoneMeterSession;
		if (!session || microphoneMeterSession !== session) return false;
		const replacement = recordingCapturePool.getHardware?.(session.deviceId) || null;
		if (microphoneMeterSession !== session) return true;
		if (!endedSession && replacement === session.stream) return false;
		if (!state.disposed && state.microphoneMetering && replacement && replacement !== session.stream) {
			microphoneMeterGeneration += 1;
			stopMicrophoneMetering({ releaseInput: false });
			void setMicrophoneMetering(true).catch((error) => {
				if (!state.disposed) handleError(error);
			});
			return true;
		}
		state.microphoneMetering = false;
		microphoneMeterGeneration += 1;
		stopMicrophoneMetering({ releaseInput: false });
		void store.saveSetting('microphone-metering', false);
		if (!state.disposed) publishDocumentSnapshot();
		return true;
	}

	function setMonitoring(enabled) {
		state.monitoring = Boolean(enabled);
		state.recorder?.setMonitoring(state.monitoring);
		void store.saveSetting('input-monitor', state.monitoring);
		publishDocumentSnapshot();
		return state.monitoring;
	}

	function pauseLoudnessMeasurement(kind = 'playback') {
		if (kind === 'input') {
			state.inputLoudnessMeasurementManuallyPaused = true;
			state.inputLoudnessMeasurementExplicitlyRunning = false;
			microphoneMeterSession?.loudnessMeter?.setRunning(false);
			microphoneMeterSession?.loudnessMeter?.requestSnapshot();
			routedInputLoudnessMeter?.setRunning(false);
		} else engine.pauseLoudnessMeasurement?.();
		publishTelemetrySnapshot();
		return true;
	}

	function continueLoudnessMeasurement(kind = 'playback') {
		if (kind === 'input') {
			state.inputLoudnessMeasurementManuallyPaused = false;
			state.inputLoudnessMeasurementExplicitlyRunning = state.transportState !== 'recording';
			microphoneMeterSession?.loudnessMeter?.setRunning(
				state.transportState === 'recording'
					|| state.inputLoudnessMeasurementExplicitlyRunning,
			);
			microphoneMeterSession?.loudnessMeter?.requestSnapshot();
			routedInputLoudnessMeter?.setRunning(
				state.transportState === 'recording'
					|| state.inputLoudnessMeasurementExplicitlyRunning,
			);
		} else engine.continueLoudnessMeasurement?.();
		publishTelemetrySnapshot();
		return true;
	}

	function resetLoudnessMeasurement(kind = 'playback') {
		if (kind === 'input') {
			microphoneMeterSession?.loudnessMeter?.reset();
			microphoneMeterSession?.loudnessMeter?.requestSnapshot();
			routedInputLoudnessMeter?.reset();
			if (routedInputLoudnessMeter) state.inputMeter = routedInputLoudnessMeter.snapshot();
		} else engine.resetLoudnessMeasurement?.();
		publishTelemetrySnapshot();
		return true;
	}

	async function setMicrophoneMetering(enabled) {
		const next = Boolean(enabled);
		if (!next) {
			state.microphoneMetering = false;
			microphoneMeterGeneration += 1;
			if (!state.recorder && !state.recordingStarting) {
				stopMicrophoneMetering({ releaseInput: true });
			}
			void store.saveSetting('microphone-metering', false);
			publishDocumentSnapshot();
			return false;
		}
		state.microphoneMetering = true;
		void store.saveSetting('microphone-metering', true);
		publishDocumentSnapshot();
		if (microphoneMeterSession) return true;
		try {
			while (state.microphoneMetering && !microphoneMeterSession && !state.disposed) {
				if (!microphoneMeterStartPromise) {
					const operation = startMicrophoneMetering();
					const tracked = Promise.resolve(operation).finally(() => {
						if (microphoneMeterStartPromise === tracked) microphoneMeterStartPromise = null;
					});
					microphoneMeterStartPromise = tracked;
				}
				await microphoneMeterStartPromise;
			}
			return Boolean(state.microphoneMetering && microphoneMeterSession);
		} catch (error) {
			if (state.microphoneMetering && !state.disposed) {
				state.microphoneMetering = false;
				microphoneMeterGeneration += 1;
				stopMicrophoneMetering({ releaseInput: true });
				void store.saveSetting('microphone-metering', false);
				publishDocumentSnapshot();
			}
			throw error;
		}
	}

	async function startMicrophoneMetering({ force = false } = {}) {
		if (microphoneMeterSession || (!state.microphoneMetering && !force) || state.disposed) return;
		const generation = ++microphoneMeterGeneration;
		const route = microphoneMeterRoute();
		const deviceId = route.deviceId;
		const requestedChannels = Math.max(1, route.channelStart + route.channelCount);
		microphoneMeterTargetKey = microphoneMeterRouteKey(route);
		const retainedStream = recordingCapturePool.getHardware?.(deviceId);
		let stream = retainedStream && streamAudioChannelCount(retainedStream) >= requestedChannels
			? retainedStream
			: null;
		let source = null;
		let splitter = null;
		let merger = null;
		let loudnessMeter = null;
		const analysers = [];
		try {
			stream ||= await recordingCapturePool.acquireHardware(deviceId, {
				channelCount: requestedChannels,
				sampleRate: projectSampleRate(),
			});
			if (generation !== microphoneMeterGeneration || !state.microphoneMetering || state.disposed) {
				if (!state.preferences.recording.retainInputs && !state.recorder && !state.recordingStarting
					&& !state.timedRecordingPreparing && !state.timedRecording) {
					recordingCapturePool.releaseHardware(deviceId);
				}
				return;
			}
			const context = await engine.getAudioContext({ resume: true });
			if (generation !== microphoneMeterGeneration || !state.microphoneMetering || state.disposed) {
				if (!state.preferences.recording.retainInputs && !state.recorder && !state.recordingStarting
					&& !state.timedRecordingPreparing && !state.timedRecording) {
					recordingCapturePool.releaseHardware(deviceId);
					syncRecordingPoolSnapshot();
				}
				return;
			}
			if (!context?.createMediaStreamSource || !context?.createAnalyser) {
				throw new Error('Microphone metering is not supported by this AudioContext.');
			}
			source = context.createMediaStreamSource(stream);
			if (typeof context.createChannelSplitter === 'function') {
				splitter = context.createChannelSplitter(requestedChannels);
				source.connect(splitter);
				for (let index = 0; index < route.channelCount; index += 1) {
					const analyser = context.createAnalyser();
					if (typeof analyser?.getFloatTimeDomainData !== 'function') {
						throw new Error('Microphone metering is not supported by this AudioContext.');
					}
					analyser.fftSize = 256;
					analyser.smoothingTimeConstant = 0.35;
					splitter.connect(analyser, route.channelStart + index);
					analysers.push(analyser);
				}
			} else {
				const analyser = context.createAnalyser();
				if (typeof analyser?.getFloatTimeDomainData !== 'function') {
					throw new Error('Microphone metering is not supported by this AudioContext.');
				}
				analyser.fftSize = 256;
				analyser.smoothingTimeConstant = 0.35;
				source.connect(analyser);
				analysers.push(analyser);
			}
			try {
				loudnessMeter = await createEbuR128MeterNode(context, {
					channelCount: route.channelCount,
					inputGain: state.recordingInputGain,
					passthrough: false,
					running: !state.inputLoudnessMeasurementManuallyPaused
						&& (state.transportState === 'recording'
							|| state.inputLoudnessMeasurementExplicitlyRunning),
					onMeter: (reading) => {
						if (microphoneMeterSession?.loudnessMeter !== loudnessMeter) return;
						state.inputMeter = reading;
						state.inputMeterDb = Number.isFinite(reading?.dbfs)
							? Math.max(-60, Math.min(0, reading.dbfs))
							: -60;
						publishTelemetrySnapshot();
					},
				});
				if (splitter && typeof context.createChannelMerger === 'function') {
					merger = context.createChannelMerger(route.channelCount);
					for (let index = 0; index < route.channelCount; index += 1) {
						splitter.connect(merger, route.channelStart + index, index);
					}
					merger.connect(loudnessMeter.node);
				} else source.connect(loudnessMeter.node);
				loudnessMeter.node.connect(context.destination);
			} catch {
				loudnessMeter = null;
				merger = null;
			}
			const samples = analysers.map((analyser) => new Float32Array(analyser.fftSize));
			const session = {
				analysers,
				deviceId,
				endedListeners: [],
				interval: null,
				loudnessMeter,
				merger,
				routeKey: microphoneMeterRouteKey(route),
				source,
				splitter,
				stream,
			};
			const handleEnded = () => {
				if (microphoneMeterSession !== session) return;
				reconcileMicrophoneMeterInput({ endedSession: session });
			};
			for (const track of stream.getAudioTracks?.() || []) {
				track.addEventListener?.('ended', handleEnded);
				session.endedListeners.push(() => track.removeEventListener?.('ended', handleEnded));
			}
			microphoneMeterSession = session;
			const update = () => {
				if (microphoneMeterSession !== session
					|| (!state.microphoneMetering && !state.recorder && !state.recordingStarting)
					|| state.disposed) return;
				let peak = 0;
				for (let index = 0; index < analysers.length; index += 1) {
					analysers[index].getFloatTimeDomainData(samples[index]);
					for (const sample of samples[index]) peak = Math.max(peak, Math.abs(sample));
				}
				peak *= state.recordingInputGain;
				state.inputMeterDb = peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
				publishTelemetrySnapshot();
			};
			session.interval = scheduleInterval(update, 50);
			update();
			syncRecordingPoolSnapshot();
			publishDocumentSnapshot();
		} catch (error) {
			try { source?.disconnect(); } catch { /* Already disconnected. */ }
			try { splitter?.disconnect(); } catch { /* Already disconnected. */ }
			try { merger?.disconnect(); } catch { /* Already disconnected. */ }
			loudnessMeter?.dispose();
			for (const analyser of analysers) {
				try { analyser.disconnect(); } catch { /* Already disconnected. */ }
			}
			if (!state.preferences.recording.retainInputs && !state.recorder && !state.recordingStarting
				&& !state.timedRecordingPreparing && !state.timedRecording) {
				recordingCapturePool.releaseHardware(deviceId);
				syncRecordingPoolSnapshot();
			}
			throw error;
		}
	}

	function stopMicrophoneMetering({ releaseInput = false, preserveReading = false } = {}) {
		const session = microphoneMeterSession;
		microphoneMeterSession = null;
		microphoneMeterTargetKey = null;
		if (session?.interval != null) clearScheduledInterval(session.interval);
		for (const remove of session?.endedListeners || []) remove();
		try { session?.source?.disconnect(); } catch { /* Already disconnected. */ }
		try { session?.splitter?.disconnect(); } catch { /* Already disconnected. */ }
		try { session?.merger?.disconnect(); } catch { /* Already disconnected. */ }
		session?.loudnessMeter?.dispose();
		for (const analyser of session?.analysers || []) {
			try { analyser.disconnect(); } catch { /* Already disconnected. */ }
		}
		if (releaseInput && session && !state.preferences.recording.retainInputs
			&& !state.recorder && !state.recordingStarting && !state.timedRecordingPreparing && !state.timedRecording) {
			recordingCapturePool.releaseHardware(session.deviceId);
			syncRecordingPoolSnapshot();
		}
		if (!state.recorder && !preserveReading) {
			state.inputMeterDb = -60;
			state.inputMeter = null;
			publishTelemetrySnapshot();
		}
	}

	function microphoneMeterRoute() {
		const selectedRoute = state.recordingRouting.routes?.[state.selectedTrackId];
		const route = selectedRoute?.kind === 'device'
			? selectedRoute
			: Object.values(state.recordingRouting.routes || {})
				.find((candidate) => candidate?.kind === 'device');
		return route || {
			kind: 'device',
			deviceId: RECORDING_DEFAULT_DEVICE_ID,
			channelStart: 0,
			channelCount: 2,
		};
	}

	function microphoneMeterRouteKey(route = microphoneMeterRoute()) {
		return `${route.deviceId}:${route.channelStart}:${route.channelCount}`;
	}

	function microphoneMeterDeviceId() {
		return microphoneMeterRoute().deviceId;
	}

	function synchronizeMicrophoneMeterTarget() {
		if (!state.microphoneMetering || state.recorder || state.disposed) return false;
		const route = microphoneMeterRoute();
		const targetKey = microphoneMeterRouteKey(route);
		if (microphoneMeterTargetKey === targetKey) return false;
		const releaseInput = Boolean(
			microphoneMeterSession
			&& microphoneMeterSession.deviceId !== route.deviceId,
		);
		microphoneMeterGeneration += 1;
		stopMicrophoneMetering({ releaseInput });
		void setMicrophoneMetering(true).catch((error) => {
			if (!state.disposed) handleError(error);
		});
		return true;
	}

	function setRecordingInputGain(value) {
		state.recordingInputGain = normalizeRecordingInputGain(value);
		state.recorder?.setInputGain(state.recordingInputGain);
		microphoneMeterSession?.loudnessMeter?.setInputGain(state.recordingInputGain);
		void store.saveSetting('recording-input-gain', state.recordingInputGain);
		publishDocumentSnapshot();
		return state.recordingInputGain;
	}

	function setLatencyOffset(value) {
		state.latencyOffsetMs = normalizeLatencyOffset(value);
		void store.saveSetting('recording-latency-offset-ms', state.latencyOffsetMs);
		publishDocumentSnapshot();
		return state.latencyOffsetMs;
	}

	function commit(command, selection = {}, options = {}) {
		if (state.readOnly) throw new Error(copy.projectReadOnly);
		assertCommandCapabilities(command);
		state.history = executeEditorCommand(state.history, command);
		project = state.history.present;
		if (Object.hasOwn(selection, 'selectTrackId')) state.selectedTrackId = selection.selectTrackId;
		if (Object.hasOwn(selection, 'selectClipId')) state.selectedClipId = selection.selectClipId;
		projectChanged(options);
		return project;
	}

	function assertCommandCapabilities(command) {
		if (!command || typeof command !== 'object') return;
		if (command.type === 'batch') {
			for (const child of command.commands || []) assertCommandCapabilities(child);
			return;
		}
		if (!capabilities.videoEffects && String(command.type || '').startsWith('video-effect/')) {
			throw new RangeError(`${product.name} does not support videoEffects.`);
		}
		if (!capabilities.audioEffects && String(command.type || '').startsWith('effect/')) {
			throw new RangeError(`${product.name} does not support audioEffects.`);
		}
		if (!capabilities.videoEffects && command.type === 'clip/update' && Object.hasOwn(command.changes || {}, 'videoEffects')) {
			throw new RangeError(`${product.name} does not support videoEffects.`);
		}
		if (!capabilities.videoEffects && command.type === 'clip/add' && command.clip?.videoEffects?.length) {
			throw new RangeError(`${product.name} does not support videoEffects.`);
		}
		if (!capabilities.audioEffects && ['track/add', 'clip/add'].includes(command.type) && command.track?.effects?.length) {
			throw new RangeError(`${product.name} does not support audioEffects.`);
		}
		if (!capabilities.audioEffects && command.type === 'track/update' && Object.hasOwn(command.changes || {}, 'effects')) {
			throw new RangeError(`${product.name} does not support audioEffects.`);
		}
		if (!capabilities.audioEffects && command.type === 'clip/update' && ['pitchCents', 'speedRatio', 'preserveFormants', 'stretchToTempo', 'reversed'].some((key) => Object.hasOwn(command.changes || {}, key))) {
			throw new RangeError(`${product.name} does not support audioEffects.`);
		}
		if (!capabilities.audioEffects && command.type === 'track/update' && ['sampleRate', 'sampleFormat'].some((key) => Object.hasOwn(command.changes || {}, key))) {
			throw new RangeError(`${product.name} does not support audioEffects.`);
		}
		if (!capabilities.audioEffects && command.type === 'master/update' && Object.hasOwn(command.changes || {}, 'effects')) {
			throw new RangeError(`${product.name} does not support audioEffects.`);
		}
		if (!capabilities.audioEffects && command.type === 'mixer/bus-add' && command.bus?.effects?.length) {
			throw new RangeError(`${product.name} does not support audioEffects.`);
		}
		if (!capabilities.audioEffects && command.type === 'mixer/bus-update' && Object.hasOwn(command.changes || {}, 'effects')) {
			throw new RangeError(`${product.name} does not support audioEffects.`);
		}
		if (!capabilities.audioSpectralEditing && command.type === 'track/update' && ['displayMode', 'spectrogram'].some((key) => Object.hasOwn(command.changes || {}, key))) {
			throw new RangeError(`${product.name} does not support audioSpectralEditing.`);
		}
		if (!capabilities.audioRecording && command.type === 'track/update' && Object.hasOwn(command.changes || {}, 'armed')) {
			throw new RangeError(`${product.name} does not support audioRecording.`);
		}
	}

	function updateSelection(command) {
		if (state.readOnly) throw new Error(copy.projectReadOnly);
		state.history = {
			...state.history,
			present: applyEditorCommand(state.history.present, command),
		};
		project = state.history.present;
		publishProjectState();
		return project;
	}

	function projectChanged(options = {}) {
		if (state.projectBinPreview) void stopProjectBinPreview();
		compactLiveSourceState(true);
		clipTimePitchCache.retainClipIds?.(liveSessionClipIds());
		const normalizedRouting = normalizeRecordingRouting(state.recordingRouting, project.tracks);
		if (JSON.stringify(normalizedRouting) !== JSON.stringify(state.recordingRouting)) {
			state.recordingRouting = normalizedRouting;
			for (const trackId of Object.keys(state.recordingRouteHealth)) {
				if (!normalizedRouting.routes[trackId]) delete state.recordingRouteHealth[trackId];
			}
			void persistRecordingRouting();
		}
		const selectedClipExists = state.selectedClipId && findClip(project, state.selectedClipId);
		if (!selectedClipExists) state.selectedClipId = null;
		if (state.selectedTrackId && !findTrack(project, state.selectedTrackId)) state.selectedTrackId = project.tracks[0]?.id ?? null;
		synchronizeMicrophoneMeterTarget();
		if (!options.skipPlaybackEngine) {
			if (engine.getState().state === 'playing' && projectHasTimePitchClips(project)) {
				const snapshot = project;
				void beginPlaybackCachePreparation(snapshot)
					.then(() => snapshot === project && applyProjectToPlaybackEngine(project))
					.catch(handlePlaybackCacheError);
			} else void applyProjectToPlaybackEngine(project).catch(handleError);
		}
		publishProjectState();
		scheduleAutosave();
	}

	function scheduleAutosave() {
		if (state.readOnly) return;
		globalThis.clearTimeout(state.autosaveTimer);
		state.saveGeneration += 1;
		const generation = state.saveGeneration;
		const snapshot = cloneProject(project);
		state.saveState = 'saving';
		publishDocumentSnapshot();
		state.autosaveTimer = globalThis.setTimeout(() => {
			state.autosaveTimer = 0;
			void enqueueSaveSnapshot(snapshot, generation).catch(() => undefined);
		}, 500);
	}

	async function saveNow() {
		return flushProject();
	}

	async function flushProject() {
		if (!state.history || state.readOnly) return;
		globalThis.clearTimeout(state.autosaveTimer);
		state.autosaveTimer = 0;
		const generation = state.saveGeneration;
		return enqueueSaveSnapshot(cloneProject(project), generation);
	}

	function enqueueSaveSnapshot(snapshot, generation) {
		const operation = state.saveQueue
			.catch(() => undefined)
			.then(() => saveSnapshot(snapshot, generation));
		state.saveQueue = operation;
		return operation;
	}

	async function saveSnapshot(snapshot, generation) {
		state.pendingSaveSnapshots.add(snapshot);
		try {
			await store.saveProject(snapshot);
			state.pendingSaveSnapshots.delete(snapshot);
			if (project?.id === snapshot.id) {
				await store.saveSetting(lastProjectSettingKey, snapshot.id);
				if (productId === 'soundscaper') await store.saveSetting('last-project-id', snapshot.id);
			}
			if (project?.id === snapshot.id && generation === state.saveGeneration) {
				if (sessionTab(snapshot.id)) sessionController.markProjectSaved(snapshot.id);
				state.saveState = 'saved';
				publishDocumentSnapshot();
			}
			await garbageCollectSources();
			await refreshStorageUsage();
		} catch (error) {
			state.saveState = 'dirty';
			publishDocumentSnapshot();
			handleError(error);
			throw error;
		} finally {
			state.pendingSaveSnapshots.delete(snapshot);
		}
	}

	function clipboardSourceIds() {
		const ids = new Set();
		for (const clipboardTrack of state.clipboard?.tracks || []) {
			for (const clip of clipboardTrack.clips || []) if (clip.sourceId) ids.add(clip.sourceId);
		}
		return ids;
	}

	function compactLiveSourceState(dirty = null) {
		state.history = compactEditorHistorySourceMetadata(state.history, {
			preservePresentSourceIds: clipboardSourceIds(),
		});
		project = state.history?.present ?? null;
		if (project && sessionTab(project.id) && !state.readOnly) {
			const wasDirty = sessionTab(project.id).dirty;
			sessionController.updateProjectHistory(project.id, state.history, {
				dirty: dirty == null ? wasDirty : Boolean(dirty),
			});
		}
		evictUnreferencedSourceCaches(sourceBuffers, sourcePeaks, liveSessionSourceIds());
	}

	function liveSessionSourceIds() {
		const ids = new Set(Object.keys(sessionController.getSourceReferenceCounts()));
		if (state.recordingSourceId) ids.add(state.recordingSourceId);
		for (const sourceId of clipTimePitchCache.getProtectedSourceIds?.() || []) ids.add(sourceId);
		return ids;
	}

	function liveSessionClipIds() {
		const clipIds = new Set();
		for (const tab of sessionController.getSnapshot().tabs) {
			for (const historyProject of editorHistoryProjects(tab.history)) {
				for (const clip of allProjectClips(historyProject)) clipIds.add(clip.id);
			}
		}
		return clipIds;
	}

	function publishProjectState() {
		if (!project) {
			publishDocumentSnapshot();
			return;
		}
		const duration = projectDurationFrames(project);
		const timelineDuration = editorTimelineDurationFrames(project, projectSampleRate());
		const durationSeconds = timelineDuration / projectSampleRate();
		const minimumPixelsPerSecond = state.timelineViewportWidth > 0
			? state.timelineViewportWidth / durationSeconds
			: 1;
		state.pixelsPerSecond = Math.max(minimumPixelsPerSecond, state.pixelsPerSecond);
		state.pixelsPerSecond = Math.min(state.pixelsPerSecond, MAX_TIMELINE_PIXELS / durationSeconds);
		state.timelineWidth = Math.max(1, Math.round(durationSeconds * state.pixelsPerSecond));
		synchronizeAutomaticSampleEditMode();
		updatePlayhead(engine.getPositionFrames(), duration);
		publishDocumentSnapshot();
	}

	function setTimelineView(view) {
		state.timelineView = ['spectrogram', 'multiview'].includes(view) ? view : 'waveform';
		publishDocumentSnapshot();
		return state.timelineView;
	}

	function setAllTracksView(view) {
		const displayMode = view === 'spectrogram' ? 'spectrogram' : 'waveform';
		if (!project) return setTimelineView(displayMode);
		if (editingBlocked()) return null;
		state.timelineView = displayMode;
		const commands = project.tracks
			.filter((track) => track.type === 'audio' && track.displayMode !== displayMode)
			.map((track) => ({ type: 'track/update', trackId: track.id, changes: { displayMode } }));
		if (!commands.length) {
			publishDocumentSnapshot();
			return project;
		}
		return commit({ type: 'batch', commands });
	}

	function duplicateTrack(track) {
		if (editingBlocked() || !track) return;
		const trackId = createStableId('track');
		const effects = (track.effects || []).map((effect) => ({
			...structuredClone(effect),
			id: createStableId('effect'),
		}));
		const commands = [createAddTrackCommand({
			...track,
			id: trackId,
			name: `${track.name} ${copy.projectCopySuffix}`,
			armed: false,
			effects,
			clipIds: [],
			laneGroupId: null,
		})];
		let selectedClipId = null;
		for (const clipId of track.clipIds) {
			const clip = findClip(project, clipId);
			if (!clip) continue;
			const nextClipId = createStableId('clip');
			selectedClipId ||= nextClipId;
			commands.push(createAddClipCommand(trackId, {
				...clip,
				id: nextClipId,
				avLinkId: null,
				...(clip.kind === 'video' ? {
					videoEffects: cloneVideoEffects(clip.videoEffects || [], { regenerateIds: true }),
				} : {}),
			}));
		}
		commit({ type: 'batch', commands }, { selectTrackId: trackId, selectClipId: selectedClipId });
	}

	async function handleClipAction(action, clipId = state.selectedClipId) {
		if (editingBlocked()) return;
		const clip = clipId ? findClip(project, clipId) : null;
		if (!clip) return;
		if (action === 'reverse') return commit({ type: 'clip/update', clipId: clip.id, changes: { reversed: !clip.reversed } }, { selectClipId: clip.id });
		const buffer = sourceBuffers.get(clip.sourceId);
		if (!buffer) return;
		const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel).subarray(clip.sourceStartFrame, clip.sourceStartFrame + clip.durationFrames));
		const result = await analyzeChannelsInWorker(channels, buffer.sampleRate, copy);
		let gain = clip.gain;
		if (action === 'normalize-peak' && result.peakAmplitude > 0) gain = 10 ** (-1 / 20) / result.peakAmplitude;
		if (action === 'normalize-lufs' && Number.isFinite(result.integratedLufs)) gain = 10 ** ((-14 - result.integratedLufs) / 20);
		commit({ type: 'clip/update', clipId: clip.id, changes: { gain: Math.max(0, Math.min(16, gain)) } }, { selectClipId: clip.id });
	}

	function moveClips(clipId = state.selectedClipId, trackId, timelineStartFrame, options = {}) {
		if (editingBlocked()) return null;
		const clip = clipId ? findClip(project, clipId) : null;
		const oldTrack = clip ? findClipTrack(project, clip.id) : null;
		let targetTrack = trackId == null ? oldTrack : findTrack(project, trackId);
		if (
			clip
			&& targetTrack
			&& project.schemaVersion >= 4
			&& targetTrack.type !== clip.kind
			&& targetTrack.laneGroupId
		) {
			targetTrack = project.tracks.find((track) => (
				track.type === clip.kind && track.laneGroupId === targetTrack.laneGroupId
			)) || targetTrack;
		}
		if (!clip || !oldTrack || !targetTrack || !Array.isArray(targetTrack.clipIds)) throw new Error(copy.audioClipNotFound);
		const requestedStartFrame = snapTimelineFrame(timelineStartFrame);
		const clipIds = collectClipTransformIds(project, clip.id);
		const audioTracks = project.tracks.filter((item) => Array.isArray(item.clipIds));
		const oldTrackIndex = audioTracks.findIndex((item) => item.id === oldTrack.id);
		const targetTrackIndex = audioTracks.findIndex((item) => item.id === targetTrack.id);
		if (oldTrackIndex < 0 || targetTrackIndex < 0) throw new RangeError('Clip destination must be an audio track.');
		const trackDelta = targetTrackIndex - oldTrackIndex;
		const clips = clipIds.map((id) => findClip(project, id)).filter(Boolean);
		const selection = activeSelection();
		const clipSelection = project.selection;
		const movesClipSelection = Boolean(clipSelection?.clipIds?.includes(clip.id));
		const requestedDelta = requestedStartFrame - clip.timelineStartFrame;
		const earliestMovingFrame = Math.min(
			...clips.map((item) => item.timelineStartFrame),
			...(selection && movesClipSelection ? [selection.startFrame] : []),
		);
		const deltaFrames = Math.max(requestedDelta, -earliestMovingFrame);
		const transforms = clips.map((item) => {
			const sourceTrack = findClipTrack(project, item.id);
			const sourceTrackIndex = audioTracks.findIndex((candidate) => candidate.id === sourceTrack?.id);
			const destinationTrack = audioTracks[sourceTrackIndex + trackDelta];
			if (!sourceTrack || !destinationTrack) throw new RangeError('The selected clips cannot move beyond the available audio tracks.');
			return {
				clipId: item.id,
				trackId: destinationTrack.id,
				changes: { timelineStartFrame: item.timelineStartFrame + deltaFrames },
			};
		});
		const transformCommand = prepareTransformClipsCommand(project, transforms, { overwrite: Boolean(options.overwrite) });
		const command = movesClipSelection ? {
			type: 'batch',
			commands: [transformCommand, {
				type: 'selection/set',
				startFrame: selection ? selection.startFrame + deltaFrames : clipSelection.startFrame,
				endFrame: selection ? selection.endFrame + deltaFrames : clipSelection.endFrame,
				trackIds: [...new Set(clipSelection.trackIds.map((trackId) => {
					const index = audioTracks.findIndex((candidate) => candidate.id === trackId);
					return index < 0 ? trackId : (audioTracks[index + trackDelta]?.id || trackId);
				}))],
				clipIds: clipSelection.clipIds,
				frequencyRange: clipSelection.frequencyRange,
			}],
		} : transformCommand;
		return commit(command, { selectTrackId: targetTrack.id, selectClipId: clip.id });
	}

	function moveClipsToNewTrack(clipId = state.selectedClipId, timelineStartFrame = 0) {
		if (editingBlocked()) return null;
		const clip = clipId ? findClip(project, clipId) : null;
		const sourceTrack = clip ? findClipTrack(project, clip.id) : null;
		if (!clip || !sourceTrack) throw new Error(copy.audioClipNotFound);
		const audioTracks = project.tracks.filter((track) => Array.isArray(track.clipIds));
		const activeTrackIndex = audioTracks.findIndex((track) => track.id === sourceTrack.id);
		if (activeTrackIndex < 0) throw new RangeError('Clip source must be an audio track.');
		const clipIds = collectClipTransformIds(project, clip.id);
		const clips = clipIds.map((id) => findClip(project, id)).filter(Boolean);
		const sourceTrackIndices = clips.map((item) => (
			audioTracks.findIndex((track) => track.clipIds.includes(item.id))
		));
		if (sourceTrackIndices.some((index) => index < 0)) throw new Error(copy.audioClipNotFound);
		const requestedStartFrame = snapTimelineFrame(timelineStartFrame);
		const selection = activeSelection();
		const clipSelection = project.selection;
		const movesClipSelection = Boolean(clipSelection?.clipIds?.includes(clip.id));
		const requestedDelta = requestedStartFrame - clip.timelineStartFrame;
		const earliestMovingFrame = Math.min(
			...clips.map((item) => item.timelineStartFrame),
			...(selection && movesClipSelection ? [selection.startFrame] : []),
		);
		const deltaFrames = Math.max(requestedDelta, -earliestMovingFrame);
		if (project.schemaVersion >= 4 && clips.some((item) => item.kind === 'video')) {
			const movingTrackIds = new Set(clips
				.map((item) => findClipTrack(project, item.id)?.id)
				.filter(Boolean));
			const destinationTrackIds = new Map();
			const newTrackCommands = [];
			for (const track of project.tracks) {
				if (!movingTrackIds.has(track.id) || destinationTrackIds.has(track.id)) continue;
				if (track.type === 'video') {
					const companion = track.laneGroupId
						? project.tracks.find((candidate) => (
							candidate.type === 'audio' && candidate.laneGroupId === track.laneGroupId
						))
						: null;
					const laneGroupId = createStableId('media-lane');
					const videoTrackId = createStableId('video-track');
					const audioTrackId = createStableId('track');
					newTrackCommands.push(
						createAddTrackCommand({
							schemaVersion: 4,
							type: 'video',
							id: videoTrackId,
							name: track.name,
							height: track.height,
							laneGroupId,
						}),
						createAddTrackCommand({
							schemaVersion: 4,
							type: 'audio',
							id: audioTrackId,
							name: companion?.name || `${track.name} Audio`,
							channelCount: companion?.channelCount || 2,
							color: companion?.color,
							armed: false,
							laneGroupId,
						}),
					);
					destinationTrackIds.set(track.id, videoTrackId);
					if (companion) destinationTrackIds.set(companion.id, audioTrackId);
					continue;
				}
				if (track.type === 'audio') {
					const trackId = createStableId('track');
					newTrackCommands.push(createAddTrackCommand({
						schemaVersion: 4,
						type: 'audio',
						id: trackId,
						name: `${copy.track} ${project.tracks.length + newTrackCommands.length + 1}`,
						channelCount: track.channelCount,
						color: track.color,
						armed: false,
					}));
					destinationTrackIds.set(track.id, trackId);
				}
			}
			const transforms = clips.map((item) => {
				const itemSourceTrack = findClipTrack(project, item.id);
				const trackId = destinationTrackIds.get(itemSourceTrack?.id);
				if (!trackId) throw new RangeError('The selected media clips cannot move to new tracks.');
				return {
					clipId: item.id,
					trackId,
					changes: { timelineStartFrame: item.timelineStartFrame + deltaFrames },
				};
			});
			const targetTrackId = destinationTrackIds.get(sourceTrack.id);
			const commands = [
				...newTrackCommands,
				{ type: 'clip/transform-many', transforms, overwrite: false, splitClipIds: {} },
			];
			if (movesClipSelection) commands.push({
				type: 'selection/set',
				startFrame: selection ? selection.startFrame + deltaFrames : clipSelection.startFrame,
				endFrame: selection ? selection.endFrame + deltaFrames : clipSelection.endFrame,
				trackIds: [...new Set(clipSelection.trackIds.map((trackId) => (
					destinationTrackIds.get(trackId) || trackId
				)))],
				clipIds: clipSelection.clipIds,
				frequencyRange: clipSelection.frequencyRange,
			});
			commit({ type: 'batch', commands }, { selectTrackId: targetTrackId, selectClipId: clip.id });
			return targetTrackId;
		}
		const trackDelta = audioTracks.length - activeTrackIndex;
		const newTrackCount = Math.max(...sourceTrackIndices) + trackDelta - audioTracks.length + 1;
		const newTrackCommands = Array.from({ length: newTrackCount }, (_, index) => createAddTrackCommand({
			schemaVersion: 2,
			type: 'audio',
			id: createStableId('track'),
			name: `${copy.track} ${project.tracks.length + index + 1}`,
			armed: false,
		}));
		const virtualTracks = [...audioTracks, ...newTrackCommands.map((command) => command.track)];
		const transforms = clips.map((item, index) => ({
			clipId: item.id,
			trackId: virtualTracks[sourceTrackIndices[index] + trackDelta].id,
			changes: { timelineStartFrame: item.timelineStartFrame + deltaFrames },
		}));
		const targetTrackId = virtualTracks[activeTrackIndex + trackDelta].id;
		const commands = [
			...newTrackCommands,
			{ type: 'clip/transform-many', transforms, overwrite: false, splitClipIds: {} },
		];
		if (movesClipSelection) commands.push({
			type: 'selection/set',
			startFrame: selection ? selection.startFrame + deltaFrames : clipSelection.startFrame,
			endFrame: selection ? selection.endFrame + deltaFrames : clipSelection.endFrame,
			trackIds: [...new Set(clipSelection.trackIds.map((trackId) => {
				const index = audioTracks.findIndex((track) => track.id === trackId);
				return index < 0 ? trackId : virtualTracks[index + trackDelta]?.id || trackId;
			}))],
			clipIds: clipSelection.clipIds,
			frequencyRange: clipSelection.frequencyRange,
		});
		commit({ type: 'batch', commands }, { selectTrackId: targetTrackId, selectClipId: clip.id });
		return targetTrackId;
	}

	function trimClips(clipId = state.selectedClipId, changes = {}, options = {}) {
		if (editingBlocked()) return null;
		const clip = clipId ? findClip(project, clipId) : null;
		const track = clip ? findClipTrack(project, clip.id) : null;
		if (!clip || !track) throw new Error(copy.audioClipNotFound);
		const timelineStartChanged = Object.hasOwn(changes, 'timelineStartFrame')
			&& Math.round(Number(changes.timelineStartFrame)) !== clip.timelineStartFrame;
		if (!timelineStartChanged && !Object.hasOwn(changes, 'durationFrames')) {
			if (!Object.keys(changes).length) return project;
			const command = options.overwrite
				? prepareOverwriteClipCommand(project, clip.id, { trackId: track.id, changes })
				: { type: 'clip/trim', clipId: clip.id, ...changes };
			return commit(command, { selectClipId: clip.id });
		}
		const clipIds = collectClipTrimIds(project, clip.id, timelineStartChanged ? 'left' : 'right');
		const clips = clipIds.map((id) => findClip(project, id)).filter(Boolean);
		const trimsLeft = timelineStartChanged;
		let requestedDelta;
		let lowerBound = Number.NEGATIVE_INFINITY;
		let upperBound = Number.POSITIVE_INFINITY;
		if (trimsLeft) {
			requestedDelta = Math.round(Number(changes.timelineStartFrame)) - clip.timelineStartFrame;
			for (const item of clips) {
				const source = findSource(project, item.sourceId);
				if (!source) throw new Error(copy.audioClipNotFound);
				const sourceDurationFrames = item.sourceDurationFrames || item.durationFrames;
				const sourceFramesPerTimelineFrame = sourceDurationFrames / item.durationFrames;
				const sourceExtension = item.reversed
					? source.frameCount - item.sourceStartFrame - sourceDurationFrames
					: item.sourceStartFrame;
				const timelineExtension = Math.floor(sourceExtension / sourceFramesPerTimelineFrame);
				lowerBound = Math.max(lowerBound, -Math.min(item.timelineStartFrame, timelineExtension));
				upperBound = Math.min(upperBound, item.durationFrames - 1);
			}
		} else {
			requestedDelta = Math.round(Number(changes.durationFrames)) - clip.durationFrames;
			for (const item of clips) {
				const source = findSource(project, item.sourceId);
				if (!source) throw new Error(copy.audioClipNotFound);
				const sourceDurationFrames = item.sourceDurationFrames || item.durationFrames;
				const sourceFramesPerTimelineFrame = sourceDurationFrames / item.durationFrames;
				const sourceExtension = item.reversed
					? item.sourceStartFrame
					: source.frameCount - item.sourceStartFrame - sourceDurationFrames;
				lowerBound = Math.max(lowerBound, 1 - item.durationFrames);
				upperBound = Math.min(upperBound, Math.floor(sourceExtension / sourceFramesPerTimelineFrame));
			}
		}
		if (!Number.isSafeInteger(requestedDelta)) throw new TypeError(copy.timelineFramesFinite);
		const deltaFrames = Math.max(lowerBound, Math.min(upperBound, requestedDelta));
		if (!deltaFrames) return project;
		const transforms = clips.map((item) => {
			const source = findSource(project, item.sourceId);
			const sourceDurationFrames = item.sourceDurationFrames || item.durationFrames;
			const durationFrames = trimsLeft
				? item.durationFrames - deltaFrames
				: item.durationFrames + deltaFrames;
			const sourceExtension = trimsLeft
				? (item.reversed
					? source.frameCount - item.sourceStartFrame - sourceDurationFrames
					: item.sourceStartFrame)
				: (item.reversed
					? item.sourceStartFrame
					: source.frameCount - item.sourceStartFrame - sourceDurationFrames);
			const nextSourceDurationFrames = Math.max(1, Math.min(
				sourceDurationFrames + sourceExtension,
				Math.round(sourceDurationFrames * durationFrames / item.durationFrames),
			));
			const removedSourceFrames = sourceDurationFrames - nextSourceDurationFrames;
			const trimsSourceStart = trimsLeft ? !item.reversed : item.reversed;
			return {
				clipId: item.id,
				trackId: findClipTrack(project, item.id)?.id,
				changes: {
					...(trimsLeft ? {
						timelineStartFrame: item.timelineStartFrame + deltaFrames,
						sourceStartFrame: item.sourceStartFrame + (item.reversed ? 0 : removedSourceFrames),
					} : {
						sourceStartFrame: item.reversed
							? item.sourceStartFrame + removedSourceFrames
							: item.sourceStartFrame,
					}),
					sourceDurationFrames: nextSourceDurationFrames,
					durationFrames,
					trimStartFrames: Math.max(0, item.trimStartFrames + (trimsSourceStart ? removedSourceFrames : 0)),
					trimEndFrames: Math.max(0, item.trimEndFrames + (trimsSourceStart ? 0 : removedSourceFrames)),
					fadeInFrames: Math.min(item.fadeInFrames, durationFrames),
					fadeOutFrames: Math.min(item.fadeOutFrames, durationFrames),
				},
			};
		});
		if (transforms.length === 1) {
			const normalizedChanges = transforms[0].changes;
			const command = options.overwrite
				? prepareOverwriteClipCommand(project, clip.id, { trackId: track.id, changes: normalizedChanges })
				: { type: 'clip/trim', clipId: clip.id, ...normalizedChanges };
			return commit(command, { selectClipId: clip.id });
		}
		const command = prepareTransformClipsCommand(project, transforms, { overwrite: Boolean(options.overwrite) });
		return commit(command, { selectTrackId: track.id, selectClipId: clip.id });
	}

	function overwriteClips(clipId = state.selectedClipId, trackId, changes = {}) {
		const clip = clipId ? findClip(project, clipId) : null;
		const clipIds = clip ? collectClipTransformIds(project, clip.id) : [];
		if (clipIds.length > 1) {
			if (Object.hasOwn(changes, 'durationFrames')) return trimClips(clip.id, changes, { overwrite: true });
			return moveClips(clip.id, trackId, changes.timelineStartFrame, { overwrite: true });
		}
		return commit(
			prepareOverwriteClipCommand(project, clipId, { trackId, changes }),
			{ selectTrackId: trackId, selectClipId: clipId },
		);
	}

	function setClipTimePitch(clipId = state.selectedClipId, changes = {}) {
		if (editingBlocked()) return null;
		const clip = clipId ? findClip(project, clipId) : null;
		const track = clip ? findClipTrack(project, clip.id) : null;
		if (!clip || !track) throw new Error(copy.audioClipNotFound);
		const pitchCents = changes.pitchCents == null ? clip.pitchCents : Number(changes.pitchCents);
		const speedRatio = changes.speedRatio == null ? clip.speedRatio : Number(changes.speedRatio);
		if (!Number.isFinite(pitchCents) || pitchCents < -1_200 || pitchCents > 1_200) {
			throw new RangeError(copy.clipPitchRange);
		}
		if (!Number.isFinite(speedRatio) || speedRatio <= 0) {
			throw new RangeError(copy.clipSpeedPositive);
		}
		const durationFrames = changes.speedRatio == null
			? clip.durationFrames
			: Math.max(1, Math.round((clip.sourceDurationFrames || clip.durationFrames) / speedRatio));
		const command = prepareTransformClipsCommand(project, [{
			clipId: clip.id,
			trackId: track.id,
			changes: {
				pitchCents,
				speedRatio,
				...(changes.preserveFormants == null ? {} : {
					preserveFormants: Boolean(changes.preserveFormants),
				}),
				durationFrames,
				fadeInFrames: Math.min(clip.fadeInFrames, durationFrames),
				fadeOutFrames: Math.min(clip.fadeOutFrames, durationFrames),
				envelope: scaleClipEnvelope(clip, durationFrames),
				renderCacheRevision: (clip.renderCacheRevision || 0) + 1,
			},
		}]);
		return commit(command, { selectTrackId: track.id, selectClipId: clip.id });
	}

	function stretchClip(clipId = state.selectedClipId, changes = {}) {
		if (editingBlocked()) return null;
		const clip = clipId ? findClip(project, clipId) : null;
		const track = clip ? findClipTrack(project, clip.id) : null;
		if (!clip || !track) throw new Error(copy.audioClipNotFound);
		const timelineStartFrame = changes.timelineStartFrame == null
			? clip.timelineStartFrame
			: Math.max(0, Math.round(Number(changes.timelineStartFrame)));
		const durationFrames = changes.durationFrames == null
			? clip.durationFrames
			: Math.max(1, Math.round(Number(changes.durationFrames)));
		if (!Number.isSafeInteger(timelineStartFrame) || !Number.isSafeInteger(durationFrames)) {
			throw new TypeError(copy.timelineFramesFinite);
		}
		const clipIds = collectClipTransformIds(project, clip.id);
		if (clipIds.length > 1) {
			const clips = clipIds.map((id) => findClip(project, id)).filter(Boolean);
			const stretchesLeft = changes.timelineStartFrame != null
				&& timelineStartFrame !== clip.timelineStartFrame;
			let stretchFactor = durationFrames / clip.durationFrames;
			if (stretchesLeft) {
				const maximumFactor = Math.min(...clips.map((item) => (
					(item.timelineStartFrame + item.durationFrames) / item.durationFrames
				)));
				stretchFactor = Math.min(stretchFactor, maximumFactor);
			}
			const transforms = clips.map((item) => {
				const nextDurationFrames = Math.max(1, Math.round(item.durationFrames * stretchFactor));
				return {
					clipId: item.id,
					trackId: findClipTrack(project, item.id)?.id,
					changes: {
						...(stretchesLeft ? {
							timelineStartFrame: item.timelineStartFrame + item.durationFrames - nextDurationFrames,
						} : {}),
						durationFrames: nextDurationFrames,
						speedRatio: (item.sourceDurationFrames || item.durationFrames) / nextDurationFrames,
						fadeInFrames: Math.min(item.fadeInFrames, nextDurationFrames),
						fadeOutFrames: Math.min(item.fadeOutFrames, nextDurationFrames),
						envelope: scaleClipEnvelope(item, nextDurationFrames),
						renderCacheRevision: (item.renderCacheRevision || 0) + 1,
					},
				};
			});
			const command = prepareTransformClipsCommand(project, transforms);
			return commit(command, { selectTrackId: track.id, selectClipId: clip.id });
		}
		const speedRatio = (clip.sourceDurationFrames || clip.durationFrames) / durationFrames;
		const command = prepareTransformClipsCommand(project, [{
			clipId: clip.id,
			trackId: track.id,
			changes: {
				timelineStartFrame,
				durationFrames,
				speedRatio,
				fadeInFrames: Math.min(clip.fadeInFrames, durationFrames),
				fadeOutFrames: Math.min(clip.fadeOutFrames, durationFrames),
				envelope: scaleClipEnvelope(clip, durationFrames),
				renderCacheRevision: (clip.renderCacheRevision || 0) + 1,
			},
		}]);
		return commit(command, { selectTrackId: track.id, selectClipId: clip.id });
	}

	function resetClipPitchSpeed(clipId = state.selectedClipId) {
		return setClipTimePitch(clipId, { pitchCents: 0, speedRatio: 1, preserveFormants: false });
	}

	async function renderClipPitchSpeed(clipId = state.selectedClipId) {
		if (editingBlocked()) return null;
		const clip = clipId ? findClip(project, clipId) : null;
		const track = clip ? findClipTrack(project, clip.id) : null;
		const source = clip ? findSource(project, clip.sourceId) : null;
		if (!clip || !track || !source) throw new Error(copy.audioClipNotFound);
		if (!clipNeedsTimePitchRender(clip)) return clip.id;
		state.audacityEffectProcessing = true;
		setStatus(copy.rendering);
		publishDocumentSnapshot();
		let renderedSourceId = null;
		try {
			const entry = await clipTimePitchCache.prepareCommittedOutput(clip, source);
			const materialized = await materializeTimePitchCacheEntry(entry);
			const buffer = materialized.audioBuffer;
			const channels = audioBufferChannels(buffer).map((channel) => channel.slice());
			await preflightStorage(buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT, 'effect');
			renderedSourceId = createStableId('rendered-clip');
			const name = `${source.name || clip.title || track.name} — ${copy.renderPitchSpeed}`;
			const writer = await store.beginSourceWrite(renderedSourceId, {
				name,
				mimeType: 'audio/wav',
				sampleRate: buffer.sampleRate,
				channelCount: buffer.numberOfChannels,
				chunkFrames: SOURCE_CHUNK_FRAMES,
			});
			try {
				await writeBuffer(writer, buffer);
				await writer.commit({ sampleRate: buffer.sampleRate, channelCount: buffer.numberOfChannels });
			} catch (error) {
				await writer.abort();
				throw error;
			}
			const nextSource = {
				...source,
				id: renderedSourceId,
				storageKey: renderedSourceId,
				name,
				frameCount: buffer.length,
				channelCount: buffer.numberOfChannels,
				sampleRate: buffer.sampleRate,
				originalSampleRate: source.originalSampleRate || source.sampleRate,
			};
			const nextClip = {
				...clip,
				sourceId: renderedSourceId,
				sourceStartFrame: 0,
				sourceDurationFrames: buffer.length,
				durationFrames: buffer.length,
				pitchCents: 0,
				speedRatio: 1,
				preserveFormants: false,
				reversed: false,
				fadeInFrames: Math.min(clip.fadeInFrames, buffer.length),
				fadeOutFrames: Math.min(clip.fadeOutFrames, buffer.length),
				renderCacheRevision: 0,
			};
			cacheSourceBuffer(renderedSourceId, buffer);
			const peaks = await generateWaveformPeaks(channels, copy);
			sourcePeaks.set(renderedSourceId, peaks);
			await store.saveAnalysis(peakCacheKey(renderedSourceId), peaks);
			commit({
				type: 'batch',
				commands: [
					createAddSourceCommand(nextSource),
					{ type: 'clip/remove', clipId: clip.id },
					createAddClipCommand(track.id, nextClip),
				],
			}, { selectTrackId: track.id, selectClipId: clip.id });
			setStatus(copy.done, 'success');
			return clip.id;
		} catch (error) {
			if (renderedSourceId) {
				sourceBuffers.delete(renderedSourceId);
				sourcePeaks.delete(renderedSourceId);
				await store.deleteSource(renderedSourceId).catch(() => undefined);
			}
			throw error;
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	function projectTimePitchPairs(snapshot) {
		if (!snapshot || snapshot.schemaVersion < 2) return [];
		const pairs = [];
		for (const clip of snapshot.clips || []) {
			if (clip.kind === 'video') continue;
			if (!clipNeedsTimePitchRender(clip)) continue;
			const source = findSource(snapshot, clip.sourceId);
			if (source) pairs.push({ clip, source });
		}
		return pairs;
	}

	function projectHasTimePitchClips(snapshot) {
		return projectTimePitchPairs(snapshot).length > 0;
	}

	function createCacheAwareRenderEngine() {
		const renderEngine = renderEngineFactory({ sourceResolver: clipTimePitchSourceResolver });
		renderEngine.setSourceResolver?.(clipTimePitchSourceResolver);
		renderEngine.setChunkSources?.(sourceChunkProviders);
		return renderEngine;
	}

	async function materializeTimePitchCacheEntry(entry, signal = null) {
		throwIfAborted(signal);
		const committed = clipTimePitchCache.getCommitted?.(entry.cacheKey) || entry;
		if (committed.audioBuffer) return committed;
		const channels = committed.channels || await clipTimePitchCache.loadCommittedChannels(committed, { signal });
		throwIfAborted(signal);
		const context = await engine.getAudioContext?.({ resume: false });
		const buffer = await bufferFromChannels(channels, committed.sampleRate, context, copy);
		clipTimePitchCache.attachAudioBuffer?.(committed.cacheKey, buffer);
		return clipTimePitchCache.getCommitted?.(committed.cacheKey) || { ...committed, audioBuffer: buffer };
	}

	async function prepareCommittedTimePitchCaches(snapshot, signal = null) {
		clipTimePitchCache.retainClipIds?.((snapshot?.clips || []).map((clip) => clip.id));
		const entries = [];
		for (const { clip, source } of projectTimePitchPairs(snapshot)) {
			throwIfAborted(signal);
			const entry = await clipTimePitchCache.prepareCommittedOutput(clip, source, { signal });
			entries.push(await materializeTimePitchCacheEntry(entry, signal));
		}
		return entries;
	}

	async function preparePlaybackTimePitchCaches(snapshot, signal) {
		clipTimePitchCache.retainClipIds?.((snapshot?.clips || []).map((clip) => clip.id));
		const refreshes = [];
		for (const { clip, source } of projectTimePitchPairs(snapshot)) {
			throwIfAborted(signal);
			const resolved = await clipTimePitchCache.resolveForPlayback(clip, source, { signal });
			await materializeTimePitchCacheEntry(resolved, signal);
			if (resolved.stale) {
				refreshes.push(resolved.pending.then((entry) => materializeTimePitchCacheEntry(entry, signal)));
			}
		}
		return refreshes;
	}

	async function applyProjectToPlaybackEngine(snapshot) {
		const previousPlayback = engine.getState();
		const transientBuffers = await ensureProjectSourcesAvailable(snapshot);
		if (snapshot !== project) return;
		const playbackBuffers = transientBuffers.size
			? new Map([...sourceBuffers, ...transientBuffers])
			: sourceBuffers;
		await engine.applyProject(snapshot, playbackBuffers, { chunkSources: sourceChunkProviders });
		if (previousPlayback.state === 'playing'
			&& previousPlayback.playbackMode === 'staffpad'
			&& engine.getState().state !== 'playing') {
			setStatus(copy.ready);
		}
	}

	async function beginPlaybackCachePreparation(snapshot, { abortController = null } = {}) {
		cancelPlaybackCachePreparation();
		const abort = abortController || new AbortController();
		const generation = ++state.playbackCacheGeneration;
		state.playbackCacheAbort = abort;
		let refreshes = [];
		let background = false;
		try {
			refreshes = await preparePlaybackTimePitchCaches(snapshot, abort.signal);
			throwIfAborted(abort.signal);
			if (refreshes.length) {
				background = true;
				void Promise.all(refreshes)
					.then(async () => {
						if (abort.signal.aborted || generation !== state.playbackCacheGeneration || snapshot !== project) return;
						if (!state.recorder && !state.recordingStarting && engine.getState().state === 'playing') {
							await applyProjectToPlaybackEngine(project);
						}
					})
					.catch(handlePlaybackCacheError)
					.finally(() => {
						if (generation === state.playbackCacheGeneration) state.playbackCacheAbort = null;
					});
			}
			return refreshes;
		} finally {
			if (!background && generation === state.playbackCacheGeneration) state.playbackCacheAbort = null;
		}
	}

	function cancelPlaybackCachePreparation() {
		state.playbackCacheGeneration += 1;
		state.playbackCacheAbort?.abort();
		state.playbackCacheAbort = null;
	}

	function handlePlaybackCacheError(error) {
		if (error?.name !== 'AbortError') handleError(error);
	}

	function videoClipEffect(clipId, effectId) {
		const clip = findClip(project, clipId);
		if (!clip || clip.kind !== 'video') throw new Error('Video clip not found.');
		const effect = (clip.videoEffects || []).find((candidate) => candidate.id === effectId);
		if (!effect) throw new Error('Video effect not found.');
		return { clip, effect };
	}

	function videoEffectGestureKey(clipId, effectId) {
		return `${clipId}:${effectId}`;
	}

	function addVideoClipEffect(clipId = state.selectedClipId, type, options = {}) {
		if (editingBlocked()) return null;
		const clip = findClip(project, clipId);
		if (!clip || clip.kind !== 'video') throw new Error('Video clip not found.');
		const effect = createVideoEffect(type, options);
		commit({
			type: 'video-effect/add',
			clipId: clip.id,
			effect,
			...(options.index == null ? {} : { index: options.index }),
		}, { selectClipId: clip.id });
		return effect.id;
	}

	function updateVideoClipEffect(clipId, effectId, changes = {}) {
		if (editingBlocked()) return null;
		videoClipEffect(clipId, effectId);
		state.videoEffectGestures.delete(videoEffectGestureKey(clipId, effectId));
		return commit({ type: 'video-effect/update', clipId, effectId, changes }, { selectClipId: clipId });
	}

	function toggleVideoClipEffect(clipId, effectId, enabled = undefined) {
		const { effect } = videoClipEffect(clipId, effectId);
		if (enabled != null && typeof enabled !== 'boolean') throw new TypeError('Video effect enabled state must be boolean.');
		return updateVideoClipEffect(clipId, effectId, { enabled: enabled ?? !effect.enabled });
	}

	function bypassVideoClipEffect(clipId, effectId, bypassed = true) {
		if (typeof bypassed !== 'boolean') throw new TypeError('Video effect bypass state must be boolean.');
		return updateVideoClipEffect(clipId, effectId, { enabled: !bypassed });
	}

	function reorderVideoClipEffect(clipId, effectId, toIndex) {
		if (editingBlocked()) return null;
		videoClipEffect(clipId, effectId);
		return commit({ type: 'video-effect/reorder', clipId, effectId, toIndex }, { selectClipId: clipId });
	}

	function removeVideoClipEffect(clipId, effectId) {
		if (editingBlocked()) return null;
		videoClipEffect(clipId, effectId);
		state.videoEffectGestures.delete(videoEffectGestureKey(clipId, effectId));
		return commit({ type: 'video-effect/remove', clipId, effectId }, { selectClipId: clipId });
	}

	function beginVideoEffectGesture(clipId, effectId) {
		if (editingBlocked()) return null;
		const { effect } = videoClipEffect(clipId, effectId);
		const key = videoEffectGestureKey(clipId, effectId);
		if (!state.videoEffectGestures.has(key)) {
			state.videoEffectGestures.set(key, {
				original: structuredClone(effect.params),
				params: structuredClone(effect.params),
			});
		}
		return structuredClone(state.videoEffectGestures.get(key).original);
	}

	function previewVideoEffectGesture(clipId, effectId, params = {}) {
		if (editingBlocked()) return null;
		const { effect } = videoClipEffect(clipId, effectId);
		const key = videoEffectGestureKey(clipId, effectId);
		if (!state.videoEffectGestures.has(key)) beginVideoEffectGesture(clipId, effectId);
		const gesture = state.videoEffectGestures.get(key);
		const normalized = normalizeVideoEffect({
			...effect,
			params: { ...gesture.params, ...params },
		}).params;
		gesture.params = structuredClone(normalized);
		publishDocumentSnapshot();
		return structuredClone(normalized);
	}

	function commitVideoEffectGesture(clipId, effectId, params = {}) {
		if (state.readOnly) throw new Error(copy.projectReadOnly);
		const { effect } = videoClipEffect(clipId, effectId);
		const key = videoEffectGestureKey(clipId, effectId);
		const gesture = state.videoEffectGestures.get(key);
		const normalized = normalizeVideoEffect({
			...effect,
			params: { ...effect.params, ...(gesture?.params || {}), ...params },
		}).params;
		state.videoEffectGestures.delete(key);
		if (JSON.stringify(effect.params) === JSON.stringify(normalized)) {
			publishDocumentSnapshot();
			return project;
		}
		return commit({
			type: 'video-effect/update',
			clipId,
			effectId,
			changes: { params: normalized },
		}, { selectClipId: clipId });
	}

	function cancelVideoEffectGesture(clipId, effectId) {
		const key = videoEffectGestureKey(clipId, effectId);
		const removed = state.videoEffectGestures.delete(key);
		if (removed) publishDocumentSnapshot();
		return removed;
	}

	function addEffect(request = {}) {
		if (editingBlocked()) return;
		if (!request.type) throw new TypeError(copy.effectTypeRequired);
		const scope = ['master', 'group', 'send'].includes(request.scope) ? request.scope : 'track';
		const trackId = request.trackId ?? request.busId ?? state.selectedTrackId;
		if (scope === 'track' && !trackId) return handleError(new Error(copy.selectTrackFirst));
		if (scope === 'track' && findTrack(project, trackId)?.type !== 'audio') {
			return handleError(new Error(copy.audioTrackRequired));
		}
		if ((scope === 'group' || scope === 'send') && !trackId) throw new TypeError('A mixer bus ID is required.');
		const type = request.type;
		if (!audioEffectTypes().includes(type)) throw new Error(copy.effectUnsupported);
		const effectOptions = { ...(request.options || {}) };
		if (type === 'audacity-auto-duck') {
			const candidates = project.tracks.filter((track) => (
				track.type === 'audio' && (scope === 'master' || track.id !== trackId)
			));
			const requestedControlTrackId = effectOptions.context?.controlTrackId || state.audacityControlTrackId;
			const controlTrackId = candidates.some((track) => track.id === requestedControlTrackId)
				? requestedControlTrackId
				: candidates[0]?.id;
			if (!controlTrackId) {
				return handleError(new Error(copy.autoDuckOtherControlTrack));
			}
			effectOptions.context = { ...effectOptions.context, controlTrackId };
		}
		if (type === 'audacity-noise-reduction') {
			effectOptions.context = {
				...effectOptions.context,
				noiseProfile: effectOptions.context?.noiseProfile || serializeAudacityNoiseProfile(state.audacityNoiseProfile),
			};
			if (!effectOptions.context.noiseProfile) effectOptions.enabled = false;
		}
		const effect = createEffect(type, effectOptions);
		commit({ type: 'effect/add', scope, trackId, busId: trackId, effect });
		if (type === 'audacity-noise-reduction' && !effectOptions.context.noiseProfile) {
			setStatus(copy.noiseReductionAddedDisabled);
		}
		return effect.id;
	}

	function updateRackEffect(scope, trackId, effectId, changes = {}) {
		const effect = effectStack(scope, trackId).find((candidate) => candidate.id === effectId);
		if (!effect) throw new Error(copy.rackEffectNotFound);
		if (effect.type === 'missing') {
			const keys = Object.keys(changes || {});
			const replacing = typeof changes.type === 'string' && changes.type !== 'missing';
			const activationOnly = keys.every((key) => key === 'enabled');
			if (!replacing && !activationOnly) throw new Error(copy.missingEffectReadOnly);
		}
		return commit({ type: 'effect/update', scope, trackId, busId: trackId, effectId, changes });
	}

	function beginRackEffectGesture(scope, targetId, effectId) {
		const effect = effectStack(scope, targetId).find((candidate) => candidate.id === effectId);
		if (!effect || effect.type === 'missing' || effect.type === 'eq') throw new Error(copy.rackEffectNotFound);
		const key = effectGestureKey(scope, targetId, effectId);
		if (!state.rackEffectGestures.has(key)) {
			state.rackEffectGestures.set(key, structuredClone(effect.params));
		}
		return structuredClone(state.rackEffectGestures.get(key));
	}

	function previewRackEffect(scope, targetId, effectId, params) {
		const effect = effectStack(scope, targetId).find((candidate) => candidate.id === effectId);
		if (!effect || effect.type === 'missing' || effect.type === 'eq') throw new Error(copy.rackEffectNotFound);
		const key = effectGestureKey(scope, targetId, effectId);
		if (!state.rackEffectGestures.has(key)) beginRackEffectGesture(scope, targetId, effectId);
		const normalized = normalizeEffect({
			...effect,
			params: { ...effect.params, ...params },
		}).params;
		return engine.configureRackEffect?.(scope, targetId, effectId, normalized) ?? false;
	}

	function commitRackEffectGesture(scope, targetId, effectId, params) {
		if (state.readOnly) throw new Error(copy.projectReadOnly);
		const effect = effectStack(scope, targetId).find((candidate) => candidate.id === effectId);
		if (!effect || effect.type === 'missing' || effect.type === 'eq') throw new Error(copy.rackEffectNotFound);
		const key = effectGestureKey(scope, targetId, effectId);
		const original = state.rackEffectGestures.get(key) || effect.params;
		const normalized = normalizeEffect({
			...effect,
			params: { ...effect.params, ...params },
		}).params;
		const unchanged = JSON.stringify(normalizeEffect({ ...effect, params: original }).params) === JSON.stringify(normalized);
		if (unchanged) {
			state.rackEffectGestures.delete(key);
			return project;
		}
		const adopted = engine.configureRackEffect?.(scope, targetId, effectId, normalized) ?? false;
		state.rackEffectGestures.delete(key);
		try {
			return commit(
				{ type: 'effect/update', scope, trackId: targetId, busId: targetId, effectId, changes: { params: normalized } },
				{},
				{ skipPlaybackEngine: adopted !== false },
			);
		} catch (error) {
			if (adopted !== false) engine.configureRackEffect?.(scope, targetId, effectId, original);
			throw error;
		}
	}

	function cancelRackEffectGesture(scope, targetId, effectId) {
		const key = effectGestureKey(scope, targetId, effectId);
		const original = state.rackEffectGestures.get(key);
		state.rackEffectGestures.delete(key);
		if (!original) return false;
		return engine.configureRackEffect?.(scope, targetId, effectId, original) ?? false;
	}

	function beginParametricEqGesture(scope, targetId, effectId) {
		const effect = effectStack(scope, targetId).find((candidate) => candidate.id === effectId);
		if (!effect || effect.type !== 'eq') throw new Error(copy.rackEffectNotFound);
		const key = effectGestureKey(scope, targetId, effectId);
		if (!state.parametricEqGestures.has(key)) {
			state.parametricEqGestures.set(key, structuredClone(effect.params));
		}
		return structuredClone(state.parametricEqGestures.get(key));
	}

	function previewParametricEq(scope, targetId, effectId, params) {
		const effect = effectStack(scope, targetId).find((candidate) => candidate.id === effectId);
		if (!effect || effect.type !== 'eq') throw new Error(copy.rackEffectNotFound);
		const key = effectGestureKey(scope, targetId, effectId);
		if (!state.parametricEqGestures.has(key)) beginParametricEqGesture(scope, targetId, effectId);
		const normalized = normalizeEffect({ ...effect, params }).params;
		return engine.configureParametricEq?.(scope, targetId, effectId, normalized) ?? false;
	}

	function commitParametricEqGesture(scope, targetId, effectId, params) {
		if (state.readOnly) throw new Error(copy.projectReadOnly);
		const effect = effectStack(scope, targetId).find((candidate) => candidate.id === effectId);
		if (!effect || effect.type !== 'eq') throw new Error(copy.rackEffectNotFound);
		const key = effectGestureKey(scope, targetId, effectId);
		const original = state.parametricEqGestures.get(key) || effect.params;
		const normalized = normalizeEffect({ ...effect, params }).params;
		const unchanged = JSON.stringify(normalizeEffect({ ...effect, params: original }).params) === JSON.stringify(normalized);
		if (unchanged) {
			state.parametricEqGestures.delete(key);
			return project;
		}
		const adopted = engine.configureParametricEq?.(scope, targetId, effectId, normalized) ?? false;
		state.parametricEqGestures.delete(key);
		try {
			return commit(
				{ type: 'effect/update', scope, trackId: targetId, busId: targetId, effectId, changes: { params: normalized } },
				{},
				{ skipPlaybackEngine: adopted !== false },
			);
		} catch (error) {
			if (adopted !== false) engine.configureParametricEq?.(scope, targetId, effectId, original, { transitionFrames: 0 });
			throw error;
		}
	}

	function cancelParametricEqGesture(scope, targetId, effectId) {
		const key = effectGestureKey(scope, targetId, effectId);
		const original = state.parametricEqGestures.get(key);
		state.parametricEqGestures.delete(key);
		if (!original) return false;
		return engine.configureParametricEq?.(scope, targetId, effectId, original) ?? false;
	}

	function effectStack(scope, trackId, snapshot = project) {
		if (scope === 'master') return snapshot?.master?.effects || [];
		if (scope === 'group' || scope === 'send') {
			const buses = scope === 'group' ? snapshot?.mixer?.groups : snapshot?.mixer?.sends;
			const bus = (buses || []).find((candidate) => String(candidate.id) === String(trackId));
			if (!bus) throw new Error('Mixer bus not found.');
			return bus.effects || [];
		}
		if (scope !== 'track') throw new RangeError('Effect stack scope must be track, master, group, or send.');
		const track = findTrack(snapshot, trackId);
		if (!track || track.type !== 'audio') throw new Error(copy.audioTrackNotFound);
		return track.effects || [];
	}

	function effectGestureKey(scope, targetId, effectId) {
		return `${scope || 'track'}:${targetId == null ? '' : targetId}:${effectId}`;
	}

	function copyEffectStack(scope, trackId = state.selectedTrackId) {
		const effects = effectStack(scope, trackId);
		state.effectClipboard = effects.map((effect) => structuredClone(effect));
		publishDocumentSnapshot();
		return state.effectClipboard.map((effect) => structuredClone(effect));
	}

	function pasteEffectStack(scope, trackId = state.selectedTrackId) {
		if (editingBlocked()) return null;
		if (state.effectClipboard === null) throw new Error(copy.pasteEffects || copy.paste);
		const current = effectStack(scope, trackId);
		const effects = state.effectClipboard.map((effect) => materializeRackEffect(effect, scope, trackId));
		const commands = [
			...current.map((effect) => ({
				type: 'effect/remove', scope, trackId, busId: trackId, effectId: effect.id,
			})),
			...effects.map((effect) => ({ type: 'effect/add', scope, trackId, busId: trackId, effect })),
		];
		if (commands.length) commit({ type: 'batch', commands });
		return effects.map((effect) => structuredClone(effect));
	}

	function materializeRackEffect(effect, scope, trackId, options = {}) {
		if (effect.type === 'missing') {
			return {
				...structuredClone(effect),
				id: createStableId('effect'),
				enabled: options.forceEnabled ? true : effect.enabled !== false,
				bypassed: true,
			};
		}
		const effectOptions = {
			enabled: options.forceEnabled ? true : effect.enabled !== false,
			params: structuredClone(effect.params || {}),
		};
		if (effect.context !== undefined) effectOptions.context = structuredClone(effect.context);
		if (effect.state !== undefined) effectOptions.state = structuredClone(effect.state);
		if (effect.type === 'audacity-auto-duck') {
			const requestedControlTrackId = effectOptions.context?.controlTrackId || state.audacityControlTrackId;
			const candidates = project.tracks.filter((track) => (
				track.type === 'audio' && (scope === 'master' || track.id !== trackId)
			));
			const controlTrackId = candidates.some((track) => track.id === requestedControlTrackId)
				? requestedControlTrackId
				: candidates[0]?.id;
			if (!controlTrackId) throw new Error(copy.autoDuckOtherControlTrack);
			effectOptions.context = { ...effectOptions.context, controlTrackId };
		}
		if (effect.type === 'audacity-noise-reduction') {
			const noiseProfile = effectOptions.context?.noiseProfile || serializeAudacityNoiseProfile(state.audacityNoiseProfile);
			if (!noiseProfile && options.requireNoiseProfile) throw new Error(copy.noiseProfileMissing);
			if (noiseProfile) effectOptions.context = { ...effectOptions.context, noiseProfile };
			else effectOptions.enabled = false;
		}
		return createEffect(effect.type, effectOptions);
	}

	async function runEffectMacro(request = {}) {
		if (editingBlocked()) return null;
		const target = audacityEffectTarget(request.trackId);
		if (!target) throw new Error(copy.macroSelectionRequired || copy.audacitySelectionHint);
		const requestedEffects = Array.isArray(request.effects) ? request.effects : [];
		const enabledEffects = requestedEffects.filter((effect) => (
			effect?.enabled !== false && effect?.type !== 'missing'
		));
		if (!enabledEffects.length) throw new Error(copy.macroEffectsRequired || copy.effectRackEmpty);
		const effects = enabledEffects.map((effect) => materializeRackEffect(effect, 'track', target.track.id, {
			forceEnabled: true,
			requireNoiseProfile: true,
		}));
		const sampleRate = projectSampleRate();
		const preRollFrames = Math.min(target.startFrame, sampleRate * 10);
		const outputBytes = target.durationFrames * target.channelCount * Float32Array.BYTES_PER_ELEMENT;
		const processingFrames = target.durationFrames + preRollFrames;
		const latencyFrames = effectRackLatencyFrames(effects, sampleRate);
		const offlineBytes = (processingFrames + latencyFrames) * 2 * Float32Array.BYTES_PER_ELEMENT;
		let estimatedPeakBytes = offlineBytes * 2 + outputBytes * 3;
		for (const effect of effects) {
			if (!isAudacityRackEffectType(effect.type)) continue;
			estimatedPeakBytes = Math.max(estimatedPeakBytes, estimateAudacityEffectPeakBytes(
				effect.type,
				processingFrames,
				effect.params,
				{
					channelCount: target.channelCount,
					controlChannelCount: effect.type === 'audacity-auto-duck' ? 2 : undefined,
					sampleRate,
				},
			));
		}
		if (estimatedPeakBytes > AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES) throw audacityEffectMemoryError(copy);
		// Claim the shared destructive-effect slot before the first await. This
		// makes double activation and competing edits observe a blocked controller.
		state.audacityEffectProcessing = true;
		setStatus(copy.macroProcessing || copy.audacityProcessing);
		publishDocumentSnapshot();
		try {
			await preflightStorage(outputBytes, 'effect');
			const snapshot = cloneProject(project);
			const snapshotTrack = findTrack(snapshot, target.track.id);
			if (!snapshotTrack) throw new Error(copy.audioTrackNotFound);
			snapshotTrack.effects = effects;
			snapshotTrack.gain = 1;
			snapshotTrack.pan = 0;
			snapshotTrack.mute = false;
			snapshotTrack.solo = false;
			snapshotTrack.envelope = [];
			snapshot.master = { ...snapshot.master, gain: 1, pan: 0, mute: false, effects: [] };
			snapshot.mixer = { ...snapshot.mixer, groups: [], sends: [], routes: {} };
			const rendered = await renderSnapshot(snapshot, {
				startFrame: target.startFrame,
				endFrame: target.endFrame,
				trackId: target.track.id,
				includeMaster: false,
				includeTrackPan: false,
				respectMuteSolo: false,
				outputFrames: target.durationFrames,
				preRollFrames,
			});
			const channels = matchAudacitySelectionChannels(audioBufferChannels(rendered), target.channelCount);
			const effectName = String(request.name || copy.untitledMacro || copy.macroManager).trim()
				|| copy.untitledMacro
				|| copy.macroManager;
			await persistAudacityEffectResult(target, null, channels, { effectName });
			setStatus(copy.macroApplied || copy.audacityApplied, 'success');
			return true;
		} catch (error) {
			handleError(error);
			throw error;
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	function currentAudacityEffectParams(type = state.audacityEffectType) {
		if (!state.audacityEffectParams[type]) state.audacityEffectParams[type] = audioSelectionEffectDefaults(type);
		return state.audacityEffectParams[type];
	}

	function setAudacityEffectParams(changes, { markTouched = true } = {}) {
		const normalized = normalizeAudioSelectionEffectParams(state.audacityEffectType, {
			...currentAudacityEffectParams(),
			...changes,
		});
		state.audacityEffectParams[state.audacityEffectType] = normalized;
		if (state.audacityEffectType === 'eq') state.audacityPreviewSource?.configure?.(normalized);
		if (markTouched) {
			if (!state.audacityEffectTouchedParams.has(state.audacityEffectType)) {
				state.audacityEffectTouchedParams.set(state.audacityEffectType, new Set());
			}
			const touched = state.audacityEffectTouchedParams.get(state.audacityEffectType);
			for (const name of Object.keys(changes)) touched.add(name);
		}
	}

	function setAudacityEffectType(type) {
		if (!AUDIO_SELECTION_EFFECT_DEFINITIONS[type]) throw new Error(copy.selectionEffectUnsupported);
		if (type !== state.audacityEffectType) state.audacityPreviewAuditionBandId = null;
		state.audacityEffectType = type;
		publishDocumentSnapshot();
		return currentAudacityEffectParams(type);
	}

	function setAudacityEffectParamsFromController(changes, options) {
		setAudacityEffectParams(changes, options);
		publishDocumentSnapshot();
		return currentAudacityEffectParams();
	}

	function setAudacityControlTrack(trackId) {
		if (trackId != null && !findTrack(project, trackId)) throw new Error(copy.controlTrackNotFound);
		state.audacityControlTrackId = trackId || null;
		publishDocumentSnapshot();
		return state.audacityControlTrackId;
	}

	async function persistEffectPresets(next) {
		state.effectPresets = createAudioEditorEffectPresets(next);
		await store.saveSetting('audio-editor-effect-presets-v1', state.effectPresets);
		publishDocumentSnapshot();
		return state.effectPresets;
	}

	function applyEffectPreset(presetId) {
		const preset = applyAudioEditorEffectPreset(state.effectPresets, presetId);
		state.audacityEffectType = preset.effectType;
		state.audacityEffectParams[preset.effectType] = structuredClone(preset.params);
		state.audacityEffectTouchedParams.set(preset.effectType, new Set(Object.keys(preset.params)));
		publishDocumentSnapshot();
		return preset;
	}

	async function saveEffectPreset(options = {}) {
		const request = typeof options === 'string' ? { name: options } : options;
		const result = saveAudioEditorEffectPreset(state.effectPresets, {
			...request,
			effectType: request.effectType || state.audacityEffectType,
			params: request.params || currentAudacityEffectParams(request.effectType || state.audacityEffectType),
			idFactory: () => createStableId('preset'),
		});
		await persistEffectPresets(result.state);
		return result.preset;
	}

	async function deleteEffectPreset(presetId) {
		await persistEffectPresets(deleteAudioEditorEffectPreset(state.effectPresets, presetId));
		return true;
	}

	async function importEffectPresets(input) {
		const next = importAudioEditorEffectPresets(state.effectPresets, input, {
			idFactory: () => createStableId('preset'),
		});
		await persistEffectPresets(next);
		return listAudioEditorEffectPresets(state.effectPresets, state.audacityEffectType);
	}

	function exportEffectPreset(presetId) {
		return exportAudioEditorEffectPreset(state.effectPresets, presetId);
	}

	async function applyAudacityEffectFromController(request = {}) {
		cancelAudacityEffectPreview({ publish: false });
		if (request.type) setAudacityEffectType(request.type);
		if (request.params) setAudacityEffectParamsFromController(request.params);
		if ('controlTrackId' in request) setAudacityControlTrack(request.controlTrackId);
		return applySelectedAudacityEffect();
	}

	async function previewAudacityEffectFromController(request = {}) {
		if (state.audacityEffectProcessing) return false;
		cancelAudacityEffectPreview({ publish: false });
		const previewGeneration = state.audacityPreviewGeneration;
		const requireCurrentPreview = (source = null) => {
			if (previewGeneration === state.audacityPreviewGeneration) return;
			if (source) {
				try { source.onended = null; source.onerror = null; source.stop?.(); } catch { /* A stale source may not have started. */ }
				try { source.disconnect?.(); } catch { /* A stale source may already be disconnected. */ }
			}
			throw abortError();
		};
		if (request.type) setAudacityEffectType(request.type);
		if (request.params) setAudacityEffectParamsFromController(request.params);
		if ('controlTrackId' in request) setAudacityControlTrack(request.controlTrackId);
		const fullTarget = audacityEffectTarget();
		if (!fullTarget) throw new Error(copy.audacitySelectionHint);
		const type = state.audacityEffectType;
		const definition = AUDIO_SELECTION_EFFECT_DEFINITIONS[type];
		const sampleRate = projectSampleRate();
		const spectralSelection = audacitySpectralEffectContext(fullTarget, definition);
		const durationFrames = Math.min(fullTarget.durationFrames, sampleRate * 6);
		const target = {
			...fullTarget,
			endFrame: fullTarget.startFrame + durationFrames,
			durationFrames,
		};
		let params = normalizeAudioSelectionEffectParams(type, currentAudacityEffectParams());
		if (definition.requiresNoiseProfile && !state.audacityNoiseProfile) throw new Error(copy.noiseProfileMissing);
		if (definition.requiresControlTrack && !state.audacityControlTrackId) throw new Error(copy.autoDuckControlTrack);
		const contextFrames = definition.preRollSeconds
			? Math.min(fullTarget.startFrame, Math.ceil(definition.preRollSeconds * sampleRate))
			: definition.requiresStaffPad
			? sampleRate
			: definition.requiresContext ? 128 : 0;
		const afterContextFrames = definition.preRollSeconds ? 0 : contextFrames;
		const estimatedPeakBytes = estimateAudioSelectionEffectPeakBytes(type, durationFrames, params, {
			channelCount: target.channelCount,
			controlChannelCount: definition.requiresControlTrack ? 2 : undefined,
			sampleRate,
			beforeFrames: contextFrames,
			afterFrames: afterContextFrames,
			spectralWindowSize: spectralSelection?.windowSize,
		});
		if (estimatedPeakBytes > AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES) throw audacityEffectMemoryError(copy);
		state.audacityEffectProcessing = true;
		setStatus(copy.audacityPreviewProcessing || copy.audacityProcessing);
		publishDocumentSnapshot();
		try {
			const channels = await renderDryTrackRange(target.track.id, target.startFrame, target.endFrame, target.channelCount, target.clipIds);
			requireCurrentPreview();
			params = resolveInteractiveAudacityParams(type, params, channels);
			if (type === 'eq') {
				engine.pause();
				const context = await engine.getAudioContext({ resume: true });
				requireCurrentPreview();
				const buffer = await bufferFromChannels(channels, sampleRate, context, copy);
				requireCurrentPreview();
				if (typeof engine.createParametricEqPreview !== 'function') {
					throw new Error('This browser cannot preview the parametric EQ without bypassing it.');
				}
				const preview = await engine.createParametricEqPreview(buffer, params, {
					effectId: 'selection-preview-eq',
				});
				requireCurrentPreview(preview);
				preview.onended = () => {
					if (state.audacityPreviewSource !== preview) return;
					state.audacityPreviewSource = null;
					preview.disconnect?.();
					setStatus(copy.audacityPreviewComplete || copy.ready, 'success');
					publishDocumentSnapshot();
				};
				state.audacityPreviewSource = preview;
				preview.onerror = () => {
					if (state.audacityPreviewSource !== preview) return;
					state.audacityPreviewSource = null;
					preview.onended = null;
					try { preview.stop?.(); } catch { /* A failed preview may already have ended. */ }
					preview.disconnect?.();
					publishDocumentSnapshot();
				};
				if (state.audacityPreviewSource !== preview) return false;
				if (state.audacityPreviewAuditionBandId != null) {
					preview.audition?.(state.audacityPreviewAuditionBandId);
				}
				preview.start();
				setStatus(copy.audacityPreviewPlaying || copy.playing, 'success');
				return true;
			}
			const effectContext = {};
			if (spectralSelection) effectContext.spectralSelection = spectralSelection;
			if (definition.requiresControlTrack) {
				effectContext.controlChannels = await renderDryTrackRange(
					state.audacityControlTrackId,
					target.startFrame,
					target.endFrame,
				);
			}
			if (definition.requiresNoiseProfile) effectContext.noiseProfile = state.audacityNoiseProfile;
			if (contextFrames > 0) {
				const beforeStart = Math.max(0, target.startFrame - contextFrames);
				effectContext.beforeChannels = beforeStart < target.startFrame
					? await renderDryTrackRange(target.track.id, beforeStart, target.startFrame, target.channelCount, target.clipIds)
					: channels.map(() => new Float32Array(0));
				if (afterContextFrames > 0) {
					const afterEnd = Math.min(projectDurationFrames(project), target.endFrame + afterContextFrames);
					effectContext.afterChannels = target.endFrame < afterEnd
						? await renderDryTrackRange(target.track.id, target.endFrame, afterEnd, target.channelCount, target.clipIds)
						: channels.map(() => new Float32Array(0));
				}
			}
			const result = await runSelectionEffectWorker({
				operation: 'apply', effectType: type, channels, sampleRate, params, context: effectContext,
			});
			requireCurrentPreview();
			assertAudacityEffectOutput(result.channels);
			const context = await engine.getAudioContext({ resume: true });
			await context.resume?.();
			requireCurrentPreview();
			const buffer = await bufferFromChannels(result.channels, sampleRate, context, copy);
			requireCurrentPreview();
			const source = context.createBufferSource();
			source.buffer = buffer;
			source.connect(context.destination);
			source.onended = () => {
				if (state.audacityPreviewSource !== source) return;
				state.audacityPreviewSource = null;
				source.disconnect?.();
				setStatus(copy.audacityPreviewComplete || copy.ready, 'success');
				publishDocumentSnapshot();
			};
			engine.pause();
			state.audacityPreviewSource = source;
			source.start();
			setStatus(copy.audacityPreviewPlaying || copy.playing, 'success');
			return true;
		} catch (error) {
			if (error?.name === 'AbortError') return false;
			throw error;
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	function cancelAudacityEffectPreview(options = {}) {
		state.audacityPreviewGeneration += 1;
		const source = state.audacityPreviewSource;
		state.audacityPreviewSource = null;
		state.audacityPreviewAuditionBandId = null;
		if (source) {
			try { source.onended = null; source.onerror = null; source.stop(); } catch { /* The preview may already have ended. */ }
			try { source.disconnect?.(); } catch { /* The preview node may already be disconnected. */ }
		}
		if (options.publish !== false) {
			setStatus(copy.audacityPreviewCancelled || copy.ready);
			publishDocumentSnapshot();
		}
		return Boolean(source);
	}

	async function repeatLastAudacityEffect() {
		if (!state.lastAudacityEffect) throw new Error(copy.noRepeatableEffect || copy.audacitySelectionHint);
		const previous = state.lastAudacityEffect;
		setAudacityEffectType(previous.type);
		setAudacityEffectParamsFromController(structuredClone(previous.params), { markTouched: false });
		if (previous.controlTrackId && findTrack(project, previous.controlTrackId)) {
			setAudacityControlTrack(previous.controlTrackId);
		}
		return applySelectedAudacityEffect();
	}

	function captureRackNoiseProfileFromController(scope, trackId, effectId) {
		const normalizedScope = scope === 'master' ? 'master' : 'track';
		const rack = normalizedScope === 'master' ? project?.master?.effects : findTrack(project, trackId)?.effects;
		const effect = rack?.find((candidate) => candidate.id === effectId);
		if (!effect) throw new Error(copy.rackEffectNotFound);
		return captureRackNoiseProfile(effect, normalizedScope, trackId || null);
	}

	function resolveInteractiveAudacityParams(type, params, channels) {
		if (type !== 'audacity-amplify' || state.audacityEffectTouchedParams.get(type)?.has('gainDb')) return params;
		let peak = 0;
		for (const channel of channels) {
			for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
		}
		const gainDb = peak > 0
			? Math.max(-50, Math.min(50, 20 * Math.log10(1 / peak)))
			: 0;
		const resolved = normalizeAudioSelectionEffectParams(type, { ...params, gainDb });
		state.audacityEffectParams[type] = resolved;
		return resolved;
	}

	function audacityEffectTarget(requestedTrackId = state.selectedTrackId) {
		const editingSelection = resolveEditingSelection(project, { selectedClipId: state.selectedClipId });
		const selectedClip = editingSelection?.kind === 'clips'
			? editingSelection.clipIds.map((clipId) => findClip(project, clipId)).find((clip) => (
				clip?.kind !== 'video'
				&& (!requestedTrackId || findClipTrack(project, clip.id)?.id === requestedTrackId)
			)) || null
			: null;
		const selectedClipTrack = selectedClip ? findClipTrack(project, selectedClip.id) : null;
		const track = findTrack(project, requestedTrackId) || selectedClipTrack;
		if (!track) return null;
		const selection = activeSelection();
		const trackClip = selectedClipTrack?.id === track.id ? selectedClip : null;
		const startFrame = selection?.startFrame ?? trackClip?.timelineStartFrame;
		const endFrame = selection?.endFrame ?? (trackClip ? trackClip.timelineStartFrame + trackClip.durationFrames : null);
		if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || endFrame <= startFrame) return null;
		const channelCount = audacitySelectionChannelCount(project, track.id, startFrame, endFrame);
		return channelCount ? {
			track,
			...(trackClip ? { clipId: trackClip.id, clipIds: [trackClip.id] } : {}),
			startFrame,
			endFrame,
			durationFrames: endFrame - startFrame,
			channelCount,
			hasAudio: true,
		} : null;
	}

	function audacityEffectTargets(options = {}) {
		const editingSelection = resolveEditingSelection(project, { selectedClipId: state.selectedClipId });
		const selection = activeSelection();
		if (editingSelection?.kind === 'clips') {
			return editingSelection.clipIds
				.map((clipId) => {
					const clip = findClip(project, clipId);
					const track = clip ? findClipTrack(project, clip.id) : null;
					if (!clip || clip.kind === 'video' || track?.type !== 'audio') return null;
					const startFrame = clip.timelineStartFrame;
					const endFrame = clip.timelineStartFrame + clip.durationFrames;
					const channelCount = audacitySelectionChannelCount(project, track.id, startFrame, endFrame)
						|| audioTrackChannelCountV2(project, track, 1);
					return {
						track,
						clipId: clip.id,
						clipIds: [clip.id],
						startFrame,
						endFrame,
						durationFrames: clip.durationFrames,
						channelCount,
						hasAudio: true,
					};
				})
				.filter(Boolean);
		}
		if (!selection) {
			const target = audacityEffectTarget();
			return target ? [target] : [];
		}
		if (!selection.trackIds?.length) {
			const target = audacityEffectTarget();
			return target ? [target] : [];
		}
		const selectedTrackIds = new Set(selection.trackIds);
		return project.tracks.filter((track) => track.type === 'audio' && selectedTrackIds.has(track.id))
			.map((track) => {
				const channelCount = audacitySelectionChannelCount(
					project,
					track.id,
					selection.startFrame,
					selection.endFrame,
				);
				const hasAudio = Boolean(channelCount);
				if (!hasAudio && !options.includeSilentTracks) return null;
				return {
					track,
					startFrame: selection.startFrame,
					endFrame: selection.endFrame,
					durationFrames: selection.endFrame - selection.startFrame,
					channelCount: channelCount || audioTrackChannelCountV2(project, track, 1),
					hasAudio,
				};
			})
			.filter(Boolean);
	}

	function audacityEffectSelectionDetails(selection, targets) {
		const clipIds = targets.map((target) => target.clipId).filter(Boolean);
		return {
			trackIds: selection?.trackIds?.length
				? [...selection.trackIds]
				: targets.map((target) => target.track.id),
			clipIds,
			frequencyRange: selection?.frequencyRange || null,
		};
	}

	function audacitySpectralEffectContext(target, definition) {
		const frequencyRange = activeSelection()?.frequencyRange;
		if (!frequencyRange) return null;
		// Parametric EQ intentionally treats a spectral box as a time range and
		// processes the complete spectrum; the box itself remains selected.
		if (state.audacityEffectType === 'eq') return null;
		if (definition.lengthChanging) throw new Error(copy.spectralEffectLengthChanging);
		return {
			minimumFrequency: frequencyRange.minimumFrequency,
			maximumFrequency: frequencyRange.maximumFrequency,
			windowSize: target.track.spectrogram?.windowSize || 2_048,
		};
	}

	function setSpectralBoxSelection(options = {}) {
		if (editingBlocked()) return null;
		if (project.schemaVersion < 2) throw new Error(copy.v2Required);
		const selectedClip = state.selectedClipId ? findClip(project, state.selectedClipId) : null;
		const clipTrack = selectedClip ? findClipTrack(project, selectedClip.id) : null;
		const track = findTrack(project, state.selectedTrackId) || clipTrack;
		if (!track || track.type !== 'audio') throw new Error(copy.audioTrackRequired);
		const current = activeSelection();
		const trackRange = selectedTracksTimeRange();
		const startFrame = current?.startFrame ?? selectedClip?.timelineStartFrame ?? trackRange?.startFrame;
		const endFrame = current?.endFrame
			?? (selectedClip ? selectedClip.timelineStartFrame + selectedClip.durationFrames : trackRange?.endFrame);
		if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || endFrame <= startFrame) {
			throw new Error(copy.timeSelectionRequired);
		}
		const nyquist = projectSampleRate() / 2;
		const minimumFrequency = Number(options.minimumFrequency ?? track.spectrogram?.minimumFrequency ?? 0);
		const maximumFrequency = Number(options.maximumFrequency ?? track.spectrogram?.maximumFrequency ?? nyquist);
		const parameterRangeError = copy.parameterRangeError;
		if (!Number.isFinite(minimumFrequency) || minimumFrequency < 0 || minimumFrequency >= nyquist) {
			throw new RangeError(copy.minimumFrequencyInvalid || parameterRangeError
				.replace('{label}', copy.minimumFrequency)
				.replace('{minimum}', '0')
				.replace('{maximum}', String(nyquist)));
		}
		if (!Number.isFinite(maximumFrequency) || maximumFrequency <= minimumFrequency || maximumFrequency > nyquist) {
			throw new RangeError(copy.maximumFrequencyInvalid || parameterRangeError
				.replace('{label}', copy.maximumFrequency)
				.replace('{minimum}', String(minimumFrequency))
				.replace('{maximum}', String(nyquist)));
		}
		return setSelection(startFrame, endFrame, {
			trackIds: current?.trackIds?.length ? current.trackIds : [track.id],
			clipIds: current?.clipIds || (selectedClip ? [selectedClip.id] : []),
			frequencyRange: { minimumFrequency, maximumFrequency },
		}).selection;
	}

	async function applySpectralSelection(requestedGainDb) {
		if (editingBlocked()) return null;
		if (project.schemaVersion < 2) throw new Error(copy.v2Required);
		const selection = activeSelection();
		const frequencyRange = selection?.frequencyRange;
		const targets = audacityEffectTargets();
		if (!targets.length || !frequencyRange) throw new Error(copy.spectralSelectionRequired || copy.audacitySelectionHint);
		const gainDb = Number(requestedGainDb);
		if (gainDb !== -Infinity && (!Number.isFinite(gainDb) || gainDb > 120 || gainDb < -120)) {
			throw new RangeError(copy.spectralGainInvalid);
		}
		const outputBytes = targets.reduce((sum, target) => (
			sum + target.durationFrames * target.channelCount * Float32Array.BYTES_PER_ELEMENT
		), 0);
		await preflightStorage(outputBytes, 'effect');
		state.audacityEffectProcessing = true;
		setStatus(copy.spectralProcessing || copy.audacityProcessing);
		publishDocumentSnapshot();
		try {
			const results = [];
			for (const target of targets) {
				const channels = await renderDryTrackRange(
					target.track.id,
					target.startFrame,
					target.endFrame,
					target.channelCount,
					target.clipIds,
				);
				const processed = await runSpectralEditWorker(channels, {
					sampleRate: projectSampleRate(),
					startFrame: 0,
					endFrame: target.durationFrames,
					minimumFrequency: frequencyRange.minimumFrequency,
					maximumFrequency: frequencyRange.maximumFrequency,
					windowSize: target.track.spectrogram?.windowSize || 2_048,
					gainDb,
				});
				results.push({ target, channels: processed });
			}
			await persistAudacityEffectResults(results, null, {
				effectName: gainDb === -Infinity ? copy.spectralDelete : copy.spectralAmplify,
				selectionDetails: audacityEffectSelectionDetails(selection, targets),
			});
			setStatus(copy.spectralApplied || copy.audacityApplied, 'success');
			return true;
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	async function runSpectralEditWorker(channels, spectralOptions) {
		if (typeof Worker !== 'function') {
			await initializePffft();
			return applySpectralGain(channels, spectralOptions);
		}
		const worker = new Worker(new URL('./spectral-edit-worker.js', import.meta.url), { type: 'module' });
		state.spectralWorker = worker;
		const workerChannels = channels.map((channel) => Float32Array.from(channel));
		try {
			return await new Promise((resolve, reject) => {
				worker.onmessage = ({ data }) => {
					if (data.type === 'error') {
						const error = new Error(data.message || copy.effectProcessingFailed);
						error.name = data.name || 'Error';
						reject(error);
						return;
					}
					if (data.type === 'result') resolve((data.channels || []).map((channel) => (
						channel instanceof Float32Array ? channel : new Float32Array(channel)
					)));
				};
				worker.onerror = (event) => reject(new Error(event.message || copy.effectProcessingFailed));
				worker.postMessage(
					{ channels: workerChannels, options: spectralOptions },
					workerChannels.map((channel) => channel.buffer),
				);
			});
		} finally {
			worker.terminate();
			if (state.spectralWorker === worker) state.spectralWorker = null;
		}
	}

	async function captureSelectedNoiseProfile() {
		if (editingBlocked()) return;
		const target = audacityEffectTarget();
		if (!target) throw new Error(copy.audacitySelectionHint);
		const sampleRate = projectSampleRate();
		const estimatedPeakBytes = estimateAudacityEffectPeakBytes(
			'audacity-noise-reduction',
			target.durationFrames,
			currentAudacityEffectParams('audacity-noise-reduction'),
			{ channelCount: target.channelCount, sampleRate },
		);
		if (estimatedPeakBytes > AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES) throw audacityEffectMemoryError(copy);
		state.audacityEffectProcessing = true;
		setStatus(copy.audacityProfileProcessing);
		publishDocumentSnapshot();
		try {
			const channels = await renderDryTrackRange(target.track.id, target.startFrame, target.endFrame, target.channelCount, target.clipIds);
			const result = await runSelectionEffectWorker({
				operation: 'capture-noise-profile',
				channels,
				sampleRate,
				params: currentAudacityEffectParams('audacity-noise-reduction'),
			});
			state.audacityNoiseProfile = result.profile;
			setStatus(copy.noiseProfileReady, 'success');
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	async function captureRackNoiseProfile(effect, scope, requestedTrackId = state.selectedTrackId) {
		if (editingBlocked()) return;
		const selectionTarget = audacityEffectTarget(requestedTrackId);
		const selection = activeSelection();
		const selectedClip = state.selectedClipId ? findClip(project, state.selectedClipId) : null;
		const startFrame = selection?.startFrame ?? selectedClip?.timelineStartFrame;
		const endFrame = selection?.endFrame ?? (selectedClip
			? selectedClip.timelineStartFrame + selectedClip.durationFrames
			: null);
		if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || endFrame <= startFrame) {
			throw new Error(copy.audacitySelectionHint);
		}
		const durationFrames = endFrame - startFrame;
		const sampleRate = projectSampleRate();
		if (durationFrames < 2_048) {
			throw new Error(copy.noiseProfileMinimumSamples);
		}
		const trackId = requestedTrackId;
		if (scope === 'track' && (!selectionTarget || selectionTarget.track.id !== trackId)) {
			throw new Error(copy.audacitySelectionHint);
		}
		const estimatedPeakBytes = estimateAudacityEffectPeakBytes(
			'audacity-noise-reduction',
			durationFrames,
			effect.params,
			{
				channelCount: scope === 'track' ? selectionTarget.channelCount : 2,
				sampleRate,
			},
		);
		if (estimatedPeakBytes > AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES) throw audacityEffectMemoryError(copy);
		state.audacityEffectProcessing = true;
		setStatus(copy.audacityProfileProcessing);
		publishDocumentSnapshot();
		try {
			const channels = await renderRackPrefixRange(
				effect,
				scope,
				startFrame,
				endFrame,
				scope === 'track' ? selectionTarget.channelCount : 2,
				trackId,
			);
			const result = await runSelectionEffectWorker({
				operation: 'capture-noise-profile',
				channels,
				sampleRate,
				params: effect.params,
			});
			state.audacityNoiseProfile = result.profile;
			commit({
				type: 'effect/update',
				scope,
				trackId,
				effectId: effect.id,
				changes: {
					enabled: effect.context?.noiseProfile ? effect.enabled : true,
					context: { noiseProfile: serializeAudacityNoiseProfile(result.profile) },
				},
			});
			setStatus(copy.noiseProfileReady, 'success');
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	async function renderRackPrefixRange(effect, scope, startFrame, endFrame, channelCount, requestedTrackId = state.selectedTrackId) {
		const snapshot = cloneProject(project);
		let trackId = requestedTrackId;
		if (scope === 'track') {
			const track = findTrack(snapshot, trackId);
			if (!track) throw new Error(copy.audioTrackNotFound);
			const effectIndex = track.effects.findIndex((candidate) => candidate.id === effect.id);
			if (effectIndex < 0) throw new Error(copy.rackEffectNotFound);
			track.effects = track.effects.slice(0, effectIndex);
			track.gain = 1;
			track.pan = 0;
			track.mute = false;
			track.solo = false;
			track.envelope = [];
			snapshot.mixer = { ...snapshot.mixer, groups: [], sends: [], routes: {} };
		} else {
			const effectIndex = snapshot.master.effects.findIndex((candidate) => candidate.id === effect.id);
			if (effectIndex < 0) throw new Error(copy.rackEffectNotFound);
			snapshot.master.effects = snapshot.master.effects.slice(0, effectIndex);
			snapshot.master.gain = 1;
		}

		await prepareCommittedTimePitchCaches(snapshot);
		const prefixEngine = createCacheAwareRenderEngine();
		prefixEngine.loadProject(snapshot, sourceBuffers);
		try {
			const rendered = scope === 'track'
				? await prefixEngine.renderTrack(trackId, {
					startFrame,
					endFrame,
					includeTrackPan: false,
				})
				: await prefixEngine.renderMix({
					startFrame,
					endFrame,
					includeMaster: true,
					respectMuteSolo: true,
				});
			return matchAudacitySelectionChannels(audioBufferChannels(rendered), channelCount);
		} finally {
			await prefixEngine.dispose();
		}
	}

	async function applySelectedAudacityEffect() {
		if (editingBlocked()) return;
		const type = state.audacityEffectType;
		const definition = AUDIO_SELECTION_EFFECT_DEFINITIONS[type];
		const targets = audacityEffectTargets({ includeSilentTracks: Boolean(definition.lengthChanging) });
		if (!targets.length) throw new Error(copy.audacitySelectionHint);
		const sampleRate = projectSampleRate();
		const selection = activeSelection();
		const spectralSelections = new Map(targets.map((target) => [
			target.track.id,
			audacitySpectralEffectContext(target, definition),
		]));
		let params = normalizeAudioSelectionEffectParams(type, currentAudacityEffectParams());
		if (definition.requiresNoiseProfile && !state.audacityNoiseProfile) throw new Error(copy.noiseProfileMissing);
		if (definition.requiresControlTrack && !state.audacityControlTrackId) throw new Error(copy.autoDuckControlTrack);
		const contextFrames = definition.preRollSeconds
			? Math.ceil(definition.preRollSeconds * sampleRate)
			: definition.requiresStaffPad
			? sampleRate
			: definition.requiresContext ? 128 : 0;
		const afterContextFrames = definition.preRollSeconds ? 0 : contextFrames;
		let estimatedOutputBytes = 0;
		let estimatedPeakBytes = 0;
		for (const target of targets) {
			const estimatedFrames = estimateAudioSelectionEffectOutputFrames(type, target.durationFrames, params);
			if (target.hasAudio !== false) {
				estimatedOutputBytes += estimatedFrames * target.channelCount * Float32Array.BYTES_PER_ELEMENT;
			}
			estimatedPeakBytes += estimateAudioSelectionEffectPeakBytes(type, target.durationFrames, params, {
				channelCount: target.channelCount,
				controlChannelCount: definition.requiresControlTrack ? 2 : undefined,
				sampleRate,
				beforeFrames: Math.min(target.startFrame, contextFrames),
				afterFrames: afterContextFrames,
				spectralWindowSize: spectralSelections.get(target.track.id)?.windowSize,
			});
		}
		if (estimatedPeakBytes > AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES) throw audacityEffectMemoryError(copy);
		state.audacityEffectProcessing = true;
		setStatus(copy.audacityProcessing);
		publishDocumentSnapshot();
		try {
			await preflightStorage(estimatedOutputBytes, 'effect');
			const dryResults = [];
			for (const target of targets) {
				const channels = await renderDryTrackRange(
					target.track.id,
					target.startFrame,
					target.endFrame,
					target.channelCount,
					target.clipIds,
				);
				dryResults.push({ target, channels });
			}
			params = resolveInteractiveAudacityParams(
				type,
				params,
				dryResults.flatMap(({ channels }) => channels),
			);
			const controlChannels = definition.requiresControlTrack && !targets.some((target) => target.clipId)
				? await renderDryTrackRange(
					state.audacityControlTrackId,
					targets[0].startFrame,
					targets[0].endFrame,
				)
				: null;
			const linkedTruncateSilence = type === 'audacity-truncate-silence'
				&& params.independent === false
				&& !targets.some((target) => target.clipId)
				&& dryResults.length > 1;
			let results = [];
			if (linkedTruncateSilence) {
				const linkedChannels = dryResults.flatMap(({ channels }) => channels);
				const result = await runSelectionEffectWorker({
					operation: 'apply', effectType: type, channels: linkedChannels, sampleRate, params, context: {},
				});
				const processedChannels = Array.isArray(result.channels) ? result.channels : [];
				let channelOffset = 0;
				results = dryResults.map(({ target, channels }) => {
					const targetChannels = processedChannels.slice(channelOffset, channelOffset + channels.length);
					channelOffset += channels.length;
					return { target, channels: targetChannels };
				});
				if (channelOffset !== processedChannels.length) throw new Error(copy.effectChannelLayoutChanged);
			} else {
				for (const { target, channels } of dryResults) {
					const effectContext = {};
					const spectralSelection = spectralSelections.get(target.track.id);
					if (spectralSelection) effectContext.spectralSelection = spectralSelection;
					if (definition.requiresControlTrack) {
						effectContext.controlChannels = controlChannels || await renderDryTrackRange(
							state.audacityControlTrackId,
							target.startFrame,
							target.endFrame,
						);
					}
					if (definition.requiresNoiseProfile) effectContext.noiseProfile = state.audacityNoiseProfile;
					if (contextFrames > 0) {
						const beforeStart = Math.max(0, target.startFrame - contextFrames);
						effectContext.beforeChannels = beforeStart < target.startFrame
							? await renderDryTrackRange(target.track.id, beforeStart, target.startFrame, target.channelCount, target.clipIds)
							: channels.map(() => new Float32Array(0));
						if (afterContextFrames > 0) {
							const afterEnd = Math.min(projectDurationFrames(project), target.endFrame + afterContextFrames);
							effectContext.afterChannels = target.endFrame < afterEnd
								? await renderDryTrackRange(target.track.id, target.endFrame, afterEnd, target.channelCount, target.clipIds)
								: channels.map(() => new Float32Array(0));
						}
					}
					const result = await runSelectionEffectWorker({
						operation: 'apply', effectType: type, channels, sampleRate, params, context: effectContext,
					});
					results.push({ target, channels: result.channels });
				}
			}
			await persistAudacityEffectResults(results, type, {
				allowIndependentLengths: type === 'audacity-truncate-silence' && params.independent === true,
				selectionDetails: audacityEffectSelectionDetails(selection, targets),
			});
			state.lastAudacityEffect = {
				type,
				params: structuredClone(params),
				controlTrackId: state.audacityControlTrackId,
			};
			setStatus(copy.audacityApplied, 'success');
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	async function renderDryTrackRange(trackId, startFrame, endFrame, requestedChannelCount = null, requestedClipIds = null) {
		const track = findTrack(project, trackId);
		if (!track) throw new Error(copy.audioTrackNotFound);
		const channelCount = requestedChannelCount ?? (audacitySelectionChannelCount(project, trackId, startFrame, endFrame) || 1);
		const snapshot = cloneProject(project);
		const clipIdSet = requestedClipIds?.length ? new Set(requestedClipIds) : null;
		snapshot.tracks = snapshot.tracks
			.filter((candidate) => candidate.id === trackId)
			.map((candidate) => ({
				...candidate,
				...(clipIdSet ? { clipIds: candidate.clipIds.filter((clipId) => clipIdSet.has(clipId)) } : {}),
				gain: 1,
				pan: 0,
				mute: false,
				solo: false,
				effects: [],
				envelope: [],
			}));
		snapshot.master = { gain: 1, effects: [] };
		snapshot.mixer = { groups: [], sends: [], routes: {} };
		const rendered = await renderSnapshot(snapshot, {
			startFrame,
			endFrame,
			trackId,
			includeMaster: false,
			includeTrackPan: false,
			respectMuteSolo: false,
			outputFrames: endFrame - startFrame,
		});
		return matchAudacitySelectionChannels(audioBufferChannels(rendered), channelCount);
	}

	async function runNyquistEvaluation(request = {}) {
		if (state.audacityEffectProcessing) return null;
		const source = String(request.source || '');
		if (!source.trim()) throw new TypeError(copy.nyquistSource || 'Nyquist source is required.');
		const role = normalizeNyquistRole(request.role || request.pluginType || request.type);
		const preview = Boolean(request.preview);
		const sampleRate = projectSampleRate();
		const selection = activeSelection();
		const availableTargets = audacityEffectTargets();
		const targets = role === 'generate'
			? [null]
			: availableTargets.length ? availableTargets : role === 'prompt' ? [null] : [];
		if (!targets.length) throw new Error(copy.nyquistSelectionRequired || copy.audacitySelectionHint);
		if (!preview && editingBlocked()) return null;

		cancelAudacityEffectPreview({ publish: false });
		state.nyquistAbort?.abort();
		const abort = new AbortController();
		state.nyquistAbort = abort;
		state.audacityEffectProcessing = true;
		state.nyquistResult = null;
		setStatus(copy.nyquistProcessing || copy.audacityProcessing);
		publishDocumentSnapshot();
		try {
			const evaluations = [];
			let aggregateAudioBytes = 0;
			for (let index = 0; index < targets.length; index += 1) {
				const target = targets[index];
				// Nyquist's `$preview selection` contract requires the complete
				// selected sound and duration. The evaluator still caps rendered
				// output to six seconds through maxOutputFrames below.
				const runTarget = target;
				const channels = runTarget
					? await renderDryTrackRange(
						runTarget.track.id,
							runTarget.startFrame,
							runTarget.endFrame,
							runTarget.channelCount,
							runTarget.clipIds,
						)
					: [];
				throwIfAborted(abort.signal);
				const maxOutputFrames = nyquistMaximumOutputFrames({
					sampleRate,
					inputFrames: channels[0]?.length || 0,
					preview,
					requested: request.maxOutputFrames,
				});
				const hostTargets = availableTargets.length ? availableTargets : targets;
				const hostTargetIndex = target ? Math.max(0, hostTargets.indexOf(target)) : index;
				const result = await nyquistEvaluator({
					source,
					language: request.language === 'sal' ? 'sal' : 'lisp',
					sampleRate,
					channels,
					controls: { ...(request.controls || {}) },
					properties: nyquistHostProperties(runTarget, hostTargets, hostTargetIndex, channels, request),
					globals: { PREVIEWP: preview },
					maxOutputFrames,
					debug: Boolean(request.debug),
				}, {
					signal: abort.signal,
					timeoutMs: request.timeoutMs,
					transferInput: true,
				});
				throwIfAborted(abort.signal);
				if (result?.type === 'audio') {
					aggregateAudioBytes += nyquistAudioResultBytes(result);
					if (aggregateAudioBytes > NYQUIST_AGGREGATE_AUDIO_LIMIT_BYTES) {
						throw audacityEffectMemoryError(copy);
					}
				}
				evaluations.push({ target: runTarget, result });
			}
			throwIfAborted(abort.signal);

			const returnedResult = freezeNyquistResult(evaluations);
			const audio = evaluations.filter(({ result }) => result?.type === 'audio');
			const labels = evaluations.flatMap(({ target, result }) => result?.type === 'labels'
				? result.labels.map((label) => ({ ...label, baseFrame: target?.startFrame ?? selection?.startFrame ?? 0 }))
				: []);
			if (preview) {
				const previewChannels = mixNyquistPreviewChannels(
					audio.map(({ result }) => result.channels),
					sampleRate * 6,
				);
				if (previewChannels.length) await playNyquistPreview(previewChannels, sampleRate, abort.signal);
				throwIfAborted(abort.signal);
				state.nyquistResult = freezeNyquistResult(evaluations, { summarizeAudio: true });
				if (!audio.length) setStatus(nyquistResultStatus(evaluations, copy), 'success');
				return returnedResult;
			}

			const replacements = audio.filter(({ target }) => target);
			if (replacements.length) {
				await preflightStorage(replacements.reduce((sum, { result }) => (
					sum + nyquistAudioResultBytes(result)
				), 0), 'effect');
				throwIfAborted(abort.signal);
				await persistAudacityEffectResults(replacements.map(({ target, result }) => ({
					target,
					channels: result.channels,
				})), null, {
					allowIndependentLengths: true,
					effectName: request.name || copy.nyquistPrompt,
					selectionDetails: audacityEffectSelectionDetails(selection, replacements.map(({ target }) => target)),
					signal: abort.signal,
				});
			}
			for (const { target, result } of audio.filter(({ target }) => !target)) {
				throwIfAborted(abort.signal);
				await persistNyquistGeneratedAudio(result.channels, {
					name: request.name || copy.nyquistPrompt,
					atFrame: request.atFrame,
					trackId: request.trackId || target?.track?.id,
					signal: abort.signal,
				});
			}
			throwIfAborted(abort.signal);
			if (labels.length) persistNyquistLabels(labels, request.name);
			state.nyquistResult = freezeNyquistResult(evaluations, { summarizeAudio: true });
			setStatus(labels.length && !audio.length
				? copy.nyquistLabelsAdded
				: audio.length ? copy.nyquistApplied : nyquistResultStatus(evaluations, copy), 'success');
			return returnedResult;
		} catch (error) {
			if (error?.name === 'AbortError') {
				setStatus(copy.audacityPreviewCancelled || copy.ready);
				return null;
			}
			throw error;
		} finally {
			if (state.nyquistAbort === abort) state.nyquistAbort = null;
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	function cancelNyquistEvaluation() {
		const running = state.nyquistAbort;
		running?.abort();
		const preview = cancelAudacityEffectPreview({ publish: false });
		if (!running) state.audacityEffectProcessing = false;
		setStatus(copy.audacityPreviewCancelled || copy.ready);
		publishDocumentSnapshot();
		return Boolean(running || preview);
	}

	function nyquistHostProperties(target, targets, index, channels, request) {
		const sampleRate = projectSampleRate();
		const selection = activeSelection();
		const frequencyRange = selection?.frequencyRange || {};
		const startFrame = target?.startFrame ?? selection?.startFrame ?? engine.getPositionFrames();
		const endFrame = target?.endFrame ?? selection?.endFrame ?? startFrame;
		const track = target?.track || null;
		const clips = track?.clipIds?.map((clipId) => findClip(project, clipId)).filter(Boolean).map((clip) => [
			clip.timelineStartFrame / sampleRate,
			(clip.timelineStartFrame + clip.durationFrames) / sampleRate,
		]) || [];
		const stats = nyquistChannelStats(channels);
		const lowHz = Number(frequencyRange.minimumFrequency);
		const highHz = Number(frequencyRange.maximumFrequency);
		const selectedTrackIndices = targets.map((candidate) => {
			const projectIndex = project?.tracks?.findIndex((projectTrack) => projectTrack.id === candidate?.track?.id) ?? -1;
			return projectIndex >= 0 ? projectIndex + 1 : null;
		}).filter(Number.isInteger);
		return {
			AUDACITY: {
				VERSION: [3, 7, 7],
				LANGUAGE: locale,
			},
			PROJECT: {
				NAME: project?.title || '',
				RATE: sampleRate,
				TEMPO: Number(project?.tempo?.bpm ?? project?.tempo) || 120,
				TRACKS: project?.tracks?.length || 0,
				WAVETRACKS: project?.tracks?.filter((candidate) => candidate.type === 'audio').length || 0,
				LABELTRACKS: project?.tracks?.filter((candidate) => candidate.type === 'label').length || 0,
				PREVIEW_DURATION: 6,
			},
			SELECTION: {
				START: startFrame / sampleRate,
				END: endFrame / sampleRate,
				TRACKS: selectedTrackIndices,
				PEAK: stats.peak,
				RMS: stats.rms,
				...(Number.isFinite(lowHz) ? { LOW_HZ: lowHz } : {}),
				...(Number.isFinite(highHz) ? { HIGH_HZ: highHz } : {}),
				...(Number.isFinite(lowHz) && lowHz > 0 && Number.isFinite(highHz) && highHz > lowHz ? {
					CENTER_HZ: Math.sqrt(lowHz * highHz),
					BANDWIDTH: Math.log2(highHz / lowHz),
				} : {}),
			},
			TRACK: {
				INDEX: index + 1,
				NAME: track?.name || request.name || '',
				CLIPS: channels.length > 1 ? channels.map(() => clips) : clips,
				INCLIPS: channels.length > 1 ? channels.map(() => clips) : clips,
			},
		};
	}

	async function playNyquistPreview(channels, sampleRate, signal = null) {
		throwIfAborted(signal);
		assertAudacityEffectOutput(channels);
		const context = await engine.getAudioContext({ resume: true });
		throwIfAborted(signal);
		await context.resume?.();
		throwIfAborted(signal);
		const buffer = await bufferFromChannels(channels, sampleRate, context, copy);
		throwIfAborted(signal);
		const source = context.createBufferSource();
		source.buffer = buffer;
		source.connect(context.destination);
		source.onended = () => {
			if (state.audacityPreviewSource !== source) return;
			state.audacityPreviewSource = null;
			source.disconnect?.();
			setStatus(copy.audacityPreviewComplete || copy.ready, 'success');
			publishDocumentSnapshot();
		};
		engine.pause();
		state.audacityPreviewSource = source;
		source.start();
		setStatus(copy.audacityPreviewPlaying || copy.playing, 'success');
	}

	async function persistNyquistGeneratedAudio(channels, options = {}) {
		const signal = options.signal || null;
		throwIfAborted(signal);
		assertAudacityEffectOutput(channels);
		if (!channels.length || !channels[0]?.length || channels.length > 2) throw new Error(copy.effectInvalidAudio);
		const sampleRate = projectSampleRate();
		const selection = activeSelection();
		const replacementTarget = selection ? audacityEffectTarget(options.trackId) : null;
		if (replacementTarget) {
			return persistAudacityEffectResult(
				replacementTarget,
				null,
				matchAudacitySelectionChannels(channels, replacementTarget.channelCount),
				{ effectName: String(options.name || copy.nyquistPrompt), signal },
			);
		}
		const frameCount = channels[0].length;
		if (!channels.every((channel) => channel instanceof Float32Array && channel.length === frameCount)) {
			throw new Error(copy.effectChannelLengthsMismatch);
		}
		await preflightStorage(frameCount * channels.length * Float32Array.BYTES_PER_ELEMENT, 'effect');
		throwIfAborted(signal);
		const sourceId = createStableId('nyquist-generator');
		const name = String(options.name || copy.nyquistPrompt);
		const context = await engine.getAudioContext({ resume: false });
		throwIfAborted(signal);
		const buffer = await bufferFromChannels(channels, sampleRate, context, copy);
		throwIfAborted(signal);
		const writer = await store.beginSourceWrite(sourceId, {
			name,
			mimeType: 'audio/wav',
			sampleRate,
			channelCount: channels.length,
			chunkFrames: SOURCE_CHUNK_FRAMES,
		});
		try {
			throwIfAborted(signal);
			await writeBuffer(writer, buffer, signal);
			throwIfAborted(signal);
			await writer.commit({ sampleRate, channelCount: channels.length });
			throwIfAborted(signal);
			const source = {
				schemaVersion: 2,
				sampleRate,
				sampleFormat: 'float32',
				chunkFrames: SOURCE_CHUNK_FRAMES,
				id: sourceId,
				storageKey: sourceId,
				name,
				mimeType: 'audio/wav',
				frameCount,
				channelCount: channels.length,
				originalSampleRate: sampleRate,
			};
			let targetTrack = findTrack(project, options.trackId || state.selectedTrackId);
			if (targetTrack?.type !== 'audio') targetTrack = project.tracks.find((track) => track.type === 'audio') || null;
			const startFrame = snapTimelineFrame(options.atFrame ?? selection?.startFrame ?? engine.getPositionFrames());
			const endFrame = startFrame + frameCount;
			let command = { type: 'batch', commands: [createAddSourceCommand(source)] };
			if (!targetTrack || targetTrack.clipIds.some((clipId) => {
				const clip = findClip(project, clipId);
				return clip && clip.timelineStartFrame < endFrame && clip.timelineStartFrame + clip.durationFrames > startFrame;
			})) {
				const trackId = createStableId('track');
				targetTrack = { id: trackId };
				command.commands.push(createAddTrackCommand({ schemaVersion: 2, type: 'audio', id: trackId, name }));
			}
			const selectedClipId = createStableId('clip');
			command.commands.push(createAddClipCommand(targetTrack.id, {
				schemaVersion: 2,
				title: name,
				sourceDurationFrames: frameCount,
				id: selectedClipId,
				sourceId,
				timelineStartFrame: startFrame,
				sourceStartFrame: 0,
				durationFrames: frameCount,
			}));
			cacheSourceBuffer(sourceId, buffer);
			const peaks = await generateWaveformPeaks(channels, copy);
			throwIfAborted(signal);
			sourcePeaks.set(sourceId, peaks);
			await store.saveAnalysis(peakCacheKey(sourceId), peaks);
			throwIfAborted(signal);
			commit(command, { selectTrackId: targetTrack.id, selectClipId: selectedClipId });
			return selectedClipId;
		} catch (error) {
			await Promise.resolve(writer.abort()).catch(() => undefined);
			sourceBuffers.delete(sourceId);
			sourcePeaks.delete(sourceId);
			await store.deleteSource(sourceId).catch(() => undefined);
			throw error;
		}
	}

	function persistNyquistLabels(labels, name = null) {
		if (!labels.length) return null;
		const sampleRate = projectSampleRate();
		let target = findTrack(project, state.selectedTrackId);
		if (target?.type !== 'label') target = project.tracks.find((track) => track.type === 'label') || null;
		const commands = [];
		if (!target) {
			target = { id: createStableId('label-track') };
			commands.push(createAddLabelTrackCommand({ id: target.id, name: String(name || copy.labels) }));
		}
		for (const label of labels) {
			const startFrame = Math.max(0, label.baseFrame + Math.round(Number(label.start || 0) * sampleRate));
			const endFrame = Math.max(startFrame, label.baseFrame + Math.round(Number(label.end ?? label.start ?? 0) * sampleRate));
			commands.push(createAddLabelCommand(target.id, {
				startFrame,
				endFrame,
				title: String(label.text || ''),
			}));
		}
		commit({ type: 'batch', commands }, { selectTrackId: target.id });
		return target.id;
	}

	async function persistAudacityEffectResult(target, type, channels, options = {}) {
		return persistAudacityEffectResults([{ target, channels }], type, options);
	}

	async function persistAudacityEffectResults(results, type, options = {}) {
		const signal = options.signal || null;
		throwIfAborted(signal);
		if (!Array.isArray(results) || !results.length) throw new Error(copy.effectInvalidAudio);
		const sampleRate = projectSampleRate();
		const context = await engine.getAudioContext({ resume: false });
		throwIfAborted(signal);
		const effectName = options.effectName || audioSelectionEffectLabel(type, copy);
		const entries = [];
		for (const result of results) {
			throwIfAborted(signal);
			const { target, channels } = result || {};
			if (!target || !Array.isArray(channels) || !channels.length || channels.length > 2 || !channels[0]?.length) {
				throw new Error(copy.effectInvalidAudio);
			}
			const frameCount = channels[0].length;
			if (!channels.every((channel) => channel instanceof Float32Array && channel.length === frameCount)) {
				throw new Error(copy.effectChannelLengthsMismatch);
			}
			assertAudacityEffectOutput(channels);
			if (channels.length !== target.channelCount) throw new Error(copy.effectChannelLayoutChanged);
			if (target.hasAudio === false) {
				entries.push({
					target,
					channels,
					frameCount,
					buffer: null,
					sourceId: null,
					sourceName: null,
					replacement: null,
					command: prepareSilentAudacityRippleCommand(target, frameCount),
				});
				continue;
			}
			const buffer = await bufferFromChannels(channels, sampleRate, context, copy);
			throwIfAborted(signal);
			const sourceId = createStableId('audacity-effect');
			const sourceName = `${target.track.name} — ${effectName}.wav`;
			const source = {
				id: sourceId,
				storageKey: sourceId,
				name: sourceName,
				mimeType: 'audio/wav',
				frameCount,
				channelCount: buffer.numberOfChannels,
				sampleRate,
				originalSampleRate: sampleRate,
			};
			const replacement = target.clipId ? null : prepareRangeReplacementCommand(project, {
				trackId: target.track.id,
				startFrame: target.startFrame,
				endFrame: target.endFrame,
				source,
			});
			entries.push({ target, channels, frameCount, buffer, sourceId, sourceName, replacement, command: replacement });
		}
		const firstEntry = entries[0];
		const exactClipReplacement = entries.every((entry) => Boolean(entry.target.clipId));
		if (!exactClipReplacement && (entries.some((entry) => entry.target.startFrame !== firstEntry.target.startFrame)
			|| (!options.allowIndependentLengths && entries.some((entry) => entry.frameCount !== firstEntry.frameCount)))) {
			throw new Error(copy.effectTrackLengthsMismatch || 'Selected tracks produced different effect lengths and cannot be rippled together.');
		}
		const selectionFrameCount = options.allowIndependentLengths
			? Math.max(...entries.map((entry) => entry.frameCount))
			: firstEntry.frameCount;

		const persistedEntries = [];
		try {
			for (const entry of entries) {
				throwIfAborted(signal);
				if (!entry.buffer) continue;
				const writer = await store.beginSourceWrite(entry.sourceId, {
					name: entry.sourceName,
					mimeType: 'audio/wav',
					sampleRate,
					channelCount: entry.buffer.numberOfChannels,
					chunkFrames: SOURCE_CHUNK_FRAMES,
				});
				try {
					throwIfAborted(signal);
					await writeBuffer(writer, entry.buffer, signal);
					throwIfAborted(signal);
					await writer.commit({ sampleRate, channelCount: entry.buffer.numberOfChannels });
					persistedEntries.push(entry);
					throwIfAborted(signal);
				} catch (error) {
					await writer.abort();
					throw error;
				}
			}
			for (const entry of entries) {
				throwIfAborted(signal);
				if (!entry.buffer) continue;
				cacheSourceBuffer(entry.sourceId, entry.buffer);
				const peaks = await generateWaveformPeaks(entry.channels, copy);
				throwIfAborted(signal);
				sourcePeaks.set(entry.sourceId, peaks);
				await store.saveAnalysis(peakCacheKey(entry.sourceId), peaks);
				throwIfAborted(signal);
			}
			throwIfAborted(signal);
			const replacementCommands = exactClipReplacement
				? [{
					type: 'clip/render-replace-many',
					entries: entries.map((entry) => ({
						clipId: entry.target.clipId,
						source: entry.replacement?.source || {
							id: entry.sourceId,
							storageKey: entry.sourceId,
							name: entry.sourceName,
							mimeType: 'audio/wav',
							frameCount: entry.frameCount,
							channelCount: entry.channels.length,
							sampleRate,
							originalSampleRate: sampleRate,
						},
					})),
				}]
				: entries.map((entry) => entry.command).filter(Boolean);
			const selectionCommand = exactClipReplacement
				? {
					type: 'selection/set',
					startFrame: 0,
					endFrame: 0,
					trackIds: [...new Set(entries.map((entry) => entry.target.track.id))],
					clipIds: entries.map((entry) => entry.target.clipId),
					frequencyRange: null,
				}
				: {
					type: 'selection/set',
					startFrame: firstEntry.target.startFrame,
					endFrame: firstEntry.target.startFrame + selectionFrameCount,
					...(options.selectionDetails || {}),
				};
			commit({
					type: 'batch',
					commands: [
						...replacementCommands,
						selectionCommand,
					],
			}, {
				selectTrackId: entries.find((entry) => entry.target.track.id === state.selectedTrackId)?.target.track.id
					|| firstEntry.target.track.id,
				...(entries.length === 1 && firstEntry.replacement
					? { selectClipId: firstEntry.replacement.clipId }
					: {}),
			});
			return entries.map((entry) => entry.replacement);
		} catch (error) {
			for (const entry of entries) {
				if (!entry.sourceId) continue;
				sourceBuffers.delete(entry.sourceId);
				sourcePeaks.delete(entry.sourceId);
				await store.deleteAnalysis?.(peakCacheKey(entry.sourceId)).catch(() => undefined);
			}
			for (const entry of persistedEntries) await store.deleteSource(entry.sourceId).catch(() => undefined);
			throw error;
		}
	}

	function prepareSilentAudacityRippleCommand(target, outputFrameCount) {
		const timelineDelta = outputFrameCount - target.durationFrames;
		if (!timelineDelta) return null;
		if (timelineDelta < 0) {
			return prepareRangeDeleteCommand(project, {
				trackIds: [target.track.id],
				startFrame: target.startFrame + outputFrameCount,
				endFrame: target.endFrame,
				rippleMode: 'track',
			});
		}
		const trackId = target.track.id;
		return preparePasteCommand({
			schemaVersion: 1,
			sampleRate: projectSampleRate(),
			durationFrames: timelineDelta,
			tracks: [{
				sourceTrackId: trackId,
				sourceTrackName: target.track.name,
				clips: [],
			}],
		}, {
			project,
			atFrame: target.endFrame,
			trackMap: { [trackId]: trackId },
			mode: 'insert-track',
		});
	}

	async function runSelectionEffectWorker(payload) {
		const request = payload.effectType === 'eq'
			? { ...payload, wasmModule: payload.wasmModule || await loadParametricEqWasmModule() }
			: payload;
		if (typeof Worker !== 'function') {
			if (request.operation === 'capture-noise-profile') {
				await initializePffft();
				return { profile: captureAudacityNoiseProfile(request.channels, request.sampleRate, request.params) };
			}
			return {
				channels: await applyAudioSelectionEffectAsync(
					request.effectType,
					request.channels,
					request.sampleRate,
					request.params,
					{ ...request.context, wasmModule: request.wasmModule },
				),
			};
		}
		const worker = new Worker(new URL('./selection-effects-worker.js', import.meta.url), { type: 'module' });
		state.audacityEffectWorker = worker;
		const transfer = [];
		const message = cloneAudacityWorkerPayload(request, transfer);
		try {
			return await new Promise((resolve, reject) => {
				worker.onmessage = ({ data }) => {
					if (data.type === 'error') {
						const error = new Error(data.message || copy.effectProcessingFailed);
						error.name = data.name || 'Error';
						if (data.code) error.code = data.code;
						reject(error);
					}
					else resolve(data);
				};
				worker.onerror = (event) => reject(event.error || new Error(event.message || copy.effectProcessingFailed));
				worker.postMessage(message, transfer);
			});
		} finally {
			worker.terminate();
			if (state.audacityEffectWorker === worker) state.audacityEffectWorker = null;
		}
	}

	async function runAnalysis(scope = 'master') {
		if (!project.clips.length || state.analysisProcessing) return null;
		const range = analysisRange();
		const analysisKey = ['audio-editor-analysis-v1', project.id, project.revision, scope, scope === 'track' ? state.selectedTrackId : 'master', range.startFrame, range.endFrame].join(':');
		const cached = await store.loadAnalysis(analysisKey);
		if (cached?.result) {
			showAnalysis(cached.result, cached.visuals || null, cached.report || createLevelsReport(scope, range));
			setStatus(copy.analysisCached, 'success');
			return cached.result;
		}
		state.analysisProcessing = true;
		setStatus(copy.analysisRendering);
		publishDocumentSnapshot();
		try {
			const rendered = await renderAnalysisAudio(scope, range);
			const channels = audioBufferChannels(rendered);
			const result = await analyzeChannelsInWorker(channels, rendered.sampleRate, copy);
			const visuals = createAnalysisVisuals(channels, rendered.sampleRate);
			const report = createLevelsReport(scope, range);
			await store.saveAnalysis(analysisKey, { result, visuals, report, createdAt: new Date().toISOString() });
			showAnalysis(result, visuals, report);
			setStatus(copy.done, 'success');
			return result;
		} catch (error) {
			handleError(error);
			return null;
		} finally {
			state.analysisProcessing = false;
			publishDocumentSnapshot();
		}
	}

	async function runSpecializedAnalysis(type, scope = 'master', options = {}) {
		if (!project.clips.length || state.analysisProcessing) return null;
		state.analysisProcessing = true;
		setStatus(copy.analysisRendering);
		publishDocumentSnapshot();
		try {
			const range = analysisRange();
			const rendered = await renderAnalysisAudio(scope, range);
			const channels = audioBufferChannels(rendered);
			const result = await analyzeChannelsInWorker(channels, rendered.sampleRate, copy);
			const visuals = createAnalysisVisuals(channels, rendered.sampleRate);
			let report;
			if (type === 'spectrum') {
				const size = normalizeSpectrumSize(options.size ?? state.preferences?.spectrogram?.windowSize ?? 2_048);
				const spectrum = calculateAudioSpectrum(channels, rendered.sampleRate, { size });
				const peak = spectrum.bins.reduce((best, bin) => !best || bin.amplitude > best.amplitude ? bin : best, null);
				report = Object.freeze({
					type: 'spectrum', scope, startFrame: range.startFrame, endFrame: range.endFrame,
					sampleRate: spectrum.sampleRate, size: spectrum.size, bins: spectrum.bins, peak,
				});
			} else if (type === 'clipping') {
				const threshold = Number(options.threshold ?? 1);
				const minimumConsecutiveSamples = Number(options.minimumConsecutiveSamples ?? 3);
				const regions = findAudioClippingRegions(channels, { threshold, minimumConsecutiveSamples })
					.map((region) => Object.freeze({
						...region,
						startFrame: region.startFrame + range.startFrame,
						endFrame: region.endFrame + range.startFrame,
					}));
				report = Object.freeze({
					type: 'clipping', scope, startFrame: range.startFrame, endFrame: range.endFrame,
					threshold, minimumConsecutiveSamples, regions: Object.freeze(regions),
					regionCount: regions.length,
					clippedSamples: regions.reduce((sum, region) => sum + region.clippedSamples, 0),
				});
			} else throw new RangeError(copy.unsupportedAnalysisReport.replace('{type}', type));
			showAnalysis(result, visuals, report);
			setStatus(copy.done, 'success');
			return report;
		} catch (error) {
			handleError(error);
			return null;
		} finally {
			state.analysisProcessing = false;
			publishDocumentSnapshot();
		}
	}

	async function captureContrastSelection(role = 'foreground', scope = 'master', options = {}) {
		if (!['foreground', 'background'].includes(role)) throw new RangeError(copy.contrastRoleInvalid);
		if (state.analysisProcessing) return null;
		const selection = activeSelection();
		if (!selection) {
			const error = new Error(copy.timeSelectionRequired);
			handleError(error);
			return null;
		}
		state.analysisProcessing = true;
		setStatus(copy.contrastAnalyzing);
		publishDocumentSnapshot();
		try {
			const range = { startFrame: selection.startFrame, endFrame: selection.endFrame };
			const rendered = await renderAnalysisAudio(scope, range);
			const channels = audioBufferChannels(rendered);
			const result = await analyzeChannelsInWorker(channels, rendered.sampleRate, copy);
			state.contrastSelections = {
				...state.contrastSelections,
				[role]: Object.freeze({ ...range, rmsDb: result.rmsDbfs, scope }),
			};
			const foreground = state.contrastSelections.foreground;
			const background = state.contrastSelections.background;
			const minimumDifferenceDb = Number(options.minimumDifferenceDb ?? 20);
			const differenceDb = foreground && background ? foreground.rmsDb - background.rmsDb : null;
			const report = Object.freeze({
				type: 'contrast', foreground, background, minimumDifferenceDb, differenceDb,
				passes: Number.isFinite(differenceDb) ? differenceDb >= minimumDifferenceDb : null,
			});
			showAnalysis(result, createAnalysisVisuals(channels, rendered.sampleRate), report);
			const roleLabel = role === 'foreground' ? copy.contrastForegroundRole : copy.contrastBackgroundRole;
			setStatus(copy.contrastStored.replace('{role}', roleLabel), 'success');
			return report;
		} catch (error) {
			handleError(error);
			return null;
		} finally {
			state.analysisProcessing = false;
			publishDocumentSnapshot();
		}
	}

	function analysisRange() {
		const selection = activeSelection();
		return Object.freeze({
			startFrame: selection?.startFrame ?? 0,
			endFrame: selection?.endFrame ?? projectDurationFrames(project),
		});
	}

	async function renderAnalysisAudio(scope, range) {
		if (hasMissingTimelineSources()) throw new Error(copy.localSourcesMissing);
		let snapshot = cloneProject(project);
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
		});
	}

	function createLevelsReport(scope, range) {
		return Object.freeze({ type: 'levels', scope, startFrame: range.startFrame, endFrame: range.endFrame });
	}

	function normalizeSpectrumSize(value) {
		const requested = Math.max(32, Math.min(65_536, Math.round(Number(value) || 2_048)));
		return 2 ** Math.round(Math.log2(requested));
	}

	async function handleExportAction(action, requestedSettings = null) {
		if (action === 'cancel') {
			state.exportGeneration += 1;
			state.exportAbort?.abort();
			state.exportAbort = null;
			ffmpeg.dispose();
			toggleExport(false);
			publishDocumentSnapshot();
			return;
		}
		if (String(requestedSettings?.format || '').startsWith('video-')) {
			return exportVideo(requestedSettings);
		}
		if (!project.clips.length || state.exportAbort) return;
		if (hasMissingTimelineSources()) throw new Error(copy.localSourcesMissing);
		const generation = ++state.exportGeneration;
		const abort = new AbortController();
		state.exportAbort = abort;
		toggleExport(true);
		const exportProject = cloneProject(project);
		const exportSources = new Map(sourceBuffers);
		let pendingCleanup = null;
		try {
			const settings = normalizeExportSettings(requestedSettings || {});
			const plan = createExportPlan(exportProject, {
				...settings,
				// The ordered Web Audio master graph currently renders stereo.
				inputChannelCount: 2,
				mobile: state.mobile,
				livePcmBytes: undefined,
			});
			await preflightStorage(plan.outputBytesPerRender * Math.max(1, plan.outputs.length), 'export');
			setStatus(copy.rendering);
			let blob;
			let fileName;
			let outputCleanup = null;
			if (plan.mode === 'mix') {
				const encoded = await renderAndEncode(exportProject, plan, settings, abort.signal, exportSources);
				blob = encoded.blob || new Blob([encoded.bytes], { type: encoded.mimeType });
				outputCleanup = encoded.cleanup || null;
				pendingCleanup = outputCleanup;
				fileName = plan.outputs[0].fileName;
			} else {
				const archive = await createStreamingZipArchive(plan.archiveName, plan.outputBytesPerRender * plan.outputs.length, copy);
				try {
					for (let index = 0; index < plan.outputs.length; index += 1) {
						throwIfAborted(abort.signal);
						const output = plan.outputs[index];
						const snapshot = stemProject(exportProject, output.trackId);
						const encoded = await renderAndEncode(snapshot, plan, settings, abort.signal, exportSources);
						try {
							await archive.add(output.fileName, encoded.blob || encoded.bytes, abort.signal);
						} finally {
							await encoded.cleanup?.();
						}
						updateExportProgress((index + 1) / plan.outputs.length);
					}
					const result = await archive.finish();
					blob = result.blob;
					outputCleanup = result.cleanup;
					pendingCleanup = outputCleanup;
					fileName = plan.archiveName;
				} catch (error) {
					await archive.abort();
					throw error;
				}
			}
			throwIfAborted(abort.signal);
			if (generation !== state.exportGeneration) throw abortError();
			if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
			await state.outputCleanup?.();
			state.outputUrl = null;
			state.outputCleanup = null;
			state.exportOutput = null;
			const published = await fileService.createDownload({
				purpose: 'audio',
				suggestedName: fileName,
				mimeType: blob.type || 'application/octet-stream',
				blob,
			});
			if (published.cancelled) {
				await outputCleanup?.();
				pendingCleanup = null;
				return published;
			}
			state.outputCleanup = async () => {
				await published.cleanup?.();
				await outputCleanup?.();
			};
			pendingCleanup = null;
			state.outputUrl = published.url || null;
			state.exportOutput = Object.freeze({
				url: state.outputUrl,
				fileName: published.fileName || fileName,
				mimeType: blob.type || 'application/octet-stream',
				size: blob.size,
				method: published.method,
			});
			setStatus(copy.done, 'success');
			publishDocumentSnapshot();
			return state.exportOutput;
		} catch (error) {
			await pendingCleanup?.().catch(() => undefined);
			if (error?.name !== 'AbortError') handleError(error);
		} finally {
			if (generation === state.exportGeneration) {
				state.exportAbort = null;
				toggleExport(false);
			}
		}
	}

	async function exportVideo(requestedSettings = {}) {
		if (state.exportAbort) return null;
		const hasTimelineVideo = project.tracks.some((track) => (
			track.type === 'video'
			&& track.hidden !== true
			&& (track.clipIds || []).some((clipId) => findClip(project, clipId)?.kind === 'video')
		));
		if (!hasTimelineVideo) throw new Error('Add a visible video clip to the timeline before exporting video.');
		if (hasMissingTimelineSources()) throw new Error(copy.localSourcesMissing);
		const generation = ++state.exportGeneration;
		const abort = new AbortController();
		state.exportAbort = abort;
		toggleExport(true);
		const exportProject = cloneProject(project);
		let pendingCleanup = null;
		try {
			const format = String(requestedSettings.format || 'video-mp4').replace(/^video-/, '');
			const includeAudio = exportProject.clips.some((clip) => clip.kind !== 'video');
			const plan = createVideoExportPlan(exportProject, {
				format,
				range: requestedSettings.range || 'project',
				includeAudio,
				canvas: requestedSettings.canvas,
			});
			const rawVideoBytes = plan.inputs
				.filter((input) => input.kind === 'video-source')
				.reduce((total, input) => {
					const source = findSource(exportProject, input.sourceId);
					return total + Math.max(0, Number(source?.opaqueExtensions?.byteLength) || 0);
				}, 0);
			await preflightStorage(Math.max(rawVideoBytes, 16 * 1024 * 1024), 'export');
			setStatus(copy.rendering);
			const videoBlobs = new Map();
			for (const input of plan.inputs.filter((candidate) => candidate.kind === 'video-source')) {
				throwIfAborted(abort.signal);
				const blob = await store.loadMediaAsset(input.storageKey || input.sourceId);
				if (!blob) throw new Error(copy.localSourcesMissing);
				videoBlobs.set(input.sourceId, blob);
			}
			let audioMixBlob = null;
			if (includeAudio) {
				const rendered = await renderSnapshot(exportProject, {
					startFrame: plan.range.startFrame,
					endFrame: plan.range.endFrame,
					includeTail: false,
					outputFrames: plan.range.durationFrames,
					preRollFrames: Math.min(plan.range.startFrame, projectSampleRate() * 10),
				}, sourceBuffers, abort.signal);
				throwIfAborted(abort.signal);
				const wav = encodeWav(audioBufferChannels(rendered), {
					sampleRate: rendered.sampleRate,
					bitDepth: 32,
					float: true,
					dither: 'none',
				});
				audioMixBlob = new Blob([wav], { type: 'audio/wav' });
			}
			setStatus(copy.encoding);
			const encoded = await ffmpeg.encodeVideo(videoBlobs, audioMixBlob, plan, {
				signal: abort.signal,
			});
			throwIfAborted(abort.signal);
			if (generation !== state.exportGeneration) throw abortError();
			const blob = new Blob([encoded.bytes], { type: encoded.mimeType });
			const fileName = `${sanitizeVideoFileName(exportProject.title)}.${plan.extension}`;
			if (state.outputUrl) globalThis.URL?.revokeObjectURL?.(state.outputUrl);
			await state.outputCleanup?.();
			state.outputUrl = null;
			state.outputCleanup = null;
			state.exportOutput = null;
			const published = await fileService.createDownload({
				purpose: 'video',
				suggestedName: fileName,
				mimeType: encoded.mimeType,
				blob,
			});
			if (published.cancelled) return published;
			state.outputCleanup = published.cleanup || null;
			pendingCleanup = state.outputCleanup;
			state.outputUrl = published.url || null;
			state.exportOutput = Object.freeze({
				url: state.outputUrl,
				fileName: published.fileName || fileName,
				mimeType: encoded.mimeType,
				size: blob.size,
				method: published.method,
			});
			pendingCleanup = null;
			setStatus(copy.done, 'success');
			publishDocumentSnapshot();
			return state.exportOutput;
		} catch (error) {
			await pendingCleanup?.().catch(() => undefined);
			if (error?.name !== 'AbortError') handleError(error);
			return null;
		} finally {
			if (generation === state.exportGeneration) {
				state.exportAbort = null;
				toggleExport(false);
			}
		}
	}

	function sanitizeVideoFileName(value) {
		return String(value || 'video-project')
			.normalize('NFKD')
			.replace(/[\u0300-\u036f]/g, '')
			.replace(/[^a-zA-Z0-9äöüÄÖÜß_-]+/g, '-')
			.replace(/-{2,}/g, '-')
			.replace(/^[-_.]+|[-_.]+$/g, '')
			.slice(0, 96) || 'video-project';
	}

	async function renderAndEncode(snapshot, plan, settings, signal, sourceMap = sourceBuffers) {
		throwIfAborted(signal);
		const renderSampleRate = normalizeProjectSampleRate(snapshot.sampleRate);
		if (plan.render.strategy === 'realtime-stream') {
			setStatus(copy.largeProjectRealtimeExport);
			return renderRealtimeEncoded(snapshot, plan, settings, signal, sourceMap);
		}
		try {
			const rendered = await renderSnapshot(snapshot, {
				startFrame: plan.range.startFrame,
				endFrame: plan.range.endFrame,
				includeTail: settings.includeTail ? plan.tailFrames / renderSampleRate : false,
				outputFrames: plan.range.durationFrames + plan.tailFrames,
				preRollFrames: Math.min(plan.range.startFrame, renderSampleRate * 10),
			}, sourceMap, signal);
			throwIfAborted(signal);
			return await encodeRendered(rendered, plan, settings, signal);
		} catch (error) {
			if (error?.name === 'AbortError') throw error;
			setStatus(copy.realtimeExportFallback);
			return renderRealtimeEncoded(snapshot, plan, settings, signal, sourceMap);
		}
	}

	async function renderSnapshot(snapshot, range, sourceMap = sourceBuffers, signal = null) {
		throwIfAborted(signal);
		if (typeof options.renderSnapshot === 'function') {
			const rendered = await options.renderSnapshot(snapshot, range, sourceMap, signal);
			throwIfAborted(signal);
			return rendered;
		}
		await prepareCommittedTimePitchCaches(snapshot, signal);
		const renderEngine = createCacheAwareRenderEngine();
		try {
			renderEngine.loadProject(snapshot, sourceMap);
			const rendered = await renderEngine.renderMix({ ...range, signal });
			throwIfAborted(signal);
			return rendered;
		} finally { await renderEngine.dispose(); }
	}

	async function encodeRendered(rendered, plan, settings, signal) {
		throwIfAborted(signal);
		let output = rendered;
		if (plan.sampleRate !== rendered.sampleRate) output = await resampleBuffer(rendered, plan.sampleRate, undefined, copy);
		throwIfAborted(signal);
		const bitDepth = plan.encoding.bitDepth || (settings.bitDepth === 32 ? 32 : settings.bitDepth) || 24;
		const sourceChannels = audioBufferChannels(output);
		if (plan.format === 'wav' || plan.format === 'aiff') {
			const mapped = applyMediaChannelMapping(sourceChannels, plan.channelMapping);
			const nativeOptions = {
				sampleRate: plan.sampleRate,
				bitDepth,
				float: plan.encoding.floatingPoint,
				sampleFormat: plan.encoding.sampleFormat,
				dither: plan.ditherMode,
				metadata: plan.metadata,
			};
			const bytes = plan.format === 'aiff' ? encodeAiff(mapped, nativeOptions) : encodeWav(mapped, nativeOptions);
			return { bytes, mimeType: plan.mimeType };
		}
		const stagingFloat = plan.format !== 'flac';
		const stagingBitDepth = stagingFloat
			? 32
			: plan.format === 'flac' || plan.format === 'wavpack'
				? Math.min(24, bitDepth)
				: 24;
		const wav = encodeWav(sourceChannels, {
			sampleRate: plan.sampleRate,
			bitDepth: stagingBitDepth,
			float: stagingFloat,
			dither: stagingFloat ? 'none' : plan.ditherMode,
		});
		throwIfAborted(signal);
		setStatus(copy.encoding);
		return ffmpeg.encode(wav, plan.format, {
			...plan.encoding,
			bitDepth,
			sampleRate: plan.sampleRate,
			applyDither: plan.encoding.sampleFormat !== 'float32' && plan.ditherMode !== 'none' && plan.format !== 'flac',
			signal,
		});
	}

	async function renderRealtimeEncoded(snapshot, plan, settings, signal, sourceMap = sourceBuffers) {
		await prepareCommittedTimePitchCaches(snapshot, signal);
		const renderSampleRate = normalizeProjectSampleRate(snapshot.sampleRate);
		const nativeAiff = plan.format === 'aiff';
		const nativePcm = plan.format === 'wav' || nativeAiff;
		const sink = await createTemporaryFileSink(`audio-editor-${createStableId('render')}.${nativeAiff ? 'aiff' : 'wav'}`, copy);
		if (!sink.persistent && plan.outputBytesPerRender > 96 * 1024 ** 2) {
			await sink.abort();
			throw new Error(copy.realtimeStorageRequired);
		}
		const bitDepth = plan.encoding.bitDepth || (plan.format === 'flac' || plan.format === 'wavpack' ? settings.bitDepth : 24);
		const stagingFloat = !nativePcm && plan.format !== 'flac';
		const encoderOptions = {
			sampleRate: plan.sampleRate,
			channelCount: nativePcm ? plan.channelCount : 2,
			totalFrames: plan.outputFrames,
			bitDepth,
			float: nativePcm ? plan.encoding.floatingPoint : stagingFloat,
			sampleFormat: nativePcm ? plan.encoding.sampleFormat : undefined,
			dither: stagingFloat ? 'none' : plan.ditherMode,
			metadata: nativePcm ? plan.metadata : undefined,
			collect: false,
			onChunk: (chunk) => sink.write(chunk),
		};
		const encoder = nativeAiff ? createAiffStreamEncoder(encoderOptions) : createWavStreamEncoder(encoderOptions);
		const renderEngine = createCacheAwareRenderEngine();
		let outputResampler = null;
		let renderedSampleRate = renderSampleRate;
		try {
			renderEngine.loadProject(snapshot, sourceMap);
			const renderResult = await renderEngine.renderMixRealtime({
				startFrame: plan.range.startFrame,
				endFrame: plan.range.endFrame,
				includeTail: settings.includeTail ? plan.tailFrames / renderSampleRate : false,
				sampleRate: renderSampleRate,
				preRollFrames: Math.min(plan.range.startFrame, renderSampleRate * 10),
				signal,
				onChunk: (channels, metadata = {}) => {
					renderedSampleRate = metadata.sampleRate || renderedSampleRate;
					outputResampler ||= createStreamingWindowedSincResampler(renderedSampleRate, plan.sampleRate, 2);
					const resampledChannels = outputResampler.push(channels);
					const outputChannels = nativePcm ? applyMediaChannelMapping(resampledChannels, plan.channelMapping) : resampledChannels;
					if (outputChannels[0]?.length) encoder.write(outputChannels);
				},
			});
			outputResampler ||= createStreamingWindowedSincResampler(renderResult.sampleRate || renderedSampleRate, plan.sampleRate, 2);
			const resampledFinalChannels = outputResampler.finish(plan.outputFrames);
			const finalChannels = nativePcm ? applyMediaChannelMapping(resampledFinalChannels, plan.channelMapping) : resampledFinalChannels;
			if (finalChannels[0]?.length) encoder.write(finalChannels);
			encoder.finalize();
			await encoder.settled();
			const stagingFile = await sink.close(nativeAiff ? 'audio/aiff' : 'audio/wav');
			if (nativePcm) {
				return { blob: stagingFile, bytes: null, mimeType: plan.mimeType, cleanup: () => sink.remove() };
			}
			setStatus(copy.encoding);
			const encoded = await ffmpeg.encodeFile(stagingFile, plan.format, {
				...plan.encoding,
				bitDepth,
				sampleRate: plan.sampleRate,
				applyDither: plan.encoding.sampleFormat !== 'float32' && plan.ditherMode !== 'none' && plan.format !== 'flac',
				signal,
			});
			await sink.remove();
			return encoded;
		} catch (error) {
			await sink.abort();
			throw error;
		} finally {
			await renderEngine.dispose();
		}
	}

	async function startRecordingOnNewTrack(options = {}) {
		if (state.readOnly || state.recordingStarting || state.timedRecordingPreparing || state.timedRecording || state.recorder) return null;
		const trackId = addTrack({ armed: true });
		if (!trackId) return null;
		await startRecording({ ...options, trackId });
		return trackId;
	}

	function toggleRecordingPause() {
		if (!state.recorder) return false;
		if (state.recordingPaused) {
			const resumed = state.recorder.resume?.();
			if (resumed !== false) {
				state.recordingPaused = false;
				void engine.play();
				updateTransportState('recording');
			}
		} else {
			const paused = state.recorder.pause?.();
			if (paused !== false) {
				state.recordingPaused = true;
				engine.pause();
				updateTransportState('paused-recording');
			}
		}
		publishDocumentSnapshot();
		return state.recordingPaused;
	}

	function toggleLeadInRecording() {
		if (state.recorder || state.recordingStarting || state.timedRecordingPreparing || state.timedRecording) return state.leadInRecording;
		state.leadInRecording = !state.leadInRecording;
		void store.saveSetting('recording-lead-in', state.leadInRecording);
		publishDocumentSnapshot();
		return state.leadInRecording;
	}

	async function scheduleTimedRecording(startTime, options = {}) {
		if (state.readOnly) throw new Error(copy.projectReadOnly);
		if (state.recordingStarting || state.recordingStartPromise || state.recorder) return null;
		if (state.timedRecordingPreparing) return null;
		const startTimeMs = normalizeTimedRecordingStart(startTime);
		if (startTimeMs <= currentTimeMs()) throw new RangeError(copy.timedRecordingPast);
		const recordingOptions = options.trackId
			? Object.freeze({ trackId: String(options.trackId) })
			: Object.freeze({});
		if (state.timedRecording) cancelTimedRecording({ releaseInputs: false, status: false });
		const generation = ++state.timedRecordingGeneration;
		const projectId = project?.id;
		state.timedRecordingPreparing = true;
		state.timedRecordingCancelling = false;
		setStatus(copy.timedRecordingPreparing);

		// Start both operations from the confirming click. In particular, display
		// capture must not be deferred until the timer fires because the browser's
		// chooser and permission prompt require a live user activation.
		const inputPromise = prepareTimedRecordingInputs(recordingOptions);
		const contextPromise = Promise.resolve(engine.getAudioContext()).then(async (context) => {
			await context.resume();
			return context;
		});
		try {
			const [preparedInputs] = await Promise.all([inputPromise, contextPromise]);
			if (generation !== state.timedRecordingGeneration || state.disposed || projectId !== project?.id) {
				throw abortError();
			}
			syncRecordingPoolSnapshot();
			const scheduled = Object.freeze({
				generation,
				projectId,
				startTimeMs,
				options: recordingOptions,
				inputKeys: Object.freeze(preparedInputs.inputKeys),
			});
			state.timedRecording = scheduled;
			await startRecording({
				...recordingOptions,
				timedStartTimeMs: startTimeMs,
				timedGeneration: generation,
				reusePreparedInputsOnly: true,
			});
			if (generation !== state.timedRecordingGeneration || state.timedRecording !== scheduled || state.disposed) {
				throw abortError();
			}
			if (!state.recorder) throw new Error(copy.timedRecordingMissed || copy.timedRecordingPast);
			armTimedRecordingTimer(scheduled);
			setStatus(copy.timedRecordingScheduled.replace(
				'{time}',
				new Date(startTimeMs).toLocaleString(locale),
			), 'success');
			return Object.freeze({
				startTimeMs,
				startTime: new Date(startTimeMs).toISOString(),
				trackId: recordingOptions.trackId || null,
			});
		} catch (error) {
			if (generation === state.timedRecordingGeneration) state.timedRecording = null;
			if (generation === state.timedRecordingGeneration && !state.preferences.recording.retainInputs) {
				releaseUnretainedRecordingInputs();
				syncRecordingPoolSnapshot();
			}
			if (generation !== state.timedRecordingGeneration || error?.name === 'AbortError') return null;
			throw error;
		} finally {
			if (generation === state.timedRecordingGeneration) {
				state.timedRecordingPreparing = false;
				publishDocumentSnapshot();
			}
		}
	}

	async function prepareTimedRecordingInputs(options = {}) {
		const sampleRate = projectSampleRate();
		if (options.trackId) {
			const track = findTrack(project, options.trackId);
			if (!track || track.type !== 'audio') throw new Error(copy.armTrackForRecording);
			const explicitRoute = state.recordingRouting.routes[track.id];
			const needsRoutedRecording = explicitRoute && (
				explicitRoute.kind === 'display'
				|| explicitRoute.deviceId !== RECORDING_DEFAULT_DEVICE_ID
				|| explicitRoute.channelStart > 0
				|| explicitRoute.channelCount !== 2
			);
			const route = needsRoutedRecording ? explicitRoute : {
				kind: 'device',
				deviceId: RECORDING_DEFAULT_DEVICE_ID,
				channelStart: 0,
				channelCount: state.preferredInputChannelCount,
			};
			const requestedChannels = route.channelStart + route.channelCount;
			const retained = route.kind === 'display'
				? recordingCapturePool.getDisplay?.()
				: recordingCapturePool.getHardware?.(route.deviceId);
			if (options.reusePreparedInputsOnly && (!retained
				|| (route.kind !== 'display' && streamAudioChannelCount(retained) < requestedChannels))) {
				throw new Error('The prepared recording input closed before the timer was armed.');
			}
			const stream = route.kind === 'display'
				? retained || await recordingCapturePool.acquireDisplay()
				: await recordingCapturePool.acquireHardware(route.deviceId, {
					channelCount: requestedChannels,
					sampleRate,
				});
			if (!recordingStreamIsLive(stream, route.kind)) {
				throw new Error('The recording input closed before the timer was armed.');
			}
			return Object.freeze({ inputKeys: Object.freeze([recordingRouteSourceKey(route)]) });
		}

		const armedTracks = project.tracks.filter((track) => track.type === 'audio' && track.armed);
		if (!armedTracks.length) throw new Error(copy.armTrackForRecording);
		const groups = new Map();
		for (const track of armedTracks) {
			const route = state.recordingRouting.routes[track.id];
			if (!route) {
				state.recordingRouteHealth[track.id] = 'skipped';
				continue;
			}
			const sourceKey = recordingRouteSourceKey(route);
			if (!groups.has(sourceKey)) groups.set(sourceKey, []);
			groups.get(sourceKey).push({ track, route });
			state.recordingRouteHealth[track.id] = 'opening';
		}
		if (!groups.size) throw new Error('Assign an input to at least one armed track before recording.');
		const orderedGroups = [...groups.entries()].sort(([left], [right]) => (
			left === 'display' ? -1 : right === 'display' ? 1 : 0
		));
		const acquisitions = orderedGroups.map(([sourceKey, routes]) => {
			const firstRoute = routes[0].route;
			const requiredChannels = Math.max(...routes.map(({ route }) => route.channelStart + route.channelCount));
			const promise = firstRoute.kind === 'display'
				? recordingCapturePool.acquireDisplay()
				: recordingCapturePool.acquireHardware(firstRoute.deviceId, { channelCount: requiredChannels, sampleRate });
			return { sourceKey, routes, promise };
		});
		const settled = await Promise.allSettled(acquisitions.map(({ promise }) => promise));
		let availableRoutes = 0;
		let failedRoutes = 0;
		for (let index = 0; index < acquisitions.length; index += 1) {
			const { routes } = acquisitions[index];
			const result = settled[index];
			if (result.status === 'rejected') {
				for (const { track } of routes) state.recordingRouteHealth[track.id] = 'unavailable';
				failedRoutes += routes.length;
				continue;
			}
			const availableChannels = streamAudioChannelCount(result.value);
			for (const { track, route } of routes) {
				const available = recordingStreamIsLive(result.value, route.kind)
					&& (route.kind === 'display' || route.channelStart + route.channelCount <= availableChannels);
				state.recordingRouteHealth[track.id] = available ? 'open' : 'skipped';
				if (available) availableRoutes += 1;
				else failedRoutes += 1;
			}
		}
		if (!availableRoutes || failedRoutes) throw new Error('Every assigned recording input must remain available for timer recording.');
		return Object.freeze({ inputKeys: Object.freeze(acquisitions.map(({ sourceKey }) => sourceKey)) });
	}

	function armTimedRecordingTimer(scheduled) {
		if (state.timedRecording !== scheduled) return;
		if (state.timedRecordingTimer !== null) clearScheduledTimer(state.timedRecordingTimer);
		const delay = Math.max(0, Math.min(MAXIMUM_TIMER_DELAY_MS, scheduled.startTimeMs - currentTimeMs()));
		state.timedRecordingTimer = scheduleTimer(() => {
			state.timedRecordingTimer = null;
			if (state.timedRecording !== scheduled) return null;
			if (scheduled.startTimeMs > currentTimeMs()) {
				armTimedRecordingTimer(scheduled);
				return null;
			}
			return beginTimedRecording(scheduled);
		}, delay);
	}

	async function beginTimedRecording(scheduled) {
		if (state.timedRecording !== scheduled || scheduled.projectId !== project?.id || state.disposed) return null;
		if (!state.recorder) {
			cancelTimedRecording();
			return null;
		}
		state.timedRecording = null;
		state.timedRecordingTimer = null;
		try {
			for (const entry of state.recordingEntries || []) state.recordingRouteHealth[entry.trackId] = 'recording';
			await engine.play();
			setStatus(copy.recording);
			updateTransportState('recording');
			publishDocumentSnapshot();
			return true;
		} catch (error) {
			handleError(error);
			void discardPreparedTimedRecording();
			return null;
		}
	}

	function cancelTimedRecording(options = {}) {
		const hadTimer = Boolean(state.timedRecording || state.timedRecordingPreparing || state.timedRecordingTimer !== null);
		const hadPreparedRecorder = Boolean(hadTimer && state.recorder);
		state.timedRecordingGeneration += 1;
		if (state.timedRecordingTimer !== null) clearScheduledTimer(state.timedRecordingTimer);
		state.timedRecordingTimer = null;
		state.timedRecording = null;
		state.timedRecordingPreparing = false;
		state.timedRecordingCancelling = hadPreparedRecorder;
		if (hadPreparedRecorder) state.recordingDiscardRequested = true;
		if (state.recordingStarting) cancelRecordingStart();
		if (hadPreparedRecorder) void discardPreparedTimedRecording();
		if (hadTimer && options.releaseInputs !== false) {
			releaseUnretainedRecordingInputs({ force: true });
			state.recordingReleaseAfterStop = false;
			syncRecordingPoolSnapshot();
		}
		if (options.status !== false && hadTimer) setStatus(copy.timedRecordingCancelled);
		else if (options.publish !== false) publishDocumentSnapshot();
		return hadTimer;
	}

	async function discardPreparedTimedRecording() {
		const recorder = state.recorder;
		try {
			if (recorder && state.recorder === recorder) {
				await recorder.stop?.();
				await finalizeRecording();
			}
		} catch (error) {
			handleError(error);
		} finally {
			state.timedRecordingCancelling = false;
			if (!state.recorder) {
				syncRecordingPoolSnapshot();
				publishDocumentSnapshot();
			}
		}
	}

	function cancelRecordingStart() {
		if (!state.recordingStarting && !state.recordingStartPromise) return false;
		state.recordingStartGeneration += 1;
		state.recordingStarting = false;
		if (!state.recorder) releaseUnretainedRecordingInputs();
		return true;
	}

	function assertRecordingStartActive(token) {
		if (!token
			|| state.disposed
			|| token.generation !== state.recordingStartGeneration
			|| token.projectId !== project?.id) {
			throw abortError();
		}
	}

	function startRecording(options = {}) {
		const timedStart = Number.isFinite(Number(options.timedStartTimeMs))
			&& state.timedRecording?.generation === options.timedGeneration;
		if (state.readOnly || state.recordingStarting || state.recordingStartPromise || state.recorder
			|| (!timedStart && (state.timedRecordingPreparing || state.timedRecording))) return;
		if (state.projectBinPreview) void stopProjectBinPreview();
		const token = Object.freeze({
			generation: ++state.recordingStartGeneration,
			projectId: project?.id,
		});
		const explicitRoute = options.trackId ? state.recordingRouting.routes[options.trackId] : null;
		const needsRoutedRecording = explicitRoute && (
			explicitRoute.kind === 'display'
			|| explicitRoute.deviceId !== RECORDING_DEFAULT_DEVICE_ID
			|| explicitRoute.channelStart > 0
			|| explicitRoute.channelCount !== 2
		);
		const operation = options.trackId && !needsRoutedRecording
			? startLegacyRecording(options, token)
			: startRoutedRecording(options, token);
		const tracked = Promise.resolve(operation).finally(() => {
			if (state.recordingStartPromise === tracked) state.recordingStartPromise = null;
		});
		state.recordingStartPromise = tracked;
		return tracked;
	}

	async function startLegacyRecording(options = {}, token) {
		if (state.readOnly || state.recordingStarting || state.recorder) return;
		const timedStartTimeMs = Number(options.timedStartTimeMs);
		const timedStart = Number.isFinite(timedStartTimeMs);
		const track = options.trackId
			? findTrack(project, options.trackId)
			: project.tracks.find((item) => item.armed);
		if (!track) throw new Error(copy.armTrackForRecording);
		state.recordingStarting = true;
		state.recordingFatalError = null;
		state.recordingDiscardRequested = false;
		publishDocumentSnapshot();
		let stream = null;
		let writer = null;
		let recorder = null;
		try {
			assertRecordingStartActive(token);
			const sampleRate = projectSampleRate();
			// The legacy path still records the active/explicit track from the
			// default input, but reuses that input between takes when retention is on.
			stream = recordingCapturePool.getHardware?.(RECORDING_DEFAULT_DEVICE_ID);
			if (options.reusePreparedInputsOnly && (!stream || streamAudioChannelCount(stream) < 2)) {
				throw new Error('The prepared recording input closed before the timer was armed.');
			}
			stream = await recordingCapturePool.acquireHardware(RECORDING_DEFAULT_DEVICE_ID, { channelCount: 2, sampleRate });
			assertRecordingStartActive(token);
			syncRecordingPoolSnapshot();
			if (!timedStart) await beginPlaybackCachePreparation(project);
			assertRecordingStartActive(token);
			const context = await engine.getAudioContext();
			assertRecordingStartActive(token);
			await context.resume();
			assertRecordingStartActive(token);
			await startMicrophoneMetering({ force: true });
			assertRecordingStartActive(token);
			const inputTrack = stream.getAudioTracks()[0];
			const trackSettings = inputTrack?.getSettings?.() || {};
			const channelCount = Math.min(2, trackSettings.channelCount || 1);
			const captureSampleRate = context.sampleRate || sampleRate;
			await preflightStorage(captureSampleRate * channelCount * Float32Array.BYTES_PER_ELEMENT * 60, 'recording');
			assertRecordingStartActive(token);
			const sourceId = createStableId('recording');
			writer = createCoalescingSourceWriter(await store.beginSourceWrite(sourceId, {
				name: `${copy.recordingLabel} ${new Date().toLocaleTimeString(locale)}`,
				mimeType: 'audio/wav',
				sampleRate: captureSampleRate,
				channelCount,
				chunkFrames: SOURCE_CHUNK_FRAMES,
			}));
			assertRecordingStartActive(token);
			const previewResampler = createStreamingWindowedSincResampler(captureSampleRate, sampleRate, channelCount);
			const selection = activeSelection();
			const requestedStartFrame = selection?.startFrame ?? engine.getPositionFrames();
			const automaticLatency = (context.baseLatency || 0) + (context.outputLatency || 0) + (Number(trackSettings.latency) || 0);
			const manualLatency = state.latencyOffsetMs / 1000;
			const latencyFrames = Math.max(0, Math.round((automaticLatency + manualLatency) * sampleRate));
			const recordingStartFrame = selection ? requestedStartFrame : Math.max(0, requestedStartFrame - latencyFrames);
			const recordingSourceOffsetProjectFrames = selection ? latencyFrames : Math.max(0, latencyFrames - requestedStartFrame);
			const recordingSourceOffsetFrames = scaleRecordingFrames(
				recordingSourceOffsetProjectFrames,
				sampleRate,
				captureSampleRate,
			);
			const preview = createRecordingPreview({
				trackId: track.id,
				startFrame: recordingStartFrame,
				channelCount,
				framesToSkip: recordingSourceOffsetProjectFrames,
			});
			recorder = await recordingControllerFactory({
				context,
				stream,
				channelCount,
				discreteChannels: false,
				monitor: state.monitoring,
				inputGain: state.recordingInputGain,
				onChunk: async ({ channels }) => {
					if (channels[0]?.length) await writer.write(channels);
					appendRecordingPreview(preview, previewResampler.push(channels));
					let peak = 0;
					for (const channel of channels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
					const db = peak > 0 ? 20 * Math.log10(peak) : -60;
					state.inputMeterDb = Math.max(-60, db);
					updatePlayhead();
					publishRecordingPreview();
				},
				onError: (error) => {
					state.recordingFatalError = error;
					handleError(error);
					if (state.recorder && !state.recordingFinishing) void stopRecording().catch(handleError);
				},
				onState: (recordingState) => {
					if (recordingState === 'stopped' && state.recorder && !state.recordingFinishing) void finalizeRecording();
				},
			});
			assertRecordingStartActive(token);
			state.recordingStartFrame = recordingStartFrame;
			state.recordingSourceOffsetFrames = recordingSourceOffsetFrames;
			state.recordingPreview = preview;
			state.recordingPreviews = [preview];
			state.recordingWriter = writer;
			state.recordingStream = stream;
			state.recordingSourceId = sourceId;
			state.recordingTrackId = track.id;
			state.recordingSelection = selection ? { ...selection } : null;
			state.recordingResampler = previewResampler;
			state.recordingSampleRate = captureSampleRate;
			state.recorder = recorder;
			const remainingSeconds = timedStart ? (timedStartTimeMs - currentTimeMs()) / 1000 : null;
			if (timedStart && remainingSeconds <= 0) throw new RangeError(copy.timedRecordingPast);
			const scheduledTime = timedStart ? context.currentTime + remainingSeconds : context.currentTime + 0.08;
			const leadInFrames = !timedStart && state.leadInRecording
				? Math.round(sampleRate * 60 / Math.max(1, Number(project.tempo?.bpm) || 120)
					* Math.max(1, Number(project.tempo?.timeSignature?.numerator) || 4))
				: 0;
			const availableLeadInFrames = Math.min(leadInFrames, requestedStartFrame);
			const recordingDelaySeconds = availableLeadInFrames / sampleRate;
			const currentContextFrame = Math.ceil((scheduledTime + recordingDelaySeconds) * context.sampleRate);
			const selectionProjectFrames = selection
				? selection.endFrame - selection.startFrame + recordingSourceOffsetProjectFrames
				: 0;
			const stopFrame = selection
				? currentContextFrame + Math.ceil(selectionProjectFrames * context.sampleRate / sampleRate)
				: undefined;
			const interrupt = () => { if (state.recorder && !state.recordingFinishing) void stopRecording().catch(handleError); };
			inputTrack?.addEventListener?.('ended', interrupt, { once: true });
			const contextStateChange = () => { if (context.state === 'suspended' && state.recorder) interrupt(); };
			context.addEventListener?.('statechange', contextStateChange);
			state.recordingCleanup = () => {
				inputTrack?.removeEventListener?.('ended', interrupt);
				context.removeEventListener?.('statechange', contextStateChange);
			};
			engine.setLoop(false);
			engine.seek(requestedStartFrame - availableLeadInFrames);
			if (timedStart) {
				recorder.start({ startFrame: currentContextFrame, stopFrame });
				assertRecordingStartActive(token);
			} else {
				await engine.playAt(scheduledTime, requestedStartFrame - availableLeadInFrames);
				assertRecordingStartActive(token);
				recorder.start({ startFrame: currentContextFrame, stopFrame });
				state.recordingPaused = false;
				setStatus(copy.recording);
				updateTransportState('recording');
			}
		} catch (error) {
			const ownsStart = token.generation === state.recordingStartGeneration;
			const handedOff = Boolean(!ownsStart && recorder && state.recorder === recorder);
			if (ownsStart) {
				state.recordingCleanup?.();
				state.recordingCleanup = null;
			}
			if (!handedOff) {
				await recorder?.dispose?.({ stopTracks: false }).catch(() => undefined);
				await writer?.abort?.().catch(() => undefined);
			}
			releaseUnretainedRecordingInputs();
			if (ownsStart) {
				syncRecordingPoolSnapshot();
				state.recorder = null;
				state.recordingWriter = null;
				state.recordingStream = null;
				state.recordingResampler = null;
				state.recordingSampleRate = null;
				state.recordingPreview = null;
				state.recordingPreviews = [];
				state.recordingPreviewLastPublishedAt = 0;
				state.recordingPaused = false;
			}
			if (error?.name === 'AbortError') return;
			throw error;
		} finally {
			if (token.generation === state.recordingStartGeneration) {
				state.recordingStarting = false;
				publishDocumentSnapshot();
			}
		}
	}

	async function startRoutedRecording(options = {}, token) {
		const timedStartTimeMs = Number(options.timedStartTimeMs);
		const timedStart = Number.isFinite(timedStartTimeMs);
		const explicitTrack = options.trackId ? findTrack(project, options.trackId) : null;
		if (options.trackId && explicitTrack?.type !== 'audio') throw new Error(copy.armTrackForRecording);
		const armedTracks = explicitTrack
			? [explicitTrack]
			: project.tracks.filter((track) => track.type === 'audio' && track.armed);
		if (!armedTracks.length) throw new Error(copy.armTrackForRecording);
		const routedTracks = [];
		for (const track of armedTracks) {
			const route = state.recordingRouting.routes[track.id];
			if (route) routedTracks.push({ track, route, sourceKey: recordingRouteSourceKey(route) });
			else state.recordingRouteHealth[track.id] = 'skipped';
		}
		if (!routedTracks.length) throw new Error('Assign an input to at least one armed track before recording.');

		state.recordingStarting = true;
		state.recordingFatalError = null;
		state.recordingDiscardRequested = false;
		publishDocumentSnapshot();
		const entries = [];
		const sourceSessions = [];
		let routedRecorder = null;
		const maybeFinalizeDisconnectedSession = () => {
			if (state.recorder === routedRecorder
				&& routedRecorder?.state !== 'ready'
				&& sourceSessions.length
				&& sourceSessions.every((source) => source.stopped)
				&& !state.recordingFinishing) void finalizeRecording();
		};
		const disconnectSession = (session) => {
			if (session.disconnected) return;
			session.disconnected = true;
			for (const { track } of session.routes) state.recordingRouteHealth[track.id] = 'disconnected';
			if (token.generation === state.recordingStartGeneration) publishDocumentSnapshot();
			if (!session.controller || session.controller.state === 'ready') {
				session.stopped = true;
				maybeFinalizeDisconnectedSession();
				return;
			}
			Promise.resolve(session.controller.stop()).catch(() => undefined).finally(() => {
				session.stopped = true;
				maybeFinalizeDisconnectedSession();
			});
		};
		const dropFailedSourceSessions = async () => {
			for (const session of [...sourceSessions]) {
				if (!session.disconnected && !session.failed) continue;
				for (const remove of session.listeners) remove();
				await Promise.resolve(session.controller?.dispose?.({ stopTracks: false })).catch(() => undefined);
				for (const entry of session.entries) await entry.writer?.abort?.().catch(() => undefined);
				for (let index = entries.length - 1; index >= 0; index -= 1) {
					if (session.entries.includes(entries[index])) entries.splice(index, 1);
				}
				sourceSessions.splice(sourceSessions.indexOf(session), 1);
			}
		};
		try {
			assertRecordingStartActive(token);
			const sampleRate = projectSampleRate();
			const groups = new Map();
			for (const routed of routedTracks) {
				if (!groups.has(routed.sourceKey)) groups.set(routed.sourceKey, []);
				groups.get(routed.sourceKey).push(routed);
				state.recordingRouteHealth[routed.track.id] = 'open';
			}
			const orderedGroups = [...groups.entries()].sort(([left], [right]) => (
				left === 'display' ? -1 : right === 'display' ? 1 : 0
			));
			// Start every permission request directly from the record action. Display
			// capture is requested first so its transient user activation is retained.
			const acquisitions = orderedGroups.map(([sourceKey, routes]) => {
				const firstRoute = routes[0].route;
				const requiredChannels = Math.max(...routes.map(({ route }) => route.channelStart + route.channelCount));
				const retained = firstRoute.kind === 'display'
					? recordingCapturePool.getDisplay?.()
					: recordingCapturePool.getHardware?.(firstRoute.deviceId);
				const reusable = retained && (firstRoute.kind === 'display' || streamAudioChannelCount(retained) >= requiredChannels);
				const promise = reusable
					? Promise.resolve(retained)
					: options.reusePreparedInputsOnly
						? Promise.reject(new Error('A prepared recording input closed before the timer was armed.'))
						: firstRoute.kind === 'display'
							? recordingCapturePool.acquireDisplay()
							: recordingCapturePool.acquireHardware(firstRoute.deviceId, { channelCount: requiredChannels, sampleRate });
				return { sourceKey, routes, promise };
			});
			const settled = await Promise.allSettled(acquisitions.map(({ promise }) => promise));
			assertRecordingStartActive(token);
			for (let index = 0; index < acquisitions.length; index += 1) {
				const acquisition = acquisitions[index];
				const result = settled[index];
				if (result.status === 'rejected') {
					for (const { track } of acquisition.routes) state.recordingRouteHealth[track.id] = 'unavailable';
					continue;
				}
				const stream = result.value;
				const inputTrack = stream.getAudioTracks?.()[0];
				const availableChannels = streamAudioChannelCount(stream);
				const survivingRoutes = acquisition.routes.filter(({ track, route }) => {
					const valid = route.kind === 'display' || route.channelStart + route.channelCount <= availableChannels;
					if (!valid) state.recordingRouteHealth[track.id] = 'skipped';
					return valid;
				});
				if (!survivingRoutes.length) continue;
				const session = {
					sourceKey: acquisition.sourceKey,
					kind: survivingRoutes[0].route.kind,
					stream,
					inputTrack,
					channelCount: availableChannels,
					routes: survivingRoutes,
					entries: [],
					controller: null,
					stopped: false,
					disconnected: false,
					listeners: [],
				};
				sourceSessions.push(session);
				for (const mediaTrack of session.stream.getTracks?.() || []) {
					const disconnect = () => disconnectSession(session);
					mediaTrack.addEventListener?.('ended', disconnect, { once: true });
					session.listeners.push(() => mediaTrack.removeEventListener?.('ended', disconnect));
				}
				if (!recordingStreamIsLive(session.stream, session.kind)) disconnectSession(session);
			}
			await dropFailedSourceSessions();
			syncRecordingPoolSnapshot();
			if (!sourceSessions.length) {
				releaseUnretainedRecordingInputs();
				throw new Error('None of the assigned recording inputs are available.');
			}

			const routedChannelCount = sourceSessions.reduce((total, session) => (
				total + session.routes.reduce((sum, item) => sum + item.route.channelCount, 0)
			), 0);
			if (!timedStart) await beginPlaybackCachePreparation(project);
			assertRecordingStartActive(token);
			const context = await engine.getAudioContext();
			assertRecordingStartActive(token);
			await context.resume();
			assertRecordingStartActive(token);
			await dropFailedSourceSessions();
			if (!sourceSessions.length) throw new Error('None of the assigned recording inputs are available.');
			const captureSampleRate = context.sampleRate || sampleRate;
			await preflightStorage(captureSampleRate * routedChannelCount * Float32Array.BYTES_PER_ELEMENT * 60, 'recording');
			assertRecordingStartActive(token);
			const selection = activeSelection();
			const requestedStartFrame = selection?.startFrame ?? engine.getPositionFrames();
			for (const session of sourceSessions) {
				if (session.disconnected) continue;
				const trackSettings = session.inputTrack?.getSettings?.() || {};
				const automaticLatency = (context.baseLatency || 0) + (context.outputLatency || 0) + (Number(trackSettings.latency) || 0);
				const manualLatencyMs = state.recordingRouting.offsets[session.sourceKey] ?? state.latencyOffsetMs;
				const latencyFrames = Math.max(0, Math.round((automaticLatency + manualLatencyMs / 1000) * sampleRate));
				session.latencyFrames = latencyFrames;
				session.recordingStartFrame = selection ? requestedStartFrame : Math.max(0, requestedStartFrame - latencyFrames);
				session.sourceOffsetProjectFrames = selection ? latencyFrames : Math.max(0, latencyFrames - requestedStartFrame);
				session.sourceOffsetFrames = scaleRecordingFrames(
					session.sourceOffsetProjectFrames,
					sampleRate,
					captureSampleRate,
				);
				for (const { track, route } of session.routes) {
					const sourceId = createStableId('recording');
					const writer = createCoalescingSourceWriter(await store.beginSourceWrite(sourceId, {
						name: `${copy.recordingLabel} ${new Date().toLocaleTimeString(locale)}`,
						mimeType: 'audio/wav',
						sampleRate: captureSampleRate,
						channelCount: route.channelCount,
						chunkFrames: SOURCE_CHUNK_FRAMES,
					}));
					const preview = createRecordingPreview({
						trackId: track.id,
						startFrame: session.recordingStartFrame,
						channelCount: route.channelCount,
						framesToSkip: session.sourceOffsetProjectFrames,
					});
					const entry = {
						trackId: track.id,
						route,
						sourceKey: session.sourceKey,
						sourceId,
						writer,
						previewResampler: createStreamingWindowedSincResampler(captureSampleRate, sampleRate, route.channelCount),
						preview,
						sampleRate: captureSampleRate,
						selection: selection ? { ...selection } : null,
						recordingStartFrame: session.recordingStartFrame,
						sourceOffsetFrames: session.sourceOffsetFrames,
						sourceOffsetProjectFrames: session.sourceOffsetProjectFrames,
						committed: false,
					};
					entries.push(entry);
					session.entries.push(entry);
					assertRecordingStartActive(token);
				}
			}
			await dropFailedSourceSessions();
			if (!sourceSessions.length) throw new Error('None of the assigned recording inputs are available.');
			const selectedMeterEntry = entries.find((entry) => entry.trackId === state.selectedTrackId) || entries[0] || null;
			if (selectedMeterEntry) {
				const nextMeterKey = [
					selectedMeterEntry.sourceKey,
					selectedMeterEntry.route.channelStart,
					selectedMeterEntry.route.channelCount,
					captureSampleRate,
				].join(':');
				if (!routedInputLoudnessMeter || routedInputLoudnessMeterKey !== nextMeterKey) {
					routedInputLoudnessMeter = createEbuR128Meter({
						sampleRate: captureSampleRate,
						channelCount: selectedMeterEntry.route.channelCount,
					});
					routedInputLoudnessMeterKey = nextMeterKey;
					state.inputMeter = routedInputLoudnessMeter.snapshot();
				}
			}

			const handleFatalRecordingError = (error) => {
				state.recordingFatalError = error;
				handleError(error);
				if (state.recorder && !state.recordingFinishing) void stopRecording().catch(handleError);
			};
			for (const session of sourceSessions) {
				try {
					session.controller = await recordingControllerFactory({
					context,
					stream: session.stream,
					channelCount: session.channelCount,
					monitor: session.kind === 'device' && state.monitoring,
					inputGain: session.kind === 'device' ? state.recordingInputGain : 1,
					onChunk: async ({ channels }) => {
						let sourcePeak = 0;
						const writes = await Promise.allSettled(session.entries.map(async (entry) => {
							const routedChannels = Array.from({ length: entry.route.channelCount }, (_, channelIndex) => (
								channels[entry.route.channelStart + channelIndex]
								|| (session.kind === 'display' ? channels[0] : null)
								|| new Float32Array(channels[0]?.length || 0)
							));
							if (entry === selectedMeterEntry && routedChannels[0]?.length) {
								routedInputLoudnessMeter?.push(routedChannels, (reading) => {
									state.inputMeter = reading;
									state.inputMeterDb = Math.max(-60, Number(reading.dbfs) || -60);
								});
							}
							if (routedChannels[0]?.length) await entry.writer.write(routedChannels);
							appendRecordingPreview(entry.preview, entry.previewResampler.push(routedChannels));
							let peak = 0;
							for (const channel of routedChannels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
							sourcePeak = Math.max(sourcePeak, peak);
							state.inputMeters[entry.trackId] = peak > 0 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
						}));
						const failedWrite = writes.find((result) => result.status === 'rejected');
						if (failedWrite) throw failedWrite.reason;
						state.inputMeterDb = sourcePeak > 0 ? Math.max(-60, 20 * Math.log10(sourcePeak)) : -60;
						updatePlayhead();
						publishRecordingPreview();
					},
					onError: handleFatalRecordingError,
					onState: (recordingState) => {
						if (recordingState !== 'stopped') return;
						session.stopped = true;
						if (state.recorder === routedRecorder && sourceSessions.every((source) => source.stopped) && !state.recordingFinishing) {
							void finalizeRecording();
						}
					},
					});
					assertRecordingStartActive(token);
					if (!recordingStreamIsLive(session.stream, session.kind)) disconnectSession(session);
				} catch (error) {
					if (error?.name === 'AbortError') throw error;
					session.failed = true;
					const health = recordingStreamIsLive(session.stream, session.kind) ? 'unavailable' : 'disconnected';
					for (const { track } of session.routes) state.recordingRouteHealth[track.id] = health;
				}
			}
			await dropFailedSourceSessions();
			if (!sourceSessions.length) throw new Error('None of the assigned recording inputs are available.');

			routedRecorder = createRoutedRecordingController(sourceSessions);
			state.recordingEntries = entries;
			state.recordingPreviews = entries.map((entry) => entry.preview);
			state.recordingPreview = state.recordingPreviews[0] || null;
			state.recordingSelection = selection ? { ...selection } : null;
			state.recorder = routedRecorder;
			const remainingSeconds = timedStart ? (timedStartTimeMs - currentTimeMs()) / 1000 : null;
			if (timedStart && remainingSeconds <= 0) throw new RangeError(copy.timedRecordingPast);
			const scheduledTime = timedStart ? context.currentTime + remainingSeconds : context.currentTime + 0.08;
			const leadInFrames = !timedStart && state.leadInRecording
				? Math.round(sampleRate * 60 / Math.max(1, Number(project.tempo?.bpm) || 120)
					* Math.max(1, Number(project.tempo?.timeSignature?.numerator) || 4))
				: 0;
			const availableLeadInFrames = Math.min(leadInFrames, requestedStartFrame);
			const recordingDelaySeconds = availableLeadInFrames / sampleRate;
			const currentContextFrame = Math.ceil((scheduledTime + recordingDelaySeconds) * context.sampleRate);
			for (const session of sourceSessions) {
				const selectionProjectFrames = selection
					? selection.endFrame - selection.startFrame + session.sourceOffsetProjectFrames
					: 0;
				session.startFrame = currentContextFrame;
				session.stopFrame = selection
					? currentContextFrame + Math.ceil(selectionProjectFrames * context.sampleRate / sampleRate)
					: undefined;
				for (const entry of session.entries) state.recordingRouteHealth[entry.trackId] = timedStart ? 'open' : 'recording';
			}
			const contextStateChange = () => {
				if (context.state === 'suspended' && state.recorder) void stopRecording().catch(handleError);
			};
			context.addEventListener?.('statechange', contextStateChange);
			state.recordingCleanup = () => {
				for (const session of sourceSessions) for (const remove of session.listeners) remove();
				context.removeEventListener?.('statechange', contextStateChange);
			};
			engine.setLoop(false);
			engine.seek(requestedStartFrame - availableLeadInFrames);
			if (timedStart) {
				routedRecorder.start();
				assertRecordingStartActive(token);
			} else {
				await engine.playAt(scheduledTime, requestedStartFrame - availableLeadInFrames);
				assertRecordingStartActive(token);
				await dropFailedSourceSessions();
				assertRecordingStartActive(token);
				if (!sourceSessions.length) throw new Error('None of the assigned recording inputs are available.');
				state.recordingPreviews = entries.map((entry) => entry.preview);
				state.recordingPreview = state.recordingPreviews[0] || null;
				routedRecorder.start();
				state.recordingPaused = false;
				setStatus(copy.recording);
				updateTransportState('recording');
			}
		} catch (error) {
			const ownsStart = token.generation === state.recordingStartGeneration;
			const handedOff = Boolean(!ownsStart && routedRecorder && state.recorder === routedRecorder);
			if (ownsStart) {
				engine.pause();
				state.recordingCleanup?.();
				state.recordingCleanup = null;
			}
			if (!handedOff) {
				for (const session of sourceSessions) for (const remove of session.listeners) remove();
				await routedRecorder?.dispose?.({ stopTracks: false }).catch(() => undefined);
				for (const session of sourceSessions) await session.controller?.dispose?.({ stopTracks: false }).catch(() => undefined);
				for (const entry of entries) await entry.writer?.abort?.().catch(() => undefined);
			}
			if (ownsStart) {
				state.recorder = null;
				state.recordingEntries = null;
				state.recordingPreviews = [];
				state.recordingPreview = null;
				state.recordingSelection = null;
				state.recordingPaused = false;
				state.inputMeters = {};
				state.inputMeterDb = -60;
				state.recordingFatalError = null;
				releaseUnretainedRecordingInputs();
				syncRecordingPoolSnapshot();
			}
			if (!ownsStart) releaseUnretainedRecordingInputs();
			if (error?.name === 'AbortError') return;
			throw error;
		} finally {
			if (token.generation === state.recordingStartGeneration) {
				state.recordingStarting = false;
				publishDocumentSnapshot();
			}
		}
	}

	function createRoutedRecordingController(sourceSessions) {
		let controllerState = 'ready';
		return {
			get state() { return controllerState; },
			start() {
				controllerState = 'recording';
				for (const session of sourceSessions) {
					if (session.disconnected) {
						session.stopped = true;
						continue;
					}
					session.controller.start({
						startFrame: session.startFrame,
						stopFrame: session.stopFrame,
					});
				}
			},
			pause() {
				if (controllerState !== 'recording') return false;
				controllerState = 'paused';
				for (const session of sourceSessions) if (!session.stopped) session.controller.pause();
				return true;
			},
			resume() {
				if (controllerState !== 'paused') return false;
				controllerState = 'recording';
				for (const session of sourceSessions) if (!session.stopped) session.controller.resume();
				return true;
			},
			async stop() {
				if (controllerState === 'stopped' || controllerState === 'disposed') return;
				controllerState = 'stopping';
				await Promise.allSettled(sourceSessions.map((session) => session.stopped ? null : session.controller.stop()));
				for (const session of sourceSessions) session.stopped = true;
				controllerState = 'stopped';
			},
			setMonitoring(enabled) {
				for (const session of sourceSessions) if (session.kind === 'device') session.controller.setMonitoring(enabled);
			},
			setInputGain(value) {
				for (const session of sourceSessions) if (session.kind === 'device') session.controller.setInputGain(value);
			},
			async dispose() {
				await Promise.allSettled(sourceSessions.map((session) => session.controller.dispose({ stopTracks: false })));
				controllerState = 'disposed';
			},
		};
	}

	async function stopRecording() {
		if (state.timedRecording || state.timedRecordingPreparing) return cancelTimedRecording();
		if (state.recordingStarting) {
			cancelRecordingStart();
			publishDocumentSnapshot();
		}
		if (state.recordingFinalizePromise) return state.recordingFinalizePromise;
		if (!state.recorder) return;
		let stopError = null;
		try {
			await state.recorder.stop();
		} catch (error) {
			stopError = error;
		}
		await finalizeRecording();
		if (stopError) throw stopError;
	}

	async function finalizeRoutedRecording() {
		if (!state.recorder || !state.recordingEntries || state.recordingFinishing) return;
		state.recordingFinishing = true;
		const recorder = state.recorder;
		const entries = state.recordingEntries;
		const committedEntries = [];
		try {
			engine.pause();
			await recorder.dispose({ stopTracks: false });
			if (state.recordingDiscardRequested) {
				for (const entry of entries) await entry.writer?.abort?.().catch(() => undefined);
				return;
			}
			if (state.recordingFatalError) throw state.recordingFatalError;
			for (const entry of entries) {
				appendRecordingPreview(entry.preview, entry.previewResampler?.finish?.());
			}
			const projectRate = projectSampleRate();
			const commands = [];
			const clipIds = [];
			for (const entry of entries) {
				const frames = entry.writer.framesWritten;
				if (frames <= entry.sourceOffsetFrames) {
					await entry.writer.abort();
					state.recordingRouteHealth[entry.trackId] = 'skipped';
					continue;
				}
				const metadata = await entry.writer.commit({ sampleRate: entry.sampleRate, channelCount: entry.route.channelCount });
				entry.committed = true;
				committedEntries.push(entry);
				const recordedSource = {
					schemaVersion: 2,
					sampleRate: entry.sampleRate,
					originalSampleRate: entry.sampleRate,
					sampleFormat: 'float32',
					chunkFrames: SOURCE_CHUNK_FRAMES,
					id: entry.sourceId,
					storageKey: entry.sourceId,
					name: metadata.name,
					mimeType: 'audio/wav',
					frameCount: frames,
					channelCount: metadata.channelCount || entry.route.channelCount,
				};
				const sourceCommand = createAddSourceCommand(recordedSource);
				await activateStoredSource(recordedSource, metadata);
				const sourceStartFrame = Math.min(entry.sourceOffsetFrames, Math.max(0, frames - 1));
				const availableFrames = frames - sourceStartFrame;
				const availableProjectFrames = Math.max(1, scaleRecordingFrames(availableFrames, entry.sampleRate, projectRate));
				const durationFrames = entry.selection
					? Math.min(availableProjectFrames, entry.selection.endFrame - entry.selection.startFrame)
					: availableProjectFrames;
				if (durationFrames <= 0) continue;
				const sourceDurationFrames = entry.selection
					? Math.min(availableFrames, Math.max(1, scaleRecordingFrames(durationFrames, projectRate, entry.sampleRate)))
					: availableFrames;
				const clipId = createStableId('clip');
				const clipCommand = preparePunchCommand(project, {
					trackId: entry.trackId,
					startFrame: entry.recordingStartFrame,
					endFrame: entry.recordingStartFrame + durationFrames,
					sourceId: entry.sourceId,
					sourceStartFrame,
					sourceDurationFrames,
					clipId,
				});
				commands.push(sourceCommand, clipCommand);
				clipIds.push(clipId);
			}
			if (commands.length) {
				commit({ type: 'batch', commands }, {
					selectTrackId: entries.find((entry) => entry.committed)?.trackId,
					selectClipId: clipIds[0],
				});
				setStatus(copy.done, 'success');
			}
		} catch (error) {
			for (const entry of entries) await entry.writer?.abort?.().catch(() => undefined);
			for (const entry of committedEntries) {
				sourceBuffers.delete(entry.sourceId);
				sourceChunkProviders.delete(entry.sourceId);
				sourcePeaks.delete(entry.sourceId);
				await Promise.resolve(store.deleteAnalysis?.(peakCacheKey(entry.sourceId))).catch(() => undefined);
				await store.deleteSource(entry.sourceId).catch(() => undefined);
			}
			handleError(error);
		} finally {
			state.recordingCleanup?.();
			state.recordingCleanup = null;
			state.recorder = null;
			state.recordingEntries = null;
			state.recordingWriter = null;
			state.recordingStream = null;
			state.recordingSourceId = null;
			state.recordingTrackId = null;
			state.recordingSelection = null;
			state.recordingResampler = null;
			state.recordingSampleRate = null;
			state.recordingPreview = null;
			state.recordingPreviews = [];
			state.recordingPreviewLastPublishedAt = 0;
			state.recordingPaused = false;
			state.recordingSourceOffsetFrames = 0;
			state.recordingFinishing = false;
			state.recordingFatalError = null;
			state.recordingDiscardRequested = false;
			state.inputMeterDb = -60;
			state.inputMeters = {};
			if (!state.preferences.recording.retainInputs || state.recordingReleaseAfterStop) {
				releaseUnretainedRecordingInputs({ force: state.recordingReleaseAfterStop });
			}
			state.recordingReleaseAfterStop = false;
			syncRecordingPoolSnapshot();
			publishTelemetrySnapshot();
			updateTransportState(engine.getState().state);
			publishDocumentSnapshot();
		}
	}

	function finalizeRecording() {
		if (state.recordingFinalizePromise) return state.recordingFinalizePromise;
		if (!state.recorder || state.recordingFinishing) return Promise.resolve();
		const operation = performFinalizeRecording();
		const tracked = operation.finally(() => {
			if (state.recordingFinalizePromise === tracked) state.recordingFinalizePromise = null;
		});
		state.recordingFinalizePromise = tracked;
		return tracked;
	}

	async function performFinalizeRecording() {
		if (!state.recorder || state.recordingFinishing) return;
		if (state.recordingEntries) return finalizeRoutedRecording();
		state.recordingFinishing = true;
		const recorder = state.recorder;
		const writer = state.recordingWriter;
		let sourceCommitted = false;
		try {
			engine.pause();
			await recorder.dispose({ stopTracks: false });
			if (state.recordingDiscardRequested) {
				await writer?.abort?.().catch(() => undefined);
				return;
			}
			if (state.recordingFatalError) throw state.recordingFatalError;
			appendRecordingPreview(state.recordingPreview, state.recordingResampler?.finish?.());
			const frames = writer.framesWritten;
			if (frames <= state.recordingSourceOffsetFrames) { await writer.abort(); return; }
			const projectRate = projectSampleRate();
			const sampleRate = state.recordingSampleRate || projectRate;
			const metadata = await writer.commit({ sampleRate });
			sourceCommitted = true;
			const sourceId = state.recordingSourceId;
			const recordedSource = {
				schemaVersion: 2,
				sampleRate,
				originalSampleRate: sampleRate,
				sampleFormat: 'float32',
				chunkFrames: SOURCE_CHUNK_FRAMES,
				id: sourceId,
				storageKey: sourceId,
				name: metadata.name,
				mimeType: 'audio/wav',
				frameCount: frames,
				channelCount: metadata.channelCount || 1,
			};
			const sourceCommand = createAddSourceCommand(recordedSource);
			await activateStoredSource(recordedSource, metadata);
			const selection = state.recordingSelection;
			const clipId = createStableId('clip');
			const sourceStartFrame = Math.min(state.recordingSourceOffsetFrames, Math.max(0, frames - 1));
			const availableFrames = frames - sourceStartFrame;
			const availableProjectFrames = Math.max(1, scaleRecordingFrames(availableFrames, sampleRate, projectRate));
			const durationFrames = selection
				? Math.min(availableProjectFrames, selection.endFrame - selection.startFrame)
				: availableProjectFrames;
			const sourceDurationFrames = selection
				? Math.min(availableFrames, Math.max(1, scaleRecordingFrames(durationFrames, projectRate, sampleRate)))
				: availableFrames;
			const clipCommand = preparePunchCommand(project, {
				trackId: state.recordingTrackId,
				startFrame: state.recordingStartFrame,
				endFrame: state.recordingStartFrame + durationFrames,
				sourceId,
				sourceStartFrame,
				sourceDurationFrames,
				clipId,
			});
			commit({ type: 'batch', commands: [sourceCommand, clipCommand] }, { selectTrackId: state.recordingTrackId, selectClipId: clipId });
			setStatus(copy.done, 'success');
		} catch (error) {
			await writer?.abort?.().catch(() => undefined);
			if (sourceCommitted && state.recordingSourceId) {
				sourceBuffers.delete(state.recordingSourceId);
				sourceChunkProviders.delete(state.recordingSourceId);
				sourcePeaks.delete(state.recordingSourceId);
				await store.deleteSource(state.recordingSourceId).catch(() => undefined);
			}
			handleError(error);
		} finally {
			state.recordingCleanup?.();
			state.recordingCleanup = null;
			state.recorder = null;
			state.recordingWriter = null;
			state.recordingStream = null;
			state.recordingSourceId = null;
			state.recordingTrackId = null;
			state.recordingSelection = null;
			state.recordingResampler = null;
			state.recordingSampleRate = null;
			state.recordingPreview = null;
			state.recordingPreviews = [];
			state.recordingPreviewLastPublishedAt = 0;
			state.recordingPaused = false;
			state.recordingSourceOffsetFrames = 0;
			state.recordingFinishing = false;
			state.recordingFatalError = null;
			state.recordingDiscardRequested = false;
			state.inputMeterDb = -60;
			state.inputMeters = {};
			if (!state.preferences.recording.retainInputs || state.recordingReleaseAfterStop) {
				releaseUnretainedRecordingInputs({ force: state.recordingReleaseAfterStop });
			}
			state.recordingReleaseAfterStop = false;
			syncRecordingPoolSnapshot();
			publishTelemetrySnapshot();
			updateTransportState(engine.getState().state);
			publishDocumentSnapshot();
		}
	}

	function editingBlocked() {
		return Boolean(state.readOnly || state.importing || state.recordingStarting || state.timedRecordingPreparing
			|| state.timedRecording || state.recorder || state.playAtSpeedAbort || state.exportAbort || state.audacityEffectProcessing || state.sampleEditProcessing);
	}

	function updatePlayhead(frame = 0, duration = project ? projectDurationFrames(project) : 0) {
		let nextFrame = Math.max(0, Math.round(Number(frame) || 0));
		let nextDuration = Math.max(0, Math.round(Number(duration) || 0));
		// The transport's project duration is fixed while a recording preview is
		// being appended. Keep the playhead in the same project-time space as the
		// preview, including recordings that extend the project.
		const recordingEndFrame = state.recordingPreviews.reduce((end, preview) => (
			Math.max(end, preview.startFrame + preview.frames)
		), 0);
		if (state.recorder && recordingEndFrame > 0) {
			nextFrame = Math.max(nextFrame, recordingEndFrame);
			nextDuration = Math.max(nextDuration, recordingEndFrame);
		}
		state.positionFrame = nextFrame;
		state.durationFrames = nextDuration;
		publishTelemetrySnapshot();
	}

	function updateTransportState(value) {
		const nextTransportState = value || 'stopped';
		if (nextTransportState !== state.transportState && nextTransportState !== 'recording') {
			state.inputLoudnessMeasurementExplicitlyRunning = false;
		}
		state.transportState = nextTransportState;
		microphoneMeterSession?.loudnessMeter?.setRunning(
			!state.inputLoudnessMeasurementManuallyPaused
				&& (state.transportState === 'recording'
					|| state.inputLoudnessMeasurementExplicitlyRunning),
		);
		routedInputLoudnessMeter?.setRunning(
			!state.inputLoudnessMeasurementManuallyPaused
				&& (state.transportState === 'recording'
					|| state.inputLoudnessMeasurementExplicitlyRunning),
		);
		microphoneMeterSession?.loudnessMeter?.requestSnapshot();
		if (state.transportState !== 'recording'
			&& !state.microphoneMetering
			&& !state.recorder
			&& microphoneMeterSession) {
			stopMicrophoneMetering({ releaseInput: false, preserveReading: true });
		}
		syncMetronome();
		publishTelemetrySnapshot();
	}

	function updateMeters(meters) {
		state.meters = meters || { tracks: {}, master: null };
		publishTelemetrySnapshot();
	}

	function updateZoom(action, requestedViewportWidth) {
		if (action === 'fit') {
			const viewport = Math.max(320, Number(requestedViewportWidth) || state.timelineViewportWidth || 960);
			const sampleRate = projectSampleRate();
			const editorDurationSeconds = editorTimelineDurationFrames(project, sampleRate) / sampleRate;
			const contentDurationFrames = projectDurationFrames(project);
			const fitDurationSeconds = contentDurationFrames > 0
				? contentDurationFrames / sampleRate
				: editorDurationSeconds;
			const maximum = Math.min(MAX_PIXELS_PER_SECOND, MAX_TIMELINE_PIXELS / editorDurationSeconds);
			state.pixelsPerSecond = Math.max(1, Math.min(maximum, viewport / fitDurationSeconds));
		} else {
			const durationSeconds = editorTimelineDurationFrames(project, projectSampleRate()) / projectSampleRate();
			const minimum = state.timelineViewportWidth > 0 ? state.timelineViewportWidth / durationSeconds : 1;
			state.pixelsPerSecond = Math.max(minimum, Math.min(MAX_PIXELS_PER_SECOND, state.pixelsPerSecond * (action === 'in' ? 2 : 0.5)));
		}
		if (!sampleEditingAvailable()) state.sampleEditMode = null;
		publishProjectState();
		return state.pixelsPerSecond;
	}

	function setTimelineViewportWidth(width) {
		const nextWidth = Math.max(0, Number(width) || 0);
		if (nextWidth === state.timelineViewportWidth) return nextWidth;
		state.timelineViewportWidth = nextWidth;
		publishProjectState();
		return nextWidth;
	}

	function setAutoFitTrackHeight(enabled) {
		state.autoFitTrackHeight = Boolean(enabled);
		publishProjectState();
		return state.autoFitTrackHeight;
	}

	function setVisibleTrackHeights(heights = {}) {
		state.visibleTrackHeights = Object.fromEntries(Object.entries(heights)
			.filter(([trackId, height]) => project?.tracks.some((track) => track.id === trackId)
				&& Number.isFinite(Number(height)))
			.map(([trackId, height]) => [trackId, Math.max(40, Math.round(Number(height)))]));
		return state.visibleTrackHeights;
	}

	function adjustTrackHeight(trackId, delta) {
		const track = findTrack(project, trackId);
		if (!track) throw new Error(copy.trackNotFound);
		const currentHeight = state.visibleTrackHeights[track.id] ?? track.height ?? 114;
		return resizeTrackHeight(track.id, currentHeight + delta, state.visibleTrackHeights);
	}

	function adjustAllTrackHeights(delta) {
		if (editingBlocked()) return null;
		const commands = project.tracks.map((track) => {
			const currentHeight = state.visibleTrackHeights[track.id] ?? track.height ?? 114;
			return {
				type: 'track/update',
				trackId: track.id,
				changes: { height: Math.max(40, Math.round(currentHeight + delta)) },
			};
		});
		state.autoFitTrackHeight = false;
		if (commands.length) return commit({ type: 'batch', commands });
		publishProjectState();
		return project;
	}

	function resizeTrackHeight(trackId, requestedHeight, fittedHeights = {}) {
		if (editingBlocked()) return null;
		const selectedTrack = findTrack(project, trackId);
		if (!selectedTrack) throw new Error(copy.trackNotFound);
		const commands = project.tracks
			.map((track) => {
				const value = track.id === trackId ? requestedHeight : fittedHeights[track.id];
				const height = Math.max(40, Math.round(Number(value) || track.height || 114));
				return height === track.height ? null : {
					type: 'track/update',
					trackId: track.id,
					changes: { height },
				};
			})
			.filter(Boolean);
		state.autoFitTrackHeight = false;
		if (commands.length) commit({ type: 'batch', commands }, { selectTrackId: trackId });
		else publishProjectState();
		return selectedTrack.id;
	}

	function normalizeExportSettings(value = {}) {
		const formats = ['wav', 'aiff', 'flac', 'mp3', 'ogg-vorbis', 'opus', 'wavpack', 'mp2', 'aac-m4a', 'custom-ffmpeg'];
		const format = formats.includes(value.format) ? value.format : 'wav';
		const defaultBitRate = format === 'opus' ? 160 : format === 'mp2' ? 256 : 192;
		const bitDepth = [16, 24, 32].includes(Number(value.bitDepth)) ? Number(value.bitDepth) : 24;
		return {
			mode: value.mode === 'stems' ? 'stems' : 'mix',
			range: ['selection', 'loop'].includes(value.range) ? value.range : 'project',
			format,
			bitDepth,
			sampleFormat: value.sampleFormat || (bitDepth === 32 ? 'float32' : `int${bitDepth}`),
			dither: value.dither ?? (bitDepth < 32 ? 'triangular' : 'none'),
			bitRate: ['mp3', 'opus', 'mp2', 'aac-m4a'].includes(format) ? Number(value.bitRate) || defaultBitRate : undefined,
			quality: format === 'ogg-vorbis' ? Number.isFinite(Number(value.quality)) ? Number(value.quality) : 5 : undefined,
			compressionLevel: ['flac', 'wavpack'].includes(format)
				? Number.isFinite(Number(value.compressionLevel)) ? Number(value.compressionLevel) : format === 'flac' ? 5 : 2
				: undefined,
			sampleRate: value.sampleRate == null || value.sampleRate === '' ? projectSampleRate() : Number(value.sampleRate),
			channelMapping: value.channelMapping || 'preserve',
			metadata: value.metadata || project.metadata?.tags || {},
			extension: value.extension,
			mimeType: value.mimeType,
			customArguments: value.customArguments,
			includeTail: value.includeTail !== false,
		};
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
		publishTelemetrySnapshot();
	}

	function showAnalysis(result, visuals = null, report = null) {
		state.analysisResult = result || null;
		state.analysisVisuals = visuals;
		state.analysisReport = report;
		publishDocumentSnapshot();
	}

	function createAnalysisVisuals(channels, sampleRate) {
		const length = channels[0]?.length || 0;
		const spectrumFrames = Math.min(length, 16_384);
		const spectrumStart = Math.max(0, Math.floor((length - spectrumFrames) / 2));
		const spectrum = mixToMono(channels.map((channel) => channel.subarray(spectrumStart, spectrumStart + spectrumFrames)));
		const step = Math.max(1, Math.ceil(length / 131_072));
		const overview = new Float32Array(Math.ceil(length / step));
		for (let index = 0; index < overview.length; index += 1) {
			const frame = Math.min(length - 1, index * step);
			for (const channel of channels) overview[index] += (channel[frame] || 0) / channels.length;
		}
		return Object.freeze({
			spectrum: Object.freeze({ samples: spectrum, sampleRate, startFrame: spectrumStart }),
			overview: Object.freeze({ samples: overview, sampleRate: sampleRate / step, step }),
		});
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

	async function refreshStorageUsage() {
		const estimate = await store.estimateStorage();
		state.storageEstimate = { usage: estimate.usage ?? null, quota: estimate.quota ?? null };
		publishDocumentSnapshot();
	}

	async function preflightStorage(requiredBytes, operation) {
		const estimate = await store.estimateStorage();
		if (!Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) return;
		const available = Math.max(0, estimate.quota - estimate.usage);
		const required = Math.max(0, Number(requiredBytes) || 0);
		if (available < required * 1.1) {
			const label = operation === 'recording'
				? copy.storageOperationRecording
				: operation === 'export'
					? copy.storageOperationExport
					: operation === 'effect'
						? copy.storageOperationEffect
						: copy.storageOperationImport;
			throw new Error(copy.insufficientStorage
				.replace('{operation}', label)
				.replace('{required}', formatBytes(required)));
		}
	}

	function activeSelection() {
		const selection = project?.selection;
		return selection && selection.endFrame > selection.startFrame ? selection : null;
	}
}

function normalizeNyquistRole(value) {
	const role = String(value || 'prompt').trim().toLowerCase();
	if (role === 'process' || role === 'effect') return 'process';
	if (role === 'generate' || role === 'generator') return 'generate';
	if (role === 'analyze' || role === 'analyzer' || role === 'tool analyze' || role === 'tool-analyze') return 'analyze';
	return 'prompt';
}

function nyquistAudioResultBytes(result) {
	if (result?.type !== 'audio' || !Array.isArray(result.channels)) return 0;
	return result.channels.reduce((sum, channel) => sum + (channel?.byteLength || 0), 0);
}

function mixNyquistPreviewChannels(channelSets, maximumFrames) {
	if (!Array.isArray(channelSets) || !channelSets.length) return [];
	const frameLimit = Math.max(0, Math.round(Number(maximumFrames) || 0));
	if (!frameLimit) return [];
	for (const channels of channelSets) assertAudacityEffectOutput(channels);
	const channelCount = Math.max(...channelSets.map((channels) => channels.length));
	const frameCount = Math.min(
		frameLimit,
		Math.max(...channelSets.map((channels) => channels[0]?.length || 0)),
	);
	if (!frameCount) return [];
	const mixed = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
	for (const channels of channelSets) {
		for (let outputChannel = 0; outputChannel < channelCount; outputChannel += 1) {
			const input = channels.length === 1 ? channels[0] : channels[outputChannel];
			if (!input) continue;
			const frames = Math.min(frameCount, input.length);
			for (let frame = 0; frame < frames; frame += 1) mixed[outputChannel][frame] += input[frame];
		}
	}
	return mixed;
}

function nyquistMaximumOutputFrames({ sampleRate, inputFrames, preview, requested }) {
	const hardMaximum = Math.max(1, Math.round(sampleRate * (preview ? 6 : 300)));
	const inferred = preview
		? hardMaximum
		: Math.max(Math.round(sampleRate * 60), Math.max(0, inputFrames) * 4);
	const value = requested == null ? inferred : Number(requested);
	if (!Number.isSafeInteger(Math.round(value)) || value <= 0) throw new RangeError('Nyquist maxOutputFrames must be positive.');
	return Math.min(hardMaximum, Math.round(value));
}

function nyquistChannelStats(channels) {
	const channelStats = (channels || []).map((channel) => {
		let peak = 0;
		let squareSum = 0;
		for (let index = 0; index < channel.length; index += 1) {
			const value = Number(channel[index]) || 0;
			peak = Math.max(peak, Math.abs(value));
			squareSum += value * value;
		}
		return { peak, rms: channel.length ? Math.sqrt(squareSum / channel.length) : 0 };
	});
	if (!channelStats.length) return { peak: 0, rms: 0 };
	if (channelStats.length === 1) return channelStats[0];
	return {
		peak: channelStats.map(({ peak }) => peak),
		rms: channelStats.map(({ rms }) => rms),
	};
}

function freezeNyquistResult(evaluations, options = {}) {
	const results = Object.freeze(evaluations.map(({ result }) => (
		options.summarizeAudio && result?.type === 'audio'
			? Object.freeze({
				type: 'audio',
				sampleRate: result.sampleRate,
				frameCount: result.frameCount ?? result.channels?.[0]?.length ?? 0,
				channelCount: result.channels?.length || 0,
				output: result.output || '',
			})
			: result
	)));
	return results.length === 1
		? results[0]
		: Object.freeze({ type: 'multiple', results });
}

function nyquistResultStatus(evaluations, copy) {
	for (let index = evaluations.length - 1; index >= 0; index -= 1) {
		const result = evaluations[index]?.result;
		if (result?.type === 'message' && result.message) return result.message;
		if (result?.type === 'number') return String(result.value);
		if (result?.output) return result.output;
	}
	return copy.nyquistNoOutput || copy.done;
}

function cloneAudacityWorkerPayload(payload, transfer) {
	const cloneChannels = (channels) => (channels || []).map((channel) => {
		const copy = Float32Array.from(channel);
		transfer.push(copy.buffer);
		return copy;
	});
	const message = {
		...payload,
		channels: cloneChannels(payload.channels),
		params: structuredClone(payload.params || {}),
	};
	if (payload.context) {
		message.context = { ...payload.context };
		for (const key of ['controlChannels', 'beforeChannels', 'afterChannels']) {
			if (Array.isArray(payload.context[key])) message.context[key] = cloneChannels(payload.context[key]);
		}
	}
	return message;
}

function audacityEffectMemoryError(copy) {
	return new Error(copy.effectMemoryTooLarge);
}

async function writeBuffer(writer, buffer, signal = null) {
	for (let start = 0; start < buffer.length; start += SOURCE_CHUNK_FRAMES) {
		throwIfAborted(signal);
		const end = Math.min(buffer.length, start + SOURCE_CHUNK_FRAMES);
		await writer.write(Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel).slice(start, end)));
	}
	throwIfAborted(signal);
}

function createCoalescingSourceWriter(writer) {
	if (!writer || typeof writer.write !== 'function' || typeof writer.commit !== 'function' || typeof writer.abort !== 'function') {
		throw new TypeError('A writable PCM source is required.');
	}
	const coalescer = createPlanarPcmChunkCoalescer({
		chunkFrames: SOURCE_CHUNK_FRAMES,
		onChunk: (channels) => writer.write(channels),
	});
	let commitPromise = null;
	return Object.freeze({
		get framesWritten() {
			const storedFrames = Number(writer.framesWritten);
			return Math.max(coalescer.framesWritten, Number.isSafeInteger(storedFrames) ? storedFrames : 0);
		},
		get channelCount() {
			return coalescer.channelCount;
		},
		write(channels) {
			return coalescer.write(channels);
		},
		commit(metadata = {}) {
			commitPromise ||= coalescer.finalize()
				.then(() => writer.commit({ ...metadata, chunkFrames: SOURCE_CHUNK_FRAMES }));
			return commitPromise;
		},
		abort(reason) {
			coalescer.abort(reason);
			return writer.abort();
		},
	});
}

async function readStoredAudioBuffer(store, source, context) {
	if (!context?.createBuffer) return null;
	return store.loadSourceAudioBuffer(source.storageKey || source.id, context);
}

function sourceAudioBufferBytes(buffer) {
	const length = Number(buffer?.length);
	const channelCount = Number(buffer?.numberOfChannels);
	if (!Number.isSafeInteger(length) || length < 0 || !Number.isSafeInteger(channelCount) || channelCount < 0) return Infinity;
	const bytes = length * channelCount * Float32Array.BYTES_PER_ELEMENT;
	return Number.isSafeInteger(bytes) ? bytes : Infinity;
}

function sourcePcmBytes(source) {
	const frameCount = Number(source?.frameCount);
	const channelCount = Number(source?.channelCount);
	if (!Number.isSafeInteger(frameCount) || frameCount < 0 || !Number.isSafeInteger(channelCount) || channelCount < 0) return Infinity;
	const bytes = frameCount * channelCount * Float32Array.BYTES_PER_ELEMENT;
	return Number.isSafeInteger(bytes) ? bytes : Infinity;
}

function normalizeByteLimit(value, fallback) {
	const limit = value == null ? fallback : Number(value);
	if (!Number.isSafeInteger(limit) || limit < 0) {
		throw new RangeError('A memory limit must be a non-negative safe integer byte count.');
	}
	return limit;
}

function isStreamableStoredSource(source, metadata) {
	if (!metadata || typeof metadata !== 'object') return false;
	if (typeof metadata.id !== 'string' || typeof source?.id !== 'string') return false;
	if (!Number.isSafeInteger(source.frameCount) || !Number.isSafeInteger(source.channelCount)) return false;
	const chunkFrames = Object.hasOwn(metadata, 'chunkFrames') ? metadata.chunkFrames : source.chunkFrames;
	if (!Number.isSafeInteger(chunkFrames) || chunkFrames <= 0 || chunkFrames > SOURCE_CHUNK_FRAMES) return false;
	if ((metadata.frameCount ?? metadata.frameLength) !== source.frameCount || metadata.channelCount !== source.channelCount) return false;
	if (metadata.sampleRate != null && metadata.sampleRate !== source.sampleRate) return false;
	return metadata.chunkCount === Math.ceil(source.frameCount / chunkFrames);
}

function createStoredChunkProvider(store, source, metadata) {
	if (typeof store.readSourceChunk !== 'function') throw new TypeError('The project store cannot demand-load source chunks.');
	const sourceId = source.storageKey || source.id;
	return Object.freeze({
		channelCount: source.channelCount,
		frameCount: source.frameCount,
		chunkFrames: Object.hasOwn(metadata, 'chunkFrames') ? metadata.chunkFrames : source.chunkFrames,
		sampleRate: source.sampleRate,
		readStorageChunk(chunkIndex, context = {}) {
			return store.readSourceChunk(sourceId, chunkIndex, context);
		},
	});
}

async function generateStoredWaveformPeaks(store, source, copy) {
	if (typeof Worker !== 'function') return generateStoredWaveformPeaksFallback(store, source);
	const worker = new Worker(new URL('./peaks-worker.js', import.meta.url), { type: 'module' });
	try {
		worker.postMessage({ type: 'start', channelCount: source.channelCount });
		await waitForAnalysisWorker(worker, 'ready', copy);
		for await (const chunk of store.readSourceChunks(source.storageKey || source.id)) {
			const channels = chunk.channels.map((channel) => channel.slice());
			worker.postMessage({ type: 'chunk', channels: channels.map((channel) => channel.buffer) }, channels.map((channel) => channel.buffer));
			await waitForAnalysisWorker(worker, 'ack', copy);
		}
		worker.postMessage({ type: 'finish' });
		const message = await waitForAnalysisWorker(worker, 'result', copy);
		return { version: 2, levels: message.levels };
	} finally {
		worker.terminate();
	}
}

async function generateStoredWaveformPeaksFallback(store, source) {
	const blockSizes = [64, 256, 1_024, 4_096, 16_384, 65_536];
	const levels = blockSizes.map((blockSize) => ({
		blockSize,
		minimums: new Float32Array(Math.ceil(source.frameCount / blockSize)).fill(1),
		maximums: new Float32Array(Math.ceil(source.frameCount / blockSize)).fill(-1),
		squareSums: new Float64Array(Math.ceil(source.frameCount / blockSize)),
		counts: new Uint32Array(Math.ceil(source.frameCount / blockSize)),
	}));
	let frameOffset = 0;
	for await (const chunk of store.readSourceChunks(source.storageKey || source.id)) {
		for (let frame = 0; frame < chunk.frames; frame += 1) {
			let sample = 0;
			for (const channel of chunk.channels) sample += channel[frame] / chunk.channels.length;
			const absoluteFrame = frameOffset + frame;
			for (const level of levels) {
				const block = Math.floor(absoluteFrame / level.blockSize);
				level.minimums[block] = Math.min(level.minimums[block], sample);
				level.maximums[block] = Math.max(level.maximums[block], sample);
				level.squareSums[block] += sample * sample;
				level.counts[block] += 1;
			}
		}
		frameOffset += chunk.frames;
	}
	if (frameOffset !== source.frameCount) throw new Error('The stored audio source frame count does not match its metadata.');
	return {
		version: 2,
		levels: levels.map(({ blockSize, minimums, maximums, squareSums, counts }) => ({
			blockSize,
			minimums,
			maximums,
			rms: Float32Array.from(squareSums, (squareSum, block) => (
				counts[block] ? Math.sqrt(squareSum / counts[block]) : 0
			)),
		})),
	};
}

async function canonicalizeBuffer(input, context, targetSampleRate = AUDIO_EDITOR_SAMPLE_RATE, copy) {
	if (!input?.numberOfChannels || !input?.length) throw new Error(copy.decodedAudioEmpty);
	let channels;
	if (input.numberOfChannels <= 2) {
		channels = Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel));
	} else {
		const left = new Float32Array(input.length);
		const right = new Float32Array(input.length);
		const sourceChannels = Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel));
		const normalization = 1 + Math.max(0, input.numberOfChannels - 2) * 0.5;
		for (let frame = 0; frame < input.length; frame += 1) {
			left[frame] = sourceChannels[0][frame];
			right[frame] = sourceChannels[1]?.[frame] ?? sourceChannels[0][frame];
			for (let channel = 2; channel < sourceChannels.length; channel += 1) {
				if (channel % 2 === 0) left[frame] += sourceChannels[channel][frame] * 0.5;
				else right[frame] += sourceChannels[channel][frame] * 0.5;
			}
			left[frame] /= normalization;
			right[frame] /= normalization;
		}
		channels = [left, right];
	}
	if ((targetSampleRate == null || input.sampleRate === targetSampleRate) && input.numberOfChannels <= 2) return input;
	const downmixed = await bufferFromChannels(channels, input.sampleRate, context, copy);
	return targetSampleRate == null || input.sampleRate === targetSampleRate
		? downmixed
		: resampleBuffer(downmixed, targetSampleRate, context, copy);
}

async function bufferFromChannels(channels, sampleRate, context, copy) {
	if (!channels?.length || !channels[0]?.length) throw new Error(copy.decodedAudioEmpty);
	const buffer = await createAudioBuffer(channels.length, channels[0].length, sampleRate, context, copy);
	for (let channel = 0; channel < channels.length; channel += 1) {
		if (channels[channel].length !== channels[0].length) throw new Error(copy.decodedChannelLengthsMismatch);
		if (buffer.copyToChannel) buffer.copyToChannel(channels[channel], channel);
		else buffer.getChannelData(channel).set(channels[channel]);
	}
	return buffer;
}

async function bufferFromAup3Channels(channels, sampleRate, context, copy) {
	const outputLength = Math.max(1, Math.round(channels[0].length * AUDIO_EDITOR_SAMPLE_RATE / sampleRate));
	if (outputLength * channels.length * Float32Array.BYTES_PER_ELEMENT > 384 * 1024 * 1024) {
		throw new Error(copy.audacityProjectTooLong);
	}
	if (sampleRate >= 8000 && sampleRate <= 96000) return bufferFromChannels(channels, sampleRate, context, copy);
	const resampled = resampleChannelsWindowedSinc(channels, sampleRate, AUDIO_EDITOR_SAMPLE_RATE, outputLength);
	return bufferFromChannels(resampled, AUDIO_EDITOR_SAMPLE_RATE, context, copy);
}

async function resampleBuffer(input, sampleRate, context, copy) {
	if (input.sampleRate === sampleRate) return input;
	const length = Math.max(1, Math.round(input.length * sampleRate / input.sampleRate));
	const sourceChannels = Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel));
	const channels = resampleChannelsWindowedSinc(sourceChannels, input.sampleRate, sampleRate, length);
	return bufferFromChannels(channels, sampleRate, context, copy);
}

function resampleChannelsWindowedSinc(channels, inputSampleRate, outputSampleRate, outputFrames) {
	const resampler = createStreamingWindowedSincResampler(inputSampleRate, outputSampleRate, channels.length);
	const head = resampler.push(channels);
	const tail = resampler.finish(outputFrames);
	return head.map((values, channel) => {
		const output = new Float32Array(values.length + tail[channel].length);
		output.set(values);
		output.set(tail[channel], values.length);
		return output.length === outputFrames ? output : output.slice(0, outputFrames);
	});
}

async function createAudioBuffer(channelCount, length, sampleRate, context, copy) {
	if (context?.createBuffer) return context.createBuffer(channelCount, length, sampleRate);
	if (typeof globalThis.AudioBuffer === 'function') return new globalThis.AudioBuffer({ numberOfChannels: channelCount, length, sampleRate });
	const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
	if (!Context) throw new Error(copy.audioBufferUnsupported);
	const temporary = new Context({ sampleRate });
	const buffer = temporary.createBuffer(channelCount, length, sampleRate);
	await temporary.close?.();
	return buffer;
}
function audioBufferChannels(buffer) { return Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)); }
function scaleClipEnvelope(clip, durationFrames) {
	const ratio = durationFrames / Math.max(1, clip.durationFrames);
	return (clip.envelope || []).map((point) => ({
		...point,
		frame: Math.max(0, Math.min(durationFrames, Math.round(point.frame * ratio))),
	})).filter((point, index, points) => index === 0 || point.frame > points[index - 1].frame);
}
function serializeAudacityNoiseProfile(profile) {
	if (!profile) return null;
	return {
		...profile,
		meanPowers: Array.from(profile.meanPowers || []),
	};
}
async function analyzeChannelsInWorker(channels, sampleRate, copy, chunkFrames = 65_536) {
	if (typeof Worker !== 'function') return analyzeAudioChannels(channels, sampleRate);
	const worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
	try {
		worker.postMessage({ type: 'start', options: { sampleRate, channelCount: channels.length, truePeakOversample: 4 } });
		await waitForAnalysisWorker(worker, 'ready', copy);
		const frameCount = channels[0]?.length || 0;
		for (let offset = 0; offset < frameCount; offset += chunkFrames) {
			const chunks = channels.map((channel) => channel.slice(offset, Math.min(frameCount, offset + chunkFrames)));
			worker.postMessage({ type: 'chunk', channels: chunks.map((chunk) => chunk.buffer) }, chunks.map((chunk) => chunk.buffer));
			await waitForAnalysisWorker(worker, 'ack', copy);
		}
		worker.postMessage({ type: 'finish' });
		return (await waitForAnalysisWorker(worker, 'result', copy)).result;
	} finally {
		worker.terminate();
	}
}
async function generateWaveformPeaks(channels, copy, chunkFrames = 65_536) {
	if (typeof Worker !== 'function') return generateWaveformPeaksFallback(channels);
	const worker = new Worker(new URL('./peaks-worker.js', import.meta.url), { type: 'module' });
	try {
		worker.postMessage({ type: 'start', channelCount: channels.length });
		await waitForAnalysisWorker(worker, 'ready', copy);
		const frameCount = channels[0]?.length || 0;
		for (let offset = 0; offset < frameCount; offset += chunkFrames) {
			const chunks = channels.map((channel) => channel.slice(offset, Math.min(frameCount, offset + chunkFrames)));
			worker.postMessage({ type: 'chunk', channels: chunks.map((chunk) => chunk.buffer) }, chunks.map((chunk) => chunk.buffer));
			await waitForAnalysisWorker(worker, 'ack', copy);
		}
		worker.postMessage({ type: 'finish' });
		const message = await waitForAnalysisWorker(worker, 'result', copy);
		return { version: 2, levels: message.levels };
	} finally {
		worker.terminate();
	}
}
function generateWaveformPeaksFallback(channels) {
	const blockSizes = [64, 256, 1_024, 4_096, 16_384, 65_536];
	return {
		version: 2,
		levels: blockSizes.map((blockSize) => {
			const count = Math.ceil((channels[0]?.length || 0) / blockSize);
			const minimums = new Float32Array(count);
			const maximums = new Float32Array(count);
			const rms = new Float32Array(count);
			for (let block = 0; block < count; block += 1) {
				let minimum = 1;
				let maximum = -1;
				let squareSum = 0;
				let sampleCount = 0;
				for (let frame = block * blockSize; frame < Math.min(channels[0].length, (block + 1) * blockSize); frame += 1) {
					let sample = 0;
					for (const channel of channels) sample += channel[frame] / channels.length;
					minimum = Math.min(minimum, sample);
					maximum = Math.max(maximum, sample);
					squareSum += sample * sample;
					sampleCount += 1;
				}
				minimums[block] = minimum;
				maximums[block] = maximum;
				rms[block] = sampleCount ? Math.sqrt(squareSum / sampleCount) : 0;
			}
			return { blockSize, minimums, maximums, rms };
		}),
	};
}
function waveformPeaksHaveRms(peaks) {
	return Boolean(peaks?.levels?.length && peaks.levels.every((level) => (
		level?.rms?.length === level?.minimums?.length
	)));
}
function peakCacheKey(sourceId) { return `audio-editor-peaks-v1:${sourceId}`; }
function waitForAnalysisWorker(worker, expectedType, copy) {
	return new Promise((resolve, reject) => {
		worker.onmessage = ({ data = {} }) => {
			if (data.type === 'error') reject(new Error(data.message || copy.audioAnalysisFailed));
			else if (data.type === expectedType) resolve(data);
		};
		worker.onerror = (event) => reject(event.error || new Error(event.message || copy.audioAnalysisWorkerFailed));
	});
}
function mixToMono(channels) {
	const length = channels[0]?.length || 0;
	const mono = new Float32Array(length);
	for (const channel of channels) for (let index = 0; index < length; index += 1) mono[index] += channel[index] / channels.length;
	return mono;
}
async function createTemporaryFileSink(name, copy) {
	let directory = null;
	let handle = null;
	let writable = null;
	const chunks = [];
	let queue = Promise.resolve();
	let closed = false;
	try {
		const root = await globalThis.navigator?.storage?.getDirectory?.();
		directory = await root?.getDirectoryHandle?.('audio-editor-exports', { create: true });
		handle = await directory?.getFileHandle?.(name, { create: true });
		writable = await handle?.createWritable?.();
	} catch {
		directory = null;
		handle = null;
		writable = null;
	}
	return {
		persistent: Boolean(writable),
		write(chunk) {
			if (closed) throw new Error(copy.temporaryExportClosed);
			const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
			if (writable) queue = queue.then(() => writable.write(bytes));
			else chunks.push(bytes);
			return queue;
		},
		async close(mimeType) {
			if (closed) throw new Error(copy.temporaryExportClosed);
			closed = true;
			await queue;
			if (writable) {
				await writable.close();
				return handle.getFile();
			}
			return new Blob(chunks, { type: mimeType });
		},
		async remove() {
			if (directory && handle) {
				try { await directory.removeEntry(name); } catch { /* Already removed. */ }
			}
		},
		async abort() {
			closed = true;
			try { await writable?.abort?.(); } catch { /* The writer may already be closed. */ }
			if (directory && handle) {
				try { await directory.removeEntry(name); } catch { /* Already removed. */ }
			}
		},
	};
}

async function createStreamingZipArchive(name, estimatedInputBytes = 0, copy) {
	const sink = await createTemporaryFileSink(name, copy);
	if (!sink.persistent && estimatedInputBytes > 96 * 1024 ** 2) {
		await sink.abort();
		throw new Error(copy.largeStemsStorageRequired);
	}
	const { Zip, ZipPassThrough } = await import('fflate');
	let writeQueue = Promise.resolve();
	let closed = false;
	let failed = null;
	let resolveFinished;
	let rejectFinished;
	const finished = new Promise((resolve, reject) => {
		resolveFinished = resolve;
		rejectFinished = reject;
	});
	const zip = new Zip((error, chunk, final) => {
		if (error) {
			failed = error;
			rejectFinished(error);
			return;
		}
		if (chunk?.length) writeQueue = writeQueue.then(() => sink.write(chunk));
		if (final) {
			writeQueue
				.then(() => sink.close('application/zip'))
				.then((blob) => resolveFinished({ blob, cleanup: () => sink.remove() }), rejectFinished);
		}
	});

	return {
		async add(fileName, input, signal) {
			if (closed || failed) throw failed || new Error(copy.stemArchiveClosed);
			throwIfAborted(signal);
			const entry = new ZipPassThrough(fileName);
			zip.add(entry);
			if (input instanceof Blob) {
				const reader = input.stream().getReader();
				try {
					while (true) {
						throwIfAborted(signal);
						const { done, value } = await reader.read();
						if (done) break;
						entry.push(value instanceof Uint8Array ? value : new Uint8Array(value), false);
					}
				} finally {
					reader.releaseLock();
				}
			} else {
				const bytes = input instanceof Uint8Array
					? input
					: ArrayBuffer.isView(input)
						? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
						: new Uint8Array(input || 0);
				if (bytes.length) entry.push(bytes, false);
			}
			entry.push(new Uint8Array(0), true);
			await writeQueue;
		},
		async finish() {
			if (closed) return finished;
			closed = true;
			zip.end();
			return finished;
		},
		async abort() {
			const wasClosed = closed;
			closed = true;
			if (!wasClosed) try { zip.terminate?.(); } catch { /* The stream may already be complete. */ }
			await sink.abort();
		},
	};
}

function stemProject(project, trackId) {
	const snapshot = cloneProject(project);
	snapshot.tracks = snapshot.tracks.map((track) => track.id === trackId
		? { ...track, mute: false, solo: false }
		: { ...track, mute: true, solo: false, effects: [] });
	snapshot.master = { gain: 1, effects: [] };
	return snapshot;
}

function classifyMobile() {
	if (globalThis.navigator?.userAgentData?.mobile != null) return Boolean(globalThis.navigator.userAgentData.mobile);
	return Boolean(globalThis.navigator?.maxTouchPoints > 0 && globalThis.matchMedia?.('(pointer: coarse)').matches && Math.min(globalThis.innerWidth || 9999, globalThis.innerHeight || 9999) < 900);
}

function normalizeLatencyOffset(value) {
	return Math.max(-500, Math.min(500, Number(value) || 0));
}

function normalizeTimedRecordingStart(value) {
	const timestamp = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : new Date(value).getTime();
	if (!Number.isFinite(timestamp)) throw new TypeError('A valid timer recording start time is required.');
	return Math.round(timestamp);
}

function scaleRecordingFrames(frameCount, inputSampleRate, outputSampleRate) {
	const frames = Math.max(0, Math.floor(Number(frameCount) || 0));
	const inputRate = Math.max(1, Math.floor(Number(inputSampleRate) || AUDIO_EDITOR_SAMPLE_RATE));
	const outputRate = Math.max(1, Math.floor(Number(outputSampleRate) || AUDIO_EDITOR_SAMPLE_RATE));
	return Math.max(0, Math.round(frames * outputRate / inputRate));
}

function normalizeAudioDevicePreferences(value) {
	const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	return Object.freeze({
		inputDeviceId: normalizePreferredInputDeviceId(source.inputDeviceId),
		inputChannelCount: Number(source.inputChannelCount) === 2 ? 2 : 1,
		outputDeviceId: normalizePreferredOutputDeviceId(source.outputDeviceId),
	});
}

function normalizePreferredInputDeviceId(deviceId) {
	if (deviceId == null || deviceId === '') return RECORDING_DEFAULT_DEVICE_ID;
	if (typeof deviceId !== 'string') return RECORDING_DEFAULT_DEVICE_ID;
	return deviceId.trim() || RECORDING_DEFAULT_DEVICE_ID;
}

function normalizePreferredOutputDeviceId(deviceId) {
	if (deviceId == null || deviceId === 'default') return '';
	if (typeof deviceId !== 'string') return '';
	return deviceId.trim();
}

function streamAudioChannelCount(stream) {
	let channelCount = 1;
	for (const track of stream?.getAudioTracks?.() || []) {
		channelCount = Math.max(channelCount, Math.max(1, Math.min(RECORDING_CHANNEL_COUNT_MAXIMUM, Number(track.getSettings?.().channelCount) || 1)));
	}
	return channelCount;
}

function recordingStreamIsLive(stream, kind) {
	const audioLive = stream?.getAudioTracks?.().some((track) => track?.readyState !== 'ended');
	if (!audioLive) return false;
	return kind !== 'display' || stream?.getVideoTracks?.().some((track) => track?.readyState !== 'ended');
}

function createRecordingPreview({ trackId, startFrame, channelCount, framesToSkip = 0 }) {
	const channels = Math.max(1, Math.min(2, Number(channelCount) || 1));
	return {
		trackId,
		startFrame: Math.max(0, Math.floor(Number(startFrame) || 0)),
		framesToSkip: Math.max(0, Math.floor(Number(framesToSkip) || 0)),
		frames: 0,
		framesPerBucket: LIVE_RECORDING_WAVEFORM_BUCKET_FRAMES,
		bucketFrames: 0,
		minimums: Array.from({ length: channels }, () => 1),
		maximums: Array.from({ length: channels }, () => -1),
		buckets: Array.from({ length: channels }, () => []),
	};
}

function appendRecordingPreview(preview, channels) {
	if (!preview || !Array.isArray(channels) || !channels[0]?.length) return;
	const frameCount = Math.max(0, ...channels.map((channel) => channel?.length || 0));
	for (let frame = 0; frame < frameCount; frame += 1) {
		if (preview.framesToSkip > 0) {
			preview.framesToSkip -= 1;
			continue;
		}
		for (let channel = 0; channel < preview.buckets.length; channel += 1) {
			const value = Number(channels[channel]?.[frame]) || 0;
			preview.minimums[channel] = Math.min(preview.minimums[channel], value);
			preview.maximums[channel] = Math.max(preview.maximums[channel], value);
		}
		preview.frames += 1;
		preview.bucketFrames += 1;
		if (preview.bucketFrames < preview.framesPerBucket) continue;
		for (let channel = 0; channel < preview.buckets.length; channel += 1) {
			preview.buckets[channel].push(preview.minimums[channel], preview.maximums[channel]);
			preview.minimums[channel] = 1;
			preview.maximums[channel] = -1;
		}
		preview.bucketFrames = 0;
		compactRecordingPreview(preview);
	}
}

function compactRecordingPreview(preview) {
	const bucketCount = Math.floor(preview.buckets[0]?.length / 2) || 0;
	if (bucketCount < LIVE_RECORDING_WAVEFORM_MAXIMUM_BUCKETS) return;
	for (const channel of preview.buckets) {
		const compacted = [];
		for (let bucket = 0; bucket < channel.length; bucket += 4) {
			if (bucket + 3 >= channel.length) {
				compacted.push(channel[bucket], channel[bucket + 1]);
				continue;
			}
			compacted.push(
				Math.min(channel[bucket], channel[bucket + 2]),
				Math.max(channel[bucket + 1], channel[bucket + 3]),
			);
		}
		channel.splice(0, channel.length, ...compacted);
	}
	preview.framesPerBucket *= 2;
}

function recordingPreviewSnapshot(preview) {
	if (!preview || preview.frames <= 0) return null;
	const channels = preview.buckets.map((buckets, index) => {
		const output = new Float32Array(buckets.length + (preview.bucketFrames ? 2 : 0));
		output.set(buckets);
		if (preview.bucketFrames) {
			output[output.length - 2] = preview.minimums[index];
			output[output.length - 1] = preview.maximums[index];
		}
		return output;
	});
	return Object.freeze({
		trackId: preview.trackId,
		startFrame: preview.startFrame,
		durationFrames: preview.frames,
		channels: Object.freeze(channels),
	});
}

function normalizeProjectSampleRate(value) {
	const sampleRate = Number(value ?? AUDIO_EDITOR_SAMPLE_RATE);
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 384_000) return AUDIO_EDITOR_SAMPLE_RATE;
	return sampleRate;
}

function historyEntrySummary(entry) {
	const command = entry?.command || {};
	const commands = command.type === 'batch' && Array.isArray(command.commands) ? command.commands : null;
	return Object.freeze({
		type: String(command.type || 'edit'),
		commandCount: commands?.length || 1,
		commands: Object.freeze((commands || [command]).map((item) => String(item?.type || 'edit'))),
	});
}

function formatBytes(value) {
	if (!Number.isFinite(value)) return '—';
	const units = ['B', 'KB', 'MB', 'GB'];
	let size = value;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
	return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
function isAup3File(file) { return /\.aup3$/i.test(String(file?.name || '').trim()); }
function isLegacyAupFile(file) { return /\.aup$/i.test(String(file?.name || '').trim()); }
function isLegacyBlockFile(file) { return /\.au$/i.test(String(file?.name || '').trim()); }
function isWavFile(file) {
	const mimeType = String(file?.type || '').trim().toLowerCase();
	return /\.(?:wav|wave)$/i.test(String(file?.name || '').trim())
		|| ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'].includes(mimeType);
}
function formatAup3Warning(warning) {
	if (typeof warning === 'string') return warning.trim();
	if (warning?.message) return String(warning.message).trim();
	if (warning?.code) return String(warning.code).trim();
	return '';
}
function generatorName(type, copy) {
	return {
		silence: copy.silenceGenerator,
		tone: copy.toneGenerator,
		chirp: copy.chirpGenerator,
		noise: copy.noiseGenerator,
		dtmf: copy.dtmfGenerator,
	}[type] || type;
}
function stripExtension(name) { return String(name || '').replace(/\.[^.]+$/, ''); }
function labelMimeType(format) {
	if (format === 'vtt') return 'text/vtt;charset=utf-8';
	if (format === 'srt') return 'application/x-subrip;charset=utf-8';
	return 'text/plain;charset=utf-8';
}
function labelExportFileName(value, format) {
	const base = stripExtension(String(value || 'labels')).replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '-').trim() || 'labels';
	return `${base}.${format}`;
}
function ensureAup4FileName(value) {
	const base = String(value || 'audacity-project').replace(/[\\/:*?"<>|\u0000-\u001F]+/g, '-').trim() || 'audacity-project';
	return /\.aup4$/i.test(base) ? base : `${base}.aup4`;
}

function ensureScapeFileName(value) {
	const base = String(value || 'project').trim() || 'project';
	return /\.scape$/i.test(base) ? base : `${base}.scape`;
}
function normalizeAup4CompatibilityReport(report, direction) {
	const value = report && typeof report === 'object' ? structuredClone(report) : {};
	const items = Array.isArray(value.items) ? value.items : [];
	const suppliedCounts = value.counts && typeof value.counts === 'object' ? value.counts : {};
	const count = (disposition) => {
		const supplied = Number(suppliedCounts[disposition]);
		if (Number.isSafeInteger(supplied) && supplied >= 0) return supplied;
		return items.filter((item) => item?.disposition === disposition).length;
	};
	return Object.freeze({
		...value,
		schemaVersion: 1,
		format: 'aup4',
		direction: direction === 'open' ? 'open' : 'save',
		items: Object.freeze(items),
		counts: Object.freeze({
			preserved: count('preserved'),
			converted: count('converted'),
			missing: count('missing'),
			omitted: count('omitted'),
		}),
	});
}
function aup4ReportHasMissingPcm(report) {
	if (Array.isArray(report?.missingAudio) && report.missingAudio.length) return true;
	return (report?.items || []).some((item) => item?.code === 'MISSING_LOCAL_AUDIO');
}
async function saveLabelExport(result, customSaver, fileService) {
	const blob = new Blob([result.text], { type: result.mimeType });
	if (typeof customSaver === 'function') return customSaver({ ...result, blob });
	if (fileService?.saveFile) return fileService.saveFile({
		purpose: 'labels',
		suggestedName: result.fileName,
		mimeType: result.mimeType,
		blob,
	});
	if (!globalThis.document?.createElement || !globalThis.URL?.createObjectURL) return { ...result, blob };
	const url = URL.createObjectURL(blob);
	try {
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = result.fileName;
		anchor.hidden = true;
		document.body?.append(anchor);
		anchor.click();
		anchor.remove();
	} finally {
		URL.revokeObjectURL(url);
	}
	return { ...result, blob };
}
function abortError() { return typeof DOMException === 'function' ? new DOMException('Aborted', 'AbortError') : Object.assign(new Error('Aborted'), { name: 'AbortError' }); }
function throwIfAborted(signal) { if (signal?.aborted) throw abortError(); }
function formatPlaybackRate(rate) { return Number(rate).toFixed(2).replace(/\.00$/u, '').replace(/(\.\d)0$/u, '$1'); }
