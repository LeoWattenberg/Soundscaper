import {
	AUDIO_EDITOR_SAMPLE_RATE,
	AUDIO_EDITOR_DEFAULT_SHORTCUTS,
	applyAudioEditorWorkspace,
	applyAudioEditorEffectPreset,
	applyMediaChannelMapping,
	applySpectralGain,
	analyzeAudioChannels,
	audioTrackChannelCountV2,
	audioEffectLabel,
	audioEffectTypes,
	canEditAudioSamplesAtZoom,
	canRedo,
	canUndo,
	cloneProject,
	clipNeedsTimePitchRender,
	ClipTimePitchRenderCacheCoordinator,
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
	createAudioEditorProjectV2,
	convertStructuredAup3ToProjectV2,
	createClipboardDescriptor,
	createEditorHistory,
	createEffect,
	createExportPlan,
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
	findSource,
	findTrack,
	EDITOR_TIMELINE_MINIMUM_SECONDS,
	editorTimelineDurationFrames,
	isAudacityRackEffectType,
	loadAudioEditorPreferencesV1,
	loadStoredSourceChannels,
	migrateAudioEditorProject,
	generateAudioEditorSignal,
	normalizeAudioEditorShortcut,
	normalizeRecordingInputGain,
	RECORDING_INPUT_GAIN_DEFAULT,
	prepareCut,
	prepareGroupClipsCommand,
	prepareKeepRangeCommand,
	preparePasteCommand,
	preparePunchCommand,
	prepareRangeDeleteCommand,
	prepareRangeReplacementCommand,
	prepareOverwriteClipCommand,
	prepareSplitCommand,
	projectDurationFrames,
	projectEnvelope,
	parseAudioEditorLabels,
	persistImmutableSampleEdit,
	requestAup4FileHandle,
	saveAup4Result,
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
} from './index.js';
import {
	AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES,
	AUDACITY_EFFECT_DEFINITIONS,
	applyAudacityEffectAsync,
	assertAudacityEffectOutput,
	audacityEffectDefaults,
	audacityEffectLabel,
	audacityEffectTypes,
	captureAudacityNoiseProfile,
	estimateAudacityEffectOutputFrames,
	estimateAudacityEffectPeakBytes,
	normalizeAudacityEffectParams,
} from './audacity-effects/index.js';
import {
	audacitySelectionChannelCount,
	matchAudacitySelectionChannels,
} from './audacity-selection.js';
import {
	createAudioEditorEngine,
	effectRackLatencyFrames,
} from './engine.js';
import {
	RECORDING_CHANNEL_COUNT_MAXIMUM,
	createRecordingCapturePool,
	createRecordingController,
	requestDisplayInput,
	requestHardwareInput,
} from './recording.js';
import {
	RECORDING_DEFAULT_DEVICE_ID,
	normalizeRecordingRouting,
	recordingRouteSourceKey,
	recordingRoutingSettingKey,
	setRecordingSourceOffset,
	setRecordingTrackRoute,
} from './recording-routing.js';
import { createEditorFfmpeg } from './ffmpeg.js';
import { acquireProjectLock } from './project-lock.js';
import { createProjectStore } from './storage.js';
import { createWavStreamEncoder, encodeWav } from './wav.js';
import { decodeAup3File } from '../aup3-browser.js';
import { ENGLISH_COPY } from '../../../i18n/catalogs.js';
import { normalizeBcp47Locale } from '../../../i18n/locale.js';

const DEFAULT_PIXELS_PER_SECOND = 120;
const MAX_PIXELS_PER_SECOND = AUDIO_EDITOR_SAMPLE_RATE;
const MAX_TIMELINE_PIXELS = 16_000_000;
const SOURCE_CHUNK_FRAMES = 65_536;
const SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES = 32 * 1024 * 1024;
const LIVE_RECORDING_WAVEFORM_BUCKET_FRAMES = 64;
const LIVE_RECORDING_WAVEFORM_MAXIMUM_BUCKETS = 2_048;
const LIVE_RECORDING_WAVEFORM_PUBLISH_INTERVAL_MS = 80;

export function createAudioEditorController(_root = null, options = {}) {
	const copy = Object.freeze({ ...ENGLISH_COPY, ...(options.copy || {}) });
	const locale = normalizeBcp47Locale(options.locale);
	const documentListeners = new Set();
	const telemetryListeners = new Set();
	let documentSnapshot = null;
	let telemetrySnapshot = null;
	const store = options.store || createProjectStore();
	const sourceBuffers = new Map();
	const sourceChunkProviders = new Map();
	const sourcePeaks = new Map();
	const sessionController = options.sessionController || createAudioEditorSessionController();
	let aup4Client = null;
	let aup4Environment = null;
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
			if (buffer) return audioBufferChannels(buffer);
			return loadStoredSourceChannels(store, source, context);
		},
		onWarning: (warning) => setStatus(copy.staffPadRangeWarning.replace('{stageCount}', String(warning.stageCount))),
	});
	const clipTimePitchSourceResolver = clipTimePitchCache.createEngineSourceResolver();
	engine.setSourceResolver?.(clipTimePitchSourceResolver);
	const ffmpeg = options.ffmpeg || createEditorFfmpeg({
		onLoading: () => setStatus(copy.ffmpegLoading),
		onProgress: (progress) => updateExportProgress(progress),
	});
	const state = {
		history: null,
		preferences: createAudioEditorPreferencesV1(),
		preferencesReadOnly: false,
		selectedTrackId: null,
		selectedClipId: null,
		clipboard: null,
		effectClipboard: null,
		pixelsPerSecond: DEFAULT_PIXELS_PER_SECOND,
		mobile: classifyMobile(),
	timelineWidth: EDITOR_TIMELINE_MINIMUM_SECONDS * DEFAULT_PIXELS_PER_SECOND,
		timelineView: 'waveform',
		readOnly: false,
		projectLock: null,
		autosaveTimer: 0,
		sourceGcTimer: 0,
		saveGeneration: 0,
		pendingSaveSnapshots: new Set(),
		recorder: null,
		recordingWriter: null,
		recordingStream: null,
		recordingStarting: false,
		recordingStartGeneration: 0,
		recordingStartPromise: null,
		recordingPaused: false,
		recordingInputGain: RECORDING_INPUT_GAIN_DEFAULT,
		leadInRecording: false,
		importing: false,
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
		recordingReleaseAfterStop: false,
		recordingRouting: normalizeRecordingRouting(),
		recordingDevices: [],
		recordingEnumeratedDeviceIds: new Set(),
		recordingRouteHealth: {},
		recordingPoolSources: [],
		inputMeters: {},
		playbackCacheAbort: null,
		playbackCacheGeneration: 0,
		exportAbort: null,
		exportGeneration: 0,
		outputUrl: null,
		outputCleanup: null,
		projectQueue: Promise.resolve(),
		missingSourceIds: new Set(),
		audacityEffectType: audacityEffectTypes()[0],
		audacityEffectParams: {},
		audacityEffectTouchedParams: new Map(),
		effectPresets: createAudioEditorEffectPresets(),
		audacityControlTrackId: null,
		audacityNoiseProfile: null,
		audacityEffectProcessing: false,
		audacityPreviewSource: null,
		lastAudacityEffect: null,
		audacityEffectWorker: null,
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
		sampleEditProcessing: false,
		sampleEditAbort: null,
		exportProgress: 0,
		exportOutput: null,
		monitoring: false,
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
	let project = null;

	const ready = bootstrap()
		.then(() => {
			state.phase = 'ready';
			publishDocumentSnapshot();
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
		get headless() { return true; },
		getSnapshot,
		subscribe: (listener) => subscribeTo(documentListeners, listener),
		getTelemetrySnapshot,
		subscribeTelemetry: (listener) => subscribeTo(telemetryListeners, listener),
		getClipVisualData,
		actions,
		async dispose() {
			if (state.disposed) return;
			state.disposed = true;
			cancelRecordingStart();
			state.phase = 'disposed';
			publishDocumentSnapshot();
			globalThis.clearTimeout(state.autosaveTimer);
			globalThis.clearTimeout(state.sourceGcTimer);
			cancelPlaybackCachePreparation();
			state.sampleEditAbort?.abort();
			stopMetronome();
			state.audacityEffectWorker?.terminate();
			state.audacityEffectWorker = null;
			cancelAudacityEffectPreview({ publish: false });
			state.spectralWorker?.terminate();
			state.spectralWorker = null;
			await stopRecording().catch(() => undefined);
			await Promise.resolve(recordingCapturePool.dispose?.());
			state.projectLock?.release();
			state.projectLock = null;
			if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
			await state.outputCleanup?.();
			ffmpeg.dispose();
			aup4Client?.dispose();
			aup4Client = null;
			clipTimePitchCache.dispose?.();
			sessionController.dispose?.();
			await engine.dispose();
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
		const currentProject = state.history?.present ?? null;
		const selection = currentProject?.selection && currentProject.selection.endFrame > currentProject.selection.startFrame
			? currentProject.selection
			: null;
		return Object.freeze({
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
			readOnly: state.readOnly,
			importing: state.importing,
			recordingStarting: state.recordingStarting,
			recording: Boolean(state.recorder),
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
			storage: Object.freeze({ ...state.storageEstimate }),
			analysis: state.analysisResult,
			analysisVisuals: state.analysisVisuals,
			analysisReport: state.analysisReport,
			analysisProcessing: state.analysisProcessing,
			export: Object.freeze({ progress: state.exportProgress, output: state.exportOutput }),
			effects: Object.freeze({
				rackTypes: Object.freeze(audioEffectTypes().map((type) => Object.freeze({ type, label: audioEffectLabel(type, copy) }))),
				hasStackClipboard: state.effectClipboard !== null,
				selectionTypes: Object.freeze(audacityEffectTypes().map((type) => Object.freeze({ type, label: audacityEffectLabel(type, copy) }))),
				selectionType: state.audacityEffectType,
				selectionParams: currentAudacityEffectParams(),
				selectionDefinition: AUDACITY_EFFECT_DEFINITIONS[state.audacityEffectType] || null,
				controlTrackId: state.audacityControlTrackId,
				noiseProfileReady: Boolean(state.audacityNoiseProfile),
				canRepeatLast: Boolean(state.lastAudacityEffect),
				previewing: Boolean(state.audacityPreviewSource),
				presets: listAudioEditorEffectPresets(state.effectPresets, state.audacityEffectType),
			}),
			monitor: Object.freeze({ enabled: state.monitoring, latencyOffsetMs: state.latencyOffsetMs }),
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

	function buildTelemetrySnapshot() {
		return Object.freeze({
			positionFrame: state.positionFrame,
			durationFrames: state.durationFrames,
			transportState: state.transportState,
			recording: Boolean(state.recorder),
			meters: state.meters,
			inputMeterDb: state.inputMeterDb,
			inputMeters: Object.freeze({ ...state.inputMeters }),
			exportProgress: state.exportProgress,
		});
	}

	function getClipVisualData(clipId) {
		const clip = project ? findClip(project, clipId) : null;
		if (!clip) return null;
		return Object.freeze({
			clip,
			track: findClipTrack(project, clip.id),
			source: findSource(project, clip.sourceId),
			buffer: sourceBuffers.get(clip.sourceId) || null,
			peaks: sourcePeaks.get(clip.sourceId) || null,
		});
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
				saveAup4,
				saveAs: saveAup4,
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
				rename: (title) => renameProject(title),
				duplicate: (title) => duplicateProject(title),
				remove: deleteProject,
				clear: clearLocalData,
				importFiles,
				setTempo: (bpm) => commit({ type: 'tempo/set', bpm }),
				setTimeSignature: (numerator, denominator) => commit({ type: 'tempo/set', numerator, denominator }),
				setTimeDisplay: (format) => commit({ type: 'time-display/set', format }),
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
				silenceSelection: () => generateSelectionSilence(),
			}),
			transport: Object.freeze({
				playPause: () => handleTransport('play'),
				stop: () => handleTransport('stop'),
				seek: (frame) => engine.seek(normalizeTimelineFrame(frame)),
				jumpStart: () => handleTransport('jump-start'),
				jumpEnd: () => handleTransport('jump-end'),
				rewind: () => handleTransport('rewind'),
				forward: () => handleTransport('forward'),
				toggleLoop: () => handleTransport('loop'),
				clearLoop: clearLoopRegion,
				loopToSelection: setLoopRegionToSelection,
				selectionToLoop: setSelectionToLoopRegion,
				setLoopInOut: setLoopRegionInOut,
				toggleSelectionFollowsLoop: toggleSelectionFollowsLoop,
				toggleMetronome,
			}),
			recording: Object.freeze({
				start: startRecording,
				startNewTrack: startRecordingOnNewTrack,
				pause: toggleRecordingPause,
				stop: stopRecording,
				toggleLeadIn: toggleLeadInRecording,
				setMonitoring,
				setLevel: setRecordingInputGain,
				setLatencyOffset,
				requestInputAccess,
				refreshInputs: refreshRecordingInputs,
				setTrackInput: setRecordingTrackInput,
				clearTrackInput: (trackId) => setRecordingTrackInput(trackId, null),
				setSourceOffset: setRecordingSourceLatency,
				setRetainInputs,
				releaseInputs,
			}),
			timeline: Object.freeze({
				selectTrack,
				selectClip,
				setSelection,
				clearSelection: () => setSelection(0, 0, {
					trackIds: [],
					clipIds: [],
					frequencyRange: null,
				}),
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
				toggleRms: toggleRmsWaveform,
				toggleVerticalRulers,
				toggleUpdateWhilePlaying,
				togglePinnedPlayhead,
				toggleRulerPlayback,
				setZoom,
				zoomIn: () => updateZoom('in'),
				zoomOut: () => updateZoom('out'),
				zoomFit: (viewportWidth) => updateZoom('fit', viewportWidth),
				getClipVisualData,
				getVisibleClips,
			}),
			sampleEdit: Object.freeze({
				setMode: setSampleEditMode,
				pencil: applySamplePencil,
				smooth: smoothSelectedSamples,
				cancel: cancelSampleEdit,
			}),
			spectral: Object.freeze({
				boxSelect: setSpectralBoxSelection,
				delete: () => applySpectralSelection(-Infinity),
				amplify: (gainDb = 6) => applySpectralSelection(gainDb),
			}),
			track: Object.freeze({
				add: addTrack,
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
				makeStereo: makeStereoTrack,
				swapChannels: swapTrackChannels,
				splitStereoLR: (trackId = state.selectedTrackId) => splitStereoTrack(trackId, true),
				splitStereoCenter: (trackId = state.selectedTrackId) => splitStereoTrack(trackId, false),
				collapseAll: () => setAllTracksCollapsed(true),
				expandAll: () => setAllTracksCollapsed(false),
				setDisplayMode: setTrackDisplayMode,
				setRate: setTrackRate,
				setSampleFormat: setTrackSampleFormat,
				setWaveformView: (trackId = state.selectedTrackId) => setTrackDisplayMode(trackId, 'waveform'),
				setSpectrogramView: (trackId = state.selectedTrackId) => setTrackDisplayMode(trackId, 'spectrogram'),
				setMultiView: (trackId = state.selectedTrackId) => setTrackDisplayMode(trackId, 'multiview'),
				resample: resampleTrack,
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
				generate: generateSignal,
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
				setToolbarButton: setToolbarButtonPreference,
				togglePanel: togglePanelPreference,
				setPanel: setPanelPreference,
				setShortcut: setShortcutPreference,
				resetShortcuts: () => updatePreferences({ shortcuts: AUDIO_EDITOR_DEFAULT_SHORTCUTS }),
				createWorkspace: createWorkspacePreference,
				updateWorkspace: updateWorkspacePreference,
				deleteWorkspace: deleteWorkspacePreference,
			}),
			clip: Object.freeze({
				update: (clipId, changes) => commit({ type: 'clip/update', clipId, changes }, { selectClipId: clipId }),
				setTimePitch: setClipTimePitch,
				stretch: stretchClip,
				toggleStretchToTempo: (clipId = state.selectedClipId) => {
					const clip = clipId ? findClip(project, clipId) : null;
					if (!clip) throw new Error(copy.audioClipNotFound);
					return commit({
						type: 'clip/update',
						clipId: clip.id,
						changes: { stretchToTempo: !clip.stretchToTempo, renderCacheRevision: (clip.renderCacheRevision || 0) + 1 },
					}, { selectClipId: clip.id });
				},
				resetPitchSpeed: resetClipPitchSpeed,
				renderPitchSpeed: renderClipPitchSpeed,
				move: (clipId, trackId, timelineStartFrame) => commit({
					type: 'clip/move', clipId, trackId, timelineStartFrame: snapTimelineFrame(timelineStartFrame),
				}, { selectTrackId: trackId, selectClipId: clipId }),
				trim: (clipId, changes) => commit({ type: 'clip/trim', clipId, ...changes }, { selectClipId: clipId }),
				overwrite: (clipId, trackId, changes) => commit(
					prepareOverwriteClipCommand(project, clipId, { trackId, changes }),
					{ selectTrackId: trackId, selectClipId: clipId },
				),
				remove: (clipId) => commit({ type: 'clip/remove', clipId }),
				reverse: (clipId) => handleClipAction('reverse', clipId),
				normalizePeak: (clipId) => handleClipAction('normalize-peak', clipId),
				normalizeLoudness: (clipId) => handleClipAction('normalize-lufs', clipId),
			}),
			effects: Object.freeze({
				add: addEffect,
				update: (scope, trackId, effectId, changes) => commit({ type: 'effect/update', scope, trackId, busId: trackId, effectId, changes }),
				remove: (scope, trackId, effectId) => commit({ type: 'effect/remove', scope, trackId, busId: trackId, effectId }),
				reorder: (scope, trackId, effectId, toIndex) => commit({ type: 'effect/reorder', scope, trackId, busId: trackId, effectId, toIndex }),
				copyStack: copyEffectStack,
				pasteStack: pasteEffectStack,
				setMasterGain: (gain) => commit({ type: 'master/update', changes: { gain: Math.max(0, Math.min(4, Number(gain))) } }),
				setSelectionType: setAudacityEffectType,
				setSelectionParams: setAudacityEffectParamsFromController,
				setControlTrack: setAudacityControlTrack,
				captureNoiseProfile: captureSelectedNoiseProfile,
				captureRackNoiseProfile: captureRackNoiseProfileFromController,
				applySelection: applyAudacityEffectFromController,
				previewSelection: previewAudacityEffectFromController,
				cancelPreview: () => cancelAudacityEffectPreview(),
				repeatLast: repeatLastAudacityEffect,
				presets: Object.freeze({
					list: (effectType = state.audacityEffectType) => listAudioEditorEffectPresets(state.effectPresets, effectType),
					apply: applyEffectPreset,
					save: saveEffectPreset,
					saveAs: (name, params = currentAudacityEffectParams()) => saveEffectPreset({ name, params }),
					delete: deleteEffectPreset,
					import: importEffectPresets,
					export: exportEffectPreset,
				}),
			}),
			macros: Object.freeze({
				run: runEffectMacro,
			}),
			analysis: Object.freeze({
				run: runAnalysis,
				plotSpectrum: (scope = 'master') => runSpecializedAnalysis('spectrum', scope),
				findClipping: (scope = 'master', options) => runSpecializedAnalysis('clipping', scope, options),
				contrast: captureContrastSelection,
			}),
			export: Object.freeze({
				start: (settings) => handleExportAction('start', settings),
				cancel: () => handleExportAction('cancel'),
			}),
		});
	}

	async function loadPreferences() {
		const saved = await store.loadSetting('audio-editor-preferences-v1', null);
		if (!saved) return state.preferences;
		try {
			const loaded = loadAudioEditorPreferencesV1(saved);
			if (loaded.readOnly) {
				state.preferencesReadOnly = true;
				return state.preferences;
			}
			state.preferences = loaded.preferences;
			return state.preferences;
		} catch {
			state.preferences = createAudioEditorPreferencesV1();
			await store.saveSetting('audio-editor-preferences-v1', state.preferences);
			return state.preferences;
		}
	}

	function persistPreferences(nextPreferences) {
		if (state.preferencesReadOnly) {
			throw new Error(copy.preferencesNewerSchema);
		}
		state.preferences = nextPreferences;
		publishDocumentSnapshot();
		return Promise.resolve(store.saveSetting('audio-editor-preferences-v1', nextPreferences))
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
		state.showRms = Boolean(await store.loadSetting('waveform-show-rms', false));
		state.showVerticalRulers = Boolean(await store.loadSetting('timeline-show-vertical-rulers', true));
		state.updateDisplayWhilePlaying = Boolean(await store.loadSetting('timeline-update-while-playing', true));
		state.pinnedPlayhead = Boolean(await store.loadSetting('timeline-pinned-playhead', false));
		state.playbackOnRulerClick = Boolean(await store.loadSetting('timeline-ruler-playback', true));
		state.metronomeEnabled = Boolean(await store.loadSetting('transport-metronome', false));
		state.selectionFollowsLoop = Boolean(await store.loadSetting('selection-follows-loop', false));
		const storedRecentProjectIds = await store.loadSetting('audio-editor-recent-project-ids', []);
		state.recentProjectIds = Array.isArray(storedRecentProjectIds)
			? [...new Set(storedRecentProjectIds.filter((projectId) => typeof projectId === 'string' && projectId))]
			: [];
		const lastProjectId = await store.loadSetting('last-project-id', null);
		const saved = lastProjectId ? await store.loadProject(lastProjectId) : null;
		if (saved) await openProject(saved);
		else await newProject();
		publishProjectState();
		if (!state.readOnly) await saveNow();
		await refreshStorageUsage();
		if (state.missingSourceIds.size) setStatus(copy.missingSourcesBlocked, 'error');
		else if (!state.readOnly) setStatus(copy.ready, 'success');
	}

	async function newProject(options = {}) {
		const title = String(options.title || copy.untitledProject).trim() || copy.untitledProject;
		const nextProject = createAudioEditorProjectV2({ title, sampleRate: normalizeProjectSampleRate(options.sampleRate) });
		const track = createAddTrackCommand({
			schemaVersion: 2,
			type: 'audio',
			name: `${copy.track} 1`,
			armed: true,
		});
		const history = executeEditorCommand(createEditorHistory(nextProject), track);
		await switchProject(history.present, { save: true, skipFlush: options.skipFlush });
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

	async function performProjectSwitch(nextProject, options = {}) {
		cancelRecordingStart();
		state.exportAbort?.abort();
		state.exportAbort = null;
		state.sampleEditAbort?.abort();
		state.sampleEditMode = null;
		cancelPlaybackCachePreparation();
		await stopRecording().catch(() => undefined);
		persistActiveSessionUiState();
		if (!options.skipFlush && project && project.id !== nextProject.id && !state.readOnly) await saveNow();
		globalThis.clearTimeout(state.autosaveTimer);
		state.autosaveTimer = 0;
		engine.stop();
		cancelAudacityEffectPreview({ publish: false });
		state.projectLock?.release();
		state.projectLock = await acquireProjectLock(nextProject.id);
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
		await loadProjectSources(project);
		clipTimePitchCache.retainClipIds?.(liveSessionClipIds());
		evictUnreferencedSourceCaches(sourceBuffers, sourcePeaks, liveSessionSourceIds());
		engine.loadProject(project, sourceBuffers, { chunkSources: sourceChunkProviders });
		await store.saveSetting('last-project-id', nextProject.id);
		state.recentProjectIds = [nextProject.id, ...state.recentProjectIds.filter((projectId) => projectId !== nextProject.id)].slice(0, 20);
		await store.saveSetting('audio-editor-recent-project-ids', state.recentProjectIds);
		if (options.save && !state.readOnly) {
			await store.saveProject(project);
			sessionController.markProjectSaved(project.id);
		}
		state.saveState = sessionTab(project.id)?.dirty ? 'dirty' : 'saved';
		state.projects = Object.freeze(await store.listProjects());
		publishProjectState();
		await garbageCollectSources();
		if (lockReadOnly) setStatus(copy.projectOpenOtherTab, 'error');
		else if (state.readOnly) setStatus(options.readOnlyReason || copy.projectReadOnly, 'error');
	}

	async function getAup4Client() {
		if (!aup4Client) {
			aup4Client = createAup4Client(options.aup4 || {});
			aup4Environment = await aup4Client.initialize();
		}
		return aup4Client;
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
			await preflightStorage(decoded.sources.reduce((sum, source) => sum + source.channels.reduce((total, channel) => total + channel.byteLength, 0), 0), 'import');
			for (const sourceAudio of decoded.sources) {
				const source = decoded.project.sources.find((candidate) => candidate.id === sourceAudio.sourceId);
				if (!source) continue;
				const writer = await store.beginSourceWrite(source.id, {
					name: source.name,
					mimeType: source.mimeType,
					sampleRate: source.sampleRate,
					channelCount: source.channelCount,
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
			await switchProject(decoded.project, {
				readOnly: opened.readOnly,
				readOnlyReason: readOnlyIssue?.message,
				save: !opened.readOnly,
			});
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
				project: decoded.project,
				validation: decoded.validation,
				warnings: decoded.warnings || [],
				compatibilityReport: decoded.compatibilityReport || decoded.validation?.compatibilityReport || null,
			};
		} catch (error) {
			for (const sourceId of persistedSourceIds) await store.deleteSource(sourceId).catch(() => undefined);
			await aup4Client?.close(nativeId).catch(() => undefined);
			throw error;
		} finally {
			state.importing = false;
			publishDocumentSnapshot();
		}
	}

	async function saveAup4(options = {}) {
		if (project?.schemaVersion !== 2) throw new Error(copy.aup4OnlyV2);
		if (state.missingSourceIds.size) throw new Error(copy.missingSourcesPreventSave);
		if (state.readOnly && !options.saveCopy) throw new Error(copy.projectReadOnly);
		let fileHandle = options.fileHandle;
		if (!fileHandle && options.useFileSystemAccess !== false) {
			try { fileHandle = await requestAup4FileHandle({ fileName: options.fileName || project.title }); }
			catch (error) {
				if (error?.name === 'AbortError') return { cancelled: true };
				throw error;
			}
		}
		const client = await getAup4Client();
		const nativeId = String(options.projectId || project.id).replace(/[^a-z0-9_-]/gi, '-');
		await client.create(nativeId);
		const sources = [];
		for (const source of project.sources.filter((candidate) => project.clips.some((clip) => clip.sourceId === candidate.id))) {
			const buffer = sourceBuffers.get(source.id);
			const channels = buffer
				? Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))
				: await loadStoredSourceChannels(store, source);
			if (!channels?.length) throw new Error(copy.sourcePcmUnavailable.replace('{source}', source.name || source.id));
			sources.push({ sourceId: source.id, sampleRate: source.sampleRate, channels });
		}
		const sourceBytes = sources.reduce((sum, source) => sum + source.channels.reduce((total, channel) => total + channel.byteLength, 0), 0);
		await preflightStorage(sourceBytes, 'export');
		const storage = await store.estimateStorage();
		const portableOptions = {
			mobile: state.mobile,
			opfs: aup4Environment?.opfs,
			quota: storage.quota,
			usage: storage.usage,
			workingBytes: sourceBytes,
		};
		state.saveState = 'saving';
		publishDocumentSnapshot();
		try {
			await client.writeSnapshot(nativeId, project, sources, {
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
			});
			state.saveState = 'saved';
			setStatus(copy.aup4Saved, 'success');
			publishDocumentSnapshot();
			return { ...saved, validation: await client.inspect(nativeId) };
		} catch (error) {
			state.saveState = 'dirty';
			publishDocumentSnapshot();
			throw error;
		}
	}

	function updateNativeProjectProgress(progress, prefix) {
		const percentage = Math.round(Math.max(0, Math.min(1, Number(progress?.value) || 0)) * 100);
		setStatus(`${prefix} ${percentage}%`);
	}

	async function loadProjectSources(project) {
		const usedSourceIds = new Set((project.clips || []).map((clip) => clip.sourceId));
		sourceChunkProviders.clear();
		if (!usedSourceIds.size) return;
		const context = await engine.getAudioContext?.({ resume: false });
		for (const source of project.sources.filter((candidate) => usedSourceIds.has(candidate.id))) {
			try {
				const metadata = await store.getSourceMetadata(source.storageKey || source.id);
				const useChunkStream = isLongStoredSource(source, metadata);
				let peaks = await store.loadAnalysis(peakCacheKey(source.id));
				if (useChunkStream) {
					sourceBuffers.delete(source.id);
					sourceChunkProviders.set(source.id, createStoredChunkProvider(store, source));
					if (!peaks?.levels) {
						peaks = await generateStoredWaveformPeaks(store, source, copy);
						await store.saveAnalysis(peakCacheKey(source.id), peaks);
					}
				} else {
					const buffer = sourceBuffers.get(source.id) || await readStoredAudioBuffer(store, source, context);
					if (!buffer) continue;
					sourceBuffers.set(source.id, buffer);
					if (!peaks?.levels) {
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

	async function listProjects() {
		await saveNow();
		state.projects = Object.freeze(await store.listProjects());
		publishDocumentSnapshot();
		return state.projects;
	}

	async function clearRecentProjects() {
		state.recentProjectIds = [];
		await store.saveSetting('audio-editor-recent-project-ids', state.recentProjectIds);
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
		state.projectLock?.release();
		state.projectLock = null;
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
		state.projectLock?.release();
		state.projectLock = null;
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
		state.projectLock?.release();
		state.projectLock = null;
		engine.stop();
		clipTimePitchCache.clear?.();
		sourceBuffers.clear();
		sourceChunkProviders.clear();
		sourcePeaks.clear();
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

	async function importFiles(fileList) {
		const files = [...(fileList || [])];
		if (!files.length || editingBlocked()) return;
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
		for (const file of importQueue) {
			try {
				const result = await importFile(file);
				if (result?.notice) notices.push(result.notice);
				successes += 1;
			} catch (error) {
				failures += 1;
				handleError(error);
			}
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

	async function importFile(file) {
		await preflightStorage(Math.max(file.size * 8, 8 * 1024 * 1024), 'import');
		if (isAup3File(file)) return importStructuredAudacityProject(file);
		const context = await engine.getAudioContext({ resume: false });
		let decoded;
		try {
			decoded = await engine.decodeAudioData(await file.arrayBuffer());
		} catch {
			const fallback = await ffmpeg.decode(file, { sampleRate: projectSampleRate() });
			decoded = await bufferFromChannels(fallback.channels, fallback.sampleRate, context, copy);
		}
		const canonical = await canonicalizeBuffer(decoded, context, null, copy);
		await preflightStorage(canonical.length * canonical.numberOfChannels * Float32Array.BYTES_PER_ELEMENT, 'import');
		const sourceId = createStableId('source');
		const trackId = createStableId('track');
		const clipId = createStableId('clip');
		const trackName = stripExtension(file.name) || `${copy.track} ${project.tracks.length + 1}`;
		const sourceName = file.name;
		const mimeType = file.type || 'audio/wav';
		const writer = await store.beginSourceWrite(sourceId, { name: sourceName, mimeType });
		try {
			await writeBuffer(writer, canonical);
			await writer.commit({ sampleRate: canonical.sampleRate, channelCount: canonical.numberOfChannels });
		} catch (error) {
			await writer.abort();
			throw error;
		}

		const command = {
			type: 'batch',
			commands: [
				createAddSourceCommand({
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
					originalSampleRate: decoded.sampleRate,
				}),
				createAddTrackCommand({
					schemaVersion: 2,
					type: 'audio',
					id: trackId,
					name: trackName,
				}),
				createAddClipCommand(trackId, {
					schemaVersion: 2,
					title: trackName,
					sourceDurationFrames: canonical.length,
					id: clipId,
					sourceId,
					timelineStartFrame: 0,
					sourceStartFrame: 0,
					durationFrames: Math.max(1, Math.round(canonical.length * projectSampleRate() / canonical.sampleRate)),
				}),
			],
		};
		sourceBuffers.set(sourceId, canonical);
		try {
			const peaks = await generateWaveformPeaks(audioBufferChannels(canonical), copy);
			sourcePeaks.set(sourceId, peaks);
			await store.saveAnalysis(peakCacheKey(sourceId), peaks);
			commit(command, { selectTrackId: trackId, selectClipId: clipId });
		} catch (error) {
			sourceBuffers.delete(sourceId);
			sourcePeaks.delete(sourceId);
			await store.deleteSource(sourceId);
			throw error;
		}
		warnEnvelope();
		return null;
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
		await persistImportedProject(decoded);
		const detail = decoded.warnings.map(formatAup3Warning).filter(Boolean).join(' ');
		const message = legacy ? copy.aupImported : copy.aup3Imported;
		return { project: decoded.project, warnings: decoded.warnings, notice: detail ? `${message} ${detail}` : message };
	}

	async function persistImportedProject(decoded) {
		if (!decoded?.project || !Array.isArray(decoded.sources)) throw new TypeError(copy.structuredProjectRequired);
		const sourceById = new Map(decoded.project.sources.map((source) => [source.id, source]));
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
			await store.saveProject(decoded.project);
			projectSaved = true;
			await switchProject(decoded.project, { save: false });
		} catch (error) {
			if (projectSaved && project?.id !== decoded.project.id) {
				await store.deleteProject(decoded.project.id).catch(() => undefined);
			}
			if (project?.id !== decoded.project.id) {
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
			armed: options.armed ?? project.tracks.length === 0,
		});
		commit(track, { selectTrackId: trackId });
		return trackId;
	}

	function addLabelTrack(options = {}) {
		if (editingBlocked()) return null;
		const trackId = options.id || createStableId('label-track');
		const command = createAddLabelTrackCommand({
			...options,
			id: trackId,
			name: String(options.name || copy.labels).trim(),
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
		const destination = direction === 'top'
			? 0
			: direction === 'bottom'
				? project.tracks.length - 1
				: direction === 'up'
					? Math.max(0, index - 1)
					: direction === 'down'
						? Math.min(project.tracks.length - 1, index + 1)
						: index;
		return reorderTrack(trackId, destination);
	}

	function setAllTracksCollapsed(collapsed) {
		if (editingBlocked()) return null;
		if (project.schemaVersion !== 2) throw new Error(copy.v2Required);
		const commands = project.tracks
			.filter((track) => track.collapsed !== Boolean(collapsed))
			.map((track) => ({ type: 'track/update', trackId: track.id, changes: { collapsed: Boolean(collapsed) } }));
		if (!commands.length) return project;
		return commit({ type: 'batch', commands });
	}

	function setTrackDisplayMode(trackId, displayMode) {
		if (editingBlocked()) return null;
		if (project.schemaVersion !== 2) throw new Error(copy.v2Required);
		const track = findTrack(project, trackId);
		if (!track || track.type === 'label') throw new Error(copy.audioTrackRequired);
		if (!['waveform', 'spectrogram', 'multiview', 'half-wave'].includes(displayMode)) throw new RangeError(copy.unknownTrackDisplay);
		state.timelineView = displayMode;
		return commit({ type: 'track/update', trackId: track.id, changes: { displayMode } }, { selectTrackId: track.id });
	}

	function setTrackRate(trackId = state.selectedTrackId, requestedSampleRate = projectSampleRate()) {
		return resampleTrack(trackId, requestedSampleRate);
	}

	function setTrackSampleFormat(trackId = state.selectedTrackId, sampleFormat = 'float32') {
		if (editingBlocked()) return null;
		if (project.schemaVersion !== 2) throw new Error(copy.v2Required);
		const track = findTrack(project, trackId);
		if (!track || track.type === 'label') throw new Error(copy.audioTrackRequired);
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

	async function resampleTrack(trackId = state.selectedTrackId, requestedSampleRate = projectSampleRate()) {
		if (editingBlocked()) return null;
		if (project.schemaVersion !== 2) throw new Error(copy.v2Required);
		const track = findTrack(project, trackId);
		if (!track || track.type === 'label') throw new Error(copy.audioTrackRequired);
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
				sourceBuffers.set(sourceId, buffer);
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
		if (project.schemaVersion !== 2) throw new Error(copy.v2Required);
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
		if (project.schemaVersion !== 2) throw new Error(copy.v2Required);
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
		if (project.schemaVersion !== 2) throw new Error(copy.v2Required);
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
		sourceBuffers.set(sourceId, buffer);
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
			sourcePeaks.delete(source.id);
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
		if (exportOptions.download !== false) await saveLabelExport(result, options.saveLabelFile);
		setStatus(copy.labelsExported.replace('{count}', String(labels.length)), 'success');
		return result;
	}

	function handleEdit(action) {
		if (!state.history || editingBlocked()) return;
		try {
			if (action === 'undo') {
				state.history = undoEditorCommand(state.history);
				projectChanged();
				return;
			}
			if (action === 'redo') {
				state.history = redoEditorCommand(state.history);
				projectChanged();
				return;
			}
			const selection = activeSelection();
			const audioTrackIds = project.tracks.filter((track) => Array.isArray(track.clipIds)).map((track) => track.id);
			const selectedTrack = findTrack(project, state.selectedTrackId);
			const rangeTrackIds = project.selection?.trackIds?.filter((trackId) => audioTrackIds.includes(trackId)) || [];
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
				if (action === 'copy') {
					setSessionClipboard(createClipboardDescriptor(project, { ...selection, trackIds }));
					compactLiveSourceState();
					void garbageCollectSources().catch(handleError);
				}
				else {
					const affectedTrackIds = action === 'cut-all-tracks-ripple' ? audioTrackIds : trackIds;
					setSessionClipboard(createClipboardDescriptor(project, { ...selection, trackIds: affectedTrackIds }));
					commit(prepareRangeDeleteCommand(project, {
						...selection,
						trackIds: affectedTrackIds,
						rippleMode: cutModes[action],
					}));
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
				setSessionClipboard(createClipboardDescriptor(project, { ...selection, trackIds }));
				commit(prepareControllerPaste('overlap', selection.endFrame));
				return;
			}
			if (action === 'split') {
				if (!state.selectedClipId) return;
				commit(prepareSplitCommand(state.selectedClipId, engine.getPositionFrames()));
				return;
			}
			if (action === 'split-new-track') {
				const clip = state.selectedClipId ? findClip(project, state.selectedClipId) : null;
				const sourceTrack = clip ? findClipTrack(project, clip.id) : null;
				if (!clip || !sourceTrack) return;
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
			const selectedClipIds = project.selection?.clipIds?.length
				? project.selection.clipIds
				: state.selectedClipId ? [state.selectedClipId] : [];
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
			if (action === 'delete' && !selection && state.selectedClipId) {
				commit({ type: 'clip/remove', clipId: state.selectedClipId });
				state.selectedClipId = null;
				return;
			}
			if (action === 'trim-outside-selection' && selection) {
				commit(prepareKeepRangeCommand(project, { ...selection, trackIds }));
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
			if (selection && Object.hasOwn(deleteModes, action)) {
				commit(prepareRangeDeleteCommand(project, {
					...selection,
					trackIds: action === 'delete-all-tracks-ripple' ? audioTrackIds : trackIds,
					rippleMode: deleteModes[action],
				}));
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
		const trackIds = requestedTrackIds == null
			? [state.selectedTrackId]
			: Array.isArray(requestedTrackIds) ? requestedTrackIds : [requestedTrackIds];
		const targetTrackIds = new Set(trackIds.filter(Boolean));
		const commands = [];
		for (const track of project.tracks) {
			if (!targetTrackIds.has(track.id) || !Array.isArray(track.clipIds)) continue;
			for (const clipId of track.clipIds) {
				const clip = findClip(project, clipId);
				if (!clip || frame <= clip.timelineStartFrame || frame >= clip.timelineStartFrame + clip.durationFrames) continue;
				commands.push(prepareSplitCommand(clip.id, frame));
			}
		}
		if (!commands.length) return null;
		const command = commands.length === 1 ? commands[0] : { type: 'batch', commands };
		return commit(command, { selectTrackId: [...targetTrackIds][0] || state.selectedTrackId });
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
		for (const [index, clipboardTrack] of state.clipboard.tracks.entries()) {
			let target = findTrack(project, clipboardTrack.sourceTrackId);
			if (!target && index === 0 && selected && Array.isArray(selected.clipIds)) target = selected;
			if (target && usedTrackIds.has(target.id)) target = null;
			if (!target) {
				const trackId = createStableId('track');
				addedTrackCount += 1;
				commands.push(createAddTrackCommand({
					schemaVersion: 2,
					type: 'audio',
					id: trackId,
					name: clipboardTrack.sourceTrackName || `${copy.track} ${project.tracks.length + addedTrackCount}`,
				}));
				target = { id: trackId };
			}
			trackMap[clipboardTrack.sourceTrackId] = target.id;
			usedTrackIds.add(target.id);
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
		for (const [startFrame, endFrame] of timelineRegions.reverse()) {
			const after = prepareSplitCommand(clip.id, endFrame);
			const silence = prepareSplitCommand(clip.id, startFrame);
			commands.push(after, silence, { type: 'clip/remove', clipId: silence.rightClipId });
		}
		commit({ type: 'batch', commands }, { selectClipId: clip.id });
	}

	async function generateSelectionSilence() {
		const selection = activeSelection();
		if (!selection) throw new Error(copy.timeSelectionRequired);
		return generateSignal('silence', { durationSeconds: (selection.endFrame - selection.startFrame) / projectSampleRate() });
	}

	async function generateSignal(type, generatorOptions = {}) {
		if (editingBlocked()) return;
		const selection = activeSelection();
		let targetTrack = findTrack(project, generatorOptions.trackId || state.selectedTrackId);
		if (!Array.isArray(targetTrack?.clipIds)) targetTrack = project.tracks.find((track) => Array.isArray(track.clipIds)) || null;
		const sampleRate = projectSampleRate();
		const durationSeconds = generatorOptions.durationSeconds
			?? (selection ? (selection.endFrame - selection.startFrame) / sampleRate : 1);
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
		const writer = await store.beginSourceWrite(sourceId, { name, mimeType: 'audio/wav', sampleRate, channelCount });
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
			sourceBuffers.set(sourceId, buffer);
			const peaks = await generateWaveformPeaks(generated.channels, copy);
			sourcePeaks.set(sourceId, peaks);
			await store.saveAnalysis(peakCacheKey(sourceId), peaks);
			commit(command, { selectTrackId: targetTrack.id, selectClipId });
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

	async function handleTransport(action) {
		if ((state.recordingStarting || state.recorder) && action !== 'stop' && action !== 'record') return;
		if (state.missingSourceIds.size && action === 'play') throw new Error(copy.localSourcesMissing);
		if (action === 'play') {
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
			return state.recorder ? stopRecording() : engine.stop();
		}
		if (action === 'jump-start') return engine.seek(0);
		if (action === 'jump-end') return engine.seek(projectDurationFrames(project));
		if (action === 'rewind') return engine.seek(engine.getPositionFrames() - projectSampleRate() * 5);
		if (action === 'forward') return engine.seek(engine.getPositionFrames() + projectSampleRate() * 5);
		if (action === 'loop') {
			const selection = activeSelection();
			const enabled = !engine.getState().loop.enabled;
			const range = selection || { startFrame: 0, endFrame: projectDurationFrames(project) };
			const next = commitLoopRange({ enabled, ...range });
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
		void store.saveSetting('selection-follows-loop', state.selectionFollowsLoop);
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
				...(project.schemaVersion === 2 ? {
					trackIds: selection.trackIds || [],
					clipIds: selection.clipIds || [],
					frequencyRange: selection.frequencyRange || null,
				} : {}),
			}],
		});
	}

	function toggleMetronome() {
		state.metronomeEnabled = !state.metronomeEnabled;
		void store.saveSetting('transport-metronome', state.metronomeEnabled);
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
		const beatFrames = sampleRate * 60 / bpm;
		const position = Math.max(0, engine.getPositionFrames());
		const beatIndex = Math.ceil(position / beatFrames);
		const nextBeatFrame = beatIndex * beatFrames;
		const delaySeconds = Math.max(0, (nextBeatFrame - position) / sampleRate);
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
		const delayMs = Math.max(10, (delaySeconds + 60 / bpm) * 1000);
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

	function projectSampleRate() {
		return Number.isSafeInteger(project?.sampleRate) && project.sampleRate > 0
			? project.sampleRate
			: AUDIO_EDITOR_SAMPLE_RATE;
	}

	function selectTrack(trackId) {
		if (trackId != null && !findTrack(project, trackId)) throw new Error(copy.audioTrackNotFound);
		state.selectedTrackId = trackId || null;
		state.selectedClipId = null;
		publishProjectState();
	}

	function selectClip(clipId, options = {}) {
		if (clipId == null) {
			state.selectedClipId = null;
			if (project?.schemaVersion === 2 && project.selection?.clipIds?.length) {
				const selection = project.selection;
				return commit({
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
		if (project.schemaVersion !== 2) {
			state.selectedTrackId = track.id;
			state.selectedClipId = clip.id;
			publishProjectState();
			return clip.id;
		}

		const currentClipIds = project.selection?.clipIds || [];
		let clipIds;
		if (options.toggle) {
			clipIds = currentClipIds.includes(clip.id)
				? currentClipIds.filter((selectedId) => selectedId !== clip.id)
				: [...currentClipIds, clip.id];
		} else if (options.additive) {
			clipIds = currentClipIds.includes(clip.id) ? currentClipIds : [...currentClipIds, clip.id];
		} else clipIds = [clip.id];
		const trackIds = [...new Set(clipIds.map((selectedId) => findClipTrack(project, selectedId)?.id).filter(Boolean))];
		const activeClipId = clipIds.includes(clip.id) ? clip.id : clipIds.at(-1) || null;
		const activeTrack = activeClipId ? findClipTrack(project, activeClipId) : null;
		state.selectedTrackId = activeTrack?.id || null;
		state.selectedClipId = activeClipId;
		const selection = project.selection || { startFrame: 0, endFrame: 0, frequencyRange: null };
		commit({
			type: 'selection/set',
			startFrame: selection.startFrame,
			endFrame: selection.endFrame,
			trackIds,
			clipIds,
			frequencyRange: selection.frequencyRange || null,
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
		return commit({ type: 'selection/set', startFrame: start, endFrame: end, ...details });
	}

	function selectAllTracks() {
		if (!project) return null;
		const selection = project.selection || { startFrame: 0, endFrame: 0 };
		const trackIds = project.tracks.map((track) => track.id);
		const next = setSelection(selection.startFrame, selection.endFrame, { trackIds });
		if (!state.selectedTrackId && trackIds.length) state.selectedTrackId = trackIds[0];
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
		void store.saveSetting('waveform-show-rms', state.showRms);
		publishDocumentSnapshot();
		return state.showRms;
	}

	function toggleVerticalRulers() {
		state.showVerticalRulers = !state.showVerticalRulers;
		void store.saveSetting('timeline-show-vertical-rulers', state.showVerticalRulers);
		publishDocumentSnapshot();
		return state.showVerticalRulers;
	}

	function toggleUpdateWhilePlaying() {
		state.updateDisplayWhilePlaying = !state.updateDisplayWhilePlaying;
		void store.saveSetting('timeline-update-while-playing', state.updateDisplayWhilePlaying);
		publishDocumentSnapshot();
		return state.updateDisplayWhilePlaying;
	}

	function togglePinnedPlayhead() {
		state.pinnedPlayhead = !state.pinnedPlayhead;
		void store.saveSetting('timeline-pinned-playhead', state.pinnedPlayhead);
		publishDocumentSnapshot();
		return state.pinnedPlayhead;
	}

	function toggleRulerPlayback() {
		state.playbackOnRulerClick = !state.playbackOnRulerClick;
		void store.saveSetting('timeline-ruler-playback', state.playbackOnRulerClick);
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
		if (project?.schemaVersion !== 2) throw new Error(copy.v2Required);
		return commit({ type: 'snap/set', settings });
	}

	function snapTimelineFrame(value, overrides = {}) {
		const frame = Number(value);
		if (!Number.isFinite(frame)) throw new TypeError(copy.timelineFramesFinite);
		const rounded = Math.round(frame);
		if (project?.schemaVersion !== 2) return Math.max(0, rounded);
		return snapAudioEditorFrameWithProject(rounded, project, { minimumFrame: 0, ...overrides });
	}

	function setZoom(pixelsPerSecond) {
		const durationSeconds = editorTimelineDurationFrames(project, projectSampleRate()) / projectSampleRate();
		const maximum = Math.min(MAX_PIXELS_PER_SECOND, MAX_TIMELINE_PIXELS / durationSeconds);
		state.pixelsPerSecond = Math.max(1, Math.min(maximum, Number(pixelsPerSecond) || DEFAULT_PIXELS_PER_SECOND));
		if (!sampleEditingAvailable()) state.sampleEditMode = null;
		updatePlayhead(engine.getPositionFrames());
		publishDocumentSnapshot();
		return state.pixelsPerSecond;
	}

	function sampleEditingAvailable(clipId = state.selectedClipId) {
		if (project?.schemaVersion !== 2 || !clipId) return false;
		const clip = findClip(project, clipId);
		const source = clip ? findSource(project, clip.sourceId) : null;
		if (!clip || !source || !clip.durationFrames || !clip.sourceDurationFrames) return false;
		const visibleSourceSamplesPerSecond = projectSampleRate() * clip.sourceDurationFrames / clip.durationFrames;
		return canEditAudioSamplesAtZoom(state.pixelsPerSecond, visibleSourceSamplesPerSecond);
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
			const context = await engine.getAudioContext({ resume: false });
			const buffer = await readStoredAudioBuffer(store, persisted.source, context);
			throwIfAborted(abort.signal);
			const peaks = await generateWaveformPeaks(audioBufferChannels(buffer), copy);
			throwIfAborted(abort.signal);
			sourceBuffers.set(sourceId, buffer);
			sourcePeaks.set(sourceId, peaks);
			await store.saveAnalysis(peakCacheKey(sourceId), peaks);
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
		syncRecordingPoolSnapshot();
		await refreshRecordingInputs({ probe: false });
		if (!state.preferences.recording.retainInputs && !state.recorder) recordingCapturePool.releaseAll();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		if (!opened.length && failures[0]) throw failures[0];
		return state.recordingDevices;
	}

	async function refreshRecordingInputs({ probe = true } = {}) {
		const discovered = [];
		if (mediaDevices?.enumerateDevices) {
			const devices = await mediaDevices.enumerateDevices();
			for (const device of devices || []) {
				if (device?.kind !== 'audioinput' || !device.deviceId) continue;
				discovered.push({
					deviceId: String(device.deviceId),
					label: String(device.label || ''),
				});
			}
		}
		state.recordingEnumeratedDeviceIds = new Set(discovered.map((device) => device.deviceId));
		updateRecordingDeviceRows(discovered);
		if (probe) {
			await Promise.allSettled(discovered.map((device) => recordingCapturePool.acquireHardware(device.deviceId, {
				channelCount: RECORDING_CHANNEL_COUNT_MAXIMUM,
				sampleRate: projectSampleRate(),
			})));
			syncRecordingPoolSnapshot();
			if (!state.preferences.recording.retainInputs && !state.recorder) recordingCapturePool.releaseAll();
			syncRecordingPoolSnapshot();
		}
		publishDocumentSnapshot();
		return state.recordingDevices;
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
		const track = findTrack(project, trackId);
		state.recordingRouting = setRecordingTrackRoute(state.recordingRouting, track, route);
		if (route == null) delete state.recordingRouteHealth[trackId];
		else state.recordingRouteHealth[trackId] = 'unavailable';
		updateRecordingDeviceRows();
		publishDocumentSnapshot();
		const persist = persistRecordingRouting();
		const normalized = state.recordingRouting.routes[trackId];
		if (!normalized) {
			await persist;
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
			if (!state.preferences.recording.retainInputs && !state.recorder) {
				if (normalized.kind === 'display') recordingCapturePool.releaseDisplay();
				else recordingCapturePool.releaseHardware(normalized.deviceId);
				syncRecordingPoolSnapshot();
			}
		} catch {
			// The pin is intentionally retained so a missing or denied source remains visible.
			state.recordingRouteHealth[trackId] = 'unavailable';
		}
		await persist;
		updateRecordingDeviceRows();
		publishDocumentSnapshot();
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
		else if (state.recorder || state.recordingStarting) state.recordingReleaseAfterStop = true;
		else recordingCapturePool.releaseAll();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
		return retainInputs;
	}

	function releaseInputs() {
		if (state.recorder || state.recordingStarting || state.recordingFinishing) return false;
		const released = recordingCapturePool.releaseAll();
		syncRecordingPoolSnapshot();
		publishDocumentSnapshot();
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
		if (!state.disposed) publishDocumentSnapshot();
	}

	function setMonitoring(enabled) {
		state.monitoring = Boolean(enabled);
		state.recorder?.setMonitoring(state.monitoring);
		void store.saveSetting('input-monitor', state.monitoring);
		publishDocumentSnapshot();
		return state.monitoring;
	}

	function setRecordingInputGain(value) {
		state.recordingInputGain = normalizeRecordingInputGain(value);
		state.recorder?.setInputGain(state.recordingInputGain);
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

	function commit(command, selection = {}) {
		if (state.readOnly) throw new Error(copy.projectReadOnly);
		state.history = executeEditorCommand(state.history, command);
		project = state.history.present;
		if (selection.selectTrackId) state.selectedTrackId = selection.selectTrackId;
		if (selection.selectClipId) state.selectedClipId = selection.selectClipId;
		projectChanged();
		return project;
	}

	function projectChanged() {
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
		if (engine.getState().state === 'playing' && projectHasTimePitchClips(project)) {
			const snapshot = project;
			void beginPlaybackCachePreparation(snapshot)
				.then(() => snapshot === project && engine.applyProject(project, sourceBuffers))
				.catch(handlePlaybackCacheError);
		} else void engine.applyProject(project, sourceBuffers).catch(handleError);
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
			void saveSnapshot(snapshot, generation);
		}, 500);
	}

	async function saveNow() {
		if (!state.history || state.readOnly) return;
		globalThis.clearTimeout(state.autosaveTimer);
		state.autosaveTimer = 0;
		const generation = state.saveGeneration;
		return saveSnapshot(cloneProject(project), generation);
	}

	async function saveSnapshot(snapshot, generation) {
		state.pendingSaveSnapshots.add(snapshot);
		try {
			await store.saveProject(snapshot);
			state.pendingSaveSnapshots.delete(snapshot);
			if (project?.id === snapshot.id) await store.saveSetting('last-project-id', snapshot.id);
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
				for (const clip of historyProject.clips || []) clipIds.add(clip.id);
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
		state.pixelsPerSecond = Math.min(state.pixelsPerSecond, MAX_TIMELINE_PIXELS / durationSeconds);
		state.timelineWidth = Math.max(1, Math.round(durationSeconds * state.pixelsPerSecond));
		updatePlayhead(engine.getPositionFrames(), duration);
		publishDocumentSnapshot();
	}

	function setTimelineView(view) {
		state.timelineView = ['spectrogram', 'multiview'].includes(view) ? view : 'waveform';
		publishDocumentSnapshot();
		return state.timelineView;
	}

	function duplicateTrack(track) {
		if (editingBlocked() || !track) return;
		const trackId = createStableId('track');
		const effects = track.effects.map((effect) => ({ ...effect, id: createStableId('effect') }));
		const commands = [createAddTrackCommand({ ...track, id: trackId, name: `${track.name} ${copy.projectCopySuffix}`, armed: false, effects, clipIds: [] })];
		let selectedClipId = null;
		for (const clipId of track.clipIds) {
			const clip = findClip(project, clipId);
			if (!clip) continue;
			const nextClipId = createStableId('clip');
			selectedClipId ||= nextClipId;
			commands.push(createAddClipCommand(trackId, { ...clip, id: nextClipId }));
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
		const command = prepareOverwriteClipCommand(project, clip.id, {
			trackId: track.id,
			changes: {
				pitchCents,
				speedRatio,
				preserveFormants: changes.preserveFormants == null ? clip.preserveFormants : Boolean(changes.preserveFormants),
				durationFrames,
				fadeInFrames: Math.min(clip.fadeInFrames, durationFrames),
				fadeOutFrames: Math.min(clip.fadeOutFrames, durationFrames),
				envelope: scaleClipEnvelope(clip, durationFrames),
				renderCacheRevision: (clip.renderCacheRevision || 0) + 1,
			},
		});
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
		const speedRatio = (clip.sourceDurationFrames || clip.durationFrames) / durationFrames;
		const command = prepareOverwriteClipCommand(project, clip.id, {
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
		});
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
			sourceBuffers.set(renderedSourceId, buffer);
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
		if (!snapshot || snapshot.schemaVersion !== 2) return [];
		const pairs = [];
		for (const clip of snapshot.clips || []) {
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

	async function beginPlaybackCachePreparation(snapshot) {
		cancelPlaybackCachePreparation();
		const abort = new AbortController();
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
							await engine.applyProject(project, sourceBuffers);
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

	function addEffect(request = {}) {
		if (editingBlocked()) return;
		if (!request.type) throw new TypeError(copy.effectTypeRequired);
		const scope = ['master', 'group', 'send'].includes(request.scope) ? request.scope : 'track';
		const trackId = request.trackId ?? request.busId ?? state.selectedTrackId;
		if (scope === 'track' && !trackId) return handleError(new Error(copy.selectTrackFirst));
		if ((scope === 'group' || scope === 'send') && !trackId) throw new TypeError('A mixer bus ID is required.');
		const type = request.type;
		if (!audioEffectTypes().includes(type)) throw new Error(copy.effectUnsupported);
		const effectOptions = { ...(request.options || {}) };
		if (type === 'audacity-auto-duck') {
			const candidates = project.tracks.filter((track) => scope === 'master' || track.id !== trackId);
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

	function effectStack(scope, trackId, snapshot = project) {
		if (scope === 'master') return snapshot?.master?.effects || [];
		if (scope !== 'track') throw new RangeError('Effect stack scope must be track or master.');
		const track = findTrack(snapshot, trackId);
		if (!track || track.type === 'label') throw new Error(copy.audioTrackNotFound);
		return track.effects || [];
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
		const effectOptions = {
			enabled: options.forceEnabled ? true : effect.enabled !== false,
			params: structuredClone(effect.params || {}),
		};
		if (effect.context !== undefined) effectOptions.context = structuredClone(effect.context);
		if (effect.state !== undefined) effectOptions.state = structuredClone(effect.state);
		if (effect.type === 'audacity-auto-duck') {
			const requestedControlTrackId = effectOptions.context?.controlTrackId || state.audacityControlTrackId;
			const candidates = project.tracks.filter((track) => (
				track.type !== 'label' && (scope === 'master' || track.id !== trackId)
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
		const enabledEffects = requestedEffects.filter((effect) => effect?.enabled !== false);
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
		if (!state.audacityEffectParams[type]) state.audacityEffectParams[type] = audacityEffectDefaults(type);
		return state.audacityEffectParams[type];
	}

	function setAudacityEffectParams(changes, { markTouched = true } = {}) {
		state.audacityEffectParams[state.audacityEffectType] = normalizeAudacityEffectParams(state.audacityEffectType, {
			...currentAudacityEffectParams(),
			...changes,
		});
		if (markTouched) {
			if (!state.audacityEffectTouchedParams.has(state.audacityEffectType)) {
				state.audacityEffectTouchedParams.set(state.audacityEffectType, new Set());
			}
			const touched = state.audacityEffectTouchedParams.get(state.audacityEffectType);
			for (const name of Object.keys(changes)) touched.add(name);
		}
	}

	function setAudacityEffectType(type) {
		if (!AUDACITY_EFFECT_DEFINITIONS[type]) throw new Error(copy.selectionEffectUnsupported);
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
		state.audacityEffectParams[preset.effectType] = { ...preset.params };
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
		if (request.type) setAudacityEffectType(request.type);
		if (request.params) setAudacityEffectParamsFromController(request.params);
		if ('controlTrackId' in request) setAudacityControlTrack(request.controlTrackId);
		const fullTarget = audacityEffectTarget();
		if (!fullTarget) throw new Error(copy.audacitySelectionHint);
		const type = state.audacityEffectType;
		const definition = AUDACITY_EFFECT_DEFINITIONS[type];
		const sampleRate = projectSampleRate();
		const durationFrames = Math.min(fullTarget.durationFrames, sampleRate * 6);
		const target = {
			...fullTarget,
			endFrame: fullTarget.startFrame + durationFrames,
			durationFrames,
		};
		let params = normalizeAudacityEffectParams(type, currentAudacityEffectParams());
		if (definition.requiresNoiseProfile && !state.audacityNoiseProfile) throw new Error(copy.noiseProfileMissing);
		if (definition.requiresControlTrack && !state.audacityControlTrackId) throw new Error(copy.autoDuckControlTrack);
		const contextFrames = definition.requiresStaffPad
			? sampleRate
			: definition.requiresContext ? 128 : 0;
		const estimatedPeakBytes = estimateAudacityEffectPeakBytes(type, durationFrames, params, {
			channelCount: target.channelCount,
			controlChannelCount: definition.requiresControlTrack ? 2 : undefined,
			sampleRate,
			beforeFrames: contextFrames,
			afterFrames: contextFrames,
		});
		if (estimatedPeakBytes > AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES) throw audacityEffectMemoryError(copy);
		state.audacityEffectProcessing = true;
		setStatus(copy.audacityPreviewProcessing || copy.audacityProcessing);
		publishDocumentSnapshot();
		try {
			const channels = await renderDryTrackRange(target.track.id, target.startFrame, target.endFrame, target.channelCount);
			params = resolveInteractiveAudacityParams(type, params, channels);
			const effectContext = {};
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
				const afterEnd = Math.min(projectDurationFrames(project), target.endFrame + contextFrames);
				effectContext.beforeChannels = beforeStart < target.startFrame
					? await renderDryTrackRange(target.track.id, beforeStart, target.startFrame, target.channelCount)
					: channels.map(() => new Float32Array(0));
				effectContext.afterChannels = target.endFrame < afterEnd
					? await renderDryTrackRange(target.track.id, target.endFrame, afterEnd, target.channelCount)
					: channels.map(() => new Float32Array(0));
			}
			const result = await runAudacityEffectWorker({
				operation: 'apply', effectType: type, channels, sampleRate, params, context: effectContext,
			});
			assertAudacityEffectOutput(result.channels);
			const context = await engine.getAudioContext({ resume: true });
			await context.resume?.();
			const buffer = await bufferFromChannels(result.channels, sampleRate, context, copy);
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
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	function cancelAudacityEffectPreview(options = {}) {
		const source = state.audacityPreviewSource;
		state.audacityPreviewSource = null;
		if (source) {
			try { source.onended = null; source.stop(); } catch { /* The preview may already have ended. */ }
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
		const resolved = normalizeAudacityEffectParams(type, { ...params, gainDb });
		state.audacityEffectParams[type] = resolved;
		return resolved;
	}

	function audacityEffectTarget(requestedTrackId = state.selectedTrackId) {
		const selectedClip = state.selectedClipId ? findClip(project, state.selectedClipId) : null;
		const selectedClipTrack = selectedClip ? findClipTrack(project, selectedClip.id) : null;
		const track = findTrack(project, requestedTrackId) || selectedClipTrack;
		if (!track) return null;
		const selection = activeSelection();
		const trackClip = selectedClipTrack?.id === track.id ? selectedClip : null;
		const startFrame = selection?.startFrame ?? trackClip?.timelineStartFrame;
		const endFrame = selection?.endFrame ?? (trackClip ? trackClip.timelineStartFrame + trackClip.durationFrames : null);
		if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || endFrame <= startFrame) return null;
		const channelCount = audacitySelectionChannelCount(project, track.id, startFrame, endFrame);
		return channelCount ? { track, startFrame, endFrame, durationFrames: endFrame - startFrame, channelCount } : null;
	}

	function setSpectralBoxSelection(options = {}) {
		if (editingBlocked()) return null;
		if (project.schemaVersion !== 2) throw new Error(copy.v2Required);
		const selectedClip = state.selectedClipId ? findClip(project, state.selectedClipId) : null;
		const clipTrack = selectedClip ? findClipTrack(project, selectedClip.id) : null;
		const track = findTrack(project, state.selectedTrackId) || clipTrack;
		if (!track || track.type === 'label') throw new Error(copy.audioTrackRequired);
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
		if (project.schemaVersion !== 2) throw new Error(copy.v2Required);
		const selection = activeSelection();
		const frequencyRange = selection?.frequencyRange;
		const target = audacityEffectTarget();
		if (!target || !frequencyRange) throw new Error(copy.spectralSelectionRequired || copy.audacitySelectionHint);
		const gainDb = Number(requestedGainDb);
		if (gainDb !== -Infinity && (!Number.isFinite(gainDb) || gainDb > 120 || gainDb < -120)) {
			throw new RangeError(copy.spectralGainInvalid);
		}
		const outputBytes = target.durationFrames * target.channelCount * Float32Array.BYTES_PER_ELEMENT;
		await preflightStorage(outputBytes, 'effect');
		state.audacityEffectProcessing = true;
		setStatus(copy.spectralProcessing || copy.audacityProcessing);
		publishDocumentSnapshot();
		try {
			const channels = await renderDryTrackRange(target.track.id, target.startFrame, target.endFrame, target.channelCount);
			const processed = await runSpectralEditWorker(channels, {
				sampleRate: projectSampleRate(),
				startFrame: 0,
				endFrame: target.durationFrames,
				minimumFrequency: frequencyRange.minimumFrequency,
				maximumFrequency: frequencyRange.maximumFrequency,
				windowSize: target.track.spectrogram?.windowSize || 2_048,
				gainDb,
			});
			await persistAudacityEffectResult(target, null, processed, {
				effectName: gainDb === -Infinity ? copy.spectralDelete : copy.spectralAmplify,
				selectionDetails: {
					trackIds: selection.trackIds?.length ? selection.trackIds : [target.track.id],
					clipIds: [],
					frequencyRange,
				},
			});
			setStatus(copy.spectralApplied || copy.audacityApplied, 'success');
			return true;
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	async function runSpectralEditWorker(channels, spectralOptions) {
		if (typeof Worker !== 'function') return applySpectralGain(channels, spectralOptions);
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
			const channels = await renderDryTrackRange(target.track.id, target.startFrame, target.endFrame, target.channelCount);
			const result = await runAudacityEffectWorker({
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
			const result = await runAudacityEffectWorker({
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
		const target = audacityEffectTarget();
		if (!target) throw new Error(copy.audacitySelectionHint);
		const type = state.audacityEffectType;
		const definition = AUDACITY_EFFECT_DEFINITIONS[type];
		const sampleRate = projectSampleRate();
		let params = normalizeAudacityEffectParams(type, currentAudacityEffectParams());
		if (definition.requiresNoiseProfile && !state.audacityNoiseProfile) throw new Error(copy.noiseProfileMissing);
		if (definition.requiresControlTrack && !state.audacityControlTrackId) throw new Error(copy.autoDuckControlTrack);
		const contextFrames = definition.requiresStaffPad
			? sampleRate
			: definition.requiresContext ? 128 : 0;
		const estimatedFrames = estimateAudacityEffectOutputFrames(type, target.durationFrames, params);
		const estimatedOutputBytes = estimatedFrames * target.channelCount * Float32Array.BYTES_PER_ELEMENT;
		const estimatedPeakBytes = estimateAudacityEffectPeakBytes(type, target.durationFrames, params, {
			channelCount: target.channelCount,
			controlChannelCount: definition.requiresControlTrack ? 2 : undefined,
			sampleRate,
			beforeFrames: contextFrames,
			afterFrames: contextFrames,
		});
		if (estimatedPeakBytes > AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES) throw audacityEffectMemoryError(copy);
		await preflightStorage(estimatedOutputBytes, 'effect');
		state.audacityEffectProcessing = true;
		setStatus(copy.audacityProcessing);
		publishDocumentSnapshot();
		try {
			const channels = await renderDryTrackRange(target.track.id, target.startFrame, target.endFrame, target.channelCount);
			params = resolveInteractiveAudacityParams(type, params, channels);
			const effectContext = {};
			if (definition.requiresControlTrack) {
				effectContext.controlChannels = await renderDryTrackRange(state.audacityControlTrackId, target.startFrame, target.endFrame);
			}
			if (definition.requiresNoiseProfile) effectContext.noiseProfile = state.audacityNoiseProfile;
			if (contextFrames > 0) {
				const beforeStart = Math.max(0, target.startFrame - contextFrames);
				const afterEnd = Math.min(projectDurationFrames(project), target.endFrame + contextFrames);
				effectContext.beforeChannels = beforeStart < target.startFrame
					? await renderDryTrackRange(target.track.id, beforeStart, target.startFrame, target.channelCount)
					: channels.map(() => new Float32Array(0));
				effectContext.afterChannels = target.endFrame < afterEnd
					? await renderDryTrackRange(target.track.id, target.endFrame, afterEnd, target.channelCount)
					: channels.map(() => new Float32Array(0));
			}
			const result = await runAudacityEffectWorker({
				operation: 'apply', effectType: type, channels, sampleRate, params, context: effectContext,
			});
			await persistAudacityEffectResult(target, type, result.channels);
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

	async function renderDryTrackRange(trackId, startFrame, endFrame, requestedChannelCount = null) {
		const track = findTrack(project, trackId);
		if (!track) throw new Error(copy.audioTrackNotFound);
		const channelCount = requestedChannelCount ?? (audacitySelectionChannelCount(project, trackId, startFrame, endFrame) || 1);
		const snapshot = cloneProject(project);
		snapshot.tracks = snapshot.tracks
			.filter((candidate) => candidate.id === trackId)
			.map((candidate) => ({ ...candidate, gain: 1, pan: 0, mute: false, solo: false, effects: [] }));
		snapshot.master = { gain: 1, effects: [] };
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

	async function persistAudacityEffectResult(target, type, channels, options = {}) {
		if (!Array.isArray(channels) || !channels.length || channels.length > 2 || !channels[0]?.length) {
			throw new Error(copy.effectInvalidAudio);
		}
		const frameCount = channels[0].length;
		if (!channels.every((channel) => channel instanceof Float32Array && channel.length === frameCount)) {
			throw new Error(copy.effectChannelLengthsMismatch);
		}
		assertAudacityEffectOutput(channels);
		if (channels.length !== target.channelCount) {
			throw new Error(copy.effectChannelLayoutChanged);
		}
		const sampleRate = projectSampleRate();
		const context = await engine.getAudioContext({ resume: false });
		const buffer = await bufferFromChannels(channels, sampleRate, context, copy);
		const sourceId = createStableId('audacity-effect');
		const effectName = options.effectName || audacityEffectLabel(type, copy);
		const sourceName = `${target.track.name} — ${effectName}.wav`;
		const writer = await store.beginSourceWrite(sourceId, { name: sourceName, mimeType: 'audio/wav' });
		try {
			await writeBuffer(writer, buffer);
			await writer.commit({ sampleRate, channelCount: buffer.numberOfChannels });
		} catch (error) {
			await writer.abort();
			throw error;
		}

		const replacement = prepareRangeReplacementCommand(project, {
			trackId: target.track.id,
			startFrame: target.startFrame,
			endFrame: target.endFrame,
			source: {
				id: sourceId,
				storageKey: sourceId,
				name: sourceName,
				mimeType: 'audio/wav',
				frameCount,
				channelCount: buffer.numberOfChannels,
				sampleRate,
				originalSampleRate: sampleRate,
			},
		});
		sourceBuffers.set(sourceId, buffer);
		try {
			const peaks = await generateWaveformPeaks(channels, copy);
			sourcePeaks.set(sourceId, peaks);
			await store.saveAnalysis(peakCacheKey(sourceId), peaks);
			commit({
				type: 'batch',
				commands: [replacement, {
					type: 'selection/set',
					startFrame: target.startFrame,
					endFrame: target.startFrame + frameCount,
					...(options.selectionDetails || {}),
				}],
			}, { selectTrackId: target.track.id, selectClipId: replacement.clipId });
		} catch (error) {
			sourceBuffers.delete(sourceId);
			sourcePeaks.delete(sourceId);
			await store.deleteSource(sourceId);
			throw error;
		}
	}

	async function runAudacityEffectWorker(payload) {
		if (typeof Worker !== 'function') {
			if (payload.operation === 'capture-noise-profile') {
				return { profile: captureAudacityNoiseProfile(payload.channels, payload.sampleRate, payload.params) };
			}
			return { channels: await applyAudacityEffectAsync(payload.effectType, payload.channels, payload.sampleRate, payload.params, payload.context) };
		}
		const worker = new Worker(new URL('./audacity-effects/worker.js', import.meta.url), { type: 'module' });
		state.audacityEffectWorker = worker;
		const transfer = [];
		const message = cloneAudacityWorkerPayload(payload, transfer);
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
		if (state.missingSourceIds.size) throw new Error(copy.localSourcesMissing);
		let snapshot = cloneProject(project);
		if (scope === 'track') {
			const selectedTrack = findTrack(snapshot, state.selectedTrackId);
			if (!selectedTrack || selectedTrack.type === 'label') throw new Error(copy.audioTrackRequired);
			for (const track of snapshot.tracks) {
				if (track.type === 'label') continue;
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
		if (!project.clips.length || state.exportAbort) return;
		if (state.missingSourceIds.size) throw new Error(copy.localSourcesMissing);
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
			state.outputCleanup = outputCleanup;
			pendingCleanup = null;
			state.outputUrl = URL.createObjectURL(blob);
			state.exportOutput = Object.freeze({
				url: state.outputUrl,
				fileName,
				mimeType: blob.type || 'application/octet-stream',
				size: blob.size,
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
		if (state.readOnly || state.recordingStarting || state.recorder) return null;
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
		if (state.recorder || state.recordingStarting) return state.leadInRecording;
		state.leadInRecording = !state.leadInRecording;
		void store.saveSetting('recording-lead-in', state.leadInRecording);
		publishDocumentSnapshot();
		return state.leadInRecording;
	}

	function cancelRecordingStart() {
		if (!state.recordingStarting && !state.recordingStartPromise) return false;
		state.recordingStartGeneration += 1;
		state.recordingStarting = false;
		if (!state.recorder && !state.preferences.recording.retainInputs) recordingCapturePool.releaseAll();
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
		if (state.readOnly || state.recordingStarting || state.recordingStartPromise || state.recorder) return;
		const token = Object.freeze({
			generation: ++state.recordingStartGeneration,
			projectId: project?.id,
		});
		const operation = options.trackId
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
		const track = options.trackId
			? findTrack(project, options.trackId)
			: project.tracks.find((item) => item.armed);
		if (!track) throw new Error(copy.armTrackForRecording);
		state.recordingStarting = true;
		state.recordingFatalError = null;
		publishDocumentSnapshot();
		let stream = null;
		let writer = null;
		let recorder = null;
		try {
			assertRecordingStartActive(token);
			const sampleRate = projectSampleRate();
			// The legacy path still records the active/explicit track from the
			// default input, but reuses that input between takes when retention is on.
			stream = recordingCapturePool.getHardware?.(RECORDING_DEFAULT_DEVICE_ID)
				|| await recordingCapturePool.acquireHardware(RECORDING_DEFAULT_DEVICE_ID, { channelCount: 2, sampleRate });
			assertRecordingStartActive(token);
			syncRecordingPoolSnapshot();
			await beginPlaybackCachePreparation(project);
			assertRecordingStartActive(token);
			const context = await engine.getAudioContext();
			assertRecordingStartActive(token);
			await context.resume();
			assertRecordingStartActive(token);
			const inputTrack = stream.getAudioTracks()[0];
			const trackSettings = inputTrack?.getSettings?.() || {};
			const channelCount = Math.min(2, trackSettings.channelCount || 1);
			const captureSampleRate = context.sampleRate || sampleRate;
			await preflightStorage(captureSampleRate * channelCount * Float32Array.BYTES_PER_ELEMENT * 60, 'recording');
			assertRecordingStartActive(token);
			const sourceId = createStableId('recording');
			writer = await store.beginSourceWrite(sourceId, {
				name: `${copy.recordingLabel} ${new Date().toLocaleTimeString(locale)}`,
				mimeType: 'audio/wav',
				sampleRate: captureSampleRate,
				channelCount,
			});
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
					publishRecordingPreview();
					let peak = 0;
					for (const channel of channels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
					const db = peak > 0 ? 20 * Math.log10(peak) : -60;
					state.inputMeterDb = Math.max(-60, db);
					publishTelemetrySnapshot();
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
			const scheduledTime = context.currentTime + 0.08;
			const leadInFrames = state.leadInRecording
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
			await engine.playAt(scheduledTime, requestedStartFrame - availableLeadInFrames);
			assertRecordingStartActive(token);
			recorder.start({ startFrame: currentContextFrame, stopFrame });
			state.recordingPaused = false;
			setStatus(copy.recording);
			updateTransportState('recording');
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
			if (!state.preferences.recording.retainInputs) recordingCapturePool.releaseHardware(RECORDING_DEFAULT_DEVICE_ID);
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

	async function startRoutedRecording(_options = {}, token) {
		const armedTracks = project.tracks.filter((track) => track.type !== 'label' && track.armed);
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
				const promise = firstRoute.kind === 'display'
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
				if (!state.preferences.recording.retainInputs) recordingCapturePool.releaseAll();
				throw new Error('None of the assigned recording inputs are available.');
			}

			const routedChannelCount = sourceSessions.reduce((total, session) => (
				total + session.routes.reduce((sum, item) => sum + item.route.channelCount, 0)
			), 0);
			await beginPlaybackCachePreparation(project);
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
					const writer = await store.beginSourceWrite(sourceId, {
						name: `${copy.recordingLabel} ${new Date().toLocaleTimeString(locale)}`,
						mimeType: 'audio/wav',
						sampleRate: captureSampleRate,
						channelCount: route.channelCount,
					});
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
						publishRecordingPreview();
						publishTelemetrySnapshot();
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
			const scheduledTime = context.currentTime + 0.08;
			const leadInFrames = state.leadInRecording
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
				for (const entry of session.entries) state.recordingRouteHealth[entry.trackId] = 'recording';
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
				if (!state.preferences.recording.retainInputs) recordingCapturePool.releaseAll();
				syncRecordingPoolSnapshot();
			}
			if (!ownsStart && !state.preferences.recording.retainInputs) recordingCapturePool.releaseAll();
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
				const sourceCommand = createAddSourceCommand({
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
				});
				const buffer = await readStoredAudioBuffer(store, {
					id: entry.sourceId,
					frameCount: frames,
					channelCount: metadata.channelCount || entry.route.channelCount,
					sampleRate: entry.sampleRate,
				}, await engine.getAudioContext());
				sourceBuffers.set(entry.sourceId, buffer);
				const peaks = await generateWaveformPeaks(audioBufferChannels(buffer), copy);
				sourcePeaks.set(entry.sourceId, peaks);
				await store.saveAnalysis(peakCacheKey(entry.sourceId), peaks);
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
			state.inputMeterDb = -60;
			state.inputMeters = {};
			if (!state.preferences.recording.retainInputs || state.recordingReleaseAfterStop) {
				recordingCapturePool.releaseAll();
				state.recordingReleaseAfterStop = false;
			}
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
			if (state.recordingFatalError) throw state.recordingFatalError;
			appendRecordingPreview(state.recordingPreview, state.recordingResampler?.finish?.());
			const frames = writer.framesWritten;
			if (frames <= state.recordingSourceOffsetFrames) { await writer.abort(); return; }
			const projectRate = projectSampleRate();
			const sampleRate = state.recordingSampleRate || projectRate;
			const metadata = await writer.commit({ sampleRate });
			sourceCommitted = true;
			const sourceId = state.recordingSourceId;
			const sourceCommand = createAddSourceCommand({
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
			});
			const buffer = await readStoredAudioBuffer(store, {
				id: sourceId,
				frameCount: frames,
				channelCount: metadata.channelCount || 1,
				sampleRate,
			}, await engine.getAudioContext());
			sourceBuffers.set(sourceId, buffer);
			const peaks = await generateWaveformPeaks(audioBufferChannels(buffer), copy);
			sourcePeaks.set(sourceId, peaks);
			await store.saveAnalysis(peakCacheKey(sourceId), peaks);
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
			state.inputMeterDb = -60;
			state.inputMeters = {};
			if (!state.preferences.recording.retainInputs || state.recordingReleaseAfterStop) {
				recordingCapturePool.releaseAll();
				state.recordingReleaseAfterStop = false;
			}
			syncRecordingPoolSnapshot();
			publishTelemetrySnapshot();
			updateTransportState(engine.getState().state);
			publishDocumentSnapshot();
		}
	}

	function editingBlocked() {
		return Boolean(state.readOnly || state.importing || state.recordingStarting || state.recorder || state.exportAbort || state.audacityEffectProcessing || state.sampleEditProcessing);
	}

	function updatePlayhead(frame = 0, duration = project ? projectDurationFrames(project) : 0) {
		state.positionFrame = Math.max(0, Math.round(Number(frame) || 0));
		state.durationFrames = Math.max(0, Math.round(Number(duration) || 0));
		publishTelemetrySnapshot();
	}

	function updateTransportState(value) {
		state.transportState = value || 'stopped';
		syncMetronome();
		publishTelemetrySnapshot();
	}

	function updateMeters(meters) {
		state.meters = meters || { tracks: {}, master: null };
		publishTelemetrySnapshot();
	}

	function updateZoom(action, requestedViewportWidth) {
		if (action === 'fit') {
			const viewport = Math.max(320, Number(requestedViewportWidth) || 960);
			state.pixelsPerSecond = Math.max(1, viewport / (editorTimelineDurationFrames(project, projectSampleRate()) / projectSampleRate()));
		} else state.pixelsPerSecond = Math.max(1, Math.min(MAX_PIXELS_PER_SECOND, state.pixelsPerSecond * (action === 'in' ? 2 : 0.5)));
		if (!sampleEditingAvailable()) state.sampleEditMode = null;
		publishProjectState();
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

async function writeBuffer(writer, buffer) {
	for (let start = 0; start < buffer.length; start += SOURCE_CHUNK_FRAMES) {
		const end = Math.min(buffer.length, start + SOURCE_CHUNK_FRAMES);
		await writer.write(Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel).slice(start, end)));
	}
}

async function readStoredAudioBuffer(store, source, context) {
	if (!context?.createBuffer) return null;
	return store.loadSourceAudioBuffer(source.id, context);
}

function isLongStoredSource(source, metadata) {
	if (!metadata || typeof metadata !== 'object') return false;
	if (typeof metadata.id !== 'string' || typeof source?.id !== 'string') return false;
	if (!Number.isSafeInteger(source.frameCount) || !Number.isSafeInteger(source.channelCount)) return false;
	if (source.frameCount * source.channelCount * Float32Array.BYTES_PER_ELEMENT <= SHORT_SOURCE_AUDIO_BUFFER_MAX_BYTES) return false;
	if (source.chunkFrames !== SOURCE_CHUNK_FRAMES
		|| (metadata.chunkFrames != null && metadata.chunkFrames !== SOURCE_CHUNK_FRAMES)) return false;
	if (metadata.frameCount !== source.frameCount || metadata.channelCount !== source.channelCount) return false;
	if (metadata.sampleRate != null && metadata.sampleRate !== source.sampleRate) return false;
	return metadata.chunkCount === Math.ceil(source.frameCount / SOURCE_CHUNK_FRAMES);
}

function createStoredChunkProvider(store, source) {
	if (typeof store.readSourceChunk !== 'function') throw new TypeError('The project store cannot demand-load source chunks.');
	const sourceId = source.storageKey || source.id;
	return Object.freeze({
		channelCount: source.channelCount,
		frameCount: source.frameCount,
		chunkFrames: SOURCE_CHUNK_FRAMES,
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
		return { version: 1, levels: message.levels };
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
			}
		}
		frameOffset += chunk.frames;
	}
	if (frameOffset !== source.frameCount) throw new Error('The stored audio source frame count does not match its metadata.');
	return { version: 1, levels };
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
		return { version: 1, levels: message.levels };
	} finally {
		worker.terminate();
	}
}
function generateWaveformPeaksFallback(channels) {
	const blockSizes = [64, 256, 1_024, 4_096, 16_384, 65_536];
	return {
		version: 1,
		levels: blockSizes.map((blockSize) => {
			const count = Math.ceil((channels[0]?.length || 0) / blockSize);
			const minimums = new Float32Array(count);
			const maximums = new Float32Array(count);
			for (let block = 0; block < count; block += 1) {
				let minimum = 1;
				let maximum = -1;
				for (let frame = block * blockSize; frame < Math.min(channels[0].length, (block + 1) * blockSize); frame += 1) {
					let sample = 0;
					for (const channel of channels) sample += channel[frame] / channels.length;
					minimum = Math.min(minimum, sample);
					maximum = Math.max(maximum, sample);
				}
				minimums[block] = minimum;
				maximums[block] = maximum;
			}
			return { blockSize, minimums, maximums };
		}),
	};
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

function scaleRecordingFrames(frameCount, inputSampleRate, outputSampleRate) {
	const frames = Math.max(0, Math.floor(Number(frameCount) || 0));
	const inputRate = Math.max(1, Math.floor(Number(inputSampleRate) || AUDIO_EDITOR_SAMPLE_RATE));
	const outputRate = Math.max(1, Math.floor(Number(outputSampleRate) || AUDIO_EDITOR_SAMPLE_RATE));
	return Math.max(0, Math.round(frames * outputRate / inputRate));
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
async function saveLabelExport(result, customSaver) {
	const blob = new Blob([result.text], { type: result.mimeType });
	if (typeof customSaver === 'function') return customSaver({ ...result, blob });
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
