/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { timedRecordingToastPresentation } from '../src/common/editor/ui/workspace/timed-recording-toast-model.ts';

test('timed recording toast counts down to start and then to the recording end', () => {
	const range = { startTimeMs: 60_000, endTimeMs: 3_660_000 };
	assert.deepEqual(timedRecordingToastPresentation(range, null, 0), {
		phase: 'scheduled', timeRemaining: '00:01:00',
	});
	assert.deepEqual(timedRecordingToastPresentation(range, null, 1_001), {
		phase: 'scheduled', timeRemaining: '00:00:59',
	});
	assert.deepEqual(timedRecordingToastPresentation(null, range, 61_000), {
		phase: 'recording', timeRemaining: '00:59:59',
	});
	assert.deepEqual(timedRecordingToastPresentation(null, range, 59_000), {
		phase: 'recording', timeRemaining: '01:00:00',
	});
	assert.deepEqual(timedRecordingToastPresentation(null, range, 3_660_001), {
		phase: 'recording', timeRemaining: '00:00:00',
	});
});

test('timed recording toast handles a long wait, an open-ended take, and no timer', () => {
	assert.deepEqual(timedRecordingToastPresentation({ startTimeMs: 360_061_000 }, null, 0), {
		phase: 'scheduled', timeRemaining: '100:01:01',
	});
	assert.deepEqual(timedRecordingToastPresentation(null, { startTimeMs: 1_000 }, 2_000), {
		phase: 'recording', timeRemaining: null,
	});
	assert.equal(timedRecordingToastPresentation(null, null, 2_000), null);
});
