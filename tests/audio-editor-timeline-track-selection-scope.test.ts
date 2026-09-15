/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { timelineSelectedTrackIds, timelineSelectionDragTrackIds } from '../src/common/editor/ui/timeline/track-selection-scope.ts';

test('an explicit track selection is the set of tracks a range acts on', () => {
	const selected = timelineSelectedTrackIds({ trackIds: ['voice', 'music'] }, 'voice');
	assert.deepEqual([...selected].sort(), ['music', 'voice']);
});

test('the focused track carries the selection when the document lists no tracks', () => {
	assert.deepEqual([...timelineSelectedTrackIds({ trackIds: [] }, 'voice')], ['voice']);
	assert.deepEqual([...timelineSelectedTrackIds(null, 'voice')], ['voice']);
	assert.deepEqual([...timelineSelectedTrackIds(undefined, 'voice')], ['voice']);
});

test('an explicit track selection wins over the focused track', () => {
	assert.deepEqual([...timelineSelectedTrackIds({ trackIds: ['music'] }, 'voice')], ['music']);
});

test('no track is highlighted when nothing is selected or focused', () => {
	assert.equal(timelineSelectedTrackIds({ trackIds: [] }, null).size, 0);
	assert.equal(timelineSelectedTrackIds({}, '').size, 0);
});

test('malformed selection entries are ignored rather than highlighting a nameless track', () => {
	assert.deepEqual([...timelineSelectedTrackIds({ trackIds: ['music', '', 7, null] }, 'voice')], ['music']);
	assert.deepEqual([...timelineSelectedTrackIds({ trackIds: 'music' }, 'voice')], ['voice']);
});

function lane(trackId: string, top: number, bottom: number) {
	return {
		dataset: { trackId },
		getBoundingClientRect: () => ({ top, bottom }),
	};
}

const lanes = [lane('voice', 100, 220), lane('labels', 220, 260), lane('music', 260, 440)];
const scrollRoot = { querySelectorAll: () => lanes };

test('a selection drag includes every crossed lane in either direction, including label tracks', () => {
	assert.deepEqual(timelineSelectionDragTrackIds(lanes[0]!, scrollRoot, 350), ['voice', 'labels', 'music']);
	assert.deepEqual(timelineSelectionDragTrackIds(lanes[2]!, scrollRoot, 150), ['voice', 'labels', 'music']);
});

test('reversing a drag removes tracks outside its current span', () => {
	assert.deepEqual(timelineSelectionDragTrackIds(lanes[0]!, scrollRoot, 240), ['voice', 'labels']);
	assert.deepEqual(timelineSelectionDragTrackIds(lanes[0]!, scrollRoot, 180), ['voice']);
	assert.deepEqual(timelineSelectionDragTrackIds(lanes[2]!, scrollRoot, 240), ['labels', 'music']);
});

test('a drag beyond the track list keeps the crossed tracks without inventing a drop target', () => {
	assert.deepEqual(timelineSelectionDragTrackIds(lanes[0]!, scrollRoot, 500), ['voice', 'labels', 'music']);
	assert.deepEqual(timelineSelectionDragTrackIds(lanes[2]!, scrollRoot, 0), ['voice', 'labels', 'music']);
});

test('lane boundaries belong to the next track and a disconnected lane keeps its own scope', () => {
	assert.deepEqual(timelineSelectionDragTrackIds(lanes[0]!, scrollRoot, 260), ['voice', 'labels', 'music']);
	assert.deepEqual(timelineSelectionDragTrackIds(lanes[0]!, null, 350), ['voice']);
});

test('a ruler drag preserves the existing track scope', () => {
	const ruler = { dataset: { rulerInteraction: '' }, getBoundingClientRect: () => ({ top: 80, bottom: 100 }) };
	assert.equal(timelineSelectionDragTrackIds(ruler, scrollRoot, 350), undefined);
});
