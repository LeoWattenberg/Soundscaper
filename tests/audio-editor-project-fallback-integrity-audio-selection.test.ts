/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	verifyProjectFallbackIntegrity,
	type ProjectAudioFallbackIntegritySelector,
} from '../src/common/editor/project-fallback-integrity.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';

const AUDIO_CHUNKS = Object.freeze([
	chunk(0, [Float32Array.of(0.25, -0.5), Float32Array.of(0.75, -1)]),
	chunk(1, [Float32Array.of(0.125), Float32Array.of(-0.25)]),
]);
const AUDIO_DIGEST = audioDigest(AUDIO_CHUNKS);
const AUDIO_SELECTOR: ProjectAudioFallbackIntegritySelector = Object.freeze({
	requirementId: 'publisher-audio-render',
	featureId: 'org.soundscaper.audio-effects',
	role: 'project-audio-mix-v1',
	kind: 'audio',
	sourceId: 'rendered-audio',
	sha256: AUDIO_DIGEST,
	targetTrackId: null,
});

test('selected audio verifies only its exact canonical body and exposes a private provider', async () => {
	let audioScans = 0;
	let videoReads = 0;
	let migrationEnabled: boolean | undefined;
	const admission = await verifyProjectFallbackIntegrity(fallbackProject(), {
		async *readSourceChunks(sourceId, options) {
			assert.equal(sourceId, 'audio-storage');
			audioScans += 1;
			migrationEnabled = options?.migrateLegacyPcmOnAccess;
			for (const value of AUDIO_CHUNKS) yield cloneChunk(value);
		},
		readSourceChunk(_sourceId, chunkIndex) { return cloneChunk(AUDIO_CHUNKS[chunkIndex]!); },
		getMediaAssetMetadata() { videoReads += 1; throw new Error('unrelated video metadata read'); },
		loadMediaAsset() { videoReads += 1; throw new Error('unrelated video body read'); },
	}, { audioFallback: AUDIO_SELECTOR });

	assert.equal(audioScans, 1);
	assert.equal(videoReads, 0);
	assert.equal(migrationEnabled, false);
	const provider = admission.getVerifiedAudioChunkProvider(AUDIO_SELECTOR);
	assert.equal(Object.isFrozen(provider), true);
	assert.deepEqual({
		channelCount: provider.channelCount,
		frameCount: provider.frameCount,
		chunkFrames: provider.chunkFrames,
		sampleRate: provider.sampleRate,
	}, { channelCount: 2, frameCount: 3, chunkFrames: 2, sampleRate: 48_000 });
});

test('selected audio rejects selector mismatch, ambiguity, and future schemas before storage', async () => {
	let reads = 0;
	const store = {
		readSourceChunks() { reads += 1; throw new Error('unexpected scan'); },
		readSourceChunk() { reads += 1; throw new Error('unexpected chunk read'); },
	};
	for (const mismatch of [
		{ ...AUDIO_SELECTOR, requirementId: 'wrong-requirement' },
		{ ...AUDIO_SELECTOR, featureId: 'org.soundscaper.wrong-feature' },
		{ ...AUDIO_SELECTOR, sourceId: 'wrong-source' },
		{ ...AUDIO_SELECTOR, kind: 'video' },
		{ ...AUDIO_SELECTOR, sha256: 'f'.repeat(64) },
	]) {
		await assert.rejects(
			() => verifyProjectFallbackIntegrity(fallbackProject(), store, {
				audioFallback: mismatch as ProjectAudioFallbackIntegritySelector,
			}),
			/selected audio rendered fallback/iu,
		);
	}

	const duplicateRequirement = fallbackProject();
	duplicateRequirement.featureRequirements.requirements.push({
		...duplicateRequirement.featureRequirements.requirements[0]!,
	});
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(duplicateRequirement, store, { audioFallback: AUDIO_SELECTOR }),
		/duplicate project feature requirement ID/iu,
	);
	const duplicateSource = fallbackProject();
	duplicateSource.sources.push({ ...duplicateSource.sources[0]! });
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(duplicateSource, store, { audioFallback: AUDIO_SELECTOR }),
		/duplicate project source ID/iu,
	);
	await assert.rejects(
		() => verifyProjectFallbackIntegrity({
			schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION + 1,
		}, store, { audioFallback: AUDIO_SELECTOR }),
		/selected audio rendered fallback.*current project schema/iu,
	);
	assert.equal(reads, 0);
});

test('selected audio fails closed on full digest mismatch and exact cancellation', async () => {
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(fallbackProject(), {
			async *readSourceChunks() {
				yield cloneChunk(AUDIO_CHUNKS[0]!);
				yield chunk(1, [Float32Array.of(0.5), Float32Array.of(-0.25)]);
			},
			readSourceChunk(_sourceId, index) { return cloneChunk(AUDIO_CHUNKS[index]!); },
		}, { audioFallback: AUDIO_SELECTOR }),
		/rendered fallback source rendered-audio.*SHA-256/iu,
	);

	const controller = new AbortController();
	const reason = new DOMException('audio verification superseded', 'AbortError');
	let closed = 0;
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(fallbackProject(), {
			async *readSourceChunks() {
				try {
					yield cloneChunk(AUDIO_CHUNKS[0]!);
					controller.abort(reason);
					yield cloneChunk(AUDIO_CHUNKS[1]!);
				} finally {
					closed += 1;
				}
			},
			readSourceChunk(_sourceId, index) { return cloneChunk(AUDIO_CHUNKS[index]!); },
		}, { signal: controller.signal, audioFallback: AUDIO_SELECTOR }),
		(error: unknown) => error === reason,
	);
	assert.equal(closed, 1);

	const synchronousController = new AbortController();
	const synchronousReason = new DOMException('audio iterator superseded', 'AbortError');
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(fallbackProject(), {
			readSourceChunks() {
				synchronousController.abort(synchronousReason);
				throw new Error('cancellation-insensitive iterator failure');
			},
			readSourceChunk(_sourceId, index) { return cloneChunk(AUDIO_CHUNKS[index]!); },
		}, { signal: synchronousController.signal, audioFallback: AUDIO_SELECTOR }),
		(error: unknown) => error === synchronousReason,
	);
});

test('selected audio rejects short, extra, unordered, malformed, and cleanup-failing scans', async () => {
	const cases: Array<Readonly<{
		label: string;
		values: readonly Readonly<Record<string, unknown>>[];
		pattern: RegExp;
	}>> = [
		{ label: 'short', values: [AUDIO_CHUNKS[0]!], pattern: /ended before.*frame count/iu },
		{ label: 'extra', values: [...AUDIO_CHUNKS, chunk(2, [Float32Array.of(0), Float32Array.of(0)])], pattern: /more chunks than declared/iu },
		{ label: 'unordered', values: [chunk(1, AUDIO_CHUNKS[0]!.channels), AUDIO_CHUNKS[1]!], pattern: /noncanonical.*order/iu },
		{ label: 'frames', values: [{ ...AUDIO_CHUNKS[0]!, frames: 1 }, AUDIO_CHUNKS[1]!], pattern: /noncanonical PCM chunk geometry/iu },
		{ label: 'channels', values: [{ ...AUDIO_CHUNKS[0]!, channels: [Float32Array.of(1, 2)] }, AUDIO_CHUNKS[1]!], pattern: /invalid/iu },
	];
	for (const candidate of cases) {
		await assert.rejects(
			() => verifyProjectFallbackIntegrity(fallbackProject(), {
				async *readSourceChunks() { for (const value of candidate.values) yield value; },
				readSourceChunk(_sourceId, index) { return cloneChunk(AUDIO_CHUNKS[index]!); },
			}, { audioFallback: AUDIO_SELECTOR }),
			candidate.pattern,
			candidate.label,
		);
	}

	const cleanupFailure = new Error('selected source cleanup failed');
	await assert.rejects(
		() => verifyProjectFallbackIntegrity(fallbackProject(), {
			readSourceChunks() {
				let index = 0;
				const iterator: AsyncIterableIterator<
					readonly Float32Array[] | Readonly<{ index?: unknown; frames?: unknown; channels?: readonly Float32Array[] }>
				> = {
					[Symbol.asyncIterator]() { return iterator; },
					next() {
						const value = AUDIO_CHUNKS[index++];
						return Promise.resolve(value
							? { done: false as const, value: cloneChunk(value) }
							: { done: true as const, value: undefined });
					},
					return() { return Promise.reject(cleanupFailure); },
				};
				return iterator;
			},
			readSourceChunk(_sourceId, index) { return cloneChunk(AUDIO_CHUNKS[index]!); },
		}, { audioFallback: AUDIO_SELECTOR }),
		(error: unknown) => error === cleanupFailure,
	);
});

test('default and selected-video admission behavior does not expose an audio provider', async () => {
	const defaultAdmission = await verifyProjectFallbackIntegrity(fallbackProject(false), {
		async *readSourceChunks() { for (const value of AUDIO_CHUNKS) yield value.channels; },
	});
	assert.throws(
		() => defaultAdmission.getVerifiedAudioChunkProvider(AUDIO_SELECTOR),
		/no selected audio rendered fallback/iu,
	);
});

function fallbackProject(includeVideo = true): {
	schemaVersion: number;
	sampleRate: number;
	primarySequenceId: string;
	sequences: Array<Record<string, unknown>>;
	sources: Array<Record<string, unknown>>;
	featureRequirements: { schemaVersion: number; requirements: Array<Record<string, unknown>> };
} {
	return {
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
		sampleRate: 48_000,
		primarySequenceId: 'main-sequence',
		sequences: [{ id: 'main-sequence', rate: { num: 30, den: 1 } }],
		sources: [
			{ id: 'rendered-audio', kind: 'audio', storageKey: 'audio-storage', frameCount: 3, channelCount: 2, chunkFrames: 2, sampleRate: 48_000 },
			...(includeVideo ? [{ id: 'rendered-video', kind: 'video', storageKey: 'video-storage', frameCount: 1, channelCount: 1, chunkFrames: 1, sampleRate: 48_000 }] : []),
		],
		featureRequirements: { schemaVersion: 1, requirements: [
			requirement(AUDIO_SELECTOR.requirementId, AUDIO_SELECTOR.featureId, 'audio', AUDIO_SELECTOR.sourceId, AUDIO_SELECTOR.sha256),
			...(includeVideo ? [requirement('publisher-video-render', 'org.soundscaper.video-effects', 'video', 'rendered-video', 'a'.repeat(64))] : []),
		] },
	};
}

function requirement(
	id: string,
	featureId: string,
	kind: 'audio' | 'video',
	sourceId: string,
	sha256: string,
): Record<string, unknown> {
	return { id, featureId, displayName: id, disposition: 'rendered-fallback', fallback: { kind, sourceId, sha256 } };
}

function chunk(index: number, channels: readonly Float32Array[]): Readonly<{
	index: number;
	frames: number;
	channels: readonly Float32Array[];
}> {
	return Object.freeze({ index, frames: channels[0]?.length ?? 0, channels: Object.freeze([...channels]) });
}

function cloneChunk(value: Readonly<{ index: number; frames: number; channels: readonly Float32Array[] }>) {
	return { index: value.index, frames: value.frames, channels: value.channels.map((channel) => new Float32Array(channel)) };
}

function audioDigest(chunks: readonly Readonly<{ frames: number; channels: readonly Float32Array[] }>[]): string {
	const digest = createHash('sha256');
	for (const value of chunks) {
		const header = Buffer.alloc(4);
		header.writeUInt32LE(value.frames, 0);
		digest.update(header);
		for (const channel of value.channels) {
			digest.update(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength));
		}
	}
	return digest.digest('hex');
}
