/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import { startLiveChunkWindow } from '../src/common/editor/engine/clip-scheduler-live-chunks.ts';
import type { EngineRuntimeHost } from '../src/common/editor/engine/runtime-types.ts';
import { MockAudioContext, MockNode } from './helpers/mock-audio-context.js';

test('a streamed clip failure after priming stops playback and reports its cause', async () => {
	const fixture = createFixture([0]);
	const errors: unknown[] = [];
	fixture.engine.subscribePlaybackErrors(() => { throw new Error('independent observer failed'); });
	fixture.engine.subscribePlaybackErrors((error: unknown) => { errors.push(error); });
	try {
		await fixture.engine.playAt(0, 0);
		const graph = fixture.runtime.graph;
		assert.equal(fixture.engine.getState().state, 'playing');
		assert.equal(graph?.sources.size, 1);
		const failure = new Error('PCM read failed after priming');
		fixture.streams.handles[0]!.fail(failure);
		await nextTurn();
		assert.equal(fixture.engine.getState().state, 'stopped');
		assert.equal(fixture.runtime.graph, null);
		assert.equal(graph?.sources.size, 0);
		assert.deepEqual(errors, [failure]);
	} finally {
		await fixture.engine.dispose();
	}
});

test('a failed retired stream cannot stop its replacement playback graph', async () => {
	const fixture = createFixture([0]);
	const errors: unknown[] = [];
	fixture.engine.subscribePlaybackErrors((error: unknown) => { errors.push(error); });
	try {
		await fixture.engine.playAt(0, 0);
		const retired = fixture.streams.handles[0]!;
		fixture.engine.stop();
		await fixture.engine.playAt(0, 0);
		const replacementGraph = fixture.runtime.graph;
		retired.fail(new Error('retired source failed'));
		await nextTurn();
		assert.equal(fixture.engine.getState().state, 'playing');
		assert.equal(fixture.runtime.graph, replacementGraph);
		assert.deepEqual(errors, []);
	} finally {
		await fixture.engine.dispose();
	}
});

test('an active stream abort is reported as a playback failure', async () => {
	const fixture = createFixture([0]);
	const errors: unknown[] = [];
	fixture.engine.subscribePlaybackErrors((error: unknown) => { errors.push(error); });
	try {
		await fixture.engine.playAt(0, 0);
		const abort = new DOMException('source reader aborted', 'AbortError');
		fixture.streams.handles[0]!.fail(abort);
		await nextTurn();
		assert.equal(fixture.engine.getState().state, 'stopped');
		assert.equal(errors.length, 1);
		assert.equal((errors[0] as Error & { cause?: unknown }).cause, abort);
	} finally {
		await fixture.engine.dispose();
	}
});

test('a later clip preparation failure stops playback before another later clip finishes priming', async () => {
	const fixture = createFixture([0, 240_048, 240_096], { primeLater: false });
	const errors: unknown[] = [];
	fixture.engine.subscribePlaybackErrors((error: unknown) => { errors.push(error); });
	try {
		await fixture.engine.playAt(0, 0);
		assert.equal(fixture.streams.handles.length, 1);
		fixture.context.currentTime = 0.2;
		await waitUntil(() => fixture.streams.handles.length === 3);
		const failure = new Error('future PCM source disappeared');
		fixture.streams.handles[1]!.failPriming(failure);
		await nextTurn();
		assert.equal(fixture.engine.getState().state, 'stopped');
		assert.deepEqual(errors, [failure]);
	} finally {
		fixture.streams.handles[2]?.prime();
		await fixture.engine.dispose();
	}
});

test('a failed future clip cancels the other started future clips', async () => {
	const failure = new Error('future stream failed');
	const firstDone = deferred<void>();
	const secondDone = deferred<void>();
	let secondCancelled = false;
	let prepared = 0;
	const waiting = startLiveChunkWindow({
		plans: [{ segmentStart: 0 } as never, { segmentStart: 0 } as never],
		context: new MockAudioContext() as unknown as BaseAudioContext,
		contextStartTime: 0,
		fromFrame: 0,
		sampleRate: 48_000,
		transportRate: 1,
		signal: null,
		prepare: async (_plan) => {
			prepared += 1;
			return prepared === 1
				? { done: firstDone.promise, start() {}, cancel() {} }
				: { done: secondDone.promise, start() {}, cancel() { secondCancelled = true; } };
		},
	});
	await nextTurn();
	firstDone.reject(failure);
	await assert.rejects(waiting, (error: unknown) => error === failure);
	assert.equal(secondCancelled, true);
	secondDone.resolve();
});

test('realtime render rejects a stream failure before capture completes', async () => {
	const previousAudioContext = globalThis.AudioContext;
	const previousAudioWorkletNode = globalThis.AudioWorkletNode;
	const context = new MockRealtimeCaptureContext();
	const fixture = createFixture([0], { context });
	globalThis.AudioContext = function MockAudioContextFactory() { return context; } as unknown as typeof AudioContext;
	globalThis.AudioWorkletNode = MockCaptureNode as unknown as typeof AudioWorkletNode;
	try {
		const rendering = fixture.engine.renderMixRealtime({
			startFrame: 0, endFrame: 1, outputFrames: 1,
			onChunk: () => undefined,
		});
		void rendering.catch(() => undefined);
		await context.resumed.promise;
		const failure = new Error('PCM read failed during capture');
		fixture.streams.handles[0]!.fail(failure);
		let timer: ReturnType<typeof setTimeout> | null = null;
		const outcome = await Promise.race([
			rendering.then(() => null, (error: unknown) => error),
			new Promise((resolve) => { timer = setTimeout(() => resolve('capture still pending'), 100); }),
		]);
		if (timer) clearTimeout(timer);
		if (outcome === 'capture still pending') {
			context.capture?.emit({ type: 'audio-chunk', frameOffset: 0, frames: 1, channels: [Float32Array.of(0)] });
			context.capture?.emit({ type: 'done', frames: 1 });
			await rendering.catch(() => undefined);
		}
		assert.equal(outcome, failure);
		assert.equal(context.closeCalls, 1);
	} finally {
		await fixture.engine.dispose();
		if (previousAudioContext === undefined) Reflect.deleteProperty(globalThis, 'AudioContext');
		else globalThis.AudioContext = previousAudioContext;
		if (previousAudioWorkletNode === undefined) Reflect.deleteProperty(globalThis, 'AudioWorkletNode');
		else globalThis.AudioWorkletNode = previousAudioWorkletNode;
	}
});

function createFixture(starts: readonly number[], {
	primeLater = true, context = new MockAudioContext(),
}: { primeLater?: boolean; context?: MockAudioContext } = {}) {
	const streams = new ControlledStreams(primeLater);
	const clips = starts.map((timelineStartFrame, index) => ({
		id: `clip-${index}`, sourceId: `source-${index}`, timelineStartFrame,
		durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000,
	}));
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as never,
		chunkStreamClient: streams as never,
		chunkAudioNodeFactory: async () => context.make('chunk-stream', {
			port: { postMessage() {}, addEventListener() {}, removeEventListener() {}, start() {} },
		}) as unknown as AudioWorkletNode,
		meterInterval: 1_000,
	});
	engine.loadProject({
		id: 'stream-failure-project', sampleRate: 48_000,
		tracks: [{ id: 'track-1', type: 'audio', clipIds: clips.map((clip) => clip.id) }],
		clips,
		master: { gain: 1, pan: 0, mute: false, effects: [] },
	}, new Map(), {
		chunkSources: new Map(clips.map((clip) => [clip.sourceId, {
			channelCount: 1, frameCount: 48_000, chunkFrames: 48_000, sampleRate: 48_000,
			readStorageChunk: async () => [new Float32Array(48_000)],
		}])),
	});
	return { context, engine, runtime: engine as unknown as EngineRuntimeHost, streams };
}

class MockRealtimeCaptureContext extends MockAudioContext {
	readonly resumed = deferred<void>();
	capture: MockCaptureNode | null = null;
	closeCalls = 0;
	async suspend(): Promise<void> { this.state = 'suspended'; }
	override async resume(): Promise<void> { this.state = 'running'; this.resumed.resolve(); }
	override async close(): Promise<void> { this.closeCalls += 1; this.state = 'closed'; }
}

class MockCaptureNode extends MockNode {
	readonly port = {
		onmessage: null as ((event: { data: Readonly<Record<string, unknown>> }) => void) | null,
		postMessage(_message: unknown): void {},
		start(): void {},
	};
	onprocessorerror: (() => void) | null = null;
	constructor(context: MockRealtimeCaptureContext) {
		super('capture');
		context.capture = this;
	}
	emit(data: Readonly<Record<string, unknown>>): void { this.port.onmessage?.({ data }); }
}

class ControlledStreams {
	readonly handles: ControlledHandle[] = [];
	private readonly primeLater: boolean;
	constructor(primeLater: boolean) { this.primeLater = primeLater; }
	open() {
		const handle = new ControlledHandle();
		this.handles.push(handle);
		if (this.primeLater || this.handles.length === 1) handle.prime();
		return handle;
	}
	dispose(): void {}
}

class ControlledHandle {
	readonly ready = Promise.resolve();
	private readonly priming = deferred<void>();
	private readonly completion = deferred<void>();
	readonly primed = this.priming.promise;
	readonly done = this.completion.promise;
	readonly plays: number[] = [];
	cancelled = false;
	play(options: { contextStartFrame: number }): void { this.plays.push(options.contextStartFrame); }
	cancel(): void { this.cancelled = true; }
	prime(): void { this.priming.resolve(); }
	failPriming(error: unknown): void { this.priming.reject(error); this.completion.reject(error); }
	fail(error: unknown): void { this.completion.reject(error); }
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail; });
	return { promise, resolve: (value?: Value) => resolve(value as Value), reject };
}

function nextTurn(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

async function waitUntil(ready: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (ready()) return;
		await new Promise((resolve) => setTimeout(resolve, 2));
	}
	assert.fail('The later clips did not enter their preparation window.');
}
