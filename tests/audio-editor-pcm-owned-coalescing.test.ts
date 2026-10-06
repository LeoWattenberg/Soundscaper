/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlanarPcmChunkCoalescer } from '../src/common/editor/pcm-chunks.js';
import { createCoalescingSourceWriter, writeBuffer } from '../src/common/editor/controller/source/source-audio.ts';
import { deferred } from './helpers/async-test-control.ts';

test('owned aligned PCM packets pass directly to the consumer under the same backpressure and lifetime guards', async () => {
	const started = deferred<void>(), gate = deferred<void>();
	const input = [Float32Array.of(1, 2, 3, 4), Float32Array.of(-1, -2, -3, -4)];
	let received: Float32Array[] | undefined;
	const coalescer = createPlanarPcmChunkCoalescer({ chunkFrames: 4,
		onChunk: async (channels: Float32Array[]) => { received = channels; started.resolve(); await gate.promise; } });
	const write = coalescer.writeOwned(input);
	await started.promise;
	assert.equal(received?.[0], input[0]); assert.equal(received?.[1], input[1]);
	assert.equal(coalescer.framesWritten, 4); assert.equal(coalescer.framesEmitted, 0);
	await assert.rejects(coalescer.writeOwned(input), /in progress/iu);
	await assert.rejects(coalescer.finalize(), /in progress/iu);
	gate.resolve(); await write;
	assert.deepEqual(await coalescer.finalize(), { channelCount: 2, frameCount: 4, chunkFrames: 4, chunkCount: 1 });
});

test('borrowed aligned writes and owned partial boundaries preserve isolated copies', async () => {
	for (const mode of ['borrowed', 'partial'] as const) {
		const input = Float32Array.of(1, 2, 3, 4), emitted: Float32Array[][] = [];
		const coalescer = createPlanarPcmChunkCoalescer({ chunkFrames: 4,
			onChunk: async (channels: Float32Array[]) => { emitted.push(channels); } });
		if (mode === 'partial') { await coalescer.writeOwned([input.subarray(0, 2)]); await coalescer.writeOwned([input.subarray(2)]); }
		else await coalescer.write([input]);
		await coalescer.finalize(); input.fill(9);
		assert.notEqual(emitted[0]![0], input); assert.deepEqual(emitted[0]![0], Float32Array.of(1, 2, 3, 4));
	}
});

test('new AudioBuffer slices use the owned coalescing path without sharing source samples', async (t) => {
	const input = new Float32Array(65_536).fill(0.25), copies: Float32Array[] = [], received: Float32Array[][] = [];
	t.mock.method(input, 'slice', (begin?: number, end?: number) => { const copy = Float32Array.prototype.slice.call(input, begin, end); copies.push(copy); return copy; });
	const writer = createCoalescingSourceWriter({ write: async (channels: Float32Array[]) => { received.push(channels); }, commit: async () => ({}), abort() {} });
	await writeBuffer(writer, { length: input.length, numberOfChannels: 1, sampleRate: 48_000, getChannelData: () => input });
	await writer.commit();
	assert.equal(received[0]![0], copies[0]); assert.notEqual(received[0]![0], input);
	input.fill(0); assert.equal(received[0]![0]![0], 0.25);
});
