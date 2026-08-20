/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	CaptureEncodedVideoPacket,
	CapturePcmAudioPacket,
} from '../src/common/editor/framescaper-capture-domain.ts';
import {
	createFramescaperCaptureDurableSessionCoordinator,
	type CreateFramescaperCaptureDurableSessionRequest,
} from '../src/common/editor/controller/framescaper-capture-durable-session.ts';
import type { FramescaperCaptureSessionManifestV1 } from '../src/common/editor/framescaper-capture-session-manifest.ts';
import { EncodedCaptureSpoolRepository } from '../src/common/editor/storage/encoded-capture-spool-repository.ts';
import { FramescaperCaptureSessionManifestRepository } from '../src/common/editor/storage/framescaper-capture-session-manifest-repository.ts';
import { KeyValueRepository } from '../src/common/editor/storage/key-value-repository.ts';
import { MediaAssetChunkRecords } from '../src/common/editor/storage/media-asset-chunk-records.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import { RawPcmSpoolRepository } from '../src/common/editor/storage/raw-pcm-spool-repository.ts';
import { SourceRecordRepository } from '../src/common/editor/storage/source-record-repository.ts';

test('durable capture preregisters every spool before publishing its capturing manifest', async () => {
	const fixture = createFixture();
	const operations: string[] = [];
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: {
			...encodedPort(fixture.encodedSpools),
			async create(request) {
				operations.push(`spool:${request.streamId}`);
				return fixture.encodedSpools.create(request);
			},
		},
		rawPcmSpools: {
			...rawPcmPort(fixture.rawPcmSpools),
			async create(request) {
				operations.push(`spool:${request.spoolId}`);
				return fixture.rawPcmSpools.create(request);
			},
		},
		manifests: {
			...manifestPort(fixture.manifests),
			async create(value) {
				operations.push('manifest');
				assert.ok(await fixture.encodedSpools.load('project-capture', 'camera-spool'));
				assert.ok(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'));
				return fixture.manifests.create(value);
			},
		},
		now: () => 100,
	});

	const session = await coordinator.create(sessionRequest());

	assert.deepEqual(operations, ['spool:camera-stream', 'spool:microphone-spool', 'manifest']);
	assert.equal(session.manifest.state, 'capturing');
	assert.deepEqual(session.manifest.streams.map(({ storage }) => (
		storage.kind === 'encoded-media'
			? [storage.packetCount, storage.chunkCount, storage.byteLength]
			: [storage.frameCount, storage.chunkCount]
	)), [[0, 0, 0], [0, 0]]);
	assert.deepEqual(
		await fixture.manifests.load('project-capture', 'session-capture'),
		session.manifest,
	);
});

test('a rejected manifest publication rolls back every preregistered spool', async () => {
	const fixture = createFixture();
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: fixture.rawPcmSpools,
		manifests: {
			...manifestPort(fixture.manifests),
			async create() { throw new Error('manifest unavailable'); },
		},
		now: () => 100,
	});

	await assert.rejects(coordinator.create(sessionRequest()), /manifest unavailable/u);
	assert.equal(await fixture.encodedSpools.load('project-capture', 'camera-spool'), null);
	assert.equal(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'), null);
	assert.equal(fixture.memory.mediaAssetChunks.size, 0);
	assert.equal(fixture.memory.sourceChunks.size, 0);
});

test('durable capture serializes mixed appends and deinterleaves acknowledged PCM', async () => {
	const fixture = createFixture();
	const session = await fixture.coordinator.create(sessionRequest());
	const video = videoPacket();
	const audio = pcmPacket();

	await Promise.all([session.append(video), session.append(audio)]);

	const manifest = session.manifest;
	const encoded = manifest.streams[0]!.storage;
	const pcm = manifest.streams[1]!.storage;
	assert.equal(encoded.kind, 'encoded-media');
	assert.deepEqual(
		[encoded.packetCount, encoded.chunkCount, encoded.byteLength],
		[1, 1, video.byteLength],
	);
	assert.equal(pcm.kind, 'raw-pcm');
	assert.deepEqual([pcm.frameCount, pcm.chunkCount], [2, 1]);
	const pcmSpool = await fixture.rawPcmSpools.load('project-capture', 'microphone-spool');
	assert.ok(pcmSpool);
	const stored = await fixture.rawPcmSpools.chunk(pcmSpool, 0);
	assert.deepEqual([...stored.channels[0]!], [1, 2]);
	assert.deepEqual([...stored.channels[1]!], [10, 20]);
	assert.deepEqual(await fixture.manifests.load('project-capture', 'session-capture'), manifest);

	await assert.rejects(session.append({
		...videoPacket({ sequence: 1 }),
		presentationTimeUs: 2_000,
	}), /contiguous presentation time/u);
	await assert.rejects(session.append({
		...pcmPacket({ sequence: 1 }),
		presentationTimeUs: 44,
	}), /contiguous presentation time/u);
	assert.deepEqual(session.manifest, manifest);
});

test('durable capture retains nonzero shared-origin ranges and exact internal PCM holes', async () => {
	const fixture = createFixture();
	const session = await fixture.coordinator.create(sessionRequest());
	await session.append(videoPacket({ presentationTimeUs: 100_000 }));
	await session.append(pcmPacket({ presentationTimeUs: 100_000 }));
	await session.append(pcmPacket({
		sequence: 1,
		presentationTimeUs: 100_105,
		droppedBefore: { value: 3, confidence: 'exact' },
	}));

	assert.deepEqual(session.manifest.streams.map(({ timing }) => timing), [
		{ firstPresentationMicroseconds: 100_000, lastPresentationEndMicroseconds: 101_000 },
		{ firstPresentationMicroseconds: 100_000, lastPresentationEndMicroseconds: 100_147 },
	]);
	const pcmSpool = await fixture.rawPcmSpools.load('project-capture', 'microphone-spool');
	assert.ok(pcmSpool);
	assert.deepEqual((await fixture.rawPcmSpools.chunk(pcmSpool, 0)).timing, {
		presentationTimeMicroseconds: 100_000,
		durationMicroseconds: 42,
		droppedFramesBefore: 0,
	});
	assert.deepEqual((await fixture.rawPcmSpools.chunk(pcmSpool, 1)).timing, {
		presentationTimeMicroseconds: 100_105,
		durationMicroseconds: 42,
		droppedFramesBefore: 3,
	});
});

test('failed spool acknowledgement leaves its physical tail outside manifest truth', async () => {
	const fixture = createFixture({ createCoordinator: false });
	let rejectEncodedAcknowledgement = false;
	const encodedSpools = new EncodedCaptureSpoolRepository({
		get: fixture.values.get.bind(fixture.values),
		putIfAbsent: fixture.values.putIfAbsent.bind(fixture.values),
		deleteIfCurrent: fixture.values.deleteIfCurrent.bind(fixture.values),
		listByPrefix: fixture.values.listByPrefix.bind(fixture.values),
		async replaceIfCurrent(key, expected, replacement) {
			return rejectEncodedAcknowledgement
				? false
				: fixture.values.replaceIfCurrent(key, expected, replacement);
		},
	}, fixture.mediaChunks, { createId: () => 'failed-ack-token' });
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools,
		rawPcmSpools: fixture.rawPcmSpools,
		manifests: fixture.manifests,
		now: () => 100,
	});
	const session = await coordinator.create(sessionRequest({
		streams: [sessionRequest().streams[0]!],
	}));
	const before = session.manifest;
	rejectEncodedAcknowledgement = true;

	await assert.rejects(session.append(videoPacket()), /outside the authoritative acknowledged prefix/u);

	assert.deepEqual(session.manifest, before);
	assert.deepEqual(await fixture.manifests.load('project-capture', 'session-capture'), before);
	assert.equal(fixture.memory.mediaAssetChunks.size, 1);
	rejectEncodedAcknowledgement = false;
	await session.delete();
	assert.equal(fixture.memory.mediaAssetChunks.size, 0);
	assert.equal(await fixture.manifests.load('project-capture', 'session-capture'), null);
});

test('failed PCM acknowledgement leaves its deinterleaved tail outside manifest truth', async () => {
	const fixture = createFixture({ createCoordinator: false });
	let rejectRawPcmAcknowledgement = false;
	const rawPcmSpools = new RawPcmSpoolRepository({
		get: fixture.values.get.bind(fixture.values),
		putIfAbsent: fixture.values.putIfAbsent.bind(fixture.values),
		deleteIfCurrent: fixture.values.deleteIfCurrent.bind(fixture.values),
		listByPrefix: fixture.values.listByPrefix.bind(fixture.values),
		async replaceIfCurrent(key, expected, replacement) {
			return rejectRawPcmAcknowledgement && key.startsWith('raw-pcm-spool-registry-v1:')
				? false
				: fixture.values.replaceIfCurrent(key, expected, replacement);
		},
	}, new SourceRecordRepository({ memory: fixture.memory, database: async () => null }));
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools,
		manifests: fixture.manifests,
		now: () => 100,
	});
	const session = await coordinator.create(sessionRequest({
		streams: [sessionRequest().streams[1]!],
	}));
	const before = session.manifest;
	rejectRawPcmAcknowledgement = true;

	await assert.rejects(session.append(pcmPacket()), /replacement exceeded/u);

	assert.deepEqual(session.manifest, before);
	assert.equal(fixture.memory.sourceChunks.size, 1);
	rejectRawPcmAcknowledgement = false;
	await session.delete();
	assert.equal(fixture.memory.sourceChunks.size, 0);
	assert.equal(await fixture.manifests.load('project-capture', 'session-capture'), null);
});

test('pause, seal, playability, and recovery inventory move only forward', async () => {
	const fixture = createFixture();
	const session = await fixture.coordinator.create(sessionRequest());
	await session.append(videoPacket());
	await session.append(pcmPacket());
	await session.addPauseSpan({ startMicroseconds: 4_000, endMicroseconds: 9_000 });
	await assert.rejects(
		session.addPauseSpan({ startMicroseconds: 8_000, endMicroseconds: 10_000 }),
		/ordered and non-overlapping/u,
	);
	const sealed = await session.seal();
	assert.deepEqual(await session.seal(), sealed, 'seal is idempotent');
	assert.equal((await fixture.encodedSpools.load('project-capture', 'camera-spool'))?.state, 'sealed');
	assert.equal((await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'))?.state, 'sealed');
	await session.setPlayability('camera-stream', 'playable');
	await session.setPlayability('camera-stream', 'playable');
	await session.setPlayability('microphone-stream', 'invalid');
	await assert.rejects(
		session.setPlayability('camera-stream', 'invalid'),
		/cannot move backward/u,
	);

	const inventory = await fixture.coordinator.recoveryInventory('project-capture');
	assert.equal(inventory.length, 1);
	assert.equal(inventory[0]!.storageStatus, 'exact');
	assert.deepEqual(inventory[0]!.affectedStreamIds, []);
	assert.deepEqual(inventory[0]!.manifest, session.manifest);
	assert.deepEqual(session.manifest.clock.pauseSpans, [{
		startMicroseconds: 4_000,
		endMicroseconds: 9_000,
	}]);
});

test('deletion refuses changed ownership and never reclaims another session', async () => {
	const fixture = createFixture();
	const first = await fixture.coordinator.create(sessionRequest());
	const second = await fixture.coordinator.create(sessionRequest({
		sessionId: 'session-other',
		generation: 2,
		streams: [{
			kind: 'encoded-media', role: 'camera', required: true,
			streamId: 'other-camera-stream', spoolId: 'other-camera-spool',
			sourceId: 'other-camera-source', mimeType: 'video/webm',
		}],
	}));
	const pcm = await fixture.rawPcmSpools.load('project-capture', 'microphone-spool');
	assert.ok(pcm);
	await fixture.rawPcmSpools.replaceData(pcm, { kind: 'foreign-owner' });

	await assert.rejects(first.delete(), /ownership changed/u);
	assert.ok(await fixture.manifests.load('project-capture', 'session-capture'));
	assert.ok(await fixture.encodedSpools.load('project-capture', 'camera-spool'));
	assert.equal((await fixture.coordinator.recoveryInventory('project-capture'))[0]!.storageStatus, 'changed');

	await second.delete();
	assert.equal(await fixture.manifests.load('project-capture', 'session-other'), null);
	assert.ok(await fixture.encodedSpools.load('project-capture', 'camera-spool'));
});

test('committed settlement retires only exact session storage and is idempotent after partial cleanup', async () => {
	const fixture = createFixture({ createCoordinator: false });
	let refuseRawRemoval = true;
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: {
			...rawPcmPort(fixture.rawPcmSpools),
			async remove(record) {
				if (refuseRawRemoval) { refuseRawRemoval = false; return false; }
				return fixture.rawPcmSpools.remove(record);
			},
		},
		manifests: fixture.manifests,
		now: () => 100,
	});
	const session = await coordinator.create(sessionRequest());
	await session.append(videoPacket());
	await session.append(pcmPacket());
	await session.seal();
	await commitManifest(fixture.manifests, session.manifest);

	await assert.rejects(session.retireCommitted(), /ownership changed/iu);
	assert.equal(await fixture.encodedSpools.load('project-capture', 'camera-spool'), null,
		'a completed exact spool cleanup remains settled');
	assert.ok(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'));
	assert.equal((await fixture.manifests.load('project-capture', 'session-capture'))?.state, 'committed');

	await session.retireCommitted();
	await session.retireCommitted();
	assert.equal(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'), null);
	assert.equal(await fixture.manifests.load('project-capture', 'session-capture'), null);
	assert.equal(fixture.memory.mediaAssetChunks.size, 0);
	assert.equal(fixture.memory.sourceChunks.size, 0);
});

test('committed settlement preflights every spool and preserves all storage on changed ownership', async () => {
	const fixture = createFixture();
	const session = await fixture.coordinator.create(sessionRequest());
	await session.append(videoPacket());
	await session.append(pcmPacket());
	await session.seal();
	await commitManifest(fixture.manifests, session.manifest);
	const pcm = await fixture.rawPcmSpools.load('project-capture', 'microphone-spool');
	assert.ok(pcm);
	await fixture.rawPcmSpools.replaceData(pcm, { kind: 'foreign-owner' });

	await assert.rejects(session.retireCommitted(), /ownership changed/iu);
	assert.ok(await fixture.encodedSpools.load('project-capture', 'camera-spool'));
	assert.ok(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'));
	assert.equal((await fixture.manifests.load('project-capture', 'session-capture'))?.state, 'committed');
});

test('committed settlement is idempotent across stale coordinator sessions', async () => {
	const fixture = createFixture();
	const session = await fixture.coordinator.create(sessionRequest());
	await session.append(videoPacket());
	await session.append(pcmPacket());
	await session.seal();
	await commitManifest(fixture.manifests, session.manifest);
	const stale = await fixture.coordinator.load('project-capture', 'session-capture');
	assert.ok(stale);

	await session.retireCommitted();
	await stale.retireCommitted();

	assert.equal(await fixture.manifests.load('project-capture', 'session-capture'), null);
	assert.equal(await fixture.encodedSpools.load('project-capture', 'camera-spool'), null);
	assert.equal(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'), null);
});

test('startup inventory retries a discarded session whose exact cleanup was interrupted', async () => {
	const fixture = createFixture({ createCoordinator: false });
	let rejectEncodedRemoval = true;
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: {
			...encodedPort(fixture.encodedSpools),
			async delete(record) {
				if (rejectEncodedRemoval) { rejectEncodedRemoval = false; throw new Error('cleanup interrupted'); }
				await fixture.encodedSpools.delete(record);
			},
		},
		rawPcmSpools: fixture.rawPcmSpools,
		manifests: fixture.manifests,
		now: () => 100,
	});
	const session = await coordinator.create(sessionRequest());
	await session.append(videoPacket());
	await session.append(pcmPacket());

	await assert.rejects(session.delete(), /cleanup interrupted/u);
	assert.equal((await fixture.manifests.load('project-capture', 'session-capture'))?.state, 'discarded');
	assert.deepEqual(await coordinator.recoveryInventory('project-capture'), []);
	assert.equal(await fixture.manifests.load('project-capture', 'session-capture'), null);
	assert.equal(await fixture.encodedSpools.load('project-capture', 'camera-spool'), null);
	assert.equal(await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'), null);
});

test('a failed manifest CAS restores the encoded spool to its acknowledged prefix', async () => {
	const fixture = createFixture({ createCoordinator: false });
	let rejectManifestAppend = false;
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: fixture.rawPcmSpools,
		manifests: {
			...manifestPort(fixture.manifests),
			async replace(expected, next) {
				if (rejectManifestAppend) { rejectManifestAppend = false; throw new Error('manifest CAS refused'); }
				return fixture.manifests.replace(expected, next);
			},
		},
		now: () => 100,
	});
	const session = await coordinator.create(sessionRequest({ streams: [sessionRequest().streams[0]!] }));
	await session.append(videoPacket());
	rejectManifestAppend = true;

	await assert.rejects(session.append(videoPacket({
		sequence: 1,
		presentationTimeUs: 1_000,
	})), /manifest CAS refused/u);
	assert.equal((await fixture.encodedSpools.load('project-capture', 'camera-spool'))?.packetCount, 1);
	assert.equal((await coordinator.recoveryInventory('project-capture'))[0]?.storageStatus, 'exact');
	await session.append(videoPacket({ sequence: 1, presentationTimeUs: 1_000 }));
	assert.equal(session.manifest.streams[0]?.storage.kind === 'encoded-media'
		? session.manifest.streams[0].storage.packetCount : null, 2);
});

test('a failed manifest CAS restores the raw PCM spool to its acknowledged prefix', async () => {
	const fixture = createFixture({ createCoordinator: false });
	let rejectManifestAppend = false;
	const coordinator = createFramescaperCaptureDurableSessionCoordinator({
		encodedSpools: fixture.encodedSpools,
		rawPcmSpools: fixture.rawPcmSpools,
		manifests: {
			...manifestPort(fixture.manifests),
			async replace(expected, next) {
				if (rejectManifestAppend) { rejectManifestAppend = false; throw new Error('manifest CAS refused'); }
				return fixture.manifests.replace(expected, next);
			},
		},
		now: () => 100,
	});
	const session = await coordinator.create(sessionRequest({ streams: [sessionRequest().streams[1]!] }));
	await session.append(pcmPacket());
	rejectManifestAppend = true;

	await assert.rejects(session.append(pcmPacket({
		sequence: 1,
		presentationTimeUs: 42,
	})), /manifest CAS refused/u);
	assert.equal((await fixture.rawPcmSpools.load('project-capture', 'microphone-spool'))?.chunkCount, 1);
	assert.equal((await coordinator.recoveryInventory('project-capture'))[0]?.storageStatus, 'exact');
	await session.append(pcmPacket({ sequence: 1, presentationTimeUs: 42 }));
	assert.equal(session.manifest.streams[0]?.storage.kind === 'raw-pcm'
		? session.manifest.streams[0].storage.chunkCount : null, 2);
});

function sessionRequest(
	overrides: Partial<CreateFramescaperCaptureDurableSessionRequest> = {},
): CreateFramescaperCaptureDurableSessionRequest {
	return {
		sessionId: 'session-capture',
		generation: 1,
		projectFence: {
			projectId: 'project-capture', baseRevision: 3, baseSha256: 'ab'.repeat(32),
		},
		origin: {
			sequenceId: 'sequence-capture', playheadMicroseconds: 2_000_000, destination: 'both',
		},
		monotonicOriginMicroseconds: 1_000,
		streams: [{
			kind: 'encoded-media', role: 'camera', required: true,
			streamId: 'camera-stream', spoolId: 'camera-spool',
			sourceId: 'camera-source', mimeType: 'video/webm',
		}, {
			kind: 'raw-pcm', role: 'microphone', required: true,
			streamId: 'microphone-stream', spoolId: 'microphone-spool',
			sourceId: 'microphone-source', sampleRate: 48_000,
			channelCount: 2, chunkFrames: 1_024,
		}],
		...overrides,
	};
}

function videoPacket(
	overrides: Partial<CaptureEncodedVideoPacket> = {},
): CaptureEncodedVideoPacket {
	const bytes = Uint8Array.of(7, 8, 9);
	return {
		kind: 'encoded-video', sessionId: 'session-capture', streamId: 'camera-stream',
		role: 'camera', sequence: 0, presentationTimeUs: 0, durationUs: 1_000,
		receiptTimeMs: 1, droppedBefore: { value: null, confidence: 'unavailable' },
		byteLength: bytes.byteLength, bytes, mimeType: 'video/webm', keyFrame: null,
		...overrides,
	};
}

function pcmPacket(
	overrides: Partial<CapturePcmAudioPacket> = {},
): CapturePcmAudioPacket {
	return {
		kind: 'pcm-audio', sessionId: 'session-capture', streamId: 'microphone-stream',
		role: 'microphone', sequence: 0, presentationTimeUs: 0, durationUs: 42,
		receiptTimeMs: 1, droppedBefore: { value: 0, confidence: 'exact' },
		frameCount: 2, sampleRate: 48_000, channelCount: 2,
		samples: Float32Array.of(1, 10, 2, 20),
		...overrides,
	};
}

function createFixture(options: Readonly<{ createCoordinator?: boolean }> = {}) {
	const memory = getMemoryDatabase(uniqueName());
	const port = { memory, database: async () => null };
	const values = new KeyValueRepository(port, 'analysis');
	const mediaChunks = new MediaAssetChunkRecords(port);
	const sourceRecords = new SourceRecordRepository(port);
	const encodedSpools = new EncodedCaptureSpoolRepository(values, mediaChunks, {
		createId: () => `encoded-${Math.random().toString(36).slice(2)}`,
	});
	const rawPcmSpools = new RawPcmSpoolRepository(values, sourceRecords);
	const manifests = new FramescaperCaptureSessionManifestRepository(values);
	const coordinator = options.createCoordinator === false
		? null
		: createFramescaperCaptureDurableSessionCoordinator({
			encodedSpools, rawPcmSpools, manifests, now: () => 100,
		});
	return { memory, values, mediaChunks, encodedSpools, rawPcmSpools, manifests, coordinator: coordinator! };
}

function encodedPort(repository: EncodedCaptureSpoolRepository) {
	return {
		create: repository.create.bind(repository),
		load: repository.load.bind(repository),
		append: repository.append.bind(repository),
		seal: repository.seal.bind(repository),
		delete: repository.delete.bind(repository),
		releaseAdopted: repository.releaseAdopted.bind(repository),
		restoreAcknowledgedPrefix: repository.restoreAcknowledgedPrefix.bind(repository),
	};
}

function rawPcmPort(repository: RawPcmSpoolRepository) {
	return {
		create: repository.create.bind(repository),
		load: repository.load.bind(repository),
		append: repository.append.bind(repository),
		seal: repository.seal.bind(repository),
		remove: repository.remove.bind(repository),
		restoreAcknowledgedPrefix: repository.restoreAcknowledgedPrefix.bind(repository),
	};
}

function manifestPort(repository: FramescaperCaptureSessionManifestRepository) {
	return {
		create: repository.create.bind(repository),
		load: repository.load.bind(repository),
		listProject: repository.listProject.bind(repository),
		replace: repository.replace.bind(repository),
		remove: repository.remove.bind(repository),
	};
}

async function commitManifest(
	repository: FramescaperCaptureSessionManifestRepository,
	sealed: FramescaperCaptureSessionManifestV1,
): Promise<void> {
	let current = sealed;
	current = await repository.replace(current, { ...current, state: 'finalizing' });
	current = await repository.replace(current, {
		...current,
		state: 'published',
		streams: current.streams.map((stream) => ({ ...stream, playability: 'playable' })),
	});
	await repository.replace(current, { ...current, state: 'committed' });
}

function uniqueName(): string {
	return `framescaper-capture-durable-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
