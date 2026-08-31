/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
	boundedString,
	deepFreeze,
	exactRecord,
	isRecord,
	nonNegativeInteger,
	positiveInteger,
	requireRecord,
} from '../scripts/lib/measurement-validation.mjs';

/** The two milestone-5A modules that used to carry their own copy of these rules. */
const M5_SOURCES = Object.freeze([
	'../scripts/lib/m5-native-helper-metrics.mjs',
	'../scripts/collect-m5-native-helper-quality.mjs',
]);

test('a record is own plain data, never an array, an instance, or a prototype', () => {
	assert.equal(isRecord({ measured: 1 }), true);
	assert.equal(isRecord(Object.create(null)), true);
	assert.equal(isRecord([]), false);
	assert.equal(isRecord(null), false);
	assert.equal(isRecord('measured'), false);
	assert.equal(isRecord(new (class Measurement {})()), false);

	const record = { measured: 1 };
	assert.equal(requireRecord(record, 'measurement'), record);
	assert.throws(() => requireRecord([], 'measurement'), /measurement must be a plain record\./u);
	assert.throws(() => requireRecord(null, 'measurement'), /measurement must be a plain record\./u);
});

test('an exact record accepts every named field and nothing else', () => {
	const fields = ['left', 'right'];
	const record = { left: 1, right: 2 };
	assert.equal(exactRecord(record, fields, 'measurement'), record);
	// Field order never changes the verdict; a sorted comparison is the rule.
	assert.equal(exactRecord({ right: 2, left: 1 }, fields, 'measurement').left, 1);
	assert.throws(
		() => exactRecord({ left: 1 }, fields, 'measurement'),
		/measurement must contain the exact fields\./u,
	);
	assert.throws(
		() => exactRecord({ left: 1, right: 2, extra: 3 }, fields, 'measurement'),
		/measurement must contain the exact fields\./u,
	);
	assert.throws(
		() => exactRecord({ left: 1, extra: 2 }, fields, 'measurement'),
		/measurement must contain the exact fields\./u,
	);
	assert.throws(() => exactRecord([], fields, 'measurement'), /must be a plain record\./u);
});

test('bounded strings and safe integers refuse the values that would flatter a host', () => {
	assert.equal(boundedString('lab', 1, 4, 'fingerprint'), 'lab');
	assert.throws(() => boundedString('', 1, 4, 'fingerprint'), /fingerprint must be a bounded string\./u);
	assert.throws(() => boundedString('laboratory', 1, 4, 'fingerprint'), /bounded string/u);
	assert.throws(() => boundedString(4, 1, 4, 'fingerprint'), /bounded string/u);

	assert.equal(positiveInteger(1, 'frames'), 1);
	for (const value of [0, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '2']) {
		assert.throws(
			() => positiveInteger(value, 'frames'),
			/frames must be a positive safe integer\./u,
			`${String(value)} must be refused`,
		);
	}

	assert.equal(nonNegativeInteger(0, 'underruns'), 0);
	for (const value of [-1, 0.5, Number.POSITIVE_INFINITY]) {
		assert.throws(
			() => nonNegativeInteger(value, 'underruns'),
			/underruns must be a non-negative safe integer\./u,
			`${String(value)} must be refused`,
		);
	}
});

test('a deep freeze reaches nested records and arrays, not just the root', () => {
	const frozen = deepFreeze({ runs: [{ samples: [1, 2] }] }) as {
		runs: Array<{ samples: number[] }>;
	};
	assert.equal(Object.isFrozen(frozen), true);
	assert.equal(Object.isFrozen(frozen.runs), true);
	assert.equal(Object.isFrozen(frozen.runs[0]), true);
	assert.equal(Object.isFrozen(frozen.runs[0]!.samples), true);
	assert.equal(deepFreeze(7), 7);
	assert.equal(deepFreeze(null), null);
});

test('the milestone-5A modules validate through the shared rules instead of private copies', async () => {
	for (const specifier of M5_SOURCES) {
		const source = await readFile(new URL(specifier, import.meta.url), 'utf8');
		assert.match(
			source,
			/from '\.(?:\/lib)?\/measurement-validation\.mjs'/u,
			`${specifier} must import the shared validation rules`,
		);
		for (const rule of [
			'isRecord', 'requireRecord', 'exactRecord', 'boundedString',
			'positiveInteger', 'nonNegativeInteger', 'deepFreeze',
		]) {
			assert.doesNotMatch(
				source,
				new RegExp(`function ${rule}\\(`, 'u'),
				`${specifier} must not redefine ${rule}`,
			);
		}
	}
});
