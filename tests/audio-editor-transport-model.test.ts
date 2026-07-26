/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAudioEditorMetronomeSchedule } from '../src/common/editor/controller/transport-model.ts';

test('metronome schedules remain frame-accurate across playback rates', () => {
	assert.deepEqual(calculateAudioEditorMetronomeSchedule({
		bpm: 120,
		sampleRate: 48_000,
		positionFrame: 12_000,
		playbackRate: 2,
	}), {
		beatIndex: 1,
		delaySeconds: 0.125,
		beatDurationSeconds: 0.25,
	});
});

test('metronome schedules normalize invalid numeric input without negative delays', () => {
	const schedule = calculateAudioEditorMetronomeSchedule({
		bpm: 0,
		sampleRate: 0,
		positionFrame: -1,
		playbackRate: Number.NaN,
	});
	assert.equal(schedule.beatIndex, 0);
	assert.equal(schedule.delaySeconds, 0);
	assert.equal(schedule.beatDurationSeconds, 0.5);
});
