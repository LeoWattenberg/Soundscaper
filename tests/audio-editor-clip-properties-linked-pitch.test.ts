/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { clipLinkedPitchSpeed } from '../src/common/editor/ui/inspector/clip-properties-linked-pitch.ts';

test('linked pitch converts semitones or percent directly to speed over its full supported range', () => {
	assert.equal(clipLinkedPitchSpeed('24', 'semitones', 'Invalid linked pitch'), 4);
	assert.equal(clipLinkedPitchSpeed('-24', 'semitones', 'Invalid linked pitch'), 0.25);
	assert.equal(clipLinkedPitchSpeed('300', 'percent', 'Invalid linked pitch'), 4);
	assert.equal(clipLinkedPitchSpeed('0', 'percent', 'Invalid linked pitch'), 1);
	assert.equal(clipLinkedPitchSpeed('99900', 'percent', 'Invalid linked pitch'), 1000);
	assert.equal(clipLinkedPitchSpeed('-99.9', 'percent', 'Invalid linked pitch'), 0.001);
	assert.ok(Math.abs(clipLinkedPitchSpeed(12 * Math.log2(0.001), 'semitones', 'Invalid linked pitch') - 0.001) < 1e-12);
});

test('linked pitch rejects blank, non-finite and out-of-range speed values', () => {
	for (const value of ['', ' ', null, 'Infinity', 'NaN', 120, -120]) {
		assert.throws(() => clipLinkedPitchSpeed(value, 'semitones', 'Invalid linked pitch'), /Invalid linked pitch/u);
	}
	for (const value of [-100, -99.999, 100000]) {
		assert.throws(() => clipLinkedPitchSpeed(value, 'percent', 'Invalid linked pitch'), /Invalid linked pitch/u);
	}
});
