/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { scheduleProjectClips } from '../src/common/editor/engine/clip-scheduler.ts';
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
