/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	encodeRealtimePcmSpoolChunk,
	readRealtimePcmSpool,
} from '../src/common/editor/controller/export/internal/audio/realtime-pcm-spool.ts';

test('realtime PCM spool round-trips planar chunks and the final partial block', async () => {
	const first = [new Float32Array([0.25, -0.5, 0.75]), new Float32Array([1, 0, -1])];
	const second = [new Float32Array([0.125]), new Float32Array([-0.125])];
	const blob = new Blob([
		encodeRealtimePcmSpoolChunk(first).buffer as ArrayBuffer,
		encodeRealtimePcmSpoolChunk(second).buffer as ArrayBuffer,
	]);
	const chunks: (readonly Float32Array[])[] = [];
	for await (const chunk of readRealtimePcmSpool(blob, 2, [3, 1])) chunks.push(chunk);
	assert.equal(chunks.length, 2);
	assert.deepEqual(chunks.map((chunk) => chunk.map((channel) => [...channel])), [
		[[0.25, -0.5, 0.75], [1, 0, -1]],
		[[0.125], [-0.125]],
	]);
});

test('realtime PCM spool rejects partial frames', async () => {
	await assert.rejects(async () => {
		for await (const _chunk of readRealtimePcmSpool(new Blob([new ArrayBuffer(7)]), 2, [3])) {
			// Consume the generator so validation runs.
		}
	}, /whole frames/u);
});
