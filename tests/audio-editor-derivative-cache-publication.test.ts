/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	projectDerivativeCacheInventoryRecord,
	VIDEO_DERIVATIVE_STORE_NAME,
} from '../src/common/editor/storage/derivative-cache-entry.ts';
import { DEFAULT_DERIVATIVE_CACHE_LIMITS } from '../src/common/editor/storage/derivative-cache-policy.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

interface ReadStats {
	readonly store: string;
	readonly index?: string | null;
}

interface InstrumentedIndexedDB {
	readonly stats: {
		readonly getAllRequests: ReadStats[];
	};
	open(name: string, version?: number): IDBOpenDBRequest;
	failNextPutForStore(storeName: string, error?: Error): void;
	records(databaseName: string, storeName: string): Record<string, unknown>[];
	seedRecord(databaseName: string, storeName: string, value: unknown, primaryKey?: IDBValidKey): void;
}

interface DerivativeProjectStore {
	ready(): Promise<unknown>;
	saveVideoDerivative(sourceId: string, input: Readonly<{
		timestamp?: number;
		type?: string;
		blob?: unknown;
		metadata?: Record<string, unknown>;
	}>): Promise<Record<string, unknown>>;
	loadVideoDerivative(
		sourceId: string,
		selector?: Readonly<{ timestamp?: number; type?: string }>,
	): Promise<Blob | null>;
}

for (const backend of ['memory', 'indexeddb', 'opfs'] as const) {
	test(`${backend} publication independently enforces count, byte, and age limits`, async () => {
		const indexedDB = backend === 'memory' ? null : instrumentedIndexedDB();
		const files = new Map<string, Blob>();
		const databaseName = uniqueDatabaseName(`derivative-publication-${backend}`);
		const store = asDerivativeProjectStore(createProjectStore({
			indexedDB,
			memoryFallback: backend === 'memory',
			preferOpfs: backend === 'opfs',
			opfsRoot: backend === 'opfs' ? createOpfsDirectory(files) : null,
			databaseName,
			derivativeCacheLimits: {
				maximumBytes: 10,
				maximumEntries: 2,
				maximumAgeMs: 1_000,
			},
			derivativeCacheNow: sequenceClock([0, 100, 200, 300, 1_500]),
		}));
		await store.ready();
		await store.saveVideoDerivative('a', { type: 'poster', blob: new Blob(['aa']) });
		await store.saveVideoDerivative('b', { type: 'poster', blob: new Blob(['bb']) });
		await store.saveVideoDerivative('c', { type: 'poster', blob: new Blob(['cc']) });

		assert.equal(await store.loadVideoDerivative('a', { type: 'poster' }), null, 'count-only pressure evicts');
		assert.equal(await derivativeText(store, 'b'), 'bb');
		assert.equal(await derivativeText(store, 'c'), 'cc');

		await store.saveVideoDerivative('b', { type: 'poster', blob: new Blob(['bbbbbbbbb']) });
		assert.equal(await derivativeText(store, 'b'), 'bbbbbbbbb', 'replacement accounting subtracts the prior size');
		assert.equal(
			await store.loadVideoDerivative('c', { type: 'poster' }),
			null,
			'byte-only pressure evicts while the entry count is within its limit',
		);
		await store.saveVideoDerivative('d', { type: 'poster', blob: new Blob(['dd']) });

		assert.equal(await store.loadVideoDerivative('b', { type: 'poster' }), null, 'age-only pressure evicts');
		assert.equal(await derivativeText(store, 'd'), 'dd');
		if (indexedDB) {
			assertPairedKeys(indexedDB, databaseName, [derivativeKey('d', 'poster', 0)]);
			assert.equal(
				indexedDB.stats.getAllRequests.some(({ store: storeName }) => storeName === VIDEO_DERIVATIVE_STORE_NAME),
				false,
				'automatic enforcement must not inventory payload Blobs',
			);
			assert.equal(
				indexedDB.stats.getAllRequests.some(({ store: storeName }) => storeName === DERIVATIVE_CACHE_ENTRY_STORE_NAME),
				true,
			);
		}
		if (backend === 'opfs') assert.equal(files.size, 1, 'evicted and replaced OPFS files are disposed');
	});
}

test('the default 30-day age limit is active at its exact boundary', async () => {
	const maximumAgeMs = DEFAULT_DERIVATIVE_CACHE_LIMITS.maximumAgeMs;
	if (maximumAgeMs === undefined) throw new Error('The default derivative cache age limit is unavailable.');
	const files = new Map<string, Blob>();
	const store = asDerivativeProjectStore(createProjectStore({
		indexedDB: null,
		preferOpfs: true,
		opfsRoot: createOpfsDirectory(files),
		databaseName: uniqueDatabaseName('derivative-publication-default-age'),
		derivativeCacheNow: sequenceClock([0, maximumAgeMs]),
	}));
	await store.saveVideoDerivative('old', { type: 'poster', blob: new Blob(['old']) });
	await store.saveVideoDerivative('fresh', { type: 'poster', blob: new Blob(['fresh']) });

	assert.equal(await store.loadVideoDerivative('old', { type: 'poster' }), null);
	assert.equal(await derivativeText(store, 'fresh'), 'fresh');
	assert.equal(files.size, 1);
});

test('an oversized derivative replacement preserves the committed IndexedDB and OPFS pair', async () => {
	const indexedDB = instrumentedIndexedDB();
	const files = new Map<string, Blob>();
	const databaseName = uniqueDatabaseName('derivative-publication-oversized');
	const store = createStore(indexedDB, files, databaseName, {
		maximumBytes: 5,
		maximumEntries: 2,
	}, [0]);
	await store.ready();
	await store.saveVideoDerivative('source', { type: 'poster', blob: new Blob(['old']) });
	const priorPayload = onlyRecord(indexedDB, databaseName, VIDEO_DERIVATIVE_STORE_NAME);
	const priorEntry = onlyRecord(indexedDB, databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME);

	await assert.rejects(
		store.saveVideoDerivative('source', { type: 'poster', blob: new Blob(['larger']) }),
		/cannot fit within the configured derivative cache limits/u,
	);

	assert.equal(await derivativeText(store, 'source'), 'old');
	assert.deepEqual(onlyRecord(indexedDB, databaseName, VIDEO_DERIVATIVE_STORE_NAME), priorPayload);
	assert.deepEqual(onlyRecord(indexedDB, databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME), priorEntry);
	assert.equal(files.size, 1);
});

test('a failed paired put rolls back its planned eviction and staged OPFS file', async () => {
	const indexedDB = instrumentedIndexedDB();
	const files = new Map<string, Blob>();
	const databaseName = uniqueDatabaseName('derivative-publication-rollback');
	const store = createStore(indexedDB, files, databaseName, {
		maximumBytes: 10,
		maximumEntries: 1,
	}, [0, 1]);
	await store.ready();
	await store.saveVideoDerivative('a', { type: 'poster', blob: new Blob(['old']) });
	const priorPayload = onlyRecord(indexedDB, databaseName, VIDEO_DERIVATIVE_STORE_NAME);
	const priorEntry = onlyRecord(indexedDB, databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME);
	indexedDB.failNextPutForStore(DERIVATIVE_CACHE_ENTRY_STORE_NAME, new Error('planned publication failure'));

	await assert.rejects(
		store.saveVideoDerivative('b', { type: 'poster', blob: new Blob(['new']) }),
		/planned publication failure|IndexedDB transaction failed/u,
	);

	assert.deepEqual(onlyRecord(indexedDB, databaseName, VIDEO_DERIVATIVE_STORE_NAME), priorPayload);
	assert.deepEqual(onlyRecord(indexedDB, databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME), priorEntry);
	assert.equal(await derivativeText(store, 'a'), 'old');
	assert.equal(files.size, 1);
});

test('unsafe aggregate byte accounting aborts before publication or eviction', async () => {
	const indexedDB = instrumentedIndexedDB();
	const files = new Map<string, Blob>();
	const databaseName = uniqueDatabaseName('derivative-publication-overflow');
	const store = createStore(indexedDB, files, databaseName, {
		maximumBytes: Number.MAX_SAFE_INTEGER,
		maximumEntries: 2,
	}, [1]);
	await store.ready();
	const record = {
		key: derivativeKey('huge', 'poster', 0),
		sourceId: 'huge',
		timestamp: 0,
		type: 'poster',
		storage: 'opfs',
		path: 'video-huge.blob',
		size: Number.MAX_SAFE_INTEGER,
		committedAt: new Date(0).toISOString(),
		cacheToken: 'huge-token',
	};
	files.set(record.path, new Blob(['placeholder']));
	indexedDB.seedRecord(databaseName, VIDEO_DERIVATIVE_STORE_NAME, record);
	indexedDB.seedRecord(
		databaseName,
		DERIVATIVE_CACHE_ENTRY_STORE_NAME,
		projectDerivativeCacheInventoryRecord(record, record.key),
	);

	await assert.rejects(
		store.saveVideoDerivative('new', { type: 'poster', blob: new Blob(['x']) }),
		/total exceeds the supported safe integer range/u,
	);

	assertPairedKeys(indexedDB, databaseName, [record.key]);
	assert.equal(files.has(record.path), true);
	assert.equal(files.size, 1);
});

test('automatic eviction and replacement fail closed when payload and companion tokens drift', async () => {
	const indexedDB = instrumentedIndexedDB();
	const files = new Map<string, Blob>();
	const databaseName = uniqueDatabaseName('derivative-publication-drift');
	const store = createStore(indexedDB, files, databaseName, {
		maximumBytes: 10,
		maximumEntries: 1,
	}, [0, 1, 2]);
	await store.ready();
	await store.saveVideoDerivative('a', { type: 'poster', blob: new Blob(['old']) });
	const payload = onlyRecord(indexedDB, databaseName, VIDEO_DERIVATIVE_STORE_NAME);
	indexedDB.seedRecord(databaseName, VIDEO_DERIVATIVE_STORE_NAME, {
		...payload,
		cacheToken: 'drifted-payload-token',
	});

	await assert.rejects(
		store.saveVideoDerivative('b', { type: 'poster', blob: new Blob(['new']) }),
		/does not match its eviction metadata/u,
	);
	await assert.rejects(
		store.saveVideoDerivative('a', { type: 'poster', blob: new Blob(['new']) }),
		/does not match its replacement metadata/u,
	);

	assertPairedKeys(indexedDB, databaseName, [derivativeKey('a', 'poster', 0)]);
	assert.equal(onlyRecord(indexedDB, databaseName, VIDEO_DERIVATIVE_STORE_NAME).cacheToken, 'drifted-payload-token');
	assert.equal(files.size, 1, 'only staged unpublished files are removed');
});

test('same-token companion path spoofing cannot delete an unrelated OPFS file', async () => {
	const indexedDB = instrumentedIndexedDB();
	const files = new Map<string, Blob>();
	const databaseName = uniqueDatabaseName('derivative-publication-path-spoof');
	const store = createStore(indexedDB, files, databaseName, {
		maximumBytes: 10,
		maximumEntries: 1,
	}, [0, 1]);
	await store.ready();
	await store.saveVideoDerivative('a', { type: 'poster', blob: new Blob(['old']) });
	const entry = onlyRecord(indexedDB, databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME);
	files.set('retained-original', new Blob(['original']));
	indexedDB.seedRecord(databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME, {
		...entry,
		path: 'retained-original',
	});

	await assert.rejects(
		store.saveVideoDerivative('b', { type: 'poster', blob: new Blob(['new']) }),
		/does not match its eviction metadata/u,
	);

	assert.equal(files.has('retained-original'), true);
	assert.equal(files.has(String(onlyRecord(indexedDB, databaseName, VIDEO_DERIVATIVE_STORE_NAME).path)), true);
	assert.equal(files.size, 2, 'the staged unpublished file alone is removed');
});

test('concurrent memory OPFS replacements dispose every superseded staged path', async () => {
	const files = new Map<string, Blob>();
	const store = asDerivativeProjectStore(createProjectStore({
		indexedDB: null,
		preferOpfs: true,
		opfsRoot: createOpfsDirectory(files),
		databaseName: uniqueDatabaseName('derivative-publication-memory-concurrency'),
		derivativeCacheLimits: { maximumBytes: 10, maximumEntries: 1 },
		derivativeCacheNow: sequenceClock([0, 1, 2]),
	}));
	await store.saveVideoDerivative('source', { type: 'poster', blob: new Blob(['old']) });

	await Promise.all([
		store.saveVideoDerivative('source', { type: 'poster', blob: new Blob(['one']) }),
		store.saveVideoDerivative('source', { type: 'poster', blob: new Blob(['two']) }),
	]);

	assert.equal(files.size, 1);
	assert.equal(await derivativeText(store, 'source'), 'two');
});

function createStore(
	indexedDB: InstrumentedIndexedDB,
	files: Map<string, Blob>,
	databaseName: string,
	derivativeCacheLimits: Readonly<{
		maximumBytes: number;
		maximumEntries: number;
		maximumAgeMs?: number;
	}>,
	clock: readonly number[],
): DerivativeProjectStore {
	return asDerivativeProjectStore(createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: true,
		opfsRoot: createOpfsDirectory(files),
		databaseName,
		derivativeCacheLimits,
		derivativeCacheNow: sequenceClock(clock),
	}));
}

function instrumentedIndexedDB(): InstrumentedIndexedDB {
	return createInstrumentedIndexedDB() as unknown as InstrumentedIndexedDB;
}

function asDerivativeProjectStore(value: unknown): DerivativeProjectStore {
	return value as DerivativeProjectStore;
}

function onlyRecord(
	indexedDB: InstrumentedIndexedDB,
	databaseName: string,
	storeName: string,
): Record<string, unknown> {
	const records = indexedDB.records(databaseName, storeName);
	assert.equal(records.length, 1);
	return records[0];
}

function assertPairedKeys(
	indexedDB: InstrumentedIndexedDB,
	databaseName: string,
	expected: readonly string[],
): void {
	const keys = (storeName: string): string[] => indexedDB.records(databaseName, storeName)
		.map(({ key }) => String(key))
		.sort();
	assert.deepEqual(keys(VIDEO_DERIVATIVE_STORE_NAME), [...expected].sort());
	assert.deepEqual(keys(DERIVATIVE_CACHE_ENTRY_STORE_NAME), [...expected].sort());
}

function derivativeKey(sourceId: string, type: string, timestamp: number): string {
	return JSON.stringify([sourceId, type, timestamp]);
}

async function derivativeText(store: DerivativeProjectStore, sourceId: string): Promise<string> {
	const derivative = await store.loadVideoDerivative(sourceId, { type: 'poster' });
	assert.ok(derivative);
	return derivative.text();
}

function sequenceClock(values: readonly number[]): () => number {
	let index = 0;
	return () => {
		const value = values[index];
		index += 1;
		if (value === undefined) throw new Error('The derivative cache test clock was exhausted.');
		return value;
	};
}

function createOpfsDirectory(files: Map<string, Blob>): FileSystemDirectoryHandle {
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new Error('missing');
			if (!files.has(path)) files.set(path, new Blob());
			return {
				async createWritable() {
					const parts: BlobPart[] = [];
					return {
						async write(part: BlobPart) { parts.push(part); },
						async close() { files.set(path, new Blob(parts)); },
						async abort() { parts.length = 0; },
					};
				},
				async getFile() { return files.get(path) as Blob; },
			};
		},
		async removeEntry(path: string) {
			if (!files.delete(path)) throw new Error('missing');
		},
	};
	return directory as unknown as FileSystemDirectoryHandle;
}

function uniqueDatabaseName(prefix: string): string {
	return `${prefix}-${Date.now()}-${Math.random()}`;
}
