/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	RecordingCaptureControllerLike,
	RecordingControllerLike,
	RecordingStartOptions,
	RecordingStartScope,
	RoutedRecordingController,
} from './recording-session-service.ts';
import type { RecordingPreview } from './recording-model.ts';

export type MaybePromise<T> = T | PromiseLike<T>;

export interface RecordingSelection {
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface RecordingTrack extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly type?: string;
	readonly armed?: boolean;
}

export interface RecordingProject extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly tracks: readonly RecordingTrack[];
	readonly sampleRate?: number;
	readonly selection?: RecordingSelection | null;
	readonly tempo?: Readonly<{
		readonly bpm?: number;
		readonly timeSignature?: Readonly<{ readonly numerator?: number; readonly denominator?: number }>;
	}>;
}

export interface RecordingRoute {
	readonly kind: 'device' | 'display';
	readonly deviceId: string;
	readonly channelStart: number;
	readonly channelCount: number;
}

export interface RecordingMediaTrack {
	readonly readyState?: string;
	getSettings?(): Readonly<{ readonly channelCount?: number; readonly latency?: number }>;
	addEventListener?(type: 'ended', listener: () => void, options?: AddEventListenerOptions): void;
	removeEventListener?(type: 'ended', listener: () => void): void;
}

export interface RecordingMediaStream {
	getAudioTracks(): readonly RecordingMediaTrack[];
	getTracks?(): readonly RecordingMediaTrack[];
	getVideoTracks?(): readonly RecordingMediaTrack[];
}

export interface RecordingAudioContext {
	readonly sampleRate: number;
	readonly currentTime: number;
	readonly baseLatency?: number;
	readonly outputLatency?: number;
	readonly state?: string;
	resume(): Promise<void>;
	addEventListener?(type: 'statechange', listener: () => void): void;
	removeEventListener?(type: 'statechange', listener: () => void): void;
}

export interface RecordingPreviewResampler {
	push(channels: readonly Float32Array[]): readonly Float32Array[];
	finish?(): readonly Float32Array[];
}

export interface RecordingSourceMetadata extends Readonly<Record<string, unknown>> {
	readonly name: string;
	readonly channelCount?: number;
}

export interface RecordingSourceWriter {
	readonly framesWritten: number;
	write(channels: readonly Float32Array[]): MaybePromise<unknown>;
	commit(metadata?: Readonly<Record<string, unknown>>): Promise<RecordingSourceMetadata>;
	abort(reason?: unknown): Promise<unknown>;
}

export interface RecordingControllerFactoryOptions {
	readonly context: RecordingAudioContext;
	readonly stream: RecordingMediaStream;
	readonly channelCount: number;
	readonly discreteChannels?: boolean;
	readonly monitor: boolean;
	readonly inputGain: number;
	readonly onChunk: (chunk: Readonly<{ readonly channels: readonly Float32Array[] }>) => Promise<void>;
	readonly onError: (error: unknown) => void;
	readonly onState: (state: string) => void;
}

export type RecordingControllerFactory = (
	options: RecordingControllerFactoryOptions,
) => Promise<RecordingCaptureControllerLike>;

export interface RecordingCapturePool {
	getHardware?(deviceId: string): RecordingMediaStream | null;
	getDisplay?(): RecordingMediaStream | null;
	acquireHardware(
		deviceId: string,
		options: Readonly<{ readonly channelCount: number; readonly sampleRate: number }>,
	): Promise<RecordingMediaStream>;
	acquireDisplay(): Promise<RecordingMediaStream>;
}

export interface RecordingEnginePort {
	getAudioContext(): Promise<RecordingAudioContext>;
	getPositionFrames(): number;
	setLoop(enabled: boolean): void;
	seek(frame: number): void;
	playAt(contextTime: number, frame: number): Promise<unknown>;
	pause(): void;
}

export interface RecordingCaptureMutableState {
	readOnly: boolean;
	recordingStarting: boolean;
	recordingStartGeneration: number;
	recorder: RecordingControllerLike | null;
	recordingFatalError: unknown;
	recordingDiscardRequested: boolean;
	recordingFinishing: boolean;
	recordingPaused: boolean;
	recordingStartFrame: number;
	recordingSourceOffsetFrames: number;
	recordingPreview: RecordingPreview | null;
	recordingPreviews: RecordingPreview[];
	recordingPreviewLastPublishedAt: number;
	recordingWriter: RecordingSourceWriter | null;
	recordingStream: RecordingMediaStream | null;
	recordingSourceId: string | null;
	recordingTrackId: string | null;
	recordingSelection: RecordingSelection | null;
	recordingResampler: RecordingPreviewResampler | null;
	recordingSampleRate: number | null;
	recordingCleanup: (() => void) | null;
	latencyOffsetMs: number;
	monitoring: boolean;
	recordingInputGain: number;
	leadInRecording: boolean;
	inputMeterDb: number;
	inputMeters: Record<string, number>;
	inputMeter: unknown;
	selectedTrackId: string | null;
	recordingRouting: Readonly<{
		readonly routes: Readonly<Record<string, RecordingRoute>>;
		readonly offsets: Readonly<Record<string, number>>;
	}>;
	recordingRouteHealth: Record<string, string>;
	recordingEntries: readonly RoutedRecordingEntry[] | null;
}

export interface RoutedRecordingEntry {
	readonly trackId: string;
	readonly route: RecordingRoute;
	readonly sourceKey: string;
	readonly sourceId: string;
	readonly writer: RecordingSourceWriter;
	readonly previewResampler: RecordingPreviewResampler;
	readonly preview: RecordingPreview;
	readonly sampleRate: number;
	readonly selection: RecordingSelection | null;
	readonly recordingStartFrame: number;
	readonly sourceOffsetFrames: number;
	readonly sourceOffsetProjectFrames: number;
}

export interface RoutedRecordingSourceSession {
	readonly sourceKey: string;
	readonly kind: 'device' | 'display';
	readonly stream: RecordingMediaStream;
	readonly inputTrack: RecordingMediaTrack | undefined;
	readonly channelCount: number;
	readonly routes: readonly RoutedTrackRoute[];
	readonly entries: RoutedRecordingEntry[];
	controller: RecordingCaptureControllerLike | null;
	stopped: boolean;
	disconnected: boolean;
	failed?: boolean;
	listeners: Array<() => void>;
	latencyFrames?: number;
	recordingStartFrame?: number;
	sourceOffsetProjectFrames?: number;
	sourceOffsetFrames?: number;
	startFrame?: number;
	stopFrame?: number;
}

export interface RoutedTrackRoute {
	readonly track: RecordingTrack;
	readonly route: RecordingRoute;
	readonly sourceKey: string;
}

export interface RoutedInputLoudnessMeter {
	push(channels: readonly Float32Array[], publish: (reading: Readonly<{ readonly dbfs?: number }>) => void): void;
	snapshot(): unknown;
}

export interface RecordingCaptureMessages {
	readonly armTrack: string;
	readonly preparedInputClosed: string;
	readonly recording: string;
	readonly recordingLabel: string;
	readonly timedRecordingPast: string;
	readonly assignInput: string;
	readonly noInputsAvailable: string;
}

export interface RecordingCaptureCommonRuntime {
	readonly state: RecordingCaptureMutableState;
	readonly engine: RecordingEnginePort;
	readonly capturePool: RecordingCapturePool;
	readonly defaultDeviceId: string;
	readonly sourceChunkFrames: number;
	readonly messages: RecordingCaptureMessages;
	readonly getProject: () => RecordingProject;
	readonly findTrack: (project: RecordingProject, trackId: string) => RecordingTrack | null;
	readonly projectSampleRate: (project: RecordingProject) => number;
	readonly activeSelection: (project: RecordingProject) => RecordingSelection | null;
	readonly beginPlaybackCachePreparation: (project: RecordingProject) => Promise<unknown>;
	readonly currentTimeMs: () => number;
	readonly createStableId: (prefix: string) => string;
	readonly createRecordingName: () => string;
	readonly openSourceWriter: (
		sourceId: string,
		metadata: Readonly<Record<string, unknown>>,
	) => Promise<RecordingSourceWriter>;
	readonly createPreview: (options: Readonly<{
		readonly trackId: string;
		readonly startFrame: number;
		readonly channelCount: number;
		readonly framesToSkip: number;
	}>) => RecordingPreview;
	readonly createPreviewResampler: (
		inputSampleRate: number,
		outputSampleRate: number,
		channelCount: number,
	) => RecordingPreviewResampler;
	readonly appendPreview: (preview: RecordingPreview, channels: readonly Float32Array[]) => void;
	readonly scaleFrames: (frames: number, inputRate: number, outputRate: number) => number;
	readonly streamAudioChannelCount: (stream: RecordingMediaStream) => number;
	readonly recordingStreamIsLive: (stream: RecordingMediaStream, kind: string) => boolean;
	readonly createRecorder: RecordingControllerFactory;
	readonly preflightStorage: (requiredBytes: number, operation: 'recording') => Promise<void>;
	readonly startMicrophoneMetering: () => Promise<unknown>;
	readonly syncRecordingPoolSnapshot: () => void;
	readonly releaseUnretainedRecordingInputs: () => void;
	readonly publishDocumentSnapshot: () => void;
	readonly publishRecordingPreview: () => void;
	readonly updatePlayhead: () => void;
	readonly stopRecording: () => Promise<unknown>;
	readonly finalizeRecording: () => Promise<void>;
	readonly handleError: (error: unknown) => void;
	readonly setStatus: (message: string) => void;
	readonly updateTransportState: (state: string) => void;
}

export interface RoutedRecordingCaptureRuntime extends RecordingCaptureCommonRuntime {
	readonly recordingRouteSourceKey: (route: RecordingRoute) => string;
	readonly createRoutedController: (
		sessions: readonly (RoutedRecordingSourceSession & { readonly controller: RecordingCaptureControllerLike })[],
	) => RoutedRecordingController;
	readonly createLoudnessMeter: (options: Readonly<{
		readonly sampleRate: number;
		readonly channelCount: number;
	}>) => RoutedInputLoudnessMeter;
	readonly getLoudnessMeter: () => Readonly<{ meter: RoutedInputLoudnessMeter | null; key: string | null }>;
	readonly setLoudnessMeter: (meter: RoutedInputLoudnessMeter, key: string) => void;
}

export type { RecordingStartOptions, RecordingStartScope };
