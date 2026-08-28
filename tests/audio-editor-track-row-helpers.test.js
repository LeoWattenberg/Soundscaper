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
