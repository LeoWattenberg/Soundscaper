/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ENCODED_CAPTURE_MAXIMUM_CHUNK_BYTES,
	EncodedCaptureSpoolRepository,
} from '../src/common/editor/storage/encoded-capture-spool-repository.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { MediaAssetChunkRecords } from '../src/common/editor/storage/media-asset-chunk-records.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { RawPcmSpoolRepository } from '../src/common/editor/storage/raw-pcm-spool-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';

test('fresh fallback storage resumes an encoded tail intent before a shorter reappend', async () => {
	const memory = getMemoryDatabase(uniqueName());
	const port = { memory, database: async () => null };
	const values = new KeyValueRepository(port, 'analysis');
	const storedChunks = new MediaAssetChunkRecords(port);
	let rejectTail = true;
	const faultChunks = {
		write: storedChunks.write.bind(storedChunks),
		chunks: storedChunks.chunks.bind(storedChunks),
		deleteOwned: storedChunks.deleteOwned.bind(storedChunks),
		async deleteTailOwned(token: string, sourceId: string, firstIndex: number) {
			if (rejectTail) { rejectTail = false; throw new Error('fallback tail deletion stopped'); }
			return storedChunks.deleteTailOwned(token, sourceId, firstIndex);
		},
	};
	const first = new EncodedCaptureSpoolRepository(values, faultChunks, { createId: () => 'fallback-tail' });
	let acknowledged = await first.create({
		projectId: 'project-fallback', sessionId: 'session-fallback', streamId: 'camera-stream',
		spoolId: 'spool-fallback', sourceId: 'source-fallback', mimeType: 'video/webm',
	});
	acknowledged = await appendEncoded(first, acknowledged, 0, Uint8Array.of(1));
	acknowledged = await acknowledgeEncoded(first, acknowledged);
	const largeTail = new Uint8Array(ENCODED_CAPTURE_MAXIMUM_CHUNK_BYTES + 1);
	largeTail[0] = 2;
	largeTail[largeTail.length - 1] = 3;
	const advanced = await appendEncoded(first, acknowledged, 1, largeTail);

	await assert.rejects(
		first.restoreAcknowledgedPrefix(advanced, acknowledged),
		/fallback tail deletion stopped/u,
	);
	assert.equal(memory.mediaAssetChunks.size, 3);

	const reopened = new EncodedCaptureSpoolRepository(values, new MediaAssetChunkRecords(port));
	const [recovered] = await reopened.listAll();
	assert.deepEqual(recovered, acknowledged);
	assert.equal(memory.mediaAssetChunks.size, 1, 'fresh load must reclaim every inventoried fallback tail chunk');
	let retried = await appendEncoded(reopened, recovered, 1, Uint8Array.of(9));
	retried = await acknowledgeEncoded(reopened, retried);
	assert.equal(memory.mediaAssetChunks.size, 2, 'a shorter retry must not retain the old second tail chunk');
	assert.equal((await collect(reopened.read(retried))).length, 2);
	await reopened.delete(retried);
});

test('ordinary raw PCM operations never enter the Framescaper cross-context lock protocol', async () => {
	const navigatorValue = globalThis.navigator as Navigator & { locks?: LockManager };
	const descriptor = Object.getOwnPropertyDescriptor(navigatorValue, 'locks');
	let requests = 0;
	Object.defineProperty(navigatorValue, 'locks', {
		configurable: true,
		value: { request() { requests += 1; throw new Error('ordinary raw PCM requested a capture lock'); } },
	});
	try {
		const memory = getMemoryDatabase(uniqueName());
		const port = { memory, database: async () => null };
		const repository = new RawPcmSpoolRepository(
			new KeyValueRepository(port, 'analysis'), new SourceRecordRepository(port),
		);
		let record = await repository.create({
			projectId: 'ordinary-project', spoolId: 'ordinary-spool', spoolToken: 'ordinary-token',
			sampleRate: 48_000, channelCount: 1, chunkFrames: 8, data: { owner: 'ordinary' },
		});
		record = await repository.append(record, [Float32Array.of(1)], record.data);
		record = await repository.seal(record, record.data);
		assert.deepEqual(await repository.load(record.projectId, record.spoolId), record);
		assert.equal(await repository.remove(record), true);
		assert.equal(requests, 0);
	} finally {
		if (descriptor) Object.defineProperty(navigatorValue, 'locks', descriptor);
		else Reflect.deleteProperty(navigatorValue, 'locks');
	}
});

test('fresh raw PCM storage resumes a source-chunk tail intent before a shorter reappend', async () => {
	const memory = getMemoryDatabase(uniqueName());
	const port = { memory, database: async () => null };
	const values = new KeyValueRepository(port, 'analysis');
	const storedChunks = new SourceRecordRepository(port);
	let rejectTail = true;
	const faultChunks = {
		writeChunk: storedChunks.writeChunk.bind(storedChunks),
		chunk: storedChunks.chunk.bind(storedChunks),
		deleteChunks: storedChunks.deleteChunks.bind(storedChunks),
		async deleteChunksFrom(token: string, firstIndex: number) {
			if (rejectTail) { rejectTail = false; throw new Error('raw tail deletion stopped'); }
			await storedChunks.deleteChunksFrom(token, firstIndex);
		},
	};
	const first = new RawPcmSpoolRepository(values, faultChunks);
	let acknowledged = await first.createFramescaper({
		projectId: 'project-raw', spoolId: 'spool-raw', spoolToken: 'token-raw',
		sampleRate: 48_000, channelCount: 1, chunkFrames: 8, data: { owner: 'raw' },
	});
	acknowledged = await first.append(acknowledged, [Float32Array.of(1, 2)], { owner: 'raw' });
	acknowledged = await acknowledgeRaw(first, acknowledged);
	const advanced = await first.append(acknowledged, [Float32Array.of(3, 4, 5)], { owner: 'raw' });

	await assert.rejects(
		first.restoreAcknowledgedPrefix(advanced, acknowledged),
		/raw tail deletion stopped/u,
	);
	assert.equal(memory.sourceChunks.size, 2);

	const reopened = new RawPcmSpoolRepository(values, new SourceRecordRepository(port));
	const [recovered] = await reopened.listAll();
	assert.deepEqual(recovered, acknowledged);
	assert.equal(memory.sourceChunks.size, 1, 'fresh load must reclaim the inventoried raw tail chunk');
	let retried = await reopened.append(recovered, [Float32Array.of(9)], { owner: 'raw' });
	retried = await acknowledgeRaw(reopened, retried);
	assert.equal(memory.sourceChunks.size, 2);
	assert.equal((await reopened.chunk(retried, 1)).frames, 1, 'the shorter retry must replace no retained tail');
	assert.equal(await storedChunks.chunk(retried.spoolToken, 2), null);
	assert.equal(await reopened.remove(retried), true);
});

async function appendEncoded(
	repository: EncodedCaptureSpoolRepository,
	spool: Awaited<ReturnType<EncodedCaptureSpoolRepository['create']>>,
	sequence: number,
	bytes: Uint8Array<ArrayBuffer>,
) {
	return (await repository.append(spool, {
		sequence,
		ptsMicroseconds: sequence * 1_000,
		durationMicroseconds: 1_000,
		payload: new Blob([bytes]),
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

function acknowledgeRaw(
	repository: RawPcmSpoolRepository,
	record: Awaited<ReturnType<RawPcmSpoolRepository['create']>>,
) {
	return repository.reconcileAppend(record, {
		frameCount: record.frameCount, chunkCount: record.chunkCount,
	});
}

async function collect<Value>(values: AsyncIterable<Value>): Promise<Value[]> {
	const collected: Value[] = [];
	for await (const value of values) collected.push(value);
	return collected;
}

function uniqueName(): string {
	return `framescaper-capture-tail-cleanup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
