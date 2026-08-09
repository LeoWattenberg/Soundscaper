/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createStorageRepositories } from '../src/common/editor/storage/repositories.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { LinkedOriginalPort } from '../src/common/editor/storage/linked-original-resolver.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const LOCATOR_ID = 'locator_audio_000000000001';
const LOCATOR_REVISION = 'snapshot_audio_0000000001';

test('storage composition exposes verified linked WAV PCM through canonical source reads', async () => {
	const body = wavBlob(Float32Array.of(-1, -0.25, 0.25, 1));
	let loads = 0;
	const repositories = createStorageRepositories({
		memory: getMemoryDatabase(`linked-audio-composition-${Date.now()}-${Math.random()}`),
		database: async () => null,
	}, {
		revisionLimit: 20,
		preferOpfs: false,
		storageManager: null,
		opfsRoot: null,
		migrateLegacyPcmOnAccess: false,
		linkedOriginalPort: {
			load(kind, locatorId, { expectedRevision }) {
				loads += 1;
				assert.equal(kind, 'audio');
				assert.equal(locatorId, LOCATOR_ID);
				return { blob: body, locatorRevision: expectedRevision ?? LOCATOR_REVISION };
			},
		},
		estimateStorage: async () => ({ usage: null, quota: null }),
		isMemoryBackend: () => true,
	});
	assert.ok(repositories.linkedOriginals);
	const source = Object.freeze({
		kind: 'audio' as const,
		id: 'source-audio',
		storageKey: 'physical-audio',
		mimeType: 'audio/wav',
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32' as const,
		chunkFrames: 2,
	});
	await repositories.linkedOriginals.bind('project-audio', source, LOCATOR_ID, {
		expectedLocatorRevision: LOCATOR_REVISION,
		expectedSnapshot: body,
	});

	const metadata = await repositories.sources.getMetadata(source.storageKey);
	assert.equal(metadata?.storage, 'linked-audio-original-v1');
	assert.equal(metadata?.frameCount, 4);
	assert.equal(loads, 1, 'metadata synthesis must not reload the selected body');
	assert.deepEqual(await repositories.sources.list(), []);
	const chunk = await repositories.sources.chunk(source.storageKey, 1);
	assert.deepEqual([...chunk.channels[0]], [0.25, 1]);
	assert.equal(loads, 2);
});

test('project store binds, reads, duplicates, and cleans a linked WAV without owning its body', async (context) => {
	const body = wavBlob(Float32Array.of(-1, -0.25, 0.25, 1));
	const releases: unknown[] = [];
	const port: LinkedOriginalPort = {
		load(kind, locatorId, { expectedRevision }) {
			assert.equal(kind, 'audio');
			assert.equal(locatorId, LOCATOR_ID);
			return { blob: body, locatorRevision: expectedRevision ?? LOCATOR_REVISION };
		},
		release(reference) {
			releases.push(reference);
			return true;
		},
	};
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `linked-audio-project-store-${Date.now()}-${Math.random()}`,
		linkedOriginalPort: port,
	});
	context.after(async () => { await store.close(); });
	const source = audioSource();
	const project = audioProject('linked-audio-project', source);

	const binding = await store.bindLinkedAudioOriginal(
		project.id,
		source,
		LOCATOR_ID,
		{ expectedLocatorRevision: LOCATOR_REVISION, expectedSnapshot: body },
	);
	assert.deepEqual(await store.getLinkedOriginalBinding(project.id, source.id), binding);
	assert.equal((await store.getLinkedAudioOriginalMetadata(project.id, source))?.kind, 'audio');
	assert.equal((await store.getSourceMetadata(source.storageKey))?.storage, 'linked-audio-original-v1');
	assert.deepEqual(
		[...(await store.readSourceChunk(source.storageKey, 1)).channels[0]],
		[0.25, 1],
	);
	assert.deepEqual(await store.listSources(), [], 'the linked WAV must not create an owned PCM row');

	await store.saveProject(project, { protectedLinkedVideoSourceIds: [] });
	const copy = await store.duplicateProject(project.id, { id: 'linked-audio-project-copy' });
	const copiedBinding = await store.getLinkedOriginalBinding(copy.id, source.id);
	assert.ok(copiedBinding);
	assert.equal(copiedBinding.kind, 'audio');
	assert.notEqual(copiedBinding.bindingToken, binding.bindingToken);
	assert.equal(await body.arrayBuffer().then(({ byteLength }) => byteLength), body.size);

	await store.deleteProject(project.id);
	assert.deepEqual(releases, [], 'the copied alias must retain the external locator');
	await store.deleteProject(copy.id);
	assert.deepEqual(releases, [{
		kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
	}]);
});

test('generic lifecycle retires audio and legacy-video locators through one kindful port', async (context) => {
	const audioBody = wavBlob(Float32Array.of(-1, 1));
	const videoBody = new Blob(['linked video'], { type: 'video/mp4' });
	const genericReleases: unknown[] = [];
	const legacyReleases: unknown[] = [];
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `mixed-linked-original-project-store-${Date.now()}-${Math.random()}`,
		linkedOriginalPort: {
			load(kind: 'audio' | 'video', _locatorId: string, { expectedRevision }: { expectedRevision: string | null }) {
				return {
					blob: kind === 'audio' ? audioBody : videoBody,
					locatorRevision: expectedRevision ?? (kind === 'audio' ? LOCATOR_REVISION : 'snapshot_video_0000000001'),
				};
			},
			release(reference: unknown) { genericReleases.push(reference); return true; },
		},
		linkedVideoOriginalPort: {
			load: (_locatorId: string, { expectedRevision }: { expectedRevision: string | null }) => ({
				blob: videoBody,
				locatorRevision: expectedRevision ?? 'snapshot_video_0000000001',
			}),
			release(reference: unknown) { legacyReleases.push(reference); return true; },
		},
	});
	context.after(async () => { await store.close(); });
	const audio = audioSource({ frameCount: 2 });
	const video = Object.freeze({
		kind: 'video' as const,
		id: 'linked-video-source', storageKey: 'linked-video-storage', mimeType: 'video/mp4',
		frameCount: 2, sampleRate: 48_000, width: 16, height: 9, frameRate: 30,
		videoCodec: 'h264', audioCodec: null, hasAudio: false,
	});
	const project = createAudioEditorProjectV10({
		id: 'mixed-linked-project',
		sources: [audio, video],
		clips: [
			createAudioClipV9({
				id: 'linked-audio-clip', sourceId: audio.id,
				durationFrames: 2, sourceDurationFrames: 2,
			}),
		],
	});

	await store.bindLinkedAudioOriginal(project.id, audio, LOCATOR_ID, {
		expectedLocatorRevision: LOCATOR_REVISION,
		expectedSnapshot: audioBody,
	});
	await store.bindLinkedVideoOriginal(project.id, video, 'locator_video_0000000001', {
		expectedLocatorRevision: 'snapshot_video_0000000001',
		expectedSnapshot: videoBody,
	});
	await store.saveProject(project, { protectedLinkedVideoSourceIds: [video.id] });
	await store.deleteProject(project.id);

	assert.deepEqual(genericReleases, [
		{ kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION },
		{
			kind: 'video',
			locatorId: 'locator_video_0000000001',
			locatorRevision: 'snapshot_video_0000000001',
		},
	]);
	assert.deepEqual(legacyReleases, [], 'a competing video lifecycle must not release locators');
});

test('the video unlink facade cannot delete an audio binding from the mixed store', async (context) => {
	const body = wavBlob(Float32Array.of(-1, 1));
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `mixed-linked-original-unlink-kind-${Date.now()}-${Math.random()}`,
		linkedOriginalPort: {
			load: (_kind: 'audio' | 'video', _locatorId: string, { expectedRevision }: { expectedRevision: string | null }) => ({
				blob: body,
				locatorRevision: expectedRevision ?? LOCATOR_REVISION,
			}),
		},
	});
	context.after(async () => { await store.close(); });
	const source = audioSource({ frameCount: 2 });
	const projectId = 'mixed-linked-original-unlink-kind-project';
	const binding = await store.bindLinkedAudioOriginal(projectId, source, LOCATOR_ID, {
		expectedLocatorRevision: LOCATOR_REVISION,
		expectedSnapshot: body,
	});

	await assert.rejects(
		store.unlinkLinkedVideoOriginal(projectId, source.id, binding.bindingToken),
		/linked video original binding is required/iu,
	);
	assert.deepEqual(await store.getLinkedOriginalBinding(projectId, source.id), binding);
});

test('project store reconciles one complete durable kindful locator inventory', async (context) => {
	const body = wavBlob(Float32Array.of(-1, 1));
	const inventories: unknown[] = [];
	let externalReads = 0;
	const store = createProjectStore({
		indexedDB: createInstrumentedIndexedDB(),
		memoryFallback: false,
		preferOpfs: false,
		databaseName: `linked-audio-reconciliation-${Date.now()}-${Math.random()}`,
		linkedOriginalPort: {
			load: (_kind: 'audio' | 'video', _locatorId: string, { expectedRevision }: { expectedRevision: string | null }) => {
				externalReads += 1;
				return { blob: body, locatorRevision: expectedRevision ?? LOCATOR_REVISION };
			},
			release() { throw new Error('startup reconciliation must not release external media directly'); },
			reconcile(references: unknown) { inventories.push(references); return 0; },
		},
	});
	context.after(async () => { await store.close(); });
	await store.ready();
	const source = audioSource({ frameCount: 2 });
	const staleSource = audioSource({
		frameCount: 2,
		id: 'source-audio-stale',
		storageKey: 'physical-audio-stale',
	});
	const project = audioProject('linked-audio-reconciliation-project', source);
	await store.bindLinkedAudioOriginal(project.id, source, LOCATOR_ID, {
		expectedLocatorRevision: LOCATOR_REVISION,
		expectedSnapshot: body,
	});
	await store.bindLinkedAudioOriginal(project.id, staleSource, 'locator_audio_stale_000001', {
		expectedLocatorRevision: LOCATOR_REVISION,
		expectedSnapshot: body,
	});
	await store.saveProject(project, { protectedLinkedVideoSourceIds: [] });
	assert.equal(externalReads, 2);

	assert.equal(await store.reconcileLinkedOriginalLocators(), true);
	assert.equal(externalReads, 2, 'startup reconciliation must not read external media');
	assert.deepEqual(inventories, [[{
		kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
	}]]);
	assert.equal(await store.getLinkedOriginalBinding(project.id, staleSource.id), null);
});

function audioSource({
	frameCount = 4,
	id = 'source-audio',
	storageKey = 'physical-audio',
} = {}) {
	return createAudioSourceV9({
		id, storageKey, mimeType: 'audio/wav',
		frameCount, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 2,
	});
}

function audioProject(id: string, source: ReturnType<typeof audioSource>) {
	const clip = createAudioClipV9({
		id: `${id}-clip`, sourceId: source.id,
		durationFrames: source.frameCount, sourceDurationFrames: source.frameCount,
	});
	return createAudioEditorProjectV10({
		id,
		sources: [source],
		clips: [clip],
		tracks: [createAudioTrackV9({ id: `${id}-track`, clipIds: [clip.id] })],
	});
}

function wavBlob(channel: Float32Array): Blob {
	const encoded = encodeWav([channel], { float: true, dither: false, sampleRate: 48_000 });
	const bytes = new Uint8Array(encoded.byteLength);
	bytes.set(encoded);
	return new Blob([bytes], { type: 'audio/wav' });
}
