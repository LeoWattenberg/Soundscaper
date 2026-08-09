/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
	createVideoClipV9,
	createVideoSourceV9,
} from '../src/common/editor/project-v9.ts';
import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../src/common/editor/scape-archive-envelope.ts';
import { serializeScapeProjectDocument } from '../src/common/editor/scape-project-document.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import {
	overlayDesktopSharedLinkedVideoOriginals,
	resolveDesktopSharedProjectLinkedVideoOriginals,
	type DesktopSharedLinkedVideoOriginalSession,
} from '../src/common/editor/storage/desktop-shared-project-linked-video-originals.ts';
import {
	acquireDesktopSharedProjectMedia,
	DESKTOP_SHARED_AUDIO_ENCODING,
	DESKTOP_SHARED_VIDEO_ENCODING,
	type DesktopSharedManagedSourceDescriptor,
	type DesktopSharedSourceTransferStore,
} from '../src/common/editor/storage/desktop-shared-project-media-transfer.ts';
import type { DesktopSharedProjectBridge } from '../src/common/editor/storage/desktop-shared-project-repository.ts';
import { LinkedVideoOriginalRepository } from '../src/common/editor/storage/linked-video-original-repository.ts';
import { LinkedVideoOriginalResolver } from '../src/common/editor/storage/linked-video-original-resolver.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';

const SAMPLE_RATE = 48_000;

test('fresh recipient acquires exact managed PCM and original video transactionally', async (context) => {
	const fixture = mixedFixture();
	const store = memoryStore(context, 'fresh-mixed');
	const reads: Array<Readonly<{ bindingId: string; length: number; offset: number }>> = [];
	const acquisition = await acquireDesktopSharedProjectMedia(
		fixture.project,
		null,
		fixture.descriptors,
		{ async readSharedSourceChunk(request) {
			reads.push(request);
			const body = fixture.bodyByBinding.get(request.bindingId);
			if (!body) throw new Error('Unexpected managed binding');
			return body.slice(request.offset, request.offset + request.length);
		} },
		store,
	);

	assert.deepEqual([...acquisition.trustedSourceIds].sort(), [fixture.audio.id, fixture.video.id].sort());
	assert.deepEqual(await readMonoPcm(store, fixture.audio.storageKey), [0.25, -0.5]);
	assert.deepEqual(await readMediaBytes(store, fixture.video.storageKey), fixture.videoBytes);
	assert.equal((await store.getMediaAssetMetadata(fixture.video.storageKey))?.sha256, fixture.videoSha256);
	assert.ok(reads.some(({ bindingId }) => bindingId === fixture.audioDescriptor.bindingId));
	assert.ok(reads.some(({ bindingId }) => bindingId === fixture.videoDescriptor.bindingId));
	acquisition.commit();
	await acquisition.rollback();
	assert.deepEqual(await readMediaBytes(store, fixture.video.storageKey), fixture.videoBytes);
});

test('desktop project-store load wires mixed acquisition into its exact local shadow', async (context) => {
	const fixture = mixedFixture();
	const bridge: DesktopSharedProjectBridge = {
		listSharedProjects: async () => [],
		readSharedProject: async () => null,
		commitSharedProject: async ({ document }) => ({ status: 'committed', document }),
		deleteSharedProject: async () => true,
		readSharedProjectBundle: async () => ({
			document: serializeScapeProjectDocument(fixture.project),
			sources: fixture.descriptors,
		}),
		beginSharedSourceWrite: async () => { throw new Error('Unexpected managed upload'); },
		writeSharedSourceChunk: async () => { throw new Error('Unexpected managed upload'); },
		finishSharedSourceWrite: async () => { throw new Error('Unexpected managed upload'); },
		abortSharedSourceWrite: async () => false,
		async readSharedSourceChunk(request) {
			const body = fixture.bodyByBinding.get(request.bindingId);
			if (!body) throw new Error('Unexpected managed binding');
			return body.slice(request.offset, request.offset + request.length);
		},
	};
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `mixed-repository-${Date.now()}-${Math.random()}`,
		desktopProjectBridge: bridge,
	});
	context.after(async () => { await store.close(); });

	const loaded = await store.loadProject(fixture.project.id);
	assert.equal(serializeScapeProjectDocument(loaded), serializeScapeProjectDocument(fixture.project));
	assert.deepEqual(await readMonoPcm(store, fixture.audio.storageKey), [0.25, -0.5]);
	assert.deepEqual(await readMediaBytes(store, fixture.video.storageKey), fixture.videoBytes);
	const shadow = await store.loadProject(fixture.project.id, { revision: fixture.project.revision });
	assert.equal(serializeScapeProjectDocument(shadow), serializeScapeProjectDocument(fixture.project));
});

test('a corrupt video body rolls back PCM acquired earlier in the mixed transaction', async (context) => {
	const fixture = mixedFixture();
	const store = memoryStore(context, 'corrupt-video');
	const corruptVideo = fixture.videoBytes.slice();
	corruptVideo[0] ^= 0xff;

	await assert.rejects(acquireDesktopSharedProjectMedia(
		fixture.project,
		null,
		fixture.descriptors,
		{ async readSharedSourceChunk({ bindingId, length, offset }) {
			const body = bindingId === fixture.videoDescriptor.bindingId ? corruptVideo : fixture.audioBytes;
			return body.slice(offset, offset + length);
		} },
		store,
	), /digest|sha-256|managed video/iu);

	assert.equal(await store.getSourceMetadata(fixture.audio.storageKey), null);
	assert.equal(await store.getMediaAssetMetadata(fixture.video.storageKey), null);
});

test('managed video rollback preserves a concurrent recipient replacement', async (context) => {
	const fixture = mixedFixture();
	const store = memoryStore(context, 'video-rollback-replacement');
	const acquisition = await acquireDesktopSharedProjectMedia(
		fixture.project,
		null,
		fixture.descriptors,
		{ async readSharedSourceChunk(request) {
			const body = fixture.bodyByBinding.get(request.bindingId);
			if (!body) throw new Error('Unexpected managed binding');
			return body.slice(request.offset, request.offset + request.length);
		} },
		store,
	);
	const replacement = Uint8Array.of(34, 55, 89);
	await store.deleteMediaAsset(fixture.video.storageKey);
	await store.writeMediaAsset(
		fixture.video.storageKey,
		mediaBlob(replacement, fixture.video.mimeType),
		{ name: fixture.video.name, mimeType: fixture.video.mimeType },
	);

	await acquisition.rollback();

	assert.equal(await store.getSourceMetadata(fixture.audio.storageKey), null);
	assert.deepEqual(await readMediaBytes(store, fixture.video.storageKey), replacement);
});

test('managed video acquisition loses an absence race without replacing the winner', async (context) => {
	const fixture = mixedFixture();
	const store = memoryStore(context, 'video-absence-race');
	const winner = Uint8Array.of(144, 233, 121);
	let winnerPublished = false;

	await assert.rejects(acquireDesktopSharedProjectMedia(
		fixture.project,
		null,
		fixture.descriptors,
		{ async readSharedSourceChunk(request) {
			if (request.bindingId === fixture.videoDescriptor.bindingId && !winnerPublished) {
				winnerPublished = true;
				await store.writeMediaAsset(
					fixture.video.storageKey,
					mediaBlob(winner, fixture.video.mimeType),
					{ name: fixture.video.name, mimeType: fixture.video.mimeType },
				);
			}
			const body = fixture.bodyByBinding.get(request.bindingId);
			if (!body) throw new Error('Unexpected managed binding');
			return body.slice(request.offset, request.offset + request.length);
		} },
		store,
	), /immutable media asset|cannot be overwritten/iu);

	assert.equal(winnerPublished, true);
	assert.equal(await store.getSourceMetadata(fixture.audio.storageKey), null);
	assert.deepEqual(await readMediaBytes(store, fixture.video.storageKey), winner);
});

test('recipient-local media collision is found before any managed body is read or written', async (context) => {
	const fixture = mixedFixture();
	const store = memoryStore(context, 'video-collision');
	await store.writeMediaAsset(
		fixture.video.storageKey,
		mediaBlob(Uint8Array.of(9, 9, 9), fixture.video.mimeType),
		{ name: fixture.video.name, mimeType: fixture.video.mimeType },
	);
	let reads = 0;

	await assert.rejects(acquireDesktopSharedProjectMedia(
		fixture.project,
		null,
		fixture.descriptors,
		{ async readSharedSourceChunk() { reads += 1; throw new Error('unexpected body read'); } },
		store,
	), /recipient-local video source.*conflicts/iu);

	assert.equal(reads, 0);
	assert.equal(await store.getSourceMetadata(fixture.audio.storageKey), null);
	assert.deepEqual(await readMediaBytes(store, fixture.video.storageKey), Uint8Array.of(9, 9, 9));
});

test('an exact linked-video session admits a fresh descriptor-free group without a managed writer', async () => {
	const fixture = await linkedAcquisitionFixture();
	const acquisition = await acquireDesktopSharedProjectMedia(
		fixture.project,
		null,
		[],
		fixture.bridge,
		fixture.store,
		{ linkedVideoOriginals: fixture.session },
	);

	assert.deepEqual([...acquisition.trustedSourceIds], [fixture.video.id]);
	assert.deepEqual(fixture.calls, {
		fallbackMetadataReads: 0,
		managedBodyReads: 0,
		managedMediaWrites: 0,
	});
	acquisition.commit();
	await acquisition.rollback();
});

test('bare and stale linked-video source identities cannot bypass fresh-recipient admission', async () => {
	const fixture = await linkedAcquisitionFixture();
	await assert.rejects(acquireDesktopSharedProjectMedia(
		fixture.project,
		null,
		[],
		fixture.bridge,
		fixture.store,
	), /recipient-local video source.*conflicts/iu);

	const forgedSession = Object.freeze(Object.create(null)) as DesktopSharedLinkedVideoOriginalSession;
	await assert.rejects(acquireDesktopSharedProjectMedia(
		fixture.project,
		null,
		[],
		fixture.bridge,
		fixture.store,
		{ linkedVideoOriginals: forgedSession },
	), /session is not authentic/iu);

	const staleVideo = createVideoSourceV9({ ...fixture.video, width: 1_280 });
	await assert.rejects(acquireDesktopSharedProjectMedia(
		linkedVideoProject(staleVideo),
		null,
		[],
		fixture.bridge,
		fixture.store,
		{ linkedVideoOriginals: fixture.session },
	), /recipient-local video source.*conflicts/iu);

	assert.deepEqual(fixture.calls, {
		fallbackMetadataReads: 0,
		managedBodyReads: 0,
		managedMediaWrites: 0,
	});
});

test('an authorized linked-video group still must match any managed descriptor digest', async () => {
	const fixture = await linkedAcquisitionFixture();
	const descriptor = Object.freeze({
		...fixture.descriptor,
		sha256: fixture.descriptor.sha256 === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64),
	});

	await assert.rejects(acquireDesktopSharedProjectMedia(
		fixture.project,
		null,
		[descriptor],
		fixture.bridge,
		fixture.store,
		{ linkedVideoOriginals: fixture.session },
	), /does not match its managed descriptor/iu);
	assert.equal(fixture.calls.managedBodyReads, 0);
	assert.equal(fixture.calls.managedMediaWrites, 0);
});

test('prior-local video bytes join the aggregate budget before a missing body is acquired', async () => {
	const first = createVideoSourceV9({
		id: 'prior-budget-video', storageKey: 'prior-budget-video-storage', name: 'prior.mp4',
		mimeType: 'video/mp4', frameCount: 30, sampleRate: SAMPLE_RATE, width: 1_920,
		height: 1_080, frameRate: 30, videoCodec: 'h264', audioCodec: null, hasAudio: false,
	});
	const second = createVideoSourceV9({
		id: 'missing-budget-video', storageKey: 'missing-budget-video-storage', name: 'missing.mp4',
		mimeType: 'video/mp4', frameCount: 30, sampleRate: SAMPLE_RATE, width: 1_920,
		height: 1_080, frameRate: 30, videoCodec: 'h264', audioCodec: null, hasAudio: false,
	});
	const clips = [first, second].map((source) => createVideoClipV9({
		id: `${source.id}-clip`, sourceId: source.id, durationFrames: source.frameCount,
		binItemId: `${source.id}-item`,
	}));
	const project = createCurrentAudioEditorProject({
		id: 'prior-video-aggregate-budget', title: 'Prior video aggregate budget', revision: 2,
		now: '2026-08-01T12:00:00.000Z', sampleRate: SAMPLE_RATE,
		sources: [first, second], projectBin: { clips },
	});
	const descriptor: DesktopSharedManagedSourceDescriptor = Object.freeze({
		bindingId: `v${'c'.repeat(64)}`, byteLength: 2,
		encoding: DESKTOP_SHARED_VIDEO_ENCODING, kind: 'video', sha256: 'd'.repeat(64),
		sourceId: second.id, storageKey: second.storageKey,
	});
	let bodyReads = 0;
	let writes = 0;

	await assert.rejects(acquireDesktopSharedProjectMedia(
		project,
		project,
		[descriptor],
		{ async readSharedSourceChunk() { bodyReads += 1; throw new Error('Unexpected body read'); } },
		{
			getSourceMetadata() { throw new Error('Unexpected audio metadata read'); },
			getMediaAssetMetadata(sourceId) {
				if (sourceId === second.storageKey) return null;
				assert.equal(sourceId, first.storageKey);
				return {
					sourceId, storage: 'indexeddb-blob', path: null,
					committedAt: '2026-08-01T12:00:00.000Z', mimeType: first.mimeType,
					size: SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes,
					sha256: 'e'.repeat(64),
				};
			},
			loadMediaAsset() { throw new Error('Unexpected media body read'); },
			async beginMediaAssetWrite() { writes += 1; throw new Error('Unexpected media write'); },
			readSourceChunks() { throw new Error('Unexpected PCM read'); },
			async beginSourceWrite() { throw new Error('Unexpected PCM write'); },
			discardSourceIfCurrent() { throw new Error('Unexpected PCM rollback'); },
		},
	), /expanded-byte limit/iu);

	assert.equal(bodyReads, 0);
	assert.equal(writes, 0);
});

interface MixedFixture {
	readonly audio: ReturnType<typeof createAudioSourceV9>;
	readonly audioBytes: Uint8Array;
	readonly audioDescriptor: DesktopSharedManagedSourceDescriptor;
	readonly bodyByBinding: ReadonlyMap<string, Uint8Array>;
	readonly descriptors: readonly DesktopSharedManagedSourceDescriptor[];
	readonly project: AudioEditorProjectCurrent;
	readonly video: ReturnType<typeof createVideoSourceV9>;
	readonly videoBytes: Uint8Array;
	readonly videoDescriptor: DesktopSharedManagedSourceDescriptor;
	readonly videoSha256: string;
}

interface LinkedAcquisitionFixture {
	readonly bridge: Readonly<{
		readSharedSourceChunk(): Promise<Uint8Array>;
	}>;
	readonly calls: {
		fallbackMetadataReads: number;
		managedBodyReads: number;
		managedMediaWrites: number;
	};
	readonly descriptor: DesktopSharedManagedSourceDescriptor;
	readonly project: AudioEditorProjectCurrent;
	readonly session: DesktopSharedLinkedVideoOriginalSession;
	readonly store: DesktopSharedSourceTransferStore;
	readonly video: ReturnType<typeof createVideoSourceV9>;
}

function mixedFixture(): MixedFixture {
	const audio = createAudioSourceV9({
		id: 'recipient-audio', storageKey: 'recipient-audio-storage', name: 'recipient.wav',
		mimeType: 'audio/wav', frameCount: 2, channelCount: 1, sampleRate: SAMPLE_RATE,
		originalSampleRate: SAMPLE_RATE, sampleFormat: 'float32', chunkFrames: 2,
	});
	const video = createVideoSourceV9({
		id: 'recipient-video', storageKey: 'recipient-video-storage', name: 'recipient.mp4',
		mimeType: 'video/mp4', frameCount: 30, sampleRate: SAMPLE_RATE, width: 1_920,
		height: 1_080, frameRate: 30, videoCodec: 'h264', audioCodec: null, hasAudio: false,
	});
	const audioClip = createAudioClipV9({
		id: 'recipient-audio-clip', sourceId: audio.id, durationFrames: 2, sourceDurationFrames: 2,
	});
	const videoClip = createVideoClipV9({
		id: 'recipient-video-clip', sourceId: video.id, durationFrames: 30,
		binItemId: 'recipient-video-item',
	});
	const project = createCurrentAudioEditorProject({
		id: 'recipient-mixed-project', title: 'Recipient mixed project', revision: 4,
		now: '2026-08-01T12:00:00.000Z', sampleRate: SAMPLE_RATE,
		sources: [audio, video], clips: [audioClip],
		tracks: [createAudioTrackV9({ id: 'recipient-track', clipIds: [audioClip.id] })],
		projectBin: { clips: [videoClip] },
	});
	const audioBytes = canonicalPcmBytes([0.25, -0.5]);
	const videoBytes = Uint8Array.of(1, 2, 3, 5, 8, 13, 21);
	const audioDescriptor: DesktopSharedManagedSourceDescriptor = Object.freeze({
		bindingId: `m${'a'.repeat(64)}`, byteLength: audioBytes.byteLength,
		encoding: DESKTOP_SHARED_AUDIO_ENCODING, kind: 'audio', sha256: digest(audioBytes),
		sourceId: audio.id, storageKey: audio.storageKey,
	});
	const videoDescriptor: DesktopSharedManagedSourceDescriptor = Object.freeze({
		bindingId: `v${'b'.repeat(64)}`, byteLength: videoBytes.byteLength,
		encoding: DESKTOP_SHARED_VIDEO_ENCODING, kind: 'video', sha256: digest(videoBytes),
		sourceId: video.id, storageKey: video.storageKey,
	});
	return Object.freeze({
		audio, audioBytes, audioDescriptor,
		bodyByBinding: new Map([
			[audioDescriptor.bindingId, audioBytes],
			[videoDescriptor.bindingId, videoBytes],
		]),
		descriptors: Object.freeze([audioDescriptor, videoDescriptor]),
		project,
		video,
		videoBytes,
		videoDescriptor,
		videoSha256: videoDescriptor.sha256,
	});
}

async function linkedAcquisitionFixture(): Promise<LinkedAcquisitionFixture> {
	const video = createVideoSourceV9({
		id: 'linked-acquisition-video', storageKey: 'linked-acquisition-video-storage',
		name: 'linked-acquisition.mp4', mimeType: 'video/mp4', frameCount: 30,
		sampleRate: SAMPLE_RATE, width: 1_920, height: 1_080, frameRate: 30,
		videoCodec: 'h264', audioCodec: null, hasAudio: false,
	});
	const project = linkedVideoProject(video);
	const body = mediaBlob(Uint8Array.of(2, 3, 5, 7, 11, 13), video.mimeType);
	const locatorId = 'locator_acquisition_000001';
	const locatorRevision = 'revision_acquisition_0001';
	const storagePort = {
		memory: getMemoryDatabase(`linked-acquisition-${Date.now()}-${Math.random()}`),
		database: async () => null,
	};
	const bindings = new LinkedVideoOriginalRepository(storagePort, {
		now: () => new Date('2026-08-01T12:00:00.000Z'),
		createBindingToken: () => 'binding_acquisition_000001',
	});
	const resolver = new LinkedVideoOriginalResolver(bindings, {
		load(requestedLocatorId, { expectedRevision }) {
			assert.equal(requestedLocatorId, locatorId);
			if (expectedRevision !== null && expectedRevision !== locatorRevision) {
				return Promise.resolve(null);
			}
			return Promise.resolve({ blob: body, locatorRevision });
		},
	});
	const binding = await resolver.bind(project.id, video, locatorId);
	const session = await resolveDesktopSharedProjectLinkedVideoOriginals(project, resolver);
	const calls = {
		fallbackMetadataReads: 0,
		managedBodyReads: 0,
		managedMediaWrites: 0,
	};
	const fallback: DesktopSharedSourceTransferStore = {
		getSourceMetadata() { throw new Error('Unexpected linked-video audio metadata read'); },
		getMediaAssetMetadata() {
			calls.fallbackMetadataReads += 1;
			return null;
		},
		loadMediaAsset() { throw new Error('Unexpected linked-video fallback body read'); },
		async beginMediaAssetWrite() {
			calls.managedMediaWrites += 1;
			throw new Error('Unexpected linked-video managed media write');
		},
		readSourceChunks() { throw new Error('Unexpected linked-video PCM read'); },
		async beginSourceWrite() { throw new Error('Unexpected linked-video PCM write'); },
		discardSourceIfCurrent() { throw new Error('Unexpected linked-video PCM rollback'); },
	};
	return {
		bridge: {
			async readSharedSourceChunk() {
				calls.managedBodyReads += 1;
				throw new Error('Unexpected linked-video managed body read');
			},
		},
		calls,
		descriptor: Object.freeze({
			bindingId: `v${'e'.repeat(64)}`,
			byteLength: binding.byteLength,
			encoding: DESKTOP_SHARED_VIDEO_ENCODING,
			kind: 'video',
			sha256: binding.sha256,
			sourceId: video.id,
			storageKey: video.storageKey,
		}),
		project,
		session,
		store: overlayDesktopSharedLinkedVideoOriginals(session, fallback),
		video,
	};
}

function linkedVideoProject(video: ReturnType<typeof createVideoSourceV9>): AudioEditorProjectCurrent {
	const clip = createVideoClipV9({
		id: 'linked-acquisition-video-clip', sourceId: video.id,
		durationFrames: video.frameCount, binItemId: 'linked-acquisition-video-bin-item',
	});
	return createCurrentAudioEditorProject({
		id: 'linked-acquisition-project', title: 'Linked acquisition project', revision: 1,
		now: '2026-08-01T12:00:00.000Z', sampleRate: SAMPLE_RATE,
		sources: [video], projectBin: { clips: [clip] },
	});
}

function memoryStore(context: TestContext, label: string): AudioEditorProjectStore {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `mixed-acquisition-${label}-${Date.now()}-${Math.random()}`,
	});
	context.after(async () => { await store.close(); });
	return store;
}

async function readMonoPcm(store: AudioEditorProjectStore, sourceId: string): Promise<number[]> {
	const samples: number[] = [];
	for await (const stored of store.readSourceChunks(sourceId, { migrateLegacyPcmOnAccess: false })) {
		const channels = Array.isArray(stored) ? stored : stored.channels;
		samples.push(...channels[0]);
	}
	return samples;
}

async function readMediaBytes(store: AudioEditorProjectStore, sourceId: string): Promise<Uint8Array | null> {
	const blob = await store.loadMediaAsset(sourceId, { backfillDigest: false });
	return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

function canonicalPcmBytes(samples: readonly number[]): Uint8Array {
	const bytes = new Uint8Array(4 + samples.length * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, samples.length, true);
	for (const [index, sample] of samples.entries()) view.setFloat32(4 + index * 4, sample, true);
	return bytes;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function mediaBlob(bytes: Uint8Array, type: string): Blob {
	return new Blob([bytes.slice().buffer as ArrayBuffer], { type });
}
