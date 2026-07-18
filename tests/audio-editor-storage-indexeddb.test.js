import test from 'node:test';
import assert from 'node:assert/strict';

import { createProjectStore } from '../src/lib/tools/audio-editor/storage.js';

test('IndexedDB source iteration is ordered, bounded, and closes each page transaction before yielding', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName: 'bounded-source-read',
	});
	const writer = await store.beginSourceWrite('many-chunks', { sampleRate: 48_000, channelCount: 1 });
	for (let index = 0; index < 21; index += 1) await writer.write([Float32Array.of(index + 0.25)]);
	await writer.commit({ chunkFrames: 1 });

	const chunks = [];
	for await (const chunk of store.readSourceChunks('many-chunks')) {
		assert.equal(indexedDB.stats.activeTransactions, 0, 'consumer yields must not pin an IndexedDB transaction');
		chunks.push({ index: chunk.index, sample: chunk.channels[0][0] });
		await new Promise((resolve) => setImmediate(resolve));
	}

	assert.deepEqual(chunks.map(({ index }) => index), Array.from({ length: 21 }, (_, index) => index));
	assert.deepEqual(chunks.map(({ sample }) => sample), Array.from({ length: 21 }, (_, index) => index + 0.25));
	assert.equal(indexedDB.stats.sourceChunkGetAllCalls, 0);
	const cursors = indexedDB.stats.cursorRequests.filter(({ store, index }) => store === 'sourceChunks' && index === 'sourceToken');
	assert.ok(cursors.length >= 3, 'a multi-page source should use multiple short transactions');
	assert.ok(cursors.every(({ delivered }) => delivered <= 10), 'cursor pages should retain only a small bounded record window');
});

test('IndexedDB copy-on-write iteration performs an ordered streaming merge across cursor pages', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName: 'bounded-copy-on-write-read',
	});
	const writer = await store.beginSourceWrite('base', { sampleRate: 48_000, channelCount: 1 });
	for (let index = 0; index < 19; index += 1) await writer.write([Float32Array.of(index)]);
	await writer.commit({ chunkFrames: 1 });
	const replacementIndices = Array.from({ length: 10 }, (_, index) => index * 2);
	await store.writeDerivedSource(
		'derived',
		'base',
		replacementIndices.map((index) => ({ index, channels: [Float32Array.of(100 + index)] })),
		{ sampleRate: 48_000, channelCount: 1, chunkFrames: 1 },
	);

	const samples = [];
	for await (const chunk of store.readSourceChunks('derived')) {
		assert.equal(indexedDB.stats.activeTransactions, 0);
		samples.push(chunk.channels[0][0]);
	}
	assert.deepEqual(samples, Array.from({ length: 19 }, (_, index) => (
		replacementIndices.includes(index) ? 100 + index : index
	)));
	assert.equal(indexedDB.stats.sourceChunkGetAllCalls, 0);
	const replacementCursors = indexedDB.stats.cursorRequests.filter(({ query }) => String(query || '').includes(':cow:'));
	assert.ok(replacementCursors.length >= 2, 'replacement chunks should page independently of their base');
});

test('IndexedDB chunk paging remains correct when continuePrimaryKey is unavailable', async () => {
	const indexedDB = createInstrumentedIndexedDB({ supportsContinuePrimaryKey: false });
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName: 'source-read-cursor-fallback',
	});
	const writer = await store.beginSourceWrite('fallback-source', { sampleRate: 48_000, channelCount: 1 });
	for (let index = 0; index < 11; index += 1) await writer.write([Float32Array.of(index)]);
	await writer.commit({ chunkFrames: 1 });

	const samples = [];
	for await (const chunk of store.readSourceChunks('fallback-source')) samples.push(chunk.channels[0][0]);

	assert.deepEqual(samples, Array.from({ length: 11 }, (_, index) => index));
	assert.equal(indexedDB.stats.sourceChunkGetAllCalls, 0);
	assert.ok(indexedDB.stats.cursorRequests.filter(({ index }) => index === 'sourceToken').length >= 2);
});

test('temporary IndexedDB chunk cleanup enumerates and deletes orphaned records in bounded pages', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = 'bounded-temporary-cleanup';
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName,
	});
	const interruptedWriter = await store.beginSourceWrite('interrupted', { sampleRate: 48_000, channelCount: 1 });
	for (let index = 0; index < 19; index += 1) await interruptedWriter.write([Float32Array.of(index)]);
	assert.equal(indexedDB.recordCount(databaseName, 'sourceChunks'), 19);

	await store.cleanupTemporaryAssets({ maximumAgeMs: -1 });

	assert.equal(indexedDB.recordCount(databaseName, 'sourceChunks'), 0);
	assert.equal(indexedDB.stats.sourceChunkGetAllCalls, 0);
	const cleanupCursors = indexedDB.stats.cursorRequests.filter(({ store, index }) => store === 'sourceChunks' && index === null);
	assert.ok(cleanupCursors.length >= 3);
	assert.ok(cleanupCursors.every(({ delivered }) => delivered <= 8));
	await interruptedWriter.abort();
});

test('IndexedDB Blob fallback persists media assets and cascades indexed video derivatives', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = 'indexeddb-video-assets';
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName,
	});

	const metadata = await store.writeMediaAsset(
		'video-source',
		new Blob(['original'], { type: 'video/webm' }),
		{ name: 'original.webm' },
	);
	await store.saveVideoDerivative('video-source', {
		timestamp: 0,
		type: 'poster',
		blob: new Blob(['poster'], { type: 'image/webp' }),
	});
	await store.saveVideoDerivative('video-source', {
		timestamp: 5,
		type: 'thumbnail',
		blob: new Blob(['thumbnail'], { type: 'image/webp' }),
	});

	assert.equal(metadata.storage, 'indexeddb-blob');
	assert.equal(indexedDB.recordCount(databaseName, 'mediaAssets'), 1);
	assert.equal(indexedDB.recordCount(databaseName, 'videoDerivatives'), 2);
	assert.equal(await (await store.loadMediaAsset('video-source')).text(), 'original');
	assert.equal(
		await (await store.loadVideoDerivative('video-source', { timestamp: 5, type: 'thumbnail' })).text(),
		'thumbnail',
	);
	assert.deepEqual(
		(await store.listVideoDerivatives('video-source')).map(({ type }) => type),
		['poster', 'thumbnail'],
	);

	await store.deleteSource('video-source');
	assert.equal(indexedDB.recordCount(databaseName, 'mediaAssets'), 0);
	assert.equal(indexedDB.recordCount(databaseName, 'videoDerivatives'), 0);
});

function createInstrumentedIndexedDB({ supportsContinuePrimaryKey = true } = {}) {
	const databases = new Map();
	const stats = {
		activeTransactions: 0,
		cursorRequests: [],
		sourceChunkGetAllCalls: 0,
		supportsContinuePrimaryKey,
	};
	return {
		stats,
		open(name) {
			const request = { result: null, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
			queueMicrotask(() => {
				let database = databases.get(name);
				const needsUpgrade = !database;
				if (!database) {
					database = new FakeDatabase(stats);
					databases.set(name, database);
				}
				request.result = database;
				if (needsUpgrade) request.onupgradeneeded?.();
				queueMicrotask(() => request.onsuccess?.());
			});
			return request;
		},
		recordCount(databaseName, storeName) {
			return databases.get(databaseName)?.stores.get(storeName)?.records.size || 0;
		},
	};
}

class FakeDatabase {
	constructor(stats) {
		this.stats = stats;
		this.stores = new Map();
		this.objectStoreNames = { contains: (name) => this.stores.has(name) };
	}

	createObjectStore(name, { keyPath }) {
		const data = { name, keyPath, records: new Map(), indexes: new Map() };
		this.stores.set(name, data);
		return {
			createIndex: (indexName, indexKeyPath) => data.indexes.set(indexName, indexKeyPath),
		};
	}

	transaction(storeNames, mode) {
		return new FakeTransaction(this, Array.isArray(storeNames) ? storeNames : [storeNames], mode);
	}

	close() {}
}

class FakeTransaction {
	constructor(database, storeNames, mode) {
		this.database = database;
		this.storeNames = new Set(storeNames);
		this.mode = mode;
		this.pending = 0;
		this.finished = false;
		this.completionScheduled = false;
		this.error = null;
		this.oncomplete = null;
		this.onabort = null;
		this.onerror = null;
		database.stats.activeTransactions += 1;
		this.scheduleCompletion();
	}

	objectStore(name) {
		if (!this.storeNames.has(name)) throw new Error(`Store ${name} is outside this transaction.`);
		return new FakeObjectStore(this, this.database.stores.get(name));
	}

	beginRequest() {
		if (this.finished) throw new Error('The transaction is inactive.');
		this.pending += 1;
	}

	endRequest() {
		this.pending -= 1;
		this.scheduleCompletion();
	}

	scheduleCompletion() {
		if (this.completionScheduled || this.finished) return;
		this.completionScheduled = true;
		setImmediate(() => {
			this.completionScheduled = false;
			if (this.finished || this.pending) return;
			this.finished = true;
			this.database.stats.activeTransactions -= 1;
			this.oncomplete?.();
		});
	}

	abort() {
		if (this.finished) return;
		this.finished = true;
		this.database.stats.activeTransactions -= 1;
		queueMicrotask(() => this.onabort?.());
	}
}

class FakeObjectStore {
	constructor(transaction, data) {
		this.transaction = transaction;
		this.data = data;
	}

	put(value) {
		return fakeRequest(this.transaction, () => {
			const stored = clone(value);
			this.data.records.set(stored[this.data.keyPath], stored);
			return stored[this.data.keyPath];
		});
	}

	get(key) {
		return fakeRequest(this.transaction, () => clone(this.data.records.get(key)));
	}

	getAll(query, count) {
		if (this.data.name === 'sourceChunks') this.transaction.database.stats.sourceChunkGetAllCalls += 1;
		return fakeRequest(this.transaction, () => valuesForStore(this.data, query).slice(0, count).map(clone));
	}

	delete(key) {
		return fakeRequest(this.transaction, () => this.data.records.delete(key));
	}

	clear() {
		return fakeRequest(this.transaction, () => this.data.records.clear());
	}

	index(name) {
		return new FakeIndex(this.transaction, this.data, name);
	}

	openCursor(query) {
		const entries = valuesForStore(this.data, query).map((value) => ({
			key: value[this.data.keyPath],
			primaryKey: value[this.data.keyPath],
			value,
		}));
		return fakeCursorRequest(this.transaction, this.data, entries, { index: null, query });
	}
}

class FakeIndex {
	constructor(transaction, data, name) {
		this.transaction = transaction;
		this.data = data;
		this.name = name;
		this.keyPath = data.indexes.get(name);
	}

	getAll(query, count) {
		if (this.data.name === 'sourceChunks') this.transaction.database.stats.sourceChunkGetAllCalls += 1;
		return fakeRequest(this.transaction, () => this.values(query).slice(0, count).map(clone));
	}

	openCursor(query) {
		const entries = this.values(query).map((value) => ({
			key: value[this.keyPath],
			primaryKey: value[this.data.keyPath],
			value,
		}));
		return fakeCursorRequest(this.transaction, this.data, entries, { index: this.name, query });
	}

	values(query) {
		return [...this.data.records.values()]
			.filter((value) => query === undefined || value[this.keyPath] === query)
			.sort((left, right) => compareKeys(left[this.keyPath], right[this.keyPath])
				|| compareKeys(left[this.data.keyPath], right[this.data.keyPath]));
	}
}

function fakeRequest(transaction, operation) {
	const request = { result: undefined, error: null, onsuccess: null, onerror: null };
	transaction.beginRequest();
	queueMicrotask(() => {
		try {
			request.result = operation();
			request.onsuccess?.();
		} catch (error) {
			request.error = error;
			request.onerror?.();
		} finally {
			transaction.endRequest();
		}
	});
	return request;
}

function fakeCursorRequest(transaction, data, entries, { index, query }) {
	const request = { result: undefined, error: null, onsuccess: null, onerror: null };
	const requestStats = { store: data.name, index, query, delivered: 0 };
	transaction.database.stats.cursorRequests.push(requestStats);
	transaction.beginRequest();
	let position = 0;
	const deliver = () => queueMicrotask(() => {
		if (position >= entries.length) {
			request.result = null;
			request.onsuccess?.();
			transaction.endRequest();
			return;
		}
		const entry = entries[position];
		let continued = false;
		requestStats.delivered += 1;
		const cursor = {
			key: entry.key,
			primaryKey: entry.primaryKey,
			value: clone(entry.value),
			continue(targetKey) {
				if (continued) throw new Error('The cursor has already advanced.');
				continued = true;
				position += 1;
				if (targetKey !== undefined) {
					while (position < entries.length && compareKeys(entries[position].key, targetKey) < 0) position += 1;
				}
				deliver();
			},
			continuePrimaryKey(targetKey, targetPrimaryKey) {
				if (continued) throw new Error('The cursor has already advanced.');
				continued = true;
				position += 1;
				while (position < entries.length && (
					compareKeys(entries[position].key, targetKey) < 0
					|| (compareKeys(entries[position].key, targetKey) === 0
						&& compareKeys(entries[position].primaryKey, targetPrimaryKey) < 0)
				)) position += 1;
				deliver();
			},
			delete() {
				data.records.delete(entry.primaryKey);
			},
		};
		if (!transaction.database.stats.supportsContinuePrimaryKey) delete cursor.continuePrimaryKey;
		request.result = cursor;
		request.onsuccess?.();
		if (!continued) transaction.endRequest();
	});
	deliver();
	return request;
}

function valuesForStore(data, query) {
	return [...data.records.values()]
		.filter((value) => query === undefined || value[data.keyPath] === query)
		.sort((left, right) => compareKeys(left[data.keyPath], right[data.keyPath]));
}

function compareKeys(left, right) {
	if (left === right) return 0;
	return String(left) < String(right) ? -1 : 1;
}

function clone(value) {
	return value === undefined ? undefined : structuredClone(value);
}
