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

for (const backend of ['memory', 'indexeddb'] as const) {
	test(`bounded ${backend} locator snapshots validate and deduplicate aliases`, async (context) => {
		const indexedDB = backend === 'indexeddb' ? createInstrumentedIndexedDB() : null;
		const databaseName = `linked-video-snapshot-${backend}-${Date.now()}-${Math.random()}`;
		const database = indexedDB
			? await openDatabase(indexedDB as unknown as IDBFactory, databaseName)
			: null;
		context.after(() => { database?.close(); });
		const repository = new LinkedVideoOriginalRepository({
			memory: getMemoryDatabase(databaseName),
			database: async () => database,
		}, deterministicOptions());
		for (const input of [
			bindingInput({
				projectId: 'project-second',
				sourceId: 'source-second',
				locatorId: 'locator_0000000000000002',
				locatorRevision: 'snapshot_0000000000000002',
			}),
			bindingInput({ projectId: 'project-alias', sourceId: 'source-alias' }),
			bindingInput(),
		]) assert.ok(await repository.putIfCurrent(input, null));

		const references = await repository.listLocatorReferences();
		assert.deepEqual(references, [{
			locatorId: 'locator_0000000000000001',
			locatorRevision: 'snapshot_0000000000000001',
		}, {
			locatorId: 'locator_0000000000000002',
			locatorRevision: 'snapshot_0000000000000002',
		}]);
		assert.equal(Object.isFrozen(references), true);
		assert.equal(references.every(Object.isFrozen), true);
		if (indexedDB) {
			const stored = indexedDB.records(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME)[0];
			indexedDB.seedRecord(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME, {
				...stored,
				key: 'spoofed-snapshot-key',
			}, stored.key);
			await assert.rejects(repository.listLocatorReferences(), /binding|record|key/iu);
		}
	});
}

test('memory locator snapshots enforce the complete inventory bounds and revision fence', async () => {
	const { memory, repository } = memoryRepository('snapshot-bounds', {
		maximumInventoryRecords: 2,
		maximumInventoryReferences: 1,
	});
	assert.ok(await repository.putIfCurrent(bindingInput(), null));
	assert.ok(await repository.putIfCurrent(bindingInput({
		projectId: 'project-alias',
		sourceId: 'source-alias',
		locatorRevision: 'snapshot_0000000000000002',
	}), null));
	await assert.rejects(repository.listLocatorReferences(), /conflicting.*revision/iu);
	const secondKey = linkedVideoOriginalBindingKey('project-alias', 'source-alias');
	memory.linkedVideoOriginalBindings.delete(secondKey);
	assert.ok(await repository.putIfCurrent(bindingInput({
		projectId: 'project-second',
		sourceId: 'source-second',
		locatorId: 'locator_0000000000000002',
		locatorRevision: 'snapshot_0000000000000002',
	}), null));
	await assert.rejects(repository.listLocatorReferences(), /reference.*limit|limit.*reference/iu);

	const recordLimited = memoryRepository('snapshot-record-bound', {
		maximumInventoryRecords: 1,
		maximumInventoryReferences: 2,
	}).repository;
	assert.ok(await recordLimited.putIfCurrent(bindingInput(), null));
	assert.ok(await recordLimited.putIfCurrent(bindingInput({
		projectId: 'project-second-record',
		sourceId: 'source-second-record',
	}), null));
	await assert.rejects(recordLimited.listLocatorReferences(), /record.*limit|limit.*record/iu);
});

test('durable reconciliation removes unreachable bindings while preserving live aliases', async (context) => {
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

	const references = await repository.reconcileDurableLocatorReferences([
		'project-linked-video',
		'project-linked-video-second',
	]);
	assert.deepEqual(references, [{
		locatorId: 'locator_0000000000000001',
		locatorRevision: 'snapshot_0000000000000001',
	}, {
		locatorId: 'locator_0000000000000002',
		locatorRevision: 'snapshot_0000000000000002',
	}]);
	assert.equal(Object.isFrozen(references), true);
	assert.equal(await repository.get('project-linked-video-copy', 'source-linked-video-copy'), null);
	assert.ok(await repository.get('project-linked-video', 'source-linked-video'));
	assert.ok(await repository.get('project-linked-video-second', 'source-linked-video-second'));

	const ephemeral = memoryRepository('inventory-memory');
	assert.ok(await ephemeral.repository.putIfCurrent(bindingInput(), null));
	assert.equal(await ephemeral.repository.reconcileDurableLocatorReferences([]), null);
	assert.ok(await ephemeral.repository.get('project-linked-video', 'source-linked-video'));
});

test('canonical project identities use the exact linked-binding identity contract', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-video-project-identities-${Date.now()}-${Math.random()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const repository = new LinkedVideoOriginalRepository({
		memory: getMemoryDatabase(`${databaseName}-unused-memory`),
		database: async () => database,
	}, deterministicOptions());
	assert.ok(await repository.putIfCurrent(bindingInput(), null));

	for (const projectId of [`project\u0000id`, 'p'.repeat(257)]) {
		await assert.rejects(
			repository.reconcileDurableLocatorReferences([projectId]),
			/projectId|identity|character limit|control/iu,
		);
	}
	const exactProjectLimit = [
		'project-linked-video',
		...Array.from({ length: 9_999 }, (_, index) => `project-${String(index)}`),
	];
	assert.equal((await repository.reconcileDurableLocatorReferences(exactProjectLimit))?.length, 1);
	await assert.rejects(
		repository.reconcileDurableLocatorReferences([...exactProjectLimit, 'project-over-limit']),
		/project.*limit|limit.*project/iu,
	);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME), 1);
});

test('durable reconciliation rejects conflicts and reference limits even across unreachable bindings', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-video-inventory-invalid-${Date.now()}-${Math.random()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const repository = new LinkedVideoOriginalRepository({
		memory: getMemoryDatabase(`${databaseName}-unused-memory`),
		database: async () => database,
	}, {
		...deterministicOptions(),
		maximumInventoryRecords: 3,
		maximumInventoryReferences: 2,
	});
	assert.ok(await repository.putIfCurrent(bindingInput(), null));
	assert.ok(await repository.putIfCurrent(bindingInput({
		projectId: 'project-linked-video-conflict',
		sourceId: 'source-linked-video-conflict',
		locatorRevision: 'snapshot_0000000000000002',
	}), null));
	await assert.rejects(repository.reconcileDurableLocatorReferences([]), /conflicting.*revision/iu);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME), 2);

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
	await assert.rejects(repository.reconcileDurableLocatorReferences([]), /binding|record|key/iu);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME), 2);
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
	await assert.rejects(repository.reconcileDurableLocatorReferences([]), /inventory.*limit|limit.*inventory/iu);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME), 3);
});

test('durable reconciliation rolls back when the complete binding scan exceeds its record limit', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-video-record-limit-${Date.now()}-${Math.random()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const repository = new LinkedVideoOriginalRepository({
		memory: getMemoryDatabase(`${databaseName}-unused-memory`),
		database: async () => database,
	}, { ...deterministicOptions(), maximumInventoryRecords: 2 });
	const exactLimitInputs = [
		bindingInput(),
		bindingInput({ projectId: 'project-alias-b', sourceId: 'source-alias-b' }),
	];
	for (const input of exactLimitInputs) assert.ok(await repository.putIfCurrent(input, null));
	assert.equal((await repository.reconcileDurableLocatorReferences(
		exactLimitInputs.map(({ projectId }) => projectId),
	))?.length, 1);
	assert.ok(await repository.putIfCurrent(bindingInput({
		projectId: 'project-alias-c',
		sourceId: 'source-alias-c',
	}), null));

	await assert.rejects(
		repository.reconcileDurableLocatorReferences([
			...exactLimitInputs.map(({ projectId }) => projectId),
			'project-alias-c',
		]),
		/record.*limit|limit.*record/iu,
	);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME), 3);
});

test('durable linked-video reconciliation rolls back a failed unreachable-binding deletion', async (context) => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = `linked-video-reconcile-rollback-${Date.now()}-${Math.random()}`;
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	context.after(() => { database.close(); });
	const repository = new LinkedVideoOriginalRepository({
		memory: getMemoryDatabase(`${databaseName}-unused-memory`),
		database: async () => database,
	}, deterministicOptions());
	assert.ok(await repository.putIfCurrent(bindingInput(), null));
	assert.ok(await repository.putIfCurrent(bindingInput({
		projectId: 'project-linked-video-orphan',
		sourceId: 'source-linked-video-orphan',
		locatorId: 'locator_0000000000000002',
		locatorRevision: 'snapshot_0000000000000002',
	}), null));
	const failure = new Error('planned unreachable binding delete failure');
	indexedDB.failNextDeleteForStore(LINKED_VIDEO_ORIGINAL_STORE_NAME, failure);

	await assert.rejects(
		repository.reconcileDurableLocatorReferences(['project-linked-video']),
		(error) => error === failure,
	);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME), 2);
	assert.deepEqual(
		await repository.reconcileDurableLocatorReferences(['project-linked-video']),
		[{
			locatorId: 'locator_0000000000000001',
			locatorRevision: 'snapshot_0000000000000001',
		}],
	);
	assert.equal(indexedDB.recordCount(databaseName, LINKED_VIDEO_ORIGINAL_STORE_NAME), 1);
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

function memoryRepository(label: string, limits: Readonly<{
	maximumInventoryRecords?: number;
	maximumInventoryReferences?: number;
}> = {}) {
	const memory = getMemoryDatabase(`linked-video-${label}-${Date.now()}-${Math.random()}`);
	return {
		memory,
		repository: new LinkedVideoOriginalRepository({
			memory,
			database: async () => null,
		}, { ...deterministicOptions(), ...limits }),
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
