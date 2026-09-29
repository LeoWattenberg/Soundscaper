/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createReadCapabilityRangeStream } from '../desktop/read-capability-range-stream.js';

test('range stream assembles short reads without skipping bytes', async () => {
	const source = Buffer.from([1, 2, 3, 4, 5]);
	const positions = [];
	const handle = {
		async read(buffer, offset, length, position) {
			positions.push(position);
			const bytesRead = Math.min(1, length);
			source.copy(buffer, offset, position, position + bytesRead);
			return { bytesRead };
		},
	};
	const chunks = [];
	for await (const chunk of createReadCapabilityRangeStream(handle, { start: 1, end: 3 })) chunks.push(chunk);
	assert.deepEqual(Buffer.concat(chunks), Buffer.from([2, 3, 4]));
	assert.deepEqual(positions, [1, 2, 3]);
});

test('range stream rejects early zero-byte reads', async () => {
	const stream = createReadCapabilityRangeStream({ read: async () => ({ bytesRead: 0 }) }, { start: 0, end: 1 });
	await assert.rejects(async () => { for await (const _chunk of stream) { /* drain */ } }, /ended before.*range/iu);
});

test('range stream rejects oversized byte counts from a file handle', async () => {
	const stream = createReadCapabilityRangeStream({ read: async () => ({ bytesRead: 2 }) }, { start: 0, end: 0 });
	await assert.rejects(async () => { for await (const _chunk of stream) { /* drain */ } }, /ended before.*range/iu);
});

test('range stream propagates asynchronous handle read failures', async () => {
	const failure = new Error('disk read failed');
	const stream = createReadCapabilityRangeStream({ read: async () => { throw failure; } }, { start: 0, end: 0 });
	await assert.rejects(async () => { for await (const _chunk of stream) { /* drain */ } }, (error) => error === failure);
});

test('range stream propagates synchronous handle read failures as stream errors', async () => {
	const failure = new Error('synchronous file read failure');
	const stream = createReadCapabilityRangeStream({ read: () => { throw failure; } }, { start: 0, end: 0 });
	await assert.rejects(async () => { for await (const _chunk of stream) { /* drain */ } }, (error) => error === failure);
});

test('range stream delays destruction until its pending file read settles', async () => {
	const pending = Promise.withResolvers();
	let closed = false;
	const stream = createReadCapabilityRangeStream({ read: () => pending.promise }, { start: 0, end: 0 });
	stream.on('error', () => undefined);
	stream.read();
	stream.destroy(new Error('cancelled'));
	stream.once('close', () => { closed = true; });
	await Promise.resolve();
	assert.equal(closed, false);
	pending.resolve({ bytesRead: 1 });
	await new Promise((resolve) => stream.once('close', resolve));
	assert.equal(closed, true);
});

test('range stream bounds each file-handle read to 64 KiB', async () => {
	let maximum = 0;
	const handle = {
		async read(buffer, _offset, length) {
			maximum = Math.max(maximum, length);
			buffer.fill(7, 0, length);
			return { bytesRead: length };
		},
	};
	let bytes = 0;
	for await (const chunk of createReadCapabilityRangeStream(handle, { start: 0, end: 140_000 })) {
		bytes += chunk.byteLength;
	}
	assert.equal(maximum, 64 * 1024);
	assert.equal(bytes, 140_001);
});

test('range stream rejects invalid offsets and handles before reading', () => {
	for (const range of [
		{ start: -1, end: 1 },
		{ start: 2, end: 1 },
		{ start: 0.5, end: 1 },
		{ start: 0, end: Number.MAX_SAFE_INTEGER + 1 },
	]) {
		assert.throws(() => createReadCapabilityRangeStream({ read: () => assert.fail() }, range), TypeError);
	}
	assert.throws(() => createReadCapabilityRangeStream({}, { start: 0, end: 1 }), TypeError);
});
