/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { samplePointAtPointer } from '../src/common/editor/ui/timeline/track-row-helpers.jsx';

test('pointer sampling maps the exact lane bottom to the final channel boundary', () => {
	const lane = {
		getBoundingClientRect: () => ({ height: 2, top: 10 }),
	};
	const point = samplePointAtPointer(
		{ clientX: 20, clientY: 12 },
		lane,
		{ timelineStartFrame: 5, durationFrames: 5 },
		{ channelCount: 2 },
		() => 20,
	);

	assert.deepEqual(point, { channel: 1, timelineFrame: 9, value: -1 });
});

test('pointer sampling follows the rendered asymmetric stereo channel boundary', () => {
	const lane = {
		dataset: { channelBodyTop: '20', channelHeightRatio: '0.25' },
		getBoundingClientRect: () => ({ height: 120, top: 0 }),
	};
	const first = samplePointAtPointer(
		{ clientX: 20, clientY: 40 }, lane,
		{ timelineStartFrame: 5, durationFrames: 5 }, { channelCount: 2 }, () => 7,
	);
	const second = samplePointAtPointer(
		{ clientX: 20, clientY: 50 }, lane,
		{ timelineStartFrame: 5, durationFrames: 5 }, { channelCount: 2 }, () => 7,
	);

	assert.equal(first.channel, 0);
	assert.ok(Math.abs(first.value + 0.6) < 1e-12);
	assert.equal(second.channel, 1);
	assert.ok(Math.abs(second.value - 13 / 15) < 1e-12);
});
