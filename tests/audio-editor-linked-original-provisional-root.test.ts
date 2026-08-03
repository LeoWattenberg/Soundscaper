/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LEGACY_LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION,
	LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	normalizeLinkedOriginalBinding,
	type LegacyLinkedVideoOriginalBinding,
	type LinkedOriginalBinding,
} from '../src/common/editor/storage/linked-original-binding.ts';
import {
	LINKED_ORIGINAL_PROVISIONAL_ROOT_SCHEMA_VERSION,
	LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
	linkedOriginalProvisionalRoot,
	linkedOriginalProvisionalRootPairPublication,
	normalizeLinkedOriginalProvisionalRoot,
	readMemoryLinkedOriginalProvisionalRootInventory,
	readStoredLinkedOriginalProvisionalRootInventory,
	type LinkedOriginalProvisionalRoot,
	type LinkedOriginalProvisionalRootPairPublication,
} from '../src/common/editor/storage/linked-original-provisional-root.ts';
import {
	LINKED_ORIGINAL_STORE_NAME,
	linkedOriginalBindingKey,
} from '../src/common/editor/storage/linked-original-schema.ts';
import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase, type EditorMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const FIRST_TOKEN = 'binding_token_00000001';
const SECOND_TOKEN = 'binding_token_00000002';

test('provisional roots are closed exact binding-token records', () => {
	const binding = audioBinding();
	const key = linkedOriginalBindingKey(binding.projectId, binding.sourceId);
	const root = linkedOriginalProvisionalRoot(binding);

	assert.deepEqual(root, {
		schemaVersion: LINKED_ORIGINAL_PROVISIONAL_ROOT_SCHEMA_VERSION,
		key,
		projectId: binding.projectId,
		kind: binding.kind,
		sourceId: binding.sourceId,
		bindingToken: binding.bindingToken,
	});
	assert.equal(Object.isFrozen(root), true);
	assert.throws(
		() => normalizeLinkedOriginalProvisionalRoot({ ...root, path: '/private/original.wav' }),
		/unsupported field/iu,
	);
	assert.throws(
		() => normalizeLinkedOriginalProvisionalRoot({ ...root, kind: 'image' }),
		/kind/iu,
	);
	assert.throws(
		() => normalizeLinkedOriginalProvisionalRoot({ ...root, bindingToken: 'stale' }),
		/token/iu,
	);
	const accessor = { ...root } as Record<string, unknown>;
	Object.defineProperty(accessor, 'projectId', { enumerable: true, get: () => binding.projectId });
	assert.throws(() => normalizeLinkedOriginalProvisionalRoot(accessor), /data field/iu);
});

test('the pure pair publication preserves validated current and raw schema-v1 bindings', () => {
	const current = audioBinding();
	const currentPublication = linkedOriginalProvisionalRootPairPublication(current);
	assert.deepEqual(currentPublication, {
		key: linkedOriginalBindingKey(current.projectId, current.sourceId),
		record: {
			key: linkedOriginalBindingKey(current.projectId, current.sourceId),
			projectId: current.projectId,
			binding: current,
		},
		root: linkedOriginalProvisionalRoot(current),
	});
	assert.equal(Object.isFrozen(currentPublication), true);
	assert.equal(Object.isFrozen(currentPublication.record), true);

	const legacy = legacyVideoBinding();
	const logical = normalizeLinkedOriginalBinding(legacy);
	const legacyPublication = linkedOriginalProvisionalRootPairPublication(logical, legacy);
	assert.equal(legacyPublication.record.binding.schemaVersion, 1);
	assert.equal(Object.hasOwn(legacyPublication.record.binding, 'kind'), false);
	assert.deepEqual(legacyPublication.root, linkedOriginalProvisionalRoot(logical));
	assert.throws(
		() => linkedOriginalProvisionalRootPairPublication(current, legacy),
		/does not match/iu,
	);
});

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} inventory joins current and raw schema-v1 publications exactly`, async (context) => {
		const fixture = await inventoryFixture(context, `exact-${backend}`, backend);
		const audio = audioBinding();
		const legacy = legacyVideoBinding();
		const video = normalizeLinkedOriginalBinding(legacy);
		await fixture.seedPairs([
			linkedOriginalProvisionalRootPairPublication(video, legacy),
			linkedOriginalProvisionalRootPairPublication(audio),
		]);

		const inventory = await fixture.inventory();
		assert.deepEqual(inventory, {
			pairs: [
				{ root: linkedOriginalProvisionalRoot(audio), binding: audio },
				{ root: linkedOriginalProvisionalRoot(video), binding: video },
			],
			orphanRootKeys: [],
		});
		assert.equal(Object.isFrozen(inventory), true);
		assert.equal(Object.isFrozen(inventory.pairs), true);
		assert.equal(inventory.pairs.every(Object.isFrozen), true);
	});

	test(`${backend} inventory returns well-formed orphan roots as cleanup state`, async (context) => {
		const fixture = await inventoryFixture(context, `orphans-${backend}`, backend);
		const first = linkedOriginalProvisionalRoot(audioBinding());
		const second = linkedOriginalProvisionalRoot(audioBinding({
			projectId: 'project-second',
			sourceId: 'source-second',
			bindingToken: SECOND_TOKEN,
		}));
		await fixture.seedRoots([second, first]);

		assert.deepEqual(await fixture.inventory(), {
			pairs: [],
			orphanRootKeys: [first.key, second.key],
		});
	});
}

test('complete memory inventory rejects hidden malformed, mismatched, and over-limit roots', async () => {
	const fixture = await inventoryFixture(undefined, 'invalid-memory', 'memory');
	const first = linkedOriginalProvisionalRootPairPublication(audioBinding());
	const second = linkedOriginalProvisionalRootPairPublication(audioBinding({
		projectId: 'project-second',
		sourceId: 'source-second',
		bindingToken: SECOND_TOKEN,
	}));
	await fixture.seedPairs([first, second]);

	fixture.memory.linkedOriginalProvisionalRoots.set(second.key, {
		...second.root,
		bindingToken: FIRST_TOKEN,
	});
	await assert.rejects(fixture.inventory(), /generation|token|binding/iu);

	fixture.memory.linkedOriginalProvisionalRoots.set(second.key, second.root);
	fixture.memory.linkedOriginalProvisionalRoots.set('malformed', { path: '/private/original.wav' });
	await assert.rejects(fixture.inventory(), /root|field|key/iu);

	fixture.memory.linkedOriginalProvisionalRoots.delete('malformed');
	await assert.rejects(fixture.inventory(1), /limit/iu);
	fixture.memory.linkedOriginalProvisionalRoots.delete(second.key);
	fixture.memory.linkedOriginalProvisionalRoots.set('wrong-authoritative-key', first.root);
	await assert.rejects(fixture.inventory(), /authoritative key/iu);
});

function audioBinding(overrides: Partial<LinkedOriginalBinding> = {}): LinkedOriginalBinding {
	return Object.freeze({
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		kind: 'audio' as const,
		projectId: 'project-audio',
		sourceId: 'source-audio',
		storageKey: 'storage-audio',
		locatorId: 'locator_audio_000000000001',
		locatorRevision: 'snapshot_audio_0000000001',
		mimeType: 'audio/wav',
		byteLength: 262_144,
		sha256: 'ab'.repeat(32),
		sourceShape: {
			frameCount: 32_768,
			channelCount: 2,
			sampleRate: 48_000,
			originalSampleRate: 48_000,
			sampleFormat: 'float32' as const,
			chunkFrames: 65_536,
		},
		bindingToken: FIRST_TOKEN,
		boundAt: '2026-08-03T10:11:12.345Z',
		...overrides,
	}) as LinkedOriginalBinding;
}

function legacyVideoBinding(): LegacyLinkedVideoOriginalBinding {
	return Object.freeze({
		schemaVersion: LEGACY_LINKED_VIDEO_ORIGINAL_BINDING_SCHEMA_VERSION,
		projectId: 'project-video',
		sourceId: 'source-video',
		storageKey: 'storage-video',
		locatorId: 'locator_video_000000000001',
		locatorRevision: 'snapshot_video_0000000001',
		mimeType: 'video/mp4',
		byteLength: 1_048_576,
		sha256: 'cd'.repeat(32),
		sourceShape: {
			frameCount: 96_000,
			sampleRate: 48_000,
			width: 1_920,
			height: 1_080,
			frameRate: 29.97,
			videoCodec: 'h264',
			audioCodec: 'aac',
			hasAudio: true,
		},
		bindingToken: FIRST_TOKEN,
		boundAt: '2026-08-03T10:11:12.345Z',
	});
}

interface InstrumentedIndexedDB {
	open(name: string, version?: number): IDBOpenDBRequest;
}

async function inventoryFixture(
	context: { after(callback: () => void): void } | undefined,
	label: string,
	backend: 'memory' | 'indexeddb',
) {
	const indexedDB = backend === 'indexeddb'
		? createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB
		: null;
	const databaseName = `linked-original-provisional-root-${label}-${Date.now()}-${Math.random()}`;
	const database = indexedDB
		? await openDatabase(indexedDB as unknown as IDBFactory, databaseName)
		: null;
	context?.after(() => { database?.close(); });
	const memory: EditorMemoryDatabase = getMemoryDatabase(databaseName);
	return {
		memory,
		inventory: async (limit = 100_000) => database
			? transact(database, [
				LINKED_ORIGINAL_STORE_NAME,
				LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
			], 'readonly', (stores) => readStoredLinkedOriginalProvisionalRootInventory(
				stores[LINKED_ORIGINAL_STORE_NAME],
				stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME],
				limit,
			))
			: readMemoryLinkedOriginalProvisionalRootInventory(
				memory.linkedVideoOriginalBindings,
				memory.linkedOriginalProvisionalRoots,
				limit,
			),
		seedPairs: async (
			publications: readonly LinkedOriginalProvisionalRootPairPublication[],
		): Promise<void> => {
			if (!database) {
				for (const publication of publications) {
					memory.linkedVideoOriginalBindings.set(publication.key, publication.record);
					memory.linkedOriginalProvisionalRoots.set(publication.key, publication.root);
				}
				return;
			}
			await transact(database, [
				LINKED_ORIGINAL_STORE_NAME,
				LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
			], 'readwrite', async (stores) => {
				for (const publication of publications) {
					await request(stores[LINKED_ORIGINAL_STORE_NAME].put(publication.record));
					await request(stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME].put(publication.root));
				}
			});
		},
		seedRoots: async (roots: readonly LinkedOriginalProvisionalRoot[]): Promise<void> => {
			if (!database) {
				for (const root of roots) memory.linkedOriginalProvisionalRoots.set(root.key, root);
				return;
			}
			await transact(database, LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME, 'readwrite', async (stores) => {
				for (const root of roots) {
					await request(stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME].put(root));
				}
			});
		},
	};
}
