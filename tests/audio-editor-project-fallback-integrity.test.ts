/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { SCAPE_ARCHIVE_LIMITS } from '../src/common/editor/scape-archive-envelope.ts';
import { verifyProjectFallbackIntegrity } from '../src/common/editor/project-fallback-integrity.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';
import { createProjectStore } from '../src/common/editor/storage.js';

const AUDIO_ID = 'rendered-audio';
const VIDEO_ID = 'rendered-video';
const AUDIO_SAMPLES = [0.25, -0.5, 0.75, 0] as const;
const VIDEO_BYTES = Uint8Array.of(0x73, 0x63, 0x61, 0x70, 0x65);

type ProjectStore = ReturnType<typeof createProjectStore>;

test('stored fallback verification hashes canonical audio and actual video bytes', async () => {
	const store = memoryStore('fallback-integrity-success');
	await persistAudio(store, 'audio-storage', AUDIO_SAMPLES);
	await store.writeMediaAsset('video-storage', new Blob([VIDEO_BYTES]), { mimeType: 'video/mp4' });

	await verifyProjectFallbackIntegrity(project([
		source(AUDIO_ID, 'audio', 'audio-storage'),
		source(VIDEO_ID, 'video', 'video-storage'),
	], [
		claim('audio-fallback', AUDIO_ID, 'audio', audioDigest(AUDIO_SAMPLES)),
		claim('video-fallback', VIDEO_ID, 'video', digest(VIDEO_BYTES)),
	]), store);

	await store.writeMediaAsset('video-corrupt', new Blob([Uint8Array.of(0x73, 0x63, 0x61, 0x70, 0x66)]));
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(project([
			source(VIDEO_ID, 'video', 'video-corrupt'),
		], [claim('video-fallback', VIDEO_ID, 'video', digest(VIDEO_BYTES))]), store),
		/rendered fallback source rendered-video.*SHA-256/iu,
	);
});

test('stored fallback verification disables storage maintenance for admission reads', async () => {
	let audioMigrationEnabled: boolean | undefined;
	let videoBackfillEnabled: boolean | undefined;
	await verifyProjectFallbackIntegrity(project([
		source(AUDIO_ID, 'audio', 'audio-storage'),
		source(VIDEO_ID, 'video', 'video-storage'),
	], [
		claim('audio-fallback', AUDIO_ID, 'audio', audioDigest(AUDIO_SAMPLES)),
		claim('video-fallback', VIDEO_ID, 'video', digest(VIDEO_BYTES)),
	]), {
		async *readSourceChunks(_sourceId, options) {
			audioMigrationEnabled = options?.migrateLegacyPcmOnAccess;
			yield [Float32Array.from(AUDIO_SAMPLES)];
		},
		getMediaAssetMetadata() { return { size: VIDEO_BYTES.byteLength }; },
		loadMediaAsset(_sourceId, options) {
			videoBackfillEnabled = options?.backfillDigest;
			return new Blob([VIDEO_BYTES]);
		},
	});

	assert.equal(audioMigrationEnabled, false);
	assert.equal(videoBackfillEnabled, false);
});

test('stored fallback verification rejects digest drift, missing assets, and malformed PCM geometry', async () => {
	const store = memoryStore('fallback-integrity-rejection');
	await persistAudio(store, 'audio-storage', AUDIO_SAMPLES);
	const audioProject = project([
		source(AUDIO_ID, 'audio', 'audio-storage'),
	], [claim('audio-fallback', AUDIO_ID, 'audio', 'f'.repeat(64))]);
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(audioProject, store),
		/rendered fallback source rendered-audio.*SHA-256/iu,
	);

	const missingVideo = project([
		source(VIDEO_ID, 'video', 'missing-video'),
	], [claim('video-fallback', VIDEO_ID, 'video', digest(VIDEO_BYTES))]);
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(missingVideo, store),
		/rendered fallback source rendered-video.*unavailable/iu,
	);

	const malformedStore = {
		async *readSourceChunks() { yield [Float32Array.of(1, 2)]; },
	};
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(project([
			source(AUDIO_ID, 'audio', 'malformed-audio'),
		], [claim('audio-fallback', AUDIO_ID, 'audio', audioDigest(AUDIO_SAMPLES))]), malformedStore),
		/noncanonical PCM chunk geometry/iu,
	);
});

test('duplicate fallback claims hash one source once and conflicting digests fail before storage', async () => {
	let reads = 0;
	const store = {
		async *readSourceChunks() {
			reads += 1;
			yield [Float32Array.from(AUDIO_SAMPLES)];
		},
	};
	const audioSource = source(AUDIO_ID, 'audio', 'audio-storage');
	const first = claim('fallback-one', AUDIO_ID, 'audio', audioDigest(AUDIO_SAMPLES));
	const second = claim('fallback-two', AUDIO_ID, 'audio', audioDigest(AUDIO_SAMPLES));
	await verifyProjectFallbackIntegrity(project([audioSource], [first, second]), store);
	assert.equal(reads, 1);

	reads = 0;
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(project([audioSource], [
			first,
			claim('fallback-two', AUDIO_ID, 'audio', 'f'.repeat(64)),
		]), store),
		/conflicting SHA-256/iu,
	);
	assert.equal(reads, 0);
});

test('fallback verification snapshots source data properties and its admission rejects later drift', async () => {
	const mutableSource: Record<string, unknown> = {
		...source(AUDIO_ID, 'audio', 'audio-storage'),
	};
	const candidate = project([
		mutableSource,
	], [claim('audio-fallback', AUDIO_ID, 'audio', audioDigest(AUDIO_SAMPLES))]);
	const store = {
		async *readSourceChunks(sourceId: string) {
			assert.equal(sourceId, 'audio-storage');
			mutableSource.frameCount = 8;
			yield [Float32Array.from(AUDIO_SAMPLES)];
		},
	};

	const admission = await verifyProjectFallbackIntegrity(candidate, store);
	assert.equal(Object.isFrozen(admission), true);
	assert.throws(
		() => admission.assertCurrent(candidate),
		(error: unknown) => {
			assert.ok(error instanceof DOMException);
			assert.equal(error.name, 'AbortError');
			assert.match(error.message, /rendered fallback integrity admission.*changed/iu);
			return true;
		},
	);

	let getterCalls = 0;
	let reads = 0;
	const accessorSource = { ...source(AUDIO_ID, 'audio', 'audio-storage') };
	Object.defineProperty(accessorSource, 'storageKey', {
		enumerable: true,
		get() {
			getterCalls += 1;
			return 'audio-storage';
		},
	});
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(project([
			accessorSource,
		], [claim('audio-fallback', AUDIO_ID, 'audio', audioDigest(AUDIO_SAMPLES))]), {
			async *readSourceChunks() { reads += 1; yield [Float32Array.from(AUDIO_SAMPLES)]; },
		}),
		/own data property/iu,
	);
	assert.equal(getterCalls, 0);
	assert.equal(reads, 0);

	let invalidStorageReads = 0;
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(project([{
			...source(AUDIO_ID, 'audio', 'audio-storage'),
			storageKey: '   ',
		}], [claim('audio-fallback', AUDIO_ID, 'audio', audioDigest(AUDIO_SAMPLES))]), {
			async *readSourceChunks() {
				invalidStorageReads += 1;
				yield [Float32Array.from(AUDIO_SAMPLES)];
			},
		}),
		/rendered fallback source rendered-audio.*invalid storage key/iu,
	);
	assert.equal(invalidStorageReads, 0);
});

test('fallback byte admission is cumulative and completes video metadata preflight before body reads', async () => {
	const perVideoBytes = Math.floor(SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes / 2) + 1;
	let metadataReads = 0;
	let bodyReads = 0;
	const store = {
		getMediaAssetMetadata() {
			metadataReads += 1;
			return { size: perVideoBytes };
		},
		loadMediaAsset() {
			bodyReads += 1;
			return new Blob();
		},
	};
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(project([
			source('rendered-video-one', 'video', 'video-one'),
			source('rendered-video-two', 'video', 'video-two'),
		], [
			claim('video-one', 'rendered-video-one', 'video', digest(new Uint8Array())),
			claim('video-two', 'rendered-video-two', 'video', digest(new Uint8Array())),
		]), store),
		/cumulative.*expanded-byte limit/iu,
	);
	assert.equal(metadataReads, 2);
	assert.equal(bodyReads, 0);

	let mixedAudioReads = 0;
	let mixedMetadataReads = 0;
	let mixedBodyReads = 0;
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(project([{
			...source(AUDIO_ID, 'audio', 'audio-storage'),
			frameCount: 134_217_728,
			channelCount: 64,
			chunkFrames: 65_536,
		}, source(VIDEO_ID, 'video', 'video-storage')], [
			claim('audio-fallback', AUDIO_ID, 'audio', 'f'.repeat(64)),
			claim('video-fallback', VIDEO_ID, 'video', digest(new Uint8Array())),
		]), {
			async *readSourceChunks() { mixedAudioReads += 1; yield [Float32Array.of(0)]; },
			getMediaAssetMetadata() {
				mixedMetadataReads += 1;
				return { size: SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes / 2 };
			},
			loadMediaAsset() { mixedBodyReads += 1; return new Blob(); },
		}),
		/cumulative.*expanded-byte limit/iu,
	);
	assert.equal(mixedAudioReads, 0);
	assert.equal(mixedMetadataReads, 1);
	assert.equal(mixedBodyReads, 0);

	const audioChunkFrames = 65_536;
	const audioChannelCount = 64;
	const audioChunkBytes = 4 + audioChunkFrames * audioChannelCount * Float32Array.BYTES_PER_ELEMENT;
	const audioChunkCount = Math.floor(SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes / audioChunkBytes) + 1;
	let audioReads = 0;
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(project([{
			...source(AUDIO_ID, 'audio', 'audio-storage'),
			frameCount: audioChunkCount * audioChunkFrames,
			channelCount: audioChannelCount,
			chunkFrames: audioChunkFrames,
		}], [claim('audio-fallback', AUDIO_ID, 'audio', 'f'.repeat(64))]), {
			async *readSourceChunks() { audioReads += 1; yield [Float32Array.of(0)]; },
		}),
		/cumulative.*expanded-byte limit/iu,
	);
	assert.equal(audioReads, 0);
});

test('video fallback verification binds the loaded Blob size to admitted metadata', async () => {
	const driftedBytes = Uint8Array.of(...VIDEO_BYTES, 0xff);
	const store = {
		getMediaAssetMetadata() { return { size: VIDEO_BYTES.byteLength }; },
		loadMediaAsset() { return new Blob([driftedBytes]); },
	};
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(project([
			source(VIDEO_ID, 'video', 'video-storage'),
		], [claim('video-fallback', VIDEO_ID, 'video', digest(driftedBytes))]), store),
		/rendered fallback source rendered-video.*unexpected size/iu,
	);
});

test('video metadata preflight abandons a cancellation-insensitive read with the exact reason', async () => {
	const controller = new AbortController();
	const reason = new DOMException('video metadata superseded', 'AbortError');
	let timer: ReturnType<typeof setTimeout> | undefined;
	const operation = verifyProjectFallbackIntegrity(project([
		source(VIDEO_ID, 'video', 'video-storage'),
	], [claim('video-fallback', VIDEO_ID, 'video', digest(VIDEO_BYTES))]), {
		getMediaAssetMetadata() {
			queueMicrotask(() => { controller.abort(reason); });
			return new Promise<never>(() => undefined);
		},
		loadMediaAsset() { throw new Error('unexpected body read'); },
	}, { signal: controller.signal });
	try {
		await assert.rejects(
			() => Promise.race([
				operation,
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => { reject(new Error('metadata cancellation timed out')); }, 100);
				}),
			]),
			(error: unknown) => error === reason,
		);
	} finally {
		if (timer) clearTimeout(timer);
	}
});

test('audio fallback verification preserves its primary failure when iterator cleanup also fails', async () => {
	const cleanupFailure = new Error('source iterator cleanup failed');
	const store = {
		async *readSourceChunks() {
			try {
				yield [Float32Array.of(1, 2)];
			} finally {
				throw cleanupFailure;
			}
		},
	};
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(project([
			source(AUDIO_ID, 'audio', 'audio-storage'),
		], [claim('audio-fallback', AUDIO_ID, 'audio', audioDigest(AUDIO_SAMPLES))]), store),
		(error: unknown) => {
			assert.ok(error instanceof AggregateError);
			assert.match(String(error.errors[0]), /noncanonical PCM chunk geometry/iu);
			assert.equal(error.errors[1], cleanupFailure);
			return true;
		},
	);
});

test('audio cancellation preserves the exact reason and closes the source iterator', async () => {
	const controller = new AbortController();
	const reason = new DOMException('verification superseded', 'AbortError');
	let closed = 0;
	const store = {
		async *readSourceChunks() {
			try {
				yield [Float32Array.from(AUDIO_SAMPLES)];
				controller.abort(reason);
				yield [Float32Array.from(AUDIO_SAMPLES)];
			} finally {
				closed += 1;
			}
		},
	};
	const candidate = project([
		{ ...source(AUDIO_ID, 'audio', 'audio-storage'), frameCount: 8 },
	], [claim('audio-fallback', AUDIO_ID, 'audio', 'f'.repeat(64))]);
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(candidate, store, { signal: controller.signal }),
		(error: unknown) => error === reason,
	);
	assert.equal(closed, 1);
});

test('empty and future manifests perform no storage reads or future-field traversal', async () => {
	let reads = 0;
	const store = {
		readSourceChunks() { reads += 1; throw new Error('unexpected audio read'); },
		loadMediaAsset() { reads += 1; throw new Error('unexpected video read'); },
	};
	await verifyProjectFallbackIntegrity(project([], []), store);
	const future = {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION + 1,
		get sources(): never { throw new Error('future sources traversed'); },
		get featureRequirements(): never { throw new Error('future requirements traversed'); },
	};
	await verifyProjectFallbackIntegrity(future, store);
	assert.equal(reads, 0);
});

function project(
	sources: readonly Readonly<Record<string, unknown>>[],
	requirements: readonly Readonly<Record<string, unknown>>[],
): Readonly<Record<string, unknown>> {
	return {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 } }],
		sources,
		featureRequirements: { schemaVersion: 1, requirements },
	};
}

function source(id: string, kind: 'audio' | 'video', storageKey: string): Readonly<Record<string, unknown>> {
	return {
		id,
		kind,
		storageKey,
		frameCount: 4,
		channelCount: 1,
		chunkFrames: 4,
	};
}

function claim(
	id: string,
	sourceId: string,
	kind: 'audio' | 'video',
	sha256: string,
): Readonly<Record<string, unknown>> {
	return {
		id,
		featureId: `org.soundscaper.test.${id}`,
		displayName: id,
		disposition: 'rendered-fallback',
		fallback: { kind, sourceId, sha256 },
	};
}

function memoryStore(prefix: string): ProjectStore {
	return createProjectStore({
		indexedDB: null,
		databaseName: `${prefix}-${String(Date.now())}-${String(Math.random())}`,
	});
}

async function persistAudio(
	store: ProjectStore,
	storageKey: string,
	samples: readonly number[],
): Promise<void> {
	const writer = await store.beginSourceWrite(storageKey, {
		sampleRate: 48_000,
		channelCount: 1,
	});
	await writer.write([Float32Array.from(samples)]);
	await writer.commit();
}

function audioDigest(samples: readonly number[]): string {
	const bytes = Buffer.alloc(4 + samples.length * Float32Array.BYTES_PER_ELEMENT);
	bytes.writeUInt32LE(samples.length, 0);
	for (const [index, sample] of samples.entries()) {
		bytes.writeFloatLE(sample, 4 + index * Float32Array.BYTES_PER_ELEMENT);
	}
	return createHash('sha256').update(bytes).digest('hex');
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
