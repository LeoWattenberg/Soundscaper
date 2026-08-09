/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import type { ScapeArchiveEntry } from '../src/common/editor/scape-archive-envelope.ts';
import { ScapeExpandedByteBudget } from '../src/common/editor/scape-expanded-byte-budget.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import {
	extractScapeVideo,
	SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
	type ScapeVideoWriter,
} from '../src/common/editor/scape-archive-video.ts';
import { exportScapeProject, importScapeProject } from '../src/common/editor/scape-project.js';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

const TEXT_ENCODER = new TextEncoder();

test('video extraction hashes before writer mutation and awaits each write for backpressure', async () => {
	const first = Uint8Array.of(1, 2);
	const second = Uint8Array.of(3, 4);
	const expected = Uint8Array.of(...first, ...second);
	let releaseFirstWrite: (() => void) | undefined;
	let markFirstWrite: (() => void) | undefined;
	const firstWriteStarted = new Promise<void>((resolve) => { markFirstWrite = resolve; });
	const firstWriteReleased = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
	let writes = 0;
	let secondEmissionStarted = false;
	const writer = videoWriter({
		async write(bytes) {
			writes += 1;
			bytes.fill(0xff);
			if (writes === 1) {
				markFirstWrite?.();
				await firstWriteReleased;
			}
		},
	});
	const entry = archiveEntry('media/video/original', first.byteLength + second.byteLength, async (writable) => {
		const output = writable.getWriter();
		await output.write(first);
		secondEmissionStarted = true;
		await output.write(second);
		await output.close();
	});

	const extraction = extractScapeVideo(entry, writer);
	await firstWriteStarted;
	assert.equal(secondEmissionStarted, false);
	releaseFirstWrite?.();
	const result = await extraction;

	assert.equal(writes, 2);
	assert.equal(result.size, expected.byteLength);
	assert.equal(result.digest, digestScapeBytes(expected));
});

test('video extraction accepts the exact hard chunk bound', async () => {
	const bytes = new Uint8Array(SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES).fill(0x5a);
	let writtenBytes = 0;
	const writer = videoWriter({
		async write(chunk) { writtenBytes += chunk.byteLength; },
	});
	const budget = new ScapeExpandedByteBudget(bytes.byteLength);
	const result = await extractScapeVideo(emittingEntry('media/exact-bound', bytes), writer, undefined, budget);

	assert.equal(writtenBytes, bytes.byteLength);
	assert.equal(budget.usedBytes, bytes.byteLength);
	assert.equal(result.digest, digestScapeBytes(bytes));
});

test('video extraction rejects an over-bound emission before budget or writer mutation', async () => {
	const bytes = new Uint8Array(SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES + 1);
	let writes = 0;
	const writer = videoWriter({ async write() { writes += 1; } });
	const budget = new ScapeExpandedByteBudget(bytes.byteLength);

	await assert.rejects(
		extractScapeVideo(emittingEntry('media/over-bound', bytes), writer, undefined, budget),
		/4 MiB video chunk limit/iu,
	);
	assert.equal(writes, 0);
	assert.equal(budget.usedBytes, 0);
});

test('video extraction rejects archive-size drift before writing storage', async () => {
	const bytes = Uint8Array.of(1, 2);
	let writes = 0;
	const writer = videoWriter({ async write() { writes += 1; } });
	const budget = new ScapeExpandedByteBudget(bytes.byteLength);
	const entry = archiveEntry('media/size-drift', 1, async (writable) => {
		const output = writable.getWriter();
		await output.write(bytes);
		await output.close();
	});

	await assert.rejects(extractScapeVideo(entry, writer, undefined, budget), /archive metadata/iu);
	assert.equal(writes, 0);
	assert.equal(budget.usedBytes, bytes.byteLength);
});

test('memory fallback rejects over 64 MiB before asset extraction and preserves inventory', async () => {
	let assetExtractions = 0;
	const fixture = syntheticVideoArchive({
		projectId: 'memory-admission',
		assetSize: 64 * 1024 * 1024 + 1,
		sha256: '0'.repeat(64),
		async emit() { assetExtractions += 1; },
	});
	const store = memoryStore('scape-memory-admission');
	const before = await inventory(store);

	await assert.rejects(importScapeProject(new Blob(['synthetic']), store, {
		archiveReaderFactory: fixture.readerFactory,
	}), /64 MiB process-memory media limit/iu);
	assert.equal(assetExtractions, 0);
	assert.deepEqual(await inventory(store), before);
});

test('synthetic over-4-MiB emission aborts staging before a storage write', async () => {
	const bytes = new Uint8Array(SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES + 1);
	const fixture = syntheticVideoArchive({
		projectId: 'oversized-emission',
		assetSize: bytes.byteLength,
		sha256: digestScapeBytes(bytes),
		async emit(output) { await output.write(bytes); },
	});
	const backingStore = memoryStore('scape-oversized-emission');
	const before = await inventory(backingStore);
	let storageWrites = 0;
	const store = proxyMediaWriter(backingStore, (writer) => ({
		...writer,
		async write(chunk, options) {
			storageWrites += 1;
			await writer.write(chunk, options);
		},
	}));

	await assert.rejects(importScapeProject(new Blob(['synthetic']), store, {
		archiveReaderFactory: fixture.readerFactory,
	}), /4 MiB video chunk limit/iu);
	assert.equal(storageWrites, 0);
	assert.deepEqual(await inventory(backingStore), before);
});

test('Scape digest verification runs before media commit and always aborts the staged writer', async () => {
	const emitted = Uint8Array.of(1, 2, 3);
	const fixture = syntheticVideoArchive({
		projectId: 'digest-before-commit',
		assetSize: emitted.byteLength,
		sha256: '0'.repeat(64),
		async emit(output) { await output.write(emitted); },
	});
	const backingStore = memoryStore('scape-digest-before-commit');
	const before = await inventory(backingStore);
	let commits = 0;
	let aborts = 0;
	const store = proxyMediaWriter(backingStore, (writer) => ({
		...writer,
		async commit(options) { commits += 1; return writer.commit(options); },
		async abort() { aborts += 1; await writer.abort(); },
	}));

	await assert.rejects(importScapeProject(new Blob(['synthetic']), store, {
		archiveReaderFactory: fixture.readerFactory,
	}), /SHA-256 verification/iu);
	assert.equal(commits, 0);
	assert.equal(aborts, 1);
	assert.deepEqual(await inventory(backingStore), before);
});

test('post-commit size metadata is verified before project publication and rolled back', async () => {
	const sourceStore = memoryStore('scape-persisted-size-source');
	const targetStore = memoryStore('scape-persisted-size-target');
	const project = videoProject('persisted-size-verification');
	await sourceStore.writeMediaAsset('video-source', new Blob(['video']), { mimeType: 'video/mp4' });
	const archive = (await exportScapeProject(project, sourceStore)).blob as Blob;
	let projectWrites = 0;
	const store = new Proxy(proxyMediaWriter(targetStore, (writer) => ({
		...writer,
		async commit(options) {
			const metadata = await writer.commit(options);
			return { ...metadata, size: Number(metadata.size) + 1 };
		},
		async commitOwned(options) {
			const publication = await writer.commitOwned!(options);
			return {
				metadata: { ...publication.metadata, size: Number(publication.metadata.size) + 1 },
				discardIfCurrent: publication.discardIfCurrent.bind(publication),
			};
		},
	})), {
		get(target, property, receiver) {
			if (property === 'saveProject') return async (...args: Parameters<typeof target.saveProject>) => {
				projectWrites += 1;
				return target.saveProject(...args);
			};
			const value = Reflect.get(target, property, receiver) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});

	await assert.rejects(importScapeProject(archive, store), /persisted media size verification/iu);
	assert.equal(projectWrites, 0);
	assert.equal(await targetStore.getMediaAssetMetadata('video-source'), null);
});

test('reference-scale cancellation retains only bounded chunks and restores IndexedDB inventory', async () => {
	const controller = new AbortController();
	const reason = new DOMException('cancel reference-scale video', 'AbortError');
	const declaredSize = 32 * 1024 * 1024 * 1024;
	const chunk = new Uint8Array(SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES);
	let emissions = 0;
	let maximumEmissionBytes = 0;
	const fixture = syntheticVideoArchive({
		projectId: 'reference-scale-cancellation',
		assetSize: declaredSize,
		sha256: '0'.repeat(64),
		async emit(output) {
			while (emissions * chunk.byteLength < declaredSize) {
				emissions += 1;
				maximumEmissionBytes = Math.max(maximumEmissionBytes, chunk.byteLength);
				await output.write(chunk);
			}
		},
	});
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = uniqueDatabaseName('scape-reference-scale');
	const backingStore = createProjectStore({
		indexedDB,
		memoryFallback: false,
		preferOpfs: false,
		databaseName,
	});
	await backingStore.ready();
	const store = proxyMediaWriter(backingStore, (writer) => ({
		...writer,
		async write(bytes, options) {
			await writer.write(bytes, options);
			controller.abort(reason);
		},
	}));

	await assert.rejects(importScapeProject(new Blob(['synthetic']), store, {
		signal: controller.signal,
		archiveReaderFactory: fixture.readerFactory,
	}), (error) => error === reason);
	assert.equal(emissions, 1);
	assert.equal(maximumEmissionBytes, SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES);
	assert.equal(indexedDB.recordCount(databaseName, 'mediaAssets'), 0);
	assert.equal(indexedDB.recordCount(databaseName, 'mediaAssetChunks'), 0);
	assert.deepEqual(await backingStore.listProjects(), []);
});

test('the default ZIP reader emits stored video in pinned 4 MiB chunks', async () => {
	const sourceStore = memoryStore('scape-pinned-reader-source');
	const targetStore = memoryStore('scape-pinned-reader-target');
	const bytes = new Uint8Array(SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES + 17).fill(0x33);
	const project = videoProject('pinned-reader-chunks');
	await sourceStore.writeMediaAsset('video-source', new Blob([bytes]), { mimeType: 'video/mp4' });
	const archive = (await exportScapeProject(project, sourceStore)).blob as Blob;
	const chunkSizes: number[] = [];
	const store = proxyMediaWriter(targetStore, (writer) => ({
		...writer,
		async write(chunk, options) {
			chunkSizes.push(chunk.byteLength);
			await writer.write(chunk, options);
		},
	}));

	await importScapeProject(archive, store);
	assert.deepEqual(chunkSizes, [SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES, 17]);
});

test('the default ZIP reader verifies a stored asset CRC before publication', async () => {
	const sourceStore = memoryStore('scape-crc-source');
	const targetStore = memoryStore('scape-crc-target');
	const project = videoProject('stored-asset-crc');
	const body = TEXT_ENCODER.encode('authentic video body');
	await sourceStore.writeMediaAsset('video-source', new Blob([body]), {
		mimeType: 'video/mp4',
	});
	const archive = (await exportScapeProject(project, sourceStore)).blob as Blob;
	const corrupted = await corruptEntryCrc(archive, 'media/video-source/original', body.byteLength);
	const before = await inventory(targetStore);

	await assert.rejects(importScapeProject(corrupted, targetStore), /invalid signature/iu);
	assert.deepEqual(await inventory(targetStore), before);
});

function videoWriter(overrides: Partial<ScapeVideoWriter> = {}): ScapeVideoWriter {
	return {
		maximumChunkBytes: SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
		bytesWritten: 0,
		write: async () => undefined,
		commit: async () => ({}),
		abort: async () => undefined,
		...overrides,
	};
}

function emittingEntry(filename: string, bytes: Uint8Array): ScapeArchiveEntry {
	return archiveEntry(filename, bytes.byteLength, async (writable) => {
		const output = writable.getWriter();
		await output.write(bytes);
		await output.close();
	});
}

function archiveEntry(
	filename: string,
	uncompressedSize: number,
	emit: (writable: WritableStream<Uint8Array>) => Promise<void>,
): ScapeArchiveEntry {
	return {
		filename,
		directory: false,
		encrypted: false,
		compressionMethod: 0,
		compressedSize: uncompressedSize,
		uncompressedSize,
		async getData(writable, options) {
			if (options?.checkOverlappingEntryOnly) return;
			await emit(writable);
		},
	};
}

function syntheticVideoArchive({
	projectId,
	assetSize,
	sha256,
	emit,
}: Readonly<{
	projectId: string;
	assetSize: number;
	sha256: string;
	emit(output: WritableStreamDefaultWriter<Uint8Array>): Promise<void>;
}>) {
	const project = videoProject(projectId);
	const projectBytes = TEXT_ENCODER.encode(JSON.stringify(project));
	const assetEntry = 'media/video-source/original';
	const manifestBytes = TEXT_ENCODER.encode(JSON.stringify({
		format: 'scape-project',
		formatVersion: 1,
		project: {
			entry: 'project.json',
			size: projectBytes.byteLength,
			sha256: digestScapeBytes(projectBytes),
		},
		assets: [{
			sourceId: 'video-source',
			kind: 'video',
			entry: assetEntry,
			encoding: 'original',
			mimeType: 'video/mp4',
			size: assetSize,
			sha256,
		}],
	}));
	const entries: ScapeArchiveEntry[] = [
		emittingEntry('manifest.json', manifestBytes),
		emittingEntry('project.json', projectBytes),
		{
			filename: assetEntry,
			directory: false,
			encrypted: false,
			compressionMethod: 0,
			compressedSize: assetSize,
			uncompressedSize: assetSize,
			async getData(writable, options) {
				if (options?.checkOverlappingEntryOnly) return;
				const output = writable.getWriter();
				await emit(output);
				await output.close();
			},
		},
	];
	return {
		readerFactory: () => ({
			async *getEntriesGenerator() {
				for (const entry of entries) yield entry;
				return false;
			},
			close: async () => undefined,
		}),
	};
}

function memoryStore(prefix: string) {
	return createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueDatabaseName(prefix),
	});
}

async function inventory(store: ReturnType<typeof memoryStore>) {
	return {
		projects: await store.listProjects(),
		sources: await store.listSources(),
		mediaAssets: [...store.memory.mediaAssets.keys()].sort(),
		mediaAssetChunks: [...store.memory.mediaAssetChunks.keys()].sort(),
	};
}

function proxyMediaWriter(
	store: ReturnType<typeof createProjectStore>,
	wrap: (writer: ScapeVideoWriter) => ScapeVideoWriter,
): ReturnType<typeof createProjectStore> {
	return new Proxy(store, {
		get(target, property, receiver) {
			if (property === 'beginMediaAssetWrite') return async (
				...args: Parameters<typeof target.beginMediaAssetWrite>
			) => wrap(await target.beginMediaAssetWrite(...args));
			const value = Reflect.get(target, property, receiver) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	});
}

function videoProject(id: string) {
	return createCurrentAudioEditorProject({
		id,
		title: 'Streamed video',
		sources: [{
			kind: 'video',
			id: 'video-source',
			storageKey: 'video-source',
			name: 'picture.mp4',
			mimeType: 'video/mp4',
			frameCount: 48_000,
			sampleRate: 48_000,
			width: 1_920,
			height: 1_080,
			frameRate: 30,
			videoCodec: 'h264',
			audioCodec: null,
			hasAudio: false,
		}],
		clips: [{
			kind: 'video',
			id: 'video-clip',
			sourceId: 'video-source',
			title: 'Picture',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			sourceDurationFrames: 48_000,
			durationFrames: 48_000,
		}],
		tracks: [{ type: 'video', id: 'video-track', name: 'Video', clipIds: ['video-clip'] }],
	});
}

async function corruptEntryCrc(archive: Blob, filename: string, payloadBytes: number): Promise<Blob> {
	const bytes = new Uint8Array(await archive.arrayBuffer());
	const filenameBytes = TEXT_ENCODER.encode(filename);
	const fields = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let localOffset = -1;
	let centralOffset = -1;
	for (let offset = 0; offset <= bytes.byteLength - 30; offset += 1) {
		const signature = fields.getUint32(offset, true);
		const isLocal = signature === 0x0403_4b50;
		const isCentral = signature === 0x0201_4b50;
		if (!isLocal && !isCentral) continue;
		const fixedBytes = isLocal ? 30 : 46;
		if (offset > bytes.byteLength - fixedBytes) continue;
		const nameLength = fields.getUint16(offset + (isLocal ? 26 : 28), true);
		if (nameLength !== filenameBytes.byteLength
			|| !bytesMatch(bytes, offset + fixedBytes, filenameBytes)) continue;
		if (isLocal) {
			assert.equal(localOffset, -1, 'the fixture has only one matching local entry');
			localOffset = offset;
		} else {
			assert.equal(centralOffset, -1, 'the fixture has only one matching central entry');
			centralOffset = offset;
		}
	}
	assert.ok(localOffset >= 0, 'the fixture has the requested local entry');
	assert.ok(centralOffset >= 0, 'the fixture has the requested central entry');
	const original = fields.getUint32(centralOffset + 16, true);
	const localNameLength = fields.getUint16(localOffset + 26, true);
	const localExtraLength = fields.getUint16(localOffset + 28, true);
	const descriptorOffset = localOffset + 30 + localNameLength + localExtraLength + payloadBytes;
	assert.equal(fields.getUint32(descriptorOffset, true), 0x0807_4b50);
	assert.equal(fields.getUint32(descriptorOffset + 4, true), original);
	const corrupted = original ^ 1;
	fields.setUint32(centralOffset + 16, corrupted, true);
	fields.setUint32(descriptorOffset + 4, corrupted, true);
	return new Blob([bytes], { type: archive.type });
}

function bytesMatch(bytes: Uint8Array, offset: number, expected: Uint8Array): boolean {
	if (offset < 0 || offset > bytes.byteLength - expected.byteLength) return false;
	return expected.every((byte, index) => bytes[offset + index] === byte);
}

function uniqueDatabaseName(prefix: string): string {
	return `${prefix}-${String(Date.now())}-${String(Math.random())}`;
}
