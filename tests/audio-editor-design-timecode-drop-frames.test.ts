/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { sequenceTimecodeFromFrameCount } from '../src/common/editor/sequence-timecode.ts';
import {
	timeCodeFrameFormat,
	timeCodeFrameSeconds,
	timeCodeLabelledFrameCount,
} from '../vendor/audacity-design-system/components/src/TimeCode/time-code-frames.ts';
import { timeCodeFormatOptionsForDomain } from
	'../vendor/audacity-design-system/components/src/TimeCode/time-code-formats.ts';

for (const rate of [{ num: 30_000, den: 1_001 }, { num: 60_000, den: 1_001 }]) {
	test(`design timecode matches sequence drop-frame labels at ${rate.num}/${rate.den}`, () => {
		const actualRate = rate.num / rate.den;
		const format = timeCodeFrameFormat('hh:mm:ss+ntsc-drop-frames', actualRate);
		assert.ok(format);
		assert.equal(format.rate, actualRate);
		for (const count of [0, 1, 2, 1_800, 3_600, 35_964, 72_000]) {
			const label = sequenceTimecodeFromFrameCount(count, rate, true);
			const labelled: number = ((label.hours * 60 + label.minutes) * 60 + label.seconds)
				* format.nominalRate + label.frames;
			assert.equal(timeCodeLabelledFrameCount(count, format), labelled);
			assert.ok(Math.abs(timeCodeFrameSeconds([
				label.hours, label.minutes, label.seconds, label.frames,
			], format) - count / actualRate) < 1e-8);
		}
	});
}

test('the 59.94 drop-frame format menu names its active sequence rate', () => {
	const option = timeCodeFormatOptionsForDomain('time', 60_000 / 1_001)
		.find(({ format }) => format === 'hh:mm:ss+ntsc-drop-frames');
	assert.match(option?.label ?? '', /59\.94 fps/u);
});
