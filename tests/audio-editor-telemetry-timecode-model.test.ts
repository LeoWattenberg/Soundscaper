/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sequenceFrameBoundarySample } from '../src/common/editor/sequence-frame-navigation.ts';
import { resolveSequenceTimingView, sampleAtSequenceTimecodeLabel } from '../src/common/editor/sequence-timing-model.ts';
import {
	sequenceDisplaySecondsAtSample,
	sequenceTimeCodeFormat,
	sequenceTimeCodeLabelAtDisplaySeconds,
} from '../src/common/editor/ui/toolbar/telemetry-timecode-model.ts';

const sampleRate = 48_000;

for (const rate of [{ num: 30_000, den: 1_001 }, { num: 60_000, den: 1_001 }]) {
	test(`standard timecode preserves the sequence start and frame grid at ${rate.num}/${rate.den}`, () => {
		const view = resolveSequenceTimingView({
			primarySequenceId: 'main',
			sequences: [{ id: 'main', name: 'Main', rate, dropFrame: true,
				startTimecode: { negative: false, hours: 1, minutes: 0, seconds: 0, frames: 0 } }],
		});
		assert.equal(sequenceTimeCodeFormat(view), 'hh:mm:ss+ntsc-drop-frames');
		const first = sequenceDisplaySecondsAtSample(0, view, sampleRate);
		assert.equal(Math.round(first * rate.num / rate.den), view.startFrameCount);
		for (const frame of [0, 1, 2, 1_800, 3_600]) {
			const sample = sequenceFrameBoundarySample(frame, rate, sampleRate);
			const seconds = sequenceDisplaySecondsAtSample(sample, view, sampleRate);
			const label = sequenceTimeCodeLabelAtDisplaySeconds(seconds, view);
			assert.equal(sampleAtSequenceTimecodeLabel(view, label, sampleRate), sample);
		}
		assert.equal(sampleAtSequenceTimecodeLabel(
			view, sequenceTimeCodeLabelAtDisplaySeconds(first - 3_600, view), sampleRate,
		), 0);
	});
}
