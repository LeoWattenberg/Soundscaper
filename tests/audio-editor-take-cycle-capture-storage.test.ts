/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { RawPcmSpoolRepository } from '../src/common/editor/storage/raw-pcm-spool-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const CHUNK_A = Float32Array.of(0, 0.25, 0.5, 0.75);
const CHUNK_B = Float32Array.of(1, 0.75, 0.5, 0.25);

test('concurrent generation allocations have one gap-free per-project order', async () => {
	const storage = storageFixture('memory');
	const generations = await Promise.all(Array.from(
		{ length: 16 },
		() => storage.rawPcmSpools.allocateGeneration('project-cycle'),
	));
	assert.deepEqual([...generations].sort((left, right) => left - right),
		Array.from({ length: 16 }, (_, index) => index + 1));
});

test('publication generations increase atomically and persist across IndexedDB reopen', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = uniqueName('cycle-capture-generation');
	const first = storageFixture('indexeddb', indexedDB, databaseName);
	assert.equal(await first.rawPcmSpools.allocateGeneration('project-cycle'), 1);
	assert.equal(await first.rawPcmSpools.allocateGeneration('project-cycle'), 2);
	assert.equal(await first.rawPcmSpools.allocateGeneration('other-project'), 1);
	await first.close();
	const reopened = storageFixture('indexeddb', indexedDB, databaseName);
	assert.equal(await reopened.rawPcmSpools.allocateGeneration('project-cycle'), 3);
	await reopened.close();
});

test('retention keeps old capturing and sealed spool roots but reclaims an unregistered orphan', async () => {
	const storage = storageFixture('memory');
	let capturing = await storage.rawPcmSpools.create(rawSpoolRequest('capturing-spool'));
	capturing = await storage.rawPcmSpools.append(capturing, [CHUNK_A], { phase: 'capturing' });
	let sealed = await storage.rawPcmSpools.create(rawSpoolRequest('sealed-spool'));
	sealed = await storage.rawPcmSpools.append(sealed, [CHUNK_B], { phase: 'capturing' });
	sealed = await storage.rawPcmSpools.seal(sealed, { phase: 'sealed' });
	for (const [key, value] of storage.memory.sourceChunks) {
		storage.memory.sourceChunks.set(key, { ...value as Record<string, unknown>, createdAt: 0 });
	}
	storage.memory.sourceChunks.set('unregistered-orphan:0000000000', {
		key: 'unregistered-orphan:0000000000', sourceToken: 'unregistered-orphan', index: 0,
		frames: 4, channels: [CHUNK_A.buffer.slice(0)], createdAt: 0,
	});

	await storage.cleanupTemporaryAssets({ maximumAgeMs: 0 });

	const retainedTokens = new Set([...storage.memory.sourceChunks.values()]
		.map((value) => (value as { readonly sourceToken?: string }).sourceToken));
	assert.deepEqual(retainedTokens, new Set([capturing.spoolToken, sealed.spoolToken]));
	assert.equal(storage.memory.sourceChunks.has('unregistered-orphan:0000000000'), false);
});

test('IndexedDB retention pages a complete spool inventory before deleting stale chunks', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = uniqueName('cycle-capture-retention');
	const storage = storageFixture('indexeddb', indexedDB, databaseName);
	for (let index = 0; index < 70; index += 1) {
		await storage.analysis.put(`inventory-padding-${String(index).padStart(3, '0')}`, index);
	}
	let registered = await storage.rawPcmSpools.create(rawSpoolRequest('registered-spool'));
	registered = await storage.rawPcmSpools.append(registered, [CHUNK_A], { phase: 'capturing' });
	const database = await openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	const records = new SourceRecordRepository({
		memory: getMemoryDatabase(databaseName), database: async () => database,
	});
	await records.writeChunk({
		key: 'unregistered-orphan:0000000000', sourceToken: 'unregistered-orphan', index: 0,
		frames: 4, channels: [CHUNK_A.buffer.slice(0)], createdAt: 0,
	});

	await storage.cleanupTemporaryAssets({ maximumAgeMs: -1 });

	assert.deepEqual([...await storage.rawPcmSpools.chunk(registered, 0).then(({ channels }) => channels[0]!)], [...CHUNK_A]);
	assert.equal(await records.chunk('unregistered-orphan', 0), null);
	database.close();
	await storage.close();
});

test('a chunk written before a failed registry CAS is outside the prefix and removable by exact ownership', async () => {
	const memory = getMemoryDatabase(uniqueName('cycle-capture-tail'));
	const port = { memory, database: async () => null };
	const values = new KeyValueRepository(port, 'analysis');
	const sourceRecords = new SourceRecordRepository(port);
	let rejectReplacement = false;
	const repository = new RawPcmSpoolRepository({
		get: values.get.bind(values),
		putIfAbsent: values.putIfAbsent.bind(values),
		deleteIfCurrent: values.deleteIfCurrent.bind(values),
		listByPrefix: values.listByPrefix.bind(values),
		async replaceIfCurrent(key, expected, replacement) {
			return rejectReplacement ? false : values.replaceIfCurrent(key, expected, replacement);
		},
	}, sourceRecords);
	const created = await repository.create(rawSpoolRequest('cas-tail'));
	rejectReplacement = true;
	await assert.rejects(repository.append(created, [CHUNK_A], { phase: 'appended' }), /bounded CAS retry/u);
	const current = await repository.load('project-cycle', 'cas-tail');
	assert.ok(current);
	assert.equal(current.chunkCount, 0);
	const visibleChunks = [];
	for await (const chunk of repository.chunks(current)) visibleChunks.push(chunk);
	assert.deepEqual(visibleChunks, [], 'unfenced tail is never interpreted as a durable capture span');
	assert.equal(memory.sourceChunks.size, 1);
	rejectReplacement = false;
	assert.equal(await repository.remove(current), true);
	assert.equal(memory.sourceChunks.size, 0, 'discard removes the same-token tail with the owned prefix');
});

function storageFixture(
	backend: 'memory' | 'indexeddb',
	indexedDB = createInstrumentedIndexedDB(),
	databaseName = uniqueName(`cycle-capture-${backend}`),
) {
	const store = createProjectStore({
		indexedDB: backend === 'indexeddb' ? indexedDB : null,
		preferOpfs: false,
		databaseName,
	});
	return {
		analysis: store.analysisRepository as KeyValueRepository,
		rawPcmSpools: store.rawPcmSpoolRepository as RawPcmSpoolRepository,
		memory: store.memory,
		cleanupTemporaryAssets: (options: { readonly maximumAgeMs?: number }) => store.cleanupTemporaryAssets(options),
		close: () => store.close(),
	};
}

function rawSpoolRequest(spoolId: string) {
	return {
		projectId: 'project-cycle', spoolId, sampleRate: 48_000, channelCount: 1, chunkFrames: 4,
		data: { phase: 'registered' },
	};
}

function uniqueName(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
