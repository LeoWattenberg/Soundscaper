/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { audacityKnobPosition, audacityKnobValue } from '../src/common/editor/ui/audacity-knob-warp.ts';

test('Audacity warped effect knobs place their factory default at noon and retain endpoints', () => {
	for (const [minimum, middle, maximum] of [[0, 30, 200], [-60, -10, 0], [1, 10, 100], [0, 1, 1000]]) {
		assert.equal(audacityKnobPosition(minimum!, minimum!, maximum!, middle), 0);
		assert.equal(audacityKnobPosition(maximum!, minimum!, maximum!, middle), 1);
		assert.ok(Math.abs(audacityKnobPosition(middle!, minimum!, maximum!, middle) - 0.5) < 1e-12);
		assert.ok(Math.abs(audacityKnobValue(0.5, minimum!, maximum!, middle) - middle!) < 1e-10);
	}
});

test('Audacity exponential warp agrees with a known asymmetric three-quarter value', () => {
	// With range 0..100 and middle 20, exp(C)=16, so position 3/4 is value 140/3.
	assert.ok(Math.abs(audacityKnobValue(0.75, 0, 100, 20) - 140 / 3) < 1e-10);
	assert.ok(Math.abs(audacityKnobPosition(140 / 3, 0, 100, 20) - 0.75) < 1e-12);
});

test('Audacity knob warp round-trips both positive and negative parameter ranges', () => {
	for (const [minimum, middle, maximum] of [[0, 3, 200], [-60, -12, 0], [-30, 0, 30]]) {
		for (const position of [0, 0.01, 0.25, 0.5, 0.9, 1]) {
			const value = audacityKnobValue(position, minimum!, maximum!, middle);
			assert.ok(Math.abs(audacityKnobPosition(value, minimum!, maximum!, middle) - position) < 1e-10);
		}
	}
});

test('Audacity knob disables warping at a midpoint or endpoint default and clamps the range', () => {
	for (const middle of [undefined, 0, 50, 100, Number.NaN]) {
		assert.equal(audacityKnobPosition(25, 0, 100, middle), 0.25);
		assert.equal(audacityKnobValue(0.75, 0, 100, middle), 75);
	}
	assert.equal(audacityKnobPosition(-1, 0, 100, 20), 0);
	assert.equal(audacityKnobValue(2, 0, 100, 20), 100);
	assert.equal(audacityKnobPosition(1, 5, 5, 5), 0);
	assert.equal(audacityKnobValue(0.5, 5, 5, 5), 5);
});
