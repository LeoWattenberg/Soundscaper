/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PHOTO_STACK_LIMITS_V1, normalizePhotoStackV1, normalizePhotoStackStateV1, serializePhotoStackV1 } from '../src/lightscaper/catalog/photo-stack-v1.ts';

function stack() {
	return { schemaVersion: 1, kind: 'photo-stack', catalogId: 'catalog', id: 'stack', revision: 0,
		photoIds: ['photo-c', 'photo-a', 'photo-b'], coverPhotoId: 'photo-a' };
}

test('stack normalization detaches and freezes ordered membership with deterministic round trips', () => {
	for (let size = 2; size <= 1024; size = Math.min(1024, size * 2 + 1)) {
		const input = { ...stack(), photoIds: Array.from({ length: size }, (_, index) => `photo-${String(size - index)}`), coverPhotoId: `photo-${String(size)}` };
		const normalized = normalizePhotoStackV1(input);
		assert.deepEqual(normalized.photoIds, input.photoIds);
		assert.notEqual(normalized.photoIds, input.photoIds);
		assert.ok(Object.isFrozen(normalized) && Object.isFrozen(normalized.photoIds));
		assert.deepEqual(normalizePhotoStackV1(JSON.parse(serializePhotoStackV1(normalized)) as unknown), normalized);
		input.photoIds[0] = 'changed';
		assert.equal(normalized.photoIds[0], `photo-${String(size)}`);
		if (size === 1024) break;
	}
	assert.equal(PHOTO_STACK_LIMITS_V1.maximumPhotos, 1024);
	assert.equal(PHOTO_STACK_LIMITS_V1.maximumDocumentBytes, 256 * 1024);
	assert.equal(PHOTO_STACK_LIMITS_V1.pageSize, 64);
});

test('maximal stable identifiers remain within the explicit serialized stack budget', () => {
	const photoIds = Array.from({ length: 1024 }, (_, index) => `${String(index).padStart(4, '0')}${'x'.repeat(124)}`);
	const input = { ...stack(), catalogId: 'c'.repeat(128), id: 's'.repeat(128), revision: Number.MAX_SAFE_INTEGER,
		photoIds, coverPhotoId: photoIds[1023] };
	assert.ok(new TextEncoder().encode(serializePhotoStackV1(input)).byteLength <= PHOTO_STACK_LIMITS_V1.maximumDocumentBytes);
});

test('closed versioned stack admission rejects duplicate, foreign, sparse and hostile inputs without running accessors', () => {
	let accesses = 0;
	const getter = Object.defineProperty(stack(), 'coverPhotoId', { get() { accesses += 1; throw new Error('accessed'); } });
	const hidden = Object.defineProperty(stack(), 'extra', { value: 1 });
	const symbol = Object.assign(stack(), { [Symbol('extra')]: 1 });
	const sparse = Array<string>(3); sparse[0] = 'photo-a'; sparse[2] = 'photo-c';
	const cyclic: unknown[] = ['photo-a']; cyclic.push(cyclic);
	for (const input of [getter, hidden, symbol, Object.assign(Object.create({ inherited: true }) as object, stack()),
		{ ...stack(), schemaVersion: 2 }, { ...stack(), kind: 'photo' }, { ...stack(), schemaFamily: 'lightscaper' },
		{ ...stack(), photoIds: ['photo-a'] }, { ...stack(), photoIds: ['photo-a', 'photo-a'] },
		{ ...stack(), photoIds: Array.from({ length: 1025 }, (_, index) => `p-${String(index)}`) },
		{ ...stack(), coverPhotoId: 'absent' }, { ...stack(), photoIds: sparse }, { ...stack(), photoIds: cyclic },
		{ ...stack(), revision: Number.MAX_SAFE_INTEGER + 1 }, { ...stack(), catalogId: 'foreign|catalog' }]) {
		assert.throws(() => normalizePhotoStackV1(input));
	}
	assert.equal(accesses, 0);
});

test('stack state persists an exact empty versioned counter and refuses future or malformed state', () => {
	const state = { schemaVersion: 1, kind: 'photo-stack-state', catalogId: 'catalog', revision: 7, stackCount: 0 };
	assert.deepEqual(normalizePhotoStackStateV1(state), state);
	assert.ok(Object.isFrozen(normalizePhotoStackStateV1(state)));
	for (const input of [{ ...state, schemaVersion: 2 }, { ...state, kind: 'photo-stack' }, { ...state, extra: 1 },
		{ ...state, revision: -1 }, { ...state, stackCount: 0.5 }, { ...state, stackCount: Infinity }]) {
		assert.throws(() => normalizePhotoStackStateV1(input));
	}
});
