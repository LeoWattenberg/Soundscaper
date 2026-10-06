/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { generateAudioEditorSignal } from '../src/common/editor/generators.js';

test('DTMF apportions fractional symbol durations inside the requested total frame budget', () => {
	for (const sampleRate of [8_000, 44_100, 48_000]) {
		const result = generateAudioEditorSignal('dtmf', {
			sampleRate, sequence: '1234567890', durationSeconds: 1,
			toneSeconds: 0.068966, silenceSeconds: 0.034483,
		});
		assert.equal(result.frameCount, sampleRate);
		assert.equal(result.channels[0]?.length, sampleRate);
	}
});

test('DTMF retains per-symbol timing when no total duration is requested', () => {
	const result = generateAudioEditorSignal('dtmf', {
		sampleRate: 8_000, sequence: '12#', toneSeconds: 0.1, silenceSeconds: 0.05,
	});
	assert.equal(result.frameCount, 3_200);
});
