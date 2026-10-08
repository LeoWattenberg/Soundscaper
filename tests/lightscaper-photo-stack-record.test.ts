/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { photoStackRecordV1, readPhotoStackRecordV1, PHOTO_STACK_RECORD_LIMITS_V1 } from '../src/lightscaper/catalog/photo-stack-record-v1.ts';

function stack(photoIds = ['photo-a', 'photo-b']) {
	return { schemaVersion: 1, kind: 'photo-stack', catalogId: 'catalog', id: 'stack', revision: 0,
		photoIds, coverPhotoId: photoIds[0] };
}

test('private forward membership projection preserves ordered canonical documents without entering archive schema', () => {
	const input = stack(), stored = photoStackRecordV1(input);
	assert.deepEqual(Object.keys(stored), ['key', 'catalogId', 'memberKeys', 'document']);
	assert.deepEqual(stored.memberKeys, ['catalog|photo-a', 'catalog|photo-b']);
	assert.ok(Object.isFrozen(stored) && Object.isFrozen(stored.memberKeys));
	input.photoIds.reverse();
	assert.deepEqual(stored.document.photoIds, ['photo-a', 'photo-b']);
	assert.deepEqual(readPhotoStackRecordV1(stored, 'catalog', 'catalog|stack'), stored.document);
	assert.equal(Object.hasOwn(stored.document, 'memberKeys'), false);
});

test('closed private stack reads refuse every missing, unordered or corrupted membership projection without invoking accessors', () => {
	const stored = photoStackRecordV1(stack()); let accesses = 0;
	const { memberKeys: ignored, ...withoutKeys } = stored; void ignored;
	const sparse = new Array<string>(2); sparse[1] = 'catalog|photo-b';
	const hidden = [...stored.memberKeys]; Object.defineProperty(hidden, 'extra', { value: 'hidden' });
	for (const candidate of [withoutKeys, { ...stored, extra: true }, { ...stored, memberKeys: [...stored.memberKeys].reverse() },
		{ ...stored, memberKeys: ['catalog|photo-a'] }, { ...stored, memberKeys: ['catalog|photo-a', 'foreign|photo-b'] },
		{ ...stored, memberKeys: ['catalog|photo-a', 'catalog|photo-a'] }, { ...stored, memberKeys: sparse },
		{ ...stored, memberKeys: hidden }, Object.defineProperty({ ...stored }, 'memberKeys', { get() { accesses++; return []; } })]) {
		assert.throws(() => readPhotoStackRecordV1(candidate, 'catalog', 'catalog|stack'));
	}
	assert.equal(accesses, 0);
	assert.throws(() => readPhotoStackRecordV1(stored, 'foreign', 'catalog|stack'));
	assert.throws(() => readPhotoStackRecordV1(stored, 'catalog', 'catalog|other'));
});

test('maximum scoped identifiers fit the explicit512KiB private record bound with detached dense1024 keys', () => {
	const catalogId = 'c'.repeat(128), photoIds = Array.from({ length: 1024 }, (_, n) => `p${String(n).padStart(4, '0')}${'x'.repeat(123)}`);
	const input = { ...stack(photoIds), catalogId, id: 's'.repeat(128), revision: Number.MAX_SAFE_INTEGER };
	const stored = photoStackRecordV1(input), bytes = new TextEncoder().encode(JSON.stringify(stored)).byteLength;
	assert.equal(PHOTO_STACK_RECORD_LIMITS_V1.maximumBytes, 512 * 1024);
	assert.ok(bytes <= PHOTO_STACK_RECORD_LIMITS_V1.maximumBytes); assert.equal(stored.memberKeys.length, 1024);
	assert.deepEqual(readPhotoStackRecordV1(stored, catalogId, stored.key), stored.document);
	assert.throws(() => photoStackRecordV1({ ...input, photoIds: [...photoIds, 'overflow'] }));
});
