/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createFramescaperCaptureDurableSessionCoordinator,
	type CreateFramescaperCaptureDurableSessionRequest,
} from '../src/common/editor/controller/framescaper-capture-durable-session.ts';
import type { CaptureEncodedVideoPacket } from '../src/common/editor/framescaper-capture-domain.ts';
import { EncodedCaptureSpoolRepository } from '../src/common/editor/storage/encoded-capture-spool-repository.ts';
import { FramescaperCaptureSessionManifestRepository } from '../src/common/editor/storage/framescaper-capture-session-manifest-repository.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { MediaAssetChunkRecords } from '../src/common/editor/storage/media-asset-chunk-records.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { OpfsPreferredEncodedCaptureChunkPort } from '../src/common/editor/storage/opfs-preferred-encoded-capture-chunk-port.ts';
import { OpfsRepository } from '../src/common/editor/storage/opfs-repository.ts';
import { RawPcmSpoolRepository } from '../src/common/editor/storage/raw-pcm-spool-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';

const REFERENCE_KEY_PREFIX = 'framescaper-capture-opfs-chunk-v1:';

test('OPFS terminal deletion resumes after a reference CAS commits without acknowledgement', async () => {
	const fixture = opfsFixture();
	let rejectReferenceAcknowledgement = true;
	let stopBeforeReconciliation = false;
	const values = {
		async get(key: string) {
			if (stopBeforeReconciliation && key.startsWith(REFERENCE_KEY_PREFIX)) {
				stopBeforeReconciliation = false;
				throw new Error('process stopped after reference commit');
			}
			return fixture.values.get(key);
		},
		putIfAbsent: fixture.values.putIfAbsent.bind(fixture.values),
		putIfAbsentWhenCurrent: fixture.values.putIfAbsentWhenCurrent.bind(fixture.values),
		replaceIfCurrent: fixture.values.replaceIfCurrent.bind(fixture.values),
		replaceIfCurrentWhenCurrent: fixture.values.replaceIfCurrentWhenCurrent.bind(fixture.values),
		listByPrefix: fixture.values.listByPrefix.bind(fixture.values),
		async deleteIfCurrent(key: string, expected: unknown) {
			const deleted = await fixture.values.deleteIfCurrent(key, expected);
			if (deleted && key.startsWith(REFERENCE_KEY_PREFIX) && rejectReferenceAcknowledgement) {
				rejectReferenceAcknowledgement = false;
				stopBeforeReconciliation = true;
				throw new Error('reference deletion acknowledgement lost');
			}
			return deleted;
		},
	};
	const chunks = fixture.chunks(values, fixture.directory);
	const repository = new EncodedCaptureSpoolRepository(values, chunks, { createId: () => 'terminal-opfs' });
	let spool = await createSpool(repository, 'terminal');
	spool = await append(repository, spool, 0);
	spool = await acknowledge(repository, spool);
	spool = await append(repository, spool, 1);
	spool = await acknowledge(repository, spool);

	await assert.rejects(repository.delete(spool), /process stopped after reference commit/u);
	assert.equal((await repository.load('project-terminal', 'spool-terminal'))?.state, 'deleting');
	assert.equal(fixture.files.size, 0, 'all bodies must be absent before the first reference can be removed');

	const reopenedChunks = fixture.chunks(fixture.values, fixture.directory);
	const reopened = new EncodedCaptureSpoolRepository(fixture.values, reopenedChunks);
	const deleting = await reopened.load('project-terminal', 'spool-terminal');
	assert.ok(deleting);
	await reopened.delete(deleting);
	assert.equal(await reopened.load('project-terminal', 'spool-terminal'), null);
	assert.equal(await reopenedChunks.backend(deleting.spoolToken), null);
	assert.equal(fixture.files.size, 0);
});

test('OPFS tail repair retains durable references until a failed body deletion can retry', async () => {
	const fixture = opfsFixture();
	const removalFailure = new Error('OPFS body removal failed');
	const failures = { remaining: 1, error: removalFailure };
	const failingDirectory = opfsDirectory(fixture.files, failures);
	const chunks = fixture.chunks(fixture.values, failingDirectory);
	const repository = new EncodedCaptureSpoolRepository(fixture.values, chunks, { createId: () => 'tail-opfs' });
	let acknowledged = await createSpool(repository, 'tail');
	acknowledged = await append(repository, acknowledged, 0);
	acknowledged = await acknowledge(repository, acknowledged);
	const advanced = await append(repository, acknowledged, 1);

	await assert.rejects(
		repository.restoreAcknowledgedPrefix(advanced, acknowledged),
		(error: unknown) => error === removalFailure,
	);
	assert.equal(fixture.files.size, 2, 'a failed physical deletion must keep its retry reference');

	const reopenedChunks = fixture.chunks(fixture.values, fixture.directory);
	const reopened = new EncodedCaptureSpoolRepository(fixture.values, reopenedChunks);
	const recovered = await reopened.load('project-tail', 'spool-tail');
	assert.deepEqual(recovered, acknowledged, 'fresh storage load must resume its durable tail intent');
	assert.equal(fixture.files.size, 1);
	assert.equal((await collect(reopened.read(recovered))).length, 1);
	const retried = await acknowledge(reopened, await append(reopened, recovered, 1));
	assert.equal((await collect(reopened.read(retried))).length, 2, 'the reclaimed tail index must be reusable');
	await reopened.delete(retried);
	assert.equal(fixture.files.size, 0);
});

test('a fresh coordinator resumes durable OPFS tail intent before the failed packet is reappended', async () => {
	const memory = getMemoryDatabase(uniqueName());
	const port = { memory, database: async () => null };
	const values = new KeyValueRepository(port, 'analysis');
	const files = new Map<string, Blob>();
	const failures = { remaining: 0, error: new Error('OPFS tail removal stopped') };
	const encoded = new EncodedCaptureSpoolRepository(values, new OpfsPreferredEncodedCaptureChunkPort({
		values,
		opfs: new OpfsRepository({ preferOpfs: true, opfsRoot: opfsDirectory(files, failures) }),
		fallback: new MediaAssetChunkRecords(port),
	}));
	const raw = new RawPcmSpoolRepository(values, new SourceRecordRepository(port));
	const manifests = new FramescaperCaptureSessionManifestRepository(values);
	let rejectManifest = false;
	let now = 100;
	const first = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: encoded,
		rawPcmSpools: raw,
		manifests: manifestPort(manifests, async (expected, next) => {
			if (rejectManifest) throw new Error('manifest append refused');
			return manifests.replace(expected, next);
		}),
		now: () => now++,
		createId: (() => { let id = 0; return () => `coordinator-tail-${String(id++)}`; })(),
	});
	const session = await first.create(coordinatorRequest());
	await session.append(coordinatorPacket(0));
	rejectManifest = true;
	failures.remaining = 1;
	await assert.rejects(session.append(coordinatorPacket(1)), /manifest acknowledgement and spool-prefix repair/u);
	assert.equal(files.size, 2);

	const reopenedEncoded = new EncodedCaptureSpoolRepository(values, new OpfsPreferredEncodedCaptureChunkPort({
		values,
		opfs: new OpfsRepository({ preferOpfs: true, opfsRoot: opfsDirectory(files) }),
		fallback: new MediaAssetChunkRecords(port),
	}));
	const reopened = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: reopenedEncoded,
		rawPcmSpools: new RawPcmSpoolRepository(values, new SourceRecordRepository(port)),
		manifests,
		now: () => now++,
	});
	const recovered = await reopened.load('project-coordinator-tail', 'session-coordinator-tail');
	assert.ok(recovered);
	assert.equal(files.size, 1, 'fresh coordinator load must drain the exact failed packet tail');
	await recovered.append(coordinatorPacket(1));
	assert.equal(recovered.manifest.streams[0]!.storage.kind, 'encoded-media');
	assert.equal(recovered.manifest.streams[0]!.storage.chunkCount, 2);
	assert.equal(files.size, 2, 'the failed packet index must be reusable after restart');
	await recovered.delete();
});

function manifestPort(
	repository: FramescaperCaptureSessionManifestRepository,
	replace: FramescaperCaptureSessionManifestRepository['replace'],
) {
	return {
		create: repository.create.bind(repository),
		load: repository.load.bind(repository),
		listProject: repository.listProject.bind(repository),
		replace,
		remove: repository.remove.bind(repository),
		createCreation: repository.createCreation.bind(repository),
		listCreations: repository.listCreations.bind(repository),
		loadCreation: repository.loadCreation.bind(repository),
		publishCreation: repository.publishCreation.bind(repository),
		removeCreation: repository.removeCreation.bind(repository),
		replaceCreation: repository.replaceCreation.bind(repository),
	};
}

function coordinatorRequest(): CreateFramescaperCaptureDurableSessionRequest {
	return {
		sessionId: 'session-coordinator-tail',
		generation: 1,
		projectFence: {
			projectId: 'project-coordinator-tail', baseRevision: 1, baseSha256: 'ab'.repeat(32),
		},
		origin: { sequenceId: 'sequence-tail', playheadMicroseconds: 0, destination: 'both' },
		monotonicOriginMicroseconds: 0,
		streams: [{
			kind: 'encoded-media', role: 'camera', required: true,
			streamId: 'camera-stream', spoolId: 'camera-spool',
			sourceId: 'camera-source', mimeType: 'video/webm',
		}],
	};
}

function coordinatorPacket(sequence: number): CaptureEncodedVideoPacket {
	const bytes = Uint8Array.of(sequence + 1);
	return {
		kind: 'encoded-video', sessionId: 'session-coordinator-tail', streamId: 'camera-stream',
		role: 'camera', sequence, presentationTimeUs: sequence * 1_000, durationUs: 1_000,
		receiptTimeMs: sequence + 1, droppedBefore: { value: null, confidence: 'unavailable' },
		byteLength: bytes.byteLength, bytes, mimeType: 'video/webm', keyFrame: null,
	};
}

function opfsFixture() {
	const memory = getMemoryDatabase(uniqueName());
	const port = { memory, database: async () => null };
	const values = new KeyValueRepository(port, 'analysis');
	const files = new Map<string, Blob>();
	const directory = opfsDirectory(files);
	return {
		values,
		files,
		directory,
		chunks(chunkValues: Pick<KeyValueRepository,
			'get' | 'putIfAbsent' | 'replaceIfCurrent' | 'deleteIfCurrent'
		>, root: FileSystemDirectoryHandle) {
			return new OpfsPreferredEncodedCaptureChunkPort({
				values: chunkValues,
				opfs: new OpfsRepository({ preferOpfs: true, opfsRoot: root }),
				fallback: new MediaAssetChunkRecords(port),
			});
		},
	};
}

async function createSpool(repository: EncodedCaptureSpoolRepository, id: string) {
	return repository.create({
		projectId: `project-${id}`, sessionId: `session-${id}`, streamId: 'camera-stream',
		spoolId: `spool-${id}`, sourceId: `source-${id}`, mimeType: 'video/webm',
	});
}

async function append(
	repository: EncodedCaptureSpoolRepository,
	spool: Awaited<ReturnType<EncodedCaptureSpoolRepository['create']>>,
	sequence: number,
) {
	return (await repository.append(spool, {
		sequence,
		ptsMicroseconds: sequence * 1_000,
		durationMicroseconds: 1_000,
		payload: new Blob([Uint8Array.of(sequence + 1)]),
	})).spool;
}

function acknowledge(
	repository: EncodedCaptureSpoolRepository,
	record: Awaited<ReturnType<EncodedCaptureSpoolRepository['create']>>,
) {
	return repository.reconcileAppend(record, {
		packetCount: record.packetCount, chunkCount: record.chunkCount, byteLength: record.byteLength,
		firstPtsMicroseconds: record.firstPtsMicroseconds,
		lastPtsEndMicroseconds: record.lastPtsEndMicroseconds,
	});
}

async function collect<Value>(values: AsyncIterable<Value>): Promise<Value[]> {
	const collected: Value[] = [];
	for await (const value of values) collected.push(value);
	return collected;
}

function opfsDirectory(
	files: Map<string, Blob>,
	failures: { remaining: number; readonly error: Error } | null = null,
): FileSystemDirectoryHandle {
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
			if (failures && failures.remaining > 0) {
				failures.remaining -= 1;
				throw failures.error;
			}
			if (!files.delete(path)) throw new DOMException('missing', 'NotFoundError');
		},
	};
	return directory as unknown as FileSystemDirectoryHandle;
}

function uniqueName(): string {
	return `framescaper-capture-opfs-cleanup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
