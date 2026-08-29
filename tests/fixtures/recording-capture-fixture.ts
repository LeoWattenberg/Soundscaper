/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	RecordingCaptureMutableState,
	RecordingControllerFactoryOptions,
	RecordingMediaStream,
	RecordingProject,
	RecordingSelection,
	RecordingSoundActivationSource,
	RecordingSourceWriter,
	RoutedRecordingCaptureRuntime,
} from '../../src/common/editor/controller/recording-transaction-types.ts';
import type {
	RecordingCaptureControllerLike,
	RecordingStartScope,
} from '../../src/common/editor/controller/recording-session-service.ts';
import { createRoutedRecordingController } from '../../src/common/editor/controller/recording-session-service.ts';
import type { RecordingPreview } from '../../src/common/editor/controller/recording-model.ts';
import type {
	SoundActivationGateState,
	SoundActivationSettings,
} from '../../src/common/editor/controller/sound-activated-recording-gate.ts';

export function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

function createPreview(trackId: string, startFrame: number, framesToSkip = 0): RecordingPreview {
	return {
		trackId,
		startFrame,
		framesToSkip,
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
	readonly createLoudnessMeter?: RoutedRecordingCaptureRuntime['createLoudnessMeter'];
	readonly createRecorder?: (
		options: RecordingControllerFactoryOptions,
	) => Promise<RecordingCaptureControllerLike>;
	readonly selection?: RecordingSelection | null;
	readonly playAt?: (scheduledTime: number, startFrame: number) => Promise<number | void>;
	readonly streamIsLive?: () => boolean;
	readonly soundActivationSettings?: SoundActivationSettings | null;
	readonly streamChannelCount?: number;
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
		tempoMap: {
			mode: 'musical',
			events: [{ id: 'tempo-1', beat: { num: 0, den: 1 }, bpm: { num: 120, den: 1 } }],
		},
		signatureMap: {
			events: [{ id: 'signature-1', bar: 0, numerator: 4, denominator: 4 }],
		},
	};
	const stream = createStream(options.streamChannelCount);
	let recorderOptions: RecordingControllerFactoryOptions | null = null;
	const recorderOptionsList: RecordingControllerFactoryOptions[] = [];
	const recorderStartOptions: Array<Readonly<{ startFrame?: number; stopFrame?: number }> | undefined> = [];
	const writerRecords: Array<Readonly<{
		sourceId: string;
		writes: Float32Array[][];
		writer: RecordingSourceWriter;
	}>> = [];
	const previewSegments: Array<Readonly<{ trackId: string; channels: Float32Array[] }>> = [];
	const soundActivationStates: Array<Readonly<{
		source: RecordingSoundActivationSource;
		state: SoundActivationGateState;
	}>> = [];
	let releases = 0;
	let publishes = 0;
	let recorderCreations = 0;
	let hardwareRequests = 0;
	let displayRequests = 0;
	let stopCalls = 0;
	let finalizeCalls = 0;
	let previewPublishes = 0;
	let startCalls = 0;
	let stableId = 0;
	const seekCalls: number[] = [];
	const playAtCalls: number[][] = [];
	const errors: unknown[] = [];
	let loudnessMeter: ReturnType<RoutedRecordingCaptureRuntime['createLoudnessMeter']> | null = null;
	let loudnessMeterKey: string | null = null;
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
			seek: (frame) => { seekCalls.push(frame); },
			playAt: async (scheduledTime, startFrame) => {
				playAtCalls.push([scheduledTime, startFrame]);
				return options.playAt?.(scheduledTime, startFrame);
			},
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
		soundActivation: options.soundActivationSettings === undefined ? undefined : {
			getSettings: () => options.soundActivationSettings ?? null,
			setState: (source, activationState) => {
				soundActivationStates.push(Object.freeze({
					source: Object.freeze({ ...source }),
					state: activationState,
				}));
			},
		},
		getProject: () => project,
		findTrack: (target, trackId) => target.tracks.find((track) => track.id === trackId) || null,
		projectSampleRate: () => 48_000,
		activeSelection: () => options.selection || null,
		beginPlaybackCachePreparation: async () => {},
		currentTimeMs: () => 1_000,
		createStableId: () => `source-${++stableId}`,
		createRecordingName: () => 'Recording 10:00',
		openSourceWriter: async (sourceId) => {
			let framesWritten = 0;
			const writes: Float32Array[][] = [];
			const writer: RecordingSourceWriter = {
				get framesWritten() { return framesWritten; },
				async write(channels) {
					const copy = channels.map((channel) => channel.slice());
					writes.push(copy);
					framesWritten += copy[0]?.length || 0;
				},
				async commit() { return { name: 'Take', channelCount: writes[0]?.length || 1 }; },
				async abort() {},
			};
			writerRecords.push(Object.freeze({ sourceId, writes, writer }));
			return writer;
		},
		createPreview: ({ trackId, startFrame, framesToSkip }) => createPreview(
			trackId,
			startFrame,
			framesToSkip,
		),
		createPreviewResampler: () => ({ push: (channels) => channels, finish: () => [] }),
		appendPreview: (preview, channels) => {
			previewSegments.push(Object.freeze({
				trackId: preview.trackId,
				channels: channels.map((channel) => channel.slice()),
			}));
		},
		scaleFrames: (frames) => frames,
		streamAudioChannelCount: (mediaStream) => mediaStream.getAudioTracks()[0]?.getSettings?.().channelCount || 1,
		recordingStreamIsLive: () => options.streamIsLive?.() ?? true,
		createRecorder: async (factoryOptions) => {
			recorderCreations += 1;
			recorderOptions = factoryOptions;
			recorderOptionsList.push(factoryOptions);
			if (options.createRecorder) return options.createRecorder(factoryOptions);
			let controllerState = 'ready';
			return {
				get state() { return controllerState; },
				start: (startOptions) => {
					controllerState = 'recording';
					startCalls += 1;
					recorderStartOptions.push(startOptions);
				},
				pause: () => {
					if (controllerState !== 'recording') return false;
					controllerState = 'paused';
					return true;
				},
				resume: () => {
					if (controllerState !== 'paused') return false;
					controllerState = 'recording';
					return true;
				},
				stop: async () => { controllerState = 'stopped'; },
				dispose: async () => { controllerState = 'disposed'; },
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
		createRoutedController: (sessions) => createRoutedRecordingController(sessions),
		createLoudnessMeter: options.createLoudnessMeter ?? (() => ({
			push: (_channels, publish) => publish({ dbfs: -12 }),
			snapshot: () => ({ dbfs: -60 }),
		})),
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
		recorderOptionsList,
		recorderStartOptions,
		writerRecords,
		previewSegments,
		soundActivationStates,
		hardwareRequests: () => hardwareRequests,
		displayRequests: () => displayRequests,
		stopCalls: () => stopCalls,
		finalizeCalls: () => finalizeCalls,
		previewPublishes: () => previewPublishes,
		startCalls: () => startCalls,
		seekCalls,
		playAtCalls,
		errors,
	};
}
