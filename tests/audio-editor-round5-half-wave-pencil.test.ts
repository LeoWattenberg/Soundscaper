/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { samplePointerAmplitude } from '../src/common/editor/ui/timeline/sample-pointer-amplitude.ts';

for (const format of ['linear-amp', 'linear-db', undefined]) {
	test(`Half-wave Pencil follows the positive ruler in ${String(format)}`, () => {
		for (const zoom of [0, 1, 3]) {
			for (const [height, value] of [[2, 1], [27, 0.75], [52, 0.5], [77, 0.25], [102, 0]] as const) {
				assert.equal(samplePointerAmplitude(height, 104, format, zoom, true), value / 2 ** zoom);
			}
			assert.equal(samplePointerAmplitude(104, 104, format, zoom, true), 0, 'bottom padding cannot draw a negative sample');
		}
	});
}

test('full-wave linear Pencil retains its signed scale and magnification', () => {
	for (const format of ['linear-amp', 'linear-db', undefined]) {
		for (const zoom of [0, 1, 3]) {
			for (const [height, value] of [[0, 1], [25, 0.5], [50, 0], [75, -0.5], [100, -1]] as const) {
				assert.equal(samplePointerAmplitude(height, 100, format, zoom, false), value / 2 ** zoom);
			}
		}
	}
});

test('logarithmic Half-wave Pencil retains its existing dB inverse', () => {
	assert.equal(samplePointerAmplitude(102, 104, 'logarithmic-db', 0, true), 0);
	assert.ok(Math.abs(samplePointerAmplitude(52, 104, 'logarithmic-db', 0, true) - 10 ** (-30 / 20)) < 1e-12);
	assert.equal(samplePointerAmplitude(2, 104, 'logarithmic-db', 0, true), 1);
});
