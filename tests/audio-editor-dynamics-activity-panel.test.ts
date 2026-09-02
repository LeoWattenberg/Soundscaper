/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	appendActivityReading,
	formatDecibels,
	peakToDecibels,
	supportsDynamicsActivity,
} from '../src/common/editor/ui/DynamicsActivityPanel.jsx';

const READING = Object.freeze({
	sequence: 1,
	effectType: 'audacity-compressor',
	frames: 800,
	seconds: 800 / 48_000,
	inputPeak: 1,
	outputPeak: 0.5,
	reductionDb: -6,
});

test('only the dynamics effects that can describe themselves offer an activity panel', () => {
	assert.equal(supportsDynamicsActivity('audacity-compressor'), true);
	assert.equal(supportsDynamicsActivity('audacity-limiter'), true);
	assert.equal(supportsDynamicsActivity('compressor'), true);
	assert.equal(supportsDynamicsActivity('audacity-reverb'), false);
	assert.equal(supportsDynamicsActivity(null), false);
});

test('peaks convert to decibels and silence rests on the floor', () => {
	assert.ok(Math.abs(peakToDecibels(1)) < 1e-9);
	assert.ok(Math.abs(peakToDecibels(0.5) + 6.0206) < 1e-3);
	assert.equal(peakToDecibels(0), -60);
	assert.equal(peakToDecibels(-1), -60);
	assert.equal(peakToDecibels(Number.NaN), -60);
});

test('the trail keeps its newest samples and never exceeds its capacity', () => {
	let trail: unknown[] = [];
	for (let index = 0; index < 10; index += 1) {
		trail = appendActivityReading(trail, { ...READING, sequence: index + 1, reductionDb: -index }, 4);
	}
	assert.equal(trail.length, 4);
	assert.deepEqual(
		trail.map((sample) => (sample as { reductionDb: number }).reductionDb),
		[-6, -7, -8, -9],
	);
});

test('the trail clamps reduction to the range it can draw and ignores a missing reading', () => {
	const clamped = appendActivityReading([], { ...READING, reductionDb: -90 }, 4) as Array<{ reductionDb: number }>;
	assert.equal(clamped[0]?.reductionDb, -24);
	// Makeup gain can lift the output above the input, but the curve never adds
	// gain of its own, so a positive reduction is not a thing to draw.
	const positive = appendActivityReading([], { ...READING, reductionDb: 3 }, 4) as Array<{ reductionDb: number }>;
	assert.equal(positive[0]?.reductionDb, 0);
	const empty: unknown[] = [];
	assert.strictEqual(appendActivityReading(empty, null, 4), empty);
});

test('readouts show a level, an unmeasured dash, and true silence', () => {
	assert.equal(formatDecibels(-6.02), '-6.0 dB');
	assert.equal(formatDecibels(0), '0.0 dB');
	assert.equal(formatDecibels(null), '—');
	assert.equal(formatDecibels(Number.NaN), '—');
	assert.equal(formatDecibels(-60), '−∞ dB');
});
