/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type {
	ProductNativeRenderInputOperation,
} from '../src/common/editor/controller/composition/product-native-render-input-authority.ts';
import type { UnifiedExactRenderPlanV14 } from '../src/common/editor/unified-exact-render-plan.ts';
import {
	createFramescaperNativeAudioCarrierNativeMedia,
	framescaperNativeAudioCarrierNativeMediaByteLength,
	streamFramescaperNativeAudioCarrierNativeMedia,
} from '../src/framescaper/editor-native-render-audio-carrier.ts';
import type {
	FramescaperNativeOpfsByteSpool,
} from '../src/framescaper/native-render-opfs-spool.ts';

const SAMPLE_RATE = 48_000;
const SAMPLE_START = 480;
const SAMPLE_DURATION = 4;
const PROJECT: Readonly<Record<string, unknown>> = Object.freeze({ masterChannels: 3 });
const SOURCE_CHUNKS = Object.freeze([
	Object.freeze([
		Float32Array.of(0.25, -0.5),
		Float32Array.of(-0.25, 0.75),
		Float32Array.of(0.5, -0.25),
	]),
	Object.freeze([
		Float32Array.of(1, 0),
		Float32Array.of(-1, 0.5),
		Float32Array.of(0.125, -0.5),
	]),
]);

type RenderAudioToSink = NonNullable<ProductNativeRenderInputOperation['renderAudioToSink']>;

test('the native audio carrier streams an exact mapped float32 WAV and authenticates its trailer', async () => {
	const plan = audioPlan();
	const expectedByteLength = framescaperNativeAudioCarrierNativeMediaByteLength(plan, PROJECT);
	const calls = { assertCurrent: 0, render: 0 };
	const controller = new AbortController();
	const spool = new BoundedFakeSpool(44, expectedByteLength, controller.signal);
	const operation = audioOperation(controller, async (project, range, sink) => {
		calls.render += 1;
		assert.equal(project, PROJECT);
		assert.deepEqual(range, {
			startFrame: SAMPLE_START,
			endFrame: SAMPLE_START + SAMPLE_DURATION,
			includeTail: false,
			outputFrames: SAMPLE_DURATION,
			preRollFrames: SAMPLE_START,
			sampleRate: SAMPLE_RATE,
			chunkFrames: 4_096,
		});
		await sink(SOURCE_CHUNKS[0], { frameOffset: 0, sampleRate: SAMPLE_RATE, frames: 2 });
		await sink(SOURCE_CHUNKS[1], { frameOffset: 2, sampleRate: SAMPLE_RATE, frames: 2 });
		return Object.freeze({
			sampleRate: SAMPLE_RATE, channelCount: 3,
			frameCount: SAMPLE_DURATION, chunkCount: SOURCE_CHUNKS.length,
		});
	}, () => { calls.assertCurrent += 1; });

	const trailer = await streamFramescaperNativeAudioCarrierNativeMedia(
		plan, PROJECT, operation, { write: (bytes) => spool.write(bytes) },
	);
	const completed = await spool.complete('audio/wav');
	const bytes = new Uint8Array(await completed.bytes.arrayBuffer());

	assert.equal(calls.render, 1);
	assert.equal(calls.assertCurrent, SOURCE_CHUNKS.length + 1);
	assert.equal(expectedByteLength, 76);
	assert.equal(Object.isFrozen(trailer), true);
	assert.deepEqual(trailer, {
		byteLength: expectedByteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
		chunkCount: 3,
	});
	assert.equal(completed.byteLength, trailer.byteLength);
	assert.equal(completed.sha256, trailer.sha256);
	assert.equal(completed.chunkCount, trailer.chunkCount);
	assert.equal(completed.bytes.type, 'audio/wav');
	assert.equal(spool.peakByteLength, expectedByteLength);
	assert.equal(spool.abortCount, 0);

	const view = viewOf(bytes);
	assert.equal(ascii(bytes, 0, 4), 'RIFF');
	assert.equal(view.getUint32(4, true), bytes.byteLength - 8);
	assert.equal(ascii(bytes, 8, 4), 'WAVE');
	assert.equal(ascii(bytes, 12, 4), 'fmt ');
	assert.equal(view.getUint32(16, true), 16);
	assert.equal(view.getUint16(20, true), 3, 'IEEE float format');
	assert.equal(view.getUint16(22, true), 2, 'stereo mapping');
	assert.equal(view.getUint32(24, true), SAMPLE_RATE);
	assert.equal(view.getUint32(28, true), SAMPLE_RATE * 2 * Float32Array.BYTES_PER_ELEMENT);
	assert.equal(view.getUint16(32, true), 2 * Float32Array.BYTES_PER_ELEMENT);
	assert.equal(view.getUint16(34, true), 32);
	assert.equal(ascii(bytes, 36, 4), 'data');
	assert.equal(view.getUint32(40, true), SAMPLE_DURATION * 2 * Float32Array.BYTES_PER_ELEMENT);
	assert.deepEqual(decodeFloat32Samples(bytes, 44), expectedStereoSamples());
});

test('a native audio sink failure aborts and empties its bounded spool', async () => {
	const failure = new Error('native audio sink is unavailable');
	const controller = new AbortController();
	let spool: BoundedFakeSpool | undefined;
	const operation = audioOperation(controller, async (_project, _range, sink) => {
		await sink(SOURCE_CHUNKS[0], { frameOffset: 0, sampleRate: SAMPLE_RATE, frames: 2 });
		throw new Error('the failed sink must stop rendering');
	});

	await assert.rejects(
		createFramescaperNativeAudioCarrierNativeMedia(audioPlan(), PROJECT, operation, {
			createSpool(maximumChunkBytes, expectedByteLength, signal) {
				assert.equal(maximumChunkBytes, 4 * 1_024 ** 2);
				spool = new BoundedFakeSpool(maximumChunkBytes, expectedByteLength, signal, {
					failAtWrite: 2, failure,
				});
				return spool;
			},
		}),
		(error: unknown) => error === failure,
	);

	assert.ok(spool);
	assert.equal(spool.writeAttempts, 2, 'the header lands before the first PCM write fails');
	assert.equal(spool.peakByteLength, 44);
	assert.equal(spool.abortCount, 1);
	assert.equal(spool.byteLength, 0);
});

test('operation cancellation aborts and empties a partially written native audio spool', async () => {
	const cancellation = new DOMException('native render cancelled', 'AbortError');
	const controller = new AbortController();
	let spool: BoundedFakeSpool | undefined;
	const operation = audioOperation(controller, async (_project, _range, sink) => {
		await sink(SOURCE_CHUNKS[0], { frameOffset: 0, sampleRate: SAMPLE_RATE, frames: 2 });
		controller.abort(cancellation);
		await sink(SOURCE_CHUNKS[1], { frameOffset: 2, sampleRate: SAMPLE_RATE, frames: 2 });
		throw new Error('the aborted operation must not finish rendering');
	});

	await assert.rejects(
		createFramescaperNativeAudioCarrierNativeMedia(audioPlan(), PROJECT, operation, {
			createSpool(maximumChunkBytes, expectedByteLength, signal) {
				spool = new BoundedFakeSpool(maximumChunkBytes, expectedByteLength, signal);
				return spool;
			},
		}),
		(error: unknown) => error === cancellation,
	);

	assert.ok(spool);
	assert.equal(spool.writeAttempts, 2, 'only the WAV header and first PCM chunk reach the spool');
	assert.equal(spool.peakByteLength, 60);
	assert.equal(spool.abortCount, 1);
	assert.equal(spool.byteLength, 0);
});

function audioPlan(): UnifiedExactRenderPlanV14 {
	return {
		version: 14,
		strategy: 'framescaper-unified-exact-v1',
		project: { id: 'project-audio-carrier', revision: 7 },
		format: { container: 'mov', extension: 'mov', mimeType: 'video/quicktime' },
		deliveryProfile: 'encode-mov-prores-422-hq',
		codecs: {
			video: 'prores', videoEncoder: 'prores_ks', audio: 'pcm_s16le',
			audioEncoder: 'pcm_s16le', pixelFormat: 'yuv422p10le',
		},
		timebase: {
			sampleStart: SAMPLE_START, sampleDuration: SAMPLE_DURATION, sampleRate: SAMPLE_RATE,
			sequenceId: 'main-sequence', sequenceRate: { num: 24, den: 1 },
		},
		output: {
			frameRate: { num: 24, den: 1 }, frameCount: 1, quality: 'balanced',
			canvas: {
				width: 1_920, height: 1_080, fit: 'contain',
				pixelFormat: 'yuv422p10le', backgroundColor: '#000000',
			},
			includeAudio: true, audioLayout: 'stereo',
		},
		tracks: [], sources: [], nodes: [],
	};
}

function audioOperation(
	controller: AbortController,
	renderAudioToSink: RenderAudioToSink,
	assertCurrent: () => void = () => undefined,
): ProductNativeRenderInputOperation {
	return Object.freeze({
		project: PROJECT,
		signal: controller.signal,
		assertCurrent,
		renderAudio: async () => null,
		renderAudioToSink,
		finish() { /* the carrier does not own the operation lease */ },
	});
}

interface BoundedFakeSpoolOptions {
	readonly failAtWrite?: number;
	readonly failure?: Error;
}

class BoundedFakeSpool implements FramescaperNativeOpfsByteSpool {
	readonly #maximumChunkBytes: number;
	readonly #expectedByteLength: number;
	readonly #signal: AbortSignal;
	readonly #options: BoundedFakeSpoolOptions;
	readonly #chunks: Uint8Array[] = [];
	#byteLength = 0;
	#closed = false;
	abortCount = 0;
	writeAttempts = 0;
	peakByteLength = 0;

	constructor(
		maximumChunkBytes: number,
		expectedByteLength: number,
		signal: AbortSignal,
		options: BoundedFakeSpoolOptions = {},
	) {
		this.#maximumChunkBytes = maximumChunkBytes;
		this.#expectedByteLength = expectedByteLength;
		this.#signal = signal;
		this.#options = options;
	}

	get byteLength(): number { return this.#byteLength; }

	async write(bytes: Uint8Array): Promise<void> {
		this.writeAttempts += 1;
		if (this.#options.failAtWrite === this.writeAttempts) {
			throw this.#options.failure ?? new Error('bounded fake spool write failed');
		}
		if (this.#signal.aborted) throw this.#signal.reason;
		if (this.#closed) throw new Error('the bounded fake spool is closed');
		if (bytes.byteLength > this.#maximumChunkBytes) {
			throw new RangeError('the bounded fake spool received an oversized chunk');
		}
		if (this.#byteLength > this.#expectedByteLength - bytes.byteLength) {
			throw new RangeError('the bounded fake spool exceeded its exact declaration');
		}
		this.#chunks.push(bytes.slice());
		this.#byteLength += bytes.byteLength;
		this.peakByteLength = Math.max(this.peakByteLength, this.#byteLength);
	}

	async complete(type: string): Promise<Readonly<{
		readonly bytes: Blob;
		readonly byteLength: number;
		readonly sha256: string;
		readonly chunkCount: number;
	}>> {
		if (this.#closed || this.#byteLength !== this.#expectedByteLength) {
			throw new Error('the bounded fake spool cannot complete an inexact carrier');
		}
		this.#closed = true;
		const bytes = joinBytes(this.#chunks);
		return Object.freeze({
			bytes: new Blob([bytes], { type }),
			byteLength: bytes.byteLength,
			sha256: createHash('sha256').update(bytes).digest('hex'),
			chunkCount: this.#chunks.length,
		});
	}

	async abort(): Promise<void> {
		this.abortCount += 1;
		this.#closed = true;
		this.#chunks.length = 0;
		this.#byteLength = 0;
	}
}

function expectedStereoSamples(): number[] {
	const result: number[] = [];
	for (const chunk of SOURCE_CHUNKS) {
		const [left, right, center] = chunk;
		for (let frame = 0; frame < left.length; frame += 1) {
			result.push(
				Math.fround(left[frame] + center[frame] * Math.SQRT1_2),
				Math.fround(right[frame] + center[frame] * Math.SQRT1_2),
			);
		}
	}
	return result;
}

function decodeFloat32Samples(bytes: Uint8Array, offset: number): number[] {
	const view = viewOf(bytes);
	const samples: number[] = [];
	for (let cursor = offset; cursor < bytes.byteLength; cursor += Float32Array.BYTES_PER_ELEMENT) {
		samples.push(view.getFloat32(cursor, true));
	}
	return samples;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function viewOf(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function joinBytes(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}
