/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { scheduleProjectClips } from '../src/common/editor/engine/clip-scheduler.ts';
import type { WebAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';

interface StreamUnderrunDetails {
	readonly frame: number;
	readonly frames: number;
	readonly sourceEnded: boolean;
}

interface StreamOpenOptions extends Record<string, unknown> {
	readonly onUnderrun?: (details: StreamUnderrunDetails) => void;
}

test('realtime rendering waits for streamed clips and fails closed on a late underrun', async () => {
	const previousAudioContext = globalThis.AudioContext;
	const previousAudioWorkletNode = globalThis.AudioWorkletNode;
	const context = new MockRealtimeAudioContext();
	const streams = new MockChunkStreamClient();
	let engine: WebAudioEditorEngine | null = null;
	globalThis.AudioContext = function MockAudioContextFactory() {
		return context;
	} as unknown as typeof AudioContext;
	globalThis.AudioWorkletNode = MockCaptureNode as unknown as typeof AudioWorkletNode;
	try {
		engine = createAudioEditorEngine({
			chunkStreamClient: streams as never,
			chunkAudioNodeFactory: async () => new MockChunkNode() as unknown as AudioWorkletNode,
		});
		engine.loadProject({
			sampleRate: 48_000,
			masterChannels: 1,
			tracks: [{ id: 'track-1', type: 'audio', clipIds: ['clip-1'] }],
			clips: [{
				id: 'clip-1', sourceId: 'source-1', timelineStartFrame: 0,
				durationFrames: 1, sourceStartFrame: 0, sourceDurationFrames: 1,
			}],
			master: { gain: 1, pan: 0, mute: false, effects: [] },
		}, new Map(), { chunkSources: new Map([['source-1', chunkSource()]]) });

		let sinkWrites = 0;
		let settled = false;
		const rendering = engine.renderMixRealtime({
			startFrame: 0,
			endFrame: 1,
			outputFrames: 1,
			onChunk: () => { sinkWrites += 1; },
		});
		void rendering.then(() => { settled = true; }, () => { settled = true; });
		await streams.opened.promise;
		await context.captureDone.promise;
		await new Promise((resolve) => setImmediate(resolve));
		const settledBeforeStream = settled;
		const onUnderrun = streams.options?.onUnderrun;
		onUnderrun?.({ frame: 24_576, frames: 128, sourceEnded: false });
		onUnderrun?.({ frame: 30_000, frames: 128, sourceEnded: true });
		streams.complete();
		const failure = await rendering.then(() => null, (error: unknown) => error);

		assert.equal(settledBeforeStream, false, 'capture completion waits for the streamed-source barrier');
		assert.equal(typeof onUnderrun, 'function');
		assert.ok(failure instanceof Error);
		assert.equal((failure as Error & { code?: string }).code, 'REALTIME_RENDER_UNDERRUN');
		assert.deepEqual((failure as Error & { details?: unknown }).details, {
			clipId: 'clip-1', sourceId: 'source-1', frame: 24_576, frames: 128, sourceEnded: false,
		});
		assert.equal(sinkWrites, 1);
		assert.equal(streams.cancelled, true);
		assert.equal(context.closeCalls, 1);
	} finally {
		streams.complete();
		await engine?.dispose();
		if (previousAudioContext === undefined) Reflect.deleteProperty(globalThis, 'AudioContext');
		else globalThis.AudioContext = previousAudioContext;
		if (previousAudioWorkletNode === undefined) Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
		else globalThis.AudioWorkletNode = previousAudioWorkletNode;
	}
});

test('stream completion resumes a context suspended by final sink backpressure', async () => {
	const previousAudioContext = globalThis.AudioContext;
	const previousAudioWorkletNode = globalThis.AudioWorkletNode;
	const context = new MockRealtimeAudioContext();
	const streams = new MockChunkStreamClient();
	const releaseSink = deferred<void>();
	const sinkStarted = deferred<void>();
	let engine: WebAudioEditorEngine | null = null;
	context.onPostCaptureResume = () => streams.complete();
	globalThis.AudioContext = function MockAudioContextFactory() {
		return context;
	} as unknown as typeof AudioContext;
	globalThis.AudioWorkletNode = MockCaptureNode as unknown as typeof AudioWorkletNode;
	try {
		engine = createAudioEditorEngine({
			chunkStreamClient: streams as never,
			chunkAudioNodeFactory: async () => new MockChunkNode() as unknown as AudioWorkletNode,
		});
		engine.loadProject(streamProject(), new Map(), {
			chunkSources: new Map([['source-1', chunkSource()]]),
		});
		const rendering = engine.renderMixRealtime({
			startFrame: 0,
			endFrame: 1,
			outputFrames: 1,
			maximumPendingChunks: 1,
			onChunk: async () => { sinkStarted.resolve(); await releaseSink.promise; },
		});
		await context.captureDone.promise;
		await sinkStarted.promise;
		releaseSink.resolve();
		await new Promise((resolve) => setImmediate(resolve));
		await new Promise((resolve) => setImmediate(resolve));
		const resumeCallsBeforeFallback = context.resumeCalls;
		streams.complete();
		assert.equal((await rendering).chunkCount, 1);
		assert.equal(resumeCallsBeforeFallback, 2, 'stream settlement owns a final resume after sink drain');
		assert.equal(context.suspendCalls, 1);
	} finally {
		releaseSink.resolve();
		streams.complete();
		await engine?.dispose();
		if (previousAudioContext === undefined) Reflect.deleteProperty(globalThis, 'AudioContext');
		else globalThis.AudioContext = previousAudioContext;
		if (previousAudioWorkletNode === undefined) Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
		else globalThis.AudioWorkletNode = previousAudioWorkletNode;
	}
});

test('interactive scheduling retains silence-on-underrun behavior by default', async () => {
	const context = new MockRealtimeAudioContext();
	const streams = new MockChunkStreamClient();
	const trackInput = new MockNode();
	const scheduled = await scheduleProjectClips({
		context: context as unknown as BaseAudioContext,
		project: {
			sampleRate: 48_000,
			tracks: [{ id: 'track-1', type: 'audio', clipIds: ['clip-1'] }],
			clips: [{
				id: 'clip-1', sourceId: 'source-1', timelineStartFrame: 0,
				durationFrames: 1, sourceStartFrame: 0, sourceDurationFrames: 1,
			}],
		},
		sources: new Map(),
		chunkSources: new Map([['source-1', chunkSource()]]),
		trackInputs: new Map([['track-1', trackInput as unknown as AudioNode]]),
		fromFrame: 0,
		toFrame: 1,
		contextStartTime: 0,
		sampleRate: 48_000,
		reversedBuffers: new WeakMap(),
		sourceResolver: null,
		activeSources: new Set(),
		allNodes: [] as AudioNode[],
		mode: 'live',
		chunkStreamClient: streams as never,
		chunkAudioNodeFactory: async () => new MockChunkNode() as unknown as AudioWorkletNode,
	});

	assert.equal(streams.options?.onUnderrun, null);
	assert.equal(scheduled.streamedClips, 1);
	streams.complete();
	await scheduled.waitForStreamedClips();
});

class MockChunkStreamClient {
	readonly opened = deferred<void>();
	readonly completion = deferred<void>();
	options: StreamOpenOptions | null = null;
	cancelled = false;

	open(options: StreamOpenOptions) {
		this.options = options;
		this.opened.resolve();
		return {
			ready: Promise.resolve(),
			primed: Promise.resolve(),
			done: this.completion.promise,
			play: () => undefined,
			cancel: () => { this.cancelled = true; },
		};
	}

	complete(): void {
		this.completion.resolve();
	}

	dispose(): void {}
}

class MockParam {
	value = 1;
	setValueAtTime(value: number): void { this.value = value; }
	linearRampToValueAtTime(value: number): void { this.value = value; }
}

class MockNode {
	readonly gain = new MockParam();
	disconnected = false;
	connect(target: unknown): unknown { return target; }
	disconnect(): void { this.disconnected = true; }
}

class MockChunkNode extends MockNode {
	readonly port = { postMessage() {}, addEventListener() {}, removeEventListener() {}, start() {} };
}

class MockRealtimeAudioContext {
	readonly sampleRate = 48_000;
	readonly currentTime = 0;
	readonly destination = new MockNode();
	readonly audioWorklet = { addModule: async () => undefined };
	readonly captureDone = deferred<void>();
	state: AudioContextState = 'suspended';
	capture: MockCaptureNode | null = null;
	closeCalls = 0;
	resumeCalls = 0;
	suspendCalls = 0;
	onPostCaptureResume: (() => void) | null = null;

	createGain(): MockNode { return new MockNode(); }

	async resume(): Promise<void> {
		this.resumeCalls += 1;
		this.state = 'running';
		if (this.resumeCalls > 1) {
			this.onPostCaptureResume?.();
			return;
		}
		this.capture?.emit({
			type: 'audio-chunk', frameOffset: 0,
			channels: [Float32Array.of(0.5)],
		});
		this.capture?.emit({ type: 'done', frames: 1 });
		this.captureDone.resolve();
	}

	async suspend(): Promise<void> {
		this.suspendCalls += 1;
		this.state = 'suspended';
	}

	async close(): Promise<void> {
		this.closeCalls += 1;
		this.state = 'closed';
	}
}

class MockCaptureNode extends MockNode {
	readonly port: {
		onmessage: ((event: { data: Readonly<Record<string, unknown>> }) => void) | null;
		start(): void;
	};
	onprocessorerror: (() => void) | null = null;

	constructor(context: MockRealtimeAudioContext) {
		super();
		this.port = { onmessage: null, start() {} };
		context.capture = this;
	}

	emit(data: Readonly<Record<string, unknown>>): void {
		this.port.onmessage?.({ data });
	}
}

function chunkSource() {
	return {
		channelCount: 1,
		frameCount: 1,
		chunkFrames: 1,
		sampleRate: 48_000,
		readStorageChunk: async () => [Float32Array.of(0.5)],
	};
}

function streamProject() {
	return {
		sampleRate: 48_000,
		masterChannels: 1,
		tracks: [{ id: 'track-1', type: 'audio', clipIds: ['clip-1'] }],
		clips: [{
			id: 'clip-1', sourceId: 'source-1', timelineStartFrame: 0,
			durationFrames: 1, sourceStartFrame: 0, sourceDurationFrames: 1,
		}],
		master: { gain: 1, pan: 0, mute: false, effects: [] },
	};
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve: (value?: Value) => resolve(value as Value) };
}
