/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

import { encodePcmAdaptively, loadWavPackWasm, maximumWavPackPayloadBytes, WAVPACK_PCM_MAXIMUM_ENCODED_BYTES } from '../../src/common/editor/wavpack/index.js';

const runtime = await loadWavPackWasm(await readFile(new URL('../../src/common/editor/wavpack/wavpack.wasm', import.meta.url)));
const results = [];
for (const [frames, channels, pattern] of [
	[1, 1, 'random-bits'], [1, 64, 'random-bits'], [16, 8, 'random-bits'],
	[1_024, 1, 'normalized-noise'], [1_024, 64, 'random-bits'],
	[65_536, 1, 'random-bits'], [65_536, 8, 'normalized-noise'],
	[65_536, 64, 'random-bits'], [65_536, 64, 'edge-bits'],
]) {
	const raw = fixture(frames, channels, pattern);
	const budgetBytes = maximumWavPackPayloadBytes(frames, channels);
	const started = performance.now();
	const result = encodePcmAdaptively(raw, { frames, channelCount: channels, sampleRate: 48_000, runtime, requireWavPack: true });
	const encodeMs = performance.now() - started;
	const decoded = runtime.decode(result.payload, { frames, channelCount: channels, sampleRate: 48_000 });
	assert.deepEqual(new Uint32Array(decoded), new Uint32Array(raw));
	assert.ok(result.payload.byteLength <= budgetBytes);
	assert.ok(runtime.memory.buffer.byteLength <= 128 * 1024 * 1024);
	results.push({ frames, channels, pattern, rawBytes: raw.byteLength, payloadBytes: result.payload.byteLength,
		budgetBytes, expansionRatio: result.payload.byteLength / raw.byteLength, encodeMs,
		nativeMemoryBytes: runtime.memory.buffer.byteLength, exactSampleBits: true });
}
process.stdout.write(`${JSON.stringify({ node: process.version, maximumEncodedPacketBytes: WAVPACK_PCM_MAXIMUM_ENCODED_BYTES,
	fixtureSeed: '0x6d2b79f5', interpretation: 'Native codec packet probes; not Apply or Generate latency.', results }, null, 2)}\n`);

function fixture(frames, channels, pattern) {
	const buffer = new ArrayBuffer(frames * channels * 4);
	const bits = new Uint32Array(buffer), floats = new Float32Array(buffer);
	const edgeBits = [0, 0x80000000, 1, 0x7fffff, 0x7f800000, 0xff800000, 0x7fc00001, 0x7f800001, 0x7f7fffff, 0xff7fffff];
	let state = 0x6d2b79f5;
	for (let index = 0; index < bits.length; index += 1) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		if (pattern === 'edge-bits') bits[index] = edgeBits[index % edgeBits.length];
		else if (pattern === 'normalized-noise') floats[index] = (state >>> 0) / 0x80000000 - 1;
		else bits[index] = state >>> 0;
	}
	return buffer;
}
