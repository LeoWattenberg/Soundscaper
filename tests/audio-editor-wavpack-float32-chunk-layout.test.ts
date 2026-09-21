/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	interleavePlanarFloat32Chunk,
	planarFloat32Chunk,
} from '../src/common/editor/wavpack-float32-chunk-layout.ts';

test('WavPack Float32 layout extracts a middle interleaved frame range as planar words', () => {
	const inputStorage = new Uint8Array((12 + 2) * Uint32Array.BYTES_PER_ELEMENT);
	const input = inputStorage.subarray(4, inputStorage.byteLength - 4);
	writeWords(input, [
		0x0000_0001, 0x0000_0011, 0x0000_0101,
		0x0000_0002, 0x0000_0012, 0x0000_0102,
		0x0000_0003, 0x0000_0013, 0x0000_0103,
		0x0000_0004, 0x0000_0014, 0x0000_0104,
	]);

	const planar = planarFloat32Chunk(input, 1, 2, 3);

	assert.deepEqual(readWords(planar), [
		0x0000_0002, 0x0000_0003,
		0x0000_0012, 0x0000_0013,
		0x0000_0102, 0x0000_0103,
	]);
});

test('WavPack Float32 layout interleaves a planar chunk at the requested output frame', () => {
	const planar = words([
		0x3f80_0000, 0x4000_0000,
		0xbf80_0000, 0xc000_0000,
		0x8000_0000, 0x7fc0_0001,
	]);
	const outputStorage = words(new Array(14).fill(0xaaaa_aaaa));
	const output = outputStorage.subarray(4, outputStorage.byteLength - 4);

	interleavePlanarFloat32Chunk(planar, output, 1, 2, 3, () => new Error('invalid geometry'));

	assert.deepEqual(readWords(output), [
		0xaaaa_aaaa, 0xaaaa_aaaa, 0xaaaa_aaaa,
		0x3f80_0000, 0xbf80_0000, 0x8000_0000,
		0x4000_0000, 0xc000_0000, 0x7fc0_0001,
		0xaaaa_aaaa, 0xaaaa_aaaa, 0xaaaa_aaaa,
	]);
});

test('WavPack Float32 layout delegates invalid planar geometry without mutating output', () => {
	const failure = new TypeError('caller-specific geometry failure');
	const output = words(new Array(8).fill(0x5555_5555));
	const before = output.slice();
	let errorFactoryCalls = 0;

	assert.throws(() => {
		interleavePlanarFloat32Chunk(words([1, 2, 3]), output, 1, 2, 2, () => {
			errorFactoryCalls += 1;
			return failure;
		});
	}, (error: unknown) => error === failure);
	assert.equal(errorFactoryCalls, 1);
	assert.deepEqual(output, before);
});

function words(values: readonly number[]): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(values.length * Uint32Array.BYTES_PER_ELEMENT);
	writeWords(output, values);
	return output;
}

function writeWords(output: Uint8Array, values: readonly number[]): void {
	assert.equal(output.byteLength, values.length * Uint32Array.BYTES_PER_ELEMENT);
	const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
	values.forEach((value, index) => { view.setUint32(index * Uint32Array.BYTES_PER_ELEMENT, value, true); });
}

function readWords(input: Uint8Array): number[] {
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	return Array.from(
		{ length: input.byteLength / Uint32Array.BYTES_PER_ELEMENT },
		(_value, index) => view.getUint32(index * Uint32Array.BYTES_PER_ELEMENT, true),
	);
}
