/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCaptureDurableSessionCoordinator } from '../src/common/editor/controller/framescaper-capture-durable-session.ts';
import { EncodedCaptureSpoolRepository, ENCODED_CAPTURE_MAXIMUM_CHUNK_BYTES } from '../src/common/editor/storage/encoded-capture-spool-repository.ts';
import { FramescaperCaptureSessionManifestRepository } from '../src/common/editor/storage/framescaper-capture-session-manifest-repository.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { MediaAssetChunkRecords } from '../src/common/editor/storage/media-asset-chunk-records.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { OpfsPreferredEncodedCaptureChunkPort } from '../src/common/editor/storage/opfs-preferred-encoded-capture-chunk-port.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { RawPcmSpoolRepository, type RawPcmSpoolRecord } from '../src/common/editor/storage/raw-pcm-spool-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';

const APPEND_INTENT_PREFIX = 'framescaper-capture-spool-append-intent-v1:';

test('fresh fallback storage removes a stopped partial multi-chunk append before shorter same-index reuse', async () => {
	const fixture = fallbackFixture();
	let writes = 0;
	const partialChunks = {
		write: async (record: Parameters<MediaAssetChunkRecords['write']>[0]) => {
			writes += 1;
			if (writes === 2) throw new Error('process stopped between fallback chunks');
			await fixture.media.write(record);
		},
		chunks: fixture.media.chunks.bind(fixture.media),
		deleteOwned: fixture.media.deleteOwned.bind(fixture.media),
		deleteTailOwned: fixture.media.deleteTailOwned.bind(fixture.media),
	};
	const first = new EncodedCaptureSpoolRepository(fixture.values, partialChunks);
	const previous = await createEncoded(first, 'fallback-partial');
	await assert.rejects(appendEncoded(
		first, previous, 0, new Uint8Array(ENCODED_CAPTURE_MAXIMUM_CHUNK_BYTES + 1),
	), /stopped between fallback chunks/u);
	assert.equal(fixture.memory.mediaAssetChunks.size, 1);
	assert.equal(intentCount(fixture.memory.analysis), 1);

	const reopened = new EncodedCaptureSpoolRepository(fixture.values, fixture.media);
	const recovered = await reopened.load(previous.projectId, previous.spoolId);
	assert.deepEqual(recovered, previous);
	assert.equal(fixture.memory.mediaAssetChunks.size, 0);
	assert.equal(intentCount(fixture.memory.analysis), 0);
	const retried = await appendEncoded(reopened, recovered!, 0, Uint8Array.of(9));
	await acknowledgeEncoded(reopened, retried);
	assert.equal(fixture.memory.mediaAssetChunks.size, 1);
	assert.equal((await collect(reopened.read(retried))).length, 1);
});

test('fresh OPFS storage removes a stopped partial multi-chunk append before same-index reuse', async () => {
	const fixture = fallbackFixture();
	const files = new Map<string, Blob>();
	const opfs = new OpfsPreferredEncodedCaptureChunkPort({
		values: fixture.values,
		opfs: new OpfsRepository({ preferOpfs: true, opfsRoot: opfsDirectory(files) }),
		fallback: fixture.media,
	});
	let writes = 0;
	const partialChunks = {
		async write(record: Parameters<typeof opfs.write>[0]) {
			writes += 1;
			if (writes === 2) throw new Error('process stopped between OPFS chunks');
			await opfs.write(record);
		},
		chunks: opfs.chunks.bind(opfs), deleteOwned: opfs.deleteOwned.bind(opfs),
		deleteTailOwned: opfs.deleteTailOwned.bind(opfs),
	};
	const first = new EncodedCaptureSpoolRepository(fixture.values, partialChunks);
	const previous = await createEncoded(first, 'opfs-partial');
	await assert.rejects(appendEncoded(
		first, previous, 0, new Uint8Array(ENCODED_CAPTURE_MAXIMUM_CHUNK_BYTES + 1),
	), /stopped between OPFS chunks/u);
	assert.equal(files.size, 1);
	assert.equal(intentCount(fixture.memory.analysis), 1);

	const reopenedChunks = new OpfsPreferredEncodedCaptureChunkPort({
		values: fixture.values,
		opfs: new OpfsRepository({ preferOpfs: true, opfsRoot: opfsDirectory(files) }),
		fallback: fixture.media,
	});
	const reopened = new EncodedCaptureSpoolRepository(fixture.values, reopenedChunks);
	const recovered = await reopened.load(previous.projectId, previous.spoolId);
	assert.deepEqual(recovered, previous);
	assert.equal(files.size, 0);
	const retried = await appendEncoded(reopened, recovered!, 0, Uint8Array.of(7));
	await acknowledgeEncoded(reopened, retried);
	assert.equal(files.size, 1);
	assert.equal((await collect(reopened.read(retried))).length, 1);
});

test('fresh raw storage removes a body committed before its registry CAS and permits a shorter retry', async () => {
	const fixture = fallbackFixture();
	const source = new SourceRecordRepository(fixture.port);
	let stop = true;
	const chunks = {
		async writeChunk(record: Parameters<SourceRecordRepository['writeChunk']>[0]) {
			await source.writeChunk(record);
			if (stop) { stop = false; throw new Error('process stopped after raw body write'); }
		},
		chunk: source.chunk.bind(source), deleteChunks: source.deleteChunks.bind(source),
		deleteChunksFrom: source.deleteChunksFrom.bind(source),
	};
	const first = new RawPcmSpoolRepository(fixture.values, chunks);
	const previous = await createRaw(first, 'raw-body');
	await assert.rejects(
		first.append(previous, [Float32Array.of(1, 2, 3)], previous.data),
		/process stopped after raw body write/u,
	);
	assert.equal(fixture.memory.sourceChunks.size, 1);
	assert.equal(intentCount(fixture.memory.analysis), 1);

	const reopened = new RawPcmSpoolRepository(fixture.values, source);
	const recovered = await reopened.load(previous.projectId, previous.spoolId);
	assert.deepEqual(recovered, previous);
	assert.equal(fixture.memory.sourceChunks.size, 0);
	const retried = await reopened.append(recovered!, [Float32Array.of(9)], recovered!.data);
	await acknowledgeRaw(reopened, retried);
	assert.equal((await reopened.chunk(retried, 0)).frames, 1);
	assert.equal(await source.chunk(retried.spoolToken, 1), null);
});

test('fresh coordinator rolls back encoded and raw CAS commits whose acknowledgements and manifest CAS were lost', async () => {
	const fixture = fallbackFixture();
	let throwEncoded = true;
	let throwRaw = true;
	const faultValues = conditionalCommitThrowValues(fixture.values, (key) => {
		if (key.startsWith('framescaper-encoded-capture-spool-v1:') && throwEncoded) {
			throwEncoded = false;
			return true;
		}
		if (key.startsWith('raw-pcm-spool-registry-v1:') && throwRaw) {
			throwRaw = false;
			return true;
		}
		return false;
	});
	const media = new MediaAssetChunkRecords(fixture.port);
	const source = new SourceRecordRepository(fixture.port);
	const encoded = new EncodedCaptureSpoolRepository(faultValues, media);
	const raw = new RawPcmSpoolRepository(faultValues, source);
	const encodedPrevious = await createEncoded(encoded, 'crash-window', 'project-crash', 'session-crash');
	const rawPrevious = await createRaw(raw, 'crash-window', 'project-crash', 'session-crash');
	const manifests = new FramescaperCaptureSessionManifestRepository(fixture.values);
	await manifests.create(initialManifest(encodedPrevious, rawPrevious));

	const encodedNext = await appendEncoded(encoded, encodedPrevious, 0, Uint8Array.of(1, 2, 3));
	const rawNext = await raw.append(rawPrevious, [Float32Array.of(4, 5, 6)], rawPrevious.data);
	assert.equal(encodedNext.packetCount, 1);
	assert.equal(rawNext.chunkCount, 1);
	const beforeSecond = fixture.memory.mediaAssetChunks.size;
	await assert.rejects(
		appendEncoded(encoded, encodedNext, 1, Uint8Array.of(8)),
		/pending durable manifest reconciliation/u,
	);
	assert.equal(fixture.memory.mediaAssetChunks.size, beforeSecond);
	assert.equal(intentCount(fixture.memory.analysis), 2);

	const reopenedEncoded = new EncodedCaptureSpoolRepository(fixture.values, media);
	const reopenedRaw = new RawPcmSpoolRepository(fixture.values, source);
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: reopenedEncoded, rawPcmSpools: reopenedRaw, manifests, now: () => 10,
	});
	const session = await coordinator.load('project-crash', 'session-crash');
	assert.ok(session);
	assert.deepEqual(await reopenedEncoded.load('project-crash', encodedPrevious.spoolId), encodedPrevious);
	assert.deepEqual(await reopenedRaw.load('project-crash', rawPrevious.spoolId), rawPrevious);
	assert.equal(fixture.memory.mediaAssetChunks.size, 0);
	assert.equal(fixture.memory.sourceChunks.size, 0);
	assert.equal(intentCount(fixture.memory.analysis), 0);

	const encodedRetry = await appendEncoded(reopenedEncoded, encodedPrevious, 0, Uint8Array.of(9));
	await acknowledgeEncoded(reopenedEncoded, encodedRetry);
	const rawRetry = await reopenedRaw.append(rawPrevious, [Float32Array.of(7)], rawPrevious.data);
	await acknowledgeRaw(reopenedRaw, rawRetry);
	assert.equal(fixture.memory.mediaAssetChunks.size, 1);
	assert.equal((await reopenedRaw.chunk(rawRetry, 0)).frames, 1);
});

test('manifest-success intent deletion acknowledgement is idempotent before the next append', async () => {
	const fixture = fallbackFixture();
	let loseDeleteAcknowledgement = true;
	const values = {
		...conditionalCommitThrowValues(fixture.values, () => false),
		async deleteIfCurrent(key: string, expected: unknown) {
			const removed = await fixture.values.deleteIfCurrent(key, expected);
			if (removed && key.startsWith(APPEND_INTENT_PREFIX) && loseDeleteAcknowledgement) {
				loseDeleteAcknowledgement = false;
				throw new Error('append intent deletion acknowledgement lost');
			}
			return removed;
		},
	};
	const repository = new EncodedCaptureSpoolRepository(values, fixture.media);
	let current = await createEncoded(repository, 'delete-ack');
	current = await appendEncoded(repository, current, 0, Uint8Array.of(1));
	current = await acknowledgeEncoded(repository, current);
	assert.equal(intentCount(fixture.memory.analysis), 0);
	current = await appendEncoded(repository, current, 1, Uint8Array.of(2));
	current = await acknowledgeEncoded(repository, current);
	assert.equal(current.packetCount, 2);
	await assert.rejects(
		appendEncoded(repository, current, 2, Uint8Array.of(3), 3_000),
		/contiguous and monotonic/u,
	);
});

test('passive encoded and raw scans wait for live physical writes and concurrent appends cannot steal their intents', async () => {
	await assertLiveEncodedScanWaits();
	await assertLiveRawScanWaits();
});

async function assertLiveEncodedScanWaits(): Promise<void> {
	const fixture = fallbackFixture();
	const write = deferred<void>();
	const started = deferred<void>();
	const chunks = {
		async write(record: Parameters<MediaAssetChunkRecords['write']>[0]) {
			await fixture.media.write(record);
			started.resolve();
			await write.promise;
		},
		chunks: fixture.media.chunks.bind(fixture.media), deleteOwned: fixture.media.deleteOwned.bind(fixture.media),
		deleteTailOwned: fixture.media.deleteTailOwned.bind(fixture.media),
	};
	const writer = new EncodedCaptureSpoolRepository(fixture.values, chunks);
	const scanner = new EncodedCaptureSpoolRepository(fixture.values, fixture.media);
	const previous = await createEncoded(writer, 'live-encoded');
	const appending = appendEncoded(writer, previous, 0, Uint8Array.of(1));
	await started.promise;
	assert.equal(fixture.memory.mediaAssetChunks.size, 1);
	assert.equal(intentCount(fixture.memory.analysis), 1);
	let scanned = false;
	const scan = scanner.listAll().then((records) => { scanned = true; return records; });
	const competing = appendEncoded(scanner, previous, 0, Uint8Array.of(2));
	await Promise.resolve();
	assert.equal(scanned, false);
	assert.equal(fixture.memory.mediaAssetChunks.size, 1);
	write.resolve();
	const next = await appending;
	assert.deepEqual(await scan, [next]);
	await assert.rejects(competing, /pending durable manifest reconciliation|ownership changed/u);
	assert.equal(fixture.memory.mediaAssetChunks.size, 1);
	await acknowledgeEncoded(scanner, next);
}

async function assertLiveRawScanWaits(): Promise<void> {
	const fixture = fallbackFixture();
	const source = new SourceRecordRepository(fixture.port);
	const write = deferred<void>();
	const started = deferred<void>();
	const chunks = {
		async writeChunk(record: Parameters<SourceRecordRepository['writeChunk']>[0]) {
			await source.writeChunk(record);
			started.resolve();
			await write.promise;
		},
		chunk: source.chunk.bind(source), deleteChunks: source.deleteChunks.bind(source),
		deleteChunksFrom: source.deleteChunksFrom.bind(source),
	};
	const writer = new RawPcmSpoolRepository(fixture.values, chunks);
	const scanner = new RawPcmSpoolRepository(fixture.values, source);
	const previous = await createRaw(writer, 'live-raw');
	const appending = writer.append(previous, [Float32Array.of(1)], previous.data);
	await started.promise;
	assert.equal(fixture.memory.sourceChunks.size, 1);
	assert.equal(intentCount(fixture.memory.analysis), 1);
	let scanned = false;
	const scan = scanner.listAll().then((records) => { scanned = true; return records; });
	const competing = scanner.append(previous, [Float32Array.of(2)], previous.data);
	await Promise.resolve();
	assert.equal(scanned, false);
	write.resolve();
	const next = await appending;
	assert.deepEqual(await scan, [next]);
	await assert.rejects(competing, /pending durable manifest reconciliation|ownership changed/u);
	assert.equal(fixture.memory.sourceChunks.size, 1);
	await acknowledgeRaw(scanner, next);
}

function fallbackFixture() {
	const memory = getMemoryDatabase(uniqueName());
	const port = { memory, database: async () => null };
	const values = new KeyValueRepository(port, 'analysis');
	return { memory, port, values, media: new MediaAssetChunkRecords(port) };
}

function conditionalCommitThrowValues(values: KeyValueRepository, shouldThrow: (key: string) => boolean) {
	return {
		get: values.get.bind(values), putIfAbsent: values.putIfAbsent.bind(values),
		putIfAbsentWhenCurrent: values.putIfAbsentWhenCurrent.bind(values),
		replaceIfCurrent: values.replaceIfCurrent.bind(values),
		replaceIfCurrentAndPutIfAbsent: values.replaceIfCurrentAndPutIfAbsent.bind(values),
		async replaceIfCurrentWhenCurrent(
			fenceKey: string, expectedFence: unknown, key: string, expected: unknown, replacement: unknown,
		) {
			const replaced = await values.replaceIfCurrentWhenCurrent(
				fenceKey, expectedFence, key, expected, replacement,
			);
			if (replaced && shouldThrow(key)) throw new Error('metadata CAS acknowledgement lost');
			return replaced;
		},
		deleteIfCurrent: values.deleteIfCurrent.bind(values),
		listByPrefix: values.listByPrefix.bind(values),
	};
}

function createEncoded(
	repository: EncodedCaptureSpoolRepository,
	id: string,
	projectId = `project-${id}`,
	sessionId = `session-${id}`,
) {
	return repository.create({
		projectId, sessionId, streamId: 'camera-stream', spoolId: `encoded-${id}`,
		sourceId: `encoded-source-${id}`, mimeType: 'video/webm',
	});
}

function createRaw(
	repository: RawPcmSpoolRepository,
	id: string,
	projectId = `project-${id}`,
	sessionId = `session-${id}`,
) {
	return repository.createFramescaper({
		projectId, spoolId: `raw-${id}`, spoolToken: `raw-token-${id}`,
		sampleRate: 48_000, channelCount: 1, chunkFrames: 8,
		data: rawOwner(sessionId),
	});
}

function rawOwner(sessionId: string) {
	return Object.freeze({
		version: 1 as const, kind: 'framescaper-capture-raw-pcm' as const,
		sessionId, streamId: 'microphone-stream', sourceId: 'microphone-source', role: 'microphone' as const,
	});
}

async function appendEncoded(
	repository: EncodedCaptureSpoolRepository,
	record: Awaited<ReturnType<EncodedCaptureSpoolRepository['create']>>,
	sequence: number,
	bytes: Uint8Array<ArrayBuffer>,
	ptsMicroseconds = sequence * 1_000,
) {
	return (await repository.append(record, {
		sequence, ptsMicroseconds, durationMicroseconds: 1_000, payload: new Blob([bytes]),
	})).spool;
}

function acknowledgeEncoded(
	repository: EncodedCaptureSpoolRepository,
	record: Awaited<ReturnType<EncodedCaptureSpoolRepository['create']>>,
) {
	return repository.reconcileAppend(record, {
		packetCount: record.packetCount, chunkCount: record.chunkCount, byteLength: record.byteLength,
		firstPtsMicroseconds: record.firstPtsMicroseconds,
		lastPtsEndMicroseconds: record.lastPtsEndMicroseconds,
	});
}

function acknowledgeRaw(repository: RawPcmSpoolRepository, record: RawPcmSpoolRecord) {
	return repository.reconcileAppend(record, { frameCount: record.frameCount, chunkCount: record.chunkCount });
}

function initialManifest(
	encoded: Awaited<ReturnType<EncodedCaptureSpoolRepository['create']>>,
	raw: RawPcmSpoolRecord,
) {
	return {
		version: 1 as const, sessionId: encoded.sessionId, generation: 1, state: 'capturing' as const,
		recoveryDecision: null,
		projectFence: { projectId: encoded.projectId, baseRevision: 1, baseSha256: 'ab'.repeat(32) },
		origin: { sequenceId: 'sequence-crash', playheadMicroseconds: 0, destination: 'both' as const },
		clock: { monotonicOriginMicroseconds: 0, pauseSpans: [] },
		streams: [{
			streamId: encoded.streamId, role: 'camera' as const, required: true, playability: 'unknown' as const,
			timing: { firstPresentationMicroseconds: null, lastPresentationEndMicroseconds: null },
			storage: {
				kind: 'encoded-media' as const, spoolId: encoded.spoolId, spoolToken: encoded.spoolToken,
				sourceId: encoded.sourceId, mimeType: encoded.mimeType, packetCount: 0, chunkCount: 0, byteLength: 0,
			},
		}, {
			streamId: 'microphone-stream', role: 'microphone' as const, required: true, playability: 'unknown' as const,
			timing: { firstPresentationMicroseconds: null, lastPresentationEndMicroseconds: null },
			storage: {
				kind: 'raw-pcm' as const, spoolId: raw.spoolId, spoolToken: raw.spoolToken,
				sourceId: 'microphone-source', sampleRate: raw.sampleRate, channelCount: raw.channelCount,
				frameCount: 0, chunkCount: 0,
			},
		}],
		createdAt: 1, updatedAt: 1,
	};
}

function intentCount(values: Map<string, unknown>): number {
	return [...values.keys()].filter((key) => key.startsWith(APPEND_INTENT_PREFIX)).length;
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve: resolve as Value extends void ? () => void : typeof resolve };
}

async function collect<Value>(values: AsyncIterable<Value>): Promise<Value[]> {
	const collected: Value[] = [];
	for await (const value of values) collected.push(value);
	return collected;
}

function uniqueName(): string {
	return `framescaper-capture-prewrite-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function opfsDirectory(files: Map<string, Blob>): FileSystemDirectoryHandle {
	const directory = {
		async getDirectoryHandle() { return directory; },
		async getFileHandle(path: string, options: Readonly<{ create?: boolean }> = {}) {
			if (!files.has(path) && !options.create) throw new DOMException('missing', 'NotFoundError');
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
			if (!files.delete(path)) throw new DOMException('missing', 'NotFoundError');
		},
	};
	return directory as unknown as FileSystemDirectoryHandle;
}
