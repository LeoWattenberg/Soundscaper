/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioTrackLike } from './recording-model.ts';
import type { RoutedInputLoudnessMeter } from './recording-transaction-types.ts';

export interface RecordingDeviceRoute {
	readonly kind: 'device';
	readonly deviceId: string;
	readonly channelStart: number;
	readonly channelCount: number;
}

export interface RecordingRouteLike {
	readonly kind?: string;
	readonly deviceId?: string;
	readonly channelStart?: number;
	readonly channelCount?: number;
}

export interface MicrophoneMeterState {
	disposed: boolean;
	microphoneMetering: boolean;
	recorder: Readonly<{ setInputGain?(value: number): void }> | null;
	recordingStarting: boolean;
	timedRecordingPreparing: boolean;
	timedRecording: unknown;
	readonly preferences: Readonly<{ recording: Readonly<{ retainInputs: boolean }> }>;
	recordingInputGain: number;
	transportState: string;
	inputLoudnessMeasurementManuallyPaused: boolean;
	inputLoudnessMeasurementExplicitlyRunning: boolean;
	inputMeterDb: number;
	inputMeter: unknown;
	selectedTrackId: string | null;
	recordingRouting: Readonly<{ routes: Readonly<Record<string, RecordingRouteLike | null | undefined>> }>;
}

export interface AudioTrackPort extends AudioTrackLike {
	addEventListener?(type: 'ended', listener: () => void): void;
	removeEventListener?(type: 'ended', listener: () => void): void;
}

export interface MeterMediaStream {
	getAudioTracks?(): readonly AudioTrackPort[];
}

export interface AudioNodePort {
	connect?(destination: AudioNodePort, output?: number, input?: number): unknown;
	disconnect?(): void;
}

export interface AnalyserNodePort extends AudioNodePort {
	fftSize: number;
	smoothingTimeConstant: number;
	getFloatTimeDomainData(target: Float32Array): void;
}

export interface MeterAudioContext {
	readonly destination: AudioNodePort;
	createMediaStreamSource(stream: MeterMediaStream): AudioNodePort;
	createAnalyser(): AnalyserNodePort;
	createChannelSplitter?(channelCount: number): AudioNodePort;
	createChannelMerger?(channelCount: number): AudioNodePort;
}

export interface InputLoudnessMeter {
	setRunning(running: boolean): void;
	setInputGain(value: number): void;
	reset(): void;
	requestSnapshot?(): void;
	snapshot?(): unknown;
	dispose?(): void;
}

export interface NodeLoudnessMeter extends InputLoudnessMeter {
	readonly node: AudioNodePort;
}

export interface MicrophoneMeterSession {
	readonly analysers: readonly AnalyserNodePort[];
	readonly deviceId: string;
	readonly disconnectSource: () => void;
	readonly endedListeners: readonly (() => void)[];
	interval: unknown;
	readonly loudnessMeter: NodeLoudnessMeter | null;
	readonly merger: AudioNodePort | null;
	readonly routeKey: string;
	readonly source: AudioNodePort;
	readonly splitter: AudioNodePort | null;
	readonly stream: MeterMediaStream;
}

export interface RecordingCapturePoolPort {
	getHardware?(deviceId: string): MeterMediaStream | null | undefined;
	acquireHardware(
		deviceId: string,
		options: Readonly<{ channelCount: number; sampleRate: number }>,
	): Promise<MeterMediaStream>;
	releaseHardware(deviceId: string): void;
}

export interface LoudnessMeterOptions {
	readonly channelCount: number;
	readonly inputGain: number;
	readonly passthrough: false;
	readonly running: boolean;
	readonly onMeter: (reading: unknown) => void;
}

export interface MicrophoneMeterDependencies {
	readonly state: MicrophoneMeterState;
	readonly defaultDeviceId: string;
	readonly recordingCapturePool: RecordingCapturePoolPort;
	getAudioContext(): Promise<MeterAudioContext>;
	createLoudnessMeterNode(
		context: MeterAudioContext,
		options: LoudnessMeterOptions,
	): Promise<NodeLoudnessMeter>;
	streamAudioChannelCount(stream: MeterMediaStream): number;
	projectSampleRate(): number;
	persistSetting(key: string, value: unknown): Promise<unknown> | unknown;
	publishDocumentSnapshot(): void;
	publishTelemetrySnapshot(): void;
	syncRecordingPoolSnapshot(): void;
	handleError(error: unknown): void;
	scheduleInterval(callback: () => void, milliseconds: number): unknown;
	clearInterval(identifier: unknown): void;
	readonly playbackLoudness?: Readonly<{
		pause?(): void;
		continue?(): void;
		reset?(): void;
	}>;
}

export interface MicrophoneMeterService {
	getSession(): MicrophoneMeterSession | null;
	getRoutedLoudnessMeter(): RoutedInputLoudnessMeter | null;
	getRoutedLoudnessMeterKey(): string | null;
	setRoutedLoudnessMeter(meter: RoutedInputLoudnessMeter | null, key?: string | null): void;
	clearRoutedLoudnessMeter(): void;
	getRoute(): RecordingDeviceRoute;
	getRouteKey(route?: RecordingDeviceRoute): string;
	getDeviceId(): string;
	getGeneration(): number;
	invalidate(): number;
	isGeneration(generation: number): boolean;
	setMicrophoneMetering(enabled: unknown): Promise<boolean>;
	startMicrophoneMetering(options?: Readonly<{ force?: boolean }>): Promise<boolean>;
	stopMicrophoneMetering(options?: Readonly<{ releaseInput?: boolean; preserveReading?: boolean }>): void;
	reconcileInput(options?: Readonly<{ endedSession?: MicrophoneMeterSession | null }>): boolean;
	synchronizeTarget(): boolean;
	pauseLoudnessMeasurement(kind?: string): boolean;
	continueLoudnessMeasurement(kind?: string): boolean;
	resetLoudnessMeasurement(kind?: string): boolean;
	setRecordingInputGain(value: unknown, normalize: (value: unknown) => number): number;
	dispose(): void;
}
