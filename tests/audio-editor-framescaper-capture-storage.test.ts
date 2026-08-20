/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	decideFramescaperCaptureRecovery,
	normalizeFramescaperCaptureSessionManifest,
	type FramescaperCaptureSessionManifestV1,
} from '../src/common/editor/framescaper-capture-session-manifest.ts';
import {
	EncodedCaptureSpoolRepository,
	ENCODED_CAPTURE_MAXIMUM_CHUNK_BYTES,
} from '../src/common/editor/storage/encoded-capture-spool-repository.ts';
import { FramescaperCaptureSessionManifestRepository } from '../src/common/editor/storage/framescaper-capture-session-manifest-repository.ts';
import { openDatabase } from '../src/common/editor/storage/indexeddb-backend.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { MediaAssetChunkRecords } from '../src/common/editor/storage/media-asset-chunk-records.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

test('encoded capture append acknowledges a bounded durable prefix and adopts without copying', async () => {
	const fixture = storageFixture();
	let spool = await fixture.spools.create({
		projectId: 'project-capture',
		sessionId: 'session-capture',
		streamId: 'camera-stream',
		spoolId: 'camera-spool',
		sourceId: 'camera-source',
		mimeType: 'video/webm;codecs=vp8',
	});
	const bytes = new Uint8Array(ENCODED_CAPTURE_MAXIMUM_CHUNK_BYTES + 3);
	bytes[0] = 7;
	bytes[bytes.length - 1] = 9;
	const acknowledgement = await fixture.spools.append(spool, {
		sequence: 0,
		ptsMicroseconds: 10_000,
		durationMicroseconds: 20_000,
		payload: new Blob([bytes]),
	});
	spool = acknowledgement.spool;

	assert.equal(acknowledgement.firstChunkIndex, 0);
	assert.equal(acknowledgement.chunkCount, 2);
	assert.equal(acknowledgement.byteLength, bytes.byteLength);
	assert.equal(spool.packetCount, 1);
	assert.equal(spool.chunkCount, 2);
	assert.equal(spool.byteLength, bytes.byteLength);
	const chunks = await collect(fixture.spools.read(spool));
	assert.deepEqual(chunks.map(({ payload }) => payload.size), [ENCODED_CAPTURE_MAXIMUM_CHUNK_BYTES, 3]);
	assert.equal(new Uint8Array(await chunks[0]!.payload.arrayBuffer())[0], 7);
	assert.equal(new Uint8Array(await chunks[1]!.payload.arrayBuffer())[2], 9);

	spool = await fixture.spools.seal(spool);
	const adoption = await fixture.spools.adopt(spool, 'camera-source');
	assert.equal(adoption.spool.state, 'adopted');
	assert.deepEqual(adoption.assetIdentity, {
		sourceId: 'camera-source',
		mediaChunkToken: spool.spoolToken,
		mimeType: 'video/webm;codecs=vp8',
		byteLength: bytes.byteLength,
		chunkCount: 2,
	});
	assert.deepEqual(await fixture.spools.retainedMediaChunkTokens(), new Set([spool.spoolToken]));
	await fixture.spools.releaseAdopted(adoption.spool);
	assert.equal(await fixture.spools.load('project-capture', 'camera-spool'), null);
	assert.equal(fixture.memory.mediaAssetChunks.size, 2, 'published media owns the adopted bytes');
});

test('a failed append CAS leaves a removable tail outside the acknowledged prefix', async () => {
	const fixture = storageFixture();
	let rejectReplacement = false;
	const spools = new EncodedCaptureSpoolRepository({
		get: fixture.values.get.bind(fixture.values),
		putIfAbsent: fixture.values.putIfAbsent.bind(fixture.values),
		deleteIfCurrent: fixture.values.deleteIfCurrent.bind(fixture.values),
		listByPrefix: fixture.values.listByPrefix.bind(fixture.values),
		async replaceIfCurrent(key, expected, replacement) {
			return rejectReplacement ? false : fixture.values.replaceIfCurrent(key, expected, replacement);
		},
	}, fixture.chunks, { createId: () => 'tail-token' });
	const created = await spools.create({
		projectId: 'project-tail', sessionId: 'session-tail', streamId: 'display-stream',
		spoolId: 'display-spool', sourceId: 'display-source', mimeType: 'video/webm',
	});
	rejectReplacement = true;
	await assert.rejects(spools.append(created, {
		sequence: 0, ptsMicroseconds: 0, durationMicroseconds: 1_000,
		payload: new Blob([Uint8Array.of(1, 2, 3)]),
	}), /outside the authoritative acknowledged prefix/u);

	const current = await spools.load('project-tail', 'display-spool');
	assert.ok(current);
	assert.equal(current.packetCount, 0);
	assert.deepEqual(await collect(spools.read(current)), []);
	assert.equal(fixture.memory.mediaAssetChunks.size, 1, 'the physical crash tail remains reclaimable');
	rejectReplacement = false;
	await spools.delete(current);
	assert.equal(fixture.memory.mediaAssetChunks.size, 0);
	assert.equal(await spools.load('project-tail', 'display-spool'), null);
});

test('encoded prefixes and session manifests reload from existing IndexedDB stores', async () => {
	const indexedDB = createInstrumentedIndexedDB();
	const databaseName = uniqueName();
	const first = indexedStorageFixture(indexedDB, databaseName);
	let spool = await first.spools.create({
		projectId: 'project-reload', sessionId: 'session-reload', streamId: 'display-stream',
		spoolId: 'display-spool', sourceId: 'display-source', mimeType: 'video/webm',
	});
	spool = (await first.spools.append(spool, {
		sequence: 0, ptsMicroseconds: 0, durationMicroseconds: 1_000,
		payload: new Blob([Uint8Array.of(4, 5, 6)]),
	})).spool;
	const session = manifest({
		sessionId: 'session-reload',
		projectFence: { projectId: 'project-reload', baseRevision: 1, baseSha256: 'cd'.repeat(32) },
		streams: [{
			streamId: 'display-stream', role: 'display', required: true, playability: 'unknown',
			storage: {
				kind: 'encoded-media', spoolId: spool.spoolId, spoolToken: spool.spoolToken,
				sourceId: spool.sourceId, mimeType: spool.mimeType, packetCount: spool.packetCount,
				chunkCount: spool.chunkCount, byteLength: spool.byteLength,
			},
		}],
	});
	await first.manifests.create(session);
	const expectedChunks = await collect(first.spools.read(spool));
	await first.close();

	const reopened = indexedStorageFixture(indexedDB, databaseName);
	const loaded = await reopened.spools.load('project-reload', 'display-spool');
	assert.ok(loaded);
	assert.deepEqual(await collect(reopened.spools.read(loaded)), expectedChunks);
	assert.deepEqual(await reopened.manifests.load('project-reload', 'session-reload'), session);
	await reopened.close();
});

test('encoded capture storage rejects stale ownership, invalid packet order, and foreign chunks', async () => {
	const fixture = storageFixture();
	let spool = await fixture.spools.create({
		projectId: 'project-validation', sessionId: 'session-validation', streamId: 'camera-stream',
		spoolId: 'camera-spool', sourceId: 'camera-source', mimeType: 'video/webm',
	});
	await assert.rejects(fixture.spools.append(spool, {
		sequence: 1, ptsMicroseconds: 0, durationMicroseconds: 1,
		payload: new Blob([Uint8Array.of(1)]),
	}), /next contiguous packet/u);
	const stale = spool;
	spool = (await fixture.spools.append(spool, {
		sequence: 0, ptsMicroseconds: 0, durationMicroseconds: 1_000,
		payload: new Blob([Uint8Array.of(1)]),
	})).spool;
	await assert.rejects(fixture.spools.append(stale, {
		sequence: 0, ptsMicroseconds: 0, durationMicroseconds: 1_000,
		payload: new Blob([Uint8Array.of(2)]),
	}), /ownership changed/u);
	const [storedKey, storedValue] = fixture.memory.mediaAssetChunks.entries().next().value!;
	fixture.memory.mediaAssetChunks.set(storedKey, {
		...storedValue as Record<string, unknown>, sourceId: 'foreign-source',
	});
	await assert.rejects(collect(fixture.spools.read(spool)), /ownership is invalid/u);
	await assert.rejects(fixture.spools.delete(spool), /ownership does not match/u);
});

test('capture session manifests validate mixed stream prefixes and recovery decisions', () => {
	const capturing = manifest();
	assert.deepEqual(normalizeFramescaperCaptureSessionManifest(capturing), capturing);
	assert.throws(() => normalizeFramescaperCaptureSessionManifest({
		...capturing, unowned: true,
	}), /invalid closed shape/u);
	assert.throws(() => normalizeFramescaperCaptureSessionManifest({
		...capturing, projectFence: { ...capturing.projectFence, unowned: true },
	}), /invalid closed shape/u);
	assert.throws(() => normalizeFramescaperCaptureSessionManifest({
		...capturing,
		streams: [capturing.streams[0], { ...capturing.streams[0], streamId: 'duplicate-camera' }],
	}), /source roles must be unique/u);
	assert.throws(() => decideFramescaperCaptureRecovery(capturing, 'recover'), /sealed session/u);

	const sealed = manifest({
		state: 'sealed',
		streams: capturing.streams.map((stream) => ({ ...stream, playability: 'unknown' })),
	});
	assert.throws(
		() => decideFramescaperCaptureRecovery(sealed, 'import-as-is'),
		/playable acknowledged prefix/u,
	);
	const playable = manifest({
		state: 'sealed',
		streams: sealed.streams.map((stream) => ({ ...stream, playability: 'playable' })),
	});
	const importing = decideFramescaperCaptureRecovery(playable, 'import-as-is', 5);
	assert.equal(importing.state, 'finalizing');
	assert.equal(importing.recoveryDecision, 'import-as-is');
	const deleting = decideFramescaperCaptureRecovery(sealed, 'delete', 5);
	assert.equal(deleting.state, 'discarded');
	assert.equal(deleting.recoveryDecision, 'delete');
});

test('capture manifest repository CAS permits only forward state and acknowledged-prefix transitions', async () => {
	const fixture = storageFixture();
	const repository = new FramescaperCaptureSessionManifestRepository(fixture.values);
	const initial = await repository.create(manifest());
	const advanced = manifest({
		updatedAt: 2,
		streams: initial.streams.map((stream) => stream.storage.kind === 'encoded-media'
			? { ...stream, storage: {
				...stream.storage, packetCount: 1, chunkCount: 1, byteLength: 3,
			} }
			: { ...stream, storage: {
				...stream.storage, frameCount: 480, chunkCount: 1,
			} }),
	});
	await repository.replace(initial, advanced);
	await assert.rejects(repository.replace(advanced, initial), /cannot move backward/u);
	const inconsistent = manifest({
		updatedAt: 3,
		streams: advanced.streams.map((stream) => stream.storage.kind === 'encoded-media'
			? { ...stream, storage: { ...stream.storage, packetCount: stream.storage.packetCount + 1 } }
			: stream),
	});
	await assert.rejects(repository.replace(advanced, inconsistent), /geometry changed inconsistently/u);
	await assert.rejects(repository.replace(initial, advanced), /changed before replacement/u);

	const sealed = manifest({
		state: 'sealed', updatedAt: 4, streams: advanced.streams,
	});
	await repository.replace(advanced, sealed);
	const changedPrefix = manifest({
		state: 'sealed', updatedAt: 5,
		streams: sealed.streams.map((stream) => stream.storage.kind === 'encoded-media'
			? { ...stream, storage: { ...stream.storage, byteLength: stream.storage.byteLength + 1 } }
			: stream),
	});
	await assert.rejects(repository.replace(sealed, changedPrefix), /sealed acknowledged prefix/u);
	assert.deepEqual(await repository.listProject('project-session'), [sealed]);
	await repository.remove(sealed);
	assert.equal(await repository.load('project-session', 'session-one'), null);
});

function manifest(
	overrides: Partial<FramescaperCaptureSessionManifestV1> = {},
): FramescaperCaptureSessionManifestV1 {
	return {
		version: 1,
		sessionId: 'session-one',
		generation: 1,
		state: 'capturing',
		recoveryDecision: null,
		projectFence: {
			projectId: 'project-session', baseRevision: 3, baseSha256: 'ab'.repeat(32),
		},
		origin: {
			sequenceId: 'sequence-one', playheadMicroseconds: 2_000_000, destination: 'both',
		},
		clock: { monotonicOriginMicroseconds: 10_000, pauseSpans: [] },
		streams: [{
			streamId: 'camera-stream', role: 'camera', required: true, playability: 'unknown',
			storage: {
				kind: 'encoded-media', spoolId: 'camera-spool', spoolToken: 'camera-token',
				sourceId: 'camera-source', mimeType: 'video/webm', packetCount: 0,
				chunkCount: 0, byteLength: 0,
			},
		}, {
			streamId: 'microphone-stream', role: 'microphone', required: true, playability: 'unknown',
			storage: {
				kind: 'raw-pcm', spoolId: 'microphone-spool', spoolToken: 'microphone-token',
				sourceId: 'microphone-source', sampleRate: 48_000, channelCount: 1,
				frameCount: 0, chunkCount: 0,
			},
		}],
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

function storageFixture() {
	const memory = getMemoryDatabase(uniqueName());
	const port = { memory, database: async () => null };
	const values = new KeyValueRepository(port, 'analysis');
	const chunks = new MediaAssetChunkRecords(port);
	return {
		memory,
		values,
		chunks,
		spools: new EncodedCaptureSpoolRepository(values, chunks),
	};
}

function indexedStorageFixture(indexedDB: ReturnType<typeof createInstrumentedIndexedDB>, databaseName: string) {
	const memory = getMemoryDatabase(databaseName);
	const database = openDatabase(indexedDB as unknown as IDBFactory, databaseName);
	const port = { memory, database: async () => database };
	const values = new KeyValueRepository(port, 'analysis');
	return {
		spools: new EncodedCaptureSpoolRepository(values, new MediaAssetChunkRecords(port)),
		manifests: new FramescaperCaptureSessionManifestRepository(values),
		async close() { (await database).close(); },
	};
}

async function collect<Value>(values: AsyncIterable<Value>): Promise<Value[]> {
	const collected: Value[] = [];
	for await (const value of values) collected.push(value);
	return collected;
}

function uniqueName(): string {
	return `framescaper-capture-storage-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
