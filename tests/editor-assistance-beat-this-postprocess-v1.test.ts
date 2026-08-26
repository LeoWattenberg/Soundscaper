/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceBeatThisGridV1,
} from '../src/common/editor/assistance/beat-this-postprocess-v1.ts';

function logits(length: number, peaks: readonly Readonly<{ frame: number; value: number }>[]) {
	const result = new Float32Array(length);
	result.fill(-10);
	for (const peak of peaks) result[peak.frame] = peak.value;
	return result;
}

function request(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		schemaVersion: 1,
		sampleRate: 22_050,
		framesPerSecond: 50,
		beatLogits: logits(32, [
			{ frame: 2, value: 2 }, { frame: 3, value: 2 },
			{ frame: 27, value: 3 }, { frame: 28, value: 3 },
		]),
		downbeatLogits: logits(32, [{ frame: 3, value: 4 }]),
		...overrides,
	};
}

test('Beat This minimal postprocessing peak-picks, deduplicates, and snaps downbeats', () => {
	assert.deepEqual(createAssistanceBeatThisGridV1(request()), {
		schemaVersion: 1,
		sampleRate: 22_050,
		points: [
			{ sample: 1_103, kind: 'downbeat', confidence: null },
			{ sample: 12_128, kind: 'beat', confidence: null },
		],
		tempoProposal: { kind: 'constant', bpm: 120 },
	});
});

test('Beat This uses a strict positive-logit threshold and seven-frame local maximum', () => {
	const result = createAssistanceBeatThisGridV1(request({
		beatLogits: logits(12, [
			{ frame: 1, value: 0 }, { frame: 4, value: 2 }, { frame: 6, value: 1 },
			{ frame: 10, value: 2 },
		]),
		downbeatLogits: logits(12, []),
	}));
	assert.deepEqual(result.points.map(({ sample }) => sample), [1_764, 4_410]);
	assert.equal(result.tempoProposal, null);
});

test('Beat This keeps an isolated downbeat and no-beat input is a valid empty grid', () => {
	const downbeat = createAssistanceBeatThisGridV1(request({
		beatLogits: logits(8, []),
		downbeatLogits: logits(8, [{ frame: 4, value: 1 }]),
	}));
	assert.deepEqual(downbeat.points, [
		{ sample: 1_764, kind: 'downbeat', confidence: null },
	]);
	assert.equal(downbeat.tempoProposal, null);
	const empty = createAssistanceBeatThisGridV1(request({
		beatLogits: logits(8, []), downbeatLogits: logits(8, []),
	}));
	assert.deepEqual(empty.points, []);
});

test('Beat This postprocessing refuses malformed logits and non-baseline geometry', () => {
	assert.throws(() => createAssistanceBeatThisGridV1(request({
		beatLogits: Float32Array.of(Number.NaN, ...logits(31, [])),
	})), /finite|logit/iu);
	assert.throws(() => createAssistanceBeatThisGridV1(request({
		downbeatLogits: logits(31, []),
	})), /length|geometry/iu);
	assert.throws(() => createAssistanceBeatThisGridV1(request({ framesPerSecond: 100 })),
		/50/iu);
	assert.throws(() => createAssistanceBeatThisGridV1({ ...request(), invented: true }),
		/fields/iu);
});
