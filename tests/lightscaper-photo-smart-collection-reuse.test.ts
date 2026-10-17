/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { admitPhotoSmartCollectionSaveV1 } from '../src/lightscaper/catalog/photo-smart-collection-repository-types-v1.ts';
import { normalizePhotoSmartCollectionV1 } from '../src/lightscaper/catalog/photo-smart-collection-v1.ts';

function definition() {
	return { schemaVersion: 1, kind: 'photo-smart-collection', catalogId: 'catalog', id: 'saved', revision: 0, name: 'Saved',
		query: { schemaVersion: 2, kind: 'photo-catalog-query', text: 'Canon', predicate: { kind: 'all', terms: [
			{ kind: 'text', column: 'camera-make', operator: 'equals', value: 'Canon' }, { kind: 'keyword', id: 'keyword' },
		] } } };
}

test('a successfully admitted definition is reused by identity including its full immutable Query2 graph', () => {
	const input = definition(), admitted = admitPhotoSmartCollectionSaveV1(input, null);
	assert.notEqual(admitted, input); assert.equal(admitPhotoSmartCollectionSaveV1(admitted, null), admitted);
	assert.equal(admitPhotoSmartCollectionSaveV1(admitted, 0), admitted); assert.equal(Object.isFrozen(admitted.query), true);
	const predicate = admitted.query.predicate!;
	assert.equal(Object.isFrozen(predicate), true);
	if (predicate.kind !== 'all') assert.fail('Expected group');
	assert.equal(Object.isFrozen(predicate.terms), true); assert.equal(Object.isFrozen(predicate.terms[0]), true);
	input.name = 'Changed'; input.query.text = 'Changed'; input.query.predicate.terms[0]!.value = 'Changed';
	assert.equal(admitted.name, 'Saved'); assert.equal(admitted.query.text, 'canon');
	assert.equal(admitPhotoSmartCollectionSaveV1(admitted, 0).query, admitted.query);
});

test('even exact admitted identities must pass each supplied expected-revision check', () => {
	const admitted = admitPhotoSmartCollectionSaveV1(definition(), null);
	for (const expected of [1, 17, Number.MAX_SAFE_INTEGER, undefined, NaN, Infinity, -1, {}, '0']) {
		assert.throws(() => admitPhotoSmartCollectionSaveV1(admitted, expected), RangeError);
	}
	assert.equal(admitPhotoSmartCollectionSaveV1(admitted, -0), admitted);
	const high = admitPhotoSmartCollectionSaveV1({ ...definition(), revision: Number.MAX_SAFE_INTEGER }, Number.MAX_SAFE_INTEGER);
	assert.equal(admitPhotoSmartCollectionSaveV1(high, Number.MAX_SAFE_INTEGER), high);
	assert.throws(() => admitPhotoSmartCollectionSaveV1(high, null), /revision/iu);
	assert.throws(() => admitPhotoSmartCollectionSaveV1(high, 0), /revision/iu);
});

test('model-normalized, frozen, copied, structured-cloned and proxied inputs fully normalize instead of borrowing a forged identity', () => {
	const admitted = admitPhotoSmartCollectionSaveV1(definition(), null), normalized = normalizePhotoSmartCollectionV1(admitted);
	assert.notEqual(normalized, admitted); assert.notEqual(normalized.query, admitted.query);
	for (const input of [normalized, Object.freeze({ ...admitted }), { ...admitted }, structuredClone(admitted),
		JSON.parse(JSON.stringify(admitted)) as unknown, new Proxy(admitted, {})]) {
		const next = admitPhotoSmartCollectionSaveV1(input, 0);
		assert.notEqual(next, input); assert.deepEqual(next, admitted); assert.equal(admitPhotoSmartCollectionSaveV1(next, 0), next);
	}
	let getters = 0;
	const accessor = Object.freeze(Object.defineProperty({ ...admitted }, 'revision', { enumerable: true, get() { getters++; return 0; } }));
	assert.throws(() => admitPhotoSmartCollectionSaveV1(accessor, 0), TypeError); assert.equal(getters, 0);
	assert.throws(() => admitPhotoSmartCollectionSaveV1({ ...admitted, [Symbol('brand')]: true }, 0), TypeError);
	const revoked = Proxy.revocable(admitted, {}); revoked.revoke(); assert.throws(() => admitPhotoSmartCollectionSaveV1(revoked.proxy, 0), TypeError);
});

test('maximum escaped Query2 remains one retained candidate across both admissions', () => {
	const input = { ...definition(), query: { ...definition().query, predicate: { kind: 'all', terms: Array.from({ length: 255 },
		() => ({ kind: 'text', column: 'camera-model', operator: 'starts-with', value: '\ud800'.repeat(256) })) } } };
	const admitted = admitPhotoSmartCollectionSaveV1(input, null);
	assert.ok(new TextEncoder().encode(JSON.stringify(admitted)).byteLength > 400_000);
	const reused = admitPhotoSmartCollectionSaveV1(admitted, 0);
	assert.equal(reused, admitted); assert.equal(reused.query.predicate, admitted.query.predicate);
});
