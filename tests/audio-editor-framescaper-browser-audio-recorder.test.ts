/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperBrowserAudioRecorder,
} from '../src/common/editor/controller/framescaper-browser-audio-recorder.ts';

interface ReadResult {
	readonly done: boolean;
	readonly value?: FakeAudioData;
}

class FakeAudioData {
	readonly numberOfFrames: number;
	readonly numberOfChannels: number;
	readonly sampleRate: number;
	closeCalls = 0;
	copyCalls: Array<Readonly<{ planeIndex: number; frameOffset: number; frameCount: number; format: string }>> = [];

	constructor(readonly channels: readonly Float32Array[], sampleRate = 48_000) {
		this.numberOfFrames = channels[0]?.length ?? 0;
		this.numberOfChannels = channels.length;
		this.sampleRate = sampleRate;
	}

	copyTo(
		target: Float32Array,
		options: Readonly<{ planeIndex: number; frameOffset?: number; frameCount?: number; format?: string }>,
	): void {
		const frameOffset = options.frameOffset ?? 0;
		const frameCount = options.frameCount ?? this.numberOfFrames - frameOffset;
		this.copyCalls.push(Object.freeze({
			planeIndex: options.planeIndex,
			frameOffset,
			frameCount,
			format: options.format ?? '',
		}));
		target.set(this.channels[options.planeIndex]!.subarray(frameOffset, frameOffset + frameCount));
	}

	close(): void { this.closeCalls += 1; }
}

class FakeReader {
	readonly queued: ReadResult[] = [];
	readonly waiting: Array<(result: ReadResult) => void> = [];
	cancelCalls = 0;
	releaseCalls = 0;
	cancelError: Error | null = null;

	read(): Promise<ReadResult> {
		const queued = this.queued.shift();
		if (queued) return Promise.resolve(queued);
		return new Promise((resolve) => { this.waiting.push(resolve); });
	}

	push(value: FakeAudioData): void { this.deliver({ done: false, value }); }
	finish(): void { this.deliver({ done: true }); }
	cancel(): Promise<void> {
		this.cancelCalls += 1;
		this.finish();
		return this.cancelError ? Promise.reject(this.cancelError) : Promise.resolve();
	}
	releaseLock(): void { this.releaseCalls += 1; }

	private deliver(result: ReadResult): void {
		const waiting = this.waiting.shift();
		if (waiting) waiting(result);
		else this.queued.push(result);
	}
}

function createProcessorHarness({ constructError }: Readonly<{ constructError?: Error }> = {}) {
	const reader = new FakeReader();
	let construction: Readonly<Record<string, unknown>> | null = null;
	class TrackProcessor {
		readonly readable = { getReader: () => reader };
		constructor(options: Readonly<Record<string, unknown>>) {
			if (constructError) throw constructError;
			construction = options;
		}
	}
	return { TrackProcessor, reader, construction: () => construction };
}

function audioTrack(sampleRate = 48_000, channelCount = 2) {
	return {
		kind: 'audio',
		getSettings: () => ({ sampleRate, channelCount }),
	};
}

function audioData(frames: number, channelCount = 2, sampleRate = 48_000): FakeAudioData {
	return new FakeAudioData(Array.from({ length: channelCount }, (_, channel) =>
		Float32Array.from({ length: frames }, (_value, frame) => channel * 1_000 + frame)), sampleRate);
}

test('track processor is preferred and emits bounded planar chunks in the actual format', async () => {
	const harness = createProcessorHarness();
	const chunks: Array<Readonly<{ frameStart: number; frames: number; channels: readonly Float32Array[] }>> = [];
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: 'microphone',
		track: audioTrack(),
		stream: { id: 'microphone-stream' },
		MediaStreamTrackProcessor: harness.TrackProcessor,
		chunkFrames: 128,
		onChunk: (chunk) => { chunks.push(chunk); },
	});
	assert.equal(recorder.backend, 'track-processor');
	assert.equal(recorder.sampleRate, 48_000);
	assert.equal(recorder.channelCount, 2);
	assert.equal(recorder.monitoring, false);
	assert.equal(recorder.inputGain, 1);
	assert.equal(harness.construction(), null, 'the processor cannot buffer preview audio before durable start');

	recorder.start();
	assert.deepEqual(harness.construction(), { track: recorder.track, maxBufferSize: 32 });
	const data = audioData(130);
	harness.reader.push(data);
	await waitUntil(() => chunks.length === 2);
	assert.deepEqual(chunks.map((chunk) => ({ frameStart: chunk.frameStart, frames: chunk.frames })), [
		{ frameStart: 0, frames: 128 },
		{ frameStart: 128, frames: 2 },
	]);
	assert.deepEqual([...chunks[0]!.channels[1]!.subarray(0, 3)], [1_000, 1_001, 1_002]);
	assert.deepEqual(data.copyCalls, [
		{ planeIndex: 0, frameOffset: 0, frameCount: 128, format: 'f32-planar' },
		{ planeIndex: 1, frameOffset: 0, frameCount: 128, format: 'f32-planar' },
		{ planeIndex: 0, frameOffset: 128, frameCount: 2, format: 'f32-planar' },
		{ planeIndex: 1, frameOffset: 128, frameCount: 2, format: 'f32-planar' },
	]);
	assert.equal(data.closeCalls, 1);
	await recorder.stop();
	assert.equal(harness.reader.cancelCalls, 1);
	assert.equal(harness.reader.releaseCalls, 1);
});

test('processor pause excludes samples while preserving monotonic input frame gaps', async () => {
	const harness = createProcessorHarness();
	const chunks: Array<Readonly<{ frameStart: number; frames: number }>> = [];
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: 'system-audio', track: audioTrack(), stream: {},
		MediaStreamTrackProcessor: harness.TrackProcessor,
		onChunk: (chunk) => { chunks.push(chunk); },
	});
	recorder.start();
	const before = audioData(2);
	harness.reader.push(before);
	await waitUntil(() => chunks.length === 1);
	assert.equal(recorder.pause(), true);
	const paused = audioData(3);
	harness.reader.push(paused);
	await waitUntil(() => paused.closeCalls === 1);
	assert.equal(recorder.resume(), true);
	const after = audioData(2);
	harness.reader.push(after);
	await waitUntil(() => chunks.length === 2);
	assert.deepEqual(chunks.map(({ frameStart, frames }) => ({ frameStart, frames })), [
		{ frameStart: 0, frames: 2 },
		{ frameStart: 5, frames: 2 },
	]);
	assert.equal(before.closeCalls, 1);
	assert.equal(paused.closeCalls, 1);
	assert.equal(after.closeCalls, 1);
	await recorder.dispose();
	await recorder.dispose();
	assert.equal(harness.reader.cancelCalls, 1);
	assert.equal(harness.reader.releaseCalls, 1);
	assert.equal(recorder.state, 'disposed');
});

test('processor bounds and serializes pending writes, surfacing fatal backpressure', async () => {
	const harness = createProcessorHarness();
	let releaseFirst!: () => void;
	const firstWrite = new Promise<void>((resolve) => { releaseFirst = resolve; });
	const calls: number[] = [];
	const pressure: number[] = [];
	const errors: unknown[] = [];
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: 'microphone', track: audioTrack(), stream: {},
		MediaStreamTrackProcessor: harness.TrackProcessor,
		maximumPendingChunks: 1,
		onChunk: async (chunk) => { calls.push(chunk.frameStart); await firstWrite; },
		onBackpressure: (pending) => { pressure.push(pending); },
		onError: (error) => { errors.push(error); },
	});
	recorder.start();
	const first = audioData(2);
	const second = audioData(2);
	harness.reader.push(first);
	harness.reader.push(second);
	await waitUntil(() => errors.length === 1);
	assert.deepEqual(calls, [0]);
	assert.deepEqual(pressure, [2]);
	assert.match(String(errors[0]), /could not keep up/i);
	assert.equal(recorder.state, 'failed');
	assert.equal(first.closeCalls, 1);
	assert.equal(second.closeCalls, 1);
	releaseFirst();
	await assert.rejects(recorder.stop(), /could not keep up/i);
	assert.equal(harness.reader.cancelCalls, 1);
	assert.equal(harness.reader.releaseCalls, 1);
});

test('AudioData format mismatch is reported and the frame is closed exactly once', async () => {
	const harness = createProcessorHarness();
	const errors: unknown[] = [];
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: 'microphone', track: audioTrack(), stream: {},
		MediaStreamTrackProcessor: harness.TrackProcessor,
		onChunk: () => {},
		onError: (error) => { errors.push(error); },
	});
	recorder.start();
	const mismatch = audioData(2, 1);
	harness.reader.push(mismatch);
	await waitUntil(() => errors.length === 1);
	assert.match(String(errors[0]), /actual format/i);
	assert.equal(mismatch.closeCalls, 1);
	await assert.rejects(recorder.stop(), /actual format/i);
	assert.equal(harness.reader.releaseCalls, 1);
});

test('asynchronous PCM sink failures stop processor reads and report exactly once', async () => {
	const harness = createProcessorHarness();
	const failure = new Error('capture spool unavailable');
	const errors: unknown[] = [];
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: 'microphone', track: audioTrack(), stream: {},
		MediaStreamTrackProcessor: harness.TrackProcessor,
		onChunk: async () => { throw failure; },
		onError: (error) => { errors.push(error); },
	});
	recorder.start();
	const data = audioData(2);
	harness.reader.push(data);
	await waitUntil(() => recorder.state === 'failed');
	assert.deepEqual(errors, [failure]);
	assert.equal(data.closeCalls, 1);
	await assert.rejects(recorder.stop(), failure);
	assert.equal(harness.reader.cancelCalls, 1);
	assert.equal(harness.reader.releaseCalls, 1);
});

test('unsupported processor construction falls back to the AudioWorklet controller with safe defaults', async () => {
	const harness = createProcessorHarness({ constructError: new DOMException('unsupported', 'NotSupportedError') });
	const factoryCalls: Array<Record<string, unknown>> = [];
	const delegateCalls: string[] = [];
	let delegateChunk: ((chunk: Readonly<{
		frameStart: number;
		frames: number;
		channels: readonly Float32Array[];
	}>) => PromiseLike<void> | void) | undefined;
	const output: number[] = [];
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: 'microphone', track: audioTrack(), stream: { id: 'stream' },
		context: { sampleRate: 48_000 },
		MediaStreamTrackProcessor: harness.TrackProcessor,
		recordingControllerFactory: async (options) => {
			factoryCalls.push(options as unknown as Record<string, unknown>);
			delegateChunk = options.onChunk;
			return {
				start: (startOptions) => { delegateCalls.push(`start:${String(startOptions)}`); },
				pause: () => { delegateCalls.push('pause'); return true; },
				resume: () => { delegateCalls.push('resume'); return true; },
				stop: async () => { delegateCalls.push('stop'); },
				detach: async () => { delegateCalls.push('detach'); },
			};
		},
		onChunk: (chunk) => { output.push(chunk.frameStart); },
	});
	assert.equal(recorder.backend, 'track-processor', 'backend selection stays lazy until durable start');
	assert.equal(factoryCalls.length, 0);
	await recorder.start(4_800);
	assert.equal(recorder.backend, 'audio-worklet');
	assert.equal(factoryCalls[0]!.monitor, false);
	assert.equal(factoryCalls[0]!.inputGain, 1);
	assert.equal(factoryCalls[0]!.channelCount, 2);
	assert.equal(factoryCalls[0]!.chunkFrames, 4_096);
	await delegateChunk?.({
		frameStart: 9_600_000,
		frames: 2,
		channels: [new Float32Array([1, 2]), new Float32Array([3, 4])],
	});
	await delegateChunk?.({
		frameStart: 9_600_002,
		frames: 2,
		channels: [new Float32Array([5, 6]), new Float32Array([7, 8])],
	});
	assert.equal(recorder.pause(), true);
	assert.equal(recorder.resume(), true);
	await recorder.stop();
	await recorder.dispose();
	assert.deepEqual(output, [4_800, 4_802]);
	assert.deepEqual(delegateCalls, ['start:undefined', 'pause', 'resume', 'stop', 'detach']);
});

test('processor construction fallback preserves the AudioWorklet track sample-rate invariant', async () => {
	const harness = createProcessorHarness({ constructError: new DOMException('unsupported', 'NotSupportedError') });
	let factoryCalls = 0;
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: 'microphone', track: audioTrack(48_000), stream: { id: 'stream' },
		context: { sampleRate: 44_100 },
		MediaStreamTrackProcessor: harness.TrackProcessor,
		recordingControllerFactory: async () => {
			factoryCalls += 1;
			return {
				start: () => {}, pause: () => true, resume: () => true,
				stop: async () => {}, detach: async () => {},
			};
		},
		onChunk: () => {},
	});

	await assert.rejects(Promise.resolve(recorder.start()), /retain the source track sample rate/iu);
	assert.equal(factoryCalls, 0, 'an incompatible AudioWorklet must not be constructed');
});

test('monitoring selects AudioWorklet and retains configured capture gain', async () => {
	const harness = createProcessorHarness();
	const factoryOptions: Array<Record<string, unknown>> = [];
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: 'system-audio', track: audioTrack(), stream: {},
		context: { sampleRate: 48_000 },
		MediaStreamTrackProcessor: harness.TrackProcessor,
		monitoring: true,
		inputGain: 0.5,
		recordingControllerFactory: async (options) => {
			factoryOptions.push(options as unknown as Record<string, unknown>);
			return {
				start: () => {}, pause: () => true, resume: () => true,
				stop: async () => {}, detach: async () => {},
			};
		},
		onChunk: () => {},
	});
	assert.equal(recorder.backend, 'audio-worklet');
	assert.equal(recorder.monitoring, true);
	assert.equal(recorder.inputGain, 0.5);
	assert.equal(recorder.chunkFrames, 4_096);
	assert.equal(harness.construction(), null);
	assert.equal(factoryOptions[0]?.monitor, true);
	assert.equal(factoryOptions[0]?.inputGain, 0.5);
	await recorder.dispose();
});

test('dispose before start never creates a processor reader or touches source tracks', async () => {
	const harness = createProcessorHarness();
	let trackStops = 0;
	const track = { ...audioTrack(), stop: () => { trackStops += 1; } };
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: 'microphone', track, stream: {},
		MediaStreamTrackProcessor: harness.TrackProcessor,
		onChunk: () => {},
	});
	await recorder.dispose();
	assert.equal(harness.construction(), null);
	assert.equal(harness.reader.cancelCalls, 0);
	assert.equal(harness.reader.releaseCalls, 0);
	assert.equal(trackStops, 0);
});

test('reader cancellation failure is surfaced without skipping exact release', async () => {
	const harness = createProcessorHarness();
	harness.reader.cancelError = new Error('reader cancellation failed');
	const errors: unknown[] = [];
	const recorder = await createFramescaperBrowserAudioRecorder({
		role: 'microphone', track: audioTrack(), stream: {},
		MediaStreamTrackProcessor: harness.TrackProcessor,
		onChunk: () => {},
		onError: (error) => { errors.push(error); },
	});
	recorder.start();
	await assert.rejects(recorder.dispose(), /reader cancellation failed/);
	assert.equal(recorder.state, 'disposed');
	assert.equal(harness.reader.cancelCalls, 1);
	assert.equal(harness.reader.releaseCalls, 1);
	assert.equal(errors.length, 1);
});

async function waitUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise<void>((resolve) => { setImmediate(resolve); });
	}
	throw new Error('Timed out waiting for the recorder test condition.');
}
