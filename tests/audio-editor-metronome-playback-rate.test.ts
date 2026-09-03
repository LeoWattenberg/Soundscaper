/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	calculateAudioEditorMetronomeSchedule,
} from '../src/common/editor/controller/transport-model.ts';

test('metronome transport timing scales both the next click and beat interval by playback rate', () => {
	const normal = calculateAudioEditorMetronomeSchedule({
		bpm: 120,
		sampleRate: 48_000,
		positionFrame: 12_000,
		playbackRate: 1,
	});
	const doubleSpeed = calculateAudioEditorMetronomeSchedule({
		bpm: 120,
		sampleRate: 48_000,
		positionFrame: 12_000,
		playbackRate: 2,
	});
	assert.deepEqual(normal, {
		beatIndex: 1,
		delaySeconds: 0.25,
		beatDurationSeconds: 0.5,
	});
	assert.deepEqual(doubleSpeed, {
		beatIndex: 1,
		delaySeconds: 0.125,
		beatDurationSeconds: 0.25,
	});
});
