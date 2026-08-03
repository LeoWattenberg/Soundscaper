/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { encodeAiff } from '../src/common/editor/aiff.js';
import {
	createAiffBlobPcmChunkReader,
	inspectAiffBlobPcm,
} from '../src/common/editor/aiff-pcm-chunk-reader.ts';

function encodedAiff(
	channels: Float32Array[],
	options: Readonly<{
		sampleRate: number;
		sampleFormat: 'int16' | 'int24' | 'int32' | 'float32';
		dither?: 'none';
	}>,
): Uint8Array<ArrayBuffer> {
	const encoded = encodeAiff(channels, options);
	assert.ok(encoded instanceof Uint8Array);
	const copy = new Uint8Array(encoded.byteLength);
	copy.set(encoded);
	return copy;
}

function trackedSource(bytes: Uint8Array<ArrayBuffer>) {
	const blob = new Blob([bytes.buffer]);
	const reads: Array<readonly [number, number]> = [];
	return {
		reads,
		source: {
			size: blob.size,
			slice(start: number, end: number) {
				reads.push([start, end]);
				return blob.slice(start, end);
			},
		},
	};
}

test('bounded AIFF inspection and chunk reads decode signed big-endian PCM', async () => {
	const encoded = encodedAiff([
		Float32Array.of(-1, -0.5, 0, 0.5, 0.999),
		Float32Array.of(0.25, -0.25, 0.75, -0.75, 0),
	], { sampleRate: 44_100, sampleFormat: 'int16', dither: 'none' });
	const { source, reads } = trackedSource(encoded);

	const descriptor = await inspectAiffBlobPcm(source);
	assert.deepEqual(descriptor, {
		container: 'aiff',
		encoding: 'pcm-integer',
		sampleFormat: 'int16',
		sampleRate: 44_100,
		channelCount: 2,
		frameCount: 5,
		bitDepth: 16,
		bytesPerSample: 2,
		blockAlign: 4,
		byteRate: 176_400,
		dataOffset: 54,
		dataByteLength: 20,
		formByteLength: encoded.byteLength,
		sourceByteLength: encoded.byteLength,
	});
	assert.equal(Object.isFrozen(descriptor), true);
	assert.ok(reads.length >= 5);
	assert.ok(reads.every(([start, end]) => end - start <= 18));
	assert.equal(reads.some(([start, end]) => start === 54 && end > start), false);

	const reader = createAiffBlobPcmChunkReader(source, { descriptor, chunkFrames: 2 });
	assert.equal(reader.chunkCount, 3);
	const first = await reader.readChunk(0);
	const final = await reader.readChunk(2);
	assert.deepEqual([...first.channels[0]!], [-1, -0.5]);
	assert.deepEqual([...first.channels[1]!], [0.25, -0.25]);
	assert.equal(first.final, false);
	assert.equal(final.frameOffset, 4);
	assert.equal(final.frames, 1);
	assert.equal(final.final, true);
	assert.ok(Math.abs(final.channels[0]![0]! - 0.998_992_919_921_875) < 1e-12);
	assert.equal(final.channels[1]![0], 0);
	assert.deepEqual(reads.at(-2), [54, 62]);
	assert.deepEqual(reads.at(-1), [70, 74]);
});

test('AIFF PCM reads preserve 24-bit and 32-bit integer sample geometry', async () => {
	for (const sampleFormat of ['int24', 'int32'] as const) {
		const encoded = encodedAiff([
			Float32Array.of(-1, -0.5, 0, 0.5),
		], { sampleRate: 48_000, sampleFormat, dither: 'none' });
		const descriptor = await inspectAiffBlobPcm(new Blob([encoded.buffer]));
		const reader = createAiffBlobPcmChunkReader(new Blob([encoded.buffer]), {
			descriptor,
			chunkFrames: 4,
		});
		const chunk = await reader.readChunk(0);

		assert.equal(descriptor.sampleFormat, sampleFormat);
		assert.deepEqual([...chunk.channels[0]!], [-1, -0.5, 0, 0.5]);
	}
});

test('AIFF admission rejects AIFC, unsupported geometry, truncation, and excess chunks', async () => {
	const integer = encodedAiff([Float32Array.of(-1, 0, 0.5)], {
		sampleRate: 48_000,
		sampleFormat: 'int16',
		dither: 'none',
	});
	const floating = encodedAiff([Float32Array.of(0.25)], {
		sampleRate: 48_000,
		sampleFormat: 'float32',
	});
	await assert.rejects(
		inspectAiffBlobPcm(new Blob([floating.buffer])),
		/AIFF-C|compressed|unsupported/iu,
	);

	const unsupportedDepth = integer.slice();
	new DataView(unsupportedDepth.buffer).setUint16(26, 12, false);
	await assert.rejects(
		inspectAiffBlobPcm(new Blob([unsupportedDepth.buffer])),
		/bit depth/iu,
	);

	const mismatchedFrames = integer.slice();
	new DataView(mismatchedFrames.buffer).setUint32(22, 4, false);
	await assert.rejects(
		inspectAiffBlobPcm(new Blob([mismatchedFrames.buffer])),
		/PCM geometry|sound data/iu,
	);
	await assert.rejects(
		inspectAiffBlobPcm(new Blob([integer.buffer.slice(0, integer.byteLength - 1)])),
		/truncated|FORM/iu,
	);
	await assert.rejects(
		inspectAiffBlobPcm(new Blob([integer.buffer]), { maxChunks: 1 }),
		/chunk inspection limit/iu,
	);
});

test('AIFF chunk readers reject descriptor drift and preserve cancellation', async () => {
	const encoded = encodedAiff([Float32Array.of(-1, 0, 0.5)], {
		sampleRate: 48_000,
		sampleFormat: 'int16',
		dither: 'none',
	});
	const source = new Blob([encoded.buffer]);
	const descriptor = await inspectAiffBlobPcm(source);
	for (const candidate of [
		{ ...descriptor, sourceByteLength: descriptor.sourceByteLength + 1 },
		{ ...descriptor, frameCount: descriptor.frameCount + 1 },
		{ ...descriptor, dataOffset: descriptor.dataOffset + 1 },
	]) {
		assert.throws(
			() => createAiffBlobPcmChunkReader(source, { descriptor: candidate }),
			/descriptor|geometry|range|different-sized/iu,
		);
	}

	const reader = createAiffBlobPcmChunkReader(source, { descriptor, chunkFrames: 2 });
	await assert.rejects(reader.readChunk(-1), /chunk index/iu);
	await assert.rejects(reader.readChunk(reader.chunkCount), /chunk index/iu);
	const controller = new AbortController();
	const reason = new Error('cancel linked AIFF read');
	controller.abort(reason);
	await assert.rejects(reader.readChunk(0, { signal: controller.signal }), reason);
});
