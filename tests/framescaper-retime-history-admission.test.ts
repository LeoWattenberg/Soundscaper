/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_RETIME_HISTORY_MAXIMUM_TRAVERSAL_DEPTH,
	FRAMESCAPER_RETIME_HISTORY_MAXIMUM_TRAVERSAL_NODES,
	admitFramescaperProjectHistoryRetimeStructure as admit,
} from '../src/framescaper/editor-project-retime-history-admission.ts';

function chain(depth: number): Record<string, unknown> {
	const root: Record<string, unknown> = {};
	let cursor = root;
	for (let index = 0; index < depth; index += 1) {
		const next: Record<string, unknown> = {};
		cursor.next = next;
		cursor = next;
	}
	return root;
}

test('ordinary JSON-compatible history structures are admitted', () => {
	assert.doesNotThrow(() => admit({ entries: [{ id: 'a', at: 1, ok: true, note: null }] }));
	assert.doesNotThrow(() => admit(null));
	assert.doesNotThrow(() => admit('a bare string'));
	assert.doesNotThrow(() => admit({ empty: [] }));
});

test('binary history payloads are limited to Uint8Array and ArrayBuffer', () => {
	assert.doesNotThrow(() => admit({ body: new Uint8Array([1, 2, 3]) }));
	assert.doesNotThrow(() => admit({ body: new ArrayBuffer(4) }));
	assert.throws(() => admit({ body: new Float32Array(2) }), TypeError);
	assert.throws(() => admit({ body: new DataView(new ArrayBuffer(4)) }), TypeError);
});

test('values that cannot survive a JSON round trip are refused', () => {
	for (const value of [
		{ a: Number.NaN },
		{ a: Number.POSITIVE_INFINITY },
		{ a: undefined },
		{ a: () => 1 },
		{ a: 1n },
	]) {
		assert.throws(() => admit(value), TypeError);
	}
});

test('only ordinary plain objects and arrays carry history state', () => {
	assert.doesNotThrow(() => admit({ a: Object.create(null) as object }));
	assert.throws(() => admit({ a: new Date(0) }), TypeError);
	assert.throws(() => admit({ a: new Map() }), TypeError);
	assert.throws(() => admit({ a: new (class Holder { readonly v = 1; })() }), TypeError);
	assert.throws(
		() => admit({ a: Object.setPrototypeOf([1], Object.create(Array.prototype) as object) }),
		TypeError,
	);
});

test('an array carrying a named property is refused', () => {
	const values: unknown[] = [1];
	(values as unknown as Record<string, unknown>).tag = 'extra';

	assert.throws(() => admit({ values }), TypeError);
});

test('symbol keys and accessor or non-enumerable properties are refused', () => {
	assert.throws(() => admit({ [Symbol('marker')]: 1 }), TypeError);
	assert.throws(
		() => admit(Object.defineProperty({}, 'derived', { get: () => 1, enumerable: true })),
		TypeError,
	);
	assert.throws(
		() => admit(Object.defineProperty({}, 'hidden', { value: 1, enumerable: false })),
		TypeError,
	);
});

test('a cyclic history is refused while a repeated sibling reference is admitted', () => {
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	assert.throws(() => admit(cyclic), TypeError);

	const shared = { id: 'shared' };
	assert.doesNotThrow(
		() => admit({ left: shared, right: shared }),
		'only an ancestor repeat is a cycle; a shared sibling reference is ordinary',
	);
});

test('the traversal depth bound is enforced at its documented limit', () => {
	assert.doesNotThrow(() => admit(chain(FRAMESCAPER_RETIME_HISTORY_MAXIMUM_TRAVERSAL_DEPTH - 1)));
	assert.throws(
		() => admit(chain(FRAMESCAPER_RETIME_HISTORY_MAXIMUM_TRAVERSAL_DEPTH + 1)),
		RangeError,
	);
});

test('the aggregate node bound is enforced at its documented limit', () => {
	assert.throws(
		() => admit(Array.from({ length: FRAMESCAPER_RETIME_HISTORY_MAXIMUM_TRAVERSAL_NODES + 1 }, () => 1)),
		RangeError,
	);
});
