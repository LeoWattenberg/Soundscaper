/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimelineLaneIndex } from '../src/common/editor/ui/timeline/timeline-lane-index.ts';

void test('lane hits and selection spans retain geometry until layout invalidation', () => {
	let reads = 0;
	let shift = 0;
	const index = createTimelineLaneIndex(() => {
		reads += 1;
		return Array.from({ length: 10_000 }, (_, number) => ({
			trackId: `track-${number}`, top: number * 100 + shift, bottom: number * 100 + 100 + shift,
			label: number === 1,
		}));
	});
	assert.equal(index.trackAt(0), 'track-0');
	assert.equal(index.trackAt(99.999), 'track-0');
	assert.equal(index.trackAt(100), null, 'label lanes do not accept audio clip moves');
	assert.equal(index.trackAt(200), 'track-2');
	assert.deepEqual(index.selection('track-0', 250), ['track-0', 'track-1', 'track-2']);
	for (let number = 0; number < 1_000; number++) assert.equal(index.trackAt(999_999), 'track-9999');
	assert.equal(reads, 1, 'pointer queries do not revisit ten thousand lane rectangles');
	shift = 25;
	index.invalidate();
	assert.equal(index.trackAt(0), null);
	assert.equal(index.trackAt(25), 'track-0');
	assert.equal(reads, 2);
	assert.equal(index.selection('removed-track', 100), null);
});
