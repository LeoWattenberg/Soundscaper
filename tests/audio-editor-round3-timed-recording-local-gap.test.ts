/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createTimedRecordingDialogValue, timedRecordingDialogRange,
	updateTimedRecordingDialogEnd, updateTimedRecordingDialogEndMode,
	updateTimedRecordingDialogStart,
} from '../src/common/editor/ui/dialogs/timed-recording-dialog-model.ts';

function inBerlin(check: () => void): void {
	const previous = process.env.TZ;
	process.env.TZ = 'Europe/Berlin';
	try { check(); } finally {
		if (previous === undefined) delete process.env.TZ;
		else process.env.TZ = previous;
	}
}

test('timer start admission refuses a daylight-saving gap without moving its linked draft', () => {
	inBerlin(() => {
		const start = new Date('2030-03-31T01:30').getTime();
		const initial = createTimedRecordingDialogValue(start);
		const gap = updateTimedRecordingDialogStart(initial, '2030-03-31T02:30');
		assert.equal(timedRecordingDialogRange(gap, start - 1), null);
		assert.equal(gap.startTime, '2030-03-31T02:30');
		assert.equal(gap.endTime, initial.endTime);
		assert.equal(gap.durationSeconds, initial.durationSeconds);
	});
});

test('timer end admission refuses a daylight-saving gap without replacing its valid duration', () => {
	inBerlin(() => {
		const start = new Date('2030-03-31T01:30').getTime();
		const initial = updateTimedRecordingDialogEndMode(createTimedRecordingDialogValue(start), 'end');
		const gap = updateTimedRecordingDialogEnd(initial, '2030-03-31T02:30');
		assert.equal(timedRecordingDialogRange(gap, start - 1), null);
		assert.equal(gap.endTime, '2030-03-31T02:30');
		assert.equal(gap.durationSeconds, initial.durationSeconds);
	});
});

test('timer local admission retains real instants around transitions and fractional precision', () => {
	inBerlin(() => {
		for (const local of ['2030-03-31T01:30', '2030-03-31T03:30:02.125', '2030-10-27T02:30']) {
			const start = new Date(local).getTime();
			const value = updateTimedRecordingDialogStart(createTimedRecordingDialogValue(start), local);
			assert.deepEqual(timedRecordingDialogRange(value, start - 1), {
				startTimeMs: start, endTimeMs: start + 3_600_000,
			});
		}
	});
});
