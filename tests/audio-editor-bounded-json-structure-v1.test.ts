/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	BOUNDED_MESSAGE_JSON_STRUCTURE_V1,
	BoundedJsonStructureError,
	assertBoundedJsonStructureV1,
} from '../src/common/editor/bounded-json-structure-v1.ts';

/**
 * The structural preflight is what makes "bounded before any parse or
 * allocation" true for every delivery boundary document, so each refusal
 * branch is pinned here rather than trusted through its callers.
 */

const TIGHT = Object.freeze({ maximumDepth: 3, maximumNodes: 16, maximumStringBytes: 64 });

function code(run: () => void): string {
	try { run(); } catch (error) {
		if (error instanceof BoundedJsonStructureError) return error.code;
		throw error;
	}
	return 'accepted';
}

test('plain bounded JSON is accepted under the default and tight budgets', () => {
	const value = { name: 'delivery', flags: [true, false, null], count: 3, nested: { ratio: 0.5 } };
	assert.doesNotThrow(() => assertBoundedJsonStructureV1(value));
	assert.doesNotThrow(() => assertBoundedJsonStructureV1(value, TIGHT));
	assert.equal(BOUNDED_MESSAGE_JSON_STRUCTURE_V1.maximumDepth, 48);
});

test('depth, node, and string budgets refuse as oversized during traversal', () => {
	let deep: unknown = 'leaf';
	for (let level = 0; level < 5; level += 1) deep = { deep };
	assert.equal(code(() => assertBoundedJsonStructureV1(deep, TIGHT)), 'oversized');
	assert.equal(
		code(() => assertBoundedJsonStructureV1(Array.from({ length: 17 }, () => 1), TIGHT)),
		'oversized',
	);
	assert.equal(code(() => assertBoundedJsonStructureV1('x'.repeat(65), TIGHT)), 'oversized');
	// Record keys count against the same string budget as values.
	assert.equal(
		code(() => assertBoundedJsonStructureV1({ ['k'.repeat(65)]: 1 }, TIGHT)),
		'oversized',
	);
});

test('a shared subtree is budgeted per visit, so DAG amplification stays bounded', () => {
	const shared = { a: 1, b: 2, c: 3 };
	const fanout = Array.from({ length: 8 }, () => shared);
	assert.equal(code(() => assertBoundedJsonStructureV1(fanout, TIGHT)), 'oversized');
});

test('non-JSON values are malformed: cycles, symbols, accessors, exotic objects', () => {
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	assert.equal(code(() => assertBoundedJsonStructureV1(cyclic)), 'malformed');

	assert.equal(code(() => assertBoundedJsonStructureV1({ value: Number.NaN })), 'malformed');
	assert.equal(
		code(() => assertBoundedJsonStructureV1({ value: Number.POSITIVE_INFINITY })),
		'malformed',
	);
	assert.equal(code(() => assertBoundedJsonStructureV1({ value: undefined })), 'malformed');
	assert.equal(code(() => assertBoundedJsonStructureV1({ value: 1n as never })), 'malformed');

	const symbolic = { [Symbol('hidden')]: 1, visible: 2 };
	assert.equal(code(() => assertBoundedJsonStructureV1(symbolic)), 'malformed');

	const accessor = Object.defineProperty({}, 'trap', { enumerable: true, get: () => 1 });
	assert.equal(code(() => assertBoundedJsonStructureV1(accessor)), 'malformed');

	assert.equal(code(() => assertBoundedJsonStructureV1(new Map() as never)), 'malformed');
	assert.equal(code(() => assertBoundedJsonStructureV1(new Date() as never)), 'malformed');
	class Row { field = 1; }
	assert.equal(code(() => assertBoundedJsonStructureV1(new Row() as never)), 'malformed');
});

test('arrays must be dense own data with no extra properties', () => {
	const sparse = [1];
	sparse.length = 3;
	assert.equal(code(() => assertBoundedJsonStructureV1(sparse)), 'malformed');

	const decorated: number[] & { extra?: number } = [1, 2, 3];
	decorated.extra = 4;
	assert.equal(code(() => assertBoundedJsonStructureV1(decorated)), 'malformed');

	const accessorArray = [1];
	Object.defineProperty(accessorArray, 0, { enumerable: true, get: () => 1 });
	assert.equal(code(() => assertBoundedJsonStructureV1(accessorArray)), 'malformed');
});

test('a parsed __proto__ key stays an inert own key and never pollutes', () => {
	const parsed = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
	assert.doesNotThrow(() => assertBoundedJsonStructureV1(parsed));
	assert.equal(({} as Record<string, unknown>).polluted, undefined);
	assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
});

test('invalid budgets refuse before any traversal', () => {
	for (const budget of [
		{ maximumDepth: -1, maximumNodes: 1, maximumStringBytes: 1 },
		{ maximumDepth: 1, maximumNodes: 0, maximumStringBytes: 1 },
		{ maximumDepth: 1, maximumNodes: 1, maximumStringBytes: 0 },
		{ maximumDepth: 1.5, maximumNodes: 1, maximumStringBytes: 1 },
	]) {
		assert.throws(() => assertBoundedJsonStructureV1(null, budget), TypeError);
	}
});
