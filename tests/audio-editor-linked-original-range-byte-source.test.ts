/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLinkedOriginalRangeByteSource,
	LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES,
} from '../src/common/editor/storage/linked-original-range-byte-source.ts';

test('a logical range slice is assembled from provider reads capped at four MiB', async () => {
	const size = LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES + 17;
	const body = new Uint8Array(size);
	body[0] = 11;
	body[LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES - 1] = 22;
	body[LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES] = 33;
	body[size - 1] = 44;
	const requests: Array<Readonly<{ offset: number; length: number }>> = [];
	const source = createLinkedOriginalRangeByteSource({
		size,
		type: 'audio/wav',
		readRange(request) {
			requests.push({ offset: request.offset, length: request.length });
			return body.slice(request.offset, request.offset + request.length);
		},
	});

	const bytes = await source.slice(0, size);

	assert.deepEqual(requests, [
		{ offset: 0, length: LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES },
		{ offset: LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES, length: 17 },
	]);
	assert.equal(bytes.byteLength, size);
	assert.deepEqual(
		[bytes[0], bytes[LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES - 1], bytes[LINKED_ORIGINAL_RANGE_MAXIMUM_BYTES], bytes[size - 1]],
		[11, 22, 33, 44],
	);
});
