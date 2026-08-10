import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createProjectStore } from '../src/common/editor/storage.js';
import {
	PCM_ENCODING_RAW_F32LE,
	PCM_ENCODING_WAVPACK_F32_V1,
	decodePcmWithWavPack,
	encodePcmAdaptively,
	loadWavPackWasm,
	parsePcmContainerIndex,
} from '../src/common/editor/wavpack/index.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

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
		{ name: 'original.webm', sha256: 'caller-spoof' },
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
	assert.equal(metadata.sha256, '0682c5f2076f099c34cfdd15a9e063849ed437a49677e6fcc5b4198c76575be5');
	assert.deepEqual(indexedDB.records(databaseName, 'mediaAssets').map(({ sha256 }) => sha256), [metadata.sha256]);
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

test('IndexedDB derivative cache trimming deletes only reproducible derivative records', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = 'indexeddb-derivative-cache-trim';
	const store = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName,
	});
	await store.writeMediaAsset('video-source', new Blob(['original']));
	await store.saveProject({
		id: 'video-project', revision: 1, updatedAt: '2026-07-28T00:00:00.000Z',
		sources: [{ id: 'video-source' }], clips: [],
	});
	await store.saveVideoDerivative('video-source', {
		timestamp: 0, type: 'poster', blob: new Blob(['poster']),
	});
	await store.saveVideoDerivative('video-source', {
		timestamp: 1, type: 'thumbnail', blob: new Blob(['thumbnail']),
	});

	const report = await store.trimVideoDerivativeCache({ maximumBytes: 9, maximumEntries: 1 });

	assert.equal(report.removedEntries, 1);
	assert.equal(report.after.entries, 1);
	assert.equal(report.after.bytes <= 9, true);
	assert.equal(report.satisfied, true);
	assert.equal(indexedDB.recordCount(databaseName, 'videoDerivatives'), 1);
	assert.equal(indexedDB.recordCount(databaseName, 'mediaAssets'), 1);
	assert.equal(indexedDB.recordCount(databaseName, 'projects'), 1);
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

let directRuntimePromise;

async function createDirectCodec() {
	directRuntimePromise ||= readFile(
		new URL('../src/common/editor/wavpack/wavpack.wasm', import.meta.url),
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

