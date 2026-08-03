/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
	LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	type LinkedOriginalBinding,
	type LinkedOriginalBindingInput,
} from '../src/common/editor/storage/linked-original-binding.ts';
import { LinkedOriginalProjectAliasRepository } from '../src/common/editor/storage/linked-original-project-alias-repository.ts';
import {
	LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
	linkedOriginalProvisionalRootPairPublication,
	type LinkedOriginalProvisionalRoot,
} from '../src/common/editor/storage/linked-original-provisional-root.ts';
import { LinkedOriginalRepository } from '../src/common/editor/storage/linked-original-repository.ts';
import type { LinkedOriginalSource } from '../src/common/editor/storage/linked-original-resolver.ts';
import {
	LINKED_ORIGINAL_STORE_NAME,
	linkedOriginalBindingKey,
} from '../src/common/editor/storage/linked-original-schema.ts';
import { LinkedVideoOriginalRepository } from '../src/common/editor/storage/linked-video-original-repository.ts';
import { LinkedVideoOriginalProjectAliasRepository } from '../src/common/editor/storage/linked-video-original-project-alias-repository.ts';
import { openDatabase, request, transact } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase, type EditorMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const NOW = '2026-08-03T10:11:12.345Z';
const SOURCE_PROJECT_ID = 'root-writer-source-project';
const DESTINATION_PROJECT_ID = 'root-writer-destination-project';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} direct generic and legacy writers fence binding/root pairs`, async (context) => {
		const fixture = await writerFixture(context, `direct-${backend}`, backend);
		const audio = await fixture.bindings.putIfCurrent(audioInput(), null);
		const video = await fixture.videos.putIfCurrent(videoInput(), null);
		assert.ok(audio);
		assert.ok(video);
		assertRootMatches(fixture, audio);
		assertRootMatches(fixture, { ...video, schemaVersion: 2, kind: 'video' } as LinkedOriginalBinding);
		const rawVideo = fixture.bindingRecord(video.projectId, video.sourceId)?.binding as Record<string, unknown>;
		assert.equal(rawVideo.schemaVersion, 1);
		assert.equal(Object.hasOwn(rawVideo, 'kind'), false);

		const beforeStale = fixture.snapshot();
		assert.equal(await fixture.bindings.putIfCurrent(
			audioInput({ locatorRevision: 'snapshot_audio_replacement_0001' }),
			'binding_stale_0000001',
		), null);
		assert.deepEqual(fixture.snapshot(), beforeStale);
		const replacement = await fixture.bindings.putIfCurrent(
			audioInput({ locatorRevision: 'snapshot_audio_replacement_0001' }),
			audio.bindingToken,
		);
		assert.ok(replacement);
		assertRootMatches(fixture, replacement);
		assert.equal(await fixture.bindings.deleteIfCurrent(
			replacement.projectId,
			replacement.sourceId,
			audio.bindingToken,
		), false);
		assertRootMatches(fixture, replacement);
		assert.equal(await fixture.bindings.deleteIfCurrent(
			replacement.projectId,
			replacement.sourceId,
			replacement.bindingToken,
		), true);
		assert.equal(fixture.bindingRecord(replacement.projectId, replacement.sourceId), undefined);
		assert.equal(fixture.rootRecord(replacement.projectId, replacement.sourceId), undefined);
	});

	test(`${backend} aliases publish roots and exact rollback removes both`, async (context) => {
		const fixture = await writerFixture(context, `alias-${backend}`, backend);
		const source = audioSource('alias-source');
		await seedAudioBinding(fixture, SOURCE_PROJECT_ID, source);
		let aliases = await fixture.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[source],
		);
		assert.equal(aliases.length, 1);
		assertRootMatches(fixture, aliases[0]);
		await fixture.aliases.rollbackAliases(aliases);
		assert.equal(fixture.bindingRecord(DESTINATION_PROJECT_ID, source.id), undefined);
		assert.equal(fixture.rootRecord(DESTINATION_PROJECT_ID, source.id), undefined);

		aliases = await fixture.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[source],
		);
		const replacement = await fixture.bindings.putIfCurrent(
			bindingInputFrom(aliases[0]),
			aliases[0].bindingToken,
		);
		assert.ok(replacement);
		await assert.rejects(fixture.aliases.rollbackAliases(aliases), /replaced|token.*match/iu);
		assert.deepEqual(await fixture.bindings.get(DESTINATION_PROJECT_ID, source.id), replacement);
		assertRootMatches(fixture, replacement);
	});
}

test('memory direct writes compensate root-map failures', async () => {
	const base = getMemoryDatabase(`root-writer-memory-failure-${Date.now()}-${Math.random()}`);
	const roots = new FailNextMutationMap<string, unknown>();
	const memory: EditorMemoryDatabase = { ...base, linkedOriginalProvisionalRoots: roots };
	const repository = new LinkedOriginalRepository({ memory, database: async () => null }, deterministicOptions());
	const writeFailure = new Error('planned memory root write failure');
	roots.failNextSet(writeFailure);
	await assert.rejects(repository.putIfCurrent(audioInput(), null), (error) => error === writeFailure);
	assert.equal(memory.linkedVideoOriginalBindings.size, 0);
	assert.equal(roots.size, 0);

	const binding = await repository.putIfCurrent(audioInput(), null);
	assert.ok(binding);
	const deleteFailure = new Error('planned memory root delete failure');
	roots.failNextDelete(deleteFailure);
	await assert.rejects(
		repository.deleteIfCurrent(binding.projectId, binding.sourceId, binding.bindingToken),
		(error) => error === deleteFailure,
	);
	assert.equal(memory.linkedVideoOriginalBindings.size, 1);
	assert.equal(roots.size, 1);
});

test('IndexedDB direct root failures roll back sibling binding writes and deletes', async (context) => {
	const fixture = await writerFixture(context, 'direct-idb-failure', 'indexeddb');
	assert.ok(fixture.indexedDB);
	const writeFailure = new Error('planned IndexedDB root write failure');
	fixture.indexedDB.failNextPutForStore(LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME, writeFailure);
	await assert.rejects(fixture.bindings.putIfCurrent(audioInput(), null), (error) => error === writeFailure);
	assert.deepEqual(fixture.snapshot(), { bindings: [], roots: [] });

	const binding = await fixture.bindings.putIfCurrent(audioInput(), null);
	assert.ok(binding);
	const deleteFailure = new Error('planned IndexedDB root delete failure');
	fixture.indexedDB.failNextDeleteForStore(LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME, deleteFailure);
	await assert.rejects(
		fixture.bindings.deleteIfCurrent(binding.projectId, binding.sourceId, binding.bindingToken),
		(error) => error === deleteFailure,
	);
	assertRootMatches(fixture, binding);
});

test('generic durable reconciliation deletes unreachable pairs and validated orphan roots', async (context) => {
	const fixture = await writerFixture(context, 'generic-reconcile', 'indexeddb');
	const live = await fixture.bindings.putIfCurrent(audioInput(), null);
	const stale = await fixture.bindings.putIfCurrent(audioInput({
		projectId: 'root-writer-stale-project',
		sourceId: 'root-writer-stale-source',
	}), null);
	assert.ok(live);
	assert.ok(stale);
	const orphan = linkedOriginalProvisionalRootPairPublication({
		...stale,
		projectId: 'root-writer-orphan-project',
		sourceId: 'root-writer-orphan-source',
		bindingToken: 'binding_orphan_0000001',
	});
	await fixture.seedRoot(orphan.root);

	await fixture.bindings.reconcileDurableLocatorReferences([live.projectId]);
	assertRootMatches(fixture, live);
	assert.equal(fixture.bindingRecord(stale.projectId, stale.sourceId), undefined);
	assert.equal(fixture.rootRecord(stale.projectId, stale.sourceId), undefined);
	assert.equal(fixture.rootRecord(orphan.root.projectId, orphan.root.sourceId), undefined);
});

test('video durable reconciliation preserves live audio pairs while deleting video pairs and orphans', async (context) => {
	const fixture = await writerFixture(context, 'video-reconcile', 'indexeddb');
	const audio = await fixture.bindings.putIfCurrent(audioInput(), null);
	const video = await fixture.videos.putIfCurrent(videoInput(), null);
	assert.ok(audio);
	assert.ok(video);
	const logicalVideo = { ...video, schemaVersion: 2, kind: 'video' } as LinkedOriginalBinding;
	const orphan = linkedOriginalProvisionalRootPairPublication({
		...audio,
		projectId: 'root-writer-orphan-audio-project',
		sourceId: 'root-writer-orphan-audio-source',
		bindingToken: 'binding_orphan_audio_01',
	});
	await fixture.seedRoot(orphan.root);

	await fixture.videos.reconcileDurableLocatorReferences([]);
	assertRootMatches(fixture, audio);
	assert.equal(fixture.bindingRecord(logicalVideo.projectId, logicalVideo.sourceId), undefined);
	assert.equal(fixture.rootRecord(logicalVideo.projectId, logicalVideo.sourceId), undefined);
	assert.equal(fixture.rootRecord(orphan.root.projectId, orphan.root.sourceId), undefined);
});

test('IndexedDB reconciliation root deletion failure rolls back sibling binding deletion', async (context) => {
	const fixture = await writerFixture(context, 'reconcile-root-failure', 'indexeddb');
	assert.ok(fixture.indexedDB);
	const live = await fixture.bindings.putIfCurrent(audioInput(), null);
	const stale = await fixture.bindings.putIfCurrent(audioInput({
		projectId: 'root-writer-reconcile-failure-stale',
		sourceId: 'root-writer-reconcile-failure-source',
	}), null);
	assert.ok(live);
	assert.ok(stale);
	const before = fixture.snapshot();
	fixture.indexedDB.failNextDeleteForStore(
		LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		new Error('planned reconcile root delete failure'),
	);
	await assert.rejects(
		fixture.bindings.reconcileDurableLocatorReferences([live.projectId]),
		/planned reconcile root delete failure/iu,
	);
	assert.deepEqual(fixture.snapshot(), before);
});

test('alias publication enforces prospective root capacity', async (context) => {
	const fixture = await writerFixture(context, 'alias-root-capacity', 'memory', {
		maximumInventoryRecords: 2,
	});
	const source = audioSource('capacity-source');
	const binding = await seedAudioBinding(fixture, SOURCE_PROJECT_ID, source);
	const orphan = linkedOriginalProvisionalRootPairPublication({
		...binding,
		projectId: 'capacity-orphan-project',
		sourceId: 'capacity-orphan-source',
		bindingToken: 'binding_capacity_orphan1',
	});
	fixture.memory.linkedOriginalProvisionalRoots.set(orphan.key, orphan.root);

	await assert.rejects(
		fixture.aliases.copyReachableAliases(SOURCE_PROJECT_ID, DESTINATION_PROJECT_ID, [source]),
		/root.*limit|limit.*root/iu,
	);
	assert.equal(fixture.bindingRecord(DESTINATION_PROJECT_ID, source.id), undefined);
});

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} direct replacement is allowed at root capacity but a new key is rejected`, async (context) => {
		const fixture = await writerFixture(context, `direct-root-capacity-${backend}`, backend, {
			maximumInventoryRecords: 1,
		});
		const first = await fixture.bindings.putIfCurrent(audioInput(), null);
		assert.ok(first);
		const replacement = await fixture.bindings.putIfCurrent(
			audioInput({ locatorRevision: 'snapshot_at_root_capacity_01' }),
			first.bindingToken,
		);
		assert.ok(replacement);
		assertRootMatches(fixture, replacement);
		await assert.rejects(fixture.bindings.putIfCurrent(audioInput({
			projectId: 'root-capacity-new-project',
			sourceId: 'root-capacity-new-source',
		}), null), /root.*limit|limit.*root/iu);
		assert.equal(fixture.bindingRecord('root-capacity-new-project', 'root-capacity-new-source'), undefined);
		assertRootMatches(fixture, replacement);
	});
}

test('memory alias writes and rollbacks compensate root-map failures', async () => {
	const base = getMemoryDatabase(`root-alias-memory-failure-${Date.now()}-${Math.random()}`);
	const roots = new FailNextMutationMap<string, unknown>();
	const memory: EditorMemoryDatabase = { ...base, linkedOriginalProvisionalRoots: roots };
	const port: StorageRepositoryPort = { memory, database: async () => null };
	const bindings = new LinkedOriginalRepository(port, deterministicOptions());
	const aliases = new LinkedOriginalProjectAliasRepository(port, {
		now: () => new Date(NOW),
		createBindingToken: tokenFactory('alias_binding'),
	});
	const source = audioSource('memory-failure-source');
	assert.ok(await bindings.putIfCurrent(bindingInput(SOURCE_PROJECT_ID, source), null));
	roots.failNextSet(new Error('planned alias root write failure'));
	await assert.rejects(
		aliases.copyReachableAliases(SOURCE_PROJECT_ID, DESTINATION_PROJECT_ID, [source]),
		/planned alias root write failure/iu,
	);
	const destinationKey = linkedOriginalBindingKey(DESTINATION_PROJECT_ID, source.id);
	assert.equal(memory.linkedVideoOriginalBindings.has(destinationKey), false);
	assert.equal(roots.has(destinationKey), false);

	const [alias] = await aliases.copyReachableAliases(SOURCE_PROJECT_ID, DESTINATION_PROJECT_ID, [source]);
	roots.failNextDelete(new Error('planned alias root delete failure'));
	await assert.rejects(aliases.rollbackAliases([alias]), /planned alias root delete failure/iu);
	assert.equal(memory.linkedVideoOriginalBindings.has(destinationKey), true);
	assert.equal(roots.has(destinationKey), true);
});

test('IndexedDB alias root failures roll back binding publication and deletion', async (context) => {
	const fixture = await writerFixture(context, 'alias-idb-failure', 'indexeddb');
	assert.ok(fixture.indexedDB);
	const source = audioSource('idb-failure-source');
	await seedAudioBinding(fixture, SOURCE_PROJECT_ID, source);
	fixture.indexedDB.failNextPutForStore(
		LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		new Error('planned alias root write failure'),
	);
	await assert.rejects(
		fixture.aliases.copyReachableAliases(SOURCE_PROJECT_ID, DESTINATION_PROJECT_ID, [source]),
		/planned alias root write failure/iu,
	);
	assert.equal(fixture.bindingRecord(DESTINATION_PROJECT_ID, source.id), undefined);
	assert.equal(fixture.rootRecord(DESTINATION_PROJECT_ID, source.id), undefined);

	const [alias] = await fixture.aliases.copyReachableAliases(
		SOURCE_PROJECT_ID,
		DESTINATION_PROJECT_ID,
		[source],
	);
	fixture.indexedDB.failNextDeleteForStore(
		LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
		new Error('planned alias root delete failure'),
	);
	await assert.rejects(fixture.aliases.rollbackAliases([alias]), /planned alias root delete failure/iu);
	assertRootMatches(fixture, alias);
});

test('video-only aliases preserve raw schema-v1 rows while rooting the logical video', async (context) => {
	const fixture = await writerFixture(context, 'legacy-video-alias', 'indexeddb');
	const source = videoSource('legacy-alias-source');
	assert.ok(await fixture.videos.putIfCurrent({
		...videoInput(),
		projectId: SOURCE_PROJECT_ID,
		sourceId: source.id,
		storageKey: source.storageKey,
	}, null));
	const aliases = new LinkedVideoOriginalProjectAliasRepository(fixture.port, {
		now: () => new Date(NOW),
		createBindingToken: tokenFactory('legacy_alias_binding'),
	});
	const [alias] = await aliases.copyReachableAliases(
		SOURCE_PROJECT_ID,
		DESTINATION_PROJECT_ID,
		[source],
	);
	const raw = fixture.bindingRecord(DESTINATION_PROJECT_ID, source.id)?.binding as Record<string, unknown>;
	assert.equal(raw.schemaVersion, 1);
	assert.equal(Object.hasOwn(raw, 'kind'), false);
	assertRootMatches(fixture, { ...alias, schemaVersion: 2, kind: 'video' } as LinkedOriginalBinding);
});

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} direct stale CAS still validates the complete rooted inventory first`, async (context) => {
		const fixture = await writerFixture(context, `pre-cas-root-validation-${backend}`, backend);
		const binding = await fixture.bindings.putIfCurrent(audioInput(), null);
		assert.ok(binding);
		const root = fixture.rootRecord(binding.projectId, binding.sourceId) as unknown as LinkedOriginalProvisionalRoot;
		await fixture.seedRoot({ ...root, bindingToken: 'binding_mismatched_root_01' });
		const before = fixture.snapshot();
		await assert.rejects(
			fixture.bindings.putIfCurrent(audioInput(), 'binding_stale_0000001'),
			/does not match.*binding|binding.*does not match/iu,
		);
		assert.deepEqual(fixture.snapshot(), before);
	});
}

interface WriterFixture {
	readonly port: StorageRepositoryPort;
	readonly memory: EditorMemoryDatabase;
	readonly database: IDBDatabase | null;
	readonly databaseName: string;
	readonly indexedDB: ReturnType<typeof createInstrumentedIndexedDB> | null;
	readonly bindings: LinkedOriginalRepository;
	readonly videos: LinkedVideoOriginalRepository;
	readonly aliases: LinkedOriginalProjectAliasRepository;
	bindingRecord(projectId: string, sourceId: string): Record<string, unknown> | undefined;
	rootRecord(projectId: string, sourceId: string): Record<string, unknown> | undefined;
	snapshot(): Readonly<{ bindings: unknown[]; roots: unknown[] }>;
	seedRoot(root: LinkedOriginalProvisionalRoot): Promise<void>;
}

async function writerFixture(
	context: TestContext,
	label: string,
	backend: 'memory' | 'indexeddb',
	limits: Readonly<{ maximumInventoryRecords?: number }> = {},
): Promise<WriterFixture> {
	const databaseName = `linked-root-writer-${label}-${Date.now()}-${Math.random()}`;
	const memory = getMemoryDatabase(databaseName);
	const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
	const database = indexedDB
		? await openDatabase(indexedDB as unknown as IDBFactory, databaseName)
		: null;
	context.after(() => { database?.close(); });
	const port: StorageRepositoryPort = { memory, database: async () => database };
	const bindings = new LinkedOriginalRepository(port, { ...deterministicOptions(), ...limits });
	const records = (storeName: string): Record<string, unknown>[] => indexedDB
		? indexedDB.records(databaseName, storeName)
		: [...(storeName === LINKED_ORIGINAL_STORE_NAME
			? memory.linkedVideoOriginalBindings
			: memory.linkedOriginalProvisionalRoots).values()] as Record<string, unknown>[];
	const record = (storeName: string, projectId: string, sourceId: string) => {
		const key = linkedOriginalBindingKey(projectId, sourceId);
		return records(storeName).find((candidate) => candidate.key === key);
	};
	return {
		port,
		memory,
		database,
		databaseName,
		indexedDB,
		bindings,
		videos: new LinkedVideoOriginalRepository(port, { ...deterministicOptions(), ...limits }),
		aliases: new LinkedOriginalProjectAliasRepository(port, {
			...limits,
			now: () => new Date(NOW),
			createBindingToken: tokenFactory('alias_binding'),
		}),
		bindingRecord: (projectId, sourceId) => record(LINKED_ORIGINAL_STORE_NAME, projectId, sourceId),
		rootRecord: (projectId, sourceId) => record(
			LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME,
			projectId,
			sourceId,
		),
		snapshot: () => ({
			bindings: structuredClone(records(LINKED_ORIGINAL_STORE_NAME)),
			roots: structuredClone(records(LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME)),
		}),
		seedRoot: async (root) => {
			if (!database) {
				memory.linkedOriginalProvisionalRoots.set(root.key as string, root);
				return;
			}
			await transact(database, LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME, 'readwrite', (stores) => (
				request(stores[LINKED_ORIGINAL_PROVISIONAL_ROOT_STORE_NAME].put(root))
			));
		},
	};
}

function assertRootMatches(fixture: WriterFixture, binding: LinkedOriginalBinding): void {
	const root = fixture.rootRecord(binding.projectId, binding.sourceId);
	assert.ok(root);
	assert.deepEqual({
		projectId: root.projectId,
		kind: root.kind,
		sourceId: root.sourceId,
		bindingToken: root.bindingToken,
	}, {
		projectId: binding.projectId,
		kind: binding.kind,
		sourceId: binding.sourceId,
		bindingToken: binding.bindingToken,
	});
}

async function seedAudioBinding(
	fixture: WriterFixture,
	projectId: string,
	source: LinkedOriginalSource,
): Promise<LinkedOriginalBinding> {
	const binding = await fixture.bindings.putIfCurrent(bindingInput(projectId, source), null);
	assert.ok(binding);
	return binding;
}

function audioInput(overrides: Partial<LinkedOriginalBindingInput> = {}): LinkedOriginalBindingInput {
	return {
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		kind: 'audio',
		projectId: 'root-writer-audio-project',
		sourceId: 'root-writer-audio-source',
		storageKey: 'root-writer-audio-storage',
		locatorId: 'locator_root_writer_audio_001',
		locatorRevision: 'snapshot_root_writer_audio_01',
		mimeType: 'audio/wav',
		byteLength: 131_116,
		sha256: 'ab'.repeat(32),
		sourceShape: audioShape(),
		...overrides,
	} as LinkedOriginalBindingInput;
}

function videoInput() {
	const source = videoSource('root-writer-video-source');
	return {
		schemaVersion: 1 as const,
		projectId: 'root-writer-video-project',
		sourceId: source.id,
		storageKey: source.storageKey,
		locatorId: 'locator_root_writer_video_001',
		locatorRevision: 'snapshot_root_writer_video_01',
		mimeType: source.mimeType,
		byteLength: 65_536,
		sha256: 'cd'.repeat(32),
		sourceShape: {
			frameCount: source.frameCount, sampleRate: source.sampleRate,
			width: source.width, height: source.height, frameRate: source.frameRate,
			videoCodec: source.videoCodec, audioCodec: source.audioCodec, hasAudio: source.hasAudio,
		},
	};
}

function bindingInput(projectId: string, source: LinkedOriginalSource): LinkedOriginalBindingInput {
	return {
		...audioInput(),
		projectId,
		sourceId: source.id,
		storageKey: source.storageKey,
		mimeType: source.mimeType,
		sourceShape: audioShape(),
	} as LinkedOriginalBindingInput;
}

function bindingInputFrom(binding: LinkedOriginalBinding): LinkedOriginalBindingInput {
	const { bindingToken: _bindingToken, boundAt: _boundAt, ...input } = binding;
	return input;
}

function audioShape() {
	return {
		frameCount: 32_768, channelCount: 2, sampleRate: 48_000,
		originalSampleRate: 48_000, sampleFormat: 'float32' as const, chunkFrames: 65_536,
	};
}

function audioSource(id: string): LinkedOriginalSource {
	return {
		kind: 'audio', id, storageKey: `${id}-storage`, mimeType: 'audio/wav',
		frameCount: 32_768, channelCount: 2, sampleRate: 48_000,
		originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
	};
}

function videoSource(id: string) {
	return {
		kind: 'video' as const, id, storageKey: `${id}-storage`, mimeType: 'video/mp4',
		frameCount: 96_000, sampleRate: 48_000, width: 1_920, height: 1_080,
		frameRate: 29.97, videoCodec: 'h264', audioCodec: 'aac', hasAudio: true,
	};
}

function deterministicOptions() {
	return { now: () => new Date(NOW), createBindingToken: tokenFactory('binding_token') };
}

function tokenFactory(prefix: string): () => string {
	let token = 0;
	return () => `${prefix}_${String(++token).padStart(8, '0')}`;
}

class FailNextMutationMap<Key, Value> extends Map<Key, Value> {
	#setFailure: unknown = null;
	#deleteFailure: unknown = null;
	failNextSet(error: unknown): void { this.#setFailure = error; }
	failNextDelete(error: unknown): void { this.#deleteFailure = error; }
	override set(key: Key, value: Value): this {
		if (this.#setFailure !== null) {
			const error = this.#setFailure;
			this.#setFailure = null;
			throw error;
		}
		return super.set(key, value);
	}
	override delete(key: Key): boolean {
		if (this.#deleteFailure !== null) {
			const error = this.#deleteFailure;
			this.#deleteFailure = null;
			throw error;
		}
		return super.delete(key);
	}
}
