/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertConvertedPositionsOrderedV21,
	convertAutomationLaneControlPositionV21,
	convertAutomationLanePositionV21,
} from '../src/common/editor/automation-lane-timebase-v21.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';

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

test('a curve control converts into the shape a lane states in either timebase', () => {
	// A point is a bare sample frame on the sample timebase; a control is a
	// rational in both. Converting a control through the point rule wrote a bare
	// number, and the lane was refused later — at Apply, naming a field the
	// operator never edited.
	assert.deepEqual(
		convertAutomationLaneControlPositionV21(
			{ num: 1, den: 1 }, 'musical-beats', 'absolute-samples', OPTIONS,
		),
		{ num: 24_000, den: 1 },
	);
	assert.deepEqual(
		convertAutomationLaneControlPositionV21(
			{ num: 24_000, den: 1 }, 'absolute-samples', 'musical-beats', OPTIONS,
		),
		{ num: 1, den: 1 },
	);
	// A control between two samples has no exact beat, so it is refused rather
	// than rounded into the document.
	assert.throws(() => convertAutomationLaneControlPositionV21(
		{ num: 1, den: 2 }, 'absolute-samples', 'musical-beats', OPTIONS,
	), /between samples/iu);
});

test('a converted bezier lane is one the document accepts', () => {
	const musical = {
		id: 'lane', address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
		timebase: 'musical-beats' as const,
		points: [
			{ id: 'a', position: { num: 0, den: 1 }, value: 0 },
			{ id: 'b', position: { num: 4, den: 1 }, value: 1 },
		],
		segments: [{
			kind: 'bezier',
			control1: { position: { num: 1, den: 1 }, value: 0.25 },
			control2: { position: { num: 2, den: 1 }, value: 0.75 },
		}],
	};
	assert.ok(normalizeAutomationLaneV21(musical));

	const converted = {
		...musical,
		timebase: 'absolute-samples' as const,
		points: musical.points.map((point) => ({
			...point,
			position: convertAutomationLanePositionV21(
				point.position, 'musical-beats', 'absolute-samples', OPTIONS,
			),
		})),
		segments: musical.segments.map((segment) => ({
			...segment,
			control1: {
				...segment.control1,
				position: convertAutomationLaneControlPositionV21(
					segment.control1.position, 'musical-beats', 'absolute-samples', OPTIONS,
				),
			},
			control2: {
				...segment.control2,
				position: convertAutomationLaneControlPositionV21(
					segment.control2.position, 'musical-beats', 'absolute-samples', OPTIONS,
				),
			},
		})),
	};
	assert.ok(normalizeAutomationLaneV21(converted), 'the switched lane must still be a lane');
});
