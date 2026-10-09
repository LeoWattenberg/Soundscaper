/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { previewTimelineSelectionDrag } from '../src/common/editor/ui/timeline/selection-drag-preview.ts';

function lane(trackId: string, top: number): HTMLElement {
	return { dataset: { trackId }, getBoundingClientRect: () => ({ top, bottom: top + 100 }) } as unknown as HTMLElement;
}

const lanes = [lane('track-a', 0), lane('track-b', 100)];
const scrollRoot = { querySelectorAll: () => lanes } as unknown as HTMLElement;
const project = {
	tracks: [{ id: 'track-a', clipIds: ['clip-a'] }, { id: 'track-b', clipIds: [] }],
	clips: [{ id: 'clip-a', timelineStartFrame: 50, durationFrames: 400 }],
};

test('regular selection preview keeps snapped guides and the vertical track span', () => {
	const session: Parameters<typeof previewTimelineSelectionDrag>[0]['session'] = {
		lane: lanes[0]!, startFrame: 50, startSnapGuideFrame: 50,
	};
	const result = previewTimelineSelectionDrag({
		session, project, rawEndFrame: 448, clientY: 150, scrollRoot,
		pixelsPerSecond: 1_000, sampleRate: 1_000,
	});
	assert.deepEqual(result.selection, { startFrame: 50, endFrame: 450, trackIds: ['track-a', 'track-b'] });
	assert.deepEqual(result.guideFrames, [50, 450]);
	assert.equal(session.boundarySnapped, true);
	assert.equal(session.lastRawEndFrame, 448);
	assert.deepEqual(session.lastTrackIds, ['track-a', 'track-b']);
});

test('regular Escape unsnapping retains raw reversed endpoints and removes all snap guides', () => {
	const session: Parameters<typeof previewTimelineSelectionDrag>[0]['session'] = {
		lane: lanes[0]!, startFrame: 301, startSnapGuideFrame: null, snapDisabled: true,
	};
	const result = previewTimelineSelectionDrag({
		session, project, rawEndFrame: 52, clientY: 50, scrollRoot,
		pixelsPerSecond: 1_000, sampleRate: 1_000,
	});
	assert.deepEqual(result.selection, { startFrame: 52, endFrame: 301, trackIds: ['track-a'] });
	assert.deepEqual(result.guideFrames, []);
	assert.equal(session.boundarySnapped, false);
});
