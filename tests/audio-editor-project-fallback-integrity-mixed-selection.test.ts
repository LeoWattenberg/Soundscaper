/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { SCAPE_ARCHIVE_LIMITS } from '../src/common/editor/scape-archive-envelope.ts';
import {
	verifyProjectFallbackIntegrity,
	type ProjectAudioFallbackIntegritySelector,
	type ProjectVideoFallbackIntegritySelector,
} from '../src/common/editor/project-fallback-integrity.ts';

const AUDIO_CHUNK = Object.freeze({
	index: 0,
	frames: 1,
	channels: Object.freeze([Float32Array.of(0.25)]),
});
const AUDIO_SELECTOR: ProjectAudioFallbackIntegritySelector = Object.freeze({
	requirementId: 'audio-render',
	featureId: 'org.soundscaper.capability.audio-effects',
	role: 'project-audio-mix-v1',
	kind: 'audio',
	sourceId: 'rendered-audio',
	sha256: audioDigest(),
	targetTrackId: null,
});
const VIDEO_BYTES = Uint8Array.of(0x6d, 0x69, 0x78, 0x65, 0x64);
const VIDEO_SELECTOR: ProjectVideoFallbackIntegritySelector = Object.freeze({
	requirementId: 'video-render',
	featureId: 'org.soundscaper.capability.video-effects',
	role: 'project-video-render-v1',
	kind: 'video',
	sourceId: 'rendered-video',
	sha256: createHash('sha256').update(VIDEO_BYTES).digest('hex'),
	targetClipId: null,
});

test('mixed selection preflights both targets then verifies audio before video and exposes both bodies', async () => {
	const events: string[] = [];
	const videoBlob = new Blob([VIDEO_BYTES]);
	const admission = await verifyProjectFallbackIntegrity(project(), {
		async *readSourceChunks(sourceId, options) {
			assert.equal(sourceId, 'audio-storage');
			assert.equal(options?.migrateLegacyPcmOnAccess, false);
			events.push('audio-body');
			yield cloneAudioChunk();
		},
		readSourceChunk(sourceId, chunkIndex, options) {
			assert.equal(sourceId, 'audio-storage');
			assert.equal(chunkIndex, 0);
			assert.equal(options?.migrateLegacyPcmOnAccess, false);
			return cloneAudioChunk();
		},
		getMediaAssetMetadata(sourceId) {
			assert.equal(sourceId, 'video-storage');
			events.push('video-preflight');
			return { size: VIDEO_BYTES.byteLength };
		},
		loadMediaAsset(sourceId, options) {
			assert.equal(sourceId, 'video-storage');
			assert.equal(options?.backfillDigest, false);
			events.push('video-body');
			return videoBlob;
		},
	}, {
		audioFallback: AUDIO_SELECTOR,
		videoFallback: VIDEO_SELECTOR,
	});

	assert.deepEqual(events, ['video-preflight', 'audio-body', 'video-body']);
	const verifiedVideo = admission.getVerifiedVideoBlob(VIDEO_SELECTOR);
	assert.equal(admission.getVerifiedVideoBlob(VIDEO_SELECTOR), verifiedVideo);
	assert.deepEqual(new Uint8Array(await verifiedVideo.arrayBuffer()), VIDEO_BYTES);
	const provider = admission.getVerifiedAudioChunkProvider(AUDIO_SELECTOR);
	assert.deepEqual(await provider.readStorageChunk(0), [Float32Array.of(0.25)]);
});

test('mixed selection applies its cumulative limit before either body is read', async () => {
	let audioBodyReads = 0;
	let videoBodyReads = 0;
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(project(), {
			async *readSourceChunks() {
				audioBodyReads += 1;
				yield cloneAudioChunk();
			},
			readSourceChunk() { return cloneAudioChunk(); },
			getMediaAssetMetadata() { return { size: SCAPE_ARCHIVE_LIMITS.maximumExpandedBytes }; },
			loadMediaAsset() {
				videoBodyReads += 1;
				return new Blob([VIDEO_BYTES]);
			},
		}, { audioFallback: AUDIO_SELECTOR, videoFallback: VIDEO_SELECTOR }),
		/cumulative.*expanded-byte limit/iu,
	);
	assert.equal(audioBodyReads, 0);
	assert.equal(videoBodyReads, 0);
});

test('mixed selection refuses either mismatched selector before any storage read', async () => {
	for (const options of [
		{
			audioFallback: { ...AUDIO_SELECTOR, featureId: 'org.soundscaper.wrong-audio' },
			videoFallback: VIDEO_SELECTOR,
		},
		{
			audioFallback: AUDIO_SELECTOR,
			videoFallback: { ...VIDEO_SELECTOR, sourceId: 'wrong-video' },
		},
	]) {
		let reads = 0;
		await assert.rejects(
			() => verifyProjectFallbackIntegrity(project(), {
				readSourceChunks() { reads += 1; throw new Error('unexpected audio read'); },
				readSourceChunk() { reads += 1; throw new Error('unexpected audio chunk read'); },
				getMediaAssetMetadata() { reads += 1; return { size: VIDEO_BYTES.byteLength }; },
				loadMediaAsset() { reads += 1; return new Blob([VIDEO_BYTES]); },
			}, options),
			/selected (?:audio|video) rendered fallback/iu,
		);
		assert.equal(reads, 0);
	}
});

test('mixed selection preserves cancellation after audio verification and before video admission', async () => {
	const controller = new AbortController();
	const reason = new DOMException('mixed fallback export superseded', 'AbortError');
	let audioBodyReads = 0;
	let videoBodyReads = 0;
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(project(), {
			async *readSourceChunks() {
				audioBodyReads += 1;
				yield cloneAudioChunk();
			},
			readSourceChunk() { return cloneAudioChunk(); },
			getMediaAssetMetadata() { return { size: VIDEO_BYTES.byteLength }; },
			loadMediaAsset() {
				videoBodyReads += 1;
				controller.abort(reason);
				return new Blob([VIDEO_BYTES]);
			},
		}, {
			signal: controller.signal,
			audioFallback: AUDIO_SELECTOR,
			videoFallback: VIDEO_SELECTOR,
		}),
		(error: unknown) => error === reason,
	);
	assert.equal(audioBodyReads, 1);
	assert.equal(videoBodyReads, 1);
});

test('selected audio admission composes the caller fence with both mixed selector identities', async () => {
	const candidate = project();
	let currentnessChecks = 0;
	let audioBodyReads = 0;
	let videoBodyReads = 0;
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(candidate, {
			async *readSourceChunks() {
				audioBodyReads += 1;
				yield cloneAudioChunk();
			},
			readSourceChunk() { return cloneAudioChunk(); },
			getMediaAssetMetadata() { return { size: VIDEO_BYTES.byteLength }; },
			loadMediaAsset() {
				videoBodyReads += 1;
				return new Blob([VIDEO_BYTES]);
			},
		}, {
			audioFallback: AUDIO_SELECTOR,
			videoFallback: VIDEO_SELECTOR,
			assertCurrent() {
				currentnessChecks += 1;
				candidate.featureRequirements.requirements[1]!.featureId = 'org.soundscaper.changed-video';
			},
		}),
		isAbortError,
	);
	assert.equal(currentnessChecks, 1);
	assert.equal(audioBodyReads, 0);
	assert.equal(videoBodyReads, 0);
});

test('mixed selected audio provider refuses video selector drift before its random read', async () => {
	const candidate = project();
	let randomReads = 0;
	const admission = await verifyProjectFallbackIntegrity(candidate, {
		async *readSourceChunks() { yield cloneAudioChunk(); },
		readSourceChunk() {
			randomReads += 1;
			return cloneAudioChunk();
		},
		getMediaAssetMetadata() { return { size: VIDEO_BYTES.byteLength }; },
		loadMediaAsset() { return new Blob([VIDEO_BYTES]); },
	}, {
		audioFallback: AUDIO_SELECTOR,
		videoFallback: VIDEO_SELECTOR,
		assertCurrent: () => undefined,
	});
	candidate.featureRequirements.requirements[1]!.featureId = 'org.soundscaper.changed-video';

	await assert.rejects(
		() => admission.getVerifiedAudioChunkProvider(AUDIO_SELECTOR).readStorageChunk(0),
		isAbortError,
	);
	assert.equal(randomReads, 0);
});

interface MutableProject {
	schemaVersion: number;
	sampleRate: number;
	primarySequenceId: string;
	sequences: Array<Record<string, unknown>>;
	sources: Array<Record<string, unknown>>;
	clips: Array<Record<string, unknown>>;
	featureRequirements: {
		schemaVersion: number;
		requirements: Array<{
			id: string;
			featureId: string;
			displayName: string;
			disposition: string;
			fallback: Record<string, unknown>;
		}>;
	};
}

function project(): MutableProject {
	return {
		schemaVersion: 10,
		sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 } }],
		sources: [{
			id: AUDIO_SELECTOR.sourceId,
			kind: 'audio',
			storageKey: 'audio-storage',
			frameCount: 1,
			channelCount: 1,
			chunkFrames: 1,
			sampleRate: 48_000,
		}, {
			id: VIDEO_SELECTOR.sourceId,
			kind: 'video',
			storageKey: 'video-storage',
			frameCount: 1,
			channelCount: 1,
			chunkFrames: 1,
			sampleRate: 48_000,
			width: 1,
			height: 1,
			frameRate: 24,
			hasAudio: false,
		}],
		clips: [],
		featureRequirements: {
			schemaVersion: 2,
			requirements: [
				requirement(AUDIO_SELECTOR),
				requirement(VIDEO_SELECTOR),
			],
		},
	};
}

function requirement(
	selector: ProjectAudioFallbackIntegritySelector | ProjectVideoFallbackIntegritySelector,
): MutableProject['featureRequirements']['requirements'][number] {
	return {
		id: selector.requirementId,
		featureId: selector.featureId,
		displayName: selector.requirementId,
		disposition: 'rendered-fallback',
		fallback: {
			role: selector.role,
			kind: selector.kind,
			sourceId: selector.sourceId,
			sha256: selector.sha256,
		},
	};
}

function cloneAudioChunk(): {
	index: number;
	frames: number;
	channels: Float32Array[];
} {
	return {
		index: AUDIO_CHUNK.index,
		frames: AUDIO_CHUNK.frames,
		channels: AUDIO_CHUNK.channels.map((channel) => new Float32Array(channel)),
	};
}

function audioDigest(): string {
	const bytes = Buffer.alloc(8);
	bytes.writeUInt32LE(1, 0);
	bytes.writeFloatLE(0.25, 4);
	return createHash('sha256').update(bytes).digest('hex');
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError';
}
