/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BlobReader,
	BlobWriter,
	Uint8ArrayReader,
	Uint8ArrayWriter,
	ZipReader,
	ZipWriter,
} from '@zip.js/zip.js';

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { ScapeAudioChunkBudget } from '../src/common/editor/scape-expanded-byte-budget.ts';
import type { ScapeArchiveEntry } from '../src/common/editor/scape-archive-envelope.ts';
import {
	digestScapeBytes,
	extractScapeAudio,
	SCAPE_MAXIMUM_AUDIO_CHUNKS,
	SCAPE_MAXIMUM_PENDING_AUDIO_BYTES,
} from '../src/common/editor/scape-archive-media.ts';
import {
	exportScapeProject,
	importScapeProject,
	inspectScapeProject,
} from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import {
	WAVPACK_PCM_MAXIMUM_CHANNELS,
	WAVPACK_PCM_MAXIMUM_FRAMES,
} from '../src/common/editor/wavpack/index.js';

const TEXT_ENCODER = new TextEncoder();

test('cumulative actual bytes stop a lying asset stream before media or project publication', async () => {
	const project = videoProject('actual-expanded-byte-limit');
	const fixture = syntheticArchive(project, {
		kind: 'video',
		entry: 'media/video-source/original',
		declaredBytes: Uint8Array.of(1),
		emittedBytes: Uint8Array.of(1, 2),
	});
	const backingStore = memoryStore('scape-actual-expanded-byte-limit');
	const before = await inventory(backingStore);
	let mediaWrites = 0;
	let projectWrites = 0;
	const store = new Proxy(backingStore, {
		get(target, property, receiver) {
			if (property === 'beginMediaAssetWrite') return async (
				...args: Parameters<typeof target.beginMediaAssetWrite>
			) => {
				const writer = await target.beginMediaAssetWrite(...args);
				return {
					maximumChunkBytes: writer.maximumChunkBytes,
					get bytesWritten() { return writer.bytesWritten; },
					write: writer.write.bind(writer),
					async commit(...commitArgs: Parameters<typeof writer.commit>) {
						mediaWrites += 1;
						return writer.commit(...commitArgs);
					},
					async commitOwned(...commitArgs: Parameters<NonNullable<typeof writer.commitOwned>>) {
						mediaWrites += 1;
						return writer.commitOwned!(...commitArgs);
					},
					abort: writer.abort.bind(writer),
				};
			};
			if (property === 'saveProject') return async (...args: Parameters<typeof target.saveProject>) => {
				projectWrites += 1;
				return target.saveProject(...args);
			};
			const value = Reflect.get(target, property, receiver) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	await assert.rejects(importScapeProject(new Blob(['synthetic']), store, {
		archiveLimits: { maximumExpandedBytes: fixture.declaredExpandedBytes },
		archiveReaderFactory: fixture.readerFactory,
	}), /actual expanded-byte limit/iu);
	assert.equal(mediaWrites, 0);
	assert.equal(projectWrites, 0);
	assert.deepEqual(await inventory(backingStore), before);
});

test('malicious PCM chunk geometry rejects on its four-byte header with bounded pending state', async () => {
	assert.equal(
		SCAPE_MAXIMUM_PENDING_AUDIO_BYTES,
		4 + WAVPACK_PCM_MAXIMUM_CHANNELS * WAVPACK_PCM_MAXIMUM_FRAMES * Float32Array.BYTES_PER_ELEMENT,
	);
	const header = new Uint8Array(4);
	new DataView(header.buffer).setUint32(0, 0xffffffff, true);
	const fixture = syntheticArchive(audioProject('unsafe-pcm-frame-count'), {
		kind: 'audio',
		entry: 'audio/audio-source.f32c',
		declaredBytes: header,
		emittedBytes: header,
	});
	const store = memoryStore('scape-unsafe-pcm-frame-count');
	const before = await inventory(store);

	await assert.rejects(importScapeProject(new Blob(['synthetic']), store, {
		archiveReaderFactory: fixture.readerFactory,
	}), /PCM chunks must contain 1.*65.?536 frames/iu);
	assert.deepEqual(await inventory(store), before);
});

test('audio extraction bounds semantic chunk work independently of expanded bytes', async () => {
	assert.equal(SCAPE_MAXIMUM_AUDIO_CHUNKS, 65_536);
	const firstChunkCount = 2;
	const secondChunkCount = 3;
	const chunkBudget = new ScapeAudioChunkBudget(4);
	let writes = 0;

	await extractScapeAudio(
		syntheticEntry('audio/first-bounded-chunks.f32c', oneFramePcmChunks(firstChunkCount)),
		{ write: async () => { writes += 1; } },
		{ id: 'first-bounded-chunks', channelCount: 1, frameCount: firstChunkCount, chunkFrames: 1 },
		undefined,
		undefined,
		chunkBudget,
	);
	await assert.rejects(extractScapeAudio(
		syntheticEntry('audio/second-bounded-chunks.f32c', oneFramePcmChunks(secondChunkCount)),
		{ write: async () => { writes += 1; } },
		{ id: 'second-bounded-chunks', channelCount: 1, frameCount: secondChunkCount, chunkFrames: 1 },
		undefined,
		undefined,
		chunkBudget,
	), /archive PCM chunk limit/iu);
	assert.equal(writes, 4);
});

test('audio import rejects noncanonical PCM chunk geometry without publishing inventory', async () => {
	const project = audioProject('noncanonical-pcm-chunks', { frameCount: 2, chunkFrames: 2 });
	const malformedBytes = oneFramePcmChunks(2);
	const fixture = syntheticArchive(project, {
		kind: 'audio',
		entry: 'audio/audio-source.f32c',
		declaredBytes: malformedBytes,
		emittedBytes: malformedBytes,
	});
	const store = memoryStore('scape-noncanonical-pcm-chunks');
	const before = await inventory(store);

	await assert.rejects(importScapeProject(new Blob(['synthetic']), store, {
		archiveReaderFactory: fixture.readerFactory,
	}), /noncanonical PCM chunk geometry/iu);
	assert.deepEqual(await inventory(store), before);
});

test('export rejects projects outside the importable entry envelope before asset work', async () => {
	let assetReads = 0;
	const project = {
		schemaVersion: 6,
		id: 'too-many-sources',
		sources: Array.from({ length: 4_095 }, (_, index) => ({
			kind: 'video', id: `video-${String(index)}`, storageKey: `video-${String(index)}`,
		})),
	};

	await assert.rejects(exportScapeProject(project, {
		readSourceChunks() { assetReads += 1; return []; },
		async loadMediaAsset() { assetReads += 1; return new Blob(); },
	}), /too many sources for the portable archive/iu);
	assert.equal(assetReads, 0);
});

test('export rejects aggregate PCM work outside the portable archive budget before asset reads', async () => {
	let assetReads = 0;
	const project = createCurrentAudioEditorProject({
		id: 'too-many-audio-chunks',
		title: 'Too many audio chunks',
		sources: [
			audioSource('audio-first', 32_768, 1),
			audioSource('audio-second', 32_769, 1),
		],
		clips: [],
		tracks: [],
	});

	await assert.rejects(exportScapeProject(project, {
		readSourceChunks() { assetReads += 1; return []; },
		async loadMediaAsset() { assetReads += 1; return new Blob(); },
	}), /archive PCM chunk limit/iu);
	assert.equal(assetReads, 0);
});

test('export rejects stored PCM that does not match canonical project chunk geometry', async (context) => {
	const project = audioProject('noncanonical-export-pcm', { frameCount: 2, chunkFrames: 2 });
	const mediaStore = {
		async loadMediaAsset() { return null; },
		readSourceChunks() {
			return (async function* () {
				yield [Float32Array.of(0)];
				yield [Float32Array.of(1)];
			})();
		},
	};

	await context.test('irregular chunks', async () => {
		await assert.rejects(
			exportScapeProject(project, mediaStore),
			/noncanonical PCM chunk geometry/iu,
		);
	});

	await context.test('truncated iterator', async () => {
		await assert.rejects(exportScapeProject(project, {
			...mediaStore,
			readSourceChunks() { return (async function* () {})(); },
		}), /ended before its declared frame count/iu);
	});
});

test('strict local-header validation rejects a central-directory disagreement before storage work', async () => {
	const sourceStore = memoryStore('scape-local-header-source');
	const archive = (await exportScapeProject(projectOnly('local-header-mismatch'), sourceStore)).blob as Blob;
	const bytes = new Uint8Array(await archive.arrayBuffer());
	const filenameOffset = indexOfBytes(bytes, TEXT_ENCODER.encode('manifest.json'));
	assert.ok(filenameOffset >= 30);
	const localHeaderOffset = filenameOffset - 30;
	assert.equal(new DataView(bytes.buffer).getUint32(localHeaderOffset, true), 0x04034b50);
	bytes[localHeaderOffset + 8] = bytes[localHeaderOffset + 8] === 0 ? 8 : 0;
	const targetStore = memoryStore('scape-local-header-target');
	const before = await inventory(targetStore);

	await assert.rejects(importScapeProject(new Blob([bytes]), targetStore), /ambiguous archive/iu);
	assert.deepEqual(await inventory(targetStore), before);
});

test('overlapping local entry ranges are rejected before manifest or storage publication', async () => {
	const archive = await overlappingArchive();
	const targetStore = memoryStore('scape-overlapping-entry-target');
	const before = await inventory(targetStore);

	await assert.rejects(inspectScapeProject(archive), /overlapping entry/iu);
	await assert.rejects(importScapeProject(archive, targetStore), /overlapping entry/iu);
	assert.deepEqual(await inventory(targetStore), before);
});

test('compressed Scape entries reject from metadata before decompression or storage work', async () => {
	const sourceStore = memoryStore('scape-compression-source');
	const project = createCurrentAudioEditorProject({
		id: 'compressed-scape',
		title: 'Compressed Scape',
		sources: [],
		clips: [],
		tracks: [],
		opaqueExtensions: { padding: 'repetitive-project-metadata-'.repeat(8_192) },
	});
	const canonical = (await exportScapeProject(project, sourceStore)).blob as Blob;
	const compressed = await rewriteArchive(canonical, 9);
	const reader = new ZipReader(new BlobReader(compressed), { useWebWorkers: false });
	const entries = await reader.getEntries();
	assert.ok(entries.some((entry) => (
		entry.compressionMethod === 8
		&& entry.compressedSize * 10 < entry.uncompressedSize
	)));
	await reader.close();
	const targetStore = memoryStore('scape-compression-target');
	const before = await inventory(targetStore);

	await assert.rejects(inspectScapeProject(compressed), /portable Scape entries must use STORE/iu);
	await assert.rejects(importScapeProject(compressed, targetStore), /portable Scape entries must use STORE/iu);
	assert.deepEqual(await inventory(targetStore), before);
});

function syntheticArchive(
	project: ReturnType<typeof audioProject> | ReturnType<typeof videoProject>,
	asset: Readonly<{
		kind: 'audio' | 'video';
		entry: string;
		declaredBytes: Uint8Array;
		emittedBytes: Uint8Array;
	}>,
) {
	const projectBytes = TEXT_ENCODER.encode(JSON.stringify(project));
	const source = project.sources[0];
	if (!source) throw new Error('Synthetic archive requires one source.');
	const manifest = {
		format: 'scape-project',
		formatVersion: 1,
		project: {
			entry: 'project.json',
			size: projectBytes.byteLength,
			sha256: digestScapeBytes(projectBytes),
		},
		assets: [{
			sourceId: source.id,
			kind: asset.kind,
			entry: asset.entry,
			encoding: asset.kind === 'audio' ? 'audio-f32le-chunks-v1' : 'original',
			mimeType: source.mimeType,
			size: asset.declaredBytes.byteLength,
			sha256: digestScapeBytes(asset.emittedBytes),
		}],
	};
	const manifestBytes = TEXT_ENCODER.encode(JSON.stringify(manifest));
	const entries = [
		syntheticEntry('manifest.json', manifestBytes),
		syntheticEntry('project.json', projectBytes),
		syntheticEntry(asset.entry, asset.emittedBytes, asset.declaredBytes.byteLength),
	];
	return {
		declaredExpandedBytes: manifestBytes.byteLength + projectBytes.byteLength + asset.declaredBytes.byteLength,
		readerFactory: () => ({
			async *getEntriesGenerator() {
				for (const entry of entries) yield entry;
				return false;
			},
			close: async () => undefined,
		}),
	};
}

function syntheticEntry(filename: string, bytes: Uint8Array, declaredSize = bytes.byteLength): ScapeArchiveEntry {
	return {
		filename,
		directory: false,
		encrypted: false,
		compressionMethod: 0,
		compressedSize: declaredSize,
		uncompressedSize: declaredSize,
		async getData(writable, options) {
			if (options?.checkOverlappingEntryOnly) return;
			const writer = writable.getWriter();
			await writer.write(bytes);
			await writer.close();
		},
	};
}

function oneFramePcmChunks(chunkCount: number): Uint8Array {
	const bytes = new Uint8Array(chunkCount * 8);
	const view = new DataView(bytes.buffer);
	for (let index = 0; index < chunkCount; index += 1) view.setUint32(index * 8, 1, true);
	return bytes;
}

async function overlappingArchive(): Promise<Blob> {
	const innerPayload = TEXT_ENCODER.encode('inner');
	const innerZip = await writeZip([['inner.bin', innerPayload]]);
	const innerBytes = new Uint8Array(await innerZip.arrayBuffer());
	const innerCentralOffset = findSignature(innerBytes, 0x02014b50);
	assert.ok(innerCentralOffset > 0);
	const embeddedLocalRecord = innerBytes.slice(0, innerCentralOffset);
	const outerZip = await writeZip([
		['outer.bin', embeddedLocalRecord],
		['inner.bin', innerPayload],
	]);
	const bytes = new Uint8Array(await outerZip.arrayBuffer());
	const view = new DataView(bytes.buffer);
	assert.equal(view.getUint32(0, true), 0x04034b50);
	const outerDataOffset = 30 + view.getUint16(26, true) + view.getUint16(28, true);
	const innerCentralRecord = findCentralRecord(bytes, 'inner.bin');
	view.setUint32(innerCentralRecord + 42, outerDataOffset, true);
	return new Blob([bytes], { type: 'application/zip' });
}

async function writeZip(entries: readonly (readonly [string, Uint8Array])[]): Promise<Blob> {
	const output = new BlobWriter('application/zip');
	const writer = new ZipWriter(output, { level: 0, useWebWorkers: false });
	for (const [filename, bytes] of entries) {
		await writer.add(filename, new Uint8ArrayReader(bytes), { level: 0 });
	}
	return await writer.close() as Blob;
}

async function rewriteArchive(input: Blob, level: number): Promise<Blob> {
	const reader = new ZipReader(new BlobReader(input), { useWebWorkers: false });
	const entries = await reader.getEntries();
	const writer = new ZipWriter(new BlobWriter('application/zip'), {
		level,
		useWebWorkers: false,
		zip64: true,
	});
	for (const entry of entries) {
		if (!('getData' in entry) || typeof entry.getData !== 'function') {
			throw new Error(`Missing ZIP reader for ${entry.filename}.`);
		}
		const bytes = await entry.getData(new Uint8ArrayWriter());
		await writer.add(entry.filename, new Uint8ArrayReader(bytes), { level, zip64: true });
	}
	await reader.close();
	return await writer.close(undefined, { zip64: true }) as Blob;
}

function findCentralRecord(bytes: Uint8Array, filename: string): number {
	const decoder = new TextDecoder();
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 0; offset <= bytes.byteLength - 46; offset += 1) {
		if (view.getUint32(offset, true) !== 0x02014b50) continue;
		const filenameLength = view.getUint16(offset + 28, true);
		const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + filenameLength));
		if (name === filename) return offset;
	}
	throw new Error(`ZIP central record ${filename} was not found.`);
}

function findSignature(bytes: Uint8Array, signature: number): number {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 0; offset <= bytes.byteLength - 4; offset += 1) {
		if (view.getUint32(offset, true) === signature) return offset;
	}
	return -1;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
	outer: for (let offset = 0; offset <= haystack.byteLength - needle.byteLength; offset += 1) {
		for (let index = 0; index < needle.byteLength; index += 1) {
			if (haystack[offset + index] !== needle[index]) continue outer;
		}
		return offset;
	}
	return -1;
}

function memoryStore(prefix: string) {
	return createProjectStore({ indexedDB: null, databaseName: `${prefix}-${String(Date.now())}-${String(Math.random())}` });
}

async function inventory(store: ReturnType<typeof memoryStore>) {
	const projects = await store.listProjects();
	const revisions = Object.fromEntries(await Promise.all(projects.map(async ({ id }) => [
		id,
		await store.listProjectRevisions(id),
	])));
	const sources = await store.listSources();
	const media = [...store.memory.mediaAssets.entries()].map(([id, value]) => ({ id, value }));
	return { projects, revisions, sources, media };
}

function projectOnly(id: string) {
	return createCurrentAudioEditorProject({ id, title: id, sources: [], clips: [], tracks: [] });
}

function videoProject(id: string) {
	return createCurrentAudioEditorProject({
		id,
		title: id,
		sources: [{
			kind: 'video', id: 'video-source', storageKey: 'video-source', name: 'video.mp4', mimeType: 'video/mp4',
			frameCount: 48_000, sampleRate: 48_000, width: 1, height: 1, frameRate: 30,
			videoCodec: 'h264', audioCodec: null, hasAudio: false,
		}],
		clips: [],
		tracks: [],
	});
}

function audioProject(id: string, overrides: Readonly<{ frameCount?: number; chunkFrames?: number }> = {}) {
	return createCurrentAudioEditorProject({
		id,
		title: id,
		sources: [{
			kind: 'audio', id: 'audio-source', storageKey: 'audio-source', name: 'audio.wav', mimeType: 'audio/wav',
			frameCount: overrides.frameCount ?? 1, channelCount: 1, sampleRate: 48_000,
			originalSampleRate: 48_000, chunkFrames: overrides.chunkFrames ?? 1,
		}],
		clips: [],
		tracks: [],
	});
}

function audioSource(id: string, frameCount: number, chunkFrames: number) {
	return {
		kind: 'audio' as const,
		id,
		storageKey: id,
		name: `${id}.wav`,
		mimeType: 'audio/wav',
		frameCount,
		channelCount: 1,
		sampleRate: 48_000,
		originalSampleRate: 48_000,
		chunkFrames,
	};
}
