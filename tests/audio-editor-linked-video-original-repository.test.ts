/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	LinkedVideoOriginalRepository,
	type LinkedVideoOriginalBindingInput,
} from '../src/common/editor/storage/linked-video-original-repository.ts';
import {
	LINKED_VIDEO_ORIGINAL_STORE_NAME,
	linkedVideoOriginalBindingKey,
} from '../src/common/editor/storage/linked-video-original-schema.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const SHA256 = 'ab'.repeat(32);
const NOW = '2026-08-02T10:11:12.345Z';

test('linked video repository creates and reads a defensive pathless binding', async () => {
	const { repository, memory } = memoryRepository('create');
	const input = bindingInput();
	const created = await repository.putIfCurrent(input, null);

	assert.ok(created);
	assert.equal(Object.isFrozen(created), true);
	assert.equal(Object.isFrozen(created.sourceShape), true);
	assert.equal(created.bindingToken, 'binding_token_00000001');
	assert.equal(created.boundAt, NOW);
	assert.deepEqual(await repository.get(input.projectId, input.sourceId), created);
	assert.notStrictEqual(await repository.get(input.projectId, input.sourceId), created);

	const [stored] = [...memory.linkedVideoOriginalBindings.values()] as Record<string, unknown>[];
	assert.deepEqual(Reflect.ownKeys(stored).sort(), ['binding', 'key', 'projectId']);
	assert.equal(containsBinaryOrLocatorExposure(stored), false);
	assert.equal(JSON.stringify(stored).includes('/Users/'), false);
});

test('linked video repository compare-and-swap replacement and deletion reject stale callers', async () => {
	const { repository } = memoryRepository('cas');
	const first = await repository.putIfCurrent(bindingInput(), null);
	assert.ok(first);

	assert.equal(await repository.putIfCurrent(bindingInput({ locatorId: 'locator_0000000000000002' }), null), null);
	assert.equal(await repository.putIfCurrent(
		bindingInput({ locatorId: 'locator_0000000000000002' }),
		'binding_token_stale_0001',
	), null);
	const second = await repository.putIfCurrent(
		bindingInput({
			locatorId: 'locator_0000000000000002',
			locatorRevision: 'snapshot_0000000000000002',
			sha256: 'cd'.repeat(32),
		}),
		first.bindingToken,
	);
	assert.ok(second);
	assert.notEqual(second.bindingToken, first.bindingToken);
	assert.equal(second.boundAt, NOW);
	assert.equal(second.sourceShape.width, first.sourceShape.width);

	assert.equal(await repository.deleteIfCurrent(
		second.projectId,
		second.sourceId,
		first.bindingToken,
	), false);
	assert.ok(await repository.get(second.projectId, second.sourceId));
	assert.equal(await repository.deleteIfCurrent(
		second.projectId,
		second.sourceId,
		second.bindingToken,
	), true);
	assert.equal(await repository.get(second.projectId, second.sourceId), null);
});

test('copied projects and source aliases bind the same storage key independently', async () => {
	const { repository } = memoryRepository('aliases');
	const inputs = [
		bindingInput(),
		bindingInput({ projectId: 'project-linked-video-copy' }),
		bindingInput({ sourceId: 'source-linked-video-alias' }),
	];
	for (const input of inputs) assert.ok(await repository.putIfCurrent(input, null));

	assert.deepEqual(
		await Promise.all(inputs.map(({ projectId, sourceId }) => repository.get(projectId, sourceId))),
		inputs.map((input, index) => ({
			...input,
			bindingToken: `binding_token_0000000${String(index + 1)}`,
			boundAt: NOW,
		})),
	);
});

test('malformed and key-spoofed stored bindings fail closed', async () => {
	const cases = [
		{ mutate: (record: Record<string, unknown>) => { record.key = 'attacker-key'; } },
		{ mutate: (record: Record<string, unknown>) => { record.projectId = 'other-project'; } },
		{ mutate: (record: Record<string, unknown>) => { record.path = '/private/movie.mp4'; } },
	] as const;
	for (const [index, { mutate }] of cases.entries()) {
		const { repository, memory } = memoryRepository(`malformed-${String(index)}`);
		const input = bindingInput();
		const valid = {
			key: linkedVideoOriginalBindingKey(input.projectId, input.sourceId),
			projectId: input.projectId,
			binding: {
				...input,
				bindingToken: 'binding_token_00000001',
				boundAt: NOW,
			},
		};
		mutate(valid);
		memory.linkedVideoOriginalBindings.set(
			linkedVideoOriginalBindingKey(input.projectId, input.sourceId),
			valid,
		);
		await assert.rejects(repository.get(input.projectId, input.sourceId), /binding|record|key/iu);
	}
});

test('linked video bindings persist through the IndexedDB repository', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-video-idb-${Date.now()}-${Math.random()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const memory = getMemoryDatabase(`${databaseName}-unused-memory`);
	const repository = new LinkedVideoOriginalRepository({
		memory,
		database: async () => database,
	}, deterministicOptions());
	const input = bindingInput();

	const created = await repository.putIfCurrent(input, null);
	assert.ok(created);
	assert.deepEqual(await repository.get(input.projectId, input.sourceId), created);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME), 1);
	assert.equal(memory.linkedVideoOriginalBindings.size, 0);
	assert.equal(await repository.deleteIfCurrent(input.projectId, input.sourceId, created.bindingToken), true);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME), 0);
});

test('durable linked-video inventory is complete, bounded, and deduplicated by exact locator revision', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-video-inventory-${Date.now()}-${Math.random()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const repository = new LinkedVideoOriginalRepository({
		memory: getMemoryDatabase(`${databaseName}-unused-memory`),
		database: async () => database,
	}, deterministicOptions());
	for (const input of [
		bindingInput(),
		bindingInput({ projectId: 'project-linked-video-copy', sourceId: 'source-linked-video-copy' }),
		bindingInput({
			projectId: 'project-linked-video-second',
			sourceId: 'source-linked-video-second',
			locatorId: 'locator_0000000000000002',
			locatorRevision: 'snapshot_0000000000000002',
		}),
	]) assert.ok(await repository.putIfCurrent(input, null));

	assert.deepEqual(await repository.listDurableLocatorReferences(), [{
		locatorId: 'locator_0000000000000001',
		locatorRevision: 'snapshot_0000000000000001',
	}, {
		locatorId: 'locator_0000000000000002',
		locatorRevision: 'snapshot_0000000000000002',
	}]);
	assert.equal(Object.isFrozen(await repository.listDurableLocatorReferences()), true);
	assert.equal((await memoryRepository('inventory-memory').repository.listDurableLocatorReferences()), null);
});

test('durable linked-video inventory fails closed for conflicting, corrupt, or over-limit records', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-video-inventory-invalid-${Date.now()}-${Math.random()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const repository = new LinkedVideoOriginalRepository({
		memory: getMemoryDatabase(`${databaseName}-unused-memory`),
		database: async () => database,
	}, { ...deterministicOptions(), maximumInventoryRecords: 2 });
	assert.ok(await repository.putIfCurrent(bindingInput(), null));
	assert.ok(await repository.putIfCurrent(bindingInput({
		projectId: 'project-linked-video-conflict',
		sourceId: 'source-linked-video-conflict',
		locatorRevision: 'snapshot_0000000000000002',
	}), null));
	await assert.rejects(repository.listDurableLocatorReferences(), /conflicting.*revision/iu);

	const conflict = indexedDB.records(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME)[1];
	const independent = {
		...conflict,
		binding: {
			...conflict.binding,
			locatorId: 'locator_0000000000000002',
			locatorRevision: 'snapshot_0000000000000002',
		},
	};
	indexedDB.seedRecord(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME, {
		...independent,
		key: 'spoofed-key',
	}, independent.key);
	await assert.rejects(repository.listDurableLocatorReferences(), /binding|record|key/iu);
	indexedDB.seedRecord(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME, independent, independent.key);

	indexedDB.seedRecord(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME, {
		...independent,
		key: linkedVideoOriginalBindingKey('project-linked-video-third', 'source-linked-video-third'),
		projectId: 'project-linked-video-third',
		binding: {
			...independent.binding,
			projectId: 'project-linked-video-third',
			sourceId: 'source-linked-video-third',
			locatorId: 'locator_0000000000000003',
			locatorRevision: 'snapshot_0000000000000003',
		},
	}, linkedVideoOriginalBindingKey('project-linked-video-third', 'source-linked-video-third'));
	await assert.rejects(repository.listDurableLocatorReferences(), /inventory.*limit|limit.*inventory/iu);
});

function bindingInput(overrides: Partial<LinkedVideoOriginalBindingInput> = {}): LinkedVideoOriginalBindingInput {
	return {
		schemaVersion: 1,
		projectId: 'project-linked-video',
		sourceId: 'source-linked-video',
		storageKey: 'storage-linked-video',
		locatorId: 'locator_0000000000000001',
		locatorRevision: 'snapshot_0000000000000001',
		mimeType: 'video/mp4',
		byteLength: 65_536,
		sha256: SHA256,
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
		...overrides,
	};
}

function memoryRepository(label: string) {
	const memory = getMemoryDatabase(`linked-video-${label}-${Date.now()}-${Math.random()}`);
	return {
		memory,
		repository: new LinkedVideoOriginalRepository({
			memory,
			database: async () => null,
		}, deterministicOptions()),
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

function containsBinaryOrLocatorExposure(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	if (value instanceof Blob || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return true;
	return Reflect.ownKeys(value).some((key) => (
		key === 'path' || key === 'url' || key === 'handle'
		|| containsBinaryOrLocatorExposure((value as Record<PropertyKey, unknown>)[key])
	));
}
