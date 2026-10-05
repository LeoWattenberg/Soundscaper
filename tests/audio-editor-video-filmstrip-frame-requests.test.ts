/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoFilmstripFrameRequests } from '../src/common/editor/ui/timeline/video-filmstrip-frame-requests.ts';

const clip = { id: 'clip', sourceId: 'source', timelineStartFrame: 48_000, durationFrames: 240_000 };

test('exact filmstrip requests quantize fractional timeline coordinates to integer samples', () => {
	const requests = createVideoFilmstripFrameRequests(clip, [{
		key: 'frame', sourceUrl: 'blob:thumbnail', point: { timelineFrame: 239_999.99999999997 },
	}]);
	assert.deepEqual(requests, [{ key: 'frame', clipId: 'clip', sourceId: 'source',
		sourceUrl: 'blob:thumbnail', timelineSample: 240_000 }]);
});

test('rounding retains first and last cells inside the clip half-open timeline range', () => {
	const requests = createVideoFilmstripFrameRequests(clip, [
		{ key: 'first', sourceUrl: 'blob:first', point: { timelineFrame: 47_999.99999999 } },
		{ key: 'last', sourceUrl: 'blob:last', point: { timelineFrame: 287_999.8 } },
		{ key: 'missing', sourceUrl: null, point: { timelineFrame: 48_000 } },
	]);
	assert.deepEqual(requests.map(({ timelineSample }) => timelineSample), [48_000, 287_999]);
	assert.deepEqual(requests.map(({ key }) => key), ['first', 'last']);
});

test('filmstrip requests reject invalid sample geometry', () => {
	for (const timelineFrame of [NaN, Infinity, -Infinity]) assert.throws(() => createVideoFilmstripFrameRequests(
		clip, [{ key: 'frame', sourceUrl: 'blob:thumbnail', point: { timelineFrame } }],
	), RangeError);
	assert.throws(() => createVideoFilmstripFrameRequests({ ...clip, durationFrames: 0 }, []), RangeError);
});
