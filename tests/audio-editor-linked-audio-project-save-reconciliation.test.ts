/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import type { ProjectLinkedOriginalSourceReference } from '../src/common/editor/storage/project-publication-options.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const PROJECT_ID = 'linked-audio-live-root-project';
const LOCATOR_ID = 'locator_linked_audio_live_root_0001';
const LOCATOR_REVISION = 'snapshot_linked_audio_live_root_0001';
const NOW = '2026-08-02T12:00:00.000Z';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} live audio roots retain readable linked PCM until relinquished`, async (context) => {
		const fixture = await storeFixture(context, backend);
		const source = audioSource();
		await saveWithRoots(fixture.store, project(1, source), []);
		await fixture.store.bindLinkedAudioOriginal(PROJECT_ID, source, LOCATOR_ID, {
			expectedLocatorRevision: LOCATOR_REVISION,
			expectedSnapshot: fixture.body,
		});

		const audioRoot = Object.freeze({ kind: 'audio' as const, sourceId: source.id });
		await saveWithRoots(fixture.store, project(2), [audioRoot]);
		await saveWithRoots(fixture.store, project(3), [audioRoot]);

		assert.ok(await fixture.store.getLinkedOriginalBinding(PROJECT_ID, source.id));
		assert.deepEqual(await fixture.store.listSources(), []);
		assert.deepEqual(
			[...(await fixture.store.readSourceChunk(source.storageKey, 1)).channels[0]],
			[0.25, 1],
		);
		assert.deepEqual(fixture.releases, []);

		await saveWithRoots(fixture.store, project(4), []);

		assert.equal(await fixture.store.getLinkedOriginalBinding(PROJECT_ID, source.id), null);
		assert.deepEqual(fixture.releases, [{
			kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
		}]);
		assert.deepEqual(
			new Uint8Array(await fixture.body.arrayBuffer()),
			fixture.originalBytes,
			'exact locator retirement must not mutate or delete the external WAV',
		);
	});
}

test('a same-ID video root cannot retain an audio binding', async (context) => {
	const fixture = await storeFixture(context, 'memory');
	const source = audioSource();
	await saveWithRoots(fixture.store, project(1), []);
	await fixture.store.bindLinkedAudioOriginal(PROJECT_ID, source, LOCATOR_ID, {
		expectedLocatorRevision: LOCATOR_REVISION,
		expectedSnapshot: fixture.body,
	});
	const wrongKindRoot = Object.freeze({ kind: 'video' as const, sourceId: source.id });

	await saveWithRoots(fixture.store, project(2), [wrongKindRoot]);
	await saveWithRoots(fixture.store, project(3), [wrongKindRoot]);

	assert.equal(await fixture.store.getLinkedOriginalBinding(PROJECT_ID, source.id), null);
	assert.deepEqual(fixture.releases, [{
		kind: 'audio', locatorId: LOCATOR_ID, locatorRevision: LOCATOR_REVISION,
	}]);
});

async function storeFixture(
	context: TestContext,
	backend: 'memory' | 'indexeddb',
) {
	const body = wavBlob(Float32Array.of(-1, -0.25, 0.25, 1));
	const originalBytes = new Uint8Array(await body.arrayBuffer());
	const releases: unknown[] = [];
	const store = createProjectStore({
		indexedDB: backend === 'indexeddb' ? createInstrumentedIndexedDB() : null,
		memoryFallback: backend === 'memory',
		preferOpfs: false,
		revisionLimit: 2,
		databaseName: `linked-audio-live-roots-${backend}-${Date.now()}-${Math.random()}`,
		linkedOriginalPort: {
			load(kind: 'audio' | 'video', locatorId: string, options: { expectedRevision: string | null }) {
				assert.equal(kind, 'audio');
				assert.equal(locatorId, LOCATOR_ID);
				return { blob: body, locatorRevision: options.expectedRevision ?? LOCATOR_REVISION };
			},
			release(reference: unknown) {
				releases.push(reference);
				return true;
			},
		},
	});
	context.after(async () => { await store.close(); });
	await store.ready();
	return { body, originalBytes, releases, store };
}

function audioSource() {
	return createAudioSourceV9({
		id: 'linked-audio-source',
		storageKey: 'linked-audio-storage',
		name: 'linked-audio.wav',
		mimeType: 'audio/wav',
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 2,
	});
}

function project(revision: number, source?: ReturnType<typeof audioSource>) {
	const clip = source ? createAudioClipV9({
		id: 'linked-audio-clip',
		sourceId: source.id,
		durationFrames: source.frameCount,
		sourceDurationFrames: source.frameCount,
	}) : null;
	return createCurrentAudioEditorProject({
		id: PROJECT_ID,
		title: 'Linked audio live roots',
		revision,
		now: NOW,
		sources: source ? [source] : [],
		clips: clip ? [clip] : [],
		tracks: clip ? [createAudioTrackV9({ id: 'linked-audio-track', clipIds: [clip.id] })] : [],
	});
}

function saveWithRoots(
	store: ReturnType<typeof createProjectStore>,
	value: ReturnType<typeof project>,
	protectedLinkedOriginalSourceReferences: readonly ProjectLinkedOriginalSourceReference[],
) {
	return store.saveProject(value, { protectedLinkedOriginalSourceReferences });
}

function wavBlob(channel: Float32Array): Blob {
	const encoded = encodeWav([channel], { float: true, dither: false, sampleRate: 48_000 });
	const bytes = new Uint8Array(encoded.byteLength);
	bytes.set(encoded);
	return new Blob([bytes], { type: 'audio/wav' });
}
