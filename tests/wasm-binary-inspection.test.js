import assert from 'node:assert/strict';
import test from 'node:test';

import {
	readCodecDefinedMemoryLimits,
	readNyquistDefinedMemoryLimits,
	readStrictDefinedMemoryLimits,
} from '../scripts/lib/wasm-binary-inspection.mjs';

const wasmHeader = Object.freeze([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

test('codec memory inspection preserves shared, maximum, and memory64 limits', () => {
	const wasm = memoryModule([
		0x03,
		0x00, 0x02,
		0x03, 0x04, 0x08,
		0x04, 0x01,
	]);

	assert.deepEqual(readCodecDefinedMemoryLimits(wasm), [
		{ minimumPages: 2, maximumPages: null, shared: false, memory64: false },
		{ minimumPages: 4, maximumPages: 8, shared: true, memory64: false },
		{ minimumPages: 1, maximumPages: null, shared: false, memory64: true },
	]);
});

test('codec memory inspection retains its permissive six-byte LEB128 boundary', () => {
	assert.deepEqual(
		readCodecDefinedMemoryLimits(memoryModule([0x80, 0x80, 0x80, 0x80, 0x80, 0x00])),
		[],
	);
	assert.throws(
		() => readCodecDefinedMemoryLimits(memoryModule([0x80, 0x80, 0x80, 0x80, 0x80, 0x80])),
		new Error('invalid unsigned LEB128'),
	);
	assert.throws(
		() => readCodecDefinedMemoryLimits(memoryModule([0x80])),
		new Error('invalid unsigned LEB128'),
	);
});

test('strict memory inspection rejects memory64 and malformed memory sections', () => {
	assert.throws(
		() => readStrictDefinedMemoryLimits(memoryModule([0x01, 0x04, 0x01])),
		new Error('memory64 limits are not supported by this audit'),
	);
	assert.throws(
		() => readStrictDefinedMemoryLimits(memoryModule([0x01, 0x04, 0x01]), {
			memory64Error: 'memory64 limits are not supported',
		}),
		new Error('memory64 limits are not supported'),
	);
	assert.throws(
		() => readStrictDefinedMemoryLimits(memoryModule([0x00, 0xff])),
		new Error('malformed memory section'),
	);
});

test('permissive codec and Nyquist inspection retain trailing memory bytes', () => {
	const wasm = memoryModule([0x00, 0xff]);
	assert.deepEqual(readCodecDefinedMemoryLimits(wasm), []);
	assert.deepEqual(readNyquistDefinedMemoryLimits(wasm), []);
});

test('strict memory inspection distinguishes truncated and overflowing 32-bit LEB128', () => {
	assert.throws(
		() => readStrictDefinedMemoryLimits(memoryModule([0x80])),
		new Error('truncated unsigned LEB128 value'),
	);
	assert.throws(
		() => readStrictDefinedMemoryLimits(memoryModule([0x80, 0x80, 0x80, 0x80, 0x80])),
		new Error('unsigned LEB128 value exceeds 32 bits'),
	);
});

test('Nyquist memory inspection preserves its memory64 and LEB128 diagnostics', () => {
	assert.deepEqual(readNyquistDefinedMemoryLimits(memoryModule([0x01, 0x04, 0x01])), [
		{ minimumPages: 1, maximumPages: null, shared: false, memory64: true },
	]);
	assert.throws(
		() => readNyquistDefinedMemoryLimits(memoryModule([0x80])),
		new Error('truncated LEB128 value'),
	);
	assert.throws(
		() => readNyquistDefinedMemoryLimits(memoryModule([0x80, 0x80, 0x80, 0x80, 0x80])),
		new Error('LEB128 value exceeds 32 bits'),
	);
});

test('memory inspection retains family-specific section-bound diagnostics', () => {
	const truncatedSection = Buffer.from([...wasmHeader, 0x05, 0x02, 0x00]);
	assert.throws(
		() => readCodecDefinedMemoryLimits(truncatedSection),
		new Error('section extends beyond artifact'),
	);
	assert.throws(
		() => readStrictDefinedMemoryLimits(truncatedSection),
		new Error('section extends beyond the artifact'),
	);
	assert.throws(
		() => readNyquistDefinedMemoryLimits(truncatedSection),
		new Error('section extends beyond artifact'),
	);
});

function memoryModule(payload) {
	return Buffer.from([...wasmHeader, 0x05, payload.length, ...payload]);
}
