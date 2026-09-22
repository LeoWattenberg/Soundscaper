/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { CLIP_CONTENT_OFFSET } from '@soundscaper/design-system/constants';

import { createCrossfadeOverlays } from '../src/common/editor/ui/timeline/TrackOverlapOverlays.jsx';

test('audio crossfade overlays share the clip content origin', () => {
	const overlays = createCrossfadeOverlays([
		{ id: 'left', isVisible: true, timelineStartFrame: 1_000, durationFrames: 1_000 },
		{ id: 'right', isVisible: true, timelineStartFrame: 1_500, durationFrames: 1_000 },
	], 500, 100, 1_000);

	assert.equal(overlays[0]?.left, CLIP_CONTENT_OFFSET + 100);
});

test('audio crossfade overlays omit contained drop-in clips', () => {
	const overlays = createCrossfadeOverlays([
		{ id: 'outer', isVisible: true, timelineStartFrame: 1_000, durationFrames: 3_000 },
		{ id: 'inner', isVisible: true, timelineStartFrame: 1_500, durationFrames: 1_000 },
	], 500, 100, 1_000);

	assert.deepEqual(overlays, []);
});

test('two millisecond crossfades appear only at sample-level zoom', () => {
	const clips = [
		{ id: 'left', isVisible: true, timelineStartFrame: 0, durationFrames: 1_000 },
		{ id: 'right', isVisible: true, timelineStartFrame: 998, durationFrames: 1_000 },
	];
	assert.deepEqual(createCrossfadeOverlays(clips, 0, 100, 1_000), []);
	assert.equal(createCrossfadeOverlays(clips, 0, 1_000, 1_000).length, 1);
	assert.equal(createCrossfadeOverlays([
		clips[0], { ...clips[1], timelineStartFrame: 500 },
	], 0, 100, 1_000).length, 1);
});
