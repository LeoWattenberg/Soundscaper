/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	canonicalSourceCharacteristicsJson,
	sourceCharacteristicsCanonicallyEqual,
} from '../src/common/editor/source-characteristics-canonical-equivalence.ts';

test('source-characteristics equality is key-order independent and array-order sensitive', () => {
	const left = { videoCodec: 'h264', colour: { transfer: 'bt709', primaries: 'bt709' }, streams: [1, 2] };
	const reordered = { streams: [1, 2], colour: { primaries: 'bt709', transfer: 'bt709' }, videoCodec: 'h264' };
	assert.equal(sourceCharacteristicsCanonicallyEqual(left, reordered), true);
	assert.equal(sourceCharacteristicsCanonicallyEqual(left, { ...reordered, streams: [2, 1] }), false);
	assert.equal(canonicalSourceCharacteristicsJson(left), canonicalSourceCharacteristicsJson(reordered));
});
