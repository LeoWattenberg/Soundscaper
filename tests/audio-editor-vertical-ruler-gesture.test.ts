/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	frequencyRulerWheelRange,
	verticalRulerWheelZoom,
} from '../src/common/editor/ui/timeline/vertical-ruler-gesture.ts';
import { spectrogramFrequencyAtFraction } from '../src/common/editor/ui/timeline/geometry.ts';

test('frequency wheel zoom keeps the frequency under the mouse at the same position', () => {
	for (const scale of ['linear', 'logarithmic', 'mel'] as const) {
		const before = { minimumFrequency: 100, maximumFrequency: 10_000 };
		const next = frequencyRulerWheelRange(before, scale, 24_000, 0.3, -120, true);
		assert.ok(next.maximumFrequency - next.minimumFrequency < 9_900);
		const beforeAnchor = spectrogramFrequencyAtFraction(0.7, scale, 100, 10_000);
		const afterAnchor = spectrogramFrequencyAtFraction(0.7, scale, next.minimumFrequency, next.maximumFrequency);
		assert.ok(Math.abs(beforeAnchor - afterAnchor) < 1e-4);
	}
});

test('frequency panning and zooming keep ordered bounds within Nyquist', () => {
	for (const delta of [-1_000_000, 1_000_000]) {
		const range = frequencyRulerWheelRange({ minimumFrequency: 100, maximumFrequency: 500 }, 'linear', 4_000, 0.5, delta, false);
		assert.ok(range.minimumFrequency >= 0);
		assert.ok(range.maximumFrequency <= 4_000);
		assert.equal(range.maximumFrequency - range.minimumFrequency, 400);
	}
});

test('waveform wheel zoom follows menu levels and clamps at supported limits', () => {
	assert.equal(verticalRulerWheelZoom(0, -120), 1);
	assert.equal(verticalRulerWheelZoom(2, 120), 1);
	assert.equal(verticalRulerWheelZoom(0, 120), 0);
	assert.equal(verticalRulerWheelZoom(8, -120), 8);
	assert.equal(verticalRulerWheelZoom(2, 0), 2);
});
