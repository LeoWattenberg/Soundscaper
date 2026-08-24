/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	readBoundedRegularFile,
	type BoundedRegularFileHandle,
} from '../desktop/bounded-regular-file.ts';

test('bounded regular-file reads require every byte promised by the initial stat', async () => {
	const handle = fakeHandle({ declaredSize: 3, chunks: [Uint8Array.of(1, 2), new Uint8Array()] });
	assert.deepEqual(await readBoundedRegularFile('/scratch/output', 8, { openFile: async () => handle }), {
		status: 'unavailable', reason: 'invalid',
	});
	assert.equal(handle.closed, true);
});

test('bounded regular-file reads reject growth past the stat snapshot', async () => {
	const handle = fakeHandle({ declaredSize: 2, chunks: [Uint8Array.of(1, 2), Uint8Array.of(3)] });
	assert.deepEqual(await readBoundedRegularFile('/scratch/output', 8, { openFile: async () => handle }), {
		status: 'unavailable', reason: 'limit',
	});
});

test('bounded regular-file reads return an owned exact snapshot', async () => {
	const handle = fakeHandle({ declaredSize: 3, chunks: [Uint8Array.of(1), Uint8Array.of(2, 3), new Uint8Array()] });
	assert.deepEqual(await readBoundedRegularFile('/scratch/output', 3, { openFile: async () => handle }), {
		status: 'available', bytes: Uint8Array.of(1, 2, 3),
	});
});

test('bounded regular-file reads require a stable final stat', async () => {
	const handle = fakeHandle({
		declaredSize: 2, restatedSize: 3,
		chunks: [Uint8Array.of(1, 2), new Uint8Array()],
	});
	assert.deepEqual(await readBoundedRegularFile('/scratch/output', 8, { openFile: async () => handle }), {
		status: 'unavailable', reason: 'invalid',
	});
});

function fakeHandle(options: Readonly<{
	readonly declaredSize: number;
	readonly restatedSize?: number;
	readonly chunks: readonly Uint8Array[];
}>): BoundedRegularFileHandle & { closed: boolean } {
	let index = 0;
	let statCount = 0;
	return {
		closed: false,
		stat: async () => ({
			size: statCount++ === 0 ? options.declaredSize : options.restatedSize ?? options.declaredSize,
			isFile: () => true,
		}),
		async read(buffer, offset, length) {
			const chunk = options.chunks[index++] ?? new Uint8Array();
			const admitted = chunk.subarray(0, length);
			buffer.set(admitted, offset);
			return { bytesRead: admitted.byteLength };
		},
		async close() { this.closed = true; },
	};
}
