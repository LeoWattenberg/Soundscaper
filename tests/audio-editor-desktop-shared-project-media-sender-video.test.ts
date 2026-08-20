/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
} from '../src/common/editor/project-media-factory.ts';
import {
	createCurrentAudioEditorProject,
	type AudioEditorProjectCurrent,
} from '../src/common/editor/project-current.ts';
import { SCAPE_ARCHIVE_LIMITS } from '../src/common/editor/scape-archive-envelope.ts';
import {
	DESKTOP_SHARED_AUDIO_ENCODING,
	DESKTOP_SHARED_VIDEO_ENCODING,
	DESKTOP_SHARED_VIDEO_TIMING_ENCODING,
	prepareDesktopSharedProjectMediaHandoff,
	type DesktopSharedManagedSourceDescriptor,
	type DesktopSharedSourceTransferBridge,
} from '../src/common/editor/storage/desktop-shared-project-media-transfer.ts';
import {
	createVideoTimingAssetPublication,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../src/common/editor/video-timing-asset.ts';

const SAMPLE_RATE = 48_000;

test('mixed sender preflights trusted video metadata before two-pass bounded publication', async () => {
	const fixture = mixedFixture();
	const events: string[] = [];
	const store = senderStore(fixture, events);
	const declarations = new Map<string, Readonly<{
		byteLength: number;
		encoding: typeof DESKTOP_SHARED_AUDIO_ENCODING
			| typeof DESKTOP_SHARED_VIDEO_ENCODING
			| typeof DESKTOP_SHARED_VIDEO_TIMING_ENCODING;
		sha256: string;
		sourceId: string;
	}>>();
	const uploads = new Map<string, Uint8Array[]>();
	const bridge = senderBridge({
		async begin(declaration) {
			events.push(`begin:${declaration.sourceId}`);
			declarations.set(declaration.sourceId, declaration);
			return { status: 'ready', chunkSize: 3, writeId: `write-${declaration.sourceId}` };
		},
		async write({ bytes, offset, writeId }) {
			const chunks = uploads.get(writeId) ?? [];
			assert.equal(offset, chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
			assert.ok(bytes.byteLength <= 3);
			chunks.push(bytes.slice());
			uploads.set(writeId, chunks);
			return { nextOffset: offset + bytes.byteLength };
		},
		async finish({ sha256, writeId }) {
			const declaration = [...declarations.values()].find(({ sourceId }) => writeId === `write-${sourceId}`);
			if (!declaration) throw new Error('Missing declaration');
			assert.equal(sha256, declaration.sha256);
			return managedDescriptor(fixture, declaration);
		},
	});

	const published = await prepareDesktopSharedProjectMediaHandoff(fixture.project, bridge, store);

	assert.deepEqual(published.map(({ kind }) => kind), ['audio', 'video']);
	assert.equal(events[0], `metadata:${fixture.video.storageKey}`);
	assert.equal(events.filter((event) => event === `load:${fixture.video.storageKey}`).length, 2);
	assert.equal(events.filter((event) => event === `metadata:${fixture.video.storageKey}`).length, 3);
	assert.deepEqual(joinBytes(uploads.get(`write-${fixture.video.id}`) ?? []), fixture.videoBytes);
	assert.equal(declarations.get(fixture.video.id)?.encoding, DESKTOP_SHARED_VIDEO_ENCODING);
	assert.equal(declarations.get(fixture.video.id)?.byteLength, fixture.videoBytes.byteLength);
	assert.equal(declarations.get(fixture.video.id)?.sha256, fixture.videoSha256);
});

test('managed sender carries digest-bound video timing and rejects corrupt timing bytes', async () => {
	const fixture = mixedFixture({ audio: false });
	const timing = createVideoTimingAssetPublication(fixture.videoSha256, {
		timescale: 1_000,
		presentationTicks: [0n],
		finalFrameDurationTicks: 40n,
	});
	const project = createCurrentAudioEditorProject({
		...fixture.project,
		sources: fixture.project.sources.map((source) => source.id === fixture.video.id ? {
			...source,
			contentSha256: fixture.videoSha256,
			sourceFrameCount: timing.reference.frameCount,
			timingAsset: timing.reference,
		} : source),
	});
	const baseStore = senderStore(fixture, []);
	const timingMetadata = {
		sourceId: timing.reference.storageKey,
		storage: 'indexeddb-blob',
		path: undefined,
		committedAt: '2026-08-01T12:00:00.000Z',
		mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
		size: timing.bytes.byteLength,
		sha256: timing.reference.sha256,
	};
	let corrupt = false;
	const store = {
		...baseStore,
		getMediaAssetMetadata(storageKey: string) {
			return storageKey === timing.reference.storageKey
				? timingMetadata
				: baseStore.getMediaAssetMetadata(storageKey);
		},
		loadMediaAsset(storageKey: string) {
			if (storageKey !== timing.reference.storageKey) return baseStore.loadMediaAsset(storageKey);
			const bytes = timing.bytes.slice();
			if (corrupt) bytes[bytes.byteLength - 1] ^= 1;
			return Promise.resolve(mediaBlob(bytes, VIDEO_TIMING_ASSET_MIME_TYPE));
		},
	};
	const bridge = senderBridge({
		async begin(declaration) {
			return declaration.encoding === DESKTOP_SHARED_VIDEO_ENCODING
				? { status: 'present', source: videoDescriptor(fixture, '4') }
				: { status: 'present', source: Object.freeze({
					bindingId: `t${'5'.repeat(64)}`,
					byteLength: timing.bytes.byteLength,
					encoding: DESKTOP_SHARED_VIDEO_TIMING_ENCODING,
					kind: 'video-timing' as const,
					sha256: timing.reference.sha256,
					sourceId: fixture.video.id,
					storageKey: timing.reference.storageKey,
				}) };
		},
	});
	assert.deepEqual(
		(await prepareDesktopSharedProjectMediaHandoff(project, bridge, store)).map(({ kind }) => kind),
		['video', 'video-timing'],
	);
	corrupt = true;
	await assert.rejects(
		prepareDesktopSharedProjectMediaHandoff(project, bridge, store),
		/digest binding/iu,
	);
});

test('managed sender rejects self-consistent malformed timing before publishing it', async () => {
	const fixture = mixedFixture({ audio: false });
	const malformedBytes = new Uint8Array(40);
	const malformedSha256 = digest(malformedBytes);
	const reference = Object.freeze({
		encoding: 'soundscaper-video-timing-v1' as const,
		storageKey: `video-timing-sha256:${malformedSha256}`,
		sha256: malformedSha256,
		sourceSha256: fixture.videoSha256,
		byteLength: malformedBytes.byteLength,
		frameCount: 1,
		timescale: 1_000,
		finalFrameDurationTicks: '40',
	});
	const project = createCurrentAudioEditorProject({
		...fixture.project,
		sources: fixture.project.sources.map((source) => source.id === fixture.video.id ? {
			...source,
			contentSha256: fixture.videoSha256,
			sourceFrameCount: 1,
			timingAsset: reference,
		} : source),
	});
	const baseStore = senderStore(fixture, []);
	const store = {
		...baseStore,
		getMediaAssetMetadata(storageKey: string) {
			if (storageKey !== reference.storageKey) return baseStore.getMediaAssetMetadata(storageKey);
			return {
				sourceId: reference.storageKey, storage: 'indexeddb-blob', path: undefined,
				committedAt: '2026-08-01T12:00:00.000Z', mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
				size: malformedBytes.byteLength, sha256: malformedSha256,
			};
		},
		loadMediaAsset(storageKey: string) {
			return storageKey === reference.storageKey
				? Promise.resolve(mediaBlob(malformedBytes, VIDEO_TIMING_ASSET_MIME_TYPE))
				: baseStore.loadMediaAsset(storageKey);
		},
	};
	let timingAdmissions = 0;
	const bridge = senderBridge({
		async begin(declaration) {
			if (declaration.encoding === DESKTOP_SHARED_VIDEO_ENCODING) {
				return { status: 'present', source: videoDescriptor(fixture, '4') };
			}
			timingAdmissions += 1;
			return { status: 'present', source: Object.freeze({
				bindingId: `t${'5'.repeat(64)}`, byteLength: reference.byteLength,
				encoding: DESKTOP_SHARED_VIDEO_TIMING_ENCODING, kind: 'video-timing' as const,
				sha256: reference.sha256, sourceId: fixture.video.id, storageKey: reference.storageKey,
			}) };
		},
	});
	await assert.rejects(
		prepareDesktopSharedProjectMediaHandoff(project, bridge, store),
		/magic|timing asset|codec/iu,
	);
	assert.equal(timingAdmissions, 0);
});

test('managed sender excludes disposable preview locators while retaining fallback-only media', async () => {
	const fixture = mixedFixture({ audioFallbackOnly: true });
	assert.ok(fixture.audio);
	const posterLocator = 'disposable-cache:poster:relationship-sentinel';
	const thumbnailLocator = 'disposable-cache:thumbnail:relationship-sentinel';
	const project = {
		...fixture.project,
		sources: fixture.project.sources.map((source) => source.id === fixture.video.id
			? { ...source, posterStorageKey: posterLocator, thumbnailStorageKey: thumbnailLocator }
			: source),
	} as AudioEditorProjectCurrent;
	const declarations: Array<Parameters<DesktopSharedSourceTransferBridge['beginSharedSourceWrite']>[0]> = [];
	const bridge = senderBridge({
		async begin(declaration) {
			declarations.push(declaration);
			return { status: 'present', source: managedDescriptor(fixture, declaration) };
		},
	});

	const published = await prepareDesktopSharedProjectMediaHandoff(
		project,
		bridge,
		senderStore(fixture, []),
	);

	assert.deepEqual(declarations.map(({ sourceId }) => sourceId), [fixture.video.id, fixture.audio.id]);
	assert.deepEqual(published.map(({ sourceId }) => sourceId), [fixture.video.id, fixture.audio.id]);
	assert.equal(
		[...project.clips, ...project.projectBin.clips].some(({ sourceId }) => sourceId === fixture.audio?.id),
		false,
	);
	assert.equal(project.featureRequirements.requirements[0]?.fallback?.sourceId, fixture.audio.id);
	for (const value of [...declarations, ...published]) {
		const managedValue = JSON.stringify(value);
		assert.equal(managedValue.includes(posterLocator), false);
		assert.equal(managedValue.includes(thumbnailLocator), false);
		assert.equal(Object.hasOwn(value, 'posterStorageKey'), false);
		assert.equal(Object.hasOwn(value, 'thumbnailStorageKey'), false);
	}
});

test('present video sender performs two full validations without uploading', async () => {
	const fixture = mixedFixture({ audio: false });
	const events: string[] = [];
	const descriptor = videoDescriptor(fixture, 'a');
	let bodyCalls = 0;
	const bridge = senderBridge({
		begin: async () => ({ status: 'present', source: descriptor }),
		async write() { bodyCalls += 1; throw new Error('unexpected write'); },
		async finish() { bodyCalls += 1; throw new Error('unexpected finish'); },
		async abort() { bodyCalls += 1; return true; },
	});

	assert.deepEqual(
		await prepareDesktopSharedProjectMediaHandoff(fixture.project, bridge, senderStore(fixture, events)),
		[descriptor],
	);
	assert.equal(events.filter((event) => event.startsWith('load:')).length, 2);
	assert.equal(bodyCalls, 0);
});

test('invalid ready video admission aborts its reserved upload session', async () => {
	const fixture = mixedFixture({ audio: false });
	let aborts = 0;
	const bridge = senderBridge({
		begin: async () => ({ status: 'ready', chunkSize: 0, writeId: 'bad-video-write' }),
		async abort(writeId) { assert.equal(writeId, 'bad-video-write'); aborts += 1; return true; },
	});

	await assert.rejects(
		prepareDesktopSharedProjectMediaHandoff(fixture.project, bridge, senderStore(fixture, [])),
		/chunk size/iu,
	);
	assert.equal(aborts, 1);
});

test('second video pass mutation aborts the admitted upload without finishing', async () => {
	const fixture = mixedFixture({ audio: false });
	let loads = 0;
	const baseStore = senderStore(fixture, []);
	const store = {
		...baseStore,
		loadMediaAsset(sourceId: string) {
			assert.equal(sourceId, fixture.video.storageKey);
			loads += 1;
			const bytes = loads === 1 ? fixture.videoBytes : Uint8Array.of(2, 4, 6, 8, 10, 12, 14);
			return Promise.resolve(mediaBlob(bytes, fixture.video.mimeType));
		},
	};
	let aborts = 0;
	let finishes = 0;
	const bridge = senderBridge({
		begin: async () => ({ status: 'ready', chunkSize: 3, writeId: 'mutated-video-write' }),
		write: async ({ bytes, offset }) => ({ nextOffset: offset + bytes.byteLength }),
		async finish() { finishes += 1; return videoDescriptor(fixture, 'd'); },
		async abort(writeId) { assert.equal(writeId, 'mutated-video-write'); aborts += 1; return true; },
	});

	await assert.rejects(
		prepareDesktopSharedProjectMediaHandoff(fixture.project, bridge, store),
		/changed while preparing/iu,
	);
	assert.equal(loads, 2);
	assert.equal(aborts, 1);
	assert.equal(finishes, 0);
});

test('untrusted video metadata fails before retained bytes or the bridge are touched', async () => {
	const fixture = mixedFixture({ audio: false });
	let bodyCalls = 0;
	const baseStore = senderStore(fixture, [], { onBody: () => { bodyCalls += 1; } });
	const store = { ...baseStore, getMediaAssetMetadata: () => ({ ...mediaMetadata(fixture), sha256: undefined }) };
	const bridge = senderBridge({ async begin() { bodyCalls += 1; throw new Error('unexpected admission'); } });

	await assert.rejects(
		prepareDesktopSharedProjectMediaHandoff(fixture.project, bridge, store),
		/invalid trusted retained-media metadata/iu,
	);
	assert.equal(bodyCalls, 0);
});

test('mixed sender refuses aggregate video and PCM bytes before body or bridge I/O', async () => {
	const fixture = mixedFixture();
	let bodyCalls = 0;
	const store = senderStore(fixture, [], {
		videoSize: SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes,
		onBody: () => { bodyCalls += 1; },
	});
	const bridge = senderBridge({ async begin() { bodyCalls += 1; throw new Error('unexpected bridge admission'); } });

	await assert.rejects(
		prepareDesktopSharedProjectMediaHandoff(fixture.project, bridge, store),
		/cumulative actual expanded-byte limit/iu,
	);
	assert.equal(bodyCalls, 0);
});

interface MixedFixture {
	readonly audio: ReturnType<typeof createAudioSource> | null;
	readonly audioBytes: Uint8Array;
	readonly project: AudioEditorProjectCurrent;
	readonly video: ReturnType<typeof createVideoSource>;
	readonly videoBytes: Uint8Array;
	readonly videoSha256: string;
}

function mixedFixture(options: Readonly<{ audio?: boolean; audioFallbackOnly?: boolean }> = {}): MixedFixture {
	const includeAudio = options.audio !== false;
	const audioFallbackOnly = includeAudio && options.audioFallbackOnly === true;
	const audio = includeAudio ? createAudioSource({
		id: 'mixed-audio', storageKey: 'mixed-audio-storage', name: 'mixed.wav', mimeType: 'audio/wav',
		frameCount: 2, channelCount: 1, sampleRate: SAMPLE_RATE, originalSampleRate: SAMPLE_RATE,
		sampleFormat: 'float32', chunkFrames: 2,
	}) : null;
	const video = createVideoSource({
		id: 'mixed-video', storageKey: 'mixed-video-storage', name: 'mixed.mp4', mimeType: 'video/mp4',
		frameCount: 30, sampleRate: SAMPLE_RATE, width: 1_920, height: 1_080,
		frameRate: 30, videoCodec: 'h264', audioCodec: null, hasAudio: false,
	});
	const audioBytes = canonicalPcmBytes([0.25, -0.5]);
	const audioClip = audio && !audioFallbackOnly ? createAudioClip({
		id: 'mixed-audio-clip', sourceId: audio.id, durationFrames: 2, sourceDurationFrames: 2,
	}) : null;
	const videoClip = createVideoClip({
		id: 'mixed-video-clip', sourceId: video.id, durationFrames: 30, binItemId: 'mixed-video-item',
	});
	const project = createCurrentAudioEditorProject({
		id: includeAudio ? 'mixed-media-project' : 'video-project', title: 'Managed mixed media', revision: 7,
		now: '2026-08-01T12:00:00.000Z', sampleRate: SAMPLE_RATE,
		sources: audio ? [audio, video] : [video],
		clips: audioClip ? [audioClip] : [],
		tracks: audioClip ? [createAudioTrack({ id: 'mixed-track', clipIds: [audioClip.id] })] : [],
		projectBin: { clips: [videoClip] },
		featureRequirements: audioFallbackOnly && audio ? {
			schemaVersion: 1,
			requirements: [{
				id: 'fallback-only-audio',
				featureId: 'org.soundscaper.native.fallback-only-audio',
				displayName: 'Fallback-only audio',
				disposition: 'rendered-fallback',
				fallback: { kind: 'audio', sourceId: audio.id, sha256: digest(audioBytes) },
			}],
		} : undefined,
	});
	const videoBytes = Uint8Array.of(1, 3, 5, 7, 9, 11, 13);
	return Object.freeze({ audio, audioBytes, project, video, videoBytes, videoSha256: digest(videoBytes) });
}

function senderStore(
	fixture: MixedFixture,
	events: string[],
	options: Readonly<{ videoSize?: number; onBody?: () => void }> = {},
) {
	return {
		getMediaAssetMetadata(sourceId: string) {
			assert.equal(sourceId, fixture.video.storageKey);
			events.push(`metadata:${sourceId}`);
			return mediaMetadata(fixture, options.videoSize);
		},
		loadMediaAsset(sourceId: string) {
			assert.equal(sourceId, fixture.video.storageKey);
			options.onBody?.();
			events.push(`load:${sourceId}`);
			return Promise.resolve(mediaBlob(fixture.videoBytes, fixture.video.mimeType));
		},
		readSourceChunks(sourceId: string) {
			if (!fixture.audio || sourceId !== fixture.audio.storageKey) throw new Error('Unexpected PCM source');
			options.onBody?.();
			events.push(`pcm:${sourceId}`);
			return (async function* chunks() { yield { channels: [Float32Array.of(0.25, -0.5)] }; })();
		},
	};
}

function mediaMetadata(fixture: MixedFixture, size = fixture.videoBytes.byteLength) {
	return {
		sourceId: fixture.video.storageKey,
		storage: 'indexeddb-blob',
		path: undefined,
		committedAt: '2026-08-01T12:00:00.000Z',
		mimeType: fixture.video.mimeType,
		size,
		sha256: fixture.videoSha256,
	};
}

interface BridgeOverrides {
	begin?: DesktopSharedSourceTransferBridge['beginSharedSourceWrite'];
	write?: DesktopSharedSourceTransferBridge['writeSharedSourceChunk'];
	finish?: DesktopSharedSourceTransferBridge['finishSharedSourceWrite'];
	abort?: DesktopSharedSourceTransferBridge['abortSharedSourceWrite'];
}

function senderBridge(overrides: BridgeOverrides): DesktopSharedSourceTransferBridge {
	const unexpected = (): never => { throw new Error('Unexpected shared-source bridge call'); };
	return {
		beginSharedSourceWrite: overrides.begin ?? (async () => unexpected()),
		writeSharedSourceChunk: overrides.write ?? (async () => unexpected()),
		finishSharedSourceWrite: overrides.finish ?? (async () => unexpected()),
		abortSharedSourceWrite: overrides.abort ?? (async () => unexpected()),
		readSharedSourceChunk: async () => unexpected(),
	};
}

function managedDescriptor(
	fixture: MixedFixture,
	declaration: Readonly<{ byteLength: number; encoding: string; sha256: string; sourceId: string }>,
): DesktopSharedManagedSourceDescriptor {
	if (declaration.encoding === DESKTOP_SHARED_VIDEO_ENCODING) return videoDescriptor(fixture, 'b');
	if (!fixture.audio) throw new Error('Missing audio source');
	return Object.freeze({
		bindingId: `m${'c'.repeat(64)}`, byteLength: declaration.byteLength,
		encoding: DESKTOP_SHARED_AUDIO_ENCODING, kind: 'audio', sha256: declaration.sha256,
		sourceId: declaration.sourceId, storageKey: fixture.audio.storageKey,
	});
}

function videoDescriptor(fixture: MixedFixture, character: string): DesktopSharedManagedSourceDescriptor {
	return Object.freeze({
		bindingId: `v${character.repeat(64)}`, byteLength: fixture.videoBytes.byteLength,
		encoding: DESKTOP_SHARED_VIDEO_ENCODING, kind: 'video', sha256: fixture.videoSha256,
		sourceId: fixture.video.id, storageKey: fixture.video.storageKey,
	});
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

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
	const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
	return output;
}
