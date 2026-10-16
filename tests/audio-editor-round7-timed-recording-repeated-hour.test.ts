/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createTimedRecordingDialogValue, timedRecordingDialogRange,
	updateTimedRecordingDialogDuration, updateTimedRecordingDialogEndMode,
	updateTimedRecordingDialogEnd, updateTimedRecordingDialogStart,
} from '../src/common/editor/ui/dialogs/timed-recording-dialog-model.ts';

function inBerlin(check: () => void): void {
	const previous = process.env.TZ;
	process.env.TZ = 'Europe/Berlin';
	try { check(); } finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
}

test('choosing the linked end date preserves an ordinary two-hour recording', () => {
	inBerlin(() => {
		const start = new Date('2030-10-26T01:30').getTime();
		const duration = updateTimedRecordingDialogDuration(createTimedRecordingDialogValue(start), 7_200);
		assert.deepEqual(timedRecordingDialogRange(updateTimedRecordingDialogEndMode(duration, 'end'), start - 1), {
			startTimeMs: start, endTimeMs: start + 7_200_000,
		});
	});
});

test('choosing the linked end date retains the later occurrence of a repeated hour', () => {
	inBerlin(() => {
		const start = new Date('2030-10-27T01:30').getTime();
		const duration = updateTimedRecordingDialogDuration(createTimedRecordingDialogValue(start), 7_200);
		assert.equal(duration.endTime, '2030-10-27T02:30:00');
		assert.deepEqual(timedRecordingDialogRange(duration, start - 1), {
			startTimeMs: start, endTimeMs: start + 7_200_000,
		});
		assert.deepEqual(timedRecordingDialogRange(updateTimedRecordingDialogEndMode(duration, 'end'), start - 1), {
			startTimeMs: start, endTimeMs: start + 7_200_000,
		});
	});
});

test('a recording ending at the repeated start wall time stays schedulable after the mode switch', () => {
	inBerlin(() => {
		const start = new Date('2030-10-27T02:30').getTime();
		const duration = createTimedRecordingDialogValue(start);
		assert.equal(duration.endTime, '2030-10-27T02:30:00');
		assert.deepEqual(timedRecordingDialogRange(updateTimedRecordingDialogEndMode(duration, 'end'), start - 1), {
			startTimeMs: start, endTimeMs: start + 3_600_000,
		});
	});
});

test('reopening a scheduled recording retains its later repeated-hour start instant', () => {
	inBerlin(() => {
		const start = new Date('2030-10-27T02:30+01:00').getTime();
		assert.deepEqual(timedRecordingDialogRange(createTimedRecordingDialogValue(start), start - 1), {
			startTimeMs: start, endTimeMs: start + 3_600_000,
		});
	});
});

test('moving the start in end mode retains the linked later-hour end', () => {
	inBerlin(() => {
		const start = new Date('2030-10-27T01:30').getTime();
		const endMode = updateTimedRecordingDialogEndMode(
			updateTimedRecordingDialogDuration(createTimedRecordingDialogValue(start), 7_200), 'end',
		);
		const moved = updateTimedRecordingDialogStart(endMode, '2030-10-27T01:45');
		assert.equal(moved.durationSeconds, 6_300);
		assert.deepEqual(timedRecordingDialogRange(moved, start - 1), {
			startTimeMs: start + 900_000, endTimeMs: start + 7_200_000,
		});
	});
});

test('an explicit end edit uses the entered local time rather than its previously linked instant', () => {
	inBerlin(() => {
		const start = new Date('2030-10-27T01:30').getTime();
		const endMode = updateTimedRecordingDialogEndMode(
			updateTimedRecordingDialogDuration(createTimedRecordingDialogValue(start), 7_200), 'end',
		);
		const edited = updateTimedRecordingDialogEnd(endMode, '2030-10-27T02:15');
		assert.equal(edited.durationSeconds, 2_700);
		assert.deepEqual(timedRecordingDialogRange(edited, start - 1), {
			startTimeMs: start, endTimeMs: start + 2_700_000,
		});
		assert.equal(timedRecordingDialogRange(updateTimedRecordingDialogEnd(edited, '2030-10-27T01:30'), start - 1), null);
	});
});
