/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	advanceAudacityTrackSelection,
	audacityToggledTrackSelection,
	audacityTrackRangeSelection,
} from '../src/common/editor/audacity-track-selection.ts';

const TRACK_IDS = Object.freeze(['track-a', 'track-b', 'track-c', 'track-d']);

test('extended track selection advances focus and contracts when reversing', () => {
	let focusedTrackId = 'track-a';
	let selectedTrackIds: readonly string[] = ['track-a'];
	for (const expected of [
		{ focusedTrackId: 'track-b', selectedTrackIds: ['track-a', 'track-b'] },
		{ focusedTrackId: 'track-c', selectedTrackIds: ['track-a', 'track-b', 'track-c'] },
	]) {
		const next = advanceAudacityTrackSelection({
			trackIds: TRACK_IDS,
			focusedTrackId,
			selectedTrackIds,
			direction: 1,
		});
		assert.deepEqual(next, expected);
		({ focusedTrackId, selectedTrackIds } = next);
	}
	assert.deepEqual(advanceAudacityTrackSelection({
		trackIds: TRACK_IDS,
		focusedTrackId,
		selectedTrackIds,
		direction: -1,
	}), {
		focusedTrackId: 'track-b',
		selectedTrackIds: ['track-a', 'track-b'],
	});
});

test('upward extension preserves the original first-track range anchor', () => {
	assert.deepEqual(advanceAudacityTrackSelection({
		trackIds: TRACK_IDS,
		focusedTrackId: 'track-c',
		selectedTrackIds: ['track-c'],
		direction: -1,
	}), {
		focusedTrackId: 'track-b',
		selectedTrackIds: ['track-c', 'track-b'],
	});
});

test('track range selection fills every track between the selection and focus', () => {
	assert.deepEqual(audacityTrackRangeSelection({
		trackIds: TRACK_IDS,
		focusedTrackId: 'track-d',
		selectedTrackIds: ['track-a', 'track-c'],
	}), ['track-a', 'track-b', 'track-c', 'track-d']);
	assert.deepEqual(audacityTrackRangeSelection({
		trackIds: TRACK_IDS,
		focusedTrackId: 'track-d',
		selectedTrackIds: ['track-c', 'track-a'],
	}), ['track-c', 'track-d'], 'the first selected track remains the range anchor');
	assert.deepEqual(audacityTrackRangeSelection({
		trackIds: TRACK_IDS,
		focusedTrackId: 'track-a',
		selectedTrackIds: ['track-c'],
	}), ['track-c', 'track-a', 'track-b'], 'a reverse range retains its first-ID anchor');
	assert.deepEqual(audacityTrackRangeSelection({
		trackIds: TRACK_IDS,
		focusedTrackId: 'track-c',
		selectedTrackIds: [],
	}), ['track-c']);
});

test('toggle selection preserves the first selected track as the range anchor', () => {
	assert.deepEqual(audacityToggledTrackSelection({
		trackIds: TRACK_IDS,
		focusedTrackId: 'track-d',
		selectedTrackIds: ['track-c', 'track-a'],
	}, 'toggle'), ['track-c', 'track-a', 'track-d']);
});
