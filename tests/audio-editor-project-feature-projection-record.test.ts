/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	arrayValue,
	canonicalString,
	dataProperty,
	isRecord,
	optionalDataProperty,
	positiveSafeInteger,
	recordValue,
	replaceDataProperties,
} from '../src/common/editor/project-feature-projection-record.ts';
import {
	projectFeatureBoundedString,
	projectFeatureLowerOnlyLimit,
} from '../src/common/editor/project-feature-projection-limits.ts';

test('project feature projection records admit only the shared scalar and collection shapes', () => {
	assert.equal(positiveSafeInteger(4, 'Count'), 4);
	assert.equal(canonicalString('stable-id', 'ID'), 'stable-id');
	assert.deepEqual(arrayValue(Object.freeze([1, 2]), 'Values'), [1, 2]);
	assert.equal(isRecord(Object.create(null)), true);
	assert.equal(isRecord([]), false);
	assert.equal(recordValue(Object.freeze({ id: 'a' }), 'Value').id, 'a');

	assert.throws(() => positiveSafeInteger(0, 'Count'), /Count must be a positive safe integer/);
	assert.throws(() => canonicalString(' padded ', 'ID'), /ID must be a non-empty canonical string/);
	assert.throws(() => arrayValue({}, 'Values'), /Values must be an array/);
	assert.throws(() => recordValue(null, 'Value'), /Value must be an object/);
});

test('project feature projection property reads never invoke accessors', () => {
	let getterCalls = 0;
	const value = Object.defineProperties({}, {
		present: { configurable: true, enumerable: true, writable: false, value: 42 },
		computed: {
			configurable: true,
			enumerable: true,
			get() { getterCalls += 1; return 7; },
		},
	});

	assert.equal(dataProperty(value, 'present', 'value'), 42);
	assert.equal(optionalDataProperty(value, 'missing', 'value'), undefined);
	assert.throws(() => dataProperty(value, 'missing', 'value'), /value\.missing must be an own data property/);
	assert.throws(() => dataProperty(value, 'computed', 'value'), /value\.computed must be an own data property/);
	assert.throws(() => optionalDataProperty(value, 'computed', 'value'), /value\.computed must be a data property/);
	assert.equal(getterCalls, 0);
});

test('project feature projection replacement preserves prototype and untouched descriptors', () => {
	const prototype = Object.freeze({ inherited: true });
	const original = Object.create(prototype) as Record<string, unknown>;
	Object.defineProperties(original, {
		retained: { configurable: false, enumerable: false, writable: false, value: 'original' },
		replaced: { configurable: true, enumerable: false, writable: false, value: 'before' },
	});

	const projected = replaceDataProperties(original, { replaced: 'after', added: 3 });

	assert.notStrictEqual(projected, original);
	assert.strictEqual(Object.getPrototypeOf(projected), prototype);
	assert.equal(Object.isFrozen(projected), true);
	assert.equal(projected.retained, 'original');
	assert.equal(projected.replaced, 'after');
	assert.equal(projected.added, 3);
	assert.deepEqual(Object.getOwnPropertyDescriptor(projected, 'retained'), {
		configurable: false,
		enumerable: false,
		writable: false,
		value: 'original',
	});
	assert.equal(Object.getOwnPropertyDescriptor(projected, 'replaced')?.enumerable, true);
	assert.equal(original.replaced, 'before');
});

test('project feature projection limits preserve bounded-string and lower-only admission', () => {
	assert.equal(projectFeatureBoundedString('stable', 'Value', 6), 'stable');
	assert.equal(projectFeatureLowerOnlyLimit(undefined, 8, 'maximum'), 8);
	assert.equal(projectFeatureLowerOnlyLimit(0, 8, 'maximum'), 0);
	assert.equal(projectFeatureLowerOnlyLimit(7, 8, 'maximum'), 7);

	assert.throws(
		() => projectFeatureBoundedString('', 'Value', 6),
		/Value must be a non-empty bounded string/u,
	);
	assert.throws(
		() => projectFeatureBoundedString('toolong', 'Value', 6),
		/Value must be a non-empty bounded string/u,
	);
	assert.throws(
		() => projectFeatureLowerOnlyLimit(-1, 8, 'maximum'),
		/maximum must be a non-negative safe integer/u,
	);
	assert.throws(
		() => projectFeatureLowerOnlyLimit(9, 8, 'maximum'),
		/maximum cannot raise the production limit/u,
	);
});
