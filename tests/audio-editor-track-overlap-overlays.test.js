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
