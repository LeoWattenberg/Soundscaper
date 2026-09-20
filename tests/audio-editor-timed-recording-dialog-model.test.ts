/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createTimedRecordingDialogValue,
	timedRecordingDialogRange,
	updateTimedRecordingDialogDuration,
	updateTimedRecordingDialogEnd,
	updateTimedRecordingDialogEndMode,
	updateTimedRecordingDialogStart,
} from '../src/common/editor/ui/dialogs/timed-recording-dialog-model.ts';

test('timed recording dialog starts with a one-hour duration and linked end date', () => {
	const startTimeMs = new Date(2030, 0, 2, 3, 4, 5).getTime();
	const value = createTimedRecordingDialogValue(startTimeMs);

	assert.equal(value.durationSeconds, 3_600);
	assert.equal(new Date(value.endTime).getTime() - new Date(value.startTime).getTime(), 3_600_000);
	assert.equal(value.endMode, 'duration');
	assert.deepEqual(timedRecordingDialogRange(value, startTimeMs - 1), {
		startTimeMs,
		endTimeMs: startTimeMs + 3_600_000,
	});
});

test('timed recording duration and end date stay linked to the start', () => {
	const startTimeMs = new Date(2030, 0, 2, 3, 4, 5).getTime();
	const initial = createTimedRecordingDialogValue(startTimeMs);
	const shorter = updateTimedRecordingDialogDuration(initial, 90);
	assert.equal(new Date(shorter.endTime).getTime(), startTimeMs + 90_000);

	const laterStart = new Date(startTimeMs + 60_000);
	const moved = updateTimedRecordingDialogStart(shorter, localDateTime(laterStart));
	assert.equal(new Date(moved.endTime).getTime(), laterStart.getTime() + 90_000);

	const laterEnd = new Date(laterStart.getTime() + 150_000);
	const ended = updateTimedRecordingDialogEnd(moved, localDateTime(laterEnd));
	assert.equal(ended.durationSeconds, 150);

	const explicitEnd = updateTimedRecordingDialogEndMode(ended, 'end');
	const earlierStart = new Date(laterStart.getTime() - 30_000);
	const extended = updateTimedRecordingDialogStart(explicitEnd, localDateTime(earlierStart));
	assert.equal(extended.endTime, explicitEnd.endTime);
	assert.equal(extended.durationSeconds, 180);
});

test('timed recording dialog refuses a past start or an end before the start', () => {
	const startTimeMs = new Date(2030, 0, 2, 3, 4, 5).getTime();
	const value = createTimedRecordingDialogValue(startTimeMs, startTimeMs + 60_000);
	assert.equal(timedRecordingDialogRange(value, startTimeMs), null);
	assert.equal(timedRecordingDialogRange({
		...value,
		endTime: localDateTime(new Date(startTimeMs - 1)),
	}, startTimeMs - 1), null);
});

function localDateTime(date: Date): string {
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 19);
}
