/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import type {
	LinkedVideoOriginalBinding,
	LinkedVideoOriginalBindingInput,
} from '../src/common/editor/storage/linked-video-original-binding.ts';
import { LINKED_ORIGINAL_BINDING_SCHEMA_VERSION } from '../src/common/editor/storage/linked-original-binding.ts';
import { LinkedOriginalRepository } from '../src/common/editor/storage/linked-original-repository.ts';
import { LinkedVideoOriginalProjectAliasRepository } from '../src/common/editor/storage/linked-video-original-project-alias-repository.ts';
import { LinkedVideoOriginalRepository } from '../src/common/editor/storage/linked-video-original-repository.ts';
import type { LinkedVideoOriginalSource } from '../src/common/editor/storage/linked-video-original-resolver.ts';
import {
	LINKED_VIDEO_ORIGINAL_STORE_NAME,
	linkedVideoOriginalBindingKey,
} from '../src/common/editor/storage/linked-video-original-schema.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { getMemoryDatabase, type EditorMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const SOURCE_PROJECT_ID = 'alias-source-project';
const DESTINATION_PROJECT_ID = 'alias-destination-project';
const LOCATOR_A = 'locator_0000000000000001';
const LOCATOR_B = 'locator_0000000000000002';
const REVISION_A = 'snapshot_0000000000000001';
const REVISION_B = 'snapshot_0000000000000002';
const SEED_NOW = '2026-08-02T10:00:00.000Z';
const ALIAS_NOW = '2026-08-02T11:00:00.000Z';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`${backend} copies only reachable bindings as fresh exact aliases`, async (context) => {
		const fixture = await aliasFixture(context, backend);
		const reachable = videoSource('source-reachable', 'storage-reachable');
		const unreachable = videoSource('source-unreachable', 'storage-unreachable');
		const unbound = videoSource('source-unbound', 'storage-unbound');
		const original = await seedBinding(fixture, SOURCE_PROJECT_ID, reachable, LOCATOR_A, REVISION_A);
		await seedBinding(fixture, SOURCE_PROJECT_ID, unreachable, LOCATOR_B, REVISION_B);

		const aliases = await fixture.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[reachable, unbound],
		);

		assert.equal(Object.isFrozen(aliases), true);
		assert.equal(aliases.length, 1);
		assert.deepEqual(sharedBindingFields(aliases[0]), sharedBindingFields(original));
		assert.equal(aliases[0].projectId, DESTINATION_PROJECT_ID);
		assert.equal(aliases[0].bindingToken, 'alias_binding_00000001');
		assert.equal(aliases[0].boundAt, ALIAS_NOW);
		assert.deepEqual(
			await fixture.bindings.get(DESTINATION_PROJECT_ID, reachable.id),
			aliases[0],
		);
		assert.equal(await fixture.bindings.get(DESTINATION_PROJECT_ID, unreachable.id), null);
		assert.equal(await fixture.bindings.get(DESTINATION_PROJECT_ID, unbound.id), null);
		assert.equal(recordCount(fixture), 3);
	});

	test(`${backend} rollback settles missing aliases and rejects replacements before any deletion`, async (context) => {
		const fixture = await aliasFixture(context, backend);
		const first = videoSource('source-a', 'storage-a');
		const second = videoSource('source-b', 'storage-b', { width: 1_280, height: 720 });
		await seedBinding(fixture, SOURCE_PROJECT_ID, first, LOCATOR_A, REVISION_A);
		await seedBinding(fixture, SOURCE_PROJECT_ID, second, LOCATOR_B, REVISION_B);
		const initial = await fixture.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[first, second],
		);
		assert.equal(await fixture.bindings.deleteIfCurrent(
			initial[0].projectId,
			initial[0].sourceId,
			initial[0].bindingToken,
		), true);

		await fixture.aliases.rollbackAliases(initial);
		assert.equal(await fixture.bindings.get(DESTINATION_PROJECT_ID, first.id), null);
		assert.equal(await fixture.bindings.get(DESTINATION_PROJECT_ID, second.id), null);

		const current = await fixture.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[first, second],
		);
		const replacement = await fixture.bindings.putIfCurrent(
			bindingInputFrom(current[1]),
			current[1].bindingToken,
		);
		assert.ok(replacement);

		await assert.rejects(
			fixture.aliases.rollbackAliases(current),
			/replaced|token.*match/iu,
		);
		assert.deepEqual(
			await fixture.bindings.get(DESTINATION_PROJECT_ID, first.id),
			current[0],
			'a matching alias must survive when any peer fails preflight',
		);
		assert.deepEqual(await fixture.bindings.get(DESTINATION_PROJECT_ID, second.id), replacement);
	});

	test(`${backend} video alias scans preserve unrelated generic audio rows`, async (context) => {
		const fixture = await aliasFixture(context, backend);
		const generic = new LinkedOriginalRepository(fixture.port, {
			now: () => new Date(SEED_NOW),
			createBindingToken: () => 'audio_binding_00000001',
		});
		assert.ok(await generic.putIfCurrent({
			schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
			kind: 'audio',
			projectId: DESTINATION_PROJECT_ID,
			sourceId: 'audio-source',
			storageKey: 'audio-storage',
			locatorId: 'audio_locator_0000000001',
			locatorRevision: 'audio_snapshot_000000001',
			mimeType: 'audio/wav',
			byteLength: 1_024,
			sha256: 'ab'.repeat(32),
			sourceShape: {
				frameCount: 120,
				channelCount: 2,
				sampleRate: 48_000,
				originalSampleRate: 48_000,
				sampleFormat: 'float32',
				chunkFrames: 65_536,
			},
		}, null));
		const video = videoSource('source-video', 'storage-video');
		await seedBinding(fixture, SOURCE_PROJECT_ID, video, LOCATOR_A, REVISION_A);

		assert.equal((await fixture.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[video],
		)).length, 1);
		assert.ok(await generic.get(DESTINATION_PROJECT_ID, 'audio-source'));
		assert.equal(recordCount(fixture), 3);
	});
}

test('an orphan destination binding blocks the whole copy before source validation or writes', async (context) => {
	const fixture = await aliasFixture(context, 'memory');
	const source = videoSource('source-live', 'storage-live');
	const orphan = videoSource('source-orphan', 'storage-orphan');
	const original = await seedBinding(fixture, SOURCE_PROJECT_ID, source, LOCATOR_A, REVISION_A);
	const destination = await seedBinding(
		fixture,
		DESTINATION_PROJECT_ID,
		orphan,
		LOCATOR_B,
		REVISION_B,
	);

	await assert.rejects(
		fixture.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[{ ...source, width: 1_280 }],
		),
		/destination.*binding|destination.*contains/iu,
	);
	assert.deepEqual(await fixture.bindings.get(SOURCE_PROJECT_ID, source.id), original);
	assert.deepEqual(await fixture.bindings.get(DESTINATION_PROJECT_ID, orphan.id), destination);
	assert.equal(await fixture.bindings.get(DESTINATION_PROJECT_ID, source.id), null);
	assert.equal(recordCount(fixture), 2);
});

test('copy requires exact storage key, MIME type, and video geometry', async (context) => {
	const fixture = await aliasFixture(context, 'memory');
	const source = videoSource('source-exact', 'storage-exact');
	await seedBinding(fixture, SOURCE_PROJECT_ID, source, LOCATOR_A, REVISION_A);
	const mismatches: LinkedVideoOriginalSource[] = [
		{ ...source, storageKey: 'storage-other' },
		{ ...source, mimeType: 'video/webm' },
		{ ...source, width: 1_280 },
		{ ...source, frameRate: 24 },
		{ ...source, audioCodec: null, hasAudio: false },
	];

	for (const mismatch of mismatches) {
		await assert.rejects(
			fixture.aliases.copyReachableAliases(
				SOURCE_PROJECT_ID,
				DESTINATION_PROJECT_ID,
				[mismatch],
			),
			/exactly match|does not.*match/iu,
		);
	}
	assert.equal(await fixture.bindings.get(DESTINATION_PROJECT_ID, source.id), null);
	assert.equal(recordCount(fixture), 1);
});

test('complete inventory preflight enforces prospective rows, exact references, and revision conflicts', async (context) => {
	const prospective = await aliasFixture(context, 'memory', {
		maximumInventoryRecords: 2,
		maximumInventoryReferences: 2,
	});
	const source = videoSource('source-live', 'storage-live');
	await seedBinding(prospective, SOURCE_PROJECT_ID, source, LOCATOR_A, REVISION_A);
	await seedBinding(
		prospective,
		'unrelated-project',
		videoSource('source-unrelated', 'storage-unrelated'),
		LOCATOR_A,
		REVISION_A,
	);
	await assert.rejects(
		prospective.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[source],
		),
		/prospective.*record|record.*limit/iu,
	);
	assert.equal(recordCount(prospective), 2);

	const referenceBound = await aliasFixture(context, 'memory', {
		maximumInventoryRecords: 3,
		maximumInventoryReferences: 1,
	});
	await seedBinding(referenceBound, SOURCE_PROJECT_ID, source, LOCATOR_A, REVISION_A);
	await seedBinding(
		referenceBound,
		'unrelated-project',
		videoSource('source-other-reference', 'storage-other-reference'),
		LOCATOR_B,
		REVISION_B,
	);
	await assert.rejects(
		referenceBound.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[source],
		),
		/exact-reference.*limit|reference.*limit/iu,
	);
	assert.equal(recordCount(referenceBound), 2);

	const conflict = await aliasFixture(context, 'memory');
	await seedBinding(conflict, SOURCE_PROJECT_ID, source, LOCATOR_A, REVISION_A);
	await seedBinding(
		conflict,
		'unrelated-project',
		videoSource('source-conflict', 'storage-conflict'),
		LOCATOR_A,
		REVISION_B,
	);
	await assert.rejects(
		conflict.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[source],
		),
		/conflicting.*revision/iu,
	);
	assert.equal(recordCount(conflict), 2);
});

test('a malformed record anywhere in the inventory blocks publication', async (context) => {
	const fixture = await aliasFixture(context, 'memory');
	const source = videoSource('source-live', 'storage-live');
	await seedBinding(fixture, SOURCE_PROJECT_ID, source, LOCATOR_A, REVISION_A);
	const unrelated = videoSource('source-malformed', 'storage-malformed');
	await seedBinding(fixture, 'unrelated-project', unrelated, LOCATOR_B, REVISION_B);
	const key = linkedVideoOriginalBindingKey('unrelated-project', unrelated.id);
	const record = storedRecord(fixture, key);
	fixture.memory.linkedVideoOriginalBindings.set(key, { ...record, path: '/private/original.mp4' });

	await assert.rejects(
		fixture.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[source],
		),
		/malformed|unsupported field|stored binding record/iu,
	);
	assert.equal(await fixture.bindings.get(DESTINATION_PROJECT_ID, source.id), null);
	assert.equal(recordCount(fixture), 2);
});

test('IndexedDB copy and rollback abort without partial batch writes', async (context) => {
	const fixture = await aliasFixture(context, 'indexeddb');
	const first = videoSource('source-a', 'storage-a');
	const second = videoSource('source-b', 'storage-b');
	await seedBinding(fixture, SOURCE_PROJECT_ID, first, LOCATOR_A, REVISION_A);
	await seedBinding(fixture, SOURCE_PROJECT_ID, second, LOCATOR_B, REVISION_B);
	const putFailure = new Error('planned alias put failure');
	fixture.indexedDB?.failNextPutForStore(LINKED_VIDEO_ORIGINAL_STORE_NAME, putFailure);

	await assert.rejects(
		fixture.aliases.copyReachableAliases(
			SOURCE_PROJECT_ID,
			DESTINATION_PROJECT_ID,
			[first, second],
		),
		(error) => error === putFailure,
	);
	assert.equal(await fixture.bindings.get(DESTINATION_PROJECT_ID, first.id), null);
	assert.equal(await fixture.bindings.get(DESTINATION_PROJECT_ID, second.id), null);

	const aliases = await fixture.aliases.copyReachableAliases(
		SOURCE_PROJECT_ID,
		DESTINATION_PROJECT_ID,
		[first, second],
	);
	const deleteFailure = new Error('planned alias delete failure');
	fixture.indexedDB?.failNextDeleteForStore(LINKED_VIDEO_ORIGINAL_STORE_NAME, deleteFailure);
	await assert.rejects(fixture.aliases.rollbackAliases(aliases), (error) => error === deleteFailure);
	assert.deepEqual(await fixture.bindings.get(DESTINATION_PROJECT_ID, first.id), aliases[0]);
	assert.deepEqual(await fixture.bindings.get(DESTINATION_PROJECT_ID, second.id), aliases[1]);
});

interface AliasRepositoryOptions {
	readonly maximumInventoryRecords?: number;
	readonly maximumInventoryReferences?: number;
}

interface AliasFixture {
	readonly port: StorageRepositoryPort;
	readonly aliases: LinkedVideoOriginalProjectAliasRepository;
	readonly bindings: LinkedVideoOriginalRepository;
	readonly memory: EditorMemoryDatabase;
	readonly indexedDB: ReturnType<typeof createInstrumentedIndexedDB> | null;
	readonly databaseName: string;
}

async function aliasFixture(
	context: TestContext,
	backend: 'memory' | 'indexeddb',
	options: AliasRepositoryOptions = {},
): Promise<AliasFixture> {
	const databaseName = `linked-alias-${backend}-${Date.now()}-${Math.random()}`;
	const memory = getMemoryDatabase(databaseName);
	const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
	const database = indexedDB
		? await openDatabase(indexedDB as unknown as IDBFactory, databaseName)
		: null;
	context.after(() => { database?.close(); });
	const port: StorageRepositoryPort = { memory, database: async () => database };
	let seedToken = 0;
	let aliasToken = 0;
	return {
		port,
		aliases: new LinkedVideoOriginalProjectAliasRepository(port, {
			...options,
			now: () => new Date(ALIAS_NOW),
			createBindingToken: () => {
				aliasToken += 1;
				return `alias_binding_${String(aliasToken).padStart(8, '0')}`;
			},
		}),
		bindings: new LinkedVideoOriginalRepository(port, {
			now: () => new Date(SEED_NOW),
			createBindingToken: () => {
				seedToken += 1;
				return `seed_binding_${String(seedToken).padStart(8, '0')}`;
			},
		}),
		memory,
		indexedDB,
		databaseName,
	};
}

async function seedBinding(
	fixture: AliasFixture,
	projectId: string,
	source: LinkedVideoOriginalSource,
	locatorId: string,
	locatorRevision: string,
): Promise<LinkedVideoOriginalBinding> {
	const binding = await fixture.bindings.putIfCurrent(
		bindingInput(projectId, source, locatorId, locatorRevision),
		null,
	);
	assert.ok(binding);
	return binding;
}

function bindingInput(
	projectId: string,
	source: LinkedVideoOriginalSource,
	locatorId: string,
	locatorRevision: string,
): LinkedVideoOriginalBindingInput {
	return {
		schemaVersion: 1,
		projectId,
		sourceId: source.id,
		storageKey: source.storageKey,
		locatorId,
		locatorRevision,
		mimeType: source.mimeType,
		byteLength: 65_536,
		sha256: 'ab'.repeat(32),
		sourceShape: {
			frameCount: source.frameCount,
			sampleRate: source.sampleRate,
			width: source.width,
			height: source.height,
			frameRate: source.frameRate,
			videoCodec: source.videoCodec,
			audioCodec: source.audioCodec,
			hasAudio: source.hasAudio,
		},
	};
}

function bindingInputFrom(binding: LinkedVideoOriginalBinding): LinkedVideoOriginalBindingInput {
	return {
		schemaVersion: binding.schemaVersion,
		projectId: binding.projectId,
		sourceId: binding.sourceId,
		storageKey: binding.storageKey,
		locatorId: binding.locatorId,
		locatorRevision: binding.locatorRevision,
		mimeType: binding.mimeType,
		byteLength: binding.byteLength,
		sha256: binding.sha256,
		sourceShape: binding.sourceShape,
	};
}

function videoSource(
	id: string,
	storageKey: string,
	overrides: Partial<LinkedVideoOriginalSource> = {},
): LinkedVideoOriginalSource {
	return {
		kind: 'video',
		id,
		storageKey,
		mimeType: 'video/mp4',
		frameCount: 96_000,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 29.97,
		videoCodec: 'h264',
		audioCodec: 'aac',
		hasAudio: true,
		...overrides,
	};
}

function sharedBindingFields(binding: LinkedVideoOriginalBinding): object {
	return {
		schemaVersion: binding.schemaVersion,
		sourceId: binding.sourceId,
		storageKey: binding.storageKey,
		locatorId: binding.locatorId,
		locatorRevision: binding.locatorRevision,
		mimeType: binding.mimeType,
		byteLength: binding.byteLength,
		sha256: binding.sha256,
		sourceShape: binding.sourceShape,
	};
}

function recordCount(fixture: AliasFixture): number {
	return fixture.indexedDB
		? fixture.indexedDB.recordCount(fixture.databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME)
		: fixture.memory.linkedVideoOriginalBindings.size;
}

function storedRecord(fixture: AliasFixture, key: string): Readonly<Record<string, unknown>> {
	const value = fixture.indexedDB
		? fixture.indexedDB.records(fixture.databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME)
			.find((record: Readonly<Record<string, unknown>>) => record.key === key)
		: fixture.memory.linkedVideoOriginalBindings.get(key);
	assert.ok(value && typeof value === 'object');
	return value as Readonly<Record<string, unknown>>;
}
