import assert from 'node:assert/strict';
import test from 'node:test';

import {
	groupParametricEqSections,
	normalizeParametricEqSampleRate,
} from '../src/common/editor/parametric-eq/authorities.js';

test('parametric EQ section grouping preserves contiguous band identity and source objects', () => {
	const firstA = { bandId: 'a', sectionIndex: 0 };
	const secondA = { bandId: 'a', sectionIndex: 1 };
	const b = { bandId: 'b', sectionIndex: 0 };
	const laterA = { bandId: 'a', sectionIndex: 2 };
	const groups = groupParametricEqSections([firstA, secondA, b, laterA]);
	assert.deepEqual(groups, [[firstA, secondA], [b], [laterA]]);
	assert.equal(groups[0][0], firstA);
	assert.equal(groups[0][1], secondA);
	assert.equal(groups[2][0], laterA);
	assert.deepEqual(groupParametricEqSections([]), []);
});

test('parametric EQ sample-rate authority preserves coercion, bounds, and error wording', () => {
	assert.equal(normalizeParametricEqSampleRate('48000'), 48_000);
	assert.equal(normalizeParametricEqSampleRate(8_000), 8_000);
	assert.equal(normalizeParametricEqSampleRate(768_000), 768_000);
	assert.equal(normalizeParametricEqSampleRate(44_100.5), 44_100.5);
	for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 7_999, 768_001]) {
		assert.throws(
			() => normalizeParametricEqSampleRate(value),
			(error) => error instanceof RangeError
				&& error.message === 'Parametric EQ sample rate must be between 8,000 and 768,000 Hz.',
		);
	}
});
