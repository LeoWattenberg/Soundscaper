/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV10, type AudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';

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
import { SCAPE_ARCHIVE_LIMITS } from '../src/common/editor/scape-archive-envelope.ts';
import { SCAPE_MAXIMUM_AUDIO_CHUNKS } from '../src/common/editor/scape-archive-media.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../src/common/editor/storage.js';
import {
	acquireDesktopSharedProjectAudio,
	DESKTOP_SHARED_AUDIO_ENCODING,
	prepareDesktopSharedProjectAudioHandoff,
	type DesktopSharedManagedSourceDescriptor,
	type DesktopSharedSourceTransferBridge,
} from '../src/common/editor/storage/desktop-shared-project-media-transfer.ts';

const SAMPLE_RATE = 48_000;

test('sender digests canonical PCM before upload and stability-checks a present binding', async () => {
	const fixture = audioFixture({
		id: 'two-pass-source',
		storageKey: 'two-pass-storage',
		samples: [[0.125, -0.25, 0.5, -1]],
	});
	const descriptor = managedDescriptor(fixture, 'a');
	let readPasses = 0;
	const uploaded: Uint8Array[] = [];
	let finished = 0;
	let aborted = 0;
	const bridge: DesktopSharedSourceTransferBridge = {
		async beginSharedSourceWrite(declaration) {
			assert.equal(readPasses, 1, 'the complete digest pass precedes upload admission');
			assert.deepEqual(declaration, {
				byteLength: fixture.bytes.byteLength,
				encoding: DESKTOP_SHARED_AUDIO_ENCODING,
				projectId: fixture.project.id,
				projectRevision: fixture.project.revision,
				sha256: fixture.sha256,
				sourceId: fixture.source.id,
			});
			return { status: 'ready', chunkSize: 5, writeId: 'two-pass-write' };
		},
		async writeSharedSourceChunk({ bytes, offset, writeId }) {
			assert.equal(writeId, 'two-pass-write');
			assert.equal(offset, byteLength(uploaded));
			assert.ok(bytes.byteLength <= 5);
			uploaded.push(bytes.slice());
			return { nextOffset: offset + bytes.byteLength };
		},
		async finishSharedSourceWrite({ sha256, writeId }) {
			finished += 1;
			assert.equal(readPasses, 2);
			assert.equal(writeId, 'two-pass-write');
			assert.equal(sha256, fixture.sha256);
			return descriptor;
		},
		async abortSharedSourceWrite() { aborted += 1; return true; },
		async readSharedSourceChunk() { throw new Error('sender must not read managed media'); },
	};

	const published = await prepareDesktopSharedProjectAudioHandoff(
		fixture.project,
		bridge,
		readableStore(fixture, () => { readPasses += 1; }),
	);
	assert.deepEqual(published, [descriptor]);
	assert.equal(Object.isFrozen(published), true);
	assert.equal(readPasses, 2);
	assert.deepEqual(joinBytes(uploaded), fixture.bytes);
	assert.equal(finished, 1);
	assert.equal(aborted, 0);

	let presentPasses = 0;
	let presentBodyCalls = 0;
	const presentBridge: DesktopSharedSourceTransferBridge = {
		async beginSharedSourceWrite(declaration) {
			assert.equal(presentPasses, 1);
			assert.equal(declaration.sha256, fixture.sha256);
			return { status: 'present', source: descriptor };
		},
		async writeSharedSourceChunk() { presentBodyCalls += 1; throw new Error('unexpected upload'); },
		async finishSharedSourceWrite() { presentBodyCalls += 1; throw new Error('unexpected finish'); },
		async abortSharedSourceWrite() { presentBodyCalls += 1; return true; },
		async readSharedSourceChunk() { throw new Error('sender must not read managed media'); },
	};
	assert.deepEqual(
		await prepareDesktopSharedProjectAudioHandoff(
			fixture.project,
			presentBridge,
			readableStore(fixture, () => { presentPasses += 1; }),
		),
		[descriptor],
	);
	assert.equal(presentPasses, 2, 'a present binding requires two digest passes but skips upload');
	assert.equal(presentBodyCalls, 0);

	let mutationPass = 0;
	await assert.rejects(prepareDesktopSharedProjectAudioHandoff(
		fixture.project,
		{ ...presentBridge, async beginSharedSourceWrite() { return { status: 'present', source: descriptor }; } },
		{ readSourceChunks() {
			mutationPass += 1;
			const samples = mutationPass === 1 ? fixture.samples : [[0.125, -0.25, 0.5, -0.5]];
			return (async function* changedSource() {
				yield { channels: samples.map((channel) => Float32Array.from(channel)) };
			})();
		} },
	), /changed while preparing/iu);
	assert.equal(mutationPass, 2);
});

test('recipient acquires exact managed PCM into a memory store', async (context) => {
	const fixture = audioFixture({
		id: 'acquired-source',
		storageKey: 'acquired-storage',
		samples: [[0.125, -0.25, 0.5, -1]],
	});
	const descriptor = managedDescriptor(fixture, 'b');
	const store = memoryStore(context, 'exact-acquisition');
	const reads: Readonly<{ bindingId: string; length: number; offset: number }>[] = [];
	const acquisition = await acquireDesktopSharedProjectAudio(
		fixture.project,
		null,
		[descriptor],
		{
			async readSharedSourceChunk(request) {
				reads.push(request);
				assert.equal(request.bindingId, descriptor.bindingId);
				return fixture.bytes.slice(request.offset, request.offset + request.length);
			},
		},
		store,
	);

	assert.deepEqual([...acquisition.trustedSourceIds], [fixture.source.id]);
	assert.equal(Object.isFrozen(acquisition), true);
	assert.deepEqual(reads, [{
		bindingId: descriptor.bindingId,
		length: fixture.bytes.byteLength,
		offset: 0,
	}]);
	assert.deepEqual(await readStoredPcm(store, fixture.source.storageKey), fixture.samples);
	const metadata = await store.getSourceMetadata(fixture.source.storageKey);
	assert.equal(metadata?.frameCount, fixture.source.frameCount);
	assert.equal(metadata?.channelCount, fixture.source.channelCount);
	acquisition.commit();
	await acquisition.rollback();
	assert.ok(await store.getSourceMetadata(fixture.source.storageKey), 'commit makes rollback inert');
});

test('a corrupt later download rolls back every acquired source', async (context) => {
	const first = audioFixture({
		id: 'rollback-source-a',
		storageKey: 'rollback-storage-a',
		samples: [[0.1, 0.2, 0.3, 0.4]],
	});
	const second = audioFixture({
		id: 'rollback-source-b',
		storageKey: 'rollback-storage-b',
		samples: [[-0.1, -0.2, -0.3, -0.4]],
	});
	const project = projectWithFixtures('corrupt-download-project', [first, second]);
	const firstDescriptor = managedDescriptor(first, 'c');
	const secondDescriptor = managedDescriptor(second, 'd');
	const corruptSecond = second.bytes.slice();
	corruptSecond[corruptSecond.byteLength - 1] ^= 0xff;
	const bodies = new Map([
		[firstDescriptor.bindingId, first.bytes],
		[secondDescriptor.bindingId, corruptSecond],
	]);
	const store = memoryStore(context, 'corrupt-rollback');

	await assert.rejects(
		acquireDesktopSharedProjectAudio(
			project,
			null,
			[firstDescriptor, secondDescriptor],
			{ async readSharedSourceChunk({ bindingId, length, offset }) {
				const body = bodies.get(bindingId);
				if (!body) throw new Error('unknown managed binding');
				return body.slice(offset, offset + length);
			} },
			store,
		),
		/SHA-256 verification/iu,
	);
	assert.equal(await store.getSourceMetadata(first.source.storageKey), null);
	assert.equal(await store.getSourceMetadata(second.source.storageKey), null);
	assert.deepEqual(await store.listSources(), []);
});

test('conflicting logical aliases fail preflight before either body is read', async (context) => {
	const first = audioFixture({
		id: 'alias-source-a',
		storageKey: 'shared-alias-storage',
		samples: [[0.1, 0.2, 0.3, 0.4]],
	});
	const second = audioFixture({
		id: 'alias-source-b',
		storageKey: 'shared-alias-storage',
		samples: [[0.5, 0.6]],
	});
	const project = projectWithFixtures('alias-conflict-project', [first, second]);
	const firstDescriptor = managedDescriptor(first, 'e');
	const secondDescriptor = managedDescriptor(second, 'f');
	const requestedBindings: string[] = [];
	const store = memoryStore(context, 'alias-conflict');

	await assert.rejects(
		acquireDesktopSharedProjectAudio(
			project,
			null,
			[firstDescriptor, secondDescriptor],
			{ async readSharedSourceChunk({ bindingId, length, offset }) {
				requestedBindings.push(bindingId);
				const body = bindingId === firstDescriptor.bindingId ? first.bytes : second.bytes;
				return body.slice(offset, offset + length);
			} },
			store,
		),
		/conflicting geometry/iu,
	);
	assert.deepEqual(requestedBindings, []);
	assert.equal(await store.getSourceMetadata(first.source.storageKey), null);
});

test('sender aborts an admitted upload when a chunk write fails', async () => {
	const fixture = audioFixture({
		id: 'aborted-upload-source',
		storageKey: 'aborted-upload-storage',
		samples: [[0.125, -0.25, 0.5, -1]],
	});
	const failure = new Error('injected managed upload failure');
	let readPasses = 0;
	const aborts: string[] = [];
	let finishes = 0;
	const bridge: DesktopSharedSourceTransferBridge = {
		async beginSharedSourceWrite() {
			return { status: 'ready', chunkSize: 4, writeId: 'aborted-upload-write' };
		},
		async writeSharedSourceChunk() { throw failure; },
		async finishSharedSourceWrite() {
			finishes += 1;
			throw new Error('unexpected finish');
		},
		async abortSharedSourceWrite(writeId) { aborts.push(writeId); return true; },
		async readSharedSourceChunk() { throw new Error('sender must not read managed media'); },
	};

	await assert.rejects(
		prepareDesktopSharedProjectAudioHandoff(
			fixture.project,
			bridge,
			readableStore(fixture, () => { readPasses += 1; }),
		),
		(error: unknown) => error === failure,
	);
	assert.equal(readPasses, 2);
	assert.deepEqual(aborts, ['aborted-upload-write']);
	assert.equal(finishes, 0);
});

test('sender rejects video-only and mixed projects before any media I/O', async (context) => {
	for (const includeAudio of [false, true]) {
		await context.test(includeAudio ? 'mixed media' : 'video only', async () => {
			const project = projectWithReachableVideo(includeAudio);
			const guarded = guardedSenderPorts();
			await assert.rejects(
				prepareDesktopSharedProjectAudioHandoff(project, guarded.bridge, guarded.store),
				/video.*PCM-only|PCM-only.*video/iu,
			);
			assert.equal(guarded.ioCalls(), 0);
		});
	}
});

test('source-free sender handoff succeeds without transfer capabilities', async () => {
	const project = createAudioEditorProjectV10({
		id: 'source-free-handoff', title: 'Source-free handoff', revision: 1,
		now: '2026-08-01T12:00:00.000Z',
	});
	assert.deepEqual(
		await prepareDesktopSharedProjectAudioHandoff(project, null as never, null as never),
		[],
	);
});

test('sender preflights individual and aggregate PCM byte limits before reading a source', async (context) => {
	const framesAtRawLimit = SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes
		/ (64 * Float32Array.BYTES_PER_ELEMENT);
	const cases = [
		{
			label: 'individual source',
			project: metadataAudioProject('individual-byte-limit', [
				{ id: 'individual', storageKey: 'individual-storage', frameCount: framesAtRawLimit, channelCount: 64 },
			]),
		},
		{
			label: 'aggregate sources',
			project: metadataAudioProject('aggregate-byte-limit', [
				{ id: 'aggregate-a', storageKey: 'aggregate-storage-a', frameCount: framesAtRawLimit / 2, channelCount: 64 },
				{ id: 'aggregate-b', storageKey: 'aggregate-storage-b', frameCount: framesAtRawLimit / 2, channelCount: 64 },
			]),
		},
	];
	for (const entry of cases) {
		await context.test(entry.label, async () => {
			const guarded = guardedSenderPorts();
			await assert.rejects(
				prepareDesktopSharedProjectAudioHandoff(entry.project, guarded.bridge, guarded.store),
				/expanded-byte limit/iu,
			);
			assert.equal(guarded.ioCalls(), 0);
		});
	}
});

test('sender preflights the aggregate canonical PCM chunk limit before reading a source', async () => {
	const chunksPerSource = Math.floor(SCAPE_MAXIMUM_AUDIO_CHUNKS / 2) + 1;
	const project = metadataAudioProject('aggregate-chunk-limit', [
		{ id: 'chunks-a', storageKey: 'chunks-storage-a', frameCount: chunksPerSource, chunkFrames: 1 },
		{ id: 'chunks-b', storageKey: 'chunks-storage-b', frameCount: chunksPerSource, chunkFrames: 1 },
	]);
	const guarded = guardedSenderPorts();

	await assert.rejects(
		prepareDesktopSharedProjectAudioHandoff(project, guarded.bridge, guarded.store),
		/PCM chunk limit/iu,
	);
	assert.equal(guarded.ioCalls(), 0);
});

test('sender preflight counts aliased audio storage geometry only once', async () => {
	const failure = new Error('first source read reached');
	const frameCount = SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes
		/ (64 * Float32Array.BYTES_PER_ELEMENT * 2);
	const project = metadataAudioProject('deduplicated-byte-limit', [
		{ id: 'alias-a', storageKey: 'aliased-storage', frameCount, channelCount: 64 },
		{ id: 'alias-b', storageKey: 'aliased-storage', frameCount, channelCount: 64 },
	]);
	let reads = 0;
	const guarded = guardedSenderPorts(() => {
		reads += 1;
		throw failure;
	});

	await assert.rejects(
		prepareDesktopSharedProjectAudioHandoff(project, guarded.bridge, guarded.store),
		(error) => error === failure,
	);
	assert.equal(reads, 1);
});

interface AudioFixture {
	readonly bytes: Uint8Array;
	readonly project: AudioEditorProjectV10;
	readonly samples: readonly (readonly number[])[];
	readonly sha256: string;
	readonly source: ReturnType<typeof createAudioSourceV9>;
}

function audioFixture({
	id,
	storageKey,
	samples,
}: Readonly<{
	id: string;
	storageKey: string;
	samples: readonly (readonly number[])[];
}>): AudioFixture {
	assert.ok(samples.length > 0);
	const frameCount = samples[0]?.length ?? 0;
	assert.ok(frameCount > 0 && samples.every((channel) => channel.length === frameCount));
	const source = createAudioSourceV9({
		id,
		storageKey,
		name: `${id}.wav`,
		mimeType: 'audio/wav',
		frameCount,
		channelCount: samples.length,
		sampleRate: SAMPLE_RATE,
		originalSampleRate: SAMPLE_RATE,
		sampleFormat: 'float32',
		chunkFrames: frameCount,
	});
	const bytes = canonicalPcmBytes(samples);
	const fixture = {
		bytes,
		samples,
		sha256: digest(bytes),
		source,
		project: null,
	} as unknown as AudioFixture;
	Object.defineProperty(fixture, 'project', {
		value: projectWithFixtures(`${id}-project`, [fixture]),
		enumerable: true,
	});
	return fixture;
}

function metadataAudioProject(
	id: string,
	specifications: readonly Readonly<{
		id: string;
		storageKey: string;
		frameCount: number;
		channelCount?: number;
		chunkFrames?: number;
	}>[],
): AudioEditorProjectV10 {
	const sources = specifications.map((value) => createAudioSourceV9({
		...value,
		name: `${value.id}.wav`,
		mimeType: 'audio/wav',
		sampleRate: SAMPLE_RATE,
		originalSampleRate: SAMPLE_RATE,
		sampleFormat: 'float32',
		channelCount: value.channelCount ?? 1,
		chunkFrames: value.chunkFrames ?? 65_536,
	}));
	const clips = sources.map((source) => createAudioClipV9({
		id: `${source.id}-clip`, sourceId: source.id,
		durationFrames: source.frameCount, sourceDurationFrames: source.frameCount,
	}));
	return createAudioEditorProjectV10({
		id, title: 'Metadata-only handoff preflight', revision: 1,
		now: '2026-08-01T12:00:00.000Z', sources, clips,
		tracks: [createAudioTrackV9({ id: `${id}-track`, clipIds: clips.map(({ id: clipId }) => clipId) })],
	});
}

function projectWithReachableVideo(includeAudio: boolean): AudioEditorProjectV10 {
	const video = createVideoSourceV9({
		id: 'preflight-video', storageKey: 'preflight-video-storage', name: 'video.mp4',
		mimeType: 'video/mp4', frameCount: 30, sampleRate: SAMPLE_RATE,
		width: 1_920, height: 1_080, frameRate: 30, videoCodec: 'h264',
		audioCodec: null, hasAudio: false,
	});
	const audio = createAudioSourceV9({
		id: 'preflight-audio', storageKey: 'preflight-audio-storage', frameCount: 1,
		channelCount: 1, sampleRate: SAMPLE_RATE, originalSampleRate: SAMPLE_RATE,
		sampleFormat: 'float32', chunkFrames: 1,
	});
	const audioClip = createAudioClipV9({
		id: 'preflight-audio-clip', sourceId: audio.id, durationFrames: 1,
	});
	return createAudioEditorProjectV10({
		id: includeAudio ? 'mixed-preflight' : 'video-preflight',
		title: 'Video handoff preflight', revision: 1, now: '2026-08-01T12:00:00.000Z',
		sources: includeAudio ? [audio, video] : [video],
		clips: includeAudio ? [audioClip] : [],
		tracks: includeAudio ? [createAudioTrackV9({ id: 'preflight-track', clipIds: [audioClip.id] })] : [],
		projectBin: { clips: [createVideoClipV9({
			id: 'preflight-video-clip', sourceId: video.id, durationFrames: 1,
			binItemId: 'preflight-video-item',
		})] },
	});
}

function guardedSenderPorts(onRead?: () => never) {
	let calls = 0;
	const unexpected = (): never => {
		calls += 1;
		throw new Error('unexpected sender media I/O');
	};
	const bridge: DesktopSharedSourceTransferBridge = {
		async beginSharedSourceWrite() { return unexpected(); },
		async writeSharedSourceChunk() { return unexpected(); },
		async finishSharedSourceWrite() { return unexpected(); },
		async abortSharedSourceWrite() { return unexpected(); },
		async readSharedSourceChunk() { return unexpected(); },
	};
	return {
		bridge,
		store: { readSourceChunks() { calls += 1; return onRead ? onRead() : unexpected(); } },
		ioCalls: () => calls,
	};
}

function projectWithFixtures(id: string, fixtures: readonly AudioFixture[]): AudioEditorProjectV10 {
	const clips = fixtures.map(({ source }, index) => createAudioClipV9({
		id: `${id}-clip-${String(index)}`,
		sourceId: source.id,
		title: `${source.id} clip`,
		durationFrames: source.frameCount,
		sourceDurationFrames: source.frameCount,
	}));
	return createAudioEditorProjectV10({
		id,
		title: 'Managed PCM transfer',
		revision: 1,
		now: '2026-08-01T12:00:00.000Z',
		sampleRate: SAMPLE_RATE,
		sources: fixtures.map(({ source }) => source),
		clips,
		tracks: [createAudioTrackV9({ id: `${id}-track`, clipIds: clips.map(({ id: clipId }) => clipId) })],
	});
}

function managedDescriptor(
	fixture: AudioFixture,
	bindingCharacter: string,
): DesktopSharedManagedSourceDescriptor {
	return Object.freeze({
		bindingId: `m${bindingCharacter.repeat(64)}`,
		byteLength: fixture.bytes.byteLength,
		encoding: DESKTOP_SHARED_AUDIO_ENCODING,
		kind: 'audio',
		sha256: fixture.sha256,
		sourceId: fixture.source.id,
		storageKey: fixture.source.storageKey,
	});
}

function readableStore(fixture: AudioFixture, onRead: () => void) {
	return {
		readSourceChunks(sourceId: string) {
			assert.equal(sourceId, fixture.source.storageKey);
			onRead();
			return (async function* sourceChunks() {
				yield { channels: fixture.samples.map((samples) => Float32Array.from(samples)) };
			})();
		},
	};
}

function memoryStore(context: TestContext, label: string): AudioEditorProjectStore {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `shared-media-transfer-${label}-${Date.now()}-${Math.random()}`,
	});
	context.after(async () => { await store.close(); });
	return store;
}

async function readStoredPcm(
	store: AudioEditorProjectStore,
	storageKey: string,
): Promise<readonly (readonly number[])[]> {
	const channels: number[][] = [];
	for await (const stored of store.readSourceChunks(storageKey, { migrateLegacyPcmOnAccess: false })) {
		const chunkChannels = Array.isArray(stored) ? stored : stored.channels;
		for (const [index, channel] of chunkChannels.entries()) {
			channels[index] ??= [];
			channels[index]?.push(...channel);
		}
	}
	return channels;
}

function canonicalPcmBytes(channels: readonly (readonly number[])[]): Uint8Array {
	const frameCount = channels[0]?.length ?? 0;
	const bytes = new Uint8Array(4 + frameCount * channels.length * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, frameCount, true);
	let offset = 4;
	for (const channel of channels) {
		for (const sample of channel) {
			view.setFloat32(offset, sample, true);
			offset += Float32Array.BYTES_PER_ELEMENT;
		}
	}
	return bytes;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function byteLength(chunks: readonly Uint8Array[]): number {
	return chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
}

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(byteLength(chunks));
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}
