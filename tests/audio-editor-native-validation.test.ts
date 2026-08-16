/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createNativeValidators,
	NATIVE_SHA256_HEX_PATTERN,
} from '../src/common/editor/native-validation.ts';

class SubjectError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SubjectError';
	}
}

const validators = createNativeValidators({
	subject: 'A native subject',
	raise: (message: string): never => {
		throw new SubjectError(message);
	},
});

const articled = createNativeValidators({
	subject: 'An OFX subject',
	article: 'An',
	raise: (message: string): never => {
		throw new SubjectError(message);
	},
});

const prototypeChecked = createNativeValidators({
	subject: 'A strict subject',
	requirePlainPrototype: true,
	raise: (message: string): never => {
		throw new SubjectError(message);
	},
});

test('the shared rules raise the caller\'s own error class, never a substitute', () => {
	class OtherError extends Error {}
	const other = createNativeValidators({
		subject: 'Another subject',
		raise: (message: string): never => {
			throw new OtherError(message);
		},
	});
	assert.throws(() => validators.nonNegativeInteger(-1, 'count'), SubjectError);
	assert.throws(() => other.nonNegativeInteger(-1, 'count'), OtherError);
	assert.throws(() => other.nonNegativeInteger(-1, 'count'), (error: unknown) => (
		!(error instanceof SubjectError)
	));
});

test('a non-negative integer refuses everything that is not a non-negative safe integer', () => {
	assert.equal(validators.nonNegativeInteger(0, 'count'), 0);
	assert.equal(validators.nonNegativeInteger(7, 'count'), 7);
	assert.equal(validators.nonNegativeInteger(Number.MAX_SAFE_INTEGER, 'count'), Number.MAX_SAFE_INTEGER);
	for (const candidate of [
		-1, -0.5, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1,
		'3', null, undefined, 3n, [3], { valueOf: () => 3 },
	]) {
		assert.throws(
			() => validators.nonNegativeInteger(candidate, 'count'),
			{ message: 'A native subject count must be a non-negative safe integer.' },
			`admitted ${String(candidate)}`,
		);
	}
});

test('negative zero is a non-negative integer, and the message names the subject and label', () => {
	assert.equal(validators.nonNegativeInteger(-0, 'count'), -0);
	assert.throws(() => articled.nonNegativeInteger(-1, 'frame'), {
		message: 'An OFX subject frame must be a non-negative safe integer.',
	});
});

test('a pattern check refuses non-strings as firmly as it refuses non-matches', () => {
	const expression = /^[a-z]{3}$/u;
	assert.equal(validators.pattern('abc', expression, 'name'), 'abc');
	for (const candidate of ['ABC', 'abcd', '', 3, null, undefined, ['abc'], { toString: () => 'abc' }]) {
		assert.throws(
			() => validators.pattern(candidate, expression, 'name'),
			{ message: 'A native subject name is not in its canonical form.' },
			`admitted ${String(candidate)}`,
		);
	}
});

test('a digest is exactly sixty-four lowercase hexadecimal characters', () => {
	const digest = 'a1'.repeat(32);
	assert.equal(validators.digest(digest, 'sha256'), digest);
	assert.match(digest, NATIVE_SHA256_HEX_PATTERN);
	for (const candidate of [
		'A1'.repeat(32), digest.toUpperCase(), `${digest}0`, digest.slice(0, 63),
		'g'.repeat(64), '', ` ${digest.slice(1)}`, `0x${digest.slice(2)}`,
	]) {
		assert.throws(
			() => validators.digest(candidate, 'sha256'),
			{ message: 'A native subject sha256 is not in its canonical form.' },
			`admitted ${candidate}`,
		);
	}
});

test('a plain record refuses null, arrays, and primitives', () => {
	const value = { key: 1 };
	assert.equal(validators.plainRecord(value, 'native subject'), value);
	const bare = Object.create(null) as object;
	assert.equal(validators.plainRecord(bare, 'native subject'), bare);
	for (const candidate of [null, undefined, [], [1], 'record', 3, true]) {
		assert.throws(
			() => validators.plainRecord(candidate, 'native subject'),
			{ message: 'A native subject must be a plain record.' },
			`admitted ${String(candidate)}`,
		);
	}
	assert.throws(() => articled.plainRecord(null, 'OFX subject'), {
		message: 'An OFX subject must be a plain record.',
	});
});

test('the prototype rule is opt-in, so no caller is silently tightened', () => {
	class Carrier {
		readonly key = 1;
	}
	const instance = new Carrier();
	assert.equal(validators.plainRecord(instance, 'native subject'), instance);
	assert.throws(
		() => prototypeChecked.plainRecord(instance, 'strict subject'),
		{ message: 'A strict subject must be a plain record.' },
	);
	assert.throws(
		() => prototypeChecked.plainRecord(Object.create({ inherited: 1 }) as object, 'strict subject'),
		{ message: 'A strict subject must be a plain record.' },
	);
	const bare = Object.create(null) as object;
	assert.equal(prototypeChecked.plainRecord(bare, 'strict subject'), bare);
});

test('exact keys refuses an extra key, a missing key, and a renamed key', () => {
	const keys = ['alpha', 'beta'];
	validators.exactKeys({ alpha: 1, beta: 2 }, keys, 'native subject');
	for (const candidate of [
		{ alpha: 1 },
		{ alpha: 1, beta: 2, gamma: 3 },
		{ alpha: 1, gamma: 2 },
		{},
	]) {
		assert.throws(
			() => validators.exactKeys(candidate, keys, 'native subject'),
			{ message: 'A native subject must carry exactly its schema keys.' },
			`admitted ${JSON.stringify(candidate)}`,
		);
	}
});

test('exact keys is order-insensitive and counts keys rather than trusting names alone', () => {
	validators.exactKeys({ beta: 2, alpha: 1 }, ['alpha', 'beta'], 'native subject');
	assert.throws(
		() => validators.exactKeys({ alpha: 1, beta: 2 }, ['alpha', 'beta', 'gamma'], 'native subject'),
		{ message: 'A native subject must carry exactly its schema keys.' },
	);
	assert.throws(() => articled.exactKeys({}, ['alpha'], 'OFX subject'), {
		message: 'An OFX subject must carry exactly its schema keys.',
	});
});
