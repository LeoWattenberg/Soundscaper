/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createProjectStore } from '../src/common/editor/storage.js';
import {
	DERIVATIVE_CACHE_ENTRY_STORE_NAME,
	projectDerivativeCacheInventoryRecord,
	VIDEO_DERIVATIVE_STORE_NAME,
} from '../src/common/editor/storage/derivative-cache-entry.ts';
import { videoDerivativeIdentity } from '../src/common/editor/storage/video-derivative-relationship.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

interface ReadStats {
	readonly store: string;
	readonly index?: string | null;
}

interface InstrumentedIndexedDB {
	readonly stats: {
		readonly cursorRequests: ReadStats[];
		readonly keyCursorRequests: ReadStats[];
		readonly getAllRequests: ReadStats[];
	};
	open(name: string, version?: number): IDBOpenDBRequest;
	failNextPutForStore(storeName: string, error?: Error): void;
	recordCount(databaseName: string, storeName: string): number;
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
	trimVideoDerivativeCache(limits: Readonly<{
		maximumBytes: number;
		maximumEntries: number;
	}>): Promise<Readonly<{
		removedEntries: number;
		skippedEntries: number;
		satisfied: boolean;
	}>>;
	deleteVideoDerivative(
		sourceId: string,
		selector?: Readonly<{ timestamp?: number; type?: string }>,
	): Promise<void>;
	writeMediaAsset(sourceId: string, input: unknown): Promise<Record<string, unknown>>;
	deleteMediaAsset(sourceId: string): Promise<void>;
	listVideoDerivatives(
		sourceId: string,
		selector?: Readonly<{ type?: string }>,
	): Promise<Record<string, unknown>[]>;
}

test('IndexedDB derivative replacement publishes matching payload and scalar records atomically', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-pair-replacement');
	const files = new Map<string, Blob>();
	const store = asDerivativeProjectStore(createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: true,
		opfsRoot: createOpfsDirectory(files),
		databaseName,
	}));
	await store.ready();
	const original = await persistOriginal(store, 'source');
	const originalPath = String(original.path);
	await store.saveVideoDerivative('source', {
		timestamp: 3,
		type: 'thumbnail',
		blob: new Blob(['old']),
		metadata: { width: 160 },
	});
	const oldPayload = onlyRecord(indexedDB, databaseName, VIDEO_DERIVATIVE_STORE_NAME);
	const oldPath = String(oldPayload.path);
	assert.deepEqual(
		onlyRecord(indexedDB, databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME),
		projectDerivativeCacheInventoryRecord(oldPayload, String(oldPayload.key)),
	);

	await store.saveVideoDerivative('source', {
		timestamp: 3,
		type: 'thumbnail',
		blob: new Blob(['replacement']),
		metadata: { width: 320 },
	});
	const replacement = onlyRecord(indexedDB, databaseName, VIDEO_DERIVATIVE_STORE_NAME);
	assert.notEqual(replacement.path, oldPath);
	assert.equal(files.has(oldPath), false, 'the superseded path is removed only after replacement commits');
	assert.equal(files.has(originalPath), true, 'the trusted original remains retained');
	assert.equal(files.size, 2);
	assert.deepEqual(
		onlyRecord(indexedDB, databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME),
		projectDerivativeCacheInventoryRecord(replacement, String(replacement.key)),
	);
	const loadedReplacement = await store.loadVideoDerivative('source', { timestamp: 3, type: 'thumbnail' });
	assert.ok(loadedReplacement);
	assert.equal(await loadedReplacement.text(), 'replacement');

	indexedDB.failNextPutForStore(DERIVATIVE_CACHE_ENTRY_STORE_NAME, new Error('planned companion failure'));
	await assert.rejects(
		store.saveVideoDerivative('source', {
			timestamp: 3,
			type: 'thumbnail',
			blob: new Blob(['unpublished']),
		}),
		/planned companion failure|IndexedDB transaction failed/u,
	);
	assert.equal(files.size, 2, 'the staged replacement file is removed when publication rolls back');
	assert.equal(files.has(originalPath), true, 'rollback cannot remove the trusted original');
	assert.deepEqual(onlyRecord(indexedDB, databaseName, VIDEO_DERIVATIVE_STORE_NAME), replacement);
	assert.deepEqual(
		onlyRecord(indexedDB, databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME),
		projectDerivativeCacheInventoryRecord(replacement, String(replacement.key)),
	);
	const loadedAfterFailure = await store.loadVideoDerivative('source', { timestamp: 3, type: 'thumbnail' });
	assert.ok(loadedAfterFailure);
	assert.equal(await loadedAfterFailure.text(), 'replacement');
});

test('stale derivative trim plans cannot delete an atomically installed replacement pair', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-stale-trim');
	const store = asDerivativeProjectStore(createProjectStore({
		indexedDB, memoryFallback: false, preferOpfs: false, databaseName,
	}));
	await store.ready();
	await persistOriginal(store, 'source');
	await store.saveVideoDerivative('source', {
		timestamp: 0,
		type: 'poster',
		blob: new Blob(['old']),
	});
	const oldPayload = onlyRecord(indexedDB, databaseName, VIDEO_DERIVATIVE_STORE_NAME);
	const replacement: Record<string, unknown> = {
		...oldPayload,
		blob: new Blob(['replacement']),
		size: 11,
		cacheToken: 'concurrent-replacement-token',
		committedAt: '2026-07-28T12:00:00.000Z',
	};
	const originalPush = indexedDB.stats.cursorRequests.push.bind(indexedDB.stats.cursorRequests);
	let replaced = false;
	indexedDB.stats.cursorRequests.push = (...requests: ReadStats[]) => {
		const length = originalPush(...requests);
		if (!replaced && requests.some(({ store: storeName }) => storeName === DERIVATIVE_CACHE_ENTRY_STORE_NAME)) {
			replaced = true;
			indexedDB.seedRecord(databaseName, VIDEO_DERIVATIVE_STORE_NAME, replacement);
			indexedDB.seedRecord(
				databaseName,
				DERIVATIVE_CACHE_ENTRY_STORE_NAME,
				projectDerivativeCacheInventoryRecord(replacement, String(replacement.key)),
			);
		}
		return length;
	};

	const report = await store.trimVideoDerivativeCache({ maximumBytes: 0, maximumEntries: 0 });

	assert.equal(replaced, true);
	assert.equal(report.removedEntries, 0);
	assert.equal(report.skippedEntries, 1);
	assert.equal(report.satisfied, false);
	assert.equal(onlyRecord(indexedDB, databaseName, VIDEO_DERIVATIVE_STORE_NAME).cacheToken, replacement.cacheToken);
	assert.equal(onlyRecord(indexedDB, databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME).cacheToken, replacement.cacheToken);
});

test('exact and partial derivative deletes remove payload and companion pairs together', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-paired-delete');
	const store = asDerivativeProjectStore(createProjectStore({
		indexedDB, memoryFallback: false, preferOpfs: false, databaseName,
	}));
	await store.ready();
	await Promise.all([
		persistOriginal(store, 'source'),
		persistOriginal(store, 'other'),
	]);
	for (const [sourceId, timestamp, type] of [
		['source', 0, 'poster'],
		['source', 0, 'thumbnail'],
		['source', 5, 'thumbnail'],
		['other', 0, 'poster'],
	] as const) {
		await store.saveVideoDerivative(sourceId, { timestamp, type, blob: new Blob([`${sourceId}-${timestamp}-${type}`]) });
	}

	await store.deleteVideoDerivative('source', { timestamp: 0, type: 'poster' });
	assertPairedKeys(indexedDB, databaseName, [
		derivativeKey('source', 'thumbnail', 0),
		derivativeKey('source', 'thumbnail', 5),
		derivativeKey('other', 'poster', 0),
	]);
	await store.deleteVideoDerivative('source', { type: 'thumbnail' });
	assertPairedKeys(indexedDB, databaseName, [derivativeKey('other', 'poster', 0)]);
	assert.equal(
		indexedDB.stats.getAllRequests.some(({ store: storeName }) => storeName === VIDEO_DERIVATIVE_STORE_NAME),
		false,
	);
});

for (const operation of ['exact derivative deletion', 'media asset cascade'] as const) {
	test(`${operation} rejects a companion path that could delete an unrelated OPFS original`, async () => {
		const indexedDB = instrumentedIndexedDB();
		const databaseName = uniqueDatabaseName(`derivative-delete-path-spoof-${operation}`);
		const files = new Map<string, Blob>();
		const store = asDerivativeProjectStore(createProjectStore({
			indexedDB,
			memoryFallback: false,
			preferOpfs: true,
			opfsRoot: createOpfsDirectory(files),
			databaseName,
		}));
		await store.ready();
		const sourceOriginal = await persistOriginal(store, 'source');
		const unrelatedOriginal = await persistOriginal(store, 'unrelated');
		await store.saveVideoDerivative('source', {
			type: 'poster', blob: new Blob(['poster']),
		});
		const payload = onlyRecord(indexedDB, databaseName, VIDEO_DERIVATIVE_STORE_NAME);
		const companion = onlyRecord(indexedDB, databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME);
		indexedDB.seedRecord(databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME, {
			...companion,
			path: unrelatedOriginal.path,
		});

		await assert.rejects(
			operation === 'exact derivative deletion'
				? store.deleteVideoDerivative('source', { type: 'poster' })
				: store.deleteMediaAsset('source'),
			/derivative cache payload.*does not match.*deletion metadata/iu,
		);

		assert.equal(files.has(String(unrelatedOriginal.path)), true);
		assert.equal(files.has(String(sourceOriginal.path)), true);
		assert.equal(files.has(String(payload.path)), true);
		assert.equal(indexedDB.recordCount(databaseName, VIDEO_DERIVATIVE_STORE_NAME), 1);
		assert.equal(indexedDB.recordCount(databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME), 1);
		assert.equal(indexedDB.recordCount(databaseName, 'mediaAssets'), 2);
	});
}

test('media asset cascade inventories scalar entries and never bulk-loads derivative payloads', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-paired-cascade');
	const store = asDerivativeProjectStore(createProjectStore({
		indexedDB, memoryFallback: false, preferOpfs: false, databaseName,
	}));
	await store.ready();
	await Promise.all([
		persistOriginal(store, 'source'),
		persistOriginal(store, 'other'),
	]);
	await store.saveVideoDerivative('source', { timestamp: 0, type: 'poster', blob: new Blob(['poster']) });
	await store.saveVideoDerivative('source', { timestamp: 1, type: 'thumbnail', blob: new Blob(['thumb']) });
	await store.saveVideoDerivative('other', { timestamp: 0, type: 'poster', blob: new Blob(['other']) });
	const readsBefore = indexedDB.stats.getAllRequests.length;
	const cursorsBefore = indexedDB.stats.cursorRequests.length;
	const keyCursorsBefore = indexedDB.stats.keyCursorRequests.length;

	await store.deleteMediaAsset('source');

	assert.deepEqual(
		indexedDB.records(databaseName, 'mediaAssets').map(({ sourceId }) => sourceId),
		['other'],
		'the cascade removes only the selected original and its derivatives',
	);
	assertPairedKeys(indexedDB, databaseName, [derivativeKey('other', 'poster', 0)]);
	const cascadeReads = indexedDB.stats.getAllRequests.slice(readsBefore);
	const cascadeValueCursors = indexedDB.stats.cursorRequests.slice(cursorsBefore);
	const cascadeKeyCursors = indexedDB.stats.keyCursorRequests.slice(keyCursorsBefore);
	assert.equal(cascadeReads.some(({ store: storeName }) => storeName === VIDEO_DERIVATIVE_STORE_NAME), false);
	assert.equal(cascadeReads.some(({ store: storeName }) => storeName === DERIVATIVE_CACHE_ENTRY_STORE_NAME), true);
	assert.equal(cascadeValueCursors.some(({ store: storeName }) => storeName === VIDEO_DERIVATIVE_STORE_NAME), false);
	assert.equal(cascadeKeyCursors.some(({ store: storeName }) => storeName === VIDEO_DERIVATIVE_STORE_NAME), false);
});

test('public derivative listings retain metadata omitted from the disposal companion', async () => {
	const indexedDB = instrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('derivative-list-metadata');
	const store = asDerivativeProjectStore(createProjectStore({
		indexedDB, memoryFallback: false, preferOpfs: false, databaseName,
	}));
	await store.ready();
	await persistOriginal(store, 'source');
	await store.saveVideoDerivative('source', {
		timestamp: 2,
		type: 'thumbnail',
		blob: new Blob(['thumbnail'], { type: 'image/webp' }),
		metadata: { width: 320, height: 180 },
	});

	const [listed] = await store.listVideoDerivatives('source', { type: 'thumbnail' });
	assert.equal(listed.width, 320);
	assert.equal(listed.height, 180);
	assert.equal(listed.mimeType, 'image/webp');
	assert.equal('blob' in listed, false);
	const companion = onlyRecord(indexedDB, databaseName, DERIVATIVE_CACHE_ENTRY_STORE_NAME);
	assert.equal('width' in companion, false);
	assert.equal('mimeType' in companion, false);
});

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
	return videoDerivativeIdentity(sourceId, originalSha256(sourceId), timestamp, type).key;
}

function persistOriginal(
	store: DerivativeProjectStore,
	sourceId: string,
): Promise<Record<string, unknown>> {
	return store.writeMediaAsset(sourceId, new Blob([originalBody(sourceId)]));
}

function originalSha256(sourceId: string): string {
	return createHash('sha256').update(originalBody(sourceId)).digest('hex');
}

function originalBody(sourceId: string): string {
	return `retained-original:${sourceId}`;
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
