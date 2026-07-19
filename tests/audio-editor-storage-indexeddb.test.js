import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createProjectStore } from '../src/lib/tools/audio-editor/storage.js';
import {
	PCM_ENCODING_RAW_F32LE,
	PCM_ENCODING_WAVPACK_F32_V1,
	decodePcmWithWavPack,
	encodePcmAdaptively,
	loadWavPackWasm,
	packPlanarFloat32,
	parsePcmContainerIndex,
} from '../src/lib/tools/audio-editor/wavpack/index.js';

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

test('IndexedDB sources and copy-on-write overlays use adaptive persistent PCM records', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = 'adaptive-indexeddb-pcm';
	const codec = await createDirectCodec();
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName,
		pcmCodec: codec,
	});
	const writer = await store.beginSourceWrite('adaptive-base', {
		sampleRate: 48_000,
		channelCount: 1,
		chunkFrames: 65_536,
	});
	await writer.write([new Float32Array(65_536)]);
	await writer.write([Float32Array.of(0.25, -0.25)]);
	const metadata = await writer.commit();

	assert.equal(metadata.pcmEncodingVersion, 1);
	assert.equal(metadata.wavpackChunkCount, 1);
	assert.equal(metadata.rawChunkCount, 1);
	assert.ok(metadata.storedBytes < metadata.uncompressedBytes);
	assert.equal(metadata.compressionRatio, metadata.storedBytes / metadata.uncompressedBytes);
	const records = indexedDB.records(databaseName, 'sourceChunks');
	assert.equal(records[0].encoding, PCM_ENCODING_WAVPACK_F32_V1);
	assert.equal(records[1].encoding, PCM_ENCODING_RAW_F32LE);
	assert.ok(records.every((record) => !Object.hasOwn(record, 'channels')));
	assert.deepEqual(
		[...(await store.readSourceChunk('adaptive-base', 1)).channels[0]],
		[0.25, -0.25],
	);

	const derived = await store.writeDerivedSource('adaptive-derived', 'adaptive-base', [{
		index: 0,
		channels: [new Float32Array(65_536).fill(0.5)],
	}], {
		sampleRate: 48_000,
		channelCount: 1,
		chunkFrames: 65_536,
	});
	assert.equal(derived.pcmEncodingVersion, 1);
	assert.equal(derived.wavpackChunkCount, 1);
	const overlay = indexedDB.records(databaseName, 'sourceChunks')
		.find((record) => record.sourceToken === derived.sourceToken);
	assert.equal(overlay.encoding, PCM_ENCODING_WAVPACK_F32_V1);
	assert.equal((await store.readSourceChunk('adaptive-derived', 0)).channels[0][100], 0.5);
	assert.deepEqual(
		[...(await store.readSourceChunk('adaptive-derived', 1)).channels[0]],
		[0.25, -0.25],
	);
});

test('an encoder failure trips a store-session circuit breaker and persists current and later chunks raw', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = 'failed-wavpack-runtime';
	let encodeCalls = 0;
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName,
		pcmCodec: {
			async encode() {
				encodeCalls += 1;
				throw new Error('runtime unavailable');
			},
			async decode() {
				throw new Error('decode should not run');
			},
		},
	});
	const writer = await store.beginSourceWrite('raw-after-failure', {
		sampleRate: 48_000,
		channelCount: 1,
	});
	await writer.write([Float32Array.of(0.5)]);
	assert.equal(encodeCalls, 0, 'tiny uneconomical PCM should not initialize the codec');
	await writer.write([new Float32Array(65_536).fill(0.25)]);
	await writer.write([new Float32Array(65_536).fill(-0.25)]);
	const metadata = await writer.commit();

	assert.equal(encodeCalls, 1);
	assert.equal(metadata.wavpackChunkCount, 0);
	assert.equal(metadata.rawChunkCount, 3);
	assert.ok(indexedDB.records(databaseName, 'sourceChunks')
		.every((record) => record.encoding === PCM_ENCODING_RAW_F32LE));
	assert.equal((await store.readSourceChunk('raw-after-failure', 2)).channels[0][0], -0.25);
});

test('legacy IndexedDB PCM migrates once in the background after its first successful access', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = 'legacy-indexeddb-first-access';
	const codec = await createDirectCodec();
	let encodeCalls = 0;
	const observedCodec = {
		...codec,
		async encode(...args) {
			encodeCalls += 1;
			return codec.encode(...args);
		},
	};
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName,
		pcmCodec: observedCodec,
	});
	await store.ready();
	const token = 'legacy-idb-token';
	const existingChannel = new Float32Array(65_536).fill(-0.25);
	const existing = await codec.encode(packPlanarFloat32([existingChannel]), {
		frames: existingChannel.length,
		channelCount: 1,
		sampleRate: 48_000,
	});
	assert.equal(existing.encoding, PCM_ENCODING_WAVPACK_F32_V1);
	indexedDB.seedRecord(databaseName, 'sources', {
		id: 'legacy-idb',
		storage: 'indexeddb-chunks',
		sourceToken: token,
		sampleRate: 48_000,
		channelCount: 1,
		frameLength: 131_072,
		frameCount: 131_072,
		chunkFrames: 65_536,
		chunkCount: 2,
		committedAt: '2026-01-01T00:00:00.000Z',
	});
	indexedDB.seedRecord(databaseName, 'sourceChunks', {
		key: `${token}:0000000000`,
		sourceToken: token,
		index: 0,
		frames: 65_536,
		encoding: existing.encoding,
		payload: existing.payload,
		pcmCrc32: existing.pcmCrc32,
		createdAt: Date.now(),
	});
	indexedDB.seedRecord(databaseName, 'sourceChunks', {
		key: `${token}:0000000001`,
		sourceToken: token,
		index: 1,
		frames: 65_536,
		channels: [new Float32Array(65_536).fill(0.125).buffer],
		createdAt: Date.now(),
	});

	const [first, duplicateAccess] = await Promise.all([
		store.readSourceChunk('legacy-idb', 1),
		store.readSourceChunk('legacy-idb', 1),
	]);
	assert.equal(first.channels[0][0], 0.125);
	assert.equal(duplicateAccess.channels[0][0], 0.125);
	assert.equal((await store.getSourceMetadata('legacy-idb')).pcmEncodingVersion, undefined);
	await store.pruneUnreferencedSources({ protectedSourceIds: ['legacy-idb'] });
	await waitFor(async () => (await store.getSourceMetadata('legacy-idb')).pcmEncodingVersion === 1);

	const migrated = await store.getSourceMetadata('legacy-idb');
	assert.equal(migrated.wavpackChunkCount, 2);
	assert.ok(encodeCalls >= 1 && encodeCalls <= 2);
	const records = indexedDB.records(databaseName, 'sourceChunks');
	assert.equal(records.length, 2);
	assert.ok(records.every((record) => record.encoding === PCM_ENCODING_WAVPACK_F32_V1));
	assert.ok(records.every((record) => !Object.hasOwn(record, 'channels')));
	assert.ok(records.every((record) => record.payload.byteLength > 0));
	assert.equal((await store.readSourceChunk('legacy-idb', 0)).channels[0][1], -0.25);
	assert.equal((await store.readSourceChunk('legacy-idb', 1)).channels[0][1], 0.125);
});

test('legacy OPFS PCM migrates to a verified adaptive container after first access', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = 'legacy-opfs-first-access';
	const codec = await createDirectCodec();
	const opfs = createFakeOpfs();
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		databaseName,
		opfsRoot: opfs.root,
		storageManager: {
			async estimate() {
				return { usage: 0, quota: 64 * 1024 * 1024 };
			},
		},
		pcmCodec: codec,
	});
	await store.ready();
	const channel = new Float32Array(65_536).fill(0.375);
	opfs.files.set('legacy.pcm', { blob: legacyPcmBlob([channel]) });
	indexedDB.seedRecord(databaseName, 'sources', {
		id: 'legacy-opfs',
		storage: 'opfs',
		sourceToken: 'legacy-opfs-token',
		path: 'legacy.pcm',
		sampleRate: 48_000,
		channelCount: 1,
		frameLength: channel.length,
		frameCount: channel.length,
		chunkFrames: channel.length,
		chunkCount: 1,
		committedAt: '2026-01-01T00:00:00.000Z',
	});

	const first = await store.readSourceChunk('legacy-opfs', 0);
	assert.equal(first.channels[0][42], 0.375);
	assert.equal((await store.getSourceMetadata('legacy-opfs')).storage, 'opfs');
	await waitFor(async () => (await store.getSourceMetadata('legacy-opfs')).storage === 'opfs-pcm-v1');

	const migrated = await store.getSourceMetadata('legacy-opfs');
	assert.match(migrated.path, /\.scpcm$/);
	assert.equal(migrated.pcmEncodingVersion, 1);
	assert.equal(migrated.wavpackChunkCount, 1);
	assert.equal(opfs.files.has('legacy.pcm'), false);
	assert.equal(opfs.files.has(migrated.path), true);
	assert.equal((await store.readSourceChunk('legacy-opfs', 0)).channels[0][42], 0.375);
});

test('OPFS PCM reads fresh file snapshots and fails closed on raw or WavPack payload corruption', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = 'opfs-pcm-payload-corruption';
	const opfs = createFakeOpfs();
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		databaseName,
		opfsRoot: opfs.root,
		pcmCodec: await createDirectCodec(),
	});
	const writer = await store.beginSourceWrite('corrupt-opfs', {
		sampleRate: 48_000,
		channelCount: 1,
		chunkFrames: 65_536,
	});
	await writer.write([new Float32Array(65_536)]);
	await writer.write([Float32Array.of(0.25, -0.25)]);
	const metadata = await writer.commit();
	const entry = opfs.files.get(metadata.path);
	const original = new Uint8Array(await entry.blob.arrayBuffer());
	const index = await parsePcmContainerIndex(new Blob([original]), {
		expectedChannelCount: 1,
		expectedSampleRate: 48_000,
		expectedChunkFrames: 65_536,
		expectedChunkCount: 2,
		expectedFrameCount: 65_538,
	});
	assert.equal(index.entries[0].codec, 1);
	assert.equal(index.entries[1].codec, 0);

	const corruptedRaw = original.slice();
	corruptedRaw[index.entries[1].offset] ^= 1;
	entry.blob = new Blob([corruptedRaw]);
	await assert.rejects(
		store.readSourceChunk('corrupt-opfs', 1),
		(error) => error?.name === 'PcmStorageCorruptionError'
			&& error?.code === 'PCM_CRC_MISMATCH',
	);

	const corruptedWavPack = original.slice();
	corruptedWavPack[
		index.entries[0].offset + Math.floor(index.entries[0].length / 2)
	] ^= 0x40;
	entry.blob = new Blob([corruptedWavPack]);
	await assert.rejects(
		store.readSourceChunk('corrupt-opfs', 0),
		(error) => error?.name === 'PcmStorageCorruptionError',
	);
});

test('legacy OPFS migration defers once per session when temporary quota headroom is insufficient', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = 'legacy-opfs-quota-deferral';
	const directCodec = await createDirectCodec();
	let encodeCalls = 0;
	const codec = {
		...directCodec,
		async encode(...args) {
			encodeCalls += 1;
			return directCodec.encode(...args);
		},
	};
	const opfs = createFakeOpfs();
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		databaseName,
		opfsRoot: opfs.root,
		storageManager: {
			async estimate() {
				return { usage: 1024, quota: 1024 };
			},
		},
		pcmCodec: codec,
	});
	await store.ready();
	const channel = new Float32Array(65_536).fill(0.25);
	opfs.files.set('quota-legacy.pcm', { blob: legacyPcmBlob([channel]) });
	indexedDB.seedRecord(databaseName, 'sources', legacyOpfsMetadata({
		id: 'quota-legacy',
		path: 'quota-legacy.pcm',
		frames: channel.length,
	}));

	assert.equal((await store.readSourceChunk('quota-legacy', 0)).channels[0][0], 0.25);
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal((await store.getSourceMetadata('quota-legacy')).storage, 'opfs');
	assert.deepEqual([...opfs.files.keys()], ['quota-legacy.pcm']);
	assert.equal(encodeCalls, 0);

	await store.readSourceChunk('quota-legacy', 0);
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(encodeCalls, 0, 'a quota failure suppresses repeat attempts for this store session');
});

test('an OPFS migration compare-and-swap loss removes its temporary container and preserves the legacy file', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = 'legacy-opfs-cas-race';
	const directCodec = await createDirectCodec();
	let releaseEncoding;
	let encodingStarted;
	const started = new Promise((resolve) => { encodingStarted = resolve; });
	const codec = {
		...directCodec,
		async encode(...args) {
			encodingStarted();
			await new Promise((resolve) => { releaseEncoding = resolve; });
			return directCodec.encode(...args);
		},
	};
	const opfs = createFakeOpfs();
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		databaseName,
		opfsRoot: opfs.root,
		storageManager: {
			async estimate() {
				return { usage: 0, quota: 64 * 1024 * 1024 };
			},
		},
		pcmCodec: codec,
	});
	await store.ready();
	const channel = new Float32Array(65_536).fill(-0.125);
	opfs.files.set('race-legacy.pcm', { blob: legacyPcmBlob([channel]) });
	const source = legacyOpfsMetadata({
		id: 'race-legacy',
		path: 'race-legacy.pcm',
		frames: channel.length,
	});
	indexedDB.seedRecord(databaseName, 'sources', source);

	await store.readSourceChunk('race-legacy', 0);
	await started;
	indexedDB.seedRecord(databaseName, 'sources', {
		...source,
		sourceToken: 'another-tab-won',
	});
	releaseEncoding();
	await new Promise((resolve) => setTimeout(resolve, 50));

	assert.equal((await store.getSourceMetadata('race-legacy')).sourceToken, 'another-tab-won');
	assert.deepEqual([...opfs.files.keys()], ['race-legacy.pcm']);
	assert.equal(opfs.files.has('race-legacy.pcm'), true);
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
		records(databaseName, storeName) {
			return [...(databases.get(databaseName)?.stores.get(storeName)?.records.values() || [])]
				.map(clone)
				.sort((left, right) => compareKeys(
					left[databases.get(databaseName).stores.get(storeName).keyPath],
					right[databases.get(databaseName).stores.get(storeName).keyPath],
				));
		},
		seedRecord(databaseName, storeName, value) {
			const store = databases.get(databaseName)?.stores.get(storeName);
			if (!store) throw new Error(`Store ${storeName} has not been created.`);
			const stored = clone(value);
			store.records.set(stored[store.keyPath], stored);
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

let directRuntimePromise;

async function createDirectCodec() {
	directRuntimePromise ||= readFile(
		new URL('../src/lib/tools/audio-editor/wavpack/wavpack.wasm', import.meta.url),
	).then((bytes) => loadWavPackWasm(bytes));
	const runtime = await directRuntimePromise;
	return {
		async encode(payload, options) {
			const result = encodePcmAdaptively(payload, { ...options, runtime });
			if (options.transferInput) {
				const transferredPayload = result.payload.slice(0);
				structuredClone(payload, { transfer: [payload] });
				return { ...result, payload: transferredPayload };
			}
			return result;
		},
		async decode(payload, options) {
			const result = {
				payload: decodePcmWithWavPack(payload, { ...options, runtime }),
			};
			if (options.transferInput) structuredClone(payload, { transfer: [payload] });
			return result;
		},
	};
}

function createFakeOpfs() {
	const files = new Map();
	const directory = {
		async getFileHandle(path, options = {}) {
			if (!files.has(path) && !options.create) throw new Error('missing');
			if (!files.has(path)) files.set(path, { blob: new Blob() });
			const entry = files.get(path);
			return {
				async createWritable() {
					const parts = [];
					let aborted = false;
					return {
						async write(part) {
							if (aborted) throw new Error('aborted');
							parts.push(part);
						},
						async close() {
							if (aborted) throw new Error('aborted');
							entry.blob = new Blob(parts);
						},
						async abort() {
							aborted = true;
							parts.length = 0;
						},
					};
				},
				async getFile() {
					return entry.blob;
				},
			};
		},
		async removeEntry(path) {
			if (!files.delete(path)) throw new Error('missing');
		},
	};
	return {
		files,
		root: {
			async getDirectoryHandle() {
				return directory;
			},
		},
	};
}

function legacyPcmBlob(channels) {
	const frames = channels[0].length;
	const header = new Uint8Array(8);
	const view = new DataView(header.buffer);
	view.setUint32(0, frames, true);
	view.setUint16(4, channels.length, true);
	return new Blob([header, ...channels]);
}

function legacyOpfsMetadata({ id, path, frames }) {
	return {
		id,
		storage: 'opfs',
		sourceToken: `${id}-token`,
		path,
		sampleRate: 48_000,
		channelCount: 1,
		frameLength: frames,
		frameCount: frames,
		chunkFrames: frames,
		chunkCount: 1,
		committedAt: '2026-01-01T00:00:00.000Z',
	};
}

async function waitFor(predicate, { timeoutMs = 2_000 } = {}) {
	const deadline = Date.now() + timeoutMs;
	while (!await predicate()) {
		if (Date.now() >= deadline) throw new Error('Timed out waiting for background PCM migration.');
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}
