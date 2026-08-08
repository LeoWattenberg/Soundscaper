/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	type LinkedOriginalBindingInput,
} from '../src/common/editor/storage/linked-original-binding.ts';
import { LinkedOriginalRepository } from '../src/common/editor/storage/linked-original-repository.ts';
import {
	LINKED_ORIGINAL_STORE_NAME,
	linkedOriginalBindingKey,
} from '../src/common/editor/storage/linked-original-schema.ts';
import {
	LinkedVideoOriginalRepository,
	type LinkedVideoOriginalBindingInput,
} from '../src/common/editor/storage/linked-video-original-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const NOW = '2026-08-02T10:11:12.345Z';

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`linked original repository persists discriminated audio and video bindings in ${backend}`, async (context) => {
		const fixture = await repositoryFixture(context, `bindings-${backend}`, backend);
		const audio = await fixture.repository.putIfCurrent(audioInput(), null);
		const video = await fixture.repository.putIfCurrent(videoInput(), null);

		assert.ok(audio);
		assert.ok(video);
		assert.equal(audio.kind, 'audio');
		assert.equal(video.kind, 'video');
		assert.equal(audio.schemaVersion, LINKED_ORIGINAL_BINDING_SCHEMA_VERSION);
		assert.equal(video.schemaVersion, LINKED_ORIGINAL_BINDING_SCHEMA_VERSION);
		assert.deepEqual(await fixture.repository.get(audio.projectId, audio.sourceId), audio);
		assert.deepEqual(await fixture.repository.get(video.projectId, video.sourceId), video);
		assert.equal(fixture.recordCount(), 2);
	});
}

test('generic reads accept existing schema-v1 rows as video while the video API stays schema-v1', async () => {
	const memory = getMemoryDatabase(`linked-original-legacy-${Date.now()}-${Math.random()}`);
	const port = { memory, database: async () => null };
	const video = new LinkedVideoOriginalRepository(port, deterministicOptions());
	const generic = new LinkedOriginalRepository(port, deterministicOptions());
	const input = legacyVideoInput();
	const created = await video.putIfCurrent(input, null);

	assert.ok(created);
	assert.deepEqual(created, { ...input, bindingToken: 'binding_token_00000001', boundAt: NOW });
	assert.equal(created.schemaVersion, 1);
	assert.equal(Object.hasOwn(created, 'kind'), false);
	const normalized = await generic.get(input.projectId, input.sourceId);
	assert.deepEqual(normalized, {
		...created,
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		kind: 'video',
	});
	const [record] = [...memory.linkedVideoOriginalBindings.values()] as Record<string, unknown>[];
	assert.equal((record.binding as Record<string, unknown>).schemaVersion, 1);
	assert.equal(Object.hasOwn(record.binding as object, 'kind'), false);
});

test('an IndexedDB schema-v1 row reopens as generic video without rewriting its raw record', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-original-legacy-reopen-${Date.now()}-${Math.random()}`;
	let database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const memory = getMemoryDatabase(`${databaseName}-unused`);
	const port = { memory, database: async () => database };
	const video = new LinkedVideoOriginalRepository(port, deterministicOptions());
	const created = await video.putIfCurrent(legacyVideoInput(), null);
	assert.ok(created);
	database.close();
	database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);

	const generic = new LinkedOriginalRepository(port, deterministicOptions());
	assert.equal((await generic.get(created.projectId, created.sourceId))?.kind, 'video');
	const [raw] = indexedDB.records(databaseName, LINKED_ORIGINAL_STORE_NAME);
	assert.equal(raw.binding.schemaVersion, 1);
	assert.equal(Object.hasOwn(raw.binding, 'kind'), false);
});

test('an IndexedDB quota rejection during binding publication preserves the previous pair', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-original-quota-${Date.now()}-${Math.random()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const memory = getMemoryDatabase(`${databaseName}-unused`);
	const repository = new LinkedOriginalRepository(
		{ memory, database: async () => database }, deterministicOptions(),
	);
	const previous = await repository.putIfCurrent(audioInput(), null);
	assert.ok(previous);

	const exhaustion = new DOMException('The storage quota was exceeded during a write.', 'QuotaExceededError');
	indexedDB.failNextPutForStore(LINKED_ORIGINAL_STORE_NAME, exhaustion);
	const replacement = audioInput({ locatorRevision: 'snapshot_audio_0000000002' });
	await assert.rejects(
		repository.putIfCurrent(replacement, previous.bindingToken),
		(error: unknown) => error === exhaustion,
	);

	assert.deepEqual(await repository.get(previous.projectId, previous.sourceId), previous);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_ORIGINAL_STORE_NAME), 1);

	const replaced = await repository.putIfCurrent(replacement, previous.bindingToken);
	assert.ok(replaced);
	assert.deepEqual(await repository.get(previous.projectId, previous.sourceId), replaced);
});

test('storage-key lookup returns one complete frozen exact alias group across schema versions', async () => {
	const memory = getMemoryDatabase(`linked-original-aliases-${Date.now()}-${Math.random()}`);
	const port = { memory, database: async () => null };
	const generic = new LinkedOriginalRepository(port, deterministicOptions());
	const video = new LinkedVideoOriginalRepository(port, deterministicOptions());
	const first = await video.putIfCurrent(legacyVideoInput(), null);
	assert.ok(first);
	assert.ok(await generic.putIfCurrent(videoInput({
		projectId: 'project-video-alias',
		sourceId: 'source-video-alias',
	}), null));

	const aliases = await generic.listByStorageKey('storage-video');
	assert.deepEqual(aliases.map(({ projectId, sourceId, kind, schemaVersion }) => ({
		projectId,
		sourceId,
		kind,
		schemaVersion,
	})), [{
		projectId: 'project-video',
		sourceId: 'source-video',
		kind: 'video',
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	}, {
		projectId: 'project-video-alias',
		sourceId: 'source-video-alias',
		kind: 'video',
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
	}]);
	assert.equal(Object.isFrozen(aliases), true);
	assert.equal(aliases.every(Object.isFrozen), true);
	assert.deepEqual(await generic.listByStorageKey('storage-absent'), []);
});

for (const [label, conflict] of [
	['kind', audioInput({ storageKey: 'storage-video' })],
	['geometry', videoInput({
		projectId: 'project-video-conflict',
		sourceId: 'source-video-conflict',
		sourceShape: { ...videoShape(), width: 640 },
	})],
	['content', videoInput({
		projectId: 'project-video-conflict',
		sourceId: 'source-video-conflict',
		sha256: 'cd'.repeat(32),
	})],
] as const) {
	test(`storage-key lookup fails closed on conflicting ${label}`, async () => {
		const { repository } = await repositoryFixture(undefined, `conflict-${label}`, 'memory');
		assert.ok(await repository.putIfCurrent(videoInput(), null));
		assert.ok(await repository.putIfCurrent(conflict, null));
		await assert.rejects(repository.listByStorageKey('storage-video'), /conflict/iu);
	});
}

test('storage-key lookup validates the complete bounded inventory, including nonmatching rows', async () => {
	const fixture = await repositoryFixture(undefined, 'lookup-bound', 'memory', {
		maximumInventoryRecords: 1,
	});
	assert.ok(await fixture.repository.putIfCurrent(videoInput(), null));
	const audio = audioInput();
	const audioKey = linkedOriginalBindingKey(audio.projectId, audio.sourceId);
	fixture.memory.linkedVideoOriginalBindings.set(audioKey, {
		key: audioKey,
		projectId: audio.projectId,
		binding: {
			...audio,
			bindingToken: 'binding_seeded_inventory_01',
			boundAt: NOW,
		},
	});
	await assert.rejects(fixture.repository.listByStorageKey('storage-video'), /record.*limit|limit.*record/iu);

	fixture.memory.linkedVideoOriginalBindings.set(audioKey, {
		key: audioKey,
		projectId: 'project-audio',
		binding: { path: '/private/audio.wav' },
	});
	await assert.rejects(fixture.repository.listByStorageKey('storage-video'), /binding|schema|field/iu);
});

test('mixed audio and video locator inventories preserve exact revisions and never delete external media', async () => {
	const fixture = await repositoryFixture(undefined, 'locator-inventory', 'memory');
	assert.ok(await fixture.repository.putIfCurrent(audioInput({
		locatorId: 'locator_video_000000000001',
		locatorRevision: 'snapshot_audio_same_id_001',
	}), null));
	assert.ok(await fixture.repository.putIfCurrent(videoInput(), null));
	assert.ok(await fixture.repository.putIfCurrent(audioInput({
		projectId: 'project-audio-alias',
		sourceId: 'source-audio-alias',
		locatorId: 'locator_video_000000000001',
		locatorRevision: 'snapshot_audio_same_id_001',
	}), null));
	assert.deepEqual(await fixture.repository.listLocatorReferences(), [{
		kind: 'audio',
		locatorId: 'locator_video_000000000001',
		locatorRevision: 'snapshot_audio_same_id_001',
	}, {
		kind: 'video',
		locatorId: 'locator_video_000000000001',
		locatorRevision: 'snapshot_video_0000000001',
	}]);
	const audio = await fixture.repository.get('project-audio', 'source-audio');
	assert.ok(audio);
	assert.equal(await fixture.repository.deleteIfCurrent(
		audio.projectId,
		audio.sourceId,
		audio.bindingToken,
	), true);
	assert.equal(fixture.memory.linkedVideoOriginalBindings.size, 2);
});

test('same-kind locator revisions remain exact conflict fences', async () => {
	const fixture = await repositoryFixture(undefined, 'locator-conflict', 'memory');
	assert.ok(await fixture.repository.putIfCurrent(audioInput(), null));
	assert.ok(await fixture.repository.putIfCurrent(audioInput({
		projectId: 'project-audio-alias',
		sourceId: 'source-audio-alias',
		locatorRevision: 'snapshot_audio_0000000002',
	}), null));
	await assert.rejects(fixture.repository.listLocatorReferences(), /conflicting.*revision/iu);
});

test('legacy durable video reconciliation preserves and never returns audio rows', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-original-video-reconcile-${Date.now()}-${Math.random()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const memory = getMemoryDatabase(`${databaseName}-unused`);
	const port = { memory, database: async () => database };
	const generic = new LinkedOriginalRepository(port, deterministicOptions());
	const video = new LinkedVideoOriginalRepository(port, deterministicOptions());
	assert.ok(await generic.putIfCurrent(audioInput({ projectId: 'project-audio-orphan' }), null));
	assert.ok(await video.putIfCurrent(legacyVideoInput(), null));
	assert.ok(await video.putIfCurrent({
		...legacyVideoInput(),
		projectId: 'project-video-orphan',
		sourceId: 'source-video-orphan',
	}, null));

	assert.deepEqual(await video.reconcileDurableLocatorReferences(['project-video']), [{
		locatorId: 'locator_video_000000000001',
		locatorRevision: 'snapshot_video_0000000001',
	}]);
	assert.ok(await generic.get('project-audio-orphan', 'source-audio'));
	assert.equal(await video.get('project-video-orphan', 'source-video-orphan'), null);
});

test('generic durable reconciliation prunes absent mixed aliases and returns live kindful locators', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-original-generic-reconcile-${Date.now()}-${Math.random()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const repository = new LinkedOriginalRepository({
		memory: getMemoryDatabase(`${databaseName}-unused`),
		database: async () => database,
	}, deterministicOptions());
	const sharedLocatorId = 'locator_shared_000000000001';
	for (const input of [
		audioInput({ locatorId: sharedLocatorId }),
		audioInput({
			projectId: 'project-audio-orphan-alias',
			sourceId: 'source-audio-orphan-alias',
			locatorId: sharedLocatorId,
		}),
		videoInput({ locatorId: sharedLocatorId }),
		videoInput({
			projectId: 'project-video-orphan',
			sourceId: 'source-video-orphan',
			locatorId: 'locator_video_000000000002',
			locatorRevision: 'snapshot_video_0000000002',
			storageKey: 'storage-video-orphan',
		}),
	]) assert.ok(await repository.putIfCurrent(input, null));

	const references = await repository.reconcileDurableLocatorReferences([
		'project-audio',
		'project-video',
	]);
	assert.deepEqual(references, [{
		kind: 'audio',
		locatorId: sharedLocatorId,
		locatorRevision: 'snapshot_audio_0000000001',
	}, {
		kind: 'video',
		locatorId: sharedLocatorId,
		locatorRevision: 'snapshot_video_0000000001',
	}]);
	assert.equal(Object.isFrozen(references), true);
	assert.equal(references?.every(Object.isFrozen), true);
	assert.ok(await repository.get('project-audio', 'source-audio'));
	assert.ok(await repository.get('project-video', 'source-video'));
	assert.equal(await repository.get(
		'project-audio-orphan-alias',
		'source-audio-orphan-alias',
	), null);
	assert.equal(await repository.get('project-video-orphan', 'source-video-orphan'), null);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_ORIGINAL_STORE_NAME), 2);
});

test('generic reconciliation is durable-only and leaves memory bindings untouched', async () => {
	const fixture = await repositoryFixture(undefined, 'generic-reconcile-memory', 'memory');
	assert.ok(await fixture.repository.putIfCurrent(audioInput(), null));

	assert.equal(await fixture.repository.reconcileDurableLocatorReferences([
		'project-audio',
		'project-audio',
	]), null);
	assert.ok(await fixture.repository.get('project-audio', 'source-audio'));
});

test('generic reconciliation validates the complete mixed inventory before deleting bindings', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-original-generic-invalid-${Date.now()}-${Math.random()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const repository = new LinkedOriginalRepository({
		memory: getMemoryDatabase(`${databaseName}-unused`),
		database: async () => database,
	}, deterministicOptions());
	assert.ok(await repository.putIfCurrent(audioInput({
		projectId: 'project-audio-orphan',
	}), null));
	assert.ok(await repository.putIfCurrent(videoInput(), null));
	const malformedKey = linkedOriginalBindingKey('project-malformed', 'source-malformed');
	indexedDB.seedRecord(databaseName, LINKED_ORIGINAL_STORE_NAME, {
		key: malformedKey,
		projectId: 'project-malformed',
		binding: { path: '/private/external.wav' },
	}, malformedKey);

	await assert.rejects(
		repository.reconcileDurableLocatorReferences(['project-video']),
		/binding|schema|field/iu,
	);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_ORIGINAL_STORE_NAME), 3);
	assert.ok(await repository.get('project-audio-orphan', 'source-audio'));
});

test('generic reconciliation rejects duplicate identities and mixed alias conflicts without mutation', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-original-generic-conflicts-${Date.now()}-${Math.random()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const repository = new LinkedOriginalRepository({
		memory: getMemoryDatabase(`${databaseName}-unused`),
		database: async () => database,
	}, deterministicOptions());
	assert.ok(await repository.putIfCurrent(audioInput({ storageKey: 'storage-conflict' }), null));
	assert.ok(await repository.putIfCurrent(videoInput({ storageKey: 'storage-conflict' }), null));

	await assert.rejects(
		repository.reconcileDurableLocatorReferences(['project-audio', 'project-audio']),
		/duplicate.*project|project.*duplicate/iu,
	);
	await assert.rejects(
		repository.reconcileDurableLocatorReferences([`project\u0000invalid`]),
		/projectId|identity|control/iu,
	);
	await assert.rejects(
		repository.reconcileDurableLocatorReferences(['project-audio', 'project-video']),
		/storage.*conflict|conflict.*kind|alias.*conflict/iu,
	);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_ORIGINAL_STORE_NAME), 2);
});

test('generic reconciliation rejects mixed reference and revision conflicts before deletion', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-original-generic-reference-conflict-${Date.now()}-${Math.random()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const repository = new LinkedOriginalRepository({
		memory: getMemoryDatabase(`${databaseName}-unused`),
		database: async () => database,
	}, { ...deterministicOptions(), maximumInventoryReferences: 2 });
	assert.ok(await repository.putIfCurrent(audioInput(), null));
	assert.ok(await repository.putIfCurrent(audioInput({
		projectId: 'project-audio-conflict',
		sourceId: 'source-audio-conflict',
		storageKey: 'storage-audio-conflict',
		locatorRevision: 'snapshot_audio_0000000002',
	}), null));
	await assert.rejects(
		repository.reconcileDurableLocatorReferences([]),
		/conflicting.*revision/iu,
	);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_ORIGINAL_STORE_NAME), 2);

	const conflict = indexedDB.records(databaseName, LINKED_ORIGINAL_STORE_NAME)[1];
	indexedDB.seedRecord(databaseName, LINKED_ORIGINAL_STORE_NAME, {
		...conflict,
		binding: {
			...conflict.binding,
			locatorId: 'locator_audio_000000000002',
		},
	}, conflict.key);
	assert.ok(await repository.putIfCurrent(videoInput(), null));
	await assert.rejects(
		repository.reconcileDurableLocatorReferences([]),
		/reference.*limit|limit.*reference/iu,
	);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_ORIGINAL_STORE_NAME), 3);
});

test('generic reconciliation rolls back a failed mixed-binding deletion', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-original-generic-delete-rollback-${Date.now()}-${Math.random()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const repository = new LinkedOriginalRepository({
		memory: getMemoryDatabase(`${databaseName}-unused`),
		database: async () => database,
	}, deterministicOptions());
	assert.ok(await repository.putIfCurrent(audioInput(), null));
	assert.ok(await repository.putIfCurrent(videoInput({
		projectId: 'project-video-orphan',
		sourceId: 'source-video-orphan',
	}), null));
	const failure = new Error('planned generic binding delete failure');
	indexedDB.failNextDeleteForStore(LINKED_ORIGINAL_STORE_NAME, failure);

	await assert.rejects(
		repository.reconcileDurableLocatorReferences(['project-audio']),
		(error) => error === failure,
	);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_ORIGINAL_STORE_NAME), 2);
	assert.deepEqual(await repository.reconcileDurableLocatorReferences(['project-audio']), [{
		kind: 'audio',
		locatorId: 'locator_audio_000000000001',
		locatorRevision: 'snapshot_audio_0000000001',
	}]);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_ORIGINAL_STORE_NAME), 1);
});

function audioInput(overrides: Partial<LinkedOriginalBindingInput> = {}): LinkedOriginalBindingInput {
	return {
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		kind: 'audio',
		projectId: 'project-audio',
		sourceId: 'source-audio',
		storageKey: 'storage-audio',
		locatorId: 'locator_audio_000000000001',
		locatorRevision: 'snapshot_audio_0000000001',
		mimeType: 'audio/wav',
		byteLength: 131_116,
		sha256: 'ab'.repeat(32),
		sourceShape: audioShape(),
		...overrides,
	} as LinkedOriginalBindingInput;
}

function videoInput(overrides: Partial<LinkedOriginalBindingInput> = {}): LinkedOriginalBindingInput {
	return {
		schemaVersion: LINKED_ORIGINAL_BINDING_SCHEMA_VERSION,
		kind: 'video',
		projectId: 'project-video',
		sourceId: 'source-video',
		storageKey: 'storage-video',
		locatorId: 'locator_video_000000000001',
		locatorRevision: 'snapshot_video_0000000001',
		mimeType: 'video/mp4',
		byteLength: 65_536,
		sha256: '12'.repeat(32),
		sourceShape: videoShape(),
		...overrides,
	} as LinkedOriginalBindingInput;
}

function legacyVideoInput(): LinkedVideoOriginalBindingInput {
	const { kind: _kind, ...input } = videoInput();
	return { ...input, schemaVersion: 1 } as LinkedVideoOriginalBindingInput;
}

function audioShape() {
	return {
		frameCount: 32_768,
		channelCount: 2,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		sampleFormat: 'float32' as const,
		chunkFrames: 65_536,
	};
}

function videoShape() {
	return {
		frameCount: 96_000,
		sampleRate: 48_000,
		width: 1_920,
		height: 1_080,
		frameRate: 29.97,
		videoCodec: 'h264',
		audioCodec: 'aac',
		hasAudio: true,
	};
}

async function repositoryFixture(
	context: { after(callback: () => void): void } | undefined,
	label: string,
	backend: 'memory' | 'indexeddb',
	limits: Readonly<{
		maximumInventoryRecords?: number;
		maximumInventoryReferences?: number;
	}> = {},
) {
	const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
	const databaseName = `linked-original-${label}-${Date.now()}-${Math.random()}`;
	const database = indexedDB
		? await openDatabase(indexedDB as unknown as IDBFactory, databaseName)
		: null;
	context?.after(() => { database?.close(); });
	const memory = getMemoryDatabase(databaseName);
	return {
		memory,
		repository: new LinkedOriginalRepository({
			memory,
			database: async () => database,
		}, { ...deterministicOptions(), ...limits }),
		recordCount: () => indexedDB
			? indexedDB.recordCount(databaseName, LINKED_ORIGINAL_STORE_NAME)
			: memory.linkedVideoOriginalBindings.size,
	};
}

function deterministicOptions() {
	let token = 0;
	return {
		now: () => new Date(NOW),
		createBindingToken: () => {
			token += 1;
			return `binding_token_${String(token).padStart(8, '0')}`;
		},
	};
}
