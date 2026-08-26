/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceEmbeddingMatrixV1,
	createAssistanceFramePackV1,
	reviewAssistanceEmbeddingMatrixV1,
	reviewAssistanceFramePackV1,
} from '../src/common/editor/assistance/binary-formats-v1.ts';

test('embedding matrix v1 round-trips deterministic normalized Float32 rows', () => {
	const bytes = createAssistanceEmbeddingMatrixV1({
		dimensions: 3,
		vectors: [new Float32Array([1, 0, 0]), new Float32Array([0, 0.6, 0.8])],
	});
	assert.deepEqual(bytes, createAssistanceEmbeddingMatrixV1({
		dimensions: 3,
		vectors: [[1, 0, 0], [0, 0.6, 0.8]],
	}));
	const reviewed = reviewAssistanceEmbeddingMatrixV1(bytes);
	assert.equal(reviewed.schemaVersion, 1);
	assert.equal(reviewed.rowCount, 2);
	assert.equal(reviewed.dimensions, 3);
	assert.deepEqual([...reviewed.vector(0)], [1, 0, 0]);
	assert.deepEqual([...reviewed.vector(1)], [0, Math.fround(0.6), Math.fround(0.8)]);
	const copy = reviewed.vector(0);
	copy[0] = 0;
	assert.deepEqual([...reviewed.vector(0)], [1, 0, 0]);
});

test('embedding matrix v1 refuses malformed geometry, non-finite, and non-normalized rows', () => {
	assert.throws(() => createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [[1]] }),
		/dimension/iu);
	assert.throws(() => createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [[1, Number.NaN]] }),
		/finite/iu);
	assert.throws(() => createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [[0.5, 0.5]] }),
		/normalized/iu);
	const valid = createAssistanceEmbeddingMatrixV1({ dimensions: 2, vectors: [[1, 0]] });
	assert.throws(() => reviewAssistanceEmbeddingMatrixV1(valid.subarray(0, valid.byteLength - 1)),
		/length|truncated/iu);
	const trailing = new Uint8Array(valid.byteLength + 1);
	trailing.set(valid);
	assert.throws(() => reviewAssistanceEmbeddingMatrixV1(trailing), /length|trailing/iu);
	const corrupt = valid.slice();
	corrupt[0] ^= 0xff;
	assert.throws(() => reviewAssistanceEmbeddingMatrixV1(corrupt), /magic|format/iu);
	const wrongDimension = valid.slice();
	const headerOffset = new TextEncoder().encode('soundscaper-embedding-matrix-v1\n').byteLength;
	new DataView(wrongDimension.buffer).setUint32(headerOffset + 8, 8_193, true);
	assert.throws(() => reviewAssistanceEmbeddingMatrixV1(wrongDimension), /dimension/iu);
});

test('assistance frame-pack v1 reviews arbitrary data-plane chunk boundaries', () => {
	const chunks = createAssistanceFramePackV1({
		width: 2,
		height: 1,
		timescale: 90_000,
		maximumChunkBytes: 7,
		frames: [
			{ sourceFrame: 2, presentationTick: '3003', rgba: new Uint8Array([
				255, 0, 0, 255, 0, 255, 0, 255,
			]) },
			{ sourceFrame: 5, presentationTick: '6006', rgba: new Uint8Array([
				0, 0, 255, 255, 255, 255, 255, 255,
			]) },
		],
	});
	assert.ok(chunks.length > 5);
	assert.ok(chunks.every((chunk) => chunk.byteLength <= 7));
	const reviewed = reviewAssistanceFramePackV1(chunks);
	assert.deepEqual({
		schemaVersion: reviewed.schemaVersion,
		width: reviewed.width,
		height: reviewed.height,
		timescale: reviewed.timescale,
		frameCount: reviewed.frameCount,
	}, { schemaVersion: 1, width: 2, height: 1, timescale: 90_000, frameCount: 2 });
	assert.deepEqual(reviewed.frame(0), {
		sourceFrame: 2,
		presentationTick: '3003',
		rgba: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]),
	});
	const frame = reviewed.frame(0);
	frame.rgba[0] = 0;
	assert.equal(reviewed.frame(0).rgba[0], 255);
});

test('assistance frame-pack v1 rejects unsafe, unordered, truncated, and trailing data', () => {
	const request = {
		width: 1,
		height: 1,
		timescale: 1_000,
		maximumChunkBytes: 1024,
		frames: [{ sourceFrame: 0, presentationTick: '0', rgba: new Uint8Array([0, 0, 0, 255]) }],
	};
	assert.throws(() => createAssistanceFramePackV1({ ...request, frames: [
		request.frames[0],
		{ ...request.frames[0], sourceFrame: 1 },
	] }), /presentation ticks.*increasing/iu);
	assert.throws(() => createAssistanceFramePackV1({ ...request, frames: [{
		...request.frames[0], rgba: new Uint8Array([0, 0, 0]),
	}] }), /RGBA.*length/iu);
	const body = join(createAssistanceFramePackV1(request));
	assert.throws(() => reviewAssistanceFramePackV1(body.subarray(0, body.byteLength - 1)),
		/truncated|length/iu);
	const trailing = new Uint8Array(body.byteLength + 1);
	trailing.set(body);
	assert.throws(() => reviewAssistanceFramePackV1(trailing), /trailing/iu);
});

function join(chunks: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
}
