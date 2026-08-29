import assert from 'node:assert/strict';
import test from 'node:test';

import { ClipTimePitchRenderCacheCoordinator } from '../src/common/editor/clip-time-pitch-cache.js';
import { createAudioClip, createAudioSource } from '../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../src/common/editor/storage.js';

test('clearing during a late cache commit drains the job without republishing it', async () => {
	const store = await sourceStore('clear-late-commit');
	const originalBeginSourceWrite = store.beginSourceWrite.bind(store);
	const commitStarted = deferred();
	const commitGate = deferred();
	store.beginSourceWrite = async (...args) => {
		const writer = await originalBeginSourceWrite(...args);
		return {
			...writer,
			async commit(metadata) {
				commitStarted.resolve();
				await commitGate.promise;
				// Model a storage boundary already past its cancellable phase.
				return writer.commit(metadata);
			},
		};
	};
	const coordinator = new ClipTimePitchRenderCacheCoordinator({ store, client: new FakeStaffPadClient() });
	const request = await coordinator.requestClipRender(clipFixture(), sourceFixture());
	await commitStarted.promise;

	const clearing = coordinator.clear();
	assert.equal(coordinator.clear(), clearing, 'concurrent clear callers share the same drain');
	assert.deepEqual([...coordinator.getProtectedSourceIds()], []);
	commitGate.resolve();
	await clearing;
	await assert.rejects(request.pending, (error) => error.code === 'ABORTED');
	assert.equal(coordinator.getResidentChannelBytes(), 0);
	assert.equal(coordinator.getCommitted(request.plan.finalKey), null);
	assert.deepEqual([...coordinator.getProtectedSourceIds()], []);
	await coordinator.dispose();
});

test('clearing fences a request paused before its committed-cache lookup completes', async () => {
	const store = await sourceStore('clear-pre-job');
	const originalGetSourceMetadata = store.getSourceMetadata.bind(store);
	const lookupStarted = deferred();
	const lookupGate = deferred();
	store.getSourceMetadata = async (sourceId) => {
		if (sourceId !== 'source-a') {
			lookupStarted.resolve();
			await lookupGate.promise;
		}
		return originalGetSourceMetadata(sourceId);
	};
	const client = new FakeStaffPadClient();
	const coordinator = new ClipTimePitchRenderCacheCoordinator({ store, client });
	const requesting = coordinator.requestClipRender(clipFixture(), sourceFixture());
	await lookupStarted.promise;

	await coordinator.clear();
	lookupGate.resolve();
	await assert.rejects(requesting, (error) => error.code === 'ABORTED');
	assert.equal(client.calls.length, 0, 'the stale request never creates a render job');
	assert.equal(coordinator.getResidentChannelBytes(), 0);
	assert.deepEqual([...coordinator.getProtectedSourceIds()], []);
	await coordinator.dispose();
});

function sourceFixture() {
	return createAudioSource({
		id: 'source-a', storageKey: 'source-a', name: 'Source A', mimeType: 'audio/wav',
		frameCount: 32, channelCount: 1, sampleRate: 8_000, originalSampleRate: 8_000,
	});
}

function clipFixture() {
	return createAudioClip({
		id: 'clip-a', sourceId: 'source-a', title: 'Clip A', timelineStartFrame: 0,
		sourceStartFrame: 0, sourceDurationFrames: 16, durationFrames: 16, speedRatio: 1,
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
	constructor() { this.calls = []; }

	async render(request) {
		this.calls.push(request);
		return {
			channels: request.channels.map((input) => Float32Array.from(
				{ length: request.outputFrames },
				(_, frame) => input[request.selection.startFrame
					+ Math.min(request.selection.frameCount - 1, frame)],
			)),
		};
	}

	dispose() {}
}

function deferred() {
	let resolve;
	const promise = new Promise((accept) => { resolve = accept; });
	return { promise, resolve };
}
