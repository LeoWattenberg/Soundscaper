/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	RecordingCaptureMutableState,
	RecordingControllerFactoryOptions,
	RecordingMediaStream,
	RecordingProject,
	RecordingSelection,
	RecordingSourceWriter,
	RoutedRecordingCaptureRuntime,
} from '../../src/common/editor/controller/recording-transaction-types.ts';
import type {
	RecordingCaptureControllerLike,
	RecordingStartScope,
	RoutedRecordingController,
} from '../../src/common/editor/controller/recording-session-service.ts';
import type { RecordingPreview } from '../../src/common/editor/controller/recording-model.ts';

export function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function createPreview(trackId: string, startFrame: number): RecordingPreview {
	return {
		trackId,
		startFrame,
		framesToSkip: 0,
		frames: 0,
		framesPerBucket: 64,
		bucketFrames: 0,
		minimums: [1],
		maximums: [-1],
		buckets: [[]],
	};
}

function createStream(channelCount = 2): RecordingMediaStream {
	const track = {
		readyState: 'live',
		getSettings: () => ({ channelCount, latency: 0 }),
		addEventListener: () => {},
		removeEventListener: () => {},
	};
	return {
		getAudioTracks: () => [track],
		getTracks: () => [track],
		getVideoTracks: () => [track],
	};
}

function createState(): RecordingCaptureMutableState {
	return {
		readOnly: false,
		recordingStarting: false,
		recordingStartGeneration: 1,
		recorder: null,
		recordingFatalError: null,
		recordingDiscardRequested: false,
		recordingFinishing: false,
		recordingPaused: false,
		recordingStartFrame: 0,
		recordingSourceOffsetFrames: 0,
		recordingPreview: null,
		recordingPreviews: [],
		recordingPreviewLastPublishedAt: 0,
		recordingWriter: null,
		recordingStream: null,
		recordingSourceId: null,
		recordingTrackId: null,
		recordingSelection: null,
		recordingResampler: null,
		recordingSampleRate: null,
		recordingCleanup: null,
		latencyOffsetMs: 0,
		monitoring: false,
		recordingInputGain: 1,
		leadInRecording: false,
		inputMeterDb: -60,
		inputMeters: {},
		inputMeter: null,
		selectedTrackId: 'track-1',
		recordingRouting: { routes: {}, offsets: {} },
		recordingRouteHealth: {},
		recordingEntries: null,
	};
}

export function createScope(current: () => boolean): RecordingStartScope {
	return Object.freeze({
		generation: 1,
		projectId: 'project-1',
		assertCurrent() {
			if (!current()) throw new DOMException('Recording superseded.', 'AbortError');
		},
	});
}

interface RuntimeOptions {
	readonly acquireHardware?: () => Promise<RecordingMediaStream>;
	readonly acquireDisplay?: () => Promise<RecordingMediaStream>;
	readonly createRecorder?: (
		options: RecordingControllerFactoryOptions,
	) => Promise<RecordingCaptureControllerLike>;
	readonly selection?: RecordingSelection | null;
	readonly playAt?: () => Promise<unknown>;
	readonly streamIsLive?: () => boolean;
}

export function createRecordingCaptureFixture(options: RuntimeOptions = {}) {
	const state = createState();
	const project: RecordingProject = {
		id: 'project-1',
		tracks: [
			{ id: 'track-1', type: 'audio', armed: true },
			{ id: 'track-2', type: 'audio', armed: true },
		],
		tempo: { bpm: 120, timeSignature: { numerator: 4 } },
	};
	const stream = createStream();
	const writer: RecordingSourceWriter = {
		framesWritten: 0,
		async write() {},
		async commit() { return { name: 'Take', channelCount: 1 }; },
		async abort() {},
	};
	let recorderOptions: RecordingControllerFactoryOptions | null = null;
	let releases = 0;
	let publishes = 0;
	let recorderCreations = 0;
	let hardwareRequests = 0;
	let displayRequests = 0;
	let stopCalls = 0;
	let finalizeCalls = 0;
	let previewPublishes = 0;
	let startCalls = 0;
	const errors: unknown[] = [];
	let loudnessMeter: ReturnType<RoutedRecordingCaptureRuntime['createLoudnessMeter']> | null = null;
	let loudnessMeterKey: string | null = null;
	const routedController: RoutedRecordingController = {
		state: 'ready',
		start: () => { startCalls += 1; },
		pause: () => true,
		resume: () => true,
		stop: async () => {},
		dispose: async () => {},
		setMonitoring: () => {},
		setInputGain: () => {},
	};
	const runtime: RoutedRecordingCaptureRuntime = {
		state,
		engine: {
			getAudioContext: async () => ({
				sampleRate: 48_000,
				currentTime: 4,
				state: 'running',
				resume: async () => {},
			}),
			getPositionFrames: () => 100,
			setLoop: () => {},
			seek: () => {},
			playAt: options.playAt || (async () => {}),
			pause: () => {},
		},
		capturePool: {
			acquireHardware: async () => {
				hardwareRequests += 1;
				return options.acquireHardware?.() || stream;
			},
			acquireDisplay: async () => {
				displayRequests += 1;
				return options.acquireDisplay?.() || stream;
			},
		},
		defaultDeviceId: 'default',
		sourceChunkFrames: 65_536,
		messages: {
			armTrack: 'Arm a track.',
			preparedInputClosed: 'Prepared input closed.',
			recording: 'Recording',
			recordingLabel: 'Recording',
			timedRecordingPast: 'Past',
			assignInput: 'Assign an input.',
			noInputsAvailable: 'No inputs.',
		},
		getProject: () => project,
		findTrack: (target, trackId) => target.tracks.find((track) => track.id === trackId) || null,
		projectSampleRate: () => 48_000,
		activeSelection: () => options.selection || null,
		beginPlaybackCachePreparation: async () => {},
		currentTimeMs: () => 1_000,
		createStableId: () => 'source-1',
		createRecordingName: () => 'Recording 10:00',
		openSourceWriter: async () => writer,
		createPreview: ({ trackId, startFrame }) => createPreview(trackId, startFrame),
		createPreviewResampler: () => ({ push: (channels) => channels, finish: () => [] }),
		appendPreview: () => {},
		scaleFrames: (frames) => frames,
		streamAudioChannelCount: (mediaStream) => mediaStream.getAudioTracks()[0]?.getSettings?.().channelCount || 1,
		recordingStreamIsLive: () => options.streamIsLive?.() ?? true,
		createRecorder: async (factoryOptions) => {
			recorderCreations += 1;
			recorderOptions = factoryOptions;
			if (options.createRecorder) return options.createRecorder(factoryOptions);
			return {
				state: 'ready',
				start: () => { startCalls += 1; },
				pause: () => true,
				resume: () => true,
				stop: async () => {},
				dispose: async () => {},
				setMonitoring: () => {},
				setInputGain: () => {},
			};
		},
		preflightStorage: async () => {},
		startMicrophoneMetering: async () => {},
		syncRecordingPoolSnapshot: () => {},
		releaseUnretainedRecordingInputs: () => { releases += 1; },
		publishDocumentSnapshot: () => { publishes += 1; },
		publishRecordingPreview: () => { previewPublishes += 1; },
		updatePlayhead: () => {},
		stopRecording: async () => { stopCalls += 1; },
		finalizeRecording: async () => { finalizeCalls += 1; },
		handleError: (error) => { errors.push(error); },
		setStatus: () => {},
		updateTransportState: () => {},
		recordingRouteSourceKey: (route) => route.kind === 'display' ? 'display' : `device:${route.deviceId}`,
		createRoutedController: () => routedController,
		createLoudnessMeter: () => ({
			push: (_channels, publish) => publish({ dbfs: -12 }),
			snapshot: () => ({ dbfs: -60 }),
		}),
		getLoudnessMeter: () => ({ meter: loudnessMeter, key: loudnessMeterKey }),
		setLoudnessMeter: (meter, key) => {
			loudnessMeter = meter;
			loudnessMeterKey = key;
		},
	};
	return {
		runtime,
		state,
		project,
		stream,
		releases: () => releases,
		publishes: () => publishes,
		recorderCreations: () => recorderCreations,
		recorderOptions: () => recorderOptions,
		hardwareRequests: () => hardwareRequests,
		displayRequests: () => displayRequests,
		stopCalls: () => stopCalls,
		finalizeCalls: () => finalizeCalls,
		previewPublishes: () => previewPublishes,
		startCalls: () => startCalls,
		errors,
	};
}
