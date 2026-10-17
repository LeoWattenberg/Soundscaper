/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { clipBodyClickSelection, trackPanelClickSelection, clipPointerHasMoved } from '../src/common/editor/ui/timeline/clip-pointer-selection.ts';
const project = {
	tracks: [{ id: 'one', type: 'audio', clipIds: ['first', 'second'] }, { id: 'two', type: 'audio', clipIds: ['third'] }],
	clips: [{ id: 'first', timelineStartFrame: 100, durationFrames: 200 }, { id: 'second', timelineStartFrame: 500, durationFrames: 300 }, { id: 'third', timelineStartFrame: 0, durationFrames: 1000 }],
};
test('body double-click selects audio and triple-click selects every clip on its track', () => {
	assert.deepEqual(clipBodyClickSelection(project, 'first', 2), { startFrame: 100, endFrame: 300, trackIds: ['one'], clipIds: [] });
	assert.deepEqual(clipBodyClickSelection(project, 'first', 3), { startFrame: 0, endFrame: 0, trackIds: ['one'], clipIds: ['first', 'second'] });
	assert.equal(clipBodyClickSelection(project, 'first', 1), null);
});
test('track panel double-click selects its complete audio extent and triple-click selects all tracks without a range', () => {
	assert.deepEqual(trackPanelClickSelection(project, 'one', 2), { startFrame: 100, endFrame: 800, trackIds: ['one'], clipIds: [] });
	assert.deepEqual(trackPanelClickSelection(project, 'one', 3), { startFrame: 0, endFrame: 0, trackIds: ['one', 'two'], clipIds: [] });
	assert.equal(clipPointerHasMoved({ startX: 10, startY: 10 }, 12, 10), false);
	assert.equal(clipPointerHasMoved({ startX: 10, startY: 10 }, 13, 10), true);
});
