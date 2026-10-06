/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseVideoKeyframeNumber, parseVideoKeyframePosition } from '../src/common/editor/ui/inspector/video-keyframe-exact-input.ts';

test('exact keyframe positions reject missing fraction components rather than converting them to zero', () => {
	for (const value of ['/2', ' / 2 ', '2/', '/', '2/ ', '']) {
		assert.throws(() => parseVideoKeyframePosition(value), TypeError, value);
	}
	assert.deepEqual(parseVideoKeyframePosition('0/2'), { num: 0, den: 2 });
	assert.deepEqual(parseVideoKeyframePosition(' 1 / 3 '), { num: 1, den: 3 });
	assert.equal(parseVideoKeyframePosition('0.5'), 0.5);
	assert.throws(() => parseVideoKeyframePosition('1/0'), TypeError);
	assert.throws(() => parseVideoKeyframeNumber('-0'), TypeError);
});
