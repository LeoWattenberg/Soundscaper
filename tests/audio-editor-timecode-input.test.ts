/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audioEditorProjectFrameRate,
	audioEditorProjectSampleRate,
	clampAudioEditorTimeValue,
	timeCodeSecondsFromEditorValue,
	timeCodeSecondsToEditorValue,
} from '../src/common/editor/ui/AudioEditorTimeCodeInput.tsx';
import { timeCodeFormatOptionsForDomain } from
	'../vendor/audacity-design-system/components/src/TimeCode/TimeCode.tsx';

test('timecode input converts seconds, samples, and frames through their owning rates', () => {
	assert.equal(timeCodeSecondsFromEditorValue(1.25, 'seconds', 48_000), 1.25);
	assert.equal(timeCodeSecondsFromEditorValue(1_250, 'milliseconds', 48_000), 1.25);
	assert.equal(timeCodeSecondsFromEditorValue(60_000, 'samples', 48_000), 1.25);
	assert.equal(timeCodeSecondsFromEditorValue(30, 'frames', 24), 1.25);

	assert.equal(timeCodeSecondsToEditorValue(1.25, 'seconds', 48_000), 1.25);
	assert.equal(timeCodeSecondsToEditorValue(1.25, 'milliseconds', 48_000), 1_250);
	assert.equal(timeCodeSecondsToEditorValue(1.25, 'samples', 48_000), 60_000);
	assert.equal(timeCodeSecondsToEditorValue(1.25, 'frames', 24), 30);
});

test('timecode input rounds discrete units and clamps edits in the caller unit', () => {
	assert.equal(timeCodeSecondsToEditorValue(1 / 48_000 / 2, 'samples', 48_000), 1);
	assert.equal(timeCodeSecondsToEditorValue(1 / 60, 'frames', 30), 1);
	assert.equal(clampAudioEditorTimeValue(-1, 0, 10), 0);
	assert.equal(clampAudioEditorTimeValue(11, 0, 10), 10);
	assert.equal(clampAudioEditorTimeValue(5, 0, 10), 5);
});

test('timecode input refuses invalid values and rates instead of leaking NaN into editors', () => {
	assert.throws(() => timeCodeSecondsFromEditorValue(Number.NaN, 'seconds', 48_000), /finite/u);
	assert.throws(() => timeCodeSecondsFromEditorValue(1, 'samples', 0), /positive finite rate/u);
	assert.throws(() => timeCodeSecondsToEditorValue(1, 'frames', Number.NaN), /positive finite rate/u);
});

test('timecode input resolves project sample and sequence frame rates with safe fallbacks', () => {
	assert.equal(audioEditorProjectSampleRate({ sampleRate: 96_000 }), 96_000);
	assert.equal(audioEditorProjectSampleRate({ sampleRate: 0 }), 48_000);
	assert.equal(audioEditorProjectFrameRate({
		primarySequenceId: 'b',
		sequences: [{ id: 'a', rate: { num: 24, den: 1 } }, { id: 'b', rate: { num: 30_000, den: 1_001 } }],
	}), 30_000 / 1_001);
	assert.equal(audioEditorProjectFrameRate({ sequences: [] }), 24);
});

test('timecode dropdown domains keep Hz exclusive to frequencies', () => {
	const timeFormats = timeCodeFormatOptionsForDomain('time').map(({ format }) => format);
	const frequencyFormats = timeCodeFormatOptionsForDomain('frequency').map(({ format }) => format);
	assert.equal(timeFormats.includes('Hz'), false);
	assert.deepEqual(frequencyFormats, ['Hz']);
});
