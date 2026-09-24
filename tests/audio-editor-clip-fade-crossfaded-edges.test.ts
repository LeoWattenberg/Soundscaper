/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { crossfadedClipFadeEdges } from '../src/common/editor/ui/timeline/clip-fade-crossfaded-edges.ts';

test('partial overlaps consume the outgoing and incoming quick-fade shape edges', () => {
	const edges = crossfadedClipFadeEdges([
		{ id: 'earlier', timelineStartFrame: 0, durationFrames: 100 },
		{ id: 'later', timelineStartFrame: 75, durationFrames: 100 },
	]);
	assert.deepEqual([...edges].sort(), ['earlier:out', 'later:in']);
});

test('one-frame crossfades count, while touching and contained clips do not', () => {
	const edges = crossfadedClipFadeEdges([
		{ id: 'base', timelineStartFrame: 0, durationFrames: 100 },
		{ id: 'contained', timelineStartFrame: 10, durationFrames: 20 },
		{ id: 'one-frame', timelineStartFrame: 99, durationFrames: 100 },
		{ id: 'touching', timelineStartFrame: 199, durationFrames: 20 },
	]);
	assert.deepEqual([...edges].sort(), ['base:out', 'one-frame:in']);
});
