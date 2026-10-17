/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { readClosedDomainArray } from '../src/common/editor/closed-domain-value.ts';

test('dense plain arrays keep their shallow frozen snapshot and exact inclusive bounds', () => {
	const payload = { id: 'retained' }, input = [payload, 'second'];
	const result = readClosedDomainArray(input, 'terms', 2, 2);
	assert.deepEqual(result, input); assert.notEqual(result, input); assert.ok(Object.isFrozen(result));
	assert.equal(result[0], payload);
	input[0] = 'changed'; input.push('third'); assert.deepEqual(result, [payload, 'second']);
	assert.deepEqual(readClosedDomainArray([], 'terms', 0, 0), []);
	assert.throws(() => readClosedDomainArray([], 'terms', 1, 2), RangeError);
	assert.throws(() => readClosedDomainArray([1, 2, 3], 'terms', 1, 2), RangeError);
});

test('dense native-array Proxy snapshots use no caller property get trap', () => {
	let gets = 0;
	const input = new Proxy(['first', 'second'], { get() { gets++; throw new Error('Do not read a caller property.'); } });
	assert.deepEqual(readClosedDomainArray(input, 'terms', 1, 2), ['first', 'second']);
	assert.equal(gets, 0);
});

test('array length is captured once from its own data descriptor for all subsequent checks', () => {
	let lengths = 0, gets = 0;
	const input = new Proxy(['first', 'second'], {
		get() { gets++; throw new Error('Do not read a caller property.'); },
		getOwnPropertyDescriptor(target, key) {
			if (key === 'length') lengths++;
			return Reflect.getOwnPropertyDescriptor(target, key);
		},
	});
	assert.deepEqual(readClosedDomainArray(input, 'terms', 2, 2), ['first', 'second']);
	assert.equal(lengths, 1); assert.equal(gets, 0);
});

test('malformed reflected lengths are refused before any entry read or property getter', () => {
	for (const length of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '1']) {
		let entries = 0, gets = 0;
		const input = new Proxy([], {
			get() { gets++; throw new Error('Do not read a caller property.'); },
			getOwnPropertyDescriptor(target, key) {
				if (key === 'length') return { value: length, writable: true, configurable: false, enumerable: false };
				entries++; return Reflect.getOwnPropertyDescriptor(target, key);
			},
		});
		assert.throws(() => readClosedDomainArray(input, 'terms', 0, 2), /length|bounded|integer/iu);
		assert.equal(entries, 0); assert.equal(gets, 0);
	}
});

test('dense admission preserves sparse, accessor and nonenumerable entry refusal without getter invocation', () => {
	let calls = 0;
	const sparse: unknown[] = []; sparse.length = 2; sparse[1] = 'second';
	const accessor = Object.defineProperty(['first'], '0', { enumerable: true, get() { calls++; return 'first'; } });
	const hidden = Object.defineProperty(['first'], '0', { enumerable: false, value: 'first' });
	for (const input of [sparse, accessor, hidden]) assert.throws(() => readClosedDomainArray(input, 'terms', 1, 2), TypeError);
	assert.equal(calls, 0);
});

test('unsupported array fields and non-array substitutes stay refused', () => {
	for (const key of ['extra', '-1', '01', Symbol('hidden')]) {
		const input = Object.defineProperty(['first'], key, { value: 'extra', enumerable: false });
		assert.throws(() => readClosedDomainArray(input, 'terms', 1, 2), /unsupported/iu);
	}
	for (const input of [{ 0: 'first', length: 1 }, 'first', null, new Set(['first']), new Uint8Array([1])]) {
		assert.throws(() => readClosedDomainArray(input, 'terms', 0, 2), TypeError);
	}
});

test('array prototype policy stays unchanged and inherited getters remain outside dense entry authority', () => {
	let calls = 0;
	const inherited = Object.defineProperty(Object.create(Array.prototype) as object, '0', {
		get() { calls++; return 'inherited'; },
	});
	const dense = Object.setPrototypeOf(['own'], inherited) as unknown;
	assert.deepEqual(readClosedDomainArray(dense, 'terms', 1, 1), ['own']);
	const sparse: unknown[] = []; sparse.length = 1; Object.setPrototypeOf(sparse, inherited);
	assert.throws(() => readClosedDomainArray(sparse, 'terms', 1, 1), TypeError);
	assert.equal(calls, 0);
});
