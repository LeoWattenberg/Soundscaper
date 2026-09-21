/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	applyAudacityLookaheadEnvelopeInPlace,
	audacityDynamicsLookaheadFrames,
} from '../src/common/editor/audacity-effects/audacity-dynamics-lookahead.ts';
import {
	audacityShelfCoefficients,
	processAudacityShelfSample,
} from '../src/common/editor/audacity-effects/audacity-bass-treble-kernel.ts';
import { removeAudacityClicksFromWindowInPlace } from '../src/common/editor/audacity-effects/audacity-click-removal-kernel.ts';

test('Audacity dynamics lookahead uses truncating frame geometry and respects the active extent', () => {
	assert.equal(audacityDynamicsLookaheadFrames(10, 44_100), 441);
	assert.equal(audacityDynamicsLookaheadFrames(0.1, 44_100), 4);
	const envelope = Float64Array.of(0, 0, -12, 1234);
	applyAudacityLookaheadEnvelopeInPlace(envelope, 2, 3);
	assert.deepEqual(envelope, Float64Array.of(0, -6, -12, 1234));
});

test('Audacity shelf kernel retains its float-rounded Direct Form I state', () => {
	const coefficients = audacityShelfCoefficients(250, Math.fround(0.4), 12, 48_000, false);
	const state = [0, 0, 0, 0];
	const impulse = [1, 0, 0, 0].map((sample) => processAudacityShelfSample(sample, coefficients, state));
	assert.deepEqual(impulse, [
		1.0272740125656128,
		0.05383872985839844,
		0.05244459584355354,
		0.05109839141368866,
	]);
});

test('Audacity shelf kernel covers the direct high-shelf coefficient branch', () => {
	const coefficients = audacityShelfCoefficients(4_000, Math.fround(0.4), 12, 48_000, true);
	const state = [0, 0, 0, 0];
	const impulse = [1, 0, 0, 0].map((sample) => processAudacityShelfSample(sample, coefficients, state));
	assert.deepEqual(impulse, [
		2.894218683242798,
		-1.3248103857040405,
		-0.3116705119609833,
		-0.10791460424661636,
	]);
});

test('Audacity click removal preserves its first-window center offset and returns the rounded separation', () => {
	const samples = new Float32Array(8_192).fill(0.01);
	samples[4_500] = 1;
	samples[4_501] = -0.8;
	assert.equal(removeAudacityClicksFromWindowInPlace(samples, 200, 20, 2_049), 4_096);
	assert.ok(Math.abs(samples[4_500]! - 0.01) < 1e-6);
	assert.ok(Math.abs(samples[4_501]! - 0.01) < 1e-6);
	assert.equal(removeAudacityClicksFromWindowInPlace(samples, 200, 20, 4_096), 4_096);
});
