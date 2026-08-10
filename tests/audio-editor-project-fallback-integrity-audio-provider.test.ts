/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	PROJECT_AUDIO_FALLBACK_INTEGRITY_ERROR_CODE,
	isProjectAudioFallbackIntegrityError,
	verifyProjectFallbackIntegrity,
	type ProjectAudioFallbackIntegritySelector,
} from '../src/common/editor/project-fallback-integrity.ts';
import { AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';

const SOURCE_CHUNKS = [
	storedChunk(0, [Float32Array.of(0.25, -0.5), Float32Array.of(0.75, -1)]),
	storedChunk(1, [Float32Array.of(0.125), Float32Array.of(-0.25)]),
];
const SELECTOR: ProjectAudioFallbackIntegritySelector = Object.freeze({
	requirementId: 'publisher-audio-render',
	featureId: 'org.soundscaper.audio-effects',
	role: 'project-audio-mix-v1',
	kind: 'audio',
	sourceId: 'rendered-audio',
	sha256: audioDigest(SOURCE_CHUNKS),
	targetTrackId: null,
});

test('verified provider re-reads only one requested chunk and returns tight copies', async () => {
	const randomReads: number[] = [];
	const body = SOURCE_CHUNKS.map(cloneChunk);
	const candidate = project();
	const admission = await verifyProjectFallbackIntegrity(candidate, {
		async *readSourceChunks() { for (const value of body) yield cloneChunk(value); },
		readSourceChunk(sourceId, chunkIndex) {
			assert.equal(sourceId, 'audio-storage');
			randomReads.push(chunkIndex);
			return body[chunkIndex];
		},
	}, { audioFallback: SELECTOR });
	const provider = admission.getVerifiedAudioChunkProvider(SELECTOR);

	const channels = await provider.readStorageChunk(1);
	assert.deepEqual(randomReads, [1]);
	assert.deepEqual(channels.map((channel) => [...channel]), [[0.125], [-0.25]]);
	assert.equal(Object.getPrototypeOf(channels), Array.prototype);
	assert.equal(Object.isFrozen(channels), true);
	for (let channel = 0; channel < channels.length; channel += 1) {
		assert.notStrictEqual(channels[channel], body[1]!.channels[channel]);
		assert.equal(Object.getPrototypeOf(channels[channel]), Float32Array.prototype);
		assert.equal(channels[channel]!.byteOffset, 0);
		assert.equal(channels[channel]!.byteLength, channels[channel]!.buffer.byteLength);
	}
	body[1]!.channels[0]![0] = 0.75;
	assert.equal(channels[0]![0], 0.125, 'returned bytes must not alias storage');
});

test('provider tags post-admission body mutation before samples reach its consumer', async () => {
	const body = SOURCE_CHUNKS.map(cloneChunk);
	const admission = await verifyProjectFallbackIntegrity(project(), {
		async *readSourceChunks() { for (const value of body) yield cloneChunk(value); },
		readSourceChunk(_sourceId, chunkIndex) { return body[chunkIndex]; },
	}, { audioFallback: SELECTOR });
	body[0]!.channels[0]![0] = 0.5;

	await assert.rejects(
		() => admission.getVerifiedAudioChunkProvider(SELECTOR).readStorageChunk(0),
		(error: unknown) => {
			assert.equal(isProjectAudioFallbackIntegrityError(error), true);
			assert.equal((error as Readonly<{ code?: unknown }>).code, PROJECT_AUDIO_FALLBACK_INTEGRITY_ERROR_CODE);
			assert.match(String((error as Error).message), /changed after integrity admission/iu);
			return true;
		},
	);
});

test('provider rejects invalid requests and corrupt random-read geometry with the stable discriminator', async () => {
	let randomReads = 0;
	let randomValue: unknown = cloneChunk(SOURCE_CHUNKS[0]!);
	const admission = await verifyProjectFallbackIntegrity(project(), {
		async *readSourceChunks() { for (const value of SOURCE_CHUNKS) yield cloneChunk(value); },
		readSourceChunk() { randomReads += 1; return randomValue; },
	}, { audioFallback: SELECTOR });
	const provider = admission.getVerifiedAudioChunkProvider(SELECTOR);

	for (const chunkIndex of [-1, 0.5, 2]) {
		await assert.rejects(
			() => provider.readStorageChunk(chunkIndex),
			(error: unknown) => isProjectAudioFallbackIntegrityError(error),
		);
	}
	assert.equal(randomReads, 0);

	for (const value of [
		{ ...SOURCE_CHUNKS[0]!, index: 1 },
		{ ...SOURCE_CHUNKS[0]!, frames: 1 },
		{ ...SOURCE_CHUNKS[0]!, channels: [Float32Array.of(0.25, -0.5)] },
		{ ...SOURCE_CHUNKS[0]!, channels: [Float32Array.of(0.25), Float32Array.of(0.75)] },
		{ ...SOURCE_CHUNKS[0]!, channels: [Float32Array.of(0.5, -0.5), Float32Array.of(0.75, -1)] },
	]) {
		randomValue = value;
		await assert.rejects(
			() => provider.readStorageChunk(0),
			(error: unknown) => isProjectAudioFallbackIntegrityError(error),
		);
	}
});

test('provider checks selector currentness on both sides of a read', async () => {
	const beforeRead = project();
	const firstAdmission = await verifyProjectFallbackIntegrity(beforeRead, {
		async *readSourceChunks() { for (const value of SOURCE_CHUNKS) yield cloneChunk(value); },
		readSourceChunk(_sourceId, chunkIndex) { return cloneChunk(SOURCE_CHUNKS[chunkIndex]!); },
	}, { audioFallback: SELECTOR });
	beforeRead.featureRequirements.requirements[0]!.featureId = 'org.soundscaper.changed-feature';
	await assert.rejects(
		() => firstAdmission.getVerifiedAudioChunkProvider(SELECTOR).readStorageChunk(0),
		(error: unknown) => {
			assert.ok(error instanceof DOMException);
			assert.equal(error.name, 'AbortError');
			assert.equal(isProjectAudioFallbackIntegrityError(error), false);
			return true;
		},
	);

	const afterRead = project();
	let reads = 0;
	const secondAdmission = await verifyProjectFallbackIntegrity(afterRead, {
		async *readSourceChunks() { for (const value of SOURCE_CHUNKS) yield cloneChunk(value); },
		readSourceChunk(_sourceId, chunkIndex) {
			reads += 1;
			afterRead.featureRequirements.requirements[0]!.featureId = 'org.soundscaper.changed-feature';
			return cloneChunk(SOURCE_CHUNKS[chunkIndex]!);
		},
	}, { audioFallback: SELECTOR });
	await assert.rejects(
		() => secondAdmission.getVerifiedAudioChunkProvider(SELECTOR).readStorageChunk(0),
		(error: unknown) => {
			assert.ok(error instanceof DOMException);
			assert.equal(error.name, 'AbortError');
			assert.equal(isProjectAudioFallbackIntegrityError(error), false);
			return true;
		},
	);
	assert.equal(reads, 1);
});

test('an external generation fence keeps full-project checks out of the per-chunk path', async () => {
	let currentnessChecks = 0;
	const admission = await verifyProjectFallbackIntegrity(project(), {
		async *readSourceChunks() { for (const value of SOURCE_CHUNKS) yield cloneChunk(value); },
		readSourceChunk(_sourceId, chunkIndex) { return cloneChunk(SOURCE_CHUNKS[chunkIndex]!); },
	}, {
		audioFallback: SELECTOR,
		assertCurrent() { currentnessChecks += 1; },
	});
	assert.equal(currentnessChecks, 3, 'the full scan uses only bounded phase checks');

	await admission.getVerifiedAudioChunkProvider(SELECTOR).readStorageChunk(0);
	assert.equal(currentnessChecks, 6, 'one provider request is fenced before read, before hash, and before return');
});

test('provider preserves exact operation and request cancellation reasons', async () => {
	const operationController = new AbortController();
	const operationReason = new DOMException('export superseded', 'AbortError');
	const operationAdmission = await admissionWithSignal(operationController.signal, () => cloneChunk(SOURCE_CHUNKS[0]!));
	operationController.abort(operationReason);
	await assert.rejects(
		() => operationAdmission.getVerifiedAudioChunkProvider(SELECTOR).readStorageChunk(0),
		(error: unknown) => error === operationReason,
	);

	const requestController = new AbortController();
	const requestReason = new DOMException('render cancelled', 'AbortError');
	let timer: ReturnType<typeof setTimeout> | undefined;
	const requestAdmission = await admissionWithSignal(undefined, () => {
		queueMicrotask(() => { requestController.abort(requestReason); });
		return new Promise<never>(() => undefined);
	});
	try {
		await assert.rejects(
			() => Promise.race([
				requestAdmission.getVerifiedAudioChunkProvider(SELECTOR).readStorageChunk(0, {
					signal: requestController.signal,
				}),
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => { reject(new Error('provider cancellation timed out')); }, 100);
				}),
			]),
			(error: unknown) => error === requestReason,
		);
	} finally {
		if (timer) clearTimeout(timer);
	}
});

test('audio provider getter binds the exact selected identity', async () => {
	const admission = await verifyProjectFallbackIntegrity(project(), {
		async *readSourceChunks() { for (const value of SOURCE_CHUNKS) yield cloneChunk(value); },
		readSourceChunk(_sourceId, chunkIndex) { return cloneChunk(SOURCE_CHUNKS[chunkIndex]!); },
	}, { audioFallback: SELECTOR });
	assert.throws(
		() => admission.getVerifiedAudioChunkProvider({ ...SELECTOR, sourceId: 'other-source' }),
		/does not match the verified audio rendered fallback/iu,
	);
});

async function admissionWithSignal(
	signal: AbortSignal | undefined,
	readSourceChunk: () => PromiseLike<unknown> | unknown,
) {
	return verifyProjectFallbackIntegrity(project(), {
		async *readSourceChunks() { for (const value of SOURCE_CHUNKS) yield cloneChunk(value); },
		readSourceChunk,
	}, { signal, audioFallback: SELECTOR });
}

function project(): {
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
		sources: [{
			id: SELECTOR.sourceId,
			kind: 'audio',
			storageKey: 'audio-storage',
			frameCount: 3,
			channelCount: 2,
			chunkFrames: 2,
			sampleRate: 48_000,
		}],
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: SELECTOR.requirementId,
			featureId: SELECTOR.featureId,
			displayName: 'Publisher audio render',
			disposition: 'rendered-fallback',
			fallback: { kind: SELECTOR.kind, sourceId: SELECTOR.sourceId, sha256: SELECTOR.sha256 },
		}] },
	};
}

function storedChunk(index: number, channels: readonly Float32Array[]) {
	return { index, frames: channels[0]?.length ?? 0, channels };
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
		for (const channel of value.channels) digest.update(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength));
	}
	return digest.digest('hex');
}
