/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createAssistanceTransNetV2BoundariesV1,
} from '../src/common/editor/assistance/transnetv2-postprocess-v1.ts';

function request(overrides: Readonly<Record<string, unknown>> = {}) {
	return {
		timescale: 1_000,
		sourceFrames: [0, 1, 2, 3, 4, 5, 6, 7, 8],
		presentationTicks: ['0', '40', '80', '120', '160', '200', '240', '280', '320'],
		singleFrameProbabilities: Float32Array.from([0, 0.1, 0.9, 0.1, 0, 0.6, 0.8, 0.7, 0]),
		allFrameProbabilities: Float32Array.from([0, 0, 0.1, 0, 0, 0.7, 0.75, 0.9, 0]),
		threshold: 0.5,
		minimumBoundaryDistanceFrames: 1,
		...overrides,
	};
}

test('TransNetV2 postprocessing selects one deterministic peak per cut or dissolve run', () => {
	assert.deepEqual(createAssistanceTransNetV2BoundariesV1(request()), {
		schemaVersion: 1,
		detector: 'transnetv2',
		timescale: 1_000,
		sourceFrameCount: 9,
		boundaries: [
			{ sourceFrame: 2, presentationTick: '80', score: Math.fround(0.9) },
			{ sourceFrame: 7, presentationTick: '280', score: Math.fround(0.9) },
		],
	});
});

test('TransNetV2 postprocessing keeps the stronger nearby boundary and resolves ties by source time', () => {
	const result = createAssistanceTransNetV2BoundariesV1(request({
		singleFrameProbabilities: Float32Array.from([0, 0.8, 0, 0.9, 0, 0, 0, 0, 0]),
		allFrameProbabilities: Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0]),
		minimumBoundaryDistanceFrames: 4,
	}));
	assert.deepEqual(result.boundaries.map(({ sourceFrame }) => sourceFrame), [3]);
	const tied = createAssistanceTransNetV2BoundariesV1(request({
		singleFrameProbabilities: Float32Array.from([0, 0.8, 0, 0.8, 0, 0, 0, 0, 0]),
		allFrameProbabilities: Float32Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0]),
		minimumBoundaryDistanceFrames: 4,
	}));
	assert.deepEqual(tied.boundaries.map(({ sourceFrame }) => sourceFrame), [1]);
});

test('TransNetV2 postprocessing reports no-cut footage as an authenticated empty result', () => {
	const result = createAssistanceTransNetV2BoundariesV1(request({
		singleFrameProbabilities: new Float32Array(9),
		allFrameProbabilities: new Float32Array(9),
	}));
	assert.deepEqual(result.boundaries, []);
	assert.equal(result.sourceFrameCount, 9);
});

test('TransNetV2 postprocessing retains absolute selected-range source ordinals', () => {
	const result = createAssistanceTransNetV2BoundariesV1(request({
		sourceFrames: [20, 21, 22, 23, 24, 25, 26, 27, 28],
	}));
	assert.equal(result.sourceFrameCount, 29);
	assert.deepEqual(result.boundaries.map(({ sourceFrame }) => sourceFrame), [22, 27]);
});

test('TransNetV2 postprocessing refuses malformed probabilities and timing authority', () => {
	assert.throws(() => createAssistanceTransNetV2BoundariesV1(request({
		singleFrameProbabilities: Float32Array.of(Number.NaN, 0, 0, 0, 0, 0, 0, 0, 0),
	})), /probability/iu);
	assert.throws(() => createAssistanceTransNetV2BoundariesV1(request({
		allFrameProbabilities: new Float32Array(8),
	})), /geometry|length/iu);
	assert.throws(() => createAssistanceTransNetV2BoundariesV1(request({
		presentationTicks: ['0', '40', '80', '80', '160', '200', '240', '280', '320'],
	})), /tick.*increasing|timing/iu);
	assert.throws(() => createAssistanceTransNetV2BoundariesV1(request({
		sourceFrames: [0, 1, 2, 4, 5, 6, 7, 8, 9],
	})), /source frame|consecutive/iu);
	assert.throws(() => createAssistanceTransNetV2BoundariesV1(request({ threshold: 1.1 })),
		/threshold/iu);
	assert.throws(() => createAssistanceTransNetV2BoundariesV1({ ...request(), invented: true }),
		/fields/iu);
});
