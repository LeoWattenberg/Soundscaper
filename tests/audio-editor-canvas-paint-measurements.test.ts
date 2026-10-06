/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotWaveformCanvasStyle } from '../src/common/editor/ui/timeline/canvas-paint-measurements.ts';

test('waveform palette is immutable across backing-store writes and includes frequency colors', () => {
	let writesStarted = false;
	const source = {
		get colorScheme() { assert.equal(writesStarted, false); return 'dark'; },
		getPropertyValue(property: string) {
			assert.equal(writesStarted, false);
			return property === '--frequency-low' ? 'blue' : `${property}-resolved`;
		},
	};
	const style = snapshotWaveformCanvasStyle(source, 'orange');
	writesStarted = true;
	assert.equal(style.colorScheme, 'dark');
	assert.equal(style.getPropertyValue('--frequency-low'), 'blue');
	assert.equal(style.getPropertyValue('--clip-orange-waveform'), '--clip-orange-waveform-resolved');
	assert.equal(style.getPropertyValue('--frequency-rms-overlay'), '--frequency-rms-overlay-resolved');
	assert.equal(style.getPropertyValue('--absent'), '');
});
