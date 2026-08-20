/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperCaptureDurableSessionCoordinator } from '../src/common/editor/controller/framescaper-capture-durable-session.ts';
import { EncodedCaptureSpoolRepository } from '../src/common/editor/storage/encoded-capture-spool-repository.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { MediaAssetChunkRecords } from '../src/common/editor/storage/media-asset-chunk-records.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { RawPcmSpoolRepository } from '../src/common/editor/storage/raw-pcm-spool-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';
import {
	createFixture,
	encodedOnlySessionRequest,
	encodedPacket,
	manifestPort,
	rawOnlySessionRequest,
	rawPacket,
	sessionRequest,
} from './helpers/framescaper-capture-creation-recovery-fixture.ts';

const APPEND_INTENT_PREFIX = 'framescaper-capture-spool-append-intent-v1:';

test('encoded rollback and passive tail recovery exclude scans and same-index appends', async () => {
	await encodedRollbackExcludesConcurrentWork();
	await encodedPassiveRecoveryExcludesConcurrentWork();
});

test('raw rollback and passive tail recovery exclude scans and same-index appends', async () => {
	await rawRollbackExcludesConcurrentWork();
	await rawPassiveRecoveryExcludesConcurrentWork();
});

test('session locking keeps live metadata commits authoritative through manifest publication', async (t) => {
	for (const kind of ['encoded', 'raw'] as const) {
		await t.test(kind, async () => {
			const fixture = createFixture();
			const publication = deferred<void>();
			const started = deferred<void>();
			const manifests = manifestPort(fixture.manifests);
			const blockedManifests = {
				...manifests,
				async replace(expected: Parameters<typeof manifests.replace>[0], next: Parameters<typeof manifests.replace>[1]) {
					started.resolve();
					await publication.promise;
					return manifests.replace(expected, next);
				},
			};
			const writer = createFramescaperCaptureDurableSessionCoordinator({
				encodedSpools: fixture.encodedSpools, rawPcmSpools: fixture.rawPcmSpools,
				manifests: blockedManifests, now: () => 100,
			});
			const reader = createFramescaperCaptureDurableSessionCoordinator({
				encodedSpools: fixture.encodedSpools, rawPcmSpools: fixture.rawPcmSpools,
				manifests: fixture.manifests, now: () => 101,
			});
			const session = await writer.create(kind === 'encoded'
				? encodedOnlySessionRequest()
				: rawOnlySessionRequest());
			const appending = session.append(kind === 'encoded' ? encodedPacket() : rawPacket());
			await started.promise;
			const oldManifest = await fixture.manifests.load('project-capture', 'session-capture');
			assert.equal(oldManifest?.streams[0]?.storage.chunkCount, 0);
			const passiveRecord = kind === 'encoded'
				? await fixture.encodedSpools.load('project-capture', 'camera-spool')
				: await fixture.rawPcmSpools.load('project-capture', 'microphone-spool');
			assert.equal(passiveRecord?.chunkCount, 1);
			assert.equal(intentCount(fixture.memory.analysis), 1);
			let loaded = false;
			const loading = reader.load('project-capture', 'session-capture')
				.then((value) => { loaded = true; return value; });
			await tick();
			assert.equal(loaded, false, 'fresh recovery must wait through manifest settlement');

			publication.resolve();
			const published = await appending;
			const reopened = await loading;
			assert.ok(reopened);
			assert.deepEqual(reopened.manifest, published);
			assert.equal(published.streams[0]?.storage.chunkCount, 1);
			assert.equal(kind === 'encoded'
				? fixture.memory.mediaAssetChunks.size
				: fixture.memory.sourceChunks.size, 1);
		});
	}
});

test('a stale coordinator cannot append another stream behind an in-flight session publication', async () => {
	const fixture = createFixture();
	const publication = deferred<void>();
	const started = deferred<void>();
	const manifests = manifestPort(fixture.manifests);
	const writer = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools, rawPcmSpools: fixture.rawPcmSpools,
		manifests: {
			...manifests,
			async replace(expected, next) {
				started.resolve();
				await publication.promise;
				return manifests.replace(expected, next);
			},
		},
		now: () => 100,
	});
	const reader = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools, rawPcmSpools: fixture.rawPcmSpools,
		manifests: fixture.manifests, now: () => 101,
	});
	const first = await writer.create(sessionRequest());
	const stale = await reader.load('project-capture', 'session-capture');
	assert.ok(stale);
	const encodedAppend = first.append(encodedPacket());
	await started.promise;
	const staleRawAppend = stale.append(rawPacket());
	await tick();
	assert.equal(fixture.memory.sourceChunks.size, 0);

	publication.resolve();
	const encodedManifest = await encodedAppend;
	await assert.rejects(staleRawAppend, /manifest changed before its next durable operation/u);
	assert.equal(fixture.memory.sourceChunks.size, 0);
	assert.equal(encodedManifest.streams[0]?.storage.chunkCount, 1);
	const fresh = await reader.load('project-capture', 'session-capture');
	assert.ok(fresh);
	const complete = await fresh.append(rawPacket());
	assert.equal(complete.streams[0]?.storage.chunkCount, 1);
	assert.equal(complete.streams[1]?.storage.chunkCount, 1);
	assert.equal(fixture.memory.mediaAssetChunks.size, 1);
	assert.equal(fixture.memory.sourceChunks.size, 1);
});

test('recovery inventory ignores its stale list snapshot after acquiring the session lock', async () => {
	const fixture = createFixture();
	const writer = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools, rawPcmSpools: fixture.rawPcmSpools,
		manifests: fixture.manifests, now: () => 100,
	});
	const session = await writer.create(encodedOnlySessionRequest());
	const listed = deferred<void>();
	const proceed = deferred<void>();
	const manifests = manifestPort(fixture.manifests);
	const recovery = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools, rawPcmSpools: fixture.rawPcmSpools,
		manifests: {
			...manifests,
			async listProject(projectId) {
				const snapshot = await manifests.listProject(projectId);
				listed.resolve();
				await proceed.promise;
				return snapshot;
			},
		},
		now: () => 101,
	});
	const inventory = recovery.recoveryInventory('project-capture');
	await listed.promise;
	const published = await session.append(encodedPacket());
	proceed.resolve();
	const [entry] = await inventory;
	assert.deepEqual(entry?.manifest, published);
	assert.equal(entry?.storageStatus, 'exact');
	assert.equal(fixture.memory.mediaAssetChunks.size, 1);
});

test('manifest CAS commit-then-throw is reconciled as append success', async (t) => {
	for (const kind of ['encoded', 'raw'] as const) {
		await t.test(kind, async () => {
			const fixture = createFixture();
			const manifests = manifestPort(fixture.manifests);
			let throwAcknowledgement = true;
			const coordinator = createFramescaperCaptureDurableSessionCoordinator({
				encodedSpools: fixture.encodedSpools, rawPcmSpools: fixture.rawPcmSpools,
				manifests: {
					...manifests,
					async replace(expected, next) {
						const replaced = await manifests.replace(expected, next);
						if (throwAcknowledgement) {
							throwAcknowledgement = false;
							throw new Error('manifest CAS acknowledgement lost');
						}
						return replaced;
					},
				},
				now: () => 100,
			});
			const session = await coordinator.create(kind === 'encoded'
				? encodedOnlySessionRequest()
				: rawOnlySessionRequest());
			const published = await session.append(kind === 'encoded' ? encodedPacket() : rawPacket());
			assert.equal(published.streams[0]?.storage.chunkCount, 1);
			assert.equal(intentCount(fixture.memory.analysis), 0);
			assert.deepEqual(
				await fixture.manifests.load('project-capture', 'session-capture'), published,
			);
		});
	}
});

test('stale discarded inventory cannot retire a replacement generation with the same session ID', async () => {
	const fixture = createFixture();
	const base = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools, rawPcmSpools: fixture.rawPcmSpools,
		manifests: fixture.manifests, now: () => 100,
	});
	const oldSession = await base.create(encodedOnlySessionRequest());
	await oldSession.append(encodedPacket());
	const sealed = await oldSession.seal();
	const discarded = await fixture.manifests.replace(sealed, {
		...sealed, state: 'discarded', recoveryDecision: 'delete', updatedAt: 101,
	});
	const listed = deferred<void>();
	const proceed = deferred<void>();
	const manifests = manifestPort(fixture.manifests);
	const staleScanner = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools, rawPcmSpools: fixture.rawPcmSpools,
		manifests: {
			...manifests,
			async listProject(projectId) {
				const snapshot = await manifests.listProject(projectId);
				listed.resolve();
				await proceed.promise;
				return snapshot;
			},
		},
		now: () => 300,
	});
	const triggerRequest = {
		...encodedOnlySessionRequest(), sessionId: 'trigger-session',
		streams: encodedOnlySessionRequest().streams.map((stream) => ({
			...stream, spoolId: 'trigger-spool', sourceId: 'trigger-source',
		})),
	};
	const scanning = staleScanner.create(triggerRequest);
	await listed.promise;

	const cleanup = await base.load('project-capture', discarded.sessionId);
	assert.ok(cleanup);
	await cleanup.delete();
	const replacementRequest = {
		...encodedOnlySessionRequest(), generation: 2,
		streams: encodedOnlySessionRequest().streams.map((stream) => ({
			...stream, spoolId: 'replacement-spool', sourceId: 'replacement-source',
		})),
	};
	const replacement = await base.create(replacementRequest);
	proceed.resolve();
	await scanning;

	assert.equal(replacement.manifest.generation, 2);
	assert.deepEqual(
		await fixture.manifests.load('project-capture', 'session-capture'), replacement.manifest,
	);
	assert.ok(await fixture.encodedSpools.load('project-capture', 'replacement-spool'));
});

async function encodedRollbackExcludesConcurrentWork(): Promise<void> {
	const fixture = encodedFixture('encoded-rollback-lock');
	const { acknowledged, advanced } = await encodedAdvanced(fixture.repository);
	const deletion = deferred<void>();
	const started = deferred<void>();
	let firstDeletion = true;
	const rollback = new EncodedCaptureSpoolRepository(fixture.values, {
		write: fixture.media.write.bind(fixture.media), chunks: fixture.media.chunks.bind(fixture.media),
		deleteOwned: fixture.media.deleteOwned.bind(fixture.media),
		async deleteTailOwned(token, sourceId, firstIndex) {
			if (firstDeletion) {
				firstDeletion = false;
				started.resolve();
				await deletion.promise;
			}
			return fixture.media.deleteTailOwned(token, sourceId, firstIndex);
		},
	});
	const restoring = rollback.restoreAcknowledgedPrefix(advanced, acknowledged);
	await started.promise;
	let scanned = false;
	const scan = fixture.repository.listAll().then((records) => { scanned = true; return records; });
	const competing = appendEncoded(fixture.repository, acknowledged, 1, 9);
	await tick();
	assert.equal(scanned, false);
	assert.equal(fixture.memory.mediaAssetChunks.size, 2);

	deletion.resolve();
	assert.deepEqual(await restoring, acknowledged);
	const [records, retried] = await Promise.all([scan, competing]);
	assert.ok(records.length === 1 && (
		JSON.stringify(records[0]) === JSON.stringify(acknowledged)
		|| JSON.stringify(records[0]) === JSON.stringify(retried)
	));
	await acknowledgeEncoded(fixture.repository, retried);
	assert.equal(fixture.memory.mediaAssetChunks.size, 2);
}

async function encodedPassiveRecoveryExcludesConcurrentWork(): Promise<void> {
	const fixture = encodedFixture('encoded-passive-lock');
	const { acknowledged, advanced } = await encodedAdvanced(fixture.repository);
	const stopped = new EncodedCaptureSpoolRepository(fixture.values, {
		write: fixture.media.write.bind(fixture.media), chunks: fixture.media.chunks.bind(fixture.media),
		deleteOwned: fixture.media.deleteOwned.bind(fixture.media),
		async deleteTailOwned() { throw new Error('encoded rollback stopped'); },
	});
	await assert.rejects(stopped.restoreAcknowledgedPrefix(advanced, acknowledged), /rollback stopped/u);

	const deletion = deferred<void>();
	const started = deferred<void>();
	let deletions = 0;
	const recovering = new EncodedCaptureSpoolRepository(fixture.values, {
		write: fixture.media.write.bind(fixture.media), chunks: fixture.media.chunks.bind(fixture.media),
		deleteOwned: fixture.media.deleteOwned.bind(fixture.media),
		async deleteTailOwned(token, sourceId, firstIndex) {
			deletions += 1;
			if (deletions === 2) {
				started.resolve();
				await deletion.promise;
			}
			return fixture.media.deleteTailOwned(token, sourceId, firstIndex);
		},
	});
	const loading = recovering.listAll();
	await started.promise;
	const competing = appendEncoded(fixture.repository, acknowledged, 1, 8);
	await tick();
	assert.equal(fixture.memory.mediaAssetChunks.size, 1);

	deletion.resolve();
	const [records, retried] = await Promise.all([loading, competing]);
	assert.ok(records.length === 1 && (
		JSON.stringify(records[0]) === JSON.stringify(acknowledged)
		|| JSON.stringify(records[0]) === JSON.stringify(retried)
	));
	await acknowledgeEncoded(fixture.repository, retried);
	assert.equal(fixture.memory.mediaAssetChunks.size, 2);
}

async function rawRollbackExcludesConcurrentWork(): Promise<void> {
	const fixture = rawFixture('raw-rollback-lock');
	const { acknowledged, advanced } = await rawAdvanced(fixture.repository);
	const deletion = deferred<void>();
	const started = deferred<void>();
	let firstDeletion = true;
	const rollback = new RawPcmSpoolRepository(fixture.values, {
		writeChunk: fixture.source.writeChunk.bind(fixture.source), chunk: fixture.source.chunk.bind(fixture.source),
		deleteChunks: fixture.source.deleteChunks.bind(fixture.source),
		async deleteChunksFrom(token, firstIndex) {
			if (firstDeletion) {
				firstDeletion = false;
				started.resolve();
				await deletion.promise;
			}
			await fixture.source.deleteChunksFrom(token, firstIndex);
		},
	});
	const restoring = rollback.restoreAcknowledgedPrefix(advanced, acknowledged);
	await started.promise;
	let loaded = false;
	const load = fixture.repository.load(acknowledged.projectId, acknowledged.spoolId)
		.then((record) => { loaded = true; return record; });
	const competing = fixture.repository.append(acknowledged, [Float32Array.of(9)], acknowledged.data);
	await tick();
	assert.equal(loaded, false);
	assert.equal(fixture.memory.sourceChunks.size, 2);

	deletion.resolve();
	assert.deepEqual(await restoring, acknowledged);
	const [loadedRecord, retried] = await Promise.all([load, competing]);
	assert.ok(JSON.stringify(loadedRecord) === JSON.stringify(acknowledged)
		|| JSON.stringify(loadedRecord) === JSON.stringify(retried));
	await acknowledgeRaw(fixture.repository, retried);
	assert.equal(fixture.memory.sourceChunks.size, 2);
}

async function rawPassiveRecoveryExcludesConcurrentWork(): Promise<void> {
	const fixture = rawFixture('raw-passive-lock');
	const { acknowledged, advanced } = await rawAdvanced(fixture.repository);
	const stopped = new RawPcmSpoolRepository(fixture.values, {
		writeChunk: fixture.source.writeChunk.bind(fixture.source), chunk: fixture.source.chunk.bind(fixture.source),
		deleteChunks: fixture.source.deleteChunks.bind(fixture.source),
		async deleteChunksFrom() { throw new Error('raw rollback stopped'); },
	});
	await assert.rejects(stopped.restoreAcknowledgedPrefix(advanced, acknowledged), /rollback stopped/u);

	const deletion = deferred<void>();
	const started = deferred<void>();
	let deletions = 0;
	const recovering = new RawPcmSpoolRepository(fixture.values, {
		writeChunk: fixture.source.writeChunk.bind(fixture.source), chunk: fixture.source.chunk.bind(fixture.source),
		deleteChunks: fixture.source.deleteChunks.bind(fixture.source),
		async deleteChunksFrom(token, firstIndex) {
			deletions += 1;
			if (deletions === 2) {
				started.resolve();
				await deletion.promise;
			}
			await fixture.source.deleteChunksFrom(token, firstIndex);
		},
	});
	const loading = recovering.load(acknowledged.projectId, acknowledged.spoolId);
	await started.promise;
	const competing = fixture.repository.append(acknowledged, [Float32Array.of(8)], acknowledged.data);
	await tick();
	assert.equal(fixture.memory.sourceChunks.size, 1);

	deletion.resolve();
	const [loadedRecord, retried] = await Promise.all([loading, competing]);
	assert.ok(JSON.stringify(loadedRecord) === JSON.stringify(acknowledged)
		|| JSON.stringify(loadedRecord) === JSON.stringify(retried));
	await acknowledgeRaw(fixture.repository, retried);
	assert.equal(fixture.memory.sourceChunks.size, 2);
}

function encodedFixture(id: string) {
	const memory = getMemoryDatabase(uniqueName(id));
	const port = { memory, database: async () => null };
	const values = new KeyValueRepository(port, 'analysis');
	const media = new MediaAssetChunkRecords(port);
	return { memory, values, media, repository: new EncodedCaptureSpoolRepository(values, media) };
}

async function encodedAdvanced(repository: EncodedCaptureSpoolRepository) {
	let acknowledged = await repository.create({
		projectId: 'project-lock', sessionId: 'session-lock', streamId: 'camera-stream',
		spoolId: 'encoded-lock', sourceId: 'source-lock', mimeType: 'video/webm',
	});
	acknowledged = await appendEncoded(repository, acknowledged, 0, 1);
	acknowledged = await acknowledgeEncoded(repository, acknowledged);
	const advanced = await appendEncoded(repository, acknowledged, 1, 2);
	return { acknowledged, advanced };
}

function appendEncoded(
	repository: EncodedCaptureSpoolRepository,
	record: Awaited<ReturnType<EncodedCaptureSpoolRepository['create']>>,
	sequence: number,
	byte: number,
) {
	return repository.append(record, {
		sequence, ptsMicroseconds: sequence * 1_000, durationMicroseconds: 1_000,
		payload: new Blob([Uint8Array.of(byte)]),
	}).then(({ spool }) => spool);
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

function rawFixture(id: string) {
	const memory = getMemoryDatabase(uniqueName(id));
	const port = { memory, database: async () => null };
	const values = new KeyValueRepository(port, 'analysis');
	const source = new SourceRecordRepository(port);
	return { memory, values, source, repository: new RawPcmSpoolRepository(values, source) };
}

async function rawAdvanced(repository: RawPcmSpoolRepository) {
	let acknowledged = await repository.createFramescaper({
		projectId: 'project-lock', spoolId: 'raw-lock', spoolToken: 'raw-token-lock',
		sampleRate: 48_000, channelCount: 1, chunkFrames: 8,
		data: { version: 1, kind: 'framescaper-capture-raw-pcm', sessionId: 'session-lock',
			streamId: 'microphone-stream', sourceId: 'microphone-source', role: 'microphone' },
	});
	acknowledged = await repository.append(acknowledged, [Float32Array.of(1)], acknowledged.data);
	acknowledged = await acknowledgeRaw(repository, acknowledged);
	const advanced = await repository.append(acknowledged, [Float32Array.of(2, 3)], acknowledged.data);
	return { acknowledged, advanced };
}

function acknowledgeRaw(
	repository: RawPcmSpoolRepository,
	record: Awaited<ReturnType<RawPcmSpoolRepository['createFramescaper']>>,
) {
	return repository.reconcileAppend(record, { frameCount: record.frameCount, chunkCount: record.chunkCount });
}

function deferred<Value>() {
	let resolve!: (value: Value | PromiseLike<Value>) => void;
	const promise = new Promise<Value>((accept) => { resolve = accept; });
	return { promise, resolve: resolve as Value extends void ? () => void : typeof resolve };
}

async function tick(): Promise<void> { await Promise.resolve(); await Promise.resolve(); }
function intentCount(values: Map<string, unknown>): number {
	return [...values.keys()].filter((key) => key.startsWith(APPEND_INTENT_PREFIX)).length;
}
function uniqueName(id: string): string {
	return `${id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
