import assert from 'node:assert/strict';
import test from 'node:test';

import {
	CLIP_TIME_PITCH_CACHE_ALGORITHM_REVISION,
	ClipTimePitchRenderCacheCoordinator,
	cacheSourceIdForKey,
	deriveClipTimePitchCachePlan,
	describeClipTimePitchRender,
	loadStoredSourceChannels,
} from '../src/common/editor/clip-time-pitch-cache.js';
import { createAudioClipV2, createAudioSourceV2 } from '../src/common/editor/project-v2.js';
import { createProjectStore } from '../src/common/editor/storage.js';

test('clip StaffPad plans key every immutable input and chain sequential extreme-speed passes', async () => {
	const source = sourceFixture();
	const clip = clipFixture({
		sourceStartFrame: 4,
		sourceDurationFrames: 16,
		durationFrames: 2,
		pitchCents: 300,
		speedRatio: 8,
		preserveFormants: true,
		renderCacheRevision: 7,
	});
	const described = describeClipTimePitchRender(clip, source);
	assert.equal(described.algorithmRevision, CLIP_TIME_PITCH_CACHE_ALGORITHM_REVISION);
	assert.deepEqual(described.stages.map((stage) => stage.tempoRatio), [2, 2, 2]);
	assert.deepEqual(described.stages.map((stage) => stage.outputFrames), [8, 4, 2]);
	assert.deepEqual(described.stages.map((stage) => stage.pitchCents), [300, 0, 0]);
	assert.equal(described.warnings[0].code, 'STAFFPAD_TIME_RATIO_OUTSIDE_TESTED_RANGE');

	const plan = await deriveClipTimePitchCachePlan(clip, source);
	assert.match(plan.finalKey, /^audio-editor-time-pitch-v1:[0-9a-f]{64}$/);
	assert.equal(plan.stages[1].descriptor.input.cacheKey, plan.stages[0].cacheKey);
	assert.equal(plan.stages[2].descriptor.input.cacheKey, plan.stages[1].cacheKey);
	assert.equal(plan.cacheSourceId.endsWith(plan.finalKey.split(':')[1]), true);

	const variants = [
		[{ ...clip, sourceStartFrame: 5 }, source],
		[{ ...clip, pitchCents: 301 }, source],
		[{ ...clip, speedRatio: 7.9 }, source],
		[{ ...clip, preserveFormants: false }, source],
		[{ ...clip, reversed: true }, source],
		[{ ...clip, renderCacheRevision: 8 }, source],
		[clip, { ...source, sampleRate: 16_000 }],
		[clip, { ...source, opaqueExtensions: { revision: 1 } }],
	];
	for (const [variantClip, variantSource] of variants) {
		assert.notEqual((await deriveClipTimePitchCachePlan(variantClip, variantSource)).finalKey, plan.finalKey);
	}
	assert.throws(() => describeClipTimePitchRender({ ...clip, pitchCents: 1_201 }, source), /between -1200 and 1200/);
	assert.throws(() => describeClipTimePitchRender({ ...clip, speedRatio: 0 }, source), /finite and positive/);
	assert.throws(() => describeClipTimePitchRender({ ...clip, sourceDurationFrames: 99 }, source), (error) => (
		error.code === 'INVALID_SOURCE_RANGE'
	));
});

test('the coordinator deduplicates renders, publishes atomically, and hydrates persisted exact caches', async () => {
	const store = await sourceStore('dedupe');
	const source = sourceFixture();
	const clip = clipFixture();
	const client = new FakeStaffPadClient();
	const coordinator = new ClipTimePitchRenderCacheCoordinator({ store, client, chunkFrames: 1_024 });
	const [first, second] = await Promise.all([
		coordinator.prepareCommittedOutput(clip, source),
		coordinator.prepareCommittedOutput(clip, source),
	]);
	assert.equal(client.calls.length, 1);
	assert.equal(first, second);
	assert.equal(first.frameCount, 16);
	const metadata = await store.getSourceMetadata(first.cacheSourceId);
	assert.equal(metadata.cacheKey, first.cacheKey);
	assert.equal(metadata.cacheSchemaVersion, 1);
	assert.equal(metadata.frameCount, 16);
	assert.equal(first.channels[0], client.calls[0].outputChannels[0], 'owned StaffPad output is adopted without a second full copy');
	assert.deepEqual([...coordinator.getProtectedSourceIds()], [first.cacheSourceId]);
	const chunks = [];
	for await (const chunk of store.readSourceChunks(first.cacheSourceId)) chunks.push(chunk);
	assert.equal(chunks.reduce((sum, chunk) => sum + chunk.frames, 0), 16);

	const reloadedClient = new FakeStaffPadClient();
	const reloaded = new ClipTimePitchRenderCacheCoordinator({ store, client: reloadedClient });
	const hydrated = await reloaded.prepareCommittedOutput(clip, source);
	assert.equal(hydrated.cacheKey, first.cacheKey);
	assert.equal(hydrated.channels, null);
	assert.equal(reloadedClient.calls.length, 0, 'an exact atomic store entry avoids rerendering');
	assert.deepEqual(
		(await reloaded.loadCommittedChannels(hydrated)).map((channel) => [...channel]),
		first.channels.map((channel) => [...channel]),
	);
	coordinator.dispose();
	reloaded.dispose();
});

test('resident planar caches are LRU-bounded while evicted entries stay canonical on disk', async () => {
	const store = await sourceStore('resident-budget');
	const source = sourceFixture();
	const client = new FakeStaffPadClient();
	const coordinator = new ClipTimePitchRenderCacheCoordinator({
		store,
		client,
		maximumResidentChannelBytes: 32 * Float32Array.BYTES_PER_ELEMENT,
	});
	const firstClip = clipFixture({ id: 'clip-first' });
	const secondClip = clipFixture({ id: 'clip-second', pitchCents: 100, renderCacheRevision: 1 });
	const thirdClip = clipFixture({ id: 'clip-third', pitchCents: 200, renderCacheRevision: 2 });
	const first = await coordinator.prepareCommittedOutput(firstClip, source);
	assert.equal(coordinator.getResidentChannelBytes(), 64);
	assert.ok(first.channels);

	const second = await coordinator.prepareCommittedOutput(secondClip, source);
	assert.equal(coordinator.getResidentChannelBytes(), 128);
	coordinator.getCommitted(first.cacheKey);
	const third = await coordinator.prepareCommittedOutput(thirdClip, source);
	assert.equal(coordinator.getResidentChannelBytes(), 128);
	assert.ok(first.channels, 'reading an entry refreshes its LRU position');
	assert.equal(second.channels, null, 'the least recently used planar copy is released');
	assert.ok(third.channels);
	assert.deepEqual(
		new Set(coordinator.getProtectedSourceIds()),
		new Set([first.cacheSourceId, second.cacheSourceId, third.cacheSourceId]),
		'eviction does not alter cache-source storage retention',
	);
	assert.ok(await store.getSourceMetadata(second.cacheSourceId));
	assert.deepEqual(
		(await coordinator.loadCommittedChannels(second))[0],
		client.calls[1].outputChannels[0],
		'evicted PCM is read back from its committed source',
	);

	const buffer = new MockAudioBuffer(third.channelCount, third.frameCount, third.sampleRate);
	coordinator.attachAudioBuffer(third.cacheKey, buffer);
	assert.equal(third.channels, null, 'the redundant planar copy is dropped once playback has an AudioBuffer');
	assert.equal(coordinator.getResidentChannelBytes(), 64);
	assert.equal(coordinator.createEngineSourceResolver()(thirdClip).buffer, buffer);
	assert.deepEqual((await coordinator.loadCommittedChannels(third))[0], client.calls[2].outputChannels[0]);
	coordinator.dispose();
});

test('a zero resident budget publishes disk-only cache entries without changing their API', async () => {
	const store = await sourceStore('disk-only');
	const source = sourceFixture();
	const client = new FakeStaffPadClient();
	const coordinator = new ClipTimePitchRenderCacheCoordinator({
		store,
		client,
		maximumResidentChannelBytes: 0,
	});
	const clip = clipFixture();
	const entry = await coordinator.prepareCommittedOutput(clip, source);
	assert.equal(entry.channels, null);
	assert.equal(coordinator.getResidentChannelBytes(), 0);
	assert.deepEqual((await coordinator.loadCommittedChannels(entry))[0], client.calls[0].outputChannels[0]);
	assert.equal(coordinator.getCommitted(entry.cacheKey), entry);
	assert.deepEqual([...coordinator.getProtectedSourceIds()], [entry.cacheSourceId]);
	coordinator.dispose();
});

test('StaffPad transfers coordinator-owned stage input but preserves borrowed loader arrays', async () => {
	const source = sourceFixture();
	const clip = clipFixture({ speedRatio: 8, durationFrames: 2 });
	const storedClient = new FakeStaffPadClient();
	const stored = new ClipTimePitchRenderCacheCoordinator({
		store: await sourceStore('transfer-stored'),
		client: storedClient,
	});
	await stored.prepareCommittedOutput(clip, source);
	assert.deepEqual(
		storedClient.calls.map((call) => call.transferInput),
		[true, true, true],
		'store reads and intermediate output can move to the worker without cloning',
	);
	stored.dispose();

	const borrowedChannels = [Float32Array.from({ length: 32 }, (_, index) => index)];
	const borrowedClient = new FakeStaffPadClient();
	const borrowed = new ClipTimePitchRenderCacheCoordinator({
		store: await sourceStore('transfer-borrowed'),
		client: borrowedClient,
		loadSourceChannels: async () => borrowedChannels,
	});
	await borrowed.prepareCommittedOutput({ ...clip, renderCacheRevision: 1 }, source);
	assert.deepEqual(
		borrowedClient.calls.map((call) => call.transferInput),
		[false, true, true],
		'custom loader output remains borrowed while later StaffPad output is owned',
	);
	assert.equal(borrowedChannels[0].byteLength, 32 * Float32Array.BYTES_PER_ELEMENT);
	borrowed.dispose();
});

test('playback retains the last valid cache while a new revision renders and export waits for it', async () => {
	const store = await sourceStore('stale');
	const source = sourceFixture();
	const client = new FakeStaffPadClient();
	const coordinator = new ClipTimePitchRenderCacheCoordinator({ store, client });
	const original = clipFixture();
	const first = await coordinator.prepareCommittedOutput(original, source);
	const gate = client.blockNext();
	const changed = { ...original, pitchCents: 400, renderCacheRevision: 1 };
	const playback = await coordinator.resolveForPlayback(changed, source);
	assert.equal(playback.stale, true);
	assert.equal(playback.cacheKey, first.cacheKey);
	assert.notEqual(playback.desiredCacheKey, first.cacheKey);
	assert.equal(coordinator.getLastValid(changed.id).cacheKey, first.cacheKey);

	let exportFinished = false;
	const exporting = coordinator.prepareCommittedOutput(changed, source).then((entry) => {
		exportFinished = true;
		return entry;
	});
	await Promise.resolve();
	assert.equal(exportFinished, false);
	gate.resolve();
	const refreshed = await playback.pending;
	const exported = await exporting;
	assert.equal(exported.cacheKey, refreshed.cacheKey);
	assert.equal(exported.renderCacheRevision, 1);
	assert.equal(coordinator.getLastValid(changed.id).cacheKey, refreshed.cacheKey);
	assert.equal(client.calls.length, 2, 'playback and export join the same updated render');
	coordinator.dispose();
});

test('shared renders isolate subscriber aborts and cancel StaffPad only after the last subscriber leaves', async () => {
	const store = await sourceStore('abort');
	const source = sourceFixture();
	const client = new FakeStaffPadClient();
	const coordinator = new ClipTimePitchRenderCacheCoordinator({ store, client });
	const one = new AbortController();
	const two = new AbortController();
	const gate = client.blockNext();
	const clip = clipFixture({ renderCacheRevision: 3 });
	const firstRequest = await coordinator.requestClipRender(clip, source, { signal: one.signal });
	const secondRequest = await coordinator.requestClipRender(clip, source, { signal: two.signal });
	const first = firstRequest.pending;
	const second = secondRequest.pending;
	one.abort();
	await assert.rejects(first, (error) => error.name === 'AbortError' && error.code === 'ABORTED');
	assert.equal(client.calls[0].signal.aborted, false, 'the remaining subscriber keeps the shared render alive');
	gate.resolve();
	assert.equal((await second).renderCacheRevision, 3);
	assert.equal(client.calls.length, 1);

	const cancelGate = client.blockNext();
	const changed = { ...clip, renderCacheRevision: 4 };
	const three = new AbortController();
	const four = new AbortController();
	const thirdRequest = await coordinator.requestClipRender(changed, source, { signal: three.signal });
	const fourthRequest = await coordinator.requestClipRender(changed, source, { signal: four.signal });
	const third = thirdRequest.pending;
	const fourth = fourthRequest.pending;
	three.abort();
	four.abort();
	await assert.rejects(third, (error) => error.name === 'AbortError');
	await assert.rejects(fourth, (error) => error.name === 'AbortError');
	assert.equal(client.calls[1].signal.aborted, true);
	cancelGate.resolve();
	assert.equal(await store.getSourceMetadata((await coordinator.plan(changed, source)).cacheSourceId), null);
	coordinator.dispose();
});

test('quota failures are structured, abort publication, and do not replace the last valid cache', async () => {
	const store = await sourceStore('quota');
	const source = sourceFixture();
	const client = new FakeStaffPadClient();
	const coordinator = new ClipTimePitchRenderCacheCoordinator({ store, client });
	const original = clipFixture();
	const committed = await coordinator.prepareCommittedOutput(original, source);
	store.estimateStorage = async () => ({ usage: 100, quota: 120 });
	const changed = { ...original, pitchCents: 100, renderCacheRevision: 1 };
	await assert.rejects(
		coordinator.prepareCommittedOutput(changed, source),
		(error) => error.code === 'QUOTA_EXCEEDED' && error.details.available === 20,
	);
	assert.equal(client.calls.length, 1, 'quota is checked before starting StaffPad');
	assert.equal(coordinator.getLastValid(original.id).cacheKey, committed.cacheKey);
	assert.equal(await store.getSourceMetadata((await coordinator.plan(changed, source)).cacheSourceId), null);

	store.estimateStorage = async () => ({ usage: null, quota: null });
	const originalBeginSourceWrite = store.beginSourceWrite.bind(store);
	store.beginSourceWrite = async (...args) => {
		const writer = await originalBeginSourceWrite(...args);
		return {
			...writer,
			async commit() {
				await writer.abort();
				const error = new Error('mock storage limit');
				error.name = 'QuotaExceededError';
				throw error;
			},
		};
	};
	const commitFailure = { ...original, pitchCents: 200, renderCacheRevision: 2 };
	await assert.rejects(
		coordinator.prepareCommittedOutput(commitFailure, source),
		(error) => error.code === 'QUOTA_EXCEEDED' && /quota/i.test(error.message),
	);
	assert.equal(coordinator.getLastValid(original.id).cacheKey, committed.cacheKey);
	coordinator.dispose();
});

test('reverse renders materialize direction before StaffPad and engine resolver exposes only committed buffers', async () => {
	const store = await sourceStore('reverse');
	const source = sourceFixture();
	const client = new FakeStaffPadClient();
	const coordinator = new ClipTimePitchRenderCacheCoordinator({ store, client });
	const clip = clipFixture({ reversed: true, pitchCents: 100, sourceStartFrame: 4, sourceDurationFrames: 4, durationFrames: 4 });
	const entry = await coordinator.prepareCommittedOutput(clip, source);
	assert.deepEqual([...client.calls[0].request.channels[0]], [...Float32Array.from({ length: 32 }, (_, index) => 31 - index)]);
	assert.deepEqual(client.calls[0].request.selection, { startFrame: 24, frameCount: 4 });
	const resolver = coordinator.createEngineSourceResolver();
	assert.equal(resolver(clip), null);
	const buffer = new MockAudioBuffer(entry.channelCount, entry.frameCount, entry.sampleRate);
	coordinator.attachAudioBuffer(entry.cacheKey, buffer);
	assert.equal(entry.channels, null);
	assert.deepEqual(resolver(clip), {
		buffer,
		sourceStartFrame: 0,
		sourceDurationFrames: entry.frameCount,
		reversed: false,
	});
	assert.equal(resolver({ ...clip, pitchCents: 0, speedRatio: 1 }), null);
	coordinator.retainClipIds([]);
	assert.equal(coordinator.getCommitted(entry.cacheKey), null);
	assert.deepEqual([...coordinator.getProtectedSourceIds()], []);
	coordinator.dispose();
});

test('cache APIs fail closed on invalid models, buffers, store chunks, and StaffPad output', async () => {
	const source = sourceFixture();
	const clip = clipFixture();
	assert.throws(() => describeClipTimePitchRender(null, source), /V2 audio clip/);
	assert.throws(() => describeClipTimePitchRender(clip, null), /V2 audio source/);
	assert.throws(() => describeClipTimePitchRender({ ...clip, sourceId: 'other' }, source), (error) => error.code === 'SOURCE_MISMATCH');
	assert.throws(() => describeClipTimePitchRender(clip, source, { maximumOutputBytes: 1 }), (error) => error.code === 'OUTPUT_LIMIT_EXCEEDED');
	assert.throws(() => cacheSourceIdForKey('not-a-cache-key'), /cache key/);
	assert.throws(() => new ClipTimePitchRenderCacheCoordinator(), /project store/);

	const store = await sourceStore('invalid');
	const client = new FakeStaffPadClient();
	const coordinator = new ClipTimePitchRenderCacheCoordinator({ store, client });
	assert.equal(coordinator.describe(clip, source).clipId, clip.id);
	assert.equal(coordinator.getCommitted('missing'), null);
	await assert.rejects(coordinator.loadCommittedChannels('missing'), (error) => error.code === 'CACHE_MISS');
	assert.throws(() => coordinator.attachAudioBuffer('missing', {}), (error) => error.code === 'CACHE_MISS');
	const entry = await coordinator.prepareCommittedOutput(clip, source);
	assert.throws(() => coordinator.attachAudioBuffer(entry.cacheKey, {}), /AudioBuffer-compatible/);
	assert.throws(
		() => coordinator.attachAudioBuffer(entry.cacheKey, new MockAudioBuffer(1, entry.frameCount + 1, entry.sampleRate)),
		(error) => error.code === 'BUFFER_MISMATCH',
	);

	await assert.rejects(loadStoredSourceChannels({}, source), /cannot read source chunks/);
	await assert.rejects(loadStoredSourceChannels({
		async *readSourceChunks() { yield { frames: 1, channels: [] }; },
	}, source), (error) => error.code === 'CORRUPT_SOURCE');
	await assert.rejects(loadStoredSourceChannels({
		async *readSourceChunks() { yield { frames: 33, channels: [new Float32Array(33)] }; },
	}, source), (error) => error.code === 'CORRUPT_SOURCE');
	await assert.rejects(loadStoredSourceChannels({
		async *readSourceChunks() { yield { frames: 32, channels: [new Uint8Array(32)] }; },
	}, source), (error) => error.code === 'CORRUPT_SOURCE');
	await assert.rejects(loadStoredSourceChannels({
		async *readSourceChunks() { yield { frames: 2, channels: [new Float32Array(2)] }; },
	}, source), (error) => error.code === 'CORRUPT_SOURCE');

	const invalidOutput = new ClipTimePitchRenderCacheCoordinator({
		store,
		client: { async render() { return { channels: [] }; } },
	});
	await assert.rejects(
		invalidOutput.prepareCommittedOutput({ ...clip, renderCacheRevision: 99 }, source),
		(error) => error.code === 'INVALID_RENDER_OUTPUT',
	);
	invalidOutput.dispose();
	coordinator.dispose();
	assert.throws(() => coordinator.describe(null, source), /V2 audio clip/);
	await assert.rejects(coordinator.requestClipRender(clip, source), (error) => error.code === 'DISPOSED');
});

function sourceFixture(options = {}) {
	return createAudioSourceV2({
		id: 'source-a',
		storageKey: 'source-a',
		name: 'Source A',
		mimeType: 'audio/wav',
		frameCount: 32,
		channelCount: 1,
		sampleRate: 8_000,
		originalSampleRate: 8_000,
		...options,
	});
}

function clipFixture(options = {}) {
	return createAudioClipV2({
		id: 'clip-a',
		sourceId: 'source-a',
		title: 'Clip A',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 16,
		durationFrames: 16,
		speedRatio: 1,
		...options,
	});
}

async function sourceStore(name) {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `clip-time-pitch-${name}-${Date.now()}-${Math.random()}`,
		storageManager: null,
	});
	const writer = await store.beginSourceWrite('source-a', { sampleRate: 8_000, channelCount: 1 });
	await writer.write([Float32Array.from({ length: 32 }, (_, index) => index)]);
	await writer.commit();
	return store;
}

class FakeStaffPadClient {
	constructor() {
		this.calls = [];
		this.gates = [];
		this.waiters = [];
	}

	blockNext() {
		const gate = deferred();
		this.gates.push(gate);
		return gate;
	}

	async waitForCalls(count) {
		if (this.calls.length >= count) return;
		const waiter = deferred();
		this.waiters.push({ count, waiter });
		await waiter.promise;
	}

	async render(request, options = {}) {
		const gate = this.gates.shift() || null;
		const call = {
			request,
			signal: options.signal,
			cacheKey: options.cacheKey,
			transferInput: options.transferInput,
			outputChannels: null,
		};
		this.calls.push(call);
		for (const entry of this.waiters.splice(0)) {
			if (this.calls.length >= entry.count) entry.waiter.resolve();
			else this.waiters.push(entry);
		}
		if (gate) await waitWithAbort(gate.promise, options.signal);
		if (options.signal?.aborted) throw abortError();
		options.onProgress?.(0.5);
		const channels = request.channels.map((input) => {
			const output = new Float32Array(request.outputFrames);
			for (let frame = 0; frame < output.length; frame += 1) {
				const sourceFrame = request.selection.startFrame
					+ Math.min(request.selection.frameCount - 1, Math.floor(frame * request.selection.frameCount / output.length));
				output[frame] = input[sourceFrame];
			}
			return output;
		});
		call.outputChannels = channels;
		options.onProgress?.(1);
		return { channels, cacheKey: options.cacheKey };
	}

	dispose() {}
}

class MockAudioBuffer {
	constructor(channelCount, length, sampleRate) {
		this.numberOfChannels = channelCount;
		this.length = length;
		this.sampleRate = sampleRate;
		this.channels = Array.from({ length: channelCount }, () => new Float32Array(length));
	}

	getChannelData(channel) {
		return this.channels[channel];
	}
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

function waitWithAbort(promise, signal) {
	if (!signal) return promise;
	if (signal.aborted) return Promise.reject(abortError());
	return new Promise((resolve, reject) => {
		const abort = () => reject(abortError());
		signal.addEventListener('abort', abort, { once: true });
		promise.then(
			(value) => { signal.removeEventListener('abort', abort); resolve(value); },
			(error) => { signal.removeEventListener('abort', abort); reject(error); },
		);
	});
}

function abortError() {
	const error = new Error('cancelled');
	error.name = 'AbortError';
	return error;
}
