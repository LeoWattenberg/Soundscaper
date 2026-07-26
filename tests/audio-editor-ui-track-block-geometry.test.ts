import assert from 'node:assert/strict';
import test from 'node:test';

import {
	mediaTrackBlockBounds,
	mediaTrackBlockDestination,
} from '../src/common/editor/ui/timeline-track-block-geometry.ts';

const tracks = [
	{ id: 'intro' },
	{ id: 'video', laneGroupId: 'av-1' },
	{ id: 'audio', laneGroupId: 'av-1' },
	{ id: 'music' },
];

test('track-block bounds keep linked media lanes together', () => {
	assert.deepEqual(mediaTrackBlockBounds(tracks, 'intro'), { start: 0, end: 0 });
	assert.deepEqual(mediaTrackBlockBounds(tracks, 'video'), { start: 1, end: 2 });
	assert.deepEqual(mediaTrackBlockBounds(tracks, 'audio'), { start: 1, end: 2 });
	assert.deepEqual(mediaTrackBlockBounds(tracks, 'missing'), null);
});

test('track-block destinations preserve the existing top/up/down/bottom geometry', () => {
	assert.equal(mediaTrackBlockDestination(tracks, 'video', 'top'), 0);
	assert.equal(mediaTrackBlockDestination(tracks, 'video', 'up'), 0);
	assert.equal(mediaTrackBlockDestination(tracks, 'video', 'down'), 3);
	assert.equal(mediaTrackBlockDestination(tracks, 'video', 'bottom'), 3);
	assert.equal(mediaTrackBlockDestination(tracks, 'missing', 'top'), null);
});
