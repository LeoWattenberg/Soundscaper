/* SPDX-License-Identifier: AGPL-3.0-only */

import { createRecordingController } from '../recording.js';
import { createFramescaperBrowserAudioProcessorRecorder } from './framescaper-browser-audio-processor-recorder.ts';
import { createFramescaperCapturePcmFrameMapper } from './framescaper-capture-pcm-frame-mapper.ts';
import type { CapturePcmChunk } from './framescaper-capture-pcm-packetizer.ts';
const CAPTURE_AUDIO_CHANNEL_COUNT_MAXIMUM = 32;
const CAPTURE_AUDIO_SAMPLE_RATE_MAXIMUM = 768_000;
const CAPTURE_AUDIO_CHUNK_FRAMES_DEFAULT = 4_096;
const CAPTURE_AUDIO_CHUNK_FRAMES_MINIMUM = 128;
const CAPTURE_AUDIO_CHUNK_FRAMES_MAXIMUM = 16_384;
const CAPTURE_AUDIO_PENDING_CHUNKS_DEFAULT = 32;
const CAPTURE_AUDIO_PENDING_CHUNKS_MAXIMUM = 128;
export type FramescaperCaptureAudioRole = 'microphone' | 'system-audio';
export type FramescaperCaptureAudioRecorderBackend = 'track-processor' | 'audio-worklet';
export type FramescaperCaptureAudioRecorderState =
	| 'ready'
	| 'recording'
	| 'paused'
	| 'stopping'
	| 'stopped'
	| 'failed'
	| 'disposed';
export interface FramescaperAudioTrackLike {
	readonly kind?: string;
	getSettings?(): Readonly<{ sampleRate?: unknown; channelCount?: unknown }>;
}
export interface FramescaperAudioDataLike {
	readonly numberOfFrames: number;
	readonly numberOfChannels: number;
	readonly sampleRate: number;
	copyTo(
		destination: Float32Array,
		options: Readonly<{
			planeIndex: number;
			frameOffset?: number;
			frameCount?: number;
			format?: 'f32-planar';
		}>,
	): void;
	close(): void;
}
export interface FramescaperAudioTrackProcessorReader {
	read(): PromiseLike<Readonly<{ done: boolean; value?: FramescaperAudioDataLike }>>;
	cancel?(reason?: unknown): PromiseLike<void> | void;
	releaseLock(): void;
}
export interface FramescaperAudioTrackProcessorLike {
	readonly readable: {
		getReader(): FramescaperAudioTrackProcessorReader;
	};
}
export interface FramescaperAudioTrackProcessorConstructor {
	new(options: Readonly<{
		track: FramescaperAudioTrackLike;
		maxBufferSize: number;
	}>): FramescaperAudioTrackProcessorLike;
}
export interface FramescaperWorkletRecordingController {
	start(options?: Readonly<{ startFrame?: number; stopFrame?: number }>): void;
	pause(): boolean | void;
	resume(): boolean | void;
	stop(): PromiseLike<unknown> | unknown;
	detach?(): PromiseLike<void> | void;
	dispose?(options?: Readonly<{ stopTracks?: boolean }>): PromiseLike<void> | void;
}
export interface FramescaperWorkletRecordingControllerOptions {
	readonly context: unknown;
	readonly stream: unknown;
	readonly channelCount: number;
	readonly chunkFrames: number;
	readonly monitor: boolean;
	readonly inputGain: number;
	readonly maxPendingChunks: number;
	readonly onChunk: (chunk: CapturePcmChunk) => PromiseLike<void> | void;
	readonly onError: (error: unknown) => void;
}
export type FramescaperWorkletRecordingControllerFactory = (
	options: FramescaperWorkletRecordingControllerOptions,
) => PromiseLike<FramescaperWorkletRecordingController> | FramescaperWorkletRecordingController;
export interface FramescaperBrowserAudioRecorderOptions {
	readonly role: FramescaperCaptureAudioRole;
	readonly track: FramescaperAudioTrackLike;
	readonly stream: unknown;
	readonly context?: Readonly<{ sampleRate: number }> | null;
	/** Undefined probes the runtime constructor; null explicitly disables it. */
	readonly MediaStreamTrackProcessor?: FramescaperAudioTrackProcessorConstructor | null;
	readonly recordingControllerFactory?: FramescaperWorkletRecordingControllerFactory;
	readonly monitoring?: boolean;
	readonly inputGain?: number;
	readonly chunkFrames?: number;
	readonly maximumPendingChunks?: number;
	readonly onChunk: (chunk: Readonly<CapturePcmChunk>) => PromiseLike<void> | void;
	readonly onBackpressure?: (pendingChunks: number, error: Error) => PromiseLike<void> | void;
	readonly onError?: (error: unknown) => void;
}
export interface FramescaperBrowserAudioRecorder {
	readonly role: FramescaperCaptureAudioRole;
	readonly backend: FramescaperCaptureAudioRecorderBackend;
	readonly state: FramescaperCaptureAudioRecorderState;
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly chunkFrames: number;
	readonly monitoring: boolean;
	readonly inputGain: number;
	readonly pendingChunks: number;
	/** Exposed only for source ownership and diagnostics; the recorder never stops it. */
	readonly track: FramescaperAudioTrackLike;
	start(startFrame?: number): PromiseLike<void> | void;
	pause(): boolean;
	resume(): boolean;
	stop(): Promise<void>;
	dispose(): Promise<void>;
}
export class FramescaperCaptureAudioBackpressureError extends Error {
	readonly code = 'FRAMESCAPER_CAPTURE_AUDIO_BACKPRESSURE';

	constructor() {
		super('Capture storage could not keep up with the audio input.');
		this.name = 'FramescaperCaptureAudioBackpressureError';
	}
}
/**
 * Creates a uniform microphone/system-audio recorder. AudioData is preferred
 * because it preserves the source track format without an AudioContext hop;
 * AudioWorklet remains the compatibility path.
 */
export async function createFramescaperBrowserAudioRecorder(
	options: FramescaperBrowserAudioRecorderOptions,
): Promise<FramescaperBrowserAudioRecorder> {
	validateOptions(options);
	const format = actualTrackFormat(options.track);
	const monitoring = Boolean(options.monitoring);
	const inputGain = normalizeCaptureInputGain(options.inputGain ?? 1);
	const chunkFrames = boundedInteger(
		options.chunkFrames ?? CAPTURE_AUDIO_CHUNK_FRAMES_DEFAULT,
		CAPTURE_AUDIO_CHUNK_FRAMES_MINIMUM,
		CAPTURE_AUDIO_CHUNK_FRAMES_MAXIMUM,
		'Capture audio chunk frame count',
	);
	const maximumPendingChunks = boundedInteger(
		options.maximumPendingChunks ?? CAPTURE_AUDIO_PENDING_CHUNKS_DEFAULT,
		1,
		CAPTURE_AUDIO_PENDING_CHUNKS_MAXIMUM,
		'Capture audio pending chunk limit',
	);
	const failures = createFailureChannel(options.onError);
	const sink = createBoundedPcmSink({
		channelCount: format.channelCount,
		chunkFrames,
		maximumPendingChunks,
		onChunk: options.onChunk,
		onBackpressure: options.onBackpressure,
		fail: failures.fail,
	});
	const Processor = options.MediaStreamTrackProcessor === undefined
		? runtimeTrackProcessorConstructor()
		: options.MediaStreamTrackProcessor;
	if (Processor && !monitoring) {
		return createFramescaperBrowserAudioProcessorRecorder({
			options, Processor, format, chunkFrames, maximumPendingChunks, inputGain, sink, failures,
			...(options.context ? { createFallback: () => createWorkletRecorder({
				options, format, chunkFrames, maximumPendingChunks, monitoring, inputGain, sink, failures,
			}) } : {}),
		});
	}
	if (!options.context) {
		throw new Error('Capture audio requires AudioData track processing or an AudioWorklet context.');
	}
	if (options.context.sampleRate !== format.sampleRate) {
		throw new Error('Capture AudioWorklet context must retain the source track sample rate.');
	}
	return createWorkletRecorder({
		options, format, chunkFrames, maximumPendingChunks, monitoring, inputGain, sink, failures,
	});
}

interface ActualAudioFormat {
	readonly sampleRate: number;
	readonly channelCount: number;
}

interface FailureChannel {
	readonly failure: Error | null;
	fail(error: unknown): Error;
}

interface BoundedPcmSink {
	readonly pendingChunks: number;
	push(chunk: CapturePcmChunk): Promise<void>;
	settle(): Promise<void>;
}

async function createWorkletRecorder(input: Readonly<{
	options: FramescaperBrowserAudioRecorderOptions;
	format: ActualAudioFormat;
	chunkFrames: number;
	maximumPendingChunks: number;
	monitoring: boolean;
	inputGain: number;
	sink: BoundedPcmSink;
	failures: FailureChannel;
}>): Promise<FramescaperBrowserAudioRecorder> {
	const { options, format, chunkFrames, maximumPendingChunks, monitoring, inputGain, sink, failures } = input;
	const factory = options.recordingControllerFactory
		?? (createRecordingController as unknown as FramescaperWorkletRecordingControllerFactory);
	const frameMapper = createFramescaperCapturePcmFrameMapper();
	let state: FramescaperCaptureAudioRecorderState = 'ready';
	let stopPromise: Promise<void> | null = null;
	let disposePromise: Promise<void> | null = null;
	const delegate = await factory({
		context: options.context,
		stream: options.stream,
		channelCount: format.channelCount,
		chunkFrames,
		monitor: monitoring,
		inputGain,
		maxPendingChunks: maximumPendingChunks,
		onChunk: (chunk) => sink.push(frameMapper.map(chunk)),
		onError: (error) => {
			failures.fail(error);
			state = 'failed';
		},
	});

	function start(startFrameValue = 0): void {
		assertStartable(state, failures.failure);
		const startFrame = boundedInteger(startFrameValue, 0, Number.MAX_SAFE_INTEGER, 'Capture audio start frame');
		frameMapper.start(startFrame);
		try { delegate.start(); } catch (error) { state = 'failed'; throw failures.fail(error); }
		state = 'recording';
	}

	function pause(): boolean {
		assertUsable(state, failures.failure);
		if (state !== 'recording') return false;
		try { if (delegate.pause() === false) return false; }
		catch (error) { state = 'failed'; throw failures.fail(error); }
		state = 'paused';
		return true;
	}

	function resume(): boolean {
		assertUsable(state, failures.failure);
		if (state !== 'paused') return false;
		try { if (delegate.resume() === false) return false; }
		catch (error) { state = 'failed'; throw failures.fail(error); }
		state = 'recording';
		return true;
	}

	function stop(): Promise<void> {
		if (stopPromise) return stopPromise;
		if (state !== 'disposed') state = failures.failure ? 'failed' : 'stopping';
		stopPromise = (async () => {
			try { await delegate.stop(); } catch (error) { failures.fail(error); }
			try { await sink.settle(); } catch (error) { failures.fail(error); }
			if (failures.failure) throw failures.failure;
			if (state !== 'disposed') state = 'stopped';
		})();
		return stopPromise;
	}

	function dispose(): Promise<void> {
		if (disposePromise) return disposePromise;
		disposePromise = stop().catch(() => undefined).then(async () => {
			try {
				if (delegate.detach) await delegate.detach();
				else await delegate.dispose?.({ stopTracks: false });
			} catch (error) { failures.fail(error); }
			state = 'disposed';
			if (failures.failure) throw failures.failure;
		});
		return disposePromise;
	}

	return Object.freeze({
		role: options.role,
		backend: 'audio-worklet' as const,
		get state(): FramescaperCaptureAudioRecorderState { return state; },
		sampleRate: format.sampleRate,
		channelCount: format.channelCount,
		chunkFrames,
		monitoring,
		inputGain,
		get pendingChunks(): number { return sink.pendingChunks; },
		track: options.track,
		start,
		pause,
		resume,
		stop,
		dispose,
	});
}

function createBoundedPcmSink(input: Readonly<{
	channelCount: number;
	chunkFrames: number;
	maximumPendingChunks: number;
	onChunk: (chunk: Readonly<CapturePcmChunk>) => PromiseLike<void> | void;
	onBackpressure?: (pendingChunks: number, error: Error) => PromiseLike<void> | void;
	fail(error: unknown): Error;
}>): BoundedPcmSink {
	let pendingChunks = 0;
	let queue = Promise.resolve();
	let lastInputFrameEnd: number | null = null;

	function push(chunk: CapturePcmChunk): Promise<void> {
		validatePcmChunk(chunk, input.channelCount, input.chunkFrames, lastInputFrameEnd);
		lastInputFrameEnd = exactFrameSum(chunk.frameStart, chunk.frames);
		if (pendingChunks >= input.maximumPendingChunks) {
			const error = new FramescaperCaptureAudioBackpressureError();
			const failure = input.fail(error);
			try {
				void Promise.resolve(input.onBackpressure?.(pendingChunks + 1, failure)).catch(() => undefined);
			} catch { /* The fatal backpressure error remains authoritative. */ }
			return Promise.reject(failure);
		}
		pendingChunks += 1;
		const completion = queue.then(() => input.onChunk(chunk));
		queue = completion.catch((error: unknown) => {
			throw input.fail(error);
		}).finally(() => { pendingChunks -= 1; });
		void queue.catch(() => undefined);
		return queue;
	}

	async function settle(): Promise<void> { await queue; }

	return Object.freeze({
		get pendingChunks(): number { return pendingChunks; },
		push,
		settle,
	});
}

function createFailureChannel(onError: ((error: unknown) => void) | undefined): FailureChannel {
	let failure: Error | null = null;
	function fail(error: unknown): Error {
		if (failure) return failure;
		failure = error instanceof Error ? error : new Error(String(error || 'Capture audio failed.'));
		try { onError?.(failure); } catch { /* Error observers cannot block capture cleanup. */ }
		return failure;
	}
	return {
		get failure(): Error | null { return failure; },
		fail,
	};
}

function validateOptions(options: FramescaperBrowserAudioRecorderOptions): void {
	if (options.role !== 'microphone' && options.role !== 'system-audio') {
		throw new TypeError('Capture audio role must be microphone or system-audio.');
	}
	if (!options.track || typeof options.track !== 'object' || options.track.kind && options.track.kind !== 'audio') {
		throw new TypeError('Capture audio requires an audio MediaStreamTrack.');
	}
	if (typeof options.onChunk !== 'function') throw new TypeError('Capture audio requires a PCM chunk sink.');
}

function actualTrackFormat(track: FramescaperAudioTrackLike): ActualAudioFormat {
	const settings = track.getSettings?.();
	const sampleRate = boundedInteger(
		settings?.sampleRate,
		1,
		CAPTURE_AUDIO_SAMPLE_RATE_MAXIMUM,
		'Capture audio actual sample rate',
	);
	const channelCount = boundedInteger(
		settings?.channelCount,
		1,
		CAPTURE_AUDIO_CHANNEL_COUNT_MAXIMUM,
		'Capture audio actual channel count',
	);
	return Object.freeze({ sampleRate, channelCount });
}

function validatePcmChunk(
	chunk: CapturePcmChunk,
	channelCount: number,
	chunkFrames: number,
	lastInputFrameEnd: number | null,
): void {
	const frameStart = boundedInteger(chunk?.frameStart, 0, Number.MAX_SAFE_INTEGER, 'Capture PCM frame start');
	const frames = boundedInteger(chunk?.frames, 1, chunkFrames, 'Capture PCM chunk frame count');
	if (lastInputFrameEnd !== null && frameStart < lastInputFrameEnd) {
		throw new Error('Capture PCM input chunks cannot overlap or move backward.');
	}
	if (!Array.isArray(chunk.channels) || chunk.channels.length !== channelCount) {
		throw new Error('Capture PCM chunk does not match the source track actual format.');
	}
	for (const channel of chunk.channels) {
		if (!(channel instanceof Float32Array) || channel.length !== frames) {
			throw new Error('Capture PCM chunks must contain bounded equal-length planar Float32 data.');
		}
	}
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`${name} must be an integer between ${String(minimum)} and ${String(maximum)}.`);
	}
	return Number(value);
}

function normalizeCaptureInputGain(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError('Capture input gain must be a finite number.');
	}
	return Math.max(0, Math.min(2, value));
}

function exactFrameSum(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result) || result < 0) throw new RangeError('Capture audio frame position exceeds the safe range.');
	return result;
}

function assertStartable(state: FramescaperCaptureAudioRecorderState, failure: Error | null): void {
	if (state === 'failed') throw failure ?? new Error('Capture audio recorder failed.');
	if (state !== 'ready') throw new Error('Capture audio recorder can start only once.');
}

function assertUsable(state: FramescaperCaptureAudioRecorderState, failure: Error | null): void {
	if (state === 'failed') throw failure ?? new Error('Capture audio recorder failed.');
	if (state === 'disposed') throw new Error('Capture audio recorder has been disposed.');
}

function runtimeTrackProcessorConstructor(): FramescaperAudioTrackProcessorConstructor | null {
	const runtime = globalThis as typeof globalThis & { MediaStreamTrackProcessor?: unknown };
	return typeof runtime.MediaStreamTrackProcessor === 'function'
		? runtime.MediaStreamTrackProcessor as unknown as FramescaperAudioTrackProcessorConstructor
		: null;
}
