/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorEngine } from '../src/common/editor/engine/runtime-class.ts';
import { scheduleProjectClips } from '../src/common/editor/engine/clip-scheduler.ts';
import { MockAudioBuffer, MockAudioContext } from './helpers/mock-audio-context.js';
import {
	MAX_LIVE_STREAM_PREPARATIONS,
	prepareLiveChunkPlans,
	startLiveChunkWindow,
} from '../src/common/editor/engine/clip-scheduler-live-chunks.ts';

test('live playback opens distant streamed clips only as they enter the preparation window', async () => {
	const context = createContext();
	const abort = new AbortController();
	const first = { ...chunkSource(), frameCount: 48_000 };
	const later = { ...chunkSource(), frameCount: 48_000 };
	const opened: unknown[] = [];
	const laterPrimed = deferred<void>();
	const laterDone = deferred<void>();
	let laterPlayed = false;
	const streams = {
		open(options: { source: unknown }) {
			opened.push(options.source);
			return {
				ready: Promise.resolve(),
				primed: options.source === later ? laterPrimed.promise : Promise.resolve(),
				done: options.source === later ? laterDone.promise : Promise.resolve(),
				play: () => { if (options.source === later) laterPlayed = true; },
				cancel: () => undefined,
			};
		},
	};
	const scheduled = await scheduleProjectClips({
		context: context as unknown as BaseAudioContext,
		project: {
			sampleRate: 48_000,
			tracks: [{ id: 'track-1', type: 'audio', clipIds: ['first', 'later'] }],
			clips: [
				{ id: 'first', sourceId: 'first-source', timelineStartFrame: 0,
					durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000 },
				{ id: 'later', sourceId: 'later-source', timelineStartFrame: 240_048,
					durationFrames: 48_000, sourceStartFrame: 0, sourceDurationFrames: 48_000 },
			],
		},
		sources: new Map(),
		chunkSources: new Map([['first-source', first], ['later-source', later]]),
		trackInputs: new Map([['track-1', new MockNode() as unknown as AudioNode]]),
		fromFrame: 0,
		toFrame: 300_000,
		contextStartTime: 0,
		sampleRate: 48_000,
		reversedBuffers: new WeakMap(),
		sourceResolver: null,
		activeSources: new Set(),
		allNodes: [] as AudioNode[],
		mode: 'live',
		chunkStreamClient: streams as never,
		chunkAudioNodeFactory: async () => new MockChunkNode() as unknown as AudioWorkletNode,
		signal: abort.signal,
	});
	assert.equal(scheduled.streamedClips, 2);
	assert.deepEqual(opened, [first], 'a later source cannot delay playback start');
	let allDone = false;
	const waiting = scheduled.waitForStreamedClips().then(() => { allDone = true; });
	context.currentTime = 0.1;
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.deepEqual(opened, [first, later]);
	assert.equal(allDone, false, 'the completion barrier includes unopened future clips');
	laterPrimed.resolve();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(laterPlayed, true);
	assert.equal(allDone, false);
	laterDone.resolve();
	await waiting;
	assert.equal(allDone, true);
	abort.abort();
});

test('live clip preparation stays bounded when many clips start together', async () => {
	const plans = Array.from({ length: 24 }, () => ({ segmentStart: 0 }) as never);
	let preparing = 0;
	let maximum = 0;
	const prepare = async () => {
		preparing += 1;
		maximum = Math.max(maximum, preparing);
		await new Promise((resolve) => setTimeout(resolve, 1));
		preparing -= 1;
		return { done: Promise.resolve(), start() {}, cancel() {} };
	};
	await prepareLiveChunkPlans(plans, prepare, null);
	assert.equal(maximum, MAX_LIVE_STREAM_PREPARATIONS);

	preparing = 0;
	maximum = 0;
	let started = 0;
	await startLiveChunkWindow({
		plans,
		context: createContext() as unknown as BaseAudioContext,
		contextStartTime: 0,
		fromFrame: 0,
		sampleRate: 48_000,
		transportRate: 1,
		signal: null,
		prepare: async (plan) => {
			const result = await prepare();
			return { ...result, start() { started += 1; assert.equal(plan.segmentStart, 0); } };
		},
	});
	assert.equal(maximum, MAX_LIVE_STREAM_PREPARATIONS);
	assert.equal(started, plans.length);
});

test('a failed concurrent preparation cancels already primed and late priming streams', async () => {
	const late = deferred<void>();
	const failure = new Error('second clip failed to prime');
	const cancelled: number[] = [];
	const plans = [0, 1, 2].map((index) => ({ index }) as never);
	const operation = prepareLiveChunkPlans(plans, async (plan) => {
		const index = (plan as unknown as { index: number }).index;
		if (index === 1) throw failure;
		if (index === 2) await late.promise;
		return { done: new Promise<void>(() => {}), start() {}, cancel() { cancelled.push(index); } };
	}, null);
	await assert.rejects(operation, failure);
	assert.deepEqual(cancelled, [0], 'a primed source must be released on failure');
	late.resolve();
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(cancelled, [0, 2], 'a preparation that finishes later must also be released');
});

test('cancelling playback clears the future preparation timer', async () => {
	const context = createContext();
	const abort = new AbortController();
	let opened = 0;
	const done = startLiveChunkWindow({
		plans: [{ segmentStart: 6 * 48_000 } as never],
		context: context as unknown as BaseAudioContext,
		contextStartTime: 0,
		fromFrame: 0,
		sampleRate: 48_000,
		transportRate: 1,
		signal: abort.signal,
		prepare: async () => {
			opened += 1;
			return { done: Promise.resolve(), start() {}, cancel() {} };
		},
	});
	abort.abort();
	await assert.rejects(done, { name: 'AbortError' });
	context.currentTime = 10;
	await new Promise((resolve) => setTimeout(resolve, 25));
	assert.equal(opened, 0);
});

test('a busy clip scheduler fails before a primed stream can start behind resident clips', async () => {
	const context = {
		...createContext(),
		createBufferSource() {
			const source = Object.assign(new MockNode(), {
				playbackRate: new MockNode().gain,
				buffer: null as AudioBuffer | null,
				start(when: number) {
					residentStarts.push(when);
					context.currentTime += .006;
				},
			});
			return source;
		},
	};
	const residentStarts: number[] = [];
	const streamStarts: number[] = [];
	let cancelled = 0;
	const clips = Array.from({ length: 5 }, (_value, index) => ({
		id: `resident-${String(index)}`, sourceId: 'resident', timelineStartFrame: 0,
		durationFrames: 1_024, sourceStartFrame: 0, sourceDurationFrames: 1_024,
	}));
	clips.push({ id: 'stream', sourceId: 'stream', timelineStartFrame: 0,
		durationFrames: 1_024, sourceStartFrame: 0, sourceDurationFrames: 1_024 });
	const resident = { sampleRate: 48_000, numberOfChannels: 1, length: 1_024 } as AudioBuffer;
	await assert.rejects(scheduleProjectClips({
		context: context as unknown as BaseAudioContext,
		project: { sampleRate: 48_000, tracks: [{ id: 'track', type: 'audio', clipIds: clips.map((clip) => clip.id) }], clips },
		sources: new Map([['resident', resident]]),
		chunkSources: new Map([['stream', { ...chunkSource(), frameCount: 1_024, chunkFrames: 256 }]]),
		trackInputs: new Map([['track', new MockNode() as unknown as AudioNode]]),
		fromFrame: 0, toFrame: 1_024, contextStartTime: 0, sampleRate: 48_000,
		reversedBuffers: new WeakMap(), sourceResolver: null,
		activeSources: new Set(), allNodes: [] as AudioNode[], mode: 'live', deferStartUntilPrimed: true,
		chunkStreamClient: { open: () => ({ ready: Promise.resolve(), primed: Promise.resolve(),
			done: new Promise(() => {}), play: ({ contextStartFrame }: { contextStartFrame: number }) => streamStarts.push(contextStartFrame),
			cancel: () => { cancelled += 1; } }) } as never,
		chunkAudioNodeFactory: async () => new MockChunkNode() as unknown as AudioWorkletNode,
	}), /shared playback start/iu);
	assert.ok(residentStarts.length >= 1, 'an earlier resident source was scheduled');
	assert.deepEqual(streamStarts, [], 'a late stream cannot silently begin from its first packet');
	assert.equal(cancelled, 1);
});

test('short streamed and resident clips share the same context frame', async () => {
	const residentStarts: number[] = [];
	const streamStarts: number[] = [];
	const streamEnds: number[] = [];
	const finished = deferred<void>();
	const context = {
		...createContext(),
		createBufferSource: () => Object.assign(new MockNode(), {
			playbackRate: new MockNode().gain,
			buffer: null as AudioBuffer | null,
			start: (when: number) => { residentStarts.push(when); },
		}),
	};
	const clips = [
		{ id: 'resident', sourceId: 'resident', timelineStartFrame: 0,
			durationFrames: 1_024, sourceStartFrame: 0, sourceDurationFrames: 1_024 },
		{ id: 'stream', sourceId: 'stream', timelineStartFrame: 0,
			durationFrames: 1_024, sourceStartFrame: 0, sourceDurationFrames: 1_024 },
	];
	const scheduled = await scheduleProjectClips({
		context: context as unknown as BaseAudioContext,
		project: { sampleRate: 48_000, tracks: [{ id: 'track', type: 'audio', clipIds: clips.map((clip) => clip.id) }], clips },
		sources: new Map([['resident', { sampleRate: 48_000, numberOfChannels: 1, length: 1_024 } as AudioBuffer]]),
		chunkSources: new Map([['stream', { ...chunkSource(), frameCount: 1_024, chunkFrames: 256 }]]),
		trackInputs: new Map([['track', new MockNode() as unknown as AudioNode]]),
		fromFrame: 0, toFrame: 480, contextStartTime: 0, sampleRate: 48_000,
		reversedBuffers: new WeakMap(), sourceResolver: null,
		activeSources: new Set(), allNodes: [] as AudioNode[], mode: 'live', deferStartUntilPrimed: true,
		chunkStreamClient: { open: (options: { endFrame: number }) => {
			streamEnds.push(options.endFrame);
			return { ready: Promise.resolve(), primed: Promise.resolve(), done: finished.promise,
				play: ({ contextStartFrame }: { contextStartFrame: number }) => { streamStarts.push(contextStartFrame); },
				cancel: () => undefined };
		} } as never,
		chunkAudioNodeFactory: async () => new MockChunkNode() as unknown as AudioWorkletNode,
	});
	assert.equal(scheduled.contextStartTime, .02);
	assert.deepEqual(residentStarts, [.02]);
	assert.deepEqual(streamStarts, [960]);
	assert.deepEqual(streamEnds, [480], 'the stream is trimmed to the short play range');
	finished.resolve();
	await scheduled.waitForStreamedClips();
});

test('a later stream whose preparation misses its playback frame fails the completion barrier', async () => {
	const residentStarts: number[] = [];
	const context = {
		...createContext(),
		createBufferSource: () => Object.assign(new MockNode(), {
			playbackRate: new MockNode().gain,
			buffer: null as AudioBuffer | null,
			start: (when: number) => { residentStarts.push(when); },
		}),
	};
	let cancelled = 0;
	let played = false;
	const scheduled = await scheduleProjectClips({
		context: context as unknown as BaseAudioContext,
		project: {
			sampleRate: 48_000,
			tracks: [{ id: 'track', type: 'audio', clipIds: ['resident', 'later'] }],
			clips: [
				{ id: 'resident', sourceId: 'resident', timelineStartFrame: 0,
					durationFrames: 1_024, sourceStartFrame: 0, sourceDurationFrames: 1_024 },
				{ id: 'later', sourceId: 'later', timelineStartFrame: 240_048,
					durationFrames: 1_024, sourceStartFrame: 0, sourceDurationFrames: 1_024 },
			],
		},
		sources: new Map([['resident', { sampleRate: 48_000, numberOfChannels: 1, length: 1_024 } as AudioBuffer]]),
		chunkSources: new Map([['later', { ...chunkSource(), frameCount: 1_024, chunkFrames: 256 }]]),
		trackInputs: new Map([['track', new MockNode() as unknown as AudioNode]]),
		fromFrame: 0, toFrame: 241_072, contextStartTime: 0, sampleRate: 48_000,
		reversedBuffers: new WeakMap(), sourceResolver: null,
		activeSources: new Set(), allNodes: [] as AudioNode[], mode: 'live', deferStartUntilPrimed: true,
		chunkStreamClient: { open: () => ({ ready: Promise.resolve(), primed: Promise.resolve(),
			done: new Promise<void>(() => {}), play: () => { played = true; },
			cancel: () => { cancelled += 1; } }) } as never,
		chunkAudioNodeFactory: async () => new MockChunkNode() as unknown as AudioWorkletNode,
	});
	assert.equal(scheduled.contextStartTime, .02);
	assert.deepEqual(residentStarts, [.02]);
	context.currentTime = 5.022;
	await assert.rejects(scheduled.waitForStreamedClips(), /shared playback start/iu);
	assert.equal(played, false);
	assert.equal(cancelled, 1);
});

test('a missed shared start rejects Play and halts already scheduled resident sources', async () => {
	const context = new MockAudioContext({ sampleRate: 48_000 });
	const makeSource = context.createBufferSource.bind(context);
	context.createBufferSource = () => {
		const source = makeSource() as ReturnType<typeof makeSource> & {
			start: (when: number, offset: number, duration: number) => void;
		};
		const start = source.start;
		source.start = (when: number, offset: number, duration: number) => {
			start(when, offset, duration);
			context.currentTime += .006;
		};
		return source;
	};
	const clips = Array.from({ length: 5 }, (_value, index) => ({
		id: `resident-${String(index)}`, sourceId: 'resident', timelineStartFrame: 0,
		durationFrames: 1_024, sourceStartFrame: 0, sourceDurationFrames: 1_024,
	}));
	clips.push({ id: 'stream', sourceId: 'stream', timelineStartFrame: 0,
		durationFrames: 1_024, sourceStartFrame: 0, sourceDurationFrames: 1_024 });
	let cancelled = 0;
	let played = false;
	const engine = createAudioEditorEngine({
		audioContextFactory: () => context as never,
		chunkStreamClient: { open: () => ({ ready: Promise.resolve(), primed: Promise.resolve(),
			done: new Promise<void>(() => {}), play: () => { played = true; },
			cancel: () => { cancelled += 1; } }) } as never,
		chunkAudioNodeFactory: async () => new MockChunkNode() as unknown as AudioWorkletNode,
	});
	try {
		engine.loadProject({
			sampleRate: 48_000,
			masterChannels: 1,
			tracks: [{ id: 'track', type: 'audio', clipIds: clips.map((clip) => clip.id) }],
			clips,
			master: { gain: 1, pan: 0, mute: false, effects: [] },
		}, new Map([['resident', new MockAudioBuffer(1, 1_024, 48_000) as unknown as AudioBuffer]]), {
			chunkSources: new Map([['stream', { ...chunkSource(), frameCount: 1_024, chunkFrames: 256 }]]),
		});
		await assert.rejects(engine.play(), /shared playback start/iu);
		assert.ok(context.bufferSources.some((source) => source.started), 'an earlier resident source was scheduled');
		assert.ok(context.bufferSources.filter((source) => source.started).every((source) => source.stopped));
		assert.equal(played, false);
		assert.ok(cancelled >= 1);
		assert.equal(engine.getState().state, 'stopped');
	} finally {
		await engine.dispose();
	}
});

test('a failed stream play posts its error through the completion barrier', async () => {
	const failure = new Error('Worklet play post failed');
	let rejectDone!: (error: Error) => void;
	const done = new Promise<void>((_resolve, reject) => { rejectDone = reject; });
	const scheduled = await scheduleProjectClips({
		context: createContext() as unknown as BaseAudioContext,
		project: {
			sampleRate: 48_000,
			tracks: [{ id: 'track', type: 'audio', clipIds: ['stream'] }],
			clips: [{ id: 'stream', sourceId: 'stream', timelineStartFrame: 0,
				durationFrames: 1_024, sourceStartFrame: 0, sourceDurationFrames: 1_024 }],
		},
		sources: new Map(),
		chunkSources: new Map([['stream', { ...chunkSource(), frameCount: 1_024, chunkFrames: 256 }]]),
		trackInputs: new Map([['track', new MockNode() as unknown as AudioNode]]),
		fromFrame: 0, toFrame: 1_024, contextStartTime: 0, sampleRate: 48_000,
		reversedBuffers: new WeakMap(), sourceResolver: null,
		activeSources: new Set(), allNodes: [] as AudioNode[], mode: 'live', deferStartUntilPrimed: true,
		chunkStreamClient: { open: () => ({ ready: Promise.resolve(), primed: Promise.resolve(), done,
			play: () => { rejectDone(failure); return Promise.reject(failure); },
			cancel: () => undefined }) } as never,
		chunkAudioNodeFactory: async () => new MockChunkNode() as unknown as AudioWorkletNode,
	});
	await assert.rejects(scheduled.waitForStreamedClips(), failure);
});

function createContext() {
	return {
		sampleRate: 48_000,
		currentTime: 0,
		createGain: () => new MockNode(),
	};
}

class MockNode {
	readonly gain = {
		value: 1,
		setValueAtTime(value: number) { this.value = value; },
		linearRampToValueAtTime(value: number) { this.value = value; },
	};
	connect(target: unknown): unknown { return target; }
	disconnect(): void {}
}

class MockChunkNode extends MockNode {
	readonly port = { postMessage() {}, addEventListener() {}, removeEventListener() {}, start() {} };
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

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve: (value?: Value) => resolve(value as Value) };
}
