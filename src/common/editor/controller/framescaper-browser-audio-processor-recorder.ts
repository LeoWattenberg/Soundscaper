/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	FramescaperAudioDataLike,
	FramescaperAudioTrackProcessorConstructor,
	FramescaperAudioTrackProcessorReader,
	FramescaperBrowserAudioRecorder,
	FramescaperBrowserAudioRecorderOptions,
	FramescaperCaptureAudioRecorderState,
} from './framescaper-browser-audio-recorder.ts';

interface ActualAudioFormat {
	readonly sampleRate: number;
	readonly channelCount: number;
}

interface PcmSink {
	readonly pendingChunks: number;
	push(chunk: Readonly<{
		readonly frameStart: number;
		readonly frames: number;
		readonly channels: readonly Float32Array[];
	}>): Promise<void>;
	settle(): Promise<void>;
}

interface FailureChannel {
	readonly failure: Error | null;
	fail(error: unknown): Error;
}

export function createFramescaperBrowserAudioProcessorRecorder(input: Readonly<{
	options: FramescaperBrowserAudioRecorderOptions;
	Processor: FramescaperAudioTrackProcessorConstructor;
	format: ActualAudioFormat;
	chunkFrames: number;
	maximumPendingChunks: number;
	inputGain: number;
	sink: PcmSink;
	failures: FailureChannel;
	createFallback?: () => Promise<FramescaperBrowserAudioRecorder>;
}>): FramescaperBrowserAudioRecorder {
	const { options, format, chunkFrames, inputGain, sink, failures } = input;
	let state: FramescaperCaptureAudioRecorderState = 'ready';
	let inputFrameStart = 0;
	let reader: FramescaperAudioTrackProcessorReader | null = null;
	let fallback: FramescaperBrowserAudioRecorder | null = null;
	let readLoop: Promise<void> | null = null;
	let startPromise: Promise<void> | null = null;
	let cancelPromise: Promise<void> | null = null;
	let released = false;
	let stopPromise: Promise<void> | null = null;
	let disposePromise: Promise<void> | null = null;

	function start(startFrameValue = 0): Promise<void> | void {
		assertStartable(currentState(), failures.failure, startPromise);
		inputFrameStart = boundedInteger(startFrameValue, 0, Number.MAX_SAFE_INTEGER, 'Capture audio start frame');
		try {
			const processor = new input.Processor({
				track: options.track,
				maxBufferSize: input.maximumPendingChunks,
			});
			reader = processor.readable.getReader();
			state = 'recording';
			readLoop = runReader();
			void readLoop.catch(() => undefined);
		} catch (error) {
			if (!input.createFallback) {
				state = 'failed';
				throw failures.fail(error);
			}
			startPromise = input.createFallback().then(async (created) => {
				fallback = created;
				await created.start(inputFrameStart);
			}).catch((fallbackError: unknown) => {
				state = 'failed';
				throw failures.fail(fallbackError);
			});
			return startPromise;
		}
	}

	function pause(): boolean {
		if (fallback) return fallback.pause();
		assertUsable(state, failures.failure);
		if (state !== 'recording') return false;
		state = 'paused';
		return true;
	}

	function resume(): boolean {
		if (fallback) return fallback.resume();
		assertUsable(state, failures.failure);
		if (state !== 'paused') return false;
		state = 'recording';
		return true;
	}

	function stop(): Promise<void> {
		if (stopPromise) return stopPromise;
		stopPromise = (async () => {
			await startPromise?.catch(() => undefined);
			if (fallback) return fallback.stop();
			if (state !== 'disposed') state = failures.failure ? 'failed' : 'stopping';
			try { await cancelReader(); } catch { /* Failure channel retains the error. */ }
			if (readLoop) {
				try { await readLoop; } catch { /* Failure channel retains the error. */ }
			} else releaseReader();
			try { await sink.settle(); } catch { /* Failure channel retains the error. */ }
			if (failures.failure) throw failures.failure;
			if (state !== 'disposed') state = 'stopped';
		})();
		return stopPromise;
	}

	function dispose(): Promise<void> {
		if (disposePromise) return disposePromise;
		disposePromise = stop().finally(async () => {
			if (fallback) await fallback.dispose();
			state = 'disposed';
		});
		return disposePromise;
	}

	async function runReader(): Promise<void> {
		try {
			while (state === 'recording' || state === 'paused') {
				const result = await requiredReader().read();
				if (result.done) {
					if (state === 'recording' || state === 'paused') {
						fail(new Error('The capture audio track ended unexpectedly.'));
					}
					break;
				}
				const data = result.value;
				if (!data) throw new Error('The capture audio processor returned an empty frame.');
				const frameStart = inputFrameStart;
				try {
					validateAudioData(data, format);
					inputFrameStart = exactFrameSum(inputFrameStart, data.numberOfFrames);
					if (!isAcceptingProcessorData()) continue;
					for (let offset = 0; offset < data.numberOfFrames; offset += chunkFrames) {
						const frames = Math.min(chunkFrames, data.numberOfFrames - offset);
						const channels = Array.from({ length: format.channelCount }, (_unused, planeIndex) => {
							const channel = new Float32Array(frames);
							data.copyTo(channel, {
								planeIndex, frameOffset: offset, frameCount: frames, format: 'f32-planar',
							});
							if (inputGain !== 1) channel.forEach((value, index) => { channel[index] = value * inputGain; });
							return channel;
						});
						const write = sink.push(Object.freeze({
							frameStart: exactFrameSum(frameStart, offset),
							frames,
							channels: Object.freeze(channels),
						}));
						void write.catch((error: unknown) => { fail(error); });
						if (failures.failure) break;
					}
				} finally {
					try { data.close(); } catch (error) { fail(error); }
				}
				if (failures.failure) break;
			}
		} catch (error) {
			if (state !== 'stopping' && state !== 'disposed') fail(error);
		} finally {
			if (failures.failure) {
				try { await cancelReader(); } catch { /* Continue exact reader release. */ }
			}
			releaseReader();
		}
		if (failures.failure) throw failures.failure;
	}

	function fail(error: unknown): Error {
		const failure = failures.fail(error);
		state = 'failed';
		void cancelReader().catch(() => undefined);
		return failure;
	}

	function isAcceptingProcessorData(): boolean { return state === 'recording'; }

	function cancelReader(): Promise<void> {
		if (cancelPromise) return cancelPromise;
		if (!reader) return Promise.resolve();
		cancelPromise = Promise.resolve().then(() => reader?.cancel?.()).then(() => undefined).catch((error: unknown) => {
			if (!failures.failure) failures.fail(error);
			throw failures.failure ?? error;
		});
		return cancelPromise;
	}

	function releaseReader(): void {
		if (released || !reader) return;
		released = true;
		try { reader.releaseLock(); } catch (error) { failures.fail(error); }
	}

	function currentState(): FramescaperCaptureAudioRecorderState {
		return fallback?.state ?? state;
	}

	function requiredReader(): FramescaperAudioTrackProcessorReader {
		if (!reader) throw new Error('Capture audio processor reader is unavailable.');
		return reader;
	}

	return Object.freeze({
		role: options.role,
		get backend() { return fallback?.backend ?? 'track-processor' as const; },
		get state() { return currentState(); },
		sampleRate: format.sampleRate,
		channelCount: format.channelCount,
		chunkFrames,
		get monitoring() { return fallback?.monitoring ?? false; },
		inputGain,
		get pendingChunks() { return sink.pendingChunks; },
		track: options.track,
		start,
		pause,
		resume,
		stop,
		dispose,
	});
}

function validateAudioData(data: FramescaperAudioDataLike, format: ActualAudioFormat): void {
	boundedInteger(data.numberOfFrames, 1, 1_048_576, 'Capture AudioData frame count');
	if (data.sampleRate !== format.sampleRate || data.numberOfChannels !== format.channelCount) {
		throw new Error('Capture AudioData does not match the source track actual format.');
	}
	if (typeof data.copyTo !== 'function' || typeof data.close !== 'function') {
		throw new TypeError('Capture processor returned invalid AudioData.');
	}
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`${name} must be an integer between ${String(minimum)} and ${String(maximum)}.`);
	}
	return Number(value);
}

function exactFrameSum(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result) || result < 0) throw new RangeError('Capture audio frame position exceeds the safe range.');
	return result;
}

function assertStartable(
	state: FramescaperCaptureAudioRecorderState,
	failure: Error | null,
	startPromise: Promise<void> | null,
): void {
	if (state === 'failed') throw failure ?? new Error('Capture audio recorder failed.');
	if (state !== 'ready' || startPromise) throw new Error('Capture audio recorder can start only once.');
}

function assertUsable(state: FramescaperCaptureAudioRecorderState, failure: Error | null): void {
	if (state === 'failed') throw failure ?? new Error('Capture audio recorder failed.');
	if (state === 'disposed') throw new Error('Capture audio recorder has been disposed.');
}
