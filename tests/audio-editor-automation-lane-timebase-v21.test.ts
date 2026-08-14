/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertConvertedPositionsOrderedV21,
	convertAutomationLanePositionV21,
} from '../src/common/editor/automation-lane-timebase-v21.ts';

const SAMPLE_RATE = 48_000;
const TEMPO_MAP = Object.freeze({
	mode: 'musical' as const,
	events: Object.freeze([Object.freeze({
		beat: Object.freeze({ num: 0, den: 1 }),
		bpm: Object.freeze({ num: 120, den: 1 }),
	})]),
});
const OPTIONS = { sampleRate: SAMPLE_RATE, tempoMap: TEMPO_MAP };

test('a timebase switch projects through the tempo map instead of copying the number', () => {
	// At 120 bpm over 48 kHz one beat is half a second, so frame 48000 is beat 2.
	// Reinterpreting the number would have made it beat 48000 and re-timed the lane.
	assert.deepEqual(
		convertAutomationLanePositionV21(48_000, 'absolute-samples', 'musical-beats', OPTIONS),
		{ num: 2, den: 1 },
	);
	assert.deepEqual(
		convertAutomationLanePositionV21(0, 'absolute-samples', 'musical-beats', OPTIONS),
		{ num: 0, den: 1 },
	);
	assert.equal(
		convertAutomationLanePositionV21({ num: 2, den: 1 }, 'musical-beats', 'absolute-samples', OPTIONS),
		48_000,
	);
	// A fractional beat is a real authored position and must survive the round trip.
	assert.equal(
		convertAutomationLanePositionV21({ num: 1, den: 2 }, 'musical-beats', 'absolute-samples', OPTIONS),
		12_000,
	);
	assert.deepEqual(
		convertAutomationLanePositionV21(12_000, 'absolute-samples', 'musical-beats', OPTIONS),
		{ num: 1, den: 2 },
	);
});

test('a conversion without an authoritative tempo map or a usable position is refused', () => {
	assert.throws(
		() => convertAutomationLanePositionV21(0, 'absolute-samples', 'musical-beats', { sampleRate: SAMPLE_RATE }),
		/tempo map/iu,
	);
	assert.throws(
		() => convertAutomationLanePositionV21(0, 'absolute-samples', 'absolute-samples', OPTIONS),
		/two timebases/iu,
	);
	assert.throws(
		() => convertAutomationLanePositionV21(-1, 'absolute-samples', 'musical-beats', OPTIONS),
		/non-negative/iu,
	);
	assert.throws(
		() => convertAutomationLanePositionV21(1.5, 'absolute-samples', 'musical-beats', OPTIONS),
		/non-negative safe integer/iu,
	);
});

test('a conversion that would collapse or reorder authored positions is refused', () => {
	assert.equal(assertConvertedPositionsOrderedV21([0, 1, 2]), true);
	assert.equal(assertConvertedPositionsOrderedV21([
		{ num: 0, den: 1 }, { num: 1, den: 2 }, { num: 1, den: 1 },
	]), true);
	// Two authored points landing on one frame would make the lane invalid, so the
	// switch refuses rather than committing a lane with duplicate positions.
	assert.throws(() => assertConvertedPositionsOrderedV21([5, 5]), /cannot express/iu);
	assert.throws(() => assertConvertedPositionsOrderedV21([2, 1]), /cannot express/iu);
});
