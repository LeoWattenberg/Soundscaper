/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { audacityCanvasPlansAreCurrent } from '../src/common/editor/ui/timeline/TimelineCanvasRenderer.jsx';

test('loading the lazy frequency renderer invalidates an ordinary fallback canvas draw', () => {
	const waveform = {};
	const frequencyWaveform = {};
	const clip = { audacityWaveform: waveform, frequencyWaveform };
	const canvas = {
		__kwWaveformPlan: waveform,
		__kwFrequencyWaveformPlan: frequencyWaveform,
		__kwFrequencyWaveformRenderer: null,
		__kwWaveformDrawKey: 'same-key',
	};
	const renderer = { drawThreeBandWaveformChannel() {}, drawRainbowWaveformChannel() {} };

	assert.equal(audacityCanvasPlansAreCurrent(canvas, clip, 'same-key', null), true);
	assert.equal(audacityCanvasPlansAreCurrent(canvas, clip, 'same-key', renderer), false);
});
