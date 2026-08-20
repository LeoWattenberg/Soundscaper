/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	type LinkedOriginalBindingInput,
} from '../src/common/editor/storage/linked-original-binding.ts';
import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME } from '../src/common/editor/storage/linked-original-provisional-root.ts';
import { linkedOriginalBindingKey } from '../src/common/editor/storage/linked-original-schema.ts';
import type { LinkedOriginalLocatorReference } from '../src/common/editor/storage/linked-original-repository.ts';
import { editorProjectStorageProfileNames } from '../src/common/editor/storage/project-storage-profile.ts';
import type { AudioEditorProjectStore } from '../src/common/editor/storage.js';
import { createSoundscaperProjectStoreV21 } from '../src/soundscaper/editor-project-store-v21.ts';
import { SOUNDSCAPER_V21_PROJECT_STORAGE_PROFILE } from '../src/soundscaper/editor-project-storage-profile-v21.ts';
import {
	createSoundscaperProjectV21,
	type SoundscaperProjectV21,
} from '../src/soundscaper/editor-project-v21.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const NOW = '2026-08-14T12:00:00.000Z';
const LOCATOR_REVISION = 'locator_revision_00000001';

interface TestAudioSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly originalSampleRate: number;
	readonly sampleFormat: 'float32';
	readonly chunkFrames: number;
}

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`selected V21 ${backend} reachability proves exact source roots`, async (context) => {
		const store = createStore(context, backend === 'indexeddb'
			? createInstrumentedIndexedDB() as unknown as IDBFactory
			: null);
		const source = audioSource(`v21-${backend}-live`);
		const project = rootedProject(`v21-${backend}-reachability`, source);
		await store.saveProject(project);

		const result = await store.linkedOriginalProjectReachabilityRepository.pruneProjectBindings(
			project.id,
			[],
		);

		assert.deepEqual(result?.durableSourceReferences, [{ kind: 'audio', sourceId: source.id }]);
		assert.deepEqual(result?.removedLocatorReferences, []);
	});
}

test('selected V21 startup reconciliation prunes only unreachable exact-project bindings', async (context) => {
	const indexedDB = createInstrumentedIndexedDB() as unknown as IDBFactory;
	let reconciled: readonly LinkedOriginalLocatorReference[] = [];
	const store = createSoundscaperProjectStoreV21({
		indexedDB,
		preferOpfs: false,
		linkedOriginalPort: {
			load: () => null,
			reconcile: (references: readonly LinkedOriginalLocatorReference[]) => {
				reconciled = structuredClone(references);
				return references.length;
			},
		},
	});
	context.after(async () => { await store.close(); });
	await store.ready();
	const live = audioSource('v21-startup-live');
	const stale = audioSource('v21-startup-stale');
	const project = rootedProject('v21-startup-reconciliation', live);
	await store.saveProject(project);
	await seedBinding(store, project.id, live, 'locator_v21_startup_live');
	await seedBinding(store, project.id, stale, 'locator_v21_startup_stale');

	const database = await openDatabase(
		indexedDB,
		editorProjectStorageProfileNames(SOUNDSCAPER_V21_PROJECT_STORAGE_PROFILE).databaseName,
	);
	context.after(() => { database.close(); });
	await transact(database, LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME, 'readwrite', (stores) => (
		Promise.all([live, stale].map((source) => request(
			stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME].delete(
				linkedOriginalBindingKey(project.id, source.id),
			),
		)))
	));

	assert.equal(await store.reconcileLinkedOriginalLocators(), true);
	assert.deepEqual(reconciled, [{
		kind: 'audio',
		locatorId: 'locator_v21_startup_live',
		locatorRevision: LOCATOR_REVISION,
	}]);
	assert.ok(await store.getLinkedOriginalBinding(project.id, live.id));
	assert.equal(await store.getLinkedOriginalBinding(project.id, stale.id), null);
});

function createStore(context: TestContext, indexedDB: IDBFactory | null): AudioEditorProjectStore {
	const store = createSoundscaperProjectStoreV21({ indexedDB, preferOpfs: false });
	context.after(async () => { await store.close(); });
	return store;
}

function rootedProject(id: string, source: TestAudioSource): SoundscaperProjectV21 {
	const clip = createAudioClip({
		id: `${id}-clip`, sourceId: source.id, durationFrames: 4, sourceDurationFrames: 4,
	});
	const track = createAudioTrack({ id: `${id}-track`, clipIds: [clip.id] });
	return createSoundscaperProjectV21({
		id,
		title: 'V21 linked-original preservation',
		now: NOW,
		sources: [source],
		clips: [clip],
		tracks: [track],
		sequences: [{ id: `${id}-sequence`, trackIds: [track.id] }],
		primarySequenceId: `${id}-sequence`,
	});
}

function audioSource(id: string): TestAudioSource {
	return createAudioSource({
		id,
		storageKey: `${id}-storage`,
		mimeType: 'audio/wav',
		contentSha256: 'ab'.repeat(32),
		frameCount: 4,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32',
		chunkFrames: 65_536,
	}) as TestAudioSource;
}

async function seedBinding(
	store: AudioEditorProjectStore,
	projectId: string,
	source: TestAudioSource,
	locatorId: string,
): Promise<void> {
	const input: LinkedOriginalBindingInput = {
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		kind: 'audio',
		projectId,
		sourceId: source.id,
		storageKey: source.storageKey,
		locatorId,
		locatorRevision: LOCATOR_REVISION,
		mimeType: source.mimeType,
		byteLength: 65_536,
		sha256: 'ab'.repeat(32),
		sourceShape: {
			frameCount: source.frameCount,
			channelCount: source.channelCount,
			sampleRate: source.sampleRate,
			originalSampleRate: source.originalSampleRate,
			sampleFormat: source.sampleFormat,
			chunkFrames: source.chunkFrames,
		},
	};
	assert.ok(await store.linkedOriginalBindingRepository.putIfCurrent(input, null));
}
