/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { deepFreeze } from '../scripts/lib/deep-freeze.ts';

void test('tooling deep freeze preserves identity and recursively freezes object values', () => {
	const value = { rows: [{ count: 1 }], nullable: null };
	assert.equal(deepFreeze(value), value);
	assert.ok(Object.isFrozen(value));
	assert.ok(Object.isFrozen(value.rows));
	assert.ok(Object.isFrozen(value.rows[0]));
	assert.throws(() => { value.rows.push({ count: 2 }); }, TypeError);
});

void test('tooling deep freeze leaves primitives, functions, and already-frozen parents alone', () => {
	for (const value of [null, undefined, false, 0, '', Symbol('value')]) {
		assert.equal(deepFreeze(value), value);
	}
	const callback = () => undefined;
	assert.equal(deepFreeze(callback), callback);
	assert.equal(Object.isFrozen(callback), false);
	const child = { count: 1 };
	const parent = Object.freeze({ child });
	assert.equal(deepFreeze(parent), parent);
	assert.equal(Object.isFrozen(child), false);
});
