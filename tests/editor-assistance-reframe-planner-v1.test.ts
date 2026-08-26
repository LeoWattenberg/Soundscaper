/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectAssistanceReframeSampleFramesV1,
	interpolateAssistanceReframeCropV1,
	planAssistanceReframePathV1,
} from '../src/common/editor/assistance/reframe-planner-v1.ts';

test('reframe sampling combines a fixed two-fps cadence with exact shot anchors', () => {
	assert.deepEqual(collectAssistanceReframeSampleFramesV1({
		sourceStartFrame: 100,
		sourceEndFrame: 401,
		timescale: 100,
		shotAnchorFrames: [275, 100, 276, 275, 400],
	}), [100, 150, 200, 250, 275, 276, 300, 350, 400]);
});

test('reframe planning uses tracked subjects, then saliency, then a centered fallback', () => {
	const path = planAssistanceReframePathV1({
		sourceSize: { width: 1_920, height: 1_080 },
		targetAspect: { width: 9, height: 16 },
		samples: [
			{
				sourceFrame: 0,
				subjects: [{
					trackId: 'speaker-right', kind: 'face', confidence: 0.9,
					box: { x: 0.82, y: 0.2, width: 0.12, height: 0.3 },
				}],
				saliency: { x: 0.1, y: 0.5, score: 0.99 },
			},
			{
				sourceFrame: 10,
				subjects: [],
				saliency: { x: 0.25, y: 0.5, score: 0.8 },
			},
			{ sourceFrame: 20, subjects: [], saliency: null },
		],
	});

	assert.deepEqual(path.map(({ sourceFrame, authority, trackIds }) => ({
		sourceFrame, authority, trackIds,
	})), [
		{ sourceFrame: 0, authority: 'subject', trackIds: ['speaker-right'] },
		{ sourceFrame: 10, authority: 'saliency', trackIds: [] },
		{ sourceFrame: 20, authority: 'center', trackIds: [] },
	]);
	for (const keyframe of path) {
		assert.equal(keyframe.crop.top, 0);
		assert.equal(keyframe.crop.bottom, 0);
		assert.ok(Math.abs(1 - keyframe.crop.left - keyframe.crop.right - 0.31640625) < 1e-12);
	}
	assert.equal(path[0]!.crop.right, 0);
	assert.ok(path[1]!.crop.left < path[2]!.crop.left);
});

test('reframe crop interpolation remains bounded and preserves its physical aspect', () => {
	const path = planAssistanceReframePathV1({
		sourceSize: { width: 1_920, height: 1_080 },
		targetAspect: { width: 9, height: 16 },
		samples: [
			{
				sourceFrame: 0,
				subjects: [{
					trackId: 'left', kind: 'object', confidence: 1,
					box: { x: 0, y: 0, width: 0.1, height: 1 },
				}],
				saliency: null,
			},
			{
				sourceFrame: 20,
				subjects: [{
					trackId: 'right', kind: 'object', confidence: 1,
					box: { x: 0.9, y: 0, width: 0.1, height: 1 },
				}],
				saliency: null,
			},
		],
	});
	const middle = interpolateAssistanceReframeCropV1(path, 10);
	assert.ok(Math.abs(middle.left - middle.right) < 1e-12);
	assert.ok(Math.abs((1 - middle.left - middle.right) * 1_920 / 1_080 - 9 / 16) < 1e-12);
	assert.deepEqual(interpolateAssistanceReframeCropV1(path, -1), path[0]!.crop);
	assert.deepEqual(interpolateAssistanceReframeCropV1(path, 21), path[1]!.crop);
});

test('reframe planning rejects invalid geometry, timing, and non-finite inference values', () => {
	assert.throws(() => collectAssistanceReframeSampleFramesV1({
		sourceStartFrame: 10, sourceEndFrame: 10, timescale: 30, shotAnchorFrames: [],
	}), /range|positive/iu);
	assert.throws(() => planAssistanceReframePathV1({
		sourceSize: { width: 1_920, height: 1_080 },
		targetAspect: { width: 1, height: 100 },
		samples: [{
			sourceFrame: 0, saliency: null,
			subjects: [{
				trackId: 'bad', kind: 'face', confidence: Number.NaN,
				box: { x: 0, y: 0, width: 1, height: 1 },
			}],
		}],
	}), /aspect|confidence/iu);
	assert.throws(() => planAssistanceReframePathV1({
		sourceSize: { width: 1_920, height: 1_080 },
		targetAspect: { width: 9, height: 16 },
		samples: [
			{ sourceFrame: 2, subjects: [], saliency: null },
			{ sourceFrame: 1, subjects: [], saliency: null },
		],
	}), /ordered/iu);
});
