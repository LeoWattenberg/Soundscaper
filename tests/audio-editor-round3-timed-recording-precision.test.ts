/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createTimedRecordingDialogValue, timedRecordingDialogRange,
	updateTimedRecordingDialogDuration, updateTimedRecordingDialogEnd,
	updateTimedRecordingDialogEndMode, updateTimedRecordingDialogStart,
} from '../src/common/editor/ui/dialogs/timed-recording-dialog-model.ts';

test('a fractional duration keeps the same scheduled range after choosing its linked end date', () => {
	const startTimeMs = new Date(2030, 0, 2, 3, 4, 5).getTime();
	const duration = updateTimedRecordingDialogDuration(createTimedRecordingDialogValue(startTimeMs), 1.5);
	const end = updateTimedRecordingDialogEndMode(duration, 'end');
	assert.deepEqual(timedRecordingDialogRange(end, startTimeMs - 1), {
		startTimeMs, endTimeMs: startTimeMs + 1_500,
	});
	assert.equal(new Date(duration.endTime).getTime(), startTimeMs + 1_500);
});

test('fractional authored dates survive initialization and a moved start without truncating their range', () => {
	const startTimeMs = new Date(2030, 0, 2, 3, 4, 5, 125).getTime();
	const initial = createTimedRecordingDialogValue(startTimeMs, startTimeMs + 1_750);
	assert.deepEqual(timedRecordingDialogRange(initial, startTimeMs - 1), {
		startTimeMs, endTimeMs: startTimeMs + 1_750,
	});
	const movedStart = new Date(2030, 0, 2, 3, 4, 6, 125);
	const localStart = new Date(movedStart.getTime() - movedStart.getTimezoneOffset() * 60_000)
		.toISOString().slice(0, 23);
	const moved = updateTimedRecordingDialogStart(initial, localStart);
	assert.equal(new Date(moved.endTime).getTime(), movedStart.getTime() + 1_750);
	const ended = updateTimedRecordingDialogEnd(moved, moved.endTime);
	assert.equal(ended.durationSeconds, 1.75);
	assert.deepEqual(timedRecordingDialogRange(updateTimedRecordingDialogEndMode(ended, 'end'), startTimeMs - 1), {
		startTimeMs: movedStart.getTime(), endTimeMs: movedStart.getTime() + 1_750,
	});
});
