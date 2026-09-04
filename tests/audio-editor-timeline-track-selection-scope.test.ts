/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { timelineSelectedTrackIds } from '../src/common/editor/ui/timeline/track-selection-scope.ts';

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
